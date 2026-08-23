import { describe, expect, it } from "vitest";

import type {
  DiagramScene,
  ElementGeometry,
  SceneContainer,
  SceneNode,
} from "@iriograph/core";

import {
  containmentPresentationTranslation,
  findContainmentConsistencyWarnings,
} from "./containment-consistency";

describe("containment consistency", () => {
  it("semantic parentのないnodeがcontent内にある場合だけvisual-only warningを返す", () => {
    const scene = diagramScene({
      containers: [container("lane", { x: 0, y: 0, width: 320, height: 220 })],
      nodes: [
        node("inside", { x: 80, y: 70, width: 80, height: 40 }),
        node("header", { x: 80, y: 2, width: 80, height: 30 }),
        node("outside", { x: 400, y: 70, width: 80, height: 40 }),
      ],
    });

    expect(findContainmentConsistencyWarnings(scene)).toEqual([{
      diagnosticId: "urn:iriograph:diagnostic:containment:v1:visual-only:[\"inside\",\"lane\"]",
      kind: "visual-only",
      elementId: "inside",
      elementKind: "node",
      visualContainerId: "lane",
      actions: [
        {
          kind: "add-semantic-containment",
          elementId: "inside",
          containerElementId: "lane",
        },
        {
          kind: "move-outside-visual-container",
          elementId: "inside",
          containerElementId: "lane",
        },
      ],
    }]);
  });

  it("nested/overlap候補は最小面積、同面積ならelementIdで決定する", () => {
    const scene = diagramScene({
      containers: [
        container("outer", { x: 0, y: 0, width: 600, height: 420 }),
        container("z-small", { x: 80, y: 80, width: 220, height: 180 }, "outer"),
        container("a-small", { x: 80, y: 80, width: 220, height: 180 }, "outer"),
      ],
      nodes: [node("item", { x: 140, y: 140, width: 40, height: 30 })],
    });

    expect(findContainmentConsistencyWarnings(scene)).toEqual([
      expect.objectContaining({
        kind: "visual-only",
        elementId: "item",
        visualContainerId: "a-small",
      }),
    ]);
  });

  it("semantic childのgeometryが親contentから一部でも外れればsemantic-only warningを返す", () => {
    const scene = diagramScene({
      containers: [container("lane", { x: 0, y: 0, width: 320, height: 220 })],
      nodes: [
        node("overflow", { x: 250, y: 80, width: 80, height: 40 }, "lane"),
        node("valid", { x: 80, y: 80, width: 80, height: 40 }, "lane"),
      ],
    });

    expect(findContainmentConsistencyWarnings(scene)).toEqual([{
      diagnosticId: "urn:iriograph:diagnostic:containment:v1:semantic-only:[\"overflow\",\"lane\"]",
      kind: "semantic-only",
      elementId: "overflow",
      elementKind: "node",
      visualContainerId: "lane",
      semanticContainerId: "lane",
      centerInsideSemanticContainer: true,
      geometryInsideSemanticContainer: false,
      actions: [
        {
          kind: "move-inside-semantic-container",
          elementId: "overflow",
          containerElementId: "lane",
        },
        {
          kind: "remove-semantic-containment",
          elementId: "overflow",
          containerElementId: "lane",
        },
      ],
    }]);
  });

  it("別container上へ移動したsemantic childにはvisual候補と置換actionも返す", () => {
    const scene = diagramScene({
      containers: [
        container("semantic", { x: 0, y: 0, width: 300, height: 220 }),
        container("visual", { x: 400, y: 0, width: 300, height: 220 }),
      ],
      nodes: [node("item", { x: 480, y: 80, width: 80, height: 40 }, "semantic")],
    });

    const warning = findContainmentConsistencyWarnings(scene)[0];
    expect(warning).toEqual(expect.objectContaining({
      kind: "semantic-only",
      visualContainerId: "visual",
      semanticContainerId: "semantic",
      centerInsideSemanticContainer: false,
      geometryInsideSemanticContainer: false,
    }));
    expect(warning?.actions).toContainEqual({
      kind: "replace-semantic-containment",
      elementId: "item",
      fromContainerElementId: "semantic",
      toContainerElementId: "visual",
    });
  });

  it("container自身とsemantic descendant containerをvisual parent候補にしない", () => {
    const parent = container("parent", { x: 0, y: 0, width: 500, height: 360 });
    const child = container("child", { x: 80, y: 80, width: 280, height: 220 }, "parent");
    const scene = diagramScene({ containers: [parent, child] });

    expect(findContainmentConsistencyWarnings(scene)).toEqual([]);
  });

  it("cycleを含むparent chainでも停止し、descendant候補を除外する", () => {
    const first = container("first", { x: 0, y: 0, width: 500, height: 360 }, "second");
    const second = container("second", { x: 80, y: 80, width: 280, height: 220 }, "first");
    const scene = diagramScene({ containers: [first, second] });

    expect(() => findContainmentConsistencyWarnings(scene)).not.toThrow();
    expect(findContainmentConsistencyWarnings(scene)).toEqual([
      expect.objectContaining({
        kind: "semantic-only",
        elementId: "first",
        semanticContainerId: "second",
      }),
    ]);
  });

  it("geometryのないelement/containerを対象外にする", () => {
    const scene = diagramScene({
      containers: [container("lane", { x: 0, y: 0, width: 320, height: 220 })],
      nodes: [node("item", { x: 80, y: 70, width: 80, height: 40 })],
    });
    const missingElementGeometry = {
      ...scene,
      nodes: [{ ...scene.nodes[0], geometry: undefined }],
    } as unknown as DiagramScene;
    const missingContainerGeometry = {
      ...scene,
      containers: [{ ...scene.containers[0], geometry: undefined }],
    } as unknown as DiagramScene;

    expect(findContainmentConsistencyWarnings(missingElementGeometry)).toEqual([]);
    expect(findContainmentConsistencyWarnings(missingContainerGeometry)).toEqual([]);
  });

  it("入力順と警告中のgeometry変化に依存しないstable identityを返しSceneを変更しない", () => {
    const original = diagramScene({
      containers: [
        container("z", { x: 400, y: 0, width: 300, height: 220 }),
        container("a", { x: 0, y: 0, width: 300, height: 220 }),
      ],
      nodes: [
        node("z-item", { x: 480, y: 80, width: 80, height: 40 }),
        node("a-item", { x: 80, y: 80, width: 80, height: 40 }),
      ],
    });
    const snapshot = structuredClone(original);
    const moved = {
      ...original,
      containers: [...original.containers].reverse(),
      nodes: [...original.nodes].reverse().map((item) => ({
        ...item,
        geometry: { ...item.geometry, x: item.geometry.x + 4 },
      })),
    };

    const first = findContainmentConsistencyWarnings(original);
    const second = findContainmentConsistencyWarnings(moved);
    expect(first.map((warning) => warning.diagnosticId)).toEqual(
      second.map((warning) => warning.diagnosticId),
    );
    expect(original).toEqual(snapshot);
  });

  it("semantic-only修正は要素全体を親contentへ収める最小移動量だけを返す", () => {
    const scene = diagramScene({
      containers: [container("lane", { x: 0, y: 0, width: 320, height: 220 })],
      nodes: [node("item", { x: 270, y: 190, width: 80, height: 40 }, "lane")],
    });
    const snapshot = structuredClone(scene);

    expect(containmentPresentationTranslation(scene, {
      kind: "move-inside-semantic-container",
      elementId: "item",
      containerElementId: "lane",
    })).toEqual({ x: -46, y: -26 });
    expect(scene).toEqual(snapshot);
  });

  it("visual-only修正はscene内で最短の領域外位置へ移すdeltaを返す", () => {
    const scene = diagramScene({
      containers: [container("lane", { x: 40, y: 40, width: 320, height: 220 })],
      nodes: [node("item", { x: 100, y: 100, width: 80, height: 40 })],
    });
    const translation = containmentPresentationTranslation(scene, {
      kind: "move-outside-visual-container",
      elementId: "item",
      containerElementId: "lane",
    });

    expect(translation).toEqual({ x: 0, y: -35 });
    const center = {
      x: 100 + translation!.x + 40,
      y: 100 + translation!.y + 20,
    };
    expect(center.y).toBeLessThan(86);
  });

  it("親contentより大きい要素や存在しない対象には修正量を返さない", () => {
    const scene = diagramScene({
      containers: [container("lane", { x: 0, y: 0, width: 200, height: 120 })],
      nodes: [node("large", { x: 30, y: 30, width: 220, height: 100 }, "lane")],
    });

    expect(containmentPresentationTranslation(scene, {
      kind: "move-inside-semantic-container",
      elementId: "large",
      containerElementId: "lane",
    })).toBeUndefined();
    expect(containmentPresentationTranslation(scene, {
      kind: "move-outside-visual-container",
      elementId: "missing",
      containerElementId: "lane",
    })).toBeUndefined();
  });
});

function diagramScene({
  nodes = [],
  containers = [],
}: {
  nodes?: SceneNode[];
  containers?: SceneContainer[];
}): DiagramScene {
  return {
    viewId: "main",
    width: 900,
    height: 600,
    nodes,
    containers,
    edges: [],
    diagnostics: [],
  };
}

function node(
  elementId: string,
  geometry: ElementGeometry,
  parentElementId?: string,
): SceneNode {
  return {
    elementId,
    semanticRef: `urn:resource:${elementId}`,
    structuralKind: "node",
    label: elementId,
    templateRef: "urn:template:node",
    shape: "rectangle",
    geometry,
    parentElementId,
    style: { fill: "#fff", stroke: "#000", text: "#000" },
    pinned: false,
    placement: "generated",
  };
}

function container(
  elementId: string,
  geometry: ElementGeometry,
  parentElementId?: string,
): SceneContainer {
  return {
    elementId,
    semanticRef: `urn:resource:${elementId}`,
    structuralKind: "container",
    label: elementId,
    templateRef: "urn:template:container",
    geometry,
    parentElementId,
    headerPosition: "top",
    style: { fill: "#fff", stroke: "#000", text: "#000" },
    pinned: false,
    placement: "generated",
  };
}
