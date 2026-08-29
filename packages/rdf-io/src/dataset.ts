import { DataFactory, type Quad, type Term } from "n3";

import type {
  AtomicSemanticPatch,
  RdfDataset,
  RdfDatasetStatistics,
  RdfIoDiagnostic,
  SemanticDiff,
} from "./model.js";

const { quad } = DataFactory;
const EMPTY_DIFF: SemanticDiff = {
  additions: [],
  removals: [],
  unchanged: [],
  duplicateStatements: 0,
};

export function createRdfDataset(input: readonly Quad[]): RdfDataset {
  const unique = new Map<string, Quad>();
  for (const statement of input) unique.set(quadKey(statement), statement);
  const quads = [...unique.entries()]
    .sort(([left], [right]) => compare(left, right))
    .map(([, statement]) => statement);
  return Object.freeze({
    quads: Object.freeze(quads),
    fingerprint: fingerprintKeys(quads.map(quadKey)),
  });
}

export function asRdfDataset(input: RdfDataset | readonly Quad[]): RdfDataset {
  return Array.isArray(input)
    ? createRdfDataset(input)
    : createRdfDataset((input as RdfDataset).quads);
}

export function datasetStatistics(dataset: RdfDataset): RdfDatasetStatistics {
  const namedNodes = new Set<string>();
  const blankNodes = new Set<string>();
  const namedGraphs = new Set<string>();
  let literalCount = 0;
  let languageLiteralCount = 0;
  let datatypeLiteralCount = 0;
  for (const statement of dataset.quads) {
    for (const term of [statement.subject, statement.predicate, statement.object, statement.graph]) {
      if (term.termType === "NamedNode") namedNodes.add(term.value);
      if (term.termType === "BlankNode") blankNodes.add(term.value);
    }
    if (statement.graph.termType !== "DefaultGraph") {
      namedGraphs.add(`${statement.graph.termType}:${statement.graph.value}`);
    }
    if (statement.object.termType === "Literal") {
      literalCount += 1;
      if (statement.object.language) languageLiteralCount += 1;
      else datatypeLiteralCount += 1;
    }
  }
  return {
    statementCount: dataset.quads.length,
    namedNodeCount: namedNodes.size,
    blankNodeCount: blankNodes.size,
    literalCount,
    languageLiteralCount,
    datatypeLiteralCount,
    namedGraphCount: namedGraphs.size,
  };
}

export function validateDataset(dataset: RdfDataset): RdfIoDiagnostic[] {
  const diagnostics: RdfIoDiagnostic[] = [];
  for (const statement of dataset.quads) {
    const identity = canonicalStatement(statement);
    validateResourceTerm(statement.subject, "subject", identity, diagnostics);
    if (statement.predicate.termType !== "NamedNode") {
      diagnostics.push(error("rdf-predicate-invalid", "RDF predicates must be expanded named IRIs.", identity));
    } else {
      validateExpandedIri(statement.predicate.value, "predicate", identity, diagnostics);
    }
    if (
      statement.object.termType !== "NamedNode"
      && statement.object.termType !== "BlankNode"
      && statement.object.termType !== "Literal"
    ) {
      diagnostics.push(error("rdf-object-invalid", "RDF objects must be named IRIs, blank nodes, or literals.", identity));
    } else if (statement.object.termType === "Literal") {
      validateLiteral(statement.object, identity, diagnostics);
    } else {
      validateResourceTerm(statement.object, "object", identity, diagnostics);
    }
    if (
      statement.graph.termType !== "DefaultGraph"
      && statement.graph.termType !== "NamedNode"
      && statement.graph.termType !== "BlankNode"
    ) {
      diagnostics.push(error("rdf-graph-name-invalid", "RDF graph names must be named IRIs or blank nodes.", identity));
    } else if (statement.graph.termType !== "DefaultGraph") {
      validateResourceTerm(statement.graph, "graph", identity, diagnostics);
    }
  }
  return sortDiagnostics(diagnostics);
}

export function semanticDiff(
  current: RdfDataset,
  candidate: RdfDataset,
  duplicateStatements = 0,
): SemanticDiff {
  const currentByKey = new Map(current.quads.map((statement) => [quadKey(statement), statement]));
  const candidateByKey = new Map(candidate.quads.map((statement) => [quadKey(statement), statement]));
  return {
    additions: candidate.quads.filter((statement) => !currentByKey.has(quadKey(statement))),
    removals: current.quads.filter((statement) => !candidateByKey.has(quadKey(statement))),
    unchanged: candidate.quads.filter((statement) => currentByKey.has(quadKey(statement))),
    duplicateStatements,
  };
}

export function createAtomicPatch(
  current: RdfDataset,
  candidate: RdfDataset,
  diff = semanticDiff(current, candidate),
): AtomicSemanticPatch {
  const body = patchBody(current.fingerprint, candidate.fingerprint, diff.additions, diff.removals);
  return Object.freeze({
    kind: "iriograph.semantic-patch.v1" as const,
    baseFingerprint: current.fingerprint,
    candidateFingerprint: candidate.fingerprint,
    additions: Object.freeze([...diff.additions]),
    removals: Object.freeze([...diff.removals]),
    integrity: fingerprintText(body),
  });
}

export function emptySemanticDiff(): SemanticDiff {
  return EMPTY_DIFF;
}

export function patchBody(
  baseFingerprint: string,
  candidateFingerprint: string,
  additions: readonly Quad[],
  removals: readonly Quad[],
): string {
  return JSON.stringify({
    baseFingerprint,
    candidateFingerprint,
    additions: additions.map(quadKey).sort(compare),
    removals: removals.map(quadKey).sort(compare),
  });
}

export function quadKey(statement: Quad): string {
  return JSON.stringify([
    termKey(statement.subject),
    termKey(statement.predicate),
    termKey(statement.object),
    termKey(statement.graph),
  ]);
}

export function canonicalStatement(statement: Quad): string {
  return [statement.subject, statement.predicate, statement.object, statement.graph]
    .map(canonicalTerm)
    .filter((value, index) => index < 3 || value !== "")
    .join(" ");
}

export function canonicalTerm(term: Term): string {
  switch (term.termType) {
    case "NamedNode": return `<${term.value}>`;
    case "BlankNode": return `_:${term.value}`;
    case "Literal": {
      const lexical = JSON.stringify(term.value);
      return term.language
        ? `${lexical}@${term.language.toLowerCase()}`
        : `${lexical}^^<${term.datatype.value}>`;
    }
    case "DefaultGraph": return "";
    case "Variable": return `?${term.value}`;
  }
}

export function namedIris(dataset: RdfDataset): Set<string> {
  const result = new Set<string>();
  for (const statement of dataset.quads) {
    for (const term of [statement.subject, statement.predicate, statement.object, statement.graph]) {
      if (term.termType === "NamedNode") result.add(term.value);
      if (term.termType === "Literal") result.add(term.datatype.value);
    }
  }
  return result;
}

export function remapBlankNodesForMerge(imported: RdfDataset, existing: RdfDataset): RdfDataset {
  const used = new Set<string>();
  for (const statement of existing.quads) {
    if (statement.subject.termType === "BlankNode") used.add(statement.subject.value);
    if (statement.object.termType === "BlankNode") used.add(statement.object.value);
    if (statement.graph.termType === "BlankNode") used.add(statement.graph.value);
  }
  const importedIds = new Set<string>();
  for (const statement of imported.quads) {
    if (statement.subject.termType === "BlankNode") importedIds.add(statement.subject.value);
    if (statement.object.termType === "BlankNode") importedIds.add(statement.object.value);
    if (statement.graph.termType === "BlankNode") importedIds.add(statement.graph.value);
  }
  const mapping = new Map<string, ReturnType<typeof DataFactory.blankNode>>();
  let sequence = 0;
  for (const id of [...importedIds].sort(compare)) {
    let candidate: string;
    do {
      candidate = `import_${imported.fingerprint.slice(4, 12)}_${sequence}`;
      sequence += 1;
    } while (used.has(candidate));
    used.add(candidate);
    mapping.set(id, DataFactory.blankNode(candidate));
  }
  if (mapping.size === 0) return imported;
  return createRdfDataset(imported.quads.map((statement) => quad(
    statement.subject.termType === "BlankNode" ? mapping.get(statement.subject.value)! : statement.subject,
    statement.predicate,
    statement.object.termType === "BlankNode" ? mapping.get(statement.object.value)! : statement.object,
    statement.graph.termType === "BlankNode" ? mapping.get(statement.graph.value)! : statement.graph,
  )));
}

export function isAbsoluteIri(value: string): boolean {
  return /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)
    && !/[\u0000-\u0020<>\\{}|"^`]/u.test(value);
}

export function sortDiagnostics(diagnostics: readonly RdfIoDiagnostic[]): RdfIoDiagnostic[] {
  const rank = { error: 0, warning: 1, info: 2 } as const;
  return [...diagnostics].sort((left, right) => (
    rank[left.severity] - rank[right.severity]
    || compare(left.code, right.code)
    || compare(left.iri ?? "", right.iri ?? "")
    || compare(left.statement ?? "", right.statement ?? "")
    || compare(left.message, right.message)
  ));
}

export function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function fingerprintText(value: string): string {
  // FNV-1a 64 is deterministic across browser and Node runtimes. It is a stale
  // binding, not a cryptographic signature or trust boundary.
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(value)) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return `fnv1a64:${hash.toString(16).padStart(16, "0")}`;
}

function fingerprintKeys(keys: readonly string[]): string {
  return fingerprintText(keys.join("\n"));
}

function termKey(term: Term): unknown {
  switch (term.termType) {
    case "NamedNode": return ["NamedNode", term.value];
    case "BlankNode": return ["BlankNode", term.value];
    case "Literal": return ["Literal", term.value, term.language.toLowerCase(), term.datatype.value];
    case "DefaultGraph": return ["DefaultGraph"];
    case "Variable": return ["Variable", term.value];
  }
}

function validateResourceTerm(
  term: Term,
  position: string,
  statement: string,
  diagnostics: RdfIoDiagnostic[],
): void {
  if (term.termType === "NamedNode") {
    validateExpandedIri(term.value, position, statement, diagnostics);
    return;
  }
  if (term.termType === "BlankNode") {
    if (!term.value || /\s/u.test(term.value)) {
      diagnostics.push(error("rdf-blank-node-invalid", `The ${position} blank node identifier is invalid.`, statement));
    }
    return;
  }
  diagnostics.push(error("rdf-resource-term-invalid", `The RDF ${position} must be an expanded IRI or blank node.`, statement));
}

function validateExpandedIri(
  iri: string,
  position: string,
  statement: string,
  diagnostics: RdfIoDiagnostic[],
): void {
  if (!isAbsoluteIri(iri)) {
    diagnostics.push({
      ...error("rdf-iri-not-expanded", `The ${position} IRI is not absolute and expanded.`, statement),
      iri,
    });
  }
}

function validateLiteral(
  literal: Extract<Term, { termType: "Literal" }>,
  statement: string,
  diagnostics: RdfIoDiagnostic[],
): void {
  validateExpandedIri(literal.datatype.value, "literal datatype", statement, diagnostics);
  if (literal.language && !validLanguageTag(literal.language)) {
    diagnostics.push({
      ...error("rdf-literal-language-invalid", "The literal language tag is not a valid BCP 47 form.", statement),
      iri: literal.language,
    });
  }
}

function validLanguageTag(value: string): boolean {
  return /^(?:[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*|x(?:-[A-Za-z0-9]{1,8})+)$/u.test(value);
}

function error(code: string, message: string, statement: string): RdfIoDiagnostic {
  return { severity: "error", code, message, statement };
}
