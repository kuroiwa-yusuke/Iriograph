# 実装構成

## Package責務

| Package | 責務 | 持たない責務 |
|---|---|---|
| `@iriograph/core` | model、Turtle parse、semantic commandのgraph patch変換、catalog投影、検証、reconciliation | Vue、DOM、HTTP、workspace |
| `@iriograph/vue-editor` | Scene描画、human semantic command UI、overlay編集、Turtle draft、history、inspector | 語彙判定、永続化、認証、catalog取得 |
| `@iriograph/mock` | repository内sample workspace、localStorage working copy、取込・書出、asset resolver例 | 投影規則、editor内部state |

## 投影処理

1. `semantic.source`をN3でparseする
2. RDF/RDFSベースプロファイルの構造制約を検証する
3. 明示された`rdfs:subClassOf`と`rdfs:subPropertyOf`からrule matching用の限定的なclosureを作る
4. catalog ruleをpriorityとspecificityで一意に解決する
5. `membership-container`、`ordinal-sequence`、`alternative`等の汎用operatorでScene構造を導出する
6. 消費されていないIRI-object tripleをfallback edgeへ投影する
7. view overlayをsemanticRefで照合し、geometry、appearance、routingを適用する
8. asset resolverでicon IRIを表示URLへ解決する

Sceneは毎回導出します。Vue componentはTurtle storeを直接問い合わせず、Scene contractだけを描画します。

## 編集transaction

drag、resize、waypoint変更、template/icon overrideはpresentation transactionです。選択elementのoverlay entryだけを更新し、Turtleを変更しません。一つのpointer gestureを一つのundo履歴として扱います。

Turtle textareaは未適用draftを持ちます。「検証して適用」または保存前の`flushPendingEdits()`でsemantic transactionを開始します。parse error時はdraftを残してdocument正本を変更しません。

Target semantic transactionはactorを`human`または`llm`として受け取り、元graphとの差分にauthoring profileを適用します。Rendererのfallback投影はunknown termを許容しますが、LLM transactionはprofile外term、新規semantic term、許可外namespaceを拒否します。

Rich editorのnode、属性、edge、包含、順序、選択編集は次のパイプラインで実行します。

1. Editorが入力中のformやedge previewをephemeral UI stateとして持つ。Sceneやdocument overlayに仮node/edgeを保存しない
2. Authoring profileとprojection capabilityから選択できるclass、predicate、構造操作を提示する
3. Coreが一つのUI操作に含まれるstructured command群をRDF datasetのatomic graph patchへ変換する。`create-resource`はnamed IRIと少なくとも1triple、`connect-resources`はpredicateを必須にする
4. Graph patchからcandidate Turtleを構成し、Turtle直接編集やLLM返却Turtleと同じcandidate graph入力に合流する
5. Parse、authoring profileの差分検証、RDF/RDFS構造検証、domain validationを行う
6. 影響する全viewを個別のprofile、catalog、layoutで投影し、blockingな構造・projection errorがないことを確認する。Asset未解決等のfallback可能な表示diagnosticはsemantic transactionをrollbackしない
7. 旧Sceneと新Sceneをstable identityで照合し、存続user overlay、新規elementのgenerated geometry、消滅・非互換overlayをviewごとにreconcileする
8. Candidate Turtleとreconcile済みoverlayを一つのdocument revisionとして確定し、semantic diffとpresentation diffを別々に返す

Step 7で新規geometryを保存する場合は`placement: "generated"`とし、userがdrag、resize、作成位置指定をした後の`placement: "user"`と区別します。Template、style、iconなどcatalog由来のappearanceはSceneへ導出し、overlayには複製しません。

「resourceを作成して指定位置へ置く」のようにsemantic commandとpresentation patchを含む一つのUI操作は、先にsemantic resultとreconcile済みdocumentを候補として作り、その結果へpresentation patchを検証適用してから一つのdocument revisionとundo itemとしてcommitします。どちらかが失敗した場合はTurtle、overlayとも元documentを維持します。

Canvasからのedge削除やcontainerからの取り出しは、Scene elementを直接消去する処理ではありません。Projection operatorは元statement identityとsemantic edit capabilityをScene provenanceとして返し、Editorはそれを直接triple削除、`rdfs:member`削除、Seq/Altのatomic再構成などのcommandへ戻します。これによりderived edgeの表示編集がTurtleの孤立した不整合な削除になることを防ぎます。

表示要求をLLMへ接続するhostは、まずpresentationだけで達成できるか判定します。意味構造が必要な場合だけ、view profile/catalogからprojection capability summaryを導出し、許可語彙とともにLLM adapterへ渡します。分類、検証、失敗時rollbackは[authoring-profile.md](./authoring-profile.md)に従います。

## 現在のlocal mock

購入承認フローを例に、lane containment、開始・終了event、user/service task、gateway、relation resourceによるsequence flow、未登録predicateのfallback edgeを一画面に表示します。

editorはdrag、resize、edge waypoint、座標入力、template/icon override、undo/redo、zoom、Turtle編集、document/catalog参照を提供します。現行mockは既存Sceneの表示編集が中心で、human semantic commandによるnode/属性/edge/包含作成は未実装です。mock hostはrepository内の`public/workspace`をmanifestからtree表示し、実体の`.iriograph`を読み込みます。保存はsource fileを直接変更せずpath別のlocalStorage working copyへ行い、取込・書出もhostで提供します。

同じworkspaceの画像はmanifest上でasset IRIとURLを対応付けます。sample documentの
catalog外icon overrideはこのresolverを通るため、Turtle・catalog・editor packageへ
workspace pathや画像bytesを混ぜずに参照表示する最小の縦切りになっています。非同期取得、
picker、移動追従、安全policyを含む正式contractはP0-09で実装します。

現在のfallback layoutは決定的な単純配置です。graph topologyとcontainer制約を使う正式layout engineはバックログで管理します。

現在のmockは`urn:iriograph:demo:`内の`Lane`、`SequenceFlow`、`from`、`to`等を使う初期prototypeです。これは[rdf-rdfs-profile.md](./rdf-rdfs-profile.md)に適合しておらず、標準catalogと汎用operatorの縦切りを実装した時点でRDF/RDFS表現へ移行します。仕様固定と実装済み範囲を混同しないため、移行完了まではこの差を明示します。
