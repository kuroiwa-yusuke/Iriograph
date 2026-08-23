# Named view管理

この文書は、同一semantic graphに対するnamed viewの保存・編集・session境界を定めます。

## 保存契約

`views[]`は同じ`semantic.source`を異なる`profileRef`、`layoutRef`、`locale`、sparse
`overlay`で表示するnamed viewです。`viewId`はdocument内で一意なimmutable identityです。
既存viewのrename commandは提供しません。新規作成と複製は新しい`viewId`を割り当てます。

Coreの統一`ViewCommand`は次のclosed vocabularyだけを持ちます。

- `add`: profile、layout、任意localeから空overlayを投影・layoutしてviewを追加する
- `duplicate`: 元viewの設定とoverlayをexact cloneし、新しいviewIdを割り当てる
- `configure`: viewIdを維持し、profile、layout、localeだけを変更する
- `delete`: 対象viewを削除する。最後の1 viewは削除できない
- `reset-overlay`: 対象viewのuser overlayを破棄し、semantic graphとcatalogから再生成する

`applyViewCommand(document, command, runtime, options)`はpresentation-only atomic transactionです。
失敗時は元documentを返し、成功時だけcandidate documentを返します。追加、profile/layout設定、
resetは対象viewだけをprojection/reconciliation/layoutし、無関係なviewを再生成しません。
localeだけの変更とduplicateではoverlayをbyte-equivalentなJSON値として維持します。
壊れたviewもdeleteでき、他viewの不正状態はdeleteを妨げません。

Semantic transactionはこの最適化を使わず、従来どおり全viewを一つのatomic transactionとして
再投影・検証します。一つでも失敗すればTurtleと全overlayをrollbackします。

## Active viewとsession

Active viewはportable documentへ保存しません。Vue editorは`activeViewId` /
`update:activeViewId`のcontrolled contractを提供し、prop省略時は内部sessionで管理します。
指定IDが存在しなければdocument先頭viewへfallbackします。

Editor sessionはviewIdごとに次を保持します。

- selection集合とprimary selection
- zoom、scrollLeft、scrollTopからなるviewport
- 一時非表示にしたexact Scene element ID集合

これらは`v-model`、overlay、undo/redo history、dirty stateへ入りません。一時hideは指定した
exact IDだけを起点とし、containerの場合だけ全structural descendantを閉包に含めます。その後、
非表示geometryへ接続するedgeと明示指定edgeだけをScene cloneから除きます。Semantic graphを跨いだ
新しいedgeを生成しません。

## 制限

v1はviewごとのSPARQL、filter DSL、predicate条件式、非表示nodeを跨ぐedge再接続を持ちません。
表示構造の違いはcatalog profileで宣言し、個別要素の表示調整はoverlay、一時的な絞り込みは
session-only hideで扱います。Structured authoringの構造候補と初期位置はactive viewの
profile/catalog/viewIdへbindします。
