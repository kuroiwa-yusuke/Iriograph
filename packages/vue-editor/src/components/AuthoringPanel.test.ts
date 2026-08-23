import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { defineComponent, h, nextTick } from "vue";

import { capabilityBindingsFor, emptyAuthoringDraft } from "../authoring-draft";
import AuthoringPanel from "./AuthoringPanel.vue";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("AuthoringPanel", () => {
  it("draft field変更だけを通知しPreview/Applyを明示操作に保つ", async () => {
    const wrapper = mount(AuthoringPanel, {
      props: {
        modelValue: emptyAuthoringDraft("create-resource"),
        classes: [{ iri: "urn:test:Task", label: "Task" }],
      },
    });

    await wrapper.get<HTMLInputElement>('input[aria-label="Resource label"]').setValue("Review");
    const draft = wrapper.emitted("update:modelValue")?.at(-1)?.[0] as ReturnType<typeof emptyAuthoringDraft>;
    expect(draft.label).toBe("Review");
    expect(wrapper.emitted("preview")).toBeUndefined();

    await wrapper.get(".iriograph-authoring-actions button").trigger("click");
    expect(wrapper.emitted("preview")).toHaveLength(1);
    expect(wrapper.emitted("apply")).toBeUndefined();
  });

  it("warningとexact triple差分を表示して明示Applyを通知する", async () => {
    const wrapper = mount(AuthoringPanel, {
      props: {
        modelValue: emptyAuthoringDraft("delete-resource"),
        preview: {
          confirmationId: "authoring:stable",
          valid: true,
          diagnostics: [{
            severity: "warning",
            code: "unknown-term-introduced",
            message: "unknown predicate",
          }],
          addedStatements: ["<urn:a> <urn:p> <urn:b> ."],
          removedStatements: ["<urn:a> <urn:old> <urn:b> ."],
          candidateSource: "<urn:a> <urn:p> <urn:b> .\n",
          operationLabel: "Resourceを削除",
          resourceChips: [{ iri: "urn:a", label: "A", role: "削除対象" }],
          relations: [],
        },
      },
    });

    expect(wrapper.text()).toContain("警告を確認して適用");
    expect(wrapper.text()).toContain("unknown-term-introduced");
    expect(wrapper.text()).toContain("削除 1 triple");
    expect(wrapper.text()).toContain("追加 1 triple");
    expect(wrapper.text()).toContain("Resourceを削除");
    expect(wrapper.text()).toContain("削除対象");
    expect(wrapper.text()).toContain("A");

    const apply = wrapper.findAll(".iriograph-authoring-actions button")
      .find((button) => button.text().includes("適用"))!;
    await apply.trigger("click");
    expect(wrapper.emitted("apply")).toHaveLength(1);
  });

  it("label-first choiceは完全IRIをemitしAdvanced custom入力を確実に開いてfocusする", async () => {
    const wrapper = mount(AuthoringPanel, {
      attachTo: document.body,
      props: {
        modelValue: emptyAuthoringDraft("create-resource"),
        classes: [{ iri: "urn:test:Task", label: "Task" }],
      },
    });
    const choice = wrapper.get<HTMLSelectElement>('select[aria-label="Resource class choice"]');
    expect(choice.text()).toContain("Task");
    await choice.setValue("urn:test:Task");
    let draft = wrapper.emitted("update:modelValue")?.at(-1)?.[0] as ReturnType<typeof emptyAuthoringDraft>;
    expect(draft.classIri).toBe("urn:test:Task");
    await wrapper.setProps({ modelValue: draft });

    await choice.setValue("__iriograph_custom_iri__");
    await nextTick();
    const advanced = wrapper.get<HTMLInputElement>('input[aria-label="Resource class"]');
    expect(advanced.element.closest("details")?.open).toBe(true);
    expect(document.activeElement).toBe(advanced.element);
  });

  it("対象fieldを明示したCanvas picker requestを通知する", async () => {
    const wrapper = mount(AuthoringPanel, {
      props: {
        modelValue: emptyAuthoringDraft("connect-resources"),
        resources: [{ iri: "urn:test:a", label: "A" }],
      },
    });

    await wrapper.findAll(".iriograph-pick-resource")[1]!.trigger("click");
    expect(wrapper.emitted("pickResource")?.at(-1)?.[0]).toEqual({ field: "targetIri" });
  });

  it("blocked/readOnly相当ではwrite actionを無効化する", () => {
    const wrapper = mount(AuthoringPanel, {
      props: {
        modelValue: emptyAuthoringDraft(),
        enabled: false,
        blockedReason: "Turtle draftを先に適用してください。",
      },
    });

    expect(wrapper.text()).toContain("Turtle draftを先に適用してください。");
    expect(wrapper.findAll("input, select").every((field) => (
      "disabled" in field.element && (field.element as HTMLInputElement).disabled
    ))).toBe(true);
    expect(wrapper.findAll(".iriograph-authoring-actions button").slice(0, 2).every(
      (button) => (button.element as HTMLButtonElement).disabled,
    )).toBe(true);
  });

  it("propertyの空literal・複数valueと明示deleteを別操作として通知する", async () => {
    const wrapper = mount(AuthoringPanel, {
      props: { modelValue: emptyAuthoringDraft("set-property") },
    });
    expect(wrapper.get<HTMLInputElement>('input[aria-label="Property value 1"]').element.value).toBe("");
    await wrapper.get<HTMLButtonElement>(".iriograph-authoring-value-row + button").trigger("click");
    let draft = wrapper.emitted("update:modelValue")?.at(-1)?.[0] as ReturnType<typeof emptyAuthoringDraft>;
    expect(draft.propertyValues).toHaveLength(2);
    await wrapper.setProps({ modelValue: draft });
    await wrapper.get<HTMLSelectElement>('select[aria-label="Property update mode"]').setValue("delete");
    draft = wrapper.emitted("update:modelValue")?.at(-1)?.[0] as ReturnType<typeof emptyAuthoringDraft>;
    expect(draft.propertyMode).toBe("delete");
  });

  it("capability metadataからrequired省略も必須のtyped IRI fieldを生成する", async () => {
    const capability = {
      iri: "urn:test:capability",
      label: "Connect",
      parameters: [
        { name: "source", objectKinds: ["iri" as const] },
        { name: "note", objectKinds: ["literal" as const], required: false },
      ],
    };
    const wrapper = mount(AuthoringPanel, {
      props: {
        modelValue: emptyAuthoringDraft("apply-capability"),
        capabilities: [capability],
        resources: [{ iri: "urn:test:a" }],
      },
    });
    await wrapper.get<HTMLSelectElement>('select[aria-label="Projection capability"]').setValue(capability.iri);
    const draft = wrapper.emitted("update:modelValue")?.at(-1)?.[0] as ReturnType<typeof emptyAuthoringDraft>;
    expect(draft.capabilityBindings).toEqual(capabilityBindingsFor(capability));
    await wrapper.setProps({ modelValue: draft });
    expect(wrapper.get<HTMLInputElement>('input[aria-label="source binding value"]').attributes("list"))
      .toContain("authoring-resources");
    expect(wrapper.find('input[aria-label="source binding enabled"]').exists()).toBe(false);
    expect(wrapper.get<HTMLInputElement>('input[aria-label="note binding enabled"]').element.checked).toBe(false);
  });

  it("複数instanceのdatalist idを衝突させない", () => {
    const host = mount(defineComponent(() => () => h("div", [
      h(AuthoringPanel, { modelValue: emptyAuthoringDraft("set-property") }),
      h(AuthoringPanel, { modelValue: emptyAuthoringDraft("set-property") }),
    ])));
    const panels = host.findAllComponents(AuthoringPanel);
    const firstId = panels[0]!.get<HTMLInputElement>('input[aria-label="Property subject"]').attributes("list");
    const secondId = panels[1]!.get<HTMLInputElement>('input[aria-label="Property subject"]').attributes("list");
    expect(firstId).not.toBe(secondId);
    expect(panels[0]!.findAll("datalist").some((item) => item.attributes("id") === firstId)).toBe(true);
    expect(panels[1]!.findAll("datalist").some((item) => item.attributes("id") === secondId)).toBe(true);
  });
});
