import type {
  AuthoringGraphPatch,
  IriographDocument,
  ProjectionDiagnostic,
  ResolvedAuthoringContext,
} from "@iriograph/core";
import type {
  LocalizedText,
  RevisionAlias,
  SemanticRelation,
  SemanticResourceDescription,
  SemanticSubgraph,
} from "@iriograph/semantic-access";
import { SemanticAccessIndex } from "@iriograph/semantic-access";
import { assertResolvedAuthoringOption } from "@iriograph/profile-resolver";

export type AgentRequestRoute = "semantic" | "presentation" | "mixed";

export type AgentRequestClassification = {
  route: AgentRequestRoute;
  semanticReasons: string[];
  presentationReasons: string[];
  /** Classification is advisory and never grants write authority. */
  authoritative: false;
};

const SEMANTIC_TERMS = [
  "意味", "関係", "所属", "包含", "順序", "候補", "分岐", "名前", "説明", "型", "class",
  "relation", "membership", "sequence", "branch", "label", "comment", "type",
] as const;
const PRESENTATION_TERMS = [
  "位置", "配置", "大きさ", "サイズ", "色", "線", "曲線", "アイコン", "見た目", "ビュー",
  "position", "layout", "size", "color", "routing", "icon", "appearance", "view",
] as const;

/** A deterministic fallback classifier. Hosts may replace it with an LLM classifier. */
export function classifyAgentRequest(text: string): AgentRequestClassification {
  const normalized = text.normalize("NFKC").toLocaleLowerCase();
  const semanticReasons = SEMANTIC_TERMS.filter((term) => normalized.includes(term));
  const presentationReasons = PRESENTATION_TERMS.filter((term) => normalized.includes(term));
  const route: AgentRequestRoute = semanticReasons.length > 0 && presentationReasons.length > 0
    ? "mixed"
    : presentationReasons.length > 0 ? "presentation" : "semantic";
  return { route, semanticReasons, presentationReasons, authoritative: false };
}

export type TransportPrincipal = {
  subject: string;
  tenantId: string;
  permissions: readonly ("semantic:read" | "semantic:write" | "presentation:review")[];
};

export type SemanticTransportPolicy = {
  maxRequestBytes: number;
  maxResponseBytes: number;
  maxSearchResults: number;
  maxSubgraphRelations: number;
  maxSubgraphDepth: number;
};

export type SemanticTransportSnapshot = {
  document: IriographDocument;
  revision: string;
  context: ResolvedAuthoringContext;
  index: SemanticAccessIndex;
};

export interface SemanticTransportHost {
  currentSnapshot(principal: TransportPrincipal, signal?: AbortSignal): Promise<SemanticTransportSnapshot>;
  authorize(principal: TransportPrincipal, action: "read" | "write", signal?: AbortSignal): Promise<void>;
  compileOpaqueWrite(
    request: OpaqueSemanticWriteRequest,
    snapshot: SemanticTransportSnapshot,
    signal?: AbortSignal,
  ): Promise<unknown>;
  previewCompiledWrite(
    compiled: unknown,
    snapshot: SemanticTransportSnapshot,
    signal?: AbortSignal,
  ): Promise<SemanticCandidatePayload>;
  applySemanticCandidate(
    candidate: SemanticCandidatePayload,
    snapshot: SemanticTransportSnapshot,
    signal?: AbortSignal,
  ): Promise<{ revision: string }>;
  audit(event: SemanticTransportAuditEvent): void | Promise<void>;
}

export type OpaqueSemanticWriteRequest = {
  operationId: string;
  revision: string;
  contextRevision: string;
  operation: "create-node" | "connect" | "set-membership" | "set-sequence" | "set-alternatives" | "set-text";
  roleId?: string;
  predicateId?: string;
  capabilityId?: string;
  resourceIds?: string[];
  values?: Array<{ valueId: string; value: string }>;
};

export type SemanticTransportRequest =
  | { id: string; method: "search"; revision: string; query: string; limit?: number }
  | { id: string; method: "describe"; revision: string; resourceId: string }
  | { id: string; method: "neighbors"; revision: string; resourceId: string; direction?: "incoming" | "outgoing" | "both"; limit?: number }
  | { id: string; method: "subgraph"; revision: string; rootId: string; direction?: "incoming" | "outgoing" | "both"; depth?: number; maxRelations?: number }
  | { id: string; method: "preview-write"; write: OpaqueSemanticWriteRequest }
  | { id: string; method: "apply-write"; candidateId: string; revision: string; contextRevision: string };

export type SemanticCandidatePayload = {
  candidateId: string;
  documentRevision: string;
  contextRevision: string;
  patch: AuthoringGraphPatch;
  diagnostics: ProjectionDiagnostic[];
  compiled?: unknown;
};

export type SemanticTransportResponse = {
  id: string;
  revision: string;
  result: unknown;
};

export type SemanticTransportAuditEvent = {
  requestId: string;
  principal: string;
  tenantId: string;
  method: SemanticTransportRequest["method"];
  revision: string;
  requestBytes: number;
  responseBytes?: number;
  accepted: boolean;
  code?: string;
};

export class SemanticJsonTransport {
  readonly #host: SemanticTransportHost;
  readonly #policy: SemanticTransportPolicy;
  readonly #candidates = new Map<string, SemanticCandidatePayload>();

  constructor(host: SemanticTransportHost, policy: SemanticTransportPolicy) {
    this.#host = host;
    this.#policy = policy;
  }

  async handle(
    principal: TransportPrincipal,
    request: SemanticTransportRequest,
    signal?: AbortSignal,
  ): Promise<SemanticTransportResponse> {
    signal?.throwIfAborted();
    const requestBytes = jsonBytes(request);
    if (requestBytes > this.#policy.maxRequestBytes) {
      await this.#audit(principal, request, "", requestBytes, false, "request-too-large");
      throw new Error("semantic transport request exceeds the configured byte budget");
    }
    const action = request.method === "preview-write" || request.method === "apply-write" ? "write" : "read";
    await this.#host.authorize(principal, action, signal);
    const snapshot = await this.#host.currentSnapshot(principal, signal);
    const requestedRevision = request.method === "preview-write" ? request.write.revision : request.revision;
    if (requestedRevision !== snapshot.revision) {
      await this.#audit(principal, request, snapshot.revision, requestBytes, false, "revision-conflict");
      throw new Error(`revision conflict: expected ${snapshot.revision}`);
    }
    let result: unknown;
    if (request.method === "search") {
      result = snapshot.index.searchResources(request.query, {
        limit: Math.min(request.limit ?? this.#policy.maxSearchResults, this.#policy.maxSearchResults),
      }).map(resourceDto);
    } else if (request.method === "describe") {
      result = descriptionDto(snapshot.index.describe(reference(request.resourceId, snapshot.revision)));
    } else if (request.method === "neighbors") {
      result = snapshot.index.neighbors({
        resource: reference(request.resourceId, snapshot.revision),
        direction: request.direction,
        limit: Math.min(request.limit ?? this.#policy.maxSearchResults, this.#policy.maxSearchResults),
      }).map(relationDto);
    } else if (request.method === "subgraph") {
      result = subgraphDto(snapshot.index.subgraph({
        root: reference(request.rootId, snapshot.revision),
        direction: request.direction,
        depth: Math.min(request.depth ?? 1, this.#policy.maxSubgraphDepth),
        maxRelations: Math.min(
          request.maxRelations ?? this.#policy.maxSubgraphRelations,
          this.#policy.maxSubgraphRelations,
        ),
      }));
    } else if (request.method === "preview-write") {
      validateOpaqueWrite(request.write, snapshot.context);
      const compiled = await this.#host.compileOpaqueWrite(request.write, snapshot, signal);
      const candidate = await this.#host.previewCompiledWrite(compiled, snapshot, signal);
      assertCandidateBinding(candidate, snapshot);
      this.#candidates.set(candidate.candidateId, candidate);
      result = semanticReview(candidate, snapshot.index, snapshot.context.defaultLocale);
    } else {
      if (request.contextRevision !== snapshot.context.contextRevision) throw new Error("authoring context is stale");
      const candidate = this.#candidates.get(request.candidateId);
      if (!candidate) throw new Error("unknown or already consumed candidate");
      assertCandidateBinding(candidate, snapshot);
      result = await this.#host.applySemanticCandidate(candidate, snapshot, signal);
      this.#candidates.delete(candidate.candidateId);
    }
    const response = { id: request.id, revision: snapshot.revision, result };
    const responseBytes = jsonBytes(response);
    if (responseBytes > this.#policy.maxResponseBytes) {
      await this.#audit(principal, request, snapshot.revision, requestBytes, false, "response-too-large", responseBytes);
      throw new Error("semantic transport response exceeds the configured byte budget");
    }
    await this.#audit(principal, request, snapshot.revision, requestBytes, true, undefined, responseBytes);
    return response;
  }

  async #audit(
    principal: TransportPrincipal,
    request: SemanticTransportRequest,
    revision: string,
    requestBytes: number,
    accepted: boolean,
    code?: string,
    responseBytes?: number,
  ): Promise<void> {
    await this.#host.audit({
      requestId: request.id,
      principal: principal.subject,
      tenantId: principal.tenantId,
      method: request.method,
      revision,
      requestBytes,
      ...(responseBytes === undefined ? {} : { responseBytes }),
      accepted,
      ...(code ? { code } : {}),
    });
  }
}

export type LabelFirstTripleChange = {
  statementId: string;
  subject: string;
  predicate: string;
  object: string;
};

export type SemanticReview = {
  candidateId: string;
  documentRevision: string;
  contextRevision: string;
  added: LabelFirstTripleChange[];
  removed: LabelFirstTripleChange[];
  diagnostics: ProjectionDiagnostic[];
};

export type PresentationCandidateReview = {
  candidateId: string;
  documentRevision: string;
  contextRevision: string;
  sceneRevision: string;
  patch: Readonly<Record<string, unknown>>;
  changedElementLabels: string[];
  diagnostics: ProjectionDiagnostic[];
  screenshot?: { mediaType: "image/png" | "image/webp"; bytes: Uint8Array };
  score?: Readonly<Record<string, number>>;
};

export type ExternalCandidateReview = {
  reviewId: string;
  source: "llm" | "external";
  semantic?: SemanticReview;
  presentation?: PresentationCandidateReview;
};

/**
 * Keeps semantic and presentation confirmations independent. A mixed request
 * never becomes one cross-authority atomic write.
 */
export class ExternalCandidateReviewSession {
  readonly #reviews = new Map<string, ExternalCandidateReview>();

  add(review: ExternalCandidateReview): void {
    if (this.#reviews.has(review.reviewId)) throw new Error(`duplicate review: ${review.reviewId}`);
    if (!review.semantic && !review.presentation) throw new Error("review must contain a candidate");
    this.#reviews.set(review.reviewId, review);
  }

  get(reviewId: string): ExternalCandidateReview | undefined {
    return this.#reviews.get(reviewId);
  }

  take(
    reviewId: string,
    kind: "semantic" | "presentation",
    binding: { documentRevision: string; contextRevision: string },
  ): SemanticReview | PresentationCandidateReview {
    const review = this.#reviews.get(reviewId);
    const candidate = review?.[kind];
    if (!review || !candidate) throw new Error(`unknown ${kind} review`);
    if (candidate.documentRevision !== binding.documentRevision || candidate.contextRevision !== binding.contextRevision) {
      throw new Error(`${kind} review is stale`);
    }
    const next = { ...review, [kind]: undefined };
    if (!next.semantic && !next.presentation) this.#reviews.delete(reviewId);
    else this.#reviews.set(reviewId, next);
    return candidate;
  }

  reject(reviewId: string, kind: "semantic" | "presentation"): void {
    const review = this.#reviews.get(reviewId);
    if (!review?.[kind]) return;
    const next = { ...review, [kind]: undefined };
    if (!next.semantic && !next.presentation) this.#reviews.delete(reviewId);
    else this.#reviews.set(reviewId, next);
  }
}

export function semanticReview(
  candidate: SemanticCandidatePayload,
  index: SemanticAccessIndex,
  locale = "en",
): SemanticReview {
  return {
    candidateId: candidate.candidateId,
    documentRevision: candidate.documentRevision,
    contextRevision: candidate.contextRevision,
    added: candidate.patch.added.map((item) => labelFirstChange(item, index, locale)),
    removed: candidate.patch.removed.map((item) => labelFirstChange(item, index, locale)),
    diagnostics: candidate.diagnostics,
  };
}

function validateOpaqueWrite(request: OpaqueSemanticWriteRequest, context: ResolvedAuthoringContext): void {
  if (request.contextRevision !== context.contextRevision) throw new Error("authoring context is stale");
  if (request.roleId) assertResolvedAuthoringOption(context, {
    contextRevision: request.contextRevision, optionKind: "role", optionId: request.roleId,
  });
  if (request.predicateId) assertResolvedAuthoringOption(context, {
    contextRevision: request.contextRevision, optionKind: "term", optionId: request.predicateId,
  });
  if (request.capabilityId) assertResolvedAuthoringOption(context, {
    contextRevision: request.contextRevision, optionKind: "capability", optionId: request.capabilityId,
  });
  if (request.values?.some((item) => !item.valueId || !item.value)) {
    throw new Error("localized values require non-empty revision-bound valueId and value");
  }
}

function assertCandidateBinding(candidate: SemanticCandidatePayload, snapshot: SemanticTransportSnapshot): void {
  if (candidate.documentRevision !== snapshot.revision) throw new Error("semantic candidate document revision is stale");
  if (candidate.contextRevision !== snapshot.context.contextRevision) throw new Error("semantic candidate context revision is stale");
}

function reference(alias: string, revision: string): RevisionAlias {
  return { alias, revision };
}

function resourceDto(value: ReturnType<SemanticAccessIndex["searchResources"]>[number]) {
  return {
    resourceId: value.alias,
    label: value.label,
    ...(value.description ? { description: value.description } : {}),
    score: value.score,
    matchedField: value.matchedField,
  };
}

function descriptionDto(value: SemanticResourceDescription) {
  return {
    resourceId: value.alias,
    label: value.label,
    ...(value.description ? { description: value.description } : {}),
    labels: value.labels.map(textDto),
    comments: value.comments.map(textDto),
    incomingCount: value.incomingCount,
    outgoingCount: value.outgoingCount,
    isPredicate: value.isPredicate,
    ...(value.predicateAlias ? { predicateId: value.predicateAlias } : {}),
  };
}

function relationDto(value: SemanticRelation) {
  return {
    statementId: value.statementRef,
    subject: { resourceId: value.subject.alias, label: value.subject.label },
    predicate: { predicateId: value.predicate.predicateAlias, label: value.predicate.label },
    object: { resourceId: value.object.alias, label: value.object.label },
    comments: value.comments.map(textDto),
  };
}

function subgraphDto(value: SemanticSubgraph) {
  return {
    revision: value.revision,
    roots: value.roots.map((item) => ({ resourceId: item.alias, label: item.label })),
    resources: value.resources.map((item) => ({ resourceId: item.alias, label: item.label })),
    relations: value.relations.map(relationDto),
    truncated: value.truncated,
  };
}

function textDto(value: LocalizedText, index: number) {
  return { valueId: `v${index + 1}`, value: value.value, kind: value.kind };
}

function labelFirstChange(
  item: AuthoringGraphPatch["added"][number],
  index: SemanticAccessIndex,
  locale: string,
): LabelFirstTripleChange {
  const fallback = reviewFallbacks(locale);
  const subjectAlias = item.subject.termType === "NamedNode" ? index.resourceAlias(item.subject.value) : undefined;
  const predicateAlias = index.predicateAlias(item.predicateIri);
  const objectAlias = item.object.termType === "NamedNode" ? index.resourceAlias(item.object.value) : undefined;
  const subject = subjectAlias ? safeLabel(index, subjectAlias, fallback.newElement) : fallback.newAnonymousElement;
  const predicate = predicateAlias
    ? safePredicateLabel(index, predicateAlias, fallback.relationship)
    : fallback.newRelationship;
  const object = item.object.termType === "Literal"
    ? item.object.value
    : objectAlias ? safeLabel(index, objectAlias, fallback.newElement) : fallback.newElement;
  return { statementId: item.statementRef, subject, predicate, object };
}

function safeLabel(index: SemanticAccessIndex, reference: RevisionAlias, fallback: string): string {
  try { return index.describe(reference).label; } catch { return fallback; }
}

function safePredicateLabel(index: SemanticAccessIndex, reference: RevisionAlias, fallback: string): string {
  try {
    const resource = index.searchPredicates("").find((item) => item.predicateAlias === reference.alias);
    return resource?.label ?? fallback;
  } catch { return fallback; }
}

function reviewFallbacks(locale: string) {
  const japanese = locale.trim().replaceAll("_", "-").toLowerCase().split("-", 1)[0] === "ja";
  return japanese
    ? {
        newAnonymousElement: "新しい匿名要素",
        newRelationship: "新しい関係",
        newElement: "新しい要素",
        relationship: "関係",
      }
    : {
        newAnonymousElement: "New anonymous element",
        newRelationship: "New relationship",
        newElement: "New element",
        relationship: "Relationship",
      };
}

function jsonBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}
