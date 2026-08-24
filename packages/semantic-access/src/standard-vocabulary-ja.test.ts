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
      .toEqual([
        "http://www.w3.org/2000/01/rdf-schema#domain",
        "http://www.w3.org/2000/01/rdf-schema#range",
        "http://www.w3.org/2000/01/rdf-schema#member",
      ]);
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

  it("通常の関係候補に使えるOWL関係を日本語metadata付きで提供しRestriction語彙は含めない", () => {
    const owl = standardPredicateVocabularyJa.filter((term) => term.iri.startsWith("http://www.w3.org/2002/07/owl#"));
    expect(owl.map((term) => term.iri)).toEqual(expect.arrayContaining([
      "http://www.w3.org/2002/07/owl#sameAs",
      "http://www.w3.org/2002/07/owl#differentFrom",
      "http://www.w3.org/2002/07/owl#equivalentClass",
      "http://www.w3.org/2002/07/owl#equivalentProperty",
      "http://www.w3.org/2002/07/owl#inverseOf",
    ]));
    expect(owl.every((term) => term.label && term.description && term.category)).toBe(true);
    expect(owl.some((term) => /Restriction|cardinality/u.test(term.iri))).toBe(false);
    expect(owl.map((term) => term.iri)).not.toEqual(expect.arrayContaining([
      "http://www.w3.org/2002/07/owl#complementOf",
      "http://www.w3.org/2002/07/owl#disjointWith",
      "http://www.w3.org/2002/07/owl#propertyDisjointWith",
    ]));
  });
});
