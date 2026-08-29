# バックログ

この文書は未実装事項を優先順位、依存、完了条件で管理します。細かな完了ログは残しません。実装、component/E2E test、mock確認まで完了した項目は表へ完了印を残さず削除し、再利用する契約だけを「現在の基準点」と各設計文書へ要約します。

## 現在の基準点

Document/catalogのruntime schema、RDF/RDFS標準catalogと汎用operator、限定RDFS closure、決定的rule・catalog解決、stable identityとcompact serializer、非同期layout adapter、全named viewのdisplay reconciliation、workspace assetの非同期picker/resolverと安全policyまでがcoreからVue editorとlocal mockへ接続されています。標準catalogは既存互換のfullに加え、語彙定義を抑止する`instance-flow`とclass membershipだけを領域表示する`classification-region`を同じbase rule/templateから提供し、view profileで意味正本を変えず投影目的を選べます。Host注入のengine-independent semantic validation portは全semantic write入口で共有され、domain diagnosticのScene/source対応、candidate rollback、warning確認、abort/stale抑止を備えます。Named viewは統一ViewCommandで追加・複製・設定・削除・overlay resetでき、active viewとselection/viewport/temporary hideはview別sessionとしてdocumentから分離されています。

Vue editorはlabel-firstのdetails、Canvasからのresource選択、分類/包含batch、Seq/Alt編集を共通authoring transactionへ接続しています。意味InspectorはCanvas選択中心で、初期blur状態には`新しい要素を作る`、`関係を作る`、`要素を変更する`、`関係を変更する`の4入口だけを示し、選択済み対象は各flowの役割へ明示的にseedして一段に一つの判断を表示します。非削除の意味操作は一回の実行内でcandidate validationとatomic commitを完了し、別のPreview/Apply画面を要求しません。Seqは通常edgeでなく薄い順序付きgroup、headerに一度だけ出す名称、memberのordinal badgeとして表示し、`rdf:_n`由来の偽edgeを生成しません。AltからSeqへのbranchも先頭memberでなくgroup境界へ無名で接続し、正本は標準`rdf:Seq`/`rdf:_n`のまま維持します。複数・複数行のlabel/commentを保持し、commentはhoverまたは全表示でき、非表示時もlayoutが表示領域を予約します。

選択要素の包含一覧はexact provenanceを保持したまま対象をCanvasへfocusし、通常membershipを確認なしのatomic transactionで個別解除するか、対象を選択した所属・並び順editorへ移れます。Seq/Altはordinalを壊さず専用のatomic再構成へ委譲します。

通常操作でTurtleやIRIを入力させず、新規nodeは名前とprofileが許可する種類、新規groupは名前と包含・順序付き・候補等の業務構造種別をhost allocatorのopaque IRIと一つのtransactionで作成します。Classは領域作成と混在させず`型一覧`から作成・編集します。`意味`/`ビュー`は排他tabとし、右click、Context Menu key、Shift+F10はnode、direct edge、derived guide、各Group Frame、空白に応じた対象別menuを開きます。Menuは詳細、関係作成、所属・順序、再接続、ビュー、削除等の該当Inspector/actionへfocusする入口であり、menu選択だけでは正本を変更しません。関係追加は`線でつなぐ`と`グループへ所属させる`を最初に分け、前者は一始点・複数接続先、後者は既存Group Frame・複数memberを段階表示します。関係候補は日本語category別に`A（predicate label）B`という候補名と自然なA/B例文を併記し、確定edgeへA/Bを保存しません。要素の種類と業務上の領域所属は別sectionとし、選択nodeの入出力関係、選択edgeの始点・関係・終点を近傍一覧で確認できます。Writableなdirect edgeの端点を別nodeへdropすると、元statement削除、新statement追加、個別説明移送をその場で一つのsemantic transactionとして検証・確定します。空白dropでは元接続を維持し、未接続状態は保存しません。未実行の段階formだけを「意味を入力中」と表示し、host未保存の「未保存」と区別して保存時に確認箇所へfocusします。

色、透明度、線、style presetは安全なsparse appearance overlayとして保持でき、edge接点はnode外側のhaloとstubから周囲を連続的に調整できます。`auto`、中間点なしの`straight`、直交`orthogonal`、sparse knot/handleを持てる実Bezier `curve`、手動経路点を排他的に切り替え、terminal、caption、region label/z-order、8-handle resizeを同じビューInspectorから編集できます。右Inspector内のinlineビュー編集は別の適用確認を挟まず、選択・preset・resetを即時確定し、連続値だけを入力中previewからchange時の一履歴へまとめます。Templateは実shape/style/iconのpreviewから選び、package同梱のlicense・出典を固定した汎用Lucide SVG 74個またはhost注入workspace pathを安定asset IRIへ変換してiconに使えます。同梱iconは初期折り畳みでWorkspace画像の入口を隠さず、workspace候補またはhost pickerで画像を選ぶと現在値、preview、成功/失敗を同じsectionへ表示して一つのpresentation transactionで即時確定します。Node内のlabel/iconは個別dragでき、labelは横書きまたは縦書きを選べ、差分だけをsparse overlayへ保持します。

Documentタブは意味正本、active named viewのoverlay source、portable document全体を分けて表示します。Overlay sourceはJSON整形、runtime schemaと実Scene包含制約の検証、修正行動付きerror、stale draft検出を備え、Turtle不変の一presentation transactionとしてdirty、undo/redo、保存前flushへ接続します。通常の表示調整は引き続きCanvas WYSIWYGを主入口にします。

Diamond nodeはgeometry/hit areaを回転せずbackground/border surfaceだけをdiamondとして描画し、横書きと縦書きで入れ替えた内接content boundsへlabel/iconを置きます。Label本文はTurtle、方向とoffsetはappearance overlay、resize後の実占有boundsはgeometryという境界を維持し、component regressionで短文/長文、icon有無、resizeを固定しています。

Semantic object本体は選択中も`region/Seq < edge < node`の固定層を越えず、waypoint、endpoint halo、resize handle等の操作部品だけを独立した最前面transient層へ描画します。薄い8-unit gridはsnapと同じCanvas座標へ追従するsession-only表示で、document、history、dirty stateへ入りません。低倍率ではsnap原点と8-unit間隔を変えず、8の整数倍の主要線間隔と逆zoomの線幅で画面上1px以上を保つため、host埋込みでもsub-pixelへ消えません。Toolbarの`範囲選択` / `移動`でprimary pointerの空白・未選択Group Frame内部dragを明示的に切り替え、選択済みGroup Frameの空内部dragは両modeで選択集合の移動を優先します。Canvasの完全な空白clickだけが選択を解除し、Canvas外controlの操作では維持します。範囲選択ではnodeとの交差、描画edgeの実経路との交差、背景Group Frameの枠全体包含を使います。Shift追加、Ctrl/Cmd反転に加え、関係・所属等の意味編集pickerでも同じ矩形選択を受入kindと単一／複数制約へ通して利用できます。中ボタンとAltは一時panとして維持します。Canvasは実contentの外周へ初期320 unitのsession作業余白を持ち、drag中は正負方向へ160 unitずつ単調に拡張してdropを要求しません。Seq・region・containerの移動/resizeはmemberの全membership intersectionを制約にします。Editorは左sidebarを初期折り畳みにし、host幅を押し広げる固定最小幅を持たず、compactな右Inspector、内部scroll、左右sidebar折り畳み、倍率preset、全体/選択fit、pan、auto-pan、minimapで狭幅でも全要素へ到達できます。標準layoutとoptional ELK adapter、route refinementは分離し、生成routeの中間点を最大1個に抑えた共通のcompletion・品質検査を通します。自動routeは安全な直線、安全な一直角の直交線、内角90度以上のbounded Bezierの順に選び、任意角度の折線を公開せず、採用familyと理由をderived choiceへ残します。通常UIの技術識別子と英語状態名は日本語の目的表示または「技術情報」へ整理されています。

単一parentのnode-linkと、多対多membershipを交差する半透明領域として示すregion viewは別の空間文法として実装済みです。Domain membership predicateは限定RDFSの`subPropertyOf rdfs:member`で包含へ投影しつつ、元statement/predicateを逆編集用provenanceに保持します。標準の`instance-flow`では`rdfs:Class`と`rdf:type`をGroup Frameへ投影せず、`型一覧`のlabel-firstなtree/DAG、型CRUD、一括付与、図上の代表直接型tag、session-only highlightで扱います。旧`classification-region`を明示したdocumentだけはclass領域と多対多membership、導出intersection cellを読込・編集互換として維持します。業務Group Frameは内部click、内外周label band、21px既定label、package/workspace icon、label/icon衝突警告を共通編集でき、非member generated resourceは全Group Frame content bounds外へ決定的に配置します。Region/memberの全bounds containment、resize/drag、label、z-orderは共通制約を通し、複数regionのmemberをintersection外へ出すgeometry変更をcommitしません。新しいmembershipのsemantic transactionでは変更前後のexact差分を一時的にlayoutへ渡し、新たに制約を受けるmemberとそのsubtreeだけを局所移動します。既存の外側・内側Groupとuser geometryは固定し、空きがない固定Groupでは既存図を崩さずdiagnosticにします。Pizzaの「料金」を外側の「ピザ店」へ追加する回帰では、内側の店員・調理担当・配達担当の全geometryを不変に保ち、追加後も外側Groupを移動できます。

`@iriograph/semantic-access`はlabel/comment中心の検索、describe、neighbor、subgraph、membership索引、revisionに束縛した決定的alias、Core authoring transactionへ委譲するwrite facadeを提供します。これはLLM tool transportそのものではなく、host/MCP adapterが認証、actor policy、revision conflictを接続するためのpackage境界です。標準predicate IRIへ日本語label、説明、category、例を付けるpicker catalogも持ち、日本語独自IRIを生成しません。Instanceのopaque IRIと、統制されたclass/predicate vocabularyをS/P/O上の位置ではなく役割で区別します。

Predicate全体の説明と個別edgeの説明は分離されています。個別説明はexact S/P/Oに対するRDF標準reificationと`rdfs:comment`としてTurtleへ保存し、Scene、関係編集、semantic-accessの検索・subgraphへ伝播します。ビュー専用captionは`ビュー上の補足`としてoverlayだけに保持します。

0.11.0の11 packageはlockstep配布contract、tarball consumer検証、component/Playwright回帰testを持ちます。Core/editorはkeyboard、矩形を含むmulti-selection、整列、snap、manual/Bezier routing、外側endpoint anchor、parallel edge、self-loopを接続済みです。Optional ELK adapter、固定normal/stress Core性能gate、実Chromium pan/drag gate、production buildの初期表示・関係transaction gateも独立package/CI jobとして用意されています。APIはまだ安定版としません。

kuroxiom-cloudのhost adapterはworkspaceの`.iriograph` load/save、permission/revision境界、pending edit flush、binary workspace assetの分離保存を接続します。Workspace画像はpath、basename、stable asset IRI、MIMEだけをeditor候補へ渡し、byteと解決URLは認証付きAssetAccess内に留めます。0.11.0 exact packageを対象に、800px幅を含む実Chromium監査、初期seed、grid、矩形選択、4 tab、型一覧、drag mode、zoom preset、内部scroll、treeと左右sidebarの折り畳み、asset path候補とnode/Group Frame icon表示をproduction conformanceで確認します。

Local mockの初期ファイルは、顧客、店員、調理担当、配達担当のlaneと、注文から完了までの主フロー、問い合わせbranch/loop、注文・問い合わせ内容・ピザ・料金・領収書のcross-lane連携をlabel/comment付きTurtleで表すピザ注文・配送例です。View overlayは空で、個別座標やmanual routeを保存せず標準projection/layoutだけから初期displayを補完します。Node-link viewは既存documentと明示追加の互換機能として維持します。Workspace treeの別画像asset IRIをicon overlayから参照する例も維持します。標準layoutとoptional ELKの同一入力比較はlayout品質の検証証拠であり、seed IRIやlabelに特化した分岐・adapter選択規則にはしません。

標準layoutのphase/実reroute observer、route state cacheとexact枝刈り、prepared preview/apply、変更edgeだけのroute-only reconciliation、unaffected derived routeのexact固定、full fallback理由のdiagnostic/observerを実装済みです。直前に同一runtimeで構築したpre-asset Sceneは、document・view・catalog/layout/optionsへexactに束縛した上限8件の内部cacheから防御的cloneで再利用し、通常のScene buildや別runtimeへ流用しません。固定Dockerではpizza/疎small/密smallの初期projection+layout p95が45.08/6.47/218.11 ms、20回warm後20 sampleのrelation追加/predicate変更/endpoint変更Core p95が22.04/22.56/21.71 msです。Pizzaの非endpoint node交差0、保守的segment近似で共有endpoint除外edge交差11、overlap 0、最大中継点1をgate化しました。Standard/ELK混在view、parallel/self-loop、dense、巨大resize nodeも回帰testに含みます。0.10.0 production buildの実Chromiumでは、20 sampleのbody受領からpaint settledまでp95 275.6 ms、各20回warm後20 sampleのrelation追加/predicate変更/endpoint変更が144.4/112.6/125.1 msで、asset/FCP/Long Taskと併せて専用gateを通します。実SVGのPizza評価はnode-route交差0、共有endpoint除外edge交差10です。

Edge-only semantic reconciliationは変更edgeと旧新endpointに関係するlayout diagnosticだけをactive viewへ返し、overlay-only transactionは以前のlayout warningを持ち越しません。全named viewのsemantic/profile diagnosticは維持しつつ、別viewのlayout warningをactive Sceneへ混在させず、同一diagnosticは一件へ正規化します。

ファイル名とworkspace pathはhost locator、`documentId`はportable document identity、`semantic.baseIri`はrelative IRIのportable fallbackとして分離しています。Turtleの標準`@base`/`@prefix`はsource内で解決し、top-level `imports`はprojection catalog参照、`owl:imports`は暗黙fetchしないsemantic tripleです。ファイルrenameはexpanded RDF IRIを変えず、外部語彙IRIの利用を制限しません。

## 優先度

- P0: package contractを確定し、他hostが安全に試用する前に必要
- P1: 最初の実用MVPに必要
- P2: kuroxiom-cloud・LLM連携と運用に必要
- P3: 利用領域を広げる拡張

## P1 — Editor・layoutの実用性

P1-53〜P1-87およびCanvas矩形選択の実装済み契約は「現在の基準点」と各規範文書へ統合しました。P1 backlogは現在空です。

## P2 — Cloud・LLM・運用

P2-01、P2-03、P2-05〜P2-13はpackage、Cloud adapter、共通conformance gate、3資料×3回の独立agent実験として実装し、再利用する契約を設計文書へ統合しました。P2 backlogは現在空です。

## P3 — 表現拡張

P3-01〜P3-06はliteral annotation、role付きport、session-only折り畳み、domain profile kit、view-only自由注記、永続named-view scopeとして実装し、回帰testを設計文書へ統合しました。P3 backlogは現在空です。

## MVP判定

P0〜P3の現在の基準点で公開候補は成立しています。新しい要求は実装・回帰確認後に完了行を残さず、再利用する契約を基準点と規範文書へ統合します。
