import { DataFactory, Parser } from "n3";
import { describe, expect, it } from "vitest";

import {
  applyCanonicalSemanticDataset,
  applyCanonicalSemanticSource,
  applySemanticSource,
} from "./document";
import { createStandardLayoutRegistry } from "./layout";
import type { IriographDocumentV1 } from "./model";
import type { ProjectionRuntimeContext } from "./scene";
import {
  canonicalizeTurtleSourceV1,
  serializeCanonicalTurtleV1,
  TURTLE_SERIALIZER_VERSION_V1,
} from "./serializer";
import { standardRdfRdfsCatalog } from "./standard-catalog";

const { namedNode, quad } = DataFactory;
const BASE = "urn:test:serializer:";

describe("canonical Turtle serializer v1", () => {
  it("同じdatasetをquad入力順に依存せず同じTurtleへserializeする", () => {
    const quads = new Parser({ baseIRI: BASE }).parse(sourceA);
    const first = serializeCanonicalTurtleV1({
      serializerVersion: TURTLE_SERIALIZER_VERSION_V1,
      quads,
      baseIri: BASE,
      prefixes: { ex: BASE, xsd: "http://www.w3.org/2001/XMLSchema#" },
    });
    const second = serializeCanonicalTurtleV1({
      serializerVersion: TURTLE_SERIALIZER_VERSION_V1,
      quads: [...quads].reverse(),
      baseIri: BASE,
      prefixes: { xsd: "http://www.w3.org/2001/XMLSchema#", ex: BASE },
    });

    expect(first).toEqual(second);
    expect(first.accepted).toBe(true);
  });

  it("IRI、literal、datatype、language、blank nodeをround tripで欠落させない", () => {
    const canonical = canonicalizeTurtleSourceV1(sourceA, BASE);
    expect(canonical.accepted).toBe(true);
    if (!canonical.accepted) return;

    expect(canonical.source).toContain("_:b0");
    expect(canonical.source).toContain('"English"@en');
    expect(canonical.source).toContain('"42"^^<http://www.w3.org/2001/XMLSchema#integer>');
    expect(canonical.source).toContain('"line\\n\\\"quoted\\\""^^<http://www.w3.org/2001/XMLSchema#string>');
    const again = canonicalizeTurtleSourceV1(canonical.source, BASE);
    expect(again.accepted).toBe(true);
    if (again.accepted) expect(again.source).toBe(canonical.source);
  });

  it("comment、空白、property list、記述順をcanonical outputへ保持しない", () => {
    const first = canonicalizeTurtleSourceV1(sourceA, BASE);
    const second = canonicalizeTurtleSourceV1(sourceB, BASE);
    expect(first.accepted).toBe(true);
    expect(second.accepted).toBe(true);
    if (!first.accepted || !second.accepted) return;

    expect(first.source).toBe(second.source);
    expect(first.source).not.toContain("keep me");
    expect(first.source).not.toContain("[");
    expect(first.source).toMatch(/^@base /u);
  });

  it("direct source editは妥当な原文をbyte-for-byte保持し、canonical入口だけ再serializeする", async () => {
    const document = documentFor(minimalSource);
    const direct = `# human formatting\n${minimalSource}\n`;
    const directResult = await applySemanticSource(document, direct, runtimeContext());
    expect(directResult.accepted).toBe(true);
    expect(directResult.document.semantic.source).toBe(direct);

    const canonicalResult = await applyCanonicalSemanticSource(document, direct, runtimeContext(), {
      serializerVersion: TURTLE_SERIALIZER_VERSION_V1,
    });
    expect(canonicalResult.accepted).toBe(true);
    expect(canonicalResult.document.semantic.source).not.toBe(direct);
    expect(canonicalResult.document.semantic.source).not.toContain("human formatting");
  });

  it("parse/serialize failureをdeterministic diagnosticでatomic rollbackする", async () => {
    const document = documentFor(minimalSource);
    const unsupported = await applyCanonicalSemanticSource(document, minimalSource, runtimeContext(), {
      serializerVersion: "future-version" as typeof TURTLE_SERIALIZER_VERSION_V1,
    });
    expect(unsupported.accepted).toBe(false);
    expect(unsupported.document).toEqual(document);
    expect(unsupported.diagnostics).toContainEqual(expect.objectContaining({
      code: "serializer-version-unsupported",
    }));

    const invalidA = await applyCanonicalSemanticSource(document, "@prefix broken", runtimeContext(), {
      serializerVersion: TURTLE_SERIALIZER_VERSION_V1,
    });
    const invalidB = await applyCanonicalSemanticSource(document, "@prefix broken", runtimeContext(), {
      serializerVersion: TURTLE_SERIALIZER_VERSION_V1,
    });
    expect(invalidA).toEqual(invalidB);
    expect(invalidA.accepted).toBe(false);
    expect(invalidA.document).toEqual(document);
    expect(invalidA.diagnostics).toEqual([{
      severity: "error",
      code: "canonical-turtle-parse-failed",
      message: "Candidate Turtle could not be parsed.",
    }]);

    const namedGraph = [quad(
      namedNode(`${BASE}a`),
      namedNode(`${BASE}p`),
      namedNode(`${BASE}b`),
      namedNode(`${BASE}graph`),
    )];
    const serializeFailure = await applyCanonicalSemanticDataset(
      document,
      namedGraph,
      runtimeContext(),
      { serializerVersion: TURTLE_SERIALIZER_VERSION_V1 },
    );
    expect(serializeFailure.accepted).toBe(false);
    expect(serializeFailure.document).toEqual(document);
    expect(serializeFailure.diagnostics).toContainEqual(expect.objectContaining({
      code: "canonical-turtle-named-graph-unsupported",
    }));
  });
});

const sourceA = `
@prefix ex: <${BASE}> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
# keep me only until canonical serialization
ex:root ex:child [
  ex:language "English"@EN ;
  ex:number "42"^^xsd:integer ;
  ex:text "line\\n\\\"quoted\\\""
] ; ex:next ex:tail .
ex:tail ex:label "Tail" .
`;

const sourceB = `
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix ex: <${BASE}> .
ex:tail ex:label "Tail" .
ex:root ex:next ex:tail ;
  ex:child [
    ex:text "line\\n\\\"quoted\\\"" ;
    ex:number "42"^^xsd:integer ;
    ex:language "English"@en
  ] .
`;

const minimalSource = `
@prefix : <${BASE}> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
:a rdfs:label "A" ; :p :b .
:b rdfs:label "B" .`;

function documentFor(source: string): IriographDocumentV1 {
  return {
    schemaVersion: "1",
    kind: "iriograph.document",
    documentId: "serializer-test",
    semantic: {
      format: "text/turtle",
      baseIri: BASE,
      authoringProfileRef: "urn:test:authoring:1",
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

function runtimeContext(): ProjectionRuntimeContext {
  return {
    catalogsByProfile: new Map([[
      standardRdfRdfsCatalog.profileRef,
      { catalog: standardRdfRdfsCatalog },
    ]]),
    layouts: createStandardLayoutRegistry(),
  };
}
