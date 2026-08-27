# RDF/RDFSベースプロファイル仕様

## 1. 位置づけ

この文書は、Iriograph v1がTurtleから表示Sceneを導出するための規範仕様です。実装の現状ではなく、core、catalog、mockが到達すべき契約を定めます。

本文の「MUST」「MUST NOT」「SHOULD」「MAY」は、それぞれ必須、禁止、推奨、任意を表します。

ベースとなるfullプロファイルの識別子は`urn:iriograph:profile:rdf-rdfs:1`、標準catalogの参照は`urn:iriograph:catalog:rdf-rdfs@1`とします。意味graphを変更せず投影目的を限定する標準presetとして、`instance-flow`と`classification-region`も定義します。これらの識別子と使い分けは6.3節を正本とします。

## 2. 設計原則

Iriograph documentは次の三層を分離します。

| 層 | 正本 | 責務 |
|---|---|---|
| Semantic | `semantic.source`のTurtle | resourceのidentity、意味のある型・関係・順序・包含・label |
| Projection | profileとcatalog | RDF/RDFS構造をScene primitiveと既定appearanceへ写す規則 |
| Presentation | `views[].overlay` | ユーザーが固定したgeometry、routing、template/icon override |

ベースプロファイルは次を必須方針とします。

- 包含、順序、選択、参照をspecial projectionしたい場合はRDF/RDFSの標準語彙を優先し、Iriograph固有の業務語彙を要求しません。ただし標準構造の利用は任意です。
- IriographはRDF/RDFS語彙を再定義しません。決定的な作図に必要な追加制約だけをapplication profileとして定めます。
- Turtleは任意のdomain IRIをclass、predicate、resourceとして利用できます。ベースプロファイルに未登録のIRI-object tripleも拒否しません。
- 自然言語labelをclass判定、構造判定、rule matchingに使ってはなりません。
- `rdf:type`をtemplate、shape、色、iconの選択だけのために追加してはなりません。LLM、validation、query、推論、再利用に必要な分類だけをTurtleへ置きます。
- 座標、色、shape、icon、viewport、edge waypointをTurtleへ入れてはなりません。
- rendererへRDF/RDFS IRIまたは業務IRIごとの分岐を直書きしてはなりません。profile/catalogが標準IRIを汎用projection operatorへbindします。

## 3. ベース語彙

### 3.1 表示構造を駆動する語彙

| 語彙 | Turtle上の役割 | ベースSceneへの投影 |
|---|---|---|
| `rdf:type` | resourceの意味上の分類 | classが存在する場合はtemplate ruleと構造ruleの照合に使い、edgeとしては表示しない |
| `rdfs:label` | 人向け表示名 | node、container、edgeのlabel候補 |
| `rdfs:comment` | 説明 | resourceに紐づくhover説明と任意のannotation calloutへ導出する |
| `rdf:Statement`、`rdf:subject`、`rdf:predicate`、`rdf:object` | asserted tripleの標準reification | reifier自体は非表示にし、exact direct edgeの`statementComments`へ`rdfs:comment`を導出する |
| `rdf:Bag` | 順不同の包含集合 | node-link viewでは階層`container`、region viewでは重なり可能な`region`として表示する |
| `rdfs:member` | containerからmemberへの所属 | 全membershipを保持し、選択した空間文法で包含または領域所属として表示する |
| `rdf:Seq` | 順序付きresource列 | 薄い外枠を持つ選択可能な`container`として表示し、memberへordinal badgeを付ける |
| `rdf:Alt` | 選択肢の集合 | 選択nodeと各選択肢へのbranch edgeを導出する |
| `rdf:_1`、`rdf:_2`、… | `rdf:Seq`または`rdf:Alt`の順序付きmember | ordinal membershipとして消費する |
| `rdfs:seeAlso` | 追加情報への参照 | dashed reference edgeとして表示する |
| `rdfs:isDefinedBy` | 定義元resourceへの参照 | definition reference edgeとして表示する |

`rdfs:member`の向きはcontainerをsubject、memberをobjectとします。

Domain上の所属種別が必要な場合は、predicateを`rdfs:subPropertyOf rdfs:member`で宣言し、
label/commentを付けられます。限定RDFS closureで一致したsubpropertyは同じmembership構造として
投影・検証しますが、Scene provenanceと逆編集commandにはsourceで使ったexact predicateを保持します。
これにより「担当として所属」「参照集合に所属」等を検索可能にしつつ、Coreへ個別predicate分岐を追加しません。

`rdf:Seq`、`rdf:Bag`、`rdf:Alt`はRDF Schema上ではcontainerです。順序、選択、既定選択といった標準上の慣例を作図に利用し、後述の連番制約をIriograph profileとして追加します。

### 3.2 ontology記述に使える語彙

| 語彙 | 役割 | ベースSceneへの投影 |
|---|---|---|
| `rdfs:Class` | class resourceの分類 | class templateを選ぶ |
| `rdf:Property` | property resourceの分類 | property templateを選ぶ |
| `rdfs:subClassOf` | classの上位・下位関係 | specialization edgeとして表示する |
| `rdfs:subPropertyOf` | propertyの上位・下位関係 | specialization edgeとして表示する |
| `rdfs:domain` | propertyのsubject側class | domain edgeとして表示する |
| `rdfs:range` | propertyのobject/value側class | range edgeとして表示する |

これらは業務フローで必須ではありません。ontology自体を同じ意味グラフで扱う場合にも独自語彙を増やさないため、full catalogが表示形式を提供します。v1は汎用filter式を持たず、instance中心、class分類領域、ontology全体という構造選択は別のnamed viewと標準profile presetを使用します。Profileによる非表示はScene投影だけへ作用し、語彙定義tripleを`semantic.source`から削除してはなりません。

### 3.3 自由なdomain語彙

上表以外のclassとpredicateも利用できます。ただしdomain resource IRIとdomain vocabulary IRIを区別し、表示だけのtypeをvocabularyとして導入しません。IRIをobjectに持つ未登録predicateは、subjectからobjectへの通常矢印として表示します。Edge labelはpredicateの`rdfs:label`を優先し、なければ「関係名未設定」等の汎用labelを使います。通常のpresentation item/DOMへcompact IRIをfallback表示せず、exact predicate IRIは内部provenanceとeditable sourceに保持します。

literalをobjectに持つ未登録predicateは意味グラフには保持しますが、annotation投影が未確定のv1ではScene elementを生成しません。

Predicate vocabulary catalogはIRIを置き換えず、日本語を含むlocale別label/comment、category、短い利用例を付加できます。Editorはこれを発見と候補順位に使いますが、categoryや表示文からpredicate identityを推論しません。RDF/RDFS、SKOS、Dublin Core Terms、PROV-O等の標準語彙をprofile別catalogとして追加でき、base packageへ全domain語彙を直書きしません。

Direct edgeの線と矢印は既定で共通にし、predicateごとに無制限な線種を増やしません。Catalogは必要な場合だけ、`generic`、`reference`、`dependency`、`membership`、`classification`等の閉じたterminal marker categoryをsource/target接続端へ割り当てられます。Markerは表示上の補助であり意味の正本ではなく、未知predicateはgeneric arrowへfallbackします。

`rdf:Seq`と`rdf:Alt`は簡潔な順序・分岐の表現であり、任意のgraph topologyをこれだけで記述する義務はありません。domain predicateで直接resourceを結んだ場合も通常矢印になるため、複雑なnetworkやdomain固有relationを失わず扱えます。

## 4. 構造制約

### 4.1 共通制約

1. `semantic.source`は妥当なTurtleでなければなりません。
2. node、container、edge endpoint、sequence、alternativeなどview identityを持つresourceはnamed IRIでなければなりません。
3. blank nodeは非表示metadataには利用できますが、v1の表示構造を駆動してはなりません。
4. 一つのresourceを`rdf:Bag`、`rdf:Seq`、`rdf:Alt`の複数の具体的構造型として宣言してはなりません。
5. labelは構造を決定しません。たとえば`rdfs:label "承認"`からgatewayやbranchを推定してはなりません。

### 4.2 Bagと包含

- `rdf:Bag`は0個以上の`rdfs:member`を持てます。
- 可視containerの包含関係にcycleがあってはなりません。
- `rdf:Bag`のmember順は表示意味を持ちません。配置順はlayoutまたはoverlayが決めます。
- 同じmemberが複数の`rdf:Bag`へ属することを許容し、各membershipを失わずScene provenanceへ残します。

Node-link viewの階層containerはDOM/layout上のparentを一つしか持てないため、memberの可視containerが一つの場合だけ互換`parentElementId`を設定します。複数membershipを一つへ勝手に優先付けせず、memberは階層外へ置き、すべてのmembershipを保持して適合viewへの切替を案内します。

Region viewは各Bagを独立した半透明領域として投影し、複数Bagに属するmemberを領域の交差へ配置できます。領域の重なりはmembershipを説明する表示文法であり、重なっているというgeometryだけからTurtleを変更してはなりません。固定geometryでsemantic membershipと領域内外が食い違う場合はdiagnosticを返し、意味側または表示側をどちらか明示的に修正させます。

### 4.3 Seqと順序

- `rdf:Seq`は`rdf:_1`から始まる1個以上のordinal memberを持たなければなりません。
- ordinalは正の10進整数で、先頭0を持たず、欠番なく連続しなければなりません。
- 同じordinal predicateは一つのobjectだけを持たなければなりません。
- member resourceの重複は許可します。これにより同じresourceへの再訪を表現できます。
- `rdf:_n`はsequence resourceをsubject、memberをobjectとします。

`rdf:Seq`のmemberが`m1, m2, …, mn`の場合、sequence resourceを順序付きgroupとして投影し、各memberへ`1, 2, …, n`のbadgeを表示します。`rdf:_n`はpredicate edgeではなくordinal membershipとしてSceneに保持し、通常のrelation pickerへ出しません。Layoutはこのordinalをgroup内の配置順へ利用できますが、member間に意味上存在しないtripleやderived edgeを生成しません。同じresourceが複数ordinalへ現れる場合も、各membership identityとbadgeを保持します。

### 4.4 Altと分岐

- `rdf:Alt`は`rdf:_1`から始まる2個以上のordinal memberを持たなければなりません。
- ordinalの形式、一意性、連続性は`rdf:Seq`と同じです。
- `rdf:_1`を既定選択肢として扱います。
- `rdf:Alt` resourceは選択nodeとして表示します。
- memberが通常resourceなら、選択nodeからそのresourceへbranch edgeを生成します。
- memberが`rdf:Seq`なら、選択nodeからそのsequence group境界へ無名のbranch edgeを生成し、その後はsequence規則を適用します。Sequenceの`rdfs:label`はgroup headerだけへ表示し、先頭memberへの偽edgeやbranch edge labelへ転記しません。

`rdf:Alt`の用途をBPMN gatewayだけに限定しません。選択という共通構造をcatalog templateでdiamond等へ表示し、domain固有の詳細は追加catalogで上書きします。

### 4.5 可視resourceとfallback

ベースプロファイルは次のnamed resourceを表示候補にします。

- `rdf:Bag` resource
- `rdf:Seq` resource
- `rdf:Alt` resource
- Bag、Seq、Altのmember
- suppressされていないIRI-object tripleのsubjectとobject
- `rdf:type`、`rdfs:label`等のmetadataだけを持つnamed subject

`rdf:Seq` resourceは構造として消費するため既定では候補から除外します。ただし同じresourceがsuppressされていない別tripleのendpointでもある場合は、catalogが明示的にresource表示を選べます。

`rdf:type`のobjectは、type objectであることだけを理由に表示候補へ追加しません。これによりdomain classを分類に使うだけでclass nodeが毎回混入することを避けます。class自体を図示する場合は、classを主語にした宣言またはontology relationを同じviewへ含めます。

Region view profileがclass membershipを明示的にbindする場合は例外として、`rdfs:Class` resourceをregion、`resource rdf:type class`をmembershipへ投影できます。ClassはBagではなく、元statementのpredicateと向きを保持した汎用membership projectionです。複数typeはregionの交差として表示し、交差自体をsemantic resourceへしません。

直接tripleは、predicate ruleが`direct-edge`を選び、かつsubject/objectの両方が可視候補である場合にedgeになります。`suppress`されたpredicateからfallback edgeを生成してはなりません。
Type ruleでresource自体が`suppress`された場合、そのresourceをendpointとするdirect/derived edgeもそのviewでは生成せず、意図した非表示についてendpoint warningを返しません。Predicate resourceが`suppress`されていても、そのIRIをpredicateとして可視instance間で使うtripleは別のstatement ruleで評価し、通常edgeまたはfallback edgeとして保持します。

## 5. Label選択

表示labelは次の順で一つ選びます。

1. view localeとlanguage tagが完全一致する`rdfs:label`
2. view localeのprimary languageと一致する`rdfs:label`
3. language tagのない`rdfs:label`
4. language tagとliteral valueを正規化してsortした先頭の`rdfs:label`
5. resource種別に応じた「名前未設定」等の汎用label

同順位のlabelが複数ある場合もsource記述順には依存せず、language tagとliteral valueの辞書順で決定します。v1 documentにview localeがない場合、host localeを保存時にdocumentへ固定するまで、3、4、5の順だけを使います。

全`rdfs:label`はScene metadataと検索索引へ保持し、上記で選んだ一件だけをprimary display labelとします。同一languageに複数のpreferred labelがありprofile上のprimaryを決められない場合はwarningを返します。別名を明示するprofileは`skos:altLabel`等を許可語彙として追加できます。Literal内の改行は保持し、Canvasはwrap・測定した表示boxをlayoutへ渡します。

比較時はlanguage tagをASCII lowercase、literal valueをUnicode NFCへ正規化し、Unicode code point順でsortします。

## 6. Projection catalog契約

### 6.1 責務

profileはTurtleの利用制約を定義し、catalogはsemantic patternをSceneへの投影へ結びます。coreが実装するのは次の汎用operatorだけです。

| Operator | 入力 | 出力 |
|---|---|---|
| `resource` | named resource | `node`または`container` |
| `direct-edge` | IRI-object triple | `edge` |
| `membership-container` | container typeとmembership predicate・向き | 全membership、およびviewに応じた`container`/`region` |
| `ordinal-sequence` | container typeとordinal predicate pattern | 選択可能なsequence `container`とordinal付きmembership |
| `alternative` | container typeとordinal predicate pattern | choice `node`とbranch `edge` |
| `suppress` | typeまたはpredicate | Scene生成を抑止しmetadataとして消費 |

RDF/RDFS IRIはoperatorの実装へ埋め込まず、標準catalogのrule dataとして渡します。

### 6.2 v1 rule形式

catalogのprojection部分は、現行prototypeの`nodeRules`、`relationRules`、`containmentRules`を次の正規化された`rules`へ移行します。

```json
{
  "catalogId": "urn:iriograph:catalog:rdf-rdfs",
  "catalogVersion": "1",
  "profileRef": "urn:iriograph:profile:rdf-rdfs:1",
  "rules": [
    {
      "ruleId": "rdf-bag-container",
      "priority": 100,
      "match": {
        "kind": "type",
        "iri": "http://www.w3.org/1999/02/22-rdf-syntax-ns#Bag",
        "entailment": "rdfs-subclass"
      },
      "project": {
        "operator": "membership-container",
        "membershipPredicate": "http://www.w3.org/2000/01/rdf-schema#member"
      },
      "templateRef": "urn:iriograph:template:region:1"
    }
  ],
  "templates": {},
  "assets": {}
}
```

`match.kind`は`type`、`predicate`、`any-iri-object`のいずれか、`match.entailment`は`exact`、`rdfs-subclass`、`rdfs-subproperty`のいずれかとします。`project.operator`に必要なparameterはoperatorごとにschemaで固定します。

| Operator | 必須parameter | 規則 |
|---|---|---|
| `resource` | `structuralKind` | `node`または`container` |
| `direct-edge` | なし | subjectからobjectへ接続する |
| `membership-container` | `membershipPredicate` | `direction`既定値ではruleが一致したresourceをparent、predicate objectをmemberにする。Class region等は明示directionでobject側をregion、subject側をmemberにできる |
| `ordinal-sequence` | `ordinalPredicatePrefix` | prefix直後の正の10進整数をordinalとして読む |
| `alternative` | `ordinalPredicatePrefix`、`defaultOrdinal` | ordinal memberへbranchを生成する |
| `suppress` | なし | 一致tripleを消費してScene elementを生成しない |

標準catalogでは`ordinalPredicatePrefix`を`http://www.w3.org/1999/02/22-rdf-syntax-ns#_`、`defaultOrdinal`を`1`とします。任意の正規表現やscriptをcatalogへ入れてはなりません。

### 6.3 標準catalogのbinding

標準catalogは少なくとも次をbindします。

| Match | Operator | 既定appearance |
|---|---|---|
| type `rdf:Bag` | `membership-container` | region/container |
| type `rdf:Seq` | `ordinal-sequence` | 薄いsequence groupとmember ordinal badge。通常edgeは生成しない |
| type `rdf:Alt` | `alternative` | choice nodeとbranch共通線＋target arrow |
| predicate `rdfs:seeAlso` | `direct-edge` | 共通線＋target open-arrow |
| predicate `rdfs:isDefinedBy` | `direct-edge` | 共通線＋target open-arrow |
| predicate `rdfs:subClassOf` | `direct-edge` | 共通線＋target triangle |
| predicate `rdfs:subPropertyOf` | `direct-edge` | 共通線＋target triangle |
| predicate `rdfs:domain` | `direct-edge` | 共通線＋target arrow |
| predicate `rdfs:range` | `direct-edge` | 共通線＋target arrow |
| predicate `rdf:type`、`rdfs:label`、`rdfs:comment`、`rdfs:member` | `suppress` | 直接edgeを生成しない |
| `any-iri-object` | `direct-edge` | generic arrow |

`rdfs:Class`、`rdf:Property`および追加domain classはtype appearance ruleとしてnode templateを選べます。type appearance ruleがないresourceはgeneric nodeになります。

標準packageは同じbase rule/templateから次のcatalog presetを生成します。

| Preset | Profile / catalog | 投影目的 |
|---|---|---|
| `full` | `urn:iriograph:profile:rdf-rdfs:1` / `urn:iriograph:catalog:rdf-rdfs@1` | 既存互換。class/property resourceと`subClassOf`、`subPropertyOf`、`domain`、`range`を含むontology・instance全体を表示する |
| `instance-flow` | `urn:iriograph:profile:rdf-rdfs:instance-flow:1` / `urn:iriograph:catalog:rdf-rdfs-instance-flow@1` | `rdfs:Class`・`rdf:Property`として自己宣言された語彙resourceとschema定義edgeを抑止し、instance、Bag/Seq/Alt、domain predicateの利用edgeを表示する |
| `classification-region` | `urn:iriograph:profile:rdf-rdfs:classification-region:1` / `urn:iriograph:catalog:rdf-rdfs-classification-region@1` | region viewでclassを領域、`rdf:type`をmembershipとして維持し、property resourceとschema定義edgeを抑止する |

`classification-region`は既存documentが明示した`kind: "region"`のnamed viewに限って使用します。標準Editorと新規documentは`instance-flow`を使い、Classと`rdf:type`は図の領域ではなくTurtleから導出する型一覧・代表直接型tagで扱い、Bag等の業務membershipだけを領域へ投影します。語彙roleの判定をlabel、namespace、IRIの単語へ依存させず、v1 authoring profileが要求する`a rdfs:Class` / `a rdf:Property`の自己宣言と限定RDFS closureだけを使います。

Coreは`createStandardRdfRdfsCatalog(preset)`、`standardRdfRdfsCatalog`、`standardRdfRdfsInstanceFlowCatalog`、`standardRdfRdfsClassificationRegionCatalog`を公開します。既存の`standardRdfRdfsCatalog`は`full`のidentityと投影を維持します。

`rdf:_n` tripleは一致した`ordinal-sequence`または`alternative` operatorが消費し、fallback対象にしません。対応する構造型を持たないresource上の`rdf:_n`はprofile validation errorです。

### 6.4 Rule解決

同じprojection対象に複数ruleが一致した場合は、次の順に一つを選びます。

1. `priority`が高いrule
2. exact match
3. RDFS closure上で対象IRIまでの距離が短いrule
4. wildcard `any-iri-object`

ここまで同じ候補が複数ある場合はcatalog validation errorです。catalogのimport順、JSON配列順、Turtleの記述順をtie-breakに使ってはなりません。

ベースプロファイルが利用するentailmentは次の閉包だけです。

- 明示された`rdfs:subClassOf`の推移閉包を、明示された`rdf:type`のtype rule照合に使う
- 明示された`rdfs:subPropertyOf`の推移閉包をpredicate rule照合に使う

`rdfs:domain`や`rdfs:range`からのtype推論、OWL entailment、完全なRDFS entailmentはv1のrule matchingに含めません。必要な場合は別validatorまたは将来のprofileで扱います。

## 7. Scene identityとoverlay

- named resourceから生成するnode/containerの`semanticRef`はresource IRIです。
- 直接tripleのedge identityはsubject IRI、predicate IRI、object IRIから決定的に生成します。
- sequence groupのidentityはsequence IRI、ordinal membershipのidentityは対応する`rdf:_n` statementから生成します。
- alternative branch edgeのidentityはalternative IRIとordinalから生成します。
- Turtleの行番号、prefix表記、記述順、labelをidentityに含めてはなりません。

sequenceの順序を変えた場合、変更されたordinal membershipは意味変更なので、該当badgeは新しい`rdf:_n` statementへ追従します。resource IRIが存続するnode/containerのoverlayは維持します。

overlayにlabelを複製しません。既定template、shape、色、iconもcatalogから再生成できる限り複製しません。ユーザーが明示的に変更した場合だけappearance overrideを保持します。

## 8. Workflow例

次のTurtleは、domain固有のworkflow classや`from`/`to` predicateなしに、lane、順序、分岐、参照を表します。

```turtle
@prefix : <urn:example:purchase:> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .

:requesterLane a rdf:Bag ;
  rdfs:label "申請者"@ja ;
  rdfs:member :start, :submit .

:operationsLane a rdf:Bag ;
  rdfs:label "業務オペレーション"@ja ;
  rdfs:member :review, :decision, :register, :rework, :end .

:mainFlow a rdf:Seq ;
  rdfs:label "購入申請フロー"@ja ;
  rdf:_1 :start ;
  rdf:_2 :submit ;
  rdf:_3 :review ;
  rdf:_4 :decision .

:decision a rdf:Alt ;
  rdfs:label "承認判断"@ja ;
  rdf:_1 :approvedPath ;
  rdf:_2 :reworkPath .

:approvedPath a rdf:Seq ;
  rdfs:label "承認"@ja ;
  rdf:_1 :register ;
  rdf:_2 :end .

:reworkPath a rdf:Seq ;
  rdfs:label "差し戻し"@ja ;
  rdf:_1 :rework ;
  rdf:_2 :review .

:start rdfs:label "開始"@ja .
:submit rdfs:label "申請を提出"@ja .
:review rdfs:label "内容を審査"@ja ;
  rdfs:seeAlso :approvalPolicy .
:register rdfs:label "承認結果を登録"@ja .
:rework rdfs:label "内容を修正"@ja .
:end rdfs:label "完了"@ja .
:approvalPolicy rdfs:label "承認ポリシー"@ja .
```

開始event、user task、service task、終了eventの見た目はこのTurtleだけからは区別しません。各named viewはoverlayからcatalogのstart/task/gateway等のtemplateを明示参照できます。標準またはdomain ontologyのtypeをLLM、validation、query、再利用でも使う場合だけ、そのtypeをTurtleへ置いてcatalog ruleへ結びます。Turtleにない業務意味を外観やlabel文字列から推測して補ってはなりません。

## 9. Extension方針

1. domain標準語彙で自然に表せ、LLM、validation、query、再利用に必要な意味は、そのIRIを優先し、独立catalogで表示へ結びます。
2. domain固有語彙が意味として必要なら、利用側namespaceで定義し、`rdfs:Class`、`rdf:Property`、`rdfs:subClassOf`、`rdfs:subPropertyOf`、`rdfs:label`等で自己記述することを推奨します。Appearanceだけなら語彙を作らずtemplate/asset libraryとview overlayを使います。
3. 新しいclassやpredicateの追加だけでcore operatorを増やしてはなりません。既存operatorとtemplateのcatalog ruleを追加します。
4. 新しい空間文法が必要な場合だけoperatorまたはScene primitiveを追加し、domain IRIとは分離します。
5. OWL、PROV-O、SKOS、SHACL等は任意のimport/profileとして追加できます。ベースプロファイルの利用条件にはしません。
6. LLMへはcatalogやoverlayではなく、必要な意味だけを持つTurtleを主入力として渡します。LLMが返したTurtleは本プロファイルの構造検証を通した後にだけ採用します。

未知語彙をgeneric node/edgeとして投影できることは、その語彙をLLMが自由に生成できることを意味しません。人間・LLMのsemantic write policyと表示要求からのrewriteは[authoring-profile.md](./authoring-profile.md)に従います。
Domain resourceとvocabulary、appearance-only情報の判定は[semantic-notation.md](./semantic-notation.md)に従います。

## 10. v1で扱わない事項

- `rdf:List`の`rdf:first`/`rdf:rest`を使った特別投影
- `rdf:Statement`によるreificationまたはRDF-star statementへの特別投影
- blank nodeを表示identityにすること
- literal propertyをannotationへ自動投影すること
- label文言からのnode種別・分岐・包含の推定
- `rdfs:domain`/`rdfs:range`による暗黙type生成
- OWL entailmentと完全なRDFS entailment
- domain業務規則の妥当性検証

`rdf:List`を含むTurtle自体は受理できますが、v1では通常metadataとして保持し、特別な順序edgeは生成しません。domain業務規則は将来のSHACL等のvalidation portで扱います。

## 11. 参照仕様

- [RDF 1.1 Concepts and Abstract Syntax](https://www.w3.org/TR/rdf11-concepts/)
- [RDF Schema 1.1](https://www.w3.org/TR/rdf-schema/)
- [RDF 1.1 Turtle](https://www.w3.org/TR/turtle/)
