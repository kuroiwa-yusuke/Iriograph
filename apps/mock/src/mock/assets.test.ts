import { describe, expect, it, vi } from "vitest";

import { resolveDiagramSceneAssets, type DiagramScene } from "@iriograph/core";

import {
  createMockAssetHost,
  workspaceAssetPickResult,
} from "./assets";
import type { MockWorkspaceManifest } from "./workspace";

const ASSET_REF = "urn:mock:workspace:asset:icon";

describe("MockWorkspaceAssetResolver", () => {
  it("catalog外workspace assetをfetchしてcache共有するBlob URL leaseへ解決する", async () => {
    const fetchAsset = vi.fn(async () => new Response(
      new Blob(["<svg/>"] , { type: "image/svg+xml" }),
      { status: 200, headers: { "content-type": "image/svg+xml" } },
    ));
    const create = vi.fn(() => "blob:https://mock.example/icon");
    const revoke = vi.fn();
    const host = createMockAssetHost(workspace(), {
      baseUrl: "https://mock.example/editor",
      fetchAsset,
      objectUrls: { create, revoke },
    });

    const first = await host.access.resolver.resolve({
      assetRef: ASSET_REF,
      definition: undefined,
      revision: host.access.revision,
      signal: new AbortController().signal,
    });
    const second = await host.access.resolver.resolve({
      assetRef: ASSET_REF,
      definition: undefined,
      revision: host.access.revision,
      signal: new AbortController().signal,
    });

    expect(first.status).toBe("resolved");
    expect(second.status).toBe("resolved");
    expect(fetchAsset).toHaveBeenCalledTimes(1);
    expect(fetchAsset).toHaveBeenCalledWith(
      "https://mock.example/workspace/assets/icon.svg",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(create).toHaveBeenCalledTimes(1);
    if (first.status === "resolved") first.lease.release();
    expect(revoke).not.toHaveBeenCalled();
    if (second.status === "resolved") second.lease.release();
    expect(revoke).toHaveBeenCalledTimes(1);
    host.dispose();
    expect(revoke).toHaveBeenCalledTimes(1);
  });

  it("workspace asset 404をdeleted、未知refをnot-foundにする", async () => {
    const fetchAsset = vi.fn(async () => new Response(null, { status: 404 }));
    const host = createMockAssetHost(workspace(), {
      baseUrl: "https://mock.example/editor",
      fetchAsset,
      objectUrls: { create: vi.fn(), revoke: vi.fn() },
    });

    await expect(host.access.resolver.resolve(request(ASSET_REF, host.access.revision)))
      .resolves.toMatchObject({ status: "unresolved", reason: "deleted" });
    await expect(host.access.resolver.resolve(request("urn:mock:missing", host.access.revision)))
      .resolves.toMatchObject({ status: "unresolved", reason: "not-found" });
    await expect(host.access.resolver.resolve({
      ...request("urn:mock:catalog-only", host.access.revision),
      definition: {
        assetRef: "urn:mock:catalog-only",
        mediaType: "image/svg+xml",
        url: "https://untrusted.example/icon.svg",
      },
    })).resolves.toMatchObject({ status: "unresolved", reason: "not-found" });
    expect(fetchAsset).toHaveBeenCalledTimes(1);
  });

  it("実media typeとbyte lengthをCore policyで検証する", async () => {
    const host = createMockAssetHost(workspace(), {
      baseUrl: "https://mock.example/editor",
      fetchAsset: async () => new Response(
        new Blob([new Uint8Array(12)], { type: "image/webp" }),
        { status: 200 },
      ),
      objectUrls: {
        create: () => "blob:https://mock.example/icon",
        revoke: vi.fn(),
      },
    });
    const access = {
      ...host.access,
      policy: { ...host.access.policy, allowedMediaTypes: ["image/svg+xml" as const] },
    };

    const batch = await resolveDiagramSceneAssets(
      scene(),
      {},
      access,
      new AbortController().signal,
    );

    expect(batch.diagnostics).toContainEqual(expect.objectContaining({
      code: "asset-media-type-disallowed",
      assetRef: ASSET_REF,
    }));
    expect(batch.scene.nodes[0]?.iconUrl).toBeUndefined();
  });

  it.each([
    "https://cross-origin.example/icon.svg",
    "urn:mock:source:icon",
    "data:image/svg+xml,<svg/>",
  ])("workspace source %sをfetch前にhost policyで拒否する", async (url) => {
    const manifest = workspace();
    manifest.entries[0]!.url = url;
    const fetchAsset = vi.fn();
    const host = createMockAssetHost(manifest, {
      baseUrl: "https://mock.example/editor",
      fetchAsset,
      objectUrls: { create: vi.fn(), revoke: vi.fn() },
    });

    await expect(host.access.resolver.resolve(request(ASSET_REF, host.access.revision)))
      .resolves.toMatchObject({ status: "unresolved", reason: "unavailable" });
    expect(fetchAsset).not.toHaveBeenCalled();
  });

  it("host pickerは許可mediaのworkspace assetRefだけを返す", () => {
    const entry = workspace().entries[0]!;
    expect(workspaceAssetPickResult(entry, ["image/svg+xml"]))
      .toEqual({ status: "selected", assetRef: ASSET_REF });
    expect(workspaceAssetPickResult(entry, ["image/png"])).toBeUndefined();
  });

  it("dispose中に完了したfetchからBlob URLやcacheを生成しない", async () => {
    let finishFetch!: (response: Response) => void;
    const fetchAsset = vi.fn(() => new Promise<Response>((resolve) => {
      finishFetch = resolve;
    }));
    const create = vi.fn(() => "blob:https://mock.example/late");
    const revoke = vi.fn();
    const host = createMockAssetHost(workspace(), {
      baseUrl: "https://mock.example/editor",
      fetchAsset,
      objectUrls: { create, revoke },
    });

    const pending = host.access.resolver.resolve(request(ASSET_REF, host.access.revision));
    host.dispose();
    finishFetch(new Response(new Blob(["<svg/>"] , { type: "image/svg+xml" }), {
      status: 200,
    }));

    await expect(pending).resolves.toMatchObject({
      status: "unresolved",
      reason: "unavailable",
    });
    expect(create).not.toHaveBeenCalled();
    expect(revoke).not.toHaveBeenCalled();
  });
});

function workspace(): MockWorkspaceManifest {
  return {
    workspaceId: "mock",
    name: "Mock",
    defaultDocumentPath: "models/example.iriograph",
    entries: [{
      kind: "asset",
      path: "assets/icon.svg",
      mediaType: "image/svg+xml",
      assetRef: ASSET_REF,
      url: "/workspace/assets/icon.svg",
    }],
  };
}

function request(assetRef: string, revision: string) {
  return {
    assetRef,
    revision,
    signal: new AbortController().signal,
  };
}

function scene(): DiagramScene {
  return {
    viewId: "main",
    width: 100,
    height: 100,
    diagnostics: [],
    containers: [],
    edges: [],
    nodes: [{
      elementId: "node",
      semanticRef: "urn:mock:node",
      structuralKind: "node",
      label: "Node",
      templateRef: "urn:mock:template",
      shape: "rectangle",
      iconRef: ASSET_REF,
      geometry: { x: 0, y: 0, width: 80, height: 40 },
      style: { fill: "white", stroke: "black", text: "black" },
      pinned: false,
      placement: "generated",
    }],
  };
}
