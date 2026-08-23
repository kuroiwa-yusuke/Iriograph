import type { SemanticGraph } from "./rdf.js";
import { compareCodePoints, isNamedNode } from "./rdf.js";
import type { RdfRdfsVocabulary } from "./standard-catalog.js";

export type RdfsClosure = {
  subclassDistance(child: string, ancestor: string): number | undefined;
  subpropertyDistance(child: string, ancestor: string): number | undefined;
};

export function buildLimitedRdfsClosure(
  graph: SemanticGraph,
  vocabulary: RdfRdfsVocabulary,
): RdfsClosure {
  const subclass = adjacencyFor(graph, vocabulary.subClassOfPredicate);
  const subproperty = adjacencyFor(graph, vocabulary.subPropertyOfPredicate);
  const subclassCache = new Map<string, ReadonlyMap<string, number>>();
  const subpropertyCache = new Map<string, ReadonlyMap<string, number>>();

  return {
    subclassDistance: (child, ancestor) => distance(
      child,
      ancestor,
      subclass,
      subclassCache,
    ),
    subpropertyDistance: (child, ancestor) => distance(
      child,
      ancestor,
      subproperty,
      subpropertyCache,
    ),
  };
}

function adjacencyFor(
  graph: SemanticGraph,
  predicateIri: string,
): ReadonlyMap<string, readonly string[]> {
  const mutable = new Map<string, Set<string>>();
  for (const quad of graph.store.getQuads(null, predicateIri, null, null)) {
    if (!isNamedNode(quad.subject) || !isNamedNode(quad.object)) continue;
    const values = mutable.get(quad.subject.value) ?? new Set<string>();
    values.add(quad.object.value);
    mutable.set(quad.subject.value, values);
  }
  return new Map(
    [...mutable.entries()]
      .sort(([left], [right]) => compareCodePoints(left, right))
      .map(([key, values]) => [
        key,
        [...values].sort(compareCodePoints),
      ]),
  );
}

function distance(
  child: string,
  ancestor: string,
  adjacency: ReadonlyMap<string, readonly string[]>,
  cache: Map<string, ReadonlyMap<string, number>>,
): number | undefined {
  if (child === ancestor) return 0;
  let distances = cache.get(child);
  if (!distances) {
    distances = allDistances(child, adjacency);
    cache.set(child, distances);
  }
  return distances.get(ancestor);
}

function allDistances(
  start: string,
  adjacency: ReadonlyMap<string, readonly string[]>,
): ReadonlyMap<string, number> {
  const distances = new Map<string, number>([[start, 0]]);
  const queue = [start];
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index]!;
    const nextDistance = distances.get(current)! + 1;
    for (const next of adjacency.get(current) ?? []) {
      if (distances.has(next)) continue;
      distances.set(next, nextDistance);
      queue.push(next);
    }
  }
  return distances;
}
