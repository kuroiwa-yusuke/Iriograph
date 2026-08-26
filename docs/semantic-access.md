# Semantic Access仕様

## 1. 目的と境界

Semantic Accessは、Iriographの意味グラフを人間とLLMがlabel-firstで探索し、安全なstructured writeを要求するための派生indexです。正本は引き続きIriograph documentの`semantic.source`であり、このindex、alias、検索scoreを保存正本にしてはなりません。

この層は次を行います。

- TurtleをRDF datasetとしてparseし、resource、predicate、label、説明、型、階層、近傍、membershipを索引化する
- Read APIはlabel/commentを主表示にし、machine consumerへ完全IRIとrevision-bound aliasを返す。Standard editorへ渡す場合はpresentation helperでopaque ID化し、生IRIをDOMへ渡さない
- alias操作を`@iriograph/core`の`AuthoringCommand`へ変換する
- preview/applyをhost注入の`SemanticWritePort`へ委譲する

この層は次を行いません。

- labelをidentity、rule key、IRI生成根拠として使う
- SPARQL UpdateやTurtle文字列置換をauthoritative writeとして公開する
- view overlay、座標、色、icon URL、asset byteをLLMへ渡す
- 独自の保存形式、graph database、semantic transaction実装を正本にする

## 2. Index snapshot

`SemanticAccessIndex(document, revision, options)`は一つのdocument revisionに束縛されたimmutable snapshotです。Constructorはdocumentをcloneして固定し、呼出元による同一revision内の破壊的変更からindexとwrite対象の対応を守ります。Hostはsemantic sourceが変わるたびに新しいrevisionでindexを作り直さなければなりません。

Turtle parseはCoreの`parseSemanticGraph`を使い、quad順に依存しないcode point順の索引を作ります。索引対象は次です。

- subject、named object、predicateとして現れる全IRI resource
- `rdf:type`のdirect type
- `rdfs:subClassOf`と`rdfs:subPropertyOf`のtransitive closure
- incoming/outgoingのnamed-resource relation
- `rdfs:member`とそのsubproperty

Blank nodeとliteralはalias対象にしません。Literalはlabel/commentまたはrelation外の属性としてRDF datasetには残りますが、v1のneighbor relationはnamed resource間だけを返します。RDF標準reifierはblank/namedを問わず通常resource、neighbor relation、検索結果から除外し、対応するexact S/P/Oのstatement commentとして索引化します。

## 3. Label、説明、検索

既定の語彙は次です。

| 用途 | Predicate |
|---|---|
| preferred label | `rdfs:label`、`skos:prefLabel` |
| alternative label | `skos:altLabel` |
| comment | `rdfs:comment` |

追加predicateはconstructor optionで注入できます。Domain固有の表示名をサポートしても、元predicate IRIをindex内部で保持します。

表示用label/commentは、指定localeの順に完全一致、primary language一致、languageなし、その他の順で選びます。同順位はlanguage、値、predicate IRIのUnicode code point順で決定します。検索時のUnicode文字列はNFKCとlocale非依存lowercaseで比較します。これにより不正またはruntime未対応localeでcase foldingが例外になることを避け、localeは表示lexical formの選択だけに使います。

検索はfuzzy推測を行わない決定的なlexical rankingです。優先順位は概ね次です。

1. preferred labelの完全一致、prefix一致、部分一致
2. alternative labelの完全一致、prefix一致、部分一致
3. commentの完全一致、prefix一致、部分一致
4. IRIの完全一致、prefix一致、部分一致

Scoreが同じ場合は選択label、完全IRI、match fieldの順でsortします。同名labelは複数結果として残します。Machine resultは完全IRIを保持しますが、standard presentationはtype、説明、近傍とrevision-boundなopaque IDで曖昧性を解消し、生IRIをDOMへ渡しません。Label変更はresource identityを変更しません。

## 4. Alias

Named resourceには`r1`、`r2`、…、predicateには`p1`、`p2`、…を割り当てます。割当はそれぞれ完全IRIのcode point sortから導出するため、同一datasetとrevisionではTurtle記述順に依存しません。PredicateはRDF resourceでもあるため、必要ならresource aliasとpredicate aliasの両方を持ちます。この二つを同一namespaceとして解釈してはなりません。

すべてのalias参照は次の組で渡します。

```json
{
  "alias": "r12",
  "revision": "workspace-revision-42"
}
```

Index revisionと一致しないaliasは`StaleSemanticRevisionError`、該当namespaceに存在しないaliasは`UnknownSemanticAliasError`で拒否します。Aliasを会話memoryへ長期保存したり、revisionを跨いで再利用してはなりません。LLMが返したlabelだけを再検索して一件目へ暗黙解決することも禁止します。

## 5. Read API

| API | 契約 |
|---|---|
| `searchResources(query)` | label、comment、IRIを検索し、完全IRI、`rN`、選択label、typeを返す |
| `searchPredicates(query)` / `searchRelations(query)` | predicateだけを検索し、完全IRI、`pN`、resource alias、usage countを返す |
| `describe(rN)` | 全label/comment、direct type、上位class/property closure、incoming/outgoing件数を返す |
| `hierarchy(reference, kind)` / `predicateHierarchy(pN)` | class/propertyの上位path、distance、revision alias、到達可能なcycle diagnostic、path budgetとtruncated状態を返す |
| `neighbors(query)` | direction、predicate、limitでnamed-resource tripleを返し、exact statement identityと個別commentを保持する |
| `subgraph(query)` | root、0〜10のdepth、direction、predicate、最大relation数を指定し、個別comment付きの部分graphを返す |
| `memberships(query)` | container/memberの向き、元predicate、`rdfs:member`までのdistanceを返す |
| `statementComments(query)` | revision aliasで指定したexact S/P/Oとstatement identityを照合し、その関係だけの多言語commentを返す |

`subgraph`は最大relation数に達した場合`truncated: true`を返します。Host/MCPはこの値を隠さず、追加探索が必要であることをLLMへ伝えます。

### 5.1 Class / predicate階層

`describe`の`superClasses` / `superProperties`と`hierarchy`は、最短親だけに潰さず、要求termから各ancestorへ
到達するfinite simple pathを返します。同じancestorに複数親から到達する通常規模のdiamond DAGでは、
`HierarchyRelation.paths`に各IRI列を別々に保持し、`distance`はそのうち最短のedge数です。結果は完全IRIの
code point順で決定的に並びます。

Path列挙はqueryごとの決定的なbudget（既定256、`hierarchyPathBudget`は1〜4096）を持ちます。
Budget未満では全simple pathを返し、到達時は保守的に列挙を打ち切って`truncated: true`、各relationの
`pathsTruncated: true`、`hierarchy-path-budget-exceeded` diagnosticと絞り込みを促すactionを返します。
Host/MCPはこれらを隠して完全な説明であるかのようにLLMへ提示してはなりません。

`rdfs:subClassOf`または`rdfs:subPropertyOf`にcycleがある場合、cycle内を無限に走査せず
`hierarchy-cycle` diagnosticへ閉路をcanonicalizeして返し、cycleを切るsuggested actionも添えます。Cycleがあってもcycle外へ到達する
有限pathは失いません。Consumerはこの階層を説明・検索・検証に使えますが、上位predicateのdirect relationを
asserted tripleとして追加してはなりません。Query/validationでsubproperty inferenceを有効にするかはhost policy、
catalogの表示ruleがsubproperty照合を採用するかはCore resolution traceの別責務です。

Semantic Accessの`hierarchy-cycle`は検索・説明用indexの診断です。Coreの
`projection-subclass-entailment-cycle` / `projection-subproperty-entailment-cycle`は、同じRDFS階層をcatalogの
rule matchingへ使う際の診断です。Catalog ruleはflatな集合であり、catalog rule自身の継承cycleは存在しません。
この二責務を同じcodeや一つの警告へ統合しません。

Editor/hostがこのexact hierarchyを通常UIへ渡すときは、Coreの
`structuredPredicateHierarchyPresentation`へIRI pathとlabelを内部入力し、predicate catalogと同じopaque ID規則へ
変換します。返却DTOにはlabel、opaque predicate ID、全path、cycle/truncation、host inference policyだけを含め、
生のIRIやSemantic AccessのIRI入りmessageをpresentation item/DOMへ渡しません。CoreからSemantic Accessへの依存は
作らず、label一致でidentityを再解決しません。

### 5.2 Membershipの正規化

次をmembershipとして返します。

- exact `rdfs:member`: distance 0、`generic-membership`
- graph内で`rdfs:subPropertyOf` closureにより`rdfs:member`へ到達するpredicate: 到達distanceと`generic-membership`
- `rdf:_1`、`rdf:_2`等、およびそれらのsubproperty: RDFS axiomatic relationを反映したdistanceと`ordinal-membership`

どの場合もsource tripleの元predicateを失いません。`rdf:_n`はRDFS上membershipですが、IriographではSeq/Altの順序構造にも使います。単純な領域包含だけが必要なconsumerは`includeOrdinals: false`を指定しなければなりません。IndexはBag、Seq、Altの表示文法を決めず、Core projectionへ委譲します。

## 6. Structured write

`compileAliasedOperation`はrevisionと各aliasを検証し、次のalias operationをCore `AuthoringCommand`へ変換します。

- resource作成と初期statement
- property値集合の置換
- resource間接続
- resolved capability適用
- membership、sequence、alternative更新
- resource削除
- exact statement削除
- exact statement comment集合の置換・削除

Predicateは必ず`pN`から解決し、空欄時にgeneric relationを作りません。Literalは値、language、datatypeを構造化したまま渡します。個別関係説明は`set-statement-comments`へcompileし、predicate resourceのcommentやview overlayへ変換しません。新規resource IRI、term policy、structural constraintの判断はCoreのresolved authoring contextが行います。

`SemanticAuthoringFacade`の処理順は次です。

1. Operation revisionと全alias revisionをsnapshotに照合する
2. Aliasを完全IRIへ解決して一つのCore commandへcompileする
3. 注入`SemanticWritePort.preview`へdocument、revision、commandを渡す
4. Portが返した`AuthoringPreview.baseRevision`を再確認する
5. Callerが同じrevisionとexact `confirmationId`を明示する
6. 注入`SemanticWritePort.apply`へ元document、preview、confirmationを渡す

Apply時はpreview revision、operation revision、Core preview revision、caller revisionのすべてが一致しなければなりません。`confirmationId`不一致もport呼出前に拒否します。Core用adapterである`createCoreSemanticWritePort`は、preview/applyごとにresolved authoring contextを取得し、その`documentRevision`を確認してからCoreへ委譲します。Coreはapply時にcommand再compile、policy/validation、confirmation、document fingerprint、全view reconciliationを再実行します。

Cloudがremote WritePortを実装する場合も、この検証を緩和してはなりません。Clientから届くalias解決結果、candidate Turtle、confirmationを信頼せず、service側のcurrent revisionとauthoring contextで再検証します。

## 7. LLM/MCP integration

LLM向けの推奨手順は次です。

1. `searchResources` / `searchPredicates`でlabelと説明から候補を得る
2. 同名候補があれば`describe`、`neighbors`、`memberships`で絞る
3. 必要範囲だけ`subgraph`で取得する
4. Revision付きaliasでstructured operationを作る
5. Semantic diff、diagnostic、candidate sceneを含むpreviewを人またはpolicyへ提示する
6. Explicit confirmation後にapplyする

Python MCPはこのread/write contractをJSON transportとして包むことができます。Python側はRDF parse/cacheやMCP session管理を担当できますが、別のTurtle正本を持ったり、`rdflib`の更新結果を直接保存してauthoring policyを迂回してはなりません。Authoritative applyはIriograph Coreを実行するhost service、または同じCore契約を持つKuroxiom Cloud WritePortへ戻します。

LLMへ送る情報にはsemantic Turtleの必要部分、label/comment、完全IRIまたはrevision alias、profile由来の許可語彙を含められます。View overlay、asset byte、asset取得用認証URLは含めません。
