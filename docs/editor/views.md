# Named views

[日本語版](../../docs_ja/editor/views.md)

A portable document may contain multiple named views over one semantic graph. A view stores:

- stable `viewId` and user-facing label;
- projection profile/catalog selection;
- layout reference and direction;
- locale preferences;
- sparse display overlay.

Semantic Turtle is shared. Changing or deleting a view never deletes semantic statements.

## Direction

Layout direction is a view-level choice. The standard directions are left-to-right and top-to-bottom. Direction affects generated placement and routing but does not rotate saved user text or infer order.

A semantic change may lay out new generated elements using the active view direction. An overlay-only change does not relayout existing generated or user elements globally.

## Active view and session

The active view may be host-controlled or editor-local. Switching views:

- flushes or rejects pending source drafts safely;
- preserves each view's overlay;
- creates a new Scene from the same semantic graph;
- resets view-specific session selection when necessary;
- restores or fits viewport according to host/session policy.

Active view, viewport, selection, grid, snap, temporary hide/fold, hover, minimap state, and expanded inspector sections are session data, not portable view fields.

## Persistence boundary

Persist:

- view identity and label;
- projection profile/catalog refs;
- layout ref and direction;
- locale;
- sparse appearance and geometry overlay.

Do not persist:

- arbitrary SPARQL or executable filters;
- current selection or viewport;
- work-area padding;
- grid/snap settings;
- temporary visibility/folding;
- derived routes that can be regenerated and were not manually edited.

## Standard UI

The editor allows users to create, rename, duplicate, switch, and delete named views without editing the semantic graph. The common default is one region-capable view rather than separate “flow” and “regions” choices.

Advanced projection/profile selection is shown only when the host exposes compatible options. Users choose human-readable view purposes rather than catalog URIs.

Version 1 does not provide arbitrary query-defined views or automatic edge synthesis across hidden nodes.
