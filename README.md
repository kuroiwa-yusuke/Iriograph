# Iriograph

[![npm](https://img.shields.io/npm/v/@iriograph/core.svg)](https://www.npmjs.com/package/@iriograph/core)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

[日本語](./README_ja.md)

Iriograph is a family of packages for editing, validating, and reusing semantic graphs as diagrams. Turtle remains the semantic source of truth. RDF/RDFS-based catalog rules project the graph into editable business flows and relationship diagrams, while a sparse display overlay stores only geometry, color, routing, icons, and other presentation choices that cannot be regenerated safely.

The package boundary is designed for WYSIWYG editing, deterministic validation, reusable domain profiles, and label-first access for humans and LLM tools without mixing presentation data into RDF.

## Embed the Vue editor

Pin Iriograph packages to an exact lockstep version.

```sh
npm install --save-exact @iriograph/core @iriograph/vue-editor
```

```vue
<script setup lang="ts">
import { ref } from "vue";
import type { IriographDocument, ProjectionRuntimeContext } from "@iriograph/core";
import { IriographEditor } from "@iriograph/vue-editor";
import "@iriograph/vue-editor/styles.css";

const props = defineProps<{
  initialDocument: IriographDocument;
  projectionRuntimeContext: ProjectionRuntimeContext;
}>();
const document = ref(props.initialDocument);
const uiLocale = ref<"en" | "ja">("en");
</script>

<template>
  <IriographEditor
    v-model="document"
    v-model:ui-locale="uiLocale"
    :runtime-context="projectionRuntimeContext"
  />
</template>
```

The editor does not own workspace storage, HTTP, authentication, or persistence. A product host injects the document, authenticated asset resolvers, IRI allocators, resolved authoring profiles, save operations, and revision-conflict handling.

The package UI defaults to English and includes Japanese. UI language is host/session state and never modifies Turtle, named views, or display overlays. Hosts can independently provide semantic-language preferences that transiently select existing RDF labels and comments in both the Canvas and editor metadata.

## Packages

| Purpose | Package |
|---|---|
| Portable document, projection, validation, standard layout | `@iriograph/core` |
| Vue 3 WYSIWYG editor | `@iriograph/vue-editor` |
| Turtle and JSON-LD import/export | `@iriograph/rdf-io` |
| Label-first search and safe semantic writes | `@iriograph/semantic-access` |
| Immutable authoring-profile resolution | `@iriograph/profile-resolver` |
| Domain-profile authoring, conformance, and optional vendor catalogs | `@iriograph/profile-kit` |
| Optional ELK layered layout | `@iriograph/layout-elk` |
| Closed presentation-candidate tooling | `@iriograph/presentation-tools` |
| Semantic/presentation agent bridge | `@iriograph/agent-bridge` |
| Shared Mock/product-host conformance gate | `@iriograph/host-conformance` |

All ten packages use the same lockstep version. See [Package distribution and versioning](./docs/integration/distribution.md) for public contracts and release rules.

## Local Mock

With Node.js 22 or later:

```sh
npm install
npm run dev
```

With Docker, open `http://localhost:5173` after startup:

```sh
docker compose up -d --build
```

The Mock displays `.iriograph` documents and image assets from `apps/mock/public/workspace`, and keeps browser-path-specific working copies. Run `npm run verify` for the full repository gate and `npm run verify:e2e` after editor or transaction changes.

## Documentation

- [Documentation map](./docs/README.md)
- [Architecture principles](./docs/architecture/principles.md)
- [Public contracts](./docs/architecture/public-contracts.md)
- [RDF profile](./docs/semantics/rdf-profile.md)
- [Editor interactions](./docs/editor/interactions.md)
- [Active backlog](./docs/backlog.md)
- [Japanese documentation](./docs_ja/README.md)

## License

Iriograph is distributed under the [MIT License](./LICENSE). Dependencies, bundled icons, and vendor catalogs remain subject to their own licenses and terms. Package-specific third-party boundaries are documented in `THIRD_PARTY_NOTICES.md` or `NOTICE.md` files.

The ten public packages are published under the npm [`@iriograph`](https://www.npmjs.com/org/iriograph) organization.
