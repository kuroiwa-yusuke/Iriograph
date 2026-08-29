# RDF dataset import and export

[日本語版](../../docs_ja/semantics/rdf-io.md)

`@iriograph/rdf-io` exchanges only the semantic source of truth as Turtle or JSON-LD. It never derives semantics from overlay geometry or image positions.

## Import

Import normalizes input into an RDF dataset while preserving expanded IRIs, blank nodes, literal language and datatype, base resolution, and duplicate statements. New-document and merge candidates are separate operations; both return semantic diffs, collisions, and loss reports. Schema or semantic errors prevent application. A host passes a valid candidate to a Core authoring transaction for atomic commit.

Import does not add the profile's default locale to existing literals, rewrite external expanded IRIs into a local namespace, or infer type, membership, or ordering from visual containment, position, or line style.

## Merge and rebase

Merge treats equal expanded IRIs as the same resource and reports local-IRI collisions, incompatible literals, and blank-node scope. Resolution belongs to the user or host policy.

Changing a namespace during document copy is an explicit rebase operation. Rebase previews the source base, the exact IRI set, and the before/after mapping. It preserves standard vocabulary, external vocabulary, and absolute IRIs outside the selected namespace. Renaming a file never rewrites RDF identity implicitly.

## Export

Export serializes only the semantic dataset to Turtle or JSON-LD. It preserves language, datatype, and expanded identity without adding overlays, viewport state, icon URLs, or workspace paths. Turtle comments, whitespace, prefix order, and statement formatting are not guaranteed to survive a later deterministic reserialization.

Format-specific diagram exchange such as BPMN XML belongs in a separate adapter with an explicit loss model rather than an enumeration inside this package.
