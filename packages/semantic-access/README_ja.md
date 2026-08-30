# @iriograph/semantic-access

`@iriograph/semantic-access`は、Iriograph documentのTurtleを人間・LLM向けに検索し、短いaliasを安全なCore authoring commandへ変換するframework非依存packageです。

Labelは発見と説明に使いますが、identityには使いません。検索結果は常に完全IRIとdocument revisionに束縛されたaliasを返します。表示overlay、asset byte、raw SPARQL UpdateはAPIへ公開しません。

標準predicate presentation APIは、RDF/RDFS、Dublin Core Terms、PROV-O、SKOS、OWLのRestrictionではない代表的な関係predicateへ、英語または日本語のlabel、説明、category、A–B例文、利用例を付けます。既定localeと未知localeのfallbackは英語です。`en-US`と`ja-JP`等の地域tagを正規化し、locale間でpredicate IRIとstructural flagは変わりません。

```ts
import {
  standardPredicateTerms,
  standardPredicateVocabulary,
  standardPredicateVocabularyForLocale,
} from "@iriograph/semantic-access";

const englishDefaults = standardPredicateVocabulary;
const japanese = standardPredicateVocabularyForLocale("ja-JP");
const dependencies = standardPredicateTerms({ locale: "ja", categories: ["依存"] });
```

既存の`standardPredicateVocabularyJa`と`standardPredicateTermsJa(categories)`も互換APIとして利用できます。表示metadataは検索支援だけに使い、commandと索引は常に標準IRIをidentityとして保持します。

## Install

```sh
npm install --save-exact @iriograph/core @iriograph/semantic-access
```

## Read

```ts
import { SemanticAccessIndex } from "@iriograph/semantic-access";

const semantic = new SemanticAccessIndex(document, workspaceRevision, {
  locales: ["ja-JP", "en"],
});

const resources = semantic.searchResources("申請");
const predicates = semantic.searchPredicates("承認");
const details = semantic.describe({
  ...resources[0].reference,
});
const related = semantic.subgraph({
  root: resources[0].reference,
  depth: 2,
});
```

主なread APIは次のとおりです。

- `searchResources`、`searchPredicates` / `searchRelations`: label、SKOS alias、comment、IRIの決定的なlexical検索
- `describe`: localeに適合する表示名、全label/comment、type、class/property階層、近傍件数
- `hierarchy` / `predicateHierarchy`: multi-parent階層の全finite simple pathと距離。到達可能なcycleは
  traversalを停止した`hierarchy-cycle`診断として返す
- `neighbors`、`subgraph`: incoming/outgoing relationとdepth制限付き部分graph。各relationはexact statement identityと個別commentを保持
- `statementComments`: revision aliasでexact S/P/Oを照合して個別commentを取得
- `memberships`: `rdfs:member`とsubproperty closure。`rdf:_n`系は`kind: "ordinal-membership"`で区別し、`includeOrdinals: false`で除外可能

## Safe write

Hostは`SemanticWritePort`を注入します。直接Coreを利用するhostでは`createCoreSemanticWritePort`を使えます。

```ts
import {
  SemanticAuthoringFacade,
  createCoreSemanticWritePort,
} from "@iriograph/semantic-access";

const writes = new SemanticAuthoringFacade(
  semantic,
  createCoreSemanticWritePort(async () => resolvedAuthoringContext),
);

const preview = await writes.preview({
  type: "connect-resources",
  operationId: "connect-1",
  revision: workspaceRevision,
  subject: { alias: "r12", revision: workspaceRevision },
  predicate: { alias: "p4", revision: workspaceRevision },
  object: { alias: "r19", revision: workspaceRevision },
});

const result = await writes.apply(preview, {
  revision: workspaceRevision,
  confirmationId: preview.corePreview.confirmationId,
});
```

`apply`は同じrevisionのpreviewと完全一致するconfirmation IDを必須にします。Aliasが古い場合は`StaleSemanticRevisionError`、未知の場合は`UnknownSemanticAliasError`を返します。最終的な検証、canonical Turtle生成、全view reconciliation、保存はCoreまたはCloud側WritePortの責務です。

詳細な契約は[Semantic Access](../../docs/integration/semantic-access.md)を参照してください。
