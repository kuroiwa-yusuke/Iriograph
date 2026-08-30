# Architecture principles

[日本語版](../../docs_ja/architecture/principles.md)

## Purpose

Iriograph exists to edit, validate, and reuse semantic graphs as diagrams. Turtle is the semantic source of truth for RDF tooling and LLM access. A sparse display overlay is the source of truth for intentional WYSIWYG presentation adjustments.

A diagram is not limited to a literal node-edge rendering. Catalog rules map semantic vocabulary to a small set of spatial primitives such as nodes, edges, containers, regions, groups, and annotations. The same projection mechanism can therefore support ordinary relationship diagrams, BPMN-like lanes and flows, containment, order and alternative groups, and icon-rich views.

## Turtle and display overlay

A portable JSON document contains both the Turtle string and named-view data. Keeping them in one envelope preserves a single distribution and revision unit; keeping them in separate fields preserves transaction boundaries.

The overlay stores only presentation information that cannot be regenerated safely or that a user deliberately fixed:

- geometry and placement provenance;
- pinning and manual routes;
- explicit template, icon, and safe style overrides;
- label, caption, and endpoint-anchor adjustments.

Catalog defaults remain in the catalog. Arbitrary CSS and executable style strings are never portable data.

Domain resource identity and domain vocabulary are also separate concerns. `rdf:type` records classifications needed by validation, query, reasoning, reuse, or agents. It is not a visual-template selector. View-only task, event, gateway, color, or shape choices belong in a named view unless they carry domain meaning.

## Rich semantic editing

Creating a resource, property, edge, membership, order, or alternative through the rich editor is a semantic-graph operation, not a temporary drawing operation. The editor builds a candidate graph delta and commits it only after semantic validation. A portable document never contains an untyped visual ghost waiting for semantics.

- Resource creation uses a host allocator for an opaque named IRI and atomically writes a user-facing name plus a profile-approved node role.
- Group creation atomically writes its name and selected business group kind. Type creation remains in the separate type catalog.
- Property editing adds, replaces, or removes predicate/value triples.
- Direct-edge creation requires an exact profile/catalog predicate; no generic `:relation` is minted implicitly.
- Membership, order, and alternatives use a capability-defined graph patch such as `rdf:Bag`, `rdf:Seq`, or `rdf:Alt`.
- Plain visual drag into a region never implies semantic membership.

Ordinary UI is label-first and selection-first. Users do not need to know Turtle, RDF terms, or complete IRIs. Presentation DTOs and DOM expose opaque option IDs, labels, and descriptions. Exact IRIs remain in editable source, internal transactions, and audit identity.

Non-deleting human actions validate and commit within one user action. Confirmation is reserved for deletion that affects unselected incident statements or structural memberships. Seq/Alt deletion and ordinal repair are one atomic patch.

Resource creation and user placement are distinct. Successful creation receives generated geometry; later drag is a presentation transaction. A failed creation leaves no portable ghost or position.

## Reconciliation and layout

After a semantic transaction, every named view is reprojected with its own profile, catalog, and layout. Compatible user overlays survive by stable identity. New identities receive deterministic generated geometry; removed identities lose their overlays. Regenerable templates, styles, and icons are not copied into the overlay.

Automatic layout moves only elements with `placement: "generated"`. User placement is a hard constraint while that identity survives. Overlay-only edits never trigger global layout; they update the edited geometry and derived routes of incident edges.

Inline view controls commit directly as one presentation transaction. Continuous input may use a session preview, but one completed gesture becomes one history entry. Grid, work-area expansion, viewport, hover, and temporary visibility are session state.

## Turtle serialization

A valid source entered through direct Turtle editing is retained byte-for-byte at that commit. Structured commands and LLM edits operate on an RDF dataset and then use one deterministic serializer.

The serializer deduplicates and sorts expanded tuples, chooses stable blank-node labels, preserves valid used prefixes where possible, prefers standard RDF/RDFS/XSD abbreviations, and emits full IRIs only when compaction is invalid. Identical parsed input, prefix/base context, serializer version, and blank-node identity produce identical output.

Whitespace, comments, property-list grouping, and statement order are not RDF semantics and are not guaranteed after a structured reserialization. Reviews therefore use semantic diffs in addition to source diffs.

## Projection, layout, and renderer

Projection creates spatial primitives and edit provenance from the semantic graph. Layout assigns geometry and routes. Rendering maps the Scene to DOM/SVG. These responsibilities do not depend on each other’s implementation details.

Core defines an asynchronous layout-adapter contract and a deterministic lightweight default. Hosts may select an optional adapter such as ELK through `layoutRef` without putting engine-specific options into the portable document. Layout adapters do not know business IRIs, and renderers do not implement layout algorithms.

## Named views and spatial grammars

One semantic graph can have multiple named views, each with its own profile, layout, locale, and overlay. New documents default to one region-capable view that can show ordinary edges and overlapping memberships together. Node-link hierarchy remains supported for explicit views and legacy documents.

Version 1 has no embedded SPARQL or arbitrary filter editor. Temporary hide/fold behavior is editor session state.

Membership can be many-to-many. A single-parent hierarchy and an overlapping-region projection are different spatial grammars over the same semantics. Geometry never creates membership. A visual/semantic mismatch produces a warning and explicit repair action.

## Extensibility

Do not add renderer branches such as “if predicate equals X.” Domain classes, predicates, relation resources, containment, templates, icons, and projection bindings belong in versioned catalogs or domain profiles. Unknown IRI-object triples remain readable as ordinary arrows.

A new business domain does not justify a new Scene primitive. Add a primitive only for a genuinely new spatial grammar.

The base profile reuses standard RDF/RDFS structures where natural:

- `rdf:Bag` and `rdfs:member` for unordered membership;
- `rdf:Seq` and `rdf:_n` for order;
- `rdf:Alt` for alternative members;
- `rdfs:seeAlso` and `rdfs:isDefinedBy` for common references.

Iriograph adds deterministic application-profile constraints without redefining RDF semantics. Domain terms live in the domain namespace, not an Iriograph catch-all namespace. Labels never drive classification or projection rules.

## Language boundaries

Interface language, semantic literal preference, and portable view locale are related but distinct. The editor defaults to English and offers Japanese as a host/session preference. Semantic language preference only selects among existing localized labels and comments. A named view may persist its own locale when reproducible label choice is part of that view. None of these choices translates or rewrites semantic source, and changing only the interface language never creates a document revision.

Stable identifiers own behavior; localized text explains it. The same predicate IRI, command, diagnostic code, and projection rule therefore survive every interface language. English is the canonical package fallback, while all user-authored RDF lexical forms remain first-class data rather than UI messages.

## Assets

An icon is identified by an IRI, not by its retrieval URL. A catalog or host-injected resolver maps the IRI to a temporary local or network source under scheme, origin, media-type, size, and lifetime policy. Credentials and expiring URLs never enter portable documents.

## LLM boundary

Agents may receive semantic Turtle or an indexed relevant subgraph, allowed vocabulary, and relevant projection capabilities. They do not receive a portable document as arbitrary JSON and do not edit overlays.

The semantic-access layer indexes labels, descriptions, types, property hierarchy, neighborhoods, membership, and related subgraphs. Revision-bound short aliases improve tool efficiency but are resolved back to exact IRIs before Core transactions.

Renderer fallback for unknown terms is not permission for an LLM to mint them. LLM writes are constrained by a resolved authoring profile, parsed, diffed, structurally validated, and applied atomically. Presentation-only requests remain presentation transactions. A request for lanes, order, alternatives, or domain typing may become a profile-guided semantic rewrite only when the capability has explicit meaning.

## Stability criteria

- Stable identity is based on IRIs and statement identity, never labels, array indices, or source lines.
- Labels and comments are the primary discovery language for humans and agents.
- Semantic and presentation transactions remain separate.
- Catalog conflicts are resolved by explicit priority and specificity, never registration order.
- Equal input, catalog version, and layout version produce equal Scenes.
- Standard vocabulary is preferred for common structures without forcing it onto arbitrary domain edges.
- Host storage, permissions, networking, and asset retrieval remain outside Core.
- Schema changes require explicit versions and migration tests.
