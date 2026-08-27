import type { DiagramScene } from "@iriograph/core";

import type { DiagramViewportState } from "./viewport";

export type CanvasDragMode = "select" | "pan";

export type DiagramViewSession = {
  selectedElementIds: string[];
  primaryElementId: string;
  viewport: DiagramViewportState;
  dragMode: CanvasDragMode;
  temporaryHiddenElementIds: Set<string>;
};

export function createDiagramViewSession(): DiagramViewSession {
  return {
    selectedElementIds: [],
    primaryElementId: "",
    viewport: { zoom: 1, scrollLeft: 0, scrollTop: 0 },
    dragMode: "select",
    temporaryHiddenElementIds: new Set(),
  };
}

/**
 * Applies session-only exact-ID hiding. Hiding a container additionally hides
 * its structural descendants, then removes only edges incident to hidden
 * geometry elements (or edges explicitly named by the user).
 */
export function sceneWithTemporaryHiddenElements(
  source: DiagramScene,
  requestedIds: ReadonlySet<string>,
): DiagramScene {
  if (requestedIds.size === 0) return source;
  const containersByParent = new Map<string, string[]>();
  const nodesByParent = new Map<string, string[]>();
  for (const container of source.containers) {
    if (!container.parentElementId) continue;
    const children = containersByParent.get(container.parentElementId) ?? [];
    children.push(container.elementId);
    containersByParent.set(container.parentElementId, children);
  }
  for (const node of source.nodes) {
    if (!node.parentElementId) continue;
    const children = nodesByParent.get(node.parentElementId) ?? [];
    children.push(node.elementId);
    nodesByParent.set(node.parentElementId, children);
  }

  const hiddenGeometryIds = new Set<string>();
  const hideGeometry = (elementId: string): void => {
    if (hiddenGeometryIds.has(elementId)) return;
    hiddenGeometryIds.add(elementId);
    for (const childId of containersByParent.get(elementId) ?? []) hideGeometry(childId);
    for (const childId of nodesByParent.get(elementId) ?? []) hideGeometry(childId);
  };
  const geometryIds = new Set([
    ...source.nodes.map((node) => node.elementId),
    ...source.containers.map((container) => container.elementId),
    ...(source.regions ?? []).map((region) => region.elementId),
  ]);
  for (const elementId of requestedIds) {
    if (geometryIds.has(elementId)) hideGeometry(elementId);
  }

  const edges = source.edges.filter((edge) => (
    !requestedIds.has(edge.elementId)
    && !hiddenGeometryIds.has(edge.sourceElementId)
    && !hiddenGeometryIds.has(edge.targetElementId)
  ));
  return {
    ...source,
    nodes: source.nodes.filter((node) => !hiddenGeometryIds.has(node.elementId)),
    containers: source.containers.filter((container) => !hiddenGeometryIds.has(container.elementId)),
    regions: source.regions?.filter((region) => !hiddenGeometryIds.has(region.elementId)),
    edges,
  };
}
