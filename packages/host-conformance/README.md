# @iriograph/host-conformance

Versioned conformance manifest and report validator that keeps the Local Mock and product hosts on the same public Iriograph packages, CSS entry, baseline catalog, fixtures, and editor capabilities.

## Install

```sh
npm install --save-exact @iriograph/host-conformance
```

A host exposes package version and capability attributes on the editor root. Component and real-browser gates compare them with the package manifest. Product-specific extensions are allowed only when declared; missing baseline behavior, CSS/package drift, stale fixtures, or unhealthy host integration fail conformance.

See [Host conformance](../../docs/integration/host-conformance.md).

## License

MIT. See [LICENSE](./LICENSE).
