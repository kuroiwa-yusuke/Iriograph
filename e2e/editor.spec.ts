import { expect, test, type Locator, type Page } from "@playwright/test";

test("editorのpointer操作、history、Turtle rollback、保存flushがbrowserで連携する", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  await page.goto("/");
  await expect(page.locator(".iriograph-scene-node")).toHaveCount(8);

  const node = page.locator(".iriograph-scene-node").first();
  const initialNodeBox = await requiredBox(node, "node");
  const initialLeft = await numericStyle(node, "left");
  await dispatchPointerDrag(page, node, initialNodeBox, -42, 26);
  await expect.poll(() => numericStyle(node, "left")).toBeCloseTo(initialLeft - 42, 0);
  const draggedLeft = await numericStyle(node, "left");

  await page.locator('button[title="Undo (Ctrl/Cmd+Z)"]').click();
  await expect.poll(() => numericStyle(node, "left")).toBeCloseTo(initialLeft, 0);
  await page.locator('button[title="Redo (Ctrl/Cmd+Y)"]').click();
  await expect.poll(() => numericStyle(node, "left")).toBeCloseTo(draggedLeft, 0);

  const handle = node.locator(".iriograph-resize-handle");
  const initialWidth = await numericStyle(node, "width");
  await dispatchPointerDrag(page, handle, await requiredBox(handle, "resize handle"), 30, 18);
  await expect.poll(() => numericStyle(node, "width")).toBeCloseTo(initialWidth + 30, 0);

  await page.locator(".iriograph-edge-group").first().dispatchEvent("click");
  const waypoint = page.locator(".iriograph-waypoints circle").first();
  const initialWaypointX = Number(await waypoint.getAttribute("cx"));
  await dispatchPointerDrag(page, waypoint, await requiredBox(waypoint, "waypoint"), 36, 20);
  await expect.poll(async () => Number(await waypoint.getAttribute("cx")))
    .toBeCloseTo(initialWaypointX + 36, 0);

  await page.getByRole("button", { name: /Turtle/ }).click();
  const textarea = page.getByLabel("Turtle source");
  const acceptedSource = `${await textarea.inputValue()}\n<urn:iriograph:e2e:new> <http://www.w3.org/2000/01/rdf-schema#label> "E2E New" .\n`;
  await textarea.fill(acceptedSource);
  await page.locator(".iriograph-editor-header button").click();
  await expect(page.getByText("browser working copyを保存しました")).toBeVisible();
  await expect(textarea).toHaveValue(acceptedSource);

  await textarea.fill("@prefix : <urn:iriograph:e2e:> .\n:a :rel .");
  await page.getByRole("button", { name: "検証して適用" }).click();
  await expect(page.locator(".iriograph-diagnostics .error")).toBeVisible();
  await page.getByRole("button", { name: /Diagram/ }).click();
  await expect(page.locator(".iriograph-scene-node")).toHaveCount(9);

  expect(consoleErrors).toEqual([]);
});

test("viewport navigationをmouse/keyboard、fit、minimap、selection revealでsession内に保つ", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  await page.goto("/");
  await expect(page.locator(".iriograph-scene-node")).toHaveCount(8);
  const viewport = page.locator(".iriograph-canvas-scroll");

  await viewport.focus();
  await page.keyboard.press("ArrowRight");
  await expect.poll(async () => (await scrollPosition(viewport)).left).toBe(64);

  const grid = page.locator(".iriograph-canvas-grid");
  await dispatchPointerDrag(page, grid, await requiredBox(grid, "canvas grid"), -48, -32);
  await expect.poll(async () => (await scrollPosition(viewport)).left).toBeGreaterThan(100);

  await page.locator(".iriograph-minimap svg").click({ position: { x: 150, y: 94 } });
  const minimapPosition = await scrollPosition(viewport);
  expect(minimapPosition.left).toBeGreaterThan(300);

  await page.locator(".iriograph-element-list button").filter({ hasNotText: "container" }).first().click();
  const viewportBox = await requiredBox(viewport, "viewport");
  const selectedBox = await requiredBox(page.locator(".iriograph-scene-node.selected"), "selected node");
  expect(selectedBox.x + selectedBox.width).toBeGreaterThan(viewportBox.x);
  expect(selectedBox.x).toBeLessThan(viewportBox.x + viewportBox.width);
  expect(selectedBox.y + selectedBox.height).toBeGreaterThan(viewportBox.y);
  expect(selectedBox.y).toBeLessThan(viewportBox.y + viewportBox.height);

  await page.getByRole("button", { name: "全体を表示" }).click();
  await expect.poll(async () => Number.parseInt(
    await page.locator(".zoom-value").textContent() ?? "100",
    10,
  )).toBeLessThan(100);
  await expect(page.locator(".status-cluster .status-pill.neutral")).toContainText("保存済み");
  await expect(page.locator(".topbar .ghost-button").filter({ hasText: "保存" })).toBeDisabled();

  expect(consoleErrors).toEqual([]);
});

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

async function numericStyle(locator: Locator, property: string): Promise<number> {
  return locator.evaluate((element, name) => Number.parseFloat(
    window.getComputedStyle(element).getPropertyValue(name),
  ), property);
}

async function scrollPosition(locator: Locator): Promise<{ left: number; top: number }> {
  return locator.evaluate((element) => ({
    left: element.scrollLeft,
    top: element.scrollTop,
  }));
}
