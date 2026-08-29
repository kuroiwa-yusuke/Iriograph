# バックログ

この文書には未実装項目だけを、優先度、依存、完了条件とともに置きます。完了した項目は再利用する契約を該当する設計文書へ反映してから削除します。過去の性能値、実験結果、長い完了snapshotはここへ残しません。

## 現在の未実装項目

P0〜P3の確定項目は設計正本と回帰testへ移管済みで、現在のactive backlogは空です。Releaseとhost deployの実行結果はbacklogではなく各repositoryのcommit、tag、deploy診断を正本とします。

新しい項目は次の形式で追加します。

| ID | 優先度 | 項目 | 依存 | 完了条件 |
|---|---|---|---|---|

設計判断は[設計原則](./architecture/principles.md)、検証証拠は[開発・検証](./development/testing.md)または[評価履歴](./evaluations/reference-reconstruction.md)へ分離します。
