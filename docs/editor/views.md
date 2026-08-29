# Named view

この文書は、同一semantic graphに対するnamed viewの保存・編集・session境界を定めます。

## 保存契約

`views[]`は同じ`semantic.source`を異なる`profileRef`、`layoutRef`、`locale`、sparse
`overlay`で表示するnamed viewです。`viewId`はdocument内で一意なimmutable identityです。
既存viewのrename commandは提供しません。新規作成と複製は新しい`viewId`を割り当てます。

Coreの統一`ViewCommand`は次のclosed vocabularyだけを持ちます。

- `add`: profile、layout、任意localeから空overlayを投影・layoutしてviewを追加する
- `duplicate`: 元viewの設定とoverlayをexact cloneし、新しいviewIdを割り当てる
- `configure`: viewIdを維持し、profile、layout、localeだけを変更する
- `delete`: 対象viewを削除する。最後の1 viewは削除できない
- `reset-overlay`: 対象viewのuser overlayを破棄し、semantic graphとcatalogから再生成する

`applyViewCommand(document, command, runtime, options)`はpresentation-only atomic transactionです。
失敗時は元documentを返し、成功時だけcandidate documentを返します。追加、profile/layout設定、
resetは対象viewだけをprojection/reconciliation/layoutし、無関係なviewを再生成しません。
localeだけの変更とduplicateではoverlayをbyte-equivalentなJSON値として維持します。
壊れたviewもdeleteでき、他viewの不正状態はdeleteを妨げません。

## 配置方向

標準Editorの通常UIは`layoutRef` IRIを直接入力させず、`横方向（左→右）`と
`縦方向（上→下）`だけを選択肢として示します。新規viewは標準軽量layoutのLRを既定にします。
既存viewの方向変更は現在のadapter familyを維持し、標準LR/TBは標準LR/TBへ、ELK
Layered LR/TBはELK Layered LR/TBへ対応付けます。Engine固有optionや方向をTurtle、要素の
appearance overlayへ保存しません。

方向切替は対象viewへの`configure` ViewCommand一件です。対象adapterはgenerated geometryと
derived routeを再計算し、`placement: "user"`、pinned geometry、manual route、membership、
semantic source、他viewを維持します。Undo/redoはこのdocument transactionを一件として扱い、
再読込後もviewごとの`layoutRef`から同じ方向を解決します。

標準Editorが方向pairを知らない`layoutRef`は、現在値を技術情報としてread-only表示します。
そのviewでは方向selectを無効にし、profileやlocaleだけを変更しても元の`layoutRef`を保持します。
名前の類似からadapter familyや方向を推測せず、未知layoutを標準layoutへ黙って置換しません。

Semantic transactionはViewCommandの対象view限定処理とは別に、原則として全viewを一つの
atomic transactionとして再投影・検証します。ただし、可視primitive集合、membership、ordinal、
layoutRefとgenerated geometryが変わらないdirect-edge-only変更では、各viewの配置を維持して
incident edgeのderived routeだけを`route-only`で再計算できます。追加・削除・identityまたは
endpoint変更edgeの旧新endpointをseedとし、そのendpointに接続するcandidate edgeまでを一段だけ
affected集合へ含めます。無関係なgenerated edgeは旧Scene routeを`fixedDerivedRoutes`として
byte-equivalentに再利用し、manual/user routeは従来どおりhard constraintとして扱います。
この最適化を使う場合も
transactionと検証の境界は全viewであり、一つでも失敗すればTurtleと全overlayをrollbackします。

標準RDF/RDFS profileは投影目的別に`full`、`instance-flow`、
`classification-region`のpresetを持ちます。業務フローは`instance-flow`、class分類の交差を
表示するregion viewは`classification-region`、ontology定義自体を確認するviewは`full`を
選びます。各presetは同じsemantic graphから可視構造を導出するだけで、非表示の語彙定義を
Turtleから削除しません。Profileを切り替えて一つのoverlayを使い回すより、目的ごとにnamed
viewを作り、geometryやroutingをview別に保持することを推奨します。

## Active viewとsession

Active viewはportable documentへ保存しません。Vue editorは`activeViewId` /
`update:activeViewId`のcontrolled contractを提供し、prop省略時は内部sessionで管理します。
指定IDが存在しなければdocument先頭viewへfallbackします。

Editor sessionはviewIdごとに次を保持します。

- selection集合とprimary selection
- zoom、scrollLeft、scrollTopからなるviewport
- 実content boundsの外周320 unitから始まり、drag/resize中に必要方向へ160 unitずつ拡張するwork area bounds
- 一時非表示にしたexact Scene element ID集合

これらは`v-model`、overlay、undo/redo history、dirty stateへ入りません。一時hideは指定した
exact IDだけを起点とし、containerの場合だけ全structural descendantを閉包に含めます。その後、
非表示geometryへ接続するedgeと明示指定edgeだけをScene cloneから除きます。Semantic graphを跨いだ
新しいedgeを生成しません。Work areaは一つのgesture中も正負方向へ単調に拡張し、負方向では
viewport位置を補正します。Fitはwork area全体でなく、負座標とrouteを含む実content boundsを使います。

Group Frameの折り畳みもsession-onlyです。折り畳んだgroupはmemberとincident edgeを描画集合から外し、集約badgeとlabel-first一覧を示します。非表示nodeを跨ぐshortcut edgeは作らず、展開時にselection、diagnostic、comment、viewportを同じsemantic identityへ復元します。`[`/`]`と階層focus commandはCanvas composite内で動き、Turtle、overlay、dirty/historyを変更しません。

## 永続scope

Named viewの`scope`はroot、type、predicate、direction、depthの閉じた宣言です。全semantic graphを先に検証してから可視集合を決め、任意SPARQL/scriptや非表示nodeを跨ぐedgeを保存しません。Groupはownerと可視memberに必要な構造closureだけを残します。Seq/Altの一部しか見えない場合は`scopeTruncation`をSceneへ明示し、完全なGroupとして装いません。

Scope変更は対象viewだけのpresentation commandで、Turtleと非対象viewを変更しません。Session折り畳みと違いscopeはportable documentへ保存されます。

## 標準Editorの管理UI

左sidebarはactive viewを切り替えるcompact selectorだけを常時表示します。Viewが一件だけならselectorを
出さず、そのview名と`…`管理buttonを表示します。Viewの追加、複製、profile/layout/locale設定、削除、
overlay resetは`…`から開く一つの管理dialogへ集約し、左sidebarへ個別buttonを並べません。

管理dialogの各操作も上記`ViewCommand`へ合流し、viewごとのselection、viewport、一時hideを保持します。
最後の1 viewは削除できず、複数viewの削除だけは対象名を示す二段階確認にします。追加・設定の子dialogを
CancelまたはEscapeで閉じた場合は管理dialogへ戻して先頭controlへfocusし、管理dialogを閉じた場合は元の
`…`buttonへfocusを戻します。Dialogを開閉しただけではdocument、history、dirty stateを変更しません。

## 制限

View scopeは閉じたroot/type/predicate/direction/depthだけを持ち、SPARQL、任意filter式、非表示nodeを跨ぐedge再接続を持ちません。
表示構造の違いはcatalog profileで宣言し、個別要素の表示調整はoverlay、一時的な絞り込みは
session-only hideで扱います。Structured authoringの構造候補はactive viewの
profile/catalog/viewIdへbindします。Standard editorの`要素を追加`は初期位置を入力せず、
active viewの標準layoutがgenerated geometryを補完します。
