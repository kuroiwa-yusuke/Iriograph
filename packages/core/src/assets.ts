import { sortDiagnostics } from "./diagnostics.js";
import { packageDefaultIconDataUrl } from "./default-icons.js";
import type {
  AssetDefinition,
  AssetMediaType,
  DiagramScene,
  ProjectionDiagnostic,
} from "./model.js";

export type AssetPolicy = {
  allowedMediaTypes: readonly AssetMediaType[];
  maxBytes: number;
  allowedSchemes: readonly string[];
  allowedOrigins: readonly string[];
};

export type AssetResolveRequest = {
  assetRef: string;
  definition?: AssetDefinition;
  revision: string;
  signal: AbortSignal;
};

export type AssetLease = {
  /** Absolute URL safe to pass to an image renderer for this lease's lifetime. */
  url: string;
  /** Actual media type observed by the host resolver, not only catalog metadata. */
  mediaType: string;
  /** Actual fetched byte length observed by the host resolver. */
  byteLength: number;
  /** Must be idempotent. Direct immutable URLs may use a no-op. */
  release(): void;
};

export type AssetResolveResult =
  | { status: "resolved"; lease: AssetLease }
  | {
      status: "unresolved";
      reason: "not-found" | "moved" | "deleted" | "unavailable";
      replacementAssetRef?: string;
      message?: string;
    };

export interface AssetResolver {
  resolve(request: AssetResolveRequest): Promise<AssetResolveResult>;
}

export type AssetAccess = {
  resolver: AssetResolver;
  policy: AssetPolicy;
  /** Host-controlled invalidation token, for example a workspace manifest revision. */
  revision: string;
};

export type SceneAssetBatch = {
  scene: DiagramScene;
  /** Asset-only diagnostics; they are also present in scene.diagnostics. */
  diagnostics: ProjectionDiagnostic[];
  /** Releases every adopted URL lease exactly once. */
  release(): void;
};

type Resolution = {
  assetRef: string;
  lease?: AssetLease;
  diagnostic?: ProjectionDiagnostic;
};

/**
 * Resolves a completed Scene's icon IRIs without mutating semantic projection,
 * layout, or the input Scene. Asset failures are warning-only display fallback.
 */
export async function resolveDiagramSceneAssets(
  scene: DiagramScene,
  definitions: Readonly<Record<string, AssetDefinition>>,
  access: AssetAccess,
  signal: AbortSignal,
): Promise<SceneAssetBatch> {
  const output = cloneScene(scene);
  for (const node of output.nodes) {
    const trustedPackageUrl = node.iconRef ? packageDefaultIconDataUrl(node.iconRef) : undefined;
    if (trustedPackageUrl) node.iconUrl = trustedPackageUrl;
    else delete node.iconUrl;
  }

  const semanticRefsByAsset = new Map<string, string[]>();
  for (const node of output.nodes) {
    if (!node.iconRef || node.iconUrl) continue;
    const semanticRefs = semanticRefsByAsset.get(node.iconRef) ?? [];
    semanticRefs.push(node.semanticRef);
    semanticRefsByAsset.set(node.iconRef, semanticRefs);
  }

  const assetRefs = [...semanticRefsByAsset.keys()].sort(compareText);
  const resolutions = await Promise.all(assetRefs.map(async (assetRef) => resolveOne(
    assetRef,
    definitions[assetRef],
    access,
    signal,
    [...(semanticRefsByAsset.get(assetRef) ?? [])].sort(compareText)[0],
  )));
  const leases = new Map<string, AssetLease>();
  const diagnostics: ProjectionDiagnostic[] = [];

  for (const resolution of resolutions) {
    if (resolution.diagnostic) diagnostics.push(resolution.diagnostic);
    if (!resolution.lease) continue;
    leases.set(resolution.assetRef, resolution.lease);
  }
  for (const node of output.nodes) {
    if (!node.iconRef || node.iconUrl) continue;
    node.iconUrl = leases.get(node.iconRef)?.url;
  }

  const sortedDiagnostics = sortDiagnostics(diagnostics);
  output.diagnostics = sortDiagnostics([...output.diagnostics, ...sortedDiagnostics]);
  let released = false;
  return {
    scene: output,
    diagnostics: sortedDiagnostics,
    release() {
      if (released) return;
      released = true;
      for (const lease of leases.values()) safelyRelease(lease);
      leases.clear();
    },
  };
}

async function resolveOne(
  assetRef: string,
  definition: AssetDefinition | undefined,
  access: AssetAccess,
  signal: AbortSignal,
  semanticRef: string | undefined,
): Promise<Resolution> {
  if (signal.aborted) {
    return failure(assetRef, semanticRef, "asset-resolution-aborted", "assetの解決を中止しました。");
  }

  let result: unknown;
  try {
    result = await access.resolver.resolve({
      assetRef,
      definition,
      revision: access.revision,
      signal,
    });
  } catch (cause) {
    return failure(
      assetRef,
      semanticRef,
      signal.aborted || isAbortError(cause)
        ? "asset-resolution-aborted"
        : "asset-resolver-failed",
      signal.aborted || isAbortError(cause)
        ? "assetの解決を中止しました。"
        : `asset resolverが失敗しました: ${errorMessage(cause)}`,
    );
  }

  if (!isRecord(result) || (result.status !== "resolved" && result.status !== "unresolved")) {
    return failure(assetRef, semanticRef, "asset-result-invalid", "asset resolverのresultが不正です。");
  }

  if (result.status === "unresolved") {
    if (
      !isUnresolvedReason(result.reason)
      || (result.replacementAssetRef !== undefined && typeof result.replacementAssetRef !== "string")
      || (result.message !== undefined && typeof result.message !== "string")
    ) {
      return failure(assetRef, semanticRef, "asset-result-invalid", "asset resolverのunresolved resultが不正です。");
    }
    const detail = result.message ? ` ${result.message}` : "";
    const replacement = result.replacementAssetRef
      ? ` replacement: ${result.replacementAssetRef}`
      : "";
    return failure(
      assetRef,
      semanticRef,
      unresolvedCode(result.reason),
      `assetを解決できませんでした (${result.reason}).${detail}${replacement}`,
    );
  }

  if (!("lease" in result) || !isRecord(result.lease)) {
    return failure(assetRef, semanticRef, "asset-result-invalid", "asset resolverのresolved resultが不正です。");
  }
  const lease = result.lease as unknown as AssetLease;
  if (signal.aborted) {
    safelyReleaseUnknown(lease);
    return failure(assetRef, semanticRef, "asset-resolution-aborted", "assetの解決を中止しました。");
  }

  const diagnostic = validateLease(
    assetRef,
    semanticRef,
    definition,
    lease,
    access.policy,
  );
  if (diagnostic) {
    safelyReleaseUnknown(lease);
    return { assetRef, diagnostic };
  }
  return { assetRef, lease };
}

function validateLease(
  assetRef: string,
  semanticRef: string | undefined,
  definition: AssetDefinition | undefined,
  lease: AssetLease,
  policy: AssetPolicy,
): ProjectionDiagnostic | undefined {
  if (
    !lease
    || typeof lease.url !== "string"
    || typeof lease.release !== "function"
    || typeof lease.mediaType !== "string"
    || !Number.isSafeInteger(lease.byteLength)
    || lease.byteLength < 0
  ) {
    return diagnostic(assetRef, semanticRef, "asset-result-invalid", "asset resolverのresultが不正です。");
  }
  if (definition && lease.mediaType !== definition.mediaType) {
    return diagnostic(
      assetRef,
      semanticRef,
      "asset-media-type-mismatch",
      `取得media type ${lease.mediaType}がcatalog宣言 ${definition.mediaType}と一致しません。`,
    );
  }
  if (!policy.allowedMediaTypes.some((mediaType) => mediaType === lease.mediaType)) {
    return diagnostic(
      assetRef,
      semanticRef,
      "asset-media-type-disallowed",
      `media typeが許可されていません: ${lease.mediaType}`,
    );
  }
  if (!Number.isSafeInteger(policy.maxBytes) || policy.maxBytes <= 0) {
    return diagnostic(assetRef, semanticRef, "asset-policy-invalid", "maxBytes policyが不正です。");
  }
  if (lease.byteLength > policy.maxBytes) {
    return diagnostic(
      assetRef,
      semanticRef,
      "asset-byte-limit-exceeded",
      `asset size ${lease.byteLength} bytesが上限 ${policy.maxBytes} bytesを超えています。`,
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(lease.url);
  } catch {
    return diagnostic(assetRef, semanticRef, "asset-url-invalid", "asset URLはabsolute URLである必要があります。");
  }
  if (!accessList(policy.allowedSchemes).has(parsed.protocol)) {
    return diagnostic(
      assetRef,
      semanticRef,
      "asset-url-scheme-disallowed",
      `asset URL schemeが許可されていません: ${parsed.protocol}`,
    );
  }
  if (!policy.allowedOrigins.includes(parsed.origin)) {
    return diagnostic(
      assetRef,
      semanticRef,
      "asset-url-origin-disallowed",
      `asset URL originが許可されていません: ${parsed.origin}`,
    );
  }
  return undefined;
}

function unresolvedCode(reason: Extract<AssetResolveResult, { status: "unresolved" }>["reason"]): string {
  if (reason === "moved") return "asset-moved";
  if (reason === "deleted") return "asset-deleted";
  if (reason === "not-found") return "asset-unresolved";
  return "asset-unavailable";
}

function isUnresolvedReason(
  value: unknown,
): value is Extract<AssetResolveResult, { status: "unresolved" }>["reason"] {
  return value === "not-found"
    || value === "moved"
    || value === "deleted"
    || value === "unavailable";
}

function failure(
  assetRef: string,
  semanticRef: string | undefined,
  code: string,
  message: string,
): Resolution {
  return { assetRef, diagnostic: diagnostic(assetRef, semanticRef, code, message) };
}

function diagnostic(
  assetRef: string,
  semanticRef: string | undefined,
  code: string,
  message: string,
): ProjectionDiagnostic {
  return {
    severity: "warning",
    code,
    message: `${assetRef}: ${message}`,
    assetRef,
    semanticRef,
  };
}

function accessList(values: readonly string[]): Set<string> {
  return new Set(values.map((value) => value.endsWith(":") ? value : `${value}:`));
}

function safelyRelease(lease: Pick<AssetLease, "release">): void {
  try {
    lease.release();
  } catch {
    // Release is best effort at a host boundary and must not mask the result.
  }
}

function safelyReleaseUnknown(value: unknown): void {
  if (!isRecord(value) || typeof value.release !== "function") return;
  safelyRelease({ release: value.release as () => void });
}

function isAbortError(cause: unknown): boolean {
  return cause instanceof Error && cause.name === "AbortError";
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneScene(scene: DiagramScene): DiagramScene {
  return JSON.parse(JSON.stringify(scene)) as DiagramScene;
}
