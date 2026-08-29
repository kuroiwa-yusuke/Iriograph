# Public contracts

[日本語版](../../docs_ja/architecture/public-contracts.md)

TypeScript declarations, exported runtime schemas, and conformance fixtures are the executable source of truth. This document records the stable boundaries and invariants that consumers must preserve.

## Portable document

A version-1 document is a JSON envelope with:

- `schemaVersion`;
- stable `documentId` and `documentRevision`;
- semantic Turtle source and optional base/profile references;
- one or more named views;
- no credentials, signed URLs, asset bytes, or host workspace state.

Each named view has a stable ID, label, projection profile reference, layout reference, locale preferences, and sparse overlay. View IDs and Scene IDs are stable identities rather than array positions.

Semantic source and view overlays have independent transaction boundaries. A semantic commit may reconcile all views, but an overlay-only command never changes Turtle.

## Document identity, locators, and rebase

`documentId` is opaque host identity. The RDF base IRI is semantic identity. A workspace path is only a locator. Renaming or moving a file does not rewrite either identity.

“Duplicate as new” uses a host-injected `DocumentIdentityAllocator` to produce a new document ID and absolute base IRI. The allocation is bound to request ID and source revision. Core previews a parsed-term rebase of local named IRIs, statement identities, semantic references, and overlay keys. It rejects unchanged bases and many-to-one collisions, validates every view, and returns a handoff without mutating the source document.

Clipboard copy preserves identity and does not invoke rebase.

## Catalogs

A normalized catalog contains immutable ID/version, rules, templates, styles, icon metadata, optional capabilities, and license/provenance metadata. Rules match RDF structure through a closed operator vocabulary. Registration order is not semantic.

Catalog resolution:

- validates rule IDs, priority, specificity, outputs, templates, and assets;
- rejects ambiguous equal-precedence matches;
- keeps unknown IRI-object triples readable through generic fallback;
- does not infer structure from labels;
- does not grant authoring permission merely because rendering has a fallback.

Legacy catalog shapes are normalized at the boundary. New code consumes the normalized contract.

## Scene

A projected Scene is immutable input to layout and rendering. Elements use stable IDs and a small spatial vocabulary:

- node;
- direct edge;
- container/frame or overlap region;
- sequence/alternative/group guide;
- annotation.

Each element carries semantic and statement provenance sufficient to compile exact edits. Labels and descriptions are presentation metadata, not identity.

A Scene includes deterministic ordering, content bounds, diagnostics, and adapter-neutral layout requests. Renderer-only DOM state is not part of the Scene.

## Layout adapter

A layout adapter is asynchronous and selected by stable `layoutRef`. It receives an adapter-neutral Scene, measured sizes, generated/user placement provenance, group constraints, route constraints, direction, quality policy, and abort signal. It returns geometry and routes plus diagnostics and phase metrics.

Adapters must:

- preserve user placement as constraints;
- preserve all group memberships and nested containment;
- avoid non-finite coordinates;
- remain deterministic for equal input and version;
- reject stale completion through request/revision binding;
- avoid putting engine-specific options into the portable document.

The default adapter is lightweight and deterministic. `@iriograph/layout-elk` is optional.

## Asset access

Portable documents and catalogs refer to assets by stable IRI. A host injects:

- an asset-access resolver that returns a time-bounded lease;
- policy for schemes, origins, MIME/signature, encoded bytes, decoded pixels, and cancellation;
- optional workspace-locator metadata for path completion;
- an optional picker that returns only an asset IRI.

The editor never saves a resolved URL or byte payload. A canceled, stale, invalid, or rejected result leaves the document unchanged.

## Annotation and ports

Projection may produce annotations from semantic literals or validated view metadata. An annotation has provenance and a closed role such as a comment/note; it is not arbitrary HTML.

Node ports are role-based and template-aware. Semantic endpoint identity and visual anchor identity are separate. Presentation anchor edits change only normalized perimeter positions. Semantic reconnection changes subject or object through one provenance-backed semantic transaction and never saves a disconnected edge.

## Semantic transactions

Core exposes preview/prepare/apply boundaries for source replacement, structured commands, rebase, import handoffs, and deletion. Every preview is bound to:

- source document and revision;
- actor and resolved authoring context;
- exact candidate source or command set;
- projection runtime and all named views;
- optional semantic-validation context.

Application rechecks those bindings. Stale previews, changed contexts, unknown terms, invalid roles, namespace collisions, structural failures, domain errors, or view failures do not mutate the document.

Warnings use exact confirmation tokens bound to context revision, source fingerprint, and diagnostic IDs. The standard editor uses inline guidance for ordinary non-deleting human actions rather than a second modal apply step.

## Human semantic commands

The structured authoring contract uses opaque option IDs resolved from a `ResolvedAuthoringContext`. Commands cover:

- create resource or business group;
- add, replace, or remove literal/IRI properties;
- create, remove, or reconnect direct relations;
- add or remove membership;
- create and edit order/alternative structures;
- assign or remove direct types;
- edit localized names and descriptions;
- delete resources or statements with explicit cascade scope.

The editor does not ask ordinary users to enter IRIs. Host allocators issue opaque named IRIs within allowed namespaces. A command that creates a resource also creates at least one semantic statement in the same transaction.

Literal properties may have no independent Scene element but remain editable and lossless in Turtle.

## Presentation transactions

Presentation commands operate on a closed sparse overlay. Supported responsibilities include geometry, size, placement provenance, route mode, manual knots/waypoints, endpoint anchors, label/caption offsets, template/icon choices, safe colors, opacity, line width, z-order within structural layers, and annotation visibility.

They cannot represent Turtle, semantic writes, arbitrary CSS, executable content, arbitrary network URLs, credentials, or asset bytes.

Pointer previews are session-only. Commit occurs once per gesture. Undo/redo is independent from semantic source history but operates on the same portable-document revision stream.

## Vue editor

A product host embeds `IriographEditor` and supplies the portable document plus runtime services. Principal contracts include:

- `modelValue` / `update:modelValue`: portable document;
- `runtimeContext`: resolved catalogs, projection options, and layout registry;
- controlled or uncontrolled `activeViewId`;
- `authoringContext`: resolved vocabulary, roles, capabilities, namespaces, and actor policy;
- optional `semanticValidationContext`;
- `resourceIriAllocator` and `documentIdentityAllocator`;
- `assetAccess`, `assetOptions`, `workspaceLocator`, and `pickAsset`;
- `save`, `validationChanged`, `duplicatedAsNew`, and selection/pending-draft events.

Before emitting `save`, the editor flushes valid pending Turtle, overlay, and full-document drafts. It does not auto-apply incomplete structured forms. The host saves the current model and must not re-enter `flushPendingEdits()` from the save handler.

Public imperative navigation includes pan, zoom, fit, reveal, focus, selection, and snap settings. These APIs affect only session state unless they invoke an explicit geometry command.

### Canvas input

The canvas maintains a single keyboard tab stop and uses `aria-activedescendant`. Selection supports click replacement, modifier toggles, marquee selection, select all, blank-canvas/Escape clear, and batch movement.

Primary blank drag follows the current pan/marquee mode. Primary drag inside an already selected group frame moves that frame and its selected geometry rather than starting a pan. Middle drag always pans.

Arrow keys move selected geometry by one unit and Shift+Arrow by ten. Without movable selection, navigation keys pan or move focus. Processed keys do not scroll the host page. Inputs, contenteditable elements, and IME composition suppress canvas shortcuts.

Work area grows monotonically during drag/resize without requiring intermediate drops. Work-area geometry and scroll compensation are session-only.

### Geometry and groups

Selected resizable elements show eight transient handles. Handles, waypoints, and endpoint halos may render above semantic objects for hit testing, while persistent structural z-order remains group frames below edges below nodes.

Every geometry entry point—pointer, keyboard, inspector, align, distribute, and resize—uses the same group-intersection and nested-containment validation. A multi-membership element remains inside the intersection of all groups. Resizing a group cannot exclude its semantic members.

### Grid and snap

Grid and snap share one default interval of eight canvas units. Target guides win over grid snap and are resolved deterministically by distance, coordinate, and element ID. Alt temporarily disables snap. Grid line density adapts visually at low zoom without changing semantic snap intervals. Grid and snap are session state.

### Edge routing

Route modes are `auto`, `straight`, `orthogonal`, and `curve`.

- `straight` and `curve` do not retain polyline waypoints.
- Automatic routing prefers a safe straight route, then one right-angle orthogonal bend, then a bounded Bezier.
- Manual orthogonal editing exposes at most the intended user control points.
- Curve editing exposes on-curve knots and mirrored tangent handles; the visible path is one cubic path rather than an overlaid straight/polyline route.
- Route, endpoint anchor, label, and caption gestures each commit one presentation history item.
- Content bounds include generated curve control hulls so fit and reveal do not clip curves.

A semantic endpoint drop onto another valid node emits a semantic reconnection request only in the semantic editing mode. Invalid or blank drops retain the original connection. View mode changes only the anchor.

### Responsive embedding

The editor has no fixed minimum width that forces its host wider. Sidebars collapse, the canvas uses `min-width: 0`, and the host supplies a finite block size. Narrow layouts may scroll internally. Read-only mode disables semantic/presentation mutation but preserves navigation, selection, zoom, fit, and reveal.

## LLM and external adapters

Agents receive semantic Turtle or indexed subgraphs, an allowed vocabulary guide, and relevant projection capabilities. They do not receive unrestricted portable-document JSON or overlay bytes.

Returned semantic candidates use actor `llm` and the same semantic transaction pipeline. Presentation candidates use the closed sparse-patch contract and remain separate. Mixed requests produce separately reviewable candidates. Host authentication, tenant isolation, permission checks, rate/size/token budgets, model calls, current revision, and audit remain host responsibilities.
