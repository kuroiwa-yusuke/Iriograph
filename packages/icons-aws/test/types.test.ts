import {
  AWS_ICON_ASSET_NAMESPACE,
  AWS_ICON_CATALOG_REF,
  assertNoAwsReservedNamespaceCollision,
  createAwsIconAssetResolver,
  createAwsIconCatalogResolver,
  diagnoseAwsAssetReference,
  getAwsIconFallbackMetadata,
  listAwsIcons,
  resolveAwsServiceAlias,
  type AwsAssetResolveRequest,
  type AwsAssetResolveResult,
  type CatalogRawSource,
} from "../index.js";

type CoreCompatibleCatalogResolver = {
  resolveCatalog(catalogRef: string): Promise<CatalogRawSource>;
};

type CoreCompatibleAssetResolver = {
  resolve(request: AwsAssetResolveRequest): Promise<AwsAssetResolveResult>;
};

const catalogResolver: CoreCompatibleCatalogResolver = createAwsIconCatalogResolver();
const metadataResolver: CoreCompatibleAssetResolver = createAwsIconAssetResolver();
const localResolver: CoreCompatibleAssetResolver = createAwsIconAssetResolver({
  delivery: "local",
  localAssets: new Map([["amazon-ec2", { path: "/user-owned/aws/ec2.svg" }]]),
  localPathProvider(expected) {
    return {
      url: "file:///user-owned/aws/ec2.svg",
      verifiedSha256: expected.sha256,
      byteLength: expected.byteLength,
      mediaType: expected.mediaType,
      svgViewBox: expected.svgViewBox,
    };
  },
});
const bytesResolver: CoreCompatibleAssetResolver = createAwsIconAssetResolver({
  delivery: "local",
  localAssets: { "amazon-s3": new Uint8Array() },
  bytesUrlProvider() {
    return { url: "blob:consumer-generated" };
  },
});
const signedResolver: CoreCompatibleAssetResolver = createAwsIconAssetResolver({
  delivery: "signed-url",
  allowedSignedUrlOrigins: ["https://assets.example.test"],
  signedUrlProvider(expected) {
    return {
      url: "https://assets.example.test/aws/icon.svg?signature=opaque",
      verifiedSha256: expected.sha256,
      byteLength: expected.byteLength,
      mediaType: expected.mediaType,
      svgViewBox: expected.svgViewBox,
    };
  },
});

void catalogResolver.resolveCatalog(AWS_ICON_CATALOG_REF);
void metadataResolver.resolve({
  assetRef: `${AWS_ICON_ASSET_NAMESPACE}service:amazon-ec2`,
  signal: new AbortController().signal,
});
void localResolver;
void bytesResolver;
void signedResolver;
void diagnoseAwsAssetReference(`${AWS_ICON_ASSET_NAMESPACE}service:amazon-sagemaker`);
void resolveAwsServiceAlias("SageMaker");
void getAwsIconFallbackMetadata(`${AWS_ICON_ASSET_NAMESPACE}service:amazon-s3`);
void listAwsIcons({ categoryId: "compute" });
void assertNoAwsReservedNamespaceCollision({
  catalogId: "urn:example:catalog",
  catalogVersion: "1",
  templates: {},
  assets: {},
});
