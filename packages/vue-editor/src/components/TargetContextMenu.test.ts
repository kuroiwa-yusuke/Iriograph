import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { describe, expect, it } from "vitest";

import {
  openTargetContextMenu,
  targetContextMenuEntries,
  type TargetContextSubject,
} from "../target-context-menu";
import TargetContextMenu from "./TargetContextMenu.vue";

describe("TargetContextMenu", () => {
  it.each<[TargetContextSubject, string]>([
    [{ kind: "blank" }, "要素を追加"],
    [{ kind: "node", elementId: "node-1" }, "要素の詳細"],
    [{ kind: "direct-edge", elementId: "edge-1" }, "関係の詳細"],
    [{ kind: "derived-sequence-guide", elementId: "guide-1", groupElementId: "seq-1" }, "順序を編集"],
    [{ kind: "derived-alternative-guide", elementId: "guide-2", groupElementId: "alt-1" }, "候補グループを編集"],
    [{ kind: "classification-group", elementId: "class-1" }, "グループの詳細"],
    [{ kind: "membership-group", elementId: "bag-1" }, "所属を編集"],
    [{ kind: "sequence-group", elementId: "seq-1" }, "順序を編集"],
    [{ kind: "alternative-group", elementId: "alt-1" }, "候補グループを編集"],
  ])("pure target entriesを共通menu rendererへ渡す: %o", (target, label) => {
    const wrapper = mount(TargetContextMenu, {
      props: {
        session: session(target),
        entries: targetContextMenuEntries(target, {
          clipboardHasSupportedContent: true,
          hasManualRoute: true,
          hasGroupMembers: true,
        }),
      },
    });
    expect(wrapper.get("[role='menu']").text()).toContain(label);
    expect(wrapper.find("[data-icon-token]").exists()).toBe(true);
  });

  it("keyboard選択ではdestinationだけをemitしfocus移動を親へ委ねる", async () => {
    const opener = document.createElement("button");
    opener.id = "menu-opener";
    document.body.append(opener);
    const target: TargetContextSubject = { kind: "node", elementId: "node-1" };
    const wrapper = mount(TargetContextMenu, {
      attachTo: document.body,
      props: {
        session: session(target, "menu-opener", "keyboard"),
        entries: targetContextMenuEntries(target),
      },
    });
    await nextTick();
    await wrapper.get("[role='menu']").trigger("keydown", { key: "Enter" });
    expect(wrapper.emitted("select")?.[0]).toEqual([
      {
        surface: "semantic-flow",
        intent: "edit-element",
        elementId: "node-1",
        section: "details",
      },
      "element-details",
    ]);
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
    expect(document.activeElement).not.toBe(opener);
    wrapper.unmount();
    opener.remove();
  });

  it("disabled理由を表示して選択せず、Escapeはfocus return付きcloseだけをemitする", async () => {
    const opener = document.createElement("button");
    opener.id = "disabled-menu-opener";
    document.body.append(opener);
    const target: TargetContextSubject = { kind: "direct-edge", elementId: "edge-1" };
    const wrapper = mount(TargetContextMenu, {
      attachTo: document.body,
      props: {
        session: session(target, "disabled-menu-opener"),
        entries: targetContextMenuEntries(target, { readOnly: true, hasManualRoute: false }),
      },
    });
    expect(wrapper.text()).toContain("読み取り専用のため変更できません。");
    const disabled = wrapper.get("[aria-disabled='true']");
    await disabled.trigger("click");
    expect(wrapper.emitted("select")).toBeUndefined();
    await wrapper.get("[role='menu']").trigger("keydown", { key: "Escape" });
    expect(wrapper.emitted("close")?.[0]).toEqual(["disabled-menu-opener"]);
    await nextTick();
    expect(document.activeElement).toBe(opener);
    wrapper.unmount();
    opener.remove();
  });
});

function session(
  target: TargetContextSubject,
  focusReturnId?: string,
  origin: "pointer" | "keyboard" = "pointer",
) {
  return openTargetContextMenu({
    target,
    origin,
    focusReturnId,
    request: { clientX: 24, clientY: 32, canvasPosition: { x: 8, y: 12 } },
  });
}
