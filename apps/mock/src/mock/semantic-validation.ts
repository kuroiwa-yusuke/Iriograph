import type {
  ResolvedSemanticValidationContext,
  SemanticValidationFinding,
  SemanticValidationRequest,
  SemanticValidationResponse,
} from "@iriograph/core";

const DEMO = "urn:iriograph:demo:";
const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const RDFS_LABEL = "http://www.w3.org/2000/01/rdf-schema#label";
const LABEL_REQUIRED_TYPES = new Set([
  `${DEMO}StartEvent`,
  `${DEMO}UserTask`,
  `${DEMO}ServiceTask`,
  `${DEMO}EndEvent`,
  `${DEMO}Reference`,
  `${DEMO}ExclusiveGateway`,
]);

/** Static fixture adapter: demonstrates the port without adding a SHACL engine dependency. */
export const mockSemanticValidationContext: ResolvedSemanticValidationContext = {
  contextId: "urn:iriograph:mock:semantic-validation",
  contextRevision: "1",
  validator: {
    async validate(request, signal) {
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      return responseFor(request, validateRequiredLabels(request));
    },
  },
};

function validateRequiredLabels(request: SemanticValidationRequest): SemanticValidationFinding[] {
  const typedResources = request.dataset.statements
    .filter((statement) => (
      statement.subject.termType === "NamedNode"
      && statement.predicate.value === RDF_TYPE
      && statement.object.termType === "NamedNode"
      && LABEL_REQUIRED_TYPES.has(statement.object.value)
    ));
  return typedResources.flatMap((statement) => {
    const semanticRef = statement.subject.value;
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
      code: "demo-label-required",
      message: "業務フロー要素には空でないrdfs:labelが必要です。",
      semanticRef,
      sourceRange,
    }];
  });
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
