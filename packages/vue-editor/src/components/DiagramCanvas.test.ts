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

  it("selected nodeをminimum sizeまでresizeしてgestureを閉じる", async () => {
    wrapper = mount(DiagramCanvas, {
      attachTo: document.body,
      props: { scene: sceneFixture(), selectedElementId: "node-a" },
    });

    await wrapper.get(".iriograph-resize-handle").trigger("pointerdown", {
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
      x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 500,
      width: 800, height: 500, toJSON: () => undefined,
    });
    const handles = wrapper.findAll(".iriograph-endpoint-anchors circle");
    expect(handles).toHaveLength(2);
    expect(handles[0]!.classes()).toContain("source");
    expect(handles[1]!.classes()).toContain("target");

    await handles[0]!.trigger("pointerdown", { button: 0, clientX: 140, clientY: 70 });
    dispatchPointer("pointermove", 80, 20);
    await flushPreview();
    expect(wrapper.get(".iriograph-endpoint-anchors circle.source").attributes("cx")).toBe("80");
    expect(wrapper.get(".iriograph-endpoint-anchors circle.source").attributes("cy")).toBe("40");
    expect(wrapper.emitted("routingUpdate")).toBeUndefined();
    dispatchPointer("pointerup", 80, 20);

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

  it("path double-clickでderived bendをseedしnearest segmentへwaypointを追加する", async () => {
    const scene = generatedRouteScene();
    wrapper = mount(DiagramCanvas, { attachTo: document.body, props: { scene } });
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

    await wrapper.get(".iriograph-edge-group").trigger("dblclick", { clientX: 180, clientY: 76 });

    expect(lastPayload(wrapper, "routingUpdate")).toEqual({
      elementId: "edge-a-b",
      routing: {
        waypoints: [{ x: 180, y: 70 }, { x: 220, y: 70 }, { x: 220, y: 190 }],
      },
    });
    expect(wrapper.emitted("gestureStart")).toHaveLength(1);
    expect(wrapper.emitted("gestureEnd")).toHaveLength(1);
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

  it("Deleteはsemantic graphを直接変更せずauthoring draft seedだけを通知する", async () => {
    wrapper = mount(DiagramCanvas, { props: { scene: sceneFixture() } });

    await wrapper.get(".iriograph-edge-group").trigger("keydown", { key: "Delete" });
    await wrapper.get(".iriograph-scene-node").trigger("keydown", { key: "Backspace" });

    expect(wrapper.emitted("semanticEditRequest")).toEqual([
      ["edge-a-b"],
      ["node-a"],
    ]);
    expect(wrapper.emitted("routingUpdate")).toBeUndefined();

    await wrapper.setProps({ readOnly: true });
    await wrapper.get(".iriograph-edge-group").trigger("keydown", { key: "Delete" });
    expect(wrapper.emitted("semanticEditRequest")).toHaveLength(2);
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

  it("Arrow focus、toggle、range selectionを共通navigator順序で通知する", async () => {
    wrapper = mount(DiagramCanvas, { attachTo: document.body, props: { scene: sceneFixture() } });
    const viewport = wrapper.get(".iriograph-canvas-scroll");
    expect(viewport.attributes("aria-activedescendant")).toContain("node-a");

    await viewport.trigger("keydown", { key: "ArrowRight" });
    expect(viewport.attributes("aria-activedescendant")).toContain("node-b");
    await viewport.trigger("keydown", { key: " ", ctrlKey: true });
    expect(lastPayload(wrapper, "selectionRequest")).toEqual({ elementId: "node-b", mode: "toggle" });
    await viewport.trigger("keydown", { key: "ArrowRight", shiftKey: true });
    expect(lastPayload(wrapper, "selectionSetRequest")).toEqual(["node-b", "edge-a-b"]);
    expect(viewport.attributes("aria-activedescendant")).toContain("edge-a-b");
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
    await viewport.trigger("keydown", { key: "ArrowRight", ctrlKey: true });
    await viewport.trigger("keydown", { key: "ArrowRight", ctrlKey: true, repeat: true });

    expect(wrapper.get(".iriograph-scene-node.selected").attributes("style")).toContain("left: 22px");
    expect(wrapper.emitted("geometryBatchChange")).toBeUndefined();
    expect(wrapper.emitted("gestureStart")).toHaveLength(1);

    await viewport.trigger("keyup", { key: "ArrowRight", ctrlKey: true });
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
    expect(wrapper.get(".iriograph-scene-node.selected").attributes("style")).toContain("left: 20px");
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

  it("blank canvasのmouse drag、Page key pan、Arrow scene navigationを分離する", async () => {
    wrapper = mount(DiagramCanvas, {
      attachTo: document.body,
      props: { scene: sceneFixture() },
    });
    configureViewport(wrapper, 260, 180);
    const viewport = wrapper.get<HTMLElement>(".iriograph-canvas-scroll");

    await wrapper.get(".iriograph-canvas-grid").trigger("pointerdown", {
      button: 0,
      clientX: 120,
      clientY: 90,
    });
    dispatchPointer("pointermove", 70, 50);
    dispatchPointer("pointerup", 70, 50);

    expect(viewport.element.scrollLeft).toBe(50);
    expect(viewport.element.scrollTop).toBe(40);
    expect(wrapper.emitted("geometryChange")).toBeUndefined();
    expect(wrapper.emitted("gestureStart")).toBeUndefined();

    await viewport.trigger("keydown", { key: "ArrowRight" });
    expect(viewport.attributes("aria-activedescendant")).toContain("node-b");
    expect(viewport.element.scrollLeft).toBeGreaterThan(50);
    viewport.element.scrollTop = 40;
    await viewport.trigger("keydown", { key: "PageDown" });
    expect(viewport.element.scrollTop).toBeGreaterThan(40);
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

    await api.fitToView();
    expect(wrapper.emitted("zoomChange")?.at(-1)?.[0]).toBe(.22);
    expect((wrapper.props() as { zoom: number }).zoom).toBe(.22);

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
    expect((nodes[0]!.element as HTMLElement).style.left).toBe("32px");
    expect((nodes[1]!.element as HTMLElement).style.left).toBe("312px");

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
      .toContain("left: 88px");
    const stage = wrapper.get<HTMLElement>(".iriograph-canvas-stage").element;
    stage.getBoundingClientRect = () => ({
      x: 10, y: 20, left: 10, top: 20, right: 810, bottom: 520,
      width: 800, height: 500, toJSON: () => undefined,
    });
    await wrapper.get(".iriograph-canvas-scroll").trigger("pointerdown", {
      button: 0,
      clientX: 110,
      clientY: 120,
    });
    dispatchPointer("pointerup", 110, 120);
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
      x: 10, y: 20, left: 10, top: 20, right: 810, bottom: 520,
      width: 800, height: 500, toJSON: () => undefined,
    });

    await wrapper.get(".iriograph-scene-container").trigger("pointerdown", {
      button: 0,
      clientX: 110,
      clientY: 120,
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
  });
  Object.defineProperties(stage, {
    offsetLeft: { configurable: true, value: 20 },
    offsetTop: { configurable: true, value: 20 },
  });
  window.dispatchEvent(new Event("resize"));
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
