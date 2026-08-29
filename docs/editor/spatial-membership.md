# Spatial membership

[日本語版](../../docs_ja/editor/spatial-membership.md)

## One meaning, multiple spatial grammars

Semantic membership is a graph relation. A view may project it through different spatial grammars:

- **node-link hierarchy:** one visible parent container and nested placement;
- **overlap regions:** independent translucent regions whose intersections represent multiple memberships;
- **ordered group:** a frame plus ordinal badges;
- **alternative group:** a choice visual and branch guides;
- **legacy classification region:** class membership projected as regions only when an explicit profile requests it.

These grammars do not change the underlying statement. Geometry never creates or removes membership.

## Domain membership predicates

The base relation is `rdfs:member` with group as subject and member as object. A domain predicate may be declared with `rdfs:subPropertyOf rdfs:member` to express a specific membership meaning. Limited RDFS closure lets it use the same spatial grammar, while provenance and reverse editing preserve the exact predicate.

The predicate resource may carry labels and descriptions. If an individual membership statement needs its own explanation, standard RDF reification can identify the exact S/P/O statement and attach `rdfs:comment`. A view caption is not a substitute for semantic statement description.

## Scene contract

Projection retains every membership with stable identity and source provenance even if the current grammar cannot assign one DOM/layout parent.

### Node-link hierarchy

A member receives a structural parent only when there is one compatible visible parent. Multiple memberships are not silently prioritized. The Scene retains all memberships and reports that an overlap-capable view is required.

Nested containers remain acyclic. Moving/resizing an ancestor treats descendant groups and members as one constrained subtree.

### Overlap regions

Each group projects as an independent region. A resource with multiple memberships must fit entirely inside the geometric intersection of all those regions. Independent regions with no shared semantic member should not overlap after generated layout.

Region overlap is explanatory display, not a semantic intersection resource. The intersection has no IRI unless the domain explicitly models one.

A resource with no membership must remain outside generated regions. User placement that visually contradicts semantics is rejected or diagnosed; it is never converted into a triple implicitly.

### Legacy classification regions

An explicit `classification-region` view may project a class as a region and `rdf:type` as membership. It preserves the exact type predicate direction and supports overlap for multiple types. Standard editing uses type tags and the type catalog instead.

## Layout boundary

Layout receives membership constraints, generated/user placement, nested group trees, region intersections, measured labels/icons/comments, and fixed geometry. It may move only generated placement during automatic completion.

Generated layout must:

- preserve all membership intersections;
- keep nested groups within ancestors;
- separate independent groups with no common members;
- keep ungrouped resources outside groups;
- avoid moving unrelated user geometry;
- return a diagnostic rather than violate fixed constraints.

A membership edit compares exact before/after membership and locally reconciles only newly constrained members and their subtree. Adding “Fee” to “Pizza shop,” for example, may expand the outer shop region but must not reshape or move unchanged inner staff/kitchen/delivery regions.

## Overlay reconciliation

Group, member, and membership identities are independent. Reprojection retains compatible user geometry and appearance by stable identity. A changed semantic membership may invalidate only the affected member geometry; it does not reset the complete view.

View-only movement never changes semantic membership. When a group is resized manually, the same semantic bounds constraints used by pointer drag, keyboard, inspector, align, and distribute validate the candidate before commit.

## Authoring lifecycle

Membership creation uses the Meaning editor:

1. choose the Group visual family;
2. select an existing group frame;
3. select one or more members on the canvas, optionally with marquee selection;
4. validate profile capability and resulting graph;
5. commit one atomic semantic transaction;
6. locally complete display only for newly constrained elements.

Membership removal is available from group details, member details, and relation editing. Removing membership does not delete the member resource.

Future spatial grammars require a new projection primitive only when their layout and interaction semantics cannot be expressed by existing node, edge, group, region, sequence, alternative, or annotation contracts.
