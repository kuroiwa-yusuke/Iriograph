import {
  DEFAULT_ASSET_MAX_DECODED_PIXELS,
  type AssetAccess,
  type AssetLease,
  type AssetMediaType,
  type AssetResolveRequest,
  type AssetResolveResult,
  type AssetResolver,
} from "@iriograph/core";
import {
  createStaticWorkspaceLocator,
  type WorkspaceLocator,
} from "@iriograph/vue-editor";

import type {
  MockWorkspaceEntry,
  MockWorkspaceManifest,
} from "./workspace";
import { translateMockMessage, type MockLocale } from "./localization";

type FetchAsset = (
  input: string,
  init: { signal: AbortSignal },
) => Promise<Response>;

type ObjectUrlApi = {
  create(blob: Blob): string;
  revoke(url: string): void;
};

type CachedAsset = {
  key: string;
  url: string;
  mediaType: string;
  byteLength: number;
  intrinsicSize?: {
    width: number;
    height: number;
    aspectRatio: number;
  };
  svgViewBox?: string;
  references: number;
};

export type MockAssetHost = {
  access: AssetAccess;
  dispose(): void;
};

export type MockAssetResolverOptions = {
  baseUrl: string;
  locale?: MockLocale;
  fetchAsset?: FetchAsset;
  objectUrls?: ObjectUrlApi;
  decodeIntrinsicSize?: (
    blob: Blob,
    signal: AbortSignal,
  ) => Promise<{ width: number; height: number } | undefined>;
};

export const MOCK_ALLOWED_ASSET_MEDIA_TYPES: readonly AssetMediaType[] = [
  "image/svg+xml",
  "image/png",
  "image/jpeg",
  "image/webp",
];
// Byte transport and decoded pixel area are independent limits: large reports
// may compress well, while tiny compressed files may decode to unsafe surfaces.
const MAX_ASSET_BYTES = 16 * 1024 * 1024;
const MAX_SVG_OPENING_TAG_LENGTH = 8192;

export function createMockAssetHost(
  workspace: MockWorkspaceManifest,
  options: MockAssetResolverOptions,
): MockAssetHost {
  const resolver = new MockWorkspaceAssetResolver(workspace, options);
  const origin = new URL(options.baseUrl).origin;
  return {
    access: {
      resolver,
      revision: workspaceRevision(workspace),
      policy: {
        allowedMediaTypes: MOCK_ALLOWED_ASSET_MEDIA_TYPES,
        maxBytes: MAX_ASSET_BYTES,
        maxDecodedPixels: DEFAULT_ASSET_MAX_DECODED_PIXELS,
        allowedSchemes: ["blob:"],
        allowedOrigins: [origin],
      },
    },
    dispose() {
      resolver.dispose();
    },
  };
}

/** Manifest metadata adapter for path completion. No bytes or URLs cross this port. */
export function createMockWorkspaceLocator(workspace: MockWorkspaceManifest): WorkspaceLocator {
  return createStaticWorkspaceLocator(workspace.entries.flatMap((entry) => (
    entry.kind === "asset" && entry.assetRef && isMockAssetMediaType(entry.mediaType)
      ? [{
          path: entry.path,
          assetRef: entry.assetRef,
          label: entry.path.split("/").at(-1) ?? entry.path,
          mediaType: entry.mediaType,
        }]
      : []
  )));
}

/** Browser host resolver: workspace manifest source -> verified Blob URL lease. */
export class MockWorkspaceAssetResolver implements AssetResolver {
  private readonly entries: ReadonlyMap<string, MockWorkspaceEntry>;
  private readonly fetchAsset: FetchAsset;
  private readonly objectUrls: ObjectUrlApi;
  private readonly cache = new Map<string, CachedAsset>();
  private disposed = false;

  constructor(
    workspace: MockWorkspaceManifest,
    private readonly options: MockAssetResolverOptions,
  ) {
    const entries = workspace.entries.filter(
      (entry): entry is MockWorkspaceEntry & { assetRef: string } => (
        entry.kind === "asset" && typeof entry.assetRef === "string"
      ),
    );
    const duplicates = duplicateAssetRefs(entries.map((entry) => entry.assetRef));
    if (duplicates.length > 0) {
      throw new Error(translateMockMessage(options.locale ?? "en", "assetRefDuplicates", {
        refs: duplicates.join(", "),
      }));
    }
    this.entries = new Map(entries.map((entry) => [entry.assetRef, entry]));
    this.fetchAsset = options.fetchAsset ?? ((input, init) => fetch(input, init));
    this.objectUrls = options.objectUrls ?? {
      create: (blob) => URL.createObjectURL(blob),
      revoke: (url) => URL.revokeObjectURL(url),
    };
  }

  async resolve(request: AssetResolveRequest): Promise<AssetResolveResult> {
    if (this.disposed) {
      return { status: "unresolved", reason: "unavailable", message: "resolver disposed" };
    }
    throwIfAborted(request.signal);
    const workspaceEntry = this.entries.get(request.assetRef);
    // Catalog URL/mediaType are untrusted hints. This host resolves only refs in
    // its workspace manifest and never fetches a catalog URL directly.
    const source = workspaceEntry?.url;
    if (!source) return { status: "unresolved", reason: "not-found" };

    let sourceUrl: string;
    try {
      const parsedSource = new URL(source, this.options.baseUrl);
      const baseOrigin = new URL(this.options.baseUrl).origin;
      if (
        (parsedSource.protocol !== "https:" && parsedSource.protocol !== "http:")
        || parsedSource.origin !== baseOrigin
      ) {
        return {
          status: "unresolved",
          reason: "unavailable",
          message: "workspace asset source scheme/origin is not allowed",
        };
      }
      sourceUrl = parsedSource.href;
    } catch {
      return { status: "unresolved", reason: "unavailable", message: "asset source URL is invalid" };
    }
    const key = JSON.stringify([request.revision, request.assetRef, sourceUrl]);
    const cached = this.cache.get(key);
    if (cached) return { status: "resolved", lease: this.acquire(cached) };

    let response: Response;
    try {
      response = await this.fetchAsset(sourceUrl, { signal: request.signal });
    } catch (cause) {
      if (request.signal.aborted || isAbortError(cause)) throw cause;
      return {
        status: "unresolved",
        reason: "unavailable",
        message: cause instanceof Error ? cause.message : String(cause),
      };
    }
    if (!response.ok) {
      return {
        status: "unresolved",
        reason: workspaceEntry && response.status === 404 ? "deleted" : "unavailable",
        message: `HTTP ${response.status}`,
      };
    }
    const blob = await response.blob();
    throwIfAborted(request.signal);
    if (this.disposed) {
      return { status: "unresolved", reason: "unavailable", message: "resolver disposed" };
    }
    const mediaType = normalizeMediaType(blob.type || response.headers.get("content-type") || "");
    // Do not decode a byte-oversized response merely to discover metadata.
    // Core still receives the observed byte length and emits the policy diagnostic.
    const metadata = blob.size > MAX_ASSET_BYTES
      ? { status: "resolved" as const, value: {} }
      : await this.resolveIntrinsicMetadata(blob, mediaType, request.signal);
    if (metadata.status === "decode-failed") {
      return {
        status: "unresolved",
        reason: "decode-failed",
        message: metadata.message,
      };
    }
    throwIfAborted(request.signal);
    if (this.disposed) {
      return { status: "unresolved", reason: "unavailable", message: "resolver disposed" };
    }
    const created: CachedAsset = {
      key,
      url: this.objectUrls.create(blob),
      mediaType,
      byteLength: blob.size,
      ...metadata.value,
      references: 0,
    };
    const raced = this.cache.get(key);
    if (raced) {
      this.objectUrls.revoke(created.url);
      return { status: "resolved", lease: this.acquire(raced) };
    }
    this.cache.set(key, created);
    return { status: "resolved", lease: this.acquire(created) };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const entry of this.cache.values()) this.objectUrls.revoke(entry.url);
    this.cache.clear();
  }

  private acquire(entry: CachedAsset): AssetLease {
    entry.references += 1;
    let released = false;
    return {
      url: entry.url,
      mediaType: entry.mediaType,
      byteLength: entry.byteLength,
      ...(entry.intrinsicSize ? { intrinsicSize: { ...entry.intrinsicSize } } : {}),
      ...(entry.svgViewBox !== undefined ? { svgViewBox: entry.svgViewBox } : {}),
      release: () => {
        if (released) return;
        released = true;
        entry.references = Math.max(0, entry.references - 1);
        if (entry.references > 0 || this.cache.get(entry.key) !== entry) return;
        this.cache.delete(entry.key);
        this.objectUrls.revoke(entry.url);
      },
    };
  }

  private async resolveIntrinsicMetadata(
    blob: Blob,
    mediaType: string,
    signal: AbortSignal,
  ): Promise<
    | { status: "resolved"; value: Pick<CachedAsset, "intrinsicSize" | "svgViewBox"> }
    | { status: "decode-failed"; message: string }
  > {
    if (mediaType === "image/svg+xml") {
      const viewBox = extractSvgViewBox(await blob.text());
      throwIfAborted(signal);
      if (viewBox !== undefined) {
        return { status: "resolved", value: { svgViewBox: viewBox } };
      }
      return { status: "resolved", value: {} };
    }
    if (!isMockAssetMediaType(mediaType)) return { status: "resolved", value: {} };
    try {
      const decoded = await (this.options.decodeIntrinsicSize ?? decodeWithImageBitmap)(blob, signal);
      throwIfAborted(signal);
      if (!decoded) return { status: "resolved", value: {} };
      return {
        status: "resolved",
        value: {
          intrinsicSize: {
            width: decoded.width,
            height: decoded.height,
            aspectRatio: decoded.width / decoded.height,
          },
        },
      };
    } catch (cause) {
      if (signal.aborted || isAbortError(cause)) throw cause;
      return {
        status: "decode-failed",
        message: cause instanceof Error ? cause.message : String(cause),
      };
    }
  }
}

export function isMockAssetMediaType(value: string): value is AssetMediaType {
  return MOCK_ALLOWED_ASSET_MEDIA_TYPES.includes(value as AssetMediaType);
}

export function workspaceAssetPickResult(
  entry: MockWorkspaceEntry,
  allowedMediaTypes: readonly AssetMediaType[],
): { status: "selected"; assetRef: string } | undefined {
  if (
    entry.kind !== "asset"
    || !entry.assetRef
    || !allowedMediaTypes.includes(entry.mediaType as AssetMediaType)
  ) return undefined;
  return { status: "selected", assetRef: entry.assetRef };
}

function workspaceRevision(workspace: MockWorkspaceManifest): string {
  return JSON.stringify([
    workspace.workspaceId,
    ...workspace.entries
      .filter((entry) => entry.kind === "asset")
      .map((entry) => [entry.assetRef, entry.path, entry.url, entry.mediaType])
      .sort(([left], [right]) => compareText(left ?? "", right ?? "")),
  ]);
}

function duplicateAssetRefs(assetRefs: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const assetRef of assetRefs) {
    if (seen.has(assetRef)) duplicates.add(assetRef);
    seen.add(assetRef);
  }
  return [...duplicates].sort(compareText);
}

function normalizeMediaType(value: string): string {
  return value.split(";", 1)[0]!.trim().toLowerCase();
}

function extractSvgViewBox(source: string): string | undefined {
  const openingStart = source.search(/<svg\b/iu);
  if (openingStart < 0) return undefined;
  const openingEnd = source.indexOf(">", openingStart);
  if (
    openingEnd < 0
    || openingEnd - openingStart > MAX_SVG_OPENING_TAG_LENGTH
  ) return undefined;
  const openingTag = source.slice(openingStart, openingEnd + 1);
  return /\bviewBox\s*=\s*(["'])(.*?)\1/isu.exec(openingTag)?.[2];
}

async function decodeWithImageBitmap(
  blob: Blob,
  signal: AbortSignal,
): Promise<{ width: number; height: number } | undefined> {
  if (typeof globalThis.createImageBitmap !== "function") return undefined;
  throwIfAborted(signal);
  const bitmap = await globalThis.createImageBitmap(blob);
  try {
    throwIfAborted(signal);
    return { width: bitmap.width, height: bitmap.height };
  } finally {
    bitmap.close();
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  const error = new Error("Asset resolution aborted");
  error.name = "AbortError";
  throw error;
}

function isAbortError(cause: unknown): boolean {
  return cause instanceof Error && cause.name === "AbortError";
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
