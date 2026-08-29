# Development and verification

[日本語版](../../docs_ja/development/testing.md)

Iriograph verifies pure graph processing, Vue components, real-browser behavior, distributable tarballs, and consuming hosts at separate layers. Pointer interaction and asynchronous persistence must not be represented only by unit tests.

## Required commands

Run the full repository gate in the fixed Node/Docker environment:

```sh
npm run verify
```

This covers tests, type checking, builds, lockstep-version validation, documentation checks, and packed-tarball consumer verification for all eleven packages and the Mock. Changes to editor UI, transactions, layout, assets, or host integration also require real Chromium:

```sh
npm run verify:e2e
```

When the host has no browser:

```sh
docker build -f Dockerfile.e2e -t iriograph-e2e .
docker run --rm --ipc=host iriograph-e2e
```

Performance and rendering gates are separate:

```sh
docker run --rm --ipc=host iriograph-e2e npm run verify:performance
docker run --rm --ipc=host iriograph-e2e npm run verify:browser-performance
```

Before completion, start the Mock from the latest source and verify HTTP response, normal and narrow widths, save/reload, console errors, and failed requests.

## Test placement

- Pure dataset, projection, authoring, layout, and reconciliation tests live beside their Core responsibility.
- RDF exchange, profiles, semantic access, agents, and presentation contracts are tested in their packages.
- Pointer coordinates, keyboard handling, ARIA, and SVG routing are Vue helper/component tests.
- Document transactions, history, pending flush, and semantic/presentation separation are editor integration tests.
- Real events, CSS, grid, scrolling, asset decoding, and Mock persistence are Playwright tests.
- Mock/Cloud parity uses the same host-conformance manifest, fixtures, and browser checks.

## Invariants

- A failed semantic transaction atomically preserves source, document, Scene, all named views, and history.
- Overlay-only edits do not modify Turtle or start global layout.
- Semantic edits validate all views and retain sparse overlays for surviving identities.
- External/LLM candidates are bound to revision, context, and exact patch.
- Asset bytes, signed URLs, and credentials never enter documents, semantic DTOs, or snapshots.
- Raw IRIs remain in editable source and internal transaction identity, not ordinary UI/DOM.
- Selection, viewport, temporary hide/fold state, and grid are session state rather than document history.
- Auto-routing prefers safe straight lines, one-bend orthogonal lines, then bounded Bezier curves, with at most one public intermediate point.
- Group and member drag, resize, and membership edits preserve every membership intersection and nested containment.

## Performance gates

Core normal/stress fixtures, small-graph phase timing, prepared relation transactions, browser pan/drag, and production settled timing use fixed fixtures, sample counts, and budgets. Changes to budgets or fixtures must update [Layout, routing, and performance](../editor/layout.md) and the corresponding test in the same commit. Absolute timings from different machines are not compared as a time series.

Reference-image structure scores, image proxies, agent prompts, token/cycle measurements, and historical results belong in [Evaluation history](../evaluations/reference-reconstruction.md). They must not become seed-specific layout branches.

## Adding tests

- Do not add DOM or browser mocks to Core.
- Separate coordinate conversion, revision/history, and real dispatch across component, integration, and Playwright layers.
- One gesture produces one history item regardless of move-event count; Escape, cancel, and abort do not mutate the source of truth.
- Bind asynchronous results to document, view, revision, and context fingerprints, and discard stale completion.
- Resolve opaque authoring option IDs to exact terms and fail closed on unknown terms, role conflict, or namespace collision.
- Test direct edges, membership, Seq/Alt, types, localized text, deletion, and reconnection as distinct provenance-bearing transactions.
- Ask for deletion confirmation only when effects extend beyond the selected objects; rebuild Seq/Alt ordinals in the same atomic patch.
- Save appearance overrides sparsely rather than duplicating catalog defaults.
- Test encoded-byte limits, decoded-pixel limits, MIME/signature validation, and lease release separately for assets.
- Fix accessibility behavior for a single tab stop, real DOM IDs, focus return, Escape, busy/status/alert, and keyboard-only paths.
