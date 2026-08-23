# Iriograph設計文書

Iriographの目的は、tripleを単にnode-link図へ変換することではなく、意味グラフを業務上読める図として編集・検証・再利用できるようにすることです。

- [theory.md](./theory.md): 設計思想と技術選択の判断基準
- [interface.md](./interface.md): document、catalog、Scene、editorの公開契約
- [implementation.md](./implementation.md): package境界と処理構成
- [backlog.md](./backlog.md): 未実装事項の優先順位、依存、完了条件

型定義は`packages/core/src/model.ts`、投影規則の実例は`apps/mock/src/mock/catalog.json`を正本として参照します。
