import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import ExternalCandidateReviewPanel from "./ExternalCandidateReviewPanel.vue";

describe("ExternalCandidateReviewPanel", () => {
  it("keeps semantic and presentation decisions independent", async () => {
    const wrapper = mount(ExternalCandidateReviewPanel, {
      props: {
        review: {
          reviewId: "review-1",
          source: "llm",
          semantic: {
            candidateId: "s1", documentRevision: "d1", contextRevision: "c1",
            added: [{ statementId: "x", subject: "注文", predicate: "次の工程", object: "支払" }],
            removed: [], diagnostics: [],
          },
          presentation: {
            candidateId: "p1", documentRevision: "d1", contextRevision: "c1", sceneRevision: "v1",
            patch: {}, changedElementLabels: ["注文"], diagnostics: [],
          },
        },
      },
    });
    expect(wrapper.get("h3").text()).toBe("Review semantics and view separately");
    expect(wrapper.text()).toContain("注文");
    expect(wrapper.text()).not.toContain("urn:");
    await wrapper.get('[data-review-kind="semantic"] .is-primary').trigger("click");
    expect(wrapper.emitted("apply")?.[0]).toEqual([{ reviewId: "review-1", kind: "semantic" }]);
    await wrapper.get('[data-review-kind="presentation"] button').trigger("click");
    expect(wrapper.emitted("reject")?.[0]).toEqual([{ reviewId: "review-1", kind: "presentation" }]);

    await wrapper.setProps({ uiLocale: "ja" });
    expect(wrapper.get("h3").text()).toBe("意味とビューを別々に確認");
    expect(wrapper.text()).toContain("注文");
  });
});
