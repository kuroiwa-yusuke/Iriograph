import type {
  MergedProjectionCatalog,
  ProjectionRuleOrigin,
} from "./catalog-resolution.js";
import { hasBlockingDiagnostics, sortDiagnostics } from "./diagnostics.js";
import {
  layoutProjectedScene,
  type LayoutAdapterRegistry,
  type LayoutDiagnostic,
  type LayoutExternalReservation,
  type LayoutMode,
} from "./layout.js";
import { containerContentInsets } from "./container-content.js";
import { measureNodeContent, measureTextContent } from "./content-metrics.js";
import type {
  DiagramScene,
  EdgeCurveRouting,
  GroupFrame,
  IriographDocument,
  Point,
  ProjectedScene,
  ProjectionCatalogV1,
  ProjectionDiagnostic,
  ProjectionOptions,
  ProjectionProvenance,
  SceneContainer,
  SceneEdge,
  SceneRegion,
  SceneNode,
  SceneSemanticText,
  VisualStyle,
} from "./model.js";
import { projectSemanticView } from "./projection.js";

export type ResolvedProfileProjection = {
  catalog: ProjectionCatalogV1;
  ruleOrigins?: readonly ProjectionRuleOrigin[];
};

export type ProjectionRuntimeContext = {
  catalogsByProfile: ReadonlyMap<string, ResolvedProfileProjection>;
  layouts: LayoutAdapterRegistry;
  projectionOptions?: ProjectionOptions;
};

export function createProjectionRuntimeContext(
  catalogs: readonly MergedProjectionCatalog[],
  layouts: LayoutAdapterRegistry,
  projectionOptions?: ProjectionOptions,
): ProjectionRuntimeContext {
  return {
    catalogsByProfile: new Map(catalogs.map((entry) => [
      entry.profileRef,
      { catalog: entry.catalog, ruleOrigins: entry.ruleOrigins },
    ])),
    layouts,
    projectionOptions,
  };
}

/** Resolves a view's profile and layout, returning a renderer-ready Scene. */
export async function buildIriographView(
  document: IriographDocument,
  viewId: string,
  context: ProjectionRuntimeContext,
  mode: LayoutMode = "incremental",
  fixedDerivedRoutes?: Readonly<Record<string, readonly Point[]>>,
): Promise<DiagramScene> {
  const view = document.views.find((candidate) => candidate.viewId === viewId);
  if (!view) {
    return emptyScene(viewId, [{
      severity: "error",
      category: "projection",
      code: "view-unresolved",
      message: `viewが存在しません: ${viewId}`,
    }]);
  }
  const profile = context.catalogsByProfile.get(view.profileRef);
  if (!profile) {
    return emptyScene(viewId, [{
      severity: "error",
      category: "profile",
      code: "profile-catalog-unresolved",
      message: `profileの解決済みcatalogがありません: ${view.profileRef}`,
      semanticRef: viewId,
    }]);
  }
  const projected = remapProjectedRuleOrigins(
    projectSemanticView(
      document,
      profile.catalog,
      viewId,
      context.projectionOptions,
    ),
    profile.ruleOrigins,
  );
  return layoutProjectedDiagramScene(
    projected,
    view.layoutRef,
    context.layouts,
    mode,
    fixedDerivedRoutes,
  );
}

/** Converts semantic projection into a renderer Scene with endpoint-inclusive routes. */
export async function layoutProjectedDiagramScene(
  projected: ProjectedScene,
  layoutRef: string,
  registry: LayoutAdapterRegistry,
  mode: LayoutMode = "incremental",
  fixedDerivedRoutes?: Readonly<Record<string, readonly Point[]>>,
): Promise<DiagramScene> {
  if (hasBlockingDiagnostics(projected.diagnostics)) {
    return emptyScene(projected.viewId, projected.diagnostics);
  }
  const layout = await layoutProjectedScene({
    layoutRef,
    mode,
    fixedDerivedRoutes,
    scene: {
      elements: [...projected.containers, ...(projected.regions ?? []), ...projected.nodes].map((element) => ({
        elementId: element.elementId,
        structuralKind: element.structuralKind,
        groupRole: element.structuralKind === "node"
          ? undefined
          : element.groupFrame?.kind
            ?? (element.structuralKind === "container" ? element.groupRole : undefined),
        parentElementId: element.structuralKind === "region" ? undefined : element.parentElementId,
        geometry: element.geometry,
        size: element.defaultSize,
        minimumContentSize: minimumContentSize(element),
        // route-only is a transaction-local constraint. The returned Scene
        // retains the projected pin/placement values below; only the adapter
        // request treats every existing geometry as fixed.
        pinned: mode === "route-only" ? true : element.pinned,
        placement: mode === "route-only" ? "user" : element.placement,
        shape: element.structuralKind === "container"
          ? "container"
          : element.structuralKind === "region" ? "region" : element.shape,
        contentInsets: element.structuralKind === "container"
          ? containerContentInsets(element.headerPosition)
          : undefined,
        externalReservations: element.structuralKind === "node"
          ? commentCalloutReservations(element.semanticText, element.style)
          : undefined,
      })),
      edges: projected.edges.map((edge) => ({
        elementId: edge.elementId,
        sourceElementId: edge.sourceElementId,
        targetElementId: edge.targetElementId,
        waypoints: edge.waypoints,
        sourceAnchor: edge.sourceAnchor,
        targetAnchor: edge.targetAnchor,
        routingPlacement: edge.routingPlacement,
        routeMode: edge.routeMode,
      })),
      memberships: (projected.memberships ?? []).map((membership) => ({
        semanticRef: membership.semanticRef,
        containerElementId: membership.containerElementId,
        memberElementId: membership.memberElementId,
        regionElementId: membership.regionElementId,
        role: membership.role,
        ordinal: membership.ordinal,
      })),
    },
  }, registry);
  const diagnostics = sortDiagnostics([
    ...projected.diagnostics,
    ...layout.diagnostics.map(layoutDiagnostic),
  ]);
  if (hasBlockingDiagnostics(diagnostics)) {
    return emptyScene(projected.viewId, diagnostics);
  }

  const nodes: SceneNode[] = projected.nodes.map((node) => ({
    elementId: node.elementId,
    semanticRef: node.semanticRef,
    structuralKind: "node",
    label: node.label,
    semanticText: node.semanticText,
    labelPlacement: node.labelPlacement,
    nodeLabelOffset: node.nodeLabelOffset,
    nodeLabelWritingDirection: node.nodeLabelWritingDirection,
    nodeIconOffset: node.nodeIconOffset,
    nodeIconScale: node.nodeIconScale,
    nodeIconSize: node.nodeIconSize ? { ...node.nodeIconSize } : undefined,
    nodeIconFit: node.nodeIconFit,
    templateRef: node.templateRef,
    shape: node.shape,
    iconRef: node.iconRef,
    iconUrl: node.iconUrl,
    iconIntrinsicSize: node.iconIntrinsicSize ? { ...node.iconIntrinsicSize } : undefined,
    geometry: layout.geometries[node.elementId]!,
    parentElementId: node.parentElementId,
    parentProvenance: node.parentProvenance,
    style: node.style,
    pinned: node.pinned,
    placement: node.placement,
    provenance: node.provenance,
  }));
  const containers: SceneContainer[] = projected.containers.map((container) => ({
    elementId: container.elementId,
    semanticRef: container.semanticRef,
    structuralKind: "container",
    groupRole: container.groupRole,
    groupFrame: container.groupFrame ? structuredClone(container.groupFrame) : undefined,
    label: container.label,
    semanticText: container.semanticText,
    labelPlacement: container.labelPlacement,
    groupLabelAnchor: container.groupLabelAnchor,
    groupLabelWritingDirection: container.groupLabelWritingDirection,
    groupZOrder: container.groupZOrder,
    templateRef: container.templateRef,
    geometry: layout.geometries[container.elementId]!,
    headerPosition: container.headerPosition,
    style: container.style,
    pinned: container.pinned,
    placement: container.placement,
    parentElementId: container.parentElementId,
    parentProvenance: container.parentProvenance,
    provenance: container.provenance,
  }));
  const regions: SceneRegion[] = (projected.regions ?? []).map((region) => ({
    elementId: region.elementId,
    semanticRef: region.semanticRef,
    structuralKind: "region",
    label: region.label,
    semanticText: region.semanticText,
    labelPlacement: region.labelPlacement,
    groupFrame: region.groupFrame ? structuredClone(region.groupFrame) : undefined,
    groupLabelAnchor: region.groupLabelAnchor,
    groupLabelWritingDirection: region.groupLabelWritingDirection,
    groupZOrder: region.groupZOrder,
    regionLabelAnchor: region.regionLabelAnchor,
    regionLabelWritingDirection: region.regionLabelWritingDirection,
    regionZOrder: region.regionZOrder,
    templateRef: region.templateRef,
    geometry: layout.geometries[region.elementId]!,
    style: region.style,
    pinned: region.pinned,
    placement: region.placement,
    provenance: region.provenance,
  }));
  const edges: SceneEdge[] = projected.edges.map((edge) => {
    const route = layout.routes[edge.elementId];
    const waypoints = edge.routingPlacement === "user" && edge.waypoints?.length
      ? edge.waypoints.map((point) => ({ ...point }))
      : undefined;
    return {
      elementId: edge.elementId,
      semanticRef: edge.semanticRef,
      structuralKind: "edge",
      label: edge.label,
      caption: edge.caption,
      semanticText: edge.semanticText,
      statementComments: edge.statementComments,
      labelProvenance: edge.labelProvenance,
      sourceElementId: edge.sourceElementId,
      targetElementId: edge.targetElementId,
      templateRef: edge.templateRef,
      style: edge.style,
      route: route?.map((point) => ({ ...point })),
      derivedRouteChoice: layout.derivedRouteChoices?.[edge.elementId]
        ? structuredClone(layout.derivedRouteChoices[edge.elementId])
        : undefined,
      waypoints,
      curve: edge.curve ? cloneCurveRouting(edge.curve) : undefined,
      labelOffset: edge.labelOffset ? { ...edge.labelOffset } : undefined,
      sourceAnchor: edge.sourceAnchor ? { ...edge.sourceAnchor } : undefined,
      targetAnchor: edge.targetAnchor ? { ...edge.targetAnchor } : undefined,
      routeMode: edge.routeMode,
      sourceMarker: edge.sourceMarker,
      targetMarker: edge.targetMarker,
      fallback: edge.fallback,
      provenance: edge.provenance,
    };
  });
  return {
    viewId: projected.viewId,
    width: layout.width,
    height: layout.height,
    nodes,
    containers,
    regions,
    memberships: (projected.memberships ?? []).map((membership) => ({
      ...membership,
      provenance: { ...membership.provenance },
    })),
    groupGuides: (projected.groupGuides ?? []).map((guide) => structuredClone(guide)),
    edges,
    diagnostics,
  };
}

function cloneCurveRouting(curve: EdgeCurveRouting): EdgeCurveRouting {
  return {
    sourceHandle: curve.sourceHandle ? cloneCurvePoint(curve.sourceHandle) : undefined,
    targetHandle: curve.targetHandle ? cloneCurvePoint(curve.targetHandle) : undefined,
    knots: curve.knots?.map((knot) => ({
      point: cloneCurvePoint(knot.point),
      incomingHandle: knot.incomingHandle ? cloneCurvePoint(knot.incomingHandle) : undefined,
      outgoingHandle: knot.outgoingHandle ? cloneCurvePoint(knot.outgoingHandle) : undefined,
      extensions: knot.extensions ? structuredClone(knot.extensions) : undefined,
    })),
    extensions: curve.extensions ? structuredClone(curve.extensions) : undefined,
  };
}

function cloneCurvePoint(point: Point): Point {
  return {
    x: point.x,
    y: point.y,
    extensions: point.extensions ? structuredClone(point.extensions) : undefined,
  };
}

const COMMENT_CALLOUT_MIN_WIDTH = 140;
const COMMENT_CALLOUT_MAX_WIDTH = 280;
const COMMENT_CALLOUT_HORIZONTAL_CHROME = 22;
const COMMENT_CALLOUT_VERTICAL_CHROME = 18;
const COMMENT_CALLOUT_GAP = 10;

function minimumContentSize(
  element: ProjectedScene["nodes"][number]
    | ProjectedScene["containers"][number]
    | NonNullable<ProjectedScene["regions"]>[number],
): { width: number; height: number } {
  if (element.structuralKind === "node") {
    return measureNodeContent({
      label: element.label,
      style: element.style,
      writingDirection: element.nodeLabelWritingDirection,
      maxTextWidth: 240,
      iconIntrinsicSize: element.iconIntrinsicSize,
      icon: element.iconRef ? {
        scale: element.nodeIconScale,
        size: element.nodeIconSize,
        fit: element.nodeIconFit,
      } : undefined,
    }).minimumSize;
  }
  const text = measureTextContent(element.label, {
    style: element.style,
    maxWidth: 320,
    writingDirection: element.groupLabelWritingDirection,
  });
  return {
    width: text.width + 32,
    height: text.height + 24,
  };
}

/** Mirrors the Editor's bottom-centered, pre-wrapped comment callout box. */
function commentCalloutReservations(
  semanticText: SceneSemanticText | undefined,
  style: Pick<VisualStyle, "labelFontSize">,
): LayoutExternalReservation[] | undefined {
  const comments = semanticText?.comments ?? [];
  if (comments.length === 0) return undefined;
  const text = comments.map((comment) => (
    comment.language
      ? `${comment.value.normalize("NFC")} (${comment.language.toLowerCase()})`
      : comment.value.normalize("NFC")
  )).join("\n\n");
  const metrics = measureTextContent(text, {
    style,
    maxWidth: COMMENT_CALLOUT_MAX_WIDTH - COMMENT_CALLOUT_HORIZONTAL_CHROME,
  });
  const width = Math.max(
    COMMENT_CALLOUT_MIN_WIDTH,
    Math.min(
      COMMENT_CALLOUT_MAX_WIDTH,
      metrics.width + COMMENT_CALLOUT_HORIZONTAL_CHROME,
    ),
  );
  return [{
    placement: "bottom-center",
    width,
    height: Math.ceil(
      COMMENT_CALLOUT_VERTICAL_CHROME + metrics.height,
    ),
    gap: COMMENT_CALLOUT_GAP,
  }];
}

export function remapProjectedRuleOrigins(
  projected: ProjectedScene,
  origins: readonly ProjectionRuleOrigin[] | undefined,
): ProjectedScene {
  if (!origins?.length) return projected;
  const byQualifiedId = new Map(origins.map((origin) => [origin.qualifiedRuleId, origin]));
  const remap = (provenance: ProjectionProvenance | undefined): ProjectionProvenance | undefined => {
    if (!provenance?.rule) return provenance;
    const origin = byQualifiedId.get(provenance.rule.ruleId);
    return origin
      ? {
          ...provenance,
          rule: { catalogRef: origin.catalogRef, ruleId: origin.localRuleId },
          resolutionTrace: provenance.resolutionTrace
            ? {
                ...provenance.resolutionTrace,
                candidates: provenance.resolutionTrace.candidates.map(remapTraceCandidate),
                selected: provenance.resolutionTrace.selected
                  ? remapTraceCandidate(provenance.resolutionTrace.selected)
                  : undefined,
                conflicts: provenance.resolutionTrace.conflicts?.map(remapTraceCandidate),
              }
            : undefined,
        }
      : provenance;
  };
  const remapTraceCandidate = (
    candidate: import("./model.js").ProjectionRuleCandidateTrace,
  ): import("./model.js").ProjectionRuleCandidateTrace => {
    const origin = byQualifiedId.get(candidate.ruleId);
    return origin
      ? { ...candidate, catalogRef: origin.catalogRef, ruleId: origin.localRuleId }
      : candidate;
  };
  const remapGroupFrame = (frame: GroupFrame | undefined): GroupFrame | undefined => (
    frame
      ? {
          ...frame,
          provenance: remap(frame.provenance)!,
          ...(frame.defaultMember
            ? { defaultMember: {
                ...frame.defaultMember,
                provenance: remap(frame.defaultMember.provenance)!,
              } }
            : {}),
        }
      : undefined
  );
  return {
    ...projected,
    nodes: projected.nodes.map((node) => ({
      ...node,
      provenance: remap(node.provenance)!,
      parentProvenance: remap(node.parentProvenance),
    })),
    containers: projected.containers.map((container) => ({
      ...container,
      provenance: remap(container.provenance)!,
      parentProvenance: remap(container.parentProvenance),
      groupFrame: remapGroupFrame(container.groupFrame),
    })),
    regions: (projected.regions ?? []).map((region) => ({
      ...region,
      provenance: remap(region.provenance)!,
      groupFrame: remapGroupFrame(region.groupFrame),
    })),
    memberships: (projected.memberships ?? []).map((membership) => ({
      ...membership,
      provenance: remap(membership.provenance)!,
    })),
    groupGuides: (projected.groupGuides ?? []).map((guide) => ({
      ...guide,
      provenance: remap(guide.provenance)!,
    })),
    edges: projected.edges.map((edge) => ({
      ...edge,
      provenance: remap(edge.provenance)!,
    })),
  };
}

function layoutDiagnostic(diagnostic: LayoutDiagnostic): ProjectionDiagnostic {
  return {
    severity: diagnostic.severity,
    category: "layout",
    code: diagnostic.code,
    message: diagnostic.message,
    semanticRef: diagnostic.elementId ?? diagnostic.edgeId,
  };
}

function emptyScene(
  viewId: string,
  diagnostics: readonly ProjectionDiagnostic[],
): DiagramScene {
  return {
    viewId,
    width: 0,
    height: 0,
    nodes: [],
    containers: [],
    regions: [],
    memberships: [],
    edges: [],
    diagnostics: sortDiagnostics(diagnostics),
  };
}
