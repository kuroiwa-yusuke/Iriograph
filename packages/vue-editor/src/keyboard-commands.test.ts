import { describe, expect, it } from "vitest";

import { resolveCanvasKeyboardCommand } from "./keyboard-commands";

const base = {
  key: "ArrowRight",
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  isComposing: false,
};

describe("canvas keyboard commands", () => {
  it("secondary edit、primary edit、range、focusの優先順位を固定する", () => {
    expect(resolveCanvasKeyboardCommand({ ...base, ctrlKey: true, shiftKey: true }).kind)
      .toBe("presentation-secondary");
    expect(resolveCanvasKeyboardCommand({ ...base, metaKey: true }).kind)
      .toBe("presentation-primary");
    expect(resolveCanvasKeyboardCommand({ ...base, shiftKey: true })).toEqual({
      kind: "focus",
      movement: "next",
      range: true,
    });
    expect(resolveCanvasKeyboardCommand(base)).toEqual({
      kind: "focus",
      movement: "next",
      range: false,
    });
  });

  it("IME compositionとeditable targetではcommandを解決しない", () => {
    expect(resolveCanvasKeyboardCommand({ ...base, isComposing: true }).kind).toBe("none");
    expect(resolveCanvasKeyboardCommand(base, { compositionActive: true }).kind).toBe("none");
    expect(resolveCanvasKeyboardCommand(base, { editableTarget: true }).kind).toBe("none");
  });

  it("W/Insert追加とcommand+Backspace削除をportableに解決する", () => {
    expect(resolveCanvasKeyboardCommand({ ...base, key: "w" }).kind).toBe("waypoint-add");
    expect(resolveCanvasKeyboardCommand({ ...base, key: "W", shiftKey: true }).kind).toBe("waypoint-add");
    expect(resolveCanvasKeyboardCommand({ ...base, key: "Insert" }).kind).toBe("waypoint-add");
    expect(resolveCanvasKeyboardCommand({ ...base, key: "Backspace", ctrlKey: true }).kind)
      .toBe("waypoint-remove");
    expect(resolveCanvasKeyboardCommand({ ...base, key: "[" })).toEqual({
      kind: "waypoint-focus",
      movement: "previous",
    });
    expect(resolveCanvasKeyboardCommand({ ...base, key: "." })).toEqual({
      kind: "waypoint-focus",
      movement: "next",
    });
  });

  it("修飾なしDelete/Backspaceを選択中の意味削除として解決する", () => {
    expect(resolveCanvasKeyboardCommand({ ...base, key: "Delete" }).kind).toBe("semantic-edit");
    expect(resolveCanvasKeyboardCommand({ ...base, key: "Backspace" }).kind).toBe("semantic-edit");
  });
});
