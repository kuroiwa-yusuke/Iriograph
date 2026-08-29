# Agents and host integration

[日本語版](../../docs_ja/integration/agents.md)

This document defines the boundary for exposing Iriograph semantics to LLMs and external services and for reviewing their candidates safely. Core owns no network, tenant, authentication, or model SDK.

## Resolved authoring context

`@iriograph/profile-resolver` starts from `semantic.authoringProfileRef`, retrieves immutable profiles and vocabulary imports, and validates declared identity, version, integrity, cycles, duplicates, and role conflicts. The resulting `ResolvedAuthoringContext` contains opaque role and predicate IDs, locale-specific value IDs, group kinds, a default locale, and optional semantic-validation context. Retrieval and caching belong to host-injected transport, and the result is bound to profile revision and artifact fingerprints.

An unavailable, stale, or invalid manifest does not block reading an existing graph, but semantic writes fail closed. Drafts and options never cross context revisions.

## Request separation

`@iriograph/agent-bridge` classifies a natural-language request as semantic, presentation, or mixed. Classification is not authorization. The semantic and presentation ports independently recheck the current document revision, resolved context, and allowed fields.

- **semantic:** resources, predicates, membership, order, alternatives, names, and descriptions
- **presentation:** geometry, size, color, routing, templates, and icons
- **mixed:** two separate revision-bound candidates and reviews; never one indivisible transaction

Geometry such as visual containment or proximity does not imply membership or order. A presentation request cannot modify Turtle.

## Semantic transport

`SemanticJsonTransport` closes the label-first index/write facade from `@iriograph/semantic-access` behind a JSON boundary. Ordinary DTOs contain opaque aliases and option IDs, labels, comments, neighborhoods, and membership. They do not expose raw IRIs, full Turtle, overlays, asset bytes, or authenticated URLs.

For every request, the host:

1. authenticates the principal and checks tenant/organization, permissions, budgets, and abort signal;
2. reloads the server-side current document revision and resolved profile;
3. distrusts and re-resolves client aliases and candidates;
4. compiles to a Core authoring transaction and saves atomically after validation;
5. audits actor, revision, operation, and result.

MCP, HTTP, and Python RDF libraries may be clients or internal index implementations. They do not become an independent write source of truth.

## Closed presentation tool

`@iriograph/presentation-tools` maps a read-only Scene to opaque IDs through `PresentationSceneBridge` and exposes only compact targets and capability summaries. The bridge does not reveal source IRIs or resolved URLs; it maps an accepted patch back to source overlay IDs inside the host.

Candidates are sparse patches that cannot represent arbitrary CSS/URLs, semantic writes, Turtle, or asset/image bytes. Host policy limits fields, item count, coordinates, route points, request/response bytes, time, and tokens. Stale revisions, unregistered options, non-finite values, containment violations, and budget excess fail closed. Render ports return an opaque screenshot ID, while bytes stay in session storage.

## External candidate review

`ExternalCandidateReviewPanel` separates semantic and presentation diffs and binds each to document/context revision, exact patch, diagnostics, and optional candidate screenshot. A user may apply or reject either side independently. Ordinary canvas operations and non-deleting human structured edits do not use this extra review.

Applying a presentation candidate preserves Turtle bytes. Applying a semantic candidate reconciles all named views in a separate transaction. Rejection and validation failure do not mutate the source of truth.

## Registry transport

A product host may retrieve catalogs, vocabularies, profiles, and asset references from the same authenticated immutable-version/integrity/cache infrastructure without flattening their schemas. Cross-tenant access is rejected. Asset bytes and signed URLs never enter portable documents. Offline reads may use only an exact-fingerprint cache; writes never use stale context.
