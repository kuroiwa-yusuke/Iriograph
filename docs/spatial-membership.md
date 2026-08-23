# 空間membership仕様

## 1. 位置づけ

この文書は、一つのsemantic membershipを階層containerまたは重なり可能なregionへ投影するための規範仕様です。`docs/rdf-rdfs-profile.md`のmembership規則を補足し、意味と空間文法の境界を定めます。

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

固定geometryで所属regionの共通交差が空なら`region-membership-intersection-empty`、交差はあるがmember中心が外なら`region-member-outside-intersection`をwarningとして返します。単一regionのmemberが外なら`region-member-outside`を返せます。これらはpresentation診断であり、Turtleを変更せず、Scene生成をblockingしてはなりません。

### 4.3 Concept class region

分類を空間表示するregion viewは、`rdfs:Class` resourceをregion、`member rdf:type class`を向きの異なるmembershipとしてcatalogで宣言的にbindできます。これはClassを`rdf:Bag`として扱うことを意味しません。意味の正本は`rdf:type`のまま、同一Scene membership契約へ投影します。

```turtle
:review a :HumanTask, :AuditedStep .
```

このresourceは二つのclass regionの共通部分へ配置します。交差cellは複数statementから導出するview-only identityであり、独自語彙や新しいsemantic resourceを作りません。Cellを選んだ分類操作は構成classの`rdf:type`を一つのatomic patchで追加・解除し、各exact statementのprovenanceを保持します。

Class同士の概念階層は`rdfs:subClassOf`、resourceの分類は`rdf:type`、任意group所属は`rdfs:member`またはそのsubpropertyとして別々に編集します。Editorはこれらを一つの「包含」actionへ混ぜてはなりません。

Classification-constrained viewでは、要素の全boundsを現在のclass intersection内へclampできます。別cellへ移す操作はgeometryから意味を推論せず、移動先classを明示したsemantic previewを開きます。共通部分が空または要素より小さい場合は移動を拒否し、region geometryまたはclassificationのどちらを修正するか選べるdiagnosticを返します。

## 5. Layout adapter境界

Layout requestは`elements`、`edges`とは独立した`memberships`を受け取ります。Adapterは`parentElementId`だけから多対多membershipを復元してはなりません。

高機能adapterはregionとmemberを同時に最適化できます。Regionを理解しないadapterでも、Coreのlayout completionが有効な全geometryを補完します。このfallbackは決定的で、次を満たさなければなりません。

1. 既存のuser/pinned geometryを変更しない。
2. 生成regionに可視memberを包含するgeometryを与える。
3. 全element geometryとedge routeを欠落させない。
4. 空間不整合をwarningとして返し、意味statementを変更しない。

## 6. Overlayとreconciliation

Region geometryもnode/container geometryと同じView overlayに保存できます。ユーザーが移動・resizeした場合は`placement: "user"`として維持し、再投影で自動生成位置へ戻してはなりません。

Semantic source変更後のreconciliationはresource IRIが存続するregion overlayを維持します。Bagの型変更等でprimitiveが変わった場合は、互換なappearanceだけを残してgeometryを新しいprimitiveへ照合し、diagnosticを返します。Catalogから再生成できる透明度、色、線種をoverlayへ複製してはなりません。

## 7. Authoring lifecycle

Membershipの追加・削除はsemantic transactionです。

1. UIまたはLLM wrapperが、resolved authoring profileから許可されたmembership predicateと対象resourceを選ぶ。
2. Candidate graphへexact predicateのstatementを追加・削除する。
3. Turtle parse、subproperty closure、parent型、cycle、domain validationを実行する。
4. 全viewを再投影し、node-link hierarchyとregionをそれぞれ補完する。
5. 存続overlayをreconcileし、新規geometryだけを決定的に生成する。
6. Previewを明示適用した場合だけTurtleとoverlayを一つのrevisionとして保存する。

Plain drag、領域のresize、重なりの変更はこのlifecycleを開始しません。LLMにはTurtle、許可語彙、必要なprojection capabilityを渡し、geometry調整を要求しないことを既定とします。

## 8. 将来の空間文法

Matrix、swimlane boundary、軸、時間帯、地理境界などが必要になっても、既存regionへboolean flagを増やし続けません。次を満たす場合だけ新しいScene primitiveまたはview kindを導入します。

- 同じsemantic relationに対して、配置制約または読み方がregion/hierarchyと本質的に異なる。
- Catalog templateだけでは表せず、layout adapterとinteractionに共通契約が必要である。
- Domain固有IRIではなく、複数domainで再利用できる空間文法として定義できる。

たとえばmatrixはrow/columnという二軸所属とcell制約、boundaryは内外または境界通過という規則を持つ可能性があります。これらは将来のcatalog/profileがsemantic relationを明示的にbindし、専用layout contractを持つべきです。単なる座標の近さ、矩形の内外、画像上の位置から意味を逆算してはなりません。
