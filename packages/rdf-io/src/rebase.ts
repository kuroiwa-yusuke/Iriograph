import { DataFactory, type Quad, type Term } from "n3";

import {
  asRdfDataset,
  compare,
  createAtomicPatch,
  createRdfDataset,
  emptySemanticDiff,
  isAbsoluteIri,
  semanticDiff,
  sortDiagnostics,
  validateDataset,
} from "./dataset.js";
import type {
  ExplicitRebaseCandidate,
  ExplicitRebaseRequest,
  RdfIoDiagnostic,
  RebaseTermChange,
} from "./model.js";

const { namedNode, literal, quad } = DataFactory;

/**
 * The only public namespace rewrite. Import and merge never call this helper.
 * Every matching expanded IRI position, including non-language datatype and
 * graph name, is transformed into one previewed atomic patch.
 */
export function createExplicitRebase(
  request: ExplicitRebaseRequest,
): ExplicitRebaseCandidate {
  const current = asRdfDataset(request.dataset);
  const diagnostics: RdfIoDiagnostic[] = [];
  if (!isAbsoluteIri(request.fromNamespace)) {
    diagnostics.push(invalidNamespace("rdf-rebase-source-invalid", "The source rebase namespace must be absolute.", request.fromNamespace));
  }
  if (!isAbsoluteIri(request.toNamespace)) {
    diagnostics.push(invalidNamespace("rdf-rebase-target-invalid", "The target rebase namespace must be absolute.", request.toNamespace));
  }
  if (request.fromNamespace === request.toNamespace) {
    diagnostics.push({
      severity: "error",
      code: "rdf-rebase-namespaces-equal",
      message: "Source and target rebase namespaces must differ.",
      iri: request.fromNamespace,
    });
  }
  diagnostics.push(...validateDataset(current));
  if (diagnostics.some(({ severity }) => severity === "error")) {
    return invalid(diagnostics);
  }

  const occurrences = new Map<string, number>();
  const rewritten = current.quads.map((statement) => rewriteQuad(
    statement,
    request.fromNamespace,
    request.toNamespace,
    occurrences,
  ));
  const candidate = createRdfDataset(rewritten);
  diagnostics.push(...validateDataset(candidate));
  const collisions = rebaseCollisions(current.quads, request.fromNamespace, request.toNamespace);
  diagnostics.push(...collisions.map((iri) => ({
    severity: "error" as const,
    code: "rdf-rebase-target-collision",
    message: "A rewritten IRI would collide with an existing IRI outside the source namespace.",
    iri,
  })));
  const changes = [...occurrences.entries()]
    .map(([mapping, count]): RebaseTermChange => {
      const separator = mapping.indexOf("\u0000");
      return { from: mapping.slice(0, separator), to: mapping.slice(separator + 1), occurrences: count };
    })
    .sort((left, right) => compare(left.from, right.from) || compare(left.to, right.to));
  const valid = !diagnostics.some(({ severity }) => severity === "error");
  const diff = semanticDiff(current, candidate);
  return {
    valid,
    candidateDataset: valid ? candidate : undefined,
    semanticDiff: diff,
    patch: valid ? createAtomicPatch(current, candidate, diff) : undefined,
    changes,
    diagnostics: sortDiagnostics(diagnostics),
    lossReport: { semanticLossless: true, entries: [] },
  };
}

function rewriteQuad(
  statement: Quad,
  fromNamespace: string,
  toNamespace: string,
  occurrences: Map<string, number>,
): Quad {
  return quad(
    rewriteResource(statement.subject, fromNamespace, toNamespace, occurrences),
    statement.predicate.termType === "NamedNode"
      ? rewriteNamedNode(statement.predicate, fromNamespace, toNamespace, occurrences)
      : statement.predicate,
    statement.object.termType === "Literal"
      ? rewriteLiteral(statement.object, fromNamespace, toNamespace, occurrences)
      : rewriteResource(statement.object, fromNamespace, toNamespace, occurrences),
    statement.graph.termType === "DefaultGraph"
      ? statement.graph
      : rewriteResource(statement.graph, fromNamespace, toNamespace, occurrences),
  );
}

function rewriteResource<T extends Term>(
  term: T,
  fromNamespace: string,
  toNamespace: string,
  occurrences: Map<string, number>,
): T {
  if (term.termType !== "NamedNode") return term;
  return rewriteNamedNode(term, fromNamespace, toNamespace, occurrences) as T;
}

function rewriteNamedNode<T extends Extract<Term, { termType: "NamedNode" }>>(
  term: T,
  fromNamespace: string,
  toNamespace: string,
  occurrences: Map<string, number>,
): T {
  if (!term.value.startsWith(fromNamespace)) return term;
  const next = `${toNamespace}${term.value.slice(fromNamespace.length)}`;
  recordChange(term.value, next, occurrences);
  return namedNode(next) as T;
}

function rewriteLiteral(
  term: Extract<Term, { termType: "Literal" }>,
  fromNamespace: string,
  toNamespace: string,
  occurrences: Map<string, number>,
): ReturnType<typeof literal> {
  if (term.language) return literal(term.value, term.language);
  const datatype = rewriteNamedNode(term.datatype, fromNamespace, toNamespace, occurrences);
  return literal(term.value, datatype);
}

function recordChange(from: string, to: string, occurrences: Map<string, number>): void {
  const key = `${from}\u0000${to}`;
  occurrences.set(key, (occurrences.get(key) ?? 0) + 1);
}

function rebaseCollisions(
  statements: readonly Quad[],
  fromNamespace: string,
  toNamespace: string,
): string[] {
  const source = new Set<string>();
  const outside = new Set<string>();
  for (const statement of statements) {
    for (const term of [statement.subject, statement.predicate, statement.object, statement.graph]) {
      if (term.termType === "NamedNode") {
        (term.value.startsWith(fromNamespace) ? source : outside).add(term.value);
      } else if (term.termType === "Literal") {
        (term.datatype.value.startsWith(fromNamespace) ? source : outside).add(term.datatype.value);
      }
    }
  }
  return [...source]
    .map((iri) => `${toNamespace}${iri.slice(fromNamespace.length)}`)
    .filter((iri) => outside.has(iri))
    .sort();
}

function invalid(diagnostics: readonly RdfIoDiagnostic[]): ExplicitRebaseCandidate {
  return {
    valid: false,
    semanticDiff: emptySemanticDiff(),
    changes: [],
    diagnostics: sortDiagnostics(diagnostics),
    lossReport: { semanticLossless: true, entries: [] },
  };
}

function invalidNamespace(code: string, message: string, iri: string): RdfIoDiagnostic {
  return { severity: "error", code, message, iri };
}
