import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import EditorContextMenu from "./EditorContextMenu.vue";

describe("EditorContextMenu", () => {
  it("ARIA menuとしてfocusを移動しkeyboardでactionを選ぶ", async () => {
    const wrapper = mount(EditorContextMenu, {
      attachTo: document.body,
      props: {
        x: 20,
        y: 30,
        actions: [
          { id: "edit-details", label: "詳細" },
          { id: "delete-resource", label: "削除", disabled: true },
          { id: "edit-appearance", label: "見た目" },
        ],
      },
    });
    await wrapper.get("[role='menu']").trigger("keydown", { key: "ArrowDown" });
    expect((document.activeElement as HTMLElement).textContent).toBe("見た目");
    await wrapper.get("[role='menu']").trigger("keydown", { key: "Enter" });
    expect(wrapper.emitted("select")?.[0]).toEqual(["edit-appearance"]);
    wrapper.unmount();
  });

  it("Escapeで閉じる", async () => {
    const wrapper = mount(EditorContextMenu, {
      props: { x: 0, y: 0, actions: [{ id: "create-node", label: "作成" }] },
    });
    await wrapper.get("[role='menu']").trigger("keydown", { key: "Escape" });
    expect(wrapper.emitted("close")).toHaveLength(1);
  });

  it("任意action IDのiconとdisabled理由を表示する", async () => {
    const wrapper = mount(EditorContextMenu, {
      props: {
        x: 0,
        y: 0,
        actions: [
          { id: "open-structured-flow", label: "関係を作る", iconToken: "relation" },
          {
            id: "unavailable-action",
            label: "順序を編集",
            disabled: true,
            disabledReason: "グループに要素がありません。",
            iconToken: "sequence",
          },
        ],
      },
    });
    expect(wrapper.get("[data-icon-token='relation']").text()).toBe("→");
    expect(wrapper.text()).toContain("グループに要素がありません。");
    expect(wrapper.get("[aria-disabled='true']").attributes("aria-describedby")).toBeTruthy();
    await wrapper.get("[aria-disabled='true']").trigger("click");
    expect(wrapper.emitted("select")).toBeUndefined();
    await wrapper.setProps({
      actions: [{
        id: "unavailable-action",
        label: "順序を編集",
        disabled: true,
        disabledReason: "グループに要素がありません。",
      }],
    });
    await wrapper.get("[role='menu']").trigger("keydown", { key: "Enter" });
    expect(wrapper.emitted("select")).toBeUndefined();
  });
});
