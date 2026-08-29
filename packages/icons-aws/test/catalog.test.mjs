import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

import {
  AWS_ICON_ASSET_NAMESPACE,
  AWS_ICON_CATALOG_ID,
  AWS_ICON_CATALOG_INTEGRITY,
  AWS_ICON_CATALOG_REF,
  AWS_ICON_CATALOG_VERSION,
  AWS_ICON_PACKAGE_VERSION,
  AWS_ICON_VENDOR_DISTRIBUTION,
  AwsIconCatalogError,
  assertNoAwsReservedNamespaceCollision,
  awsIconCatalogManifest,
  awsIconCatalogSource,
  awsIconCategories,
  awsIconEntries,
  createAwsIconAssetResolver,
  createAwsIconCatalogResolver,
  diagnoseAwsAssetReference,
  diagnoseAwsCatalogReference,
  diagnoseAwsServiceAlias,
  getAwsIconFallbackMetadata,
  getAwsIconMetadata,
  listAwsIcons,
  resolveAwsServiceAlias,
} from "../index.js";

const PACKAGE_ROOT = new URL("../", import.meta.url);
const CATALOG_EXTENSION = "urn:iriograph:extension:vendor-icon-catalog:1";

test("immutable catalog identity and metadata-only distribution are fixed", async () => {
  assert.equal(AWS_ICON_PACKAGE_VERSION, "0.11.0");
  assert.equal(AWS_ICON_VENDOR_DISTRIBUTION, "2026-Q3");
  assert.equal(AWS_ICON_CATALOG_ID, "urn:iriograph:catalog:vendor:aws:architecture-icons");
  assert.equal(AWS_ICON_CATALOG_VERSION, "2026-q3");
  assert.equal(AWS_ICON_CATALOG_REF, `${AWS_ICON_CATALOG_ID}@${AWS_ICON_CATALOG_VERSION}`);
  assert.equal(
    `sha256-${createHash("sha256").update(awsIconCatalogSource).digest("base64")}`,
    AWS_ICON_CATALOG_INTEGRITY,
  );

  const distribution = awsIconCatalogManifest.extensions[CATALOG_EXTENSION].distribution;
  assert.equal(distribution.version, "2026-Q3");
  assert.equal(distribution.archiveSha256, "d2d166c453526471749d520e0db022c459abef759d2946cf2dd1d1c992dc6526");
  assert.equal(distribution.archiveByteLength, 13_988_918);
  assert.equal(distribution.bundledAssets, false);
  assert.equal(distribution.assetDelivery, "consumer-supplied");
  assert.equal(distribution.officialArchiveAcquisition, "user-managed");
  assert.equal(Object.isFrozen(awsIconCatalogManifest), true);
  assert.equal(Object.isFrozen(awsIconCatalogManifest.assets), true);

  assert.equal(awsIconEntries.length, 13);
  assert.equal(new Set(awsIconEntries.map((entry) => entry.assetRef)).size, 13);
  assert.equal(new Set(awsIconEntries.map((entry) => entry.templateRef)).size, 13);
  assert.equal(awsIconCategories.length, 8);
  for (const entry of awsIconEntries) {
    assert.equal(entry.assetRef.startsWith(AWS_ICON_ASSET_NAMESPACE), true);
    assert.match(entry.locator, /^urn:iriograph:asset-source:vendor:aws:architecture-icons:/u);
    assert.match(entry.label.ja, /\S/u);
    assert.match(entry.category.labelJa, /\S/u);
    assert.equal(entry.preview.kind, "consumer-supplied-official-svg");
    assert.equal(entry.preview.actualShapeWhenResolved, true);
    assert.equal(entry.preview.fallback.kind, "category-initial");
    assert.equal(entry.preview.fallback.categoryLabelJa, entry.category.labelJa);
    assert.equal(entry.preview.viewBox, "0 0 80 80");
    assert.match(entry.sourceArchivePath, /\.svg$/u);
    assert.match(entry.sourceSha256, /^[0-9a-f]{64}$/u);
    assert.equal(entry.lifecycle, "active");
    assert.equal("packageAssetPath" in entry, false);
  }

  assert.deepEqual(listAwsIcons({ categoryId: "compute" }).map((entry) => entry.slug), [
    "amazon-ec2",
    "aws-lambda",
  ]);
  assert.strictEqual(listAwsIcons(), awsIconEntries);
  const s3 = `${AWS_ICON_ASSET_NAMESPACE}service:amazon-s3`;
  assert.equal(getAwsIconMetadata(s3)?.label.ja, "Amazon S3");
  assert.equal(getAwsIconFallbackMetadata(s3)?.text, "S3");
});

test("package source contains no AWS SVG or archive bytes and is publishable", async () => {
  const files = await readdir(PACKAGE_ROOT, { recursive: true });
  assert.equal(files.some((path) => /(?:^|\/)assets(?:\/|$)/u.test(path)), false);
  assert.equal(files.some((path) => /\.(?:svg|zip|tar|tgz|png|jpe?g|webp)$/iu.test(path)), false);

  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(Object.hasOwn(packageJson, "private"), false);
  assert.equal(packageJson.publishConfig.access, "public");
  assert.equal(packageJson.files.includes("assets"), false);
  assert.equal(Object.keys(packageJson.exports).some((key) => key.startsWith("./assets/")), false);
});

test("service aliases resolve deterministically and renamed aliases keep diagnostics", () => {
  const ec2 = resolveAwsServiceAlias("  AMAZON_EC2  ");
  assert.equal(ec2.status, "resolved");
  assert.equal(ec2.entry.slug, "amazon-ec2");
  assert.deepEqual(ec2.diagnostics, []);

  const renamed = resolveAwsServiceAlias("SageMaker");
  assert.equal(renamed.status, "resolved");
  assert.equal(renamed.entry.slug, "amazon-sagemaker-ai");
  assert.equal(renamed.diagnostics[0].code, "aws-icon-renamed");
  assert.equal(renamed.diagnostics[0].sourceUrl, "https://docs.aws.amazon.com/sagemaker/latest/dg/whatis.html");

  assert.equal(resolveAwsServiceAlias("not a service").status, "unresolved");
  assert.equal(diagnoseAwsServiceAlias("")[0].code, "aws-icon-alias-invalid");
});

test("rename, deprecation, version mismatch, and missing asset diagnostics are distinct", async () => {
  const renamed = `${AWS_ICON_ASSET_NAMESPACE}service:amazon-sagemaker`;
  const replacement = `${AWS_ICON_ASSET_NAMESPACE}service:amazon-sagemaker-ai`;
  const deprecated = `${AWS_ICON_ASSET_NAMESPACE}service:aws-iot-1-click`;
  const oldVersion = replacement.replace(":2026-q3:", ":2025-q3:");
  const unknown = `${AWS_ICON_ASSET_NAMESPACE}service:not-curated`;

  assert.equal(diagnoseAwsAssetReference(renamed)[0].code, "aws-icon-renamed");
  assert.equal(diagnoseAwsAssetReference(renamed)[0].replacementAssetRef, replacement);
  assert.equal(diagnoseAwsAssetReference(deprecated)[0].code, "aws-icon-deprecated");
  assert.match(diagnoseAwsAssetReference(deprecated)[0].message, /2025-01-29/u);
  assert.equal(diagnoseAwsAssetReference(oldVersion)[0].code, "aws-icon-version-mismatch");
  assert.equal(diagnoseAwsAssetReference(oldVersion)[0].replacementAssetRef, replacement);
  assert.equal(diagnoseAwsAssetReference(unknown)[0].code, "aws-icon-not-found");

  const resolver = createAwsIconAssetResolver();
  const moved = await resolver.resolve({ assetRef: renamed });
  assert.equal(moved.reason, "moved");
  assert.equal(moved.replacementAssetRef, replacement);
  assert.equal(moved.fallback.kind, "category-initial");
  assert.equal((await resolver.resolve({ assetRef: deprecated })).reason, "deleted");
  assert.equal((await resolver.resolve({ assetRef: oldVersion })).reason, "unavailable");
  assert.equal((await resolver.resolve({ assetRef: unknown })).reason, "not-found");
});

test("unconfigured resolver returns an explicit install diagnostic and fallback metadata", async () => {
  const entry = getAwsIconMetadata(`${AWS_ICON_ASSET_NAMESPACE}service:amazon-ec2`);
  const result = await createAwsIconAssetResolver().resolve({ assetRef: entry.assetRef });
  assert.equal(result.status, "unresolved");
  assert.equal(result.reason, "unavailable");
  assert.equal(result.diagnostic.code, "aws-icon-assets-not-installed");
  assert.equal(result.fallback.text, "EC2");
  assert.match(result.message, /同梱されていません/u);
  assert.match(result.message, /公式 archive/u);
});

test("local path mapping works offline through a host provider with immutable attestation", async () => {
  const entry = getAwsIconMetadata(`${AWS_ICON_ASSET_NAMESPACE}service:amazon-ec2`);
  let releaseCalls = 0;
  const resolver = createAwsIconAssetResolver({
    delivery: "local",
    localAssets: { [entry.sourceArchivePath]: "/user-owned/aws-icons/ec2.svg" },
    async localPathProvider(expected) {
      assert.equal(expected.path, "/user-owned/aws-icons/ec2.svg");
      assert.equal(expected.sourceArchivePath, entry.sourceArchivePath);
      assert.match(expected.officialArchiveUrl, /^https:\/\/d1\.awsstatic\.com\//u);
      assert.equal(expected.officialArchiveSha256, "d2d166c453526471749d520e0db022c459abef759d2946cf2dd1d1c992dc6526");
      return {
        url: "file:///user-owned/aws-icons/ec2.svg",
        verifiedSha256: expected.sha256,
        byteLength: expected.byteLength,
        mediaType: expected.mediaType,
        svgViewBox: expected.svgViewBox,
        release() {
          releaseCalls += 1;
        },
      };
    },
  });
  const result = await resolver.resolve({ assetRef: entry.assetRef });
  assert.equal(result.status, "resolved");
  assert.equal(result.lease.url, "file:///user-owned/aws-icons/ec2.svg");
  assert.equal(result.lease.byteLength, entry.byteLength);
  result.lease.release();
  result.lease.release();
  assert.equal(releaseCalls, 1);

  const missingProvider = createAwsIconAssetResolver({
    delivery: "local",
    localAssets: new Map([[entry.assetRef, "/user-owned/aws-icons/ec2.svg"]]),
  });
  const rejectedPath = await missingProvider.resolve({ assetRef: entry.assetRef });
  assert.equal(rejectedPath.diagnostic.code, "aws-icon-local-path-provider-missing");
});

test("local byte mappings are verified and altered bytes are rejected", async () => {
  const entry = getAwsIconMetadata(`${AWS_ICON_ASSET_NAMESPACE}service:amazon-s3`);
  const resolver = createAwsIconAssetResolver({
    delivery: "local",
    localAssets: { [entry.assetRef]: new Uint8Array(entry.byteLength) },
  });
  const result = await resolver.resolve({ assetRef: entry.assetRef });
  assert.equal(result.status, "unresolved");
  assert.equal(result.reason, "unavailable");
  assert.equal(result.diagnostic.code, "aws-icon-sha256-mismatch");
  assert.match(result.message, /SHA-256/u);
});

test("signed URL resolver requires an HTTPS allowlist and exact manifest attestation", async () => {
  const entry = getAwsIconMetadata(`${AWS_ICON_ASSET_NAMESPACE}service:amazon-bedrock`);
  let releaseCalls = 0;
  const resolver = createAwsIconAssetResolver({
    delivery: "signed-url",
    allowedSignedUrlOrigins: ["https://assets.example.test"],
    async signedUrlProvider(expected) {
      assert.equal(expected.assetRef, entry.assetRef);
      assert.equal(expected.sha256, entry.sourceSha256);
      assert.equal(expected.sourceArchivePath, entry.sourceArchivePath);
      return {
        url: "https://assets.example.test/aws/bedrock.svg?signature=opaque",
        verifiedSha256: expected.sha256,
        byteLength: expected.byteLength,
        mediaType: expected.mediaType,
        svgViewBox: expected.svgViewBox,
        release() {
          releaseCalls += 1;
        },
      };
    },
  });
  const result = await resolver.resolve({ assetRef: entry.assetRef });
  assert.equal(result.status, "resolved");
  assert.equal(result.lease.url, "https://assets.example.test/aws/bedrock.svg?signature=opaque");
  result.lease.release();
  result.lease.release();
  assert.equal(releaseCalls, 1);

  assert.throws(
    () => createAwsIconAssetResolver({ delivery: "signed-url", signedUrlProvider() {} }),
    /allowedSignedUrlOrigin/u,
  );
  assert.throws(
    () => createAwsIconAssetResolver({
      delivery: "signed-url",
      allowedSignedUrlOrigins: ["http://assets.example.test"],
      signedUrlProvider() {},
    }),
    /https/u,
  );

  const unverified = createAwsIconAssetResolver({
    delivery: "signed-url",
    allowedSignedUrlOrigins: ["https://assets.example.test"],
    signedUrlProvider(expected) {
      return {
        url: "https://assets.example.test/aws/bedrock.svg",
        verifiedSha256: "0".repeat(64),
        byteLength: expected.byteLength,
        mediaType: expected.mediaType,
        svgViewBox: expected.svgViewBox,
      };
    },
  });
  const rejected = await unverified.resolve({ assetRef: entry.assetRef });
  assert.equal(rejected.status, "unresolved");
  assert.equal(rejected.diagnostic.code, "aws-icon-signed-url-invalid");
  assert.match(rejected.message, /SHA-256/u);
});

test("catalog resolver is exact and reserved catalog, asset, template, and locator namespaces reject collisions", async () => {
  let fallbackCalls = 0;
  const resolver = createAwsIconCatalogResolver({
    fallback: {
      resolveCatalog(catalogRef) {
        fallbackCalls += 1;
        return JSON.stringify({
          schemaVersion: "1",
          kind: "iriograph.catalog",
          catalogId: "urn:example:catalog",
          catalogVersion: "1",
          profileRef: "urn:example:profile",
          rules: [],
          templates: {},
          assets: {},
          requested: catalogRef,
        });
      },
    },
  });
  assert.equal(await resolver.resolveCatalog(AWS_ICON_CATALOG_REF), awsIconCatalogSource);
  await assert.rejects(
    resolver.resolveCatalog(`${AWS_ICON_CATALOG_ID}@2025-q3`),
    (error) => error instanceof AwsIconCatalogError && error.code === "aws-catalog-version-mismatch",
  );
  assert.equal(fallbackCalls, 0);
  assert.equal(JSON.parse(await resolver.resolveCatalog("urn:example:catalog@1")).requested, "urn:example:catalog@1");
  assert.equal(fallbackCalls, 1);
  assert.equal(diagnoseAwsCatalogReference(AWS_ICON_CATALOG_REF).length, 0);

  const harmless = { catalogId: "urn:example:catalog", catalogVersion: "1", templates: {}, assets: {} };
  assert.strictEqual(assertNoAwsReservedNamespaceCollision(harmless), harmless);
  for (const collision of [
    { ...harmless, catalogId: AWS_ICON_CATALOG_ID },
    { ...harmless, assets: { [`${AWS_ICON_ASSET_NAMESPACE}service:x`]: { assetRef: "x", mediaType: "image/svg+xml", url: "urn:example:x" } } },
    { ...harmless, templates: { "urn:iriograph:template:vendor:aws:architecture-icons:2026-q3:x": {} } },
    { ...harmless, assets: { "urn:example:asset": { assetRef: "urn:example:asset", mediaType: "image/svg+xml", url: "urn:iriograph:asset-source:vendor:aws:architecture-icons:2026-q3:service:x" } } },
  ]) {
    assert.throws(
      () => assertNoAwsReservedNamespaceCollision(collision),
      (error) => error instanceof AwsIconCatalogError && error.code === "aws-reserved-namespace-collision",
    );
  }
  assert.strictEqual(
    assertNoAwsReservedNamespaceCollision(awsIconCatalogManifest, { allowBundledCatalog: true }),
    awsIconCatalogManifest,
  );
});
