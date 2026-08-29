import {
  PresentationContractError,
  definePresentationCapabilities,
  definePresentationToolPolicy,
} from "./contracts.js";
import {
  bindingDiagnostics,
  clone,
  deepFreeze,
  diagnose,
  finiteNumber,
  integer,
  isRecord,
  jsonByteLength,
  oneOf,
  parseBinding,
  rejectUnknownKeys,
  requiredString,
  requireRecord,
} from "./internal.js";
import {
  diffPresentationCandidate,
  validatePresentationCandidate,
} from "./candidate.js";
import type {
  CandidateScore,
  CandidateScoreRequest,
  CandidateScreenshot,
  PresentationCallTelemetry,
  PresentationCandidateDiff,
  PresentationCandidateRenderer,
  PresentationCandidateScorer,
  PresentationCapabilitySet,
  PresentationContextSummary,
  PresentationCycleTelemetry,
  PresentationDiagnostic,
  PresentationInputCacheClass,
  PresentationTelemetrySink,
  PresentationTokenUsage,
  PresentationToolOperation,
  PresentationToolPolicy,
  PresentationToolResult,
  PresentationValidationResult,
} from "./model.js";
import { PresentationSceneIndex } from "./scene-index.js";

export type PresentationCycleStart = {
  cycleId: string;
  tokens: PresentationTokenUsage;
  /** Host-measured start using the injected clock, including model latency. */
  startedAtMs?: number;
};

export type PresentationToolSessionOptions = {
  sessionId: string;
  index: PresentationSceneIndex;
  capabilities: unknown;
  policy: unknown;
  renderer?: PresentationCandidateRenderer;
  scorer?: PresentationCandidateScorer;
  telemetry: PresentationTelemetrySink;
  clock?: PresentationToolClock;
};

export interface PresentationToolClock {
  now(): number;
  setTimeout(callback: () => void, milliseconds: number): unknown;
  clearTimeout(handle: unknown): void;
}

const SYSTEM_CLOCK: PresentationToolClock = {
  now: () => Date.now(),
  setTimeout: (callback, milliseconds) => globalThis.setTimeout(callback, milliseconds),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

type ArtifactBinding = {
  candidateId: string;
  patchIdentity: string;
  documentRevision: string;
  contextRevision: string;
  viewId: string;
};

type WorkResult<T> = {
  result: PresentationToolResult<T>;
  patchChangeCount?: number;
  patchFieldCount?: number;
  candidatePatchIdentity?: string;
};

/**
 * Session-scoped tool boundary. It has no apply method: validation, rendering
 * and scoring can only produce transient candidates for an external review.
 */
export class PresentationToolSession {
  readonly sessionId: string;
  readonly index: PresentationSceneIndex;
  readonly capabilities: Readonly<PresentationCapabilitySet>;
  readonly policy: Readonly<PresentationToolPolicy>;
  readonly #renderer: PresentationCandidateRenderer | undefined;
  readonly #scorer: PresentationCandidateScorer | undefined;
  readonly #telemetry: PresentationTelemetrySink;
  readonly #clock: PresentationToolClock;
  readonly #cycleIds = new Set<string>();
  readonly #artifacts = new Map<string, ArtifactBinding>();
  readonly #candidatePatches = new Map<string, string>();
  #cycleCount = 0;
  #tokens: PresentationTokenUsage = emptyTokens();

  constructor(options: PresentationToolSessionOptions) {
    const sessionDiagnostics: PresentationDiagnostic[] = [];
    const sessionId = requiredString(options.sessionId, sessionDiagnostics, "/sessionId", { opaque: true });
    if (!sessionId) throw new PresentationContractError("Invalid presentation tool session ID.", sessionDiagnostics);
    this.sessionId = sessionId;
    this.index = options.index;
    this.capabilities = definePresentationCapabilities(options.capabilities);
    this.policy = definePresentationToolPolicy(options.policy);
    if (this.capabilities.contextRevision !== this.index.binding.contextRevision) {
      throw new PresentationContractError("Capabilities are stale for the indexed Scene.", [{
        code: "stale-context-revision",
        message: "Capabilities do not match the indexed context revision.",
        path: "/capabilities/contextRevision",
      }]);
    }
    this.#renderer = options.renderer;
    this.#scorer = options.scorer;
    this.#telemetry = options.telemetry;
    this.#clock = options.clock ?? SYSTEM_CLOCK;
  }

  beginCycle(value: unknown): PresentationToolResult<PresentationToolCycle> {
    const diagnostics: PresentationDiagnostic[] = [];
    const record = requireRecord(value, diagnostics, "/cycle");
    if (!record) return { accepted: false, diagnostics };
    rejectUnknownKeys(record, ["cycleId", "tokens", "startedAtMs"], diagnostics, "/cycle");
    const cycleId = requiredString(record.cycleId, diagnostics, "/cycle/cycleId", { opaque: true });
    const tokens = parseTokens(record.tokens, diagnostics, "/cycle/tokens");
    const now = this.#clock.now();
    const suppliedStart = record.startedAtMs === undefined
      ? undefined
      : finiteNumber(record.startedAtMs, diagnostics, "/cycle/startedAtMs");
    if (suppliedStart !== undefined && (suppliedStart < 0 || suppliedStart > now)) {
      diagnose(diagnostics, "invalid-value", "startedAtMs must use the injected clock and cannot be in the future.", "/cycle/startedAtMs");
    }
    if (!cycleId || !tokens || diagnostics.length > 0) return { accepted: false, diagnostics };
    const startedAtMs = suppliedStart ?? now;
    if (this.#cycleIds.has(cycleId)) {
      return this.#rejectCycle(cycleId, tokens, startedAtMs, [{ code: "invalid-request", message: `Cycle ID has already been used: ${cycleId}`, path: "/cycle/cycleId" }]);
    }
    this.#cycleIds.add(cycleId);
    this.#cycleCount += 1;
    if (this.#cycleCount > this.policy.maxCycles) {
      return this.#rejectCycle(cycleId, tokens, startedAtMs, [{ code: "cycle-limit", message: `Cycle count exceeds the host limit of ${this.policy.maxCycles}.` }]);
    }
    const nextTokens = addTokens(this.#tokens, tokens);
    const tokenProblems = tokenBudgetDiagnostics(nextTokens, this.policy);
    if (tokenProblems.length > 0) return this.#rejectCycle(cycleId, tokens, startedAtMs, tokenProblems);
    this.#tokens = nextTokens;
    if (now - startedAtMs >= this.policy.maxCycleDurationMs) {
      return this.#rejectCycle(cycleId, tokens, startedAtMs, [{ code: "cycle-time-budget", message: "The cycle time budget was exhausted before the first tool call." }]);
    }
    return {
      accepted: true,
      value: new PresentationToolCycle({
        session: this,
        cycleId,
        tokens,
        startedAtMs,
      }),
    };
  }

  artifact(screenshotId: string): ArtifactBinding | undefined {
    return this.#artifacts.get(screenshotId);
  }

  rememberArtifact(
    screenshot: CandidateScreenshot,
    candidateId: string,
    patchIdentity: string,
  ): PresentationDiagnostic | undefined {
    const previousPatch = this.#candidatePatches.get(candidateId);
    if (previousPatch !== undefined && previousPatch !== patchIdentity) {
      return { code: "artifact-mismatch", message: `Candidate ID was reused for a different exact patch: ${candidateId}`, path: "/candidateId" };
    }
    const binding: ArtifactBinding = { candidateId, patchIdentity, ...clone(this.index.binding) };
    const previous = this.#artifacts.get(screenshot.screenshotId);
    if (previous && JSON.stringify(previous) !== JSON.stringify(binding)) {
      return { code: "renderer-response-invalid", message: `Screenshot ID was reused across candidates: ${screenshot.screenshotId}`, path: "/screenshotId" };
    }
    this.#candidatePatches.set(candidateId, patchIdentity);
    this.#artifacts.set(screenshot.screenshotId, binding);
    return undefined;
  }

  get renderer(): PresentationCandidateRenderer | undefined {
    return this.#renderer;
  }

  get scorer(): PresentationCandidateScorer | undefined {
    return this.#scorer;
  }

  get telemetry(): PresentationTelemetrySink {
    return this.#telemetry;
  }

  get clock(): PresentationToolClock {
    return this.#clock;
  }

  #rejectCycle(
    cycleId: string,
    tokens: PresentationTokenUsage,
    startedAtMs: number,
    diagnostics: PresentationDiagnostic[],
  ): PresentationToolResult<PresentationToolCycle> {
    const endedAtMs = this.#clock.now();
    this.#telemetry.record(deepFreeze({
      kind: "cycle",
      sessionId: this.sessionId,
      binding: clone(this.index.binding),
      cycleId,
      inputCache: classifyInputCache(tokens),
      status: diagnostics.some((diagnostic) => diagnostic.code === "cycle-time-budget") ? "timeout" : "rejected",
      startedAtMs,
      endedAtMs,
      latencyMs: Math.max(0, endedAtMs - startedAtMs),
      callCount: 0,
      requestBytes: 0,
      responseBytes: jsonByteLength({ accepted: false, diagnostics }),
      patchChangeCount: 0,
      tokens: clone(tokens),
    } satisfies PresentationCycleTelemetry));
    return { accepted: false, diagnostics };
  }
}

type CycleConstructor = {
  session: PresentationToolSession;
  cycleId: string;
  tokens: PresentationTokenUsage;
  startedAtMs: number;
};

export class PresentationToolCycle {
  readonly cycleId: string;
  readonly #session: PresentationToolSession;
  readonly #tokens: PresentationTokenUsage;
  readonly #startedAtMs: number;
  readonly #callIds = new Set<string>();
  #ended = false;
  #callCount = 0;
  #requestBytes = 0;
  #responseBytes = 0;
  #patchChangeCount = 0;

  constructor(options: CycleConstructor) {
    this.#session = options.session;
    this.cycleId = options.cycleId;
    this.#tokens = clone(options.tokens);
    this.#startedAtMs = options.startedAtMs;
  }

  summary(callId: string, request: unknown): Promise<PresentationToolResult<PresentationContextSummary>> {
    return this.#call("summary", callId, request, async () => {
      const parsed = parseSummaryRequest(request, this.#session.index);
      if (!parsed.accepted) return { result: parsed };
      return {
        result: this.#session.index.summarize(
          parsed.value.binding,
          parsed.value.targetElementIds,
          this.#session.capabilities,
          this.#session.policy,
        ),
      };
    });
  }

  validate(callId: string, candidate: unknown): Promise<PresentationToolResult<PresentationValidationResult>> {
    return this.#call("validate", callId, candidate, async () => {
      const validation = validatePresentationCandidate(candidate, this.#session.index, this.#session.capabilities, this.#session.policy);
      return {
        result: validation.accepted
          ? { accepted: true, value: validation }
          : { accepted: false, diagnostics: validation.diagnostics },
        patchChangeCount: validation.accepted ? validation.changeCount : candidateChangeCount(candidate),
        patchFieldCount: validation.accepted ? validation.fieldCount : 0,
      };
    });
  }

  diff(callId: string, candidate: unknown): Promise<PresentationToolResult<PresentationCandidateDiff>> {
    return this.#call("diff", callId, candidate, async () => {
      const validation = validatePresentationCandidate(candidate, this.#session.index, this.#session.capabilities, this.#session.policy);
      if (!validation.accepted) return { result: { accepted: false, diagnostics: validation.diagnostics }, patchChangeCount: candidateChangeCount(candidate) };
      return {
        result: { accepted: true, value: diffPresentationCandidate(this.#session.index, validation) },
        patchChangeCount: validation.changeCount,
        patchFieldCount: validation.fieldCount,
      };
    });
  }

  render(callId: string, candidate: unknown): Promise<PresentationToolResult<CandidateScreenshot>> {
    return this.#call("render", callId, candidate, async (signal) => {
      if (!this.#session.renderer) return { result: { accepted: false, diagnostics: [{ code: "renderer-unavailable", message: "No candidate renderer is configured." }] } };
      const validation = validatePresentationCandidate(candidate, this.#session.index, this.#session.capabilities, this.#session.policy);
      if (!validation.accepted) return { result: { accepted: false, diagnostics: validation.diagnostics }, patchChangeCount: candidateChangeCount(candidate) };
      const diff = diffPresentationCandidate(this.#session.index, validation);
      const input = {
        binding: clone(this.#session.index.binding),
        scene: this.#session.index.snapshot(),
        patch: clone(validation.patch),
        diff: clone(diff),
      };
      const renderInputBytes = jsonByteLength(input);
      if (renderInputBytes > this.#session.policy.maxRenderInputBytes) {
        return {
          result: { accepted: false, diagnostics: [{ code: "request-size-limit", message: `Renderer input is ${renderInputBytes} bytes; limit is ${this.#session.policy.maxRenderInputBytes}.` }] },
          patchChangeCount: validation.changeCount,
          patchFieldCount: validation.fieldCount,
        };
      }
      let output: unknown;
      try {
        output = await this.#session.renderer.render(deepFreeze(input), signal);
      } catch (cause) {
        if (signal.aborted) throw cause;
        return {
          result: { accepted: false, diagnostics: [{ code: "renderer-failed", message: safeFailureMessage("Candidate renderer failed", cause) }] },
          patchChangeCount: validation.changeCount,
          patchFieldCount: validation.fieldCount,
        };
      }
      const screenshot = parseScreenshot(output);
      if (!screenshot.accepted) return { result: screenshot, patchChangeCount: validation.changeCount, patchFieldCount: validation.fieldCount };
      return {
        result: screenshot,
        patchChangeCount: validation.changeCount,
        patchFieldCount: validation.fieldCount,
        candidatePatchIdentity: JSON.stringify(validation.patch),
      };
    });
  }

  score(callId: string, request: unknown): Promise<PresentationToolResult<CandidateScore>> {
    return this.#call("score", callId, request, async (signal) => {
      if (!this.#session.scorer) return { result: { accepted: false, diagnostics: [{ code: "score-unavailable", message: "No candidate scorer is configured." }] } };
      const parsed = parseScoreRequest(request, this.#session.index);
      if (!parsed.accepted) return { result: parsed };
      const artifact = this.#session.artifact(parsed.value.screenshotId);
      if (!artifact
        || artifact.candidateId !== parsed.value.candidateId
        || artifact.documentRevision !== parsed.value.binding.documentRevision
        || artifact.contextRevision !== parsed.value.binding.contextRevision
        || artifact.viewId !== parsed.value.binding.viewId) {
        return { result: { accepted: false, diagnostics: [{ code: "artifact-mismatch", message: "Screenshot is not a render of this revision-bound candidate.", path: "/screenshotId" }] } };
      }
      let output: unknown;
      try {
        output = await this.#session.scorer.score(deepFreeze(clone(parsed.value)), signal);
      } catch (cause) {
        if (signal.aborted) throw cause;
        return { result: { accepted: false, diagnostics: [{ code: "score-failed", message: safeFailureMessage("Candidate scorer failed", cause) }] } };
      }
      return { result: parseScore(output) };
    });
  }

  finish(status: "completed" | "rejected" | "error" = "completed"): void {
    const elapsed = Math.max(0, this.#session.clock.now() - this.#startedAtMs);
    this.#finish(elapsed > this.#session.policy.maxCycleDurationMs ? "timeout" : status);
  }

  async #call<T>(
    operation: PresentationToolOperation,
    callIdValue: unknown,
    request: unknown,
    work: (signal: AbortSignal) => Promise<WorkResult<T>>,
  ): Promise<PresentationToolResult<T>> {
    const startedAtMs = this.#session.clock.now();
    const measuredRequestBytes = jsonByteLength(request);
    const requestBytes = Number.isFinite(measuredRequestBytes) ? measuredRequestBytes : Number.MAX_SAFE_INTEGER;
    const attemptedPatchChangeCount = operation === "validate" || operation === "diff" || operation === "render"
      ? candidateChangeCount(request)
      : 0;
    const callIdDiagnostics: PresentationDiagnostic[] = [];
    const callId = requiredString(callIdValue, callIdDiagnostics, "/callId", { opaque: true }) ?? "invalid-call";
    this.#callCount += 1;
    this.#requestBytes += requestBytes;
    let earlyDiagnostics = callIdDiagnostics;
    if (this.#ended) earlyDiagnostics = [...earlyDiagnostics, { code: "invalid-request", message: "The tool cycle has already ended." }];
    if (this.#callIds.has(callId)) earlyDiagnostics = [...earlyDiagnostics, { code: "invalid-request", message: `Call ID has already been used in this cycle: ${callId}`, path: "/callId" }];
    this.#callIds.add(callId);
    if (this.#callCount > this.#session.policy.maxCallsPerCycle) earlyDiagnostics = [...earlyDiagnostics, { code: "cycle-limit", message: `Call count exceeds the cycle limit of ${this.#session.policy.maxCallsPerCycle}.` }];
    if (requestBytes > this.#session.policy.maxRequestBytes) earlyDiagnostics = [...earlyDiagnostics, { code: "request-size-limit", message: `Tool request is ${requestBytes} bytes; limit is ${this.#session.policy.maxRequestBytes}.` }];
    if (this.#requestBytes > this.#session.policy.maxCycleRequestBytes) earlyDiagnostics = [...earlyDiagnostics, { code: "request-size-limit", message: `Cycle request bytes exceed the limit of ${this.#session.policy.maxCycleRequestBytes}.` }];
    const cycleElapsed = Math.max(0, startedAtMs - this.#startedAtMs);
    if (cycleElapsed >= this.#session.policy.maxCycleDurationMs) earlyDiagnostics = [...earlyDiagnostics, { code: "cycle-time-budget", message: "The cycle time budget is exhausted." }];

    if (earlyDiagnostics.length > 0) {
      const result: PresentationToolResult<T> = { accepted: false, diagnostics: earlyDiagnostics };
      this.#patchChangeCount += attemptedPatchChangeCount;
      this.#recordCall(operation, callId, startedAtMs, requestBytes, jsonByteLength(result), attemptedPatchChangeCount, 0, result);
      if (earlyDiagnostics.some((diagnostic) => diagnostic.code === "cycle-time-budget")) this.#finish("timeout");
      return result;
    }

    const controller = new AbortController();
    const remainingCycleMs = this.#session.policy.maxCycleDurationMs - cycleElapsed;
    const timeoutMs = Math.min(this.#session.policy.maxCallDurationMs, remainingCycleMs);
    let timer: unknown;
    const timeout = new Promise<typeof TIMEOUT>((resolve) => {
      timer = this.#session.clock.setTimeout(() => {
        controller.abort();
        resolve(TIMEOUT);
      }, timeoutMs);
    });
    let worked: WorkResult<T> | typeof TIMEOUT;
    try {
      worked = await Promise.race([work(controller.signal), timeout]);
    } catch (cause) {
      if (controller.signal.aborted) worked = TIMEOUT;
      else {
        const result: PresentationToolResult<T> = { accepted: false, diagnostics: [{ code: operation === "render" ? "renderer-failed" : operation === "score" ? "score-failed" : "invalid-request", message: safeFailureMessage("Presentation tool call failed", cause) }] };
        this.#session.clock.clearTimeout(timer);
        this.#patchChangeCount += attemptedPatchChangeCount;
        this.#recordCall(operation, callId, startedAtMs, requestBytes, jsonByteLength(result), attemptedPatchChangeCount, 0, result, "error");
        return result;
      }
    } finally {
      this.#session.clock.clearTimeout(timer);
    }
    if (worked === TIMEOUT) {
      const cycleTimedOut = Math.max(0, this.#session.clock.now() - this.#startedAtMs) >= this.#session.policy.maxCycleDurationMs;
      const result: PresentationToolResult<T> = { accepted: false, diagnostics: [{ code: cycleTimedOut ? "cycle-time-budget" : "call-time-budget", message: cycleTimedOut ? "The cycle time budget was exceeded." : "The call time budget was exceeded." }] };
      this.#patchChangeCount += attemptedPatchChangeCount;
      this.#recordCall(operation, callId, startedAtMs, requestBytes, jsonByteLength(result), attemptedPatchChangeCount, 0, result, "timeout");
      if (cycleTimedOut) this.#finish("timeout");
      return result;
    }

    const rawResponseBytes = jsonByteLength(worked.result);
    this.#responseBytes += rawResponseBytes;
    let result = worked.result;
    if (rawResponseBytes > this.#session.policy.maxResponseBytes) {
      result = { accepted: false, diagnostics: [{ code: "response-size-limit", message: `Tool response is ${rawResponseBytes} bytes; limit is ${this.#session.policy.maxResponseBytes}.` }] };
    } else if (this.#responseBytes > this.#session.policy.maxCycleResponseBytes) {
      result = { accepted: false, diagnostics: [{ code: "response-size-limit", message: `Cycle response bytes exceed the limit of ${this.#session.policy.maxCycleResponseBytes}.` }] };
    }
    const endedAtMs = this.#session.clock.now();
    if (endedAtMs - startedAtMs > this.#session.policy.maxCallDurationMs) {
      result = { accepted: false, diagnostics: [{ code: "call-time-budget", message: "The call time budget was exceeded." }] };
    }
    if (endedAtMs - this.#startedAtMs > this.#session.policy.maxCycleDurationMs) {
      result = { accepted: false, diagnostics: [{ code: "cycle-time-budget", message: "The cycle time budget was exceeded." }] };
    }
    if (result.accepted && operation === "render" && isRecord(result.value) && typeof result.value.screenshotId === "string") {
      const candidateId = isRecord(request) && typeof request.candidateId === "string" ? request.candidateId : "";
      const collision = this.#session.rememberArtifact(
        result.value as unknown as CandidateScreenshot,
        candidateId,
        worked.candidatePatchIdentity ?? "",
      );
      if (collision) result = { accepted: false, diagnostics: [collision] };
    }
    const patchChangeCount = worked.patchChangeCount ?? 0;
    const patchFieldCount = worked.patchFieldCount ?? 0;
    this.#patchChangeCount += patchChangeCount;
    this.#recordCall(operation, callId, startedAtMs, requestBytes, rawResponseBytes, patchChangeCount, patchFieldCount, result);
    if (!result.accepted && result.diagnostics.some((diagnostic) => diagnostic.code === "cycle-time-budget")) this.#finish("timeout");
    return result;
  }

  #recordCall<T>(
    operation: PresentationToolOperation,
    callId: string,
    startedAtMs: number,
    requestBytes: number,
    responseBytes: number,
    patchChangeCount: number,
    patchFieldCount: number,
    result: PresentationToolResult<T>,
    forcedStatus?: PresentationCallTelemetry["status"],
  ): void {
    const endedAtMs = this.#session.clock.now();
    const diagnostics = result.accepted ? [] : result.diagnostics;
    const status = forcedStatus ?? (result.accepted
      ? "accepted"
      : diagnostics.some((diagnostic) => diagnostic.code === "call-time-budget" || diagnostic.code === "cycle-time-budget") ? "timeout" : "rejected");
    const output: PresentationCallTelemetry["output"] = {
      accepted: result.accepted,
      ...(!result.accepted ? { diagnosticCodes: diagnostics.map((diagnostic) => diagnostic.code) } : {}),
    };
    if (result.accepted && isRecord(result.value)) {
      if (typeof result.value.screenshotId === "string") output.screenshotId = result.value.screenshotId;
      if (typeof result.value.overall === "number") output.score = result.value.overall;
    }
    this.#session.telemetry.record(deepFreeze({
      kind: "call",
      sessionId: this.#session.sessionId,
      binding: clone(this.#session.index.binding),
      cycleId: this.cycleId,
      callId,
      operation,
      inputCache: classifyInputCache(this.#tokens),
      status,
      startedAtMs,
      endedAtMs,
      latencyMs: Math.max(0, endedAtMs - startedAtMs),
      requestBytes,
      responseBytes,
      patchChangeCount,
      patchFieldCount,
      output,
    } satisfies PresentationCallTelemetry));
  }

  #finish(status: PresentationCycleTelemetry["status"]): void {
    if (this.#ended) return;
    this.#ended = true;
    const endedAtMs = this.#session.clock.now();
    this.#session.telemetry.record(deepFreeze({
      kind: "cycle",
      sessionId: this.#session.sessionId,
      binding: clone(this.#session.index.binding),
      cycleId: this.cycleId,
      inputCache: classifyInputCache(this.#tokens),
      status,
      startedAtMs: this.#startedAtMs,
      endedAtMs,
      latencyMs: Math.max(0, endedAtMs - this.#startedAtMs),
      callCount: this.#callCount,
      requestBytes: this.#requestBytes,
      responseBytes: this.#responseBytes,
      patchChangeCount: this.#patchChangeCount,
      tokens: clone(this.#tokens),
    } satisfies PresentationCycleTelemetry));
  }
}

const TIMEOUT = Symbol("presentation-tool-timeout");

function parseSummaryRequest(value: unknown, index: PresentationSceneIndex): PresentationToolResult<{ binding: typeof index.binding; targetElementIds: string[] }> {
  const diagnostics: PresentationDiagnostic[] = [];
  const record = requireRecord(value, diagnostics, "");
  if (!record) return { accepted: false, diagnostics };
  rejectUnknownKeys(record, ["binding", "targetElementIds"], diagnostics, "");
  const binding = parseBinding(record.binding, diagnostics, "/binding");
  diagnostics.push(...bindingDiagnostics(binding, index.binding));
  const targetElementIds: string[] = [];
  if (!Array.isArray(record.targetElementIds)) diagnose(diagnostics, "invalid-value", "Expected a target element ID array.", "/targetElementIds");
  else record.targetElementIds.forEach((entry, itemIndex) => {
    const parsed = requiredString(entry, diagnostics, `/targetElementIds/${itemIndex}`, { opaque: true });
    if (parsed) targetElementIds.push(parsed);
  });
  return !binding || diagnostics.length > 0 ? { accepted: false, diagnostics } : { accepted: true, value: { binding, targetElementIds } };
}

function parseScoreRequest(value: unknown, index: PresentationSceneIndex): PresentationToolResult<CandidateScoreRequest> {
  const diagnostics: PresentationDiagnostic[] = [];
  const record = requireRecord(value, diagnostics, "");
  if (!record) return { accepted: false, diagnostics };
  rejectUnknownKeys(record, ["binding", "candidateId", "screenshotId", "referenceImageId", "rubricIds"], diagnostics, "");
  const binding = parseBinding(record.binding, diagnostics, "/binding");
  diagnostics.push(...bindingDiagnostics(binding, index.binding));
  const candidateId = requiredString(record.candidateId, diagnostics, "/candidateId", { opaque: true });
  const screenshotId = requiredString(record.screenshotId, diagnostics, "/screenshotId", { opaque: true });
  const referenceImageId = record.referenceImageId === undefined ? undefined : requiredString(record.referenceImageId, diagnostics, "/referenceImageId", { opaque: true });
  let rubricIds: string[] | undefined;
  if (record.rubricIds !== undefined) {
    if (!Array.isArray(record.rubricIds) || record.rubricIds.length > 100) diagnose(diagnostics, "invalid-value", "rubricIds must be an array with at most 100 entries.", "/rubricIds");
    else {
      rubricIds = [];
      const seen = new Set<string>();
      record.rubricIds.forEach((entry, itemIndex) => {
        const parsed = requiredString(entry, diagnostics, `/rubricIds/${itemIndex}`, { opaque: true });
        if (!parsed) return;
        if (seen.has(parsed)) diagnose(diagnostics, "invalid-value", `Duplicate rubric ID: ${parsed}`, `/rubricIds/${itemIndex}`);
        seen.add(parsed);
        rubricIds!.push(parsed);
      });
    }
  }
  if (!binding || !candidateId || !screenshotId || diagnostics.length > 0) return { accepted: false, diagnostics };
  return { accepted: true, value: { binding, candidateId, screenshotId, ...(referenceImageId ? { referenceImageId } : {}), ...(rubricIds ? { rubricIds } : {}) } };
}

function parseScreenshot(value: unknown): PresentationToolResult<CandidateScreenshot> {
  const diagnostics: PresentationDiagnostic[] = [];
  const record = requireRecord(value, diagnostics, "");
  if (!record) return { accepted: false, diagnostics: remapDiagnosticCode(diagnostics, "renderer-response-invalid") };
  rejectUnknownKeys(record, ["screenshotId", "mediaType", "width", "height", "renderFingerprint"], diagnostics, "");
  const screenshotId = requiredString(record.screenshotId, diagnostics, "/screenshotId", { opaque: true });
  const mediaType = oneOf(record.mediaType, ["image/png", "image/webp"] as const, diagnostics, "/mediaType");
  const width = integer(record.width, diagnostics, "/width", 1, 100_000);
  const height = integer(record.height, diagnostics, "/height", 1, 100_000);
  const renderFingerprint = record.renderFingerprint === undefined ? undefined : requiredString(record.renderFingerprint, diagnostics, "/renderFingerprint", { opaque: true });
  if (!screenshotId || !mediaType || width === undefined || height === undefined || diagnostics.length > 0) return { accepted: false, diagnostics: remapDiagnosticCode(diagnostics, "renderer-response-invalid") };
  return { accepted: true, value: deepFreeze({ screenshotId, mediaType, width, height, ...(renderFingerprint ? { renderFingerprint } : {}) }) };
}

function parseScore(value: unknown): PresentationToolResult<CandidateScore> {
  const diagnostics: PresentationDiagnostic[] = [];
  const record = requireRecord(value, diagnostics, "");
  if (!record) return { accepted: false, diagnostics: remapDiagnosticCode(diagnostics, "score-response-invalid") };
  rejectUnknownKeys(record, ["overall", "dimensions", "summary"], diagnostics, "");
  const overall = finiteNumber(record.overall, diagnostics, "/overall");
  if (overall !== undefined && (overall < 0 || overall > 100)) diagnose(diagnostics, "invalid-value", "overall must be from 0 to 100.", "/overall");
  let dimensions: Record<string, number> | undefined;
  if (record.dimensions !== undefined) {
    const entries = requireRecord(record.dimensions, diagnostics, "/dimensions");
    if (entries) {
      if (Object.keys(entries).length > 100) diagnose(diagnostics, "invalid-value", "At most 100 score dimensions are accepted.", "/dimensions");
      dimensions = {};
      for (const [key, entry] of Object.entries(entries)) {
        const validKey = requiredString(key, diagnostics, `/dimensions/${key}`, { opaque: true });
        const score = finiteNumber(entry, diagnostics, `/dimensions/${key}`);
        if (score !== undefined && (score < 0 || score > 100)) diagnose(diagnostics, "invalid-value", "Dimension score must be from 0 to 100.", `/dimensions/${key}`);
        else if (validKey && score !== undefined) dimensions[validKey] = score;
      }
    }
  }
  const summary = record.summary === undefined ? undefined : requiredString(record.summary, diagnostics, "/summary", { maxLength: 2000 });
  if (overall === undefined || diagnostics.length > 0) return { accepted: false, diagnostics: remapDiagnosticCode(diagnostics, "score-response-invalid") };
  return { accepted: true, value: deepFreeze({ overall, ...(dimensions ? { dimensions } : {}), ...(summary ? { summary } : {}) }) };
}

function remapDiagnosticCode(
  diagnostics: PresentationDiagnostic[],
  code: "renderer-response-invalid" | "score-response-invalid",
): PresentationDiagnostic[] {
  return diagnostics.map((diagnostic) => ({ ...diagnostic, code }));
}

function parseTokens(value: unknown, diagnostics: PresentationDiagnostic[], path: string): PresentationTokenUsage | undefined {
  const record = requireRecord(value, diagnostics, path);
  if (!record) return undefined;
  const keys = ["inputTokens", "cachedInputTokens", "outputTokens", "reasoningTokens"] as const;
  rejectUnknownKeys(record, keys, diagnostics, path);
  const parsed = Object.fromEntries(keys.map((key) => [key, integer(record[key], diagnostics, `${path}/${key}`, 0)])) as Record<typeof keys[number], number | undefined>;
  if (Object.values(parsed).some((entry) => entry === undefined)) return undefined;
  if (parsed.cachedInputTokens! > parsed.inputTokens!) diagnose(diagnostics, "invalid-value", "cachedInputTokens cannot exceed inputTokens.", `${path}/cachedInputTokens`);
  if (parsed.reasoningTokens! > parsed.outputTokens!) diagnose(diagnostics, "invalid-value", "reasoningTokens cannot exceed outputTokens.", `${path}/reasoningTokens`);
  return {
    inputTokens: parsed.inputTokens!, cachedInputTokens: parsed.cachedInputTokens!,
    outputTokens: parsed.outputTokens!, reasoningTokens: parsed.reasoningTokens!,
  };
}

function tokenBudgetDiagnostics(tokens: PresentationTokenUsage, policy: PresentationToolPolicy): PresentationDiagnostic[] {
  const diagnostics: PresentationDiagnostic[] = [];
  const budget = policy.tokens;
  if (tokens.inputTokens > budget.maxInputTokens) diagnose(diagnostics, "token-budget-exceeded", "Input token budget exceeded.", "/cycle/tokens/inputTokens");
  if (tokens.cachedInputTokens > budget.maxCachedInputTokens) diagnose(diagnostics, "token-budget-exceeded", "Cached input token budget exceeded.", "/cycle/tokens/cachedInputTokens");
  if (tokens.outputTokens > budget.maxOutputTokens) diagnose(diagnostics, "token-budget-exceeded", "Output token budget exceeded.", "/cycle/tokens/outputTokens");
  if (tokens.reasoningTokens > budget.maxReasoningTokens) diagnose(diagnostics, "token-budget-exceeded", "Reasoning token budget exceeded.", "/cycle/tokens/reasoningTokens");
  if (tokens.inputTokens + tokens.outputTokens > budget.maxTotalTokens) diagnose(diagnostics, "token-budget-exceeded", "Total token budget exceeded.", "/cycle/tokens");
  return diagnostics;
}

function addTokens(left: PresentationTokenUsage, right: PresentationTokenUsage): PresentationTokenUsage {
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    cachedInputTokens: left.cachedInputTokens + right.cachedInputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    reasoningTokens: left.reasoningTokens + right.reasoningTokens,
  };
}

function emptyTokens(): PresentationTokenUsage {
  return { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0 };
}

export function classifyInputCache(tokens: PresentationTokenUsage): PresentationInputCacheClass {
  if (tokens.inputTokens === 0) return "none";
  if (tokens.cachedInputTokens === 0) return "miss";
  if (tokens.cachedInputTokens === tokens.inputTokens) return "hit";
  return "partial";
}

function candidateChangeCount(value: unknown): number {
  return isRecord(value) && Array.isArray(value.changes) ? value.changes.length : 0;
}

function safeFailureMessage(prefix: string, cause: unknown): string {
  // Adapter exceptions may contain signed URLs, credentials, or engine-local
  // paths. Those details belong in host-private logs, not the tool response.
  void cause;
  return `${prefix}.`;
}
