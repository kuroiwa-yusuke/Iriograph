import { mount, type VueWrapper } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import type { IriographDocumentV1 } from "@iriograph/core";

import {
  deriveTypeSystem,
  IriographTypeListPanel,
  type TypeSystemIndex,
} from "../index";
import TypeListPanel from "./TypeListPanel.vue";
import {
  createStaticEditorLocalization,
  editorLocalizationKey,
} from "../localization/editor-localization";

const NS = "urn:test:type-panel:";

describe("TypeListPanel", () => {
  it("package rootから公開し、複数親の子を同じopaque identityへのDAG参照として示す", () => {
    expect(IriographTypeListPanel).toBe(TypeListPanel);
    const index = deriveTypeSystem(document(`
@prefix : <${NS}> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
:Left a rdfs:Class ; rdfs:label "左" .
:Right a rdfs:Class ; rdfs:label "右" .
:Shared a rdfs:Class ; rdfs:label "共有" ; rdfs:subClassOf :Left, :Right .
`));
    const shared = index.presentation.types.find((item) => item.label === "共有")!;
    const wrapper = mountPanel(index);
    const references = wrapper.findAll(`[data-type-id="${shared.typeId}"]`);
    expect(references).toHaveLength(2);
    expect(references[1]!.text()).toContain("同じ型への参照");
    expect(references[0]!.get(".parent-summary").text()).toContain("右、左");

    const english = mount(TypeListPanel, { props: { presentation: index.presentation } });
    expect(english.findAll(`[data-type-id="${shared.typeId}"]`)[0]!
      .get(".parent-summary").text()).toContain("右, 左");
  });

  it("型一覧/型/上位の型をlabel-firstで表示し、検索してもraw IRIをDOMへ渡さない", async () => {
    const index = fixture();
    const wrapper = mountPanel(index);
    expect(wrapper.get("h2").text()).toBe("型一覧");
    expect(wrapper.get('[role="tree"]').attributes("aria-label")).toBe("型");
    expect(wrapper.text()).toContain("上位の型");
    expect(wrapper.text()).toContain("直接 1件 / 継承 1件");
    expect(wrapper.html()).not.toMatch(/urn:|https?:\/\/|rdf:|rdfs:|IRI/u);

    await wrapper.get('input[type="search"]').setValue("実行する");
    expect(wrapper.findAll('[role="treeitem"]')).toHaveLength(1);
    expect(wrapper.get('[role="treeitem"]').text()).toContain("作業");
  });

  it("同名の型をopaque exact typeIdでfocusし、resourceも同時にmulti-select seedする", () => {
    const index = deriveTypeSystem(document(`
@prefix : <${NS}> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
:One a rdfs:Class ; rdfs:label "同じ名前" ; rdfs:comment "一つ目" .
:Two a rdfs:Class ; rdfs:label "同じ名前" ; rdfs:comment "二つ目" .
:item a :Two ; rdfs:label "対象" .
`));
    const two = index.presentation.types.find((item) => item.description === "二つ目")!;
    const resource = index.presentation.resources[0]!;
    const wrapper = mountPanel(index, { typeId: two.typeId, resourceId: resource.resourceId });
    expect(wrapper.get("article").text()).toContain("二つ目");
    expect(wrapper.get<HTMLInputElement>('.assignment-resource-row input').element.checked).toBe(true);
    expect(wrapper.html()).not.toContain(`${NS}Two`);
  });

  it("直接/継承toggleをsession-onlyに保ち、図の表示要求だけを親へemitする", async () => {
    const index = fixture();
    const work = index.presentation.types.find((item) => item.label === "仕事")!;
    const wrapper = mountPanel(index, { typeId: work.typeId });
    expect(wrapper.findAll(".resource-row-readonly")).toHaveLength(1);
    expect(wrapper.get(".resource-row-readonly").text()).toContain("直接の仕事");
    expect(wrapper.get(".resource-row-readonly").text()).toContain("直接の型: 仕事");

    await button(wrapper, "継承を含む").trigger("click");
    expect(wrapper.findAll(".resource-row-readonly")).toHaveLength(2);
    expect(wrapper.findAll(".resource-row-readonly")[1]!.text()).toContain("申請を確認");
    expect(wrapper.findAll(".resource-row-readonly")[1]!.text()).toContain("継承の型: 仕事");
    await button(wrapper, "図で表示").trigger("click");
    expect(wrapper.emitted("show-in-diagram")?.[0]?.[0]).toEqual({
      typeId: work.typeId,
      resourceIds: [...work.directResourceIds, ...work.inheritedResourceIds],
      scope: "direct-and-inherited",
    });
    expect(wrapper.emitted("action")).toBeUndefined();
  });

  it("未付与の全node候補を検索・複数付与し、reload後はdirect付与だけを一括解除する", async () => {
    const index = fixture();
    const work = index.presentation.types.find((item) => item.label === "仕事")!;
    const wrapper = mountPanel(index, { typeId: work.typeId });
    const unassigned = index.presentation.resources.filter((item) => item.label.startsWith("未付与"));
    expect(unassigned).toHaveLength(2);
    expect(wrapper.findAll(".assignment-resource-row")).toHaveLength(4);
    await wrapper.get('.assignment-section input[type="search"]').setValue("未付与");
    expect(wrapper.findAll(".assignment-resource-row")).toHaveLength(2);
    for (const checkbox of wrapper.findAll<HTMLInputElement>(".assignment-resource-row input")) await checkbox.setValue(true);
    await button(wrapper, "選択要素へ型を付与").trigger("click");
    expect(wrapper.emitted("action")?.[0]?.[0]).toEqual({
      type: "bulk-add-type",
      typeId: work.typeId,
      resourceIds: unassigned.map((item) => item.resourceId),
    });
    expect(button(wrapper, "選択要素から型を解除").attributes()).toHaveProperty("disabled");

    const reloaded = fixture(true);
    await wrapper.setProps({ presentation: reloaded.presentation });
    await button(wrapper, "選択要素から型を解除").trigger("click");
    expect(wrapper.emitted("action")?.[1]?.[0]).toEqual({
      type: "bulk-remove-type",
      typeId: work.typeId,
      resourceIds: unassigned.map((item) => item.resourceId),
    });
  });

  it("図のnodeでないsemantic resourceは該当要素に表示しても一括変更候補に含めない", () => {
    const index = deriveTypeSystem(document(`
@prefix : <${NS}> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
:Task a rdfs:Class ; rdfs:label "作業" .
:node a :Task ; rdfs:label "図のnode" .
:group a rdf:Bag, :Task ; rdfs:label "型付きgroup" .
`), { resourceIris: [`${NS}node`] });
    const task = index.presentation.types.find((item) => item.label === "作業")!;
    const wrapper = mountPanel(index, { typeId: task.typeId });
    expect(wrapper.findAll(".resource-row-readonly").map((row) => row.text())).toEqual(expect.arrayContaining([
      expect.stringContaining("型付きgroup"),
      expect.stringContaining("図のnode"),
    ]));
    expect(wrapper.findAll(".assignment-resource-row")).toHaveLength(1);
    expect(wrapper.get(".assignment-resource-row").text()).toContain("図のnode");
    expect(wrapper.get(".assignment-section").text()).not.toContain("型付きgroup");
  });

  it("作成/編集を複数上位型付きactionにし、編集で提案したcycleを保存前に止める", async () => {
    const index = deriveTypeSystem(document(`
@prefix : <${NS}> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
:A a rdfs:Class ; rdfs:label "A" ; rdfs:subClassOf :B .
:B a rdfs:Class ; rdfs:label "B" .
`));
    const b = index.presentation.types.find((item) => item.label === "B")!;
    const a = index.presentation.types.find((item) => item.label === "A")!;
    const wrapper = mountPanel(index, { typeId: b.typeId });
    await button(wrapper, "新しい型").trigger("click");
    const createParentA = wrapper.findAll<HTMLInputElement>("fieldset label").find((label) => label.text() === "A")!;
    await createParentA.get("input").setValue(true);
    await wrapper.get(".type-form input:not([type='checkbox'])").setValue("追加した型");
    await wrapper.get(".type-form").trigger("submit");
    expect(wrapper.emitted("action")?.[0]?.[0]).toEqual({
      type: "create-class",
      label: "追加した型",
      parentTypeIds: [b.typeId, a.typeId],
    });

    await button(wrapper, "編集").trigger("click");
    const parentA = wrapper.findAll<HTMLInputElement>("fieldset label").find((label) => label.text() === "A")!;
    await parentA.get("input").setValue(true);
    expect(wrapper.get(".form-error").text()).toContain("循環");
    expect(button(wrapper, "保存").attributes()).toHaveProperty("disabled");
    expect(wrapper.emitted("action")).toHaveLength(1);
  });

  it("型削除はPanel内で常時確認せず、影響判定を親のpreview経路へ渡す", async () => {
    const index = fixture();
    const work = index.presentation.types.find((item) => item.label === "仕事")!;
    const wrapper = mountPanel(index, { typeId: work.typeId });
    await button(wrapper, "削除").trigger("click");
    expect(wrapper.find('[role="alertdialog"]').exists()).toBe(false);
    expect(wrapper.emitted("action")?.[0]?.[0]).toEqual({
      type: "delete-class",
      typeId: work.typeId,
    });
  });

  it("readonlyでは意味actionを無効化し、図で表示だけは利用できる", async () => {
    const index = fixture();
    const wrapper = mount(TypeListPanel, {
      props: { presentation: index.presentation, readonly: true },
      global: japaneseLocalization,
    });
    expect(button(wrapper, "新しい型").attributes()).toHaveProperty("disabled");
    expect(button(wrapper, "編集").attributes()).toHaveProperty("disabled");
    expect(button(wrapper, "削除").attributes()).toHaveProperty("disabled");
    await button(wrapper, "図で表示").trigger("click");
    expect(wrapper.emitted("show-in-diagram")).toHaveLength(1);
    expect(wrapper.emitted("action")).toBeUndefined();
  });
});

function fixture(assigned = false): TypeSystemIndex {
  return deriveTypeSystem(document(`
@prefix : <${NS}> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
:Work a rdfs:Class ; rdfs:label "仕事" ; rdfs:comment "全般の仕事" .
:Task a rdfs:Class ; rdfs:label "作業" ; rdfs:comment "実行する仕事" ; rdfs:subClassOf :Work .
:Other a rdfs:Class ; rdfs:label "別の型" .
:direct a :Work ; rdfs:label "直接の仕事" .
:task a :Task ; rdfs:label "申請を確認" .
:other-a a :Other${assigned ? ", :Work" : ""} ; rdfs:label "未付与 A" .
:other-b a :Other${assigned ? ", :Work" : ""} ; rdfs:label "未付与 B" .
`));
}

function mountPanel(index: TypeSystemIndex, focus?: { typeId: string; resourceId?: string }) {
  return mount(TypeListPanel, {
    props: { presentation: index.presentation, focus },
    global: japaneseLocalization,
  });
}

const japaneseLocalization = {
  provide: {
    [editorLocalizationKey as symbol]: createStaticEditorLocalization("ja"),
  },
};

function document(source: string): IriographDocumentV1 {
  return {
    schemaVersion: "1",
    kind: "iriograph.document",
    documentId: "type-panel",
    semantic: {
      format: "text/turtle",
      baseIri: NS,
      authoringProfileRef: "urn:test:profile",
      source,
    },
    views: [{
      viewId: "main",
      kind: "node-link",
      profileRef: "urn:test:view-profile",
      layoutRef: "urn:test:layout",
      overlay: {},
    }],
  };
}

function button(wrapper: VueWrapper, text: string) {
  return wrapper.findAll("button").find((item) => item.text() === text)!;
}
