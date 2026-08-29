import { describe, expect, it } from "vitest";

import type { DiagramScene } from "@iriograph/core";

import {
  DIAGRAM_WORK_AREA_EXPANSION_PADDING,
  DIAGRAM_WORK_AREA_PADDING,
  diagramContentBounds,
  diagramWorkAreaBounds,
  expandDiagramWorkAreaBounds,
} from "./viewport";

describe("ephemeral Canvas work area", () => {
  it("positive Sceneでは従来のScene dimensionsをpaddingなしcontent boundsに保つ", () => {
    expect(diagramContentBounds(sceneFixture())).toEqual({
      x: 0,
      y: 0,
      width: 600,
      height: 400,
    });
  });

  it("負座標geometryとScene外edge routeをcontent boundsへ含める", () => {
    const scene = sceneFixture();
    scene.nodes = [{
      elementId: "negative-node",
      semanticRef: "urn:test:negative-node",
      structuralKind: "node",
      label: "Negative",
      templateRef: "urn:test:node",
      shape: "rectangle",
      geometry: { x: -200, y: -100, width: 40, height: 30 },
      style: { fill: "#fff", stroke: "#000", text: "#000" },
      pinned: false,
      placement: "user",
    }];
    scene.edges = [{
      elementId: "external-route",
      semanticRef: "urn:test:external-route",
      structuralKind: "edge",
      label: "Route",
      sourceElementId: "negative-node",
      targetElementId: "negative-node",
      templateRef: "urn:test:edge",
      style: { fill: "none", stroke: "#000", text: "#000" },
      route: [{ x: -180, y: -80 }, { x: 780, y: 520 }],
      fallback: false,
    }];

    expect(diagramContentBounds(scene)).toEqual({
      x: -200,
      y: -100,
      width: 980,
      height: 620,
    });
  });

  it("curve knotと相対handleをcontent boundsへ含め操作点を切らない", () => {
    const scene = sceneFixture();
    scene.edges = [{
      elementId: "curve",
      semanticRef: "urn:test:curve",
      structuralKind: "edge",
      label: "Curve",
      sourceElementId: "a",
      targetElementId: "b",
      templateRef: "urn:test:edge",
      style: { fill: "none", stroke: "#000", text: "#000" },
      route: [{ x: 20, y: 40 }, { x: 580, y: 360 }],
      routeMode: "curve",
      curve: {
        sourceHandle: { x: -120, y: -90 },
        targetHandle: { x: 180, y: 140 },
        knots: [{
          point: { x: 300, y: 200 },
          incomingHandle: { x: -350, y: 0 },
        }],
      },
      fallback: false,
    }];

    expect(diagramContentBounds(scene)).toEqual({
      x: -100,
      y: -50,
      width: 860,
      height: 550,
    });
  });

  it("automatic curveの補完controlとbowもcontent boundsへ含める", () => {
    const scene = sceneFixture();
    scene.edges = [{
      elementId: "automatic-curve",
      semanticRef: "urn:test:automatic-curve",
      structuralKind: "edge",
      label: "Automatic curve",
      sourceElementId: "a",
      targetElementId: "b",
      templateRef: "urn:test:edge",
      style: { fill: "none", stroke: "#000", text: "#000" },
      route: [{ x: 20, y: 390 }, { x: 580, y: 390 }],
      routeMode: "curve",
      fallback: false,
    }];

    // Direct horizontal curveのautomatic bowは+80でcontrol y=470になる。
    expect(diagramContentBounds(scene)).toEqual({
      x: 0,
      y: 0,
      width: 600,
      height: 470,
    });
  });

  it("layoutがautoで選んだBezier controlもcontent boundsへ含める", () => {
    const scene = sceneFixture();
    scene.edges = [{
      elementId: "derived-curve",
      semanticRef: "urn:test:derived-curve",
      structuralKind: "edge",
      label: "Derived curve",
      sourceElementId: "a",
      targetElementId: "b",
      templateRef: "urn:test:edge",
      style: { fill: "none", stroke: "#000", text: "#000" },
      route: [{ x: 20, y: 100 }, { x: 580, y: 100 }],
      routeMode: "auto",
      derivedRouteChoice: {
        family: "curve",
        source: "auto",
        reason: "auto-curve-safe",
        curve: {
          sourceControl: { x: -80, y: -120 },
          targetControl: { x: 680, y: 520 },
          guidePivot: { x: 300, y: 200 },
          guideAngleDegrees: 40,
        },
      },
      fallback: false,
    }];

    expect(diagramContentBounds(scene)).toEqual({
      x: -80,
      y: -120,
      width: 760,
      height: 640,
    });
  });

  it("Sceneの全周へ大きな初期余白を設ける", () => {
    const workArea = diagramWorkAreaBounds(sceneFixture());

    expect(workArea).toEqual({
      x: -DIAGRAM_WORK_AREA_PADDING,
      y: -DIAGRAM_WORK_AREA_PADDING,
      width: 600 + DIAGRAM_WORK_AREA_PADDING * 2,
      height: 400 + DIAGRAM_WORK_AREA_PADDING * 2,
    });
  });

  it("preview geometryに追従して負方向・正方向へ単調に拡張する", () => {
    const initial = diagramWorkAreaBounds(sceneFixture());
    const expandedLeft = expandDiagramWorkAreaBounds(initial, [{
      x: initial.x - 80,
      y: 20,
      width: 40,
      height: 30,
    }]);
    const expandedRight = expandDiagramWorkAreaBounds(expandedLeft, [{
      x: initial.x + initial.width + 100,
      y: 20,
      width: 40,
      height: 30,
    }]);

    expect(expandedLeft.x).toBe(initial.x - 80 - DIAGRAM_WORK_AREA_EXPANSION_PADDING);
    expect(expandedLeft.x + expandedLeft.width).toBe(initial.x + initial.width);
    expect(expandedRight.x).toBe(expandedLeft.x);
    expect(expandedRight.x + expandedRight.width).toBe(
      initial.x + initial.width + 100 + 40 + DIAGRAM_WORK_AREA_EXPANSION_PADDING,
    );
  });
});

function sceneFixture(): DiagramScene {
  return {
    viewId: "main",
    width: 600,
    height: 400,
    diagnostics: [],
    containers: [],
    nodes: [],
    edges: [],
  };
}
