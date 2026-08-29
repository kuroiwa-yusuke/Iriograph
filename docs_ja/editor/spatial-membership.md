# 空間membership

## 1. 位置づけ

この文書は、一つのsemantic membershipを階層containerまたは重なり可能なregionへ投影するための規範仕様です。[RDF/RDFS profile](../semantics/rdf-profile.md)のmembership規則を補足し、意味と空間文法の境界を定めます。

本文の「MUST」「MUST NOT」「SHOULD」「MAY」は、それぞれ必須、禁止、推奨、任意を表します。

## 2. 一つの意味、複数の空間文法

所属の正本は`semantic.source`内のRDF statementです。v1の基準predicateは`rdfs:member`で、向きはcontainer resourceからmember resourceとします。

```turtle
@prefix : <urn:example:workflow:> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .

:reviewers a rdf:Bag ;
  rdfs:label "レビュー担当"@ja ;
  rdfs:member :review .
```

同じmemberが複数のBagへ属することは妥当です。Coreは全membershipを決定的な順で保持し、一つへ縮約してはなりません。

```turtle
:finance a rdf:Bag ; rdfs:member :review .
:security a rdf:Bag ; rdfs:member :review .
```

Viewは意味graphを変更せず、次のどちらかの空間文法を選びます。

| View kind | Bagのprimitive | Membershipの表示 | 主用途 |
|---|---|---|---|
| `node-link` | `container` | 単一parentの階層包含 | lane、章、単純な入れ子 |
| `region` | `region` | 重なり可能な領域所属 | 分類の重複、責任範囲、集合の交差 |

Geometryからmembershipを推論してはなりません。要素を領域へdragする操作はpresentation editであり、明示したsemantic commandなしにTurtleを変更してはなりません。逆にTurtleのmembershipは、表示上の位置が一時的に不整合でも消してはなりません。

標準の`instance-flow`では、この表のBag/domain membershipをGroup Frameとして扱いますが、`rdfs:Class`は
Group Frameへ投影しません。Classと`rdf:type`は`型一覧`と要素上の一件の代表型tagで確認します。Classをregionへ
投影する空間文法は、明示的な旧`classification-region` viewだけの互換機能です。

## 3. Domain membership predicate

業務上の関係名が必要な場合、利用domainのpredicateを`rdfs:member`のsubpropertyとして自己記述できます。CatalogやCoreへ個別のpredicate分岐を追加する必要はありません。

```turtle
@prefix : <urn:example:workflow:> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .

:containsStep a rdf:Property ;
  rdfs:subPropertyOf rdfs:member ;
  rdfs:label "含む工程"@ja ;
  rdfs:comment "業務領域から、その領域に所属する工程への関係。"@ja .

:operations a rdf:Bag ;
  :containsStep :review .
```

Membership projection、profile validation、structured authoringは、明示された`rdfs:subPropertyOf`の推移閉包でpredicateを認識しなければなりません。完全なRDFS entailmentは要求せず、sourceまたは解決済みvocabulary graphで明示されたsubproperty chainだけを使います。

Scene membershipのidentityとprovenanceは、基準predicateへ正規化せず、元statementの正確なpredicate IRIを保持しなければなりません。編集時も`:containsStep`を`rdfs:member`へ黙って書き換えてはなりません。Labelとcommentは人間・LLM向けの意味説明であり、構造判定にはsubproperty関係を使います。

### 3.1 個別関係をresourceとして説明する場合

一つの所属行為に日時、根拠、担当などの属性が必要なら、その関係をnamed resourceとしてmodelできます。

```turtle
:assignment-2026-08-23 a :Assignment ;
  :assignedGroup :operations ;
  :assignedMember :review ;
  rdfs:comment "監査対応のための一時割当"@ja .
```

このresource graphは通常のnode/edgeとして失わず表示できますが、v1は任意の複数triple patternからmembershipを推論しません。Region/containerへの所属も同時に必要なら、上記resource graphに加えて`:operations :containsStep :review`を明示します。同じ意味を無理に一つの特殊projectionへ集約せず、単純な所属statementと、属性を持つ関係resourceを再利用可能なRDFとして分けます。将来、関係resourceからmembershipを導出する場合も、Coreへのdomain分岐ではなく明示的なprofile/catalog capabilityとして追加しなければなりません。

## 4. Scene契約

Core projectionはlegacy互換fieldとは別に、少なくとも次を出力します。

```ts
type SceneMembership = {
  semanticRef: string;       // exact source statement identity
  containerElementId: string;
  memberElementId: string;
  regionElementId?: string;  // region viewだけで設定
  provenance: ProjectionProvenance;
};
```

`memberships`は意味上の多対多関係です。`parentElementId`は階層layout向けの単一parent互換fieldであり、membershipの正本ではありません。

### 4.1 Node-link hierarchy

- 可視な所属先が一つだけなら、Coreはmemberの`parentElementId`と`parentProvenance`を設定します。
- 可視な所属先が複数なら、Coreはどれか一つを選ばず、`parentElementId`を設定しません。全statementは`memberships`へ残し、`multiple-container-memberships-not-hierarchical` warningを返します。
- 複数parentはsemantic errorではなく、階層文法だけでは完全表示できないというprojection warningです。このwarningのためにScene全体を空にしてはなりません。
- Container間のmembership cycleは階層layoutを成立させないためblocking errorです。複数membershipの許容はcycleの許容を意味しません。

### 4.2 Overlap region

`kind: "region"`のviewでは、Bagを`SceneRegion`として投影します。Regionはhierarchy parentではなく、他regionと重なれる独立したoverlay geometryです。

- 生成geometryは、可視memberのbounding box、一定のpadding/header、template minimum sizeから決定的に計算します。
- 複数regionに属するmemberは、生成layoutでは全regionの交差内に置かれなければなりません。各regionが同じmemberを包含するgeometryを持つことで、その交差を成立させます。
- `placement: "user"`またはpinnedなregion geometryはhard constraintです。Coreとlayout adapterは警告を消すために勝手に移動してはなりません。
- Regionの既定appearanceは半透明で、背面のregion、node、edgeを判別できる必要があります。具体値はcatalog template/style presetが所有し、semantic Turtleへ保存しません。
- Region overlap自体に新しい意味を付与してはなりません。交差領域は、共通memberを読み取るための表示です。
- どのGroup Frameにも意味上所属しない生成resourceは、初期layoutでいずれの枠のcontent bounds内にも置いてはなりません。見た目上の偶然の包含をmembershipとして読ませず、固定位置や親containerのhard constraintで退避できない場合だけwarningを返します。
- Classification-constrainedな操作では、memberの中心点だけでなく全boundsを所属regionの共通intersection内に保たなければなりません。通常dragはこの許容領域へclampし、intersection外へ出すことでmembershipを黙って外してはなりません。
- Regionのmove/resizeは意味上の全member boundsとtemplate paddingを包含し、複数region memberに必要な共通intersectionを空またはmemberより小さくしてはなりません。制約に達したhandleはその位置で止め、意味関係を変えずに理由を表示します。

固定geometryで所属regionの共通交差が空なら`region-membership-intersection-empty`、交差はあるがmember中心が外なら`region-member-outside-intersection`をwarningとして返します。単一regionのmemberが外なら`region-member-outside`を返せます。これらはpresentation診断であり、Turtleを変更せず、Scene生成をblockingしてはなりません。

### 4.3 Concept class region（明示的な旧profile互換）

既存文書が`classification-region` profileを明示した場合に限り、分類を空間表示するregion viewは、`rdfs:Class` resourceをregion、`member rdf:type class`を向きの異なるmembershipとしてcatalogで宣言的にbindできます。これはClassを`rdf:Bag`として扱うことを意味しません。意味の正本は`rdf:type`のまま、同一Scene membership契約へ投影します。標準Editorは通常文書をこのprofileへ自動変換せず、読込時に意味tripleや既存overlayを書き換えません。

```turtle
:review a :HumanTask, :AuditedStep .
```

このresourceは二つのclass regionの共通部分へ配置します。交差cellは複数statementから導出するview-only identityであり、独自語彙や新しいsemantic resourceを作りません。Cellを選んだ分類操作は構成classの`rdf:type`を一つのatomic patchで追加・解除し、各exact statementのprovenanceを保持します。

Class同士の概念階層は`rdfs:subClassOf`、resourceの分類は`rdf:type`、任意group所属は`rdfs:member`またはそのsubpropertyとして別々に編集します。Editorはこれらを一つの「包含」actionへ混ぜてはなりません。

Classification-constrained viewでは、要素の全boundsを現在のclass intersection内へclampしなければなりません。別cellへ移す操作はgeometryから意味を推論せず、右Inspectorの`所属・並び順を編集`から移動先classを明示し、一回の実行操作内でvalidationとsemantic transactionを行います。共通部分が空または要素より小さい場合は移動を拒否し、region geometryまたはclassificationのどちらを修正するか選べるdiagnosticを返します。

## 5. Layout adapter境界

Layout requestは`elements`、`edges`とは独立した`memberships`を受け取ります。Adapterは`parentElementId`だけから多対多membershipを復元してはなりません。

Membership追加を伴うsemantic reconciliationでは、Coreが変更前後のexact membershipを比較し、そのtransactionで新しく空間制約を受けるmemberだけをlayout requestへ一時情報として渡します。これはportable overlayでも新しい意味statementでもありません。標準adapterは当該memberだけを所属先の許容領域へ局所配置し、存続する内側Group Frame、そのmember、その他のuser geometryを再配置してはなりません。外側Groupへ通常nodeを追加する場合も、内側Groupとのmembershipを平坦化せず、内側Groupの全boundsを外側Groupの直属memberとして扱います。固定Groupに空きがない場合は既存配置を崩して解決せず、追加memberを収められないdiagnosticを返します。

高機能adapterはregionとmemberを同時に最適化できます。Regionを理解しないadapterでも、Coreのlayout completionが有効な全geometryを補完します。このfallbackは決定的で、次を満たさなければなりません。

1. 既存のuser/pinned geometryを変更しない。
2. 生成regionに可視memberを包含するgeometryを与える。
3. 全element geometryとedge routeを欠落させない。
4. 空間不整合をwarningとして返し、意味statementを変更しない。

## 6. Overlayとreconciliation

Region geometryもnode/container geometryと同じView overlayに保存できます。ユーザーが移動・resizeした場合は`placement: "user"`として維持し、再投影で自動生成位置へ戻してはなりません。

Resize可能なregion/Seq/containerは四隅と四辺中央の8 handleを持ちます。Handle drag中も前節のmembership containmentをhard constraintとして適用し、previewが不正なままpointerupしても保存しません。制約対象のmemberはnodeに限らず、geometryを持つcontainerとregionも含みます。同じmemberが複数のregion、Seq、containerへ属する場合は、各region geometryと各container content boundsの共通範囲へmember全体を保ちます。一つのSeqとmemberを同時移動しても、memberが別の所属先から外れる移動量へ進めません。Pointer drag、keyboard move/resize、数値geometry、整列・等間隔、枠本体の移動と8-handle resizeはすべて同じintersection制約を通し、いずれか一つの所属先に収まるだけの候補を確定しません。Region labelは外周上のanchorをdragでき、`appearance.regionLabelAnchor`へ0以上1未満の正規化位置、`appearance.regionLabelWritingDirection`へ`horizontal-right`または`vertical-down`を保存します。Region背景同士のz-orderは`appearance.regionZOrder`で編集できますが、semantic membershipや別primitiveのz-orderへ意味を持たせません。選択中region本体は構造layer内だけを一時前面化し、edge/node層を越えません。8 handleだけはtransient interaction layerへ分離するため、他のregion/Seqやnodeと重なっても操作できます。選択解除時は保存済み`regionZOrder`へ戻り、この一時前面化をdocument、history、dirty stateへ保存しません。Vue固有extensionは新規保存せず、旧文書の読取互換だけに使います。

Semantic source変更後のreconciliationはresource IRIが存続するregion overlayを維持します。Bagの型変更等でprimitiveが変わった場合は、互換なappearanceだけを残してgeometryを新しいprimitiveへ照合し、diagnosticを返します。Catalogから再生成できる透明度、色、線種をoverlayへ複製してはなりません。

新しいmembershipだけを追加したtransactionでは、存続Group Frameと既存memberのgeometryを維持し、新たに制約を受けるmemberだけを必要最小限に移動します。追加後のgeometry制約は通常のdrag/resizeにも引き継ぎ、空のintersectionや循環制約を生成してGroup Frameが移動不能になる結果をcommitしません。

## 7. Authoring lifecycle

Membershipの追加・削除はsemantic transactionです。

1. UIまたはLLM wrapperが、resolved authoring profileから許可されたmembership predicateと対象resourceを選ぶ。
2. Candidate graphへexact predicateのstatementを追加・削除する。
3. Turtle parse、subproperty closure、parent型、cycle、domain validationを実行する。
4. 全viewを再投影し、node-link hierarchyとregionをそれぞれ補完する。
5. 存続overlayをreconcileし、新規geometryだけを決定的に生成する。
6. Candidateの検証が成功した場合だけ、利用者の実行一回の中でTurtleとoverlayを一つのrevisionとして保存する。

Plain drag、領域のresize、重なりの変更はこのlifecycleを開始しません。LLMにはTurtle、許可語彙、必要なprojection capabilityを渡し、geometry調整を要求しないことを既定とします。

## 8. 将来の空間文法

Matrix、swimlane boundary、軸、時間帯、地理境界などが必要になっても、既存regionへboolean flagを増やし続けません。次を満たす場合だけ新しいScene primitiveまたはview kindを導入します。

- 同じsemantic relationに対して、配置制約または読み方がregion/hierarchyと本質的に異なる。
- Catalog templateだけでは表せず、layout adapterとinteractionに共通契約が必要である。
- Domain固有IRIではなく、複数domainで再利用できる空間文法として定義できる。

たとえばmatrixはrow/columnという二軸所属とcell制約、boundaryは内外または境界通過という規則を持つ可能性があります。これらは将来のcatalog/profileがsemantic relationを明示的にbindし、専用layout contractを持つべきです。単なる座標の近さ、矩形の内外、画像上の位置から意味を逆算してはなりません。
