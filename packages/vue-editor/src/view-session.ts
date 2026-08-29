import type { DiagramScene } from "@iriograph/core";

import type { DiagramViewportState } from "./viewport";

export type CanvasDragMode = "select" | "pan";

export type DiagramViewSession = {
  selectedElementIds: string[];
  primaryElementId: string;
  viewport: DiagramViewportState;
  dragMode: CanvasDragMode;
  temporaryHiddenElementIds: Set<string>;
  /** Session-only group folding. Never persisted to a named view or history. */
  collapsedGroupElementIds: Set<string>;
};

export function createDiagramViewSession(): DiagramViewSession {
  return {
    selectedElementIds: [],
    primaryElementId: "",
    viewport: { zoom: 1, scrollLeft: 0, scrollTop: 0 },
    dragMode: "select",
    temporaryHiddenElementIds: new Set(),
    collapsedGroupElementIds: new Set(),
  };
}

export type CollapsedGroupSummary = {
  groupElementId: string;
  hiddenElementIds: string[];
  hiddenLabels: string[];
};

/** Keeps a folded group frame visible while suppressing members and incident edges. */
export function sceneWithCollapsedGroups(
  source: DiagramScene,
  collapsedIds: ReadonlySet<string>,
): { scene: DiagramScene; summaries: Readonly<Record<string, CollapsedGroupSummary>> } {
  if (collapsedIds.size === 0) return { scene: source, summaries: {} };
  const geometry = [...source.nodes, ...source.containers, ...(source.regions ?? [])];
  const byId = new Map(geometry.map((element) => [element.elementId, element]));
  const directMembers = new Map<string, Set<string>>();
  const add = (group: string, member: string): void => {
    const values = directMembers.get(group) ?? new Set<string>();
    values.add(member);
    directMembers.set(group, values);
  };
  for (const element of [...source.nodes, ...source.containers]) {
    if (element.parentElementId) add(element.parentElementId, element.elementId);
  }
  for (const membership of source.memberships ?? []) add(membership.containerElementId, membership.memberElementId);

  const hidden = new Set<string>();
  const summaries: Record<string, CollapsedGroupSummary> = {};
  for (const groupId of [...collapsedIds].sort()) {
    if (!byId.has(groupId)) continue;
    const groupHidden = new Set<string>();
    const visit = (memberId: string): void => {
      if (memberId === groupId || groupHidden.has(memberId)) return;
      groupHidden.add(memberId);
      hidden.add(memberId);
      for (const child of directMembers.get(memberId) ?? []) visit(child);
    };
    for (const member of directMembers.get(groupId) ?? []) visit(member);
    summaries[groupId] = {
      groupElementId: groupId,
      hiddenElementIds: [...groupHidden].sort(),
      hiddenLabels: [...groupHidden].flatMap((id) => byId.get(id)?.label ? [byId.get(id)!.label] : []).sort(),
    };
  }
  return {
    scene: {
      ...source,
      nodes: source.nodes.filter((item) => !hidden.has(item.elementId)),
      containers: source.containers.filter((item) => !hidden.has(item.elementId)),
      regions: source.regions?.filter((item) => !hidden.has(item.elementId)),
      memberships: source.memberships?.filter((item) => !hidden.has(item.containerElementId) && !hidden.has(item.memberElementId)),
      groupGuides: source.groupGuides?.filter((item) => !hidden.has(item.groupElementId) && !hidden.has(item.sourceElementId) && !hidden.has(item.targetElementId)),
      edges: source.edges.filter((edge) => !hidden.has(edge.elementId) && !hidden.has(edge.sourceElementId) && !hidden.has(edge.targetElementId)),
    },
    summaries,
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
