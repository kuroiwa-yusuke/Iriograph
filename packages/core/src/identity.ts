import type { Quad, Term } from "n3";

import { canonicalTerm } from "./rdf";

const IDENTITY_NAMESPACE = "urn:iriograph:semantic-ref:v1:";

export function statementIdentity(
  subjectIri: string,
  predicateIri: string,
  objectIri: string,
): string {
  return encodedIdentity("statement", [
    ["NamedNode", subjectIri],
    ["NamedNode", predicateIri],
    ["NamedNode", objectIri],
  ]);
}

export function statementIdentityFromQuad(quad: Quad): string {
  return encodedIdentity("statement", [
    termIdentity(quad.subject),
    termIdentity(quad.predicate),
    termIdentity(quad.object),
  ]);
}

export function sequenceTransitionIdentity(
  sequenceIri: string,
  fromOrdinal: number,
  toOrdinal: number,
): string {
  return encodedIdentity("sequence-transition", [
    sequenceIri,
    fromOrdinal,
    toOrdinal,
  ]);
}

export function alternativeBranchIdentity(
  alternativeIri: string,
  ordinal: number,
): string {
  return encodedIdentity("alternative-branch", [alternativeIri, ordinal]);
}

export function generatedElementId(
  structuralKind: "node" | "container" | "edge",
  semanticRef: string,
): string {
  return `${structuralKind}:${encodeURIComponent(semanticRef)}`;
}

function encodedIdentity(kind: string, value: unknown): string {
  return `${IDENTITY_NAMESPACE}${kind}:${encodeURIComponent(JSON.stringify(value))}`;
}

function termIdentity(term: Term): [string, string] {
  return [
    term.termType,
    term.termType === "NamedNode" ? term.value : canonicalTerm(term),
  ];
}
