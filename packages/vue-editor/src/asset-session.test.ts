import { describe, expect, it, vi } from "vitest";

import type {
  AssetAccess,
  AssetLease,
  AssetResolveResult,
  DiagramScene,
} from "@iriograph/core";

import {
  AssetSceneSession,
  normalizePickedAssetRef,
} from "./asset-session";

const POLICY: AssetAccess["policy"] = {
  allowedMediaTypes: ["image/svg+xml"],
  maxBytes: 1024,
  allowedSchemes: ["https:"],
  allowedOrigins: ["https://assets.example"],
};

describe("AssetSceneSession", () => {
  it("stale requestを採用せずleaseを解放し、current swapとdisposeも一度だけ解放する", async () => {
    const first = deferred<AssetResolveResult>();
    const releaseA = vi.fn();
    const releaseB = vi.fn();
    const releaseC = vi.fn();
    let call = 0;
    const access: AssetAccess = {
      policy: POLICY,
      revision: "1",
      resolver: {
        async resolve() {
          call += 1;
          if (call === 1) return first.promise;
          if (call === 2) return resolved(releaseB, "b.svg");
          return resolved(releaseC, "c.svg");
        },
      },
    };
    const session = new AssetSceneSession();
    const requestA = session.begin();
    const resultA = session.enrich(requestA, scene("urn:test:a"), {}, access);
    const requestB = session.begin();
    const resultB = await session.enrich(requestB, scene("urn:test:b"), {}, access);
    first.resolve(resolved(releaseA, "a.svg"));

    expect(await resultA).toEqual({ accepted: false });
    expect(resultB).toMatchObject({ accepted: true, scene: { nodes: [{ iconUrl: "https://assets.example/b.svg" }] } });
    expect(releaseA).toHaveBeenCalledTimes(1);
    expect(releaseB).not.toHaveBeenCalled();

    const requestC = session.begin();
    const resultC = await session.enrich(requestC, scene("urn:test:c"), {}, access);
    expect(resultC).toMatchObject({ accepted: true, scene: { nodes: [{ iconUrl: "https://assets.example/c.svg" }] } });
    expect(releaseB).toHaveBeenCalledTimes(1);

    session.dispose();
    session.dispose();
    expect(releaseC).toHaveBeenCalledTimes(1);
  });

  it("asset accessなしSceneのcommitで以前のleaseを解放する", async () => {
    const release = vi.fn();
    const session = new AssetSceneSession();
    const first = session.begin();
    await session.enrich(first, scene("urn:test:a"), {}, {
      policy: POLICY,
      revision: "1",
      resolver: { async resolve() { return resolved(release, "a.svg"); } },
    });

    const second = session.begin();
    expect(session.commitWithoutAssets(second, scene())).toMatchObject({ accepted: true });
    expect(release).toHaveBeenCalledTimes(1);
  });
});

describe("normalizePickedAssetRef", () => {
  it.each([
    "urn:workspace:asset:icon",
    "https://assets.example/icon.svg",
  ])("absolute IRI %sを受け入れる", (value) => {
    expect(normalizePickedAssetRef(value)).toBe(value);
  });

  it.each([
    undefined,
    "",
    " icon.svg",
    "icons/icon.svg",
    "/assets/icon.svg",
  ])("invalid picker result %sを拒否する", (value) => {
    expect(normalizePickedAssetRef(value)).toBeUndefined();
  });
});

function scene(iconRef?: string): DiagramScene {
  return {
    viewId: "main",
    width: 200,
    height: 100,
    diagnostics: [],
    containers: [],
    edges: [],
    nodes: iconRef ? [{
      elementId: "node",
      semanticRef: "urn:test:node",
      structuralKind: "node",
      label: "Node",
      templateRef: "urn:test:template",
      shape: "rectangle",
      iconRef,
      geometry: { x: 0, y: 0, width: 80, height: 40 },
      style: { fill: "white", stroke: "black", text: "black" },
      pinned: false,
      placement: "generated",
    }] : [],
  };
}

function resolved(release: () => void, path: string): AssetResolveResult {
  const lease: AssetLease = {
    url: `https://assets.example/${path}`,
    mediaType: "image/svg+xml",
    byteLength: 128,
    release,
  };
  return { status: "resolved", lease };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}
