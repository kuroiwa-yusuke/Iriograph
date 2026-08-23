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
  v-model:active-view-id="activeViewId"
  :runtime-context="projectionRuntimeContext"
  :authoring-context="resolvedAuthoringContext"
  :semantic-validation-context="resolvedSemanticValidationContext"
  :resource-iri-allocator="resourceIriAllocator"
  @pending-drafts-changed="hasPendingDrafts = $event"
  @save="saveToHost"
/>
```

`runtimeContext`にはprofile別の解決済みcatalogとlayout registryを持つ
`ProjectionRuntimeContext`を渡します。旧`catalog` propはdeprecated互換です。意味グラフのstructured editを有効に
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

`pendingDraftsChanged(pending)`は、未適用のTurtle draftまたはstructured authoring draftが
生じた時点で`true`、適用・破棄・外部`modelValue`への置換で解消した時点で`false`を通知します。
Mount時にも現在値を通知するため、hostはこのeventをSave buttonや離脱確認の状態へそのまま接続できます。
`v-model`の更新だけでは未適用Turtle draftを観測できないため、dirty判定にはこのeventも含めてください。

Domain constraintはhost解決済み`ResolvedSemanticValidationContext`を注入します。
SHACL等のengineはhost adapterの選択であり、Editorはengine-independentなdiagnosticだけを扱います。
Loaded domain errorはSceneへannotationし、candidate errorはrollbackします。

Named viewは追加、複製、profile/layout/locale設定、削除、overlay resetをUIから操作できます。
`activeViewId`はcontrolled、未指定時はuncontrolledです。Selection/primary、viewport、temporary
hideはviewId別sessionにだけ保持されます。一時hideはexact element IDとcontainer descendant・
incident edgeだけを除き、document、overlay、historyを変更しません。

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
drag、またはCanvas keyboard commandからwaypointの選択・追加・削除・移動、label位置の変更を利用できます。
Generated edgeで表示されるbend handleを初めて編集すると、その時点のderived route中間点を
manual waypointへseedします。
`IriographDiagramCanvas`は完全なsparse routingを`routingUpdate`で通知します。従来の
`routingChange({ elementId, waypoints })`もwaypoint操作に限って互換通知されます。
Edge本体のDelete/Backspaceは即時削除ではなく、Core provenanceからexact semantic commandを
右Inspectorのauthoring draftへseedします。Source/target endpoint anchorはCanvas handleまたは
Inspectorの正規化値でnode周囲へ移動でき、waypointと同じsparse routing overlayだけに保存します。
`readOnly`ではsemantic/presentation write入口を無効にします。

Meaning authoringは右Inspector上部にあり、label-firstのclass/predicate/resource選択と完全IRIの
Advanced入力を提供します。Canvas resource pickerは明示中だけnode/containerをdraftへseedします。
Resource作成時はlabel/type、既存resourceとのdirect edge、catalog規定container membership、初期位置を
一つのPreview/Applyへまとめられます。通常dragからmembershipは推論せず、表示領域と意味上のparentが
食い違う要素には警告と、semantic draftまたはpresentation-only修正の選択肢を表示します。

Canvasのコンテキストメニュー、catalog-driven creation palette、details/property dialog、
appearanceのlive preview、endpoint haloも既存のtransaction境界を共有します。Meaning actionと破壊操作は
draftを開いて`Preview → Apply`へ進み、表示調整は一つのgestureまたは確定操作を一つのpresentation
history itemとして保存します。操作名はhuman labelを主表示にし、完全IRIはidentity、tooltip、
`Advanced`入力として保持します。Region上へのplain dragからmembershipは生成しません。
利用者操作とhostの注入責務は[Editor interaction guide](../../docs/editor-interactions.md)を参照してください。

## Keyboard and accessibility

Canvasはnode、container、edgeを共通のmulti-select scene navigatorとして扱い、Canvas自身だけを
tab stopにします。Arrowでactive itemを移動し、Enter/Spaceで選択、Ctrl/Cmd+Spaceでtoggle、
Shift+Arrowでrange選択します。Ctrl/Cmd+Arrowはgeometryまたはactive waypointを移動し、
Ctrl/Cmd+Shift+Arrowはresizeまたはedge label位置を変更します。`W`/Insertでwaypoint追加、
`[`/`,`と`]`/`.`で対象waypoint移動、Ctrl/Cmd+Backspace/Deleteで削除できます。

Key repeatはCanvas上のpreviewだけを更新し、keyup/blurで一つのpresentation historyへ確定します。
Escapeはpreviewを破棄します。`input`、`textarea`、`select`、`contenteditable`、IME composition中の
eventはCanvas/global shortcutの対象外です。`readOnly`でもfocus、selection、pan、zoom、revealは
利用できます。ARIA、focus fallback、dialog、live statusを含む規範契約はworkspaceの
`docs/accessibility.md`を参照してください。
