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
  validateIriographDocumentV1,
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

  it("Documentタブでactive view overlayだけをschema検証して適用しTurtle不変・undoを保つ", async () => {
    wrapper = await mountEditor();
    const original = documentFixture();
    const node = (wrapper.getComponent(DiagramCanvas).props("scene") as DiagramScene).nodes
      .find((candidate) => candidate.semanticRef === `${NS}a`)!;

    await buttonWithText(wrapper, "Document").trigger("click");
    const editor = wrapper.get<HTMLTextAreaElement>('textarea[aria-label="View overlay JSON"]');
    await editor.setValue(JSON.stringify({
      [node.elementId]: {
        semanticRef: node.semanticRef,
        geometry: { x: 64, y: 72, width: 160, height: 80 },
        pinned: true,
        placement: "user",
      },
    }));
    await buttonWithText(wrapper, "検証して適用").trigger("click");
    await settle();

    const applied = latestDocument(wrapper);
    expect(applied.semantic.source).toBe(original.semantic.source);
    expect(applied.views[0]!.overlay[node.elementId]).toMatchObject({
      semanticRef: node.semanticRef,
      geometry: { x: 64, y: 72, width: 160, height: 80 },
      placement: "user",
    });

    exposedHistoryApi(wrapper).undo();
    await settle();
    expect(latestDocument(wrapper).semantic.source).toBe(original.semantic.source);
    expect(latestDocument(wrapper).views[0]!.overlay).toEqual({});
  });

  it("Document overlay editorはJSON/schema errorを修正行動付きで表示し正本へ反映しない", async () => {
    wrapper = await mountEditor();
    await buttonWithText(wrapper, "Document").trigger("click");
    const editor = wrapper.get<HTMLTextAreaElement>('textarea[aria-label="View overlay JSON"]');
    await editor.setValue('{"node":{"semanticRef":"urn:test:a","unknown":true}}');
    await buttonWithText(wrapper, "検証して適用").trigger("click");
    await settle();

    const diagnostics = wrapper.get(".iriograph-overlay-diagnostics");
    expect(diagnostics.text()).toContain("unknown");
    expect(diagnostics.text()).toContain("削除するか、extensionsへ移してください");
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();

    await editor.setValue('{');
    await buttonWithText(wrapper, "JSONを整形").trigger("click");
    expect(wrapper.get(".iriograph-overlay-diagnostics").text()).toContain("JSONを解析できません");
  });

  it("Document全体でportable identityと全viewを参照できる", async () => {
    wrapper = await mountEditor();
    await buttonWithText(wrapper, "Document").trigger("click");
    await buttonWithText(wrapper, "Document全体").trigger("click");

    const documentPanel = wrapper.get(".iriograph-document-boundary");
    expect(documentPanel.text()).toContain("editor-regression");
    expect(documentPanel.text()).toContain("urn:test:editor:");
    expect(documentPanel.text()).toContain('"viewId": "main"');
  });

  it("Document overlay editorは領域包含を破るgeometryを適用しない", async () => {
    const original = regionDocumentFixture();
    wrapper = await mountEditor({ modelValue: original }, 1);
    const projected = wrapper.getComponent(DiagramCanvas).props("scene") as DiagramScene;
    const region = projected.regions?.find((candidate) => candidate.semanticRef === `${NS}lane`)!;
    const node = projected.nodes.find((candidate) => candidate.semanticRef === `${NS}a`)!;
    await buttonWithText(wrapper, "Document").trigger("click");
    const editor = wrapper.get<HTMLTextAreaElement>('textarea[aria-label="View overlay JSON"]');
    await editor.setValue(JSON.stringify({
      [region.elementId]: {
        semanticRef: region.semanticRef,
        geometry: { x: 40, y: 40, width: 420, height: 240 },
        pinned: true,
        placement: "user",
      },
      [node.elementId]: {
        semanticRef: node.semanticRef,
        geometry: { x: 700, y: 700, width: 120, height: 64 },
        pinned: true,
        placement: "user",
      },
    }));
    await buttonWithText(wrapper, "検証して適用").trigger("click");
    await settle();

    expect(wrapper.get(".iriograph-overlay-diagnostics").text()).toContain("共通部分へ収めてください");
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
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

  it("ビューInspectorから複数manual経路点を番号で個別削除してundoする", async () => {
    wrapper = await mountEditor();
    const canvas = wrapper.getComponent(DiagramCanvas);
    const edge = canvas.props("scene").edges[0]!;
    const turtle = initialSource;
    exposedSelectionApi(wrapper).selectElement(edge.elementId);
    await nextTick();
    await openAppearanceInspector(wrapper);
    await wrapper.get<HTMLSelectElement>('select[aria-label="線の形式"]').setValue("manual");
    await buttonWithText(wrapper, "経路点を追加").trigger("click");
    await settle();
    await buttonWithText(wrapper, "経路点を追加").trigger("click");
    await settle();

    const before = overlayFor(latestDocument(wrapper), edge.semanticRef)?.routing?.waypoints;
    expect(before).toHaveLength(2);
    await wrapper.get('button[aria-label="経路点 1を削除"]').trigger("click");
    await settle();
    expect(overlayFor(latestDocument(wrapper), edge.semanticRef)?.routing?.waypoints)
      .toEqual([before![1]]);
    expect(latestDocument(wrapper).semantic.source).toBe(turtle);

    exposedHistoryApi(wrapper).undo();
    await settle();
    expect(overlayFor(latestDocument(wrapper), edge.semanticRef)?.routing?.waypoints)
      .toEqual(before);
  });

  it("曲線Inspectorは座標表を見せず曲線点の追加・削除・自動復帰をsparse overlayへ保存する", async () => {
    wrapper = await mountEditor();
    const canvas = wrapper.getComponent(DiagramCanvas);
    const edge = canvas.props("scene").edges[0]!;
    const turtle = initialSource;
    exposedSelectionApi(wrapper).selectElement(edge.elementId);
    await nextTick();
    await openAppearanceInspector(wrapper);
    await wrapper.get<HTMLSelectElement>('select[aria-label="線の形式"]').setValue("curve");
    await buttonWithText(wrapper, "曲線点を追加").trigger("click");
    await settle();
    await buttonWithText(wrapper, "曲線点を追加").trigger("click");
    await settle();

    const curved = overlayFor(latestDocument(wrapper), edge.semanticRef)?.routing;
    expect(curved?.routeMode).toBe("curve");
    expect(curved?.curve?.knots).toHaveLength(2);
    expect(wrapper.get(".iriograph-routing-inspector").find('input[type="number"]').exists()).toBe(false);
    expect(latestDocument(wrapper).semantic.source).toBe(turtle);

    await wrapper.get('button[aria-label="曲線点 1を削除"]').trigger("click");
    await settle();
    expect(overlayFor(latestDocument(wrapper), edge.semanticRef)?.routing?.curve?.knots)
      .toEqual([curved!.curve!.knots![1]]);

    await buttonWithText(wrapper, "自動曲線へ戻す").trigger("click");
    await settle();
    expect(overlayFor(latestDocument(wrapper), edge.semanticRef)?.routing).toEqual({
      routeMode: "curve",
    });
    expect(latestDocument(wrapper).semantic.source).toBe(turtle);
  });

  it("Canvas curve gestureを丸めたoverlayへ一履歴で保存しundoする", async () => {
    wrapper = await mountEditor();
    const canvas = wrapper.getComponent(DiagramCanvas);
    const edge = canvas.props("scene").edges[0]!;
    exposedSelectionApi(wrapper).selectElement(edge.elementId);
    await nextTick();
    await openAppearanceInspector(wrapper);
    await wrapper.get<HTMLSelectElement>('select[aria-label="線の形式"]').setValue("curve");
    await settle();
    const extensionIri = "https://example.test/curve-point-meta";

    emitCanvas(canvas, "gestureStart");
    emitCanvas(canvas, "routingUpdate", {
      elementId: edge.elementId,
      routing: {
        curve: {
          sourceHandle: {
            x: 42.4,
            y: 13.7,
            extensions: { [extensionIri]: { source: true } },
          },
          knots: [{
            point: {
              x: 221.6,
              y: 124.3,
              extensions: { [extensionIri]: { point: [1, 2] } },
            },
            incomingHandle: {
              x: -20.2,
              y: 10.7,
              extensions: { [extensionIri]: "incoming" },
            },
            outgoingHandle: {
              x: 20.2,
              y: -10.7,
              extensions: { [extensionIri]: "outgoing" },
            },
          }],
        },
      },
    });
    emitCanvas(canvas, "gestureEnd");
    await settle();

    expect(overlayFor(latestDocument(wrapper), edge.semanticRef)?.routing).toEqual({
      routeMode: "curve",
      curve: {
        sourceHandle: {
          x: 42,
          y: 14,
          extensions: { [extensionIri]: { source: true } },
        },
        knots: [{
          point: {
            x: 222,
            y: 124,
            extensions: { [extensionIri]: { point: [1, 2] } },
          },
          incomingHandle: {
            x: -20,
            y: 11,
            extensions: { [extensionIri]: "incoming" },
          },
          outgoingHandle: {
            x: 20,
            y: -11,
            extensions: { [extensionIri]: "outgoing" },
          },
        }],
      },
    });
    exposedHistoryApi(wrapper).undo();
    await settle();
    expect(overlayFor(latestDocument(wrapper), edge.semanticRef)?.routing).toEqual({ routeMode: "curve" });
  });

  it("curve knot/handleをJSON保存reload後もSceneとCanvasへ復元する", async () => {
    wrapper = await mountEditor();
    let canvas = wrapper.getComponent(DiagramCanvas);
    const edge = canvas.props("scene").edges[0]!;
    exposedSelectionApi(wrapper).selectElement(edge.elementId);
    await nextTick();
    await openAppearanceInspector(wrapper);
    await wrapper.get<HTMLSelectElement>('select[aria-label="線の形式"]').setValue("curve");
    await settle();
    const extensionIri = "https://example.test/reloaded-curve-point";
    emitCanvas(canvas, "gestureStart");
    emitCanvas(canvas, "routingUpdate", {
      elementId: edge.elementId,
      routing: {
        curve: {
          sourceHandle: {
            x: 40,
            y: 20,
            extensions: { [extensionIri]: { preserved: true } },
          },
          targetHandle: { x: -35, y: 18 },
          knots: [{
            point: {
              x: 230,
              y: 118,
              extensions: { [extensionIri]: ["saved", "reloaded"] },
            },
          }],
        },
      },
    });
    emitCanvas(canvas, "gestureEnd");
    await settle();
    const saved = JSON.parse(JSON.stringify(latestDocument(wrapper))) as IriographDocument;

    wrapper.unmount();
    document.body.innerHTML = "";
    wrapper = await mountEditor({ modelValue: saved });
    canvas = wrapper.getComponent(DiagramCanvas);
    const reloaded = canvas.props("scene").edges.find((candidate) => candidate.semanticRef === edge.semanticRef)!;
    expect(reloaded.routeMode).toBe("curve");
    expect(reloaded.curve).toEqual({
      sourceHandle: {
        x: 40,
        y: 20,
        extensions: { [extensionIri]: { preserved: true } },
      },
      targetHandle: { x: -35, y: 18 },
      knots: [{
        point: {
          x: 230,
          y: 118,
          extensions: { [extensionIri]: ["saved", "reloaded"] },
        },
      }],
    });
    exposedSelectionApi(wrapper).selectElement(reloaded.elementId);
    await nextTick();
    expect(wrapper.get(".iriograph-edge-path").attributes("d")).toMatch(/^M .* C /u);
    expect(wrapper.findAll(".iriograph-curve-knot")).toHaveLength(1);
    expect(wrapper.findAll(".iriograph-curve-handle")).toHaveLength(4);
    expect(saved.semantic.source).toBe(initialSource);
  });

  it("catalog既定curveへの初回control編集だけschema必須routeModeを明示保存する", async () => {
    const catalog = structuredClone(standardRdfRdfsCatalog);
    catalog.templates[catalog.defaults!.edgeTemplateRef]!.routeMode = "curve";
    wrapper = await mountEditor({ catalog });
    const canvas = wrapper.getComponent(DiagramCanvas);
    const edge = canvas.props("scene").edges[0]!;
    expect(edge.routeMode).toBe("curve");
    expect(documentFixture().views[0]!.overlay).toEqual({});

    emitCanvas(canvas, "gestureStart");
    emitCanvas(canvas, "routingUpdate", {
      elementId: edge.elementId,
      routing: { curve: { sourceHandle: { x: 36, y: 14 } } },
    });
    emitCanvas(canvas, "gestureEnd");
    await settle();

    expect(overlayFor(latestDocument(wrapper), edge.semanticRef)?.routing).toEqual({
      routeMode: "curve",
      curve: { sourceHandle: { x: 36, y: 14 } },
    });
    expect(validateIriographDocumentV1(latestDocument(wrapper)).valid).toBe(true);
  });

  it("線の形式をrouting overlayへ保存し接点編集後も維持してresetする", async () => {
    wrapper = await mountEditor();
    const canvas = wrapper.getComponent(DiagramCanvas);
    const edge = canvas.props("scene").edges[0]!;
    exposedSelectionApi(wrapper).selectElement(edge.elementId);
    await nextTick();
    await openAppearanceInspector(wrapper);
    await wrapper.get<HTMLSelectElement>('select[aria-label="線の形式"]').setValue("manual");
    await buttonWithText(wrapper, "経路点を追加").trigger("click");
    await settle();
    expect(overlayFor(latestDocument(wrapper), edge.semanticRef)?.routing?.waypoints?.length)
      .toBeGreaterThan(0);
    const routeBeforeCurve = (canvas.props("scene") as DiagramScene).edges[0]?.route?.map((point) => ({ ...point }));
    await wrapper.get<HTMLSelectElement>('select[aria-label="線の形式"]').setValue("curve");
    await settle();
    expect(overlayFor(latestDocument(wrapper), edge.semanticRef)?.routing?.routeMode).toBe("curve");
    expect(overlayFor(latestDocument(wrapper), edge.semanticRef)?.routing?.waypoints).toBeUndefined();
    expect(wrapper.findAll("button").some((button) => button.text() === "経路点を追加")).toBe(false);
    expect((canvas.props("scene") as DiagramScene).edges[0]?.route).toEqual(routeBeforeCurve);

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

    await wrapper.get<HTMLSelectElement>('select[aria-label="線の形式"]').setValue("auto");
    await settle();
    expect(overlayFor(latestDocument(wrapper), edge.semanticRef)?.routing?.routeMode).toBe("auto");
    expect((canvas.props("scene") as DiagramScene).edges[0]?.route).toEqual(routeBeforeCurve);
    await buttonWithTitle(wrapper, "Undo (Ctrl/Cmd+Z)").trigger("click");
    await settle();
    expect(overlayFor(latestDocument(wrapper), edge.semanticRef)?.routing?.routeMode).toBe("curve");

    await buttonWithText(wrapper, "線の調整をすべてリセット").trigger("click");
    await settle();
    expect(overlayFor(latestDocument(wrapper), edge.semanticRef)).toBeUndefined();
  });

  it("node内label/iconのCanvas調整をsparse appearanceへ一gestureで保存しreset/undoする", async () => {
    wrapper = await mountEditor();
    const canvas = wrapper.getComponent(DiagramCanvas);
    const node = (canvas.props("scene") as DiagramScene).nodes.find((candidate) => candidate.semanticRef === `${NS}a`)!;
    exposedSelectionApi(wrapper).selectElement(node.elementId);
    await nextTick();
    await openAppearanceInspector(wrapper);
    expect(canvas.props("nodeContentEditing")).toBe(true);
    const turtle = initialSource;

    emitCanvas(canvas, "gestureStart");
    emitCanvas(canvas, "nodeContentOffsetUpdate", {
      elementId: node.elementId,
      target: "label",
      offset: { x: 18.4, y: -7.6 },
    });
    emitCanvas(canvas, "nodeContentOffsetUpdate", {
      elementId: node.elementId,
      target: "icon",
      offset: { x: -11.2, y: 9.1 },
    });
    emitCanvas(canvas, "gestureEnd");
    await settle();

    expect(overlayFor(latestDocument(wrapper), node.semanticRef)?.appearance).toMatchObject({
      nodeLabelOffset: { x: 18, y: -8 },
      nodeIconOffset: { x: -11, y: 9 },
    });
    expect(latestDocument(wrapper).semantic.source).toBe(turtle);
    expect((canvas.props("scene") as DiagramScene).nodes.find((candidate) => candidate.elementId === node.elementId))
      .toMatchObject({ nodeLabelOffset: { x: 18, y: -8 }, nodeIconOffset: { x: -11, y: 9 } });

    await buttonWithText(wrapper, "ラベル位置を戻す").trigger("click");
    await settle();
    expect(overlayFor(latestDocument(wrapper), node.semanticRef)?.appearance).toEqual({
      nodeIconOffset: { x: -11, y: 9 },
    });
    await buttonWithTitle(wrapper, "Undo (Ctrl/Cmd+Z)").trigger("click");
    await settle();
    expect(overlayFor(latestDocument(wrapper), node.semanticRef)?.appearance?.nodeLabelOffset)
      .toEqual({ x: 18, y: -8 });

    await buttonWithTitle(wrapper, "Undo (Ctrl/Cmd+Z)").trigger("click");
    await settle();
    expect(overlayFor(latestDocument(wrapper), node.semanticRef)).toBeUndefined();
  });

  it("node label文字方向をTurtle非変更のsparse overlayとしてresize・undo/redoと共存させる", async () => {
    wrapper = await mountEditor();
    const canvas = wrapper.getComponent(DiagramCanvas);
    const node = (canvas.props("scene") as DiagramScene).nodes.find((candidate) => candidate.semanticRef === `${NS}a`)!;
    const originalGeometry = { ...node.geometry };
    const turtle = initialSource;
    exposedSelectionApi(wrapper).selectElement(node.elementId);
    await nextTick();
    await openAppearanceInspector(wrapper);

    await wrapper.get<HTMLSelectElement>('select[aria-label="Node label writing direction"]')
      .setValue("vertical-down");
    await settle();
    expect(overlayFor(latestDocument(wrapper), node.semanticRef)?.appearance)
      .toEqual({ nodeLabelWritingDirection: "vertical-down" });
    expect(latestDocument(wrapper).semantic.source).toBe(turtle);

    emitCanvas(canvas, "gestureStart");
    emitCanvas(canvas, "geometryBatchChange", [{
      elementId: node.elementId,
      geometry: { ...originalGeometry, width: originalGeometry.width + 40 },
    }]);
    emitCanvas(canvas, "gestureEnd");
    await settle();
    expect(overlayFor(latestDocument(wrapper), node.semanticRef)).toMatchObject({
      geometry: { width: originalGeometry.width + 40 },
      appearance: { nodeLabelWritingDirection: "vertical-down" },
    });

    await buttonWithTitle(wrapper, "Undo (Ctrl/Cmd+Z)").trigger("click");
    await settle();
    expect(overlayFor(latestDocument(wrapper), node.semanticRef)?.appearance)
      .toEqual({ nodeLabelWritingDirection: "vertical-down" });
    await buttonWithTitle(wrapper, "Undo (Ctrl/Cmd+Z)").trigger("click");
    await settle();
    expect(overlayFor(latestDocument(wrapper), node.semanticRef)).toBeUndefined();
    await buttonWithTitle(wrapper, "Redo (Ctrl/Cmd+Y)").trigger("click");
    await settle();
    expect(overlayFor(latestDocument(wrapper), node.semanticRef)?.appearance)
      .toEqual({ nodeLabelWritingDirection: "vertical-down" });
    expect(latestDocument(wrapper).semantic.source).toBe(turtle);
  });

  it("templateとpackage/workspace iconを実preview・path候補で選びIRI入力を通常UIへ出さない", async () => {
    const workspaceAssetRef = "urn:test:workspace:icons:approval";
    wrapper = await mountEditor({
      assetOptions: [{
        assetRef: workspaceAssetRef,
        label: "承認フロー画像",
        path: "assets/approval-flow.svg",
        mediaType: "image/svg+xml",
      }],
    });
    const canvas = wrapper.getComponent(DiagramCanvas);
    const node = (canvas.props("scene") as DiagramScene).nodes.find((candidate) => candidate.semanticRef === `${NS}a`)!;
    exposedSelectionApi(wrapper).selectElement(node.elementId);
    await nextTick();
    await openAppearanceInspector(wrapper);

    expect(wrapper.findAll(".iriograph-template-preview").length).toBeGreaterThan(1);
    expect(wrapper.get('.iriograph-template-choices[role="radiogroup"]').text()).not.toContain("urn:");
    const packageButtons = wrapper.findAll(".iriograph-package-icon-choices button");
    expect(packageButtons.length).toBeGreaterThan(5);
    expect(wrapper.findAll(".iriograph-package-icon-choices img").length).toBe(packageButtons.length - 1);
    await packageButtons[1]!.trigger("click");
    await waitUntil(() => Boolean(
      (canvas.props("scene") as DiagramScene).nodes.find((candidate) => candidate.elementId === node.elementId)?.iconUrl,
    ));
    expect(overlayFor(latestDocument(wrapper), node.semanticRef)?.appearance?.iconRef)
      .toMatch(/^urn:iriograph:icon:lucide:/u);
    expect((canvas.props("scene") as DiagramScene).nodes.find((candidate) => candidate.elementId === node.elementId)?.iconUrl)
      .toMatch(/^data:image\/svg\+xml/u);

    let pathInput = wrapper.get<HTMLInputElement>('#' + wrapper.get('input[list]').attributes('id'));
    expect(datalistValuesFor(wrapper, `#${pathInput.attributes("id")}`)).toContain("assets/approval-flow.svg");
    expect(datalistValuesFor(wrapper, `#${pathInput.attributes("id")}`)).not.toContain(workspaceAssetRef);
    pathInput = wrapper.get<HTMLInputElement>(`#${pathInput.attributes("id")}`);
    await pathInput.setValue("assets/approval-flow.svg");
    await settle();
    expect(overlayFor(latestDocument(wrapper), node.semanticRef)?.appearance?.iconRef).toBe(workspaceAssetRef);
    pathInput = wrapper.get<HTMLInputElement>(`#${pathInput.attributes("id")}`);
    await pathInput.setValue("urn:test:manual-input-is-not-accepted");
    await settle();
    expect(pathInput.element.value).toBe("assets/approval-flow.svg");
    expect(overlayFor(latestDocument(wrapper), node.semanticRef)?.appearance?.iconRef).toBe(workspaceAssetRef);
  });

  it("Inspectorからderived routeをmanualへseedしlabel座標を隠してresetする", async () => {
    wrapper = await mountEditor();
    const canvas = wrapper.getComponent(DiagramCanvas);
    const edge = canvas.props("scene").edges[0]!;
    exposedSelectionApi(wrapper).selectElement(edge.elementId);
    await nextTick();
    await openAppearanceInspector(wrapper);

    await wrapper.get<HTMLSelectElement>('select[aria-label="線の形式"]').setValue("manual");
    await buttonWithText(wrapper, "経路点を追加").trigger("click");
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
    expect(wrapper.text()).toContain("検証済み");
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
    expect(wrapper.findAll(".iriograph-diagnostic-actions button").some((button) => button.text() === "ソースで確認"))
      .toBe(false);
    const sceneButton = wrapper.findAll(".iriograph-diagnostic-actions button")
      .find((button) => button.text() === "図で確認")!;
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

  it("右Inspectorは選択概要と追加入口から始まり意味とビューを同時表示しない", async () => {
    wrapper = await mountEditor({ authoringContext: testAuthoringContext(documentFixture()) });
    expect(wrapper.findAll(".iriograph-intent-grid button").map((button) => button.text())).toEqual([
      "＋要素を追加",
      "→関係を追加",
    ]);
    expect(wrapper.find(".iriograph-display-inspector").isVisible()).toBe(false);
    expect(wrapper.find('select[aria-label="Semantic operation"]').exists()).toBe(false);
    await openAppearanceInspector(wrapper);
    expect(wrapper.find(".iriograph-intent-panel").isVisible()).toBe(false);
    expect(wrapper.find(".iriograph-display-inspector").isVisible()).toBe(true);
  });

  it("意味と見た目を切り替えても未Previewの段階入力を失わない", async () => {
    wrapper = await mountEditor({ authoringContext: testAuthoringContext(documentFixture()) });
    await buttonWithText(wrapper, "要素を追加").trigger("click");
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
      {
        iri: "http://www.w3.org/2002/07/owl#sameAs",
        kind: "property",
        label: "同一である",
        category: "同一性",
        sentencePattern: "AはBと同一である",
        objectKinds: ["iri"],
      },
    ];
    wrapper = await mountEditor({ authoringContext: context });
    const nodes = wrapper.getComponent(DiagramCanvas).props("scene").nodes;
    exposedSelectionApi(wrapper).selectElements(nodes.map((node) => node.elementId));
    await nextTick();
    await buttonWithText(wrapper, "関係を追加").trigger("click");
    const cards = wrapper.get(".iriograph-predicate-cards");
    expect(cards.text()).toContain("A（Rel）B");
    expect(cards.text()).toContain("概念・関係の対応");
    expect(cards.text()).toContain("AはBと同一である");
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
    const canvas = wrapper.getComponent(DiagramCanvas);
    const nodes = canvas.props("scene").nodes;
    exposedSelectionApi(wrapper).selectElement(
      nodes.find((node) => node.semanticRef === `${NS}a`)!.elementId,
    );
    await nextTick();
    await buttonWithText(wrapper, "関係を追加").trigger("click");
    emitCanvas(canvas, "semanticResourceRequest", `${NS}b`);
    await nextTick();
    const cards = wrapper.get(".iriograph-predicate-cards").text();
    expect(cards).toContain("適合する");
    expect(cards).not.toContain("不適合");
  });

  it("label一文の新規要素を検証と適用を一回で一つのsemantic historyへ確定する", async () => {
    const fixture = documentFixture();
    wrapper = await mountEditor({
      authoringContext: testAuthoringContext(fixture),
      resourceIriAllocator: fixedAllocator(`${NS}created`),
    });

    await buttonWithText(wrapper, "要素を追加").trigger("click");
    await wrapper.get<HTMLTextAreaElement>('textarea[aria-label="新しい要素の名前"]').setValue("Created task");
    expect(wrapper.find('input[aria-label="Resource class"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain("配置位置");
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();

    await buttonWithText(wrapper, "要素を作成").trigger("click");
    await waitUntil(() => Boolean(wrapper!.emitted("update:modelValue")?.length));
    expect(wrapper.find(".iriograph-authoring-preview").exists()).toBe(false);
    const created = latestDocument(wrapper);
    expect(created.semantic.source).toMatch(/(?:<urn:test:editor:created>|:created)\s/);
    expect(wrapper.emitted("update:modelValue")).toHaveLength(1);
    expect(overlayFor(created, `${NS}created`)).toMatchObject({ pinned: false, placement: "generated" });

    exposedHistoryApi(wrapper).undo();
    await settle();
    expect(latestDocument(wrapper).semantic.source).not.toMatch(/(?:<urn:test:editor:created>|:created)\s/);
    expect(overlayFor(latestDocument(wrapper), `${NS}created`)).toBeUndefined();
  });

  it("Meaning authoringを選択中心の右Inspectorへ置き通常UIにIRIを出さない", async () => {
    const fixture = documentFixture();
    wrapper = await mountEditor({ authoringContext: testAuthoringContext(fixture) });

    const inspector = wrapper.get(".iriograph-inspector");
    expect(inspector.find(".iriograph-intent-grid").exists()).toBe(true);
    expect(inspector.find(".iriograph-authoring-panel").exists()).toBe(false);
    expect(inspector.text()).not.toContain(TASK_CLASS);
    expect(inspector.find('input[placeholder*="urn:"]').exists()).toBe(false);
  });

  it("pendingDraftsChangedで入力中semantic/Turtle draftの現在値をimmediate通知する", async () => {
    const fixture = documentFixture();
    wrapper = await mountEditor({ authoringContext: testAuthoringContext(fixture) });

    expect(wrapper.emitted("pendingDraftsChanged")?.[0]).toEqual([false]);
    await buttonWithText(wrapper, "要素を追加").trigger("click");
    expect(wrapper.emitted("pendingDraftsChanged")?.at(-1)).toEqual([false]);
    await wrapper.get<HTMLTextAreaElement>('textarea[aria-label="新しい要素の名前"]').setValue("未適用");
    expect(wrapper.emitted("pendingDraftsChanged")?.at(-1)).toEqual([true]);
    await wrapper.get('button[aria-label="選択内容へ戻る"]').trigger("click");
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
    await buttonWithText(wrapper, "関係の意味を編集").trigger("click");
    const panel = wrapper.get(".iriograph-intent-fields");
    expect(panel.text()).toContain("A");
    expect(panel.text()).toContain("B");
    expect(panel.text()).toContain("A（Rel）B");
    expect(panel.text()).not.toContain(edge.sourceElementId);
    expect(panel.text()).not.toContain(`${NS}rel`);
  });

  it("nodeの近傍関係一覧から重なったedgeも選択してCanvasへrevealできる", async () => {
    const fixture = documentFixture();
    wrapper = await mountEditor({ authoringContext: testAuthoringContext(fixture) });
    const canvas = wrapper.getComponent(DiagramCanvas);
    const node = canvas.props("scene").nodes.find((item) => item.semanticRef === `${NS}a`)!;
    const edge = canvas.props("scene").edges[0]!;
    exposedSelectionApi(wrapper).selectElement(node.elementId);
    await nextTick();
    await buttonWithText(wrapper, "要素の詳細を編集").trigger("click");
    const overview = wrapper.get('[aria-label="接続している関係"]');
    expect(overview.text()).toContain("A（Rel）B");
    await overview.get("button").trigger("click");
    await nextTick();
    expect(wrapper.getComponent(DiagramCanvas).props("selectedElementIds")).toEqual([edge.elementId]);
  });

  it("要素の名前・説明・種類変更を一つのatomic batchへまとめる", async () => {
    const fixture = documentFixture();
    wrapper = await mountEditor({ authoringContext: testAuthoringContext(fixture) });
    const node = wrapper.getComponent(DiagramCanvas).props("scene").nodes
      .find((item) => item.semanticRef === `${NS}a`)!;
    exposedSelectionApi(wrapper).selectElement(node.elementId);
    await nextTick();
    await buttonWithText(wrapper, "要素の詳細を編集").trigger("click");
    const labelInput = wrapper.get<HTMLTextAreaElement>('textarea[aria-label="要素の名前"]');
    await labelInput.setValue("A renamed");
    await buttonWithText(wrapper, "説明を追加").trigger("click");
    await wrapper.get<HTMLTextAreaElement>('textarea[aria-label="要素の説明 1"]').setValue("説明");
    await wrapper.get<HTMLInputElement>('fieldset input[type="checkbox"]').setValue(true);
    await buttonWithText(wrapper, "変更を保存").trigger("click");
    await waitUntil(() => Boolean(wrapper!.emitted("update:modelValue")?.length));
    const updated = latestDocument(wrapper);
    expect(updated.semantic.source).toContain("A renamed");
    expect(updated.semantic.source).toContain("説明");
    expect(wrapper.emitted("update:modelValue")).toHaveLength(1);
  });

  it("appearanceはmulti-selectionへlive previewしcontrol changeごとに直接確定する", async () => {
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
    await settle();
    expect(wrapper.emitted("update:modelValue")).toHaveLength(1);
    const color = editor.get<HTMLInputElement>('input[aria-label="塗り色"]');
    color.element.value = "#ff0000";
    await color.trigger("input");
    await nextTick();

    expect(wrapper.getComponent(DiagramCanvas).props("scene").nodes
      .every((node) => node.style.fill === "#ff0000")).toBe(true);
    expect(wrapper.emitted("update:modelValue")).toHaveLength(1);
    expect(editor.find("button.primary").exists()).toBe(false);
    expect(editor.text()).not.toContain("キャンセル");
    await color.trigger("change");
    await settle();
    const applied = latestDocument(wrapper);
    expect(nodes.map((node) => overlayFor(applied, node.semanticRef)?.appearance?.style?.fill))
      .toEqual(["#ff0000", "#ff0000"]);
    expect(wrapper.emitted("update:modelValue")).toHaveLength(2);

    await buttonWithText(wrapper, "カタログ既定へ戻す").trigger("click");
    await settle();
    expect(wrapper.emitted("update:modelValue")).toHaveLength(3);
    expect(nodes.map((node) => overlayFor(latestDocument(wrapper!), node.semanticRef)))
      .toEqual([undefined, undefined]);
    await buttonWithText(wrapper, "閉じる").trigger("click");
    expect(wrapper.find(".iriograph-appearance-editor.inline").exists()).toBe(false);
    expect(wrapper.emitted("update:modelValue")).toHaveLength(3);

    exposedHistoryApi(wrapper).undo();
    await settle();
    expect(nodes.map((node) => overlayFor(latestDocument(wrapper!), node.semanticRef)?.appearance?.style?.fill))
      .toEqual(["#ff0000", "#ff0000"]);
    exposedHistoryApi(wrapper).undo();
    await settle();
    expect(nodes.map((node) => overlayFor(latestDocument(wrapper!), node.semanticRef)?.appearance?.style?.fill))
      .not.toEqual(["#ff0000", "#ff0000"]);
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

  it("direct edge端子dropは空接続を作らず有効nodeへの置換をatomic commitする", async () => {
    const fixture = documentFixture();
    wrapper = await mountEditor({ authoringContext: testAuthoringContext(fixture) });
    const canvas = wrapper.getComponent(DiagramCanvas);
    const edge = canvas.props("scene").edges[0]!;
    exposedSelectionApi(wrapper).selectElement(edge.elementId);
    await nextTick();
    expect(canvas.props("semanticEndpointReconnect")).toBe(true);
    const targetNode = canvas.props("scene").nodes.find((node) => node.semanticRef === `${NS}b`)!;
    emitCanvas(canvas, "semanticEndpointReconnectRequest", {
      edgeElementId: edge.elementId,
      endpoint: "source",
      targetSemanticRef: targetNode.semanticRef,
    });
    await waitUntil(() => Boolean(wrapper!.emitted("update:modelValue")?.length));
    const updated = latestDocument(wrapper);
    expect(updated.semantic.source).not.toMatch(/:a\s+:rel\s+:b/);
    expect(updated.semantic.source).toMatch(/:b\s+:rel\s+:b/);
    expect(wrapper.find(".iriograph-authoring-preview").exists()).toBe(false);
    expect(wrapper.emitted("update:modelValue")).toHaveLength(1);
  });

  it("関係固有の説明はビュー補足でなく標準RDF reificationとしてTurtleへ保存する", async () => {
    const fixture = documentFixture();
    wrapper = await mountEditor({ authoringContext: testAuthoringContext(fixture) });
    const canvas = wrapper.getComponent(DiagramCanvas);
    const edge = canvas.props("scene").edges[0]!;
    exposedSelectionApi(wrapper).selectElement(edge.elementId);
    await nextTick();
    await buttonWithText(wrapper, "関係の意味を編集").trigger("click");
    await buttonWithText(wrapper, "説明を追加").trigger("click");
    await wrapper.get<HTMLTextAreaElement>('textarea[aria-label="この関係だけの説明 1"]')
      .setValue("承認後に\n通知する");
    await buttonWithText(wrapper, "関係を更新").trigger("click");
    await waitUntil(() => Boolean(wrapper!.emitted("update:modelValue")?.length));

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
    await buttonWithText(wrapper, "要素を追加").trigger("click");
    expect(wrapper.find('button[aria-label*="位置"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain("包含する領域");
    expect(wrapper.getComponent(DiagramCanvas).props("semanticPositionPicking")).toBe(false);
  });

  it("関係作成は通常クリックで始点から終点へ進み自己関係を暗黙作成せずgeometryを保つ", async () => {
    const fixture = threeNodeDocumentFixture();
    const modes: string[] = [];
    const standard = new StandardLightweightLayoutAdapter(
      STANDARD_LAYOUT_REFS.hierarchicalLr,
      "LR",
    );
    const adapter: LayoutAdapter = {
      layoutRef: STANDARD_LAYOUT_REFS.hierarchicalLr,
      async layout(request) {
        modes.push(request.mode ?? "incremental");
        return standard.layout(request);
      },
    };
    const context = testAuthoringContext(fixture);
    context.runtime = createProjectionRuntimeContext([{
      profileRef: standardRdfRdfsCatalog.profileRef,
      sourceCatalogRefs: [catalogRef(standardRdfRdfsCatalog)],
      catalog: standardRdfRdfsCatalog,
      ruleOrigins: [],
    }], new LayoutAdapterRegistry([adapter]));
    wrapper = await mountEditor({ modelValue: fixture, authoringContext: context }, 3);
    const canvas = wrapper.getComponent(DiagramCanvas);
    const nodes = canvas.props("scene").nodes;
    const source = nodes.find((node) => node.semanticRef === `${NS}a`)!;
    const target = nodes.find((node) => node.semanticRef === `${NS}c`)!;
    const geometryBefore = Object.fromEntries(nodes.map((node) => [node.elementId, {
      geometry: node.geometry,
      pinned: node.pinned,
      placement: node.placement,
    }]));
    exposedSelectionApi(wrapper).selectElement(source.elementId);
    await nextTick();
    modes.length = 0;
    await buttonWithText(wrapper, "関係を追加").trigger("click");
    expect(canvas.props("semanticResourcePicking")).toBe(true);

    emitCanvas(canvas, "semanticResourceRequest", source.semanticRef);
    await nextTick();
    expect(wrapper.text()).toContain("始点とは別の要素");
    expect(wrapper.text()).toContain("終点未選択");
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();

    emitCanvas(canvas, "semanticResourceRequest", target.semanticRef);
    await nextTick();
    expect(canvas.props("semanticResourcePicking")).toBe(false);
    expect(wrapper.text()).toContain("終点C");
    await wrapper.get<HTMLInputElement>('.iriograph-predicate-cards input[type="radio"]').setValue(true);
    await buttonWithText(wrapper, "関係を作成").trigger("click");
    await waitUntil(() => Boolean(wrapper!.emitted("update:modelValue")?.length));
    await settle();
    expect(latestDocument(wrapper).semantic.source.match(/:rel/g)?.length).toBeGreaterThanOrEqual(2);
    expect(wrapper.emitted("update:modelValue")).toHaveLength(1);
    expect(modes).toEqual(["incremental", "route-only"]);
    const geometryAfter = Object.fromEntries(canvas.props("scene").nodes.map((node) => [node.elementId, {
      geometry: node.geometry,
      pinned: node.pinned,
      placement: node.placement,
    }]));
    expect(geometryAfter).toEqual(geometryBefore);
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

    await buttonWithText(wrapper, "所属・並び順を編集").trigger("click");
    expect(wrapper.text()).toContain("Lane（未所属）");
    await wrapper.get(".iriograph-intent-fields select").setValue("add");
    await buttonWithText(wrapper, "所属を更新").trigger("click");
    await waitUntil(() => Boolean(wrapper!.emitted("update:modelValue")?.length));
    expect(latestDocument(wrapper).semantic.source).toContain("rdfs:member");
  });

  it("Turtle draftと入力中semantic formを排他にし未実行の変更を保存flushしない", async () => {
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

    await buttonWithText(wrapper, "要素を追加").trigger("click");
    await wrapper.get<HTMLTextAreaElement>('textarea[aria-label="新しい要素の名前"]').setValue("Pending");
    expect(textarea.element.readOnly).toBe(true);
    expect(await exposedApi(wrapper).flushPendingEdits()).toBe(false);
    expect(wrapper.text()).toContain("意味の変更が入力中");
    expect(wrapper.emitted("save")).toBeUndefined();
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
  });

  it("Canvas Deleteは選択したdirect edgeを確認modalなしでatomic removeする", async () => {
    const fixture = documentFixture();
    wrapper = await mountEditor({ authoringContext: testAuthoringContext(fixture) });
    const canvas = wrapper.getComponent(DiagramCanvas);
    const edge = canvas.props("scene").edges.find((item) => item.label === "rel")!;

    exposedSelectionApi(wrapper).selectElement(edge.elementId);
    await nextTick();
    emitCanvas(canvas, "semanticEditRequest", edge.elementId);
    await waitUntil(() => wrapper!.getComponent(DiagramCanvas).props("scene").edges.length === 0);
    expect(wrapper.find(".iriograph-deletion-dialog").exists()).toBe(false);
    expect(wrapper.emitted("update:modelValue")).toHaveLength(1);
  });

  it("node削除が選択外の関係へ影響するときだけ一覧modalで確認してatomic cascadeする", async () => {
    const fixture = documentFixture();
    wrapper = await mountEditor({ authoringContext: testAuthoringContext(fixture) });
    const canvas = wrapper.getComponent(DiagramCanvas);
    const node = canvas.props("scene").nodes.find((item) => item.semanticRef === `${NS}a`)!;
    const edge = canvas.props("scene").edges[0]!;
    exposedSelectionApi(wrapper).selectElement(node.elementId);
    await nextTick();

    emitCanvas(canvas, "semanticEditRequest", node.elementId);
    await waitUntil(() => wrapper!.find(".iriograph-deletion-dialog").exists());
    const dialog = wrapper.get(".iriograph-deletion-dialog");
    expect(document.activeElement).toBe(buttonWithText(wrapper, "影響も含めて削除").element);
    expect(dialog.get('[aria-label="削除の影響一覧"]').text()).toContain("A（rel）B");
    expect(wrapper.getComponent(DiagramCanvas).props("deletionPreviewStatementRefs"))
      .toContain(edge.provenance?.sourceStatementRefs[0]);
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();

    await buttonWithText(wrapper, "影響も含めて削除").trigger("click");
    await waitUntil(() => wrapper!.getComponent(DiagramCanvas).props("scene").nodes.length === 1);
    expect(wrapper.find(".iriograph-deletion-dialog").exists()).toBe(false);
    expect(wrapper.getComponent(DiagramCanvas).props("scene").edges).toHaveLength(0);
    expect(wrapper.emitted("update:modelValue")).toHaveLength(1);
  });

  it("影響するnodeとedgeをすべて選択したDeleteはmodalなしで直接cascadeする", async () => {
    const fixture = documentFixture();
    wrapper = await mountEditor({ authoringContext: testAuthoringContext(fixture) });
    const canvas = wrapper.getComponent(DiagramCanvas);
    const node = canvas.props("scene").nodes.find((item) => item.semanticRef === `${NS}a`)!;
    const edge = canvas.props("scene").edges[0]!;
    exposedSelectionApi(wrapper).selectElements([node.elementId, edge.elementId]);
    await nextTick();

    emitCanvas(canvas, "semanticEditRequest", node.elementId);
    await waitUntil(() => wrapper!.getComponent(DiagramCanvas).props("scene").nodes.length === 1);
    expect(wrapper.find(".iriograph-deletion-dialog").exists()).toBe(false);
    expect(wrapper.getComponent(DiagramCanvas).props("scene").edges).toHaveLength(0);
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
    await buttonWithText(wrapper, "要素を追加").trigger("click");
    await wrapper.get<HTMLTextAreaElement>('textarea[aria-label="新しい要素の名前"]').setValue("Stale");
    await buttonWithText(wrapper, "要素を作成").trigger("click");
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

  it("readOnly途中切替でasync意味transactionをabortし結果を公開しない", async () => {
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
    await buttonWithText(wrapper, "要素を追加").trigger("click");
    await wrapper.get<HTMLTextAreaElement>('textarea[aria-label="新しい要素の名前"]').setValue("Cancelled");
    await buttonWithText(wrapper, "要素を作成").trigger("click");
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

  it("busy中の戻る操作でasync意味transactionをabortしlate結果を採用しない", async () => {
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
    await buttonWithText(wrapper, "要素を追加").trigger("click");
    await wrapper.get<HTMLTextAreaElement>('textarea[aria-label="新しい要素の名前"]').setValue("Late");
    await buttonWithText(wrapper, "要素を作成").trigger("click");
    await waitUntil(() => Boolean(request));
    const cancel = wrapper.get<HTMLButtonElement>('button[aria-label="選択内容へ戻る"]');
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

  it("readOnly途中切替で単一structured transactionもabortしpublishしない", async () => {
    const fixture = documentFixture();
    const delayed = delayedLayoutRegistry();
    const context = testAuthoringContext(fixture);
    context.runtime = { ...context.runtime, layouts: delayed.registry };
    wrapper = await mountEditor({
      authoringContext: context,
      resourceIriAllocator: fixedAllocator(`${NS}delayed-created`),
    });
    await buttonWithText(wrapper, "要素を追加").trigger("click");
    await wrapper.get<HTMLTextAreaElement>('textarea[aria-label="新しい要素の名前"]').setValue("Delayed");
    delayed.arm();
    await buttonWithText(wrapper, "要素を作成").trigger("click");
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

  it("parent provenanceから所属解除をexact configでbatch transactionする", async () => {
    const fixture = containedDocumentFixture();
    wrapper = await mountEditor({
      modelValue: fixture,
      authoringContext: testAuthoringContext(fixture),
    }, 1);
    const canvas = wrapper.getComponent(DiagramCanvas);
    const member = canvas.props("scene").nodes.find((node) => node.semanticRef === `${NS}a`)!;
    exposedSelectionApi(wrapper).selectElement(member.elementId);
    await nextTick();
    await buttonWithText(wrapper, "所属・並び順を編集").trigger("click");
    expect(wrapper.text()).toContain("Lane（全件所属）");
    await wrapper.get(".iriograph-intent-fields select").setValue("remove");
    await buttonWithText(wrapper, "所属を更新").trigger("click");
    await waitUntil(() => Boolean(wrapper!.emitted("update:modelValue")?.length));
    expect(latestDocument(wrapper).semantic.source).not.toContain("rdfs:member :a");
  });

  it("包含領域の要素一覧からmembershipだけを直接解除する", async () => {
    const fixture = containedDocumentFixture();
    wrapper = await mountEditor({
      modelValue: fixture,
      authoringContext: testAuthoringContext(fixture),
    }, 1);
    const canvas = wrapper.getComponent(DiagramCanvas);
    const lane = canvas.props("scene").containers.find((container) => (
      container.semanticRef === `${NS}lane`
    ))!;
    exposedSelectionApi(wrapper).selectElement(lane.elementId);
    await nextTick();

    const overview = wrapper.get('[aria-label="選択要素の包含一覧"]');
    expect(overview.text()).toContain("含む要素 1件");
    await buttonWithText(wrapper, "包含から外す").trigger("click");
    await waitUntil(() => Boolean(wrapper!.emitted("update:modelValue")?.length));

    expect(latestDocument(wrapper).semantic.source).not.toContain("rdfs:member :a");
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
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
    await buttonWithText(wrapper, "所属・並び順を編集").trigger("click");
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
    await buttonWithText(wrapper, "関係を追加").trigger("click");
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
    await buttonWithText(wrapper, "関係の意味を編集").trigger("click");
    expect(wrapper.text()).toContain("分岐構造から自動生成");
    expect(wrapper.text()).toContain("元の分岐を編集");
  });

  it("readOnlyでは意味追加の全write入口を無効化する", async () => {
    const fixture = documentFixture();
    wrapper = await mountEditor({
      authoringContext: testAuthoringContext(fixture),
      readOnly: true,
    });
    expect(wrapper.findAll(".iriograph-intent-grid button")).toHaveLength(2);
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

  it("選択resourceのexact membership一覧から関連要素をfocusして表示する", async () => {
    const fixture = containedDocumentFixture();
    wrapper = await mountEditor({ modelValue: fixture }, 1);
    const canvas = wrapper.getComponent(DiagramCanvas);
    const member = canvas.props("scene").nodes.find((node) => node.semanticRef === `${NS}a`)!;
    const lane = canvas.props("scene").containers.find((container) => container.semanticRef === `${NS}lane`)!;

    exposedSelectionApi(wrapper).selectElement(member.elementId);
    await nextTick();
    const overview = wrapper.get('[aria-label="選択要素の包含一覧"]');
    expect(overview.get('[aria-label="属する領域"]').text()).toContain("Lane");
    expect(overview.get('[aria-label="含む要素"]').text()).toContain("含む要素はありません");
    await overview.get("button").trigger("click");
    await settle();

    expect(wrapper.getComponent(DiagramCanvas).props("selectedElementId")).toBe(lane.elementId);
    expect(wrapper.get('[aria-label="選択要素の包含一覧"]').text()).toContain("A");
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

  it("view方向を日本語selectで切替えundo/redo・reloadしてもview別に保つ", async () => {
    const fixture = multiViewDocumentFixture();
    fixture.views[0]!.overlay = {
      selected: {
        semanticRef: `${NS}a`,
        geometry: { x: 120, y: 96, width: 140, height: 64 },
        pinned: true,
        placement: "user",
        appearance: { styleToken: "accent" },
      },
    };
    const turtle = fixture.semantic.source;
    const userOverlay = structuredClone(fixture.views[0]!.overlay.selected);
    const reviewJson = JSON.stringify(fixture.views[1]);
    wrapper = await mountEditor({ modelValue: fixture });

    await buttonWithText(wrapper, "設定").trigger("click");
    const direction = wrapper.get<HTMLSelectElement>('select[aria-label="配置方向"]');
    expect(direction.element.value).toBe("LR");
    expect(direction.findAll("option").map((option) => option.text())).toEqual([
      "横方向（左→右）",
      "縦方向（上→下）",
    ]);
    expect(wrapper.find('.iriograph-view-dialog input[list="iriograph-layout-options"]').exists()).toBe(false);
    await direction.setValue("TB");
    await wrapper.get<HTMLButtonElement>('.iriograph-view-dialog button[type="submit"]').trigger("click");
    await waitUntil(() => latestDocument(wrapper!).views[0]!.layoutRef === STANDARD_LAYOUT_REFS.hierarchicalTb);

    const vertical = latestDocument(wrapper);
    expect(vertical.semantic.source).toBe(turtle);
    expect(vertical.views[0]!.overlay.selected).toEqual(userOverlay);
    expect(JSON.stringify(vertical.views[1])).toBe(reviewJson);

    exposedHistoryApi(wrapper).undo();
    await waitUntil(() => latestDocument(wrapper!).views[0]!.layoutRef === STANDARD_LAYOUT_REFS.hierarchicalLr);
    exposedHistoryApi(wrapper).redo();
    await waitUntil(() => latestDocument(wrapper!).views[0]!.layoutRef === STANDARD_LAYOUT_REFS.hierarchicalTb);
    const reloaded = structuredClone(latestDocument(wrapper));

    wrapper.unmount();
    wrapper = await mountEditor({ modelValue: reloaded });
    const reloadedScene = wrapper.getComponent(DiagramCanvas).props("scene");
    const a = reloadedScene.nodes.find((node) => node.semanticRef === `${NS}a`)!;
    const b = reloadedScene.nodes.find((node) => node.semanticRef === `${NS}b`)!;
    expect(a).toMatchObject({ geometry: userOverlay!.geometry, pinned: true, placement: "user" });
    expect(b.geometry.y).toBeGreaterThan(a.geometry.y);
  });

  it("新規viewはStandard横方向を既定にし未知layoutは技術情報のままfail-closedにする", async () => {
    wrapper = await mountEditor();
    await buttonWithText(wrapper, "追加").trigger("click");
    expect(wrapper.get<HTMLSelectElement>('select[aria-label="配置方向"]').element.value).toBe("LR");
    await wrapper.get<HTMLButtonElement>('.iriograph-view-dialog button[type="submit"]').trigger("click");
    await waitUntil(() => latestDocument(wrapper!).views.length === 2);
    expect(latestDocument(wrapper).views[1]!.layoutRef).toBe(STANDARD_LAYOUT_REFS.hierarchicalLr);
    wrapper.unmount();

    const unknownLayoutRef = "urn:test:layout:private";
    const unknownFixture = documentFixture();
    unknownFixture.views[0]!.layoutRef = unknownLayoutRef;
    const runtime = createProjectionRuntimeContext([{
      profileRef: standardRdfRdfsCatalog.profileRef,
      sourceCatalogRefs: [catalogRef(standardRdfRdfsCatalog)],
      catalog: standardRdfRdfsCatalog,
      ruleOrigins: [],
    }], new LayoutAdapterRegistry([
      new StandardLightweightLayoutAdapter(unknownLayoutRef, "LR"),
    ]));
    wrapper = await mountEditor({
      modelValue: unknownFixture,
      runtimeContext: runtime,
      catalog: undefined,
    });
    await buttonWithText(wrapper, "設定").trigger("click");
    const unknownDirection = wrapper.get<HTMLSelectElement>('select[aria-label="配置方向"]');
    expect(unknownDirection.attributes("disabled")).toBeDefined();
    expect(wrapper.get(".iriograph-view-dialog").text()).toContain("方向変更に対応していません");
    expect(wrapper.get(".iriograph-view-dialog").text()).toContain(unknownLayoutRef);
    await wrapper.get<HTMLInputElement>('.iriograph-view-dialog input[placeholder="ja"]').setValue("en-US");
    await wrapper.get<HTMLButtonElement>('.iriograph-view-dialog button[type="submit"]').trigger("click");
    await waitUntil(() => latestDocument(wrapper!).views[0]!.locale === "en-US");
    expect(latestDocument(wrapper).views[0]!.layoutRef).toBe(unknownLayoutRef);
  });

  it("ELK viewの方向切替はELK adapter family内に留める", async () => {
    const elkLr = "urn:iriograph:layout:elk-layered-lr:1";
    const elkTb = "urn:iriograph:layout:elk-layered-tb:1";
    const fixture = documentFixture();
    fixture.views[0]!.layoutRef = elkLr;
    const runtime = createProjectionRuntimeContext([{
      profileRef: standardRdfRdfsCatalog.profileRef,
      sourceCatalogRefs: [catalogRef(standardRdfRdfsCatalog)],
      catalog: standardRdfRdfsCatalog,
      ruleOrigins: [],
    }], new LayoutAdapterRegistry([
      new StandardLightweightLayoutAdapter(elkLr, "LR"),
      new StandardLightweightLayoutAdapter(elkTb, "TB"),
    ]));
    wrapper = await mountEditor({
      modelValue: fixture,
      runtimeContext: runtime,
      catalog: undefined,
    });

    await buttonWithText(wrapper, "設定").trigger("click");
    const direction = wrapper.get<HTMLSelectElement>('select[aria-label="配置方向"]');
    expect(direction.element.value).toBe("LR");
    await direction.setValue("TB");
    await wrapper.get<HTMLButtonElement>('.iriograph-view-dialog button[type="submit"]').trigger("click");
    await waitUntil(() => latestDocument(wrapper!).views[0]!.layoutRef === elkTb);

    expect(latestDocument(wrapper).views[0]!.layoutRef).toBe(elkTb);
    const scene = wrapper.getComponent(DiagramCanvas).props("scene");
    const a = scene.nodes.find((node) => node.semanticRef === `${NS}a`)!;
    const b = scene.nodes.find((node) => node.semanticRef === `${NS}b`)!;
    expect(b.geometry.y).toBeGreaterThan(a.geometry.y);
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
