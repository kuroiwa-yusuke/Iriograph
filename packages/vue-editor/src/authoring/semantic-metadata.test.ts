import { describe, expect, it } from "vitest";
import type { IriographDocumentV1 } from "@iriograph/core";

import { semanticDisplayMetadata } from "./semantic-metadata";

describe("semantic display metadata", () => {
  it("複数labelと改行commentをlossなく返す", () => {
    const document: IriographDocumentV1 = {
      schemaVersion: "1",
      kind: "iriograph.document",
      documentId: "metadata",
      semantic: {
        format: "text/turtle",
        baseIri: "urn:test:",
        authoringProfileRef: "urn:profile",
        source: '@prefix : <urn:test:> .\n@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .\n:item rdfs:label "項目"@ja, "Item"@en ; rdfs:comment "一行目\\n二行目"@ja, "Details"@en .',
      },
      views: [{ viewId: "main", kind: "node-link", profileRef: "urn:profile", layoutRef: "urn:layout", overlay: {} }],
    };
    expect(semanticDisplayMetadata(document)["urn:test:item"]).toEqual({
      labels: [{ value: "Item", language: "en" }, { value: "項目", language: "ja" }],
      comments: [
        { value: "Details", language: "en" },
        { value: "一行目\n二行目", language: "ja" },
      ],
    });
    expect(semanticDisplayMetadata(document, ["ja", "en"])["urn:test:item"]).toEqual({
      labels: [{ value: "項目", language: "ja" }, { value: "Item", language: "en" }],
      comments: [
        { value: "一行目\n二行目", language: "ja" },
        { value: "Details", language: "en" },
      ],
    });
  });
});
