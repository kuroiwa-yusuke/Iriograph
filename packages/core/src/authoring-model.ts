import type {
  ProjectionDiagnostic,
  SemanticSourceUpdate,
} from "./model";
import type { ProjectionRuntimeContext } from "./scene";

export type AuthoringTermPolicy = {
  existingUnknown: "preserve" | "reject";
  humanUnknown: "allow" | "warn" | "reject";
  llmUnknown: "reject";
  humanMinting: "allow" | "warn" | "deny";
  llmMinting: "deny";
};

export type AuthoringObjectKind = "iri" | "literal";
export type AuthoringTermRole = "predicate" | "type-object";

export type ResolvedAuthoringTerm = {
  iri: string;
  kind: "class" | "property" | "structure";
  /** Required for non-standard structure terms whose RDF role is otherwise ambiguous. */
  roles?: readonly AuthoringTermRole[];
  label?: string;
  objectKinds?: readonly AuthoringObjectKind[];
  datatypes?: readonly string[];
  languages?: readonly string[];
  minCount?: number;
  maxCount?: number;
  /** Structural predicates are writable only through structural commands. */
  structural?: boolean;
};

export type AuthoringIriValue = {
  kind: "iri";
  iri: string;
};

export type AuthoringLiteralValue = {
  kind: "literal";
  value: string;
  language?: string;
  datatypeIri?: string;
};

export type AuthoringObjectValue = AuthoringIriValue | AuthoringLiteralValue;

export type AuthoringCapabilityTerm =
  | { kind: "iri"; iri: string }
  | { kind: "literal"; value: string; language?: string; datatypeIri?: string }
  | { kind: "binding"; name: string };

export type AuthoringCapabilityStatement = {
  subject: AuthoringCapabilityTerm;
  predicate: AuthoringCapabilityTerm;
  object: AuthoringCapabilityTerm;
};

export type ResolvedAuthoringCapability = {
  capabilityId: string;
  label?: string;
  parameters: readonly {
    name: string;
    objectKinds: readonly AuthoringObjectKind[];
    required?: boolean;
  }[];
  /** Exact add/remove templates. Wildcard graph mutation is intentionally unsupported. */
  graphPatch: {
    add?: readonly AuthoringCapabilityStatement[];
    remove?: readonly AuthoringCapabilityStatement[];
  };
};

export type ResourceIriAllocationRequest = {
  requestId: string;
  commandId: string;
  documentId: string;
  baseIri: string;
  authoringProfileRef: string;
  allowedNamespaces: readonly string[];
  suggestedLocalName?: string;
  baseRevision: string;
  contextId: string;
  signal?: AbortSignal;
};

export type ResourceIriAllocation = {
  iri: string;
  requestId: string;
  baseRevision: string;
  contextId: string;
};

export interface ResourceIriAllocator {
  allocate(
    request: ResourceIriAllocationRequest,
  ): ResourceIriAllocation | undefined | Promise<ResourceIriAllocation | undefined>;
}

export type ResolvedAuthoringContext = {
  contextId: string;
  contextRevision: string;
  documentRevision: string;
  authoringProfileRef: string;
  runtime: ProjectionRuntimeContext;
  resourcePolicy: {
    allowedMintNamespaces: readonly string[];
  };
  termPolicy: AuthoringTermPolicy;
  terms: readonly ResolvedAuthoringTerm[];
  capabilities: readonly ResolvedAuthoringCapability[];
  allocator?: ResourceIriAllocator;
};

export type CreatedResourceReference = { kind: "created-resource" };
export type InitialResourceReference = AuthoringIriValue | CreatedResourceReference;

export type AuthoringInitialStatement = {
  subject: InitialResourceReference;
  predicateIri: string;
  object: AuthoringObjectValue | CreatedResourceReference;
};

export type AuthoringInitialPosition = {
  viewId: string;
  x: number;
  y: number;
};

type AuthoringCommandBase = {
  commandId: string;
};

export type CreateResourceCommand = AuthoringCommandBase & {
  type: "create-resource";
  resourceIri?: string;
  suggestedLocalName?: string;
  initialStatements: readonly AuthoringInitialStatement[];
  initialPosition?: AuthoringInitialPosition;
};

export type SetPropertyCommand = AuthoringCommandBase & {
  type: "set-property";
  subjectIri: string;
  predicateIri: string;
  /** Complete replacement for subject+predicate. An empty list deletes the property. */
  values: readonly AuthoringObjectValue[];
};

export type ConnectResourcesCommand = AuthoringCommandBase & {
  type: "connect-resources";
  subjectIri: string;
  predicateIri: string;
  objectIri: string;
};

export type ApplyCapabilityCommand = AuthoringCommandBase & {
  type: "apply-capability";
  capabilityId: string;
  bindings: Readonly<Record<string, AuthoringObjectValue>>;
};

export type SetMembershipCommand = AuthoringCommandBase & {
  type: "set-membership";
  containerIri: string;
  memberIri: string;
  enabled: boolean;
  containerTypeIri: string;
  predicateIri: string;
};

export type SetSequenceCommand = AuthoringCommandBase & {
  type: "set-sequence";
  sequenceIri: string;
  memberIris: readonly string[];
  sequenceTypeIri: string;
  ordinalPredicatePrefix: string;
};

export type SetAlternativesCommand = AuthoringCommandBase & {
  type: "set-alternatives";
  alternativeIri: string;
  memberIris: readonly string[];
  defaultMemberIri: string;
  alternativeTypeIri: string;
  ordinalPredicatePrefix: string;
  defaultOrdinal: number;
};

export type DeleteResourceCommand = AuthoringCommandBase & {
  type: "delete-resource";
  resourceIri: string;
  cascade?: boolean;
};

export type RemoveStatementCommand = AuthoringCommandBase & {
  type: "remove-statement";
  statementRef: string;
  subjectIri: string;
  predicateIri: string;
  objectIri: string;
};

export type AuthoringCommand =
  | CreateResourceCommand
  | SetPropertyCommand
  | ConnectResourcesCommand
  | ApplyCapabilityCommand
  | SetMembershipCommand
  | SetSequenceCommand
  | SetAlternativesCommand
  | DeleteResourceCommand
  | RemoveStatementCommand;

export type ResolvedCreateResourceCommand = Omit<CreateResourceCommand, "resourceIri"> & {
  resourceIri: string;
};

export type ResolvedAuthoringCommand =
  | ResolvedCreateResourceCommand
  | Exclude<AuthoringCommand, CreateResourceCommand>;

export type AuthoringGraphTerm =
  | { termType: "NamedNode"; value: string }
  | { termType: "BlankNode"; value: string }
  | {
      termType: "Literal";
      value: string;
      language?: string;
      datatypeIri: string;
    };

export type AuthoringTriple = {
  subject: Exclude<AuthoringGraphTerm, { termType: "Literal" }>;
  predicateIri: string;
  object: AuthoringGraphTerm;
};

export type AuthoringTripleChange = AuthoringTriple & {
  statementRef: string;
};

export type AuthoringGraphPatch = {
  added: AuthoringTripleChange[];
  removed: AuthoringTripleChange[];
};

export type AuthoringPreview = {
  valid: boolean;
  requiresConfirmation: true;
  confirmationId: string;
  baseDocumentFingerprint: string;
  baseRevision: string;
  contextId: string;
  contextRevision: string;
  authoringProfileRef: string;
  commands: ResolvedAuthoringCommand[];
  candidateSource?: string;
  patch: AuthoringGraphPatch;
  diagnostics: ProjectionDiagnostic[];
};

export type PreviewAuthoringOptions = {
  allocator?: ResourceIriAllocator;
  signal?: AbortSignal;
};

export type ApplyAuthoringPreviewOptions = {
  confirmationId: string;
  signal?: AbortSignal;
};

export type AuthoringActor = "human" | "llm";

export type ApplyAuthoringSourceOptions = {
  actor: AuthoringActor;
  signal?: AbortSignal;
};

export type AuthoringApplyResult = SemanticSourceUpdate;

export type ProvenanceAuthoringInput = {
  commandId: string;
  enabled?: boolean;
  memberIris?: readonly string[];
  defaultMemberIri?: string;
};

export type AuthoringCommandSeed = {
  command?: AuthoringCommand;
  diagnostics: ProjectionDiagnostic[];
};
