# 実装構成

## Package責務

| Package | 責務 | 持たない責務 |
|---|---|---|
| `@iriograph/core` | model、Turtle parseと決定的serialize、catalog投影、検証、reconciliation、非同期layout adapter契約と標準軽量layout、asset lease/policy検証。semantic commandのgraph patch変換はP1-04で追加する | Vue、DOM、HTTP、workspace、高機能layout engine固有依存 |
| `@iriograph/vue-editor` | Scene描画、overlay編集、Turtle draft、history、inspector。human semantic command UIはP1-04で追加する | 語彙判定、永続化、認証、catalog取得 |
| `@iriograph/mock` | repository内sample workspace、localStorage working copy、取込・書出、asset resolver例 | 投影規則、editor内部state |

## 投影処理

1. `semantic.source`をN3でparseする
2. RDF/RDFSベースプロファイルの構造制約を検証する
3. 明示された`rdfs:subClassOf`と`rdfs:subPropertyOf`からrule matching用の限定的なclosureを作る
4. catalog ruleをpriorityとspecificityで一意に解決する
5. `membership-container`、`ordinal-sequence`、`alternative`等の汎用operatorでgeometry未確定のScene構造とedit provenanceを導出する
6. 消費されていないIRI-object tripleをfallback edgeへ投影する
7. view overlayをsemanticRefで照合し、user geometry、appearance、manual routingを制約として構成する
8. `layoutRef`に対応する非同期layout adapterを呼び、generated elementのgeometryとendpoint込みrouteを決定する
9. asset resolverでicon IRIを表示URLへ解決する

Sceneは毎回導出します。`projectSemanticView`はStep 1〜7だけを行ってgeometry未確定の`ProjectedScene`を同期的に返します。`buildIriographView`はviewのprofileに対応する解決済みcatalogを選択し、Step 8を非同期に実行して`DiagramScene`を返します。Step 9は`resolveDiagramSceneAssets`による別の非同期enrichmentであり、projection、layout、semantic reconciliationへasset取得を混ぜません。RendererはTurtle store、layout engine、asset resolverを直接問い合わせず、完成SceneのURLだけを使います。Coreには決定的な標準軽量layoutを同梱し、Vue editorはこれをdefaultにします。Hostは明示注入した同じadapter契約で高機能layoutへ差し替えます。通常の再layoutはgenerated elementだけを移動し、user geometryとpinned geometryはfixed constraintにします。

## Catalog解決

Portable documentの`imports`はhost境界の`ProjectionCatalogResolver`でraw bytesへ解決します。Coreの`resolveProjectionCatalogImports`はversion付き`catalogRef`、任意のSHA-256 integrity、取得結果のcatalog identity、runtime schemaを検証してから、同じprofileのcatalogを`catalogRef`順に結合します。Rule IDはorigin catalogとlocal IDから修飾し、template、asset、rule IDの衝突やprofile内のdefaults欠落・複数定義をlast-winsにせずerrorにします。解決済みcatalogとrule originは`ProjectionRuntimeContext`へ渡し、projection provenanceでは元のcatalogRefとlocal rule IDを復元します。

Local mockはnetwork resolverを持たないstatic fixtureなので、RDF/RDFS標準catalogとdefaultsを持たないdomain extension catalogを同じ競合規則で決定的に結合してeditorへ注入します。URIからの取得、cache、認証をmock固有のprojection処理へ混ぜません。

## Asset解決

Normalized projectionはcatalogまたはoverlayから`iconRef`だけをSceneへ導出し、catalog URLを直接使いません。Coreのasset enrichmentは同一Scene内のassetRefをdedupeし、host resolverが返したleaseのabsolute URL、実media type、catalog宣言との一致、byte上限、schemeとoriginを検証します。失敗はwarningとiconなしfallbackにし、all-view semantic reconciliationのaccept/rejectへ影響させません。

Vue editorはScene requestごとにAbortSignalとgenerationを発行します。新しいrequest開始時に古い取得をabortし、staleになってから返ったleaseは即時releaseします。新Scene採用時に旧Scene batch、component unmount時にcurrent batchをreleaseします。Host resolverはassetRefからworkspace mappingを引き、認証fetch、cache、Blob URL生成とref count、revision変更時のinvalidatonを所有します。

Pickerもhost注入の非同期callbackです。Editorはcancel・stale・不正IRIをdocumentへ入れず、妥当なassetRefだけを一つのpresentation transactionとしてoverlayへ保存します。Pickerとresolverのどちらもworkspace path、URL、bytesをportable documentへ書きません。

## 編集transaction

drag、resize、waypoint変更、template/icon overrideはpresentation transactionです。選択elementのoverlay entryだけを更新し、Turtleを変更しません。一つのpointer gestureを一つのundo履歴として扱います。

Edge routingはCore Sceneのderived `route`とportable overlayのmanual `waypoints`を分けます。
Layout adapterの全routeはsource/target attachment込み2点以上で、Canvasはこれを直接描画します。
Waypointの初回編集ではderived routeの中間点をseedし、追加位置はpolylineのnearest segmentへ射影します。
Label baseはpolyline arc-length 50%で、overlayには相対`labelOffset`だけを保存します。CanvasからEditorへは
waypointとlabel offsetをまとめたsparse `routingUpdate`を渡し、Editorはnested routing extensionを保持しつつ
空waypointとzero offsetを省略します。Edge overlayへgeometry、pinned、placementを混入させません。
Public Canvasのlegacy `routingChange`はwaypoint操作時だけ併発し、Editorは購読しません。

標準軽量layoutはunordered endpoint pairごとにedgeを束ね、code-point順element IDから20 unit laneを
決定します。Attachmentはnode辺内へclampし、外側stub/middle laneはclampせず多数edgeでも一意性を
保ちます。Self-loopは右側36 unit、同一nodeの兄弟ごとに18 unit広げます。Routeの右・下方向の張り出しは
Scene boundsへ加えます。新規manual waypointはCanvasの8 unit insetへclampし、既存負座標は読み込み時に
破壊的変換せず、clipされる場合はユーザー編集またはautomatic resetを要求します。

SelectionはVue editor内のordered element ID集合とprimary element IDで表し、portable document、overlay、historyへ保存しません。Canvasはgroup drag中のgeometryをephemeral previewとして描画し、pointerupで`geometryBatchChange`を一度だけ発行します。Editorはbatch内の全geometry overlayを一つのdocument cloneへ適用し、同じgesture snapshotを一つのhistory itemへ積みます。選択containerは子孫を同deltaで移動し、generated childを含む確定participantをuser geometryとして保存するため、Scene再投影後にpreviewから戻りません。Pointer cancelではpreviewを破棄しdocumentを変更しません。

Group translationは選択ancestorをrootとして正規化し、各root subtreeの許容delta intervalを交差します。親が選択されていないnode/nested containerは親containerのheaderを除くcontent bounds、top-level elementはScene insetを境界とします。異なるcontainerを跨ぐ操作でも共通deltaだけを適用し、`parentElementId`やsemantic membershipを変更しません。整列は6方向、等間隔は水平・垂直のbounding-box間gapを対象とし、各toolbar commandを一つのbatch transactionにします。

Snap policyはDOM非依存のgeometry operationとして実装し、標準grid 8 unit、target tolerance 6 screen pxを使います。Target候補はedge/centerの距離、座標、code-point順element identityで決定し、target、grid、bounds clampの順に適用します。設定はEditor sessionだけに置き、単体dragとgroup dragで同じpolicyを使います。

Turtle textareaは未適用draftを持ちます。「検証して適用」または保存前の非同期`flushPendingEdits()`でsemantic transactionを開始します。現行実装はparseとRDF/RDFS構造検証後、全viewをそれぞれのprofile/catalog/layoutで再構成し、一つでもblocking errorがあれば元documentへrollbackします。Parse error時はdraftを残してdocument正本を変更しません。

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

再serializeはprefixとbase IRIを有効な範囲で再利用しますが、comment、空白、property list、source上のtriple順は保持保証しません。同じparse済みdataset（blank node IDを含む）、保持したprefix/base context、serializer versionから、quadの入力順に依存せず同じsourceを得ます。v1はRDF Dataset Canonicalizationを実装せず、構造的に区別できないblank node間では入力IDをtie-breakに使います。

「resourceを作成して指定位置へ置く」のようにsemantic commandとpresentation patchを含む一つのUI操作は、先にsemantic resultとreconcile済みdocumentを候補として作り、その結果へpresentation patchを検証適用してから一つのdocument revisionとundo itemとしてcommitします。どちらかが失敗した場合はTurtle、overlayとも元documentを維持します。

Canvasからのedge削除やcontainerからの取り出しは、Scene elementを直接消去する処理ではありません。Projection operatorは元statement identityとsemantic edit capabilityをScene provenanceとして返し、Editorはそれを直接triple削除、`rdfs:member`削除、Seq/Altのatomic再構成などのcommandへ戻します。これによりderived edgeの表示編集がTurtleの孤立した不整合な削除になることを防ぎます。

Resource自体の削除では、そのresourceをsubjectとするtype、label、property等を削除対象に含めます。別のsubjectからresourceをobjectとして参照するstatementまたはstructure membershipが残る場合は既定で拒否します。明示cascadeではそれらの影響statementをサイドバーでpreviewし、承認された集合だけを一つのgraph patchで削除します。Seq/Alt memberを除く場合は残る`rdf:_n`も同じpatchで連番へ再構成し、最終candidateが構造制約を満たさなければ全体をrollbackします。

P1のrich authoringは、hostから解決済みの`ResolvedAuthoringContext`とresource IRI allocatorを受け取ります。Mockではstatic context fixtureを使います。Profile/vocabulary URIの取得、version・cache・integrity解決はP2-01まで実装せず、editor/coreからresolverへ逆依存させません。

## Named viewとsession表示状態

P1では同じTurtleに複数のnamed viewを持ち、ユーザーがviewを選択、追加、複製、削除できます。各viewはprofile、layout、locale、overlayを独立して持ち、profileが表示するsemantic構造を選択します。SPARQLや汎用filter editorは実装しません。一時hideはVue editorのsession stateにだけ保持し、保存documentやsemantic transactionへ含めません。

ViewportもVue editorのsession stateです。`DiagramCanvas`がscroll metrics、mouse/keyboard pan、fit計算、minimapとelement boundsへのrevealを所有し、`IriographEditor`はtoolbarとhost向けnavigation methodを接続します。Navigationはdocument clone、overlay、undo historyを経由せず、Scene再投影後もそのsession内のviewportを維持します。Primary pointerはblank canvasだけをpanに使い、Scene elementと編集handleは既存gestureへ渡します。Middle pointerはread-onlyを含めてpan専用です。Keyboard panはfocusされたscroll viewport自身でeventを停止し、node focusからbubbleするArrow keyはEditorのpresentation editへ渡します。

## 性能基準

P1の暫定基準は、500 node / 1,000 edgeを通常規模、2,000 node / 4,000 edgeをstress規模とします。通常規模ではlayout以外の編集操作応答を100ms未満、pan/dragを30fps以上、stress規模では初回projectionと標準軽量layoutを合計2秒未満とするbenchmarkをCIで監視します。測定環境、fixture seed、warm-up回数を固定し、絶対時間と前回比の両方を記録します。

表示要求をLLMへ接続するhostは、まずpresentationだけで達成できるか判定します。意味構造が必要な場合だけ、view profile/catalogからprojection capability summaryを導出し、許可語彙とともにLLM adapterへ渡します。分類、検証、失敗時rollbackは[authoring-profile.md](./authoring-profile.md)に従います。

## 現在のlocal mock

購入承認フローを例に、`rdf:Bag`と`rdfs:member`によるlane containment、`rdf:Seq`と`rdf:_n`による順序、`rdf:Alt`とbranch Seqによる選択、`rdfs:seeAlso`による参照を一画面に表示します。開始・終了event、user/service task、gateway等のdomain typeは構造を独自述語で再定義せず、domain extension catalogからappearanceへ対応付けます。Catalog外のIRI-object tripleは通常矢印へfallbackできます。

Editorはdrag、resize、edge waypoint追加・削除・移動、edge label位置、self-loop/parallel edge選択、multi-selection、一括移動、整列、等間隔、grid/target snap、座標入力、template/icon override、undo/redo、mouse/keyboard pan、fit、minimap、selection reveal、zoom、Turtle編集、document/catalog参照を提供します。Turtleの適用、保存、書出は非同期reconciliationの完了を待ちます。現行mockは既存Sceneの表示編集が中心で、human semantic commandによるnode/属性/edge/包含作成は未実装です。Mock hostはrepository内の`public/workspace`をmanifestからtree表示し、runtime schemaで検証した`.iriograph`を読み込みます。旧schemaまたは不正なlocalStorage working copyは採用せずrepository上のsampleへ戻します。保存はsource fileを直接変更せずpath別のlocalStorage working copyへ行い、取込・書出もhostで提供します。

同じworkspaceの画像はmanifest上でasset IRIとhost-owned source URLを対応付けます。Mock resolverはmanifestにないcatalog URLを直接取得せず、同一originのworkspace sourceだけをfetchし、Blob URL leaseへ変換します。Core policyは実media type、byte上限、Blob URLのscheme/originを検証します。Sample documentのcatalog外icon overrideも同じ経路で表示され、treeを使うhost pickerはassetRefだけをoverlayへ返します。

現在の標準軽量layoutはLR/TBのgraph topology、Bag container、generated/user/pinned geometry、manual edge route、parallel edge、reciprocal edge、self-loopを決定的に扱います。より高機能なroutingや大規模graph向けengineは、Coreへ依存を追加せずhost注入adapterとして実装します。

## Editor回帰test境界

Canvasのpointer座標変換とgesture eventはhappy-dom上の`DiagramCanvas` component testで検証し、document mutation、history、semantic transaction、保存flushは`IriographEditor` integration component testで検証します。Core sourceへのtest aliasは未build checkoutでtestを独立実行するためだけに使い、配布buildでは従来どおり`@iriograph/core`をexternalにします。Test sourceはpackageの型宣言とtarballから除外します。

実browser DOMのpointer event、SVG waypoint、mock hostのlocalStorage保存、console errorはPlaywright E2Eへ分けます。通常の`npm run verify`はbrowser binaryを要求せず、UI変更時は[testing.md](./testing.md)の`npm run verify:e2e`または固定Docker imageを追加で実行します。
