# Layoutと大規模graphの最適化

## 1. 目的と責務境界

Iriographのlayoutは、意味graphを解釈する処理でもrendererでもありません。Projection済みSceneのstable identity、包含、接続、size、pin、既存geometryを入力し、element geometryとedge routeを返す交換可能なadapterです。同じ入力、adapter version、layout policyからは同じ結果を返します。

Semantic Turtleと`.iriograph` documentにはengine固有optionを保存しません。Documentが持つのはstableな`layoutRef`と、ユーザーが確定したgeometry、pin、manual routeです。`elk.*`、Dagre ranker、force定数、Graphviz attribute等はhostまたはversioned adapter policyが解決します。これによりengineを交換しても意味graphとportable documentを移行せずに済みます。

性能最適化でも次の境界を維持します。

- labelや見た目から意味構造を推測しない
- layoutの都合でTurtleやsemantic identityを書き換えない
- user配置とpinを近似constraintへ弱めない
- cache、Worker、LODを使ってもstale resultをdocumentへ適用しない
- 未知domain語彙を特別扱いせず、投影後の汎用Sceneだけを処理する

## 2. 段階的pipeline

各段階はstable element IDでsortした入力と明示的な中間結果を持ちます。一つの巨大なheuristicへ統合せず、品質指標、cache invalidation、fallbackを段階ごとに観測可能にします。

以下は最適化を進める実装順序です。現行の標準軽量adapterは責務分離、包含/SCC、size、基本layered配置、単純orthogonal route、pin保持までを持ちます。Component packing、crossing sweep、label衝突、局所incremental、LODはこの順序に従う後続実装であり、P1-08初稿benchmarkが実装済みとみなすものではありません。

### 2.1 意味投影

Profile/catalogによりTurtleからnode、edge、containerを投影し、overlayをstable semantic identityへ対応付けます。Syntax、profile、domain validation errorがある場合はlayoutを開始しません。LayoutはRDF quadやpredicateを直接参照せず、`LayoutProjectedScene`だけを受け取ります。

### 2.2 包含、connected component、SCC

Container membershipをforestへ正規化し、不正な親参照と包含cycleをdeterministicに診断します。各container直下でedge endpointを直近の子へ持ち上げ、connected componentを分離します。有向graphはstrongly connected component（SCC）へ縮約してDAGを作り、cycle内部の順序と外部layerを分けます。同率時はstable element IDをtie-breakにします。

この段階の結果は、後段がgraph全体を繰り返し走査しないためのindexになります。Adjacency、parent/children、component、SCC、incident edgeは一度構築し、同一revision内で共有します。

### 2.3 Size測定

Catalog templateのdefault size、明示size、container padding/header、labelとiconの測定値から配置boxを確定します。DOM測定をlayout engine内で行わず、hostが実fontの測定値を渡せない場合は決定的なfallback sizeを使います。

Container templateの`headerPosition`はCoreの共通content insetへ解決し、Projectionからlayout adapterへ明示して渡します。標準layout、ELK adapter、Canvas gesture、包含不一致検出は同じinset契約を使い、左headerを上header用余白で近似しません。Containerは子のnatural boundsをbottom-upに集約します。Size fingerprintが同じelementは再利用し、label、template、font metric、icon intrinsic sizeの変更だけを局所invalid化します。

### 2.4 Layered配置

SCC縮約DAGへrankを割り当て、LR/TB方向、rank gap、item gapに従って配置します。独立componentとcontainer内部は別問題として処理します。標準軽量layoutはlongest-path相当の決定的配置を基準とし、高コストな探索を行いません。

順序候補が複数ある場合は、edge由来のbarycenter、以前の並び、stable IDの順で決定します。全探索で最少交差を求めず、規模に応じた固定回数のsweepに制限します。

### 2.5 Crossing、port、orthogonal routing

Layer内順序を上下sweepで改善し、交差数が改善しない時点または固定iteration上限で終了します。Source/target roleからport sideを解決できる場合はcatalog/profile由来の抽象port constraintを使用し、engine固有port IDは保存しません。Roleがないedgeはshape境界上の決定的なattachmentを使います。

Orthogonal routeはsource/target attachmentを必ず含み、parallel edgeとself-loopへstable laneを割り当てます。Manual waypointはhard constraintとして保持します。交差回避とroutingがbudgetを超える場合は、straightまたは単純なdogleg routeへ品質を段階的に落とし、要素欠落や非決定的timeoutにはしません。

### 2.6 Component packing

独立component、container、SCC内部結果をrectangleとしてpackingします。面積だけでなく、希望direction、component間edge、既存位置を考慮します。まずstable size順とidentity順のshelf/skyline packingを行い、aspect ratioが閾値を外れる場合だけ別候補を評価します。

### 2.7 Overlapとlabel

Node/containerのoverlapを空間indexで検出し、generated elementだけを最小量移動します。Pinnedまたはuser配置同士の矛盾は勝手に直さずdiagnosticにします。Node label、edge label、icon boundsは別boxとして扱い、重要度の低いlabelはLOD段階で省略できます。

全pair比較を避け、uniform gridまたはR-tree相当のindexで近傍だけを検査します。Overlap除去で新しいedge crossingが大幅に増える場合は、後段の品質scoreで候補を比較します。

### 2.8 Pinと増分layout

`pinned: true`と`placement: "user"`はhard constraintです。存続するgenerated elementには以前のcenterからのdisplacement penaltyを与え、新規・削除・接続変更の影響componentだけを再計算します。

増分処理は、変更element、incident edge、ancestor container、同じSCC/componentから開始します。局所結果がoverlapやcontainer boundsを満たせない場合にだけcomponent全体、最後にfull layoutへ拡大します。Semantic revision、view ID、profile/catalog revision、layoutRef、size fingerprint、constraint fingerprintをresult keyへ含め、完了時にも現revisionと一致する場合だけ採用します。

### 2.9 LOD

通常規模を超えるviewではlayoutだけでなく描画量を抑えます。Viewport外elementのvirtualization、低zoom時のlabel/icon省略、edge bundle、container単位の折り畳みを段階的に適用します。

LODは意味graphを削除しません。Session-onlyの可視集合とderived aggregateを作り、元のsemantic identityへ戻れる対応表を維持します。Validationは全graphへ行い、temporary hideやLODをerror回避に使いません。折り畳みやsubgraph navigationのdocument契約はP3-03で確定します。

## 3. Adapter方針

### 3.1 標準軽量layout

`@iriograph/core`は依存なしの決定的な軽量adapterを提供します。Clean checkout、server、test、小〜通常規模のhostで必ず利用でき、全element geometry、全edge route、diagnosticを返します。主目的はportable baseline、failure fallback、user geometryの厳密保持です。

標準adapterは高コストな交差最小化や最適packingを無制限に行いません。P1-08の固定budgetを守り、品質改善は固定iterationと規模別cutoffの範囲に限定します。

### 3.2 Optional ELK adapter

複合graph、階層node、port、layered配置、orthogonal routingを重視するhostは`@iriograph/layout-elk`を明示的に導入できます。[ELK](https://eclipse.dev/elk/)は階層nodeとportを扱い、Layered algorithmはroutingを段階として構成できます。Bundle sizeと計算負荷をcoreへ持ち込まないためoptional packageとし、大規模実行はhost-managed Workerを推奨します。

Worker requestにはrequest IDとrevision fingerprintを付け、abortまたは新revision到着後のresultを破棄します。ELKがhard pinを保証できない入力は、pinを動かして見かけ上成功させず標準adapterへfallbackします。

### 3.3 他engineの位置付け

- [Dagre](https://github.com/dagrejs/dagre)はbrowserで使いやすいdirected graph layoutで、flatな小規模flowのadapter候補です。一方、Iriographが必要とするcontainer階層、抽象port、orthogonal routing、hard pin、増分安定性を別処理で補う範囲が大きいため標準高機能adapterには選びません。
- [fCoSE](https://github.com/iVis-at-Bilkent/cytoscape.js-fcose)はcompoundを含む一般networkやcycleのforce-directed配置候補です。業務flowで必要な明確なLR/TB rankと直交routeが主出力ではなく、反復計算と初期条件がmental mapと決定性へ影響するため既定にはしません。関係探索view向けの独立adapterとしては有効です。
- [Graphviz](https://graphviz.org/docs/layouts/)は複数の成熟したlayout engineと高品質な静的出力を持ちます。BrowserでのWASM/Worker配布、font差、engine attribute、incremental editingとの境界が大きいため、server/exportまたはhost固有adapterに適します。Graphviz attributeをportable documentへコピーしません。

Engine名ではなくview要求でadapterを選びます。単純flowとfallbackは標準、hierarchical business diagramの高品質自動整列はELK、自由な関係探索はforce-directed系、静的出版物はGraphviz系という役割分担です。

## 4. 品質指標

性能だけを短縮すると読めない図になるため、layout品質benchmarkでは次を記録します。P1-08初稿は時間、cardinality、error不在を固定し、各品質値のbaseline追加は後続とします。Hard constraint違反とelement/route欠落はscoreではなく即時failureです。

| 指標 | 定義 | 目的 |
|---|---|---|
| overlap | movable box同士の交差面積合計をbox面積合計で正規化 | node/containerの可読性 |
| crossing | endpoint共有を除くedge segment交差数 | flow追跡の容易さ |
| bends | non-collinearなroute内部点の総数 | routeの単純さ |
| length | orthogonal routeのManhattan長をendpoint直線距離で正規化 | 不要な迂回の抑制 |
| displacement | 存続element centerの旧位置からの移動量。pinは0必須 | 編集時のmental map維持 |
| aspect | sceneの`max(width / height, height / width)` | 極端に細長い配置の抑制 |

比較はhard constraint、overlap、crossing、displacement、bends/length、aspectの順を基本とし、同scoreはstable ID由来の候補順で決めます。単一の重み付き合計だけにすると、小さな可読性改善とpin違反等が相殺されるため使いません。

## 5. P1-08固定benchmark

`packages/core/src/performance.test.ts`は通常のVitest suiteで次のfixtureを生成します。Fixture fileのI/Oと生成時間は測定に含めませんが、sourceは同じ入力からbyte-exactに再生成されることを検証します。

- normal: 500 node、1,000 direct edge、50 nodeごとの10 `rdf:Bag` container
- stress: 2,000 node、4,000 direct edge、50 nodeごとの40 `rdf:Bag` container
- 全nodeに`rdfs:label`を持たせ、edgeは重複のない前方向pairとして生成する
- Membershipはcontainment処理を通すが、edge数には含めない

測定対象は次の二つです。

1. Stress fixtureのTurtle parse、semantic projection、標準layout、route生成までを2,000 ms未満とする。
2. Normal fixtureのlabel一件変更、candidate document作成、semantic再投影をlayoutなしで100 ms未満とする。

JIT、module初期化、Docker/CI schedulingの揺らぎに対し、各operationを一回warmupした後に3回測定しmedianを使います。2,000/100 msをそのままCIのhard gateにし、実行環境による動的倍率、失敗時のskip、fixture縮小は行いません。固定runnerの時系列値も記録し、gateへ達する前の劣化を調査します。

Fixtureとsample数を変更する場合はbudgetを暗黙に維持せず、同じcommitで本書、`docs/testing.md`、backlogを更新します。継続的な時系列比較では固定Node/Docker imageとrunner classを使い、異なるmachineの絶対値を直接比較しません。

## 6. Pan/dragの30 fps境界

DOMなしのCore testは、実browserのpaint、SVG更新、pointer event、Vue scheduling、GC pauseを測れないため「pan/drag 30 fps」を証明しません。Test用だけのgeometry loopを作って30 fpsと呼ぶこともしません。

Core側の契約は、pan中にsemantic projectionとlayoutを呼ばないこと、drag中は対象geometryとincident routeの純粋計算だけに限定することです。将来productionのgeometry commandをCoreへ切り出した場合は、通常規模の可視subsetに対して純粋計算p95 8 msを別budgetとして追加し、33.3 ms frame budgetのrenderer余白を確保します。

実際の30 fpsは`performance/browser.spec.ts`で、Mockの固定500 node/1,000 edge Scene、固定viewport・pointer traceを使い、warmup後のpan/dragそれぞれの`requestAnimationFrame`間隔p95が33.3 ms以下かを判定します。通常E2E smokeと別config・別CI jobにし、機能失敗と性能回帰を混同しません。

Vue rendererはviewportだけが変わるpanで静的Scene subtreeを再patchせず、要素ごとのmemo境界によりdrag時も変更nodeとincident edgeを中心に更新します。これは描画最適化であり、Scene identity、document revision、semantic/layout cacheの代替にはしません。
