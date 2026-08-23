import { describe, expect, it } from "vitest";

import {
  LayoutAdapterRegistry,
  STANDARD_LAYOUT_REFS,
  StandardLightweightLayoutAdapter,
  createStandardLayoutRegistry,
  layoutProjectedScene,
  type LayoutAdapter,
  type LayoutProjectedScene,
  type LayoutRequest,
} from "./layout";

const nestedScene: LayoutProjectedScene = {
  elements: [
    {
      elementId: "fixed",
      structuralKind: "node",
      placement: "user",
      geometry: { x: 48, y: 48, width: 120, height: 60 },
    },
    { elementId: "outside", structuralKind: "node", size: { width: 140, height: 64 } },
    { elementId: "step-b", structuralKind: "node", parentElementId: "bag" },
    { elementId: "bag", structuralKind: "container" },
    { elementId: "step-a", structuralKind: "node", parentElementId: "bag" },
  ],
  edges: [
    { elementId: "flow-2", sourceElementId: "step-b", targetElementId: "outside" },
    { elementId: "flow-1", sourceElementId: "step-a", targetElementId: "step-b" },
  ],
};

describe("StandardLightweightLayoutAdapter", () => {
  it("lays out LR hierarchy and Bag/container children without moving user geometry", async () => {
    const result = await layoutProjectedScene({
      layoutRef: STANDARD_LAYOUT_REFS.hierarchicalLr,
      scene: nestedScene,
    }, createStandardLayoutRegistry());

    expect(result.diagnostics).toEqual([]);
    expect(result.geometries.fixed).toEqual({ x: 48, y: 48, width: 120, height: 60 });
    expect(result.geometries["step-a"]!.x).toBeLessThan(result.geometries["step-b"]!.x);
    expect(result.geometries.bag!.x).toBeLessThan(result.geometries.outside!.x);
    expect(isInside(result.geometries["step-a"]!, result.geometries.bag!)).toBe(true);
    expect(isInside(result.geometries["step-b"]!, result.geometries.bag!)).toBe(true);
    expect(result.routes["flow-1"]).toHaveLength(4);
  });

  it("lays out the same hierarchy top-to-bottom for the TB adapter", async () => {
    const result = await layoutProjectedScene({
      layoutRef: STANDARD_LAYOUT_REFS.hierarchicalTb,
      scene: nestedScene,
    }, createStandardLayoutRegistry());

    expect(result.diagnostics).toEqual([]);
    expect(result.geometries["step-a"]!.y).toBeLessThan(result.geometries["step-b"]!.y);
    expect(result.geometries.bag!.y).toBeLessThan(result.geometries.outside!.y);
    expect(isInside(result.geometries["step-a"]!, result.geometries.bag!)).toBe(true);
  });

  it("uses stable identity order and returns identical coordinates for shuffled cyclic input", async () => {
    const scene: LayoutProjectedScene = {
      elements: [
        { elementId: "c", structuralKind: "node" },
        { elementId: "a", structuralKind: "node" },
        { elementId: "b", structuralKind: "node" },
      ],
      edges: [
        { elementId: "b-a", sourceElementId: "b", targetElementId: "a" },
        { elementId: "a-b", sourceElementId: "a", targetElementId: "b" },
        { elementId: "b-c", sourceElementId: "b", targetElementId: "c" },
      ],
    };
    const reverse: LayoutProjectedScene = {
      elements: [...scene.elements].reverse(),
      edges: [...scene.edges].reverse(),
    };
    const adapter = new StandardLightweightLayoutAdapter("urn:test:layout:lr", "LR");

    const first = await adapter.layout({ layoutRef: adapter.layoutRef, scene });
    const second = await adapter.layout({ layoutRef: adapter.layoutRef, scene: reverse });

    expect(first.geometries).toEqual(second.geometries);
    expect(first.routes).toEqual(second.routes);
    expect(first.geometries.a!.x).toBe(first.geometries.b!.x);
    expect(first.geometries.a!.y).toBeLessThan(first.geometries.b!.y);
    expect(first.geometries.b!.x).toBeLessThan(first.geometries.c!.x);
  });

  it("recomputes generated geometry but preserves pinned and user placement in incremental mode", async () => {
    const scene: LayoutProjectedScene = {
      elements: [
        {
          elementId: "generated",
          structuralKind: "node",
          placement: "generated",
          geometry: { x: 999, y: 999, width: 100, height: 50 },
        },
        {
          elementId: "pinned",
          structuralKind: "node",
          pinned: true,
          placement: "generated",
          geometry: { x: 700, y: 80, width: 110, height: 55 },
        },
        {
          elementId: "user",
          structuralKind: "node",
          placement: "user",
          geometry: { x: 500, y: 300, width: 130, height: 65 },
        },
      ],
      edges: [],
    };
    const adapter = new StandardLightweightLayoutAdapter("urn:test:layout:incremental", "LR");

    const result = await adapter.layout({
      layoutRef: adapter.layoutRef,
      scene,
      mode: "incremental",
    });

    expect(result.geometries.generated).not.toMatchObject({ x: 999, y: 999 });
    expect(result.geometries.pinned).toEqual({ x: 700, y: 80, width: 110, height: 55 });
    expect(result.geometries.user).toEqual({ x: 500, y: 300, width: 130, height: 65 });
  });

  it("breaks containment cycles deterministically and reports the selected identity", async () => {
    const scene: LayoutProjectedScene = {
      elements: [
        { elementId: "z-container", structuralKind: "container", parentElementId: "a-container" },
        { elementId: "a-container", structuralKind: "container", parentElementId: "z-container" },
      ],
      edges: [],
    };
    const reversed: LayoutProjectedScene = { elements: [...scene.elements].reverse(), edges: [] };
    const adapter = new StandardLightweightLayoutAdapter("urn:test:layout:cycle", "TB");

    const first = await adapter.layout({ layoutRef: adapter.layoutRef, scene });
    const second = await adapter.layout({ layoutRef: adapter.layoutRef, scene: reversed });

    expect(first.geometries).toEqual(second.geometries);
    expect(first.diagnostics).toContainEqual(expect.objectContaining({
      severity: "warning",
      code: "layout-containment-cycle",
      elementId: "a-container",
    }));
  });

  it("preserves explicit manual edge waypoints", async () => {
    const scene: LayoutProjectedScene = {
      elements: [
        { elementId: "a", structuralKind: "node" },
        { elementId: "b", structuralKind: "node" },
      ],
      edges: [{
        elementId: "edge",
        sourceElementId: "a",
        targetElementId: "b",
        routingPlacement: "user",
        waypoints: [{ x: 12, y: 34 }],
      }],
    };
    const adapter = new StandardLightweightLayoutAdapter("urn:test:layout:route", "LR");

    const result = await adapter.layout({ layoutRef: adapter.layoutRef, scene });

    expect(result.routes.edge).toEqual([{ x: 12, y: 34 }]);
  });
});

describe("LayoutAdapterRegistry", () => {
  it("returns an error diagnostic for an unknown layoutRef without falling back", async () => {
    const result = await layoutProjectedScene({
      layoutRef: "urn:unknown:layout",
      scene: { elements: [], edges: [] },
    }, createStandardLayoutRegistry());

    expect(result.geometries).toEqual({});
    expect(result.diagnostics).toEqual([expect.objectContaining({
      severity: "error",
      code: "layout-adapter-unresolved",
      layoutRef: "urn:unknown:layout",
    })]);
  });

  it("awaits injected adapters and converts adapter failures to diagnostics", async () => {
    let called = false;
    const custom: LayoutAdapter = {
      layoutRef: "urn:test:layout:custom",
      async layout(request: LayoutRequest) {
        await Promise.resolve();
        called = true;
        return {
          layoutRef: request.layoutRef,
          geometries: {},
          routes: {},
          width: 10,
          height: 20,
          diagnostics: [],
        };
      },
    };
    const failing: LayoutAdapter = {
      layoutRef: "urn:test:layout:failing",
      async layout() {
        throw new Error("worker stopped");
      },
    };
    const registry = new LayoutAdapterRegistry([custom, failing]);

    const success = await layoutProjectedScene({
      layoutRef: custom.layoutRef,
      scene: { elements: [], edges: [] },
    }, registry);
    const failure = await layoutProjectedScene({
      layoutRef: failing.layoutRef,
      scene: { elements: [], edges: [] },
    }, registry);

    expect(called).toBe(true);
    expect(success).toMatchObject({ width: 10, height: 20, diagnostics: [] });
    expect(failure.diagnostics).toEqual([expect.objectContaining({
      severity: "error",
      code: "layout-adapter-failed",
      message: "worker stopped",
    })]);
  });

  it("rejects an invalid adapter result instead of exposing partial geometry", async () => {
    const invalid: LayoutAdapter = {
      layoutRef: "urn:test:layout:invalid-result",
      async layout(request) {
        return {
          layoutRef: request.layoutRef,
          geometries: {},
          routes: {},
          width: Number.NaN,
          height: 20,
          diagnostics: [],
        };
      },
    };
    const registry = new LayoutAdapterRegistry([invalid]);

    const result = await layoutProjectedScene({
      layoutRef: invalid.layoutRef,
      scene: { elements: [{ elementId: "node", structuralKind: "node" }], edges: [] },
    }, registry);

    expect(result.geometries).toEqual({});
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ severity: "error", code: "layout-result-invalid" }),
    ]));
  });
});

function isInside(child: { x: number; y: number; width: number; height: number }, parent: {
  x: number;
  y: number;
  width: number;
  height: number;
}): boolean {
  return child.x >= parent.x
    && child.y >= parent.y
    && child.x + child.width <= parent.x + parent.width
    && child.y + child.height <= parent.y + parent.height;
}
