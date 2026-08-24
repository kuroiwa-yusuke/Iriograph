import {
  isValidEdgeEndpointAnchor,
  type EdgeEndpointAnchor,
  type EdgeTerminalMarker,
  type ElementGeometry,
  type Point,
  type SceneEdge,
} from "@iriograph/core";

export type EditableEdgeRouting = {
  waypoints?: Point[];
  labelOffset?: Point;
  sourceAnchor?: EdgeEndpointAnchor;
  targetAnchor?: EdgeEndpointAnchor;
  sourceMarker?: EdgeTerminalMarker;
  targetMarker?: EdgeTerminalMarker;
};

export type EdgeRoutingUpdate = {
  elementId: string;
  routing?: EditableEdgeRouting;
};

export type NearestPolylinePoint = {
  point: Point;
  segmentIndex: number;
  distanceSquared: number;
};

/**
 * Follows ephemeral node geometry without changing persisted manual points.
 * Generated routes translate as a whole when both endpoints share a delta;
 * otherwise endpoint-adjacent orthogonal segments follow each endpoint.
 */
export function previewEdgeRoute(
  edge: Pick<SceneEdge, "route" | "waypoints">,
  source: { original: ElementGeometry; preview: ElementGeometry },
  target: { original: ElementGeometry; preview: ElementGeometry },
): Point[] {
  const route = derivedEdgeRoute(edge);
  if (route.length < 2) return route;
  const sourceDelta = geometryCenterDelta(source.original, source.preview);
  const targetDelta = geometryCenterDelta(target.original, target.preview);
  if (isZeroPoint(sourceDelta) && isZeroPoint(targetDelta)) return route;
  if (!edge.waypoints?.length && samePoint(sourceDelta, targetDelta)) {
    return route.map((point) => translatePoint(point, sourceDelta));
  }
  const result = route.map(copyPoint);
  if (edge.waypoints?.length) {
    result[0] = translatePoint(route[0]!, sourceDelta);
    result[result.length - 1] = translatePoint(route.at(-1)!, targetDelta);
    return result;
  }
  followRouteEndpoint(result, route, 0, sourceDelta);
  followRouteEndpoint(result, route, result.length - 1, targetDelta);
  return result;
}

/** Returns a defensive endpoint-inclusive route when the Scene provides one. */
export function derivedEdgeRoute(edge: Pick<SceneEdge, "route">): Point[] {
  return edge.route && edge.route.length >= 2
    ? edge.route.filter(isFinitePoint).map(copyPoint)
    : [];
}

/** Manual points are persisted; otherwise derived intermediates seed first-time editing. */
export function editableEdgeWaypoints(
  edge: Pick<SceneEdge, "route" | "waypoints">,
): Point[] {
  if (edge.waypoints?.length) return edge.waypoints.filter(isFinitePoint).map(copyPoint);
  const route = derivedEdgeRoute(edge);
  return route.length > 2 ? route.slice(1, -1).map(copyPoint) : [];
}

export function nearestPointOnPolyline(
  route: readonly Point[],
  requested: Point,
): NearestPolylinePoint | undefined {
  if (!isFinitePoint(requested)) return undefined;
  let nearest: NearestPolylinePoint | undefined;
  for (let index = 0; index < route.length - 1; index += 1) {
    const start = route[index];
    const end = route[index + 1];
    if (!start || !end || !isFinitePoint(start) || !isFinitePoint(end)) continue;
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lengthSquared = dx * dx + dy * dy;
    const ratio = lengthSquared === 0
      ? 0
      : clamp(
          ((requested.x - start.x) * dx + (requested.y - start.y) * dy) / lengthSquared,
          0,
          1,
        );
    const point = { x: start.x + dx * ratio, y: start.y + dy * ratio };
    const distanceSquared = (requested.x - point.x) ** 2 + (requested.y - point.y) ** 2;
    if (
      !nearest
      || distanceSquared < nearest.distanceSquared
      || (distanceSquared === nearest.distanceSquared && index < nearest.segmentIndex)
    ) nearest = { point, segmentIndex: index, distanceSquared };
  }
  return nearest;
}

/** Inserts on the nearest rendered segment and seeds generated intermediates first. */
export function insertEdgeWaypoint(
  edge: Pick<SceneEdge, "route" | "waypoints">,
  requested: Point,
): Point[] {
  const route = derivedEdgeRoute(edge);
  const nearest = nearestPointOnPolyline(route, requested);
  if (!nearest) return editableEdgeWaypoints(edge);
  const waypoints = editableEdgeWaypoints(edge);
  waypoints.splice(clamp(nearest.segmentIndex, 0, waypoints.length), 0, nearest.point);
  return waypoints;
}

/** Adds an inspector-created point to the longest rendered segment. */
export function appendEdgeWaypoint(
  edge: Pick<SceneEdge, "route" | "waypoints">,
): Point[] {
  const route = derivedEdgeRoute(edge);
  let candidate: { point: Point; lengthSquared: number } | undefined;
  for (let index = 0; index < route.length - 1; index += 1) {
    const start = route[index];
    const end = route[index + 1];
    if (!start || !end) continue;
    const lengthSquared = (end.x - start.x) ** 2 + (end.y - start.y) ** 2;
    if (!candidate || lengthSquared > candidate.lengthSquared) {
      candidate = {
        point: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 },
        lengthSquared,
      };
    }
  }
  return candidate ? insertEdgeWaypoint(edge, candidate.point) : editableEdgeWaypoints(edge);
}

export function removeEdgeWaypoint(
  waypoints: readonly Point[] | undefined,
  index: number,
): Point[] | undefined {
  if (!waypoints?.length || index < 0 || index >= waypoints.length) return normalizeWaypoints(waypoints);
  const result = waypoints.map(copyPoint);
  result.splice(index, 1);
  return result.length ? result : undefined;
}

export function moveEdgeWaypoint(
  waypoints: readonly Point[],
  index: number,
  delta: Point,
  bounds?: { width: number; height: number; padding?: number },
): Point[] {
  const result = waypoints.map(copyPoint);
  const point = result[index];
  if (!point || !isFinitePoint(delta)) return result;
  const padding = bounds?.padding ?? 0;
  point.x = bounds
    ? clamp(point.x + delta.x, padding, Math.max(padding, bounds.width - padding))
    : point.x + delta.x;
  point.y = bounds
    ? clamp(point.y + delta.y, padding, Math.max(padding, bounds.height - padding))
    : point.y + delta.y;
  return result;
}

export function pointAtPolylineFraction(
  route: readonly Point[],
  fraction: number,
): Point {
  const points = route.filter(isFinitePoint);
  if (points.length === 0) return { x: 0, y: 0 };
  if (points.length === 1) return copyPoint(points[0]!);
  const lengths = points.slice(0, -1).map((point, index) => distance(point, points[index + 1]!));
  const total = lengths.reduce((sum, length) => sum + length, 0);
  if (total === 0) return copyPoint(points[0]!);
  let remaining = total * clamp(fraction, 0, 1);
  for (let index = 0; index < lengths.length; index += 1) {
    const length = lengths[index]!;
    if (remaining <= length || index === lengths.length - 1) {
      const start = points[index]!;
      const end = points[index + 1]!;
      const ratio = length === 0 ? 0 : remaining / length;
      return {
        x: start.x + (end.x - start.x) * ratio,
        y: start.y + (end.y - start.y) * ratio,
      };
    }
    remaining -= length;
  }
  return copyPoint(points.at(-1)!);
}

export function edgeLabelBase(edge: Pick<SceneEdge, "route">): Point {
  return pointAtPolylineFraction(derivedEdgeRoute(edge), .5);
}

export function edgeLabelPosition(
  edge: Pick<SceneEdge, "route" | "labelOffset">,
): Point {
  const base = edgeLabelBase(edge);
  return {
    x: base.x + (edge.labelOffset?.x ?? 0),
    y: base.y + (edge.labelOffset?.y ?? 0),
  };
}

export function normalizeEditableRouting(
  routing: EditableEdgeRouting | undefined,
): EditableEdgeRouting | undefined {
  if (!routing) return undefined;
  const waypoints = normalizeWaypoints(routing.waypoints);
  const labelOffset = routing.labelOffset && isFinitePoint(routing.labelOffset)
    && (routing.labelOffset.x !== 0 || routing.labelOffset.y !== 0)
    ? copyPoint(routing.labelOffset)
    : undefined;
  const sourceAnchor = isValidEdgeEndpointAnchor(routing.sourceAnchor)
    ? { ...routing.sourceAnchor }
    : undefined;
  const targetAnchor = isValidEdgeEndpointAnchor(routing.targetAnchor)
    ? { ...routing.targetAnchor }
    : undefined;
  const sourceMarker = isEdgeTerminalMarker(routing.sourceMarker) ? routing.sourceMarker : undefined;
  const targetMarker = isEdgeTerminalMarker(routing.targetMarker) ? routing.targetMarker : undefined;
  if (!waypoints && !labelOffset && !sourceAnchor && !targetAnchor && !sourceMarker && !targetMarker) return undefined;
  return {
    ...(waypoints ? { waypoints } : {}),
    ...(labelOffset ? { labelOffset } : {}),
    ...(sourceAnchor ? { sourceAnchor } : {}),
    ...(targetAnchor ? { targetAnchor } : {}),
    ...(sourceMarker ? { sourceMarker } : {}),
    ...(targetMarker ? { targetMarker } : {}),
  };
}

function isEdgeTerminalMarker(value: unknown): value is EdgeTerminalMarker {
  return typeof value === "string"
    && ["none", "arrow", "open-arrow", "triangle", "diamond", "circle"].includes(value);
}

export function routingWithWaypoints(
  edge: Pick<SceneEdge, "labelOffset" | "sourceAnchor" | "targetAnchor">,
  waypoints: readonly Point[] | undefined,
): EditableEdgeRouting | undefined {
  return normalizeEditableRouting({
    waypoints: waypoints?.map(copyPoint),
    labelOffset: edge.labelOffset ? copyPoint(edge.labelOffset) : undefined,
    sourceAnchor: edge.sourceAnchor ? { ...edge.sourceAnchor } : undefined,
    targetAnchor: edge.targetAnchor ? { ...edge.targetAnchor } : undefined,
  });
}

export function routingWithLabelOffset(
  edge: Pick<SceneEdge, "waypoints" | "sourceAnchor" | "targetAnchor">,
  labelOffset: Point | undefined,
): EditableEdgeRouting | undefined {
  return normalizeEditableRouting({
    waypoints: edge.waypoints?.map(copyPoint),
    labelOffset: labelOffset ? copyPoint(labelOffset) : undefined,
    sourceAnchor: edge.sourceAnchor ? { ...edge.sourceAnchor } : undefined,
    targetAnchor: edge.targetAnchor ? { ...edge.targetAnchor } : undefined,
  });
}

export function routingWithEndpointAnchor(
  edge: Pick<SceneEdge, "waypoints" | "labelOffset" | "sourceAnchor" | "targetAnchor">,
  endpoint: "source" | "target",
  anchor: EdgeEndpointAnchor | undefined,
): EditableEdgeRouting | undefined {
  return normalizeEditableRouting({
    waypoints: edge.waypoints?.map(copyPoint),
    labelOffset: edge.labelOffset ? copyPoint(edge.labelOffset) : undefined,
    sourceAnchor: endpoint === "source" ? anchor : edge.sourceAnchor,
    targetAnchor: endpoint === "target" ? anchor : edge.targetAnchor,
  });
}

function normalizeWaypoints(waypoints: readonly Point[] | undefined): Point[] | undefined {
  const result = waypoints?.filter(isFinitePoint).map(copyPoint);
  return result?.length ? result : undefined;
}

function followRouteEndpoint(
  route: Point[],
  originalRoute: readonly Point[],
  endpointIndex: number,
  delta: Point,
): void {
  if (isZeroPoint(delta)) return;
  const endpoint = route[endpointIndex];
  const neighborIndex = endpointIndex === 0 ? 1 : endpointIndex - 1;
  const neighbor = route[neighborIndex];
  const originalEndpoint = originalRoute[endpointIndex];
  const originalNeighbor = originalRoute[neighborIndex];
  if (!endpoint || !neighbor || !originalEndpoint || !originalNeighbor) return;
  route[endpointIndex] = translatePoint(originalEndpoint, delta);
  if (route.length <= 2) return;
  if (originalEndpoint.x === originalNeighbor.x) neighbor.x += delta.x;
  if (originalEndpoint.y === originalNeighbor.y) neighbor.y += delta.y;
}

function geometryCenterDelta(original: ElementGeometry, preview: ElementGeometry): Point {
  return {
    x: preview.x + preview.width / 2 - original.x - original.width / 2,
    y: preview.y + preview.height / 2 - original.y - original.height / 2,
  };
}

function translatePoint(point: Point, delta: Point): Point {
  return { x: point.x + delta.x, y: point.y + delta.y };
}

function samePoint(left: Point, right: Point): boolean {
  return left.x === right.x && left.y === right.y;
}

function isZeroPoint(point: Point): boolean {
  return point.x === 0 && point.y === 0;
}

function isFinitePoint(point: Point): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function copyPoint(point: Point): Point {
  return { x: point.x, y: point.y };
}

function distance(left: Point, right: Point): number {
  return Math.hypot(right.x - left.x, right.y - left.y);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(value, maximum));
}
