# 検証方針

Iriographはpureなgraph処理、DOM event contract、editor transaction、実browser host連携を異なる層で検証します。pointer座標や非同期保存をpure unit testだけで代用せず、失敗箇所を特定できる最小の層にtestを置きます。

## 通常の検証

`npm run verify`は次を実行し、headless browserのdownloadを要求しません。

- Coreのparse、validation、projection、layout、reconciliation、serializer、asset policyのunit test
- Semantic validation portのsnapshot/fingerprint、adapter fail-closed、warning confirmation、abort、全write入口共通化のunit test
- Vue editorのasset lease session test
- happy-dom上の`DiagramCanvas` pointer/keyboard component test。dragのzoom換算、multi-selection、group preview/batch、container clamp、resize minimum、endpoint込みroute、source/target anchor、generated bend seed、waypoint追加・削除・移動、label offset、parallel/self-loop選択、single-tab-stop navigator、`aria-activedescendant`、決定的focus/range、key repeat previewとkeyup/blur commit、Escape cancel、readOnly/IME除外、pan競合、fit、minimap、selection revealとgesture境界を確認する
- happy-dom上の`IriographEditor` integration component test。単体/batch overlay transaction、sparse routingとlegacy event非二重適用、gesture・整列・等間隔単位のundo/redo、Turtle不変、label-first semantic authoring、Canvas resource picker、resource＋edge＋membership作成、display/semantic containment警告と明示修正、Turtleのaccept/rollback、保存前flush、session selection/navigationとread-only境界を確認する
- Core/View editorのnamed view test。target-only atomic command、immutable/unique ID、locale-only exact overlay、invalid view delete、last-view guard、controlled/uncontrolled active view、view別selection/viewport/temporary hideを確認する
- 全workspaceのtypecheck/buildと、packed tarballを使う外部consumer検証

Component testは`@iriograph/core`のsourceへtest時だけaliasし、未buildのclean checkoutでも単独実行できます。配布buildではCoreをexternalのまま保ち、test fileは型宣言とpackage tarballへ含めません。

## P1-08性能回帰

Coreの通常Vitest suiteは固定生成されるnormal 500 node/1,000 edgeとstress 2,000 node/4,000 edgeを使い、Turtle parse、semantic projection、標準layout、layoutを除く代表編集再投影を監視します。Fixtureは50 nodeごとの`rdf:Bag` containment、全nodeのlabel、重複しない前方向edgeを含み、同じscaleからbyte-exactなsourceを生成します。

各operationは一回warmupし、続く3 sampleのmedianを判定値にします。Stressの初回projection+標準layout 2,000 ms、normalのlabel変更+semantic再投影100 msをそのままCI gateとし、machine計測からの動的倍率、performance testのskip、fixture縮小は行いません。Sample、median、budgetはtest outputへJSONで出します。

DOMなしのCore testはpan/drag 30 fpsを測りません。Coreではpan中にprojection/layoutを起動しない責務境界を維持し、`npm run verify:performance`はMockの固定500 node/1,000 edge Sceneを実Chromiumで開き、panとnode dragそれぞれの`requestAnimationFrame`間隔p95 33.3 ms以下を確認します。通常E2Eとは別のPlaywright configとCI jobで実行します。詳細なfixture、段階的layout、品質指標、engine選択は[layout-optimization.md](./layout-optimization.md)を参照します。

## Browser E2E

実browser DOM上のpointer event、SVG waypoint、Vue editorとmock hostの保存連携はPlaywright smokeで確認します。browser imageが大きいため`npm run verify`には含めず、UIやeditor transactionを変更した場合の完了手順として明示的に実行します。

Browserが導入済みの環境では次を実行します。Playwrightが検証専用port 4174で最新sourceのVite mockを起動し、終了時に停止します。既存のdev serverは再利用しません。

```sh
npm run verify:e2e
```

Repositoryと同じPlaywright versionを固定したDocker imageでも実行できます。

```sh
docker build -f Dockerfile.e2e -t iriograph-e2e .
docker run --rm --ipc=host iriograph-e2e
```

E2Eはmock fixtureのnamed view切替・追加・複製・設定・削除・overlay reset・temporary hide、node drag、multi-select、group drag、grid snap、整列、等間隔、undo/redo、resize、edge waypoint追加・移動・削除、label drag/reset、parallel/self-loop個別選択、mouse/keyboard pan、fit、minimap、selection reveal、pending Turtleを保存時にflushする経路、不正Turtle適用時のScene rollback、presentation操作後のTurtle不変、navigation後のdirty不変、console/page error不在をhost integration flowで確認します。失敗時のtraceは`test-results/`に残ります。

## Test追加規則

- CoreにDOMやbrowser mockを持ち込まない
- Pointerの座標計算は`DiagramCanvas` component test、document revisionやhistoryは`IriographEditor` integration testで検証する
- Keyboard commandのmodifier優先順位とeditable/IME除外はpure command test、実DOM focus/ARIAは`DiagramCanvas` component test、Turtle不変と一gesture一historyは`IriographEditor` integration test、Tab移動と実browser key dispatchはPlaywright E2Eで検証する
- Accessibility回帰ではCanvas shell内の`tabindex="0"`が一つだけであること、全node/container/edge optionが実DOM IDを持つこと、dialogのinitial focus/Escape/focus return、busy/status/alertを確認する。規範契約は`docs/accessibility.md`を参照する
- Navigation testではviewportの変化と同時に`update:modelValue`とhistoryが不変であること、read-onlyでも利用できることを確認する
- Selection testでは集合とprimaryがdocument/historyへ入らないこと、modifier/clear/select-all、Scene更新時の消滅ID除去、read-onlyでも選択できることを確認する
- Group geometry testでは全participantの同delta、containerごとのbounds、membershipとTurtle不変、pointerupの一batch、undo一回でのatomic rollbackを確認する
- Align/distribute/snap testでは決定的な結果、各一history item、target/grid/boundsの優先順と単体dragへの同一policy適用を確認する
- Routing testではderived routeとmanual waypointを混同せず、nearest segment追加、最後の削除によるautomatic復帰、label arc-length base、empty waypoint非保存、edgeへのgeometry/pinned/placement非混入、parallel/self-loopの個別hit areaを確認する
- 一つのgesture内で複数のmove eventが発生してもhistory itemは一つであることを維持する
- Semantic candidateの失敗testでは、sourceだけでなくSceneと最後にacceptされたdocumentが不変であることを確認する
- Domain validation testではloaded invalid documentのScene保持、candidate errorのrollback、provenance annotation、fingerprint-bound source navigation、context変更時のabort/stale破棄を分けて確認する
- Structured authoring testでは、previewしたadded/removed statement、candidate Turtle、confirmation IDが決定的であり、document・context・command・warning承認の改変またはstaleでApplyが拒否されることを確認する
- Resource作成testではallocatorの成功、cancel、error、許可namespace外、graph全termとの衝突を分け、指定position込みの成功が`update:modelValue`一回、history一件になることを確認する
- Property testでは完全置換、空配列による削除、IRI/literal、language/datatype相互排他、object kind・datatype・language・cardinality constraint、human unknown warning確認を検証する
- Property testでは空文字列literalと明示削除を区別し、複数値の往復、IRI参照削除後の孤立blank-node closure保持も検証する
- Capability testではrequired省略時を必須とし、optional binding省略時は参照statementだけをadd/remove双方でskipすることを検証する
- Structure/delete testではBag membership、Seq/Altのatomic再構成、Altのfinal member順・重複・default slot一致、参照時の既定reject、exact cascade preview、正規ordinalだけの再採番、prefix類似property保持、Seq/Alt最小件数違反rollback、既知語彙resource削除rejectを検証する
- Provenance逆編集testではdirect statement、membership、sequence、alternativeのcapabilityからdraftをseedし、provenance欠落時に見た目からpredicateを推測しないことを確認する
- 未適用Turtle draftとstructured authoring draftが排他的であり、readOnly、async stale、複数viewの一つの失敗でdocument全体が不変であることを確認する
- View command testでは対象以外のviewがexactに不変、locale-onlyとduplicateのoverlayがexact、profile primitive変更が旧Sceneとの互換性で再照合されることを確認する
- Active view testではcontrolled/uncontrolled、存在しないIDの先頭fallback、切替時の旧Scene/asset/validation stale破棄、view別selection/primary/viewport/temporary hideを確認する
- Temporary hide testではexact ID、container descendant closure、incident edgeだけが除かれ、document/overlay/historyへ保存されないことを確認する
- Canvas作成位置testではblank clickがephemeral draft markerだけを更新し、bounds clamp後の位置がApply成功時だけsemantic作成と一つのhistory itemへcommitされることを確認する
- Containment consistency testではheaderを除くcontent、nested/overlap/cycleを決定的に扱い、plain dragがTurtleを変更せず、semantic修正はdraftだけをseedし、presentation修正はoverlayだけを更新することを確認する
- 保存testでは`save` eventだけでなく、その前にpending editがacceptまたはrejectされた結果を確認する
- Browser smokeのsample件数へ依存するassertionを変更する場合は、workspace fixture変更と同じcommitで更新する
