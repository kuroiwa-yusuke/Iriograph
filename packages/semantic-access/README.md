# @iriograph/semantic-access

Framework-independent label-first search and revision-safe authoring facade over Iriograph Turtle.

## Install

```sh
npm install --save-exact @iriograph/core @iriograph/semantic-access
```

## Read

```ts
import { SemanticAccessIndex } from "@iriograph/semantic-access";

const semantic = new SemanticAccessIndex(document, workspaceRevision, {
  locales: ["en", "ja-JP"],
});

const resources = semantic.searchResources("approval");
const predicates = semantic.searchPredicates("depends on");
const detail = semantic.describe(resources[0].alias);
const related = semantic.subgraph(resources[0].alias, { depth: 2 });
```

Labels and descriptions support discovery but never replace identity. Results use aliases bound to an exact document revision and index fingerprint. Ordinary DTOs do not expose overlays, asset bytes, authenticated URLs, or raw SPARQL Update.

Read APIs cover resources and predicates, descriptions, localized values, class/property hierarchy, incoming/outgoing neighborhoods, exact statement comments, related subgraphs, and normalized Bag/Seq/Alt membership. Limited RDFS inference is explicit and separate from asserted-edge counts.

`standardPredicateVocabularyJa` and related helpers add localized picker metadata for selected RDF/RDFS, Dublin Core Terms, PROV-O, and SKOS predicates without creating custom Japanese predicates.

## Write

A host injects a `SemanticWritePort`; direct Core hosts can use `createCoreSemanticWritePort`.

```ts
const preview = await semantic.preview({
  kind: "add-relation",
  source: sourceAlias,
  predicate: predicateAlias,
  target: targetAlias,
});

const committed = await semantic.apply({
  previewId: preview.previewId,
  confirmationId: preview.confirmationId,
});
```

Apply requires the same revision and exact preview binding. Stale and unknown aliases fail closed. Core or the Cloud write port remains responsible for final policy, canonical Turtle, all-view reconciliation, and atomic save.

See [Semantic Access](../../docs/integration/semantic-access.md).

## License

MIT. See [LICENSE](./LICENSE).
