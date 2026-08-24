import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  parseIriographDocumentV1,
  projectSemanticView,
  standardRdfRdfsCatalog,
} from "@iriograph/core";

import {
  mockProjectionCatalog,
  mockClassificationRegionProjectionCatalog,
  mockInstanceFlowProjectionCatalog,
  workflowClassificationRegionDomainCatalog,
  workflowDomainCatalog,
  workflowInstanceFlowDomainCatalog,
} from "./catalog";

describe("normalized RDF/RDFS mock", () => {
  it("defaultsなしdomain catalogをstandard catalogと決定的に結合する", () => {
    expect(workflowDomainCatalog.defaults).toBeUndefined();
    expect(workflowDomainCatalog.rules).toEqual([]);
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
    expect(mockInstanceFlowProjectionCatalog.profileRef)
      .toBe("urn:iriograph:profile:rdf-rdfs:instance-flow:1");
    expect(mockClassificationRegionProjectionCatalog.profileRef)
      .toBe("urn:iriograph:profile:rdf-rdfs:classification-region:1");
    expect(workflowInstanceFlowDomainCatalog.defaults).toBeUndefined();
    expect(workflowClassificationRegionDomainCatalog.defaults).toBeUndefined();
  });

  it("標準regionと明示追加したnode-linkから同じ意味graphを投影する", () => {
    const document = sampleDocument();
    const regionView = document.views[0]!;
    document.views.push({
      viewId: "flow-compatibility",
      kind: "node-link",
      profileRef: mockInstanceFlowProjectionCatalog.profileRef,
      layoutRef: mockInstanceFlowProjectionCatalog.defaults!.layoutRef,
      locale: "ja",
      // The sample intentionally stores only the region view. Reuse its sparse
      // semanticRef-based presentation overrides when exercising the optional
      // node-link compatibility projection.
      overlay: structuredClone(regionView.overlay),
    });
    const projected = projectSemanticView(
      document,
      mockInstanceFlowProjectionCatalog,
      "flow-compatibility",
    );

    expect(projected.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(projected.containers).toHaveLength(3);
    expect(projected.nodes).toHaveLength(8);
    expect(projected.edges).toHaveLength(10);
    expect(projected.containers.map((item) => item.semanticRef).sort(compareText)).toEqual([
      "urn:iriograph:demo:g-01",
      "urn:iriograph:demo:g-02",
      "urn:iriograph:demo:g-03",
    ]);
    expect(projected.nodes.find((item) => item.semanticRef === "urn:iriograph:demo:n-04"))
      .toMatchObject({
        templateRef: "urn:iriograph:template:reference:1",
        iconRef: "urn:iriograph:mock-workspace:asset:approval-policy",
      });
    expect(projected.nodes.find((item) => item.semanticRef === "urn:iriograph:demo:n-01"))
      .toMatchObject({ templateRef: "urn:iriograph:template:start-event:1" });
    expect(projected.nodes.find((item) => item.semanticRef === "urn:iriograph:demo:c-01"))
      .toMatchObject({ templateRef: "urn:iriograph:template:gateway:1" });
    expect(projected.edges.some((edge) => edge.provenance.operator === "alternative")).toBe(true);
    expect(projected.edges.some((edge) => edge.provenance.operator === "ordinal-sequence")).toBe(true);
    expect(projected.edges.some((edge) => edge.provenance.operator === "direct-edge")).toBe(true);
    const review = projected.nodes.find((item) => item.semanticRef === "urn:iriograph:demo:n-03")!;
    const policy = projected.nodes.find((item) => item.semanticRef === "urn:iriograph:demo:n-04")!;
    expect(projected.edges.filter((edge) => (
      edge.sourceElementId === review.elementId && edge.targetElementId === policy.elementId
    ))).toHaveLength(2);
    expect(projected.edges.filter((edge) => (
      edge.sourceElementId === review.elementId && edge.targetElementId === review.elementId
    ))).toHaveLength(1);

    expect(projected.edges.find((edge) => edge.label === "関連する"))
      .toMatchObject({ fallback: true });
    expect(projected.edges.find((edge) => edge.label === "再試行"))
      .toMatchObject({ fallback: true });
    const reviewMemberships = (projected.memberships ?? []).filter((membership) => (
      membership.memberElementId === review.elementId
    ));
    expect(reviewMemberships).toHaveLength(2);
    expect(review.parentElementId).toBeUndefined();
    expect(reviewMemberships.map((membership) => membership.provenance.editCapability))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ predicate: "http://www.w3.org/2000/01/rdf-schema#member" }),
        expect.objectContaining({ predicate: "urn:iriograph:demo:p-03" }),
      ]));

    const regions = projectSemanticView(
      document,
      mockClassificationRegionProjectionCatalog,
      regionView.viewId,
    );
    expect(regions.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(regions.containers).toEqual([]);
    expect(regions.regions ?? []).toHaveLength(5);
    const regionReview = regions.nodes.find((item) => item.semanticRef === "urn:iriograph:demo:n-03");
    const regionReviewMemberships = (regions.memberships ?? []).filter((membership) => (
      membership.memberElementId === regionReview?.elementId
    ));
    expect(regionReviewMemberships).toHaveLength(4);
    expect(regionReviewMemberships.filter((membership) => (
      membership.provenance.operator === "membership-region"
      && membership.provenance.editCapability?.command === "set-membership"
      && membership.provenance.editCapability.predicate === "http://www.w3.org/1999/02/22-rdf-syntax-ns#type"
    ))).toHaveLength(2);
    expect(regions.regions?.find((item) => item.semanticRef === "urn:iriograph:demo:g-03")?.style)
      .toMatchObject({ fill: "#ede9fe", fillOpacity: 0.2 });
    expect(regions.nodes.find((item) => item.semanticRef === "urn:iriograph:demo:n-05"))
      .toMatchObject({ templateRef: "urn:iriograph:template:service-task:1" });
    expect(regions.nodes.find((item) => item.semanticRef === "urn:iriograph:demo:n-07"))
      .toMatchObject({ templateRef: "urn:iriograph:template:end-event:1" });
  });

  it("旧workflow構造語彙をsemantic sourceに残さない", () => {
    const source = sampleDocument().semantic.source;
    for (const obsolete of [
      "wf:Lane",
      "wf:SequenceFlow",
      "wf:from",
      "wf:to",
      "wf:inLane",
      "wf:StartEvent",
      "wf:UserTask",
      "wf:ServiceTask",
      "wf:ExclusiveGateway",
      "wf:EndEvent",
      "wf:Reference",
    ]) {
      expect(source).not.toContain(obsolete);
    }
    expect(source).toContain("a rdf:Bag");
    expect(source).toContain("a rdf:Seq");
    expect(source).toContain("a rdf:Alt");
    expect(source).toContain("rdfs:seeAlso");
    expect(source).toContain("wf:p-01");
    expect(source).toContain("wf:p-02");
    expect(source).toContain("wf:p-03 a rdf:Property");
    expect(source).toContain("rdfs:subPropertyOf rdfs:member");
    expect(source).toContain('rdfs:label "関連する"@ja');
    expect(source).toContain('rdfs:comment "標準の包含を特殊化し、元predicateを保持する業務語彙"@ja');
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
