import { afterEach, describe, expect, it } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";

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
    expect(wrapper.emitted("gestureStart")).toHaveLength(1);
    expect(wrapper.emitted("gestureEnd")).toHaveLength(1);
  });

  it("blank canvasのmouse dragとfocusされたviewportのkeyだけをpanに使う", async () => {
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
    expect(viewport.element.scrollLeft).toBe(114);
    await viewport.trigger("keydown", { key: "PageDown" });
    expect(viewport.element.scrollTop).toBe(184);
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
});

function dispatchPointer(type: "pointermove" | "pointerup", clientX: number, clientY: number): void {
  window.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX, clientY }));
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
      waypoints: [{ x: 140, y: 90 }],
      fallback: true,
      projectionRuleId: "fallback",
    }],
  };
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
