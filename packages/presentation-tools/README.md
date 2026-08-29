# @iriograph/presentation-tools

Engine-independent tools for external or LLM-generated presentation candidates.
The package exposes an immutable, revision-bound Scene index, compact target and
capability summaries, a closed sparse-patch validator, deterministic diffs, and
host-injected render/score ports. It does not expose an apply operation.

The boundary intentionally cannot represent Turtle, semantic writes, CSS,
arbitrary URLs, resolved asset URLs, authentication data, or asset/screenshot
bytes. Template, icon and style choices use revision-bound opaque option IDs.
Renderer output contains only an opaque screenshot ID and dimensions; any image
bytes remain in host session storage.

```ts
import {
  DEFAULT_PRESENTATION_TOOL_POLICY,
  PresentationSceneBridge,
  PresentationSceneIndex,
  PresentationToolSession,
} from "@iriograph/presentation-tools";

// Raw Scene IDs may be encoded IRIs. The bridge creates deterministic opaque
// aliases for the external tool and maps an accepted patch back inside Host.
const bridge = PresentationSceneBridge.fromDiagramScene(rawScene, {
  documentRevision: "document-r42",
  contextRevision: "catalog-r7",
  viewId: "main",
});
const safeIndex = bridge.index;

const index = new PresentationSceneIndex({
  binding: {
    documentRevision: "document-r42",
    contextRevision: "catalog-r7",
    viewId: "main",
  },
  width: 1200,
  height: 800,
  elements: [{
    elementId: "node-1",
    kind: "node",
    label: "注文",
    presentation: { geometry: { x: 80, y: 80, width: 160, height: 72 } },
  }],
});

const session = new PresentationToolSession({
  sessionId: "reference-image-run-1",
  index,
  policy: DEFAULT_PRESENTATION_TOOL_POLICY,
  capabilities: {
    contextRevision: "catalog-r7",
    fieldRules: [{ field: "geometry", elementKinds: ["node"] }],
  },
  telemetry: { record: (event) => auditQueue.push(event) },
  renderer: hostCandidateRenderer,
  scorer: hostCandidateScorer,
});

const opened = session.beginCycle({
  cycleId: "cycle-1",
  tokens: {
    inputTokens: 1200,
    cachedInputTokens: 900,
    outputTokens: 80,
    reasoningTokens: 25,
  },
});

if (opened.accepted) {
  const result = await opened.value.render("call-1", {
    binding: index.binding,
    candidateId: "candidate-1",
    changes: [{
      elementId: "node-1",
      geometry: { x: 240, y: 120, width: 160, height: 72 },
    }],
  });
  opened.value.finish(result.accepted ? "completed" : "rejected");
}
```

Every tool request repeats the exact document/context/view binding. Stale
bindings, unknown fields, unavailable options, invalid effective routing,
non-finite or out-of-policy coordinates, excess patch fields/changes/points,
oversized JSON, elapsed deadlines, and exhausted token budgets are rejected.
Rejected candidates are never passed to a renderer or scorer.

`PresentationSceneBridge` never places source IRIs, resolved asset URLs, icon
refs or template refs in the external index. Safe overlay IDs may be retained;
IRI-shaped IDs are replaced by deterministic aliases. Only an accepted patch
is mapped back to source overlay IDs inside the trusted Host boundary.

Each model cycle supplies measured input/cached/output/reasoning token usage.
The session derives `none`, `miss`, `partial`, or `hit` cache classification and
emits bounded call and cycle audit records containing latency, request/response
bytes, patch counts, outcome, screenshot ID or score summary. Token limits are
cumulative across the session; time and byte limits are enforced per call and
per cycle.
