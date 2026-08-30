import { describe, expect, it } from "vitest";
import type { IriographDocumentV1 } from "@iriograph/core";
import { SemanticAccessIndex } from "@iriograph/semantic-access";
import {
  classifyAgentRequest,
  ExternalCandidateReviewSession,
  semanticReview,
  type SemanticCandidatePayload,
} from "./index.js";

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

  it("uses English preview fallbacks by default and the existing locale for Japanese", () => {
    const document: IriographDocumentV1 = {
      schemaVersion: "1",
      kind: "iriograph.document",
      documentId: "agent-review-fallbacks",
      semantic: {
        format: "text/turtle",
        baseIri: "urn:test:agent-review:",
        authoringProfileRef: "urn:test:authoring-profile@1",
        source: "@prefix : <urn:test:agent-review:> .",
      },
      views: [],
    };
    const index = new SemanticAccessIndex(document, "d1", { locales: ["en"] });
    const candidate: SemanticCandidatePayload = {
      candidateId: "fallback-candidate",
      documentRevision: "d1",
      contextRevision: "c1",
      patch: {
        added: [{
          statementRef: "urn:test:statement:new",
          subject: { termType: "BlankNode", value: "new-subject" },
          predicateIri: "urn:test:agent-review:new-predicate",
          object: { termType: "NamedNode", value: "urn:test:agent-review:new-object" },
        }],
        removed: [],
      },
      diagnostics: [],
    };

    expect(semanticReview(candidate, index).added[0]).toMatchObject({
      subject: "New anonymous element",
      predicate: "New relationship",
      object: "New element",
    });
    expect(semanticReview(candidate, index, "ja-JP").added[0]).toMatchObject({
      subject: "新しい匿名要素",
      predicate: "新しい関係",
      object: "新しい要素",
    });
  });
});
