import { describe, expect, it } from "vitest";

import { diagnosticGuidance } from "./diagnostic-guidance";

describe("diagnostic guidance", () => {
  it("term minting errorをユーザーの次actionへ翻訳する", () => {
    const guidance = diagnosticGuidance({
      severity: "error",
      code: "term-minting-denied",
      message: "Semantic term minting is denied: urn:test:Class",
    });
    expect(guidance).toMatchObject({
      title: "この図では新しい種類を作成できません",
      action: expect.stringContaining("基本の要素"),
      detail: "診断コード: term-minting-denied",
    });
    expect(Object.values(guidance).join(" ")).not.toContain("urn:test:Class");
  });

  it("既知・未知codeとも内部IRIを含むmessageをpresentationへ渡さない", () => {
    const unknown = diagnosticGuidance({
      severity: "error",
      code: "custom",
      message: "profile urn:test:profile and https://example.test/catalog",
      semanticRef: "urn:test:secret",
      jsonPointer: "/views/0/overlay/urn:test:secret",
    });
    expect(unknown).toMatchObject({
      title: "変更を適用できません",
      detail: "Document JSON 対象項目（コード: custom）",
    });
    expect(Object.values(unknown).join(" ")).not.toMatch(/urn:|https?:\/\//u);

    const known = diagnosticGuidance({
      severity: "error",
      code: "resource-namespace-denied",
      message: "Denied namespace urn:test:private",
      catalogRef: "https://example.test/catalog",
    });
    expect(Object.values(known).join(" ")).not.toMatch(/urn:|https?:\/\//u);
  });

  it("source位置と安全なJSON Pointerだけを修正案内に使う", () => {
    expect(diagnosticGuidance({
      severity: "error",
      category: "syntax",
      code: "turtle-syntax",
      message: "bad token urn:test:secret",
      sourceLocation: {
        startOffset: 10,
        endOffset: 11,
        startLine: 3,
        startColumn: 8,
        endLine: 3,
        endColumn: 9,
      },
    }).detail).toBe("Source 3行 8列付近（コード: turtle-syntax）");
    expect(diagnosticGuidance({
      severity: "error",
      code: "document-json-invalid",
      message: "raw",
      jsonPointer: "/views/0/layoutRef",
    }).detail).toBe("Document JSON /views/0/layoutRef（コード: document-json-invalid）");
  });
});
