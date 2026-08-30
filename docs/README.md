# Iriograph documentation

[日本語版](../docs_ja/README.md)

The documentation separates introductory architecture, normative semantics, editor behavior, host integration, and development evidence. Most readers can start with:

1. [Architecture principles](./architecture/principles.md) — problem statement and semantic/presentation/layout boundaries
2. [Packages and processing pipeline](./architecture/packages.md) — responsibilities of the ten packages
3. [RDF/RDFS profile](./semantics/rdf-profile.md) — semantic graph, standard vocabulary, and catalog bindings
4. [Editor interactions](./editor/interactions.md) — user-facing editing flows
5. [Host conformance](./integration/host-conformance.md) — parity gates for the Mock and product hosts

## Normative documents

### Architecture

- [Architecture principles](./architecture/principles.md)
- [Packages and processing pipeline](./architecture/packages.md)
- [Public contracts](./architecture/public-contracts.md)

### Semantics

- [RDF/RDFS profile](./semantics/rdf-profile.md)
- [Authoring profile](./semantics/authoring-profile.md)
- [Semantic and presentation notation](./semantics/notation.md)
- [Semantic validation](./semantics/validation.md)
- [RDF import and export](./semantics/rdf-io.md)

### Editor and layout

- [Editor interactions](./editor/interactions.md)
- [Named views](./editor/views.md)
- [Accessibility](./editor/accessibility.md)
- [Spatial membership](./editor/spatial-membership.md)
- [Layout, routing, and performance](./editor/layout.md)

### Integration and distribution

- [Semantic Access](./integration/semantic-access.md)
- [Agents and host integration](./integration/agents.md)
- [Domain profiles and vendor catalogs](./integration/domain-profiles.md)
- [Host conformance](./integration/host-conformance.md)
- [Package distribution and versioning](./integration/distribution.md)

## Development records

- [Development and verification](./development/testing.md) — current commands, gates, and test placement
- [Reference reconstruction evaluations](./evaluations/reference-reconstruction.md) — historical image and agent evaluations; not normative
- [Active backlog](./backlog.md) — unimplemented work only

`architecture/principles.md` is authoritative for design boundaries, `semantics/rdf-profile.md` for semantic structure, and `semantics/authoring-profile.md` for semantic-write policy. TypeScript types and runtime schemas are the executable source of truth for API shapes; `architecture/public-contracts.md` explains their invariants.
