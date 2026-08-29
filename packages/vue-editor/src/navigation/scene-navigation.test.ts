import { describe, expect, it } from "vitest";

import type { DiagramScene, SceneContainer, SceneNode } from "@iriograph/core";

import {
  moveSceneNavigatorFocus,
  restoreSceneNavigatorFocus,
  sceneNavigatorItems,
  sceneNavigatorRange,
} from "./scene-navigation";

describe("scene navigator", () => {
  const scene = {
    viewId: "main",
    width: 800,
    height: 500,
    containers: [container("container-z", "領域")],
    nodes: [node("node-b", "B"), node("node-a", "A")],
    edges: [{
      elementId: "edge-a-b",
      structuralKind: "edge" as const,
      semanticRef: "urn:edge",
      sourceElementId: "node-a",
      targetElementId: "node-b",
      label: "次",
      templateRef: "urn:template:edge",
      style: { fill: "none", stroke: "#000", text: "#000" },
      fallback: false,
      projectionRuleId: "rule",
    }],
    diagnostics: [],
  } satisfies DiagramScene;

  it("kindとstable elementIdだけで決定的な順序を作る", () => {
    expect(sceneNavigatorItems(scene).map((item) => item.elementId)).toEqual([
      "container-z",
      "node-a",
      "node-b",
      "edge-a-b",
    ]);
  });

  it("循環移動、Home/End、activeをprimaryにするrangeを返す", () => {
    const items = sceneNavigatorItems(scene);
    expect(moveSceneNavigatorFocus(items, "container-z", "previous")).toBe("edge-a-b");
    expect(moveSceneNavigatorFocus(items, "edge-a-b", "next")).toBe("container-z");
    expect(moveSceneNavigatorFocus(items, "", "first")).toBe("container-z");
    expect(moveSceneNavigatorFocus(items, "", "last")).toBe("edge-a-b");
    expect(sceneNavigatorRange(items, "node-b", "container-z")).toEqual([
      "node-a",
      "node-b",
      "container-z",
    ]);
  });

  it("stable IDを維持し、消失時は以前と同じslotへfallbackする", () => {
    const before = sceneNavigatorItems(scene);
    const after = before.filter((item) => item.elementId !== "node-a");
    expect(restoreSceneNavigatorFocus(before, after, "node-a")).toBe("node-b");
    expect(restoreSceneNavigatorFocus(before, after, "node-b")).toBe("node-b");
    expect(restoreSceneNavigatorFocus(before, after, "node-b", "edge-a-b")).toBe("node-b");
    expect(restoreSceneNavigatorFocus(before, after, "node-a", "edge-a-b")).toBe("node-b");
    expect(restoreSceneNavigatorFocus([], after, "", "edge-a-b")).toBe("edge-a-b");
  });
});

function common(elementId: string, label: string) {
  return {
    elementId,
    semanticRef: `urn:${elementId}`,
    label,
    templateRef: "urn:template:element",
    geometry: { x: 0, y: 0, width: 100, height: 50 },
    style: { fill: "#fff", stroke: "#000", text: "#000", accent: "#999" },
  };
}

function container(elementId: string, label: string): SceneContainer {
  return {
    ...common(elementId, label),
    structuralKind: "container",
    headerPosition: "top",
    pinned: false,
    placement: "generated",
  };
}

function node(elementId: string, label: string): SceneNode {
  return {
    ...common(elementId, label),
    structuralKind: "node",
    shape: "rectangle",
    pinned: false,
    placement: "generated",
  };
}
