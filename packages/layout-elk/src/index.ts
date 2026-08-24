import {
  StandardLightweightLayoutAdapter,
  edgeEndpointAnchorFromPoint,
  edgeEndpointAnchorPoint,
  isValidEdgeEndpointAnchor,
  layoutElementFootprintGeometry,
  layoutExternalReservationGeometries,
  type ElementGeometry,
  type LayoutAdapter,
  type LayoutDiagnostic,
  type LayoutDirection,
  type LayoutEdge,
  type LayoutElement,
  type LayoutRequest,
  type LayoutResult,
  type LayoutSpacing,
  type Point,
} from "@iriograph/core";

export const ELK_LAYOUT_REFS = {
  layeredLr: "urn:iriograph:layout:elk-layered-lr:1",
  layeredTb: "urn:iriograph:layout:elk-layered-tb:1",
} as const;

export type ElkPoint = {
  x?: number;
  y?: number;
};

export type ElkEdgeSection = {
  id?: string;
  startPoint?: ElkPoint;
  bendPoints?: ElkPoint[];
  endPoint?: ElkPoint;
  incomingSections?: string[];
  outgoingSections?: string[];
};

export type ElkGraphEdge = {
  id: string;
  sources?: string[];
  targets?: string[];
  sections?: ElkEdgeSection[];
};

export type ElkGraphPort = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

/**
 * Stable, minimal ELK boundary exposed for host-injected Worker engines. The
 * adapter intentionally does not expose engine options through the document.
 */
export type ElkGraphNode = {
  id: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  ports?: ElkGraphPort[];
  children?: ElkGraphNode[];
  edges?: ElkGraphEdge[];
  layoutOptions?: Record<string, string>;
};

export interface ElkLayoutEngine {
  layout(graph: ElkGraphNode): Promise<ElkGraphNode>;
}

export interface ElkLayoutEngineFactory {
  create(): ElkLayoutEngine | Promise<ElkLayoutEngine>;
}

export type ElkLayeredLayoutAdapterOptions = {
  /** A ready engine, normally useful for tests or a host-managed Worker. */
  engine?: ElkLayoutEngine;
  /** A lazy factory, useful when browser Worker construction is host-owned. */
  engineFactory?: ElkLayoutEngineFactory;
};

const DEFAULT_SPACING: LayoutSpacing = {
  margin: 48,
  rankGap: 104,
  itemGap: 48,
  containerPadding: 28,
  containerHeader: 36,
};

type PreparedGraph = {
  graph: ElkGraphNode;
  elements: Map<string, LayoutElement>;
  edgesByEngineId: Map<string, LayoutEdge>;
  diagnostics: LayoutDiagnostic[];
};

type ParsedOutput = {
  geometries: Record<string, ElementGeometry>;
  routes: Record<string, Point[]>;
  diagnostics: LayoutDiagnostic[];
  invalidGeometry: boolean;
};

/** Creates a lazy engine backed by the bundled ELK module. */
export function createBundledElkEngine(): ElkLayoutEngine {
  let enginePromise: Promise<{ layout(graph: never): Promise<unknown> }> | undefined;
  return {
    layout: async (graph) => {
      enginePromise ??= import("elkjs/lib/elk.bundled.js").then(({ default: ELK }) => new ELK());
      const engine = await enginePromise;
      return engine.layout(graph as never) as Promise<ElkGraphNode>;
    },
  };
}

/** ELK Layered adapter for a single stable layout reference and direction. */
export class ElkLayeredLayoutAdapter implements LayoutAdapter {
  readonly #engineFactory: ElkLayoutEngineFactory;
  #enginePromise: Promise<ElkLayoutEngine> | undefined;

  constructor(
    readonly layoutRef: string,
    readonly direction: LayoutDirection,
    options: ElkLayeredLayoutAdapterOptions = {},
  ) {
    if (options.engine && options.engineFactory) {
      throw new Error("Specify either engine or engineFactory, not both");
    }
    this.#engineFactory = options.engineFactory ?? {
      create: () => options.engine ?? createBundledElkEngine(),
    };
  }

  async layout(request: LayoutRequest): Promise<LayoutResult> {
    if (request.layoutRef !== this.layoutRef) {
      return this.#fallback(request, [{
        severity: "error",
        code: "elk-layout-ref-mismatch",
        message: `adapter ${this.layoutRef} cannot handle ${request.layoutRef}`,
        layoutRef: request.layoutRef,
      }]);
    }

    const fixed = request.scene.elements.filter(isFixed);
    if (fixed.length > 0) {
      return this.#fixedFallback(request, fixed);
    }

    const prepared = prepareGraph(request, this.direction);
    try {
      const engine = await this.#getEngine();
      const output = await engine.layout(prepared.graph);
      const parsed = parseEngineOutput(request, prepared, output, this.direction);
      if (!parsed.invalidGeometry) {
        // ELK owns placement, while Core's route-only pass applies the same
        // endpoint clipping, manual-route hard constraints, comment obstacles,
        // and graph-global deterministic refinement used by the fallback.
        const routed = await routeWithFixedGeometry(
          request,
          parsed.geometries,
          this.direction,
        );
        parsed.routes = routed.routes;
        parsed.diagnostics.push(...routed.diagnostics);
      }
      const diagnostics = [...prepared.diagnostics, ...parsed.diagnostics];
      if (parsed.invalidGeometry) {
        return this.#fallback(request, diagnostics);
      }
      return ensureCompleteResult(request, this.direction, {
        layoutRef: request.layoutRef,
        geometries: parsed.geometries,
        routes: parsed.routes,
        width: 0,
        height: 0,
        diagnostics,
      });
    } catch (cause) {
      return this.#fallback(request, [...prepared.diagnostics, {
        severity: "error",
        code: "elk-engine-failed",
        message: cause instanceof Error ? cause.message : String(cause),
        layoutRef: request.layoutRef,
      }]);
    }
  }

  #getEngine(): Promise<ElkLayoutEngine> {
    this.#enginePromise ??= Promise.resolve(this.#engineFactory.create());
    return this.#enginePromise;
  }

  async #fixedFallback(
    request: LayoutRequest,
    fixed: LayoutElement[],
  ): Promise<LayoutResult> {
    const diagnostics: LayoutDiagnostic[] = [{
      severity: "warning",
      code: "elk-fixed-conservative-fallback",
      message: "ELK Layered was skipped because hard pinned geometry cannot be guaranteed; the deterministic conservative layout was used",
      layoutRef: request.layoutRef,
    }];
    for (const element of [...fixed].sort(compareElement)) {
      if (!element.geometry || !isValidGeometry(element.geometry)) {
        diagnostics.push({
          severity: "error",
          code: "elk-fixed-geometry-invalid",
          message: `fixed element requires finite positive geometry: ${element.elementId}`,
          layoutRef: request.layoutRef,
          elementId: element.elementId,
        });
      }
    }
    diagnostics.push(...fixedSiblingOverlapDiagnostics(request, fixed));
    const result = await this.#fallback(request, diagnostics);
    result.diagnostics.push(...fixedContainerDiagnostics(request, result.geometries));
    return result;
  }

  async #fallback(
    request: LayoutRequest,
    diagnostics: LayoutDiagnostic[],
  ): Promise<LayoutResult> {
    const fallback = await new StandardLightweightLayoutAdapter(
      request.layoutRef,
      this.direction,
    ).layout(request);
    return ensureCompleteResult(request, this.direction, {
      ...fallback,
      diagnostics: [...diagnostics, ...fallback.diagnostics],
    });
  }
}

async function routeWithFixedGeometry(
  request: LayoutRequest,
  geometries: Readonly<Record<string, ElementGeometry>>,
  direction: LayoutDirection,
): Promise<LayoutResult> {
  return new StandardLightweightLayoutAdapter(request.layoutRef, direction).layout({
    ...request,
    scene: {
      ...request.scene,
      elements: request.scene.elements.map((element) => ({
        ...element,
        geometry: geometries[element.elementId],
        placement: "user" as const,
        pinned: true,
      })),
    },
  });
}

function prepareGraph(request: LayoutRequest, direction: LayoutDirection): PreparedGraph {
  const diagnostics: LayoutDiagnostic[] = [];
  const elements = new Map<string, LayoutElement>();
  for (const element of [...request.scene.elements].sort(compareElement)) {
    if (elements.has(element.elementId)) {
      diagnostics.push({
        severity: "warning",
        code: "elk-duplicate-element-id",
        message: `duplicate element identity uses the first definition: ${element.elementId}`,
        layoutRef: request.layoutRef,
        elementId: element.elementId,
      });
      continue;
    }
    elements.set(element.elementId, element);
  }

  const parents = validParents(elements, request.layoutRef, diagnostics);
  const children = new Map<string, string[]>();
  for (const id of elements.keys()) {
    const parent = parents.get(id) ?? "";
    const members = children.get(parent) ?? [];
    members.push(id);
    children.set(parent, members);
  }
  for (const members of children.values()) members.sort(compareText);

  const spacing = { ...DEFAULT_SPACING, ...request.spacing };
  const portsByElement = new Map<string, ElkGraphPort[]>();
  const buildNode = (id: string): ElkGraphNode => {
    const element = elements.get(id)!;
    const size = elementSize(element);
    const nested = children.get(id) ?? [];
    const reservationMargins = externalReservationMargins(element, size);
    const ports = portsByElement.get(id) ?? [];
    const layoutOptions: Record<string, string> = {
      ...(element.structuralKind === "container"
        ? {
            "elk.padding": paddingInsetsOption(element.contentInsets ?? {
              top: spacing.containerHeader + spacing.containerPadding,
              right: spacing.containerPadding,
              bottom: spacing.containerPadding,
              left: spacing.containerPadding,
            }),
          }
        : {}),
      ...(reservationMargins
        ? { "elk.margins": reservationMargins }
        : {}),
      ...(ports.length > 0
        ? { "elk.portConstraints": "FIXED_POS" }
        : {}),
    };
    return {
      id,
      width: size.width,
      height: size.height,
      ...(ports.length > 0 ? { ports: ports.map((port) => ({ ...port })) } : {}),
      ...(nested.length > 0 ? { children: nested.map(buildNode) } : {}),
      ...(Object.keys(layoutOptions).length > 0 ? { layoutOptions } : {}),
    };
  };

  const edgesByEngineId = new Map<string, LayoutEdge>();
  const edges: ElkGraphEdge[] = [];
  const duplicateCounts = new Map<string, number>();
  const portIds = new Set<string>();
  const fixedPort = (
    elementId: string,
    engineId: string,
    role: "source" | "target",
    anchor: LayoutEdge["sourceAnchor"],
  ): string | undefined => {
    if (!isValidEdgeEndpointAnchor(anchor)) return undefined;
    const element = elements.get(elementId)!;
    const size = elementSize(element);
    const boundary = edgeEndpointAnchorPoint(
      { x: 0, y: 0, width: size.width, height: size.height },
      elementShape(element),
      anchor,
    );
    let id = `urn:iriograph:elk-port:${encodeURIComponent(engineId)}:${role}`;
    while (elements.has(id) || portIds.has(id)) id += ":port";
    portIds.add(id);
    const ports = portsByElement.get(elementId) ?? [];
    ports.push({
      id,
      x: boundary.x - 0.5,
      y: boundary.y - 0.5,
      width: 1,
      height: 1,
    });
    portsByElement.set(elementId, ports);
    return id;
  };
  for (const edge of [...request.scene.edges].sort(compareEdge)) {
    if (!elements.has(edge.sourceElementId) || !elements.has(edge.targetElementId)) {
      diagnostics.push({
        severity: "warning",
        code: "elk-edge-endpoint-missing",
        message: `edge was omitted from ELK input because an endpoint is missing: ${edge.elementId}`,
        layoutRef: request.layoutRef,
        edgeId: edge.elementId,
      });
      continue;
    }
    const occurrence = duplicateCounts.get(edge.elementId) ?? 0;
    duplicateCounts.set(edge.elementId, occurrence + 1);
    const engineId = occurrence === 0 ? edge.elementId : `${edge.elementId}\u0000${occurrence}`;
    edgesByEngineId.set(engineId, edge);
    const sourcePort = fixedPort(
      edge.sourceElementId,
      engineId,
      "source",
      edge.sourceAnchor,
    );
    const targetPort = fixedPort(
      edge.targetElementId,
      engineId,
      "target",
      edge.targetAnchor,
    );
    edges.push({
      id: engineId,
      sources: [sourcePort ?? edge.sourceElementId],
      targets: [targetPort ?? edge.targetElementId],
    });
  }

  let rootId = "urn:iriograph:layout-elk:root";
  while (elements.has(rootId)) rootId += ":root";
  return {
    graph: {
      id: rootId,
      children: (children.get("") ?? []).map(buildNode),
      edges,
      layoutOptions: {
        "elk.algorithm": "org.eclipse.elk.layered",
        "elk.direction": direction,
        "elk.edgeRouting": "ORTHOGONAL",
        "elk.hierarchyHandling": "INCLUDE_CHILDREN",
        "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
        "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
        "elk.layered.crossingMinimization.greedySwitch.type": "TWO_SIDED",
        "elk.layered.crossingMinimization.greedySwitchHierarchical.type": "TWO_SIDED",
        "elk.layered.nodePlacement.favorStraightEdges": "true",
        "elk.layered.thoroughness": "20",
        "elk.layered.unnecessaryBendpoints": "false",
        "elk.layered.allowNonFlowPortsToSwitchSides": "true",
        "elk.spacing.nodeNode": String(spacing.itemGap),
        "elk.spacing.portPort": String(Math.max(8, Math.round(spacing.itemGap / 5))),
        "elk.spacing.edgeEdge": String(Math.max(10, Math.round(spacing.itemGap / 4))),
        "elk.spacing.edgeNode": String(Math.max(12, Math.round(spacing.itemGap / 3))),
        "elk.layered.spacing.edgeEdgeBetweenLayers": String(
          Math.max(12, Math.round(spacing.itemGap / 3)),
        ),
        "elk.layered.spacing.edgeNodeBetweenLayers": String(
          Math.max(16, Math.round(spacing.itemGap / 2)),
        ),
        "elk.layered.spacing.nodeNodeBetweenLayers": String(spacing.rankGap),
        "elk.padding": paddingOption(spacing.margin, spacing.margin),
      },
    },
    elements,
    edgesByEngineId,
    diagnostics,
  };
}

function validParents(
  elements: Map<string, LayoutElement>,
  layoutRef: string,
  diagnostics: LayoutDiagnostic[],
): Map<string, string> {
  const parents = new Map<string, string>();
  for (const element of elements.values()) {
    if (!element.parentElementId) continue;
    const parent = elements.get(element.parentElementId);
    if (!parent || parent.structuralKind !== "container") {
      diagnostics.push({
        severity: "warning",
        code: "elk-parent-invalid",
        message: `parent is missing or is not a container: ${element.parentElementId}`,
        layoutRef,
        elementId: element.elementId,
      });
      continue;
    }
    parents.set(element.elementId, parent.elementId);
  }

  for (;;) {
    const cycle = findParentCycle([...elements.keys()].sort(compareText), parents);
    if (!cycle) break;
    const cut = [...cycle].sort(compareText)[0]!;
    parents.delete(cut);
    diagnostics.push({
      severity: "warning",
      code: "elk-containment-cycle",
      message: `containment cycle was cut at ${cut}`,
      layoutRef,
      elementId: cut,
    });
  }
  return parents;
}

function findParentCycle(ids: string[], parents: Map<string, string>): string[] | undefined {
  for (const start of ids) {
    const path: string[] = [];
    const positions = new Map<string, number>();
    let current: string | undefined = start;
    while (current !== undefined) {
      const previous = positions.get(current);
      if (previous !== undefined) return path.slice(previous);
      positions.set(current, path.length);
      path.push(current);
      current = parents.get(current);
    }
  }
  return undefined;
}

function parseEngineOutput(
  request: LayoutRequest,
  prepared: PreparedGraph,
  output: ElkGraphNode,
  direction: LayoutDirection,
): ParsedOutput {
  const diagnostics: LayoutDiagnostic[] = [];
  const geometries: Record<string, ElementGeometry> = {};
  const engineRoutes = new Map<string, Point[]>();
  let invalidGeometry = false;

  if (!output || typeof output !== "object" || !Array.isArray(output.children)) {
    diagnostics.push(engineOutputDiagnostic(request, "ELK output root has no children"));
    return { geometries, routes: {}, diagnostics, invalidGeometry: true };
  }

  const visit = (graph: ElkGraphNode, parentX: number, parentY: number, root: boolean): void => {
    const graphX = root ? parentX : parentX + finiteOrZero(graph.x);
    const graphY = root ? parentY : parentY + finiteOrZero(graph.y);
    if (!root) {
      if (
        !Number.isFinite(graph.x)
        || !Number.isFinite(graph.y)
        || !isFinitePositive(graph.width)
        || !isFinitePositive(graph.height)
      ) {
        invalidGeometry = true;
        diagnostics.push(engineOutputDiagnostic(
          request,
          `ELK geometry is missing or invalid: ${graph.id}`,
          graph.id,
        ));
      } else if (!prepared.elements.has(graph.id)) {
        diagnostics.push({
          severity: "warning",
          code: "elk-output-unknown-element",
          message: `ELK output contains an unknown element: ${graph.id}`,
          layoutRef: request.layoutRef,
          elementId: graph.id,
        });
      } else if (geometries[graph.id]) {
        invalidGeometry = true;
        diagnostics.push(engineOutputDiagnostic(
          request,
          `ELK output contains duplicate element geometry: ${graph.id}`,
          graph.id,
        ));
      } else {
        geometries[graph.id] = {
          x: graphX,
          y: graphY,
          width: graph.width!,
          height: graph.height!,
        };
      }
    }

    for (const edge of graph.edges ?? []) {
      const points = routeFromSections(edge.sections, graphX, graphY);
      if (points) engineRoutes.set(edge.id, points);
    }
    for (const child of graph.children ?? []) visit(child, graphX, graphY, false);
  };
  visit(output, 0, 0, true);

  for (const id of prepared.elements.keys()) {
    if (!geometries[id]) {
      invalidGeometry = true;
      diagnostics.push(engineOutputDiagnostic(
        request,
        `ELK output is missing element geometry: ${id}`,
        id,
      ));
    }
  }
  if (invalidGeometry) return { geometries, routes: {}, diagnostics, invalidGeometry };

  const allEnginePoints = [...engineRoutes.values()].flat();
  const xValues = [
    ...Object.values(geometries).map((geometry) => geometry.x),
    ...allEnginePoints.map((point) => point.x),
  ];
  const yValues = [
    ...Object.values(geometries).map((geometry) => geometry.y),
    ...allEnginePoints.map((point) => point.y),
  ];
  const minX = xValues.length > 0 ? Math.min(...xValues) : 0;
  const minY = yValues.length > 0 ? Math.min(...yValues) : 0;
  const spacing = { ...DEFAULT_SPACING, ...request.spacing };
  const dx = spacing.margin - minX;
  const dy = spacing.margin - minY;
  for (const geometry of Object.values(geometries)) {
    geometry.x += dx;
    geometry.y += dy;
  }
  for (const points of engineRoutes.values()) {
    for (const point of points) {
      point.x += dx;
      point.y += dy;
    }
  }

  const routes: Record<string, Point[]> = {};
  for (const [engineId, edge] of prepared.edgesByEngineId) {
    const manual = edge.routeMode === "straight" ? undefined : manualRoute(edge, geometries);
    if (manual) {
      routes[edge.elementId] = manual;
      continue;
    }
    const points = engineRoutes.get(engineId);
    if (isValidRoute(points)) {
      routes[edge.elementId] = points.map(copyPoint);
    } else {
      diagnostics.push({
        severity: "warning",
        code: "elk-output-route-invalid",
        message: `ELK route is missing or invalid; an orthogonal route was generated: ${edge.elementId}`,
        layoutRef: request.layoutRef,
        edgeId: edge.elementId,
      });
      routes[edge.elementId] = fallbackRoute(edge, geometries, direction, 0);
    }
  }
  return { geometries, routes, diagnostics, invalidGeometry: false };
}

function routeFromSections(
  sections: ElkEdgeSection[] | undefined,
  offsetX: number,
  offsetY: number,
): Point[] | undefined {
  if (!sections || sections.length === 0) return undefined;
  const remaining = sections.map((section, index) => ({
    id: section.id ?? String(index),
    incoming: section.incomingSections ?? [],
    outgoing: section.outgoingSections ?? [],
    points: sectionPoints(section, offsetX, offsetY),
  }));
  if (remaining.some((section) => !isValidRoute(section.points))) return undefined;

  const byId = new Map(remaining.map((section) => [section.id, section]));
  const first = remaining.find((section) => section.incoming.length === 0) ?? remaining[0]!;
  const ordered = [first];
  const used = new Set([first.id]);
  let current = first;
  while (current.outgoing.length > 0) {
    const next = current.outgoing
      .map((id) => byId.get(id))
      .find((section) => section && !used.has(section.id));
    if (!next) break;
    ordered.push(next);
    used.add(next.id);
    current = next;
  }
  for (const section of remaining) if (!used.has(section.id)) ordered.push(section);

  const route: Point[] = [];
  for (const section of ordered) appendConnected(route, section.points!);
  return isValidRoute(route) ? route : undefined;
}

function sectionPoints(
  section: ElkEdgeSection,
  offsetX: number,
  offsetY: number,
): Point[] | undefined {
  const values = [section.startPoint, ...(section.bendPoints ?? []), section.endPoint];
  if (values.some((point) => !point || !Number.isFinite(point.x) || !Number.isFinite(point.y))) {
    return undefined;
  }
  return values.map((point) => ({ x: point!.x! + offsetX, y: point!.y! + offsetY }));
}

function appendConnected(target: Point[], input: Point[]): void {
  if (target.length === 0) {
    target.push(...input.map(copyPoint));
    return;
  }
  const last = target.at(-1)!;
  const forwardDistance = pointDistance(last, input[0]!);
  const reverseDistance = pointDistance(last, input.at(-1)!);
  const points = forwardDistance <= reverseDistance ? input : [...input].reverse();
  if (samePoint(last, points[0]!)) target.push(...points.slice(1).map(copyPoint));
  else target.push(...points.map(copyPoint));
}

function ensureCompleteResult(
  request: LayoutRequest,
  direction: LayoutDirection,
  candidate: LayoutResult,
): LayoutResult {
  const diagnostics = [...candidate.diagnostics];
  const geometries: Record<string, ElementGeometry> = {};
  const occupied: ElementGeometry[] = [];
  const elements = uniqueElements(request.scene.elements);
  const spacing = { ...DEFAULT_SPACING, ...request.spacing };

  elements.forEach((element, index) => {
    const candidateGeometry = candidate.geometries[element.elementId];
    const fixedGeometry = isFixed(element) && isValidGeometry(element.geometry)
      ? element.geometry
      : undefined;
    let geometry = fixedGeometry
      ? copyGeometry(fixedGeometry)
      : isValidGeometry(candidateGeometry)
        ? copyGeometry(candidateGeometry)
        : fallbackGeometry(element, index, direction, spacing);
    if (!fixedGeometry && !isValidGeometry(candidateGeometry)) {
      geometry = avoidElementOccupied(element, geometry, occupied, direction, spacing.itemGap);
      diagnostics.push({
        severity: "warning",
        code: "elk-result-geometry-completed",
        message: `missing or invalid geometry was completed deterministically: ${element.elementId}`,
        layoutRef: request.layoutRef,
        elementId: element.elementId,
      });
    }
    geometries[element.elementId] = geometry;
    occupied.push(layoutElementFootprintGeometry(element, geometry));
  });

  const routes: Record<string, Point[]> = {};
  const sortedEdges = [...request.scene.edges].sort(compareEdge);
  const bundleIndexes = routeBundleIndexes(sortedEdges);
  const elementsById = new Map(elements.map((element) => [element.elementId, element]));
  for (const edge of sortedEdges) {
    const manual = edge.routeMode === "straight" ? undefined : manualRoute(edge, geometries);
    const candidateRoute = candidate.routes[edge.elementId];
    let route: Point[];
    if (manual) {
      route = manual;
    } else if (edge.routeMode === "straight") {
      route = directRoute(edge, geometries, elementsById);
    } else if (isValidRoute(candidateRoute)) {
      route = candidateRoute.map(copyPoint);
    } else {
      route = fallbackRoute(
        edge,
        geometries,
        direction,
        bundleIndexes.get(edge) ?? 0,
      );
      diagnostics.push({
        severity: "warning",
        code: "elk-result-route-completed",
        message: `missing or invalid route was completed deterministically: ${edge.elementId}`,
        layoutRef: request.layoutRef,
        edgeId: edge.elementId,
      });
    }
    routes[edge.elementId] = applyExplicitEndpointAnchors(
      route,
      edge,
      geometries,
      elementsById,
    );
  }

  const bounds = sceneBounds(
    elements.flatMap((element) => {
      const geometry = geometries[element.elementId];
      return geometry
        ? [geometry, ...layoutExternalReservationGeometries(element, geometry)]
        : [];
    }),
    Object.values(routes).flat(),
    spacing.margin,
  );
  return {
    layoutRef: request.layoutRef,
    geometries,
    routes,
    width: bounds.width,
    height: bounds.height,
    diagnostics,
  };
}

function directRoute(
  edge: LayoutEdge,
  geometries: Readonly<Record<string, ElementGeometry>>,
  elements: ReadonlyMap<string, LayoutElement>,
): Point[] {
  const source = geometries[edge.sourceElementId];
  const target = geometries[edge.targetElementId];
  if (!source || !target) return [{ x: 0, y: 0 }, { x: 1, y: 0 }];
  const sourceToward = centerOf(target);
  const targetToward = centerOf(source);
  return [
    edgeEndpointAnchorPoint(
      source,
      elementShape(elements.get(edge.sourceElementId)),
      edgeEndpointAnchorFromPoint(source, sourceToward),
    ),
    edgeEndpointAnchorPoint(
      target,
      elementShape(elements.get(edge.targetElementId)),
      edgeEndpointAnchorFromPoint(target, targetToward),
    ),
  ];
}

function elementShape(element: LayoutElement | undefined) {
  return element?.shape ?? (element?.structuralKind === "container"
    ? "container"
    : element?.structuralKind === "region" ? "region" : "rectangle");
}

function applyExplicitEndpointAnchors(
  route: Point[],
  edge: LayoutEdge,
  geometries: Readonly<Record<string, ElementGeometry>>,
  elements: ReadonlyMap<string, LayoutElement>,
): Point[] {
  if (route.length < 2) return route;
  const result = route.map(copyPoint);
  const sourceGeometry = geometries[edge.sourceElementId];
  const targetGeometry = geometries[edge.targetElementId];
  const sourceElement = elements.get(edge.sourceElementId);
  const targetElement = elements.get(edge.targetElementId);
  if (sourceGeometry && isValidEdgeEndpointAnchor(edge.sourceAnchor)) {
    result[0] = edgeEndpointAnchorPoint(
      sourceGeometry,
      elementShape(sourceElement),
      edge.sourceAnchor,
    );
  }
  if (targetGeometry && isValidEdgeEndpointAnchor(edge.targetAnchor)) {
    result[result.length - 1] = edgeEndpointAnchorPoint(
      targetGeometry,
      elementShape(targetElement),
      edge.targetAnchor,
    );
  }
  return result;
}

function fixedSiblingOverlapDiagnostics(
  request: LayoutRequest,
  fixed: LayoutElement[],
): LayoutDiagnostic[] {
  const diagnostics: LayoutDiagnostic[] = [];
  const valid = fixed.filter(
    (element): element is LayoutElement & { geometry: ElementGeometry } =>
      isValidGeometry(element.geometry),
  ).sort(compareElement);
  for (let leftIndex = 0; leftIndex < valid.length; leftIndex += 1) {
    const left = valid[leftIndex]!;
    for (let rightIndex = leftIndex + 1; rightIndex < valid.length; rightIndex += 1) {
      const right = valid[rightIndex]!;
      if (left.structuralKind === "region" || right.structuralKind === "region") continue;
      if ((left.parentElementId ?? "") !== (right.parentElementId ?? "")) continue;
      if (!intersects(
        layoutElementFootprintGeometry(left, left.geometry),
        layoutElementFootprintGeometry(right, right.geometry),
      )) continue;
      diagnostics.push({
        severity: "error",
        code: "elk-fixed-overlap",
        message: `fixed sibling geometries overlap and were not moved: ${left.elementId}, ${right.elementId}`,
        layoutRef: request.layoutRef,
        elementId: left.elementId,
      });
    }
  }
  return diagnostics;
}

function fixedContainerDiagnostics(
  request: LayoutRequest,
  geometries: Record<string, ElementGeometry>,
): LayoutDiagnostic[] {
  const elements = new Map(request.scene.elements.map((element) => [element.elementId, element]));
  const spacing = { ...DEFAULT_SPACING, ...request.spacing };
  const diagnostics: LayoutDiagnostic[] = [];
  for (const element of [...elements.values()].sort(compareElement)) {
    if (!element.parentElementId) continue;
    const parent = elements.get(element.parentElementId);
    if (!parent || !isFixed(parent)) continue;
    const parentGeometry = geometries[parent.elementId];
    const childGeometry = geometries[element.elementId];
    const parentContent = parentGeometry
      ? insetGeometry(parentGeometry, parent.contentInsets ?? {
          top: spacing.containerHeader + spacing.containerPadding,
          right: spacing.containerPadding,
          bottom: spacing.containerPadding,
          left: spacing.containerPadding,
        })
      : undefined;
    if (
      parentContent
      && childGeometry
      && !contains(parentContent, layoutElementFootprintGeometry(element, childGeometry))
    ) {
      diagnostics.push({
        severity: "error",
        code: "elk-fixed-container-overflow",
        message: `fixed container cannot contain the laid out child without moving: ${element.elementId}`,
        layoutRef: request.layoutRef,
        elementId: element.elementId,
      });
    }
  }
  return diagnostics;
}

function manualRoute(
  edge: LayoutEdge,
  geometries: Record<string, ElementGeometry>,
): Point[] | undefined {
  if (
    (edge.routingPlacement !== "user" && edge.routeMode !== "manual")
    || !edge.waypoints
    || edge.waypoints.length === 0
  ) {
    return undefined;
  }
  const source = geometries[edge.sourceElementId];
  const target = geometries[edge.targetElementId];
  if (!source || !target) return edge.waypoints.map(copyPoint);
  if (source === target || edge.sourceElementId === edge.targetElementId) {
    const centerY = source.y + source.height / 2;
    const inset = Math.max(4, Math.min(12, source.height / 4));
    return [
      { x: source.x + source.width, y: centerY - inset },
      ...edge.waypoints.map(copyPoint),
      { x: source.x + source.width, y: centerY + inset },
    ];
  }
  return [
    rectangleBoundaryPoint(source, edge.waypoints[0]!),
    ...edge.waypoints.map(copyPoint),
    rectangleBoundaryPoint(target, edge.waypoints.at(-1)!),
  ];
}

function fallbackRoute(
  edge: LayoutEdge,
  geometries: Record<string, ElementGeometry>,
  direction: LayoutDirection,
  laneIndex: number,
): Point[] {
  const source = geometries[edge.sourceElementId];
  const target = geometries[edge.targetElementId];
  if (!source || !target) return [{ x: 0, y: 0 }, { x: 1, y: 0 }];
  if (edge.sourceElementId === edge.targetElementId) {
    const centerY = source.y + source.height / 2;
    const inset = Math.max(4, Math.min(12, source.height / 4));
    const right = source.x + source.width;
    const outer = right + 36 + laneIndex * 18;
    return [
      { x: right, y: centerY - inset },
      { x: outer, y: centerY - inset },
      { x: outer, y: centerY + inset },
      { x: right, y: centerY + inset },
    ];
  }
  const sourceCenter = centerOf(source);
  const targetCenter = centerOf(target);
  const laneOffset = laneIndex * 20;
  if (direction === "LR") {
    const forward = targetCenter.x >= sourceCenter.x;
    const start = { x: forward ? source.x + source.width : source.x, y: sourceCenter.y };
    const end = { x: forward ? target.x : target.x + target.width, y: targetCenter.y };
    const middle = (start.x + end.x) / 2 + laneOffset;
    return [start, { x: middle, y: start.y }, { x: middle, y: end.y }, end];
  }
  const forward = targetCenter.y >= sourceCenter.y;
  const start = { x: sourceCenter.x, y: forward ? source.y + source.height : source.y };
  const end = { x: targetCenter.x, y: forward ? target.y : target.y + target.height };
  const middle = (start.y + end.y) / 2 + laneOffset;
  return [start, { x: start.x, y: middle }, { x: end.x, y: middle }, end];
}

function routeBundleIndexes(edges: LayoutEdge[]): Map<LayoutEdge, number> {
  const groups = new Map<string, LayoutEdge[]>();
  for (const edge of edges) {
    const endpoints = [edge.sourceElementId, edge.targetElementId].sort(compareText);
    const key = `${endpoints[0]}\u0000${endpoints[1]}`;
    const group = groups.get(key) ?? [];
    group.push(edge);
    groups.set(key, group);
  }
  const indexes = new Map<LayoutEdge, number>();
  for (const group of groups.values()) {
    group.forEach((edge, index) => indexes.set(edge, index - (group.length - 1) / 2));
  }
  return indexes;
}

function fallbackGeometry(
  element: LayoutElement,
  index: number,
  direction: LayoutDirection,
  spacing: LayoutSpacing,
): ElementGeometry {
  const size = elementSize(element);
  return direction === "LR"
    ? {
        x: spacing.margin + index * (160 + spacing.rankGap),
        y: spacing.margin,
        width: size.width,
        height: size.height,
      }
    : {
        x: spacing.margin,
        y: spacing.margin + index * (72 + spacing.rankGap),
        width: size.width,
        height: size.height,
      };
}

function avoidOccupied(
  input: ElementGeometry,
  occupied: ElementGeometry[],
  direction: LayoutDirection,
  gap: number,
): ElementGeometry {
  const result = copyGeometry(input);
  for (const obstacle of occupied) {
    while (intersects(result, obstacle)) {
      if (direction === "LR") result.y = obstacle.y + obstacle.height + gap;
      else result.x = obstacle.x + obstacle.width + gap;
    }
  }
  return result;
}

function avoidElementOccupied(
  element: LayoutElement,
  geometry: ElementGeometry,
  occupied: ElementGeometry[],
  direction: LayoutDirection,
  gap: number,
): ElementGeometry {
  const relative = layoutElementFootprintGeometry(element, {
    x: 0,
    y: 0,
    width: geometry.width,
    height: geometry.height,
  });
  const footprint = avoidOccupied({
    x: geometry.x + relative.x,
    y: geometry.y + relative.y,
    width: relative.width,
    height: relative.height,
  }, occupied, direction, gap);
  return {
    x: footprint.x - relative.x,
    y: footprint.y - relative.y,
    width: geometry.width,
    height: geometry.height,
  };
}

function routeBundleKey(edge: LayoutEdge): string {
  const endpoints = [edge.sourceElementId, edge.targetElementId].sort(compareText);
  return `${endpoints[0]}\u0000${endpoints[1]}`;
}

function uniqueElements(input: readonly LayoutElement[]): LayoutElement[] {
  const elements = new Map<string, LayoutElement>();
  for (const element of [...input].sort(compareElement)) {
    if (!elements.has(element.elementId)) elements.set(element.elementId, element);
  }
  return [...elements.values()];
}

function elementSize(element: LayoutElement): { width: number; height: number } {
  const explicit = element.size ?? element.geometry;
  if (explicit && isFinitePositive(explicit.width) && isFinitePositive(explicit.height)) {
    return { width: explicit.width, height: explicit.height };
  }
  return element.structuralKind === "container"
    ? { width: 360, height: 180 }
    : { width: 160, height: 72 };
}

function externalReservationMargins(
  element: LayoutElement,
  size: { width: number; height: number },
): string | undefined {
  const footprint = layoutElementFootprintGeometry(element, {
    x: 0,
    y: 0,
    width: size.width,
    height: size.height,
  });
  const top = Math.max(0, -footprint.y);
  const left = Math.max(0, -footprint.x);
  const bottom = Math.max(0, footprint.y + footprint.height - size.height);
  const right = Math.max(0, footprint.x + footprint.width - size.width);
  if (top === 0 && left === 0 && bottom === 0 && right === 0) return undefined;
  return `[top=${top},left=${left},bottom=${bottom},right=${right}]`;
}

function paddingOption(vertical: number, horizontal: number): string {
  return `[top=${vertical},left=${horizontal},bottom=${horizontal},right=${horizontal}]`;
}

function paddingInsetsOption(
  insets: { top: number; right: number; bottom: number; left: number },
): string {
  return `[top=${insets.top},left=${insets.left},bottom=${insets.bottom},right=${insets.right}]`;
}

function insetGeometry(
  geometry: ElementGeometry,
  insets: { top: number; right: number; bottom: number; left: number },
): ElementGeometry {
  return {
    x: geometry.x + insets.left,
    y: geometry.y + insets.top,
    width: Math.max(0, geometry.width - insets.left - insets.right),
    height: Math.max(0, geometry.height - insets.top - insets.bottom),
  };
}

function engineOutputDiagnostic(
  request: LayoutRequest,
  message: string,
  elementId?: string,
): LayoutDiagnostic {
  return {
    severity: "error",
    code: "elk-output-invalid",
    message,
    layoutRef: request.layoutRef,
    elementId,
  };
}

function sceneBounds(
  geometries: ElementGeometry[],
  routePoints: Point[],
  margin: number,
): { width: number; height: number } {
  if (geometries.length === 0 && routePoints.length === 0) {
    return { width: margin * 2, height: margin * 2 };
  }
  return {
    width: Math.max(
      0,
      ...geometries.map((geometry) => geometry.x + geometry.width),
      ...routePoints.map((point) => point.x),
    ) + margin,
    height: Math.max(
      0,
      ...geometries.map((geometry) => geometry.y + geometry.height),
      ...routePoints.map((point) => point.y),
    ) + margin,
  };
}

function rectangleBoundaryPoint(geometry: ElementGeometry, toward: Point): Point {
  const center = centerOf(geometry);
  const dx = toward.x - center.x;
  const dy = toward.y - center.y;
  if (dx === 0 && dy === 0) return { x: geometry.x + geometry.width, y: center.y };
  const scaleX = dx === 0 ? Number.POSITIVE_INFINITY : geometry.width / 2 / Math.abs(dx);
  const scaleY = dy === 0 ? Number.POSITIVE_INFINITY : geometry.height / 2 / Math.abs(dy);
  const scale = Math.min(scaleX, scaleY);
  return { x: center.x + dx * scale, y: center.y + dy * scale };
}

function centerOf(geometry: ElementGeometry): Point {
  return {
    x: geometry.x + geometry.width / 2,
    y: geometry.y + geometry.height / 2,
  };
}

function isFixed(element: LayoutElement): boolean {
  return element.pinned === true || element.placement === "user";
}

function isValidGeometry(
  geometry: ElementGeometry | undefined,
): geometry is ElementGeometry {
  return geometry !== undefined
    && Number.isFinite(geometry.x)
    && Number.isFinite(geometry.y)
    && isFinitePositive(geometry.width)
    && isFinitePositive(geometry.height);
}

function isValidRoute(points: Point[] | undefined): points is Point[] {
  return points !== undefined
    && points.length >= 2
    && points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
}

function isFinitePositive(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value) && value > 0;
}

function finiteOrZero(value: number | undefined): number {
  return Number.isFinite(value) ? value! : 0;
}

function intersects(left: ElementGeometry, right: ElementGeometry): boolean {
  return left.x < right.x + right.width
    && left.x + left.width > right.x
    && left.y < right.y + right.height
    && left.y + left.height > right.y;
}

function contains(parent: ElementGeometry, child: ElementGeometry): boolean {
  return child.x >= parent.x
    && child.y >= parent.y
    && child.x + child.width <= parent.x + parent.width
    && child.y + child.height <= parent.y + parent.height;
}

function pointDistance(left: Point, right: Point): number {
  return Math.abs(left.x - right.x) + Math.abs(left.y - right.y);
}

function samePoint(left: Point, right: Point): boolean {
  return left.x === right.x && left.y === right.y;
}

function copyGeometry(geometry: ElementGeometry): ElementGeometry {
  return { ...geometry };
}

function copyPoint(point: Point): Point {
  return { ...point };
}

function compareElement(left: LayoutElement, right: LayoutElement): number {
  return compareText(left.elementId, right.elementId);
}

function compareEdge(left: LayoutEdge, right: LayoutEdge): number {
  return compareText(left.elementId, right.elementId)
    || compareText(left.sourceElementId, right.sourceElementId)
    || compareText(left.targetElementId, right.targetElementId)
    || compareText(routeBundleKey(left), routeBundleKey(right));
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
