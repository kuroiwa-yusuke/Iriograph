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
  :authoring-context="resolvedAuthoringContext"
  :resource-iri-allocator="resourceIriAllocator"
  @save="saveToHost"
/>
```

`catalog`にはvalidated `ProjectionCatalogV1`を渡します。意味グラフのstructured editを有効に
する場合は、hostで解決した`ResolvedAuthoringContext`と、必要に応じて
`ResourceIriAllocator`を渡します。Editorはresource・属性・edge・包含・Seq/Alt・削除を
サイドバーdraftとして保持し、exact triple差分のPreviewと明示Apply後にだけ`v-model`を更新します。
Propertyは複数のIRI/literal値を完全置換し、空文字列literalと明示削除を区別します。Seq/Alt等の
非表示structure resourceもScene provenanceから候補へ戻し、catalogのexact構造設定を保持します。
Canvasの空白clickで指定する新規resource位置は適用前にはephemeral markerだけを更新し、Core Previewが
実投影後のboundsを検証してからsemantic作成と一つのundo itemへ確定します。
保存前にTurtle draftを確定する場合はcomponent refの`flushPendingEdits()`を`await`してください。
未確認のstructured draftは自動適用されず、flushは`false`を返します。Workspace、HTTP、認証、
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

EdgeはCoreが供給するendpoint込み`SceneEdge.route`を描画し、`waypoints`にはmanual中間点だけを
保持します。選択したedgeはpathのdouble clickまたはInspectorからwaypointを追加でき、handleの
drag・Arrow key・Delete/Backspace、labelのdrag・Arrow key・resetを利用できます。
Generated edgeで表示されるbend handleを初めて編集すると、その時点のderived route中間点を
manual waypointへseedします。
`IriographDiagramCanvas`は完全なsparse routingを`routingUpdate`で通知します。従来の
`routingChange({ elementId, waypoints })`もwaypoint操作に限って互換通知されます。
Edge本体のDelete/Backspaceは即時削除ではなく、Core provenanceからexact semantic commandを
authoring sidebarへseedします。`readOnly`ではsemantic/presentation write入口を無効にします。
