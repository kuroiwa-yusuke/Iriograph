# バックログ

この文書は未実装事項を優先順位、依存、完了条件で管理します。細かな完了ログは残しません。

## 現在の基準点

Document/catalogのruntime schema、RDF/RDFS標準catalogと汎用operator、限定RDFS closure、決定的rule・catalog解決、stable identityとserializer、非同期layout adapter、全named viewのdisplay reconciliation、workspace assetの非同期picker/resolverと安全policyまでがcoreからVue editorとlocal mockへ接続されています。Core/editorは0.1.0の配布contract、tarball consumer検証、editor component回帰testとPlaywright browser smokeを持ち、session-onlyのviewport navigation、multi-selection、境界を守る一括移動、整列、等間隔、grid/target snap、manual edge routing、label位置、parallel edge、self-loopも接続されています。意味編集と表示編集のtransactionは分離されていますが、API安定版ではありません。

Local mockは[rdf-rdfs-profile.md](./rdf-rdfs-profile.md)に従い、Bag、Seq、Alt、seeAlsoを使う購入承認例です。Domain語彙はこれらの標準構造を置き換えずnode等のappearanceを選択し、標準catalogとdefaultsを持たないdomain extension catalogを決定的に結合しています。

## 優先度

- P0: package contractを確定し、他hostが安全に試用する前に必要
- P1: 最初の実用MVPに必要
- P2: kuroxiom-cloud・LLM連携と運用に必要
- P3: 利用領域を広げる拡張

## P1 — 実用MVP

| ID | 項目 | 依存 | 完了条件 |
|---|---|---|---|
| P1-04 | human semantic authoring commands | P0-06、P0-08 | actor=`human`でprofile/hostから安全に採番したnamed IRIと初期tripleが必須のnode作成、literal/IRI属性編集、predicate必須の直接edgeまたはcapability graph patch、明示的なcontainment/sequence/alternative、参照時rejectを既定とするresource削除とpreview付きexplicit cascadeをTurtle graph transactionとして編集できる。Seq/Alt削除はatomicに再採番する。操作はサイドバーdraft→triple/graph patch preview・validation→明示適用とし、canvas gestureはdraftをseedするだけにする。Ghost、仮node、暗黙generic predicateを保存せず、dragはmembershipを変更しない。`ResolvedAuthoringContext`/allocator契約とstatic mock fixtureをP1で用意し、URI resolverはP2-01に残す。Unknown term warning、derived edge/所属のprovenanceからの逆編集、Turtle直接編集と共通validation/reconciliation、作成位置を含むatomic undo/rollbackをcomponent/E2E testする |
| P1-05 | SHACL等のsemantic validation port | P0-01 | syntax errorとdomain constraintを分け、semanticRef付きdiagnosticをSceneとsourceへ対応付ける |
| P1-06 | named view、localeとview管理 | P0-08 | 同じTurtleに異なるprofile/layout/locale/overlayを持つnamed viewを選択・追加・複製・削除でき、view profileが表示構造を選ぶ。SPARQL/汎用filter editorは導入せず、一時hideはsession stateにだけ保持する |
| P1-07 | accessibilityとkeyboard編集 | P0-11、P1-01〜03 | focus順、選択、移動、resize、routingの主要操作をkeyboardで完結できる |
| P1-08 | 大規模graph性能基準 | P0-07 | 通常500 node/1,000 edgeでlayout以外の編集応答100ms未満・pan/drag 30fps以上、stress 2,000 node/4,000 edgeで初回projection+標準layout 2秒未満を暫定基準とし、固定fixtureのbenchmarkをCIで監視する |

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
