# Domain profiles and vendor catalogs

[日本語版](../../docs_ja/integration/domain-profiles.md)

## Domain projection profiles

`@iriograph/profile-kit` provides a manifest and conformance kit for distributing domain ontologies, authoring metadata, projection rules, templates, and assets without adding domain-specific branches to Core. A manifest declares immutable identifiers and versions, integrity, default locale, opaque role and group-kind IDs, profile dependencies, and license metadata.

The validator checks role, rule, template, and asset conflicts; missing dependencies; unknown fallbacks; exact provenance; profile-guided authoring; and license metadata. The reference workflow profile demonstrates reuse of the standard predicate catalog, generic task ports, and loading in both the Mock and Cloud. A BPMN-like appearance does not imply BPMN import compatibility or standards compliance without a dedicated adapter and conformance suite.

## AWS icon catalog

`@iriograph/profile-kit/aws-icons` is an optional metadata-only subpath. It does not redistribute AWS Architecture Icons. It pins the official archive release, provenance, hashes, paths within the archive, localized categories, service aliases, and rename/deprecation metadata. A host may map an officially downloaded archive to a local provider or inject an allowlisted HTTPS signed-URL provider.

Portable overlays store only versioned asset IRIs. The resolver distinguishes missing installation, version mismatch, rename, deprecation, missing asset, and reserved-namespace conflict. Authentication URLs and bytes never enter the portable document.

Bundled Lucide icons and vendor icons use separate namespaces. Vendor branding is not copied into the Core default set, and documents remain readable through a safe unknown-asset fallback when the optional catalog is not loaded.
