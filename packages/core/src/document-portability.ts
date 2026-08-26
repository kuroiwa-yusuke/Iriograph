import { DataFactory, Parser, type Quad, type Term } from "n3";

import {
  enforceSpatialIntegrity,
  hasBlockingDiagnostics,
  sortDiagnostics,
} from "./diagnostics.js";
import { generatedElementId } from "./identity.js";
import type {
  DiagramScene,
  IriographDocument,
  IriographDocumentV1,
  ProjectionDiagnostic,
} from "./model.js";
import { compareCodePoints } from "./rdf.js";
import type { ProjectionRuntimeContext } from "./scene.js";
import { buildIriographView } from "./scene.js";
import {
  validateIriographDocumentV1,
  type RuntimeValidationIssue,
} from "./schema.js";
import {
  validateSemanticDocument,
  type ResolvedSemanticValidationContext,
} from "./semantic-validation.js";
import {
  serializeCanonicalTurtleV1,
  TURTLE_SERIALIZER_VERSION_V1,
} from "./serializer.js";

const SEMANTIC_IDENTITY_PREFIX = "urn:iriograph:semantic-ref:v1:";

export type PortableDocumentReplaceOptions = {
  /** Host-owned revision to which the preview and apply are bound. */
  documentRevision: string;
  semanticValidation?: ResolvedSemanticValidationContext;
  signal?: AbortSignal;
};

export type PortableDocumentReplacePreview = {
  valid: boolean;
  requiresConfirmation: true;
  confirmationId: string;
  baseRevision: string;
  baseDocumentFingerprint: string;
  candidateDocumentFingerprint?: string;
  /** A portable candidate snapshot. It is absent when JSON/schema validation failed. */
  candidate?: IriographDocumentV1;
  diagnostics: ProjectionDiagnostic[];
};

export type ApplyPortableDocumentReplaceOptions = {
  confirmationId: string;
  documentRevision: string;
  semanticValidation?: ResolvedSemanticValidationContext;
  signal?: AbortSignal;
};

export type PortableDocumentReplaceResult = {
  accepted: boolean;
  aborted?: boolean;
  document: IriographDocument;
  diagnostics: ProjectionDiagnostic[];
  scenes?: Record<string, DiagramScene>;
};

export type DocumentRebaseRequest = {
  documentId: string;
  baseIri: string;
};

export type DocumentRebaseChange = {
  from: string;
  to: string;
  occurrences: number;
};

export type DocumentRebasePreview = PortableDocumentReplacePreview & {
  rebase: {
    previousDocumentId: string;
    nextDocumentId: string;
    previousBaseIri: string;
    nextBaseIri: string;
    termChanges: readonly DocumentRebaseChange[];
    overlayReferenceChanges: number;
  };
};

/**
 * Parses and validates a complete portable document without mutating the
 * current document. Projection and spatial checks run for every candidate
 * view; one blocking result rejects the entire candidate.
 */
export async function previewPortableDocumentReplace(
  current: IriographDocument,
  candidateInput: string | unknown,
  context: ProjectionRuntimeContext,
  options: PortableDocumentReplaceOptions,
): Promise<PortableDocumentReplacePreview> {
  const baseDocumentFingerprint = documentFingerprint(current);
  const diagnostics: ProjectionDiagnostic[] = [];
  if (!options.documentRevision) {
    diagnostics.push(error(
      "document-replace-revision-required",
      "A host document revision is required.",
      "",
    ));
  }
  if (options.signal?.aborted) {
    return replacementPreview(options.documentRevision, baseDocumentFingerprint, undefined, [
      error("document-replace-aborted", "Document replacement preview was aborted.", ""),
    ]);
  }

  let parsed: unknown = candidateInput;
  if (typeof candidateInput === "string") {
    try {
      parsed = JSON.parse(candidateInput) as unknown;
    } catch (cause) {
      diagnostics.push(error(
        "document-json-invalid",
        cause instanceof Error ? cause.message : "Document JSON could not be parsed.",
        "",
      ));
      return replacementPreview(options.documentRevision, baseDocumentFingerprint, undefined, diagnostics);
    }
  }

  const schema = validateIriographDocumentV1(parsed);
  if (!schema.valid) {
    diagnostics.push(...schema.issues.map(schemaIssueDiagnostic));
    return replacementPreview(options.documentRevision, baseDocumentFingerprint, undefined, diagnostics);
  }
  const candidate = clone(schema.value);
  const semantic = await validateSemanticDocument(candidate, options.semanticValidation, {
    signal: options.signal,
  });
  if (semantic.aborted || options.signal?.aborted) {
    return replacementPreview(options.documentRevision, baseDocumentFingerprint, candidate, [
      ...diagnostics,
      error("document-replace-aborted", "Document replacement preview was aborted.", ""),
    ]);
  }
  diagnostics.push(...semantic.diagnostics.map((diagnostic) => (
    diagnostic.jsonPointer === undefined
      ? { ...diagnostic, jsonPointer: "/semantic/source" }
      : diagnostic
  )));

  if (!hasBlockingDiagnostics(diagnostics)) {
    for (let index = 0; index < candidate.views.length; index += 1) {
      if (options.signal?.aborted) break;
      const scene = await buildIriographView(candidate, candidate.views[index]!.viewId, context);
      diagnostics.push(...enforceSpatialIntegrity(scene.diagnostics).map((diagnostic) => (
        diagnosticForView(diagnostic, candidate, index)
      )));
    }
  }
  if (options.signal?.aborted) {
    diagnostics.push(error("document-replace-aborted", "Document replacement preview was aborted.", ""));
  }
  return replacementPreview(
    options.documentRevision,
    baseDocumentFingerprint,
    candidate,
    uniqueDiagnostics(diagnostics),
  );
}

/**
 * Applies only the candidate which was bound into the preview. The complete
 * validation pipeline is rerun so a serialized/tampered preview cannot bypass
 * schema, semantic, profile, or spatial checks.
 */
export async function applyPortableDocumentReplace(
  current: IriographDocument,
  preview: PortableDocumentReplacePreview,
  context: ProjectionRuntimeContext,
  options: ApplyPortableDocumentReplaceOptions,
): Promise<PortableDocumentReplaceResult> {
  const bindingDiagnostics: ProjectionDiagnostic[] = [];
  if (options.documentRevision !== preview.baseRevision) {
    bindingDiagnostics.push(error(
      "document-replace-stale-revision",
      "The host document revision has changed since preview.",
      "",
    ));
  }
  if (documentFingerprint(current) !== preview.baseDocumentFingerprint) {
    bindingDiagnostics.push(error(
      "document-replace-stale-document",
      "The current document has changed since preview.",
      "",
    ));
  }
  if (options.confirmationId !== preview.confirmationId) {
    bindingDiagnostics.push(error(
      "document-replace-confirmation-mismatch",
      "The confirmation ID does not match the replacement preview.",
      "",
    ));
  }
  if (!preview.valid || !preview.candidate || !preview.candidateDocumentFingerprint) {
    bindingDiagnostics.push(error(
      "document-replace-preview-invalid",
      "An invalid document replacement preview cannot be applied.",
      "",
    ));
  } else if (documentFingerprint(preview.candidate) !== preview.candidateDocumentFingerprint) {
    bindingDiagnostics.push(error(
      "document-replace-preview-tampered",
      "The replacement candidate differs from the confirmed preview.",
      "",
    ));
  }
  if (bindingDiagnostics.length > 0) return rejected(current, bindingDiagnostics);

  const rerun = await previewPortableDocumentReplace(current, preview.candidate!, context, {
    documentRevision: options.documentRevision,
    semanticValidation: options.semanticValidation,
    signal: options.signal,
  });
  if (
    !rerun.valid
    || rerun.confirmationId !== preview.confirmationId
    || rerun.candidateDocumentFingerprint !== preview.candidateDocumentFingerprint
    || !rerun.candidate
  ) {
    return rejected(current, rerun.diagnostics.length > 0 ? rerun.diagnostics : [error(
      "document-replace-preview-tampered",
      "The replacement preview no longer reproduces the confirmed candidate.",
      "",
    )]);
  }

  const scenes: Record<string, DiagramScene> = {};
  const diagnostics = [...rerun.diagnostics];
  for (let index = 0; index < rerun.candidate.views.length; index += 1) {
    if (options.signal?.aborted) return { ...rejected(current, diagnostics), aborted: true };
    const view = rerun.candidate.views[index]!;
    const scene = await buildIriographView(rerun.candidate, view.viewId, context);
    const validatedSceneDiagnostics = enforceSpatialIntegrity(scene.diagnostics);
    diagnostics.push(...validatedSceneDiagnostics.map((diagnostic) => (
      diagnosticForView(diagnostic, rerun.candidate!, index)
    )));
    if (hasBlockingDiagnostics(validatedSceneDiagnostics)) return rejected(current, diagnostics);
    scenes[view.viewId] = scene;
  }
  return {
    accepted: true,
    document: clone(rerun.candidate),
    diagnostics: uniqueDiagnostics(diagnostics),
    scenes,
  };
}

/** Rewrites expanded local RDF terms and their derived overlay identities. */
export async function previewDocumentRebase(
  current: IriographDocumentV1,
  request: DocumentRebaseRequest,
  context: ProjectionRuntimeContext,
  options: PortableDocumentReplaceOptions,
): Promise<DocumentRebasePreview> {
  const transformed = transformDocumentNamespace(current, request);
  if (!transformed.candidate) {
    const base = replacementPreview(
      options.documentRevision,
      documentFingerprint(current),
      undefined,
      transformed.diagnostics,
    );
    return { ...base, rebase: transformed.rebase };
  }
  const replacement = await previewPortableDocumentReplace(
    current,
    transformed.candidate,
    context,
    options,
  );
  const diagnostics = uniqueDiagnostics([
    ...transformed.diagnostics,
    ...replacement.diagnostics,
  ]);
  const result = replacementPreview(
    options.documentRevision,
    documentFingerprint(current),
    transformed.candidate,
    diagnostics,
  );
  return { ...result, rebase: transformed.rebase };
}

export async function applyDocumentRebasePreview(
  current: IriographDocumentV1,
  preview: DocumentRebasePreview,
  context: ProjectionRuntimeContext,
  options: ApplyPortableDocumentReplaceOptions,
): Promise<PortableDocumentReplaceResult> {
  return applyPortableDocumentReplace(current, preview, context, options);
}

function transformDocumentNamespace(
  current: IriographDocumentV1,
  request: DocumentRebaseRequest,
): {
  candidate?: IriographDocumentV1;
  diagnostics: ProjectionDiagnostic[];
  rebase: DocumentRebasePreview["rebase"];
} {
  const previousBaseIri = current.semantic.baseIri;
  const emptyRebase: DocumentRebasePreview["rebase"] = {
    previousDocumentId: current.documentId,
    nextDocumentId: request.documentId,
    previousBaseIri,
    nextBaseIri: request.baseIri,
    termChanges: [],
    overlayReferenceChanges: 0,
  };
  const diagnostics: ProjectionDiagnostic[] = [];
  if (!request.documentId.trim()) {
    diagnostics.push(error("document-rebase-id-invalid", "The new documentId must not be empty.", "/documentId"));
  }
  if (!isAbsoluteIri(request.baseIri)) {
    diagnostics.push(error("document-rebase-base-invalid", "The new base IRI must be absolute.", "/semantic/baseIri"));
  }
  if (request.baseIri === previousBaseIri) {
    diagnostics.push({
      severity: "error",
      category: "structure",
      code: "document-rebase-base-unchanged",
      message: "新しい図として複製するには、現在と異なるbase IRIを発行してください。",
      jsonPointer: "/semantic/baseIri",
      suggestedActions: [{
        actionId: "allocate-new-document-base",
        parameters: { currentBaseIri: previousBaseIri },
      }],
    });
  }
  if (hasTerminalNamespaceDelimiter(previousBaseIri) !== hasTerminalNamespaceDelimiter(request.baseIri)) {
    diagnostics.push(error(
      "document-rebase-base-boundary-incompatible",
      "Old and new base IRIs must both use a terminal namespace delimiter, or both use explicit child/fragment boundaries.",
      "/semantic/baseIri",
    ));
  }
  if (current.documentId === request.documentId) {
    diagnostics.push(error(
      "document-rebase-id-unchanged",
      "A rebased copy requires a new host-allocated documentId.",
      "/documentId",
    ));
  }
  if (diagnostics.length > 0) return { diagnostics, rebase: emptyRebase };

  const prefixes: Record<string, string> = {};
  let quads: Quad[];
  try {
    quads = new Parser({ baseIRI: previousBaseIri, format: "text/turtle" }).parse(
      current.semantic.source,
      null,
      (prefix, iri) => { prefixes[prefix] = iri.value; },
    );
  } catch (cause) {
    return {
      diagnostics: [error(
        "document-rebase-source-invalid",
        cause instanceof Error ? cause.message : "The Turtle source could not be parsed.",
        "/semantic/source",
      )],
      rebase: emptyRebase,
    };
  }

  const occurrences = new Map<string, number>();
  const allNamedTerms = new Set<string>();
  for (const value of quads) {
    for (const term of [value.subject, value.predicate, value.object, value.graph]) {
      const iri = term.termType === "NamedNode"
        ? term.value
        : term.termType === "Literal" && !term.language
          ? term.datatype.value
          : undefined;
      if (!iri) continue;
      allNamedTerms.add(iri);
      if (ownsLocalIri(iri, previousBaseIri)) {
        occurrences.set(iri, (occurrences.get(iri) ?? 0) + 1);
      }
    }
  }
  const changes = [...occurrences].map(([from, count]) => ({
    from,
    to: `${request.baseIri}${from.slice(previousBaseIri.length)}`,
    occurrences: count,
  })).sort((left, right) => compareCodePoints(left.from, right.from));
  const sourcesByFinalTerm = new Map<string, string[]>();
  for (const source of [...allNamedTerms].sort(compareCodePoints)) {
    const finalTerm = rebaseLocalIri(source, previousBaseIri, request.baseIri);
    const sources = sourcesByFinalTerm.get(finalTerm) ?? [];
    sources.push(source);
    sourcesByFinalTerm.set(finalTerm, sources);
  }
  for (const [finalTerm, sources] of sourcesByFinalTerm) {
    if (sources.length > 1) {
      diagnostics.push(error(
        "document-rebase-iri-collision",
        `Rebasing would merge ${sources.join(", ")} into ${finalTerm}.`,
        "/semantic/source",
        finalTerm,
      ));
    }
  }
  const rebase = { ...emptyRebase, termChanges: changes };
  if (hasBlockingDiagnostics(diagnostics)) return { diagnostics, rebase };

  const rebasedQuads = quads.map((value) => DataFactory.quad(
    rebaseTerm(value.subject, previousBaseIri, request.baseIri),
    rebaseTerm(value.predicate, previousBaseIri, request.baseIri),
    rebaseTerm(value.object, previousBaseIri, request.baseIri),
    rebaseTerm(value.graph, previousBaseIri, request.baseIri),
  ));
  const rebasedPrefixes = Object.fromEntries(Object.entries(prefixes).map(([prefix, iri]) => [
    prefix,
    ownsLocalIri(iri, previousBaseIri)
      ? `${request.baseIri}${iri.slice(previousBaseIri.length)}`
      : iri,
  ]));
  const serialized = serializeCanonicalTurtleV1({
    serializerVersion: TURTLE_SERIALIZER_VERSION_V1,
    quads: rebasedQuads,
    baseIri: request.baseIri,
    prefixes: rebasedPrefixes,
  });
  if (!serialized.accepted) {
    return {
      diagnostics: serialized.diagnostics.map((diagnostic) => ({
        ...diagnostic,
        jsonPointer: "/semantic/source",
      })),
      rebase,
    };
  }

  const candidate = clone(current);
  candidate.documentId = request.documentId;
  candidate.semantic.baseIri = request.baseIri;
  candidate.semantic.source = serialized.source;
  let overlayReferenceChanges = 0;
  for (let viewIndex = 0; viewIndex < candidate.views.length; viewIndex += 1) {
    const view = candidate.views[viewIndex]!;
    const overlay: typeof view.overlay = {};
    const entries = Object.entries(view.overlay).sort(([left], [right]) => (
      compareCodePoints(left, right)
    ));
    const sourceRefsByFinalRef = new Map<string, Set<string>>();
    for (const [, entry] of entries) {
      const finalRef = rebaseSemanticRef(entry.semanticRef, previousBaseIri, request.baseIri);
      const sourceRefs = sourceRefsByFinalRef.get(finalRef) ?? new Set<string>();
      sourceRefs.add(entry.semanticRef);
      sourceRefsByFinalRef.set(finalRef, sourceRefs);
    }
    for (const [finalRef, sourceRefs] of sourceRefsByFinalRef) {
      if (sourceRefs.size < 2) continue;
      const firstEntry = entries.find(([, entry]) => sourceRefs.has(entry.semanticRef));
      diagnostics.push(error(
        "document-rebase-overlay-collision",
        `Rebasing would merge overlay references ${[...sourceRefs].join(", ")} into ${finalRef}.`,
        `/views/${viewIndex}/overlay/${escapeJsonPointer(firstEntry?.[0] ?? "")}`,
        finalRef,
      ));
    }
    for (const [elementId, entry] of entries) {
      const semanticRef = rebaseSemanticRef(entry.semanticRef, previousBaseIri, request.baseIri);
      if (semanticRef !== entry.semanticRef) overlayReferenceChanges += 1;
      const kind = generatedElementKind(elementId, entry.semanticRef);
      const nextElementId = kind ? generatedElementId(kind, semanticRef) : elementId;
      if (overlay[nextElementId]) {
        diagnostics.push(error(
          "document-rebase-overlay-collision",
          `Multiple overlay entries would use ${nextElementId}.`,
          `/views/${viewIndex}/overlay/${escapeJsonPointer(nextElementId)}`,
          semanticRef,
        ));
        continue;
      }
      overlay[nextElementId] = { ...clone(entry), semanticRef };
    }
    view.overlay = overlay;
  }
  return {
    ...(hasBlockingDiagnostics(diagnostics) ? {} : { candidate }),
    diagnostics,
    rebase: { ...rebase, overlayReferenceChanges },
  };
}

function rebaseTerm<T extends Term>(term: T, oldBase: string, nextBase: string): T {
  if (term.termType === "NamedNode" && ownsLocalIri(term.value, oldBase)) {
    return DataFactory.namedNode(`${nextBase}${term.value.slice(oldBase.length)}`) as T;
  }
  if (
    term.termType === "Literal"
    && !term.language
    && ownsLocalIri(term.datatype.value, oldBase)
  ) {
    return DataFactory.literal(
      term.value,
      DataFactory.namedNode(`${nextBase}${term.datatype.value.slice(oldBase.length)}`),
    ) as T;
  }
  return term;
}

function rebaseSemanticRef(value: string, oldBase: string, nextBase: string): string {
  if (ownsLocalIri(value, oldBase)) return `${nextBase}${value.slice(oldBase.length)}`;
  if (!value.startsWith(SEMANTIC_IDENTITY_PREFIX)) return value;
  const suffix = value.slice(SEMANTIC_IDENTITY_PREFIX.length);
  const separator = suffix.indexOf(":");
  if (separator < 0) return value;
  try {
    const kind = suffix.slice(0, separator);
    const decoded = JSON.parse(decodeURIComponent(suffix.slice(separator + 1))) as unknown;
    const rebased = rebaseIdentityPayload(kind, decoded, oldBase, nextBase);
    if (rebased === undefined) return value;
    return `${SEMANTIC_IDENTITY_PREFIX}${kind}:${encodeURIComponent(JSON.stringify(rebased))}`;
  } catch {
    return value;
  }
}

function rebaseIdentityPayload(
  kind: string,
  value: unknown,
  oldBase: string,
  nextBase: string,
): unknown | undefined {
  if (kind === "statement") {
    if (!Array.isArray(value)) return undefined;
    return value.map((term) => {
      if (!Array.isArray(term) || term.length !== 2 || typeof term[0] !== "string") return term;
      if (term[0] === "NamedNode" && typeof term[1] === "string") {
        return [term[0], rebaseLocalIri(term[1], oldBase, nextBase)];
      }
      if (term[0] === "Literal" && typeof term[1] === "string") {
        return [term[0], rebaseCanonicalLiteralDatatype(term[1], oldBase, nextBase)];
      }
      return term;
    });
  }
  if (kind === "sequence-transition" || kind === "alternative-branch") {
    if (!Array.isArray(value) || typeof value[0] !== "string") return undefined;
    return [rebaseLocalIri(value[0], oldBase, nextBase), ...value.slice(1)];
  }
  return undefined;
}

function rebaseLocalIri(value: string, oldBase: string, nextBase: string): string {
  return ownsLocalIri(value, oldBase) ? `${nextBase}${value.slice(oldBase.length)}` : value;
}

function rebaseCanonicalLiteralDatatype(value: string, oldBase: string, nextBase: string): string {
  const marker = "^^<";
  const markerIndex = value.lastIndexOf(marker);
  if (markerIndex < 0 || !value.endsWith(">")) return value;
  const datatype = value.slice(markerIndex + marker.length, -1);
  if (!ownsLocalIri(datatype, oldBase)) return value;
  return `${value.slice(0, markerIndex + marker.length)}${nextBase}${datatype.slice(oldBase.length)}>`;
}

/**
 * Prefix ownership is safe only for delimiter-terminated namespaces. For a
 * document IRI such as `/doc`, accept the exact IRI and explicit child/fragment
 * boundaries, never lexical siblings such as `/document2`.
 */
function ownsLocalIri(value: string, baseIri: string): boolean {
  if (value === baseIri) return true;
  if (!value.startsWith(baseIri)) return false;
  if (hasTerminalNamespaceDelimiter(baseIri)) return true;
  return /^[\/#:]/u.test(value.slice(baseIri.length));
}

function hasTerminalNamespaceDelimiter(value: string): boolean {
  return /[\/#:]$/u.test(value);
}

function generatedElementKind(
  elementId: string,
  semanticRef: string,
): "node" | "container" | "region" | "edge" | undefined {
  for (const kind of ["node", "container", "region", "edge"] as const) {
    if (elementId === generatedElementId(kind, semanticRef)) return kind;
  }
  return undefined;
}

function replacementPreview(
  revision: string,
  baseFingerprint: string,
  candidate: IriographDocumentV1 | undefined,
  diagnostics: readonly ProjectionDiagnostic[],
): PortableDocumentReplacePreview {
  const sorted = uniqueDiagnostics(diagnostics);
  const candidateDocumentFingerprint = candidate ? documentFingerprint(candidate) : undefined;
  const core = {
    baseRevision: revision,
    baseDocumentFingerprint: baseFingerprint,
    candidateDocumentFingerprint,
  };
  return {
    valid: Boolean(candidate) && !hasBlockingDiagnostics(sorted),
    requiresConfirmation: true,
    confirmationId: `urn:iriograph:document-replace-confirmation:v1:${hash(stableJson(core))}`,
    ...core,
    ...(candidate ? { candidate: clone(candidate) } : {}),
    diagnostics: sorted,
  };
}

function schemaIssueDiagnostic(issue: RuntimeValidationIssue): ProjectionDiagnostic {
  const property = issue.keyword === "required"
    ? issue.params.missingProperty
    : issue.keyword === "additionalProperties"
      ? issue.params.additionalProperty
      : undefined;
  const pointer = typeof property === "string"
    ? `${issue.instancePath}/${escapeJsonPointer(property)}`
    : issue.instancePath;
  return error(
    "document-schema-invalid",
    `${pointer || "/"}: ${issue.message}`,
    pointer,
  );
}

function diagnosticForView(
  diagnostic: ProjectionDiagnostic,
  document: IriographDocumentV1,
  viewIndex: number,
): ProjectionDiagnostic {
  if (diagnostic.jsonPointer !== undefined) return diagnostic;
  const view = document.views[viewIndex]!;
  if (diagnostic.code === "profile-catalog-unresolved") {
    return { ...diagnostic, jsonPointer: `/views/${viewIndex}/profileRef` };
  }
  if (diagnostic.code === "layout-adapter-unresolved") {
    return { ...diagnostic, jsonPointer: `/views/${viewIndex}/layoutRef` };
  }
  if (diagnostic.semanticRef) {
    if (view.overlay[diagnostic.semanticRef]) {
      return {
        ...diagnostic,
        jsonPointer: `/views/${viewIndex}/overlay/${escapeJsonPointer(diagnostic.semanticRef)}`,
      };
    }
    const overlayEntry = Object.entries(view.overlay).find(([, entry]) => (
      entry.semanticRef === diagnostic.semanticRef
    ));
    if (overlayEntry) {
      return {
        ...diagnostic,
        jsonPointer: `/views/${viewIndex}/overlay/${escapeJsonPointer(overlayEntry[0])}`,
      };
    }
  }
  return { ...diagnostic, jsonPointer: `/views/${viewIndex}` };
}

function error(
  code: string,
  message: string,
  jsonPointer: string,
  semanticRef?: string,
): ProjectionDiagnostic {
  return {
    severity: "error",
    category: code.includes("json") || code.includes("schema") ? "syntax" : "structure",
    code,
    message,
    jsonPointer,
    ...(semanticRef ? { semanticRef } : {}),
  };
}

function rejected(
  current: IriographDocument,
  diagnostics: readonly ProjectionDiagnostic[],
): PortableDocumentReplaceResult {
  return {
    accepted: false,
    document: clone(current),
    diagnostics: uniqueDiagnostics(diagnostics),
  };
}

function documentFingerprint(value: IriographDocument): string {
  return `urn:iriograph:document-fingerprint:v1:${hash(stableJson(value))}`;
}

function uniqueDiagnostics(values: readonly ProjectionDiagnostic[]): ProjectionDiagnostic[] {
  const seen = new Set<string>();
  return sortDiagnostics(values.filter((value) => {
    const key = stableJson(value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }));
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

function hash(value: string): string {
  let state = 0xcbf29ce484222325n;
  for (let index = 0; index < value.length; index += 1) {
    state ^= BigInt(value.charCodeAt(index));
    state = BigInt.asUintN(64, state * 0x100000001b3n);
  }
  return state.toString(16).padStart(16, "0");
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isAbsoluteIri(value: string): boolean {
  return /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(value);
}

function escapeJsonPointer(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}
