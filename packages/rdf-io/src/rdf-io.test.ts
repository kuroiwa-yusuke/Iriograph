import { DataFactory } from "n3";
import { describe, expect, it } from "vitest";

import {
  applySemanticPatch,
  createExplicitRebase,
  createRdfDataset,
  exportRdfDataset,
  importRdfDataset,
} from "./index.js";

const { blankNode, defaultGraph, literal, namedNode, quad } = DataFactory;
const XSD_INTEGER = "http://www.w3.org/2001/XMLSchema#integer";

describe("RDF dataset import", () => {
  it("expands Turtle IRIs and preserves blank nodes and literal metadata without locale completion", async () => {
    const candidate = await importRdfDataset({
      format: "text/turtle",
      baseIri: "urn:example:local:",
      source: `
        @prefix ex: <urn:example:external:> .
        @prefix p: <urn:example:predicate:> .
        <relative> p:label "名前"@ja ;
          p:count "7"^^<${XSD_INTEGER}> ;
          p:detail [ p:label "untagged" ] .
        <relative> p:label "名前"@ja .
      `,
      target: { kind: "new-document" },
    });

    expect(candidate.valid).toBe(true);
    expect(candidate.semanticDiff.duplicateStatements).toBe(1);
    expect(candidate.statistics).toMatchObject({
      statementCount: 4,
      blankNodeCount: 1,
      literalCount: 3,
      languageLiteralCount: 1,
      datatypeLiteralCount: 2,
    });
    const objects = candidate.sourceDataset!.quads.map(({ object }) => object);
    expect(objects.some((term) => term.termType === "Literal" && term.value === "名前" && term.language === "ja")).toBe(true);
    expect(objects.some((term) => term.termType === "Literal" && term.value === "7" && term.datatype.value === XSD_INTEGER)).toBe(true);
    expect(objects.some((term) => term.termType === "Literal" && term.value === "untagged" && term.language === "")).toBe(true);
    expect(candidate.sourceDataset!.quads.some(({ subject }) => (
      subject.termType === "NamedNode" && subject.value === "urn:example:local:relative"
    ))).toBe(true);
    expect(candidate.lossReport.semanticLossless).toBe(true);
  });

  it("imports JSON-LD as an RDF dataset and refuses implicit remote context loading", async () => {
    const candidate = await importRdfDataset({
      format: "application/ld+json",
      source: {
        "@context": {
          label: "urn:example:predicate:label",
          count: { "@id": "urn:example:predicate:count", "@type": XSD_INTEGER },
        },
        "@id": "urn:example:external:item",
        label: { "@value": "Item", "@language": "en" },
        count: 3,
      },
      target: { kind: "new-document" },
    });

    expect(candidate.valid).toBe(true);
    expect(candidate.statistics).toMatchObject({ statementCount: 2, languageLiteralCount: 1 });
    expect(candidate.sourceDataset!.quads.some(({ object }) => (
      object.termType === "Literal" && object.value === "Item" && object.language === "en"
    ))).toBe(true);

    const remote = await importRdfDataset({
      format: "application/ld+json",
      source: { "@context": "https://example.invalid/context", "@id": "urn:example:item" },
      target: { kind: "new-document" },
    });
    expect(remote.valid).toBe(false);
    expect(remote.diagnostics.map(({ code }) => code)).toContain("rdf-jsonld-parse-failed");
  });

  it("rejects invalid bases before parsing", async () => {
    const candidate = await importRdfDataset({
      format: "text/turtle",
      baseIri: "relative/base",
      source: "<item> <urn:example:p> <other> .",
      target: { kind: "new-document" },
    });
    expect(candidate.valid).toBe(false);
    expect(candidate.diagnostics.map(({ code }) => code)).toContain("rdf-base-iri-invalid");
  });

  it("rejects JSON-LD terms that safe expansion would discard", async () => {
    const candidate = await importRdfDataset({
      format: "application/ld+json",
      source: {
        "@id": "relative-id",
        "urn:predicate:name": "unsafe",
      },
      target: { kind: "new-document" },
    });
    expect(candidate.valid).toBe(false);
    expect(candidate.diagnostics.map(({ code }) => code)).toContain("rdf-jsonld-parse-failed");
  });
});

describe("merge candidate and atomic patch", () => {
  const existing = createRdfDataset([
    quad(namedNode("urn:local:item"), namedNode("urn:predicate:name"), literal("Current", "en")),
    quad(blankNode("b0"), namedNode("urn:predicate:name"), literal("Existing blank")),
  ]);

  it("keeps external expanded IRIs unchanged and blocks local collisions by default", async () => {
    const candidate = await importRdfDataset({
      format: "text/turtle",
      source: `
        <urn:external:item> <urn:predicate:links> <urn:local:item> .
        <urn:local:item> <urn:predicate:name> "Imported"@en .
      `,
      target: {
        kind: "merge",
        existing,
        localIriNamespace: "urn:local:",
      },
    });

    expect(candidate.valid).toBe(false);
    expect(candidate.localIriCollisions).toEqual(["urn:local:item"]);
    expect(candidate.sourceDataset!.quads.some(({ subject }) => (
      subject.termType === "NamedNode" && subject.value === "urn:external:item"
    ))).toBe(true);
    expect(candidate.sourceDataset!.quads.some(({ subject }) => (
      subject.termType === "NamedNode" && subject.value === "urn:local:external:item"
    ))).toBe(false);
    expect(candidate.patch).toBeUndefined();
  });

  it("requires explicit identity joining and scopes imported blank nodes", async () => {
    const candidate = await importRdfDataset({
      format: "text/turtle",
      source: `
        <urn:local:item> <urn:predicate:name> "Current"@en .
        _:b0 <urn:predicate:name> "Imported blank" .
      `,
      target: {
        kind: "merge",
        existing,
        localIriNamespace: "urn:local:",
        localIriCollisionPolicy: "merge",
      },
    });

    expect(candidate.valid).toBe(true);
    expect(candidate.semanticDiff.unchanged).toHaveLength(2);
    expect(candidate.semanticDiff.additions).toHaveLength(1);
    expect(candidate.semanticDiff.duplicateStatements).toBe(1);
    const blankIds = candidate.candidateDataset!.quads
      .flatMap(({ subject, object }) => [subject, object])
      .filter((term) => term.termType === "BlankNode")
      .map((term) => term.value);
    expect(new Set(blankIds).size).toBe(2);

    const result = applySemanticPatch(existing, candidate.patch!);
    expect(result.accepted).toBe(true);
    expect(result.dataset.fingerprint).toBe(candidate.candidateDataset!.fingerprint);

    const stale = applySemanticPatch(createRdfDataset([]), candidate.patch!);
    expect(stale.accepted).toBe(false);
    expect(stale.dataset.quads).toHaveLength(0);

    const tampered = applySemanticPatch(existing, {
      ...candidate.patch!,
      additions: [],
    });
    expect(tampered.accepted).toBe(false);
    expect(tampered.dataset.fingerprint).toBe(existing.fingerprint);
  });
});

describe("explicit rebase", () => {
  it("rewrites only the selected namespace and applies as one semantic patch", () => {
    const current = createRdfDataset([
      quad(
        namedNode("urn:old:item"),
        namedNode("urn:old:predicate"),
        namedNode("https://external.example/resource"),
      ),
      quad(
        namedNode("urn:old:item"),
        namedNode("urn:predicate:value"),
        literal("value", namedNode("urn:old:datatype")),
      ),
    ]);
    const candidate = createExplicitRebase({
      dataset: current,
      fromNamespace: "urn:old:",
      toNamespace: "urn:new:",
    });

    expect(candidate.valid).toBe(true);
    expect(candidate.changes.map(({ from }) => from)).toEqual([
      "urn:old:datatype",
      "urn:old:item",
      "urn:old:predicate",
    ]);
    expect(candidate.candidateDataset!.quads.some(({ object }) => (
      object.termType === "NamedNode" && object.value === "https://external.example/resource"
    ))).toBe(true);
    const applied = applySemanticPatch(current, candidate.patch!);
    expect(applied.accepted).toBe(true);
    expect(applied.dataset.fingerprint).toBe(candidate.candidateDataset!.fingerprint);
  });

  it("rejects target IRI collisions instead of conflating resources", () => {
    const current = createRdfDataset([
      quad(namedNode("urn:old:item"), namedNode("urn:p"), literal("old")),
      quad(namedNode("urn:new:item"), namedNode("urn:p"), literal("new")),
    ]);
    const candidate = createExplicitRebase({
      dataset: current,
      fromNamespace: "urn:old:",
      toNamespace: "urn:new:",
    });
    expect(candidate.valid).toBe(false);
    expect(candidate.diagnostics.map(({ code }) => code)).toContain("rdf-rebase-target-collision");
    expect(candidate.patch).toBeUndefined();
  });
});

describe("semantic-only export", () => {
  it("round-trips Turtle literal language/datatype and blank nodes", async () => {
    const dataset = createRdfDataset([
      quad(namedNode("urn:item"), namedNode("urn:label"), literal("名前", "ja")),
      quad(namedNode("urn:item"), namedNode("urn:count"), literal("4", namedNode(XSD_INTEGER))),
      quad(namedNode("urn:item"), namedNode("urn:detail"), blankNode("detail")),
    ]);
    const exported = await exportRdfDataset({ dataset, format: "text/turtle" });
    expect(exported.accepted).toBe(true);
    if (!exported.accepted) return;
    const imported = await importRdfDataset({
      source: exported.source,
      format: "text/turtle",
      target: { kind: "new-document" },
    });
    expect(imported.valid).toBe(true);
    expect(imported.statistics).toMatchObject({
      statementCount: 3,
      blankNodeCount: 1,
      languageLiteralCount: 1,
      datatypeLiteralCount: 1,
    });
  });

  it("round-trips named graphs through JSON-LD and rejects lossy Turtle export", async () => {
    const dataset = createRdfDataset([
      quad(
        namedNode("urn:item"),
        namedNode("urn:label"),
        literal("Name", "en"),
        namedNode("urn:graph"),
      ),
    ]);
    const turtle = await exportRdfDataset({ dataset, format: "text/turtle" });
    expect(turtle.accepted).toBe(false);
    expect(turtle.lossReport.semanticLossless).toBe(false);

    const exported = await exportRdfDataset({ dataset, format: "application/ld+json" });
    expect(exported.accepted).toBe(true);
    if (!exported.accepted) return;
    const imported = await importRdfDataset({
      source: exported.source,
      format: "application/ld+json",
      target: { kind: "new-document" },
    });
    expect(imported.valid).toBe(true);
    expect(imported.statistics).toMatchObject({ namedGraphCount: 1, languageLiteralCount: 1 });
  });
});
