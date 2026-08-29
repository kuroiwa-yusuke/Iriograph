import type { Quad } from "n3";

export type RdfInputFormat = "text/turtle" | "application/ld+json";
export type RdfOutputFormat = RdfInputFormat;

export type RdfDataset = {
  /** RDFJS quads sorted and de-duplicated by expanded RDF term identity. */
  readonly quads: readonly Quad[];
  /** Stable identity used to bind an atomic patch to an exact dataset. */
  readonly fingerprint: string;
};

export type RdfIoDiagnostic = {
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
  iri?: string;
  statement?: string;
};

export type RdfLossEntry = {
  code: string;
  message: string;
  count: number;
  /** True only when an RDF dataset fact would be omitted or changed. */
  semantic: boolean;
};

export type RdfLossReport = {
  /** Syntax, ordering, comments, aliases, and JSON shape are outside this guarantee. */
  semanticLossless: boolean;
  entries: readonly RdfLossEntry[];
};

export type RdfDatasetStatistics = {
  statementCount: number;
  namedNodeCount: number;
  blankNodeCount: number;
  literalCount: number;
  languageLiteralCount: number;
  datatypeLiteralCount: number;
  namedGraphCount: number;
};

export type SemanticDiff = {
  additions: readonly Quad[];
  removals: readonly Quad[];
  unchanged: readonly Quad[];
  duplicateStatements: number;
};

export type AtomicSemanticPatch = {
  kind: "iriograph.semantic-patch.v1";
  baseFingerprint: string;
  candidateFingerprint: string;
  additions: readonly Quad[];
  removals: readonly Quad[];
  /** Binds the public patch fields against accidental mutation or stale transport. */
  integrity: string;
};

export type NewDocumentImportTarget = {
  kind: "new-document";
};

export type MergeImportTarget = {
  kind: "merge";
  existing: RdfDataset | readonly Quad[];
  /** Exact namespace whose shared terms must be treated as identity collisions. */
  localIriNamespace: string;
  /** Intentional identity joins must be explicit; the safe default is reject. */
  localIriCollisionPolicy?: "reject" | "merge";
};

export type RdfImportRequest = {
  format: RdfInputFormat;
  source: string | unknown;
  /** Portable fallback used only for resolving relative source IRIs. */
  baseIri?: string;
  target: NewDocumentImportTarget | MergeImportTarget;
};

export type RdfImportCandidate = {
  valid: boolean;
  sourceDataset?: RdfDataset;
  candidateDataset?: RdfDataset;
  semanticDiff: SemanticDiff;
  patch?: AtomicSemanticPatch;
  diagnostics: readonly RdfIoDiagnostic[];
  lossReport: RdfLossReport;
  statistics?: RdfDatasetStatistics;
  /** Expanded local IRIs occurring in both the existing and imported datasets. */
  localIriCollisions: readonly string[];
};

export type ApplySemanticPatchResult =
  | {
      accepted: true;
      dataset: RdfDataset;
      diagnostics: readonly RdfIoDiagnostic[];
    }
  | {
      accepted: false;
      dataset: RdfDataset;
      diagnostics: readonly RdfIoDiagnostic[];
    };

export type ExplicitRebaseRequest = {
  dataset: RdfDataset | readonly Quad[];
  fromNamespace: string;
  toNamespace: string;
};

export type RebaseTermChange = {
  from: string;
  to: string;
  occurrences: number;
};

export type ExplicitRebaseCandidate = {
  valid: boolean;
  candidateDataset?: RdfDataset;
  semanticDiff: SemanticDiff;
  patch?: AtomicSemanticPatch;
  changes: readonly RebaseTermChange[];
  diagnostics: readonly RdfIoDiagnostic[];
  lossReport: RdfLossReport;
};

export type RdfExportRequest = {
  dataset: RdfDataset | readonly Quad[];
  format: RdfOutputFormat;
  /** Turtle base declaration is opt-in; JSON-LD output keeps expanded IRIs. */
  baseIri?: string;
  /** Turtle aliases are presentation syntax only and never alter expanded terms. */
  prefixes?: Readonly<Record<string, string>>;
};

export type RdfExportResult =
  | {
      accepted: true;
      format: RdfOutputFormat;
      source: string;
      diagnostics: readonly RdfIoDiagnostic[];
      lossReport: RdfLossReport;
    }
  | {
      accepted: false;
      format: RdfOutputFormat;
      diagnostics: readonly RdfIoDiagnostic[];
      lossReport: RdfLossReport;
    };
