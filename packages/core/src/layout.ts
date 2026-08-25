import {
  edgeEndpointAnchorFromPoint,
  edgeEndpointAnchorHaloGeometry,
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
export type LayoutMode = "incremental" | "full" | "route-only";

export type LayoutExternalReservation = {
  placement: "bottom-center";
  width: number;
  height: number;
  gap: number;
};

export type LayoutElement = {
  elementId: string;
  structuralKind: "node" | "container" | "region" | "annotation";
  groupRole?: "sequence";
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
  role?: "membership" | "sequence-member";
  ordinal?: number;
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
  /**
   * Transaction-local renderer routes that must be reused exactly. This is
   * only valid for route-only execution and is never a portable overlay.
   */
  fixedDerivedRoutes?: Readonly<Record<string, readonly Point[]>>;
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

export type StandardLayoutPerformanceSample = {
  layoutRef: string;
  mode: LayoutMode;
  elements: number;
  edges: number;
  placementMs: number;
  initialRouteMs: number;
  refinementMs: number;
  compactionMs: number;
  boundsMs: number;
  totalMs: number;
  visibilitySearches: number;
  compactedEdges: number;
  compactionCandidates: number;
  /** Edges for which this invocation generated an initial route. */
  routedEdges: number;
  /** Previous derived routes reused without entering the routing pipeline. */
  fixedDerivedRoutes: number;
};

export type StandardLayoutPerformanceObserver = (
  sample: Readonly<StandardLayoutPerformanceSample>,
) => void;

export interface LayoutAdapter {
  readonly layoutRef: string;
  layout(request: LayoutRequest): Promise<LayoutResult>;
}

export type LayoutAdapterResolution =
  | { resolved: true; adapter: LayoutAdapter; diagnostics: [] }
  | { resolved: false; diagnostics: [LayoutDiagnostic] };

const DEFAULT_SPACING: LayoutSpacing = {
  margin: 48,
  rankGap: 56,
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
  const requestDiagnostics = validateFixedDerivedRouteRequest(request);
  if (requestDiagnostics.length > 0) {
    return emptyResult(request.layoutRef, requestDiagnostics);
  }
  const resolution = registry.resolve(request.layoutRef);
  if (!resolution.resolved) return emptyResult(request.layoutRef, resolution.diagnostics);
  try {
    const result = await resolution.adapter.layout(request);
    const completed = restoreFixedDerivedRoutes(
      request,
      completeRegionLayout(request, result),
    );
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
 * Third-party adapters may ignore the optional fixed-route optimization. The
 * common completion layer still preserves the renderer contract; the standard
 * adapter additionally skips these edges during routing, so this is not its
 * only preservation mechanism.
 */
function restoreFixedDerivedRoutes(
  request: LayoutRequest,
  candidate: LayoutResult,
): LayoutResult {
  const fixed = request.fixedDerivedRoutes;
  if (!fixed || Object.keys(fixed).length === 0) return candidate;
  const routes = Object.fromEntries(Object.entries(candidate.routes).map(([id, points]) => [
    id,
    points.map(copyPoint),
  ]));
  for (const [edgeId, points] of Object.entries(fixed)) {
    routes[edgeId] = points.map(copyPoint);
  }
  const spacing = { ...DEFAULT_SPACING, ...request.spacing };
  const bounds = sceneBounds(
    Object.values(candidate.geometries),
    Object.values(routes).flat(),
    spacing.margin,
  );
  return {
    ...candidate,
    routes,
    width: bounds.width,
    height: bounds.height,
  };
}

/**
 * Completes structural enclosure geometry for overlap regions and ordered
 * sequence groups. Regions are not hierarchy parents: each generated region
 * encloses all visible members, so a multiply-associated member lies in the
 * geometric intersection. User/pinned geometry remains a hard constraint.
 */
export function completeRegionLayout(
  request: LayoutRequest,
  candidate: LayoutResult,
): LayoutResult {
  const regionCandidates = request.scene.elements
    .filter((element) => element.structuralKind === "region")
    .sort((left, right) => compareText(left.elementId, right.elementId));
  const sequenceCandidates = request.scene.elements
    .filter((element) => element.structuralKind === "container" && element.groupRole === "sequence")
    .sort((left, right) => compareText(left.elementId, right.elementId));
  if (regionCandidates.length === 0 && sequenceCandidates.length === 0) return candidate;
  const geometries = Object.fromEntries(Object.entries(candidate.geometries).map(([id, geometry]) => [
    id,
    copyGeometry(geometry),
  ]));
  const diagnostics = [...candidate.diagnostics];
  const memberships = [...(request.scene.memberships ?? [])]
    .filter((membership) => membership.regionElementId)
    .sort((left, right) => compareText(left.semanticRef, right.semanticRef));
  const regions = groupCompletionOrder(regionCandidates, memberships);
  const spacing = { ...DEFAULT_SPACING, ...request.spacing };

  const sequenceMemberships = [...(request.scene.memberships ?? [])]
    .filter((membership) => membership.role === "sequence-member")
    .sort((left, right) => (
      (left.ordinal ?? Number.MAX_SAFE_INTEGER) - (right.ordinal ?? Number.MAX_SAFE_INTEGER)
      || compareText(left.semanticRef, right.semanticRef)
    ));
  for (const sequence of groupCompletionOrder(sequenceCandidates, sequenceMemberships)) {
    if (isFixed(sequence)) {
      if (sequence.geometry) geometries[sequence.elementId] = copyGeometry(sequence.geometry);
      continue;
    }
    const members = sequenceMemberships
      .filter((membership) => membership.containerElementId === sequence.elementId)
      .map((membership) => geometries[membership.memberElementId])
      .filter((geometry): geometry is ElementGeometry => geometry !== undefined);
    if (members.length === 0) continue;
    geometries[sequence.elementId] = enclosureGeometry(
      members,
      sequence.size ?? sequence.geometry ?? { width: 360, height: 160 },
      spacing,
    );
  }

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
    const minimum = region.size ?? region.geometry ?? { width: 240, height: 160 };
    geometries[region.elementId] = enclosureGeometry(members, minimum, spacing);
  }

  const normalizedRegionIds = normalizeGeneratedRegionSiblingSpans(
    request,
    regionCandidates,
    memberships,
    geometries,
  );
  if (normalizedRegionIds.size > 0) {
    // Owners and transitive owners must enclose the normalized child spans.
    // Do not recompute the normalized children themselves, which would shrink
    // them back to their individual content widths.
    for (const region of regions) {
      if (isFixed(region) || normalizedRegionIds.has(region.elementId)) continue;
      const members = memberships
        .filter((membership) => membership.regionElementId === region.elementId)
        .map((membership) => geometries[membership.memberElementId])
        .filter((geometry): geometry is ElementGeometry => geometry !== undefined);
      if (members.length === 0) continue;
      geometries[region.elementId] = enclosureGeometry(
        members,
        region.size ?? region.geometry ?? { width: 240, height: 160 },
        spacing,
      );
    }
  }

  packEmptyGeneratedRegions(regionCandidates, memberships, geometries, spacing);

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

/**
 * A generated outer region or the virtual root commonly owns several disjoint
 * lane regions. Give those siblings one shared primary-axis span so the result
 * reads as a single matrix instead of ragged independent boxes. The rule is
 * never applied to fixed/user geometry or overlapping region sets.
 */
function normalizeGeneratedRegionSiblingSpans(
  request: LayoutRequest,
  regions: readonly LayoutElement[],
  memberships: readonly LayoutMembership[],
  geometries: Record<string, ElementGeometry>,
): Set<string> {
  const direction = request.layoutRef === STANDARD_LAYOUT_REFS.hierarchicalLr
    ? "LR"
    : request.layoutRef === STANDARD_LAYOUT_REFS.hierarchicalTb ? "TB" : undefined;
  if (!direction) return new Set();
  const byId = new Map(regions.map((region) => [region.elementId, region]));
  const normalized = new Set<string>();
  const containerPadding = request.spacing?.containerPadding ?? DEFAULT_SPACING.containerPadding;
  const normalize = (childIds: readonly string[], ownerId?: string): void => {
    if (childIds.length < 2) return;
    const children = childIds.map((id) => byId.get(id)!);
    if (children.some((child) => isFixed(child) || !geometries[child.elementId])) return;
    const directMemberSets = childIds.map((childId) => new Set(memberships
      .filter((membership) => membership.regionElementId === childId)
      .map((membership) => membership.memberElementId)));
    if (
      directMemberSets.some((members) => members.size === 0)
      || directMemberSets.some((members, index) => directMemberSets.some((other, otherIndex) => (
        index < otherIndex && [...members].some((memberId) => other.has(memberId))
      )))
    ) return;
    const siblingGeometries = childIds.map((id) => geometries[id]!);
    const owner = ownerId ? byId.get(ownerId) : undefined;
    const ownerGeometry = owner && !isFixed(owner) ? geometries[ownerId!] : undefined;
    const ownerStart = ownerGeometry
      ? (direction === "LR" ? ownerGeometry.x : ownerGeometry.y) + containerPadding
      : Number.POSITIVE_INFINITY;
    const ownerEnd = ownerGeometry
      ? (direction === "LR"
          ? ownerGeometry.x + ownerGeometry.width
          : ownerGeometry.y + ownerGeometry.height) - containerPadding
      : Number.NEGATIVE_INFINITY;
    const primaryStart = Math.min(ownerStart, ...siblingGeometries.map((geometry) => (
      direction === "LR" ? geometry.x : geometry.y
    )));
    const primaryEnd = Math.max(ownerEnd, ...siblingGeometries.map((geometry) => (
      direction === "LR" ? geometry.x + geometry.width : geometry.y + geometry.height
    )));
    for (const childId of childIds) {
      const geometry = geometries[childId]!;
      geometries[childId] = direction === "LR"
        ? { ...geometry, x: primaryStart, width: primaryEnd - primaryStart }
        : { ...geometry, y: primaryStart, height: primaryEnd - primaryStart };
      normalized.add(childId);
    }
  };
  for (const owner of [...regions].sort((left, right) => compareText(left.elementId, right.elementId))) {
    const childIds = [...new Set(memberships
      .filter((membership) => membership.regionElementId === owner.elementId)
      .map((membership) => membership.memberElementId)
      .filter((memberId) => byId.has(memberId)))]
      .sort(compareText);
    normalize(childIds, owner.elementId);
  }
  const nestedRegionIds = new Set(memberships
    .map((membership) => membership.memberElementId)
    .filter((memberId) => byId.has(memberId)));
  normalize([...byId.keys()].filter((regionId) => !nestedRegionIds.has(regionId)).sort(compareText));
  // A virtual-root normalization may expand an outer region after its child
  // lanes were completed. Run the owner pass once more so those generated
  // child lanes fill the new owner content span as one matrix.
  for (const owner of [...regions].sort((left, right) => compareText(left.elementId, right.elementId))) {
    const childIds = [...new Set(memberships
      .filter((membership) => membership.regionElementId === owner.elementId)
      .map((membership) => membership.memberElementId)
      .filter((memberId) => byId.has(memberId)))]
      .sort(compareText);
    normalize(childIds, owner.elementId);
  }
  return normalized;
}

function enclosureGeometry(
  members: readonly ElementGeometry[],
  minimum: { width: number; height: number },
  spacing: LayoutSpacing,
): ElementGeometry {
  const padding = spacing.containerPadding;
  const header = spacing.containerHeader;
  const left = Math.min(...members.map((geometry) => geometry.x)) - padding;
  const top = Math.min(...members.map((geometry) => geometry.y)) - padding - header;
  const right = Math.max(...members.map((geometry) => geometry.x + geometry.width)) + padding;
  const bottom = Math.max(...members.map((geometry) => geometry.y + geometry.height)) + padding;
  const natural = { x: left, y: top, width: right - left, height: bottom - top };
  const width = Math.max(minimum.width, natural.width);
  const height = Math.max(minimum.height, natural.height);
  return {
    x: natural.x - (width - natural.width) / 2,
    y: natural.y - (height - natural.height) / 2,
    width,
    height,
  };
}

function packEmptyGeneratedRegions(
  regions: readonly LayoutElement[],
  memberships: readonly LayoutMembership[],
  geometries: Record<string, ElementGeometry>,
  spacing: LayoutSpacing,
): void {
  const populated = new Set(memberships.map((membership) => membership.regionElementId));
  const empty = regions.filter((region) => !isFixed(region) && !populated.has(region.elementId));
  if (empty.length === 0) return;
  const emptyIds = new Set(empty.map((region) => region.elementId));
  const occupied = Object.entries(geometries)
    .filter(([id]) => !emptyIds.has(id))
    .map(([, geometry]) => copyGeometry(geometry));
  let bounds = geometryUnion(occupied) ?? {
    x: spacing.margin,
    y: spacing.margin,
    width: 0,
    height: 0,
  };
  for (const region of empty) {
    const current = geometries[region.elementId];
    const size = region.size ?? current ?? { width: 240, height: 160 };
    const right = {
      x: bounds.x + bounds.width + spacing.itemGap,
      y: bounds.y,
      width: size.width,
      height: size.height,
    };
    const below = {
      x: bounds.x,
      y: bounds.y + bounds.height + spacing.itemGap,
      width: size.width,
      height: size.height,
    };
    const geometry = [right, below].sort((left, rightCandidate) => (
      comparePackingQuality(
        geometryUnion([...occupied, left])!,
        geometryUnion([...occupied, rightCandidate])!,
      )
      || compareGeometry(left, rightCandidate)
    ))[0]!;
    geometries[region.elementId] = geometry;
    occupied.push(copyGeometry(geometry));
    bounds = geometryUnion(occupied)!;
  }
}

function geometryUnion(values: readonly ElementGeometry[]): ElementGeometry | undefined {
  if (values.length === 0) return undefined;
  const left = Math.min(...values.map((value) => value.x));
  const top = Math.min(...values.map((value) => value.y));
  const right = Math.max(...values.map((value) => value.x + value.width));
  const bottom = Math.max(...values.map((value) => value.y + value.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function comparePackingQuality(left: ElementGeometry, right: ElementGeometry): number {
  const leftAspect = Math.max(left.width / left.height, left.height / left.width);
  const rightAspect = Math.max(right.width / right.height, right.height / right.width);
  return leftAspect - rightAspect
    || left.width * left.height - right.width * right.height
    || Math.max(left.width, left.height) - Math.max(right.width, right.height);
}

/** Orders nested structural groups from member to owner. */
function groupCompletionOrder(
  groups: readonly LayoutElement[],
  memberships: readonly LayoutMembership[],
): LayoutElement[] {
  const byId = new Map(groups.map((group) => [group.elementId, group]));
  const dependencies = new Map<string, string[]>();
  for (const membership of memberships) {
    const ownerElementId = membership.regionElementId ?? membership.containerElementId;
    if (!byId.has(ownerElementId) || !byId.has(membership.memberElementId)) continue;
    const values = dependencies.get(ownerElementId) ?? [];
    values.push(membership.memberElementId);
    dependencies.set(ownerElementId, values);
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
  for (const group of groups) visit(group.elementId);
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
    if (!containsRectangle(intersection, member)) {
      diagnostics.push({
        severity: "warning",
        code: regionGeometries.length > 1
          ? "region-member-outside-intersection"
          : "region-member-outside",
        message: `${memberId}の全体がmembership region${regionGeometries.length > 1 ? "の交差" : ""}内にありません。`,
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

function containsRectangle(container: ElementGeometry, member: ElementGeometry): boolean {
  return member.x >= container.x
    && member.y >= container.y
    && member.x + member.width <= container.x + container.width
    && member.y + member.height <= container.y + container.height;
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
    if (request.fixedDerivedRoutes?.[edge.elementId]) continue;
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
  for (const [edgeId, fixed] of Object.entries(request.fixedDerivedRoutes ?? {})) {
    const actual = result.routes[edgeId];
    if (!actual || !sameRouteValue(actual, fixed)) {
      diagnostics.push({
        ...invalidResult(request, `fixed derived route changed: ${edgeId}`),
        edgeId,
      });
    }
  }
  return diagnostics;
}

function validateFixedDerivedRouteRequest(request: LayoutRequest): LayoutDiagnostic[] {
  const fixed = request.fixedDerivedRoutes;
  if (!fixed || Object.keys(fixed).length === 0) return [];
  const diagnostics: LayoutDiagnostic[] = [];
  if (request.mode !== "route-only") {
    diagnostics.push(invalidResult(
      request,
      "fixedDerivedRoutes is only valid in route-only mode",
    ));
  }
  const expectedEdgeIds = new Set(request.scene.edges.map((edge) => edge.elementId));
  for (const [edgeId, points] of Object.entries(fixed).sort(([left], [right]) => (
    compareText(left, right)
  ))) {
    if (!expectedEdgeIds.has(edgeId)) {
      diagnostics.push({
        ...invalidResult(request, `fixed derived route refers to an unknown edge: ${edgeId}`),
        edgeId,
      });
    } else if (
      points.length < 2
      || points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))
    ) {
      diagnostics.push({
        ...invalidResult(request, `fixed derived route is invalid: ${edgeId}`),
        edgeId,
      });
    }
  }
  return diagnostics;
}

function sameRouteValue(left: readonly Point[], right: readonly Point[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
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
    readonly performanceObserver?: StandardLayoutPerformanceObserver,
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
    return runStandardLayout(request, this.direction, this.performanceObserver);
  }
}

type StandardLayoutPerformanceAccumulator = {
  placementMs: number;
  initialRouteMs: number;
  refinementMs: number;
  compactionMs: number;
  boundsMs: number;
  visibilitySearches: number;
  compactedEdges: number;
  compactionCandidates: number;
  routedEdges: number;
  fixedDerivedRoutes: number;
};

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
  routeObstaclesByEndpointPair: Map<string, RouteObstacle[]>;
  fixedDerivedRoutes: Map<string, readonly Point[]>;
  sharedEndpointGeometriesByEdgePair: Map<string, ElementGeometry[]>;
};

type RouteObstacle = ElementGeometry & {
  /** Body traversal must lose to a renderer-only reservation conflict. */
  kind: "body" | "reservation";
};

function runStandardLayout(
  request: LayoutRequest,
  direction: LayoutDirection,
  performanceObserver?: StandardLayoutPerformanceObserver,
): LayoutResult {
  const requestDiagnostics = validateFixedDerivedRouteRequest(request);
  if (requestDiagnostics.length > 0) return emptyResult(request.layoutRef, requestDiagnostics);
  const totalStartedAt = performanceObserver ? monotonicMilliseconds() : 0;
  const performanceSample: StandardLayoutPerformanceAccumulator | undefined = performanceObserver
    ? {
        placementMs: 0,
        initialRouteMs: 0,
        refinementMs: 0,
        compactionMs: 0,
        boundsMs: 0,
        visibilitySearches: 0,
        compactedEdges: 0,
        compactionCandidates: 0,
        routedEdges: 0,
        fixedDerivedRoutes: Object.keys(request.fixedDerivedRoutes ?? {}).length,
      }
    : undefined;
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
    routeObstaclesByEndpointPair: new Map(),
    fixedDerivedRoutes: new Map(Object.entries(request.fixedDerivedRoutes ?? {}).map(([id, points]) => [
      id,
      points.map(copyPoint),
    ])),
    sharedEndpointGeometriesByEdgePair: new Map(),
  };

  const placementStartedAt = performanceSample ? monotonicMilliseconds() : 0;
  for (const id of state.children.get(ROOT_GROUP) ?? []) measureElement(id, state);
  placeGroup(ROOT_GROUP, { x: state.spacing.margin, y: state.spacing.margin }, state);
  // Regions are derived membership geometry. Complete them before routing so
  // they do not consume a layered rank yet region-incident edges still route
  // from their final boundary.
  state.geometries = completeRegionLayout(request, {
    layoutRef: request.layoutRef,
    geometries: state.geometries,
    routes: {},
    width: 0,
    height: 0,
    diagnostics: [],
  }).geometries;
  if (performanceSample) {
    performanceSample.placementMs = monotonicMilliseconds() - placementStartedAt;
  }
  const routes = routeEdges(state, performanceSample);
  const boundsStartedAt = performanceSample ? monotonicMilliseconds() : 0;
  const bounds = sceneBounds(
    layoutBounds(state),
    Object.values(routes).flat(),
    state.spacing.margin,
  );
  if (performanceSample) {
    performanceSample.boundsMs = monotonicMilliseconds() - boundsStartedAt;
  }

  const result: LayoutResult = {
    layoutRef: request.layoutRef,
    geometries: state.geometries,
    routes,
    width: bounds.width,
    height: bounds.height,
    diagnostics,
  };
  if (performanceObserver && performanceSample) {
    try {
      performanceObserver(Object.freeze({
        layoutRef: request.layoutRef,
        mode: request.mode ?? "incremental",
        elements: state.elements.size,
        edges: state.edges.length,
        ...performanceSample,
        totalMs: monotonicMilliseconds() - totalStartedAt,
      }));
    } catch {
      // Instrumentation is observational and cannot fail layout.
    }
  }
  return result;
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
    } else if (element.structuralKind === "region" && !isFixed(element)) {
      const visualSize = state.measured.get(childId)!;
      geometry = {
        x: origin.x,
        y: origin.y,
        width: visualSize.width,
        height: visualSize.height,
      };
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
  const allIds = state.children.get(groupId) ?? [];
  const ids = allIds.filter((id) => {
    const element = state.elements.get(id)!;
    return element.structuralKind !== "region" || isFixed(element);
  });
  const ranks = hierarchicalRanks(ids, groupId, state);
  const byRank = new Map<number, string[]>();
  for (const id of ids) {
    const rank = ranks.get(id) ?? 0;
    const members = byRank.get(rank) ?? [];
    members.push(id);
    byRank.set(rank, members);
  }
  for (const members of byRank.values()) members.sort(compareText);
  const crossBands = state.direction === "LR"
    ? membershipCrossBands(ids, byRank, groupId, state)
    : undefined;
  const sortedRanks = [...byRank.keys()].sort((left, right) => left - right);
  const primaryByRank = new Map<number, number>();
  let primaryCursor = 0;
  for (const rank of sortedRanks) {
    primaryByRank.set(rank, primaryCursor);
    primaryCursor += Math.max(...byRank.get(rank)!.map((id) => (
      primarySize(elementLayoutSize(id, state), state.direction)
    ))) + state.spacing.rankGap;
  }
  const primaryOffsets = crossBands
    ? membershipPrimaryOffsets(ids, ranks, primaryByRank, groupId, crossBands, state)
    : new Map<string, number>();

  const placements = new Map<string, ElementGeometry>();
  let maxCross = 0;
  for (const rank of sortedRanks) {
    const members = byRank.get(rank)!;
    const primary = primaryByRank.get(rank)!;
    let cross = 0;
    const bandCursors = new Map<string, number>();
    for (const id of members) {
      const size = elementLayoutSize(id, state);
      const bandKey = crossBands?.keyByElement.get(id);
      const bandOffset = crossBands && bandKey ? crossBands.offsetByKey.get(bandKey)! : 0;
      const primaryOffset = bandKey ? primaryOffsets.get(bandKey) ?? 0 : 0;
      const bandCursor = bandKey ? bandCursors.get(bandKey) ?? 0 : cross;
      const crossPosition = bandOffset + bandCursor;
      const geometry = state.direction === "LR"
        ? { x: primary + primaryOffset, y: crossPosition, width: size.width, height: size.height }
        : { x: crossPosition, y: primary, width: size.width, height: size.height };
      placements.set(id, geometry);
      if (bandKey) {
        bandCursors.set(
          bandKey,
          bandCursor + crossSize(size, state.direction) + state.spacing.itemGap,
        );
      } else {
        cross += crossSize(size, state.direction) + state.spacing.itemGap;
      }
    }
    maxCross = crossBands?.extent ?? Math.max(
      maxCross,
      Math.max(0, cross - state.spacing.itemGap),
    );
  }
  if (crossBands) {
    placeUnassignedElementsByAffinity(placements, ids, groupId, crossBands, state);
  }
  const primaryExtent = Math.max(0, primaryCursor - state.spacing.rankGap);
  const placementWidth = Math.max(0, ...[...placements.values()].map((geometry) => (
    geometry.x + geometry.width
  )));
  const placementHeight = Math.max(0, ...[...placements.values()].map((geometry) => (
    geometry.y + geometry.height
  )));
  for (const id of allIds) {
    if (placements.has(id)) continue;
    const size = elementLayoutSize(id, state);
    placements.set(id, { x: 0, y: 0, width: size.width, height: size.height });
  }
  return {
    placements,
    bounds: state.direction === "LR"
      ? { width: Math.max(primaryExtent, placementWidth), height: Math.max(maxCross, placementHeight) }
      : { width: Math.max(maxCross, placementWidth), height: Math.max(primaryExtent, placementHeight) },
  };
}

type MembershipCrossBands = {
  keyByElement: Map<string, string>;
  offsetByKey: Map<string, number>;
  assignedElementIds: Set<string>;
  extent: number;
};

/**
 * Gives LR region members a stable cross-axis band across every rank. A
 * multiple-membership signature receives its own deterministic intersection
 * band; this keeps region matrices possible without treating any domain lane
 * or predicate specially.
 */
function membershipCrossBands(
  ids: readonly string[],
  byRank: ReadonlyMap<number, readonly string[]>,
  groupId: string,
  state: LayoutState,
): MembershipCrossBands | undefined {
  const idSet = new Set(ids);
  const regionsByElement = new Map<string, Set<string>>();
  const membersByRegion = new Map<string, string[]>();
  for (const membership of state.request.scene.memberships ?? []) {
    if (!membership.regionElementId) continue;
    const member = immediateChildInGroup(membership.memberElementId, groupId, state.parents);
    if (!member || !idSet.has(member)) continue;
    const regions = regionsByElement.get(member) ?? new Set<string>();
    regions.add(membership.regionElementId);
    regionsByElement.set(member, regions);
    const members = membersByRegion.get(membership.regionElementId) ?? [];
    members.push(member);
    membersByRegion.set(membership.regionElementId, members);
  }
  const regionSignatures = new Set(
    [...regionsByElement.values()].map((regions) => [...regions].sort(compareText).join("\u0001")),
  );
  if (regionSignatures.size < 2) return undefined;

  const keyByElement = new Map(ids.flatMap((id) => {
    const regions = regionsByElement.get(id);
    return regions && regions.size > 0
      ? [[id, [...regions].sort(compareText).join("\u0001")] as const]
      : [];
  }));
  const heightByKey = new Map<string, number>();
  for (const members of byRank.values()) {
    const rankHeightByKey = new Map<string, number>();
    for (const id of members) {
      const key = keyByElement.get(id);
      if (!key) continue;
      const size = elementLayoutSize(id, state);
      rankHeightByKey.set(
        key,
        (rankHeightByKey.get(key) ?? -state.spacing.itemGap)
          + crossSize(size, state.direction) + state.spacing.itemGap,
      );
    }
    for (const [key, height] of rankHeightByKey) {
      heightByKey.set(key, Math.max(heightByKey.get(key) ?? 0, height));
    }
  }

  const bandGap = state.spacing.containerPadding * 2 + state.spacing.containerHeader;
  const orderKeyByRegion = new Map([...membersByRegion].map(([regionId, members]) => [
    regionId,
    [...new Set(members)].sort(compareText)[0] ?? regionId,
  ]));
  const bandOrderKey = (key: string): string => key
    .split("\u0001")
    .map((regionId) => orderKeyByRegion.get(regionId) ?? regionId)
    .join("\u0001");
  const offsetByKey = new Map<string, number>();
  let cursor = 0;
  for (const key of [...heightByKey.keys()].sort((left, right) => (
    compareText(bandOrderKey(left), bandOrderKey(right)) || compareText(left, right)
  ))) {
    offsetByKey.set(key, cursor);
    cursor += heightByKey.get(key)! + bandGap;
  }
  return {
    keyByElement,
    offsetByKey,
    assignedElementIds: new Set(keyByElement.keys()),
    extent: Math.max(0, cursor - bandGap),
  };
}

/**
 * Aligns membership bands on the primary axis when an unassigned directed
 * resource bridges them (producer -> resource -> consumer). The equality is a
 * soft, generic graph constraint; direct forward cross-band edges then keep a
 * minimum progression without inspecting predicates or labels.
 */
function membershipPrimaryOffsets(
  ids: readonly string[],
  ranks: ReadonlyMap<string, number>,
  primaryByRank: ReadonlyMap<number, number>,
  groupId: string,
  bands: MembershipCrossBands,
  state: LayoutState,
): Map<string, number> {
  const centerX = (id: string): number => (
    primaryByRank.get(ranks.get(id) ?? 0) ?? 0
  ) + primarySize(elementLayoutSize(id, state), state.direction) / 2;
  const constraints = new Map<string, number[]>();
  for (const resourceId of ids.filter((id) => !bands.assignedElementIds.has(id)).sort(compareText)) {
    const producers = state.edges.flatMap((edge): string[] => {
      if (edge.targetElementId !== resourceId) return [];
      const id = immediateChildInGroup(edge.sourceElementId, groupId, state.parents);
      return id && bands.assignedElementIds.has(id) ? [id] : [];
    });
    const consumers = state.edges.flatMap((edge): string[] => {
      if (edge.sourceElementId !== resourceId) return [];
      const id = immediateChildInGroup(edge.targetElementId, groupId, state.parents);
      return id && bands.assignedElementIds.has(id) ? [id] : [];
    });
    for (const producer of [...new Set(producers)].sort(compareText)) {
      for (const consumer of [...new Set(consumers)].sort(compareText)) {
        const fromKey = bands.keyByElement.get(producer);
        const toKey = bands.keyByElement.get(consumer);
        if (!fromKey || !toKey || fromKey === toKey) continue;
        const forward = compareText(fromKey, toKey) <= 0;
        const key = forward ? `${fromKey}\u0000${toKey}` : `${toKey}\u0000${fromKey}`;
        const difference = centerX(producer) - centerX(consumer);
        const values = constraints.get(key) ?? [];
        values.push(forward ? difference : -difference);
        constraints.set(key, values);
      }
    }
  }
  const adjacency = new Map([...bands.offsetByKey.keys()].map((key) => [key, [] as Array<{
    target: string;
    difference: number;
  }>]));
  for (const [key, values] of [...constraints].sort(([left], [right]) => compareText(left, right))) {
    const [from, to] = key.split("\u0000") as [string, string];
    const difference = median(values);
    adjacency.get(from)?.push({ target: to, difference });
    adjacency.get(to)?.push({ target: from, difference: -difference });
  }
  const result = new Map<string, number>();
  for (const root of bands.offsetByKey.keys()) {
    if (result.has(root)) continue;
    result.set(root, 0);
    const queue = [root];
    while (queue.length > 0) {
      const source = queue.shift()!;
      for (const edge of (adjacency.get(source) ?? []).sort((left, right) => (
        compareText(left.target, right.target) || left.difference - right.difference
      ))) {
        if (result.has(edge.target)) continue;
        result.set(edge.target, result.get(source)! + edge.difference);
        queue.push(edge.target);
      }
    }
  }
  for (const edge of [...state.edges].sort(compareEdge)) {
    const source = immediateChildInGroup(edge.sourceElementId, groupId, state.parents);
    const target = immediateChildInGroup(edge.targetElementId, groupId, state.parents);
    if (!source || !target || !bands.assignedElementIds.has(source) || !bands.assignedElementIds.has(target)) continue;
    const sourceKey = bands.keyByElement.get(source)!;
    const targetKey = bands.keyByElement.get(target)!;
    if (sourceKey === targetKey || (ranks.get(target) ?? 0) <= (ranks.get(source) ?? 0)) continue;
    const required = centerX(source) + (result.get(sourceKey) ?? 0) + state.spacing.rankGap;
    const current = centerX(target) + (result.get(targetKey) ?? 0);
    if (current < required) result.set(targetKey, (result.get(targetKey) ?? 0) + required - current);
  }
  const minimum = Math.min(0, ...result.values());
  if (minimum < 0) for (const [key, value] of result) result.set(key, value - minimum);
  return result;
}

function placeUnassignedElementsByAffinity(
  placements: Map<string, ElementGeometry>,
  ids: readonly string[],
  groupId: string,
  bands: MembershipCrossBands,
  state: LayoutState,
): void {
  const occupied = [...bands.assignedElementIds]
    .map((id) => placements.get(id))
    .filter((geometry): geometry is ElementGeometry => geometry !== undefined)
    .map(copyGeometry);
  const unassigned = ids
    .filter((id) => !bands.assignedElementIds.has(id))
    .sort(compareText);
  for (const id of unassigned) {
    const current = placements.get(id);
    if (!current) continue;
    const incomingNeighbours = state.edges.flatMap((edge): string[] => {
      if (edge.targetElementId !== id) return [];
      const immediate = immediateChildInGroup(edge.sourceElementId, groupId, state.parents);
      return immediate && bands.assignedElementIds.has(immediate) ? [immediate] : [];
    });
    const neighbours = state.edges.flatMap((edge): string[] => {
      const other = edge.sourceElementId === id
        ? edge.targetElementId
        : edge.targetElementId === id ? edge.sourceElementId : "";
      if (!other) return [];
      const immediate = immediateChildInGroup(other, groupId, state.parents);
      return immediate && bands.assignedElementIds.has(immediate) ? [immediate] : [];
    });
    // A directed resource produced by an assigned node belongs beside that
    // producer's column. This keeps message/artifact edges short without
    // introducing predicate-specific layout rules. Resources without an
    // assigned producer use the median neighbourhood column instead.
    const incomingGeometries = [...new Set(incomingNeighbours)]
      .map((neighbour) => placements.get(neighbour))
      .filter((geometry): geometry is ElementGeometry => geometry !== undefined);
    const neighbourGeometries = [...new Set(neighbours)]
      .map((neighbour) => placements.get(neighbour))
      .filter((geometry): geometry is ElementGeometry => geometry !== undefined);
    const primaryGeometries = incomingGeometries.length > 0
      ? incomingGeometries
      : neighbourGeometries;
    const preferred = neighbourGeometries.length > 0
      ? {
          x: median(primaryGeometries.map((geometry) => centerOf(geometry).x))
            - current.width / 2,
          y: neighbourGeometries.reduce((sum, geometry) => sum + centerOf(geometry).y, 0)
            / neighbourGeometries.length - current.height / 2,
        }
      : { x: current.x, y: bands.extent + state.spacing.containerHeader };
    const geometry = avoidOccupiedGeometry({
      x: Math.max(0, preferred.x),
      y: Math.max(0, preferred.y),
      width: current.width,
      height: current.height,
    }, occupied, state.direction, Math.max(12, state.spacing.itemGap / 2));
    placements.set(id, geometry);
    occupied.push(copyGeometry(geometry));
  }
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

function median(values: readonly number[]): number {
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0
    ? (ordered[middle - 1]! + ordered[middle]!) / 2
    : ordered[middle]!;
}

function hierarchicalRanks(ids: string[], groupId: string, state: LayoutState): Map<string, number> {
  const idSet = new Set(ids);
  const pairs = new Set<string>();
  const membersByRegion = new Map<string, string[]>();
  const regionMembershipCountByMember = new Map<string, number>();
  for (const membership of state.request.scene.memberships ?? []) {
    if (!membership.regionElementId) continue;
    const member = immediateChildInGroup(membership.memberElementId, groupId, state.parents);
    if (!member || !idSet.has(member)) continue;
    const members = membersByRegion.get(membership.regionElementId) ?? [];
    members.push(member);
    membersByRegion.set(membership.regionElementId, members);
    regionMembershipCountByMember.set(
      member,
      (regionMembershipCountByMember.get(member) ?? 0) + 1,
    );
  }
  const useRegionBands = membersByRegion.size >= 2;
  for (const edge of state.edges) {
    const source = immediateChildInGroup(edge.sourceElementId, groupId, state.parents);
    const target = immediateChildInGroup(edge.targetElementId, groupId, state.parents);
    if (source && target && source !== target && idSet.has(source) && idSet.has(target)) {
      if (
        useRegionBands
        && (!regionMembershipCountByMember.has(source) || !regionMembershipCountByMember.has(target))
      ) continue;
      pairs.add(`${source}\u0000${target}`);
    }
  }
  const sequenceMembers = (state.request.scene.memberships ?? [])
    .filter((membership) => (
      membership.role === "sequence-member"
      && membership.containerElementId === groupId
      && Number.isSafeInteger(membership.ordinal)
      && idSet.has(membership.memberElementId)
    ))
    .sort((left, right) => (
      left.ordinal! - right.ordinal!
      || compareText(left.memberElementId, right.memberElementId)
      || compareText(left.semanticRef, right.semanticRef)
    ));
  for (let index = 0; index < sequenceMembers.length - 1; index += 1) {
    const source = sequenceMembers[index]!.memberElementId;
    const target = sequenceMembers[index + 1]!.memberElementId;
    if (source !== target) pairs.add(`${source}\u0000${target}`);
  }
  for (const members of membersByRegion.values()) {
    const ordered = [...new Set(members)].sort(compareText);
    // rdf:Bag/rdfs:member is unordered. It only contributes a stable matrix
    // progression when a shared member needs an explicit intersection band.
    if (!ordered.some((member) => (regionMembershipCountByMember.get(member) ?? 0) > 1)) {
      continue;
    }
    for (let index = 0; index < ordered.length - 1; index += 1) {
      pairs.add(`${ordered[index]}\u0000${ordered[index + 1]}`);
    }
  }
  const adjacency = new Map(ids.map((id) => [id, [] as string[]]));
  for (const pair of [...pairs].sort(compareText)) {
    const [source, target] = pair.split("\u0000") as [string, string];
    adjacency.get(source)!.push(target);
  }
  const components = stronglyConnectedComponents(ids, adjacency);
  const expandCyclesAcrossRegionBands = useRegionBands;
  const componentById = new Map<string, number>();
  components.forEach((component, index) => component.forEach((id) => componentById.set(id, index)));
  const localRankById = new Map(ids.map((id) => [id, 0]));
  const componentSpans = components.map(() => 1);
  if (expandCyclesAcrossRegionBands) {
    components.forEach((component, componentIndex) => {
      for (const source of component) {
        for (const target of adjacency.get(source) ?? []) {
          if (
            componentById.get(target) !== componentIndex
            || compareText(source, target) >= 0
          ) continue;
          localRankById.set(
            target,
            Math.max(localRankById.get(target)!, localRankById.get(source)! + 1),
          );
        }
      }
      componentSpans[componentIndex] = Math.max(
        1,
        ...component.map((id) => localRankById.get(id)! + 1),
      );
    });
  }
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
      ranks.set(
        target,
        Math.max(
          ranks.get(target)!,
          ranks.get(current)! + componentSpans[current]!,
        ),
      );
      indegree.set(target, indegree.get(target)! - 1);
      if (indegree.get(target) === 0) {
        ready.push(target);
        ready.sort((left, right) => compareText(componentKeys[left]!, componentKeys[right]!));
      }
    }
  }
  return new Map(ids.map((id) => {
    const componentIndex = componentById.get(id)!;
    const localRank = localRankById.get(id)!;
    return [id, ranks.get(componentIndex)! + localRank];
  }));
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
const ROUTE_REFINEMENT_PASSES = 2;
const ROUTE_ENDPOINT_STUB = ROUTE_OBSTACLE_PADDING + 2;

function routeEdges(
  state: LayoutState,
  performanceSample?: StandardLayoutPerformanceAccumulator,
): Record<string, Point[]> {
  const startedAt = performanceSample ? monotonicMilliseconds() : 0;
  const routes: Record<string, Point[]> = Object.fromEntries(
    [...state.fixedDerivedRoutes.entries()]
      .sort(([left], [right]) => compareText(left, right))
      .map(([edgeId, points]) => [edgeId, points.map(copyPoint)]),
  );
  if (performanceSample) {
    performanceSample.routedEdges = state.edges.length - state.fixedDerivedRoutes.size;
  }
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
      if (isFixedDerivedRoute(edge, state)) return;
      const source = state.geometries[edge.sourceElementId];
      const target = state.geometries[edge.targetElementId];
      if (!source || !target) {
        reportMissingEndpoint(edge, state);
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
      const canonicalRoute = orthogonalRoute(
        canonicalSource,
        canonicalTarget,
        state.direction,
        laneOffsets[index]!,
      );
      const route = edge.sourceElementId === canonicalSourceId
        ? canonicalRoute
        : [...canonicalRoute].reverse().map(copyPoint);
      routes[edge.elementId] = withDerivedEndpointStubs(
        applyEndpointAnchors(route, edge, source, target, state),
        edge,
        source,
        target,
        state,
      );
    });
  }
  if (performanceSample) {
    performanceSample.initialRouteMs = monotonicMilliseconds() - startedAt;
  }
  return improveDerivedRoutes(routes, state, performanceSample);
}

function directRoute(
  edge: LayoutEdge,
  source: ElementGeometry,
  target: ElementGeometry,
  state: LayoutState,
): Point[] {
  if (edge.sourceElementId === edge.targetElementId) {
    const centerY = source.y + source.height / 2;
    const inset = Math.max(4, Math.min(12, source.height / 4));
    return [
      { x: source.x + source.width, y: centerY - inset },
      { x: source.x + source.width, y: centerY + inset },
    ];
  }
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
  bounds: ElementGeometry;
  sharedEndpointGeometries: ElementGeometry[];
};

type RoutedEdgeState = {
  edge: LayoutEdge;
  points: Point[];
  bounds: ElementGeometry;
};

type RouteCost = readonly [
  bodyIntersections: number,
  crossings: number,
  reservationIntersections: number,
  overlapLength: number,
  length: number,
  bends: number,
];

type RouteSearchCost = readonly [
  crossings: number,
  overlapLength: number,
  length: number,
  bends: number,
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
  performanceSample?: StandardLayoutPerformanceAccumulator,
): Record<string, Point[]> {
  const routes = Object.fromEntries(Object.entries(input).map(([id, points]) => [
    id,
    points.map(copyPoint),
  ]));
  if (
    state.elements.size > ROUTE_GRID_ELEMENT_LIMIT
    || state.edges.length > ROUTE_GRID_EDGE_LIMIT
  ) {
    const startedAt = performanceSample ? monotonicMilliseconds() : 0;
    const result = compactLargeDerivedRoutes(routes, state);
    if (performanceSample) {
      performanceSample.compactionMs = monotonicMilliseconds() - startedAt;
      performanceSample.compactedEdges = state.edges.length - state.fixedDerivedRoutes.size;
    }
    return result;
  }

  const sorted = [...state.edges].sort(compareEdge);
  const affected = sorted.filter((edge) => !isFixedDerivedRoute(edge, state));
  const bundled = new Set(
    [...edgeBundles(sorted).values()]
      .filter((edges) => edges.length > 1)
      .flatMap((edges) => edges.map((edge) => edge.elementId)),
  );
  for (const edge of sorted) {
    if (!isImmutableRoute(edge)) continue;
    const route = routes[edge.elementId];
    if (!route) continue;
    const obstacles = routeObstacles(edge, state);
    if (!polylineIntersectsAnyGeometry(route, obstacles)) continue;
    state.diagnostics.push({
      severity: "warning",
      code: "layout-manual-route-obstacle",
      message: `manual route intersects a node or comment obstacle and was preserved: ${edge.elementId}`,
      layoutRef: state.request.layoutRef,
      edgeId: edge.elementId,
    });
  }
  const routeStates = indexRoutedEdgeStates(sorted, routes);
  const orders = [affected, [...affected].reverse()];
  const refinementStartedAt = performanceSample ? monotonicMilliseconds() : 0;
  for (let pass = 0; pass < ROUTE_REFINEMENT_PASSES; pass += 1) {
    for (const edge of orders[pass % orders.length]!) {
      const base = routes[edge.elementId];
      if (
        isImmutableRoute(edge)
        || edge.routeMode === "straight"
        || !base
        || base.length < 2
        || edge.sourceElementId === edge.targetElementId
      ) continue;

      const obstacles = routeObstacles(edge, state);
      const baseBounds = pointBounds(base);
      const baseObstacleCost = routeObstacleCost(base, baseBounds, obstacles);
      // The persisted renderer contract exposes at most one pivot. Crossing
      // and overlap alternatives are therefore scored once in the compaction
      // pass below. A visibility-grid search is only needed to discover a
      // corridor around an actual node/comment obstacle; running it for every
      // unavoidable dense-graph crossing duplicates the same global scoring.
      if (baseObstacleCost.bodyIntersections === 0) continue;
      // Only body-intersecting routes enter refinement. Build the complete
      // peer view after that exact leading-cost gate; candidate selection and
      // its forward/reverse deterministic passes remain unchanged.
      const others = routedOthers(sorted, routeStates, edge, state);
      const baseCost = routeCostWithObstacleIntersections(
        base,
        baseBounds,
        baseObstacleCost,
        edge,
        others,
      );
      const localCandidates = compactRouteCandidates(
        edge,
        base,
        obstacles,
        others,
        state,
        bundled.has(edge.elementId),
      );
      const distinctLocalCandidates = bundled.has(edge.elementId)
        ? localCandidates.filter((candidate) => !duplicatesBundlePeer(candidate, edge, others))
        : localCandidates;
      const localBest = bestRouteCandidate(
        distinctLocalCandidates,
        edge,
        obstacles,
        others,
      );
      const expandedLocalCandidates = localBest?.cost[0] === 0
        ? undefined
        : compactRouteCandidates(
            edge,
            base,
            obstacles,
            others,
            state,
            bundled.has(edge.elementId),
            true,
          );
      const expandedLocalBest = expandedLocalCandidates
        ? bestRouteCandidate(
            bundled.has(edge.elementId)
              ? expandedLocalCandidates.filter((candidate) => !duplicatesBundlePeer(candidate, edge, others))
              : expandedLocalCandidates,
            edge,
            obstacles,
            others,
          )
        : undefined;
      const obstacleFreeLocalBest = expandedLocalBest?.cost[0] === 0 ? expandedLocalBest : localBest;
      if (obstacleFreeLocalBest?.cost[0] === 0) {
        if (compareRouteCandidate(
          obstacleFreeLocalBest.cost,
          obstacleFreeLocalBest.candidate,
          baseCost,
          base,
        ) < 0) {
          setRoutedEdgeRoute(routes, routeStates, edge, obstacleFreeLocalBest.candidate);
        }
        continue;
      }
      const frame = autoRouteFrame(base);
      if (performanceSample) performanceSample.visibilitySearches += 1;
      const middle = routeThroughGates(
        frame.gates,
        base,
        [...obstacles, ...endpointRoutingObstacles(edge, state)],
        others,
        edge,
        state,
      );
      if (!middle) continue;
      const candidate = frameRoute(frame, middle);
      const candidateCost = routeCost(candidate, edge, obstacles, others);
      if (
        (baseCost[0] === 0 || candidateCost[0] === 0)
        && (!bundled.has(edge.elementId) || !duplicatesBundlePeer(candidate, edge, others))
        && compareRouteCandidate(candidateCost, candidate, baseCost, base) < 0
      ) setRoutedEdgeRoute(routes, routeStates, edge, candidate);
    }
  }
  if (performanceSample) {
    performanceSample.refinementMs = monotonicMilliseconds() - refinementStartedAt;
  }
  const compactionStartedAt = performanceSample ? monotonicMilliseconds() : 0;
  const result = compactDerivedRoutes(routes, state, performanceSample, routeStates);
  if (performanceSample) {
    performanceSample.compactionMs = monotonicMilliseconds() - compactionStartedAt;
  }
  return result;
}

/** Linear-time cardinality completion used beyond the bounded quality grid. */
function compactLargeDerivedRoutes(
  input: Record<string, Point[]>,
  state: LayoutState,
): Record<string, Point[]> {
  const edges = new Map(state.edges.map((edge) => [edge.elementId, edge]));
  return Object.fromEntries(Object.entries(input).map(([edgeId, points]) => {
    const edge = edges.get(edgeId);
    if (
      !edge
      || isFixedDerivedRoute(edge, state)
      || isImmutableRoute(edge)
      || edge.routeMode === "straight"
      || points.length <= 3
    ) {
      return [edgeId, points.map(copyPoint)];
    }
    const start = points[0]!;
    const end = points.at(-1)!;
    const internal = points.slice(1, -1);
    const lineMiddle = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
    const pivot = internal.reduce((best, point) => (
      pointDistance(point, lineMiddle) < pointDistance(best, lineMiddle) ? point : best
    ), internal[0]!);
    return [edgeId, [copyPoint(start), copyPoint(pivot), copyPoint(end)]];
  }));
}

/**
 * Keeps generated routes readable as either a direct segment or a two-leg
 * route with one derived pivot. The visibility-grid pass above may use a
 * richer private corridor while searching; this completion step deliberately
 * exposes at most one intermediate point to renderer/host consumers.
 *
 * Manual routes are presentation input and remain exact hard constraints.
 */
function compactDerivedRoutes(
  input: Record<string, Point[]>,
  state: LayoutState,
  performanceSample?: StandardLayoutPerformanceAccumulator,
  routeStates: Map<string, RoutedEdgeState> = indexRoutedEdgeStates(state.edges, input),
): Record<string, Point[]> {
  const routes = Object.fromEntries(Object.entries(input).map(([id, points]) => [
    id,
    points.map(copyPoint),
  ]));
  const sorted = [...state.edges].sort(compareEdge);
  const bundled = new Set(
    [...edgeBundles(sorted).values()]
      .filter((edges) => edges.length > 1)
      .flatMap((edges) => edges.map((edge) => edge.elementId)),
  );
  const affected = sorted.filter((edge) => !isFixedDerivedRoute(edge, state));
  const orders = [affected, [...affected].reverse()];
  for (const order of orders) {
    for (const edge of order) {
      const base = routes[edge.elementId];
      if (!base || base.length < 2 || isImmutableRoute(edge) || edge.routeMode === "straight") {
        continue;
      }
      const others = routedOthers(sorted, routeStates, edge, state);
      const obstacles = routeObstacles(edge, state);
      const baseCost = routeCost(base, edge, obstacles, others);
      if (
        base.length <= 3
        && baseCost[0] === 0
        && baseCost[1] === 0
        && baseCost[2] === 0
        && baseCost[3] === 0
      ) continue;
      const candidates = compactRouteCandidates(
        edge,
        base,
        obstacles,
        others,
        state,
        bundled.has(edge.elementId),
      );
      if (performanceSample) {
        performanceSample.compactedEdges += 1;
        performanceSample.compactionCandidates += candidates.length;
      }
      const distinctCandidates = bundled.has(edge.elementId)
        ? candidates.filter((candidate) => !duplicatesBundlePeer(candidate, edge, others))
        : candidates;
      if (distinctCandidates.length === 0) continue;
      const best = bestRouteCandidate(
        distinctCandidates,
        edge,
        obstacles,
        others,
      );
      const expandedCandidates = best?.cost[0] === 0
        ? undefined
        : compactRouteCandidates(
            edge,
            base,
            obstacles,
            others,
            state,
            bundled.has(edge.elementId),
            true,
          );
      if (performanceSample && expandedCandidates) {
        performanceSample.compactionCandidates += expandedCandidates.length;
      }
      const expandedBest = expandedCandidates
        ? bestRouteCandidate(
            bundled.has(edge.elementId)
              ? expandedCandidates.filter((candidate) => !duplicatesBundlePeer(candidate, edge, others))
              : expandedCandidates,
            edge,
            obstacles,
            others,
          )
        : undefined;
      const selected = expandedBest ?? best;
      if (selected) setRoutedEdgeRoute(routes, routeStates, edge, selected.candidate);
    }
  }
  return routes;
}

function bestRouteCandidate(
  candidates: readonly Point[][],
  edge: LayoutEdge,
  obstacles: readonly RouteObstacle[],
  others: readonly RoutedEdge[],
): { candidate: Point[]; cost: RouteCost } | undefined {
  const obstacleCosts = candidates.map((candidate) => {
    const bounds = pointBounds(candidate);
    return {
      candidate,
      bounds,
      signature: routeSignature(candidate),
      obstacleCost: routeObstacleCost(candidate, bounds, obstacles),
    };
  });
  const minimumBodyIntersections = Math.min(
    ...obstacleCosts.map((item) => item.obstacleCost.bodyIntersections),
  );
  let best: { candidate: Point[]; cost: RouteCost; signature: string } | undefined;
  for (const item of obstacleCosts) {
    if (item.obstacleCost.bodyIntersections !== minimumBodyIntersections) continue;
    const cost = routeCostWithObstacleIntersections(
      item.candidate,
      item.bounds,
      item.obstacleCost,
      edge,
      others,
    );
    if (
      !best
      || compareNumberTuples(cost, best.cost) < 0
      || (compareNumberTuples(cost, best.cost) === 0
        && compareText(item.signature, best.signature) < 0)
    ) best = { candidate: item.candidate, cost, signature: item.signature };
  }
  return best ? { candidate: best.candidate, cost: best.cost } : undefined;
}

function compactRouteCandidates(
  edge: LayoutEdge,
  base: readonly Point[],
  obstacles: readonly RouteObstacle[],
  others: readonly RoutedEdge[],
  state: LayoutState,
  preserveLane: boolean,
  includeClearanceGrid = false,
): Point[][] {
  const source = state.geometries[edge.sourceElementId];
  const target = state.geometries[edge.targetElementId];
  if (!source || !target) return [];
  if (edge.sourceElementId === edge.targetElementId) {
    const start = base[0]!;
    const end = base.at(-1)!;
    const internal = base.slice(1, -1);
    const center = centerOf(source);
    const pivot = internal.length > 0
      ? internal.reduce((best, point) => (
          pointDistance(point, center) > pointDistance(best, center) ? point : best
        ), internal[0]!)
      : { x: source.x + source.width + SELF_LOOP_BASE, y: center.y };
    const result = [copyPoint(start), copyPoint(pivot), copyPoint(end)];
    return endpointLegsLeaveElements(result, source, target) ? [result] : [];
  }

  const sourceCenter = centerOf(source);
  const targetCenter = centerOf(target);
  // Keep ordinary crossing/overlap alternatives local. Only the obstacle
  // fallback may widen to the scene span: node traversal is the first cost
  // component, while an unavoidable route-route crossing must not cause a
  // scene-wide detour.
  const maximumDetour = includeClearanceGrid
    ? obstacleFallbackDetour(base, source, target, obstacles)
    : 240;
  const pivotBounds = {
    x: Math.min(source.x, target.x) - maximumDetour,
    y: Math.min(source.y, target.y) - maximumDetour,
    width: Math.max(source.x + source.width, target.x + target.width)
      - Math.min(source.x, target.x) + maximumDetour * 2,
    height: Math.max(source.y + source.height, target.y + target.height)
      - Math.min(source.y, target.y) + maximumDetour * 2,
  };
  const pivots: Point[] = [
    ...base.slice(1, -1).filter((point) => pointInsideOrOnGeometry(point, pivotBounds)).map(copyPoint),
    { x: sourceCenter.x, y: targetCenter.y },
    { x: targetCenter.x, y: sourceCenter.y },
    { x: (sourceCenter.x + targetCenter.x) / 2, y: sourceCenter.y },
    { x: (sourceCenter.x + targetCenter.x) / 2, y: targetCenter.y },
    { x: sourceCenter.x, y: (sourceCenter.y + targetCenter.y) / 2 },
    { x: targetCenter.x, y: (sourceCenter.y + targetCenter.y) / 2 },
    { x: sourceCenter.x, y: pivotBounds.y },
    { x: (sourceCenter.x + targetCenter.x) / 2, y: pivotBounds.y },
    { x: targetCenter.x, y: pivotBounds.y },
    { x: sourceCenter.x, y: pivotBounds.y + pivotBounds.height },
    { x: (sourceCenter.x + targetCenter.x) / 2, y: pivotBounds.y + pivotBounds.height },
    { x: targetCenter.x, y: pivotBounds.y + pivotBounds.height },
  ];
  for (const obstacle of obstacles) {
    pivots.push(...[
      { x: obstacle.x, y: obstacle.y },
      { x: obstacle.x + obstacle.width, y: obstacle.y },
      { x: obstacle.x, y: obstacle.y + obstacle.height },
      { x: obstacle.x + obstacle.width, y: obstacle.y + obstacle.height },
    ].filter((point) => pointInsideOrOnGeometry(point, pivotBounds)));
  }
  const nearbyObstacles = obstacles.filter((obstacle) => geometriesOverlapOrTouch(
    obstacle,
    pivotBounds,
  ));
  if (nearbyObstacles.length > 0) {
    const left = Math.min(...nearbyObstacles.map((obstacle) => obstacle.x));
    const right = Math.max(...nearbyObstacles.map((obstacle) => obstacle.x + obstacle.width));
    const top = Math.min(...nearbyObstacles.map((obstacle) => obstacle.y));
    const bottom = Math.max(...nearbyObstacles.map((obstacle) => obstacle.y + obstacle.height));
    const middleX = (sourceCenter.x + targetCenter.x) / 2;
    const middleY = (sourceCenter.y + targetCenter.y) / 2;
    for (const clearance of [48, 96, 192, maximumDetour]) {
      pivots.push(
        { x: middleX, y: Math.max(pivotBounds.y, top - clearance) },
        { x: middleX, y: Math.min(pivotBounds.y + pivotBounds.height, bottom + clearance) },
        { x: Math.max(pivotBounds.x, left - clearance), y: middleY },
        { x: Math.min(pivotBounds.x + pivotBounds.width, right + clearance), y: middleY },
      );
    }
    for (const obstacle of nearbyObstacles) {
      for (const x of [obstacle.x, obstacle.x + obstacle.width]) {
        if (x < pivotBounds.x || x > pivotBounds.x + pivotBounds.width) continue;
        pivots.push(
          { x, y: pivotBounds.y },
          { x, y: pivotBounds.y + pivotBounds.height },
        );
      }
      for (const y of [obstacle.y, obstacle.y + obstacle.height]) {
        if (y < pivotBounds.y || y > pivotBounds.y + pivotBounds.height) continue;
        pivots.push(
          { x: pivotBounds.x, y },
          { x: pivotBounds.x + pivotBounds.width, y },
        );
      }
    }
    if (includeClearanceGrid) {
      const xValues = [...new Set(nearbyObstacles.flatMap((obstacle) => [
        obstacle.x,
        obstacle.x + obstacle.width,
      ]))];
      const yValues = [...new Set(nearbyObstacles.flatMap((obstacle) => [
        obstacle.y,
        obstacle.y + obstacle.height,
      ]))];
      for (const x of xValues) {
        if (x < pivotBounds.x || x > pivotBounds.x + pivotBounds.width) continue;
        for (const y of yValues) {
          if (y < pivotBounds.y || y > pivotBounds.y + pivotBounds.height) continue;
          pivots.push({ x, y });
        }
      }
      for (const x of boundedClearanceAxis(pivotBounds.x, pivotBounds.x + pivotBounds.width)) {
        for (const y of boundedClearanceAxis(pivotBounds.y, pivotBounds.y + pivotBounds.height)) {
          pivots.push({ x, y });
        }
      }
    }
  }
  for (const other of preserveLane ? [] : others) {
    if (!geometriesOverlapOrTouch(other.bounds, pivotBounds)) continue;
    for (let index = 0; index < other.points.length - 1; index += 1) {
      const start = other.points[index]!;
      const end = other.points[index + 1]!;
      if (start.y === end.y) {
        const y = start.y;
        const left = Math.min(start.x, end.x) - ROUTE_OBSTACLE_PADDING;
        const right = Math.max(start.x, end.x) + ROUTE_OBSTACLE_PADDING;
        pivots.push(
          { x: Math.max(pivotBounds.x, left), y },
          { x: Math.min(pivotBounds.x + pivotBounds.width, right), y },
        );
      } else if (start.x === end.x) {
        const x = start.x;
        const top = Math.min(start.y, end.y) - ROUTE_OBSTACLE_PADDING;
        const bottom = Math.max(start.y, end.y) + ROUTE_OBSTACLE_PADDING;
        pivots.push(
          { x, y: Math.max(pivotBounds.y, top) },
          { x, y: Math.min(pivotBounds.y + pivotBounds.height, bottom) },
        );
      }
    }
  }
  const candidates = new Map<string, Point[]>();
  const add = (route: Point[]): void => {
    const simplified = simplifyOrthogonalRoute(route);
    if (
      simplified.length < 2
      || simplified.length > 3
      || !endpointLegsLeaveElements(simplified, source, target)
    ) return;
    candidates.set(routeSignature(simplified), simplified.map(copyPoint));
  };
  if (!preserveLane) {
    add(applyEndpointAnchors(
      directRoute(edge, source, target, state),
      edge,
      source,
      target,
      state,
    ));
  }
  const candidatePivots = preserveLane ? base.slice(1, -1) : pivots;
  for (const pivot of candidatePivots) {
    if (!pointInsideOrOnGeometry(pivot, pivotBounds)) continue;
    if (!preserveLane) {
      const sourcePoint = compactEndpointPoint(edge, "source", source, pivot, state);
      const targetPoint = compactEndpointPoint(edge, "target", target, pivot, state);
      if (!samePoint(sourcePoint, pivot) && !samePoint(targetPoint, pivot)) {
        add([sourcePoint, copyPoint(pivot), targetPoint]);
      }
    }

    // Preserve a stable lane/ELK attachment as another candidate. The outward
    // leg check rejects stale attachments that would first traverse a node.
    add([copyPoint(base[0]!), copyPoint(pivot), copyPoint(base.at(-1)!)]);
  }
  return [...candidates.values()];
}

function obstacleFallbackDetour(
  base: readonly Point[],
  source: ElementGeometry,
  target: ElementGeometry,
  obstacles: readonly RouteObstacle[],
): number {
  const blockers = obstacles.filter((obstacle) => (
    obstacle.kind === "body" && polylineIntersectsAnyGeometry(base, [obstacle])
  ));
  if (blockers.length === 0) return 720;
  const endpointLeft = Math.min(source.x, target.x);
  const endpointTop = Math.min(source.y, target.y);
  const endpointRight = Math.max(source.x + source.width, target.x + target.width);
  const endpointBottom = Math.max(source.y + source.height, target.y + target.height);
  const clearance = 96;
  return Math.max(
    720,
    ...blockers.flatMap((obstacle) => [
      endpointLeft - obstacle.x + clearance,
      obstacle.x + obstacle.width - endpointRight + clearance,
      endpointTop - obstacle.y + clearance,
      obstacle.y + obstacle.height - endpointBottom + clearance,
      ...onePivotObstacleDetours(source, target, obstacle, clearance),
    ]),
  );
}

function onePivotObstacleDetours(
  source: ElementGeometry,
  target: ElementGeometry,
  obstacle: ElementGeometry,
  clearance: number,
): number[] {
  const sourceCenter = centerOf(source);
  const targetCenter = centerOf(target);
  const pivotX = (sourceCenter.x + targetCenter.x) / 2;
  const pivotY = (sourceCenter.y + targetCenter.y) / 2;
  const verticalBounds: number[] = [];
  const horizontalBounds: number[] = [];
  for (const endpoint of [sourceCenter, targetCenter]) {
    const xBoundary = endpoint.x < obstacle.x && pivotX > obstacle.x
      ? obstacle.x
      : endpoint.x > obstacle.x + obstacle.width && pivotX < obstacle.x + obstacle.width
        ? obstacle.x + obstacle.width
        : undefined;
    if (xBoundary !== undefined && pivotX !== endpoint.x) {
      const ratio = (xBoundary - endpoint.x) / (pivotX - endpoint.x);
      if (ratio > 0 && ratio <= 1) {
        verticalBounds.push(
          endpoint.y + (obstacle.y - clearance - endpoint.y) / ratio,
          endpoint.y + (obstacle.y + obstacle.height + clearance - endpoint.y) / ratio,
        );
      }
    }
    const yBoundary = endpoint.y < obstacle.y && pivotY > obstacle.y
      ? obstacle.y
      : endpoint.y > obstacle.y + obstacle.height && pivotY < obstacle.y + obstacle.height
        ? obstacle.y + obstacle.height
        : undefined;
    if (yBoundary !== undefined && pivotY !== endpoint.y) {
      const ratio = (yBoundary - endpoint.y) / (pivotY - endpoint.y);
      if (ratio > 0 && ratio <= 1) {
        horizontalBounds.push(
          endpoint.x + (obstacle.x - clearance - endpoint.x) / ratio,
          endpoint.x + (obstacle.x + obstacle.width + clearance - endpoint.x) / ratio,
        );
      }
    }
  }
  return [
    ...verticalBounds.map((value) => Math.max(
      Math.abs(value - sourceCenter.y),
      Math.abs(value - targetCenter.y),
    )),
    ...horizontalBounds.map((value) => Math.max(
      Math.abs(value - sourceCenter.x),
      Math.abs(value - targetCenter.x),
    )),
  ];
}

/** Keeps fallback search cardinality bounded even for very large user nodes. */
function boundedClearanceAxis(start: number, end: number): number[] {
  const minimumStep = 20;
  const maximumIntervals = 40;
  const intervals = Math.max(1, Math.min(
    maximumIntervals,
    Math.ceil((end - start) / minimumStep),
  ));
  return Array.from({ length: intervals + 1 }, (_, index) => (
    start + (end - start) * index / intervals
  ));
}

/** Parallel and reciprocal statements must remain individually selectable. */
function duplicatesBundlePeer(
  candidate: readonly Point[],
  edge: LayoutEdge,
  others: readonly RoutedEdge[],
): boolean {
  const pair = canonicalEndpointPair(edge);
  const signature = routeSignature(candidate);
  return others.some((other) => {
    const otherPair = canonicalEndpointPair(other.edge);
    return pair[0] === otherPair[0]
      && pair[1] === otherPair[1]
      && routeSignature(other.points) === signature;
  });
}

function geometriesOverlapOrTouch(left: ElementGeometry, right: ElementGeometry): boolean {
  return left.x <= right.x + right.width
    && left.x + left.width >= right.x
    && left.y <= right.y + right.height
    && left.y + left.height >= right.y;
}

function compactEndpointPoint(
  edge: LayoutEdge,
  endpoint: "source" | "target",
  geometry: ElementGeometry,
  toward: Point,
  state: LayoutState,
): Point {
  const anchor = endpoint === "source" ? edge.sourceAnchor : edge.targetAnchor;
  const elementId = endpoint === "source" ? edge.sourceElementId : edge.targetElementId;
  return edgeEndpointAnchorPoint(
    geometry,
    layoutElementShape(state.elements.get(elementId)),
    isValidEdgeEndpointAnchor(anchor) ? anchor : edgeEndpointAnchorFromPoint(geometry, toward),
  );
}

function endpointLegsLeaveElements(
  route: readonly Point[],
  source: ElementGeometry,
  target: ElementGeometry,
): boolean {
  const start = route[0];
  const afterStart = route[1];
  const beforeEnd = route.at(-2);
  const end = route.at(-1);
  if (!start || !afterStart || !beforeEnd || !end) return false;
  const sourceCenter = centerOf(source);
  const targetCenter = centerOf(target);
  return dotProduct(
    { x: start.x - sourceCenter.x, y: start.y - sourceCenter.y },
    { x: afterStart.x - start.x, y: afterStart.y - start.y },
  ) >= -1e-6
    && dotProduct(
      { x: end.x - targetCenter.x, y: end.y - targetCenter.y },
      { x: beforeEnd.x - end.x, y: beforeEnd.y - end.y },
    ) >= -1e-6;
}

function dotProduct(left: Point, right: Point): number {
  return left.x * right.x + left.y * right.y;
}

function isImmutableRoute(edge: LayoutEdge): boolean {
  return edge.routingPlacement === "user" || edge.routeMode === "manual";
}

function isFixedDerivedRoute(edge: LayoutEdge, state: LayoutState): boolean {
  return state.fixedDerivedRoutes.has(edge.elementId);
}

function routeObstacles(edge: LayoutEdge, state: LayoutState): RouteObstacle[] {
  const endpointPair = canonicalEndpointPair(edge).join("\n");
  const cached = state.routeObstaclesByEndpointPair.get(endpointPair);
  if (cached) return cached;
  const result: RouteObstacle[] = [];
  for (const element of [...state.elements.values()].sort(compareElement)) {
    if (element.structuralKind !== "node" && element.structuralKind !== "annotation") continue;
    const geometry = state.geometries[element.elementId];
    if (!geometry) continue;
    if (element.elementId !== edge.sourceElementId && element.elementId !== edge.targetElementId) {
      result.push({ ...copyGeometry(geometry), kind: "body" });
    }
    for (const reservation of layoutExternalReservationGeometries(element, geometry)) {
      result.push({ ...copyGeometry(reservation), kind: "reservation" });
    }
  }
  state.routeObstaclesByEndpointPair.set(endpointPair, result);
  return result;
}

function routedOthers(
  sorted: readonly LayoutEdge[],
  routeStates: ReadonlyMap<string, RoutedEdgeState>,
  currentEdge: LayoutEdge,
  state: LayoutState,
): RoutedEdge[] {
  const result: RoutedEdge[] = [];
  for (const edge of sorted) {
    if (edge.elementId === currentEdge.elementId) continue;
    const routed = routeStates.get(edge.elementId);
    if (!routed) continue;
    const pairKey = compareText(currentEdge.elementId, edge.elementId) <= 0
      ? `${currentEdge.elementId}\n${edge.elementId}`
      : `${edge.elementId}\n${currentEdge.elementId}`;
    let sharedEndpointGeometries = state.sharedEndpointGeometriesByEdgePair.get(pairKey);
    if (!sharedEndpointGeometries) {
      sharedEndpointGeometries = sharedEndpointIds(currentEdge, edge).flatMap((id) => {
        const geometry = state.geometries[id];
        return geometry ? [expandGeometry(geometry, ROUTE_ENDPOINT_STUB + 1)] : [];
      });
      state.sharedEndpointGeometriesByEdgePair.set(pairKey, sharedEndpointGeometries);
    }
    result.push({
      edge: routed.edge,
      points: routed.points,
      bounds: routed.bounds,
      sharedEndpointGeometries,
    });
  }
  return result;
}

function indexRoutedEdgeStates(
  edges: readonly LayoutEdge[],
  routes: Readonly<Record<string, Point[]>>,
): Map<string, RoutedEdgeState> {
  return new Map(edges.flatMap((edge) => {
    const points = routes[edge.elementId];
    return points ? [[edge.elementId, {
      edge,
      points,
      bounds: pointBounds(points),
    }] as const] : [];
  }));
}

function setRoutedEdgeRoute(
  routes: Record<string, Point[]>,
  routeStates: Map<string, RoutedEdgeState>,
  edge: LayoutEdge,
  input: readonly Point[],
): void {
  const points = input.map(copyPoint);
  routes[edge.elementId] = points;
  routeStates.set(edge.elementId, {
    edge,
    points,
    bounds: pointBounds(points),
  });
}

function endpointRoutingObstacles(edge: LayoutEdge, state: LayoutState): ElementGeometry[] {
  return [...new Set([edge.sourceElementId, edge.targetElementId])].flatMap((id) => {
    const geometry = state.geometries[id];
    return geometry ? [copyGeometry(geometry)] : [];
  });
}

type AutoRouteFrame = {
  prefix: Point[];
  gates: Point[];
  suffix: Point[];
};

function autoRouteFrame(base: readonly Point[]): AutoRouteFrame {
  const start = base[0];
  const end = base.at(-1);
  if (!start || !end) return { prefix: [], gates: [], suffix: [] };
  if (base.length < 4) {
    return { prefix: [copyPoint(start)], gates: [copyPoint(start), copyPoint(end)], suffix: [] };
  }
  const sourceHalo = base[1]!;
  const targetHalo = base.at(-2)!;
  return {
    prefix: [copyPoint(start)],
    gates: [copyPoint(sourceHalo), copyPoint(targetHalo)],
    suffix: [copyPoint(end)],
  };
}

function frameRoute(frame: AutoRouteFrame, middle: readonly Point[]): Point[] {
  const result = frame.prefix.map(copyPoint);
  if (middle.length > 0) appendConnectedRoute(result, middle);
  if (frame.suffix.length > 0) appendConnectedRoute(result, frame.suffix);
  return simplifyOrthogonalRoute(result);
}

function routeThroughGates(
  gates: readonly Point[],
  base: readonly Point[],
  allObstacles: readonly ElementGeometry[],
  committed: readonly RoutedEdge[],
  edge: LayoutEdge,
  state: LayoutState,
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
      edge,
      state,
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
  edge: LayoutEdge,
  state: LayoutState,
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
      const interaction = segmentInteraction(point, target, edge, committed, state, true);
      const nextCost: RouteSearchCost = [
        current.cost[0] + interaction.crossings,
        current.cost[1] + interaction.overlapLength,
        current.cost[2] + pointDistance(point, target),
        current.cost[3] + (current.direction !== 0 && current.direction !== neighbor.direction ? 1 : 0),
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
  edge: LayoutEdge,
  obstacles: readonly RouteObstacle[],
  committed: readonly RoutedEdge[],
): RouteCost {
  const bounds = pointBounds(route);
  const obstacleCost = routeObstacleCost(route, bounds, obstacles);
  return routeCostWithObstacleIntersections(
    route,
    bounds,
    obstacleCost,
    edge,
    committed,
  );
}

function routeObstacleCost(
  route: readonly Point[],
  bounds: ElementGeometry,
  obstacles: readonly RouteObstacle[],
): { bodyIntersections: number; reservationIntersections: number } {
  let bodyIntersections = 0;
  let reservationIntersections = 0;
  for (const obstacle of obstacles) {
    if (!geometriesOverlapOrTouch(bounds, obstacle)) continue;
    for (let index = 0; index < route.length - 1; index += 1) {
      if (
        segmentIntersectsGeometry(route[index]!, route[index + 1]!, obstacle)
      ) {
        if (obstacle.kind === "body") bodyIntersections += 1;
        else reservationIntersections += 1;
      }
    }
  }
  return { bodyIntersections, reservationIntersections };
}

function routeCostWithObstacleIntersections(
  route: readonly Point[],
  bounds: ElementGeometry,
  obstacleCost: { bodyIntersections: number; reservationIntersections: number },
  edge: LayoutEdge,
  committed: readonly RoutedEdge[],
): RouteCost {
  let overlapLength = 0;
  let crossings = 0;
  for (const routed of committed) {
    const interaction = polylineInteraction(route, bounds, routed);
    overlapLength += interaction.overlapLength;
    crossings += interaction.crossings;
  }
  return [
    obstacleCost.bodyIntersections,
    crossings,
    obstacleCost.reservationIntersections,
    overlapLength,
    routeLength(route),
    routeBends(route),
  ];
}

function polylineInteraction(
  points: readonly Point[],
  bounds: ElementGeometry,
  routed: RoutedEdge,
): { overlapLength: number; crossings: number } {
  if (!geometriesOverlapOrTouch(bounds, routed.bounds)) {
    return { overlapLength: 0, crossings: 0 };
  }
  const sharedEndpointGeometries = routed.sharedEndpointGeometries;
  let overlapLength = 0;
  const crossingPoints: Point[] = [];
  for (let leftIndex = 0; leftIndex < points.length - 1; leftIndex += 1) {
    const leftStart = points[leftIndex]!;
    const leftEnd = points[leftIndex + 1]!;
    for (let rightIndex = 0; rightIndex < routed.points.length - 1; rightIndex += 1) {
      const rightStart = routed.points[rightIndex]!;
      const rightEnd = routed.points[rightIndex + 1]!;
      overlapLength += collinearOverlapLengthOutsideGeometries(
        leftStart,
        leftEnd,
        rightStart,
        rightEnd,
        sharedEndpointGeometries,
      );
      const intersection = segmentIntersectionPoint(
        leftStart,
        leftEnd,
        rightStart,
        rightEnd,
        true,
      );
      if (
        intersection
        && !sharedEndpointGeometries.some((geometry) => pointInsideOrOnGeometry(intersection, geometry))
        && !crossingPoints.some((point) => samePoint(point, intersection))
      ) crossingPoints.push(intersection);
    }
  }
  return { overlapLength, crossings: crossingPoints.length };
}

function segmentInteraction(
  start: Point,
  end: Point,
  edge: LayoutEdge,
  committed: readonly RoutedEdge[],
  state: LayoutState,
  includeCandidateEndpoints = false,
): { overlapLength: number; crossings: number } {
  const bounds = pointBounds([start, end]);
  let overlapLength = 0;
  let crossings = 0;
  for (const routed of committed) {
    if (!geometriesOverlapOrTouch(bounds, routed.bounds)) continue;
    const sharedEndpointGeometries = routed.sharedEndpointGeometries.length > 0
      ? routed.sharedEndpointGeometries
      : sharedEndpointIds(edge, routed.edge).flatMap((id) => {
          const geometry = state.geometries[id];
          return geometry ? [expandGeometry(geometry, ROUTE_ENDPOINT_STUB + 1)] : [];
        });
    for (let index = 0; index < routed.points.length - 1; index += 1) {
      const otherStart = routed.points[index]!;
      const otherEnd = routed.points[index + 1]!;
      overlapLength += collinearOverlapLengthOutsideGeometries(
        start,
        end,
        otherStart,
        otherEnd,
        sharedEndpointGeometries,
      );
      const intersection = segmentIntersectionPoint(start, end, otherStart, otherEnd, includeCandidateEndpoints);
      if (
        intersection
        && !sharedEndpointGeometries.some((geometry) => pointInsideOrOnGeometry(intersection, geometry))
      ) crossings += 1;
    }
  }
  return { overlapLength, crossings };
}

function sharedEndpointIds(left: LayoutEdge, right: LayoutEdge): string[] {
  return [...new Set([
    left.sourceElementId,
    left.targetElementId,
  ].filter((id) => id === right.sourceElementId || id === right.targetElementId))];
}

function segmentIntersectionPoint(
  leftStart: Point,
  leftEnd: Point,
  rightStart: Point,
  rightEnd: Point,
  includeLeftEndpoints: boolean,
): Point | undefined {
  const leftDx = leftEnd.x - leftStart.x;
  const leftDy = leftEnd.y - leftStart.y;
  const rightDx = rightEnd.x - rightStart.x;
  const rightDy = rightEnd.y - rightStart.y;
  const denominator = leftDx * rightDy - leftDy * rightDx;
  if (denominator === 0) return undefined;
  const offsetX = rightStart.x - leftStart.x;
  const offsetY = rightStart.y - leftStart.y;
  const leftRatio = (offsetX * rightDy - offsetY * rightDx) / denominator;
  const rightRatio = (offsetX * leftDy - offsetY * leftDx) / denominator;
  const leftInside = includeLeftEndpoints
    ? leftRatio >= 0 && leftRatio <= 1
    : leftRatio > 0 && leftRatio < 1;
  const rightInside = includeLeftEndpoints
    ? rightRatio >= 0 && rightRatio <= 1
    : rightRatio > 0 && rightRatio < 1;
  if (!leftInside || !rightInside) return undefined;
  return {
    x: leftStart.x + leftDx * leftRatio,
    y: leftStart.y + leftDy * leftRatio,
  };
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

function polylineIntersectsAnyGeometry(
  route: readonly Point[],
  geometries: readonly ElementGeometry[],
): boolean {
  return geometries.some((geometry) => polylineIntersectsGeometry(route, geometry));
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

function pointInsideOrOnGeometry(point: Point, geometry: ElementGeometry): boolean {
  return point.x >= geometry.x
    && point.x <= geometry.x + geometry.width
    && point.y >= geometry.y
    && point.y <= geometry.y + geometry.height;
}

function collinearOverlapLengthOutsideGeometries(
  leftStart: Point,
  leftEnd: Point,
  rightStart: Point,
  rightEnd: Point,
  excluded: readonly ElementGeometry[],
): number {
  const vertical = leftStart.x === leftEnd.x
    && rightStart.x === rightEnd.x
    && leftStart.x === rightStart.x;
  const horizontal = leftStart.y === leftEnd.y
    && rightStart.y === rightEnd.y
    && leftStart.y === rightStart.y;
  if (!vertical && !horizontal) return 0;
  const leftA = vertical ? leftStart.y : leftStart.x;
  const leftB = vertical ? leftEnd.y : leftEnd.x;
  const rightA = vertical ? rightStart.y : rightStart.x;
  const rightB = vertical ? rightEnd.y : rightEnd.x;
  const low = Math.max(Math.min(leftA, leftB), Math.min(rightA, rightB));
  const high = Math.min(Math.max(leftA, leftB), Math.max(rightA, rightB));
  if (high <= low) return 0;
  const coordinate = vertical ? leftStart.x : leftStart.y;
  const cuts = excluded.flatMap((geometry): Array<readonly [number, number]> => {
    const crossLow = vertical ? geometry.x : geometry.y;
    const crossHigh = vertical
      ? geometry.x + geometry.width
      : geometry.y + geometry.height;
    if (coordinate < crossLow || coordinate > crossHigh) return [];
    const axisLow = vertical ? geometry.y : geometry.x;
    const axisHigh = vertical
      ? geometry.y + geometry.height
      : geometry.x + geometry.width;
    const cutLow = Math.max(low, axisLow);
    const cutHigh = Math.min(high, axisHigh);
    return cutHigh > cutLow ? [[cutLow, cutHigh] as const] : [];
  }).sort((left, right) => left[0] - right[0] || left[1] - right[1]);
  let excludedLength = 0;
  let cursor = low;
  for (const [cutLow, cutHigh] of cuts) {
    if (cutHigh <= cursor) continue;
    excludedLength += cutHigh - Math.max(cursor, cutLow);
    cursor = Math.max(cursor, cutHigh);
  }
  return Math.max(0, high - low - excludedLength);
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
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    left = Math.min(left, point.x);
    top = Math.min(top, point.y);
    right = Math.max(right, point.x);
    bottom = Math.max(bottom, point.y);
  }
  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
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
    if (isFixedDerivedRoute(edge, state)) return;
    if (edge.routeMode === "straight") {
      const centerY = geometry.y + geometry.height / 2;
      const inset = Math.max(4, Math.min(12, geometry.height / 4));
      routes[edge.elementId] = applyEndpointAnchors([
        { x: geometry.x + geometry.width, y: centerY - inset },
        { x: geometry.x + geometry.width, y: centerY + inset },
      ], edge, geometry, geometry, state);
      return;
    }
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

function withDerivedEndpointStubs(
  route: readonly Point[],
  edge: LayoutEdge,
  source: ElementGeometry,
  target: ElementGeometry,
  state: LayoutState,
): Point[] {
  if (route.length < 2 || isImmutableRoute(edge) || edge.routeMode === "straight") {
    return route.map(copyPoint);
  }
  // Preserve stable lane positions while the nominal flow axis matches the
  // actual geometry. If user geometry is primarily on the other axis, choose
  // the genuinely nearest facing sides instead of an LR/TB opposite-side port.
  const sourceCenter = centerOf(source);
  const targetCenter = centerOf(target);
  const horizontalSeparation = Math.abs(targetCenter.x - sourceCenter.x)
    >= Math.abs(targetCenter.y - sourceCenter.y);
  const nominalAxisMatches = state.direction === "LR"
    ? horizontalSeparation
    : !horizontalSeparation;
  const sourceToward = nominalAxisMatches ? route[0]! : targetCenter;
  const targetToward = nominalAxisMatches ? route.at(-1)! : sourceCenter;
  const sourceAnchor = isValidEdgeEndpointAnchor(edge.sourceAnchor)
    ? edge.sourceAnchor
    : edgeEndpointAnchorFromPoint(source, sourceToward);
  const targetAnchor = isValidEdgeEndpointAnchor(edge.targetAnchor)
    ? edge.targetAnchor
    : edgeEndpointAnchorFromPoint(target, targetToward);
  const sourceHalo = endpointRoutingHaloGeometry(
    source,
    layoutElementShape(state.elements.get(edge.sourceElementId)),
    sourceAnchor,
  );
  const targetHalo = endpointRoutingHaloGeometry(
    target,
    layoutElementShape(state.elements.get(edge.targetElementId)),
    targetAnchor,
  );
  return [
    sourceHalo.boundaryPoint,
    sourceHalo.haloPoint,
    ...route.slice(1, -1).map(copyPoint),
    targetHalo.haloPoint,
    targetHalo.boundaryPoint,
  ];
}

function endpointRoutingHaloGeometry(
  geometry: ElementGeometry,
  shape: EdgeEndpointShape,
  anchor: EdgeEndpointAnchor,
) {
  const initial = edgeEndpointAnchorHaloGeometry(geometry, shape, anchor, 0);
  const distances: number[] = [];
  if (initial.normal.x > 0) {
    distances.push((geometry.x + geometry.width - initial.boundaryPoint.x) / initial.normal.x);
  } else if (initial.normal.x < 0) {
    distances.push((geometry.x - initial.boundaryPoint.x) / initial.normal.x);
  }
  if (initial.normal.y > 0) {
    distances.push((geometry.y + geometry.height - initial.boundaryPoint.y) / initial.normal.y);
  } else if (initial.normal.y < 0) {
    distances.push((geometry.y - initial.boundaryPoint.y) / initial.normal.y);
  }
  const boxExitDistance = Math.min(...distances.filter((distance) => distance >= 0));
  const distance = Math.max(
    ROUTE_ENDPOINT_STUB,
    Number.isFinite(boxExitDistance) ? boxExitDistance + 1 : ROUTE_ENDPOINT_STUB,
  );
  return edgeEndpointAnchorHaloGeometry(geometry, shape, anchor, distance);
}

function layoutElementShape(element: LayoutElement | undefined): EdgeEndpointShape {
  return element?.shape ?? (element?.structuralKind === "container"
    ? "container"
    : element?.structuralKind === "region" ? "region" : "rectangle");
}

function manualWaypoints(edge: LayoutEdge): Point[] | undefined {
  return isImmutableRoute(edge) && edge.waypoints && edge.waypoints.length > 0
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

function monotonicMilliseconds(): number {
  return globalThis.performance?.now() ?? Date.now();
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
