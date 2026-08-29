# Agent・host連携

この文書は、Iriographの意味正本をLLMや外部serviceへ安全に公開し、候補を人が確認して適用する境界を定義します。Coreはnetwork、tenant、認証、model SDKを持ちません。

## 解決済みauthoring context

`@iriograph/profile-resolver`は`semantic.authoringProfileRef`を起点に、immutableなprofileとvocabulary importを取得し、宣言ID、version、integrity、循環、重複、role競合を検証します。出力の`ResolvedAuthoringContext`はopaqueな`roleId`/`predicateId`、locale別value ID、Group kind、default localeと任意のsemantic validation contextを持ちます。取得とcacheはHost注入transportの責務で、解決結果はprofile revisionと取得物fingerprintへ束縛します。

取得不能、stale、不正manifest時も既存graphのreadは可能です。ただしsemantic writeはfail closedにします。Draftやoptionはcontext revisionを跨いで再利用しません。

## 要求の分離

`@iriograph/agent-bridge`は自然言語要求をsemantic、presentation、mixedの候補へ分類します。分類は権限ではありません。Semantic portとpresentation portが、current document revision、resolved context、許可fieldをそれぞれ再検証します。

- semantic: 要素、predicate、membership、順序、候補、名前・説明などの意味正本
- presentation: geometry、size、色、routing、template、iconなどのview overlay
- mixed: 上記二候補を別々のrevision-bound reviewへ出す。不可分な一transactionへまとめない

領域内に見える、近くにある等のgeometryからmembershipや順序を推論しません。Presentation要求からTurtleを変更しません。

## Semantic transport

`SemanticJsonTransport`は`@iriograph/semantic-access`のlabel-first index/write facadeをJSON transportへ閉じます。通常DTOはopaque alias/option ID、label、comment、近傍、membershipだけを持ち、raw IRI、Turtle全文、overlay、asset byte、認証付きURLを返しません。

Hostは各requestで次を行います。

1. 認証主体、tenant/organization、permission、rate/size budget、abort signalを確認する
2. service側のcurrent document revisionとresolved profileを読み直す
3. client aliasやcandidateを信用せず再解決する
4. Coreのauthoring transactionへcompileし、validation後にatomic保存する
5. actor、revision、operation、結果を監査する

Cloud adapterはworkspace revisionとcurrent contextを毎request取得します。MCP、HTTP、Python RDF libraryはこのtransportのclientまたは内部索引実装にはできますが、別のwrite正本にはしません。

## 閉じたpresentation tool

`@iriograph/presentation-tools`はread-only Sceneを`PresentationSceneBridge`で安全なopaque IDへ写し、compact target/capability summaryだけをagentへ渡します。Bridgeはsource IRIと取得URLを外部DTOへ出さず、承認済みpatchだけをHost内部でsource overlay IDへ戻します。

候補はsparse patchであり、任意CSS/URL、semantic write、Turtle、asset/image bytesを表現できません。Field、件数、座標、routing点、request/response byte、時間、tokenをHost policyで制限し、stale revision、未登録option、非finite値、包含違反、budget超過をrejectします。Render portはopaque screenshot IDだけを返し、画像bytesはsession storageに残します。

## 外部候補review

`ExternalCandidateReviewPanel`はsemantic差分とpresentation差分を別sectionにし、それぞれdocument/context revision、exact patch、diagnostic、candidate screenshotへ束縛します。利用者は片方だけapply/rejectできます。通常のCanvas操作や人の非削除structured editにはこの確認を挟みません。

Presentation候補のapplyはTurtle byte列を変更せず、semantic候補のapplyは別transactionとして全named viewをreconcileします。Rejectやvalidation failureは正本を変更しません。

## Cloud registry transport

Cloudはcatalog、vocabulary、profile、asset参照を同じ認証・immutable version・integrity・cache基盤から取得しますが、schemaを一つへ平坦化しません。Tenant/organization越境を拒否し、asset byteと署名URLをportable documentへ保存しません。Offline時はexact fingerprintの既存cacheだけを読み取りに使い、stale contextでwriteしません。
