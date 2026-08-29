# Package distribution and versioning

[日本語版](../../docs_ja/integration/distribution.md)

## Public packages

Iriograph releases eleven ESM packages together:

| Package | Public contract |
|---|---|
| `@iriograph/core` | model, schemas, projection, validation, layout, transactions |
| `@iriograph/rdf-io` | Turtle/JSON-LD dataset import, merge, rebase, export |
| `@iriograph/profile-resolver` | immutable authoring-profile/vocabulary resolution |
| `@iriograph/semantic-access` | label-first index and revision-safe authoring facade |
| `@iriograph/layout-elk` | optional ELK Layered layout adapter |
| `@iriograph/profile-kit` | domain projection-profile manifest and conformance kit |
| `@iriograph/presentation-tools` | read-only Scene index and closed presentation candidates |
| `@iriograph/host-conformance` | shared versioned capability/browser gate |
| `@iriograph/icons-aws` | metadata-only AWS Architecture Icons catalog/resolver |
| `@iriograph/agent-bridge` | semantic/presentation routing and candidate review |
| `@iriograph/vue-editor` | Vue components and `@iriograph/vue-editor/styles.css` |

The packages use one lockstep version and exact inter-package dependencies. Vue 3 is a host-provided peer dependency. Build and verification use Node.js 20.19 or later; release automation uses Node 24 and npm with Trusted Publishing support.

Iriograph code is [MIT licensed](../../LICENSE). Every package tarball contains the license. Dependencies, bundled Lucide icons, and vendor catalogs retain their own licenses and notices. `@iriograph/layout-elk` depends on ELK.js under `EPL-2.0 OR GPL-3.0-or-later`; hosts that bundle it must review the applicable terms.

`@iriograph/icons-aws` distributes metadata only, not AWS artwork. Official icon bytes remain user/host supplied under AWS terms.

## Tarball verification

Before release, every workspace is packed and installed only from its tarball into a temporary consumer outside the monorepo. Verification covers:

- all public imports and TypeScript declarations;
- CSS, fixture, manifest, icon, notice, and license subpaths;
- Vue peer dependency behavior;
- production bundling;
- direct Node ESM imports without workspace aliases;
- exact lockstep dependencies;
- absence of repository-only source imports.

Generated JavaScript relative specifiers include `.js`. Packaged assets and notices are byte-checked where the contract requires immutability.

## npmjs publication

Public releases target only the canonical registry:

```text
https://registry.npmjs.org/
```

The npm organization and scope are `iriograph` / `@iriograph`. The publishing script rejects any different scheme, host, port, path, query, fragment, embedded credential, or fallback registry.

Triggers are a `packages-v<version>` tag, an explicit workflow dispatch, or a main-branch change to the release marker `.github/package-release-version`. The marker must exactly equal all eleven package versions.

The publish job uses GitHub Actions Trusted Publishing:

- GitHub-hosted runner;
- Node 24;
- npm >= 11.5.1;
- `contents: read`;
- `id-token: write`;
- no long-lived `NPM_TOKEN` or `NODE_AUTH_TOKEN`;
- `npm publish --access public --provenance`.

Each npm package configures the exact trusted publisher `kuroiwa-yusuke/Iriograph` and workflow `packages.yml`.

Publication order is Core, RDF I/O, profile resolver, semantic access, ELK adapter, profile kit, presentation tools, host conformance, AWS icons, agent bridge, then Vue editor.

For each `name@version`, the script:

1. queries that exact version from npmjs;
2. skips it if already present;
3. publishes only a genuine 404;
4. treats authentication, network, and malformed responses as failures;
5. after a publish error, accepts a race only if the exact version becomes visible;
6. never overwrites a version or falls back to another registry.

A partially completed release is therefore safely resumable.

## Release audit

After all exact versions are visible, an audit job records:

- `packages-published-v<version>`;
- `packages-publish-success-<commit>` or `packages-publish-failure-<commit>`;
- an annotated `packages-publish-diagnostic-<commit>` JSON tag.

The immutable version tag must point to the release commit and is never force-moved. Diagnostic stages use a closed vocabulary. Publish stages are `install`, `version-check`, `npm-cli`, `npm-registry`, and `npm-publish`. Verify stages distinguish install, version checks, package test groups, type checking, build, and tarball consumer verification.

Only the independent audit job receives `contents: write`; the publish job remains read-only except for its short-lived OIDC identity. Tokens and OIDC assertions never enter script arguments, tags, or stored diagnostics. Failed verify output may include only a small redacted base64 tail under the existing audit contract.

## Consumer hosts

Hosts install exact public versions from npmjs and do not copy package source. Package/CSS/fixture/capability parity is checked by `@iriograph/host-conformance` before and after deployment.

A product may deploy the consuming host to AWS or elsewhere. That deployment is separate from Iriograph package publication and must not reintroduce a private package registry mapping for `@iriograph`.

## SemVer during 0.x

- Breaking public TypeScript APIs, runtime behavior, persistence boundaries, or CSS contracts increment minor.
- Backward-compatible features also normally increment minor.
- Compatible bug fixes, performance improvements, documentation, and release-metadata corrections increment patch.
- Hosts pin exact versions; automatic upgrades across minor versions are not assumed before 1.0.

## Independent version axes

Package SemVer, portable `schemaVersion`, and projection `catalogVersion` are independent. A package release does not implicitly change the document schema. Schema changes require explicit migration policy and tests.

Catalog identity is immutable `catalogId@catalogVersion`. Package patches or minors do not change catalog identity unless rule/template meaning changes.
