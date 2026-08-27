import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import CommitNumberInput from "./CommitNumberInput.vue";

describe("CommitNumberInput", () => {
  it("入力途中・一時空欄・IMEをdraftに保ちchange/blur/Enterで一度だけcommitする", async () => {
    const wrapper = mount(CommitNumberInput, {
      props: { value: 21, minimum: 8, maximum: 72, step: 1, label: "文字サイズ" },
    });
    const input = wrapper.get<HTMLInputElement>("input");

    input.element.value = "2";
    await input.trigger("input");
    expect(input.element.value).toBe("2");
    expect(wrapper.emitted("commit")).toBeUndefined();

    input.element.value = "";
    await input.trigger("input");
    expect(input.element.value).toBe("");
    await input.trigger("blur");
    expect(input.element.value).toBe("21");
    expect(wrapper.emitted("commit")).toBeUndefined();

    await input.trigger("compositionstart");
    input.element.value = "21.5";
    await input.trigger("input");
    await input.trigger("change");
    expect(wrapper.emitted("commit")).toBeUndefined();
    await input.trigger("compositionend");
    await input.trigger("keydown", { key: "Enter" });
    expect(wrapper.emitted("commit")).toEqual([[21.5]]);
    await input.trigger("blur");
    expect(wrapper.emitted("commit")).toHaveLength(1);
  });

  it("範囲検証は確定時だけ行いArrow/wheel由来の連続inputを合成しない", async () => {
    const wrapper = mount(CommitNumberInput, {
      props: { value: 21, minimum: 8, maximum: 72, step: 1, label: "文字サイズ" },
    });
    const input = wrapper.get<HTMLInputElement>("input");
    for (const value of ["2", "20", "200"]) {
      input.element.value = value;
      await input.trigger("input");
    }
    expect(wrapper.emitted("commit")).toBeUndefined();
    await input.trigger("change");
    expect(wrapper.emitted("commit")).toEqual([[72]]);
    await input.trigger("blur");
    expect(wrapper.emitted("commit")).toHaveLength(1);
  });
});
