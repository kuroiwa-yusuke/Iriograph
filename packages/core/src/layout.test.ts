import { describe, expect, it } from "vitest";

import {
  LayoutAdapterRegistry,
  STANDARD_LAYOUT_REFS,
  StandardLightweightLayoutAdapter,
  completeRegionLayout,
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
    expect(result.routes["flow-1"]!.length).toBeGreaterThanOrEqual(4);
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

  it("orders Seq group members by ordinal membership without visible edges", async () => {
    const scene: LayoutProjectedScene = {
      elements: [
        { elementId: "sequence", structuralKind: "container" },
        { elementId: "third", structuralKind: "node", parentElementId: "sequence" },
        { elementId: "first", structuralKind: "node", parentElementId: "sequence" },
        { elementId: "second", structuralKind: "node", parentElementId: "sequence" },
      ],
      edges: [],
      memberships: [
        { semanticRef: "m3", containerElementId: "sequence", memberElementId: "third", role: "sequence-member", ordinal: 3 },
        { semanticRef: "m1", containerElementId: "sequence", memberElementId: "first", role: "sequence-member", ordinal: 1 },
        { semanticRef: "m2", containerElementId: "sequence", memberElementId: "second", role: "sequence-member", ordinal: 2 },
      ],
    };
    const result = await layoutProjectedScene({
      layoutRef: STANDARD_LAYOUT_REFS.hierarchicalLr,
      scene,
    }, createStandardLayoutRegistry());

    expect(result.diagnostics).toEqual([]);
    expect(result.geometries.first!.x).toBeLessThan(result.geometries.second!.x);
    expect(result.geometries.second!.x).toBeLessThan(result.geometries.third!.x);
    expect(Object.keys(result.routes)).toEqual([]);
  });

  it("encloses a member shared by multiple Seq groups without inventing a parent", async () => {
    const scene: LayoutProjectedScene = {
      elements: [
        { elementId: "sequence-a", structuralKind: "container", groupRole: "sequence" },
        { elementId: "sequence-b", structuralKind: "container", groupRole: "sequence" },
        { elementId: "shared", structuralKind: "node" },
      ],
      edges: [],
      memberships: [
        { semanticRef: "a1", containerElementId: "sequence-a", memberElementId: "shared", role: "sequence-member", ordinal: 1 },
        { semanticRef: "b1", containerElementId: "sequence-b", memberElementId: "shared", role: "sequence-member", ordinal: 1 },
      ],
    };
    const result = await layoutProjectedScene({
      layoutRef: STANDARD_LAYOUT_REFS.hierarchicalLr,
      scene,
    }, createStandardLayoutRegistry());

    expect(result.diagnostics).toEqual([]);
    expect(isInside(result.geometries.shared!, result.geometries["sequence-a"]!)).toBe(true);
    expect(isInside(result.geometries.shared!, result.geometries["sequence-b"]!)).toBe(true);
  });

  it("places generated children inside the visual content area of a left-header container", async () => {
    const scene: LayoutProjectedScene = {
      elements: [
        { elementId: "child-b", structuralKind: "node", parentElementId: "lane" },
        {
          elementId: "lane",
          structuralKind: "container",
          contentInsets: { top: 16, right: 16, bottom: 16, left: 78 },
        },
        { elementId: "child-a", structuralKind: "node", parentElementId: "lane" },
      ],
      edges: [{ elementId: "flow", sourceElementId: "child-a", targetElementId: "child-b" }],
    };
    const adapter = new StandardLightweightLayoutAdapter("urn:test:left-header", "LR");

    const first = await adapter.layout({ layoutRef: adapter.layoutRef, scene });
    const second = await adapter.layout({
      layoutRef: adapter.layoutRef,
      scene: { elements: [...scene.elements].reverse(), edges: [...scene.edges].reverse() },
    });

    expect(first.geometries).toEqual(second.geometries);
    const lane = first.geometries.lane!;
    for (const childId of ["child-a", "child-b"]) {
      const child = first.geometries[childId]!;
      expect(child.x).toBeGreaterThanOrEqual(lane.x + 78);
      expect(child.y).toBeGreaterThanOrEqual(lane.y + 16);
      expect(child.x + child.width).toBeLessThanOrEqual(lane.x + lane.width - 16);
      expect(child.y + child.height).toBeLessThanOrEqual(lane.y + lane.height - 16);
    }
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

    expect(result.routes.edge).toHaveLength(3);
    expect(result.routes.edge?.[1]).toEqual({ x: 12, y: 34 });
    expect(result.routes.edge?.[0]).not.toEqual({ x: 12, y: 34 });
    expect(result.routes.edge?.[2]).not.toEqual({ x: 12, y: 34 });
  });

  it("returns an endpoint-only straight route", async () => {
    const scene: LayoutProjectedScene = {
      elements: [
        { elementId: "a", structuralKind: "node" },
        { elementId: "b", structuralKind: "node" },
      ],
      edges: [{ elementId: "edge", sourceElementId: "a", targetElementId: "b", routeMode: "straight" }],
    };
    const adapter = new StandardLightweightLayoutAdapter("urn:test:layout:straight", "LR");

    const result = await adapter.layout({ layoutRef: adapter.layoutRef, scene });

    expect(result.routes.edge).toHaveLength(2);
    expect(result.routes.edge?.[0]).toEqual({
      x: result.geometries.a!.x + result.geometries.a!.width,
      y: result.geometries.a!.y + result.geometries.a!.height / 2,
    });
    expect(result.routes.edge?.at(-1)).toEqual({
      x: result.geometries.b!.x,
      y: result.geometries.b!.y + result.geometries.b!.height / 2,
    });
  });

  it("keeps derived bend points for curve rendering", async () => {
    const scene: LayoutProjectedScene = {
      elements: [
        { elementId: "a", structuralKind: "node" },
        { elementId: "b", structuralKind: "node" },
      ],
      edges: [{ elementId: "edge", sourceElementId: "a", targetElementId: "b", routeMode: "curve" }],
    };
    const adapter = new StandardLightweightLayoutAdapter("urn:test:layout:curve", "LR");

    const result = await adapter.layout({ layoutRef: adapter.layoutRef, scene });

    expect(result.routes.edge!.length).toBeGreaterThan(2);
  });

  it("routes around fixed node and annotation obstacles without creating manual waypoints", async () => {
    const scene: LayoutProjectedScene = {
      elements: [
        {
          elementId: "source",
          structuralKind: "node",
          placement: "user",
          geometry: { x: 20, y: 100, width: 100, height: 60 },
        },
        {
          elementId: "blocking-node",
          structuralKind: "node",
          placement: "user",
          geometry: { x: 180, y: 90, width: 100, height: 80 },
        },
        {
          elementId: "blocking-comment",
          structuralKind: "annotation",
          placement: "user",
          geometry: { x: 330, y: 70, width: 120, height: 100 },
        },
        {
          elementId: "target",
          structuralKind: "node",
          placement: "user",
          geometry: { x: 520, y: 100, width: 100, height: 60 },
        },
      ],
      edges: [{
        elementId: "edge",
        sourceElementId: "source",
        targetElementId: "target",
        routingPlacement: "generated",
      }],
    };
    const adapter = new StandardLightweightLayoutAdapter("urn:test:layout:obstacles", "LR");

    const result = await adapter.layout({ layoutRef: adapter.layoutRef, scene });
    const route = result.routes.edge!;

    expect(scene.edges[0]!.waypoints).toBeUndefined();
    expect(route.length).toBeGreaterThan(2);
    expect(polylineCrossesBox(route, scene.elements[1]!.geometry!)).toBe(false);
    expect(polylineCrossesBox(route, scene.elements[2]!.geometry!)).toBe(false);
    expect(result.geometries.source).toEqual(scene.elements[0]!.geometry);
    expect(result.geometries.target).toEqual(scene.elements[3]!.geometry);
  });

  it("reserves hidden comment callouts for node placement and edge routing", async () => {
    const commentReservation = {
      placement: "bottom-center" as const,
      width: 200,
      height: 100,
      gap: 10,
    };
    const scene: LayoutProjectedScene = {
      elements: [
        {
          elementId: "source",
          structuralKind: "node",
          placement: "user",
          geometry: { x: 20, y: 180, width: 100, height: 60 },
        },
        {
          elementId: "comment-owner",
          structuralKind: "node",
          placement: "user",
          geometry: { x: 220, y: 40, width: 100, height: 60 },
          externalReservations: [commentReservation],
        },
        {
          elementId: "target",
          structuralKind: "node",
          placement: "user",
          geometry: { x: 520, y: 180, width: 100, height: 60 },
        },
      ],
      edges: [{ elementId: "edge", sourceElementId: "source", targetElementId: "target" }],
    };
    const adapter = new StandardLightweightLayoutAdapter("urn:test:layout:comments", "LR");

    const result = await adapter.layout({ layoutRef: adapter.layoutRef, scene });
    const callout = { x: 170, y: 110, width: 200, height: 100 };

    expect(result.geometries["comment-owner"]).toEqual(scene.elements[1]!.geometry);
    expect(polylineCrossesBox(result.routes.edge!, callout)).toBe(false);
    expect(result.height).toBeGreaterThanOrEqual(callout.y + callout.height + 48);
  });

  it("uses the comment footprint when spacing generated siblings", async () => {
    const scene: LayoutProjectedScene = {
      elements: [
        {
          elementId: "a-commented",
          structuralKind: "node",
          externalReservations: [{
            placement: "bottom-center",
            width: 240,
            height: 90,
            gap: 10,
          }],
        },
        { elementId: "b-plain", structuralKind: "node" },
      ],
      edges: [],
    };
    const adapter = new StandardLightweightLayoutAdapter("urn:test:layout:comment-spacing", "LR");

    const result = await adapter.layout({ layoutRef: adapter.layoutRef, scene });
    const commented = result.geometries["a-commented"]!;
    const plain = result.geometries["b-plain"]!;

    expect(plain.y).toBeGreaterThanOrEqual(commented.y + commented.height + 10 + 90 + 48);
  });

  it("keeps the complete manual route unchanged even when it crosses an obstacle", async () => {
    const manualPoint = { x: 320, y: 110 };
    const scene: LayoutProjectedScene = {
      elements: [
        {
          elementId: "source",
          structuralKind: "node",
          placement: "user",
          geometry: { x: 20, y: 80, width: 100, height: 60 },
        },
        {
          elementId: "blocker",
          structuralKind: "node",
          placement: "user",
          geometry: { x: 170, y: 80, width: 110, height: 100 },
        },
        {
          elementId: "target",
          structuralKind: "node",
          placement: "user",
          geometry: { x: 500, y: 80, width: 100, height: 60 },
        },
      ],
      edges: [{
        elementId: "edge",
        sourceElementId: "source",
        targetElementId: "target",
        routingPlacement: "user",
        waypoints: [manualPoint],
      }],
    };
    const adapter = new StandardLightweightLayoutAdapter("urn:test:layout:manual-obstacle", "LR");

    const result = await adapter.layout({ layoutRef: adapter.layoutRef, scene });

    expect(result.routes.edge).toEqual([
      { x: 120, y: 110 },
      manualPoint,
      { x: 500, y: 110 },
    ]);
    expect(scene.edges[0]!.waypoints).toEqual([manualPoint]);
    expect(polylineCrossesBox(result.routes.edge!, scene.elements[1]!.geometry!)).toBe(true);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: "layout-manual-route-obstacle",
      edgeId: "edge",
    }));
  });

  it("treats routeMode manual as an immutable endpoint-inclusive route", async () => {
    const waypoint = { x: 260, y: 160 };
    const scene: LayoutProjectedScene = {
      elements: [
        { elementId: "a", structuralKind: "node", placement: "user", geometry: { x: 20, y: 80, width: 100, height: 60 } },
        { elementId: "b", structuralKind: "node", placement: "user", geometry: { x: 420, y: 80, width: 100, height: 60 } },
      ],
      edges: [{
        elementId: "edge",
        sourceElementId: "a",
        targetElementId: "b",
        routeMode: "manual",
        waypoints: [waypoint],
      }],
    };
    const adapter = new StandardLightweightLayoutAdapter("urn:test:layout:manual-mode", "LR");

    const result = await adapter.layout({ layoutRef: adapter.layoutRef, scene });

    expect(result.routes.edge).toHaveLength(3);
    expect(result.routes.edge?.[1]).toEqual(waypoint);
    expect(scene.edges[0]!.waypoints).toEqual([waypoint]);
  });

  it("chooses the nearest shape boundary and keeps endpoint segments outside nodes", async () => {
    const scene: LayoutProjectedScene = {
      elements: [
        {
          elementId: "source",
          structuralKind: "node",
          shape: "circle",
          placement: "user",
          geometry: { x: 100, y: 300, width: 100, height: 80 },
        },
        {
          elementId: "target",
          structuralKind: "node",
          shape: "diamond",
          placement: "user",
          geometry: { x: 100, y: 0, width: 100, height: 80 },
        },
      ],
      edges: [{ elementId: "edge", sourceElementId: "source", targetElementId: "target" }],
    };
    const adapter = new StandardLightweightLayoutAdapter("urn:test:layout:nearest-port", "LR");

    const result = await adapter.layout({ layoutRef: adapter.layoutRef, scene });
    const route = result.routes.edge!;

    expect(route[0]).toEqual({ x: 150, y: 300 });
    expect(route[1]!.y).toBeLessThan(route[0]!.y);
    expect(route.at(-1)).toEqual({ x: 150, y: 80 });
    expect(route.at(-2)!.y).toBeGreaterThan(route.at(-1)!.y);
    expect(polylineCrossesBox(route.slice(0, 2), scene.elements[0]!.geometry!)).toBe(false);
    expect(polylineCrossesBox(route.slice(-2), scene.elements[1]!.geometry!)).toBe(false);
  });

  it("uses an outward derived stub for an explicit opposite-side anchor", async () => {
    const source = { x: 20, y: 100, width: 100, height: 60 };
    const scene: LayoutProjectedScene = {
      elements: [
        { elementId: "source", structuralKind: "node", placement: "user", geometry: source },
        { elementId: "target", structuralKind: "node", placement: "user", geometry: { x: 420, y: 100, width: 100, height: 60 } },
      ],
      edges: [{
        elementId: "edge",
        sourceElementId: "source",
        targetElementId: "target",
        sourceAnchor: { position: 0 },
      }],
    };
    const adapter = new StandardLightweightLayoutAdapter("urn:test:layout:outward-anchor", "LR");

    const result = await adapter.layout({ layoutRef: adapter.layoutRef, scene });
    const route = result.routes.edge!;

    expect(route[0]).toEqual({ x: 70, y: 100 });
    expect(route[1]).toEqual({ x: 70, y: 88 });
    expect(polylineCrossesBox(route.slice(0, 2), source)).toBe(false);
  });

  it("refines generated routes against later manual routes using graph-global quality", async () => {
    const scene: LayoutProjectedScene = {
      elements: [
        { elementId: "top", structuralKind: "node", placement: "user", geometry: { x: 280, y: 20, width: 100, height: 60 } },
        { elementId: "bottom", structuralKind: "node", placement: "user", geometry: { x: 280, y: 320, width: 100, height: 60 } },
        { elementId: "left", structuralKind: "node", placement: "user", geometry: { x: 20, y: 170, width: 100, height: 60 } },
        { elementId: "right", structuralKind: "node", placement: "user", geometry: { x: 540, y: 170, width: 100, height: 60 } },
      ],
      edges: [
        { elementId: "a-generated", sourceElementId: "top", targetElementId: "bottom" },
        {
          elementId: "z-manual",
          sourceElementId: "left",
          targetElementId: "right",
          routeMode: "manual",
          waypoints: [{ x: 300, y: 200 }],
        },
      ],
    };
    const adapter = new StandardLightweightLayoutAdapter("urn:test:layout:global-route", "LR");

    const first = await adapter.layout({ layoutRef: adapter.layoutRef, scene });
    const second = await adapter.layout({
      layoutRef: adapter.layoutRef,
      scene: { elements: [...scene.elements].reverse(), edges: [...scene.edges].reverse() },
    });

    expect(first.routes).toEqual(second.routes);
    expect(first.routes["z-manual"]).toEqual([
      { x: 120, y: 200 },
      { x: 300, y: 200 },
      { x: 540, y: 200 },
    ]);
    expect(polylineStrictCrossings(
      first.routes["a-generated"]!,
      first.routes["z-manual"]!,
    )).toBe(0);
  });

  it("keeps straight self-routes endpoint-only even with stale manual waypoints", async () => {
    const scene: LayoutProjectedScene = {
      elements: [{ elementId: "a", structuralKind: "node" }],
      edges: [{
        elementId: "edge",
        sourceElementId: "a",
        targetElementId: "a",
        routeMode: "straight",
        routingPlacement: "user",
        waypoints: [{ x: 999, y: 999 }],
      }],
    };
    const adapter = new StandardLightweightLayoutAdapter("urn:test:layout:straight-self", "LR");

    const result = await adapter.layout({ layoutRef: adapter.layoutRef, scene });

    expect(result.routes.edge).toHaveLength(2);
    expect(result.routes.edge).not.toContainEqual({ x: 999, y: 999 });
  });

  it("deterministically separates otherwise overlapping routes", async () => {
    const scene: LayoutProjectedScene = {
      elements: [
        { elementId: "a", structuralKind: "node", placement: "user", geometry: { x: 20, y: 20, width: 80, height: 50 } },
        { elementId: "b", structuralKind: "node", placement: "user", geometry: { x: 420, y: 220, width: 80, height: 50 } },
        { elementId: "c", structuralKind: "node", placement: "user", geometry: { x: 20, y: 220, width: 80, height: 50 } },
        { elementId: "d", structuralKind: "node", placement: "user", geometry: { x: 420, y: 20, width: 80, height: 50 } },
      ],
      edges: [
        { elementId: "cross-a", sourceElementId: "a", targetElementId: "b" },
        { elementId: "cross-b", sourceElementId: "c", targetElementId: "d" },
      ],
    };
    const adapter = new StandardLightweightLayoutAdapter("urn:test:layout:route-congestion", "LR");

    const first = await adapter.layout({ layoutRef: adapter.layoutRef, scene });
    const second = await adapter.layout({
      layoutRef: adapter.layoutRef,
      scene: { elements: [...scene.elements].reverse(), edges: [...scene.edges].reverse() },
    });

    expect(first.routes).toEqual(second.routes);
    expect(polylineOverlapLength(first.routes["cross-a"]!, first.routes["cross-b"]!)).toBe(0);
    expect(polylineStrictCrossings(first.routes["cross-a"]!, first.routes["cross-b"]!)).toBe(0);
  });

  it("routes parallel, reciprocal, and self-loop edges deterministically with bounded lanes", async () => {
    const scene: LayoutProjectedScene = {
      elements: [
        {
          elementId: "a",
          structuralKind: "node",
          placement: "user",
          geometry: { x: 48, y: 48, width: 120, height: 80 },
        },
        {
          elementId: "b",
          structuralKind: "node",
          placement: "user",
          geometry: { x: -180, y: 48, width: 100, height: 80 },
        },
      ],
      edges: [
        { elementId: "loop-z", sourceElementId: "a", targetElementId: "a" },
        { elementId: "reverse", sourceElementId: "b", targetElementId: "a" },
        { elementId: "forward-z", sourceElementId: "a", targetElementId: "b" },
        { elementId: "loop-a", sourceElementId: "a", targetElementId: "a" },
        { elementId: "forward-a", sourceElementId: "a", targetElementId: "b" },
      ],
    };
    const adapter = new StandardLightweightLayoutAdapter("urn:test:layout:bundles", "LR");

    const first = await adapter.layout({ layoutRef: adapter.layoutRef, scene });
    const second = await adapter.layout({
      layoutRef: adapter.layoutRef,
      scene: { elements: [...scene.elements].reverse(), edges: [...scene.edges].reverse() },
    });

    expect(first.routes).toEqual(second.routes);
    expect(Object.values(first.routes).every((route) => route.length >= 2)).toBe(true);
    expect(new Set([
      JSON.stringify(first.routes["forward-a"]),
      JSON.stringify(first.routes["forward-z"]),
      JSON.stringify(first.routes.reverse),
    ])).toHaveProperty("size", 3);
    expect(first.routes["forward-a"]?.[0]?.y).toBeCloseTo(68);
    expect(first.routes["forward-z"]?.[0]?.y).toBeCloseTo(88);
    expect(first.routes.reverse?.at(-1)?.y).toBeCloseTo(108);
    expect(Math.max(...first.routes["loop-a"]!.map((point) => point.x))).toBe(204);
    expect(Math.max(...first.routes["loop-z"]!.map((point) => point.x))).toBe(222);
    expect(first.width).toBeGreaterThanOrEqual(270);
  });

  it("honors independent boundary anchors for auto, manual, parallel, and self-loop routes", async () => {
    const scene: LayoutProjectedScene = {
      elements: [
        {
          elementId: "a",
          structuralKind: "node",
          shape: "rectangle",
          placement: "user",
          geometry: { x: 20, y: 30, width: 100, height: 80 },
        },
        {
          elementId: "b",
          structuralKind: "node",
          shape: "circle",
          placement: "user",
          geometry: { x: 300, y: 30, width: 100, height: 80 },
        },
      ],
      edges: [
        {
          elementId: "auto",
          sourceElementId: "a",
          targetElementId: "b",
          sourceAnchor: { position: 0 },
          targetAnchor: { position: .75 },
        },
        {
          elementId: "manual",
          sourceElementId: "a",
          targetElementId: "b",
          routingPlacement: "user",
          waypoints: [{ x: 220, y: 160 }],
          sourceAnchor: { position: .25 },
          targetAnchor: { position: .5 },
        },
        {
          elementId: "parallel",
          sourceElementId: "a",
          targetElementId: "b",
          sourceAnchor: { position: .5 },
        },
        {
          elementId: "loop",
          sourceElementId: "a",
          targetElementId: "a",
          sourceAnchor: { position: .25 },
          targetAnchor: { position: .75 },
        },
      ],
    };
    const adapter = new StandardLightweightLayoutAdapter("urn:test:layout:anchors", "LR");

    const result = await adapter.layout({ layoutRef: adapter.layoutRef, scene });

    expect(result.routes.auto?.[0]).toEqual({ x: 70, y: 30 });
    expect(result.routes.auto?.at(-1)).toEqual({ x: 300, y: 70 });
    expect(result.routes.manual).toEqual([
      { x: 120, y: 70 },
      { x: 220, y: 160 },
      { x: 350, y: 110 },
    ]);
    expect(result.routes.parallel?.[0]).toEqual({ x: 70, y: 110 });
    expect(result.routes.loop?.[0]).toEqual({ x: 120, y: 70 });
    expect(result.routes.loop?.at(-1)).toEqual({ x: 20, y: 70 });
  });

  it("keeps more parallel lanes distinct after attachment offsets reach node bounds", async () => {
    const edges = Array.from({ length: 9 }, (_, index) => ({
      elementId: `edge-${index}`,
      sourceElementId: index % 2 === 0 ? "a" : "b",
      targetElementId: index % 2 === 0 ? "b" : "a",
    }));
    const scene: LayoutProjectedScene = {
      elements: [
        {
          elementId: "a",
          structuralKind: "node",
          placement: "user",
          geometry: { x: 48, y: 10, width: 100, height: 40 },
        },
        {
          elementId: "b",
          structuralKind: "node",
          placement: "user",
          geometry: { x: 400, y: 10, width: 100, height: 40 },
        },
      ],
      edges,
    };
    const adapter = new StandardLightweightLayoutAdapter("urn:test:layout:many-lanes", "LR");

    const result = await adapter.layout({ layoutRef: adapter.layoutRef, scene });
    const signatures = edges.map((edge) => JSON.stringify(result.routes[edge.elementId]));

    expect(new Set(signatures).size).toBe(edges.length);
    expect(Object.values(result.routes).every((route) => route.length >= 2)).toBe(true);
    expect(Object.values(result.routes).flat().every((point) => point.y >= 0)).toBe(true);
    expect(result.height).toBeGreaterThan(98);
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

  it("generated overlap regions deterministically enclose a multiply-associated member", async () => {
    const result = await layoutProjectedScene({
      layoutRef: STANDARD_LAYOUT_REFS.hierarchicalLr,
      scene: {
        elements: [
          { elementId: "region-a", structuralKind: "region", size: { width: 220, height: 160 } },
          { elementId: "region-b", structuralKind: "region", size: { width: 220, height: 160 } },
          {
            elementId: "shared",
            structuralKind: "node",
            placement: "user",
            geometry: { x: 300, y: 220, width: 120, height: 60 },
          },
        ],
        memberships: [
          {
            semanticRef: "membership-a",
            containerElementId: "region-a",
            regionElementId: "region-a",
            memberElementId: "shared",
          },
          {
            semanticRef: "membership-b",
            containerElementId: "region-b",
            regionElementId: "region-b",
            memberElementId: "shared",
          },
        ],
        edges: [],
      },
    }, createStandardLayoutRegistry());

    expect(isInside(result.geometries.shared!, result.geometries["region-a"]!)).toBe(true);
    expect(isInside(result.geometries.shared!, result.geometries["region-b"]!)).toBe(true);
    expect(result.diagnostics.some((item) => item.code.includes("region-member"))).toBe(false);
  });

  it("uses membership-only ordering to form a compact deterministic region matrix", async () => {
    const scene: LayoutProjectedScene = {
      elements: [
        { elementId: "region-left", structuralKind: "region", size: { width: 220, height: 160 } },
        { elementId: "region-right", structuralKind: "region", size: { width: 220, height: 160 } },
        { elementId: "a", structuralKind: "node" },
        { elementId: "b", structuralKind: "node" },
        { elementId: "shared", structuralKind: "node" },
      ],
      memberships: [
        { semanticRef: "left-a", containerElementId: "region-left", regionElementId: "region-left", memberElementId: "a" },
        { semanticRef: "left-shared", containerElementId: "region-left", regionElementId: "region-left", memberElementId: "shared" },
        { semanticRef: "right-b", containerElementId: "region-right", regionElementId: "region-right", memberElementId: "b" },
        { semanticRef: "right-shared", containerElementId: "region-right", regionElementId: "region-right", memberElementId: "shared" },
      ],
      edges: [],
    };
    const adapter = new StandardLightweightLayoutAdapter("urn:test:region-matrix", "LR");

    const first = await adapter.layout({ layoutRef: adapter.layoutRef, scene });
    const second = await adapter.layout({
      layoutRef: adapter.layoutRef,
      scene: {
        elements: [...scene.elements].reverse(),
        memberships: [...scene.memberships!].reverse(),
        edges: [],
      },
    });
    const aspect = Math.max(first.width / first.height, first.height / first.width);

    expect(first.geometries).toEqual(second.geometries);
    expect(first.geometries.a!.x).toBe(first.geometries.b!.x);
    expect(first.geometries.shared!.x).toBeGreaterThan(first.geometries.a!.x);
    expect(isInside(first.geometries.shared!, first.geometries["region-left"]!)).toBe(true);
    expect(isInside(first.geometries.shared!, first.geometries["region-right"]!)).toBe(true);
    expect(aspect).toBeLessThan(4);
  });

  it("packs empty generated regions by aspect instead of preserving remote placeholder geometry", () => {
    const request: LayoutRequest = {
      layoutRef: "urn:test:empty-region-pack",
      scene: {
        elements: [
          { elementId: "node", structuralKind: "node" },
          { elementId: "region-a", structuralKind: "region", size: { width: 220, height: 150 } },
          { elementId: "region-b", structuralKind: "region", size: { width: 220, height: 150 } },
          { elementId: "region-c", structuralKind: "region", size: { width: 220, height: 150 } },
        ],
        edges: [],
      },
    };
    const candidate = {
      layoutRef: request.layoutRef,
      geometries: {
        node: { x: 48, y: 48, width: 160, height: 72 },
        "region-a": { x: 4_000, y: 48, width: 220, height: 150 },
        "region-b": { x: 8_000, y: 48, width: 220, height: 150 },
        "region-c": { x: 12_000, y: 48, width: 220, height: 150 },
      },
      routes: {},
      width: 12_268,
      height: 246,
      diagnostics: [],
    };

    const first = completeRegionLayout(request, candidate);
    const second = completeRegionLayout({
      ...request,
      scene: { ...request.scene, elements: [...request.scene.elements].reverse() },
    }, candidate);
    const aspect = Math.max(first.width / first.height, first.height / first.width);

    expect(first.geometries).toEqual(second.geometries);
    expect(aspect).toBeLessThan(3);
    expect(first.width).toBeLessThan(candidate.width / 5);
  });

  it("manual region geometry is a hard constraint and disjoint membership is diagnostic-only", async () => {
    const left = { x: 20, y: 20, width: 120, height: 120 };
    const right = { x: 240, y: 20, width: 120, height: 120 };
    const result = await layoutProjectedScene({
      layoutRef: STANDARD_LAYOUT_REFS.hierarchicalLr,
      scene: {
        elements: [
          { elementId: "left", structuralKind: "region", placement: "user", geometry: left },
          { elementId: "right", structuralKind: "region", pinned: true, geometry: right },
          {
            elementId: "shared",
            structuralKind: "node",
            placement: "user",
            geometry: { x: 50, y: 50, width: 40, height: 30 },
          },
        ],
        memberships: [
          { semanticRef: "left-member", containerElementId: "left", regionElementId: "left", memberElementId: "shared" },
          { semanticRef: "right-member", containerElementId: "right", regionElementId: "right", memberElementId: "shared" },
        ],
        edges: [],
      },
    }, createStandardLayoutRegistry());

    expect(result.geometries.left).toEqual(left);
    expect(result.geometries.right).toEqual(right);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      severity: "warning",
      code: "region-membership-intersection-empty",
      elementId: "shared",
    }));
    expect(result.diagnostics.some((item) => item.severity === "error")).toBe(false);
  });

  it("reports a multiply-associated member that is inside only one overlapping region", async () => {
    const result = await layoutProjectedScene({
      layoutRef: STANDARD_LAYOUT_REFS.hierarchicalLr,
      scene: {
        elements: [
          { elementId: "left", structuralKind: "region", placement: "user", geometry: { x: 20, y: 20, width: 200, height: 160 } },
          { elementId: "right", structuralKind: "region", placement: "user", geometry: { x: 120, y: 20, width: 200, height: 160 } },
          { elementId: "shared", structuralKind: "node", placement: "user", geometry: { x: 50, y: 60, width: 40, height: 30 } },
        ],
        memberships: [
          { semanticRef: "left-member", containerElementId: "left", regionElementId: "left", memberElementId: "shared" },
          { semanticRef: "right-member", containerElementId: "right", regionElementId: "right", memberElementId: "shared" },
        ],
        edges: [],
      },
    }, createStandardLayoutRegistry());

    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: "region-member-outside-intersection",
      elementId: "shared",
    }));
  });

  it("reports a member whose center is inside but full bounds cross a region boundary", async () => {
    const result = await layoutProjectedScene({
      layoutRef: STANDARD_LAYOUT_REFS.hierarchicalLr,
      scene: {
        elements: [
          {
            elementId: "region",
            structuralKind: "region",
            placement: "user",
            geometry: { x: 20, y: 20, width: 120, height: 120 },
          },
          {
            elementId: "member",
            structuralKind: "container",
            placement: "user",
            geometry: { x: 115, y: 50, width: 40, height: 30 },
          },
        ],
        memberships: [{
          semanticRef: "region-member",
          containerElementId: "region",
          regionElementId: "region",
          memberElementId: "member",
        }],
        edges: [],
      },
    }, createStandardLayoutRegistry());

    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: "region-member-outside",
      elementId: "member",
    }));
  });

  it("keeps generated regions around members with negative user coordinates", async () => {
    const result = await layoutProjectedScene({
      layoutRef: STANDARD_LAYOUT_REFS.hierarchicalLr,
      scene: {
        elements: [
          {
            elementId: "region",
            structuralKind: "region",
            placement: "generated",
            size: { width: 240, height: 160 },
          },
          {
            elementId: "member",
            structuralKind: "node",
            placement: "user",
            geometry: { x: -180, y: -90, width: 100, height: 60 },
          },
        ],
        memberships: [{
          semanticRef: "membership",
          containerElementId: "region",
          regionElementId: "region",
          memberElementId: "member",
        }],
        edges: [],
      },
    }, createStandardLayoutRegistry());

    expect(isInside(result.geometries.member!, result.geometries.region!)).toBe(true);
    expect(result.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
  });

  it("completes nested generated regions from inner member to outer owner", async () => {
    const result = await layoutProjectedScene({
      layoutRef: STANDARD_LAYOUT_REFS.hierarchicalLr,
      scene: {
        elements: [
          { elementId: "outer", structuralKind: "region", size: { width: 240, height: 160 } },
          { elementId: "inner", structuralKind: "region", size: { width: 240, height: 160 } },
          {
            elementId: "member",
            structuralKind: "node",
            placement: "user",
            geometry: { x: 600, y: 400, width: 100, height: 60 },
          },
        ],
        memberships: [
          {
            semanticRef: "outer-inner",
            containerElementId: "outer",
            regionElementId: "outer",
            memberElementId: "inner",
          },
          {
            semanticRef: "inner-member",
            containerElementId: "inner",
            regionElementId: "inner",
            memberElementId: "member",
          },
        ],
        edges: [],
      },
    }, createStandardLayoutRegistry());

    expect(isInside(result.geometries.member!, result.geometries.inner!)).toBe(true);
    expect(isInside(result.geometries.inner!, result.geometries.outer!)).toBe(true);
    expect(result.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
  });

  it("reapplies normalized endpoint anchors after generated region expansion", async () => {
    const result = await layoutProjectedScene({
      layoutRef: STANDARD_LAYOUT_REFS.hierarchicalLr,
      scene: {
        elements: [
          { elementId: "region", structuralKind: "region", size: { width: 240, height: 160 } },
          {
            elementId: "member",
            structuralKind: "node",
            placement: "user",
            geometry: { x: 500, y: 300, width: 100, height: 60 },
          },
          { elementId: "target", structuralKind: "node" },
        ],
        memberships: [{
          semanticRef: "region-member",
          containerElementId: "region",
          regionElementId: "region",
          memberElementId: "member",
        }],
        edges: [{
          elementId: "edge",
          sourceElementId: "region",
          targetElementId: "target",
          sourceAnchor: { position: .25 },
        }],
      },
    }, createStandardLayoutRegistry());

    const region = result.geometries.region!;
    expect(result.routes.edge?.[0]).toEqual({
      x: region.x + region.width,
      y: region.y + region.height / 2,
    });
  });

  it("rejects adapter routes that omit endpoint-inclusive edge paths", async () => {
    const invalid: LayoutAdapter = {
      layoutRef: "urn:test:layout:invalid-route",
      async layout(request) {
        return {
          layoutRef: request.layoutRef,
          geometries: {
            a: { x: 0, y: 0, width: 100, height: 50 },
            b: { x: 200, y: 0, width: 100, height: 50 },
          },
          routes: { edge: [{ x: 100, y: 25 }] },
          width: 300,
          height: 50,
          diagnostics: [],
        };
      },
    };

    const result = await layoutProjectedScene({
      layoutRef: invalid.layoutRef,
      scene: {
        elements: [
          { elementId: "a", structuralKind: "node" },
          { elementId: "b", structuralKind: "node" },
        ],
        edges: [{ elementId: "edge", sourceElementId: "a", targetElementId: "b" }],
      },
    }, new LayoutAdapterRegistry([invalid]));

    expect(result.routes).toEqual({});
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      severity: "error",
      code: "layout-result-invalid",
      edgeId: "edge",
    }));
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

function polylineCrossesBox(
  route: readonly { x: number; y: number }[],
  box: { x: number; y: number; width: number; height: number },
): boolean {
  for (let index = 0; index < route.length - 1; index += 1) {
    const start = route[index]!;
    const end = route[index + 1]!;
    if (start.x === end.x) {
      if (
        start.x > box.x
        && start.x < box.x + box.width
        && Math.max(Math.min(start.y, end.y), box.y) < Math.min(Math.max(start.y, end.y), box.y + box.height)
      ) return true;
    } else if (start.y === end.y) {
      if (
        start.y > box.y
        && start.y < box.y + box.height
        && Math.max(Math.min(start.x, end.x), box.x) < Math.min(Math.max(start.x, end.x), box.x + box.width)
      ) return true;
    }
  }
  return false;
}

function polylineOverlapLength(
  left: readonly { x: number; y: number }[],
  right: readonly { x: number; y: number }[],
): number {
  let total = 0;
  for (let leftIndex = 0; leftIndex < left.length - 1; leftIndex += 1) {
    const leftStart = left[leftIndex]!;
    const leftEnd = left[leftIndex + 1]!;
    for (let rightIndex = 0; rightIndex < right.length - 1; rightIndex += 1) {
      const rightStart = right[rightIndex]!;
      const rightEnd = right[rightIndex + 1]!;
      if (leftStart.x === leftEnd.x && rightStart.x === rightEnd.x && leftStart.x === rightStart.x) {
        total += intervalOverlap(leftStart.y, leftEnd.y, rightStart.y, rightEnd.y);
      } else if (leftStart.y === leftEnd.y && rightStart.y === rightEnd.y && leftStart.y === rightStart.y) {
        total += intervalOverlap(leftStart.x, leftEnd.x, rightStart.x, rightEnd.x);
      }
    }
  }
  return total;
}

function intervalOverlap(leftA: number, leftB: number, rightA: number, rightB: number): number {
  return Math.max(
    0,
    Math.min(Math.max(leftA, leftB), Math.max(rightA, rightB))
      - Math.max(Math.min(leftA, leftB), Math.min(rightA, rightB)),
  );
}

function polylineStrictCrossings(
  left: readonly { x: number; y: number }[],
  right: readonly { x: number; y: number }[],
): number {
  let crossings = 0;
  for (let leftIndex = 0; leftIndex < left.length - 1; leftIndex += 1) {
    for (let rightIndex = 0; rightIndex < right.length - 1; rightIndex += 1) {
      if (segmentsCrossStrictly(
        left[leftIndex]!,
        left[leftIndex + 1]!,
        right[rightIndex]!,
        right[rightIndex + 1]!,
      )) crossings += 1;
    }
  }
  return crossings;
}

function segmentsCrossStrictly(
  leftStart: { x: number; y: number },
  leftEnd: { x: number; y: number },
  rightStart: { x: number; y: number },
  rightEnd: { x: number; y: number },
): boolean {
  const leftDx = leftEnd.x - leftStart.x;
  const leftDy = leftEnd.y - leftStart.y;
  const rightDx = rightEnd.x - rightStart.x;
  const rightDy = rightEnd.y - rightStart.y;
  const denominator = leftDx * rightDy - leftDy * rightDx;
  if (denominator === 0) return false;
  const offsetX = rightStart.x - leftStart.x;
  const offsetY = rightStart.y - leftStart.y;
  const leftRatio = (offsetX * rightDy - offsetY * rightDx) / denominator;
  const rightRatio = (offsetX * leftDy - offsetY * leftDx) / denominator;
  return leftRatio > 0 && leftRatio < 1 && rightRatio > 0 && rightRatio < 1;
}
