# 公開契約

## Document

portable documentの最小形は次です。独自拡張子は`.iriograph`を使用します。

```json
{
  "schemaVersion": "1",
  "kind": "iriograph.document",
  "documentId": "purchase-approval",
  "semantic": {
    "format": "text/turtle",
    "baseIri": "urn:example:purchase:",
    "authoringProfileRef": "urn:example:authoring-profile:purchase@1",
    "source": "@prefix : <urn:example:purchase:> .\n@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .\n@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .\n:lane a rdf:Bag ; rdfs:label \"申請者\"@ja ; rdfs:member :submit ."
  },
  "imports": [
    { "catalogRef": "urn:iriograph:catalog:rdf-rdfs@1" }
  ],
  "views": [
    {
      "viewId": "main",
      "kind": "node-link",
      "profileRef": "urn:iriograph:profile:rdf-rdfs:1",
      "layoutRef": "urn:iriograph:layout:hierarchical-lr:1",
      "locale": "ja",
      "overlay": {}
    }
  ]
}
```

`semantic.source`は意味の正本です。`views[].overlay`のkeyはview内element ID、各entryの`semanticRef`はIRIまたはstatement identityです。

### Document locatorとIRI解決

`.iriograph`のファイル名とworkspace pathはhostがdocumentを開くためのlocatorにすぎず、RDF
resourceのnamespaceには使いません。`documentId`もportable document自身のidentityであり、
RDF resource IRIの接頭辞ではありません。したがって、ファイルをrenameまたは別directoryへ移動しても、
`semantic.source`をparseして得るexpanded IRIは変わりません。

`semantic.baseIri`は、document URLを持たないfile upload、local working copy、database保存でもrelative
IRIを決定的に解決するためのportableなfallback baseです。絶対IRIであり、ファイル名から導出しません。
Turtle source内に`@base`がある場合はTurtle標準どおりそのlexical scopeで優先され、`@prefix`は
任意の外部namespaceへaliasを定義できます。たとえば次のsourceは、ファイル名に関係なく
domain resourceを`urn:example:order:`、外部語彙termをSchema.orgのIRIとして解決します。

```turtle
@base <urn:example:order:> .
@prefix : <urn:example:order:> .
@prefix schema: <https://schema.org/> .

:r1 schema:name "注文"@ja .
```

外部語彙のIRIをtripleで使うだけなら、ontology fileのdownloadやimportは必要ありません。外部ontologyの
定義triple自体を推論・validationへ加えたい場合は、当該定義を`semantic.source`へ同梱する必要があります。
Turtle中の`owl:imports`はsemantic tripleとして保持・表示できますが、Coreはnetworkから参照先graphを
暗黙取得しません。単一portable fileの意味datasetが、network状態によって変わることを避けるためです。

Top-levelの`imports`はTurtle/RDF graph importではなく、表示規則を持つversioned projection catalogの
参照だけです。`semantic.authoringProfileRef`、`imports[].catalogRef`、catalog/overlayのasset IRIは、
それぞれhost注入のprofile、catalog、asset resolverが取得先へ解決します。IRIとURL、workspace path、
取得bytesは別責務であり、絶対`https:` IRIであってもCoreが直接fetchすることはありません。

`semantic.authoringProfileRef`はv1の必須値で、semantic transactionに適用する語彙・IRI生成policyを参照します。Viewの投影方式を選ぶ`views[].profileRef`とは別の責務です。Hostは`@iriograph/profile-resolver`でprofile/vocabularyを取得・検証した`ResolvedAuthoringContext`を注入します。

`views[].locale`はv1の任意BCP 47 language tagで、label選択を決定的にします。省略時はlanguage tagのない`rdfs:label`を優先し、実行環境のlocaleで結果を変えません。

`viewId`はdocument内で一意なnamed viewのidentityです。Active viewの選択はeditor session stateとし、portable documentへactive flagを保存しません。v1のviewは`profileRef`によって表示する構造文法を選び、SPARQL queryまたは汎用filter式を保存しません。要素の一時hideに加え、選択集合とprimary selection、snap設定、grid表示toggle、viewportのscroll位置、zoom、pan、動的work areaもsession stateであり、overlayへ書き込みません。

標準RDF/RDFS catalogの公開presetは次のとおりです。

| Export | `profileRef` | 用途 |
|---|---|---|
| `standardRdfRdfsCatalog` | `urn:iriograph:profile:rdf-rdfs:1` | 既存互換のfull ontology/instance view |
| `standardRdfRdfsInstanceFlowCatalog` | `urn:iriograph:profile:rdf-rdfs:instance-flow:1` | 語彙定義を除いた業務instance・flow view |
| `standardRdfRdfsClassificationRegionCatalog` | `urn:iriograph:profile:rdf-rdfs:classification-region:1` | 既存文書が明示したclass-region表示の読込・編集互換 |

`createStandardRdfRdfsCatalog("full" | "instance-flow" | "classification-region")`でも同じcatalogを生成できます。Hostはdocumentのimport参照を解決し、viewの`profileRef`と一致するcatalogをruntime contextへ登録します。Presetによる非表示はprojection結果だけへ作用し、`semantic.source`と語彙索引は完全なまま保持します。

業務図向けのshape、style、package iconまで同じpackageから解決する自己完結presetは次です。意味ruleは上記RDF/RDFS presetと同一で、業務classやlabelによる特別扱いを追加しません。

| Export | `catalogRef` | `profileRef` |
|---|---|---|
| `standardWorkflowCatalog` | `urn:iriograph:catalog:workflow@1` | `urn:iriograph:profile:rdf-rdfs:1` |
| `standardWorkflowInstanceFlowCatalog` | `urn:iriograph:catalog:workflow-instance-flow@1` | `urn:iriograph:profile:rdf-rdfs:instance-flow:1` |
| `standardWorkflowClassificationRegionCatalog` | `urn:iriograph:catalog:workflow-classification-region@1` | `urn:iriograph:profile:rdf-rdfs:classification-region:1` |

`createStandardWorkflowCatalog(...)`でも同じpresetを生成できます。Portable documentがtop-level `imports`を持つ場合、Hostは各runtime profileへ、実際に解決へ使ったexactなversion付きrefを`sourceCatalogRefs`として登録します。Coreは全named viewで使うref集合とdocumentの宣言集合を比較し、不一致なら`catalog-import-context-mismatch`で投影を停止します。同じ`profileRef`を持つ別catalogへ黙ってfallbackしないため、Mockと組込みHostでtemplate、色、shape、iconが変わりません。`imports`のない旧文書と、取得元を申告できないlegacy runtimeは従来のprofile-only互換を維持します。

Viewの永続変更は`applyViewCommand`の`add`、`duplicate`、`configure`、`delete`、
`reset-overlay`だけを使います。`viewId`はimmutableで、duplicateはoverlayをexact cloneしながら
新IDを割り当てます。configureは対象viewだけを再照合し、locale-only変更はoverlayをexactに
維持します。deleteは壊れたviewにも適用でき、最後のviewは拒否します。詳細は
[Named view](../editor/views.md)を正本とします。

JSON sourceからportable documentを置換する場合は`previewPortableDocumentReplace`と
`applyPortableDocumentReplace`を対で使います。PreviewはJSON parse、document schema、semantic/profile、
すべてのnamed viewのprojection・layout・overlay reconciliationを実行し、元document fingerprintと
candidate fingerprintを保持します。Applyは両fingerprintとruntime identityを再検証し、staleまたは
一viewでもerrorなら一部を保存しません。Editorの全文Document sourceとactive View overlay sourceは
この同じ境界へ合流し、一回の成功を一つのhistory itemとして扱います。`confirmationId`はpreviewと
candidateの改変を検出するintegrity tokenであり、通常のDocument適用一回に別の確認modalを要求しません。

overlayには次を保持できます。

- `geometry`: x、y、width、height
- `pinned`と`placement`: 自動配置かユーザー固定か
- `appearance`: template、icon、catalog style preset、sparse styleの明示override、node内の`nodeLabelOffset`/`nodeLabelWritingDirection`/`nodeIconOffset`、Group Frame共通の`groupLabelAnchor`/`groupLabelOffset`/`groupLabelWritingDirection`/`groupIconOffset`/`groupIconScale`/`groupZOrder`、旧region alias、edgeごとの`edgeCaption`
- `routing`: edgeの`routeMode`、manual waypoint、label offset、source/target anchor、terminal override、curveのsparse curvature

`routing.waypoints`はsource/target attachmentを含まない、ユーザーが確定したmanual中間点だけです。
空配列はautomatic routingと同じ意味に正規化し、保存時は省略します。`routing.labelOffset`は
endpoint込みrouteのarc-length 50%地点からの相対値で、labelがないedgeには作成しません。
Edge routingの編集ではnode/container用の`pinned`、`placement`をedge overlayへ付けません。
`routeMode`は`auto`、`straight`、`orthogonal`、`curve`、`manual`の閉じた値です。`straight`と
`curve`はportable waypointを持ちません。`routing.curve`はendpointを重複保存せず、始点・終点からの相対
`sourceHandle`/`targetHandle`と、絶対座標の0〜64個のon-curve `knots`を持つsparse objectです。各knotは
`point`と任意の相対`incomingHandle`/`outgoingHandle`を持ち、handle未指定部分はendpointとlayout guide routeから
決定的に補完します。各Pointとcurve/knot自身のIRI-keyed `extensions`は座標編集・丸め・Scene投影・保存再読込を
通してdeep-copyで保持します。空の`curve`、NaN/Infinity、不正なknot配列はschemaで拒否し、最後の手動handle/knotを
除いた空状態は`curve`自体を省略したautomatic cubicへ正規化します。`orthogonal`等の自動modeが生成した障害物回避用の補助点もoverlayへ保存せず、
`manual`へ明示変換した場合だけmanual waypointとして保存します。

Region labelの`regionLabelAnchor`は外周上の0以上1未満の正規化位置、
`regionLabelWritingDirection`は`horizontal-right`または`vertical-down`の
閉じた値です。Region z-orderは同じviewのregion背景間だけを並べます。Semantic object本体の描画層は
通常時と選択時の双方で`region/sequence group < edge < node`を固定し、同種内のselection frontや
z-orderが別層を越えません。Edgeの`appearance.edgeCaption`はview overlayだけに保存し、predicate label、
semantic search、LLM contextへ昇格しません。

新規保存はcontainer/regionをまたぐGroup Frame共通fieldを使います。`groupLabelAnchor`は枠周上の位置、
`groupLabelOffset`は名称を内外周bandへ動かす-1以上1以下の正規化変位で、文字方向とは独立です。
`groupIconOffset`はheader/band内の有限な相対位置、`groupIconScale`は0.1以上8以下の倍率です。
`groupZOrder`は同じ構造層のGroup Frame間だけに作用します。旧`regionLabel*`/`regionZOrder`は読取互換として
解釈しますが、新しいGroup Frame操作が意味membership、Turtle、他のz bandを変更することはありません。

`appearance.iconRef`はassetの安定したIRIだけを保持します。workspace path、取得URL、
認証情報、画像bytesはportable documentへ保存しません。Catalogの`iconRef`は意味から
導出する既定値、overlayの`iconRef`はユーザーが個別に選択したoverrideです。

`appearance.nodeLabelOffset`と`appearance.nodeIconOffset`はnode中心を基準にしたCanvas unitの
有限な相対位置です。どちらもschema v1へ後方互換な任意fieldとして追加し、未指定は`{x:0,y:0}`と
同じ表示にします。Renderer/Editorはnode内から完全に失われない範囲へclampし、0へ戻したfieldは
overlayから省略します。`appearance.nodeLabelWritingDirection`は`horizontal-right`または
`vertical-down`だけを取り、既定の横書きは省略します。文字方向、offset、icon、geometryは独立して
共存し、いずれもlabel/iconの意味、Turtle、layout geometryを変更しません。

`appearance.styleRef`はcatalogの`styles`にある安定IRIを参照し、`appearance.style`は利用者が
個別に変更した`fill`、`stroke`、`text`、`accent`、`fillOpacity`、`strokeWidth`、`dash`だけを
sparseに保持します。`styleToken`はabsolute IRIを`styleRef`として読む旧互換fieldです。
任意CSS、class名、URL、scriptをstyleとして保存せず、reset時はoverrideを除いてcatalog値へ戻します。

## Catalog

v1 target catalogは次の宣言を持ちます。

- `rules`: type、predicate、fallback patternから汎用projection operatorへの写像
- `templates`: primitive kind、shape、既定size、style、icon参照、閉じたsource/target terminal marker
- `styles`: overlayからIRI参照できる安全なsparse style preset
- `assets`: asset IRIからresolver hintとなる取得定義への写像

`AssetDefinition.url`と`mediaType`はcatalog schema互換のため保持しますが、取得結果としては信頼しません。Host resolverは自身のpolicyと取得正本から実URL、実media type、byte lengthを確認します。Workspace固有assetのようにcatalog外の`iconRef`を解決する場合、resolverへ渡すdefinitionは`undefined`です。

標準catalogはRDF/RDFS IRIを`membership-container`、`membership-region`、`ordinal-sequence`、`alternative`、`direct-edge`、`suppress`へbindします。未登録の直接IRI-object tripleはfallback edgeになります。rule schema、競合解決、標準bindingは[RDF/RDFS profile](../semantics/rdf-profile.md)を正本とします。
`membership-container.membershipPredicate`は限定RDFS `subPropertyOf` closureで照合し、sourceで使った
exact predicateはmembership provenanceと`set-membership`逆編集へ保持します。

`instance-flow`は標準編集の既定で、`rdfs:Class` / `rdf:Property` resourceとschema定義edgeをcatalog ruleで`suppress`しますが、非表示property IRIを可視instance間のpredicateとして使うdirect edgeは保持します。Class、subclass、type assignmentはTurtleから導出する型一覧で失わず扱います。`classification-region`は既存文書が明示した場合だけclassの`membership-region` ruleを維持し、property resourceとschema定義edgeだけを`suppress`します。Presetは個別IRI、namespace、labelに依存せず、Editorは読込時にprofileや意味sourceを暗黙変換しません。

現行の正規化contractは上記`rules`です。`nodeRules`、`relationRules`、`containmentRules`を持つ`DiagramCatalog`は既存hostの移行だけに残す互換APIであり、stable APIとはしません。

## Scene

`projectSemanticView(document, catalog, viewId, options)`は保存documentを変更せず、意味graphからgeometry未確定の`ProjectedScene`を同期的に返します。`layoutProjectedDiagramScene(projected, layoutRef, registry, mode)`はlayoutだけを非同期に適用し、renderer向け`Promise<DiagramScene>`を返します。`buildIriographView(document, viewId, context, mode)`はview profileに対応する解決済みcatalogを選び、両者を順に呼ぶconvenience APIです。Projectionとlayoutの公開責務は統合せず、Sceneはいずれもderived dataであり保存正本ではありません。`DiagramCatalog`を受けてgeometryまで返す同期`projectIriographDocument` overloadは移行用互換contractです。

現在のprimitiveは`node`、`edge`、`container`、`region`、`annotation`です。Annotationはsemantic statementまたはview metadataから導出し、意味由来か表示由来かをprovenanceで区別します。
`node-link` viewは単一parentの階層配置に`container`を使い、`region` viewは複数membershipを
重なり可能な半透明領域で表します。`ProjectedScene.memberships`/`DiagramScene.memberships`は
viewの階層化可否にかかわらず全membershipとprovenanceを保持します。複数containerに属する要素へ
一つの`parentElementId`を恣意的に選びません。

`rdf:Seq`は`SceneContainer.groupRole: "sequence"`として投影します。各`rdf:_n`は
`memberships[]`の`role: "sequence-member"`、1始まりの`ordinal`、元statement provenanceとして
保持し、`SceneEdge`にはしません。Rendererは薄いgroup枠とmember badgeで通常predicate edgeから
視覚的に分け、layoutは同一Seq内のordinal順を配置制約として利用できます。

`membership-region`はmembershipの向きを明示し、class regionでは`rdf:type`のobjectをregion、
subjectをmemberとして投影します。複数membershipの交差cellはSceneから導出するだけで、新しい
semantic resourceやoverlay identityを作りません。各elementの`semanticText`は全label/commentと
localeで選択したprimary labelを保持し、language、datatype、元statement identityを失いません。
Edgeの`labelProvenance`はpredicateまたはAlt branchのどこから表示名を得たかを区別します。Seqの名前と説明はgroupの`semanticText`、順序はordinal membershipのprovenanceに保持します。

`@iriograph/vue-editor`の`deriveTypeSystem(document, options)`はSceneとは別に、型、親子DAG、直接・継承別の
resource、cycleをlabel-firstな`TypeSystemPresentation`へ導出します。完全IRIは`TypeSystemIndex`の
resolver/command compile境界だけに保持し、通常DOMにはstable opaque `typeId`/`resourceId`を渡します。
構造制御用の`rdf:Property`、`rdf:Bag`、`rdf:Seq`、`rdf:Alt`等は通常の利用者型一覧から除きます。
代表型tagは直接型だけを対象に、subclass上のspecificity、resolved node roleの高い`displayPriority`、
最後にIRI code-point順で一件へ決定します。これはderived presentationでありoverlayへ保存しません。

Direct edgeの`semanticText`はpredicate resource自体のlabel/commentです。これとは別に、
`ProjectedEdge.statementComments` / `SceneEdge.statementComments`はそのexact S/P/Oに対する
説明をRDF 1.1標準reificationから返します。各値はlanguage、datatype、comment statement identity、
reifier参照を保持しますが、reifier自身を通常のnode/edgeへ投影しません。Rendererはこのfieldだけを
読めばよく、RDF datasetやblank nodeを解釈しません。

`SceneEdge.route`はlayoutから導出されるrenderer用polylineで、source/target attachmentを含む
2点以上の配列です。`SceneEdge.waypoints`はportable overlay由来のmanual中間点だけを表し、
両者を同じ配列として保存しません。Rendererは`route`を優先し、`route`を持たない旧Scene入力に
限ってsource/target geometryとlegacy waypointから経路を補います。
`sourceMarker`/`targetMarker`は`none`、`arrow`、`open-arrow`、`triangle`、`diamond`、`circle`の
閉じたrenderer vocabularyです。これはpredicate identityの代用ではなく、未知predicateは共通線と
generic arrowへfallbackします。

Target Sceneの各elementとparent-child関係は、次のedit provenanceを持ちます。これはderived dataでありdocumentには保存しません。

- 元になったstatement identityの集合
- projectionしたcatalog ruleとoperator
- 直接tripleからの投影か、構造からのderived elementか
- 削除・置換時に使えるsemantic edit capabilityとそのparameter

Editorはderived edgeやcontainer所属を「Scene上の線やparent ID」として削除しません。このprovenanceから、直接statementの削除、sequence/alternativeの再構成、membershipの削除など、元の意味構造に対応するsemantic commandを発行します。SeqはgroupまたはそのmemberをCanvas選択した後だけ、追加・並べ替え・除外を`set-sequence`の一つのatomic transactionとして実行します。

### Layout adapter

ProjectionはRDF datasetとcatalog ruleからgeometry未確定のScene primitive、包含、edge、provenanceを導出します。Layout adapterはその結果とviewの`layoutRef`、方向、既存geometry、pin制約を受け取り、geometryと自動routingを非同期に返します。Rendererは完成した`DiagramScene`だけを受け取り、semantic graphやlayout engineを参照しません。

```ts
export interface LayoutAdapter {
  readonly layoutRef: string;
  layout(request: LayoutRequest): Promise<LayoutResult>;
}
```

`LayoutRequest.fixedDerivedRoutes?`は`route-only` transactionだけが使うoptionalな
`edgeId -> endpoint込みroute`です。Bezierの公開routeは端点だけなので、対になる
`fixedDerivedRouteChoices?`がfamily、制御点、rejection traceを保持します。指定routeとchoiceはadapterの
自動routing対象外で、返却値でもJSON値として完全一致しなければなりません。標準adapterは
initial/refinement/compactionから除外し、他のaffected routeの交差・重複costには固定peerとして含めます。
未対応のthird-party adapterが両fieldを無視してもCore共通completionが指定値を復元するため後方互換ですが、
局所計算量の削減を保証するにはadapter自身の対応が必要です。これらはtransaction-localなScene derived値であり、
document overlay、waypointへ保存しません。

Coreはnode-link、LR/TB階層、Bag container、pinned geometryを扱う決定的な標準軽量adapterを提供し、Vue editorはこれをdefaultとして利用します。Hostがlayout adapterを明示注入した場合は同じinterfaceでworkerを使う高機能adapter等へ差し替えます。Adapter未解決、失敗、結果不正はdiagnosticとし、異なるlayoutへ黙ってfallbackしません。標準adapterはunordered endpoint pair内をelement IDのcode-point順で束ね、parallel laneを20 unit間隔、右側self-loopを36 unitから兄弟ごとに18 unit拡張して決定的にrouteします。Node attachmentの範囲を超えるparallel laneはnode外stubを使って間隔を維持し、routeの正方向への張り出しをScene boundsへ含めます。自動生成routeはsource/target以外の中間点を最大1個にし、直線で障害物回避と接続品質を満たす場合は0個にします。Optional adapterの結果も同じcompletionを通し、manual waypointはこの上限の対象外です。

Re-layoutの通常対象は`placement: "generated"`かつ`pinned !== true`の要素だけです。`placement: "user"`または`pinned: true`のgeometryは固定制約としてadapterへ渡します。明示的な「自動配置へ戻す」presentation commandによってplacementをgenerated、pinnedをfalseへ戻した場合に限り、次のlayoutで再配置できます。

### Asset resolver

Projectionとlayoutは`iconRef`までを導出し、URLを取得しません。`resolveDiagramSceneAssets(scene, definitions, access, signal)`は完成したSceneに含まれる一意なicon IRIをhost注入の非同期resolverへ渡し、policy検証済みの`iconUrl`をScene cloneへ補完します。入力Sceneとportable documentは変更しません。

```ts
type AssetAccess = {
  resolver: AssetResolver;
  policy: {
    allowedMediaTypes: readonly AssetMediaType[];
    maxBytes: number;
    maxDecodedPixels?: number;
    maxConcurrentResolutions?: number;
    allowedSchemes: readonly string[];
    allowedOrigins: readonly string[];
  };
  revision: string;
};

interface AssetResolver {
  resolve(request: {
    assetRef: string;
    definition?: AssetDefinition;
    revision: string;
    signal: AbortSignal;
  }): Promise<AssetResolveResult>;
}
```

Resolved resultはabsolute URL、実media type、実byte lengthとidempotentな`release()`を持つleaseです。Coreはcatalog宣言とのmedia type一致、byte上限、許可scheme・originに加え、decoded raster面積を検証します。`maxBytes`は取得したencoded payloadの転送・保持量、`maxDecodedPixels`は展開後のraster memory規模を制限する独立した上限です。一方を満たしても他方の検証を省略せず、圧縮率の高い巨大画像とbyte数の大きい低解像度画像を同じ値で近似しません。`maxDecodedPixels`省略時は64 Mi pixel、`maxConcurrentResolutions`省略時は4で、同時数のhard上限は32です。面積超過leaseとbatch abort後の未採用leaseはCoreが即時releaseします。未解決、移動、削除、取得失敗、policy違反はwarningとしてiconなし表示へfallbackし、semantic transactionをrollbackしません。返されるScene batchの`release()`は採用しなかったstale result、Scene交換、editor破棄時に呼びます。Blob URLの生成・cache・revokeとworkspace revisionの更新はhost責務です。Coreはviewport visibilityとDOM decodeを知らないため、`loading="lazy"`、viewport優先順位、virtualizationはrenderer/host責務です。

Coreが同梱する既定SVGは`urn:iriograph:icon:lucide:<name>:1`を予約namespaceとして使います。
`packageDefaultIcons`/`packageDefaultIconAssets`は選択肢と定義を、`packageDefaultIconDataUrl`と
`createPackageDefaultIconResolver`は配布物内の同じSVGを解決します。このnamespaceはpackageが
管理し、catalog/host定義で上書きしません。同梱refだけは検査済みpackage bytesから直接解決する
trusted pathであり、hostの`AssetPolicy`を拡張・緩和しません。それ以外のassetは従来どおりhost
resolverと元のpolicyを必ず通ります。`withPackageDefaultIconAccess(hostAccess)`もhost policy objectを
そのまま維持します。

既定packageは業務フロー、組織、クラウド・インフラ、データ、通信、セキュリティ、運用、物流に使える74個の汎用Lucide SVGを同梱します。各候補は日本語label、固定source commit、license metadataを持ち、実SVGと埋込みsourceをtestで一致確認します。AWS等のvendor固有brand assetは、この予約namespaceへ混ぜません。再配布条件、版更新、廃止を独立管理できるversioned catalogとhost resolverを使い、portable overlayには同様にasset IRIだけを保存します。

### Annotationとrole付きport

Catalogは明示したliteral predicateだけをstatement-bound annotationへ投影します。Scene annotationは本文、language/datatype、source statement identity、対象resource、exact provenanceを保持し、本文をoverlayへ複製しません。未登録literal predicateはdatasetへ保持しても自動annotationにしません。

Named viewはsemanticと独立したstable annotation ID、本文、geometry、style、任意elementへの表示anchorをoverlayに持てます。これはpresentation transactionだけで編集し、対象消滅時はdetachします。Semantic commentへの変換は別の明示semantic commandです。

Node templateはstable `portId`、source/target role、配置候補、接続可能predicate/classを宣言できます。Edge overlayの`sourcePortId`/`targetPortId`は端子位置だけを変え、S/Oを変えません。未登録、role不適合、catalog変更後のportは外周anchorへfallbackしdiagnosticを返します。別nodeへの付け替えは引き続きsemantic transactionです。

## Semantic transaction

`applySemanticSource(document, source, context)`は、authoring policyを伴わない互換用semantic source APIです。Controlled writeは`applyAuthoringSource(document, source, resolvedAuthoringContext, { actor, signal })`を使い、Turtleをparseしてactor policy、RDF/RDFS構造、全viewの非同期layoutを検証した`Promise<SemanticSourceUpdate>`を返します。`ProjectionRuntimeContext`はprofile別の解決済みcatalog、layout adapter registry、projection optionsを含みます。Human structured authoringにも、hostが解決済み語彙・policy・元revisionを束ねた`ResolvedAuthoringContext`を注入します。Profile URIからこのcontextを取得するresolverは`@iriograph/profile-resolver`の責務です。

Domain constraintは任意の`ResolvedSemanticValidationContext`としてhostが注入します。`applySemanticSource`、canonical source/dataset、`ResolvedAuthoringContext.semanticValidation`は[Semantic validation](../semantics/validation.md)の同じ非同期portへ合流します。Portable documentへvalidator設定や結果を保存せず、SHACL engineへ直接依存しません。`SemanticSourceUpdate`は通常の`accepted/document/diagnostics`に加え、control flowとしての`aborted`と、domain warning再確認用`warningConfirmation`を返す場合があります。

- 失敗: `accepted: false`とdiagnosticsを返し、元documentを維持
- 成功: `accepted: true`とreconcile済みdocumentを返す

`applyAuthoringSource`の`actor`は`human`または`llm`のどちらかを必須とし、不明値や欠落はfail closedにします。LLM transactionではauthoring profile未解決、unknown term追加、term minting、許可外resource namespaceをerrorとして扱います。`DiagramCatalog`を受ける同期`applySemanticSource` overloadは既存host向けの移行用互換contractです。

Human structured authoringは`previewAuthoringCommands(document, commands, context, options)`で開始します。Previewは元documentとresolved contextのfingerprint、正規化済みcommand、追加・削除statement、candidate Turtle、diagnostics、stable confirmation IDを返します。Warningを含むpreviewも明示確認できますが、blocking errorを含むpreviewは適用できません。

通常UIの薄い境界には`previewStructuredAuthoringRequest`を使います。`create-direct-relations`は一つのrequest内で同じS/P/Oが重複する場合、または一行でも既存asserted S/P/Oと一致する場合に全行を拒否し、部分的なedge追加を返しません。`set-group-members`の候補グループは`defaultMemberIndex`で選んだ出現位置を`rdf:_1`へ移し、それ以外の出現位置の相対順を維持します。同じIRIが複数ordinalにあってもindexで選んだ一件を基準にします。

既存通常要素の種類は`set-node-roles`へ完全な`roleId`集合を渡して変更します。Coreはprofileのopaque role IDをclassへ解決し、管理対象roleだけを置換してその他の既存typeを保持します。Group構造typeとの混在、現在のprofileにないrole、Group Frameをnodeとして編集するrequestは拒否します。分類領域一件またはderived intersectionを表す複数領域選択は`structuredNodeRoleSeedFromCanvasSelections`でopaque role ID集合へ変換し、class IRIをpresentationへ返しません。

名前・説明の通常編集は`structuredLocalizedTextPresentation`が返すopaque `valueId`を`update-localized-text`へ戻します。Coreは選択したliteralのlexical valueだけを置換し、そのlanguage/datatypeと同じpropertyの他翻訳を完全保持します。Presentationには`default`、`translation`、`untagged`、`typed`という区分だけを返し、生のlanguage tag/datatype IRIの編集はTurtle sourceへ限定します。

Exact predicateの意味階層を通常UIへ渡す場合は、host/editor内部で解決したpathを`structuredPredicateHierarchyPresentation`へ入力します。Coreはtop-levelの既知direct predicateだけを採用し、path内termをpredicate catalogと同じ`termId`優先・hash fallbackでopaque化します。返却DTOは`predicateId`、label、全path、cycle/truncation diagnostic、query/validation policyの説明だけを持ち、生のIRIをpresentation itemやDOMへ返しません。Semantic-accessへの依存やlabel一致によるidentity解決は行いません。

`applyAuthoringPreview(document, preview, context, options)`はconfirmation IDを信用してcandidateを直接保存せず、現在のdocumentとcontextからcommandを再compile・再validateします。元source、document revision、context identity、previewした追加・削除statement集合のいずれかが変わっていればstaleとして拒否します。これによりallocator完了待ち、別のpresentation edit、profile更新、preview JSONの改変を跨いだ適用を防ぎます。Apply後は`applySemanticSource`と同じparse、構造検証、全view投影、非同期layout、reconciliationへ合流します。Human UIとLLMに別々のcandidate graph検証経路を作りません。

新規resourceのIRIをcommandで省略した場合だけ、previewはhost注入の`ResourceIriAllocator`を呼びます。Allocator resultはabsolute named IRI、許可namespace、graph内のsubject・predicate・object全termとの衝突をCoreで再検証し、正規化commandへ固定します。Cancel、Abort、stale response、allocator errorではdocumentを変更しません。

Turtle textareaから`applyAuthoringSource(..., { actor: "human" })`を実行した場合、妥当な入力sourceは原文のまま保持します。`previewAuthoringCommands`/`applyAuthoringPreview`と`applyAuthoringSource(..., { actor: "llm" })`はcandidate datasetを共通のversioned serializerで決定的なTurtleへ再serializeしてから確定します。再serializeでは有効なprefix/baseを可能な範囲で再利用しますが、comment、空白、改行位置、triple記述順の保持はcontractに含めません。

semantic transaction成功時は、更新したTurtleとreconcile済みview overlayを一つのdocument revisionとして返します。各viewは個別の`profileRef`、`layoutRef`、locale、解決済みcatalogで再投影します。Reconcileは次を行います。

- 存続element identityのuser overlayを、変更後primitiveと互換な範囲で維持する
- 新規elementをlayoutし、保存が必要な初期geometryに`placement: "generated"`を付ける
- Standard editorの`create-resource`は初期位置を受け取らず、新規elementを`placement: "generated"`としてlayoutする。作成後の位置変更は独立したpresentation transactionにする
- 消滅elementのoverlayと、primitive変更後に互換性がないfieldを除去しdiagnosticを返す
- Catalogで導出できるtemplate、style、iconをoverlayへ複製しない

Sceneとcatalog既定appearanceは保存正本ではなく、「Turtle変更と同時にdisplayを補完する」とは、成功transactionがそのまま全viewで表示でき、必要最小限のoverlayだけが返ることを意味します。

### Human semantic command

Rich editorがtargetとするcommandは少なくとも次を含みます。CommandのIRIとpredicateはcompact labelではなく完全なIRIとしてcoreへ渡します。

| Command | 意味graphへの効果 | 主な制約 |
|---|---|---|
| `create-resource` | named resourceと初期statementを追加 | named IRIと、そのresourceをsubjectまたはobjectに含む少なくとも1tripleが同一transactionに必要。node作成UIではtarget viewでnode/containerに投影できることも検証。低水準`initialPosition`はrootで現在のScene外も許可し、省略時32768の安全extentまたは親Group content boundsを超える場合だけ拒否 |
| `set-property` | literalまたはIRI propertyを追加・置換・削除 | predicate、datatype/language、cardinalityはprofile/domain validationの対象 |
| `connect-resources` | subjectからobjectへの関係を作る | predicate必須。直接IRI-object tripleまたはcapability定義のgraph patchとし、generic predicateを暗黙生成しない |
| `set-statement-comments` | exact direct statementの説明集合を置換・削除 | `statementRef`とnamed S/P/Oの一致、元tripleの存在を必須とする。複数language・複数行literalを許可し、空配列は個別説明を削除する |
| `set-membership` | containerとmemberの所属を追加・削除 | Bagではcontainer-subject、class分類ではclass-objectの向きをcatalogから解決する。複数membershipを許容し、hierarchy container間cycleを検証 |
| `set-sequence` | 順序付きmemberを再構成 | `rdf:Seq`と`rdf:_n`を一括更新し、連番制約を途中状態に適用しない |
| `set-alternatives` | 選択肢と既定選択を再構成 | `memberIris`を最終ordinal順の正本として`rdf:Alt`と`rdf:_n`を一括更新。2件以上かつ`memberIris[defaultOrdinal - 1] === defaultMemberIri`を要求し、重複IRIを保持 |
| `delete-resource` | resourceをsubjectとする記述statementとresourceを削除 | Coreでcascade省略時は他subjectからの参照があれば拒否。標準Editorは選択外の関連objectへ波及する場合だけ影響modal付き明示cascadeを使い、選択済み集合内なら直接確定する。Seq/Alt member削除は同じpatchで再採番 |

`set-statement-comments`は独自語彙を作らず、assertedな`S P O`を残したまま次の標準形を使います。

```turtle
[] a rdf:Statement ;
  rdf:subject :S ;
  rdf:predicate :P ;
  rdf:object :O ;
  rdfs:comment "この関係だけの説明"@ja .
```

既存のmatching reifierが複数ある場合は決定的な順で読み、置換commentはその先頭へ集約します。
既存named reifierのidentityや標準外metadataは黙って削除せず、空になったblank標準scaffoldだけを整理します。新規reifierはblank nodeです。`remove-statement`とresource cascadeは対応reifierのclosureも同じatomic patchから
除去します。UI/hostはN3 termを構築せず、`statementIdentityForNamedStatement({ subjectIri,
predicateIri, objectIri })`でexact identityを得られます。同一command列で先に新statementを接続し、
続けてその説明を設定できます。

Standard editorの`新しい要素を作る`は、最初にnodeまたはgroupを選びます。Nodeは名前とresolved profileが公開するnode-roleを一件以上（`allowUntypedNodes`のときだけ0件）、通常profileのgroupは名前と包含・順序付き・候補等の業務構造kind一件を要求します。Classの作成・編集・複数上位型・一括型付与は独立した`型一覧`へ集約し、標準flowでclassをGroup Frameとして作りません。旧`classification-region`互換を明示するhost/profileだけは従来の分類groupを許可できます。Host allocatorが返すopaque named IRIへ`rdfs:label`と選択済みの全`rdf:type`を一つの`create-resource`へcompileします。空label、未許可role、allocator失敗、IRI衝突、namespace違反は一件も保存せず作成を拒否します。Comment、上位概念、既存resourceとのedge、membership、初期位置は作成formに含めず、作成確定後の対象別意味編集、`型一覧`、`ビュー`で別transactionとして追加します。Catalog projectionと標準layoutが初期displayを補完します。

Coreの一般`create-resource.initialStatements` contractはhost/LLM adapter向けに複数statementを扱えますが、standard editorが複合作成formを公開する理由にしません。構造predicateを一般initial statementで迂回できず、ordinal predicate等は専用commandを使います。Edgeはsource/targetに加えpredicateまたはsemantic capabilityの選択を必須にします。Container内へのplain dragはgeometryのpresentation transactionのみで、所属を暗黙変更しません。

右Inspectorの意味編集は初期blur状態で`新しい要素を作る`、`関係を作る`、`要素を変更する`、`関係を変更する`の4入口だけを表示し、入口の後は一段に一つの判断を順次表示します。要素作成はnode/group、node-roleまたはgroup kind、名前の順です。関係作成はicon cardでdirect/membershipを先に選び、directは一始点・複数接続先・共通または行別predicate、membershipは既存group・複数member・必要な順序/既定候補を一つのrequestへcompileします。Membership memberは既存Canvas選択と、名前・node-roleだけのephemeral新規chipを混在でき、確定時に全resourceとmembershipをatomicに作ります。Canvas事前選択は各roleへ明示的にseedし、family切替でdraftを相互変換しません。非削除の意味操作は一回の実行内でcandidate validationとatomic transactionを行い、確認画面を重ねません。意味入力とビュー入力は同時表示せず、`意味`と`ビュー`のtabで片方だけを表示します。Tabを往復しても未実行の段階入力を黙って破棄しません。

右クリック、Context Menu key、Shift+F10は同じ対象別menuを表示します。Node、direct edge、derived sequence/alternative guide、各group kind、空白ごとに適用可能な意味・ビュー・配置・削除の入口だけを示し、derived guideは所有groupの構造編集へ委譲します。Menu選択は対応Inspector/actionへfocusするだけでmutationを実行せず、disabled理由とfocus returnを維持します。左sidebarはviewとScene elementの一覧に使います。語彙とresourceの選択肢はopaque option IDとlabel/comment、形のpreviewだけをpresentation DTO/DOMへ返し、完全IRIをoption value、tooltip、read-only Advanced参照情報へ渡しません。Host/editor内部でopaque IDをresolved contextとScene provenanceからexact IRIへ戻してCore transactionを構成します。同名labelをidentityとして使いません。生IRIを表示・編集できる標準入口はeditableなTurtle/Document sourceだけです。順序・候補グループ・定義済み操作は利用者向け名称を表示し、`set-sequence`、`set-alternatives`、capability patch等の内部語を通常画面へ露出しません。

Relation pickerは候補名を`A（predicate label）B`、説明をcatalog/vocabularyの日本語文型metadataとしてcategory別に表示します。候補はresolved profile内のRDF/RDFS/OWL、DCTERMS、PROV-O、SKOS等の標準predicateを、source/targetの明示型、限定subclass closure、`rdfs:domain`/`rdfs:range`、object/literal kind、semantic capabilityで絞ります。型不明は後順位に残し、完全OWL推論やlabel推測を行わず、candidate validationを最終判定とします。同じpredicateを使う個別edge captionはview overlay annotationであり、semantic commandを生成しません。

主要なresource欄は明示的な「Canvasから選択」modeを持ちます。このmode中だけnode/container clickを対象fieldへseedし、通常のselection、drag、container内配置からsubject、predicate、membershipを推論しません。Pickerは同じfieldの再押下、Escape、Cancel、`readOnly`への切替、Scene交換で解除します。Picker中のnode/container clickは通常の選択・geometry gestureを開始しません。`要素を追加`は位置や所属をseedせず、label確定後にgenerated geometryを得ます。

通常のpresentation dragからsemantic membershipを推論しません。Editorは、意味上のparentを持たない要素のcenterがcontainer content上にある場合と、意味上のchild geometryがparent contentからはみ出す場合をdisplay/semantic containment不一致として警告します。前者は`set-membership` commandまたは領域外へのpresentation移動、後者は意味上の領域内へのpresentation移動またはprovenance由来のmembership削除commandを明示選択できます。警告検出とpresentation修正はTurtleを変更せず、semantic修正は利用者の実行一回の内部でcandidate validationとatomic transactionを行います。

選択外へ波及する削除の確認modalは、対象label、関係・所属・並び順の種別、影響件数をraw Turtleより先に示し、Canvas上の削除対象を赤線・赤破線で示します。このpreviewはeditor内部のephemeral session stateであり、portable document、Scene正本、overlay、historyへ入りません。通常の非削除操作には別の確認画面を設けません。

`set-property`はsubjectとpredicateに対応する既存値をすべて置換し、値配列が空なら明示削除します。空文字列literalは削除ではなく有効な一値です。IRI/literalの複数値を保持し、Literalのlanguageとdatatypeは同時指定できません。Property参照の削除は、そのstatementだけを除去し、参照先blank nodeのclosureが孤立しても推測cascadeしません。`rdfs:member`と正規の正整数suffixを持つ`rdf:_n`等の構造predicateはproperty UIから変更せず、membership、sequence、alternative専用commandを使います。`set-alternatives`は上記の最終ordinal順と既定候補のordinal 1配置を必須にします。

Capabilityのparameterは`required: false`の場合だけoptionalです。Optional bindingを省略したcommandでは、そのbindingを参照するexact template statementをadd/remove双方からskipし、残りのstatementだけをatomic patchへ含めます。

Allowed resource namespaceはcreate-resourceだけでなく、全structured commandおよびdirect source editで新規導入されるinstance IRIの各出現位置へ適用します。Editorは既存resourceの候補選択と明示createを優先しますが、Coreは特定command専用のnamespace例外を持ちません。

Resource deleteのcandidateはresourceがsubject、object、predicateのいずれとして現れるstatementも影響集合へ含めます。低水準Core commandはcascade省略時に外部参照が一つでもあれば拒否します。標準Editorは現在の選択集合からexplicit cascadeを構成し、選択外のedge、membership、Seq/Alt membershipへ波及する場合だけ影響集合をconfirmation対象にします。削除後のSeqは1件以上、Altは2件以上を満たし、残るordinalは同じatomic patchで1から再採番します。Authoring contextが既知class/predicateとして定義する語彙resource自体は削除できません。

Resource deletionの永続結果は、必要な場合に確認済みのexplicit cascadeを一つのsemantic revisionとして確定したものだけです。Pending delete、soft delete、赤線appearanceをdocumentへ保存しません。Edge、property、membershipの削除もexact statement/structure patchの確定でのみ永続化し、presentation-only deletionは定義しません。

新規resourceの初期geometryはstandard layoutが`placement: "generated"`として補完し、`要素を追加`formに位置指定modeやcontainer membership seedを持ちません。作成後の明示dragはpresentation transaction、所属追加は`所属・並び順を編集`のsemantic transactionとして分けます。実行前はportable document、Scene、historyを変更せず、candidate validationとlabel statementの確定が成功した場合だけ一つのsemantic revisionとしてcommitします。

Literal propertyはv1で独立Scene elementを生成しない場合もありますが、inspector等の語彙駆動UIで編集でき、Turtleには失わず保持します。表示primitiveがないことをsemantic属性が存在しないことと同一視しません。

## Vue editor

hostは`@iriograph/vue-editor`を編集領域へ埋め込みます。

```vue
<script setup lang="ts">
import { ref } from "vue";
import { IriographEditor } from "@iriograph/vue-editor";
import "@iriograph/vue-editor/styles.css";

const editor = ref<InstanceType<typeof IriographEditor>>();
</script>

<template>
  <IriographEditor
    ref="editor"
    v-model="document"
    v-model:active-view-id="activeViewId"
    :runtime-context="projectionRuntimeContext"
    :dirty="dirty"
    :saving="saving"
    :asset-access="assetAccess"
    :asset-options="workspaceAssetOptions"
    :workspace-locator="workspaceLocator"
    :pick-asset="pickWorkspaceAsset"
    :authoring-context="resolvedAuthoringContext"
    :resource-iri-allocator="resourceIriAllocator"
    :document-identity-allocator="documentIdentityAllocator"
    :predicate-inference-policy="{ query: 'rdfs-subproperty', validation: 'exact' }"
    @duplicated-as-new="openDuplicatedDocument"
    @save="saveToWorkspace"
  />
</template>
```

主なcontract:

- `modelValue` / `update:modelValue`: portable document正本
- `runtimeContext`: profile別catalog、layout registry、projection optionを持つ正規contract
- `catalog`: 単一catalog host向けのdeprecated互換prop
- `activeViewId` / `update:activeViewId`: optional controlled active view。省略時はuncontrolled
- `save`: packageは未適用draftのflush成功後にだけ永続化要求を通知する。Event handlerは現在の`modelValue`を保存し、同じEditorへ`flushPendingEdits()`を再入しない
- `validationChanged`: semantic/project diagnostics
- `assetAccess`: 非同期resolver、media/size/URL policy、host revision
- `assetOptions`: `{ assetRef, label?, path?, mediaType? }[]`。workspace treeの画像を人向けlabelと正確なpath候補へ対応付けるhost注入値。Editorはpathを入力補完へだけ使い、保存時は`assetRef`へ変換する
- `workspaceLocator`: document pathと入力pathを受け、segment候補、breadcrumb、最終`assetRef`解決を返す同期metadata port。Workspace-root相対、`/`始まり、`./` / `../`を正規化し、root escape、folder、not-found、曖昧pathを拒否する。Asset取得、認証、権限確認は行わない
- `pickAsset(request)`: workspace pickerを開き、選択時はassetRefだけを返すhost callback
- `authoringContext`: hostが解決した語彙・capability・policy・projection runtime
- `semanticValidationContext`: hostが解決したdomain validation identity/revision/port。省略時は`authoringContext.semanticValidation`を利用可能
- `resourceIriAllocator`: resource IRI省略時の同期または非同期allocator。返却IRIはCoreが再検証する
- `documentIdentityAllocator`: 「新しい図として複製」用にhost内で一意なopaque `documentId`と、現在と異なるabsolute base IRIを発行するhost port。CoreはID形式を固定せず、Mock/CloudはUUIDを採用できる。requestの`requestId`と`documentRevision`を応答へそのまま返し、stale responseをEditorが拒否できるようにする
- `duplicatedAsNew(handoff)`: parsed term単位のIRI rebaseと全view検証を終えたcopyをhostへ渡す。現在の`modelValue`、history、dirty stateは変更しないため、hostが別fileへ保存して開く
- `predicateInferencePolicy`: `query`と`validation`がexact predicateだけか限定`rdfs:subPropertyOf`推論を使うかをInspectorへ説明するpolicy。Projection ruleやasserted edge数を変更しない
- `initialLeftSidebarCollapsed`: 新しいEditor sessionの左sidebar初期値。既定`true`で、以後の開閉はsession-only
- `fitOnInitialLoad`: 各document/viewで最初に完成したSceneだけを、負座標とrouteを含む実content boundsへfitするhost opt-in。session-only作業余白はfit対象に含めず、後続のsemantic/presentation編集では利用者のviewportを維持する
- `flushPendingEdits()`: Turtle、View overlay、全文Document sourceの未適用draftをそれぞれのatomic pipelineで検証し、保存前に正本へ反映する。入力途中または未実行のstructured draftは自動適用せず保存を拒否する
- `panBy(x, y)` / `zoomTo(zoom)` / `fitToView()` / `fitToSelection()`: hostからsession viewportを操作。Toolbarのpreset/listと同じzoom stateを共有する
- `revealSelection()` / `focusElement(elementId)`: 現在の選択またはstable Scene element IDをviewportへ表示
- `selectElement(elementId)` / `selectElements(elementIds)` / `selectAll()` / `clearSelection()`: hostからsession selectionを操作
- `setSnapSettings(settings)`: grid、対象要素へのsnapをsession内で設定
- `selectionChanged(primaryElementId)`: 既存のprimary selection通知
- `selectionSetChanged(elementIds)`: ordered selection集合の通知
- `pendingDraftsChanged(pending)`: 未適用のTurtle、View overlay、全文Document source、structured authoring draftの有無。hostの保存可否・離脱確認に利用

`DocumentIdentityAllocator.allocate()`のrequest/resultは次のrevision-bound contractです。

```ts
type DocumentIdentityAllocationRequest = {
  currentDocumentId: string;
  currentBaseIri: string;
  documentRevision: string;
  requestId: string;
  signal?: AbortSignal;
};

type DocumentIdentityAllocation = {
  documentId: string;
  baseIri: string;
  documentRevision: string;
  requestId: string;
};
```

Editorはallocator完了後に元document fingerprint、revision、request IDを再確認し、Coreの
`previewDocumentRebase` / `applyDocumentRebasePreview`でlocal namespaceのnamed termとoverlay referenceだけを
一括mappingします。Preview適用は元documentを置換せず、`DocumentDuplicateHandoff`を一回emitするだけです。
現在と同じbaseは`document-rebase-base-unchanged`と`allocate-new-document-base`の修正行動で拒否します。
衝突判定は旧termが移動する前の占有ではなく、RDF term、overlay key/semanticRef、statement identityをすべて
同時に写した最終集合で行います。異なるsource identityが同じ最終identityへ集約されるmany-to-oneだけを拒否するため、
旧namespace配下へ新namespaceを置くcopyでも、さらに先へ移動するnested termを偽衝突にしません。
同一内容のclipboard copyはこのallocatorを呼ばずidentityも変更しません。

公開`IriographDiagramCanvas`はedge編集時に
`routingUpdate({ elementId, routing?: { waypoints?, curve?, labelOffset?, sourceAnchor?, targetAnchor? } })`を発行します。`routing`は
その操作後のeditable routing全体を表すsparse valueです。Waypoint操作では旧host向けの
`routingChange({ elementId, waypoints })`も併発しますが、標準Editorは`routingUpdate`だけを
購読して二重適用を避けます。

Node内配置を有効にするhostは公開Canvasへ`nodeContentEditing`を渡します。選択nodeのlabel/icon dragは
`nodeContentOffsetUpdate({ elementId, target: "label" | "icon", offset? })`を発行し、pointer move中は
Canvasだけをpreviewします。`offset`省略はresetです。標準Editorはこれをsparse appearance transactionへ
変換し、`gestureStart`/`gestureEnd`の間を一つのundo itemにします。

取込、書出、workspace tree、HTTP、revision conflict、認証・権限はhostの責務です。

Viewport navigationはportable documentを更新せず、`update:modelValue`、presentation history、dirty stateを発生させません。標準UIはblank canvasのprimary dragと任意箇所のmiddle drag、選択geometryがないfocus済みCanvasのArrow/Page key、fit、選択への移動、minimapを提供します。位置を持つ要素を選択しているArrowは1 unit、Shift+Arrowは10 unitのpresentation移動とし、`N` / `Shift+N`を次 / 前のobject focusへ割り当てます。処理済みArrowはpage scrollへ伝播させず、input、contenteditable、IME composition中はCanvas shortcutを無効にします。Node drag中にpointerがviewport端へ近づいた場合は同じ方向へsession scrollを進め、geometry transactionとは分離します。Node、container、resize handle、waypoint上のprimary pointerは編集gestureを優先し、panを開始しません。`readOnly`はsemantic/presentation editを禁止しますが、閲覧に必要なpan、zoom、fit、minimap、selection revealは無効化しません。

埋込みEditor自身はhostの横幅を広げる固定最小幅を持ちません。右Inspectorは選択概要と段階actionを優先したcompact密度とし、長い説明・技術情報を折り畳みます。三列layoutが狭い場合はEditor内部で横scrollでき、左右sidebarを折り畳めばCanvasが利用可能幅へ拡張します。Canvasのscroll viewportは`min-width: 0`を持ち、scene外周のlabelやresize handleはpaperでclipせずscroll padding内へ描画します。公開CanvasをEditor外で単独利用する場合もpaper色とgridのfallbackを持ちます。HostはEditorを置く領域に有限のblock-sizeを与えます。

Canvasのsession work areaは、実content boundsの各辺へ初期320 canvas unitの余白を加えます。Drag/resize中にpreviewが端へ達すると、必要な正負方向へ160 unitずつ単調に拡張し、負方向拡張では同じ画面位置を維持するようscrollを補正します。一つのgesture中に何度でも拡張でき、dropを要求しません。Work area、拡張量、scroll補正はnavigation sessionであり、portable document、overlay、history、dirty stateへ入りません。

Multi-selectionはplain clickで置換、Ctrl/Cmd clickでtoggle、Shift clickで追加、blank clickまたはEscapeでclear、Ctrl/Cmd+Aで全選択します。選択中のnode/containerをdragすると全選択geometryを共通deltaでpreviewし、pointerup時に一つのbatch presentation transactionとして確定します。選択containerの子孫も同deltaで移動し、ancestorとdescendantを同時選択しても二重移動しません。異なるcontainerの要素を同時に動かす場合は、各要素の親container content boundsから許容deltaの共通部分を求め、membershipは変更しません。整列と等間隔も一commandを一transactionとし、Turtleを変更しません。

Resize可能なnode、container、regionは選択時に四隅と四辺中央の8 handleをsemantic object層とは別のtransient interaction layerへ表示します。Waypoint、endpoint halo、resize handle、draft markerだけは操作性のためnodeより前面でhit testできますが、object本体、通常edge線、terminal markerをこの層へ複製しません。Region/Seq本体の一時前面化は構造層内だけです。Regionのmove/resizeは意味上のnode、container、region memberの全boundsとpaddingを包含し、複数region memberに必要なintersectionを壊さない範囲へclampします。Pointer/keyboard gesture、Inspector数値入力、align、distributeを含む全geometry保存入口で同じ制約を再検証し、制約を満たさない候補geometryはoverlayへcommitしません。

標準snapは8 canvas unitのgridと、対象要素のleft/center/right、top/middle/bottom guideを使います。対象候補は距離、座標、element IDの順で決定的に解決し、target snapをgridより優先してからcontainer/Scene境界へclampします。Target toleranceの標準値は画面上6pxでzoom変換し、Altを押したdragでは一時的にsnapを無効化します。Snap設定とguide候補はsession stateで、documentやhistoryには保存しません。`readOnly`でもselectionとsnap設定の参照・変更は可能ですが、drag、keyboard move、resize、routing、整列、等間隔、undo/redoはdocumentを変更しません。

Canvas gridはsnapの`gridSize`と同じcanvas unitと原点を使い、既定値8を重複定義しません。低倍率ではsnap値を変えず、その整数倍となる主要線の表示間隔を画面上8px以上にし、線幅を逆zoomで補償して画面上1pxを保ちます。Gridのpattern offsetはCanvas座標変換から求め、zoom、scroll、panへ追従します。描画layerはhit-test対象外で、表示toggleは`ビュー`tabから変更できるsession stateです。Toggle操作は`update:modelValue`、presentation history、dirty stateを発生させず、Turtle、overlay、portable documentへ保存しません。

Edgeはclick/focusで個別選択し、parallel edgeとself-loopも各routeのhit areaを持ちます。選択edgeの
ビューtabはroute modeとsource/target terminalを先に表示し、captionとendpoint anchor操作は折り畳み段階へ分けます。Anchorの正規化数値とprojection ruleは通常UIへ出しません。`straight`と`curve`ではwaypoint追加UIを表示せず、portable waypointを必ず除去します。Curveでは生の座標表を出さず、Inspectorから曲線点の追加・個別削除・automatic復帰を行います。
`orthogonal`または`auto`のgenerated bend handleを初めて編集するとderived route中間点をmanual waypointへseedします。
Path double clickとInspectorはwaypoint追加、handle dragとArrow keyは移動、Delete/Backspaceは削除を
行い、最後のmanual waypoint削除はautomaticへ戻します。Labelはroute全長の中央をbaseとし、drag、
Arrow key、Inspector数値入力でoffsetを編集し、Home/Delete/BackspaceまたはInspectorでresetします。
各pointer gestureと各keyboard/Inspector commandは一つのpresentation undo itemです。新規追加・移動座標は
Scene内側8 unitへclampします。旧documentから読み込んだ負座標は勝手に正規化せず、そのままでは
Scene原点外がclipされ得るため、handle編集またはautomatic resetで現行境界へ戻します。`readOnly`は
edge選択を許可しますが編集handleを表示せず、routing eventを受けてもdocumentを変更しません。
Curve pathのdouble clickは描画曲線上へknotを追加し、選択中はon-curve knot、接線line、Bezier handleだけを
transient interaction layerへ表示します。Knot/handleはdragまたはArrow key（Shiftで10 unit）で操作し、
Delete/Backspaceで削除・automatic resetします。Knotの片側handle変更は反対側へ鏡映して接線を保ちます。
Knot/handle自体は追加tab stopにせず、Canvasの単一tab stopと`aria-activedescendant`を維持します。選択edgeでは
`[`/`]`でactive curve controlを循環し、Ctrl/Cmd+Arrow、`W`/Insert、Ctrl/Cmd+Deleteを既存の
keyboard routing commandとして適用します。
描画本体は`M`と連続するcubic `C`だけからなる一つのvisible pathで、別のstraight/polylineを重ねません。
透明な太いhit pathは選択専用に分離し、control半径はzoomの逆数で補正します。Curve label/captionのbaseは
実cubicを弧長近似した50%地点です。
Content bounds、fit、revealは保存済みknot/handleだけでなく、automatic curveが補完したcontrolとbowも含む
cubic control hullから求め、画面外の曲線や操作点を切りません。

Canvasの`semanticEndpointReconnectRequest({ edgeElementId, endpoint, targetSemanticRef })`は、意味tabでdirect edge端子を別nodeへdropした場合だけ発行します。空白、container、region、同じendpoint nodeへのdropでは発行しません。標準Editorは既存statement削除、新statement追加、exact statement comment移行を一つのatomic semantic transactionとして実行し、未接続の中間状態を作りません。ビューtabで同じhaloをdragした場合は従来どおり`routingUpdate`だけを発行します。
Edge本体のDelete/Backspaceはprovenanceからexact semantic commandを構成し、candidate validation後に削除します。直接edgeだけの削除や影響objectをすべて選択した削除は確認画面を挟まず確定し、選択外のedge、membership、Seq/Alt membershipへ波及するときだけ影響modalを表示します。Provenanceがない場合はpredicateや構造を見た目から推測しません。

Rich authoring contractでは、hostが解決済みauthoring profile、vocabulary index、
active viewのprojection capabilityを`authoringContext`として注入します。Editorはこのcontextから
class、属性predicate、edge predicate、包含・順序・選択操作を提示します。Resource IRIを
ユーザーに直接入力させないhostは、allowed namespace内で衝突しないIRIを返すallocatorも
注入できます。Authoring context未解決時はstructured semantic commandを無効化し、
source参照・presentation編集の許可まで失わせません。

`ResolvedAuthoringContext`はauthoring profile identity、vocabulary term index、projection capability、resource namespace、actor policyが解決済みであることを要求します。Predicate termは任意に`objectKinds`、許可datatype、許可language、`minCount`、`maxCount`を持てます。人間が未登録termを使う場合はpolicyに従ってwarningまたはerrorとします。標準Editorは未登録IRIを入力させず、非削除warningは該当fieldのinline guidanceとして返して同じ操作を確定しません。低水準Coreのcontrolled source APIはhost向けwarning confirmation contractを維持しますが、標準UIに確認modalを追加する理由にはしません。Resource IRIを自動生成するhostは同期または非同期allocatorを注入します。Mockはstatic fixtureのcontextとallocatorを利用します。`authoringProfileRef`やvocabulary URIからcontextを取得するresolverとintegrity検証は`@iriograph/profile-resolver`、取得cacheはHost transportの責務であり、Editorへ取得処理を入れません。

Host asset pickerは選択したabsolute asset IRIだけを返し、Editorは`appearance.iconRef`のpresentation transactionとして保存します。URLやbytesをpicker resultへ含めません。Cancel、stale response、不正IRIではdocumentを変更しません。

ファイル移動後も維持できるopaque IRIを優先します。Assetまたはdocumentのpath renameでは、hostがworkspace locatorとAsset resolverのmapping/revisionだけを更新し、同じstable `assetRef`を新しいpath・取得先へ解決します。既存documentの`appearance.iconRef`とview overlayは書き換えません。Path由来IRI等でidentityを維持できない場合だけ`moved`とreplacement IRIをdiagnosticにし、Editorは自動置換せず、削除・not-foundと同様にユーザーの再選択を待ちます。同期`ProjectionOptions.resolveAssetUrl`はlegacy `DiagramCatalog`投影だけに残すdeprecated APIであり、正規化projectionとVue editorは使用しません。

## LLM adapter

LLMへは`document.semantic.source`、authoring profileから抽出した語彙ガイド、関連projection capability summaryを渡します。返却Turtleは`actor: "llm"`のsemantic transactionへ入力します。portable document全体やoverlayをLLMの自由編集対象にしません。

位置、size、routing、色、icon overrideはpresentation requestとして処理します。Lane、順序、選択、domain typeなど意味を伴う表示要求だけをprofile-guided semantic rewriteの候補にします。詳細は[Authoring profile](../semantics/authoring-profile.md)を参照します。
