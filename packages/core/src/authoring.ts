import { DataFactory, Parser, Store, type Quad } from "n3";

import type {
  ApplyAuthoringSourceOptions,
  ApplyAuthoringPreviewOptions,
  AuthoringApplyResult,
  AuthoringCommand,
  AuthoringCommandSeed,
  AuthoringPreview,
  PreviewAuthoringOptions,
  ProvenanceAuthoringInput,
  ResolvedAuthoringContext,
} from "./authoring-model";
import {
  compileAuthoringCommands,
  type AuthoringPositionApplication,
} from "./authoring-patch";
import { sortDiagnostics } from "./diagnostics";
import {
  applyCanonicalSemanticDataset,
  applyCanonicalSemanticSource,
  applySemanticSource,
} from "./document";
import type {
  IriographDocument,
  ProjectionDiagnostic,
  SceneContainer,
  SemanticEditCapability,
  SemanticSourceUpdate,
} from "./model";
import { statementIdentityFromQuad } from "./identity";
import { buildIriographView } from "./scene";
import {
  RDF_TYPE,
  validateAuthoringGraphPolicy,
  validateResolvedAuthoringContext,
} from "./authoring-validation";
import {
  canonicalizeTurtleSourceV1,
  serializeCanonicalTurtleV1,
  TURTLE_SERIALIZER_VERSION_V1,
} from "./serializer";

export async function previewAuthoringCommands(
  document: IriographDocument,
  commands: readonly AuthoringCommand[],
  context: ResolvedAuthoringContext,
  options: PreviewAuthoringOptions = {},
): Promise<AuthoringPreview> {
  return (await previewInternal(document, commands, context, options)).preview;
}

export async function applyAuthoringPreview(
  document: IriographDocument,
  preview: AuthoringPreview,
  context: ResolvedAuthoringContext,
  options: ApplyAuthoringPreviewOptions,
): Promise<AuthoringApplyResult> {
  const bindingDiagnostics = validatePreviewBinding(document, preview, context, options);
  if (bindingDiagnostics.length > 0) return rejected(document, bindingDiagnostics);
  if (!preview.valid) {
    return rejected(document, [{
      severity: "error",
      code: "authoring-preview-invalid",
      message: "An invalid authoring preview cannot be applied.",
    }]);
  }
  if (options.signal?.aborted) {
    return rejected(document, [{
      severity: "error",
      code: "authoring-aborted",
      message: "Authoring apply was aborted.",
    }]);
  }

  // Recompile and rerun policy, structure, layout and reconciliation. The
  // preview is evidence for confirmation, never trusted as an executable patch.
  const current = await previewInternal(document, preview.commands, context, {
    signal: options.signal,
  });
  if (!current.preview.valid || !current.update?.accepted) {
    return rejected(document, current.preview.diagnostics);
  }
  if (
    current.preview.confirmationId !== preview.confirmationId
    || stableJson(previewCore(current.preview)) !== stableJson(previewCore(preview))
  ) {
    return rejected(document, [{
      severity: "error",
      code: "authoring-preview-tampered",
      message: "The authoring preview does not match the recompiled graph patch.",
    }]);
  }
  if (options.signal?.aborted) {
    return rejected(document, [{
      severity: "error",
      code: "authoring-aborted",
      message: "Authoring apply was aborted.",
    }]);
  }
  return {
    accepted: true,
    document: clone(current.update.document),
    diagnostics: [...current.preview.diagnostics],
  };
}

/**
 * Applies a human or LLM Turtle draft through the same final-candidate policy
 * and all-view reconciliation used by structured authoring. Accepted human
 * textarea source is preserved byte-for-byte; LLM source is canonicalized by
 * the versioned serializer before it becomes the document source.
 */
export async function applyAuthoringSource(
  document: IriographDocument,
  source: string,
  context: ResolvedAuthoringContext,
  options: ApplyAuthoringSourceOptions,
): Promise<SemanticSourceUpdate> {
  let diagnostics = validateResolvedAuthoringContext(document, context);
  const actor = options?.actor;
  if (actor !== "human" && actor !== "llm") {
    diagnostics.push({
      severity: "error",
      code: "authoring-actor-invalid",
      message: "Authoring actor must be exactly human or llm.",
    });
  }
  const original = parseTurtle(document.semantic.source, document.semantic.baseIri);
  const candidate = parseTurtle(source, document.semantic.baseIri);
  diagnostics.push(...original.diagnostics, ...candidate.diagnostics);
  if (options?.signal?.aborted) diagnostics.push(abortedDiagnostic());
  if (!hasErrors(diagnostics)) {
    const canonicalOriginal = canonicalizeTurtleSourceV1(
      document.semantic.source,
      document.semantic.baseIri,
    );
    const canonicalCandidate = canonicalizeTurtleSourceV1(source, document.semantic.baseIri);
    if (!canonicalOriginal.accepted || !canonicalCandidate.accepted) {
      diagnostics.push(
        ...(!canonicalOriginal.accepted ? canonicalOriginal.diagnostics : []),
        ...(!canonicalCandidate.accepted ? canonicalCandidate.diagnostics : []),
      );
    } else {
      const normalizedOriginal = parseTurtle(
        canonicalOriginal.source,
        document.semantic.baseIri,
        "iriograph-policy-",
      );
      const normalizedCandidate = parseTurtle(
        canonicalCandidate.source,
        document.semantic.baseIri,
        "iriograph-policy-",
      );
      diagnostics.push(...normalizedOriginal.diagnostics, ...normalizedCandidate.diagnostics);
      if (!hasErrors(diagnostics)) {
        diagnostics.push(...validateAuthoringGraphPolicy(
          normalizedOriginal.quads,
          new Store(normalizedCandidate.quads),
          context,
          { actor },
        ));
      }
    }
  }
  if (options?.signal?.aborted && !diagnostics.some((item) => item.code === "authoring-aborted")) {
    diagnostics.push(abortedDiagnostic());
  }
  if (hasErrors(diagnostics)) return rejected(document, diagnostics);
  const update = actor === "human"
    ? await applySemanticSource(document, source, context.runtime)
    : await applyCanonicalSemanticSource(document, source, context.runtime, {
        serializerVersion: TURTLE_SERIALIZER_VERSION_V1,
      });
  if (options?.signal?.aborted) return rejected(document, [...diagnostics, abortedDiagnostic()]);
  diagnostics = uniqueDiagnostics(sortDiagnostics([...diagnostics, ...update.diagnostics]));
  if (!update.accepted || hasErrors(diagnostics)) return rejected(document, diagnostics);
  return {
    accepted: true,
    document: clone(update.document),
    diagnostics,
  };
}

/**
 * Converts only explicit projection provenance. Missing provenance or missing
 * parameters returns undefined; no predicate or graph structure is inferred.
 */
export function provenanceToAuthoringCommand(
  capability: SemanticEditCapability | undefined,
  input: ProvenanceAuthoringInput,
): AuthoringCommand | undefined {
  if (!capability || !input.commandId) return undefined;
  switch (capability.command) {
    case "remove-statement":
      return {
        type: "remove-statement",
        commandId: input.commandId,
        statementRef: capability.statementRef,
        subjectIri: capability.subject,
        predicateIri: capability.predicate,
        objectIri: capability.object,
      };
    case "set-membership":
      return input.enabled === undefined
        ? undefined
        : {
            type: "set-membership",
            commandId: input.commandId,
            containerIri: capability.container,
            memberIri: capability.member,
            containerTypeIri: capability.containerTypeIri,
            predicateIri: capability.predicate,
            enabled: input.enabled,
          };
    case "set-sequence":
      return input.memberIris === undefined
        ? undefined
        : {
            type: "set-sequence",
            commandId: input.commandId,
            sequenceIri: capability.sequence,
            memberIris: [...input.memberIris],
            sequenceTypeIri: capability.sequenceTypeIri,
            ordinalPredicatePrefix: capability.ordinalPredicatePrefix,
          };
    case "set-alternatives":
      return input.memberIris === undefined || input.defaultMemberIri === undefined
        ? undefined
        : {
            type: "set-alternatives",
            commandId: input.commandId,
            alternativeIri: capability.alternative,
            memberIris: [...input.memberIris],
            defaultMemberIri: input.defaultMemberIri,
            alternativeTypeIri: capability.alternativeTypeIri,
            ordinalPredicatePrefix: capability.ordinalPredicatePrefix,
            defaultOrdinal: capability.defaultOrdinal,
          };
  }
}

/** Seeds an exact semantic draft from projection provenance and the current graph. */
export function seedAuthoringCommandFromProvenance(
  document: IriographDocument,
  capability: SemanticEditCapability | undefined,
  commandId: string,
): AuthoringCommandSeed {
  if (!capability || !commandId) {
    return seedRejected("authoring-provenance-required", "Exact projection provenance is required.");
  }
  const parsed = parseTurtle(document.semantic.source, document.semantic.baseIri);
  if (parsed.diagnostics.length > 0) return { diagnostics: parsed.diagnostics };
  const store = new Store(parsed.quads);
  if (capability.command === "remove-statement") {
    const value = DataFactory.quad(
      DataFactory.namedNode(capability.subject),
      DataFactory.namedNode(capability.predicate),
      DataFactory.namedNode(capability.object),
    );
    if (!store.has(value) || statementIdentityFromQuad(value) !== capability.statementRef) {
      return staleSeed(capability.subject);
    }
    return {
      command: provenanceToAuthoringCommand(capability, { commandId }),
      diagnostics: [],
    };
  }
  if (capability.command === "set-membership") {
    const typed = store.countQuads(
      capability.container,
      RDF_TYPE,
      capability.containerTypeIri,
      null,
    ) > 0;
    const member = store.countQuads(
      capability.container,
      capability.predicate,
      capability.member,
      null,
    ) > 0;
    if (!typed || !member) return staleSeed(capability.container);
    return {
      command: provenanceToAuthoringCommand(capability, { commandId, enabled: false }),
      diagnostics: [],
    };
  }
  const subjectIri = capability.command === "set-sequence"
    ? capability.sequence
    : capability.alternative;
  const typeIri = capability.command === "set-sequence"
    ? capability.sequenceTypeIri
    : capability.alternativeTypeIri;
  if (store.countQuads(subjectIri, RDF_TYPE, typeIri, null) === 0) return staleSeed(subjectIri);
  const members = ordinalMembers(store, subjectIri, capability.ordinalPredicatePrefix);
  if (!members.valid) return staleSeed(subjectIri);
  if (capability.command === "set-sequence") {
    return {
      command: provenanceToAuthoringCommand(capability, {
        commandId,
        memberIris: members.memberIris,
      }),
      diagnostics: [],
    };
  }
  const defaultMemberIri = members.memberIris[capability.defaultOrdinal - 1];
  if (!defaultMemberIri) return staleSeed(subjectIri);
  return {
    command: provenanceToAuthoringCommand(capability, {
      commandId,
      memberIris: members.memberIris,
      defaultMemberIri,
    }),
    diagnostics: [],
  };
}

export function authoringDocumentFingerprint(document: IriographDocument): string {
  return `urn:iriograph:document-fingerprint:v1:${hash(stableJson(document))}`;
}

async function previewInternal(
  document: IriographDocument,
  commands: readonly AuthoringCommand[],
  context: ResolvedAuthoringContext,
  options: PreviewAuthoringOptions,
): Promise<{ preview: AuthoringPreview; update?: SemanticSourceUpdate }> {
  const compilation = await compileAuthoringCommands(document, commands, context, options);
  let diagnostics = [...compilation.diagnostics];
  let candidateSource: string | undefined;
  let update: SemanticSourceUpdate | undefined;

  if (options.signal?.aborted && !diagnostics.some((item) => item.code === "authoring-aborted")) {
    diagnostics.push(abortedDiagnostic());
  }
  if (!hasErrors(diagnostics)) {
    const serialized = serializeCanonicalTurtleV1({
      serializerVersion: TURTLE_SERIALIZER_VERSION_V1,
      quads: compilation.quads,
      baseIri: document.semantic.baseIri,
      prefixes: compilation.prefixes,
    });
    if (!serialized.accepted) {
      diagnostics.push(...serialized.diagnostics);
    } else {
      candidateSource = serialized.source;
      update = await applyCanonicalSemanticDataset(
        document,
        compilation.quads,
        context.runtime,
        {
          serializerVersion: TURTLE_SERIALIZER_VERSION_V1,
          baseIri: document.semantic.baseIri,
          prefixes: compilation.prefixes,
        },
      );
      diagnostics.push(...update.diagnostics);
      if (options.signal?.aborted) diagnostics.push(abortedDiagnostic());
      if (update.accepted && !hasErrors(diagnostics)) {
        const positioned = await applyInitialPositions(
          update.document,
          compilation.positions,
          context,
          options.signal,
        );
        diagnostics.push(...positioned.diagnostics);
        if (options.signal?.aborted) diagnostics.push(abortedDiagnostic());
        if (!hasErrors(positioned.diagnostics)) {
          update = { ...update, document: positioned.document };
        }
      }
    }
  }

  diagnostics = uniqueDiagnostics(sortDiagnostics(diagnostics));
  const core = {
    baseDocumentFingerprint: authoringDocumentFingerprint(document),
    baseRevision: context.documentRevision,
    contextId: context.contextId,
    contextRevision: context.contextRevision,
    authoringProfileRef: context.authoringProfileRef,
    commands: clone(compilation.commands),
    candidateSource,
    patch: clone(compilation.patch),
    diagnostics,
  };
  const confirmationId = confirmationFor(core);
  const preview: AuthoringPreview = {
    valid: !hasErrors(diagnostics) && update?.accepted === true,
    requiresConfirmation: true,
    confirmationId,
    ...core,
  };
  return { preview, update: preview.valid ? update : undefined };
}

async function applyInitialPositions(
  source: IriographDocument,
  positions: readonly AuthoringPositionApplication[],
  context: ResolvedAuthoringContext,
  signal?: AbortSignal,
): Promise<{ document: IriographDocument; diagnostics: ProjectionDiagnostic[] }> {
  const document = clone(source);
  const diagnostics: ProjectionDiagnostic[] = [];
  const scenes = new Map<string, Awaited<ReturnType<typeof buildIriographView>>>();
  for (const { resourceIri, position } of positions) {
    if (signal?.aborted) break;
    if (
      !Number.isFinite(position.x)
      || !Number.isFinite(position.y)
      || position.x < 0
      || position.y < 0
    ) {
      diagnostics.push({
        severity: "error",
        code: "initial-position-out-of-bounds",
        message: `Initial position must use finite non-negative coordinates: ${resourceIri}`,
        semanticRef: resourceIri,
      });
      continue;
    }
    const view = document.views.find((candidate) => candidate.viewId === position.viewId);
    if (!view) {
      diagnostics.push({
        severity: "error",
        code: "initial-position-view-unresolved",
        message: `Initial position view does not exist: ${position.viewId}`,
        semanticRef: resourceIri,
      });
      continue;
    }
    let scene = scenes.get(view.viewId);
    if (!scene) {
      scene = await buildIriographView(document, view.viewId, context.runtime, "incremental");
      scenes.set(view.viewId, scene);
      diagnostics.push(...scene.diagnostics);
      if (signal?.aborted) break;
    }
    const element = [...scene.containers, ...scene.nodes]
      .find((candidate) => candidate.semanticRef === resourceIri);
    if (!element) {
      diagnostics.push({
        severity: "error",
        code: "created-resource-not-projected",
        message: `Created resource is not a geometry element in view ${position.viewId}: ${resourceIri}`,
        semanticRef: resourceIri,
      });
      continue;
    }
    const existing = Object.entries(view.overlay)
      .find(([, overlay]) => overlay.semanticRef === resourceIri);
    const elementId = existing?.[0] ?? element.elementId;
    const entry = existing?.[1] ?? {
      semanticRef: resourceIri,
      geometry: clone(element.geometry),
      pinned: false,
      placement: "generated" as const,
    };
    const geometry = entry.geometry ?? element.geometry;
    const parent = element.parentElementId
      ? scene.containers.find((candidate) => candidate.elementId === element.parentElementId)
      : undefined;
    const bounds = parent ? containerContentBounds(parent) : {
      x: 8,
      y: 8,
      width: Math.max(0, scene.width - 16),
      height: Math.max(0, scene.height - 16),
    };
    if (
      geometry.width > bounds.width
      || geometry.height > bounds.height
      || position.x < bounds.x
      || position.y < bounds.y
      || position.x + geometry.width > bounds.x + bounds.width
      || position.y + geometry.height > bounds.y + bounds.height
    ) {
      diagnostics.push({
        severity: "error",
        code: "initial-position-out-of-bounds",
        message: `Initial position does not fit bounds (${bounds.x}, ${bounds.y}, ${bounds.width}, ${bounds.height}): ${resourceIri}`,
        semanticRef: resourceIri,
      });
      continue;
    }
    view.overlay[elementId] = entry;
    entry.geometry = { ...geometry, x: position.x, y: position.y };
    entry.pinned = true;
    entry.placement = "user";
  }
  return { document, diagnostics };
}

function validatePreviewBinding(
  document: IriographDocument,
  preview: AuthoringPreview,
  context: ResolvedAuthoringContext,
  options: ApplyAuthoringPreviewOptions,
): ProjectionDiagnostic[] {
  const diagnostics: ProjectionDiagnostic[] = [];
  if (options.confirmationId !== preview.confirmationId) {
    diagnostics.push({
      severity: "error",
      code: "authoring-confirmation-mismatch",
      message: "The explicit confirmation ID does not match the preview.",
    });
  }
  if (preview.baseDocumentFingerprint !== authoringDocumentFingerprint(document)) {
    diagnostics.push({
      severity: "error",
      code: "authoring-preview-stale",
      message: "The document has changed since the authoring preview was created.",
    });
  }
  if (preview.baseRevision !== context.documentRevision) {
    diagnostics.push({
      severity: "error",
      code: "authoring-revision-mismatch",
      message: "The host document revision has changed since preview.",
    });
  }
  if (
    preview.contextId !== context.contextId
    || preview.contextRevision !== context.contextRevision
    || preview.authoringProfileRef !== context.authoringProfileRef
  ) {
    diagnostics.push({
      severity: "error",
      code: "authoring-context-mismatch",
      message: "The resolved authoring context has changed since preview.",
    });
  }
  return diagnostics;
}

function confirmationFor(value: unknown): string {
  return `urn:iriograph:authoring-confirmation:v1:${hash(stableJson(value))}`;
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
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, item]) => [key, stableValue(item)]));
  }
  return value;
}

function previewCore(preview: AuthoringPreview): Omit<AuthoringPreview, "valid" | "requiresConfirmation" | "confirmationId"> {
  const {
    valid: _valid,
    requiresConfirmation: _requiresConfirmation,
    confirmationId: _confirmationId,
    ...core
  } = preview;
  return core;
}

function uniqueDiagnostics(
  diagnostics: readonly ProjectionDiagnostic[],
): ProjectionDiagnostic[] {
  const seen = new Set<string>();
  return diagnostics.filter((diagnostic) => {
    const key = stableJson(diagnostic);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function hasErrors(diagnostics: readonly ProjectionDiagnostic[]): boolean {
  return diagnostics.some((diagnostic) => diagnostic.severity === "error");
}

function rejected(
  document: IriographDocument,
  diagnostics: readonly ProjectionDiagnostic[],
): AuthoringApplyResult {
  return {
    accepted: false,
    document: clone(document),
    diagnostics: uniqueDiagnostics(sortDiagnostics(diagnostics)),
  };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function parseTurtle(
  source: string,
  baseIri: string,
  blankNodePrefix?: string,
): { quads: Quad[]; diagnostics: ProjectionDiagnostic[] } {
  try {
    return {
      quads: new Parser({
        baseIRI: baseIri,
        format: "text/turtle",
        ...(blankNodePrefix === undefined ? {} : { blankNodePrefix }),
      }).parse(source),
      diagnostics: [],
    };
  } catch (cause) {
    return {
      quads: [],
      diagnostics: [{
        severity: "error",
        code: "invalid-turtle",
        message: cause instanceof Error ? cause.message : "The semantic source is invalid Turtle.",
      }],
    };
  }
}

function ordinalMembers(
  store: Store,
  subjectIri: string,
  prefix: string,
): { valid: boolean; memberIris: string[] } {
  const candidates = store.getQuads(subjectIri, null, null, null)
    .filter((value) => (
      value.predicate.value.startsWith(prefix)
      && /^[1-9][0-9]*$/u.test(value.predicate.value.slice(prefix.length))
    ));
  const entries = candidates.map((value) => ({
    ordinal: Number(value.predicate.value.slice(prefix.length)),
    memberIri: value.object.termType === "NamedNode" ? value.object.value : undefined,
  }));
  if (
    entries.length === 0
    || entries.some((entry) => (
      !Number.isSafeInteger(entry.ordinal)
      || entry.ordinal < 1
      || !entry.memberIri
    ))
  ) return { valid: false, memberIris: [] };
  entries.sort((left, right) => left.ordinal - right.ordinal);
  if (entries.some((entry, index) => entry.ordinal !== index + 1)) {
    return { valid: false, memberIris: [] };
  }
  return { valid: true, memberIris: entries.map((entry) => entry.memberIri!) };
}

function seedRejected(code: string, message: string): AuthoringCommandSeed {
  return { diagnostics: [{ severity: "error", code, message }] };
}

function staleSeed(semanticRef: string): AuthoringCommandSeed {
  return seedRejected(
    "authoring-provenance-stale",
    `Projection provenance no longer matches the current graph: ${semanticRef}`,
  );
}

function abortedDiagnostic(): ProjectionDiagnostic {
  return {
    severity: "error",
    code: "authoring-aborted",
    message: "Authoring transaction was aborted.",
  };
}

function containerContentBounds(parent: SceneContainer): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  const left = parent.headerPosition === "left" ? 78 : 16;
  const top = parent.headerPosition === "top" ? 46 : 16;
  const right = 16;
  const bottom = 16;
  return {
    x: parent.geometry.x + left,
    y: parent.geometry.y + top,
    width: Math.max(0, parent.geometry.width - left - right),
    height: Math.max(0, parent.geometry.height - top - bottom),
  };
}
