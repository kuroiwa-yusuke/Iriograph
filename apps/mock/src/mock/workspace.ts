import type { IriographDocument } from "@iriograph/core";

export type MockWorkspaceEntry = {
  kind: "iriograph-document" | "asset";
  path: string;
  mediaType: string;
  url: string;
  assetRef?: string;
};

export type MockWorkspaceManifest = {
  workspaceId: string;
  name: string;
  defaultDocumentPath: string;
  entries: MockWorkspaceEntry[];
};

export type MockWorkspaceTreeRow = {
  kind: "folder" | MockWorkspaceEntry["kind"];
  path: string;
  name: string;
  depth: number;
  entry?: MockWorkspaceEntry;
};

export async function loadMockWorkspace(): Promise<MockWorkspaceManifest> {
  const response = await fetch("/workspace/workspace.json", { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Workspace manifestの取得に失敗しました: ${response.status}`);
  }
  const value = await response.json() as unknown;
  if (!isMockWorkspaceManifest(value)) {
    throw new Error("Workspace manifestの形式が不正です。");
  }
  return value;
}

export async function readIriographDocument(
  entry: MockWorkspaceEntry,
): Promise<IriographDocument> {
  if (entry.kind !== "iriograph-document") {
    throw new Error(`${entry.path}はIriograph documentではありません。`);
  }
  const response = await fetch(entry.url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`${entry.path}の取得に失敗しました: ${response.status}`);
  }
  const value = await response.json() as unknown;
  if (!isIriographDocument(value)) {
    throw new Error(`${entry.path}はIriograph document schema v1ではありません。`);
  }
  return value;
}

/**
 * browserのmock hostはdirectory listingを直接読めないためmanifestからtreeを導出します。
 * package/editorへworkspace pathの知識を持ち込まないためのhost専用projectionです。
 */
export function buildWorkspaceTreeRows(
  entries: MockWorkspaceEntry[],
): MockWorkspaceTreeRow[] {
  const folders = new Set<string>();
  for (const entry of entries) {
    const segments = workspaceSegments(entry.path);
    for (let depth = 1; depth < segments.length; depth += 1) {
      folders.add(segments.slice(0, depth).join("/"));
    }
  }

  return [
    ...[...folders].map<MockWorkspaceTreeRow>((path) => ({
      kind: "folder",
      path,
      name: workspaceSegments(path).at(-1) ?? path,
      depth: workspaceSegments(path).length - 1,
    })),
    ...entries.map<MockWorkspaceTreeRow>((entry) => ({
      kind: entry.kind,
      path: entry.path,
      name: workspaceSegments(entry.path).at(-1) ?? entry.path,
      depth: workspaceSegments(entry.path).length - 1,
      entry,
    })),
  ].sort((left, right) => compareWorkspaceRows(left, right));
}

function compareWorkspaceRows(
  left: MockWorkspaceTreeRow,
  right: MockWorkspaceTreeRow,
): number {
  const leftSegments = workspaceSegments(left.path);
  const rightSegments = workspaceSegments(right.path);
  const length = Math.min(leftSegments.length, rightSegments.length);
  for (let index = 0; index < length; index += 1) {
    const comparison = leftSegments[index]!.localeCompare(rightSegments[index]!);
    if (comparison !== 0) return comparison;
  }
  return leftSegments.length - rightSegments.length;
}

function workspaceSegments(path: string): string[] {
  return path.split("/").filter(Boolean);
}

function isMockWorkspaceManifest(value: unknown): value is MockWorkspaceManifest {
  if (!isRecord(value)) return false;
  return typeof value.workspaceId === "string"
    && typeof value.name === "string"
    && typeof value.defaultDocumentPath === "string"
    && Array.isArray(value.entries)
    && value.entries.every(isMockWorkspaceEntry);
}

function isMockWorkspaceEntry(value: unknown): value is MockWorkspaceEntry {
  if (!isRecord(value)) return false;
  return (value.kind === "iriograph-document" || value.kind === "asset")
    && typeof value.path === "string"
    && typeof value.mediaType === "string"
    && typeof value.url === "string"
    && (value.assetRef === undefined || typeof value.assetRef === "string");
}

function isIriographDocument(value: unknown): value is IriographDocument {
  if (!isRecord(value) || !isRecord(value.semantic)) return false;
  return value.kind === "iriograph.document"
    && value.schemaVersion === "1"
    && typeof value.documentId === "string"
    && value.semantic.format === "text/turtle"
    && typeof value.semantic.baseIri === "string"
    && typeof value.semantic.source === "string"
    && Array.isArray(value.views);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
