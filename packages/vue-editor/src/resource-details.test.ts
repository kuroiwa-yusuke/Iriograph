import { describe, expect, it } from "vitest";

import type { IriographDocumentV1 } from "@iriograph/core";

import {
  resourcePropertyCommands,
  resourcePropertyEditorRows,
} from "./resource-details";

describe("resource details", () => {
  const document = {
    schemaVersion: "1",
    kind: "iriograph.document",
    documentId: "details",
    semantic: {
      format: "text/turtle",
      baseIri: "urn:test:",
      authoringProfileRef: "urn:profile",
      source: `@prefix : <urn:test:> .\n@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .\n:item rdfs:label "Item" ; rdfs:seeAlso :other .`,
    },
    views: [{ viewId: "main", kind: "node-link", profileRef: "urn:profile", layoutRef: "urn:layout", overlay: {} }],
  } satisfies IriographDocumentV1;

  it("profile labelとRDF値をIRI identityのままeditor rowへする", () => {
    const rows = resourcePropertyEditorRows(document, "urn:test:item", [
      { iri: "http://www.w3.org/2000/01/rdf-schema#label", kind: "property", label: "名前", objectKinds: ["literal"] },
      { iri: "http://www.w3.org/2000/01/rdf-schema#seeAlso", kind: "property", label: "関連資料", objectKinds: ["iri"] },
    ]);
    expect(rows).toEqual([
      expect.objectContaining({ label: "名前", values: [expect.objectContaining({ value: "Item" })] }),
      expect.objectContaining({ label: "関連資料", values: [expect.objectContaining({ value: "urn:test:other" })] }),
    ]);
  });

  it("変更predicateだけを一batch用set-property commandへする", () => {
    const original = resourcePropertyEditorRows(document, "urn:test:item", []);
    const current = structuredClone(original);
    current[0]!.values[0]!.value = "Renamed";
    expect(resourcePropertyCommands("urn:test:item", original, current)).toEqual([
      expect.objectContaining({
        type: "set-property",
        subjectIri: "urn:test:item",
        values: [expect.objectContaining({ value: "Renamed" })],
      }),
    ]);
  });

  it("rdf:_nを詳細属性へ漏らさず、名前・分類・関連を区分する", () => {
    const sequenceDocument = structuredClone(document);
    sequenceDocument.semantic.source = `@prefix : <urn:test:> .\n@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .\n@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .\n:item a :Task ; rdfs:label "line 1\\nline 2" ; rdfs:seeAlso :other ; rdf:_1 :first .`;
    const rows = resourcePropertyEditorRows(sequenceDocument, "urn:test:item", []);
    expect(rows.some((row) => row.predicateIri.endsWith("#_1"))).toBe(false);
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ predicateIri: expect.stringMatching(/#label$/u), category: "name-description", multiline: true }),
      expect.objectContaining({ predicateIri: expect.stringMatching(/#type$/u), category: "classification" }),
      expect.objectContaining({ predicateIri: expect.stringMatching(/#seeAlso$/u), category: "relationship" }),
    ]));
  });
});
