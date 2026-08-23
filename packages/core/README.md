# @iriograph/core

Iriographのportable document、RDF/RDFS projection catalog、runtime validation、
semantic transaction、決定的layoutを提供するframework非依存のESM packageです。

```sh
npm install @iriograph/core
```

```ts
import {
  buildIriographView,
  createProjectionRuntimeContext,
  createStandardLayoutRegistry,
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
```

保存documentの`schemaVersion`とcatalogのversionはpackage versionとは独立した契約です。
詳細はrepositoryの設計文書を参照してください。
