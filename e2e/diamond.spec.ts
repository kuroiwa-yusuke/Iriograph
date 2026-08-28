import { expect, test, type Locator, type Page } from "@playwright/test";

const STORAGE_KEY = "iriograph.mock.workspace:models/pizza-order-delivery.iriograph";

const labels = {
  horizontalShort: "承認",
  horizontalLong: "承認条件を確認して次の処理を選択する",
  verticalShort: "確認",
  verticalLong: "問い合わせ内容を確認して対応方法を選択する",
} as const;

const diamondDocument = {
  schemaVersion: "1",
  kind: "iriograph.document",
  documentId: "diamond-browser-regression",
  semantic: {
    format: "text/turtle",
    baseIri: "urn:iriograph:diamond-browser:",
    authoringProfileRef: "urn:iriograph:authoring-profile:workflow-mock@1",
    source: [
      "@prefix : <urn:iriograph:diamond-browser:> .",
      "@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .",
      "",
      `:horizontal-short rdfs:label \"${labels.horizontalShort}\"@ja .`,
      `:horizontal-long rdfs:label \"${labels.horizontalLong}\"@ja .`,
      `:vertical-short rdfs:label \"${labels.verticalShort}\"@ja .`,
      `:vertical-long rdfs:label \"${labels.verticalLong}\"@ja .`,
      "",
    ].join("\n"),
  },
  imports: [
    { catalogRef: "urn:iriograph:catalog:workflow-classification-region@1" },
  ],
  views: [{
    viewId: "main",
    kind: "region",
    profileRef: "urn:iriograph:profile:rdf-rdfs:classification-region:1",
    layoutRef: "urn:iriograph:layout:hierarchical-lr:1",
    locale: "ja",
    overlay: {
      "diamond:horizontal-short": {
        semanticRef: "urn:iriograph:diamond-browser:horizontal-short",
        geometry: { x: 80, y: 80, width: 128, height: 128 },
        pinned: true,
        placement: "user",
        appearance: { templateRef: "urn:iriograph:template:gateway:1" },
      },
      "diamond:horizontal-long": {
        semanticRef: "urn:iriograph:diamond-browser:horizontal-long",
        geometry: { x: 268, y: 64, width: 208, height: 152 },
        pinned: true,
        placement: "user",
        appearance: {
          templateRef: "urn:iriograph:template:gateway:1",
          iconRef: "urn:iriograph:icon:lucide:badge-check:1",
        },
      },
      "diamond:vertical-short": {
        semanticRef: "urn:iriograph:diamond-browser:vertical-short",
        geometry: { x: 92, y: 284, width: 144, height: 192 },
        pinned: true,
        placement: "user",
        appearance: {
          templateRef: "urn:iriograph:template:gateway:1",
          iconRef: "urn:iriograph:icon:lucide:workflow:1",
          nodeLabelWritingDirection: "vertical-down",
        },
      },
      "diamond:vertical-long": {
        semanticRef: "urn:iriograph:diamond-browser:vertical-long",
        geometry: { x: 300, y: 264, width: 152, height: 224 },
        pinned: true,
        placement: "user",
        appearance: {
          templateRef: "urn:iriograph:template:gateway:1",
          nodeLabelWritingDirection: "vertical-down",
        },
      },
    },
  }],
} as const;

test("Diamond nodeを実Chromiumで方向・長さ・icon・resizeの組合せ表示する", async ({ page }) => {
  const browserErrors = collectBrowserErrors(page);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.addInitScript(({ key, document }) => {
    window.localStorage.setItem(key, JSON.stringify(document));
  }, { key: STORAGE_KEY, document: diamondDocument });

  await page.goto("/");
  await expect(page.locator(".document-heading")).toContainText("pizza-order-delivery");
  await expect(page.locator(".iriograph-canvas-scroll")).toHaveAttribute("aria-busy", "false");
  await expect(page.locator(".iriograph-scene-node")).toHaveCount(4);

  const horizontalShort = nodeByLabel(page, labels.horizontalShort);
  const horizontalLong = nodeByLabel(page, labels.horizontalLong);
  const verticalShort = nodeByLabel(page, labels.verticalShort);
  const verticalLong = nodeByLabel(page, labels.verticalLong);

  await expect(horizontalShort.locator(".iriograph-node-icon")).toHaveCount(0);
  await expect(horizontalLong.locator(".iriograph-node-icon")).toHaveAttribute(
    "src",
    /^data:image\/svg\+xml/u,
  );
  await expect(verticalShort.locator(".iriograph-node-icon")).toHaveAttribute(
    "src",
    /^data:image\/svg\+xml/u,
  );
  await expect(verticalLong.locator(".iriograph-node-icon")).toHaveCount(0);

  for (const node of [horizontalShort, horizontalLong]) {
    await assertDiamondNode(node, "horizontal");
  }
  for (const node of [verticalShort, verticalLong]) {
    await assertDiamondNode(node, "vertical");
  }

  await horizontalLong.click();
  const handles = page.locator(
    ".iriograph-transient-resize-layer .iriograph-resize-handle",
  );
  await expect(handles).toHaveCount(8);
  await assertAxisAlignedHandles(page, horizontalLong);

  const before = await requiredBox(horizontalLong, "diamond before resize");
  const southeast = page.locator(
    '.iriograph-transient-resize-layer .iriograph-resize-handle[data-handle="se"]',
  );
  await dragBy(page, southeast, 48, 32);
  await expect.poll(async () => (await requiredBox(horizontalLong, "diamond after resize")).width)
    .toBeGreaterThan(before.width + 40);
  await expect.poll(async () => (await requiredBox(horizontalLong, "diamond after resize")).height)
    .toBeGreaterThan(before.height + 24);

  await assertDiamondNode(horizontalLong, "horizontal");
  await assertAxisAlignedHandles(page, horizontalLong);
  await page.locator(".iriograph-canvas-scroll").screenshot({
    path: ".tmp/diamond-node-p1-45.png",
  });

  expect(browserErrors).toEqual([]);
});

function nodeByLabel(page: Page, label: string): Locator {
  return page.locator(".iriograph-scene-node").filter({
    has: page.locator(".iriograph-node-label").filter({
      hasText: new RegExp(`^${escapeRegExp(label)}$`, "u"),
    }),
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

async function assertDiamondNode(
  node: Locator,
  direction: "horizontal" | "vertical",
): Promise<void> {
  await expect(node).toHaveCount(1);
  await expect(node).toHaveClass(/shape-diamond/u);
  await expect(node.locator(".iriograph-node-diamond-surface polygon"))
    .toHaveAttribute("points", "50,1 99,50 50,99 1,50");
  await expect(node.locator(".iriograph-gateway-mark")).toHaveCount(1);

  const visual = await node.evaluate((element, expectedDirection) => {
    const root = element.getBoundingClientRect();
    const surface = element.querySelector<SVGElement>(".iriograph-node-diamond-surface")!
      .getBoundingClientRect();
    const content = element.querySelector<HTMLElement>(".iriograph-node-content")!
      .getBoundingClientRect();
    const text = element.querySelector<HTMLElement>(".iriograph-node-text")!;
    const textBox = text.getBoundingClientRect();
    const marker = element.querySelector<HTMLElement>(".iriograph-gateway-mark")!
      .getBoundingClientRect();
    const icon = element.querySelector<HTMLElement>(".iriograph-node-icon")?.getBoundingClientRect();
    const rootStyle = getComputedStyle(element);
    const textStyle = getComputedStyle(text);
    const corners = [
      [content.left, content.top],
      [content.right, content.top],
      [content.right, content.bottom],
      [content.left, content.bottom],
    ];
    const diamondCornerMetrics = corners.map(([x, y]) => (
      Math.abs(x! - (root.left + root.width / 2)) / (root.width / 2)
      + Math.abs(y! - (root.top + root.height / 2)) / (root.height / 2)
    ));
    const overlapWidth = Math.max(0, Math.min(content.right, marker.right)
      - Math.max(content.left, marker.left));
    const overlapHeight = Math.max(0, Math.min(content.bottom, marker.bottom)
      - Math.max(content.top, marker.top));
    const boxWithinContent = (box: DOMRect | undefined) => !box || (
      box.left >= content.left - 1
      && box.right <= content.right + 1
      && box.top >= content.top - 1
      && box.bottom <= content.bottom + 1
    );
    return {
      directionClass: element.classList.contains(`label-direction-${expectedDirection}`),
      rootTransform: rootStyle.transform,
      writingMode: textStyle.writingMode,
      overflow: textStyle.overflow,
      surfaceDelta: {
        left: Math.abs(surface.left - root.left),
        top: Math.abs(surface.top - root.top),
        width: Math.abs(surface.width - root.width),
        height: Math.abs(surface.height - root.height),
      },
      maxDiamondCornerMetric: Math.max(...diamondCornerMetrics),
      markerContentOverlapArea: overlapWidth * overlapHeight,
      textWithinContent: boxWithinContent(textBox),
      iconWithinContent: boxWithinContent(icon),
      textAspect: textBox.width / textBox.height,
    };
  }, direction);

  expect(visual.directionClass).toBe(true);
  expect(visual.rootTransform).toBe("none");
  expect(visual.writingMode).toBe(direction === "vertical" ? "vertical-rl" : "horizontal-tb");
  expect(visual.overflow).toBe("hidden");
  expect(visual.surfaceDelta.left).toBeLessThanOrEqual(1);
  expect(visual.surfaceDelta.top).toBeLessThanOrEqual(1);
  expect(visual.surfaceDelta.width).toBeLessThanOrEqual(1);
  expect(visual.surfaceDelta.height).toBeLessThanOrEqual(1);
  expect(visual.maxDiamondCornerMetric).toBeLessThanOrEqual(0.92);
  expect(visual.markerContentOverlapArea).toBe(0);
  expect(visual.textWithinContent).toBe(true);
  expect(visual.iconWithinContent).toBe(true);
  if (direction === "vertical") expect(visual.textAspect).toBeLessThan(1);
  else expect(visual.textAspect).toBeGreaterThan(1);
}

async function assertAxisAlignedHandles(page: Page, node: Locator): Promise<void> {
  const nodeBox = await requiredBox(node, "selected diamond");
  const expected = {
    nw: { x: nodeBox.x, y: nodeBox.y },
    n: { x: nodeBox.x + nodeBox.width / 2, y: nodeBox.y },
    ne: { x: nodeBox.x + nodeBox.width, y: nodeBox.y },
    e: { x: nodeBox.x + nodeBox.width, y: nodeBox.y + nodeBox.height / 2 },
    se: { x: nodeBox.x + nodeBox.width, y: nodeBox.y + nodeBox.height },
    s: { x: nodeBox.x + nodeBox.width / 2, y: nodeBox.y + nodeBox.height },
    sw: { x: nodeBox.x, y: nodeBox.y + nodeBox.height },
    w: { x: nodeBox.x, y: nodeBox.y + nodeBox.height / 2 },
  } as const;

  for (const [handleName, point] of Object.entries(expected)) {
    const handle = page.locator(
      `.iriograph-transient-resize-layer .iriograph-resize-handle[data-handle="${handleName}"]`,
    );
    const box = await requiredBox(handle, `${handleName} resize handle`);
    expect(box.x + box.width / 2).toBeCloseTo(point.x, 0);
    expect(box.y + box.height / 2).toBeCloseTo(point.y, 0);
    const matrix = await handle.evaluate((element) => getComputedStyle(element).transform);
    const components = matrix.match(/^matrix\(([^)]+)\)$/u)?.[1]
      ?.split(",")
      .map((value) => Number.parseFloat(value));
    expect(components?.slice(0, 4)).toEqual([1, 0, 0, 1]);
  }
}

async function dragBy(page: Page, target: Locator, deltaX: number, deltaY: number): Promise<void> {
  const box = await requiredBox(target, "drag target");
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await target.dispatchEvent("pointerdown", { button: 0, clientX: x, clientY: y });
  await page.evaluate(({ clientX, clientY }) => {
    window.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX, clientY }));
    window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX, clientY }));
  }, { clientX: x + deltaX, clientY: y + deltaY });
}

async function requiredBox(locator: Locator, label: string) {
  const box = await locator.boundingBox();
  if (!box) throw new Error(`${label} does not have a bounding box`);
  return box;
}

function collectBrowserErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}
