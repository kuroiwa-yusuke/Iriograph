# @iriograph/icons-aws

Metadata-only integration for referencing AWS Architecture Icons from Iriograph. The pinned vendor release is `2026-Q3` (release identifier `07312026`).

This package does **not** bundle or download AWS SVG, ZIP, or other artwork. A user obtains the official archive and the host maps validated local assets or signed URLs into the resolver. AWS artwork remains subject to AWS terms.

## Install

```sh
npm install --save-exact @iriograph/icons-aws
```

## Immutable identity

- Catalog ref: `urn:iriograph:catalog:vendor:aws:architecture-icons@2026-q3`
- Catalog integrity: `sha256-ikFQsNfMsuJoAgiGyu2g/f0NWiCovV0ebOtJlkE1BDc=`
- Asset namespace: `urn:iriograph:asset:vendor:aws:architecture-icons:2026-q3:`
- Manifest: `@iriograph/icons-aws/catalog.manifest.json`

Package SemVer, vendor distribution, and catalog version are separate axes. Asset identity includes the vendor distribution and remains immutable across package updates. Manifest `url` values are opaque source locators, not network URLs or package paths. A resolved URL exists only in a temporary host lease.

## Metadata

The curated catalog records thirteen services with:

- English/Japanese labels and categories;
- canonical slug and common aliases;
- path inside the official archive;
- individual SVG SHA-256, byte length, and `viewBox`;
- non-branded category-initial fallback;
- Amazon SageMaker → Amazon SageMaker AI rename metadata;
- AWS IoT 1-Click shutdown metadata;
- reserved catalog/asset/template/locator namespaces.

`resolveAwsServiceAlias("EC2")` resolves a human alias to an immutable asset ref. A legacy SageMaker alias resolves to the current entry while returning an `aws-icon-renamed` warning.

## Safe fallback

A resolver without a provider performs no network or filesystem access:

```js
import {
  AWS_ICON_ASSET_NAMESPACE,
  createAwsIconAssetResolver,
} from "@iriograph/icons-aws";

const result = await createAwsIconAssetResolver().resolve({
  assetRef: `${AWS_ICON_ASSET_NAMESPACE}service:amazon-ec2`,
});

// result.status === "unresolved"
// result.diagnostic.code === "aws-icon-assets-not-installed"
// result.fallback.kind === "category-initial"
```

## User-owned local archive

1. Download the Asset Package from [AWS Architecture Icons](https://aws.amazon.com/architecture/icons/).
2. Verify the archive SHA-256 against `manifest.distribution.archiveSha256`.
3. Extract it into host-managed storage and map `sourceArchivePath`.

```js
import { readFile } from "node:fs/promises";
import {
  AWS_ICON_ASSET_NAMESPACE,
  createAwsIconAssetResolver,
  getAwsIconMetadata,
} from "@iriograph/icons-aws";

const assetRef = `${AWS_ICON_ASSET_NAMESPACE}service:amazon-ec2`;
const entry = getAwsIconMetadata(assetRef);

const resolver = createAwsIconAssetResolver({
  delivery: "local",
  localAssets: new Map([[
    entry.sourceArchivePath,
    { path: `/user-owned/aws-icons/${entry.sourceArchivePath}` },
  ]]),
  async localPathProvider({ path }) {
    return { bytes: await readFile(path) };
  },
});

const result = await resolver.resolve({ assetRef });
```

The package validates byte length, per-file SHA-256, UTF-8, `viewBox`, and dangerous SVG content before creating a Blob URL. Filesystem access remains host code; this package has no `node:fs` runtime dependency.

## Signed URL provider

A host may serve validated user-owned assets through HTTPS signed URLs:

```js
const resolver = createAwsIconAssetResolver({
  delivery: "signed-url",
  allowedSignedUrlOrigins: ["https://assets.example.test"],
  async signedUrlProvider(expected) {
    const signed = await hostAssetService.resolve(expected.assetRef);
    return {
      url: signed.url,
      verifiedSha256: expected.sha256,
      byteLength: expected.byteLength,
      mediaType: expected.mediaType,
      svgViewBox: expected.svgViewBox,
    };
  },
});
```

The resolver rejects HTTP, embedded credentials, origins outside the allowlist, and integrity/length/MIME/viewBox mismatch. It never downloads the official archive by itself.

## Diagnostics and namespaces

`diagnoseAwsAssetReference()` and the resolver distinguish renamed, deprecated, version-mismatch, and not-found cases. `diagnoseAwsCatalogReference()` requires the exact catalog version.

`assertNoAwsReservedNamespaceCollision()` prevents external catalogs from overwriting this package's namespaces. `allowBundledCatalog: true` is only for registering the bundled manifest itself.

## Vendor sources and terms

- [AWS Architecture Icons](https://aws.amazon.com/architecture/icons/)
- [AWS icon package 2026-Q3](https://d1.awsstatic.com/onedam/marketing-channels/website/public/shared/architecture-icon-release/Icon-package_07312026.5846e92413caa21490223536cc97f1269e44fa92.zip)
- [AWS sample Architecture Diagram MCP](https://github.com/aws-samples/sample-architecture-diagram-mcp-server)
- [AWS Site Terms](https://aws.amazon.com/terms/)
- [AWS Trademark Guidelines](https://aws.amazon.com/trademark-guidelines/)
- [Amazon SageMaker AI rename](https://docs.aws.amazon.com/sagemaker/latest/dg/whatis.html)
- [Services in Full Shutdown](https://docs.aws.amazon.com/general/latest/gr/full_shutdown_services.html)

The pinned archive SHA-256 is `d2d166c453526471749d520e0db022c459abef759d2946cf2dd1d1c992dc6526`; byte length is `13,988,918`; HTTP Last-Modified was `2026-08-06T07:01:09Z`.

Iriograph is not affiliated with, sponsored by, or endorsed by AWS.

## License

The package code and metadata are MIT licensed. AWS artwork is not included and remains subject to AWS terms. See [LICENSE](./LICENSE), [NOTICE](./NOTICE.md), and the [Japanese README](./README_ja.md).
