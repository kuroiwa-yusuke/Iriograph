# Editor interaction guide

この文書は、標準`IriographEditor`を利用するユーザーの操作と、埋め込むhostが用意する契約を説明します。意味graphの正本はTurtle、表示の個別調整はview overlayです。右Inspectorとdialogから始める意味操作はsemantic transactionへ、Canvas gestureと右Inspectorのビュー編集から始める表示操作はpresentation transactionへ合流します。

## 操作の基本

- Node、container、region、edgeをclickすると選択し、右Inspectorで対象を確認できます。Ctrl/Cmd clickは選択のtoggle、Shift clickは追加、空白clickまたはEscapeは選択解除です。
- 操作名、resource、class、predicateは人が読めるlabelを主表示にします。完全IRIはidentityとして内部で保持し、同名labelの識別、tooltip、read-onlyの`Advanced`詳細で確認できます。Label文字列をidentityやcatalog ruleの判定には使いません。
- `意味を編集`の変更はcandidate graphを作る操作です。`Preview`で対象resource、関係、追加・削除件数、validationを確認し、`Apply`したときだけTurtleと必要なoverlayを一つのrevisionへ確定します。
- `ビュー`の変更は現在のnamed viewだけへ作用します。位置、size、template、icon、edge routingを変更してもTurtleは変わりません。
- 意味入力とビュー入力を同時に表示しません。対象を選んだ後は`意味`と`ビュー`のtabで片方だけを表示し、tabを切り替えても未適用の段階入力を保持して、黙ってApplyまたは破棄しません。
- `readOnly`では選択、詳細表示、pan、zoom、fit、minimapを利用できますが、semantic/presentation writeは実行できません。

## 右Inspectorの4 action

右Inspectorの初期状態は、RDF statementや全propertyを平坦に並べず、次の4 actionだけを主入口として表示します。

1. `新しい要素を作る`
2. `関係を作る`
3. `要素を変更する`
4. `関係を変更する`

Action選択後にだけ、対象、種類、関係、値、Previewの順で必要なfieldを段階表示します。一つの画面に全fieldを先出しせず、前段で選んだclass、predicate、resource、Scene provenanceにより次段の候補を絞ります。Canvas selectionがあれば対象fieldへseedできますが、利用者が変更できます。通常UIにIRI、`rdf:_1`、内部command名、capability patchを入力させません。完全IRIとexact statementは`Advanced`のread-only参照情報であり、standard editorにIRI override入力を設けません。

`新しい要素を作る`はlabel一項目だけを入力して確定します。Opaque IRIはhost allocatorが生成し、初期semantic statementはそのIRIの`rdfs:label`だけです。種類、説明、分類、所属、関係、位置を作成formへ混ぜず、作成後の`要素を変更する`、`関係を変更する`、`ビュー`で追加します。`関係を作る`は始点、関係候補、終点へ進みます。`要素を変更する`は対象を選んで`意味`を、表示だけ変える場合は`ビュー`を開きます。`関係を変更する`はedge、membership、分類、順序、選択肢を利用者向け名称で選び、追加・一括変更・削除へ進みます。必要なauthoring context、provenance、書込権限が不足するactionは推測で実行せず、無効理由と次に必要な操作を日本語で示します。

各段階はBackで戻れ、CancelまたはEscapeでdraftだけを破棄します。Validation errorはcodeだけでなく「どの選択を、なぜ、どう直すか」を該当fieldの近くに示します。`Preview`はlabel中心の文と候補Sceneで結果を確認でき、`Apply`まではdocument、portable overlay、historyを変更しません。

## 右クリックとビュー編集

Pointerの右click、Canvasのactive itemに対するContext Menu keyまたはShift+F10は、対象を選択して右Inspectorの`ビュー`tabと該当段階を直接開きます。別のcontext menuやCanvas横のpopoverは出しません。右クリックから意味の追加・変更・削除を開始せず、入口を開いただけではdocument、overlay、historyを変更しません。未適用の意味draftも破棄しません。Canvas本体のsingle-tab-stop listbox、`aria-activedescendant`、live statusの規範は[accessibility.md](./accessibility.md)を参照してください。

## Resourceの作成

`新しい要素を作る`はactive localeのlabelだけを要求します。空文字列は拒否し、hostのresource IRI allocatorが許可namespace内の衝突しないopaque IRIを発行します。Previewする初期graph patchは次の一文だけです。

```turtle
<allocated-opaque-iri> rdfs:label "入力したlabel"@ja .
```

Apply後のprojectionはgeneric node fallbackと標準layoutでdisplayを補完します。初期位置、template、iconを同じsemantic transactionに含めません。分類、概念クラス化、説明、上位概念は`要素を変更する`、edge、分類、領域membershipは`関係を変更する`、位置やiconは`ビュー`から別の明示操作として行います。これにより作成失敗をlabel/allocator/profile検証へ限定し、初回formでRDFの種類や関係を理解させません。

Allocatorが失敗、衝突、許可namespace外のIRIを返した場合はApplyせず、「新しい要素を作れませんでした。再試行してください」等のaction付きerrorを示します。完全IRIはPreviewのAdvanced詳細でread-only表示します。Canvas上のghostはApply前の一時表示であり、Cancel、Escape、失敗時に消え、documentやoverlayへ保存しません。

Concept classや関係種別を定義する場合も、初回作成formで種類を選ばせません。Human vocabulary definitionを許すprofileで作成済みresourceを`rdfs:Class`または`rdf:Property`等へ変更する後続の`要素を変更する`を明示確認付きで提供し、禁止profileではその編集候補を無効理由付きで出しません。Templateやiconを正当化するためだけの`rdf:type`は生成しません。

## Detailsとproperty編集

右Inspectorの`要素を変更する`で対象を選んだ後、resourceのlabelを見出しにしたdetails/property dialogを段階入力として開けます。Details dialogを独立した第5の意味編集入口にはしません。通常表示ではlabel、値の種類、関係先を読みやすく示し、完全IRI、datatype、language、exact tripleはread-onlyの`Advanced`または詳細領域に置きます。Standard editorはAdvanced identityやexact statementを直接編集する入力欄を持ちません。

Property編集はsubjectとpredicateの値集合を扱います。複数のIRI/literal値、literalのdatatypeまたはlanguage、空文字列literalを区別します。値を空にする明示削除と、空文字列を一値として保存する操作は同じではありません。`rdfs:member`や`rdf:_n`などの構造predicateは通常propertyとして編集せず、包含、順序、選択の専用actionを使います。

通常detailsは、RDF statementの平坦な一覧ではなく、`名前・説明・別名`、`分類・概念階層`、`関係・参照`、`データ属性`、`Advanced identity`へ分けます。`rdf:_n`は順序editorだけに表示します。Predicate resourceを編集する場合は「関係種別」としてlabel、comment、`rdfs:subPropertyOf`を示し、label変更が同じpredicateを使う全edgeへ反映されることを説明します。

Labelとcommentは複数行literalを入力でき、language別の値集合として編集します。Canvasの既定labelはactive localeのprimary label一つです。同一languageの`rdfs:label`が複数ありprimaryを決定できない場合は警告し、別名を必要とするprofileは`skos:altLabel`等の標準語彙を明示的に許可します。文字列をidentityやrule matchingには使いません。

Dialogは表示時に見出しまたは最初のfieldへfocusし、focusをdialog内に保ちます。EscapeまたはCancelは未適用draftを破棄し、閉じた後は存在するopenerまたはCanvasのactive itemへfocusを戻します。Semantic propertyはdialog内のPreviewから同じ明示Applyへ進み、dialogを閉じただけでは保存しません。

## Edgeの作成と接続点

Edge作成はsource、predicate、targetを明示するsemantic authoringです。Canvas gestureを使う場合も、最初のresourceと次のresourceをdraftへseedするだけで、線を引いた時点ではTurtleへ書き込みません。Predicateはlabel-firstのcatalog/profile候補から選び、standard editorのAdvancedはread-onlyで候補外IRIの入力欄を持ちません。空欄をgeneric predicateで補完することはありません。

Predicate pickerは、選択済みsourceとtargetを使った日本語の文型`A（predicate）B`を主表示にします。たとえばsourceが「申請」、predicateの文型labelが「承認者は」、targetが「部長」なら、候補cardは「申請（承認者は）部長」として読み比べられます。語順、助詞を含むpredicateの文型label、comment、category、利用例は解決済みcatalog/vocabulary metadataから得て、IRI local nameや英語labelの機械分割から生成しません。Metadataが不足する候補は通常predicate labelを括弧内へ置く決定的fallbackを使い、意味を推測しません。

候補集合はactive authoring profileが許可し、解決済み標準catalogが提供するRDF/RDFS/OWL、DCTERMS、PROV-O、SKOS等の関係語彙を基準にします。Source/targetの明示型と限定`rdfs:subClassOf` closure、predicateの`rdfs:domain`/`rdfs:range`、object/literal kind、catalog capabilityを使って型適合するものへ絞ります。完全なOWL推論をpicker内で実行しません。型情報が不足する場合は適合を断定して除外せず「型未確認」として後順位に残し、候補graphはApply前の共通validationへ必ず通します。全predicateを平坦に並べず、検索とcategory絞り込みを提供します。近い既存predicateがない場合は、standard editor内でIRIを入力させずcatalog/vocabularyの整備を促します。表示名が同じ候補は説明とread-only Advanced IRIで識別します。

Predicateから導出するedge labelは関係種別の意味表示です。個々のdirect edgeへ利用者が追加する「この関係の説明」は`関係を変更する`の意味操作とし、asserted S/P/Oを残したRDF 1.1標準reificationの`rdfs:comment`として保存します。複数language・複数行を扱い、predicate自体のlabel/commentとは区別します。これにより説明は意味検索とLLM contextへ含められます。View overlayのlegacy captionは表示専用データとして読み込めますが、標準Editorは意味説明の入力先として使いません。

`ビュー`tabで選択edgeの始点と終点haloをdragすると、接続nodeの周囲だけを移動できます。Anchorは外周上の正規化値としてoverlayへ保存しますが、通常Inspectorへ数値入力を露出しません。Haloのdrag中はrouteを一時previewし、pointerupで一つのpresentation historyへ確定します。右InspectorはCanvas操作の案内とautomaticへのresetだけを提供します。

Anchor、waypoint、label offsetはsparse routing overlayであり、edgeのsource、predicate、targetという意味は変更しません。`意味`tabの`関係を変更する`でdirect edgeを選んだ場合だけ、始点または終点haloを別のnodeへdropして接続先変更draftを作れます。空白、region、container、元のnodeへのdropは変更を作りません。成功時も即時commitせず、元statement削除と新statement追加をsemantic Previewで確認してからApplyします。

Edgeを選択して`ビュー`の`線の表示`を開くと、最初に経路形式と端子形状だけを示します。経路modeは`auto`、waypointを持たない`straight`、自動直交の`orthogonal`、waypointを持たない`curve`、利用者制御点を持つ`manual`を区別します。ラベル・補足と接続位置は折り畳み段階へ分け、projection ruleやsource/target anchorの内部数値は通常UIへ出しません。選択中のanchorとmanual waypoint handleはnodeより前面のinteraction layerへ表示し、背後の要素と重なっても操作可能にします。

## Appearance editor

Template、icon、style、geometry等のdisplay項目は、右Inspectorの`ビュー`内で選択中の要素へlive previewできます。Canvas外のpopoverは使いません。入力中は一時Sceneへだけ反映し、確定時に変更前後を一つのpresentation history itemとして保存します。EscapeまたはCancelではpreviewを破棄し、Turtleとoverlayの両方を元のままにします。同じpointer gestureや連続入力をkey repeatごとに複数のundo itemへ分割しません。

Catalogから再生成できるappearanceはportable documentへ複製しません。ユーザーが選んだtemplate/icon等だけをoverlay overrideとして保持し、「既定へ戻す」でoverrideを除去します。Workspace assetはhost pickerがabsolute asset IRIだけを返し、URL、認証情報、画像bytesはdocumentへ保存しません。

Nodeの`ビュー`は少なくとも色、透明度、線、template、host asset pickerから選ぶicon、位置、sizeを扱います。Resize可能なnode、container、regionは四隅と四辺中央の8 handleをinteraction layerへ表示し、背面要素と重なっても操作できます。Regionのresize制約は後述のmembershipを優先します。

Edgeは線、色、太さ、経路modeに加え、source/targetそれぞれのterminal shapeを閉じた候補から選べます。候補は`none`、arrow、open arrow、triangle、diamond、circle等をpreview付きで示し、catalog既定へ戻せます。Terminalとrouteはpresentation情報であり、predicate identityやRDFS/OWL上の型を変更しません。Exact edgeの意味説明はこの`ビュー`段階へ混ぜず、`意味`tabの関係変更から編集します。

Region labelは固定した上下左右のselectだけでなく、外周上のanchorをdragして移動できます。Label directionは`右向き水平`（horizontal-right）または`下向き垂直`（vertical-down）を選び、anchor、offset、directionをsparse overlayとして保存します。Region同士の前後関係はview内のregion z-orderとして編集できますが、node、edge interaction handle、focus indicatorをregion背景より背面へ隠しません。

Canvasの`ビュー`tabは、薄いgridの表示/非表示toggleを持ちます。Grid間隔はsnapのsession設定と同じcanvas unitを使い、既定は8です。Zoomとscroll/panでは画面へ固定せずCanvas座標へ追従し、node、edge、region、空白Canvasのpointer/keyboard hit testを阻害しない非interactiveな背景layerに描画します。Toggleとgrid sizeはeditor session stateであり、Turtle、view overlay、portable document、presentation history、dirty stateへ保存しません。`readOnly`でも閲覧用toggleは利用できます。

Nodeをdragしてviewport端から48px以内へ近づけると、viewportはpointer方向へ段階的にpanします。これはnavigation sessionだけを更新し、node geometryは通常のdrag transaction一件としてpointerup時に確定します。

## Regionと包含

Containerの領域上へnodeを置くことと、意味graphにmembershipを持つことは別です。通常drag、整列、snap、複数選択の移動はgeometryだけを変更し、包含tripleを推論しません。

Editorは次の不一致をCanvasとInspectorに警告します。

- 意味上は無関係なresourceが、見た目上container領域内にある
- 意味上のchildが、parent containerのcontent領域外にある
- 重なった複数領域が候補になる、または一意parentのprofileに対して複数membershipがある

不一致は自動修正しません。「意味包含のdraftを作成／外す」はcatalog provenanceに対応する構造commandをPreviewへ送り、「表示を領域内／領域外へ移動」はoverlayだけを一つのpresentation historyへ保存します。複数候補では対象containerを明示選択するまでsemantic draftを確定しません。`新しい要素を作る`時のCanvas位置からmembershipを補完せず、作成後に`関係を変更する`から対象containerを選びます。

分類、概念階層、領域所属は別actionとして表示します。複数resourceと複数class/regionを選び、追加と解除を一つのatomic previewへまとめられます。Concept classをregionへ投影するviewでは、複数`rdf:type`の共通部分をderived intersection cellとして選択でき、cellへの分類操作は構成classのstatementを一括更新します。通常dragは意味を変更しませんが、classification-constrained viewでは現在の所属intersectionから要素を外へ出さず、別cellへの移動は「分類も変更」のsemantic draftを明示的に開始します。

Classification-constrained viewでは、複数regionに属する要素の全boundsを全regionの共通部分から外へdragできません。別cellへの移動は通常dragでは行わず、`関係を変更する`から移動先classを明示したsemantic previewを開きます。共通部分が空または要素より小さい場合は移動を拒否し、region geometryまたはclassificationのどちらを修正するか選べるdiagnosticを返します。

Regionの移動と8-handle resizeも、意味上のmember全boundsと必要paddingを包含することをhard constraintにします。複数regionのresize後にmember用intersectionが空またはmemberより小さくなる候補はcommitせず、制約位置でhandleを止めて理由を表示します。Region geometryを変更してもmembershipは増減せず、membershipを変更したい場合は`関係を変更する`のsemantic Previewへ移ります。外周labelとoffsetはlayoutの占有boxに含めます。

選択中のregionは、保存された前後関係を変更せず一時interaction layerだけを最前面にします。これにより重なった別regionに遮られず、枠上labelと8個のresize handleを操作できます。選択解除時は元の`regionZOrder`による描画順へ戻し、選択による前面化をView overlay、history、dirty stateへ記録しません。

## Comment表示

`rdfs:comment`は意味graphから導出するannotationであり、view overlayへ本文を複製しません。既定はhoverまたはkeyboard focusで全文tooltipを表示し、session/viewの「コメントをすべて表示」で折り返したcalloutを表示します。Stable comment layoutを選んだviewは非表示時も同じcallout boundsをlayout obstacleとして予約し、表示toggleでnodeやedgeが動かないようにします。Region背景は障害物にせず、通常nodeとcomment calloutの重なりを避けます。

## 順序と分岐

`rdf:Seq`は薄い外枠の順序付きgroupと各memberの番号badgeで表示し、通常の関係線とは区別します。`関係を変更する`の初期状態では順序・包含候補を展開せず、Seq groupまたはそのmemberをCanvasで選択した後だけ、label付きcardの追加・上下移動・除外を表示します。利用者に`rdf:_1`等のpredicateやIRI改行textareaを表示せず、確定時は標準`rdf:Seq`/`rdf:_n`を`set-sequence`で一括再構成します。`rdf:Alt`は選択肢cardと既定値の選択として編集し、branch edgeの選択肢名はderived display labelに留めます。

## 削除などの破壊操作

Resource、edge、property、membership、Seq/Alt memberの削除は、右Inspectorの`要素を変更する`または`関係を変更する`から開始し、必ず`Preview → Apply`を通します。必要なdetails dialogはそのintentの後続段階として開きます。Previewはhuman labelを先に表示し、追加・削除件数、関係の向き、validation/warningを示します。完全IRI、exact statement、candidate Turtleは詳細表示で確認できます。

Core APIでcascadeを省略したresource削除は参照があれば拒否します。一方、標準Editorの「要素を削除」は最初から明示cascadeのPreviewであり、resource自身の説明と、始点・終点・所属・順序として関係するstatementを人向け一覧とCanvas上の赤線で示します。ユーザーがそのPreviewをApplyした場合だけ確認した集合をatomicに削除します。Seq/Alt memberの削除では残るordinalも同じpatchで再採番し、最終制約を満たさなければ全体をrollbackします。Scene provenanceがない要素は、表示からpredicateや削除対象を推測しません。

削除Preview中は対象node/edge/regionを赤い取消線または赤い破線で示せますが、これはApply前のsession-only previewです。Portable overlay、Scene正本、history、保存documentへpending deleteや赤線を記録しません。Cancel、Escape、draft切替、reloadで消えます。Resourceの永続削除は確認済みcascade semantic patchのApplyだけで行い、soft deleteやpresentation-only deleteを設けません。個別edge、property、membershipの削除もexact semantic patchのApplyであり、赤線だけを保存して削除済みと扱いません。

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
