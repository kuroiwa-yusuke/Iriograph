export type CanvasKeyboardCommand =
  | { kind: "none" }
  | { kind: "cancel" }
  | { kind: "select-all" }
  | { kind: "select" }
  | { kind: "toggle-selection" }
  | { kind: "semantic-edit" }
  | { kind: "focus"; movement: "next" | "previous" | "first" | "last" }
  | { kind: "nudge" }
  | { kind: "pan" }
  | { kind: "presentation-primary" }
  | { kind: "presentation-secondary" }
  | { kind: "waypoint-add" }
  | { kind: "waypoint-remove" }
  | { kind: "waypoint-focus"; movement: "previous" | "next" };

export type CanvasKeyboardEventLike = Pick<KeyboardEvent,
  "key" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey" | "isComposing"
>;

/**
 * Resolves command intent without knowing Vue, DOM nodes, inspector state, or Scene internals.
 * Future surfaces can reuse this precedence while mapping the two presentation commands to
 * geometry, routing, endpoint anchors, or inspector values.
 */
export function resolveCanvasKeyboardCommand(
  event: CanvasKeyboardEventLike,
  options: { editableTarget?: boolean; compositionActive?: boolean } = {},
): CanvasKeyboardCommand {
  if (event.isComposing || options.compositionActive || options.editableTarget) return { kind: "none" };
  const command = event.ctrlKey || event.metaKey;
  const arrow = isArrowKey(event.key);

  if (event.key === "Escape") return { kind: "cancel" };
  if (command && event.key.toLowerCase() === "a") return { kind: "select-all" };

  // Modified arrows keep the detailed presentation controls. Plain arrows
  // are reserved for selection nudge (or viewport pan when nothing is
  // selected), so object navigation has an explicit, non-spatial command.
  if (arrow && command && event.shiftKey) return { kind: "presentation-secondary" };
  if (arrow && command) return { kind: "presentation-primary" };
  if (!command && !event.altKey && (event.key === "Insert" || event.key.toLowerCase() === "w")) {
    return { kind: "waypoint-add" };
  }
  if (command && (event.key === "Backspace" || event.key === "Delete")) {
    return { kind: "waypoint-remove" };
  }
  if (!command && !event.altKey && (event.key === "[" || event.key === ",")) {
    return { kind: "waypoint-focus", movement: "previous" };
  }
  if (!command && !event.altKey && (event.key === "]" || event.key === ".")) {
    return { kind: "waypoint-focus", movement: "next" };
  }
  if (event.key === " " && command) return { kind: "toggle-selection" };
  if ((event.key === "Enter" || event.key === " ") && !command) return { kind: "select" };
  if ((event.key === "Delete" || event.key === "Backspace") && !command) {
    return { kind: "semantic-edit" };
  }
  if (!command && !event.altKey) {
    if (arrow) return { kind: "nudge" };
    if (event.key.toLowerCase() === "n") {
      return { kind: "focus", movement: event.shiftKey ? "previous" : "next" };
    }
    const movement = focusBoundaryMovement(event.key);
    if (movement) return { kind: "focus", movement };
    if (event.key === "PageUp" || event.key === "PageDown") return { kind: "pan" };
  }
  return { kind: "none" };
}

export function keyboardArrowMovement(key: string, step: number): { x: number; y: number } | undefined {
  return ({
    ArrowLeft: { x: -step, y: 0 },
    ArrowRight: { x: step, y: 0 },
    ArrowUp: { x: 0, y: -step },
    ArrowDown: { x: 0, y: step },
  } as Record<string, { x: number; y: number }>)[key];
}

function focusBoundaryMovement(key: string): "first" | "last" | undefined {
  return ({
    Home: "first",
    End: "last",
  } as Record<string, "first" | "last">)[key];
}

function isArrowKey(key: string): boolean {
  return key === "ArrowLeft" || key === "ArrowRight" || key === "ArrowUp" || key === "ArrowDown";
}
