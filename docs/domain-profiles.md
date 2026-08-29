# Domain profileとvendor catalog

## Domain projection profile

`@iriograph/profile-kit`はdomain ontology、authoring metadata、projection rule、template、assetをCore分岐なしで配布するmanifestとconformance kitを提供します。Manifestはimmutable ID/version、integrity、default locale、opaque role/Group-kind ID、依存profile、license metadataを持ちます。

Validatorはrole/rule/template/asset衝突、missing dependency、unknown fallback、exact provenance、profile-guided authoring、license欠落を検査します。Reference workflow profileとfixtureは、標準predicate catalog再利用、generic task port、Mock/Cloud読込みを証明します。BPMN-like等の見た目を提供しても規格互換importや完全な規格準拠は別adapter/testなしに主張しません。

## AWS icon catalog

`@iriograph/icons-aws`はAWS Architecture Iconsの画像bytesを再配布せず、公式archiveの版、出典、hash、archive内path、日本語category、service alias、rename/deprecation情報だけを固定する任意packageです。Hostが利用条件に同意して取得した公式archiveをlocal providerへmapするか、allowlist済みHTTPS signed URL providerを注入します。

Portable overlayはversioned asset IRIだけを保存します。Resolverはexact catalog version/integrityを照合し、未導入、版不一致、rename、deprecated、missing asset、予約namespace衝突を別diagnosticとして返します。認証URLとbyteはdocumentへ入りません。

Core同梱Lucide iconとvendor iconは別namespaceです。Vendor brandをCore既定集合へ複製せず、package削除時もdocumentは未知assetの安全fallbackで開けます。
