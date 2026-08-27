import {
  expect,
  test,
  type CDPSession,
  type Locator,
  type Page,
} from "@playwright/test";

const INITIAL_SCENE_BUDGET_MS = 300;
const RELATION_TRANSACTION_BUDGET_MS = 150;
const WARMUP_COUNT = 20;
const SAMPLE_COUNT = 20;
const PIZZA_NODE_COUNT = 25;
const PIZZA_EDGE_COUNT = 32;

type BrowserMetricSnapshot = Record<string, number>;

type BrowserPhaseSample = {
  durationMs: number;
  layoutMs: number;
  recalcStyleMs: number;
  scriptMs: number;
  taskMs: number;
  longTaskCount: number;
  longTaskTotalMs: number;
  longestTaskMs: number;
};

type InitialSceneSample = BrowserPhaseSample & {
  assetReadyAfterBodyMs: number;
  firstContentfulPaintAfterBodyMs: number | null;
  stablePaintWindowMs: number;
  workspaceTransferBytes: number;
};

type PerformanceWindow = Window & typeof globalThis & {
  __iriographBrowserPerformance?: {
    expected: SceneExpectation;
    mutationRevision: number;
    longTasks: Array<{ startTime: number; duration: number }>;
    initialCandidateAt?: number;
    initialSettledAt?: number;
    initialStableFrames: number;
    initialRevision: number;
    operation?: {
      expected: SceneExpectation;
      startAt?: number;
      settledAt?: number;
      candidateAt?: number;
      stableFrames: number;
      revision: number;
    };
  };
};

type SceneExpectation = {
  nodes: number;
  edges: number;
  edgeAriaIncludes?: string;
};

test.describe("P1-46 production-browser performance", () => {
  test("document body受領からpizza Sceneのpaint settleまでp95 300ms以下", async ({ page }) => {
    test.setTimeout(300_000);
    const consoleErrors = captureConsoleErrors(page);
    await installBrowserPerformanceProbe(page, PIZZA_NODE_COUNT, PIZZA_EDGE_COUNT);
    const cdp = await enableBrowserMetrics(page);

    const samples: InitialSceneSample[] = [];
    for (let iteration = 0; iteration <= SAMPLE_COUNT; iteration += 1) {
      const before = await browserMetrics(cdp);
      if (iteration === 0) await page.goto("/");
      else await page.reload();
      await waitForInitialScene(page);
      const after = await browserMetrics(cdp);
      const sample = await collectInitialSceneSample(page, metricDelta(before, after));
      if (iteration > 0) samples.push(sample);
    }

    reportSamples("initial-pizza-body-to-settled", samples, INITIAL_SCENE_BUDGET_MS);
    expect(samples).toHaveLength(SAMPLE_COUNT);
    expect(percentile95(samples.map((sample) => sample.durationMs)))
      .toBeLessThanOrEqual(INITIAL_SCENE_BUDGET_MS);
    expect(Math.max(...samples.map((sample) => sample.longestTaskMs)))
      .toBeLessThanOrEqual(INITIAL_SCENE_BUDGET_MS);
    expect(consoleErrors).toEqual([]);
  });

  test("relation addは20 warm後のbrowser settled p95が150ms以下", async ({ page }) => {
    test.setTimeout(600_000);
    const consoleErrors = captureConsoleErrors(page);
    await installBrowserPerformanceProbe(page, PIZZA_NODE_COUNT, PIZZA_EDGE_COUNT);
    await openPizzaSample(page);
    const cdp = await enableBrowserMetrics(page);
    const samples: BrowserPhaseSample[] = [];

    for (let iteration = 0; iteration < WARMUP_COUNT + SAMPLE_COUNT; iteration += 1) {
      const create = await stageRelationAddition(page);
      const sample = await measureClickOperation(
        page,
        cdp,
        create,
        {
          nodes: PIZZA_NODE_COUNT,
          edges: PIZZA_EDGE_COUNT + 1,
          edgeAriaIncludes: "おなかがすいたから注文完了へのseeAlso",
        },
      );
      await expect(page.locator(".iriograph-edge-group")).toHaveCount(PIZZA_EDGE_COUNT + 1);
      if (iteration >= WARMUP_COUNT) samples.push(sample);

      await page.locator('button[title="Undo (Ctrl/Cmd+Z)"]').click();
      await expect(page.locator(".iriograph-edge-group")).toHaveCount(PIZZA_EDGE_COUNT);
      await expect(pizzaEdge(page, "おなかがすいた", "注文完了")).toHaveCount(0);
      await waitForStableFrames(page, 2);
    }

    assertRelationSamples("relation-add", samples);
    expect(consoleErrors).toEqual([]);
  });

  test("predicate changeは20 warm後のbrowser settled p95が150ms以下", async ({ page }) => {
    test.setTimeout(600_000);
    const consoleErrors = captureConsoleErrors(page);
    await installBrowserPerformanceProbe(page, PIZZA_NODE_COUNT, PIZZA_EDGE_COUNT);
    await openPizzaSample(page);
    const cdp = await enableBrowserMetrics(page);
    const samples: BrowserPhaseSample[] = [];
    const predicateLabels = [
      "A（関連情報を参照）B",
      "A（次の工程）B",
    ] as const;

    for (let iteration = 0; iteration < WARMUP_COUNT + SAMPLE_COUNT; iteration += 1) {
      const edge = pizzaEdge(page, "おなかがすいた", "ピザを選ぶ");
      await edge.click();
      const inspector = page.locator(".iriograph-inspector");
      const wizard = inspector.locator(".structured-wizard");
      const relationChangeEntry = wizard.getByRole("button", { name: /^関係を変更する/u });
      if (await relationChangeEntry.isVisible()) {
        await relationChangeEntry.click();
        await wizard.getByRole("button", { name: "関係の意味を変更", exact: true }).click();
      } else {
        await inspector.getByRole("button", { name: "関係の意味を編集" }).click();
      }
      const predicate = inspector.locator('.iriograph-intent-fields label:has-text("関係") select');
      const predicateValue = await predicate.locator("option")
        .filter({ hasText: predicateLabels[iteration % predicateLabels.length]! })
        .getAttribute("value");
      if (!predicateValue) throw new Error("predicate option is unavailable");
      await predicate.selectOption(predicateValue);
      const update = inspector.getByRole("button", { name: "関係を更新" });
      const sample = await measureClickOperation(
        page,
        cdp,
        update,
        {
          nodes: PIZZA_NODE_COUNT,
          edges: PIZZA_EDGE_COUNT,
          edgeAriaIncludes: `おなかがすいたからピザを選ぶへの${iteration % predicateLabels.length === 0 ? "seeAlso" : "次の工程"}`,
        },
      );
      await expect(pizzaEdge(page, "おなかがすいた", "ピザを選ぶ")).toHaveCount(1);
      if (iteration >= WARMUP_COUNT) samples.push(sample);
    }

    assertRelationSamples("predicate-change", samples);
    expect(consoleErrors).toEqual([]);
  });

  test("endpoint changeは20 warm後のbrowser settled p95が150ms以下", async ({ page }) => {
    test.setTimeout(600_000);
    const consoleErrors = captureConsoleErrors(page);
    await installBrowserPerformanceProbe(page, PIZZA_NODE_COUNT, PIZZA_EDGE_COUNT);
    await openPizzaSample(page);
    const cdp = await enableBrowserMetrics(page);
    const samples: BrowserPhaseSample[] = [];
    const targetLabels = ["問い合わせる", "ピザを選ぶ"] as const;
    let currentTarget = "ピザを選ぶ";

    for (let iteration = 0; iteration < WARMUP_COUNT + SAMPLE_COUNT; iteration += 1) {
      const edge = pizzaEdge(page, "おなかがすいた", currentTarget);
      await clickEdgeOnVisiblePath(page, edge);
      const targetHandle = page.locator(".iriograph-endpoint-anchors.semantic circle.target");
      const nextTargetLabel = targetLabels[iteration % targetLabels.length]!;
      const nextTarget = page.locator(".iriograph-scene-node").filter({ hasText: nextTargetLabel });
      const handleBox = await requiredBox(targetHandle, "semantic target endpoint");
      const targetBox = await requiredBox(nextTarget, "semantic target node");
      const before = await browserMetrics(cdp);
      await armWindowOperation(page, "pointerup", {
        nodes: PIZZA_NODE_COUNT,
        edges: PIZZA_EDGE_COUNT,
        edgeAriaIncludes: `おなかがすいたから${nextTargetLabel}への`,
      });
      await dispatchPointerDrag(
        page,
        targetHandle,
        handleBox,
        targetBox.x + targetBox.width / 2 - (handleBox.x + handleBox.width / 2),
        targetBox.y + targetBox.height / 2 - (handleBox.y + handleBox.height / 2),
      );
      const sample = await finishOperation(page, cdp, before);
      await expect(pizzaEdge(page, "おなかがすいた", nextTargetLabel)).toHaveCount(1);
      currentTarget = nextTargetLabel;
      if (iteration >= WARMUP_COUNT) samples.push(sample);
    }

    assertRelationSamples("endpoint-change", samples);
    expect(consoleErrors).toEqual([]);
  });
});

async function installBrowserPerformanceProbe(
  page: Page,
  nodes: number,
  edges: number,
): Promise<void> {
  await page.addInitScript(({ expectedNodes, expectedEdges }) => {
    const host = window as PerformanceWindow;
    const state: NonNullable<PerformanceWindow["__iriographBrowserPerformance"]> = {
      expected: { nodes: expectedNodes, edges: expectedEdges },
      mutationRevision: 0,
      longTasks: [],
      initialStableFrames: 0,
      initialRevision: -1,
    };
    host.__iriographBrowserPerformance = state;

    try {
      new PerformanceObserver((entries) => {
        for (const entry of entries.getEntries()) {
          state.longTasks.push({ startTime: entry.startTime, duration: entry.duration });
        }
      }).observe({ type: "longtask", buffered: true });
    } catch {
      // Long Tasks are a Chromium capability. An empty array remains observable
      // on engines that do not expose it; this suite itself is Chromium-only.
    }

    const observeDocument = (): void => {
      if (!document.documentElement) return;
      new MutationObserver(() => {
        state.mutationRevision += 1;
      }).observe(document.documentElement, {
        attributes: true,
        childList: true,
        characterData: true,
        subtree: true,
      });
    };
    if (document.documentElement) observeDocument();
    else document.addEventListener("DOMContentLoaded", observeDocument, { once: true });

    const sceneReady = (expected: SceneExpectation): boolean => {
      const viewport = document.querySelector(".iriograph-canvas-scroll");
      if (viewport?.getAttribute("aria-busy") !== "false") return false;
      if (document.querySelectorAll(".iriograph-scene-node").length !== expected.nodes) return false;
      if (document.querySelectorAll(".iriograph-edge-group").length !== expected.edges) return false;
      if (expected.edgeAriaIncludes && ![...document.querySelectorAll(".iriograph-edge-group")]
        .some((edge) => edge.getAttribute("aria-label")?.includes(expected.edgeAriaIncludes))) return false;
      return [...document.querySelectorAll<HTMLImageElement>(".iriograph-canvas-shell img")]
        .every((image) => image.complete && image.naturalWidth > 0);
    };

    const advance = (
      ready: boolean,
      now: number,
      target: {
        candidateAt?: number;
        settledAt?: number;
        stableFrames: number;
        revision: number;
      },
    ): void => {
      if (!ready) {
        target.candidateAt = undefined;
        target.stableFrames = 0;
        target.revision = state.mutationRevision;
        return;
      }
      if (target.candidateAt === undefined || target.revision !== state.mutationRevision) {
        target.candidateAt = now;
        target.stableFrames = 0;
        target.revision = state.mutationRevision;
        return;
      }
      target.stableFrames += 1;
      // The second rAF after the last DOM mutation means that one full browser
      // paint opportunity has elapsed, rather than merely observing Vue state.
      if (target.stableFrames >= 2) target.settledAt = now;
    };

    const sample = (now: number): void => {
      if (state.initialSettledAt === undefined) {
        const target = {
          candidateAt: state.initialCandidateAt,
          settledAt: state.initialSettledAt,
          stableFrames: state.initialStableFrames,
          revision: state.initialRevision,
        };
        advance(sceneReady(state.expected), now, target);
        state.initialCandidateAt = target.candidateAt;
        state.initialSettledAt = target.settledAt;
        state.initialStableFrames = target.stableFrames;
        state.initialRevision = target.revision;
      }
      const operation = state.operation;
      if (operation?.startAt !== undefined && operation.settledAt === undefined) {
        advance(sceneReady(operation.expected), now, operation);
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }, { expectedNodes: nodes, expectedEdges: edges });
}

async function openPizzaSample(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.locator(".document-heading")).toContainText("pizza-order-delivery");
  await expect(page.locator(".iriograph-scene-node")).toHaveCount(PIZZA_NODE_COUNT, {
    timeout: 120_000,
  });
  await expect(page.locator(".iriograph-edge-group")).toHaveCount(PIZZA_EDGE_COUNT);
  await expect(page.locator(".iriograph-canvas-scroll")).toHaveAttribute("aria-busy", "false");
  await waitForStableFrames(page, 2);
}

async function waitForInitialScene(page: Page): Promise<void> {
  await page.waitForFunction(() => (
    (window as PerformanceWindow).__iriographBrowserPerformance?.initialSettledAt !== undefined
  ), undefined, { timeout: 120_000 });
}

async function collectInitialSceneSample(
  page: Page,
  browserPhases: BrowserMetricSnapshot,
): Promise<InitialSceneSample> {
  return page.evaluate((phases) => {
    const state = (window as PerformanceWindow).__iriographBrowserPerformance;
    const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    if (!state?.initialSettledAt || !navigation) throw new Error("initial Scene timing is unavailable");
    const startAt = navigation.responseEnd;
    const endAt = state.initialSettledAt;
    const longTasks = state.longTasks.filter((entry) => (
      entry.startTime < endAt && entry.startTime + entry.duration > startAt
    ));
    const workspaceResources = performance.getEntriesByType("resource")
      .filter((entry): entry is PerformanceResourceTiming => (
        entry instanceof PerformanceResourceTiming && new URL(entry.name).pathname.startsWith("/workspace/")
      ));
    const assetReadyAt = workspaceResources.reduce(
      (latest, entry) => Math.max(latest, entry.responseEnd),
      startAt,
    );
    const fcp = performance.getEntriesByName("first-contentful-paint", "paint")[0];
    return {
      durationMs: endAt - startAt,
      layoutMs: phases.LayoutDuration ?? 0,
      recalcStyleMs: phases.RecalcStyleDuration ?? 0,
      scriptMs: phases.ScriptDuration ?? 0,
      taskMs: phases.TaskDuration ?? 0,
      longTaskCount: longTasks.length,
      longTaskTotalMs: longTasks.reduce((total, entry) => total + entry.duration, 0),
      longestTaskMs: Math.max(0, ...longTasks.map((entry) => entry.duration)),
      assetReadyAfterBodyMs: Math.max(0, assetReadyAt - startAt),
      firstContentfulPaintAfterBodyMs: fcp ? fcp.startTime - startAt : null,
      stablePaintWindowMs: Math.max(0, endAt - (state.initialCandidateAt ?? endAt)),
      workspaceTransferBytes: workspaceResources.reduce(
        (total, entry) => total + entry.transferSize,
        0,
      ),
    };
  }, browserPhases);
}

async function stageRelationAddition(page: Page): Promise<Locator> {
  const inspector = page.locator(".iriograph-inspector");
  const wizard = inspector.locator(".structured-wizard");
  const source = page.locator(".iriograph-scene-node").filter({ hasText: "おなかがすいた" });
  const target = page.locator(".iriograph-scene-node").filter({ hasText: "注文完了" });
  await source.click();
  await wizard.getByRole("button", { name: /^関係を作る/u }).click();
  await wizard.getByRole("button", { name: /^線でつなぐ/u }).click();
  await expect(wizard.locator(".canvas-chip")).toContainText("おなかがすいた");
  await wizard.getByRole("button", { name: "次へ", exact: true }).click();
  await wizard.getByRole("button", { name: "Canvasから接続先を選ぶ", exact: true }).click();
  await target.click();
  await wizard.getByRole("button", { name: "次へ", exact: true }).click();
  await wizard.locator(".predicate-card")
    .filter({ hasText: "追加情報として別のresourceを案内します" })
    .click();
  const create = wizard.getByRole("button", { name: "次へ", exact: true });
  await expect(create).toBeEnabled();
  return create;
}

async function measureClickOperation(
  page: Page,
  cdp: CDPSession,
  control: Locator,
  expected: SceneExpectation,
): Promise<BrowserPhaseSample> {
  const before = await browserMetrics(cdp);
  await armElementOperation(control, "click", expected);
  await control.click();
  return finishOperation(page, cdp, before);
}

async function armElementOperation(
  control: Locator,
  eventName: string,
  expected: SceneExpectation,
): Promise<void> {
  await control.evaluate((element, value) => {
    const state = (window as PerformanceWindow).__iriographBrowserPerformance;
    if (!state) throw new Error("browser performance probe is unavailable");
    state.operation = {
      expected: value.expected,
      stableFrames: 0,
      revision: state.mutationRevision,
    };
    element.addEventListener(value.eventName, () => {
      const operation = state.operation;
      if (!operation) return;
      operation.startAt = performance.now();
      operation.candidateAt = undefined;
      operation.settledAt = undefined;
      operation.stableFrames = 0;
      operation.revision = state.mutationRevision;
    }, { capture: true, once: true });
  }, { eventName, expected });
}

async function armWindowOperation(
  page: Page,
  eventName: string,
  expected: SceneExpectation,
): Promise<void> {
  await page.evaluate((value) => {
    const state = (window as PerformanceWindow).__iriographBrowserPerformance;
    if (!state) throw new Error("browser performance probe is unavailable");
    state.operation = {
      expected: value.expected,
      stableFrames: 0,
      revision: state.mutationRevision,
    };
    window.addEventListener(value.eventName, () => {
      const operation = state.operation;
      if (!operation) return;
      operation.startAt = performance.now();
      operation.candidateAt = undefined;
      operation.settledAt = undefined;
      operation.stableFrames = 0;
      operation.revision = state.mutationRevision;
    }, { capture: true, once: true });
  }, { eventName, expected });
}

async function finishOperation(
  page: Page,
  cdp: CDPSession,
  before: BrowserMetricSnapshot,
): Promise<BrowserPhaseSample> {
  try {
    await page.waitForFunction(() => {
      const operation = (window as PerformanceWindow).__iriographBrowserPerformance?.operation;
      return operation?.startAt !== undefined && operation.settledAt !== undefined;
    }, undefined, { timeout: 5_000 });
  } catch (cause) {
    const diagnostic = await page.evaluate(() => ({
      operation: (window as PerformanceWindow).__iriographBrowserPerformance?.operation,
      busy: document.querySelector(".iriograph-canvas-scroll")?.getAttribute("aria-busy"),
      nodes: document.querySelectorAll(".iriograph-scene-node").length,
      edges: [...document.querySelectorAll(".iriograph-edge-group")]
        .map((edge) => edge.getAttribute("aria-label")),
    }));
    console.info(JSON.stringify({ benchmark: "operation-settle-timeout", diagnostic }));
    throw cause;
  }
  // Let PerformanceObserver deliver a LongTask entry which ended in the last frame.
  await page.evaluate(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
  const after = await browserMetrics(cdp);
  return page.evaluate((phases) => {
    const state = (window as PerformanceWindow).__iriographBrowserPerformance;
    const operation = state?.operation;
    if (!state || operation?.startAt === undefined || operation.settledAt === undefined) {
      throw new Error("operation timing is unavailable");
    }
    const longTasks = state.longTasks.filter((entry) => (
      entry.startTime < operation.settledAt
        && entry.startTime + entry.duration > operation.startAt!
    ));
    return {
      durationMs: operation.settledAt - operation.startAt,
      layoutMs: phases.LayoutDuration ?? 0,
      recalcStyleMs: phases.RecalcStyleDuration ?? 0,
      scriptMs: phases.ScriptDuration ?? 0,
      taskMs: phases.TaskDuration ?? 0,
      longTaskCount: longTasks.length,
      longTaskTotalMs: longTasks.reduce((total, entry) => total + entry.duration, 0),
      longestTaskMs: Math.max(0, ...longTasks.map((entry) => entry.duration)),
    };
  }, metricDelta(before, after));
}

async function enableBrowserMetrics(page: Page): Promise<CDPSession> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable", { timeDomain: "timeTicks" });
  return cdp;
}

async function browserMetrics(cdp: CDPSession): Promise<BrowserMetricSnapshot> {
  const response = await cdp.send("Performance.getMetrics") as {
    metrics: Array<{ name: string; value: number }>;
  };
  return Object.fromEntries(response.metrics.map((metric) => [metric.name, metric.value * 1_000]));
}

function metricDelta(
  before: BrowserMetricSnapshot,
  after: BrowserMetricSnapshot,
): BrowserMetricSnapshot {
  return Object.fromEntries(Object.entries(after).map(([name, value]) => {
    const previous = before[name] ?? 0;
    // Some Chromium counters are reset on full navigation; in that case the
    // post-navigation value itself is the measured interval.
    return [name, value >= previous ? value - previous : value];
  }));
}

function pizzaEdge(page: Page, sourceLabel: string, targetLabel: string): Locator {
  return page.locator(
    `.iriograph-edge-group[aria-label*="${sourceLabel}から${targetLabel}への"]`,
  );
}

async function clickEdgeOnVisiblePath(page: Page, edge: Locator): Promise<void> {
  const point = await edge.evaluate((group) => {
    const path = group.querySelector<SVGPathElement>(".iriograph-edge-hitarea");
    if (!path) throw new Error("edge does not contain a hit path");
    const matrix = path.getScreenCTM();
    if (!matrix) throw new Error("edge hit path does not have a screen transform");
    const midpoint = path.getPointAtLength(path.getTotalLength() / 2).matrixTransform(matrix);
    return { x: midpoint.x, y: midpoint.y };
  });
  await page.mouse.click(point.x, point.y);
}

async function waitForStableFrames(page: Page, count: number): Promise<void> {
  await page.evaluate(async (frameCount) => {
    for (let frame = 0; frame < frameCount; frame += 1) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
  }, count);
}

async function requiredBox(locator: Locator, label: string) {
  const box = await locator.boundingBox();
  if (!box) throw new Error(`${label} does not have a bounding box`);
  return box;
}

async function dispatchPointerDrag(
  page: Page,
  target: Locator,
  box: { x: number; y: number; width: number; height: number },
  deltaX: number,
  deltaY: number,
): Promise<void> {
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await target.dispatchEvent("pointerdown", { button: 0, clientX: x, clientY: y });
  await page.evaluate(({ clientX, clientY }) => {
    window.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX, clientY }));
    window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX, clientY }));
  }, { clientX: x + deltaX, clientY: y + deltaY });
}

function assertRelationSamples(name: string, samples: BrowserPhaseSample[]): void {
  reportSamples(name, samples, RELATION_TRANSACTION_BUDGET_MS);
  expect(samples).toHaveLength(SAMPLE_COUNT);
  expect(percentile95(samples.map((sample) => sample.durationMs)))
    .toBeLessThanOrEqual(RELATION_TRANSACTION_BUDGET_MS);
  expect(Math.max(...samples.map((sample) => sample.longestTaskMs)))
    .toBeLessThanOrEqual(RELATION_TRANSACTION_BUDGET_MS);
}

function reportSamples(
  benchmark: string,
  samples: BrowserPhaseSample[] | InitialSceneSample[],
  budgetMs: number,
): void {
  const values = <K extends keyof (BrowserPhaseSample & InitialSceneSample)>(key: K): number[] => (
    samples.flatMap((sample) => {
      const value = sample[key];
      return typeof value === "number" ? [value] : [];
    })
  );
  console.info(JSON.stringify({
    benchmark,
    sampleCount: samples.length,
    p95Ms: rounded(percentile95(values("durationMs"))),
    budgetMs,
    phasesP95Ms: {
      browserLayout: rounded(percentile95(values("layoutMs"))),
      styleRecalculation: rounded(percentile95(values("recalcStyleMs"))),
      script: rounded(percentile95(values("scriptMs"))),
      browserTask: rounded(percentile95(values("taskMs"))),
      workspaceAssetAfterBody: rounded(percentile95(values("assetReadyAfterBodyMs"))),
      firstContentfulPaintAfterBody: rounded(percentile95(values("firstContentfulPaintAfterBodyMs"))),
      stablePaintWindow: rounded(percentile95(values("stablePaintWindowMs"))),
    },
    longTasks: {
      totalCount: samples.reduce((total, sample) => total + sample.longTaskCount, 0),
      longestMs: rounded(Math.max(0, ...samples.map((sample) => sample.longestTaskMs))),
      p95TotalMs: rounded(percentile95(values("longTaskTotalMs"))),
    },
    workspaceTransferBytesP95: rounded(percentile95(values("workspaceTransferBytes"))),
  }));
}

function percentile95(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * .95) - 1)]!;
}

function rounded(value: number): number {
  return Math.round(value * 100) / 100;
}

function captureConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}
