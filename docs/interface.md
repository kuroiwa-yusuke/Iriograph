# 公開インターフェース

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

`semantic.authoringProfileRef`はv1の必須値で、semantic transactionに適用する語彙・IRI生成policyを参照します。Viewの投影方式を選ぶ`views[].profileRef`とは別の責務です。P1のhostは解決済み`ResolvedAuthoringContext`を注入し、この参照からprofile/vocabularyを取得・検証するresolverはP2-01で追加します。

`views[].locale`はv1の任意BCP 47 language tagで、label選択を決定的にします。省略時はlanguage tagのない`rdfs:label`を優先し、実行環境のlocaleで結果を変えません。

`viewId`はdocument内で一意なnamed viewのidentityです。Active viewの選択はeditor session stateとし、portable documentへactive flagを保存しません。v1のviewは`profileRef`によって表示する構造文法を選び、SPARQL queryまたは汎用filter式を保存しません。要素の一時hideに加え、選択集合とprimary selection、snap設定、viewportのscroll位置、zoom、pan状態もsession stateであり、overlayへ書き込みません。

Viewの永続変更は`applyViewCommand`の`add`、`duplicate`、`configure`、`delete`、
`reset-overlay`だけを使います。`viewId`はimmutableで、duplicateはoverlayをexact cloneしながら
新IDを割り当てます。configureは対象viewだけを再照合し、locale-only変更はoverlayをexactに
維持します。deleteは壊れたviewにも適用でき、最後のviewは拒否します。詳細は
[view-management.md](./view-management.md)を正本とします。

overlayには次を保持できます。

- `geometry`: x、y、width、height
- `pinned`と`placement`: 自動配置かユーザー固定か
- `appearance`: template、icon、catalog style preset、sparse styleの明示override、region等の`labelPlacement`
- `routing`: edgeの`routeMode`、manual waypoint、label offset、source/target anchor

`routing.waypoints`はsource/target attachmentを含まない、ユーザーが確定したmanual中間点だけです。
空配列はautomatic routingと同じ意味に正規化し、保存時は省略します。`routing.labelOffset`は
endpoint込みrouteのarc-length 50%地点からの相対値で、labelがないedgeには作成しません。
Edge routingの編集ではnode/container用の`pinned`、`placement`をedge overlayへ付けません。
`routeMode`は`auto`、`straight`、`orthogonal`、`curve`、`manual`の閉じた値です。`straight`以外の
自動modeはlayoutが返す障害物回避routeを利用し、`curve`はそのcorridor内のbendだけをrendererが
滑らかにします。自動生成した補助点はoverlayへ保存しません。

`appearance.iconRef`はassetの安定したIRIだけを保持します。workspace path、取得URL、
認証情報、画像bytesはportable documentへ保存しません。Catalogの`iconRef`は意味から
導出する既定値、overlayの`iconRef`はユーザーが個別に選択したoverrideです。

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

標準catalogはRDF/RDFS IRIを`membership-container`、`membership-region`、`ordinal-sequence`、`alternative`、`direct-edge`、`suppress`へbindします。未登録の直接IRI-object tripleはfallback edgeになります。rule schema、競合解決、標準bindingは[rdf-rdfs-profile.md](./rdf-rdfs-profile.md)を正本とします。
`membership-container.membershipPredicate`は限定RDFS `subPropertyOf` closureで照合し、sourceで使った
exact predicateはmembership provenanceと`set-membership`逆編集へ保持します。

現行の正規化contractは上記`rules`です。`nodeRules`、`relationRules`、`containmentRules`を持つ`DiagramCatalog`は既存hostの移行だけに残す互換APIであり、stable APIとはしません。

## Scene

`projectSemanticView(document, catalog, viewId, options)`は保存documentを変更せず、意味graphからgeometry未確定の`ProjectedScene`を同期的に返します。`layoutProjectedDiagramScene(projected, layoutRef, registry, mode)`はlayoutだけを非同期に適用し、renderer向け`Promise<DiagramScene>`を返します。`buildIriographView(document, viewId, context, mode)`はview profileに対応する解決済みcatalogを選び、両者を順に呼ぶconvenience APIです。Projectionとlayoutの公開責務は統合せず、Sceneはいずれもderived dataであり保存正本ではありません。`DiagramCatalog`を受けてgeometryまで返す同期`projectIriographDocument` overloadは移行用互換contractです。

現在のprimitiveは`node`、`edge`、`container`、`region`です。`annotation`は型上予約されていますが未投影です。
`node-link` viewは単一parentの階層配置に`container`を使い、`region` viewは複数membershipを
重なり可能な半透明領域で表します。`ProjectedScene.memberships`/`DiagramScene.memberships`は
viewの階層化可否にかかわらず全membershipとprovenanceを保持します。複数containerに属する要素へ
一つの`parentElementId`を恣意的に選びません。

`membership-region`はmembershipの向きを明示し、class regionでは`rdf:type`のobjectをregion、
subjectをmemberとして投影します。複数membershipの交差cellはSceneから導出するだけで、新しい
semantic resourceやoverlay identityを作りません。各elementの`semanticText`は全label/commentと
localeで選択したprimary labelを保持し、language、datatype、元statement identityを失いません。
Edgeの`labelProvenance`はpredicate、Seq transition、Alt branchのどこから表示名を得たかを区別します。

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

Editorはderived edgeやcontainer所属を「Scene上の線やparent ID」として削除しません。このprovenanceから、直接statementの削除、sequence/alternativeの再構成、membershipの削除など、元の意味構造に対応するsemantic commandを発行します。

### Layout adapter

ProjectionはRDF datasetとcatalog ruleからgeometry未確定のScene primitive、包含、edge、provenanceを導出します。Layout adapterはその結果とviewの`layoutRef`、方向、既存geometry、pin制約を受け取り、geometryと自動routingを非同期に返します。Rendererは完成した`DiagramScene`だけを受け取り、semantic graphやlayout engineを参照しません。

```ts
export interface LayoutAdapter {
  readonly layoutRef: string;
  layout(request: LayoutRequest): Promise<LayoutResult>;
}
```

Coreはnode-link、LR/TB階層、Bag container、pinned geometryを扱う決定的な標準軽量adapterを提供し、Vue editorはこれをdefaultとして利用します。Hostがlayout adapterを明示注入した場合は同じinterfaceでworkerを使う高機能adapter等へ差し替えます。Adapter未解決、失敗、結果不正はdiagnosticとし、異なるlayoutへ黙ってfallbackしません。標準adapterはunordered endpoint pair内をelement IDのcode-point順で束ね、parallel laneを20 unit間隔、右側self-loopを36 unitから兄弟ごとに18 unit拡張して決定的にrouteします。Node attachmentの範囲を超えるparallel laneはnode外stubを使って間隔を維持し、routeの正方向への張り出しをScene boundsへ含めます。

Re-layoutの通常対象は`placement: "generated"`かつ`pinned !== true`の要素だけです。`placement: "user"`または`pinned: true`のgeometryは固定制約としてadapterへ渡します。明示的な「自動配置へ戻す」presentation commandによってplacementをgenerated、pinnedをfalseへ戻した場合に限り、次のlayoutで再配置できます。

### Asset resolver

Projectionとlayoutは`iconRef`までを導出し、URLを取得しません。`resolveDiagramSceneAssets(scene, definitions, access, signal)`は完成したSceneに含まれる一意なicon IRIをhost注入の非同期resolverへ渡し、policy検証済みの`iconUrl`をScene cloneへ補完します。入力Sceneとportable documentは変更しません。

```ts
type AssetAccess = {
  resolver: AssetResolver;
  policy: {
    allowedMediaTypes: readonly AssetMediaType[];
    maxBytes: number;
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

Resolved resultはabsolute URL、実media type、実byte lengthとidempotentな`release()`を持つleaseです。Coreはcatalog宣言とのmedia type一致、byte上限、許可scheme・originを検証します。未解決、移動、削除、取得失敗、policy違反はwarningとしてiconなし表示へfallbackし、semantic transactionをrollbackしません。返されるScene batchの`release()`は採用しなかったstale result、Scene交換、editor破棄時に呼びます。Blob URLの生成・cache・revokeとworkspace revisionの更新はhost責務です。

## Semantic transaction

`applySemanticSource(document, source, context)`は、authoring policyを伴わない互換用semantic source APIです。Controlled writeは`applyAuthoringSource(document, source, resolvedAuthoringContext, { actor, signal })`を使い、Turtleをparseしてactor policy、RDF/RDFS構造、全viewの非同期layoutを検証した`Promise<SemanticSourceUpdate>`を返します。`ProjectionRuntimeContext`はprofile別の解決済みcatalog、layout adapter registry、projection optionsを含みます。Human structured authoringにも、hostが解決済み語彙・policy・元revisionを束ねた`ResolvedAuthoringContext`を注入します。Profile URIからこのcontextを取得するresolverはP2-01の責務です。

Domain constraintは任意の`ResolvedSemanticValidationContext`としてhostが注入します。`applySemanticSource`、canonical source/dataset、`ResolvedAuthoringContext.semanticValidation`は[semantic-validation.md](./semantic-validation.md)の同じ非同期portへ合流します。Portable documentへvalidator設定や結果を保存せず、SHACL engineへ直接依存しません。`SemanticSourceUpdate`は通常の`accepted/document/diagnostics`に加え、control flowとしての`aborted`と、domain warning再確認用`warningConfirmation`を返す場合があります。

- 失敗: `accepted: false`とdiagnosticsを返し、元documentを維持
- 成功: `accepted: true`とreconcile済みdocumentを返す

`applyAuthoringSource`の`actor`は`human`または`llm`のどちらかを必須とし、不明値や欠落はfail closedにします。LLM transactionではauthoring profile未解決、unknown term追加、term minting、許可外resource namespaceをerrorとして扱います。`DiagramCatalog`を受ける同期`applySemanticSource` overloadは既存host向けの移行用互換contractです。

Human structured authoringは`previewAuthoringCommands(document, commands, context, options)`で開始します。Previewは元documentとresolved contextのfingerprint、正規化済みcommand、追加・削除statement、candidate Turtle、diagnostics、stable confirmation IDを返します。Warningを含むpreviewも明示確認できますが、blocking errorを含むpreviewは適用できません。

`applyAuthoringPreview(document, preview, context, options)`はconfirmation IDを信用してcandidateを直接保存せず、現在のdocumentとcontextからcommandを再compile・再validateします。元source、document revision、context identity、previewした追加・削除statement集合のいずれかが変わっていればstaleとして拒否します。これによりallocator完了待ち、別のpresentation edit、profile更新、preview JSONの改変を跨いだ適用を防ぎます。Apply後は`applySemanticSource`と同じparse、構造検証、全view投影、非同期layout、reconciliationへ合流します。Human UIとLLMに別々のcandidate graph検証経路を作りません。

新規resourceのIRIをcommandで省略した場合だけ、previewはhost注入の`ResourceIriAllocator`を呼びます。Allocator resultはabsolute named IRI、許可namespace、graph内のsubject・predicate・object全termとの衝突をCoreで再検証し、正規化commandへ固定します。Cancel、Abort、stale response、allocator errorではdocumentを変更しません。

Turtle textareaから`applyAuthoringSource(..., { actor: "human" })`を実行した場合、妥当な入力sourceは原文のまま保持します。`previewAuthoringCommands`/`applyAuthoringPreview`と`applyAuthoringSource(..., { actor: "llm" })`はcandidate datasetを共通のversioned serializerで決定的なTurtleへ再serializeしてから確定します。再serializeでは有効なprefix/baseを可能な範囲で再利用しますが、comment、空白、改行位置、triple記述順の保持はcontractに含めません。

semantic transaction成功時は、更新したTurtleとreconcile済みview overlayを一つのdocument revisionとして返します。各viewは個別の`profileRef`、`layoutRef`、locale、解決済みcatalogで再投影します。Reconcileは次を行います。

- 存続element identityのuser overlayを、変更後primitiveと互換な範囲で維持する
- 新規elementをlayoutし、保存が必要な初期geometryに`placement: "generated"`を付ける
- `create-resource`のPreviewでuserが初期位置を明示した場合は、意味statementと同じatomic transactionでそのgeometryを`placement: "user"`、`pinned: true`として保存する
- 消滅elementのoverlayと、primitive変更後に互換性がないfieldを除去しdiagnosticを返す
- Catalogで導出できるtemplate、style、iconをoverlayへ複製しない

Sceneとcatalog既定appearanceは保存正本ではなく、「Turtle変更と同時にdisplayを補完する」とは、成功transactionがそのまま全viewで表示でき、必要最小限のoverlayだけが返ることを意味します。

### Human semantic command

Rich editorがtargetとするcommandは少なくとも次を含みます。CommandのIRIとpredicateはcompact labelではなく完全なIRIとしてcoreへ渡します。

| Command | 意味graphへの効果 | 主な制約 |
|---|---|---|
| `create-resource` | named resourceと初期statementを追加 | named IRIと、そのresourceをsubjectまたはobjectに含む少なくとも1tripleが同一transactionに必要。node作成UIではtarget viewでnode/containerに投影できることも検証 |
| `set-property` | literalまたはIRI propertyを追加・置換・削除 | predicate、datatype/language、cardinalityはprofile/domain validationの対象 |
| `connect-resources` | subjectからobjectへの関係を追加 | predicate必須。直接IRI-object tripleまたはcapability定義のgraph patchとし、generic predicateを暗黙生成しない |
| `set-membership` | containerとmemberの所属を追加・削除 | Bagではcontainer-subject、class分類ではclass-objectの向きをcatalogから解決する。複数membershipを許容し、hierarchy container間cycleを検証 |
| `set-sequence` | 順序付きmemberを再構成 | `rdf:Seq`と`rdf:_n`を一括更新し、連番制約を途中状態に適用しない |
| `set-alternatives` | 選択肢と既定選択を再構成 | `memberIris`を最終ordinal順の正本として`rdf:Alt`と`rdf:_n`を一括更新。2件以上かつ`memberIris[defaultOrdinal - 1] === defaultMemberIri`を要求し、重複IRIを保持 |
| `delete-resource` | resourceをsubjectとする記述statementとresourceを削除 | 他subjectからresourceへの参照がある場合は既定で拒否。影響statementのpreview付き明示cascadeだけを許可し、Seq/Alt member削除は同じpatchで再採番 |

v1のnode作成UIはnamed IRIと、作成resourceをsubjectまたはobjectに含む少なくとも1tripleが確定するまで保存しません。作成resource自身のtype/labelに加え、既存resourceとのdirect edge、既存containerへのcatalog規定membership、初期位置を一つの`create-resource.initialStatements`と位置patchへcompileできます。任意欄を有効にしたままpredicate、相手resource、またはmembership構成が欠けている場合は部分適用せずPreviewをerrorにします。全statementと初期位置が検証を通った場合だけ一つのrevisionとして確定します。

`create-resource.initialStatements`で構造predicateを一般に迂回することはできません。唯一のv1例外は、subjectが既存named resource、objectが作成resource、predicateとcontainer typeがresolved context内の同じ`membership-container`規則へexact matchする場合です。作成resourceをsubjectにした構造statement、ordinal predicate、型が一致しないcontainerは拒否し、cycleは最終candidate graphのprofile検証へ委ねます。作成後の包含編集は通常どおり`set-membership`を使います。Edgeはsource/targetに加えpredicateまたはsemantic capabilityの選択を必須にします。Container内へのplain dragはgeometryのpresentation transactionのみで、所属を暗黙変更しません。

Node、edge、属性、包含、削除は対象objectまたはCanvas背景のcontext menuと作成paletteから開始し、右Inspectorの上部に`Meaning` command draftを開きます。属性一覧は選択objectのdetails dialogでも編集でき、その下の`Display Inspector`とは責務を分けます。左sidebarはviewとScene elementの一覧に使います。語彙とresourceの選択肢はlabel、説明、形のpreviewを主表示にし、完全IRIをoption value、tooltip、Advanced overrideとして保持します。Coreへ渡す値は常に完全IRIであり、同名labelをidentityとして使いません。順序・選択肢・定義済み操作は利用者向け名称を表示し、`set-sequence`、`set-alternatives`、capability patch等の内部語を通常画面へ露出しません。

主要なresource欄は明示的な「Canvasから選択」modeを持ちます。このmode中だけnode/container clickを対象fieldへseedし、通常のselection、drag、container内配置からsubject、predicate、membershipを推論しません。位置指定modeではblank canvas clickが位置だけをseedし、container背景clickは位置と、そのcontainerにexact matchするcatalog membershipをdraftへseedできます。いずれも即時commitせず、同じfieldのpicker再押下、Escape、Cancel、`readOnly`への切替、Scene交換で解除します。Picker中のnode/container clickは通常の選択・geometry gestureを開始しません。

通常のpresentation dragからsemantic membershipを推論しません。Editorは、意味上のparentを持たない要素のcenterがcontainer content上にある場合と、意味上のchild geometryがparent contentからはみ出す場合をdisplay/semantic containment不一致として警告します。前者は`set-membership` draftまたは領域外へのpresentation移動、後者は意味上の領域内へのpresentation移動またはprovenance由来のmembership削除draftを明示選択できます。警告検出とpresentation修正はTurtleを変更せず、semantic修正は必ず通常のPreviewと明示Applyを通します。

Previewは操作名、label付きresource chip、predicate矢印またはmembership、追加・削除triple件数、validation/warningを先に示します。完全IRI、exact triple、candidate Turtleは詳細表示へ残し、削除では対象labelと影響件数をraw Turtleより先に示します。ユーザーの明示適用までdraftとmarkerはeditor内部のephemeral stateであり、portable document、Scene正本、overlay、historyへ入りません。

`set-property`はsubjectとpredicateに対応する既存値をすべて置換し、値配列が空なら明示削除します。空文字列literalは削除ではなく有効な一値です。IRI/literalの複数値を保持し、Literalのlanguageとdatatypeは同時指定できません。Property参照の削除は、そのstatementだけを除去し、参照先blank nodeのclosureが孤立しても推測cascadeしません。`rdfs:member`と正規の正整数suffixを持つ`rdf:_n`等の構造predicateはproperty UIから変更せず、membership、sequence、alternative専用commandを使います。`set-alternatives`は上記の最終ordinal順とdefault slotの一致を必須にします。

Capabilityのparameterは`required: false`の場合だけoptionalです。Optional bindingを省略したcommandでは、そのbindingを参照するexact template statementをadd/remove双方からskipし、残りのstatementだけをatomic patchへ含めます。

Allowed resource namespaceはcreate-resourceだけでなく、全structured commandおよびdirect source editで新規導入されるinstance IRIの各出現位置へ適用します。Editorは既存resourceの候補選択と明示createを優先しますが、Coreは特定command専用のnamespace例外を持ちません。

Resource delete previewはresourceがsubject、object、predicateのいずれとして現れるstatementも影響集合へ含めます。既定操作は外部参照が一つでもあれば拒否し、explicit cascadeはpreviewに列挙されたstatement集合だけをconfirmation対象にします。削除後のSeqは1件以上、Altは2件以上を満たし、残るordinalは同じatomic patchで1から再採番します。Authoring contextが既知class/predicateとして定義する語彙resource自体は削除できません。

Canvasで指定した新規resource位置はauthoring draft内のephemeral markerです。明示した位置指定modeのblank canvas背景だけが位置をseedし、container自身の背景は位置に加えて上記のcatalog規定membershipをseedできます。子nodeやcontainer内の別要素のclickはcontainer背景clickとして扱いません。Editorの既知template sizeによる補正は入力補助にすぎず、実際に投影されたtemplate sizeとparent/Scene boundsへ収まるかはCore Previewで検証し、収まらなければ補正commitせずtransactionを拒否します。Preview/Apply前はportable document、Scene、historyを変更せず、semantic作成と位置patchが両方成功した場合だけ一つのrevisionとしてcommitします。

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
    :pick-asset="pickWorkspaceAsset"
    :authoring-context="resolvedAuthoringContext"
    :resource-iri-allocator="resourceIriAllocator"
    @save="saveToWorkspace"
  />
</template>
```

主なcontract:

- `modelValue` / `update:modelValue`: portable document正本
- `runtimeContext`: profile別catalog、layout registry、projection optionを持つ正規contract
- `catalog`: 単一catalog host向けのdeprecated互換prop
- `activeViewId` / `update:activeViewId`: optional controlled active view。省略時はuncontrolled
- `save`: packageは永続化せずhostへ保存要求を通知
- `validationChanged`: semantic/project diagnostics
- `assetAccess`: 非同期resolver、media/size/URL policy、host revision
- `pickAsset(request)`: workspace pickerを開き、選択時はassetRefだけを返すhost callback
- `authoringContext`: hostが解決した語彙・capability・policy・projection runtime
- `semanticValidationContext`: hostが解決したdomain validation identity/revision/port。省略時は`authoringContext.semanticValidation`を利用可能
- `resourceIriAllocator`: resource IRI省略時の同期または非同期allocator。返却IRIはCoreが再検証する
- `flushPendingEdits()`: Turtle textareaの未適用draftを検証し、保存前に正本へ反映する。未確認のstructured draftは自動適用せず保存を拒否する
- `panBy(x, y)` / `zoomTo(zoom)` / `fitToView()`: hostからsession viewportを操作
- `revealSelection()` / `focusElement(elementId)`: 現在の選択またはstable Scene element IDをviewportへ表示
- `selectElement(elementId)` / `selectElements(elementIds)` / `selectAll()` / `clearSelection()`: hostからsession selectionを操作
- `setSnapSettings(settings)`: grid、対象要素へのsnapをsession内で設定
- `selectionChanged(primaryElementId)`: 既存のprimary selection通知
- `selectionSetChanged(elementIds)`: ordered selection集合の通知
- `pendingDraftsChanged(pending)`: 未適用のTurtleまたはstructured authoring draftの有無。hostの保存可否・離脱確認に利用

公開`IriographDiagramCanvas`はedge編集時に
`routingUpdate({ elementId, routing?: { waypoints?, labelOffset? } })`を発行します。`routing`は
その操作後のeditable routing全体を表すsparse valueです。Waypoint操作では旧host向けの
`routingChange({ elementId, waypoints })`も併発しますが、標準Editorは`routingUpdate`だけを
購読して二重適用を避けます。

取込、書出、workspace tree、HTTP、revision conflict、認証・権限はhostの責務です。

Viewport navigationはportable documentを更新せず、`update:modelValue`、presentation history、dirty stateを発生させません。標準UIはblank canvasのprimary dragと任意箇所のmiddle drag、focusされたviewport自身のArrow/Page key、fit、選択への移動、minimapを提供します。Node、container、resize handle、waypoint上のprimary pointerは編集gestureを優先し、panを開始しません。Viewport以外にfocusがあるArrow keyは既存のelement編集へ渡すため、keyboard panとnode移動を同時実行しません。`readOnly`はsemantic/presentation editを禁止しますが、閲覧に必要なpan、zoom、fit、minimap、selection revealは無効化しません。

Multi-selectionはplain clickで置換、Ctrl/Cmd clickでtoggle、Shift clickで追加、blank clickまたはEscapeでclear、Ctrl/Cmd+Aで全選択します。選択中のnode/containerをdragすると全選択geometryを共通deltaでpreviewし、pointerup時に一つのbatch presentation transactionとして確定します。選択containerの子孫も同deltaで移動し、ancestorとdescendantを同時選択しても二重移動しません。異なるcontainerの要素を同時に動かす場合は、各要素の親container content boundsから許容deltaの共通部分を求め、membershipは変更しません。整列と等間隔も一commandを一transactionとし、Turtleを変更しません。

標準snapは8 canvas unitのgridと、対象要素のleft/center/right、top/middle/bottom guideを使います。対象候補は距離、座標、element IDの順で決定的に解決し、target snapをgridより優先してからcontainer/Scene境界へclampします。Target toleranceの標準値は画面上6pxでzoom変換し、Altを押したdragでは一時的にsnapを無効化します。Snap設定とguide候補はsession stateで、documentやhistoryには保存しません。`readOnly`でもselectionとsnap設定の参照・変更は可能ですが、drag、keyboard move、resize、routing、整列、等間隔、undo/redoはdocumentを変更しません。

Edgeはclick/focusで個別選択し、parallel edgeとself-loopも各routeのhit areaを持ちます。選択edgeの
generated bend handleを初めて編集するとderived route中間点をmanual waypointへseedします。
Path double clickとInspectorはwaypoint追加、handle dragとArrow keyは移動、Delete/Backspaceは削除を
行い、最後のmanual waypoint削除はautomaticへ戻します。Labelはroute全長の中央をbaseとし、drag、
Arrow key、Inspector数値入力でoffsetを編集し、Home/Delete/BackspaceまたはInspectorでresetします。
各pointer gestureと各keyboard/Inspector commandは一つのpresentation undo itemです。新規追加・移動座標は
Scene内側8 unitへclampします。旧documentから読み込んだ負座標は勝手に正規化せず、そのままでは
Scene原点外がclipされ得るため、handle編集またはautomatic resetで現行境界へ戻します。`readOnly`は
edge選択を許可しますが編集handleを表示せず、routing eventを受けてもdocumentを変更しません。
Edge本体のDelete/BackspaceはSceneやTurtleを即時削除せず、provenanceから復元できるexact semantic commandをサイドバーdraftへseedします。直接edgeは元statementだけを削除候補にし、sequence/alternative等で構造全体の入力が必要な場合は不足値をユーザーに要求します。Provenanceがない場合はpredicateや構造を見た目から推測しません。

Rich authoring contractでは、hostが解決済みauthoring profile、vocabulary index、
active viewのprojection capabilityを`authoringContext`として注入します。Editorはこのcontextから
class、属性predicate、edge predicate、包含・順序・選択操作を提示します。Resource IRIを
ユーザーに直接入力させないhostは、allowed namespace内で衝突しないIRIを返すallocatorも
注入できます。Authoring context未解決時はstructured semantic commandを無効化し、
source参照・presentation編集の許可まで失わせません。

`ResolvedAuthoringContext`はauthoring profile identity、vocabulary term index、projection capability、resource namespace、actor policyが解決済みであることを要求します。Predicate termは任意に`objectKinds`、許可datatype、許可language、`minCount`、`maxCount`を持てます。人間が未登録termを使う場合はpolicyに従ってwarningまたはerrorとし、warningはpreview上で完全IRIを確認してからだけ適用します。Resource IRIを自動生成するhostは同期または非同期allocatorを注入します。Mockはstatic fixtureのcontextとallocatorを利用します。`authoringProfileRef`やvocabulary URIからcontextを取得するresolver、cache、integrity検証はP2-01の責務であり、P1 editorへ取得処理を入れません。

Host asset pickerは選択したabsolute asset IRIだけを返し、Editorは`appearance.iconRef`のpresentation transactionとして保存します。URLやbytesをpicker resultへ含めません。Cancel、stale response、不正IRIではdocumentを変更しません。

ファイル移動後も維持できるopaque IRIを優先します。同じIRIを維持できる移動はhost mappingの更新だけで透過的に解決し、path由来IRI等で維持できない場合は`moved`とreplacement IRIをdiagnosticにします。Editorは自動置換せず、削除・not-foundと同様にユーザーの再選択を待ちます。同期`ProjectionOptions.resolveAssetUrl`はlegacy `DiagramCatalog`投影だけに残すdeprecated APIであり、正規化projectionとVue editorは使用しません。

## LLM adapter

LLMへは`document.semantic.source`、authoring profileから抽出した語彙ガイド、関連projection capability summaryを渡します。返却Turtleは`actor: "llm"`のsemantic transactionへ入力します。portable document全体やoverlayをLLMの自由編集対象にしません。

位置、size、routing、色、icon overrideはpresentation requestとして処理します。Lane、順序、選択、domain typeなど意味を伴う表示要求だけをprofile-guided semantic rewriteの候補にします。詳細は[authoring-profile.md](./authoring-profile.md)を参照します。
