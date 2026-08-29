# @iriograph/icons-aws

AWS Architecture Icons を Iriograph で参照するための、公開可能な metadata-only package です。package version は `0.11.0`、対象の公式配布版は `2026-Q3`（release identifier `07312026`）です。

この package は AWS の SVG・ZIP・その他の artwork bytes を同梱せず、実行時にも download しません。利用者が AWS 公式サイトから archive を取得し、host application が展開済み local asset または署名 URL を resolver に渡します。AWS 公式の `aws-samples/sample-architecture-diagram-mcp-server` も、Terms of Use を理由に icon を bundle せず、利用者 download と category-colored initial fallback を採用しています。

## 固定 identity

- Catalog ref: `urn:iriograph:catalog:vendor:aws:architecture-icons@2026-q3`
- Catalog integrity: `sha256-ikFQsNfMsuJoAgiGyu2g/f0NWiCovV0ebOtJlkE1BDc=`
- Asset namespace: `urn:iriograph:asset:vendor:aws:architecture-icons:2026-q3:`
- Manifest: `@iriograph/icons-aws/catalog.manifest.json`

Package SemVer、AWS vendor distribution、catalog version は別の version 軸です。Catalog/asset identity は vendor distribution を含み、package 更新から独立して immutable です。Catalog の `url` は `urn:iriograph:asset-source:...` locator であり、network URL や package 内 path ではありません。実際の取得 URL は resolver lease にだけ現れます。

## 収録 metadata

13個の curated service entry に、次を固定しています。

- 日本語/英語 label、日本語/英語 category、日本語概要
- canonical slug と一般的な service alias
- 公式 archive 内 path、個別 SVG SHA-256、byte length、`viewBox`
- 未導入時に表示できる非ブランドの category-initial fallback
- Amazon SageMaker → Amazon SageMaker AI の rename と旧 alias
- AWS IoT 1-Click の full-shutdown metadata
- package が予約する catalog/asset/template/locator namespace

`resolveAwsServiceAlias("EC2")` のように alias を immutable asset ref へ解決できます。旧 `SageMaker` alias は現行 asset を返しつつ `aws-icon-renamed` warning を残します。

## 未導入時

引数なしの resolver は network や filesystem に触れず、明確な diagnostic と fallback metadata を返します。

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
// result.fallback === { kind: "category-initial", text: "EC2", ... }
```

## 利用者取得 archive の local mapping

1. [AWS Architecture Icons](https://aws.amazon.com/architecture/icons/) から Asset Package を利用者自身で取得します。
2. archive の SHA-256 が manifest の `distribution.archiveSha256` と一致することを host/build pipeline で確認します。
3. archive を host 管理領域へ展開し、manifest の `sourceArchivePath` を mapping に使います。

Bytes mapping は package 内で byte length、個別 SHA-256、UTF-8、`viewBox`、危険な SVG content を検証してから Blob URL にします。次の例の filesystem access は host application が行い、この package 自身は `node:fs` に依存しません。

```js
import { readFile } from "node:fs/promises";
import {
  AWS_ICON_ASSET_NAMESPACE,
  createAwsIconAssetResolver,
  getAwsIconMetadata,
} from "@iriograph/icons-aws";

const assetRef = `${AWS_ICON_ASSET_NAMESPACE}service:amazon-ec2`;
const entry = getAwsIconMetadata(assetRef);
const expandedPath = `/user-owned/aws-icons/${entry.sourceArchivePath}`;

const resolver = createAwsIconAssetResolver({
  delivery: "local",
  localAssets: new Map([[entry.sourceArchivePath, { path: expandedPath }]]),
  async localPathProvider({ path }) {
    return { bytes: await readFile(path) };
  },
});

const result = await resolver.resolve({ assetRef });
```

`localAssets` の key は `assetRef`、`sourceArchivePath`、`slug` の順で照合します。値には `Uint8Array` / `ArrayBuffer` / `{ bytes }` を直接指定することもできます。Path mapping は host の `localPathProvider` が必須です。

## Host の署名 URL

Host が user-owned archive から検証済み asset を配信する場合は、HTTPS origin allowlist と immutable metadata の attestation が必要です。

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

Resolver は AWS 公式 archive URL を download せず、provider に期待 metadata として渡すだけです。署名 URL は allowlist 外 origin、HTTP、credentials、SHA-256/length/media type/viewBox 不一致を拒否します。

## 診断と namespace

`diagnoseAwsAssetReference()` と resolver は `aws-icon-renamed`、`aws-icon-deprecated`、`aws-icon-version-mismatch`、`aws-icon-not-found` を区別します。`diagnoseAwsCatalogReference()` は exact version のない catalog ref と別版を拒否します。

`assertNoAwsReservedNamespaceCollision()` は外部 catalog がこの package の catalog/asset/template/source-locator namespace を上書きすることを拒否します。Bundled manifest 自身を明示登録する場合だけ `{ allowBundledCatalog: true }` を使えます。

## 公式一次資料

すべて 2026-08-29 取得・確認です。

- [AWS Architecture Icons](https://aws.amazon.com/architecture/icons/) — 公式 icon package、diagram での利用、更新方針
- [AWS icon package 2026-Q3](https://d1.awsstatic.com/onedam/marketing-channels/website/public/shared/architecture-icon-release/Icon-package_07312026.5846e92413caa21490223536cc97f1269e44fa92.zip) — metadata の対象となる公式 archive
- [AWS sample Architecture Diagram MCP](https://github.com/aws-samples/sample-architecture-diagram-mcp-server) — Terms のため icon 非同梱、利用者 download、local root、initial fallback の公式 sample
- [AWS Site Terms](https://aws.amazon.com/terms/) — copyright と site content の条件
- [AWS Trademark Guidelines](https://aws.amazon.com/trademark-guidelines/) — mark、非提携表示、誤認防止
- [Amazon SageMaker AI rename](https://docs.aws.amazon.com/sagemaker/latest/dg/whatis.html) — 2024-12-03 の名称変更
- [Services in Full Shutdown](https://docs.aws.amazon.com/general/latest/gr/full_shutdown_services.html) — AWS IoT 1-Click の終了日

対象 archive の SHA-256 は `d2d166c453526471749d520e0db022c459abef759d2946cf2dd1d1c992dc6526`、byte length は `13,988,918`、HTTP Last-Modified は `2026-08-06T07:01:09Z` です。Archive と icon artwork は AWS の条件に従って利用してください。この package は AWS と提携、後援、承認関係にありません。
