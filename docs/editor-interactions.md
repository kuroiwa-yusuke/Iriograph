# Editor interaction guide

この文書は、標準`IriographEditor`を利用するユーザーの操作と、埋め込むhostが用意する契約を説明します。意味graphの正本はTurtle、表示の個別調整はview overlayです。右Inspectorとdialogから始める意味操作はsemantic transactionへ、Canvas gestureと右Inspectorのビュー編集から始める表示操作はpresentation transactionへ合流します。

## 操作の基本

- Node、container、region、edgeをclickすると選択し、右Inspectorで対象を確認できます。Ctrl/Cmd clickは選択のtoggle、Shift clickは追加、空白clickまたはEscapeは選択解除です。
- 操作名、resource、class、predicateは人が読めるlabelを主表示にします。完全IRIはidentityとして内部で保持し、同名labelの識別、tooltip、read-onlyの`Advanced`詳細で確認できます。Label文字列をidentityやcatalog ruleの判定には使いません。
- `意味`の作成・変更は、利用者が実行buttonを一度押すと内部でcandidate graphのvalidationとsemantic transactionを続けて行い、一つのrevisionへ確定します。Validation error時は確定せず、対象fieldの近くに次の行動を示します。通常変更に別のPreview/Apply確認画面は挟みません。
- `ビュー`の変更は現在のnamed viewだけへ作用します。位置、size、template、icon、edge routingを変更してもTurtleは変わりません。
- 意味入力とビュー入力を同時に表示しません。対象を選んだ後は`意味`と`ビュー`のtabで片方だけを表示し、tabを切り替えても未実行の段階入力を保持して、黙って確定または破棄しません。
- `readOnly`では選択、詳細表示、pan、zoom、fit、minimapを利用できますが、semantic/presentation writeは実行できません。

## 選択中心の右Inspector

右Inspectorの初期状態は、RDF statementや全propertyを平坦に並べず、Canvasで選択している要素または関係のlabel中心の概要を最初に表示します。常時表示する追加入口は次の2つです。

1. `要素を追加`
2. `関係を追加`

Resourceを選択したときは`要素の詳細を編集`と`所属・並び順を編集`、direct edgeを選択したときは`関係の意味を編集`だけを追加表示します。Action選択後にだけ必要なfieldを段階表示し、一つの画面に全fieldを先出ししません。前段で選んだclass、predicate、resource、Scene provenanceにより次段の候補を絞ります。通常UIにIRI、`rdf:_1`、内部command名、capability patchを入力させません。完全IRIとexact statementは`Advanced`のread-only参照情報であり、standard editorにIRI override入力を設けません。

Resource、region、container、Seqを一つ選択した初期概要には、`属する領域`と`含む要素`を
件数付きのlabel-first一覧で示します。一覧はSceneのexact membershipとprovenanceだけから作り、
見た目の内外、重なり、`parentElementId`互換情報から所属を推測しません。通常membership、
region、nested membership、Seq membershipを区別し、Seqは一始まりのordinalを表示します。
同じ要素が複数領域へ属する場合は各membershipを失わず別行で示します。各通常membershipは
一覧から対象をCanvasへfocusし、対象を選択した`所属・並び順を編集`へ移るか、exact predicateと
container positionを保ったままそのmembershipだけを直接解除できます。解除は一つのatomic
semantic transactionであり追加確認を挟みません。Seq/Alt membershipはこの個別解除へ流さず、
ordinal/default slotを一括検証する専用の順序・選択editorへ委譲します。一覧の展開やfocusはsession
操作でありdocumentやoverlayへ複製しません。

InspectorはCanvasを圧迫しないcompactな密度を標準とし、対象概要、2つの追加入口、選択後の主要actionだけを最初に見せます。長い説明や技術情報は折り畳み、controlを小さくしてもkeyboard focus ringとpointer targetを失わせません。左右sidebarは独立して折り畳めます。

`要素を追加`はlabel一項目だけを入力して確定します。Opaque IRIはhost allocatorが生成し、初期semantic statementはそのIRIの`rdfs:label`だけです。種類、説明、分類、所属、関係、位置を作成formへ混ぜず、作成後の対象別編集と`ビュー`で追加します。`関係を追加`はCanvasで選んだ始点・終点とlabel-firstの関係候補を使います。必要なauthoring context、provenance、書込権限が不足するactionは推測で実行せず、無効理由と次に必要な操作を日本語で示します。

各段階はBackで戻れ、CancelまたはEscapeでdraftだけを破棄します。Validation errorはcodeだけでなく「どの選択を、なぜ、どう直すか」を該当fieldの近くに示します。実行前はdocument、portable overlay、historyを変更せず、実行時もvalidationとapplyを別historyへ分割しません。確認modalは後述する選択外への削除影響だけに限定します。

## Document source編集

`Document`タブは`意味（semantic.source）`、`View overlay`、`Document全体`を分離します。意味の
正本は参照表示し、編集はTurtleタブのsemantic transactionへ移ります。`Document全体`は
`documentId`、portable base、catalog import、全named viewを確認するread-only表示です。

`View overlay`はactive named viewのsparse overlayだけをJSON sourceとして編集するAdvanced入口です。
JSON整形、runtime schema、実Sceneの複数region containment、stale draftを適用前に検証し、失敗時は
該当pathと修正行動を示して正本を変えません。成功時はTurtleをbyte単位で維持した一つのpresentation
transactionとなり、dirty、undo/redo、保存前flushへ通常のCanvas操作と同じように接続します。
未適用のTurtle、意味form、overlay sourceを同時確定せず、先にどのdraftを適用または破棄するか示します。
日常的な位置、size、route、style調整はCanvasと右Inspectorを主入口とします。

Sceneへ表示するdiagnosticは操作のscopeに合わせます。Edge端点変更では変更edgeと旧新endpointに
関係するlayout diagnosticだけを返し、既存または別named viewの同じ警告を再掲しません。Semantic/profile
diagnosticは全viewで保持し、同一identityの通知は一件へまとめます。Overlay-only変更は以前のlayout
warningを次のSceneへ持ち越しません。

## 右クリックとビュー編集

Pointerの右click、Canvasのactive itemに対するContext Menu keyまたはShift+F10は、対象を選択して右Inspectorの`ビュー`tabと該当段階を直接開きます。別のcontext menuやCanvas横のpopoverは出しません。右クリックから意味の追加・変更・削除を開始せず、入口を開いただけではdocument、overlay、historyを変更しません。未適用の意味draftも破棄しません。Canvas本体のsingle-tab-stop listbox、`aria-activedescendant`、live statusの規範は[accessibility.md](./accessibility.md)を参照してください。

## Resourceの作成

`要素を追加`はactive localeのlabelだけを要求します。空文字列は拒否し、hostのresource IRI allocatorが許可namespace内の衝突しないopaque IRIを発行します。内部で検証する初期graph patchは次の一文だけです。

```turtle
<allocated-opaque-iri> rdfs:label "入力したlabel"@ja .
```

確定後のprojectionはgeneric node fallbackと標準layoutでdisplayを補完します。初期位置、template、iconを同じsemantic transactionに含めません。分類、概念クラス化、説明、上位概念は`要素の詳細を編集`、edgeは`関係の意味を編集`、領域membershipは`所属・並び順を編集`、位置やiconは`ビュー`から別の明示操作として行います。これにより作成失敗をlabel/allocator/profile検証へ限定し、初回formでRDFの種類や関係を理解させません。

Allocatorが失敗、衝突、許可namespace外のIRIを返した場合は確定せず、「要素を作れませんでした。再試行してください」等のaction付きerrorを示します。完全IRIはAdvanced詳細でread-only表示します。Canvas上のghostは確定前の一時表示であり、Cancel、Escape、失敗時に消え、documentやoverlayへ保存しません。

Concept classや関係種別を定義する場合も、初回作成formで種類を選ばせません。Human vocabulary definitionを許すprofileでは作成済みresourceを`rdfs:Class`または`rdf:Property`等へ変更する後続の`要素の詳細を編集`を、一回のvalidationとtransactionとして提供します。禁止profileではその編集候補を無効理由付きで出しません。Templateやiconを正当化するためだけの`rdf:type`は生成しません。

## Detailsとproperty編集

右Inspectorの`要素の詳細を編集`で対象を選んだ後、resourceのlabelを見出しにしたdetails/property dialogを段階入力として開けます。Details dialogを独立した意味編集入口にはしません。通常表示ではlabel、値の種類、関係先を読みやすく示し、完全IRI、datatype、language、exact tripleはread-onlyの`Advanced`または詳細領域に置きます。Standard editorはAdvanced identityやexact statementを直接編集する入力欄を持ちません。

Property編集はsubjectとpredicateの値集合を扱います。複数のIRI/literal値、literalのdatatypeまたはlanguage、空文字列literalを区別します。値を空にする明示削除と、空文字列を一値として保存する操作は同じではありません。`rdfs:member`や`rdf:_n`などの構造predicateは通常propertyとして編集せず、包含、順序、選択の専用actionを使います。

通常detailsは、RDF statementの平坦な一覧ではなく、`名前・説明・別名`、`分類・概念階層`、`関係・参照`、`データ属性`、`Advanced identity`へ分けます。`rdf:_n`は順序editorだけに表示します。Predicate resourceを編集する場合は「関係種別」としてlabel、comment、`rdfs:subPropertyOf`を示し、label変更が同じpredicateを使う全edgeへ反映されることを説明します。

Labelとcommentは複数行literalを入力でき、language別の値集合として編集します。Canvasの既定labelはactive localeのprimary label一つです。同一languageの`rdfs:label`が複数ありprimaryを決定できない場合は警告し、別名を必要とするprofileは`skos:altLabel`等の標準語彙を明示的に許可します。文字列をidentityやrule matchingには使いません。

Dialogは表示時に見出しまたは最初のfieldへfocusし、focusをdialog内に保ちます。EscapeまたはCancelは未適用draftを破棄し、閉じた後は存在するopenerまたはCanvasのactive itemへfocusを戻します。Semantic propertyはdialogの保存操作一回で共通validationとtransactionへ進み、dialogを閉じただけでは保存しません。

## Edgeの作成と接続点

Edge作成はsource、predicate、targetを明示するsemantic authoringです。`関係を追加`を開いた時点でresourceを一つだけ選択していればそれを始点にし、続くCanvasの通常clickを終点として受け取ります。事前のCtrl/Cmd複数選択は要求しません。始点を終点pickerへ自動転記せず、同じnodeの通常clickは次段階へ進めません。自己関係は専用の「始点自身へ接続」actionを利用者が明示した場合だけcandidateにし、profile/domain validationを通ったときだけ確定します。始点変更後は古い終点を破棄し、blank、region、container、Escapeは未接続のsemantic stateを保存しません。

Canvas gestureを使う場合も、最初のresourceと次のresourceをsession draftへseedするだけで、線を引いた時点ではTurtleへ書き込みません。Predicateはlabel-firstのcatalog/profile候補から選び、standard editorのAdvancedはread-onlyで候補外IRIの入力欄を持ちません。空欄をgeneric predicateで補完することはありません。

Predicate pickerは「分類」「参照」「依存」「由来」等のcategoryごとに候補をまとめ、候補名を`A（predicate label）B`、補足説明をsubjectが`A`、objectが`B`の短い日本語例文として表示します。たとえばPROV-Oの派生関係は「A（派生元）B」と「AはBから派生した」を併記します。A/Bは基準要素と相手要素の役割を比較するためだけの仮記号で、確定後のedge表示には実際の要素名とpredicate labelだけを使います。語順、助詞を含む文型、comment、category、利用例は解決済みcatalog/vocabulary metadataから得て、IRI local nameや英語labelの機械分割から生成しません。Metadataが不足する候補は`A（通常predicate label）B`という決定的fallbackを使い、意味を推測しません。

`要素の詳細を編集`の「要素の種類」は`rdf:type`の編集です。選んだclassが現在のviewで概念領域にも投影される場合はその旨を併記しますが、同じtripleを独立した所属操作から二重編集しません。「所属する領域」は`rdfs:member`またはその下位predicateによる業務上の所属を編集する別sectionです。Nodeを選んだ意味編集には入出力関係、方向、相手要素を、direct edgeを選んだ意味編集には始点、関係、終点、個別説明をまとめて示します。重なってCanvasから直接押せないedgeもこの一覧から選択してrevealできます。

候補集合はactive authoring profileが許可し、解決済み標準catalogが提供するRDF/RDFS/OWL、DCTERMS、PROV-O、SKOS等の関係語彙を基準にします。Source/targetの明示型と限定`rdfs:subClassOf` closure、predicateの`rdfs:domain`/`rdfs:range`、object/literal kind、catalog capabilityを使って型適合するものへ絞ります。完全なOWL推論をpicker内で実行しません。型情報が不足する場合は適合を断定して除外せず「型未確認」として後順位に残し、候補graphは確定前の共通validationへ必ず通します。全predicateを平坦に並べず、検索とcategory絞り込みを提供します。近い既存predicateがない場合は、standard editor内でIRIを入力させずcatalog/vocabularyの整備を促します。表示名が同じ候補は説明とread-only Advanced IRIで識別します。

Predicateから導出するedge labelは関係種別の意味表示です。個々のdirect edgeへ利用者が追加する「この関係の説明」は`選択対象の意味を編集`の意味操作とし、asserted S/P/Oを残したRDF 1.1標準reificationの`rdfs:comment`として保存します。複数language・複数行を扱い、predicate自体のlabel/commentとは区別します。これにより説明は意味検索とLLM contextへ含められます。View overlayのlegacy captionは表示専用データとして読み込めますが、標準Editorは意味説明の入力先として使いません。

`ビュー`tabで選択edgeの始点と終点haloをdragすると、接続nodeの周囲だけを移動できます。Anchorは外周上の正規化値としてoverlayへ保存しますが、通常Inspectorへ数値入力を露出しません。Haloのdrag中はrouteを一時previewし、pointerupで一つのpresentation historyへ確定します。右InspectorはCanvas操作の案内とautomaticへのresetだけを提供します。

Anchor、waypoint、Bezier curve control、label offsetはsparse routing overlayであり、edgeのsource、predicate、targetという意味は変更しません。`意味`tabでwritableなdirect edgeを選ぶと、始点または終点haloを別の有効nodeへdropした時点で、元statement削除、新statement追加、個別statement commentの移送を一つのsemantic transactionとして検証・確定します。空白、region、containerへのdropは変更を作らず、元の接続を維持します。途中の未接続状態はgraphにもoverlayにも保存しません。`ビュー`tabの同じ端点操作はnode周囲の接続位置だけを変更します。

Edgeを選択して`ビュー`の`線の表示`を開くと、最初に経路形式と端子形状だけを示します。経路modeは`auto`、waypointを持たない`straight`、自動直交の`orthogonal`、Bezier knot/handleを持てる`curve`、利用者経路点を持つ`manual`を区別します。ラベル・補足と接続位置は折り畳み段階へ分け、projection rule、source/target anchor、Bezier controlの内部座標は通常UIへ出しません。Curve pathのdouble clickまたはInspectorでon-curve knotを追加し、Canvas上のknot/handle dragで角度と曲率を変更します。Curve controlは個別のtab stopを増やさずCanvasを一つのcomposite widgetとして扱い、`[`/`]`で対象を循環、Ctrl/Cmd+Arrowで移動、`W`/Insertでknot追加、Ctrl/Cmd+Deleteでknotまたはmanual handle削除を行います。一回のkey repeatは一つのundo履歴へまとめます。Inspectorの`自動曲線へ戻す`はsparse curve control全体を除きます。選択中のanchor、manual waypoint、curve knot/handleだけはnodeより前面のtransient interaction layerへ表示し、背後の要素と重なっても操作可能にします。通常edge線とterminal markerはedge層に留め、curveはstraight/polylineを重ねず単一のcubic SVG pathとして描きます。Fitと個別edgeのrevealはいずれも、保存済みcontrolだけでなくautomatic controlの外接範囲も含めます。

## Appearance editor

Template、icon、style、geometry等のdisplay項目は、右Inspectorの`ビュー`内で編集します。Canvas外のpopoverや別の「適用」確認は使いません。Checkbox、select、preset、resetは操作時に一つのpresentation transactionとして直接確定します。Color、range、numberは`input`中だけ一時Sceneへpreviewし、`change`で変更前後を一つのpresentation history itemとして確定します。Inline editorの`閉じる`は既に確定した変更を取り消さずsectionだけを畳み、確定前のsession previewだけを破棄します。同じpointer gestureや連続入力をkey repeatごとに複数のundo itemへ分割しません。

Catalogから再生成できるappearanceはportable documentへ複製しません。ユーザーが選んだtemplate/icon等だけをoverlay overrideとして保持し、「既定へ戻す」でoverrideを除去します。Template/shapeはIRI文字列のselectでなく、実shape・style・iconの小previewから選びます。Workspace assetはhost pickerがabsolute asset IRIだけを返すか、hostが`assetRef`と正確なworkspace pathの候補を注入します。利用者は候補pathを選び、Editorは対応するasset IRIだけを保存します。URL、認証情報、画像bytes、手入力されたIRIはdocumentへ保存しません。

Nodeの`ビュー`は少なくとも色、透明度、線、template、package同梱またはhost workspaceから選ぶicon、位置、sizeを扱います。選択中はCanvas上のlabelとiconを個別にdragでき、node中心からの相対offsetだけをsparse appearanceへ保存します。Drag中はCanvasでpreviewし、node外へ完全に失われない範囲へclampします。右Inspectorからlabel/icon位置を別々にresetでき、一gestureを一つのundo itemにし、Turtleとnode geometryは変更しません。Resize可能なnode、container、regionは四隅と四辺中央の8 handleだけをtransient interaction layerへ表示し、背面要素と重なっても操作できます。選択中のobject本体は元のsemantic層を越えません。Regionのresize制約は後述のmembershipを優先します。

Edgeは線、色、太さ、経路modeに加え、source/targetそれぞれのterminal shapeを閉じた候補から選べます。候補は`none`、arrow、open arrow、triangle、diamond、circle等をpreview付きで示し、catalog既定へ戻せます。Terminalとrouteはpresentation情報であり、predicate identityやRDFS/OWL上の型を変更しません。Exact edgeの意味説明はこの`ビュー`段階へ混ぜず、`意味`tabの関係変更から編集します。

Region labelは固定した上下左右のselectだけでなく、外周上のanchorをdragして移動できます。Label directionは`右向き水平`（horizontal-right）または`下向き垂直`（vertical-down）を選び、anchor、offset、directionをsparse overlayとして保存します。Region同士の前後関係はview内のregion z-orderとして編集できますが、node、edge interaction handle、focus indicatorをregion背景より背面へ隠しません。

Nodeの`ビュー`ではラベルとアイコンの相対位置に加えて、ラベルを横書きまたは縦書きへ切り替えられます。既定の横書きは保存せず、縦書きだけを`appearance.nodeLabelWritingDirection`へsparseに保存します。文字方向を変えてもTurtle、ラベル文字列、node geometryは変更せず、位置調整・resize・undo/redoと同じpresentation historyで扱います。

Diamond nodeはnode box全体を回転せず、geometryと同じ未回転の座標系へbackground/border用のdiamond surfaceだけを描画します。Label、icon、drag hit area、8 resize handleはaxis-alignedのままとし、横書きは横長、縦書きは縦長の内接content boundsへ収めます。これにより長い日本語labelは内接範囲で折返し・clipされ、一文字幅への縮退やcounter-rotateによる方向反転を起こしません。Label本文はTurtle、文字方向とlabel/icon offsetはsparse appearanceという正本境界を維持し、layoutとendpoint計算はtemplateの実geometryだけを参照します。

Canvasの`ビュー`tabは、薄いgridの表示/非表示toggleを持ちます。Grid間隔はsnapのsession設定と同じcanvas unitを使い、既定は8です。Zoomとscroll/panでは画面へ固定せずCanvas座標へ追従し、node、edge、region、空白Canvasのpointer/keyboard hit testを阻害しない非interactiveな背景layerに描画します。Toggleとgrid sizeはeditor session stateであり、Turtle、view overlay、portable document、presentation history、dirty stateへ保存しません。`readOnly`でも閲覧用toggleは利用できます。

Nodeをdragしてviewport端から48px以内へ近づけると、viewportはpointer方向へ段階的にpanします。これはnavigation sessionだけを更新し、node geometryは通常のdrag transaction一件としてpointerup時に確定します。

作業領域は実content boundsの外周に初期320 canvas unitの余白を確保します。Drag/resize中にpreviewが端へ達すると、pointerを離さないまま必要な正負方向へ160 unitずつ単調に拡張し、viewportの見えている位置を補正します。この余白と拡張結果はsession-onlyで、portable document、overlay、historyへ保存しません。Fitは作業領域全体ではなく負座標やrouteを含む実content boundsを対象にします。

## Regionと包含

Containerの領域上へnodeを置くことと、意味graphにmembershipを持つことは別です。通常drag、整列、snap、複数選択の移動はgeometryだけを変更し、包含tripleを推論しません。

Editorは次の不一致をCanvasとInspectorに警告します。

- 意味上は無関係なresourceが、見た目上container領域内にある
- 意味上のchildが、parent containerのcontent領域外にある
- 重なった複数領域が候補になる、または一意parentのprofileに対して複数membershipがある

不一致は自動修正しません。「意味包含を追加／外す」はcatalog provenanceに対応する構造commandを共通validationへ送り、「表示を領域内／領域外へ移動」はoverlayだけを一つのpresentation historyへ保存します。複数候補では対象containerを明示選択するまでsemantic draftを確定しません。`要素を追加`時のCanvas位置からmembershipを補完せず、作成後に`所属・並び順を編集`から対象containerを選びます。

分類、概念階層、領域所属は別actionとして表示します。複数resourceと複数class/regionを選び、追加と解除を一つのatomic transactionへまとめられます。Concept classをregionへ投影するviewでは、複数`rdf:type`の共通部分をderived intersection cellとして選択でき、cellへの分類操作は構成classのstatementを一括更新します。通常dragは意味を変更しませんが、classification-constrained viewでは現在の所属intersectionから要素を外へ出さず、別cellへの移動は「分類も変更」のsemantic draftを明示的に開始します。

Classification-constrained viewでは、複数regionに属する要素の全boundsを全regionの共通部分から外へdragできません。別cellへの移動は通常dragでは行わず、`所属・並び順を編集`から移動先classを明示します。共通部分が空または要素より小さい場合は移動を拒否し、region geometryまたはclassificationのどちらを修正するか選べるdiagnosticを返します。

Region、Seq、通常containerの移動と8-handle resizeは、意味上のmember全boundsと必要paddingを包含することをhard constraintにします。複数の枠に属するmemberは、すべての所属先contentの共通範囲内へ全boundsを保ちます。一つのSeqとmemberを同時に動かす場合も、別のSeq・region・containerから外れる候補はcommitしません。Geometryを変更してもmembershipは増減せず、membershipを変更したい場合は`所属・並び順を編集`へ移ります。外周labelとoffsetはlayoutの占有boxに含めます。

選択中のregionまたはSeq group本体は、保存された前後関係を変更せず構造layer内だけで一時前面にします。これにより重なった別region/Seqの枠に遮られず、edgeとnodeの上には出ません。8個のresize handleだけは独立したtransient interaction layerへ描画し、nodeと重なる場合も操作できます。選択解除時は元の描画順へ戻し、選択による前面化をView overlay、history、dirty stateへ記録しません。

## Comment表示

`rdfs:comment`は意味graphから導出するannotationであり、view overlayへ本文を複製しません。既定はhoverまたはkeyboard focusで全文tooltipを表示し、session/viewの「コメントをすべて表示」で折り返したcalloutを表示します。Stable comment layoutを選んだviewは非表示時も同じcallout boundsをlayout obstacleとして予約し、表示toggleでnodeやedgeが動かないようにします。Region背景は障害物にせず、通常nodeとcomment calloutの重なりを避けます。

## 順序と分岐

`rdf:Seq`は薄い外枠の順序付きgroupと各memberの番号badgeで表示し、通常の関係線とは区別します。`rdfs:label`はgroup headerへ一度だけ表示し、member間のedgeやAlt branch edgeのlabelへ転記しません。`所属・並び順を編集`を開く前は順序・包含候補を展開せず、Seq groupまたはそのmemberをCanvasで選択した後だけ、label付きcardの追加・上下移動・除外を表示します。利用者に`rdf:_1`等のpredicateやIRI改行textareaを表示せず、確定時は標準`rdf:Seq`/`rdf:_n`を`set-sequence`で一括再構成します。`rdf:Alt`がSeqを選択肢にする場合は、選択nodeからSeq group境界への無名branchとして表示します。

## 削除などの破壊操作

選択中のresource、edge、membership、Seq/Alt memberは右Inspectorの削除操作またはDelete/Backspaceから削除できます。Core内部では必ずcandidate patchを検証し、同じ選択に含まれるものだけを削除する場合は確認modalを出さず一つのatomic transactionとして確定します。

Resource削除が、選択していないincident edge、membership、Seq/Alt membershipへ波及する場合だけ、human label付き影響一覧の削除modalとCanvas上の赤線を表示します。利用者が`影響も含めて削除`を選んだ場合だけ確認した集合をatomicに削除します。影響する表示objectをすべて選択済みならmodalは不要です。Seq/Alt memberの削除では残るordinalも同じpatchで再採番し、最終制約を満たさなければ全体をrollbackします。Scene provenanceがない要素は、表示からpredicateや削除対象を推測しません。

削除modal中は対象node/edge/regionを赤い取消線または赤い破線で示せますが、これは確定前のsession-only previewです。Portable overlay、Scene正本、history、保存documentへpending deleteや赤線を記録しません。Cancel、Escape、draft切替、reloadで消えます。Resourceの永続削除は確認済みcascade semantic patchの確定だけで行い、soft deleteやpresentation-only deleteを設けません。個別edge、property、membershipの削除もexact semantic patchであり、赤線だけを保存して削除済みと扱いません。

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

保存前にはcomponent refの`flushPendingEdits()`を`await`します。未適用Turtle draftは検証して確定できますが、入力中のstructured formや確認中の削除を自動実行せず、保存要求を拒否します。
Hostは`pendingDraftsChanged`を購読し、`v-model` dirtyと合わせてSave buttonを有効化します。このeventはmount時、draftの発生・適用・破棄、read-only切替、外部`modelValue`置換に追随する現在値であり、Turtle textareaのbyte列をhost側で比較する必要はありません。
