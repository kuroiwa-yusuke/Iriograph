# @iriograph/profile-kit

Manifest, validation, fixtures, and conformance helpers for distributing a domain ontology, authoring metadata, projection rules, templates, assets, and license provenance as one versioned profile.

## Install

```sh
npm install --save-exact @iriograph/core @iriograph/profile-kit
```

The kit preserves separate ontology and catalog schemas while reusing standard catalogs as versioned dependencies. It validates identity, integrity, dependency, rule/role/template/asset conflicts, fallback behavior, and license metadata.

Conformance demonstrates the connection to Iriograph; a BPMN-like or other familiar appearance does not claim format interoperability or standards compliance without a dedicated adapter and test suite.

## Optional AWS icon catalog

AWS Architecture Icons metadata and host-supplied resolver helpers are available from an optional subpath:

```ts
import {
  AWS_ICON_CATALOG_REF,
  createAwsIconAssetResolver,
  createAwsIconCatalogResolver,
  resolveAwsServiceAlias,
} from "@iriograph/profile-kit/aws-icons";
```

The subpath includes versioned metadata, official-archive paths and hashes, localized categories, aliases, and rename/deprecation diagnostics. It does not contain or download AWS artwork. The host must provide assets obtained under AWS terms through a local mapping or an allowlisted signed-URL provider.

The immutable manifest is exported as `@iriograph/profile-kit/aws-icons/catalog.manifest.json`; provenance and distribution boundaries are in `@iriograph/profile-kit/aws-icons/NOTICE.md`.

See [Domain profiles and vendor catalogs](../../docs/integration/domain-profiles.md).

## License

MIT. See [LICENSE](./LICENSE).
