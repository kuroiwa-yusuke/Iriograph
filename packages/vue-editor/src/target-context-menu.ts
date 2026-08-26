import type { Point } from "@iriograph/core";

export type TargetContextSubject =
  | { kind: "blank" }
  | { kind: "node"; elementId: string }
  | { kind: "direct-edge"; elementId: string }
  | { kind: "derived-sequence-guide"; elementId: string; groupElementId: string }
  | { kind: "derived-alternative-guide"; elementId: string; groupElementId: string }
  | { kind: "classification-group"; elementId: string }
  | { kind: "membership-group"; elementId: string }
  | { kind: "sequence-group"; elementId: string }
  | { kind: "alternative-group"; elementId: string };

export type TargetContextActionId =
  | "add-element"
  | "paste"
  | "element-details"
  | "element-view"
  | "element-icon"
  | "create-relation"
  | "edit-membership"
  | "delete-element"
  | "relation-details"
  | "relation-view"
  | "reconnect-relation"
  | "reset-route"
  | "delete-relation"
  | "edit-sequence"
  | "edit-alternatives"
  | "group-details"
  | "group-view"
  | "fit-group"
  | "bring-group-forward"
  | "send-group-backward"
  | "delete-group";

export type TargetContextDestination =
  | {
      surface: "semantic-flow";
      intent: "add-element" | "add-relation" | "edit-element" | "edit-relation";
      elementId?: string;
      section?: "details" | "meaning" | "membership" | "sequence" | "alternatives" | "reconnect";
    }
  | {
      surface: "view-inspector";
      elementId: string;
      section: "element" | "icon" | "line" | "group";
    }
  | {
      surface: "canvas-command";
      command: "paste" | "reset-route" | "fit-group" | "bring-forward" | "send-backward";
      elementId?: string;
    }
  | {
      surface: "delete";
      elementId: string;
      target: "element" | "relation" | "group";
    };

export type TargetContextMenuEntry = {
  actionId: TargetContextActionId;
  label: string;
  group: "meaning" | "view" | "arrange" | "danger" | "create";
  destination: TargetContextDestination;
  destructive?: boolean;
  disabledReason?: string;
  /** Icon is never the only accessible name. Components may map this token to a visual. */
  iconToken?: string;
};

export type TargetContextMenuOptions = {
  readOnly?: boolean;
  clipboardHasSupportedContent?: boolean;
  hasManualRoute?: boolean;
  hasGroupMembers?: boolean;
  canChangeGroupOrder?: boolean;
  deleteDisabledReason?: string;
  actionDisabledReasons?: Partial<Record<TargetContextActionId, string>>;
};

export type TargetContextMenuAnchor = {
  origin: "pointer" | "keyboard";
  clientX: number;
  clientY: number;
  canvasPosition?: Point;
};

export type TargetContextMenuAnchorRequest = {
  clientX: number;
  clientY: number;
  canvasPosition?: Point;
};

export type TargetContextMenuSession =
  | { open: false; focusReturnId?: string }
  | {
      open: true;
      target: TargetContextSubject;
      anchor: TargetContextMenuAnchor;
      focusReturnId?: string;
      activeActionId?: TargetContextActionId;
    };

export type TargetContextMenuSelection = {
  session: TargetContextMenuSession;
  destination?: TargetContextDestination;
  focusReturnId?: string;
};

export function targetContextMenuEntries(
  target: TargetContextSubject,
  options: TargetContextMenuOptions = {},
): TargetContextMenuEntry[] {
  const entries = entriesForTarget(target);
  return entries.map((entry) => {
    const reason = disabledReason(entry, options);
    return reason ? { ...entry, disabledReason: reason } : entry;
  });
}

export function targetContextMenuAnchor(
  request: TargetContextMenuAnchorRequest,
  origin: "pointer" | "keyboard",
): TargetContextMenuAnchor {
  return {
    origin,
    clientX: request.clientX,
    clientY: request.clientY,
    canvasPosition: request.canvasPosition ? { ...request.canvasPosition } : undefined,
  };
}

export function openTargetContextMenu(input: {
  target: TargetContextSubject;
  request: TargetContextMenuAnchorRequest;
  origin: "pointer" | "keyboard";
  focusReturnId?: string;
}): TargetContextMenuSession {
  return {
    open: true,
    target: { ...input.target },
    anchor: targetContextMenuAnchor(input.request, input.origin),
    focusReturnId: input.focusReturnId,
  };
}

export function closeTargetContextMenu(
  session: TargetContextMenuSession,
): TargetContextMenuSelection {
  return {
    session: { open: false, focusReturnId: session.focusReturnId },
    focusReturnId: session.focusReturnId,
  };
}

export function chooseTargetContextMenuEntry(
  session: TargetContextMenuSession,
  entry: TargetContextMenuEntry,
): TargetContextMenuSelection {
  if (!session.open || entry.disabledReason) return { session };
  return {
    session: { open: false, focusReturnId: session.focusReturnId },
    destination: copyDestination(entry.destination),
    focusReturnId: session.focusReturnId,
  };
}

export function moveTargetContextMenuActiveEntry(
  session: TargetContextMenuSession,
  entries: readonly TargetContextMenuEntry[],
  movement: "next" | "previous" | "first" | "last",
): TargetContextMenuSession {
  if (!session.open) return session;
  const enabled = entries.filter((entry) => !entry.disabledReason);
  if (enabled.length === 0) return { ...session, activeActionId: undefined };
  if (movement === "first") return { ...session, activeActionId: enabled[0]!.actionId };
  if (movement === "last") return { ...session, activeActionId: enabled.at(-1)!.actionId };
  const current = enabled.findIndex((entry) => entry.actionId === session.activeActionId);
  const delta = movement === "next" ? 1 : -1;
  const index = current < 0
    ? movement === "next" ? 0 : enabled.length - 1
    : (current + delta + enabled.length) % enabled.length;
  return { ...session, activeActionId: enabled[index]!.actionId };
}

export function isTargetContextMenuKeyboardTrigger(
  event: Pick<KeyboardEvent, "key" | "shiftKey" | "ctrlKey" | "metaKey" | "altKey">,
): boolean {
  if (event.ctrlKey || event.metaKey || event.altKey) return false;
  return event.key === "ContextMenu" || (event.shiftKey && event.key === "F10");
}

function entriesForTarget(target: TargetContextSubject): TargetContextMenuEntry[] {
  switch (target.kind) {
    case "blank":
      return [
        entry("add-element", "要素を追加", "create", {
          surface: "semantic-flow", intent: "add-element",
        }, "add"),
        entry("paste", "貼り付け", "create", {
          surface: "canvas-command", command: "paste",
        }, "paste"),
      ];
    case "node":
      return [
        entry("element-details", "要素の詳細", "meaning", {
          surface: "semantic-flow", intent: "edit-element", elementId: target.elementId, section: "details",
        }, "details"),
        entry("create-relation", "関係を追加", "meaning", {
          surface: "semantic-flow", intent: "add-relation", elementId: target.elementId,
        }, "relation"),
        entry("edit-membership", "所属を編集", "meaning", {
          surface: "semantic-flow", intent: "edit-relation", elementId: target.elementId, section: "membership",
        }, "membership"),
        entry("element-view", "要素のビュー", "view", {
          surface: "view-inspector", elementId: target.elementId, section: "element",
        }, "view"),
        entry("element-icon", "アイコン", "view", {
          surface: "view-inspector", elementId: target.elementId, section: "icon",
        }, "icon"),
        destructive("delete-element", "要素を削除", target.elementId, "element"),
      ];
    case "direct-edge":
      return [
        entry("relation-details", "関係の詳細", "meaning", {
          surface: "semantic-flow", intent: "edit-relation", elementId: target.elementId, section: "meaning",
        }, "details"),
        entry("reconnect-relation", "接続先を変更", "meaning", {
          surface: "semantic-flow", intent: "edit-relation", elementId: target.elementId, section: "reconnect",
        }, "reconnect"),
        entry("relation-view", "線のビュー", "view", {
          surface: "view-inspector", elementId: target.elementId, section: "line",
        }, "line"),
        entry("reset-route", "線の経路をリセット", "view", {
          surface: "canvas-command", command: "reset-route", elementId: target.elementId,
        }, "reset"),
        destructive("delete-relation", "関係を削除", target.elementId, "relation"),
      ];
    case "derived-sequence-guide":
      return [entry("edit-sequence", "順序を編集", "meaning", {
        surface: "semantic-flow",
        intent: "edit-relation",
        elementId: target.groupElementId,
        section: "sequence",
      }, "sequence")];
    case "derived-alternative-guide":
      return [entry("edit-alternatives", "候補グループを編集", "meaning", {
        surface: "semantic-flow",
        intent: "edit-relation",
        elementId: target.groupElementId,
        section: "alternatives",
      }, "alternatives")];
    case "classification-group":
    case "membership-group":
      return groupEntries(target.elementId, "membership");
    case "sequence-group":
      return groupEntries(target.elementId, "sequence");
    case "alternative-group":
      return groupEntries(target.elementId, "alternatives");
    default:
      return assertNever(target);
  }
}

function groupEntries(
  elementId: string,
  kind: "membership" | "sequence" | "alternatives",
): TargetContextMenuEntry[] {
  const semanticEntry = kind === "membership"
    ? entry("edit-membership", "所属を編集", "meaning", {
        surface: "semantic-flow", intent: "edit-relation", elementId, section: "membership",
      }, "membership")
    : kind === "sequence"
      ? entry("edit-sequence", "順序を編集", "meaning", {
          surface: "semantic-flow", intent: "edit-relation", elementId, section: "sequence",
        }, "sequence")
      : entry("edit-alternatives", "候補グループを編集", "meaning", {
          surface: "semantic-flow", intent: "edit-relation", elementId, section: "alternatives",
        }, "alternatives");
  return [
    entry("group-details", "グループの詳細", "meaning", {
      surface: "semantic-flow", intent: "edit-element", elementId, section: "details",
    }, "details"),
    semanticEntry,
    entry("group-view", "グループのビュー", "view", {
      surface: "view-inspector", elementId, section: "group",
    }, "view"),
    entry("fit-group", "要素に合わせる", "arrange", {
      surface: "canvas-command", command: "fit-group", elementId,
    }, "fit"),
    entry("bring-group-forward", "一つ前へ", "arrange", {
      surface: "canvas-command", command: "bring-forward", elementId,
    }, "forward"),
    entry("send-group-backward", "一つ後ろへ", "arrange", {
      surface: "canvas-command", command: "send-backward", elementId,
    }, "backward"),
    destructive("delete-group", "グループを削除", elementId, "group"),
  ];
}

function entry(
  actionId: TargetContextActionId,
  label: string,
  group: TargetContextMenuEntry["group"],
  destination: TargetContextDestination,
  iconToken: string,
): TargetContextMenuEntry {
  return { actionId, label, group, destination, iconToken };
}

function destructive(
  actionId: "delete-element" | "delete-relation" | "delete-group",
  label: string,
  elementId: string,
  target: "element" | "relation" | "group",
): TargetContextMenuEntry {
  return {
    ...entry(actionId, label, "danger", { surface: "delete", elementId, target }, "delete"),
    destructive: true,
  };
}

function disabledReason(
  entry: TargetContextMenuEntry,
  options: TargetContextMenuOptions,
): string | undefined {
  const explicit = options.actionDisabledReasons?.[entry.actionId];
  if (explicit) return explicit;
  if (entry.destructive && options.deleteDisabledReason) return options.deleteDisabledReason;
  if (entry.actionId === "paste" && !options.clipboardHasSupportedContent) {
    return "貼り付けできる要素がクリップボードにありません。";
  }
  if (entry.actionId === "reset-route" && !options.hasManualRoute) {
    return "手動調整された線の経路がありません。";
  }
  if (entry.actionId === "fit-group" && !options.hasGroupMembers) {
    return "グループに所属する要素がありません。";
  }
  if (
    (entry.actionId === "bring-group-forward" || entry.actionId === "send-group-backward")
    && options.canChangeGroupOrder === false
  ) {
    return "このグループは現在の層内でこれ以上移動できません。";
  }
  if (options.readOnly && requiresWrite(entry.actionId)) {
    return "読み取り専用のため変更できません。";
  }
  return undefined;
}

function requiresWrite(actionId: TargetContextActionId): boolean {
  return !new Set<TargetContextActionId>([
    "element-details",
    "relation-details",
    "group-details",
    "element-view",
    "element-icon",
    "relation-view",
    "group-view",
  ]).has(actionId);
}

function copyDestination(destination: TargetContextDestination): TargetContextDestination {
  return { ...destination };
}

function assertNever(value: never): never {
  throw new Error(`Unhandled context target: ${JSON.stringify(value)}`);
}
