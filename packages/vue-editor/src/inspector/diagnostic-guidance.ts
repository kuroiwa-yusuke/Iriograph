import type { ProjectionDiagnostic } from "@iriograph/core";

import {
  translateEditorMessage,
  type EditorMessageKey,
  type EditorTranslator,
} from "../localization/editor-localization";

export type DiagnosticGuidance = {
  title: string;
  action: string;
  detail: string;
};

type GuidanceMessageKeys = {
  title: EditorMessageKey;
  action: EditorMessageKey;
};

const GUIDANCE: Readonly<Record<string, GuidanceMessageKeys>> = {
  "term-minting-denied": diagnosticKeys("term-minting-denied"),
  "authoring-structure-config-unresolved": diagnosticKeys("authoring-structure-config-unresolved"),
  "resource-namespace-denied": diagnosticKeys("resource-namespace-denied"),
  "resource-iri-collision": diagnosticKeys("resource-iri-collision"),
  "unknown-term-introduced": diagnosticKeys("unknown-term-introduced"),
  "authoring-term-role-invalid": diagnosticKeys("authoring-term-role-invalid"),
  "structural-predicate-property-edit-denied": diagnosticKeys("structural-predicate-property-edit-denied"),
  "structural-predicate-edge-edit-denied": diagnosticKeys("structural-predicate-edge-edit-denied"),
  "create-resource-initial-statement-required": diagnosticKeys("create-resource-initial-statement-required"),
  "edge-predicate-required": diagnosticKeys("edge-predicate-required"),
  "authoring-iri-invalid": diagnosticKeys("authoring-iri-invalid"),
  "ordinal-prefix-invalid": diagnosticKeys("ordinal-prefix-invalid"),
  "alternative-too-few-members": diagnosticKeys("alternative-too-few-members"),
  "alternative-default-ordinal-invalid": diagnosticKeys("alternative-default-ordinal-invalid"),
  "sequence-empty": diagnosticKeys("sequence-empty"),
  "resource-delete-referenced": diagnosticKeys("resource-delete-referenced"),
  "authoring-noop": diagnosticKeys("authoring-noop"),
  "document-json-invalid": diagnosticKeys("document-json-invalid"),
  "document-schema-invalid": diagnosticKeys("document-schema-invalid"),
  "document-replace-stale-revision": diagnosticKeys("document-replace-stale-revision"),
  "document-replace-stale-document": diagnosticKeys("document-replace-stale-document"),
  "document-rebase-id-invalid": diagnosticKeys("document-rebase-id-invalid"),
  "document-rebase-base-invalid": diagnosticKeys("document-rebase-base-invalid"),
  "document-rebase-iri-collision": diagnosticKeys("document-rebase-iri-collision"),
  "document-rebase-overlay-collision": diagnosticKeys("document-rebase-overlay-collision"),
};

const defaultTranslator: EditorTranslator = (key, parameters) => (
  translateEditorMessage("en", key, parameters)
);

export function diagnosticGuidance(
  diagnostic: ProjectionDiagnostic,
  translator: EditorTranslator = defaultTranslator,
): DiagnosticGuidance {
  const known = GUIDANCE[diagnostic.code];
  if (known) {
    return {
      title: translator(known.title),
      action: translator(known.action),
      detail: diagnosticLocator(diagnostic, translator),
    };
  }
  if (diagnostic.category === "syntax") {
    return {
      title: translator("diagnostic.syntax.title"),
      action: translator("diagnostic.syntax.action"),
      detail: diagnosticLocator(diagnostic, translator),
    };
  }
  if (diagnostic.category === "layout") {
    return {
      title: translator("diagnostic.layout.title"),
      action: translator("diagnostic.layout.action"),
      detail: diagnosticLocator(diagnostic, translator),
    };
  }
  return {
    title: translator(diagnostic.severity === "warning"
      ? "diagnostic.default.warningTitle"
      : "diagnostic.default.errorTitle"),
    action: translator("diagnostic.default.action"),
    detail: diagnosticLocator(diagnostic, translator),
  };
}

/**
 * Core diagnostics intentionally retain machine identities in `message` for
 * logging and host integration. The normal editor must not turn that internal
 * message into presentation data. Point the user at a stable, non-semantic
 * location instead.
 */
function diagnosticLocator(
  diagnostic: ProjectionDiagnostic,
  translator: EditorTranslator,
): string {
  const code = safeCode(diagnostic.code);
  if (diagnostic.sourceLocation) {
    return translator("diagnostic.locator.source", {
      line: diagnostic.sourceLocation.startLine,
      column: diagnostic.sourceLocation.startColumn,
      code,
    });
  }
  if (diagnostic.jsonPointer) {
    const pointer = /(?:https?:|urn:)/iu.test(diagnostic.jsonPointer)
      ? translator("diagnostic.locator.targetItem")
      : diagnostic.jsonPointer;
    return translator("diagnostic.locator.document", { pointer, code });
  }
  return translator("diagnostic.locator.code", { code });
}

function diagnosticKeys(code: KnownDiagnosticCode): GuidanceMessageKeys {
  return {
    title: `diagnostic.${code}.title`,
    action: `diagnostic.${code}.action`,
  };
}

type KnownDiagnosticCode =
  | "term-minting-denied"
  | "authoring-structure-config-unresolved"
  | "resource-namespace-denied"
  | "resource-iri-collision"
  | "unknown-term-introduced"
  | "authoring-term-role-invalid"
  | "structural-predicate-property-edit-denied"
  | "structural-predicate-edge-edit-denied"
  | "create-resource-initial-statement-required"
  | "edge-predicate-required"
  | "authoring-iri-invalid"
  | "ordinal-prefix-invalid"
  | "alternative-too-few-members"
  | "alternative-default-ordinal-invalid"
  | "sequence-empty"
  | "resource-delete-referenced"
  | "authoring-noop"
  | "document-json-invalid"
  | "document-schema-invalid"
  | "document-replace-stale-revision"
  | "document-replace-stale-document"
  | "document-rebase-id-invalid"
  | "document-rebase-base-invalid"
  | "document-rebase-iri-collision"
  | "document-rebase-overlay-collision";

function safeCode(code: string): string {
  return /^[a-z0-9][a-z0-9-]*$/u.test(code) ? code : "unknown-diagnostic";
}
