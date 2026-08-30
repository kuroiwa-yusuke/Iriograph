import type {
  ProjectionCatalogV1,
  ProjectionDiagnostic,
  ProjectionRuleCandidateTrace,
  ProjectionRuleResolutionTrace,
  ProjectionRule,
  VisualTemplate,
} from "../document/model.js";
import { isSafeVisualStyleOverride } from "../view/appearance.js";
import type { RdfsClosure } from "../semantic/rdfs-closure.js";
import { compareCodePoints } from "../semantic/rdf.js";
import { catalogRef } from "./standard-catalog.js";

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
  trace: ProjectionRuleResolutionTrace;
};

/**
 * Explains cycles in the semantic RDFS hierarchy consulted by catalog rule
 * matching. Catalog rules themselves are a flat ordered set and do not form a
 * separate inheritance graph.
 */
export function hierarchyRuleResolutionDiagnostics(
  closure: RdfsClosure,
): ProjectionDiagnostic[] {
  return closure.diagnostics.map((diagnostic) => ({
    severity: "warning" as const,
    category: "projection" as const,
    code: diagnostic.code,
    semanticRef: diagnostic.path[0],
    message: `${diagnostic.kind === "class" ? "class" : "property"} hierarchy used for projection rule matching contains a cycle: ${diagnostic.path.join(" -> ")}`,
    suggestedActions: [{
      actionId: diagnostic.kind === "class"
        ? "break-subclass-entailment-cycle"
        : "break-subproperty-entailment-cycle",
      semanticRef: diagnostic.path[0],
      parameters: { path: [...diagnostic.path] },
    }],
  }));
}

export function resolveResourceRule(
  catalog: ProjectionCatalogV1,
  assertedTypes: readonly string[],
  closure: RdfsClosure,
  semanticRef: string,
): RuleResolution {
  return resolveCandidates(
    matchingResourceRuleCandidates(catalog, assertedTypes, closure),
    semanticRef,
    catalog.defaults?.nodeTemplateRef,
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
  objectKind: "iri" | "literal" = "iri",
): RuleResolution {
  const candidates: ResolvedProjectionRule[] = [];
  for (const rule of catalog.rules) {
    if ((rule.project.operator === "literal-annotation") !== (objectKind === "literal")) continue;
    if (rule.match.kind === "any-iri-object") {
      candidates.push(candidateFor(catalog, rule, Number.MAX_SAFE_INTEGER));
      continue;
    }
    if (rule.match.kind !== "predicate") continue;
    const distance = predicateDistance(predicateIri, rule, closure);
    if (distance === undefined) continue;
    candidates.push(candidateFor(catalog, rule, distance, predicateIri));
  }
  return resolveCandidates(candidates, semanticRef, catalog.defaults?.edgeTemplateRef);
}

export function validateProjectionCatalog(
  catalog: ProjectionCatalogV1,
): ProjectionDiagnostic[] {
  const ref = catalogRef(catalog);
  const diagnostics: ProjectionDiagnostic[] = [];
  const seenRuleIds = new Set<string>();

  for (const [templateRef, template] of Object.entries(catalog.templates)) {
    if (!isSafeVisualStyleOverride(template.style)) {
      diagnostics.push({
        severity: "error",
        code: "unsafe-template-style",
        message: `Template contains unsafe style values: ${templateRef}`,
        catalogRef: ref,
      });
    }
    const portIds = new Set<string>();
    for (const port of template.ports ?? []) {
      if (portIds.has(port.portId)) {
        diagnostics.push({
          severity: "error",
          code: "duplicate-template-port-id",
          message: `Duplicate template portId: ${templateRef}#${port.portId}`,
          catalogRef: ref,
        });
      }
      portIds.add(port.portId);
      if (!Number.isFinite(port.position) || port.position < 0 || port.position > 1) {
        diagnostics.push({
          severity: "error",
          code: "invalid-template-port-position",
          message: `Template port position must be between 0 and 1: ${templateRef}#${port.portId}`,
          catalogRef: ref,
        });
      }
    }
    if (
      (template.ports?.length ?? 0) > 0
      && (template.structuralKind === "edge" || template.structuralKind === "annotation")
    ) {
      diagnostics.push({
        severity: "error",
        code: "invalid-template-port-kind",
        message: `Ports cannot be declared on a template that is not a resource endpoint: ${templateRef}`,
        catalogRef: ref,
      });
    }
  }
  for (const [styleRef, style] of Object.entries(catalog.styles ?? {})) {
    if (isSafeVisualStyleOverride(style)) continue;
    diagnostics.push({
      severity: "error",
      code: "unsafe-style-preset",
      message: `Catalog style preset contains unsafe values: ${styleRef}`,
      catalogRef: ref,
    });
  }

  for (const rule of catalog.rules) {
    if (seenRuleIds.has(rule.ruleId)) {
      diagnostics.push(ruleDiagnostic(
        catalog,
        rule,
        "duplicate-rule-id",
        `Duplicate ruleId: ${rule.ruleId}`,
      ));
    }
    seenRuleIds.add(rule.ruleId);

    if (rule.match.kind === "type" && rule.match.entailment === "rdfs-subproperty") {
      diagnostics.push(ruleDiagnostic(
        catalog,
        rule,
        "invalid-rule-entailment",
        "rdfs-subproperty cannot be specified for a type match.",
      ));
    }
    if (rule.match.kind === "predicate" && rule.match.entailment === "rdfs-subclass") {
      diagnostics.push(ruleDiagnostic(
        catalog,
        rule,
        "invalid-rule-entailment",
        "rdfs-subclass cannot be specified for a predicate match.",
      ));
    }

    const targetKind = expectedTemplateKind(rule);
    if (targetKind && templateRequired(rule) && !rule.templateRef) {
      diagnostics.push(ruleDiagnostic(
        catalog,
        rule,
        "missing-rule-template-ref",
        `${rule.project.operator} rule requires templateRef.`,
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
        `${rule.project.operator} cannot be applied to a ${rule.match.kind} match.`,
      ));
    }
  }

  if (!catalog.defaults) {
    diagnostics.push({
      severity: "error",
      code: "missing-catalog-defaults",
      message: `Defaults required for standalone projection are missing: ${ref}`,
      catalogRef: ref,
    });
  } else {
    validateDefaultTemplate(catalog, catalog.defaults.nodeTemplateRef, "node", diagnostics);
    validateDefaultTemplate(catalog, catalog.defaults.edgeTemplateRef, "edge", diagnostics);
    if (catalog.defaults.regionTemplateRef) {
      validateDefaultTemplate(catalog, catalog.defaults.regionTemplateRef, "region", diagnostics);
    }
  }
  return diagnostics;
}

function resolveCandidates(
  candidates: readonly ResolvedProjectionRule[],
  semanticRef: string,
  fallbackTemplateRef: string | undefined,
): RuleResolution {
  const ordered = [...candidates].sort(compareCandidates);
  const first = ordered[0];
  const second = ordered[1];
  const candidateTrace = [...ordered]
    .sort((left, right) => compareCandidates(left, right) || compareCandidateIdentity(left, right))
    .map(traceCandidate);
  if (!first) {
    return {
      diagnostics: [],
      trace: {
        semanticRef,
        outcome: "fallback",
        candidates: [],
        fallback: {
          reason: "no-matching-rule",
          ...(fallbackTemplateRef ? {
            templateRef: fallbackTemplateRef,
            styleSource: "catalog-default-template" as const,
          } : {}),
        },
      },
    };
  }
  if (second && sameRank(first, second)) {
    const conflicts = ordered.filter((candidate) => sameRank(first, candidate));
    const ruleNames = conflicts
      .map((candidate) => `${candidate.catalogRef}#${candidate.rule.ruleId}`)
      .sort(compareCodePoints)
      .join(", ");
    return {
      diagnostics: [{
        severity: "error",
        code: "ambiguous-projection-rule",
        message: `Projection rules with equal rank conflict: ${ruleNames}`,
        semanticRef,
      }],
      trace: {
        semanticRef,
        outcome: "conflict",
        candidates: candidateTrace,
        conflicts: conflicts.map(traceCandidate).sort(compareTraceIdentity),
      },
    };
  }
  return {
    resolved: first,
    diagnostics: [],
    trace: {
      semanticRef,
      outcome: first.specificity === "wildcard" ? "fallback" : "resolved",
      candidates: candidateTrace,
      selected: traceCandidate(first),
      ...(first.specificity === "wildcard" ? {
        fallback: {
          reason: "wildcard-rule" as const,
          ...(first.rule.templateRef ? {
            templateRef: first.rule.templateRef,
            styleSource: "template" as const,
          } : {}),
        },
      } : {}),
    },
  };
}

function traceCandidate(candidate: ResolvedProjectionRule): ProjectionRuleCandidateTrace {
  const match = candidate.rule.match.kind === "any-iri-object"
    ? "wildcard"
    : candidate.distance === 0
      ? "exact"
      : candidate.rule.match.kind === "predicate"
        ? "explicit-subproperty"
        : "explicit-subclass";
  return {
    catalogRef: candidate.catalogRef,
    ruleId: candidate.rule.ruleId,
    priority: candidate.rule.priority,
    match,
    distance: candidate.distance,
    ...(candidate.matchedIri ? { matchedIri: candidate.matchedIri } : {}),
    ...(candidate.rule.templateRef ? {
      templateRef: candidate.rule.templateRef,
      styleSource: "template" as const,
    } : {}),
  };
}

function compareCandidateIdentity(
  left: ResolvedProjectionRule,
  right: ResolvedProjectionRule,
): number {
  return compareCodePoints(left.catalogRef, right.catalogRef)
    || compareCodePoints(left.rule.ruleId, right.rule.ruleId)
    || compareCodePoints(left.matchedIri ?? "", right.matchedIri ?? "");
}

function compareTraceIdentity(
  left: ProjectionRuleCandidateTrace,
  right: ProjectionRuleCandidateTrace,
): number {
  return compareCodePoints(left.catalogRef, right.catalogRef)
    || compareCodePoints(left.ruleId, right.ruleId)
    || compareCodePoints(left.matchedIri ?? "", right.matchedIri ?? "");
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
    case "membership-region":
    case "ordinal-sequence":
    case "alternative":
      return matchKind === "type";
    case "direct-edge":
      return matchKind === "predicate" || matchKind === "any-iri-object";
    case "literal-annotation":
      return matchKind === "predicate";
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
    case "membership-region":
      return "node";
    case "alternative":
      return "container";
    case "ordinal-sequence":
      return "container";
    case "direct-edge":
      return "edge";
    case "literal-annotation":
      return "annotation";
    case "suppress":
      return undefined;
  }
}

function templateRequired(rule: ProjectionRule): boolean {
  return rule.project.operator !== "suppress";
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
      `Rule template is missing: ${rule.templateRef}`,
    ));
  } else if (expectedKind && template.structuralKind !== expectedKind) {
    diagnostics.push(ruleDiagnostic(
      catalog,
      rule,
      "template-kind-mismatch",
      `${rule.templateRef} is not a ${expectedKind} template.`,
    ));
  }
}

function validateDefaultTemplate(
  catalog: ProjectionCatalogV1,
  templateRef: string,
  expectedKind: "node" | "edge" | "region",
  diagnostics: ProjectionDiagnostic[],
): void {
  const template = catalog.templates[templateRef];
  if (!template) {
    diagnostics.push({
      severity: "error",
      code: "missing-default-template",
      message: `Default ${expectedKind} template is missing: ${templateRef}`,
      catalogRef: catalogRef(catalog),
    });
  } else if (template.structuralKind !== expectedKind) {
    diagnostics.push({
      severity: "error",
      code: "template-kind-mismatch",
      message: `${templateRef} is not a ${expectedKind} template.`,
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
