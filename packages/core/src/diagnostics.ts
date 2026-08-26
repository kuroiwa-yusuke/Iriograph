import type {
  ProjectionDiagnostic,
  SceneContainer,
  SceneEdge,
  SceneNode,
  SceneRegion,
} from "./model.js";
import { compareCodePoints } from "./rdf.js";

const severityOrder: Record<ProjectionDiagnostic["severity"], number> = {
  error: 0,
  warning: 1,
  info: 2,
};

export function sortDiagnostics(
  diagnostics: readonly ProjectionDiagnostic[],
): ProjectionDiagnostic[] {
  return [...diagnostics].sort((left, right) => {
    return severityOrder[left.severity] - severityOrder[right.severity]
      || compareOptional(left.code, right.code)
      || compareOptional(left.catalogRef, right.catalogRef)
      || compareOptional(left.ruleId, right.ruleId)
      || compareOptional(left.assetRef, right.assetRef)
      || compareOptional(left.semanticRef, right.semanticRef)
      || compareOptional(left.statementRef, right.statementRef)
      || compareOptional(left.diagnosticId, right.diagnosticId)
      || compareOptional(left.message, right.message);
  });
}

export function hasBlockingDiagnostics(
  diagnostics: readonly ProjectionDiagnostic[],
): boolean {
  return diagnostics.some((diagnostic) => diagnostic.severity === "error");
}

const BLOCKING_SPATIAL_CODES = new Set([
  "region-membership-intersection-empty",
  "region-member-outside-intersection",
  "region-member-outside",
]);

/**
 * Overlay write/replace ports use this stricter policy. Layout may surface the
 * same condition as a warning while editing, but a persisted candidate cannot
 * violate an asserted spatial membership.
 */
export function enforceSpatialIntegrity(
  diagnostics: readonly ProjectionDiagnostic[],
): ProjectionDiagnostic[] {
  return diagnostics.map((diagnostic) => (
    BLOCKING_SPATIAL_CODES.has(diagnostic.code)
      ? { ...diagnostic, severity: "error" as const }
      : { ...diagnostic }
  ));
}

export function isSpatialIntegrityDiagnostic(diagnostic: ProjectionDiagnostic): boolean {
  return BLOCKING_SPATIAL_CODES.has(diagnostic.code);
}

/** Matches both direct semantic identity and every statement recorded by projection provenance. */
export function diagnosticTargetsSceneElement(
  diagnostic: ProjectionDiagnostic,
  element: SceneNode | SceneContainer | SceneRegion | SceneEdge,
): boolean {
  if (diagnostic.semanticRef === element.semanticRef) return true;
  if (!diagnostic.statementRef) return false;
  return diagnostic.statementRef === element.semanticRef
    || element.provenance?.sourceStatementRefs.includes(diagnostic.statementRef) === true
    || ((element.structuralKind === "node" || element.structuralKind === "container")
      && element.parentProvenance?.sourceStatementRefs.includes(diagnostic.statementRef) === true);
}

function compareOptional(left: string | undefined, right: string | undefined): number {
  return compareCodePoints(left ?? "", right ?? "");
}
