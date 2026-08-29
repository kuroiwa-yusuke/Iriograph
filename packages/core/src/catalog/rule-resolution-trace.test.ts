import { describe, expect, it } from "vitest";

import { statementIdentity } from "../semantic/identity";
import type { IriographDocumentV1, ProjectionCatalogV1 } from "../document/model";
import { projectSemanticView } from "../projection/projection";
import { parseSemanticGraph } from "../semantic/rdf";
import { buildLimitedRdfsClosure } from "../semantic/rdfs-closure";
import { classifySemanticReconciliationScope } from "../projection/reconciliation";
import { resolveStatementRule } from "./rule-resolution";
import {
  rdfRdfsVocabulary,
  standardRdfRdfsCatalog,
} from "./standard-catalog";

const NS = "urn:test:resolution-trace:";
const RDFS_SEE_ALSO = "http://www.w3.org/2000/01/rdf-schema#seeAlso";

describe("projection rule resolution trace", () => {
  it("exact/subproperty/wildcard候補とrule/template/style/fallbackを決定的に説明する", () => {
    const document = documentFor(`
@prefix : <${NS}> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
:related rdfs:subPropertyOf rdfs:seeAlso .
:a :related :b .
:a :other :c .
`);
    const graph = parseSemanticGraph(document);
    const closure = buildLimitedRdfsClosure(graph, rdfRdfsVocabulary);
    const relatedRef = statementIdentity(`${NS}a`, `${NS}related`, `${NS}b`);
    const related = resolveStatementRule(
      standardRdfRdfsCatalog,
      `${NS}related`,
      closure,
      relatedRef,
    );
    expect(related.trace).toMatchObject({
      semanticRef: relatedRef,
      outcome: "resolved",
      selected: {
        ruleId: "rdfs-see-also",
        match: "explicit-subproperty",
        matchedIri: `${NS}related`,
        templateRef: "urn:iriograph:template:edge:reference:1",
        styleSource: "template",
      },
    });
    expect(related.trace.candidates.map((candidate) => candidate.match))
      .toEqual(["explicit-subproperty", "wildcard"]);

    const fallback = resolveStatementRule(
      standardRdfRdfsCatalog,
      `${NS}other`,
      closure,
      "urn:test:fallback",
    );
    expect(fallback.trace).toMatchObject({
      outcome: "fallback",
      selected: { ruleId: "iri-object-fallback", match: "wildcard" },
      fallback: {
        reason: "wildcard-rule",
        templateRef: "urn:iriograph:template:edge:generic:1",
        styleSource: "template",
      },
    });

    const scene = projectSemanticView(document, standardRdfRdfsCatalog);
    const edge = scene.edges.find((candidate) => candidate.semanticRef === relatedRef)!;
    expect(edge.provenance?.rule).toEqual({
      catalogRef: related.trace.selected!.catalogRef,
      ruleId: related.trace.selected!.ruleId,
    });
    expect(edge.provenance?.resolutionTrace).toEqual(related.trace);
    // Entailment chooses rendering behavior but never materializes an
    // unasserted `a rdfs:seeAlso b` edge.
    expect(scene.edges.some((candidate) => (
      candidate.semanticRef === statementIdentity(`${NS}a`, RDFS_SEE_ALSO, `${NS}b`)
    ))).toBe(false);
  });

  it("同順位conflictを全候補付きtraceにし配列順へ依存しない", () => {
    const duplicate = (ruleId: string): ProjectionCatalogV1["rules"][number] => ({
      ruleId,
      priority: 500,
      match: { kind: "predicate", iri: `${NS}ambiguous`, entailment: "exact" },
      project: { operator: "direct-edge" },
      templateRef: standardRdfRdfsCatalog.defaults!.edgeTemplateRef,
    });
    const catalog: ProjectionCatalogV1 = {
      ...structuredClone(standardRdfRdfsCatalog),
      rules: [duplicate("z-rule"), duplicate("a-rule")],
    };
    const graph = parseSemanticGraph(documentFor(`<${NS}a> <${NS}ambiguous> <${NS}b> .`));
    const result = resolveStatementRule(
      catalog,
      `${NS}ambiguous`,
      buildLimitedRdfsClosure(graph, rdfRdfsVocabulary),
      "urn:test:conflict",
    );
    expect(result.resolved).toBeUndefined();
    expect(result.trace.outcome).toBe("conflict");
    expect(result.trace.conflicts?.map((candidate) => candidate.ruleId)).toEqual([
      "a-rule",
      "z-rule",
    ]);
  });

  it("class/property hierarchy cycleを表示を止めずactionableに診断し推論edgeを生成しない", () => {
    const document = documentFor(`
@prefix : <${NS}> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
:p rdfs:subPropertyOf :q .
:q rdfs:subPropertyOf :p .
:A rdfs:subClassOf :B .
:B rdfs:subClassOf :A .
:a :p :b .
`);
    const scene = projectSemanticView(document, standardRdfRdfsCatalog);
    expect(scene.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        severity: "warning",
        code: "projection-subclass-entailment-cycle",
        suggestedActions: [expect.objectContaining({
          actionId: "break-subclass-entailment-cycle",
        })],
      }),
      expect.objectContaining({
        severity: "warning",
        code: "projection-subproperty-entailment-cycle",
        suggestedActions: [expect.objectContaining({
          actionId: "break-subproperty-entailment-cycle",
        })],
      }),
    ]));
    expect(scene.edges.some((edge) => (
      edge.semanticRef === statementIdentity(`${NS}a`, `${NS}p`, `${NS}b`)
    ))).toBe(true);
    expect(scene.edges.some((edge) => (
      edge.semanticRef === statementIdentity(`${NS}a`, `${NS}q`, `${NS}b`)
    ))).toBe(false);
  });
});

describe("semantic reconciliation scope", () => {
  it("subPropertyOf asserted deltaだけを専用scopeへ分類する", () => {
    const before = documentFor(`<${NS}a> <${NS}p> <${NS}b> .`);
    const hierarchy = documentFor(`
<${NS}a> <${NS}p> <${NS}b> .
<${NS}p> <http://www.w3.org/2000/01/rdf-schema#subPropertyOf> <${RDFS_SEE_ALSO}> .
`);
    const semantic = documentFor(`<${NS}a> <${NS}q> <${NS}b> .`);
    expect(classifySemanticReconciliationScope(before, before)).toBe("none");
    expect(classifySemanticReconciliationScope(before, hierarchy))
      .toBe("subproperty-hierarchy-only");
    expect(classifySemanticReconciliationScope(before, semantic)).toBe("semantic-or-structure");
  });
});

function documentFor(source: string): IriographDocumentV1 {
  return {
    schemaVersion: "1",
    kind: "iriograph.document",
    documentId: "resolution-trace-test",
    semantic: {
      format: "text/turtle",
      baseIri: NS,
      authoringProfileRef: "urn:test:authoring:trace",
      source,
    },
    views: [{
      viewId: "main",
      kind: "node-link",
      profileRef: standardRdfRdfsCatalog.profileRef,
      layoutRef: standardRdfRdfsCatalog.defaults!.layoutRef,
      overlay: {},
    }],
  };
}
