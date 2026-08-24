import {
  DataFactory,
  Store,
  type BlankNode,
  type Literal,
  type NamedNode,
  type Quad,
  type Term,
} from "n3";

import { statementIdentityFromQuad } from "./identity.js";
import type { StatementSemanticComment } from "./model.js";
import {
  canonicalQuad,
  canonicalTerm,
  compareCodePoints,
  type SemanticGraph,
} from "./rdf.js";

const { blankNode, namedNode, quad } = DataFactory;

export const RDF_REIFICATION_STATEMENT = "http://www.w3.org/1999/02/22-rdf-syntax-ns#Statement";
export const RDF_REIFICATION_SUBJECT = "http://www.w3.org/1999/02/22-rdf-syntax-ns#subject";
export const RDF_REIFICATION_PREDICATE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#predicate";
export const RDF_REIFICATION_OBJECT = "http://www.w3.org/1999/02/22-rdf-syntax-ns#object";
const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const RDFS_COMMENT = "http://www.w3.org/2000/01/rdf-schema#comment";

export type NamedDirectStatement = {
  subjectIri: string;
  predicateIri: string;
  objectIri: string;
};

export type StatementReifier = {
  /** Stable only inside the parsed dataset; it is never a semantic edge identity. */
  reifierRef: string;
  term: NamedNode | BlankNode;
};

/**
 * Finds every RDF 1.1 standard reifier that exactly names S/P/O. Results are
 * deterministic and accept both blank and named reifiers from existing data.
 */
export function findStatementReifiers(
  store: Store,
  statement: NamedDirectStatement,
): StatementReifier[] {
  const subjects = store.getSubjects(RDF_REIFICATION_SUBJECT, namedNode(statement.subjectIri), null)
    .filter(isResourceTerm);
  return subjects
    .filter((candidate) => (
      store.countQuads(candidate, RDF_TYPE, RDF_REIFICATION_STATEMENT, null) > 0
      && hasExactNamedObject(store, candidate, RDF_REIFICATION_SUBJECT, statement.subjectIri)
      && hasExactNamedObject(store, candidate, RDF_REIFICATION_PREDICATE, statement.predicateIri)
      && hasExactNamedObject(store, candidate, RDF_REIFICATION_OBJECT, statement.objectIri)
    ))
    .map((term) => ({ term, reifierRef: canonicalTerm(term) }))
    .sort((left, right) => compareCodePoints(left.reifierRef, right.reifierRef));
}

/** Returns semantic comments for one asserted direct statement, never predicate comments. */
export function collectStatementComments(
  graph: SemanticGraph,
  statement: NamedDirectStatement,
): StatementSemanticComment[] {
  return findStatementReifiers(graph.store, statement)
    .flatMap(({ term, reifierRef }) => graph.store
      .getQuads(term, RDFS_COMMENT, null, null)
      .filter((value): value is Quad & { object: Literal } => value.object.termType === "Literal")
      .map((value): StatementSemanticComment => ({
        value: value.object.value.normalize("NFC"),
        predicateIri: RDFS_COMMENT,
        statementRef: statementIdentityFromQuad(value),
        reifierRef,
        ...(value.object.language
          ? { language: value.object.language.toLowerCase() }
          : {}),
        ...(value.object.datatype?.value
          ? { datatypeIri: value.object.datatype.value }
          : {}),
      })))
    .sort(compareStatementComments);
}

/** Named reifiers are hidden from ordinary projection just like blank reifiers. */
export function namedStatementReifierIris(graph: SemanticGraph): Set<string> {
  return new Set(statementReifiers(graph)
    .filter((value): value is StatementReifier & { term: NamedNode } => (
      value.term.termType === "NamedNode"
    ))
    .map((value) => value.term.value));
}

/** Enumerates well-formed standard statement reifiers without projecting them. */
export function statementReifiers(graph: SemanticGraph): StatementReifier[] {
  const result: StatementReifier[] = [];
  for (const value of graph.store.getQuads(null, RDF_TYPE, RDF_REIFICATION_STATEMENT, null)) {
    if (!isResourceTerm(value.subject)) continue;
    const subject = value.subject;
    result.push({ term: subject, reifierRef: canonicalTerm(subject) });
  }
  return [...new Map(result.map((value) => [value.reifierRef, value])).values()]
    .sort((left, right) => compareCodePoints(left.reifierRef, right.reifierRef));
}

/**
 * Returns the exact outbound/inbound RDF closure for every matching reifier.
 * It is used by asserted-statement and resource cascade deletion so no blank
 * reification scaffolding remains orphaned.
 */
export function statementReificationClosure(
  store: Store,
  statement: NamedDirectStatement,
): Quad[] {
  const values = new Map<string, Quad>();
  for (const { term } of findStatementReifiers(store, statement)) {
    for (const value of [
      ...store.getQuads(term, null, null, null),
      ...store.getQuads(null, null, term, null),
    ]) values.set(canonicalQuad(value), value);
  }
  return [...values.values()].sort((left, right) => (
    compareCodePoints(canonicalQuad(left), canonicalQuad(right))
  ));
}

/** Allocates a repeatable blank reifier ID without colliding with current data. */
export function allocateStatementReifier(
  store: Store,
  statementRef: string,
): BlankNode {
  const stem = `iriograph-statement-${hash(statementRef)}`;
  for (let suffix = 0; ; suffix += 1) {
    const candidate = blankNode(suffix === 0 ? stem : `${stem}-${suffix}`);
    if (
      store.countQuads(candidate, null, null, null) === 0
      && store.countQuads(null, null, candidate, null) === 0
    ) return candidate;
  }
}

export function standardReificationQuads(
  reifier: NamedNode | BlankNode,
  statement: NamedDirectStatement,
): Quad[] {
  return [
    quad(reifier, namedNode(RDF_TYPE), namedNode(RDF_REIFICATION_STATEMENT)),
    quad(reifier, namedNode(RDF_REIFICATION_SUBJECT), namedNode(statement.subjectIri)),
    quad(reifier, namedNode(RDF_REIFICATION_PREDICATE), namedNode(statement.predicateIri)),
    quad(reifier, namedNode(RDF_REIFICATION_OBJECT), namedNode(statement.objectIri)),
  ];
}

function isResourceTerm(term: Term): term is NamedNode | BlankNode {
  return term.termType === "NamedNode" || term.termType === "BlankNode";
}

function hasExactNamedObject(
  store: Store,
  subject: NamedNode | BlankNode,
  predicateIri: string,
  expectedIri: string,
): boolean {
  const objects = store.getObjects(subject, predicateIri, null);
  return objects.length === 1
    && objects[0]?.termType === "NamedNode"
    && objects[0].value === expectedIri;
}

function compareStatementComments(
  left: StatementSemanticComment,
  right: StatementSemanticComment,
): number {
  return compareCodePoints(left.language ?? "", right.language ?? "")
    || compareCodePoints(left.value, right.value)
    || compareCodePoints(left.datatypeIri ?? "", right.datatypeIri ?? "")
    || compareCodePoints(left.reifierRef, right.reifierRef)
    || compareCodePoints(left.statementRef, right.statementRef);
}

function hash(value: string): string {
  let result = 0x811c9dc5;
  for (const character of value) {
    result ^= character.codePointAt(0)!;
    result = Math.imul(result, 0x01000193);
  }
  return (result >>> 0).toString(16).padStart(8, "0");
}
