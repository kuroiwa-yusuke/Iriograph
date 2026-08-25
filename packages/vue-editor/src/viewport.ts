import type { DiagramScene, ElementGeometry, Point } from "@iriograph/core";

export const DIAGRAM_ZOOM_MIN = 0.1;
export const DIAGRAM_ZOOM_MAX = 2;
export const DIAGRAM_WORK_AREA_PADDING = 320;
export const DIAGRAM_WORK_AREA_EXPANSION_PADDING = 160;

export type DiagramViewportMetrics = {
  scrollLeft: number;
  scrollTop: number;
  width: number;
  height: number;
};

export type DiagramCanvasNavigationApi = {
  panBy(deltaX: number, deltaY: number): void;
  zoomTo(zoom: number): Promise<void>;
  fitToView(): Promise<void>;
  revealElement(elementId: string): Promise<boolean>;
  centerOn(point: Point): void;
  getViewportState(): DiagramViewportState;
  restoreViewport(state: DiagramViewportState): Promise<void>;
};

export type DiagramViewportState = {
  zoom: number;
  scrollLeft: number;
  scrollTop: number;
};

/**
 * Ephemeral Canvas workspace in semantic coordinates. It is deliberately not
 * persisted in a view overlay: geometry may grow beyond the projected Scene,
 * while the workspace itself is recreated from current geometry on load.
 */
export type DiagramWorkAreaBounds = ElementGeometry;

export type IriographEditorNavigationApi = {
  panBy(deltaX: number, deltaY: number): void;
  zoomTo(zoom: number): Promise<void>;
  fitToView(): Promise<void>;
  revealSelection(): Promise<boolean>;
  focusElement(elementId: string): Promise<boolean>;
};

export function normalizeDiagramZoom(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(
    DIAGRAM_ZOOM_MAX,
    Math.max(DIAGRAM_ZOOM_MIN, Math.round(value * 100) / 100),
  );
}

export function diagramWorkAreaBounds(
  scene: DiagramScene,
  padding = DIAGRAM_WORK_AREA_PADDING,
): DiagramWorkAreaBounds {
  const content = diagramContentBounds(scene);
  const safePadding = finiteNonNegative(padding);
  return {
    x: content.x - safePadding,
    y: content.y - safePadding,
    width: content.width + safePadding * 2,
    height: content.height + safePadding * 2,
  };
}

/**
 * Padding-free bounds of the semantic Scene plane and every rendered geometry.
 * The Scene plane preserves the positive-coordinate contract; negative or
 * external geometry/edge routes extend it without including Canvas workspace.
 */
export function diagramContentBounds(scene: DiagramScene): ElementGeometry {
  const sceneWidth = finitePositive(scene.width);
  const sceneHeight = finitePositive(scene.height);
  const geometries = [
    ...scene.containers,
    ...(scene.regions ?? []),
    ...scene.nodes,
  ].map((element) => element.geometry);
  const routePoints = scene.edges.flatMap((edge) => [
    ...(edge.route ?? []),
    ...(edge.waypoints ?? []),
  ]).filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  const left = Math.min(
    0,
    ...geometries.map((geometry) => geometry.x),
    ...routePoints.map((point) => point.x),
  );
  const top = Math.min(
    0,
    ...geometries.map((geometry) => geometry.y),
    ...routePoints.map((point) => point.y),
  );
  const right = Math.max(
    sceneWidth,
    ...geometries.map((geometry) => geometry.x + geometry.width),
    ...routePoints.map((point) => point.x),
  );
  const bottom = Math.max(
    sceneHeight,
    ...geometries.map((geometry) => geometry.y + geometry.height),
    ...routePoints.map((point) => point.y),
  );
  return { x: left, y: top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
}

/** Monotonically grows a work area during one editor session/gesture. */
export function expandDiagramWorkAreaBounds(
  current: DiagramWorkAreaBounds,
  geometries: readonly ElementGeometry[],
  padding = DIAGRAM_WORK_AREA_EXPANSION_PADDING,
): DiagramWorkAreaBounds {
  if (geometries.length === 0) return { ...current };
  const safePadding = finiteNonNegative(padding);
  const currentRight = current.x + current.width;
  const currentBottom = current.y + current.height;
  const left = Math.min(current.x, ...geometries.map((geometry) => geometry.x - safePadding));
  const top = Math.min(current.y, ...geometries.map((geometry) => geometry.y - safePadding));
  const right = Math.max(
    currentRight,
    ...geometries.map((geometry) => geometry.x + geometry.width + safePadding),
  );
  const bottom = Math.max(
    currentBottom,
    ...geometries.map((geometry) => geometry.y + geometry.height + safePadding),
  );
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function diagramFitZoom(
  scene: { width: number; height: number },
  viewport: { width: number; height: number },
  padding = 24,
): number {
  if (
    scene.width <= 0
    || scene.height <= 0
    || viewport.width <= 0
    || viewport.height <= 0
  ) return 1;
  const availableWidth = Math.max(1, viewport.width - padding * 2);
  const availableHeight = Math.max(1, viewport.height - padding * 2);
  return normalizeDiagramZoom(Math.min(
    availableWidth / scene.width,
    availableHeight / scene.height,
  ));
}

export function scrollToRevealBounds(
  bounds: ElementGeometry,
  zoom: number,
  viewport: DiagramViewportMetrics,
  contentOffset: Point,
  margin = 32,
): Point {
  const left = contentOffset.x + bounds.x * zoom;
  const top = contentOffset.y + bounds.y * zoom;
  const right = left + bounds.width * zoom;
  const bottom = top + bounds.height * zoom;
  const visibleRight = viewport.scrollLeft + viewport.width;
  const visibleBottom = viewport.scrollTop + viewport.height;
  let x = viewport.scrollLeft;
  let y = viewport.scrollTop;

  if (right - left + margin * 2 >= viewport.width) {
    x = (left + right - viewport.width) / 2;
  } else if (left < viewport.scrollLeft + margin) {
    x = left - margin;
  } else if (right > visibleRight - margin) {
    x = right - viewport.width + margin;
  }

  if (bottom - top + margin * 2 >= viewport.height) {
    y = (top + bottom - viewport.height) / 2;
  } else if (top < viewport.scrollTop + margin) {
    y = top - margin;
  } else if (bottom > visibleBottom - margin) {
    y = bottom - viewport.height + margin;
  }

  return { x: Math.max(0, x), y: Math.max(0, y) };
}

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function finitePositive(value: number): number {
  return Number.isFinite(value) ? Math.max(1, value) : 1;
}
