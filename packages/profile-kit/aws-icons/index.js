import manifestData from "./catalog.manifest.json" with { type: "json" };

const CATALOG_EXTENSION = "urn:iriograph:extension:vendor-icon-catalog:1";
const ICON_EXTENSION = "urn:iriograph:extension:vendor-icon-metadata:1";
const CATALOG_ID = "urn:iriograph:catalog:vendor:aws:architecture-icons";
const CATALOG_VERSION = "2026-q3";
const ASSET_NAMESPACE_ROOT = "urn:iriograph:asset:vendor:aws:architecture-icons:";
const ASSET_NAMESPACE = `${ASSET_NAMESPACE_ROOT}${CATALOG_VERSION}:`;
const TEMPLATE_NAMESPACE_ROOT = "urn:iriograph:template:vendor:aws:architecture-icons:";
const LOCATOR_NAMESPACE_ROOT = "urn:iriograph:asset-source:vendor:aws:architecture-icons:";

export const AWS_ICON_PACKAGE_VERSION = "0.12.0";
export const AWS_ICON_VENDOR_DISTRIBUTION = "2026-Q3";
export const AWS_ICON_CATALOG_ID = CATALOG_ID;
export const AWS_ICON_CATALOG_VERSION = CATALOG_VERSION;
export const AWS_ICON_CATALOG_REF = `${CATALOG_ID}@${CATALOG_VERSION}`;
export const AWS_ICON_CATALOG_INTEGRITY = "sha256-EwO9T9KStVG09FcxO5ztuwYFGYXJxz52s0CH3XOsoro=";
export const AWS_ICON_ASSET_NAMESPACE = ASSET_NAMESPACE;
export const AWS_RESERVED_NAMESPACES = Object.freeze([
  CATALOG_ID,
  ASSET_NAMESPACE_ROOT,
  TEMPLATE_NAMESPACE_ROOT,
  LOCATOR_NAMESPACE_ROOT,
]);

export const awsIconCatalogSource = `${JSON.stringify(manifestData)}\n`;
export const awsIconCatalogManifest = deepFreeze(JSON.parse(awsIconCatalogSource));

const vendorMetadata = awsIconCatalogManifest.extensions[CATALOG_EXTENSION];
const renameByRef = new Map(vendorMetadata.renames.map((entry) => [entry.fromAssetRef, entry]));
const deprecationByRef = new Map(
  vendorMetadata.deprecations.map((entry) => [entry.assetRef, entry]),
);

export const awsIconEntries = Object.freeze(
  Object.values(awsIconCatalogManifest.assets).map((definition) => {
    const metadata = definition.extensions[ICON_EXTENSION];
    return Object.freeze({
      assetRef: definition.assetRef,
      templateRef: metadata.preview.templateRef,
      mediaType: definition.mediaType,
      locator: definition.url,
      slug: metadata.slug,
      aliases: metadata.aliases,
      label: metadata.label,
      category: metadata.category,
      preview: metadata.preview,
      fallback: metadata.preview.fallback,
      sourceArchivePath: metadata.sourceArchivePath,
      sourceSha256: metadata.sourceSha256,
      byteLength: metadata.byteLength,
      lifecycle: metadata.lifecycle,
    });
  }),
);

export const awsIconCategories = Object.freeze(
  vendorMetadata.categories.map((category) => Object.freeze({ ...category })),
);

const entryByRef = new Map(awsIconEntries.map((entry) => [entry.assetRef, entry]));
const aliasIndex = buildAliasIndex(awsIconEntries);
const renameAliasIndex = buildRenameAliasIndex(vendorMetadata.renames);

export class AwsIconCatalogError extends Error {
  constructor(diagnostic, options) {
    super(diagnostic.message, options);
    this.name = "AwsIconCatalogError";
    this.code = diagnostic.code;
    this.diagnostic = diagnostic;
  }
}

export function listAwsIcons(options = {}) {
  const categoryId = options.categoryId;
  if (categoryId === undefined) return awsIconEntries;
  return Object.freeze(awsIconEntries.filter((entry) => entry.category.id === categoryId));
}

export function getAwsIconMetadata(assetRef) {
  return entryByRef.get(assetRef);
}

export function getAwsIconFallbackMetadata(assetRef) {
  return entryByRef.get(assetRef)?.fallback;
}

export function diagnoseAwsServiceAlias(alias) {
  const normalized = normalizeAlias(alias);
  if (!normalized) {
    return [assetDiagnostic(
      "error",
      "aws-icon-alias-invalid",
      "service alias は空でない文字列で指定してください。",
    )];
  }
  const assetRef = aliasIndex.get(normalized);
  if (!assetRef) {
    return [assetDiagnostic(
      "error",
      "aws-icon-alias-not-found",
      `curated catalog に service alias がありません: ${String(alias)}`,
    )];
  }
  const rename = renameAliasIndex.get(normalized);
  if (!rename) return [];
  return [assetDiagnostic(
    "warning",
    "aws-icon-renamed",
    `${rename.labelJa} replacement: ${rename.toAssetRef}`,
    rename.fromAssetRef,
    rename.toAssetRef,
    rename.sourceUrl,
  )];
}

export function resolveAwsServiceAlias(alias) {
  const normalized = normalizeAlias(alias);
  const assetRef = normalized ? aliasIndex.get(normalized) : undefined;
  const diagnostics = diagnoseAwsServiceAlias(alias);
  if (!assetRef) {
    return Object.freeze({ status: "unresolved", diagnostics: Object.freeze(diagnostics) });
  }
  return Object.freeze({
    status: "resolved",
    assetRef,
    entry: entryByRef.get(assetRef),
    diagnostics: Object.freeze(diagnostics),
  });
}

export function diagnoseAwsCatalogReference(catalogRef) {
  if (typeof catalogRef !== "string" || catalogRef.length === 0) {
    return [catalogDiagnostic(
      "error",
      "aws-catalog-ref-invalid",
      "catalogRef は空でない文字列で指定してください。",
      typeof catalogRef === "string" ? catalogRef : undefined,
    )];
  }
  if (catalogRef === AWS_ICON_CATALOG_REF) return [];
  if (catalogRef === CATALOG_ID) {
    return [catalogDiagnostic(
      "error",
      "aws-catalog-ref-not-exact",
      `AWS icon catalog は exact catalogRef ${AWS_ICON_CATALOG_REF} で参照してください。`,
      catalogRef,
      AWS_ICON_CATALOG_REF,
    )];
  }
  if (catalogRef.startsWith(`${CATALOG_ID}@`)) {
    const version = catalogRef.slice(CATALOG_ID.length + 1);
    return [catalogDiagnostic(
      "error",
      "aws-catalog-version-mismatch",
      `AWS icon catalog version ${version || "(empty)"} はこの package に含まれません。利用可能な版は ${CATALOG_VERSION} です。`,
      catalogRef,
      AWS_ICON_CATALOG_REF,
    )];
  }
  if (catalogRef.startsWith(CATALOG_ID)) {
    return [catalogDiagnostic(
      "error",
      "aws-reserved-namespace-collision",
      `package 予約 catalog namespace を別 identity として使用できません: ${catalogRef}`,
      catalogRef,
      AWS_ICON_CATALOG_REF,
    )];
  }
  return [catalogDiagnostic(
    "error",
    "aws-catalog-not-found",
    `この resolver は catalogRef を解決できません: ${catalogRef}`,
    catalogRef,
  )];
}

export function diagnoseAwsAssetReference(assetRef) {
  if (typeof assetRef !== "string" || assetRef.length === 0) {
    return [assetDiagnostic(
      "error",
      "aws-icon-ref-invalid",
      "assetRef は空でない文字列で指定してください。",
      typeof assetRef === "string" ? assetRef : undefined,
    )];
  }
  if (entryByRef.has(assetRef)) return [];

  const rename = renameByRef.get(assetRef);
  if (rename) {
    return [assetDiagnostic(
      "warning",
      "aws-icon-renamed",
      `${rename.labelJa} replacement: ${rename.toAssetRef}`,
      assetRef,
      rename.toAssetRef,
      rename.sourceUrl,
    )];
  }

  const deprecation = deprecationByRef.get(assetRef);
  if (deprecation) {
    return [assetDiagnostic(
      "error",
      "aws-icon-deprecated",
      `${deprecation.labelJa} endOfSupport: ${deprecation.endOfSupportDate}`,
      assetRef,
      undefined,
      deprecation.sourceUrl,
    )];
  }

  if (assetRef.startsWith(ASSET_NAMESPACE_ROOT)) {
    const remainder = assetRef.slice(ASSET_NAMESPACE_ROOT.length);
    const separator = remainder.indexOf(":");
    const version = separator < 0 ? remainder : remainder.slice(0, separator);
    const suffix = separator < 0 ? "" : remainder.slice(separator + 1);
    if (version !== CATALOG_VERSION) {
      const currentRef = `${ASSET_NAMESPACE}${suffix}`;
      const normalizedCurrentRef = renameByRef.get(currentRef)?.toAssetRef ?? currentRef;
      const replacement = entryByRef.has(normalizedCurrentRef) ? normalizedCurrentRef : undefined;
      return [assetDiagnostic(
        "error",
        "aws-icon-version-mismatch",
        `assetRef の vendor distribution version ${version || "(empty)"} はこの catalog の ${CATALOG_VERSION} と一致しません。`,
        assetRef,
        replacement,
      )];
    }
    return [assetDiagnostic(
      "error",
      "aws-icon-not-found",
      `現行 curated catalog に assetRef がありません: ${assetRef}`,
      assetRef,
    )];
  }

  return [assetDiagnostic(
    "error",
    "aws-icon-not-found",
    `この resolver は assetRef を解決できません: ${assetRef}`,
    assetRef,
  )];
}

export function createAwsIconCatalogResolver(options = {}) {
  const fallback = options.fallback;
  if (fallback !== undefined && typeof fallback?.resolveCatalog !== "function") {
    throw new TypeError("fallback must implement resolveCatalog(catalogRef)");
  }
  return Object.freeze({
    async resolveCatalog(catalogRef) {
      if (catalogRef === AWS_ICON_CATALOG_REF) return awsIconCatalogSource;
      if (!isReservedCatalogReference(catalogRef) && fallback) {
        const source = await fallback.resolveCatalog(catalogRef);
        assertNoAwsReservedNamespaceCollision(source);
        return source;
      }
      throw new AwsIconCatalogError(diagnoseAwsCatalogReference(catalogRef)[0]);
    },
  });
}

export function createAwsIconAssetResolver(options = {}) {
  const delivery = options.delivery ?? "metadata-only";
  if (delivery !== "metadata-only" && delivery !== "local" && delivery !== "signed-url") {
    throw new TypeError('delivery must be "metadata-only", "local", or "signed-url"');
  }

  const localAssets = options.localAssets;
  const localPathProvider = options.localPathProvider;
  const bytesUrlProvider = options.bytesUrlProvider;
  const localUrlProtocols = normalizeLocalUrlProtocols(options.localUrlProtocols);
  if (delivery === "local") {
    if (!isRecord(localAssets) && !(localAssets instanceof Map)) {
      throw new TypeError("local delivery requires localAssets as a record or Map");
    }
    if (localPathProvider !== undefined && typeof localPathProvider !== "function") {
      throw new TypeError("localPathProvider must be a function when supplied");
    }
    if (bytesUrlProvider !== undefined && typeof bytesUrlProvider !== "function") {
      throw new TypeError("bytesUrlProvider must be a function when supplied");
    }
  }

  const signedUrlProvider = options.signedUrlProvider;
  const allowedSignedUrlOrigins = normalizeAllowedOrigins(options.allowedSignedUrlOrigins);
  if (delivery === "signed-url") {
    if (typeof signedUrlProvider !== "function") {
      throw new TypeError("signed-url delivery requires signedUrlProvider");
    }
    if (allowedSignedUrlOrigins.length === 0) {
      throw new TypeError("signed-url delivery requires at least one allowedSignedUrlOrigin");
    }
  }

  return Object.freeze({
    async resolve(request) {
      const assetRef = request?.assetRef;
      const signal = request?.signal;
      if (signal?.aborted) {
        return unavailableResult(undefined, "aws-icon-resolution-aborted", "AWS icon asset の解決を中止しました。");
      }

      const diagnostic = diagnoseAwsAssetReference(assetRef)[0];
      if (diagnostic) return referenceFailure(diagnostic);

      const entry = entryByRef.get(assetRef);
      if (delivery === "metadata-only") {
        return unavailableResult(
          entry,
          "aws-icon-assets-not-installed",
          "AWS icon bytes はこの package に同梱されていません。利用者が AWS 公式 archive を取得・展開し、localAssets または host の署名 URL provider を設定してください。",
        );
      }

      if (delivery === "local") {
        const mapped = readLocalMapping(localAssets, entry);
        if (mapped === undefined) {
          return unavailableResult(
            entry,
            "aws-icon-local-asset-missing",
            `展開済み official archive の mapping に asset がありません: ${entry.sourceArchivePath}`,
          );
        }
        try {
          const supplied = await resolveLocalSupply(mapped, entry, {
            localPathProvider,
            bytesUrlProvider,
            localUrlProtocols,
            signal,
          });
          if (signal?.aborted) {
            safelyRelease(supplied?.release);
            return unavailableResult(entry, "aws-icon-resolution-aborted", "AWS icon asset の解決を中止しました。");
          }
          return resolvedLease(supplied);
        } catch (cause) {
          return unavailableResult(
            entry,
            cause?.code ?? "aws-icon-local-asset-invalid",
            `local AWS icon asset を採用できません: ${errorMessage(cause)}`,
          );
        }
      }

      let supplied;
      try {
        supplied = await signedUrlProvider(expectedAsset(entry, signal));
      } catch (cause) {
        if (signal?.aborted || cause?.name === "AbortError") {
          return unavailableResult(entry, "aws-icon-resolution-aborted", "AWS icon signed URL の取得を中止しました。");
        }
        return unavailableResult(
          entry,
          "aws-icon-signed-url-failed",
          `AWS icon signed URL を取得できませんでした: ${errorMessage(cause)}`,
        );
      }
      if (signal?.aborted) {
        safelyRelease(supplied?.release);
        return unavailableResult(entry, "aws-icon-resolution-aborted", "AWS icon asset の解決を中止しました。");
      }
      try {
        const lease = validateVerifiedLease(supplied, entry, {
          allowedOrigins: allowedSignedUrlOrigins,
          allowedProtocols: ["https:"],
          subject: "signed URL provider",
        });
        return resolvedLease(lease);
      } catch (cause) {
        safelyRelease(supplied?.release);
        return unavailableResult(
          entry,
          "aws-icon-signed-url-invalid",
          `AWS icon signed URL を採用できません: ${errorMessage(cause)}`,
        );
      }
    },
  });
}

export function assertNoAwsReservedNamespaceCollision(candidate, options = {}) {
  const parsed = parseCatalogCandidate(candidate);
  const collisions = reservedNamespaceCollisions(parsed);
  if (collisions.length === 0) return parsed;
  if (options.allowBundledCatalog === true && canonicalJson(parsed) === canonicalJson(awsIconCatalogManifest)) {
    return parsed;
  }
  const diagnostic = Object.freeze({
    severity: "error",
    category: "asset",
    code: "aws-reserved-namespace-collision",
    message: `package 予約 namespace との衝突を拒否しました: ${collisions.join(", ")}`,
    catalogRef: typeof parsed.catalogId === "string" && typeof parsed.catalogVersion === "string"
      ? `${parsed.catalogId}@${parsed.catalogVersion}`
      : undefined,
    relatedPaths: Object.freeze(collisions),
  });
  throw new AwsIconCatalogError(diagnostic);
}

async function resolveLocalSupply(mapped, entry, options) {
  let supplied = mapped;
  const path = typeof mapped === "string"
    ? mapped
    : isRecord(mapped) && typeof mapped.path === "string"
      ? mapped.path
      : undefined;
  if (path !== undefined) {
    if (typeof options.localPathProvider !== "function") {
      throw codedError(
        "aws-icon-local-path-provider-missing",
        "path mapping の利用には host の localPathProvider が必要です。package 自身は filesystem を読みません。",
      );
    }
    supplied = await options.localPathProvider(Object.freeze({
      ...expectedAsset(entry, options.signal),
      path,
    }));
  }

  const bytes = extractBytes(supplied);
  if (bytes) {
    await verifySvgBytes(bytes, entry);
    return createBytesLease(bytes, entry, options);
  }
  return validateVerifiedLease(supplied, entry, {
    allowedProtocols: options.localUrlProtocols,
    subject: "localPathProvider",
  });
}

async function createBytesLease(bytes, entry, options) {
  let supplied;
  if (options.bytesUrlProvider) {
    supplied = await options.bytesUrlProvider(Object.freeze({
      ...expectedAsset(entry, options.signal),
      bytes,
    }));
    if (!isRecord(supplied) || typeof supplied.url !== "string") {
      throw new TypeError("bytesUrlProvider result must contain url");
    }
  } else {
    if (typeof Blob !== "function" || typeof URL.createObjectURL !== "function") {
      throw codedError(
        "aws-icon-object-url-unavailable",
        "この host では Blob URL を作成できません。bytesUrlProvider を指定してください。",
      );
    }
    const url = URL.createObjectURL(new Blob([bytes], { type: entry.mediaType }));
    supplied = { url, release: () => URL.revokeObjectURL(url) };
  }
  const url = validateAbsoluteUrl(supplied.url, options.localUrlProtocols, "bytesUrlProvider");
  if (supplied.release !== undefined && typeof supplied.release !== "function") {
    throw new TypeError("bytesUrlProvider release must be a function when supplied");
  }
  return {
    url: url.href,
    mediaType: entry.mediaType,
    byteLength: entry.byteLength,
    svgViewBox: entry.preview.viewBox,
    release: supplied.release,
  };
}

async function verifySvgBytes(bytes, entry) {
  if (bytes.byteLength !== entry.byteLength) {
    throw codedError(
      "aws-icon-byte-length-mismatch",
      `byteLength が immutable metadata と一致しません: expected ${entry.byteLength}, actual ${bytes.byteLength}`,
    );
  }
  if (!globalThis.crypto?.subtle) {
    throw codedError("aws-icon-webcrypto-unavailable", "SVG bytes の SHA-256 検証に Web Crypto が必要です。");
  }
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  const actualSha256 = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  if (actualSha256 !== entry.sourceSha256) {
    throw codedError(
      "aws-icon-sha256-mismatch",
      `SHA-256 が immutable metadata と一致しません: expected ${entry.sourceSha256}, actual ${actualSha256}`,
    );
  }
  let svg;
  try {
    svg = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (cause) {
    throw codedError("aws-icon-svg-invalid", `SVG は UTF-8 ではありません: ${errorMessage(cause)}`);
  }
  if (!/^(?:\s*<\?xml[^>]*>\s*)?<svg\b/iu.test(svg)) {
    throw codedError("aws-icon-svg-invalid", "検証対象は SVG document ではありません。");
  }
  if (!/\bviewBox\s*=\s*["']0 0 80 80["']/u.test(svg)) {
    throw codedError("aws-icon-svg-viewbox-mismatch", "SVG viewBox が immutable metadata と一致しません。");
  }
  if (/<(?:script|foreignObject)\b/iu.test(svg) || /\bon\w+\s*=/iu.test(svg)) {
    throw codedError("aws-icon-svg-unsafe", "SVG に実行可能 content が含まれています。");
  }
  if (/\b(?:href|xlink:href)\s*=\s*["'](?:https?:|\/\/|data:|javascript:)/iu.test(svg)) {
    throw codedError("aws-icon-svg-unsafe", "SVG に外部または executable reference が含まれています。");
  }
}

function validateVerifiedLease(value, entry, options) {
  if (!isRecord(value)) throw new TypeError(`${options.subject} result must be an object`);
  const url = validateAbsoluteUrl(value.url, options.allowedProtocols, options.subject);
  if (options.allowedOrigins && !options.allowedOrigins.includes(url.origin)) {
    throw new TypeError(`signed URL origin is not allowed: ${url.origin}`);
  }
  if (value.verifiedSha256 !== entry.sourceSha256) {
    throw new TypeError(`${options.subject} did not attest the manifest SHA-256`);
  }
  if (value.byteLength !== entry.byteLength) {
    throw new TypeError(`${options.subject} byteLength does not match the immutable manifest`);
  }
  if (value.mediaType !== entry.mediaType) {
    throw new TypeError(`${options.subject} mediaType does not match the immutable manifest`);
  }
  if (value.svgViewBox !== entry.preview.viewBox) {
    throw new TypeError(`${options.subject} SVG viewBox does not match the immutable manifest`);
  }
  if (value.release !== undefined && typeof value.release !== "function") {
    throw new TypeError(`${options.subject} release must be a function when supplied`);
  }
  return {
    url: url.href,
    mediaType: value.mediaType,
    byteLength: value.byteLength,
    svgViewBox: value.svgViewBox,
    release: value.release,
  };
}

function validateAbsoluteUrl(value, allowedProtocols, subject) {
  if (typeof value !== "string") throw new TypeError(`${subject} URL is missing`);
  const url = new URL(value);
  if (url.username || url.password) throw new TypeError(`${subject} URL must not contain user information`);
  if (!allowedProtocols.includes(url.protocol)) {
    throw new TypeError(`${subject} URL protocol is not allowed: ${url.protocol}`);
  }
  return url;
}

function expectedAsset(entry, signal) {
  return Object.freeze({
    assetRef: entry.assetRef,
    catalogRef: AWS_ICON_CATALOG_REF,
    packageVersion: AWS_ICON_PACKAGE_VERSION,
    vendorDistribution: AWS_ICON_VENDOR_DISTRIBUTION,
    officialArchiveUrl: vendorMetadata.distribution.archiveUrl,
    officialArchiveSha256: vendorMetadata.distribution.archiveSha256,
    sourceArchivePath: entry.sourceArchivePath,
    mediaType: entry.mediaType,
    byteLength: entry.byteLength,
    sha256: entry.sourceSha256,
    svgViewBox: entry.preview.viewBox,
    signal,
  });
}

function readLocalMapping(localAssets, entry) {
  const keys = [entry.assetRef, entry.sourceArchivePath, entry.slug];
  for (const key of keys) {
    if (localAssets instanceof Map && localAssets.has(key)) return localAssets.get(key);
    if (isRecord(localAssets) && Object.hasOwn(localAssets, key)) return localAssets[key];
  }
  return undefined;
}

function extractBytes(value) {
  const candidate = isRecord(value) && Object.hasOwn(value, "bytes") ? value.bytes : value;
  if (candidate instanceof Uint8Array) {
    return new Uint8Array(candidate.buffer, candidate.byteOffset, candidate.byteLength);
  }
  if (candidate instanceof ArrayBuffer) return new Uint8Array(candidate);
  return undefined;
}

function resolvedLease(value) {
  let released = false;
  return {
    status: "resolved",
    lease: {
      url: value.url,
      mediaType: value.mediaType,
      byteLength: value.byteLength,
      svgViewBox: value.svgViewBox,
      release() {
        if (released) return;
        released = true;
        safelyRelease(value.release);
      },
    },
  };
}

function referenceFailure(diagnostic) {
  if (diagnostic.code === "aws-icon-renamed") {
    const fallback = entryByRef.get(diagnostic.replacementAssetRef)?.fallback;
    return unresolved("moved", diagnostic.message, diagnostic, fallback, diagnostic.replacementAssetRef);
  }
  if (diagnostic.code === "aws-icon-deprecated") {
    return unresolved("deleted", diagnostic.message, diagnostic);
  }
  return unresolved(
    diagnostic.code === "aws-icon-not-found" ? "not-found" : "unavailable",
    diagnostic.message,
    diagnostic,
    diagnostic.replacementAssetRef ? entryByRef.get(diagnostic.replacementAssetRef)?.fallback : undefined,
    diagnostic.replacementAssetRef,
  );
}

function unavailableResult(entry, code, message) {
  const diagnostic = assetDiagnostic("error", code, message, entry?.assetRef);
  return unresolved("unavailable", message, diagnostic, entry?.fallback);
}

function unresolved(reason, message, diagnostic, fallback, replacementAssetRef) {
  return {
    status: "unresolved",
    reason,
    message,
    diagnostic,
    ...(fallback ? { fallback } : {}),
    ...(replacementAssetRef ? { replacementAssetRef } : {}),
  };
}

function normalizeAllowedOrigins(origins) {
  if (origins === undefined) return Object.freeze([]);
  if (!Array.isArray(origins)) throw new TypeError("allowedSignedUrlOrigins must be an array");
  const normalized = origins.map((origin) => {
    if (typeof origin !== "string") throw new TypeError("allowed signed URL origins must be strings");
    const parsed = new URL(origin);
    if (parsed.protocol !== "https:") throw new TypeError("allowed signed URL origins must use https");
    if (parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) {
      throw new TypeError(`allowed signed URL origin must not include credentials, path, query, or fragment: ${origin}`);
    }
    return parsed.origin;
  });
  return Object.freeze([...new Set(normalized)].sort(compareText));
}

function normalizeLocalUrlProtocols(protocols) {
  if (protocols === undefined) return Object.freeze(["blob:", "file:"]);
  if (!Array.isArray(protocols) || protocols.length === 0) {
    throw new TypeError("localUrlProtocols must be a non-empty array");
  }
  return Object.freeze([...new Set(protocols.map((protocol) => {
    if (typeof protocol !== "string" || !/^[a-z][a-z0-9+.-]*:$/iu.test(protocol)) {
      throw new TypeError(`invalid local URL protocol: ${String(protocol)}`);
    }
    if (protocol === "http:") throw new TypeError("local URL protocol must not use http");
    return protocol.toLowerCase();
  }))].sort(compareText));
}

function parseCatalogCandidate(candidate) {
  if (isRecord(candidate)) return candidate;
  let text;
  if (typeof candidate === "string") {
    text = candidate;
  } else if (candidate instanceof Uint8Array) {
    text = new TextDecoder("utf-8", { fatal: true }).decode(candidate);
  } else if (candidate instanceof ArrayBuffer) {
    text = new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(candidate));
  } else {
    throw new TypeError("catalog candidate must be an object, string, Uint8Array, or ArrayBuffer");
  }
  const parsed = JSON.parse(text);
  if (!isRecord(parsed)) throw new TypeError("catalog candidate JSON must be an object");
  return parsed;
}

function reservedNamespaceCollisions(catalog) {
  const collisions = [];
  if (typeof catalog.catalogId === "string" && catalog.catalogId.startsWith(CATALOG_ID)) {
    collisions.push("/catalogId");
  }
  if (isRecord(catalog.assets)) {
    for (const [assetRef, definition] of Object.entries(catalog.assets)) {
      if (assetRef.startsWith(ASSET_NAMESPACE_ROOT)) collisions.push(`/assets/${assetRef}`);
      if (isRecord(definition) && typeof definition.url === "string" && definition.url.startsWith(LOCATOR_NAMESPACE_ROOT)) {
        collisions.push(`/assets/${assetRef}/url`);
      }
    }
  }
  if (isRecord(catalog.templates)) {
    for (const templateRef of Object.keys(catalog.templates)) {
      if (templateRef.startsWith(TEMPLATE_NAMESPACE_ROOT)) collisions.push(`/templates/${templateRef}`);
    }
  }
  return [...new Set(collisions)].sort(compareText);
}

function buildAliasIndex(entries) {
  const index = new Map();
  for (const entry of entries) {
    for (const alias of [entry.slug, entry.label.en, entry.label.ja, ...entry.aliases]) {
      const normalized = normalizeAlias(alias);
      const existing = index.get(normalized);
      if (existing && existing !== entry.assetRef) {
        throw new Error(`AWS service alias collision: ${alias}`);
      }
      index.set(normalized, entry.assetRef);
    }
  }
  return index;
}

function buildRenameAliasIndex(renames) {
  const index = new Map();
  for (const rename of renames) {
    for (const alias of rename.fromAliases ?? []) index.set(normalizeAlias(alias), rename);
  }
  return index;
}

function normalizeAlias(value) {
  if (typeof value !== "string") return "";
  return value.normalize("NFKC").trim().toLocaleLowerCase("en-US")
    .replace(/[_-]+/gu, " ")
    .replace(/\s+/gu, " ");
}

function isReservedCatalogReference(value) {
  return typeof value === "string" && value.startsWith(CATALOG_ID);
}

function catalogDiagnostic(severity, code, message, catalogRef, replacementCatalogRef) {
  return Object.freeze({
    severity,
    category: "asset",
    code,
    message,
    ...(catalogRef ? { catalogRef } : {}),
    ...(replacementCatalogRef ? {
      replacementCatalogRef,
      suggestedActions: Object.freeze([Object.freeze({
        actionId: "use-exact-catalog-ref",
        parameters: Object.freeze({ catalogRef: replacementCatalogRef }),
      })]),
    } : {}),
  });
}

function assetDiagnostic(severity, code, message, assetRef, replacementAssetRef, sourceUrl) {
  return Object.freeze({
    severity,
    category: "asset",
    code,
    message,
    catalogRef: AWS_ICON_CATALOG_REF,
    ...(assetRef ? { assetRef } : {}),
    ...(replacementAssetRef ? {
      replacementAssetRef,
      suggestedActions: Object.freeze([Object.freeze({
        actionId: "replace-asset-ref",
        parameters: Object.freeze({ assetRef: replacementAssetRef }),
      })]),
    } : {}),
    ...(sourceUrl ? { sourceUrl } : {}),
  });
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort(compareText).map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function deepFreeze(value) {
  if (!isRecord(value) && !Array.isArray(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function codedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function safelyRelease(release) {
  if (typeof release !== "function") return;
  try {
    release();
  } catch {
    // AssetLease.release is intentionally idempotent and best effort.
  }
}

function errorMessage(cause) {
  return cause instanceof Error ? cause.message : String(cause);
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}
