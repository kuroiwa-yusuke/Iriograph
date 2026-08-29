# @iriograph/agent-bridge

Host-side contracts for connecting Iriograph's label-first index and semantic/presentation transactions to JSON transports such as HTTP or MCP.

## Install

```sh
npm install --save-exact @iriograph/agent-bridge
```

The host injects authentication, authorization, tenant isolation, rate and size limits, current revision, persistence, and audit. Ordinary transport DTOs use revision-bound opaque IDs and do not expose raw IRIs, overlays, asset bytes, or signed URLs.

Natural-language classification is not authorization. Semantic and presentation requests become separate candidates, reviews, and transactions, including for mixed requests.

See [Agents and host integration](../../docs/integration/agents.md).

## License

MIT. See [LICENSE](./LICENSE).
