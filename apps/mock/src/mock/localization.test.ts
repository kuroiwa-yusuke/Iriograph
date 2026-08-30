import { describe, expect, it } from "vitest";

import { translateMockMessage } from "./localization";

describe("mock localization", () => {
  it("defaults are authored in English and Japanese uses the same stable key", () => {
    expect(translateMockMessage("en", "save")).toBe("Save");
    expect(translateMockMessage("ja", "save")).toBe("保存");
    expect(translateMockMessage("en", "errors", { count: 2 })).toBe("2 errors");
    expect(translateMockMessage("ja", "errors", { count: 2 })).toBe("2件のエラー");
  });
});
