# @iriograph/profile-kit

Domain ontology、authoring metadata、projection catalog、asset/licenseを一つの配布単位として
検証するためのmanifestとconformance helperです。Catalogやontologyを一つのschemaへ
平坦化せず、標準catalogはversioned dependencyとして再利用します。

このkitが確認するのはIriographとの接続契約です。BPMN等の外部規格準拠を主張しません。

## 任意のAWS icon catalog

AWS Architecture IconsのmetadataとHost注入resolver helperは、次のsubpathから利用します。

```ts
import {
  AWS_ICON_CATALOG_REF,
  createAwsIconAssetResolver,
  createAwsIconCatalogResolver,
  resolveAwsServiceAlias,
} from "@iriograph/profile-kit/aws-icons";
```

このsubpathは公式archiveの版、path、hash、日本語category、service alias、rename/deprecation診断を持ちますが、AWS artworkを同梱・downloadしません。HostがAWSの条件に従って取得したassetをlocal mappingまたはallowlist済みsigned URL providerから供給します。

Manifestは`@iriograph/profile-kit/aws-icons/catalog.manifest.json`、出典と配布境界は`@iriograph/profile-kit/aws-icons/NOTICE.md`から参照できます。
