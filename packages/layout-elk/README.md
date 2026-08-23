# @iriograph/layout-elk

Optional ELK.js Layered layout adapter for `@iriograph/core`. It keeps the
semantic document and engine-specific ELK options separate: a document stores
only a stable `layoutRef`, while this package translates the Core layout
request into ELK's graph model.

## Install

```sh
npm install @iriograph/core@0.2.0 @iriograph/layout-elk@0.2.0
```

## Use the bundled engine

```ts
import { LayoutAdapterRegistry } from "@iriograph/core";
import {
  ELK_LAYOUT_REFS,
  ElkLayeredLayoutAdapter,
} from "@iriograph/layout-elk";

const layouts = new LayoutAdapterRegistry([
  new ElkLayeredLayoutAdapter(ELK_LAYOUT_REFS.layeredLr, "LR"),
  new ElkLayeredLayoutAdapter(ELK_LAYOUT_REFS.layeredTb, "TB"),
]);
```

The default engine lazily loads `elkjs/lib/elk.bundled.js`. Applications that
need a browser Worker can inject an engine or a lazy factory. The injected
object only needs the public `ElkLayoutEngine` contract, so Worker construction
and asset URLs remain host responsibilities.

```ts
import ELK from "elkjs/lib/elk-api.js";
import { ElkLayeredLayoutAdapter } from "@iriograph/layout-elk";

const adapter = new ElkLayeredLayoutAdapter("urn:example:layout:worker", "LR", {
  engineFactory: {
    create: () => new ELK({
      workerUrl: new URL("./elk-worker.min.js", import.meta.url).toString(),
    }),
  },
});
```

Do not store ELK option keys in an Iriograph document. Direction, spacing,
containment, node dimensions and routing intent are translated from the Core
request by this adapter.

## Fixed geometry

ELK Layered does not provide a hard guarantee for arbitrary pinned positions.
When a request contains a pinned element or `placement: "user"`, this adapter
therefore does not run ELK and does not restore coordinates after routing. It
uses Core's deterministic conservative layout instead, preserves fixed
geometry exactly, reroutes every edge against the resulting geometry, and
returns diagnostics describing the fallback or an impossible fixed constraint.

Manual waypoints are retained as view geometry. Every result contains geometry
for every input element and a complete source-to-target route for every edge;
missing, invalid, or failed engine output is diagnosed and completed through a
deterministic fallback.

## License notice

This package depends on ELK.js. ELK.js declares
`EPL-2.0 OR GPL-3.0-or-later`; review the applicable license terms when
redistributing a bundle containing it. Iriograph does not copy ELK engine
options or code into saved documents.
