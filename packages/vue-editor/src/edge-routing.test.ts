import { describe, expect, it } from "vitest";

import type { EdgeCurveRouting, SceneEdge } from "@iriograph/core";

import {
  appendEdgeCurveKnot,
  appendEdgeWaypoint,
  cubicCurvePath,
  derivedSceneCurveRouting,
  edgeCurveControlHandles,
  edgeCurveKnotAppendIndex,
  edgeCurveSegments,
  edgeLabelPosition,
  editableEdgeWaypoints,
  insertEdgeCurveKnot,
  insertEdgeWaypoint,
  moveEdgeCurveKnot,
  moveEdgeWaypoint,
  normalizeEdgeCurveRouting,
  normalizeEditableRouting,
  pointAtCurveFraction,
  pointAtPolylineFraction,
  previewEdgeRoute,
  removeEdgeCurveHandle,
  removeEdgeCurveKnot,
  removeEdgeWaypoint,
  renderedEdgeRouteFamily,
  routingWithCurve,
  routingWithEndpointAnchor,
  routingWithLabelOffset,
  routingWithWaypoints,
  updateEdgeCurveHandle,
} from "./edge-routing";

describe("edge routing helpers", () => {
  it("generated route intermediatesをseedしてnearest segmentへ追加する", () => {
    const edge = edgeFor({
      route: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 200, y: 100 },
      ],
    });

    expect(editableEdgeWaypoints(edge)).toEqual([{ x: 100, y: 0 }, { x: 100, y: 100 }]);
    expect(insertEdgeWaypoint(edge, { x: 42, y: 9 })).toEqual([
      { x: 42, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ]);
  });

  it("manual routeでは既存waypoint順のnearest segmentへ追加する", () => {
    const edge = edgeFor({
      route: [{ x: 0, y: 0 }, { x: 80, y: 20 }, { x: 160, y: 0 }],
      waypoints: [{ x: 80, y: 20 }],
    });

    expect(insertEdgeWaypoint(edge, { x: 130, y: 7.5 })).toEqual([
      { x: 80, y: 20 },
      { x: 130, y: 7.5 },
    ]);
    expect(appendEdgeWaypoint(edge)).toHaveLength(2);
  });

  it("waypointをbounds内で移動し最後の削除をautomaticへ戻す", () => {
    expect(moveEdgeWaypoint(
      [{ x: 10, y: 10 }],
      0,
      { x: -100, y: 500 },
      { width: 200, height: 120, padding: 8 },
    )).toEqual([{ x: 8, y: 112 }]);
    expect(removeEdgeWaypoint([{ x: 8, y: 112 }], 0)).toBeUndefined();
    expect(normalizeEditableRouting({ waypoints: [] })).toBeUndefined();
  });

  it("label baseをpolyline全長の50%としてoffsetを適用する", () => {
    const route = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 300 }];
    expect(pointAtPolylineFraction(route, .5)).toEqual({ x: 100, y: 100 });
    expect(edgeLabelPosition(edgeFor({ route, labelOffset: { x: 12, y: -8 } })))
      .toEqual({ x: 112, y: 92 });
    expect(normalizeEditableRouting({ labelOffset: { x: 0, y: 0 } })).toBeUndefined();
  });

  it("zero-lengthと非有限pointを安全に処理する", () => {
    expect(pointAtPolylineFraction([
      { x: 4, y: 7 },
      { x: 4, y: 7 },
    ], .5)).toEqual({ x: 4, y: 7 });
    expect(normalizeEditableRouting({
      waypoints: [{ x: Number.NaN, y: 1 }, { x: 2, y: 3 }],
    })).toEqual({ waypoints: [{ x: 2, y: 3 }] });
  });

  it("anchor-only routingを保持しwaypoint/label編集でも既存anchorを失わない", () => {
    expect(normalizeEditableRouting({
      sourceAnchor: { position: 0 },
      targetAnchor: { position: .75 },
    })).toEqual({
      sourceAnchor: { position: 0 },
      targetAnchor: { position: .75 },
    });
    expect(normalizeEditableRouting({ sourceAnchor: { position: 1 } })).toBeUndefined();

    const edge = edgeFor({
      waypoints: [{ x: 30, y: 40 }],
      labelOffset: { x: 4, y: -2 },
      sourceAnchor: { position: .25 },
      targetAnchor: { position: .5 },
    });
    expect(routingWithWaypoints(edge, [{ x: 50, y: 60 }])).toMatchObject({
      sourceAnchor: { position: .25 },
      targetAnchor: { position: .5 },
    });
    expect(routingWithLabelOffset(edge, { x: 8, y: 9 })).toMatchObject({
      sourceAnchor: { position: .25 },
      targetAnchor: { position: .5 },
    });
    expect(routingWithEndpointAnchor(edge, "source", undefined)).toEqual({
      waypoints: [{ x: 30, y: 40 }],
      labelOffset: { x: 4, y: -2 },
      targetAnchor: { position: .5 },
    });
  });

  it("generated共通deltaは全route、片側deltaはendpointと隣接segmentを追随する", () => {
    const edge = edgeFor({ route: [
      { x: 100, y: 50 },
      { x: 200, y: 50 },
      { x: 200, y: 150 },
      { x: 300, y: 150 },
    ] });
    const a = { x: 0, y: 20, width: 100, height: 60 };
    const b = { x: 300, y: 120, width: 100, height: 60 };

    expect(previewEdgeRoute(
      edge,
      { original: a, preview: { ...a, x: 20, y: 30 } },
      { original: b, preview: { ...b, x: 20 + b.x, y: 10 + b.y } },
    )).toEqual([
      { x: 120, y: 60 },
      { x: 220, y: 60 },
      { x: 220, y: 160 },
      { x: 320, y: 160 },
    ]);
    expect(previewEdgeRoute(
      edge,
      { original: a, preview: { ...a, x: 20, y: 30 } },
      { original: b, preview: b },
    )).toEqual([
      { x: 120, y: 60 },
      { x: 200, y: 60 },
      { x: 200, y: 150 },
      { x: 300, y: 150 },
    ]);
  });

  it("manual previewはabsolute waypointを維持してattachmentだけを追随する", () => {
    const edge = edgeFor({
      route: [{ x: 100, y: 50 }, { x: 180, y: 90 }, { x: 300, y: 150 }],
      waypoints: [{ x: 180, y: 90 }],
    });
    const a = { x: 0, y: 20, width: 100, height: 60 };
    const b = { x: 300, y: 120, width: 100, height: 60 };

    expect(previewEdgeRoute(
      edge,
      { original: a, preview: { ...a, x: 20, y: 30 } },
      { original: b, preview: { ...b, x: 20 + b.x, y: 10 + b.y } },
    )).toEqual([
      { x: 120, y: 60 },
      { x: 180, y: 90 },
      { x: 320, y: 160 },
    ]);
  });

  it("curveを常に単一のcontinuous cubic pathとして描く", () => {
    const route = [{ x: 0, y: 0 }, { x: 200, y: 0 }];
    expect(cubicCurvePath(route, undefined)).toMatch(/^M 0 0 C /);
    expect(cubicCurvePath(route, undefined)).not.toMatch(/[LQ]/);

    const curve = {
      knots: [
        { point: { x: 60, y: 45 } },
        { point: { x: 135, y: -30 } },
      ],
    };
    const path = cubicCurvePath(route, curve);
    expect(path.match(/\bC\b/g)).toHaveLength(3);
    expect(path).toContain("60 45 C");
    expect(path).toContain("135 -30 C");
    expect(path).not.toMatch(/[LQ]/);
    expect(edgeCurveSegments(route, curve).map((segment) => segment.end)).toEqual([
      { x: 60, y: 45 },
      { x: 135, y: -30 },
      { x: 200, y: 0 },
    ]);
  });

  it("autoだけがlayout由来familyと絶対controlを描画用に解決する", () => {
    const edge = edgeFor({
      routeMode: "auto",
      route: [{ x: 20, y: 30 }, { x: 220, y: 130 }],
      derivedRouteChoice: {
        family: "curve",
        source: "auto",
        reason: "auto-curve-safe",
        curve: {
          sourceControl: { x: 80, y: 10 },
          targetControl: { x: 170, y: 180 },
          guidePivot: { x: 120, y: 80 },
          guideAngleDegrees: 26,
        },
      },
    });

    expect(renderedEdgeRouteFamily(edge)).toBe("curve");
    expect(derivedSceneCurveRouting(edge)).toEqual({
      sourceHandle: { x: 60, y: -20 },
      targetHandle: { x: -50, y: 50 },
    });
    expect(renderedEdgeRouteFamily(edge, "straight")).toBe("straight");
    expect(renderedEdgeRouteFamily(edgeFor({ routeMode: "auto" }))).toBe("polyline");
    const staleExplicit = edgeFor({
      routeMode: "auto",
      route: edge.route,
      derivedRouteChoice: {
        ...edge.derivedRouteChoice!,
        source: "explicit",
        reason: "explicit-route-mode",
      },
    });
    expect(renderedEdgeRouteFamily(staleExplicit)).toBe("polyline");
    expect(derivedSceneCurveRouting(staleExplicit)).toBeUndefined();
  });

  it("curve knotを曲線上へ追加・移動・削除しlabel位置を曲線長から求める", () => {
    const route = [{ x: 0, y: 0 }, { x: 200, y: 0 }];
    const inserted = insertEdgeCurveKnot(route, undefined, { x: 100, y: 35 });
    expect(inserted?.knots).toHaveLength(1);
    expect(inserted?.knots?.[0]?.point.y).toBeGreaterThan(0);

    const appended = appendEdgeCurveKnot(route, inserted);
    expect(appended?.knots).toHaveLength(2);
    const moved = moveEdgeCurveKnot(appended, 0, { x: -500, y: 500 }, {
      width: 240,
      height: 140,
      padding: 8,
    });
    expect(moved?.knots?.[0]?.point).toEqual({ x: 8, y: 132 });
    expect(removeEdgeCurveKnot(moved, 0)?.knots).toHaveLength(1);
    expect(removeEdgeCurveKnot({ knots: [{ point: { x: 10, y: 20 } }] }, 0)).toBeUndefined();

    expect(edgeCurveKnotAppendIndex(route, {
      knots: [{ point: { x: 30, y: 10 } }, { point: { x: 55, y: 5 } }],
    })).toBe(2);

    const midpoint = pointAtCurveFraction(route, {
      sourceHandle: { x: 50, y: 80 },
      targetHandle: { x: -50, y: 80 },
    }, .5);
    expect(midpoint.x).toBeCloseTo(100, 0);
    expect(midpoint.y).toBeGreaterThan(50);
  });

  it("handle編集は相対座標を保存しknot tangentを鏡映する", () => {
    const route = [{ x: 0, y: 0 }, { x: 200, y: 0 }];
    const base = { knots: [{ point: { x: 100, y: 40 } }] };
    const source = updateEdgeCurveHandle(route, base, { kind: "source" }, { x: 45, y: 25 });
    expect(source?.sourceHandle).toEqual({ x: 45, y: 25 });
    const tangent = updateEdgeCurveHandle(route, source, { kind: "knot-in", knotIndex: 0 }, {
      x: 72,
      y: 16,
    });
    expect(tangent?.knots?.[0]).toMatchObject({
      incomingHandle: { x: -28, y: -24 },
      outgoingHandle: { x: 28, y: 24 },
    });
    const handles = edgeCurveControlHandles(route, tangent);
    expect(handles.find((handle) => handle.kind === "source")?.manual).toBe(true);
    expect(handles.find((handle) => handle.kind === "knot-out")?.point).toEqual({ x: 128, y: 64 });

    const automaticKnot = removeEdgeCurveHandle(tangent, { kind: "knot-in", knotIndex: 0 });
    expect(automaticKnot?.knots?.[0]?.incomingHandle).toBeUndefined();
    expect(automaticKnot?.knots?.[0]?.outgoingHandle).toBeUndefined();
    expect(removeEdgeCurveHandle({ sourceHandle: { x: 30, y: 20 } }, { kind: "source" }))
      .toBeUndefined();
  });

  it("self-loopとparallel guide routeでも非退化のcurveを生成する", () => {
    const selfLoop = edgeCurveSegments([{ x: 40, y: 40 }, { x: 40, y: 40 }], undefined)[0]!;
    expect(selfLoop.control1).not.toEqual(selfLoop.start);
    expect(selfLoop.control2).not.toEqual(selfLoop.end);

    const upper = edgeCurveSegments([
      { x: 0, y: 0 },
      { x: 100, y: -40 },
      { x: 200, y: 0 },
    ], undefined)[0]!;
    const lower = edgeCurveSegments([
      { x: 0, y: 0 },
      { x: 100, y: 40 },
      { x: 200, y: 0 },
    ], undefined)[0]!;
    expect(Math.sign(upper.control1.y)).toBe(-1);
    expect(Math.sign(lower.control1.y)).toBe(1);
  });

  it("curve pointのextensionsをdeep-copyし座標編集後も保持する", () => {
    const extensionIri = "https://example.test/curve-point-meta";
    const original: EdgeCurveRouting = {
      sourceHandle: {
        x: 30,
        y: 12,
        extensions: { [extensionIri]: { tags: ["source"] } },
      },
      targetHandle: {
        x: -28,
        y: 10,
        extensions: { [extensionIri]: { tags: ["target"] } },
      },
      knots: [{
        point: {
          x: 100,
          y: 40,
          extensions: { [extensionIri]: { tags: ["point"] } },
        },
        incomingHandle: {
          x: -20,
          y: -8,
          extensions: { [extensionIri]: { tags: ["incoming"] } },
        },
        outgoingHandle: {
          x: 20,
          y: 8,
          extensions: { [extensionIri]: { tags: ["outgoing"] } },
        },
      }],
    };
    const copied = normalizeEdgeCurveRouting(original)!;
    expect(copied).toEqual(original);
    ((copied.sourceHandle!.extensions![extensionIri] as { tags: string[] }).tags).push("copied");
    expect(original.sourceHandle!.extensions![extensionIri]).toEqual({ tags: ["source"] });

    const moved = moveEdgeCurveKnot(original, 0, { x: 5, y: -3 })!;
    expect(moved.knots![0]!.point).toMatchObject({
      x: 105,
      y: 37,
      extensions: { [extensionIri]: { tags: ["point"] } },
    });
    const sourceEdited = updateEdgeCurveHandle(
      [{ x: 0, y: 0 }, { x: 200, y: 0 }],
      original,
      { kind: "source" },
      { x: 42, y: 18 },
    )!;
    expect(sourceEdited.sourceHandle).toEqual({
      x: 42,
      y: 18,
      extensions: { [extensionIri]: { tags: ["source"] } },
    });
    const tangentEdited = updateEdgeCurveHandle(
      [{ x: 0, y: 0 }, { x: 200, y: 0 }],
      original,
      { kind: "knot-in", knotIndex: 0 },
      { x: 70, y: 16 },
    )!;
    expect(tangentEdited.knots![0]!.incomingHandle?.extensions?.[extensionIri])
      .toEqual({ tags: ["incoming"] });
    expect(tangentEdited.knots![0]!.outgoingHandle?.extensions?.[extensionIri])
      .toEqual({ tags: ["outgoing"] });
  });

  it("curve overlayを正規化し不正配列・NaNはfail closedにする", () => {
    expect(normalizeEdgeCurveRouting({
      knots: [{ point: { x: Number.NaN, y: 10 } }],
    })).toBeUndefined();
    expect(normalizeEdgeCurveRouting({
      knots: Array.from({ length: 65 }, (_, index) => ({ point: { x: index, y: 0 } })),
    })).toBeUndefined();
    expect(normalizeEdgeCurveRouting({
      knots: [{}],
    } as never)).toBeUndefined();
    expect(normalizeEdgeCurveRouting({ knots: "not-an-array" } as never)).toBeUndefined();
    expect(normalizeEditableRouting({
      curve: { sourceHandle: { x: 40, y: 10 } },
      labelOffset: { x: 5, y: -3 },
    })).toEqual({
      curve: { sourceHandle: { x: 40, y: 10 } },
      labelOffset: { x: 5, y: -3 },
    });
    expect(routingWithCurve(edgeFor({ labelOffset: { x: 2, y: 3 } }), {
      targetHandle: { x: -40, y: 12 },
    })).toEqual({
      curve: { targetHandle: { x: -40, y: 12 } },
      labelOffset: { x: 2, y: 3 },
    });
  });
});

function edgeFor(overrides: Partial<SceneEdge>): SceneEdge {
  return {
    elementId: "edge",
    semanticRef: "urn:test:edge",
    structuralKind: "edge",
    label: "edge",
    sourceElementId: "a",
    targetElementId: "b",
    templateRef: "urn:test:template:edge",
    style: { fill: "none", stroke: "#000", text: "#000" },
    fallback: false,
    ...overrides,
  };
}
