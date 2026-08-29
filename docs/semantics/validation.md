# Semantic validation

[日本語版](../../docs_ja/semantics/validation.md)

Core validates RDF/RDFS structure. Domain validators such as SHACL are resolved and injected by the host. SHACL is a strong adapter option, but it is not a dependency of Core, the Vue editor, or the portable document.

## Responsibility and injection

A host injects:

```ts
type ResolvedSemanticValidationContext = {
  contextId: string;
  contextRevision: string;
  validator: SemanticValidationPort;
};
```

Both identifiers are required. The editor receives the context directly or through `ResolvedAuthoringContext.semanticValidation`. Profile retrieval and validator-engine selection belong to host transport and `@iriograph/profile-resolver`.

A validator request contains serializable data rather than an engine-specific store:

- `sourceFingerprint` for the exact Turtle string; offsets use JavaScript UTF-16 code units
- statements sorted by canonical-quad code-point order
- an order-independent `datasetFingerprint`
- stable `statementRef` values and RDF term kind/value/language/datatype
- validation context identity and revision

The response echoes context identity/revision and both fingerprints. Mismatch, adapter failure, malformed response, unknown statement references, or invalid source offsets are internal errors and fail closed.

## Finding identity and source location

Each result has a stable `findingId` derived from constraint identity and focus/path/value equivalents rather than text or line number. Duplicate IDs in one response are invalid.

Core derives `diagnosticId` from context identity/revision, finding ID, code, semantic reference, and statement reference. Severity, message, formatting, and offsets are excluded, so a finding remains trackable after whitespace or prefix changes.

Source offsets are used only when the current Turtle draft fingerprint still matches. Otherwise navigation falls back to semantic/statement references and Scene provenance. Adapters omit a range they cannot determine exactly.

Diagnostic categories include:

- `syntax`: Turtle parsing
- `structure`: RDF/RDFS profile structures such as Bag, Seq, Alt, and containment
- `profile`: catalog/profile resolution and declarations
- `domain`: injected validator findings
- `projection`, `layout`, `asset`, and `internal`: later phases or adapter-contract failures

A diagnostic has a stable machine code, detailed message, and optional presentation hint. Hints may contain a user-facing title, reason, next actions, and resource/statement targets. Action IDs are generic, for example `open-vocabulary-manager`, `choose-existing-term`, `open-region-picker`, or `show-source`; a validator never names Vue components or domain predicates.

Invalid classes, groups, and predicates that can be rejected before application are filtered or disabled with a reason. Ordinary UI explains what failed, why, and what to do next using labels. Raw IRIs remain internal diagnostic and audit identities.

## Transactions and warnings

Direct Turtle editing, structured commands, and LLM source/canonical datasets use the same domain-validation port after all-view reconciliation. A domain error rolls back Turtle and overlay atomically. A previously loaded domain-invalid document remains readable, with findings projected through semantic/statement references and provenance.

A candidate with domain warnings is not applied on its first pass. `SemanticWarningConfirmation` binds approval to:

- validation context identity and revision
- exact source fingerprint
- the code-point-sorted warning diagnostic ID set

Any change invalidates approval. Structured authoring reconstructs and revalidates the candidate on application.

Abort is control flow rather than a validation failure. Core returns `aborted: true` without new diagnostics, and the editor discards stale results through request tokens and `AbortSignal`.

## Cache identity

Validation work is keyed by `contextId + contextRevision + datasetFingerprint + sourceFingerprint`. Equivalent graphs with different Turtle formatting use separate source-location work, while dataset fingerprints and diagnostic IDs remain stable. A future dataset-only findings cache must remap source ranges in a separate layer.

The Mock uses a static TypeScript validator requiring a non-empty `rdfs:label` on workflow resources. This validates the port and UI lifecycle without adding a SHACL runtime dependency.
