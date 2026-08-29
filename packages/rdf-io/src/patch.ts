import type { Quad } from "n3";

import {
  asRdfDataset,
  createRdfDataset,
  patchBody,
  fingerprintText,
  quadKey,
  sortDiagnostics,
  validateDataset,
} from "./dataset.js";
import type {
  ApplySemanticPatchResult,
  AtomicSemanticPatch,
  RdfDataset,
  RdfIoDiagnostic,
} from "./model.js";

/** Applies all additions/removals or returns the exact original dataset. */
export function applySemanticPatch(
  currentInput: RdfDataset | readonly Quad[],
  patch: AtomicSemanticPatch,
): ApplySemanticPatchResult {
  const current = asRdfDataset(currentInput);
  const diagnostics: RdfIoDiagnostic[] = [];
  if (patch.kind !== "iriograph.semantic-patch.v1") {
    diagnostics.push(error("semantic-patch-kind-invalid", "The semantic patch kind is unsupported."));
  }
  if (current.fingerprint !== patch.baseFingerprint) {
    diagnostics.push(error("semantic-patch-stale-base", "The current RDF dataset differs from the patch base."));
  }
  const expectedIntegrity = fingerprintText(patchBody(
    patch.baseFingerprint,
    patch.candidateFingerprint,
    patch.additions,
    patch.removals,
  ));
  if (expectedIntegrity !== patch.integrity) {
    diagnostics.push(error("semantic-patch-integrity-mismatch", "The semantic patch fields differ from the candidate preview."));
  }
  const currentKeys = new Set(current.quads.map(quadKey));
  for (const removal of patch.removals) {
    if (!currentKeys.has(quadKey(removal))) {
      diagnostics.push(error("semantic-patch-removal-missing", "A statement selected for removal is absent from the current dataset."));
    }
  }
  if (diagnostics.length > 0) {
    return { accepted: false, dataset: current, diagnostics: sortDiagnostics(diagnostics) };
  }

  const removalKeys = new Set(patch.removals.map(quadKey));
  const candidate = createRdfDataset([
    ...current.quads.filter((statement) => !removalKeys.has(quadKey(statement))),
    ...patch.additions,
  ]);
  diagnostics.push(...validateDataset(candidate));
  if (candidate.fingerprint !== patch.candidateFingerprint) {
    diagnostics.push(error("semantic-patch-candidate-mismatch", "Applying the patch did not produce the previewed RDF dataset."));
  }
  if (diagnostics.some(({ severity }) => severity === "error")) {
    return { accepted: false, dataset: current, diagnostics: sortDiagnostics(diagnostics) };
  }
  return { accepted: true, dataset: candidate, diagnostics: [] };
}

function error(code: string, message: string): RdfIoDiagnostic {
  return { severity: "error", code, message };
}
