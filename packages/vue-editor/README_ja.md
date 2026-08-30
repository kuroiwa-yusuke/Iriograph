# @iriograph/vue-editor

Iriograph documentをWYSIWYG編集する埋め込み用Vue 3 componentです。Vueはpeer
dependencyです。Coreは互換性を固定するため同じIriograph releaseを直接依存します。

```sh
npm install --save-exact @iriograph/core @iriograph/vue-editor vue
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
  :ui-locale="uiLocale"
  :semantic-locales="semanticLocales"
  :authoring-context="resolvedAuthoringContext"
  :semantic-validation-context="resolvedSemanticValidationContext"
  :resource-iri-allocator="resourceIriAllocator"
  :document-identity-allocator="documentIdentityAllocator"
  :predicate-inference-policy="predicateInferencePolicy"
  :asset-access="assetAccess"
  :asset-options="workspaceAssetOptions"
  @duplicated-as-new="openDuplicatedDocument"
  @pending-drafts-changed="hasPendingDrafts = $event"
  @update:ui-locale="persistUiLocale"
  @save="saveToHost"
/>
```

## 言語

Editorは英語を既定とし、日本語を同梱します。`uiLocale`はpackage UIを切り替え、`update:uiLocale`を受けたHostは利用者設定としてportable document外へ保存できます。`semanticLocales`は既存RDF label/commentの表示優先順で、省略時は`uiLocale`へ従います。どちらを変えてもTurtleの翻訳・書換え、view overlay更新、history追加、dirty化を行いません。

標準関係とpackage iconはexact IRIを保ったまま英語または日本語metadataを選択します。利用者が作成した意味textに選択言語がなければ、既存literalから決定的にfallbackします。

`runtimeContext`にはprofile別の解決済みcatalogとlayout registryを持つ
`ProjectionRuntimeContext`を渡します。旧`catalog` propはdeprecated互換です。意味グラフのstructured editを有効に
する場合は、hostで解決した`ResolvedAuthoringContext`と、必要に応じて
`ResourceIriAllocator`を渡します。Editorはresource・属性・edge・包含・Seq/Alt・削除を
サイドバーdraftとして保持し、実行button一回の内部でexact triple差分のpreview、全view検証、atomic applyを
連続実行してからだけ`v-model`を更新します。削除影響以外に別のPreview/Apply画面は挟みません。
Propertyは複数のIRI/literal値を完全置換し、空文字列literalと明示削除を区別します。Seq/Alt等の
非表示structure resourceもScene provenanceから候補へ戻し、catalogのexact構造設定を保持します。
標準の意味編集は右Inspectorの`新しい要素を作る`、`関係を作る`、`要素を変更する`、`関係を変更する`の4入口から開始し、一段に一つの判断だけを表示します。新規nodeは名前とprofileが許可するnode-role、新規groupは名前と分類・包含・順序付き・候補のgroup kindを、host allocatorのopaque IRIと同じsemantic transactionへ確定します。説明、関係、所属は作成後の明示操作へ分け、位置指定や領域へのdropからmembershipを推論しません。
Host自身のtoolbarやshortcutから保存する場合は、先にcomponent refの`flushPendingEdits()`を`await`してください。
Editor内の保存buttonが発行する`save` eventは既にflush成功後なので、そのhandlerは現在の`v-model`を
そのまま永続化し、同じEditorへ再度flushしません。未確認のstructured draftは自動適用されず、flushは
`false`を返します。Workspace、HTTP、認証、永続化はhostの責務です。

`assetOptions`は`{ assetRef, label?, path?, mediaType? }[]`です。Hostはworkspace treeにある画像の
安定asset IRIと利用者が認識できるpathを対応付け、Editorはpath候補を`assetRef`へ変換してoverlayだけへ
保存します。IRIの直接入力欄は出しません。Package同梱iconはhost resolverなしでも表示でき、workspace/
外部assetに対するhostのpolicyは緩和しません。

`pendingDraftsChanged(pending)`は、未適用のTurtle、View overlay JSON、全文Document JSON、
structured authoring draftのいずれかがある間は`true`、
適用・破棄・外部`modelValue`への置換で解消した時点で`false`を通知します。
Mount時にも現在値を通知するため、hostはこのeventをSave buttonや離脱確認の状態へそのまま接続できます。
`v-model`の更新だけでは未適用Turtle draftを観測できないため、dirty判定にはこのeventも含めてください。

`documentIdentityAllocator`は「新しい図として複製」で新しい`documentId`とbase IRIを発行するhost境界です。
EditorはCoreでlocal RDF termとoverlay semantic referenceを一括rebaseしてpreviewしますが、確定時も現在の
`v-model`やhistoryを変更しません。検証済みcopyを`duplicatedAsNew`で受け取ったhostが別workspace fileへ保存し、
必要ならそのfileへ表示を切り替えます。同一identityのclipboard copyはallocatorを使いません。

`predicateInferencePolicy`はquery/validationがexact predicateだけを使うか、限定`rdfs:subPropertyOf`推論を
使うかを意味Inspectorへ説明する任意policyです。上位predicate edgeをSceneへ追加したり、catalogの表示ruleを
暗黙変更したりしません。

Domain constraintはhost解決済み`ResolvedSemanticValidationContext`を注入します。
SHACL等のengineはhost adapterの選択であり、Editorはengine-independentなdiagnosticだけを扱います。
Loaded domain errorはSceneへannotationし、candidate errorはrollbackします。

名前付きビューは追加、複製、profile/layout/locale設定、削除、overlay resetをUIから操作できます。
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

意味編集は4入口の後にCanvas対象、種類、関係、member、順序または既定候補を段階表示します。関係作成は最初に`線でつなぐ` / `グループへ所属させる`をicon cardで選び、directは一始点・複数接続先・共通または行別predicate、membershipは既存Group Frame・複数member・Seq順序または候補グループ既定を一つのatomic requestへcompileします。既存memberと、名前・node-roleだけの未確定新規member chipを混在できます。完全IRI、`rdf:type`、`rdfs:label`等を通常UIへ出しません。Predicateはcatalog/profileの選択localeに対応した`A（関係）B`候補から選びます。個別edge説明はRDF標準reificationの`rdfs:comment`としてTurtleへ保存し、ビュー専用captionと分離します。

Canvas右click、Context Menu key、Shift+F10は同じ対象別menuを開きます。Node、direct edge、derived順序/候補guide、各Group Frame、空白に応じた意味・ビュー・配置・削除入口を示しますが、menu選択だけでは変更せず該当Inspector/actionへfocusします。色・透明度・線、template/icon、geometry、region label/z-order、edge route/terminal/caption/anchorを右Inspectorで段階表示し、
一gestureまたは確定操作を一つのpresentation history itemとして保存します。Region上へのplain dragから
membershipは生成しません。
Nodeのビュー編集ではlabel/iconをCanvas内で個別dragでき、`nodeLabelOffset`/`nodeIconOffset`だけを
sparse appearanceへ保存します。Resetとundo/redoを提供し、Turtleやnode geometryは変更しません。
利用者操作とhostの注入責務は[Editor操作](../../docs/editor/interactions.md)を参照してください。

## Keyboard and accessibility

Canvasはnode、container、edgeを共通のmulti-select scene navigatorとして扱い、Canvas自身だけを
tab stopにします。`N` / `Shift+N`でactive itemを移動し、Enter/Spaceで選択、Ctrl/Cmd+Spaceでtoggleします。
Arrow / Shift+Arrowは選択geometryを1 / 10 unit移動し、対象がなければviewportをpanします。Ctrl/Cmd+Arrowはgeometryまたはactive waypointを移動し、
Ctrl/Cmd+Shift+Arrowはresizeまたはedge label位置を変更します。`W`/Insertでwaypoint追加、
`[`/`,`と`]`/`.`で対象waypoint移動、Ctrl/Cmd+Backspace/Deleteで削除できます。

Key repeatはCanvas上のpreviewだけを更新し、keyup/blurで一つのpresentation historyへ確定します。
Escapeはpreviewを破棄します。`input`、`textarea`、`select`、`contenteditable`、IME composition中の
eventはCanvas/global shortcutの対象外です。`readOnly`でもfocus、selection、pan、zoom、revealは
利用できます。ARIA、focus fallback、dialog、live statusを含む規範契約はworkspaceの
[Accessibility](../../docs/editor/accessibility.md)を参照してください。
