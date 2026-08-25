import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import AppearanceEditor from "./AppearanceEditor.vue";

describe("AppearanceEditor", () => {
  it("presetと安全なsparse fieldだけをpreview/applyする", async () => {
    const wrapper = mount(AppearanceEditor, {
      props: {
        elementKind: "region",
        selectionCount: 2,
        currentStyle: { fill: "#ffffff", stroke: "#000000", text: "#000000" },
        presets: { "urn:style:soft": { fill: "#eeeeee", fillOpacity: .4 } },
      },
    });
    await wrapper.get("button[title='urn:style:soft']").trigger("click");
    const opacity = wrapper.get<HTMLInputElement>('input[type="range"]');
    await wrapper.findAll<HTMLInputElement>('input[type="checkbox"]')[4]!.setValue(true);
    await opacity.setValue(.25);
    await wrapper.get("button.primary").trigger("click");
    expect(wrapper.emitted("apply")?.[0]?.[0]).toEqual(expect.objectContaining({
      styleRef: "urn:style:soft",
      style: expect.objectContaining({ fillOpacity: .25 }),
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
