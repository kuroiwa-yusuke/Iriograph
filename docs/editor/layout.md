# Layout, routing, and performance

[日本語版](../../docs_ja/editor/layout.md)

## Responsibility boundary

Projection creates an adapter-neutral Scene. Layout assigns generated geometry and derived routes. Rendering draws the result. Overlay-only edits do not invoke global layout.

The default layout is deterministic, lightweight, and suitable for small and medium graphs. `@iriograph/layout-elk` provides an optional higher-capability layered adapter through the same contract.

## Pipeline

1. **Semantic projection:** build nodes, edges, groups, annotations, provenance, and constraints.
2. **Structure analysis:** find containment, connected components, strongly connected components, and multi-membership intersections.
3. **Measurement:** measure wrapped labels, icons, comments, badges, ports, and group headers.
4. **Layered placement:** place generated resources along the view direction while preserving user geometry.
5. **Routing:** select ports and routes under obstacle and crossing policy.
6. **Component packing:** pack independent components and groups without unnecessary overlap.
7. **Label and annotation placement:** avoid ordinary nodes and include visible comment bounds.
8. **Reconciliation:** retain compatible user overlays and mark new placement as generated.
9. **Validation:** verify finite geometry, containment, route bounds, and determinism.

## Placement rules

- User placement is a hard constraint.
- Automatic placement moves only generated elements.
- Membership edits use local completion for newly constrained members/subtrees.
- Independent regions without common members do not overlap.
- Ungrouped resources stay outside generated regions.
- Multi-membership resources remain inside the exact intersection.
- Nested groups remain inside ancestors.
- Fixed constraints that have no valid solution produce diagnostics rather than destructive rearrangement.
- Layout direction defaults to left-to-right and may be top-to-bottom.

Component ordering and tie-breaking use stable semantic/Scene identity, not labels or source order.

## Route selection

For automatic direct edges, the preference is:

1. safe straight route;
2. one-bend orthogonal route whose segments are horizontal/vertical;
3. bounded cubic Bezier with interior angle at least 90 degrees.

Arbitrary-angle polyline pivots are not emitted as automatic public routes. Manual routes are preserved and are not mixed with automatic candidates.

A route candidate is scored for:

- intersection with non-endpoint nodes, groups, labels, and visible comments;
- edge crossings and overlap;
- path length and bend complexity;
- non-shortest or hidden endpoint attachment;
- consistency with layout direction and selected ports.

The endpoint lies on or immediately outside the node perimeter so terminal markers remain visible. Ports are chosen jointly with route geometry. Parallel edges and self-loops receive distinct hit areas and stable separation.

Automatic routing exposes at most one intermediate orthogonal point. Curve controls are represented as Bezier knots/handles rather than polyline waypoints. User-edited routes become manual sparse overlay.

## Labels, comments, and content bounds

Node and group measurement includes selected font size, orientation, wrapping, icon natural size/scale, and offsets. Group header position and text direction are independent.

When comments are shown, their complete callout bounds participate in overlap avoidance and content bounds. Hidden comments do not consume display area, but hover targets remain available.

Fit, reveal, minimap, and work-area bounds include nodes, groups, labels, terminal markers, annotations, manual points, and the control hull of generated or manual Bezier curves.

## Incremental behavior

A semantic edit reprojects every named view but only generated/invalidated geometry is eligible for movement. Existing user placement and manual routes survive by stable identity.

A presentation edit updates the selected element and derived routes of incident edges. It never starts full projection/layout and therefore remains responsive during drag, resize, route, icon, label, and color edits.

Async adapters are bound to document ID, revision, view ID, layout ref/version, catalog/profile fingerprints, measured input, and abort signal. Stale completion is discarded.

## Adapter policy

### Standard layout

Core's standard adapter has no DOM dependency, is deterministic, and provides the baseline behavior required by package and host-conformance tests.

### ELK adapter

The optional ELK package translates the same request into ELK Layered graph data. Engine-specific options and worker instances are injected by the host/package adapter and are not portable document fields. Hard user pins and overlap-region semantics remain Iriograph constraints around the engine.

### Other engines

A new engine is justified by a measurable capability gap under the common fixtures and quality metrics. It does not change semantic projection or document schema.

## Quality metrics

Fixed fixtures evaluate:

- hard containment and finite-coordinate correctness;
- deterministic output;
- node/group/label/comment overlap;
- edge-node intersection;
- edge crossing and overlap;
- route length and bend count;
- endpoint visibility and shortest valid attachment;
- generated versus user movement;
- component packing;
- settled time and interaction frame budget.

Quality improvements must remain generic. Seed IRIs, labels, node counts, or reference-image-specific branches are prohibited.

## Performance gates

Pure Core fixtures cover normal and stress graphs and record phase timing. Prepared relation transactions avoid rebuilding unchanged context. Browser gates cover initial settle, pan, drag, route editing, and responsive widths.

Budgets and sample counts are fixed in tests. A budget change requires a documented reason and matching fixture/test change. Historical values and cross-machine comparisons belong in evaluation records rather than this normative document.

The target interaction boundary is approximately 30 fps or better during pan/drag under the fixed browser fixture; correctness and atomicity remain mandatory even if a host chooses a heavier optional adapter.
