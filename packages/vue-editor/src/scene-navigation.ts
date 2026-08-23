import type { DiagramScene } from "@iriograph/core";

export type SceneNavigatorKind = "container" | "node" | "edge";

export type SceneNavigatorItem = {
  elementId: string;
  kind: SceneNavigatorKind;
  label: string;
};

const KIND_ORDER: Record<SceneNavigatorKind, number> = {
  container: 0,
  node: 1,
  edge: 2,
};

/** A projection-independent order used by focus movement and range selection. */
export function sceneNavigatorItems(scene: DiagramScene): SceneNavigatorItem[] {
  return [
    ...scene.containers.map((element) => ({
      elementId: element.elementId,
      kind: "container" as const,
      label: element.label,
    })),
    ...scene.nodes.map((element) => ({
      elementId: element.elementId,
      kind: "node" as const,
      label: element.label,
    })),
    ...scene.edges.map((element) => ({
      elementId: element.elementId,
      kind: "edge" as const,
      label: element.label || element.semanticRef,
    })),
  ].sort((left, right) => (
    KIND_ORDER[left.kind] - KIND_ORDER[right.kind]
    || compareText(left.elementId, right.elementId)
  ));
}

export function moveSceneNavigatorFocus(
  items: readonly SceneNavigatorItem[],
  activeElementId: string,
  movement: "next" | "previous" | "first" | "last",
): string {
  if (items.length === 0) return "";
  if (movement === "first") return items[0]!.elementId;
  if (movement === "last") return items.at(-1)!.elementId;
  const current = items.findIndex((item) => item.elementId === activeElementId);
  if (current < 0) return movement === "previous" ? items.at(-1)!.elementId : items[0]!.elementId;
  const delta = movement === "next" ? 1 : -1;
  return items[(current + delta + items.length) % items.length]!.elementId;
}

export function sceneNavigatorRange(
  items: readonly SceneNavigatorItem[],
  anchorElementId: string,
  activeElementId: string,
): string[] {
  const anchor = items.findIndex((item) => item.elementId === anchorElementId);
  const active = items.findIndex((item) => item.elementId === activeElementId);
  if (anchor < 0 || active < 0) return activeElementId ? [activeElementId] : [];
  const start = Math.min(anchor, active);
  const end = Math.max(anchor, active);
  const range = items.slice(start, end + 1).map((item) => item.elementId);
  return [...range.filter((elementId) => elementId !== activeElementId), activeElementId];
}

/** Retains a stable ID, then the same deterministic slot when an item disappears. */
export function restoreSceneNavigatorFocus(
  previousItems: readonly SceneNavigatorItem[],
  nextItems: readonly SceneNavigatorItem[],
  activeElementId: string,
  preferredElementId = "",
): string {
  if (activeElementId && nextItems.some((item) => item.elementId === activeElementId)) {
    return activeElementId;
  }
  if (nextItems.length === 0) return "";
  const previousIndex = previousItems.findIndex((item) => item.elementId === activeElementId);
  if (previousIndex >= 0) {
    return nextItems[Math.min(previousIndex, nextItems.length - 1)]!.elementId;
  }
  if (preferredElementId && nextItems.some((item) => item.elementId === preferredElementId)) {
    return preferredElementId;
  }
  return nextItems[Math.min(Math.max(previousIndex, 0), nextItems.length - 1)]!.elementId;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
