import { describe, expect, it, vi } from "vitest";

import {
  buildWorkspaceTreeRows,
  createMockPersistedWorkspaceIndex,
  hasMockRepositorySource,
  hasMockDocumentIdentityConflict,
  mockCopyDocumentPath,
  parseMockPersistedWorkspaceIndex,
  parseMockWorkingCopy,
  resolveMockWorkspaceDocument,
  restoreMockPersistedDocuments,
  type MockWorkspaceEntry,
  type MockWorkspaceManifest,
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

  it.each([
    {
      name: "instance-flow",
      legacyCatalogRefs: [
        "urn:iriograph:catalog:rdf-rdfs-instance-flow@1",
        "urn:iriograph:catalog:workflow-mock-instance-flow@1",
      ],
      currentCatalogRef: "urn:iriograph:catalog:workflow-instance-flow@1",
    },
    {
      name: "classification-region",
      legacyCatalogRefs: [
        "urn:iriograph:catalog:rdf-rdfs-classification-region@1",
        "urn:iriograph:catalog:workflow-mock-classification-region@1",
      ],
      currentCatalogRef: "urn:iriograph:catalog:workflow-classification-region@1",
    },
    {
      name: "full profile",
      legacyCatalogRefs: [
        "urn:iriograph:catalog:rdf-rdfs@1",
        "urn:iriograph:catalog:workflow-mock@1",
      ],
      currentCatalogRef: "urn:iriograph:catalog:workflow@1",
    },
  ])("既知の旧$name import組を現行Workflow catalogへ移行する", ({
    legacyCatalogRefs,
    currentCatalogRef,
  }) => {
    const legacy = {
      ...documentFixture("legacy-catalog"),
      imports: legacyCatalogRefs.map((catalogRef) => ({ catalogRef })),
    };

    expect(parseMockWorkingCopy(JSON.stringify(legacy))).toEqual({
      ...legacy,
      imports: [{ catalogRef: currentCatalogRef }],
    });
  });

  it("未知catalogを含むworking copyのimportsは変更しない", () => {
    const unknownCatalog = "urn:example:catalog:unknown@1";
    const legacy = {
      ...documentFixture("unknown-catalog"),
      imports: [
        { catalogRef: "urn:iriograph:catalog:rdf-rdfs-instance-flow@1" },
        { catalogRef: unknownCatalog },
      ],
    };

    expect(parseMockWorkingCopy(JSON.stringify(legacy))).toEqual(legacy);
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

describe("mock dynamic workspace persistence", () => {
  it("schema付きindexだけを受理しpath traversal・重複・別workspaceを拒否する", () => {
    const valid = {
      schemaVersion: "1",
      kind: "iriograph.mock.workspace-index",
      workspaceId: "mock",
      documents: [{ path: "copies/copy-1.iriograph", documentId: "copy-1" }],
    };
    expect(parseMockPersistedWorkspaceIndex(JSON.stringify(valid), "mock")).toEqual(valid);
    expect(parseMockPersistedWorkspaceIndex(JSON.stringify({
      ...valid,
      documents: [{ path: "../copy-1.iriograph", documentId: "copy-1" }],
    }), "mock")).toBeUndefined();
    expect(parseMockPersistedWorkspaceIndex(JSON.stringify({
      ...valid,
      documents: [...valid.documents, ...valid.documents],
    }), "mock")).toBeUndefined();
    expect(parseMockPersistedWorkspaceIndex(JSON.stringify(valid), "another"))
      .toBeUndefined();
  });

  it("保存copyのschemaとdocumentIdが一致する時だけtreeへ復元する", () => {
    const workspace = workspaceFixture();
    const index = parseMockPersistedWorkspaceIndex(JSON.stringify({
      schemaVersion: "1",
      kind: "iriograph.mock.workspace-index",
      workspaceId: "mock",
      documents: [
        { path: "copies/copy-1.iriograph", documentId: "copy-1" },
        { path: "copies/copy-2.iriograph", documentId: "copy-2" },
      ],
    }), "mock");
    const restored = restoreMockPersistedDocuments(workspace, index, (path) => (
      path.endsWith("copy-1.iriograph") ? documentFixture("copy-1") : documentFixture("wrong")
    ));

    expect(restored.entries).toContainEqual(expect.objectContaining({
      path: "copies/copy-1.iriograph",
      documentId: "copy-1",
      url: "",
    }));
    expect(restored.entries.some((entry) => entry.path === "copies/copy-2.iriograph"))
      .toBe(false);
  });

  it("indexにはcanonical documentを混ぜずdynamic copyだけを保存する", () => {
    const workspace = workspaceFixture();
    workspace.entries.push({
      kind: "iriograph-document",
      path: mockCopyDocumentPath("copy-1"),
      documentId: "copy-1",
      mediaType: "application/vnd.iriograph+json",
      url: "",
    });
    expect(createMockPersistedWorkspaceIndex(workspace).documents).toEqual([
      { path: "copies/copy-1.iriograph", documentId: "copy-1" },
    ]);
    expect(hasMockDocumentIdentityConflict(workspace, "copy-1")).toBe(true);
    expect(hasMockDocumentIdentityConflict(workspace, "copy-2")).toBe(false);
  });

  it("Reset相当のpreferWorkingCopy=falseはmemoryやlocal copyを無視してrepository bytesを読む", async () => {
    const entry = workspaceFixture().entries[0]!;
    const repository = documentFixture("repository");
    const readRepository = async () => repository;
    const selected = await resolveMockWorkspaceDocument(
      entry,
      false,
      documentFixture("working"),
      documentFixture("memory"),
      readRepository,
    );
    expect(selected).toBe(repository);
  });

  it("repository sourceのないdynamic copyはResetを無効化し空URLを読まない", async () => {
    const entry: MockWorkspaceEntry = {
      kind: "iriograph-document",
      path: "copies/copy-1.iriograph",
      documentId: "copy-1",
      mediaType: "application/vnd.iriograph+json",
      url: "",
    };
    const readRepository = vi.fn(async () => documentFixture("wrong"));

    expect(hasMockRepositorySource(entry)).toBe(false);
    await expect(resolveMockWorkspaceDocument(
      entry,
      false,
      documentFixture("working"),
      documentFixture("memory"),
      readRepository,
    )).rejects.toThrow("has no repository source");
    expect(readRepository).not.toHaveBeenCalled();
  });
});

function workspaceFixture(): MockWorkspaceManifest {
  return {
    workspaceId: "mock",
    name: "Mock",
    defaultDocumentPath: "models/example.iriograph",
    entries: [{
      kind: "iriograph-document",
      path: "models/example.iriograph",
      documentId: "repository",
      mediaType: "application/vnd.iriograph+json",
      url: "/workspace/models/example.iriograph",
    }],
  };
}

function documentFixture(documentId: string) {
  return {
    schemaVersion: "1" as const,
    kind: "iriograph.document" as const,
    documentId,
    semantic: {
      format: "text/turtle" as const,
      baseIri: `urn:example:${documentId}:`,
      authoringProfileRef: "urn:iriograph:authoring-profile:workflow-mock@1",
      source: "",
    },
    views: [{
      viewId: "main",
      kind: "node-link" as const,
      profileRef: "urn:iriograph:profile:rdf-rdfs:1",
      layoutRef: "urn:iriograph:layout:hierarchical-lr:1",
      overlay: {},
    }],
  };
}
