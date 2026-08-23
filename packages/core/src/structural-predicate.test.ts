import { describe, expect, it } from "vitest";
import { Parser } from "n3";

import { buildLimitedRdfsClosure } from "./rdfs-closure";
import { semanticGraphFromQuads } from "./rdf";
import { rdfRdfsVocabulary, standardRdfRdfsCatalog } from "./standard-catalog";
import { classifyStructuralPredicate, isStructuralPredicate } from "./structural-predicate";

describe("structural predicate classification", () => {
  it("catalogとRDFS closureからmembershipとordinalを分類する", () => {
    const quads = new Parser({ baseIRI: "urn:test:", format: "text/turtle" }).parse(`
      @prefix : <urn:test:structural:> .
      @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
      :contains rdfs:subPropertyOf rdfs:member .
    `);
    const graph = semanticGraphFromQuads(quads);
    const closure = buildLimitedRdfsClosure(graph, rdfRdfsVocabulary);

    expect(classifyStructuralPredicate(
      "urn:test:structural:contains",
      standardRdfRdfsCatalog,
      closure,
    )).toContainEqual(expect.objectContaining({
      operator: "membership-container",
      kind: "membership",
    }));
    expect(classifyStructuralPredicate(
      "http://www.w3.org/1999/02/22-rdf-syntax-ns#type",
      standardRdfRdfsCatalog,
      closure,
    )).toContainEqual(expect.objectContaining({ operator: "membership-region" }));
    expect(classifyStructuralPredicate(
      "http://www.w3.org/1999/02/22-rdf-syntax-ns#_3",
      standardRdfRdfsCatalog,
      closure,
    )).toEqual(expect.arrayContaining([
      expect.objectContaining({ operator: "ordinal-sequence", ordinal: 3 }),
      expect.objectContaining({ operator: "alternative", ordinal: 3 }),
    ]));
    expect(isStructuralPredicate("urn:test:plain", standardRdfRdfsCatalog, closure)).toBe(false);
  });
});
