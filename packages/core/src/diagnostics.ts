import type { ProjectionDiagnostic } from "./model";
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
      || compareOptional(left.message, right.message);
  });
}

export function hasBlockingDiagnostics(
  diagnostics: readonly ProjectionDiagnostic[],
): boolean {
  return diagnostics.some((diagnostic) => diagnostic.severity === "error");
}

function compareOptional(left: string | undefined, right: string | undefined): number {
  return compareCodePoints(left ?? "", right ?? "");
}
