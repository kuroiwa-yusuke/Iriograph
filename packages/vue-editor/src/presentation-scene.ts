import {
  edgeEndpointAnchorFromPoint,
  edgeEndpointAnchorPoint,
  type DiagramScene,
  type EdgeCurveRouting,
  type EdgeEndpointAnchor,
  type EdgeEndpointShape,
  type ElementGeometry,
  type Point,
  type ProjectedEdge,
  type ProjectedScene,
  type SceneContainer,
  type SceneAnnotation,
  type SceneEdge,
  type SceneNode,
  type SceneRegion,
} from "@iriograph/core";

import { previewEdgeRoute } from "./edge-routing";

type GeometrySceneElement = SceneNode | SceneContainer | SceneRegion;

/**
 * Applies a projection-only presentation update without invoking a layout
 * adapter. Existing generated geometry is stable; explicit overlay geometry
 * replaces only its own element and only incident routes are recalculated.
 */
export function reconcilePresentationScene(
  current: DiagramScene,
  projected: ProjectedScene,
): DiagramScene {
  const currentElements = geometryElementMap(current);
  const nodes = projected.nodes.map((node): SceneNode => {
    const previous = currentElements.get(node.elementId);
    return {
      ...node,
      geometry: copyGeometry(node.geometry ?? previous?.geometry ?? defaultGeometry(node.defaultSize)),
      nodeLabelOffset: copyPoint(node.nodeLabelOffset),
      nodeLabelWritingDirection: node.nodeLabelWritingDirection,
      nodeIconOffset: copyPoint(node.nodeIconOffset),
      iconUrl: previous?.structuralKind === "node" && previous.iconRef === node.iconRef
        ? previous.iconUrl
        : node.iconUrl,
      provenance: previous?.provenance ?? node.provenance,
    };
  });
  const containers = projected.containers.map((container): SceneContainer => {
    const previous = currentElements.get(container.elementId);
    return {
      ...container,
      geometry: copyGeometry(container.geometry ?? previous?.geometry ?? defaultGeometry(container.defaultSize)),
      groupIconOffset: copyPoint(container.groupIconOffset),
      iconUrl: previous?.structuralKind === "container" && previous.iconRef === container.iconRef
        ? previous.iconUrl
        : container.iconUrl,
      iconIntrinsicSize: previous?.structuralKind === "container" && previous.iconRef === container.iconRef
        ? previous.iconIntrinsicSize
        : container.iconIntrinsicSize,
      provenance: previous?.provenance ?? container.provenance,
    };
  });
  const regions = (projected.regions ?? []).map((region): SceneRegion => {
    const previous = currentElements.get(region.elementId);
    return {
      ...region,
      geometry: copyGeometry(region.geometry ?? previous?.geometry ?? defaultGeometry(region.defaultSize)),
      groupIconOffset: copyPoint(region.groupIconOffset),
      iconUrl: previous?.structuralKind === "region" && previous.iconRef === region.iconRef
        ? previous.iconUrl
        : region.iconUrl,
      iconIntrinsicSize: previous?.structuralKind === "region" && previous.iconRef === region.iconRef
        ? previous.iconIntrinsicSize
        : region.iconIntrinsicSize,
      provenance: previous?.provenance ?? region.provenance,
    };
  });
  const nextElements = new Map<string, GeometrySceneElement>([
    ...nodes.map((element) => [element.elementId, element] as const),
    ...containers.map((element) => [element.elementId, element] as const),
    ...regions.map((element) => [element.elementId, element] as const),
  ]);
  const currentEdges = new Map(current.edges.map((edge) => [edge.elementId, edge]));
  const edges = projected.edges.map((edge) => reconcileEdge(
    edge,
    currentEdges.get(edge.elementId),
    currentElements,
    nextElements,
  ));
  const currentAnnotations = new Map((current.annotations ?? []).map((annotation) => [annotation.elementId, annotation]));
  const annotations: SceneAnnotation[] = (projected.annotations ?? []).map((annotation) => {
    const previous = currentAnnotations.get(annotation.elementId);
    return {
      ...annotation,
      geometry: copyGeometry(annotation.geometry ?? previous?.geometry ?? defaultGeometry(annotation.defaultSize)),
      anchorOffset: copyPoint(annotation.anchorOffset),
      style: structuredClone(annotation.style),
      provenance: structuredClone(annotation.provenance),
    };
  });
  const dimensions = presentationDimensions(current, [...nextElements.values(), ...annotations], edges);
  return {
    viewId: projected.viewId,
    width: dimensions.width,
    height: dimensions.height,
    nodes,
    containers,
    regions,
    memberships: (projected.memberships ?? []).map((membership) => ({
      ...membership,
      provenance: { ...membership.provenance },
    })),
    groupGuides: (projected.groupGuides ?? []).map((guide) => structuredClone(guide)),
    annotations,
    edges,
    // Presentation-only reconciliation deliberately does not run the layout
    // adapter. Carry semantic/projection diagnostics forward, but drop layout
    // results from the previous Scene instead of making an anchor/style edit
    // appear to have generated a new whole-diagram placement warning.
    diagnostics: uniqueDiagnostics([
      ...current.diagnostics.filter((diagnostic) => diagnostic.category !== "layout"),
      ...projected.diagnostics,
    ]),
  };
}

function uniqueDiagnostics<T>(values: readonly T[]): T[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = JSON.stringify(value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function reconcileEdge(
  projected: ProjectedEdge,
  current: SceneEdge | undefined,
  currentElements: ReadonlyMap<string, GeometrySceneElement>,
  nextElements: ReadonlyMap<string, GeometrySceneElement>,
): SceneEdge {
  const next: SceneEdge = {
    elementId: projected.elementId,
    semanticRef: projected.semanticRef,
    structuralKind: "edge",
    label: projected.label,
    caption: projected.caption,
    semanticText: projected.semanticText,
    labelProvenance: projected.labelProvenance,
    sourceElementId: projected.sourceElementId,
    targetElementId: projected.targetElementId,
    templateRef: projected.templateRef,
    style: projected.style,
    waypoints: copyPoints(projected.waypoints),
    curve: copyCurve(projected.curve),
    labelOffset: copyPoint(projected.labelOffset),
    sourceAnchor: copyAnchor(projected.sourceAnchor),
    targetAnchor: copyAnchor(projected.targetAnchor),
    sourcePortId: projected.sourcePortId,
    targetPortId: projected.targetPortId,
    routeMode: projected.routeMode,
    sourceMarker: projected.sourceMarker,
    targetMarker: projected.targetMarker,
    fallback: projected.fallback,
    provenance: current?.provenance ?? projected.provenance,
  };
  const source = nextElements.get(next.sourceElementId);
  const target = nextElements.get(next.targetElementId);
  if (!source || !target) return next;
  const previousSource = currentElements.get(next.sourceElementId) ?? source;
  const previousTarget = currentElements.get(next.targetElementId) ?? target;
  const geometryChanged = !sameGeometry(previousSource.geometry, source.geometry)
    || !sameGeometry(previousTarget.geometry, target.geometry);
  const endpointChanged = Boolean(current && (
    current.sourceElementId !== next.sourceElementId
    || current.targetElementId !== next.targetElementId
  ));
  const routingChanged = !current || endpointChanged || !sameRouting(current, next);
  let route = current?.route?.map(copyRequiredPoint) ?? [];
  if (current && geometryChanged) {
    route = previewEdgeRoute(
      current,
      { original: previousSource.geometry, preview: source.geometry },
      { original: previousTarget.geometry, preview: target.geometry },
    );
  }
  if (routingChanged) {
    if (next.waypoints?.length) {
      route = [
        automaticEndpoint(source, next.sourceAnchor, next.waypoints[0]!),
        ...next.waypoints.map(copyRequiredPoint),
        automaticEndpoint(target, next.targetAnchor, next.waypoints.at(-1)!),
      ];
    } else if (
      next.sourceElementId === next.targetElementId
      && current?.route
      && current.route.length > 2
    ) {
      route = current.route.map(copyRequiredPoint);
    } else if (endpointChanged && next.routeMode === "straight") {
      route = directRoute(source, target, next.sourceAnchor, next.targetAnchor);
    } else if (endpointChanged || route.length < 2) {
      route = orthogonalRoute(source, target, next.sourceAnchor, next.targetAnchor);
    }
  }
  if (route.length < 2) route = orthogonalRoute(source, target, next.sourceAnchor, next.targetAnchor);
  next.route = refreshRouteEndpoints(
    route,
    source,
    target,
    previousSource,
    previousTarget,
    current?.route,
    next.sourceAnchor,
    next.targetAnchor,
  );
  return next;
}

function refreshRouteEndpoints(
  route: readonly Point[],
  source: GeometrySceneElement,
  target: GeometrySceneElement,
  previousSource: GeometrySceneElement,
  previousTarget: GeometrySceneElement,
  previousRoute: readonly Point[] | undefined,
  sourceAnchor: EdgeEndpointAnchor | undefined,
  targetAnchor: EdgeEndpointAnchor | undefined,
): Point[] {
  const result = route.map(copyRequiredPoint);
  const sourceToward = result[1] ?? centerOf(target.geometry);
  const targetToward = result.at(-2) ?? centerOf(source.geometry);
  result[0] = anchoredOrPreservedEndpoint(
    source,
    sourceAnchor,
    sourceToward,
    previousSource,
    previousRoute?.[0],
  );
  result[result.length - 1] = anchoredOrPreservedEndpoint(
    target,
    targetAnchor,
    targetToward,
    previousTarget,
    previousRoute?.at(-1),
  );
  return result;
}

function anchoredOrPreservedEndpoint(
  element: GeometrySceneElement,
  anchor: EdgeEndpointAnchor | undefined,
  toward: Point,
  previous: GeometrySceneElement,
  previousPoint: Point | undefined,
): Point {
  if (anchor) return edgeEndpointAnchorPoint(element.geometry, endpointShape(element), anchor);
  const resolved = previousPoint
    ? edgeEndpointAnchorFromPoint(previous.geometry, previousPoint)
    : edgeEndpointAnchorFromPoint(element.geometry, toward);
  return edgeEndpointAnchorPoint(element.geometry, endpointShape(element), resolved);
}

function directRoute(
  source: GeometrySceneElement,
  target: GeometrySceneElement,
  sourceAnchor?: EdgeEndpointAnchor,
  targetAnchor?: EdgeEndpointAnchor,
): Point[] {
  const sourceCenter = centerOf(source.geometry);
  const targetCenter = centerOf(target.geometry);
  return [
    automaticEndpoint(source, sourceAnchor, targetCenter),
    automaticEndpoint(target, targetAnchor, sourceCenter),
  ];
}

function orthogonalRoute(
  source: GeometrySceneElement,
  target: GeometrySceneElement,
  sourceAnchor?: EdgeEndpointAnchor,
  targetAnchor?: EdgeEndpointAnchor,
): Point[] {
  const [start, end] = directRoute(source, target, sourceAnchor, targetAnchor);
  if (!start || !end) return [];
  if (Math.abs(end.x - start.x) >= Math.abs(end.y - start.y)) {
    const middle = (start.x + end.x) / 2;
    return [start, { x: middle, y: start.y }, { x: middle, y: end.y }, end];
  }
  const middle = (start.y + end.y) / 2;
  return [start, { x: start.x, y: middle }, { x: end.x, y: middle }, end];
}

function automaticEndpoint(
  element: GeometrySceneElement,
  explicit: EdgeEndpointAnchor | undefined,
  toward: Point,
): Point {
  const anchor = explicit ?? edgeEndpointAnchorFromPoint(element.geometry, toward);
  return edgeEndpointAnchorPoint(element.geometry, endpointShape(element), anchor);
}

function endpointShape(element: GeometrySceneElement): EdgeEndpointShape {
  if (element.structuralKind === "container") return "container";
  if (element.structuralKind === "region") return "region";
  return element.shape;
}

function geometryElementMap(scene: DiagramScene): Map<string, GeometrySceneElement> {
  return new Map<string, GeometrySceneElement>([
    ...scene.nodes.map((element) => [element.elementId, element] as const),
    ...scene.containers.map((element) => [element.elementId, element] as const),
    ...(scene.regions ?? []).map((element) => [element.elementId, element] as const),
  ]);
}

function sameRouting(left: SceneEdge, right: SceneEdge): boolean {
  return JSON.stringify({
    waypoints: left.waypoints,
    curve: left.curve,
    sourceAnchor: left.sourceAnchor,
    targetAnchor: left.targetAnchor,
    sourcePortId: left.sourcePortId,
    targetPortId: left.targetPortId,
    routeMode: left.routeMode,
  }) === JSON.stringify({
    waypoints: right.waypoints,
    curve: right.curve,
    sourceAnchor: right.sourceAnchor,
    targetAnchor: right.targetAnchor,
    sourcePortId: right.sourcePortId,
    targetPortId: right.targetPortId,
    routeMode: right.routeMode,
  });
}

function presentationDimensions(
  current: DiagramScene,
  elements: readonly { geometry: ElementGeometry }[],
  edges: readonly SceneEdge[],
): { width: number; height: number } {
  const points = edges.flatMap((edge) => edge.route ?? []);
  const right = Math.max(0, ...elements.map((element) => element.geometry.x + element.geometry.width), ...points.map((point) => point.x));
  const bottom = Math.max(0, ...elements.map((element) => element.geometry.y + element.geometry.height), ...points.map((point) => point.y));
  return {
    width: Math.max(current.width, Math.ceil(right + 80)),
    height: Math.max(current.height, Math.ceil(bottom + 80)),
  };
}

function defaultGeometry(size: { width: number; height: number }): ElementGeometry {
  return { x: 40, y: 40, width: size.width, height: size.height };
}

function sameGeometry(left: ElementGeometry, right: ElementGeometry): boolean {
  return left.x === right.x && left.y === right.y
    && left.width === right.width && left.height === right.height;
}

function centerOf(geometry: ElementGeometry): Point {
  return { x: geometry.x + geometry.width / 2, y: geometry.y + geometry.height / 2 };
}

function copyGeometry(geometry: ElementGeometry): ElementGeometry {
  return { ...geometry, extensions: geometry.extensions ? structuredClone(geometry.extensions) : undefined };
}

function copyAnchor(anchor: EdgeEndpointAnchor | undefined): EdgeEndpointAnchor | undefined {
  return anchor ? { ...anchor } : undefined;
}

function copyPoint(point: Point | undefined): Point | undefined {
  return point ? copyRequiredPoint(point) : undefined;
}

function copyPoints(points: readonly Point[] | undefined): Point[] | undefined {
  return points?.map(copyRequiredPoint);
}

function copyCurve(curve: EdgeCurveRouting | undefined): EdgeCurveRouting | undefined {
  return curve ? {
    sourceHandle: copyCurvePoint(curve.sourceHandle),
    targetHandle: copyCurvePoint(curve.targetHandle),
    knots: curve.knots?.map((knot) => ({
      point: copyCurvePoint(knot.point)!,
      incomingHandle: copyCurvePoint(knot.incomingHandle),
      outgoingHandle: copyCurvePoint(knot.outgoingHandle),
      extensions: knot.extensions ? cloneJson(knot.extensions) : undefined,
    })),
    extensions: curve.extensions ? cloneJson(curve.extensions) : undefined,
  } : undefined;
}

function copyCurvePoint(point: Point | undefined): Point | undefined {
  return point ? {
    x: point.x,
    y: point.y,
    extensions: point.extensions ? cloneJson(point.extensions) : undefined,
  } : undefined;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function copyRequiredPoint(point: Point): Point {
  return { x: point.x, y: point.y };
}
