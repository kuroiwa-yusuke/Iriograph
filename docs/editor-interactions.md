# Editor interaction guide

この文書は、標準`IriographEditor`を利用するユーザーの操作と、埋め込むhostが用意する契約を説明します。意味graphの正本はTurtle、見た目の個別調整はview overlayです。Canvas、コンテキストメニュー、Inspector、dialogは入口が異なるだけで、同じsemantic transactionまたはpresentation transactionへ合流します。

## 操作の基本

- Node、container、edgeをclickすると選択し、右Inspectorで意味と表示を確認できます。Ctrl/Cmd clickは選択のtoggle、Shift clickは追加、空白clickまたはEscapeは選択解除です。
- 操作名、resource、class、predicateは人が読めるlabelを主表示にします。完全IRIはidentityとして内部で保持し、同名labelの識別、tooltip、詳細表示、`Advanced`入力で確認できます。Label文字列をidentityやcatalog ruleの判定には使いません。
- `Meaning`の変更はcandidate graphを作る操作です。`Preview`で対象resource、関係、追加・削除件数、validationを確認し、`Apply`したときだけTurtleと必要なoverlayを一つのrevisionへ確定します。
- `Display`の変更は現在のnamed viewだけへ作用します。位置、size、template、icon、edge routingを変更してもTurtleは変わりません。
- `readOnly`では選択、詳細表示、pan、zoom、fit、minimapを利用できますが、semantic/presentation writeは実行できません。

## コンテキストメニュー

Canvasの空白または要素から開くコンテキストメニューは、その場所と現在の選択に適用できるactionだけを示します。Pointerでは右click、keyboardではCanvasのactive itemに対するContext Menu keyまたはShift+F10を入口とします。要素から開いた場合はその要素をprimary selectionに揃え、空白から開いた場合は選択を解除しますが、document、overlay、historyは変更しません。

Action名には「属性を編集」「関係を作成」「領域へ含める」のような利用者向けlabelを使います。IRIや内部command名は主action名にしません。実行にauthoring context、provenance、書込権限が必要で、それが不足しているactionは、推測で実行せず無効理由を示します。

メニューから選んだ意味操作は右Inspectorまたはproperty/details dialogへdraftを開くだけです。たとえばedgeの「削除」は線を即時に消さず、projection provenanceから元tripleまたは構造commandを復元してPreviewへ送ります。表示操作はoverlay editorへ移り、gestureまたは明示確定単位でpresentation historyへ記録します。

コンテキストメニューは`role="menu"`と`menuitem`を持ち、最初の有効actionへfocusします。Arrow、Home、Endでactionを移動し、EnterまたはSpaceで実行、Escapeで閉じてCanvasへfocusを戻します。Tabはメニューを閉じ、通常のEditor tab順へ戻ります。Canvas本体のsingle-tab-stop listbox、`aria-activedescendant`、live statusの規範は[accessibility.md](./accessibility.md)を参照してください。

## Resourceの作成とcatalog palette

空白Canvasの作成actionは、解決済みcatalogとauthoring contextから作ったcreation paletteを開きます。Paletteは個別業務語彙をrendererへ埋め込まず、hostが注入した次の情報から候補を構成します。

- Authoring profileの利用可能なclass、predicate、構造capability
- Active viewのprojection capability
- Catalogのnode/container templateとasset参照
- Hostのresource IRI allocatorと許可namespace

Palette上のtemplateやiconは外観の選択です。選択した形を正当化するためだけの`rdf:type`を生成しません。意味のあるclassを選んだ場合だけtype tripleになり、外観はcatalogから導出するかview overlayの明示overrideとして保存します。

Resource作成では、named IRIと、作成resourceをsubjectまたはobjectに含む少なくとも一つのtripleが必要です。Label、意味のあるclass、既存resourceとのedge、catalog規定のcontainer membershipを一つの作成draftへまとめられます。Canvasで選んだ位置とghostはApply前の一時表示であり、validationと実投影後のbounds確認に成功した場合だけ、意味graphと初期geometryを一つのundo itemへ確定します。

## Detailsとproperty編集

要素の詳細actionは、resourceのlabelを見出しにしたdetails/property dialogを開きます。通常表示ではlabel、値の種類、関係先を読みやすく示し、完全IRI、datatype、language、exact tripleは`Advanced`または詳細領域に置きます。Advanced入力から渡す値もCoreでは常に完全IRIとして検証されます。

Property編集はsubjectとpredicateの値集合を扱います。複数のIRI/literal値、literalのdatatypeまたはlanguage、空文字列literalを区別します。値を空にする明示削除と、空文字列を一値として保存する操作は同じではありません。`rdfs:member`や`rdf:_n`などの構造predicateは通常propertyとして編集せず、包含、順序、選択の専用actionを使います。

Dialogは表示時に見出しまたは最初のfieldへfocusし、focusをdialog内に保ちます。EscapeまたはCancelは未適用draftを破棄し、閉じた後は存在するopenerまたはCanvasのactive itemへfocusを戻します。Semantic propertyはdialog内のPreviewから同じ明示Applyへ進み、dialogを閉じただけでは保存しません。

## Edgeの作成と接続点

Edge作成はsource、predicate、targetを明示するsemantic authoringです。Canvas gestureを使う場合も、最初のresourceと次のresourceをdraftへseedするだけで、線を引いた時点ではTurtleへ書き込みません。Predicateはlabel-firstのcatalog/profile候補から選び、候補外IRIを許すpolicyの場合だけ`Advanced`から入力できます。空欄をgeneric predicateで補完することはありません。

選択edgeの始点と終点は、endpoint haloまたはInspectorの値からnode/container周囲の任意位置へ調整できます。Anchorは外周を時計回りに一周する`0 <= position < 1`の正規化値で、`0`は上、`0.25`は右、`0.5`は下、`0.75`は左です。Haloのdrag中はrouteを一時previewし、pointerupで一つのpresentation historyへ確定します。Inspectorは同じ値のkeyboard入力とautomaticへのresetを提供します。

Anchor、waypoint、label offsetはsparse routing overlayであり、edgeのsource、predicate、targetという意味は変更しません。意味上の接続先を変えたい場合は、既存edgeの見た目を付け替えず、元関係の削除と新関係の作成をsemantic Previewで確認します。

## Appearance editor

Template、icon、style、geometry等のdisplay項目は、選択中の要素へlive previewできます。入力中は一時Sceneへだけ反映し、確定時に変更前後を一つのpresentation history itemとして保存します。EscapeまたはCancelではpreviewを破棄し、Turtleとoverlayの両方を元のままにします。同じpointer gestureや連続入力をkey repeatごとに複数のundo itemへ分割しません。

Catalogから再生成できるappearanceはportable documentへ複製しません。ユーザーが選んだtemplate/icon等だけをoverlay overrideとして保持し、「既定へ戻す」でoverrideを除去します。Workspace assetはhost pickerがabsolute asset IRIだけを返し、URL、認証情報、画像bytesはdocumentへ保存しません。

## Regionと包含

Containerの領域上へnodeを置くことと、意味graphにmembershipを持つことは別です。通常drag、整列、snap、複数選択の移動はgeometryだけを変更し、包含tripleを推論しません。

Editorは次の不一致をCanvasとInspectorに警告します。

- 意味上は無関係なresourceが、見た目上container領域内にある
- 意味上のchildが、parent containerのcontent領域外にある
- 重なった複数領域が候補になる、または一意parentのprofileに対して複数membershipがある

不一致は自動修正しません。「意味包含のdraftを作成／外す」はcatalog provenanceに対応する構造commandをPreviewへ送り、「表示を領域内／領域外へ移動」はoverlayだけを一つのpresentation historyへ保存します。複数候補では対象containerを明示選択するまでsemantic draftを確定しません。作成位置指定modeでcontainer背景を選んだ場合も、一致するmembership ruleが一意なときだけdraftを補完します。

## 削除などの破壊操作

Resource、edge、property、membership、Seq/Alt memberの削除は、コンテキストメニュー、keyboard、Inspectorのどこから開始しても`Preview → Apply`を通します。Previewはhuman labelを先に表示し、追加・削除件数、関係の向き、validation/warningを示します。完全IRI、exact statement、candidate Turtleは詳細表示で確認できます。

参照されているresourceの通常削除は拒否します。Explicit cascadeを選んだ場合だけ影響statementを列挙し、確認した集合をatomicに削除します。Seq/Alt memberの削除では残るordinalも同じpatchで再採番し、最終制約を満たさなければ全体をrollbackします。Scene provenanceがない要素は、見た目からpredicateや削除対象を推測しません。

## Host contract

標準Editorを埋め込むhostは、必要な機能に応じて次を注入します。

| Contract | Editorでの用途 |
| --- | --- |
| `runtimeContext` | Active viewのcatalog、projection、layout。Paletteと表示候補の正本 |
| `authoringContext` | Label付き語彙、semantic capability、write policy、検証対象 |
| `resourceIriAllocator` | Resource IRIをユーザーに直接入力させない作成フロー |
| `semanticValidationContext` | SHACL等を含むdomain constraintのengine-independent port |
| `assetAccess` / `pickAsset` | Asset IRIの安全な表示URL解決とworkspace picker |
| `v-model` / `save` | Portable document正本とhost-owned persistence |
| `pendingDraftsChanged` | 未適用Turtle/structured draftを含むSave・離脱確認状態 |

`authoringContext`が未解決ならsemantic actionを無効化しますが、source参照、selection、navigation、許可されたpresentation編集は維持します。Host独自のcontext menu、dialog、toast、asset pickerを重ねる場合は、Editorが処理したkeyboard eventの`defaultPrevented`を尊重し、initial focus、Escape、focus return、live statusを同じ契約で実装してください。

保存前にはcomponent refの`flushPendingEdits()`を`await`します。未適用Turtle draftは検証して確定できますが、未確認のstructured draftや破壊操作を自動Applyせず、保存要求を拒否します。
Hostは`pendingDraftsChanged`を購読し、`v-model` dirtyと合わせてSave buttonを有効化します。このeventはmount時、draftの発生・適用・破棄、read-only切替、外部`modelValue`置換に追随する現在値であり、Turtle textareaのbyte列をhost側で比較する必要はありません。
