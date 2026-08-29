import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h } from "vue";

import type { DiagramScene, ElementGeometry, Point } from "@iriograph/core";

import DiagramCanvas from "./DiagramCanvas.vue";
import type { DiagramCanvasNavigationApi } from "../viewport";

describe("DiagramCanvas pointer gestures", () => {
  let wrapper: VueWrapper | undefined;

  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
    document.body.innerHTML = "";
  });

  it("薄いCanvas gridをsnap sizeと同期し表示だけ切り替える", async () => {
    wrapper = mount(DiagramCanvas, {
      props: {
        scene: sceneFixture(),
        snap: { grid: { enabled: true, size: 12 }, targets: { enabled: true, tolerance: 6 } },
        showGrid: true,
      },
    });
    expect(wrapper.get(".iriograph-diagram-canvas").attributes("style")).toContain("--iriograph-grid-size: 12px");
    expect(wrapper.get(".iriograph-diagram-canvas").attributes("style")).toContain("--iriograph-grid-visual-step: 12px");
    expect(wrapper.get(".iriograph-diagram-canvas").attributes("style")).toContain("--iriograph-grid-line-width: 1px");
    expect(wrapper.get(".iriograph-canvas-grid").attributes("aria-hidden")).toBe("true");
    const css = readFileSync("src/styles.css", "utf8");
    expect(css).toMatch(/\.iriograph-canvas-grid\s*\{[^}]*repeating-linear-gradient\(to right,[^}]*--iriograph-grid-line-width[^}]*--iriograph-grid-visual-step[^}]*repeating-linear-gradient\(to bottom,[^}]*pointer-events:\s*none;/su);
    expect(wrapper.get('.iriograph-scene-node[data-element-id="node-a"]').attributes()).toMatchObject({
      "data-scene-x": "20",
      "data-scene-y": "40",
      "data-scene-width": "120",
      "data-scene-height": "60",
    });
    await wrapper.setProps({ showGrid: false });
    expect(wrapper.find(".iriograph-canvas-grid").exists()).toBe(false);
    expect(wrapper.emitted("geometryChange")).toBeUndefined();
  });

  it("低倍率ではsnapの整数倍を使いgridを画面上8px以上・線幅1pxに保つ", async () => {
    wrapper = mount(DiagramCanvas, {
      props: {
        scene: sceneFixture(),
        zoom: .3,
        snap: { grid: { enabled: true, size: 8 }, targets: { enabled: true, tolerance: 6 } },
      },
    });
    let style = wrapper.get(".iriograph-diagram-canvas").attributes("style");
    expect(style).toContain("--iriograph-grid-size: 8px");
    expect(style).toContain("--iriograph-grid-visual-step: 32px");
    expect(style).toContain("--iriograph-grid-line-width: 3.3333px");

    await wrapper.setProps({ zoom: .5 });
    style = wrapper.get(".iriograph-diagram-canvas").attributes("style");
    expect(style).toContain("--iriograph-grid-visual-step: 16px");
    expect(style).toContain("--iriograph-grid-line-width: 2px");

    await wrapper.setProps({ zoom: 1 });
    style = wrapper.get(".iriograph-diagram-canvas").attributes("style");
    expect(style).toContain("--iriograph-grid-visual-step: 8px");
    expect(style).toContain("--iriograph-grid-line-width: 1px");
    expect(wrapper.emitted("geometryChange")).toBeUndefined();
  });

  it("nodeごとに最もspecificな型tagを1件だけ表示し、残りは型一覧へ案内してsession highlightする", async () => {
    const scene = sceneFixture();
    const original = structuredClone(scene);
    wrapper = mount(DiagramCanvas, {
      props: {
        scene,
        nodeTypeTags: {
          "node-a": {
            typeId: "type-opaque-child",
            resourceId: "resource-opaque-a",
            label: "審査工程",
            additionalDirectCount: 2,
            inheritedCount: 3,
          },
        },
        typeHighlightElementIds: ["node-a"],
      },
    });
    const tags = wrapper.findAll(".iriograph-node-type-tag");
    expect(tags).toHaveLength(1);
    expect(tags[0]!.text()).toBe("審査工程");
    expect(tags[0]!.attributes("title")).toContain("他の直接の型 2件");
    expect(tags[0]!.attributes("title")).toContain("継承する型 3件");
    expect(wrapper.get('.iriograph-scene-node[data-element-id="node-a"]').classes()).toContain("type-highlight");
    expect(wrapper.html()).not.toMatch(/urn:|https?:\/\//u);

    await wrapper.setProps({ typeHighlightElementIds: [] });
    expect(wrapper.get('.iriograph-scene-node[data-element-id="node-a"]').classes()).not.toContain("type-highlight");
    await wrapper.setProps({ typeHighlightElementIds: ["node-a"] });
    expect(wrapper.get('.iriograph-scene-node[data-element-id="node-a"]').classes()).toContain("type-highlight");

    await tags[0]!.trigger("click");
    expect(wrapper.emitted("typeTagRequest")).toEqual([[
      { elementId: "node-a", typeId: "type-opaque-child", resourceId: "resource-opaque-a" },
    ]]);
    expect(scene).toEqual(original);
    expect(wrapper.emitted("geometryChange")).toBeUndefined();
    expect(wrapper.emitted("routingUpdate")).toBeUndefined();
  });

  it("意味注記とビュー注記を区別し、ビュー注記だけをdrag候補として通知する", async () => {
    const scene = sceneFixture();
    scene.annotations = [{
      elementId: "annotation-note-1",
      annotationId: "note-1",
      structuralKind: "annotation",
      annotationKind: "view",
      text: "このビューだけの注意",
      anchorElementId: "node-a",
      templateRef: "urn:test:annotation",
      defaultSize: { width: 180, height: 72 },
      geometry: { x: 180, y: 40, width: 180, height: 72 },
      style: { fill: "#fff8cc", stroke: "#b78b22", text: "#302814" },
      pinned: true,
      placement: "user",
      provenance: { kind: "view-annotation", viewId: "main", annotationId: "note-1" },
    }, {
      elementId: "annotation-comment-1",
      annotationId: "literal-1",
      structuralKind: "annotation",
      annotationKind: "semantic-literal",
      text: "意味側の説明",
      language: "ja",
      anchorElementId: "node-a",
      templateRef: "urn:test:annotation",
      defaultSize: { width: 180, height: 72 },
      geometry: { x: 180, y: 130, width: 180, height: 72 },
      style: { fill: "#eef6ff", stroke: "#4b82c3", text: "#123" },
      pinned: false,
      placement: "generated",
      provenance: {
        sourceStatementRefs: ["urn:test:statement:comment"],
        operator: "literal-annotation",
        derivation: "derived",
      },
    }];
    wrapper = mount(DiagramCanvas, { props: { scene, selectedAnnotationId: "note-1" } });
    const notes = wrapper.findAll(".iriograph-scene-annotation");
    expect(notes).toHaveLength(2);
    expect(notes[0]!.classes()).toContain("selected");
    await notes[0]!.trigger("click");
    expect(wrapper.emitted("annotationRequest")?.at(-1)).toEqual([{
      annotationId: "note-1",
      annotationKind: "view",
      anchorElementId: "node-a",
    }]);
    await notes[0]!.trigger("pointerdown", { button: 0, clientX: 180, clientY: 40 });
    dispatchPointer("pointermove", 212, 56);
    dispatchPointer("pointerup", 212, 56);
    expect(wrapper.emitted("annotationGeometryChange")?.at(-1)).toEqual([{
      annotationId: "note-1",
      geometry: { x: 212, y: 56, width: 180, height: 72 },
    }]);
    await notes[1]!.trigger("pointerdown", { button: 0, clientX: 180, clientY: 130 });
    dispatchPointer("pointermove", 220, 150);
    dispatchPointer("pointerup", 220, 150);
    expect(wrapper.emitted("annotationGeometryChange")).toHaveLength(1);
  });

  it("削除previewはresourceとexact provenanceの影響edge・membershipを一時表示する", async () => {
    const scene = sceneFixture();
    const directProvenance = (statementRef: string) => ({
      sourceStatementRefs: [statementRef],
      operator: "implicit-direct-edge" as const,
      derivation: "direct" as const,
    });
    scene.edges[0]!.provenance = directProvenance("urn:test:statement:removed-edge");
    scene.edges.push({
      ...structuredClone(scene.edges[0]!),
      elementId: "edge-same-predicate-not-removed",
      semanticRef: "urn:test:canvas:statement:not-removed",
      provenance: directProvenance("urn:test:statement:not-removed"),
    });
    scene.edges.push({
      ...structuredClone(scene.edges[0]!),
      elementId: "edge-derived-removed",
      semanticRef: "urn:test:canvas:statement:derived-removed",
      provenance: {
        sourceStatementRefs: ["urn:test:statement:removed-derived"],
        operator: "ordinal-sequence",
        derivation: "derived",
      },
    });
    scene.regions = [{
      elementId: "region-a",
      semanticRef: "urn:test:canvas:region-a",
      structuralKind: "region",
      label: "領域A",
      templateRef: "urn:test:template:region",
      style: { fill: "#fff", stroke: "#000", text: "#000" },
      geometry: { x: 0, y: 0, width: 480, height: 280 },
      pinned: false,
      placement: "generated",
      provenance: {
        sourceStatementRefs: ["urn:test:statement:region-a"],
        operator: "membership-region",
        derivation: "resource",
      },
    }];
    scene.memberships = [{
      semanticRef: "urn:test:membership:a",
      containerElementId: "region-a",
      regionElementId: "region-a",
      memberElementId: "node-a",
      provenance: {
        sourceStatementRefs: ["urn:test:statement:removed-membership"],
        operator: "membership-region",
        derivation: "derived",
      },
    }];
    const original = structuredClone(scene);
    wrapper = mount(DiagramCanvas, {
      props: {
        scene,
        deletionPreviewResourceRefs: ["urn:test:canvas:a"],
        deletionPreviewStatementRefs: [
          "urn:test:statement:removed-edge",
          "urn:test:statement:removed-derived",
          "urn:test:statement:removed-membership",
        ],
      },
    });

    expect(wrapper.get('.iriograph-scene-node[data-element-id="node-a"]').classes())
      .toContain("deletion-preview");
    expect(wrapper.get('.iriograph-edge-group[data-element-id="edge-a-b"]').classes())
      .toContain("deletion-preview");
    expect(wrapper.get('.iriograph-edge-group[data-element-id="edge-derived-removed"]').classes())
      .toContain("deletion-preview");
    expect(wrapper.get('.iriograph-edge-group[data-element-id="edge-same-predicate-not-removed"]').classes())
      .not.toContain("deletion-preview");
    expect(wrapper.get('.iriograph-deletion-preview-membership')
      .attributes("d")).toMatch(/^M /u);
    expect(scene).toEqual(original);
    expect(wrapper.emitted("geometryChange")).toBeUndefined();

    await wrapper.setProps({
      deletionPreviewResourceRefs: [],
      deletionPreviewStatementRefs: [],
    });
    expect(wrapper.find(".deletion-preview").exists()).toBe(false);
    expect(wrapper.find(".iriograph-deletion-preview-membership").exists()).toBe(false);
  });

  it("semantic/provenance statement diagnosticをScene elementへannotationする", () => {
    const scene = sceneFixture();
    scene.nodes[0]!.provenance = {
      sourceStatementRefs: ["urn:test:statement:node-a"],
      operator: "resource",
      derivation: "resource",
    };
    scene.diagnostics = [{
      severity: "error",
      category: "domain",
      code: "domain-node-a",
      message: "Node A is invalid.",
      statementRef: "urn:test:statement:node-a",
    }];
    wrapper = mount(DiagramCanvas, { attachTo: document.body, props: { scene } });

    const node = wrapper.findAll(".iriograph-scene-node")[0]!;
    expect(node.classes()).toContain("diagnostic-error");
    expect(node.attributes("aria-label")).toContain("診断1件");
  });

  it("zoomを考慮したnode dragを一つのgestureとして通知する", async () => {
    wrapper = mount(DiagramCanvas, {
      attachTo: document.body,
      props: { scene: sceneFixture(), zoom: 2 },
    });

    await wrapper.get(".iriograph-scene-node").trigger("pointerdown", {
      button: 0,
      clientX: 100,
      clientY: 80,
    });
    dispatchPointer("pointermove", 140, 100);
    dispatchPointer("pointerup", 140, 100);

    expect(wrapper.emitted("select")).toEqual([["node-a"]]);
    expect(wrapper.emitted("gestureStart")).toHaveLength(1);
    expect(lastPayload<{ elementId: string; geometry: ElementGeometry }>(wrapper, "geometryChange"))
      .toEqual({
        elementId: "node-a",
        geometry: { x: 40, y: 48, width: 120, height: 60 },
      });
    expect(wrapper.emitted("gestureEnd")).toHaveLength(1);
    expect(wrapper.emitted("zoomChange")).toBeUndefined();
  });

  it("node dragがviewport端へ近づくと表示領域を同じ方向へ追従する", async () => {
    wrapper = mount(DiagramCanvas, {
      attachTo: document.body,
      props: { scene: sceneFixture(), snap: disabledSnap() },
    });
    configureViewport(wrapper, 260, 180);
    const viewport = wrapper.get<HTMLElement>(".iriograph-canvas-scroll");
    await wrapper.get(".iriograph-scene-node").trigger("pointerdown", {
      button: 0,
      clientX: 100,
      clientY: 80,
    });
    dispatchPointer("pointermove", 254, 174);
    expect(viewport.element.scrollLeft).toBeGreaterThan(0);
    expect(viewport.element.scrollTop).toBeGreaterThan(0);
    dispatchPointer("pointerup", 254, 174);
  });

  it("drop前のpreview中に負方向へCanvas boundsを拡張し負座標を確定する", async () => {
    wrapper = mount(DiagramCanvas, {
      attachTo: document.body,
      props: { scene: sceneFixture(), snap: disabledSnap() },
    });
    const stage = wrapper.get<HTMLElement>(".iriograph-canvas-stage");
    expect(stage.element.style.width).toBe("1440px");

    await wrapper.get('.iriograph-scene-node[data-element-id="node-a"]').trigger("pointerdown", {
      button: 0,
      clientX: 340,
      clientY: 360,
    });
    dispatchPointer("pointermove", -660, -640);
    await wrapper.vm.$nextTick();
    expect(Number.parseFloat(stage.element.style.width)).toBeGreaterThan(1440);
    dispatchPointer("pointerup", -660, -640);

    expect(lastPayload<Array<{ elementId: string; geometry: ElementGeometry }>>(
      wrapper,
      "geometryBatchChange",
    )).toEqual([{
      elementId: "node-a",
      geometry: { x: -980, y: -960, width: 120, height: 60 },
    }]);
  });

  it("同じdocument/viewのScene更新では既存余白内のroute変化でwork area原点を動かさない", async () => {
    const scene = sceneFixture();
    wrapper = mount(DiagramCanvas, {
      props: { scene, sceneSessionKey: "document-a\u0000main" },
    });
    const edgeLayer = wrapper.get<SVGSVGElement>(".iriograph-edge-layer");
    const node = wrapper.get<HTMLElement>('.iriograph-scene-node[data-element-id="node-a"]');
    const viewBoxBefore = edgeLayer.attributes("viewBox");
    const positionBefore = { left: node.element.style.left, top: node.element.style.top };

    const routeRefresh = structuredClone(scene);
    routeRefresh.edges[0]!.route = [
      { x: 140, y: 70 },
      { x: 220, y: -102.425 },
      { x: 300, y: 190 },
    ];
    routeRefresh.edges[0]!.waypoints = undefined;
    await wrapper.setProps({ scene: routeRefresh });

    expect(edgeLayer.attributes("viewBox")).toBe(viewBoxBefore);
    expect({ left: node.element.style.left, top: node.element.style.top }).toEqual(positionBefore);

    await wrapper.setProps({ sceneSessionKey: "document-b\u0000main" });
    const resetViewBox = edgeLayer.attributes("viewBox");
    expect(resetViewBox).not.toBe(viewBoxBefore);
    const [, resetTop] = resetViewBox!.split(" ").map(Number);
    expect(resetTop).toBeCloseTo(-422.425);
  });

  it("寸法だけを持つempty Sceneから最初の実Sceneでwork areaを初期化する", async () => {
    const empty = sceneFixture();
    empty.width = 1120;
    empty.height = 680;
    empty.nodes = [];
    empty.edges = [];
    wrapper = mount(DiagramCanvas, {
      props: { scene: empty, sceneSessionKey: "document-a\u0000main" },
    });
    const stage = wrapper.get<HTMLElement>(".iriograph-canvas-stage");
    expect(stage.element.style.width).toBe("1760px");

    await wrapper.setProps({ scene: sceneFixture() });

    expect(stage.element.style.width).toBe("1440px");
    expect(wrapper.get(".iriograph-edge-layer").attributes("viewBox")).toBe("-320 -320 1440 1140");
  });

  it("意味編集の端子dropはnodeだけを接続先draftとして通知しview routingを変更しない", async () => {
    const scene = sceneFixture();
    wrapper = mount(DiagramCanvas, {
      attachTo: document.body,
      props: {
        scene,
        selectedElementId: "edge-a-b",
        selectedElementIds: ["edge-a-b"],
        semanticEndpointReconnect: true,
      },
    });
    const edgeLayer = wrapper.get<SVGSVGElement>(".iriograph-edge-layer").element;
    Object.defineProperty(edgeLayer, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ left: 0, top: 0, right: 1440, bottom: 1140, width: 1440, height: 1140, x: 0, y: 0, toJSON: () => ({}) }),
    });
    const sourceHandle = wrapper.get(".iriograph-endpoint-anchors circle.source");
    await sourceHandle.trigger("pointerdown", { button: 0, clientX: 460, clientY: 390 });
    dispatchPointer("pointermove", 650, 500);
    await wrapper.vm.$nextTick();
    expect(wrapper.get('.iriograph-scene-node[data-element-id="node-b"]').classes())
      .toContain("semantic-reconnect-target");
    expect(wrapper.get(".iriograph-semantic-reconnect-preview").attributes("d")).toMatch(/^M /u);
    dispatchPointer("pointerup", 650, 500);
    expect(lastPayload(wrapper, "semanticEndpointReconnectRequest")).toEqual({
      edgeElementId: "edge-a-b",
      endpoint: "source",
      targetSemanticRef: "urn:test:canvas:b",
    });
    expect(wrapper.emitted("routingUpdate")).toBeUndefined();

    await sourceHandle.trigger("pointerdown", { button: 0, clientX: 460, clientY: 390 });
    dispatchPointer("pointermove", 1020, 770);
    dispatchPointer("pointerup", 1020, 770);
    expect(wrapper.emitted("semanticEndpointReconnectRequest")).toHaveLength(1);
  });

  it("selected nodeをminimum sizeまでresizeしてgestureを閉じる", async () => {
    wrapper = mount(DiagramCanvas, {
      attachTo: document.body,
      props: { scene: sceneFixture(), selectedElementId: "node-a" },
    });

    expect(wrapper.findAll(".iriograph-transient-resize-layer .iriograph-resize-handle"))
      .toHaveLength(8);
    expect(wrapper.find(".iriograph-scene-node .iriograph-resize-handle").exists()).toBe(false);
    expect(wrapper.get('.iriograph-resize-handle[data-handle="se"]').attributes("style"))
      .toContain("left: 460px; top: 420px");
    await wrapper.get('.iriograph-resize-handle[data-handle="se"]').trigger("pointerdown", {
      button: 0,
      clientX: 200,
      clientY: 160,
    });
    dispatchPointer("pointermove", 0, 0);
    dispatchPointer("pointerup", 0, 0);

    expect(lastPayload<{ elementId: string; geometry: ElementGeometry }>(wrapper, "geometryChange"))
      .toEqual({
        elementId: "node-a",
        geometry: { x: 20, y: 40, width: 44, height: 36 },
      });
    expect(wrapper.emitted("gestureStart")).toHaveLength(1);
    expect(wrapper.emitted("gestureEnd")).toHaveLength(1);
  });

  it("selected edgeのwaypoint dragをrouting changeとして通知する", async () => {
    wrapper = mount(DiagramCanvas, {
      attachTo: document.body,
      props: { scene: sceneFixture(), selectedElementId: "edge-a-b" },
    });

    await wrapper.get(".iriograph-waypoints circle").trigger("pointerdown", {
      button: 0,
      clientX: 120,
      clientY: 90,
    });
    dispatchPointer("pointermove", 155, 112);
    dispatchPointer("pointerup", 155, 112);

    expect(lastPayload<{ elementId: string; waypoints: Point[] }>(wrapper, "routingChange"))
      .toEqual({
        elementId: "edge-a-b",
        waypoints: [{ x: 175, y: 112 }],
      });
    expect(lastPayload(wrapper, "routingUpdate")).toEqual({
      elementId: "edge-a-b",
      routing: { waypoints: [{ x: 175, y: 112 }] },
    });
    expect(wrapper.emitted("gestureStart")).toHaveLength(1);
    expect(wrapper.emitted("gestureEnd")).toHaveLength(1);
  });

  it("selected edgeのsource/target anchor handleをperimeter方向へdragしてpreview後に確定する", async () => {
    wrapper = mount(DiagramCanvas, {
      attachTo: document.body,
      props: { scene: sceneFixture(), selectedElementId: "edge-a-b" },
    });
    const svg = wrapper.get<SVGSVGElement>(".iriograph-edge-layer");
    svg.element.getBoundingClientRect = () => ({
      x: 0, y: 0, left: 0, top: 0, right: 1440, bottom: 1140,
      width: 1440, height: 1140, toJSON: () => undefined,
    });
    const handles = wrapper.findAll(".iriograph-endpoint-anchors circle");
    expect(handles).toHaveLength(2);
    expect(wrapper.find(".iriograph-edge-interaction-layer .iriograph-edge-arrow-overlay").exists())
      .toBe(false);
    expect(handles[0]!.classes()).toContain("source");
    expect(handles[1]!.classes()).toContain("target");

    await handles[0]!.trigger("pointerdown", { button: 0, clientX: 460, clientY: 390 });
    dispatchPointer("pointermove", 400, 340);
    await flushPreview();
    expect(wrapper.get(".iriograph-endpoint-anchors circle.source").attributes("cx")).toBe("80");
    expect(wrapper.get(".iriograph-endpoint-anchors circle.source").attributes("cy")).toBe("22");
    expect(wrapper.emitted("routingUpdate")).toBeUndefined();
    dispatchPointer("pointerup", 400, 340);

    expect(lastPayload(wrapper, "routingUpdate")).toEqual({
      elementId: "edge-a-b",
      routing: {
        waypoints: [{ x: 140, y: 90 }],
        sourceAnchor: { position: 0 },
      },
    });
    expect(wrapper.emitted("gestureStart")).toHaveLength(1);
    expect(wrapper.emitted("gestureEnd")).toHaveLength(1);
  });

  it("Scene routeをendpoint込みpolylineとして描画しlegacy edgeだけ旧経路へfallbackする", () => {
    const scene = sceneFixture();
    scene.edges.push({
      ...scene.edges[0]!,
      elementId: "legacy-edge",
      route: undefined,
      waypoints: undefined,
    });
    wrapper = mount(DiagramCanvas, { props: { scene } });

    const paths = wrapper.findAll(".iriograph-edge-path");
    expect(paths[0]!.attributes("d")).toBe("M 140 70 L 140 90 L 300 190");
    expect(paths[1]!.attributes("d")).toContain(" C ");
  });

  it("route modeを排他的に再描画し直線・直角・曲線・自動を混在させない", async () => {
    const scene = generatedRouteScene();
    const edgeId = scene.edges[0]!.elementId;
    wrapper = mount(DiagramCanvas, { props: { scene, edgeRouteModes: { [edgeId]: "auto" } } });

    expect(wrapper.get(".iriograph-edge-path").attributes("d"))
      .toBe("M 140 70 L 220 70 L 220 190 L 300 190");

    await wrapper.setProps({ edgeRouteModes: { [edgeId]: "straight" } });
    expect(wrapper.get(".iriograph-edge-path").attributes("d")).toBe("M 140 70 L 300 190");

    scene.edges[0]!.route = [{ x: 140, y: 70 }, { x: 205, y: 125 }, { x: 300, y: 190 }];
    await wrapper.setProps({ scene: structuredClone(scene), edgeRouteModes: { [edgeId]: "orthogonal" } });
    expect(wrapper.get(".iriograph-edge-path").attributes("d"))
      .toBe("M 140 70 L 205 70 L 205 125 L 300 125 L 300 190");

    scene.edges[0]!.route = [{ x: 140, y: 70 }, { x: 300, y: 70 }];
    await wrapper.setProps({ scene: structuredClone(scene), edgeRouteModes: { [edgeId]: "curve" } });
    const curve = wrapper.get(".iriograph-edge-path").attributes("d");
    expect(curve).toContain(" C ");
    expect(curve).not.toMatch(/[LQ]/u);
    expect(curve).not.toBe("M 140 70 L 300 70");

    await wrapper.setProps({ edgeRouteModes: { [edgeId]: "auto" } });
    expect(wrapper.get(".iriograph-edge-path").attributes("d")).toBe("M 140 70 L 300 70");
  });

  it("auto route choiceのBezierをpath・hitarea・labelで共通利用しoverlay化しない", async () => {
    const scene = generatedRouteScene();
    const edge = scene.edges[0]!;
    edge.routeMode = "auto";
    edge.route = [{ x: 140, y: 70 }, { x: 300, y: 190 }];
    edge.derivedRouteChoice = {
      family: "curve",
      source: "auto",
      reason: "auto-curve-safe",
      curve: {
        sourceControl: { x: 170, y: 20 },
        targetControl: { x: 270, y: 250 },
        guidePivot: { x: 220, y: 145 },
        guideAngleDegrees: 41,
      },
    };
    wrapper = mount(DiagramCanvas, { props: { scene } });

    const expected = "M 140 70 C 170 20, 270 250, 300 190";
    expect(wrapper.get(".iriograph-edge-path").attributes("d")).toBe(expected);
    expect(wrapper.get(".iriograph-edge-hitarea").attributes("d")).toBe(expected);
    expect(Number(wrapper.get(".iriograph-edge-label").attributes("y"))).toBeGreaterThan(130);
    expect(wrapper.find(".iriograph-curve-controls").exists()).toBe(false);
    expect(wrapper.emitted("routingUpdate")).toBeUndefined();

    await wrapper.setProps({ edgeRouteModes: { [edge.elementId]: "straight" } });
    expect(wrapper.get(".iriograph-edge-path").attributes("d")).toBe("M 140 70 L 300 190");
  });

  it("explicitからautoへ戻すとstale explicit choice/controlを再利用しない", async () => {
    const scene = generatedRouteScene();
    const edge = scene.edges[0]!;
    edge.routeMode = "curve";
    edge.route = [{ x: 140, y: 70 }, { x: 300, y: 190 }];
    edge.derivedRouteChoice = {
      family: "curve",
      source: "explicit",
      reason: "explicit-route-mode",
      curve: {
        sourceControl: { x: 150, y: -200 },
        targetControl: { x: 290, y: 400 },
        guidePivot: { x: 220, y: 100 },
        guideAngleDegrees: 80,
      },
    };
    wrapper = mount(DiagramCanvas, {
      props: { scene, edgeRouteModes: { [edge.elementId]: "curve" } },
    });
    expect(wrapper.get(".iriograph-edge-path").attributes("d")).toContain(" C ");

    await wrapper.setProps({ edgeRouteModes: { [edge.elementId]: "auto" } });
    expect(wrapper.get(".iriograph-edge-path").attributes("d")).toBe("M 140 70 L 300 190");
  });

  it("選択node内のlabel/iconをzoom考慮でdragしpreview後にoffsetだけを確定する", async () => {
    const scene = sceneFixture();
    scene.nodes[0]!.iconUrl = "data:image/svg+xml,%3Csvg/%3E";
    scene.nodes[0]!.nodeLabelWritingDirection = "vertical-down";
    wrapper = mount(DiagramCanvas, {
      attachTo: document.body,
      props: {
        scene,
        selectedElementId: "node-a",
        selectedElementIds: ["node-a"],
        nodeContentEditing: true,
        zoom: 2,
      },
    });

    expect(wrapper.get('.iriograph-scene-node[data-element-id="node-a"] .iriograph-node-text')
      .classes()).toContain("writing-vertical");

    wrapper.get('.iriograph-scene-node[data-element-id="node-a"] .iriograph-node-text').element
      .dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, clientX: 100, clientY: 80 }));
    await wrapper.vm.$nextTick();
    dispatchPointer("pointermove", 130, 90);
    await wrapper.vm.$nextTick();
    expect(wrapper.emitted("gestureStart")).toHaveLength(1);
    expect(wrapper.get('.iriograph-scene-node[data-element-id="node-a"] .iriograph-node-text')
      .attributes("style")).toContain("translate(15px, 5px)");
    dispatchPointer("pointerup", 130, 90);
    expect(lastPayload(wrapper, "nodeContentOffsetUpdate")).toEqual({
      elementId: "node-a",
      target: "label",
      offset: { x: 15, y: 5 },
    });

    wrapper.get('.iriograph-scene-node[data-element-id="node-a"] .iriograph-node-icon').element
      .dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, clientX: 100, clientY: 80 }));
    await wrapper.vm.$nextTick();
    dispatchPointer("pointermove", 300, 300);
    dispatchPointer("pointerup", 300, 300);
    expect(lastPayload(wrapper, "nodeContentOffsetUpdate")).toEqual({
      elementId: "node-a",
      target: "icon",
      offset: { x: 50, y: 20 },
    });
    expect(wrapper.emitted("geometryChange")).toBeUndefined();
    expect(wrapper.emitted("gestureStart")).toHaveLength(2);
    expect(wrapper.emitted("gestureEnd")).toHaveLength(2);

    await wrapper.setProps({ readOnly: true });
    wrapper.get('.iriograph-scene-node[data-element-id="node-a"] .iriograph-node-text').element
      .dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, clientX: 10, clientY: 10 }));
    await wrapper.vm.$nextTick();
    dispatchPointer("pointermove", 40, 40);
    dispatchPointer("pointerup", 40, 40);
    expect(wrapper.emitted("nodeContentOffsetUpdate")).toHaveLength(2);
  });

  it("画像のintrinsic比率・scale/明示size・fitとlabel font sizeを描画へ反映する", async () => {
    const scene = generatedRouteScene();
    const node = scene.nodes[0]!;
    node.iconUrl = "data:image/svg+xml,%3Csvg/%3E";
    node.iconIntrinsicSize = { width: 80, height: 40, aspectRatio: 2, source: "svg-view-box" };
    node.nodeIconScale = 1.5;
    node.nodeIconFit = "cover";
    node.style.labelFontSize = 18;
    scene.edges[0]!.style.labelFontSize = 15;
    wrapper = mount(DiagramCanvas, { props: { scene } });

    expect(wrapper.get(".iriograph-node-icon").attributes("style"))
      .toContain("width: 36px; height: 18px; object-fit: cover");
    expect(wrapper.get(".iriograph-node-icon").attributes("loading")).toBe("lazy");
    expect(wrapper.get(".iriograph-node-label").attributes("style")).toContain("font-size: 18px");
    expect(wrapper.get(".iriograph-edge-label").attributes("font-size")).toBe("15");

    node.nodeIconSize = { width: 44, height: 72 };
    await wrapper.setProps({ scene: structuredClone(scene) });
    expect(wrapper.get(".iriograph-node-icon").attributes("style"))
      .toContain("width: 44px; height: 72px");

    delete node.nodeIconSize;
    node.nodeIconScale = undefined;
    node.iconIntrinsicSize = { width: 4000, height: 1000, aspectRatio: 4, source: "decoded" };
    await wrapper.setProps({ scene: structuredClone(scene) });
    expect(wrapper.get(".iriograph-node-icon").attributes("style"))
      .toContain("width: 24px; height: 6px");
  });

  it("Canvas handleでicon比率を保ってresizeし必要なnode growthを一payloadにする", async () => {
    const scene = sceneFixture();
    const node = scene.nodes[0]!;
    node.iconUrl = "data:image/svg+xml,%3Csvg/%3E";
    node.iconIntrinsicSize = { width: 24, height: 24, aspectRatio: 1, source: "svg-view-box" };
    wrapper = mount(DiagramCanvas, {
      attachTo: document.body,
      props: {
        scene,
        selectedElementId: node.elementId,
        selectedElementIds: [node.elementId],
        nodeContentEditing: true,
      },
    });

    await wrapper.get(".iriograph-node-icon-resize-handle").trigger("pointerdown", {
      button: 0,
      clientX: 100,
      clientY: 80,
    });
    dispatchPointer("pointermove", 150, 130);
    await wrapper.vm.$nextTick();
    expect(wrapper.get(".iriograph-node-icon").attributes("style"))
      .toContain("width: 74px; height: 74px");
    dispatchPointer("pointerup", 150, 130);

    expect(lastPayload(wrapper, "nodeIconPresentationUpdate")).toEqual({
      elementId: node.elementId,
      size: { width: 74, height: 74 },
      geometry: { x: 20, y: 40, width: 120, height: 106 },
    });
    expect(wrapper.emitted("geometryChange")).toBeUndefined();
    expect(wrapper.emitted("gestureStart")).toHaveLength(1);
    expect(wrapper.emitted("gestureEnd")).toHaveLength(1);
  });

  it("Diamondは図形surfaceだけを描画し横書き・縦書きの日本語labelを内接contentに保つ", () => {
    const scene = sceneFixture();
    const base = scene.nodes[0]!;
    scene.edges = [];
    scene.nodes = [
      {
        ...structuredClone(base),
        elementId: "diamond-horizontal-short",
        semanticRef: "urn:test:diamond:horizontal-short",
        label: "承認",
        shape: "diamond",
        geometry: { x: 20, y: 40, width: 104, height: 104 },
      },
      {
        ...structuredClone(base),
        elementId: "diamond-horizontal-long-icon",
        semanticRef: "urn:test:diamond:horizontal-long-icon",
        label: "承認条件を確認して次の処理を選択する",
        shape: "diamond",
        iconUrl: "data:image/svg+xml,%3Csvg/%3E",
        geometry: { x: 160, y: 40, width: 144, height: 112 },
      },
      {
        ...structuredClone(base),
        elementId: "diamond-vertical-short-icon",
        semanticRef: "urn:test:diamond:vertical-short-icon",
        label: "確認",
        shape: "diamond",
        iconUrl: "data:image/svg+xml,%3Csvg/%3E",
        nodeLabelWritingDirection: "vertical-down",
        nodeLabelOffset: { x: 3, y: -2 },
        nodeIconOffset: { x: -2, y: 3 },
        geometry: { x: 340, y: 40, width: 112, height: 144 },
      },
      {
        ...structuredClone(base),
        elementId: "diamond-vertical-long",
        semanticRef: "urn:test:diamond:vertical-long",
        label: "問い合わせ内容を確認して対応方法を選択する",
        shape: "diamond",
        nodeLabelWritingDirection: "vertical-down",
        geometry: { x: 500, y: 40, width: 120, height: 160 },
      },
    ];
    const original = structuredClone(scene);
    wrapper = mount(DiagramCanvas, { props: { scene } });

    for (const node of scene.nodes) {
      const rendered = wrapper.get(`.iriograph-scene-node[data-element-id="${node.elementId}"]`);
      expect(rendered.attributes("style")).toContain("background: transparent");
      expect(rendered.attributes("style")).toContain("border-color: transparent");
      expect(rendered.get(".iriograph-node-diamond-surface polygon").attributes("points"))
        .toBe("50,1 99,50 50,99 1,50");
      expect(rendered.get(".iriograph-node-label").text()).toBe(node.label);
    }

    const horizontalShort = wrapper.get('[data-element-id="diamond-horizontal-short"]');
    expect(horizontalShort.get(".iriograph-node-content").classes()).toContain("content-horizontal");
    expect(horizontalShort.get(".iriograph-node-text").classes()).toContain("writing-horizontal");
    expect(horizontalShort.find(".iriograph-node-icon").exists()).toBe(false);

    const horizontalLong = wrapper.get('[data-element-id="diamond-horizontal-long-icon"]');
    expect(horizontalLong.get(".iriograph-node-content").classes()).toContain("content-horizontal");
    expect(horizontalLong.find(".iriograph-node-icon").exists()).toBe(true);

    const verticalShort = wrapper.get('[data-element-id="diamond-vertical-short-icon"]');
    expect(verticalShort.classes()).toContain("label-direction-vertical");
    expect(verticalShort.get(".iriograph-node-content").classes()).toContain("content-vertical");
    expect(verticalShort.get(".iriograph-node-text").classes()).toContain("writing-vertical");
    expect(verticalShort.get(".iriograph-node-text").attributes("style"))
      .toContain("translate(3px, -2px)");
    expect(verticalShort.get(".iriograph-node-icon").attributes("style"))
      .toContain("translate(-2px, 3px)");

    const verticalLong = wrapper.get('[data-element-id="diamond-vertical-long"]');
    expect(verticalLong.get(".iriograph-node-content").classes()).toContain("content-vertical");
    expect(verticalLong.find(".iriograph-node-icon").exists()).toBe(false);
    expect(scene).toEqual(original);
  });

  it("Diamond resizeは未回転の8 handle座標でpreviewしlabel本文と方向を維持する", async () => {
    const scene = sceneFixture();
    scene.edges = [];
    scene.nodes = [{
      ...scene.nodes[0]!,
      elementId: "diamond-resize",
      semanticRef: "urn:test:diamond:resize",
      label: "長い承認条件を確認する",
      shape: "diamond",
      nodeLabelWritingDirection: "vertical-down",
      iconUrl: "data:image/svg+xml,%3Csvg/%3E",
      geometry: { x: 20, y: 40, width: 104, height: 104 },
    }];
    wrapper = mount(DiagramCanvas, {
      attachTo: document.body,
      props: {
        scene,
        selectedElementId: "diamond-resize",
        selectedElementIds: ["diamond-resize"],
      },
    });

    expect(wrapper.findAll(".iriograph-transient-resize-layer .iriograph-resize-handle"))
      .toHaveLength(8);
    expect(wrapper.find(".iriograph-scene-node .iriograph-resize-handle").exists()).toBe(false);
    await wrapper.get('.iriograph-resize-handle[data-handle="se"]').trigger("pointerdown", {
      button: 0,
      clientX: 124,
      clientY: 144,
    });
    dispatchPointer("pointermove", 164, 184);
    await wrapper.vm.$nextTick();

    const preview = wrapper.get('[data-element-id="diamond-resize"]');
    expect(preview.attributes("style")).toContain("width: 144px");
    expect(preview.attributes("style")).toContain("height: 144px");
    expect(preview.get(".iriograph-node-content").classes()).toContain("content-vertical");
    expect(preview.get(".iriograph-node-label").text()).toBe("長い承認条件を確認する");
    expect(preview.find(".iriograph-node-diamond-surface").exists()).toBe(true);

    dispatchPointer("pointerup", 164, 184);
    expect(lastPayload<{ elementId: string; geometry: ElementGeometry }>(wrapper, "geometryChange"))
      .toEqual({
        elementId: "diamond-resize",
        geometry: { x: 20, y: 40, width: 144, height: 144 },
      });
    expect(scene.nodes[0]!.geometry).toEqual({ x: 20, y: 40, width: 104, height: 104 });
    expect(wrapper.emitted("nodeContentOffsetUpdate")).toBeUndefined();
  });

  it("path double-clickでderived bendをseedしnearest segmentへwaypointを追加する", async () => {
    const scene = generatedRouteScene();
    wrapper = mount(DiagramCanvas, { attachTo: document.body, props: { scene } });
    const svg = wrapper.get<SVGSVGElement>(".iriograph-edge-layer");
    svg.element.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 1440,
      bottom: 1140,
      width: 1440,
      height: 1140,
      toJSON: () => undefined,
    });

    await wrapper.get(".iriograph-edge-group").trigger("dblclick", { clientX: 500, clientY: 396 });

    expect(lastPayload(wrapper, "routingUpdate")).toEqual({
      elementId: "edge-a-b",
      routing: {
        waypoints: [{ x: 180, y: 70 }, { x: 220, y: 70 }, { x: 220, y: 190 }],
      },
    });
    expect(wrapper.emitted("gestureStart")).toHaveLength(1);
    expect(wrapper.emitted("gestureEnd")).toHaveLength(1);
  });

  it.each(["straight"] as const)(
    "%s routeではgenerated waypoint handleもdouble-click追加も無効にする",
    async (routeMode) => {
      const scene = generatedRouteScene();
      wrapper = mount(DiagramCanvas, {
        attachTo: document.body,
        props: {
          scene,
          selectedElementId: "edge-a-b",
          edgeRouteModes: { "edge-a-b": routeMode },
        },
      });
      const svg = wrapper.get<SVGSVGElement>(".iriograph-edge-layer");
      svg.element.getBoundingClientRect = () => ({
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: 800,
        bottom: 500,
        width: 800,
        height: 500,
        toJSON: () => undefined,
      });

      expect(wrapper.find(".iriograph-waypoints").exists()).toBe(false);
      await wrapper.get(".iriograph-edge-group").trigger("dblclick", { clientX: 180, clientY: 76 });

      expect(wrapper.emitted("routingUpdate")).toBeUndefined();
      expect(wrapper.emitted("gestureStart")).toBeUndefined();
    },
  );

  it("curve pathのdouble-clickでon-curve knotを一操作として追加する", async () => {
    const scene = generatedRouteScene();
    wrapper = mount(DiagramCanvas, {
      attachTo: document.body,
      props: {
        scene,
        selectedElementId: "edge-a-b",
        edgeRouteModes: { "edge-a-b": "curve" },
      },
    });
    const svg = wrapper.get<SVGSVGElement>(".iriograph-edge-layer");
    svg.element.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 800,
      bottom: 500,
      width: 800,
      height: 500,
      toJSON: () => undefined,
    });

    expect(wrapper.find(".iriograph-waypoints").exists()).toBe(false);
    expect(wrapper.findAll(".iriograph-curve-handle")).toHaveLength(2);
    await wrapper.get(".iriograph-edge-group").trigger("dblclick", { clientX: 220, clientY: 110 });

    const update = lastPayload<{ elementId: string; routing?: { curve?: { knots?: Array<{ point: Point }> } } }>(
      wrapper,
      "routingUpdate",
    );
    expect(update!.elementId).toBe("edge-a-b");
    expect(update!.routing?.curve?.knots).toHaveLength(1);
    expect(update!.routing?.curve?.knots?.[0]?.point).toEqual(expect.objectContaining({
      x: expect.any(Number),
      y: expect.any(Number),
    }));
    expect(wrapper.emitted("gestureStart")).toHaveLength(1);
    expect(wrapper.emitted("gestureEnd")).toHaveLength(1);
  });

  it("curve knot/handleを操作層でdrag・keyboard resetし一gesture一履歴境界にする", async () => {
    const scene = generatedRouteScene();
    scene.edges[0]!.routeMode = "curve";
    scene.edges[0]!.curve = {
      sourceHandle: { x: 35, y: 20 },
      knots: [{ point: { x: 220, y: 125 } }],
    };
    wrapper = mount(DiagramCanvas, {
      attachTo: document.body,
      props: { scene, selectedElementId: "edge-a-b" },
    });

    expect(wrapper.findAll(".iriograph-curve-handle")).toHaveLength(4);
    const knot = wrapper.get(".iriograph-curve-knot");
    await knot.trigger("pointerdown", { button: 0, clientX: 100, clientY: 100 });
    dispatchPointer("pointermove", 120, 110);
    expect(wrapper.emitted("routingUpdate")).toBeUndefined();
    dispatchPointer("pointerup", 120, 110);
    expect(lastPayload(wrapper, "routingUpdate")).toEqual({
      elementId: "edge-a-b",
      routing: {
        curve: {
          sourceHandle: { x: 35, y: 20 },
          knots: [{ point: { x: 240, y: 135 } }],
        },
      },
    });
    expect(wrapper.emitted("gestureStart")).toHaveLength(1);
    expect(wrapper.emitted("gestureEnd")).toHaveLength(1);

    const manualSource = wrapper.findAll(".iriograph-curve-handle")
      .find((handle) => handle.classes().includes("manual"));
    expect(manualSource).toBeDefined();
    await manualSource!.trigger("keydown", { key: "Delete" });
    expect(lastPayload(wrapper, "routingUpdate")).toEqual({
      elementId: "edge-a-b",
      routing: { curve: { knots: [{ point: { x: 220, y: 125 } }] } },
    });
    expect(wrapper.emitted("gestureStart")).toHaveLength(2);
    expect(wrapper.emitted("gestureEnd")).toHaveLength(2);
  });

  it("curve controlのhit targetをzoomに対して一定screen sizeに保つ", () => {
    const scene = generatedRouteScene();
    scene.edges[0]!.routeMode = "curve";
    scene.edges[0]!.curve = { knots: [{ point: { x: 220, y: 125 } }] };
    wrapper = mount(DiagramCanvas, {
      props: { scene, selectedElementId: "edge-a-b", zoom: 2 },
    });

    expect(wrapper.get(".iriograph-curve-knot").attributes("r")).toBe("4.5");
    expect(wrapper.get(".iriograph-curve-handle").attributes("r")).toBe("3.5");
    expect(wrapper.get(".iriograph-edge-hitarea").classes()).toContain("iriograph-edge-hitarea");
  });

  it("curve captionを実Bezier弧長の中央へ置きself-loop/parallelでもpathから外さない", () => {
    const scene = generatedRouteScene();
    const base = scene.edges[0]!;
    scene.edges = [
      {
        ...structuredClone(base),
        elementId: "parallel-upper",
        routeMode: "curve",
        label: "upper",
        route: [{ x: 140, y: 70 }, { x: 220, y: 20 }, { x: 300, y: 190 }],
      },
      {
        ...structuredClone(base),
        elementId: "parallel-lower",
        routeMode: "curve",
        label: "lower",
        route: [{ x: 140, y: 70 }, { x: 220, y: 240 }, { x: 300, y: 190 }],
      },
      {
        ...structuredClone(base),
        elementId: "self-loop",
        routeMode: "curve",
        label: "loop",
        sourceElementId: "node-a",
        targetElementId: "node-a",
        route: [{ x: 140, y: 70 }, { x: 210, y: 10 }, { x: 140, y: 70 }],
      },
    ];
    wrapper = mount(DiagramCanvas, { props: { scene } });

    const labels = wrapper.findAll(".iriograph-edge-label");
    const upper = Number(labels[0]!.attributes("y"));
    const lower = Number(labels[1]!.attributes("y"));
    const loopX = Number(labels[2]!.attributes("x"));
    const loopY = Number(labels[2]!.attributes("y"));
    expect(upper).toBeLessThan(lower);
    expect({ x: loopX, y: loopY }).not.toEqual({ x: 140, y: 70 });
    expect(wrapper.findAll(".iriograph-edge-path").every((path) => (
      /^M .* C /u.test(path.attributes("d") ?? "") && !/[LQ]/u.test(path.attributes("d") ?? "")
    ))).toBe(true);
  });

  it("focused waypointのkeyboard移動と最後のDeleteを一操作ずつ通知する", async () => {
    wrapper = mount(DiagramCanvas, {
      attachTo: document.body,
      props: { scene: sceneFixture(), selectedElementId: "edge-a-b" },
    });
    const handle = wrapper.get(".iriograph-waypoints circle");

    await handle.trigger("keydown", { key: "ArrowRight", shiftKey: true });
    expect(lastPayload(wrapper, "routingUpdate")).toEqual({
      elementId: "edge-a-b",
      routing: { waypoints: [{ x: 150, y: 90 }] },
    });

    await handle.trigger("keydown", { key: "Delete" });
    expect(lastPayload(wrapper, "routingUpdate")).toEqual({
      elementId: "edge-a-b",
      routing: undefined,
    });
    expect(lastPayload(wrapper, "routingChange")).toEqual({
      elementId: "edge-a-b",
      waypoints: [],
    });
    expect(wrapper.emitted("gestureStart")).toHaveLength(2);
    expect(wrapper.emitted("gestureEnd")).toHaveLength(2);
  });

  it("labelをarc-length midpointに置きpointer/keyboard/resetでoffsetを通知する", async () => {
    const scene = generatedRouteScene();
    scene.edges[0]!.route = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 300 },
    ];
    wrapper = mount(DiagramCanvas, {
      attachTo: document.body,
      props: { scene, selectedElementId: "edge-a-b", zoom: 2 },
    });
    const label = wrapper.get(".iriograph-edge-label");
    expect(label.attributes("x")).toBe("100");
    expect(label.attributes("y")).toBe("100");
    expect(label.attributes("aria-hidden")).toBe("true");
    expect(label.attributes("tabindex")).toBe("-1");

    await label.trigger("pointerdown", { button: 0, clientX: 100, clientY: 100 });
    dispatchPointer("pointermove", 124, 84);
    dispatchPointer("pointerup", 124, 84);
    expect(lastPayload(wrapper, "routingUpdate")).toEqual({
      elementId: "edge-a-b",
      routing: { labelOffset: { x: 12, y: -8 } },
    });

    await wrapper.setProps({
      scene: {
        ...scene,
        edges: [{ ...scene.edges[0]!, labelOffset: { x: 12, y: -8 } }],
      },
    });
    await label.trigger("keydown", { key: "Home" });
    expect(lastPayload(wrapper, "routingUpdate")).toEqual({
      elementId: "edge-a-b",
      routing: undefined,
    });
  });

  it("parallel/self-loop routeを個別focus・選択しreadOnlyでは編集handleを隠す", async () => {
    const scene = generatedRouteScene();
    scene.edges.push(
      { ...scene.edges[0]!, elementId: "parallel", route: scene.edges[0]!.route!.map((point) => ({ x: point.x, y: point.y + 20 })) },
      { ...scene.edges[0]!, elementId: "loop", sourceElementId: "node-a", targetElementId: "node-a", route: [{ x: 140, y: 60 }, { x: 190, y: 60 }, { x: 190, y: 80 }, { x: 140, y: 80 }] },
    );
    wrapper = mount(DiagramCanvas, { props: { scene, readOnly: true } });
    const groups = wrapper.findAll(".iriograph-edge-group");

    expect(new Set(groups.map((group) => group.get(".iriograph-edge-path").attributes("d"))).size).toBe(3);
    expect(groups[0]!.attributes("aria-label")).toContain("AからB");
    expect(groups[0]!.attributes("aria-selected")).toBe("false");
    await groups[1]!.trigger("click");
    expect(wrapper.emitted("select")?.at(-1)?.[0]).toBe("parallel");
    await groups[1]!.trigger("keydown", { key: "Delete" });
    expect(wrapper.emitted("routingUpdate")).toBeUndefined();
    expect(wrapper.find(".iriograph-waypoints").exists()).toBe(false);
    expect(wrapper.find(".iriograph-endpoint-anchors").exists()).toBe(false);
    expect(wrapper.get(".iriograph-edge-label").attributes("tabindex")).toBe("-1");
  });

  it("DeleteとBackspaceはactive要素のatomic semantic削除を要求する", async () => {
    wrapper = mount(DiagramCanvas, { props: { scene: sceneFixture() } });

    await wrapper.get(".iriograph-edge-group").trigger("keydown", { key: "Delete" });
    await wrapper.get(".iriograph-scene-node").trigger("keydown", { key: "Backspace" });
    await wrapper.get(".iriograph-canvas-scroll").trigger("keydown", { key: "Delete" });
    await wrapper.get(".iriograph-canvas-scroll").trigger("keydown", { key: "Backspace" });

    expect(wrapper.emitted("semanticEditRequest")?.map((event) => event[0])).toEqual([
      "edge-a-b", "node-a", "node-a", "node-a",
    ]);
    expect(wrapper.emitted("routingUpdate")).toBeUndefined();

    await wrapper.setProps({ readOnly: true });
    await wrapper.get(".iriograph-edge-group").trigger("keydown", { key: "Delete" });
    expect(wrapper.emitted("semanticEditRequest")).toHaveLength(4);
  });

  it("labelのないedgeにはlabel位置handleを作らない", () => {
    const scene = generatedRouteScene();
    scene.edges[0]!.label = "";
    scene.edges[0]!.labelOffset = { x: 20, y: 10 };
    wrapper = mount(DiagramCanvas, { props: { scene, selectedElementId: "edge-a-b" } });

    expect(wrapper.find(".iriograph-edge-label").exists()).toBe(false);
  });

  it("Canvasだけをtab stopにし全scene itemをstable optionとして参照する", () => {
    wrapper = mount(DiagramCanvas, {
      attachTo: document.body,
      props: {
        scene: sceneFixture(),
        selectedElementId: "edge-a-b",
        selectedElementIds: ["edge-a-b"],
        busy: true,
      },
    });
    const viewport = wrapper.get(".iriograph-canvas-scroll");
    const options = wrapper.findAll('[role="option"]');

    expect(wrapper.findAll('[tabindex="0"]')).toHaveLength(1);
    expect(viewport.attributes("role")).toBe("listbox");
    expect(viewport.attributes("aria-busy")).toBe("true");
    expect(viewport.attributes("aria-activedescendant")).toContain("edge-a-b");
    expect(options).toHaveLength(3);
    expect(options.every((option) => option.attributes("tabindex") === "-1")).toBe(true);
    expect(options.every((option) => option.attributes("id"))).toBe(true);
    expect(wrapper.get(".iriograph-edge-label").attributes("tabindex")).toBe("-1");
    expect(wrapper.get(".iriograph-waypoints circle").attributes("tabindex")).toBe("-1");
    expect(wrapper.get(".iriograph-minimap svg").attributes("tabindex")).toBe("-1");
  });

  it("N focus navigationとtoggleをspatial Arrowから分離する", async () => {
    wrapper = mount(DiagramCanvas, { attachTo: document.body, props: { scene: sceneFixture() } });
    const viewport = wrapper.get(".iriograph-canvas-scroll");
    expect(viewport.attributes("aria-activedescendant")).toContain("node-a");

    await viewport.trigger("keydown", { key: "n" });
    expect(viewport.attributes("aria-activedescendant")).toContain("node-b");
    await viewport.trigger("keydown", { key: " ", ctrlKey: true });
    expect(lastPayload(wrapper, "selectionRequest")).toEqual({ elementId: "node-b", mode: "toggle" });
    await viewport.trigger("keydown", { key: "N", shiftKey: true });
    expect(viewport.attributes("aria-activedescendant")).toContain("node-a");
  });

  it("key repeatをephemeral geometry preview一つにまとめkeyupでcommitする", async () => {
    wrapper = mount(DiagramCanvas, {
      attachTo: document.body,
      props: {
        scene: sceneFixture(),
        selectedElementId: "node-a",
        selectedElementIds: ["node-a"],
      },
    });
    const viewport = wrapper.get(".iriograph-canvas-scroll");
    await viewport.trigger("keydown", { key: "ArrowRight" });
    await viewport.trigger("keydown", { key: "ArrowRight", repeat: true });

    expect(wrapper.get(".iriograph-scene-node.selected").attributes("style")).toContain("left: 342px");
    expect(wrapper.emitted("geometryBatchChange")).toBeUndefined();
    expect(wrapper.emitted("gestureStart")).toHaveLength(1);

    await viewport.trigger("keyup", { key: "ArrowRight" });
    expect(lastPayload<{ elementId: string; geometry: ElementGeometry }[]>(wrapper, "geometryBatchChange"))
      .toEqual([{ elementId: "node-a", geometry: { x: 22, y: 40, width: 120, height: 60 } }]);
    expect(wrapper.emitted("gestureEnd")).toHaveLength(1);
  });

  it("keyboard previewをCanvas blurでも一度だけcommitする", async () => {
    wrapper = mount(DiagramCanvas, {
      attachTo: document.body,
      props: {
        scene: sceneFixture(),
        selectedElementId: "node-a",
        selectedElementIds: ["node-a"],
      },
    });
    const viewport = wrapper.get(".iriograph-canvas-scroll");
    await viewport.trigger("keydown", { key: "ArrowDown", ctrlKey: true });
    await viewport.trigger("blur");
    await viewport.trigger("keyup", { key: "ArrowDown", ctrlKey: true });

    expect(wrapper.emitted("geometryBatchChange")).toHaveLength(1);
    expect(wrapper.emitted("gestureStart")).toHaveLength(1);
    expect(wrapper.emitted("gestureEnd")).toHaveLength(1);
  });

  it("Escapeでkeyboard previewを破棄しreadOnly/IMEではwriteを通知しない", async () => {
    wrapper = mount(DiagramCanvas, {
      attachTo: document.body,
      props: {
        scene: sceneFixture(),
        selectedElementId: "node-a",
        selectedElementIds: ["node-a"],
      },
    });
    const viewport = wrapper.get(".iriograph-canvas-scroll");
    await viewport.trigger("keydown", { key: "ArrowRight", ctrlKey: true });
    await viewport.trigger("keydown", { key: "Escape" });
    expect(wrapper.get(".iriograph-scene-node.selected").attributes("style")).toContain("left: 340px");
    expect(wrapper.emitted("geometryBatchChange")).toBeUndefined();

    await wrapper.setProps({ readOnly: true });
    await viewport.trigger("keydown", { key: "ArrowRight", ctrlKey: true });
    await viewport.trigger("keyup", { key: "ArrowRight", ctrlKey: true });
    await viewport.trigger("compositionstart");
    await viewport.trigger("keydown", { key: "ArrowRight" });
    await viewport.trigger("compositionend");
    expect(wrapper.emitted("geometryBatchChange")).toBeUndefined();
  });

  it("gesture中のScene差替えとreadOnly化ではstale previewをcommitしない", async () => {
    wrapper = mount(DiagramCanvas, {
      attachTo: document.body,
      props: {
        scene: sceneFixture(),
        selectedElementId: "node-a",
        selectedElementIds: ["node-a"],
      },
    });
    const viewport = wrapper.get(".iriograph-canvas-scroll");
    await viewport.trigger("keydown", { key: "ArrowRight", ctrlKey: true });
    await wrapper.setProps({ scene: { ...sceneFixture(), width: 900 } });
    await viewport.trigger("keyup", { key: "ArrowRight", ctrlKey: true });
    expect(wrapper.emitted("geometryBatchChange")).toBeUndefined();
    expect(wrapper.emitted("gestureEnd")).toHaveLength(1);

    await viewport.trigger("keydown", { key: "ArrowRight", ctrlKey: true });
    await wrapper.setProps({ readOnly: true });
    await viewport.trigger("keyup", { key: "ArrowRight", ctrlKey: true });
    expect(wrapper.emitted("geometryBatchChange")).toBeUndefined();
    expect(wrapper.emitted("gestureEnd")).toHaveLength(2);
  });

  it("edge waypoint/label routingをkeydown previewからkeyupで確定する", async () => {
    wrapper = mount(DiagramCanvas, {
      attachTo: document.body,
      props: {
        scene: sceneFixture(),
        selectedElementId: "edge-a-b",
        selectedElementIds: ["edge-a-b"],
      },
    });
    const viewport = wrapper.get(".iriograph-canvas-scroll");
    await viewport.trigger("keydown", { key: "ArrowRight", ctrlKey: true });
    await viewport.trigger("keydown", { key: "ArrowRight", ctrlKey: true, repeat: true });
    expect(wrapper.emitted("routingUpdate")).toBeUndefined();
    await viewport.trigger("keyup", { key: "ArrowRight", ctrlKey: true });
    expect(lastPayload(wrapper, "routingUpdate")).toEqual({
      elementId: "edge-a-b",
      routing: { waypoints: [{ x: 142, y: 90 }] },
    });
    const legacyWaypointChanges = wrapper.emitted("routingChange")?.length;

    await viewport.trigger("keydown", { key: "ArrowDown", ctrlKey: true, shiftKey: true });
    await viewport.trigger("keyup", { key: "ArrowDown", ctrlKey: true, shiftKey: true });
    expect(lastPayload(wrapper, "routingUpdate")).toEqual({
      elementId: "edge-a-b",
      routing: { waypoints: [{ x: 140, y: 90 }], labelOffset: { x: 0, y: 10 } },
    });
    expect(wrapper.emitted("routingChange")).toHaveLength(legacyWaypointChanges ?? 0);
  });

  it("curve controlをCanvas単一tab-stopからcycleしkeyboard gestureで編集する", async () => {
    const scene = generatedRouteScene();
    scene.edges[0]!.routeMode = "curve";
    scene.edges[0]!.curve = {
      sourceHandle: { x: 35, y: 20 },
      knots: [{ point: { x: 220, y: 125 } }],
    };
    wrapper = mount(DiagramCanvas, {
      attachTo: document.body,
      props: {
        scene,
        selectedElementId: "edge-a-b",
        selectedElementIds: ["edge-a-b"],
      },
    });
    const viewport = wrapper.get(".iriograph-canvas-scroll");
    expect(wrapper.findAll('[tabindex="0"]')).toHaveLength(1);
    expect(wrapper.findAll(".iriograph-curve-controls circle").every((control) => (
      control.attributes("tabindex") === "-1"
    ))).toBe(true);

    // Knot index 0から次のsource handleへcomposite内のactive targetを移す。
    await viewport.trigger("keydown", { key: "]" });
    await wrapper.vm.$nextTick();
    expect(wrapper.get('[role="status"]').text()).toContain("曲線制御点 2/5");
    expect(wrapper.find(".iriograph-curve-handle.active").exists()).toBe(true);
    await viewport.trigger("keydown", { key: "ArrowRight", ctrlKey: true });
    await viewport.trigger("keydown", { key: "ArrowRight", ctrlKey: true, repeat: true });
    expect(wrapper.emitted("routingUpdate")).toBeUndefined();
    await viewport.trigger("keyup", { key: "ArrowRight", ctrlKey: true });
    expect(lastPayload(wrapper, "routingUpdate")).toEqual({
      elementId: "edge-a-b",
      routing: {
        curve: {
          sourceHandle: { x: 37, y: 20 },
          knots: [{ point: { x: 220, y: 125 } }],
        },
      },
    });
    expect(wrapper.emitted("gestureStart")).toHaveLength(1);
    expect(wrapper.emitted("gestureEnd")).toHaveLength(1);
  });

  it("keyboard knot追加後は末尾仮定せず実際のlongest segment挿入位置をactiveにする", async () => {
    const scene = generatedRouteScene();
    scene.edges[0]!.routeMode = "curve";
    scene.edges[0]!.curve = {
      knots: [
        { point: { x: 165, y: 74 } },
        { point: { x: 185, y: 82 } },
      ],
    };
    wrapper = mount(DiagramCanvas, {
      attachTo: document.body,
      props: {
        scene,
        selectedElementId: "edge-a-b",
        selectedElementIds: ["edge-a-b"],
      },
    });
    const viewport = wrapper.get(".iriograph-canvas-scroll");
    await viewport.trigger("keydown", { key: "w" });
    const active = wrapper.get(".iriograph-curve-knot.active");
    const previewKnots = wrapper.findAll(".iriograph-curve-knot");
    expect(previewKnots).toHaveLength(3);
    expect(active.element).toBe(previewKnots[2]!.element);
    await viewport.trigger("keyup", { key: "w" });
    expect((lastPayload(wrapper, "routingUpdate") as {
      routing: { curve: { knots: unknown[] } };
    }).routing.curve.knots).toHaveLength(3);
  });

  it("blank canvas dragで矩形内を選択し、Shift追加とstructured複数pickerへ渡す", async () => {
    wrapper = mount(DiagramCanvas, {
      attachTo: document.body,
      props: { scene: sceneFixture() },
    });
    configureViewport(wrapper, 260, 180);
    configureCanvasCoordinates(wrapper);
    const nodeA = wrapper.get<HTMLElement>('[data-element-id="node-a"]');
    const nodeB = wrapper.get<HTMLElement>('[data-element-id="node-b"]');
    const a = elementClientGeometry(nodeA);
    const b = elementClientGeometry(nodeB);

    await wrapper.get(".iriograph-canvas-grid").trigger("pointerdown", {
      button: 0,
      clientX: a.x + 20,
      clientY: a.y + 20,
    });
    dispatchPointer("pointermove", a.x + 60, a.y + 45);
    await flushPreview();
    expect(wrapper.get(".iriograph-selection-marquee").attributes("aria-hidden")).toBe("true");
    dispatchPointer("pointerup", a.x + 60, a.y + 45);
    await flushPreview();
    expect(wrapper.find(".iriograph-selection-marquee").exists()).toBe(false);
    expect(lastPayload<string[]>(wrapper, "selectionSetRequest")).toEqual(["node-a"]);

    await wrapper.setProps({ selectedElementId: "node-a", selectedElementIds: ["node-a"] });
    await wrapper.get(".iriograph-canvas-grid").trigger("pointerdown", {
      button: 0,
      shiftKey: true,
      clientX: b.x + 20,
      clientY: b.y + 20,
    });
    dispatchPointer("pointermove", b.x + 60, b.y + 45);
    dispatchPointer("pointerup", b.x + 60, b.y + 45);
    await flushPreview();
    expect(lastPayload<string[]>(wrapper, "selectionSetRequest")).toEqual(["node-a", "node-b"]);

    await wrapper.setProps({ structuredSelectionPicking: true });
    await wrapper.get(".iriograph-canvas-grid").trigger("pointerdown", {
      button: 0,
      clientX: a.x + 20,
      clientY: a.y + 20,
    });
    dispatchPointer("pointermove", b.x + 60, b.y + 45);
    dispatchPointer("pointerup", b.x + 60, b.y + 45);
    await flushPreview();
    const structured = lastPayload<{
      elementIds: string[];
      mode: string;
    }>(wrapper, "structuredSelectionSetRequest");
    expect(structured?.mode).toBe("replace");
    expect(structured?.elementIds).toEqual(expect.arrayContaining(["node-a", "node-b"]));
  });

  it("領域の内側余白からも枠移動ではなく矩形選択を開始する", async () => {
    const scene = sceneFixture();
    scene.regions = [{
      elementId: "region-a",
      semanticRef: "urn:test:canvas:region-a",
      structuralKind: "region",
      label: "領域A",
      templateRef: "urn:test:template:region",
      style: { fill: "#fff", stroke: "#000", text: "#000" },
      geometry: { x: 0, y: 0, width: 480, height: 280 },
      pinned: false,
      placement: "generated",
    }];
    wrapper = mount(DiagramCanvas, { attachTo: document.body, props: { scene } });
    configureViewport(wrapper, 600, 420);
    configureCanvasCoordinates(wrapper);
    const region = wrapper.get<HTMLElement>('[data-element-id="region-a"]');
    Object.defineProperty(region.element, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        left: 320,
        top: 320,
        right: 800,
        bottom: 600,
        width: 480,
        height: 280,
        x: 320,
        y: 320,
        toJSON: () => ({}),
      }),
    });
    await region.trigger("pointerdown", { button: 0, clientX: 335, clientY: 335 });
    dispatchPointer("pointermove", 380, 390);
    await flushPreview();
    expect(wrapper.find(".iriograph-selection-marquee").exists()).toBe(true);
    dispatchPointer("pointerup", 380, 390);
    await flushPreview();
    expect(lastPayload<string[]>(wrapper, "selectionSetRequest")).toContain("node-a");
    expect(wrapper.emitted("geometryBatchChange")).toBeUndefined();
  });

  it("node本体のdragは矩形選択へ奪わず従来の移動gestureを維持する", async () => {
    wrapper = mount(DiagramCanvas, {
      attachTo: document.body,
      props: { scene: sceneFixture() },
    });
    configureViewport(wrapper, 600, 420);
    configureCanvasCoordinates(wrapper);
    const node = wrapper.get<HTMLElement>('[data-element-id="node-a"]');
    const geometry = elementClientGeometry(node);
    await node.trigger("pointerdown", {
      button: 0,
      clientX: geometry.x + geometry.width - 14,
      clientY: geometry.y + geometry.height - 14,
    });
    dispatchPointer("pointermove", geometry.x + geometry.width + 20, geometry.y + geometry.height + 20);
    dispatchPointer("pointerup", geometry.x + geometry.width + 20, geometry.y + geometry.height + 20);
    await flushPreview();
    expect(wrapper.find(".iriograph-selection-marquee").exists()).toBe(false);
    expect(wrapper.emitted("geometryBatchChange")).toHaveLength(1);
  });

  it("middleまたはAlt+blank drag、Arrow/Page pan、N scene navigationを分離する", async () => {
    wrapper = mount(DiagramCanvas, {
      attachTo: document.body,
      props: { scene: sceneFixture() },
    });
    configureViewport(wrapper, 260, 180);
    const viewport = wrapper.get<HTMLElement>(".iriograph-canvas-scroll");

    await wrapper.get(".iriograph-canvas-grid").trigger("pointerdown", {
      button: 1,
      clientX: 120,
      clientY: 90,
    });
    dispatchPointer("pointermove", 70, 50);
    dispatchPointer("pointerup", 70, 50);

    expect(viewport.element.scrollLeft).toBe(50);
    expect(viewport.element.scrollTop).toBe(40);
    expect(wrapper.emitted("geometryChange")).toBeUndefined();
    expect(wrapper.emitted("gestureStart")).toBeUndefined();

    viewport.element.scrollLeft = 0;
    viewport.element.scrollTop = 0;
    await wrapper.get(".iriograph-canvas-grid").trigger("pointerdown", {
      button: 0,
      altKey: true,
      clientX: 120,
      clientY: 90,
    });
    dispatchPointer("pointermove", 70, 50);
    dispatchPointer("pointerup", 70, 50);
    expect(viewport.element.scrollLeft).toBe(50);
    expect(viewport.element.scrollTop).toBe(40);

    await viewport.trigger("keydown", { key: "ArrowRight" });
    expect(viewport.element.scrollLeft).toBeGreaterThan(50);
    await viewport.trigger("keydown", { key: "n" });
    expect(viewport.attributes("aria-activedescendant")).toContain("node-b");
    viewport.element.scrollTop = 40;
    await viewport.trigger("keydown", { key: "PageDown" });
    expect(viewport.element.scrollTop).toBeGreaterThan(40);
  });

  it("明示drag modeでprimary blank/group interiorをpanへ切替えpicker時はmarqueeを優先する", async () => {
    wrapper = mount(DiagramCanvas, {
      attachTo: document.body,
      props: { scene: sceneFixture(), dragMode: "pan" },
    });
    configureViewport(wrapper, 260, 180);
    configureCanvasCoordinates(wrapper);
    const viewport = wrapper.get<HTMLElement>(".iriograph-canvas-scroll");

    await wrapper.get(".iriograph-canvas-grid").trigger("pointerdown", {
      button: 0,
      clientX: 600,
      clientY: 500,
    });
    dispatchPointer("pointermove", 540, 450);
    dispatchPointer("pointerup", 540, 450);
    expect(viewport.element.scrollLeft).toBe(60);
    expect(viewport.element.scrollTop).toBe(50);
    expect(wrapper.find(".iriograph-selection-marquee").exists()).toBe(false);
    expect(wrapper.emitted("geometryBatchChange")).toBeUndefined();

    await wrapper.setProps({ structuredSelectionPicking: true });
    await wrapper.get(".iriograph-canvas-grid").trigger("pointerdown", {
      button: 0,
      clientX: 330,
      clientY: 350,
    });
    dispatchPointer("pointermove", 760, 560);
    await flushPreview();
    expect(wrapper.find(".iriograph-selection-marquee").exists()).toBe(true);
    dispatchPointer("pointerup", 760, 560);
    expect(lastPayload<{ elementIds: string[] }>(wrapper, "structuredSelectionSetRequest")?.elementIds)
      .toEqual(expect.arrayContaining(["node-a", "node-b"]));
  });

  it("primary node gestureをpanから分離し、middle dragはreadOnlyでもnavigationに使う", async () => {
    wrapper = mount(DiagramCanvas, {
      attachTo: document.body,
      props: { scene: sceneFixture(), readOnly: true },
    });
    configureViewport(wrapper, 260, 180);
    const viewport = wrapper.get<HTMLElement>(".iriograph-canvas-scroll");
    const node = wrapper.get(".iriograph-scene-node");

    await node.trigger("pointerdown", { button: 0, clientX: 100, clientY: 80 });
    dispatchPointer("pointermove", 60, 40);
    dispatchPointer("pointerup", 60, 40);
    expect(viewport.element.scrollLeft).toBe(0);
    expect(wrapper.emitted("geometryChange")).toBeUndefined();

    await node.trigger("pointerdown", { button: 1, clientX: 100, clientY: 80 });
    dispatchPointer("pointermove", 45, 30);
    dispatchPointer("pointerup", 45, 30);
    expect(viewport.element.scrollLeft).toBe(55);
    expect(viewport.element.scrollTop).toBe(50);
    expect(wrapper.emitted("geometryChange")).toBeUndefined();
  });

  it("fit、selection reveal、minimap navigationをsession scroll/zoomだけで行う", async () => {
    let mounted: VueWrapper;
    mounted = mount(DiagramCanvas, {
      attachTo: document.body,
      props: {
        scene: sceneFixture(),
        zoom: 1,
        onZoomChange: (value: number) => mounted.setProps({ zoom: value }),
      },
    });
    wrapper = mounted;
    configureViewport(wrapper, 220, 160);
    const viewport = wrapper.get<HTMLElement>(".iriograph-canvas-scroll");
    const api = wrapper.vm as unknown as DiagramCanvasNavigationApi;

    expect(await api.revealElement("node-b")).toBe(true);
    expect(viewport.element.scrollLeft).toBeGreaterThan(0);
    expect(wrapper.emitted("geometryChange")).toBeUndefined();

    expect(await api.fitToSelection(["node-a", "node-b"])).toBe(true);
    expect(wrapper.emitted("zoomChange")?.at(-1)?.[0]).toBeGreaterThan(0);
    expect(await api.fitToSelection(["missing"])).toBe(false);

    await api.fitToView();
    expect(wrapper.emitted("zoomChange")?.at(-1)?.[0]).toBe(.22);
    expect((wrapper.props() as { zoom: number }).zoom).toBe(.22);
    expect(viewport.element.scrollLeft).toBeCloseTo(68.4);
    expect(viewport.element.scrollTop).toBeCloseTo(65.4);

    await mounted.setProps({ zoom: 1 });
    configureViewport(wrapper, 220, 160);
    const minimap = wrapper.get<SVGSVGElement>(".iriograph-minimap svg");
    minimap.element.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 160,
      bottom: 100,
      width: 160,
      height: 100,
      toJSON: () => undefined,
    });
    await minimap.trigger("pointerdown", { button: 0, clientX: 150, clientY: 90 });
    dispatchPointer("pointerup", 150, 90);
    expect(viewport.element.scrollLeft).toBeGreaterThan(500);
    expect(viewport.element.scrollTop).toBeGreaterThan(300);
    const minimapLeft = viewport.element.scrollLeft;
    await minimap.trigger("keydown", { key: "ArrowLeft" });
    expect(viewport.element.scrollLeft).toBe(minimapLeft - 64);
    expect(wrapper.emitted("geometryChange")).toBeUndefined();
  });

  it("curve edgeのrevealはBezier control hullを含めて膨らみをviewportへ収める", async () => {
    const scene = sceneFixture();
    scene.edges[0]!.routeMode = "curve";
    scene.edges[0]!.curve = { sourceHandle: { x: 0, y: 600 } };
    wrapper = mount(DiagramCanvas, {
      attachTo: document.body,
      props: { scene, zoom: 1 },
    });
    configureViewport(wrapper, 220, 160);
    const viewport = wrapper.get<HTMLElement>(".iriograph-canvas-scroll");
    const api = wrapper.vm as unknown as DiagramCanvasNavigationApi;

    expect(await api.revealElement("edge-a-b")).toBe(true);
    // Route vertices alone center near 390px; the manual handle at y=670
    // expands the cubic hull and therefore moves reveal substantially lower.
    expect(viewport.element.scrollTop).toBeGreaterThan(550);
    expect(wrapper.emitted("geometryChange")).toBeUndefined();
  });

  it("fitは作業余白を除外し負geometryとScene外routeのcontent centerを使う", async () => {
    const scene = sceneFixture();
    scene.nodes[0]!.geometry = { x: -400, y: -200, width: 120, height: 60 };
    scene.edges[0]!.route = [{ x: -340, y: -170 }, { x: 900, y: 600 }];
    let mounted: VueWrapper;
    mounted = mount(DiagramCanvas, {
      attachTo: document.body,
      props: {
        scene,
        zoom: 1,
        onZoomChange: (value: number) => mounted.setProps({ zoom: value }),
      },
    });
    wrapper = mounted;
    configureViewport(wrapper, 220, 160);
    const viewport = wrapper.get<HTMLElement>(".iriograph-canvas-scroll");
    const api = wrapper.vm as unknown as DiagramCanvasNavigationApi;

    await api.fitToView();

    expect(wrapper.emitted("zoomChange")?.at(-1)?.[0]).toBe(.13);
    expect(viewport.element.scrollLeft).toBeCloseTo(36.1);
    expect(viewport.element.scrollTop).toBeCloseTo(33.6);
  });

  it("modifier selectionを通知し、group dragをpreview後に一つのbatchで確定する", async () => {
    wrapper = mount(DiagramCanvas, {
      attachTo: document.body,
      props: {
        scene: sceneFixture(),
        selectedElementId: "node-b",
        selectedElementIds: ["node-a", "node-b"],
      },
    });
    const nodes = wrapper.findAll(".iriograph-scene-node");

    await nodes[0]!.trigger("pointerdown", { button: 0, clientX: 100, clientY: 80 });
    dispatchPointer("pointermove", 113, 91);
    await new Promise<void>((resolve) => queueMicrotask(() => resolve()));

    expect(wrapper.emitted("geometryBatchChange")).toBeUndefined();
    expect((nodes[0]!.element as HTMLElement).style.left).toBe("352px");
    expect((nodes[1]!.element as HTMLElement).style.left).toBe("632px");

    dispatchPointer("pointerup", 113, 91);
    expect(wrapper.emitted("geometryBatchChange")).toEqual([[[
      { elementId: "node-a", geometry: { x: 32, y: 48, width: 120, height: 60 } },
      { elementId: "node-b", geometry: { x: 312, y: 168, width: 120, height: 60 } },
    ]]]);
    expect(wrapper.emitted("geometryChange")).toHaveLength(2);
    expect(wrapper.emitted("gestureStart")).toHaveLength(1);
    expect(wrapper.emitted("gestureEnd")).toHaveLength(1);

    await nodes[0]!.trigger("pointerdown", {
      button: 0,
      ctrlKey: true,
      clientX: 100,
      clientY: 80,
    });
    expect(wrapper.emitted("selectionRequest")?.at(-1)?.[0]).toEqual({
      elementId: "node-a",
      mode: "toggle",
    });
    expect(wrapper.emitted("gestureStart")).toHaveLength(1);
  });

  it("generated routeの単一node drag previewでendpointと隣接segmentを追随する", async () => {
    wrapper = mount(DiagramCanvas, {
      attachTo: document.body,
      props: { scene: generatedRouteScene(), snap: disabledSnap() },
    });

    await wrapper.findAll(".iriograph-scene-node")[0]!.trigger("pointerdown", {
      button: 0,
      clientX: 0,
      clientY: 0,
    });
    dispatchPointer("pointermove", 40, 20);
    await flushPreview();

    const expected = "M 180 90 L 220 90 L 220 190 L 300 190";
    expect(wrapper.get(".iriograph-edge-path").attributes("d")).toBe(expected);
    expect(wrapper.get(".iriograph-minimap-edge").attributes("d")).toBe(expected);
    expect(wrapper.emitted("geometryBatchChange")).toBeUndefined();

    dispatchPointer("pointerup", 40, 20);
  });

  it("generated routeのgroup drag previewではroute全体を共通deltaで移動する", async () => {
    wrapper = mount(DiagramCanvas, {
      attachTo: document.body,
      props: {
        scene: generatedRouteScene(),
        selectedElementId: "node-b",
        selectedElementIds: ["node-a", "node-b"],
        snap: disabledSnap(),
      },
    });

    await wrapper.findAll(".iriograph-scene-node")[0]!.trigger("pointerdown", {
      button: 0,
      clientX: 0,
      clientY: 0,
    });
    dispatchPointer("pointermove", 32, 16);
    await flushPreview();

    const expected = "M 172 86 L 252 86 L 252 206 L 332 206";
    expect(wrapper.get(".iriograph-edge-path").attributes("d")).toBe(expected);
    expect(wrapper.get(".iriograph-minimap-edge").attributes("d")).toBe(expected);
    expect(wrapper.emitted("geometryBatchChange")).toBeUndefined();

    dispatchPointer("pointerup", 32, 16);
  });

  it("manual routeのdrag previewではabsolute waypointを維持してattachmentだけを動かす", async () => {
    wrapper = mount(DiagramCanvas, {
      attachTo: document.body,
      props: { scene: sceneFixture(), snap: disabledSnap() },
    });

    await wrapper.findAll(".iriograph-scene-node")[0]!.trigger("pointerdown", {
      button: 0,
      clientX: 0,
      clientY: 0,
    });
    dispatchPointer("pointermove", 30, 12);
    await flushPreview();

    const expected = "M 170 82 L 140 90 L 300 190";
    expect(wrapper.get(".iriograph-edge-path").attributes("d")).toBe(expected);
    expect(wrapper.get(".iriograph-minimap-edge").attributes("d")).toBe(expected);
    expect(wrapper.emitted("geometryBatchChange")).toBeUndefined();

    dispatchPointer("pointerup", 30, 12);
  });

  it("generated self-loopのnode drag previewではloop全体を追随する", async () => {
    const scene = generatedRouteScene();
    scene.edges[0] = {
      ...scene.edges[0]!,
      sourceElementId: "node-a",
      targetElementId: "node-a",
      route: [
        { x: 140, y: 58 },
        { x: 190, y: 58 },
        { x: 190, y: 82 },
        { x: 140, y: 82 },
      ],
    };
    wrapper = mount(DiagramCanvas, {
      attachTo: document.body,
      props: { scene, snap: disabledSnap() },
    });

    await wrapper.findAll(".iriograph-scene-node")[0]!.trigger("pointerdown", {
      button: 0,
      clientX: 0,
      clientY: 0,
    });
    dispatchPointer("pointermove", 24, 10);
    await flushPreview();

    const expected = "M 164 68 L 214 68 L 214 92 L 164 92";
    expect(wrapper.get(".iriograph-edge-path").attributes("d")).toBe(expected);
    expect(wrapper.get(".iriograph-minimap-edge").attributes("d")).toBe(expected);
    expect(wrapper.emitted("geometryBatchChange")).toBeUndefined();

    dispatchPointer("pointerup", 24, 10);
  });

  it("異なるcontainerのgroup dragを共通許容deltaへclampし、readOnlyでも選択できる", async () => {
    wrapper = mount(DiagramCanvas, {
      attachTo: document.body,
      props: {
        scene: containedSceneFixture(),
        selectedElementId: "node-b",
        selectedElementIds: ["node-a", "node-b"],
        snap: {
          grid: { enabled: false, size: 8 },
          targets: { enabled: false, tolerance: 6 },
        },
      },
    });
    const nodes = wrapper.findAll(".iriograph-scene-node");
    await nodes[0]!.trigger("pointerdown", { button: 0, clientX: 100, clientY: 80 });
    dispatchPointer("pointermove", 200, 80);
    dispatchPointer("pointerup", 200, 80);

    expect(lastPayload<Array<{ elementId: string; geometry: ElementGeometry }>>(
      wrapper,
      "geometryBatchChange",
    )).toEqual([
      { elementId: "node-a", geometry: { x: 74, y: 70, width: 40, height: 30 } },
      { elementId: "node-b", geometry: { x: 544, y: 70, width: 40, height: 30 } },
    ]);

    await wrapper.setProps({ readOnly: true, selectedElementId: "", selectedElementIds: [] });
    await nodes[0]!.trigger("pointerdown", { button: 0, clientX: 100, clientY: 80 });
    expect(wrapper.emitted("selectionRequest")?.at(-1)?.[0]).toEqual({
      elementId: "node-a",
      mode: "replace",
    });
    expect(wrapper.emitted("geometryBatchChange")).toHaveLength(1);
  });

  it("target toleranceをscreen pxからzoom済みcanvas unitへ変換する", async () => {
    wrapper = mount(DiagramCanvas, {
      attachTo: document.body,
      props: {
        scene: sceneFixture(),
        selectedElementId: "node-a",
        selectedElementIds: ["node-a"],
        zoom: 2,
        snap: {
          grid: { enabled: false, size: 8 },
          targets: { enabled: true, tolerance: 6 },
        },
      },
    });
    const node = wrapper.get(".iriograph-scene-node");
    await node.trigger("pointerdown", { button: 0, clientX: 0, clientY: 0 });
    dispatchPointer("pointermove", 312, 0);
    dispatchPointer("pointerup", 312, 0);

    expect(lastPayload<Array<{ elementId: string; geometry: ElementGeometry }>>(
      wrapper,
      "geometryBatchChange",
    )?.[0]?.geometry.x).toBe(176);
  });

  it("Canvas空白clickはposition draftだけをseedしmarkerを表示する", async () => {
    wrapper = mount(DiagramCanvas, {
      attachTo: document.body,
      props: {
        scene: sceneFixture(),
        semanticPositionPicking: true,
        semanticDraftPosition: { x: 88, y: 64 },
      },
    });
    expect(wrapper.get(".iriograph-semantic-position-marker").attributes("style"))
      .toContain("left: 408px");
    const stage = wrapper.get<HTMLElement>(".iriograph-canvas-stage").element;
    stage.getBoundingClientRect = () => ({
      x: 10, y: 20, left: 10, top: 20, right: 1450, bottom: 1160,
      width: 1440, height: 1140, toJSON: () => undefined,
    });
    await wrapper.get(".iriograph-canvas-scroll").trigger("pointerdown", {
      button: 0,
      clientX: 430,
      clientY: 440,
    });
    dispatchPointer("pointerup", 430, 440);
    expect(lastPayload(wrapper, "semanticPositionRequest")).toEqual({ x: 100, y: 100 });
    expect(wrapper.emitted("geometryChange")).toBeUndefined();
    expect(wrapper.emitted("gestureStart")).toBeUndefined();
  });

  it("明示resource picker中だけnode/container clickをsemanticRefへ変換しEscape・Scene置換で解除要求する", async () => {
    wrapper = mount(DiagramCanvas, {
      attachTo: document.body,
      props: {
        scene: sceneFixture(),
        semanticResourcePicking: true,
        semanticResourcePickLabel: "Edge target",
      },
    });
    await wrapper.get(".iriograph-scene-node").trigger("pointerdown", {
      button: 0,
      clientX: 80,
      clientY: 70,
    });
    expect(lastPayload(wrapper, "semanticResourceRequest")).toBe("urn:test:canvas:a");
    expect(wrapper.emitted("selectionRequest")).toBeUndefined();
    expect(wrapper.emitted("geometryChange")).toBeUndefined();

    await wrapper.get(".iriograph-canvas-scroll").trigger("keydown", { key: "Escape" });
    expect(wrapper.emitted("semanticPickCancel")).toHaveLength(1);

    await wrapper.setProps({ scene: { ...sceneFixture(), width: 801 } });
    expect(wrapper.emitted("semanticPickCancel")).toHaveLength(2);
  });

  it("position picker中のcontainer背景clickは位置とcontainer IRIだけをdraft seedとして通知する", async () => {
    wrapper = mount(DiagramCanvas, {
      attachTo: document.body,
      props: { scene: containedSceneFixture(), semanticPositionPicking: true },
    });
    const stage = wrapper.get<HTMLElement>(".iriograph-canvas-stage").element;
    stage.getBoundingClientRect = () => ({
      x: 10, y: 20, left: 10, top: 20, right: 1450, bottom: 1160,
      width: 1440, height: 1140, toJSON: () => undefined,
    });

    await wrapper.get(".iriograph-scene-container").trigger("pointerdown", {
      button: 0,
      clientX: 430,
      clientY: 440,
    });
    expect(wrapper.emitted("semanticPositionRequest")?.at(-1)).toEqual([
      { x: 100, y: 100 },
      "urn:test:canvas:container-a",
    ]);
    expect(wrapper.emitted("geometryChange")).toBeUndefined();
    expect(wrapper.emitted("gestureStart")).toBeUndefined();
  });

  it("readOnlyではposition picking gestureを通知しない", async () => {
    wrapper = mount(DiagramCanvas, {
      attachTo: document.body,
      props: { scene: sceneFixture(), semanticPositionPicking: true, readOnly: true },
    });
    await wrapper.get(".iriograph-canvas-scroll").trigger("pointerdown", {
      button: 0,
      clientX: 100,
      clientY: 80,
    });
    dispatchPointer("pointerup", 100, 80);
    expect(wrapper.emitted("semanticPositionRequest")).toBeUndefined();
  });

  it("pointerとShift+F10のcontext menu要求を対象種別と位置付きで通知する", async () => {
    wrapper = mount(DiagramCanvas, {
      attachTo: document.body,
      props: { scene: sceneFixture() },
    });
    await wrapper.get(".iriograph-scene-node").trigger("contextmenu", {
      clientX: 120,
      clientY: 90,
    });
    expect(wrapper.emitted("contextMenuRequest")?.at(-1)?.[0]).toMatchObject({
      kind: "node",
      elementId: "node-a",
      clientX: 120,
      clientY: 90,
    });

    await wrapper.get(".iriograph-scene-node").trigger("keydown", {
      key: "F10",
      shiftKey: true,
    });
    expect(wrapper.emitted("contextMenuRequest")?.at(-1)?.[0]).toMatchObject({
      kind: "node",
      elementId: "node-a",
    });
  });

  it("Seq/Alt guideのpointerとkeyboard context要求はguide identityとgroup identityを保持する", async () => {
    const scene = sceneFixture();
    scene.groupGuides = [{
      guideId: "guide-seq-1",
      groupElementId: "container-seq",
      kind: "sequence-order",
      sourceElementId: "node-a",
      targetElementId: "node-b",
      ordinal: 1,
      muted: true,
      provenance: {
        sourceStatementRefs: ["urn:test:seq:_1"],
        operator: "ordinal-sequence",
        derivation: "derived",
      },
    }];
    scene.containers.push({
      elementId: "container-seq",
      semanticRef: "urn:test:seq",
      structuralKind: "container",
      groupRole: "sequence",
      groupFrame: {
        kind: "sequence",
        semanticRef: "urn:test:seq",
        provenance: {
          sourceStatementRefs: ["urn:test:seq:type"],
          operator: "ordinal-sequence",
          derivation: "resource",
        },
      },
      label: "順序",
      templateRef: "urn:test:template:container",
      geometry: { x: 20, y: 20, width: 440, height: 220 },
      headerPosition: "top",
      style: { fill: "#fff", stroke: "#222", text: "#111" },
      pinned: false,
      placement: "generated",
    });
    wrapper = mount(DiagramCanvas, { attachTo: document.body, props: { scene } });
    const guide = wrapper.get(".iriograph-group-guide");
    await guide.trigger("contextmenu", { clientX: 160, clientY: 100 });
    expect(wrapper.emitted("contextMenuRequest")?.at(-1)?.[0]).toMatchObject({
      origin: "pointer",
      guide: { guideId: "guide-seq-1", groupElementId: "container-seq", kind: "sequence-order" },
    });
    await guide.trigger("keydown", { key: "F10", shiftKey: true });
    expect(wrapper.emitted("contextMenuRequest")?.at(-1)?.[0]).toMatchObject({
      origin: "keyboard",
      guide: { guideId: "guide-seq-1", groupElementId: "container-seq", kind: "sequence-order" },
    });
  });

  it("structured pickerはresource IRIでなくexact elementIdとmulti selection modeを返す", async () => {
    wrapper = mount(DiagramCanvas, {
      attachTo: document.body,
      props: { scene: sceneFixture(), structuredSelectionPicking: true },
    });
    await wrapper.get(".iriograph-scene-node").trigger("pointerdown", {
      button: 0,
      clientX: 100,
      clientY: 80,
      shiftKey: true,
    });
    expect(wrapper.emitted("structuredSelectionRequest")?.at(-1)).toEqual([{
      elementId: "node-a",
      mode: "add",
    }]);
    expect(wrapper.emitted("semanticResourceRequest")).toBeUndefined();
    expect(wrapper.emitted("geometryChange")).toBeUndefined();
  });

  it("region選択中の位置指定はregion IRIを包含候補として通知する", async () => {
    const scene = sceneFixture();
    scene.regions = [{
      elementId: "region-a",
      semanticRef: "urn:test:canvas:region-a",
      structuralKind: "region",
      label: "Region A",
      templateRef: "urn:test:template:region",
      style: { fill: "#eeeeee", stroke: "#555555", text: "#111111", fillOpacity: .25 },
      geometry: { x: 40, y: 30, width: 300, height: 200 },
      pinned: false,
      placement: "generated",
    }];
    wrapper = mount(DiagramCanvas, {
      attachTo: document.body,
      props: { scene, semanticPositionPicking: true },
    });
    wrapper.get<HTMLElement>(".iriograph-canvas-stage").element.getBoundingClientRect = () => ({
      x: 10, y: 20, left: 10, top: 20, right: 1450, bottom: 1160,
      width: 1440, height: 1140, toJSON: () => undefined,
    });
    await wrapper.get(".iriograph-scene-region").trigger("pointerdown", {
      button: 0,
      clientX: 480,
      clientY: 460,
    });
    expect(wrapper.emitted("semanticPositionRequest")?.at(-1)).toEqual([
      { x: 150, y: 120 },
      "urn:test:canvas:region-a",
    ]);
  });

  it("複数instanceでSVG arrow marker idを衝突させない", () => {
    const host = mount(defineComponent(() => () => h("div", [
      h(DiagramCanvas, { scene: sceneFixture() }),
      h(DiagramCanvas, { scene: sceneFixture() }),
    ])));
    const canvases = host.findAllComponents(DiagramCanvas);
    const ids = canvases.map((canvas) => canvas.get("marker").attributes("id"));
    expect(new Set(ids).size).toBe(2);
    canvases.forEach((canvas, index) => {
      expect(canvas.get(".iriograph-edge-path").attributes("marker-end"))
        .toBe(`url(#${ids[index]})`);
    });
  });

  it("curveは一つのcubic pathでguide routeを反映しterminal markerと複数label/commentを表示する", async () => {
    const scene = generatedRouteScene();
    scene.edges[0]!.routeMode = "curve";
    scene.edges[0]!.sourceMarker = "diamond";
    scene.edges[0]!.targetMarker = "circle";
    wrapper = mount(DiagramCanvas, {
      props: {
        scene,
        semanticMetadata: {
          "urn:test:canvas:a": {
            labels: [{ value: "A", language: "ja" }, { value: "別名A", language: "ja" }],
            comments: [{ value: "一行目\n二行目", language: "ja" }],
          },
        },
      },
    });
    const path = wrapper.get(".iriograph-edge-path");
    expect(path.attributes("d")).toMatch(/^M .* C /u);
    expect(path.attributes("d")).not.toMatch(/[LQ]/u);
    expect(path.attributes("marker-start")).toMatch(/diamond/u);
    expect(path.attributes("marker-end")).toMatch(/circle/u);
    expect(wrapper.get(".iriograph-additional-labels").text()).toContain("別名A");
    expect(wrapper.get(".iriograph-comment-callout").text()).toContain("一行目\n二行目");
    expect(wrapper.get(".iriograph-comment-callout").classes()).not.toContain("visible");
    await wrapper.setProps({ showAllComments: true });
    expect(wrapper.get(".iriograph-comment-callout").classes()).toContain("visible");
  });

  it("Scene regionのlabelPlacementをprop未指定時の表示へ反映する", () => {
    const scene = sceneFixture();
    scene.regions = [{
      elementId: "region-a",
      semanticRef: "urn:test:ClassA",
      structuralKind: "region",
      label: "A",
      labelPlacement: "right",
      templateRef: "urn:test:region",
      geometry: { x: 0, y: 0, width: 250, height: 220 },
      style: { fill: "#fff", stroke: "#000", text: "#000" },
      pinned: false,
      placement: "generated",
    }];
    wrapper = mount(DiagramCanvas, { props: { scene } });
    expect(wrapper.get(".iriograph-region-label").classes()).toContain("label-right");
  });

  it("region labelを枠線上でdragし、z-order順に領域を描画する", async () => {
    const scene = sceneFixture();
    const region = {
      elementId: "region-a",
      semanticRef: "urn:test:ClassA",
      structuralKind: "region" as const,
      label: "A",
      templateRef: "urn:test:region",
      geometry: { x: 0, y: 0, width: 250, height: 220 },
      style: { fill: "#fff", stroke: "#000", text: "#000" },
      pinned: false,
      placement: "generated" as const,
      regionLabelAnchor: 0,
      regionZOrder: 2,
    };
    scene.regions = [region, {
      ...region,
      elementId: "region-b",
      semanticRef: "urn:test:ClassB",
      label: "B",
      regionZOrder: 1,
    }];
    wrapper = mount(DiagramCanvas, {
      attachTo: document.body,
      props: { scene },
    });
    wrapper.get<HTMLElement>(".iriograph-canvas-stage").element.getBoundingClientRect = () => ({
      x: 0, y: 0, left: 0, top: 0, right: 1440, bottom: 1140,
      width: 1440, height: 1140, toJSON: () => undefined,
    });

    expect(wrapper.findAll(".iriograph-scene-region").map((item) => item.attributes("data-element-id")))
      .toEqual(["region-b", "region-a"]);
    expect(wrapper.get('[data-element-id="region-a"] .iriograph-region-label').attributes("style"))
      .toContain("left: 0px");

    await wrapper.get('[data-element-id="region-a"] .iriograph-region-label').trigger("pointerdown", {
      button: 0,
      clientX: 320,
      clientY: 320,
    });
    dispatchPointer("pointermove", 570, 430);
    dispatchPointer("pointerup", 570, 430);

    expect(lastPayload<{ elementId: string; anchor: number }>(wrapper, "regionLabelUpdate"))
      .toEqual({ elementId: "region-a", anchor: 360 / 940 });
    expect(wrapper.emitted("gestureStart")).toHaveLength(1);
    expect(wrapper.emitted("gestureEnd")).toHaveLength(1);
  });

  it("選択中regionだけをinteraction前面へ上げ、選択解除時に永続順へ戻す", async () => {
    const scene = sceneFixture();
    const region = {
      elementId: "region-a",
      semanticRef: "urn:test:ClassA",
      structuralKind: "region" as const,
      label: "A",
      templateRef: "urn:test:region",
      geometry: { x: 0, y: 0, width: 250, height: 220 },
      style: { fill: "#fff", stroke: "#000", text: "#000" },
      pinned: false,
      placement: "generated" as const,
      regionZOrder: 1,
    };
    scene.regions = [region, {
      ...region,
      elementId: "region-b",
      semanticRef: "urn:test:ClassB",
      label: "B",
      regionZOrder: 2,
    }];
    wrapper = mount(DiagramCanvas, {
      props: { scene, selectedElementId: "region-a", selectedElementIds: ["region-a"] },
    });

    const regionA = wrapper.get('[data-element-id="region-a"]');
    expect(regionA.classes()).toContain("interaction-front");
    expect(wrapper.findAll(".iriograph-transient-resize-layer .iriograph-resize-handle"))
      .toHaveLength(8);
    expect(wrapper.findAll(".iriograph-scene-region").map((item) => item.attributes("data-element-id")))
      .toEqual(["region-a", "region-b"]);
    expect(scene.regions[0]!.regionZOrder).toBe(1);

    await wrapper.setProps({ selectedElementId: "", selectedElementIds: [] });
    expect(wrapper.get('[data-element-id="region-a"]').classes()).not.toContain("interaction-front");
    expect(scene.regions[0]!.regionZOrder).toBe(1);
  });

  it("node labelの改行をCanvas文字列として保持する", () => {
    const scene = sceneFixture();
    scene.nodes[0]!.label = "受付\n担当確認";
    wrapper = mount(DiagramCanvas, { props: { scene } });
    expect(wrapper.get(".iriograph-node-label").text()).toBe("受付\n担当確認");
  });

  it("membership-regionのnode dragを複数領域のintersection内へclampする", async () => {
    const scene = sceneFixture();
    const provenance = {
      sourceStatementRefs: ["urn:test:membership"],
      operator: "membership-region" as const,
      derivation: "direct" as const,
    };
    scene.edges = [];
    scene.nodes = [{ ...scene.nodes[0]!, geometry: { x: 120, y: 90, width: 40, height: 30 } }];
    scene.regions = [
      { elementId: "region-a", semanticRef: "urn:test:ClassA", structuralKind: "region", label: "A", templateRef: "urn:test:region", geometry: { x: 0, y: 0, width: 250, height: 220 }, style: { fill: "#fff", stroke: "#000", text: "#000" }, pinned: false, placement: "generated", provenance },
      { elementId: "region-b", semanticRef: "urn:test:ClassB", structuralKind: "region", label: "B", templateRef: "urn:test:region", geometry: { x: 100, y: 50, width: 250, height: 220 }, style: { fill: "#fff", stroke: "#000", text: "#000" }, pinned: false, placement: "generated", provenance },
    ];
    scene.memberships = [
      { semanticRef: "urn:test:m1", containerElementId: "region-a", memberElementId: "node-a", regionElementId: "region-a", provenance },
      { semanticRef: "urn:test:m2", containerElementId: "region-b", memberElementId: "node-a", regionElementId: "region-b", provenance },
    ];
    wrapper = mount(DiagramCanvas, { attachTo: document.body, props: { scene, snap: disabledSnap() } });
    await wrapper.get(".iriograph-scene-node").trigger("pointerdown", { button: 0, clientX: 120, clientY: 90 });
    dispatchPointer("pointermove", 520, 90);
    dispatchPointer("pointerup", 520, 90);
    expect(lastPayload<{ elementId: string; geometry: ElementGeometry }>(wrapper, "geometryChange"))
      .toMatchObject({ elementId: "node-a", geometry: { x: 210, y: 90, width: 40, height: 30 } });
  });

  it("node dragが一方のregion内でも他方から外れる場合はintersection境界で止める", async () => {
    const scene = sceneFixture();
    const provenance = {
      sourceStatementRefs: ["urn:test:membership"],
      operator: "membership-region" as const,
      derivation: "direct" as const,
    };
    scene.edges = [];
    scene.nodes = [{ ...scene.nodes[0]!, geometry: { x: 120, y: 90, width: 40, height: 30 } }];
    scene.regions = [
      { elementId: "region-a", semanticRef: "urn:test:ClassA", structuralKind: "region", label: "A", templateRef: "urn:test:region", geometry: { x: 0, y: 0, width: 250, height: 220 }, style: { fill: "#fff", stroke: "#000", text: "#000" }, pinned: false, placement: "generated", provenance },
      { elementId: "region-b", semanticRef: "urn:test:ClassB", structuralKind: "region", label: "B", templateRef: "urn:test:region", geometry: { x: 100, y: 50, width: 250, height: 220 }, style: { fill: "#fff", stroke: "#000", text: "#000" }, pinned: false, placement: "generated", provenance },
    ];
    scene.memberships = [
      { semanticRef: "urn:test:m1", containerElementId: "region-a", memberElementId: "node-a", regionElementId: "region-a", provenance },
      { semanticRef: "urn:test:m2", containerElementId: "region-b", memberElementId: "node-a", regionElementId: "region-b", provenance },
    ];
    wrapper = mount(DiagramCanvas, { attachTo: document.body, props: { scene, snap: disabledSnap() } });

    await wrapper.get(".iriograph-scene-node").trigger("pointerdown", { button: 0, clientX: 120, clientY: 90 });
    dispatchPointer("pointermove", 40, 90);
    dispatchPointer("pointerup", 40, 90);

    expect(lastPayload<{ elementId: string; geometry: ElementGeometry }>(wrapper, "geometryChange"))
      .toMatchObject({ elementId: "node-a", geometry: { x: 100, y: 90, width: 40, height: 30 } });
  });

  it("Seqを共通frame・ordinal badge・無記名guideで通常edgeから分ける", async () => {
    const scene = sceneFixture();
    scene.edges = [];
    scene.containers = [{
      elementId: "sequence-a",
      semanticRef: "urn:test:seq",
      structuralKind: "container",
      groupRole: "sequence",
      groupFrame: {
        kind: "sequence",
        semanticRef: "urn:test:seq",
        provenance: { operator: "ordinal-sequence", derivation: "resource", sourceStatementRefs: [] },
      },
      label: "審査手順",
      templateRef: "urn:test:template:sequence",
      headerPosition: "top",
      style: { fill: "#fff", stroke: "#64748b", text: "#334155", dash: "5 5", labelFontSize: 21 },
      geometry: { x: 8, y: 8, width: 480, height: 180 },
      pinned: false,
      placement: "generated",
    }];
    scene.nodes[0]!.parentElementId = "sequence-a";
    scene.nodes[1]!.parentElementId = "sequence-a";
    scene.memberships = [{
      semanticRef: "urn:test:seq-1",
      containerElementId: "sequence-a",
      memberElementId: "node-a",
      role: "sequence-member",
      ordinal: 1,
      provenance: {
        operator: "ordinal-sequence",
        derivation: "derived",
        sourceStatementRefs: ["urn:test:seq-1"],
      },
    }, {
      semanticRef: "urn:test:seq-2",
      containerElementId: "sequence-a",
      memberElementId: "node-b",
      role: "sequence-member",
      ordinal: 2,
      provenance: {
        operator: "ordinal-sequence",
        derivation: "derived",
        sourceStatementRefs: ["urn:test:seq-2"],
      },
    }];
    scene.groupGuides = [{
      guideId: "urn:test:seq-guide",
      groupElementId: "sequence-a",
      kind: "sequence-order",
      sourceElementId: "node-a",
      targetElementId: "node-b",
      ordinal: 2,
      muted: true,
      provenance: {
        operator: "ordinal-sequence",
        derivation: "derived",
        sourceStatementRefs: ["urn:test:seq-1", "urn:test:seq-2"],
      },
    }];
    wrapper = mount(DiagramCanvas, {
      props: {
        scene,
        selectedElementId: "sequence-a",
        selectedElementIds: ["sequence-a"],
      },
    });
    expect(wrapper.get(".iriograph-scene-container").classes()).toEqual(expect.arrayContaining([
      "sequence-group",
      "interaction-front",
    ]));
    expect(wrapper.find(".iriograph-container-header .iriograph-group-kind-label").exists())
      .toBe(false);
    expect(wrapper.get(".iriograph-container-header .iriograph-group-frame-label-text").text())
      .toBe("審査手順");
    expect(wrapper.get(".iriograph-container-header").attributes("title")).toContain("順番グループ");
    expect(wrapper.get(".iriograph-container-header").attributes("style")).toContain("font-size: 21px");
    expect(wrapper.get('[role="tooltip"]').text()).toBe("順番グループ");
    expect(wrapper.get('.iriograph-scene-node .iriograph-sequence-badges').text()).toBe("1");
    expect(wrapper.findAll('.iriograph-scene-node .iriograph-sequence-badges')[1]!.text()).toBe("2");
    expect(wrapper.get(".iriograph-group-guide-path").attributes("d")).toMatch(/^M /u);
    expect(wrapper.get(".iriograph-group-guide-path").attributes("marker-end")).toMatch(/^url\(#/u);
    expect(wrapper.find(".iriograph-edge-label").exists()).toBe(false);
    expect(wrapper.find(".iriograph-edge-group").exists()).toBe(false);
    await wrapper.get(".iriograph-group-guide").trigger("click");
    expect(lastPayload(wrapper, "selectionRequest")).toEqual({
      elementId: "sequence-a",
      mode: "preserve",
    });
  });

  it("Altを候補グループframe・virtual hub・無記名candidate guideとして描く", async () => {
    const scene = sceneFixture();
    scene.edges = [];
    scene.containers = [{
      elementId: "alternative-a",
      semanticRef: "urn:test:alt",
      structuralKind: "container",
      groupRole: "alternative",
      groupFrame: {
        kind: "alternative",
        semanticRef: "urn:test:alt",
        provenance: { operator: "alternative", derivation: "resource", sourceStatementRefs: [] },
        hub: { elementId: "alternative-a:hub", role: "alternative-hub" },
        defaultMember: {
          ordinal: 1,
          memberElementId: "node-a",
          statementRef: "urn:test:alt-1",
          provenance: { operator: "alternative", derivation: "derived", sourceStatementRefs: [] },
        },
      },
      label: "非常に長い配送方法の選択肢グループ名称",
      templateRef: "urn:test:template:alternative",
      headerPosition: "top",
      style: { fill: "#fff", stroke: "#64748b", text: "#334155", dash: "5 5" },
      geometry: { x: 8, y: 8, width: 150, height: 240 },
      pinned: false,
      placement: "generated",
    }];
    scene.groupGuides = scene.nodes.map((node, index) => ({
      guideId: `urn:test:alt-guide-${index}`,
      groupElementId: "alternative-a",
      kind: "alternative-candidate" as const,
      sourceElementId: "alternative-a:hub",
      targetElementId: node.elementId,
      ordinal: index + 1,
      muted: true as const,
      provenance: { operator: "alternative" as const, derivation: "derived" as const, sourceStatementRefs: [] },
    }));
    wrapper = mount(DiagramCanvas, { props: { scene } });

    expect(wrapper.find(".iriograph-group-kind-label").exists()).toBe(false);
    expect(wrapper.get(".iriograph-group-frame-label-text").text())
      .toBe("非常に長い配送方法の選択肢グループ名称");
    expect(wrapper.get(".iriograph-container-header").attributes("title"))
      .toContain("分岐グループ");
    expect(wrapper.findAll(".iriograph-group-guide")).toHaveLength(2);
    expect(wrapper.findAll(".iriograph-alternative-hub")).toHaveLength(1);
    expect(wrapper.get('[data-element-id="node-a"] .iriograph-alternative-default-badges').text())
      .toBe("既定");
    expect(wrapper.findAll(".iriograph-group-guide-path").every((path) => (
      path.attributes("marker-end") === undefined
    ))).toBe(true);
    expect(wrapper.find(".iriograph-edge-group").exists()).toBe(false);
    await wrapper.get(".iriograph-alternative-hub").trigger("click");
    expect(lastPayload(wrapper, "selectionRequest")).toEqual({
      elementId: "alternative-a",
      mode: "replace",
    });
  });

  it("空のBag container/classification regionも選択可能な共通構造層と8 resize handleで保つ", () => {
    const scene = sceneFixture();
    scene.edges = [];
    scene.containers = [{
      elementId: "membership-frame",
      semanticRef: "urn:test:membership",
      structuralKind: "container" as const,
      groupRole: "membership" as const,
      groupFrame: {
        kind: "membership" as const,
        semanticRef: "urn:test:membership",
        provenance: { operator: "membership-container" as const, derivation: "resource" as const, sourceStatementRefs: [] },
      },
      label: "空の領域",
      templateRef: "urn:test:template:container",
      headerPosition: "top" as const,
      style: { fill: "#fff", stroke: "#64748b", text: "#334155" },
      geometry: { x: 10, y: 10, width: 180, height: 120 },
      pinned: false,
      placement: "generated" as const,
    }];
    scene.regions = [{
      elementId: "classification-frame",
      semanticRef: "urn:test:classification",
      structuralKind: "region",
      groupFrame: {
        kind: "classification",
        semanticRef: "urn:test:classification",
        provenance: { operator: "membership-region", derivation: "resource", sourceStatementRefs: [] },
      },
      label: "空の分類",
      templateRef: "urn:test:template:region",
      style: { fill: "#fff", stroke: "#64748b", text: "#334155" },
      geometry: { x: 100, y: 40, width: 180, height: 120 },
      pinned: false,
      placement: "generated",
    }];
    wrapper = mount(DiagramCanvas, {
      props: {
        scene,
        selectedElementId: "classification-frame",
        selectedElementIds: ["classification-frame"],
      },
    });

    expect(wrapper.findAll(".iriograph-scene-container.group-frame")).toHaveLength(1);
    expect(wrapper.findAll(".iriograph-scene-region.group-frame.classification-group")).toHaveLength(1);
    expect(wrapper.get(".iriograph-scene-container.group-frame .iriograph-group-frame-label").text())
      .toContain("空の領域");
    expect(wrapper.get(".iriograph-scene-region.group-frame .iriograph-group-frame-label").text())
      .toContain("空の分類");
    const selected = wrapper.get('[data-element-id="classification-frame"]');
    expect(selected.classes()).toContain("interaction-front");
    expect(selected.attributes("role")).toBe("option");
    expect(selected.attributes("aria-label")).toContain("空の分類");
    expect(selected.attributes("aria-description")).toContain("分類グループ");
    expect(selected.attributes("aria-describedby")).toContain("group-description");
    expect(wrapper.findAll(".iriograph-resize-handle")).toHaveLength(8);
  });

  it("Group Frame内部click/right clickは選択状態より保存z-orderを優先しnode/edge hitを奪わない", async () => {
    const scene = sceneFixture();
    const frame = {
      elementId: "frame-back",
      semanticRef: "urn:test:frame:back",
      structuralKind: "container" as const,
      groupRole: "membership" as const,
      groupFrame: {
        kind: "membership" as const,
        semanticRef: "urn:test:frame:back",
        provenance: { operator: "membership-container" as const, derivation: "resource" as const, sourceStatementRefs: [] },
      },
      label: "背面",
      templateRef: "urn:test:group",
      headerPosition: "top" as const,
      style: { fill: "transparent", stroke: "#555", text: "#222" },
      geometry: { x: 0, y: 0, width: 500, height: 300 },
      pinned: false,
      placement: "generated" as const,
      groupZOrder: 1,
    };
    scene.containers = [frame];
    scene.regions = [{
      ...frame,
      elementId: "frame-front",
      semanticRef: "urn:test:frame:front",
      structuralKind: "region",
      label: "前面",
      groupFrame: {
        kind: "classification",
        semanticRef: "urn:test:frame:front",
        provenance: { operator: "membership-region", derivation: "resource", sourceStatementRefs: [] },
      },
      groupZOrder: 2,
    }];
    wrapper = mount(DiagramCanvas, {
      attachTo: document.body,
      props: {
        scene,
        selectedElementId: "frame-back",
        selectedElementIds: ["frame-back"],
      },
    });
    configureCanvasCoordinates(wrapper);

    await wrapper.get(".iriograph-canvas-grid").trigger("pointerdown", {
      button: 0,
      clientX: 520,
      clientY: 410,
    });
    dispatchPointer("pointerup", 520, 410);
    expect(lastPayload(wrapper, "selectionRequest")).toEqual({
      elementId: "frame-front",
      mode: "replace",
    });

    await wrapper.get(".iriograph-canvas-grid").trigger("contextmenu", {
      button: 2,
      clientX: 520,
      clientY: 410,
    });
    expect(lastPayload<{ kind: string; elementId: string }>(wrapper, "contextMenuRequest"))
      .toMatchObject({ kind: "region", elementId: "frame-front" });

    await wrapper.setProps({ selectedElementId: undefined, selectedElementIds: [] });
    await wrapper.get(".iriograph-canvas-grid").trigger("pointerdown", {
      button: 0,
      clientX: 520,
      clientY: 410,
    });
    dispatchPointer("pointerup", 520, 410);
    expect(lastPayload(wrapper, "selectionRequest")).toEqual({
      elementId: "frame-front",
      mode: "replace",
    });

    await wrapper.get('[data-element-id="node-a"]').trigger("pointerdown", { button: 0, clientX: 350, clientY: 370 });
    dispatchPointer("pointerup", 350, 370);
    expect(lastPayload(wrapper, "selectionRequest")).toMatchObject({ elementId: "node-a" });
  });

  it.each(["select", "pan"] as const)(
    "選択済みGroup Frame内部dragは%s modeでもmulti-selectionのgeometry移動を優先する",
    async (dragMode) => {
      const scene = groupFrameSceneFixture();
      wrapper = mount(DiagramCanvas, {
        attachTo: document.body,
        props: {
          scene,
          dragMode,
          snap: disabledSnap(),
          selectedElementId: "frame",
          selectedElementIds: ["frame", "node-b"],
        },
      });
      configureCanvasCoordinates(wrapper);
      const viewport = wrapper.get<HTMLElement>(".iriograph-canvas-scroll");

      await wrapper.get(".iriograph-diagram-canvas").trigger("pointerdown", {
        button: 0,
        clientX: 520,
        clientY: 560,
      });
      dispatchPointer("pointermove", 560, 590);
      dispatchPointer("pointerup", 560, 590);
      await flushPreview();

      expect(lastPayload<Array<{ elementId: string; geometry: ElementGeometry }>>(
        wrapper,
        "geometryBatchChange",
      )).toEqual(expect.arrayContaining([
        { elementId: "frame", geometry: { x: 40, y: 30, width: 500, height: 300 } },
        { elementId: "node-b", geometry: { x: 340, y: 190, width: 120, height: 60 } },
      ]));
      expect(wrapper.find(".iriograph-selection-marquee").exists()).toBe(false);
      expect(viewport.element.scrollLeft).toBe(0);
      expect(viewport.element.scrollTop).toBe(0);
      expect(wrapper.emitted("gestureStart")).toHaveLength(1);
      expect(wrapper.emitted("gestureEnd")).toHaveLength(1);
    },
  );

  it("未選択Group Frame内部はclick選択を保ち、dragはmodeどおりmarqueeまたはpanに渡す", async () => {
    wrapper = mount(DiagramCanvas, {
      attachTo: document.body,
      props: { scene: groupFrameSceneFixture(), snap: disabledSnap() },
    });
    configureViewport(wrapper, 800, 650);
    configureCanvasCoordinates(wrapper);
    const viewport = wrapper.get<HTMLElement>(".iriograph-canvas-scroll");
    const canvas = wrapper.get(".iriograph-diagram-canvas");

    await canvas.trigger("pointerdown", { button: 0, clientX: 520, clientY: 560 });
    dispatchPointer("pointerup", 520, 560);
    expect(lastPayload(wrapper, "selectionRequest")).toEqual({
      elementId: "frame",
      mode: "replace",
    });

    await canvas.trigger("pointerdown", { button: 0, clientX: 520, clientY: 560 });
    dispatchPointer("pointermove", 560, 590);
    await flushPreview();
    expect(wrapper.find(".iriograph-selection-marquee").exists()).toBe(true);
    dispatchPointer("pointerup", 560, 590);
    expect(wrapper.emitted("geometryBatchChange")).toBeUndefined();

    await wrapper.setProps({ dragMode: "pan" });
    await canvas.trigger("pointerdown", { button: 0, clientX: 520, clientY: 560 });
    dispatchPointer("pointermove", 480, 530);
    dispatchPointer("pointerup", 480, 530);
    expect(viewport.element.scrollLeft).toBe(40);
    expect(viewport.element.scrollTop).toBe(30);
    expect(wrapper.emitted("geometryBatchChange")).toBeUndefined();
  });

  it("選択済みGroup Frameより前面のnode dragを優先しFrame gestureを開始しない", async () => {
    wrapper = mount(DiagramCanvas, {
      attachTo: document.body,
      props: {
        scene: groupFrameSceneFixture(),
        dragMode: "pan",
        snap: disabledSnap(),
        selectedElementId: "frame",
        selectedElementIds: ["frame"],
      },
    });

    await wrapper.get('[data-element-id="node-a"]').trigger("pointerdown", {
      button: 0,
      clientX: 360,
      clientY: 380,
    });
    dispatchPointer("pointermove", 390, 400);
    dispatchPointer("pointerup", 390, 400);

    const changes = lastPayload<Array<{ elementId: string; geometry: ElementGeometry }>>(
      wrapper,
      "geometryBatchChange",
    );
    expect(changes).toEqual([
      { elementId: "node-a", geometry: { x: 50, y: 60, width: 120, height: 60 } },
    ]);
    expect(changes?.some((change) => change.elementId === "frame")).toBe(false);
  });

  it.each(["select", "pan"] as const)(
    "完全なCanvas空白の単clickだけが%s modeの選択を解除する",
    async (dragMode) => {
      wrapper = mount(DiagramCanvas, {
        attachTo: document.body,
        props: {
          scene: groupFrameSceneFixture(),
          dragMode,
          selectedElementId: "node-a",
          selectedElementIds: ["node-a"],
        },
      });
      configureCanvasCoordinates(wrapper);
      configureViewport(wrapper, 800, 650);

      await wrapper.get(".iriograph-diagram-canvas").trigger("pointerdown", {
        button: 0,
        clientX: 520,
        clientY: 640,
      });
      dispatchPointer("pointermove", 518, 638);
      dispatchPointer("pointerup", 518, 638);
      expect(lastPayload(wrapper, "selectionRequest")).toEqual({
        elementId: "",
        mode: "replace",
      });
      const viewport = wrapper.get<HTMLElement>(".iriograph-canvas-scroll");
      expect(viewport.element.scrollLeft).toBe(0);
      expect(viewport.element.scrollTop).toBe(0);
      const selectionRequestCount = wrapper.emitted("selectionRequest")?.length;

      document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
      document.body.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0 }));
      expect(wrapper.emitted("selectionRequest")).toHaveLength(selectionRequestCount ?? 0);
      expect(wrapper.emitted("geometryBatchChange")).toBeUndefined();
    },
  );

  it("Group Frame名称dragを内外bandへ正規化しmember衝突を警告してmembershipを変えない", async () => {
    const scene = sceneFixture();
    scene.edges = [];
    scene.containers = [{
      elementId: "frame",
      semanticRef: "urn:test:frame",
      structuralKind: "container",
      groupRole: "membership",
      groupFrame: {
        kind: "membership",
        semanticRef: "urn:test:frame",
        provenance: { operator: "membership-container", derivation: "resource", sourceStatementRefs: [] },
      },
      label: "担当領域",
      templateRef: "urn:test:group",
      headerPosition: "top",
      style: { fill: "transparent", stroke: "#555", text: "#222", labelFontSize: 21 },
      geometry: { x: 0, y: 0, width: 500, height: 300 },
      pinned: false,
      placement: "generated",
    }];
    scene.nodes[0]!.parentElementId = "frame";
    const originalMemberships = structuredClone(scene.memberships);
    wrapper = mount(DiagramCanvas, { attachTo: document.body, props: { scene } });
    configureCanvasCoordinates(wrapper);
    const label = wrapper.get(".iriograph-group-frame-label");
    await label.trigger("pointerdown", { button: 0, clientX: 570, clientY: 320 });
    dispatchPointer("pointermove", 350, 370);
    dispatchPointer("pointerup", 350, 370);
    const placement = lastPayload<{ anchor: number; offset?: number }>(wrapper, "groupLabelUpdate")!;
    expect(placement.offset).toBeGreaterThan(0);
    expect(placement.offset).toBeLessThanOrEqual(1);
    expect(scene.memberships).toEqual(originalMemberships);

    scene.containers[0]!.groupLabelAnchor = placement.anchor;
    scene.containers[0]!.groupLabelOffset = placement.offset;
    await wrapper.setProps({ scene: structuredClone(scene) });
    expect(wrapper.get(".iriograph-group-frame-label").attributes("style")).toContain("top:");
    expect(wrapper.find(".iriograph-group-label-collision").exists()).toBe(true);
  });

  it("Group Frame iconをnatural aspect・scale・fallbackで描画しheader内dragだけを通知する", async () => {
    const scene = sceneFixture();
    scene.containers = [{
      elementId: "frame",
      semanticRef: "urn:test:frame",
      structuralKind: "container",
      groupRole: "sequence",
      groupFrame: {
        kind: "sequence",
        semanticRef: "urn:test:frame",
        provenance: { operator: "ordinal-sequence", derivation: "resource", sourceStatementRefs: [] },
      },
      label: "手順",
      templateRef: "urn:test:group",
      headerPosition: "top",
      iconRef: "urn:test:icon",
      iconUrl: "data:image/svg+xml,%3Csvg/%3E",
      iconIntrinsicSize: { width: 48, height: 24, aspectRatio: 2, source: "svg-view-box" },
      groupIconScale: 1.5,
      style: { fill: "transparent", stroke: "#555", text: "#222", labelFontSize: 21 },
      geometry: { x: 0, y: 0, width: 500, height: 300 },
      pinned: false,
      placement: "generated",
    }];
    wrapper = mount(DiagramCanvas, { attachTo: document.body, props: { scene, zoom: 2 } });
    const icon = wrapper.get(".iriograph-group-frame-icon");
    expect(icon.attributes("style")).toContain("width: 36px");
    expect(icon.attributes("style")).toContain("height: 18px");
    await icon.trigger("pointerdown", { button: 0, clientX: 100, clientY: 80 });
    dispatchPointer("pointermove", 120, 100);
    dispatchPointer("pointerup", 120, 100);
    expect(lastPayload(wrapper, "groupIconOffsetUpdate")).toEqual({
      elementId: "frame",
      offset: { x: 10, y: 10 },
    });
    expect(wrapper.emitted("geometryBatchChange")).toBeUndefined();

    delete scene.containers[0]!.iconUrl;
    await wrapper.setProps({ scene: structuredClone(scene) });
    expect(wrapper.find(".iriograph-group-frame-icon").exists()).toBe(false);
    expect(wrapper.get(".iriograph-group-frame-icon-fallback").text()).toBe("◇");
  });
});

function dispatchPointer(type: "pointermove" | "pointerup", clientX: number, clientY: number): void {
  window.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX, clientY }));
}

function flushPreview(): Promise<void> {
  return new Promise((resolve) => queueMicrotask(resolve));
}

function disabledSnap() {
  return {
    grid: { enabled: false, size: 8 },
    targets: { enabled: false, tolerance: 6 },
  };
}

function lastPayload<T>(wrapper: VueWrapper, eventName: string): T | undefined {
  return wrapper.emitted(eventName)?.at(-1)?.[0] as T | undefined;
}

function configureViewport(wrapper: VueWrapper, width: number, height: number): void {
  const viewport = wrapper.get<HTMLElement>(".iriograph-canvas-scroll").element;
  const stage = wrapper.get<HTMLElement>(".iriograph-canvas-stage").element;
  Object.defineProperties(viewport, {
    clientWidth: { configurable: true, value: width },
    clientHeight: { configurable: true, value: height },
    getBoundingClientRect: {
      configurable: true,
      value: () => ({ left: 0, top: 0, right: width, bottom: height, width, height, x: 0, y: 0, toJSON: () => ({}) }),
    },
  });
  Object.defineProperties(stage, {
    offsetLeft: { configurable: true, value: 20 },
    offsetTop: { configurable: true, value: 20 },
  });
  window.dispatchEvent(new Event("resize"));
}

function configureCanvasCoordinates(wrapper: VueWrapper): void {
  const stage = wrapper.get<HTMLElement>(".iriograph-canvas-stage").element;
  Object.defineProperty(stage, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      left: 0,
      top: 0,
      right: 1400,
      bottom: 1000,
      width: 1400,
      height: 1000,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }),
  });
}

function elementClientGeometry(element: { element: HTMLElement }): ElementGeometry {
  return {
    x: Number.parseFloat(element.element.style.left),
    y: Number.parseFloat(element.element.style.top),
    width: Number.parseFloat(element.element.style.width),
    height: Number.parseFloat(element.element.style.height),
  };
}

function sceneFixture(): DiagramScene {
  return {
    viewId: "main",
    width: 800,
    height: 500,
    diagnostics: [],
    containers: [],
    nodes: [
      {
        elementId: "node-a",
        semanticRef: "urn:test:canvas:a",
        structuralKind: "node",
        label: "A",
        templateRef: "urn:test:template:node",
        shape: "rounded-rectangle",
        style: { fill: "#fff", stroke: "#000", text: "#000" },
        geometry: { x: 20, y: 40, width: 120, height: 60 },
        pinned: false,
        placement: "generated",
      },
      {
        elementId: "node-b",
        semanticRef: "urn:test:canvas:b",
        structuralKind: "node",
        label: "B",
        templateRef: "urn:test:template:node",
        shape: "rounded-rectangle",
        style: { fill: "#fff", stroke: "#000", text: "#000" },
        geometry: { x: 300, y: 160, width: 120, height: 60 },
        pinned: false,
        placement: "generated",
      },
    ],
    edges: [{
      elementId: "edge-a-b",
      semanticRef: "urn:test:canvas:statement:a-b",
      structuralKind: "edge",
      sourceElementId: "node-a",
      targetElementId: "node-b",
      label: "rel",
      templateRef: "urn:test:template:edge",
      style: { fill: "none", stroke: "#000", text: "#000" },
      route: [{ x: 140, y: 70 }, { x: 140, y: 90 }, { x: 300, y: 190 }],
      waypoints: [{ x: 140, y: 90 }],
      fallback: true,
      projectionRuleId: "fallback",
    }],
  };
}

function groupFrameSceneFixture(): DiagramScene {
  const scene = sceneFixture();
  scene.containers = [{
    elementId: "frame",
    semanticRef: "urn:test:frame",
    structuralKind: "container",
    groupRole: "membership",
    groupFrame: {
      kind: "membership",
      semanticRef: "urn:test:frame",
      provenance: {
        operator: "membership-container",
        derivation: "resource",
        sourceStatementRefs: [],
      },
    },
    label: "担当領域",
    templateRef: "urn:test:group",
    headerPosition: "top",
    style: { fill: "transparent", stroke: "#555", text: "#222" },
    geometry: { x: 0, y: 0, width: 500, height: 300 },
    pinned: false,
    placement: "generated",
  }];
  return scene;
}

function generatedRouteScene(): DiagramScene {
  const scene = sceneFixture();
  scene.edges = [{
    ...scene.edges[0]!,
    route: [
      { x: 140, y: 70 },
      { x: 220, y: 70 },
      { x: 220, y: 190 },
      { x: 300, y: 190 },
    ],
    waypoints: undefined,
  }];
  return scene;
}

function containedSceneFixture(): DiagramScene {
  return {
    viewId: "main",
    width: 800,
    height: 500,
    diagnostics: [],
    containers: [
      {
        elementId: "container-a",
        semanticRef: "urn:test:canvas:container-a",
        structuralKind: "container",
        label: "Container A",
        templateRef: "urn:test:template:container",
        headerPosition: "none",
        style: { fill: "#fff", stroke: "#000", text: "#000" },
        geometry: { x: 8, y: 8, width: 280, height: 180 },
        pinned: false,
        placement: "generated",
      },
      {
        elementId: "container-b",
        semanticRef: "urn:test:canvas:container-b",
        structuralKind: "container",
        label: "Container B",
        templateRef: "urn:test:template:container",
        headerPosition: "none",
        style: { fill: "#fff", stroke: "#000", text: "#000" },
        geometry: { x: 300, y: 8, width: 300, height: 180 },
        pinned: false,
        placement: "generated",
      },
    ],
    nodes: [
      {
        ...sceneFixture().nodes[0]!,
        elementId: "node-a",
        geometry: { x: 30, y: 70, width: 40, height: 30 },
        parentElementId: "container-a",
      },
      {
        ...sceneFixture().nodes[1]!,
        elementId: "node-b",
        geometry: { x: 500, y: 70, width: 40, height: 30 },
        parentElementId: "container-b",
      },
    ],
    edges: [],
  };
}
