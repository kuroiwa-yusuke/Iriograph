import { hasBlockingDiagnostics, sortDiagnostics } from "./diagnostics.js";
import { isSafeVisualStyleOverride } from "./appearance.js";
import { isValidEdgeEndpointAnchor } from "./endpoint-anchor.js";
import type {
  DiagramScene,
  DiagramView,
  IriographDocument,
  Point,
  ProjectedAnnotation,
  ProjectedContainer,
  ProjectedEdge,
  ProjectedNode,
  ProjectedRegion,
  ProjectionCatalogV1,
  ProjectionDiagnostic,
  SceneAnnotation,
  SceneContainer,
  SceneEdge,
  SceneNode,
  SceneRegion,
  ViewElementOverlay,
} from "./model.js";
import { projectSemanticView } from "./projection.js";
import { canonicalQuad, parseSemanticGraph } from "./rdf.js";
import type { LayoutDerivedRouteChoice } from "./layout.js";
import {
  buildIriographView,
  type ProjectionRuntimeContext,
} from "./scene.js";
import { cachedIncrementalIriographView } from "./scene-cache.js";

type GeometryElement = ProjectedNode | ProjectedContainer | ProjectedRegion;
type SemanticProjectedAnnotation = ProjectedAnnotation & {
  annotationKind: "semantic-literal";
  semanticRef: string;
};
type SemanticSceneAnnotation = SceneAnnotation & {
  annotationKind: "semantic-literal";
  semanticRef: string;
};
type ProjectedElement = GeometryElement | ProjectedEdge | SemanticProjectedAnnotation;
type SceneElement = SceneNode | SceneContainer | SceneRegion | SceneEdge | SemanticSceneAnnotation;

export type DisplayReconciliationResult = {
  accepted: boolean;
  document: IriographDocument;
  scenes: Record<string, DiagramScene>;
  diagnostics: ProjectionDiagnostic[];
};

export type DisplayReconciliationOptions = {
  mode?: "full" | "edge-only";
  observer?: (event: Readonly<DisplayReconciliationEvent>) => void;
};

export type DisplayReconciliationEvent = {
  viewId: string;
  requestedMode: "full" | "edge-only";
  actualMode: "incremental" | "route-only";
  fallbackReason?: "previous-scene-missing" | "profile-changed" | "layout-changed"
    | "view-kind-changed" | "visible-structure-changed";
  /** Candidate edges whose route may be recomputed in this view. */
  affectedEdges?: number;
  /** Previous generated routes reused exactly by this view. */
  fixedDerivedRoutes?: number;
};

export type SemanticReconciliationScope =
  | "none"
  | "subproperty-hierarchy-only"
  | "semantic-or-structure";

const RDFS_SUBPROPERTY_OF = "http://www.w3.org/2000/01/rdf-schema#subPropertyOf";

/**
 * Classifies the asserted dataset delta without inferring superproperty
 * statements. A hierarchy-only result is an optimization hint, never license
 * to synthesize an edge for an unasserted superproperty.
 */
export function classifySemanticReconciliationScope(
  previous: IriographDocument,
  candidate: IriographDocument,
): SemanticReconciliationScope {
  let before: ReturnType<typeof parseSemanticGraph>["quads"];
  let after: ReturnType<typeof parseSemanticGraph>["quads"];
  try {
    before = parseSemanticGraph(previous).quads;
    after = parseSemanticGraph(candidate).quads;
  } catch {
    // Syntax diagnostics belong to the normal projection/validation pipeline.
    return "semantic-or-structure";
  }
  const beforeByKey = new Map(before.map((value) => [canonicalQuad(value), value]));
  const afterByKey = new Map(after.map((value) => [canonicalQuad(value), value]));
  const changed = [
    ...before.filter((value) => !afterByKey.has(canonicalQuad(value))),
    ...after.filter((value) => !beforeByKey.has(canonicalQuad(value))),
  ];
  if (changed.length === 0) return "none";
  return changed.every((value) => value.predicate.value === RDFS_SUBPROPERTY_OF)
    ? "subproperty-hierarchy-only"
    : "semantic-or-structure";
}

/** Reprojects and lays out every candidate view as one atomic operation. */
export async function reconcileIriographDocumentViews(
  previous: IriographDocument,
  candidate: IriographDocument,
  context: ProjectionRuntimeContext,
  options: DisplayReconciliationOptions = {},
): Promise<DisplayReconciliationResult> {
  const next = clone(candidate);
  const scenes: Record<string, DiagramScene> = {};
  const diagnostics: ProjectionDiagnostic[] = [];

  for (const view of next.views) {
    const profile = context.catalogsByProfile.get(view.profileRef);
    if (!profile) {
      diagnostics.push({
        severity: "error",
        code: "profile-catalog-unresolved",
        message: `profileの解決済みcatalogがありません: ${view.profileRef}`,
        semanticRef: view.viewId,
      });
      return rejected(previous, diagnostics);
    }

    const previousView = previous.views.find((item) => item.viewId === view.viewId);
    let previousScene: DiagramScene | undefined;
    if (previousView) {
      previousScene = cachedIncrementalIriographView(previous, view.viewId, context)
        ?? await buildIriographView(previous, view.viewId, context, "incremental");
      // The previous scene is reconstructed only as reconciliation input. Its
      // non-blocking layout warnings describe the old display and must not be
      // reported as results of the candidate transaction (or accumulated on
      // every endpoint-only edit).
      if (hasBlockingDiagnostics(previousScene.diagnostics)) {
        diagnostics.push(...previousScene.diagnostics);
        return rejected(previous, diagnostics);
      }
    }

    const rawDocument = clone(next);
    const rawView = rawDocument.views.find((item) => item.viewId === view.viewId)!;
    rawView.overlay = {};
    const rawProjected = projectSemanticView(
      rawDocument,
      profile.catalog,
      view.viewId,
      context.projectionOptions,
    );
    diagnostics.push(...rawProjected.diagnostics);
    if (hasBlockingDiagnostics(rawProjected.diagnostics)) return rejected(previous, diagnostics);

    const reconciled = reconcileViewOverlay(
      previousView,
      previousScene,
      rawProjected,
      profile.catalog,
    );
    diagnostics.push(...reconciled.diagnostics);
    const fallbackReason = options.mode === "edge-only"
      ? edgeOnlyFallbackReason(previousView, previousScene, view, rawProjected)
      : undefined;
    const edgeOnly = options.mode === "edge-only" && fallbackReason === undefined;
    if (options.mode === "edge-only" && fallbackReason) {
      diagnostics.push({
        severity: "info",
        category: "layout",
        code: "reconcile-edge-only-fallback",
        message: `Edge-only reconciliation fell back to incremental layout: ${fallbackReason}`,
        semanticRef: view.viewId,
      });
    }
    view.overlay = edgeOnly
      ? preservePreviousGeometry(reconciled.overlay, previousScene!, rawProjected)
      : reconciled.overlay;
    const routePlan = edgeOnly
      ? planEdgeOnlyRoutes(previousScene!, rawProjected, view.overlay)
      : undefined;
    const newlyConstrainedElementIds = edgeOnly || !previousScene
      ? []
      : newlyConstrainedMembershipElementIds(previousScene, rawProjected, view.overlay);
    const preservedElementIds = edgeOnly || !previousScene
      ? []
      : preservedReconciledElementIds(previousScene, rawProjected, view.overlay);
    if (options.observer) {
      try {
        options.observer(Object.freeze({
          viewId: view.viewId,
          requestedMode: options.mode ?? "full",
          actualMode: edgeOnly ? "route-only" : "incremental",
          ...(fallbackReason ? { fallbackReason } : {}),
          ...(routePlan ? {
            affectedEdges: routePlan.affectedEdgeIds.size,
            fixedDerivedRoutes: Object.keys(routePlan.fixedDerivedRoutes).length,
          } : {}),
        }));
      } catch {
        // Reconciliation instrumentation is observational and cannot fail a transaction.
      }
    }
    const scene = await buildIriographView(
      next,
      view.viewId,
      context,
      edgeOnly ? "route-only" : "incremental",
      routePlan?.fixedDerivedRoutes,
      routePlan?.fixedDerivedRouteChoices,
      newlyConstrainedElementIds,
      preservedElementIds,
    );
    const sceneDiagnostics = relevantSceneDiagnostics(scene.diagnostics, edgeOnly, routePlan);
    diagnostics.push(...sceneDiagnostics);
    if (hasBlockingDiagnostics(scene.diagnostics)) return rejected(previous, diagnostics);
    view.overlay = persistLayoutGeometry(view, scene);
    scenes[view.viewId] = { ...scene, diagnostics: sceneDiagnostics };
  }

  return {
    accepted: true,
    document: next,
    scenes,
    diagnostics: uniqueSortedDiagnostics(diagnostics),
  };
}

function preservedReconciledElementIds(
  previous: DiagramScene,
  next: {
    nodes: ProjectedNode[];
    containers: ProjectedContainer[];
    regions?: ProjectedRegion[];
    annotations?: ProjectedAnnotation[];
  },
  overlay: Readonly<Record<string, ViewElementOverlay>>,
): string[] {
  const previousKindBySemantic = new Map([
    ...previous.nodes,
    ...previous.containers,
    ...(previous.regions ?? []),
    ...semanticSceneAnnotations(previous),
  ].map((element) => [element.semanticRef, element.structuralKind]));
  const elementIdBySemantic = new Map(Object.entries(overlay).flatMap(([elementId, entry]) => (
    entry.geometry ? [[entry.semanticRef, elementId] as const] : []
  )));
  return [
    ...next.nodes,
    ...next.containers,
    ...(next.regions ?? []),
    ...semanticProjectedAnnotations(next),
  ]
    .flatMap((element) => (
      previousKindBySemantic.get(element.semanticRef) === element.structuralKind
        && elementIdBySemantic.has(element.semanticRef)
        ? [elementIdBySemantic.get(element.semanticRef)!]
        : []
    ))
    .sort(compareIdentity);
}

function newlyConstrainedMembershipElementIds(
  previous: DiagramScene,
  next: {
    nodes: ProjectedNode[];
    containers: ProjectedContainer[];
    regions?: ProjectedRegion[];
    memberships?: DiagramScene["memberships"];
  },
  overlay: Readonly<Record<string, ViewElementOverlay>>,
): string[] {
  const previousSemanticByElementId = new Map([
    ...previous.nodes,
    ...previous.containers,
    ...(previous.regions ?? []),
  ].map((element) => [element.elementId, element.semanticRef]));
  const previousKindBySemantic = new Map([
    ...previous.nodes,
    ...previous.containers,
    ...(previous.regions ?? []),
  ].map((element) => [element.semanticRef, element.structuralKind]));
  const nextElements = [
    ...next.nodes,
    ...next.containers,
    ...(next.regions ?? []),
  ];
  const nextSemanticByElementId = new Map([
    ...nextElements,
  ].map((element) => [element.elementId, element.semanticRef]));
  const effectiveElementIdBySemantic = new Map(Object.entries(overlay).map(([elementId, entry]) => [
    entry.semanticRef,
    elementId,
  ]));
  const previousMemberships = new Set((previous.memberships ?? []).flatMap((membership) => {
    const ownerSemanticRef = previousSemanticByElementId.get(membership.containerElementId);
    const memberSemanticRef = previousSemanticByElementId.get(membership.memberElementId);
    return ownerSemanticRef && memberSemanticRef
      ? [spatialMembershipKey(ownerSemanticRef, memberSemanticRef)]
      : [];
  }));
  const geometryElementsById = new Map(nextElements.map((element) => [element.elementId, element]));
  return [...new Set((next.memberships ?? []).flatMap((membership) => {
    const ownerSemanticRef = nextSemanticByElementId.get(membership.containerElementId);
    const memberSemanticRef = nextSemanticByElementId.get(membership.memberElementId);
    if (
      !ownerSemanticRef
      || !memberSemanticRef
      || previousMemberships.has(spatialMembershipKey(
        ownerSemanticRef,
        memberSemanticRef,
      ))
    ) return [];
    const member = geometryElementsById.get(membership.memberElementId);
    if (!member) return [];
    const previousKind = previousKindBySemantic.get(memberSemanticRef);
    return previousKind === undefined || previousKind === member.structuralKind
      ? [effectiveElementIdBySemantic.get(memberSemanticRef) ?? membership.memberElementId]
      : [];
  }))].sort(compareIdentity);
}

function spatialMembershipKey(
  ownerSemanticRef: string,
  memberSemanticRef: string,
): string {
  return JSON.stringify([ownerSemanticRef, memberSemanticRef]);
}

type EdgeOnlyRoutePlan = {
  affectedEdgeIds: Set<string>;
  fixedDerivedRoutes: Record<string, Point[]>;
  fixedDerivedRouteChoices: Record<string, LayoutDerivedRouteChoice>;
};

/**
 * Limits an edge-only transaction to the changed candidate edges. Existing
 * incident routes stay fixed and still participate in the changed route's
 * crossing/overlap cost, avoiding a cascading reroute for a local edit.
 */
function planEdgeOnlyRoutes(
  previous: DiagramScene,
  projected: {
    nodes: ProjectedNode[];
    containers: ProjectedContainer[];
    regions?: ProjectedRegion[];
    edges: ProjectedEdge[];
  },
  overlay: Readonly<Record<string, ViewElementOverlay>>,
): EdgeOnlyRoutePlan {
  const overlayElementBySemantic = new Map(Object.entries(overlay).map(([elementId, entry]) => [
    entry.semanticRef,
    elementId,
  ]));
  const projectedSemanticByElement = new Map([
    ...projected.nodes,
    ...projected.containers,
    ...(projected.regions ?? []),
  ].map((element) => [element.elementId, element.semanticRef]));
  const effectiveElementId = (elementId: string): string => {
    const semanticRef = projectedSemanticByElement.get(elementId);
    return semanticRef ? overlayElementBySemantic.get(semanticRef) ?? elementId : elementId;
  };
  const candidates = projected.edges.map((edge) => ({
    edge,
    elementId: overlayElementBySemantic.get(edge.semanticRef) ?? edge.elementId,
    sourceElementId: effectiveElementId(edge.sourceElementId),
    targetElementId: effectiveElementId(edge.targetElementId),
  })).map((candidate) => ({
    ...candidate,
    overlay: overlay[candidate.elementId],
  })).sort((left, right) => compareIdentity(left.elementId, right.elementId));
  const previousById = new Map(previous.edges.map((edge) => [edge.elementId, edge]));
  const changedCandidateIds = new Set<string>();
  for (const candidate of candidates) {
    const oldEdge = previousById.get(candidate.elementId);
    if (
      !oldEdge
      || candidate.sourceElementId !== oldEdge.sourceElementId
      || candidate.targetElementId !== oldEdge.targetElementId
      || routeRelevantEdgeChanged(oldEdge, candidate.edge, candidate.overlay)
    ) {
      changedCandidateIds.add(candidate.elementId);
    }
  }

  const affectedEdgeIds = changedCandidateIds;
  const fixedDerivedRoutes: Record<string, Point[]> = {};
  const fixedDerivedRouteChoices: Record<string, LayoutDerivedRouteChoice> = {};
  for (const candidate of candidates) {
    if (affectedEdgeIds.has(candidate.elementId)) continue;
    const oldEdge = previousById.get(candidate.elementId);
    const derived = candidate.edge.routingPlacement !== "user"
      && candidate.edge.routeMode !== "manual";
    if (!oldEdge?.route || oldEdge.route.length < 2 || !derived) continue;
    fixedDerivedRoutes[candidate.elementId] = oldEdge.route.map((point) => clone(point));
    if (oldEdge.derivedRouteChoice) {
      fixedDerivedRouteChoices[candidate.elementId] = {
        ...clone(oldEdge.derivedRouteChoice),
        source: "fixed",
        reason: "fixed-derived-route",
      };
    }
  }
  return { affectedEdgeIds, fixedDerivedRoutes, fixedDerivedRouteChoices };
}

function routeRelevantEdgeChanged(
  previous: SceneEdge,
  candidate: ProjectedEdge,
  overlay: ViewElementOverlay | undefined,
): boolean {
  return previous.templateRef !== (overlay?.appearance?.templateRef ?? candidate.templateRef)
    || previous.routeMode !== (overlay?.routing?.routeMode ?? candidate.routeMode)
    || JSON.stringify(previous.sourceAnchor)
      !== JSON.stringify(overlay?.routing?.sourceAnchor ?? candidate.sourceAnchor)
    || JSON.stringify(previous.targetAnchor)
      !== JSON.stringify(overlay?.routing?.targetAnchor ?? candidate.targetAnchor);
}

function edgeOnlyFallbackReason(
  previousView: DiagramView | undefined,
  previousScene: DiagramScene | undefined,
  nextView: DiagramView,
  nextScene: {
    nodes: ProjectedNode[];
    containers: ProjectedContainer[];
    regions?: ProjectedRegion[];
    annotations?: ProjectedAnnotation[];
    memberships?: DiagramScene["memberships"];
  },
): DisplayReconciliationEvent["fallbackReason"] {
  if (!previousScene || !previousView) return "previous-scene-missing";
  if (previousView.profileRef !== nextView.profileRef) return "profile-changed";
  if (previousView.layoutRef !== nextView.layoutRef) return "layout-changed";
  if (previousView.kind !== nextView.kind) return "view-kind-changed";
  if (!sameVisibleStructure(previousScene, nextScene)) return "visible-structure-changed";
  return undefined;
}

function sameVisibleStructure(
  previous: DiagramScene,
  next: {
    nodes: ProjectedNode[];
    containers: ProjectedContainer[];
    regions?: ProjectedRegion[];
    annotations?: ProjectedAnnotation[];
    memberships?: DiagramScene["memberships"];
  },
): boolean {
  const elementSignature = (elements: readonly (SceneElement | ProjectedElement)[]) => elements
    .filter((element) => element.structuralKind !== "edge")
    .map((element) => ({
      elementId: element.elementId,
      semanticRef: element.semanticRef,
      structuralKind: element.structuralKind,
      parentElementId: "parentElementId" in element ? element.parentElementId : undefined,
      templateRef: element.templateRef,
      label: "label" in element ? element.label : undefined,
      semanticText: "semanticText" in element ? element.semanticText : undefined,
      annotationKind: element.structuralKind === "annotation" ? element.annotationKind : undefined,
      text: element.structuralKind === "annotation" ? element.text : undefined,
      shape: element.structuralKind === "node" ? element.shape : undefined,
      groupRole: element.structuralKind === "container" ? element.groupRole : undefined,
      headerPosition: element.structuralKind === "container" ? element.headerPosition : undefined,
    }))
    .sort((left, right) => compareIdentity(left.elementId, right.elementId));
  const membershipSignature = (memberships: DiagramScene["memberships"] | undefined) =>
    [...(memberships ?? [])].map((membership) => ({
      semanticRef: membership.semanticRef,
      containerElementId: membership.containerElementId,
      memberElementId: membership.memberElementId,
      regionElementId: membership.regionElementId,
      role: membership.role,
      ordinal: membership.ordinal,
    })).sort((left, right) => (
      compareIdentity(left.semanticRef, right.semanticRef)
      || compareIdentity(left.containerElementId, right.containerElementId)
      || compareIdentity(left.memberElementId, right.memberElementId)
      || compareIdentity(left.regionElementId ?? "", right.regionElementId ?? "")
      || compareIdentity(left.role ?? "", right.role ?? "")
      || (left.ordinal ?? 0) - (right.ordinal ?? 0)
    ));
  return JSON.stringify(elementSignature([
    ...previous.containers,
    ...(previous.regions ?? []),
    ...previous.nodes,
    ...semanticSceneAnnotations(previous),
  ])) === JSON.stringify(elementSignature([
    ...next.containers,
    ...(next.regions ?? []),
    ...next.nodes,
    ...semanticProjectedAnnotations(next),
  ]))
    && JSON.stringify(membershipSignature(previous.memberships))
      === JSON.stringify(membershipSignature(next.memberships));
}

function preservePreviousGeometry(
  overlay: Record<string, ViewElementOverlay>,
  previous: DiagramScene,
  next: {
    nodes: ProjectedNode[];
    containers: ProjectedContainer[];
    regions?: ProjectedRegion[];
    annotations?: ProjectedAnnotation[];
  },
): Record<string, ViewElementOverlay> {
  const result = clone(overlay);
  const previousByElementId = new Map([
    ...previous.containers,
    ...(previous.regions ?? []),
    ...previous.nodes,
    ...semanticSceneAnnotations(previous),
  ].map((element) => [element.elementId, element]));
  for (const element of [
    ...next.containers,
    ...(next.regions ?? []),
    ...next.nodes,
    ...semanticProjectedAnnotations(next),
  ]) {
    const oldElement = previousByElementId.get(element.elementId);
    if (!oldElement || oldElement.structuralKind !== element.structuralKind) continue;
    const existing = result[element.elementId];
    result[element.elementId] = {
      ...(existing ?? { semanticRef: element.semanticRef }),
      semanticRef: element.semanticRef,
      geometry: clone(oldElement.geometry),
      pinned: oldElement.pinned,
      placement: oldElement.placement,
    };
  }
  return result;
}

function reconcileViewOverlay(
  previousView: DiagramView | undefined,
  previousScene: DiagramScene | undefined,
  projected: {
    nodes: ProjectedNode[];
    containers: ProjectedContainer[];
    regions?: ProjectedRegion[];
    edges: ProjectedEdge[];
    annotations?: ProjectedAnnotation[];
  },
  catalog: ProjectionCatalogV1,
): { overlay: Record<string, ViewElementOverlay>; diagnostics: ProjectionDiagnostic[] } {
  if (!previousView || !previousScene) return { overlay: {}, diagnostics: [] };
  const diagnostics: ProjectionDiagnostic[] = [];
  const previousElements = new Map<string, SceneElement>([
    ...previousScene.nodes,
    ...previousScene.containers,
    ...(previousScene.regions ?? []),
    ...previousScene.edges,
    ...semanticSceneAnnotations(previousScene),
  ].map((element) => [element.semanticRef, element]));
  const previousSemanticByElementId = new Map(
    [...previousElements.values()].map((element) => [element.elementId, element.semanticRef]),
  );
  const nextElements = [
    ...projected.containers,
    ...(projected.regions ?? []),
    ...projected.nodes,
    ...projected.edges,
    ...semanticProjectedAnnotations(projected),
  ];
  const nextSemanticByElementId = new Map(
    nextElements.map((element) => [element.elementId, element.semanticRef]),
  );
  const previousOverlay = new Map(
    Object.entries(previousView.overlay).map(([elementId, overlay]) => [
      overlay.semanticRef,
      { elementId, overlay },
    ]),
  );
  const overlay: Record<string, ViewElementOverlay> = {};
  const nextSemanticRefs = new Set<string>();

  for (const element of nextElements) {
    nextSemanticRefs.add(element.semanticRef);
    const oldElement = previousElements.get(element.semanticRef);
    const oldEntry = previousOverlay.get(element.semanticRef);
    if (!oldElement) continue;
    if (
      oldEntry
      && oldElement.structuralKind === "edge"
      && element.structuralKind === "edge"
      && !sameEdgeEndpoints(
        oldElement,
        element,
        previousSemanticByElementId,
        nextSemanticByElementId,
      )
    ) {
      diagnostics.push({
        severity: "warning",
        code: "reconcile-edge-endpoints-changed",
        message: `${element.semanticRef}のendpoint変更によりroutingを除去しました。`,
        semanticRef: element.semanticRef,
      });
      const compatible = compatibleOverlay(
        oldEntry.overlay,
        element,
        catalog,
        diagnostics,
      );
      if (compatible) {
        delete compatible.routing;
        if (compatible.appearance || compatible.extensions) {
          overlay[oldElement.elementId] = compatible;
        }
      }
      continue;
    }
    const sameKind = oldElement.structuralKind === element.structuralKind;
    const elementId = sameKind ? oldElement.elementId : element.elementId;
    if (!sameKind) {
      diagnostics.push({
        severity: "warning",
        code: "reconcile-primitive-changed",
        message: `${element.semanticRef}のprimitiveが${oldElement.structuralKind}から${element.structuralKind}へ変わりました。`,
        semanticRef: element.semanticRef,
      });
    }
    const compatible = compatibleOverlay(
      oldEntry?.overlay ?? { semanticRef: oldElement.semanticRef },
      element,
      catalog,
      diagnostics,
    );
    if (
      compatible
      && sameKind
      && oldElement.structuralKind !== "edge"
      && element.structuralKind !== "edge"
    ) {
      compatible.geometry = clone(oldElement.geometry);
      compatible.pinned = oldElement.pinned;
      compatible.placement = oldElement.placement;
    }
    if (compatible) overlay[elementId] = compatible;
  }

  for (const oldOverlay of previousOverlay.values()) {
    if (nextSemanticRefs.has(oldOverlay.overlay.semanticRef)) continue;
    diagnostics.push({
      severity: "info",
      code: "reconcile-stale-overlay-removed",
      message: `消滅したelementのoverlayを除去しました: ${oldOverlay.overlay.semanticRef}`,
      semanticRef: oldOverlay.overlay.semanticRef,
    });
  }
  return { overlay, diagnostics };
}

function sameEdgeEndpoints(
  previous: SceneEdge,
  next: ProjectedEdge,
  previousSemanticByElementId: ReadonlyMap<string, string>,
  nextSemanticByElementId: ReadonlyMap<string, string>,
): boolean {
  return previousSemanticByElementId.get(previous.sourceElementId)
      === nextSemanticByElementId.get(next.sourceElementId)
    && previousSemanticByElementId.get(previous.targetElementId)
      === nextSemanticByElementId.get(next.targetElementId);
}

function compatibleOverlay(
  previous: ViewElementOverlay,
  next: ProjectedElement,
  catalog: ProjectionCatalogV1,
  diagnostics: ProjectionDiagnostic[],
): ViewElementOverlay | undefined {
  const appearance = compatibleAppearance(previous, next, catalog, diagnostics);
  if (next.structuralKind === "edge") {
    const routing = normalizeRouting(previous.routing);
    if (!appearance && !routing && !previous.extensions) return undefined;
    return {
      semanticRef: next.semanticRef,
      appearance,
      routing,
      extensions: clone(previous.extensions),
    };
  }
  return {
    semanticRef: next.semanticRef,
    geometry: clone(previous.geometry),
    pinned: previous.pinned,
    placement: previous.placement,
    appearance,
    extensions: clone(previous.extensions),
  };
}

function compatibleAppearance(
  previous: ViewElementOverlay,
  next: ProjectedElement,
  catalog: ProjectionCatalogV1,
  diagnostics: ProjectionDiagnostic[],
): ViewElementOverlay["appearance"] | undefined {
  const appearance = previous.appearance;
  if (!appearance) return undefined;
  const result = clone(appearance);
  const isGroupFrame = (next.structuralKind === "container" || next.structuralKind === "region")
    && Boolean(next.groupFrame);
  if (result.templateRef) {
    const template = catalog.templates[result.templateRef];
    if (!template || template.structuralKind !== next.structuralKind) {
      diagnostics.push({
        severity: "warning",
        code: "reconcile-appearance-dropped",
        message: `${next.semanticRef}と互換性のないtemplate overrideを除去しました。`,
        semanticRef: next.semanticRef,
      });
      delete result.templateRef;
    }
  }
  if (result.iconRef && next.structuralKind !== "node" && !isGroupFrame) {
    diagnostics.push({
      severity: "warning",
      code: "reconcile-appearance-dropped",
      message: `${next.semanticRef}と互換性のないicon overrideを除去しました。`,
      semanticRef: next.semanticRef,
    });
    delete result.iconRef;
  }
  if (next.structuralKind !== "node" && (
    result.nodeLabelOffset
    || result.nodeLabelWritingDirection
    || result.nodeIconOffset
    || result.nodeIconScale !== undefined
    || result.nodeIconSize
    || result.nodeIconFit
  )) {
    diagnostics.push({
      severity: "warning",
      code: "reconcile-appearance-dropped",
      message: `${next.semanticRef}と互換性のないnode内配置overrideを除去しました。`,
      semanticRef: next.semanticRef,
    });
    delete result.nodeLabelOffset;
    delete result.nodeLabelWritingDirection;
    delete result.nodeIconOffset;
    delete result.nodeIconScale;
    delete result.nodeIconSize;
    delete result.nodeIconFit;
  }
  if (next.structuralKind === "node" && (
    (result.nodeIconScale !== undefined && (
      !Number.isFinite(result.nodeIconScale)
      || result.nodeIconScale < 0.1
      || result.nodeIconScale > 8
    ))
    || (result.nodeIconScale !== undefined && result.nodeIconSize !== undefined)
    || (result.nodeIconSize !== undefined && (
      !Number.isFinite(result.nodeIconSize.width)
      || !Number.isFinite(result.nodeIconSize.height)
      || result.nodeIconSize.width < 4
      || result.nodeIconSize.height < 4
      || result.nodeIconSize.width > 4096
      || result.nodeIconSize.height > 4096
    ))
  )) {
    diagnostics.push({
      severity: "warning",
      code: "reconcile-appearance-dropped",
      message: `${next.semanticRef}の安全でないicon presentationを除去しました。`,
      semanticRef: next.semanticRef,
    });
    delete result.nodeIconScale;
    delete result.nodeIconSize;
    delete result.nodeIconFit;
  }
  if (next.structuralKind !== "container" && next.structuralKind !== "region" && (
    result.groupLabelAnchor !== undefined
    || result.groupLabelOffset !== undefined
    || result.groupLabelWritingDirection
    || result.groupIconOffset
    || result.groupIconScale !== undefined
    || result.groupZOrder !== undefined
  )) {
    diagnostics.push({
      severity: "warning",
      code: "reconcile-appearance-dropped",
      message: `${next.semanticRef}と互換性のないgroup frame appearanceを除去しました。`,
      semanticRef: next.semanticRef,
    });
    delete result.groupLabelAnchor;
    delete result.groupLabelOffset;
    delete result.groupLabelWritingDirection;
    delete result.groupIconOffset;
    delete result.groupIconScale;
    delete result.groupZOrder;
  }
  if (!isGroupFrame && (result.groupIconOffset || result.groupIconScale !== undefined)) {
    diagnostics.push({
      severity: "warning",
      code: "reconcile-appearance-dropped",
      message: `${next.semanticRef}と互換性のないgroup icon presentationを除去しました。`,
      semanticRef: next.semanticRef,
    });
    delete result.groupIconOffset;
    delete result.groupIconScale;
  }
  if (isGroupFrame && (
    (result.groupLabelOffset !== undefined && (
      !Number.isFinite(result.groupLabelOffset)
      || result.groupLabelOffset < -1
      || result.groupLabelOffset > 1
    ))
    || (result.groupIconScale !== undefined && (
      !Number.isFinite(result.groupIconScale)
      || result.groupIconScale < 0.1
      || result.groupIconScale > 8
    ))
    || (result.groupIconOffset !== undefined && (
      !Number.isFinite(result.groupIconOffset.x)
      || !Number.isFinite(result.groupIconOffset.y)
    ))
  )) {
    diagnostics.push({
      severity: "warning",
      code: "reconcile-appearance-dropped",
      message: `${next.semanticRef}の安全でないgroup frame presentationを除去しました。`,
      semanticRef: next.semanticRef,
    });
    delete result.groupLabelOffset;
    delete result.groupIconOffset;
    delete result.groupIconScale;
  }
  if (!result.styleRef && result.styleToken && catalog.styles?.[result.styleToken]) {
    result.styleRef = result.styleToken;
    delete result.styleToken;
    diagnostics.push({
      severity: "info",
      code: "reconcile-style-token-migrated",
      message: `${next.semanticRef}のlegacy styleTokenをstyleRefへ移行しました。`,
      semanticRef: next.semanticRef,
    });
  }
  if (result.styleRef && !catalog.styles?.[result.styleRef]) {
    diagnostics.push({
      severity: "warning",
      code: "reconcile-appearance-dropped",
      message: `${next.semanticRef}の未解決styleRefを除去しました。`,
      semanticRef: next.semanticRef,
    });
    delete result.styleRef;
  }
  if (result.style && !isSafeVisualStyleOverride(result.style)) {
    diagnostics.push({
      severity: "warning",
      code: "reconcile-appearance-dropped",
      message: `${next.semanticRef}の安全でないstyle overrideを除去しました。`,
      semanticRef: next.semanticRef,
    });
    delete result.style;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function persistLayoutGeometry(
  view: DiagramView,
  scene: DiagramScene,
): Record<string, ViewElementOverlay> {
  const bySemantic = new Map(
    Object.entries(view.overlay).map(([elementId, overlay]) => [
      overlay.semanticRef,
      { elementId, overlay },
    ]),
  );
  const overlay: Record<string, ViewElementOverlay> = {};
  for (const element of [
    ...scene.containers,
    ...(scene.regions ?? []),
    ...scene.nodes,
    ...semanticSceneAnnotations(scene),
  ]) {
    const previous = bySemantic.get(element.semanticRef);
    const elementId = previous?.elementId ?? element.elementId;
    overlay[elementId] = {
      ...clone(previous?.overlay ?? { semanticRef: element.semanticRef }),
      semanticRef: element.semanticRef,
      geometry: clone(element.geometry),
      pinned: previous?.overlay.pinned ?? false,
      placement: previous?.overlay.placement ?? "generated",
    };
  }
  for (const edge of scene.edges) {
    const previous = bySemantic.get(edge.semanticRef);
    if (!previous) continue;
    const entry = clone(previous.overlay);
    delete entry.geometry;
    delete entry.pinned;
    delete entry.placement;
    entry.routing = normalizeRouting(entry.routing);
    if (!entry.routing && !entry.appearance && !entry.extensions) continue;
    overlay[previous.elementId] = entry;
  }
  return overlay;
}

function semanticProjectedAnnotations(
  scene: { annotations?: ProjectedAnnotation[] },
): SemanticProjectedAnnotation[] {
  return (scene.annotations ?? []).filter((annotation): annotation is SemanticProjectedAnnotation => (
    annotation.annotationKind === "semantic-literal" && annotation.semanticRef !== undefined
  ));
}

function semanticSceneAnnotations(
  scene: { annotations?: SceneAnnotation[] },
): SemanticSceneAnnotation[] {
  return (scene.annotations ?? []).filter((annotation): annotation is SemanticSceneAnnotation => (
    annotation.annotationKind === "semantic-literal" && annotation.semanticRef !== undefined
  ));
}

function normalizeRouting(
  routing: ViewElementOverlay["routing"],
): ViewElementOverlay["routing"] | undefined {
  if (!routing) return undefined;
  const result = clone(routing);
  if (result.waypoints?.length === 0) delete result.waypoints;
  if (result.curve?.knots?.length === 0) delete result.curve.knots;
  if (result.curve && Object.keys(result.curve).length === 0) delete result.curve;
  if (result.sourceAnchor && !isValidEdgeEndpointAnchor(result.sourceAnchor)) {
    delete result.sourceAnchor;
  }
  if (result.targetAnchor && !isValidEdgeEndpointAnchor(result.targetAnchor)) {
    delete result.targetAnchor;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function rejected(
  previous: IriographDocument,
  diagnostics: readonly ProjectionDiagnostic[],
): DisplayReconciliationResult {
  return {
    accepted: false,
    document: clone(previous),
    scenes: {},
    diagnostics: uniqueSortedDiagnostics(diagnostics),
  };
}

/**
 * Route-only reconciliation cannot change region/container geometry. Report
 * layout diagnostics for the rerouted edge set (and untargeted/global
 * failures), but do not attribute unrelated pre-existing placement warnings to
 * an endpoint edit.
 */
function relevantSceneDiagnostics(
  diagnostics: readonly ProjectionDiagnostic[],
  edgeOnly: boolean,
  routePlan: EdgeOnlyRoutePlan | undefined,
): ProjectionDiagnostic[] {
  if (!edgeOnly || !routePlan) return uniqueSortedDiagnostics(diagnostics);
  return uniqueSortedDiagnostics(diagnostics.filter((diagnostic) => (
    diagnostic.category !== "layout"
    || diagnostic.severity === "error"
    || diagnostic.semanticRef === undefined
    || routePlan.affectedEdgeIds.has(diagnostic.semanticRef)
  )));
}

function uniqueSortedDiagnostics(
  diagnostics: readonly ProjectionDiagnostic[],
): ProjectionDiagnostic[] {
  const seen = new Set<string>();
  return sortDiagnostics(diagnostics.filter((diagnostic) => {
    const key = JSON.stringify(diagnostic);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }));
}

function clone<T>(value: T): T {
  if (value === undefined) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}

function compareIdentity(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
