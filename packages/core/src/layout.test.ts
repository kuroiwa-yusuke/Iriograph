import { describe, expect, it } from "vitest";

import {
  LayoutAdapterRegistry,
  STANDARD_LAYOUT_REFS,
  StandardLightweightLayoutAdapter,
  completeRegionLayout,
  createStandardLayoutRegistry,
  flattenLayoutDerivedCurve,
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
    expect(result.routes["flow-1"]!.length).toBeGreaterThanOrEqual(2);
    expect(result.routes["flow-1"]!.length).toBeLessThanOrEqual(3);
  });

  it("uses DOM-free content minima for generated nodes and group frames only", async () => {
    const fixedGeometry = { x: 900, y: 40, width: 100, height: 50 };
    const scene: LayoutProjectedScene = {
      elements: [
        {
          elementId: "content-node",
          structuralKind: "node",
          minimumContentSize: { width: 420, height: 150 },
        },
        {
          elementId: "content-group",
          structuralKind: "container",
          minimumContentSize: { width: 520, height: 210 },
        },
        {
          elementId: "invalid-minimum",
          structuralKind: "node",
          minimumContentSize: { width: Number.NaN, height: 900 },
        },
        {
          elementId: "fixed",
          structuralKind: "node",
          placement: "user",
          geometry: fixedGeometry,
          minimumContentSize: { width: 900, height: 500 },
        },
      ],
      edges: [],
    };
    const adapter = new StandardLightweightLayoutAdapter("urn:test:layout:content-minimum", "LR");

    const result = await adapter.layout({ layoutRef: adapter.layoutRef, scene });

    expect(result.geometries["content-node"]).toMatchObject({ width: 420, height: 150 });
    expect(result.geometries["content-group"]).toMatchObject({ width: 520, height: 210 });
    expect(result.geometries["invalid-minimum"]).toMatchObject({ width: 160, height: 72 });
    expect(result.geometries.fixed).toEqual(fixedGeometry);
  });

  it("route-onlyでfixed derived routeを全routing段階から除外し実処理数を観測する", async () => {
    const samples: Array<{ routedEdges: number; fixedDerivedRoutes: number }> = [];
    const adapter = new StandardLightweightLayoutAdapter(
      "urn:test:localized-route",
      "LR",
      (sample) => { samples.push(sample); },
    );
    const fixedRoute = [
      { x: 148, y: 78, extensions: { token: "keep" } },
      { x: 268, y: 78 },
    ];
    const result = await layoutProjectedScene({
      layoutRef: adapter.layoutRef,
      mode: "route-only",
      fixedDerivedRoutes: { stable: fixedRoute },
      scene: {
        elements: [
          { elementId: "a", structuralKind: "node", geometry: { x: 48, y: 48, width: 100, height: 60 }, pinned: true, placement: "user" },
          { elementId: "b", structuralKind: "node", geometry: { x: 268, y: 48, width: 100, height: 60 }, pinned: true, placement: "user" },
          { elementId: "c", structuralKind: "node", geometry: { x: 48, y: 208, width: 100, height: 60 }, pinned: true, placement: "user" },
          { elementId: "d", structuralKind: "node", geometry: { x: 268, y: 208, width: 100, height: 60 }, pinned: true, placement: "user" },
        ],
        edges: [
          { elementId: "stable", sourceElementId: "a", targetElementId: "b" },
          { elementId: "affected", sourceElementId: "c", targetElementId: "d" },
        ],
      },
    }, new LayoutAdapterRegistry([adapter]));

    expect(result.diagnostics).toEqual([]);
    expect(result.routes.stable).toEqual(fixedRoute);
    expect(result.derivedRouteChoices?.stable).toMatchObject({
      family: "straight",
      source: "fixed",
      reason: "fixed-derived-route",
    });
    expect(samples).toEqual([expect.objectContaining({
      routedEdges: 1,
      fixedDerivedRoutes: 1,
    })]);
  });

  it("optional fixed routeを無視するthird-party adapterも共通completionでexact維持する", async () => {
    const fixedRoute = [{ x: 10, y: 10 }, { x: 90, y: 10 }];
    const fixedChoice = {
      family: "curve" as const,
      source: "fixed" as const,
      reason: "fixed-derived-route" as const,
      curve: {
        sourceControl: { x: 30, y: -30 },
        targetControl: { x: 70, y: 50 },
        guidePivot: { x: 50, y: 10 },
        guideAngleDegrees: 120,
      },
      rejected: [{ family: "straight" as const, reason: "obstacle" as const }],
    };
    const adapter: LayoutAdapter = {
      layoutRef: "urn:test:third-party-fixed-route",
      async layout(request) {
        return {
          layoutRef: request.layoutRef,
          geometries: {
            a: { x: 0, y: 0, width: 20, height: 20 },
            b: { x: 80, y: 0, width: 20, height: 20 },
          },
          routes: { stable: [{ x: 0, y: 0 }, { x: 100, y: 20 }] },
          width: 100,
          height: 20,
          diagnostics: [],
        };
      },
    };
    const result = await layoutProjectedScene({
      layoutRef: adapter.layoutRef,
      mode: "route-only",
      fixedDerivedRoutes: { stable: fixedRoute },
      fixedDerivedRouteChoices: { stable: fixedChoice },
      scene: {
        elements: [
          { elementId: "a", structuralKind: "node", geometry: { x: 0, y: 0, width: 20, height: 20 }, pinned: true, placement: "user" },
          { elementId: "b", structuralKind: "node", geometry: { x: 80, y: 0, width: 20, height: 20 }, pinned: true, placement: "user" },
        ],
        edges: [{ elementId: "stable", sourceElementId: "a", targetElementId: "b" }],
      },
    }, new LayoutAdapterRegistry([adapter]));

    expect(result.diagnostics).toEqual([]);
    expect(result.routes.stable).toEqual(fixedRoute);
    expect(result.derivedRouteChoices?.stable).toEqual(fixedChoice);
  });

  it("route-onlyのfixed choiceはexplicit familyとauto curve controlsを完全に維持する", async () => {
    const curveChoice = {
      family: "curve" as const,
      source: "fixed" as const,
      reason: "fixed-derived-route" as const,
      curve: {
        sourceControl: { x: 158, y: -40 },
        targetControl: { x: 258, y: 160 },
        guidePivot: { x: 208, y: 60 },
        guideAngleDegrees: 122,
      },
      rejected: [{ family: "straight" as const, reason: "obstacle" as const }],
    };
    const fixedDerivedRoutes = {
      straight: [{ x: 148, y: 78 }, { x: 268, y: 78 }],
      orthogonal: [{ x: 148, y: 208 }, { x: 208, y: 268 }, { x: 268, y: 268 }],
      curve: [{ x: 148, y: 348 }, { x: 268, y: 348 }],
    };
    const fixedDerivedRouteChoices = {
      straight: {
        family: "straight" as const,
        source: "fixed" as const,
        reason: "fixed-derived-route" as const,
      },
      orthogonal: {
        family: "orthogonal" as const,
        source: "fixed" as const,
        reason: "fixed-derived-route" as const,
      },
      curve: curveChoice,
    };
    const adapter = new StandardLightweightLayoutAdapter("urn:test:fixed-choice", "LR");
    const result = await layoutProjectedScene({
      layoutRef: adapter.layoutRef,
      mode: "route-only",
      fixedDerivedRoutes,
      fixedDerivedRouteChoices,
      scene: {
        elements: [
          { elementId: "a", structuralKind: "node", geometry: { x: 48, y: 48, width: 100, height: 60 }, pinned: true, placement: "user" },
          { elementId: "b", structuralKind: "node", geometry: { x: 268, y: 48, width: 100, height: 60 }, pinned: true, placement: "user" },
          { elementId: "c", structuralKind: "node", geometry: { x: 48, y: 238, width: 100, height: 60 }, pinned: true, placement: "user" },
          { elementId: "d", structuralKind: "node", geometry: { x: 268, y: 238, width: 100, height: 60 }, pinned: true, placement: "user" },
          { elementId: "e", structuralKind: "node", geometry: { x: 48, y: 318, width: 100, height: 60 }, pinned: true, placement: "user" },
          { elementId: "f", structuralKind: "node", geometry: { x: 268, y: 318, width: 100, height: 60 }, pinned: true, placement: "user" },
        ],
        edges: [
          { elementId: "straight", sourceElementId: "a", targetElementId: "b", routeMode: "straight" },
          { elementId: "orthogonal", sourceElementId: "c", targetElementId: "d", routeMode: "orthogonal" },
          { elementId: "curve", sourceElementId: "e", targetElementId: "f", routeMode: "curve" },
        ],
      },
    }, new LayoutAdapterRegistry([adapter]));

    expect(result.diagnostics).toEqual([]);
    expect(result.routes).toEqual(fixedDerivedRoutes);
    expect(result.derivedRouteChoices).toEqual(fixedDerivedRouteChoices);
  });

  it("affected routeの交差costへfixed peer routeを含める", async () => {
    const fixedRoute = [{ x: 320, y: -40 }, { x: 320, y: 300 }];
    const scene: LayoutProjectedScene = {
      elements: [
        { elementId: "left", structuralKind: "node", geometry: { x: 20, y: 100, width: 100, height: 60 }, pinned: true, placement: "user" },
        { elementId: "right", structuralKind: "node", geometry: { x: 520, y: 100, width: 100, height: 60 }, pinned: true, placement: "user" },
        { elementId: "top", structuralKind: "node", geometry: { x: 270, y: -400, width: 100, height: 60 }, pinned: true, placement: "user" },
        { elementId: "bottom", structuralKind: "node", geometry: { x: 270, y: 600, width: 100, height: 60 }, pinned: true, placement: "user" },
      ],
      edges: [
        { elementId: "fixed", sourceElementId: "top", targetElementId: "bottom" },
        { elementId: "affected", sourceElementId: "left", targetElementId: "right" },
      ],
    };
    const adapter = new StandardLightweightLayoutAdapter("urn:test:fixed-peer-cost", "LR");

    const result = await adapter.layout({
      layoutRef: adapter.layoutRef,
      mode: "route-only",
      fixedDerivedRoutes: { fixed: fixedRoute },
      scene,
    });

    expect(result.routes.fixed).toEqual(fixedRoute);
    const affectedChoice = result.derivedRouteChoices?.affected;
    const affectedRoute = affectedChoice?.curve
      ? flattenLayoutDerivedCurve(result.routes.affected!, affectedChoice.curve)
      : result.routes.affected!;
    expect(polylineStrictCrossings(affectedRoute, result.routes.fixed!)).toBe(0);
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

  it("completes an Alt group frame from alternative memberships without semantic edges", () => {
    const layoutRef = "urn:test:alternative-enclosure";
    const request: LayoutRequest = {
      layoutRef,
      scene: {
        elements: [
          { elementId: "alternative", structuralKind: "container", groupRole: "alternative" },
          { elementId: "candidate-a", structuralKind: "node" },
          { elementId: "candidate-b", structuralKind: "node" },
        ],
        edges: [],
        memberships: [
          {
            semanticRef: "alt-1",
            containerElementId: "alternative",
            memberElementId: "candidate-a",
            role: "alternative-member",
            ordinal: 1,
          },
          {
            semanticRef: "alt-2",
            containerElementId: "alternative",
            memberElementId: "candidate-b",
            role: "alternative-member",
            ordinal: 2,
          },
        ],
      },
    };
    const result = completeRegionLayout(request, {
      layoutRef,
      geometries: {
        alternative: { x: 0, y: 0, width: 120, height: 80 },
        "candidate-a": { x: 200, y: 120, width: 100, height: 60 },
        "candidate-b": { x: 420, y: 220, width: 100, height: 60 },
      },
      routes: {},
      width: 600,
      height: 400,
      diagnostics: [],
    });

    expect(isInside(result.geometries["candidate-a"]!, result.geometries.alternative!)).toBe(true);
    expect(isInside(result.geometries["candidate-b"]!, result.geometries.alternative!)).toBe(true);
    expect(result.routes).toEqual({});
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
    expect(result.derivedRouteChoices?.edge).toEqual({
      family: "straight",
      source: "explicit",
      reason: "explicit-route-mode",
    });
    expect(result.routes.edge?.[0]).toEqual({
      x: result.geometries.a!.x + result.geometries.a!.width,
      y: result.geometries.a!.y + result.geometries.a!.height / 2,
    });
    expect(result.routes.edge?.at(-1)).toEqual({
      x: result.geometries.b!.x,
      y: result.geometries.b!.y + result.geometries.b!.height / 2,
    });
  });

  it("uses no derived pivot when a direct curve corridor already satisfies quality", async () => {
    const scene: LayoutProjectedScene = {
      elements: [
        { elementId: "a", structuralKind: "node" },
        { elementId: "b", structuralKind: "node" },
      ],
      edges: [{ elementId: "edge", sourceElementId: "a", targetElementId: "b", routeMode: "curve" }],
    };
    const adapter = new StandardLightweightLayoutAdapter("urn:test:layout:curve", "LR");

    const result = await adapter.layout({ layoutRef: adapter.layoutRef, scene });

    expect(result.routes.edge).toHaveLength(2);
    expect(result.derivedRouteChoices?.edge).toMatchObject({
      family: "curve",
      source: "explicit",
      reason: "explicit-route-mode",
      curve: {
        guideAngleDegrees: expect.any(Number),
      },
    });
  });

  it("keeps an explicit orthogonal family instead of auto-selecting another mode", async () => {
    const scene: LayoutProjectedScene = {
      elements: [
        { elementId: "a", structuralKind: "node" },
        { elementId: "b", structuralKind: "node" },
      ],
      edges: [{
        elementId: "edge",
        sourceElementId: "a",
        targetElementId: "b",
        routeMode: "orthogonal",
      }],
    };
    const adapter = new StandardLightweightLayoutAdapter("urn:test:layout:orthogonal", "LR");

    const result = await adapter.layout({ layoutRef: adapter.layoutRef, scene });

    expect(result.routes.edge!.length).toBeLessThanOrEqual(3);
    expect(result.derivedRouteChoices?.edge).toEqual({
      family: "orthogonal",
      source: "explicit",
      reason: "explicit-route-mode",
    });
  });

  it.each(["LR", "TB"] as const)(
    "chooses an endpoint-only straight family for an unobstructed auto edge in %s",
    async (direction) => {
      const scene: LayoutProjectedScene = {
        elements: [
          { elementId: "a", structuralKind: "node" },
          { elementId: "b", structuralKind: "node" },
        ],
        edges: [{ elementId: "edge", sourceElementId: "a", targetElementId: "b" }],
      };
      const snapshot = structuredClone(scene);
      const adapter = new StandardLightweightLayoutAdapter(
        `urn:test:layout:auto-straight-${direction}`,
        direction,
      );

      const result = await adapter.layout({ layoutRef: adapter.layoutRef, scene });

      expect(result.routes.edge).toHaveLength(2);
      expect(result.derivedRouteChoices?.edge).toEqual({
        family: "straight",
        source: "auto",
        reason: "auto-straight-safe",
      });
      expect(scene).toEqual(snapshot);
    },
  );

  it.each(["LR", "TB"] as const)(
    "chooses a valid one-bend orthogonal route before a viable curve in %s",
    async (direction) => {
      const scene: LayoutProjectedScene = {
        elements: [
          {
            elementId: "source",
            structuralKind: "node",
            placement: "user",
            geometry: { x: 0, y: 0, width: 100, height: 60 },
          },
          {
            elementId: "blocker",
            structuralKind: "node",
            placement: "user",
            geometry: { x: 170, y: 105, width: 60, height: 50 },
          },
          {
            elementId: "target",
            structuralKind: "node",
            placement: "user",
            geometry: { x: 300, y: 200, width: 100, height: 60 },
          },
        ],
        edges: [{ elementId: "edge", sourceElementId: "source", targetElementId: "target" }],
      };
      const adapter = new StandardLightweightLayoutAdapter(
        `urn:test:layout:auto-orthogonal-${direction}`,
        direction,
      );

      const result = await adapter.layout({ layoutRef: adapter.layoutRef, scene });
      const route = result.routes.edge!;

      expect(route).toHaveLength(3);
      expect(result.derivedRouteChoices?.edge).toEqual({
        family: "orthogonal",
        source: "auto",
        reason: "auto-orthogonal-safe",
        rejected: [{ family: "straight", reason: "obstacle" }],
      });
      expect(
        (route[0]!.y === route[1]!.y && route[1]!.x === route[2]!.x)
        || (route[0]!.x === route[1]!.x && route[1]!.y === route[2]!.y),
      ).toBe(true);
      expect(polylineCrossesBox(route, scene.elements[1]!.geometry!)).toBe(false);
    },
  );

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
    const choice = result.derivedRouteChoices?.edge;
    const renderedRoute = choice?.curve
      ? flattenLayoutDerivedCurve(route, choice.curve)
      : route;

    expect(scene.edges[0]!.waypoints).toBeUndefined();
    expect(route).toHaveLength(2);
    expect(choice).toMatchObject({
      family: "curve",
      source: "auto",
      reason: "auto-curve-safe",
      curve: { guideAngleDegrees: expect.any(Number) },
      rejected: expect.arrayContaining([
        { family: "straight", reason: "obstacle" },
      ]),
    });
    expect(choice!.curve!.guideAngleDegrees).toBeGreaterThanOrEqual(90);
    expect(renderedRoute.length).toBeGreaterThan(2);
    expect(polylineCrossesBox(renderedRoute, scene.elements[1]!.geometry!)).toBe(false);
    expect(polylineCrossesBox(renderedRoute, scene.elements[2]!.geometry!)).toBe(false);
    expect(result.geometries.source).toEqual(scene.elements[0]!.geometry);
    expect(result.geometries.target).toEqual(scene.elements[3]!.geometry);
  });

  it("keeps generated routes clear of non-endpoint node boundaries after SVG fitting", async () => {
    const boundaryBlocker = { x: 1531, y: 472, width: 164, height: 72 };
    const scene: LayoutProjectedScene = {
      elements: [
        { elementId: "source", structuralKind: "node", placement: "user", geometry: { x: 1670, y: 1357, width: 164, height: 72 } },
        { elementId: "target", structuralKind: "node", placement: "user", geometry: { x: 1531, y: 352, width: 164, height: 72 } },
        { elementId: "blocker", structuralKind: "node", placement: "user", geometry: boundaryBlocker },
      ],
      edges: [{ elementId: "edge", sourceElementId: "source", targetElementId: "target" }],
    };
    const adapter = new StandardLightweightLayoutAdapter("urn:test:layout:boundary-clearance", "LR");

    const result = await adapter.layout({ layoutRef: adapter.layoutRef, scene });
    const choice = result.derivedRouteChoices?.edge;
    const rendered = choice?.curve
      ? flattenLayoutDerivedCurve(result.routes.edge!, choice.curve, 64)
      : result.routes.edge!;
    const fittedBoundary = {
      x: boundaryBlocker.x - 0.5,
      y: boundaryBlocker.y - 0.5,
      width: boundaryBlocker.width + 1,
      height: boundaryBlocker.height + 1,
    };

    expect(result.routes.edge!.length).toBeGreaterThanOrEqual(2);
    expect(result.routes.edge!.length).toBeLessThanOrEqual(3);
    expect(polylineIntersectsBoxInterior(rendered, fittedBoundary)).toBe(false);
  });

  it("derives fallback clearance from a very large resized obstacle", async () => {
    const blocker = { x: 220, y: -1_500, width: 160, height: 3_000 };
    const scene: LayoutProjectedScene = {
      elements: [
        { elementId: "source", structuralKind: "node", placement: "user", geometry: { x: 20, y: 100, width: 100, height: 60 } },
        { elementId: "giant", structuralKind: "node", placement: "user", geometry: blocker },
        { elementId: "target", structuralKind: "node", placement: "user", geometry: { x: 500, y: 100, width: 100, height: 60 } },
      ],
      edges: [{ elementId: "edge", sourceElementId: "source", targetElementId: "target" }],
    };
    const adapter = new StandardLightweightLayoutAdapter("urn:test:layout:giant-obstacle", "LR");

    const result = await adapter.layout({ layoutRef: adapter.layoutRef, scene });
    const choice = result.derivedRouteChoices?.edge;
    const rendered = choice?.curve
      ? flattenLayoutDerivedCurve(result.routes.edge!, choice.curve)
      : result.routes.edge!;

    expect(result.routes.edge).toHaveLength(2);
    expect(polylineIntersectsBoxInterior(rendered, blocker)).toBe(false);
    expect(choice).toMatchObject({
      family: "curve",
      source: "auto",
      reason: "auto-curve-safe",
      curve: { guideAngleDegrees: expect.any(Number) },
      rejected: expect.arrayContaining([
        { family: "straight", reason: "obstacle" },
      ]),
    });
    expect(choice!.curve!.guideAngleDegrees).toBeGreaterThanOrEqual(90);
    expect(result.diagnostics).not.toContainEqual(expect.objectContaining({
      code: "layout-auto-route-unresolved",
    }));
  });

  it("keeps ordinary Bezier controls and rendered arcs inside a local geometry envelope", async () => {
    const scene: LayoutProjectedScene = {
      elements: [
        { elementId: "source", structuralKind: "node", placement: "user", geometry: { x: 400, y: 20, width: 160, height: 72 } },
        { elementId: "blocker-a", structuralKind: "node", placement: "user", geometry: { x: 400, y: 430, width: 160, height: 72 } },
        { elementId: "blocker-b", structuralKind: "node", placement: "user", geometry: { x: 400, y: 850, width: 160, height: 72 } },
        { elementId: "target", structuralKind: "node", placement: "user", geometry: { x: 400, y: 1_260, width: 160, height: 72 } },
      ],
      edges: [{ elementId: "edge", sourceElementId: "source", targetElementId: "target" }],
    };
    const adapter = new StandardLightweightLayoutAdapter("urn:test:layout:local-curve-envelope", "LR");

    const result = await adapter.layout({ layoutRef: adapter.layoutRef, scene });
    const route = result.routes.edge!;
    const choice = result.derivedRouteChoices?.edge;

    expect(choice).toMatchObject({
      family: "curve",
      source: "auto",
      reason: "auto-curve-safe",
    });
    const curve = choice!.curve!;
    const rendered = flattenLayoutDerivedCurve(route, curve, 64);
    expect(polylineIntersectsBoxInterior(rendered, scene.elements[1]!.geometry!)).toBe(false);
    expect(polylineIntersectsBoxInterior(rendered, scene.elements[2]!.geometry!)).toBe(false);

    // The normal-size route may use a bounded detour, but neither its hidden
    // controls nor its visible arc may escape into a scene-wide outer loop.
    const localEnvelope = { left: 40, top: -340, right: 920, bottom: 1_692 };
    for (const point of [curve.sourceControl, curve.targetControl, ...rendered]) {
      expect(point.x).toBeGreaterThanOrEqual(localEnvelope.left);
      expect(point.x).toBeLessThanOrEqual(localEnvelope.right);
      expect(point.y).toBeGreaterThanOrEqual(localEnvelope.top);
      expect(point.y).toBeLessThanOrEqual(localEnvelope.bottom);
    }
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
    expect(result.derivedRouteChoices?.edge).toEqual({
      family: "manual",
      source: "explicit",
      reason: "explicit-route-mode",
    });
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
    const choice = result.derivedRouteChoices?.edge;
    const rendered = choice?.curve
      ? flattenLayoutDerivedCurve(route, choice.curve)
      : route;

    expect(route[0]).toEqual({ x: 70, y: 100 });
    expect(rendered[1]!.y).toBeLessThan(rendered[0]!.y);
    expect(polylineCrossesBox(rendered.slice(0, 2), source)).toBe(false);
  });

  it("keeps generated routes local when avoiding a later manual route would require a remote pivot", async () => {
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
    expect(first.derivedRouteChoices).toEqual(second.derivedRouteChoices);
    expect(first.routes["z-manual"]).toEqual([
      { x: 120, y: 200 },
      { x: 300, y: 200 },
      { x: 540, y: 200 },
    ]);
    expect(polylineStrictCrossings(
      first.routes["a-generated"]!,
      first.routes["z-manual"]!,
    )).toBe(1);
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

  it("deterministically minimizes crossings without traversing nodes under the one-pivot limit", async () => {
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
    expect(Object.values(first.routes).every((route) => route.length <= 3)).toBe(true);
    expect(polylineOverlapLength(first.routes["cross-a"]!, first.routes["cross-b"]!)).toBe(0);
    // With four nodes at opposing corners, avoiding both non-endpoint nodes
    // and the other diagonal is not possible with only one pivot per edge.
    expect(polylineStrictCrossings(first.routes["cross-a"]!, first.routes["cross-b"]!)).toBe(1);
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
    expect(Object.values(first.routes).every((route) => route.length >= 2 && route.length <= 3)).toBe(true);
    expect(new Set([
      JSON.stringify(first.routes["forward-a"]),
      JSON.stringify(first.routes["forward-z"]),
      JSON.stringify(first.routes.reverse),
    ])).toHaveProperty("size", 3);
    expect(first.routes["forward-a"]?.[0]?.y).toBeCloseTo(68);
    expect(first.routes["forward-z"]?.[0]?.y).toBeCloseTo(88);
    expect(first.routes.reverse?.at(-1)?.y).toBeCloseTo(108);
    const renderedLoop = (edgeId: string) => {
      const choice = first.derivedRouteChoices?.[edgeId];
      return choice?.curve
        ? flattenLayoutDerivedCurve(first.routes[edgeId]!, choice.curve)
        : first.routes[edgeId]!;
    };
    expect(Math.max(...renderedLoop("loop-a").map((point) => point.x))).toBeGreaterThan(168);
    expect(Math.max(...renderedLoop("loop-z").map((point) => point.x)))
      .toBeGreaterThan(Math.max(...renderedLoop("loop-a").map((point) => point.x)));
    expect(first.derivedRouteChoices?.["loop-a"]).toMatchObject({
      family: "curve",
      source: "auto",
      reason: "auto-curve-safe",
      rejected: expect.arrayContaining([
        { family: "straight", reason: "self-loop" },
      ]),
    });
    expect(first.width).toBeGreaterThanOrEqual(270);
  });

  it("keeps parallel lanes distinct when fixed endpoint boxes overlap on the primary axis", async () => {
    const scene: LayoutProjectedScene = {
      elements: [
        {
          elementId: "review",
          structuralKind: "node",
          placement: "user",
          geometry: { x: 430, y: 274, width: 170, height: 76 },
        },
        {
          elementId: "policy",
          structuralKind: "node",
          placement: "user",
          geometry: { x: 486, y: 382, width: 168, height: 72 },
        },
      ],
      edges: [
        { elementId: "related", sourceElementId: "review", targetElementId: "policy" },
        { elementId: "reference", sourceElementId: "review", targetElementId: "policy" },
      ],
    };
    const adapter = new StandardLightweightLayoutAdapter("urn:test:layout:overlapping-primary-parallel", "LR");

    const result = await adapter.layout({ layoutRef: adapter.layoutRef, scene });

    const relatedChoice = result.derivedRouteChoices?.related;
    const referenceChoice = result.derivedRouteChoices?.reference;
    const relatedRendered = relatedChoice?.curve
      ? flattenLayoutDerivedCurve(result.routes.related!, relatedChoice.curve)
      : result.routes.related!;
    const referenceRendered = referenceChoice?.curve
      ? flattenLayoutDerivedCurve(result.routes.reference!, referenceChoice.curve)
      : result.routes.reference!;
    expect(relatedRendered).not.toEqual(referenceRendered);
    expect(relatedChoice?.family).toMatch(/^(straight|orthogonal|curve|polyline)$/);
    expect(referenceChoice?.family).toMatch(/^(straight|orthogonal|curve|polyline)$/);
    expect([relatedChoice?.family, referenceChoice?.family].filter((family) => family === "straight"))
      .toHaveLength(1);
    expect(result.routes.related!.length).toBeLessThanOrEqual(3);
    expect(result.routes.reference!.length).toBeLessThanOrEqual(3);
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
    const signatures = edges.map((edge) => {
      const route = result.routes[edge.elementId]!;
      const choice = result.derivedRouteChoices?.[edge.elementId];
      return JSON.stringify(choice?.curve
        ? flattenLayoutDerivedCurve(route, choice.curve)
        : route);
    });

    expect(new Set(signatures).size).toBe(edges.length);
    expect(Object.values(result.routes).every((route) => route.length >= 2 && route.length <= 3)).toBe(true);
    expect(Object.values(result.routes).flat().every((point) => point.y >= 0)).toBe(true);
    expect(result.height).toBeGreaterThanOrEqual(98);
  });

  it("keeps large-graph route-family classification linear and bounded", async () => {
    const edges = Array.from({ length: 513 }, (_, index) => ({
      elementId: `edge-${String(index).padStart(3, "0")}`,
      sourceElementId: "a",
      targetElementId: "b",
    }));
    const scene: LayoutProjectedScene = {
      elements: [
        { elementId: "a", structuralKind: "node" },
        { elementId: "b", structuralKind: "node" },
      ],
      edges,
    };
    const adapter = new StandardLightweightLayoutAdapter("urn:test:layout:large-family", "LR");

    const result = await adapter.layout({ layoutRef: adapter.layoutRef, scene });

    expect(Object.keys(result.derivedRouteChoices ?? {})).toHaveLength(edges.length);
    expect(Object.values(result.routes).every((route) => route.length <= 3)).toBe(true);
    expect(Object.values(result.derivedRouteChoices ?? {}).every((choice) => (
      choice.family === "straight" || choice.family === "orthogonal" || choice.family === "curve"
    ))).toBe(true);
    expect(Object.values(result.derivedRouteChoices ?? {}).some((choice) => (
      choice.family === "curve"
    ))).toBe(true);
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

  it("structuralCompletion済みを名乗るadapterにも全Group Frameの共通包含を適用する", async () => {
    const layoutRef = "urn:test:layout:external-group-frame";
    const adapter: LayoutAdapter = {
      layoutRef,
      async layout() {
        return {
          layoutRef,
          structuralCompletion: true,
          geometries: {
            bag: { x: 0, y: 0, width: 80, height: 50 },
            classification: { x: 100, y: 0, width: 80, height: 50 },
            seq: { x: 200, y: 0, width: 80, height: 50 },
            alt: { x: 300, y: 0, width: 80, height: 50 },
            shared: { x: 500, y: 300, width: 120, height: 60 },
          },
          routes: {},
          width: 620,
          height: 360,
          diagnostics: [],
        };
      },
    };
    const result = await layoutProjectedScene({
      layoutRef,
      scene: {
        elements: [
          { elementId: "bag", structuralKind: "container", groupRole: "membership" },
          { elementId: "classification", structuralKind: "region", groupRole: "classification" },
          { elementId: "seq", structuralKind: "container", groupRole: "sequence" },
          { elementId: "alt", structuralKind: "container", groupRole: "alternative" },
          {
            elementId: "shared",
            structuralKind: "node",
            placement: "user",
            geometry: { x: 500, y: 300, width: 120, height: 60 },
          },
        ],
        memberships: [
          { semanticRef: "bag-member", containerElementId: "bag", memberElementId: "shared", role: "membership" },
          { semanticRef: "class-member", containerElementId: "classification", regionElementId: "classification", memberElementId: "shared", role: "membership" },
          { semanticRef: "seq-member", containerElementId: "seq", memberElementId: "shared", role: "sequence-member", ordinal: 1 },
          { semanticRef: "alt-member", containerElementId: "alt", memberElementId: "shared", role: "alternative-member", ordinal: 1 },
        ],
        edges: [],
      },
    }, new LayoutAdapterRegistry([adapter]));

    for (const groupId of ["bag", "classification", "seq", "alt"]) {
      expect(isInside(result.geometries.shared!, result.geometries[groupId]!)).toBe(true);
      expect(result.geometries[groupId]!.x).toBeLessThanOrEqual(500 - 28);
      expect(result.geometries[groupId]!.y).toBeLessThanOrEqual(300 - 28 - 36);
    }
    expect(result.diagnostics.some((item) => item.code.includes("outside"))).toBe(false);
  });

  it("Bagを含む固定multi-groupの共通intersection違反を動かさず診断する", async () => {
    const left = { x: 0, y: 0, width: 180, height: 140 };
    const right = { x: 260, y: 0, width: 180, height: 140 };
    const result = await layoutProjectedScene({
      layoutRef: STANDARD_LAYOUT_REFS.hierarchicalLr,
      scene: {
        elements: [
          { elementId: "bag", structuralKind: "container", groupRole: "membership", placement: "user", geometry: left },
          { elementId: "class", structuralKind: "region", groupRole: "classification", pinned: true, geometry: right },
          { elementId: "member", structuralKind: "node", placement: "user", geometry: { x: 40, y: 50, width: 60, height: 40 } },
        ],
        memberships: [
          { semanticRef: "bag-member", containerElementId: "bag", memberElementId: "member", role: "membership" },
          { semanticRef: "class-member", containerElementId: "class", regionElementId: "class", memberElementId: "member", role: "membership" },
        ],
        edges: [],
      },
    }, createStandardLayoutRegistry());

    expect(result.geometries.bag).toEqual(left);
    expect(result.geometries.class).toEqual(right);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      severity: "warning",
      code: "group-membership-intersection-empty",
      elementId: "member",
    }));
  });

  it("固定Bagではmember本体だけでなく共通padding不足も診断する", async () => {
    const bag = { x: 0, y: 0, width: 140, height: 120 };
    const member = { x: 4, y: 40, width: 60, height: 40 };
    const result = await layoutProjectedScene({
      layoutRef: STANDARD_LAYOUT_REFS.hierarchicalLr,
      scene: {
        elements: [
          { elementId: "bag", structuralKind: "container", groupRole: "membership", placement: "user", geometry: bag },
          { elementId: "member", structuralKind: "node", placement: "user", geometry: member },
        ],
        memberships: [{
          semanticRef: "bag-member",
          containerElementId: "bag",
          memberElementId: "member",
          role: "membership",
        }],
        edges: [],
      },
    }, createStandardLayoutRegistry());

    expect(result.geometries.bag).toEqual(bag);
    expect(result.geometries.member).toEqual(member);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: "group-member-outside",
      elementId: "member",
      message: expect.stringContaining("padding 28"),
    }));
  });

  it("通常の非Group containerをmembershipだけでGroup Frame化しない", async () => {
    const layoutRef = "urn:test:layout:ordinary-container";
    const ordinary = { x: 20, y: 20, width: 100, height: 80 };
    const adapter: LayoutAdapter = {
      layoutRef,
      async layout() {
        return {
          layoutRef,
          structuralCompletion: true,
          geometries: {
            ordinary,
            member: { x: 500, y: 300, width: 80, height: 40 },
          },
          routes: {},
          width: 580,
          height: 340,
          diagnostics: [],
        };
      },
    };
    const result = await layoutProjectedScene({
      layoutRef,
      scene: {
        elements: [
          { elementId: "ordinary", structuralKind: "container" },
          { elementId: "member", structuralKind: "node" },
        ],
        memberships: [{
          semanticRef: "not-a-group-contract",
          containerElementId: "ordinary",
          memberElementId: "member",
          role: "membership",
        }],
        edges: [],
      },
    }, new LayoutAdapterRegistry([adapter]));

    expect(result.geometries.ordinary).toEqual(ordinary);
  });

  it("external structuralCompletion後にも無関係regionを分離し未所属nodeを外へ出す", async () => {
    const layoutRef = "urn:test:layout:external-region-postcondition";
    const adapter: LayoutAdapter = {
      layoutRef,
      async layout() {
        return {
          layoutRef,
          structuralCompletion: true,
          geometries: {
            left: { x: 0, y: 0, width: 220, height: 160 },
            right: { x: 0, y: 0, width: 220, height: 160 },
            a: { x: 40, y: 70, width: 80, height: 40 },
            b: { x: 40, y: 70, width: 80, height: 40 },
            free: { x: 50, y: 80, width: 60, height: 30 },
          },
          routes: {},
          width: 220,
          height: 160,
          diagnostics: [],
        };
      },
    };
    const result = await layoutProjectedScene({
      layoutRef,
      scene: {
        elements: [
          { elementId: "left", structuralKind: "region", groupRole: "membership" },
          { elementId: "right", structuralKind: "region", groupRole: "membership" },
          { elementId: "a", structuralKind: "node" },
          { elementId: "b", structuralKind: "node" },
          { elementId: "free", structuralKind: "node" },
        ],
        memberships: [
          { semanticRef: "left-a", containerElementId: "left", regionElementId: "left", memberElementId: "a", role: "membership" },
          { semanticRef: "right-b", containerElementId: "right", regionElementId: "right", memberElementId: "b", role: "membership" },
        ],
        edges: [],
      },
    }, new LayoutAdapterRegistry([adapter]));

    expect(overlaps(result.geometries.left!, result.geometries.right!)).toBe(false);
    expect(overlaps(result.geometries.free!, result.geometries.left!)).toBe(false);
    expect(overlaps(result.geometries.free!, result.geometries.right!)).toBe(false);
  });

  it("共通Group Frame completionを再適用してもgeometryとdiagnosticを変えない", () => {
    const request: LayoutRequest = {
      layoutRef: "urn:test:layout:group-idempotence",
      scene: {
        elements: [
          { elementId: "bag", structuralKind: "container", groupRole: "membership" },
          { elementId: "region", structuralKind: "region", groupRole: "classification" },
          { elementId: "member", structuralKind: "node" },
        ],
        memberships: [
          { semanticRef: "bag-member", containerElementId: "bag", memberElementId: "member", role: "membership" },
          { semanticRef: "region-member", containerElementId: "region", regionElementId: "region", memberElementId: "member", role: "membership" },
        ],
        edges: [],
      },
    };
    const candidate = {
      layoutRef: request.layoutRef,
      geometries: {
        bag: { x: 0, y: 0, width: 80, height: 50 },
        region: { x: 0, y: 0, width: 80, height: 50 },
        member: { x: 400, y: 240, width: 100, height: 60 },
      },
      routes: {},
      width: 500,
      height: 300,
      diagnostics: [],
    };
    const first = completeRegionLayout(request, candidate);
    const second = completeRegionLayout(request, first);

    expect(second.geometries).toEqual(first.geometries);
    expect(second.routes).toEqual(first.routes);
    expect(second.diagnostics).toEqual(first.diagnostics);
  });

  it("standard adapterはnested regionのfixpoint後にrouteし外側completionで再移動しない", async () => {
    const request: LayoutRequest = {
      layoutRef: STANDARD_LAYOUT_REFS.hierarchicalLr,
      scene: {
        elements: [
          { elementId: "outer", structuralKind: "region", groupRole: "classification" },
          { elementId: "lane-a", structuralKind: "region", groupRole: "classification" },
          { elementId: "lane-b", structuralKind: "region", groupRole: "classification" },
          { elementId: "unrelated", structuralKind: "region", groupRole: "classification" },
          { elementId: "a", structuralKind: "node" },
          { elementId: "b", structuralKind: "node" },
          { elementId: "c", structuralKind: "node" },
        ],
        memberships: [
          { semanticRef: "outer-a", containerElementId: "outer", regionElementId: "outer", memberElementId: "lane-a", role: "membership" },
          { semanticRef: "outer-b", containerElementId: "outer", regionElementId: "outer", memberElementId: "lane-b", role: "membership" },
          { semanticRef: "lane-a-member", containerElementId: "lane-a", regionElementId: "lane-a", memberElementId: "a", role: "membership" },
          { semanticRef: "lane-b-member", containerElementId: "lane-b", regionElementId: "lane-b", memberElementId: "b", role: "membership" },
          { semanticRef: "unrelated-member", containerElementId: "unrelated", regionElementId: "unrelated", memberElementId: "c", role: "membership" },
        ],
        edges: [
          { elementId: "a-b", sourceElementId: "a", targetElementId: "b" },
          { elementId: "b-c", sourceElementId: "b", targetElementId: "c" },
        ],
      },
    };
    const adapter = new StandardLightweightLayoutAdapter(
      STANDARD_LAYOUT_REFS.hierarchicalLr,
      "LR",
    );
    const candidate = await adapter.layout(request);
    const completed = completeRegionLayout(request, candidate, "LR");

    expect(completed.geometries).toEqual(candidate.geometries);
    expect(completed.routes).toEqual(candidate.routes);
    expect(completed.diagnostics).toEqual(candidate.diagnostics);
  });

  it("external adapterの生成経路を1 pivotへ縮約しmanual経路をexact維持する", async () => {
    const layoutRef = "urn:test:layout:external-route-postcondition";
    const generated = [
      { x: 100, y: 25 },
      { x: 140, y: 0 },
      { x: 180, y: 60 },
      { x: 220, y: 0 },
      { x: 260, y: 25 },
    ];
    const manual = generated.map((point) => ({ ...point, y: point.y + 100 }));
    const adapter: LayoutAdapter = {
      layoutRef,
      async layout() {
        return {
          layoutRef,
          structuralCompletion: true,
          geometries: {
            a: { x: 0, y: 0, width: 100, height: 50 },
            b: { x: 260, y: 0, width: 100, height: 50 },
            c: { x: 0, y: 100, width: 100, height: 50 },
            d: { x: 260, y: 100, width: 100, height: 50 },
          },
          routes: { generated, manual },
          width: 360,
          height: 150,
          diagnostics: [],
        };
      },
    };
    const result = await layoutProjectedScene({
      layoutRef,
      scene: {
        elements: ["a", "b", "c", "d"].map((elementId) => ({ elementId, structuralKind: "node" as const })),
        edges: [
          { elementId: "generated", sourceElementId: "a", targetElementId: "b" },
          { elementId: "manual", sourceElementId: "c", targetElementId: "d", routeMode: "manual", routingPlacement: "user" },
        ],
      },
    }, new LayoutAdapterRegistry([adapter]));

    expect(result.routes.generated).toEqual([generated[0], generated[2], generated[4]]);
    expect(result.routes.manual).toEqual(manual);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: "layout-generated-route-compacted",
      edgeId: "generated",
    }));
  });

  it("external adapterのunknown endpointとderivedRouteChoice不整合をfail-closedにする", async () => {
    const layoutRef = "urn:test:layout:invalid-postcondition";
    const adapter: LayoutAdapter = {
      layoutRef,
      async layout() {
        return {
          layoutRef,
          structuralCompletion: true,
          geometries: { a: { x: 0, y: 0, width: 100, height: 50 } },
          routes: { edge: [{ x: 100, y: 25 }, { x: 200, y: 25 }] },
          derivedRouteChoices: {
            edge: { family: "straight", source: "fixed", reason: "fixed-derived-route" },
            unknown: { family: "curve", source: "auto", reason: "auto-curve-safe", curve: {
              sourceControl: { x: Number.NaN, y: 0 },
              targetControl: { x: 0, y: 0 },
              guidePivot: { x: 0, y: 0 },
              guideAngleDegrees: 90,
            } },
          },
          width: 200,
          height: 50,
          diagnostics: [],
        };
      },
    };
    const result = await layoutProjectedScene({
      layoutRef,
      scene: {
        elements: [{ elementId: "a", structuralKind: "node" }],
        edges: [{ elementId: "edge", sourceElementId: "a", targetElementId: "missing" }],
      },
    }, new LayoutAdapterRegistry([adapter]));

    expect(result.geometries).toEqual({});
    expect(result.diagnostics.filter((item) => item.code === "layout-result-invalid").length)
      .toBeGreaterThanOrEqual(2);
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

  it("keeps disjoint region members in stable cross-axis bands across ranks", async () => {
    const scene: LayoutProjectedScene = {
      elements: [
        { elementId: "region-a", structuralKind: "region" },
        { elementId: "region-b", structuralKind: "region" },
        { elementId: "a1", structuralKind: "node" },
        { elementId: "a2", structuralKind: "node" },
        { elementId: "b1", structuralKind: "node" },
        { elementId: "b2", structuralKind: "node" },
      ],
      edges: [
        { elementId: "a-flow", sourceElementId: "a1", targetElementId: "a2" },
        { elementId: "b-flow", sourceElementId: "b1", targetElementId: "b2" },
      ],
      memberships: [
        { semanticRef: "a1-m", containerElementId: "region-a", regionElementId: "region-a", memberElementId: "a1" },
        { semanticRef: "a2-m", containerElementId: "region-a", regionElementId: "region-a", memberElementId: "a2" },
        { semanticRef: "b1-m", containerElementId: "region-b", regionElementId: "region-b", memberElementId: "b1" },
        { semanticRef: "b2-m", containerElementId: "region-b", regionElementId: "region-b", memberElementId: "b2" },
      ],
    };
    const result = await layoutProjectedScene({
      layoutRef: STANDARD_LAYOUT_REFS.hierarchicalLr,
      scene,
    }, createStandardLayoutRegistry());

    expect(result.geometries.a1!.y).toBe(result.geometries.a2!.y);
    expect(result.geometries.b1!.y).toBe(result.geometries.b2!.y);
    expect(result.geometries.a1!.y).toBeLessThan(result.geometries.b1!.y);
    expect(result.geometries.a1!.x).toBeLessThan(result.geometries.a2!.x);
    expect(result.geometries.b1!.x).toBeLessThan(result.geometries.b2!.x);
  });

  it.each(["LR", "TB"] as const)(
    "keeps sibling region frames in their member-band order instead of opaque identity order for %s",
    async (direction) => {
      const layoutRef = direction === "LR"
        ? STANDARD_LAYOUT_REFS.hierarchicalLr
        : STANDARD_LAYOUT_REFS.hierarchicalTb;
      const scene: LayoutProjectedScene = {
        elements: [
          { elementId: "outer", structuralKind: "region" },
          { elementId: "region-a", structuralKind: "region" },
          { elementId: "region-z", structuralKind: "region" },
          { elementId: "a-first-band", structuralKind: "node" },
          { elementId: "z-second-band", structuralKind: "node" },
        ],
        edges: [],
        memberships: [
          { semanticRef: "outer-z", containerElementId: "outer", regionElementId: "outer", memberElementId: "region-z" },
          { semanticRef: "outer-a", containerElementId: "outer", regionElementId: "outer", memberElementId: "region-a" },
          { semanticRef: "first", containerElementId: "region-z", regionElementId: "region-z", memberElementId: "a-first-band" },
          { semanticRef: "second", containerElementId: "region-a", regionElementId: "region-a", memberElementId: "z-second-band" },
        ],
      };

      const result = await layoutProjectedScene({ layoutRef, scene }, createStandardLayoutRegistry());
      const first = result.geometries["region-z"]!;
      const second = result.geometries["region-a"]!;

      expect(direction === "LR" ? first.y : first.x)
        .toBeLessThan(direction === "LR" ? second.y : second.x);
      expect(overlaps(first, second)).toBe(false);
      expect(isInside(result.geometries["a-first-band"]!, first)).toBe(true);
      expect(isInside(result.geometries["z-second-band"]!, second)).toBe(true);
    },
  );

  it("keeps an unassigned directed resource aligned but outside generated regions", async () => {
    const scene: LayoutProjectedScene = {
      elements: [
        { elementId: "region-a", structuralKind: "region" },
        { elementId: "region-b", structuralKind: "region" },
        { elementId: "producer", structuralKind: "node" },
        { elementId: "resource", structuralKind: "node" },
        { elementId: "consumer", structuralKind: "node" },
      ],
      edges: [
        { elementId: "produce", sourceElementId: "producer", targetElementId: "resource" },
        { elementId: "consume", sourceElementId: "resource", targetElementId: "consumer" },
      ],
      memberships: [
        { semanticRef: "producer-m", containerElementId: "region-a", regionElementId: "region-a", memberElementId: "producer" },
        { semanticRef: "consumer-m", containerElementId: "region-b", regionElementId: "region-b", memberElementId: "consumer" },
      ],
    };
    const result = await layoutProjectedScene({
      layoutRef: STANDARD_LAYOUT_REFS.hierarchicalLr,
      scene,
    }, createStandardLayoutRegistry());
    const centers = ["producer", "resource", "consumer"].map((id) => (
      result.geometries[id]!.x + result.geometries[id]!.width / 2
    ));

    expect(Math.max(...centers) - Math.min(...centers)).toBeLessThanOrEqual(1);
    expect(overlaps(result.geometries.resource!, result.geometries["region-a"]!)).toBe(false);
    expect(overlaps(result.geometries.resource!, result.geometries["region-b"]!)).toBe(false);
  });

  it.each(["LR", "TB"] as const)(
    "separates unrelated generated regions and free nodes for %s deterministically",
    (direction) => {
      const layoutRef = `urn:test:region-separation:${direction}`;
      const scene: LayoutProjectedScene = {
        elements: [
          { elementId: "region-a", structuralKind: "region", placement: "generated" },
          { elementId: "region-b", structuralKind: "region", placement: "generated" },
          { elementId: "a", structuralKind: "node", placement: "generated" },
          { elementId: "b", structuralKind: "node", placement: "generated" },
          { elementId: "free", structuralKind: "node", placement: "generated" },
          { elementId: "free-2", structuralKind: "node", placement: "generated" },
        ],
        memberships: [
          { semanticRef: "a-m", containerElementId: "region-a", regionElementId: "region-a", memberElementId: "a" },
          { semanticRef: "b-m", containerElementId: "region-b", regionElementId: "region-b", memberElementId: "b" },
        ],
        edges: [],
      };
      const candidate = {
        layoutRef,
        geometries: {
          "region-a": { x: 40, y: 40, width: 240, height: 160 },
          "region-b": { x: 60, y: 50, width: 240, height: 160 },
          a: { x: 100, y: 100, width: 100, height: 60 },
          b: { x: 120, y: 110, width: 100, height: 60 },
          free: { x: 130, y: 120, width: 80, height: 40 },
          "free-2": { x: 140, y: 125, width: 80, height: 40 },
        },
        routes: {},
        width: 400,
        height: 300,
        diagnostics: [],
      };

      const first = completeRegionLayout({ layoutRef, scene }, candidate, direction);
      const second = completeRegionLayout({
        layoutRef,
        scene: {
          ...scene,
          elements: [...scene.elements].reverse(),
          memberships: [...scene.memberships!].reverse(),
        },
      }, candidate, direction);

      expect(first.geometries).toEqual(second.geometries);
      expect(overlaps(first.geometries["region-a"]!, first.geometries["region-b"]!)).toBe(false);
      expect(isInside(first.geometries.a!, first.geometries["region-a"]!)).toBe(true);
      expect(isInside(first.geometries.b!, first.geometries["region-b"]!)).toBe(true);
      expect(overlaps(first.geometries.free!, first.geometries["region-a"]!)).toBe(false);
      expect(overlaps(first.geometries.free!, first.geometries["region-b"]!)).toBe(false);
      expect(overlaps(first.geometries["free-2"]!, first.geometries["region-a"]!)).toBe(false);
      expect(overlaps(first.geometries["free-2"]!, first.geometries["region-b"]!)).toBe(false);
      expect(overlaps(first.geometries.free!, first.geometries["free-2"]!)).toBe(false);
    },
  );

  it.each(["LR", "TB"] as const)(
    "keeps nonmembers outside every Group Frame content bound without moving a shared member for %s",
    (direction) => {
      const layoutRef = `urn:test:group-nonmember:${direction}`;
      const groups = [
        { elementId: "bag", structuralKind: "container" as const, groupRole: "membership" as const },
        { elementId: "class", structuralKind: "region" as const, groupRole: "classification" as const },
        { elementId: "seq", structuralKind: "container" as const, groupRole: "sequence" as const },
        { elementId: "alt", structuralKind: "container" as const, groupRole: "alternative" as const },
      ];
      const scene: LayoutProjectedScene = {
        elements: [
          ...groups,
          { elementId: "shared", structuralKind: "node", placement: "generated" },
          { elementId: "free", structuralKind: "node", placement: "generated" },
        ],
        memberships: [
          { semanticRef: "bag-shared", containerElementId: "bag", memberElementId: "shared", role: "membership" },
          { semanticRef: "class-shared", containerElementId: "class", regionElementId: "class", memberElementId: "shared", role: "membership" },
          { semanticRef: "seq-shared", containerElementId: "seq", memberElementId: "shared", role: "sequence-member", ordinal: 1 },
          { semanticRef: "alt-shared", containerElementId: "alt", memberElementId: "shared", role: "alternative-member", ordinal: 1 },
        ],
        edges: [],
      };
      const frame = { x: 0, y: 0, width: 360, height: 220 };
      const candidate = {
        layoutRef,
        geometries: {
          bag: frame,
          class: frame,
          seq: frame,
          alt: frame,
          shared: { x: 120, y: 100, width: 80, height: 40 },
          free: { x: 140, y: 110, width: 60, height: 30 },
        },
        routes: {},
        width: 360,
        height: 220,
        diagnostics: [],
      };

      const first = completeRegionLayout({ layoutRef, scene }, candidate, direction);
      const reversed = completeRegionLayout({
        layoutRef,
        scene: {
          ...scene,
          elements: [...scene.elements].reverse(),
          memberships: [...scene.memberships!].reverse(),
        },
      }, candidate, direction);
      const contentBounds = Object.fromEntries(groups.map((group) => {
        const geometry = first.geometries[group.elementId]!;
        return [group.elementId, group.structuralKind === "region"
          ? geometry
          : {
              x: geometry.x + 28,
              y: geometry.y + 64,
              width: geometry.width - 56,
              height: geometry.height - 92,
            }];
      }));

      expect(first.geometries).toEqual(reversed.geometries);
      expect(first.geometries.shared).toEqual(candidate.geometries.shared);
      for (const group of groups) {
        expect(overlaps(first.geometries.free!, contentBounds[group.elementId]!)).toBe(false);
        expect(isInside(first.geometries.shared!, first.geometries[group.elementId]!)).toBe(true);
      }
      expect(first.diagnostics).toEqual([]);
    },
  );

  it("uses a custom adapter's TB direction in common region completion", async () => {
    const layoutRef = "urn:test:custom-tb-completion";
    const scene: LayoutProjectedScene = {
      elements: [
        { elementId: "region-a", structuralKind: "region", placement: "generated" },
        { elementId: "region-b", structuralKind: "region", placement: "generated" },
        { elementId: "a", structuralKind: "node", placement: "generated" },
        { elementId: "b", structuralKind: "node", placement: "generated" },
      ],
      memberships: [
        { semanticRef: "a-m", containerElementId: "region-a", regionElementId: "region-a", memberElementId: "a" },
        { semanticRef: "b-m", containerElementId: "region-b", regionElementId: "region-b", memberElementId: "b" },
      ],
      edges: [],
    };
    const adapter: LayoutAdapter = {
      layoutRef,
      async layout() {
        return {
          layoutRef,
          direction: "TB",
          geometries: {
            "region-a": { x: 40, y: 40, width: 240, height: 160 },
            "region-b": { x: 60, y: 50, width: 240, height: 160 },
            a: { x: 100, y: 100, width: 100, height: 60 },
            b: { x: 120, y: 110, width: 100, height: 60 },
          },
          routes: {},
          width: 400,
          height: 300,
          diagnostics: [],
        };
      },
    };

    const result = await layoutProjectedScene(
      { layoutRef, scene },
      new LayoutAdapterRegistry([adapter]),
    );

    expect(result.direction).toBe("TB");
    expect(overlaps(result.geometries["region-a"]!, result.geometries["region-b"]!)).toBe(false);
    expect(result.geometries["region-b"]!.x).toBeGreaterThan(
      result.geometries["region-a"]!.x + result.geometries["region-a"]!.width,
    );
  });

  it("moves absolute hierarchy descendants with their generated region group", () => {
    const layoutRef = "urn:test:region-subtree-translation";
    const request: LayoutRequest = {
      layoutRef,
      scene: {
        elements: [
          { elementId: "region-a", structuralKind: "region", placement: "generated" },
          { elementId: "region-b", structuralKind: "region", placement: "generated" },
          { elementId: "a", structuralKind: "node", placement: "generated" },
          { elementId: "bag", structuralKind: "container", placement: "generated" },
          { elementId: "bag-child", structuralKind: "node", parentElementId: "bag", placement: "generated" },
        ],
        memberships: [
          { semanticRef: "a-m", containerElementId: "region-a", regionElementId: "region-a", memberElementId: "a" },
          { semanticRef: "bag-m", containerElementId: "region-b", regionElementId: "region-b", memberElementId: "bag" },
        ],
        edges: [],
      },
    };
    const candidate = {
      layoutRef,
      geometries: {
        "region-a": { x: 40, y: 40, width: 240, height: 180 },
        "region-b": { x: 60, y: 50, width: 260, height: 200 },
        a: { x: 100, y: 100, width: 100, height: 60 },
        bag: { x: 110, y: 90, width: 160, height: 120 },
        "bag-child": { x: 140, y: 130, width: 80, height: 40 },
      },
      routes: {},
      width: 400,
      height: 300,
      diagnostics: [],
    };

    const result = completeRegionLayout(request, candidate, "LR");
    const bagDelta = result.geometries.bag!.y - candidate.geometries.bag.y;
    const childDelta = result.geometries["bag-child"]!.y - candidate.geometries["bag-child"].y;

    expect(bagDelta).toBeGreaterThan(0);
    expect(childDelta).toBe(bagDelta);
    expect(isInside(result.geometries["bag-child"]!, result.geometries.bag!)).toBe(true);
    expect(isInside(result.geometries.bag!, result.geometries["region-b"]!)).toBe(true);
  });

  it("separates non-shared endpoints of a transitive region-overlap chain", () => {
    const layoutRef = "urn:test:region-overlap-chain";
    const request: LayoutRequest = {
      layoutRef,
      scene: {
        elements: [
          { elementId: "region-a", structuralKind: "region", placement: "generated" },
          { elementId: "region-b", structuralKind: "region", placement: "generated" },
          { elementId: "region-c", structuralKind: "region", placement: "generated" },
          { elementId: "shared-ab", structuralKind: "node", placement: "generated" },
          { elementId: "shared-bc", structuralKind: "node", placement: "generated" },
        ],
        memberships: [
          { semanticRef: "a-ab", containerElementId: "region-a", regionElementId: "region-a", memberElementId: "shared-ab" },
          { semanticRef: "b-ab", containerElementId: "region-b", regionElementId: "region-b", memberElementId: "shared-ab" },
          { semanticRef: "b-bc", containerElementId: "region-b", regionElementId: "region-b", memberElementId: "shared-bc" },
          { semanticRef: "c-bc", containerElementId: "region-c", regionElementId: "region-c", memberElementId: "shared-bc" },
        ],
        edges: [],
      },
    };
    const candidate = {
      layoutRef,
      geometries: {
        "region-a": { x: 40, y: 40, width: 240, height: 160 },
        "region-b": { x: 40, y: 40, width: 240, height: 160 },
        "region-c": { x: 40, y: 40, width: 240, height: 160 },
        "shared-ab": { x: 100, y: 100, width: 100, height: 60 },
        "shared-bc": { x: 110, y: 110, width: 100, height: 60 },
      },
      routes: {},
      width: 400,
      height: 300,
      diagnostics: [],
    };

    const result = completeRegionLayout(request, candidate, "LR");

    expect(overlaps(result.geometries["region-a"]!, result.geometries["region-c"]!)).toBe(false);
    expect(isInside(result.geometries["shared-ab"]!, result.geometries["region-a"]!)).toBe(true);
    expect(isInside(result.geometries["shared-ab"]!, result.geometries["region-b"]!)).toBe(true);
    expect(isInside(result.geometries["shared-bc"]!, result.geometries["region-b"]!)).toBe(true);
    expect(isInside(result.geometries["shared-bc"]!, result.geometries["region-c"]!)).toBe(true);
    expect(result.diagnostics.some((item) => item.code === "layout-region-separation-unresolved"))
      .toBe(false);
  });

  it("preserves an impossible fixed overlap and returns actionable diagnostics", () => {
    const layoutRef = "urn:test:fixed-region-separation";
    const request: LayoutRequest = {
      layoutRef,
      scene: {
        elements: [
          {
            elementId: "fixed-a",
            structuralKind: "region",
            placement: "user",
            geometry: { x: 20, y: 20, width: 200, height: 140 },
          },
          {
            elementId: "fixed-b",
            structuralKind: "region",
            pinned: true,
            geometry: { x: 100, y: 60, width: 200, height: 140 },
          },
          {
            elementId: "fixed-free",
            structuralKind: "node",
            placement: "user",
            geometry: { x: 410, y: 100, width: 80, height: 40 },
          },
          {
            elementId: "generated-region",
            structuralKind: "region",
            placement: "generated",
            geometry: { x: 360, y: 20, width: 220, height: 160 },
          },
          {
            elementId: "generated-member",
            structuralKind: "node",
            placement: "generated",
            geometry: { x: 400, y: 80, width: 100, height: 60 },
          },
          {
            elementId: "generated-free-in-fixed",
            structuralKind: "node",
            placement: "generated",
            geometry: { x: 60, y: 80, width: 80, height: 40 },
          },
        ],
        memberships: [{
          semanticRef: "generated-membership",
          containerElementId: "generated-region",
          regionElementId: "generated-region",
          memberElementId: "generated-member",
        }],
        edges: [],
      },
    };
    const candidate = {
      layoutRef,
      geometries: Object.fromEntries(request.scene.elements.map((element) => [
        element.elementId,
        element.geometry!,
      ])),
      routes: {},
      width: 400,
      height: 300,
      diagnostics: [],
    };

    const result = completeRegionLayout(request, candidate, "LR");

    expect(result.geometries["fixed-a"]).toEqual(request.scene.elements[0]!.geometry);
    expect(result.geometries["fixed-b"]).toEqual(request.scene.elements[1]!.geometry);
    expect(result.geometries["fixed-free"]).toEqual(request.scene.elements[2]!.geometry);
    expect(overlaps(
      result.geometries["generated-free-in-fixed"]!,
      result.geometries["fixed-a"]!,
    )).toBe(false);
    expect(overlaps(
      result.geometries["generated-free-in-fixed"]!,
      result.geometries["fixed-b"]!,
    )).toBe(false);
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "layout-region-separation-fixed" }),
      expect.objectContaining({ code: "layout-unassigned-node-inside-region-fixed" }),
    ]));
  });

  it("normalizes generated disjoint sibling regions to their outer owner's primary span", async () => {
    const scene: LayoutProjectedScene = {
      elements: [
        { elementId: "outer", structuralKind: "region" },
        { elementId: "lane-a", structuralKind: "region" },
        { elementId: "lane-b", structuralKind: "region" },
        { elementId: "a1", structuralKind: "node" },
        { elementId: "a2", structuralKind: "node" },
        { elementId: "b1", structuralKind: "node" },
      ],
      edges: [{ elementId: "a-flow", sourceElementId: "a1", targetElementId: "a2" }],
      memberships: [
        { semanticRef: "outer-a", containerElementId: "outer", regionElementId: "outer", memberElementId: "lane-a" },
        { semanticRef: "outer-b", containerElementId: "outer", regionElementId: "outer", memberElementId: "lane-b" },
        { semanticRef: "a1-m", containerElementId: "lane-a", regionElementId: "lane-a", memberElementId: "a1" },
        { semanticRef: "a2-m", containerElementId: "lane-a", regionElementId: "lane-a", memberElementId: "a2" },
        { semanticRef: "b1-m", containerElementId: "lane-b", regionElementId: "lane-b", memberElementId: "b1" },
      ],
    };
    const result = await layoutProjectedScene({
      layoutRef: STANDARD_LAYOUT_REFS.hierarchicalLr,
      scene,
    }, createStandardLayoutRegistry());

    expect(result.geometries["lane-a"]!.x).toBe(result.geometries["lane-b"]!.x);
    expect(result.geometries["lane-a"]!.width).toBe(result.geometries["lane-b"]!.width);
    expect(result.geometries["lane-a"]!.x).toBe(result.geometries.outer!.x + 28);
    expect(result.geometries["lane-a"]!.x + result.geometries["lane-a"]!.width)
      .toBe(result.geometries.outer!.x + result.geometries.outer!.width - 28);
    expect(isInside(result.geometries["lane-a"]!, result.geometries.outer!)).toBe(true);
    expect(isInside(result.geometries["lane-b"]!, result.geometries.outer!)).toBe(true);
  });

  it("normalizes disjoint generated regions that share the virtual root", async () => {
    const result = await layoutProjectedScene({
      layoutRef: STANDARD_LAYOUT_REFS.hierarchicalLr,
      scene: {
        elements: [
          { elementId: "lane-a", structuralKind: "region" },
          { elementId: "lane-b", structuralKind: "region" },
          { elementId: "a1", structuralKind: "node" },
          { elementId: "a2", structuralKind: "node" },
          { elementId: "b1", structuralKind: "node" },
        ],
        edges: [{ elementId: "a-flow", sourceElementId: "a1", targetElementId: "a2" }],
        memberships: [
          { semanticRef: "a1-m", containerElementId: "lane-a", regionElementId: "lane-a", memberElementId: "a1" },
          { semanticRef: "a2-m", containerElementId: "lane-a", regionElementId: "lane-a", memberElementId: "a2" },
          { semanticRef: "b1-m", containerElementId: "lane-b", regionElementId: "lane-b", memberElementId: "b1" },
        ],
      },
    }, createStandardLayoutRegistry());

    expect(result.geometries["lane-a"]!.x).toBe(result.geometries["lane-b"]!.x);
    expect(result.geometries["lane-a"]!.width).toBe(result.geometries["lane-b"]!.width);
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

  it("new hierarchy memberだけを固定nested Group Frameの空き領域へ再配置する", async () => {
    const outer = { x: 100, y: 100, width: 800, height: 700 };
    const inner = { x: 140, y: 170, width: 420, height: 330 };
    const clerk = { x: 180, y: 250, width: 120, height: 60 };
    const cook = { x: 350, y: 250, width: 120, height: 60 };
    const price = { x: 1_020, y: 180, width: 120, height: 60 };
    const baseElements: LayoutProjectedScene["elements"] = [
      { elementId: "pizza-shop", structuralKind: "container", groupRole: "membership", placement: "user", geometry: outer },
      { elementId: "staff", structuralKind: "container", groupRole: "membership", parentElementId: "pizza-shop", placement: "user", geometry: inner },
      { elementId: "clerk", structuralKind: "node", parentElementId: "staff", placement: "user", geometry: clerk },
      { elementId: "cook", structuralKind: "node", parentElementId: "staff", placement: "user", geometry: cook },
      { elementId: "price", structuralKind: "node", placement: "user", geometry: price },
    ];
    const baseMemberships: NonNullable<LayoutProjectedScene["memberships"]> = [
      { semanticRef: "shop-staff", containerElementId: "pizza-shop", memberElementId: "staff", role: "membership" },
      { semanticRef: "staff-clerk", containerElementId: "staff", memberElementId: "clerk", role: "membership" },
      { semanticRef: "staff-cook", containerElementId: "staff", memberElementId: "cook", role: "membership" },
    ];
    const before = await layoutProjectedScene({
      layoutRef: STANDARD_LAYOUT_REFS.hierarchicalLr,
      scene: { elements: baseElements, memberships: baseMemberships, edges: [] },
    }, createStandardLayoutRegistry());
    expect(before.geometries.price).toEqual(price);

    const after = await layoutProjectedScene({
      layoutRef: STANDARD_LAYOUT_REFS.hierarchicalLr,
      newlyConstrainedElementIds: ["price"],
      scene: {
        elements: baseElements.map((element) => element.elementId === "price"
          ? { ...element, parentElementId: "pizza-shop" }
          : element),
        memberships: [
          ...baseMemberships,
          { semanticRef: "shop-price", containerElementId: "pizza-shop", memberElementId: "price", role: "membership" },
        ],
        edges: [],
      },
    }, createStandardLayoutRegistry());

    expect(after.geometries["pizza-shop"]).toEqual(outer);
    expect(after.geometries.staff).toEqual(inner);
    expect(after.geometries.clerk).toEqual(clerk);
    expect(after.geometries.cook).toEqual(cook);
    expect(after.geometries.price).not.toEqual(price);
    expect(isInside(after.geometries.staff!, after.geometries["pizza-shop"]!)).toBe(true);
    expect(isInside(after.geometries.clerk!, after.geometries.staff!)).toBe(true);
    expect(isInside(after.geometries.cook!, after.geometries.staff!)).toBe(true);
    expect(isInside(after.geometries.price!, after.geometries["pizza-shop"]!)).toBe(true);
    expect(overlaps(after.geometries.price!, after.geometries.staff!)).toBe(false);
    expect(after.diagnostics.some((item) => item.code.includes("intersection-empty"))).toBe(false);
  });

  it("region viewでもnew memberだけをouterの空き領域へ配置してnested membershipを保つ", async () => {
    const outer = { x: 100, y: 100, width: 900, height: 720 };
    const inner = { x: 140, y: 170, width: 500, height: 360 };
    const clerk = { x: 180, y: 250, width: 164, height: 72 };
    const price = { x: 1_200, y: 220, width: 164, height: 72 };
    const result = await layoutProjectedScene({
      layoutRef: STANDARD_LAYOUT_REFS.hierarchicalLr,
      newlyConstrainedElementIds: ["price"],
      scene: {
        elements: [
          { elementId: "pizza-shop", structuralKind: "region", groupRole: "membership", placement: "user", geometry: outer },
          { elementId: "staff", structuralKind: "region", groupRole: "membership", placement: "user", geometry: inner },
          { elementId: "clerk", structuralKind: "node", placement: "user", geometry: clerk },
          { elementId: "price", structuralKind: "node", placement: "user", geometry: price },
        ],
        memberships: [
          { semanticRef: "shop-staff", containerElementId: "pizza-shop", regionElementId: "pizza-shop", memberElementId: "staff", role: "membership" },
          { semanticRef: "staff-clerk", containerElementId: "staff", regionElementId: "staff", memberElementId: "clerk", role: "membership" },
          { semanticRef: "shop-price", containerElementId: "pizza-shop", regionElementId: "pizza-shop", memberElementId: "price", role: "membership" },
        ],
        edges: [],
      },
    }, createStandardLayoutRegistry());

    expect(result.geometries["pizza-shop"]).toEqual(outer);
    expect(result.geometries.staff).toEqual(inner);
    expect(result.geometries.clerk).toEqual(clerk);
    expect(result.geometries.price).not.toEqual(price);
    expect(isInside(result.geometries.staff!, result.geometries["pizza-shop"]!)).toBe(true);
    expect(isInside(result.geometries.clerk!, result.geometries.staff!)).toBe(true);
    expect(isInside(result.geometries.price!, result.geometries["pizza-shop"]!)).toBe(true);
    expect(overlaps(result.geometries.price!, result.geometries.staff!)).toBe(false);
    expect(result.diagnostics.some((item) => item.code.includes("intersection-empty"))).toBe(false);
  });

  it("new nested Group memberを全descendantの相対座標ごとouterへ一体移動する", async () => {
    const outer = { x: 100, y: 100, width: 1_000, height: 760 };
    const inner = { x: 1_240, y: 180, width: 500, height: 420 };
    const child = { x: 1_290, y: 250, width: 360, height: 280 };
    const grandchild = { x: 1_350, y: 340, width: 140, height: 72 };
    const result = await layoutProjectedScene({
      layoutRef: STANDARD_LAYOUT_REFS.hierarchicalLr,
      newlyConstrainedElementIds: ["staff"],
      scene: {
        elements: [
          { elementId: "pizza-shop", structuralKind: "region", groupRole: "membership", placement: "user", geometry: outer },
          { elementId: "staff", structuralKind: "region", groupRole: "membership", placement: "user", geometry: inner },
          { elementId: "delivery-team", structuralKind: "region", groupRole: "membership", placement: "user", geometry: child },
          { elementId: "courier", structuralKind: "node", placement: "user", geometry: grandchild },
        ],
        memberships: [
          { semanticRef: "shop-staff", containerElementId: "pizza-shop", regionElementId: "pizza-shop", memberElementId: "staff", role: "membership" },
          { semanticRef: "staff-delivery", containerElementId: "staff", regionElementId: "staff", memberElementId: "delivery-team", role: "membership" },
          { semanticRef: "delivery-courier", containerElementId: "delivery-team", regionElementId: "delivery-team", memberElementId: "courier", role: "membership" },
        ],
        edges: [],
      },
    }, createStandardLayoutRegistry());

    const movedInner = result.geometries.staff!;
    const delta = { x: movedInner.x - inner.x, y: movedInner.y - inner.y };
    expect(delta).not.toEqual({ x: 0, y: 0 });
    expect(result.geometries["delivery-team"]).toEqual({
      ...child,
      x: child.x + delta.x,
      y: child.y + delta.y,
    });
    expect(result.geometries.courier).toEqual({
      ...grandchild,
      x: grandchild.x + delta.x,
      y: grandchild.y + delta.y,
    });
    expect(isInside(movedInner, outer)).toBe(true);
    expect(isInside(result.geometries["delivery-team"]!, movedInner)).toBe(true);
    expect(isInside(result.geometries.courier!, result.geometries["delivery-team"]!)).toBe(true);
    expect(result.diagnostics.some((item) => item.code.includes("intersection-empty"))).toBe(false);
  });

  it("new multi-region memberを全所属先の共通intersectionへ局所配置する", async () => {
    const left = { x: 40, y: 40, width: 360, height: 260 };
    const right = { x: 220, y: 40, width: 360, height: 260 };
    const result = await layoutProjectedScene({
      layoutRef: STANDARD_LAYOUT_REFS.hierarchicalLr,
      newlyConstrainedElementIds: ["shared"],
      scene: {
        elements: [
          { elementId: "left", structuralKind: "region", groupRole: "classification", placement: "user", geometry: left },
          { elementId: "right", structuralKind: "region", groupRole: "classification", placement: "user", geometry: right },
          { elementId: "shared", structuralKind: "node", placement: "user", geometry: { x: 700, y: 80, width: 80, height: 50 } },
        ],
        memberships: [
          { semanticRef: "left-shared", containerElementId: "left", regionElementId: "left", memberElementId: "shared", role: "membership" },
          { semanticRef: "right-shared", containerElementId: "right", regionElementId: "right", memberElementId: "shared", role: "membership" },
        ],
        edges: [],
      },
    }, createStandardLayoutRegistry());

    expect(result.geometries.left).toEqual(left);
    expect(result.geometries.right).toEqual(right);
    expect(isInside(result.geometries.shared!, left)).toBe(true);
    expect(isInside(result.geometries.shared!, right)).toBe(true);
    expect(result.diagnostics.some((item) => item.code.includes("intersection"))).toBe(false);
  });

  it("generated outer Group Frameは既存nested subtreeを動かさず必要量だけ拡張する", async () => {
    const inner = { x: 140, y: 170, width: 420, height: 330 };
    const member = { x: 180, y: 250, width: 120, height: 60 };
    const result = await layoutProjectedScene({
      layoutRef: STANDARD_LAYOUT_REFS.hierarchicalLr,
      newlyConstrainedElementIds: ["price"],
      scene: {
        elements: [
          {
            elementId: "pizza-shop",
            structuralKind: "container",
            groupRole: "membership",
            placement: "generated",
            geometry: { x: 100, y: 100, width: 500, height: 420 },
          },
          { elementId: "staff", structuralKind: "container", groupRole: "membership", parentElementId: "pizza-shop", placement: "user", geometry: inner },
          { elementId: "staff-member", structuralKind: "node", parentElementId: "staff", placement: "user", geometry: member },
          { elementId: "price", structuralKind: "node", parentElementId: "pizza-shop", placement: "user", geometry: { x: 900, y: 180, width: 160, height: 72 } },
        ],
        memberships: [
          { semanticRef: "shop-staff", containerElementId: "pizza-shop", memberElementId: "staff", role: "membership" },
          { semanticRef: "staff-member", containerElementId: "staff", memberElementId: "staff-member", role: "membership" },
          { semanticRef: "shop-price", containerElementId: "pizza-shop", memberElementId: "price", role: "membership" },
        ],
        edges: [],
      },
    }, createStandardLayoutRegistry());

    expect(result.geometries.staff).toEqual(inner);
    expect(result.geometries["staff-member"]).toEqual(member);
    expect(isInside(result.geometries.staff!, result.geometries["pizza-shop"]!)).toBe(true);
    expect(isInside(result.geometries.price!, result.geometries["pizza-shop"]!)).toBe(true);
    expect(result.geometries["pizza-shop"]!.height).toBeGreaterThanOrEqual(420);
    expect(result.diagnostics.some((item) => item.code.includes("outside"))).toBe(false);
  });

  it("new hierarchy memberの空きがない固定Group Frameでは既存geometryを崩さず診断する", async () => {
    const outer = { x: 100, y: 100, width: 500, height: 420 };
    const inner = { x: 130, y: 165, width: 440, height: 325 };
    const member = { x: 170, y: 240, width: 120, height: 60 };
    const price = { x: 800, y: 180, width: 160, height: 72 };
    const result = await layoutProjectedScene({
      layoutRef: STANDARD_LAYOUT_REFS.hierarchicalLr,
      newlyConstrainedElementIds: ["price"],
      scene: {
        elements: [
          { elementId: "pizza-shop", structuralKind: "container", groupRole: "membership", placement: "user", geometry: outer },
          { elementId: "staff", structuralKind: "container", groupRole: "membership", parentElementId: "pizza-shop", placement: "user", geometry: inner },
          { elementId: "staff-member", structuralKind: "node", parentElementId: "staff", placement: "user", geometry: member },
          { elementId: "price", structuralKind: "node", parentElementId: "pizza-shop", placement: "user", geometry: price },
        ],
        memberships: [
          { semanticRef: "shop-staff", containerElementId: "pizza-shop", memberElementId: "staff", role: "membership" },
          { semanticRef: "staff-member", containerElementId: "staff", memberElementId: "staff-member", role: "membership" },
          { semanticRef: "shop-price", containerElementId: "pizza-shop", memberElementId: "price", role: "membership" },
        ],
        edges: [],
      },
    }, createStandardLayoutRegistry());

    expect(result.geometries["pizza-shop"]).toEqual(outer);
    expect(result.geometries.staff).toEqual(inner);
    expect(result.geometries["staff-member"]).toEqual(member);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: "group-member-outside",
      elementId: "price",
    }));
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

function overlaps(
  left: { x: number; y: number; width: number; height: number },
  right: { x: number; y: number; width: number; height: number },
): boolean {
  return left.x < right.x + right.width
    && left.x + left.width > right.x
    && left.y < right.y + right.height
    && left.y + left.height > right.y;
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

function polylineIntersectsBoxInterior(
  route: readonly { x: number; y: number }[],
  box: { x: number; y: number; width: number; height: number },
): boolean {
  const epsilon = 1e-6;
  const left = box.x + epsilon;
  const right = box.x + box.width - epsilon;
  const top = box.y + epsilon;
  const bottom = box.y + box.height - epsilon;
  return route.slice(0, -1).some((start, index) => {
    const end = route[index + 1]!;
    let near = 0;
    let far = 1;
    for (const [origin, delta, minimum, maximum] of [
      [start.x, end.x - start.x, left, right],
      [start.y, end.y - start.y, top, bottom],
    ] as const) {
      if (Math.abs(delta) < epsilon) {
        if (origin <= minimum || origin >= maximum) return false;
        continue;
      }
      const first = (minimum - origin) / delta;
      const second = (maximum - origin) / delta;
      near = Math.max(near, Math.min(first, second));
      far = Math.min(far, Math.max(first, second));
      if (near > far) return false;
    }
    return far > 0 && near < 1 && near <= far;
  });
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
