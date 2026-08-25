# バックログ

この文書は未実装事項を優先順位、依存、完了条件で管理します。細かな完了ログは残しません。実装、component/E2E test、mock確認まで完了した項目は表へ完了印を残さず削除し、再利用する契約だけを「現在の基準点」と各設計文書へ要約します。

## 現在の基準点

Document/catalogのruntime schema、RDF/RDFS標準catalogと汎用operator、限定RDFS closure、決定的rule・catalog解決、stable identityとcompact serializer、非同期layout adapter、全named viewのdisplay reconciliation、workspace assetの非同期picker/resolverと安全policyまでがcoreからVue editorとlocal mockへ接続されています。標準catalogは既存互換のfullに加え、語彙定義を抑止する`instance-flow`とclass membershipだけを領域表示する`classification-region`を同じbase rule/templateから提供し、view profileで意味正本を変えず投影目的を選べます。Host注入のengine-independent semantic validation portは全semantic write入口で共有され、domain diagnosticのScene/source対応、candidate rollback、warning確認、abort/stale抑止を備えます。Named viewは統一ViewCommandで追加・複製・設定・削除・overlay resetでき、active viewとselection/viewport/temporary hideはview別sessionとしてdocumentから分離されています。

Vue editorはlabel-firstのdetails、Canvasからのresource選択、分類/包含batch、Seq/Alt編集を共通authoring transactionへ接続しています。意味InspectorはCanvas選択中心で、常設する作成入口を`要素を追加`と`関係を追加`の2つに限定し、対象固有の詳細・所属・関係編集は選択後だけ段階表示します。非削除の意味操作は一回の実行内でcandidate validationとatomic commitを完了し、別のPreview/Apply画面を要求しません。Seqは通常edgeでなく薄い順序付きgroup、headerに一度だけ出す名称、memberのordinal badgeとして表示し、`rdf:_n`由来の偽edgeを生成しません。AltからSeqへのbranchも先頭memberでなくgroup境界へ無名で接続し、正本は標準`rdf:Seq`/`rdf:_n`のまま維持します。複数・複数行のlabel/commentを保持し、commentはhoverまたは全表示でき、非表示時もlayoutが表示領域を予約します。

通常操作でTurtleやIRIを入力させず、新規要素はlabel一項目とhost allocatorのopaque IRIだけで作成します。`意味`/`ビュー`は排他tabとし、右clickは`ビュー`だけを開きます。関係候補は日本語category別に`A（predicate label）B`という候補名と自然なA/B例文を併記し、確定edgeへA/Bを保存しません。要素の種類と業務上の領域所属は別sectionとし、選択nodeの入出力関係、選択edgeの始点・関係・終点を近傍一覧で確認できます。Writableなdirect edgeの端点を別nodeへdropすると、元statement削除、新statement追加、個別説明移送をその場で一つのsemantic transactionとして検証・確定します。空白dropでは元接続を維持し、未接続状態は保存しません。未実行の段階formだけを「意味を入力中」と表示し、host未保存の「未保存」と区別して保存時に確認箇所へfocusします。

色、透明度、線、style presetは安全なsparse appearance overlayとして保持でき、edge接点はnode外側のhaloとstubから周囲を連続的に調整できます。`auto`、中間点なしの`straight`、直交`orthogonal`、sparse knot/handleを持てる実Bezier `curve`、手動経路点を排他的に切り替え、terminal、caption、region label/z-order、8-handle resizeを同じビューInspectorから編集できます。右Inspector内のinlineビュー編集は別の適用確認を挟まず、選択・preset・resetを即時確定し、連続値だけを入力中previewからchange時の一履歴へまとめます。Templateは実shape/style/iconのpreviewから選び、package同梱のlicense明示済みSVGまたはhost注入workspace pathを安定asset IRIへ変換してiconに使えます。Node内のlabel/iconは個別dragでき、labelは横書きまたは縦書きを選べ、差分だけをsparse overlayへ保持します。

Diamond nodeはgeometry/hit areaを回転せずbackground/border surfaceだけをdiamondとして描画し、横書きと縦書きで入れ替えた内接content boundsへlabel/iconを置きます。Label本文はTurtle、方向とoffsetはappearance overlay、resize後の実占有boundsはgeometryという境界を維持し、component regressionで短文/長文、icon有無、resizeを固定しています。

Semantic object本体は選択中も`region/Seq < edge < node`の固定層を越えず、waypoint、endpoint halo、resize handle等の操作部品だけを独立した最前面transient層へ描画します。薄い8-unit gridはsnapと同じCanvas座標へ追従するsession-only表示で、document、history、dirty stateへ入りません。Canvasは実contentの外周へ初期320 unitのsession作業余白を持ち、drag中は正負方向へ160 unitずつ単調に拡張してdropを要求しません。Seq・region・containerの移動/resizeはmemberの全membership intersectionを制約にします。Editorはhost幅を押し広げる固定最小幅を持たず、compactな右Inspector、内部scroll、左右sidebar折り畳み、pan、auto-pan、minimapで狭幅でも全要素へ到達できます。標準layoutとoptional ELK adapter、route refinementは分離し、生成routeの中間点を最大1個に抑えた共通のcompletion・品質検査を通します。通常UIの技術識別子と英語状態名は日本語の目的表示または「技術情報」へ整理されています。

単一parentのnode-linkと、多対多membershipを交差する半透明領域として示すregion viewは別の空間文法として実装済みです。Domain membership predicateは限定RDFSの`subPropertyOf rdfs:member`で包含へ投影しつつ、元statement/predicateを逆編集用provenanceに保持します。`rdfs:Class`と`rdf:type`はregion profileで独立概念領域と多対多membershipへ投影し、交差cellを新しいsemantic resourceにせず導出します。Region/memberの全bounds containment、resize/drag、label、z-orderは共通制約を通し、複数regionのmemberをintersection外へ出すgeometry変更をcommitしません。

`@iriograph/semantic-access`はlabel/comment中心の検索、describe、neighbor、subgraph、membership索引、revisionに束縛した決定的alias、Core authoring transactionへ委譲するwrite facadeを提供します。これはLLM tool transportそのものではなく、host/MCP adapterが認証、actor policy、revision conflictを接続するためのpackage境界です。標準predicate IRIへ日本語label、説明、category、例を付けるpicker catalogも持ち、日本語独自IRIを生成しません。Instanceのopaque IRIと、統制されたclass/predicate vocabularyをS/P/O上の位置ではなく役割で区別します。

Predicate全体の説明と個別edgeの説明は分離されています。個別説明はexact S/P/Oに対するRDF標準reificationと`rdfs:comment`としてTurtleへ保存し、Scene、関係編集、semantic-accessの検索・subgraphへ伝播します。ビュー専用captionは`ビュー上の補足`としてoverlayだけに保持します。

Core/editorは0.7.0 release candidateの配布contract、tarball consumer検証、component/Playwright回帰testを持ち、keyboard、multi-selection、整列、snap、manual/Bezier routing、外側endpoint anchor、parallel edge、self-loopを接続済みです。Optional ELK adapter、固定normal/stress Core性能gate、実Chromium pan/drag gate、production buildの初期表示・関係transaction gateも独立package/CI jobとして用意されています。APIはまだ安定版としません。

kuroxiom-cloudのhost adapterはworkspaceの`.iriograph` load/save、permission/revision境界、pending edit flush、binary workspace assetの分離保存を接続します。Workspace画像はpath、basename、stable asset IRI、MIMEだけをeditor候補へ渡し、byteと解決URLは認証付きAssetAccess内に留めます。このreleaseでは公開済み0.7.0 exact packageへの更新後に、800px幅を含む実Chromium監査、初期seed、grid、内部scroll、treeと左右sidebarの折り畳み、asset path候補とicon表示をproductionで再確認します。

Local mockの初期ファイルは、顧客、店員、調理担当、配達担当のlaneと、注文から完了までの主フロー、問い合わせbranch/loop、注文・問い合わせ内容・ピザ・料金・領収書のcross-lane連携をlabel/comment付きTurtleで表すピザ注文・配送例です。View overlayは空で、個別座標やmanual routeを保存せず標準projection/layoutだけから初期displayを補完します。Node-link viewは既存documentと明示追加の互換機能として維持します。Workspace treeの別画像asset IRIをicon overlayから参照する例も維持します。標準layoutとoptional ELKの同一入力比較はlayout品質の検証証拠であり、seed IRIやlabelに特化した分岐・adapter選択規則にはしません。

標準layoutのphase/実reroute observer、route state cacheとexact枝刈り、prepared preview/apply、incident-only edge reconciliation、unaffected derived routeのexact固定、full fallback理由のdiagnostic/observerを実装済みです。固定Dockerではpizza/疎small/密smallの初期projection+layout p95が29.5/5.9/140.7 ms、20回warm後20 sampleのrelation追加/predicate変更/endpoint変更Core p95が43.8/41.4/60.0 msです。Pizzaの非endpoint node交差0、共有endpoint除外edge交差5、overlap 0、最大中継点1をgate化しました。Standard/ELK混在view、parallel/self-loop、dense、巨大resize nodeも回帰testに含みます。Production buildの実Chromiumでは、20 sampleのbody受領からpaint settledまでp95 215.4 ms、各20回warm後20 sampleのrelation追加/predicate変更/endpoint変更が78.2/62.3/75.2 msで、asset/FCP/Long Taskと併せて専用gateを通します。

## 優先度

- P0: package contractを確定し、他hostが安全に試用する前に必要
- P1: 最初の実用MVPに必要
- P2: kuroxiom-cloud・LLM連携と運用に必要
- P3: 利用領域を広げる拡張

## P1 — Editor interaction refinement

現在、最初の実用MVPに必要な未実装P1項目はありません。新しい利用者課題は完了ログを増やさず、受入条件を持つ新規行として追加します。

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
| P2-09 | LLM reference-image overlay実験 | P1-43、P1-48、P2-03、P2-06、host image input policy | Reference image、read-only Scene、利用可能template/icon/style/routing capabilityをLLMまたはvision modelへ与え、geometry、size、route、template/icon/styleの閉じたpresentation patchだけを候補生成するhost実験を行う。画像bytesと取得URLはsession入力に留め、portable documentへは検証済みsparse overlayだけを保存し、Turtle、membership、predicate、catalogを変更しない。任意CSS/URL、未登録assetRef、NaN/範囲外geometry、包含違反をrejectし、candidate screenshot、overlay diff、構造score、画像一致score、token/時間を記録する。Pizzaを含む3種類以上の参照図で各3回実行し、構造制約を低下させず画像一致score中央値を自動layout比10点以上改善できるか評価する。未達も測定結果と失敗分類を残せば実験完了とし、seed固有promptや生成overlayをcore/layout既定規則へ昇格しない |

## P3 — 表現拡張

| ID | 項目 | 依存 | 完了条件 |
|---|---|---|---|
| P3-01 | annotation primitiveとliteral property投影 | P0-04、P0-07 | semantic resource、literal property、view-only注記のidentityと保存境界を定義する |
| P3-02 | portとrole付き接続 | P1-03、P1-04 | source/target roleをcatalog宣言し、task入出力やER図の接続点を表現できる |
| P3-03 | 折り畳み・subgraph・階層navigation | P1-06、P1-08 | 大規模意味グラフをidentityを失わず段階表示できる |
| P3-04 | profile catalog群 | P0-10 | BPMN-like、PROV-O、SKOS、architecture等をcore分岐なしの独立catalogとして配布できる |

## MVP判定

P0と現在のP1を満たした状態を最初の実用MVPとします。現在はP1の受入条件と最終検証を満たしており、最初の実用MVPを完了と判定します。P2はcloud/LLM/運用の次段階としてcore/editorのMVP判定と分けます。新しいP1課題が見つかった場合は受入条件を持つ行として追加し、完了後は表へ完了行を残さず、基準点と規範文書へ結果を統合します。
