# Host conformance

[日本語版](../../docs_ja/integration/host-conformance.md)

`@iriograph/host-conformance` verifies that the Local Mock and product hosts such as Kuroxiom Cloud integrate the same public packages without feature loss.

Its versioned manifest pins the package version, CSS entry, baseline catalog, shared-fixture SHA-256, required capabilities, and corresponding component/E2E test IDs. A host exposes `data-iriograph-package-version` and capability attributes on its editor root; a real-Chromium gate compares them with the manifest.

The common gate covers initial rendering, grid, marquee selection, context menus, semantic and view editing, membership, type editing, focus and keyboard behavior, collapsible sidebars, and workspace assets. Declared Cloud-specific catalogs, permissions, asset resolvers, and layout adapters are allowed extensions. Package/CSS drift, stale cache, fixture drift, lost capabilities, container/focus/event integration failures, and unhealthy services are deployment failures.

Release order:

1. Pack all packages and verify imports, types, CSS, fixtures, notices, and licenses in a consumer outside the workspace.
2. Publish all eleven exact lockstep versions publicly to npmjs in dependency order.
3. Verify every exact version and record the immutable release tag.
4. Upgrade the Cloud host to that exact version and pass build, tests, and its local Chromium gate.
5. Deploy through the host's OIDC/SSM workflow and verify the running commit, service health, production Chromium behavior, console and service logs, and disk usage.
