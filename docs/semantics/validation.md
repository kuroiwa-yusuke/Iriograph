# Semantic validation

この文書は、Iriographのdomain constraint検証境界を定義します。RDF/RDFS構造検証はCoreに残し、SHACL等のdomain validatorはhostが解決して注入します。SHACLは有力なadapter実装ですが、Core、Vue editor、portable documentの依存条件ではありません。

## 責務と注入単位

Hostは`ResolvedSemanticValidationContext`を注入します。

```ts
type ResolvedSemanticValidationContext = {
  contextId: string;
  contextRevision: string;
  validator: SemanticValidationPort;
};
```

`contextId`は検証profile集合のidentity、`contextRevision`は同じidentity内の規則revisionです。どちらも空文字列を許しません。Editorは独立した`semanticValidationContext` prop、または`ResolvedAuthoringContext.semanticValidation`から受け取ります。URIからprofileを取得するresolverはHost注入transportと`@iriograph/profile-resolver`の責務で、Coreは取得やSHACL engine選択を行いません。

Validator requestはN3 `Store`等のengine objectではなく、次を含むserializable dataです。

- exact Turtle文字列に対する`sourceFingerprint`。Source range offsetはJavaScript文字列のUTF-16 code unit単位
- `canonicalQuad`のcode-point順で並べたstatement snapshot
- statement順に依存しない`datasetFingerprint`
- 各statementのstable `statementRef`、RDF term kind、value、language、datatype
- validation context identity/revision

Responseはcontext identity/revision、source fingerprint、dataset fingerprintをechoします。Coreは不一致、adapter throw、不正response、未知の`statementRef`、範囲外source offsetをinternal errorとしてfail closedにします。

## Diagnostic identityとsource location

Validatorは各findingへ、resolved context内で一つのconstraint resultを識別する安定した`findingId`を付けます。`findingId`は表示文や行番号ではなく、constraint identityとfocus/path/value相当から構成します。同じresponse内の重複を許しません。

Coreの`diagnosticId`はcontext identity/revision、`findingId`、code、`semanticRef`、`statementRef`から導出します。severity、message、Turtle書式、source offsetはidentityへ含めないため、空白やprefix表記を変えても同じfindingを追跡できます。

`sourceFingerprint`と`sourceLocation`は別のexact-source bindingです。Source navigationは現在のTurtle draft fingerprintが一致する場合だけoffsetを使います。不一致時に古いoffsetを推測適用せず、`semanticRef`または`statementRef`とScene provenanceによるnavigationだけを残します。Adapterが正確な範囲を確定できない場合、`sourceRange`は省略します。

Diagnostic categoryは少なくとも次を区別します。

- `syntax`: Turtle parse
- `structure`: RDF/RDFS profileのBag、Seq、Alt、包含等
- `profile`: catalog/profile解決・宣言
- `domain`: 注入validatorのconstraint finding
- `projection` / `layout` / `asset` / `internal`: 後続処理またはadapter contract故障

Diagnosticは安定したmachine `code`と詳細`message`に加え、任意のpresentation hintを返せます。Hintは`title`、利用者向け`reason`、一つ以上の`nextActions`、対象resource/statementを持ちます。Actionは`open-vocabulary-manager`、`choose-existing-term`、`open-region-picker`、`show-source`等の汎用IDとseed dataであり、validatorがVue componentや業務predicateを指定しません。Editorは既知actionをbuttonとして表示し、未知actionもreasonを失わず表示します。

選択時点で判定できる無効なclass、region、predicateは候補から除外または理由付きdisableにし、Apply後のdiagnosticだけへ依存しません。Machine codeと完全IRIはHost/Core内部diagnostic・監査logのexact identityとして保持し、通常のpresentation item/DOMやAdvanced詳細へ生IRIを渡しません。利用者には「何ができなかったか」「なぜか」「次に何をすればよいか」をlabel中心で示します。

## Transactionとwarning

Turtle直接編集、structured command、LLM source/canonical datasetは、全view reconciliation後に同じdomain validation portを通ります。Candidateのdomain errorはTurtleとoverlayを元documentへatomic rollbackします。既に読み込まれたdomain-invalid documentはSceneを表示したままdiagnosticを重ね、該当node/container/edgeを`semanticRef`、`statementRef`、projection provenanceでannotationします。

Domain warningを含むcandidateは初回に適用せず、`SemanticWarningConfirmation`を返します。確認は次の全値へ束縛します。

- validation context identity/revision
- exact source fingerprint
- code-point順にsortしたwarning diagnostic ID集合

再実行時に一つでも変われば確認は無効です。Structured authoring previewは同じtokenをpreview confirmationへ含め、Apply時にcandidateを再構成・再検証します。

Abortはvalidation failureではなくcontrol flowです。Coreは`aborted: true`と空の追加diagnosticsを返し、Editorはrequest tokenと`AbortSignal`でstale resultを破棄します。中断をユーザー向けdomain errorとして表示しません。

## Cache identity

P1-08のvalidation task/cache keyは`contextId + contextRevision + datasetFingerprint + sourceFingerprint`から作ります。同じgraphでもTurtleの空白、prefix、statement記述順が違えばsource rangeを再取得するため別keyです。一方、`datasetFingerprint`と`diagnosticId`は書式変更で維持されます。将来findingだけをdataset単位でcacheする場合は、source rangeの再mappingを別層に分離します。

Mockはstatic TypeScript validatorで「業務フロー要素には空でない`rdfs:label`が必要」というfixture規則を実装します。SHACL dependencyを追加せず、port差し替えとUI lifecycleを検証するための実装です。
