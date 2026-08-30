# Accessibility・keyboard操作

この文書は`IriographDiagramCanvas`と標準`IriographEditor`のkeyboard/focus契約を定める。意味graph、Turtle、projection規則はaccessibility操作のために変形しない。Keyboardによる位置、size、manual routingの変更はpointer gestureと同じpresentation transactionを通り、semantic sourceを変更しない。

## Scene navigator

Canvasは一つの`tabindex="0"`を持つmulti-select listboxである。Node、container、region、edgeは同じnavigator内の`role="option"`であり、個別tab stopを持たない。Resize handle、edge label、waypoint、minimapもCanvas内の追加tab stopを作らない。ToolbarやInspectorの通常controlへはTabで移動できる。

Active itemはCanvasの`aria-activedescendant`から実DOM descendantのstable IDへ参照する。順序はprojectionや現在座標に依存せず、container、region、node、edgeの順とし、各kind内は`elementId`のcode-point昇順とする。空間移動とfocus移動を混同しないため、focus移動には明示的な`N` / `Shift+N`を使う。

Scene再投影ではstable `elementId`が存続する限りfocusを維持する。Active itemが消えた場合は旧順序と同じindex、末尾を越える場合は新しい末尾、空SceneではCanvas自身へfallbackする。Pointerや公開selection APIでprimary selectionが変わった場合は、そのstable IDをactive itemにする。

## Keyboard command table

`Ctrl`はmacOSでは`Command`でも同じ意味を持つ。

| Key | Operation |
| --- | --- |
| Arrow | 位置を持つ選択要素を1 canvas unit移動する。移動対象がなければViewportを同方向へpanする |
| Shift + Arrow | 位置を持つ選択要素を10 canvas unit移動する。移動対象がなければViewportを同方向へpanする |
| N / Shift + N | 次 / 前のitemへactive focusを移す |
| Home / End | 最初 / 最後のitemへfocusを移す |
| Enter / Space | Active itemだけを選択する |
| Ctrl + Space | Active itemの選択をtoggleする |
| Ctrl + A | 全Scene itemを選択する |
| Page Up / Page Down | Viewportを縦panする。Shift併用は横panする |
| Ctrl + Arrow | 選択node/containerを1 canvas unit移動する。Active itemがedgeならactive waypointを1 unit移動する |
| Ctrl + Shift + Arrow | Active node/containerのwidth/height、またはedge label offsetを10 canvas unit変更する |
| `[` / `,`、`]` / `.` | Active edgeの前 / 次のwaypointを編集対象にする |
| `W` / Insert | Active edgeの最長segmentへwaypointを追加する |
| Ctrl + Backspace / Delete | Active waypointを削除する |
| Delete / Backspace | Active itemを含む現在の選択をsemantic削除する。選択外の関係・所属・順序へ波及する場合だけ影響一覧dialogを開く |
| Escape | Presentation preview中は破棄する。それ以外は選択を解除する |
| Context Menu / Shift + F10 | Active item、または空白Canvasの対象別context menuを開く |

Command判定はVue、DOM、Sceneの操作から分離したpure resolverで行う。優先順位は`Ctrl + Shift + Arrow`のsecondary presentation edit、`Ctrl + Arrow`のprimary presentation edit、plain/Shift Arrowの移動またはpan、`N` / `Shift+N`のfocus移動の順である。将来Inspector valueやendpoint anchorを追加するときも、この判定を再利用し、Canvasとglobal shortcutで同じeventを二重適用しない。処理したArrowは`preventDefault`してhost pageのscrollへ漏らさない。

## Gesture and history

Presentation keyの最初の`keydown`でgestureを開始し、key repeat中はlocal previewだけを更新する。`keyup`またはCanvasの`blur`で一度だけdocumentへcommitし、一つのundo history itemにする。`Escape`はdocumentを変更せずpreviewを破棄する。Pointer操作と同じoverlay更新、projection、history境界を使う。

Toolbarの`Canvasドラッグモード`は`範囲選択`と`移動`を排他的な押下状態として公開する。Primary pointerの空白または未選択Group Frame interior dragは選択中modeに従い、既定の範囲選択では選択枠と終了件数をlive regionへ通知する。選択済みGroup Frameの空内部dragは両modeで選択集合のgeometry移動を優先し、前面objectとFrameの永続z順は維持する。Shiftは既存選択へ追加、Ctrl/Cmdはtoggleとし、structured authoringの対象picker中も同じgestureをaccepted kindと件数制約へ通す。移動modeはviewport panだけを行う。Canvasの完全な空白を単clickした場合だけ通常選択を解除し、Canvas外のcontrol操作では維持する。中ボタンまたはAltによる一時panは両modeで利用でき、mode自体はdocument、history、dirty stateへ入れない。

`input`、`textarea`、`select`、有効な`contenteditable`内のkey eventとIME composition中のeventはCanvas/global shortcutへ渡さない。`readOnly`ではArrowによる位置変更を発行せずpanとして扱い、focus移動、選択、pan、zoom、revealを許可する。

## 対象別context menu

Pointerの右clickとContext Menu / Shift+F10は、対象、利用可能action、無効理由が同じmenu modelを使う。Keyboardで開く場合はactive itemの画面上の境界、空SceneではCanvasの既定anchorへ配置し、menu containerへfocusを移す。最初の有効項目、次/前、先頭/末尾への移動はArrow、Home、Endで行い、disabled項目はfocus移動で飛ばす。EnterまたはSpaceは選択項目に対応するInspector/actionへfocusを移すだけで、menu選択そのものからsemantic/presentation mutationを実行しない。

Escape、外側click、action選択で閉じた後は、存在する元のCanvas active itemまたはCanvas本体へfocusを戻す。Derived順序ガイド・候補線は所有する構造をaccessible nameとdestinationに含め、線単体の編集項目を作らない。Iconを表示する場合も選択中localeのlabelをaccessible nameとして必ず残し、読み取り専用、権限不足、操作対象なし等は`aria-disabled`と説明文で通知する。

## Status, dialogs, and visual targets

Sceneの非同期更新はCanvasの`aria-busy`で通知する。Focus、selection、編集対象、commit/cancelはpolite live regionへ短く通知し、projection errorは`role="alert"`を使う。Optionは`aria-selected`、position、set size、kind、label、primary状態を公開する。

標準details dialog、削除影響dialog、「新しい図として複製」のIRI対応preview dialogはopenerを記録し、
表示時に最初のfieldまたは主操作へfocusし、Tabをdialog内で循環させる。Escapeで閉じ、閉じた後は存在する
openerへfocusを戻す。削除dialogは選択外へ波及する関係・所属・順序がある場合だけ開き、影響をlabel付きlistとして
読み上げ、確認操作以外でgraphを変更しない。複製dialogは旧新document identity、変更resourceのlabel-first一覧、
overlay対応件数、diagnosticを読み上げ、確定しても現在の文書を置換せずhost handoffだけを発行する。選択集合内だけの
削除と非削除の意味・ビュー操作は確認dialogを開きません。

Document sourceのView overlayと全文Document JSONは通常の`details`で個別に開閉でき、summaryからtextarea、
整形、元に戻す、検証して適用の順にfocusできる。JSON errorはJSON Pointerと日本語の修正行動を該当section内の
`role="alert"`へ出し、別tabのread-only Turtle全文をkeyboard利用者へ重複して読ませない。

標準tabは`図`、`型一覧`、`Turtle`、`Document`を押下状態付きbutton groupとして読み上げる。型一覧のtree/DAGは
各行へ階層level、選択状態、直接・継承別件数を持たせ、複数親による再出現を「同じ型への参照」と明示する。
図上の代表型tagは要素名と型名をaccessible nameへ含め、起動するとそのexactな型と要素へfocusした型一覧を開く。
型の作成・編集は名前、説明、上位の型をlabel付きcontrolで扱い、生IRI、`rdf:type`、`rdfs:subClassOf`を
通常DOMへ出さない。Cycle errorと参照中削除の影響は対象名と修正行動をalert/dialogで通知し、focus returnを保つ。

Canvas focusとactive itemは色だけに依存しない3pxのringを持つ。Edge hit area、waypoint、resize handleはpointerで扱えるtargetを拡張する。Catalog由来の任意色はIriographが一律にcontrast保証できないため、catalog authorはnode/label/backgroundのWCAG contrastを検証しなければならない。標準editor chromeとfocus indicatorはWCAG AA相当のcontrastを維持する。

Compact Inspectorは文字と余白を縮めても、labelとcontrolの関連付け、visible focus、keyboard順序、行全体を使うpointer targetを維持します。Inlineビュー編集のcheckbox/select/preset/resetは操作時に確定したことをlive statusへ通知し、color/range/numberはinput中の値を過剰に読み上げずchange時の一回だけ確定を通知します。

Semantic object本体の視覚層は選択時にも`region/sequence group < edge < node`を越えません。選択したregion/Seq本体をnodeの上へ出す方法でtargetを確保せず、waypoint、endpoint halo、8方向resize handleだけを独立したtransient interaction layerへ描画します。このhandleはpointer targetを最上位で確保しますが追加tab stopにはせず、同じ操作を上表のkeyboard commandからも利用できます。狭幅hostでもCanvas内部scroll、sidebar折り畳み、fit、minimapによって全Scene itemと外周handleへ到達可能にします。

## Host responsibilities

HostはCanvas shortcutを横取りする場合、処理済みeventの`defaultPrevented`を尊重する。Editor外のdialog、toast、asset pickerを注入する場合もinitial focus、Escape、focus return、live statusを同じ契約で実装する。Asset imageは装飾iconなら空`alt`を保ち、意味をiconだけに依存させない。
