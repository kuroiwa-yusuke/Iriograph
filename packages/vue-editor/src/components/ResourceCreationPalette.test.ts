import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import ResourceCreationPalette from "./ResourceCreationPalette.vue";

describe("ResourceCreationPalette", () => {
  it("catalog cardと関係の向きを人向けUIから一つの作成draftへseedする", async () => {
    const wrapper = mount(ResourceCreationPalette, {
      props: {
        kind: "node",
        cards: [{
          templateRef: "urn:template:task",
          classIri: "urn:type:Task",
          kind: "node",
          structuralKind: "node",
          label: "タスク",
          description: "意味グラフの要素",
          shape: "rounded-rectangle",
          style: { fill: "#ffffff", stroke: "#333333", text: "#111111" },
          size: { width: 120, height: 60 },
        }],
        resources: [{ iri: "urn:item:existing", label: "既存タスク" }],
        predicates: [{ iri: "urn:rel:depends", label: "依存する" }],
        memberships: [],
        position: { x: 200, y: 120 },
      },
    });
    await wrapper.get<HTMLInputElement>('input[aria-label="新しい要素の名前"]')
      .setValue("新しいタスク");
    await wrapper.get<HTMLInputElement>('fieldset input[type="checkbox"]')
      .setValue(true);
    const selects = wrapper.findAll<HTMLSelectElement>("fieldset select");
    await selects[0]!.setValue("incoming");
    await selects[1]!.setValue("urn:rel:depends");
    await selects[2]!.setValue("urn:item:existing");
    await wrapper.get("button.primary").trigger("click");

    expect(wrapper.emitted("seed")?.[0]?.[0]).toMatchObject({
      label: "新しいタスク",
      classIri: "urn:type:Task",
      createTemplateRef: "urn:template:task",
      createEdgeEnabled: true,
      createEdgeDirection: "incoming",
      createEdgePredicateIri: "urn:rel:depends",
      createEdgeResourceIri: "urn:item:existing",
      initialX: "140",
      initialY: "90",
    });
  });

  it("matrix交差から渡された複数classを確認済み状態で作成draftへseedする", async () => {
    const wrapper = mount(ResourceCreationPalette, {
      props: {
        kind: "node",
        cards: [{
          templateRef: "urn:template:item",
          kind: "node",
          structuralKind: "node",
          label: "要素",
          description: "matrix item",
          shape: "rectangle",
          style: { fill: "#fff", stroke: "#333", text: "#111" },
          size: { width: 80, height: 40 },
        }],
        classes: [
          { iri: "urn:test:ClassA", label: "分類A" },
          { iri: "urn:test:ClassB", label: "分類B" },
        ],
        initialClassIris: ["urn:test:ClassA", "urn:test:ClassB"],
        resources: [],
        predicates: [],
        memberships: [],
      },
    });
    expect(wrapper.findAll<HTMLInputElement>('.iriograph-palette-check-grid input:checked'))
      .toHaveLength(2);
    await wrapper.get<HTMLInputElement>('input[aria-label="新しい要素の名前"]').setValue("交差内要素");
    await wrapper.get("button.primary").trigger("click");
    expect(wrapper.emitted("seed")?.[0]?.[0]).toMatchObject({
      classIris: ["urn:test:ClassA", "urn:test:ClassB"],
    });
  });

  it("上位概念は概念クラスcardでだけ選べ、通常nodeへはseedしない", async () => {
    const card = {
      kind: "node" as const,
      structuralKind: "node" as const,
      description: "要素",
      shape: "rectangle" as const,
      style: { fill: "#fff", stroke: "#333", text: "#111" },
      size: { width: 80, height: 40 },
    };
    const wrapper = mount(ResourceCreationPalette, {
      props: {
        kind: "node",
        cards: [
          { ...card, templateRef: "urn:template:item", classIri: "urn:test:Item", label: "通常要素" },
          { ...card, templateRef: "urn:template:class", classIri: "http://www.w3.org/2000/01/rdf-schema#Class", label: "概念クラス" },
        ],
        classes: [
          { iri: "urn:test:ParentA", label: "上位A" },
          { iri: "urn:test:ParentB", label: "上位B" },
        ],
        resources: [],
        predicates: [],
        memberships: [],
      },
    });

    expect(wrapper.text()).not.toContain("上位概念を設定");
    await wrapper.findAll('[role="radio"]')[1]!.trigger("click");
    expect(wrapper.text()).toContain("上位概念を設定");
    const allClassCheckboxes = wrapper.findAll<HTMLInputElement>('.iriograph-palette-check-grid input[type="checkbox"]');
    await allClassCheckboxes[2]!.setValue(true);

    await wrapper.findAll('[role="radio"]')[0]!.trigger("click");
    expect(wrapper.text()).not.toContain("上位概念を設定");
    await wrapper.get<HTMLInputElement>('input[aria-label="新しい要素の名前"]').setValue("通常要素");
    await wrapper.get("button.primary").trigger("click");
    expect(wrapper.emitted("seed")?.[0]?.[0]).toMatchObject({
      classIri: "urn:test:Item",
      createSuperClassIris: [],
    });
  });
});
