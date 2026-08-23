import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  parseIriographDocumentV1,
  projectSemanticView,
  standardRdfRdfsCatalog,
} from "@iriograph/core";

import {
  mockProjectionCatalog,
  workflowDomainCatalog,
} from "./catalog";

describe("normalized RDF/RDFS mock", () => {
  it("defaultsなしdomain catalogをstandard catalogと決定的に結合する", () => {
    expect(workflowDomainCatalog.defaults).toBeUndefined();
    expect(mockProjectionCatalog.profileRef).toBe(standardRdfRdfsCatalog.profileRef);
    expect(mockProjectionCatalog.defaults).toEqual(standardRdfRdfsCatalog.defaults);
    expect(Object.keys(mockProjectionCatalog.templates)).toEqual(
      [...Object.keys(mockProjectionCatalog.templates)].sort(compareText),
    );
    expect(Object.keys(mockProjectionCatalog.assets)).toEqual(
      [...Object.keys(mockProjectionCatalog.assets)].sort(compareText),
    );
    expect(new Set(mockProjectionCatalog.rules.map((rule) => rule.ruleId)).size)
      .toBe(mockProjectionCatalog.rules.length);
  });

  it("Bag/Seq/Alt/seeAlsoからcontainer・node・derived edgeを投影する", () => {
    const document = sampleDocument();
    const projected = projectSemanticView(document, mockProjectionCatalog);

    expect(projected.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(projected.containers).toHaveLength(2);
    expect(projected.nodes).toHaveLength(8);
    expect(projected.edges).toHaveLength(10);
    expect(projected.containers.map((item) => item.semanticRef)).toEqual([
      "urn:iriograph:demo:operationsLane",
      "urn:iriograph:demo:requesterLane",
    ]);
    expect(projected.nodes.find((item) => item.semanticRef === "urn:iriograph:demo:approvalPolicy"))
      .toMatchObject({ iconRef: "urn:iriograph:mock-workspace:asset:approval-policy" });
    expect(projected.edges.some((edge) => edge.provenance.operator === "alternative")).toBe(true);
    expect(projected.edges.some((edge) => edge.provenance.operator === "ordinal-sequence")).toBe(true);
    expect(projected.edges.some((edge) => edge.provenance.operator === "direct-edge")).toBe(true);
    const review = projected.nodes.find((item) => item.semanticRef === "urn:iriograph:demo:review")!;
    const policy = projected.nodes.find((item) => item.semanticRef === "urn:iriograph:demo:approvalPolicy")!;
    expect(projected.edges.filter((edge) => (
      edge.sourceElementId === review.elementId && edge.targetElementId === policy.elementId
    ))).toHaveLength(2);
    expect(projected.edges.filter((edge) => (
      edge.sourceElementId === review.elementId && edge.targetElementId === review.elementId
    ))).toHaveLength(1);
  });

  it("旧workflow構造語彙をsemantic sourceに残さない", () => {
    const source = sampleDocument().semantic.source;
    for (const obsolete of ["wf:Lane", "wf:SequenceFlow", "wf:from", "wf:to", "wf:inLane"]) {
      expect(source).not.toContain(obsolete);
    }
    expect(source).toContain("a rdf:Bag");
    expect(source).toContain("a rdf:Seq");
    expect(source).toContain("a rdf:Alt");
    expect(source).toContain("rdfs:seeAlso");
  });
});

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sampleDocument() {
  const source = readFileSync(
    new URL("../../public/workspace/models/purchase-approval.iriograph", import.meta.url),
    "utf8",
  );
  return parseIriographDocumentV1(JSON.parse(source) as unknown);
}
