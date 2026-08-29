import { describe, expect, it } from "vitest";

import type { DiagramScene } from "@iriograph/core";

import { createDiagramViewSession, sceneWithCollapsedGroups, sceneWithTemporaryHiddenElements } from "./view-session";

describe("temporary view hiding", () => {
  it("creates session-only selection/viewport/drag defaults", () => {
    expect(createDiagramViewSession()).toMatchObject({
      selectedElementIds: [],
      primaryElementId: "",
      viewport: { zoom: 1, scrollLeft: 0, scrollTop: 0 },
      dragMode: "select",
      collapsedGroupElementIds: new Set(),
    });
  });

  it("uses exact IDs and hides container descendants plus incident edges", () => {
    const source = sceneFixture();

    const filtered = sceneWithTemporaryHiddenElements(source, new Set(["container:a"]));

    expect(filtered.containers.map((item) => item.elementId)).toEqual(["container:ab"]);
    expect(filtered.nodes.map((item) => item.elementId)).toEqual(["node:outside"]);
    expect(filtered.edges).toEqual([]);
    expect(source.nodes).toHaveLength(3);
  });

  it("does not treat an ID as a prefix and can hide only one edge", () => {
    const source = sceneFixture();
    const nodeFiltered = sceneWithTemporaryHiddenElements(source, new Set(["container:a"]));
    expect(nodeFiltered.containers.some((item) => item.elementId === "container:ab")).toBe(true);

    const edgeFiltered = sceneWithTemporaryHiddenElements(source, new Set(["edge:inside"]));
    expect(edgeFiltered.nodes).toHaveLength(3);
    expect(edgeFiltered.containers).toHaveLength(2);
    expect(edgeFiltered.edges.map((item) => item.elementId)).toEqual(["edge:outside"]);
  });

  it("keeps a folded group and removes members without shortcut edges", () => {
    const source = sceneFixture();
    source.memberships = [{
      semanticRef: "membership:outside",
      containerElementId: "container:a",
      memberElementId: "node:outside",
      provenance: { sourceStatementRefs: [], operator: "membership-container", derivation: "derived" },
    }];
    const result = sceneWithCollapsedGroups(source, new Set(["container:a"]));
    expect(result.scene.containers.map((item) => item.elementId)).toContain("container:a");
    expect(result.scene.nodes).toEqual([]);
    expect(result.scene.edges).toEqual([]);
    expect(result.summaries["container:a"]?.hiddenLabels).toEqual(["Child", "Grandchild", "Outside"]);
  });
});

function sceneFixture(): DiagramScene {
  const geometry = { x: 0, y: 0, width: 100, height: 50 };
  const style = { fill: "#fff", stroke: "#000", text: "#000" };
  return {
    viewId: "main",
    width: 500,
    height: 300,
    diagnostics: [],
    containers: [
      {
        elementId: "container:a",
        semanticRef: "urn:test:container:a",
        structuralKind: "container",
        label: "A",
        templateRef: "container",
        geometry,
        headerPosition: "top",
        style,
        pinned: false,
        placement: "generated",
      },
      {
        elementId: "container:ab",
        semanticRef: "urn:test:container:ab",
        structuralKind: "container",
        label: "AB",
        templateRef: "container",
        geometry,
        headerPosition: "top",
        style,
        pinned: false,
        placement: "generated",
      },
    ],
    nodes: [
      {
        elementId: "node:child",
        semanticRef: "urn:test:child",
        structuralKind: "node",
        label: "Child",
        templateRef: "node",
        shape: "rectangle",
        geometry,
        style,
        parentElementId: "container:a",
        pinned: false,
        placement: "generated",
      },
      {
        elementId: "node:grandchild",
        semanticRef: "urn:test:grandchild",
        structuralKind: "node",
        label: "Grandchild",
        templateRef: "node",
        shape: "rectangle",
        geometry,
        style,
        parentElementId: "node:child",
        pinned: false,
        placement: "generated",
      },
      {
        elementId: "node:outside",
        semanticRef: "urn:test:outside",
        structuralKind: "node",
        label: "Outside",
        templateRef: "node",
        shape: "rectangle",
        geometry,
        style,
        pinned: false,
        placement: "generated",
      },
    ],
    edges: [
      {
        elementId: "edge:inside",
        semanticRef: "urn:test:edge:inside",
        structuralKind: "edge",
        sourceElementId: "node:child",
        targetElementId: "node:outside",
        templateRef: "edge",
        style,
        label: "",
        fallback: false,
      },
      {
        elementId: "edge:outside",
        semanticRef: "urn:test:edge:outside",
        structuralKind: "edge",
        sourceElementId: "node:grandchild",
        targetElementId: "node:outside",
        templateRef: "edge",
        style,
        label: "",
        fallback: false,
      },
    ],
  };
}
