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
  GroupFrameKind,
  Point,
} from "../document/model.js";
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
  /** Present only for the common Bag/classification/Seq/Alt Group Frame grammar. */
  groupRole?: GroupFrameKind;
  parentElementId?: string;
  geometry?: ElementGeometry;
  size?: { width: number; height: number };
  /**
   * DOM-free content measurement supplied by projection/host. Generated
   * geometry grows to this minimum; fixed/user geometry remains unchanged.
   */
  minimumContentSize?: { width: number; height: number };
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
  role?: "membership" | "sequence-member" | "alternative-member";
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
   * Transaction-local members that have just acquired a Group membership
   * constraint. Their persisted user placement remains authoritative metadata,
   * but this layout invocation may move them into the new parent without
   * disturbing the parent's existing subtree.
   */
  newlyConstrainedElementIds?: readonly string[];
  /**
   * Transaction-local surviving elements whose reconciled geometry must not
   * be regenerated during this semantic change, even when their persisted
   * placement remains `generated`.
   */
  preservedElementIds?: readonly string[];
  /**
   * Transaction-local renderer routes that must be reused exactly. This is
   * only valid for route-only execution and is never a portable overlay.
   */
  fixedDerivedRoutes?: Readonly<Record<string, readonly Point[]>>;
  /**
   * Renderer-only metadata paired with `fixedDerivedRoutes`. In particular,
   * this carries auto-curve controls which cannot be reconstructed from the
   * endpoint-only public route. It is transaction-local and never portable
   * overlay data.
   */
  fixedDerivedRouteChoices?: Readonly<Record<string, LayoutDerivedRouteChoice>>;
};

export type LayoutDiagnostic = {
  severity: "warning" | "error";
  code: string;
  message: string;
  layoutRef?: string;
  elementId?: string;
  edgeId?: string;
};

export type LayoutDerivedRouteFamily =
  | "straight"
  | "curve"
  | "polyline"
  | "orthogonal"
  | "manual";

export type LayoutDerivedRouteRejection = {
  family: "straight" | "orthogonal" | "curve";
  reason:
    | "obstacle"
    | "interaction"
    | "parallel-identity"
    | "self-loop"
    | "no-guide"
    | "tight-turn"
    | "endpoint-direction";
};

export type LayoutDerivedCurve = {
  /** Absolute renderer-only cubic controls; never persisted as a waypoint. */
  sourceControl: Point;
  targetControl: Point;
  /** Private corridor guide retained for diagnostics and reproducible tests. */
  guidePivot: Point;
  guideAngleDegrees: number;
};

export type LayoutDerivedRouteChoice = {
  family: LayoutDerivedRouteFamily;
  source: "auto" | "explicit" | "fixed";
  reason:
    | "auto-straight-safe"
    | "auto-orthogonal-safe"
    | "auto-curve-safe"
    | "auto-curve-fallback"
    | "auto-polyline-fallback"
    | "auto-self-loop-preserved"
    | "explicit-route-mode"
    | "fixed-derived-route";
  curve?: LayoutDerivedCurve;
  rejected?: LayoutDerivedRouteRejection[];
};

export type LayoutResult = {
  layoutRef: string;
  /** Adapter-resolved orientation reused by adapter-independent completion. */
  direction?: LayoutDirection;
  /** Adapter-independent group/region completion already ran before routing. */
  structuralCompletion?: true;
  geometries: Record<string, ElementGeometry>;
  /** Every route includes its source and target attachment points. */
  routes: Record<string, Point[]>;
  /** Renderer-only family/control output. It is not a portable overlay. */
  derivedRouteChoices?: Record<string, LayoutDerivedRouteChoice>;
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
  const expandableGroupIds = newlyConstrainedGeneratedOwnerIds(request);
  const preservedRequest = withElementsFixed(
    request,
    new Set(request.preservedElementIds ?? []),
  );
  const validationRequest = withElementsMovable(
    withNewlyConstrainedSubtreesMovable(preservedRequest),
    expandableGroupIds,
  );
  const requestDiagnostics = validateFixedDerivedRouteRequest(request);
  if (requestDiagnostics.length > 0) {
    return emptyResult(request.layoutRef, requestDiagnostics);
  }
  const resolution = registry.resolve(request.layoutRef);
  if (!resolution.resolved) return emptyResult(request.layoutRef, resolution.diagnostics);
  try {
    const result = await resolution.adapter.layout(preservedRequest);
    // `structuralCompletion` is an optimization hint, never a trust boundary.
    // Every adapter result crosses the same idempotent Group Frame completion.
    const completed = restoreFixedDerivedRoutes(
      preservedRequest,
      completeRegionLayout(
        preservedRequest,
        result,
        result.direction ?? "LR",
        expandableGroupIds,
      ),
    );
    const normalized = normalizeGeneratedAdapterRoutes(preservedRequest, completed);
    const invalid = validateAdapterResult(validationRequest, normalized);
    return invalid.length > 0
      ? emptyResult(request.layoutRef, [...normalized.diagnostics, ...invalid])
      : normalized;
  } catch (cause) {
    return emptyResult(request.layoutRef, [{
      severity: "error",
      code: "layout-adapter-failed",
      message: cause instanceof Error ? cause.message : String(cause),
      layoutRef: request.layoutRef,
    }]);
  }
}

function newlyConstrainedGeneratedOwnerIds(request: LayoutRequest): Set<string> {
  const constrained = new Set(request.newlyConstrainedElementIds ?? []);
  const elementById = new Map(request.scene.elements.map((element) => [element.elementId, element]));
  const ownersByMember = new Map<string, string[]>();
  for (const membership of request.scene.memberships ?? []) {
    const ownerId = membership.regionElementId ?? membership.containerElementId;
    const owners = ownersByMember.get(membership.memberElementId) ?? [];
    owners.push(ownerId);
    ownersByMember.set(membership.memberElementId, owners);
  }
  const result = new Set<string>();
  const visitOwners = (memberId: string): void => {
    for (const ownerId of ownersByMember.get(memberId) ?? []) {
      const owner = elementById.get(ownerId);
      if (!owner || !isGroupFrameElement(owner) || isFixed(owner) || result.has(ownerId)) continue;
      result.add(ownerId);
      visitOwners(ownerId);
    }
  };
  for (const memberId of constrained) visitOwners(memberId);
  return result;
}

function withNewlyConstrainedSubtreesMovable(request: LayoutRequest): LayoutRequest {
  return withElementsMovable(request, newlyConstrainedMovementIds(request));
}

function withElementsMovable(request: LayoutRequest, movableIds: ReadonlySet<string>): LayoutRequest {
  if (movableIds.size === 0) return request;
  return {
    ...request,
    scene: {
      ...request.scene,
      elements: request.scene.elements.map((element) => movableIds.has(element.elementId)
        ? { ...element, pinned: false, placement: "generated" }
        : element),
    },
  };
}

function withElementsFixed(request: LayoutRequest, fixedIds: ReadonlySet<string>): LayoutRequest {
  if (fixedIds.size === 0) return request;
  return {
    ...request,
    scene: {
      ...request.scene,
      elements: request.scene.elements.map((element) => fixedIds.has(element.elementId)
        ? { ...element, pinned: true, placement: "user" }
        : element),
    },
  };
}

function newlyConstrainedMovementIds(request: LayoutRequest): Set<string> {
  const result = new Set(request.newlyConstrainedElementIds ?? []);
  const childrenByOwner = new Map<string, string[]>();
  for (const element of request.scene.elements) {
    if (!element.parentElementId) continue;
    const children = childrenByOwner.get(element.parentElementId) ?? [];
    children.push(element.elementId);
    childrenByOwner.set(element.parentElementId, children);
  }
  for (const membership of request.scene.memberships ?? []) {
    const ownerId = membership.regionElementId ?? membership.containerElementId;
    const children = childrenByOwner.get(ownerId) ?? [];
    children.push(membership.memberElementId);
    childrenByOwner.set(ownerId, children);
  }
  const visit = (ownerId: string): void => {
    for (const childId of childrenByOwner.get(ownerId) ?? []) {
      if (result.has(childId)) continue;
      result.add(childId);
      visit(childId);
    }
  };
  for (const rootId of [...result]) visit(rootId);
  return result;
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
  const derivedRouteChoices = Object.fromEntries(Object.entries(candidate.derivedRouteChoices ?? {}).map(([
    edgeId,
    choice,
  ]) => [edgeId, cloneLayoutDerivedRouteChoice(choice)]));
  for (const [edgeId, route] of Object.entries(fixed)) {
    const requested = request.fixedDerivedRouteChoices?.[edgeId];
    derivedRouteChoices[edgeId] = requested
      ? cloneLayoutDerivedRouteChoice(requested)
      : fixedDerivedRouteChoiceFor(route);
  }
  const spacing = { ...DEFAULT_SPACING, ...request.spacing };
  const bounds = sceneBounds(
    layoutResultBoundGeometries(request, candidate.geometries),
    [
      ...Object.values(routes).flat(),
      ...layoutDerivedRouteControlPoints(derivedRouteChoices),
    ],
    spacing.margin,
  );
  return {
    ...candidate,
    routes,
    derivedRouteChoices,
    width: bounds.width,
    height: bounds.height,
  };
}

/**
 * Completes the common Bag/classification/Seq/Alt Group Frame grammar. Legacy
 * region fixtures without an explicit groupRole remain membership frames.
 * Normal hierarchy containers without a groupRole are deliberately excluded.
 * Every generated frame encloses all visible members; multiply-associated
 * members must fit the common intersection. User/pinned geometry is a hard
 * constraint and is diagnosed rather than moved.
 */
export function completeRegionLayout(
  request: LayoutRequest,
  candidate: LayoutResult,
  direction: LayoutDirection = "LR",
  expandableGroupIds: ReadonlySet<string> = new Set(),
): LayoutResult {
  const regionCandidates = request.scene.elements
    .filter((element) => element.structuralKind === "region")
    .sort((left, right) => compareText(left.elementId, right.elementId));
  const groupFrameCandidates = request.scene.elements
    .filter(isGroupFrameElement)
    .sort((left, right) => compareText(left.elementId, right.elementId));
  if (groupFrameCandidates.length === 0) {
    return { ...candidate, structuralCompletion: true };
  }
  const geometries = Object.fromEntries(Object.entries(candidate.geometries).map(([id, geometry]) => [
    id,
    copyGeometry(geometry),
  ]));
  const diagnostics = [...candidate.diagnostics];
  clearStaleNewMembershipDiagnostics(diagnostics, new Set(request.newlyConstrainedElementIds ?? []));
  const regionMemberships = [...(request.scene.memberships ?? [])]
    .filter((membership) => membership.regionElementId)
    .sort((left, right) => compareText(left.semanticRef, right.semanticRef));
  const groupMemberships = [...(request.scene.memberships ?? [])]
    .filter((membership) => groupFrameCandidates.some((group) => (
      membershipBelongsToGroup(membership, group)
    )))
    .sort(compareMembership);
  const groups = groupCompletionOrder(groupFrameCandidates, groupMemberships);
  const spacing = { ...DEFAULT_SPACING, ...request.spacing };

  const locallyManagedElementIds = placeNewlyConstrainedGroupMembers(
    request,
    groupFrameCandidates,
    groupMemberships,
    geometries,
    diagnostics,
    spacing,
    direction,
    expandableGroupIds,
  );

  // Nested frames, sibling normalization and unrelated-frame separation can
  // affect one another. Reach the deterministic fixpoint before routing so a
  // second postcondition pass cannot move geometry underneath adapter routes.
  const maximumPasses = Math.max(2, groupFrameCandidates.length * 2 + 2);
  for (let pass = 0; pass < maximumPasses; pass += 1) {
    const before = copyGeometryRecord(geometries);
    for (const group of groups) {
      const locallyExpandable = expandableGroupIds.has(group.elementId)
        && locallyManagedElementIds.has(group.elementId);
      if (isFixed(group) && !locallyExpandable) {
        if (group.geometry && !locallyManagedElementIds.has(group.elementId)) {
          geometries[group.elementId] = copyGeometry(group.geometry);
        }
        continue;
      }
      const members = groupMemberships
        .filter((membership) => membershipBelongsToGroup(membership, group))
        .map((membership) => geometries[membership.memberElementId])
        .filter((geometry): geometry is ElementGeometry => geometry !== undefined);
      if (members.length === 0) continue;
      geometries[group.elementId] = locallyExpandable
        ? minimallyExpandGeneratedGroupGeometry(geometries[group.elementId], members, spacing)
        : completeGeneratedGroupGeometry(
            geometries[group.elementId],
            members,
            group.size ?? group.geometry ?? defaultGroupFrameSize(group),
            spacing,
          );
    }

    const normalizedRegionIds = normalizeGeneratedRegionSiblingSpans(
      request,
      regionCandidates,
      regionMemberships,
      geometries,
      direction,
    );
    if (normalizedRegionIds.size > 0) {
      // Owners and transitive owners must enclose the normalized child spans.
      // Do not recompute the normalized children themselves, which would shrink
      // them back to their individual content widths.
      for (const group of groups) {
        if (isFixed(group) || normalizedRegionIds.has(group.elementId)) continue;
        const members = groupMemberships
          .filter((membership) => membershipBelongsToGroup(membership, group))
          .map((membership) => geometries[membership.memberElementId])
          .filter((geometry): geometry is ElementGeometry => geometry !== undefined);
        if (members.length === 0) continue;
        geometries[group.elementId] = completeGeneratedGroupGeometry(
          geometries[group.elementId],
          members,
          group.size ?? group.geometry ?? defaultGroupFrameSize(group),
          spacing,
        );
      }
    }

    packEmptyGeneratedRegions(regionCandidates, regionMemberships, geometries, spacing);
    separateUnrelatedGeneratedRegions(
      request,
      regionCandidates,
      regionMemberships,
      geometries,
      diagnostics,
      spacing,
      direction,
    );
    relocateUnassignedGeneratedNodes(
      request,
      groupFrameCandidates,
      groupMemberships,
      geometries,
      diagnostics,
      spacing,
      direction,
    );
    if (sameGeometryRecord(before, geometries)) break;
  }

  validateGroupMembershipGeometry(
    request,
    geometries,
    groupFrameCandidates,
    groupMemberships,
    diagnostics,
    spacing.containerPadding,
  );
  const routes = adjustStructuralCompletionRouteEndpoints(
    request,
    candidate.routes,
    geometries,
    new Set([
      ...groupFrameCandidates.map((group) => group.elementId),
      ...newlyConstrainedMovementIds(request),
    ]),
  );
  const bounds = sceneBounds(
    layoutResultBoundGeometries(request, geometries),
    [
      ...Object.values(routes).flat(),
      ...layoutDerivedRouteControlPoints(candidate.derivedRouteChoices),
    ],
    spacing.margin,
  );
  return {
    ...candidate,
    structuralCompletion: true,
    geometries,
    routes,
    width: bounds.width,
    height: bounds.height,
    diagnostics,
  };
}

const NEW_MEMBERSHIP_REVALIDATED_DIAGNOSTIC_CODES = new Set([
  "layout-new-membership-placement-unavailable",
  "group-membership-intersection-empty",
  "region-membership-intersection-empty",
  "group-member-outside-intersection",
  "region-member-outside-intersection",
  "group-member-outside",
  "region-member-outside",
]);

function clearStaleNewMembershipDiagnostics(
  diagnostics: LayoutDiagnostic[],
  newlyConstrainedElementIds: ReadonlySet<string>,
): void {
  if (newlyConstrainedElementIds.size === 0) return;
  for (let index = diagnostics.length - 1; index >= 0; index -= 1) {
    const diagnostic = diagnostics[index]!;
    if (
      diagnostic.elementId
      && newlyConstrainedElementIds.has(diagnostic.elementId)
      && NEW_MEMBERSHIP_REVALIDATED_DIAGNOSTIC_CODES.has(diagnostic.code)
    ) diagnostics.splice(index, 1);
  }
}

function placeNewlyConstrainedGroupMembers(
  request: LayoutRequest,
  groups: readonly LayoutElement[],
  memberships: readonly LayoutMembership[],
  geometries: Record<string, ElementGeometry>,
  diagnostics: LayoutDiagnostic[],
  spacing: LayoutSpacing,
  direction: LayoutDirection,
  expandableGroupIds: ReadonlySet<string>,
): Set<string> {
  const constrainedIds = new Set(request.newlyConstrainedElementIds ?? []);
  const locallyManagedIds = new Set<string>();
  if (constrainedIds.size === 0) return locallyManagedIds;
  const childrenByParent = new Map<string, string[]>();
  for (const element of request.scene.elements) {
    if (!element.parentElementId) continue;
    const children = childrenByParent.get(element.parentElementId) ?? [];
    children.push(element.elementId);
    childrenByParent.set(element.parentElementId, children);
  }
  const movementElementIds = (rootId: string): Set<string> => {
    const result = new Set([rootId]);
    const visit = (ownerId: string): void => {
      const children = [
        ...(childrenByParent.get(ownerId) ?? []),
        ...memberships
          .filter((membership) => groups.some((group) => (
            group.elementId === ownerId && membershipBelongsToGroup(membership, group)
          )))
          .map((membership) => membership.memberElementId),
      ].sort(compareText);
      for (const childId of children) {
        if (result.has(childId)) continue;
        result.add(childId);
        visit(childId);
      }
    };
    visit(rootId);
    return result;
  };
  const moveSubtree = (rootId: string, next: ElementGeometry, movementIds: ReadonlySet<string>): void => {
    const current = geometries[rootId]!;
    const delta = { x: next.x - current.x, y: next.y - current.y };
    for (const elementId of movementIds) {
      const geometry = geometries[elementId];
      if (!geometry) continue;
      geometries[elementId] = elementId === rootId
        ? next
        : { ...geometry, x: geometry.x + delta.x, y: geometry.y + delta.y };
    }
  };
  for (const memberId of [...constrainedIds].sort(compareText)) {
    const member = geometries[memberId];
    if (!member) continue;
    const movementIds = movementElementIds(memberId);
    for (const elementId of movementIds) locallyManagedIds.add(elementId);
    const movementBounds = geometryUnion([...movementIds].flatMap((elementId) => {
      const geometry = geometries[elementId];
      return geometry ? [geometry] : [];
    }))!;
    const owners = groups.filter((group) => memberships.some((membership) => (
      membership.memberElementId === memberId && membershipBelongsToGroup(membership, group)
    )));
    const ownerContent = owners.flatMap((owner) => {
      const geometry = geometries[owner.elementId];
      return geometry ? [groupFrameContentBounds(owner, geometry, spacing)] : [];
    });
    if (ownerContent.length !== owners.length || owners.length === 0) continue;
    const allowed = geometryIntersection(ownerContent);
    const obstacles = request.scene.elements.flatMap((element) => {
      if (movementIds.has(element.elementId) || owners.some((owner) => owner.elementId === element.elementId)) {
        return [];
      }
      const geometry = geometries[element.elementId];
      return geometry && intersects(geometry, geometryUnion(ownerContent)!) ? [geometry] : [];
    });
    const currentIsValid = allowed
      && containsRectangle(allowed, expandGeometry(movementBounds, spacing.containerPadding))
      && obstacles.every((obstacle) => !intersects(movementBounds, obstacle));
    if (currentIsValid) continue;
    const candidate = allowed
      ? firstAvailableMemberPlacement(
          member,
          movementBounds,
          allowed,
          obstacles,
          spacing,
          direction,
        )
      : undefined;
    if (candidate) {
      moveSubtree(memberId, candidate, movementIds);
      continue;
    }
    if (owners.every((owner) => expandableGroupIds.has(owner.elementId))) {
      const occupied = geometryUnion(obstacles) ?? geometryUnion(ownerContent)!;
      const nextMovementOrigin = direction === "LR"
        ? {
            x: Math.max(
              allowed ? allowed.x + spacing.containerPadding : occupied.x,
              occupied.x,
            ),
            y: occupied.y + occupied.height + spacing.itemGap,
          }
        : {
            x: occupied.x + occupied.width + spacing.itemGap,
            y: Math.max(
              allowed ? allowed.y + spacing.containerPadding : occupied.y,
              occupied.y,
            ),
          };
      const expandedPlacement = {
        ...member,
        x: member.x + nextMovementOrigin.x - movementBounds.x,
        y: member.y + nextMovementOrigin.y - movementBounds.y,
      };
      moveSubtree(memberId, expandedPlacement, movementIds);
      const activateOwnerChain = (memberElementId: string): void => {
        for (const membership of memberships) {
          if (membership.memberElementId !== memberElementId) continue;
          const owner = ownersForMembership(membership, groups);
          if (!owner || !expandableGroupIds.has(owner.elementId) || locallyManagedIds.has(owner.elementId)) {
            continue;
          }
          locallyManagedIds.add(owner.elementId);
          activateOwnerChain(owner.elementId);
        }
      };
      for (const owner of owners) {
        locallyManagedIds.add(owner.elementId);
        activateOwnerChain(owner.elementId);
      }
      continue;
    }
    pushDiagnosticOnce(diagnostics, {
      severity: "warning",
      code: "layout-new-membership-placement-unavailable",
      message: `${memberId}を新しい所属先の空き領域へ配置できません。固定Group Frameを広げるか、既存要素を移動してください。`,
      layoutRef: request.layoutRef,
      elementId: memberId,
    });
  }
  return locallyManagedIds;
}

function ownersForMembership(
  membership: LayoutMembership,
  groups: readonly LayoutElement[],
): LayoutElement | undefined {
  return groups.find((group) => membershipBelongsToGroup(membership, group));
}

function firstAvailableMemberPlacement(
  member: ElementGeometry,
  movementBounds: ElementGeometry,
  allowed: ElementGeometry,
  obstacles: readonly ElementGeometry[],
  spacing: LayoutSpacing,
  direction: LayoutDirection,
): ElementGeometry | undefined {
  const padding = spacing.containerPadding;
  const xValues = [
    allowed.x + padding,
    ...obstacles.flatMap((obstacle) => [
      obstacle.x + obstacle.width + spacing.itemGap,
      obstacle.x - spacing.itemGap - movementBounds.width,
    ]),
  ];
  const yValues = [
    allowed.y + padding,
    ...obstacles.flatMap((obstacle) => [
      obstacle.y + obstacle.height + spacing.itemGap,
      obstacle.y - spacing.itemGap - movementBounds.height,
    ]),
  ];
  const candidates = [...new Set(xValues)].flatMap((x) => [...new Set(yValues)].map((y) => ({
    x,
    y,
    width: movementBounds.width,
    height: movementBounds.height,
  })));
  candidates.sort((left, right) => direction === "LR"
    ? left.y - right.y || left.x - right.x || compareGeometry(left, right)
    : left.x - right.x || left.y - right.y || compareGeometry(left, right));
  const footprint = candidates.find((candidate) => (
    containsRectangle(allowed, expandGeometry(candidate, padding))
    && obstacles.every((obstacle) => !intersects(candidate, obstacle))
  ));
  return footprint ? {
    ...member,
    x: member.x + footprint.x - movementBounds.x,
    y: member.y + footprint.y - movementBounds.y,
  } : undefined;
}

function isGroupFrameElement(element: LayoutElement): boolean {
  // Region was the original overlap grammar and remains a Group Frame for
  // backwards-compatible hand-authored LayoutProjectedScene fixtures.
  return element.structuralKind === "region"
    || (element.structuralKind === "container" && element.groupRole !== undefined);
}

function effectiveGroupFrameKind(element: LayoutElement): GroupFrameKind | undefined {
  return element.groupRole ?? (element.structuralKind === "region" ? "membership" : undefined);
}

function membershipBelongsToGroup(
  membership: LayoutMembership,
  group: LayoutElement,
): boolean {
  const kind = effectiveGroupFrameKind(group);
  if (!kind) return false;
  const ownerMatches = group.structuralKind === "region"
    ? membership.regionElementId === group.elementId
    : membership.containerElementId === group.elementId;
  if (!ownerMatches) return false;
  if (kind === "sequence") return membership.role === "sequence-member";
  if (kind === "alternative") return membership.role === "alternative-member";
  return membership.role === undefined || membership.role === "membership";
}

function compareMembership(left: LayoutMembership, right: LayoutMembership): number {
  return (left.ordinal ?? Number.MAX_SAFE_INTEGER) - (right.ordinal ?? Number.MAX_SAFE_INTEGER)
    || compareText(left.semanticRef, right.semanticRef)
    || compareText(left.containerElementId, right.containerElementId)
    || compareText(left.memberElementId, right.memberElementId);
}

function defaultGroupFrameSize(group: LayoutElement): { width: number; height: number } {
  return group.structuralKind === "region"
    ? { width: 240, height: 160 }
    : { width: 360, height: 160 };
}

type RegionMovementGroup = {
  key: string;
  regionIds: string[];
  elementIds: string[];
  fixed: boolean;
};

/**
 * Generated regions may overlap only when the semantic memberships require
 * it. A shared member and a region-owner relation therefore form one movement
 * group; unrelated groups are packed on the layout cross axis. This is a
 * deterministic completion rule shared by every adapter, rather than an
 * engine-specific heuristic.
 */
function separateUnrelatedGeneratedRegions(
  request: LayoutRequest,
  regions: readonly LayoutElement[],
  memberships: readonly LayoutMembership[],
  geometries: Record<string, ElementGeometry>,
  diagnostics: LayoutDiagnostic[],
  spacing: LayoutSpacing,
  direction: LayoutDirection,
): void {
  if (regions.length < 2) return;
  const elements = new Map(request.scene.elements.map((element) => [element.elementId, element]));
  const regionIds = new Set(regions.map((region) => region.elementId));
  const parent = new Map(regions.map((region) => [region.elementId, region.elementId]));
  const find = (regionId: string): string => {
    const current = parent.get(regionId)!;
    if (current === regionId) return regionId;
    const root = find(current);
    parent.set(regionId, root);
    return root;
  };
  const union = (left: string, right: string): void => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot === rightRoot) return;
    const [root, child] = [leftRoot, rightRoot].sort(compareText);
    parent.set(child!, root!);
  };
  const ownersByMember = new Map<string, string[]>();
  for (const membership of memberships) {
    const ownerId = membership.regionElementId;
    if (!ownerId || !regionIds.has(ownerId)) continue;
    const owners = ownersByMember.get(membership.memberElementId) ?? [];
    owners.push(ownerId);
    ownersByMember.set(membership.memberElementId, owners);
    if (regionIds.has(membership.memberElementId)) {
      union(ownerId, membership.memberElementId);
    }
  }
  for (const owners of ownersByMember.values()) {
    const sorted = [...new Set(owners)].sort(compareText);
    for (let index = 1; index < sorted.length; index += 1) {
      union(sorted[0]!, sorted[index]!);
    }
  }
  const childrenByParent = new Map<string, string[]>();
  for (const element of request.scene.elements) {
    if (!element.parentElementId) continue;
    const children = childrenByParent.get(element.parentElementId) ?? [];
    children.push(element.elementId);
    childrenByParent.set(element.parentElementId, children);
  }
  for (const children of childrenByParent.values()) children.sort(compareText);
  const descendantsOf = (elementId: string): string[] => {
    const result: string[] = [];
    const visited = new Set([elementId]);
    const visit = (parentId: string): void => {
      for (const childId of childrenByParent.get(parentId) ?? []) {
        if (visited.has(childId)) continue;
        visited.add(childId);
        result.push(childId);
        visit(childId);
      }
    };
    visit(elementId);
    return result;
  };
  // A region owning a hierarchy subtree and a region explicitly owning one
  // of its descendants must move together to preserve both relationships.
  for (const membership of memberships) {
    const ownerId = membership.regionElementId;
    if (!ownerId || !regionIds.has(ownerId)) continue;
    for (const descendantId of descendantsOf(membership.memberElementId)) {
      for (const descendantOwner of ownersByMember.get(descendantId) ?? []) {
        union(ownerId, descendantOwner);
      }
    }
  }
  separateUnrelatedRegionPairs(
    request,
    regions,
    memberships,
    elements,
    geometries,
    diagnostics,
    spacing,
    direction,
    descendantsOf,
  );

  const regionIdsByRoot = new Map<string, string[]>();
  for (const region of regions) {
    const root = find(region.elementId);
    const ids = regionIdsByRoot.get(root) ?? [];
    ids.push(region.elementId);
    regionIdsByRoot.set(root, ids);
  }
  const groups: RegionMovementGroup[] = [...regionIdsByRoot.values()].map((ids) => {
    const sortedRegionIds = ids.sort(compareText);
    const memberIds = memberships
      .filter((membership) => (
        membership.regionElementId !== undefined
        && sortedRegionIds.includes(membership.regionElementId)
      ))
      .map((membership) => membership.memberElementId);
    const elementIds = [...new Set([
      ...sortedRegionIds,
      ...memberIds,
      ...memberIds.flatMap(descendantsOf),
    ])].sort(compareText);
    const hasExternalHierarchyParent = elementIds.some((elementId) => {
      const hierarchyParentId = elements.get(elementId)?.parentElementId;
      return hierarchyParentId !== undefined && !elementIds.includes(hierarchyParentId);
    });
    return {
      key: sortedRegionIds[0]!,
      regionIds: sortedRegionIds,
      elementIds,
      fixed: hasExternalHierarchyParent || elementIds.some((elementId) => {
        const element = elements.get(elementId);
        return element ? isFixed(element) : false;
      }),
    };
  }).sort((left, right) => (
    Number(right.fixed) - Number(left.fixed) || compareText(left.key, right.key)
  ));

  const occupied: Array<{ group: RegionMovementGroup; bounds: ElementGeometry }> = [];
  for (const group of groups) {
    const bounds = regionGroupBounds(group, geometries);
    if (!bounds) continue;
    if (group.fixed) {
      for (const previous of occupied) {
        if (intersects(bounds, previous.bounds)) {
          pushDiagnosticOnce(diagnostics, {
            severity: "warning",
            code: "layout-region-separation-fixed",
            message: `${group.key}と${previous.group.key}は共通要素を持たない領域ですが、固定配置または親コンテナの制約により重なりを解消できません。固定位置を解除するか、領域または要素を手動で離してください。`,
            layoutRef: request.layoutRef,
            elementId: group.key,
          });
        }
      }
      occupied.push({ group, bounds });
      continue;
    }
    const translated = copyGeometry(bounds);
    let offset = 0;
    for (const previous of occupied) {
      if (!intersects(translated, previous.bounds)) continue;
      const delta = direction === "LR"
        ? previous.bounds.y + previous.bounds.height + spacing.itemGap - translated.y
        : previous.bounds.x + previous.bounds.width + spacing.itemGap - translated.x;
      if (delta <= 0) continue;
      offset += delta;
      if (direction === "LR") translated.y += delta;
      else translated.x += delta;
    }
    if (offset !== 0) {
      for (const elementId of group.elementIds) {
        const geometry = geometries[elementId];
        if (!geometry) continue;
        geometries[elementId] = direction === "LR"
          ? { ...geometry, y: geometry.y + offset }
          : { ...geometry, x: geometry.x + offset };
      }
    }
    occupied.push({ group, bounds: translated });
  }

  diagnoseUnrelatedRegionOverlaps(request, regions, memberships, geometries, diagnostics);
}

function separateUnrelatedRegionPairs(
  request: LayoutRequest,
  regions: readonly LayoutElement[],
  memberships: readonly LayoutMembership[],
  elements: ReadonlyMap<string, LayoutElement>,
  geometries: Record<string, ElementGeometry>,
  diagnostics: LayoutDiagnostic[],
  spacing: LayoutSpacing,
  direction: LayoutDirection,
  descendantsOf: (elementId: string) => string[],
): void {
  // Region geometry is derived from the already ordered member bands. Keep
  // that semantic layout order when overlapping sibling frames need more
  // cross-axis room; sorting by opaque region identity can invert the lanes
  // after their members have been placed correctly.
  const orderedRegions = [...regions].sort((left, right) => {
    const leftGeometry = geometries[left.elementId];
    const rightGeometry = geometries[right.elementId];
    const leftCross = leftGeometry
      ? direction === "LR" ? leftGeometry.y : leftGeometry.x
      : Number.POSITIVE_INFINITY;
    const rightCross = rightGeometry
      ? direction === "LR" ? rightGeometry.y : rightGeometry.x
      : Number.POSITIVE_INFINITY;
    return leftCross - rightCross || compareText(left.elementId, right.elementId);
  });
  const membersByRegion = new Map(regions.map((region) => [
    region.elementId,
    [...new Set(memberships
      .filter((membership) => membership.regionElementId === region.elementId)
      .map((membership) => membership.memberElementId))].sort(compareText),
  ]));
  const regionIds = new Set(regions.map((region) => region.elementId));
  const ownersByRegion = new Map<string, Set<string>>();
  for (const membership of memberships) {
    if (
      !membership.regionElementId
      || !regionIds.has(membership.regionElementId)
      || !regionIds.has(membership.memberElementId)
    ) continue;
    const owners = ownersByRegion.get(membership.memberElementId) ?? new Set<string>();
    owners.add(membership.regionElementId);
    ownersByRegion.set(membership.memberElementId, owners);
  }
  const sharesSeparationScope = (leftId: string, rightId: string): boolean => {
    const leftOwners = ownersByRegion.get(leftId);
    const rightOwners = ownersByRegion.get(rightId);
    if (!leftOwners && !rightOwners) return true;
    if (!leftOwners || !rightOwners) return false;
    return [...leftOwners].some((ownerId) => rightOwners.has(ownerId));
  };
  const blocked = new Set<string>();
  const maximumMoves = Math.max(1, regions.length * regions.length * 2);
  for (let moveCount = 0; moveCount < maximumMoves; moveCount += 1) {
    let moved = false;
    for (let leftIndex = 0; leftIndex < orderedRegions.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < orderedRegions.length; rightIndex += 1) {
        const left = orderedRegions[leftIndex]!;
        const right = orderedRegions[rightIndex]!;
        const pairKey = `${left.elementId}\u0000${right.elementId}`;
        if (
          blocked.has(pairKey)
          || !sharesSeparationScope(left.elementId, right.elementId)
          || regionsMayOverlap(left.elementId, right.elementId, memberships, regionIds)
        ) continue;
        const leftGeometry = geometries[left.elementId];
        const rightGeometry = geometries[right.elementId];
        if (!leftGeometry || !rightGeometry || !intersects(leftGeometry, rightGeometry)) continue;
        const candidates = [
          { moving: right, obstacle: left },
          { moving: left, obstacle: right },
        ];
        let resolved = false;
        for (const { moving, obstacle } of candidates) {
          const movingIds = regionTranslationIds(
            moving.elementId,
            membersByRegion,
            regionIds,
            descendantsOf,
          );
          const hasExternalHierarchyParent = [...movingIds].some((elementId) => {
            const parentId = elements.get(elementId)?.parentElementId;
            return parentId !== undefined && !movingIds.has(parentId);
          });
          if (
            hasExternalHierarchyParent
            || [...movingIds].some((elementId) => {
              const element = elements.get(elementId);
              return element ? isFixed(element) : false;
            })
          ) continue;
          const movingGeometry = geometries[moving.elementId]!;
          const obstacleGeometry = geometries[obstacle.elementId]!;
          const delta = direction === "LR"
            ? obstacleGeometry.y + obstacleGeometry.height + spacing.itemGap - movingGeometry.y
            : obstacleGeometry.x + obstacleGeometry.width + spacing.itemGap - movingGeometry.x;
          if (delta <= 0) continue;
          for (const elementId of movingIds) {
            const geometry = geometries[elementId];
            if (!geometry) continue;
            geometries[elementId] = direction === "LR"
              ? { ...geometry, y: geometry.y + delta }
              : { ...geometry, x: geometry.x + delta };
          }
          recomputeGeneratedRegionEnclosures(regions, memberships, geometries, spacing);
          moved = true;
          resolved = true;
          break;
        }
        if (!resolved) {
          blocked.add(pairKey);
          pushDiagnosticOnce(diagnostics, {
            severity: "warning",
            code: "layout-region-separation-fixed",
            message: `${left.elementId}と${right.elementId}は共通要素を持たない領域ですが、固定配置または親コンテナの制約により重なりを解消できません。固定位置を解除するか、領域または要素を手動で離してください。`,
            layoutRef: request.layoutRef,
            elementId: right.elementId,
          });
        }
        if (moved) break;
      }
      if (moved) break;
    }
    if (!moved) break;
  }
}

function regionTranslationIds(
  regionId: string,
  membersByRegion: ReadonlyMap<string, readonly string[]>,
  regionIds: ReadonlySet<string>,
  descendantsOf: (elementId: string) => string[],
): Set<string> {
  const result = new Set<string>();
  const activeRegions = new Set<string>();
  const visitRegion = (currentRegionId: string): void => {
    if (activeRegions.has(currentRegionId)) return;
    activeRegions.add(currentRegionId);
    result.add(currentRegionId);
    for (const memberId of membersByRegion.get(currentRegionId) ?? []) {
      result.add(memberId);
      for (const descendantId of descendantsOf(memberId)) result.add(descendantId);
      if (regionIds.has(memberId)) visitRegion(memberId);
    }
  };
  visitRegion(regionId);
  return result;
}

function recomputeGeneratedRegionEnclosures(
  regions: readonly LayoutElement[],
  memberships: readonly LayoutMembership[],
  geometries: Record<string, ElementGeometry>,
  spacing: LayoutSpacing,
): void {
  for (const region of groupCompletionOrder(regions, memberships)) {
    if (isFixed(region)) continue;
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

function regionsMayOverlap(
  leftRegionId: string,
  rightRegionId: string,
  memberships: readonly LayoutMembership[],
  regionIds: ReadonlySet<string>,
): boolean {
  const leftMembers = new Set(memberships
    .filter((membership) => membership.regionElementId === leftRegionId)
    .map((membership) => membership.memberElementId));
  if (memberships.some((membership) => (
    membership.regionElementId === rightRegionId
    && leftMembers.has(membership.memberElementId)
  ))) return true;
  const ownsTransitively = (ownerId: string, targetId: string): boolean => {
    const pending = [ownerId];
    const visited = new Set<string>();
    while (pending.length > 0) {
      const current = pending.pop()!;
      if (visited.has(current)) continue;
      visited.add(current);
      for (const membership of memberships) {
        if (membership.regionElementId !== current || !regionIds.has(membership.memberElementId)) {
          continue;
        }
        if (membership.memberElementId === targetId) return true;
        pending.push(membership.memberElementId);
      }
    }
    return false;
  };
  return ownsTransitively(leftRegionId, rightRegionId)
    || ownsTransitively(rightRegionId, leftRegionId);
}

function diagnoseUnrelatedRegionOverlaps(
  request: LayoutRequest,
  regions: readonly LayoutElement[],
  memberships: readonly LayoutMembership[],
  geometries: Readonly<Record<string, ElementGeometry>>,
  diagnostics: LayoutDiagnostic[],
): void {
  const regionIds = new Set(regions.map((region) => region.elementId));
  for (let leftIndex = 0; leftIndex < regions.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < regions.length; rightIndex += 1) {
      const left = regions[leftIndex]!;
      const right = regions[rightIndex]!;
      const leftGeometry = geometries[left.elementId];
      const rightGeometry = geometries[right.elementId];
      if (
        !leftGeometry
        || !rightGeometry
        || regionsMayOverlap(left.elementId, right.elementId, memberships, regionIds)
        || !intersects(leftGeometry, rightGeometry)
      ) continue;
      pushDiagnosticOnce(diagnostics, {
        severity: "warning",
        code: "layout-region-separation-unresolved",
        message: `${left.elementId}と${right.elementId}は共通要素を持たない領域ですが、包含制約を保ったまま重なりを解消できません。領域または所属要素の位置を調整してください。`,
        layoutRef: request.layoutRef,
        elementId: right.elementId,
      });
    }
  }
}

function regionGroupBounds(
  group: RegionMovementGroup,
  geometries: Readonly<Record<string, ElementGeometry>>,
): ElementGeometry | undefined {
  return geometryUnion(group.regionIds.flatMap((regionId) => {
    const geometry = geometries[regionId];
    return geometry ? [geometry] : [];
  }));
}

/** Keeps free-standing generated resources out of every Group Frame content area. */
function relocateUnassignedGeneratedNodes(
  request: LayoutRequest,
  groups: readonly LayoutElement[],
  memberships: readonly LayoutMembership[],
  geometries: Record<string, ElementGeometry>,
  diagnostics: LayoutDiagnostic[],
  spacing: LayoutSpacing,
  direction: LayoutDirection,
): void {
  const elements = new Map(request.scene.elements.map((element) => [element.elementId, element]));
  const assigned = new Set(memberships.map((membership) => membership.memberElementId));
  // A hierarchy child of a region member is visually owned through its
  // containing subtree and must not be pulled out independently.
  for (const element of request.scene.elements) {
    let parentId = element.parentElementId;
    const visited = new Set<string>();
    while (parentId && !visited.has(parentId)) {
      visited.add(parentId);
      if (assigned.has(parentId)) {
        assigned.add(element.elementId);
        break;
      }
      parentId = elements.get(parentId)?.parentElementId;
    }
  }
  const groupObstacles = groups.flatMap((group) => {
    const geometry = geometries[group.elementId];
    return geometry ? [{
      elementId: group.elementId,
      geometry: groupFrameContentBounds(group, geometry, spacing),
    }] : [];
  }).sort((left, right) => compareText(left.elementId, right.elementId));
  if (groupObstacles.length === 0) return;
  const groupIds = new Set(groups.map((group) => group.elementId));
  const nodes = request.scene.elements
    .filter((element) => element.structuralKind === "node" && !assigned.has(element.elementId))
    .sort(compareElement);
  for (const node of nodes) {
    const geometry = geometries[node.elementId];
    if (!geometry || !groupObstacles.some((group) => intersects(geometry, group.geometry))) {
      continue;
    }
    if (isFixed(node) || node.parentElementId) {
      pushDiagnosticOnce(diagnostics, {
        severity: "warning",
        code: "layout-unassigned-node-inside-region-fixed",
        message: `${node.elementId}はGroup Frameに所属していませんが、固定配置または親コンテナの制約によりcontent bounds外へ移動できません。固定位置を解除するか、所属先を設定してください。`,
        layoutRef: request.layoutRef,
        elementId: node.elementId,
      });
      continue;
    }
    const translated = copyGeometry(geometry);
    const obstacles = [
      ...groupObstacles.map((item) => item.geometry),
      ...request.scene.elements.flatMap((element) => {
        if (element.elementId === node.elementId || groupIds.has(element.elementId)) return [];
        const obstacle = geometries[element.elementId];
        return obstacle ? [layoutElementFootprintGeometry(element, obstacle)] : [];
      }),
    ];
    relocateAfterObstacles(translated, obstacles, direction, spacing.itemGap);
    geometries[node.elementId] = translated;
  }
}

function relocateAfterObstacles(
  translated: ElementGeometry,
  obstacles: readonly ElementGeometry[],
  direction: LayoutDirection,
  gap: number,
): void {
  const ordered = [...obstacles].sort((left, right) => direction === "LR"
    ? left.y - right.y
      || left.y + left.height - right.y - right.height
      || compareGeometry(left, right)
    : left.x - right.x
      || left.x + left.width - right.x - right.width
      || compareGeometry(left, right));
  for (const obstacle of ordered) {
    if (!intersects(translated, obstacle)) continue;
    if (direction === "LR") translated.y = obstacle.y + obstacle.height + gap;
    else translated.x = obstacle.x + obstacle.width + gap;
  }
}

function groupFrameContentBounds(
  group: LayoutElement,
  geometry: ElementGeometry,
  spacing: LayoutSpacing,
): ElementGeometry {
  // Region labels live on/outside the perimeter and do not reserve an inner
  // header band. Its complete frame is therefore semantic content. Container
  // Group Frames use their explicit/template-derived content insets.
  if (group.structuralKind === "region") return copyGeometry(geometry);
  const insets = resolvedElementContentInsets(group, spacing);
  return {
    x: geometry.x + insets.left,
    y: geometry.y + insets.top,
    width: Math.max(0, geometry.width - insets.left - insets.right),
    height: Math.max(0, geometry.height - insets.top - insets.bottom),
  };
}

function pushDiagnosticOnce(
  diagnostics: LayoutDiagnostic[],
  diagnostic: LayoutDiagnostic,
): void {
  if (diagnostics.some((item) => (
    item.code === diagnostic.code
    && item.elementId === diagnostic.elementId
    && item.edgeId === diagnostic.edgeId
    && item.message === diagnostic.message
  ))) return;
  diagnostics.push(diagnostic);
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
  direction: LayoutDirection,
): Set<string> {
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

function completeGeneratedGroupGeometry(
  current: ElementGeometry | undefined,
  members: readonly ElementGeometry[],
  minimum: { width: number; height: number },
  spacing: LayoutSpacing,
): ElementGeometry {
  // The common Group Frame postcondition is member-bounds + padding. Header
  // position is a renderer/template concern, so an adapter that already
  // satisfies that invariant must not be expanded merely because it reserves
  // its caption on another side.
  const memberBounds = geometryUnion(members)!;
  const padding = spacing.containerPadding;
  const required = {
    x: memberBounds.x - padding,
    y: memberBounds.y - padding,
    width: memberBounds.width + padding * 2,
    height: memberBounds.height + padding * 2,
  };
  if (current && isValidGeometry(current) && containsRectangle(current, required)) {
    return copyGeometry(current);
  }
  return enclosureGeometry(members, {
    width: Math.max(minimum.width, current?.width ?? 0),
    height: Math.max(minimum.height, current?.height ?? 0),
  }, spacing);
}

function minimallyExpandGeneratedGroupGeometry(
  current: ElementGeometry | undefined,
  members: readonly ElementGeometry[],
  spacing: LayoutSpacing,
): ElementGeometry {
  if (!current || !isValidGeometry(current)) {
    return completeGeneratedGroupGeometry(current, members, { width: 0, height: 0 }, spacing);
  }
  const memberBounds = geometryUnion(members)!;
  const padding = spacing.containerPadding;
  const required = {
    x: memberBounds.x - padding,
    y: memberBounds.y - padding,
    width: memberBounds.width + padding * 2,
    height: memberBounds.height + padding * 2,
  };
  const left = Math.min(current.x, required.x);
  const top = Math.min(current.y, required.y);
  const right = Math.max(current.x + current.width, required.x + required.width);
  const bottom = Math.max(current.y + current.height, required.y + required.height);
  return { x: left, y: top, width: right - left, height: bottom - top };
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

function validateGroupMembershipGeometry(
  request: LayoutRequest,
  geometries: Readonly<Record<string, ElementGeometry>>,
  groups: readonly LayoutElement[],
  memberships: readonly LayoutMembership[],
  diagnostics: LayoutDiagnostic[],
  padding: number,
): void {
  const groupsById = new Map(groups.map((group) => [group.elementId, group]));
  const byMember = new Map<string, Array<{ membership: LayoutMembership; group: LayoutElement }>>();
  for (const membership of memberships) {
    const group = groups.find((candidate) => membershipBelongsToGroup(membership, candidate));
    if (!group || !geometries[group.elementId]) {
      pushDiagnosticOnce(diagnostics, {
        severity: "warning",
        code: "layout-group-membership-unresolved",
        message: `${membership.semanticRef}の所属先Group Frameまたはgeometryを解決できません。所属先が表示対象か確認してください。`,
        layoutRef: request.layoutRef,
        elementId: membership.memberElementId,
      });
      continue;
    }
    const entries = byMember.get(membership.memberElementId) ?? [];
    entries.push({ membership, group });
    byMember.set(membership.memberElementId, entries);
  }
  for (const [memberId, entries] of [...byMember.entries()].sort(([left], [right]) => (
    compareText(left, right)
  ))) {
    const member = geometries[memberId];
    if (!member) {
      pushDiagnosticOnce(diagnostics, {
        severity: "warning",
        code: "layout-group-member-unresolved",
        message: `${memberId}のgeometryを解決できないため、所属先Group Frameとの包含を確認できません。`,
        layoutRef: request.layoutRef,
        elementId: memberId,
      });
      continue;
    }
    const frameGeometries = entries.flatMap(({ group }) => {
      const geometry = geometries[group.elementId];
      return geometry ? [geometry] : [];
    });
    if (frameGeometries.length === 0) continue;
    const intersection = geometryIntersection(frameGeometries);
    const onlyLegacyRegions = entries.every(({ group }) => (
      group.structuralKind === "region" && !groupsById.get(group.elementId)?.groupRole
    ));
    const onlyRegions = entries.every(({ group }) => group.structuralKind === "region");
    if (!intersection) {
      pushDiagnosticOnce(diagnostics, {
        severity: "warning",
        code: onlyRegions ? "region-membership-intersection-empty" : "group-membership-intersection-empty",
        message: `${memberId}が属するGroup Frameに共通の交差領域がありません。固定枠を広げるか、所属を見直してください。`,
        layoutRef: request.layoutRef,
        elementId: memberId,
      });
      continue;
    }
    const paddedMember = expandGeometry(member, padding);
    if (!containsRectangle(intersection, paddedMember)) {
      pushDiagnosticOnce(diagnostics, {
        severity: "warning",
        code: onlyLegacyRegions || onlyRegions
          ? (frameGeometries.length > 1
              ? "region-member-outside-intersection"
              : "region-member-outside")
          : (frameGeometries.length > 1
              ? "group-member-outside-intersection"
              : "group-member-outside"),
        message: `${memberId}の全体とpadding ${padding}が所属Group Frame${frameGeometries.length > 1 ? "の共通交差" : ""}内にありません。固定位置を解除するか、枠または要素を調整してください。`,
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

function adjustStructuralCompletionRouteEndpoints(
  request: LayoutRequest,
  input: Readonly<Record<string, Point[]>>,
  geometries: Readonly<Record<string, ElementGeometry>>,
  adjustedElementIds: ReadonlySet<string>,
): Record<string, Point[]> {
  const elements = new Map(request.scene.elements.map((element) => [element.elementId, element]));
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
    if (source && adjustedElementIds.has(edge.sourceElementId)) {
      const element = elements.get(edge.sourceElementId);
      const shape: EdgeEndpointShape = element?.structuralKind === "region"
        ? "region"
        : element?.structuralKind === "container" ? "container" : element?.shape ?? "rectangle";
      points[0] = isValidEdgeEndpointAnchor(edge.sourceAnchor)
        ? edgeEndpointAnchorPoint(source, shape, edge.sourceAnchor)
        : rectangleBoundaryPoint(source, points[1]!);
    }
    if (target && adjustedElementIds.has(edge.targetElementId)) {
      const element = elements.get(edge.targetElementId);
      const shape: EdgeEndpointShape = element?.structuralKind === "region"
        ? "region"
        : element?.structuralKind === "container" ? "container" : element?.shape ?? "rectangle";
      points[points.length - 1] = isValidEdgeEndpointAnchor(edge.targetAnchor)
        ? edgeEndpointAnchorPoint(target, shape, edge.targetAnchor)
        : rectangleBoundaryPoint(target, points.at(-2)!);
    }
  }
  return result;
}

/**
 * Enforces the public route cardinality without rewriting user/manual or
 * transaction-fixed routes. Adapters may search with richer private paths,
 * but generated renderer output exposes at most one intermediate pivot.
 */
function normalizeGeneratedAdapterRoutes(
  request: LayoutRequest,
  candidate: LayoutResult,
): LayoutResult {
  const edges = new Map(request.scene.edges.map((edge) => [edge.elementId, edge]));
  const routes = Object.fromEntries(Object.entries(candidate.routes).map(([edgeId, points]) => [
    edgeId,
    points.map(copyPoint),
  ]));
  const diagnostics = [...candidate.diagnostics];
  let changed = false;
  for (const [edgeId, points] of Object.entries(routes)) {
    const edge = edges.get(edgeId);
    if (
      !edge
      || request.fixedDerivedRoutes?.[edgeId]
      || edge.routingPlacement === "user"
      || edge.routeMode === "manual"
      || points.length < 2
    ) continue;
    const family = candidate.derivedRouteChoices?.[edgeId]?.family;
    const normalized = family === "straight" || family === "curve"
      ? [copyPoint(points[0]!), copyPoint(points.at(-1)!)]
      : points.length > 3
        ? [copyPoint(points[0]!), copyPoint(points[Math.floor(points.length / 2)]!), copyPoint(points.at(-1)!)]
        : points;
    if (sameRouteValue(points, normalized)) continue;
    routes[edgeId] = normalized;
    changed = true;
    pushDiagnosticOnce(diagnostics, {
      severity: "warning",
      code: "layout-generated-route-compacted",
      message: `${edgeId}の生成経路を公開上限の中間点1個へ縮約しました。adapter内の探索経路はrendererへ直接公開しないでください。`,
      layoutRef: request.layoutRef,
      edgeId,
    });
  }
  if (!changed) return candidate;
  const spacing = { ...DEFAULT_SPACING, ...request.spacing };
  const bounds = sceneBounds(
    layoutResultBoundGeometries(request, candidate.geometries),
    [
      ...Object.values(routes).flat(),
      ...layoutDerivedRouteControlPoints(candidate.derivedRouteChoices),
    ],
    spacing.margin,
  );
  return {
    ...candidate,
    routes,
    width: bounds.width,
    height: bounds.height,
    diagnostics,
  };
}

function layoutResultBoundGeometries(
  request: LayoutRequest,
  geometries: Readonly<Record<string, ElementGeometry>>,
): ElementGeometry[] {
  return request.scene.elements.flatMap((element) => {
    const geometry = geometries[element.elementId];
    return geometry
      ? [copyGeometry(geometry), ...layoutExternalReservationGeometries(element, geometry)]
      : [];
  });
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
  for (const edge of request.scene.edges) {
    if (!expectedIds.has(edge.sourceElementId) || !expectedIds.has(edge.targetElementId)) {
      diagnostics.push({
        ...invalidResult(
          request,
          `edge endpoint refers to an unknown element: ${edge.elementId} (${edge.sourceElementId} -> ${edge.targetElementId})`,
        ),
        edgeId: edge.elementId,
      });
    }
  }
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
    } else {
      const edge = request.scene.edges.find((candidate) => candidate.elementId === edgeId)!;
      const generated = !request.fixedDerivedRoutes?.[edgeId]
        && edge.routingPlacement !== "user"
        && edge.routeMode !== "manual";
      if (generated && points.length > 3) {
        diagnostics.push({
          ...invalidResult(request, `generated route has more than one intermediate point: ${edgeId}`),
          edgeId,
        });
      }
    }
  }
  validateDerivedRouteChoices(request, result, expectedEdgeIds, diagnostics);
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

function validateDerivedRouteChoices(
  request: LayoutRequest,
  result: LayoutResult,
  expectedEdgeIds: ReadonlySet<string>,
  diagnostics: LayoutDiagnostic[],
): void {
  const validFamilies = new Set<LayoutDerivedRouteFamily>([
    "straight", "curve", "polyline", "orthogonal", "manual",
  ]);
  const validSources = new Set<LayoutDerivedRouteChoice["source"]>(["auto", "explicit", "fixed"]);
  const edges = new Map(request.scene.edges.map((edge) => [edge.elementId, edge]));
  for (const [edgeId, choice] of Object.entries(result.derivedRouteChoices ?? {})) {
    const invalid = (message: string): void => {
      diagnostics.push({ ...invalidResult(request, message), edgeId });
    };
    if (!expectedEdgeIds.has(edgeId)) {
      invalid(`derivedRouteChoice refers to an unknown edge: ${edgeId}`);
      continue;
    }
    if (!validFamilies.has(choice.family) || !validSources.has(choice.source)) {
      invalid(`derivedRouteChoice family/source is invalid: ${edgeId}`);
      continue;
    }
    const edge = edges.get(edgeId)!;
    const route = result.routes[edgeId];
    if (!route) continue;
    if (choice.family === "straight" && route.length !== 2) {
      invalid(`straight derivedRouteChoice must have an endpoint-only route: ${edgeId}`);
    }
    if (
      choice.source === "auto"
      && choice.family === "orthogonal"
      && !isOneBendOrthogonalRoute(route)
    ) {
      invalid(`auto orthogonal derivedRouteChoice must have one horizontal/vertical bend: ${edgeId}`);
    }
    if (choice.curve) {
      const points = [
        choice.curve.sourceControl,
        choice.curve.targetControl,
        choice.curve.guidePivot,
      ];
      if (
        choice.family !== "curve"
        || !Number.isFinite(choice.curve.guideAngleDegrees)
        || points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))
      ) invalid(`derived curve controls are inconsistent or non-finite: ${edgeId}`);
    }
    const fixed = request.fixedDerivedRoutes?.[edgeId] !== undefined;
    if (choice.source === "fixed" && !fixed) {
      invalid(`fixed derivedRouteChoice has no fixedDerivedRoutes entry: ${edgeId}`);
    }
    if (fixed && choice.source !== "fixed") {
      invalid(`fixedDerivedRoutes entry has a non-fixed derivedRouteChoice: ${edgeId}`);
    }
    const explicitFamily = edge.routeMode && edge.routeMode !== "auto"
      ? edge.routeMode
      : undefined;
    if (explicitFamily && choice.source !== "explicit" && !fixed) {
      invalid(`explicit routeMode has a non-explicit derivedRouteChoice: ${edgeId}`);
    }
    if (explicitFamily && choice.family !== explicitFamily && !fixed) {
      invalid(`derivedRouteChoice does not match explicit routeMode ${explicitFamily}: ${edgeId}`);
    }
    if (!explicitFamily && !fixed && choice.source === "explicit") {
      invalid(`explicit derivedRouteChoice has no explicit routeMode: ${edgeId}`);
    }
    const reasonMatchesSource = choice.source === "fixed"
      ? choice.reason === "fixed-derived-route"
      : choice.source === "explicit"
        ? choice.reason === "explicit-route-mode"
        : choice.reason.startsWith("auto-");
    if (!reasonMatchesSource) {
      invalid(`derivedRouteChoice reason/source is inconsistent: ${edgeId}`);
    }
  }
}

function validateFixedDerivedRouteRequest(request: LayoutRequest): LayoutDiagnostic[] {
  const fixed = request.fixedDerivedRoutes;
  const fixedChoices = request.fixedDerivedRouteChoices;
  if ((!fixed || Object.keys(fixed).length === 0) && (!fixedChoices || Object.keys(fixedChoices).length === 0)) {
    return [];
  }
  const diagnostics: LayoutDiagnostic[] = [];
  if (request.mode !== "route-only") {
    diagnostics.push(invalidResult(
      request,
      "fixedDerivedRoutes and fixedDerivedRouteChoices are only valid in route-only mode",
    ));
  }
  const expectedEdgeIds = new Set(request.scene.edges.map((edge) => edge.elementId));
  for (const [edgeId, points] of Object.entries(fixed ?? {}).sort(([left], [right]) => (
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
  for (const [edgeId, choice] of Object.entries(fixedChoices ?? {}).sort(([left], [right]) => (
    compareText(left, right)
  ))) {
    const invalid = (message: string): void => {
      diagnostics.push({ ...invalidResult(request, message), edgeId });
    };
    if (!fixed?.[edgeId]) {
      invalid(`fixed derivedRouteChoice has no fixedDerivedRoutes entry: ${edgeId}`);
      continue;
    }
    if (!expectedEdgeIds.has(edgeId)) {
      invalid(`fixed derivedRouteChoice refers to an unknown edge: ${edgeId}`);
      continue;
    }
    if (choice.source !== "fixed" || choice.reason !== "fixed-derived-route") {
      invalid(`fixed derivedRouteChoice must use fixed source/reason: ${edgeId}`);
    }
    if (!isValidLayoutDerivedRouteChoice(choice)) {
      invalid(`fixed derivedRouteChoice is invalid: ${edgeId}`);
    }
  }
  return diagnostics;
}

function fixedDerivedRouteChoiceFor(route: readonly Point[]): LayoutDerivedRouteChoice {
  return {
    family: route.length === 2 ? "straight" : "polyline",
    source: "fixed",
    reason: "fixed-derived-route",
  };
}

function cloneLayoutDerivedRouteChoice(
  choice: LayoutDerivedRouteChoice,
): LayoutDerivedRouteChoice {
  return {
    ...choice,
    ...(choice.curve ? {
      curve: {
        sourceControl: copyPoint(choice.curve.sourceControl),
        targetControl: copyPoint(choice.curve.targetControl),
        guidePivot: copyPoint(choice.curve.guidePivot),
        guideAngleDegrees: choice.curve.guideAngleDegrees,
      },
    } : {}),
    ...(choice.rejected ? { rejected: choice.rejected.map((rejection) => ({ ...rejection })) } : {}),
  };
}

function isValidLayoutDerivedRouteChoice(choice: LayoutDerivedRouteChoice): boolean {
  const validFamilies = new Set<LayoutDerivedRouteFamily>([
    "straight", "curve", "polyline", "orthogonal", "manual",
  ]);
  if (!validFamilies.has(choice.family)) return false;
  if (!choice.curve) return true;
  return choice.family === "curve"
    && Number.isFinite(choice.curve.guideAngleDegrees)
    && [
      choice.curve.sourceControl,
      choice.curve.targetControl,
      choice.curve.guidePivot,
    ].every((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
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
  derivedRouteChoices: Record<string, LayoutDerivedRouteChoice>;
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
    derivedRouteChoices: {},
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
  const structurallyCompleted = completeRegionLayout(request, {
    layoutRef: request.layoutRef,
    geometries: state.geometries,
    routes: {},
    width: 0,
    height: 0,
    diagnostics: [],
  }, direction);
  state.geometries = structurallyCompleted.geometries;
  state.diagnostics.push(...structurallyCompleted.diagnostics);
  if (performanceSample) {
    performanceSample.placementMs = monotonicMilliseconds() - placementStartedAt;
  }
  const routes = routeEdges(state, performanceSample);
  const boundsStartedAt = performanceSample ? monotonicMilliseconds() : 0;
  const bounds = sceneBounds(
    layoutBounds(state),
    [
      ...Object.values(routes).flat(),
      ...layoutDerivedRouteControlPoints(state.derivedRouteChoices),
    ],
    state.spacing.margin,
  );
  if (performanceSample) {
    performanceSample.boundsMs = monotonicMilliseconds() - boundsStartedAt;
  }

  const result: LayoutResult = {
    layoutRef: request.layoutRef,
    direction,
    structuralCompletion: true,
    geometries: state.geometries,
    routes,
    derivedRouteChoices: state.derivedRouteChoices,
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
  if (validLayoutSize(element.minimumContentSize)) {
    size = {
      width: Math.max(size.width, element.minimumContentSize.width),
      height: Math.max(size.height, element.minimumContentSize.height),
    };
  }

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

function validLayoutSize(
  value: { width: number; height: number } | undefined,
): value is { width: number; height: number } {
  return value !== undefined
    && Number.isFinite(value.width)
    && Number.isFinite(value.height)
    && value.width > 0
    && value.height > 0;
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
  return resolvedElementContentInsets(element, state.spacing);
}

function resolvedElementContentInsets(
  element: LayoutElement,
  spacing: LayoutSpacing,
): ContainerContentInsets {
  return element.contentInsets ?? {
    top: spacing.containerHeader + spacing.containerPadding,
    right: spacing.containerPadding,
    bottom: spacing.containerPadding,
    left: spacing.containerPadding,
  };
}

const PARALLEL_LANE_GAP = 20;
const SELF_LOOP_BASE = 36;
const SELF_LOOP_GAP = 18;
const ROUTE_OBSTACLE_PADDING = 10;
// SVG's fitted affine transform can move a route that is mathematically on a
// node boundary a fraction of a pixel into its rendered box. Keep generated
// routes visibly clear of every non-endpoint node instead of accepting a
// boundary-hugging corridor that only appears safe in layout coordinates.
const ROUTE_RENDERER_CLEARANCE = 0.1;
const ROUTE_GRID_OBSTACLE_LIMIT = 24;
const ROUTE_GRID_COMMITTED_LIMIT = 16;
const ROUTE_GRID_ELEMENT_LIMIT = 256;
const ROUTE_GRID_EDGE_LIMIT = 512;
const ROUTE_EXHAUSTIVE_COMPACTION_EDGE_LIMIT = 96;
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
  return selectDerivedRouteFamilies(
    improveDerivedRoutes(routes, state, performanceSample),
    state,
  );
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

/**
 * Samples renderer-only cubic controls for collision tests or a non-Bezier
 * renderer. Controls stay outside the portable overlay and semantic graph.
 */
export function flattenLayoutDerivedCurve(
  route: readonly Point[],
  curve: LayoutDerivedCurve,
  subdivisions = 24,
): Point[] {
  const start = route[0];
  const end = route.at(-1);
  if (!start || !end) return route.map(copyPoint);
  const count = Math.max(4, Math.min(64, Math.floor(subdivisions)));
  return Array.from({ length: count + 1 }, (_, index) => {
    const t = index / count;
    const inverse = 1 - t;
    return {
      x: inverse ** 3 * start.x
        + 3 * inverse ** 2 * t * curve.sourceControl.x
        + 3 * inverse * t ** 2 * curve.targetControl.x
        + t ** 3 * end.x,
      y: inverse ** 3 * start.y
        + 3 * inverse ** 2 * t * curve.sourceControl.y
        + 3 * inverse * t ** 2 * curve.targetControl.y
        + t ** 3 * end.y,
    };
  });
}

/** Returns only transient Bezier controls that can extend renderer bounds. */
export function layoutDerivedRouteControlPoints(
  choices: Readonly<Record<string, LayoutDerivedRouteChoice>> | undefined,
): Point[] {
  return Object.values(choices ?? {}).flatMap((choice) => choice.curve
    ? [
        copyPoint(choice.curve.sourceControl),
        copyPoint(choice.curve.targetControl),
      ]
    : []);
}

/**
 * Chooses only for `auto`: safe direct segment, safe one-bend orthogonal,
 * then a bounded set of safe gentle cubics. The visibility-grid route remains
 * an internal search corridor; an arbitrary-angle pivot is never exposed as
 * an automatic polyline. Explicit modes and fixed routes keep their public
 * route unchanged.
 */
function selectDerivedRouteFamilies(
  input: Record<string, Point[]>,
  state: LayoutState,
): Record<string, Point[]> {
  const routes = Object.fromEntries(Object.entries(input).map(([id, points]) => [
    id,
    points.map(copyPoint),
  ]));
  const sorted = [...state.edges].sort(compareEdge);
  if (sorted.length > ROUTE_GRID_EDGE_LIMIT) {
    return selectLargeDerivedRouteFamilies(routes, sorted, state);
  }
  const routeStates = indexRoutedEdgeStates(sorted, routes);
  const autoEdges: LayoutEdge[] = [];

  for (const edge of sorted) {
    const route = routes[edge.elementId];
    if (!route || route.length < 2) continue;
    const explicit = explicitDerivedRouteChoice(edge, route, state);
    if (!explicit) {
      autoEdges.push(edge);
      continue;
    }
    state.derivedRouteChoices[edge.elementId] = explicit;
    if (explicit.curve) {
      const flattened = flattenLayoutDerivedCurve(route, explicit.curve);
      routeStates.set(edge.elementId, { edge, points: flattened, bounds: pointBounds(flattened) });
    }
  }

  for (const edge of autoEdges) {
    const base = routes[edge.elementId];
    const source = state.geometries[edge.sourceElementId];
    const target = state.geometries[edge.targetElementId];
    if (!base || base.length < 2 || !source || !target) continue;
    const rejected: LayoutDerivedRouteRejection[] = [];
    if (edge.sourceElementId === edge.targetElementId) {
      const candidate = selfLoopDerivedCurveCandidate(base);
      routes[edge.elementId] = [copyPoint(base[0]!), copyPoint(base.at(-1)!)];
      if (candidate) {
        routeStates.set(edge.elementId, {
          edge,
          points: candidate.flattened,
          bounds: pointBounds(candidate.flattened),
        });
      }
      state.derivedRouteChoices[edge.elementId] = {
        family: "curve",
        source: "auto",
        reason: "auto-curve-safe",
        ...(candidate ? { curve: candidate.curve } : {}),
        rejected: [
          { family: "straight", reason: "self-loop" },
          { family: "orthogonal", reason: "self-loop" },
        ],
      };
      continue;
    }

    const others = routedOthers(sorted, routeStates, edge, state);
    const obstacles = routeObstacles(edge, state);
    const baseCost = routeCost(base, edge, obstacles, others);
    const direct = applyEndpointAnchors(
      directRoute(edge, source, target, state),
      edge,
      source,
      target,
      state,
    );
    const directCost = routeCost(direct, edge, obstacles, others);
    const directRejection = routeFamilyRejection(
      direct,
      directCost,
      baseCost,
      edge,
      others,
      source,
      target,
    );
    if (!directRejection) {
      setRoutedEdgeRoute(routes, routeStates, edge, direct);
      state.derivedRouteChoices[edge.elementId] = {
        family: "straight",
        source: "auto",
        reason: "auto-straight-safe",
      };
      continue;
    }
    rejected.push({ family: "straight", reason: directRejection });

    const orthogonalCandidates = oneBendOrthogonalCandidates(
      base,
      edge,
      source,
      target,
      state,
    );
    const evaluatedOrthogonal = orthogonalCandidates.map((candidate) => {
      const cost = routeCost(candidate, edge, obstacles, others);
      return {
        candidate,
        cost,
        rejection: preservesExplicitEndpointLegs(candidate, base, edge)
          ? routeFamilyRejection(
              candidate,
              cost,
              baseCost,
              edge,
              others,
              source,
              target,
            )
          : "endpoint-direction" as const,
      };
    });
    const safeOrthogonal = evaluatedOrthogonal
      .filter((candidate) => candidate.rejection === undefined)
      .sort((left, right) => compareRouteCandidate(
        left.cost,
        left.candidate,
        right.cost,
        right.candidate,
      ))[0];
    if (safeOrthogonal) {
      setRoutedEdgeRoute(routes, routeStates, edge, safeOrthogonal.candidate);
      state.derivedRouteChoices[edge.elementId] = {
        family: "orthogonal",
        source: "auto",
        reason: "auto-orthogonal-safe",
        rejected,
      };
      continue;
    }
    const rejectedOrthogonal = [...evaluatedOrthogonal].sort((left, right) => (
      compareRouteCandidate(left.cost, left.candidate, right.cost, right.candidate)
    ))[0];
    rejected.push({
      family: "orthogonal",
      reason: rejectedOrthogonal?.rejection ?? "no-guide",
    });

    const curveCandidates = boundedDerivedCurveCandidates(
      edge,
      base,
      obstacles,
      others,
      state,
    );
    const evaluatedCurves = curveCandidates.map((candidate) => {
      const cost = routeCost(candidate.flattened, edge, obstacles, others);
      return {
        ...candidate,
        cost,
        rejection: routeFamilyRejection(
          candidate.flattened,
          cost,
          baseCost,
          edge,
          others,
          source,
          target,
        ),
      };
    });
    const safeCurve = evaluatedCurves
      .filter((candidate) => candidate.rejection === undefined)
      .sort(compareDerivedCurveCandidate)[0];
    if (safeCurve) {
      routes[edge.elementId] = safeCurve.route.map(copyPoint);
      routeStates.set(edge.elementId, {
        edge,
        points: safeCurve.flattened,
        bounds: pointBounds(safeCurve.flattened),
      });
      state.derivedRouteChoices[edge.elementId] = {
        family: "curve",
        source: "auto",
        reason: "auto-curve-safe",
        curve: safeCurve.curve,
        rejected,
      };
      continue;
    }
    if (evaluatedCurves.length === 0) {
      rejected.push({ family: "curve", reason: "no-guide" });
    } else {
      const bestRejected = [...evaluatedCurves].sort(compareDerivedCurveCandidate)[0]!;
      rejected.push({ family: "curve", reason: bestRejected.rejection ?? "interaction" });
    }
    const endpointCompatible = evaluatedCurves.filter((candidate) => (
      endpointLegsLeaveElements(candidate.flattened, source, target)
    ));
    const fallbackPool = endpointCompatible.length > 0 ? endpointCompatible : evaluatedCurves;
    const fallback = [...fallbackPool]
      .filter((candidate) => candidate.cost[0] === 0 && candidate.cost[2] === 0)
      .sort(compareDerivedCurveCandidate)[0]
      ?? [...fallbackPool].sort(compareDerivedCurveCandidate)[0];
    if (!fallback) continue;
    routes[edge.elementId] = fallback.route.map(copyPoint);
    routeStates.set(edge.elementId, {
      edge,
      points: fallback.flattened,
      bounds: pointBounds(fallback.flattened),
    });
    state.derivedRouteChoices[edge.elementId] = {
      family: "curve",
      source: "auto",
      reason: "auto-curve-fallback",
      curve: fallback.curve,
      rejected,
    };
    if (
      fallback.cost[0] !== 0
      || fallback.cost[2] !== 0
      || !endpointLegsLeaveElements(fallback.flattened, source, target)
    ) {
      state.diagnostics.push({
        severity: "warning",
        code: "layout-auto-route-unresolved",
        message: `automatic curve still violates an obstacle or endpoint constraint: ${edge.elementId}`,
        layoutRef: state.request.layoutRef,
        edgeId: edge.elementId,
      });
    }
  }
  if (state.edges.length <= 48) {
    refineSelectedCurveFamilies(routes, state, sorted, routeStates, autoEdges);
  }
  return routes;
}

/** Re-scores curves once every peer has its final rendered family. */
function refineSelectedCurveFamilies(
  routes: Record<string, Point[]>,
  state: LayoutState,
  sorted: readonly LayoutEdge[],
  routeStates: Map<string, RoutedEdgeState>,
  autoEdges: readonly LayoutEdge[],
): void {
  for (const edge of [...autoEdges].reverse()) {
    const choice = state.derivedRouteChoices[edge.elementId];
    const publicRoute = routes[edge.elementId];
    const current = routeStates.get(edge.elementId);
    const source = state.geometries[edge.sourceElementId];
    const target = state.geometries[edge.targetElementId];
    if (
      choice?.source !== "auto"
      || choice.family !== "curve"
      || !choice.curve
      || !publicRoute
      || publicRoute.length < 2
      || !current
      || !source
      || !target
      || edge.sourceElementId === edge.targetElementId
    ) continue;

    const others = routedOthers(sorted, routeStates, edge, state);
    const obstacles = routeObstacles(edge, state);
    const currentCost = routeCost(current.points, edge, obstacles, others);
    const currentCandidate: EvaluatedDerivedCurveCandidate = {
      route: publicRoute.map(copyPoint),
      curve: choice.curve,
      flattened: current.points.map(copyPoint),
      cost: currentCost,
      rejection: undefined,
    };
    const alternatives = boundedDerivedCurveCandidates(
      edge,
      publicRoute,
      obstacles,
      others,
      state,
    ).map((candidate): EvaluatedDerivedCurveCandidate => {
      const cost = routeCost(candidate.flattened, edge, obstacles, others);
      return { ...candidate, cost, rejection: routeFamilyRejection(
        candidate.flattened,
        cost,
        currentCost,
        edge,
        others,
        source,
        target,
      ) };
    }).filter((candidate) => candidate.rejection === undefined);
    const best = [currentCandidate, ...alternatives].sort(compareDerivedCurveCandidate)[0]!;
    if (curveCandidateSignature(best) === curveCandidateSignature(currentCandidate)) continue;

    routes[edge.elementId] = best.route.map(copyPoint);
    routeStates.set(edge.elementId, {
      edge,
      points: best.flattened.map(copyPoint),
      bounds: pointBounds(best.flattened),
    });
    state.derivedRouteChoices[edge.elementId] = {
      ...choice,
      reason: "auto-curve-safe",
      curve: best.curve,
    };
  }
}

/**
 * The full candidate comparison is intentionally quadratic because every
 * curve must be flattened against every visible peer. Beyond the documented
 * quality budget, preserve the already-bounded route and classify it in one
 * pass instead of retaining endpoint-pair obstacle copies for the whole graph.
 */
function selectLargeDerivedRouteFamilies(
  routes: Record<string, Point[]>,
  sorted: readonly LayoutEdge[],
  state: LayoutState,
): Record<string, Point[]> {
  const bundleSignatures = new Map<string, number>();
  for (const edge of sorted) {
    const route = routes[edge.elementId];
    if (!route) continue;
    const key = `${canonicalEndpointPair(edge).join("\n")}\n${routeSignature(route)}`;
    bundleSignatures.set(key, (bundleSignatures.get(key) ?? 0) + 1);
  }
  for (const edge of sorted) {
    const route = routes[edge.elementId];
    if (!route || route.length < 2) continue;
    const explicit = explicitDerivedRouteChoice(edge, route, state);
    if (explicit) {
      state.derivedRouteChoices[edge.elementId] = explicit;
      continue;
    }
    if (edge.sourceElementId === edge.targetElementId) {
      const candidate = selfLoopDerivedCurveCandidate(route);
      routes[edge.elementId] = [copyPoint(route[0]!), copyPoint(route.at(-1)!)];
      state.derivedRouteChoices[edge.elementId] = {
        family: "curve",
        source: "auto",
        reason: "auto-curve-safe",
        ...(candidate ? { curve: candidate.curve } : {}),
        rejected: [
          { family: "straight", reason: "self-loop" },
          { family: "orthogonal", reason: "self-loop" },
        ],
      };
      continue;
    }
    const signatureKey = `${canonicalEndpointPair(edge).join("\n")}\n${routeSignature(route)}`;
    if (route.length === 2 && bundleSignatures.get(signatureKey) === 1) {
      state.derivedRouteChoices[edge.elementId] = {
        family: "straight",
        source: "auto",
        reason: "auto-straight-safe",
      };
      continue;
    }
    if (isOneBendOrthogonalRoute(route) && bundleSignatures.get(signatureKey) === 1) {
      state.derivedRouteChoices[edge.elementId] = {
        family: "orthogonal",
        source: "auto",
        reason: "auto-orthogonal-safe",
        rejected: [{ family: "straight", reason: "interaction" }],
      };
      continue;
    }
    const candidate = largeDerivedCurveCandidate(route, edge);
    routes[edge.elementId] = candidate.route.map(copyPoint);
    state.derivedRouteChoices[edge.elementId] = {
      family: "curve",
      source: "auto",
      reason: "auto-curve-fallback",
      curve: candidate.curve,
      rejected: [
        { family: "straight", reason: "interaction" },
        { family: "orthogonal", reason: "interaction" },
      ],
    };
  }
  return routes;
}

function oneBendOrthogonalCandidates(
  route: readonly Point[],
  edge?: LayoutEdge,
  source?: ElementGeometry,
  target?: ElementGeometry,
  state?: LayoutState,
): Point[][] {
  const start = route[0];
  const end = route.at(-1);
  if (!start || !end || samePoint(start, end)) return [];
  const candidates: Point[][] = [
    [copyPoint(start), { x: end.x, y: start.y }, copyPoint(end)],
    [copyPoint(start), { x: start.x, y: end.y }, copyPoint(end)],
  ];
  if (
    edge && source && target && state
    && !isValidEdgeEndpointAnchor(edge.sourceAnchor)
    && !isValidEdgeEndpointAnchor(edge.targetAnchor)
  ) {
    const sourceShape = layoutElementShape(state.elements.get(edge.sourceElementId));
    const targetShape = layoutElementShape(state.elements.get(edge.targetElementId));
    const horizontalAnchors = [0.25, 0.75];
    const verticalAnchors = [0, 0.5];
    const sourceHorizontal = horizontalAnchors.map((position) => (
      edgeEndpointAnchorPoint(source, sourceShape, { position })
    ));
    const sourceVertical = verticalAnchors.map((position) => (
      edgeEndpointAnchorPoint(source, sourceShape, { position })
    ));
    const targetHorizontal = horizontalAnchors.map((position) => (
      edgeEndpointAnchorPoint(target, targetShape, { position })
    ));
    const targetVertical = verticalAnchors.map((position) => (
      edgeEndpointAnchorPoint(target, targetShape, { position })
    ));
    for (const sourcePoint of sourceHorizontal) {
      for (const targetPoint of targetVertical) {
        candidates.push([
          sourcePoint,
          { x: targetPoint.x, y: sourcePoint.y },
          targetPoint,
        ]);
      }
    }
    for (const sourcePoint of sourceVertical) {
      for (const targetPoint of targetHorizontal) {
        candidates.push([
          sourcePoint,
          { x: sourcePoint.x, y: targetPoint.y },
          targetPoint,
        ]);
      }
    }
  }
  const valid = candidates.filter(isOneBendOrthogonalRoute);
  return [...new Map(valid.map((candidate) => [
    routeSignature(candidate),
    candidate,
  ])).values()].sort((left, right) => compareText(routeSignature(left), routeSignature(right)));
}

function isOneBendOrthogonalRoute(route: readonly Point[]): boolean {
  if (route.length !== 3) return false;
  const [start, pivot, end] = route as readonly [Point, Point, Point];
  const firstHorizontal = start.y === pivot.y && start.x !== pivot.x;
  const firstVertical = start.x === pivot.x && start.y !== pivot.y;
  const secondHorizontal = pivot.y === end.y && pivot.x !== end.x;
  const secondVertical = pivot.x === end.x && pivot.y !== end.y;
  return (firstHorizontal && secondVertical) || (firstVertical && secondHorizontal);
}

function preservesExplicitEndpointLegs(
  candidate: readonly Point[],
  base: readonly Point[],
  edge: LayoutEdge,
): boolean {
  const sameDirection = (left: Point, right: Point): boolean => (
    Math.abs(left.x * right.y - left.y * right.x) <= 1e-6
    && dotProduct(left, right) > 1e-6
  );
  if (isValidEdgeEndpointAnchor(edge.sourceAnchor)) {
    const candidateStart = candidate[0];
    const candidateNext = candidate[1];
    const baseStart = base[0];
    const baseNext = base[1];
    if (
      !candidateStart || !candidateNext || !baseStart || !baseNext
      || !sameDirection(
        { x: candidateNext.x - candidateStart.x, y: candidateNext.y - candidateStart.y },
        { x: baseNext.x - baseStart.x, y: baseNext.y - baseStart.y },
      )
    ) return false;
  }
  if (isValidEdgeEndpointAnchor(edge.targetAnchor)) {
    const candidateEnd = candidate.at(-1);
    const candidatePrevious = candidate.at(-2);
    const baseEnd = base.at(-1);
    const basePrevious = base.at(-2);
    if (
      !candidateEnd || !candidatePrevious || !baseEnd || !basePrevious
      || !sameDirection(
        { x: candidatePrevious.x - candidateEnd.x, y: candidatePrevious.y - candidateEnd.y },
        { x: basePrevious.x - baseEnd.x, y: basePrevious.y - baseEnd.y },
      )
    ) return false;
  }
  return true;
}

function explicitDerivedRouteChoice(
  edge: LayoutEdge,
  route: readonly Point[],
  state: LayoutState,
): LayoutDerivedRouteChoice | undefined {
  // A route-only reconciliation keeps the exact prior renderer result. Check
  // this before an explicit route mode: otherwise an unchanged explicit curve
  // loses its derived controls (and is rejected as non-fixed by validation).
  if (isFixedDerivedRoute(edge, state)) {
    const preserved = state.request.fixedDerivedRouteChoices?.[edge.elementId];
    return preserved
      ? cloneLayoutDerivedRouteChoice(preserved)
      : fixedDerivedRouteChoiceFor(route);
  }
  if (edge.routeMode === "straight") {
    return { family: "straight", source: "explicit", reason: "explicit-route-mode" };
  }
  if (edge.routeMode === "orthogonal") {
    return { family: "orthogonal", source: "explicit", reason: "explicit-route-mode" };
  }
  if (edge.routeMode === "manual" || (isImmutableRoute(edge) && edge.waypoints?.length)) {
    return { family: "manual", source: "explicit", reason: "explicit-route-mode" };
  }
  if (edge.routeMode === "curve") {
    const candidate = derivedCurveCandidate(route, true, edge);
    return {
      family: "curve",
      source: "explicit",
      reason: "explicit-route-mode",
      ...(candidate ? { curve: candidate.curve } : {}),
    };
  }
  if (isImmutableRoute(edge)) {
    return { family: "polyline", source: "explicit", reason: "explicit-route-mode" };
  }
  return undefined;
}

function routeFamilyRejection(
  candidate: readonly Point[],
  candidateCost: RouteCost,
  baseCost: RouteCost,
  edge: LayoutEdge,
  others: readonly RoutedEdge[],
  source: ElementGeometry,
  target: ElementGeometry,
): LayoutDerivedRouteRejection["reason"] | undefined {
  if (!endpointLegsLeaveElements(candidate, source, target)) return "endpoint-direction";
  if (candidateCost[0] !== 0 || candidateCost[2] !== 0) return "obstacle";
  if (duplicatesBundlePeer(candidate, edge, others)) return "parallel-identity";
  if (candidateCost[1] > baseCost[1] || candidateCost[3] > baseCost[3]) return "interaction";
  return undefined;
}

type DerivedCurveCandidate = {
  route: Point[];
  curve: LayoutDerivedCurve;
  flattened: Point[];
};

type EvaluatedDerivedCurveCandidate = DerivedCurveCandidate & {
  cost: RouteCost;
  rejection: LayoutDerivedRouteRejection["reason"] | undefined;
};

function boundedDerivedCurveCandidates(
  edge: LayoutEdge,
  base: readonly Point[],
  obstacles: readonly RouteObstacle[],
  others: readonly RoutedEdge[],
  state: LayoutState,
): DerivedCurveCandidate[] {
  const start = base[0];
  const end = base.at(-1);
  if (!start || !end || samePoint(start, end)) return [];
  const source = state.geometries[edge.sourceElementId];
  const target = state.geometries[edge.targetElementId];
  if (!source || !target) return [];
  const endpointGuides = state.edges.length <= 48
    ? autoCurveEndpointGuides(edge, source, target, state)
    : [];
  const needsExtendedClearance = state.edges.length <= 48
    && obstacles.some((obstacle) => Math.max(obstacle.width, obstacle.height) > 960);
  const compactGuides = compactRouteCandidates(edge, base, obstacles, others, state, false);
  const guideRoutes = [
    base.map(copyPoint),
    ...(state.edges.length <= 48
      ? compactGuides.slice(0, needsExtendedClearance ? 15 : 6)
      : compactGuides),
    ...endpointGuides,
    ...syntheticCurveGuides(start, end, edge.elementId).map((guide) => [
      copyPoint(start),
      guide,
      copyPoint(end),
    ]),
  ];
  const distinctGuides = [...new Map(guideRoutes.flatMap((route) => {
    const routeStart = route[0];
    const routeEnd = route.at(-1);
    const guide = route.length === 3 ? route[1] : undefined;
    if (
      !routeStart || !routeEnd || !guide
      || samePoint(routeStart, guide) || samePoint(guide, routeEnd)
      || innerAngleDegrees(routeStart, guide, routeEnd) < 90 - 1e-6
    ) return [];
    const normalized = [copyPoint(routeStart), copyPoint(guide), copyPoint(routeEnd)];
    return [[routeSignature(normalized), normalized] as const];
  })).values()].slice(0, state.edges.length > 48 ? 2 : needsExtendedClearance ? 32 : 12);
  const pivotTensions = needsExtendedClearance ? [0.82, 4 / 3] : [0.82];
  const corridorTensions = state.edges.length > 48
    ? [3.2]
    : needsExtendedClearance
      ? [0.82, 2, 5.2, 13.6]
      : [5.2];
  const candidates = new Map<string, DerivedCurveCandidate>();
  for (const route of distinctGuides) {
    for (const tension of pivotTensions) {
      const candidate = derivedCurveCandidate(route, false, edge, tension, "pivot");
      if (!candidate || candidate.curve.guideAngleDegrees < 90 - 1e-6) continue;
      candidates.set(curveCandidateSignature(candidate), candidate);
    }
    for (const tension of corridorTensions) {
      const candidate = derivedCurveCandidate(route, false, edge, tension, "corridor");
      if (!candidate || candidate.curve.guideAngleDegrees < 90 - 1e-6) continue;
      candidates.set(curveCandidateSignature(candidate), candidate);
    }
  }
  if (state.edges.length <= 48) {
    for (const offsetRatio of [0.32, 0.4]) {
      for (const sign of [-1, 1]) {
        const candidate = derivedSCurveCandidate(base, offsetRatio, sign);
        if (!candidate) continue;
        candidates.set(curveCandidateSignature(candidate), candidate);
      }
    }
  }
  return [...candidates.values()].filter((candidate) => (
    curveCandidateWithinLocalEnvelope(candidate, base, source, target, obstacles)
  ));
}

function autoCurveEndpointGuides(
  edge: LayoutEdge,
  source: ElementGeometry,
  target: ElementGeometry,
  state: LayoutState,
): Point[][] {
  if (isValidEdgeEndpointAnchor(edge.sourceAnchor) || isValidEdgeEndpointAnchor(edge.targetAnchor)) {
    return [];
  }
  const sourceShape = layoutElementShape(state.elements.get(edge.sourceElementId));
  const targetShape = layoutElementShape(state.elements.get(edge.targetElementId));
  const endpointPairs = [
    [0.25, 0.75],
    [0.75, 0.25],
    [0.5, 0],
    [0, 0.5],
    [0.25, 0.25],
    [0.75, 0.75],
    [0, 0],
    [0.5, 0.5],
  ] as const;
  return endpointPairs.flatMap(([sourcePosition, targetPosition]) => {
    const start = edgeEndpointAnchorPoint(source, sourceShape, { position: sourcePosition });
    const end = edgeEndpointAnchorPoint(target, targetShape, { position: targetPosition });
    if (samePoint(start, end)) return [];
    return syntheticCurveGuides(
      start,
      end,
      `${edge.elementId}:${sourcePosition}:${targetPosition}`,
    ).slice(2, 4).map((guide) => [start, guide, end]);
  });
}

function curveCandidateWithinLocalEnvelope(
  candidate: DerivedCurveCandidate,
  base: readonly Point[],
  source: ElementGeometry,
  target: ElementGeometry,
  obstacles: readonly RouteObstacle[] = [],
): boolean {
  const sourceCenter = centerOf(source);
  const targetCenter = centerOf(target);
  const obstacleDetour = Math.min(960, Math.max(
    0,
    ...obstacles.map((obstacle) => Math.max(obstacle.width, obstacle.height) * 0.35),
  ));
  const padding = Math.max(
    48,
    Math.min(480, pointDistance(sourceCenter, targetCenter) * 0.4),
    obstacleDetour,
  );
  const corridor = expandGeometry(pointBounds([
    ...base,
    { x: source.x, y: source.y },
    { x: source.x + source.width, y: source.y + source.height },
    { x: target.x, y: target.y },
    { x: target.x + target.width, y: target.y + target.height },
  ]), padding);
  return [
    candidate.curve.sourceControl,
    candidate.curve.targetControl,
    ...candidate.flattened,
  ].every((point) => pointInsideOrOnGeometry(point, corridor));
}

function compareDerivedCurveCandidate(
  left: EvaluatedDerivedCurveCandidate,
  right: EvaluatedDerivedCurveCandidate,
): number {
  return compareNumberTuples(left.cost, right.cost)
    || compareText(curveCandidateSignature(left), curveCandidateSignature(right));
}

function curveCandidateSignature(candidate: DerivedCurveCandidate): string {
  return [
    routeSignature(candidate.route),
    pointSignature(candidate.curve.sourceControl),
    pointSignature(candidate.curve.targetControl),
  ].join("|");
}

function largeDerivedCurveCandidate(
  route: readonly Point[],
  edge: LayoutEdge,
): DerivedCurveCandidate {
  const start = route[0]!;
  const end = route.at(-1)!;
  const candidates = [
    derivedCurveCandidate(route, false, edge),
    ...syntheticCurveGuides(start, end, edge.elementId).map((guide) => (
      derivedCurveCandidate([start, guide, end], false, edge)
    )),
  ].filter((candidate): candidate is DerivedCurveCandidate => (
    candidate !== undefined && candidate.curve.guideAngleDegrees >= 90 - 1e-6
  ));
  return candidates.sort((left, right) => (
    compareText(curveCandidateSignature(left), curveCandidateSignature(right))
  ))[0] ?? derivedCurveCandidate(
    [start, syntheticCurveGuide(start, end, edge.elementId), end],
    false,
    edge,
  )!;
}

function selfLoopDerivedCurveCandidate(
  route: readonly Point[],
): DerivedCurveCandidate | undefined {
  const start = route[0];
  const end = route.at(-1);
  const sourceControl = route[1];
  const targetControl = route.at(-2);
  if (!start || !end || !sourceControl || !targetControl || samePoint(start, end)) return undefined;
  const curve: LayoutDerivedCurve = {
    sourceControl: copyPoint(sourceControl),
    targetControl: copyPoint(targetControl),
    guidePivot: {
      x: (start.x + end.x) / 2,
      y: (start.y + end.y) / 2,
    },
    guideAngleDegrees: 180,
  };
  const publicRoute = [copyPoint(start), copyPoint(end)];
  return {
    route: publicRoute,
    curve,
    flattened: flattenLayoutDerivedCurve(publicRoute, curve),
  };
}

function derivedCurveCandidate(
  route: readonly Point[],
  allowSyntheticGuide: boolean,
  edge: LayoutEdge,
  tension = 0.82,
  controlMode: "pivot" | "corridor" = "pivot",
): DerivedCurveCandidate | undefined {
  const start = route[0];
  const end = route.at(-1);
  if (!start || !end || samePoint(start, end)) return undefined;
  const guide = route.length === 3
    ? copyPoint(route[1]!)
    : allowSyntheticGuide ? syntheticCurveGuide(start, end, edge.elementId) : undefined;
  if (!guide || samePoint(start, guide) || samePoint(guide, end)) return undefined;
  const angle = innerAngleDegrees(start, guide, end);
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy) || 1;
  const tangent = { x: dx / length, y: dy / length };
  const normal = { x: -tangent.y, y: tangent.x };
  const middle = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  const guideOffset = { x: guide.x - middle.x, y: guide.y - middle.y };
  const along = dotProduct(guideOffset, tangent);
  const perpendicular = dotProduct(guideOffset, normal);
  const sourceAlong = length / 3 + along * 0.5;
  const targetAlong = length / 3 - along * 0.5;
  const curve: LayoutDerivedCurve = {
    sourceControl: controlMode === "pivot" ? interpolatePoint(start, guide, tension) : {
      x: start.x + tangent.x * sourceAlong + normal.x * perpendicular * tension,
      y: start.y + tangent.y * sourceAlong + normal.y * perpendicular * tension,
    },
    targetControl: controlMode === "pivot" ? interpolatePoint(end, guide, tension) : {
      x: end.x - tangent.x * targetAlong + normal.x * perpendicular * tension,
      y: end.y - tangent.y * targetAlong + normal.y * perpendicular * tension,
    },
    guidePivot: guide,
    guideAngleDegrees: angle,
  };
  const publicRoute = [copyPoint(start), copyPoint(end)];
  return {
    route: publicRoute,
    curve,
    flattened: flattenLayoutDerivedCurve(publicRoute, curve),
  };
}

function derivedSCurveCandidate(
  route: readonly Point[],
  offsetRatio: number,
  sign: number,
): DerivedCurveCandidate | undefined {
  const start = route[0];
  const end = route.at(-1);
  if (!start || !end || samePoint(start, end)) return undefined;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return undefined;
  const tangent = { x: dx / length, y: dy / length };
  const normal = { x: -tangent.y, y: tangent.x };
  const offset = Math.min(480, length * offsetRatio) * sign;
  const curve: LayoutDerivedCurve = {
    sourceControl: {
      x: start.x + tangent.x * length / 3 + normal.x * offset,
      y: start.y + tangent.y * length / 3 + normal.y * offset,
    },
    targetControl: {
      x: end.x - tangent.x * length / 3 - normal.x * offset,
      y: end.y - tangent.y * length / 3 - normal.y * offset,
    },
    guidePivot: {
      x: (start.x + end.x) / 2,
      y: (start.y + end.y) / 2,
    },
    guideAngleDegrees: 180,
  };
  const publicRoute = [copyPoint(start), copyPoint(end)];
  return {
    route: publicRoute,
    curve,
    flattened: flattenLayoutDerivedCurve(publicRoute, curve),
  };
}

function syntheticCurveGuide(start: Point, end: Point, identity: string): Point {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy) || 1;
  const offset = Math.max(0.25, Math.min(80, Math.max(4, length * 0.15), length * 0.45));
  const sign = stableTextParity(identity) === 0 ? -1 : 1;
  return {
    x: (start.x + end.x) / 2 - dy / length * offset * sign,
    y: (start.y + end.y) / 2 + dx / length * offset * sign,
  };
}

function syntheticCurveGuides(start: Point, end: Point, _identity: string): Point[] {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy) || 1;
  const middle = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  const normal = { x: -dy / length, y: dx / length };
  const result: Point[] = [];
  for (const ratio of [0.12, 0.24, 0.36, 0.45]) {
    const offset = Math.max(0.25, length * ratio);
    for (const sign of [-1, 1]) {
      result.push({
        x: middle.x + normal.x * offset * sign,
        y: middle.y + normal.y * offset * sign,
      });
    }
  }
  return result;
}

function stableTextHash(value: string): number {
  let result = 0;
  for (let index = 0; index < value.length; index += 1) {
    result = (result * 31 + value.charCodeAt(index)) >>> 0;
  }
  return result;
}

function stableTextParity(value: string): 0 | 1 {
  return (stableTextHash(value) & 1) as 0 | 1;
}

function interpolatePoint(start: Point, end: Point, ratio: number): Point {
  return {
    x: start.x + (end.x - start.x) * ratio,
    y: start.y + (end.y - start.y) * ratio,
  };
}

function innerAngleDegrees(start: Point, pivot: Point, end: Point): number {
  const left = { x: start.x - pivot.x, y: start.y - pivot.y };
  const right = { x: end.x - pivot.x, y: end.y - pivot.y };
  const denominator = Math.hypot(left.x, left.y) * Math.hypot(right.x, right.y);
  if (denominator === 0) return 0;
  const cosine = Math.max(-1, Math.min(1, dotProduct(left, right) / denominator));
  return Math.acos(cosine) * 180 / Math.PI;
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
      const obstacles = routeObstacles(edge, state);
      const baseBounds = pointBounds(base);
      const baseObstacleCost = routeObstacleCost(base, baseBounds, obstacles);
      // A body-clear bounded route already satisfies the public cardinality
      // and obstacle contracts. Past the bounded exhaustive-compaction graph
      // size, peer rescoring grows quadratically without improving obstacle
      // safety, so defer the final family decision to the bounded selector.
      if (
        state.edges.length > ROUTE_EXHAUSTIVE_COMPACTION_EDGE_LIMIT
        &&
        base.length <= 3
        && baseObstacleCost.bodyIntersections === 0
        && baseObstacleCost.reservationIntersections === 0
      ) continue;
      const others = routedOthers(sorted, routeStates, edge, state);
      const baseCost = routeCostWithObstacleIntersections(
        base,
        baseBounds,
        baseObstacleCost,
        edge,
        others,
      );
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
      result.push({ ...expandGeometry(geometry, ROUTE_RENDERER_CLEARANCE), kind: "body" });
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

function copyGeometryRecord(
  input: Readonly<Record<string, ElementGeometry>>,
): Record<string, ElementGeometry> {
  return Object.fromEntries(Object.entries(input).map(([id, geometry]) => [
    id,
    copyGeometry(geometry),
  ]));
}

function sameGeometryRecord(
  left: Readonly<Record<string, ElementGeometry>>,
  right: Readonly<Record<string, ElementGeometry>>,
): boolean {
  const leftIds = Object.keys(left).sort(compareText);
  const rightIds = Object.keys(right).sort(compareText);
  return leftIds.length === rightIds.length
    && leftIds.every((id, index) => (
      id === rightIds[index]
      && right[id] !== undefined
      && sameGeometry(left[id]!, right[id]!)
    ));
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
