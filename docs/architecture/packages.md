# Packages and processing pipeline

[日本語版](../../docs_ja/architecture/packages.md)

## Package responsibilities

| Package | Owns | Does not own |
|---|---|---|
| `@iriograph/core` | portable model, Turtle parsing/deterministic serialization, catalog projection, validation, reconciliation, semantic/presentation transaction boundaries, default layout, layout adapters, asset policy | Vue, DOM, HTTP, workspace storage, high-end engine dependencies |
| `@iriograph/rdf-io` | Turtle/JSON-LD dataset import, merge diff/loss/collision reporting, explicit rebase, semantic-only export | diagram-format guessing, overlay conversion, persistence |
| `@iriograph/profile-resolver` | immutable authoring-profile and vocabulary resolution with identity, integrity, cycle, and conflict checks | network, tenant authentication, registry cache |
| `@iriograph/semantic-access` | label/comment/structure index, search, describe, neighborhood/subgraph reads, revision aliases, write-port compilation to Core | LLM provider, MCP transport, overlay, persistence, authentication |
| `@iriograph/layout-elk` | optional ELK Layered adapter, compound hierarchy, orthogonal routing, host engine/Worker injection | semantic interpretation, engine-specific document options |
| `@iriograph/profile-kit` | domain-profile manifest, validation, fixtures, conformance helpers, and optional vendor-catalog subpaths such as `./aws-icons` | Core branches, vendor artwork, implicit standards-compliance claims |
| `@iriograph/presentation-tools` | opaque Scene bridge, closed sparse patches, budgets, diff/render/score/telemetry contracts | application, Turtle, arbitrary CSS/URLs, image bytes |
| `@iriograph/host-conformance` | versioned package/CSS/fixture/capability manifest and report validation | product deployment execution |
| `@iriograph/agent-bridge` | semantic/presentation request routing and external candidate review contracts | model SDK, authentication, tenant policy |
| `@iriograph/vue-editor` | Vue components, canvas/inspector interactions, session navigation, semantic and presentation command orchestration | workspace persistence, HTTP, authentication, RDF policy resolution |

`apps/mock` is a reference host, not a published package. It demonstrates package integration, workspace trees, asset resolution, persistence, and browser conformance.

## Projection pipeline

A view is built through explicit stages:

1. Parse and validate the portable document.
2. Resolve the named view, projection profile, catalog set, and layout adapter.
3. Parse Turtle into an RDF dataset.
4. Apply normalized catalog rules to produce a projected Scene with provenance.
5. Measure text, icons, annotations, and group content.
6. Run deterministic layout only for generated placement while honoring user geometry.
7. Reconcile the previous sparse overlay by stable identity.
8. Validate containment, routes, assets, and final Scene invariants.
9. Render through the host/editor boundary.

Projection does not fetch network assets. Layout does not inspect business labels or IRIs. Rendering does not modify semantics.

## Catalog resolution

Catalogs have immutable identities and versions. Hosts resolve the standard catalog, selected domain profiles, and optional vendor catalogs before projection. Rule conflicts are checked by declared priority and specificity. Missing or invalid required catalogs fail projection; unknown domain triples still receive the generic node/edge fallback when the profile permits them.

Catalog defaults are not copied into portable overlays. A catalog update changes generated appearance only where the user has not set an explicit sparse override.

## Asset resolution

Projection emits asset IRIs. The editor requests leases from a host-injected asset-access port. The port validates reference policy, MIME/signature, encoded and decoded size, origin, and lifecycle. Stale leases are released and never persisted.

Workspace paths are user-facing locators, not asset identity. A host workspace-locator maps normalized path suggestions to stable asset IRIs and rejects root escape, directories, ambiguity, and missing entries.

## Transaction pipeline

### Semantic

A semantic candidate from direct source, structured UI, import, or an agent goes through:

1. actor/profile policy and revision checks;
2. parse or structured-command compilation;
3. vocabulary and structural diff validation;
4. all-view projection and reconciliation;
5. optional injected domain validation;
6. atomic replacement of source, document, Scenes, and history.

Failure at any stage leaves the previous source of truth intact.

### Presentation

A presentation command targets an existing Scene identity and a closed field set. It validates geometry, containment, routing, style, template, and asset options before writing a sparse overlay. It never changes Turtle or runs global layout. One gesture is one history item.

### Deletion

Deletion compiles exact provenance-backed semantic patches. Confirmation is required only when unselected incident statements or structural members are affected. Seq/Alt ordinal repair occurs in the same atomic transaction.

## Semantic access

A `SemanticAccessIndex` is an immutable revision snapshot over Turtle. Search and describe APIs return labels, descriptions, types, neighborhoods, property hierarchy, and membership through revision-bound opaque aliases. A write port re-resolves aliases and compiles approved operations into Core authoring commands.

Semantic access never becomes a second RDF source of truth. Indexes and aliases are discarded on revision changes.

## Named views and session state

Named views persist profile, layout reference, locale, and sparse overlay. Active view, selection, viewport, grid, snap configuration, temporary hide/fold, hover, and work-area expansion are session state and do not affect dirty state or undo history.

## Performance boundary

Core owns deterministic phase metrics and graph fixtures. The Vue package owns DOM and interaction budgets. Product hosts own network, save, asset, and service budgets. Fixed budgets and fixtures are documented in [Layout, routing, and performance](../editor/layout.md); historical measurements belong in evaluation records.

## Reference Mock

The Mock provides:

- a workspace tree for `.iriograph` files and image assets;
- browser-local working copies;
- direct Turtle, view-overlay, and full-document source editing;
- resolved static profiles, catalogs, allocators, and assets;
- host-conformance attributes and fixtures;
- a real-browser target for pointer, keyboard, layout, save, and responsive tests.

It must not contain behavior that is absent from the published packages unless declared as a host extension.
