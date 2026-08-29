import jsonld from "jsonld";
import { Writer } from "n3";

import {
  asRdfDataset,
  canonicalStatement,
  isAbsoluteIri,
  sortDiagnostics,
  validateDataset,
} from "./dataset.js";
import type {
  RdfExportRequest,
  RdfExportResult,
  RdfIoDiagnostic,
  RdfLossEntry,
} from "./model.js";

/** Serializes only the supplied semantic RDF dataset; no document/view type is accepted. */
export async function exportRdfDataset(request: RdfExportRequest): Promise<RdfExportResult> {
  const dataset = asRdfDataset(request.dataset);
  const diagnostics = validateDataset(dataset);
  const losses: RdfLossEntry[] = [];
  if (request.baseIri !== undefined && !isAbsoluteIri(request.baseIri)) {
    diagnostics.push({
      severity: "error",
      code: "rdf-export-base-invalid",
      message: "The export base IRI must be absolute.",
      iri: request.baseIri,
    });
  }
  for (const [prefix, iri] of Object.entries(request.prefixes ?? {})) {
    if (!validPrefix(prefix) || !isAbsoluteIri(iri)) {
      diagnostics.push({
        severity: "error",
        code: "rdf-export-prefix-invalid",
        message: "Turtle prefixes must use valid aliases and absolute namespace IRIs.",
        iri,
      });
    }
  }
  if (request.format === "text/turtle") {
    const namedGraphCount = new Set(dataset.quads
      .filter(({ graph }) => graph.termType !== "DefaultGraph")
      .map(({ graph }) => `${graph.termType}:${graph.value}`)).size;
    if (namedGraphCount > 0) {
      diagnostics.push({
        severity: "error",
        code: "rdf-turtle-named-graph-unsupported",
        message: "Turtle cannot represent named graphs; use JSON-LD or select a graph explicitly.",
      });
      losses.push({
        code: "named-graphs-not-representable-in-turtle",
        message: "Export was rejected instead of silently dropping graph names.",
        count: namedGraphCount,
        semantic: true,
      });
    }
  }
  if (diagnostics.some(({ severity }) => severity === "error")) {
    return {
      accepted: false,
      format: request.format,
      diagnostics: sortDiagnostics(diagnostics),
      lossReport: {
        semanticLossless: !losses.some(({ semantic }) => semantic),
        entries: losses,
      },
    };
  }

  try {
    const source = request.format === "text/turtle"
      ? await writeTurtle(request)
      : await writeJsonLd(request);
    losses.push({
      code: request.format === "text/turtle"
        ? "dataset-syntax-generated"
        : "jsonld-shape-generated",
      message: request.format === "text/turtle"
        ? "Generated Turtle preserves RDF terms but not prior comments, aliases, whitespace, or ordering."
        : "Generated JSON-LD preserves the RDF dataset but does not reconstruct a prior context or JSON shape.",
      count: 1,
      semantic: false,
    });
    return {
      accepted: true,
      format: request.format,
      source,
      diagnostics: sortDiagnostics(diagnostics),
      lossReport: { semanticLossless: true, entries: losses },
    };
  } catch (cause) {
    return {
      accepted: false,
      format: request.format,
      diagnostics: [{
        severity: "error",
        code: "rdf-export-failed",
        message: cause instanceof Error ? cause.message.slice(0, 500) : "RDF dataset export failed.",
      }],
      lossReport: { semanticLossless: false, entries: losses },
    };
  }
}

async function writeTurtle(request: RdfExportRequest): Promise<string> {
  const dataset = asRdfDataset(request.dataset);
  const writer = new Writer({
    format: "text/turtle",
    baseIRI: request.baseIri,
    prefixes: request.prefixes,
  });
  writer.addQuads([...dataset.quads]);
  return new Promise((resolve, reject) => writer.end((error, result) => {
    if (error) reject(error);
    else resolve(result);
  }));
}

async function writeJsonLd(request: RdfExportRequest): Promise<string> {
  const dataset = asRdfDataset(request.dataset);
  const nquads = `${dataset.quads.map(canonicalStatement).join(" .\n")}${dataset.quads.length > 0 ? " .\n" : ""}`;
  const document = await jsonld.fromRDF(nquads, {
    format: "application/n-quads",
    useNativeTypes: false,
    useRdfType: true,
  });
  return `${JSON.stringify(sortJsonObjectKeys(document), null, 2)}\n`;
}

function sortJsonObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonObjectKeys);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => [key, sortJsonObjectKeys(child)]));
}

function validPrefix(value: string): boolean {
  return value === "" || /^[A-Za-z_][A-Za-z0-9._-]*$/u.test(value);
}
