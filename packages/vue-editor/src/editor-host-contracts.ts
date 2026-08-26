export type DocumentIdentityAllocationRequest = {
  currentDocumentId: string;
  currentBaseIri: string;
  /** Host revision captured before allocation starts. */
  documentRevision: string;
  requestId: string;
  signal?: AbortSignal;
};

export type DocumentIdentityAllocation = {
  documentId: string;
  baseIri: string;
  requestId: string;
  documentRevision: string;
};

/**
 * Host-owned identity boundary for "duplicate as a new diagram". The editor
 * never guesses a globally unique document/base namespace on the host's behalf.
 */
export interface DocumentIdentityAllocator {
  allocate(
    request: DocumentIdentityAllocationRequest,
  ): DocumentIdentityAllocation | undefined | Promise<DocumentIdentityAllocation | undefined>;
}

/** Validated copy handed to the host. Emitting it never mutates the open document. */
export type DocumentDuplicateHandoff = {
  document: import("@iriograph/core").IriographDocument;
  sourceDocumentId: string;
  sourceDocumentRevision: string;
};

export type PredicateInferenceMode = "exact" | "rdfs-subproperty";

/** Host policy shown by the predicate inspector; it does not alter projection. */
export type PredicateInferencePolicy = {
  query?: PredicateInferenceMode;
  validation?: PredicateInferenceMode;
};

/**
 * Optional host-owned structured clipboard. The editor never reads arbitrary
 * OS clipboard text or evaluates source; the host returns an already-shaped
 * request which still passes through Core preview and atomic apply.
 */
export interface StructuredAuthoringClipboard {
  readonly hasSupportedContent: boolean;
  paste(request: {
    documentId: string;
    viewId: string;
    requestId: string;
    signal?: AbortSignal;
  }): import("@iriograph/core").StructuredAuthoringRequest | undefined
    | Promise<import("@iriograph/core").StructuredAuthoringRequest | undefined>;
}
