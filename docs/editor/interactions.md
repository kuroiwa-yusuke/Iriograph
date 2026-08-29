# Editor interactions

[日本語版](../../docs_ja/editor/interactions.md)

The standard editor is designed for users who do not know RDF, RDFS, Turtle, or IRIs. Labels, descriptions, icons, and direct canvas selection are primary. Turtle and complete document source remain available as explicit source-editing modes.

## Basic model

The editor separates:

- **Meaning:** resources, types, properties, direct relations, memberships, order, alternatives, names, and descriptions.
- **View:** geometry, size, route, anchors, color, opacity, template, icon, and label placement.
- **Session:** selection, viewport, grid, snap, hover, open panels, temporary hide/fold, and work-area expansion.

Meaning and View use separate right-panel tabs and never appear as one mixed form.

No non-deleting operation has a second approval step. A user action validates and commits atomically. Undo handles reversible view changes. A modal is used only when deletion affects unselected semantic objects.

## Selection-centered inspector

With no selection, the Meaning tab starts with four intents:

1. Create resource
2. Create relation
3. Edit resource
4. Edit relation

After an intent is chosen, the inspector shows one decision per stage. Canvas preselection may seed a source, target, member, or group role but never commits by itself.

Selecting an object shows a compact summary and applicable actions. Technical command names, capability graph patches, complete IRIs, raw language tags, normalized anchors, and ordinal predicate names are hidden from ordinary UI.

The View tab is available for the selected visual object and is grouped by task, with advanced groups collapsed. It does not duplicate source/target semantic controls as numeric fields.

Both sidebars are collapsible; the left sidebar starts collapsed. Narrow hosts keep the canvas usable rather than expanding the host width.

## Source editing

The source area provides three distinct documents:

- **Turtle:** editable semantic source;
- **View overlay:** editable JSON for the active view;
- **Document:** editable complete portable JSON.

Read-only duplicate Turtle inside the Document tab is not shown. Each editor validates its own boundary and commits atomically. Unsaved valid drafts are flushed before host save. Incomplete structured forms are not auto-applied and block save with actionable guidance.

Direct human Turtle commits preserve valid input bytes. Structured and LLM semantic edits use deterministic reserialization.

## Type catalog and diagram tags

Types are edited in a separate type catalog that presents class hierarchy as a tree. Creating or editing a type does not create a region. A type may have labels, descriptions, parents, and usage count even when no resource currently uses it.

A selected resource can assign/remove direct types in the Meaning inspector using the same label-first choices. The diagram shows only the most specific directly assigned type as one compact tag. Remaining direct and inherited types appear in the type catalog and details.

Legacy `classification-region` views remain readable/editable but are not the standard type-editing path.

## Context menu

Right click, the Context Menu key, and Shift+F10 open the same object-sensitive menu. It may route to details, create relation, membership, reconnection, order/alternatives, view editing, placement, duplication, or deletion.

A menu selection focuses the corresponding inspector or action. Opening or choosing a menu entry alone does not mutate the document. The menu differs for ordinary nodes, direct edges, derived guides, group kinds, and blank canvas.

## Creating a resource

Creation asks for:

1. a name;
2. one profile-approved role or group kind.

The host allocates the IRI. The semantic transaction creates at least one triple and never exposes the IRI field. Comments, additional relations, properties, memberships, and manual position are separate later actions.

After success, projection supplies generated display information. A later drag converts placement to user-controlled view state. Failure leaves no ghost in the portable document.

## Editing details

Selecting a resource opens human-readable sections:

- Name and description
- Type
- Direct properties
- Incoming and outgoing relations
- Memberships and contained members
- Order/alternative membership where applicable

Localized names and descriptions support line breaks and multiple values. The UI identifies default, translation, untagged, and typed values without exposing raw `@ja` or datatype IRIs. Editing one value preserves the rest.

Membership rows allow direct removal and routing to the related group or member. Containing groups and contained resources are both visible.

## Creating and editing relations

Relation creation first chooses a visual family:

- **Edge:** direct relation rendered as an edge
- **Group:** membership/order/alternative structure rendered as a frame, region, badges, or branch guides

Each family is represented by an icon and preview. After family selection, users choose canvas resources and a relation option. Predicate choices are grouped and displayed as localized “A … B” examples; A and B are explanatory placeholders and are not saved.

A direct relation requires one source and one or more targets. Multi-target creation is atomic. A group operation allows multiple members and optional inline creation of new resources without turning an existing ordinary resource into a group.

Editing a direct edge may change predicate, source, or target. Targets are selected from the canvas. Semantic endpoint drag is available even if the edit intent was not opened first; dropping on an invalid target retains the original edge. View-mode endpoint drag changes only the perimeter anchor.

Edge details show the relation and connected resources at a glance. Selecting a resource shows all connected relations and counterpart resources.

## View editing

A node or group supports, where applicable:

- template preview and selection;
- fill, stroke, opacity, and line width;
- width and height through eight resize handles and inspector presets;
- icon from the bundled catalog or workspace asset path;
- icon scale and offset;
- label orientation, alignment, font size, and offset;
- layer movement within its structural layer.

A group also supports label position around the frame, label direction independent of position, icon placement, and front/back ordering among peer frames. Temporary selection elevation never crosses the persistent group < edge < node hierarchy.

Icon path completion traverses normalized relative workspace segments. The picker selects and applies an asset IRI directly. Enlarging an icon may grow its containing node rather than clipping it.

An edge supports route mode, terminal markers, anchors, label/caption offset, and manual controls. Straight, orthogonal, and curve routes are exclusive; switching mode removes incompatible controls. Curves are true cubic Bezier paths with draggable on-curve knots and tangent handles.

## Regions and membership

Clicking the visible interior of a region selects it when no foreground object wins hit testing. A selected region can be moved from its interior without accidentally starting pan or marquee selection.

Members remain inside every group to which they belong, which means a multi-member node is constrained to the intersection. Moving or resizing any group preserves nested groups and all semantic members. A resource not in a region cannot be placed inside it without an explicit mismatch warning; geometry alone never adds membership.

Adding a member uses local reconciliation. Existing user geometry and unrelated inner groups do not undergo global layout. If no valid space exists inside fixed constraints, the transaction reports an actionable placement diagnostic rather than destructively rearranging the diagram.

## Comments

Descriptions appear on hover in an accessible popover. A session toggle may show all comments as callouts. Layout measurement includes visible callouts and prevents overlap with ordinary nodes. Hiding callouts does not remove semantic descriptions.

An exact direct statement may have its own comment through RDF reification. That is separate from a predicate resource's general description and from a view-only caption.

## Order and alternatives

An ordered group is a selectable frame with numbered member badges. Order is carried by ordinal membership, not by invented member-to-member semantic edges. Optional visual guides may connect members but do not claim a process relation.

An alternative group uses a choice visual and branch guides distinct from ordinary asserted relations. Its label names the group; ordinal 1 is the default alternative. Order and alternatives use parallel create/edit UI and expose membership, ordering, and default selection in the group details.

## Deletion

Delete/Backspace and the inspector delete action operate on the current selection as one semantic transaction.

- If all affected objects are selected, deletion commits without confirmation.
- If unselected incident relations or structural memberships are affected, a modal lists them by label and a session-only canvas preview marks the impact.
- Removing a resource removes its incident semantic relations as part of the confirmed cascade.
- Seq/Alt ordinals are repaired atomically.
- If the resulting structure violates profile constraints, nothing is applied.

## Host contract

A host supplies runtime catalogs/layout, resolved authoring and validation contexts, allocators, asset access and path metadata, persistence, revision conflict handling, authentication, and permissions. The package supplies the complete editor UI and emits portable-document updates; the host must not duplicate or fork package behavior.
