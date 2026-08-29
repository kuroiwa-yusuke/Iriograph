# Semantic Access

[日本語版](../../docs_ja/integration/semantic-access.md)

## Purpose and boundary

`@iriograph/semantic-access` provides a framework-independent, label-first read index and controlled write facade over an Iriograph document. Turtle remains the only semantic source of truth.

The package does not own an LLM provider, MCP/HTTP transport, authentication, persistence, tenant policy, overlay, assets, or raw SPARQL Update. A host injects those boundaries and current revision.

## Immutable index snapshot

An index is built from an exact document and workspace revision. It parses Turtle once, normalizes labels and comments, records statement identity, and derives:

- resources, types, and localized text;
- predicate metadata and limited class/property hierarchy;
- incoming and outgoing neighbors;
- Bag membership, Seq order, Alt membership/default;
- exact statement provenance;
- revision-bound opaque aliases.

The snapshot is immutable. A changed source or revision creates a new index and invalidates every alias and prepared write.

## Labels, descriptions, and search

Search is label-first and locale-aware. It considers primary and alternate labels, descriptions, type labels, predicate labels, and nearby resource context. Labels aid discovery but are never identity.

Results contain opaque aliases, labels, descriptions, type summaries, and disambiguating neighborhoods. Ordinary DTOs do not expose raw IRIs. Equal labels remain distinct through opaque identity and context.

The standard predicate vocabulary supplies localized picker metadata for selected RDF/RDFS, Dublin Core Terms, PROV-O, and SKOS relations without creating Japanese custom predicates. Hosts include only profile-relevant categories.

## Aliases

An alias is short transport identity bound to:

- document ID and revision;
- index fingerprint;
- exact resource, predicate, or statement IRI/identity;
- optional request/session scope.

It cannot be persisted as semantic identity or reused after a revision. A write port resolves it back to exact RDF terms and rechecks policy before compiling Core commands.

## Read API

Typical operations include:

- search resources or predicates;
- describe a resource or predicate;
- list incoming/outgoing relations;
- list containing groups and contained members;
- retrieve a depth- and size-bounded related subgraph;
- inspect direct and inherited class/property hierarchy;
- normalize Bag, Seq, Alt, and subproperty membership structures.

### Hierarchy

Limited RDFS closure is explicit per operation. Query may opt into `rdfs:subClassOf` or `rdfs:subPropertyOf`; validation and asserted-edge counts remain exact unless their own policy says otherwise. Cycles and ambiguity produce diagnostics rather than arbitrary order.

### Membership

Membership reads preserve exact predicates and ordinal occurrence identity. A subproperty of `rdfs:member` normalizes to a generic membership role while retaining source predicate. Seq/Alt ordinals are structure, not relation-picker edges.

## Structured writes

A host-injected write port accepts closed operations with aliases and opaque profile options. It:

1. reloads the server-side current revision and resolved authoring context;
2. resolves aliases and options;
3. checks actor, permissions, namespace, vocabulary, and budget;
4. compiles Core authoring commands;
5. previews and validates the complete candidate across all views;
6. saves atomically and returns the new revision.

Operations cover resources, localized values, properties, direct relations, reconnection, membership, order, alternatives, types, and deletion. Arbitrary Turtle may use the controlled source API, but raw SPARQL Update is not exposed as an authoritative write port.

## LLM and MCP integration

An LLM may begin with search and neighborhood tools rather than the full Turtle document. The tool boundary returns only the relevant indexed graph, allowed vocabulary, constraints, and revision-bound aliases. Application always goes through the same Core/host write port.

A Python MCP service is a valid transport and may use existing RDF libraries internally. It must not maintain an independent write database or bypass profile, revision, permission, or all-view validation. Overlay bytes and asset bytes remain outside semantic tools.
