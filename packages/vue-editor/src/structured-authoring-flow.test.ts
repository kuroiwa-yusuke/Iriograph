import { describe, expect, it } from "vitest";

import {
  createStructuredAuthoringFlow,
  memberKey,
  reduceStructuredAuthoringFlow,
  STRUCTURED_AUTHORING_INTENT_OPTIONS,
  STRUCTURED_ELEMENT_KIND_OPTIONS,
  STRUCTURED_RELATION_FAMILY_OPTIONS,
  structuredAuthoringRequestForDraft,
  structuredAuthoringStepStatus,
  type FlowCanvasChoice,
  type StructuredAuthoringFlowEvent,
  type StructuredAuthoringFlowState,
} from "./structured-authoring-flow";

describe("structured authoring flow", () => {
  it("初期blurの4入口から一段ずつ進みBack/Escapeでdraftだけを破棄する", () => {
    expect(STRUCTURED_AUTHORING_INTENT_OPTIONS.map((option) => option.label)).toEqual([
      "新しい要素を作る", "関係を作る", "要素を変更する", "関係を変更する",
    ]);
    expect(STRUCTURED_ELEMENT_KIND_OPTIONS.map((option) => option.elementKind)).toEqual(["node", "group"]);
    expect(STRUCTURED_RELATION_FAMILY_OPTIONS.map((option) => [option.family, option.iconToken])).toEqual([
      ["direct", "relation-direct"],
      ["membership", "relation-membership"],
    ]);
    const intents = ["add-element", "add-relation", "edit-element", "edit-relation"] as const;
    const expected = ["element-kind", "relation-family", "edit-element-select", "edit-relation-select"];
    intents.forEach((intent, index) => {
      const opened = transition(createStructuredAuthoringFlow(), {
        type: "choose-intent",
        intent,
        openerFocusId: "flow-button",
      });
      expect(opened.state.phase).toBe(expected[index]);
      const backed = transition(opened.state, { type: "back" });
      expect(backed.state.phase).toBe("intent");
      const cancelled = transition(opened.state, { type: "escape" });
      expect(cancelled.state.phase).toBe("intent");
      expect(cancelled.effect).toEqual({ type: "cancelled", focusId: "flow-button" });
    });
  });

  it("node/group→種類→名前を確認画面なしの一atomic requestへcompileする", () => {
    let state = transition(createStructuredAuthoringFlow(), {
      type: "choose-intent", intent: "add-element",
    }).state;
    state = transition(state, { type: "choose-element-kind", elementKind: "node" }).state;
    expect(state.phase).toBe("node-roles");
    expect(structuredAuthoringStepStatus(state).canContinue).toBe(false);
    state = transition(state, { type: "set-node-roles", nodeRoleIds: ["task", "task"] }).state;
    state = transition(state, { type: "next" }).state;
    state = transition(state, { type: "set-label", label: "  承認  " }).state;
    state = transition(state, { type: "next" }).state;
    const submitted = transition(state, { type: "submit", requestId: "create-1" });
    expect(submitted.state.phase).toBe("submitting");
    expect(submitted.effect).toEqual({
      type: "submit",
      request: {
        type: "create-element",
        requestId: "create-1",
        element: { kind: "node", label: "承認", nodeRoleIds: ["task"] },
      },
    });

    const untyped = createStructuredAuthoringFlow({ allowUntypedNodes: true });
    state = transition(untyped, { type: "choose-intent", intent: "add-element" }).state;
    state = transition(state, { type: "choose-element-kind", elementKind: "node" }).state;
    expect(structuredAuthoringStepStatus(state).canContinue).toBe(true);

    state = transition(createStructuredAuthoringFlow(), {
      type: "choose-intent", intent: "add-element",
    }).state;
    state = transition(state, { type: "choose-element-kind", elementKind: "group" }).state;
    state = transition(state, { type: "set-group-kind", groupKind: "alternative" }).state;
    state = transition(state, { type: "next" }).state;
    state = transition(state, { type: "set-label", label: "候補グループ" }).state;
    state = transition(state, { type: "next" }).state;
    expect(structuredAuthoringRequestForDraft(readyDraft(state), "group-1")).toMatchObject({
      type: "create-element",
      element: { kind: "group", groupKind: "alternative", label: "候補グループ" },
    });
  });

  it("directは0/1/複数事前選択を役割へseedし共通/行別predicateを保持する", () => {
    for (const count of [0, 1, 3]) {
      const selected = [choice("a"), choice("b"), choice("c")].slice(0, count);
      let state = transition(createStructuredAuthoringFlow(), {
        type: "choose-intent", intent: "add-relation", preselection: selected,
      }).state;
      state = transition(state, { type: "choose-relation-family", family: "direct" }).state;
      expect(state.phase).toBe("direct-source");
      if (state.phase !== "direct-source") return;
      expect(state.draft.source?.elementId).toBe(count ? "a" : undefined);
      expect(state.draft.targets.map((target) => target.elementId)).toEqual(
        count > 1 ? selected.slice(1).map((item) => item.selection.elementId) : [],
      );
    }

    let state = directReadyState();
    state = transition(state, { type: "set-row-predicate", target: selection("c"), predicateId: "depends" }).state;
    if (state.phase !== "direct-predicate") throw new Error("expected predicate phase");
    const request = structuredAuthoringRequestForDraft(state.draft, "relations-1");
    expect(request).toEqual({
      type: "create-direct-relations",
      requestId: "relations-1",
      source: selection("a"),
      predicateId: "relates",
      targets: [
        { target: selection("b"), predicateId: undefined },
        { target: selection("c"), predicateId: "depends" },
      ],
    });

    state = directReadyState();
    state = transition(state, { type: "set-common-predicate", predicateId: "" }).state;
    state = transition(state, { type: "set-row-predicate", target: selection("b"), predicateId: "precedes" }).state;
    state = transition(state, { type: "set-row-predicate", target: selection("c"), predicateId: "depends" }).state;
    expect(structuredAuthoringStepStatus(state).canContinue).toBe(true);
    if (state.phase !== "direct-predicate") throw new Error("expected predicate phase");
    expect(structuredAuthoringRequestForDraft(state.draft, "row-relations")).toEqual({
      type: "create-direct-relations",
      requestId: "row-relations",
      source: selection("a"),
      targets: [
        { target: selection("b"), predicateId: "precedes" },
        { target: selection("c"), predicateId: "depends" },
      ],
    });
  });

  it("familyを戻って切り替えてもdirect draftをmembershipへ変換しない", () => {
    const preselection = [choice("a"), choice("group", "group", "membership")];
    let state = transition(createStructuredAuthoringFlow(), {
      type: "choose-intent", intent: "add-relation", preselection,
    }).state;
    state = transition(state, { type: "choose-relation-family", family: "direct" }).state;
    state = transition(state, { type: "set-direct-targets", targets: [selection("custom-target")] }).state;
    state = transition(state, { type: "back" }).state;
    expect(state.phase).toBe("relation-family");
    state = transition(state, { type: "choose-relation-family", family: "membership" }).state;
    expect(state.phase).toBe("membership-group");
    if (state.phase !== "membership-group") return;
    expect(state.draft.group?.elementId).toBe("group");
    expect(state.draft.members.map(memberKey)).toEqual([`existing:${selectionKeyForTest("a")}`]);
    expect(JSON.stringify(state)).not.toContain("custom-target");
  });

  it("既存memberと同名inline chipを混在しSeqの順番を保持する", () => {
    let state = membershipState("sequence", [choice("a"), choice("seq", "group", "sequence")]);
    state = transition(state, { type: "next" }).state;
    expect(state.phase).toBe("membership-members");
    state = transition(state, {
      type: "add-inline-member",
      member: { kind: "new-node", clientId: "new-1", label: "同名", nodeRoleIds: ["task"] },
    }).state;
    state = transition(state, {
      type: "add-inline-member",
      member: { kind: "new-node", clientId: "new-2", label: "同名", nodeRoleIds: ["task"] },
    }).state;
    state = transition(state, { type: "next" }).state;
    expect(state.phase).toBe("sequence-order");
    state = transition(state, { type: "move-member", memberKey: "new:new-2", direction: "up" }).state;
    if (state.phase !== "sequence-order") return;
    const request = structuredAuthoringRequestForDraft(state.draft, "seq-members");
    expect(request?.type).toBe("set-group-members");
    if (request?.type !== "set-group-members") return;
    expect(request.members.map((member) => member.kind === "new-node" ? member.clientId : member.selection.elementId))
      .toEqual(["a", "new-2", "new-1"]);
    expect(request.members.filter((member) => member.kind === "new-node").map((member) => member.label))
      .toEqual(["同名", "同名"]);
  });

  it("Seq/Altの同一resource複数occurrenceはidentityを保ちrequestでは同じselectionとして残す", () => {
    let state = membershipState("sequence", [choice("seq", "group", "sequence")]);
    state = transition(state, {
      type: "set-members",
      members: [
        { kind: "existing", selection: selection("a"), occurrenceId: "statement:_1" },
        { kind: "existing", selection: selection("a"), occurrenceId: "statement:_2" },
      ],
    }).state;
    expect(state.phase).toBe("membership-group");
    if (state.phase !== "membership-group") return;
    expect(state.draft.members.map(memberKey)).toEqual([
      `existing:${selectionKeyForTest("a")}:statement:_1`,
      `existing:${selectionKeyForTest("a")}:statement:_2`,
    ]);
    state = transition(state, { type: "next" }).state;
    state = transition(state, { type: "next" }).state;
    if (state.phase !== "sequence-order") throw new Error(`expected sequence-order, got ${state.phase}`);
    const request = structuredAuthoringRequestForDraft(state.draft, "duplicate-occurrences");
    expect(request?.type).toBe("set-group-members");
    if (request?.type !== "set-group-members") return;
    expect(request.members).toEqual([
      { kind: "existing", selection: selection("a") },
      { kind: "existing", selection: selection("a") },
    ]);
  });

  it("候補グループの既定候補を先頭slotへ揃えてCore requestにする", () => {
    let state = membershipState("alternative", [
      choice("a"), choice("b"), choice("alt", "group", "alternative"),
    ]);
    state = transition(state, { type: "next" }).state;
    state = transition(state, { type: "next" }).state;
    expect(state.phase).toBe("alternative-default");
    state = transition(state, {
      type: "set-alternative-default",
      memberKey: `existing:${selectionKeyForTest("b")}`,
    }).state;
    if (state.phase !== "alternative-default") return;
    expect(state.draft.members.map((member) => memberKey(member))).toEqual([
      `existing:${selectionKeyForTest("b")}`,
      `existing:${selectionKeyForTest("a")}`,
    ]);
    const request = structuredAuthoringRequestForDraft(state.draft, "alt-members");
    expect(request).toMatchObject({ type: "set-group-members", defaultMemberIndex: 0 });
  });

  it("validation/stale errorはdraftを保持しretry可能、成功時だけreset/focusする", () => {
    let state = directReadyState();
    state = transition(state, { type: "next" }).state;
    expect(state.phase).toBe("ready");
    state = transition(state, { type: "submit", requestId: "attempt-1" }).state;
    state = transition(state, {
      type: "submit-failed",
      errorKind: "stale",
      diagnostics: [{ severity: "error", code: "stale", message: "選び直してください" }],
    }).state;
    expect(state.phase).toBe("error");
    if (state.phase !== "error") return;
    expect(state.errorKind).toBe("stale");
    expect(state.draft.family).toBe("direct");
    const retried = transition(state, { type: "submit", requestId: "attempt-2" });
    expect(retried.state).toMatchObject({ phase: "submitting", request: { requestId: "attempt-2" } });
    const succeeded = transition(retried.state, {
      type: "submit-succeeded",
      focusIntent: { kind: "canvas", elementId: "created-node" },
    });
    expect(succeeded.state).toMatchObject({ phase: "intent", preselection: [] });
    expect(succeeded.effect).toEqual({
      type: "focus", intent: { kind: "canvas", elementId: "created-node" },
    });
  });

  it("進行中draftを別入口や遅延responseで上書きせず、送信中はCancelを受け付けない", () => {
    const active = transition(createStructuredAuthoringFlow(), {
      type: "choose-intent", intent: "add-element", openerFocusId: "entry",
    }).state;
    expect(transition(active, { type: "choose-intent", intent: "add-relation" }).state).toBe(active);
    expect(transition(active, { type: "submit-succeeded" }).state).toBe(active);

    let state = directReadyState();
    state = transition(state, { type: "next" }).state;
    state = transition(state, { type: "submit", requestId: "pending" }).state;
    expect(state.phase).toBe("submitting");
    expect(transition(state, { type: "cancel" }).state).toBe(state);
  });

  it("inline memberは名前とprofile上必要な種類が揃うまで次へ進めない", () => {
    let state = membershipState("sequence", [choice("seq", "group", "sequence")]);
    state = transition(state, { type: "next" }).state;
    state = transition(state, {
      type: "add-inline-member",
      member: { kind: "new-node", clientId: "new-1", label: "", nodeRoleIds: [] },
    }).state;
    expect(structuredAuthoringStepStatus(state)).toMatchObject({ canContinue: false });
    state = transition(state, {
      type: "update-inline-member", clientId: "new-1", label: "新規要素", nodeRoleIds: ["task"],
    }).state;
    expect(structuredAuthoringStepStatus(state)).toMatchObject({ canContinue: true });
  });

  it("要素/関係変更はCanvas選択後に対象別focus intentまたはdelete requestへ進む", () => {
    let state = transition(createStructuredAuthoringFlow(), {
      type: "choose-intent",
      intent: "edit-element",
      preselection: [choice("a")],
    }).state;
    expect(state.phase).toBe("edit-element-action");
    const details = transition(state, { type: "choose-edit-element-action", action: "details" });
    expect(details.effect).toEqual({
      type: "focus", intent: { kind: "inspector", destination: "element-details" },
    });
    state = transition(state, { type: "choose-edit-element-action", action: "delete" }).state;
    expect(structuredAuthoringRequestForDraft(readyDraft(state), "delete-1")).toBeUndefined();

    const deleteFocus = transition(
      transition(createStructuredAuthoringFlow(), {
        type: "choose-intent", intent: "edit-element", preselection: [choice("a")],
      }).state,
      { type: "choose-edit-element-action", action: "delete" },
    );
    expect(deleteFocus.effect).toEqual({
      type: "focus", intent: { kind: "inspector", destination: "delete" },
    });

    state = transition(createStructuredAuthoringFlow(), {
      type: "choose-intent",
      intent: "edit-relation",
      preselection: [choice("edge-1", "direct-edge")],
    }).state;
    const reconnect = transition(state, { type: "choose-edit-relation-action", action: "reconnect" });
    expect(reconnect.effect).toEqual({
      type: "focus", intent: { kind: "inspector", destination: "relation-reconnect" },
    });

    state = transition(createStructuredAuthoringFlow(), {
      type: "choose-intent",
      intent: "edit-element",
      preselection: [choice("group-1", "group", "sequence")],
    }).state;
    expect(state).toMatchObject({
      phase: "edit-element-action",
      draft: { target: selection("group-1") },
    });

    state = transition(createStructuredAuthoringFlow(), {
      type: "choose-intent",
      intent: "edit-element",
      preselection: [choice("a"), choice("b")],
    }).state;
    expect(state.phase).toBe("edit-element-select");
  });
});

function transition(
  state: StructuredAuthoringFlowState,
  event: StructuredAuthoringFlowEvent,
) {
  return reduceStructuredAuthoringFlow(state, event);
}

function directReadyState(): StructuredAuthoringFlowState {
  let state = transition(createStructuredAuthoringFlow(), {
    type: "choose-intent",
    intent: "add-relation",
    preselection: [choice("a"), choice("b"), choice("c")],
  }).state;
  state = transition(state, { type: "choose-relation-family", family: "direct" }).state;
  state = transition(state, { type: "next" }).state;
  state = transition(state, { type: "next" }).state;
  return transition(state, { type: "set-common-predicate", predicateId: "relates" }).state;
}

function membershipState(
  kind: "sequence" | "alternative",
  preselection: readonly FlowCanvasChoice[],
): StructuredAuthoringFlowState {
  let state = transition(createStructuredAuthoringFlow(), {
    type: "choose-intent", intent: "add-relation", preselection,
  }).state;
  state = transition(state, { type: "choose-relation-family", family: "membership" }).state;
  if (state.phase !== "membership-group") throw new Error("expected membership group phase");
  expect(state.draft.groupKind).toBe(kind);
  return state;
}

function readyDraft(state: StructuredAuthoringFlowState) {
  if (state.phase !== "ready") throw new Error(`expected ready, got ${state.phase}`);
  return state.draft;
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

function selectionKeyForTest(elementId: string): string {
  return `main\u0000${elementId}`;
}
