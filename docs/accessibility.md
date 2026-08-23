# Accessibility and keyboard editing

この文書は`IriographDiagramCanvas`と標準`IriographEditor`のkeyboard/focus契約を定める。意味graph、Turtle、projection規則はaccessibility操作のために変形しない。Keyboardによる位置、size、manual routingの変更はpointer gestureと同じpresentation transactionを通り、semantic sourceを変更しない。

## Scene navigator

Canvasは一つの`tabindex="0"`を持つmulti-select listboxである。Node、container、edgeは同じnavigator内の`role="option"`であり、個別tab stopを持たない。Resize handle、edge label、waypoint、minimapもCanvas内の追加tab stopを作らない。ToolbarやInspectorの通常controlへはTabで移動できる。

Active itemはCanvasの`aria-activedescendant`から実DOM descendantのstable IDへ参照する。順序はprojectionや現在座標に依存せず、container、node、edgeの順とし、各kind内は`elementId`のcode-point昇順とする。Range選択も同じ順序を使い、range終端をprimary selectionとする。

Scene再投影ではstable `elementId`が存続する限りfocusを維持する。Active itemが消えた場合は旧順序と同じindex、末尾を越える場合は新しい末尾、空SceneではCanvas自身へfallbackする。Pointerや公開selection APIでprimary selectionが変わった場合は、そのstable IDをactive itemにする。

## Keyboard command table

`Ctrl`はmacOSでは`Command`でも同じ意味を持つ。

| Key | Operation |
| --- | --- |
| Arrow | 前後のitemへactive focusを移す。Right/Downがnext、Left/Upがprevious |
| Home / End | 最初 / 最後のitemへfocusを移す |
| Shift + Arrow | Anchorから移動先までをrange選択し、移動先をprimaryにする |
| Enter / Space | Active itemだけを選択する |
| Ctrl + Space | Active itemの選択をtoggleする |
| Ctrl + A | 全Scene itemを選択する |
| Page Up / Page Down | Viewportを縦panする。Shift併用は横panする |
| Ctrl + Arrow | 選択node/containerを1 canvas unit移動する。Active itemがedgeならactive waypointを1 unit移動する |
| Ctrl + Shift + Arrow | Active node/containerのwidth/height、またはedge label offsetを10 canvas unit変更する |
| `[` / `,`、`]` / `.` | Active edgeの前 / 次のwaypointを編集対象にする |
| `W` / Insert | Active edgeの最長segmentへwaypointを追加する |
| Ctrl + Backspace / Delete | Active waypointを削除する |
| Delete / Backspace | 既存のsemantic authoring draftをseedする。Graphを直接削除しない |
| Escape | Presentation preview中は破棄する。それ以外は選択を解除する |

Command判定はVue、DOM、Sceneの操作から分離したpure resolverで行う。優先順位は`Ctrl + Shift + Arrow`のsecondary presentation edit、`Ctrl + Arrow`のprimary presentation edit、`Shift + Arrow`のrange、Arrow focusの順である。将来Inspector valueやendpoint anchorを追加するときも、この判定を再利用し、Canvasとglobal shortcutで同じeventを二重適用しない。

## Gesture and history

Presentation keyの最初の`keydown`でgestureを開始し、key repeat中はlocal previewだけを更新する。`keyup`またはCanvasの`blur`で一度だけdocumentへcommitし、一つのundo history itemにする。`Escape`はdocumentを変更せずpreviewを破棄する。Pointer操作と同じoverlay更新、projection、history境界を使う。

`input`、`textarea`、`select`、有効な`contenteditable`内のkey eventとIME composition中のeventはCanvas/global shortcutへ渡さない。`readOnly`でもfocus移動、選択、pan、zoom、revealを許可するが、presentation/semantic writeは発行しない。

## Status, dialogs, and visual targets

Sceneの非同期更新はCanvasの`aria-busy`で通知する。Focus、selection、編集対象、commit/cancelはpolite live regionへ短く通知し、projection errorは`role="alert"`を使う。Optionは`aria-selected`、position、set size、kind、label、primary状態を公開する。

標準view dialogはopenerを記録し、表示時に最初のfieldへfocusし、Tabをdialog内で循環させる。Escapeで閉じ、閉じた後は存在するopenerへfocusを戻す。

Canvas focusとactive itemは色だけに依存しない3pxのringを持つ。Edge hit area、waypoint、resize handleはpointerで扱えるtargetを拡張する。Catalog由来の任意色はIriographが一律にcontrast保証できないため、catalog authorはnode/label/backgroundのWCAG contrastを検証しなければならない。標準editor chromeとfocus indicatorはWCAG AA相当のcontrastを維持する。

## Host responsibilities

HostはCanvas shortcutを横取りする場合、処理済みeventの`defaultPrevented`を尊重する。Editor外のdialog、toast、asset pickerを注入する場合もinitial focus、Escape、focus return、live statusを同じ契約で実装する。Asset imageは装飾iconなら空`alt`を保ち、意味をiconだけに依存させない。
