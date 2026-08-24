import { describe, expect, it } from "vitest";

import type { DiagramScene } from "@iriograph/core";

import {
  constrainMembershipRegionMovement,
  membershipRegionClassIrisAtPoint,
} from "./region-membership-constraints";

describe("membership-region presentation constraints", () => {
  it("一方のregion内だけに残る移動も全所属regionのintersectionへclampする", () => {
    const scene = matrixScene();
    const result = constrainMembershipRegionMovement(scene, [{
      elementId: "node",
      // region-aには収まるが、region-bの左端(x=120)より外側。
      geometry: { x: 40, y: 90, width: 40, height: 30 },
    }]);

    expect(result.issue).toBeUndefined();
    expect(result.changes).toEqual([{
      elementId: "node",
      geometry: { x: 120, y: 90, width: 40, height: 30 },
    }]);
  });

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

  it.each(["container", "region"] as const)(
    "geometryを持つ%s memberも全体をclass intersection内へclampする",
    (kind) => {
      const scene = matrixScene();
      if (kind === "container") {
        scene.containers.push({
            elementId: "nested",
            semanticRef: "urn:test:nested",
            structuralKind: "container" as const,
            label: "Nested",
            templateRef: "urn:test:container",
            geometry: { x: 150, y: 110, width: 30, height: 30 },
            headerPosition: "top" as const,
            style: { fill: "#fff", stroke: "#000", text: "#000" },
            pinned: false,
            placement: "generated" as const,
          });
      } else {
        scene.regions!.push({
            ...scene.regions![0]!,
            elementId: "nested",
            semanticRef: "urn:test:NestedRegion",
            geometry: { x: 150, y: 110, width: 30, height: 30 },
          });
      }
      scene.memberships!.push(
        { ...scene.memberships![0]!, semanticRef: "urn:test:nested-a", memberElementId: "nested" },
        { ...scene.memberships![1]!, semanticRef: "urn:test:nested-b", memberElementId: "nested" },
      );

      const result = constrainMembershipRegionMovement(scene, [{
        elementId: "nested",
        geometry: { x: 280, y: 260, width: 30, height: 30 },
      }]);

      expect(result.issue).toBeUndefined();
      expect(result.changes[0]?.geometry).toMatchObject({ x: 210, y: 170, width: 30, height: 30 });
    },
  );

  it("異なる移動量を持つbatchは一件でも包含違反ならatomicに拒否する", () => {
    const scene = matrixScene();
    scene.nodes.push({
      ...scene.nodes[0]!,
      elementId: "node-2",
      semanticRef: "urn:test:item-2",
      geometry: { x: 150, y: 120, width: 30, height: 20 },
    });
    scene.memberships!.push(
      { ...scene.memberships![0]!, semanticRef: "urn:test:node-2-a", memberElementId: "node-2" },
      { ...scene.memberships![1]!, semanticRef: "urn:test:node-2-b", memberElementId: "node-2" },
    );

    expect(constrainMembershipRegionMovement(scene, [
      { elementId: "node", geometry: { x: 150, y: 100, width: 40, height: 30 } },
      { elementId: "node-2", geometry: { x: 280, y: 120, width: 30, height: 20 } },
    ])).toMatchObject({
      changes: [],
      issue: { code: "membership-region-intersection-empty", elementId: "node-2" },
    });
  });

  it("region本体の移動を所属nodeが外へ出ない範囲へclampする", () => {
    const scene = matrixScene();
    const result = constrainMembershipRegionMovement(scene, [{
      elementId: "region-a",
      geometry: { x: 180, y: 140, width: 220, height: 180 },
    }]);
    expect(result.issue).toBeUndefined();
    expect(result.changes[0]?.geometry).toMatchObject({ x: 140, y: 90, width: 220, height: 180 });
  });

  it("region変更時もmemberの未変更側regionを含む全所属を検証する", () => {
    const scene = matrixScene();
    // 既存geometryがregion-aだけには収まり、region-bから外れている状態を再現する。
    scene.nodes[0]!.geometry = { x: 40, y: 90, width: 40, height: 30 };

    expect(constrainMembershipRegionMovement(scene, [{
      elementId: "region-a",
      geometry: { x: 10, y: 20, width: 220, height: 180 },
    }])).toMatchObject({
      changes: [],
      issue: { code: "membership-region-intersection-empty", elementId: "node" },
    });
  });

  it("複数regionと共通memberを同時移動すると交差内の相対位置を維持する", () => {
    const scene = matrixScene();
    const result = constrainMembershipRegionMovement(scene, [
      { elementId: "region-a", geometry: { x: 40, y: 40, width: 220, height: 180 } },
      { elementId: "region-b", geometry: { x: 140, y: 80, width: 220, height: 180 } },
      { elementId: "node", geometry: { x: 160, y: 110, width: 40, height: 30 } },
    ]);
    expect(result.issue).toBeUndefined();
    expect(result.changes).toEqual([
      { elementId: "region-a", geometry: { x: 40, y: 40, width: 220, height: 180 } },
      { elementId: "region-b", geometry: { x: 140, y: 80, width: 220, height: 180 } },
      { elementId: "node", geometry: { x: 160, y: 110, width: 40, height: 30 } },
    ]);
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
