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

Component refは`panBy()`、`zoomTo()`、`fitToView()`、`revealSelection()`、
`focusElement(elementId)`も公開します。Pan、zoom、minimap、selection revealはeditor session
だけの状態であり、`v-model` document、overlay、undo history、dirty stateを変更しません。
`readOnly`でもこれらのnavigationは利用できます。

Multi-selectionはCtrl/Cmd clickのtoggle、Shift clickの追加、blank/Escapeのclear、
Ctrl/Cmd+Aの全選択を提供します。Ref APIの`selectElement()`、`selectElements()`、
`selectAll()`、`clearSelection()`でも操作でき、`selectionSetChanged`で集合を通知します。
一括drag、6方向の整列、水平/垂直の等間隔はTurtleを変更せず、一操作を一つの
presentation undo itemとして保存します。標準snapは8 unit gridと6px toleranceのtarget guideで、
`snapSettings` propまたは`setSnapSettings()`からsession内だけ変更できます。
