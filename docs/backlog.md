# バックログ

この文書は未実装事項を優先順位、依存、完了条件で管理します。細かな完了ログは残しません。

## 現在の基準点

coreからSceneへの縦切り、埋め込み用Vue editor、local mock hostがあり、意味編集と表示編集のtransactionは分離されています。これはAPI安定版ではなく、保存schema、catalog rule解決、layout、host統合を検証するための基準実装です。

意味層のv1 targetは[rdf-rdfs-profile.md](./rdf-rdfs-profile.md)で確定しています。現在のmockは独自`wf`相当語彙を使う移行前prototypeであり、P0-01〜04が完了するまでprofile適合例とはみなしません。

## 優先度

- P0: package contractを確定し、他hostが安全に試用する前に必要
- P1: 最初の実用MVPに必要
- P2: kuroxiom-cloud・LLM連携と運用に必要
- P3: 利用領域を広げる拡張

## P0 — Contractと決定性

| ID | 項目 | 依存 | 完了条件 |
|---|---|---|---|
| P0-01 | Documentと正規化catalogのJSON Schema/runtime validation | 規範仕様、現行TypeScript model | `authoringProfileRef`を含む必須値、不明field方針、IRI、version、operator別parameterを検証し、invalid fixtureのtestがある |
| P0-02 | 汎用projection operatorとRDF/RDFS標準catalog | P0-01 | `membership-container`、`ordinal-sequence`、`alternative`、`direct-edge`、`suppress`を業務IRI分岐なしで実装し、mock Turtleから独自workflow構造語彙を除去する |
| P0-03 | RDF/RDFS profile構造validation | P0-01、P0-02 | named IRI、Bag parent、container cycle、Seq/Altの連番・個数・重複型をvalid/invalid fixtureで検証する |
| P0-04 | 限定RDFS closureとrule競合解決 | P0-01、P0-02 | `subClassOf`/`subPropertyOf`の推移閉包、priority、specificityを登録順非依存で解決し、同順位競合を投影前errorにする |
| P0-05 | catalog import・version・integrity解決contract | P0-01、P0-04 | host resolver I/F、重複catalog、version不一致、取得失敗のdiagnosticが決定的になる |
| P0-06 | stable resource/triple/derived-edge identity | P0-01、P0-02 | Turtle再整形後の直接triple、Seq transition、Alt branchとnamed resourceでoverlay照合testが通る |
| P0-07 | 決定的layout engine v1 | P0-02、P0-06 | node-link、階層LR/TB、Bag container、pinned nodeを扱い、同一入力から同一座標を得る |
| P0-08 | 正式display reconciliation | P0-04、P0-06、P0-07 | 追加・削除・type変更・containment・sequence変更で全viewをそれぞれのprofile/layoutから再投影する。存続user overlayを互換な範囲で維持し、新規geometryにgenerated provenanceを付け、catalog由来appearanceを複製しないfixture testが通る |
| P0-09 | workspace asset picker、resolver、安全policy contract | P0-01 | documentは安定asset IRIだけを保持し、host注入の選択UIと非同期resolverでworkspace assetを表示できる。未解決fallback、移動・削除diagnostic、media type・容量、許可scheme/origin、Blob URL lifecycleをtestし、mockのtreeにcatalog外assetの縦切りがある |
| P0-10 | package配布contract | P0-01〜09 | coreとVue editorのexports、CSS、peer dependency、semver方針を定め、別fixture appでbuildできる |
| P0-11 | editor操作の回帰test基盤 | P0-10 | drag、resize、routing、undo/redo、Turtle適用、保存flushをcomponent/E2E testで検証する |

## P1 — 実用MVP

| ID | 項目 | 依存 | 完了条件 |
|---|---|---|---|
| P1-01 | pan、fit、minimap、選択への移動 | P0-07、P0-11 | 大きい図をmouse/keyboardで移動でき、選択elementをviewportへ表示できる |
| P1-02 | multi-select、整列、等間隔、snap | P0-11 | 一括移動を一transactionでundoでき、container境界を破らない |
| P1-03 | edge routing編集の完成 | P0-07、P0-11 | waypoint追加・削除、label位置、self-loop、parallel edgeを編集・保存できる |
| P1-04 | human semantic authoring commands | P0-06、P0-08 | actor=`human`でprofile/hostから安全に採番したnamed IRIと初期tripleが必須のnode作成、literal/IRI属性編集、predicate必須の直接edgeまたはcapability graph patch、明示的なcontainment/sequence/alternativeをTurtle graph transactionとして編集できる。仮nodeと暗黙generic predicateを保存せず、dragはmembershipを変更しない。Unknown term warning、derived edge/所属のprovenanceからの逆編集、Turtle直接編集と共通validation/reconciliation、作成位置を含むatomic undo/rollbackをcomponent/E2E testする |
| P1-05 | SHACL等のsemantic validation port | P0-01 | syntax errorとdomain constraintを分け、semanticRef付きdiagnosticをSceneとsourceへ対応付ける |
| P1-06 | 複数view、locale、filterとview管理 | P0-08 | 同じTurtleに異なるprofile/layout/locale/filter/overlayを追加・複製・削除できる |
| P1-07 | accessibilityとkeyboard編集 | P0-11、P1-01〜03 | focus順、選択、移動、resize、routingの主要操作をkeyboardで完結できる |
| P1-08 | 大規模graph性能基準 | P0-07 | 目標node/edge数を定め、投影・layout・操作応答のbenchmarkをCIで監視する |

## P2 — Cloud・LLM・運用

| ID | 項目 | 依存 | 完了条件 |
|---|---|---|---|
| P2-01 | authoring profile/vocabulary resolver | P0-01、P0-05 | versioned profileとvocabulary indexを解決し、known class/predicate、resource namespace、actor policyを決定的に取得できる |
| P2-02 | controlled LLM semantic adapter | P0-08、P1-05、P2-01 | Turtle、許可語彙、revisionを入力し、unknown term、term minting、namespace、構造を検証して失敗時rollbackする |
| P2-03 | 表示要求分類とprofile-guided rewrite | P0-08、P2-02 | presentation要求はoverlayへ送り、意味構造を伴う要求だけをprojection capability summary付きでrewriteし、再投影結果を検証する |
| P2-04 | kuroxiom-cloud host adapter | P0-10、P2-02 | workspace fileのload/save、revision conflict、権限、agent変更後reloadをeditor外で接続する |
| P2-05 | catalog/vocabulary/asset registry adapter | P0-05、P0-09、P2-01 | tenant/organization固有URIを認証付き取得先へ解決し、cache/integrityを検証する |
| P2-06 | semantic diffとpresentation diff | P0-08 | review画面でTurtle変更とoverlay変更を別々に説明・承認できる |
| P2-07 | import/export adapter | P0-01、P1-04 | plain Turtle、JSON-LD、必要な外部図形式との変換でloss reportを返す |

## P3 — 表現拡張

| ID | 項目 | 依存 | 完了条件 |
|---|---|---|---|
| P3-01 | annotation primitiveとliteral property投影 | P0-04、P0-07 | semantic resource、literal property、view-only注記のidentityと保存境界を定義する |
| P3-02 | portとrole付き接続 | P1-03、P1-04 | source/target roleをcatalog宣言し、task入出力やER図の接続点を表現できる |
| P3-03 | 折り畳み・subgraph・階層navigation | P1-06、P1-08 | 大規模意味グラフをidentityを失わず段階表示できる |
| P3-04 | profile catalog群 | P0-10 | BPMN-like、PROV-O、SKOS、architecture等をcore分岐なしの独立catalogとして配布できる |

## MVP判定

P0をすべて満たし、P1-01〜05とP1-07を満たした時点を最初の実用MVPとします。P2はcloud導入のrelease gateであり、core/editorのMVP判定とは分けます。
