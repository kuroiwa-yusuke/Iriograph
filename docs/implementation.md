# 実装構成

## Package責務

| Package | 責務 | 持たない責務 |
|---|---|---|
| `@iriograph/core` | model、Turtle parse、catalog投影、検証、reconciliation | Vue、DOM、HTTP、workspace |
| `@iriograph/vue-editor` | Scene描画、overlay編集、Turtle draft、history、inspector | 永続化、認証、catalog取得 |
| `@iriograph/mock` | local host、localStorage保存、取込・書出、asset resolver例 | 投影規則、editor内部state |

## 投影処理

1. `semantic.source`をN3でparseする
2. `rdf:type`からrelation resourceを識別する
3. node ruleを照合し、resourceをnodeまたはcontainerへ投影する
4. containment ruleからparent-childを解決する
5. relation ruleからsource/target edgeを生成する
6. 消費されていないIRI-object tripleをfallback edgeへ投影する
7. view overlayをsemanticRefで照合し、geometry、appearance、routingを適用する
8. asset resolverでicon IRIを表示URLへ解決する

Sceneは毎回導出します。Vue componentはTurtle storeを直接問い合わせず、Scene contractだけを描画します。

## 編集transaction

drag、resize、waypoint変更、template/icon overrideはpresentation transactionです。選択elementのoverlay entryだけを更新し、Turtleを変更しません。一つのpointer gestureを一つのundo履歴として扱います。

Turtle textareaは未適用draftを持ちます。「検証して適用」または保存前の`flushPendingEdits()`でsemantic transactionを開始します。parse error時はdraftを残してdocument正本を変更しません。

## 現在のlocal mock

購入承認フローを例に、lane containment、開始・終了event、user/service task、gateway、relation resourceによるsequence flow、未登録predicateのfallback edgeを一画面に表示します。

editorはdrag、resize、edge waypoint、座標入力、template/icon override、undo/redo、zoom、Turtle編集、document/catalog参照を提供します。mock hostはCtrl/Cmd+S、localStorage、`.iriograph`取込・書出を提供します。

現在のfallback layoutは決定的な単純配置です。graph topologyとcontainer制約を使う正式layout engineはバックログで管理します。
