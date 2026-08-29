# @iriograph/profile-resolver

Resolves immutable authoring profiles and vocabulary imports at a host boundary and builds a validated `ResolvedAuthoringContext`.

## Install

```sh
npm install --save-exact @iriograph/core @iriograph/profile-resolver
```

The resolver checks declared identity, version, integrity, import cycles, opaque option-ID collisions, and role conflicts. Network transport, tenant authentication, and immutable cache policy are supplied through `AuthoringArtifactResolver`.

Resolution failure does not block reading an existing document. Hosts should surface diagnostics and fail closed only for controlled semantic writes.

See [Authoring profile](../../docs/semantics/authoring-profile.md).

## License

MIT. See [LICENSE](./LICENSE).
