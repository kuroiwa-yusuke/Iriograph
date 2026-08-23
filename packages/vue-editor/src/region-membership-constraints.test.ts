import { describe, expect, it } from "vitest";

import type { DiagramScene } from "@iriograph/core";

import {
  constrainMembershipRegionMovement,
  membershipRegionClassIrisAtPoint,
} from "./region-membership-constraints";

describe("membership-region presentation constraints", () => {
  it("複数class regionの交差へnode全体をclampしBag membershipは無視する", () => {
    const scene = matrixScene();
    const result = constrainMembershipRegionMovement(scene, [{
      elementId: "node",
      geometry: { x: 260, y: 260, width: 40, height: 30 },
    }]);
    expect(result.issue).toBeUndefined();
    expect(result.changes[0]?.geometry).toMatchObject({ x: 200, y: 170, width: 40, height: 30 });

    scene.memberships = scene.memberships?.map((membership) => ({
      ...membership,
      provenance: { ...membership.provenance, operator: "membership-container" },
    }));
    expect(constrainMembershipRegionMovement(scene, [{
      elementId: "node",
      geometry: { x: 260, y: 260, width: 40, height: 30 },
    }]).changes[0]?.geometry).toMatchObject({ x: 260, y: 260 });
  });

  it("空intersectionを拒否し、pointer上のderived class regionを全件返す", () => {
    const scene = matrixScene();
    scene.regions![1]!.geometry.x = 400;
    expect(constrainMembershipRegionMovement(scene, [{
      elementId: "node",
      geometry: { x: 80, y: 80, width: 40, height: 30 },
    }])).toMatchObject({ changes: [], issue: { code: "membership-region-intersection-empty" } });

    scene.regions![1]!.geometry.x = 120;
    expect(membershipRegionClassIrisAtPoint(scene, { x: 150, y: 100 }))
      .toEqual(["urn:test:ClassA", "urn:test:ClassB"]);
  });

  it("memberがまだ0件のclass regionも作成位置の分類候補として返す", () => {
    const scene = matrixScene();
    scene.memberships = [];
    expect(membershipRegionClassIrisAtPoint(scene, { x: 150, y: 100 }))
      .toEqual(["urn:test:ClassA", "urn:test:ClassB"]);
  });

  it("resize後もnode全体をclass intersection内へ保つ", () => {
    const scene = matrixScene();
    expect(constrainMembershipRegionMovement(scene, [{
      elementId: "node",
      geometry: { x: 140, y: 90, width: 90, height: 80 },
    }])).toMatchObject({ changes: [{ geometry: { x: 140, y: 90, width: 90, height: 80 } }] });
    expect(constrainMembershipRegionMovement(scene, [{
      elementId: "node",
      geometry: { x: 140, y: 90, width: 130, height: 80 },
    }])).toMatchObject({ changes: [], issue: { code: "membership-region-intersection-empty" } });
  });
});

function matrixScene(): DiagramScene {
  const provenance = {
    sourceStatementRefs: ["urn:test:statement"],
    operator: "membership-region" as const,
    derivation: "direct" as const,
  };
  return {
    viewId: "main",
    width: 600,
    height: 400,
    diagnostics: [],
    containers: [],
    regions: [
      { elementId: "region-a", semanticRef: "urn:test:ClassA", structuralKind: "region", label: "A", templateRef: "urn:test:region", geometry: { x: 20, y: 20, width: 220, height: 180 }, style: { fill: "#fff", stroke: "#000", text: "#000" }, pinned: false, placement: "generated", provenance },
      { elementId: "region-b", semanticRef: "urn:test:ClassB", structuralKind: "region", label: "B", templateRef: "urn:test:region", geometry: { x: 120, y: 60, width: 220, height: 180 }, style: { fill: "#fff", stroke: "#000", text: "#000" }, pinned: false, placement: "generated", provenance },
    ],
    nodes: [{ elementId: "node", semanticRef: "urn:test:item", structuralKind: "node", label: "Item", templateRef: "urn:test:node", shape: "rectangle", geometry: { x: 140, y: 90, width: 40, height: 30 }, style: { fill: "#fff", stroke: "#000", text: "#000" }, pinned: false, placement: "generated" }],
    memberships: [
      { semanticRef: "urn:test:m1", containerElementId: "region-a", regionElementId: "region-a", memberElementId: "node", provenance },
      { semanticRef: "urn:test:m2", containerElementId: "region-b", regionElementId: "region-b", memberElementId: "node", provenance },
    ],
    edges: [],
  };
}
