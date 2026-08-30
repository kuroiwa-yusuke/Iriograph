import { describe, expect, it } from "vitest";

import {
  chooseTargetContextMenuEntry,
  closeTargetContextMenu,
  isTargetContextMenuKeyboardTrigger,
  moveTargetContextMenuActiveEntry,
  openTargetContextMenu,
  targetContextMenuAnchor,
  targetContextMenuEntries,
  type TargetContextMenuEntry,
  type TargetContextSubject,
} from "./target-context-menu";
import { translateEditorMessage } from "../localization/editor-localization";

describe("target context menu", () => {
  it.each<[TargetContextSubject, readonly string[]]>([
    [{ kind: "blank" }, ["add-element", "paste"]],
    [{ kind: "node", elementId: "node-1" }, [
      "element-details", "create-relation", "edit-membership", "element-view", "element-icon", "delete-element",
    ]],
    [{ kind: "direct-edge", elementId: "edge-1" }, [
      "relation-details", "reconnect-relation", "relation-view", "reset-route", "delete-relation",
    ]],
    [{ kind: "derived-sequence-guide", elementId: "guide-1", groupElementId: "seq-1" }, ["edit-sequence"]],
    [{ kind: "derived-alternative-guide", elementId: "guide-2", groupElementId: "alt-1" }, ["edit-alternatives"]],
    [{ kind: "classification-group", elementId: "class-1" }, groupActions("edit-membership")],
    [{ kind: "membership-group", elementId: "bag-1" }, groupActions("edit-membership")],
    [{ kind: "sequence-group", elementId: "seq-1" }, groupActions("edit-sequence")],
    [{ kind: "alternative-group", elementId: "alt-1" }, groupActions("edit-alternatives")],
  ])("対象ごとのactionだけをlabel-firstで返す: %o", (target, actionIds) => {
    const entries = targetContextMenuEntries(target, {
      clipboardHasSupportedContent: true,
      hasManualRoute: true,
      hasGroupMembers: true,
    });
    expect(entries.map((entry) => entry.actionId)).toEqual(actionIds);
    expect(entries.every((entry) => entry.label.length > 0)).toBe(true);
    expect(JSON.stringify(entries).toLowerCase()).not.toContain("iri");
  });

  it("derived guideは線自体を変更せず所有groupの構造editorへ委譲する", () => {
    const sequence = targetContextMenuEntries({
      kind: "derived-sequence-guide",
      elementId: "derived-line",
      groupElementId: "seq-group",
    });
    expect(sequence).toEqual([expect.objectContaining({
      actionId: "edit-sequence",
      destination: {
        surface: "semantic-flow",
        intent: "edit-relation",
        elementId: "seq-group",
        section: "sequence",
      },
    })]);

    const alternative = targetContextMenuEntries({
      kind: "derived-alternative-guide",
      elementId: "derived-choice",
      groupElementId: "alt-group",
    });
    expect(alternative[0]).toMatchObject({
      label: "Edit alternative group",
      destination: { elementId: "alt-group", section: "alternatives" },
    });
  });

  it("readOnly・clipboard・route・空group・z-order・削除理由をaction単位で示す", () => {
    const blank = targetContextMenuEntries({ kind: "blank" });
    expect(reason(blank, "paste")).toContain("clipboard");

    const edge = targetContextMenuEntries({ kind: "direct-edge", elementId: "edge-1" }, {
      readOnly: true,
      hasManualRoute: false,
      deleteDisabledReason: "選択外への影響を確認してください。",
      actionDisabledReasons: { "relation-view": "このビューでは線を表示できません。" },
    });
    expect(reason(edge, "reconnect-relation")).toContain("read-only");
    expect(reason(edge, "reset-route")).toContain("manually adjusted");
    expect(reason(edge, "delete-relation")).toBe("選択外への影響を確認してください。");
    expect(reason(edge, "relation-view")).toBe("このビューでは線を表示できません。");

    const group = targetContextMenuEntries({ kind: "sequence-group", elementId: "seq-1" }, {
      hasGroupMembers: false,
      canChangeGroupOrder: false,
      isGroupCollapsed: true,
    });
    expect(reason(group, "fit-group")).toContain("member elements");
    expect(reason(group, "bring-group-forward")).toContain("cannot move");
    expect(reason(group, "send-group-backward")).toContain("cannot move");
    expect(reason(group, "collapse-group")).toContain("already collapsed");
    expect(reason(group, "expand-group")).toBeUndefined();
  });

  it("localizes helper-generated labels and disabled guidance to Japanese", () => {
    const translator = (key: Parameters<typeof translateEditorMessage>[1], parameters?: Parameters<typeof translateEditorMessage>[2]) => (
      translateEditorMessage("ja", key, parameters)
    );
    const entries = targetContextMenuEntries({ kind: "blank" }, {}, translator);
    expect(entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ actionId: "add-element", label: "要素を追加" }),
      expect.objectContaining({ actionId: "paste", disabledReason: expect.stringContaining("クリップボード") }),
    ]));
  });

  it("pointer/keyboardで同じanchor modelを使いContextMenuとShift+F10を認識する", () => {
    const request = { clientX: 40, clientY: 50, canvasPosition: { x: 10, y: 20 } };
    expect(targetContextMenuAnchor(request, "pointer")).toEqual({
      origin: "pointer", clientX: 40, clientY: 50, canvasPosition: { x: 10, y: 20 },
    });
    expect(targetContextMenuAnchor(request, "keyboard")).toEqual({
      origin: "keyboard", clientX: 40, clientY: 50, canvasPosition: { x: 10, y: 20 },
    });
    expect(isTargetContextMenuKeyboardTrigger(key("ContextMenu"))).toBe(true);
    expect(isTargetContextMenuKeyboardTrigger(key("F10", { shiftKey: true }))).toBe(true);
    expect(isTargetContextMenuKeyboardTrigger(key("F10"))).toBe(false);
    expect(isTargetContextMenuKeyboardTrigger(key("ContextMenu", { ctrlKey: true }))).toBe(false);
  });

  it("disabled項目を飛ばして循環し、選択時はdestinationだけを返してfocusを戻す", () => {
    const originalTarget: TargetContextSubject = { kind: "blank" };
    const session = openTargetContextMenu({
      target: originalTarget,
      request: { clientX: 12, clientY: 24 },
      origin: "keyboard",
      focusReturnId: "canvas",
    });
    const entries = targetContextMenuEntries(originalTarget);
    const first = moveTargetContextMenuActiveEntry(session, entries, "next");
    expect(first.open && first.activeActionId).toBe("add-element");
    const wrapped = moveTargetContextMenuActiveEntry(first, entries, "next");
    expect(wrapped.open && wrapped.activeActionId).toBe("add-element");

    const disabledChoice = chooseTargetContextMenuEntry(wrapped, find(entries, "paste"));
    expect(disabledChoice).toEqual({ session: wrapped });

    const chosen = chooseTargetContextMenuEntry(wrapped, find(entries, "add-element"));
    expect(chosen).toEqual({
      session: { open: false, focusReturnId: "canvas" },
      destination: { surface: "semantic-flow", intent: "add-element" },
      focusReturnId: "canvas",
    });
    expect(originalTarget).toEqual({ kind: "blank" });
    expect(closeTargetContextMenu(session)).toEqual({
      session: { open: false, focusReturnId: "canvas" },
      focusReturnId: "canvas",
    });
  });
});

function groupActions(semanticAction: string): string[] {
  return [
    "group-details",
    semanticAction,
    "group-view",
    "fit-group",
    "collapse-group",
    "expand-group",
    "bring-group-forward",
    "send-group-backward",
    "delete-group",
  ];
}

function reason(entries: readonly TargetContextMenuEntry[], actionId: string): string | undefined {
  return entries.find((entry) => entry.actionId === actionId)?.disabledReason;
}

function find(entries: readonly TargetContextMenuEntry[], actionId: string): TargetContextMenuEntry {
  const result = entries.find((entry) => entry.actionId === actionId);
  if (!result) throw new Error(`missing entry: ${actionId}`);
  return result;
}

function key(
  value: string,
  modifiers: Partial<Pick<KeyboardEvent, "shiftKey" | "ctrlKey" | "metaKey" | "altKey">> = {},
) {
  return {
    key: value,
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    ...modifiers,
  };
}
