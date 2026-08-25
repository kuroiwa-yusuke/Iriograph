<script setup lang="ts">
import { ref } from "vue";

import {
  standardRdfRdfsCatalog,
  type IriographDocumentV1,
  type ProjectionCatalogV1,
} from "@iriograph/core";
import {
  ELK_LAYOUT_REFS,
  ElkLayeredLayoutAdapter,
} from "@iriograph/layout-elk";
import { SemanticAccessIndex } from "@iriograph/semantic-access";
import {
  IriographEditor,
  type EditorAssetOption,
} from "@iriograph/vue-editor";
import cloudIconUrl from "@iriograph/core/icons/cloud.svg";

const catalog: ProjectionCatalogV1 = standardRdfRdfsCatalog;
const elkLayoutAdapter = new ElkLayeredLayoutAdapter(ELK_LAYOUT_REFS.layeredLr, "LR");
if (elkLayoutAdapter.layoutRef !== ELK_LAYOUT_REFS.layeredLr) {
  throw new Error("packed ELK layout adapter contract is invalid");
}
const document = ref<IriographDocumentV1>({
  schemaVersion: "1",
  kind: "iriograph.document",
  documentId: "packed-consumer",
  semantic: {
    format: "text/turtle",
    baseIri: "urn:example:packed-consumer:",
    authoringProfileRef: "urn:example:authoring-profile:packed-consumer@1",
    source: [
      "@prefix : <urn:example:packed-consumer:> .",
      "@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .",
      ':task rdfs:label "Packed package"@en .',
    ].join("\n"),
  },
  imports: [{ catalogRef: "urn:iriograph:catalog:rdf-rdfs@1" }],
  views: [{
    viewId: "main",
    kind: "node-link",
    profileRef: standardRdfRdfsCatalog.profileRef,
    layoutRef: "urn:iriograph:layout:hierarchical-lr:1",
    locale: "en",
    overlay: {},
  }],
});
const semanticIndex = new SemanticAccessIndex(document.value, "packed-consumer-revision", {
  locales: ["en"],
});
const assetOptions: readonly EditorAssetOption[] = [{
  assetRef: "urn:example:packed-consumer:asset:cloud",
  label: "Cloud",
  path: "/assets/cloud.svg",
  mediaType: "image/svg+xml",
}];
if (!cloudIconUrl.endsWith(".svg")) {
  throw new Error("packed core icon export contract is invalid");
}
if (semanticIndex.searchResources("Packed").length !== 1) {
  throw new Error("packed semantic access contract is invalid");
}
</script>

<template>
  <main>
    <IriographEditor v-model="document" :catalog="catalog" :asset-options="assetOptions" title="Packed consumer" />
  </main>
</template>

<style>
html,
body,
#app,
main {
  width: 100%;
  height: 100%;
  margin: 0;
}
</style>
