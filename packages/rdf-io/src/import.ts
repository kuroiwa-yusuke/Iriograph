import jsonld from "jsonld";
import { Parser, type Quad } from "n3";

import {
  asRdfDataset,
  createAtomicPatch,
  createRdfDataset,
  datasetStatistics,
  emptySemanticDiff,
  isAbsoluteIri,
  namedIris,
  quadKey,
  remapBlankNodesForMerge,
  semanticDiff,
  sortDiagnostics,
  validateDataset,
} from "./dataset.js";
import type {
  RdfDataset,
  RdfImportCandidate,
  RdfImportRequest,
  RdfIoDiagnostic,
  RdfLossEntry,
  RdfLossReport,
} from "./model.js";

const EMPTY_DATASET = createRdfDataset([]);

/**
 * Parses an external RDF source into a complete candidate. No current dataset
 * is mutated and no IRI is rebased. A merge patch can only be applied as one
 * fingerprint-bound operation with applySemanticPatch.
 */
export async function importRdfDataset(request: RdfImportRequest): Promise<RdfImportCandidate> {
  const diagnostics: RdfIoDiagnostic[] = [];
  const lossEntries: RdfLossEntry[] = [];
  if (request.baseIri !== undefined && !isAbsoluteIri(request.baseIri)) {
    diagnostics.push({
      severity: "error",
      code: "rdf-base-iri-invalid",
      message: "The import base IRI must be absolute.",
      iri: request.baseIri,
    });
  }
  if (
    request.target.kind === "merge"
    && !isAbsoluteIri(request.target.localIriNamespace)
  ) {
    diagnostics.push({
      severity: "error",
      code: "rdf-local-namespace-invalid",
      message: "The merge local IRI namespace must be absolute.",
      iri: request.target.localIriNamespace,
    });
  }
  if (diagnostics.some(({ severity }) => severity === "error")) {
    return invalidCandidate(diagnostics, lossEntries);
  }

  let rawQuads: Quad[];
  try {
    rawQuads = request.format === "text/turtle"
      ? parseTurtle(request.source, request.baseIri)
      : await parseJsonLd(request.source, request.baseIri);
  } catch (cause) {
    diagnostics.push({
      severity: "error",
      code: request.format === "text/turtle" ? "rdf-turtle-parse-failed" : "rdf-jsonld-parse-failed",
      message: errorMessage(cause),
    });
    return invalidCandidate(diagnostics, lossEntries);
  }

  const parsedDataset = createRdfDataset(rawQuads);
  const duplicateStatements = rawQuads.length - parsedDataset.quads.length;
  if (duplicateStatements > 0) {
    diagnostics.push({
      severity: "info",
      code: "rdf-duplicate-statements-elided",
      message: `${duplicateStatements} duplicate RDF statement(s) were represented once in the dataset.`,
    });
    lossEntries.push({
      code: "duplicate-statements-elided",
      message: "RDF datasets have set semantics; repeated source statements are represented once.",
      count: duplicateStatements,
      semantic: false,
    });
  }
  lossEntries.push({
    code: request.format === "text/turtle"
      ? "turtle-syntax-not-preserved"
      : "jsonld-shape-not-preserved",
    message: request.format === "text/turtle"
      ? "Comments, whitespace, prefix spelling, and statement order are not RDF dataset semantics."
      : "JSON object shape, context placement, aliases, and array order outside RDF lists are not RDF dataset semantics.",
    count: 1,
    semantic: false,
  });
  diagnostics.push(...validateDataset(parsedDataset));

  const existing = request.target.kind === "merge"
    ? asRdfDataset(request.target.existing)
    : EMPTY_DATASET;
  if (request.target.kind === "merge") diagnostics.push(...validateDataset(existing));
  const sourceDataset = request.target.kind === "merge"
    ? remapBlankNodesForMerge(parsedDataset, existing)
    : parsedDataset;
  const existingKeys = new Set(existing.quads.map(quadKey));
  const mergeDuplicates = sourceDataset.quads.filter((statement) => existingKeys.has(quadKey(statement))).length;
  if (mergeDuplicates > 0) {
    diagnostics.push({
      severity: "info",
      code: "rdf-duplicate-merge-statements-elided",
      message: `${mergeDuplicates} imported statement(s) already exist in the merge target.`,
    });
    lossEntries.push({
      code: "duplicate-merge-statements-elided",
      message: "Statements already present in the target remain represented once.",
      count: mergeDuplicates,
      semantic: false,
    });
  }
  const collisions = request.target.kind === "merge"
    ? localIriCollisions(existing, sourceDataset, request.target.localIriNamespace)
    : [];
  if (collisions.length > 0) {
    const rejected = request.target.kind === "merge"
      && (request.target.localIriCollisionPolicy ?? "reject") === "reject";
    diagnostics.push(...collisions.map((iri) => ({
      severity: rejected ? "error" as const : "warning" as const,
      code: rejected ? "rdf-local-iri-collision" : "rdf-local-iri-collision-merged",
      message: rejected
        ? "An imported local IRI already exists; explicit collision policy is required to join the identities."
        : "An imported local IRI was explicitly allowed to join an existing identity.",
      iri,
    })));
  }

  const merged = createRdfDataset([...existing.quads, ...sourceDataset.quads]);
  const diff = semanticDiff(existing, merged, duplicateStatements + mergeDuplicates);
  const valid = !diagnostics.some(({ severity }) => severity === "error");
  return {
    valid,
    sourceDataset,
    candidateDataset: valid ? merged : undefined,
    semanticDiff: diff,
    patch: valid ? createAtomicPatch(existing, merged, diff) : undefined,
    diagnostics: sortDiagnostics(diagnostics),
    lossReport: report(lossEntries),
    statistics: datasetStatistics(sourceDataset),
    localIriCollisions: collisions,
  };
}

function parseTurtle(source: unknown, baseIri: string | undefined): Quad[] {
  if (typeof source !== "string") throw new TypeError("Turtle source must be a string.");
  return new Parser({ baseIRI: baseIri, format: "text/turtle" }).parse(source);
}

async function parseJsonLd(source: unknown, baseIri: string | undefined): Promise<Quad[]> {
  const input = typeof source === "string" ? JSON.parse(source) as unknown : source;
  if (input === null || (typeof input !== "object" && !Array.isArray(input))) {
    throw new TypeError("JSON-LD source must be a JSON object or array.");
  }
  const options = {
    base: baseIri,
    format: "application/n-quads" as const,
    // JSON-LD safe mode rejects warnings which would otherwise discard RDF
    // data, including relative/invalid IRIs after context expansion.
    safe: true,
    documentLoader: async (url: string) => {
      throw new Error(`Remote JSON-LD loading is disabled: ${url}`);
    },
  };
  const nquads = await jsonld.toRDF(input as object, options);
  if (typeof nquads !== "string") throw new TypeError("JSON-LD processor did not return N-Quads.");
  return new Parser({ format: "application/n-quads" }).parse(nquads);
}

function localIriCollisions(
  existing: RdfDataset,
  imported: RdfDataset,
  namespace: string,
): string[] {
  const existingIris = namedIris(existing);
  return [...namedIris(imported)]
    .filter((iri) => iri.startsWith(namespace) && existingIris.has(iri))
    .sort();
}

function invalidCandidate(
  diagnostics: readonly RdfIoDiagnostic[],
  entries: readonly RdfLossEntry[],
): RdfImportCandidate {
  return {
    valid: false,
    semanticDiff: emptySemanticDiff(),
    diagnostics: sortDiagnostics(diagnostics),
    lossReport: report(entries),
    localIriCollisions: [],
  };
}

function report(entries: readonly RdfLossEntry[]): RdfLossReport {
  return {
    semanticLossless: !entries.some(({ semantic }) => semantic),
    entries,
  };
}

function errorMessage(cause: unknown): string {
  if (!(cause instanceof Error)) return "RDF source could not be parsed.";
  // Parser messages are useful but may contain unbounded source excerpts.
  return cause.message.slice(0, 500);
}
