import { describe, expect, it } from "vitest";

import {
  buildWorkspaceTreeRows,
  parseMockWorkingCopy,
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

describe("parseMockWorkingCopy", () => {
  it("schema v1のworking copyだけを採用する", () => {
    const current = {
      schemaVersion: "1",
      kind: "iriograph.document",
      documentId: "working-copy",
      semantic: {
        format: "text/turtle",
        baseIri: "urn:example:",
        authoringProfileRef: "urn:iriograph:authoring-profile:workflow-mock@1",
        source: "",
      },
      views: [{
        viewId: "main",
        kind: "node-link",
        profileRef: "urn:iriograph:profile:rdf-rdfs:1",
        layoutRef: "urn:iriograph:layout:hierarchical-lr:1",
        overlay: {},
      }],
    };

    expect(parseMockWorkingCopy(JSON.stringify(current))).toEqual(current);
  });

  it("authoringProfileRefのない旧working copyと壊れたJSONを無視する", () => {
    const legacy = {
      schemaVersion: "1",
      kind: "iriograph.document",
      documentId: "legacy",
      semantic: {
        format: "text/turtle",
        baseIri: "urn:example:",
        source: "",
      },
      views: [],
    };

    expect(parseMockWorkingCopy(JSON.stringify(legacy))).toBeUndefined();
    expect(parseMockWorkingCopy("{")).toBeUndefined();
    expect(parseMockWorkingCopy(null)).toBeUndefined();
  });
});
