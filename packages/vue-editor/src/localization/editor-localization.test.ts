import { describe, expect, it } from "vitest";

import {
  createStaticEditorLocalization,
  editorMessages,
  translateEditorMessage,
} from "./editor-localization";

describe("editor localization", () => {
  it("keeps English and Japanese dictionaries on the same stable key contract", () => {
    expect(Object.keys(editorMessages.ja).sort()).toEqual(Object.keys(editorMessages.en).sort());
  });

  it("uses English as the standalone default and interpolates named parameters", () => {
    const localization = createStaticEditorLocalization("en");

    expect(localization.t("locale.control.label")).toBe("Editor language");
    expect(localization.t("common.selectedCount", { count: 3 })).toBe("3 selected");
    expect(localization.semanticLocales.value).toEqual(["en"]);
  });

  it("keeps semantic locale preferences independent from the UI locale", () => {
    const localization = createStaticEditorLocalization("ja", ["en", "ja"]);

    expect(translateEditorMessage("ja", "locale.control.label")).toBe("エディタの表示言語");
    expect(localization.semanticLocales.value).toEqual(["en", "ja"]);
  });

  it("formats lists and parenthetical details with locale-appropriate punctuation", () => {
    const english = createStaticEditorLocalization("en");
    const japanese = createStaticEditorLocalization("ja");

    expect(["Left", "Right"].join(english.t("common.listSeparator"))).toBe("Left, Right");
    expect(["左", "右"].join(japanese.t("common.listSeparator"))).toBe("左、右");
    expect(english.t("common.actionDetail", { action: "Fix", detail: "code" })).toBe("Fix (code)");
    expect(japanese.t("common.actionDetail", { action: "修正", detail: "コード" })).toBe("修正（コード）");
    expect(english.t("editor.profileChoice", { label: "Standard", purpose: "Flow" })).toBe("Standard (Flow)");
    expect(japanese.t("editor.profileChoice", { label: "標準", purpose: "フロー" })).toBe("標準（フロー）");
  });
});
