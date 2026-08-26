import { describe, expect, it } from "vitest";

import {
  displayInspectorSectionsFor,
  displayInspectorSectionForContextDestination,
  primaryDisplayInspectorSection,
} from "./display-inspector-sections";

describe("display inspector progressive disclosure", () => {
  it("nodeは形・icon・geometryを同じpanelのsectionとして提示する", () => {
    const subject = { structuralKind: "node" as const, hasGeometry: true, groupFrame: false };
    expect(displayInspectorSectionsFor(subject)).toEqual(["appearance", "icon", "geometry"]);
    expect(primaryDisplayInspectorSection(subject)).toBe("appearance");
  });

  it("edgeは線形式・接続・label・styleを分けて線形式を最初に開く", () => {
    const subject = { structuralKind: "edge" as const, hasGeometry: false, groupFrame: false };
    expect(displayInspectorSectionsFor(subject)).toEqual([
      "routing", "edge-connection", "edge-label", "appearance",
    ]);
    expect(primaryDisplayInspectorSection(subject)).toBe("routing");
  });

  it("3種のgroup frameは枠style・名称と層・geometryを同じ順序で使う", () => {
    for (const structuralKind of ["container", "region"] as const) {
      const subject = { structuralKind, hasGeometry: true, groupFrame: true };
      expect(displayInspectorSectionsFor(subject)).toEqual([
        "appearance", "region-label", "geometry",
      ]);
    }
  });

  it("context menu destinationを該当する折り畳みsectionへ解決する", () => {
    expect(displayInspectorSectionForContextDestination("element")).toBe("appearance");
    expect(displayInspectorSectionForContextDestination("icon")).toBe("icon");
    expect(displayInspectorSectionForContextDestination("line")).toBe("routing");
    expect(displayInspectorSectionForContextDestination("group")).toBe("region-label");
  });
});
