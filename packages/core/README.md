# @iriograph/core

Iriographのportable document、RDF/RDFS projection catalog、runtime validation、
semantic transaction、決定的layoutを提供するframework非依存のESM packageです。

```sh
npm install @iriograph/core
```

```ts
import {
  buildIriographView,
  applyAuthoringSource,
  createProjectionRuntimeContext,
  createStandardLayoutRegistry,
  previewAuthoringCommands,
  applyAuthoringPreview,
  applyViewCommand,
  standardRdfRdfsCatalog,
  validateIriographDocumentV1,
} from "@iriograph/core";

const validation = validateIriographDocumentV1(document);
if (!validation.valid) throw new Error(validation.issues[0]?.message);

const context = createProjectionRuntimeContext([{
  profileRef: standardRdfRdfsCatalog.profileRef,
  sourceCatalogRefs: ["urn:iriograph:catalog:rdf-rdfs@1"],
  catalog: standardRdfRdfsCatalog,
  ruleOrigins: [],
}], createStandardLayoutRegistry());

const scene = await buildIriographView(
  validation.value,
  validation.value.views[0]!.viewId,
  context,
);

const viewUpdate = await applyViewCommand(validation.value, {
  command: "duplicate",
  sourceViewId: "main",
  viewId: "review",
}, context);
if (!viewUpdate.accepted) throw new Error(viewUpdate.diagnostics[0]?.message);

const preview = await previewAuthoringCommands(
  validation.value,
  [{
    type: "connect-resources",
    commandId: "connect-reviewer",
    subjectIri: "urn:example:request",
    predicateIri: "http://www.w3.org/2000/01/rdf-schema#seeAlso",
    objectIri: "urn:example:policy",
  }],
  resolvedAuthoringContext,
);
if (preview.valid) {
  const update = await applyAuthoringPreview(
    validation.value,
    preview,
    resolvedAuthoringContext,
    { confirmationId: preview.confirmationId },
  );
  if (!update.accepted) throw new Error(update.diagnostics[0]?.message);
}
```

Structured authoringは必ずpreviewと明示confirmationを経由します。Apply時にはcommand、
document/context revision、exact graph patchを再計算し、staleまたは改変されたpreviewを拒否します。

直接Turtleをcontrolled writeとして適用する場合はactorを必須指定します。

```ts
const humanUpdate = await applyAuthoringSource(
  validation.value,
  editedTurtle,
  resolvedAuthoringContext,
  { actor: "human" },
);
const llmUpdate = await applyAuthoringSource(
  validation.value,
  llmEditedTurtle,
  resolvedAuthoringContext,
  { actor: "llm" },
);
```

Human textarea入力は妥当な原文を保持し、LLM sourceとstructured commandはversioned serializerで決定的に再生成します。どちらも同じ語彙・namespace・構造・全view検証を通り、不明actorは拒否されます。

Domain constraintは`ResolvedSemanticValidationContext`の非同期portとして注入できます。
Direct Turtle、structured dataset、LLM sourceは同じportを通り、engine固有のStoreやSHACL型を
public contractへ公開しません。Warningの明示確認、stable diagnostic identity、abort、cache keyの
契約はrepositoryの`docs/semantic-validation.md`を参照してください。

保存documentの`schemaVersion`とcatalogのversionはpackage versionとは独立した契約です。
詳細はrepositoryの設計文書を参照してください。
