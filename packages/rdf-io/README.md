# @iriograph/rdf-io

`@iriograph/rdf-io` is a framework-independent boundary for importing Turtle or JSON-LD into an RDF dataset, previewing a new document or merge, applying the result atomically, explicitly rebasing a namespace, and exporting semantic RDF only.

```sh
npm install --save-exact @iriograph/rdf-io
```

## Import and merge

```ts
import {
  applySemanticPatch,
  importRdfDataset,
} from "@iriograph/rdf-io";

const preview = await importRdfDataset({
  format: "text/turtle",
  source: externalTurtle,
  baseIri: "urn:portable:fallback:",
  target: {
    kind: "merge",
    existing: currentDataset,
    localIriNamespace: "urn:workspace:diagram:",
  },
});

if (preview.valid && preview.patch) {
  const result = applySemanticPatch(currentDataset, preview.patch);
  if (result.accepted) currentDataset = result.dataset;
}
```

The candidate contains expanded RDFJS quads, a semantic diff, validation diagnostics, dataset statistics, local IRI collisions, and a loss report. Literals retain their exact lexical value, language, and datatype. Untagged values stay untagged; no profile or locale default is applied.

Duplicate statements are reported and represented once because an RDF dataset has set semantics. Imported blank node labels are scoped away from existing blank nodes during merge. Remote JSON-LD contexts are not fetched implicitly.

Local identity joins are rejected by default. Set `localIriCollisionPolicy: "merge"` only when the shared expanded IRIs are intentionally the same resources. External expanded IRIs are never rewritten to the local namespace.

## Explicit rebase

```ts
import { createExplicitRebase } from "@iriograph/rdf-io";

const rebase = createExplicitRebase({
  dataset: importedDataset,
  fromNamespace: "urn:source:diagram:",
  toNamespace: "urn:workspace:copy:",
});
```

Rebase is deliberately a separate public API. It previews every expanded IRI change, rejects target collisions, and returns the same fingerprint-bound atomic patch shape as import. IRIs outside `fromNamespace` remain unchanged.

## Semantic export

```ts
import { exportRdfDataset } from "@iriograph/rdf-io";

const turtle = await exportRdfDataset({
  dataset: currentDataset,
  format: "text/turtle",
});
const jsonLd = await exportRdfDataset({
  dataset: currentDataset,
  format: "application/ld+json",
});
```

Export accepts only an RDF dataset, so geometry, routing, icons, colors, viewport state, and other view overlay data cannot enter the RDF output. Turtle export rejects named graphs instead of dropping graph identity; JSON-LD can preserve a complete RDF dataset. The loss report distinguishes non-semantic syntax/shape changes from RDF semantic loss.
