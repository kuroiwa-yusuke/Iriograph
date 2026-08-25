# Iriograph

Iriographは、意味グラフをTurtleで保持し、RDF/RDFSを基底にしたcatalog規則から編集可能な図へ投影するpackageです。
意味の正本と表示調整を分離したまま、業務フロー、関係図、アイコンを含むリッチな図を扱います。

このrepositoryには、フレームワーク非依存のcore、意味検索・安全な書込wrapper、任意導入のELK layout adapter、埋め込み用Vue editor、local mock hostがあります。

## Local mock

Node.js 22以降を利用する場合:

```sh
npm install
npm run dev
```

Dockerを利用する場合:

```sh
docker compose up --build
```

ブラウザで `http://localhost:5173` を開きます。mock hostは
`apps/mock/public/workspace`にある実際の`.iriograph`と画像assetをtree表示し、
編集内容はbrowserのpath別working copyへ保存します。初期ファイルは、表示座標を写経せず
semantic Turtleと空のview overlayから自動配置するピザ注文・配送フローです。検証一式は次で実行できます。

```sh
npm run verify
```

## Package境界

- `@iriograph/core`: document model、Turtle parse、catalog投影、actor別controlled source write、検証、display reconciliation、内部のsemantic command prepare/apply
- `@iriograph/semantic-access`: label/comment検索、describe・近傍/subgraph、revision alias、Core commandへの安全なwrite bridge
- `@iriograph/layout-elk`: compound graph、port、直交routingを扱う任意導入のELK Layered adapter。Worker engineをhostから注入可能
- `@iriograph/vue-editor`: 表示overlayと意味グラフを分離し、Canvas選択中心の意味編集と右Inspector内の直接確定ビュー編集を提供する埋め込みVue component
- `@iriograph/mock`: localStorage、workspace asset、static authoring context/IRI allocatorを接続したlocal host例

`@iriograph/vue-editor`はworkspace、HTTP、認証、永続化を知りません。hostは`v-model`でdocumentを受け取り、`save` eventを任意の保存APIへ接続します。

詳細は[設計文書](./docs/README.md)、[RDF/RDFSベースプロファイル仕様](./docs/rdf-rdfs-profile.md)、[Semantic Authoring Profile仕様](./docs/authoring-profile.md)、[layout最適化方針](./docs/layout-optimization.md)、[バックログ](./docs/backlog.md)を参照してください。
