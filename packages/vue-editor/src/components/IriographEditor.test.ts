import { afterEach, describe, expect, it } from "vitest";
import {
  flushPromises,
  mount,
  type VueWrapper,
} from "@vue/test-utils";
import { nextTick } from "vue";

import {
  catalogRef,
  createProjectionRuntimeContext,
  createStandardLayoutRegistry,
  STANDARD_LAYOUT_REFS,
  standardRdfRdfsCatalog,
  type DiagramScene,
  type ElementGeometry,
  type IriographDocument,
  type IriographDocumentV1,
  type LayoutAdapter,
  LayoutAdapterRegistry,
  type Point,
  type ResolvedAuthoringContext,
  type ResolvedSemanticValidationContext,
  type ResourceIriAllocation,
  type ResourceIriAllocationRequest,
  type ResourceIriAllocator,
  type SemanticValidationFinding,
  type SemanticValidationRequest,
  type SemanticValidationResponse,
  StandardLightweightLayoutAdapter,
} from "@iriograph/core";

import DiagramCanvas from "./DiagramCanvas.vue";
import IriographEditor from "./IriographEditor.vue";
import {
  diagramFitZoom,
  type IriographEditorNavigationApi,
} from "../viewport";
import type { IriographEditorSelectionApi } from "../selection";

const NS = "urn:test:editor:";
const TASK_CLASS = `${NS}Task`;
const initialSource = `
@prefix : <${NS}> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
:a rdfs:label "A" ; :rel :b .
:b rdfs:label "B" .
`;

describe("IriographEditor transaction regression", () => {
  let wrapper: VueWrapper | undefined;

  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
    document.body.innerHTML = "";
  });

  it("一つのdrag gestureを一つのhistory itemとしてundo/redoする", async () => {
    wrapper = await mountEditor();
    const canvas = wrapper.getComponent(DiagramCanvas);
    const node = canvas.props("scene").nodes.find((item) => item.semanticRef === `${NS}a`)!;
    const firstGeometry = offset(node.geometry, 35, 18);
    const finalGeometry = offset(node.geometry, 52, 31);

    emitCanvas(canvas, "gestureStart");
    emitCanvas(canvas, "geometryBatchChange", [{ elementId: node.elementId, geometry: firstGeometry }]);
    emitCanvas(canvas, "geometryBatchChange", [{ elementId: node.elementId, geometry: finalGeometry }]);
    emitCanvas(canvas, "gestureEnd");
    await settle();

    expect(overlayFor(latestDocument(wrapper), `${NS}a`)).toMatchObject({
      geometry: finalGeometry,
      pinned: true,
      placement: "user",
    });

    await buttonWithTitle(wrapper, "Undo (Ctrl/Cmd+Z)").trigger("click");
    await settle();
    expect(overlayFor(latestDocument(wrapper), `${NS}a`)).toBeUndefined();

    await buttonWithTitle(wrapper, "Redo (Ctrl/Cmd+Y)").trigger("click");
    await settle();
    expect(overlayFor(latestDocument(wrapper), `${NS}a`)).toMatchObject({
      geometry: finalGeometry,
      placement: "user",
    });
  });

  it("edge routing gestureをmanual overlayとして保存しundoできる", async () => {
    wrapper = await mountEditor();
    const canvas = wrapper.getComponent(DiagramCanvas);
    const edge = canvas.props("scene").edges[0]!;
    const waypoints: Point[] = [{ x: 220, y: 90 }, { x: 260, y: 150 }];

    emitCanvas(canvas, "gestureStart");
    emitCanvas(canvas, "routingUpdate", {
      elementId: edge.elementId,
      routing: { waypoints },
    });
    emitCanvas(canvas, "routingUpdate", {
      elementId: edge.elementId,
      routing: { waypoints, labelOffset: { x: 8, y: -6 } },
    });
    // Public Canvasはlegacy eventも併発するが、Editorは新eventだけを購読する。
    emitCanvas(canvas, "routingChange", { elementId: edge.elementId, waypoints });
    emitCanvas(canvas, "gestureEnd");
    await settle();

    const routed = overlayFor(latestDocument(wrapper), edge.semanticRef)!;
    expect(routed.routing).toEqual({ waypoints, labelOffset: { x: 8, y: -6 } });
    expect(routed.pinned).toBeUndefined();
    expect(routed.placement).toBeUndefined();
    expect(wrapper.emitted("update:modelValue")).toHaveLength(2);

    await buttonWithTitle(wrapper, "Undo (Ctrl/Cmd+Z)").trigger("click");
    await settle();
    expect(overlayFor(latestDocument(wrapper), edge.semanticRef)).toBeUndefined();
  });

  it("最後のwaypoint削除を空配列なしのautomatic routingとして保存しundoする", async () => {
    wrapper = await mountEditor();
    const canvas = wrapper.getComponent(DiagramCanvas);
    const edge = canvas.props("scene").edges[0]!;

    emitCanvas(canvas, "gestureStart");
    emitCanvas(canvas, "routingUpdate", {
      elementId: edge.elementId,
      routing: { waypoints: [{ x: 210, y: 95 }] },
    });
    emitCanvas(canvas, "gestureEnd");
    await settle();
    emitCanvas(canvas, "gestureStart");
    emitCanvas(canvas, "routingUpdate", { elementId: edge.elementId, routing: undefined });
    emitCanvas(canvas, "gestureEnd");
    await settle();

    const automatic = latestDocument(wrapper);
    expect(overlayFor(automatic, edge.semanticRef)).toBeUndefined();
    expect(JSON.stringify(automatic)).not.toContain('"waypoints":[]');

    exposedHistoryApi(wrapper).undo();
    await settle();
    expect(overlayFor(latestDocument(wrapper), edge.semanticRef)?.routing).toEqual({
      waypoints: [{ x: 210, y: 95 }],
    });
  });

  it("Inspectorからderived routeをseedしてwaypoint追加・label offset・resetする", async () => {
    wrapper = await mountEditor();
    const canvas = wrapper.getComponent(DiagramCanvas);
    const edge = canvas.props("scene").edges[0]!;
    exposedSelectionApi(wrapper).selectElement(edge.elementId);
    await nextTick();

    await buttonWithText(wrapper, "Waypointを追加").trigger("click");
    await settle();
    const manual = overlayFor(latestDocument(wrapper), edge.semanticRef)?.routing?.waypoints;
    expect(manual).toHaveLength((edge.route?.length ?? 2) - 1);
    expect(manual?.every((point) => point.x >= 8 && point.y >= 8)).toBe(true);

    const labelX = wrapper.get<HTMLInputElement>(
      ".iriograph-routing-inspector .iriograph-geometry-grid input",
    );
    await labelX.setValue("15");
    await settle();
    expect(overlayFor(latestDocument(wrapper), edge.semanticRef)?.routing?.labelOffset)
      .toEqual({ x: 15, y: 0 });

    await buttonWithText(wrapper, "Label位置をリセット").trigger("click");
    await settle();
    expect(overlayFor(latestDocument(wrapper), edge.semanticRef)?.routing?.labelOffset)
      .toBeUndefined();
    expect(buttonWithText(wrapper, "Routingを自動に戻す").attributes("disabled")).toBeUndefined();
    await buttonWithText(wrapper, "Routingを自動に戻す").trigger("click");
    await settle();
    expect(overlayFor(latestDocument(wrapper), edge.semanticRef)).toBeUndefined();
  });

  it("valid Turtleを検証後に原文のまま適用する", async () => {
    wrapper = await mountEditor();
    const candidate = `${initialSource}\n:c rdfs:label "C" .\n`;
    await openTurtlePanel(wrapper);
    await wrapper.get<HTMLTextAreaElement>('textarea[aria-label="Turtle source"]').setValue(candidate);

    await buttonWithText(wrapper, "検証して適用").trigger("click");
    await waitUntil(() => latestDocument(wrapper!).semantic.source === candidate);

    expect(latestDocument(wrapper).semantic.source).toBe(candidate);
    expect(wrapper.text()).toContain("Turtle valid");
    await waitUntil(() => summaryNodeCount(wrapper!) === 3);
  });

  it("loaded domain errorをSceneへannotationしSource/Scene navigationをfingerprint-boundにする", async () => {
    const context = validationContext((request) => {
      const startOffset = request.source.lastIndexOf(":b");
      return [{
        findingId: "loaded:b",
        severity: "error",
        code: "domain-loaded-b",
        message: "B requires review.",
        semanticRef: `${NS}b`,
        sourceRange: { startOffset, endOffset: startOffset + 2 },
      }];
    });
    wrapper = await mountEditor({ semanticValidationContext: context });
    await waitUntil(() => wrapper!.find(".iriograph-scene-node.diagnostic-error").exists());

    expect(summaryNodeCount(wrapper)).toBe(2);
    expect(wrapper.text()).not.toContain("図を表示できません");
    await openTurtlePanel(wrapper);
    const sourceButton = wrapper.get<HTMLButtonElement>(".iriograph-diagnostic-actions button");
    await sourceButton.trigger("click");
    const textarea = wrapper.get<HTMLTextAreaElement>('textarea[aria-label="Turtle source"]');
    expect(textarea.element.selectionStart).toBe(initialSource.lastIndexOf(":b"));

    await textarea.setValue(`${initialSource}\n`);
    expect(wrapper.find(".iriograph-diagnostic-actions button").exists()).toBe(true);
    expect(wrapper.findAll(".iriograph-diagnostic-actions button").some((button) => button.text() === "Source"))
      .toBe(false);
    const sceneButton = wrapper.findAll(".iriograph-diagnostic-actions button")
      .find((button) => button.text() === "Scene")!;
    await sceneButton.trigger("click");
    expect(wrapper.find(".iriograph-scene-node.diagnostic-error.selected").exists()).toBe(true);
  });

  it("candidate domain errorをrollbackし、source locationへ移動できる", async () => {
    const context = validationContext((request) => {
      const resource = request.dataset.statements.find((statement) => (
        statement.subject.value === `${NS}c`
      ));
      if (!resource) return [];
      const startOffset = request.source.lastIndexOf(":c");
      return [{
        findingId: "candidate:c",
        severity: "error",
        code: "domain-c-rejected",
        message: "C is not allowed.",
        semanticRef: `${NS}c`,
        sourceRange: { startOffset, endOffset: startOffset + 2 },
      }];
    });
    wrapper = await mountEditor({ semanticValidationContext: context });
    const candidate = `${initialSource}\n:c rdfs:label "C" .\n`;
    await openTurtlePanel(wrapper);
    const textarea = wrapper.get<HTMLTextAreaElement>('textarea[aria-label="Turtle source"]');
    await textarea.setValue(candidate);
    await buttonWithText(wrapper, "検証して適用").trigger("click");
    await waitUntil(() => wrapper!.text().includes("domain-c-rejected"));

    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
    expect(summaryNodeCount(wrapper)).toBe(2);
    await wrapper.get<HTMLButtonElement>(".iriograph-diagnostic-actions button").trigger("click");
    expect(textarea.element.selectionStart).toBe(candidate.lastIndexOf(":c"));
  });

  it("domain warningをsource/context-bound confirmationで再適用する", async () => {
    const context = validationContext((request) => request.dataset.statements.some((statement) => (
      statement.subject.value === `${NS}c`
    )) ? [{
      findingId: "candidate-warning:c",
      severity: "warning",
      code: "domain-c-review",
      message: "C requires review.",
      semanticRef: `${NS}c`,
    }] : []);
    wrapper = await mountEditor({ semanticValidationContext: context });
    const candidate = `${initialSource}\n:c rdfs:label "C" .\n`;
    await openTurtlePanel(wrapper);
    await wrapper.get<HTMLTextAreaElement>('textarea[aria-label="Turtle source"]').setValue(candidate);
    await buttonWithText(wrapper, "検証して適用").trigger("click");
    await waitUntil(() => wrapper!.text().includes("警告を確認して適用"));
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();

    await wrapper.setProps({
      semanticValidationContext: { ...context, contextRevision: "2" },
    });
    await settle();
    expect(wrapper.text()).not.toContain("警告を確認して適用");
    await buttonWithText(wrapper, "検証して適用").trigger("click");
    await waitUntil(() => wrapper!.text().includes("警告を確認して適用"));
    await buttonWithText(wrapper, "警告を確認して適用").trigger("click");
    await waitUntil(() => Boolean(wrapper!.emitted("update:modelValue")?.length));
    expect(latestDocument(wrapper).semantic.source).toBe(candidate);
  });

  it("authoringContext内validation変更で旧loaded requestをabortし再検証する", async () => {
    const fixture = documentFixture();
    const baseAuthoring = testAuthoringContext(fixture);
    const initial = validationContext(() => []);
    wrapper = await mountEditor({
      authoringContext: { ...baseAuthoring, semanticValidation: initial },
    });

    let resolveStale: ((response: SemanticValidationResponse) => void) | undefined;
    let staleRequest: SemanticValidationRequest | undefined;
    let staleSignal: AbortSignal | undefined;
    const stale = validationContext((request, signal) => new Promise((resolve) => {
      staleRequest = request;
      staleSignal = signal;
      resolveStale = (response) => resolve(response.findings);
    }), "2");
    await wrapper.setProps({
      authoringContext: { ...baseAuthoring, semanticValidation: stale },
    });
    await waitUntil(() => Boolean(staleRequest));

    const current = validationContext(() => [{
      findingId: "current:b",
      severity: "warning",
      code: "domain-current",
      message: "Current validation.",
      semanticRef: `${NS}b`,
    }], "3");
    await wrapper.setProps({
      authoringContext: { ...baseAuthoring, semanticValidation: current },
    });
    await waitUntil(() => wrapper!.find(".iriograph-scene-node.diagnostic-warning").exists());
    expect(staleSignal?.aborted).toBe(true);
    resolveStale?.(validationResponse(staleRequest!, [{
      findingId: "stale:a",
      severity: "error",
      code: "domain-stale",
      message: "Stale validation.",
      semanticRef: `${NS}a`,
    }]));
    await settle();
    expect(wrapper.text()).not.toContain("domain-stale");
  });

  it("authoring documentRevisionだけの更新ではloaded validationを二重実行しない", async () => {
    const fixture = documentFixture();
    const baseAuthoring = testAuthoringContext(fixture);
    let calls = 0;
    const validation = validationContext(() => {
      calls += 1;
      return [];
    });
    wrapper = await mountEditor({
      authoringContext: { ...baseAuthoring, semanticValidation: validation },
    });
    expect(calls).toBe(1);

    await wrapper.setProps({
      authoringContext: {
        ...baseAuthoring,
        documentRevision: `${baseAuthoring.documentRevision}:next`,
        semanticValidation: validation,
      },
    });
    await settle();
    expect(calls).toBe(1);

    await wrapper.setProps({
      authoringContext: {
        ...baseAuthoring,
        semanticValidation: { ...validation, contextRevision: "2" },
      },
    });
    await waitUntil(() => calls === 2);
  });

  it("invalid Turtleをrollbackしてdocument正本とSceneを維持する", async () => {
    wrapper = await mountEditor();
    const initialNodeCount = summaryNodeCount(wrapper);
    await openTurtlePanel(wrapper);
    await wrapper.get<HTMLTextAreaElement>('textarea[aria-label="Turtle source"]').setValue(
      `@prefix : <${NS}> .\n:a :rel .`,
    );

    await buttonWithText(wrapper, "検証して適用").trigger("click");
    await waitUntil(() => wrapper!.find(".iriograph-diagnostics .error").exists());

    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
    expect(summaryNodeCount(wrapper)).toBe(initialNodeCount);
    expect(await exposedApi(wrapper).flushPendingEdits()).toBe(false);
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
  });

  it("保存要求がpending Turtleのflush完了を待ち、失敗時はsaveをemitしない", async () => {
    wrapper = await mountEditor();
    const candidate = `${initialSource}\n:c rdfs:label "C" .\n`;
    await openTurtlePanel(wrapper);
    await wrapper.get<HTMLTextAreaElement>('textarea[aria-label="Turtle source"]').setValue(candidate);

    await wrapper.get(".iriograph-editor-header button").trigger("click");
    await waitUntil(() => (wrapper!.emitted("save")?.length ?? 0) === 1);

    expect(latestDocument(wrapper).semantic.source).toBe(candidate);
    expect(wrapper.emitted("save")).toHaveLength(1);

    wrapper.unmount();
    wrapper = await mountEditor();
    await openTurtlePanel(wrapper);
    await wrapper.get<HTMLTextAreaElement>('textarea[aria-label="Turtle source"]').setValue(
      `@prefix : <${NS}> .\n:a :rel .`,
    );
    await wrapper.get(".iriograph-editor-header button").trigger("click");
    await waitUntil(() => wrapper!.find(".iriograph-diagnostics .error").exists());

    expect(wrapper.emitted("save")).toBeUndefined();
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
  });

  it("pan、fit、selection revealをdocument/historyと分離して公開する", async () => {
    wrapper = await mountEditor();
    configureEditorViewport(wrapper, 180, 140);
    const viewport = wrapper.get<HTMLElement>(".iriograph-canvas-scroll");
    const canvas = wrapper.getComponent(DiagramCanvas);
    const target = canvas.props("scene").nodes.find((node) => node.semanticRef === `${NS}b`)!;
    const api = wrapper.vm as unknown as IriographEditorNavigationApi;

    api.panBy(80, 45);
    expect(viewport.element.scrollLeft).toBe(80);
    expect(viewport.element.scrollTop).toBe(45);
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();

    expect(await api.focusElement(target.elementId)).toBe(true);
    expect(wrapper.emitted("selectionChanged")?.at(-1)?.[0]).toBe(target.elementId);
    expect(viewport.element.scrollLeft).toBeGreaterThan(100);
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();

    await api.fitToView();
    const expectedFit = diagramFitZoom(canvas.props("scene"), { width: 180, height: 140 });
    expect(wrapper.get(".zoom-value").text()).toBe(`${Math.round(expectedFit * 100)}%`);
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
    expect(await api.focusElement("missing-element")).toBe(false);
  });

  it("viewport focusの矢印はpan、node focusの矢印は既存編集に使い分ける", async () => {
    wrapper = await mountEditor();
    configureEditorViewport(wrapper, 180, 140);
    const canvas = wrapper.getComponent(DiagramCanvas);
    const target = canvas.props("scene").nodes[0]!;
    const selectionApi = wrapper.vm as unknown as { selectElement(elementId: string): void };
    selectionApi.selectElement(target.elementId);
    await nextTick();
    const viewport = wrapper.get<HTMLElement>(".iriograph-canvas-scroll");

    await viewport.trigger("keydown", { key: "ArrowRight" });
    expect(viewport.element.scrollLeft).toBe(64);
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();

    await wrapper.get(".iriograph-scene-node.selected").trigger("keydown", { key: "ArrowRight" });
    await settle();
    expect(wrapper.emitted("update:modelValue")).toHaveLength(1);
  });

  it("readOnlyでもnavigationを許可しpresentation editは発行しない", async () => {
    wrapper = await mountEditor({ readOnly: true });
    configureEditorViewport(wrapper, 180, 140);
    const viewport = wrapper.get<HTMLElement>(".iriograph-canvas-scroll");

    await viewport.trigger("keydown", { key: "ArrowDown" });
    expect(viewport.element.scrollTop).toBe(64);
    await wrapper.get('button[aria-label="全体を表示"]').trigger("click");
    await settle();
    expect(Number.parseInt(wrapper.get(".zoom-value").text(), 10)).toBeLessThan(100);
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
  });

  it("source tabを往復してもsession viewportを保持する", async () => {
    wrapper = await mountEditor();
    configureEditorViewport(wrapper, 180, 140);
    const viewport = wrapper.get<HTMLElement>(".iriograph-canvas-scroll");
    const api = wrapper.vm as unknown as IriographEditorNavigationApi;
    api.panBy(96, 72);
    await api.zoomTo(.8);
    const before = {
      left: viewport.element.scrollLeft,
      top: viewport.element.scrollTop,
    };

    await openTurtlePanel(wrapper);
    await buttonWithText(wrapper, "Diagram").trigger("click");
    await settle();

    expect(wrapper.get<HTMLElement>(".iriograph-canvas-scroll").element.scrollLeft).toBe(before.left);
    expect(wrapper.get<HTMLElement>(".iriograph-canvas-scroll").element.scrollTop).toBe(before.top);
    expect(wrapper.text()).toContain("80%");
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
  });

  it("multi-selectionとsnap設定をsession stateに保ち、group dragを一transactionでundoする", async () => {
    wrapper = await mountEditor();
    const canvas = wrapper.getComponent(DiagramCanvas);
    const nodes = canvas.props("scene").nodes;
    const source = documentFixture().semantic.source;
    const selection = exposedSelectionApi(wrapper);
    selection.selectElements(nodes.map((node) => node.elementId));
    selection.setSnapSettings({ grid: { enabled: false }, targets: { enabled: false } });
    await nextTick();

    expect(wrapper.emitted("selectionSetChanged")?.at(-1)?.[0]).toEqual(
      nodes.map((node) => node.elementId),
    );
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();

    const changes = nodes.map((node, index) => ({
      elementId: node.elementId,
      geometry: offset(node.geometry, 24 + index * 8, 16),
    }));
    emitCanvas(canvas, "gestureStart");
    emitCanvas(canvas, "geometryBatchChange", changes);
    emitCanvas(canvas, "gestureEnd");
    await settle();

    const moved = latestDocument(wrapper);
    expect(moved.semantic.source).toBe(source);
    for (const [index, node] of nodes.entries()) {
      expect(overlayFor(moved, node.semanticRef)).toMatchObject({
        geometry: changes[index]!.geometry,
        pinned: true,
        placement: "user",
      });
    }

    await buttonWithTitle(wrapper, "Undo (Ctrl/Cmd+Z)").trigger("click");
    await settle();
    const undone = latestDocument(wrapper);
    expect(undone.semantic.source).toBe(source);
    expect(nodes.every((node) => overlayFor(undone, node.semanticRef) === undefined)).toBe(true);
  });

  it("container group dragのgenerated descendantを同じtransactionで永続化する", async () => {
    const document = containedDocumentFixture();
    wrapper = await mountEditor({ modelValue: document }, 1);
    const canvas = wrapper.getComponent(DiagramCanvas);
    const container = canvas.props("scene").containers[0]!;
    const child = canvas.props("scene").nodes[0]!;
    exposedSelectionApi(wrapper).selectElement(container.elementId);
    const changes = [container, child].map((element) => ({
      elementId: element.elementId,
      geometry: offset(element.geometry, 32, 24),
    }));

    emitCanvas(canvas, "gestureStart");
    emitCanvas(canvas, "geometryBatchChange", changes);
    emitCanvas(canvas, "gestureEnd");
    await settle();

    const moved = latestDocument(wrapper);
    expect(moved.semantic.source).toBe(document.semantic.source);
    expect(overlayFor(moved, container.semanticRef)).toMatchObject({
      geometry: changes[0]!.geometry,
      placement: "user",
    });
    expect(overlayFor(moved, child.semanticRef)).toMatchObject({
      geometry: changes[1]!.geometry,
      placement: "user",
    });

    exposedHistoryApi(wrapper).undo();
    await settle();
    const undone = latestDocument(wrapper);
    expect(overlayFor(undone, container.semanticRef)).toBeUndefined();
    expect(overlayFor(undone, child.semanticRef)).toBeUndefined();
  });

  it("toolbarの整列と等間隔を各一つのpresentation history itemにする", async () => {
    wrapper = await mountEditor({ modelValue: threeNodeDocumentFixture() }, 3);
    const canvas = wrapper.getComponent(DiagramCanvas);
    const nodes = canvas.props("scene").nodes;
    const initial: ElementGeometry[] = [
      { x: 120, y: 80, width: nodes[0]!.geometry.width, height: nodes[0]!.geometry.height },
      { x: 280, y: 170, width: nodes[1]!.geometry.width, height: nodes[1]!.geometry.height },
      { x: 520, y: 270, width: nodes[2]!.geometry.width, height: nodes[2]!.geometry.height },
    ];
    exposedSelectionApi(wrapper).selectElements(nodes.map((node) => node.elementId));
    emitCanvas(canvas, "gestureStart");
    emitCanvas(canvas, "geometryBatchChange", nodes.map((node, index) => ({
      elementId: node.elementId,
      geometry: initial[index]!,
    })));
    emitCanvas(canvas, "gestureEnd");
    await settle();

    await wrapper.get('button[aria-label="左揃え"]').trigger("click");
    await settle();
    const aligned = latestDocument(wrapper);
    expect(nodes.map((node) => overlayFor(aligned, node.semanticRef)?.geometry?.x))
      .toEqual([120, 120, 120]);
    expect(aligned.semantic.source).toBe(threeNodeDocumentFixture().semantic.source);

    await buttonWithTitle(wrapper, "Undo (Ctrl/Cmd+Z)").trigger("click");
    await settle();
    const undone = latestDocument(wrapper);
    expect(nodes.map((node) => overlayFor(undone, node.semanticRef)?.geometry?.x))
      .toEqual([120, 280, 520]);

    await wrapper.get('button[aria-label="水平方向に等間隔"]').trigger("click");
    await settle();
    const distributed = latestDocument(wrapper);
    const geometries = nodes.map((node) => overlayFor(distributed, node.semanticRef)!.geometry!);
    const firstGap = geometries[1]!.x - geometries[0]!.x - geometries[0]!.width;
    const secondGap = geometries[2]!.x - geometries[1]!.x - geometries[1]!.width;
    expect(firstGap).toBeCloseTo(secondGap, 0);
  });

  it("readOnlyではselectionを許可し、undoとgeometry commandを全入口で拒否する", async () => {
    wrapper = await mountEditor();
    const canvas = wrapper.getComponent(DiagramCanvas);
    const node = canvas.props("scene").nodes[0]!;
    emitCanvas(canvas, "gestureStart");
    emitCanvas(canvas, "geometryBatchChange", [{
      elementId: node.elementId,
      geometry: offset(node.geometry, 24, 16),
    }]);
    emitCanvas(canvas, "gestureEnd");
    await settle();
    const updateCount = wrapper.emitted("update:modelValue")!.length;

    await wrapper.setProps({ readOnly: true });
    exposedSelectionApi(wrapper).selectAll();
    await nextTick();
    expect(wrapper.emitted("selectionSetChanged")?.at(-1)?.[0]).toHaveLength(3);
    expect(wrapper.get<HTMLButtonElement>('button[aria-label="左揃え"]').element.disabled).toBe(true);
    exposedHistoryApi(wrapper).undo();
    const edge = canvas.props("scene").edges[0]!;
    emitCanvas(canvas, "routingUpdate", {
      elementId: edge.elementId,
      routing: { waypoints: [{ x: 100, y: 100 }] },
    });
    await nextTick();
    expect(wrapper.emitted("update:modelValue")).toHaveLength(updateCount);
  });

  it("structured draftをPreview後に初期位置ごと一つのsemantic historyへ適用する", async () => {
    const fixture = documentFixture();
    wrapper = await mountEditor({
      authoringContext: testAuthoringContext(fixture),
      resourceIriAllocator: fixedAllocator(`${NS}created`),
    });

    await wrapper.get<HTMLInputElement>('input[aria-label="Resource class"]').setValue(TASK_CLASS);
    await wrapper.get<HTMLInputElement>('input[aria-label="Resource label"]').setValue("Created task");
    await buttonWithText(wrapper, "Canvasで位置指定").trigger("click");
    emitCanvas(wrapper.getComponent(DiagramCanvas), "semanticPositionRequest", { x: 320, y: 160 });
    await nextTick();
    expect(wrapper.get<HTMLInputElement>('input[aria-label="Initial x"]').element.value).toBe("320");
    expect(wrapper.get<HTMLInputElement>('input[aria-label="Initial y"]').element.value).toBe("88");
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();

    await buttonWithText(wrapper, "差分をPreview").trigger("click");
    await waitUntil(() => wrapper!.find(".iriograph-authoring-preview").exists());
    expect(wrapper.text()).toContain("追加 2 triple");
    expect(wrapper.text()).toContain("適用可能");
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();

    await wrapper.get<HTMLButtonElement>(".iriograph-authoring-actions .primary").trigger("click");
    await waitUntil(() => Boolean(
      (wrapper!.emitted("update:modelValue")?.at(-1)?.[0] as IriographDocument | undefined)
        ?.semantic.source.includes(`${NS}created`),
    ));
    const created = latestDocument(wrapper);
    expect(wrapper.emitted("update:modelValue")).toHaveLength(1);
    expect(overlayFor(created, `${NS}created`)).toMatchObject({
      geometry: { x: 320, y: 88 },
      pinned: true,
      placement: "user",
    });

    exposedHistoryApi(wrapper).undo();
    await settle();
    expect(latestDocument(wrapper).semantic.source).not.toContain(`${NS}created`);
    expect(overlayFor(latestDocument(wrapper), `${NS}created`)).toBeUndefined();
  });

  it("Turtle draftとstructured draftを排他にし未確認draftを保存flushしない", async () => {
    const fixture = documentFixture();
    wrapper = await mountEditor({
      authoringContext: testAuthoringContext(fixture),
      resourceIriAllocator: fixedAllocator(`${NS}created`),
    });
    await openTurtlePanel(wrapper);
    const textarea = wrapper.get<HTMLTextAreaElement>('textarea[aria-label="Turtle source"]');
    await textarea.setValue(`${initialSource}\n:c rdfs:label "C" .\n`);
    expect(wrapper.get<HTMLSelectElement>('select[aria-label="Semantic operation"]').element.disabled)
      .toBe(true);
    await buttonWithText(wrapper, "元に戻す").trigger("click");

    await wrapper.get<HTMLInputElement>('input[aria-label="Resource label"]').setValue("Pending");
    expect(textarea.element.readOnly).toBe(true);
    expect(await exposedApi(wrapper).flushPendingEdits()).toBe(false);
    expect(wrapper.text()).toContain("Preview/Applyされていないsemantic draft");
    expect(wrapper.emitted("save")).toBeUndefined();
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
  });

  it("Canvas Deleteはdirect edgeのprovenanceをexact remove draftへseedする", async () => {
    const fixture = documentFixture();
    wrapper = await mountEditor({ authoringContext: testAuthoringContext(fixture) });
    const canvas = wrapper.getComponent(DiagramCanvas);
    const edge = canvas.props("scene").edges.find((item) => item.label === "rel")!;

    emitCanvas(canvas, "semanticEditRequest", edge.elementId);
    await nextTick();
    expect(wrapper.get<HTMLInputElement>('input[aria-label="Statement ref"]').element.value)
      .toBe(edge.provenance?.sourceStatementRefs[0]);
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();

    await buttonWithText(wrapper, "差分をPreview").trigger("click");
    await waitUntil(() => wrapper!.find(".iriograph-authoring-preview").exists());
    expect(wrapper.text()).toContain("削除 1 triple");
    expect(wrapper.text()).toContain("適用可能");
    await wrapper.get<HTMLButtonElement>(".iriograph-authoring-actions .primary").trigger("click");
    await waitUntil(() => wrapper!.getComponent(DiagramCanvas).props("scene").edges.length === 0);
    expect(wrapper.emitted("update:modelValue")).toHaveLength(1);
  });

  it("async allocatorの結果をdocument/context変更後に採用しない", async () => {
    const fixture = documentFixture();
    let allocationRequest: ResourceIriAllocationRequest | undefined;
    let resolveAllocation: ((value: ResourceIriAllocation) => void) | undefined;
    const allocator: ResourceIriAllocator = {
      allocate(request) {
        allocationRequest = request;
        return new Promise((resolve) => { resolveAllocation = resolve; });
      },
    };
    wrapper = await mountEditor({
      authoringContext: testAuthoringContext(fixture),
      resourceIriAllocator: allocator,
    });
    await wrapper.get<HTMLInputElement>('input[aria-label="Resource class"]').setValue(TASK_CLASS);
    await buttonWithText(wrapper, "差分をPreview").trigger("click");
    await waitUntil(() => Boolean(allocationRequest));

    const replacement = threeNodeDocumentFixture();
    await wrapper.setProps({
      modelValue: replacement,
      authoringContext: testAuthoringContext(replacement),
    });
    resolveAllocation!({
      iri: `${NS}stale-created`,
      requestId: allocationRequest!.requestId,
      baseRevision: allocationRequest!.baseRevision,
      contextId: allocationRequest!.contextId,
    });
    await settle();
    expect(wrapper.find(".iriograph-authoring-preview").exists()).toBe(false);
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
  });

  it("authoringContext提供時のdirect Turtleへunknown/namespace/role policyを共通適用する", async () => {
    const fixture = documentFixture();
    wrapper = await mountEditor({ authoringContext: testAuthoringContext(fixture) });
    await openTurtlePanel(wrapper);
    const source = wrapper.get<HTMLTextAreaElement>('textarea[aria-label="Turtle source"]');
    const warned = `${initialSource}\n:c :unknown :a .\n`;
    await source.setValue(warned);
    await buttonWithText(wrapper, "検証して適用").trigger("click");
    await waitUntil(() => latestDocument(wrapper!).semantic.source === warned);
    expect(wrapper.text()).toContain("unknown-term-introduced");
    expect(latestDocument(wrapper).semantic.source).toBe(warned);

    const beforeRejected = wrapper.emitted("update:modelValue")!.length;
    await source.setValue(`${warned}\n:d :Task :a .\n`);
    await buttonWithText(wrapper, "検証して適用").trigger("click");
    await waitUntil(() => wrapper!.text().includes("authoring-term-role-invalid"));
    expect(wrapper.emitted("update:modelValue")).toHaveLength(beforeRejected);

    await source.setValue(`${warned}\n<https://outside.example/resource> rdfs:label "Outside" .\n`);
    await buttonWithText(wrapper, "検証して適用").trigger("click");
    await waitUntil(() => wrapper!.text().includes("resource-namespace-denied"));
    expect(wrapper.emitted("update:modelValue")).toHaveLength(beforeRejected);
  });

  it("readOnly途中切替でasync previewをabortし結果を公開しない", async () => {
    const fixture = documentFixture();
    let request: ResourceIriAllocationRequest | undefined;
    let resolveAllocation: ((value: ResourceIriAllocation) => void) | undefined;
    const allocator: ResourceIriAllocator = {
      allocate(value) {
        request = value;
        return new Promise((resolve) => { resolveAllocation = resolve; });
      },
    };
    wrapper = await mountEditor({
      authoringContext: testAuthoringContext(fixture),
      resourceIriAllocator: allocator,
    });
    await wrapper.get<HTMLInputElement>('input[aria-label="Resource class"]').setValue(TASK_CLASS);
    await buttonWithText(wrapper, "差分をPreview").trigger("click");
    await waitUntil(() => Boolean(request));
    await wrapper.setProps({ readOnly: true });
    resolveAllocation!({
      iri: `${NS}cancelled-created`,
      requestId: request!.requestId,
      baseRevision: request!.baseRevision,
      contextId: request!.contextId,
    });
    await settle();
    expect(wrapper.find(".iriograph-authoring-preview").exists()).toBe(false);
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
  });

  it("busy中のCancelでasync previewをabortしlate結果を採用しない", async () => {
    const fixture = documentFixture();
    let request: ResourceIriAllocationRequest | undefined;
    let resolveAllocation: ((value: ResourceIriAllocation) => void) | undefined;
    const allocator: ResourceIriAllocator = {
      allocate(value) {
        request = value;
        return new Promise((resolve) => { resolveAllocation = resolve; });
      },
    };
    wrapper = await mountEditor({
      authoringContext: testAuthoringContext(fixture),
      resourceIriAllocator: allocator,
    });
    await wrapper.get<HTMLInputElement>('input[aria-label="Resource class"]').setValue(TASK_CLASS);
    await buttonWithText(wrapper, "差分をPreview").trigger("click");
    await waitUntil(() => Boolean(request));
    const cancel = buttonWithText(wrapper, "Cancel");
    expect(cancel.attributes("disabled")).toBeUndefined();
    await cancel.trigger("click");
    resolveAllocation!({
      iri: `${NS}late-created`,
      requestId: request!.requestId,
      baseRevision: request!.baseRevision,
      contextId: request!.contextId,
    });
    await settle();
    expect(wrapper.find(".iriograph-authoring-preview").exists()).toBe(false);
    expect(wrapper.get<HTMLInputElement>('input[aria-label="Resource class"]').element.value).toBe("");
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
  });

  it("readOnly途中切替でasync Turtle applyをabortしpublishしない", async () => {
    const fixture = documentFixture();
    const delayed = delayedLayoutRegistry();
    const context = testAuthoringContext(fixture);
    context.runtime = { ...context.runtime, layouts: delayed.registry };
    wrapper = await mountEditor({ authoringContext: context });
    await openTurtlePanel(wrapper);
    await wrapper.get<HTMLTextAreaElement>('textarea[aria-label="Turtle source"]')
      .setValue(`${initialSource}\n:c rdfs:label "C" .\n`);
    delayed.arm();
    await buttonWithText(wrapper, "検証して適用").trigger("click");
    await delayed.started;
    await wrapper.setProps({ readOnly: true });
    delayed.release();
    await settle();
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
  });

  it("readOnly途中切替でconfirmed structured applyもabortしpublishしない", async () => {
    const fixture = documentFixture();
    const delayed = delayedLayoutRegistry();
    const context = testAuthoringContext(fixture);
    context.runtime = { ...context.runtime, layouts: delayed.registry };
    wrapper = await mountEditor({
      authoringContext: context,
      resourceIriAllocator: fixedAllocator(`${NS}delayed-created`),
    });
    await wrapper.get<HTMLInputElement>('input[aria-label="Resource class"]').setValue(TASK_CLASS);
    await buttonWithText(wrapper, "差分をPreview").trigger("click");
    await waitUntil(() => wrapper!.text().includes("適用可能"));
    delayed.arm();
    await wrapper.get<HTMLButtonElement>(".iriograph-authoring-actions .primary").trigger("click");
    await delayed.started;
    await wrapper.setProps({ readOnly: true });
    delayed.release();
    await settle();
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
  });

  it("authoringContext変更中のdirect Turtle結果をstaleとして破棄する", async () => {
    const fixture = documentFixture();
    const delayed = delayedLayoutRegistry();
    const context = testAuthoringContext(fixture);
    context.runtime = { ...context.runtime, layouts: delayed.registry };
    wrapper = await mountEditor({ authoringContext: context });
    await openTurtlePanel(wrapper);
    await wrapper.get<HTMLTextAreaElement>('textarea[aria-label="Turtle source"]')
      .setValue(`${initialSource}\n:c rdfs:label "C" .\n`);
    delayed.arm();
    await buttonWithText(wrapper, "検証して適用").trigger("click");
    await delayed.started;
    await wrapper.setProps({
      authoringContext: { ...testAuthoringContext(fixture), contextRevision: "2" },
    });
    delayed.release();
    await settle();
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
  });

  it("parent provenanceから包含解除をexact configでseedしPreviewする", async () => {
    const fixture = containedDocumentFixture();
    wrapper = await mountEditor({
      modelValue: fixture,
      authoringContext: testAuthoringContext(fixture),
    }, 1);
    const canvas = wrapper.getComponent(DiagramCanvas);
    const member = canvas.props("scene").nodes.find((node) => node.semanticRef === `${NS}a`)!;
    exposedSelectionApi(wrapper).selectElement(member.elementId);
    await nextTick();
    await buttonWithText(wrapper, "包含から外す").trigger("click");
    expect(wrapper.get<HTMLInputElement>('input[aria-label="Membership member"]').element.value)
      .toBe(`${NS}a`);
    expect(wrapper.get<HTMLInputElement>('input[aria-label="Membership present"]').element.checked)
      .toBe(false);
    expect(wrapper.get<HTMLSelectElement>('select[aria-label="Membership structure config"]').element.value)
      .not.toBe("");
    await buttonWithText(wrapper, "差分をPreview").trigger("click");
    await waitUntil(() => wrapper!.text().includes("適用可能"));
    expect(wrapper.text()).toContain("削除 1 triple");
  });

  it("RDFS subclass Seq provenanceを現在のexact configと全ordinal memberへseedする", async () => {
    const fixture = sequenceDocumentFixture();
    wrapper = await mountEditor({
      modelValue: fixture,
      authoringContext: testAuthoringContext(fixture),
    }, 4);
    const canvas = wrapper.getComponent(DiagramCanvas);
    const sequenceEdge = canvas.props("scene").edges.find((edge) => (
      edge.provenance?.editCapability?.command === "set-sequence"
    ))!;
    emitCanvas(canvas, "semanticEditRequest", sequenceEdge.elementId);
    await nextTick();
    expect(wrapper.get<HTMLTextAreaElement>('textarea[aria-label="Structure members"]').element.value)
      .toBe(`${NS}a\n${NS}b\n${NS}a`);
    expect(datalistValuesFor(wrapper, 'input[aria-label="Structure IRI"]'))
      .toContain(`${NS}seq`);
    const config = wrapper.get<HTMLSelectElement>('select[aria-label="Ordinal structure config"]');
    expect(config.element.value).not.toBe("");
    expect(config.text()).toContain("現在の構成");
    await wrapper.get<HTMLTextAreaElement>('textarea[aria-label="Structure members"]')
      .setValue(`${NS}b\n${NS}a\n${NS}a`);
    await buttonWithText(wrapper, "差分をPreview").trigger("click");
    await waitUntil(() => wrapper!.find(".iriograph-authoring-preview").exists());
    expect(wrapper.text()).toContain("適用可能");
  });

  it("objectKinds未指定propertyをedge候補に含めliteral-onlyを除外する", async () => {
    const fixture = documentFixture();
    const context = testAuthoringContext(fixture);
    context.terms = [
      ...context.terms,
      { iri: `${NS}unconstrained`, kind: "property", label: "Unconstrained" },
      {
        iri: `${NS}literalOnly`,
        kind: "property",
        label: "Literal only",
        objectKinds: ["literal"],
      },
    ];
    wrapper = await mountEditor({ authoringContext: context });
    await wrapper.get<HTMLSelectElement>('select[aria-label="Semantic operation"]')
      .setValue("connect-resources");
    await nextTick();

    const predicates = datalistValuesFor(wrapper, 'input[aria-label="Edge predicate"]');
    expect(predicates).toContain(`${NS}unconstrained`);
    expect(predicates).not.toContain(`${NS}literalOnly`);
  });

  it("Alt provenanceから重複memberとdefault ordinal slotをlosslessにseedする", async () => {
    const fixture = alternativeDocumentFixture();
    wrapper = await mountEditor({
      modelValue: fixture,
      authoringContext: testAuthoringContext(fixture),
    }, 3);
    const canvas = wrapper.getComponent(DiagramCanvas);
    const alternativeEdge = canvas.props("scene").edges.find((edge) => (
      edge.provenance?.editCapability?.command === "set-alternatives"
    ))!;
    emitCanvas(canvas, "semanticEditRequest", alternativeEdge.elementId);
    await nextTick();
    expect(wrapper.get<HTMLTextAreaElement>('textarea[aria-label="Structure members"]').element.value)
      .toBe(`${NS}a\n${NS}b\n${NS}a`);
    expect(wrapper.get<HTMLInputElement>('input[aria-label="Default ordinal"]').element.value)
      .toBe("1");
    expect(wrapper.get<HTMLInputElement>('input[aria-label="Default member IRI"]').element.value)
      .toBe(`${NS}a`);
    await wrapper.get<HTMLTextAreaElement>('textarea[aria-label="Structure members"]')
      .setValue(`${NS}b\n${NS}a\n${NS}a`);
    expect(wrapper.get<HTMLInputElement>('input[aria-label="Default member IRI"]').element.value)
      .toBe(`${NS}b`);
    await buttonWithText(wrapper, "差分をPreview").trigger("click");
    await waitUntil(() => wrapper!.find(".iriograph-authoring-preview").exists());
    expect(wrapper.text()).toContain("適用可能");
  });

  it("readOnlyではstructured authoringの全write入口を無効化する", async () => {
    const fixture = documentFixture();
    wrapper = await mountEditor({
      authoringContext: testAuthoringContext(fixture),
      readOnly: true,
    });
    expect(wrapper.get<HTMLSelectElement>('select[aria-label="Semantic operation"]').element.disabled)
      .toBe(true);
    await buttonWithText(wrapper, "差分をPreview").trigger("click");
    expect(wrapper.find(".iriograph-authoring-preview").exists()).toBe(false);
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
  });

  it("ProjectionRuntimeContextをprimary propとしてcatalogなしで表示する", async () => {
    const runtime = createProjectionRuntimeContext([{
      profileRef: standardRdfRdfsCatalog.profileRef,
      sourceCatalogRefs: [catalogRef(standardRdfRdfsCatalog)],
      catalog: standardRdfRdfsCatalog,
      ruleOrigins: [],
    }], createStandardLayoutRegistry());
    wrapper = await mountEditor({ runtimeContext: runtime, catalog: undefined });

    expect(wrapper.getComponent(DiagramCanvas).props("scene").nodes).toHaveLength(2);
    expect(wrapper.find(".iriograph-diagnostics .error").exists()).toBe(false);
  });

  it("uncontrolled active viewを切替え、selection・zoom・temporary hideをview別sessionへ戻す", async () => {
    const fixture = multiViewDocumentFixture();
    wrapper = await mountEditor({ modelValue: fixture });
    const select = wrapper.get<HTMLSelectElement>('select[aria-label="Named view"]');
    const api = wrapper.vm as unknown as IriographEditorNavigationApi & IriographEditorSelectionApi;
    let canvas = wrapper.getComponent(DiagramCanvas);
    const mainA = canvas.props("scene").nodes.find((node) => node.semanticRef === `${NS}a`)!;
    api.selectElement(mainA.elementId);
    await api.zoomTo(1.5);
    await settle();

    await select.setValue("review");
    await waitUntil(() => wrapper!.get<HTMLSelectElement>('select[aria-label="Named view"]').element.value === "review");
    canvas = wrapper.getComponent(DiagramCanvas);
    const reviewB = canvas.props("scene").nodes.find((node) => node.semanticRef === `${NS}b`)!;
    api.selectElement(reviewB.elementId);
    await settle();
    expect(canvas.props("selectedElementId")).toBe(reviewB.elementId);
    expect(wrapper.text()).toContain("100%");

    await wrapper.get<HTMLSelectElement>('select[aria-label="Named view"]').setValue("main");
    await waitUntil(() => wrapper!.getComponent(DiagramCanvas).props("selectedElementId") === mainA.elementId);
    expect(wrapper.text()).toContain("150%");
    const beforeHideUpdates = wrapper.emitted("update:modelValue")?.length ?? 0;
    await buttonWithText(wrapper, "一時非表示").trigger("click");
    await settle();
    expect(wrapper.getComponent(DiagramCanvas).props("scene").nodes).toHaveLength(1);
    expect(wrapper.emitted("update:modelValue")?.length ?? 0).toBe(beforeHideUpdates);

    await wrapper.get<HTMLSelectElement>('select[aria-label="Named view"]').setValue("review");
    await waitUntil(() => wrapper!.getComponent(DiagramCanvas).props("selectedElementId") === reviewB.elementId);
    expect(wrapper.getComponent(DiagramCanvas).props("scene").nodes).toHaveLength(2);
    await wrapper.get<HTMLSelectElement>('select[aria-label="Named view"]').setValue("main");
    await waitUntil(() => wrapper!.getComponent(DiagramCanvas).props("scene").nodes.length === 1);
    expect(buttonWithText(wrapper, "再表示").text()).toContain("(1)");
  });

  it("active view切替で旧viewのvalidation結果をabortしSceneへ採用しない", async () => {
    let calls = 0;
    let oldRequestAborted = false;
    let releaseOld!: () => void;
    const oldGate = new Promise<void>((resolve) => { releaseOld = resolve; });
    const context: ResolvedSemanticValidationContext = {
      contextId: "urn:test:view-switch-validation",
      contextRevision: "1",
      validator: {
        async validate(request, signal) {
          calls += 1;
          if (calls === 2) {
            await oldGate;
            oldRequestAborted = signal.aborted;
          }
          return validationResponse(request, []);
        },
      },
    };
    wrapper = await mountEditor({
      modelValue: multiViewDocumentFixture(),
      semanticValidationContext: context,
    });
    const select = wrapper.get<HTMLSelectElement>('select[aria-label="Named view"]');
    await select.setValue("review");
    await waitUntil(() => calls >= 2);
    await wrapper.get<HTMLSelectElement>('select[aria-label="Named view"]').setValue("main");
    await waitUntil(() => calls >= 3);
    releaseOld();
    await settle();

    expect(oldRequestAborted).toBe(true);
    expect(wrapper.getComponent(DiagramCanvas).props("scene").viewId).toBe("main");
    expect(wrapper.get<HTMLSelectElement>('select[aria-label="Named view"]').element.value).toBe("main");
  });

  it("uncontrolled duplicateは新viewをactiveにし、controlled duplicateは親へ選択要求だけをemitする", async () => {
    wrapper = await mountEditor({ modelValue: multiViewDocumentFixture() });
    await buttonWithText(wrapper, "複製").trigger("click");
    await waitUntil(() => latestDocument(wrapper!).views.some((view) => view.viewId === "main-copy"));
    expect(wrapper.get<HTMLSelectElement>('select[aria-label="Named view"]').element.value).toBe("main-copy");
    expect(wrapper.emitted("update:activeViewId")?.at(-1)?.[0]).toBe("main-copy");
    wrapper.unmount();

    wrapper = await mountEditor({
      modelValue: multiViewDocumentFixture(),
      activeViewId: "main",
    });
    await buttonWithText(wrapper, "複製").trigger("click");
    await waitUntil(() => latestDocument(wrapper!).views.some((view) => view.viewId === "main-copy"));
    expect(wrapper.get<HTMLSelectElement>('select[aria-label="Named view"]').element.value).toBe("main");
    expect(wrapper.emitted("update:activeViewId")?.at(-1)?.[0]).toBe("main-copy");
  });

  it("存在しないcontrolled activeViewIdはdocument先頭viewへfallbackする", async () => {
    wrapper = await mountEditor({
      modelValue: multiViewDocumentFixture(),
      activeViewId: "missing",
    });
    expect(wrapper.get<HTMLSelectElement>('select[aria-label="Named view"]').element.value).toBe("main");
    expect(wrapper.getComponent(DiagramCanvas).props("scene").viewId).toBe("main");
  });

  it("controlled view選択は親へ要求し、prop更新まで表示Sceneを切り替えない", async () => {
    wrapper = await mountEditor({
      modelValue: multiViewDocumentFixture(),
      activeViewId: "main",
    });
    const select = wrapper.get<HTMLSelectElement>('select[aria-label="Named view"]');
    await select.setValue("review");
    expect(wrapper.emitted("update:activeViewId")?.at(-1)?.[0]).toBe("review");
    expect(select.element.value).toBe("main");
    expect(wrapper.getComponent(DiagramCanvas).props("scene").viewId).toBe("main");

    await wrapper.setProps({ activeViewId: "review" });
    await waitUntil(() => wrapper!.getComponent(DiagramCanvas).props("scene").viewId === "review");
    expect(select.element.value).toBe("review");
  });

  it("view configureはIDをreadonlyにし、last view deleteをUIでも禁止する", async () => {
    wrapper = await mountEditor();
    expect(buttonWithText(wrapper, "削除").attributes("disabled")).toBeDefined();
    await buttonWithText(wrapper, "設定").trigger("click");
    const viewId = wrapper.get<HTMLInputElement>('.iriograph-view-dialog input[readonly]');
    expect(viewId.element.value).toBe("main");
    await wrapper.get<HTMLInputElement>('.iriograph-view-dialog input[placeholder="ja"]')
      .setValue("en-US");
    await wrapper.get<HTMLButtonElement>('.iriograph-view-dialog button[type="submit"]')
      .trigger("click");
    await waitUntil(() => (
      (wrapper!.emitted("update:modelValue")?.at(-1)?.[0] as IriographDocument | undefined)
        ?.views[0]?.locale === "en-US"
    ));
    expect(latestDocument(wrapper).views[0]!.viewId).toBe("main");
  });
});

async function mountEditor(
  extraProps: Record<string, unknown> = {},
  expectedNodeCount = 2,
): Promise<VueWrapper> {
  const wrapper = mount(IriographEditor, {
    attachTo: document.body,
    props: {
      modelValue: documentFixture(),
      catalog: standardRdfRdfsCatalog,
      title: "Editor regression fixture",
      ...extraProps,
    },
  });
  await waitUntil(() => (
    wrapper.getComponent(DiagramCanvas).props("scene").nodes.length === expectedNodeCount
  ));
  return wrapper;
}

function configureEditorViewport(wrapper: VueWrapper, width: number, height: number): void {
  const viewport = wrapper.get<HTMLElement>(".iriograph-canvas-scroll").element;
  const stage = wrapper.get<HTMLElement>(".iriograph-canvas-stage").element;
  Object.defineProperties(viewport, {
    clientWidth: { configurable: true, value: width },
    clientHeight: { configurable: true, value: height },
  });
  Object.defineProperties(stage, {
    offsetLeft: { configurable: true, value: 20 },
    offsetTop: { configurable: true, value: 20 },
  });
  window.dispatchEvent(new Event("resize"));
}

async function openTurtlePanel(wrapper: VueWrapper): Promise<void> {
  await buttonWithText(wrapper, "Turtle").trigger("click");
  await nextTick();
}

function emitCanvas(
  canvas: unknown,
  event: string,
  payload?: unknown,
): void {
  const instance = (canvas as { vm: { $emit: (event: string, payload?: unknown) => void } }).vm;
  instance.$emit(event, payload);
}

function buttonWithText(wrapper: VueWrapper, text: string) {
  const button = wrapper.findAll("button").find((candidate) => candidate.text().includes(text));
  if (!button) throw new Error(`button containing ${text} was not found`);
  return button;
}

function buttonWithTitle(wrapper: VueWrapper, title: string) {
  return wrapper.get<HTMLButtonElement>(`button[title="${title}"]`);
}

function exposedApi(wrapper: VueWrapper): { flushPendingEdits: () => Promise<boolean> } {
  return wrapper.vm as unknown as { flushPendingEdits: () => Promise<boolean> };
}

function exposedSelectionApi(wrapper: VueWrapper): IriographEditorSelectionApi {
  return wrapper.vm as unknown as IriographEditorSelectionApi;
}

function exposedHistoryApi(wrapper: VueWrapper): { undo(): void; redo(): void } {
  return wrapper.vm as unknown as { undo(): void; redo(): void };
}

function latestDocument(wrapper: VueWrapper): IriographDocument {
  const document = wrapper.emitted("update:modelValue")?.at(-1)?.[0];
  if (!document) throw new Error("editor has not emitted a document update");
  return document as IriographDocument;
}

function overlayFor(document: IriographDocument, semanticRef: string) {
  return Object.values(document.views[0]?.overlay ?? {})
    .find((overlay) => overlay.semanticRef === semanticRef);
}

function datalistValuesFor(wrapper: VueWrapper, inputSelector: string): string[] {
  const listId = wrapper.get<HTMLInputElement>(inputSelector).attributes("list");
  if (!listId) throw new Error(`input ${inputSelector} has no datalist`);
  const list = document.getElementById(listId);
  if (!(list instanceof HTMLDataListElement)) throw new Error(`datalist ${listId} was not found`);
  return [...list.options].map((option) => option.value);
}

function summaryNodeCount(wrapper: VueWrapper): number {
  return Number(wrapper.get(".iriograph-view-summary b").text());
}

function offset(geometry: ElementGeometry, x: number, y: number): ElementGeometry {
  return {
    ...geometry,
    x: geometry.x + x,
    y: geometry.y + y,
  };
}

async function waitUntil(predicate: () => boolean, message = "editor did not settle"): Promise<void> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    await settle();
    if (predicate()) return;
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  }
  throw new Error(message);
}

async function settle(): Promise<void> {
  await flushPromises();
  await nextTick();
}

function documentFixture(): IriographDocumentV1 {
  return {
    schemaVersion: "1",
    kind: "iriograph.document",
    documentId: "editor-regression",
    semantic: {
      format: "text/turtle",
      baseIri: NS,
      authoringProfileRef: "urn:test:authoring:1",
      source: initialSource,
    },
    views: [{
      viewId: "main",
      kind: "node-link",
      profileRef: standardRdfRdfsCatalog.profileRef,
      layoutRef: STANDARD_LAYOUT_REFS.hierarchicalLr,
      overlay: {},
    }],
  };
}

function multiViewDocumentFixture(): IriographDocumentV1 {
  const document = documentFixture();
  document.views.push({
    ...structuredClone(document.views[0]!),
    viewId: "review",
    locale: "en",
  });
  return document;
}

function threeNodeDocumentFixture(): IriographDocumentV1 {
  const document = documentFixture();
  document.documentId = "editor-three-node-regression";
  document.semantic.source = `${initialSource}\n:c rdfs:label "C" .\n`;
  return document;
}

function containedDocumentFixture(): IriographDocumentV1 {
  const document = documentFixture();
  document.documentId = "editor-contained-regression";
  document.semantic.source = `
@prefix : <${NS}> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
:lane a rdf:Bag ; rdfs:label "Lane" ; rdfs:member :a .
:a rdfs:label "A" .
`;
  return document;
}

function sequenceDocumentFixture(): IriographDocumentV1 {
  const document = documentFixture();
  document.documentId = "editor-sequence-regression";
  document.semantic.source = `
@prefix : <${NS}> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
:Flow rdfs:subClassOf rdf:Seq .
:seq a :Flow ; rdf:_1 :a ; rdf:_2 :b ; rdf:_3 :a .
:a rdfs:label "A" .
:b rdfs:label "B" .
`;
  return document;
}

function alternativeDocumentFixture(): IriographDocumentV1 {
  const document = documentFixture();
  document.documentId = "editor-alternative-regression";
  document.semantic.source = `
@prefix : <${NS}> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
:alt a rdf:Alt ; rdf:_1 :a ; rdf:_2 :b ; rdf:_3 :a .
:a rdfs:label "A" .
:b rdfs:label "B" .
`;
  return document;
}

function testAuthoringContext(document: IriographDocumentV1): ResolvedAuthoringContext {
  return {
    contextId: "urn:test:editor:authoring-context",
    contextRevision: "1",
    documentRevision: `revision:${document.documentId}:${document.semantic.source.length}`,
    authoringProfileRef: document.semantic.authoringProfileRef,
    runtime: createProjectionRuntimeContext([{
      profileRef: standardRdfRdfsCatalog.profileRef,
      sourceCatalogRefs: [catalogRef(standardRdfRdfsCatalog)],
      catalog: standardRdfRdfsCatalog,
      ruleOrigins: [],
    }], createStandardLayoutRegistry()),
    resourcePolicy: { allowedMintNamespaces: [NS] },
    termPolicy: {
      existingUnknown: "preserve",
      humanUnknown: "warn",
      llmUnknown: "reject",
      humanMinting: "deny",
      llmMinting: "deny",
    },
    terms: [
      { iri: TASK_CLASS, kind: "class", label: "Task" },
      {
        iri: "http://www.w3.org/2000/01/rdf-schema#label",
        kind: "property",
        label: "Label",
        objectKinds: ["literal"],
        maxCount: 1,
      },
      { iri: `${NS}rel`, kind: "property", label: "Rel", objectKinds: ["iri"] },
    ],
    capabilities: [],
  };
}

function validationContext(
  findings: (
    request: SemanticValidationRequest,
    signal: AbortSignal,
  ) => readonly SemanticValidationFinding[] | Promise<readonly SemanticValidationFinding[]>,
  contextRevision = "1",
): ResolvedSemanticValidationContext {
  return {
    contextId: "urn:test:editor:semantic-validation",
    contextRevision,
    validator: {
      async validate(request, signal) {
        return validationResponse(request, await findings(request, signal));
      },
    },
  };
}

function validationResponse(
  request: SemanticValidationRequest,
  findings: readonly SemanticValidationFinding[],
): SemanticValidationResponse {
  return {
    contextId: request.contextId,
    contextRevision: request.contextRevision,
    sourceFingerprint: request.sourceFingerprint,
    datasetFingerprint: request.datasetFingerprint,
    findings,
  };
}

function fixedAllocator(iri: string): ResourceIriAllocator {
  return {
    allocate(request) {
      return {
        iri,
        requestId: request.requestId,
        baseRevision: request.baseRevision,
        contextId: request.contextId,
      };
    },
  };
}

function delayedLayoutRegistry(): {
  registry: LayoutAdapterRegistry;
  started: Promise<void>;
  arm(): void;
  release(): void;
} {
  const delegate = new StandardLightweightLayoutAdapter(
    STANDARD_LAYOUT_REFS.hierarchicalLr,
    "LR",
  );
  let armed = false;
  let release!: () => void;
  let markStarted!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const started = new Promise<void>((resolve) => { markStarted = resolve; });
  const adapter: LayoutAdapter = {
    layoutRef: STANDARD_LAYOUT_REFS.hierarchicalLr,
    async layout(request) {
      const result = await delegate.layout(request);
      if (armed) {
        markStarted();
        await gate;
      }
      return result;
    },
  };
  return {
    registry: new LayoutAdapterRegistry([adapter]),
    started,
    arm() { armed = true; },
    release,
  };
}
