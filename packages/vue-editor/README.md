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
  :asset-access="assetAccess"
  :asset-options="workspaceAssetOptions"
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
標準の意味編集は右Inspectorの4 actionから開始します。新規resourceは名前だけで作成し、host allocatorの
opaque IRIと`rdfs:label`を一つのsemantic transactionへ確定します。種類、説明、関係、所属は作成後の
明示操作へ分け、位置指定や領域へのdropからmembershipを推論しません。
保存前にTurtle draftを確定する場合はcomponent refの`flushPendingEdits()`を`await`してください。
未確認のstructured draftは自動適用されず、flushは`false`を返します。Workspace、HTTP、認証、
永続化はhostの責務です。

`assetOptions`は`{ assetRef, label?, path?, mediaType? }[]`です。Hostはworkspace treeにある画像の
安定asset IRIと利用者が認識できるpathを対応付け、Editorはpath候補を`assetRef`へ変換してoverlayだけへ
保存します。IRIの直接入力欄は出しません。Package同梱iconはhost resolverなしでも表示でき、workspace/
外部assetに対するhostのpolicyは緩和しません。

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
Hostが`fit-on-initial-load`を指定した場合は、各document/viewで最初に完成したSceneだけを自動fitし、
その後の編集では利用者のzoom/scrollを維持します。

Multi-selectionはCtrl/Cmd clickのtoggle、Shift clickの追加、blank/Escapeのclear、
Ctrl/Cmd+Aの全選択を提供します。Ref APIの`selectElement()`、`selectElements()`、
`selectAll()`、`clearSelection()`でも操作でき、`selectionSetChanged`で集合を通知します。
一括drag、6方向の整列、水平/垂直の等間隔はTurtleを変更せず、一操作を一つの
presentation undo itemとして保存します。標準snapは8 unit gridと6px toleranceのtarget guideで、
`snapSettings` propまたは`setSnapSettings()`からsession内だけ変更できます。

EdgeはCoreが供給するendpoint込み`SceneEdge.route`を描画し、`waypoints`にはmanual中間点だけを
保持します。選択したedgeは手動modeでInspectorからwaypointを追加でき、handleの
drag、またはCanvas keyboard commandからwaypointの選択・追加・削除・移動、label位置の変更を利用できます。
Generated edgeで表示されるbend handleを初めて編集すると、その時点のderived route中間点を
manual waypointへseedします。
`IriographDiagramCanvas`は完全なsparse routingを`routingUpdate`で通知します。従来の
`routingChange({ elementId, waypoints })`もwaypoint操作に限って互換通知されます。
Edge本体のDelete/Backspaceは即時削除ではなく、Core provenanceからexact semantic commandを
右Inspectorのauthoring draftへseedします。`ビュー`tabのsource/target endpoint anchorはCanvas handleで
node周囲へ移動し、waypointと同じsparse routing overlayだけに保存します。`意味`tabで「関係を変更する」
間だけ、同じ端子を別nodeへdropしてsource/target変更draftを作れます。空白dropは元接続を維持します。
`readOnly`ではsemantic/presentation write入口を無効にします。

意味編集は右Inspectorの「新しい要素を作る」「関係を作る」「要素を変更する」「関係を変更する」の
4 actionだけを入口にし、完全IRI、`rdf:type`、`rdfs:label`等を通常UIへ出しません。Predicateは
catalog/profileの日本語`A（関係）B`候補から選びます。要素の種類・名前・説明、包含の一括変更、Seqの
追加・並べ替え・除外、resource/edge削除はCanvas選択後に段階表示し、すべて`Preview → 明示Apply`で
確定します。個別edge説明はRDF標準reificationの`rdfs:comment`としてTurtleへ保存し、ビュー専用captionと
分離します。

Canvas右clickは別menuを出さず、対象を選択して右Inspectorの`ビュー`tabを直接開きます。色・透明度・線、
template/icon、geometry、region label/z-order、edge route/terminal/caption/anchorを段階表示し、
一gestureまたは確定操作を一つのpresentation history itemとして保存します。Region上へのplain dragから
membershipは生成しません。
Nodeのビュー編集ではlabel/iconをCanvas内で個別dragでき、`nodeLabelOffset`/`nodeIconOffset`だけを
sparse appearanceへ保存します。Resetとundo/redoを提供し、Turtleやnode geometryは変更しません。
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
