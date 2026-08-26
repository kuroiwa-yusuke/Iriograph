import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import { resolveDiagramSceneAssets } from "./assets";
import {
  createPackageDefaultIconResolver,
  packageDefaultIconAssets,
  packageDefaultIconDataUrl,
  packageDefaultIconIntrinsicSize,
  packageDefaultIcons,
  withPackageDefaultIconAccess,
} from "./default-icons";
import type { AssetAccess, AssetResolver } from "./assets";
import type { DiagramScene } from "./model";

describe("package default icons", () => {
  it("ships a small labeled SVG catalog with exact source files and license metadata", () => {
    expect(packageDefaultIcons).toHaveLength(13);
    expect(packageDefaultIcons.map((icon) => icon.label)).toEqual(expect.arrayContaining([
      "クラウド", "サーバー", "データベース", "API", "関数", "承認", "警告",
    ]));
    for (const icon of packageDefaultIcons) {
      const file = readFileSync(new URL(`../assets/icons/${icon.name}.svg`, import.meta.url), "utf8").trim();
      expect(file).toBe(icon.svg);
      expect(file).toMatch(/^<svg[^>]+>[\s\S]+<\/svg>$/u);
      expect(packageDefaultIconAssets[icon.assetRef]).toMatchObject({
        assetRef: icon.assetRef,
        mediaType: "image/svg+xml",
        extensions: expect.objectContaining({
          "https://iriograph.dev/ns/package-icon#label": icon.label,
          "https://iriograph.dev/ns/package-icon#license": icon.license,
        }),
      });
    }
  });

  it("resolves a stable ref as a no-op data URL lease and falls through unknown refs", async () => {
    const icon = packageDefaultIcons[0]!;
    const fallback: AssetResolver = {
      resolve: vi.fn(async () => ({ status: "unresolved", reason: "deleted" } as const)),
    };
    const resolver = createPackageDefaultIconResolver(fallback);
    const controller = new AbortController();

    const resolved = await resolver.resolve({ assetRef: icon.assetRef, revision: "r1", signal: controller.signal });
    expect(resolved).toMatchObject({
      status: "resolved",
      lease: { mediaType: "image/svg+xml" },
    });
    if (resolved.status === "resolved") {
      expect(resolved.lease.url).toBe(packageDefaultIconDataUrl(icon.assetRef));
      expect(resolved.lease.svgViewBox).toBe("0 0 24 24");
      expect(packageDefaultIconIntrinsicSize(icon.assetRef)).toEqual({
        width: 24,
        height: 24,
        aspectRatio: 1,
        source: "svg-view-box",
      });
      expect(() => resolved.lease.release()).not.toThrow();
    }
    expect(fallback.resolve).not.toHaveBeenCalled();

    await expect(resolver.resolve({ assetRef: "urn:test:missing", revision: "r1", signal: controller.signal }))
      .resolves.toMatchObject({ status: "unresolved", reason: "deleted" });
  });

  it("never weakens an injected host policy and resolves trusted package data before that resolver", async () => {
    const hostResolver: AssetResolver = {
      resolve: vi.fn(async () => ({ status: "unresolved", reason: "not-found" } as const)),
    };
    const host: AssetAccess = {
      resolver: hostResolver,
      revision: "workspace-r1",
      policy: {
        allowedMediaTypes: ["image/png"],
        maxBytes: 17,
        allowedSchemes: ["blob:"],
        allowedOrigins: ["https://workspace.example"],
      },
    };
    const access = withPackageDefaultIconAccess(host);
    expect(access.policy).toBe(host.policy);
    expect(access.policy).toEqual(host.policy);

    const icon = packageDefaultIcons[0]!;
    const batch = await resolveDiagramSceneAssets(
      sceneWithIcon(icon.assetRef),
      packageDefaultIconAssets,
      access,
      new AbortController().signal,
    );
    expect(batch.scene.nodes[0]?.iconUrl).toBe(packageDefaultIconDataUrl(icon.assetRef));
    expect(batch.scene.nodes[0]?.iconIntrinsicSize).toEqual({
      width: 24,
      height: 24,
      aspectRatio: 1,
      source: "svg-view-box",
    });
    expect(batch.diagnostics).toEqual([]);
    expect(hostResolver.resolve).not.toHaveBeenCalled();
    batch.release();
  });
});

function sceneWithIcon(iconRef: string): DiagramScene {
  return {
    viewId: "main",
    width: 300,
    height: 200,
    nodes: [{
      elementId: "node-a",
      semanticRef: "urn:test:a",
      structuralKind: "node",
      label: "A",
      templateRef: "urn:test:template",
      shape: "rectangle",
      iconRef,
      geometry: { x: 20, y: 20, width: 100, height: 60 },
      style: { fill: "#fff", stroke: "#000", text: "#000" },
      pinned: false,
      placement: "generated",
    }],
    containers: [],
    edges: [],
    diagnostics: [],
  };
}
