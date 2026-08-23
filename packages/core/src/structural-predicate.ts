import type { ProjectionCatalogV1 } from "./model.js";
import { parseOrdinal } from "./profile-validation.js";
import type { RdfsClosure } from "./rdfs-closure.js";
import { compareCodePoints } from "./rdf.js";

export type StructuralPredicateMatch = {
  ruleId: string;
  operator: "membership-container" | "membership-region" | "ordinal-sequence" | "alternative";
  kind: "membership" | "ordinal";
  configuredPredicate: string;
  ordinal?: number;
};

/**
 * Catalog-driven classification for inspectors and authoring surfaces.
 * All matches are returned because one ordinal predicate may legitimately be
 * understood by multiple structure rules; callers must not guess one by order.
 */
export function classifyStructuralPredicate(
  predicateIri: string,
  catalog: ProjectionCatalogV1,
  closure: RdfsClosure,
): StructuralPredicateMatch[] {
  const matches: StructuralPredicateMatch[] = [];
  for (const rule of catalog.rules) {
    const operator = rule.project;
    if (operator.operator === "membership-container" || operator.operator === "membership-region") {
      if (closure.subpropertyDistance(predicateIri, operator.membershipPredicate) === undefined) continue;
      matches.push({
        ruleId: rule.ruleId,
        operator: operator.operator,
        kind: "membership",
        configuredPredicate: operator.membershipPredicate,
      });
    } else if (operator.operator === "ordinal-sequence" || operator.operator === "alternative") {
      const ordinal = parseOrdinal(predicateIri, operator.ordinalPredicatePrefix);
      if (ordinal === undefined) continue;
      matches.push({
        ruleId: rule.ruleId,
        operator: operator.operator,
        kind: "ordinal",
        configuredPredicate: operator.ordinalPredicatePrefix,
        ordinal,
      });
    }
  }
  return matches.sort((left, right) => (
    compareCodePoints(left.ruleId, right.ruleId)
    || compareCodePoints(left.operator, right.operator)
  ));
}

export function isStructuralPredicate(
  predicateIri: string,
  catalog: ProjectionCatalogV1,
  closure: RdfsClosure,
): boolean {
  return classifyStructuralPredicate(predicateIri, catalog, closure).length > 0;
}

/** Explicitly named alias for consumers that classify an IRI rather than a statement. */
export const isStructuralPredicateIri = isStructuralPredicate;
