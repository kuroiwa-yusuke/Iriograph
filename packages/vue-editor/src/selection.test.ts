import { describe, expect, it } from "vitest";

import type {
  DiagramScene,
  SceneContainer,
  SceneNode,
} from "@iriograph/core";

import {
  alignSelection,
  distributeSelection,
  normalizeSceneSelection,
  resizeGeometryElement,
  resizeGeometryElementFromHandle,
  translateSelection,
} from "./selection";

describe("selection geometry policy", () => {
  it("selection orderをsession primary用に保ち、unknownと重複を除く", () => {
    const scene = sceneFixture();
    expect(normalizeSceneSelection(scene, ["node-b", "missing", "node-a", "node-b"]))
      .toEqual(["node-b", "node-a"]);
  });

  it("異なるcontainerの許容deltaを交差しmembershipを変えない", () => {
    const scene = containedSceneFixture();
    const changes = translateSelection(
      scene,
      ["node-a", "node-b"],
      { x: 100, y: 0 },
      noSnap(),
    );

    expect(changes).toEqual([
      { elementId: "node-a", geometry: { x: 74, y: 70, width: 40, height: 30 } },
      { elementId: "node-b", geometry: { x: 544, y: 70, width: 40, height: 30 } },
    ]);
    expect(scene.nodes.map((node) => node.parentElementId)).toEqual(["container-a", "container-b"]);
  });

  it("containerをselection rootとして子孫を一度だけ同じdeltaで移動する", () => {
    const scene = containedSceneFixture();
    const changes = translateSelection(
      scene,
      ["container-a", "node-a"],
      { x: 32, y: 24 },
      noSnap(),
    );

    expect(changes).toEqual([
      { elementId: "container-a", geometry: { x: 40, y: 32, width: 280, height: 180 } },
      { elementId: "node-a", geometry: { x: 62, y: 94, width: 40, height: 30 } },
    ]);
  });

  it("targetをgridより優先し、target外では8px gridへ決定的にsnapする", () => {
    const scene = sceneFixture();
    expect(translateSelection(scene, ["node-a"], { x: 49, y: 0 })[0]?.geometry.x).toBe(70);
    expect(translateSelection(scene, ["node-a"], { x: 10, y: 0 })[0]?.geometry.x).toBe(32);
  });

  it("alignmentは各container boundsを尊重し、distributionはbbox間gapを等しくする", () => {
    const contained = containedSceneFixture();
    expect(alignSelection(contained, ["node-a", "node-b"], "left"))
      .toEqual([{ elementId: "node-b", geometry: { x: 316, y: 70, width: 40, height: 30 } }]);

    const scene = sceneFixture();
    const changes = distributeSelection(
      scene,
      ["node-c", "node-a", "node-b"],
      "horizontal",
    );
    expect(changes).toEqual([
      { elementId: "node-b", geometry: { x: 145, y: 100, width: 20, height: 30 } },
    ]);
  });

  it("resizeも親content boundsとcontainer child boundsを越えない", () => {
    const scene = containedSceneFixture();
    expect(resizeGeometryElement(scene, "node-b", { width: 999, height: 999 }))
      .toEqual({
        elementId: "node-b",
        geometry: { x: 500, y: 70, width: 84, height: 102 },
      });
    expect(resizeGeometryElement(scene, "container-a", { width: 100, height: 50 }))
      .toEqual({
        elementId: "container-a",
        geometry: { x: 8, y: 8, width: 240, height: 120 },
      });
  });

  it("8方向resizeでもregionの意味上のmemberを枠外へ残さない", () => {
    const scene = sceneFixture();
    const provenance = { sourceStatementRefs: ["urn:test:s"], operator: "membership-region" as const, derivation: "direct" as const };
    scene.regions = [{
      elementId: "region-a", semanticRef: "urn:test:Class", structuralKind: "region", label: "Class",
      templateRef: "urn:test:region", geometry: { x: 10, y: 10, width: 300, height: 180 },
      style: { fill: "#fff", stroke: "#000", text: "#000" }, pinned: false, placement: "generated", provenance,
    }];
    scene.nodes[0]!.geometry = { x: 80, y: 70, width: 40, height: 30 };
    scene.memberships = [{ semanticRef: "urn:test:m", containerElementId: "region-a", regionElementId: "region-a", memberElementId: "node-a", provenance }];
    expect(resizeGeometryElementFromHandle(scene, "region-a", "nw", { x: 200, y: 120 }))
      .toEqual({ elementId: "region-a", geometry: { x: 70, y: 66, width: 240, height: 124 } });
  });
});

function noSnap() {
  return {
    grid: { enabled: false, size: 8 },
    targets: { enabled: false, tolerance: 6 },
  };
}

function sceneFixture(): DiagramScene {
  return {
    viewId: "main",
    width: 600,
    height: 400,
    diagnostics: [],
    containers: [],
    nodes: [
      node("node-a", 20, 40, 40, 30),
      node("node-b", 110, 100, 20, 30),
      node("node-c", 250, 150, 50, 30),
    ],
    edges: [],
  };
}

function containedSceneFixture(): DiagramScene {
  return {
    viewId: "main",
    width: 800,
    height: 500,
    diagnostics: [],
    containers: [
      container("container-a", 8, 8, 280, 180),
      container("container-b", 300, 8, 300, 180),
    ],
    nodes: [
      { ...node("node-a", 30, 70, 40, 30), parentElementId: "container-a" },
      { ...node("node-b", 500, 70, 40, 30), parentElementId: "container-b" },
    ],
    edges: [],
  };
}

function node(
  elementId: string,
  x: number,
  y: number,
  width: number,
  height: number,
): SceneNode {
  return {
    elementId,
    semanticRef: `urn:test:${elementId}`,
    structuralKind: "node",
    label: elementId,
    templateRef: "urn:test:template:node",
    shape: "rectangle",
    style: { fill: "#fff", stroke: "#000", text: "#000" },
    geometry: { x, y, width, height },
    pinned: false,
    placement: "generated",
  };
}

function container(
  elementId: string,
  x: number,
  y: number,
  width: number,
  height: number,
): SceneContainer {
  return {
    elementId,
    semanticRef: `urn:test:${elementId}`,
    structuralKind: "container",
    label: elementId,
    templateRef: "urn:test:template:container",
    headerPosition: "none",
    style: { fill: "#fff", stroke: "#000", text: "#000" },
    geometry: { x, y, width, height },
    pinned: false,
    placement: "generated",
  };
}
