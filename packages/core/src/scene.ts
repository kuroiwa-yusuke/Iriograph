import type {
  MergedProjectionCatalog,
  ProjectionRuleOrigin,
} from "./catalog-resolution.js";
import { hasBlockingDiagnostics, sortDiagnostics } from "./diagnostics.js";
import {
  layoutProjectedScene,
  type LayoutAdapterRegistry,
  type LayoutDiagnostic,
  type LayoutDerivedRouteChoice,
  type LayoutExternalReservation,
  type LayoutMode,
} from "./layout.js";
import { containerContentInsets } from "./container-content.js";
import { measureNodeContent, measureTextContent, resolveIconContentMetrics } from "./content-metrics.js";
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
  ProjectedAnnotation,
  SceneAnnotation,
  SceneContainer,
  SceneEdge,
  SceneRegion,
  SceneNode,
  SceneSemanticText,
  VisualStyle,
} from "./model.js";
import { projectSemanticView } from "./projection.js";
import { compareCodePoints } from "./rdf.js";
import {
  forgetIncrementalScene,
  rememberIncrementalScene,
  rememberIncrementalSceneIfAbsent,
} from "./scene-cache.js";

export type ResolvedProfileProjection = {
  catalog: ProjectionCatalogV1;
  ruleOrigins?: readonly ProjectionRuleOrigin[];
  /** Exact immutable catalog sources used to build this resolved profile. */
  sourceCatalogRefs?: readonly string[];
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
      {
        catalog: entry.catalog,
        ruleOrigins: entry.ruleOrigins,
        ...(entry.sourceCatalogRefs
          ? { sourceCatalogRefs: [...entry.sourceCatalogRefs] }
          : {}),
      },
    ])),
    layouts,
    projectionOptions,
  };
}

/**
 * Retains a successful pre-asset Scene as the incremental reconciliation
 * baseline for this exact document/view/runtime binding. This controlled hook
 * is intended for presentation-only reconciliation paths which do not call
 * `buildIriographView`. Blocking or mismatched Scenes are rejected and cannot
 * leave a stale baseline behind.
 */
export function retainIncrementalReconciliationScene(
  document: IriographDocument,
  viewId: string,
  context: ProjectionRuntimeContext,
  scene: DiagramScene,
): boolean {
  const view = document.views.find((candidate) => candidate.viewId === viewId);
  if (
    !view
    || scene.viewId !== viewId
    || !context.catalogsByProfile.has(view.profileRef)
    || hasBlockingDiagnostics(scene.diagnostics)
  ) {
    forgetIncrementalScene(document, viewId, context);
    return false;
  }
  rememberIncrementalScene(document, viewId, context, scene);
  return true;
}

/** Resolves a view's profile and layout, returning a renderer-ready Scene. */
export async function buildIriographView(
  document: IriographDocument,
  viewId: string,
  context: ProjectionRuntimeContext,
  mode: LayoutMode = "incremental",
  fixedDerivedRoutes?: Readonly<Record<string, readonly Point[]>>,
  fixedDerivedRouteChoices?: Readonly<Record<string, LayoutDerivedRouteChoice>>,
  newlyConstrainedElementIds?: readonly string[],
  preservedElementIds?: readonly string[],
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
  const catalogImportDiagnostic = resolvedCatalogImportDiagnostic(document, context);
  if (catalogImportDiagnostic) return emptyScene(viewId, [catalogImportDiagnostic]);
  const projected = remapProjectedRuleOrigins(
    projectSemanticView(
      document,
      profile.catalog,
      viewId,
      context.projectionOptions,
    ),
    profile.ruleOrigins,
  );
  const scene = await layoutProjectedDiagramScene(
    projected,
    view.layoutRef,
    context.layouts,
    mode,
    fixedDerivedRoutes,
    fixedDerivedRouteChoices,
    newlyConstrainedElementIds,
    preservedElementIds,
  );
  if (
    mode === "incremental"
    && !fixedDerivedRoutes
    && !fixedDerivedRouteChoices
    && !hasBlockingDiagnostics(scene.diagnostics)
  ) {
    rememberIncrementalSceneIfAbsent(document, viewId, context, scene);
  }
  return scene;
}

/**
 * A declared catalog import is part of the portable rendering contract. When
 * source refs are available, require the document-wide set used by all named
 * views to match exactly instead of silently projecting through a host's
 * different catalog for the same profileRef. Import-less legacy documents
 * retain the historical profile-only behavior.
 */
function resolvedCatalogImportDiagnostic(
  document: IriographDocument,
  context: ProjectionRuntimeContext,
): ProjectionDiagnostic | undefined {
  if (!document.imports?.length) return undefined;
  const declared = [...new Set(document.imports.map((entry) => entry.catalogRef))]
    .sort(compareCodePoints);
  const resolved = new Set<string>();
  for (const profileRef of new Set(document.views.map((view) => view.profileRef))) {
    const sourceRefs = context.catalogsByProfile.get(profileRef)?.sourceCatalogRefs;
    if (!sourceRefs) return undefined;
    for (const sourceRef of sourceRefs) resolved.add(sourceRef);
  }
  const actual = [...resolved].sort(compareCodePoints);
  if (declared.length === actual.length && declared.every((value, index) => value === actual[index])) {
    return undefined;
  }
  const missing = declared.filter((value) => !resolved.has(value));
  const undeclared = actual.filter((value) => !declared.includes(value));
  return {
    severity: "error",
    category: "profile",
    code: "catalog-import-context-mismatch",
    message: [
      "Documentが指定した表示catalogとhostが解決したcatalogが一致しません。",
      missing.length > 0 ? `未解決: ${missing.join(", ")}` : undefined,
      undeclared.length > 0 ? `未宣言: ${undeclared.join(", ")}` : undefined,
      "同じversionのpackageとcatalogを利用してください。",
    ].filter((value): value is string => value !== undefined).join(" "),
  };
}

/** Converts semantic projection into a renderer Scene with endpoint-inclusive routes. */
export async function layoutProjectedDiagramScene(
  projected: ProjectedScene,
  layoutRef: string,
  registry: LayoutAdapterRegistry,
  mode: LayoutMode = "incremental",
  fixedDerivedRoutes?: Readonly<Record<string, readonly Point[]>>,
  fixedDerivedRouteChoices?: Readonly<Record<string, LayoutDerivedRouteChoice>>,
  newlyConstrainedElementIds?: readonly string[],
  preservedElementIds?: readonly string[],
): Promise<DiagramScene> {
  if (hasBlockingDiagnostics(projected.diagnostics)) {
    return emptyScene(projected.viewId, projected.diagnostics);
  }
  const layout = await layoutProjectedScene({
    layoutRef,
    mode,
    fixedDerivedRoutes,
    fixedDerivedRouteChoices,
    newlyConstrainedElementIds,
    preservedElementIds,
    scene: {
      elements: [
        ...projected.containers,
        ...(projected.regions ?? []),
        ...projected.nodes,
        ...(projected.annotations ?? []),
      ].map((element) => ({
        elementId: element.elementId,
        structuralKind: element.structuralKind,
        groupRole: element.structuralKind === "container"
          ? element.groupFrame?.kind ?? element.groupRole
          : element.structuralKind === "region" ? element.groupFrame?.kind : undefined,
        parentElementId: element.structuralKind === "node" || element.structuralKind === "container"
          ? element.parentElementId
          : undefined,
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
          : element.structuralKind === "region"
            ? "region"
            : element.structuralKind === "annotation" ? "rectangle" : element.shape,
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
    groupLabelOffset: container.groupLabelOffset,
    groupLabelWritingDirection: container.groupLabelWritingDirection,
    groupIconOffset: container.groupIconOffset ? { ...container.groupIconOffset } : undefined,
    groupIconScale: container.groupIconScale,
    groupZOrder: container.groupZOrder,
    templateRef: container.templateRef,
    iconRef: container.iconRef,
    iconUrl: container.iconUrl,
    iconIntrinsicSize: container.iconIntrinsicSize ? { ...container.iconIntrinsicSize } : undefined,
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
    groupLabelOffset: region.groupLabelOffset,
    groupLabelWritingDirection: region.groupLabelWritingDirection,
    groupIconOffset: region.groupIconOffset ? { ...region.groupIconOffset } : undefined,
    groupIconScale: region.groupIconScale,
    groupZOrder: region.groupZOrder,
    regionLabelAnchor: region.regionLabelAnchor,
    regionLabelWritingDirection: region.regionLabelWritingDirection,
    regionZOrder: region.regionZOrder,
    templateRef: region.templateRef,
    iconRef: region.iconRef,
    iconUrl: region.iconUrl,
    iconIntrinsicSize: region.iconIntrinsicSize ? { ...region.iconIntrinsicSize } : undefined,
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
      ...(edge.sourcePortId ? { sourcePortId: edge.sourcePortId } : {}),
      ...(edge.targetPortId ? { targetPortId: edge.targetPortId } : {}),
      routeMode: edge.routeMode,
      sourceMarker: edge.sourceMarker,
      targetMarker: edge.targetMarker,
      fallback: edge.fallback,
      provenance: edge.provenance,
    };
  });
  const annotations: SceneAnnotation[] = (projected.annotations ?? []).map((annotation) => ({
    ...annotation,
    geometry: layout.geometries[annotation.elementId]!,
    anchorOffset: annotation.anchorOffset ? { ...annotation.anchorOffset } : undefined,
    style: structuredClone(annotation.style),
    provenance: structuredClone(annotation.provenance),
  }));
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
    annotations,
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
    | NonNullable<ProjectedScene["regions"]>[number]
    | ProjectedAnnotation,
): { width: number; height: number } {
  if (element.structuralKind === "annotation") {
    const text = measureTextContent(element.text, {
      style: element.style,
      maxWidth: 320,
    });
    return { width: text.width + 24, height: text.height + 20 };
  }
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
  const icon = element.iconRef
    ? resolveIconContentMetrics(element.iconIntrinsicSize, { scale: element.groupIconScale })
    : undefined;
  return {
    width: text.width + (icon ? icon.width + 8 : 0) + 32,
    height: Math.max(text.height, icon?.height ?? 0) + 24,
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
          ...(frame.scopeClosure
            ? { scopeClosure: {
                ...frame.scopeClosure,
                provenance: remap(frame.scopeClosure.provenance)!,
              } }
            : {}),
          ...(frame.scopeTruncation
            ? { scopeTruncation: {
                ...frame.scopeTruncation,
                provenance: remap(frame.scopeTruncation.provenance)!,
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
    annotations: (projected.annotations ?? []).map((annotation) => ({
      ...annotation,
      provenance: "kind" in annotation.provenance
        ? annotation.provenance
        : remap(annotation.provenance)!,
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
    groupGuides: [],
    annotations: [],
    edges: [],
    diagnostics: sortDiagnostics(diagnostics),
  };
}
