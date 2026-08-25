# バックログ

この文書は未実装事項を優先順位、依存、完了条件で管理します。細かな完了ログは残しません。実装、component/E2E test、mock確認まで完了した項目は表へ完了印を残さず削除し、再利用する契約だけを「現在の基準点」と各設計文書へ要約します。

## 現在の基準点

Document/catalogのruntime schema、RDF/RDFS標準catalogと汎用operator、限定RDFS closure、決定的rule・catalog解決、stable identityとcompact serializer、非同期layout adapter、全named viewのdisplay reconciliation、workspace assetの非同期picker/resolverと安全policyまでがcoreからVue editorとlocal mockへ接続されています。標準catalogは既存互換のfullに加え、語彙定義を抑止する`instance-flow`とclass membershipだけを領域表示する`classification-region`を同じbase rule/templateから提供し、view profileで意味正本を変えず投影目的を選べます。Host注入のengine-independent semantic validation portは全semantic write入口で共有され、domain diagnosticのScene/source対応、candidate rollback、warning確認、abort/stale抑止を備えます。Named viewは統一ViewCommandで追加・複製・設定・削除・overlay resetでき、active viewとselection/viewport/temporary hideはview別sessionとしてdocumentから分離されています。

Vue editorはlabel-firstのdetails、semantic Preview/Apply、Canvasからのresource選択、分類/包含batch、Seq/Alt編集を共通authoring transactionへ接続しています。Seqは通常edgeでなく薄い順序付きgroup、headerに一度だけ出す名称、memberのordinal badgeとして表示し、`rdf:_n`由来の偽edgeを生成しません。AltからSeqへのbranchも先頭memberでなくgroup境界へ無名で接続し、正本は標準`rdf:Seq`/`rdf:_n`のまま維持します。複数・複数行のlabel/commentを保持し、commentはhoverまたは全表示でき、非表示時もlayoutが表示領域を予約します。

通常操作でTurtleやIRIを入力させず、意味編集は右Inspectorの4 actionから段階入力し、新規要素はlabel一項目とhost allocatorのopaque IRIだけで作成します。`意味`/`ビュー`は排他tabとし、右clickは`ビュー`だけを開きます。関係候補は日本語category別に`A（predicate label）B`という候補名と自然なA/B例文を併記し、確定edgeへA/Bを保存しません。要素の種類と業務上の領域所属は別sectionとし、選択nodeの入出力関係、選択edgeの始点・関係・終点を近傍一覧で確認できます。Writableなdirect edgeを選択して別nodeへ端点をdropすると、事前のintent選択がなくても`関係を変更する`draftを開始します。Previewと明示適用までTurtleは変更せず、未接続状態は保存しません。未適用draftは「意味を入力中」と表示し、host未保存の「未保存」と区別して保存時に確認箇所へfocusします。

色、透明度、線、style presetは安全なsparse appearance overlayとして保持でき、edge接点はnode外側のhaloとstubから周囲を連続的に調整できます。`auto`、中間点なしの`straight`/`curve`、直交`orthogonal`、手動経路点を排他的に切り替え、terminal、caption、region label/z-order、8-handle resizeを同じビューInspectorから編集できます。Templateは実shape/style/iconのpreviewから選び、package同梱のlicense明示済みSVGまたはhost注入workspace pathを安定asset IRIへ変換してiconに使えます。Node内のlabel/iconは個別dragでき、相対offsetだけをsparse overlayへ保持します。

Semantic object本体は選択中も`region/Seq < edge < node`の固定層を越えず、waypoint、endpoint halo、resize handle等の操作部品だけを独立した最前面transient層へ描画します。薄い8-unit gridはsnapと同じCanvas座標へ追従するsession-only表示で、document、history、dirty stateへ入りません。Editorはhost幅を押し広げる固定最小幅を持たず、内部scroll、左右sidebar折り畳み、pan、auto-pan、minimapで狭幅でも全要素へ到達できます。標準layoutとoptional ELK adapter、route refinementは分離し、共通のcompletion・品質検査と明示fallback policyを通します。通常UIの技術識別子と英語状態名は日本語の目的表示または「技術情報」へ整理されています。

単一parentのnode-linkと、多対多membershipを交差する半透明領域として示すregion viewは別の空間文法として実装済みです。Domain membership predicateは限定RDFSの`subPropertyOf rdfs:member`で包含へ投影しつつ、元statement/predicateを逆編集用provenanceに保持します。`rdfs:Class`と`rdf:type`はregion profileで独立概念領域と多対多membershipへ投影し、交差cellを新しいsemantic resourceにせず導出します。Region/memberの全bounds containment、resize/drag、label、z-orderは共通制約を通し、複数regionのmemberをintersection外へ出すgeometry変更をcommitしません。

`@iriograph/semantic-access`はlabel/comment中心の検索、describe、neighbor、subgraph、membership索引、revisionに束縛した決定的alias、Core authoring transactionへ委譲するwrite facadeを提供します。これはLLM tool transportそのものではなく、host/MCP adapterが認証、actor policy、revision conflictを接続するためのpackage境界です。標準predicate IRIへ日本語label、説明、category、例を付けるpicker catalogも持ち、日本語独自IRIを生成しません。Instanceのopaque IRIと、統制されたclass/predicate vocabularyをS/P/O上の位置ではなく役割で区別します。

Predicate全体の説明と個別edgeの説明は分離されています。個別説明はexact S/P/Oに対するRDF標準reificationと`rdfs:comment`としてTurtleへ保存し、Scene、関係編集、semantic-accessの検索・subgraphへ伝播します。ビュー専用captionは`ビュー上の補足`としてoverlayだけに保持します。

Core/editorは0.5.0の配布contract、tarball consumer検証、component/Playwright回帰testを持ち、keyboard、multi-selection、整列、snap、manual routing、外側endpoint anchor、parallel edge、self-loopを接続済みです。Optional ELK adapter、固定normal/stress Core性能gate、実Chromium pan/drag gateも独立package/CI jobとして用意されています。現行P1のinteraction usability gateを満たしていますが、APIはまだ安定版としません。

kuroxiom-cloudのhost adapterは実装・deploy済みです。workspaceの`.iriograph` load/save、permission/revision境界、pending edit flush、binary workspace assetの分離保存を接続しています。

Local mockは[rdf-rdfs-profile.md](./rdf-rdfs-profile.md)に従う購入承認例です。意味を名前へ埋め込まないopaque寄りIRI、label/comment付きpredicate、Bag、Seq、Alt、seeAlso、標準包含を特殊化したdomain predicate、二領域に属する共有memberを含み、通常のnode/edgeと重なり領域を一つのregion viewで表示します。Node-link viewは既存documentと明示追加の互換機能として維持します。Workspace treeの画像asset IRIをicon overlayから参照する例も維持します。Domain catalogは標準構造を置き換えず、標準catalogと決定的に結合します。

## 優先度

- P0: package contractを確定し、他hostが安全に試用する前に必要
- P1: 最初の実用MVPに必要
- P2: kuroxiom-cloud・LLM連携と運用に必要
- P3: 利用領域を広げる拡張

## P1 — Editor interaction refinement

| ID | 項目 | 依存 | 完了条件 |
|---|---|---|---|
| P1-25 | host埋込み時のresponsive Canvas・grid・pan | Vue editor、host integration | mockとkuroxiom-cloudの通常幅・狭幅で薄いgridがCanvas全域に表示される。Editor自身の固定最小幅でhostを切らず、左右sidebarを含む編集領域を縮小・折り畳み・scrollできる。scene端へdragした場合のauto-panとminimap/scrollbarで全要素へ到達でき、初期fit後にregion labelやresize handleが見切れない |
| P1-29 | 型と所属の分離・host CSS隔離 | SemanticIntentPanel、region membership | 要素のRDF typeは「要素の種類」、region membershipは「所属する領域」として別step/sectionへ分け、実region名を種類checkboxへ混在させない。package CSSがhostのglobal `fieldset`/form styleをresetし、意図したcard/groupだけを専用classで囲う。mockとcloudで同じ外観になる |
| P1-32 | mock/cloud横断の探索的usability audit | P1-20〜P1-31 | Chromiumでmockとkuroxiom-cloud埋込みを通常幅・狭幅・sidebar折り畳み状態で操作し、4つの意味intent、全route、重なり、Seq、icon/template、drag、resize、scroll/pan、keyboard/focus、error guidanceを確認する。console/page/request errorを0件にし、発見した再現可能な使いにくさを本表へ完了条件付きで追加してから修正・E2E化する |

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

P0と現在のP1を満たした状態を最初の実用MVPとします。残るP1は公開packageを使うkuroxiom-cloudでの埋込み確認だけです。P2はcloud導入のrelease gateとしてcore/editorのMVP判定と分けます。P1項目が完了したら表へ完了行を残さず、基準点と規範文書へ結果を統合します。
