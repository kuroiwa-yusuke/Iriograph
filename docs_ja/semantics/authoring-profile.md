# Semantic Authoring Profile

## 1. 目的

この文書は、Iriograph v1で人間またはLLMがTurtleを変更するときの語彙統制を定める規範仕様です。

Rendererは未知語彙をgeneric node/edgeとして読めるopenな設計を維持します。一方、LLMが未定義predicateや類似語彙を増やすことを防ぐため、semantic writeはauthoring profileで制御します。基本原則は「読み込みは寛容、生成は保守的」です。

## 2. Profileの分離

Iriographでは三種類の設定を混同しません。

| 設定 | Document上の参照 | 責務 |
|---|---|---|
| Authoring profile | `semantic.authoringProfileRef` | semantic transactionで使用可能な語彙とIRI生成policy |
| View profile | `views[].profileRef` | Bag、Seq、Alt等の構造制約とScene投影方式 |
| Catalog | `imports[].catalogRef` | semantic patternとtemplate、icon、style、projection operatorのbinding |

Catalogに表示ruleがないことは、語彙が不正であることを意味しません。反対に、catalogに表示ruleがあることだけでLLMの書き込みを許可してはなりません。

## 3. Target manifest

Authoring profileはdocument外でversion管理し、host resolverが`authoringProfileRef`から解決します。

```json
{
  "schemaVersion": "1",
  "kind": "iriograph.authoring-profile",
  "profileId": "urn:example:authoring-profile:purchase",
  "profileVersion": "1",
  "structureProfiles": [
    "urn:iriograph:profile:rdf-rdfs:1"
  ],
  "vocabularyImports": [
    {
      "vocabularyRef": "urn:iriograph:vocabulary:rdf-rdfs@1"
    },
    {
      "vocabularyRef": "urn:example:vocabulary:purchase@1"
    }
  ],
  "resourcePolicy": {
    "allowedMintNamespaces": [
      "urn:example:purchase:"
    ],
    "maxInitialPositionExtent": 32768
  },
  "termPolicy": {
    "existingUnknown": "preserve",
    "humanUnknown": "warn",
    "llmUnknown": "reject",
    "humanMinting": "warn",
    "llmMinting": "deny"
  }
}
```

`vocabularyImports`のresolverは、少なくともclass IRI、predicate IRI、`rdfs:label`、`rdfs:comment`、上位class/propertyを含むvocabulary indexを返します。authoring promptへはこのindexから必要な語彙だけを抽出し、display templateやasset URLを語彙定義へ混ぜません。

v1で許可するpolicy値は次です。

| Field | 値 |
|---|---|
| `existingUnknown` | `preserve`、`reject` |
| `humanUnknown` | `allow`、`warn`、`reject` |
| `llmUnknown` | `reject` |
| `humanMinting` | `allow`、`warn`、`deny` |
| `llmMinting` | `deny` |

LLM側の値はprofileごとに緩和できません。新語彙が必要な場合は、人間または管理workflowがvocabularyとauthoring profileをversion更新してから再実行します。

## 4. 語彙判定

Authoring policyが検査する「term」は次です。

- tripleのpredicateとして使われるIRI
- `rdf:type`のobjectとして使われるclass IRI
- classまたはpropertyとして新たに宣言されるIRI
- view profileが構造語彙として解釈するIRI

業務instanceやflow要素としてsubject/objectに作るresource IRIはtermではありません。新規resource IRIは`resourcePolicy.allowedMintNamespaces`で検査します。

低水準`create-resource.initialPosition`を使うhostでは、root要素の初期位置は現在のScene boundsに制限しません。現在の図の少し外側へ置いた要素はoverlay geometryとして保存され、Canvas work areaを拡張します。異常に遠い座標だけを独立した`resourcePolicy.maxInitialPositionExtent`（省略時32768、要素のright/bottomを含む）で拒否します。親Groupを持つ要素はこのroot上限ではなく、そのGroupのcontent boundsをhard constraintとします。この値は表示viewportの大きさではなく、誤操作による巨大work areaを防ぐtransaction安全上限です。

S/P/Oという文中の位置ではなく、instance resourceと再利用するvocabulary termを区別します。Instanceのsubject/objectは許可namespace内のopaque IRIをallocatorで生成でき、人間とLLMはlabel/commentを主に理解します。Predicate、class、predicate objectとして選ばれる語彙termはprofileの統制対象です。独自termのlocal nameも人間可読である必要はありませんが、label、comment、上位term、必要に応じdomain/rangeを自己記述します。全IRIは文字列の読みやすさによらず安定identityです。

termは次のいずれかを満たす場合にknownです。

1. `structureProfiles`が提供する標準term
2. `vocabularyImports`で解決されたterm
3. authoring profile自身が将来提供する明示的なterm追加

Documentに既に存在するunknown termは読み込みを妨げません。既定の`existingUnknown: preserve`では、そのtripleを変更せず保持できますが、LLMがそのtermを使う新しいtripleを追加することはできません。再利用を認める場合は、termをvocabularyへ登録してprofile versionを更新します。

## 5. Actor別policy

| 操作 | 既定policy | 結果 |
|---|---|---|
| Rendererがunknown termを読む | allow | generic node/edgeまたはmetadataとして保持 |
| 人間がunknown termを使う | warn | diagnosticを提示し、明示操作なら適用可能 |
| LLMがunknown termを新規使用する | reject | semantic transaction全体を不採用 |
| 人間が新しいtermを定義する | warn | vocabulary登録を促す |
| LLMが新しいtermを定義する | deny | 自動mintしない |
| LLMが新しいinstance resourceを作る | namespace内でallow | 許可namespace外ならreject |

LLM semantic editを有効にするhostは、authoring profileを解決できなければなりません。未解決時に「すべて許可」へfallbackしてはならず、semantic editを停止してdiagnosticを返します。

## 6. Human structured authoring

Rich editorはTurtle文字列の書き換えをUI独自の実装で行わず、authoring profileから解決したclass、predicate、resource namespaceと、view profile/catalogから導出したsemantic capabilityを入力候補に使います。Labelとcommentは人が意味を理解するための主表示ですが、commandは必ずIRIを持ちます。Labelはrule keyでもidentityでもありません。同名labelは説明、型、近傍とopaque option IDで曖昧さを解消し、compact IRIをpresentation item/DOMへ渡しません。

Predicate候補はlocale別label/commentに加え、category、短いexample、`sentencePattern`を持てます。`sentencePattern`はsubjectを仮の`A`、objectを仮の`B`とする自然文（例「AはBから派生した」）で、pickerはcategory別にこの文を並べます。A/Bは入力対象の役割を説明する表示専用placeholderであり、確定edgeのlabel、caption、Turtleへ保存しません。文型metadataはcatalog/vocabulary正本から解決し、IRI local nameや英語labelの分割から助詞を推測しません。Metadataがない場合は`A（通常label）B`という決定的fallbackを使い、選択支援のために新しいsemantic termを作りません。

関係候補はprofileが許可する`rdf:Property`、`owl:ObjectProperty`、`owl:DatatypeProperty`等に加え、解決済み標準catalogが提供するDCTERMS、PROV-O、SKOS等の既知predicateとsemantic capabilityから作ります。Source/targetの明示`rdf:type`と限定`rdfs:subClassOf` closure、predicateの`rdfs:domain`/`rdfs:range`、object/literal kindに明確に反する候補は除外します。型が不明な候補は適合と断定せず「型未確認」として後順位に残し、実行操作内のprofile/domain validationで最終判定します。Pickerが完全なOWL reasonerを内包したり、label文字列からdomain/rangeを推測したりしてはなりません。Category、example、`sentencePattern`は表示metadataであり、predicateのidentityや推論規則を置き換えません。

Standard editorの通常UIとAdvanced詳細は、生のIRIを表示・入力しません。新規resourceはhost注入のIRI allocatorからnamed IRIを得て、既存resourceと語彙termはlabel/comment付きのopaque option IDから解決します。Exact IRIとstatement identityはHost/Core内部transaction・監査logに保持します。直接IRIを扱う必要がある管理者・開発者は、standard editorのstructured formではなく、editableなTurtle/Document sourceまたはhost固有vocabulary管理を使います。Allocator結果とsource editはいずれも`allowedMintNamespaces`、graph内衝突、actor policyを検証し、authoring policyを迂回できません。

`allowedMintNamespaces`はnode作成専用の制約ではありません。Structured commandまたは直接Turtle editで新しく登場するinstance resource IRIは、subject、IRI-object tripleのobject、propertyのIRI value、構造member等のどの位置でも同じnamespace policyを通ります。Predicateやclass等のsemantic termはresource namespaceではなく、vocabulary indexとunknown-term policyで検査します。UIは既存resourceの明示選択を優先しますが、許可namespace内なら各instance位置で新規resourceを参照・作成できます。

Human structured commandは次のpolicyに従います。

- `create-resource`はallowed namespace内のnamed IRIと、当該resourceを含む少なくとも1つの初期statementを同一transactionで作る。Sceneにだけ存在するnodeは作らない
- literal属性の追加、置換、削除もsemantic transactionとし、predicate、datatype、language tag、domain constraintを検証する
- 属性編集はsubject/predicateの値集合を完全置換する。空文字列literalは有効な一値であり、削除は空の値集合として明示する。IRI/literalの複数値を順序に依存せず失わず扱う
- edgeはpredicateまたは明示的なsemantic capabilityの選択を必須にする。選択されたpredicateにcatalog ruleがなくても、policy上許可されたIRI-object tripleならunknown fallbackの通常矢印として表示できる
- direct edge固有の説明は、asserted S/P/Oを残したRDF 1.1標準reificationの`rdfs:comment`としてexact statementへ付ける。独自edge annotation語彙やview overlayを意味説明の正本にせず、空集合による削除もsemantic transactionとする
- `:relation`等の一般的なpredicateを空欄のfallbackとして生成しない。適切な語彙がなければ、humanUnknown policyに従って警告・拒否し、または語彙整備を促す
- 包含、順序、選択は、structure profileとprojection capabilityで許可されたgraph patchとして一括適用する。Dragをmembershipと解釈するなど、presentation gestureからsemantic tripleを暗黙生成しない
- 一つのresourceが複数containerへ属するmembershipを許容する。階層container viewで単一parentとして描けないことをsemantic errorにせず、region view等の適合する空間文法を選ぶ。どのviewでもgeometryからmembershipを生成しない
- `set-alternatives`では`memberIris`を最終ordinal順の正本とし、重複IRIも並び替えない。`defaultMemberIri`は`memberIris[defaultOrdinal - 1]`と一致しなければならない
- Coreのresource削除commandは参照statementが残る場合にcascade省略を拒否する。標準Editorは選択外のedge、membership、Seq/Alt membershipへ影響が及ぶ場合だけlabel付きの影響一覧とCanvas previewを示して明示cascadeを確認し、影響objectをすべて選択済みなら一回の操作で直接確定する。Seq/Alt memberの削除では残るordinalを同じpatchで再採番する
- `humanUnknown: warn`は低水準controlled source APIではdiagnostic、完全IRI、再実行tokenをhostへ返すが、生IRIをstandard presentation/DOMへ渡さない。Standard editorは未登録IRIを入力候補にせず、非削除warningを該当fieldのinline guidanceとして示して同じ操作を確定しない

Standard editorの`要素を追加`は最初に通常要素かグループかを選びます。通常要素はallocatorが発行したopaque IRI、active localeの`rdfs:label`、resolved profileが許可するnode-role classを一つのtransactionで作り、profileが未分類要素を明示許可しない限りclassを一件以上要求します。グループは分類、包含、順序付き、候補の固定種類から選び、それぞれ`rdfs:Class`、`rdf:Bag`、`rdf:Seq`、`rdf:Alt`として名前と同時に作ります。新しいclass termをmintする分類グループだけは`allowClassificationGroups: true`を明示したprofileで有効にし、通常のunknown term/minting policyも迂回しません。通常要素とgroup structural roleを同じresourceへ混在させません。Comment、direct edge、initial geometryは作成formへ含めず、後続の意味編集またはビュー編集で扱います。

Standard UIはCoreの`previewStructuredAuthoringRequest`を薄いtransaction facadeとして利用できます。既存resourceはCanvasの`viewId + elementId`、node-roleは`roleId`、predicateは`predicateId`で渡し、UIがclass/predicate/resourceの完全IRIを組み立てません。Facadeはこれらをresolved contextとScene provenanceから完全IRIへ戻し、既存の`AuthoringCommand[]`、candidate validation、全view reconciliationへ合流させます。`structuredAuthoringPresentation`が返すprofile node-role/group kind metadataとpredicate catalogは別collectionであり、表示categoryをsemantic role判定へ流用しません。

`関係を追加`のdirect familyは一つの始点と一件以上の接続先を取り、共通predicateまたは行別predicateを一つのatomic command列へcompileします。Request内に同じS/P/Oが複数ある場合、または一行でも既存asserted S/P/Oと一致する場合は、修正行動付きerrorで全行を拒否し、残りだけを追加しません。暗黙の多対多や通常nodeのgroup化は行いません。Membership familyは既存Group Frame一件を先に選び、Bag/classificationにはmemberを追加し、Seq/Altには最終ordered listを渡します。Member解除、並べ替え、既定候補変更は`関係を変更する`またはgroup詳細へ委譲します。Altの既定候補はUIで選んだ出現indexをordinal 1へ決定的に移し、残る候補の相対順を保持します。同じIRIの重複出現をvalue identityで統合しません。Inline新規memberはcompactなlabelとnode-roleだけを持つephemeral itemで、全IRI allocation、type/label、membership/ordinal/defaultを一candidateへまとめます。Allocation、profile/domain validation、stale revision、いずれかのview projectionが失敗した場合は一件もdocumentへ適用しません。同名labelをidentityとして統合しません。

既存通常要素の種類変更は完全なopaque `roleId`集合で指定し、profile管理下のclassだけを置換します。Profile外の既存typeは保持し、Group構造typeとの混在、Group Frame対象、未解決role IDを拒否します。Classification region一件またはderived intersectionとして明示選択した複数regionからは、構成classをprofileのrole IDへ解決できた場合だけseedし、geometry上の重なりから種類を推論したりclass IRIを通常UIへ返したりしません。Group kind変更はmemberを持たない空Groupだけへ専用操作として許可し、通常nodeとGroupは相互変換しません。

名前・説明の通常編集はCoreが返すopaque value IDと`default`、`translation`、`untagged`、`typed`のlocale区分だけを使います。選択した一値を変更しても他language/datatypeを保持し、生のlanguage tagやdatatype IRIを構造化detailsへ表示・入力させません。これらの直接編集はTurtle/Document sourceへ限定します。

Structured commandはRDF datasetへのgraph patchに変換した後、Turtle textareaの候補sourceおよびLLMが返した候補sourceと同じパイプラインへ合流します。Actor policyは差分検証時に適用し、その後の構造検証、domain validation、全viewの再投影、display reconciliationはactor間で共通にします。

Domain validationは[Semantic validation](./validation.md)のhost注入portを使います。Authoring profileのunknown term warningとdomain validator warningは発生源を分けますが、いずれもcandidateを黙って確定しません。Domain warningの再実行tokenはvalidation context、exact source、安定diagnostic ID集合へ束縛します。Standard editorは非削除warningをmodal確認にせず該当段階のinline guidanceとして返し、削除影響modalと混同しません。

右InspectorはCanvas選択中心とし、初期blur状態では`新しい要素を作る`、`関係を作る`、`要素を変更する`、`関係を変更する`の4入口だけを表示します。入口を選んだ後は一段に一つの判断を順次表示し、Canvas事前選択を各入力roleへ明示的にseedします。右クリック、Context Menu key、Shift+F10は同じ対象別menuを開き、node、direct edge、derived sequence/alternative guide、各group kind、空白に適用可能な意味・ビュー・配置・削除の入口だけを示します。Menu選択だけではmutationせず、該当Inspector/actionへfocusします。Canvas gestureも作成formのsource/targetをseedできますが、それだけではsemantic graphを変更しません。`要素を追加`はCanvas位置を受け取りません。通常UIとAdvanced DOMはresource・predicateのlabel/commentとCanvas上のobject選択を使い、identityはopaque option IDで保持します。完全IRI、内部operation名、capability graph patchを表示しません。非削除操作は利用者の実行一回の内部でcandidate graphを検証してatomic transactionを確定し、別のPreview/Apply画面を挟みません。選択外へ波及する削除だけ、影響一覧とCanvas上の赤線をsession-only previewとして示して明示確認します。

Capability parameterは省略時をrequiredとし、`required: false`だけをoptionalとします。Optional bindingが省略された場合、そのbindingを参照するtemplate statementをadd/removeの双方で一文単位にskipします。値の推測や空文字列への置換は行いません。

Editorはhostから取得処理ではなく、解決済みの`ResolvedAuthoringContext`と任意のresource IRI allocatorを受け取ります。Mockはstatic fixtureを注入します。Profile/vocabulary URIからcontextを取得するresolverは`@iriograph/profile-resolver`で提供し、Hostのnetwork、tenant認証、immutable cacheは注入transportに留めます。

Structured commandとLLM editが成功した場合は、candidate datasetを共通のversioned serializerで決定的なTurtleへ再生成します。LLMを含む直接source editは`applyAuthoringSource`へactorを明示して入力し、`actor: "llm"`はversioned serializerを通します。`actor: "human"`のTurtle textarea直接編集だけは妥当な原文をbyte単位で保持します。Comment、空白、改行、triple記述順は後のstructured commandまたはLLM再serialize時には保持を保証せず、reviewにはgraph単位のsemantic diffを用います。

`ResolvedAuthoringContext.defaultLocale`は、新規structured label/commentでlanguageが省略された場合だけactive localeを補うために使います。既存の無言語literalを編集するUIはRDF 1.1上同値な`xsd:string` datatypeを明示し、既存language付きliteralはlanguageだけを引き継ぎます。これにより再serializeを伴っても既存値へdefault localeを黙って付与しません。
通常の名前・説明編集はCoreが発行したopaque value identityで一literalを指定し、同じpredicateの全値を再構成して確定します。選択した値は元のlanguage/datatypeを継承し、他言語、無言語、typed literalをそのまま保持します。Standard UIは`@ja`等の生tagを入力させず、tag自体を変える操作はTurtle source編集へ限定します。

## 7. LLMへ渡すcontext

LLM semantic adapterは、全文編集が必要な小規模graphでは次のcontextを構成できます。

1. 現在の`semantic.source`
2. 使用可能なclassとpredicate、そのlabel/comment、上位語彙
3. Bag、Seq、Alt等の利用可能なstructure ruleと制約
4. user requestに関係するprojection capability summary
5. document revisionと編集上の禁止事項

LLMへportable document全体、overlay座標、waypoint、asset取得URLを渡しません。catalog JSON全体を渡す代わりに、必要なsemantic patternと表示効果だけをprojection capability summaryとして抽出します。

大規模graphまたは探索的な作業では、LLMへ最初からTurtle全文を渡す必要はありません。Iriograph semantic accessはTurtleから次を決定的に索引化し、検索結果または関連subgraphだけを返します。

- locale順で選ばれた`rdfs:label`と`rdfs:comment`、任意のSKOS alias
- resourceの型、predicateのlabel、`rdfs:subClassOf`/`rdfs:subPropertyOf`関係
- incoming/outgoing近傍、包含membership、要求depthまでのsubgraph
- document revisionに束縛した短いresource/predicate alias

LLMはlabelと説明で検索・選択し、structured operationには短いaliasを使えます。Adapterはpreview時にaliasを完全IRIへ戻し、元revision、profile、引数を再検証してCoreの`AuthoringCommand`へcompileします。Aliasはrevisionを跨いで再利用できず、label変更や同名labelでもidentityは変わりません。Raw SPARQL Updateをauthoritative write portとして公開せず、既存RDF query packageはparse/index/readの内部実装として包みます。Python MCPは同じread/write contractをtransportとして公開できますが、applyはCoreまたはCloud側のWritePortを通します。

LLMには次の優先順位を明示します。

1. 現在のgraphで使われ、authoring profileにも登録されたtermを再利用する
2. imported vocabularyの既存termを使用する
3. 適切なtermがなければ新語を作らず、不足語彙として報告する

## 8. 表示要求からのsemantic rewrite

Userの表示要求は、適用前に次の三種類へ分類します。

| 要求 | 例 | Transaction |
|---|---|---|
| Presentationのみ | 位置、size、routing、色、icon override | overlay編集またはcatalog選択。Turtleを変更しない |
| Semantic structureを伴う表示 | laneに分ける、順序を明示する、選択肢として表す | authoring profileに従ったTurtle rewrite |
| Domain意味を伴う表示 | service taskとして分類し対応iconを使う | 許可classが実際の意味と一致する場合だけTurtle rewrite |

「見栄えを良くする」という理由だけでsemantic type、関係、包含、順序を追加してはなりません。Turtle rewriteはuser requestが意味構造の変更を含む場合、またはuserが提案されたsemantic diffを明示的に承認した場合に限ります。

### 8.1 Projection capability summary

Hostは解決済みview profileとcatalogから、LLM向けに次のderived情報を生成できます。

```json
{
  "capabilityId": "region-membership",
  "semanticPattern": "rdf:Bag + rdfs:member",
  "displayEffect": "members are laid out inside a visible region",
  "authoringTerms": [
    "http://www.w3.org/1999/02/22-rdf-syntax-ns#Bag",
    "http://www.w3.org/2000/01/rdf-schema#member"
  ]
}
```

Capability summaryは保存正本ではありません。利用可能な表示能力を説明するだけで、座標、色、URLなどpresentation固有値を含めません。

たとえば「部署ごとにlane表示して」という要求には`rdf:Bag + rdfs:member` capabilityを提示し、LLMは既存resourceをBagへ所属させるsemantic diffを提案できます。「laneを青くして」という要求にはTurtle rewriteを行わず、catalogまたはoverlayのpresentation transactionを使います。

### 8.2 Rewrite処理

1. User requestをpresentation、semantic structure、domain meaningに分類する
2. PresentationだけならLLM semantic editを呼び出さない
3. Semantic rewriteが必要なら、関連capabilityと許可termだけをLLMへ渡す
4. LLMの返却Turtleをparseする
5. 元graphとの差分から新規predicate、class、namespace、structureを抽出する
6. authoring profile、view profile、domain validatorで検証する
7. 再投影して要求したcapabilityが成立するか確認する
8. Semantic diffを提示またはpolicyに従って適用し、display reconciliationを行う

どの段階で失敗しても元documentを維持します。LLMの説明文ではなく、Turtle差分と検証結果を採否の根拠にします。

## 9. Diagnostic

少なくとも次のcodeをtarget contractとします。

| Code | Severity | 意味 |
|---|---|---|
| `authoring-profile-unresolved` | error | profileを解決できずcontrolled writeを開始できない |
| `unknown-term-introduced` | warning/error | actor policy外のpredicateまたはclassを追加した |
| `term-minting-denied` | error | actorが新しいsemantic termを定義しようとした |
| `resource-namespace-denied` | error | 許可外namespaceにinstance IRIを作った |
| `semantic-rewrite-not-required` | info | presentation transactionで処理すべき要求だった |
| `projection-capability-unsatisfied` | error | rewrite後も要求した構造表示を導出できない |

## 10. 非目標

- Catalogをsemantic vocabularyのallowlistとして使うこと
- LLMにcatalog template、CSS、asset URLを自由編集させること
- Unknown termを含む既存documentを読めなくすること
- 表示都合だけで意味graphを自動的に改変すること
- 不足語彙をLLMにその場で命名・定義させること
