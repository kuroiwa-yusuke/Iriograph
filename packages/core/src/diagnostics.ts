import type {
  ProjectionDiagnostic,
  SceneContainer,
  SceneEdge,
  SceneNode,
} from "./model";
import { compareCodePoints } from "./rdf";

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

/** Matches both direct semantic identity and every statement recorded by projection provenance. */
export function diagnosticTargetsSceneElement(
  diagnostic: ProjectionDiagnostic,
  element: SceneNode | SceneContainer | SceneEdge,
): boolean {
  if (diagnostic.semanticRef === element.semanticRef) return true;
  if (!diagnostic.statementRef) return false;
  return diagnostic.statementRef === element.semanticRef
    || element.provenance?.sourceStatementRefs.includes(diagnostic.statementRef) === true
    || (element.structuralKind !== "edge"
      && element.parentProvenance?.sourceStatementRefs.includes(diagnostic.statementRef) === true);
}

function compareOptional(left: string | undefined, right: string | undefined): number {
  return compareCodePoints(left ?? "", right ?? "");
}
