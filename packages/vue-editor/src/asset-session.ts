import {
  resolveDiagramSceneAssets,
  type AssetAccess,
  type AssetDefinition,
  type AssetMediaType,
  type DiagramScene,
  type SceneAssetBatch,
} from "@iriograph/core";

export type AssetPickRequest = {
  currentAssetRef?: string;
  semanticRef: string;
  allowedMediaTypes: readonly AssetMediaType[];
  signal: AbortSignal;
};

export type AssetPickResult =
  | { status: "selected"; assetRef: string }
  | { status: "cancelled" };

export type AssetPicker = (request: AssetPickRequest) => Promise<AssetPickResult>;

export type AssetSceneRequest = {
  readonly generation: number;
  readonly signal: AbortSignal;
};

export type AssetSceneResult =
  | { accepted: true; scene: DiagramScene }
  | { accepted: false };

/** Owns only the currently displayed Scene's URL leases. */
export class AssetSceneSession {
  private generation = 0;
  private pending?: AbortController;
  private current?: SceneAssetBatch;
  private disposed = false;

  begin(): AssetSceneRequest {
    if (this.disposed) throw new Error("AssetSceneSession is disposed");
    this.pending?.abort();
    const controller = new AbortController();
    this.pending = controller;
    return {
      generation: ++this.generation,
      signal: controller.signal,
    };
  }

  async enrich(
    request: AssetSceneRequest,
    scene: DiagramScene,
    definitions: Readonly<Record<string, AssetDefinition>>,
    access: AssetAccess,
  ): Promise<AssetSceneResult> {
    const batch = await resolveDiagramSceneAssets(
      scene,
      definitions,
      access,
      request.signal,
    );
    if (!this.isCurrent(request)) {
      batch.release();
      return { accepted: false };
    }
    this.pending = undefined;
    const previous = this.current;
    this.current = batch;
    previous?.release();
    return { accepted: true, scene: batch.scene };
  }

  commitWithoutAssets(
    request: AssetSceneRequest,
    scene: DiagramScene,
  ): AssetSceneResult {
    if (!this.isCurrent(request)) return { accepted: false };
    this.pending = undefined;
    this.current?.release();
    this.current = undefined;
    return { accepted: true, scene };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.generation += 1;
    this.pending?.abort();
    this.pending = undefined;
    this.current?.release();
    this.current = undefined;
  }

  private isCurrent(request: AssetSceneRequest): boolean {
    return !this.disposed && request.generation === this.generation;
  }
}

/** Picker results cross a host boundary and are validated before document mutation. */
export function normalizePickedAssetRef(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (!normalized || normalized !== value) return undefined;
  try {
    const parsed = new URL(normalized);
    return parsed.protocol ? normalized : undefined;
  } catch {
    return undefined;
  }
}
