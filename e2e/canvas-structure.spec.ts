import { expect, test, type Locator, type Page } from "@playwright/test";

async function openPurchaseSample(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: /purchase-approval\.iriograph/u }).click();
  await expect(page.locator(".document-heading")).toContainText("purchase-approval");
  await expect(page.locator(".iriograph-scene-node")).toHaveCount(8);
  await expect(page.locator(".iriograph-edge-group")).toHaveCount(5);
  await expect(page.locator(".iriograph-scene-container.sequence-group")).toHaveCount(3);
  await expect(page.locator(".iriograph-canvas-scroll")).toHaveAttribute("aria-busy", "false");
}

test("Seqと選択中object本体のsemantic layerを固定し操作handleだけを最前面にする", async ({ page }) => {
  const errors = collectBrowserErrors(page);
  await openPurchaseSample(page);

  const sequences = page.locator(".iriograph-scene-container.sequence-group");
  await expect(sequences).toHaveCount(3);
  await expect(page.locator(".iriograph-sequence-badges span")).toHaveCount(8);
  await expect(sequences.locator(".iriograph-container-header"))
    .toHaveText(["購入申請フロー", "承認", "差戻し"]);

  const edges = page.locator(".iriograph-edge-group");
  await expect(edges).toHaveCount(5);
  await expect(edges.filter({ hasText: "購入申請フロー" })).toHaveCount(0);
  await expect(page.getByRole("option", { name: /承認？から承認へのedge/ })).toHaveCount(1);
  await expect(page.locator(".iriograph-edge-arrow-overlay")).toHaveCount(0);

  const baseLayers = await semanticLayerValues(page);
  expect(baseLayers.region).toBeLessThan(baseLayers.edge);
  expect(baseLayers.sequence).toBeLessThan(baseLayers.edge);
  expect(baseLayers.edge).toBeLessThan(baseLayers.node);

  const region = page.locator(".iriograph-scene-region").first();
  await selectGeometryElement(page, region);
  await expect(region).toHaveClass(/interaction-front/u);
  const selectedRegionLayer = Number(await region.evaluate((element) => getComputedStyle(element).zIndex));
  expect(selectedRegionLayer).toBeLessThan(baseLayers.edge);
  const handles = page.locator(".iriograph-transient-resize-layer .iriograph-resize-handle");
  await expect(handles).toHaveCount(8);
  expect(Number(await handles.first().evaluate((element) => getComputedStyle(element.parentElement!).zIndex)))
    .toBeGreaterThan(baseLayers.node);
  await expect(region.locator(".iriograph-resize-handle")).toHaveCount(0);

  const approval = sequences.filter({ hasText: "承認" }).first();
  await selectGeometryElement(page, approval);
  await expect(approval).toHaveClass(/interaction-front/u);
  expect(Number(await approval.evaluate((element) => getComputedStyle(element).zIndex)))
    .toBeLessThan(baseLayers.edge);
  await expect(handles).toHaveCount(8);
  expect(errors).toEqual([]);
});

test("800px hostでもgridとCanvasを見切らずsidebar折畳み・scroll・pan・auto-panで到達する", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 900 });
  const errors = collectBrowserErrors(page);
  await openPurchaseSample(page);

  const documentWidth = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(documentWidth.scroll).toBe(documentWidth.client);

  const grid = page.locator(".iriograph-canvas-grid");
  await expect(grid).toBeVisible();
  await expect(grid).not.toHaveCSS("background-image", "none");
  await expect(grid).toHaveCSS("pointer-events", "none");
  const layout = page.locator(".iriograph-editor-layout");
  expect(await layout.evaluate((element) => element.scrollWidth)).toBeGreaterThan(
    await layout.evaluate((element) => element.clientWidth),
  );
  await expect(layout).toHaveCSS("overflow-x", "auto");

  await page.locator(".iriograph-left-sidebar-toggle").click();
  await page.locator(".iriograph-right-sidebar-toggle").click();
  const main = page.locator(".iriograph-main-surface");
  await expect.poll(async () => (await requiredBox(main)).width).toBeGreaterThan(580);
  await expect(page.locator(".iriograph-diagram-canvas")).toHaveCSS("overflow", "visible");

  await page.getByRole("button", { name: "全体を表示" }).click();
  for (let index = 0; index < 3; index += 1) {
    await page.getByRole("button", { name: "拡大" }).click();
  }
  const viewport = page.locator(".iriograph-canvas-scroll");
  expect(await viewport.evaluate((element) => element.scrollWidth)).toBeGreaterThan(
    await viewport.evaluate((element) => element.clientWidth),
  );
  const viewportBox = await requiredBox(viewport);
  const beforePan = await viewport.evaluate((element) => element.scrollLeft);
  await page.mouse.move(viewportBox.x + viewportBox.width / 2, viewportBox.y + viewportBox.height / 2);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(
    viewportBox.x + viewportBox.width / 2 - 120,
    viewportBox.y + viewportBox.height / 2,
    { steps: 4 },
  );
  await page.mouse.up({ button: "middle" });
  expect(await viewport.evaluate((element) => element.scrollLeft)).toBeGreaterThan(beforePan);

  await viewport.evaluate((element) => {
    element.scrollLeft = 0;
    element.dispatchEvent(new Event("scroll"));
  });
  const startNode = page.locator(".iriograph-scene-node").filter({ hasText: "開始" });
  const startBox = await requiredBox(startNode);
  await page.mouse.move(startBox.x + startBox.width / 2, startBox.y + startBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(viewportBox.x + viewportBox.width - 2, startBox.y + startBox.height / 2, {
    steps: 5,
  });
  expect(await viewport.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  await page.mouse.up();
  expect(errors).toEqual([]);
});

async function semanticLayerValues(page: Page): Promise<{
  region: number;
  sequence: number;
  edge: number;
  node: number;
}> {
  return page.evaluate(() => {
    const z = (selector: string): number => Number(getComputedStyle(
      document.querySelector(selector)!,
    ).zIndex);
    return {
      region: z(".iriograph-scene-region"),
      sequence: z(".iriograph-scene-container.sequence-group"),
      edge: z(".iriograph-edge-layer"),
      node: z(".iriograph-scene-node"),
    };
  });
}

async function selectGeometryElement(page: Page, locator: Locator): Promise<void> {
  const box = await requiredBox(locator);
  await locator.dispatchEvent("pointerdown", {
    button: 0,
    clientX: box.x + 2,
    clientY: box.y + 2,
  });
  await page.evaluate(({ x, y }) => window.dispatchEvent(new PointerEvent("pointerup", {
    bubbles: true,
    button: 0,
    clientX: x,
    clientY: y,
  })), { x: box.x + 2, y: box.y + 2 });
}

async function requiredBox(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("Required browser audit target is not visible.");
  return box;
}

function collectBrowserErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("requestfailed", (request) => {
    errors.push(`${request.method()} ${request.url()}: ${request.failure()?.errorText ?? "failed"}`);
  });
  return errors;
}
