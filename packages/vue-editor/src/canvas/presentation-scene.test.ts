import { describe, expect, it } from "vitest";

import type { DiagramScene, ProjectedScene } from "@iriograph/core";

import { reconcilePresentationScene } from "./presentation-scene";

describe("presentation scene reconciliation", () => {
  it("overlay-only変更で以前の全体layout diagnosticを再掲しない", () => {
    const current: DiagramScene = {
      viewId: "main",
      width: 640,
      height: 480,
      nodes: [],
      containers: [],
      regions: [],
      memberships: [],
      edges: [],
      diagnostics: [{
        severity: "warning",
        category: "layout",
        code: "region-member-outside",
        message: "既存の領域配置警告",
        semanticRef: "node-a",
      }, {
        severity: "warning",
        category: "domain",
        code: "domain-review",
        message: "意味上の確認事項",
        semanticRef: "urn:test:a",
      }],
    };
    const projected: ProjectedScene = {
      viewId: "main",
      nodes: [],
      containers: [],
      regions: [],
      memberships: [],
      edges: [],
      diagnostics: [{
        severity: "warning",
        category: "domain",
        code: "domain-review",
        message: "意味上の確認事項",
        semanticRef: "urn:test:a",
      }],
    };

    const result = reconcilePresentationScene(current, projected);

    expect(result.diagnostics).toEqual([expect.objectContaining({ code: "domain-review" })]);
    expect(result.diagnostics.some((diagnostic) => diagnostic.category === "layout")).toBe(false);
  });
});
