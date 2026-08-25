# バックログ

この文書は未実装事項を優先順位、依存、完了条件で管理します。細かな完了ログは残しません。実装、component/E2E test、mock確認まで完了した項目は表へ完了印を残さず削除し、再利用する契約だけを「現在の基準点」と各設計文書へ要約します。

## 現在の基準点

Document/catalogのruntime schema、RDF/RDFS標準catalogと汎用operator、限定RDFS closure、決定的rule・catalog解決、stable identityとcompact serializer、非同期layout adapter、全named viewのdisplay reconciliation、workspace assetの非同期picker/resolverと安全policyまでがcoreからVue editorとlocal mockへ接続されています。標準catalogは既存互換のfullに加え、語彙定義を抑止する`instance-flow`とclass membershipだけを領域表示する`classification-region`を同じbase rule/templateから提供し、view profileで意味正本を変えず投影目的を選べます。Host注入のengine-independent semantic validation portは全semantic write入口で共有され、domain diagnosticのScene/source対応、candidate rollback、warning確認、abort/stale抑止を備えます。Named viewは統一ViewCommandで追加・複製・設定・削除・overlay resetでき、active viewとselection/viewport/temporary hideはview別sessionとしてdocumentから分離されています。

Vue editorはlabel-firstのdetails、Canvasからのresource選択、分類/包含batch、Seq/Alt編集を共通authoring transactionへ接続しています。意味InspectorはCanvas選択中心で、常設する作成入口を`要素を追加`と`関係を追加`の2つに限定し、対象固有の詳細・所属・関係編集は選択後だけ段階表示します。非削除の意味操作は一回の実行内でcandidate validationとatomic commitを完了し、別のPreview/Apply画面を要求しません。Seqは通常edgeでなく薄い順序付きgroup、headerに一度だけ出す名称、memberのordinal badgeとして表示し、`rdf:_n`由来の偽edgeを生成しません。AltからSeqへのbranchも先頭memberでなくgroup境界へ無名で接続し、正本は標準`rdf:Seq`/`rdf:_n`のまま維持します。複数・複数行のlabel/commentを保持し、commentはhoverまたは全表示でき、非表示時もlayoutが表示領域を予約します。

通常操作でTurtleやIRIを入力させず、新規要素はlabel一項目とhost allocatorのopaque IRIだけで作成します。`意味`/`ビュー`は排他tabとし、右clickは`ビュー`だけを開きます。関係候補は日本語category別に`A（predicate label）B`という候補名と自然なA/B例文を併記し、確定edgeへA/Bを保存しません。要素の種類と業務上の領域所属は別sectionとし、選択nodeの入出力関係、選択edgeの始点・関係・終点を近傍一覧で確認できます。Writableなdirect edgeの端点を別nodeへdropすると、元statement削除、新statement追加、個別説明移送をその場で一つのsemantic transactionとして検証・確定します。空白dropでは元接続を維持し、未接続状態は保存しません。未実行の段階formだけを「意味を入力中」と表示し、host未保存の「未保存」と区別して保存時に確認箇所へfocusします。

色、透明度、線、style presetは安全なsparse appearance overlayとして保持でき、edge接点はnode外側のhaloとstubから周囲を連続的に調整できます。`auto`、中間点なしの`straight`/`curve`、直交`orthogonal`、手動経路点を排他的に切り替え、terminal、caption、region label/z-order、8-handle resizeを同じビューInspectorから編集できます。右Inspector内のinlineビュー編集は別の適用確認を挟まず、選択・preset・resetを即時確定し、連続値だけを入力中previewからchange時の一履歴へまとめます。Templateは実shape/style/iconのpreviewから選び、package同梱のlicense明示済みSVGまたはhost注入workspace pathを安定asset IRIへ変換してiconに使えます。Node内のlabel/iconは個別dragでき、labelは横書きまたは縦書きを選べ、差分だけをsparse overlayへ保持します。

Semantic object本体は選択中も`region/Seq < edge < node`の固定層を越えず、waypoint、endpoint halo、resize handle等の操作部品だけを独立した最前面transient層へ描画します。薄い8-unit gridはsnapと同じCanvas座標へ追従するsession-only表示で、document、history、dirty stateへ入りません。Canvasは実contentの外周へ初期320 unitのsession作業余白を持ち、drag中は正負方向へ160 unitずつ単調に拡張してdropを要求しません。Seq・region・containerの移動/resizeはmemberの全membership intersectionを制約にします。Editorはhost幅を押し広げる固定最小幅を持たず、compactな右Inspector、内部scroll、左右sidebar折り畳み、pan、auto-pan、minimapで狭幅でも全要素へ到達できます。標準layoutとoptional ELK adapter、route refinementは分離し、生成routeの中間点を最大1個に抑えた共通のcompletion・品質検査を通します。通常UIの技術識別子と英語状態名は日本語の目的表示または「技術情報」へ整理されています。

単一parentのnode-linkと、多対多membershipを交差する半透明領域として示すregion viewは別の空間文法として実装済みです。Domain membership predicateは限定RDFSの`subPropertyOf rdfs:member`で包含へ投影しつつ、元statement/predicateを逆編集用provenanceに保持します。`rdfs:Class`と`rdf:type`はregion profileで独立概念領域と多対多membershipへ投影し、交差cellを新しいsemantic resourceにせず導出します。Region/memberの全bounds containment、resize/drag、label、z-orderは共通制約を通し、複数regionのmemberをintersection外へ出すgeometry変更をcommitしません。

`@iriograph/semantic-access`はlabel/comment中心の検索、describe、neighbor、subgraph、membership索引、revisionに束縛した決定的alias、Core authoring transactionへ委譲するwrite facadeを提供します。これはLLM tool transportそのものではなく、host/MCP adapterが認証、actor policy、revision conflictを接続するためのpackage境界です。標準predicate IRIへ日本語label、説明、category、例を付けるpicker catalogも持ち、日本語独自IRIを生成しません。Instanceのopaque IRIと、統制されたclass/predicate vocabularyをS/P/O上の位置ではなく役割で区別します。

Predicate全体の説明と個別edgeの説明は分離されています。個別説明はexact S/P/Oに対するRDF標準reificationと`rdfs:comment`としてTurtleへ保存し、Scene、関係編集、semantic-accessの検索・subgraphへ伝播します。ビュー専用captionは`ビュー上の補足`としてoverlayだけに保持します。

Core/editorは0.6.0 release candidateの配布contract、tarball consumer検証、component/Playwright回帰testを持ち、keyboard、multi-selection、整列、snap、manual routing、外側endpoint anchor、parallel edge、self-loopを接続済みです。Optional ELK adapter、固定normal/stress Core性能gate、実Chromium pan/drag gateも独立package/CI jobとして用意されています。P1-35〜42は最終browser・host検証が終わるまで下表へ残し、APIはまだ安定版としません。

kuroxiom-cloudのhost adapterはworkspaceの`.iriograph` load/save、permission/revision境界、pending edit flush、binary workspace assetの分離保存を接続します。Workspace画像はpath、basename、stable asset IRI、MIMEだけをeditor候補へ渡し、byteと解決URLは認証付きAssetAccess内に留めます。このreleaseでは公開済み0.6.0 exact packageへの更新後に、800px幅を含む実Chromium監査、初期seed、grid、内部scroll、treeと左右sidebarの折り畳み、asset path候補とicon表示をproductionで再確認します。

Local mockの初期ファイルは、顧客、店員、調理担当、配達担当のlaneと、注文から完了までの主フロー、問い合わせbranch/loop、注文・問い合わせ内容・ピザ・料金・領収書のcross-lane連携をlabel/comment付きTurtleで表すピザ注文・配送例です。View overlayは空で、個別座標やmanual routeを保存せず標準projection/layoutだけから初期displayを補完します。Node-link viewは既存documentと明示追加の互換機能として維持します。Workspace treeの別画像asset IRIをicon overlayから参照する例も維持します。標準layoutとoptional ELKの同一入力比較はlayout品質の検証証拠であり、seed IRIやlabelに特化した分岐・adapter選択規則にはしません。

## 優先度

- P0: package contractを確定し、他hostが安全に試用する前に必要
- P1: 最初の実用MVPに必要
- P2: kuroxiom-cloud・LLM連携と運用に必要
- P3: 利用領域を広げる拡張

## P1 — Editor interaction refinement

| ID | 項目 | 依存 | 完了条件 |
|---|---|---|---|
| P1-35 | 非破壊操作の直接確定と選択Delete | semantic/presentation transaction、keyboard | Drag、resize、route、anchor等のビュー操作はdrop時に直接overlayへ確定し、右Inspectorでの追加承認を要求しない。意味の作成・変更も入力を完了する一度の実行操作でvalidationとtransactionを行い、別のPreview/Apply確認を挟まない。選択node/edgeはDelete/Backspaceで削除できる。削除対象に未選択のincident relation、Seq/Alt membership等がある場合だけ影響一覧modalを出し、影響対象も選択済みなら直接atomic cascadeする。削除以外の警告はinline guidanceとしmodal承認にしない |
| P1-36 | 先読みCanvas余白と連続auto-expand | viewport、drag/resize、auto-pan | 実content boundsの各辺へ初期320 canvas unitの作業余白を確保し、要素を端へdragし続ける間はdropせず必要な正負方向へ160 unitずつCanvas boundsとviewportを連続拡張する。負方向ではscrollを補正し、一回のdrag中に到達範囲が小刻みに制限されない。Fitは作業領域でなく実content boundsを使う |
| P1-37 | Seq group全体の包含制約 | Seq presentation、multi-membership constraint | Seq枠またはそのmemberを移動・resizeした場合、各memberが属する全Seq/region/containerの許容boundsを同時に満たす。別Seqのmemberを一方の枠移動で外へ出すgeometryはpreview中に制限し、commitしない |
| P1-38 | node labelの文字方向 | appearance overlay、node content offset | Node labelは横書き・縦書きをビューInspectorから選択でき、label/iconの個別offset、resize、undo/redoと共存する。Turtleは変更せずsparse overlayだけへ保存する |
| P1-39 | 自動routeの最大1中間点と経路点削除 | standard layout、ELK adapter、route refinement | Turtle確定後の自動layoutが生成するedge routeは中間waypointを最大1個にしつつ、nodeとの重なり、接続先内部通過、非最短anchor、edge交差・重複を既存quality scoreで最小化する。直線で品質を満たすedgeは0個とする。手動routeの選択waypointはCanvasまたはビューInspectorから個別削除できる |
| P1-40 | compact Inspector | Vue editor responsive CSS、accessibility | 右Inspectorの標準幅、文字、余白、control高さを現行のおよそ2/3へ縮める。最低44pxのpointer targetまたは同等の操作余白、keyboard focus、長い日本語labelの可読性を維持し、狭幅では折り畳みと内部scrollでCanvasを圧迫しない |
| P1-41 | 選択中心の意味編集導線 | SemanticIntentPanel、selection neighborhood | 「要素を変更」「関係を変更」を先に選ばせず、Canvasで要素/edgeを選ぶと意味tabへ名前・説明・種類・所属・入出力関係の概要と主要編集actionを段階表示する。追加は「要素」「関係」の二入口を維持し、関係は始点→種類→終点をCanvas選択中心で案内する。AdvancedなIRI/Turtleは露出せず、主操作後の別承認を要求しない |
| P1-42 | ピザ注文・配送のsemantic seedと参照図layout評価 | RDF/RDFS profile、mock、cloud seed、layout quality | 添付図を外観の座標写経ではなく、顧客・店員・調理・配達の領域、注文から完了までのprocess、問い合わせbranch、注文/問い合わせ内容/ピザ/料金/領収書messageをlabel/comment付きTurtleで表す。mockとkuroxiom-cloud初期workspaceに同じsemantic sourceを置き、初期view overlayへ個別geometry/manual routeを持たせず自動projection/layout結果を表示する。実browser screenshotを添付図と比較し、lane階層、左から右の主フロー、branch/merge、producer/resource/consumer 3者の縦message列、終了位置、交差・重なり・余白を100点rubricで評価して調整する。BPMN固有icon、字体、色のpixel一致はcatalog差として構造・geometry評価から分離する |

## P2 — Cloud・LLM・運用

| ID | 項目 | 依存 | 完了条件 |
|---|---|---|---|
| P2-01 | authoring profile/vocabulary resolver | P0-01、P0-05 | versioned profileとvocabulary indexを解決し、known class/predicate、resource namespace、actor policyを決定的に取得できる |
| P2-02 | controlled LLM semantic adapter | P0-08、P1-05、P2-01 | Turtle、許可語彙、revisionを入力し、unknown term、term minting、namespace、構造を検証して失敗時rollbackする |
| P2-03 | 表示要求分類とprofile-guided rewrite | P0-08、P2-02 | presentation要求はoverlayへ送り、意味構造を伴う要求だけをprojection capability summary付きでrewriteし、再投影結果を検証する |
| P2-05 | catalog/vocabulary/asset registry adapter | P0-05、P0-09、P2-01 | tenant/organization固有URIを認証付き取得先へ解決し、cache/integrityを検証する |
| P2-06 | semantic diffとpresentation diff | P0-08 | review画面でTurtle変更とoverlay変更を別々に説明・承認できる |
| P2-07 | import/export adapter | P0-01、P1-04 | plain Turtle、JSON-LD、必要な外部図形式との変換でloss reportを返す |
| P2-08 | LLM tool transport adapter | semantic-access、P2-01、P2-02 | search、describe、subgraph、membership、alias-based writeをMCP等から提供し、認証主体、authoring profile、revision conflict、監査情報をhost境界で接続する |

## P3 — 表現拡張

| ID | 項目 | 依存 | 完了条件 |
|---|---|---|---|
| P3-01 | annotation primitiveとliteral property投影 | P0-04、P0-07 | semantic resource、literal property、view-only注記のidentityと保存境界を定義する |
| P3-02 | portとrole付き接続 | P1-03、P1-04 | source/target roleをcatalog宣言し、task入出力やER図の接続点を表現できる |
| P3-03 | 折り畳み・subgraph・階層navigation | P1-06、P1-08 | 大規模意味グラフをidentityを失わず段階表示できる |
| P3-04 | profile catalog群 | P0-10 | BPMN-like、PROV-O、SKOS、architecture等をcore分岐なしの独立catalogとして配布できる |

## MVP判定

P0と現在のP1を満たした状態を最初の実用MVPとします。現時点で未実装P1はありません。P2はcloud/LLM/運用の次段階としてcore/editorのMVP判定と分けます。P1項目が完了したら表へ完了行を残さず、基準点と規範文書へ結果を統合します。
