# Iriograph設計文書

Iriographの目的は、tripleを単にnode-link図へ変換することではなく、意味グラフを業務上読める図として編集・検証・再利用できるようにすることです。

- [theory.md](./theory.md): 設計思想と技術選択の判断基準
- [rdf-rdfs-profile.md](./rdf-rdfs-profile.md): RDF/RDFSベース語彙、構造制約、catalog bindingのv1規範仕様
- [authoring-profile.md](./authoring-profile.md): 人間・LLMの語彙統制と表示要求からのsemantic rewrite仕様
- [interface.md](./interface.md): document、catalog、Scene、editorの公開契約
- [implementation.md](./implementation.md): package境界と処理構成
- [distribution.md](./distribution.md): package配布contractとSemVer方針
- [backlog.md](./backlog.md): 未実装事項の優先順位、依存、完了条件

設計判断は`theory.md`、semantic構造と投影規則は`rdf-rdfs-profile.md`、semantic write policyは`authoring-profile.md`を正本とします。型定義は`packages/core/src/model.ts`、RDF/RDFS標準catalogは`packages/core/src/standard-catalog.ts`、domain appearanceの実例は`apps/mock/src/mock/catalog.json`にあります。
