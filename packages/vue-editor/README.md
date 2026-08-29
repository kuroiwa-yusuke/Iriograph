# @iriograph/vue-editor

Embeddable Vue 3 WYSIWYG editor for Iriograph portable documents. Vue is a peer dependency; Core and the editor use the same exact lockstep release.

## Install

```sh
npm install --save-exact @iriograph/core @iriograph/vue-editor vue
```

Import the public stylesheet explicitly:

```ts
import { IriographEditor } from "@iriograph/vue-editor";
import "@iriograph/vue-editor/styles.css";
```

## Embed

```vue
<IriographEditor
  ref="editor"
  v-model="document"
  v-model:active-view-id="activeViewId"
  :runtime-context="projectionRuntimeContext"
  :authoring-context="resolvedAuthoringContext"
  :semantic-validation-context="resolvedSemanticValidationContext"
  :resource-iri-allocator="resourceIriAllocator"
  :document-identity-allocator="documentIdentityAllocator"
  :asset-access="assetAccess"
  :asset-options="workspaceAssetOptions"
  :workspace-locator="workspaceLocator"
  :pick-asset="pickWorkspaceAsset"
  @save="saveToWorkspace"
  @duplicated-as-new="openDuplicatedDocument"
/>
```

`runtimeContext` contains resolved catalogs and a layout registry. `authoringContext` enables structured semantic editing with opaque roles, predicates, capabilities, and policy. Workspace storage, network, authentication, permissions, and persistence remain host responsibilities.

## Editing model

The right inspector separates Meaning and View.

Meaning starts with create resource, create relation, edit resource, and edit relation. It uses canvas selection and localized profile choices rather than IRI input. Resource/group creation, multi-target relations, membership, Seq/Alt order, inline new members, types, localized text, reconnection, and deletion compile to atomic Core transactions. Non-deleting actions do not add a second Preview/Apply screen.

View editing changes sparse geometry, templates, icons, colors, label placement, terminal markers, anchors, and straight/orthogonal/Bezier routes without modifying Turtle or starting global layout.

Group movement and resize preserve nested containment and every multi-membership intersection. Grid, snap, selection, viewport, work-area expansion, minimap, and temporary visibility are session state.

## Save and drafts

Before a host-owned save shortcut, call:

```ts
const ready = await editor.value?.flushPendingEdits();
if (ready) save(document.value);
```

The editor's own `save` event is emitted only after a successful flush; its handler must save the current model without re-entering the same flush. Incomplete structured forms are not auto-applied.

`pendingDraftsChanged` covers Turtle, active-view overlay JSON, full-document JSON, and structured drafts.

## Assets

`assetOptions` maps stable asset IRIs to human labels and optional paths. `workspaceLocator` provides normalized segment completion; `pickAsset` returns one asset IRI. The editor never saves path text, resolved URLs, or bytes as identity.

Bundled package icons work without weakening host policy for workspace or external assets.

## Navigation and accessibility

The component exposes pan, zoom, fit, reveal, focus, selection, and snap methods. Read-only mode preserves navigation and selection while disabling semantic and presentation mutation.

The canvas has one keyboard tab stop and supports object navigation, marquee/multi-selection, batch drag, align/distribute, keyboard movement/resize, route editing, context menus, and accessible dialogs/status. One gesture creates one presentation history item.

## Documentation

- [Editor interactions](../../docs/editor/interactions.md)
- [Public contracts](../../docs/architecture/public-contracts.md)
- [Accessibility](../../docs/editor/accessibility.md)
- [日本語 README](./README_ja.md)

## License

MIT. See [LICENSE](./LICENSE).
