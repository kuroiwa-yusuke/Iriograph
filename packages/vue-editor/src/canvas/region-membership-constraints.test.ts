import { describe, expect, it } from "vitest";

import type { DiagramScene } from "@iriograph/core";

import {
  constrainIconPresentationResize,
  constrainMembershipRegionMovement,
  membershipRegionClassIrisAtPoint,
} from "./region-membership-constraints";
import { translateEditorMessage } from "../localization/editor-localization";

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

  it("複数class regionの交差へnode全体をclampしoperator名に依存しない", () => {
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
    }]).changes[0]?.geometry).toMatchObject({ x: 200, y: 170 });
  });

  it("空intersectionを拒否し、pointer上のderived class regionを全件返す", () => {
    const scene = matrixScene();
    scene.regions![1]!.geometry.x = 400;
    const english = constrainMembershipRegionMovement(scene, [{
      elementId: "node",
      geometry: { x: 80, y: 80, width: 40, height: 30 },
    }]);
    expect(english).toMatchObject({
      changes: [],
      issue: {
        code: "membership-region-intersection-empty",
        message: expect.stringContaining("same movement"),
      },
    });
    expect(constrainMembershipRegionMovement(scene, [{
      elementId: "node",
      geometry: { x: 80, y: 80, width: 40, height: 30 },
    }], (key, parameters) => translateEditorMessage("ja", key, parameters))).toMatchObject({
      issue: { message: expect.stringContaining("全所属領域") },
    });

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

  it("相対配置が不変な既存の非包含は再判定せず、固定された共有所属は引き続きclampする", () => {
    const scene = matrixScene();
    scene.regions![0]!.geometry = { x: 20, y: 20, width: 50, height: 50 };

    const result = constrainMembershipRegionMovement(scene, [
      { elementId: "region-a", geometry: { x: 220, y: 20, width: 50, height: 50 } },
      { elementId: "node", geometry: { x: 340, y: 90, width: 40, height: 30 } },
    ]);

    expect(result.issue).toBeUndefined();
    expect(result.changes).toEqual([
      { elementId: "region-a", geometry: { x: 180, y: 20, width: 50, height: 50 } },
      { elementId: "node", geometry: { x: 300, y: 90, width: 40, height: 30 } },
    ]);
  });

  it("Seq・領域・containerの全所属intersectionへmemberをclampする", () => {
    const scene = overlappingSequenceScene();
    const result = constrainMembershipRegionMovement(scene, [{
      elementId: "node",
      geometry: { x: 40, y: 40, width: 40, height: 30 },
    }]);

    expect(result.issue).toBeUndefined();
    expect(result.changes).toEqual([{
      elementId: "node",
      geometry: { x: 136, y: 106, width: 40, height: 30 },
    }]);
  });

  it("一つのSeqと共通memberを動かしても別Seq・領域の外へ出さない", () => {
    const scene = overlappingSequenceScene();
    const result = constrainMembershipRegionMovement(scene, [
      { elementId: "seq-a", geometry: { x: -80, y: 20, width: 260, height: 200 } },
      { elementId: "node", geometry: { x: 50, y: 120, width: 40, height: 30 } },
    ]);

    expect(result.issue).toBeUndefined();
    expect(result.changes).toEqual([
      { elementId: "seq-a", geometry: { x: 6, y: 20, width: 260, height: 200 } },
      { elementId: "node", geometry: { x: 136, y: 120, width: 40, height: 30 } },
    ]);
  });

  it("Seq resizeで共有memberをcontent外へ残す変更をatomicに拒否する", () => {
    const scene = overlappingSequenceScene();

    expect(constrainMembershipRegionMovement(scene, [{
      elementId: "seq-a",
      geometry: { x: 20, y: 20, width: 150, height: 200 },
    }])).toMatchObject({
      changes: [],
      issue: { code: "membership-region-intersection-empty", elementId: "node" },
    });
  });

  it("icon growthを複数所属領域のintersectionへ比率を保ってclampする", () => {
    const scene = matrixScene();
    const node = scene.nodes[0]!;
    node.geometry = { x: 140, y: 90, width: 80, height: 70 };
    node.iconIntrinsicSize = { width: 24, height: 24, aspectRatio: 1, source: "svg-view-box" };

    const result = constrainIconPresentationResize(
      scene,
      node,
      { width: 260, height: 260 },
      { x: 140, y: 90, width: 300, height: 292 },
    );

    expect(result.constrained).toBe(true);
    expect(result.geometry).toBeDefined();
    expect(result.geometry!.x + result.geometry!.width).toBeLessThanOrEqual(240.001);
    expect(result.geometry!.y + result.geometry!.height).toBeLessThanOrEqual(200.001);
    expect(result.size.width / result.size.height).toBeCloseTo(1);
    expect(result.size.width + 40).toBeLessThanOrEqual(result.geometry!.width + .001);
    expect(result.size.height + 32).toBeLessThanOrEqual(result.geometry!.height + .001);
  });

  it("nodeを広げないicon resizeはframe内へ比率を保ってclampする", () => {
    const scene = matrixScene();
    const node = scene.nodes[0]!;
    node.geometry = { x: 140, y: 90, width: 80, height: 70 };

    const result = constrainIconPresentationResize(scene, node, { width: 400, height: 100 });

    expect(result).toMatchObject({
      constrained: true,
      size: { width: 40, height: 10 },
    });
    expect(result.geometry).toBeUndefined();
  });
});

function overlappingSequenceScene(): DiagramScene {
  const sequenceProvenance = {
    sourceStatementRefs: ["urn:test:sequence-statement"],
    operator: "ordinal-sequence" as const,
    derivation: "direct" as const,
  };
  const regionProvenance = {
    sourceStatementRefs: ["urn:test:region-statement"],
    operator: "membership-region" as const,
    derivation: "direct" as const,
  };
  const container = (elementId: string, x: number, y: number, width: number, height: number) => ({
    elementId,
    semanticRef: `urn:test:${elementId}`,
    structuralKind: "container" as const,
    label: elementId,
    templateRef: "urn:test:sequence",
    headerPosition: "top" as const,
    geometry: { x, y, width, height },
    style: { fill: "#fff", stroke: "#000", text: "#000" },
    pinned: false,
    placement: "generated" as const,
  });
  return {
    viewId: "main",
    width: 600,
    height: 400,
    diagnostics: [],
    containers: [
      container("seq-a", 20, 20, 260, 200),
      container("seq-b", 120, 60, 240, 180),
    ],
    regions: [{
      elementId: "region",
      semanticRef: "urn:test:Region",
      structuralKind: "region",
      label: "Region",
      templateRef: "urn:test:region",
      geometry: { x: 100, y: 80, width: 220, height: 180 },
      style: { fill: "#fff", stroke: "#000", text: "#000" },
      pinned: false,
      placement: "generated",
      provenance: regionProvenance,
    }],
    nodes: [{
      elementId: "node",
      semanticRef: "urn:test:item",
      structuralKind: "node",
      label: "Item",
      templateRef: "urn:test:node",
      shape: "rectangle",
      geometry: { x: 150, y: 120, width: 40, height: 30 },
      style: { fill: "#fff", stroke: "#000", text: "#000" },
      pinned: false,
      placement: "generated",
    }],
    memberships: [
      { semanticRef: "urn:test:seq-a-1", containerElementId: "seq-a", memberElementId: "node", role: "sequence-member", ordinal: 1, provenance: sequenceProvenance },
      { semanticRef: "urn:test:seq-b-1", containerElementId: "seq-b", memberElementId: "node", role: "sequence-member", ordinal: 1, provenance: sequenceProvenance },
      { semanticRef: "urn:test:region-member", containerElementId: "region", regionElementId: "region", memberElementId: "node", role: "membership", provenance: regionProvenance },
    ],
    edges: [],
  };
}

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
