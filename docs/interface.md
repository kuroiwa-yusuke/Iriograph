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

`semantic.authoringProfileRef`はtarget contractで、semantic transactionに適用する語彙・IRI生成policyを参照します。Viewの投影方式を選ぶ`views[].profileRef`とは別の責務です。現行TypeScript modelへの追加はP0-01で行います。

`views[].locale`はtarget contractの任意BCP 47 language tagで、label選択を決定的にします。省略時はlanguage tagのない`rdfs:label`を優先し、実行環境のlocaleで結果を変えません。現行TypeScript modelへの追加はP0-01で行います。

`viewId`はdocument内で一意なnamed viewのidentityです。Active viewの選択はeditor session stateとし、portable documentへactive flagを保存しません。v1のviewは`profileRef`によって表示する構造文法を選び、SPARQL queryまたは汎用filter式を保存しません。要素の一時hideもsession stateであり、overlayへ書き込みません。

overlayには次を保持できます。

- `geometry`: x、y、width、height
- `pinned`と`placement`: 自動配置かユーザー固定か
- `appearance`: template、icon、style tokenの明示override
- `routing`: edge waypointとlabel offset

`appearance.iconRef`はassetの安定したIRIだけを保持します。workspace path、取得URL、
認証情報、画像bytesはportable documentへ保存しません。Catalogの`iconRef`は意味から
導出する既定値、overlayの`iconRef`はユーザーが個別に選択したoverrideです。

## Catalog

v1 target catalogは次の宣言を持ちます。

- `rules`: type、predicate、fallback patternから汎用projection operatorへの写像
- `templates`: primitive kind、shape、既定size、style、icon参照
- `assets`: asset IRIから取得定義への写像

標準catalogはRDF/RDFS IRIを`membership-container`、`ordinal-sequence`、`alternative`、`direct-edge`、`suppress`へbindします。未登録の直接IRI-object tripleはfallback edgeになります。rule schema、競合解決、標準bindingは[rdf-rdfs-profile.md](./rdf-rdfs-profile.md)を正本とします。

現行TypeScriptの`nodeRules`、`relationRules`、`containmentRules`はprototype contractであり、上記`rules`へ移行するまでstable APIとはしません。

## Scene

Targetの`projectIriographDocument(document, projectionContext, viewId)`は保存documentを変更せず、意味graphからgeometry未確定の`ProjectedScene`を同期的に返します。`layoutProjectedScene(projectedScene, view, adapter)`はlayoutだけを非同期に適用し、renderer向け`Promise<DiagramScene>`を返します。両者を順に呼ぶ`buildIriographScene(...)` convenience APIは提供できますが、projectionとlayoutの公開責務は統合しません。Sceneはいずれもderived dataであり保存正本ではありません。現行の同期`projectIriographDocument(document, catalog)`がgeometryまで返す挙動は移行前contractです。

現在のprimitiveは`node`、`edge`、`container`です。`annotation`は型上予約されていますが未投影です。

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

Coreはnode-link、LR/TB階層、Bag container、pinned geometryを扱う決定的な標準軽量adapterを提供し、Vue editorはこれをdefaultとして利用します。Hostがlayout adapterを明示注入した場合は同じinterfaceでworkerを使う高機能adapter等へ差し替えます。Adapter未解決、失敗、結果不正はdiagnosticとし、異なるlayoutへ黙ってfallbackしません。

Re-layoutの通常対象は`placement: "generated"`だけです。`placement: "user"`のgeometryは固定制約としてadapterへ渡します。明示的な「自動配置へ戻す」presentation commandによってplacementをgeneratedへ戻した場合に限り、次のlayoutで再配置できます。

## Semantic transaction

Targetの`applySemanticSource(document, source, context)`は、Turtleをparseしてから意味変更を適用し、全viewの非同期layoutを含む`Promise<SemanticSourceUpdate>`を返します。`context`はresolved catalog群、view profile群、layout adapter群、authoring profile、actor、元revisionを含みます。

- 失敗: `accepted: false`とdiagnosticsを返し、元documentを維持
- 成功: `accepted: true`とreconcile済みdocumentを返す

`actor`は少なくとも`human`または`llm`です。LLM transactionではauthoring profile未解決、unknown term追加、term minting、許可外resource namespaceをerrorとして扱います。現行の`applySemanticSource(document, source, catalog)`は移行前contractです。

`applySemanticCommands(document, commands, context)`は一つ以上の人間のstructured commandを一つのatomic graph patchとcandidate sourceへ変換し、同じく`Promise<SemanticSourceUpdate>`を返します。以降は`applySemanticSource`と同じparse、authoring profile、構造、domain validation、投影、非同期layout、reconciliationのパイプラインを使います。Human UIとLLMに別々の検証経路を作りません。

Turtle textareaから`applySemanticSource`を実行した場合、妥当な入力sourceは原文のまま保持します。`applySemanticCommands`とactor=`llm`のsource editはcandidate datasetを共通のversioned serializerで決定的なTurtleへ再serializeしてから確定します。再serializeでは有効なprefix/baseを可能な範囲で再利用しますが、comment、空白、改行位置、triple記述順の保持はcontractに含めません。

semantic transaction成功時は、更新したTurtleとreconcile済みview overlayを一つのdocument revisionとして返します。各viewは個別の`profileRef`、`layoutRef`、locale、解決済みcatalogで再投影します。Reconcileは次を行います。

- 存続element identityのuser overlayを、変更後primitiveと互換な範囲で維持する
- 新規elementをlayoutし、保存が必要な初期geometryに`placement: "generated"`を付ける
- userが位置を明示した後は`placement: "user"`の別presentation transactionにする
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
| `set-membership` | containerとmemberの所属を追加・削除 | RDF/RDFS profileでは`rdf:type rdf:Bag`と`rdfs:member`を用い、parent一意性とcycleを検証 |
| `set-sequence` | 順序付きmemberを再構成 | `rdf:Seq`と`rdf:_n`を一括更新し、連番制約を途中状態に適用しない |
| `set-alternatives` | 選択肢と既定選択を再構成 | `rdf:Alt`と`rdf:_n`を一括更新し、2件以上の制約を検証 |
| `delete-resource` | resourceをsubjectとする記述statementとresourceを削除 | 他subjectからresourceへの参照がある場合は既定で拒否。影響statementのpreview付き明示cascadeだけを許可し、Seq/Alt member削除は同じpatchで再採番 |

node作成dialogはIRIと初期type、label、property、既存resourceとの関係の少なくとも1つが確定するまで保存しません。Edge gestureはsource/targetに加えpredicateまたはsemantic capabilityの選択を必須にします。Container内へのplain dragはgeometryのpresentation transactionのみで、所属は「containerに含める」という明示操作で`set-membership`を発行します。

Node、edge、属性、包含、削除のauthoring UIはサイドバーにcommand draftを持ちます。Canvas gestureはsource/target、作成位置、候補container等をdraftへseedできますが、即時commitしません。サイドバーは生成予定の追加・削除triple、構造graph patch、IRI、validationとwarningをpreviewし、ユーザーの明示適用でtransactionを開始します。適用前のghost elementはeditor内部のephemeral stateであり、portable document、Scene正本、overlay、historyへ入りません。

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
    :catalog="catalog"
    :dirty="dirty"
    :saving="saving"
    :resolve-asset-url="resolveAssetUrl"
    @save="saveToWorkspace"
  />
</template>
```

主なcontract:

- `modelValue` / `update:modelValue`: portable document正本
- `catalog`: hostが解決済みのprojection catalog
- `save`: packageは永続化せずhostへ保存要求を通知
- `validationChanged`: semantic/project diagnostics
- `resolveAssetUrl(assetRef, definition)`: IRIから表示URLへのhost注入境界
- `flushPendingEdits()`: Turtle textareaの未適用draftを検証し、保存前に正本へ反映

取込、書出、workspace tree、HTTP、revision conflict、認証・権限はhostの責務です。

Target rich authoring contractでは、hostが解決済みauthoring profile、vocabulary index、
active viewのprojection capabilityを`authoringContext`として注入します。Editorはこのcontextから
class、属性predicate、edge predicate、包含・順序・選択操作を提示します。Resource IRIを
ユーザーに直接入力させないhostは、allowed namespace内で衝突しないIRIを返すallocatorも
注入できます。Authoring context未解決時はstructured semantic commandを無効化し、
source参照・presentation編集の許可まで失わせません。

P1のcontractではこれを`ResolvedAuthoringContext`として先に型定義し、authoring profile、vocabulary index、capability、resource policyが解決済みであることを要求します。Resource IRIを自動生成する場合は、host注入の同期または非同期allocatorが完全IRIを返し、Coreがnamespaceと衝突を再検証します。Mockはstatic fixtureのcontextとallocatorを利用します。`authoringProfileRef`やvocabulary URIからcontextを取得するresolver、cache、integrity検証はP2-01の責務であり、P1 editorへ取得処理を入れません。

Target asset contractでは、hostがworkspace tree由来のasset pickerと非同期resolverを
editorへ注入します。pickerは`assetRef`と表示用metadataを返し、resolverは`assetRef`から
一時URLを取得します。ファイル移動後も維持できるopaque IDを優先し、pathしか持たない
hostは移動時の参照更新を担います。未解決・権限拒否・unsupported mediaは図全体を
失敗させずfallback表示とdiagnosticにします。現行の同期`resolveAssetUrl`は、この境界を
確認するprototypeです。

## LLM adapter

LLMへは`document.semantic.source`、authoring profileから抽出した語彙ガイド、関連projection capability summaryを渡します。返却Turtleは`actor: "llm"`のsemantic transactionへ入力します。portable document全体やoverlayをLLMの自由編集対象にしません。

位置、size、routing、色、icon overrideはpresentation requestとして処理します。Lane、順序、選択、domain typeなど意味を伴う表示要求だけをprofile-guided semantic rewriteの候補にします。詳細は[authoring-profile.md](./authoring-profile.md)を参照します。
