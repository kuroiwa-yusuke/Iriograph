# Iriograph

Iriographは、意味グラフをTurtleで保持し、RDF/RDFSを基底にしたcatalog規則から編集可能な図へ投影するpackageです。
意味の正本と表示調整を分離したまま、業務フロー、関係図、アイコンを含むリッチな図を扱います。

このrepositoryには、フレームワーク非依存のcore、埋め込み用Vue editor、local mock hostがあります。

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

ブラウザで `http://localhost:5173` を開きます。検証一式は次で実行できます。

```sh
npm run verify
```

## Package境界

- `@iriograph/core`: document model、Turtle parse、catalog投影、検証、display reconciliation
- `@iriograph/vue-editor`: hostの編集領域へ埋め込むVue component
- `@iriograph/mock`: localStorageを保存先にしたlocal host例

`@iriograph/vue-editor`はworkspace、HTTP、認証、永続化を知りません。hostは`v-model`でdocumentを受け取り、`save` eventを任意の保存APIへ接続します。

詳細は[設計文書](./docs/README.md)、[RDF/RDFSベースプロファイル仕様](./docs/rdf-rdfs-profile.md)、[Semantic Authoring Profile仕様](./docs/authoring-profile.md)、[バックログ](./docs/backlog.md)を参照してください。
