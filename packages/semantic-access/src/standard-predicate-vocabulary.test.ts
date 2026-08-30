import { describe, expect, it } from "vitest";

import {
  normalizeStandardPredicateLocale,
  standardPredicateTerms,
  standardPredicateTermsEn,
  standardPredicateTermsJa,
  standardPredicateVocabulary,
  standardPredicateVocabularyEn,
  standardPredicateVocabularyForLocale,
  standardPredicateVocabularyJa,
} from "./standard-predicate-vocabulary";

const EXPECTED_IRIS = [
  "http://www.w3.org/2000/01/rdf-schema#seeAlso",
  "http://www.w3.org/2000/01/rdf-schema#isDefinedBy",
  "http://www.w3.org/2000/01/rdf-schema#subClassOf",
  "http://www.w3.org/2000/01/rdf-schema#subPropertyOf",
  "http://www.w3.org/2000/01/rdf-schema#domain",
  "http://www.w3.org/2000/01/rdf-schema#range",
  "http://www.w3.org/2000/01/rdf-schema#member",
  "http://purl.org/dc/terms/relation",
  "http://purl.org/dc/terms/references",
  "http://purl.org/dc/terms/isReferencedBy",
  "http://purl.org/dc/terms/requires",
  "http://purl.org/dc/terms/isRequiredBy",
  "http://purl.org/dc/terms/hasPart",
  "http://purl.org/dc/terms/isPartOf",
  "http://purl.org/dc/terms/source",
  "http://purl.org/dc/terms/replaces",
  "http://purl.org/dc/terms/isReplacedBy",
  "http://www.w3.org/ns/prov#wasDerivedFrom",
  "http://www.w3.org/ns/prov#wasGeneratedBy",
  "http://www.w3.org/ns/prov#used",
  "http://www.w3.org/ns/prov#wasAssociatedWith",
  "http://www.w3.org/ns/prov#wasAttributedTo",
  "http://www.w3.org/ns/prov#wasInformedBy",
  "http://www.w3.org/ns/prov#actedOnBehalfOf",
  "http://www.w3.org/2004/02/skos/core#broader",
  "http://www.w3.org/2004/02/skos/core#narrower",
  "http://www.w3.org/2004/02/skos/core#related",
  "http://www.w3.org/2004/02/skos/core#exactMatch",
  "http://www.w3.org/2004/02/skos/core#closeMatch",
  "http://www.w3.org/2002/07/owl#sameAs",
  "http://www.w3.org/2002/07/owl#differentFrom",
  "http://www.w3.org/2002/07/owl#equivalentClass",
  "http://www.w3.org/2002/07/owl#equivalentProperty",
  "http://www.w3.org/2002/07/owl#inverseOf",
  "http://www.w3.org/2002/07/owl#imports",
] as const;

const STRUCTURAL_IRIS = [
  "http://www.w3.org/2000/01/rdf-schema#domain",
  "http://www.w3.org/2000/01/rdf-schema#range",
  "http://www.w3.org/2000/01/rdf-schema#member",
];

describe("standard predicate presentation vocabulary", () => {
  it("keeps the complete standard IRI set and structural contract identical across locales", () => {
    expect(standardPredicateVocabularyEn.map((term) => term.iri)).toEqual(EXPECTED_IRIS);
    expect(standardPredicateVocabularyJa.map((term) => term.iri)).toEqual(EXPECTED_IRIS);
    expect(new Set(EXPECTED_IRIS).size).toBe(EXPECTED_IRIS.length);

    const identity = (term: (typeof standardPredicateVocabularyEn)[number]) => ({
      iri: term.iri,
      kind: term.kind,
      roles: term.roles,
      objectKinds: term.objectKinds,
      structural: term.structural ?? false,
    });
    expect(standardPredicateVocabularyJa.map(identity))
      .toEqual(standardPredicateVocabularyEn.map(identity));
    expect(standardPredicateVocabularyEn.filter((term) => term.structural).map((term) => term.iri))
      .toEqual(STRUCTURAL_IRIS);
  });

  it.each([
    ["English", standardPredicateVocabularyEn],
    ["Japanese", standardPredicateVocabularyJa],
  ])("provides complete %s presentation metadata for every standard term", (_name, vocabulary) => {
    expect(vocabulary).toHaveLength(EXPECTED_IRIS.length);
    expect(vocabulary.every((term) => (
      Boolean(term.label?.trim())
      && Boolean(term.description?.trim())
      && Boolean(term.category?.trim())
      && term.examples?.length === 1
      && term.examples.every((example) => Boolean(example.trim()))
      && term.sentencePattern?.includes("A")
      && term.sentencePattern.includes("B")
    ))).toBe(true);
  });

  it("uses English by default for the public vocabulary and copied term API", () => {
    expect(standardPredicateVocabulary).toBe(standardPredicateVocabularyEn);
    expect(standardPredicateVocabularyForLocale()).toBe(standardPredicateVocabularyEn);

    const requires = standardPredicateTerms().find((term) => term.iri.endsWith("/requires"));
    expect(requires).toMatchObject({
      label: "Requires",
      category: "Dependency",
      sentencePattern: "A requires B",
    });
    expect(requires?.description).not.toContain(requires!.iri);
    expect(requires?.examples?.[0]).toContain("approval process");
  });

  it("keeps Japanese selectable and preserves the Japanese compatibility exports", () => {
    expect(standardPredicateVocabularyForLocale("ja")).toBe(standardPredicateVocabularyJa);
    const compatible = standardPredicateTermsJa(["依存"]);
    expect(compatible).toEqual(standardPredicateTerms({ locale: "ja", categories: ["依存"] }));
    expect(compatible.every((term) => term.category === "依存")).toBe(true);
    expect(compatible.find((term) => term.iri.endsWith("/requires"))).toMatchObject({
      label: "必要とする",
      sentencePattern: "AはBを必要とする",
    });
    expect(standardPredicateVocabularyJa.find((term) => term.iri.endsWith("#wasAssociatedWith")))
      .toMatchObject({ label: "担当者・組織" });
    expect(standardPredicateVocabularyJa.find((term) => term.iri.endsWith("#actedOnBehalfOf")))
      .toMatchObject({ label: "代理元" });
  });

  it("normalizes English and Japanese regional locale tags", () => {
    for (const locale of ["en", "en-US", "EN-gb", "en_US"]) {
      expect(normalizeStandardPredicateLocale(locale)).toBe("en");
      expect(standardPredicateVocabularyForLocale(locale)).toBe(standardPredicateVocabularyEn);
    }
    for (const locale of ["ja", "ja-JP", "JA-jpan", "ja_JP"]) {
      expect(normalizeStandardPredicateLocale(locale)).toBe("ja");
      expect(standardPredicateVocabularyForLocale(locale)).toBe(standardPredicateVocabularyJa);
    }
  });

  it("falls back deterministically to English for absent, empty, and unsupported locales", () => {
    for (const locale of [undefined, "", "   ", "fr", "zh-Hant", "unknown"]) {
      expect(normalizeStandardPredicateLocale(locale)).toBe("en");
      expect(standardPredicateVocabularyForLocale(locale)).toBe(standardPredicateVocabularyEn);
      expect(standardPredicateTerms({ locale })[0]?.label).toBe(standardPredicateVocabularyEn[0]?.label);
    }
  });

  it("filters localized categories into independent term copies", () => {
    const english = standardPredicateTermsEn(["Dependency"]);
    expect(english.length).toBeGreaterThan(1);
    expect(english.every((term) => term.category === "Dependency")).toBe(true);
    expect(english).not.toBe(standardPredicateVocabularyEn);
    expect(english[0]).not.toBe(standardPredicateVocabularyEn.find((term) => term.iri === english[0]?.iri));
    expect(english[0]?.examples).not.toBe(
      standardPredicateVocabularyEn.find((term) => term.iri === english[0]?.iri)?.examples,
    );
  });

  it("includes only the existing non-restriction OWL relationship terms", () => {
    const owlIris = standardPredicateVocabularyEn
      .map((term) => term.iri)
      .filter((iri) => iri.startsWith("http://www.w3.org/2002/07/owl#"));
    expect(owlIris).toEqual([
      "http://www.w3.org/2002/07/owl#sameAs",
      "http://www.w3.org/2002/07/owl#differentFrom",
      "http://www.w3.org/2002/07/owl#equivalentClass",
      "http://www.w3.org/2002/07/owl#equivalentProperty",
      "http://www.w3.org/2002/07/owl#inverseOf",
      "http://www.w3.org/2002/07/owl#imports",
    ]);
    expect(owlIris.some((iri) => /(?:Restriction|onProperty|ValuesFrom|Cardinality|hasValue|hasSelf|onClass|onDataRange)$/u.test(iri)))
      .toBe(false);
  });
});
