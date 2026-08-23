# Repository Instructions

Iriographは、Turtleで保持する意味グラフをcatalog規則で表示Sceneへ投影し、
最小のview overlayをWYSIWYG編集するpackageです。

## 責務境界

- `semantic.source`は意味情報の正本とする。座標、色、icon、viewportを混ぜない。
- ベースsemantic profileは`docs/rdf-rdfs-profile.md`を正本とし、包含、順序、選択、参照には定義済みのRDF/RDFS語彙を優先する。
- Catalogは意味から構造的な表示primitiveへの宣言的な写像を持つ。
- Sceneの構造名は`node`、`edge`、`container`、`annotation`など表示・編集上の性質で付ける。
- View overlayはgeometry、pin、manual routeなど、catalogから復元できない表示情報だけを持つ。
- Vue、DOM、workspace、HTTP、権限をcoreへ入れない。
- Asset URIは識別子であり、取得URLと同一視しない。取得は注入resolverへ委譲する。
- ResourceのidentityにlabelやTurtleの行番号を使わない。IRIを優先する。
- LLMへはsemantic Turtleだけを公開し、view overlayを編集対象にしない。

## 拡張規則

- 業務classやpredicateごとの分岐をrendererやprojection処理へ直書きしない。
- 標準語彙で表せる意味にIriograph固有のsemantic語彙を追加しない。
- domain固有語彙が必要な場合は利用domainのnamespaceで自己記述し、template、icon、projection bindingをcatalog正本へ追加する。
- `rdfs:label`の文字列をclass、構造、rule matchingに使わない。
- 未登録のIRI-object tripleは、core fallbackで通常矢印として表示できる状態を保つ。
- Catalog ruleの競合を登録順で解決しない。priorityとspecificityを決定的に検証する。
- 新しい領域ではなく新しい空間文法が必要な場合だけScene primitiveまたはView kindを拡張する。

## 編集規則

- Semantic transactionとPresentation transactionを分ける。
- Drag、resize、waypoint変更はTurtleを変更しない。
- Semantic変更後は、存続IRIのoverlayを維持してdisplay reconciliationを行う。
- 生成可能なstyleやicon定義をdocumentへ複製しない。
- 保存schema変更にはversion方針とtestを伴わせる。

## 文書

- `docs/theory.md`: 設計思想と判断基準。
- `docs/rdf-rdfs-profile.md`: semantic base vocabulary、構造制約、catalog bindingの規範仕様。
- `docs/interface.md`: document、catalog、Sceneの公開契約。
- `docs/implementation.md`: package境界と投影処理。
- `docs/backlog.md`: 未実装事項、優先度、依存、完了条件。

バックログを完了ログにせず、細かな試行錯誤は設計文書へ残さない。

## 開発・完了手順

修正は次の順序で進める。途中のtest成功だけで完了扱いにせず、local起動とremoteへのpushまでを一連の完了条件とする。

1. 変更対象の責務と正本を確認し、必要なら関連する設計文書とバックログを先に読む。
2. 実装と、それに対応するtest・設計文書・バックログを更新する。
3. `npm run verify`でtest、typecheck、core/editor/mockのbuildをすべて通す。
   hostにNode.jsがない場合は、repositoryをmountしたNode.js Docker imageで同じcommandを実行する。
4. `docker compose up -d --build`で最新sourceからlocal mockを実際に起動し、HTTP応答を確認する。
   UIまたは操作を変更した場合は、対象画面をbrowserで開き、変更操作と隣接操作、console errorを確認する。
5. `git status`とdiffを確認し、今回の変更だけをcommitする。ユーザーの未commit変更や無関係な変更を混ぜない。
6. 通常のpushを現在のbranchへ行い、remoteへ反映されたこととworktreeの状態を確認する。

- force push、履歴改変、破壊的なgit操作は行わない。
- 起動、検証、commit、pushのいずれかに失敗した場合は完了と報告せず、原因を修正して再実行する。
- 外部要因でpushできない場合は、未pushのcommitと阻害要因を明示する。
- local mockは次の開発確認に使えるよう、特段の理由がなければ起動状態で引き渡す。
