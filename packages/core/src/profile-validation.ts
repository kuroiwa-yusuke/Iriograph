import type { Quad } from "n3";

import { statementIdentityFromQuad } from "./identity";
import type {
  ProjectionCatalogV1,
  ProjectionDiagnostic,
  ProjectionOperator,
} from "./model";
import type { RdfsClosure } from "./rdfs-closure";
import {
  canonicalTerm,
  compareCodePoints,
  distinctNamedSubjects,
  isNamedNode,
  namedObjects,
  type SemanticGraph,
} from "./rdf";
import {
  matchingResourceRuleCandidates,
  resolveResourceRule,
  type ResolvedProjectionRule,
} from "./rule-resolution";
import type { RdfRdfsVocabulary } from "./standard-catalog";

export type NamedResourcePlan = {
  semanticRef: string;
  assertedTypes: string[];
  resolved?: ResolvedProjectionRule;
};

export type OrdinalMember = {
  ordinal?: number;
  quad: Quad;
  memberIri?: string;
};

export function resolveNamedResourcePlans(
  graph: SemanticGraph,
  catalog: ProjectionCatalogV1,
  closure: RdfsClosure,
  vocabulary: RdfRdfsVocabulary,
): { plans: ReadonlyMap<string, NamedResourcePlan>; diagnostics: ProjectionDiagnostic[] } {
  const plans = new Map<string, NamedResourcePlan>();
  const diagnostics: ProjectionDiagnostic[] = [];
  for (const semanticRef of distinctNamedSubjects(graph)) {
    const assertedTypes = namedObjects(graph, semanticRef, vocabulary.typePredicate);
    const resolution = resolveResourceRule(catalog, assertedTypes, closure, semanticRef);
    diagnostics.push(...resolution.diagnostics);
    plans.set(semanticRef, {
      semanticRef,
      assertedTypes,
      resolved: resolution.resolved,
    });
  }
  return { plans, diagnostics };
}

export function validateProfileStructure(
  graph: SemanticGraph,
  catalog: ProjectionCatalogV1,
  closure: RdfsClosure,
  vocabulary: RdfRdfsVocabulary,
): ProjectionDiagnostic[] {
  const diagnostics: ProjectionDiagnostic[] = [];
  const resolution = resolveNamedResourcePlans(graph, catalog, closure, vocabulary);
  diagnostics.push(...resolution.diagnostics);
  const plans = resolution.plans;

  validateBlankStructuralResources(graph, catalog, closure, vocabulary, diagnostics);
  validateConcreteStructureTypes(graph, catalog, closure, vocabulary, diagnostics);
  validateMembershipParents(graph, catalog, plans, diagnostics);

  const parentByChild = new Map<string, Array<{ parent: string; quad: Quad }>>();
  const ordinalPrefixes = new Set(
    catalog.rules
      .map((rule) => rule.project)
      .filter((operator): operator is Extract<ProjectionOperator, {
        operator: "ordinal-sequence" | "alternative";
      }> => operator.operator === "ordinal-sequence" || operator.operator === "alternative")
      .map((operator) => operator.ordinalPredicatePrefix),
  );

  for (const plan of plans.values()) {
    const operator = plan.resolved?.rule.project;
    if (!operator) continue;
    if (operator.operator === "membership-container") {
      validateMembership(graph, plan.semanticRef, operator, parentByChild, diagnostics);
    } else if (operator.operator === "ordinal-sequence" || operator.operator === "alternative") {
      validateOrdinalStructure(graph, plan.semanticRef, operator, diagnostics);
    }
  }

  validateUniqueParents(parentByChild, diagnostics);
  validateContainerCycles(parentByChild, diagnostics);
  validateOrphanOrdinals(graph, plans, ordinalPrefixes, diagnostics);
  return diagnostics;
}

function validateMembershipParents(
  graph: SemanticGraph,
  catalog: ProjectionCatalogV1,
  plans: ReadonlyMap<string, NamedResourcePlan>,
  diagnostics: ProjectionDiagnostic[],
): void {
  const predicates = new Set(
    catalog.rules
      .map((rule) => rule.project)
      .filter((operator): operator is Extract<ProjectionOperator, {
        operator: "membership-container";
      }> => operator.operator === "membership-container")
      .map((operator) => operator.membershipPredicate),
  );
  for (const predicate of [...predicates].sort(compareCodePoints)) {
    for (const quad of graph.store.getQuads(null, predicate, null, null)) {
      const plan = isNamedNode(quad.subject) ? plans.get(quad.subject.value) : undefined;
      const operator = plan?.resolved?.rule.project;
      if (
        operator?.operator === "membership-container"
        && operator.membershipPredicate === predicate
      ) continue;
      diagnostics.push({
        severity: "error",
        code: "membership-parent-invalid",
        message: `${quad.subject.value}はmembership-containerとして解決されないため${predicate}を使用できません。`,
        semanticRef: isNamedNode(quad.subject) ? quad.subject.value : canonicalTerm(quad.subject),
        statementRef: statementIdentityFromQuad(quad),
      });
    }
  }
}

export function collectOrdinalMembers(
  graph: SemanticGraph,
  subjectIri: string,
  predicatePrefix: string,
): OrdinalMember[] {
  return graph.store
    .getQuads(subjectIri, null, null, null)
    .filter((quad) => parseOrdinal(quad.predicate.value, predicatePrefix) !== undefined)
    .map((quad) => ({
      ordinal: parseOrdinal(quad.predicate.value, predicatePrefix),
      quad,
      memberIri: isNamedNode(quad.object) ? quad.object.value : undefined,
    }))
    .sort((left, right) => {
      return (left.ordinal ?? Number.MAX_SAFE_INTEGER)
        - (right.ordinal ?? Number.MAX_SAFE_INTEGER)
        || compareCodePoints(canonicalTerm(left.quad.object), canonicalTerm(right.quad.object));
    });
}

export function parseOrdinal(
  predicateIri: string,
  predicatePrefix: string,
): number | undefined {
  if (!predicateIri.startsWith(predicatePrefix)) return undefined;
  const suffix = predicateIri.slice(predicatePrefix.length);
  if (!/^[1-9][0-9]*$/.test(suffix)) return undefined;
  const ordinal = Number(suffix);
  return Number.isSafeInteger(ordinal) ? ordinal : undefined;
}

function validateBlankStructuralResources(
  graph: SemanticGraph,
  catalog: ProjectionCatalogV1,
  closure: RdfsClosure,
  vocabulary: RdfRdfsVocabulary,
  diagnostics: ProjectionDiagnostic[],
): void {
  const reported = new Set<string>();
  for (const quad of graph.store.getQuads(null, vocabulary.typePredicate, null, null)) {
    if (isNamedNode(quad.subject) || !isNamedNode(quad.object)) continue;
    const candidates = matchingResourceRuleCandidates(catalog, [quad.object.value], closure);
    if (!candidates.some((candidate) => isStructuralOperator(candidate.rule.project))) continue;
    const semanticRef = canonicalTerm(quad.subject);
    if (reported.has(semanticRef)) continue;
    reported.add(semanticRef);
    diagnostics.push({
      severity: "error",
      code: "structural-resource-must-be-named",
      message: `表示構造を駆動するresourceはnamed IRIでなければなりません: ${semanticRef}`,
      semanticRef,
      statementRef: statementIdentityFromQuad(quad),
    });
  }
}

function validateConcreteStructureTypes(
  graph: SemanticGraph,
  catalog: ProjectionCatalogV1,
  closure: RdfsClosure,
  vocabulary: RdfRdfsVocabulary,
  diagnostics: ProjectionDiagnostic[],
): void {
  for (const semanticRef of distinctNamedSubjects(graph)) {
    const types = namedObjects(graph, semanticRef, vocabulary.typePredicate);
    const structures = new Set(
      matchingResourceRuleCandidates(catalog, types, closure)
        .map((candidate) => candidate.rule.project.operator)
        .filter((operator) => (
          operator === "membership-container"
          || operator === "ordinal-sequence"
          || operator === "alternative"
        )),
    );
    if (structures.size <= 1) continue;
    diagnostics.push({
      severity: "error",
      code: "multiple-structural-types",
      message: `${semanticRef}に複数の具体的な表示構造型があります: ${[...structures].sort().join(", ")}`,
      semanticRef,
    });
  }
}

function validateMembership(
  graph: SemanticGraph,
  parentIri: string,
  operator: Extract<ProjectionOperator, { operator: "membership-container" }>,
  parentByChild: Map<string, Array<{ parent: string; quad: Quad }>>,
  diagnostics: ProjectionDiagnostic[],
): void {
  for (const quad of graph.store.getQuads(parentIri, operator.membershipPredicate, null, null)) {
    if (!isNamedNode(quad.object)) {
      diagnostics.push({
        severity: "error",
        code: "structural-resource-must-be-named",
        message: `${parentIri}のmemberはnamed IRIでなければなりません。`,
        semanticRef: parentIri,
        statementRef: statementIdentityFromQuad(quad),
      });
      continue;
    }
    const parents = parentByChild.get(quad.object.value) ?? [];
    parents.push({ parent: parentIri, quad });
    parentByChild.set(quad.object.value, parents);
  }
}

function validateOrdinalStructure(
  graph: SemanticGraph,
  resourceIri: string,
  operator: Extract<ProjectionOperator, { operator: "ordinal-sequence" | "alternative" }>,
  diagnostics: ProjectionDiagnostic[],
): void {
  const members = collectOrdinalMembers(graph, resourceIri, operator.ordinalPredicatePrefix);
  const byOrdinal = new Map<number, OrdinalMember[]>();
  for (const member of members) {
    if (member.ordinal === undefined) {
      diagnostics.push({
        severity: "error",
        code: "invalid-ordinal-predicate",
        message: `${member.quad.predicate.value}は正の連続ordinalではありません。`,
        semanticRef: resourceIri,
        statementRef: statementIdentityFromQuad(member.quad),
      });
      continue;
    }
    if (!member.memberIri) {
      diagnostics.push({
        severity: "error",
        code: "structural-resource-must-be-named",
        message: `${resourceIri}のordinal memberはnamed IRIでなければなりません。`,
        semanticRef: resourceIri,
        statementRef: statementIdentityFromQuad(member.quad),
      });
    }
    const values = byOrdinal.get(member.ordinal) ?? [];
    values.push(member);
    byOrdinal.set(member.ordinal, values);
  }

  for (const [ordinal, values] of byOrdinal) {
    if (values.length <= 1) continue;
    diagnostics.push({
      severity: "error",
      code: "duplicate-ordinal",
      message: `${resourceIri}のordinal ${ordinal}に複数のobjectがあります。`,
      semanticRef: resourceIri,
    });
  }

  const ordinals = [...byOrdinal.keys()].sort((left, right) => left - right);
  const minimum = operator.operator === "alternative" ? 2 : 1;
  if (ordinals.length < minimum) {
    diagnostics.push({
      severity: "error",
      code: operator.operator === "alternative"
        ? "alternative-too-few-members"
        : "sequence-empty",
      message: `${resourceIri}には${minimum}件以上のordinal memberが必要です。`,
      semanticRef: resourceIri,
    });
  }
  for (let expected = 1; expected <= ordinals.length; expected += 1) {
    if (ordinals[expected - 1] === expected) continue;
    diagnostics.push({
      severity: "error",
      code: "non-contiguous-ordinals",
      message: `${resourceIri}のordinalは1から欠番なく連続させる必要があります。`,
      semanticRef: resourceIri,
    });
    break;
  }
  if (operator.operator === "alternative" && !byOrdinal.has(operator.defaultOrdinal)) {
    diagnostics.push({
      severity: "error",
      code: "alternative-default-missing",
      message: `${resourceIri}にdefault ordinal ${operator.defaultOrdinal}がありません。`,
      semanticRef: resourceIri,
    });
  }
}

function validateUniqueParents(
  parentByChild: ReadonlyMap<string, Array<{ parent: string; quad: Quad }>>,
  diagnostics: ProjectionDiagnostic[],
): void {
  for (const [child, entries] of parentByChild) {
    const parents = [...new Set(entries.map((entry) => entry.parent))].sort(compareCodePoints);
    if (parents.length <= 1) continue;
    diagnostics.push({
      severity: "error",
      code: "multiple-container-parents",
      message: `${child}に複数のcontainer parentがあります: ${parents.join(", ")}`,
      semanticRef: child,
    });
  }
}

function validateContainerCycles(
  parentByChild: ReadonlyMap<string, Array<{ parent: string; quad: Quad }>>,
  diagnostics: ProjectionDiagnostic[],
): void {
  const parent = new Map<string, string>();
  for (const [child, entries] of parentByChild) {
    const parents = [...new Set(entries.map((entry) => entry.parent))];
    if (parents.length === 1) parent.set(child, parents[0]!);
  }
  const reported = new Set<string>();
  for (const start of [...parent.keys()].sort(compareCodePoints)) {
    const path: string[] = [];
    const position = new Map<string, number>();
    let current: string | undefined = start;
    while (current !== undefined) {
      const seenAt = position.get(current);
      if (seenAt !== undefined) {
        const cycle = path.slice(seenAt).sort(compareCodePoints);
        const key = cycle.join("\n");
        if (!reported.has(key)) {
          reported.add(key);
          diagnostics.push({
            severity: "error",
            code: "container-cycle",
            message: `container包含にcycleがあります: ${cycle.join(", ")}`,
            semanticRef: cycle[0],
          });
        }
        break;
      }
      position.set(current, path.length);
      path.push(current);
      current = parent.get(current);
    }
  }
}

function validateOrphanOrdinals(
  graph: SemanticGraph,
  plans: ReadonlyMap<string, NamedResourcePlan>,
  prefixes: ReadonlySet<string>,
  diagnostics: ProjectionDiagnostic[],
): void {
  for (const quad of graph.quads) {
    const prefix = [...prefixes].find((candidate) => (
      parseOrdinal(quad.predicate.value, candidate) !== undefined
    ));
    if (!prefix) continue;
    if (isNamedNode(quad.subject)) {
      const operator = plans.get(quad.subject.value)?.resolved?.rule.project;
      if (
        (operator?.operator === "ordinal-sequence" || operator?.operator === "alternative")
        && operator.ordinalPredicatePrefix === prefix
      ) continue;
    }
    diagnostics.push({
      severity: "error",
      code: "orphan-ordinal-membership",
      message: `${quad.predicate.value}はSeqまたはAltとして解決されたresourceでだけ利用できます。`,
      semanticRef: canonicalTerm(quad.subject),
      statementRef: statementIdentityFromQuad(quad),
    });
  }
}

function isStructuralOperator(operator: ProjectionOperator): boolean {
  return operator.operator === "membership-container"
    || operator.operator === "ordinal-sequence"
    || operator.operator === "alternative";
}
