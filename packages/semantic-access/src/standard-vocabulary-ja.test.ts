import { describe, expect, it } from "vitest";

import {
  standardPredicateTermsJa,
  standardPredicateVocabularyJa,
} from "./standard-vocabulary-ja";

describe("standardPredicateVocabularyJa", () => {
  it("IRI identityと日本語picker metadataを分離して提供する", () => {
    const requires = standardPredicateVocabularyJa.find((term) => term.label === "必要とする");
    expect(requires).toMatchObject({
      iri: "http://purl.org/dc/terms/requires",
      kind: "property",
      category: "依存",
      objectKinds: ["iri"],
    });
    expect(requires?.description).not.toContain(requires!.iri);
    expect(requires?.examples?.[0]).toContain("承認処理");
  });

  it("profileが公開するcategoryだけを複製して選べる", () => {
    const terms = standardPredicateTermsJa(["依存"]);
    expect(terms.length).toBeGreaterThan(1);
    expect(terms.every((term) => term.category === "依存")).toBe(true);
    expect(terms).not.toBe(standardPredicateVocabularyJa);
  });

  it("標準IRIを重複なく提供し、専用structure command対象だけをstructuralにする", () => {
    const iris = standardPredicateVocabularyJa.map((term) => term.iri);
    expect(new Set(iris).size).toBe(iris.length);
    expect(iris.every((iri) => /^https?:\/\//u.test(iri))).toBe(true);
    expect(standardPredicateVocabularyJa.filter((term) => term.structural).map((term) => term.iri))
      .toEqual(["http://www.w3.org/2000/01/rdf-schema#member"]);
    expect(standardPredicateVocabularyJa.every((term) => (
      Boolean(term.label?.trim())
      && Boolean(term.description?.trim())
      && Boolean(term.category?.trim())
      && term.examples?.every((example) => Boolean(example.trim()))
    ))).toBe(true);
    expect(standardPredicateVocabularyJa.find((term) => term.iri.endsWith("#wasAssociatedWith")))
      .toMatchObject({ label: "担当者・組織" });
    expect(standardPredicateVocabularyJa.find((term) => term.iri.endsWith("#actedOnBehalfOf")))
      .toMatchObject({ label: "代理元" });
  });
});
