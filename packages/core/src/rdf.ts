import { Parser, Store, type NamedNode, type Quad, type Term } from "n3";

import type { IriographDocument } from "./model";

export type SemanticGraph = {
  readonly quads: readonly Quad[];
  readonly store: Store;
};

export function parseSemanticGraph(document: IriographDocument): SemanticGraph {
  const quads = new Parser({
    baseIRI: document.semantic.baseIri,
    format: "text/turtle",
  }).parse(document.semantic.source);
  return semanticGraphFromQuads(quads);
}

export function semanticGraphFromQuads(quads: readonly Quad[]): SemanticGraph {
  const sorted = [...quads].sort(compareQuads);
  return { quads: sorted, store: new Store(sorted) };
}

export function compareQuads(left: Quad, right: Quad): number {
  return compareCodePoints(canonicalQuad(left), canonicalQuad(right));
}

export function canonicalQuad(quad: Quad): string {
  return [quad.subject, quad.predicate, quad.object, quad.graph]
    .map(canonicalTerm)
    .join(" ");
}

export function canonicalTerm(term: Term): string {
  switch (term.termType) {
    case "NamedNode":
      return `<${escapeIri(term.value)}>`;
    case "BlankNode":
      return `_:${term.value}`;
    case "Literal": {
      const lexical = JSON.stringify(term.value.normalize("NFC"));
      if (term.language) return `${lexical}@${term.language.toLowerCase()}`;
      return `${lexical}^^<${escapeIri(term.datatype.value)}>`;
    }
    case "DefaultGraph":
      return "";
    case "Variable":
      return `?${term.value}`;
  }
}

export function distinctNamedSubjects(graph: SemanticGraph): string[] {
  return sortedUnique(
    graph.quads
      .filter((quad) => isNamedNode(quad.subject))
      .map((quad) => quad.subject.value),
  );
}

export function namedObjects(
  graph: SemanticGraph,
  subjectIri: string,
  predicateIri: string,
): string[] {
  return sortedUnique(
    graph.store
      .getObjects(subjectIri, predicateIri, null)
      .filter(isNamedNode)
      .map((term) => term.value),
  );
}

export function isNamedNode(term: Term): term is NamedNode {
  return term.termType === "NamedNode";
}

export function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareCodePoints);
}

export function compareCodePoints(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function escapeIri(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll(">", "\\>");
}
