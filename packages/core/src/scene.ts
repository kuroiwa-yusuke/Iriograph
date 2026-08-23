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
import type {
  DiagramScene,
  IriographDocument,
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
  );
}

/** Converts semantic projection into a renderer Scene with endpoint-inclusive routes. */
export async function layoutProjectedDiagramScene(
  projected: ProjectedScene,
  layoutRef: string,
  registry: LayoutAdapterRegistry,
  mode: LayoutMode = "incremental",
): Promise<DiagramScene> {
  if (hasBlockingDiagnostics(projected.diagnostics)) {
    return emptyScene(projected.viewId, projected.diagnostics);
  }
  const layout = await layoutProjectedScene({
    layoutRef,
    mode,
    scene: {
      elements: [...projected.containers, ...(projected.regions ?? []), ...projected.nodes].map((element) => ({
        elementId: element.elementId,
        structuralKind: element.structuralKind,
        parentElementId: element.structuralKind === "region" ? undefined : element.parentElementId,
        geometry: element.geometry,
        size: element.defaultSize,
        pinned: element.pinned,
        placement: element.placement,
        shape: element.structuralKind === "container"
          ? "container"
          : element.structuralKind === "region" ? "region" : element.shape,
        contentInsets: element.structuralKind === "container"
          ? containerContentInsets(element.headerPosition)
          : undefined,
        externalReservations: element.structuralKind === "node"
          ? commentCalloutReservations(element.semanticText)
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
    templateRef: node.templateRef,
    shape: node.shape,
    iconRef: node.iconRef,
    iconUrl: node.iconUrl,
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
    label: container.label,
    semanticText: container.semanticText,
    labelPlacement: container.labelPlacement,
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
      semanticText: edge.semanticText,
      labelProvenance: edge.labelProvenance,
      sourceElementId: edge.sourceElementId,
      targetElementId: edge.targetElementId,
      templateRef: edge.templateRef,
      style: edge.style,
      route: route?.map((point) => ({ ...point })),
      waypoints,
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
    edges,
    diagnostics,
  };
}

const COMMENT_CALLOUT_MIN_WIDTH = 140;
const COMMENT_CALLOUT_MAX_WIDTH = 280;
const COMMENT_CALLOUT_HORIZONTAL_CHROME = 22;
const COMMENT_CALLOUT_VERTICAL_CHROME = 18;
const COMMENT_CALLOUT_CHARACTER_WIDTH = 9;
const COMMENT_CALLOUT_LINE_HEIGHT = 13.5;
const COMMENT_CALLOUT_GAP = 10;

/** Mirrors the Editor's bottom-centered, pre-wrapped comment callout box. */
function commentCalloutReservations(
  semanticText: SceneSemanticText | undefined,
): LayoutExternalReservation[] | undefined {
  const comments = semanticText?.comments ?? [];
  if (comments.length === 0) return undefined;
  const text = comments.map((comment) => (
    comment.language
      ? `${comment.value.normalize("NFC")} (${comment.language.toLowerCase()})`
      : comment.value.normalize("NFC")
  )).join("\n\n");
  const lines = text.split("\n");
  const longestLine = Math.max(1, ...lines.map((line) => Array.from(line).length));
  const width = Math.max(
    COMMENT_CALLOUT_MIN_WIDTH,
    Math.min(
      COMMENT_CALLOUT_MAX_WIDTH,
      longestLine * COMMENT_CALLOUT_CHARACTER_WIDTH + COMMENT_CALLOUT_HORIZONTAL_CHROME,
    ),
  );
  const charactersPerLine = Math.max(
    1,
    Math.floor(
      (width - COMMENT_CALLOUT_HORIZONTAL_CHROME) / COMMENT_CALLOUT_CHARACTER_WIDTH,
    ),
  );
  const visualLines = lines.reduce((count, line) => (
    count + Math.max(1, Math.ceil(Array.from(line).length / charactersPerLine))
  ), 0);
  return [{
    placement: "bottom-center",
    width,
    height: Math.ceil(
      COMMENT_CALLOUT_VERTICAL_CHROME + visualLines * COMMENT_CALLOUT_LINE_HEIGHT,
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
        }
      : provenance;
  };
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
    })),
    regions: (projected.regions ?? []).map((region) => ({
      ...region,
      provenance: remap(region.provenance)!,
    })),
    memberships: (projected.memberships ?? []).map((membership) => ({
      ...membership,
      provenance: remap(membership.provenance)!,
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
