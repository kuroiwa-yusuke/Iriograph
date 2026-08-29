# AWS Architecture Icons metadata notice

取得・確認日: 2026-08-29

## Package の配布内容

`@iriograph/icons-aws` は AWS Architecture Icons の artwork bytes を配布しません。npm tarball に SVG、PNG、ZIP その他の AWS icon asset は含まれず、package の実行時処理も AWS asset を download しません。

この package が配布するのは、AWS Architecture Icons 2026-Q3（release identifier `07312026`）を識別・検証するための metadata、Iriograph catalog、resolver 契約、非ブランド fallback metadata だけです。公式 artwork の権利は Amazon Web Services, Inc. またはその関連会社に帰属します。Iriograph は AWS と提携、後援、承認関係にありません。

## 利用者が取得する公式 archive

公式配布 archive:

`https://d1.awsstatic.com/onedam/marketing-channels/website/public/shared/architecture-icon-release/Icon-package_07312026.5846e92413caa21490223536cc97f1269e44fa92.zip`

- version: `2026-Q3`
- release identifier: `07312026`
- SHA-256: `d2d166c453526471749d520e0db022c459abef759d2946cf2dd1d1c992dc6526`
- byte length: `13,988,918`
- HTTP Last-Modified: `2026-08-06T07:01:09Z`

利用者は AWS 公式 Architecture Icons page から archive を自身で取得し、現行の AWS 条件に従って利用してください。Curated entry ごとの archive path、SHA-256、byte length は `catalog.manifest.json` に固定されています。Package は host が提供した展開済み local path/bytes mapping または署名 URL だけを解決します。

## 非同梱方式の根拠

AWS Architecture Icons page は、AWS の顧客・パートナーが toolkit と asset を architecture diagram 作成に利用でき、whitepaper、presentation、data sheet、poster 等に icon を配置できると説明しています。一方、同 page は raw SVG を第三者 npm package として再配布する権利をこの package に明示していません。AWS Site Terms は site content の copyright が AWS または供給者に帰属するとし、別途の license がない場合の複製・商用利用等に条件を設けています。

AWS 公式 `aws-samples/sample-architecture-diagram-mcp-server` も、AWS icon を Terms of Use のため bundle せず、利用者が公式 Asset Package を別途 download して取り込む方式を採っています。未導入時は category-colored initial に fallback し、既存 icon directory は host の `AWS_DIAGRAM_ICON_ROOT` で指定できます。この package も同じ公開可能な境界を採り、AWS artwork を配布せず、利用者取得・host 管理と metadata fallback を支援します。

この notice と package は AWS artwork の sublicense、再配布許諾、商標利用許諾を付与しません。利用時点の AWS 条件を確認し、必要な許諾を得てください。AWS との提携・後援・承認を示唆せず、公式 artwork の表示は AWS の現行ガイドラインに従ってください。

## 公式一次資料

- AWS Architecture Icons: https://aws.amazon.com/architecture/icons/
- AWS Architecture Icons 2026-Q3 archive: https://d1.awsstatic.com/onedam/marketing-channels/website/public/shared/architecture-icon-release/Icon-package_07312026.5846e92413caa21490223536cc97f1269e44fa92.zip
- AWS sample Architecture Diagram MCP: https://github.com/aws-samples/sample-architecture-diagram-mcp-server
- AWS Site Terms（Last Updated 2025-06-04）: https://aws.amazon.com/terms/
- AWS Trademark Guidelines & License Terms（Last Updated 2026-07-17）: https://aws.amazon.com/trademark-guidelines/
- Amazon SageMaker AI rename: https://docs.aws.amazon.com/sagemaker/latest/dg/whatis.html
- AWS Services in Full Shutdown: https://docs.aws.amazon.com/general/latest/gr/full_shutdown_services.html

すべて 2026-08-29 に取得・確認しました。条件は更新され得るため、利用時点の一次資料を優先してください。
