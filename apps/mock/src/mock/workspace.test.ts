import { describe, expect, it } from "vitest";

import {
  buildWorkspaceTreeRows,
  type MockWorkspaceEntry,
} from "./workspace";

describe("buildWorkspaceTreeRows", () => {
  it("documentとasset pathから重複のない汎用workspace treeを導出する", () => {
    const entries: MockWorkspaceEntry[] = [
      {
        kind: "iriograph-document",
        path: "models/example.iriograph",
        mediaType: "application/vnd.iriograph+json",
        url: "/workspace/models/example.iriograph",
      },
      {
        kind: "asset",
        path: "assets/icons/example.svg",
        mediaType: "image/svg+xml",
        assetRef: "urn:workspace:asset:example",
        url: "/workspace/assets/icons/example.svg",
      },
    ];

    expect(buildWorkspaceTreeRows(entries).map(({ kind, path, depth }) => ({
      kind,
      path,
      depth,
    }))).toEqual([
      { kind: "folder", path: "assets", depth: 0 },
      { kind: "folder", path: "assets/icons", depth: 1 },
      { kind: "asset", path: "assets/icons/example.svg", depth: 2 },
      { kind: "folder", path: "models", depth: 0 },
      { kind: "iriograph-document", path: "models/example.iriograph", depth: 1 },
    ]);
  });
});
