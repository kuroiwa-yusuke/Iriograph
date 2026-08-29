import type { LayoutAdapterRegistry } from "./layout.js";
import type {
  DiagramScene,
  IriographDocument,
  ProjectionOptions,
} from "./model.js";
import { compareCodePoints } from "./rdf.js";
import type { ProjectionRuntimeContext } from "./scene.js";

type CachedIncrementalScene = {
  contextBinding: string;
  catalogsByProfile: ProjectionRuntimeContext["catalogsByProfile"];
  layouts: LayoutAdapterRegistry;
  projectionOptions: ProjectionOptions | undefined;
  resolveAssetUrl: ProjectionOptions["resolveAssetUrl"] | undefined;
  scene: DiagramScene;
};

// Reconciliation is commonly invoked immediately after a host has rendered
// the same immutable document. Keep only a few pre-asset incremental Scenes
// per runtime so an edge-only semantic edit does not repeat the entire prior
// route pass just to recover routes that are about to be fixed. The WeakMap
// keeps the cache owned by the runtime rather than by documents or hosts.
const incrementalSceneCache = new WeakMap<ProjectionRuntimeContext, Map<string, CachedIncrementalScene>>();
const MAX_INCREMENTAL_SCENES_PER_RUNTIME = 8;

/** Internal reconciliation optimization; not part of the package API. */
export function cachedIncrementalIriographView(
  document: IriographDocument,
  viewId: string,
  context: ProjectionRuntimeContext,
): DiagramScene | undefined {
  const binding = documentSceneBinding(document, viewId);
  const cached = incrementalSceneCache.get(context)?.get(binding);
  if (!cached || !cachedSceneMatchesRuntime(cached, context)) return undefined;
  return structuredClone(cached.scene);
}

/** Internal build-path hook; stores only successful pre-asset Scenes. */
export function rememberIncrementalScene(
  document: IriographDocument,
  viewId: string,
  context: ProjectionRuntimeContext,
  scene: DiagramScene,
): void {
  const binding = documentSceneBinding(document, viewId);
  const cache = incrementalSceneCache.get(context) ?? new Map<string, CachedIncrementalScene>();
  incrementalSceneCache.set(context, cache);
  // Reinsertion gives recently rendered documents a deterministic LRU-like
  // preference without retaining an unbounded document history.
  cache.delete(binding);
  cache.set(binding, {
    contextBinding: runtimeSceneBinding(context),
    catalogsByProfile: context.catalogsByProfile,
    layouts: context.layouts,
    projectionOptions: context.projectionOptions,
    resolveAssetUrl: context.projectionOptions?.resolveAssetUrl,
    scene: structuredClone(scene),
  });
  while (cache.size > MAX_INCREMENTAL_SCENES_PER_RUNTIME) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/** Internal build-path hook; never replaces a retained rendered baseline. */
export function rememberIncrementalSceneIfAbsent(
  document: IriographDocument,
  viewId: string,
  context: ProjectionRuntimeContext,
  scene: DiagramScene,
): void {
  const binding = documentSceneBinding(document, viewId);
  const existing = incrementalSceneCache.get(context)?.get(binding);
  if (existing && cachedSceneMatchesRuntime(existing, context)) return;
  rememberIncrementalScene(document, viewId, context, scene);
}

/** Removes an exact document/view binding after a caller rejects its Scene. */
export function forgetIncrementalScene(
  document: IriographDocument,
  viewId: string,
  context: ProjectionRuntimeContext,
): void {
  incrementalSceneCache.get(context)?.delete(documentSceneBinding(document, viewId));
}

function documentSceneBinding(document: IriographDocument, viewId: string): string {
  // Iriograph documents are serializable persistence values. A value binding
  // lets reconciliation reuse a Scene after its caller defensively cloned the
  // document, while distinguishing all overlay, semantic and view changes.
  return `${viewId}\u0000${JSON.stringify(document)}`;
}

function runtimeSceneBinding(context: ProjectionRuntimeContext): string {
  return JSON.stringify({
    catalogs: [...context.catalogsByProfile.entries()]
      .map(([profileRef, resolved]) => ({
        profileRef,
        catalogId: resolved.catalog.catalogId,
        catalogVersion: resolved.catalog.catalogVersion,
        sourceCatalogRefs: resolved.sourceCatalogRefs,
      }))
      .sort((left, right) => compareCodePoints(left.profileRef, right.profileRef)),
    // The object identities below are verified separately by the WeakMap key.
    // This value binding catches a context whose catalog map contents changed
    // in place without trusting a stale Scene across an exact catalog revision.
    projectionOptions: context.projectionOptions ? "present" : "absent",
  });
}

function cachedSceneMatchesRuntime(
  cached: CachedIncrementalScene,
  context: ProjectionRuntimeContext,
): boolean {
  return cached.contextBinding === runtimeSceneBinding(context)
    && cached.catalogsByProfile === context.catalogsByProfile
    && cached.layouts === context.layouts
    && cached.projectionOptions === context.projectionOptions
    && cached.resolveAssetUrl === context.projectionOptions?.resolveAssetUrl;
}
