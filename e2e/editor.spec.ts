import { expect, test, type Locator, type Page } from "@playwright/test";

async function openPurchaseSample(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: /purchase-approval\.iriograph/u }).click();
  await expect(page.locator(".document-heading")).toContainText("purchase-approval");
  await expect(page.locator(".iriograph-canvas-scroll")).toHaveAttribute("aria-busy", "false");
  await expect(sceneNode(page, "開始")).toBeVisible();
  await expect(sceneNode(page, "内容を審査")).toBeVisible();
  await expect(sceneNode(page, "完了")).toBeVisible();
  await expect(groupFrame(page, "購入申請フロー")).toBeAttached();
  await expect(groupFrame(page, "承認？")).toBeAttached();
}

test("editorのpointer操作、history、Turtle rollback、保存flushがbrowserで連携する", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  await openPurchaseSample(page);
  const initialNodeCount = await page.locator(".iriograph-scene-node").count();
  expect(initialNodeCount).toBeGreaterThan(0);

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

  const handle = page.locator('.iriograph-transient-resize-layer .iriograph-resize-handle[data-handle="se"]');
  const initialZoom = Number.parseInt(
    await page.locator(".iriograph-zoom-actions .zoom-value").innerText(),
    10,
  ) / 100;
  await dispatchPointerDrag(page, handle, await requiredBox(handle, "resize handle"), -30, -18);
  await expect.poll(() => numericStyle(node, "width")).toBeCloseTo(44, 0);

  await page.locator(".iriograph-edge-group").first().dispatchEvent("click");
  await page.locator(".iriograph-inspector-mode-tabs")
    .getByRole("button", { name: "ビュー", exact: true }).click();
  const routeMode = page.getByLabel("線の形式");
  await routeMode.selectOption("manual");
  const routing = routeMode.locator("xpath=ancestor::details");
  await routing.getByRole("button", { name: "経路点を追加" }).click();
  const waypoint = page.locator(".iriograph-waypoints circle").first();
  await expect(waypoint).toBeVisible();
  const initialWaypointX = Number(await waypoint.getAttribute("cx"));
  await dispatchPointerDrag(page, waypoint, await requiredBox(waypoint, "waypoint"), 36, 20);
  await expect.poll(async () => Math.abs(
    Number(await waypoint.getAttribute("cx")) - (initialWaypointX + 36 / initialZoom),
  )).toBeLessThanOrEqual(1);

  await page.getByRole("button", { name: /Turtle/ }).click();
  const textarea = page.getByLabel("Turtle source");
  const acceptedSource = `${await textarea.inputValue()}\n<urn:iriograph:demo:e2e-new> <http://www.w3.org/2000/01/rdf-schema#label> "E2E New" .\n`;
  await textarea.fill(acceptedSource);
  await page.locator(".topbar").getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByText("browser working copyを保存しました")).toBeVisible();
  await expect(textarea).toHaveValue(acceptedSource);

  await textarea.fill("@prefix : <urn:iriograph:e2e:> .\n:a :rel .");
  await page.getByRole("button", { name: "検証して適用" }).click();
  await expect(page.locator(".iriograph-diagnostics .error")).toBeVisible();
  await page.getByRole("button", { name: "図", exact: true }).click();
  await expect(page.locator(".iriograph-scene-node")).toHaveCount(initialNodeCount + 1);

  await page.getByRole("button", { name: /Turtle/ }).click();
  const domainInvalidSource = `${acceptedSource}\n<urn:iriograph:demo:g-01> <http://www.w3.org/2000/01/rdf-schema#member> <urn:iriograph:demo:e2e-invalid> .\n`;
  await textarea.fill(domainInvalidSource);
  await page.getByRole("button", { name: "検証して適用" }).click();
  const domainDiagnostic = page.locator(".iriograph-diagnostics .error")
    .filter({ hasText: "demo-visible-resource-label-required" });
  await expect(domainDiagnostic).toContainText("変更を適用できません");
  await domainDiagnostic.getByText("技術的な詳細").click();
  await expect(domainDiagnostic.getByText("demo-visible-resource-label-required")).toBeVisible();
  await page.getByRole("button", { name: "ソースで確認", exact: true }).click();
  await expect.poll(() => textarea.evaluate((element) => (
    (element as HTMLTextAreaElement).selectionStart
  ))).toBe(domainInvalidSource.indexOf("<urn:iriograph:demo:e2e-invalid>"));
  await page.getByRole("button", { name: "図", exact: true }).click();
  await expect(page.locator(".iriograph-scene-node")).toHaveCount(initialNodeCount + 1);

  expect(consoleErrors).toEqual([]);
});

test("左右サイドバーを折りたたむとCanvasが空いた領域まで拡張する", async ({ page }) => {
  await openPurchaseSample(page);
  const viewport = page.locator(".iriograph-canvas-scroll");
  await expect(page.getByLabel("左サイドバーを開く")).toBeVisible();
  await page.getByLabel("左サイドバーを開く").click();
  const before = await requiredBox(viewport, "canvas viewport");

  await page.getByLabel("左サイドバーを閉じる").click();
  await page.getByLabel("右サイドバーを閉じる").click();
  await expect(page.getByLabel("左サイドバーを開く")).toBeVisible();
  await expect(page.getByLabel("右サイドバーを開く")).toBeVisible();
  await expect.poll(async () => (await requiredBox(viewport, "expanded canvas viewport")).width)
    .toBeGreaterThan(before.width + 200);

  await page.getByLabel("全体を表示").click();
  await expect(page.locator(".iriograph-scene-node").first()).toBeInViewport();
  await page.getByLabel("左サイドバーを開く").click();
  await page.getByLabel("右サイドバーを開く").click();
  await expect(page.getByLabel("左サイドバーを閉じる")).toBeVisible();
  await expect(page.getByLabel("右サイドバーを閉じる")).toBeVisible();
});

test("選択済み領域は空内部から移動でき、Canvas空白だけが選択を解除する", async ({ page }) => {
  await openPurchaseSample(page);
  await page.getByLabel("全体を表示").click();
  const frame = groupFrame(page, "購入申請フロー");
  const frameBox = await requiredBox(frame, "group frame");
  await dispatchPointerDrag(page, frame, frameBox, 0, 0);
  await expect(frame).toHaveClass(/selected/u);
  const initialX = await numericStyle(frame, "left");

  const interior = await frame.evaluate((element) => {
    const frameRect = element.getBoundingClientRect();
    const occupied = [...document.querySelectorAll([
      ".iriograph-scene-node",
      ".iriograph-scene-container:not(.group-frame)",
      ".iriograph-region-label",
    ].join(","))].map((item) => item.getBoundingClientRect());
    const foregroundFrames = [...document.querySelectorAll(
      ".iriograph-scene-container.group-frame, .iriograph-scene-region.group-frame",
    )]
      .filter((item) => item !== element)
      .map((item) => item.getBoundingClientRect());
    for (let y = frameRect.top + 24; y < frameRect.bottom - 24; y += 16) {
      for (let x = frameRect.left + 24; x < frameRect.right - 24; x += 16) {
        const hit = document.elementFromPoint(x, y);
        const blankTarget = hit?.classList.contains("iriograph-diagram-canvas")
          || hit?.classList.contains("iriograph-canvas-grid");
        if (
          blankTarget
          && !occupied.some((box) => x >= box.left && x <= box.right && y >= box.top && y <= box.bottom)
          && !foregroundFrames.some((box) => x >= box.left && x <= box.right && y >= box.top && y <= box.bottom)
        ) {
          return { x, y };
        }
      }
    }
    throw new Error("group frame has no blank interior point");
  });
  await page.mouse.move(interior.x, interior.y);
  await page.mouse.down();
  await page.mouse.move(interior.x + 64, interior.y + 32);
  await page.mouse.up();
  await expect.poll(async () => Math.abs(await numericStyle(frame, "left") - initialX))
    .toBeGreaterThan(0);

  const blank = await page.locator(".iriograph-diagram-canvas").evaluate((canvas) => {
    const bounds = canvas.getBoundingClientRect();
    const viewport = canvas.closest(".iriograph-canvas-scroll")?.getBoundingClientRect();
    if (!viewport) throw new Error("Canvas viewport is missing");
    const objects = [...canvas.querySelectorAll([
      ".iriograph-scene-node",
      ".iriograph-scene-container",
      ".iriograph-scene-region",
      ".iriograph-edge-group",
    ].join(","))].map((item) => item.getBoundingClientRect());
    for (let y = Math.max(bounds.top, viewport.top) + 12; y < Math.min(bounds.bottom, viewport.bottom) - 12; y += 24) {
      for (let x = Math.max(bounds.left, viewport.left) + 12; x < Math.min(bounds.right, viewport.right) - 12; x += 24) {
        if (!objects.some((box) => x >= box.left && x <= box.right && y >= box.top && y <= box.bottom)) {
          return { x, y };
        }
      }
    }
    throw new Error("Canvas has no blank point");
  });
  await page.mouse.click(blank.x, blank.y);
  await expect(page.locator(".iriograph-scene-node.selected, .iriograph-scene-container.selected, .iriograph-scene-region.selected, .iriograph-edge-group.selected")).toHaveCount(0);
});

test("Documentタブでactive view overlayをTurtle不変の一履歴としてsource編集する", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  await openPurchaseSample(page);
  const turtleBefore = await readTurtle(page);
  await page.getByRole("button", { name: /Document/u }).click();
  const source = page.getByLabel("View overlay JSON");
  await expect(page.getByLabel("意味の要約")).toContainText("Turtle全文の重複表示はしません");
  await expect(page.getByLabel("Turtle source")).toHaveCount(0);
  const portableSource = page.getByLabel("Portable document JSON");
  await expect(portableSource).toBeEditable();
  await expect(portableSource).toHaveValue(/"documentId": "purchase-approval"/u);
  const originalPortableDocument = JSON.parse(await portableSource.inputValue()) as {
    documentId: string;
  };
  const originalOverlay = JSON.parse(await source.inputValue()) as Record<string, {
    geometry?: { x: number; y: number; width: number; height: number };
  }>;
  const geometryEntry = Object.entries(originalOverlay).find(([, entry]) => entry.geometry);
  expect(geometryEntry).toBeTruthy();
  const [elementId, entry] = geometryEntry!;
  const changedOverlay = structuredClone(originalOverlay);
  changedOverlay[elementId]!.geometry!.x += 8;
  await source.fill(JSON.stringify(changedOverlay));
  await page.locator(".iriograph-overlay-source")
    .getByRole("button", { name: "検証して適用", exact: true }).click();
  await expect(source).toHaveValue(JSON.stringify(changedOverlay, null, 2));
  expect(await readTurtle(page)).toBe(turtleBefore);

  await page.getByRole("button", { name: "図", exact: true }).click();
  await page.locator('button[title="Undo (Ctrl/Cmd+Z)"]').click();
  await page.getByRole("button", { name: /Document/u }).click();
  await expect(source).toHaveValue(JSON.stringify(originalOverlay, null, 2));
  expect(await readTurtle(page)).toBe(turtleBefore);

  await page.getByRole("button", { name: /Document/u }).click();
  await source.locator("xpath=ancestor::details").locator("summary").click();
  const replacedPortableDocument = {
    ...JSON.parse(await portableSource.inputValue()) as Record<string, unknown>,
    documentId: "purchase-approval-e2e-source-replace",
  };
  await portableSource.fill(JSON.stringify(replacedPortableDocument));
  await page.locator(".iriograph-document-boundary")
    .getByRole("button", { name: "文書全体を検証して適用", exact: true }).click();
  await expect(portableSource).toHaveValue(/"documentId": "purchase-approval-e2e-source-replace"/u);
  await page.getByRole("button", { name: "図", exact: true }).click();
  await page.locator('button[title="Undo (Ctrl/Cmd+Z)"]').click();
  await page.getByRole("button", { name: /Document/u }).click();
  await expect(portableSource).toHaveValue(new RegExp(`"documentId": "${originalPortableDocument.documentId}"`, "u"));
  expect(await readTurtle(page)).toBe(turtleBefore);
  expect(consoleErrors).toEqual([]);
});

test("Documentの両source sectionは通常幅・狭幅とも重ならず操作できる", async ({ page }) => {
  await openPurchaseSample(page);
  await page.getByRole("button", { name: /Document/u }).click();

  const overlaySection = page.locator(".iriograph-overlay-source");
  const documentSection = page.locator(".iriograph-document-boundary");
  const overlayDetails = overlaySection.locator("xpath=ancestor::details");
  const documentDetails = documentSection.locator("xpath=ancestor::details");
  for (const width of [1_440, 900]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(overlayDetails).toHaveAttribute("open", "");
    await expect(documentDetails).toHaveAttribute("open", "");
    const overlayBox = await requiredBox(overlaySection, `View overlay section (${width}px)`);
    const documentBox = await requiredBox(documentSection, `Document section (${width}px)`);
    expect(overlayBox.y + overlayBox.height).toBeLessThanOrEqual(documentBox.y);

    await overlaySection.getByRole("button", { name: "JSONを整形", exact: true }).click();
    await documentSection.getByRole("button", { name: "JSONを整形", exact: true }).click();
    await expect(overlaySection.getByLabel("View overlay JSON")).toBeEditable();
    await expect(documentSection.getByLabel("Portable document JSON")).toBeEditable();
  }
});

test("新しい図として複製は元文書を変えず、rebase済みの別working copyをHostが開く", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  await openPurchaseSample(page);
  const originalSource = await readTurtle(page);
  await page.getByRole("button", { name: /Document/u }).click();
  await page.getByRole("button", { name: "新しい図として複製" }).click();
  const dialog = page.getByRole("dialog", { name: "新しい図として複製" });
  await expect(dialog).toContainText("文書内識別子の付け替え");
  await expect(dialog).toContainText("標準・外部語彙、asset、テキストは変更しません");
  const mappedTerms = dialog.getByRole("list", { name: "識別子変更一覧" }).getByRole("listitem");
  expect(await mappedTerms.count()).toBeGreaterThan(0);
  await dialog.getByRole("button", { name: "この内容で複製" }).click();

  await expect(page.getByText("新しい図を別の作業コピーとして開きました")).toBeVisible();
  await expect(page.locator(".document-heading")).toContainText(/^[\s\S]*[0-9a-f-]{20,}/u);
  const copiedDocumentName = (await page.locator(".document-heading strong").textContent())?.trim();
  expect(copiedDocumentName).toBeTruthy();
  await expect(page.getByText("保存済み", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /purchase-approval[.]iriograph/u })).toBeVisible();
  const repositoryReset = page.getByRole("button", { name: "Repositoryへ戻す" });
  await expect(repositoryReset).toBeDisabled();
  await expect(page.getByText("保存した複製にはrepository上の正本がないため戻せません"))
    .toBeVisible();
  await page.getByRole("button", { name: "Turtleタブを開く", exact: true }).click();
  const copiedSource = await page.getByLabel("Turtle source").inputValue();
  expect(copiedSource).not.toBe(originalSource);
  expect(copiedSource).toContain("urn:iriograph:mock:document:");
  expect(copiedSource).toContain("http://www.w3.org/2000/01/rdf-schema#");
  await page.reload();
  await page.locator(".iriograph-editor").waitFor();
  const persistedCopy = page.getByRole("button", {
    name: new RegExp(`${copiedDocumentName}[.]iriograph`, "u"),
  });
  await expect(persistedCopy).toBeVisible();
  await persistedCopy.click();
  await expect(page.locator(".document-heading strong")).toHaveText(copiedDocumentName!);
  expect(await readTurtle(page)).toBe(copiedSource);
  await page.getByRole("button", { name: /purchase-approval[.]iriograph/u }).click();
  await expect(page.locator(".document-heading")).toContainText("purchase-approval");
  await expect(repositoryReset).toBeEnabled();
  expect(await readTurtle(page)).toBe(originalSource);
  expect(consoleErrors).toEqual([]);
});

test("named view管理とtemporary hideをsemantic sourceから分離する", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  await openPurchaseSample(page);
  await expect(page.getByLabel("名前付きビュー", { exact: true })).toHaveText("main");
  const initialNodeCount = await page.locator(".iriograph-scene-node").count();
  expect(initialNodeCount).toBeGreaterThan(0);
  await expect(page.locator(".iriograph-scene-region").filter({ hasText: "業務オペレーション" })).toBeAttached();
  const turtleBefore = await readTurtle(page);

  await page.locator(".iriograph-scene-node").first().click();
  await page.getByRole("button", { name: "一時非表示" }).click();
  await expect(page.locator(".iriograph-scene-node")).toHaveCount(initialNodeCount - 1);
  await expect(page.getByRole("button", { name: /再表示/ })).toContainText("(1)");

  await page.locator(".iriograph-left-sidebar-toggle").click();
  await page.getByRole("button", { name: "ビューを管理" }).click();
  const manager = page.locator(".iriograph-view-dialog");
  await manager.getByRole("button", { name: "このビューを複製" }).click();
  const viewSelect = page.getByLabel("名前付きビュー", { exact: true });
  await expect(viewSelect).toHaveValue("main-copy");
  await expect(viewSelect.locator("option")).toHaveCount(2);

  await manager.getByRole("button", { name: "このビューを設定" }).click();
  await expect(page.locator('.iriograph-view-dialog input[readonly]')).toHaveValue("main-copy");
  await page.locator('.iriograph-view-dialog input[placeholder="ja"]').fill("en-US");
  await page.locator('.iriograph-view-dialog button[type="submit"]').click();
  await expect(manager).toContainText("ビューを管理");

  await manager.getByRole("button", { name: "ビュー調整をリセット" }).click();
  await expect(viewSelect).toHaveValue("main-copy");
  await manager.getByRole("button", { name: "このビューを削除" }).click();
  await manager.getByRole("button", { name: "削除する" }).click();
  await expect(page.getByLabel("名前付きビュー", { exact: true })).toHaveText("main");
  await expect(page.locator(".iriograph-scene-node")).toHaveCount(initialNodeCount - 1);

  const addViewButton = manager.getByRole("button", { name: "ビューを追加" });
  await addViewButton.click();
  await expect(manager).toBeVisible();
  await expect(page.locator('.iriograph-view-dialog input[required]').first()).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(manager).toContainText("ビューを管理");
  await addViewButton.click();
  await page.locator('.iriograph-view-dialog input:not([readonly])').first().fill("audit");
  await page.locator('.iriograph-view-dialog button[type="submit"]').click();
  await expect(viewSelect).toHaveValue("audit");
  await expect(viewSelect.locator("option")).toHaveCount(2);
  await manager.locator("footer").getByRole("button", { name: "閉じる", exact: true }).click();

  await expect.poll(() => readTurtle(page)).toBe(turtleBefore);
  expect(consoleErrors).toEqual([]);
});

test("structured authoringは初期4入口から種類必須の要素と3種類のグループを作る", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  await openPurchaseSample(page);
  const initialNodeCount = await page.locator(".iriograph-scene-node").count();
  const inspector = page.locator(".iriograph-inspector");
  const wizard = inspector.locator(".structured-wizard");
  await expect(wizard.locator(".entry-grid button strong")).toHaveText([
    "新しい要素を作る",
    "関係を作る",
    "要素を変更する",
    "関係を変更する",
  ]);
  await expect(wizard).not.toContainText("IRI");
  await expect(inspector.locator(".iriograph-display-inspector")).not.toBeVisible();

  const turtleBefore = await readTurtle(page);
  await wizard.getByRole("button", { name: /^新しい要素を作る/u }).click();
  await wizard.getByRole("button", { name: /^要素(?:\s|$)/u }).click();
  const next = wizard.getByRole("button", { name: "次へ", exact: true });
  await expect(next).toBeDisabled();
  await expect(wizard.getByRole("status")).toContainText("種類を一つ以上");
  await wizard.getByRole("group", { name: "要素の種類" })
    .getByRole("button", { name: /^処理/u }).click();
  await expect(next).toBeEnabled();
  await next.click();
  const name = wizard.locator(".field-block input");
  await expect(wizard.getByRole("heading", { name: "名前を付ける" })).toBeFocused();
  await name.fill("E2E 種類付き要素");
  await next.click();
  await expect(page.locator(".iriograph-authoring-preview")).toHaveCount(0);
  await expect(wizard.getByRole("heading", { name: "何をしますか？" })).toBeVisible();
  await expect(page.locator(".iriograph-scene-node")).toHaveCount(initialNodeCount + 1);
  await expect(sceneNode(page, "E2E 種類付き要素")).toBeAttached();
  const turtleAfter = await readTurtle(page);
  expect(turtleAfter).toContain('"E2E 種類付き要素"@ja');
  expect(turtleAfter).toContain("role:Process");
  expect(turtleAfter).not.toBe(turtleBefore);

  const groups = [
    { label: "E2E 包含グループ", kind: "包含グループ", className: "iriograph-scene-region" },
    { label: "E2E 順序グループ", kind: "順序付きグループ", className: "sequence-group" },
    { label: "E2E 候補グループ", kind: "候補グループ", className: "alternative-group" },
  ] as const;
  for (const group of groups) {
    await createStructuredGroup(page, group.kind, group.label);
    const frame = groupFrame(page, group.label);
    await expect(frame).toBeAttached();
    await expect(frame).toHaveClass(new RegExp(group.className, "u"));
  }
  expect(consoleErrors).toEqual([]);
});

test("関係作成はdirect/membershipをiconで分け、複数終点を別々のedgeへ保つ", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  await openPurchaseSample(page);
  const inspector = page.locator(".iriograph-inspector");
  const wizard = inspector.locator(".structured-wizard");
  const source = sceneNode(page, "申請を提出");
  const firstTarget = sceneNode(page, "承認結果を登録");
  const secondTarget = sceneNode(page, "完了");
  const initialEdgeCount = await page.locator(".iriograph-edge-group").count();
  const geometryBefore = await canvasGeometrySnapshot(page);
  const turtleBefore = await readTurtle(page);

  await wizard.getByRole("button", { name: /^関係を作る/u }).click();
  const direct = wizard.getByRole("button", { name: /^線でつなぐ/u });
  const membership = wizard.getByRole("button", { name: /^グループへ所属させる/u });
  await expect(direct.locator(".family-icon.direct")).toBeVisible();
  await expect(membership.locator(".family-icon.membership")).toBeVisible();
  await direct.click();
  await wizard.getByRole("button", { name: "Canvasから始点を選ぶ", exact: true }).click();
  await source.click();
  await expect(wizard.locator(".canvas-chip")).toContainText("申請を提出");
  await wizard.getByRole("button", { name: "次へ", exact: true }).click();
  await wizard.getByRole("button", { name: "Canvasから接続先を選ぶ", exact: true }).click();
  await firstTarget.click();
  await secondTarget.click({ modifiers: ["Control"] });
  const targetChips = wizard.locator(".chip-list .canvas-chip");
  await expect(targetChips).toHaveCount(2);
  await expect(targetChips.nth(0)).toContainText("承認結果を登録");
  await expect(targetChips.nth(1)).toContainText("完了");
  await wizard.getByRole("button", { name: "次へ", exact: true }).click();
  const relation = wizard.locator(".predicate-card")
    .filter({ hasText: "業務要素間の一般的な関係" });
  await expect(relation).toContainText("A（関連する）B");
  await relation.click();
  await wizard.getByRole("button", { name: "次へ", exact: true }).click();

  await expect(page.locator(".iriograph-edge-group")).toHaveCount(initialEdgeCount + 2);
  await expect(page.locator('.iriograph-edge-group[aria-label*="申請を提出から承認結果を登録への関連する"]')).toBeAttached();
  await expect(page.locator('.iriograph-edge-group[aria-label*="申請を提出から完了への関連する"]')).toBeAttached();
  await expect.poll(async () => JSON.stringify(await canvasGeometrySnapshot(page)))
    .toBe(JSON.stringify(geometryBefore));
  expect(await readTurtle(page)).not.toBe(turtleBefore);
  expect(consoleErrors).toEqual([]);
});

test("predicate階層はlabelだけで説明し、通常presentation DOMへ生IRIを渡さない", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  await openPurchaseSample(page);
  await page.getByRole("button", { name: /Turtle/u }).click();
  const source = page.getByLabel("Turtle source");
  const sourceWithHierarchy = (await source.inputValue()).replace(
    "wf:p-01 a rdf:Property ;",
    "wf:p-01 a rdf:Property ;\n  rdfs:subPropertyOf <http://purl.org/dc/terms/relation> ;",
  );
  await source.fill(sourceWithHierarchy);
  await page.getByRole("button", { name: "検証して適用", exact: true }).click();
  await page.getByRole("button", { name: "図", exact: true }).click();

  const inspector = page.locator(".iriograph-inspector");
  const wizard = inspector.locator(".structured-wizard");
  await sceneNode(page, "内容を審査").click();
  await sceneNode(page, "完了").click({ modifiers: ["Control"] });
  await wizard.getByRole("button", { name: /^関係を作る/u }).click();
  await wizard.getByRole("button", { name: /^線でつなぐ/u }).click();
  await wizard.getByRole("button", { name: "次へ", exact: true }).click();
  await wizard.getByRole("button", { name: "次へ", exact: true }).click();
  const relation = wizard.locator(".predicate-card")
    .filter({ hasText: "業務要素間の一般的な関係" });
  await expect(relation.locator(".predicate-hierarchy")).toContainText("意味上の上位関係");
  await expect(relation.locator(".predicate-hierarchy")).toContainText("関連する");
  const renderedPresentation = await wizard.evaluate((root) => [root, ...root.querySelectorAll("*")]
    .map((element) => [
      element.textContent ?? "",
      ...[...element.attributes].map((attribute) => `${attribute.name}=${attribute.value}`),
    ].join("\n")).join("\n"));
  expect(renderedPresentation).not.toMatch(/(?:https?:\/\/|urn:)/u);
  expect(renderedPresentation).not.toContain("rdf:");
  expect(renderedPresentation).not.toContain("rdfs:");
  expect(consoleErrors).toEqual([]);
});

test("順序グループはinline新規memberをatomicに追加・並べ替えし、derived guideから解除できる", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  await openPurchaseSample(page);
  const wizard = page.locator(".structured-wizard");
  const sequence = groupFrame(page, "承認");
  const turtleBefore = await readTurtle(page);
  await beginMembershipFlow(page, sequence);
  await expect(wizard.locator(".chip-list")).toContainText("承認結果を登録");
  await expect(wizard.locator(".chip-list")).toContainText("完了");

  await wizard.locator("details.inline-create summary").click();
  await wizard.getByLabel("新しい要素の名前", { exact: true }).fill("E2E Seq inline");
  await wizard.getByRole("group", { name: "新しい要素の種類" })
    .getByRole("button", { name: /^処理/u }).click();
  await wizard.getByRole("button", { name: "一覧へ追加", exact: true }).click();
  await expect(wizard.locator(".chip-list")).toContainText("E2E Seq inline");
  await expect(sceneNode(page, "E2E Seq inline")).toHaveCount(0);
  expect(await readTurtle(page)).toBe(turtleBefore);

  await wizard.getByRole("button", { name: "次へ", exact: true }).click();
  const order = wizard.locator(".ordered-members");
  await expect(order).toContainText("E2E Seq inline");
  await order.getByRole("button", { name: "E2E Seq inlineを上へ", exact: true }).click();
  const orderLabels = await order.locator("li strong").allTextContents();
  expect(orderLabels.indexOf("E2E Seq inline")).toBeLessThan(orderLabels.indexOf("完了"));
  await wizard.getByRole("button", { name: "次へ", exact: true }).click();
  await expect(wizard.getByRole("heading", { name: "何をしますか？" })).toBeVisible();
  await expect(sceneNode(page, "E2E Seq inline")).toBeAttached();
  const turtleAfterAdd = await readTurtle(page);
  expect(turtleAfterAdd).toContain('"E2E Seq inline"@ja');
  expect(turtleAfterAdd).toContain("role:Process");
  await saveAndReloadPurchaseSample(page);
  await expect(sceneNode(page, "E2E Seq inline")).toBeAttached();
  expect(await readTurtle(page)).toContain('"E2E Seq inline"@ja');

  const groupElementId = await sequence.getAttribute("data-element-id");
  expect(groupElementId).toBeTruthy();
  const guide = page.locator(`.iriograph-group-guide.guide-sequence-order[data-group-element-id="${groupElementId}"]`).first();
  await guide.dispatchEvent("contextmenu", { clientX: 640, clientY: 360 });
  await page.getByRole("menu", { name: "選択対象の操作" })
    .getByRole("menuitem", { name: "順序を編集", exact: true }).click();
  const sequenceEditor = page.getByLabel("並び順を編集");
  await expect(sequenceEditor).toContainText("E2E Seq inline");
  await sequenceEditor.getByRole("button", { name: "E2E Seq inlineを並び順から外す", exact: true }).click();
  await sequenceEditor.getByRole("button", { name: "並び順を更新", exact: true }).click();
  await expect(sceneNode(page, "E2E Seq inline")).toBeAttached();
  await expect.poll(() => readTurtle(page)).not.toBe(turtleAfterAdd);
  expect(consoleErrors).toEqual([]);
});

test("候補グループはmember追加と既定選択をまとめ、derived guideから候補だけを解除する", async ({ page }) => {
  await openPurchaseSample(page);
  const wizard = page.locator(".structured-wizard");
  const alternative = groupFrame(page, "承認？");
  const added = sceneNode(page, "承認ポリシー");
  await beginMembershipFlow(page, alternative);
  await wizard.getByRole("button", { name: "Canvasから要素を選ぶ", exact: true }).click();
  await added.click();
  await expect(wizard.locator(".chip-list")).toContainText("承認ポリシー");
  await wizard.getByRole("button", { name: "次へ", exact: true }).click();
  const defaults = wizard.getByRole("group", { name: "既定候補" });
  await defaults.getByRole("button", { name: /^承認ポリシー/u }).click();
  await expect(defaults.getByRole("button", { name: /^承認ポリシー/u }))
    .toHaveAttribute("aria-pressed", "true");
  await wizard.getByRole("button", { name: "次へ", exact: true }).click();
  await expect(added.locator(".iriograph-alternative-default-badges")).toBeVisible();
  await saveAndReloadPurchaseSample(page);
  await expect(sceneNode(page, "承認ポリシー").locator(".iriograph-alternative-default-badges"))
    .toBeVisible();

  const groupElementId = await alternative.getAttribute("data-element-id");
  expect(groupElementId).toBeTruthy();
  const guide = page.locator(`.iriograph-group-guide.guide-alternative-candidate[data-group-element-id="${groupElementId}"]`).first();
  await guide.dispatchEvent("contextmenu", { clientX: 660, clientY: 380 });
  await page.getByRole("menu", { name: "選択対象の操作" })
    .getByRole("menuitem", { name: "候補グループを編集", exact: true }).click();
  const alternativeEditor = page.getByRole("region", { name: "候補グループを編集", exact: true });
  const policyItem = alternativeEditor.locator("li").filter({ hasText: "承認ポリシー" });
  await policyItem.getByRole("button", { name: "承認ポリシーを候補から外す", exact: true }).click();
  await alternativeEditor.locator("li").filter({ hasText: "承認" }).first()
    .locator('input[type="radio"]').check();
  await alternativeEditor.getByRole("button", { name: "候補グループを更新", exact: true }).click();
  await expect(added.locator(".iriograph-alternative-default-badges")).toHaveCount(0);
});

test("要素詳細はlocalized名前・説明とexact membershipの追加削除を一度に保存する", async ({ page }) => {
  await openPurchaseSample(page);
  let review = sceneNode(page, "内容を審査");
  const turtleBefore = await readTurtle(page);
  await openElementDetailsFromContext(page, review);
  let dialog = page.getByRole("dialog", { name: "内容を審査" });
  await dialog.getByRole("button", { name: "別名を追加", exact: true }).click();
  await dialog.locator('textarea[data-new-text][data-new-text^="new-text-"]').last().fill("E2E review alias");
  await dialog.getByRole("button", { name: "説明を追加", exact: true }).click();
  await dialog.locator('textarea[data-new-text][data-new-text^="new-text-"]').last().fill("E2E review comment\nsecond line");
  const memberships = dialog.locator(".iriograph-structured-memberships");
  await expect(memberships).toContainText("業務オペレーション");
  await expect(memberships).toContainText("監査対象");
  await memberships.locator("li").filter({ hasText: "業務オペレーション" })
    .locator('input[type="checkbox"]').check();
  await dialog.getByRole("button", { name: "変更を保存", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const turtleAfterAdd = await readTurtle(page);
  expect(turtleAfterAdd).not.toBe(turtleBefore);
  expect(turtleAfterAdd).toContain('"E2E review alias"@ja');
  expect(turtleAfterAdd).toContain('"E2E review comment\\nsecond line"@ja');

  review = sceneNode(page, "E2E review alias");
  await openElementDetailsFromContext(page, review);
  dialog = page.getByRole("dialog", { name: "E2E review alias" });
  await expect(dialog.locator(".iriograph-structured-memberships")).not.toContainText("業務オペレーション");
  await expect(dialog.locator(".iriograph-structured-memberships")).toContainText("監査対象");
  await (await textareaWithValue(dialog, "E2E review alias")).locator("xpath=..").getByRole("button", { name: "削除", exact: true }).click();
  await (await textareaWithValue(dialog, "E2E review comment\nsecond line")).locator("xpath=..").getByRole("button", { name: "削除", exact: true }).click();
  await dialog.getByRole("button", { name: "変更を保存", exact: true }).click();
  await expect.poll(() => readTurtle(page)).not.toContain("E2E review alias");
  expect(await readTurtle(page)).not.toContain("E2E review comment");
});

test("意味/ビューtabを排他表示し、対象別context menuは選択だけで正本を変えない", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  await openPurchaseSample(page);
  await expect(page.locator(".iriograph-zoom-actions .zoom-value")).not.toHaveText("100%");
  const turtleBefore = await readTurtle(page);
  const inspector = page.locator(".iriograph-inspector");
  const modeTabs = inspector.locator(".iriograph-inspector-mode-tabs");
  const semanticTab = modeTabs.getByRole("button", { name: "意味", exact: true });
  const appearanceTab = modeTabs.getByRole("button", { name: "ビュー", exact: true });
  await expect(semanticTab).toHaveAttribute("aria-pressed", "true");
  await expect(inspector.locator(".structured-wizard")).toBeVisible();
  await expect(inspector.locator(".iriograph-display-inspector")).not.toBeVisible();

  await appearanceTab.click();
  await expect(appearanceTab).toHaveAttribute("aria-pressed", "true");
  await expect(inspector.locator(".structured-wizard")).not.toBeVisible();
  await expect(inspector.locator(".iriograph-display-inspector")).toBeVisible();
  await semanticTab.click();
  await expect(inspector.locator(".structured-wizard")).toBeVisible();
  await expect(inspector.locator(".iriograph-display-inspector")).not.toBeVisible();

  await expectTargetContextMenu(page, sceneNode(page, "内容を審査"), [
    "要素の詳細", "関係を追加", "所属を編集", "要素のビュー", "アイコン", "要素を削除",
  ]);
  await expectTargetContextMenu(page, page.locator(".iriograph-edge-group").first(), [
    "関係の詳細", "接続先を変更", "線のビュー", "線の経路をリセット", "関係を削除",
  ]);
  await expectTargetContextMenu(page, page.locator(".iriograph-group-guide.guide-sequence-order").first(), ["順序を編集"]);
  await expectTargetContextMenu(page, page.locator(".iriograph-group-guide.guide-alternative-candidate").first(), ["候補グループを編集"]);
  await expectTargetContextMenu(page, groupFrame(page, "購入申請フロー"), [
    "グループの詳細", "順序を編集", "グループのビュー", "要素に合わせる", "グループを削除",
  ]);
  await expectTargetContextMenu(page, page.locator(".iriograph-diagram-canvas"), ["要素を追加", "貼り付け"]);
  expect(await readTurtle(page)).toBe(turtleBefore);
  expect(consoleErrors).toEqual([]);
});

test("nodeの形とpackage/workspace icon、label/icon配置をビューだけで編集・履歴復元する", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  await page.setViewportSize({ width: 1000, height: 820 });
  await openPurchaseSample(page);
  const turtleBefore = await readTurtle(page);
  const inspector = page.locator(".iriograph-inspector");
  const review = page.locator(".iriograph-scene-node").filter({ hasText: "内容を審査" });

  await review.dispatchEvent("contextmenu", { clientX: 600, clientY: 310 });
  await page.getByRole("menu", { name: "選択対象の操作" })
    .getByRole("menuitem", { name: "要素のビュー", exact: true }).click();
  await expect(inspector.locator(".iriograph-inspector-mode-tabs")
    .getByRole("button", { name: "ビュー", exact: true })).toHaveAttribute("aria-pressed", "true");

  const templates = inspector.locator('.iriograph-template-choices[role="radiogroup"]');
  await expect(templates).toBeVisible();
  await expect.poll(() => templates.locator(".iriograph-template-preview").count())
    .toBeGreaterThan(1);
  await expect(templates).not.toContainText("urn:");
  const templateButtons = templates.locator("button");
  const alternateTemplateIndex = (await templateButtons.evaluateAll((buttons) => (
    buttons.map((button) => button.getAttribute("aria-pressed")).indexOf("false")
  )));
  expect(alternateTemplateIndex).toBeGreaterThanOrEqual(0);
  const alternateTemplate = templateButtons.nth(alternateTemplateIndex);
  await alternateTemplate.click();
  await expect(alternateTemplate).toHaveAttribute("aria-pressed", "true");
  await page.locator('button[title="Undo (Ctrl/Cmd+Z)"]').click();
  await expect(alternateTemplate).toHaveAttribute("aria-pressed", "false");
  await page.locator('button[title="Redo (Ctrl/Cmd+Y)"]').click();
  await expect(alternateTemplate).toHaveAttribute("aria-pressed", "true");

  const packageIcons = inspector.locator('.iriograph-package-icon-choices[role="radiogroup"]');
  const iconPanel = inspector.locator("details.iriograph-inspector-section").filter({ hasText: "アイコンと内容" });
  if (await iconPanel.getAttribute("open") === null) {
    await iconPanel.locator(":scope > summary").click();
  }
  const iconSection = inspector.locator(".iriograph-package-icon-disclosure");
  await iconSection.locator(":scope > summary").click();
  await expect(iconSection).toHaveAttribute("open", "");
  await expect.poll(() => packageIcons.locator("button").count()).toBeGreaterThan(5);
  await expect(packageIcons.locator("img")).toHaveCount(
    await packageIcons.locator("button").count() - 1,
  );
  const packageIcon = packageIcons.getByRole("button", { name: "クラウド", exact: true });
  await packageIcon.click();
  await expect(packageIcon).toHaveAttribute("aria-pressed", "true");
  await expect(review.locator(".iriograph-node-icon")).toHaveAttribute("src", /^data:image\/svg\+xml/u);

  const workspacePath = inspector.locator("input[list]");
  await expect(workspacePath).toHaveCount(1);
  const datalistId = await workspacePath.getAttribute("list");
  expect(datalistId).toBeTruthy();
  await expect.poll(() => page.locator(`#${datalistId} option`).allTextContents()).toEqual(expect.arrayContaining([
    "user-task.svg",
    "service-task.svg",
    "reference.svg",
    "approval-policy.svg",
  ]));
  await workspacePath.fill("assets/icons/approval-policy.svg");
  await workspacePath.dispatchEvent("change");
  await expect(workspacePath).toHaveValue("assets/icons/approval-policy.svg");
  await expect(review.locator(".iriograph-node-icon")).toHaveAttribute("src", /^blob:/u);
  await workspacePath.fill("urn:iriograph:manual-input-is-not-accepted");
  await workspacePath.dispatchEvent("change");
  await expect(workspacePath).toHaveValue("assets/icons/approval-policy.svg");

  const label = review.locator('.iriograph-node-text[title="ドラッグしてラベル位置を調整"]');
  const icon = review.locator('.iriograph-node-icon[title="ドラッグしてアイコン位置を調整"]');
  const initialLabelTransform = await label.evaluate((element) => (
    (element as HTMLElement).style.transform
  ));
  const initialIconTransform = await icon.evaluate((element) => (
    (element as HTMLElement).style.transform
  ));
  await dispatchPointerDrag(page, label, await requiredBox(label, "node label"), 24, 10);
  await expect.poll(async () => label.evaluate((element) => (
    (element as HTMLElement).style.transform
  ))).not.toBe(initialLabelTransform);
  const draggedLabelTransform = await label.evaluate((element) => (
    (element as HTMLElement).style.transform
  ));
  await dispatchPointerDrag(page, icon, await requiredBox(icon, "node icon"), -18, 12);
  await expect.poll(async () => icon.evaluate((element) => (
    (element as HTMLElement).style.transform
  ))).not.toBe(initialIconTransform);
  const draggedIconTransform = await icon.evaluate((element) => (
    (element as HTMLElement).style.transform
  ));

  await page.locator('button[title="Undo (Ctrl/Cmd+Z)"]').click();
  await expect.poll(async () => icon.evaluate((element) => (
    (element as HTMLElement).style.transform
  ))).toBe(initialIconTransform);
  await expect.poll(async () => label.evaluate((element) => (
    (element as HTMLElement).style.transform
  ))).toBe(draggedLabelTransform);
  await page.locator('button[title="Redo (Ctrl/Cmd+Y)"]').click();
  await expect.poll(async () => icon.evaluate((element) => (
    (element as HTMLElement).style.transform
  ))).toBe(draggedIconTransform);

  await inspector.getByRole("button", { name: "ラベル位置を戻す" }).click();
  await expect.poll(async () => label.evaluate((element) => (
    (element as HTMLElement).style.transform
  ))).toBe(initialLabelTransform);
  await inspector.getByRole("button", { name: "アイコン位置を戻す" }).click();
  await expect.poll(async () => icon.evaluate((element) => (
    (element as HTMLElement).style.transform
  ))).toBe(initialIconTransform);
  await page.locator('button[title="Undo (Ctrl/Cmd+Z)"]').click();
  await expect.poll(async () => icon.evaluate((element) => (
    (element as HTMLElement).style.transform
  ))).toBe(draggedIconTransform);
  await page.locator('button[title="Redo (Ctrl/Cmd+Y)"]').click();
  await expect.poll(async () => icon.evaluate((element) => (
    (element as HTMLElement).style.transform
  ))).toBe(initialIconTransform);

  expect(await readTurtle(page)).toBe(turtleBefore);
  expect(consoleErrors).toEqual([]);
});

test("意味側のedge端子dropは接続先を直接atomic更新し、個別説明をTurtleへ保存する", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  await openPurchaseSample(page);
  const turtleBefore = await readTurtle(page);
  const edge = page.locator('.iriograph-edge-group[aria-label*="内容を審査から承認ポリシーへの関連する"]');
  await expect(edge).toHaveCount(1);
  await edge.dispatchEvent("click");
  const inspector = page.locator(".iriograph-inspector");

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
  await expect.poll(() => readTurtle(page)).not.toBe(turtleBefore);
  await expect(inspector.locator(".iriograph-authoring-preview")).toHaveCount(0);
  await expect(page.getByText("配置を完了できません", { exact: true })).toHaveCount(0);
  const reconnected = page.locator(".iriograph-edge-group").filter({ hasText: "関連する" });
  await reconnected.click();
  const wizard = inspector.locator(".structured-wizard");
  await wizard.getByRole("button", { name: /^関係を変更する/u }).click();
  await wizard.getByRole("button", { name: "関係の意味を変更", exact: true }).click();
  await expect(inspector.locator(".iriograph-intent-selection")).toContainText("終点完了");

  await inspector.getByRole("button", { name: "説明を追加" }).click();
  await inspector.getByRole("textbox", { name: "この関係だけの説明 1", exact: true })
    .fill("E2Eの関係固有説明\n二行目");
  await inspector.getByRole("button", { name: "関係を更新" }).click();

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

  await openPurchaseSample(page);
  const turtleBefore = await readTurtle(page);
  const undo = page.locator('button[title="Undo (Ctrl/Cmd+Z)"]');
  await expect(undo).toBeDisabled();
  await expect(page.locator(".topbar .status-pill.neutral")).toHaveText("保存済み");

  const grid = page.locator(".iriograph-canvas-grid");
  await expect(grid).toBeVisible();
  await expect(grid).toHaveCSS("pointer-events", "none");
  await expect(grid).toHaveCSS("opacity", "1");
  await expect(grid).not.toHaveCSS("background-image", "none");
  const gridMetrics = await grid.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      snap: Number.parseFloat(style.getPropertyValue("--iriograph-grid-size")),
      visualStep: Number.parseFloat(style.getPropertyValue("--iriograph-grid-visual-step")),
      lineWidth: Number.parseFloat(style.getPropertyValue("--iriograph-grid-line-width")),
    };
  });
  expect(gridMetrics.snap).toBe(8);
  expect(gridMetrics.visualStep).toBeGreaterThanOrEqual(gridMetrics.snap);
  expect(gridMetrics.visualStep % gridMetrics.snap).toBe(0);
  expect(gridMetrics.lineWidth).toBeGreaterThanOrEqual(1);

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

  await openPurchaseSample(page);
  const turtleBefore = await readTurtle(page);
  expect(turtleBefore).toContain("wf:n-03 a role:Process, wf:HumanStep, wf:AuditedStep");
  await expect(page.locator(".iriograph-scene-region").filter({ hasText: "業務オペレーション" })).toBeAttached();
  await expect(groupFrame(page, "購入申請フロー")).toHaveClass(/sequence-group/u);
  await expect(sceneNode(page, "内容を審査")).toBeAttached();
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
  await expect(page.locator(".iriograph-scene-region").filter({ hasText: "人が行う工程" })).toHaveCount(0);
  await expect(page.locator(".iriograph-scene-region").filter({ hasText: "監査対象工程" })).toHaveCount(0);
  const typeTag = review.locator(".iriograph-node-type-tag");
  await expect(typeTag).toHaveText("監査対象工程");
  await typeTag.click();
  const typeSurface = page.locator(".iriograph-type-list-surface");
  await expect(typeSurface.getByRole("heading", { name: "型一覧" })).toBeVisible();
  await expect(typeSurface.getByRole("heading", { name: "監査対象工程" })).toBeVisible();
  expect(await typeSurface.innerHTML()).not.toMatch(/urn:|https?:\/\/|IRI/u);
  await typeSurface.getByRole("button", { name: "図で表示", exact: true }).click();
  await expect(review).toHaveClass(/type-highlight/u);

  await audit.dispatchEvent("contextmenu", { clientX: 680, clientY: 420 });
  await page.getByRole("menu", { name: "選択対象の操作" })
    .getByRole("menuitem", { name: "グループのビュー", exact: true }).click();
  const inspector = page.locator(".iriograph-inspector");
  const appearance = inspector.getByLabel("ビューを編集");
  const opacityRow = appearance.locator("label").filter({ hasText: "領域の透明度" });
  await opacityRow.locator('input[type="checkbox"]').check();
  await opacityRow.locator('input[type="range"]').fill("0.35");
  await expect(audit.locator(".iriograph-region-fill")).toHaveCSS("opacity", "0.35");
  await expect(appearance.getByRole("button", { name: "適用", exact: true })).toHaveCount(0);
  await expect(appearance.getByRole("button", { name: "閉じる", exact: true })).toHaveCount(0);
  expect(await readTurtle(page)).toBe(turtleBefore);

  await page.keyboard.press("Escape");
  await review.click();
  const resizeHandles = page.locator(".iriograph-transient-resize-layer .iriograph-resize-handle");
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

  await openPurchaseSample(page);
  const nodes = page.locator(".iriograph-scene-node");
  expect(await nodes.count()).toBeGreaterThanOrEqual(3);
  await page.getByRole("button", { name: /Turtle/ }).click();
  const semanticSource = await page.getByLabel("Turtle source").inputValue();
  await page.getByRole("button", { name: "図", exact: true }).click();

  // Region viewは単一parentを持たないため、同じ業務領域内の既知nodeを
  // semantic labelで選び、multi-selectionのpresentation操作を検証する。
  const selectedNodes = [
    nodes.filter({ hasText: "承認結果を登録" }),
    nodes.filter({ hasText: "内容を修正" }),
    nodes.filter({ hasText: "完了" }),
  ];
  for (const selected of selectedNodes) await expect(selected).toHaveCount(1);

  const firstBox = await requiredBox(selectedNodes[0]!, "marquee target");
  const firstCenter = {
    x: firstBox.x + firstBox.width / 2,
    y: firstBox.y + firstBox.height / 2,
  };
  const marqueeOrigin = await page.evaluate((target) => {
    const viewport = document.querySelector<HTMLElement>(".iriograph-canvas-scroll")
      ?.getBoundingClientRect();
    if (!viewport) return undefined;
    for (let y = viewport.top + 12; y < viewport.bottom - 12; y += 12) {
      for (let x = viewport.left + 12; x < viewport.right - 12; x += 12) {
        if (Math.hypot(x - target.x, y - target.y) < 80) continue;
        const hit = document.elementFromPoint(x, y);
        if (hit?.matches(".iriograph-diagram-canvas, .iriograph-scene-region")) return { x, y };
      }
    }
    return undefined;
  }, firstCenter);
  expect(marqueeOrigin).toBeTruthy();
  await page.mouse.move(marqueeOrigin!.x, marqueeOrigin!.y);
  await page.mouse.down();
  await page.mouse.move(firstCenter.x + 8, firstCenter.y + 8, { steps: 4 });
  await expect(page.locator(".iriograph-selection-marquee")).toBeVisible();
  await page.mouse.up();
  await expect(selectedNodes[0]!).toHaveClass(/selected/u);
  await expect(page.locator(".iriograph-selection-marquee")).toHaveCount(0);

  await page.mouse.click(marqueeOrigin!.x, marqueeOrigin!.y);
  await expect(page.locator(".iriograph-scene-node.selected")).toHaveCount(0);
  await selectedNodes[0]!.click();
  await page.locator(".iriograph-inspector-mode-tabs")
    .getByRole("button", { name: "ビュー", exact: true }).click();
  await expect(selectedNodes[0]!).toHaveClass(/selected/u);
  await selectedNodes[1]!.click({ modifiers: ["Control"] });
  await selectedNodes[2]!.click({ modifiers: ["Control"] });
  await expect(page.locator(".iriograph-scene-node.selected")).toHaveCount(3);
  await expect(page.getByText("3 selected", { exact: true }).first()).toBeVisible();

  const targetSnap = page.getByRole("button", { name: "要素snap" });
  if (await targetSnap.getAttribute("aria-pressed") === "true") await targetSnap.click();
  const before = await Promise.all(selectedNodes.map(async (selected) => ({
    left: await numericSceneCoordinate(selected, "x"),
    top: await numericSceneCoordinate(selected, "y"),
  })));
  await dispatchPointerDrag(
    page,
    selectedNodes[0]!,
    await requiredBox(selectedNodes[0]!, "selected group anchor"),
    17,
    13,
  );
  await expect.poll(() => numericSceneCoordinate(selectedNodes[0]!, "x"))
    .not.toBe(before[0]!.left);
  const moved = await Promise.all(selectedNodes.map(async (selected) => ({
    left: await numericSceneCoordinate(selected, "x"),
    top: await numericSceneCoordinate(selected, "y"),
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
    await expect.poll(() => numericSceneCoordinate(selectedNodes[index]!, "x"))
      .toBeCloseTo(before[index]!.left, 0);
    await expect.poll(() => numericSceneCoordinate(selectedNodes[index]!, "y"))
      .toBeCloseTo(before[index]!.top, 0);
  }

  await page.getByRole("button", { name: "左揃え" }).click();
  await expect.poll(async () => new Set(await Promise.all(
    selectedNodes.map((selected) => numericSceneCoordinate(selected, "x")),
  )).size).toBeLessThan(new Set(before.map((geometry) => geometry.left)).size);
  await page.locator('button[title="Undo (Ctrl/Cmd+Z)"]').click();
  for (let index = 0; index < before.length; index += 1) {
    await expect.poll(() => numericSceneCoordinate(selectedNodes[index]!, "x"))
      .toBeCloseTo(before[index]!.left, 0);
  }

  const beforeDistribution = await Promise.all(selectedNodes.map(async (selected, index) => ({
    index,
    x: await numericSceneCoordinate(selected, "x"),
    width: await numericSceneCoordinate(selected, "width"),
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
  await expect.poll(() => numericSceneCoordinate(
    selectedNodes[beforeDistribution[1]!.index]!, "x",
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

  await openPurchaseSample(page);
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
  const routeMode = page.getByLabel("線の形式");
  const routing = routeMode.locator("xpath=ancestor::details");
  await expect(routing).toBeVisible();

  await routeMode.selectOption("straight");
  await expect(routeMode).toHaveValue("straight");
  await expect(page.locator(".iriograph-waypoints circle")).toHaveCount(0);
  await expect(selfLoop.locator(".iriograph-edge-path")).not.toHaveAttribute("d", /[CQ]/u);

  await routeMode.selectOption("curve");
  await expect(routeMode).toHaveValue("curve");
  await expect(page.locator(".iriograph-waypoints circle")).toHaveCount(0);
  const curvePath = selfLoop.locator(".iriograph-edge-path");
  await expect(curvePath).toHaveCount(1);
  await expect(curvePath).toHaveAttribute("d", /^M .* C /u);
  await expect(curvePath).not.toHaveAttribute("d", /[LQ]/u);

  await routing.getByRole("button", { name: "曲線点を追加" }).click();
  await expect(page.locator(".iriograph-curve-knot")).toHaveCount(1);
  await expect(page.locator(".iriograph-curve-handle")).toHaveCount(4);
  await page.locator(".topbar").getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByText("browser working copyを保存しました")).toBeVisible();
  const savedCurveOverlay = await page.evaluate(() => {
    const source = window.localStorage.getItem(
      "iriograph.mock.workspace:models/purchase-approval.iriograph",
    );
    if (!source) return undefined;
    const saved = JSON.parse(source) as {
      views: Array<{ overlay: Record<string, {
        routing?: { routeMode?: string; curve?: { knots?: unknown[] } };
      }> }>;
    };
    return Object.values(saved.views[0]?.overlay ?? {}).find(
      (entry) => entry.routing?.curve?.knots?.length === 1,
    );
  });
  expect(savedCurveOverlay).toMatchObject({
    routing: { routeMode: "curve", curve: { knots: [expect.any(Object)] } },
  });

  await openPurchaseSample(page);
  await selfLoop.dispatchEvent("click");
  await page.locator(".iriograph-inspector-mode-tabs")
    .getByRole("button", { name: "ビュー", exact: true }).click();
  await expect(routeMode).toHaveValue("curve");
  await expect(page.locator(".iriograph-curve-knot")).toHaveCount(1);
  await expect(curvePath).toHaveAttribute("d", /^M .* C /u);
  await expect(curvePath).not.toHaveAttribute("d", /[LQ]/u);

  await routing.getByRole("button", { name: "曲線点 1を削除" }).click();
  await expect(page.locator(".iriograph-curve-knot")).toHaveCount(0);
  await expect(page.locator(".iriograph-curve-handle")).toHaveCount(2);
  await expect(curvePath).toHaveAttribute("d", /^M .* C /u);
  await routing.getByRole("button", { name: "曲線点を追加" }).click();
  await expect(page.locator(".iriograph-curve-knot")).toHaveCount(1);
  await routing.getByRole("button", { name: "自動曲線へ戻す" }).click();
  await expect(page.locator(".iriograph-curve-knot")).toHaveCount(0);
  await expect(page.locator(".iriograph-curve-handle")).toHaveCount(2);

  const connection = page.getByText("接続点と端子", { exact: true })
    .locator("xpath=ancestor::details");
  await connection.locator("summary").click();
  await connection.getByRole("combobox", { name: "始点の端子形状" }).selectOption("diamond");
  await connection.getByRole("combobox", { name: "終点の端子形状" }).selectOption("circle");
  await expect(selfLoop.locator(".iriograph-edge-path")).toHaveAttribute("marker-start", /diamond/u);
  await expect(selfLoop.locator(".iriograph-edge-path")).toHaveAttribute("marker-end", /circle/u);
  expect(await readTurtle(page)).toBe(turtleBefore);

  await routeMode.selectOption("manual");
  await routing.getByRole("button", { name: "経路点を追加" }).click();
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

  const edgeLabelSection = page.getByText("ラベルとビュー補足", { exact: true })
    .locator("xpath=ancestor::details");
  await edgeLabelSection.locator("summary").click();
  await edgeLabelSection.getByRole("button", { name: "ラベル位置をリセット" }).click();
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

  await openPurchaseSample(page);
  const viewport = page.locator(".iriograph-canvas-scroll");
  await page.locator(".iriograph-zoom-actions .zoom-value").click();
  await expect(page.locator(".iriograph-zoom-actions .zoom-value")).toHaveText("100%");

  await viewport.focus();
  const activeBefore = await viewport.getAttribute("aria-activedescendant");
  const pageScrollBefore = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }));
  const beforeArrowPan = await scrollPosition(viewport);
  await page.keyboard.press("ArrowRight");
  await expect.poll(async () => (await scrollPosition(viewport)).left).toBeGreaterThan(beforeArrowPan.left);
  await page.keyboard.press("n");
  await expect(viewport).not.toHaveAttribute("aria-activedescendant", activeBefore ?? "");
  const beforePagePan = await scrollPosition(viewport);
  await page.keyboard.press("Shift+PageDown");
  await expect.poll(async () => (await scrollPosition(viewport)).left).toBeGreaterThan(beforePagePan.left);
  expect(await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }))).toEqual(pageScrollBefore);

  const grid = page.locator(".iriograph-canvas-grid");
  await dispatchPointerDrag(page, grid, await requiredBox(grid, "canvas grid"), -48, -32);
  await expect.poll(async () => (await scrollPosition(viewport)).left).toBeGreaterThan(100);

  await page.locator(".iriograph-minimap svg").click({ position: { x: 150, y: 94 } });
  const minimapPosition = await scrollPosition(viewport);
  expect(minimapPosition.left).toBeGreaterThan(300);

  await page.getByLabel("左サイドバーを開く").click();
  await page.locator(".iriograph-element-list button").filter({ hasText: "開始" }).first().click();
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

  await openPurchaseSample(page);
  const canvasShell = page.locator(".iriograph-canvas-shell");
  const viewport = page.locator(".iriograph-canvas-scroll");
  await expect(canvasShell.locator('[tabindex="0"]')).toHaveCount(1);
  await expect(viewport).toHaveAttribute("role", "listbox");

  const node = page.locator(".iriograph-scene-node").first();
  await node.click();
  const turtleBefore = await readTurtle(page);
  const initialLeft = await numericStyle(node, "left");
  await viewport.focus();
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => numericStyle(node, "left")).toBeCloseTo(initialLeft + 1, 0);
  expect(await readTurtle(page)).toBe(turtleBefore);
  await page.locator('button[title="Undo (Ctrl/Cmd+Z)"]').click();
  await expect.poll(() => numericStyle(node, "left")).toBeCloseTo(initialLeft, 0);

  await viewport.focus();
  await page.keyboard.press("Shift+ArrowRight");
  await expect.poll(() => numericStyle(node, "left")).toBeCloseTo(initialLeft + 10, 0);
  await page.locator('button[title="Undo (Ctrl/Cmd+Z)"]').click();
  await viewport.focus();
  const activeBeforeNavigation = await viewport.getAttribute("aria-activedescendant");
  await page.keyboard.press("n");
  await expect(viewport).not.toHaveAttribute("aria-activedescendant", activeBeforeNavigation ?? "");

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

test("既存viewを縦方向へ切り替えてもTurtleとユーザー配置を保持する", async ({ page }) => {
  await openPurchaseSample(page);
  const turtleBefore = await readTurtle(page);
  const start = page.locator(".iriograph-scene-node").filter({ hasText: "開始" });
  await start.click();
  const viewport = page.locator(".iriograph-canvas-scroll");
  const generatedLeft = await numericSceneCoordinate(start, "x");
  await viewport.focus();
  await page.keyboard.press("Control+ArrowRight");
  await expect.poll(() => numericSceneCoordinate(start, "x")).toBeCloseTo(generatedLeft + 1, 0);
  const userPosition = {
    left: await numericSceneCoordinate(start, "x"),
    top: await numericSceneCoordinate(start, "y"),
  };

  await page.locator(".iriograph-left-sidebar-toggle").click();
  await page.getByRole("button", { name: "ビューを管理" }).click();
  await page.locator(".iriograph-view-dialog").getByRole("button", { name: "このビューを設定" }).click();
  const dialog = page.locator(".iriograph-view-dialog");
  const direction = dialog.getByLabel("配置方向");
  await expect(direction).toHaveValue("LR");
  await direction.selectOption("TB");
  await dialog.getByRole("button", { name: "適用", exact: true }).click();
  await expect(dialog).toContainText("ビューを管理");
  await dialog.locator("footer").getByRole("button", { name: "閉じる", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".iriograph-canvas-scroll")).toHaveAttribute("aria-busy", "false");
  await expect.poll(() => numericSceneCoordinate(start, "x")).toBeCloseTo(userPosition.left, 0);
  await expect.poll(() => numericSceneCoordinate(start, "y")).toBeCloseTo(userPosition.top, 0);
  expect(await readTurtle(page)).toBe(turtleBefore);
});

function sceneNode(page: Page, label: string): Locator {
  const exactLabel = page.locator(".iriograph-node-label")
    .filter({ hasText: new RegExp(`^${escapeRegex(label)}$`, "u") });
  return page.locator(".iriograph-scene-node").filter({ has: exactLabel });
}

function groupFrame(page: Page, label: string): Locator {
  const exactLabel = page.locator(".iriograph-group-frame-label-text")
    .filter({ hasText: new RegExp(`^${escapeRegex(label)}$`, "u") });
  return page.locator([
    ".iriograph-scene-region.group-frame",
    ".iriograph-scene-container.group-frame",
  ].join(",")).filter({ has: exactLabel });
}

async function createStructuredGroup(
  page: Page,
  kind: "分類グループ" | "包含グループ" | "順序付きグループ" | "候補グループ",
  label: string,
): Promise<void> {
  const wizard = page.locator(".structured-wizard");
  await wizard.getByRole("button", { name: /^新しい要素を作る/u }).click();
  await wizard.getByRole("button", { name: /^グループ(?:\s|$)/u }).click();
  await wizard.getByRole("group", { name: "グループの種類" })
    .getByRole("button", { name: new RegExp(`^${escapeRegex(kind)}`, "u") }).click();
  await wizard.getByRole("button", { name: "次へ", exact: true }).click();
  await wizard.locator(".field-block input").fill(label);
  await wizard.getByRole("button", { name: "次へ", exact: true }).click();
  await expect(wizard.getByRole("heading", { name: "何をしますか？" })).toBeVisible();
}

async function beginMembershipFlow(page: Page, group: Locator): Promise<void> {
  const wizard = page.locator(".structured-wizard");
  await wizard.getByRole("button", { name: /^関係を作る/u }).click();
  await wizard.getByRole("button", { name: /^グループへ所属させる/u }).click();
  await wizard.getByRole("button", { name: "Canvasからグループを選ぶ", exact: true }).click();
  // Some deliberately overlapping group fixtures share the same Canvas
  // coordinates. Dispatch the pointer gesture to the exact rendered group so
  // this helper tests the picker/transaction contract independently from the
  // overlap hit-test.
  await dispatchPointerDrag(page, group, await requiredBox(group, "membership group"), 0, 0);
  await expect(wizard.locator(".canvas-chip")).toContainText(await group.locator(".iriograph-group-frame-label-text").innerText());
  await wizard.getByRole("button", { name: "次へ", exact: true }).click();
}

async function openElementDetailsFromContext(page: Page, element: Locator): Promise<void> {
  await element.dispatchEvent("contextmenu", { clientX: 620, clientY: 330 });
  await page.getByRole("menu", { name: "選択対象の操作" })
    .getByRole("menuitem", { name: "要素の詳細", exact: true }).click();
  await expect(page.locator(".iriograph-structured-details-dialog")).toBeVisible();
}

async function expectTargetContextMenu(
  page: Page,
  target: Locator,
  expectedActions: readonly string[],
): Promise<void> {
  await target.dispatchEvent("contextmenu", { clientX: 600, clientY: 320 });
  const menu = page.getByRole("menu", { name: "選択対象の操作" });
  await expect(menu).toBeVisible();
  for (const action of expectedActions) {
    await expect(menu.getByRole("menuitem", { name: new RegExp(`^${escapeRegex(action)}`, "u") }))
      .toBeVisible();
  }
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

async function requiredBox(locator: Locator, label: string) {
  const box = await locator.boundingBox();
  if (!box) throw new Error(`${label} does not have a bounding box`);
  return box;
}

async function readTurtle(page: Page): Promise<string> {
  const sourceTabs = page.locator(".iriograph-view-tabs");
  await sourceTabs.getByRole("button", { name: /Turtle/ }).click();
  const source = await page.getByLabel("Turtle source").inputValue();
  await sourceTabs.getByRole("button", { name: "図", exact: true }).click();
  return source;
}

async function saveAndReloadPurchaseSample(page: Page): Promise<void> {
  await page.locator(".topbar")
    .getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByText("browser working copyを保存しました")).toBeVisible();
  await page.reload();
  await openPurchaseSample(page);
}

async function canvasGeometrySnapshot(page: Page): Promise<Record<string, {
  left: number;
  top: number;
  width: number;
  height: number;
}>> {
  return page.locator([
    ".iriograph-scene-region[data-element-id]",
    ".iriograph-scene-container[data-element-id]",
    ".iriograph-scene-node[data-element-id]",
  ].join(",")).evaluateAll((elements) => Object.fromEntries(elements.map((element) => {
    const style = getComputedStyle(element);
    return [element.getAttribute("data-element-id") ?? "", {
      left: Number.parseFloat(style.left),
      top: Number.parseFloat(style.top),
      width: Number.parseFloat(style.width),
      height: Number.parseFloat(style.height),
    }];
  }).sort(([left], [right]) => left.localeCompare(right))));
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

async function numericSceneCoordinate(
  locator: Locator,
  axis: "x" | "y" | "width" | "height",
): Promise<number> {
  const value = await locator.getAttribute(`data-scene-${axis}`);
  if (value === null || !Number.isFinite(Number(value))) {
    throw new Error(`Missing numeric data-scene-${axis}`);
  }
  return Number(value);
}

async function textareaWithValue(container: Locator, value: string): Promise<Locator> {
  const textareas = container.locator("textarea");
  const index = await textareas.evaluateAll((elements, expected) => (
    elements.findIndex((element) => (element as HTMLTextAreaElement).value === expected)
  ), value);
  if (index < 0) throw new Error(`textarea with requested value was not found: ${value}`);
  return textareas.nth(index);
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
