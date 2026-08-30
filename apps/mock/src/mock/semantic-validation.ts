import type {
  ResolvedSemanticValidationContext,
  SemanticValidationFinding,
  SemanticValidationRequest,
  SemanticValidationResponse,
} from "@iriograph/core";

import { translateMockMessage, type MockLocale } from "./localization";

const DEMO = "urn:iriograph:demo:";
const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const RDF_BAG = "http://www.w3.org/1999/02/22-rdf-syntax-ns#Bag";
const RDFS_LABEL = "http://www.w3.org/2000/01/rdf-schema#label";
const RDFS_MEMBER = "http://www.w3.org/2000/01/rdf-schema#member";
const DEMO_AUDIT_MEMBER = `${DEMO}p-03`;

/** Static fixture adapter: demonstrates the port without adding a SHACL engine dependency. */
export function createMockSemanticValidationContext(
  locale: MockLocale = "en",
): ResolvedSemanticValidationContext {
  return {
    contextId: "urn:iriograph:mock:semantic-validation",
    contextRevision: `1:${locale}`,
    validator: {
      async validate(request, signal) {
        if (signal.aborted) throw new DOMException("Aborted", "AbortError");
        return responseFor(request, validateRequiredLabels(request, locale));
      },
    },
  };
}

export const mockSemanticValidationContext = createMockSemanticValidationContext();

function validateRequiredLabels(
  request: SemanticValidationRequest,
  locale: MockLocale,
): SemanticValidationFinding[] {
  const labelRequired = new Set<string>();
  for (const statement of request.dataset.statements) {
    if (
      statement.subject.termType === "NamedNode"
      && statement.subject.value.startsWith(DEMO)
      && statement.predicate.value === RDF_TYPE
      && statement.object.termType === "NamedNode"
      && statement.object.value === RDF_BAG
    ) labelRequired.add(statement.subject.value);
    if (
      (statement.predicate.value === RDFS_MEMBER || statement.predicate.value === DEMO_AUDIT_MEMBER)
      && statement.object.termType === "NamedNode"
      && statement.object.value.startsWith(DEMO)
    ) labelRequired.add(statement.object.value);
  }
  return [...labelRequired].sort(compareText).flatMap((semanticRef) => {
    const hasLabel = request.dataset.statements.some((candidate) => (
      candidate.subject.termType === "NamedNode"
      && candidate.subject.value === semanticRef
      && candidate.predicate.value === RDFS_LABEL
      && candidate.object.termType === "Literal"
      && candidate.object.value.trim().length > 0
    ));
    if (hasLabel) return [];
    const sourceRange = locateResource(request.source, semanticRef);
    return [{
      findingId: `required-label:${semanticRef}`,
      severity: "error",
      code: "demo-visible-resource-label-required",
      message: translateMockMessage(locale, "requiredLabel"),
      semanticRef,
      sourceRange,
    }];
  });
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function responseFor(
  request: SemanticValidationRequest,
  findings: readonly SemanticValidationFinding[],
): SemanticValidationResponse {
  return {
    contextId: request.contextId,
    contextRevision: request.contextRevision,
    sourceFingerprint: request.sourceFingerprint,
    datasetFingerprint: request.datasetFingerprint,
    findings,
  };
}

function locateResource(
  source: string,
  semanticRef: string,
): { startOffset: number; endOffset: number } | undefined {
  const explicit = `<${semanticRef}>`;
  const explicitOffset = source.indexOf(explicit);
  if (explicitOffset >= 0) {
    return { startOffset: explicitOffset, endOffset: explicitOffset + explicit.length };
  }
  for (const match of source.matchAll(/@prefix\s+([A-Za-z][A-Za-z0-9_-]*|):\s*<([^>]*)>\s*\./gu)) {
    const prefix = match[1] ?? "";
    const namespace = match[2] ?? "";
    if (!semanticRef.startsWith(namespace)) continue;
    const localName = semanticRef.slice(namespace.length);
    if (!/^[A-Za-z_][A-Za-z0-9._~-]*$/u.test(localName)) return undefined;
    const token = `${prefix}:${localName}`;
    const tokenPattern = new RegExp(`(?:^|[\\s;,\\[])(${escapeRegExp(token)})(?=$|[\\s;,.\\]])`, "mu");
    const tokenMatch = tokenPattern.exec(source);
    if (!tokenMatch || tokenMatch.index === undefined) return undefined;
    const startOffset = tokenMatch.index + tokenMatch[0].length - token.length;
    return { startOffset, endOffset: startOffset + token.length };
  }
  return undefined;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
