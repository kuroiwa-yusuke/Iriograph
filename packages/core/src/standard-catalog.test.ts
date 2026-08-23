import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { statementIdentity } from "./identity";
import type { IriographDocumentV1, ProjectionCatalogV1 } from "./model";
import { projectSemanticView } from "./projection";
import { standardRdfRdfsCatalog } from "./standard-catalog";

const workflowSource = readFileSync(
  new URL("./fixtures/rdf-rdfs.valid-workflow.ttl", import.meta.url),
  "utf8",
);
const invalidStructureSource = readFileSync(
  new URL("./fixtures/rdf-rdfs.invalid-structure.ttl", import.meta.url),
  "utf8",
);

describe("RDF/RDFS standard projection", () => {
  it("Bag、Seq、Alt、direct edge、suppress、fallbackを汎用operatorで投影する", () => {
    const scene = projectSemanticView(documentFor(workflowSource), standardRdfRdfsCatalog);

    expect(scene.diagnostics).toEqual([]);
    expect(scene.containers).toHaveLength(2);
    expect(scene.nodes).toHaveLength(8);
    expect(scene.edges).toHaveLength(9);
    expect(scene.nodes.every((node) => node.geometry === undefined)).toBe(true);
    expect(scene.nodes.find((node) => node.semanticRef === "urn:test:workflow:decision")).toMatchObject({
      label: "判断",
      shape: "diamond",
      provenance: {
        operator: "alternative",
        rule: {
          catalogRef: "urn:iriograph:catalog:rdf-rdfs@1",
          ruleId: "rdf-alt",
        },
      },
    });
    expect(scene.edges.filter((edge) => edge.fallback)).toHaveLength(1);
    expect(scene.edges.find((edge) => edge.fallback)).toMatchObject({
      label: "dependsOn",
      provenance: {
        derivation: "direct",
        rule: { ruleId: "iri-object-fallback" },
      },
    });
    expect(scene.edges.filter((edge) => edge.provenance.operator === "ordinal-sequence")).toHaveLength(5);
    expect(scene.edges.filter((edge) => edge.provenance.operator === "alternative")).toHaveLength(2);
  });

  it("subClassOf/subPropertyOfの限定closureをrule matchingだけに使う", () => {
    const scene = projectSemanticView(documentFor(`
      @prefix : <urn:test:closure:> .
      @prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
      @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
      :Region rdfs:subClassOf rdf:Bag .
      :PolicyLink rdfs:subPropertyOf rdfs:seeAlso .
      :lane a :Region ; rdfs:member :a .
      :a rdfs:label "A" ; :PolicyLink :b .
      :b rdfs:label "B" .
    `), standardRdfRdfsCatalog);

    expect(scene.diagnostics).toEqual([]);
    expect(scene.containers.some((container) => container.semanticRef === "urn:test:closure:lane")).toBe(true);
    expect(scene.edges.find((edge) => edge.label === "PolicyLink")).toMatchObject({
      templateRef: "urn:iriograph:template:edge:reference:1",
      provenance: { rule: { ruleId: "rdfs-see-also" } },
    });
  });

  it("ordinal-sequence ruleの任意edge templateをderived edgeへ適用する", () => {
    const edgeTemplateRef = "urn:iriograph:template:edge:reference:1";
    const catalog: ProjectionCatalogV1 = {
      ...standardRdfRdfsCatalog,
      rules: standardRdfRdfsCatalog.rules.map((rule) => (
        rule.ruleId === "rdf-seq" ? { ...rule, templateRef: edgeTemplateRef } : rule
      )),
    };

    const scene = projectSemanticView(documentFor(workflowSource), catalog);

    expect(scene.diagnostics).toEqual([]);
    expect(scene.edges
      .filter((edge) => edge.provenance.operator === "ordinal-sequence")
      .every((edge) => edge.templateRef === edgeTemplateRef)).toBe(true);
  });

  it("Turtleの整形とstatement中の区切り文字に依存しないidentityを使う", () => {
    const first = documentFor(`
      @prefix : <urn:test:id:> .
      @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
      :a rdfs:label "A" ; :p :b .
      :b rdfs:label "B" .
    `);
    const second = documentFor(`
      @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
      @prefix x: <urn:test:id:> .
      x:b rdfs:label "B" .
      x:a x:p x:b ; rdfs:label "A" .
    `);
    const firstEdge = projectSemanticView(first, standardRdfRdfsCatalog).edges[0];
    const secondEdge = projectSemanticView(second, standardRdfRdfsCatalog).edges[0];

    expect(firstEdge?.semanticRef).toBe(secondEdge?.semanticRef);
    expect(firstEdge?.semanticRef).toBe(statementIdentity(
      "urn:test:id:a",
      "urn:test:id:p",
      "urn:test:id:b",
    ));
    expect(statementIdentity("urn:test:a|b", "urn:test:p", "urn:test:c")).not.toBe(
      statementIdentity("urn:test:a", "urn:test:b|p", "urn:test:c"),
    );
  });

  it("構造違反を投影前のblocking diagnosticにする", () => {
    const scene = projectSemanticView(documentFor(invalidStructureSource), standardRdfRdfsCatalog);
    const codes = new Set(scene.diagnostics.map((diagnostic) => diagnostic.code));

    expect(scene.nodes).toEqual([]);
    expect([...codes]).toEqual(expect.arrayContaining([
      "multiple-container-parents",
      "container-cycle",
      "non-contiguous-ordinals",
      "alternative-too-few-members",
      "multiple-structural-types",
      "structural-resource-must-be-named",
      "orphan-ordinal-membership",
      "membership-parent-invalid",
    ]));
  });

  it("同順位rule競合を配列順で解決しない", () => {
    const conflictingRules: ProjectionCatalogV1["rules"] = [
      {
        ruleId: "ambiguous-a",
        priority: 500,
        match: { kind: "predicate", iri: "urn:test:ambiguous", entailment: "exact" },
        project: { operator: "direct-edge" },
        templateRef: standardRdfRdfsCatalog.defaults!.edgeTemplateRef,
      },
      {
        ruleId: "ambiguous-b",
        priority: 500,
        match: { kind: "predicate", iri: "urn:test:ambiguous", entailment: "exact" },
        project: { operator: "direct-edge" },
        templateRef: standardRdfRdfsCatalog.defaults!.edgeTemplateRef,
      },
    ];
    const source = "<urn:test:a> <urn:test:ambiguous> <urn:test:b> .";
    const catalogA = catalogWithRules(conflictingRules);
    const catalogB = catalogWithRules([...conflictingRules].reverse());

    const diagnosticsA = projectSemanticView(documentFor(source), catalogA).diagnostics;
    const diagnosticsB = projectSemanticView(documentFor(source), catalogB).diagnostics;
    expect(diagnosticsA).toEqual(diagnosticsB);
    expect(diagnosticsA).toContainEqual(expect.objectContaining({
      severity: "error",
      code: "ambiguous-projection-rule",
    }));
  });
});

function documentFor(source: string): IriographDocumentV1 {
  return {
    schemaVersion: "1",
    kind: "iriograph.document",
    documentId: "projection-test",
    semantic: {
      format: "text/turtle",
      baseIri: "urn:test:",
      authoringProfileRef: "urn:test:authoring-profile:1",
      source,
    },
    imports: [{ catalogRef: "urn:iriograph:catalog:rdf-rdfs@1" }],
    views: [{
      viewId: "main",
      kind: "node-link",
      profileRef: standardRdfRdfsCatalog.profileRef,
      layoutRef: standardRdfRdfsCatalog.defaults!.layoutRef,
      locale: "ja-JP",
      overlay: {},
    }],
  };
}

function catalogWithRules(rules: ProjectionCatalogV1["rules"]): ProjectionCatalogV1 {
  return {
    ...standardRdfRdfsCatalog,
    rules: [...standardRdfRdfsCatalog.rules, ...rules],
  };
}
