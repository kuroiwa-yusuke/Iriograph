import { describe, expect, it } from "vitest";
import { classifyAgentRequest, ExternalCandidateReviewSession } from "./index.js";

describe("agent request routing", () => {
  it("separates semantic, presentation and mixed concerns without granting authority", () => {
    expect(classifyAgentRequest("関係を追加して").route).toBe("semantic");
    expect(classifyAgentRequest("色と位置を変えて").route).toBe("presentation");
    const mixed = classifyAgentRequest("所属を追加して位置も整えて");
    expect(mixed.route).toBe("mixed");
    expect(mixed.authoritative).toBe(false);
  });
});

describe("external candidate review", () => {
  it("consumes semantic and presentation confirmations independently", () => {
    const session = new ExternalCandidateReviewSession();
    session.add({
      reviewId: "review-1",
      source: "llm",
      semantic: {
        candidateId: "semantic-1", documentRevision: "d1", contextRevision: "c1",
        added: [], removed: [], diagnostics: [],
      },
      presentation: {
        candidateId: "presentation-1", documentRevision: "d1", contextRevision: "c1",
        sceneRevision: "s1", patch: {}, changedElementLabels: [], diagnostics: [],
      },
    });
    expect(session.take("review-1", "semantic", { documentRevision: "d1", contextRevision: "c1" }))
      .toMatchObject({ candidateId: "semantic-1" });
    expect(session.get("review-1")?.presentation?.candidateId).toBe("presentation-1");
    expect(session.get("review-1")?.semantic).toBeUndefined();
    expect(() => session.take("review-1", "presentation", {
      documentRevision: "stale", contextRevision: "c1",
    })).toThrow("stale");
  });
});
