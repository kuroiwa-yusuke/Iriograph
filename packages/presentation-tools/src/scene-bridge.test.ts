import { describe, expect, it } from "vitest";

import type { DiagramScene } from "@iriograph/core";
import {
  DEFAULT_PRESENTATION_TOOL_POLICY,
  PRESENTATION_FIELDS,
  PresentationSceneBridge,
  validatePresentationCandidate,
} from "./index.js";
import { presentationFieldAppliesToKind } from "./contracts.js";

describe("PresentationSceneBridge", () => {
  it("hides IRI-derived Scene identities and maps an accepted patch back inside the Host", () => {
    const bridge = new PresentationSceneBridge({
      scene: sourceScene(),
      binding: { documentRevision: "urn:document:r1", contextRevision: "urn:context:r1", viewId: "view-001" },
    });
    expect(bridge.index.snapshot().elements.map((element) => element.elementId)).toEqual([
      "n01",
      "node-001",
      "region-001",
      "edge-001",
      "annotation-001",
    ]);
    expect(JSON.stringify(bridge.index.snapshot())).not.toContain("urn:secret");
    expect(bridge.aliasForSourceElement("node:urn%3Asecret%3Ab")).toBe("node-001");

    const validation = validatePresentationCandidate({
      binding: bridge.index.binding,
      candidateId: "candidate-001",
      changes: [{ elementId: "node-001", geometry: { x: 300, y: 100, width: 120, height: 70 } }],
    }, bridge.index, capabilities(), DEFAULT_PRESENTATION_TOOL_POLICY);
    expect(validation.accepted).toBe(true);
    if (!validation.accepted) return;
    expect(bridge.toSourcePatch(validation).changes[0]?.elementId).toBe("node:urn%3Asecret%3Ab");
  });

  it("rejects a semantic view IRI at the tool-facing binding", () => {
    expect(() => new PresentationSceneBridge({
      scene: sourceScene(),
      binding: { documentRevision: "r1", contextRevision: "c1", viewId: "urn:secret:view" },
    })).toThrowError(/opaque/u);
  });
});

function capabilities() {
  const kinds = ["node", "container", "region", "edge", "annotation"] as const;
  return {
    contextRevision: "urn:context:r1",
    fieldRules: PRESENTATION_FIELDS.flatMap((field) => {
      const elementKinds = kinds.filter((kind) => presentationFieldAppliesToKind(field, kind));
      return elementKinds.length > 0 ? [{ field, elementKinds }] : [];
    }),
    routeModes: ["auto", "straight", "orthogonal", "curve", "manual"],
    markers: ["none", "arrow", "open-arrow", "triangle", "diamond", "circle"],
  };
}

function sourceScene(): DiagramScene {
  const geometry = { x: 10, y: 10, width: 120, height: 70 };
  const style = { fill: "#ffffff", stroke: "#333333", text: "#111111" };
  const provenance = {
    sourceStatementRefs: [],
    operator: "implicit-resource" as const,
    derivation: "resource" as const,
  };
  return {
    viewId: "urn:secret:view",
    width: 800,
    height: 600,
    nodes: [{
      elementId: "n01", semanticRef: "urn:secret:a", structuralKind: "node", label: "A",
      templateRef: "urn:template", shape: "rectangle", geometry,
      style, pinned: false, placement: "generated", provenance,
    }, {
      elementId: "node:urn%3Asecret%3Ab", semanticRef: "urn:secret:b", structuralKind: "node", label: "B",
      templateRef: "urn:template", shape: "rectangle", geometry: { ...geometry, x: 220 },
      style, pinned: false, placement: "generated", provenance,
    }],
    containers: [],
    regions: [{
      elementId: "region:urn%3Asecret%3Ag", semanticRef: "urn:secret:g", structuralKind: "region", label: "Group",
      templateRef: "urn:template:group", geometry: { x: 0, y: 0, width: 500, height: 300 },
      style, pinned: false, placement: "generated", provenance,
    }],
    memberships: [{
      semanticRef: "urn:membership", containerElementId: "region:urn%3Asecret%3Ag", regionElementId: "region:urn%3Asecret%3Ag",
      memberElementId: "n01", role: "membership", provenance,
    }],
    annotations: [{
      elementId: "annotation:urn%3Asecret%3Anote", annotationId: "urn:secret:note", structuralKind: "annotation",
      annotationKind: "view", text: "Note", defaultSize: { width: 100, height: 50 }, geometry: { x: 30, y: 330, width: 100, height: 50 },
      style, pinned: false, placement: "generated", provenance: { kind: "view-annotation", viewId: "urn:secret:view", annotationId: "urn:secret:note" },
    }],
    edges: [{
      elementId: "edge:urn%3Asecret%3Ae", semanticRef: "urn:secret:e", structuralKind: "edge", label: "next",
      sourceElementId: "n01", targetElementId: "node:urn%3Asecret%3Ab", templateRef: "urn:template:edge",
      style, fallback: false, provenance,
    }],
    diagnostics: [],
  };
}
