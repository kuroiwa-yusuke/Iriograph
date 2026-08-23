import type {
  AuthoringApplyResult,
  AuthoringCommand,
  AuthoringObjectValue,
  AuthoringPreview,
  IriographDocument,
} from "@iriograph/core";

export type AliasKind = "resource" | "predicate";

export type RevisionAlias = {
  alias: string;
  revision: string;
};

export type LocalizedText = {
  value: string;
  language?: string;
  predicateIri: string;
  kind: "preferred" | "alternative" | "comment";
};

export type SemanticAccessOptions = {
  /** Ordered locale preferences. For example ["ja-JP", "en"]. */
  locales?: readonly string[];
  /** Additional preferred-label predicates, after rdfs:label and skos:prefLabel. */
  preferredLabelPredicates?: readonly string[];
  /** Additional alternative-label predicates, after skos:altLabel. */
  alternativeLabelPredicates?: readonly string[];
  /** Additional comment/description predicates, after rdfs:comment. */
  commentPredicates?: readonly string[];
};

export type SemanticResourceSummary = {
  iri: string;
  alias: string;
  reference: RevisionAlias;
  label: string;
  labelSource: "preferred" | "alternative" | "iri";
  description?: string;
  types: readonly string[];
};

export type SemanticPredicateSummary = SemanticResourceSummary & {
  predicateAlias: string;
  predicateReference: RevisionAlias;
  usageCount: number;
};

export type SemanticSearchMatch = SemanticResourceSummary & {
  score: number;
  matchedField: "preferred-label" | "alternative-label" | "comment" | "iri";
  matchedText: string;
};

export type SemanticPredicateSearchMatch = SemanticSearchMatch & {
  predicateAlias: string;
  predicateReference: RevisionAlias;
  usageCount: number;
};

export type HierarchyRelation = {
  iri: string;
  alias?: string;
  reference?: RevisionAlias;
  distance: number;
};

export type SemanticResourceDescription = SemanticResourceSummary & {
  labels: readonly LocalizedText[];
  comments: readonly LocalizedText[];
  superClasses: readonly HierarchyRelation[];
  superProperties: readonly HierarchyRelation[];
  incomingCount: number;
  outgoingCount: number;
  isPredicate: boolean;
  predicateAlias?: string;
};

export type SemanticRelation = {
  subject: SemanticResourceSummary;
  predicate: SemanticPredicateSummary;
  object: SemanticResourceSummary;
};

export type NeighborQuery = {
  resource: RevisionAlias;
  direction?: "incoming" | "outgoing" | "both";
  predicate?: RevisionAlias;
  limit?: number;
};

export type SubgraphQuery = {
  root: RevisionAlias;
  depth?: number;
  direction?: "incoming" | "outgoing" | "both";
  predicates?: readonly RevisionAlias[];
  maxRelations?: number;
};

export type SemanticSubgraph = {
  revision: string;
  roots: readonly SemanticResourceSummary[];
  resources: readonly SemanticResourceSummary[];
  relations: readonly SemanticRelation[];
  truncated: boolean;
};

export type SemanticMembership = {
  container: SemanticResourceSummary;
  member: SemanticResourceSummary;
  /** The exact predicate in the source graph. */
  predicate: SemanticPredicateSummary;
  /** Distance to rdfs:member; zero means the exact standard predicate. */
  subpropertyDistance: number;
  /** rdf:_n and its subproperties are explicit ordinal membership. */
  kind: "generic-membership" | "ordinal-membership";
};

export type MembershipQuery = {
  resource?: RevisionAlias;
  role?: "container" | "member" | "either";
  /** Defaults to true because rdf:_n is an RDFS subproperty of rdfs:member. */
  includeOrdinals?: boolean;
};

export type AliasedIriValue = {
  kind: "iri";
  resource: RevisionAlias;
};

export type AliasedObjectValue = AliasedIriValue | Exclude<AuthoringObjectValue, { kind: "iri" }>;

type AliasedOperationBase = {
  operationId: string;
  revision: string;
};

export type AliasedAuthoringOperation =
  | (AliasedOperationBase & {
      type: "create-resource";
      resourceIri?: string;
      suggestedLocalName?: string;
      initialStatements: readonly {
        subject: { kind: "created-resource" } | AliasedIriValue;
        predicate: RevisionAlias;
        object: AliasedObjectValue | { kind: "created-resource" };
      }[];
      initialPosition?: { viewId: string; x: number; y: number };
    })
  | (AliasedOperationBase & {
      type: "set-property";
      subject: RevisionAlias;
      predicate: RevisionAlias;
      values: readonly AliasedObjectValue[];
    })
  | (AliasedOperationBase & {
      type: "connect-resources";
      subject: RevisionAlias;
      predicate: RevisionAlias;
      object: RevisionAlias;
    })
  | (AliasedOperationBase & {
      type: "apply-capability";
      capabilityId: string;
      bindings: Readonly<Record<string, AliasedObjectValue>>;
    })
  | (AliasedOperationBase & {
      type: "set-membership";
      container: RevisionAlias;
      member: RevisionAlias;
      enabled: boolean;
      containerType: RevisionAlias;
      predicate: RevisionAlias;
    })
  | (AliasedOperationBase & {
      type: "set-sequence";
      sequence: RevisionAlias;
      members: readonly RevisionAlias[];
      sequenceType: RevisionAlias;
      ordinalPredicatePrefix: string;
    })
  | (AliasedOperationBase & {
      type: "set-alternatives";
      alternative: RevisionAlias;
      members: readonly RevisionAlias[];
      defaultMember: RevisionAlias;
      alternativeType: RevisionAlias;
      ordinalPredicatePrefix: string;
      defaultOrdinal: number;
    })
  | (AliasedOperationBase & {
      type: "delete-resource";
      resource: RevisionAlias;
      cascade?: boolean;
    })
  | (AliasedOperationBase & {
      type: "remove-statement";
      statementRef: string;
      subject: RevisionAlias;
      predicate: RevisionAlias;
      object: RevisionAlias;
    });

export type SemanticWritePreview = {
  revision: string;
  operation: AliasedAuthoringOperation;
  command: AuthoringCommand;
  corePreview: AuthoringPreview;
};

export type SemanticWritePreviewRequest = {
  document: IriographDocument;
  revision: string;
  command: AuthoringCommand;
};

export type SemanticWriteApplyRequest = {
  document: IriographDocument;
  revision: string;
  preview: AuthoringPreview;
  confirmationId: string;
};

/**
 * Host-owned authoritative write boundary. Implementations delegate to
 * Iriograph Core or to a Cloud service that enforces the equivalent contract.
 */
export interface SemanticWritePort {
  preview(request: SemanticWritePreviewRequest): Promise<AuthoringPreview>;
  apply(request: SemanticWriteApplyRequest): Promise<AuthoringApplyResult>;
}

export class StaleSemanticRevisionError extends Error {
  readonly expectedRevision: string;
  readonly receivedRevision: string;

  constructor(expectedRevision: string, receivedRevision: string) {
    super(`Semantic alias revision ${receivedRevision} is stale; expected ${expectedRevision}.`);
    this.name = "StaleSemanticRevisionError";
    this.expectedRevision = expectedRevision;
    this.receivedRevision = receivedRevision;
  }
}

export class UnknownSemanticAliasError extends Error {
  readonly alias: string;
  readonly kind: AliasKind;

  constructor(alias: string, kind: AliasKind) {
    super(`Unknown ${kind} alias: ${alias}.`);
    this.name = "UnknownSemanticAliasError";
    this.alias = alias;
    this.kind = kind;
  }
}

export class SemanticWriteConfirmationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SemanticWriteConfirmationError";
  }
}
