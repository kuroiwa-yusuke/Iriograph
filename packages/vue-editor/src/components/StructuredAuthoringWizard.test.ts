import { mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h, nextTick, ref } from "vue";
import type {
  StructuredAuthoringPresentation,
  StructuredPredicateHierarchyPresentation,
} from "@iriograph/core";
import { describe, expect, it } from "vitest";

import {
  IriographStructuredAuthoringWizard,
  type StructuredAuthoringCanvasOption,
  type StructuredAuthoringCanvasSelectionRequest,
} from "../index";
import {
  createStructuredAuthoringFlow,
  reduceStructuredAuthoringFlow,
  type FlowCanvasChoice,
  type StructuredAuthoringFlowEvent,
  type StructuredAuthoringFlowState,
} from "../authoring/structured-authoring-flow";
import StructuredAuthoringWizard from "./StructuredAuthoringWizard.vue";

const presentation: StructuredAuthoringPresentation = {
  profile: {
    allowUntypedNodes: false,
    nodeRoles: [
      { roleId: "task", label: "作業", description: "実行する仕事" },
      { roleId: "event", label: "出来事", description: "発生する出来事" },
    ],
  },
  groupKinds: [
    { groupKind: "classification", label: "分類グループ", description: "同じ種類をまとめます。", role: "group", enabled: true },
    { groupKind: "membership", label: "包含グループ", description: "順序なしでまとめます。", role: "group", enabled: true },
    { groupKind: "sequence", label: "順序付きグループ", description: "順番を持ってまとめます。", role: "group", enabled: true },
    { groupKind: "alternative", label: "候補グループ", description: "候補と既定をまとめます。", role: "group", enabled: true },
  ],
  relationFamilies: [
    { family: "direct", label: "線でつなぐ", description: "関係を作ります。" },
    { family: "membership", label: "グループへ所属させる", description: "所属を作ります。" },
  ],
  predicateCatalog: [
    { predicateId: "next", label: "次の工程", category: "進行", sentencePattern: "Aの次にBを行う" },
    { predicateId: "depends", label: "依存する", category: "依存", sentencePattern: "AはBに依存する" },
  ],
  capabilities: [],
};

const canvasOptions = [
  option("a", "注文を受ける", "node", undefined, "rounded"),
  option("b", "ピザを焼く", "node", undefined, "rectangle"),
  option("c", "配達する", "node", undefined, "circle"),
  option("seq", "調理の順序", "group", "sequence", "group"),
  option("alt", "受取方法の候補", "group", "alternative", "group"),
  option("edge", "注文から調理", "direct-edge", undefined, "rectangle"),
];

describe("StructuredAuthoringWizard", () => {
  it("package rootからcomponentとpublic wiring型をexportする", () => {
    const canvasOption: StructuredAuthoringCanvasOption = canvasOptions[0]!;
    const selectionRequest: StructuredAuthoringCanvasSelectionRequest = {
      role: "direct-targets",
      multiple: true,
      acceptedKinds: ["node"],
    };
    expect(IriographStructuredAuthoringWizard).toBe(StructuredAuthoringWizard);
    expect(canvasOption.label).toBe("注文を受ける");
    expect(selectionRequest.role).toBe("direct-targets");
  });

  it("初期blurでは4入口だけを示しBack/Escapeとfocusを維持する", async () => {
    const host = mountControlled(createStructuredAuthoringFlow(), { attach: true });
    const wizard = child(host);
    expect(wizard.findAll(".entry-card")).toHaveLength(4);
    expect(wizard.findAll("button")).toHaveLength(4);
    expect(wizard.text()).toContain("新しい要素を作る");
    expect(wizard.text()).toContain("関係を変更する");
    expect(wizard.html()).not.toMatch(/https?:\/\/|Turtle|RDF|IRI/);
    await nextTick();
    expect(document.activeElement?.textContent).toContain("新しい要素を作る");

    await clickButton(wizard, "新しい要素を作る");
    expect(wizard.text()).toContain("作るものを選ぶ");
    await clickButton(wizard, "戻る");
    expect(wizard.findAll(".entry-card")).toHaveLength(4);
    await clickButton(wizard, "関係を作る");
    await wizard.get(".structured-wizard").trigger("keydown", { key: "Escape" });
    expect(wizard.findAll(".entry-card")).toHaveLength(4);
    await clickButton(wizard, "新しい要素を作る");
    await clickButton(wizard, "キャンセル");
    expect(wizard.findAll(".entry-card")).toHaveLength(4);
    host.unmount();
  });

  it("nodeは種類必須で名前まで一判断ずつ進みCore requestだけをsubmitする", async () => {
    const host = mountControlled(createStructuredAuthoringFlow());
    const wizard = child(host);
    await clickButton(wizard, "新しい要素を作る");
    await clickButton(wizard, "要素");
    expect(button(wizard, "次へ").attributes()).toHaveProperty("disabled");
    await clickButton(wizard, "作業");
    expect(button(wizard, "次へ").attributes()).not.toHaveProperty("disabled");
    await clickButton(wizard, "次へ");
    await wizard.get("input").setValue("承認する");
    await clickButton(wizard, "次へ");
    expect(wizard.text()).not.toContain("実行する");
    expect(wizard.emitted("submit")?.[0]).toEqual([{
      type: "create-element",
      requestId: "component-request",
      element: { kind: "node", label: "承認する", nodeRoleIds: ["task"], suggestedLocalName: undefined },
    }]);
    expect(wizard.emitted("update:modelValue")).toBeUndefined();
  });

  it("groupは形preview付き4種類から選び、未分類許可時だけroleなしで進める", async () => {
    let state = step(createStructuredAuthoringFlow(), { type: "choose-intent", intent: "add-element" });
    state = step(state, { type: "choose-element-kind", elementKind: "group" });
    const host = mountControlled(state);
    const wizard = child(host);
    expect(wizard.findAll(".choice-card")).toHaveLength(4);
    expect(wizard.findAll(".shape-preview.group")).toHaveLength(4);
    await clickButton(wizard, "候補グループ");
    await clickButton(wizard, "次へ");
    expect(wizard.text()).toContain("名前を付ける");

    const untypedPresentation = {
      ...presentation,
      profile: { ...presentation.profile, allowUntypedNodes: true },
    };
    state = createStructuredAuthoringFlow({ allowUntypedNodes: true });
    state = step(state, { type: "choose-intent", intent: "add-element" });
    state = step(state, { type: "choose-element-kind", elementKind: "node" });
    const untyped = mountControlled(state, { presentation: untypedPresentation });
    expect(child(untyped).text()).toContain("未分類で作る");
    expect(button(child(untyped), "次へ").attributes()).not.toHaveProperty("disabled");
  });

  it("directは事前選択をsource/複数target chipへ表示しpredicateを日本語で選ぶ", async () => {
    let state = step(createStructuredAuthoringFlow(), {
      type: "choose-intent",
      intent: "add-relation",
      preselection: [choice("a"), choice("b"), choice("c")],
    });
    const host = mountControlled(state);
    const wizard = child(host);
    await clickButton(wizard, "線でつなぐ");
    expect(wizard.text()).toContain("注文を受ける");
    expect(wizard.find(".shape-mini.rounded").exists()).toBe(true);
    await clickButton(wizard, "Canvasから始点を選ぶ");
    expect(wizard.emitted("requestCanvasSelection")?.[0]).toEqual([{
      role: "direct-source", multiple: false, acceptedKinds: ["node"],
    }]);
    await clickButton(wizard, "次へ");
    expect(wizard.text()).toContain("ピザを焼く");
    expect(wizard.text()).toContain("配達する");
    await clickButton(wizard, "次へ");
    expect(wizard.text()).toContain("A（次の工程）B");
    expect(wizard.text()).toContain("Aの次にBを行う");
    await clickButton(wizard, "次の工程");
    expect(wizard.find(".row-overrides").exists()).toBe(true);
    await clickButton(wizard, "次へ");
    expect(wizard.text()).not.toContain("実行する");
    expect(wizard.emitted("submit")?.[0]?.[0]).toMatchObject({
      type: "create-direct-relations",
      source: selection("a"),
      predicateId: "next",
      targets: [{ target: selection("b") }, { target: selection("c") }],
    });
  });

  it("predicate cardはopaque DTOの全上位path・cycle/truncation・推論policyだけを表示する", async () => {
    let state = step(createStructuredAuthoringFlow(), {
      type: "choose-intent",
      intent: "add-relation",
      preselection: [choice("a"), choice("b")],
    });
    state = step(state, { type: "choose-relation-family", family: "direct" });
    state = step(state, { type: "next" });
    state = step(state, { type: "next" });
    const hierarchy: StructuredPredicateHierarchyPresentation = {
      predicates: [{
        predicateId: "next",
        label: "次の工程",
        paths: [
          { predicateIds: ["opaque-next", "opaque-process"], labels: ["次の工程", "工程関係"] },
          { predicateIds: ["opaque-next", "opaque-related"], labels: ["次の工程", "関連"] },
        ],
        diagnostics: [{ code: "hierarchy-cycle", message: "上位関係に循環があります。", labels: ["工程関係"] }],
        truncated: true,
      }],
      queryExplanation: "検索では意味上の上位関係としても扱います。",
      validationExplanation: "検証では選択した関係だけを扱います。",
    };
    const wizard = child(mountControlled(state, { predicateHierarchy: hierarchy }));
    expect(wizard.text()).toContain("次の工程 → 工程関係");
    expect(wizard.text()).toContain("次の工程 → 関連");
    expect(wizard.text()).toContain("関係階層の設定を管理者に確認してください。");
    expect(wizard.text()).not.toContain("上位関係に循環があります。");
    expect(wizard.text()).toContain("一部だけを表示");
    expect(wizard.text()).toContain(hierarchy.queryExplanation);
    expect(wizard.text()).toContain(hierarchy.validationExplanation);
    expect(wizard.html()).not.toContain("http://");
  });

  it("membershipにinline新規要素をchip追加しSeqを並べ替える", async () => {
    let state = step(createStructuredAuthoringFlow(), {
      type: "choose-intent",
      intent: "add-relation",
      preselection: [choice("seq", "group", "sequence"), choice("a")],
    });
    state = step(state, { type: "choose-relation-family", family: "membership" });
    state = step(state, { type: "next" });
    const host = mountControlled(state);
    const wizard = child(host);
    expect(wizard.text()).toContain("注文を受ける");
    await wizard.get(".inline-create summary").trigger("click");
    await wizard.get(".inline-create input").setValue("箱に入れる");
    await clickButton(wizard, "作業");
    await clickButton(wizard, "一覧へ追加");
    expect(wizard.text()).toContain("箱に入れる");
    await clickButton(wizard, "次へ");
    expect(wizard.findAll(".ordered-members li")).toHaveLength(2);
    await clickButton(wizard, "箱に入れるを上へ", true);
    expect(wizard.find(".ordered-members li strong").text()).toBe("箱に入れる");
    await clickButton(wizard, "次へ");
    expect(wizard.text()).not.toContain("実行する");
    expect(wizard.emitted("submit")?.[0]?.[0]).toMatchObject({ type: "set-group-members" });
  });

  it("候補グループは2件と既定候補を必須にし、選んだ既定を先頭へ移す", async () => {
    let state = step(createStructuredAuthoringFlow(), {
      type: "choose-intent", intent: "add-relation",
      preselection: [choice("alt", "group", "alternative"), choice("a"), choice("b")],
    });
    state = step(state, { type: "choose-relation-family", family: "membership" });
    state = step(state, { type: "next" });
    state = step(state, { type: "next" });
    const host = mountControlled(state);
    const wizard = child(host);
    expect(button(wizard, "次へ").attributes()).toHaveProperty("disabled");
    await clickButton(wizard, "ピザを焼く");
    expect(wizard.find(".alternative-list button strong").text()).toBe("ピザを焼く");
    expect(button(wizard, "次へ").attributes()).not.toHaveProperty("disabled");
  });

  it("edit actionはpure reducerのfocus destinationをemitする", async () => {
    const state = step(createStructuredAuthoringFlow(), {
      type: "choose-intent", intent: "edit-element", preselection: [choice("a")],
    });
    const host = mountControlled(state);
    const wizard = child(host);
    await clickButton(wizard, "名前・説明・種類を変更");
    expect(wizard.emitted("focusDestination")?.[0]).toEqual([{
      type: "focus",
      intent: { kind: "inspector", destination: "element-details" },
    }]);

    const deleteHost = mountControlled(state);
    const deleteWizard = child(deleteHost);
    await clickButton(deleteWizard, "要素を削除");
    expect(deleteWizard.emitted("focusDestination")?.[0]).toEqual([{
      type: "focus",
      intent: { kind: "inspector", destination: "delete" },
    }]);
    expect(deleteWizard.emitted("submit")).toBeUndefined();
  });

  it("groupの関係変更には対象不明な関係削除を表示しない", () => {
    const state = step(createStructuredAuthoringFlow(), {
      type: "choose-intent",
      intent: "edit-relation",
      preselection: [choice("seq", "group", "sequence")],
    });
    const host = mountControlled(state);
    const wizard = child(host);
    expect(wizard.text()).toContain("所属・順序・候補を変更");
    expect(wizard.text()).not.toContain("関係を削除");
  });

  it("validation/stale error、busy/readOnly、狭幅contractを表示する", () => {
    let state = directReadyState();
    state = step(state, { type: "submit", requestId: "attempt" });
    state = step(state, {
      type: "submit-failed",
      errorKind: "stale",
      diagnostics: [{ severity: "error", code: "unknown-term-introduced", message: "hidden technical detail" }],
    });
    const host = mountControlled(state, { readOnly: true });
    const wizard = child(host);
    expect(wizard.get(".structured-wizard").attributes("data-responsive")).toBe("narrow");
    expect(wizard.get("[role='alert']").text()).toContain("未登録の種類または関係");
    expect(wizard.text()).not.toContain("hidden technical detail");
    expect(wizard.text()).toContain("読み取り専用のため変更できません。");

    const busy = child(mountControlled(createStructuredAuthoringFlow(), { busy: true }));
    expect(busy.get(".structured-wizard").attributes("aria-busy")).toBe("true");
    expect(busy.findAll(".entry-card").every((entry) => entry.attributes("disabled") !== undefined)).toBe(true);
  });
});

function mountControlled(
  initialState: StructuredAuthoringFlowState,
  options: {
    presentation?: StructuredAuthoringPresentation;
    predicateHierarchy?: StructuredPredicateHierarchyPresentation;
    readOnly?: boolean;
    busy?: boolean;
    attach?: boolean;
  } = {},
) {
  const Host = defineComponent({
    setup() {
      const state = ref(initialState);
      const onTransition = (event: StructuredAuthoringFlowEvent) => {
        state.value = reduceStructuredAuthoringFlow(state.value, event).state;
      };
      return () => h(StructuredAuthoringWizard, {
        state: state.value,
        presentation: options.presentation ?? presentation,
        predicateHierarchy: options.predicateHierarchy,
        canvasOptions,
        requestId: "component-request",
        readOnly: options.readOnly,
        busy: options.busy,
        onTransition,
      });
    },
  });
  return mount(Host, options.attach ? { attachTo: document.body } : undefined);
}

function child(host: VueWrapper): VueWrapper<any> {
  return host.getComponent(StructuredAuthoringWizard) as unknown as VueWrapper<any>;
}

async function clickButton(wrapper: VueWrapper, text: string, ariaLabel = false): Promise<void> {
  await button(wrapper, text, ariaLabel).trigger("click");
  await nextTick();
}

function button(wrapper: VueWrapper, text: string, ariaLabel = false) {
  const result = wrapper.findAll("button").find((item) => (
    ariaLabel ? item.attributes("aria-label") === text : item.text().includes(text)
  ));
  if (!result) throw new Error(`button not found: ${text}`);
  return result;
}

function step(state: StructuredAuthoringFlowState, event: StructuredAuthoringFlowEvent): StructuredAuthoringFlowState {
  return reduceStructuredAuthoringFlow(state, event).state;
}

function directReadyState(): StructuredAuthoringFlowState {
  let state = step(createStructuredAuthoringFlow(), {
    type: "choose-intent", intent: "add-relation", preselection: [choice("a"), choice("b")],
  });
  state = step(state, { type: "choose-relation-family", family: "direct" });
  state = step(state, { type: "next" });
  state = step(state, { type: "next" });
  state = step(state, { type: "set-common-predicate", predicateId: "next" });
  return step(state, { type: "next" });
}

function option(
  elementId: string,
  label: string,
  kind: FlowCanvasChoice["kind"],
  groupKind?: FlowCanvasChoice["groupKind"],
  shape?: "rectangle" | "rounded" | "circle" | "diamond" | "group",
) {
  return { selection: selection(elementId), label, kind, groupKind, shape };
}

function choice(
  elementId: string,
  kind: FlowCanvasChoice["kind"] = "node",
  groupKind?: FlowCanvasChoice["groupKind"],
): FlowCanvasChoice {
  return { selection: selection(elementId), kind, groupKind };
}

function selection(elementId: string) {
  return { viewId: "main", elementId };
}
