import { describe, expect, it } from "vitest";

import { contextActionsFor } from "./context-actions";

describe("context actions", () => {
  it("利用者語彙でtarget別actionを決定する", () => {
    expect(contextActionsFor("node", false).map((item) => item.label)).toEqual([
      "名前を編集",
      "詳細・属性を編集",
      "この要素から関係を作成",
      "領域へ含める",
      "見た目を調整",
      "要素を削除…",
    ]);
    expect(contextActionsFor("edge", false).map((item) => item.label)).toContain("関係を削除…");
    expect(contextActionsFor("region", false).map((item) => item.label)).toContain("この領域へ要素を追加");
    expect(contextActionsFor("blank", false).map((item) => item.label)).toEqual([
      "新しい要素を置く",
      "新しい領域を置く",
    ]);
  });

  it("readOnlyでは閲覧actionだけを残してwrite actionを無効にする", () => {
    expect(contextActionsFor("edge", true)).toEqual([
      expect.objectContaining({ id: "inspect-edge", disabled: undefined }),
      expect.objectContaining({ id: "edit-endpoints", disabled: true }),
      expect.objectContaining({ id: "edit-routing", disabled: true }),
      expect.objectContaining({ id: "delete-relation", disabled: true }),
    ]);
  });
});
