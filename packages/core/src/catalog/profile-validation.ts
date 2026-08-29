import type { Quad } from "n3";

import { statementIdentityFromQuad } from "../semantic/identity.js";
import type {
  ProjectionCatalogV1,
  ProjectionDiagnostic,
  ProjectionOperator,
  ProjectionRuleResolutionTrace,
} from "../document/model.js";
import type { RdfsClosure } from "../semantic/rdfs-closure.js";
import {
  canonicalTerm,
  compareCodePoints,
  distinctNamedSubjects,
  isNamedNode,
  namedObjects,
  type SemanticGraph,
} from "../semantic/rdf.js";
import {
  matchingResourceRuleCandidates,
  resolveResourceRule,
  type ResolvedProjectionRule,
} from "./rule-resolution.js";
import type { RdfRdfsVocabulary } from "./standard-catalog.js";

export type NamedResourcePlan = {
  semanticRef: string;
  assertedTypes: string[];
  resolved?: ResolvedProjectionRule;
  resolutionTrace?: ProjectionRuleResolutionTrace;
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
      resolutionTrace: resolution.trace,
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
  validateMembershipParents(graph, catalog, closure, plans, diagnostics);

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
      validateMembership(graph, plan.semanticRef, operator, closure, parentByChild, diagnostics);
    } else if (operator.operator === "membership-region") {
      validateRegionMembership(graph, plan.semanticRef, operator, closure, diagnostics);
    } else if (operator.operator === "ordinal-sequence" || operator.operator === "alternative") {
      validateOrdinalStructure(graph, plan.semanticRef, operator, diagnostics);
    }
  }

  validateContainerCycles(parentByChild, diagnostics);
  validateOrphanOrdinals(graph, plans, ordinalPrefixes, diagnostics);
  return diagnostics;
}

function validateMembershipParents(
  graph: SemanticGraph,
  catalog: ProjectionCatalogV1,
  closure: RdfsClosure,
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
  for (const quad of graph.quads) {
    if (!isNamedNode(quad.predicate)) continue;
    const predicate = [...predicates].find((candidate) => (
      closure.subpropertyDistance(quad.predicate.value, candidate) !== undefined
    ));
    if (!predicate) continue;
      const plan = isNamedNode(quad.subject) ? plans.get(quad.subject.value) : undefined;
      const operator = plan?.resolved?.rule.project;
      if (
        operator?.operator === "membership-container"
        && closure.subpropertyDistance(quad.predicate.value, operator.membershipPredicate) !== undefined
      ) continue;
      diagnostics.push({
        severity: "error",
        code: "membership-parent-invalid",
        message: `${quad.subject.value}はmembership-containerとして解決されないため${quad.predicate.value}を使用できません。`,
        semanticRef: isNamedNode(quad.subject) ? quad.subject.value : canonicalTerm(quad.subject),
        statementRef: statementIdentityFromQuad(quad),
        suggestedActions: [{
          actionId: "choose-valid-membership-container",
          semanticRef: isNamedNode(quad.subject) ? quad.subject.value : canonicalTerm(quad.subject),
          statementRef: statementIdentityFromQuad(quad),
          parameters: { predicateIri: quad.predicate.value },
        }],
      });
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
  closure: RdfsClosure,
  parentByChild: Map<string, Array<{ parent: string; quad: Quad }>>,
  diagnostics: ProjectionDiagnostic[],
): void {
  for (const quad of graph.store.getQuads(parentIri, null, null, null).filter((candidate) => (
    isNamedNode(candidate.predicate)
    && closure.subpropertyDistance(candidate.predicate.value, operator.membershipPredicate) !== undefined
  ))) {
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

function validateRegionMembership(
  graph: SemanticGraph,
  regionIri: string,
  operator: Extract<ProjectionOperator, { operator: "membership-region" }>,
  closure: RdfsClosure,
  diagnostics: ProjectionDiagnostic[],
): void {
  const candidates = operator.containerPosition === "subject"
    ? graph.store.getQuads(regionIri, null, null, null)
    : graph.store.getQuads(null, null, regionIri, null);
  for (const quad of candidates.filter((candidate) => (
    isNamedNode(candidate.predicate)
    && closure.subpropertyDistance(candidate.predicate.value, operator.membershipPredicate) !== undefined
  ))) {
    const member = operator.containerPosition === "subject" ? quad.object : quad.subject;
    if (isNamedNode(member)) continue;
    diagnostics.push({
      severity: "error",
      code: "structural-resource-must-be-named",
      message: `${regionIri}のregion memberはnamed IRIでなければなりません。`,
      semanticRef: regionIri,
      statementRef: statementIdentityFromQuad(quad),
      suggestedActions: [{
        actionId: "replace-region-member-with-named-resource",
        semanticRef: regionIri,
        statementRef: statementIdentityFromQuad(quad),
      }],
    });
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
      severity: "warning",
      code: operator.operator === "alternative"
        ? "alternative-too-few-members"
        : "sequence-empty",
      message: `${resourceIri}のframeは表示できますが、完了には${minimum}件以上のordinal memberが必要です。`,
      semanticRef: resourceIri,
      suggestedActions: [{
        actionId: operator.operator === "alternative"
          ? "add-alternative-members"
          : "add-sequence-member",
        semanticRef: resourceIri,
        parameters: { minimumMembers: minimum },
      }],
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
      severity: "warning",
      code: "alternative-default-missing",
      message: `${resourceIri}のdefault ordinal ${operator.defaultOrdinal}が未設定です。候補は表示できます。`,
      semanticRef: resourceIri,
      suggestedActions: [{
        actionId: "choose-alternative-default",
        semanticRef: resourceIri,
        parameters: { defaultOrdinal: operator.defaultOrdinal },
      }],
    });
  }
}

function validateContainerCycles(
  parentByChild: ReadonlyMap<string, Array<{ parent: string; quad: Quad }>>,
  diagnostics: ProjectionDiagnostic[],
): void {
  const parents = new Map<string, string[]>();
  for (const [child, entries] of parentByChild) {
    parents.set(child, [...new Set(entries.map((entry) => entry.parent))].sort(compareCodePoints));
  }
  const reported = new Set<string>();
  const visited = new Set<string>();
  const active: string[] = [];
  const activeIndex = new Map<string, number>();
  const visit = (current: string): void => {
    if (activeIndex.has(current)) {
      const cycle = active.slice(activeIndex.get(current)!).sort(compareCodePoints);
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
      return;
    }
    if (visited.has(current)) return;
    activeIndex.set(current, active.length);
    active.push(current);
    for (const parent of parents.get(current) ?? []) visit(parent);
    active.pop();
    activeIndex.delete(current);
    visited.add(current);
  };
  for (const start of [...parents.keys()].sort(compareCodePoints)) {
    visit(start);
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
    || operator.operator === "membership-region"
    || operator.operator === "ordinal-sequence"
    || operator.operator === "alternative";
}
