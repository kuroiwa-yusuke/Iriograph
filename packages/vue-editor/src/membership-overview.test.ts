import { describe, expect, it } from "vitest";

import type {
  DiagramScene,
  ProjectionProvenance,
  SceneContainer,
  SceneNode,
  SceneRegion,
} from "@iriograph/core";

import { membershipOverviewForElement } from "./membership-overview";

const provenance: ProjectionProvenance = {
  sourceStatementRefs: ["urn:test:statement:membership"],
  operator: "membership-container",
  derivation: "derived",
};

describe("selection membership overview", () => {
  it("returns exact empty membership lists without inferring from geometry", () => {
    const scene = sceneFor({ nodes: [node("loose", "領域内に見えるだけ")] });
    scene.regions = [region("region", "見た目の領域")];
    scene.nodes[0]!.geometry = { x: 80, y: 80, width: 120, height: 64 };
    scene.regions[0]!.geometry = { x: 0, y: 0, width: 400, height: 300 };

    expect(membershipOverviewForElement(scene, "loose")).toEqual({
      belongsTo: [],
      contains: [],
    });
  });

  it("keeps both directions for nested and multi-region memberships", () => {
    const scene = sceneFor({
      nodes: [node("shared", "共同担当")],
      containers: [container("outer", "全社"), container("inner", "申請部門")],
      regions: [region("left", "営業"), region("right", "審査")],
    });
    scene.memberships = [
      membership("outer-inner", "outer", "inner"),
      membership("inner-shared", "inner", "shared"),
      membership("left-shared", "left", "shared", { regionElementId: "left" }),
      membership("right-shared", "right", "shared", { regionElementId: "right" }),
    ];

    const nested = membershipOverviewForElement(scene, "inner");
    expect(nested.belongsTo.map((item) => item.label)).toEqual(["全社"]);
    expect(nested.contains.map((item) => item.label)).toEqual(["共同担当"]);
    expect(nested.belongsTo[0]).toMatchObject({
      semanticRef: "outer-inner",
      containerKind: "container",
      role: "membership",
      relatedStructuralKind: "container",
      provenance,
    });

    const multi = membershipOverviewForElement(scene, "shared");
    expect(multi.belongsTo.map((item) => [item.label, item.containerKind])).toEqual([
      ["営業", "region"],
      ["審査", "region"],
      ["申請部門", "container"],
    ]);
  });

  it("preserves every role and ordinal in a 100+ member sequence", () => {
    const members = Array.from({ length: 101 }, (_, index) => (
      node(`member-${index + 1}`, `工程 ${String(index + 1).padStart(3, "0")}`)
    ));
    const sequence = container("sequence", "審査順序", "sequence");
    const scene = sceneFor({ nodes: members, containers: [sequence] });
    scene.memberships = members.map((member, index) => membership(
      `sequence-${index + 1}`,
      sequence.elementId,
      member.elementId,
      { role: "sequence-member", ordinal: index + 1 },
    ));

    const overview = membershipOverviewForElement(scene, sequence.elementId);
    expect(overview.contains).toHaveLength(101);
    expect(overview.contains[0]).toMatchObject({
      label: "工程 001",
      containerKind: "sequence",
      role: "sequence-member",
      ordinal: 1,
    });
    expect(overview.contains[100]).toMatchObject({
      label: "工程 101",
      role: "sequence-member",
      ordinal: 101,
    });
    expect(membershipOverviewForElement(scene, "member-101").belongsTo[0]).toMatchObject({
      label: "審査順序",
      ordinal: 101,
    });
  });
});

function sceneFor(parts: {
  nodes?: SceneNode[];
  containers?: SceneContainer[];
  regions?: SceneRegion[];
}): DiagramScene {
  return {
    viewId: "main",
    width: 1000,
    height: 1000,
    nodes: parts.nodes ?? [],
    containers: parts.containers ?? [],
    regions: parts.regions ?? [],
    memberships: [],
    edges: [],
    diagnostics: [],
  };
}

function node(elementId: string, label: string): SceneNode {
  return {
    elementId,
    semanticRef: `urn:test:${elementId}`,
    structuralKind: "node",
    label,
    templateRef: "urn:test:template:node",
    shape: "rectangle",
    geometry: { x: 0, y: 0, width: 120, height: 64 },
    style: { fill: "#fff", stroke: "#000", text: "#000" },
    pinned: false,
    placement: "generated",
    provenance,
  };
}

function container(
  elementId: string,
  label: string,
  groupRole?: "sequence",
): SceneContainer {
  return {
    elementId,
    semanticRef: `urn:test:${elementId}`,
    structuralKind: "container",
    ...(groupRole ? { groupRole } : {}),
    label,
    templateRef: "urn:test:template:container",
    geometry: { x: 0, y: 0, width: 400, height: 300 },
    headerPosition: "top",
    style: { fill: "#fff", stroke: "#000", text: "#000" },
    pinned: false,
    placement: "generated",
    provenance,
  };
}

function region(elementId: string, label: string): SceneRegion {
  return {
    elementId,
    semanticRef: `urn:test:${elementId}`,
    structuralKind: "region",
    label,
    templateRef: "urn:test:template:region",
    geometry: { x: 0, y: 0, width: 400, height: 300 },
    style: { fill: "#fff", stroke: "#000", text: "#000" },
    pinned: false,
    placement: "generated",
    provenance,
  };
}

function membership(
  semanticRef: string,
  containerElementId: string,
  memberElementId: string,
  options: {
    regionElementId?: string;
    role?: "membership" | "sequence-member";
    ordinal?: number;
  } = {},
) {
  return {
    semanticRef,
    containerElementId,
    memberElementId,
    provenance,
    ...options,
  };
}
