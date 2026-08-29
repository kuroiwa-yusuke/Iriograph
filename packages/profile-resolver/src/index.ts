import {
  computeCatalogIntegrity,
  type AuthoringTermPolicy,
  type CatalogRawSource,
  type ProjectionRuntimeContext,
  type ResolvedAuthoringCapability,
  type ResolvedAuthoringContext,
  type ResolvedAuthoringTerm,
  type ResolvedSemanticValidationContext,
  type ResolvedStructuredAuthoringProfile,
  type ResourceIriAllocator,
} from "@iriograph/core";

export type AuthoringVocabularyImport = {
  vocabularyRef: string;
  integrity?: string;
};

export type AuthoringVocabularyManifestV1 = {
  schemaVersion: "1";
  kind: "iriograph.authoring-vocabulary";
  vocabularyId: string;
  vocabularyVersion: string;
  vocabularyRef: string;
  imports?: AuthoringVocabularyImport[];
  terms: ResolvedAuthoringTerm[];
  capabilities?: ResolvedAuthoringCapability[];
  nodeRoles?: ResolvedStructuredAuthoringProfile["nodeRoles"];
};

export type AuthoringProfileManifestV1 = {
  schemaVersion: "1";
  kind: "iriograph.authoring-profile";
  profileId: string;
  profileVersion: string;
  profileRef: string;
  imports: AuthoringVocabularyImport[];
  defaultLocale?: string;
  termPolicy: AuthoringTermPolicy;
  structuredAuthoring: Pick<
    ResolvedStructuredAuthoringProfile,
    "allowUntypedNodes" | "allowClassificationGroups"
  > & { nodeRoles?: ResolvedStructuredAuthoringProfile["nodeRoles"] };
  terms?: ResolvedAuthoringTerm[];
  capabilities?: ResolvedAuthoringCapability[];
  semanticValidationRef?: string;
};

export interface AuthoringArtifactResolver {
  resolveAuthoringArtifact(ref: string, signal?: AbortSignal): Promise<CatalogRawSource>;
}

export type AuthoringProfileResolutionDiagnostic = {
  severity: "error";
  code:
    | "profile-ref-invalid"
    | "artifact-fetch-failed"
    | "artifact-integrity-mismatch"
    | "artifact-json-invalid"
    | "artifact-kind-invalid"
    | "artifact-identity-mismatch"
    | "vocabulary-cycle"
    | "duplicate-import"
    | "missing-term-id"
    | "duplicate-term-id"
    | "duplicate-term-iri-role"
    | "duplicate-capability-id"
    | "duplicate-role-id"
    | "role-class-conflict"
    | "semantic-validation-unresolved";
  message: string;
  artifactRef?: string;
  relatedRefs?: string[];
};

export type ResolvedAuthoringArtifact = {
  ref: string;
  integrity: string;
  source: AuthoringProfileManifestV1 | AuthoringVocabularyManifestV1;
};

export type ResolveAuthoringProfileRequest = {
  profileRef: string;
  profileIntegrity?: string;
  resolver: AuthoringArtifactResolver;
  runtime: ProjectionRuntimeContext;
  documentRevision: string;
  contextId: string;
  resourcePolicy: ResolvedAuthoringContext["resourcePolicy"];
  allocator?: ResourceIriAllocator;
  resolveSemanticValidation?: (
    ref: string,
    revision: string,
    signal?: AbortSignal,
  ) => Promise<ResolvedSemanticValidationContext | undefined>;
  signal?: AbortSignal;
};

export type AuthoringProfileResolutionResult =
  | {
      accepted: true;
      context: ResolvedAuthoringContext;
      artifacts: ResolvedAuthoringArtifact[];
      fingerprint: string;
      diagnostics: [];
    }
  | {
      accepted: false;
      diagnostics: AuthoringProfileResolutionDiagnostic[];
      readable: true;
    };

const EXACT_VERSION = /@([^/@]+)$/u;
const INTEGRITY = /^sha256-[A-Za-z0-9+/]+={0,2}$/u;

/**
 * Resolves an immutable authoring profile. The function performs no network or
 * tenant work itself; all fetches cross the injected host resolver boundary.
 */
export async function resolveAuthoringProfile(
  request: ResolveAuthoringProfileRequest,
): Promise<AuthoringProfileResolutionResult> {
  if (!exactVersion(request.profileRef)) {
    return failure("profile-ref-invalid", `profileRef must end in an exact @version: ${request.profileRef}`, request.profileRef);
  }
  const diagnostics: AuthoringProfileResolutionDiagnostic[] = [];
  const artifacts = new Map<string, ResolvedAuthoringArtifact>();
  const visiting: string[] = [];

  const load = async (
    ref: string,
    expected: "profile" | "vocabulary",
    integrity?: string,
  ): Promise<ResolvedAuthoringArtifact | undefined> => {
    if (!exactVersion(ref)) {
      diagnostics.push(diagnostic("profile-ref-invalid", `artifact ref must end in an exact @version: ${ref}`, ref));
      return undefined;
    }
    if (visiting.includes(ref)) {
      diagnostics.push({
        ...diagnostic("vocabulary-cycle", `vocabulary import cycle: ${[...visiting, ref].join(" -> ")}`, ref),
        relatedRefs: [...visiting, ref],
      });
      return undefined;
    }
    const cached = artifacts.get(ref);
    if (cached) return cached;
    visiting.push(ref);
    try {
      let raw: CatalogRawSource;
      try {
        raw = await request.resolver.resolveAuthoringArtifact(ref, request.signal);
      } catch (cause) {
        diagnostics.push(diagnostic("artifact-fetch-failed", errorMessage(cause), ref));
        return undefined;
      }
      const computed = await computeCatalogIntegrity(raw);
      if (integrity && (!INTEGRITY.test(integrity) || integrity !== computed)) {
        diagnostics.push(diagnostic("artifact-integrity-mismatch", `expected ${integrity}; received ${computed}`, ref));
        return undefined;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(sourceText(raw)) as unknown;
      } catch (cause) {
        diagnostics.push(diagnostic("artifact-json-invalid", errorMessage(cause), ref));
        return undefined;
      }
      if (!isArtifact(parsed, expected)) {
        diagnostics.push(diagnostic("artifact-kind-invalid", `expected ${expected} manifest`, ref));
        return undefined;
      }
      const identityRef = "profileRef" in parsed ? parsed.profileRef : parsed.vocabularyRef;
      const id = "profileId" in parsed ? parsed.profileId : parsed.vocabularyId;
      const version = "profileVersion" in parsed ? parsed.profileVersion : parsed.vocabularyVersion;
      if (identityRef !== ref || ref !== `${id}@${version}`) {
        diagnostics.push(diagnostic("artifact-identity-mismatch", `manifest identity ${id}@${version} does not match ${ref}`, ref));
        return undefined;
      }
      const artifact = { ref, integrity: computed, source: parsed };
      artifacts.set(ref, artifact);
      const imports = parsed.imports ?? [];
      const seen = new Set<string>();
      for (const entry of [...imports].sort((a, b) => compare(a.vocabularyRef, b.vocabularyRef))) {
        if (seen.has(entry.vocabularyRef)) {
          diagnostics.push(diagnostic("duplicate-import", `duplicate vocabulary import: ${entry.vocabularyRef}`, ref));
          continue;
        }
        seen.add(entry.vocabularyRef);
        await load(entry.vocabularyRef, "vocabulary", entry.integrity);
      }
      return artifact;
    } finally {
      visiting.pop();
    }
  };

  const profileArtifact = await load(request.profileRef, "profile", request.profileIntegrity);
  if (!profileArtifact || profileArtifact.source.kind !== "iriograph.authoring-profile") {
    return { accepted: false, diagnostics: sortDiagnostics(diagnostics), readable: true };
  }

  const profile = profileArtifact.source;
  const orderedArtifacts = [...artifacts.values()].sort((a, b) => compare(a.ref, b.ref));
  const vocabularies = orderedArtifacts.flatMap((entry) => (
    entry.source.kind === "iriograph.authoring-vocabulary" ? [entry.source] : []
  ));
  const terms = [...vocabularies.flatMap((item) => item.terms), ...(profile.terms ?? [])];
  const capabilities = [
    ...vocabularies.flatMap((item) => item.capabilities ?? []),
    ...(profile.capabilities ?? []),
  ];
  const nodeRoles = [
    ...vocabularies.flatMap((item) => item.nodeRoles ?? []),
    ...(profile.structuredAuthoring.nodeRoles ?? []),
  ];
  diagnostics.push(...validateOptions(terms, capabilities, nodeRoles));

  const fingerprint = await fingerprintFor(orderedArtifacts);
  let semanticValidation: ResolvedSemanticValidationContext | undefined;
  if (profile.semanticValidationRef) {
    semanticValidation = await request.resolveSemanticValidation?.(
      profile.semanticValidationRef,
      fingerprint,
      request.signal,
    );
    if (!semanticValidation) {
      diagnostics.push(diagnostic(
        "semantic-validation-unresolved",
        `semantic validation context could not be resolved: ${profile.semanticValidationRef}`,
        profile.semanticValidationRef,
      ));
    }
  }
  if (diagnostics.length > 0) {
    return { accepted: false, diagnostics: sortDiagnostics(diagnostics), readable: true };
  }

  const context: ResolvedAuthoringContext = {
    contextId: request.contextId,
    contextRevision: `urn:iriograph:authoring-context:v1:${fingerprint.slice("sha256-".length)}`,
    documentRevision: request.documentRevision,
    authoringProfileRef: profile.profileRef,
    ...(profile.defaultLocale ? { defaultLocale: profile.defaultLocale } : {}),
    runtime: request.runtime,
    resourcePolicy: request.resourcePolicy,
    termPolicy: profile.termPolicy,
    terms: [...terms].sort((a, b) => compare(requiredTermId(a), requiredTermId(b))),
    capabilities: [...capabilities].sort((a, b) => compare(a.capabilityId, b.capabilityId)),
    structuredAuthoring: {
      ...(profile.structuredAuthoring.allowUntypedNodes === undefined ? {} : {
        allowUntypedNodes: profile.structuredAuthoring.allowUntypedNodes,
      }),
      ...(profile.structuredAuthoring.allowClassificationGroups === undefined ? {} : {
        allowClassificationGroups: profile.structuredAuthoring.allowClassificationGroups,
      }),
      nodeRoles: [...nodeRoles].sort((a, b) => compare(a.roleId, b.roleId)),
    },
    ...(request.allocator ? { allocator: request.allocator } : {}),
    ...(semanticValidation ? { semanticValidation } : {}),
  };
  return { accepted: true, context, artifacts: orderedArtifacts, fingerprint, diagnostics: [] };
}

/** Rejects a stale opaque option without exposing or accepting a replacement IRI. */
export function assertResolvedAuthoringOption(
  context: ResolvedAuthoringContext,
  input: { contextRevision: string; optionKind: "term" | "role" | "capability"; optionId: string },
): void {
  if (input.contextRevision !== context.contextRevision) throw new Error("authoring context is stale");
  const exists = input.optionKind === "term"
    ? context.terms.some((term) => term.termId === input.optionId)
    : input.optionKind === "role"
      ? context.structuredAuthoring?.nodeRoles.some((role) => role.roleId === input.optionId) === true
      : context.capabilities.some((capability) => capability.capabilityId === input.optionId);
  if (!exists) throw new Error(`unknown ${input.optionKind} option: ${input.optionId}`);
}

function validateOptions(
  terms: readonly ResolvedAuthoringTerm[],
  capabilities: readonly ResolvedAuthoringCapability[],
  roles: readonly ResolvedStructuredAuthoringProfile["nodeRoles"][number][],
): AuthoringProfileResolutionDiagnostic[] {
  const result: AuthoringProfileResolutionDiagnostic[] = [];
  for (const term of terms) {
    if (!term.termId) {
      result.push(diagnostic("missing-term-id", `resolved vocabulary term requires termId: ${term.iri}`));
    }
  }
  duplicateDiagnostics(terms.flatMap((term) => term.termId ? [term.termId] : []), "duplicate-term-id", result);
  duplicateDiagnostics(capabilities.map((item) => item.capabilityId), "duplicate-capability-id", result);
  duplicateDiagnostics(roles.map((item) => item.roleId), "duplicate-role-id", result);
  const termRole = new Map<string, string>();
  for (const term of terms) {
    const rolesKey = JSON.stringify([term.kind, [...(term.roles ?? [])].sort()]);
    const previous = termRole.get(term.iri);
    if (previous && previous !== rolesKey) {
      result.push(diagnostic("duplicate-term-iri-role", `term IRI has conflicting roles: ${term.iri}`));
    }
    termRole.set(term.iri, rolesKey);
  }
  const roleClasses = new Map<string, string>();
  for (const role of roles) {
    const previous = roleClasses.get(role.roleId);
    if (previous && previous !== role.classIri) {
      result.push(diagnostic("role-class-conflict", `roleId maps to multiple classes: ${role.roleId}`));
    }
    roleClasses.set(role.roleId, role.classIri);
  }
  return result;
}

function duplicateDiagnostics(
  values: readonly string[],
  code: "duplicate-term-id" | "duplicate-capability-id" | "duplicate-role-id",
  result: AuthoringProfileResolutionDiagnostic[],
): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) result.push(diagnostic(code, `duplicate opaque option ID: ${value}`));
    seen.add(value);
  }
}

function requiredTermId(term: ResolvedAuthoringTerm): string {
  if (!term.termId) throw new Error(`resolved vocabulary term requires termId: ${term.iri}`);
  return term.termId;
}

function isArtifact(value: unknown, expected: "profile" | "vocabulary"):
  value is AuthoringProfileManifestV1 | AuthoringVocabularyManifestV1 {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  if (item.schemaVersion !== "1") return false;
  if (expected === "profile") {
    return item.kind === "iriograph.authoring-profile"
      && typeof item.profileId === "string"
      && typeof item.profileVersion === "string"
      && typeof item.profileRef === "string"
      && Array.isArray(item.imports)
      && typeof item.termPolicy === "object"
      && typeof item.structuredAuthoring === "object";
  }
  return item.kind === "iriograph.authoring-vocabulary"
    && typeof item.vocabularyId === "string"
    && typeof item.vocabularyVersion === "string"
    && typeof item.vocabularyRef === "string"
    && Array.isArray(item.terms);
}

function exactVersion(ref: string): string | undefined {
  return EXACT_VERSION.exec(ref)?.[1];
}

function sourceText(value: CatalogRawSource): string {
  if (typeof value === "string") return value;
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

async function fingerprintFor(artifacts: readonly ResolvedAuthoringArtifact[]): Promise<string> {
  return computeCatalogIntegrity(JSON.stringify(artifacts.map((entry) => [entry.ref, entry.integrity])));
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function diagnostic(
  code: AuthoringProfileResolutionDiagnostic["code"],
  message: string,
  artifactRef?: string,
): AuthoringProfileResolutionDiagnostic {
  return { severity: "error", code, message, ...(artifactRef ? { artifactRef } : {}) };
}

function failure(
  code: AuthoringProfileResolutionDiagnostic["code"],
  message: string,
  ref?: string,
): AuthoringProfileResolutionResult {
  return { accepted: false, diagnostics: [diagnostic(code, message, ref)], readable: true };
}

function sortDiagnostics(
  diagnostics: readonly AuthoringProfileResolutionDiagnostic[],
): AuthoringProfileResolutionDiagnostic[] {
  return [...diagnostics].sort((a, b) => compare(`${a.code}\0${a.artifactRef ?? ""}\0${a.message}`, `${b.code}\0${b.artifactRef ?? ""}\0${b.message}`));
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
