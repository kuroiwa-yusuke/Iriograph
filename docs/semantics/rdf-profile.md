# RDF/RDFS base profile

[日本語版](../../docs_ja/semantics/rdf-profile.md)

This document is the normative Iriograph v1 profile for deriving a display Scene from Turtle. **MUST**, **MUST NOT**, **SHOULD**, and **MAY** are normative terms.

The full profile is `urn:iriograph:profile:rdf-rdfs:1`; the standard catalog is `urn:iriograph:catalog:rdf-rdfs@1`. Standard `instance-flow` and `classification-region` presets restrict projection without deleting semantics.

## Layering

| Layer | Source of truth | Responsibility |
|---|---|---|
| Semantic | Turtle in `semantic.source` | identity, meaningful types and relations, order, membership, labels |
| Projection | profile and catalogs | map RDF structures to Scene primitives and defaults |
| Presentation | `views[].overlay` | user-fixed geometry, routing, and explicit appearance overrides |

The profile prefers standard RDF/RDFS vocabulary for common structures but does not require those structures for arbitrary domain graphs. It never redefines RDF semantics. Domain IRIs remain valid. Labels never select classes, structure, or rules. Coordinates, colors, shapes, icons, viewport, and waypoints never enter Turtle.

## Standard vocabulary

### Display-driving structures

| Vocabulary | Semantic role | Base projection |
|---|---|---|
| `rdf:type` | meaningful classification | rule matching; not a visible edge |
| `rdfs:label` | human-readable name | label candidates |
| `rdfs:comment` | description | hover text and optional annotations |
| RDF reification terms | identify an asserted triple | statement comments on the exact edge |
| `rdf:Bag` | unordered membership set | hierarchy container or overlap region |
| `rdfs:member` | container-to-member relation | membership provenance |
| `rdf:Seq` | ordered resource list | selectable sequence frame and ordinal badges |
| `rdf:Alt` | alternatives | choice node and branch guides |
| `rdf:_1`, `rdf:_2`, … | ordinal members | consumed as ordinal membership, not ordinary edges |
| `rdfs:seeAlso` | related reference | reference edge |
| `rdfs:isDefinedBy` | definition source | definition edge |

Membership direction is container as subject and member as object. A domain predicate declared with `rdfs:subPropertyOf rdfs:member` can carry a more precise name and description while retaining generic membership behavior. Projection and validation may use the limited RDFS closure, but provenance and reverse editing preserve the exact asserted predicate.

### Ontology description

`rdfs:Class`, `rdf:Property`, `rdfs:subClassOf`, `rdfs:subPropertyOf`, `rdfs:domain`, and `rdfs:range` receive standard ontology templates and edges in the full preset. They are optional in business flows. Instance-only and classification views are separate named-view presets; hiding schema resources in one view never removes their triples.

### Domain vocabulary

Unknown IRI-object predicates project as generic direct edges unless suppressed by an exact rule. The edge label prefers the predicate resource's localized `rdfs:label`; ordinary UI uses a generic “unnamed relation” fallback rather than exposing a compact IRI.

Unknown literal statements remain semantic data. They produce annotations only through the closed `literal-annotation` operator or a profile rule.

Predicate catalogs add localized labels, descriptions, categories, examples, hierarchy, and terminal-marker categories without replacing the IRI. Direct edges use a small closed marker vocabulary rather than unbounded predicate-specific line styles.

## Structural constraints

### Common

1. `semantic.source` MUST be valid Turtle.
2. Visible resources and structural endpoints MUST be named IRIs in v1.
3. Blank nodes MAY represent non-visible metadata but MUST NOT drive visible v1 structures.
4. One resource MUST NOT be simultaneously typed as more than one of `rdf:Bag`, `rdf:Seq`, and `rdf:Alt`.
5. Labels MUST NOT determine structure.

### Bag and membership

- A Bag has zero or more members.
- Visible containment MUST be acyclic.
- Bag member order has no semantic display meaning.
- One member MAY belong to multiple Bags and every membership is retained.
- A node-link view sets a parent only when a unique compatible visible parent exists.
- A region view projects each Bag independently and places multi-members in the geometric intersection.
- Geometry MUST NOT create membership; mismatches produce diagnostics.

### Sequence

- A Seq has at least `rdf:_1`.
- Ordinals are positive decimal integers without leading zeros and form a gap-free sequence.
- One ordinal predicate has exactly one object.
- Repeated resource values are allowed and retain distinct membership identity.
- The sequence resource is a group frame; members receive badges. No unstated member-to-member triple or edge is generated.

### Alternatives

- An Alt has at least two gap-free ordinal members.
- `rdf:_1` is the default alternative.
- The Alt projects as a choice node or choice group with branch guides.
- A Seq alternative targets the sequence boundary; its label remains the group header and is not copied onto a false edge.
- The structure is generic and not limited to BPMN gateways.

### Visibility

Candidates include structural resources and members, unsuppressed IRI-object endpoints, and named subjects with metadata. Type objects do not become visible merely because they are type objects. Schema resources become visible when the selected preset includes their declarations or ontology relations.

A predicate-level suppress rule prevents direct fallback for that statement. Suppressing a resource in a view also suppresses its incident view edges without changing semantics.

## Label selection

Primary display label is selected deterministically:

1. exact view-locale language tag;
2. matching primary language;
3. untagged label;
4. first normalized language/value pair by Unicode code-point order;
5. a generic unnamed label for the element kind.

Language tags compare in ASCII lowercase; values compare in Unicode NFC. Every label remains in Scene metadata and the search index. Line breaks are preserved and measured. Ambiguous preferred labels produce a warning.

## Projection catalog

Core implements closed generic operators; RDF IRIs are catalog data rather than hard-coded branches.

| Operator | Input | Output |
|---|---|---|
| `resource` | named resource | node or container |
| `direct-edge` | IRI-object statement | edge |
| `membership-container` | structure type and membership predicate | memberships plus container/region |
| `ordinal-sequence` | structure type and ordinal pattern | sequence frame and badges |
| `alternative` | structure type and ordinal pattern | choice and branches |
| `literal-annotation` | literal statement | provenance-bound annotation |
| `suppress` | type or predicate | consume without a Scene element |

Normalized rules declare `ruleId`, explicit `priority`, match kind, match IRI where applicable, entailment mode, projection operator and parameters, and optional template. Match kinds are `type`, `predicate`, and `any-iri-object`; entailment is `exact`, `rdfs-subclass`, or `rdfs-subproperty`. Catalogs contain no arbitrary scripts or regular expressions.

Required parameters include:

- `resource.structuralKind`;
- `membership-container.membershipPredicate` and optional explicit direction;
- `ordinal-sequence.ordinalPredicatePrefix`;
- `alternative.ordinalPredicatePrefix` and `defaultOrdinal`.

The standard ordinal prefix is the RDF namespace plus `_`, and the default alternative ordinal is 1.

The standard catalog binds Bag, Seq, Alt, reference and ontology predicates, suppresses metadata predicates as ordinary edges, and ends with a generic IRI-object direct-edge fallback. Rule resolution uses priority and specificity; equal ambiguous winners are invalid.

Presets:

| Preset | Purpose |
|---|---|
| `full` | ontology and instance resources together |
| `instance-flow` | instances and business structures without schema-definition nodes/edges |
| `classification-region` | explicit class-as-region projection for legacy/specialized views |

## Scene identity and overlay

Scene identity derives from named resource and exact statement/membership identity, never labels or source order. A projection records enough provenance to compile reverse edits without guessing from geometry.

Overlay reconciliation retains compatible entries for surviving identities, creates generated placement for new identities, and removes entries whose identities disappeared. Catalog defaults are regenerated and are not copied into overlays.

## Extensions and exclusions

Domain profiles MAY add vocabulary, capabilities, templates, assets, and rules under their own immutable IDs. They MUST preserve unknown fallback and MUST NOT modify the meaning of standard RDF/RDFS terms.

Version 1 intentionally excludes arbitrary SPARQL view definitions, arbitrary executable catalog logic, geometry-derived semantics, full RDF Dataset Canonicalization, and implicit ontology fetching.
