import type {
  ProjectionDiagnostic,
  StructuredAuthoringRequest,
  StructuredCanvasSelection,
  StructuredGroupKind,
} from "@iriograph/core";

export type StructuredAuthoringIntent =
  | "add-element"
  | "add-relation"
  | "edit-element"
  | "edit-relation";

export const STRUCTURED_AUTHORING_INTENT_OPTIONS: readonly {
  intent: StructuredAuthoringIntent;
  label: string;
  description: string;
}[] = [
  { intent: "add-element", label: "新しい要素を作る", description: "要素またはグループを追加します。" },
  { intent: "add-relation", label: "関係を作る", description: "要素同士をつなぐか、グループへ所属させます。" },
  { intent: "edit-element", label: "要素を変更する", description: "Canvasで選んだ要素の名前・説明・種類を変更します。" },
  { intent: "edit-relation", label: "関係を変更する", description: "Canvasで選んだ関係・所属・順序・候補を変更します。" },
];

export const STRUCTURED_ELEMENT_KIND_OPTIONS = [
  {
    elementKind: "node",
    label: "要素",
    description: "業務上の対象、状態、処理などを追加します。",
    iconToken: "element-node",
  },
  {
    elementKind: "group",
    label: "グループ",
    description: "分類、包含、順序、候補を表す領域を追加します。",
    iconToken: "element-group",
  },
] as const;

export const STRUCTURED_RELATION_FAMILY_OPTIONS = [
  {
    family: "direct",
    label: "線でつなぐ",
    description: "一つの始点から一つ以上の接続先へ関係を作ります。",
    iconToken: "relation-direct",
  },
  {
    family: "membership",
    label: "グループへ所属させる",
    description: "既存グループへ一つ以上の要素を追加します。",
    iconToken: "relation-membership",
  },
] as const;

export type FlowCanvasChoice = {
  selection: StructuredCanvasSelection;
  kind: "node" | "group" | "direct-edge";
  groupKind?: StructuredGroupKind;
};

export type FlowInlineMember = {
  kind: "new-node";
  clientId: string;
  label: string;
  nodeRoleIds: readonly string[];
  suggestedLocalName?: string;
};

export type FlowExistingMember = {
  kind: "existing";
  selection: StructuredCanvasSelection;
  /** Stable occurrence identity for repeated rdf:_n members in Seq/Alt. */
  occurrenceId?: string;
};

export type FlowGroupMember = FlowExistingMember | FlowInlineMember;

export type FlowElementDraft =
  | {
      family: "create-node";
      nodeRoleIds: readonly string[];
      label: string;
      suggestedLocalName?: string;
    }
  | {
      family: "create-group";
      groupKind?: StructuredGroupKind;
      label: string;
      suggestedLocalName?: string;
    };

export type FlowDirectDraft = {
  family: "direct";
  source?: StructuredCanvasSelection;
  targets: readonly StructuredCanvasSelection[];
  predicateId?: string;
  rowPredicateIds: Readonly<Record<string, string>>;
};

export type FlowMembershipDraft = {
  family: "membership";
  group?: StructuredCanvasSelection;
  groupKind?: StructuredGroupKind;
  members: readonly FlowGroupMember[];
  defaultMemberKey?: string;
};

export type FlowEditDraft =
  | {
      family: "edit-element";
      target?: StructuredCanvasSelection;
      action?: "details" | "delete";
    }
  | {
      family: "edit-relation";
      target?: FlowCanvasChoice;
      action?: "meaning" | "membership" | "reconnect" | "delete";
    };

export type StructuredAuthoringReadyDraft =
  | FlowElementDraft
  | FlowDirectDraft
  | FlowMembershipDraft
  | FlowEditDraft;

type FlowSession = {
  openerFocusId?: string;
  preselection: readonly FlowCanvasChoice[];
  allowUntypedNodes: boolean;
};

export type StructuredAuthoringFlowState =
  | ({ phase: "intent"; focusIntent?: FlowFocusIntent } & FlowSession)
  | ({ phase: "element-kind" } & FlowSession)
  | ({ phase: "node-roles"; draft: Extract<FlowElementDraft, { family: "create-node" }> } & FlowSession)
  | ({ phase: "group-kind"; draft: Extract<FlowElementDraft, { family: "create-group" }> } & FlowSession)
  | ({ phase: "element-label"; draft: FlowElementDraft } & FlowSession)
  | ({ phase: "relation-family" } & FlowSession)
  | ({ phase: "direct-source"; draft: FlowDirectDraft } & FlowSession)
  | ({ phase: "direct-targets"; draft: FlowDirectDraft } & FlowSession)
  | ({ phase: "direct-predicate"; draft: FlowDirectDraft } & FlowSession)
  | ({ phase: "membership-group"; draft: FlowMembershipDraft } & FlowSession)
  | ({ phase: "membership-members"; draft: FlowMembershipDraft } & FlowSession)
  | ({ phase: "sequence-order"; draft: FlowMembershipDraft & { groupKind: "sequence" } } & FlowSession)
  | ({ phase: "alternative-default"; draft: FlowMembershipDraft & { groupKind: "alternative" } } & FlowSession)
  | ({ phase: "edit-element-select"; draft: Extract<FlowEditDraft, { family: "edit-element" }> } & FlowSession)
  | ({ phase: "edit-element-action"; draft: Extract<FlowEditDraft, { family: "edit-element" }> } & FlowSession)
  | ({ phase: "edit-relation-select"; draft: Extract<FlowEditDraft, { family: "edit-relation" }> } & FlowSession)
  | ({ phase: "edit-relation-action"; draft: Extract<FlowEditDraft, { family: "edit-relation" }> } & FlowSession)
  | ({ phase: "ready"; draft: StructuredAuthoringReadyDraft } & FlowSession)
  | ({ phase: "submitting"; draft: StructuredAuthoringReadyDraft; request: StructuredAuthoringRequest } & FlowSession)
  | ({
      phase: "error";
      draft: StructuredAuthoringReadyDraft;
      errorKind: "validation" | "stale";
      diagnostics: readonly ProjectionDiagnostic[];
    } & FlowSession);

export type FlowFocusIntent =
  | { kind: "flow-entry" }
  | { kind: "canvas"; elementId?: string }
  | { kind: "inspector"; destination: FlowInspectorDestination };

export type FlowInspectorDestination =
  | "element-details"
  | "relation-meaning"
  | "relation-reconnect"
  | "group-membership"
  | "delete";

export type StructuredAuthoringFlowEffect =
  | { type: "submit"; request: StructuredAuthoringRequest }
  | { type: "focus"; intent: FlowFocusIntent }
  | { type: "cancelled"; focusId?: string };

export type StructuredAuthoringFlowTransition = {
  state: StructuredAuthoringFlowState;
  effect?: StructuredAuthoringFlowEffect;
};

export type StructuredAuthoringFlowEvent =
  | {
      type: "choose-intent";
      intent: StructuredAuthoringIntent;
      preselection?: readonly FlowCanvasChoice[];
      openerFocusId?: string;
    }
  | { type: "choose-element-kind"; elementKind: "node" | "group" }
  | { type: "set-node-roles"; nodeRoleIds: readonly string[] }
  | { type: "set-group-kind"; groupKind: StructuredGroupKind }
  | { type: "set-label"; label: string }
  | { type: "choose-relation-family"; family: "direct" | "membership" }
  | { type: "set-direct-source"; source: StructuredCanvasSelection }
  | { type: "set-direct-targets"; targets: readonly StructuredCanvasSelection[] }
  | { type: "set-common-predicate"; predicateId: string }
  | { type: "set-row-predicate"; target: StructuredCanvasSelection; predicateId?: string }
  | {
      type: "set-membership-group";
      group: StructuredCanvasSelection;
      groupKind: StructuredGroupKind;
    }
  | { type: "set-members"; members: readonly FlowGroupMember[] }
  | { type: "add-inline-member"; member: FlowInlineMember }
  | { type: "update-inline-member"; clientId: string; label: string; nodeRoleIds: readonly string[] }
  | { type: "remove-member"; memberKey: string }
  | { type: "move-member"; memberKey: string; direction: "up" | "down" }
  | { type: "set-alternative-default"; memberKey: string }
  | { type: "set-edit-element-target"; target: StructuredCanvasSelection }
  | { type: "set-edit-relation-target"; target: FlowCanvasChoice }
  | { type: "choose-edit-element-action"; action: "details" | "delete" }
  | { type: "choose-edit-relation-action"; action: "meaning" | "membership" | "reconnect" | "delete" }
  | { type: "next" }
  | { type: "back" }
  | { type: "cancel" | "escape" }
  | { type: "submit"; requestId: string }
  | { type: "submit-failed"; errorKind: "validation" | "stale"; diagnostics: readonly ProjectionDiagnostic[] }
  | { type: "submit-succeeded"; focusIntent?: FlowFocusIntent };

export function createStructuredAuthoringFlow(
  options: { allowUntypedNodes?: boolean } = {},
): StructuredAuthoringFlowState {
  return {
    phase: "intent",
    preselection: [],
    allowUntypedNodes: options.allowUntypedNodes === true,
  };
}

export function reduceStructuredAuthoringFlow(
  state: StructuredAuthoringFlowState,
  event: StructuredAuthoringFlowEvent,
): StructuredAuthoringFlowTransition {
  if (event.type === "cancel" || event.type === "escape") {
    if (state.phase === "submitting") return { state };
    return cancelTransition(state);
  }
  if (event.type === "choose-intent") {
    return state.phase === "intent" ? chooseIntent(event, state) : { state };
  }
  if (event.type === "submit-succeeded") {
    if (state.phase !== "submitting") return { state };
    const focusIntent = event.focusIntent ?? { kind: "flow-entry" as const };
    return {
      state: {
        phase: "intent",
        preselection: [],
        allowUntypedNodes: state.allowUntypedNodes,
        focusIntent,
      },
      effect: { type: "focus", intent: focusIntent },
    };
  }
  if (event.type === "submit-failed") {
    if (state.phase !== "submitting") return { state };
    return {
      state: {
        phase: "error",
        draft: state.draft,
        errorKind: event.errorKind,
        diagnostics: [...event.diagnostics],
        ...sessionOf(state),
      },
    };
  }
  if (event.type === "submit") {
    const draft = readyDraft(state);
    if (!draft) return { state };
    const request = structuredAuthoringRequestForDraft(draft, event.requestId);
    if (!request) return { state };
    return {
      state: { phase: "submitting", draft, request, ...sessionOf(state) },
      effect: { type: "submit", request },
    };
  }
  if (event.type === "back") return { state: previousState(state) };
  if (event.type === "next") return { state: nextState(state) };

  switch (state.phase) {
    case "intent":
      return { state };
    case "element-kind":
      if (event.type !== "choose-element-kind") return { state };
      return event.elementKind === "node"
        ? {
            state: {
              phase: "node-roles",
              draft: { family: "create-node", nodeRoleIds: [], label: "" },
              ...sessionOf(state),
            },
          }
        : {
            state: {
              phase: "group-kind",
              draft: { family: "create-group", label: "" },
              ...sessionOf(state),
            },
          };
    case "node-roles":
      return event.type === "set-node-roles"
        ? { state: { ...state, draft: { ...state.draft, nodeRoleIds: uniqueText(event.nodeRoleIds) } } }
        : { state };
    case "group-kind":
      return event.type === "set-group-kind"
        ? { state: { ...state, draft: { ...state.draft, groupKind: event.groupKind } } }
        : { state };
    case "element-label":
      return event.type === "set-label"
        ? { state: { ...state, draft: { ...state.draft, label: event.label } } }
        : { state };
    case "relation-family":
      if (event.type !== "choose-relation-family") return { state };
      return event.family === "direct"
        ? { state: directStateFromPreselection(state) }
        : { state: membershipStateFromPreselection(state) };
    case "direct-source":
    case "direct-targets":
    case "direct-predicate":
      return reduceDirectState(state, event);
    case "membership-group":
    case "membership-members":
    case "sequence-order":
    case "alternative-default":
      return reduceMembershipState(state, event);
    case "edit-element-select":
      return event.type === "set-edit-element-target"
        ? { state: { ...state, draft: { ...state.draft, target: event.target } } }
        : { state };
    case "edit-element-action":
      if (event.type !== "choose-edit-element-action") return { state };
      return chooseElementEditAction(state, event.action);
    case "edit-relation-select":
      return event.type === "set-edit-relation-target"
        ? { state: { ...state, draft: { ...state.draft, target: event.target } } }
        : { state };
    case "edit-relation-action":
      if (event.type !== "choose-edit-relation-action") return { state };
      return chooseRelationEditAction(state, event.action);
    case "ready":
    case "submitting":
    case "error":
      return { state };
    default:
      return assertNever(state);
  }
}

export function structuredAuthoringRequestForDraft(
  draft: StructuredAuthoringReadyDraft,
  requestId: string,
): StructuredAuthoringRequest | undefined {
  if (!requestId.trim()) return undefined;
  switch (draft.family) {
    case "create-node":
      if (!draft.label.trim()) return undefined;
      return {
        type: "create-element",
        requestId,
        element: {
          kind: "node",
          label: draft.label.trim(),
          nodeRoleIds: [...draft.nodeRoleIds],
          suggestedLocalName: draft.suggestedLocalName,
        },
      };
    case "create-group":
      if (!draft.label.trim() || !draft.groupKind) return undefined;
      return {
        type: "create-element",
        requestId,
        element: {
          kind: "group",
          label: draft.label.trim(),
          groupKind: draft.groupKind,
          suggestedLocalName: draft.suggestedLocalName,
        },
      };
    case "direct":
      if (
        !draft.source
        || draft.targets.length === 0
        || (!draft.predicateId && !allDirectTargetsHavePredicate(draft))
      ) return undefined;
      return {
        type: "create-direct-relations",
        requestId,
        source: copySelection(draft.source),
        ...(draft.predicateId ? { predicateId: draft.predicateId } : {}),
        targets: draft.targets.map((target) => ({
          target: copySelection(target),
          predicateId: draft.rowPredicateIds[selectionKey(target)],
        })),
      };
    case "membership": {
      if (!draft.group || !draft.groupKind || draft.members.length === 0) return undefined;
      const selectedDefaultIndex = draft.groupKind === "alternative"
        ? draft.members.findIndex((member) => memberKey(member) === draft.defaultMemberKey)
        : -1;
      if (draft.groupKind === "alternative" && selectedDefaultIndex < 0) return undefined;
      const members = draft.groupKind === "alternative" && selectedDefaultIndex > 0
        ? [
            draft.members[selectedDefaultIndex]!,
            ...draft.members.filter((_, index) => index !== selectedDefaultIndex),
          ]
        : [...draft.members];
      return {
        type: "set-group-members",
        requestId,
        group: copySelection(draft.group),
        members: members.map((member) => member.kind === "existing"
          ? { kind: "existing", selection: copySelection(member.selection) }
          : {
              kind: "new-node",
              clientId: member.clientId,
              label: member.label.trim(),
              nodeRoleIds: [...member.nodeRoleIds],
              suggestedLocalName: member.suggestedLocalName,
            }),
        ...(draft.groupKind === "alternative" ? { defaultMemberIndex: 0 } : {}),
      };
    }
    case "edit-element":
      return undefined;
    case "edit-relation":
      return undefined;
    default:
      return assertNever(draft);
  }
}

export function structuredAuthoringStepStatus(state: StructuredAuthoringFlowState): {
  canContinue: boolean;
  reason?: string;
} {
  switch (state.phase) {
    case "node-roles":
      return {
        canContinue: state.allowUntypedNodes || state.draft.nodeRoleIds.length > 0,
        reason: "要素の種類を一つ以上選択してください。",
      };
    case "group-kind":
      return { canContinue: Boolean(state.draft.groupKind), reason: "グループの種類を選択してください。" };
    case "element-label":
      return { canContinue: Boolean(state.draft.label.trim()), reason: "名前を入力してください。" };
    case "direct-source":
      return { canContinue: Boolean(state.draft.source), reason: "始点をCanvasから選択してください。" };
    case "direct-targets":
      return { canContinue: state.draft.targets.length > 0, reason: "接続先を一つ以上選択してください。" };
    case "direct-predicate":
      return {
        canContinue: Boolean(state.draft.predicateId) || allDirectTargetsHavePredicate(state.draft),
        reason: "共通の関係、または接続先ごとの関係をすべて選択してください。",
      };
    case "membership-group":
      return { canContinue: Boolean(state.draft.group && state.draft.groupKind), reason: "既存のグループを選択してください。" };
    case "membership-members":
    case "sequence-order":
      return {
        canContinue: membershipMembersAreReady(state.draft.members, state.allowUntypedNodes),
        reason: "所属させる要素を選び、新しい要素には名前と種類を設定してください。",
      };
    case "alternative-default":
      return {
        canContinue: membershipMembersAreReady(state.draft.members, state.allowUntypedNodes)
          && state.draft.members.length >= 2
          && state.draft.members.some((member) => memberKey(member) === state.draft.defaultMemberKey),
        reason: "候補を二つ以上追加し、既定候補を選択してください。",
      };
    case "edit-element-select":
    case "edit-element-action":
      return { canContinue: Boolean(state.draft.target), reason: "要素をCanvasから選択してください。" };
    case "edit-relation-select":
    case "edit-relation-action":
      return { canContinue: Boolean(state.draft.target), reason: "要素または関係をCanvasから選択してください。" };
    case "ready":
      return {
        canContinue: Boolean(structuredAuthoringRequestForDraft(state.draft, "status-check"))
          || state.draft.family === "edit-relation"
          || state.draft.family === "edit-element",
      };
    case "intent":
    case "element-kind":
    case "relation-family":
    case "submitting":
    case "error":
      return { canContinue: false };
    default:
      return assertNever(state);
  }
}

export function memberKey(member: FlowGroupMember): string {
  return member.kind === "new-node"
    ? `new:${member.clientId}`
    : `existing:${selectionKey(member.selection)}${member.occurrenceId ? `:${member.occurrenceId}` : ""}`;
}

export function selectionKey(selection: StructuredCanvasSelection): string {
  return `${selection.viewId}\u0000${selection.elementId}`;
}

function chooseIntent(
  event: Extract<StructuredAuthoringFlowEvent, { type: "choose-intent" }>,
  current: StructuredAuthoringFlowState,
): StructuredAuthoringFlowTransition {
  const session: FlowSession = {
    openerFocusId: event.openerFocusId,
    preselection: uniqueChoices(event.preselection ?? []),
    allowUntypedNodes: current.allowUntypedNodes,
  };
  switch (event.intent) {
    case "add-element":
      return { state: { phase: "element-kind", ...session } };
    case "add-relation":
      return { state: { phase: "relation-family", ...session } };
    case "edit-element": {
      const selected = session.preselection.length === 1 ? session.preselection[0] : undefined;
      const target = selected && selected.kind !== "direct-edge" ? selected.selection : undefined;
      return {
        state: target
          ? { phase: "edit-element-action", draft: { family: "edit-element", target }, ...session }
          : { phase: "edit-element-select", draft: { family: "edit-element" }, ...session },
      };
    }
    case "edit-relation": {
      const target = session.preselection.length === 1 ? session.preselection[0] : undefined;
      return {
        state: target
          ? { phase: "edit-relation-action", draft: { family: "edit-relation", target }, ...session }
          : { phase: "edit-relation-select", draft: { family: "edit-relation" }, ...session },
      };
    }
    default:
      return assertNever(event.intent);
  }
}

function reduceDirectState(
  state: Extract<StructuredAuthoringFlowState, {
    phase: "direct-source" | "direct-targets" | "direct-predicate";
  }>,
  event: StructuredAuthoringFlowEvent,
): StructuredAuthoringFlowTransition {
  if (event.type === "set-direct-source") {
    return { state: { ...state, draft: { ...state.draft, source: copySelection(event.source) } } };
  }
  if (event.type === "set-direct-targets") {
    return {
      state: {
        ...state,
        draft: { ...state.draft, targets: uniqueSelections(event.targets) },
      },
    };
  }
  if (event.type === "set-common-predicate") {
    const predicateId = event.predicateId.trim();
    return {
      state: {
        ...state,
        draft: { ...state.draft, predicateId: predicateId || undefined },
      },
    };
  }
  if (event.type === "set-row-predicate") {
    const rowPredicateIds = { ...state.draft.rowPredicateIds };
    const key = selectionKey(event.target);
    const predicateId = event.predicateId?.trim();
    if (predicateId) rowPredicateIds[key] = predicateId;
    else delete rowPredicateIds[key];
    return { state: { ...state, draft: { ...state.draft, rowPredicateIds } } };
  }
  return { state };
}

function reduceMembershipState(
  state: Extract<StructuredAuthoringFlowState, {
    phase: "membership-group" | "membership-members" | "sequence-order" | "alternative-default";
  }>,
  event: StructuredAuthoringFlowEvent,
): StructuredAuthoringFlowTransition {
  if (event.type === "set-membership-group") {
    if (state.phase !== "membership-group") return { state };
    return {
      state: {
        ...state,
        draft: {
          ...state.draft,
          group: copySelection(event.group),
          groupKind: event.groupKind,
          defaultMemberKey: event.groupKind === "alternative" ? state.draft.defaultMemberKey : undefined,
        },
      } as StructuredAuthoringFlowState,
    };
  }
  if (event.type === "set-members") {
    return { state: { ...state, draft: normalizedMembershipDraft(state.draft, event.members) } as StructuredAuthoringFlowState };
  }
  if (event.type === "add-inline-member") {
    if (state.draft.members.some((member) => memberKey(member) === memberKey(event.member))) return { state };
    return {
      state: {
        ...state,
        draft: normalizedMembershipDraft(state.draft, [...state.draft.members, event.member]),
      } as StructuredAuthoringFlowState,
    };
  }
  if (event.type === "update-inline-member") {
    const members = state.draft.members.map((member) => (
      member.kind === "new-node" && member.clientId === event.clientId
        ? { ...member, label: event.label, nodeRoleIds: uniqueText(event.nodeRoleIds) }
        : member
    ));
    return { state: { ...state, draft: normalizedMembershipDraft(state.draft, members) } as StructuredAuthoringFlowState };
  }
  if (event.type === "remove-member") {
    return {
      state: {
        ...state,
        draft: normalizedMembershipDraft(
          state.draft,
          state.draft.members.filter((member) => memberKey(member) !== event.memberKey),
        ),
      } as StructuredAuthoringFlowState,
    };
  }
  if (event.type === "move-member") {
    return {
      state: {
        ...state,
        draft: normalizedMembershipDraft(
          state.draft,
          movedMember(state.draft.members, event.memberKey, event.direction),
        ),
      } as StructuredAuthoringFlowState,
    };
  }
  if (event.type === "set-alternative-default") {
    if (state.phase !== "alternative-default") return { state };
    const selected = state.draft.members.find((member) => memberKey(member) === event.memberKey);
    const members = selected
      ? [selected, ...state.draft.members.filter((member) => memberKey(member) !== event.memberKey)]
      : [...state.draft.members];
    return {
      state: {
        ...state,
        draft: { ...state.draft, members, defaultMemberKey: selected ? event.memberKey : undefined },
      } as StructuredAuthoringFlowState,
    };
  }
  return { state };
}

function nextState(state: StructuredAuthoringFlowState): StructuredAuthoringFlowState {
  if (!structuredAuthoringStepStatus(state).canContinue) return state;
  switch (state.phase) {
    case "node-roles":
    case "group-kind":
      return { phase: "element-label", draft: state.draft, ...sessionOf(state) };
    case "element-label":
      return { phase: "ready", draft: state.draft, ...sessionOf(state) };
    case "direct-source":
      return { phase: "direct-targets", draft: state.draft, ...sessionOf(state) };
    case "direct-targets":
      return { phase: "direct-predicate", draft: state.draft, ...sessionOf(state) };
    case "direct-predicate":
      return { phase: "ready", draft: state.draft, ...sessionOf(state) };
    case "membership-group":
      return { phase: "membership-members", draft: state.draft, ...sessionOf(state) };
    case "membership-members":
      if (state.draft.groupKind === "sequence") {
        return {
          phase: "sequence-order",
          draft: { ...state.draft, groupKind: "sequence" },
          ...sessionOf(state),
        };
      }
      if (state.draft.groupKind === "alternative") {
        return {
          phase: "alternative-default",
          draft: { ...state.draft, groupKind: "alternative" },
          ...sessionOf(state),
        };
      }
      return { phase: "ready", draft: state.draft, ...sessionOf(state) };
    case "sequence-order":
    case "alternative-default":
      return { phase: "ready", draft: state.draft, ...sessionOf(state) };
    case "edit-element-select":
      return { phase: "edit-element-action", draft: state.draft, ...sessionOf(state) };
    case "edit-relation-select":
      return { phase: "edit-relation-action", draft: state.draft, ...sessionOf(state) };
    default:
      return state;
  }
}

function previousState(state: StructuredAuthoringFlowState): StructuredAuthoringFlowState {
  switch (state.phase) {
    case "element-kind":
    case "relation-family":
    case "edit-element-select":
    case "edit-relation-select":
      return { phase: "intent", ...sessionOf(state) };
    case "node-roles":
    case "group-kind":
      return { phase: "element-kind", ...sessionOf(state) };
    case "element-label":
      return state.draft.family === "create-node"
        ? { phase: "node-roles", draft: state.draft, ...sessionOf(state) }
        : { phase: "group-kind", draft: state.draft, ...sessionOf(state) };
    case "direct-source":
    case "membership-group":
      return { phase: "relation-family", ...sessionOf(state) };
    case "direct-targets":
      return { phase: "direct-source", draft: state.draft, ...sessionOf(state) };
    case "direct-predicate":
      return { phase: "direct-targets", draft: state.draft, ...sessionOf(state) };
    case "membership-members":
      return { phase: "membership-group", draft: state.draft, ...sessionOf(state) };
    case "sequence-order":
    case "alternative-default":
      return { phase: "membership-members", draft: state.draft, ...sessionOf(state) };
    case "edit-element-action":
      return { phase: "edit-element-select", draft: state.draft, ...sessionOf(state) };
    case "edit-relation-action":
      return { phase: "edit-relation-select", draft: state.draft, ...sessionOf(state) };
    case "ready":
    case "error":
      return lastInputState(state.draft, sessionOf(state));
    case "intent":
    case "submitting":
      return state;
    default:
      return assertNever(state);
  }
}

function lastInputState(
  draft: StructuredAuthoringReadyDraft,
  session: FlowSession,
): StructuredAuthoringFlowState {
  switch (draft.family) {
    case "create-node":
    case "create-group":
      return { phase: "element-label", draft, ...session };
    case "direct":
      return { phase: "direct-predicate", draft, ...session };
    case "membership":
      if (draft.groupKind === "sequence") {
        return { phase: "sequence-order", draft: { ...draft, groupKind: "sequence" }, ...session };
      }
      if (draft.groupKind === "alternative") {
        return { phase: "alternative-default", draft: { ...draft, groupKind: "alternative" }, ...session };
      }
      return { phase: "membership-members", draft, ...session };
    case "edit-element":
      return { phase: "edit-element-action", draft, ...session };
    case "edit-relation":
      return { phase: "edit-relation-action", draft, ...session };
    default:
      return assertNever(draft);
  }
}

function readyDraft(state: StructuredAuthoringFlowState): StructuredAuthoringReadyDraft | undefined {
  return state.phase === "ready" || state.phase === "error" ? state.draft : undefined;
}

function directStateFromPreselection(
  state: Extract<StructuredAuthoringFlowState, { phase: "relation-family" }>,
): Extract<StructuredAuthoringFlowState, { phase: "direct-source" }> {
  const nodes = state.preselection.filter((choice) => choice.kind === "node");
  return {
    phase: "direct-source",
    draft: {
      family: "direct",
      source: nodes[0] ? copySelection(nodes[0].selection) : undefined,
      targets: uniqueSelections(nodes.slice(1).map((choice) => choice.selection)),
      rowPredicateIds: {},
    },
    ...sessionOf(state),
  };
}

function membershipStateFromPreselection(
  state: Extract<StructuredAuthoringFlowState, { phase: "relation-family" }>,
): Extract<StructuredAuthoringFlowState, { phase: "membership-group" }> {
  const groups = state.preselection.filter((choice) => choice.kind === "group" && choice.groupKind);
  const selectedGroup = groups.length === 1 ? groups[0] : undefined;
  const members = state.preselection
    .filter((choice) => choice.kind === "node")
    .map((choice): FlowExistingMember => ({ kind: "existing", selection: copySelection(choice.selection) }));
  return {
    phase: "membership-group",
    draft: {
      family: "membership",
      group: selectedGroup ? copySelection(selectedGroup.selection) : undefined,
      groupKind: selectedGroup?.groupKind,
      members,
    },
    ...sessionOf(state),
  };
}

function chooseElementEditAction(
  state: Extract<StructuredAuthoringFlowState, { phase: "edit-element-action" }>,
  action: "details" | "delete",
): StructuredAuthoringFlowTransition {
  const draft = { ...state.draft, action };
  if (action === "details") {
    const intent: FlowFocusIntent = { kind: "inspector", destination: "element-details" };
    return { state: { phase: "ready", draft, ...sessionOf(state) }, effect: { type: "focus", intent } };
  }
  const intent: FlowFocusIntent = { kind: "inspector", destination: "delete" };
  return { state: { phase: "ready", draft, ...sessionOf(state) }, effect: { type: "focus", intent } };
}

function chooseRelationEditAction(
  state: Extract<StructuredAuthoringFlowState, { phase: "edit-relation-action" }>,
  action: "meaning" | "membership" | "reconnect" | "delete",
): StructuredAuthoringFlowTransition {
  const draft = { ...state.draft, action };
  const destination: FlowInspectorDestination = action === "meaning"
    ? "relation-meaning"
    : action === "membership"
      ? "group-membership"
      : action === "reconnect"
        ? "relation-reconnect"
        : "delete";
  const intent: FlowFocusIntent = { kind: "inspector", destination };
  return { state: { phase: "ready", draft, ...sessionOf(state) }, effect: { type: "focus", intent } };
}

function normalizedMembershipDraft(
  draft: FlowMembershipDraft,
  members: readonly FlowGroupMember[],
): FlowMembershipDraft {
  const unique = uniqueMembers(members);
  return {
    ...draft,
    members: unique,
    defaultMemberKey: unique.some((member) => memberKey(member) === draft.defaultMemberKey)
      ? draft.defaultMemberKey
      : undefined,
  };
}

function movedMember(
  members: readonly FlowGroupMember[],
  key: string,
  direction: "up" | "down",
): FlowGroupMember[] {
  const result = [...members];
  const index = result.findIndex((member) => memberKey(member) === key);
  const next = index + (direction === "up" ? -1 : 1);
  if (index < 0 || next < 0 || next >= result.length) return result;
  [result[index], result[next]] = [result[next]!, result[index]!];
  return result;
}

function uniqueMembers(members: readonly FlowGroupMember[]): FlowGroupMember[] {
  const seen = new Set<string>();
  return members.filter((member) => {
    const key = memberKey(member);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map((member) => member.kind === "existing"
    ? {
        kind: "existing",
        selection: copySelection(member.selection),
        ...(member.occurrenceId ? { occurrenceId: member.occurrenceId } : {}),
      }
    : { ...member, nodeRoleIds: uniqueText(member.nodeRoleIds) });
}

function uniqueChoices(choices: readonly FlowCanvasChoice[]): FlowCanvasChoice[] {
  const seen = new Set<string>();
  return choices.filter((choice) => {
    const key = `${choice.kind}\u0000${selectionKey(choice.selection)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map((choice) => ({ ...choice, selection: copySelection(choice.selection) }));
}

function uniqueSelections(selections: readonly StructuredCanvasSelection[]): StructuredCanvasSelection[] {
  const seen = new Set<string>();
  return selections.filter((selection) => {
    const key = selectionKey(selection);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map(copySelection);
}

function allDirectTargetsHavePredicate(draft: FlowDirectDraft): boolean {
  return draft.targets.length > 0
    && draft.targets.every((target) => Boolean(draft.rowPredicateIds[selectionKey(target)]));
}

function membershipMembersAreReady(
  members: readonly FlowGroupMember[],
  allowUntypedNodes: boolean,
): boolean {
  return members.length > 0 && members.every((member) => (
    member.kind === "existing"
    || (Boolean(member.label.trim()) && (allowUntypedNodes || member.nodeRoleIds.length > 0))
  ));
}

function uniqueText(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim()).map((value) => value.trim()))];
}

function copySelection(selection: StructuredCanvasSelection): StructuredCanvasSelection {
  return { viewId: selection.viewId, elementId: selection.elementId };
}

function sessionOf(state: StructuredAuthoringFlowState): FlowSession {
  return {
    openerFocusId: state.openerFocusId,
    preselection: [...state.preselection],
    allowUntypedNodes: state.allowUntypedNodes,
  };
}

function cancelTransition(state: StructuredAuthoringFlowState): StructuredAuthoringFlowTransition {
  return {
    state: {
      phase: "intent",
      preselection: [],
      allowUntypedNodes: state.allowUntypedNodes,
      focusIntent: { kind: "flow-entry" },
    },
    effect: { type: "cancelled", focusId: state.openerFocusId },
  };
}

function assertNever(value: never): never {
  throw new Error(`Unhandled structured authoring state: ${JSON.stringify(value)}`);
}
