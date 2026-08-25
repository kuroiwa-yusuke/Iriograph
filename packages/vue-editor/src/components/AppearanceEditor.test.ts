import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import AppearanceEditor from "./AppearanceEditor.vue";

describe("AppearanceEditor", () => {
  it("inlineではpresetとcheckboxを直接commitしrange inputはchangeまでpreviewに留める", async () => {
    const wrapper = mount(AppearanceEditor, {
      props: {
        elementKind: "region",
        selectionCount: 2,
        currentStyle: { fill: "#ffffff", stroke: "#000000", text: "#000000" },
        presets: { "urn:style:soft": { fill: "#eeeeee", fillOpacity: .4 } },
        inline: true,
      },
    });
    await wrapper.get("button[title='urn:style:soft']").trigger("click");
    expect(wrapper.emitted("commit")?.[0]?.[0]).toEqual({ styleRef: "urn:style:soft" });
    const opacity = wrapper.get<HTMLInputElement>('input[type="range"]');
    await wrapper.findAll<HTMLInputElement>('input[type="checkbox"]')[4]!.setValue(true);
    const committedBeforeInput = wrapper.emitted("commit")?.length;
    opacity.element.value = ".25";
    await opacity.trigger("input");
    expect(wrapper.emitted("commit")).toHaveLength(committedBeforeInput!);
    expect(wrapper.emitted("preview")?.at(-1)?.[0]).toEqual(expect.objectContaining({
      styleRef: "urn:style:soft",
      style: expect.objectContaining({ fillOpacity: .25 }),
    }));
    await opacity.trigger("change");
    expect(wrapper.emitted("commit")?.at(-1)?.[0]).toEqual(expect.objectContaining({
      styleRef: "urn:style:soft",
      style: expect.objectContaining({ fillOpacity: .25 }),
    }));
    await wrapper.get("footer > button").trigger("click");
    expect(wrapper.emitted("commit")?.at(-1)?.[0]).toEqual({});
    expect(wrapper.find("button.primary").exists()).toBe(false);
    expect(wrapper.text()).not.toContain("キャンセル");
    const close = wrapper.findAll("button").find((button) => button.text() === "閉じる")!;
    await close.trigger("click");
    expect(wrapper.emitted("close")).toHaveLength(1);
    expect(wrapper.emitted("commit")?.at(-1)?.[0]).toEqual({});
  });

  it("non-inlineのpreview/apply契約は互換のため維持する", async () => {
    const wrapper = mount(AppearanceEditor, {
      props: {
        elementKind: "node",
        selectionCount: 1,
        currentStyle: { fill: "#ffffff", stroke: "#000000", text: "#000000" },
        presets: {},
      },
    });
    await wrapper.findAll<HTMLInputElement>('input[type="checkbox"]')[0]!.setValue(true);
    expect(wrapper.emitted("commit")).toBeUndefined();
    await wrapper.get("button.primary").trigger("click");
    expect(wrapper.emitted("apply")?.[0]?.[0]).toEqual(expect.objectContaining({
      style: expect.objectContaining({ fill: "#ffffff" }),
    }));
  });

  it("edgeにはfill/opacityを公開しない", () => {
    const wrapper = mount(AppearanceEditor, {
      props: {
        elementKind: "edge",
        selectionCount: 1,
        currentStyle: { fill: "none", stroke: "#000000", text: "#000000" },
        presets: {},
      },
    });
    expect(wrapper.find('input[aria-label="塗り色"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain("領域の透明度");
  });
});
