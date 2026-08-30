import { describe, expect, it } from "vitest";

import { contextActionsFor } from "./context-actions";
import { translateEditorMessage } from "../localization/editor-localization";

describe("context actions", () => {
  it("右クリック用のlegacy actionは対象ごとのビュー編集だけを提供する", () => {
    expect(contextActionsFor("node", false)).toEqual([
      { id: "edit-appearance", label: "Edit view", disabled: false },
    ]);
    expect(contextActionsFor("edge", false)).toEqual([
      { id: "edit-appearance", label: "Edit line view", disabled: false },
    ]);
    expect(contextActionsFor("region", false)).toEqual([
      { id: "edit-appearance", label: "Edit region view", disabled: false },
    ]);
    expect(contextActionsFor("blank", false)).toEqual([]);
  });

  it("readOnlyではビュー編集を無効にする", () => {
    expect(contextActionsFor("edge", true)).toEqual([
      { id: "edit-appearance", label: "Edit line view", disabled: true },
    ]);
    expect(contextActionsFor("edge", true, (key, parameters) => (
      translateEditorMessage("ja", key, parameters)
    ))).toEqual([
      { id: "edit-appearance", label: "線のビューを編集", disabled: true },
    ]);
  });
});
