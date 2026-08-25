import { describe, expect, it } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";

import { statementIdentityForNamedStatement } from "@iriograph/core";

import SemanticIntentPanel from "./SemanticIntentPanel.vue";

describe("SemanticIntentPanel", () => {
  it("初期状態はCanvas選択の概要と2つの追加入口だけを表示する", () => {
    const wrapper = mount(SemanticIntentPanel);
    expect(wrapper.findAll(".iriograph-intent-grid button").map((button) => button.text())).toEqual([
      "＋要素を追加",
      "→関係を追加",
    ]);
    expect(wrapper.text()).toContain("Canvasで要素か関係を選択");
    expect(wrapper.find('input[placeholder*="urn:"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain("IRI");
  });

  it("新規要素は名前だけをallocator向けdraftへ渡す", async () => {
    const wrapper = mount(SemanticIntentPanel, { attachTo: document.body });
    await click(wrapper, "要素を追加");
    const name = wrapper.get<HTMLTextAreaElement>('textarea[aria-label="新しい要素の名前"]');
    expect(document.activeElement).toBe(name.element);
    await name.setValue("見積確認");
    await click(wrapper, "要素を作成");
    const draft = wrapper.emitted("executeDraft")?.[0]?.[0] as Record<string, unknown>;
    expect(draft).toMatchObject({ kind: "create-resource", label: "見積確認" });
    expect(draft.classIris).toEqual([]);
    expect(draft.initialX).toBe("");
    expect(draft.initialY).toBe("");
    expect(draft.createMembershipEnabled).toBe(false);
    wrapper.unmount();
  });

  it("Canvasの先頭選択をbase、残りをpartnersとして同じpredicateで一括作成する", async () => {
    const wrapper = mount(SemanticIntentPanel, { props: {
      selectedResources: [
        { iri: "urn:test:a", label: "申請" },
        { iri: "urn:test:b", label: "審査" },
        { iri: "urn:test:c", label: "承認" },
      ],
      predicates: [{
        iri: "urn:test:precedes",
        label: "先行する",
        description: "前後関係",
        category: "依存・順序",
        sentencePattern: "AはBに先行する",
      }],
    } });
    await click(wrapper, "関係を追加");
    expect(wrapper.text()).toContain("依存・順序");
    expect(wrapper.text()).toContain("A（先行する）B");
    expect(wrapper.text()).toContain("AはBに先行する");
    await wrapper.get<HTMLInputElement>('input[type="radio"]').setValue(true);
    await click(wrapper, "関係を作成");
    expect(wrapper.emitted("executeDraft")?.[0]?.[0]).toMatchObject({
      kind: "connect-resources",
      sourceIri: "urn:test:a",
      targetIri: "urn:test:b",
      targetIris: ["urn:test:c"],
      predicateIri: "urn:test:precedes",
    });
  });

  it("derived Seq edgeは理由を示して直接変更を提供しない", async () => {
    const wrapper = mount(SemanticIntentPanel, { props: {
      selectedEdge: {
        label: "順序 1→2", sourceIri: "urn:test:a", sourceLabel: "A",
        predicateIri: "urn:test:member", targetIri: "urn:test:b", targetLabel: "B",
        derivedReason: "この線は並び順から自動生成されています。",
      },
    } });
    await click(wrapper, "関係の意味を編集");
    expect(wrapper.text()).toContain("並び順から自動生成");
    expect(wrapper.text()).not.toContain("この関係を削除");
  });

  it("関係変更を開始した後のCanvas edge選択を編集fieldへ同期する", async () => {
    const wrapper = mount(SemanticIntentPanel, { props: {
      predicates: [{ iri: "urn:test:rel", label: "関連する" }],
    } });
    await wrapper.setProps({ requestedIntent: "edit-relation" });
    expect(wrapper.text()).toContain("Canvasで要素を選び");
    await wrapper.setProps({ selectedEdge: {
      label: "A（関連する）B",
      sourceIri: "urn:test:a",
      sourceLabel: "A",
      predicateIri: "urn:test:rel",
      targetIri: "urn:test:b",
      targetLabel: "B",
      capability: {
        command: "remove-statement",
        statementRef: "urn:test:statement:1",
        subject: "urn:test:a",
        predicate: "urn:test:rel",
        object: "urn:test:b",
      },
    } });
    expect(wrapper.get<HTMLSelectElement>("select").element.value).toBe("urn:test:rel");
    expect(wrapper.get("optgroup").attributes("label")).toBe("その他の関係");
    expect(wrapper.get("option").text()).toBe("A（関連する）B — A（関連する）B");
    expect(wrapper.text()).toContain("A");
    expect(wrapper.text()).toContain("B");
  });

  it("端点変更と個別説明を新しいexact S-P-Oへ同じpreviewで引き継ぐ", async () => {
    const original = { subjectIri: "urn:test:a", predicateIri: "urn:test:rel", objectIri: "urn:test:b" };
    const wrapper = mount(SemanticIntentPanel, { props: {
      selectedResources: [{ iri: "urn:test:c", label: "C" }],
      predicates: [{ iri: "urn:test:rel", label: "関連する" }],
      selectedEdge: {
        label: "A（関連する）B",
        sourceIri: original.subjectIri,
        sourceLabel: "A",
        predicateIri: original.predicateIri,
        targetIri: original.objectIri,
        targetLabel: "B",
        statementComments: [{ value: "この矢印だけの説明", language: "ja" }],
        capability: {
          command: "remove-statement",
          statementRef: statementIdentityForNamedStatement(original),
          subject: original.subjectIri,
          predicate: original.predicateIri,
          object: original.objectIri,
        },
      },
    } });
    await click(wrapper, "関係の意味を編集");
    expect(wrapper.get<HTMLTextAreaElement>('textarea[aria-label="この関係だけの説明 1"]').element.value)
      .toBe("この矢印だけの説明");
    await wrapper.setProps({ pickedTargetIri: "urn:test:c" });
    await click(wrapper, "関係を更新");
    const commands = wrapper.emitted("executeCommands")?.[0]?.[0] as Array<Record<string, unknown>>;
    expect(commands.map((command) => command.type)).toEqual([
      "remove-statement", "connect-resources", "set-statement-comments",
    ]);
    expect(commands[2]).toMatchObject({
      statementRef: statementIdentityForNamedStatement({
        subjectIri: "urn:test:a", predicateIri: "urn:test:rel", objectIri: "urn:test:c",
      }),
      subjectIri: "urn:test:a",
      predicateIri: "urn:test:rel",
      objectIri: "urn:test:c",
      comments: [{ kind: "literal", value: "この矢印だけの説明", language: "ja" }],
    });
  });

  it("複数選択の所属追加を領域単位のbatch commandにする", async () => {
    const wrapper = mount(SemanticIntentPanel, { props: {
      selectedResources: [{ iri: "urn:test:a", label: "A" }, { iri: "urn:test:b", label: "B" }],
      memberships: [{
        containerIri: "urn:test:region", label: "担当領域", containerTypeIri: "urn:test:Class",
        predicateIri: "http://www.w3.org/2000/01/rdf-schema#member", containerPosition: "subject" as const,
        memberIris: [],
      }],
    } });
    await click(wrapper, "所属・並び順を編集");
    await wrapper.get("select").setValue("add");
    await click(wrapper, "所属を更新");
    const commands = wrapper.emitted("executeCommands")?.[0]?.[0] as Array<Record<string, unknown>>;
    expect(commands).toHaveLength(2);
    expect(commands.map((command) => command.memberIri)).toEqual(["urn:test:a", "urn:test:b"]);
    expect(commands.every((command) => command.type === "set-membership" && command.enabled === true)).toBe(true);
  });

  it("所属batchでは対象領域自身をmemberにしない", async () => {
    const wrapper = mount(SemanticIntentPanel, { props: {
      selectedResources: [{ iri: "urn:test:region", label: "領域" }, { iri: "urn:test:a", label: "A" }],
      memberships: [{
        containerIri: "urn:test:region", label: "領域", containerTypeIri: "urn:test:Class",
        predicateIri: "http://www.w3.org/2000/01/rdf-schema#member", containerPosition: "subject" as const,
        memberIris: [],
      }],
    } });
    await click(wrapper, "所属・並び順を編集");
    await wrapper.get("select").setValue("add");
    await click(wrapper, "所属を更新");
    const commands = wrapper.emitted("executeCommands")?.[0]?.[0] as Array<Record<string, unknown>>;
    expect(commands.map((command) => command.memberIri)).toEqual(["urn:test:a"]);
  });

  it("Seqを通常edgeと分けて番号付きmemberの並べ替えとしてpreviewする", async () => {
    const wrapper = mount(SemanticIntentPanel, { props: {
      selectedResources: [{ iri: "urn:test:seq", label: "審査手順" }],
      sequences: [{
        sequenceIri: "urn:test:seq",
        label: "審査手順",
        sequenceTypeIri: "http://www.w3.org/1999/02/22-rdf-syntax-ns#Seq",
        ordinalPredicatePrefix: "http://www.w3.org/1999/02/22-rdf-syntax-ns#_",
        memberIris: ["urn:test:a", "urn:test:b"],
        members: [{ iri: "urn:test:a", label: "受付" }, { iri: "urn:test:b", label: "審査" }],
      }],
    } });
    await click(wrapper, "所属・並び順を編集");
    expect(wrapper.text()).toContain("通常の関係線とは別の構造");
    await wrapper.get('button[aria-label="受付を後ろへ"]').trigger("click");
    await click(wrapper, "並び順を更新");
    expect(wrapper.emitted("executeCommands")?.[0]?.[0]).toEqual([{
      type: "set-sequence",
      commandId: "intent-sequence",
      sequenceIri: "urn:test:seq",
      memberIris: ["urn:test:b", "urn:test:a"],
      sequenceTypeIri: "http://www.w3.org/1999/02/22-rdf-syntax-ns#Seq",
      ordinalPredicatePrefix: "http://www.w3.org/1999/02/22-rdf-syntax-ns#_",
    }]);
  });

  it("要素削除はEditorの選択削除フローへ委譲する", async () => {
    const wrapper = mount(SemanticIntentPanel, { props: {
      elementDetails: {
        iri: "urn:test:a",
        label: "申請",
        classIris: [],
        labelValues: [{ value: "申請", language: "ja" }],
        commentValues: [],
      },
    } });
    await click(wrapper, "要素の詳細を編集");
    expect(wrapper.text()).toContain("選択外の関係や並び順");
    await click(wrapper, "選択した要素を削除");
    expect(wrapper.emitted("deleteSelection")).toHaveLength(1);
  });

  it("要素の種類と業務上の所属を分け、概念領域のtypeを二重編集しない", async () => {
    const wrapper = mount(SemanticIntentPanel, { props: {
      elementDetails: {
        iri: "urn:test:a", label: "申請", classIris: ["urn:test:Application"],
        labelValues: [{ value: "申請", language: "ja" }], commentValues: [],
      },
      classes: [
        { iri: "urn:test:Application", label: "申請の種類" },
        { iri: "urn:test:Task", label: "業務要素" },
      ],
      memberships: [
        {
          containerIri: "urn:test:Application", label: "申請の概念領域",
          containerTypeIri: "http://www.w3.org/2000/01/rdf-schema#Class",
          predicateIri: "http://www.w3.org/1999/02/22-rdf-syntax-ns#type",
          containerPosition: "object", memberIris: ["urn:test:a"],
        },
        {
          containerIri: "urn:test:Lane", label: "審査担当領域",
          containerTypeIri: "http://www.w3.org/1999/02/22-rdf-syntax-ns#Bag",
          predicateIri: "http://www.w3.org/2000/01/rdf-schema#member",
          containerPosition: "subject", memberIris: ["urn:test:a"],
        },
      ],
      selectedResources: [{ iri: "urn:test:a", label: "申請" }],
    } });
    await click(wrapper, "要素の詳細を編集");
    expect(wrapper.get(".iriograph-semantic-type-editor").text()).toContain("申請の種類");
    expect(wrapper.get(".iriograph-semantic-type-editor").text()).toContain("概念領域にも反映");
    expect(wrapper.get(".iriograph-current-memberships").text()).toContain("概念領域（上の「要素の種類」と同じ設定）");
    expect(wrapper.get(".iriograph-current-memberships").text()).toContain("審査担当領域");
    await wrapper.get('button[aria-label="選択内容へ戻る"]').trigger("click");
    await click(wrapper, "所属・並び順を編集");
    expect(wrapper.get(".iriograph-membership-editor").text()).toContain("審査担当領域");
    expect(wrapper.get(".iriograph-membership-editor").text()).not.toContain("申請の概念領域");
  });

  it("nodeの入出力関係と相手を一覧表示し重なりedgeへfocusできる", async () => {
    const wrapper = mount(SemanticIntentPanel, { props: {
      elementDetails: {
        iri: "urn:test:a", label: "申請", classIris: [],
        labelValues: [{ value: "申請" }], commentValues: [],
      },
      selectedResources: [{ iri: "urn:test:a", label: "申請" }],
      incidentRelations: [{
        edgeElementId: "edge:approval", sourceIri: "urn:test:a", sourceLabel: "申請",
        predicateIri: "urn:test:requires", predicateLabel: "必要とする",
        targetIri: "urn:test:b", targetLabel: "本人確認", direction: "outgoing",
      }],
    } });
    await click(wrapper, "要素の詳細を編集");
    const overview = wrapper.get('[aria-label="接続している関係"]');
    expect(overview.text()).toContain("申請（必要とする）本人確認");
    expect(overview.text()).toContain("この要素から出る関係");
    await click(wrapper, "Canvasで確認");
    expect(wrapper.emitted("focusElement")?.[0]).toEqual(["edge:approval"]);
  });

  it("外部gestureから関係変更intentを開始してもPreviewまでは意味変更をemitしない", async () => {
    const wrapper = mount(SemanticIntentPanel, { props: {
      requestedIntent: undefined,
      predicates: [{ iri: "urn:test:rel", label: "関連する" }],
      selectedEdge: {
        label: "申請（関連する）審査", sourceIri: "urn:test:a", sourceLabel: "申請",
        predicateIri: "urn:test:rel", targetIri: "urn:test:b", targetLabel: "審査",
        capability: {
          command: "remove-statement", statementRef: "statement:1",
          subject: "urn:test:a", predicate: "urn:test:rel", object: "urn:test:b",
        },
      },
    } });
    await wrapper.setProps({ requestedIntent: "edit-relation" });
    expect(wrapper.text()).toContain("接続している要素");
    expect(wrapper.text()).toContain("始点申請");
    expect(wrapper.emitted("executeCommands")).toBeUndefined();
  });

  it("選択概要はraw IRIでなく人が読める関係を先に表示する", () => {
    const wrapper = mount(SemanticIntentPanel, { props: { selectedEdge: {
      label: "申請から承認者", sourceIri: "urn:test:a", sourceLabel: "申請",
      predicateIri: "urn:test:rel", targetIri: "urn:test:b", targetLabel: "承認者",
    }, predicates: [{ iri: "urn:test:rel", label: "承認を依頼する" }] } });
    expect(wrapper.get(".iriograph-semantic-selection-summary").text())
      .toContain("申請（承認を依頼する）承認者");
    expect(wrapper.text()).not.toContain("urn:test");
  });

  it("主表示名だけを変更しても他言語labelと複数commentをlosslessに保つ", async () => {
    const wrapper = mount(SemanticIntentPanel, { props: {
      elementDetails: {
        iri: "urn:test:a", label: "申請", classIris: [],
        labelValues: [{ value: "申請", language: "ja" }, { value: "Application", language: "en" }],
        commentValues: [{ value: "業務説明", language: "ja" }, { value: "Business note", language: "en" }],
      },
    } });
    await click(wrapper, "要素の詳細を編集");
    await wrapper.get<HTMLTextAreaElement>('textarea[aria-label="要素の名前"]').setValue("申請書");
    await click(wrapper, "変更を保存");
    const commands = wrapper.emitted("executeCommands")?.[0]?.[0] as Array<Record<string, unknown>>;
    expect(commands).toHaveLength(1);
    expect(commands[0]?.values).toEqual([
      { kind: "literal", value: "申請書", language: "ja" },
      { kind: "literal", value: "Application", language: "en" },
    ]);
  });
});

async function click(wrapper: VueWrapper, text: string): Promise<void> {
  const button = wrapper.findAll("button").find((candidate) => candidate.text().includes(text));
  if (!button) throw new Error(`${text} button not found`);
  await button.trigger("click");
}
