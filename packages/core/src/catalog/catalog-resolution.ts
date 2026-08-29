import type {
  AssetDefinition,
  CatalogDefaults,
  CatalogImport,
  ProjectionCatalogV1,
  ProjectionRule,
  VisualStyleOverride,
  VisualTemplate,
} from "../document/model.js";
import { parseProjectionCatalogV1 } from "../document/schema.js";

export type CatalogRawSource = string | Uint8Array | ArrayBuffer;

export interface ProjectionCatalogResolver {
  resolveCatalog(catalogRef: string): Promise<CatalogRawSource>;
}

export type CatalogResolutionDiagnostic = {
  severity: "error";
  code:
    | "catalog-ref-invalid"
    | "catalog-import-duplicate-ref"
    | "catalog-integrity-invalid"
    | "catalog-fetch-failed"
    | "catalog-crypto-unavailable"
    | "catalog-integrity-mismatch"
    | "catalog-decode-failed"
    | "catalog-json-invalid"
    | "catalog-schema-invalid"
    | "catalog-ref-identity-mismatch"
    | "catalog-duplicate-identity"
    | "catalog-rule-id-conflict"
    | "catalog-template-conflict"
    | "catalog-style-conflict"
    | "catalog-asset-conflict"
    | "catalog-defaults-missing"
    | "catalog-defaults-conflict";
  message: string;
  catalogRef?: string;
  relatedCatalogRefs?: string[];
};

export type ResolvedProjectionCatalog = {
  catalogRef: string;
  requestedIntegrity?: string;
  computedIntegrity: string;
  catalog: ProjectionCatalogV1;
};

export type ProjectionRuleOrigin = {
  qualifiedRuleId: string;
  catalogRef: string;
  localRuleId: string;
};

export type MergedProjectionCatalog = {
  profileRef: string;
  sourceCatalogRefs: string[];
  catalog: ProjectionCatalogV1;
  ruleOrigins: ProjectionRuleOrigin[];
};

export type CatalogResolutionResult =
  | {
      accepted: true;
      catalogs: ResolvedProjectionCatalog[];
      mergedByProfile: MergedProjectionCatalog[];
      diagnostics: [];
    }
  | {
      accepted: false;
      diagnostics: CatalogResolutionDiagnostic[];
    };

type PreparedImport = {
  catalogRef: string;
  catalogId: string;
  version: string;
  integrity?: string;
};

type LoadedCatalog = PreparedImport & ResolvedProjectionCatalog;

const INTEGRITY_PATTERN = /^sha256-([A-Za-z0-9+/]+={0,2})$/u;

/**
 * Resolves immutable catalog references at the host boundary, verifies their raw
 * bytes, validates v1 JSON, then merges catalogs without order-based precedence.
 */
export async function resolveProjectionCatalogImports(
  imports: readonly CatalogImport[],
  resolver: ProjectionCatalogResolver,
): Promise<CatalogResolutionResult> {
  const preparedResult = prepareImports(imports);
  if (!preparedResult.accepted) return preparedResult;

  const loadedResults = await Promise.all(
    preparedResult.imports.map((entry) => loadCatalog(entry, resolver)),
  );
  const loadDiagnostics = loadedResults.flatMap((result) => result.diagnostics);
  const catalogs = loadedResults.flatMap((result) => result.catalog ? [result.catalog] : []);
  const identityDiagnostics = validateResolvedIdentities(catalogs);
  if (loadDiagnostics.length > 0 || identityDiagnostics.length > 0) {
    return {
      accepted: false,
      diagnostics: sortDiagnostics([...loadDiagnostics, ...identityDiagnostics]),
    };
  }

  const mergeResult = mergeProjectionCatalogs(catalogs);
  const diagnostics = sortDiagnostics(mergeResult.diagnostics);
  if (diagnostics.length > 0 || !mergeResult.mergedByProfile) {
    return { accepted: false, diagnostics };
  }

  return {
    accepted: true,
    catalogs: catalogs.map(({ catalogRef, integrity, computedIntegrity, catalog }) => ({
      catalogRef,
      requestedIntegrity: integrity,
      computedIntegrity,
      catalog,
    })),
    mergedByProfile: mergeResult.mergedByProfile,
    diagnostics: [],
  };
}

/** Computes the exact integrity token accepted by catalog imports. */
export async function computeCatalogIntegrity(source: CatalogRawSource): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("Web Crypto SubtleCrypto is unavailable");
  const bytes = sourceBytes(source);
  const digest = await subtle.digest("SHA-256", ownedArrayBuffer(bytes));
  return `sha256-${encodeBase64(new Uint8Array(digest))}`;
}

function prepareImports(imports: readonly CatalogImport[]):
  | { accepted: true; imports: PreparedImport[] }
  | { accepted: false; diagnostics: CatalogResolutionDiagnostic[] } {
  const diagnostics: CatalogResolutionDiagnostic[] = [];
  const refs = new Map<string, number>();
  const prepared: PreparedImport[] = [];

  imports.forEach((catalogImport, index) => {
    const previous = refs.get(catalogImport.catalogRef);
    if (previous !== undefined) {
      diagnostics.push({
        severity: "error",
        code: "catalog-import-duplicate-ref",
        message: `catalogRef is duplicated at imports[${previous}] and imports[${index}]: ${catalogImport.catalogRef}`,
        catalogRef: catalogImport.catalogRef,
      });
      return;
    }
    refs.set(catalogImport.catalogRef, index);

    const identity = parseVersionedCatalogRef(catalogImport.catalogRef);
    if (!identity) {
      diagnostics.push({
        severity: "error",
        code: "catalog-ref-invalid",
        message: `catalogRef must end in an exact @version: ${catalogImport.catalogRef}`,
        catalogRef: catalogImport.catalogRef,
      });
      return;
    }
    if (catalogImport.integrity && !normalizeIntegrity(catalogImport.integrity)) {
      diagnostics.push({
        severity: "error",
        code: "catalog-integrity-invalid",
        message: `integrity must be a single sha256-base64 token: ${catalogImport.integrity}`,
        catalogRef: catalogImport.catalogRef,
      });
      return;
    }
    prepared.push({
      catalogRef: catalogImport.catalogRef,
      catalogId: identity.catalogId,
      version: identity.version,
      integrity: catalogImport.integrity,
    });
  });

  if (diagnostics.length > 0) {
    return { accepted: false, diagnostics: sortDiagnostics(diagnostics) };
  }
  prepared.sort((left, right) => compareText(left.catalogRef, right.catalogRef));
  return { accepted: true, imports: prepared };
}

async function loadCatalog(
  entry: PreparedImport,
  resolver: ProjectionCatalogResolver,
): Promise<{ catalog?: LoadedCatalog; diagnostics: CatalogResolutionDiagnostic[] }> {
  let source: CatalogRawSource;
  try {
    source = await resolver.resolveCatalog(entry.catalogRef);
  } catch (cause) {
    return failure(
      "catalog-fetch-failed",
      `catalog resolver failed: ${errorMessage(cause)}`,
      entry.catalogRef,
    );
  }

  let computedIntegrity: string;
  try {
    computedIntegrity = await computeCatalogIntegrity(source);
  } catch (cause) {
    return failure(
      "catalog-crypto-unavailable",
      `catalog integrity could not be computed: ${errorMessage(cause)}`,
      entry.catalogRef,
    );
  }
  const requestedIntegrity = entry.integrity && normalizeIntegrity(entry.integrity);
  if (requestedIntegrity && requestedIntegrity !== normalizeIntegrity(computedIntegrity)) {
    return failure(
      "catalog-integrity-mismatch",
      `catalog integrity mismatch; expected ${entry.integrity}, received ${computedIntegrity}`,
      entry.catalogRef,
    );
  }

  let text: string;
  try {
    text = sourceText(source);
  } catch (cause) {
    return failure(
      "catalog-decode-failed",
      `catalog is not valid UTF-8: ${errorMessage(cause)}`,
      entry.catalogRef,
    );
  }

  let json: unknown;
  try {
    json = JSON.parse(text) as unknown;
  } catch (cause) {
    return failure(
      "catalog-json-invalid",
      `catalog is not valid JSON: ${errorMessage(cause)}`,
      entry.catalogRef,
    );
  }

  let catalog: ProjectionCatalogV1;
  try {
    catalog = parseProjectionCatalogV1(json);
  } catch (cause) {
    return failure(
      "catalog-schema-invalid",
      `catalog does not satisfy ProjectionCatalogV1: ${errorMessage(cause)}`,
      entry.catalogRef,
    );
  }

  if (catalog.catalogId !== entry.catalogId || catalog.catalogVersion !== entry.version) {
    return {
      catalog: {
        ...entry,
        requestedIntegrity: entry.integrity,
        computedIntegrity,
        catalog,
      },
      diagnostics: [{
        severity: "error",
        code: "catalog-ref-identity-mismatch",
        message: `catalogRef ${entry.catalogRef} resolved to ${catalog.catalogId}@${catalog.catalogVersion}`,
        catalogRef: entry.catalogRef,
      }],
    };
  }

  return {
    catalog: {
      ...entry,
      requestedIntegrity: entry.integrity,
      computedIntegrity,
      catalog,
    },
    diagnostics: [],
  };
}

function validateResolvedIdentities(catalogs: readonly LoadedCatalog[]): CatalogResolutionDiagnostic[] {
  const refsByIdentity = new Map<string, string[]>();
  for (const entry of catalogs) {
    const key = JSON.stringify([entry.catalog.catalogId, entry.catalog.catalogVersion]);
    const refs = refsByIdentity.get(key) ?? [];
    refs.push(entry.catalogRef);
    refsByIdentity.set(key, refs);
  }
  return [...refsByIdentity.values()]
    .filter((refs) => refs.length > 1)
    .map((refs) => ({
      severity: "error" as const,
      code: "catalog-duplicate-identity" as const,
      message: `multiple imports resolved to the same catalog identity: ${refs.join(", ")}`,
      relatedCatalogRefs: [...refs].sort(compareText),
    }));
}

function mergeProjectionCatalogs(catalogs: readonly LoadedCatalog[]): {
  mergedByProfile?: MergedProjectionCatalog[];
  diagnostics: CatalogResolutionDiagnostic[];
} {
  const byProfile = new Map<string, LoadedCatalog[]>();
  for (const entry of catalogs) {
    const group = byProfile.get(entry.catalog.profileRef) ?? [];
    group.push(entry);
    byProfile.set(entry.catalog.profileRef, group);
  }

  const diagnostics: CatalogResolutionDiagnostic[] = [];
  const mergedByProfile: MergedProjectionCatalog[] = [];
  const profiles = [...byProfile.keys()].sort(compareText);
  for (const profileRef of profiles) {
    const entries = [...(byProfile.get(profileRef) ?? [])]
      .sort((left, right) => compareText(left.catalogRef, right.catalogRef));
    const profileDiagnostics = mergeConflicts(entries);
    diagnostics.push(...profileDiagnostics);
    if (profileDiagnostics.length > 0) continue;
    mergedByProfile.push(mergeProfile(profileRef, entries));
  }

  return diagnostics.length > 0
    ? { diagnostics }
    : { mergedByProfile, diagnostics: [] };
}

function mergeConflicts(entries: readonly LoadedCatalog[]): CatalogResolutionDiagnostic[] {
  const diagnostics: CatalogResolutionDiagnostic[] = [];
  diagnostics.push(...keyConflicts(
    entries,
    "catalog-rule-id-conflict",
    (entry) => entry.catalog.rules.map((rule) => rule.ruleId),
    "ruleId",
  ));
  diagnostics.push(...keyConflicts(
    entries,
    "catalog-style-conflict",
    (entry) => Object.keys(entry.catalog.styles ?? {}),
    "styleRef",
  ));
  diagnostics.push(...keyConflicts(
    entries,
    "catalog-template-conflict",
    (entry) => Object.keys(entry.catalog.templates),
    "templateRef",
  ));
  diagnostics.push(...keyConflicts(
    entries,
    "catalog-asset-conflict",
    (entry) => Object.keys(entry.catalog.assets),
    "assetRef",
  ));

  const defaultProviders = entries.filter((entry) => entry.catalog.defaults);
  if (defaultProviders.length === 0) {
    const refs = entries.map((entry) => entry.catalogRef).sort(compareText);
    diagnostics.push({
      severity: "error",
      code: "catalog-defaults-missing",
      message: `profile ${entries[0]?.catalog.profileRef ?? "<unknown>"} has no catalog defaults provider`,
      relatedCatalogRefs: refs,
    });
  } else if (defaultProviders.length > 1) {
    const refs = defaultProviders.map((entry) => entry.catalogRef).sort(compareText);
    diagnostics.push({
      severity: "error",
      code: "catalog-defaults-conflict",
      message: `profile ${entries[0]?.catalog.profileRef ?? "<unknown>"} has defaults in multiple catalogs: ${refs.join(", ")}`,
      relatedCatalogRefs: refs,
    });
  }
  return diagnostics;
}

function keyConflicts(
  entries: readonly LoadedCatalog[],
  code: "catalog-rule-id-conflict" | "catalog-template-conflict" | "catalog-style-conflict" | "catalog-asset-conflict",
  keysFor: (entry: LoadedCatalog) => string[],
  keyName: string,
): CatalogResolutionDiagnostic[] {
  const refsByKey = new Map<string, string[]>();
  for (const entry of entries) {
    for (const key of keysFor(entry)) {
      const refs = refsByKey.get(key) ?? [];
      refs.push(entry.catalogRef);
      refsByKey.set(key, refs);
    }
  }
  return [...refsByKey.entries()]
    .filter(([, refs]) => refs.length > 1)
    .sort(([left], [right]) => compareText(left, right))
    .map(([key, refs]) => {
      const sortedRefs = [...refs].sort(compareText);
      return {
        severity: "error" as const,
        code,
        message: `${keyName} collision for ${key}: ${sortedRefs.join(", ")}`,
        relatedCatalogRefs: sortedRefs,
      };
    });
}

function mergeProfile(profileRef: string, entries: readonly LoadedCatalog[]): MergedProjectionCatalog {
  const rules: ProjectionRule[] = [];
  const ruleOrigins: ProjectionRuleOrigin[] = [];
  const templates: Record<string, VisualTemplate> = {};
  const styles: Record<string, VisualStyleOverride> = {};
  const assets: Record<string, AssetDefinition> = {};
  let defaults: CatalogDefaults | undefined;

  for (const entry of entries) {
    for (const rule of [...entry.catalog.rules].sort((left, right) => compareText(left.ruleId, right.ruleId))) {
      const qualifiedRuleId = qualifyRuleId(entry.catalogRef, rule.ruleId);
      rules.push({ ...clone(rule), ruleId: qualifiedRuleId });
      ruleOrigins.push({ qualifiedRuleId, catalogRef: entry.catalogRef, localRuleId: rule.ruleId });
    }
    for (const key of Object.keys(entry.catalog.templates).sort(compareText)) {
      const template = entry.catalog.templates[key];
      if (template) templates[key] = clone(template);
    }
    for (const key of Object.keys(entry.catalog.styles ?? {}).sort(compareText)) {
      const style = entry.catalog.styles?.[key];
      if (style) styles[key] = clone(style);
    }
    for (const key of Object.keys(entry.catalog.assets).sort(compareText)) {
      const asset = entry.catalog.assets[key];
      if (asset) assets[key] = clone(asset);
    }
    if (entry.catalog.defaults) defaults = clone(entry.catalog.defaults);
  }

  const catalog: ProjectionCatalogV1 = {
    schemaVersion: "1",
    kind: "iriograph.catalog",
    catalogId: `urn:iriograph:resolved-catalog:${encodeBase64Url(textBytes(profileRef))}`,
    catalogVersion: "resolved-v1",
    profileRef,
    rules,
    templates,
    ...(Object.keys(styles).length > 0 ? { styles } : {}),
    assets,
    ...(defaults ? { defaults } : {}),
  };
  return {
    profileRef,
    sourceCatalogRefs: entries.map((entry) => entry.catalogRef),
    catalog,
    ruleOrigins,
  };
}

function qualifyRuleId(catalogRef: string, localRuleId: string): string {
  return `urn:iriograph:catalog-rule:${encodeBase64Url(textBytes(catalogRef))}:${encodeBase64Url(textBytes(localRuleId))}`;
}

function parseVersionedCatalogRef(catalogRef: string): { catalogId: string; version: string } | undefined {
  const separator = catalogRef.lastIndexOf("@");
  if (separator <= catalogRef.indexOf(":") || separator === catalogRef.length - 1) return undefined;
  return { catalogId: catalogRef.slice(0, separator), version: catalogRef.slice(separator + 1) };
}

function normalizeIntegrity(integrity: string): string | undefined {
  const match = INTEGRITY_PATTERN.exec(integrity);
  if (!match?.[1]) return undefined;
  const digest = match[1].replace(/=+$/u, "");
  if (digest.length !== 43) return undefined;
  return `sha256-${digest}`;
}

function sourceBytes(source: CatalogRawSource): Uint8Array {
  if (typeof source === "string") return textBytes(source);
  if (source instanceof ArrayBuffer) return new Uint8Array(source);
  return new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
}

function sourceText(source: CatalogRawSource): string {
  if (typeof source === "string") return source;
  return new TextDecoder("utf-8", { fatal: true }).decode(sourceBytes(source));
}

function textBytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function ownedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function encodeBase64(bytes: Uint8Array): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let result = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1] ?? 0;
    const third = bytes[index + 2] ?? 0;
    const value = (first << 16) | (second << 8) | third;
    result += alphabet[(value >> 18) & 63];
    result += alphabet[(value >> 12) & 63];
    result += index + 1 < bytes.length ? alphabet[(value >> 6) & 63] : "=";
    result += index + 2 < bytes.length ? alphabet[value & 63] : "=";
  }
  return result;
}

function encodeBase64Url(bytes: Uint8Array): string {
  return encodeBase64(bytes).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function failure(
  code: CatalogResolutionDiagnostic["code"],
  message: string,
  catalogRef: string,
): { diagnostics: CatalogResolutionDiagnostic[] } {
  return { diagnostics: [{ severity: "error", code, message, catalogRef }] };
}

function sortDiagnostics(diagnostics: CatalogResolutionDiagnostic[]): CatalogResolutionDiagnostic[] {
  return [...diagnostics].sort((left, right) => {
    return compareText(left.catalogRef ?? left.relatedCatalogRefs?.[0] ?? "", right.catalogRef ?? right.relatedCatalogRefs?.[0] ?? "")
      || compareText(left.code, right.code)
      || compareText(left.message, right.message);
  });
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
