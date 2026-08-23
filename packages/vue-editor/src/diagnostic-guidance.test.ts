import { describe, expect, it } from "vitest";

import { diagnosticGuidance } from "./diagnostic-guidance";

describe("diagnostic guidance", () => {
  it("term minting errorをユーザーの次actionへ翻訳する", () => {
    expect(diagnosticGuidance({
      severity: "error",
      code: "term-minting-denied",
      message: "Semantic term minting is denied: urn:test:Class",
    })).toMatchObject({
      title: "この図では新しい種類を作成できません",
      action: expect.stringContaining("基本の要素"),
      detail: expect.stringContaining("urn:test:Class"),
    });
  });

  it("未知codeもaction付きで表示する", () => {
    expect(diagnosticGuidance({ severity: "error", code: "custom", message: "raw" }))
      .toMatchObject({ title: "変更を適用できません", detail: "raw" });
  });
});
