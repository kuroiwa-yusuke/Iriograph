# Iriograph documentation

[English documentation](../docs/README.md)

文書は、最初に読む設計、正確な仕様、Editor、host統合、開発記録を分けています。通常は次の順で十分です。

1. [設計原則](./architecture/principles.md) — Iriographが解く問題と、意味・表示・layoutの境界
2. [Package・実装構成](./architecture/packages.md) — 11 packageの責務と処理pipeline
3. [RDF/RDFS profile](./semantics/rdf-profile.md) — 意味graph、標準語彙、catalog binding
4. [Editor操作](./editor/interactions.md) — 利用者向け編集flow
5. [Host conformance](./integration/host-conformance.md) — Mockとproduct hostで同じ機能を保つgate

## 正本

### Architecture

- [設計原則](./architecture/principles.md)
- [Package・実装構成](./architecture/packages.md)
- [公開契約](./architecture/public-contracts.md)

### Semantics

- [RDF/RDFS profile](./semantics/rdf-profile.md)
- [Authoring profile](./semantics/authoring-profile.md)
- [意味と表示notation](./semantics/notation.md)
- [Semantic validation](./semantics/validation.md)
- [RDF import / export](./semantics/rdf-io.md)

### Editor and layout

- [Editor操作](./editor/interactions.md)
- [Named view](./editor/views.md)
- [Accessibility](./editor/accessibility.md)
- [空間membership](./editor/spatial-membership.md)
- [Layout・routing・性能](./editor/layout.md)

### Integration and distribution

- [Semantic Access](./integration/semantic-access.md)
- [Agent・host連携](./integration/agents.md)
- [Domain profile・vendor catalog](./integration/domain-profiles.md)
- [Host conformance](./integration/host-conformance.md)
- [Package配布・version](./integration/distribution.md)

## Development records

- [開発・検証](./development/testing.md) — 現在のcommand、gate、test配置規則
- [評価履歴](./evaluations/reference-reconstruction.md) — 参照画像・agent実験・過去実測。現行仕様の正本ではありません
- [バックログ](./backlog.md) — 未実装項目だけを管理します

設計原則の正本は`architecture/principles.md`、意味構造は`semantics/rdf-profile.md`、semantic write policyは`semantics/authoring-profile.md`です。TypeScriptの型とruntime schemaがAPI形状の実行可能な正本であり、`architecture/public-contracts.md`はその読み方と不変条件を説明します。
