import { hasBlockingDiagnostics, sortDiagnostics } from "./diagnostics";
import { isValidEdgeEndpointAnchor } from "./endpoint-anchor";
import type {
  DiagramScene,
  DiagramView,
  IriographDocument,
  ProjectedContainer,
  ProjectedEdge,
  ProjectedNode,
  ProjectionCatalogV1,
  ProjectionDiagnostic,
  SceneContainer,
  SceneEdge,
  SceneNode,
  ViewElementOverlay,
} from "./model";
import { projectSemanticView } from "./projection";
import {
  buildIriographView,
  type ProjectionRuntimeContext,
} from "./scene";

type GeometryElement = ProjectedNode | ProjectedContainer;
type ProjectedElement = GeometryElement | ProjectedEdge;
type SceneElement = SceneNode | SceneContainer | SceneEdge;

export type DisplayReconciliationResult = {
  accepted: boolean;
  document: IriographDocument;
  scenes: Record<string, DiagramScene>;
  diagnostics: ProjectionDiagnostic[];
};

/** Reprojects and lays out every candidate view as one atomic operation. */
export async function reconcileIriographDocumentViews(
  previous: IriographDocument,
  candidate: IriographDocument,
  context: ProjectionRuntimeContext,
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
      previousScene = await buildIriographView(previous, view.viewId, context, "incremental");
      diagnostics.push(...previousScene.diagnostics);
      if (hasBlockingDiagnostics(previousScene.diagnostics)) return rejected(previous, diagnostics);
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
    view.overlay = reconciled.overlay;

    const scene = await buildIriographView(next, view.viewId, context, "incremental");
    diagnostics.push(...scene.diagnostics);
    if (hasBlockingDiagnostics(scene.diagnostics)) return rejected(previous, diagnostics);
    view.overlay = persistLayoutGeometry(view, scene);
    scenes[view.viewId] = scene;
  }

  return {
    accepted: true,
    document: next,
    scenes,
    diagnostics: sortDiagnostics(diagnostics),
  };
}

function reconcileViewOverlay(
  previousView: DiagramView | undefined,
  previousScene: DiagramScene | undefined,
  projected: {
    nodes: ProjectedNode[];
    containers: ProjectedContainer[];
    edges: ProjectedEdge[];
  },
  catalog: ProjectionCatalogV1,
): { overlay: Record<string, ViewElementOverlay>; diagnostics: ProjectionDiagnostic[] } {
  if (!previousView || !previousScene) return { overlay: {}, diagnostics: [] };
  const diagnostics: ProjectionDiagnostic[] = [];
  const previousElements = new Map<string, SceneElement>([
    ...previousScene.nodes,
    ...previousScene.containers,
    ...previousScene.edges,
  ].map((element) => [element.semanticRef, element]));
  const previousSemanticByElementId = new Map(
    [...previousElements.values()].map((element) => [element.elementId, element.semanticRef]),
  );
  const nextElements = [
    ...projected.containers,
    ...projected.nodes,
    ...projected.edges,
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
    if (!oldElement || !oldEntry) continue;
    if (
      oldElement.structuralKind === "edge"
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
      oldEntry.overlay,
      element,
      catalog,
      diagnostics,
    );
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
  if (result.iconRef && next.structuralKind !== "node") {
    diagnostics.push({
      severity: "warning",
      code: "reconcile-appearance-dropped",
      message: `${next.semanticRef}と互換性のないicon overrideを除去しました。`,
      semanticRef: next.semanticRef,
    });
    delete result.iconRef;
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
  for (const element of [...scene.containers, ...scene.nodes]) {
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

function normalizeRouting(
  routing: ViewElementOverlay["routing"],
): ViewElementOverlay["routing"] | undefined {
  if (!routing) return undefined;
  const result = clone(routing);
  if (result.waypoints?.length === 0) delete result.waypoints;
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
    diagnostics: sortDiagnostics(diagnostics),
  };
}

function clone<T>(value: T): T {
  if (value === undefined) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}
