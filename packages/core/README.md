# @iriograph/core

[![license](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

Framework-independent ESM core for Iriograph portable documents, RDF/RDFS projection catalogs, semantic and presentation validation, deterministic Turtle serialization, reconciliation, asset-policy contracts, and adapter-based layout.

## Install

```sh
npm install --save-exact @iriograph/core
```

## Build a view

```ts
import {
  buildIriographView,
  createProjectionRuntimeContext,
  createStandardLayoutRegistry,
  standardRdfRdfsCatalog,
  validateIriographDocumentV1,
} from "@iriograph/core";

const runtimeContext = createProjectionRuntimeContext({
  catalogs: [standardRdfRdfsCatalog],
  layouts: createStandardLayoutRegistry(),
});

const validation = validateIriographDocumentV1(document);
if (!validation.valid) throw new Error("Invalid Iriograph document");

const result = await buildIriographView(document, {
  viewId: document.views[0].viewId,
  runtimeContext,
});
```

## Transaction boundaries

Semantic changes use preview/prepare/apply APIs and validate the complete candidate across every named view. Structured human commands and LLM source use deterministic dataset serialization; a valid direct human Turtle commit preserves its input bytes.

Presentation changes use `applyViewCommand` and a closed sparse overlay. Geometry, routing, templates, icons, and safe style overrides never modify Turtle or trigger global layout.

Key APIs include:

- `previewAuthoringCommands` / `applyAuthoringPreview`
- `previewStructuredAuthoringRequest`
- `applyAuthoringSource`
- `previewPortableDocumentReplace` / `applyPortableDocumentReplace`
- `previewDocumentRebase` / `applyDocumentRebasePreview`
- `applyViewCommand`
- `buildIriographView`
- `validateIriographDocumentV1`

Every preview is revision- and context-bound. A stale or modified candidate fails closed.

## Authoring context

Ordinary authoring uses a host-resolved `ResolvedAuthoringContext`. UI selects resources by `viewId + elementId`, node roles by opaque `roleId`, and predicates by opaque `predicateId`. Core resolves them back to exact IRIs through Scene provenance and profile metadata.

Creation, multi-target direct relations, membership, final Seq/Alt order, inline new members, type changes, localized text, statement comments, and deletion compile to atomic authoring command sets.

Statement-specific comments use standard RDF reification through `set-statement-comments`; they remain distinct from predicate descriptions and view captions.

## Layout and groups

Core includes a deterministic lightweight layout and an asynchronous adapter registry. Automatic layout moves generated placement only and preserves user geometry.

Bag, classification region, Seq, and Alt project through common group-frame contracts. Sequence badges and alternative guides are display-derived data with exact ordinal provenance; they are not asserted predicate edges.

Automatic edge routing prefers a safe straight route, one-bend orthogonal route, then a bounded cubic Bezier. Derived choices remain transient until a user explicitly edits routing.

## Assets and icons

`packageDefaultIcons` exposes a compact catalog of bundled Lucide SVGs with stable refs such as `urn:iriograph:icon:lucide:<name>:1`. The same SVGs are exported through `@iriograph/core/icons/<name>.svg`; provenance is in `@iriograph/core/THIRD_PARTY_NOTICES.md`.

`withPackageDefaultIconAccess(assetAccess)` resolves bundled refs without weakening host policy for workspace or external assets. Asset leases are checked for MIME/signature, encoded size, decoded dimensions/pixels, concurrency, abort, and release. Resolved URLs and bytes never enter portable documents.

## Validation

Hosts may inject an engine-independent `ResolvedSemanticValidationContext`. Direct Turtle, structured datasets, and LLM source use the same port, stable diagnostics, warning binding, abort behavior, and cache identity.

## Documentation

- [Architecture principles](../../docs/architecture/principles.md)
- [Public contracts](../../docs/architecture/public-contracts.md)
- [RDF profile](../../docs/semantics/rdf-profile.md)
- [Semantic validation](../../docs/semantics/validation.md)
- [日本語 README](./README_ja.md)

## License

MIT. Third-party components retain the licenses listed in `THIRD_PARTY_NOTICES.md`.
