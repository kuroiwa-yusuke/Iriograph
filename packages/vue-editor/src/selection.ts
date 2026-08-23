import {
  containerContentBounds,
  type DiagramScene,
  type ElementGeometry,
  type Point,
  type SceneContainer,
  type SceneNode,
} from "@iriograph/core";

export type GeometryElement = SceneNode | SceneContainer;

export type GeometryChange = {
  elementId: string;
  geometry: ElementGeometry;
};

export type DiagramSelectionRequest = {
  elementId: string;
  mode: "replace" | "add" | "toggle" | "preserve";
};

export type IriographEditorSelectionApi = {
  selectElement(elementId: string): void;
  selectElements(elementIds: readonly string[]): void;
  clearSelection(): void;
  selectAll(): void;
  setSnapSettings(settings: DiagramSnapSettingsInput): void;
};

export type DiagramSnapSettings = {
  grid: {
    enabled: boolean;
    size: number;
  };
  targets: {
    enabled: boolean;
    tolerance: number;
  };
};

export type DiagramSnapSettingsInput = {
  grid?: Partial<DiagramSnapSettings["grid"]>;
  targets?: Partial<DiagramSnapSettings["targets"]>;
};

export type DiagramAlignment = "left" | "center" | "right" | "top" | "middle" | "bottom";
export type DiagramDistribution = "horizontal" | "vertical";

export const DEFAULT_DIAGRAM_SNAP_SETTINGS: DiagramSnapSettings = {
  grid: { enabled: true, size: 8 },
  targets: { enabled: true, tolerance: 6 },
};

const SCENE_INSET = 8;

export function normalizeDiagramSnapSettings(
  value?: DiagramSnapSettingsInput,
): DiagramSnapSettings {
  return {
    grid: {
      enabled: value?.grid?.enabled ?? DEFAULT_DIAGRAM_SNAP_SETTINGS.grid.enabled,
      size: boundedInteger(value?.grid?.size, 1, 128, DEFAULT_DIAGRAM_SNAP_SETTINGS.grid.size),
    },
    targets: {
      enabled: value?.targets?.enabled ?? DEFAULT_DIAGRAM_SNAP_SETTINGS.targets.enabled,
      tolerance: boundedInteger(
        value?.targets?.tolerance,
        0,
        32,
        DEFAULT_DIAGRAM_SNAP_SETTINGS.targets.tolerance,
      ),
    },
  };
}

export function sceneElementIds(scene: DiagramScene): string[] {
  return [
    ...scene.containers.map((element) => element.elementId),
    ...scene.nodes.map((element) => element.elementId),
    ...scene.edges.map((element) => element.elementId),
  ];
}

export function normalizeSceneSelection(
  scene: DiagramScene,
  elementIds: readonly string[],
): string[] {
  const available = new Set(sceneElementIds(scene));
  const seen = new Set<string>();
  return elementIds.filter((elementId) => {
    if (!available.has(elementId) || seen.has(elementId)) return false;
    seen.add(elementId);
    return true;
  });
}

export function selectedGeometryElements(
  scene: DiagramScene,
  elementIds: readonly string[],
): GeometryElement[] {
  const selected = new Set(elementIds);
  return geometryElements(scene).filter((element) => selected.has(element.elementId));
}

export function diagramContainerContentBounds(parent: SceneContainer): ElementGeometry {
  return containerContentBounds(parent.geometry, parent.headerPosition);
}

export function translateSelection(
  scene: DiagramScene,
  elementIds: readonly string[],
  requestedDelta: Point,
  snapValue?: DiagramSnapSettingsInput,
): GeometryChange[] {
  const index = geometryIndex(scene);
  const roots = selectionRoots(index, elementIds);
  const participants = expandRootGroups(index, roots);
  if (participants.length === 0) return [];
  const settings = normalizeDiagramSnapSettings(snapValue);
  const snapped = snapTranslation(scene, participants, requestedDelta, settings);
  const delta = constrainCommonTranslation(scene, participants, snapped);
  return participants
    .filter((element) => delta.x !== 0 || delta.y !== 0)
    .map((element) => ({
      elementId: element.elementId,
      geometry: translated(element.geometry, delta),
    }))
    .sort(compareChanges);
}

export function resizeGeometryElement(
  scene: DiagramScene,
  elementId: string,
  requestedSize: { width: number; height: number },
): GeometryChange | undefined {
  const index = geometryIndex(scene);
  const element = index.get(elementId);
  if (!element) return undefined;
  const minimumBase = element.structuralKind === "container"
    ? { width: 240, height: 120 }
    : { width: 44, height: 36 };
  const children = element.structuralKind === "container"
    ? [...index.values()].filter((candidate) => candidate.parentElementId === element.elementId)
    : [];
  const minimum = {
    width: Math.max(
      minimumBase.width,
      ...children.map((child) => (
        child.geometry.x + child.geometry.width - element.geometry.x + 16
      )),
    ),
    height: Math.max(
      minimumBase.height,
      ...children.map((child) => (
        child.geometry.y + child.geometry.height - element.geometry.y + 16
      )),
    ),
  };
  const parent = element.parentElementId ? index.get(element.parentElementId) : undefined;
  const outer = parent?.structuralKind === "container"
    ? diagramContainerContentBounds(parent)
    : {
        x: SCENE_INSET,
        y: SCENE_INSET,
        width: scene.width - SCENE_INSET * 2,
        height: scene.height - SCENE_INSET * 2,
      };
  const maximum = {
    width: outer.x + outer.width - element.geometry.x,
    height: outer.y + outer.height - element.geometry.y,
  };
  if (maximum.width < minimum.width || maximum.height < minimum.height) return undefined;
  const geometry = {
    ...element.geometry,
    width: clampToInterval(requestedSize.width, minimum.width, maximum.width),
    height: clampToInterval(requestedSize.height, minimum.height, maximum.height),
  };
  if (
    geometry.width === element.geometry.width
    && geometry.height === element.geometry.height
  ) return undefined;
  return { elementId, geometry };
}

export function alignSelection(
  scene: DiagramScene,
  elementIds: readonly string[],
  alignment: DiagramAlignment,
): GeometryChange[] {
  const index = geometryIndex(scene);
  const roots = selectionRoots(index, elementIds);
  if (roots.length < 2) return [];
  const bounds = combinedBounds(roots);
  const changes = new Map<string, GeometryChange>();

  for (const element of roots) {
    const delta = alignmentDelta(element.geometry, bounds, alignment);
    for (const change of translateSelection(scene, [element.elementId], delta, noSnap())) {
      changes.set(change.elementId, change);
    }
  }
  return [...changes.values()].sort(compareChanges);
}

export function distributeSelection(
  scene: DiagramScene,
  elementIds: readonly string[],
  direction: DiagramDistribution,
): GeometryChange[] {
  const index = geometryIndex(scene);
  const roots = selectionRoots(index, elementIds);
  if (roots.length < 3) return [];
  const horizontal = direction === "horizontal";
  const ordered = [...roots].sort((left, right) => {
    const difference = horizontal
      ? left.geometry.x - right.geometry.x
      : left.geometry.y - right.geometry.y;
    return difference || compareText(left.elementId, right.elementId);
  });
  const start = horizontal ? ordered[0]!.geometry.x : ordered[0]!.geometry.y;
  const last = ordered.at(-1)!;
  const end = horizontal
    ? last.geometry.x + last.geometry.width
    : last.geometry.y + last.geometry.height;
  const occupied = ordered.reduce((sum, element) => (
    sum + (horizontal ? element.geometry.width : element.geometry.height)
  ), 0);
  const gap = (end - start - occupied) / (ordered.length - 1);
  const changes = new Map<string, GeometryChange>();
  let cursor = start;

  ordered.forEach((element, indexInOrder) => {
    const current = horizontal ? element.geometry.x : element.geometry.y;
    const delta = indexInOrder === 0 || indexInOrder === ordered.length - 1
      ? 0
      : cursor - current;
    const movement = horizontal ? { x: delta, y: 0 } : { x: 0, y: delta };
    for (const change of translateSelection(scene, [element.elementId], movement, noSnap())) {
      changes.set(change.elementId, change);
    }
    cursor += (horizontal ? element.geometry.width : element.geometry.height) + gap;
  });
  return [...changes.values()].sort(compareChanges);
}

function snapTranslation(
  scene: DiagramScene,
  participants: readonly GeometryElement[],
  requested: Point,
  settings: DiagramSnapSettings,
): Point {
  const movingBounds = combinedBounds(participants);
  const movingIds = new Set(participants.map((element) => element.elementId));
  const stationary = geometryElements(scene).filter((element) => !movingIds.has(element.elementId));
  return {
    x: snappedAxis("x", movingBounds, stationary, requested.x, settings),
    y: snappedAxis("y", movingBounds, stationary, requested.y, settings),
  };
}

function snappedAxis(
  axis: "x" | "y",
  moving: ElementGeometry,
  stationary: readonly GeometryElement[],
  requested: number,
  settings: DiagramSnapSettings,
): number {
  if (settings.targets.enabled) {
    const movingPoints = axisPoints(moving, axis);
    const candidates: Array<{ distance: number; value: number; target: number; key: string }> = [];
    for (const element of stationary) {
      for (const target of axisPoints(element.geometry, axis)) {
        for (const [key, point] of movingPoints.entries()) {
          const adjustment = target - (point + requested);
          if (Math.abs(adjustment) <= settings.targets.tolerance) {
            candidates.push({
              distance: Math.abs(adjustment),
              value: requested + adjustment,
              target,
              key: `${element.elementId}:${key}`,
            });
          }
        }
      }
    }
    candidates.sort((left, right) => (
      left.distance - right.distance
      || left.target - right.target
      || compareText(left.key, right.key)
    ));
    if (candidates[0]) return candidates[0].value;
  }
  if (!settings.grid.enabled) return requested;
  const origin = axis === "x" ? moving.x : moving.y;
  return Math.round((origin + requested) / settings.grid.size) * settings.grid.size - origin;
}

function constrainCommonTranslation(
  scene: DiagramScene,
  participants: readonly GeometryElement[],
  requested: Point,
): Point {
  const movingIds = new Set(participants.map((element) => element.elementId));
  const index = geometryIndex(scene);
  let minimumX = Number.NEGATIVE_INFINITY;
  let maximumX = Number.POSITIVE_INFINITY;
  let minimumY = Number.NEGATIVE_INFINITY;
  let maximumY = Number.POSITIVE_INFINITY;

  for (const element of participants) {
    const parent = element.parentElementId ? index.get(element.parentElementId) : undefined;
    if (parent?.structuralKind === "container" && !movingIds.has(parent.elementId)) {
      const content = diagramContainerContentBounds(parent);
      if (element.geometry.width > content.width || element.geometry.height > content.height) {
        return { x: 0, y: 0 };
      }
    } else if (element.geometry.width > scene.width - SCENE_INSET * 2
      || element.geometry.height > scene.height - SCENE_INSET * 2) {
      return { x: 0, y: 0 };
    }
    const allowed = parent?.structuralKind === "container" && !movingIds.has(parent.elementId)
      ? boundsInsideContainer(parent, element.geometry)
      : boundsInsideScene(scene, element.geometry);
    minimumX = Math.max(minimumX, allowed.minimumX - element.geometry.x);
    maximumX = Math.min(maximumX, allowed.maximumX - element.geometry.x);
    minimumY = Math.max(minimumY, allowed.minimumY - element.geometry.y);
    maximumY = Math.min(maximumY, allowed.maximumY - element.geometry.y);
  }
  return {
    x: clampToInterval(requested.x, minimumX, maximumX),
    y: clampToInterval(requested.y, minimumY, maximumY),
  };
}

function geometryElements(scene: DiagramScene): GeometryElement[] {
  return [...scene.containers, ...scene.nodes];
}

function geometryIndex(scene: DiagramScene): Map<string, GeometryElement> {
  return new Map(geometryElements(scene).map((element) => [element.elementId, element]));
}

function selectionRoots(
  index: ReadonlyMap<string, GeometryElement>,
  elementIds: readonly string[],
): GeometryElement[] {
  const selected = new Set(elementIds.filter((elementId) => index.has(elementId)));
  return [...selected]
    .filter((elementId) => !hasSelectedAncestor(index, elementId, selected))
    .map((elementId) => index.get(elementId)!)
    .sort((left, right) => compareText(left.elementId, right.elementId));
}

function hasSelectedAncestor(
  index: ReadonlyMap<string, GeometryElement>,
  elementId: string,
  selected: ReadonlySet<string>,
): boolean {
  const visited = new Set<string>();
  let parentId = index.get(elementId)?.parentElementId;
  while (parentId && !visited.has(parentId)) {
    if (selected.has(parentId)) return true;
    visited.add(parentId);
    parentId = index.get(parentId)?.parentElementId;
  }
  return false;
}

function expandRootGroups(
  index: ReadonlyMap<string, GeometryElement>,
  roots: readonly GeometryElement[],
): GeometryElement[] {
  const rootsSet = new Set(roots.map((element) => element.elementId));
  return [...index.values()]
    .filter((element) => (
      rootsSet.has(element.elementId)
      || hasSelectedAncestor(index, element.elementId, rootsSet)
    ))
    .sort((left, right) => compareText(left.elementId, right.elementId));
}

function boundsInsideScene(
  scene: DiagramScene,
  geometry: ElementGeometry,
): BoundsRange {
  return {
    minimumX: SCENE_INSET,
    maximumX: Math.max(SCENE_INSET, scene.width - geometry.width - SCENE_INSET),
    minimumY: SCENE_INSET,
    maximumY: Math.max(SCENE_INSET, scene.height - geometry.height - SCENE_INSET),
  };
}

function boundsInsideContainer(
  parent: SceneContainer,
  geometry: ElementGeometry,
): BoundsRange {
  const content = diagramContainerContentBounds(parent);
  return {
    minimumX: content.x,
    maximumX: Math.max(
      content.x,
      content.x + content.width - geometry.width,
    ),
    minimumY: content.y,
    maximumY: Math.max(
      content.y,
      content.y + content.height - geometry.height,
    ),
  };
}

function alignmentDelta(
  geometry: ElementGeometry,
  bounds: ElementGeometry,
  alignment: DiagramAlignment,
): Point {
  if (alignment === "left") return { x: bounds.x - geometry.x, y: 0 };
  if (alignment === "center") {
    return { x: bounds.x + bounds.width / 2 - geometry.width / 2 - geometry.x, y: 0 };
  }
  if (alignment === "right") {
    return { x: bounds.x + bounds.width - geometry.width - geometry.x, y: 0 };
  }
  if (alignment === "top") return { x: 0, y: bounds.y - geometry.y };
  if (alignment === "middle") {
    return { x: 0, y: bounds.y + bounds.height / 2 - geometry.height / 2 - geometry.y };
  }
  return { x: 0, y: bounds.y + bounds.height - geometry.height - geometry.y };
}

function combinedBounds(elements: readonly GeometryElement[]): ElementGeometry {
  const left = Math.min(...elements.map((element) => element.geometry.x));
  const top = Math.min(...elements.map((element) => element.geometry.y));
  const right = Math.max(...elements.map((element) => element.geometry.x + element.geometry.width));
  const bottom = Math.max(...elements.map((element) => element.geometry.y + element.geometry.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function axisPoints(geometry: ElementGeometry, axis: "x" | "y"): number[] {
  const start = axis === "x" ? geometry.x : geometry.y;
  const size = axis === "x" ? geometry.width : geometry.height;
  return [start, start + size / 2, start + size];
}

function translated(geometry: ElementGeometry, delta: Point): ElementGeometry {
  return { ...geometry, x: geometry.x + delta.x, y: geometry.y + delta.y };
}

function noSnap(): DiagramSnapSettings {
  return {
    grid: { enabled: false, size: DEFAULT_DIAGRAM_SNAP_SETTINGS.grid.size },
    targets: { enabled: false, tolerance: DEFAULT_DIAGRAM_SNAP_SETTINGS.targets.tolerance },
  };
}

function compareChanges(left: GeometryChange, right: GeometryChange): number {
  return compareText(left.elementId, right.elementId);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function clampToInterval(value: number, minimum: number, maximum: number): number {
  if (minimum > maximum) return 0;
  return Math.max(minimum, Math.min(value, maximum));
}

function boundedInteger(
  value: number | undefined,
  minimum: number,
  maximum: number,
  fallback: number,
): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.round(value!)));
}

type BoundsRange = {
  minimumX: number;
  maximumX: number;
  minimumY: number;
  maximumY: number;
};
