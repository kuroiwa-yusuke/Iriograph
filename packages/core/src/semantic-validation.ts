import type { IriographDocument, ProjectionDiagnostic } from "./model.js";
import { statementIdentityFromQuad } from "./identity.js";
import { canonicalQuad, canonicalTerm, parseSemanticGraph } from "./rdf.js";
import { sortDiagnostics } from "./diagnostics.js";
import type { Term } from "n3";

export type SemanticValidationTerm = {
  termType: "NamedNode" | "BlankNode" | "Literal" | "DefaultGraph";
  value: string;
  language?: string;
  datatypeIri?: string;
};

export type SemanticValidationStatement = {
  statementRef: string;
  subject: SemanticValidationTerm;
  predicate: SemanticValidationTerm;
  object: SemanticValidationTerm;
  graph: SemanticValidationTerm;
};

export type SemanticValidationDataset = {
  datasetFingerprint: string;
  statements: readonly SemanticValidationStatement[];
};

export type SemanticValidationRequest = {
  contextId: string;
  contextRevision: string;
  sourceFingerprint: string;
  datasetFingerprint: string;
  source: string;
  dataset: SemanticValidationDataset;
};

export type SemanticValidationFinding = {
  /** Validator-owned identity for one constraint result within the resolved context. */
  findingId: string;
  severity: "info" | "warning" | "error";
  code: string;
  message: string;
  semanticRef?: string;
  statementRef?: string;
  sourceRange?: { startOffset: number; endOffset: number };
};

export type SemanticValidationResponse = {
  contextId: string;
  contextRevision: string;
  sourceFingerprint: string;
  datasetFingerprint: string;
  findings: readonly SemanticValidationFinding[];
};

/** Engine-independent, host-injected boundary. Implementations may use SHACL or any other engine. */
export interface SemanticValidationPort {
  validate(
    request: SemanticValidationRequest,
    signal: AbortSignal,
  ): Promise<SemanticValidationResponse>;
}

export type ResolvedSemanticValidationContext = {
  contextId: string;
  contextRevision: string;
  validator: SemanticValidationPort;
};

export type SemanticWarningConfirmation = {
  confirmationId: string;
  contextId: string;
  contextRevision: string;
  sourceFingerprint: string;
  diagnosticIds: readonly string[];
};

export type SemanticValidationRun = {
  aborted?: boolean;
  sourceFingerprint: string;
  datasetFingerprint?: string;
  cacheKey?: string;
  diagnostics: ProjectionDiagnostic[];
  warningConfirmation?: SemanticWarningConfirmation;
};

export type SemanticValidationTransactionOptions = {
  validationContext?: ResolvedSemanticValidationContext;
  warningConfirmation?: SemanticWarningConfirmation;
  signal?: AbortSignal;
};

export function semanticSourceFingerprint(source: string): string {
  return `urn:iriograph:source-fingerprint:v1:${hash(source)}`;
}

export function semanticValidationCacheKey(
  context: Pick<ResolvedSemanticValidationContext, "contextId" | "contextRevision">,
  datasetFingerprint: string,
  sourceFingerprint: string,
): string {
  return `urn:iriograph:validation-cache:v1:${hash(stableJson([
    context.contextId,
    context.contextRevision,
    datasetFingerprint,
    sourceFingerprint,
  ]))}`;
}

export async function validateSemanticDocument(
  document: IriographDocument,
  context: ResolvedSemanticValidationContext | undefined,
  options: { signal?: AbortSignal } = {},
): Promise<SemanticValidationRun> {
  const sourceFingerprint = semanticSourceFingerprint(document.semantic.source);
  let graph;
  try {
    graph = parseSemanticGraph(document);
  } catch (cause) {
    return {
      sourceFingerprint,
      diagnostics: [{
        severity: "error",
        category: "syntax",
        code: "invalid-turtle",
        message: cause instanceof Error ? cause.message : String(cause),
        sourceFingerprint,
      }],
    };
  }

  const statements = graph.quads.map((quad) => ({
    statementRef: statementIdentityFromQuad(quad),
    subject: snapshotTerm(quad.subject),
    predicate: snapshotTerm(quad.predicate),
    object: snapshotTerm(quad.object),
    graph: snapshotTerm(quad.graph),
  }));
  const datasetFingerprint = `urn:iriograph:dataset-fingerprint:v1:${hash(
    graph.quads.map(canonicalQuad).join("\n"),
  )}`;
  const cacheKey = context
    ? semanticValidationCacheKey(context, datasetFingerprint, sourceFingerprint)
    : undefined;
  if (!context) return { sourceFingerprint, datasetFingerprint, cacheKey, diagnostics: [] };
  if (
    typeof context.contextId !== "string" || context.contextId.length === 0
    || typeof context.contextRevision !== "string" || context.contextRevision.length === 0
    || !context.validator || typeof context.validator.validate !== "function"
  ) {
    return failClosed(sourceFingerprint, datasetFingerprint, cacheKey, "semantic-validation-context-invalid", "Resolved semantic validation context is invalid.");
  }

  const request: SemanticValidationRequest = {
    contextId: context.contextId,
    contextRevision: context.contextRevision,
    sourceFingerprint,
    datasetFingerprint,
    source: document.semantic.source,
    dataset: { datasetFingerprint, statements },
  };
  const signal = options.signal ?? new AbortController().signal;
  if (signal.aborted) {
    return aborted(sourceFingerprint, datasetFingerprint, cacheKey);
  }

  let response: SemanticValidationResponse;
  try {
    response = await context.validator.validate(request, signal);
  } catch (cause) {
    if (signal.aborted) {
      return aborted(sourceFingerprint, datasetFingerprint, cacheKey);
    }
    return failClosed(
      sourceFingerprint,
      datasetFingerprint,
      cacheKey,
      "semantic-validation-adapter-failed",
      cause instanceof Error ? cause.message : "Semantic validation adapter failed.",
    );
  }
  if (signal.aborted) {
    return aborted(sourceFingerprint, datasetFingerprint, cacheKey);
  }
  if (!validEcho(response, request)) {
    return failClosed(sourceFingerprint, datasetFingerprint, cacheKey, "semantic-validation-echo-mismatch", "Semantic validation response does not match its request.");
  }

  const statementRefs = new Set(statements.map((statement) => statement.statementRef));
  if (!Array.isArray(response.findings) || !validFindings(response.findings, statementRefs, document.semantic.source.length)) {
    return failClosed(sourceFingerprint, datasetFingerprint, cacheKey, "semantic-validation-response-malformed", "Semantic validation response is malformed.");
  }
  const diagnostics = sortDiagnostics(response.findings.map((finding) => findingDiagnostic(
    finding,
    request,
    document.semantic.source,
    sourceFingerprint,
  )));
  const warnings = diagnostics.filter((diagnostic) => diagnostic.severity === "warning");
  return {
    sourceFingerprint,
    datasetFingerprint,
    cacheKey,
    diagnostics,
    warningConfirmation: warnings.length > 0
      ? createSemanticWarningConfirmation(request, sourceFingerprint, warnings)
      : undefined,
  };
}

export function matchesSemanticWarningConfirmation(
  expected: SemanticWarningConfirmation,
  actual: SemanticWarningConfirmation | undefined,
): boolean {
  if (!actual) return false;
  const normalized = createConfirmation(
    actual.contextId,
    actual.contextRevision,
    actual.sourceFingerprint,
    actual.diagnosticIds,
  );
  return actual.confirmationId === normalized.confirmationId
    && stableJson(actual) === stableJson(expected);
}

function createSemanticWarningConfirmation(
  context: Pick<ResolvedSemanticValidationContext, "contextId" | "contextRevision">,
  sourceFingerprint: string,
  warnings: readonly ProjectionDiagnostic[],
): SemanticWarningConfirmation {
  return createConfirmation(
    context.contextId,
    context.contextRevision,
    sourceFingerprint,
    warnings.map((diagnostic) => diagnostic.diagnosticId!),
  );
}

function createConfirmation(
  contextId: string,
  contextRevision: string,
  sourceFingerprint: string,
  diagnosticIds: readonly string[],
): SemanticWarningConfirmation {
  const sortedIds = [...diagnosticIds].sort(compareCodePoints);
  const core = { contextId, contextRevision, sourceFingerprint, diagnosticIds: sortedIds };
  return {
    confirmationId: `urn:iriograph:warning-confirmation:v1:${hash(stableJson(core))}`,
    ...core,
  };
}

function findingDiagnostic(
  finding: SemanticValidationFinding,
  context: Pick<ResolvedSemanticValidationContext, "contextId" | "contextRevision">,
  source: string,
  sourceFingerprint: string,
): ProjectionDiagnostic {
  const identity = [
    context.contextId,
    context.contextRevision,
    finding.findingId,
    finding.code,
    finding.semanticRef ?? "",
    finding.statementRef ?? "",
  ];
  return {
    diagnosticId: `urn:iriograph:diagnostic:v1:${hash(stableJson(identity))}`,
    severity: finding.severity,
    category: "domain",
    code: finding.code,
    message: finding.message,
    semanticRef: finding.semanticRef,
    statementRef: finding.statementRef,
    sourceFingerprint,
    sourceLocation: finding.sourceRange
      ? sourceLocation(source, finding.sourceRange.startOffset, finding.sourceRange.endOffset)
      : undefined,
  };
}

function validEcho(response: unknown, request: SemanticValidationRequest): response is SemanticValidationResponse {
  if (!response || typeof response !== "object") return false;
  const candidate = response as Partial<SemanticValidationResponse>;
  return candidate.contextId === request.contextId
    && candidate.contextRevision === request.contextRevision
    && candidate.sourceFingerprint === request.sourceFingerprint
    && candidate.datasetFingerprint === request.datasetFingerprint;
}

function validFindings(
  findings: readonly unknown[],
  statementRefs: ReadonlySet<string>,
  sourceLength: number,
): findings is readonly SemanticValidationFinding[] {
  const ids = new Set<string>();
  for (const value of findings) {
    if (!value || typeof value !== "object") return false;
    const finding = value as Partial<SemanticValidationFinding>;
    if (
      typeof finding.findingId !== "string" || finding.findingId.length === 0
      || ids.has(finding.findingId)
      || (finding.severity !== "info" && finding.severity !== "warning" && finding.severity !== "error")
      || typeof finding.code !== "string" || finding.code.length === 0
      || typeof finding.message !== "string" || finding.message.length === 0
      || (finding.semanticRef !== undefined && (typeof finding.semanticRef !== "string" || finding.semanticRef.length === 0))
      || (finding.statementRef !== undefined && !statementRefs.has(finding.statementRef))
      || (finding.sourceRange !== undefined && !validRange(finding.sourceRange, sourceLength))
    ) return false;
    ids.add(finding.findingId);
  }
  return true;
}

function validRange(value: unknown, sourceLength: number): value is { startOffset: number; endOffset: number } {
  if (!value || typeof value !== "object") return false;
  const range = value as { startOffset?: unknown; endOffset?: unknown };
  return Number.isSafeInteger(range.startOffset)
    && Number.isSafeInteger(range.endOffset)
    && (range.startOffset as number) >= 0
    && (range.endOffset as number) >= (range.startOffset as number)
    && (range.endOffset as number) <= sourceLength;
}

function sourceLocation(source: string, startOffset: number, endOffset: number) {
  const start = lineColumn(source, startOffset);
  const end = lineColumn(source, endOffset);
  return {
    startOffset,
    endOffset,
    startLine: start.line,
    startColumn: start.column,
    endLine: end.line,
    endColumn: end.column,
  };
}

function lineColumn(source: string, offset: number): { line: number; column: number } {
  const prefix = source.slice(0, offset);
  const lines = prefix.split("\n");
  return { line: lines.length, column: (lines.at(-1)?.length ?? 0) + 1 };
}

function snapshotTerm(term: Term): SemanticValidationTerm {
  if (term.termType === "Literal") {
    const literal = term as unknown as { value: string; language: string; datatype: { value: string } };
    return {
      termType: "Literal",
      value: literal.value,
      language: literal.language || undefined,
      datatypeIri: literal.datatype.value,
    };
  }
  if (term.termType === "NamedNode" || term.termType === "BlankNode" || term.termType === "DefaultGraph") {
    return { termType: term.termType, value: term.value };
  }
  throw new Error(`Unsupported RDF term in semantic validation snapshot: ${canonicalTerm(term)}`);
}

function failClosed(
  sourceFingerprint: string,
  datasetFingerprint: string,
  cacheKey: string | undefined,
  code: string,
  message: string,
): SemanticValidationRun {
  return {
    sourceFingerprint,
    datasetFingerprint,
    cacheKey,
    diagnostics: [{ severity: "error", category: "internal", code, message, sourceFingerprint }],
  };
}

function aborted(
  sourceFingerprint: string,
  datasetFingerprint: string,
  cacheKey: string | undefined,
): SemanticValidationRun {
  return { aborted: true, sourceFingerprint, datasetFingerprint, cacheKey, diagnostics: [] };
}

function hash(value: string): string {
  let state = 0xcbf29ce484222325n;
  for (let index = 0; index < value.length; index += 1) {
    state ^= BigInt(value.charCodeAt(index));
    state = BigInt.asUintN(64, state * 0x100000001b3n);
  }
  return state.toString(16).padStart(16, "0");
}

function stableJson(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => compareCodePoints(left, right))
      .map(([key, item]) => [key, stableValue(item)]));
  }
  return value;
}

function compareCodePoints(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
