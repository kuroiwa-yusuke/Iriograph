import {
  parseIriographDocumentV1,
  type IriographDocumentV1,
} from "@iriograph/core";

import { translateMockMessage, type MockLocale } from "./localization";

export type MockWorkspaceEntry = {
  kind: "iriograph-document" | "asset";
  path: string;
  mediaType: string;
  url: string;
  documentId?: string;
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

export const MOCK_WORKSPACE_INDEX_SCHEMA_VERSION = "1";
export const MOCK_WORKSPACE_INDEX_KIND = "iriograph.mock.workspace-index";

type LegacyCatalogImportMigration = {
  legacyCatalogRefs: readonly [string, string];
  currentCatalogRef: string;
};

/**
 * Mock 0.9 and earlier composed the RDF/RDFS base catalog and its mock
 * workflow extension as two imports.  0.10 resolves the equivalent Workflow
 * catalog as one exact source ref.  Keep this intentionally closed: an import
 * set containing an unknown catalog must reach Core unchanged and be
 * diagnosed there.
 */
const LEGACY_CATALOG_IMPORT_MIGRATIONS: readonly LegacyCatalogImportMigration[] = [
  {
    legacyCatalogRefs: [
      "urn:iriograph:catalog:rdf-rdfs-instance-flow@1",
      "urn:iriograph:catalog:workflow-mock-instance-flow@1",
    ],
    currentCatalogRef: "urn:iriograph:catalog:workflow-instance-flow@1",
  },
  {
    legacyCatalogRefs: [
      "urn:iriograph:catalog:rdf-rdfs-classification-region@1",
      "urn:iriograph:catalog:workflow-mock-classification-region@1",
    ],
    currentCatalogRef: "urn:iriograph:catalog:workflow-classification-region@1",
  },
  {
    legacyCatalogRefs: [
      "urn:iriograph:catalog:rdf-rdfs@1",
      "urn:iriograph:catalog:workflow-mock@1",
    ],
    currentCatalogRef: "urn:iriograph:catalog:workflow@1",
  },
];

export type MockPersistedWorkspaceIndexV1 = {
  schemaVersion: "1";
  kind: typeof MOCK_WORKSPACE_INDEX_KIND;
  workspaceId: string;
  documents: {
    path: string;
    documentId: string;
  }[];
};

export async function loadMockWorkspace(locale: MockLocale = "en"): Promise<MockWorkspaceManifest> {
  const response = await fetch("/workspace/workspace.json", { cache: "no-store" });
  if (!response.ok) {
    throw new Error(translateMockMessage(locale, "manifestFetchFailed", { status: response.status }));
  }
  const value = await response.json() as unknown;
  if (!isMockWorkspaceManifest(value)) {
    throw new Error(translateMockMessage(locale, "manifestInvalid"));
  }
  return value;
}

export async function readIriographDocument(
  entry: MockWorkspaceEntry,
  locale: MockLocale = "en",
): Promise<IriographDocumentV1> {
  if (entry.kind !== "iriograph-document") {
    throw new Error(translateMockMessage(locale, "notDocument", { path: entry.path }));
  }
  if (!hasMockRepositorySource(entry)) {
    throw new Error(translateMockMessage(locale, "repositorySourceMissing", { path: entry.path }));
  }
  const response = await fetch(entry.url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(translateMockMessage(locale, "documentFetchFailed", {
      path: entry.path,
      status: response.status,
    }));
  }
  const value = await response.json() as unknown;
  try {
    return parseIriographDocumentV1(value);
  } catch (cause) {
    const detail = cause instanceof Error ? `: ${cause.message}` : "";
    throw new Error(translateMockMessage(locale, "documentSchemaInvalid", {
      path: entry.path,
      detail,
    }));
  }
}

/**
 * localStorageは過去versionのmockが残り得るため、schema v1を満たすcopyだけを採用します。
 * 不正値はrepository上の正本へfallbackできるようundefinedとして扱います。
 */
export function parseMockWorkingCopy(
  source: string | null,
): IriographDocumentV1 | undefined {
  if (!source) return undefined;
  try {
    return migrateLegacyMockCatalogImports(
      parseIriographDocumentV1(JSON.parse(source) as unknown),
    );
  } catch {
    return undefined;
  }
}

function migrateLegacyMockCatalogImports(
  document: IriographDocumentV1,
): IriographDocumentV1 {
  const catalogRefs = document.imports?.map((entry) => entry.catalogRef);
  if (!catalogRefs) return document;
  const migration = LEGACY_CATALOG_IMPORT_MIGRATIONS.find((candidate) => (
    catalogRefs.length === candidate.legacyCatalogRefs.length
    && new Set(catalogRefs).size === candidate.legacyCatalogRefs.length
    && candidate.legacyCatalogRefs.every((catalogRef) => catalogRefs.includes(catalogRef))
  ));
  if (!migration) return document;
  return {
    ...document,
    imports: [{ catalogRef: migration.currentCatalogRef }],
  };
}

/** Dynamic copies use one canonical path shape so a persisted index cannot escape the workspace. */
export function mockCopyDocumentPath(documentId: string): string {
  return `copies/${encodeURIComponent(documentId)}.iriograph`;
}

export function parseMockPersistedWorkspaceIndex(
  source: string | null,
  workspaceId: string,
): MockPersistedWorkspaceIndexV1 | undefined {
  if (!source) return undefined;
  try {
    const value = JSON.parse(source) as unknown;
    if (!isRecord(value)) return undefined;
    if (
      value.schemaVersion !== MOCK_WORKSPACE_INDEX_SCHEMA_VERSION
      || value.kind !== MOCK_WORKSPACE_INDEX_KIND
      || value.workspaceId !== workspaceId
      || !Array.isArray(value.documents)
    ) return undefined;
    const seenPaths = new Set<string>();
    const seenDocumentIds = new Set<string>();
    const documents: MockPersistedWorkspaceIndexV1["documents"] = [];
    for (const item of value.documents) {
      if (
        !isRecord(item)
        || typeof item.path !== "string"
        || typeof item.documentId !== "string"
        || item.documentId.length === 0
        || item.path !== mockCopyDocumentPath(item.documentId)
        || seenPaths.has(item.path)
        || seenDocumentIds.has(item.documentId)
      ) return undefined;
      seenPaths.add(item.path);
      seenDocumentIds.add(item.documentId);
      documents.push({ path: item.path, documentId: item.documentId });
    }
    return {
      schemaVersion: MOCK_WORKSPACE_INDEX_SCHEMA_VERSION,
      kind: MOCK_WORKSPACE_INDEX_KIND,
      workspaceId,
      documents,
    };
  } catch {
    return undefined;
  }
}

export function createMockPersistedWorkspaceIndex(
  workspace: MockWorkspaceManifest,
): MockPersistedWorkspaceIndexV1 {
  return {
    schemaVersion: MOCK_WORKSPACE_INDEX_SCHEMA_VERSION,
    kind: MOCK_WORKSPACE_INDEX_KIND,
    workspaceId: workspace.workspaceId,
    documents: workspace.entries.flatMap((entry) => (
      entry.kind === "iriograph-document"
      && entry.url === ""
      && typeof entry.documentId === "string"
      && entry.path === mockCopyDocumentPath(entry.documentId)
        ? [{ path: entry.path, documentId: entry.documentId }]
        : []
    )),
  };
}

/** Restores only schema-valid copies whose stored document identity still matches the index. */
export function restoreMockPersistedDocuments(
  workspace: MockWorkspaceManifest,
  index: MockPersistedWorkspaceIndexV1 | undefined,
  readWorkingCopy: (path: string) => IriographDocumentV1 | undefined,
): MockWorkspaceManifest {
  if (!index || index.workspaceId !== workspace.workspaceId) return workspace;
  const entries = [...workspace.entries];
  const documentPaths = new Set(entries.map((entry) => entry.path));
  const documentIds = new Set(entries.flatMap((entry) => (
    entry.kind === "iriograph-document" && entry.documentId ? [entry.documentId] : []
  )));
  for (const item of index.documents) {
    if (documentPaths.has(item.path) || documentIds.has(item.documentId)) continue;
    const copy = readWorkingCopy(item.path);
    if (!copy || copy.documentId !== item.documentId) continue;
    entries.push({
      kind: "iriograph-document",
      path: item.path,
      documentId: item.documentId,
      mediaType: "application/vnd.iriograph+json",
      url: "",
    });
    documentPaths.add(item.path);
    documentIds.add(item.documentId);
  }
  return entries.length === workspace.entries.length ? workspace : { ...workspace, entries };
}

export async function resolveMockWorkspaceDocument(
  entry: MockWorkspaceEntry,
  preferWorkingCopy: boolean,
  workingCopy: IriographDocumentV1 | undefined,
  inMemoryDocument: IriographDocumentV1 | undefined,
  readRepository: (entry: MockWorkspaceEntry) => Promise<IriographDocumentV1>,
  locale: MockLocale = "en",
): Promise<IriographDocumentV1> {
  if (preferWorkingCopy) {
    const local = workingCopy ?? inMemoryDocument;
    if (local) return local;
  }
  if (!hasMockRepositorySource(entry)) {
    throw new Error(translateMockMessage(locale, "repositorySourceMissing", { path: entry.path }));
  }
  return readRepository(entry);
}

/** Only manifest-backed documents can discard a working copy and reload repository bytes. */
export function hasMockRepositorySource(
  entry: MockWorkspaceEntry | undefined,
): entry is MockWorkspaceEntry & { kind: "iriograph-document"; url: string } {
  return entry?.kind === "iriograph-document" && entry.url.trim().length > 0;
}

export function hasMockDocumentIdentityConflict(
  workspace: MockWorkspaceManifest,
  documentId: string,
  path = mockCopyDocumentPath(documentId),
): boolean {
  return workspace.entries.some((entry) => (
    entry.path === path
    || (entry.kind === "iriograph-document" && entry.documentId === documentId)
  ));
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
    && (value.documentId === undefined || typeof value.documentId === "string")
    && (value.assetRef === undefined || typeof value.assetRef === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
