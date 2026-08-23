# 実装構成

## Package責務

| Package | 責務 | 持たない責務 |
|---|---|---|
| `@iriograph/core` | model、Turtle parse/serialize、semantic commandのgraph patch変換、catalog投影、検証、reconciliation、非同期layout adapter契約と標準軽量layout | Vue、DOM、HTTP、workspace、高機能layout engine固有依存 |
| `@iriograph/vue-editor` | Scene描画、human semantic command UI、overlay編集、Turtle draft、history、inspector | 語彙判定、永続化、認証、catalog取得 |
| `@iriograph/mock` | repository内sample workspace、localStorage working copy、取込・書出、asset resolver例 | 投影規則、editor内部state |

## 投影処理

1. `semantic.source`をN3でparseする
2. RDF/RDFSベースプロファイルの構造制約を検証する
3. 明示された`rdfs:subClassOf`と`rdfs:subPropertyOf`からrule matching用の限定的なclosureを作る
4. catalog ruleをpriorityとspecificityで一意に解決する
5. `membership-container`、`ordinal-sequence`、`alternative`等の汎用operatorでgeometry未確定のScene構造とedit provenanceを導出する
6. 消費されていないIRI-object tripleをfallback edgeへ投影する
7. view overlayをsemanticRefで照合し、user geometry、appearance、manual routingを制約として構成する
8. `layoutRef`に対応する非同期layout adapterを呼び、generated elementのgeometryとroutingを決定する
9. asset resolverでicon IRIを表示URLへ解決する

Sceneは毎回導出します。`projectIriographDocument`はStep 1〜7のprojectionだけを行ってgeometry未確定の`ProjectedScene`を返し、`layoutProjectedScene`がStep 8を非同期に行います。Vue editor向けには両者を順に呼ぶconvenience orchestrationを提供できますが、rendererはTurtle storeやlayout engineを直接問い合わせず、完成した`DiagramScene`だけを描画します。Coreには決定的な標準軽量layoutを同梱し、Vue editorはこれをdefaultにします。Hostは明示注入した同じadapter契約で高機能layoutを差し替えます。通常の再layoutはgenerated elementだけを移動し、user geometryはfixed constraintにします。

## 編集transaction

drag、resize、waypoint変更、template/icon overrideはpresentation transactionです。選択elementのoverlay entryだけを更新し、Turtleを変更しません。一つのpointer gestureを一つのundo履歴として扱います。

Turtle textareaは未適用draftを持ちます。「検証して適用」または保存前の`flushPendingEdits()`でsemantic transactionを開始します。parse error時はdraftを残してdocument正本を変更しません。

Target semantic transactionはactorを`human`または`llm`として受け取り、元graphとの差分にauthoring profileを適用します。Rendererのfallback投影はunknown termを許容しますが、LLM transactionはprofile外term、新規semantic term、許可外namespaceを拒否します。

Rich editorのnode、属性、edge、包含、順序、選択編集は次のパイプラインで実行します。

1. Editorが入力中のformやedge previewをephemeral UI stateとして持つ。Sceneやdocument overlayに仮node/edgeを保存しない
2. Canvas gestureまたはサイドバー操作からcommand draftを作る。Canvasはsource/target、候補container、作成位置等をseedするだけでsemantic transactionを開始しない
3. 解決済みauthoring contextとprojection capabilityから選択できるclass、predicate、構造操作を提示し、追加・削除予定triple/graph patchとvalidationをサイドバーでpreviewする
4. ユーザーの明示適用後、Coreが一つのUI操作に含まれるstructured command群をRDF datasetのatomic graph patchへ変換する。`create-resource`はnamed IRIと少なくとも1triple、`connect-resources`はpredicateを必須にする
5. Graph patchからcandidate datasetを構成し、Turtle直接編集やLLM返却Turtleと同じcandidate graph入力に合流する
6. Parse、authoring profileの差分検証、RDF/RDFS構造検証、domain validationを行う
7. 影響する全viewを個別のprofile、catalog、layoutで投影し、blockingな構造・projection errorがないことを確認する。Asset未解決等のfallback可能な表示diagnosticはsemantic transactionをrollbackしない
8. 旧Sceneと新Sceneをstable identityで照合し、存続user overlay、新規elementのgenerated geometry、消滅・非互換overlayをviewごとにreconcileする
9. Structured commandまたはLLM editではcandidate datasetをversioned serializerで決定的なTurtleへ再生成し、Turtle直接編集では妥当な入力原文を保持する
10. Candidate Turtleとreconcile済みoverlayを一つのdocument revisionとして確定し、semantic diffとpresentation diffを別々に返す

Step 8で新規geometryを保存する場合は`placement: "generated"`とし、userがdrag、resize、作成位置指定をした後の`placement: "user"`と区別します。Template、style、iconなどcatalog由来のappearanceはSceneへ導出し、overlayには複製しません。

再serializeはprefixとbase IRIを有効な範囲で再利用しますが、comment、空白、property list、source上のtriple順は保持保証しません。同じdataset、保持したprefix/base context、serializer versionから同じsourceを得られることを優先します。

「resourceを作成して指定位置へ置く」のようにsemantic commandとpresentation patchを含む一つのUI操作は、先にsemantic resultとreconcile済みdocumentを候補として作り、その結果へpresentation patchを検証適用してから一つのdocument revisionとundo itemとしてcommitします。どちらかが失敗した場合はTurtle、overlayとも元documentを維持します。

Canvasからのedge削除やcontainerからの取り出しは、Scene elementを直接消去する処理ではありません。Projection operatorは元statement identityとsemantic edit capabilityをScene provenanceとして返し、Editorはそれを直接triple削除、`rdfs:member`削除、Seq/Altのatomic再構成などのcommandへ戻します。これによりderived edgeの表示編集がTurtleの孤立した不整合な削除になることを防ぎます。

Resource自体の削除では、そのresourceをsubjectとするtype、label、property等を削除対象に含めます。別のsubjectからresourceをobjectとして参照するstatementまたはstructure membershipが残る場合は既定で拒否します。明示cascadeではそれらの影響statementをサイドバーでpreviewし、承認された集合だけを一つのgraph patchで削除します。Seq/Alt memberを除く場合は残る`rdf:_n`も同じpatchで連番へ再構成し、最終candidateが構造制約を満たさなければ全体をrollbackします。

P1のrich authoringは、hostから解決済みの`ResolvedAuthoringContext`とresource IRI allocatorを受け取ります。Mockではstatic context fixtureを使います。Profile/vocabulary URIの取得、version・cache・integrity解決はP2-01まで実装せず、editor/coreからresolverへ逆依存させません。

## Named viewとsession表示状態

P1では同じTurtleに複数のnamed viewを持ち、ユーザーがviewを選択、追加、複製、削除できます。各viewはprofile、layout、locale、overlayを独立して持ち、profileが表示するsemantic構造を選択します。SPARQLや汎用filter editorは実装しません。一時hideはVue editorのsession stateにだけ保持し、保存documentやsemantic transactionへ含めません。

## 性能基準

P1の暫定基準は、500 node / 1,000 edgeを通常規模、2,000 node / 4,000 edgeをstress規模とします。通常規模ではlayout以外の編集操作応答を100ms未満、pan/dragを30fps以上、stress規模では初回projectionと標準軽量layoutを合計2秒未満とするbenchmarkをCIで監視します。測定環境、fixture seed、warm-up回数を固定し、絶対時間と前回比の両方を記録します。

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
