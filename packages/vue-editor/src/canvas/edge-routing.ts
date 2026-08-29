import {
  isValidEdgeEndpointAnchor,
  type EdgeCurveRouting,
  type EdgeEndpointAnchor,
  type EdgeTerminalMarker,
  type ElementGeometry,
  type Point,
  type SceneDerivedRouteChoice,
  type SceneEdge,
} from "@iriograph/core";

export type EditableEdgeRouting = {
  waypoints?: Point[];
  curve?: EdgeCurveRouting;
  labelOffset?: Point;
  sourceAnchor?: EdgeEndpointAnchor;
  targetAnchor?: EdgeEndpointAnchor;
  sourcePortId?: string;
  targetPortId?: string;
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

export type CubicBezierSegment = {
  start: Point;
  control1: Point;
  control2: Point;
  end: Point;
};

export type EdgeCurveControlHandle = {
  key: string;
  kind: "source" | "target" | "knot-in" | "knot-out";
  knotIndex?: number;
  anchor: Point;
  point: Point;
  manual: boolean;
};

export type RenderedEdgeRouteFamily = SceneDerivedRouteChoice["family"];

/**
 * Resolves one renderer family without leaking the layout choice into the
 * portable overlay. An explicit presentation mode always wins; `auto` is the
 * only mode that consumes the Scene's transient layout decision.
 */
export function renderedEdgeRouteFamily(
  edge: Pick<SceneEdge, "derivedRouteChoice" | "routeMode" | "waypoints">,
  requestedMode: NonNullable<SceneEdge["routeMode"]> = edge.routeMode
    ?? (edge.waypoints?.length ? "manual" : "auto"),
): RenderedEdgeRouteFamily {
  if (requestedMode !== "auto") return requestedMode;
  return edge.derivedRouteChoice?.source === "auto"
    ? edge.derivedRouteChoice.family
    : "polyline";
}

/**
 * Converts layout-owned absolute Bezier controls into the same sparse,
 * endpoint-relative representation used by the renderer. The vectors keep
 * following their endpoint while a node is preview-moved, but are never
 * persisted as user-authored curve controls.
 */
export function derivedSceneCurveRouting(
  edge: Pick<SceneEdge, "derivedRouteChoice" | "route">,
): EdgeCurveRouting | undefined {
  const choice = edge.derivedRouteChoice;
  const route = derivedEdgeRoute(edge);
  const start = route[0];
  const end = route.at(-1);
  if (
    choice?.source !== "auto"
    || choice.family !== "curve"
    || !choice.curve
    || !start
    || !end
  ) return undefined;
  return {
    sourceHandle: subtractPoint(choice.curve.sourceControl, start),
    targetHandle: subtractPoint(choice.curve.targetControl, end),
  };
}

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

/** Builds one continuous cubic path through every sparse on-curve knot. */
export function edgeCurveSegments(
  route: readonly Point[],
  curve: EdgeCurveRouting | undefined,
): CubicBezierSegment[] {
  const points = route.filter(isFinitePoint);
  const start = points[0];
  const end = points.at(-1);
  if (!start || !end || points.length < 2) return [];
  const normalized = normalizeEdgeCurveRouting(curve);
  const knots = normalized?.knots ?? [];
  const anchors = [copyPoint(start), ...knots.map((knot) => copyPoint(knot.point)), copyPoint(end)];
  const directControls = anchors.length === 2
    ? automaticDirectControls(start, end, points)
    : undefined;
  const segments: CubicBezierSegment[] = [];

  for (let index = 0; index < anchors.length - 1; index += 1) {
    const segmentStart = anchors[index]!;
    const segmentEnd = anchors[index + 1]!;
    const automatic = directControls ?? automaticKnotControls(anchors, index);
    const outgoing = index === 0
      ? normalized?.sourceHandle
      : knots[index - 1]?.outgoingHandle;
    const incoming = index + 1 === anchors.length - 1
      ? normalized?.targetHandle
      : knots[index]?.incomingHandle;
    segments.push({
      start: copyPoint(segmentStart),
      control1: outgoing ? addPoint(segmentStart, outgoing) : automatic.control1,
      control2: incoming ? addPoint(segmentEnd, incoming) : automatic.control2,
      end: copyPoint(segmentEnd),
    });
  }
  return segments;
}

export function cubicCurvePath(
  route: readonly Point[],
  curve: EdgeCurveRouting | undefined,
): string {
  const segments = edgeCurveSegments(route, curve);
  const first = segments[0];
  if (!first) return "";
  return [
    `M ${first.start.x} ${first.start.y}`,
    ...segments.map((segment) => (
      `C ${segment.control1.x} ${segment.control1.y}, ${segment.control2.x} ${segment.control2.y}, ${segment.end.x} ${segment.end.y}`
    )),
  ].join(" ");
}

export function pointAtCurveFraction(
  route: readonly Point[],
  curve: EdgeCurveRouting | undefined,
  fraction: number,
): Point {
  const samples = sampleCurve(edgeCurveSegments(route, curve));
  return pointAtPolylineFraction(samples.map((sample) => sample.point), fraction);
}

export function edgeCurveControlHandles(
  route: readonly Point[],
  curve: EdgeCurveRouting | undefined,
): EdgeCurveControlHandle[] {
  const segments = edgeCurveSegments(route, curve);
  if (segments.length === 0) return [];
  const normalized = normalizeEdgeCurveRouting(curve);
  const handles: EdgeCurveControlHandle[] = [{
    key: "source",
    kind: "source",
    anchor: copyPoint(segments[0]!.start),
    point: copyPoint(segments[0]!.control1),
    manual: Boolean(normalized?.sourceHandle),
  }];
  for (let index = 0; index < (normalized?.knots?.length ?? 0); index += 1) {
    const knot = normalized!.knots![index]!;
    handles.push({
      key: `knot-${index}-in`,
      kind: "knot-in",
      knotIndex: index,
      anchor: copyPoint(knot.point),
      point: copyPoint(segments[index]!.control2),
      manual: Boolean(knot.incomingHandle),
    }, {
      key: `knot-${index}-out`,
      kind: "knot-out",
      knotIndex: index,
      anchor: copyPoint(knot.point),
      point: copyPoint(segments[index + 1]!.control1),
      manual: Boolean(knot.outgoingHandle),
    });
  }
  const last = segments.at(-1)!;
  handles.push({
    key: "target",
    kind: "target",
    anchor: copyPoint(last.end),
    point: copyPoint(last.control2),
    manual: Boolean(normalized?.targetHandle),
  });
  return handles;
}

export function insertEdgeCurveKnot(
  route: readonly Point[],
  curve: EdgeCurveRouting | undefined,
  requested: Point,
): EdgeCurveRouting | undefined {
  if (!isFinitePoint(requested)) return normalizeEdgeCurveRouting(curve);
  const nearest = nearestPointOnCurve(edgeCurveSegments(route, curve), requested);
  if (!nearest) return normalizeEdgeCurveRouting(curve);
  const result = copyEdgeCurveRouting(curve) ?? {};
  const knots = result.knots ?? [];
  knots.splice(nearest.segmentIndex, 0, { point: nearest.point });
  result.knots = knots;
  return normalizeEdgeCurveRouting(result);
}

export function appendEdgeCurveKnot(
  route: readonly Point[],
  curve: EdgeCurveRouting | undefined,
): EdgeCurveRouting | undefined {
  const segments = edgeCurveSegments(route, curve);
  if (segments.length === 0) return normalizeEdgeCurveRouting(curve);
  const selectedIndex = edgeCurveKnotAppendIndex(route, curve);
  const point = cubicPoint(segments[selectedIndex]!, .5);
  const result = copyEdgeCurveRouting(curve) ?? {};
  const knots = result.knots ?? [];
  knots.splice(selectedIndex, 0, { point });
  result.knots = knots;
  return normalizeEdgeCurveRouting(result);
}

/** Index used by append so keyboard focus follows the newly inserted knot. */
export function edgeCurveKnotAppendIndex(
  route: readonly Point[],
  curve: EdgeCurveRouting | undefined,
): number {
  const segments = edgeCurveSegments(route, curve);
  if (segments.length === 0) return 0;
  let selectedIndex = 0;
  let selectedLength = -1;
  for (const [index, segment] of segments.entries()) {
    const length = approximateSegmentLength(segment);
    if (length > selectedLength) {
      selectedIndex = index;
      selectedLength = length;
    }
  }
  return selectedIndex;
}

export function removeEdgeCurveKnot(
  curve: EdgeCurveRouting | undefined,
  index: number,
): EdgeCurveRouting | undefined {
  const result = copyEdgeCurveRouting(curve);
  if (!result?.knots || index < 0 || index >= result.knots.length) return result;
  result.knots.splice(index, 1);
  if (result.knots.length === 0) delete result.knots;
  return normalizeEdgeCurveRouting(result);
}

export function moveEdgeCurveKnot(
  curve: EdgeCurveRouting | undefined,
  index: number,
  delta: Point,
  bounds?: { width: number; height: number; padding?: number },
): EdgeCurveRouting | undefined {
  const result = copyEdgeCurveRouting(curve);
  const knot = result?.knots?.[index];
  if (!result || !knot || !isFinitePoint(delta)) return result;
  const padding = bounds?.padding ?? 0;
  knot.point.x = bounds
    ? clamp(knot.point.x + delta.x, padding, Math.max(padding, bounds.width - padding))
    : knot.point.x + delta.x;
  knot.point.y = bounds
    ? clamp(knot.point.y + delta.y, padding, Math.max(padding, bounds.height - padding))
    : knot.point.y + delta.y;
  return normalizeEdgeCurveRouting(result);
}

export function updateEdgeCurveHandle(
  route: readonly Point[],
  curve: EdgeCurveRouting | undefined,
  handle: Pick<EdgeCurveControlHandle, "kind" | "knotIndex">,
  requested: Point,
): EdgeCurveRouting | undefined {
  if (!isFinitePoint(requested)) return normalizeEdgeCurveRouting(curve);
  const result = copyEdgeCurveRouting(curve) ?? {};
  const endpoints = route.filter(isFinitePoint);
  if (handle.kind === "source") {
    const anchor = endpoints[0];
    if (!anchor) return normalizeEdgeCurveRouting(curve);
    result.sourceHandle = replacementCurvePoint(
      subtractPoint(requested, anchor),
      result.sourceHandle,
    );
  } else if (handle.kind === "target") {
    const anchor = endpoints.at(-1);
    if (!anchor) return normalizeEdgeCurveRouting(curve);
    result.targetHandle = replacementCurvePoint(
      subtractPoint(requested, anchor),
      result.targetHandle,
    );
  } else {
    const knot = result.knots?.[handle.knotIndex ?? -1];
    if (!knot) return normalizeEdgeCurveRouting(curve);
    const value = subtractPoint(requested, knot.point);
    if (handle.kind === "knot-in") {
      knot.incomingHandle = replacementCurvePoint(value, knot.incomingHandle);
      knot.outgoingHandle = replacementCurvePoint(negatePoint(value), knot.outgoingHandle);
    } else {
      knot.outgoingHandle = replacementCurvePoint(value, knot.outgoingHandle);
      knot.incomingHandle = replacementCurvePoint(negatePoint(value), knot.incomingHandle);
    }
  }
  return normalizeEdgeCurveRouting(result);
}

export function removeEdgeCurveHandle(
  curve: EdgeCurveRouting | undefined,
  handle: Pick<EdgeCurveControlHandle, "kind" | "knotIndex">,
): EdgeCurveRouting | undefined {
  const result = copyEdgeCurveRouting(curve);
  if (!result) return undefined;
  if (handle.kind === "source") delete result.sourceHandle;
  else if (handle.kind === "target") delete result.targetHandle;
  else {
    const knot = result.knots?.[handle.knotIndex ?? -1];
    if (!knot) return result;
    // Knot handles form one tangent. Resetting either side restores the
    // automatic smooth tangent instead of leaving a half-manual knot.
    delete knot.incomingHandle;
    delete knot.outgoingHandle;
  }
  return normalizeEdgeCurveRouting(result);
}

export function normalizeEdgeCurveRouting(
  curve: EdgeCurveRouting | undefined,
): EdgeCurveRouting | undefined {
  if (!curve || typeof curve !== "object") return undefined;
  if (curve.sourceHandle !== undefined && !isFinitePoint(curve.sourceHandle)) return undefined;
  if (curve.targetHandle !== undefined && !isFinitePoint(curve.targetHandle)) return undefined;
  if (curve.knots !== undefined && (!Array.isArray(curve.knots) || curve.knots.length > 64)) {
    return undefined;
  }
  const knots = curve.knots?.map((knot) => {
    if (
      !knot
      || !isFinitePoint(knot.point)
      || knot.incomingHandle !== undefined && !isFinitePoint(knot.incomingHandle)
      || knot.outgoingHandle !== undefined && !isFinitePoint(knot.outgoingHandle)
    ) return undefined;
    return {
      point: copyCurvePoint(knot.point),
      ...(knot.incomingHandle ? { incomingHandle: copyCurvePoint(knot.incomingHandle) } : {}),
      ...(knot.outgoingHandle ? { outgoingHandle: copyCurvePoint(knot.outgoingHandle) } : {}),
      ...(knot.extensions ? { extensions: cloneJson(knot.extensions) } : {}),
    };
  });
  if (knots?.some((knot) => knot === undefined)) return undefined;
  const result: EdgeCurveRouting = {
    ...(curve.sourceHandle ? { sourceHandle: copyCurvePoint(curve.sourceHandle) } : {}),
    ...(curve.targetHandle ? { targetHandle: copyCurvePoint(curve.targetHandle) } : {}),
    ...(knots?.length ? { knots: knots as NonNullable<EdgeCurveRouting["knots"]> } : {}),
    ...(curve.extensions ? { extensions: cloneJson(curve.extensions) } : {}),
  };
  return Object.keys(result).length > 0 ? result : undefined;
}

export function copyEdgeCurveRouting(
  curve: EdgeCurveRouting | undefined,
): EdgeCurveRouting | undefined {
  return normalizeEdgeCurveRouting(curve);
}

export function normalizeEditableRouting(
  routing: EditableEdgeRouting | undefined,
): EditableEdgeRouting | undefined {
  if (!routing) return undefined;
  const waypoints = normalizeWaypoints(routing.waypoints);
  const curve = normalizeEdgeCurveRouting(routing.curve);
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
  const sourcePortId = typeof routing.sourcePortId === "string" && routing.sourcePortId.trim()
    ? routing.sourcePortId.trim()
    : undefined;
  const targetPortId = typeof routing.targetPortId === "string" && routing.targetPortId.trim()
    ? routing.targetPortId.trim()
    : undefined;
  const sourceMarker = isEdgeTerminalMarker(routing.sourceMarker) ? routing.sourceMarker : undefined;
  const targetMarker = isEdgeTerminalMarker(routing.targetMarker) ? routing.targetMarker : undefined;
  if (!waypoints && !curve && !labelOffset && !sourceAnchor && !targetAnchor && !sourcePortId && !targetPortId && !sourceMarker && !targetMarker) return undefined;
  return {
    ...(waypoints ? { waypoints } : {}),
    ...(curve ? { curve } : {}),
    ...(labelOffset ? { labelOffset } : {}),
    ...(sourceAnchor ? { sourceAnchor } : {}),
    ...(targetAnchor ? { targetAnchor } : {}),
    ...(sourcePortId ? { sourcePortId } : {}),
    ...(targetPortId ? { targetPortId } : {}),
    ...(sourceMarker ? { sourceMarker } : {}),
    ...(targetMarker ? { targetMarker } : {}),
  };
}

function isEdgeTerminalMarker(value: unknown): value is EdgeTerminalMarker {
  return typeof value === "string"
    && ["none", "arrow", "open-arrow", "triangle", "diamond", "circle"].includes(value);
}

export function routingWithWaypoints(
  edge: Pick<SceneEdge, "curve" | "labelOffset" | "sourceAnchor" | "targetAnchor">,
  waypoints: readonly Point[] | undefined,
): EditableEdgeRouting | undefined {
  return normalizeEditableRouting({
    waypoints: waypoints?.map(copyPoint),
    curve: copyEdgeCurveRouting(edge.curve),
    labelOffset: edge.labelOffset ? copyPoint(edge.labelOffset) : undefined,
    sourceAnchor: edge.sourceAnchor ? { ...edge.sourceAnchor } : undefined,
    targetAnchor: edge.targetAnchor ? { ...edge.targetAnchor } : undefined,
  });
}

export function routingWithLabelOffset(
  edge: Pick<SceneEdge, "waypoints" | "curve" | "sourceAnchor" | "targetAnchor">,
  labelOffset: Point | undefined,
): EditableEdgeRouting | undefined {
  return normalizeEditableRouting({
    waypoints: edge.waypoints?.map(copyPoint),
    curve: copyEdgeCurveRouting(edge.curve),
    labelOffset: labelOffset ? copyPoint(labelOffset) : undefined,
    sourceAnchor: edge.sourceAnchor ? { ...edge.sourceAnchor } : undefined,
    targetAnchor: edge.targetAnchor ? { ...edge.targetAnchor } : undefined,
  });
}

export function routingWithEndpointAnchor(
  edge: Pick<SceneEdge, "waypoints" | "curve" | "labelOffset" | "sourceAnchor" | "targetAnchor">,
  endpoint: "source" | "target",
  anchor: EdgeEndpointAnchor | undefined,
): EditableEdgeRouting | undefined {
  return normalizeEditableRouting({
    waypoints: edge.waypoints?.map(copyPoint),
    curve: copyEdgeCurveRouting(edge.curve),
    labelOffset: edge.labelOffset ? copyPoint(edge.labelOffset) : undefined,
    sourceAnchor: endpoint === "source" ? anchor : edge.sourceAnchor,
    targetAnchor: endpoint === "target" ? anchor : edge.targetAnchor,
  });
}

export function routingWithCurve(
  edge: Pick<SceneEdge, "labelOffset" | "sourceAnchor" | "targetAnchor">,
  curve: EdgeCurveRouting | undefined,
): EditableEdgeRouting | undefined {
  return normalizeEditableRouting({
    curve: copyEdgeCurveRouting(curve),
    labelOffset: edge.labelOffset ? copyPoint(edge.labelOffset) : undefined,
    sourceAnchor: edge.sourceAnchor ? { ...edge.sourceAnchor } : undefined,
    targetAnchor: edge.targetAnchor ? { ...edge.targetAnchor } : undefined,
  });
}

function automaticDirectControls(
  start: Point,
  end: Point,
  guideRoute: readonly Point[],
): Pick<CubicBezierSegment, "control1" | "control2"> {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length < 0.001) {
    return {
      control1: { x: start.x + 36, y: start.y - 48 },
      control2: { x: start.x + 64, y: start.y + 48 },
    };
  }
  const normal = { x: -dy / length, y: dx / length };
  let signedDeviation = 0;
  for (const point of guideRoute.slice(1, -1)) {
    const ratio = ((point.x - start.x) * dx + (point.y - start.y) * dy) / (length * length);
    const projection = { x: start.x + dx * ratio, y: start.y + dy * ratio };
    const deviation = (point.x - projection.x) * normal.x + (point.y - projection.y) * normal.y;
    if (Math.abs(deviation) > Math.abs(signedDeviation)) signedDeviation = deviation;
  }
  const bow = Math.abs(signedDeviation) > 1
    ? signedDeviation / .75
    : clamp(length * .18, 24, 80);
  return {
    control1: {
      x: start.x + dx / 3 + normal.x * bow,
      y: start.y + dy / 3 + normal.y * bow,
    },
    control2: {
      x: start.x + dx * 2 / 3 + normal.x * bow,
      y: start.y + dy * 2 / 3 + normal.y * bow,
    },
  };
}

function automaticKnotControls(
  anchors: readonly Point[],
  index: number,
): Pick<CubicBezierSegment, "control1" | "control2"> {
  const start = anchors[index]!;
  const end = anchors[index + 1]!;
  const previous = anchors[index - 1] ?? start;
  const next = anchors[index + 2] ?? end;
  return {
    control1: {
      x: start.x + (end.x - previous.x) / 6,
      y: start.y + (end.y - previous.y) / 6,
    },
    control2: {
      x: end.x - (next.x - start.x) / 6,
      y: end.y - (next.y - start.y) / 6,
    },
  };
}

function nearestPointOnCurve(
  segments: readonly CubicBezierSegment[],
  requested: Point,
): { point: Point; segmentIndex: number; distanceSquared: number } | undefined {
  let nearest: { point: Point; segmentIndex: number; distanceSquared: number } | undefined;
  for (const [segmentIndex, segment] of segments.entries()) {
    let previous = segment.start;
    for (let step = 1; step <= 32; step += 1) {
      const current = cubicPoint(segment, step / 32);
      const projected = nearestPointOnLine(previous, current, requested);
      const distanceSquared = squaredDistance(projected, requested);
      if (!nearest || distanceSquared < nearest.distanceSquared) {
        nearest = { point: projected, segmentIndex, distanceSquared };
      }
      previous = current;
    }
  }
  return nearest;
}

function sampleCurve(
  segments: readonly CubicBezierSegment[],
): Array<{ point: Point; segmentIndex: number }> {
  const samples: Array<{ point: Point; segmentIndex: number }> = [];
  for (const [segmentIndex, segment] of segments.entries()) {
    if (segmentIndex === 0) samples.push({ point: copyPoint(segment.start), segmentIndex });
    for (let step = 1; step <= 24; step += 1) {
      samples.push({ point: cubicPoint(segment, step / 24), segmentIndex });
    }
  }
  return samples;
}

function approximateSegmentLength(segment: CubicBezierSegment): number {
  let length = 0;
  let previous = segment.start;
  for (let step = 1; step <= 24; step += 1) {
    const point = cubicPoint(segment, step / 24);
    length += distance(previous, point);
    previous = point;
  }
  return length;
}

function cubicPoint(segment: CubicBezierSegment, ratio: number): Point {
  const t = clamp(ratio, 0, 1);
  const inverse = 1 - t;
  return {
    x: inverse ** 3 * segment.start.x
      + 3 * inverse ** 2 * t * segment.control1.x
      + 3 * inverse * t ** 2 * segment.control2.x
      + t ** 3 * segment.end.x,
    y: inverse ** 3 * segment.start.y
      + 3 * inverse ** 2 * t * segment.control1.y
      + 3 * inverse * t ** 2 * segment.control2.y
      + t ** 3 * segment.end.y,
  };
}

function nearestPointOnLine(start: Point, end: Point, requested: Point): Point {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  const ratio = lengthSquared === 0
    ? 0
    : clamp(((requested.x - start.x) * dx + (requested.y - start.y) * dy) / lengthSquared, 0, 1);
  return { x: start.x + dx * ratio, y: start.y + dy * ratio };
}

function squaredDistance(left: Point, right: Point): number {
  return (right.x - left.x) ** 2 + (right.y - left.y) ** 2;
}

function addPoint(origin: Point, vector: Point): Point {
  return { x: origin.x + vector.x, y: origin.y + vector.y };
}

function subtractPoint(point: Point, origin: Point): Point {
  return { x: point.x - origin.x, y: point.y - origin.y };
}

function negatePoint(point: Point): Point {
  return { x: -point.x, y: -point.y };
}

function copyCurvePoint(point: Point): Point {
  return {
    x: point.x,
    y: point.y,
    ...(point.extensions ? { extensions: cloneJson(point.extensions) } : {}),
  };
}

function replacementCurvePoint(point: Point, previous: Point | undefined): Point {
  return {
    ...point,
    ...(previous?.extensions ? { extensions: cloneJson(previous.extensions) } : {}),
  };
}

function cloneJson<T>(value: T): T {
  // Vue may expose overlay data through reactive Proxy objects, which the
  // platform structuredClone API rejects. Extensions are schema-validated
  // JSON values, so a JSON round-trip is the portable deep-copy boundary.
  return JSON.parse(JSON.stringify(value)) as T;
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

function isFinitePoint(point: unknown): point is Point {
  if (!point || typeof point !== "object") return false;
  const candidate = point as Partial<Point>;
  return Number.isFinite(candidate.x) && Number.isFinite(candidate.y);
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
