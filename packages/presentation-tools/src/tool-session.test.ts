import { describe, expect, it, vi } from "vitest";
import {
  PresentationSceneIndex,
  PresentationToolSession,
  type CandidateRenderInput,
  type PresentationTelemetryEvent,
} from "./index.js";
import { capabilities, policy, scene } from "./test-helpers.js";

function candidate(index: PresentationSceneIndex) {
  return {
    binding: index.binding,
    candidateId: "candidate-1",
    changes: [{ elementId: "node-1", geometry: { x: 200, y: 120, width: 160, height: 72 } }],
  };
}

function tokens(inputTokens = 100, cachedInputTokens = 60) {
  return { inputTokens, cachedInputTokens, outputTokens: 20, reasoningTokens: 5 };
}

describe("presentation render/score session", () => {
  it("passes only validated render input, binds score artifacts, and audits every call/cycle", async () => {
    const events: PresentationTelemetryEvent[] = [];
    const renderInputs: CandidateRenderInput[] = [];
    const index = new PresentationSceneIndex(scene());
    const session = new PresentationToolSession({
      sessionId: "session-main",
      index,
      capabilities: capabilities(),
      policy: policy(),
      telemetry: { record: (event) => events.push(event) },
      renderer: {
        render: async (input) => {
          renderInputs.push(structuredClone(input));
          return { screenshotId: "shot-1", mediaType: "image/png", width: 1000, height: 700, renderFingerprint: "abcdef" };
        },
      },
      scorer: {
        score: async () => ({ overall: 84, dimensions: { geometry: 90, structure: 100 }, summary: "Close match" }),
      },
    });
    const opened = session.beginCycle({ cycleId: "cycle-1", tokens: tokens() });
    expect(opened.accepted).toBe(true);
    if (!opened.accepted) return;
    const summary = await opened.value.summary("call-summary", { binding: index.binding, targetElementIds: ["node-1"] });
    const rendered = await opened.value.render("call-render", candidate(index));
    expect(summary.accepted).toBe(true);
    expect(rendered).toMatchObject({ accepted: true, value: { screenshotId: "shot-1" } });
    const scored = await opened.value.score("call-score", {
      binding: index.binding,
      candidateId: "candidate-1",
      screenshotId: "shot-1",
      referenceImageId: "reference-1",
      rubricIds: ["geometry", "structure"],
    });
    expect(scored).toMatchObject({ accepted: true, value: { overall: 84 } });
    opened.value.finish("completed");

    expect(renderInputs).toHaveLength(1);
    expect(renderInputs[0]?.diff.items).toHaveLength(1);
    expect(JSON.stringify(renderInputs[0])).not.toMatch(/semanticRef|turtle|https?:|assetBytes|iconUrl/i);
    const calls = events.filter((event) => event.kind === "call");
    expect(calls.map((event) => event.operation)).toEqual(["summary", "render", "score"]);
    expect(calls.every((event) => event.sessionId === "session-main"
      && event.binding.documentRevision === "doc-r1"
      && event.binding.contextRevision === "ctx-r1")).toBe(true);
    expect(calls.every((event) => event.inputCache === "partial")).toBe(true);
    expect(calls[1]).toMatchObject({ status: "accepted", patchChangeCount: 1, patchFieldCount: 1, output: { screenshotId: "shot-1" } });
    expect(calls[2]).toMatchObject({ output: { score: 84 } });
    expect(events.at(-1)).toMatchObject({ kind: "cycle", status: "completed", callCount: 3, patchChangeCount: 1, inputCache: "partial" });
  });

  it("rejects renderer URLs/bytes and never registers an invalid screenshot", async () => {
    const events: PresentationTelemetryEvent[] = [];
    const index = new PresentationSceneIndex(scene());
    const session = new PresentationToolSession({
      sessionId: "session-unsafe",
      index,
      capabilities: capabilities(),
      policy: policy(),
      telemetry: { record: (event) => events.push(event) },
      renderer: {
        render: async () => ({
          screenshotId: "shot-unsafe",
          mediaType: "image/png",
          width: 100,
          height: 100,
          url: "https://example.invalid/shot.png",
          bytes: new Uint8Array([1, 2, 3]),
        } as never),
      },
      scorer: { score: async () => ({ overall: 100 }) },
    });
    const opened = session.beginCycle({ cycleId: "cycle-unsafe", tokens: tokens() });
    if (!opened.accepted) throw new Error("cycle should open");
    const rendered = await opened.value.render("call-render", candidate(index));
    expect(rendered).toMatchObject({ accepted: false, diagnostics: expect.arrayContaining([expect.objectContaining({ code: "renderer-response-invalid" })]) });
    const scored = await opened.value.score("call-score", {
      binding: index.binding,
      candidateId: "candidate-1",
      screenshotId: "shot-unsafe",
    });
    expect(scored).toMatchObject({ accepted: false, diagnostics: [{ code: "artifact-mismatch" }] });
    opened.value.finish("rejected");
  });

  it("rejects stale and arbitrary score references before invoking the scorer", async () => {
    const score = vi.fn(async () => ({ overall: 50 }));
    const index = new PresentationSceneIndex(scene());
    const session = new PresentationToolSession({
      sessionId: "session-score",
      index,
      capabilities: capabilities(),
      policy: policy(),
      telemetry: { record: () => undefined },
      scorer: { score },
    });
    const opened = session.beginCycle({ cycleId: "cycle-score", tokens: tokens() });
    if (!opened.accepted) throw new Error("cycle should open");
    expect(await opened.value.score("call-url", {
      binding: index.binding,
      candidateId: "candidate-1",
      screenshotId: "https://example.invalid/shot.png",
    })).toMatchObject({ accepted: false, diagnostics: expect.arrayContaining([expect.objectContaining({ code: "unsafe-value" })]) });
    expect(await opened.value.score("call-stale", {
      binding: { ...index.binding, contextRevision: "old" },
      candidateId: "candidate-1",
      screenshotId: "shot-1",
    })).toMatchObject({ accepted: false, diagnostics: expect.arrayContaining([expect.objectContaining({ code: "stale-context-revision" })]) });
    expect(score).not.toHaveBeenCalled();
    opened.value.finish("rejected");
  });

  it("enforces cumulative token budgets and emits rejected cycle telemetry", () => {
    const events: PresentationTelemetryEvent[] = [];
    const index = new PresentationSceneIndex(scene());
    const session = new PresentationToolSession({
      sessionId: "session-tokens",
      index,
      capabilities: capabilities(),
      policy: policy({ tokens: {
        maxInputTokens: 10,
        maxCachedInputTokens: 10,
        maxOutputTokens: 10,
        maxReasoningTokens: 10,
        maxTotalTokens: 20,
      } }),
      telemetry: { record: (event) => events.push(event) },
    });
    const first = session.beginCycle({ cycleId: "cycle-a", tokens: { inputTokens: 6, cachedInputTokens: 6, outputTokens: 2, reasoningTokens: 1 } });
    expect(first.accepted).toBe(true);
    if (first.accepted) first.value.finish();
    const second = session.beginCycle({ cycleId: "cycle-b", tokens: { inputTokens: 5, cachedInputTokens: 0, outputTokens: 1, reasoningTokens: 0 } });
    expect(second).toMatchObject({ accepted: false, diagnostics: expect.arrayContaining([expect.objectContaining({ code: "token-budget-exceeded" })]) });
    expect(events.at(-1)).toMatchObject({ kind: "cycle", cycleId: "cycle-b", status: "rejected", inputCache: "miss" });
  });

  it("aborts over-time render calls, audits timeout, and does not make the artifact scoreable", async () => {
    const events: PresentationTelemetryEvent[] = [];
    const index = new PresentationSceneIndex(scene());
    const session = new PresentationToolSession({
      sessionId: "session-time",
      index,
      capabilities: capabilities(),
      policy: policy({ maxCallDurationMs: 5, maxCycleDurationMs: 100 }),
      telemetry: { record: (event) => events.push(event) },
      renderer: {
        render: async (_input, signal) => new Promise((resolve, reject) => {
          const timer = setTimeout(() => resolve({ screenshotId: "late-shot", mediaType: "image/png", width: 10, height: 10 }), 100);
          signal.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(new Error("aborted"));
          }, { once: true });
        }),
      },
      scorer: { score: async () => ({ overall: 100 }) },
    });
    const opened = session.beginCycle({ cycleId: "cycle-time", tokens: tokens() });
    if (!opened.accepted) throw new Error("cycle should open");
    const rendered = await opened.value.render("call-time", candidate(index));
    expect(rendered).toMatchObject({ accepted: false, diagnostics: [{ code: "call-time-budget" }] });
    expect(await opened.value.score("call-score", {
      binding: index.binding,
      candidateId: "candidate-1",
      screenshotId: "late-shot",
    })).toMatchObject({ accepted: false, diagnostics: [{ code: "artifact-mismatch" }] });
    expect(events.find((event) => event.kind === "call" && event.callId === "call-time"))
      .toMatchObject({ status: "timeout", operation: "render" });
    opened.value.finish("rejected");
  });

  it("enforces request and response byte limits before exposing output", async () => {
    const index = new PresentationSceneIndex(scene());
    const requestSession = new PresentationToolSession({
      sessionId: "session-request",
      index,
      capabilities: capabilities(),
      policy: policy({ maxRequestBytes: 100, maxCycleRequestBytes: 200 }),
      telemetry: { record: () => undefined },
    });
    const requestCycle = requestSession.beginCycle({ cycleId: "cycle-request", tokens: tokens() });
    if (!requestCycle.accepted) throw new Error("cycle should open");
    expect(await requestCycle.value.validate("call-request", candidate(index)))
      .toMatchObject({ accepted: false, diagnostics: [{ code: "request-size-limit" }] });
    requestCycle.value.finish("rejected");

    const responseSession = new PresentationToolSession({
      sessionId: "session-response",
      index,
      capabilities: capabilities(),
      policy: policy({ maxResponseBytes: 100, maxCycleResponseBytes: 200 }),
      telemetry: { record: () => undefined },
    });
    const responseCycle = responseSession.beginCycle({ cycleId: "cycle-response", tokens: tokens() });
    if (!responseCycle.accepted) throw new Error("cycle should open");
    expect(await responseCycle.value.summary("call-response", { binding: index.binding, targetElementIds: ["node-1"] }))
      .toMatchObject({ accepted: false, diagnostics: [{ code: "response-size-limit" }] });
    responseCycle.value.finish("rejected");
  });
});
