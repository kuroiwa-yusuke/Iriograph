import {
  edgeEndpointAnchorFromPoint,
  edgeEndpointAnchorPoint,
  type DiagramScene,
  type EdgeEndpointAnchor,
  type EdgeEndpointShape,
  type ElementGeometry,
  type Point,
  type ProjectedEdge,
  type ProjectedScene,
  type SceneContainer,
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
      provenance: previous?.provenance ?? container.provenance,
    };
  });
  const regions = (projected.regions ?? []).map((region): SceneRegion => {
    const previous = currentElements.get(region.elementId);
    return {
      ...region,
      geometry: copyGeometry(region.geometry ?? previous?.geometry ?? defaultGeometry(region.defaultSize)),
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
  const dimensions = presentationDimensions(current, [...nextElements.values()], edges);
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
    edges,
    diagnostics: projected.diagnostics.length ? [...projected.diagnostics] : [...current.diagnostics],
  };
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
    labelOffset: copyPoint(projected.labelOffset),
    sourceAnchor: copyAnchor(projected.sourceAnchor),
    targetAnchor: copyAnchor(projected.targetAnchor),
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
  const routingChanged = !current || !sameRouting(current, next);
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
    } else if (next.routeMode === "straight") {
      route = directRoute(source, target, next.sourceAnchor, next.targetAnchor);
    } else if (!current || current.waypoints?.length) {
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
    sourceAnchor: left.sourceAnchor,
    targetAnchor: left.targetAnchor,
    routeMode: left.routeMode,
  }) === JSON.stringify({
    waypoints: right.waypoints,
    sourceAnchor: right.sourceAnchor,
    targetAnchor: right.targetAnchor,
    routeMode: right.routeMode,
  });
}

function presentationDimensions(
  current: DiagramScene,
  elements: readonly GeometrySceneElement[],
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

function copyRequiredPoint(point: Point): Point {
  return { x: point.x, y: point.y };
}
