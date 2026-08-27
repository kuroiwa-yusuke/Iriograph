import { describe, expect, it, vi } from "vitest";

import {
  resolveDiagramSceneAssets,
  type AssetAccess,
  type AssetLease,
  type AssetPolicy,
  type AssetResolveResult,
} from "./assets";
import { applySemanticSource } from "./document";
import { createStandardLayoutRegistry } from "./layout";
import type {
  AssetDefinition,
  DiagramScene,
  IriographDocumentV1,
  ProjectionCatalogV1,
} from "./model";
import { projectSemanticView } from "./projection";
import type { ProjectionRuntimeContext } from "./scene";
import { standardRdfRdfsCatalog } from "./standard-catalog";

const ICON_REF = "urn:test:asset:outside-catalog";
const POLICY: AssetPolicy = {
  allowedMediaTypes: ["image/svg+xml", "image/png"],
  maxBytes: 1024,
  allowedSchemes: ["https:"],
  allowedOrigins: ["https://assets.example"],
};

describe("resolveDiagramSceneAssets", () => {
  it("Group Frame iconをnodeと同じasset policy・natural aspect契約で解決する", async () => {
    const input = sceneWithIcons(ICON_REF);
    input.containers = [{
      elementId: "group:1",
      semanticRef: "urn:test:group:1",
      structuralKind: "container",
      groupRole: "sequence",
      groupFrame: {
        kind: "sequence",
        semanticRef: "urn:test:group:1",
        provenance: { operator: "ordinal-sequence", derivation: "resource", sourceStatementRefs: [] },
      },
      label: "手順",
      templateRef: "urn:test:template:group",
      iconRef: ICON_REF,
      groupIconScale: 1.5,
      geometry: { x: 0, y: 0, width: 240, height: 160 },
      headerPosition: "top",
      style: { fill: "white", stroke: "black", text: "black", labelFontSize: 21 },
      pinned: false,
      placement: "generated",
    }];
    const resolve = vi.fn(async (): Promise<AssetResolveResult> => resolvedLease(() => {}));

    const batch = await resolveDiagramSceneAssets(
      input,
      {},
      { resolver: { resolve }, policy: POLICY, revision: "group-1" },
      new AbortController().signal,
    );

    expect(resolve).toHaveBeenCalledTimes(1);
    expect(batch.scene.containers[0]).toMatchObject({
      iconUrl: "https://assets.example/icon.svg",
      iconIntrinsicSize: { width: 24, height: 12, aspectRatio: 2, source: "decoded" },
      groupIconScale: 1.5,
    });
    expect(input.containers[0]?.iconUrl).toBeUndefined();
    batch.release();
  });

  it("catalog外assetをunique refごとに解決し、入力Sceneを変更しない", async () => {
    const input = sceneWithIcons(ICON_REF, ICON_REF);
    const before = structuredClone(input);
    const release = vi.fn();
    const resolve = vi.fn(async (request): Promise<AssetResolveResult> => {
      expect(request.definition).toBeUndefined();
      return resolvedLease(release);
    });

    const batch = await resolveDiagramSceneAssets(
      input,
      {},
      { resolver: { resolve }, policy: POLICY, revision: "workspace-1" },
      new AbortController().signal,
    );

    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledWith(expect.objectContaining({
      assetRef: ICON_REF,
      revision: "workspace-1",
    }));
    expect(input).toEqual(before);
    expect(batch.scene.nodes.map((node) => node.iconUrl)).toEqual([
      "https://assets.example/icon.svg",
      "https://assets.example/icon.svg",
    ]);
    expect(batch.scene.nodes[0]?.iconIntrinsicSize).toEqual({
      width: 24,
      height: 12,
      aspectRatio: 2,
      source: "decoded",
    });
    expect(batch.diagnostics).toEqual([]);
    batch.release();
    batch.release();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("catalog definitionをhintとして渡し、実media type不一致を拒否してleaseを解放する", async () => {
    const definition: AssetDefinition = {
      assetRef: ICON_REF,
      mediaType: "image/png",
      url: "urn:test:source:icon",
    };
    const release = vi.fn();
    const resolve = vi.fn(async (request): Promise<AssetResolveResult> => {
      expect(request.definition).toEqual(definition);
      return resolvedLease(release);
    });

    const batch = await resolveDiagramSceneAssets(
      sceneWithIcons(ICON_REF),
      { [ICON_REF]: definition },
      { resolver: { resolve }, policy: POLICY, revision: "1" },
      new AbortController().signal,
    );

    expect(batch.scene.nodes[0]?.iconUrl).toBeUndefined();
    expect(batch.diagnostics).toContainEqual(expect.objectContaining({
      severity: "warning",
      code: "asset-media-type-mismatch",
      assetRef: ICON_REF,
    }));
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("host policyが許可したJPEG workspace iconを解決する", async () => {
    const release = vi.fn();
    const batch = await resolveDiagramSceneAssets(
      sceneWithIcons(ICON_REF),
      {},
      {
        resolver: {
          async resolve() {
            return resolvedLease(release, {
              url: "https://assets.example/icon.jpg",
              mediaType: "image/jpeg",
            });
          },
        },
        policy: {
          ...POLICY,
          allowedMediaTypes: [...POLICY.allowedMediaTypes, "image/jpeg"],
        },
        revision: "jpeg-1",
      },
      new AbortController().signal,
    );

    expect(batch.scene.nodes[0]?.iconUrl).toBe("https://assets.example/icon.jpg");
    expect(batch.diagnostics).toEqual([]);
    batch.release();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("SVG viewBox fallbackを検証し巨大・非finite・decode失敗をfail-closedにする", async () => {
    const svg = await resolveDiagramSceneAssets(
      sceneWithIcons(ICON_REF),
      {},
      {
        resolver: { resolve: async () => resolvedLease(() => {}, {
          intrinsicSize: undefined,
          svgViewBox: "0 0 48 24",
        }) },
        policy: POLICY,
        revision: "svg-viewbox",
      },
      new AbortController().signal,
    );
    expect(svg.scene.nodes[0]?.iconIntrinsicSize).toEqual({
      width: 48,
      height: 24,
      aspectRatio: 2,
      source: "svg-view-box",
    });

    for (const intrinsicSize of [
      { width: 100_001, height: 10, aspectRatio: 10_000.1 },
      { width: Number.POSITIVE_INFINITY, height: 10, aspectRatio: 1 },
      { width: 24, height: 12, aspectRatio: 3 },
    ]) {
      const failed = await resolveDiagramSceneAssets(
        sceneWithIcons(ICON_REF),
        {},
        {
          resolver: { resolve: async () => resolvedLease(() => {}, { intrinsicSize }) },
          policy: POLICY,
          revision: "invalid-intrinsic",
        },
        new AbortController().signal,
      );
      expect(failed.scene.nodes[0]?.iconUrl).toBe("https://assets.example/icon.svg");
      expect(failed.scene.nodes[0]?.iconIntrinsicSize).toBeUndefined();
      expect(failed.diagnostics).toContainEqual(expect.objectContaining({
        code: "asset-intrinsic-size-invalid",
      }));
      failed.release();
    }

    const decodeFailure = await resolveDiagramSceneAssets(
      sceneWithIcons(ICON_REF),
      {},
      {
        resolver: { resolve: async () => ({ status: "unresolved", reason: "decode-failed" }) },
        policy: POLICY,
        revision: "decode-failed",
      },
      new AbortController().signal,
    );
    expect(decodeFailure.scene.nodes[0]?.iconUrl).toBeUndefined();
    expect(decodeFailure.diagnostics).toContainEqual(expect.objectContaining({
      code: "asset-decode-failed",
    }));
  });

  it("decoded pixel area上限で100000² raster leaseを採用せず解放する", async () => {
    const release = vi.fn();
    const batch = await resolveDiagramSceneAssets(
      sceneWithIcons(ICON_REF),
      {},
      {
        resolver: {
          resolve: async () => resolvedLease(release, {
            mediaType: "image/png",
            url: "https://assets.example/huge.png",
            intrinsicSize: { width: 100_000, height: 100_000, aspectRatio: 1 },
          }),
        },
        policy: POLICY,
        revision: "huge-raster",
      },
      new AbortController().signal,
    );

    expect(batch.scene.nodes[0]?.iconUrl).toBeUndefined();
    expect(batch.scene.nodes[0]?.iconIntrinsicSize).toBeUndefined();
    expect(batch.diagnostics).toContainEqual(expect.objectContaining({
      code: "asset-decoded-pixel-limit-exceeded",
      assetRef: ICON_REF,
    }));
    expect(release).toHaveBeenCalledTimes(1);
    batch.release();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("SVG viewBoxはvector unitsとしてdecoded raster pixel上限を適用しない", async () => {
    const batch = await resolveDiagramSceneAssets(
      sceneWithIcons(ICON_REF),
      {},
      {
        resolver: {
          resolve: async () => resolvedLease(() => {}, {
            intrinsicSize: undefined,
            svgViewBox: "0 0 100000 100000",
          }),
        },
        policy: { ...POLICY, maxDecodedPixels: 1 },
        revision: "large-vector-viewbox",
      },
      new AbortController().signal,
    );

    expect(batch.scene.nodes[0]?.iconUrl).toBe("https://assets.example/icon.svg");
    expect(batch.scene.nodes[0]?.iconIntrinsicSize).toEqual({
      width: 100_000,
      height: 100_000,
      aspectRatio: 1,
      source: "svg-view-box",
    });
    expect(batch.diagnostics).toEqual([]);
    batch.release();
  });

  it("many asset resolutionをpolicy同時数以内に制限し全leaseを一度だけ解放する", async () => {
    const refs = Array.from({ length: 15 }, (_, index) => `urn:test:asset:many:${index}`);
    const releases = refs.map(() => vi.fn());
    let active = 0;
    let maximumActive = 0;
    const batch = await resolveDiagramSceneAssets(
      sceneWithIcons(...refs),
      {},
      {
        resolver: {
          async resolve(request) {
            const index = refs.indexOf(request.assetRef);
            active += 1;
            maximumActive = Math.max(maximumActive, active);
            await new Promise((resolve) => setTimeout(resolve, 1));
            active -= 1;
            return resolvedLease(releases[index]!);
          },
        },
        policy: { ...POLICY, maxConcurrentResolutions: 3 },
        revision: "many-assets",
      },
      new AbortController().signal,
    );

    expect(maximumActive).toBe(3);
    expect(batch.scene.nodes.every((node) => node.iconUrl !== undefined)).toBe(true);
    batch.release();
    batch.release();
    expect(releases.every((release) => release.mock.calls.length === 1)).toBe(true);
  });

  it("resolution concurrency省略時もCore既定値でboundedにする", async () => {
    const refs = Array.from({ length: 10 }, (_, index) => `urn:test:asset:default-limit:${index}`);
    let active = 0;
    let maximumActive = 0;
    const batch = await resolveDiagramSceneAssets(
      sceneWithIcons(...refs),
      {},
      {
        resolver: {
          async resolve() {
            active += 1;
            maximumActive = Math.max(maximumActive, active);
            await new Promise((resolve) => setTimeout(resolve, 1));
            active -= 1;
            return resolvedLease(() => {});
          },
        },
        policy: POLICY,
        revision: "default-concurrency",
      },
      new AbortController().signal,
    );

    expect(maximumActive).toBe(4);
    batch.release();
  });

  it("bounded batch中のabortで採用前leaseをすべて解放し待機assetを開始しない", async () => {
    const refs = Array.from({ length: 8 }, (_, index) => `urn:test:asset:abort:${index}`);
    const releases: Array<ReturnType<typeof vi.fn>> = [];
    const controller = new AbortController();
    let calls = 0;
    const batch = await resolveDiagramSceneAssets(
      sceneWithIcons(...refs),
      {},
      {
        resolver: {
          async resolve() {
            calls += 1;
            const release = vi.fn();
            releases.push(release);
            if (calls === 3) controller.abort();
            await Promise.resolve();
            return resolvedLease(release);
          },
        },
        policy: { ...POLICY, maxConcurrentResolutions: 2 },
        revision: "abort-batch",
      },
      controller.signal,
    );

    expect(calls).toBe(3);
    expect(batch.scene.nodes.every((node) => node.iconUrl === undefined)).toBe(true);
    expect(batch.diagnostics.some((item) => item.code === "asset-resolution-aborted")).toBe(true);
    expect(releases.every((release) => release.mock.calls.length === 1)).toBe(true);
    batch.release();
    expect(releases.every((release) => release.mock.calls.length === 1)).toBe(true);
  });

  it.each([
    ["asset-media-type-disallowed", { mediaType: "image/webp" as const }],
    ["asset-byte-limit-exceeded", { byteLength: 1025 }],
    ["asset-url-invalid", { url: "/relative/icon.svg" }],
    ["asset-url-scheme-disallowed", { url: "http://assets.example/icon.svg" }],
    ["asset-url-origin-disallowed", { url: "https://other.example/icon.svg" }],
  ])("policy違反を%s warningにしてURLをrendererへ渡さない", async (code, override) => {
    const release = vi.fn();
    const access: AssetAccess = {
      resolver: {
        async resolve() {
          return resolvedLease(release, override);
        },
      },
      policy: POLICY,
      revision: "1",
    };

    const batch = await resolveDiagramSceneAssets(
      sceneWithIcons(ICON_REF),
      {},
      access,
      new AbortController().signal,
    );

    expect(batch.scene.nodes[0]?.iconUrl).toBeUndefined();
    expect(batch.diagnostics).toContainEqual(expect.objectContaining({ code }));
    expect(release).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["not-found", "asset-unresolved"],
    ["moved", "asset-moved"],
    ["deleted", "asset-deleted"],
    ["unavailable", "asset-unavailable"],
  ] as const)("%s resultを%s warningへ変換する", async (reason, code) => {
    const batch = await resolveDiagramSceneAssets(
      sceneWithIcons(ICON_REF),
      {},
      {
        resolver: {
          async resolve() {
            return {
              status: "unresolved",
              reason,
              replacementAssetRef: reason === "moved" ? "urn:test:asset:new" : undefined,
            };
          },
        },
        policy: POLICY,
        revision: "1",
      },
      new AbortController().signal,
    );

    expect(batch.diagnostics).toContainEqual(expect.objectContaining({ code, assetRef: ICON_REF }));
    expect(batch.scene.nodes[0]?.iconUrl).toBeUndefined();
  });

  it("resolver throwとabortをwarningにし、abort後に届いたleaseを解放する", async () => {
    const thrown = await resolveDiagramSceneAssets(
      sceneWithIcons(ICON_REF),
      {},
      {
        resolver: { async resolve() { throw new Error("offline"); } },
        policy: POLICY,
        revision: "1",
      },
      new AbortController().signal,
    );
    expect(thrown.diagnostics).toContainEqual(expect.objectContaining({ code: "asset-resolver-failed" }));

    const controller = new AbortController();
    const release = vi.fn();
    const aborted = await resolveDiagramSceneAssets(
      sceneWithIcons(ICON_REF),
      {},
      {
        resolver: {
          async resolve() {
            controller.abort();
            return resolvedLease(release);
          },
        },
        policy: POLICY,
        revision: "1",
      },
      controller.signal,
    );
    expect(aborted.diagnostics).toContainEqual(expect.objectContaining({ code: "asset-resolution-aborted" }));
    expect(release).toHaveBeenCalledTimes(1);
  });

  it.each([
    undefined,
    {},
    { status: "unknown" },
    { status: "unresolved", reason: "renamed" },
    { status: "resolved" },
  ])("runtime-invalid resolver result %#をasset-result-invalidにする", async (invalid) => {
    const batch = await resolveDiagramSceneAssets(
      sceneWithIcons(ICON_REF),
      {},
      {
        resolver: {
          async resolve() {
            return invalid as never;
          },
        },
        policy: POLICY,
        revision: "1",
      },
      new AbortController().signal,
    );

    expect(batch.diagnostics).toContainEqual(expect.objectContaining({
      code: "asset-result-invalid",
      assetRef: ICON_REF,
    }));
    expect(batch.scene.nodes[0]?.iconUrl).toBeUndefined();
  });
});

describe("asset projection boundary", () => {
  it("normalized projectionはcatalog URLを直接iconUrlへ流さない", () => {
    const catalog = catalogWithIcon();
    const projected = projectSemanticView(documentFor(singleView()), catalog);

    expect(projected.nodes[0]).toMatchObject({ iconRef: ICON_REF });
    expect(projected.nodes[0]?.iconUrl).toBeUndefined();
  });

  it("asset resolverなしでも全view semantic reconciliationをacceptedにする", async () => {
    const catalog = catalogWithIcon();
    const previous = documentFor(twoViews());
    const context: ProjectionRuntimeContext = {
      catalogsByProfile: new Map([[catalog.profileRef, { catalog }]]),
      layouts: createStandardLayoutRegistry(),
    };
    const nextSource = `${previous.semantic.source}\n<urn:test:asset-boundary:b> <http://www.w3.org/2000/01/rdf-schema#label> "B" .`;

    const result = await applySemanticSource(previous, nextSource, context);

    expect(result.accepted).toBe(true);
    expect(result.document.views).toHaveLength(2);
    expect(result.diagnostics.some((item) => item.code.startsWith("asset-"))).toBe(false);
  });
});

function resolvedLease(
  release: () => void,
  override: Partial<AssetLease> = {},
): AssetResolveResult {
  return {
    status: "resolved",
    lease: {
      url: "https://assets.example/icon.svg",
      mediaType: "image/svg+xml",
      byteLength: 128,
      intrinsicSize: { width: 24, height: 12, aspectRatio: 2 },
      release,
      ...override,
    },
  };
}

function sceneWithIcons(...iconRefs: string[]): DiagramScene {
  return {
    viewId: "main",
    width: 500,
    height: 300,
    diagnostics: [],
    containers: [],
    edges: [],
    nodes: iconRefs.map((iconRef, index) => ({
      elementId: `node:${index}`,
      semanticRef: `urn:test:node:${index}`,
      structuralKind: "node",
      label: `Node ${index}`,
      templateRef: "urn:test:template:node",
      shape: "rectangle",
      iconRef,
      geometry: { x: index * 100, y: 0, width: 80, height: 40 },
      style: { fill: "white", stroke: "black", text: "black" },
      pinned: false,
      placement: "generated",
    })),
  };
}

function catalogWithIcon(): ProjectionCatalogV1 {
  const nodeTemplateRef = standardRdfRdfsCatalog.defaults!.nodeTemplateRef;
  return {
    ...standardRdfRdfsCatalog,
    templates: {
      ...standardRdfRdfsCatalog.templates,
      [nodeTemplateRef]: {
        ...standardRdfRdfsCatalog.templates[nodeTemplateRef]!,
        iconRef: ICON_REF,
      },
    },
    assets: {
      [ICON_REF]: {
        assetRef: ICON_REF,
        mediaType: "image/svg+xml",
        url: "https://catalog.example/unsafe-direct.svg",
      },
    },
  };
}

function documentFor(views: IriographDocumentV1["views"]): IriographDocumentV1 {
  return {
    schemaVersion: "1",
    kind: "iriograph.document",
    documentId: "asset-boundary",
    semantic: {
      format: "text/turtle",
      baseIri: "urn:test:asset-boundary:",
      authoringProfileRef: "urn:test:authoring:1",
      source: '<urn:test:asset-boundary:a> <http://www.w3.org/2000/01/rdf-schema#label> "A" .',
    },
    views,
  };
}

function singleView(): IriographDocumentV1["views"] {
  return [{
    viewId: "main",
    kind: "node-link",
    profileRef: standardRdfRdfsCatalog.profileRef,
    layoutRef: standardRdfRdfsCatalog.defaults!.layoutRef,
    overlay: {},
  }];
}

function twoViews(): IriographDocumentV1["views"] {
  return [
    ...singleView(),
    {
      ...singleView()[0]!,
      viewId: "alternate",
    },
  ];
}
