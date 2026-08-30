import type { Point } from "@iriograph/core";

import {
  translateEditorMessage,
  type EditorTranslator,
} from "../localization/editor-localization";

const defaultTranslator: EditorTranslator = (key, parameters) => (
  translateEditorMessage("en", key, parameters)
);

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
  | "collapse-group"
  | "expand-group"
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
      command: "paste" | "reset-route" | "fit-group" | "collapse-group" | "expand-group" | "bring-forward" | "send-backward";
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
  isGroupCollapsed?: boolean;
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
  translator: EditorTranslator = defaultTranslator,
): TargetContextMenuEntry[] {
  const entries = entriesForTarget(target);
  return entries.map((entry) => {
    const localized = { ...entry, label: targetMenuLabel(entry.actionId, translator) };
    const reason = disabledReason(localized, options, translator);
    return reason ? { ...localized, disabledReason: reason } : localized;
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
        entry("add-element", "Add element", "create", {
          surface: "semantic-flow", intent: "add-element",
        }, "add"),
        entry("paste", "Paste", "create", {
          surface: "canvas-command", command: "paste",
        }, "paste"),
      ];
    case "node":
      return [
        entry("element-details", "Element details", "meaning", {
          surface: "semantic-flow", intent: "edit-element", elementId: target.elementId, section: "details",
        }, "details"),
        entry("create-relation", "Add relation", "meaning", {
          surface: "semantic-flow", intent: "add-relation", elementId: target.elementId,
        }, "relation"),
        entry("edit-membership", "Edit membership", "meaning", {
          surface: "semantic-flow", intent: "edit-relation", elementId: target.elementId, section: "membership",
        }, "membership"),
        entry("element-view", "Element view", "view", {
          surface: "view-inspector", elementId: target.elementId, section: "element",
        }, "view"),
        entry("element-icon", "Icon", "view", {
          surface: "view-inspector", elementId: target.elementId, section: "icon",
        }, "icon"),
        destructive("delete-element", "Delete element", target.elementId, "element"),
      ];
    case "direct-edge":
      return [
        entry("relation-details", "Relation details", "meaning", {
          surface: "semantic-flow", intent: "edit-relation", elementId: target.elementId, section: "meaning",
        }, "details"),
        entry("reconnect-relation", "Change endpoint", "meaning", {
          surface: "semantic-flow", intent: "edit-relation", elementId: target.elementId, section: "reconnect",
        }, "reconnect"),
        entry("relation-view", "Line view", "view", {
          surface: "view-inspector", elementId: target.elementId, section: "line",
        }, "line"),
        entry("reset-route", "Reset line route", "view", {
          surface: "canvas-command", command: "reset-route", elementId: target.elementId,
        }, "reset"),
        destructive("delete-relation", "Delete relation", target.elementId, "relation"),
      ];
    case "derived-sequence-guide":
      return [entry("edit-sequence", "Edit order", "meaning", {
        surface: "semantic-flow",
        intent: "edit-relation",
        elementId: target.groupElementId,
        section: "sequence",
      }, "sequence")];
    case "derived-alternative-guide":
      return [entry("edit-alternatives", "Edit alternative group", "meaning", {
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
    ? entry("edit-membership", "Edit membership", "meaning", {
        surface: "semantic-flow", intent: "edit-relation", elementId, section: "membership",
      }, "membership")
    : kind === "sequence"
      ? entry("edit-sequence", "Edit order", "meaning", {
          surface: "semantic-flow", intent: "edit-relation", elementId, section: "sequence",
        }, "sequence")
      : entry("edit-alternatives", "Edit alternative group", "meaning", {
          surface: "semantic-flow", intent: "edit-relation", elementId, section: "alternatives",
        }, "alternatives");
  return [
    entry("group-details", "Group details", "meaning", {
      surface: "semantic-flow", intent: "edit-element", elementId, section: "details",
    }, "details"),
    semanticEntry,
    entry("group-view", "Group view", "view", {
      surface: "view-inspector", elementId, section: "group",
    }, "view"),
    entry("fit-group", "Fit to elements", "arrange", {
      surface: "canvas-command", command: "fit-group", elementId,
    }, "fit"),
    entry("collapse-group", "Collapse contents", "arrange", {
      surface: "canvas-command", command: "collapse-group", elementId,
    }, "collapse"),
    entry("expand-group", "Expand contents", "arrange", {
      surface: "canvas-command", command: "expand-group", elementId,
    }, "expand"),
    entry("bring-group-forward", "Bring forward one level", "arrange", {
      surface: "canvas-command", command: "bring-forward", elementId,
    }, "forward"),
    entry("send-group-backward", "Send backward one level", "arrange", {
      surface: "canvas-command", command: "send-backward", elementId,
    }, "backward"),
    destructive("delete-group", "Delete group", elementId, "group"),
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

function targetMenuLabel(
  actionId: TargetContextActionId,
  translator: EditorTranslator,
): string {
  switch (actionId) {
    case "add-element": return translator("targetMenu.addElement");
    case "paste": return translator("targetMenu.paste");
    case "element-details": return translator("targetMenu.elementDetails");
    case "create-relation": return translator("targetMenu.createRelation");
    case "edit-membership": return translator("targetMenu.editMembership");
    case "element-view": return translator("targetMenu.elementView");
    case "element-icon": return translator("targetMenu.elementIcon");
    case "delete-element": return translator("targetMenu.deleteElement");
    case "relation-details": return translator("targetMenu.relationDetails");
    case "reconnect-relation": return translator("targetMenu.reconnectRelation");
    case "relation-view": return translator("targetMenu.relationView");
    case "reset-route": return translator("targetMenu.resetRoute");
    case "delete-relation": return translator("targetMenu.deleteRelation");
    case "edit-sequence": return translator("targetMenu.editSequence");
    case "edit-alternatives": return translator("targetMenu.editAlternatives");
    case "group-details": return translator("targetMenu.groupDetails");
    case "group-view": return translator("targetMenu.groupView");
    case "fit-group": return translator("targetMenu.fitGroup");
    case "collapse-group": return translator("targetMenu.collapseGroup");
    case "expand-group": return translator("targetMenu.expandGroup");
    case "bring-group-forward": return translator("targetMenu.bringForward");
    case "send-group-backward": return translator("targetMenu.sendBackward");
    case "delete-group": return translator("targetMenu.deleteGroup");
    default: return assertNever(actionId);
  }
}

function disabledReason(
  entry: TargetContextMenuEntry,
  options: TargetContextMenuOptions,
  translator: EditorTranslator,
): string | undefined {
  const explicit = options.actionDisabledReasons?.[entry.actionId];
  if (explicit) return explicit;
  if (entry.destructive && options.deleteDisabledReason) return options.deleteDisabledReason;
  if (entry.actionId === "paste" && !options.clipboardHasSupportedContent) {
    return translator("targetMenu.disabled.noPaste");
  }
  if (entry.actionId === "reset-route" && !options.hasManualRoute) {
    return translator("targetMenu.disabled.noManualRoute");
  }
  if (entry.actionId === "fit-group" && !options.hasGroupMembers) {
    return translator("targetMenu.disabled.noGroupMembers");
  }
  if (entry.actionId === "collapse-group" && options.isGroupCollapsed) {
    return translator("targetMenu.disabled.alreadyCollapsed");
  }
  if (entry.actionId === "expand-group" && !options.isGroupCollapsed) {
    return translator("targetMenu.disabled.alreadyExpanded");
  }
  if (
    (entry.actionId === "bring-group-forward" || entry.actionId === "send-group-backward")
    && options.canChangeGroupOrder === false
  ) {
    return translator("targetMenu.disabled.groupOrderLimit");
  }
  if (options.readOnly && requiresWrite(entry.actionId)) {
    return translator("targetMenu.disabled.readOnly");
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
    "collapse-group",
    "expand-group",
  ]).has(actionId);
}

function copyDestination(destination: TargetContextDestination): TargetContextDestination {
  return { ...destination };
}

function assertNever(value: never): never {
  throw new Error(`Unhandled context target: ${JSON.stringify(value)}`);
}
