# 検証方針

Iriographはpureなgraph処理、DOM event contract、editor transaction、実browser host連携を異なる層で検証します。pointer座標や非同期保存をpure unit testだけで代用せず、失敗箇所を特定できる最小の層にtestを置きます。

## 通常の検証

`npm run verify`は次を実行し、headless browserのdownloadを要求しません。

- Coreのparse、validation、projection、layout、reconciliation、serializer、asset policyのunit test
- Semantic validation portのsnapshot/fingerprint、adapter fail-closed、warning confirmation、abort、全write入口共通化のunit test
- Vue editorのasset lease session test
- RDF semantic textの全label/comment、locale primary、language/datatype、predicate/Alt edge labelとSeq ordinal membership provenance test
- happy-dom上の`DiagramCanvas` pointer/keyboard component test。dragのzoom換算とviewport端auto-pan、実content外周320 unitの初期作業余白、drop前の正負方向160 unit単位の連続拡張・scroll補正と負座標確定、multi-selection、group preview/batch、全Seq/region/container membership intersection clamp、resize minimum、node内label/icon dragと文字方向、endpoint込みroute、全route modeの排他描画、ビュー上のsource/target anchor、意味上のdirect edge端子node drop、invalid drop拒否、generated bend seed、waypoint追加・削除・移動、label offset、parallel/self-loop選択、single-tab-stop navigator、`aria-activedescendant`、決定的focus/range、key repeat previewとkeyup/blur commit、Escape cancel、readOnly/IME除外、pan競合、実content boundsへのfit、minimap、selection revealとgesture境界を確認する
- happy-dom上の`IriographEditor` integration component test。単体/batch overlay transaction、sparse routing/appearanceとlegacy event非二重適用、gesture・整列・等間隔単位のundo/redo、Turtle不変、全route mode切替、template実preview、package/workspace icon path候補、node内label/icon offset/resetとlabel文字方向、選択中心の段階Inspector、label-only resource作成、右クリックから別menuなしでビューへ遷移、右Inspector内styleのinput preview/change直接commitとpreset/reset直接commit、意味/ビューtabの排他表示、details dialog、label-first semantic authoring、Canvas resource picker、作成後のedge・複数membership/分類編集、direct edge endpointのatomic再接続、条件付きcascade削除確認、class交差cell seed、display/semantic containment警告と明示修正、Turtleのaccept/rollback、保存前flush、session selection/navigationとread-only境界を確認する
- 標準predicate pickerのIRI一意性、日本語label/comment/category/example、A/Bを含む`sentencePattern`、個体IRI非混入、`rdf:type`分類と`rdfs:subClassOf`通常編集、`rdfs:member`系だけのstructure command強制を確認する
- Core/ELK layout testでnodeとcomment reservationの障害物回避、edge交差・重複cost、自動生成routeの中間点最大1個、manual hard gate、straight 2点、curve用derived bend、固定geometryのroute-only refinementを確認する
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

すでに最新sourceのmockを別portで起動して探索する場合は、`IRIOGRAPH_E2E_BASE_URL=http://127.0.0.1:4175 npm run verify:e2e -- e2e/canvas-structure.spec.ts`のように外部管理serverを指定できます。未指定時は従来どおりPlaywrightが4174番でbuild済みmockを起動します。

E2Eは初期workspaceが空overlayのピザ注文・配送semantic seedを単一region viewで開くこと、明示追加したnode-link/region named viewの切替・複製・設定・削除・overlay reset・temporary hide、classを含む重なりregionと共有member、交差内nodeの全bounds拘束とregion resize containment、node dragとviewport端auto-pan、multi-select、group drag、grid snap、整列、等間隔、undo/redo、8-handle resize、Canvas選択中心の段階Inspector、labelだけの要素作成とopaque IRI allocation、種類・説明・関係が作成formに出ないこと、意味/ビューtabの排他表示、右クリックが別menuなしでビューtabを開くこと、右Inspector内の色・透明度・線編集が別Applyなしで直接確定すること、label-first details、RDF/RDFS/OWL・DCTERMS・PROV-O・SKOSを含むcategory別のA/B例文 relation picker、通常/AdvancedにIRI入力がないこと、型と業務上の所属が二重編集にならないこと、node/edgeの近傍一覧と重なりedgeへのfocus導線、複数・複数行label/commentとhover/全表示、個別edge説明が標準reificationとしてTurtleへ保存されビュー補足へ混入しないこと、node icon・region label/z-order appearance、選択外へ波及する削除だけのsession-only赤線とcascade確認、ビュー上のnode外側endpoint halo drag、意味上のdirect edge端子node dropによるatomic再接続、edge route mode・terminal marker・caption・manual waypoint追加/移動/削除、straight/curveでwaypointがないこと、Seq groupとordinal badge、Canvas選択後だけのSeq追加・並べ替え・除外、label drag/reset、parallel/self-loop個別選択、mouse/keyboard pan、fit、minimap、selection reveal、未実行formと適用済み「未保存」の区別、未実行formがある保存時の意味Inspector focus、不正Turtle適用時のScene rollback、presentation操作後にsemantic sourceと非対象geometryが不変で全体layoutが走らないこと、navigation後のdirty不変、host global fieldset CSS隔離、compact Inspector、console/page error不在をhost integration flowで確認します。失敗時のtraceは`test-results/`に残ります。

Canvasのhost埋込み回帰は通常幅と800px狭幅、左右sidebar折り畳み状態を通し、document横overflowなし、薄いgridの可視性、内部scrollとmiddle/blank pan、node drag中auto-pan、外周handleへの到達を実Chromiumで確認します。Computed styleではsemantic object本体が選択中も`region/Seq < edge < node`を満たし、選択frontは同じ構造層内に留まることを検証します。Waypoint、endpoint halo、resize handleだけは最上位transient interaction layerでnode重なり時もhit testでき、通常edge線とterminal markerがそこへ複製されないことをDOM構造でも確認します。Seq fixtureは「承認」を枠headerへ一度だけ表示し、`rdf:_n`由来edgeを0件とします。AltからSeqへのbranchはSeq group境界をtargetとし、Seq labelをedgeへ転記しません。

### ピザ参照図の100点構造評価

参照画像との比較はpixel一致や主観的な「似ている」で判定せず、固定Chromium、viewport 1920×1080、working copyなし、`models/pizza-order-delivery.iriograph`、初期overlay `{}`で実行します。初期layoutとasset解決が完了してからfitし、Canvas座標のScene geometry/routeと実browser上の文字サイズをJSONへ記録し、同時にscreenshotを保存します。BPMN固有icon、色、font family、線の装飾は採点対象外です。

| 項目 | 点 | 再現可能な採点方法 |
|---|---:|---|
| Lane階層・順序 | 15 | 顧客とピザ店、およびピザ店配下の店員・調理担当・配達担当を検出できれば5点、ピザ店が3子laneを構造上持てば5点、lane中心Yが顧客→店員→調理担当→配達担当の順なら5点 |
| Membership containment | 15 | 各可視memberの全boundsが意味上属する全region/container content bounds内にある割合を`15 × valid/total`で算出する。複数所属は各membershipを別件として数える |
| 左から右のflow・終了位置 | 15 | 顧客と店舗の期待する主flow隣接対について`centerX(source) < centerX(target)`を満たす割合を10点満点で算出し、各終了要素がそのlaneの主flow中で最右なら5点 |
| Branch・loop | 12 | 注文後gatewayから受取側と待機側の2 branchが別routeなら4点、待機→問い合わせの経路が存在すれば4点、問い合わせからgatewayへ戻り主flowへ再合流すれば4点 |
| Cross-lane message | 12 | 注文、問い合わせ内容、ピザ、料金、領収書ごとにproducer/resource/consumerのsemantic接続が揃う割合を4点満点で算出する。3者の中心Xの`spread = maxX - minX`を記録し、`max(0, 1 - spread / (2 × medianNodeWidth))`の5組平均を8点へ換算する |
| 要素重なり | 12 | Nodeと常時表示commentの意図しないbounds overlap pairを数え、`max(0, 12 - 2 × pairs)`とする。Region包含とregion同士の意図した重なりは除外する |
| Routing cleanliness | 10 | Endpoint nodeを除くroute-node交差数を`I`、共有endpointを除くedge交差数を`C`として、`max(0, 5 - I) + max(0, 5 - max(0, C - 4))`とする。全generated routeが中間点1個以下でない場合はこの項目を0点にする |
| Compactness・可読性 | 9 | 実content aspect ratioが1.8〜3.0なら3点、fit zoomが0.35以上なら3点、fit後のprimary labelの最小実表示font sizeが9px以上なら3点 |

左から右の主flow対は、顧客の`おなかがすいた→ピザを選ぶ→ピザを注文する→注文後イベント→ピザを受け取る→代金を払う→ピザを食べる→空腹が満たされた`、店舗の`注文を受ける→注文後処理を並行分岐→ピザを焼く→ピザを配達する→代金を受け取る→注文完了`、問い合わせ側の`注文後処理を並行分岐→問い合わせ受付→問い合わせに回答する→問い合わせ対応完了`に含まれる隣接対とします。Loopを表す`問い合わせる→注文後イベント`はLR採点から除き、Branch・loop項目で判定します。Cross-laneの3者は順に`ピザを注文する/注文/注文を受ける`、`問い合わせる/問い合わせ内容/問い合わせ受付`、`ピザを配達する/ピザ/ピザを受け取る`、`代金を払う/料金/代金を受け取る`、`代金を受け取る/領収書/代金を払う`です。

各比率点は小数第1位へ丸め、合計も100点満点で小数第1位へ丸めます。E2E artifactには各内訳、membership件数、主flow対、5つの3者spread、overlap pair、route-node交差、edge交差、generated中間点最大数、content aspect、fit zoom、最小font sizeとscreenshotを残します。標準layoutとoptional ELK adapterを比較する場合は、同じProjectedSceneと同じrubricで測ります。この比較は一般layoutの選択・改善に使う検証証拠であり、ピザseedのIRI、label、件数を検出して配置を変える規則にはしません。

0.6.0の標準layout基準値は92.1/100です。内訳はLane 15、containment 15、LR flow 15、branch/loop 12、cross-lane message 10.1、overlap 12、routing 4、compact/readability 9です。25 node、5 region、32 edgeに対してnode overlap 0、route-node交差1、edge交差9、generated中間点最大1、message列spread最大139/平均78.8、fit 57%、content aspect 2.99、最小実表示font 9.12pxでした。残るroute-node交差は`注文`から`ピザ`への対象関係が`顧客クレーム対応`を横切る1件です。

この92.1点は構造・geometryの一致度であり、参照画像とのpixel一致度ではありません。実screenshotの目視では、レーン階層・幅・順序と主フローは対応しますが、参照図のBPMN event/gateway/message icon、色付き縦header、顧客lane内のbranch別rowは再現していません。Shape/icon/headerはcatalog/profileとrendererの視覚文法差、branch rowは汎用layout品質差として点数と分けて記録します。

### 画像一致評価

上記の構造評価とは別に、利用者が参照画像へ期待する「図としての似方」を100点で目視評価します。Raw pixel similarity、SSIM、画像全体の差分率は、参照画像が図だけを切り出している一方、実browser screenshotにはtoolbar、sidebar、minimap、grid、異なる解像度・font rasterizationが含まれるため指標にしません。Canvas内の図だけをcropし、外接矩形を0〜1へ正規化して、同じlabelを持つanchorとlane境界を対応付けます。Font family、antialiasing、editor chromeは採点対象外ですが、BPMNとしてのshape、icon、色分け、線種は意図した視覚文法なので採点します。

| 項目 | 点 | 参照図との比較方法 |
|---|---:|---|
| Macro lane proportions | 20 | 図全体のaspect ratio 5点、顧客/ピザ店の高さ比5点、店員/調理担当/配達担当の高さ比5点、lane間gap・左header・外周余白の平均誤差5点。各5点枠は比率誤差10%以内を5/5、20%以内を4/5、30%以内を3/5、40%以内を2/5、50%以内を1/5、50%超を0点とする |
| Relative placement | 20 | 構造評価で列挙したprocess nodeの正規化中心をlabelで対応付け、主flowのX順と間隔8点、lane内Y位置と上下関係8点、開始/終了・resourceの外周余白4点で比較する。順序一致だけで満点にせず、参照位置からのずれも判定する |
| Branch rows | 15 | `ピザを選ぶ/ピザを注文する`の上下stack、注文後eventに対する受取側と`60分待つ/問い合わせる`の別row・return loop、店員laneのparallel branchと問い合わせ/クレーム/回答rowを各5点で判定する |
| Cross-lane alignment | 15 | 構造評価と同じ5組のproducer/resource/consumerについて、3者の中心X spreadが図幅の2.5%以内なら各3点、5%以内2点、8%以内1点、それ以上0点とする。Semantic接続が正しくても縦列になっていなければ減点する |
| Connector geometry | 15 | 主control flowの短い直線・直交性4点、branch/merge/loopの矩形corridor4点、cross-lane messageの垂直性と参照図に対応する線種4点、交差・長い斜線・edge label clutterの少なさ3点で判定する |
| BPMN visual language | 15 | 開始/終了eventとgatewayのshape 4点、taskの矩形・塗り分け3点、message/timer icon 3点、laneの色付きheader/band 3点、message/control flowのdash・marker・label階層2点。Icon artworkや色値の完全一致ではなく役割の見分けやすさを判定する |

画像一致点は、参照bboxの手動markingと目視による対応付けを含む主観値です。評価者、対象screenshot、内訳と差分理由をartifactへ残し、5点程度の揺れを許容します。自動CI gateや構造評価92.1点の代用にはせず、構造点と画像一致点を必ず併記します。

0.6.0の`.tmp/pizza-layout.png`を会話添付の参照図へ照らした画像一致基準値は36/100です。内訳はMacro 8（aspect 0、top lane比5、子lane比2、header/gap/余白1）、relative placement 10（X順・間隔6、lane内Y 2、端部余白2）、branch rows 2（顧客stack 0、timer/loop row 0、店員branch 2）、cross-lane alignment 11（注文2、問い合わせ1、ピザ2、料金3、領収書3）、connector geometry 5（主flow 3、branch corridor 0、message 2、clutter 0）、BPMN visual language 0です。現状はlane階層、左から右の概略順序、料金・領収書を中心とする縦列が対応します。一方、図のaspect ratioは約2.99で参照図の約1.68より大幅に横長で、顧客の選択/注文とtimer/inquiryが同じrowへ潰れ、branch/loopとmessage線が長い斜線になっています。全nodeが白い汎用角丸矩形で、event circle、gateway diamond、message/timer icon、色付きlane header、message dashを再現していないため、構造点が高くても画像一致は低く評価します。

Macro比率、相対配置、branch row、edge corridorと交差の改善は、特定seedのIRIやlabelへ分岐しない汎用layoutの責務です。BPMN shape、icon、色、線種はcatalog/profileとrendererの視覚文法で解き、標準layoutへ業務固有styleを埋め込みません。個別documentを参照図へ最終調整する座標・size・route・styleはoverlayの責務ですが、初期seedは空overlayという検証条件を維持し、手動overlayで自動layoutの画像一致点を水増ししません。

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
- Resource作成testではallocatorの成功、cancel、error、許可namespace外、graph全termとの衝突を分け、label一文の成功が`update:modelValue`一回、history一件になり、位置・所属を同時指定しないことを確認する
- Property testでは完全置換、空配列による削除、IRI/literal、language/datatype相互排他、object kind・datatype・language・cardinality constraint、human unknown warning確認を検証する
- Property testでは空文字列literalと明示削除を区別し、複数値の往復、IRI参照削除後の孤立blank-node closure保持も検証する
- Capability testではrequired省略時を必須とし、optional binding省略時は参照statementだけをadd/remove双方でskipすることを検証する
- Structure/delete testではBag membership、Seq/Altのatomic再構成、Altのfinal member順・重複・default slot一致、参照時の既定reject、exact cascade preview、正規ordinalだけの再採番、prefix類似property保持、Seq/Alt最小件数違反rollback、既知語彙resource削除rejectを検証する
- Provenance逆編集testではdirect statement、membership、sequence、alternativeのcapabilityからdraftをseedし、provenance欠落時に見た目からpredicateを推測しないことを確認する
- 未適用Turtle draftとstructured authoring draftが排他的であり、readOnly、async stale、複数viewの一つの失敗でdocument全体が不変であることを確認する
- View command testでは対象以外のviewがexactに不変、locale-onlyとduplicateのoverlayがexact、profile primitive変更が旧Sceneとの互換性で再照合されることを確認する
- Active view testではcontrolled/uncontrolled、存在しないIDの先頭fallback、切替時の旧Scene/asset/validation stale破棄、view別selection/primary/viewport/temporary hideを確認する
- Temporary hide testではexact ID、container descendant closure、incident edgeだけが除かれ、document/overlay/historyへ保存されないことを確認する
- Resource作成testではlabel以外の種類・説明・分類・所属・関係・位置fieldがなく、allocatorのopaque IRIと`rdfs:label`一文だけを一回の操作で確定し、generated geometryを補完することを確認する。作成後のdragは別のpresentation history itemになる
- Containment consistency testではheaderを除くcontent、nested/overlap/cycleを決定的に扱い、plain dragがTurtleを変更せず、semantic修正はdraftだけをseedし、presentation修正はoverlayだけを更新することを確認する
- Region testでは一つのmemberが複数membershipを保持すること、交差領域が透過表示されること、region geometryからmembershipを推論しないこと、domain subpropertyの元predicateを逆編集時も保持することを確認する
- Class region testでは`rdf:type`のobject側classをregion、subject側resourceをmemberとして保持し、空classもCanvas hit候補になること、複数class intersectionより小さいcellでは移動を拒否することを確認する
- Context action testではblank/node/edge/container/regionの右クリックが対象selectionとappearance tabだけを開き、semantic actionを表示・実行しないこと、選択概要と追加2入口、detailsの初期focus、Escapeとfocus returnを確認する。Delete/Backspaceは選択edgeだけなら直接atomic削除し、選択外のincident edge・membership・Seq membershipへ波及するときだけlabel付き影響modalを開くことを確認する
- Appearance/endpoint testではcatalog既定を複製せず変更fieldだけをoverlayへ保存し、checkbox/select/preset/resetの直接commit、連続値のinput中session previewとchange時一履歴、undo、色・透明度のsafe範囲、node外側halo/stubの可視性と周囲anchor dragを確認する
- 保存testでは`save` eventだけでなく、その前にpending editがacceptまたはrejectされた結果を確認する
- Browser smokeのsample件数へ依存するassertionを変更する場合は、workspace fixture変更と同じcommitで更新する
