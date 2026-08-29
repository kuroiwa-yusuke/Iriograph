# Semantic authoring profile

[日本語版](../../docs_ja/semantics/authoring-profile.md)

## Purpose

A rendering catalog answers “how can this graph be displayed?” An authoring profile answers “what may this actor create or change?” The two are separate so unknown vocabulary remains readable without granting humans or agents permission to mint it.

## Resolved profile

The portable document references an immutable authoring profile. A host resolves it and its vocabulary imports through `@iriograph/profile-resolver`, checks identity, version, integrity, cycles, duplicates, and conflicts, and injects a `ResolvedAuthoringContext`.

A resolved context includes:

- profile identity and revision;
- default locale and allowed resource namespaces;
- opaque node-role and group-kind IDs;
- opaque predicate IDs with localized labels, descriptions, categories, examples, object kinds, datatypes/languages, and cardinality;
- projection capabilities relevant to authoring;
- actor policies for human structured editing, direct source editing, import, and LLM editing;
- optional semantic-validation context.

Retrieval, authentication, tenant isolation, and caching belong to host transport. An unresolved or stale context allows reading but disables controlled semantic writes.

## Vocabulary decisions

Terms are classified by exact expanded IRI and declared role, never namespace casing, local-name spelling, labels, or appearance.

An existing graph may contain profile-unknown terms and remain readable. A new candidate is checked by semantic diff:

- reuse of an allowed existing/imported term;
- introduction of a term already known to the profile;
- new use of an unknown predicate or class;
- definition/minting of a new semantic term;
- creation of a resource outside an allowed instance namespace.

Actor policy determines warning or error, but the LLM policy normally denies unknown-term introduction and term minting.

## Human structured authoring

Ordinary UI consumes only opaque option IDs and labels. It never constructs complete IRIs.

The standard editor offers four initial intents—create resource, create relation, edit resource, edit relation—and then presents one decision per step. Canvas selection may seed roles but does not commit semantics.

### Resource and group creation

A resource is created atomically with:

- a host-allocated opaque named IRI;
- a user-facing name;
- one profile-approved node role.

A business group is created atomically with name and a group kind such as unordered membership, ordered group, or alternative group. Type resources are created and maintained in the separate type catalog rather than disguised as regions. Ordinary nodes and groups are not converted into each other. Empty groups may change kind through a dedicated operation.

### Relations

Direct relation creation selects one source, one or more targets, and a common or row-specific predicate. The complete command set is atomic. Duplicate request rows or already asserted S/P/O statements reject the whole request.

Membership creation selects an existing group and one or more members. Bag/classification membership adds members. Seq/Alt editing supplies the final ordered list. An Alt default selection deterministically moves the selected occurrence to ordinal 1 while preserving relative order of the others. Repeated resource values retain occurrence identity.

Inline new members are ephemeral name/role drafts. All IRI allocation, type/name statements, and membership/order/default statements form one candidate. Any failure applies nothing.

### Types and localized text

Changing a resource role replaces only profile-managed classes and preserves outside-profile types. Group structural types cannot mix with ordinary node roles.

Names and descriptions use opaque value IDs and locale categories such as default, translation, untagged, and typed. Editing one value preserves other languages and datatypes. Ordinary UI does not expose raw language tags or datatype IRIs; exact editing remains available through source tabs.

A default locale is applied only to newly created structured values. It is never silently added to imported or existing untagged literals.

### Commit behavior

Structured requests compile to ordinary Core authoring commands and enter the same candidate, validation, all-view reconciliation, and deterministic serialization pipeline as controlled source edits. Non-deleting human actions use inline errors rather than a separate Preview/Apply modal. Deletion confirmation remains tied to unselected impact.

Optional capability parameters skip the complete template statement that references an omitted optional binding. Missing values are never guessed or replaced with empty strings.

## LLM context

For a small full-graph edit, an LLM may receive:

1. current semantic Turtle;
2. allowed classes and predicates with labels, descriptions, and hierarchy;
3. available structures and constraints;
4. relevant projection-capability summaries;
5. document revision and prohibited operations.

It never receives unrestricted portable JSON, overlay coordinates, routes, asset URLs, or full catalog implementation data.

For larger graphs, semantic access returns deterministic search results and related subgraphs containing localized labels/descriptions, types, property hierarchy, neighborhoods, membership, and revision-bound aliases. Aliases are resolved to exact IRIs before Core commands and expire on revision changes.

Term choice priority is:

1. an allowed term already used in the graph;
2. an allowed imported vocabulary term;
3. report a missing vocabulary rather than minting a new term.

Raw SPARQL Update is not the authoritative write API. MCP or Python tools wrap the same read/write contract and Core/host write port.

## Presentation requests and semantic rewrite

Requests are classified before execution:

| Request | Examples | Transaction |
|---|---|---|
| presentation only | position, size, route, color, icon | sparse overlay |
| semantic display structure | lanes, membership, order, alternatives | profile-guided semantic candidate |
| domain meaning | classify as a service task and use a matching icon | semantic candidate only when that class is genuinely intended |

“Make it look better” never justifies adding types, relations, membership, or order.

A projection-capability summary is derived from the resolved view profile and catalog. It describes an opaque capability ID, semantic pattern, display effect, and exact allowed authoring terms. It contains no coordinates, colors, or URLs and is not portable source data.

Semantic rewrite flow:

1. classify the request;
2. skip the semantic model for presentation-only requests;
3. provide only relevant capabilities and allowed terms;
4. parse the returned Turtle;
5. diff predicates, classes, namespaces, and structures;
6. apply authoring-profile, view-profile, and domain validation;
7. reproject and verify that the requested capability is actually satisfied;
8. apply according to policy and reconcile display.

Any failure preserves the previous document. Acceptance is based on the graph diff and validation, not the model's explanation.

## Diagnostics

Stable target codes include:

| Code | Meaning |
|---|---|
| `authoring-profile-unresolved` | controlled write cannot begin |
| `unknown-term-introduced` | candidate adds a term outside actor policy |
| `term-minting-denied` | actor attempts to define a new semantic term |
| `resource-namespace-denied` | instance IRI is outside allowed namespaces |
| `semantic-rewrite-not-required` | request should use a presentation transaction |
| `projection-capability-unsatisfied` | the rewritten graph does not project the requested structure |

## Non-goals

- treating rendering catalogs as authoring allowlists;
- letting an LLM edit templates, CSS, or asset URLs;
- rejecting existing documents merely because they contain unknown terms;
- modifying semantics only to improve appearance;
- asking a model to invent missing vocabulary during an edit.
