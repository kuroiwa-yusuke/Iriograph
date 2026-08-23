# Semantic Authoring Profile仕様

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
    ]
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

Rich editorはTurtle文字列の書き換えをUI独自の実装で行わず、authoring profileから解決したclass、predicate、resource namespaceと、view profile/catalogから導出したsemantic capabilityを入力候補に使います。Labelは選択用表示に使えますが、commandは必ずIRIを持ちます。

通常UIは完全IRIを常時入力させる必要はありません。Host注入のIRI allocatorまたは明示入力からnamed IRIを得られますが、どちらも`allowedMintNamespaces`とgraph内衝突を検証します。Allocatorが返したIRIであってもauthoring policyを迂回できません。

Human structured commandは次のpolicyに従います。

- `create-resource`はallowed namespace内のnamed IRIと、当該resourceを含む少なくとも1つの初期statementを同一transactionで作る。Sceneにだけ存在するnodeは作らない
- literal属性の追加、置換、削除もsemantic transactionとし、predicate、datatype、language tag、domain constraintを検証する
- edgeはpredicateまたは明示的なsemantic capabilityの選択を必須にする。選択されたpredicateにcatalog ruleがなくても、policy上許可されたIRI-object tripleならunknown fallbackの通常矢印として表示できる
- `:relation`等の一般的なpredicateを空欄のfallbackとして生成しない。適切な語彙がなければ、humanUnknown policyに従って警告・拒否し、または語彙整備を促す
- 包含、順序、選択は、structure profileとprojection capabilityで許可されたgraph patchとして一括適用する。Dragをmembershipと解釈するなど、presentation gestureからsemantic tripleを暗黙生成しない
- Resource削除は参照statementが残る場合に既定で拒否する。影響statementをpreviewし人が明示したcascadeだけを許可し、Seq/Alt memberの削除では残るordinalを同じpatchで再採番する
- `humanUnknown: warn`の操作はdiagnosticと完全IRIを提示し、人が明示確認した場合だけ再実行できる

Structured commandはRDF datasetへのgraph patchに変換した後、Turtle textareaの候補sourceおよびLLMが返した候補sourceと同じパイプラインへ合流します。Actor policyは差分検証時に適用し、その後の構造検証、domain validation、全viewの再投影、display reconciliationはactor間で共通にします。

Node、edge、属性、包含、削除の入力はサイドバー上のcommand draftです。Canvas gestureはsource/target、作成位置、候補container等をdraftへseedできますが、それだけではsemantic graphを変更しません。Editorは追加・削除予定のtripleまたは構造graph patch、完全IRI、validation結果をpreviewし、ユーザーの明示適用後にだけtransactionを開始します。適用前のghost elementはephemeral UI stateでありdocumentへ保存しません。

P1 editorはhostから取得処理ではなく、解決済みの`ResolvedAuthoringContext`と任意のresource IRI allocatorを受け取ります。Mockはstatic fixtureを注入します。Profile/vocabulary URIからcontextを取得するresolverはP2-01で実装します。

Structured commandとLLM editが成功した場合は、candidate datasetを共通のversioned serializerで決定的なTurtleへ再生成します。Turtle textareaの直接編集は妥当な原文を保持します。Comment、空白、改行、triple記述順は後の再serialize時には保持を保証せず、reviewにはgraph単位のsemantic diffを用います。

## 7. LLMへ渡すcontext

LLM semantic adapterは次だけを編集contextとして構成します。

1. 現在の`semantic.source`
2. 使用可能なclassとpredicate、そのlabel/comment、上位語彙
3. Bag、Seq、Alt等の利用可能なstructure ruleと制約
4. user requestに関係するprojection capability summary
5. document revisionと編集上の禁止事項

LLMへportable document全体、overlay座標、waypoint、asset取得URLを渡しません。catalog JSON全体を渡す代わりに、必要なsemantic patternと表示効果だけをprojection capability summaryとして抽出します。

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
