import type {
  ProjectionCatalogV1,
  ProjectionDiagnostic,
  ProjectionRule,
  VisualTemplate,
} from "./model";
import type { RdfsClosure } from "./rdfs-closure";
import { compareCodePoints } from "./rdf";
import { catalogRef } from "./standard-catalog";

export type ResolvedProjectionRule = {
  catalogRef: string;
  rule: ProjectionRule;
  /** Asserted type/predicate that actually matched the rule (not its ancestor match IRI). */
  matchedIri?: string;
  specificity: "exact" | "entailed" | "wildcard";
  distance: number;
};

export type RuleResolution = {
  resolved?: ResolvedProjectionRule;
  diagnostics: ProjectionDiagnostic[];
};

export function resolveResourceRule(
  catalog: ProjectionCatalogV1,
  assertedTypes: readonly string[],
  closure: RdfsClosure,
  semanticRef: string,
): RuleResolution {
  return resolveCandidates(
    matchingResourceRuleCandidates(catalog, assertedTypes, closure),
    semanticRef,
  );
}

export function matchingResourceRuleCandidates(
  catalog: ProjectionCatalogV1,
  assertedTypes: readonly string[],
  closure: RdfsClosure,
): ResolvedProjectionRule[] {
  const candidates: ResolvedProjectionRule[] = [];
  for (const rule of catalog.rules) {
    if (rule.match.kind !== "type") continue;
    let best: ResolvedProjectionRule | undefined;
    for (const assertedType of assertedTypes) {
      const distance = typeDistance(assertedType, rule, closure);
      if (distance === undefined) continue;
      const candidate = candidateFor(catalog, rule, distance, assertedType);
      if (!best || compareCandidates(candidate, best) < 0) best = candidate;
    }
    if (best) candidates.push(best);
  }
  return candidates;
}

export function resolveStatementRule(
  catalog: ProjectionCatalogV1,
  predicateIri: string,
  closure: RdfsClosure,
  semanticRef: string,
): RuleResolution {
  const candidates: ResolvedProjectionRule[] = [];
  for (const rule of catalog.rules) {
    if (rule.match.kind === "any-iri-object") {
      candidates.push(candidateFor(catalog, rule, Number.MAX_SAFE_INTEGER));
      continue;
    }
    if (rule.match.kind !== "predicate") continue;
    const distance = predicateDistance(predicateIri, rule, closure);
    if (distance === undefined) continue;
    candidates.push(candidateFor(catalog, rule, distance, predicateIri));
  }
  return resolveCandidates(candidates, semanticRef);
}

export function validateProjectionCatalog(
  catalog: ProjectionCatalogV1,
): ProjectionDiagnostic[] {
  const ref = catalogRef(catalog);
  const diagnostics: ProjectionDiagnostic[] = [];
  const seenRuleIds = new Set<string>();

  for (const rule of catalog.rules) {
    if (seenRuleIds.has(rule.ruleId)) {
      diagnostics.push(ruleDiagnostic(
        catalog,
        rule,
        "duplicate-rule-id",
        `ruleIdが重複しています: ${rule.ruleId}`,
      ));
    }
    seenRuleIds.add(rule.ruleId);

    if (rule.match.kind === "type" && rule.match.entailment === "rdfs-subproperty") {
      diagnostics.push(ruleDiagnostic(
        catalog,
        rule,
        "invalid-rule-entailment",
        "type matchにはrdfs-subpropertyを指定できません。",
      ));
    }
    if (rule.match.kind === "predicate" && rule.match.entailment === "rdfs-subclass") {
      diagnostics.push(ruleDiagnostic(
        catalog,
        rule,
        "invalid-rule-entailment",
        "predicate matchにはrdfs-subclassを指定できません。",
      ));
    }

    const targetKind = expectedTemplateKind(rule);
    if (targetKind && templateRequired(rule) && !rule.templateRef) {
      diagnostics.push(ruleDiagnostic(
        catalog,
        rule,
        "missing-rule-template-ref",
        `${rule.project.operator} ruleにはtemplateRefが必要です。`,
      ));
    }
    if (rule.templateRef) {
      validateTemplateReference(catalog, rule, targetKind, diagnostics);
    }

    if (!operatorSupportsMatch(rule)) {
      diagnostics.push(ruleDiagnostic(
        catalog,
        rule,
        "operator-match-mismatch",
        `${rule.project.operator}は${rule.match.kind} matchへ適用できません。`,
      ));
    }
  }

  if (!catalog.defaults) {
    diagnostics.push({
      severity: "error",
      code: "missing-catalog-defaults",
      message: `単独projectionに必要なdefaultsがありません: ${ref}`,
      catalogRef: ref,
    });
  } else {
    validateDefaultTemplate(catalog, catalog.defaults.nodeTemplateRef, "node", diagnostics);
    validateDefaultTemplate(catalog, catalog.defaults.edgeTemplateRef, "edge", diagnostics);
  }
  return diagnostics;
}

function resolveCandidates(
  candidates: readonly ResolvedProjectionRule[],
  semanticRef: string,
): RuleResolution {
  const ordered = [...candidates].sort(compareCandidates);
  const first = ordered[0];
  const second = ordered[1];
  if (!first) return { diagnostics: [] };
  if (second && sameRank(first, second)) {
    const ruleNames = [first, second]
      .map((candidate) => `${candidate.catalogRef}#${candidate.rule.ruleId}`)
      .sort(compareCodePoints)
      .join(", ");
    return {
      diagnostics: [{
        severity: "error",
        code: "ambiguous-projection-rule",
        message: `同順位のprojection ruleが競合しています: ${ruleNames}`,
        semanticRef,
      }],
    };
  }
  return { resolved: first, diagnostics: [] };
}

function typeDistance(
  assertedType: string,
  rule: ProjectionRule,
  closure: RdfsClosure,
): number | undefined {
  if (rule.match.kind !== "type") return undefined;
  if (rule.match.entailment === "exact") {
    return assertedType === rule.match.iri ? 0 : undefined;
  }
  if (rule.match.entailment === "rdfs-subclass") {
    return closure.subclassDistance(assertedType, rule.match.iri);
  }
  return undefined;
}

function predicateDistance(
  predicateIri: string,
  rule: ProjectionRule,
  closure: RdfsClosure,
): number | undefined {
  if (rule.match.kind !== "predicate") return undefined;
  if (rule.match.entailment === "exact") {
    return predicateIri === rule.match.iri ? 0 : undefined;
  }
  if (rule.match.entailment === "rdfs-subproperty") {
    return closure.subpropertyDistance(predicateIri, rule.match.iri);
  }
  return undefined;
}

function candidateFor(
  catalog: ProjectionCatalogV1,
  rule: ProjectionRule,
  distance: number,
  matchedIri?: string,
): ResolvedProjectionRule {
  return {
    catalogRef: catalogRef(catalog),
    rule,
    matchedIri,
    specificity: rule.match.kind === "any-iri-object"
      ? "wildcard"
      : distance === 0 ? "exact" : "entailed",
    distance,
  };
}

/** Negative means left wins. No lexical tie-break is intentionally applied. */
function compareCandidates(
  left: ResolvedProjectionRule,
  right: ResolvedProjectionRule,
): number {
  return right.rule.priority - left.rule.priority
    || specificityRank(right.specificity) - specificityRank(left.specificity)
    || left.distance - right.distance;
}

function sameRank(left: ResolvedProjectionRule, right: ResolvedProjectionRule): boolean {
  return left.rule.priority === right.rule.priority
    && left.specificity === right.specificity
    && left.distance === right.distance;
}

function specificityRank(value: ResolvedProjectionRule["specificity"]): number {
  return value === "exact" ? 2 : value === "entailed" ? 1 : 0;
}

function operatorSupportsMatch(rule: ProjectionRule): boolean {
  const matchKind = rule.match.kind;
  switch (rule.project.operator) {
    case "resource":
    case "membership-container":
    case "ordinal-sequence":
    case "alternative":
      return matchKind === "type";
    case "direct-edge":
      return matchKind === "predicate" || matchKind === "any-iri-object";
    case "suppress":
      return matchKind === "type" || matchKind === "predicate";
  }
}

function expectedTemplateKind(
  rule: ProjectionRule,
): VisualTemplate["structuralKind"] | undefined {
  switch (rule.project.operator) {
    case "resource":
      return rule.project.structuralKind;
    case "membership-container":
      return "container";
    case "alternative":
      return "node";
    case "direct-edge":
    case "ordinal-sequence":
      return "edge";
    case "suppress":
      return undefined;
  }
}

function templateRequired(rule: ProjectionRule): boolean {
  return rule.project.operator !== "ordinal-sequence"
    && rule.project.operator !== "suppress";
}

function validateTemplateReference(
  catalog: ProjectionCatalogV1,
  rule: ProjectionRule,
  expectedKind: VisualTemplate["structuralKind"] | undefined,
  diagnostics: ProjectionDiagnostic[],
): void {
  const template = catalog.templates[rule.templateRef!];
  if (!template) {
    diagnostics.push(ruleDiagnostic(
      catalog,
      rule,
      "missing-rule-template",
      `ruleのtemplateがありません: ${rule.templateRef}`,
    ));
  } else if (expectedKind && template.structuralKind !== expectedKind) {
    diagnostics.push(ruleDiagnostic(
      catalog,
      rule,
      "template-kind-mismatch",
      `${rule.templateRef}は${expectedKind} templateではありません。`,
    ));
  }
}

function validateDefaultTemplate(
  catalog: ProjectionCatalogV1,
  templateRef: string,
  expectedKind: "node" | "edge",
  diagnostics: ProjectionDiagnostic[],
): void {
  const template = catalog.templates[templateRef];
  if (!template) {
    diagnostics.push({
      severity: "error",
      code: "missing-default-template",
      message: `default ${expectedKind} templateがありません: ${templateRef}`,
      catalogRef: catalogRef(catalog),
    });
  } else if (template.structuralKind !== expectedKind) {
    diagnostics.push({
      severity: "error",
      code: "template-kind-mismatch",
      message: `${templateRef}は${expectedKind} templateではありません。`,
      catalogRef: catalogRef(catalog),
    });
  }
}

function ruleDiagnostic(
  catalog: ProjectionCatalogV1,
  rule: ProjectionRule,
  code: string,
  message: string,
): ProjectionDiagnostic {
  return {
    severity: "error",
    code,
    message,
    catalogRef: catalogRef(catalog),
    ruleId: rule.ruleId,
  };
}
