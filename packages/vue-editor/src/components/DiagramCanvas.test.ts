import { afterEach, describe, expect, it } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";

import type { DiagramScene, ElementGeometry, Point } from "@iriograph/core";

import DiagramCanvas from "./DiagramCanvas.vue";

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
        geometry: { x: 40, y: 50, width: 120, height: 60 },
      });
    expect(wrapper.emitted("gestureEnd")).toHaveLength(1);
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
});

function dispatchPointer(type: "pointermove" | "pointerup", clientX: number, clientY: number): void {
  window.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX, clientY }));
}

function lastPayload<T>(wrapper: VueWrapper, eventName: string): T | undefined {
  return wrapper.emitted(eventName)?.at(-1)?.[0] as T | undefined;
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
