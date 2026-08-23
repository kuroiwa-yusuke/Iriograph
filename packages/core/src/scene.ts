import type {
  MergedProjectionCatalog,
  ProjectionRuleOrigin,
} from "./catalog-resolution";
import { hasBlockingDiagnostics, sortDiagnostics } from "./diagnostics";
import {
  layoutProjectedScene,
  type LayoutAdapterRegistry,
  type LayoutDiagnostic,
  type LayoutMode,
} from "./layout";
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
  SceneNode,
} from "./model";
import { projectSemanticView } from "./projection";

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
      elements: [...projected.containers, ...projected.nodes].map((element) => ({
        elementId: element.elementId,
        structuralKind: element.structuralKind,
        parentElementId: element.parentElementId,
        geometry: element.geometry,
        size: element.defaultSize,
        pinned: element.pinned,
        placement: element.placement,
      })),
      edges: projected.edges.map((edge) => ({
        elementId: edge.elementId,
        sourceElementId: edge.sourceElementId,
        targetElementId: edge.targetElementId,
        waypoints: edge.waypoints,
        routingPlacement: edge.routingPlacement,
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
      sourceElementId: edge.sourceElementId,
      targetElementId: edge.targetElementId,
      templateRef: edge.templateRef,
      style: edge.style,
      route: route?.map((point) => ({ ...point })),
      waypoints,
      labelOffset: edge.labelOffset ? { ...edge.labelOffset } : undefined,
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
    edges,
    diagnostics,
  };
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
    edges: [],
    diagnostics: sortDiagnostics(diagnostics),
  };
}
