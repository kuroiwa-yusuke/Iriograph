# Semantic informationと表示notationの境界

## 1. 目的

`semantic.source`には、LLM、validator、query、別view、別hostで再利用する意味だけを保存します。見た目を選ぶためだけのclassやpredicateは追加せず、template、shape、色、iconはcatalogと各named viewのoverlayで指定します。

この境界はTurtleを短くすること自体が目的ではありません。表示を変更しただけで意味graphやLLM入力が変わることを防ぎ、同じ意味から用途別のviewを作れるようにするための規則です。

## 2. Domain resource IRIとdomain vocabulary IRI

Domain resource IRIは、業務上の対象や出来事を識別します。たとえば`ex:review`、`ex:approvalPolicy`はresourceであり、subjectまたはobjectとして関係、label、構造membershipを持ちます。

Domain vocabulary IRIは、graphを解釈する語彙です。主に次の位置に現れます。

- predicate
- `rdf:type`のobject
- `rdfs:Class`、`rdf:Property`として宣言されるsubject
- `rdfs:subClassOf`、`rdfs:subPropertyOf`等の語彙関係

両者をnamespace、local nameの大文字・小文字、labelから推測しません。同じIRIが複数の役割を持てるRDFの性質は維持しますが、authoring profileは実際に使うroleを明示します。

## 3. Turtleへ入れる判断

次のいずれかに必要ならsemantic informationです。

- LLMが業務内容を理解・編集する
- validatorが許可、必須、整合性を判定する
- query、索引、検索、推論に利用する
- 他のdiagram、document、hostから参照する
- domain間で意味を保って再利用する

`rdf:Bag`/`rdfs:member`の包含、`rdf:Seq`/`rdf:_n`の順序、`rdf:Alt`の選択は、配置だけでなくgraphの構造として検証・再利用するためTurtleに残します。`rdfs:label`、`rdfs:seeAlso`、意味のある`relatedTo`や`retry`も同様です。

一方、次の用途しかない情報はpresentationです。

- startを緑のcircleにする
- taskへ人型iconを付ける
- gatewayをdiamondにする
- viewごとにtemplateや色を変える
- geometry、routing、pinを調整する

この目的だけで`ex:StartEvent`、`ex:UserTask`等のtypeを作りません。既存ontologyの`UserTask`と`ServiceTask`の差をvalidation、query、LLM、再利用にも使うなら、そのtypeは意味があるためTurtleへ置けます。判断基準は語彙名ではなく利用目的です。

## 4. 表示指定

Catalogはtemplateとassetの再利用可能なlibraryを提供できます。Semantic ruleへ結び付いていないtemplateも有効です。各named viewは対象resourceのoverlayに`appearance.templateRef`または`appearance.iconRef`を明示し、同じresourceを別viewで異なる外観にできます。

```json
{
  "semanticRef": "urn:example:flow:start",
  "appearance": {
    "templateRef": "urn:example:template:start-event:1"
  }
}
```

Overlayの指定をTurtleから推測したtypeへ逆変換しません。Templateを変えてもsemantic revisionを作らず、Turtleを変更しても存続resourceのuser overlayは互換な範囲で維持します。

## 5. 例

表示のためだけにtypeを持つ次の形式は避けます。

```turtle
:start a :StartEvent ; rdfs:label "開始"@ja .
:review a :UserTask ; rdfs:label "内容を審査"@ja .
```

業務上必要な情報だけなら次で十分です。

```turtle
:start rdfs:label "開始"@ja .
:review rdfs:label "内容を審査"@ja ;
  rdfs:seeAlso :approvalPolicy ;
  :retry :review .
```

Start circleとtask iconはview overlayが選びます。後から本当にtask分類が必要になった場合は、表示設定を正当化するためではなく、語彙と利用規則をversion管理したsemantic changeとして追加します。

## 6. LLMとserializer

LLMへ渡すのはTurtleと許可語彙・構造制約であり、overlay、template、asset URLではありません。したがってappearance-only typeをTurtleへ混ぜると、LLMが存在しない業務分類を意味として学習・再生成するため禁止します。

人がtextareaで直接適用した妥当なTurtleは原文を保持します。Structured commandとLLM editはexpanded RDF tupleを決定的にsortした後、標準prefix、base/default prefix、妥当な入力prefixを選び、`rdf:type`を`a`、短縮可能なIRIをprefixed nameとしてcanonical serializeします。Prefix alias、triple順、`a`と`rdf:type`、full IRIとprefixed nameの差はsemantic informationではありません。
