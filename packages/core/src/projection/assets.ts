import { sortDiagnostics } from "./diagnostics.js";
import {
  packageDefaultIconDataUrl,
  packageDefaultIconIntrinsicSize,
} from "../catalog/default-icons.js";
import type {
  AssetDefinition,
  AssetIntrinsicSize,
  AssetMediaType,
  DiagramScene,
  ProjectionDiagnostic,
} from "../document/model.js";

export type AssetPolicy = {
  allowedMediaTypes: readonly AssetMediaType[];
  maxBytes: number;
  /** Maximum adopted decoded raster pixel area. Omitted uses the Core default. */
  maxDecodedPixels?: number;
  /** Maximum simultaneous resolver calls. Omitted uses the Core default. */
  maxConcurrentResolutions?: number;
  allowedSchemes: readonly string[];
  allowedOrigins: readonly string[];
};

export const DEFAULT_ASSET_MAX_DECODED_PIXELS = 64 * 1024 * 1024;
export const DEFAULT_ASSET_RESOLUTION_CONCURRENCY = 4;
export const MAX_ASSET_RESOLUTION_CONCURRENCY = 32;

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
  /** Host-decoded dimensions. Core verifies every number before adoption. */
  intrinsicSize?: Omit<AssetIntrinsicSize, "source"> & { source?: "decoded" };
  /** SVG decoder fallback when decoded dimensions are unavailable. */
  svgViewBox?: string;
  /** Must be idempotent. Direct immutable URLs may use a no-op. */
  release(): void;
};

export type AssetResolveResult =
  | { status: "resolved"; lease: AssetLease }
  | {
      status: "unresolved";
      reason: "not-found" | "moved" | "deleted" | "unavailable" | "decode-failed";
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
  intrinsicSize?: AssetIntrinsicSize;
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
  const iconElements = [
    ...output.nodes,
    ...output.containers.filter((element) => Boolean(element.groupFrame)),
    ...(output.regions ?? []).filter((element) => Boolean(element.groupFrame)),
  ];
  for (const element of iconElements) {
    const trustedPackageUrl = element.iconRef ? packageDefaultIconDataUrl(element.iconRef) : undefined;
    if (trustedPackageUrl) {
      element.iconUrl = trustedPackageUrl;
      element.iconIntrinsicSize = packageDefaultIconIntrinsicSize(element.iconRef!);
    } else {
      delete element.iconUrl;
      delete element.iconIntrinsicSize;
    }
  }

  const semanticRefsByAsset = new Map<string, string[]>();
  for (const element of iconElements) {
    if (!element.iconRef || element.iconUrl) continue;
    const semanticRefs = semanticRefsByAsset.get(element.iconRef) ?? [];
    semanticRefs.push(element.semanticRef);
    semanticRefsByAsset.set(element.iconRef, semanticRefs);
  }

  const assetRefs = [...semanticRefsByAsset.keys()].sort(compareText);
  const resolutions = await resolveWithConcurrency(
    assetRefs,
    effectiveResolutionConcurrency(access.policy),
    async (assetRef) => resolveOne(
      assetRef,
      definitions[assetRef],
      access,
      signal,
      [...(semanticRefsByAsset.get(assetRef) ?? [])].sort(compareText)[0],
    ),
  );
  const leases = new Map<string, AssetLease>();
  const intrinsicSizes = new Map<string, AssetIntrinsicSize>();
  const diagnostics: ProjectionDiagnostic[] = [];

  for (const resolution of resolutions) {
    if (signal.aborted && resolution.lease) {
      safelyRelease(resolution.lease);
      delete resolution.lease;
      resolution.diagnostic ??= diagnostic(
        resolution.assetRef,
        [...(semanticRefsByAsset.get(resolution.assetRef) ?? [])].sort(compareText)[0],
        "asset-resolution-aborted",
        "Asset resolution was aborted.",
      );
    }
    if (resolution.diagnostic) diagnostics.push(resolution.diagnostic);
    if (!resolution.lease) continue;
    leases.set(resolution.assetRef, resolution.lease);
    if (resolution.intrinsicSize) intrinsicSizes.set(resolution.assetRef, resolution.intrinsicSize);
  }
  for (const element of iconElements) {
    if (!element.iconRef || element.iconUrl) continue;
    element.iconUrl = leases.get(element.iconRef)?.url;
    element.iconIntrinsicSize = intrinsicSizes.get(element.iconRef);
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
    return failure(assetRef, semanticRef, "asset-resolution-aborted", "Asset resolution was aborted.");
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
        ? "Asset resolution was aborted."
        : `Asset resolver failed: ${errorMessage(cause)}`,
    );
  }

  if (!isRecord(result) || (result.status !== "resolved" && result.status !== "unresolved")) {
    return failure(assetRef, semanticRef, "asset-result-invalid", "Asset resolver returned an invalid result.");
  }

  if (result.status === "unresolved") {
    if (
      !isUnresolvedReason(result.reason)
      || (result.replacementAssetRef !== undefined && typeof result.replacementAssetRef !== "string")
      || (result.message !== undefined && typeof result.message !== "string")
    ) {
      return failure(assetRef, semanticRef, "asset-result-invalid", "Asset resolver returned an invalid unresolved result.");
    }
    const detail = result.message ? ` ${result.message}` : "";
    const replacement = result.replacementAssetRef
      ? ` replacement: ${result.replacementAssetRef}`
      : "";
    return failure(
      assetRef,
      semanticRef,
      unresolvedCode(result.reason),
      `Asset could not be resolved (${result.reason}).${detail}${replacement}`,
    );
  }

  if (!("lease" in result) || !isRecord(result.lease)) {
    return failure(assetRef, semanticRef, "asset-result-invalid", "Asset resolver returned an invalid resolved result.");
  }
  const lease = result.lease as unknown as AssetLease;
  if (signal.aborted) {
    safelyReleaseUnknown(lease);
    return failure(assetRef, semanticRef, "asset-resolution-aborted", "Asset resolution was aborted.");
  }

  const leaseDiagnostic = validateLease(
    assetRef,
    semanticRef,
    definition,
    lease,
    access.policy,
  );
  if (leaseDiagnostic) {
    safelyReleaseUnknown(lease);
    return { assetRef, diagnostic: leaseDiagnostic };
  }
  const intrinsic = verifyAssetLeaseIntrinsicSize(
    lease,
    access.policy.maxDecodedPixels ?? DEFAULT_ASSET_MAX_DECODED_PIXELS,
  );
  if (intrinsic.status === "invalid") {
    if (intrinsic.code === "asset-decoded-pixel-limit-exceeded") {
      safelyRelease(lease);
      return {
        assetRef,
        diagnostic: diagnostic(
          assetRef,
          semanticRef,
          intrinsic.code,
          intrinsic.message,
        ),
      };
    }
    return {
      assetRef,
      lease,
      diagnostic: diagnosticForIntrinsic(assetRef, semanticRef, intrinsic.message),
    };
  }
  return {
    assetRef,
    lease,
    ...(intrinsic.size ? { intrinsicSize: intrinsic.size } : {}),
  };
}

export type AssetIntrinsicVerification =
  | { status: "verified"; size?: AssetIntrinsicSize }
  | {
      status: "invalid";
      code: "asset-intrinsic-size-invalid" | "asset-decoded-pixel-limit-exceeded";
      message: string;
    };

const MAX_INTRINSIC_DIMENSION = 100_000;
const MIN_ASPECT_RATIO = 0.0001;
const MAX_ASPECT_RATIO = 10_000;

/** Pure, fail-closed verification for transient resolver metadata. */
export function verifyAssetLeaseIntrinsicSize(
  lease: Pick<AssetLease, "mediaType" | "intrinsicSize" | "svgViewBox">,
  maxDecodedPixels = DEFAULT_ASSET_MAX_DECODED_PIXELS,
): AssetIntrinsicVerification {
  if (lease.intrinsicSize !== undefined) {
    const { width, height, aspectRatio } = lease.intrinsicSize;
    if (!validDimension(width) || !validDimension(height) || !validAspectRatio(aspectRatio)) {
      return {
        status: "invalid",
        code: "asset-intrinsic-size-invalid",
        message: "Intrinsic image dimensions are invalid.",
      };
    }
    const derivedRatio = width / height;
    if (Math.abs(derivedRatio - aspectRatio) > Math.max(1e-6, derivedRatio * 1e-6)) {
      return {
        status: "invalid",
        code: "asset-intrinsic-size-invalid",
        message: "Intrinsic aspect ratio does not match width and height.",
      };
    }
    if (!Number.isSafeInteger(maxDecodedPixels) || maxDecodedPixels <= 0) {
      return {
        status: "invalid",
        code: "asset-intrinsic-size-invalid",
        message: "maxDecodedPixels policy is invalid.",
      };
    }
    const decodedPixels = width * height;
    if (
      lease.mediaType !== "image/svg+xml"
      && (!Number.isFinite(decodedPixels) || decodedPixels > maxDecodedPixels)
    ) {
      return {
        status: "invalid",
        code: "asset-decoded-pixel-limit-exceeded",
        message: `Decoded pixel area ${decodedPixels} exceeds the limit ${maxDecodedPixels}.`,
      };
    }
    return {
      status: "verified",
      size: { width, height, aspectRatio: derivedRatio, source: "decoded" },
    };
  }
  if (lease.svgViewBox !== undefined) {
    if (lease.mediaType !== "image/svg+xml") {
      return {
        status: "invalid",
        code: "asset-intrinsic-size-invalid",
        message: "viewBox metadata cannot be used for a non-SVG asset.",
      };
    }
    const size = intrinsicSizeFromSvgViewBox(lease.svgViewBox);
    return size
      ? { status: "verified", size }
      : {
          status: "invalid",
          code: "asset-intrinsic-size-invalid",
          message: "Safe dimensions cannot be derived from the SVG viewBox.",
        };
  }
  // Compatibility for resolvers that do not decode dimensions yet. Renderers
  // must not infer a size from unverified metadata in this case.
  return { status: "verified" };
}

/** Parses the four-number SVG viewBox grammar without accepting markup/URLs. */
export function intrinsicSizeFromSvgViewBox(value: string): AssetIntrinsicSize | undefined {
  if (value.length > 200) return undefined;
  const parts = value.trim().split(/[\s,]+/u);
  if (parts.length !== 4) return undefined;
  const numbers = parts.map(Number);
  if (!numbers.every(Number.isFinite)) return undefined;
  const width = numbers[2]!;
  const height = numbers[3]!;
  if (!validDimension(width) || !validDimension(height)) return undefined;
  const aspectRatio = width / height;
  if (!validAspectRatio(aspectRatio)) return undefined;
  return { width, height, aspectRatio, source: "svg-view-box" };
}

function validDimension(value: number): boolean {
  return Number.isFinite(value) && value > 0 && value <= MAX_INTRINSIC_DIMENSION;
}

function validAspectRatio(value: number): boolean {
  return Number.isFinite(value) && value >= MIN_ASPECT_RATIO && value <= MAX_ASPECT_RATIO;
}

function diagnosticForIntrinsic(
  assetRef: string,
  semanticRef: string | undefined,
  message: string,
): ProjectionDiagnostic {
  return diagnostic(assetRef, semanticRef, "asset-intrinsic-size-invalid", message);
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
    return diagnostic(assetRef, semanticRef, "asset-result-invalid", "Asset resolver returned an invalid result.");
  }
  if (definition && lease.mediaType !== definition.mediaType) {
    return diagnostic(
      assetRef,
      semanticRef,
      "asset-media-type-mismatch",
      `Resolved media type ${lease.mediaType} does not match catalog declaration ${definition.mediaType}.`,
    );
  }
  if (!policy.allowedMediaTypes.some((mediaType) => mediaType === lease.mediaType)) {
    return diagnostic(
      assetRef,
      semanticRef,
      "asset-media-type-disallowed",
      `Media type is not allowed: ${lease.mediaType}`,
    );
  }
  if (!Number.isSafeInteger(policy.maxBytes) || policy.maxBytes <= 0) {
    return diagnostic(assetRef, semanticRef, "asset-policy-invalid", "maxBytes policy is invalid.");
  }
  if (
    policy.maxDecodedPixels !== undefined
    && (!Number.isSafeInteger(policy.maxDecodedPixels) || policy.maxDecodedPixels <= 0)
  ) {
    return diagnostic(assetRef, semanticRef, "asset-policy-invalid", "maxDecodedPixels policy is invalid.");
  }
  if (
    policy.maxConcurrentResolutions !== undefined
    && (
      !Number.isSafeInteger(policy.maxConcurrentResolutions)
      || policy.maxConcurrentResolutions <= 0
      || policy.maxConcurrentResolutions > MAX_ASSET_RESOLUTION_CONCURRENCY
    )
  ) {
    return diagnostic(
      assetRef,
      semanticRef,
      "asset-policy-invalid",
      `maxConcurrentResolutions policy must be between 1 and ${MAX_ASSET_RESOLUTION_CONCURRENCY}.`,
    );
  }
  if (lease.byteLength > policy.maxBytes) {
    return diagnostic(
      assetRef,
      semanticRef,
      "asset-byte-limit-exceeded",
      `Asset size ${lease.byteLength} bytes exceeds the limit ${policy.maxBytes} bytes.`,
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(lease.url);
  } catch {
    return diagnostic(assetRef, semanticRef, "asset-url-invalid", "Asset URL must be absolute.");
  }
  if (!accessList(policy.allowedSchemes).has(parsed.protocol)) {
    return diagnostic(
      assetRef,
      semanticRef,
      "asset-url-scheme-disallowed",
      `Asset URL scheme is not allowed: ${parsed.protocol}`,
    );
  }
  if (!policy.allowedOrigins.includes(parsed.origin)) {
    return diagnostic(
      assetRef,
      semanticRef,
      "asset-url-origin-disallowed",
      `Asset URL origin is not allowed: ${parsed.origin}`,
    );
  }
  return undefined;
}

function unresolvedCode(reason: Extract<AssetResolveResult, { status: "unresolved" }>["reason"]): string {
  if (reason === "moved") return "asset-moved";
  if (reason === "deleted") return "asset-deleted";
  if (reason === "not-found") return "asset-unresolved";
  if (reason === "decode-failed") return "asset-decode-failed";
  return "asset-unavailable";
}

function isUnresolvedReason(
  value: unknown,
): value is Extract<AssetResolveResult, { status: "unresolved" }>["reason"] {
  return value === "not-found"
    || value === "moved"
    || value === "deleted"
    || value === "decode-failed"
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

function effectiveResolutionConcurrency(policy: AssetPolicy): number {
  const value = policy.maxConcurrentResolutions;
  return Number.isSafeInteger(value)
    && value! > 0
    && value! <= MAX_ASSET_RESOLUTION_CONCURRENCY
    ? value!
    : DEFAULT_ASSET_RESOLUTION_CONCURRENCY;
}

async function resolveWithConcurrency<T, U>(
  values: readonly T[],
  concurrency: number,
  resolve: (value: T) => Promise<U>,
): Promise<U[]> {
  if (values.length === 0) return [];
  const results = new Array<U>(values.length);
  let nextIndex = 0;
  const worker = async (): Promise<void> => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= values.length) return;
      results[index] = await resolve(values[index]!);
    }
  };
  await Promise.all(Array.from(
    { length: Math.min(concurrency, values.length) },
    () => worker(),
  ));
  return results;
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
