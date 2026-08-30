export type AwsIconLabel = Readonly<{ ja: string; en: string }>;

export type AwsIconCategory = Readonly<{
  id: string;
  labelJa: string;
  labelEn: string;
}>;

export type AwsIconFallback = Readonly<{
  kind: "category-initial";
  text: string;
  labelJa: string;
  categoryId: string;
  categoryLabelJa: string;
  fill: string;
  textColor: string;
  ariaLabelJa: string;
}>;

export type AwsIconPreview = Readonly<{
  kind: "consumer-supplied-official-svg";
  actualShapeWhenResolved: true;
  assetRef: string;
  templateRef: string;
  viewBox: "0 0 80 80";
  intrinsicWidth: 80;
  intrinsicHeight: 80;
  background: string;
  fit: "contain";
  fallback: AwsIconFallback;
}>;

export type AwsIconEntry = Readonly<{
  assetRef: string;
  templateRef: string;
  mediaType: "image/svg+xml";
  locator: string;
  slug: string;
  aliases: readonly string[];
  label: AwsIconLabel;
  category: AwsIconCategory;
  preview: AwsIconPreview;
  fallback: AwsIconFallback;
  sourceArchivePath: string;
  sourceSha256: string;
  byteLength: number;
  lifecycle: "active";
}>;

export type AwsIconDiagnostic = Readonly<{
  severity: "warning" | "error";
  category: "asset";
  code: string;
  message: string;
  catalogRef?: string;
  assetRef?: string;
  replacementCatalogRef?: string;
  replacementAssetRef?: string;
  sourceUrl?: string;
  suggestedActions?: readonly Readonly<{
    actionId: string;
    parameters: Readonly<Record<string, string>>;
  }>[];
  relatedPaths?: readonly string[];
}>;

export type AwsServiceAliasResolveResult =
  | Readonly<{
      status: "resolved";
      assetRef: string;
      entry: AwsIconEntry;
      diagnostics: readonly AwsIconDiagnostic[];
    }>
  | Readonly<{
      status: "unresolved";
      diagnostics: readonly AwsIconDiagnostic[];
    }>;

export type CatalogRawSource = string | Uint8Array | ArrayBuffer;

export type AwsAssetLease = {
  readonly url: string;
  readonly mediaType: string;
  readonly byteLength: number;
  readonly svgViewBox?: string;
  release(): void;
};

export type AwsAssetResolveResult =
  | { status: "resolved"; lease: AwsAssetLease }
  | {
      status: "unresolved";
      reason: "not-found" | "moved" | "deleted" | "unavailable";
      message: string;
      diagnostic: AwsIconDiagnostic;
      fallback?: AwsIconFallback;
      replacementAssetRef?: string;
    };

export type AwsAssetResolveRequest = Readonly<{
  assetRef: string;
  definition?: unknown;
  revision?: string;
  signal?: AbortSignal;
}>;

export type AwsExpectedAsset = Readonly<{
  assetRef: string;
  catalogRef: string;
  packageVersion: string;
  vendorDistribution: string;
  officialArchiveUrl: string;
  officialArchiveSha256: string;
  sourceArchivePath: string;
  mediaType: "image/svg+xml";
  byteLength: number;
  sha256: string;
  svgViewBox: "0 0 80 80";
  signal?: AbortSignal;
}>;

export type AwsVerifiedAssetUrl = {
  url: string;
  verifiedSha256: string;
  byteLength: number;
  mediaType: "image/svg+xml";
  svgViewBox: "0 0 80 80";
  release?: () => void;
};

export type AwsLocalAssetBytes = Uint8Array | ArrayBuffer | Readonly<{
  bytes: Uint8Array | ArrayBuffer;
}>;

export type AwsLocalAssetPath = string | Readonly<{ path: string }>;
export type AwsLocalAssetSource = AwsLocalAssetBytes | AwsLocalAssetPath;

export type AwsLocalPathRequest = AwsExpectedAsset & Readonly<{ path: string }>;
export type AwsBytesUrlRequest = AwsExpectedAsset & Readonly<{ bytes: Uint8Array }>;

export const AWS_ICON_PACKAGE_VERSION: "0.12.3";
export const AWS_ICON_VENDOR_DISTRIBUTION: "2026-Q3";
export const AWS_ICON_CATALOG_ID: "urn:iriograph:catalog:vendor:aws:architecture-icons";
export const AWS_ICON_CATALOG_VERSION: "2026-q3";
export const AWS_ICON_CATALOG_REF: "urn:iriograph:catalog:vendor:aws:architecture-icons@2026-q3";
export const AWS_ICON_CATALOG_INTEGRITY: "sha256-pnE5NJ2sZGSrRiNBCZ1w2VYrBYHs3R1TEN5TmgoFp/U=";
export const AWS_ICON_ASSET_NAMESPACE: "urn:iriograph:asset:vendor:aws:architecture-icons:2026-q3:";
export const AWS_RESERVED_NAMESPACES: readonly string[];
export const awsIconCatalogSource: string;
export const awsIconCatalogManifest: Readonly<Record<string, unknown>>;
export const awsIconEntries: readonly AwsIconEntry[];
export const awsIconCategories: readonly AwsIconCategory[];

export class AwsIconCatalogError extends Error {
  readonly code: string;
  readonly diagnostic: AwsIconDiagnostic;
  constructor(diagnostic: AwsIconDiagnostic, options?: ErrorOptions);
}

export function listAwsIcons(options?: Readonly<{ categoryId?: string }>): readonly AwsIconEntry[];
export function getAwsIconMetadata(assetRef: string): AwsIconEntry | undefined;
export function getAwsIconFallbackMetadata(assetRef: string): AwsIconFallback | undefined;
export function diagnoseAwsCatalogReference(catalogRef: unknown): readonly AwsIconDiagnostic[];
export function diagnoseAwsAssetReference(assetRef: unknown): readonly AwsIconDiagnostic[];
export function diagnoseAwsServiceAlias(alias: unknown): readonly AwsIconDiagnostic[];
export function resolveAwsServiceAlias(alias: unknown): AwsServiceAliasResolveResult;

export function createAwsIconCatalogResolver(options?: Readonly<{
  fallback?: { resolveCatalog(catalogRef: string): Promise<CatalogRawSource> | CatalogRawSource };
}>): Readonly<{
  resolveCatalog(catalogRef: string): Promise<CatalogRawSource>;
}>;

export function createAwsIconAssetResolver(options?: Readonly<
  | {
      delivery?: "metadata-only";
      localAssets?: never;
      localPathProvider?: never;
      bytesUrlProvider?: never;
      localUrlProtocols?: never;
      signedUrlProvider?: never;
      allowedSignedUrlOrigins?: never;
    }
  | {
      delivery: "local";
      localAssets: Readonly<Record<string, AwsLocalAssetSource>> | ReadonlyMap<string, AwsLocalAssetSource>;
      localPathProvider?: (
        request: AwsLocalPathRequest,
      ) => Promise<AwsLocalAssetBytes | AwsVerifiedAssetUrl> | AwsLocalAssetBytes | AwsVerifiedAssetUrl;
      bytesUrlProvider?: (
        request: AwsBytesUrlRequest,
      ) => Promise<Readonly<{ url: string; release?: () => void }>> | Readonly<{ url: string; release?: () => void }>;
      localUrlProtocols?: readonly string[];
      signedUrlProvider?: never;
      allowedSignedUrlOrigins?: never;
    }
  | {
      delivery: "signed-url";
      signedUrlProvider(
        request: AwsExpectedAsset,
      ): Promise<AwsVerifiedAssetUrl> | AwsVerifiedAssetUrl;
      allowedSignedUrlOrigins: readonly string[];
      localAssets?: never;
      localPathProvider?: never;
      bytesUrlProvider?: never;
      localUrlProtocols?: never;
    }
>): Readonly<{
  resolve(request: AwsAssetResolveRequest): Promise<AwsAssetResolveResult>;
}>;

export function assertNoAwsReservedNamespaceCollision(
  candidate: CatalogRawSource | Readonly<Record<string, unknown>>,
  options?: Readonly<{ allowBundledCatalog?: boolean }>,
): Readonly<Record<string, unknown>>;
