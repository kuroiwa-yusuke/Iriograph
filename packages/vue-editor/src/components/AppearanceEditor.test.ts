import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import { DEFAULT_LABEL_FONT_SIZE } from "@iriograph/core";

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
    const preset = wrapper.findAll(".iriograph-style-presets button")
      .find((button) => button.text() === "Preset 1")!;
    expect(wrapper.html()).not.toContain("urn:style:soft");
    await preset.trigger("click");
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
    expect(wrapper.text()).not.toContain("閉じる");
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
    expect(wrapper.find('input[aria-label="Fill color"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain("Group opacity");
  });

  it.each(["node", "container", "region", "edge"] as const)("%sの文字サイズを入力途中はdraftに保ち確定時に一度だけcommitする", async (elementKind) => {
    const wrapper = mount(AppearanceEditor, {
      props: {
        elementKind,
        selectionCount: 1,
        currentStyle: { fill: "none", stroke: "#000000", text: "#000000", labelFontSize: 10 },
        presets: {},
        inline: true,
      },
    });
    const fontSize = wrapper.get<HTMLInputElement>('input[aria-label="Font size"]');
    const fontSizeRow = wrapper.findAll("label").find((label) => label.text().includes("Font size"))!;
    await fontSizeRow.get<HTMLInputElement>('input[type="checkbox"]').setValue(true);
    const commits = wrapper.emitted("commit")!.length;
    const previews = wrapper.emitted("preview")!.length;
    fontSize.element.value = "2";
    await fontSize.trigger("input");
    expect(fontSize.element.value).toBe("2");
    expect(wrapper.emitted("commit")).toHaveLength(commits);
    expect(wrapper.emitted("preview")).toHaveLength(previews);
    fontSize.element.value = "21";
    await fontSize.trigger("input");
    await fontSize.trigger("change");
    expect(wrapper.emitted("commit")?.at(-1)?.[0]).toEqual({ style: { labelFontSize: 21 } });
    await fontSize.trigger("blur");
    expect(wrapper.emitted("commit")).toHaveLength(commits + 1);
  });

  it("label文字サイズの有効化とresetはCore既定値を共有してsparse overrideを保つ", async () => {
    const wrapper = mount(AppearanceEditor, {
      props: {
        elementKind: "container",
        selectionCount: 1,
        currentStyle: { fill: "none", stroke: "#000000", text: "#000000" },
        presets: {},
        inline: true,
      },
    });
    const fontSize = wrapper.get<HTMLInputElement>('input[aria-label="Font size"]');
    expect(Number(fontSize.element.value)).toBe(DEFAULT_LABEL_FONT_SIZE);
    const row = wrapper.findAll("label").find((label) => label.text().includes("Font size"))!;
    await row.get<HTMLInputElement>('input[type="checkbox"]').setValue(true);
    expect(wrapper.emitted("commit")?.at(-1)?.[0]).toEqual({
      style: { labelFontSize: DEFAULT_LABEL_FONT_SIZE },
    });
    await wrapper.get("footer > button").trigger("click");
    expect(wrapper.emitted("commit")?.at(-1)?.[0]).toEqual({});
    expect(Number(fontSize.element.value)).toBe(DEFAULT_LABEL_FONT_SIZE);
  });
});
