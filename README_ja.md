# Iriograph

[English](./README.md)

Iriographは、Turtleを意味の正本として保持し、RDF/RDFSを基底にしたcatalog規則から編集可能な業務図・関係図へ投影するpackage群です。座標、色、routing、icon等の表示overlayを意味graphから分離したまま、WYSIWYG編集、検証、再利用、LLM向けのlabel-first索引を提供します。

## Vueへ埋め込む

利用するpackageはexact versionで固定します。

```sh
npm install --save-exact @iriograph/core @iriograph/vue-editor
```

```vue
<script setup lang="ts">
import { ref } from "vue";
import type { IriographDocument, ProjectionRuntimeContext } from "@iriograph/core";
import { IriographEditor } from "@iriograph/vue-editor";
import "@iriograph/vue-editor/styles.css";

const props = defineProps<{
  initialDocument: IriographDocument;
  projectionRuntimeContext: ProjectionRuntimeContext;
}>();
const document = ref(props.initialDocument);
const uiLocale = ref<"en" | "ja">("en");
</script>

<template>
  <IriographEditor
    v-model="document"
    v-model:ui-locale="uiLocale"
    :runtime-context="projectionRuntimeContext"
  />
</template>
```

Editorはworkspace、HTTP、認証、永続化を知りません。Product hostは`v-model`のdocument、認証済みasset resolver、IRI allocator、resolved authoring profile、保存・revision conflictを注入します。

Package UIの既定は英語で、日本語を選択できます。UI言語はHost/session stateでありTurtleやdisplay overlayを変更しません。既存RDF label/commentを選ぶ意味言語の優先順は別に指定できます。

## Packageを選ぶ

| 用途 | Package |
|---|---|
| Document、projection、標準layout | `@iriograph/core` |
| Vue WYSIWYG editor | `@iriograph/vue-editor` |
| Turtle / JSON-LD import・export | `@iriograph/rdf-io` |
| Label-first検索・安全なsemantic write facade | `@iriograph/semantic-access` |
| Authoring profile解決 | `@iriograph/profile-resolver` |
| Domain profile作成・conformance・任意vendor catalog | `@iriograph/profile-kit` |
| ELK layered layout | `@iriograph/layout-elk` |
| Closed presentation candidate tool | `@iriograph/presentation-tools` |
| Semantic/presentation agent bridge | `@iriograph/agent-bridge` |
| Mock/product host共通gate | `@iriograph/host-conformance` |

10 packageは同じversionを使うlockstep releaseです。Public exports、配布順、SemVerは[Package配布・version](./docs/integration/distribution.md)を参照してください。

## Local Mock

Node.js 22以降では次を実行します。

```sh
npm install
npm run dev
```

Dockerでは次を実行し、`http://localhost:5173`を開きます。

```sh
docker compose up -d --build
```

Mockは`apps/mock/public/workspace`の`.iriograph`と画像assetをtree表示し、browserのpath別working copyへ保存します。検証は`npm run verify`、Editor/transaction変更時は`npm run verify:e2e`です。

## 文書と状態

- [文書一覧](./docs_ja/README.md)
- [設計原則](./docs_ja/architecture/principles.md)
- [公開契約](./docs_ja/architecture/public-contracts.md)
- [バックログ](./docs_ja/backlog.md)

全10 packageはnpmjsの`@iriograph` organizationからpublic packageとして配布します。Iriograph本体は[MIT License](./LICENSE)です。依存package、同梱icon、vendor catalogには各提供元のlicenseと利用条件が別途適用されます。
