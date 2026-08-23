# @iriograph/vue-editor

Iriograph documentをWYSIWYG編集する埋め込み用Vue 3 componentです。Vueはpeer
dependencyです。Coreは互換性を固定するため同じIriograph releaseを直接依存します。

```sh
npm install @iriograph/core @iriograph/vue-editor vue
```

CSSは公開subpathから明示的に読み込みます。

```ts
import { IriographEditor } from "@iriograph/vue-editor";
import "@iriograph/vue-editor/styles.css";
```

```vue
<IriographEditor
  v-model="document"
  :catalog="catalog"
  @save="saveToHost"
/>
```

`catalog`にはvalidated `ProjectionCatalogV1`を渡します。保存前にTurtle draftを確定する
場合はcomponent refの`flushPendingEdits()`を`await`してください。Workspace、HTTP、認証、
永続化はhostの責務です。
