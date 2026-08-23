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
  await expect.poll(async () => Math.abs(await numericStyle(node, "left") - initialLeft))
    .toBeGreaterThan(0);
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
  await expect.poll(async () => Math.abs(
    Number(await waypoint.getAttribute("cx")) - (initialWaypointX + 36),
  )).toBeLessThanOrEqual(1);

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

test("multi-select、group drag、snap、整列、等間隔をpresentation transactionとして扱う", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  await page.goto("/");
  const nodes = page.locator(".iriograph-scene-node");
  await expect(nodes).toHaveCount(8);
  await page.getByRole("button", { name: /Turtle/ }).click();
  const semanticSource = await page.getByLabel("Turtle source").inputValue();
  await page.getByRole("button", { name: /Diagram/ }).click();

  const indices = await nodes.evaluateAll((elements) => {
    const groups = new Map<string, number[]>();
    elements.forEach((element, index) => {
      const parent = (element as HTMLElement).dataset.parentElementId ?? "";
      const group = groups.get(parent) ?? [];
      group.push(index);
      groups.set(parent, group);
    });
    return [...groups.entries()]
      .filter(([parent, group]) => parent && group.length >= 3)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)[0]?.[1].slice(0, 3) ?? [];
  });
  expect(indices).toHaveLength(3);
  const selectedNodes = indices.map((index) => nodes.nth(index));

  await selectedNodes[0]!.click();
  await selectedNodes[1]!.click({ modifiers: ["Control"] });
  await selectedNodes[2]!.click({ modifiers: ["Control"] });
  await expect(page.locator(".iriograph-scene-node.selected")).toHaveCount(3);
  await expect(page.getByText("3 selected", { exact: true }).first()).toBeVisible();

  const targetSnap = page.getByRole("button", { name: "要素snap" });
  if (await targetSnap.getAttribute("aria-pressed") === "true") await targetSnap.click();
  const before = await Promise.all(selectedNodes.map(async (selected) => ({
    left: await numericStyle(selected, "left"),
    top: await numericStyle(selected, "top"),
  })));
  await dispatchPointerDrag(
    page,
    selectedNodes[0]!,
    await requiredBox(selectedNodes[0]!, "selected group anchor"),
    17,
    13,
  );
  await expect.poll(() => numericStyle(selectedNodes[0]!, "left"))
    .not.toBe(before[0]!.left);
  const moved = await Promise.all(selectedNodes.map(async (selected) => ({
    left: await numericStyle(selected, "left"),
    top: await numericStyle(selected, "top"),
  })));
  const delta = {
    x: moved[0]!.left - before[0]!.left,
    y: moved[0]!.top - before[0]!.top,
  };
  expect(delta.x).not.toBe(0);
  expect(Math.min(...moved.map((geometry) => geometry.left)) % 8).toBeCloseTo(0, 5);
  for (let index = 1; index < moved.length; index += 1) {
    expect(moved[index]!.left - before[index]!.left).toBeCloseTo(delta.x, 5);
    expect(moved[index]!.top - before[index]!.top).toBeCloseTo(delta.y, 5);
  }

  await page.locator('button[title="Undo (Ctrl/Cmd+Z)"]').click();
  for (let index = 0; index < before.length; index += 1) {
    await expect.poll(() => numericStyle(selectedNodes[index]!, "left"))
      .toBeCloseTo(before[index]!.left, 0);
    await expect.poll(() => numericStyle(selectedNodes[index]!, "top"))
      .toBeCloseTo(before[index]!.top, 0);
  }

  await page.getByRole("button", { name: "左揃え" }).click();
  await expect.poll(async () => new Set(await Promise.all(
    selectedNodes.map((selected) => numericStyle(selected, "left")),
  )).size).toBe(1);
  await page.locator('button[title="Undo (Ctrl/Cmd+Z)"]').click();
  for (let index = 0; index < before.length; index += 1) {
    await expect.poll(() => numericStyle(selectedNodes[index]!, "left"))
      .toBeCloseTo(before[index]!.left, 0);
  }

  const beforeDistribution = await Promise.all(selectedNodes.map(async (selected, index) => ({
    index,
    x: await numericStyle(selected, "left"),
    width: await numericStyle(selected, "width"),
  })));
  beforeDistribution.sort((left, right) => left.x - right.x);
  const distributionSpan = beforeDistribution[2]!.x + beforeDistribution[2]!.width
    - beforeDistribution[0]!.x;
  const distributionGap = (
    distributionSpan - beforeDistribution.reduce((sum, geometry) => sum + geometry.width, 0)
  ) / 2;
  const expectedMiddleX = beforeDistribution[0]!.x
    + beforeDistribution[0]!.width
    + distributionGap;
  await page.getByRole("button", { name: "水平方向に等間隔" }).click();
  await expect.poll(() => numericStyle(
    selectedNodes[beforeDistribution[1]!.index]!,
    "left",
  )).toBeCloseTo(expectedMiddleX, 0);

  await page.getByRole("button", { name: /Turtle/ }).click();
  await expect(page.getByLabel("Turtle source")).toHaveValue(semanticSource);
  expect(consoleErrors).toEqual([]);
});

test("parallel/self-loopを個別選択しwaypointとlabel routingを編集・resetする", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  await page.goto("/");
  const parallel = page.getByRole("button", { name: /内容を審査から承認ポリシーへの/ });
  await expect(parallel).toHaveCount(2);
  const parallelPaths = await parallel.locator(".iriograph-edge-path").evaluateAll(
    (paths) => paths.map((path) => path.getAttribute("d")),
  );
  expect(new Set(parallelPaths).size).toBe(2);
  await parallel.nth(0).focus();
  await page.keyboard.press("Enter");
  await expect(parallel.nth(0)).toHaveAttribute("aria-selected", "true");
  await parallel.nth(1).focus();
  await page.keyboard.press("Enter");
  await expect(parallel.nth(1)).toHaveAttribute("aria-selected", "true");
  await expect(parallel.nth(0)).toHaveAttribute("aria-selected", "false");

  const selfLoop = page.getByRole("button", { name: /内容を審査から内容を審査へのretry/ });
  await expect(selfLoop).toHaveCount(1);
  await selfLoop.focus();
  await page.keyboard.press("Enter");
  await expect(selfLoop).toHaveAttribute("aria-selected", "true");
  const turtleBefore = await readTurtle(page);

  const derivedHandleCount = await page.locator(".iriograph-waypoints circle").count();
  expect(derivedHandleCount).toBeGreaterThan(0);
  await selfLoop.dispatchEvent("dblclick", { clientX: 400, clientY: 300 });
  await expect.poll(() => page.locator(".iriograph-waypoint-row").count())
    .toBe(derivedHandleCount + 1);

  const waypoint = page.locator(".iriograph-waypoints circle").first();
  const waypointX = Number(await waypoint.getAttribute("cx"));
  await dispatchPointerDrag(page, waypoint, await requiredBox(waypoint, "self-loop waypoint"), 28, 16);
  await expect.poll(async () => Math.abs(Number(
    await page.locator(".iriograph-waypoints circle").first().getAttribute("cx"),
  ) - waypointX)).toBeGreaterThan(10);

  const label = selfLoop.locator(".iriograph-edge-label");
  await dispatchPointerDrag(page, label, await requiredBox(label, "self-loop label"), 24, -14);
  const labelInputs = page.locator(".iriograph-routing-inspector .iriograph-geometry-grid input");
  await expect.poll(async () => Math.abs(Number(await labelInputs.first().inputValue())))
    .toBeGreaterThan(10);
  await page.locator('button[title="Undo (Ctrl/Cmd+Z)"]').click();
  await expect(labelInputs.first()).toHaveValue("0");

  await dispatchPointerDrag(page, label, await requiredBox(label, "self-loop label"), 18, 10);
  await page.getByRole("button", { name: "Label位置をリセット" }).click();
  await expect(labelInputs.first()).toHaveValue("0");
  await expect(labelInputs.nth(1)).toHaveValue("0");

  while (await page.locator(".iriograph-waypoint-row").count()) {
    await page.locator('.iriograph-waypoint-row button[aria-label*="を削除"]').first().click();
  }
  await expect(page.getByText("automatic", { exact: true })).toBeVisible();
  await selfLoop.focus();
  await page.keyboard.press("Delete");
  await expect(page.getByText("automatic", { exact: true })).toBeVisible();
  expect(await readTurtle(page)).toBe(turtleBefore);

  await page.getByRole("button", { name: /Document/ }).click();
  await expect(page.locator(".iriograph-source-panel pre")).not.toContainText('"waypoints": []');
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

async function readTurtle(page: Page): Promise<string> {
  await page.getByRole("button", { name: /Turtle/ }).click();
  const source = await page.getByLabel("Turtle source").inputValue();
  await page.getByRole("button", { name: /Diagram/ }).click();
  return source;
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
