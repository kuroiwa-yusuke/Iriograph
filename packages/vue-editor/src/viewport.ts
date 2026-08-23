import type { ElementGeometry, Point } from "@iriograph/core";

export const DIAGRAM_ZOOM_MIN = 0.1;
export const DIAGRAM_ZOOM_MAX = 2;

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
};

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
