import type {
  NamedViewScope,
  ProjectionDiagnostic,
} from "./model.js";
import type { RdfsClosure } from "./rdfs-closure.js";
import {
  compareCodePoints,
  isNamedNode,
  type SemanticGraph,
} from "./rdf.js";

const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";

export type ResolvedNamedViewScope = {
  resourceIris: ReadonlySet<string>;
  predicateIris?: ReadonlySet<string>;
  diagnostics: readonly ProjectionDiagnostic[];
};

/** Resolves the closed scope against the fully parsed and validated graph. */
export function resolveNamedViewScope(
  graph: SemanticGraph,
  scope: NamedViewScope | undefined,
  closure: RdfsClosure,
): ResolvedNamedViewScope | undefined {
  if (!scope) return undefined;
  const allResources = graphResources(graph);
  const roots = [...new Set(scope.rootSemanticRefs ?? [])].sort(compareCodePoints);
  const predicates = scope.predicateIris?.length
    ? new Set(scope.predicateIris)
    : undefined;
  const diagnostics: ProjectionDiagnostic[] = [];
  for (const root of roots) {
    if (allResources.has(root)) continue;
    diagnostics.push({
      severity: "warning",
      category: "projection",
      code: "view-scope-root-unresolved",
      message: `Named view scope root does not occur in the semantic graph: ${root}`,
      semanticRef: root,
    });
  }

  const reachable = roots.length > 0
    ? traverse(graph, roots, predicates, scope.direction ?? "both", scope.depth)
    : new Set(allResources);
  const requestedTypes = scope.typeIris?.length ? [...scope.typeIris] : undefined;
  const selected = requestedTypes
    ? new Set([...reachable].filter((iri) => (
        roots.includes(iri) || resourceMatchesType(graph, iri, requestedTypes, closure)
      )))
    : reachable;
  return { resourceIris: selected, predicateIris: predicates, diagnostics };
}

export function scopeAllowsPredicate(
  scope: ResolvedNamedViewScope | undefined,
  predicateIri: string,
): boolean {
  return !scope?.predicateIris || scope.predicateIris.has(predicateIri);
}

function graphResources(graph: SemanticGraph): Set<string> {
  const resources = new Set<string>();
  for (const statement of graph.quads) {
    if (isNamedNode(statement.subject)) resources.add(statement.subject.value);
    if (isNamedNode(statement.object)) resources.add(statement.object.value);
  }
  return resources;
}

function traverse(
  graph: SemanticGraph,
  roots: readonly string[],
  predicates: ReadonlySet<string> | undefined,
  direction: "incoming" | "outgoing" | "both",
  requestedDepth: number | undefined,
): Set<string> {
  const maximumDepth = requestedDepth ?? Number.MAX_SAFE_INTEGER;
  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();
  for (const statement of graph.quads) {
    if (
      !isNamedNode(statement.subject)
      || !isNamedNode(statement.predicate)
      || !isNamedNode(statement.object)
      || statement.predicate.value === RDF_TYPE
      || (predicates && !predicates.has(statement.predicate.value))
    ) continue;
    append(outgoing, statement.subject.value, statement.object.value);
    append(incoming, statement.object.value, statement.subject.value);
  }
  for (const values of [...outgoing.values(), ...incoming.values()]) {
    values.sort(compareCodePoints);
  }
  const distances = new Map(roots.map((root) => [root, 0]));
  const queue = [...roots];
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index]!;
    const depth = distances.get(current)!;
    if (depth >= maximumDepth) continue;
    const neighbors = [
      ...(direction !== "incoming" ? outgoing.get(current) ?? [] : []),
      ...(direction !== "outgoing" ? incoming.get(current) ?? [] : []),
    ].sort(compareCodePoints);
    for (const neighbor of neighbors) {
      if (distances.has(neighbor)) continue;
      distances.set(neighbor, depth + 1);
      queue.push(neighbor);
    }
  }
  return new Set(distances.keys());
}

function resourceMatchesType(
  graph: SemanticGraph,
  resourceIri: string,
  requestedTypes: readonly string[],
  closure: RdfsClosure,
): boolean {
  return graph.store.getObjects(resourceIri, RDF_TYPE, null)
    .filter(isNamedNode)
    .some((assertedType) => requestedTypes.some((requestedType) => (
      closure.subclassDistance(assertedType.value, requestedType) !== undefined
    )));
}

function append(index: Map<string, string[]>, key: string, value: string): void {
  const values = index.get(key) ?? [];
  values.push(value);
  index.set(key, values);
}
