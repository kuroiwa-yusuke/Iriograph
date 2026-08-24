import { afterEach, describe, expect, it, vi } from "vitest";
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
    vi.restoreAllMocks();
  });

  it("Canvas/source selectorを押下状態が分かるbutton groupとして公開する", async () => {
    wrapper = await mountEditor();
    const selector = wrapper.get('.iriograph-view-tabs[role="group"]');
    const buttons = selector.findAll("button");
    expect(selector.attributes("aria-label")).toContain("Canvas");
    expect(buttons[0]?.attributes("aria-pressed")).toBe("true");
    await buttons[1]!.trigger("click");
    expect(buttons[0]?.attributes("aria-pressed")).toBe("false");
    expect(buttons[1]?.attributes("aria-pressed")).toBe("true");
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

  it("presentation変更ではlayoutを再実行せずgeometryを保持し、semantic適用時だけ再実行する", async () => {
    const layout = vi.spyOn(StandardLightweightLayoutAdapter.prototype, "layout");
    wrapper = await mountEditor();
    const canvas = wrapper.getComponent(DiagramCanvas);
    const initialScene = canvas.props("scene") as DiagramScene;
    const source = initialScene.nodes.find((item) => item.semanticRef === `${NS}a`)!;
    const untouched = initialScene.nodes.find((item) => item.semanticRef === `${NS}b`)!;
    const initialUntouchedGeometry = { ...untouched.geometry };
    const initialRoute = initialScene.edges[0]!.route?.map((point) => ({ ...point }));
    const initialLayoutCalls = layout.mock.calls.length;

    emitCanvas(canvas, "gestureStart");
    emitCanvas(canvas, "geometryBatchChange", [{
      elementId: source.elementId,
      geometry: offset(source.geometry, 48, 20),
    }]);
    emitCanvas(canvas, "gestureEnd");
    await settle();

    const presentationScene = canvas.props("scene") as DiagramScene;
    expect(layout.mock.calls.length).toBe(initialLayoutCalls);
    expect(presentationScene.nodes.find((item) => item.elementId === untouched.elementId)?.geometry)
      .toEqual(initialUntouchedGeometry);
    expect(presentationScene.edges[0]?.route).not.toEqual(initialRoute);

    emitCanvas(canvas, "routingUpdate", {
      elementId: presentationScene.edges[0]!.elementId,
      routing: { waypoints: [{ x: 250, y: 140 }] },
    });
    await settle();
    expect(layout.mock.calls.length).toBe(initialLayoutCalls);

    await openTurtlePanel(wrapper);
    await wrapper.get<HTMLTextAreaElement>('textarea[aria-label="Turtle source"]')
      .setValue(`${initialSource}\n:a rdfs:comment "Changed" .\n`);
    await buttonWithText(wrapper, "検証して適用").trigger("click");
    await waitUntil(() => layout.mock.calls.length > initialLayoutCalls);
    await settle();
    expect(layout.mock.calls.length).toBeGreaterThan(initialLayoutCalls);
  });

  it("region label anchor・writing direction・z-orderをtyped appearanceへ保存する", async () => {
    wrapper = await mountEditor({ modelValue: regionDocumentFixture() }, 1);
    const canvas = wrapper.getComponent(DiagramCanvas);
    const region = (canvas.props("scene") as DiagramScene).regions![0]!;

    emitCanvas(canvas, "regionLabelUpdate", { elementId: region.elementId, anchor: .4 });
    await settle();
    exposedSelectionApi(wrapper).selectElement(region.elementId);
    await openAppearanceInspector(wrapper);
    await buttonWithText(wrapper, "ラベルの配置").trigger("click");
    await wrapper.get<HTMLSelectElement>('select[aria-label="Region label writing direction"]')
      .setValue("vertical-down");
    await buttonWithText(wrapper, "領域を前面へ").trigger("click");
    await settle();

    expect(overlayFor(latestDocument(wrapper), region.semanticRef)?.appearance).toMatchObject({
      regionLabelAnchor: .4,
      regionLabelWritingDirection: "vertical-down",
      regionZOrder: 1,
    });
    expect(overlayFor(latestDocument(wrapper), region.semanticRef)?.appearance?.extensions)
      .toBeUndefined();
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

  it("endpoint anchorsをdisplay overlayだけへ保存し一つのgestureとしてundoする", async () => {
    wrapper = await mountEditor();
    const canvas = wrapper.getComponent(DiagramCanvas);
    const edge = canvas.props("scene").edges[0]!;
    const turtle = initialSource;

    emitCanvas(canvas, "gestureStart");
    emitCanvas(canvas, "routingUpdate", {
      elementId: edge.elementId,
      routing: { sourceAnchor: { position: 0 }, targetAnchor: { position: .75 } },
    });
    emitCanvas(canvas, "gestureEnd");
    await settle();

    expect(overlayFor(latestDocument(wrapper), edge.semanticRef)?.routing).toEqual({
      sourceAnchor: { position: 0 },
      targetAnchor: { position: .75 },
    });
    expect(latestDocument(wrapper).semantic.source).toBe(turtle);

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

  it("線の形式をrouting overlayへ保存し接点編集後も維持してresetする", async () => {
    wrapper = await mountEditor();
    const canvas = wrapper.getComponent(DiagramCanvas);
    const edge = canvas.props("scene").edges[0]!;
    exposedSelectionApi(wrapper).selectElement(edge.elementId);
    await nextTick();
    await openAppearanceInspector(wrapper);
    await wrapper.get<HTMLSelectElement>('select[aria-label="線の形式"]').setValue("manual");
    await buttonWithText(wrapper, "Waypointを追加").trigger("click");
    await settle();
    expect(overlayFor(latestDocument(wrapper), edge.semanticRef)?.routing?.waypoints?.length)
      .toBeGreaterThan(0);
    await wrapper.get<HTMLSelectElement>('select[aria-label="線の形式"]').setValue("curve");
    await settle();
    expect(overlayFor(latestDocument(wrapper), edge.semanticRef)?.routing?.routeMode).toBe("curve");
    expect(overlayFor(latestDocument(wrapper), edge.semanticRef)?.routing?.waypoints).toBeUndefined();
    expect(wrapper.findAll("button").some((button) => button.text() === "Waypointを追加")).toBe(false);

    emitCanvas(canvas, "gestureStart");
    emitCanvas(canvas, "routingUpdate", {
      elementId: edge.elementId,
      routing: {
        waypoints: [{ x: 123, y: 234 }],
        sourceAnchor: { position: .25 },
      },
    });
    emitCanvas(canvas, "gestureEnd");
    await settle();
    expect(overlayFor(latestDocument(wrapper), edge.semanticRef)?.routing).toMatchObject({
      routeMode: "curve",
      sourceAnchor: { position: .25 },
    });
    expect(overlayFor(latestDocument(wrapper), edge.semanticRef)?.routing?.waypoints).toBeUndefined();

    await buttonWithText(wrapper, "線の調整をすべてリセット").trigger("click");
    await settle();
    expect(overlayFor(latestDocument(wrapper), edge.semanticRef)).toBeUndefined();
  });

  it("Inspectorからderived routeをmanualへseedしlabel座標を隠してresetする", async () => {
    wrapper = await mountEditor();
    const canvas = wrapper.getComponent(DiagramCanvas);
    const edge = canvas.props("scene").edges[0]!;
    exposedSelectionApi(wrapper).selectElement(edge.elementId);
    await nextTick();
    await openAppearanceInspector(wrapper);

    await wrapper.get<HTMLSelectElement>('select[aria-label="線の形式"]').setValue("manual");
    await buttonWithText(wrapper, "Waypointを追加").trigger("click");
    await settle();
    const manual = overlayFor(latestDocument(wrapper), edge.semanticRef)?.routing?.waypoints;
    expect(manual).toHaveLength((edge.route?.length ?? 2) - 1);
    expect(manual?.every((point) => point.x >= 8 && point.y >= 8)).toBe(true);

    expect(wrapper.find(".iriograph-routing-inspector .iriograph-geometry-grid").exists()).toBe(false);
    emitCanvas(canvas, "gestureStart");
    emitCanvas(canvas, "routingUpdate", {
      elementId: edge.elementId,
      routing: { waypoints: manual, labelOffset: { x: 15, y: 0 } },
    });
    emitCanvas(canvas, "gestureEnd");
    await settle();
    expect(overlayFor(latestDocument(wrapper), edge.semanticRef)?.routing?.labelOffset)
      .toEqual({ x: 15, y: 0 });

    await wrapper.get(".iriograph-view-disclosure summary").trigger("click");
    await buttonWithText(wrapper, "ラベル位置をリセット").trigger("click");
    await settle();
    expect(overlayFor(latestDocument(wrapper), edge.semanticRef)?.routing?.labelOffset)
      .toBeUndefined();
    expect(buttonWithText(wrapper, "線の調整をすべてリセット").attributes("disabled")).toBeUndefined();
    await buttonWithText(wrapper, "線の調整をすべてリセット").trigger("click");
    await settle();
    expect(overlayFor(latestDocument(wrapper), edge.semanticRef)).toBeUndefined();
  });

  it("Inspectorはendpoint anchorの数値を隠し、Canvas調整と一括resetだけを提供する", async () => {
    wrapper = await mountEditor();
    const canvas = wrapper.getComponent(DiagramCanvas);
    const edge = canvas.props("scene").edges[0]!;
    exposedSelectionApi(wrapper).selectElement(edge.elementId);
    await nextTick();
    await openAppearanceInspector(wrapper);

    expect(wrapper.find(".iriograph-endpoint-anchor-fields").exists()).toBe(false);
    emitCanvas(canvas, "gestureStart");
    emitCanvas(canvas, "routingUpdate", {
      elementId: edge.elementId,
      routing: { sourceAnchor: { position: .25 }, targetAnchor: { position: .5 } },
    });
    emitCanvas(canvas, "gestureEnd");
    await settle();
    expect(overlayFor(latestDocument(wrapper), edge.semanticRef)?.routing).toEqual({
      sourceAnchor: { position: .25 },
      targetAnchor: { position: .5 },
    });

    const markers = wrapper.findAll<HTMLSelectElement>(".iriograph-endpoint-marker-fields select");
    expect(markers).toHaveLength(2);
    await markers[0]!.setValue("diamond");
    await settle();
    await markers[1]!.setValue("open-arrow");
    await settle();
    expect(overlayFor(latestDocument(wrapper), edge.semanticRef)?.routing).toMatchObject({
      sourceMarker: "diamond",
      targetMarker: "open-arrow",
    });

    const disclosures = wrapper.findAll(".iriograph-view-disclosure");
    await disclosures[1]!.get("summary").trigger("click");
    await buttonWithText(wrapper, "接続位置を自動に戻す").trigger("click");
    await settle();
    expect(overlayFor(latestDocument(wrapper), edge.semanticRef)?.routing).toEqual({
      sourceMarker: "diamond",
      targetMarker: "open-arrow",
    });

    await buttonWithText(wrapper, "線の調整をすべてリセット").trigger("click");
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

  it("viewportのArrow focus移動とcommand+Arrow presentation editを使い分ける", async () => {
    wrapper = await mountEditor();
    configureEditorViewport(wrapper, 180, 140);
    const canvas = wrapper.getComponent(DiagramCanvas);
    const target = canvas.props("scene").nodes[0]!;
    const selectionApi = wrapper.vm as unknown as { selectElement(elementId: string): void };
    selectionApi.selectElement(target.elementId);
    await nextTick();
    const viewport = wrapper.get<HTMLElement>(".iriograph-canvas-scroll");

    await viewport.trigger("keydown", { key: "ArrowRight" });
    expect(viewport.attributes("aria-activedescendant")).not.toContain(target.elementId);
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();

    await viewport.trigger("keydown", { key: "ArrowLeft" });
    await viewport.trigger("keydown", { key: "ArrowRight", ctrlKey: true });
    await viewport.trigger("keyup", { key: "ArrowRight", ctrlKey: true });
    await settle();
    expect(wrapper.emitted("update:modelValue")).toHaveLength(1);
  });

  it("keyboard repeat previewを一つのpresentation historyにしTurtleを変えない", async () => {
    wrapper = await mountEditor();
    const canvas = wrapper.getComponent(DiagramCanvas);
    const target = canvas.props("scene").nodes[0]!;
    const source = documentFixture().semantic.source;
    exposedSelectionApi(wrapper).selectElement(target.elementId);
    await nextTick();
    const viewport = wrapper.get(".iriograph-canvas-scroll");

    await viewport.trigger("keydown", { key: "ArrowRight", ctrlKey: true });
    await viewport.trigger("keydown", { key: "ArrowRight", ctrlKey: true, repeat: true });
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
    await viewport.trigger("keyup", { key: "ArrowRight", ctrlKey: true });
    await settle();

    const changed = latestDocument(wrapper);
    expect(changed.semantic.source).toBe(source);
    expect(overlayFor(changed, target.semanticRef)?.geometry?.x).toBe(target.geometry.x + 2);
    exposedHistoryApi(wrapper).undo();
    await settle();
    expect(overlayFor(latestDocument(wrapper), target.semanticRef)).toBeUndefined();
  });

  it("contenteditable/inputとcomposition由来keyをglobal commandとして扱わない", async () => {
    wrapper = await mountEditor();
    const editable = document.createElement("div");
    editable.contentEditable = "true";
    wrapper.element.append(editable);
    editable.dispatchEvent(new KeyboardEvent("keydown", {
      key: "s",
      ctrlKey: true,
      bubbles: true,
    }));
    expect(wrapper.emitted("save")).toBeUndefined();

    const viewport = wrapper.get(".iriograph-canvas-scroll");
    await viewport.trigger("compositionstart");
    await viewport.trigger("keydown", { key: "ArrowRight" });
    await viewport.trigger("compositionend");
    expect(wrapper.emitted("selectionChanged")).toBeUndefined();
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
  });

  it("readOnlyでもnavigationを許可しpresentation editは発行しない", async () => {
    wrapper = await mountEditor({ readOnly: true });
    configureEditorViewport(wrapper, 180, 140);
    const viewport = wrapper.get<HTMLElement>(".iriograph-canvas-scroll");

    const before = viewport.attributes("aria-activedescendant");
    await viewport.trigger("keydown", { key: "ArrowDown" });
    expect(viewport.attributes("aria-activedescendant")).not.toBe(before);
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

  it("右Inspectorは4つの意味intentから始まり意味と見た目を同時表示しない", async () => {
    wrapper = await mountEditor({ authoringContext: testAuthoringContext(documentFixture()) });
    expect(wrapper.findAll(".iriograph-intent-grid button").map((button) => button.text())).toEqual([
      "＋新しい要素を作る",
      "→関係を作る",
      "✎要素を変更する",
      "⌘関係を変更する",
    ]);
    expect(wrapper.find(".iriograph-display-inspector").isVisible()).toBe(false);
    expect(wrapper.find('select[aria-label="Semantic operation"]').exists()).toBe(false);
    await openAppearanceInspector(wrapper);
    expect(wrapper.find(".iriograph-intent-panel").isVisible()).toBe(false);
    expect(wrapper.find(".iriograph-display-inspector").isVisible()).toBe(true);
  });

  it("意味と見た目を切り替えても未Previewの段階入力を失わない", async () => {
    wrapper = await mountEditor({ authoringContext: testAuthoringContext(documentFixture()) });
    await buttonWithText(wrapper, "新しい要素を作る").trigger("click");
    await wrapper.get<HTMLTextAreaElement>('textarea[aria-label="新しい要素の名前"]').setValue("入力途中");
    await openAppearanceInspector(wrapper);
    expect(wrapper.find(".iriograph-intent-panel").isVisible()).toBe(false);
    await wrapper.findAll("button").find((candidate) => candidate.text() === "意味")!.trigger("click");
    expect(wrapper.get<HTMLTextAreaElement>('textarea[aria-label="新しい要素の名前"]').element.value)
      .toBe("入力途中");
  });

  it("relation pickerへ関係語彙だけをlabel文型で示し制約predicateを除外する", async () => {
    const fixture = documentFixture();
    const context = testAuthoringContext(fixture);
    context.terms = [...context.terms,
      { iri: "http://www.w3.org/2000/01/rdf-schema#domain", kind: "property", label: "主語にできる種類", objectKinds: ["iri"], structural: true },
      { iri: "http://www.w3.org/1999/02/22-rdf-syntax-ns#_1", kind: "property", label: "順序1", objectKinds: ["iri"] },
      { iri: "http://www.w3.org/2002/07/owl#sameAs", kind: "property", label: "同一である", objectKinds: ["iri"] },
    ];
    wrapper = await mountEditor({ authoringContext: context });
    const nodes = wrapper.getComponent(DiagramCanvas).props("scene").nodes;
    exposedSelectionApi(wrapper).selectElements(nodes.map((node) => node.elementId));
    await nextTick();
    await buttonWithText(wrapper, "関係を作る").trigger("click");
    const cards = wrapper.get(".iriograph-predicate-cards");
    expect(cards.text()).toContain("A（Rel）B");
    expect(cards.text()).toContain("A（同一である）B");
    expect(cards.text()).not.toContain("主語にできる種類");
    expect(cards.text()).not.toContain("順序1");
    expect(cards.text()).not.toContain("http://");
  });

  it("relation pickerは選択要素のRDFS型closureとdomain/rangeが明確に不適合な候補を除外する", async () => {
    const fixture = documentFixture();
    fixture.semantic.source += `
<${NS}a> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <${NS}ChildSource> .
<${NS}ChildSource> <http://www.w3.org/2000/01/rdf-schema#subClassOf> <${NS}Source> .
<${NS}b> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <${NS}Target> .
<${NS}good> <http://www.w3.org/2000/01/rdf-schema#domain> <${NS}Source> ;
  <http://www.w3.org/2000/01/rdf-schema#range> <${NS}Target> .
<${NS}bad> <http://www.w3.org/2000/01/rdf-schema#domain> <${NS}Other> .
<${NS}ChildSource> rdfs:label "Child source" .
<${NS}Source> rdfs:label "Source" .
<${NS}Target> rdfs:label "Target" .
<${NS}Other> rdfs:label "Other" .
<${NS}good> rdfs:label "Good relation" .
<${NS}bad> rdfs:label "Bad relation" .
`;
    const context = testAuthoringContext(fixture);
    context.terms = [...context.terms,
      { iri: `${NS}good`, kind: "property", label: "適合する", objectKinds: ["iri"] },
      { iri: `${NS}bad`, kind: "property", label: "不適合", objectKinds: ["iri"] },
    ];
    wrapper = await mountEditor({ modelValue: fixture, authoringContext: context }, 8);
    const nodes = wrapper.getComponent(DiagramCanvas).props("scene").nodes;
    exposedSelectionApi(wrapper).selectElements([
      nodes.find((node) => node.semanticRef === `${NS}a`)!.elementId,
      nodes.find((node) => node.semanticRef === `${NS}b`)!.elementId,
    ]);
    await nextTick();
    await buttonWithText(wrapper, "関係を作る").trigger("click");
    const cards = wrapper.get(".iriograph-predicate-cards").text();
    expect(cards).toContain("適合する");
    expect(cards).not.toContain("不適合");
  });

  it("label一文の新規要素をPreview後に一つのsemantic historyへ適用する", async () => {
    const fixture = documentFixture();
    wrapper = await mountEditor({
      authoringContext: testAuthoringContext(fixture),
      resourceIriAllocator: fixedAllocator(`${NS}created`),
    });

    await buttonWithText(wrapper, "新しい要素を作る").trigger("click");
    await wrapper.get<HTMLTextAreaElement>('textarea[aria-label="新しい要素の名前"]').setValue("Created task");
    expect(wrapper.find('input[aria-label="Resource class"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain("配置位置");
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();

    await buttonWithText(wrapper, "変更内容を確認").trigger("click");
    await waitUntil(() => wrapper!.find(".iriograph-authoring-preview").exists());
    expect(wrapper.text()).toContain("適用可能");
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();

    await wrapper.get<HTMLButtonElement>(".iriograph-authoring-preview .primary").trigger("click");
    await waitUntil(() => Boolean(wrapper!.emitted("update:modelValue")?.length));
    const created = latestDocument(wrapper);
    expect(created.semantic.source).toMatch(/(?:<urn:test:editor:created>|:created)\s/);
    expect(wrapper.emitted("update:modelValue")).toHaveLength(1);
    expect(overlayFor(created, `${NS}created`)).toMatchObject({ pinned: false, placement: "generated" });

    exposedHistoryApi(wrapper).undo();
    await settle();
    expect(latestDocument(wrapper).semantic.source).not.toMatch(/(?:<urn:test:editor:created>|:created)\s/);
    expect(overlayFor(latestDocument(wrapper), `${NS}created`)).toBeUndefined();
  });

  it("Meaning authoringを右Inspectorの4 intentへ置き通常UIにIRIを出さない", async () => {
    const fixture = documentFixture();
    wrapper = await mountEditor({ authoringContext: testAuthoringContext(fixture) });

    const inspector = wrapper.get(".iriograph-inspector");
    expect(inspector.find(".iriograph-intent-grid").exists()).toBe(true);
    expect(inspector.find(".iriograph-authoring-panel").exists()).toBe(false);
    expect(inspector.text()).not.toContain(TASK_CLASS);
    expect(inspector.find('input[placeholder*="urn:"]').exists()).toBe(false);
  });

  it("pendingDraftsChangedで確認中semantic/Turtle draftの現在値をimmediate通知する", async () => {
    const fixture = documentFixture();
    wrapper = await mountEditor({ authoringContext: testAuthoringContext(fixture) });

    expect(wrapper.emitted("pendingDraftsChanged")?.[0]).toEqual([false]);
    await buttonWithText(wrapper, "新しい要素を作る").trigger("click");
    await wrapper.get<HTMLTextAreaElement>('textarea[aria-label="新しい要素の名前"]').setValue("未適用");
    await buttonWithText(wrapper, "変更内容を確認").trigger("click");
    await waitUntil(() => wrapper!.find(".iriograph-authoring-preview").exists());
    expect(wrapper.emitted("pendingDraftsChanged")?.at(-1)).toEqual([true]);
    await buttonWithText(wrapper, "キャンセル").trigger("click");
    expect(wrapper.emitted("pendingDraftsChanged")?.at(-1)).toEqual([false]);

    await buttonWithText(wrapper, "Turtle").trigger("click");
    await wrapper.get<HTMLTextAreaElement>('textarea[aria-label="Turtle source"]')
      .setValue(`${fixture.semantic.source}\n# draft`);
    expect(wrapper.emitted("pendingDraftsChanged")?.at(-1)).toEqual([true]);
    await buttonWithText(wrapper, "元に戻す").trigger("click");
    expect(wrapper.emitted("pendingDraftsChanged")?.at(-1)).toEqual([false]);
  });

  it("右クリックは別menuを出さず右Inspectorのビューtabを直接開く", async () => {
    const fixture = documentFixture();
    wrapper = await mountEditor({ authoringContext: testAuthoringContext(fixture) });
    const canvas = wrapper.getComponent(DiagramCanvas);
    const node = canvas.props("scene").nodes.find((item) => item.semanticRef === `${NS}a`)!;
    exposedSelectionApi(wrapper).selectElement(node.elementId);
    await nextTick();

    emitCanvas(canvas, "contextMenuRequest", {
      kind: "node",
      elementId: node.elementId,
      clientX: 120,
      clientY: 80,
    });
    await nextTick();
    expect(wrapper.find('[role="menu"]').exists()).toBe(false);
    expect(wrapper.find(".iriograph-display-inspector").isVisible()).toBe(true);
    expect(wrapper.find(".iriograph-appearance-editor").exists()).toBe(false);
    expect(wrapper.find(".iriograph-authoring-preview").exists()).toBe(false);
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
  });

  it("direct edgeをCanvas選択して関係変更へ進みlabel文型で表示する", async () => {
    const fixture = documentFixture();
    wrapper = await mountEditor({ authoringContext: testAuthoringContext(fixture) });
    const edge = wrapper.getComponent(DiagramCanvas).props("scene").edges[0]!;
    exposedSelectionApi(wrapper).selectElement(edge.elementId);
    await nextTick();
    await buttonWithText(wrapper, "関係を変更する").trigger("click");
    const panel = wrapper.get(".iriograph-intent-fields");
    expect(panel.text()).toContain("A");
    expect(panel.text()).toContain("B");
    expect(panel.text()).toContain("A（Rel）B");
    expect(panel.text()).not.toContain(edge.sourceElementId);
    expect(panel.text()).not.toContain(`${NS}rel`);
  });

  it("要素の名前・説明・種類変更を一つのPreview batchへまとめる", async () => {
    const fixture = documentFixture();
    wrapper = await mountEditor({ authoringContext: testAuthoringContext(fixture) });
    const node = wrapper.getComponent(DiagramCanvas).props("scene").nodes
      .find((item) => item.semanticRef === `${NS}a`)!;
    exposedSelectionApi(wrapper).selectElement(node.elementId);
    await nextTick();
    await buttonWithText(wrapper, "要素を変更する").trigger("click");
    const labelInput = wrapper.get<HTMLTextAreaElement>('textarea[aria-label="要素の名前"]');
    await labelInput.setValue("A renamed");
    await buttonWithText(wrapper, "説明を追加").trigger("click");
    await wrapper.get<HTMLTextAreaElement>('textarea[aria-label="要素の説明 1"]').setValue("説明");
    await wrapper.get<HTMLInputElement>('fieldset input[type="checkbox"]').setValue(true);
    await buttonWithText(wrapper, "変更内容を確認").trigger("click");
    await waitUntil(() => wrapper!.find(".iriograph-authoring-preview").exists());

    expect(wrapper.text()).toContain("Aを編集");
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
  });

  it("appearanceはmulti-selectionへlive previewしApply時だけ一つのoverlay historyにする", async () => {
    wrapper = await mountEditor();
    const canvas = wrapper.getComponent(DiagramCanvas);
    const nodes = canvas.props("scene").nodes;
    exposedSelectionApi(wrapper).selectElements(nodes.map((node) => node.elementId));
    await nextTick();
    await openAppearanceInspector(wrapper);
    await buttonWithText(wrapper, "ビューを編集").trigger("click");
    const editor = wrapper.get(".iriograph-inspector .iriograph-appearance-editor.inline");
    expect(wrapper.find(".iriograph-appearance-popover").exists()).toBe(false);
    await editor.findAll<HTMLInputElement>('input[type="checkbox"]')[0]!.setValue(true);
    await editor.get<HTMLInputElement>('input[aria-label="fill color"]').setValue("#ff0000");
    await nextTick();

    expect(wrapper.getComponent(DiagramCanvas).props("scene").nodes
      .every((node) => node.style.fill === "#ff0000")).toBe(true);
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
    await editor.get("button.primary").trigger("click");
    await settle();
    const applied = latestDocument(wrapper);
    expect(nodes.map((node) => overlayFor(applied, node.semanticRef)?.appearance?.style?.fill))
      .toEqual(["#ff0000", "#ff0000"]);
    expect(wrapper.emitted("update:modelValue")).toHaveLength(1);

    exposedHistoryApi(wrapper).undo();
    await settle();
    expect(nodes.map((node) => overlayFor(latestDocument(wrapper!), node.semanticRef)))
      .toEqual([undefined, undefined]);
  });

  it("Canvas grid toggleはsession表示だけを変え、edge注記はsparse overlayへround-tripする", async () => {
    wrapper = await mountEditor();
    const initial = documentFixture().semantic.source;
    expect(wrapper.find(".iriograph-canvas-grid").exists()).toBe(true);
    await openAppearanceInspector(wrapper);
    await wrapper.get(".iriograph-grid-visibility button").trigger("click");
    expect(wrapper.find(".iriograph-canvas-grid").exists()).toBe(false);
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();

    const edge = wrapper.getComponent(DiagramCanvas).props("scene").edges[0]!;
    exposedSelectionApi(wrapper).selectElement(edge.elementId);
    await nextTick();
    const caption = wrapper.get<HTMLTextAreaElement>('textarea[aria-label="選択した関係のビュー上の補足"]');
    await caption.setValue("監査向け\n補足");
    await settle();
    const annotated = latestDocument(wrapper);
    expect(annotated.semantic.source).toBe(initial);
    expect(overlayFor(annotated, edge.semanticRef)?.appearance?.edgeCaption).toBe("監査向け\n補足");
    expect(wrapper.getComponent(DiagramCanvas).props("scene").edges[0]?.caption).toBe("監査向け\n補足");
    expect(wrapper.findAll(".iriograph-edge-caption").map((item) => item.text())).toEqual(["監査向け", "補足"]);

    await caption.setValue("");
    await settle();
    expect(overlayFor(latestDocument(wrapper), edge.semanticRef)).toBeUndefined();
  });

  it("関係変更の端子dropと明示Canvas pickerはdraftだけをseedしEscape/readOnlyで解除する", async () => {
    const fixture = documentFixture();
    wrapper = await mountEditor({ authoringContext: testAuthoringContext(fixture) });
    const canvas = wrapper.getComponent(DiagramCanvas);
    const edge = canvas.props("scene").edges[0]!;
    exposedSelectionApi(wrapper).selectElement(edge.elementId);
    await nextTick();
    await buttonWithText(wrapper, "関係を変更する").trigger("click");
    expect(canvas.props("semanticEndpointReconnect")).toBe(true);
    const targetNode = canvas.props("scene").nodes.find((node) => node.semanticRef === `${NS}b`)!;
    emitCanvas(canvas, "semanticEndpointReconnectRequest", {
      edgeElementId: edge.elementId,
      endpoint: "source",
      targetSemanticRef: targetNode.semanticRef,
    });
    await nextTick();
    expect(wrapper.get(".iriograph-intent-selection").text()).toContain("始点B");
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();

    const targetPicker = buttonWithText(wrapper, "終点をCanvasから選択");
    await targetPicker.trigger("click");
    expect(canvas.props("semanticResourcePicking")).toBe(true);

    emitCanvas(canvas, "semanticResourceRequest", targetNode.semanticRef);
    await nextTick();
    expect(canvas.props("semanticResourcePicking")).toBe(false);
    expect(wrapper.get(".iriograph-intent-selection").text()).toContain("B");
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();

    await targetPicker.trigger("click");
    emitCanvas(canvas, "semanticPickCancel");
    await nextTick();
    expect(canvas.props("semanticResourcePicking")).toBe(false);
    await wrapper.setProps({ readOnly: true });
    expect(targetPicker.attributes("disabled")).toBeDefined();
  });

  it("関係固有の説明はビュー補足でなく標準RDF reificationとしてTurtleへ保存する", async () => {
    const fixture = documentFixture();
    wrapper = await mountEditor({ authoringContext: testAuthoringContext(fixture) });
    const canvas = wrapper.getComponent(DiagramCanvas);
    const edge = canvas.props("scene").edges[0]!;
    exposedSelectionApi(wrapper).selectElement(edge.elementId);
    await nextTick();
    await buttonWithText(wrapper, "関係を変更する").trigger("click");
    await buttonWithText(wrapper, "説明を追加").trigger("click");
    await wrapper.get<HTMLTextAreaElement>('textarea[aria-label="この関係だけの説明 1"]')
      .setValue("承認後に\n通知する");
    await buttonWithText(wrapper, "変更内容を確認").trigger("click");
    await waitUntil(() => wrapper!.text().includes("適用可能"));
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
    await wrapper.get<HTMLButtonElement>(".iriograph-authoring-preview .primary").trigger("click");
    await settle();

    const applied = latestDocument(wrapper);
    expect(applied.semantic.source).toContain("rdf:Statement");
    expect(applied.semantic.source).toContain("承認後に\\n通知する");
    expect(applied.semantic.source).toContain("rdf:subject");
    expect(applied.semantic.source).toContain("rdf:predicate");
    expect(applied.semantic.source).toContain("rdf:object");
    expect(overlayFor(applied, edge.semanticRef)?.appearance?.edgeCaption).toBeUndefined();
    expect(wrapper.getComponent(DiagramCanvas).props("scene").edges[0]?.statementComments?.[0]?.value)
      .toBe("承認後に\n通知する");
  });

  it("新規要素作成時はCanvas位置や包含を暗黙seedしない", async () => {
    const fixture = containedDocumentFixture();
    wrapper = await mountEditor({ modelValue: fixture, authoringContext: testAuthoringContext(fixture) }, 1);
    await buttonWithText(wrapper, "新しい要素を作る").trigger("click");
    expect(wrapper.find('button[aria-label*="位置"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain("包含する領域");
    expect(wrapper.getComponent(DiagramCanvas).props("semanticPositionPicking")).toBe(false);
  });

  it("関係作成はCanvasのbaseと複数partnerを一previewへまとめる", async () => {
    const fixture = threeNodeDocumentFixture();
    wrapper = await mountEditor({ modelValue: fixture, authoringContext: testAuthoringContext(fixture) }, 3);
    const nodes = wrapper.getComponent(DiagramCanvas).props("scene").nodes;
    exposedSelectionApi(wrapper).selectElements(nodes.map((node) => node.elementId));
    await nextTick();
    await buttonWithText(wrapper, "関係を作る").trigger("click");
    await wrapper.get<HTMLInputElement>('.iriograph-predicate-cards input[type="radio"]').setValue(true);
    await buttonWithText(wrapper, "変更内容を確認").trigger("click");
    await waitUntil(() => wrapper!.find(".iriograph-authoring-preview").exists());
    expect(wrapper.text()).toContain("追加 2件");
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
  });

  it("見た目だけ領域内のresourceをCanvas警告し所属変更intentから明示追加する", async () => {
    const fixture = visualContainmentMismatchFixture();
    wrapper = await mountEditor({
      modelValue: fixture,
      authoringContext: testAuthoringContext(fixture),
    }, 2);
    const canvas = wrapper.getComponent(DiagramCanvas);
    const resource = canvas.props("scene").nodes.find((node) => node.semanticRef === `${NS}b`)!;
    exposedSelectionApi(wrapper).selectElement(resource.elementId);
    await nextTick();

    expect(wrapper.get(`[data-element-id="${resource.elementId}"]`).classes())
      .toContain("containment-warning");
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();

    await buttonWithText(wrapper, "関係を変更する").trigger("click");
    expect(wrapper.text()).toContain("Lane（未所属）");
    await wrapper.get(".iriograph-intent-fields select").setValue("add");
    await buttonWithText(wrapper, "変更内容を確認").trigger("click");
    await waitUntil(() => wrapper!.find(".iriograph-authoring-preview").exists());
    expect(wrapper.text()).toContain("追加 1件");
  });

  it("Turtle draftと4-intent semantic previewを排他にし未確認previewを保存flushしない", async () => {
    const fixture = documentFixture();
    wrapper = await mountEditor({
      authoringContext: testAuthoringContext(fixture),
      resourceIriAllocator: fixedAllocator(`${NS}created`),
    });
    await openTurtlePanel(wrapper);
    const textarea = wrapper.get<HTMLTextAreaElement>('textarea[aria-label="Turtle source"]');
    await textarea.setValue(`${initialSource}\n:c rdfs:label "C" .\n`);
    expect(wrapper.findAll(".iriograph-intent-grid button").every((button) => button.attributes("disabled") !== undefined)).toBe(true);
    await buttonWithText(wrapper, "元に戻す").trigger("click");

    await buttonWithText(wrapper, "新しい要素を作る").trigger("click");
    await wrapper.get<HTMLTextAreaElement>('textarea[aria-label="新しい要素の名前"]').setValue("Pending");
    await buttonWithText(wrapper, "変更内容を確認").trigger("click");
    await waitUntil(() => wrapper!.find(".iriograph-authoring-preview").exists());
    expect(textarea.element.readOnly).toBe(true);
    expect(await exposedApi(wrapper).flushPendingEdits()).toBe(false);
    expect(wrapper.text()).toContain("Preview/Applyされていないsemantic draft");
    expect(wrapper.emitted("save")).toBeUndefined();
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
  });

  it("Canvas Deleteは意味変更を開始せず4つ目のintentがdirect edgeをexact removeする", async () => {
    const fixture = documentFixture();
    wrapper = await mountEditor({ authoringContext: testAuthoringContext(fixture) });
    const canvas = wrapper.getComponent(DiagramCanvas);
    const edge = canvas.props("scene").edges.find((item) => item.label === "rel")!;

    emitCanvas(canvas, "semanticEditRequest", edge.elementId);
    await nextTick();
    expect(wrapper.find(".iriograph-authoring-preview").exists()).toBe(false);
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();

    exposedSelectionApi(wrapper).selectElement(edge.elementId);
    await nextTick();
    await buttonWithText(wrapper, "関係を変更する").trigger("click");
    await buttonWithText(wrapper, "この関係を削除").trigger("click");
    await waitUntil(() => wrapper!.find(".iriograph-authoring-preview").exists());
    expect(wrapper.text()).toContain("削除 1件");
    expect(wrapper.text()).toContain("適用可能");
    expect(wrapper.getComponent(DiagramCanvas).props("deletionPreviewStatementRefs"))
      .toContain(edge.provenance?.sourceStatementRefs[0]);
    expect(wrapper.get(`[data-element-id="${edge.elementId}"]`).classes()).toContain("deletion-preview");
    await wrapper.get<HTMLButtonElement>(".iriograph-authoring-preview .primary").trigger("click");
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
    await buttonWithText(wrapper, "新しい要素を作る").trigger("click");
    await wrapper.get<HTMLTextAreaElement>('textarea[aria-label="新しい要素の名前"]').setValue("Stale");
    await buttonWithText(wrapper, "変更内容を確認").trigger("click");
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
    await buttonWithText(wrapper, "新しい要素を作る").trigger("click");
    await wrapper.get<HTMLTextAreaElement>('textarea[aria-label="新しい要素の名前"]').setValue("Cancelled");
    await buttonWithText(wrapper, "変更内容を確認").trigger("click");
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
    await buttonWithText(wrapper, "新しい要素を作る").trigger("click");
    await wrapper.get<HTMLTextAreaElement>('textarea[aria-label="新しい要素の名前"]').setValue("Late");
    await buttonWithText(wrapper, "変更内容を確認").trigger("click");
    await waitUntil(() => Boolean(request));
    const cancel = wrapper.get<HTMLButtonElement>('button[aria-label="4つの操作へ戻る"]');
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
    expect(wrapper.find('textarea[aria-label="新しい要素の名前"]').exists()).toBe(false);
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
    await buttonWithText(wrapper, "新しい要素を作る").trigger("click");
    await wrapper.get<HTMLTextAreaElement>('textarea[aria-label="新しい要素の名前"]').setValue("Delayed");
    await buttonWithText(wrapper, "変更内容を確認").trigger("click");
    await waitUntil(() => wrapper!.text().includes("適用可能"));
    delayed.arm();
    await wrapper.get<HTMLButtonElement>(".iriograph-authoring-preview .primary").trigger("click");
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

  it("parent provenanceから所属解除をexact configでbatch Previewする", async () => {
    const fixture = containedDocumentFixture();
    wrapper = await mountEditor({
      modelValue: fixture,
      authoringContext: testAuthoringContext(fixture),
    }, 1);
    const canvas = wrapper.getComponent(DiagramCanvas);
    const member = canvas.props("scene").nodes.find((node) => node.semanticRef === `${NS}a`)!;
    exposedSelectionApi(wrapper).selectElement(member.elementId);
    await nextTick();
    await buttonWithText(wrapper, "関係を変更する").trigger("click");
    expect(wrapper.text()).toContain("Lane（全件所属）");
    await wrapper.get(".iriograph-intent-fields select").setValue("remove");
    await buttonWithText(wrapper, "変更内容を確認").trigger("click");
    await waitUntil(() => wrapper!.text().includes("適用可能"));
    expect(wrapper.text()).toContain("削除 1件");
  });

  it("RDFS subclass Seqを選択可能な順序付きgroupとして編集する", async () => {
    const fixture = sequenceDocumentFixture();
    wrapper = await mountEditor({
      modelValue: fixture,
      authoringContext: testAuthoringContext(fixture),
    }, 4);
    const canvas = wrapper.getComponent(DiagramCanvas);
    const sequenceGroup = canvas.props("scene").containers.find((container) => (
      container.groupRole === "sequence"
    ))!;
    expect(canvas.props("scene").edges.some((edge) => (
      edge.provenance?.operator === "ordinal-sequence"
    ))).toBe(false);
    expect((canvas.props("scene").memberships ?? []).filter((membership) => (
      membership.role === "sequence-member"
    )).map((membership) => membership.ordinal)).toEqual([1, 2, 3]);
    exposedSelectionApi(wrapper).selectElement(sequenceGroup.elementId);
    await nextTick();
    await buttonWithText(wrapper, "関係を変更する").trigger("click");
    expect(wrapper.text()).toContain("通常の関係線とは別の構造");
    expect(wrapper.text()).toContain("A");
    expect(wrapper.text()).toContain("B");
    expect(wrapper.find(".iriograph-authoring-preview").exists()).toBe(false);
  });

  it("objectKinds未指定propertyを関係候補に含めliteral-onlyを除外する", async () => {
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
    const nodes = wrapper.getComponent(DiagramCanvas).props("scene").nodes;
    exposedSelectionApi(wrapper).selectElements(nodes.map((node) => node.elementId));
    await nextTick();
    await buttonWithText(wrapper, "関係を作る").trigger("click");
    const predicates = wrapper.get(".iriograph-predicate-cards").text();
    expect(predicates).toContain("Unconstrained");
    expect(predicates).not.toContain("Literal only");
  });

  it("Alt provenanceのderived edgeを理由付きで直接編集不可にする", async () => {
    const fixture = alternativeDocumentFixture();
    wrapper = await mountEditor({
      modelValue: fixture,
      authoringContext: testAuthoringContext(fixture),
    }, 3);
    const canvas = wrapper.getComponent(DiagramCanvas);
    const alternativeEdge = canvas.props("scene").edges.find((edge) => (
      edge.provenance?.editCapability?.command === "set-alternatives"
    ))!;
    exposedSelectionApi(wrapper).selectElement(alternativeEdge.elementId);
    await nextTick();
    await buttonWithText(wrapper, "関係を変更する").trigger("click");
    expect(wrapper.text()).toContain("分岐構造から自動生成");
    expect(wrapper.text()).toContain("元の分岐を編集");
  });

  it("readOnlyでは4 intentの全write入口を無効化する", async () => {
    const fixture = documentFixture();
    wrapper = await mountEditor({
      authoringContext: testAuthoringContext(fixture),
      readOnly: true,
    });
    expect(wrapper.findAll(".iriograph-intent-grid button")).toHaveLength(4);
    expect(wrapper.findAll(".iriograph-intent-grid button").every((button) => button.attributes("disabled") !== undefined)).toBe(true);
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

  it("view dialogへinitial focusを移しEscape後にopenerへ戻す", async () => {
    wrapper = await mountEditor();
    const focusInput = vi.spyOn(HTMLInputElement.prototype, "focus");
    const opener = buttonWithText(wrapper, "追加");
    opener.element.focus();
    await opener.trigger("click");
    await settle();

    const dialog = wrapper.get(".iriograph-view-dialog");
    expect(focusInput).toHaveBeenCalledOnce();
    expect(focusInput.mock.instances[0]).toBe(dialog.get('input[required]').element);
    await dialog.trigger("keydown", { key: "Escape" });
    await nextTick();

    expect(wrapper.find(".iriograph-view-dialog").exists()).toBe(false);
    expect(document.activeElement).toBe(opener.element);
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

async function openAppearanceInspector(wrapper: VueWrapper): Promise<void> {
  const button = wrapper.findAll("button").find((candidate) => candidate.text() === "ビュー");
  if (!button) throw new Error("ビューInspector tab was not found");
  await button.trigger("click");
  await nextTick();
}

function emitCanvas(
  canvas: unknown,
  event: string,
  ...payload: unknown[]
): void {
  const instance = (canvas as { vm: { $emit: (event: string, ...payload: unknown[]) => void } }).vm;
  instance.$emit(event, ...payload);
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

function regionDocumentFixture(): IriographDocumentV1 {
  const document = containedDocumentFixture();
  document.documentId = "editor-region-appearance";
  document.views[0]!.kind = "region";
  document.views[0]!.overlay = {
    lane: {
      semanticRef: `${NS}lane`,
      geometry: { x: 40, y: 40, width: 420, height: 240 },
      pinned: true,
      placement: "user",
    },
  };
  return document;
}

function visualContainmentMismatchFixture(): IriographDocumentV1 {
  const document = containedDocumentFixture();
  document.documentId = "editor-visual-containment-mismatch";
  document.semantic.source += `\n:b rdfs:label "B" .\n`;
  document.views[0]!.overlay = {
    lane: {
      semanticRef: `${NS}lane`,
      geometry: { x: 40, y: 40, width: 420, height: 240 },
      pinned: true,
      placement: "user",
    },
    a: {
      semanticRef: `${NS}a`,
      geometry: { x: 120, y: 120, width: 120, height: 60 },
      pinned: true,
      placement: "user",
    },
    b: {
      semanticRef: `${NS}b`,
      geometry: { x: 280, y: 120, width: 120, height: 60 },
      pinned: true,
      placement: "user",
    },
  };
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
