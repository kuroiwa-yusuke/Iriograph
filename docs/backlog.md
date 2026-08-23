# バックログ

この文書は未実装事項を優先順位、依存、完了条件で管理します。細かな完了ログは残しません。

## 現在の基準点

Document/catalogのruntime schema、RDF/RDFS標準catalogと汎用operator、限定RDFS closure、決定的rule・catalog解決、stable identityとcompact serializer、非同期layout adapter、全named viewのdisplay reconciliation、workspace assetの非同期picker/resolverと安全policyまでがcoreからVue editorとlocal mockへ接続されています。Host注入のengine-independent semantic validation portは全semantic write入口で共有され、domain diagnosticのScene/source対応、candidate rollback、warning確認、abort/stale抑止を備えます。Named viewは統一ViewCommandで追加・複製・設定・削除・overlay resetでき、active viewとselection/viewport/temporary hideはview別sessionとしてdocumentから分離されています。

Vue editorは右クリックの対象別操作、見た目を確認できる作成palette、label-firstのdetails dialog、関係削除draft、Canvasからの関係・包含対象選択を備え、利用者がTurtleやIRIを通常操作で入力しない境界を基準にします。色、透明度、線、style presetは安全なsparse appearance overlayとして編集し、edge接点はnode外側のhaloとstubから周囲を連続的に調整できます。単一parentのnode-linkと、多対多membershipを交差する半透明領域として示すregion viewは別の空間文法として実装済みです。Domain membership predicateは限定RDFSの`subPropertyOf rdfs:member`で包含へ投影しつつ、元statement/predicateを逆編集用provenanceに保持します。

`@iriograph/semantic-access`はlabel/comment中心の検索、describe、neighbor、subgraph、membership索引、revisionに束縛した決定的alias、Core authoring transactionへ委譲するwrite facadeを提供します。これはLLM tool transportそのものではなく、host/MCP adapterが認証、actor policy、revision conflictを接続するためのpackage境界です。Core/editorは0.1.1の配布contract、tarball consumer検証、component/Playwright回帰testを持ち、keyboard、multi-selection、整列、snap、manual routing、外側endpoint anchor、parallel edge、self-loopを接続済みです。Optional ELK adapter、固定normal/stress Core性能gate、実Chromium pan/drag gateも独立package/CI jobとして用意されています。P0/P1のMVP gateは満たしていますが、API安定版ではありません。

kuroxiom-cloudのhost adapterは実装・deploy済みです。workspaceの`.iriograph` load/save、permission/revision境界、pending edit flush、binary workspace assetの分離保存を接続しています。

Local mockは[rdf-rdfs-profile.md](./rdf-rdfs-profile.md)に従う購入承認例です。意味を名前へ埋め込まないopaque寄りIRI、label/comment付きpredicate、Bag、Seq、Alt、seeAlso、標準包含を特殊化したdomain predicate、二領域に属する共有memberを含み、同じ意味graphをnode-link viewとregion viewで切り替えられます。Workspace treeの画像asset IRIをicon overlayから参照する例も維持します。Domain catalogは標準構造を置き換えず、標準catalogと決定的に結合します。

## 優先度

- P0: package contractを確定し、他hostが安全に試用する前に必要
- P1: 最初の実用MVPに必要
- P2: kuroxiom-cloud・LLM連携と運用に必要
- P3: 利用領域を広げる拡張

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

P0とP1を満たした状態を最初の実用MVPとします。P2はcloud導入のrelease gateであり、core/editorのMVP判定とは分けます。
