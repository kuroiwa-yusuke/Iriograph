import type { SemanticGraph } from "./rdf.js";
import { compareCodePoints, isNamedNode } from "./rdf.js";
import type { RdfRdfsVocabulary } from "./standard-catalog.js";

export type RdfsClosure = {
  subclassDistance(child: string, ancestor: string): number | undefined;
  subpropertyDistance(child: string, ancestor: string): number | undefined;
  /** Finite, deterministic diagnostics for hierarchy cycles used by rule matching. */
  diagnostics: readonly RdfsHierarchyCycleDiagnostic[];
};

export type RdfsHierarchyCycleDiagnostic = {
  code:
    | "projection-subclass-entailment-cycle"
    | "projection-subproperty-entailment-cycle";
  kind: "class" | "property";
  /** Closed path: the first and final IRI are equal. */
  path: readonly string[];
};

export function buildLimitedRdfsClosure(
  graph: SemanticGraph,
  vocabulary: RdfRdfsVocabulary,
): RdfsClosure {
  const subclass = adjacencyFor(graph, vocabulary.subClassOfPredicate);
  const subproperty = adjacencyFor(graph, vocabulary.subPropertyOfPredicate);
  const subclassCache = new Map<string, ReadonlyMap<string, number>>();
  const subpropertyCache = new Map<string, ReadonlyMap<string, number>>();
  const diagnostics = [
    ...hierarchyCycleDiagnostics(subclass, "class"),
    ...hierarchyCycleDiagnostics(subproperty, "property"),
  ].sort((left, right) => (
    compareCodePoints(left.code, right.code)
    || compareCodePoints(left.path.join("\u0000"), right.path.join("\u0000"))
  ));

  return {
    diagnostics,
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

/**
 * Reports one stable DFS back-edge path per discovered cycle key. This is
 * deliberately not an all-simple-cycle enumerator: diagnostics remain bounded
 * by the hierarchy graph while distance lookup continues to use finite BFS.
 */
function hierarchyCycleDiagnostics(
  adjacency: ReadonlyMap<string, readonly string[]>,
  kind: "class" | "property",
): RdfsHierarchyCycleDiagnostic[] {
  const nodes = new Set<string>();
  for (const [child, parents] of adjacency) {
    nodes.add(child);
    parents.forEach((parent) => nodes.add(parent));
  }
  const state = new Map<string, "active" | "complete">();
  const stack: string[] = [];
  const stackIndex = new Map<string, number>();
  const cycles = new Map<string, RdfsHierarchyCycleDiagnostic>();
  const visit = (node: string): void => {
    state.set(node, "active");
    stackIndex.set(node, stack.length);
    stack.push(node);
    for (const parent of adjacency.get(node) ?? []) {
      if (state.get(parent) === "active") {
        const start = stackIndex.get(parent)!;
        const path = [...stack.slice(start), parent];
        const key = canonicalCycleKey(path);
        if (!cycles.has(key)) {
          cycles.set(key, {
            code: kind === "class"
              ? "projection-subclass-entailment-cycle"
              : "projection-subproperty-entailment-cycle",
            kind,
            path,
          });
        }
        continue;
      }
      if (!state.has(parent)) visit(parent);
    }
    stack.pop();
    stackIndex.delete(node);
    state.set(node, "complete");
  };
  [...nodes].sort(compareCodePoints).forEach((node) => {
    if (!state.has(node)) visit(node);
  });
  return [...cycles.values()].sort((left, right) => (
    compareCodePoints(left.path.join("\u0000"), right.path.join("\u0000"))
  ));
}

function canonicalCycleKey(closedPath: readonly string[]): string {
  const cycle = closedPath.slice(0, -1);
  if (cycle.length === 0) return "";
  return cycle.map((_, index) => {
    const rotated = [...cycle.slice(index), ...cycle.slice(0, index)];
    return [...rotated, rotated[0]!].join("\u0000");
  }).sort(compareCodePoints)[0]!;
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
