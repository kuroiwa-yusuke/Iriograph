import {
  edgeEndpointAnchorFromPoint,
  edgeEndpointAnchorPoint,
  isValidEdgeEndpointAnchor,
} from "./endpoint-anchor.js";
import type {
  EdgeEndpointAnchor,
  EdgeEndpointShape,
  EdgeRouteMode,
  ElementGeometry,
  Point,
} from "./model.js";
import type { ContainerContentInsets } from "./container-content.js";

export const STANDARD_LAYOUT_REFS = {
  hierarchicalLr: "urn:iriograph:layout:hierarchical-lr:1",
  hierarchicalTb: "urn:iriograph:layout:hierarchical-tb:1",
} as const;

export type LayoutDirection = "LR" | "TB";
export type LayoutMode = "incremental" | "full";

export type LayoutExternalReservation = {
  placement: "bottom-center";
  width: number;
  height: number;
  gap: number;
};

export type LayoutElement = {
  elementId: string;
  structuralKind: "node" | "container" | "region" | "annotation";
  parentElementId?: string;
  geometry?: ElementGeometry;
  size?: { width: number; height: number };
  pinned?: boolean;
  placement?: "generated" | "user";
  /** Concrete renderer boundary used when resolving endpoint anchors. */
  shape?: EdgeEndpointShape;
  /** Content rectangle reserved inside a container by its visual template. */
  contentInsets?: ContainerContentInsets;
  /** Renderer-only boxes reserved outside the visual element geometry. */
  externalReservations?: readonly LayoutExternalReservation[];
};

export type LayoutMembership = {
  semanticRef: string;
  containerElementId: string;
  memberElementId: string;
  regionElementId?: string;
};

export type LayoutEdge = {
  elementId: string;
  sourceElementId: string;
  targetElementId: string;
  waypoints?: readonly Point[];
  sourceAnchor?: EdgeEndpointAnchor;
  targetAnchor?: EdgeEndpointAnchor;
  routingPlacement?: "generated" | "user";
  routeMode?: EdgeRouteMode;
};

/**
 * Minimal structural boundary accepted by layout adapters. Projection can add
 * arbitrary provenance/appearance fields without coupling them to layout.
 */
export type LayoutProjectedScene<
  TElement extends LayoutElement = LayoutElement,
  TEdge extends LayoutEdge = LayoutEdge,
> = {
  elements: readonly TElement[];
  edges: readonly TEdge[];
  memberships?: readonly LayoutMembership[];
};

export type LayoutSpacing = {
  margin: number;
  rankGap: number;
  itemGap: number;
  containerPadding: number;
  containerHeader: number;
};

export type LayoutRequest = {
  layoutRef: string;
  scene: LayoutProjectedScene;
  mode?: LayoutMode;
  spacing?: Partial<LayoutSpacing>;
};

export type LayoutDiagnostic = {
  severity: "warning" | "error";
  code: string;
  message: string;
  layoutRef?: string;
  elementId?: string;
  edgeId?: string;
};

export type LayoutResult = {
  layoutRef: string;
  geometries: Record<string, ElementGeometry>;
  /** Every route includes its source and target attachment points. */
  routes: Record<string, Point[]>;
  width: number;
  height: number;
  diagnostics: LayoutDiagnostic[];
};

export interface LayoutAdapter {
  readonly layoutRef: string;
  layout(request: LayoutRequest): Promise<LayoutResult>;
}

export type LayoutAdapterResolution =
  | { resolved: true; adapter: LayoutAdapter; diagnostics: [] }
  | { resolved: false; diagnostics: [LayoutDiagnostic] };

const DEFAULT_SPACING: LayoutSpacing = {
  margin: 48,
  rankGap: 104,
  itemGap: 48,
  containerPadding: 28,
  containerHeader: 36,
};

const ROOT_GROUP = "\u0000root";

export class LayoutAdapterRegistry {
  readonly #adapters = new Map<string, LayoutAdapter>();

  constructor(adapters: Iterable<LayoutAdapter> = []) {
    for (const adapter of adapters) this.register(adapter);
  }

  register(adapter: LayoutAdapter): void {
    if (this.#adapters.has(adapter.layoutRef)) {
      throw new Error(`layoutRef is already registered: ${adapter.layoutRef}`);
    }
    this.#adapters.set(adapter.layoutRef, adapter);
  }

  resolve(layoutRef: string): LayoutAdapterResolution {
    const adapter = this.#adapters.get(layoutRef);
    if (adapter) return { resolved: true, adapter, diagnostics: [] };
    return {
      resolved: false,
      diagnostics: [{
        severity: "error",
        code: "layout-adapter-unresolved",
        message: `layout adapter is not registered: ${layoutRef}`,
        layoutRef,
      }],
    };
  }
}

export function createStandardLayoutRegistry(): LayoutAdapterRegistry {
  return new LayoutAdapterRegistry([
    new StandardLightweightLayoutAdapter(STANDARD_LAYOUT_REFS.hierarchicalLr, "LR"),
    new StandardLightweightLayoutAdapter(STANDARD_LAYOUT_REFS.hierarchicalTb, "TB"),
  ]);
}

/** Resolves exactly the requested adapter. Unknown references never use a default. */
export async function layoutProjectedScene(
  request: LayoutRequest,
  registry: LayoutAdapterRegistry,
): Promise<LayoutResult> {
  const resolution = registry.resolve(request.layoutRef);
  if (!resolution.resolved) return emptyResult(request.layoutRef, resolution.diagnostics);
  try {
    const result = await resolution.adapter.layout(request);
    const completed = completeRegionLayout(request, result);
    const invalid = validateAdapterResult(request, completed);
    return invalid.length > 0
      ? emptyResult(request.layoutRef, [...completed.diagnostics, ...invalid])
      : completed;
  } catch (cause) {
    return emptyResult(request.layoutRef, [{
      severity: "error",
      code: "layout-adapter-failed",
      message: cause instanceof Error ? cause.message : String(cause),
      layoutRef: request.layoutRef,
    }]);
  }
}

/**
 * Completes the adapter result with overlap-region geometry. Regions are not
 * hierarchy parents: each generated region encloses all of its visible
 * members, so a multiply-associated member lies in the geometric intersection.
 * User/pinned region geometry is a hard constraint and is only diagnosed.
 */
export function completeRegionLayout(
  request: LayoutRequest,
  candidate: LayoutResult,
): LayoutResult {
  const regionCandidates = request.scene.elements
    .filter((element) => element.structuralKind === "region")
    .sort((left, right) => compareText(left.elementId, right.elementId));
  if (regionCandidates.length === 0) return candidate;
  const geometries = Object.fromEntries(Object.entries(candidate.geometries).map(([id, geometry]) => [
    id,
    copyGeometry(geometry),
  ]));
  const diagnostics = [...candidate.diagnostics];
  const memberships = [...(request.scene.memberships ?? [])]
    .filter((membership) => membership.regionElementId)
    .sort((left, right) => compareText(left.semanticRef, right.semanticRef));
  const regions = regionCompletionOrder(regionCandidates, memberships);
  const spacing = { ...DEFAULT_SPACING, ...request.spacing };

  for (const region of regions) {
    if (isFixed(region)) {
      if (region.geometry) geometries[region.elementId] = copyGeometry(region.geometry);
      continue;
    }
    const members = memberships
      .filter((membership) => membership.regionElementId === region.elementId)
      .map((membership) => geometries[membership.memberElementId])
      .filter((geometry): geometry is ElementGeometry => geometry !== undefined);
    if (members.length === 0) continue;
    const padding = spacing.containerPadding;
    const header = spacing.containerHeader;
    const left = Math.min(...members.map((geometry) => geometry.x)) - padding;
    const top = Math.min(...members.map((geometry) => geometry.y)) - padding - header;
    const right = Math.max(...members.map((geometry) => geometry.x + geometry.width)) + padding;
    const bottom = Math.max(...members.map((geometry) => geometry.y + geometry.height)) + padding;
    const minimum = region.size ?? region.geometry ?? { width: 240, height: 160 };
    const natural = { x: left, y: top, width: right - left, height: bottom - top };
    const width = Math.max(minimum.width, natural.width);
    const height = Math.max(minimum.height, natural.height);
    geometries[region.elementId] = {
      x: natural.x - (width - natural.width) / 2,
      y: natural.y - (height - natural.height) / 2,
      width,
      height,
    };
  }

  validateRegionMembershipGeometry(request, geometries, memberships, diagnostics);
  const routes = adjustRegionRouteEndpoints(request, candidate.routes, geometries);
  const bounds = sceneBounds(
    Object.values(geometries),
    Object.values(routes).flat(),
    spacing.margin,
  );
  return {
    ...candidate,
    geometries,
    routes,
    width: bounds.width,
    height: bounds.height,
    diagnostics,
  };
}

/** Orders nested regions from member to owner; profile validation rejects cycles. */
function regionCompletionOrder(
  regions: readonly LayoutElement[],
  memberships: readonly LayoutMembership[],
): LayoutElement[] {
  const byId = new Map(regions.map((region) => [region.elementId, region]));
  const dependencies = new Map<string, string[]>();
  for (const membership of memberships) {
    if (!membership.regionElementId || !byId.has(membership.memberElementId)) continue;
    const values = dependencies.get(membership.regionElementId) ?? [];
    values.push(membership.memberElementId);
    dependencies.set(membership.regionElementId, values);
  }
  for (const [regionId, values] of dependencies) {
    dependencies.set(regionId, [...new Set(values)].sort(compareText));
  }
  const ordered: LayoutElement[] = [];
  const visited = new Set<string>();
  const active = new Set<string>();
  const visit = (regionId: string): void => {
    if (visited.has(regionId) || active.has(regionId)) return;
    active.add(regionId);
    for (const dependency of dependencies.get(regionId) ?? []) visit(dependency);
    active.delete(regionId);
    visited.add(regionId);
    ordered.push(byId.get(regionId)!);
  };
  for (const region of regions) visit(region.elementId);
  return ordered;
}

function validateRegionMembershipGeometry(
  request: LayoutRequest,
  geometries: Readonly<Record<string, ElementGeometry>>,
  memberships: readonly LayoutMembership[],
  diagnostics: LayoutDiagnostic[],
): void {
  const byMember = new Map<string, LayoutMembership[]>();
  for (const membership of memberships) {
    if (!membership.regionElementId || !geometries[membership.regionElementId]) {
      diagnostics.push({
        severity: "warning",
        code: "layout-region-membership-unresolved",
        message: `region membership endpoint is not present: ${membership.semanticRef}`,
        layoutRef: request.layoutRef,
        elementId: membership.memberElementId,
      });
      continue;
    }
    const entries = byMember.get(membership.memberElementId) ?? [];
    entries.push(membership);
    byMember.set(membership.memberElementId, entries);
  }
  for (const [memberId, entries] of [...byMember.entries()].sort(([left], [right]) => (
    compareText(left, right)
  ))) {
    const member = geometries[memberId];
    if (!member) continue;
    const regionGeometries = entries.flatMap((entry) => {
      const geometry = entry.regionElementId ? geometries[entry.regionElementId] : undefined;
      return geometry ? [geometry] : [];
    });
    if (regionGeometries.length === 0) continue;
    const intersection = geometryIntersection(regionGeometries);
    if (!intersection) {
      diagnostics.push({
        severity: "warning",
        code: "region-membership-intersection-empty",
        message: `${memberId}が属するregionに共通の交差領域がありません。`,
        layoutRef: request.layoutRef,
        elementId: memberId,
      });
      continue;
    }
    const center = centerOf(member);
    if (!containsPoint(intersection, center)) {
      diagnostics.push({
        severity: "warning",
        code: regionGeometries.length > 1
          ? "region-member-outside-intersection"
          : "region-member-outside",
        message: `${memberId}の中心がmembership region${regionGeometries.length > 1 ? "の交差" : ""}内にありません。`,
        layoutRef: request.layoutRef,
        elementId: memberId,
      });
    }
  }
}

function geometryIntersection(values: readonly ElementGeometry[]): ElementGeometry | undefined {
  const left = Math.max(...values.map((value) => value.x));
  const top = Math.max(...values.map((value) => value.y));
  const right = Math.min(...values.map((value) => value.x + value.width));
  const bottom = Math.min(...values.map((value) => value.y + value.height));
  return right > left && bottom > top
    ? { x: left, y: top, width: right - left, height: bottom - top }
    : undefined;
}

function containsPoint(geometry: ElementGeometry, point: Point): boolean {
  return point.x >= geometry.x
    && point.x <= geometry.x + geometry.width
    && point.y >= geometry.y
    && point.y <= geometry.y + geometry.height;
}

function adjustRegionRouteEndpoints(
  request: LayoutRequest,
  input: Readonly<Record<string, Point[]>>,
  geometries: Readonly<Record<string, ElementGeometry>>,
): Record<string, Point[]> {
  const regions = new Set(request.scene.elements
    .filter((element) => element.structuralKind === "region")
    .map((element) => element.elementId));
  const result = Object.fromEntries(Object.entries(input).map(([id, points]) => [
    id,
    points.map(copyPoint),
  ]));
  for (const edge of request.scene.edges) {
    const points = result[edge.elementId];
    if (!points || points.length < 2) continue;
    const source = geometries[edge.sourceElementId];
    const target = geometries[edge.targetElementId];
    if (source && regions.has(edge.sourceElementId)) {
      points[0] = isValidEdgeEndpointAnchor(edge.sourceAnchor)
        ? edgeEndpointAnchorPoint(source, "region", edge.sourceAnchor)
        : rectangleBoundaryPoint(source, points[1]!);
    }
    if (target && regions.has(edge.targetElementId)) {
      points[points.length - 1] = isValidEdgeEndpointAnchor(edge.targetAnchor)
        ? edgeEndpointAnchorPoint(target, "region", edge.targetAnchor)
        : rectangleBoundaryPoint(target, points.at(-2)!);
    }
  }
  return result;
}

function validateAdapterResult(request: LayoutRequest, result: LayoutResult): LayoutDiagnostic[] {
  const diagnostics: LayoutDiagnostic[] = [];
  if (result.layoutRef !== request.layoutRef) {
    diagnostics.push(invalidResult(request, `result layoutRef does not match: ${result.layoutRef}`));
  }
  if (!isFiniteNonnegative(result.width) || !isFiniteNonnegative(result.height)) {
    diagnostics.push(invalidResult(request, "result bounds must be finite nonnegative numbers"));
  }
  const expectedIds = new Set(request.scene.elements.map((element) => element.elementId));
  const expectedEdgeIds = new Set(request.scene.edges.map((edge) => edge.elementId));
  for (const element of request.scene.elements) {
    const geometry = result.geometries[element.elementId];
    if (!geometry || !isValidGeometry(geometry)) {
      diagnostics.push(invalidResult(request, `geometry is missing or invalid: ${element.elementId}`, element.elementId));
      continue;
    }
    if (isFixed(element) && element.geometry && !sameGeometry(geometry, element.geometry)) {
      diagnostics.push(invalidResult(request, `fixed geometry changed: ${element.elementId}`, element.elementId));
    }
  }
  for (const elementId of Object.keys(result.geometries)) {
    if (!expectedIds.has(elementId)) {
      diagnostics.push(invalidResult(request, `geometry refers to an unknown element: ${elementId}`, elementId));
    }
  }
  for (const edge of request.scene.edges) {
    const points = result.routes[edge.elementId];
    if (!points || points.length < 2) {
      diagnostics.push({
        ...invalidResult(request, `route is missing or has fewer than two points: ${edge.elementId}`),
        edgeId: edge.elementId,
      });
    }
  }
  for (const [edgeId, points] of Object.entries(result.routes)) {
    if (!expectedEdgeIds.has(edgeId)) {
      diagnostics.push({
        ...invalidResult(request, `route refers to an unknown edge: ${edgeId}`),
        edgeId,
      });
    } else if (points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) {
      diagnostics.push({
        ...invalidResult(request, `route contains a non-finite point: ${edgeId}`),
        edgeId,
      });
    }
  }
  return diagnostics;
}

function invalidResult(
  request: LayoutRequest,
  message: string,
  elementId?: string,
): LayoutDiagnostic {
  return {
    severity: "error",
    code: "layout-result-invalid",
    message,
    layoutRef: request.layoutRef,
    elementId,
  };
}

function isValidGeometry(value: ElementGeometry): boolean {
  return Number.isFinite(value.x)
    && Number.isFinite(value.y)
    && Number.isFinite(value.width)
    && Number.isFinite(value.height)
    && value.width > 0
    && value.height > 0;
}

function isFiniteNonnegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function sameGeometry(left: ElementGeometry, right: ElementGeometry): boolean {
  return left.x === right.x
    && left.y === right.y
    && left.width === right.width
    && left.height === right.height;
}

export class StandardLightweightLayoutAdapter implements LayoutAdapter {
  constructor(
    readonly layoutRef: string,
    readonly direction: LayoutDirection,
  ) {}

  async layout(request: LayoutRequest): Promise<LayoutResult> {
    if (request.layoutRef !== this.layoutRef) {
      return emptyResult(request.layoutRef, [{
        severity: "error",
        code: "layout-adapter-ref-mismatch",
        message: `adapter ${this.layoutRef} cannot handle ${request.layoutRef}`,
        layoutRef: request.layoutRef,
      }]);
    }
    return runStandardLayout(request, this.direction);
  }
}

type LayoutState = {
  request: LayoutRequest;
  direction: LayoutDirection;
  spacing: LayoutSpacing;
  elements: Map<string, LayoutElement>;
  edges: LayoutEdge[];
  parents: Map<string, string>;
  children: Map<string, string[]>;
  measured: Map<string, { width: number; height: number }>;
  geometries: Record<string, ElementGeometry>;
  diagnostics: LayoutDiagnostic[];
};

function runStandardLayout(request: LayoutRequest, direction: LayoutDirection): LayoutResult {
  const diagnostics: LayoutDiagnostic[] = [];
  const elements = indexElements(request.scene.elements, request.layoutRef, diagnostics);
  if (diagnostics.some((item) => item.severity === "error")) {
    return emptyResult(request.layoutRef, diagnostics);
  }
  const edges = [...request.scene.edges].sort(compareEdge);
  const parents = resolveParents(elements, request.layoutRef, diagnostics);
  const state: LayoutState = {
    request,
    direction,
    spacing: { ...DEFAULT_SPACING, ...request.spacing },
    elements,
    edges,
    parents,
    children: childrenByParent(elements, parents),
    measured: new Map(),
    geometries: {},
    diagnostics,
  };

  for (const id of state.children.get(ROOT_GROUP) ?? []) measureElement(id, state);
  placeGroup(ROOT_GROUP, { x: state.spacing.margin, y: state.spacing.margin }, state);
  const routes = routeEdges(state);
  const bounds = sceneBounds(
    layoutBounds(state),
    Object.values(routes).flat(),
    state.spacing.margin,
  );

  return {
    layoutRef: request.layoutRef,
    geometries: state.geometries,
    routes,
    width: bounds.width,
    height: bounds.height,
    diagnostics,
  };
}

function indexElements(
  input: readonly LayoutElement[],
  layoutRef: string,
  diagnostics: LayoutDiagnostic[],
): Map<string, LayoutElement> {
  const result = new Map<string, LayoutElement>();
  for (const element of [...input].sort((left, right) => compareText(left.elementId, right.elementId))) {
    if (result.has(element.elementId)) {
      diagnostics.push({
        severity: "error",
        code: "layout-duplicate-element-id",
        message: `duplicate elementId: ${element.elementId}`,
        layoutRef,
        elementId: element.elementId,
      });
    } else {
      result.set(element.elementId, element);
    }
  }
  return result;
}

function resolveParents(
  elements: Map<string, LayoutElement>,
  layoutRef: string,
  diagnostics: LayoutDiagnostic[],
): Map<string, string> {
  const result = new Map<string, string>();
  for (const element of elements.values()) {
    if (!element.parentElementId) continue;
    const parent = elements.get(element.parentElementId);
    if (!parent || parent.structuralKind !== "container") {
      diagnostics.push({
        severity: "warning",
        code: "layout-parent-invalid",
        message: `parent is missing or is not a container: ${element.parentElementId}`,
        layoutRef,
        elementId: element.elementId,
      });
      continue;
    }
    result.set(element.elementId, parent.elementId);
  }

  // Break each containment cycle at its smallest identity. This preserves a
  // deterministic forest even for an invalid projected input.
  for (;;) {
    const cycle = findParentCycle([...elements.keys()].sort(compareText), result);
    if (!cycle) break;
    const cut = [...cycle].sort(compareText)[0]!;
    result.delete(cut);
    diagnostics.push({
      severity: "warning",
      code: "layout-containment-cycle",
      message: `containment cycle was cut at ${cut}`,
      layoutRef,
      elementId: cut,
    });
  }
  return result;
}

function findParentCycle(ids: string[], parents: Map<string, string>): string[] | undefined {
  for (const start of ids) {
    const path: string[] = [];
    const index = new Map<string, number>();
    let current: string | undefined = start;
    while (current !== undefined) {
      const at = index.get(current);
      if (at !== undefined) return path.slice(at);
      index.set(current, path.length);
      path.push(current);
      current = parents.get(current);
    }
  }
  return undefined;
}

function childrenByParent(
  elements: Map<string, LayoutElement>,
  parents: Map<string, string>,
): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const id of elements.keys()) {
    const parent = parents.get(id) ?? ROOT_GROUP;
    const children = result.get(parent) ?? [];
    children.push(id);
    result.set(parent, children);
  }
  for (const children of result.values()) children.sort(compareText);
  return result;
}

function measureElement(elementId: string, state: LayoutState): { width: number; height: number } {
  const cached = state.measured.get(elementId);
  if (cached) return cached;
  const element = state.elements.get(elementId)!;
  const explicit = element.size ?? element.geometry;
  let size = explicit
    ? { width: explicit.width, height: explicit.height }
    : element.structuralKind === "container"
      ? { width: 360, height: 180 }
      : { width: 160, height: 72 };

  if (element.structuralKind === "container") {
    const childIds = state.children.get(elementId) ?? [];
    if (childIds.length > 0) {
      for (const childId of childIds) measureElement(childId, state);
      const natural = naturalGroupLayout(elementId, state).bounds;
      const insets = elementContentInsets(element, state);
      size = {
        width: Math.max(size.width, natural.width + insets.left + insets.right),
        height: Math.max(size.height, natural.height + insets.top + insets.bottom),
      };
    }
  }
  state.measured.set(elementId, size);
  return size;
}

function placeGroup(groupId: string, origin: Point, state: LayoutState): void {
  const layout = naturalGroupLayout(groupId, state);
  const occupied: ElementGeometry[] = [];
  const children = state.children.get(groupId) ?? [];

  for (const childId of children) {
    const element = state.elements.get(childId)!;
    if (isFixed(element) && element.geometry) {
      occupied.push(layoutElementFootprintGeometry(element, element.geometry));
    }
  }
  for (const childId of children) {
    const element = state.elements.get(childId)!;
    const natural = layout.placements.get(childId)!;
    let geometry: ElementGeometry;
    if (isFixed(element) && element.geometry) {
      geometry = copyGeometry(element.geometry);
    } else {
      if (isFixed(element)) {
        state.diagnostics.push({
          severity: "error",
          code: "layout-fixed-geometry-missing",
          message: `fixed element has no geometry: ${childId}`,
          layoutRef: state.request.layoutRef,
          elementId: childId,
        });
      }
      const visualSize = state.measured.get(childId)!;
      const relativeFootprint = layoutElementFootprintGeometry(element, {
        x: 0,
        y: 0,
        width: visualSize.width,
        height: visualSize.height,
      });
      const footprint = avoidOccupiedGeometry({
        x: origin.x + natural.x,
        y: origin.y + natural.y,
        width: natural.width,
        height: natural.height,
      }, occupied, state.direction, state.spacing.itemGap);
      geometry = {
        x: footprint.x - relativeFootprint.x,
        y: footprint.y - relativeFootprint.y,
        width: visualSize.width,
        height: visualSize.height,
      };
      occupied.push(layoutElementFootprintGeometry(element, geometry));
    }
    state.geometries[childId] = geometry;

    if (element.structuralKind === "container") {
      const insets = elementContentInsets(element, state);
      placeGroup(childId, {
        x: geometry.x + insets.left,
        y: geometry.y + insets.top,
      }, state);
      if (!isFixed(element)) expandGeneratedContainer(childId, state);
    }
  }
}

function naturalGroupLayout(
  groupId: string,
  state: LayoutState,
): { placements: Map<string, ElementGeometry>; bounds: { width: number; height: number } } {
  const ids = state.children.get(groupId) ?? [];
  const ranks = hierarchicalRanks(ids, groupId, state);
  const byRank = new Map<number, string[]>();
  for (const id of ids) {
    const rank = ranks.get(id) ?? 0;
    const members = byRank.get(rank) ?? [];
    members.push(id);
    byRank.set(rank, members);
  }
  for (const members of byRank.values()) members.sort(compareText);

  const placements = new Map<string, ElementGeometry>();
  let primary = 0;
  let maxCross = 0;
  for (const rank of [...byRank.keys()].sort((left, right) => left - right)) {
    const members = byRank.get(rank)!;
    const rankPrimary = Math.max(...members.map((id) => (
      primarySize(elementLayoutSize(id, state), state.direction)
    )));
    let cross = 0;
    for (const id of members) {
      const size = elementLayoutSize(id, state);
      const geometry = state.direction === "LR"
        ? { x: primary, y: cross, width: size.width, height: size.height }
        : { x: cross, y: primary, width: size.width, height: size.height };
      placements.set(id, geometry);
      cross += crossSize(size, state.direction) + state.spacing.itemGap;
    }
    maxCross = Math.max(maxCross, Math.max(0, cross - state.spacing.itemGap));
    primary += rankPrimary + state.spacing.rankGap;
  }
  const primaryExtent = Math.max(0, primary - state.spacing.rankGap);
  return {
    placements,
    bounds: state.direction === "LR"
      ? { width: primaryExtent, height: maxCross }
      : { width: maxCross, height: primaryExtent },
  };
}

function elementLayoutSize(
  elementId: string,
  state: LayoutState,
): { width: number; height: number } {
  const measured = state.measured.get(elementId)!;
  const footprint = layoutElementFootprintGeometry(state.elements.get(elementId)!, {
    x: 0,
    y: 0,
    width: measured.width,
    height: measured.height,
  });
  return { width: footprint.width, height: footprint.height };
}

function hierarchicalRanks(ids: string[], groupId: string, state: LayoutState): Map<string, number> {
  const idSet = new Set(ids);
  const pairs = new Set<string>();
  for (const edge of state.edges) {
    const source = immediateChildInGroup(edge.sourceElementId, groupId, state.parents);
    const target = immediateChildInGroup(edge.targetElementId, groupId, state.parents);
    if (source && target && source !== target && idSet.has(source) && idSet.has(target)) {
      pairs.add(`${source}\u0000${target}`);
    }
  }
  const adjacency = new Map(ids.map((id) => [id, [] as string[]]));
  for (const pair of [...pairs].sort(compareText)) {
    const [source, target] = pair.split("\u0000") as [string, string];
    adjacency.get(source)!.push(target);
  }
  const components = stronglyConnectedComponents(ids, adjacency);
  const componentById = new Map<string, number>();
  components.forEach((component, index) => component.forEach((id) => componentById.set(id, index)));
  const componentKeys = components.map((component) => component[0]!);
  const outgoing = new Map(components.map((_, index) => [index, new Set<number>()]));
  const indegree = new Map(components.map((_, index) => [index, 0]));
  for (const [source, targets] of adjacency) {
    for (const target of targets) {
      const from = componentById.get(source)!;
      const to = componentById.get(target)!;
      if (from === to || outgoing.get(from)!.has(to)) continue;
      outgoing.get(from)!.add(to);
      indegree.set(to, indegree.get(to)! + 1);
    }
  }
  const ranks = new Map(components.map((_, index) => [index, 0]));
  const ready = [...indegree.entries()]
    .filter(([, count]) => count === 0)
    .map(([index]) => index)
    .sort((left, right) => compareText(componentKeys[left]!, componentKeys[right]!));
  while (ready.length > 0) {
    const current = ready.shift()!;
    const targets = [...outgoing.get(current)!]
      .sort((left, right) => compareText(componentKeys[left]!, componentKeys[right]!));
    for (const target of targets) {
      ranks.set(target, Math.max(ranks.get(target)!, ranks.get(current)! + 1));
      indegree.set(target, indegree.get(target)! - 1);
      if (indegree.get(target) === 0) {
        ready.push(target);
        ready.sort((left, right) => compareText(componentKeys[left]!, componentKeys[right]!));
      }
    }
  }
  return new Map(ids.map((id) => [id, ranks.get(componentById.get(id)!)!]));
}

function stronglyConnectedComponents(ids: string[], adjacency: Map<string, string[]>): string[][] {
  let nextIndex = 0;
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const components: string[][] = [];

  const visit = (id: string): void => {
    index.set(id, nextIndex);
    low.set(id, nextIndex++);
    stack.push(id);
    onStack.add(id);
    for (const target of adjacency.get(id) ?? []) {
      if (!index.has(target)) {
        visit(target);
        low.set(id, Math.min(low.get(id)!, low.get(target)!));
      } else if (onStack.has(target)) {
        low.set(id, Math.min(low.get(id)!, index.get(target)!));
      }
    }
    if (low.get(id) !== index.get(id)) return;
    const component: string[] = [];
    let member: string;
    do {
      member = stack.pop()!;
      onStack.delete(member);
      component.push(member);
    } while (member !== id);
    components.push(component.sort(compareText));
  };

  for (const id of [...ids].sort(compareText)) if (!index.has(id)) visit(id);
  return components.sort((left, right) => compareText(left[0]!, right[0]!));
}

function immediateChildInGroup(
  elementId: string,
  groupId: string,
  parents: Map<string, string>,
): string | undefined {
  let current = elementId;
  for (;;) {
    const parent = parents.get(current);
    if ((parent ?? ROOT_GROUP) === groupId) return current;
    if (!parent) return undefined;
    current = parent;
  }
}

function expandGeneratedContainer(containerId: string, state: LayoutState): void {
  const geometry = state.geometries[containerId]!;
  const element = state.elements.get(containerId)!;
  const insets = elementContentInsets(element, state);
  const childGeometries = (state.children.get(containerId) ?? [])
    .map((id) => {
      const geometry = state.geometries[id];
      const child = state.elements.get(id);
      return geometry && child ? layoutElementFootprintGeometry(child, geometry) : undefined;
    })
    .filter((value): value is ElementGeometry => value !== undefined);
  if (childGeometries.length === 0) return;
  const left = Math.min(geometry.x, ...childGeometries.map((item) => item.x - insets.left));
  const top = Math.min(
    geometry.y,
    ...childGeometries.map((item) => item.y - insets.top),
  );
  const right = Math.max(
    geometry.x + geometry.width,
    ...childGeometries.map((item) => item.x + item.width + insets.right),
  );
  const bottom = Math.max(
    geometry.y + geometry.height,
    ...childGeometries.map((item) => item.y + item.height + insets.bottom),
  );
  state.geometries[containerId] = {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  };
}

function elementContentInsets(
  element: LayoutElement,
  state: LayoutState,
): ContainerContentInsets {
  return element.contentInsets ?? {
    top: state.spacing.containerHeader + state.spacing.containerPadding,
    right: state.spacing.containerPadding,
    bottom: state.spacing.containerPadding,
    left: state.spacing.containerPadding,
  };
}

const PARALLEL_LANE_GAP = 20;
const SELF_LOOP_BASE = 36;
const SELF_LOOP_GAP = 18;
const ROUTE_OBSTACLE_PADDING = 10;
const ROUTE_GRID_OBSTACLE_LIMIT = 24;
const ROUTE_GRID_COMMITTED_LIMIT = 16;
const ROUTE_GRID_ELEMENT_LIMIT = 256;
const ROUTE_GRID_EDGE_LIMIT = 512;

function routeEdges(state: LayoutState): Record<string, Point[]> {
  const routes: Record<string, Point[]> = {};
  const bundles = edgeBundles(state.edges);
  for (const edges of bundles.values()) {
    const first = edges[0]!;
    if (first.sourceElementId === first.targetElementId) {
      routeSelfLoopBundle(edges, state, routes);
      continue;
    }
    const [canonicalSourceId, canonicalTargetId] = canonicalEndpointPair(first);
    const canonicalSource = state.geometries[canonicalSourceId];
    const canonicalTarget = state.geometries[canonicalTargetId];
    if (!canonicalSource || !canonicalTarget) {
      for (const edge of edges) reportMissingEndpoint(edge, state);
      continue;
    }
    const laneOffsets = parallelLaneOffsets(
      edges.length,
      canonicalSource,
      canonicalTarget,
      state.direction,
    );
    edges.forEach((edge, index) => {
      const source = state.geometries[edge.sourceElementId];
      const target = state.geometries[edge.targetElementId];
      if (!source || !target) {
        reportMissingEndpoint(edge, state);
        return;
      }
      const manual = manualWaypoints(edge);
      if (manual) {
        routes[edge.elementId] = applyEndpointAnchors(
          manualRoute(source, target, manual, false),
          edge,
          source,
          target,
          state,
        );
        return;
      }
      if (edge.routeMode === "straight") {
        routes[edge.elementId] = applyEndpointAnchors(
          directRoute(edge, source, target, state),
          edge,
          source,
          target,
          state,
        );
        return;
      }
      const canonicalRoute = orthogonalRoute(
        canonicalSource,
        canonicalTarget,
        state.direction,
        laneOffsets[index]!,
      );
      const route = edge.sourceElementId === canonicalSourceId
        ? canonicalRoute
        : [...canonicalRoute].reverse().map(copyPoint);
      routes[edge.elementId] = applyEndpointAnchors(route, edge, source, target, state);
    });
  }
  return improveDerivedRoutes(routes, state);
}

function directRoute(
  edge: LayoutEdge,
  source: ElementGeometry,
  target: ElementGeometry,
  state: LayoutState,
): Point[] {
  const sourceToward = centerOf(target);
  const targetToward = centerOf(source);
  return [
    edgeEndpointAnchorPoint(
      source,
      layoutElementShape(state.elements.get(edge.sourceElementId)),
      edgeEndpointAnchorFromPoint(source, sourceToward),
    ),
    edgeEndpointAnchorPoint(
      target,
      layoutElementShape(state.elements.get(edge.targetElementId)),
      edgeEndpointAnchorFromPoint(target, targetToward),
    ),
  ];
}

type RoutedEdge = {
  edge: LayoutEdge;
  points: Point[];
};

type RouteCost = readonly [
  obstacleIntersections: number,
  overlapLength: number,
  crossings: number,
  bends: number,
  length: number,
];

type RouteSearchCost = readonly [
  overlapLength: number,
  crossings: number,
  bends: number,
  length: number,
];

type GridSearchEntry = {
  pointIndex: number;
  direction: 0 | 1 | 2;
  cost: RouteSearchCost;
  signature: string;
};

/**
 * Improves renderer-only routes without creating or changing persisted manual
 * waypoints. This bounded, dependency-free visibility grid keeps the Core
 * adapter usable as a portable fallback; hosts can still replace the complete
 * adapter when they need a higher-budget engine. It is deliberately a
 * post-layout step, so pinned and user-positioned nodes remain hard constraints.
 */
function improveDerivedRoutes(
  input: Record<string, Point[]>,
  state: LayoutState,
): Record<string, Point[]> {
  const routes = Object.fromEntries(Object.entries(input).map(([id, points]) => [
    id,
    points.map(copyPoint),
  ]));
  if (
    state.elements.size > ROUTE_GRID_ELEMENT_LIMIT
    || state.edges.length > ROUTE_GRID_EDGE_LIMIT
  ) return routes;

  const committed: RoutedEdge[] = [];
  for (const edge of state.edges) {
    const base = routes[edge.elementId];
    if (edge.routeMode === "straight") {
      if (base) committed.push({ edge, points: base });
      continue;
    }
    if (!base || base.length < 2 || edge.sourceElementId === edge.targetElementId) {
      if (base) committed.push({ edge, points: base });
      continue;
    }
    const obstacles = routeObstacles(edge, state);
    const baseCost = routeCost(base, obstacles, committed);
    const manual = edge.routingPlacement === "user" && Boolean(edge.waypoints?.length);
    if (
      baseCost[0] === 0
      && (manual || (baseCost[1] === 0 && baseCost[2] === 0))
    ) {
      committed.push({ edge, points: base });
      continue;
    }

    const gates = routeGates(edge, base);
    const candidate = routeThroughGates(gates, base, obstacles, committed);
    if (candidate) {
      const candidateCost = routeCost(candidate, obstacles, committed);
      if (
        (baseCost[0] === 0 || candidateCost[0] === 0)
        && compareRouteCandidate(candidateCost, candidate, baseCost, base) < 0
      ) {
        routes[edge.elementId] = candidate;
      }
    }
    committed.push({ edge, points: routes[edge.elementId]! });
  }
  return routes;
}

function routeObstacles(edge: LayoutEdge, state: LayoutState): ElementGeometry[] {
  const result: ElementGeometry[] = [];
  for (const element of [...state.elements.values()].sort(compareElement)) {
    if (element.structuralKind !== "node" && element.structuralKind !== "annotation") continue;
    const geometry = state.geometries[element.elementId];
    if (!geometry) continue;
    if (element.elementId !== edge.sourceElementId && element.elementId !== edge.targetElementId) {
      result.push(expandGeometry(geometry, ROUTE_OBSTACLE_PADDING));
    }
    for (const reservation of layoutExternalReservationGeometries(element, geometry)) {
      result.push(expandGeometry(reservation, ROUTE_OBSTACLE_PADDING));
    }
  }
  return result;
}

function routeGates(edge: LayoutEdge, base: readonly Point[]): Point[] {
  const start = base[0];
  const end = base.at(-1);
  if (!start || !end) return [];
  const manual = edge.routingPlacement === "user" && edge.waypoints?.length
    ? edge.waypoints.map(copyPoint)
    : [];
  return [copyPoint(start), ...manual, copyPoint(end)];
}

function routeThroughGates(
  gates: readonly Point[],
  base: readonly Point[],
  allObstacles: readonly ElementGeometry[],
  committed: readonly RoutedEdge[],
): Point[] | undefined {
  if (gates.length < 2) return undefined;
  const relevant = relevantRouteObstacles(gates, base, allObstacles);
  const route: Point[] = [];
  for (let index = 0; index < gates.length - 1; index += 1) {
    const start = gates[index];
    const end = gates[index + 1];
    if (!start || !end) return undefined;
    const segmentRoute = rectilinearVisibilityRoute(
      start,
      end,
      relevant,
      committed,
      base,
    );
    if (!segmentRoute) return undefined;
    appendConnectedRoute(route, segmentRoute);
  }
  return route;
}

function relevantRouteObstacles(
  gates: readonly Point[],
  base: readonly Point[],
  obstacles: readonly ElementGeometry[],
): ElementGeometry[] {
  if (obstacles.length <= ROUTE_GRID_OBSTACLE_LIMIT) return obstacles.map(copyGeometry);
  const routeBounds = pointBounds([...gates, ...base]);
  const colliding = obstacles.filter((obstacle) => polylineIntersectsGeometry(base, obstacle));
  const remaining = obstacles
    .filter((obstacle) => !colliding.includes(obstacle))
    .sort((left, right) => (
      geometryDistanceToBounds(left, routeBounds) - geometryDistanceToBounds(right, routeBounds)
      || compareGeometry(left, right)
    ));
  return [...colliding, ...remaining]
    .slice(0, ROUTE_GRID_OBSTACLE_LIMIT)
    .map(copyGeometry);
}

function rectilinearVisibilityRoute(
  start: Point,
  end: Point,
  obstacles: readonly ElementGeometry[],
  committed: readonly RoutedEdge[],
  base: readonly Point[],
): Point[] | undefined {
  if (samePoint(start, end)) return [copyPoint(start), copyPoint(end)];
  if (obstacles.some((obstacle) => pointInsideGeometry(start, obstacle))) return undefined;
  if (obstacles.some((obstacle) => pointInsideGeometry(end, obstacle))) return undefined;

  const xValues = new Set<number>([start.x, end.x]);
  const yValues = new Set<number>([start.y, end.y]);
  for (const point of base) {
    xValues.add(point.x);
    yValues.add(point.y);
  }
  for (const obstacle of obstacles) {
    xValues.add(obstacle.x);
    xValues.add(obstacle.x + obstacle.width);
    yValues.add(obstacle.y);
    yValues.add(obstacle.y + obstacle.height);
  }
  // Add a bounded set of already-routed coordinates to the visibility grid.
  // Crossing penalties cannot influence Dijkstra when there is no grid line on
  // which a route can turn before or after an existing segment.
  for (const routed of relevantCommittedRoutes(base, committed)) {
    for (const point of routed.points) {
      xValues.add(point.x);
      yValues.add(point.y);
    }
  }
  const initialXs = [...xValues];
  const initialYs = [...yValues];
  const outsideGap = ROUTE_OBSTACLE_PADDING * 2;
  const minimumX = Math.min(...initialXs);
  const minimumY = Math.min(...initialYs);
  xValues.add(minimumX >= 0 ? Math.max(0, minimumX - outsideGap) : minimumX - outsideGap);
  xValues.add(Math.max(...initialXs) + outsideGap);
  yValues.add(minimumY >= 0 ? Math.max(0, minimumY - outsideGap) : minimumY - outsideGap);
  yValues.add(Math.max(...initialYs) + outsideGap);
  const xs = [...xValues].sort((left, right) => left - right);
  const ys = [...yValues].sort((left, right) => left - right);
  const points: Point[] = [];
  const pointIndexByGrid = new Map<string, number>();
  for (let yIndex = 0; yIndex < ys.length; yIndex += 1) {
    for (let xIndex = 0; xIndex < xs.length; xIndex += 1) {
      const point = { x: xs[xIndex]!, y: ys[yIndex]! };
      if (obstacles.some((obstacle) => pointInsideGeometry(point, obstacle))) continue;
      const pointIndex = points.length;
      points.push(point);
      pointIndexByGrid.set(gridKey(xIndex, yIndex), pointIndex);
    }
  }
  const startIndex = pointIndexByGrid.get(gridKey(xs.indexOf(start.x), ys.indexOf(start.y)));
  const endIndex = pointIndexByGrid.get(gridKey(xs.indexOf(end.x), ys.indexOf(end.y)));
  if (startIndex === undefined || endIndex === undefined) return undefined;

  const queue = new MinRouteQueue();
  const distances = new Map<string, { cost: RouteSearchCost; signature: string }>();
  const previous = new Map<string, string>();
  const startState = searchStateKey(startIndex, 0);
  const zero: RouteSearchCost = [0, 0, 0, 0];
  distances.set(startState, { cost: zero, signature: pointSignature(start) });
  queue.push({ pointIndex: startIndex, direction: 0, cost: zero, signature: pointSignature(start) });
  let completedState: string | undefined;

  while (queue.size > 0) {
    const current = queue.pop()!;
    const currentState = searchStateKey(current.pointIndex, current.direction);
    const known = distances.get(currentState);
    if (!known || compareSearchCandidate(current.cost, current.signature, known.cost, known.signature) !== 0) {
      continue;
    }
    if (current.pointIndex === endIndex) {
      completedState = currentState;
      break;
    }
    const point = points[current.pointIndex]!;
    const xIndex = binaryIndex(xs, point.x);
    const yIndex = binaryIndex(ys, point.y);
    const neighbors: Array<{ pointIndex: number; direction: 1 | 2 }> = [];
    for (const [nextX, nextY, direction] of [
      [xIndex - 1, yIndex, 1],
      [xIndex + 1, yIndex, 1],
      [xIndex, yIndex - 1, 2],
      [xIndex, yIndex + 1, 2],
    ] as const) {
      const neighborIndex = pointIndexByGrid.get(gridKey(nextX, nextY));
      if (neighborIndex === undefined) continue;
      const neighbor = points[neighborIndex]!;
      if (segmentIntersectsAnyGeometry(point, neighbor, obstacles)) continue;
      neighbors.push({ pointIndex: neighborIndex, direction });
    }
    neighbors.sort((left, right) => comparePoint(points[left.pointIndex]!, points[right.pointIndex]!));

    for (const neighbor of neighbors) {
      const target = points[neighbor.pointIndex]!;
      const interaction = segmentInteraction(point, target, committed, true);
      const nextCost: RouteSearchCost = [
        current.cost[0] + interaction.overlapLength,
        current.cost[1] + interaction.crossings,
        current.cost[2] + (current.direction !== 0 && current.direction !== neighbor.direction ? 1 : 0),
        current.cost[3] + pointDistance(point, target),
      ];
      const nextSignature = `${current.signature}>${pointSignature(target)}`;
      const nextState = searchStateKey(neighbor.pointIndex, neighbor.direction);
      const previousBest = distances.get(nextState);
      if (
        previousBest
        && compareSearchCandidate(nextCost, nextSignature, previousBest.cost, previousBest.signature) >= 0
      ) continue;
      distances.set(nextState, { cost: nextCost, signature: nextSignature });
      previous.set(nextState, currentState);
      queue.push({
        pointIndex: neighbor.pointIndex,
        direction: neighbor.direction,
        cost: nextCost,
        signature: nextSignature,
      });
    }
  }
  if (!completedState) return undefined;

  const reversed: Point[] = [];
  let stateKey: string | undefined = completedState;
  while (stateKey) {
    const [pointIndexText] = stateKey.split(":");
    const point = points[Number(pointIndexText)];
    if (!point) return undefined;
    reversed.push(copyPoint(point));
    stateKey = previous.get(stateKey);
  }
  return simplifyOrthogonalRoute(reversed.reverse());
}

function relevantCommittedRoutes(
  base: readonly Point[],
  committed: readonly RoutedEdge[],
): RoutedEdge[] {
  if (committed.length <= ROUTE_GRID_COMMITTED_LIMIT) return [...committed];
  const baseBounds = pointBounds(base);
  return [...committed]
    .sort((left, right) => (
      geometryDistanceToBounds(pointBounds(left.points), baseBounds)
      - geometryDistanceToBounds(pointBounds(right.points), baseBounds)
      || compareText(left.edge.elementId, right.edge.elementId)
    ))
    .slice(0, ROUTE_GRID_COMMITTED_LIMIT);
}

class MinRouteQueue {
  readonly #items: GridSearchEntry[] = [];

  get size(): number {
    return this.#items.length;
  }

  push(entry: GridSearchEntry): void {
    this.#items.push(entry);
    let index = this.#items.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (compareGridEntry(this.#items[parent]!, this.#items[index]!) <= 0) break;
      [this.#items[parent], this.#items[index]] = [this.#items[index]!, this.#items[parent]!];
      index = parent;
    }
  }

  pop(): GridSearchEntry | undefined {
    const first = this.#items[0];
    const last = this.#items.pop();
    if (!first || !last || this.#items.length === 0) return first;
    this.#items[0] = last;
    let index = 0;
    for (;;) {
      const left = index * 2 + 1;
      const right = left + 1;
      let smallest = index;
      if (left < this.#items.length && compareGridEntry(this.#items[left]!, this.#items[smallest]!) < 0) {
        smallest = left;
      }
      if (right < this.#items.length && compareGridEntry(this.#items[right]!, this.#items[smallest]!) < 0) {
        smallest = right;
      }
      if (smallest === index) break;
      [this.#items[index], this.#items[smallest]] = [this.#items[smallest]!, this.#items[index]!];
      index = smallest;
    }
    return first;
  }
}

function routeCost(
  route: readonly Point[],
  obstacles: readonly ElementGeometry[],
  committed: readonly RoutedEdge[],
): RouteCost {
  let obstacleIntersections = 0;
  let overlapLength = 0;
  let crossings = 0;
  for (let index = 0; index < route.length - 1; index += 1) {
    const start = route[index]!;
    const end = route[index + 1]!;
    obstacleIntersections += obstacles.filter((obstacle) => (
      segmentIntersectsGeometry(start, end, obstacle)
    )).length;
    const interaction = segmentInteraction(start, end, committed);
    overlapLength += interaction.overlapLength;
    crossings += interaction.crossings;
  }
  return [
    obstacleIntersections,
    overlapLength,
    crossings,
    routeBends(route),
    routeLength(route),
  ];
}

function segmentInteraction(
  start: Point,
  end: Point,
  committed: readonly RoutedEdge[],
  includeCandidateEndpoints = false,
): { overlapLength: number; crossings: number } {
  let overlapLength = 0;
  let crossings = 0;
  for (const routed of committed) {
    for (let index = 0; index < routed.points.length - 1; index += 1) {
      const otherStart = routed.points[index]!;
      const otherEnd = routed.points[index + 1]!;
      overlapLength += collinearOverlapLength(start, end, otherStart, otherEnd);
      if (
        includeCandidateEndpoints
          ? candidateSegmentCrossesRoute(start, end, otherStart, otherEnd)
          : segmentsCrossStrictly(start, end, otherStart, otherEnd)
      ) crossings += 1;
    }
  }
  return { overlapLength, crossings };
}

function candidateSegmentCrossesRoute(
  candidateStart: Point,
  candidateEnd: Point,
  routeStart: Point,
  routeEnd: Point,
): boolean {
  const candidateDx = candidateEnd.x - candidateStart.x;
  const candidateDy = candidateEnd.y - candidateStart.y;
  const routeDx = routeEnd.x - routeStart.x;
  const routeDy = routeEnd.y - routeStart.y;
  const denominator = candidateDx * routeDy - candidateDy * routeDx;
  if (denominator === 0) return false;
  const offsetX = routeStart.x - candidateStart.x;
  const offsetY = routeStart.y - candidateStart.y;
  const candidateRatio = (offsetX * routeDy - offsetY * routeDx) / denominator;
  const routeRatio = (offsetX * candidateDy - offsetY * candidateDx) / denominator;
  return candidateRatio >= 0 && candidateRatio <= 1 && routeRatio > 0 && routeRatio < 1;
}

function compareRouteCandidate(
  leftCost: RouteCost,
  leftRoute: readonly Point[],
  rightCost: RouteCost,
  rightRoute: readonly Point[],
): number {
  return compareNumberTuples(leftCost, rightCost)
    || compareText(routeSignature(leftRoute), routeSignature(rightRoute));
}

function compareSearchCandidate(
  leftCost: RouteSearchCost,
  leftSignature: string,
  rightCost: RouteSearchCost,
  rightSignature: string,
): number {
  return compareNumberTuples(leftCost, rightCost) || compareText(leftSignature, rightSignature);
}

function compareGridEntry(left: GridSearchEntry, right: GridSearchEntry): number {
  return compareSearchCandidate(left.cost, left.signature, right.cost, right.signature)
    || left.pointIndex - right.pointIndex
    || left.direction - right.direction;
}

function compareNumberTuples(left: readonly number[], right: readonly number[]): number {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function appendConnectedRoute(target: Point[], input: readonly Point[]): void {
  if (target.length === 0) {
    target.push(...input.map(copyPoint));
    return;
  }
  const offset = samePoint(target.at(-1)!, input[0]!) ? 1 : 0;
  target.push(...input.slice(offset).map(copyPoint));
}

function simplifyOrthogonalRoute(route: readonly Point[]): Point[] {
  const result: Point[] = [];
  for (const point of route) {
    if (result.length > 0 && samePoint(result.at(-1)!, point)) continue;
    while (result.length >= 2 && collinear(result.at(-2)!, result.at(-1)!, point)) {
      result.pop();
    }
    result.push(copyPoint(point));
  }
  return result;
}

function routeBends(route: readonly Point[]): number {
  let bends = 0;
  for (let index = 1; index < route.length - 1; index += 1) {
    if (!collinear(route[index - 1]!, route[index]!, route[index + 1]!)) bends += 1;
  }
  return bends;
}

function routeLength(route: readonly Point[]): number {
  let length = 0;
  for (let index = 0; index < route.length - 1; index += 1) {
    length += pointDistance(route[index]!, route[index + 1]!);
  }
  return length;
}

function polylineIntersectsGeometry(
  route: readonly Point[],
  geometry: ElementGeometry,
): boolean {
  for (let index = 0; index < route.length - 1; index += 1) {
    if (segmentIntersectsGeometry(route[index]!, route[index + 1]!, geometry)) return true;
  }
  return false;
}

function segmentIntersectsAnyGeometry(
  start: Point,
  end: Point,
  geometries: readonly ElementGeometry[],
): boolean {
  return geometries.some((geometry) => segmentIntersectsGeometry(start, end, geometry));
}

function segmentIntersectsGeometry(
  start: Point,
  end: Point,
  geometry: ElementGeometry,
): boolean {
  const left = geometry.x;
  const right = geometry.x + geometry.width;
  const top = geometry.y;
  const bottom = geometry.y + geometry.height;
  if (start.x === end.x) {
    return start.x > left && start.x < right
      && Math.max(Math.min(start.y, end.y), top) < Math.min(Math.max(start.y, end.y), bottom);
  }
  if (start.y === end.y) {
    return start.y > top && start.y < bottom
      && Math.max(Math.min(start.x, end.x), left) < Math.min(Math.max(start.x, end.x), right);
  }
  return segmentIntersectsRectangleInterior(start, end, geometry);
}

function segmentIntersectsRectangleInterior(
  start: Point,
  end: Point,
  geometry: ElementGeometry,
): boolean {
  const xInterval = segmentAxisInteriorInterval(
    start.x,
    end.x,
    geometry.x,
    geometry.x + geometry.width,
  );
  const yInterval = segmentAxisInteriorInterval(
    start.y,
    end.y,
    geometry.y,
    geometry.y + geometry.height,
  );
  if (!xInterval || !yInterval) return false;
  const low = Math.max(0, xInterval[0], yInterval[0]);
  const high = Math.min(1, xInterval[1], yInterval[1]);
  return low < high && high > 0 && low < 1;
}

function segmentAxisInteriorInterval(
  start: number,
  end: number,
  minimum: number,
  maximum: number,
): readonly [number, number] | undefined {
  if (start === end) {
    return start > minimum && start < maximum
      ? [Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY]
      : undefined;
  }
  const first = (minimum - start) / (end - start);
  const second = (maximum - start) / (end - start);
  return first < second ? [first, second] : [second, first];
}

function pointInsideGeometry(point: Point, geometry: ElementGeometry): boolean {
  return point.x > geometry.x
    && point.x < geometry.x + geometry.width
    && point.y > geometry.y
    && point.y < geometry.y + geometry.height;
}

function collinearOverlapLength(
  leftStart: Point,
  leftEnd: Point,
  rightStart: Point,
  rightEnd: Point,
): number {
  if (leftStart.x === leftEnd.x && rightStart.x === rightEnd.x && leftStart.x === rightStart.x) {
    return intervalOverlap(leftStart.y, leftEnd.y, rightStart.y, rightEnd.y);
  }
  if (leftStart.y === leftEnd.y && rightStart.y === rightEnd.y && leftStart.y === rightStart.y) {
    return intervalOverlap(leftStart.x, leftEnd.x, rightStart.x, rightEnd.x);
  }
  return 0;
}

function intervalOverlap(leftA: number, leftB: number, rightA: number, rightB: number): number {
  return Math.max(
    0,
    Math.min(Math.max(leftA, leftB), Math.max(rightA, rightB))
      - Math.max(Math.min(leftA, leftB), Math.min(rightA, rightB)),
  );
}

function segmentsCrossStrictly(
  leftStart: Point,
  leftEnd: Point,
  rightStart: Point,
  rightEnd: Point,
): boolean {
  const leftDx = leftEnd.x - leftStart.x;
  const leftDy = leftEnd.y - leftStart.y;
  const rightDx = rightEnd.x - rightStart.x;
  const rightDy = rightEnd.y - rightStart.y;
  const denominator = leftDx * rightDy - leftDy * rightDx;
  if (denominator === 0) return false;
  const offsetX = rightStart.x - leftStart.x;
  const offsetY = rightStart.y - leftStart.y;
  const leftRatio = (offsetX * rightDy - offsetY * rightDx) / denominator;
  const rightRatio = (offsetX * leftDy - offsetY * leftDx) / denominator;
  return leftRatio > 0 && leftRatio < 1 && rightRatio > 0 && rightRatio < 1;
}

function collinear(first: Point, middle: Point, last: Point): boolean {
  return (first.x === middle.x && middle.x === last.x)
    || (first.y === middle.y && middle.y === last.y);
}

function expandGeometry(geometry: ElementGeometry, amount: number): ElementGeometry {
  return {
    x: geometry.x - amount,
    y: geometry.y - amount,
    width: geometry.width + amount * 2,
    height: geometry.height + amount * 2,
  };
}

export function layoutExternalReservationGeometries(
  element: LayoutElement,
  geometry: ElementGeometry,
): ElementGeometry[] {
  const result: ElementGeometry[] = [];
  for (const reservation of element.externalReservations ?? []) {
    if (
      reservation.placement !== "bottom-center"
      || !Number.isFinite(reservation.width)
      || !Number.isFinite(reservation.height)
      || !Number.isFinite(reservation.gap)
      || reservation.width <= 0
      || reservation.height <= 0
      || reservation.gap < 0
    ) continue;
    result.push({
      x: geometry.x + (geometry.width - reservation.width) / 2,
      y: geometry.y + geometry.height + reservation.gap,
      width: reservation.width,
      height: reservation.height,
    });
  }
  return result;
}

export function layoutElementFootprintGeometry(
  element: LayoutElement,
  geometry: ElementGeometry,
): ElementGeometry {
  const reservations = layoutExternalReservationGeometries(element, geometry);
  if (reservations.length === 0) return copyGeometry(geometry);
  const left = Math.min(geometry.x, ...reservations.map((item) => item.x));
  const top = Math.min(geometry.y, ...reservations.map((item) => item.y));
  const right = Math.max(
    geometry.x + geometry.width,
    ...reservations.map((item) => item.x + item.width),
  );
  const bottom = Math.max(
    geometry.y + geometry.height,
    ...reservations.map((item) => item.y + item.height),
  );
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function layoutBounds(state: LayoutState): ElementGeometry[] {
  const result: ElementGeometry[] = [];
  for (const element of [...state.elements.values()].sort(compareElement)) {
    const geometry = state.geometries[element.elementId];
    if (!geometry) continue;
    result.push(copyGeometry(geometry), ...layoutExternalReservationGeometries(element, geometry));
  }
  return result;
}

function pointBounds(points: readonly Point[]): ElementGeometry {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  return {
    x: left,
    y: top,
    width: Math.max(...xs) - left,
    height: Math.max(...ys) - top,
  };
}

function geometryDistanceToBounds(geometry: ElementGeometry, bounds: ElementGeometry): number {
  const dx = Math.max(
    0,
    bounds.x - (geometry.x + geometry.width),
    geometry.x - (bounds.x + bounds.width),
  );
  const dy = Math.max(
    0,
    bounds.y - (geometry.y + geometry.height),
    geometry.y - (bounds.y + bounds.height),
  );
  return dx + dy;
}

function compareGeometry(left: ElementGeometry, right: ElementGeometry): number {
  return left.x - right.x
    || left.y - right.y
    || left.width - right.width
    || left.height - right.height;
}

function comparePoint(left: Point, right: Point): number {
  return left.x - right.x || left.y - right.y;
}

function routeSignature(route: readonly Point[]): string {
  return route.map(pointSignature).join(">");
}

function pointSignature(point: Point): string {
  return `${point.x},${point.y}`;
}

function gridKey(xIndex: number, yIndex: number): string {
  return `${xIndex},${yIndex}`;
}

function searchStateKey(pointIndex: number, direction: number): string {
  return `${pointIndex}:${direction}`;
}

function binaryIndex(values: readonly number[], value: number): number {
  let low = 0;
  let high = values.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const candidate = values[middle]!;
    if (candidate === value) return middle;
    if (candidate < value) low = middle + 1;
    else high = middle - 1;
  }
  return -1;
}

function parallelLaneOffsets(
  count: number,
  source: ElementGeometry,
  target: ElementGeometry,
  direction: LayoutDirection,
): number[] {
  const offsets = Array.from(
    { length: count },
    (_, index) => (index - (count - 1) / 2) * PARALLEL_LANE_GAP,
  );
  const minimumCenter = direction === "LR"
    ? Math.min(centerOf(source).y, centerOf(target).y)
    : Math.min(centerOf(source).x, centerOf(target).x);
  const correction = Math.max(0, -(minimumCenter + (offsets[0] ?? 0)));
  return correction === 0 ? offsets : offsets.map((offset) => offset + correction);
}

function edgeBundles(edges: readonly LayoutEdge[]): Map<string, LayoutEdge[]> {
  const result = new Map<string, LayoutEdge[]>();
  for (const edge of edges) {
    const key = JSON.stringify(canonicalEndpointPair(edge));
    const bundle = result.get(key) ?? [];
    bundle.push(edge);
    result.set(key, bundle);
  }
  for (const bundle of result.values()) bundle.sort(compareEdge);
  return new Map([...result.entries()].sort(([left], [right]) => compareText(left, right)));
}

function canonicalEndpointPair(edge: LayoutEdge): [string, string] {
  return compareText(edge.sourceElementId, edge.targetElementId) <= 0
    ? [edge.sourceElementId, edge.targetElementId]
    : [edge.targetElementId, edge.sourceElementId];
}

function routeSelfLoopBundle(
  edges: readonly LayoutEdge[],
  state: LayoutState,
  routes: Record<string, Point[]>,
): void {
  const geometry = state.geometries[edges[0]!.sourceElementId];
  if (!geometry) {
    for (const edge of edges) reportMissingEndpoint(edge, state);
    return;
  }
  edges.forEach((edge, index) => {
    const manual = manualWaypoints(edge);
    const route = manual
      ? manualRoute(geometry, geometry, manual, true)
      : selfLoopRoute(geometry, SELF_LOOP_BASE + index * SELF_LOOP_GAP);
    routes[edge.elementId] = applyEndpointAnchors(route, edge, geometry, geometry, state);
  });
}

function applyEndpointAnchors(
  route: Point[],
  edge: LayoutEdge,
  source: ElementGeometry,
  target: ElementGeometry,
  state: LayoutState,
): Point[] {
  if (route.length < 2) return route;
  const result = route.map(copyPoint);
  const sourceElement = state.elements.get(edge.sourceElementId);
  const targetElement = state.elements.get(edge.targetElementId);
  if (isValidEdgeEndpointAnchor(edge.sourceAnchor)) {
    result[0] = edgeEndpointAnchorPoint(
      source,
      layoutElementShape(sourceElement),
      edge.sourceAnchor,
    );
  }
  if (isValidEdgeEndpointAnchor(edge.targetAnchor)) {
    result[result.length - 1] = edgeEndpointAnchorPoint(
      target,
      layoutElementShape(targetElement),
      edge.targetAnchor,
    );
  }
  return result;
}

function layoutElementShape(element: LayoutElement | undefined): EdgeEndpointShape {
  return element?.shape ?? (element?.structuralKind === "container"
    ? "container"
    : element?.structuralKind === "region" ? "region" : "rectangle");
}

function manualWaypoints(edge: LayoutEdge): Point[] | undefined {
  return edge.routingPlacement === "user" && edge.waypoints && edge.waypoints.length > 0
    ? edge.waypoints.map(copyPoint)
    : undefined;
}

function manualRoute(
  source: ElementGeometry,
  target: ElementGeometry,
  waypoints: readonly Point[],
  selfLoop: boolean,
): Point[] {
  if (selfLoop) {
    const centerY = source.y + source.height / 2;
    const inset = Math.max(4, Math.min(12, source.height / 4));
    return [
      { x: source.x + source.width, y: centerY - inset },
      ...waypoints.map(copyPoint),
      { x: source.x + source.width, y: centerY + inset },
    ];
  }
  const sourceTarget = waypoints[0] ?? centerOf(target);
  const targetSource = waypoints.at(-1) ?? centerOf(source);
  return [
    rectangleBoundaryPoint(source, sourceTarget),
    ...waypoints.map(copyPoint),
    rectangleBoundaryPoint(target, targetSource),
  ];
}

function selfLoopRoute(geometry: ElementGeometry, extent: number): Point[] {
  const centerY = geometry.y + geometry.height / 2;
  const inset = Math.max(4, Math.min(12, geometry.height / 4));
  const right = geometry.x + geometry.width;
  const outer = right + extent;
  return [
    { x: right, y: centerY - inset },
    { x: outer, y: centerY - inset },
    { x: outer, y: centerY + inset },
    { x: right, y: centerY + inset },
  ];
}

function orthogonalRoute(
  source: ElementGeometry,
  target: ElementGeometry,
  direction: LayoutDirection,
  laneOffset = 0,
): Point[] {
  const sourceCenter = centerOf(source);
  const targetCenter = centerOf(target);
  if (direction === "LR") {
    const forward = targetCenter.x >= sourceCenter.x;
    const sourceAttachmentOffset = boundedLaneOffset(laneOffset, source.height);
    const targetAttachmentOffset = boundedLaneOffset(laneOffset, target.height);
    const start = {
      x: forward ? source.x + source.width : source.x,
      y: sourceCenter.y + sourceAttachmentOffset,
    };
    const end = {
      x: forward ? target.x : target.x + target.width,
      y: targetCenter.y + targetAttachmentOffset,
    };
    const middle = (start.x + end.x) / 2;
    if (sourceAttachmentOffset !== laneOffset || targetAttachmentOffset !== laneOffset) {
      const directionSign = forward ? 1 : -1;
      const sourceStubX = start.x + directionSign * 18;
      const targetStubX = end.x - directionSign * 18;
      const sourceLaneY = sourceCenter.y + laneOffset;
      const targetLaneY = targetCenter.y + laneOffset;
      return [
        start,
        { x: sourceStubX, y: start.y },
        { x: sourceStubX, y: sourceLaneY },
        { x: middle, y: sourceLaneY },
        { x: middle, y: targetLaneY },
        { x: targetStubX, y: targetLaneY },
        { x: targetStubX, y: end.y },
        end,
      ];
    }
    return [start, { x: middle, y: start.y }, { x: middle, y: end.y }, end];
  }
  const forward = targetCenter.y >= sourceCenter.y;
  const sourceAttachmentOffset = boundedLaneOffset(laneOffset, source.width);
  const targetAttachmentOffset = boundedLaneOffset(laneOffset, target.width);
  const start = {
    x: sourceCenter.x + sourceAttachmentOffset,
    y: forward ? source.y + source.height : source.y,
  };
  const end = {
    x: targetCenter.x + targetAttachmentOffset,
    y: forward ? target.y : target.y + target.height,
  };
  const middle = (start.y + end.y) / 2;
  if (sourceAttachmentOffset !== laneOffset || targetAttachmentOffset !== laneOffset) {
    const directionSign = forward ? 1 : -1;
    const sourceStubY = start.y + directionSign * 18;
    const targetStubY = end.y - directionSign * 18;
    const sourceLaneX = sourceCenter.x + laneOffset;
    const targetLaneX = targetCenter.x + laneOffset;
    return [
      start,
      { x: start.x, y: sourceStubY },
      { x: sourceLaneX, y: sourceStubY },
      { x: sourceLaneX, y: middle },
      { x: targetLaneX, y: middle },
      { x: targetLaneX, y: targetStubY },
      { x: end.x, y: targetStubY },
      end,
    ];
  }
  return [start, { x: start.x, y: middle }, { x: end.x, y: middle }, end];
}

function boundedLaneOffset(offset: number, crossSize: number): number {
  const limit = Math.max(0, crossSize / 2 - 4);
  return Math.max(-limit, Math.min(offset, limit));
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

function reportMissingEndpoint(edge: LayoutEdge, state: LayoutState): void {
  state.diagnostics.push({
    severity: "warning",
    code: "layout-edge-endpoint-missing",
    message: `edge endpoint is not present: ${edge.elementId}`,
    layoutRef: state.request.layoutRef,
    edgeId: edge.elementId,
  });
}

function avoidOccupiedGeometry(
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

function intersects(left: ElementGeometry, right: ElementGeometry): boolean {
  return left.x < right.x + right.width
    && left.x + left.width > right.x
    && left.y < right.y + right.height
    && left.y + left.height > right.y;
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
      ...geometries.map((item) => item.x + item.width),
      ...routePoints.map((point) => point.x),
    ) + margin,
    height: Math.max(
      0,
      ...geometries.map((item) => item.y + item.height),
      ...routePoints.map((point) => point.y),
    ) + margin,
  };
}

function emptyResult(layoutRef: string, diagnostics: LayoutDiagnostic[]): LayoutResult {
  return { layoutRef, geometries: {}, routes: {}, width: 0, height: 0, diagnostics };
}

function isFixed(element: LayoutElement): boolean {
  return element.pinned === true || element.placement === "user";
}

function primarySize(size: { width: number; height: number }, direction: LayoutDirection): number {
  return direction === "LR" ? size.width : size.height;
}

function crossSize(size: { width: number; height: number }, direction: LayoutDirection): number {
  return direction === "LR" ? size.height : size.width;
}

function copyGeometry(value: ElementGeometry): ElementGeometry {
  return { ...value };
}

function copyPoint(value: Point): Point {
  return { ...value };
}

function pointDistance(left: Point, right: Point): number {
  return Math.abs(left.x - right.x) + Math.abs(left.y - right.y);
}

function samePoint(left: Point, right: Point): boolean {
  return left.x === right.x && left.y === right.y;
}

function compareElement(left: LayoutElement, right: LayoutElement): number {
  return compareText(left.elementId, right.elementId);
}

function compareEdge(left: LayoutEdge, right: LayoutEdge): number {
  return compareText(left.elementId, right.elementId)
    || compareText(left.sourceElementId, right.sourceElementId)
    || compareText(left.targetElementId, right.targetElementId);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
