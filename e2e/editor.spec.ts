import { expect, test, type Locator, type Page } from "@playwright/test";

const INITIAL_NODE_COUNT = 14;
const REGION_VIEW_NODE_COUNT = 12;

test("editorのpointer操作、history、Turtle rollback、保存flushがbrowserで連携する", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  await page.goto("/");
  await expect(page.locator(".iriograph-scene-node")).toHaveCount(INITIAL_NODE_COUNT);

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
  const acceptedSource = `${await textarea.inputValue()}\n<urn:iriograph:demo:e2e-new> <http://www.w3.org/2000/01/rdf-schema#label> "E2E New" .\n`;
  await textarea.fill(acceptedSource);
  await page.locator(".iriograph-editor-header button").click();
  await expect(page.getByText("browser working copyを保存しました")).toBeVisible();
  await expect(textarea).toHaveValue(acceptedSource);

  await textarea.fill("@prefix : <urn:iriograph:e2e:> .\n:a :rel .");
  await page.getByRole("button", { name: "検証して適用" }).click();
  await expect(page.locator(".iriograph-diagnostics .error")).toBeVisible();
  await page.getByRole("button", { name: /Diagram/ }).click();
  await expect(page.locator(".iriograph-scene-node")).toHaveCount(INITIAL_NODE_COUNT + 1);

  await page.getByRole("button", { name: /Turtle/ }).click();
  const domainInvalidSource = `${acceptedSource}\n<urn:iriograph:demo:g-01> <http://www.w3.org/2000/01/rdf-schema#member> <urn:iriograph:demo:e2e-invalid> .\n`;
  await textarea.fill(domainInvalidSource);
  await page.getByRole("button", { name: "検証して適用" }).click();
  const domainDiagnostic = page.locator(".iriograph-diagnostics .error")
    .filter({ hasText: "demo-visible-resource-label-required" });
  await expect(domainDiagnostic).toContainText("変更を適用できません");
  await domainDiagnostic.getByText("技術的な詳細").click();
  await expect(domainDiagnostic.getByText("demo-visible-resource-label-required")).toBeVisible();
  await page.getByRole("button", { name: "Source", exact: true }).click();
  await expect.poll(() => textarea.evaluate((element) => (
    (element as HTMLTextAreaElement).selectionStart
  ))).toBe(domainInvalidSource.indexOf("<urn:iriograph:demo:e2e-invalid>"));
  await page.getByRole("button", { name: /Diagram/ }).click();
  await expect(page.locator(".iriograph-scene-node")).toHaveCount(INITIAL_NODE_COUNT + 1);

  expect(consoleErrors).toEqual([]);
});

test("named view管理とtemporary hideをsemantic sourceから分離する", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  await page.goto("/");
  const viewSelect = page.getByLabel("Named view", { exact: true });
  await expect(viewSelect.locator("option")).toHaveCount(2);
  await expect(viewSelect).toHaveValue("main");
  const turtleBefore = await readTurtle(page);

  await page.locator(".iriograph-scene-node").first().click();
  await page.getByRole("button", { name: "一時非表示" }).click();
  await expect(page.locator(".iriograph-scene-node")).toHaveCount(INITIAL_NODE_COUNT - 1);
  await expect(page.getByRole("button", { name: /再表示/ })).toContainText("(1)");

  await viewSelect.selectOption("regions");
  await expect(viewSelect).toHaveValue("regions");
  await expect(page.locator(".iriograph-scene-node")).toHaveCount(REGION_VIEW_NODE_COUNT);
  await expect(page.locator(".iriograph-scene-region")).toHaveCount(5);
  await expect(page.locator(".iriograph-view-summary")).toContainText("5 areas");

  await page.locator(".iriograph-view-actions").getByRole("button", { name: "複製" }).click();
  await expect(viewSelect).toHaveValue("regions-copy");
  await expect(viewSelect.locator("option")).toHaveCount(3);

  await page.locator(".iriograph-view-actions").getByRole("button", { name: "設定" }).click();
  await expect(page.locator('.iriograph-view-dialog input[readonly]')).toHaveValue("regions-copy");
  await page.locator('.iriograph-view-dialog input[placeholder="ja"]').fill("en-US");
  await page.locator('.iriograph-view-dialog button[type="submit"]').click();
  await expect(page.locator(".iriograph-view-dialog")).toHaveCount(0);

  await page.locator(".iriograph-view-actions").getByRole("button", { name: "Overlay reset" }).click();
  await expect(viewSelect).toHaveValue("regions-copy");
  await page.locator(".iriograph-view-actions").getByRole("button", { name: "削除" }).click();
  await expect(viewSelect.locator("option")).toHaveCount(2);
  await expect(viewSelect).toHaveValue("main");
  await expect(page.locator(".iriograph-scene-node")).toHaveCount(INITIAL_NODE_COUNT - 1);

  const addViewButton = page.locator(".iriograph-view-actions").getByRole("button", { name: "追加" });
  await addViewButton.click();
  await expect(page.locator(".iriograph-view-dialog")).toBeVisible();
  await expect(page.locator('.iriograph-view-dialog input[required]').first()).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.locator(".iriograph-view-dialog")).toHaveCount(0);
  await expect(addViewButton).toBeFocused();
  await addViewButton.click();
  await page.locator('.iriograph-view-dialog input:not([readonly])').first().fill("audit");
  await page.locator('.iriograph-view-dialog button[type="submit"]').click();
  await expect(viewSelect).toHaveValue("audit");
  await expect(viewSelect.locator("option")).toHaveCount(3);

  await expect.poll(() => readTurtle(page)).toBe(turtleBefore);
  expect(consoleErrors).toEqual([]);
});

test("structured semantic authoringをPreviewして位置とTurtleをatomicに適用・undoする", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  await page.goto("/");
  await expect(page.locator(".iriograph-scene-node")).toHaveCount(INITIAL_NODE_COUNT);
  await page.getByLabel("Resource label").fill("E2E semantic task");
  await page.getByRole("button", { name: "図の上で位置を指定" }).click();
  const grid = page.locator(".iriograph-canvas-grid");
  await dispatchPointerClick(
    page,
    grid,
    await requiredBox(grid, "canvas grid"),
    460,
    260,
  );
  await expect(page.getByLabel("Semantic draft position")).toBeVisible();
  const initialX = Number(await page.getByLabel("Initial x").inputValue());
  const initialY = Number(await page.getByLabel("Initial y").inputValue());
  expect(initialX).toBeGreaterThan(0);
  expect(initialY).toBeGreaterThan(0);

  await page.getByRole("button", { name: "変更内容を確認" }).click();
  await expect(page.getByText("追加する関係 1件")).toBeVisible();
  await expect(page.getByText("適用可能", { exact: true })).toBeVisible();
  await page.locator(".iriograph-authoring-actions .primary").click();

  await expect(page.locator(".iriograph-scene-node")).toHaveCount(INITIAL_NODE_COUNT + 1);
  const created = page.locator(".iriograph-scene-node").filter({ hasText: "E2E semantic task" });
  await expect(created).toHaveCount(1);
  expect(await numericStyle(created, "left")).toBeCloseTo(initialX, 0);
  expect(await numericStyle(created, "top")).toBeCloseTo(initialY, 0);
  await expect.poll(() => readTurtle(page)).toContain("E2E semantic task");

  await page.locator('button[title="Undo (Ctrl/Cmd+Z)"]').click();
  await expect(page.locator(".iriograph-scene-node")).toHaveCount(INITIAL_NODE_COUNT);
  await expect.poll(() => readTurtle(page)).not.toContain("E2E semantic task");
  expect(consoleErrors).toEqual([]);
});

test("右クリックから詳細・見た目・接点を編集し、関係削除を確認draftにする", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  await page.goto("/");
  await expect(page.locator(".iriograph-scene-node")).toHaveCount(INITIAL_NODE_COUNT);
  const turtleBefore = await readTurtle(page);
  const review = page.locator(".iriograph-scene-node").filter({ hasText: "内容を審査" });

  await review.dispatchEvent("contextmenu", { clientX: 620, clientY: 310 });
  const menu = page.getByRole("menu", { name: "選択対象の操作" });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitem")).toHaveText([
    "名前を編集",
    "詳細・属性を編集",
    "この要素から関係を作成",
    "領域へ含める",
    "見た目を調整",
    "要素を削除…",
  ]);
  await menu.getByRole("menuitem", { name: "詳細・属性を編集" }).click();
  const details = page.getByRole("dialog", { name: "内容を審査" });
  await expect(details).toBeVisible();
  await expect(details.locator(".iriograph-property-editor-row").filter({ hasText: "名前" }))
    .toBeVisible();
  await expect(details.locator(".iriograph-property-editor-row").filter({ hasText: "説明" }))
    .toBeVisible();
  await details.getByRole("button", { name: "閉じる" }).click();

  await review.dispatchEvent("contextmenu", { clientX: 620, clientY: 310 });
  await menu.getByRole("menuitem", { name: "見た目を調整" }).click();
  const appearance = page.getByLabel("見た目を調整");
  const fillColor = appearance.getByLabel("fill color");
  const fillRow = appearance.locator(".iriograph-appearance-fields > label").filter({ hasText: "fill" }).first();
  await fillRow.locator('input[type="checkbox"]').check();
  await fillColor.fill("#ff3355");
  await expect(review).toHaveCSS("background-color", "rgb(255, 51, 85)");
  await appearance.getByRole("button", { name: "適用", exact: true }).click();
  await expect(appearance).toHaveCount(0);
  expect(await readTurtle(page)).toBe(turtleBefore);

  const relation = page.locator(".iriograph-edge-group").filter({ hasText: "関連する" });
  await expect(relation).toHaveCount(1);
  await relation.dispatchEvent("click");
  const endpointCircles = page.locator(".iriograph-endpoint-anchors circle");
  await expect(endpointCircles).toHaveCount(2);
  await expect(page.locator(".iriograph-endpoint-stub")).toHaveCount(2);
  const sourceHalo = page.locator(".iriograph-endpoint-anchors circle.source");
  const haloBox = await requiredBox(sourceHalo, "source endpoint halo");
  const reviewBox = await requiredBox(review, "source node");
  const haloCenter = { x: haloBox.x + haloBox.width / 2, y: haloBox.y + haloBox.height / 2 };
  expect(pointInsideBox(haloCenter, reviewBox)).toBe(false);
  await dispatchPointerDrag(page, sourceHalo, haloBox, 26, -22);
  await expect(page.getByRole("spinbutton", { name: "source endpoint anchor" })).not.toHaveValue("");
  expect(await readTurtle(page)).toBe(turtleBefore);

  await relation.dispatchEvent("contextmenu", { clientX: 650, clientY: 360 });
  await menu.getByRole("menuitem", { name: "関係を削除…" }).click();
  await expect(page.getByText("選択した関係だけを削除します。適用前に影響範囲を確認できます。"))
    .toBeVisible();
  await page.getByRole("button", { name: "変更内容を確認" }).click();
  await expect(page.getByText("削除する関係 1件")).toBeVisible();
  await expect(page.getByText("関連する", { exact: true }).last()).toBeVisible();
  expect(await readTurtle(page)).toBe(turtleBefore);
  await page.locator(".iriograph-authoring-actions").getByRole("button", { name: "キャンセル" }).click();
  expect(consoleErrors).toEqual([]);
});

test("作成paletteとregion viewでラベル中心の作成・重なり・複数包含を扱う", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  await page.goto("/");
  const turtleBefore = await readTurtle(page);
  expect(turtleBefore).toContain("wf:n-03 a wf:HumanStep, wf:AuditedStep");
  const grid = page.locator(".iriograph-canvas-grid");
  const gridBox = await requiredBox(grid, "canvas grid");
  await grid.dispatchEvent("contextmenu", {
    clientX: gridBox.x + Math.min(520, gridBox.width - 20),
    clientY: gridBox.y + Math.min(240, gridBox.height - 20),
  });
  const menu = page.getByRole("menu", { name: "選択対象の操作" });
  await menu.getByRole("menuitem", { name: "新しい要素を置く" }).click();
  const palette = page.getByRole("dialog", { name: "見た目から選んで追加" });
  await expect(palette).toBeVisible();
  await expect(palette.getByRole("radio", { name: /基本の要素/ })).toBeVisible();
  await expect(palette.getByRole("radio", { name: /概念クラス/ })).toBeVisible();
  await expect(palette.getByRole("radio", { name: /関係の定義/ })).toBeVisible();
  await palette.getByLabel("新しい要素の名前").fill("ラベルで作る確認タスク");
  const relationFields = palette.locator("fieldset").filter({ hasText: "関係も同時に作る" });
  await relationFields.getByRole("checkbox").check();
  await relationFields.locator("select").nth(1).selectOption({ label: "関連する" });
  await relationFields.locator("select").nth(2).selectOption({ label: "内容を審査" });
  const membershipFields = palette.locator("fieldset").filter({ hasText: "領域へ含める" });
  await membershipFields.getByRole("checkbox").check();
  await membershipFields.getByRole("checkbox", { name: "申請者", exact: true }).check();
  await palette.getByRole("button", { name: "作成内容を確認へ" }).click();
  await page.getByLabel("Initial x").fill("420");
  await page.getByLabel("Initial y").fill("260");
  await page.getByRole("button", { name: "変更内容を確認" }).click();
  await expect(page.getByText("追加する関係 3件")).toBeVisible();
  await expect(page.locator(".iriograph-authoring-preview")).toContainText("ラベルで作る確認タスク");
  await expect(page.locator(".iriograph-authoring-preview")).toContainText("関連する");
  await expect(page.locator(".iriograph-authoring-preview")).toContainText("包含");
  await page.locator(".iriograph-authoring-actions").getByRole("button", { name: "キャンセル" }).click();

  const viewSelect = page.getByLabel("Named view", { exact: true });
  await viewSelect.selectOption("regions");
  await expect(page.locator(".iriograph-scene-region")).toHaveCount(5);
  await expect(page.locator(".iriograph-scene-container")).toHaveCount(0);
  await expect(page.locator(".iriograph-scene-node")).toHaveCount(REGION_VIEW_NODE_COUNT);
  await page.getByRole("button", { name: "説明を表示" }).click();
  await expect(page.locator(".iriograph-comment-callout.visible").first()).toBeVisible();
  await expect(page.locator(".iriograph-scene-node").filter({ hasText: "内容を審査" }))
    .toContainText("Review request (en)");
  await expect(page.locator(".iriograph-scene-node").filter({ hasText: "内容を審査" }))
    .toContainText("購入内容と承認条件を確認し");
  await page.getByRole("button", { name: "説明を隠す" }).click();
  const operations = page.locator(".iriograph-scene-region").filter({ hasText: "業務オペレーション" });
  const audit = page.locator('.iriograph-scene-region[data-element-id="region:audit"]');
  const review = page.locator(".iriograph-scene-node").filter({ hasText: "内容を審査" });
  const operationsBox = await requiredBox(operations, "operations region");
  const auditBox = await requiredBox(audit, "audit region");
  const overlap = intersectionBox(operationsBox, auditBox);
  expect(overlap).toBeDefined();
  const reviewBox = await requiredBox(review, "shared member");
  expect(pointInsideBox({
    x: reviewBox.x + reviewBox.width / 2,
    y: reviewBox.y + reviewBox.height / 2,
  }, overlap!)).toBe(true);
  const humanStep = page.locator(".iriograph-scene-region").filter({ hasText: "人が行う工程" });
  const auditedStep = page.locator(".iriograph-scene-region").filter({ hasText: "監査対象工程" });
  const classOverlap = intersectionBox(
    await requiredBox(humanStep, "human step class region"),
    await requiredBox(auditedStep, "audited step class region"),
  );
  expect(classOverlap).toBeDefined();
  expect(pointInsideBox({
    x: reviewBox.x + reviewBox.width / 2,
    y: reviewBox.y + reviewBox.height / 2,
  }, classOverlap!)).toBe(true);

  await audit.dispatchEvent("contextmenu", { clientX: 680, clientY: 420 });
  await menu.getByRole("menuitem", { name: "領域の見た目を調整" }).click();
  const appearance = page.getByLabel("見た目を調整");
  const opacityRow = appearance.locator("label").filter({ hasText: "領域の透明度" });
  await opacityRow.locator('input[type="checkbox"]').check();
  await opacityRow.locator('input[type="range"]').fill("0.35");
  await expect(audit.locator(".iriograph-region-fill")).toHaveCSS("opacity", "0.35");
  await appearance.getByRole("button", { name: "適用", exact: true }).click();
  expect(await readTurtle(page)).toBe(turtleBefore);

  await review.dispatchEvent("contextmenu", { clientX: 610, clientY: 330 });
  await menu.getByRole("menuitem", { name: "領域へ含める" }).click();
  const requester = page.locator(".iriograph-scene-region").filter({ hasText: "申請者" });
  const requesterBox = await requiredBox(requester, "requester region");
  await requester.dispatchEvent("pointerdown", {
    button: 0,
    clientX: requesterBox.x + 30,
    clientY: requesterBox.y + 30,
  });
  await expect(page.getByLabel("Membership container", { exact: true }))
    .toHaveValue("urn:iriograph:demo:g-01");
  await expect(page.getByLabel("Membership structure config")).not.toHaveValue("");
  await page.getByRole("button", { name: "変更内容を確認" }).click();
  await expect(page.getByText("追加する関係 1件")).toBeVisible();
  await expect(page.locator(".iriograph-authoring-preview")).toContainText("申請者");
  await expect(page.locator(".iriograph-authoring-preview")).toContainText("内容を審査");
  expect(await readTurtle(page)).toBe(turtleBefore);
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
  await expect(nodes).toHaveCount(INITIAL_NODE_COUNT);
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
  const parallel = page.getByRole("option", { name: /内容を審査から承認ポリシーへの/ });
  await expect(parallel).toHaveCount(2);
  const parallelPaths = await parallel.locator(".iriograph-edge-path").evaluateAll(
    (paths) => paths.map((path) => path.getAttribute("d")),
  );
  expect(new Set(parallelPaths).size).toBe(2);
  await parallel.nth(0).dispatchEvent("click");
  await expect(parallel.nth(0)).toHaveAttribute("aria-selected", "true");
  await parallel.nth(1).dispatchEvent("click");
  await expect(parallel.nth(1)).toHaveAttribute("aria-selected", "true");
  await expect(parallel.nth(0)).toHaveAttribute("aria-selected", "false");

  const selfLoop = page.getByRole("option", { name: /内容を審査から内容を審査への再試行/ });
  await expect(selfLoop).toHaveCount(1);
  await selfLoop.dispatchEvent("click");
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
  await selfLoop.dispatchEvent("keydown", { key: "Delete" });
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
  await expect(page.locator(".iriograph-scene-node")).toHaveCount(INITIAL_NODE_COUNT);
  const viewport = page.locator(".iriograph-canvas-scroll");

  await viewport.focus();
  const activeBefore = await viewport.getAttribute("aria-activedescendant");
  await page.keyboard.press("ArrowRight");
  await expect(viewport).not.toHaveAttribute("aria-activedescendant", activeBefore ?? "");
  await page.keyboard.press("Shift+PageDown");
  await expect.poll(async () => (await scrollPosition(viewport)).left).toBeGreaterThan(0);

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

test("single-tab-stop navigatorで選択・geometry・routingをkeyboard完結する", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  await page.goto("/");
  const canvasShell = page.locator(".iriograph-canvas-shell");
  const viewport = page.locator(".iriograph-canvas-scroll");
  await expect(canvasShell.locator('[tabindex="0"]')).toHaveCount(1);
  await expect(viewport).toHaveAttribute("role", "listbox");

  const node = page.locator(".iriograph-scene-node").first();
  await node.click();
  const turtleBefore = await readTurtle(page);
  const initialLeft = await numericStyle(node, "left");
  await viewport.focus();
  await page.keyboard.press("Control+ArrowRight");
  await expect.poll(() => numericStyle(node, "left")).toBeCloseTo(initialLeft + 1, 0);
  expect(await readTurtle(page)).toBe(turtleBefore);
  await page.locator('button[title="Undo (Ctrl/Cmd+Z)"]').click();
  await expect.poll(() => numericStyle(node, "left")).toBeCloseTo(initialLeft, 0);

  await viewport.focus();
  await page.keyboard.press("Shift+ArrowRight");
  await expect(page.locator('.iriograph-canvas-scroll [role="option"][aria-selected="true"]'))
    .toHaveCount(2);

  const edge = page.locator(".iriograph-edge-group").first();
  await edge.dispatchEvent("click");
  const waypointCount = await page.locator(".iriograph-waypoint-row").count();
  await viewport.focus();
  await page.keyboard.press("w");
  await expect.poll(() => page.locator(".iriograph-waypoint-row").count())
    .toBeGreaterThan(waypointCount);
  expect(await readTurtle(page)).toBe(turtleBefore);
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

async function dispatchPointerClick(
  page: Page,
  target: Locator,
  box: { x: number; y: number; width: number; height: number },
  offsetX: number,
  offsetY: number,
): Promise<void> {
  const clientX = box.x + Math.min(offsetX, box.width - 1);
  const clientY = box.y + Math.min(offsetY, box.height - 1);
  await target.dispatchEvent("pointerdown", { button: 0, clientX, clientY });
  await page.evaluate(({ x, y }) => {
    window.dispatchEvent(new PointerEvent("pointerup", {
      bubbles: true,
      button: 0,
      clientX: x,
      clientY: y,
    }));
  }, { x: clientX, y: clientY });
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

function pointInsideBox(
  point: { x: number; y: number },
  box: { x: number; y: number; width: number; height: number },
): boolean {
  return point.x >= box.x
    && point.x <= box.x + box.width
    && point.y >= box.y
    && point.y <= box.y + box.height;
}

function intersectionBox(
  left: { x: number; y: number; width: number; height: number },
  right: { x: number; y: number; width: number; height: number },
): { x: number; y: number; width: number; height: number } | undefined {
  const x = Math.max(left.x, right.x);
  const y = Math.max(left.y, right.y);
  const farX = Math.min(left.x + left.width, right.x + right.width);
  const farY = Math.min(left.y + left.height, right.y + right.height);
  return farX > x && farY > y ? { x, y, width: farX - x, height: farY - y } : undefined;
}
