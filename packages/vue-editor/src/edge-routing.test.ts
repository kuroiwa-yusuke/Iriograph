import { describe, expect, it } from "vitest";

import type { SceneEdge } from "@iriograph/core";

import {
  appendEdgeWaypoint,
  edgeLabelPosition,
  editableEdgeWaypoints,
  insertEdgeWaypoint,
  moveEdgeWaypoint,
  normalizeEditableRouting,
  pointAtPolylineFraction,
  previewEdgeRoute,
  removeEdgeWaypoint,
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
