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
});
