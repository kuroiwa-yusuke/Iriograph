import { describe, expect, it } from "vitest";

import { contextActionsFor } from "./context-actions";

describe("context actions", () => {
  it("右クリック用のlegacy actionは対象ごとのビュー編集だけを提供する", () => {
    expect(contextActionsFor("node", false)).toEqual([
      { id: "edit-appearance", label: "ビューを編集", disabled: false },
    ]);
    expect(contextActionsFor("edge", false)).toEqual([
      { id: "edit-appearance", label: "線のビューを編集", disabled: false },
    ]);
    expect(contextActionsFor("region", false)).toEqual([
      { id: "edit-appearance", label: "領域のビューを編集", disabled: false },
    ]);
    expect(contextActionsFor("blank", false)).toEqual([]);
  });

  it("readOnlyではビュー編集を無効にする", () => {
    expect(contextActionsFor("edge", true)).toEqual([
      { id: "edit-appearance", label: "線のビューを編集", disabled: true },
    ]);
  });
});
