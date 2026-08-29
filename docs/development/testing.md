# 開発・検証

Iriographはpure graph処理、Vue component、実browser、配布tarball、利用hostを別々の層で検証します。Pointer操作や非同期保存をunit testだけで代用せず、変更した責務に最も近い層へ回帰testを置きます。

## 必須command

通常の変更は固定Node/Docker環境で次を実行します。

```sh
npm run verify
```

これは11 packageとMockのtest、typecheck、build、lockstep version検証、packed tarball consumer検証を行います。Editor UI、transaction、layout、asset、host interactionを変更した場合は実Chromiumも通します。

```sh
npm run verify:e2e
```

Browserがない環境ではrepositoryと同じPlaywright versionを含むimageを使います。

```sh
docker build -f Dockerfile.e2e -t iriograph-e2e .
docker run --rm --ipc=host iriograph-e2e
```

性能・描画gateは通常E2Eから分離します。

```sh
docker run --rm --ipc=host iriograph-e2e npm run verify:performance
docker run --rm --ipc=host iriograph-e2e npm run verify:browser-performance
```

完了前に最新sourceからMockを起動し、HTTP応答、通常幅と狭幅、保存・再読込、console error、失敗requestを確認します。

## Testの配置

- Pure dataset、projection、authoring、layout、reconciliationは`packages/core/src/<責務>/`に実装とtestを置く
- RDF交換、profile、semantic access、agent/presentation contractは各package内で検証する
- Pointer座標、keyboard、ARIA、SVG経路は`@iriograph/vue-editor`のhelper/component testへ置く
- Document transaction、history、pending flush、semantic/presentation分離は`IriographEditor` integration testへ置く
- Browserの実event、CSS、grid、scroll、asset decode、Mock保存は`e2e/`へ置く
- MockとCloudの機能差は`@iriograph/host-conformance`の同じmanifest・fixture・browser checkで検証する

## 不変条件

- Semantic transaction失敗時はsourceだけでなく、document、Scene、全named view、historyをatomicに維持する
- Overlay-only操作はTurtleを変えず、全体layoutを起動しない
- Semantic変更は全viewを検証し、存続identityのsparse overlayを維持する
- External/LLM candidateはrevision、context、exact patchへ束縛し、通常の人操作へ追加confirmationを持ち込まない
- Asset byte、署名URL、認証情報をdocument、semantic DTO、snapshotへ入れない
- Raw IRIは通常UI/DOMへ出さず、editable sourceと内部transaction identityに限定する
- Named viewのselection、viewport、temporary hide、folding、gridはsession stateとし、dirty/historyへ入れない
- 自動routeは安全なstraight、一直角orthogonal、bounded Bezierの順で、公開中間点は最大1個にする
- Group/memberのdrag・resize・membership追加は全membership intersectionとnested containmentを破らない

## Layout・性能gate

Coreのnormal/stress fixture、small graph phase timing、prepared relation transaction、実browser pan/drag、production settled timingは固定fixture、固定sample、固定budgetで判定します。Budgetやfixtureを変える場合は、同じ変更で[Layout・routing・性能](../editor/layout.md)の理由とtestを更新します。異なるmachineの絶対値を時系列比較しません。

参照図の構造100点評価、画像proxy、agent prompt、token/cycle、過去versionの実測値は[評価履歴](../evaluations/reference-reconstruction.md)へ分離しています。評価結果をseed IRI、label、件数に特化したlayout分岐へ昇格しません。

## Test追加規則

- CoreへDOM/browser mockを入れない
- Pointerの座標変換はcomponent、document revision/historyはEditor integration、実dispatchはPlaywrightで分ける
- 一gestureはmove event数にかかわらず一history itemとし、Escape/cancel/abortは正本を変えない
- Async結果はdocument、view、revision、context fingerprintへ束縛し、stale completionを破棄する
- Authoringはopaque option IDをexact termへ解決し、unknown term、role conflict、namespace衝突をfail closedにする
- Direct edge、membership、Seq/Alt、type、localized textの追加・削除・再接続を個別のprovenance付きtransactionとして検証する
- Deleteは選択外への波及がある場合だけ影響一覧を確認し、Seq/Alt ordinalを同じatomic patchで再構成する
- Appearanceはcatalog既定を複製せず、変更fieldだけをsparse overlayへ保存する
- Assetはencoded byte上限とdecoded pixel上限、MIME/signature、abort時lease解放を別々に検証する
- Accessibilityはsingle tab stop、実DOM ID、focus return、Escape、busy/status/alert、keyboard-only経路を固定する
- Browser testのsample数やfixture件数へ依存するassertionを変える場合は、fixture・budget・文書を同じ変更に含める
