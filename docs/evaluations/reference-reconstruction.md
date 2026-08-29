# 参照画像・agent・性能評価履歴

> この文書は過去の再現条件、prompt、計測値、失敗分類を保持する評価記録です。現在の開発commandと合格条件は[開発・検証](../development/testing.md)を正本とし、ここにあるversion別実測値を現行仕様として再利用しません。

Iriographはpureなgraph処理、DOM event contract、editor transaction、実browser host連携を異なる層で検証します。pointer座標や非同期保存をpure unit testだけで代用せず、失敗箇所を特定できる最小の層にtestを置きます。

## 通常の検証

`npm run verify`は次を実行し、headless browserのdownloadを要求しません。

- Coreのparse、validation、projection、layout、reconciliation、serializer、asset policyのunit test
- Semantic validation portのsnapshot/fingerprint、adapter fail-closed、warning confirmation、abort、全write入口共通化のunit test
- Vue editorのasset lease session、入力途中をclampしない共通font-size draft、型DAG・代表直接型・atomic型編集のtest
- RDF semantic textの全label/comment、locale primary、language/datatype、predicate/Alt edge labelとSeq ordinal membership provenance test
- happy-dom上の`DiagramCanvas` pointer/keyboard component test。dragのzoom換算とviewport端auto-pan、実content外周320 unitの初期作業余白、drop前の正負方向160 unit単位の連続拡張・scroll補正と負座標確定、multi-selection、group preview/batch、全Seq/region/container membership intersection clamp、resize minimum、node内label/icon dragと文字方向、endpoint込みroute、全route modeの排他描画、ビュー上のsource/target anchor、意味上のdirect edge端子node drop、invalid drop拒否、generated bend seed、waypoint追加・削除・移動、0/1/複数knotの単一cubic path、Bezier knot/handle drag・Canvas単一tab stopからのkeyboard cycle/reset・zoom逆補正hit target、curve弧長label、parallel/self-loop curve、label offset、parallel/self-loop選択、single-tab-stop navigator、`aria-activedescendant`、決定的focus/range、key repeat previewとkeyup/blur commit、Escape cancel、readOnly/IME除外、pan競合、automatic/manual curve control hullを含む実content boundsへのfitと個別edge reveal、minimap、gesture境界を確認する
- happy-dom上の`IriographEditor` integration component test。単体/batch overlay transaction、sparse routing/appearanceとlegacy event非二重適用、gesture・整列・等間隔単位のundo/redo、Turtle不変、全route mode切替、template実preview、package/workspace icon path候補、node内label/icon offset/resetとlabel文字方向、4入口からの段階Inspector、node-role/group kind付きresource作成、対象別context menuから意味/ビュー各入口への遷移、右Inspector内styleのinput preview/change直接commitとpreset/reset直接commit、意味/ビューtabの排他表示、details dialog、label-first semantic authoring、Canvas resource picker、direct/membership family、inline新規member、作成後のedge・複数membership/分類編集、direct edge endpointのatomic再接続、条件付きcascade削除確認、class交差cell seed、display/semantic containment警告と明示修正、Turtleのaccept/rollback、保存前flush、session selection/navigationとread-only境界を確認する
- 標準predicate pickerのIRI一意性、日本語label/comment/category/example、A/Bを含む`sentencePattern`、個体IRI非混入、`rdf:type`分類と`rdfs:subClassOf`通常編集、`rdfs:member`系だけのstructure command強制を確認する
- Core/ELK layout testでnodeとcomment reservationの障害物回避、非member resourceの全Group Frame content外配置、edge交差・重複cost、自動生成routeの中間点最大1個、manual hard gate、安全なstraight→一直角orthogonal→内角90度以上のbounded Bezierの優先とauto任意角度polylineが0件であること、固定geometryのroute-only refinementを確認する
- Core/View editorのnamed view test。target-only atomic command、immutable/unique ID、locale-only exact overlay、invalid view delete、last-view guard、controlled/uncontrolled active view、view別selection/viewport/temporary hideを確認する
- 全workspaceのtypecheck/buildと、packed tarballを使う外部consumer検証

Component testは`@iriograph/core`のsourceへtest時だけaliasし、未buildのclean checkoutでも単独実行できます。配布buildではCoreをexternalのまま保ち、test fileは型宣言とpackage tarballへ含めません。

## P1-08性能回帰

Coreの通常Vitest suiteは固定生成されるnormal 500 node/1,000 edgeとstress 2,000 node/4,000 edgeを使い、Turtle parse、semantic projection、標準layout、layoutを除く代表編集再投影を監視します。Fixtureは50 nodeごとの`rdf:Bag` containment、全nodeのlabel、重複しない前方向edgeを含み、同じscaleからbyte-exactなsourceを生成します。

各operationは一回warmupし、続く3 sampleのmedianを判定値にします。Stressの初回projection+標準layout 2,000 ms、normalのlabel変更+semantic再投影100 msをそのままCI gateとし、machine計測からの動的倍率、performance testのskip、fixture縮小は行いません。Sample、median、budgetはtest outputへJSONで出します。

P1-46のsmall graph gateはpizza、24 node/23 edge、24 node/120 edgeを一回warmup後5回測り、projection、placement、初期route、refinement、compaction、boundsと合計のp95をJSONへ出します。合計p95は各300 ms未満、非endpoint node交差0、endpoint内部進入0、edge overlap 0、生成route最大3点を必須とします。保守的な曲線segment近似のCrossingは固定上限pizza 11、疎small 0、密small 398以下をgateにし、label全置換、opaque IRI同型写像、非pizza包含でも品質を比較します。Pizzaは実SVG samplingのE2Eでもedge交差10以下、route-node交差1以下を別に固定します。

Prepared relation transactionはpizza正本からrelation追加、predicate変更、endpoint変更を各20回warmupし、その後20回のCore preview+apply p95を150 ms未満に固定します。これはidentity-bound prepared result、edge-only reconciliation、layout完了までのCore gateであり、Vue event、asset、paintを含むbrowser settled値ではありません。Edge-onlyは追加・predicate変更・endpoint変更、parallel/self-loop、multi-view Standard/ELK、12 node/36 edge dense fixtureで、unaffected routeとderived family/Bezier制御点の完全一致、fixed routeを交差costへ含むこと、observerのaffected/fixed/実reroute件数を検証します。Optional `fixedDerivedRoutes`/`fixedDerivedRouteChoices`を無視するthird-party adapterも共通completionでexact値を返し、標準adapterはそのedgeをinitial/refinement/compactionから除外することを別々に確認します。Edge-onlyからfull layoutへ戻る場合は理由を`reconcile-edge-only-fallback` diagnosticとobserver eventの両方で検証します。3,000 unit高のuser resize node fixtureでは最大1 pivotのまま本体交差0と探索cardinality上限を確認します。

実browserのdocument body受領からsettled Scene、操作開始からsettled Scene、発生long taskは`npm run verify:browser-performance`で測ります。このsuiteはproduction buildをVite previewで配信し、Sceneのnode/edge数、対象関係、asset decode、`aria-busy=false`、DOM mutation停止後2 frameをsettled条件にします。2026-08-28の固定Docker Chromium実測は、初期pizza Sceneのbody受領からsettledまでp95 275.6 ms、各20回warm後20 sampleのrelation追加、predicate変更、endpoint変更がp95 144.4、112.6、125.1 msで、300/150 ms gate内です。Navigation Timing、Resource/Paint Timing、Long Task、CDPのLayout/RecalcStyle/Script/Taskも同じsampleへ記録します。

DOMなしのCore testはpan/drag 30 fpsを測りません。Coreではpan中にprojection/layoutを起動しない責務境界を維持し、`npm run verify:performance`はMockの固定500 node/1,000 edge Sceneを実Chromiumで開き、panとnode dragそれぞれの`requestAnimationFrame`間隔p95 33.3 ms以下を確認します。通常E2Eとは別のPlaywright configとCI jobで実行します。詳細なfixture、段階的layout、品質指標、engine選択は[Layout・routing・性能](../editor/layout.md)を参照します。

## Browser E2E

実browser DOM上のpointer event、SVG waypoint、Vue editorとmock hostの保存連携はPlaywright smokeで確認します。browser imageが大きいため`npm run verify`には含めず、UIやeditor transactionを変更した場合の完了手順として明示的に実行します。

Browserが導入済みの環境では次を実行します。Playwrightが検証専用port 4174で最新sourceのVite mockを起動し、終了時に停止します。既存のdev serverは再利用しません。

```sh
npm run verify:e2e
```

Repositoryと同じPlaywright versionを固定したDocker imageでも実行できます。

```sh
docker build -f Dockerfile.e2e -t iriograph-e2e .
docker run --rm --ipc=host iriograph-e2e
```

Pan/dragのframe gateとproduction buildの初期表示・関係transaction gateは通常E2Eと分離して実行します。

```sh
docker run --rm --ipc=host iriograph-e2e npm run verify:performance
docker run --rm --ipc=host iriograph-e2e npm run verify:browser-performance
```

すでに最新sourceのmockを別portで起動して探索する場合は、`IRIOGRAPH_E2E_BASE_URL=http://127.0.0.1:4175 npm run verify:e2e -- e2e/canvas-structure.spec.ts`のように外部管理serverを指定できます。未指定時は従来どおりPlaywrightが4174番でbuild済みmockを起動します。

E2Eは初期workspaceが空overlayのピザ注文・配送semantic seedを単一region viewで開くこと、明示追加したnode-link/region named viewの切替・複製・設定・削除・overlay reset・temporary hide、classを含む重なりregionと共有member、交差内nodeの全bounds拘束とregion resize containment、node dragとviewport端auto-pan、multi-select、group drag、grid snap、整列、等間隔、undo/redo、8-handle resize、Canvas選択中心の4入口と段階Inspector、要素/group種類と名前のatomic作成、direct/membershipのicon family、0/1/複数Canvas事前選択、Seq順序・候補グループ既定・inline新規member、意味/ビューtabの排他表示、対象別context menuが選択時にはmutationせず対応actionへfocusすること、右Inspector内の色・透明度・線編集が別Applyなしで直接確定すること、label-first details、RDF/RDFS/OWL・DCTERMS・PROV-O・SKOSを含むcategory別のA/B例文 relation picker、通常presentationとAdvanced DOMがopaque option ID・label/commentだけを受け生IRIを属性・tooltip・本文・入力に含めないこと、editableなTurtle/Document sourceではexact IRIをlosslessに保持すること、型と業務上の所属が二重編集にならないこと、node/edgeの近傍一覧と重なりedgeへのfocus導線、複数・複数行label/commentとhover/全表示、個別edge説明が標準reificationとしてTurtleへ保存されビュー補足へ混入しないこと、node icon・region label/z-order appearance、選択外へ波及する削除だけのsession-only赤線とcascade確認、ビュー上のnode外側endpoint halo drag、意味上のdirect edge端子node dropによるatomic再接続、edge route mode・terminal marker・caption・manual waypoint追加/移動/削除、straight/curveでwaypointがないこと、curve knot追加・単一cubic path・working copy保存再読込・個別削除・automatic curve復帰、Seq groupとordinal badge、Canvas選択後だけのSeq追加・並べ替え・除外、label drag/reset、parallel/self-loop個別選択、mouse/keyboard pan、fit、minimap、selection reveal、未実行formと適用済み「未保存」の区別、未実行formがある保存時の意味Inspector focus、不正Turtle適用時のScene rollback、presentation操作後にsemantic sourceと非対象geometryが不変で全体layoutが走らないこと、navigation後のdirty不変、host global fieldset CSS隔離、compact Inspector、console/page error不在をhost integration flowで確認します。失敗時のtraceは`test-results/`に残ります。

矩形選択は空白または未選択Group Frame interiorからの実pointer dragで枠を表示し、nodeのbounds交差、straight/orthogonal/Bezierの実描画経路交差、背景frameの全体包含を確認します。選択済みGroup Frameの空内部dragはselect/pan両modeでgeometry移動を優先し、前面nodeとFrame z順を越えないことを確認します。通常選択はreplace、Shift add、Ctrl/Cmd toggle、完全なCanvas空白の単clickだけで解除、Canvas外control clickでは維持を固定し、structured authoringの対象pickerでは同じ集合をaccepted kindとsingle/multiple規則へ通して、関係の接続先やgroup memberへ反映することをcomponentと実browserで検証します。

標準EditorのP1回帰では`図` / `型一覧` / `Turtle` / `Document`を同格tabとして確認します。型一覧は未使用型、複数親DAG、直接・継承別の要素、作成・編集・削除・一括付与を扱い、図上は代表直接型tag一件だけを表示します。Tagからのfocusと型選択highlightはsession-onlyで、Turtle、overlay、history、dirty stateを変更しません。既存の`classification-region` fixtureは互換試験に残しますが、標準seedへclass領域を生成しません。
単一要素の回帰はCanvas選択から意味Inspectorの種類編集へ進み、label-firstの型付与・解除を同じsemantic transactionで確定し、図surfaceと未表示の既存直接型を維持することも固定します。

Canvasのhost埋込み回帰は通常幅と800px狭幅、左右sidebar折り畳み状態を通し、document横overflowなし、薄いgridの可視性、内部scroll、中ボタンまたはAlt+空白dragのpan、primary空白dragの矩形選択、node drag中auto-pan、外周handleへの到達を実Chromiumで確認します。Computed styleではsemantic object本体が選択中も`region/Seq < edge < node`を満たし、選択frontは同じ構造層内に留まることを検証します。Waypoint、endpoint halo、resize handleだけは最上位transient interaction layerでnode重なり時もhit testでき、通常edge線とterminal markerがそこへ複製されないことをDOM構造でも確認します。Seq fixtureは「承認」を枠headerへ一度だけ表示し、`rdf:_n`由来edgeを0件とします。AltからSeqへのbranchはSeq group境界をtargetとし、Seq labelをedgeへ転記しません。

0.10.1では30%・50%・100% zoomでgridの主要線間隔がsnapの整数倍、表示線幅が1px以上であることをcomputed styleとscreenshotで確認します。Workspace画像は候補click、Enter、host picker成功/取消、無効pathを通し、画像選択だけが一回のpresentation更新と一回のundo単位を作り、folder選択はpath navigationだけでdocumentを変更しないことを固定します。Nested Group回帰は実Pizza文書の「料金」を外側の「ピザ店」へ追加し、`rdfs:member`の追加、内側の店員・調理担当・配達担当のgeometry不変、全bounds containment、追加後の外側Group移動を実Chromiumで確認します。

### ピザ参照図の100点構造評価

参照画像との比較はpixel一致や主観的な「似ている」で判定せず、固定Chromium、viewport 1920×1080、working copyなし、`models/pizza-order-delivery.iriograph`、初期overlay `{}`で実行します。初期layoutとasset解決が完了してからfitし、Canvas座標のScene geometry/routeと実browser上の文字サイズをJSONへ記録し、同時にscreenshotを保存します。BPMN固有icon、色、font family、線の装飾は採点対象外です。

| 項目 | 点 | 再現可能な採点方法 |
|---|---:|---|
| Lane階層・順序 | 15 | 顧客とピザ店、およびピザ店配下の店員・調理担当・配達担当を検出できれば5点、ピザ店が3子laneを構造上持てば5点、lane中心Yが顧客→店員→調理担当→配達担当の順なら5点 |
| Membership containment | 15 | 各可視memberの全boundsが意味上属する全region/container content bounds内にある割合を`15 × valid/total`で算出する。複数所属は各membershipを別件として数える |
| 左から右のflow・終了位置 | 15 | 顧客と店舗の期待する主flow隣接対について`centerX(source) < centerX(target)`を満たす割合を10点満点で算出し、各終了要素がそのlaneの主flow中で最右なら5点 |
| Branch・loop | 12 | 注文後gatewayから受取側と待機側の2 branchが別routeなら4点、待機→問い合わせの経路が存在すれば4点、問い合わせからgatewayへ戻り主flowへ再合流すれば4点 |
| Cross-lane message | 12 | 注文、問い合わせ内容、ピザ、料金、領収書ごとにproducer/resource/consumerのsemantic接続が揃う割合を4点満点で算出する。3者の中心Xの`spread = maxX - minX`を記録し、`max(0, 1 - spread / (2 × medianNodeWidth))`の5組平均を8点へ換算する |
| 要素重なり | 12 | Nodeと常時表示commentの意図しないbounds overlap pairを数え、`max(0, 12 - 2 × pairs)`とする。Region包含とregion同士の意図した重なりは除外する |
| Routing cleanliness | 10 | Endpoint nodeを除くroute-node交差数を`I`、共有endpointを除くedge交差数を`C`として、`max(0, 5 - I) + max(0, 5 - max(0, C - 4))`とする。全generated routeが中間点1個以下でない場合はこの項目を0点にする |
| Compactness・可読性 | 9 | 実content aspect ratioが1.8〜3.0なら3点、fit zoomが0.35以上なら3点、fit後のprimary labelの最小実表示font sizeが9px以上なら3点 |

左から右の主flow対は、顧客の`おなかがすいた→ピザを選ぶ→ピザを注文する→注文後イベント→ピザを受け取る→代金を払う→ピザを食べる→空腹が満たされた`、店舗の`注文を受ける→注文後処理を並行分岐→ピザを焼く→ピザを配達する→代金を受け取る→注文完了`、問い合わせ側の`注文後処理を並行分岐→問い合わせ受付→問い合わせに回答する→問い合わせ対応完了`に含まれる隣接対とします。Loopを表す`問い合わせる→注文後イベント`はLR採点から除き、Branch・loop項目で判定します。Cross-laneの3者は順に`ピザを注文する/注文/注文を受ける`、`問い合わせる/問い合わせ内容/問い合わせ受付`、`ピザを配達する/ピザ/ピザを受け取る`、`代金を払う/料金/代金を受け取る`、`代金を受け取る/領収書/代金を払う`です。

各比率点は小数第1位へ丸め、合計も100点満点で小数第1位へ丸めます。E2E artifactには各内訳、membership件数、主flow対、5つの3者spread、overlap pair、route-node交差、edge交差、generated中間点最大数、content aspect、fit zoom、最小font sizeとscreenshotを残します。標準layoutとoptional ELK adapterを比較する場合は、同じProjectedSceneと同じrubricで測ります。この比較は一般layoutの選択・改善に使う検証証拠であり、ピザseedのIRI、label、件数を検出して配置を変える規則にはしません。

0.10.0の標準layout基準値は90.1/100です。内訳はLane 15、containment 15、LR flow 15、branch/loop 12、cross-lane message 10.1、overlap 12、routing 5、compact/readability 6です。25 node、5 Group Frame、32 edgeに対してnode overlap 0、route-node交差0、共有endpointを除くedge交差10、edge overlap 0、generated中間点最大1、message列spread最大139/平均78.8、fit 45%、content aspect 1.8247、最小実表示font 7.2pxでした。自動route familyは安全な直線→安全な一直角直交→内角90度以上のbounded Bezierを保ち、任意角度の自動折線を公開しません。交差と縮尺は汎用layoutの改善余地として残します。

この90.1点は構造・geometryの一致度であり、参照画像とのpixel一致度ではありません。実screenshotの目視では、レーン階層・幅・順序と主フローは対応しますが、参照図の色付き縦header、顧客lane内のbranch別row、短いcross-lane connectorは完全には再現していません。Shape/icon/headerはcatalog/profileとrendererの視覚文法差、branch rowは汎用layout品質差として点数と分けて記録します。

### 画像一致評価

上記の構造評価とは別に、利用者が参照画像へ期待する「図としての似方」を100点で目視評価します。Raw pixel similarity、SSIM、画像全体の差分率は、参照画像が図だけを切り出している一方、実browser screenshotにはtoolbar、sidebar、minimap、grid、異なる解像度・font rasterizationが含まれるため指標にしません。Canvas内の図だけをcropし、外接矩形を0〜1へ正規化して、同じlabelを持つanchorとlane境界を対応付けます。Font family、antialiasing、editor chromeは採点対象外ですが、BPMNとしてのshape、icon、色分け、線種は意図した視覚文法なので採点します。

| 項目 | 点 | 参照図との比較方法 |
|---|---:|---|
| Macro lane proportions | 20 | 図全体のaspect ratio 5点、顧客/ピザ店の高さ比5点、店員/調理担当/配達担当の高さ比5点、lane間gap・左header・外周余白の平均誤差5点。各5点枠は比率誤差10%以内を5/5、20%以内を4/5、30%以内を3/5、40%以内を2/5、50%以内を1/5、50%超を0点とする |
| Relative placement | 20 | 構造評価で列挙したprocess nodeの正規化中心をlabelで対応付け、主flowのX順と間隔8点、lane内Y位置と上下関係8点、開始/終了・resourceの外周余白4点で比較する。順序一致だけで満点にせず、参照位置からのずれも判定する |
| Branch rows | 15 | `ピザを選ぶ/ピザを注文する`の上下stack、注文後eventに対する受取側と`60分待つ/問い合わせる`の別row・return loop、店員laneのparallel branchと問い合わせ/クレーム/回答rowを各5点で判定する |
| Cross-lane alignment | 15 | 構造評価と同じ5組のproducer/resource/consumerについて、3者の中心X spreadが図幅の2.5%以内なら各3点、5%以内2点、8%以内1点、それ以上0点とする。Semantic接続が正しくても縦列になっていなければ減点する |
| Connector geometry | 15 | 主control flowの短い直線・直交性4点、branch/merge/loopの矩形corridor4点、cross-lane messageの垂直性と参照図に対応する線種4点、交差・長い斜線・edge label clutterの少なさ3点で判定する |
| BPMN visual language | 15 | 開始/終了eventとgatewayのshape 4点、taskの矩形・塗り分け3点、message/timer icon 3点、laneの色付きheader/band 3点、message/control flowのdash・marker・label階層2点。Icon artworkや色値の完全一致ではなく役割の見分けやすさを判定する |

画像一致点は、参照bboxの手動markingと目視による対応付けを含む主観値です。評価者、対象screenshot、内訳と差分理由をartifactへ残し、5点程度の揺れを許容します。自動CI gateや構造評価90.1点の代用にはせず、構造点と画像一致点を必ず併記します。

0.9.0のempty-overlay screenshotを会話添付の参照図へ照らした画像一致基準値は42±5/100です。Content aspect 1.8029とlane全体の比率、主flowのまとまりは維持しています。一方、顧客laneのbranch別row、cross-lane messageの縦列、短い直交connectorはまだ一致せず、event/gateway/message icon、色付き縦header、message dashも標準catalogだけでは再現していません。構造点が高くてもこの視覚文法差を画像一致点から減点します。

Macro比率、相対配置、branch row、edge corridorと交差の改善は、特定seedのIRIやlabelへ分岐しない汎用layoutの責務です。BPMN shape、icon、色、線種はcatalog/profileとrendererの視覚文法で解き、標準layoutへ業務固有styleを埋め込みません。個別documentを参照図へ最終調整する座標・size・route・styleはoverlayの責務ですが、初期seedは空overlayという検証条件を維持し、手動overlayで自動layoutの画像一致点を水増ししません。

#### LLM overlay派生比較

比較用の`pizza-order-delivery-llm-overlay.iriograph`は、正本seedの`semantic.source`とbyte-identicalなTurtleを維持し、参照画像を見ながら生成・調整したoverlayだけを持ちます。Overlay差分は62件で、30 elementのgeometryと32 edgeのroute/styleです。Chromiumで3回、LLMによる候補作成と人手によるbrowser目視・修正指示を反復し、各回のconsole/page errorは0件でした。したがって、この結果はvision modelの一回実行や無人自動変換の精度ではなく、人手を含むLLM-assisted WYSIWYG作業の到達例です。

同じ画像rubricによる派生比較は84±5/100で、内訳はMacro 17、relative placement 17、branch rows 15、cross-lane alignment 15、connector geometry 11、BPMN visual language 9です。Empty-overlay正本の現行42±5/100は自動projection/layoutの基準値として扱い、派生84±5を汎用layout baseline、release gate、CI閾値へ使いません。派生fileはoverlayでどこまで参照図へ寄せられるかを比較するartifactであり、そのgeometryやrouteをseed、catalog、Core layout ruleへ逆輸入しません。

独立contextでの再実験`pizza-order-delivery-llm-overlay-r2.iriograph`は`gpt-5.6-terra`、reasoning
effort `medium`へ、参照画像、空overlay seed、document/schema、採点rubricだけを与えました。初期指示は
「前回overlayと前回screenshotを完了まで読まず、Turtleをbyte-identicalに保ち、登録済み
geometry/routing/template/styleだけで別fileを作り、固定Chromiumで3回表示・調整し、scoreと計測値を
記録する」という一回だけで、追加指示は0回です。29 model cycle、browser 3反復、task telemetry
309.1秒、input 1,886,226 tokens（cached 1,789,184、non-cached 97,042）、output 13,884 tokens
（reasoning 3,977を含む）、合計1,900,110 tokensでした。3 screenshotは同一hashでconsole/page error 0、
Turtleはseed、`pizza-order-delivery-llm-overlay.iriograph`、`pizza-order-delivery-llm-overlay-r2.iriograph`の
3 fixtureでbyte-identicalな5161 bytesです。SHA-256は全fixtureで
`e367fea3b0befe35ab9571ea8bf62055025682737286d3e9c5db1aa7c7afc7bb`、r2 overlayは41件
（geometry 30、routing 11）です。

この約190万tokenは約5万文字の文書を一回変換した量ではなく、29 model cycleの累積値です。一cycle平均は
input 65,042、うちcached 61,696、non-cached 3,346、output 479 tokensで、inputの94.86%はprompt
cacheから再利用されました。各cycleで指示、schema、capability、作業履歴、tool/browser結果を含むworking
contextが再計上されるため、対象文書の文字数とtelemetry総量は比例しません。Overlay専用のScene索引・sparse
patch・validate/render toolがなく、汎用agentがrepository、schema、browser状態を反復して扱ったことはcontextを
大きくした一因ですが、単に「仕様全文を一回渡したため」ではありません。P2-10ではcompact tool経由の同条件
実験を行い、特にnon-cached input、model cycle、到達scoreを比較します。

同じrubricによる再実験は71±5/100で、Macro 16、relative placement 15、branch rows 12、cross-lane
alignment 12、connector geometry 7、BPMN visual language 9です。Lane比、task/event/gatewayの役割、
主要な上下rowは近づきましたが、長い斜線、predicate labelの密集、cross-lane messageの非直交、縦lane
header・message dash・timer/envelope iconの表現上限が残りました。前回の人手修正指示を含む84±5より
13点低いため、一つの成功artifactから中程度モデルの再現精度を一般化できません。一方で空overlayの
現行empty-overlayの42±5からは29点改善しており、閉じたoverlayだけで意味正本を変えず参照図へ寄せる実現性は再確認できました。
この二結果はCore既定layoutへ逆輸入せず、モデル差・指示差・renderer capability差を分けるP2-09の証拠とします。

残差のうち、封筒・timerの専用icon、色付き縦lane header、semantic predicate由来edge labelのview単位hideは、現行catalog/template・renderer契約だけでは参照図どおりに指定できません。これらを座標調整で偽装せず、catalog/profile/rendererの表現上限としてBPMN visual languageとconnector geometryから減点しています。この時点の1図3反復だけでは完了条件に達していなかったため、後述の3資料×3回を別実験として実施しました。

#### 画像だけからTurtleとviewを作る独立再構成実験

P2-12の初回baselineとして、既存Turtle、既存overlay、空overlayのrender結果、過去のLLM成果物を
一切見せず、`pizza-reference.webp`一枚を唯一のdomain/visual evidenceにした独立agent実験を行いました。
Referenceは1940×1120、39,404 bytes、SHA-256
`54aae4e142508961253d211aac9a6e2cd90e4aa6cf8e403690281b73e87303dc`です。Agentに許可した
repository情報は`AGENTS.md`と、出力contractを読むためのCore model/schema/document/standard catalogだけです。
既存pizza file、fixture、test、[開発・検証](../development/testing.md)、変換後screenshotの検索を明示的に禁止しました。

初期指示は一回で、追加指示は0回です。指示内容は次の境界へ固定しました。

```text
元画像を唯一の意味・表示上の証拠として、新規Iriograph v1 documentを一から作る。
既存pizza Turtle/.iriograph/screenshot/fixture/test/過去成果物を読まない・検索しない。
出力は新しいdocumentId/base IRI、Turtle semantic.source、region view、sparse overlayを持つ。
標準RDF/RDFSを優先し、領域/laneはrdf:Bag+rdfs:member、domain predicateは
rdf:Property+rdfs:label/commentで自己記述する。全visible resourceへlabelを付ける。
画像の制御・message関係を近接だけからgeneric edgeへ置換しない。
Overlayは有限でschema-validなgeometry/routing/appearanceだけを持ち、Turtleの意味を代替しない。
指定したignored .tmp file以外を変更せず、可能な範囲で検証し、曖昧さと計測値を報告する。
```

指定modelは利用可能なSonnet 4.6相当の代替として`gpt-5.6-terra`、reasoning effort `medium`です。
Task telemetryは235.010秒、12 model cycle、tool call 11回（画像確認1、shell 10）、browser反復0です。
Input 451,372 tokens（cached 404,480、non-cached 46,892、cache再利用89.61%）、output
13,067 tokens（reasoning 3,985を含む）、合計464,439 tokensでした。前回の約190万tokenに対し、
既存成果物の探索、browser反復、追加指示を外すことで総量は約24.4%、non-cached inputは約48.3%へ
減りました。ただし、schema型定義を各cycleで保持するため、画像と出力12,102 bytesだけに比例する量ではありません。

生成物`pizza-image-reconstruction-r3.iriograph`はSHA-256
`c5b2c6ae4d8cc99f6e86d19f4d5ef03edfa5f6d72775976168b1c6fdaf4d4031`です。Root reviewでは
Core schemaとRDF 119 quadのparseに成功し、projection errorは0でした。画像上の5 lane/groupを
`rdf:Bag`として5/5、visibleな業務/event/gateway要素を18/18、その正しいlane membershipを18/18、
店舗配下の3 laneを3/3復元しました。Direct relationは23件中22件を対応付けられ、顧客の
`問い合わせる`から注文後gatewayへ戻るloopだけを`ピザを受け取る`への前進edgeとして誤認しました。
5種類のmessage関係と名称は復元しましたが、注文・問い合わせ内容・ピザ・料金・領収書を再利用可能な
information resourceにせずpredicate edgeへ畳み込んだため、期待するinformation resource identityは0/5です。

構造忠実度は74/100と評価します。内訳はvisible要素25/25、lane/group/membership 20/20、direct relation
24/25、information resource identity 0/15、profile/runtime互換5/15です。最後の互換性減点は、Agentが
`:Task`、`:Event`、`:Gateway`等を`rdfs:Class`として型付けし、classification-region profileがそれらも
領域へ正しく投影した結果、意図した5 regionが実Sceneでは9 region、39 membershipになり、非共有領域の
重なりと店舗子lane paddingについて16 layout warningを生じたためです。これは画像認識の失敗というより、
「意味上の型」と「このprofileで領域に投影するclass」の区別を最小contractから選べなかった失敗です。

同じ画像rubricの実browser目視は55±5/100です。内訳はMacro 15、relative placement 17、branch rows 11、
cross-lane alignment 0、connector geometry 7、BPMN visual language 5です。Lane比、主要node位置、青いtask、
gatewayは近い一方、余分な4 class region、message resource node不在、edge routing overlay 0件による斜線、
event/timer/envelope iconと色付き縦header不在、狭いevent labelが減点理由です。Cross-laneは5関係を
意味上復元していても、既定rubricが要求するproducer/resource/consumerの3点列を作っていないため0点です。
この結果から、画像だけでも要素・lane・大半の関係は中程度agentで復元可能ですが、Iriograph profile summaryと
`validate → project → render`の閉じたtoolを渡さない一回生成では、正しいTurtleと正しい見た目を同時に保証できません。
成果物は比較用`.tmp` artifactに留め、seed、catalog、Core ruleへ逆輸入しません。

P1-83で標準Class表示をGroup Frameから`型一覧`へ分離した後、同じreference imageだけを主要な業務根拠として
再構成を再実行しました。Agentには既存pizza fixture、過去の再構成document/screenshot、git履歴を禁止し、
document contractとpackage APIだけを許可しました。利用modelは`gpt-5.6-terra`、reasoning effortは`medium`です。
初期指示1回に加え、root reviewから可視Group Frame 5件、標準`instance-flow + region`、Core full projectionで判明した
containment warningの解消を各一回、合計3回追加指示しました。これは無人一回生成の結果ではなく、独立agent作成と
root validationを往復した結果です。

最終`.tmp/pizza-image-reconstruction-p1-final.iriograph`は79 quad、21 node、24 edge、5 business region、
24 membershipを持ち、Core full projectionとMock browserでerror 0、warning 0でした。前回の余分なClass regionは
9件から画像上の5 business regionへ、layout warningは16件から0件へ減り、information resource identityは0/5から
4/5へ改善しました。一方、画像上の顧客側gatewayと問い合わせ情報resourceを取りこぼし、問い合わせloopを前進edgeへ
誤認し、見えている23要素のうち21要素だけを復元しました。構造忠実度は約87/100、上記画像rubricによるroot目視は
61±5/100です。画像一致の内訳はMacro 18、relative placement 15、branch rows 8、cross-lane alignment 9、
connector geometry 7、BPMN visual language 4です。Lane比と主要配置は近い一方、色付きlane header、event/message icon、
message点線、短い直交connectorは現行catalogと生成overlayで再現できていません。

計測は初期指示1回、追加指示3回、tool call約29回、Playwright render 6回、画像確認3回、wall time約22分です。
Agent runtimeはinput、cached/non-cached input、output、reasoning tokenと内部model cycleを公開しなかったため推測しません。
この再実験も当時は一画像一回の証拠に留まったため、後述の3資料×3回では同じ失敗分類を含む統一評価へ置き換えました。

## P2-09・P2-12 3資料×3回の確定実験

旧Pizza単体の試行とは別に、Pizza注文、購買承認、service architectureの3画像を固定し、medium 1回、高推論2回の各3runで再実験しました。参照assetとSHA-256は`docs/experiments/references`に置きます。既存`.iriograph`、Turtle、overlay、SVG原本は画像再構成agentへ見せていません。

共通の画像再構成初期指示は一回だけです。

```text
指定した3枚のraster画像だけをdomain/visual evidenceとし、Iriograph v1 documentを各1件、一から作成する。
既存.iriograph/Turtle/overlay/fixture/test/docs/SVG/過去成果物を読まない・検索しない。
許可したRDF/RDFS profile、document/schema、validate/render contractだけを使い、Turtleとsparse overlayを分離する。
要素、label、Group/membership、関係方向、resource連携、geometry/styleを画像から復元し、正規runtimeで検証する。
不明値と取得不能なtelemetryを推測しない。
```

構造点はnode label F1 40、Group label F1 20、directed relation F1 30、membership F1 10です。画像点は正規化した同名landmark geometry 70、Group geometry 20、palette 10の決定的proxyで、perceptual modelの評価ではありません。

| run | model/effort | 資料 | schema/runtime | 構造 | 画像 | error/warning |
|---|---|---|---|---:|---:|---:|
| medium-1 | gpt-5.6-terra / medium | Pizza | schema可・Scene拒否 | 0.00 | 0.00 | 1/0 |
| medium-1 | 同上 | 購買承認 | schema可・Scene拒否 | 0.00 | 0.00 | 1/0 |
| medium-1 | 同上 | Architecture | schema可・Scene拒否 | 0.00 | 0.00 | 1/0 |
| high-1 | gpt-5.6-terra / high | Pizza | accepted | 67.09 | 62.80 | 0/0 |
| high-1 | 同上 | 購買承認 | accepted | 94.78 | 57.06 | 0/0 |
| high-1 | 同上 | Architecture | accepted | 86.57 | 42.11 | 0/0 |
| high-2 | gpt-5.6-terra / high | Pizza | accepted | 73.07 | 45.61 | 0/9 |
| high-2 | 同上 | 購買承認 | accepted | 93.33 | 55.82 | 0/0 |
| high-2 | 同上 | Architecture | accepted | 78.50 | 51.60 | 0/0 |

Mediumは3件とも存在しない`urn:iriograph:layout:standard-lr:1`を生成し、正規runtimeの`layout-adapter-unresolved`で拒否されました。Agent自身の簡易検証を合格扱いせず、構造・画像点を0とします。High-2 Pizzaの9 warningは8件の`region-member-outside`と1件のroute未解決です。High-1/2もfull profileでpredicate定義を可視nodeにした例があり、画像上にない語彙nodeは構造precisionとbrowser目視で減点します。

再構成の追加指示は全run 0回です。Tool/validationはmediumが16 outer exec・19 nested call・4 cycle、high-1がexec 15・画像3・patch 3・1 validation cycle、high-2がouter exec 25・nested exec 26・画像3・patch 9・6 validation cycleです。High-2は成果物生成時刻基準で4分18秒、他のwall timeは取得不能です。Input/cached/output/reasoning tokenは全3runでruntimeから公開されず、推測しません。

P2-09はHigh-1の意味document/Sceneを共通baselineにし、reference画像とopaque Scene index、閉じたcapabilityだけを別agentへ渡しました。共通指示は次です。

```text
Turtleとsemantic structureを変更せず、read-only Sceneと参照画像からsparse presentation candidateだけを作る。
任意CSS/URL、未登録asset、semantic writeを使わず、指定binding・field・routing budget内に収める。
公式validatePresentationCandidateを通し、対象外情報やsource IRIを外部DTOへ出さない。
```

Raw SceneのIRI-shaped IDがopaque境界に合わない問題は`PresentationSceneBridge`で確定的aliasへ変換し、承認patchだけをHost内部でsource overlay IDへ戻しました。初期指示は各run 1回、利用者のfollow-upは0回です。Validator適合の追加指示はmedium/high-1/high-2で3/2/2回でした。Token、medium/high-1のcycle・wall timeは取得不能です。High-2 reportはtool 22回、1 cycleです。

| run | 資料 | accepted changes/fields | 画像 before | after | 差 |
|---|---|---:|---:|---:|---:|
| medium-1 | Pizza | 11/48 | 62.80 | 66.33 | +3.53 |
| medium-1 | 購買承認 | 11/56 | 57.06 | 61.75 | +4.69 |
| medium-1 | Architecture | 12/60 | 42.11 | 74.35 | +32.24 |
| high-1 | Pizza | 19/19 | 62.80 | 85.14 | +22.34 |
| high-1 | 購買承認 | 13/13 | 57.06 | 92.19 | +35.13 |
| high-1 | Architecture | 12/12 | 42.11 | 91.79 | +49.68 |
| high-2 | Pizza | 19/104 | 62.80 | 63.21 | +0.41 |
| high-2 | 購買承認 | 13/73 | 57.06 | 57.06 | +0.00 |
| high-2 | Architecture | 12/81 | 42.11 | 60.48 | +18.37 |

全9 candidateは公式validatorでaccepted、Turtle SHA-256不変です。Local Mock実Chromiumへ全9件を取り込み、全て`valid`、console/page/request error 0でした。P2-12も全9件を実Browserで確認し、High-1/2の6件はvalid、mediumの3件は期待どおりlayout errorで空Scene、browser error 0でした。Screenshot/reportは`.tmp/experiments/mock-runs`に生成し、再現scriptは`scripts/experiments`に置きます。

High-2がhigh-1を常に上回らず、style fieldを大量に変更してもgeometry proxyが改善しないrunがあります。Model effortやpatch量を精度の代理にせず、closed validation、構造点、画像点、browser結果を併記します。生成物、prompt、座標をCore layout/catalogの既定規則へ逆輸入しません。
