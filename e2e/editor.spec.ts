import { expect, test, type Locator, type Page } from "@playwright/test";

const INITIAL_NODE_COUNT = 8;
const REGION_VIEW_NODE_COUNT = 8;

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

  const handle = node.locator('.iriograph-resize-handle[data-handle="se"]');
  const initialWidth = await numericStyle(node, "width");
  const initialZoom = Number.parseInt(
    await page.locator(".iriograph-zoom-actions .zoom-value").innerText(),
    10,
  ) / 100;
  await dispatchPointerDrag(page, handle, await requiredBox(handle, "resize handle"), 30, 18);
  await expect.poll(() => numericStyle(node, "width")).toBeCloseTo(initialWidth + 30 / initialZoom, 0);

  await page.locator(".iriograph-edge-group").first().dispatchEvent("click");
  const waypoint = page.locator(".iriograph-waypoints circle").first();
  const initialWaypointX = Number(await waypoint.getAttribute("cx"));
  await dispatchPointerDrag(page, waypoint, await requiredBox(waypoint, "waypoint"), 36, 20);
  await expect.poll(async () => Math.abs(
    Number(await waypoint.getAttribute("cx")) - (initialWaypointX + 36 / initialZoom),
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

test("左右サイドバーを折りたたむとCanvasが空いた領域まで拡張する", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".iriograph-scene-node")).toHaveCount(INITIAL_NODE_COUNT);
  const viewport = page.locator(".iriograph-canvas-scroll");
  const before = await requiredBox(viewport, "canvas viewport");

  await page.getByLabel("左サイドバーを閉じる").click();
  await page.getByLabel("右サイドバーを閉じる").click();
  await expect(page.getByLabel("左サイドバーを開く")).toBeVisible();
  await expect(page.getByLabel("右サイドバーを開く")).toBeVisible();
  await expect.poll(async () => (await requiredBox(viewport, "expanded canvas viewport")).width)
    .toBeGreaterThan(before.width + 400);

  await page.getByLabel("全体を表示").click();
  await expect(page.locator(".iriograph-scene-node").first()).toBeInViewport();
  await page.getByLabel("左サイドバーを開く").click();
  await page.getByLabel("右サイドバーを開く").click();
  await expect(page.getByLabel("左サイドバーを閉じる")).toBeVisible();
  await expect(page.getByLabel("右サイドバーを閉じる")).toBeVisible();
});

test("named view管理とtemporary hideをsemantic sourceから分離する", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  await page.goto("/");
  const viewSelect = page.getByLabel("Named view", { exact: true });
  await expect(viewSelect.locator("option")).toHaveCount(1);
  await expect(viewSelect).toHaveValue("main");
  await expect(page.locator(".iriograph-scene-region")).toHaveCount(5);
  const turtleBefore = await readTurtle(page);

  await page.locator(".iriograph-scene-node").first().click();
  await page.getByRole("button", { name: "一時非表示" }).click();
  await expect(page.locator(".iriograph-scene-node")).toHaveCount(INITIAL_NODE_COUNT - 1);
  await expect(page.getByRole("button", { name: /再表示/ })).toContainText("(1)");

  await page.locator(".iriograph-view-actions").getByRole("button", { name: "複製" }).click();
  await expect(viewSelect).toHaveValue("main-copy");
  await expect(viewSelect.locator("option")).toHaveCount(2);

  await page.locator(".iriograph-view-actions").getByRole("button", { name: "設定" }).click();
  await expect(page.locator('.iriograph-view-dialog input[readonly]')).toHaveValue("main-copy");
  await page.locator('.iriograph-view-dialog input[placeholder="ja"]').fill("en-US");
  await page.locator('.iriograph-view-dialog button[type="submit"]').click();
  await expect(page.locator(".iriograph-view-dialog")).toHaveCount(0);

  await page.locator(".iriograph-view-actions").getByRole("button", { name: "Overlay reset" }).click();
  await expect(viewSelect).toHaveValue("main-copy");
  await page.locator(".iriograph-view-actions").getByRole("button", { name: "削除" }).click();
  await expect(viewSelect.locator("option")).toHaveCount(1);
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
  await expect(viewSelect.locator("option")).toHaveCount(2);

  await expect.poll(() => readTurtle(page)).toBe(turtleBefore);
  expect(consoleErrors).toEqual([]);
});

test("右Inspectorの4 intentから名前だけでopaque IRIの要素を作成・undoする", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  await page.goto("/");
  await expect(page.locator(".iriograph-scene-node")).toHaveCount(INITIAL_NODE_COUNT);
  const inspector = page.locator(".iriograph-inspector");
  const intentButtons = inspector.locator(".iriograph-intent-grid button");
  await expect(intentButtons).toHaveText([
    "＋新しい要素を作る",
    "→関係を作る",
    "✎要素を変更する",
    "⌘関係を変更する",
  ]);
  await expect(inspector.locator(".iriograph-intent-fields")).toHaveCount(0);
  await expect(inspector.locator(".iriograph-display-inspector")).not.toBeVisible();

  const turtleBefore = await readTurtle(page);
  await inspector.getByRole("button", { name: "新しい要素を作る" }).click();
  const name = inspector.getByLabel("新しい要素の名前");
  await expect(name).toBeFocused();
  await expect(inspector).not.toContainText("IRI");
  await expect(inspector).not.toContainText("種類");
  await expect(inspector).not.toContainText("説明");
  await name.fill("E2E opaque 新規要素");
  await page.getByRole("button", { name: "変更内容を確認" }).click();
  const preview = page.locator(".iriograph-authoring-preview");
  await expect(preview).toContainText("追加 1件");
  await expect(preview).toContainText("E2E opaque 新規要素");
  await expect(page.getByText("適用可能", { exact: true })).toBeVisible();
  await preview.getByRole("button", { name: "明示的に適用" }).click();

  await expect(page.locator(".iriograph-scene-node")).toHaveCount(INITIAL_NODE_COUNT + 1);
  const created = page.locator(".iriograph-scene-node").filter({ hasText: "E2E opaque 新規要素" });
  await expect(created).toHaveCount(1);
  const turtleAfter = await readTurtle(page);
  const createdStatement = turtleAfter.match(
    /(?:^|\n)(?::|wf:|<urn:iriograph:demo:)(r-[a-z0-9]+)>?\s+(?:rdfs:label|<http:\/\/www\.w3\.org\/2000\/01\/rdf-schema#label>)\s+"E2E opaque 新規要素"(?:\^\^xsd:string)?\s+\./u,
  );
  const opaqueSubject = createdStatement?.[1];
  expect(opaqueSubject).toBeDefined();
  expect(opaqueSubject).not.toContain("opaque");
  expect(createdStatement?.[0]).not.toMatch(/\s+a\s+/u);
  expect(turtleAfter).not.toBe(turtleBefore);

  await page.locator('button[title="Undo (Ctrl/Cmd+Z)"]').click();
  await expect(page.locator(".iriograph-scene-node")).toHaveCount(INITIAL_NODE_COUNT);
  await expect.poll(() => readTurtle(page)).not.toContain("E2E opaque 新規要素");
  expect(consoleErrors).toEqual([]);
});

test("意味/ビューtabを排他表示し、右クリックから右Inspectorのビュー編集を開く", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  await page.goto("/");
  await expect(page.locator(".iriograph-scene-node")).toHaveCount(INITIAL_NODE_COUNT);
  await expect(page.locator(".iriograph-zoom-actions .zoom-value")).not.toHaveText("100%");
  const turtleBefore = await readTurtle(page);
  const inspector = page.locator(".iriograph-inspector");
  const modeTabs = inspector.locator(".iriograph-inspector-mode-tabs");
  const semanticTab = modeTabs.getByRole("button", { name: "意味", exact: true });
  const appearanceTab = modeTabs.getByRole("button", { name: "ビュー", exact: true });
  await expect(semanticTab).toHaveAttribute("aria-pressed", "true");
  await expect(inspector.locator(".iriograph-intent-panel")).toBeVisible();
  await expect(inspector.locator(".iriograph-display-inspector")).not.toBeVisible();

  await appearanceTab.click();
  await expect(appearanceTab).toHaveAttribute("aria-pressed", "true");
  await expect(inspector.locator(".iriograph-intent-panel")).not.toBeVisible();
  await expect(inspector.locator(".iriograph-display-inspector")).toBeVisible();
  await semanticTab.click();
  await expect(inspector.locator(".iriograph-intent-panel")).toBeVisible();
  await expect(inspector.locator(".iriograph-display-inspector")).not.toBeVisible();

  const review = page.locator(".iriograph-scene-node").filter({ hasText: "内容を審査" });

  await review.dispatchEvent("contextmenu", { clientX: 620, clientY: 310 });
  await expect(page.getByRole("menu", { name: "選択対象の操作" })).toHaveCount(0);
  await expect(appearanceTab).toHaveAttribute("aria-pressed", "true");
  await expect(inspector.locator(".iriograph-intent-panel")).not.toBeVisible();
  await inspector.getByRole("button", { name: "ビューを編集" }).click();
  const appearance = inspector.getByLabel("ビューを編集");
  const fillColor = appearance.getByLabel("fill color");
  const fillRow = appearance.locator(".iriograph-appearance-fields > label").filter({ hasText: "fill" }).first();
  await fillRow.locator('input[type="checkbox"]').check();
  await fillColor.fill("#ff3355");
  await expect(review).toHaveCSS("background-color", "rgb(255, 51, 85)");
  await appearance.getByRole("button", { name: "適用", exact: true }).click();
  await expect(appearance).toHaveCount(0);
  expect(await readTurtle(page)).toBe(turtleBefore);
  expect(consoleErrors).toEqual([]);
});

test("意味側のedge端子dropは接続先draftを作り、個別説明をTurtleへ保存する", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  await page.goto("/");
  const turtleBefore = await readTurtle(page);
  const edge = page.locator('.iriograph-edge-group[aria-label*="内容を審査から承認ポリシーへの関連する"]');
  await expect(edge).toHaveCount(1);
  await edge.click();
  const inspector = page.locator(".iriograph-inspector");
  await inspector.getByRole("button", { name: "関係を変更する" }).click();

  const targetHandle = page.locator(".iriograph-endpoint-anchors.semantic circle").nth(1);
  const nextTarget = page.locator(".iriograph-scene-node").filter({ hasText: "完了" });
  const handleBox = await requiredBox(targetHandle, "semantic target endpoint");
  const targetBox = await requiredBox(nextTarget, "semantic target node");
  await dispatchPointerDrag(
    page,
    targetHandle,
    handleBox,
    targetBox.x + targetBox.width / 2 - (handleBox.x + handleBox.width / 2),
    targetBox.y + targetBox.height / 2 - (handleBox.y + handleBox.height / 2),
  );
  await expect(inspector.locator(".iriograph-intent-selection")).toContainText("終点完了");
  expect(await readTurtle(page)).toBe(turtleBefore);

  await inspector.getByRole("button", { name: "説明を追加" }).click();
  await inspector.getByRole("textbox", { name: "この関係だけの説明 1", exact: true })
    .fill("E2Eの関係固有説明\n二行目");
  await inspector.getByRole("button", { name: "変更内容を確認" }).click();
  const preview = inspector.locator(".iriograph-authoring-preview");
  await expect(preview).toContainText("内容を審査（関連する）完了");
  await preview.getByRole("button", { name: "明示的に適用" }).click();

  await expect.poll(() => readTurtle(page)).toContain("E2Eの関係固有説明\\n二行目");
  const turtleAfter = await readTurtle(page);
  expect(turtleAfter).toContain("rdf:Statement");
  expect(turtleAfter).toContain("rdf:subject");
  expect(turtleAfter).toContain("rdf:predicate");
  expect(turtleAfter).toContain("rdf:object");
  await expect(page.locator(".iriograph-edge-caption").filter({ hasText: "E2Eの関係固有説明" }))
    .toHaveCount(0);
  expect(consoleErrors).toEqual([]);
});

test("薄いCanvas gridはsnap間隔で表示し、toggleしても意味・dirty・history・pointer hitを変えない", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  await page.goto("/");
  await expect(page.locator(".iriograph-scene-node")).toHaveCount(INITIAL_NODE_COUNT);
  const turtleBefore = await readTurtle(page);
  const undo = page.locator('button[title="Undo (Ctrl/Cmd+Z)"]');
  await expect(undo).toBeDisabled();
  await expect(page.locator(".topbar .status-pill.neutral")).toHaveText("保存済み");

  const grid = page.locator(".iriograph-canvas-grid");
  await expect(grid).toBeVisible();
  await expect(grid).toHaveCSS("pointer-events", "none");
  await expect(grid).toHaveCSS("opacity", "0.28");
  await expect(grid).not.toHaveCSS("background-image", "none");
  await expect(grid).toHaveCSS("background-size", /^8px 8px(?:, 8px 8px)?$/u);

  const review = page.locator(".iriograph-scene-node").filter({ hasText: "内容を審査" });
  const reviewBox = await requiredBox(review, "node above grid");
  const hitIsGrid = await page.evaluate(({ x, y }) => (
    document.elementFromPoint(x, y)?.classList.contains("iriograph-canvas-grid") ?? false
  ), { x: reviewBox.x + reviewBox.width / 2, y: reviewBox.y + reviewBox.height / 2 });
  expect(hitIsGrid).toBe(false);
  await page.mouse.click(reviewBox.x + reviewBox.width / 2, reviewBox.y + reviewBox.height / 2);
  await expect(review).toHaveAttribute("aria-selected", "true");

  await page.locator(".iriograph-inspector-mode-tabs")
    .getByRole("button", { name: "ビュー", exact: true }).click();
  const gridToggle = page.locator(".iriograph-grid-visibility button");
  await expect(gridToggle).toHaveText("表示中");
  await gridToggle.click();
  await expect(page.locator(".iriograph-canvas-grid")).toHaveCount(0);
  await expect(gridToggle).toHaveText("非表示");
  await expect(undo).toBeDisabled();
  await expect(page.locator(".topbar .status-pill.neutral")).toHaveText("保存済み");
  expect(await readTurtle(page)).toBe(turtleBefore);

  await gridToggle.click();
  await expect(page.locator(".iriograph-canvas-grid")).toBeVisible();
  await expect(undo).toBeDisabled();
  await expect(page.locator(".topbar .status-pill.neutral")).toHaveText("保存済み");
  expect(await readTurtle(page)).toBe(turtleBefore);
  expect(consoleErrors).toEqual([]);
});

test("region viewで領域交差・複数包含・説明・8方向resizeを扱う", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  await page.goto("/");
  const turtleBefore = await readTurtle(page);
  expect(turtleBefore).toContain("wf:n-03 a wf:HumanStep, wf:AuditedStep");
  await expect(page.locator(".iriograph-scene-region")).toHaveCount(5);
  await expect(page.locator(".iriograph-scene-container.sequence-group")).toHaveCount(3);
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
  await expect(page.getByRole("menu", { name: "選択対象の操作" })).toHaveCount(0);
  const inspector = page.locator(".iriograph-inspector");
  await inspector.getByRole("button", { name: "スタイル", exact: true }).click();
  await inspector.getByRole("button", { name: "ビューを編集" }).click();
  const appearance = inspector.getByLabel("ビューを編集");
  const opacityRow = appearance.locator("label").filter({ hasText: "領域の透明度" });
  await opacityRow.locator('input[type="checkbox"]').check();
  await opacityRow.locator('input[type="range"]').fill("0.35");
  await expect(audit.locator(".iriograph-region-fill")).toHaveCSS("opacity", "0.35");
  await appearance.getByRole("button", { name: "適用", exact: true }).click();
  expect(await readTurtle(page)).toBe(turtleBefore);

  await page.keyboard.press("Escape");
  await review.click();
  const resizeHandles = review.locator(".iriograph-resize-handle");
  await expect(resizeHandles).toHaveCount(8);
  expect((await resizeHandles.evaluateAll((handles) => handles.map(
    (handle) => handle.getAttribute("data-handle"),
  ))).sort()).toEqual(["e", "n", "ne", "nw", "s", "se", "sw", "w"]);
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

  // Region viewは単一parentを持たないため、同じ業務領域内の既知nodeを
  // semantic labelで選び、multi-selectionのpresentation操作を検証する。
  const selectedNodes = [
    nodes.filter({ hasText: "内容を審査" }),
    nodes.filter({ hasText: "承認ポリシー" }),
    nodes.filter({ hasText: "承認結果を登録" }),
  ];
  for (const selected of selectedNodes) await expect(selected).toHaveCount(1);

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
  const gridRemainder = Math.min(...moved.map((geometry) => geometry.left)) % 8;
  // Multi-region intersection is a hard constraint; grid snap is best-effort
  // when the exact grid line would move any selected member outside it.
  expect(Math.min(gridRemainder, 8 - gridRemainder)).toBeLessThanOrEqual(2);
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
  )).size).toBeLessThan(new Set(before.map((geometry) => geometry.left)).size);
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

test("parallel/self-loopを個別選択しstraight/curve・端子・manual routingを編集する", async ({ page }) => {
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

  await page.locator(".iriograph-inspector-mode-tabs")
    .getByRole("button", { name: "ビュー", exact: true }).click();
  const routing = page.locator(".iriograph-routing-inspector");
  const routeMode = routing.getByLabel("線の形式");
  await expect(routing).toBeVisible();

  await routeMode.selectOption("straight");
  await expect(routeMode).toHaveValue("straight");
  await expect(page.locator(".iriograph-waypoints circle")).toHaveCount(0);
  await expect(selfLoop.locator(".iriograph-edge-path")).not.toHaveAttribute("d", /[CQ]/u);

  await routeMode.selectOption("curve");
  await expect(routeMode).toHaveValue("curve");
  await expect(page.locator(".iriograph-waypoints circle")).toHaveCount(0);
  await expect(selfLoop.locator(".iriograph-edge-path")).toHaveAttribute("d", /[CQ]/u);

  await routing.getByLabel("source terminal marker").selectOption("diamond");
  await routing.getByLabel("target terminal marker").selectOption("circle");
  await expect(selfLoop.locator(".iriograph-edge-path")).toHaveAttribute("marker-start", /diamond/u);
  await expect(selfLoop.locator(".iriograph-edge-path")).toHaveAttribute("marker-end", /circle/u);
  expect(await readTurtle(page)).toBe(turtleBefore);

  await routeMode.selectOption("manual");
  await routing.getByRole("button", { name: "Waypointを追加" }).click();
  await expect(page.locator(".iriograph-waypoints circle").first()).toBeVisible();

  const waypoint = page.locator(".iriograph-waypoints circle").first();
  const waypointX = Number(await waypoint.getAttribute("cx"));
  await dispatchPointerDrag(page, waypoint, await requiredBox(waypoint, "self-loop waypoint"), 28, 16);
  await expect.poll(async () => Math.abs(Number(
    await page.locator(".iriograph-waypoints circle").first().getAttribute("cx"),
  ) - waypointX)).toBeGreaterThan(10);

  const label = selfLoop.locator(".iriograph-edge-label");
  const initialLabelX = Number(await label.getAttribute("x"));
  await dispatchPointerDrag(page, label, await requiredBox(label, "self-loop label"), 24, -14);
  await expect.poll(async () => Math.abs(Number(await label.getAttribute("x")) - initialLabelX))
    .toBeGreaterThan(10);

  await routing.getByText("ラベルと補足を調整", { exact: true }).click();
  await routing.getByRole("button", { name: "ラベル位置をリセット" }).click();
  await expect.poll(async () => Number(await label.getAttribute("x"))).toBeCloseTo(initialLabelX, 0);

  await routing.getByRole("button", { name: "線の調整をすべてリセット" }).click();
  await expect(routeMode).toHaveValue("auto");
  expect(await readTurtle(page)).toBe(turtleBefore);
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
  await page.locator(".iriograph-zoom-actions .zoom-value").click();
  await expect(page.locator(".iriograph-zoom-actions .zoom-value")).toHaveText("100%");

  await viewport.focus();
  const activeBefore = await viewport.getAttribute("aria-activedescendant");
  await page.keyboard.press("ArrowRight");
  await expect(viewport).not.toHaveAttribute("aria-activedescendant", activeBefore ?? "");
  const beforePagePan = await scrollPosition(viewport);
  await page.keyboard.press("Shift+PageDown");
  await expect.poll(async () => (await scrollPosition(viewport)).left).toBeGreaterThan(beforePagePan.left);

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
  const waypointCount = await page.locator(".iriograph-waypoints circle").count();
  await viewport.focus();
  await page.keyboard.press("w");
  await expect.poll(() => page.locator(".iriograph-waypoints circle").count())
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
