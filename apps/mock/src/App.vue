<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from "vue";

import type {
  AssetAccess,
  AssetMediaType,
  IriographDocumentV1,
  ProjectionCatalogV1,
  ProjectionDiagnostic,
} from "@iriograph/core";
import { parseIriographDocumentV1 } from "@iriograph/core";
import {
  IriographEditor,
  type AssetPicker,
  type AssetPickResult,
  type DocumentDuplicateHandoff,
  type DocumentIdentityAllocator,
  type EditorAssetOption,
} from "@iriograph/vue-editor";

import { mockInstanceFlowProjectionCatalog } from "./mock/catalog";
import {
  createMockAuthoringContext,
  createMockResourceIriAllocator,
  mockProjectionRuntimeContext,
} from "./mock/authoring";
import { mockSemanticValidationContext } from "./mock/semantic-validation";
import { createMockPerformanceDocument } from "./mock/performance-fixture";
import {
  createMockAssetHost,
  createMockWorkspaceLocator,
  isMockAssetMediaType,
  workspaceAssetPickResult,
  type MockAssetHost,
} from "./mock/assets";
import {
  buildWorkspaceTreeRows,
  createMockPersistedWorkspaceIndex,
  hasMockDocumentIdentityConflict,
  hasMockRepositorySource,
  loadMockWorkspace,
  mockCopyDocumentPath,
  parseMockPersistedWorkspaceIndex,
  parseMockWorkingCopy,
  readIriographDocument,
  resolveMockWorkspaceDocument,
  restoreMockPersistedDocuments,
  type MockWorkspaceEntry,
  type MockWorkspaceManifest,
  type MockWorkspaceTreeRow,
} from "./mock/workspace";

const STORAGE_PREFIX = "iriograph.mock.workspace:";

const catalog: ProjectionCatalogV1 = mockInstanceFlowProjectionCatalog;
const editor = ref<InstanceType<typeof IriographEditor> | null>(null);
const importInput = ref<HTMLInputElement | null>(null);
const workspace = ref<MockWorkspaceManifest>();
const workspaceReady = ref(false);
const workspaceError = ref("");
const activeFilePath = ref("");
const selectedAssetRef = ref("");
const assetAccess = shallowRef<AssetAccess>();
const assetPickPending = ref(false);
const document = ref<IriographDocumentV1>(emptyDocument());
const savedJson = ref("");
const saving = ref(false);
const saveMessage = ref("");
const diagnostics = ref<ProjectionDiagnostic[]>([]);
const inMemoryDocuments = new Map<string, IriographDocumentV1>();
let saveMessageTimer: number | undefined;
let assetHost: MockAssetHost | undefined;
let componentDisposed = false;
let pendingAssetPick: PendingAssetPick | undefined;

type PendingAssetPick = {
  allowedMediaTypes: readonly AssetMediaType[];
  signal: AbortSignal;
  abort: () => void;
  resolve: (result: AssetPickResult) => void;
};

const dirty = computed(() => workspaceReady.value
  && JSON.stringify(document.value) !== savedJson.value);
const errorCount = computed(() => diagnostics.value
  .filter((item) => item.severity === "error").length);
const workspaceRows = computed(() => buildWorkspaceTreeRows(workspace.value?.entries ?? []));
const workspaceAssetOptions = computed<EditorAssetOption[]>(() => (
  workspace.value?.entries.flatMap((entry): EditorAssetOption[] => (
    entry.kind === "asset" && entry.assetRef && isMockAssetMediaType(entry.mediaType)
      ? [{
          assetRef: entry.assetRef,
          label: entry.path.split("/").at(-1) ?? entry.path,
          path: entry.path,
          mediaType: entry.mediaType,
        }]
      : []
  )) ?? []
));
const workspaceLocator = computed(() => (
  workspace.value ? createMockWorkspaceLocator(workspace.value) : undefined
));
const activeAsset = computed(() => workspace.value?.entries.find(
  (entry) => entry.kind === "asset" && entry.assetRef === selectedAssetRef.value,
));
const activeDocumentEntry = computed(() => workspace.value?.entries.find(
  (entry) => entry.kind === "iriograph-document" && entry.path === activeFilePath.value,
));
const canResetActiveDocument = computed(() => hasMockRepositorySource(
  activeDocumentEntry.value,
));
const resetUnavailableReason = computed(() => (
  activeDocumentEntry.value && !canResetActiveDocument.value
    ? "保存した複製にはrepository上の正本がないため戻せません"
    : ""
));
const documentTitle = computed(() => activeFilePath.value.split("/").at(-1)
  ?.replace(/\.iriograph$/, "") ?? document.value.documentId);
const authoringContext = computed(() => createMockAuthoringContext(document.value));
const resourceIriAllocator = computed(() => (
  createMockResourceIriAllocator(document.value.semantic.baseIri)
));
const documentIdentityAllocator: DocumentIdentityAllocator = {
  allocate(request) {
    if (request.signal?.aborted) return undefined;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const documentId = globalThis.crypto?.randomUUID?.()
        ?? `mock-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
      const path = mockCopyDocumentPath(documentId);
      if (
        workspace.value
        && !hasMockDocumentIdentityConflict(workspace.value, documentId, path)
        && !inMemoryDocuments.has(path)
        && window.localStorage.getItem(storageKey(path)) === null
      ) {
        return {
          documentId,
          baseIri: `urn:iriograph:mock:document:${documentId}:`,
          requestId: request.requestId,
          documentRevision: request.documentRevision,
        };
      }
    }
    return undefined;
  },
};

onMounted(() => {
  window.addEventListener("keydown", handleGlobalKeydown, true);
  void initializeWorkspace();
});

onBeforeUnmount(() => {
  componentDisposed = true;
  window.removeEventListener("keydown", handleGlobalKeydown, true);
  if (saveMessageTimer !== undefined) window.clearTimeout(saveMessageTimer);
  settleAssetPick({ status: "cancelled" });
  assetHost?.dispose();
  assetHost = undefined;
  assetAccess.value = undefined;
});

async function initializeWorkspace(): Promise<void> {
  workspaceReady.value = false;
  workspaceError.value = "";
  if (new URLSearchParams(window.location.search).get("benchmark") === "normal") {
    const benchmarkDocument = createMockPerformanceDocument();
    document.value = benchmarkDocument;
    activeFilePath.value = "benchmarks/normal-500-1000.iriograph";
    savedJson.value = JSON.stringify(benchmarkDocument);
    workspaceReady.value = true;
    return;
  }
  let nextAssetHost: MockAssetHost | undefined;
  try {
    const repositoryWorkspace = await loadMockWorkspace();
    const persistedIndex = parseMockPersistedWorkspaceIndex(
      window.localStorage.getItem(workspaceIndexKey(repositoryWorkspace.workspaceId)),
      repositoryWorkspace.workspaceId,
    );
    const nextWorkspace = restoreMockPersistedDocuments(
      repositoryWorkspace,
      persistedIndex,
      (path) => readStoredDocument(storageKey(path)),
    );
    const entry = nextWorkspace.entries.find(
      (candidate) => candidate.kind === "iriograph-document"
        && candidate.path === nextWorkspace.defaultDocumentPath,
    );
    if (!entry) throw new Error("default Iriograph documentがworkspaceにありません。");

    nextAssetHost = createMockAssetHost(nextWorkspace, {
      baseUrl: window.location.href,
    });
    workspace.value = nextWorkspace;
    await openWorkspaceDocument(entry, true);
    if (workspaceError.value) throw new Error(workspaceError.value);
    if (componentDisposed) return;

    assetHost?.dispose();
    assetHost = nextAssetHost;
    nextAssetHost = undefined;
    assetAccess.value = assetHost.access;
  } catch (cause) {
    workspaceError.value = cause instanceof Error
      ? cause.message
      : "Workspaceの読み込みに失敗しました。";
  } finally {
    nextAssetHost?.dispose();
    workspaceReady.value = !workspaceError.value;
  }
}

function handleGlobalKeydown(event: KeyboardEvent): void {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
    event.preventDefault();
    event.stopPropagation();
    void saveDocument();
  }
}

async function saveDocument(): Promise<void> {
  if (!workspaceReady.value || saving.value || !editor.value) return;
  if (!await editor.value.flushPendingEdits()) return;
  persistDocument();
}

function saveFromEditor(): void {
  if (!workspaceReady.value || saving.value) return;
  persistDocument();
}

function persistDocument(): void {
  saving.value = true;
  const serialized = JSON.stringify(document.value);
  window.localStorage.setItem(storageKey(activeFilePath.value), serialized);
  inMemoryDocuments.set(
    activeFilePath.value,
    JSON.parse(serialized) as IriographDocumentV1,
  );
  persistWorkspaceIndex();
  savedJson.value = serialized;
  saving.value = false;
  showSaveMessage("browser working copyを保存しました");
}

function selectImportFile(): void {
  importInput.value?.click();
}

async function importDocument(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;

  try {
    const imported = parseIriographDocumentV1(JSON.parse(await file.text()) as unknown);
    document.value = structuredClone(imported);
    activeFilePath.value = `imports/${file.name}`;
    savedJson.value = JSON.stringify(imported);
    workspaceReady.value = true;
    showSaveMessage(`${file.name}を取り込みました`);
  } catch (cause) {
    showSaveMessage(cause instanceof Error ? cause.message : "取込に失敗しました");
  }
}

async function exportDocument(): Promise<void> {
  if (!workspaceReady.value || !editor.value) return;
  if (!await editor.value.flushPendingEdits()) return;
  const blob = new Blob([JSON.stringify(document.value, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = window.document.createElement("a");
  anchor.href = url;
  anchor.download = `${document.value.documentId}.iriograph`;
  anchor.click();
  URL.revokeObjectURL(url);
  showSaveMessage("書き出しました");
}

async function resetMock(): Promise<void> {
  const entry = activeDocumentEntry.value;
  if (!hasMockRepositorySource(entry)) return;
  window.localStorage.removeItem(storageKey(entry.path));
  inMemoryDocuments.delete(entry.path);
  await openWorkspaceDocument(entry, false);
  showSaveMessage("repositoryのサンプルへ戻しました");
}

async function selectWorkspaceRow(row: MockWorkspaceTreeRow): Promise<void> {
  if (!row.entry) return;
  if (row.entry.kind === "asset") {
    selectedAssetRef.value = row.entry.assetRef ?? "";
    if (pendingAssetPick) {
      const result = workspaceAssetPickResult(
        row.entry,
        pendingAssetPick.allowedMediaTypes,
      );
      if (result) settleAssetPick(result);
      else showSaveMessage("このassetのmedia typeは選択できません");
    }
    return;
  }
  if (row.path === activeFilePath.value) return;
  if (dirty.value) {
    showSaveMessage("未保存の変更があるためfile切替を中止しました");
    return;
  }
  await openWorkspaceDocument(row.entry, true);
}

const pickWorkspaceAsset: AssetPicker = (request) => {
  settleAssetPick({ status: "cancelled" });
  if (request.signal.aborted) return Promise.resolve({ status: "cancelled" });
  assetPickPending.value = true;
  return new Promise<AssetPickResult>((resolve) => {
    const pending: PendingAssetPick = {
      allowedMediaTypes: request.allowedMediaTypes,
      signal: request.signal,
      abort: () => finishAssetPick(pending, { status: "cancelled" }),
      resolve,
    };
    pendingAssetPick = pending;
    request.signal.addEventListener("abort", pending.abort, { once: true });
  });
};

function settleAssetPick(result: AssetPickResult): void {
  const pending = pendingAssetPick;
  if (!pending) return;
  finishAssetPick(pending, result);
}

function finishAssetPick(pending: PendingAssetPick, result: AssetPickResult): void {
  if (pendingAssetPick !== pending) return;
  pending.signal.removeEventListener("abort", pending.abort);
  pendingAssetPick = undefined;
  assetPickPending.value = false;
  pending.resolve(result);
}

async function openWorkspaceDocument(
  entry: MockWorkspaceEntry,
  preferWorkingCopy: boolean,
): Promise<void> {
  try {
    const workingCopy = preferWorkingCopy
      ? readStoredDocument(storageKey(entry.path))
      : undefined;
    const next = await resolveMockWorkspaceDocument(
      entry,
      preferWorkingCopy,
      workingCopy,
      inMemoryDocuments.get(entry.path),
      readIriographDocument,
    );
    document.value = structuredClone(next);
    activeFilePath.value = entry.path;
    savedJson.value = JSON.stringify(next);
    diagnostics.value = [];
    workspaceReady.value = true;
    workspaceError.value = "";
  } catch (cause) {
    workspaceError.value = cause instanceof Error
      ? cause.message
      : `${entry.path}の読み込みに失敗しました。`;
  }
}

function openDuplicatedDocument(handoff: DocumentDuplicateHandoff): void {
  if (
    handoff.sourceDocumentId !== document.value.documentId
    || handoff.sourceDocumentRevision !== authoringContext.value.documentRevision
  ) {
    showSaveMessage("元の文書が変更されたため複製結果を開きませんでした");
    return;
  }
  const next = structuredClone(handoff.document as IriographDocumentV1);
  const path = mockCopyDocumentPath(next.documentId);
  if (
    !workspace.value
    || hasMockDocumentIdentityConflict(workspace.value, next.documentId, path)
    || inMemoryDocuments.has(path)
    || window.localStorage.getItem(storageKey(path)) !== null
  ) {
    showSaveMessage("同じ文書IDまたは保存先が既にあるため複製結果を開きませんでした");
    return;
  }
  const serialized = JSON.stringify(next);
  inMemoryDocuments.set(path, structuredClone(next));
  window.localStorage.setItem(storageKey(path), serialized);
  workspace.value = {
    ...workspace.value,
    entries: [...workspace.value.entries, {
      kind: "iriograph-document",
      path,
      documentId: next.documentId,
      mediaType: "application/vnd.iriograph+json",
      url: "",
    }],
  };
  persistWorkspaceIndex();
  activeFilePath.value = path;
  document.value = next;
  // The Host has already created and persisted this separate working-copy file.
  // Opening it therefore starts clean, just like a successful Cloud create.
  savedJson.value = serialized;
  diagnostics.value = [];
  showSaveMessage("新しい図を別の作業コピーとして開きました");
}

async function copyAssetRef(): Promise<void> {
  if (!activeAsset.value?.assetRef) return;
  try {
    await navigator.clipboard.writeText(activeAsset.value.assetRef);
    showSaveMessage("asset IRIをコピーしました");
  } catch {
    showSaveMessage("clipboardへコピーできませんでした");
  }
}

function readStoredDocument(key: string): IriographDocumentV1 | undefined {
  return parseMockWorkingCopy(window.localStorage.getItem(key));
}

function storageKey(path: string): string {
  return `${STORAGE_PREFIX}${path}`;
}

function workspaceIndexKey(workspaceId: string): string {
  return `${STORAGE_PREFIX}index:v1:${workspaceId}`;
}

function persistWorkspaceIndex(): void {
  if (!workspace.value) return;
  window.localStorage.setItem(
    workspaceIndexKey(workspace.value.workspaceId),
    JSON.stringify(createMockPersistedWorkspaceIndex(workspace.value)),
  );
}

function showSaveMessage(message: string): void {
  saveMessage.value = message;
  if (saveMessageTimer !== undefined) window.clearTimeout(saveMessageTimer);
  saveMessageTimer = window.setTimeout(() => {
    saveMessage.value = "";
  }, 2600);
}

function emptyDocument(): IriographDocumentV1 {
  return {
    schemaVersion: "1",
    kind: "iriograph.document",
    documentId: "loading",
    semantic: {
      format: "text/turtle",
      baseIri: "urn:iriograph:loading:",
      authoringProfileRef: "urn:iriograph:authoring-profile:workflow-mock@1",
      source: "",
    },
    views: [{
      viewId: "main",
      kind: "region",
      profileRef: catalog.profileRef,
      layoutRef: catalog.defaults?.layoutRef ?? "urn:iriograph:layout:hierarchical-lr:1",
      overlay: {},
    }],
  };
}
</script>

<template>
  <div class="app-shell">
    <header class="topbar">
      <div class="brand-lockup">
        <span class="brand-mark" aria-hidden="true"><i /><i /><i /></span>
        <div><strong>Iriograph</strong><span>local package host</span></div>
      </div>
      <div class="document-heading">
        <span class="eyebrow">Workspace editor</span>
        <strong>{{ documentTitle || "Loading…" }}</strong>
        <span class="revision">embedded @iriograph/vue-editor</span>
      </div>
      <div class="status-cluster">
        <span class="status-pill" :class="errorCount ? 'warning' : 'success'">
          <i /> {{ errorCount ? `${errorCount} errors` : "valid" }}
        </span>
        <span class="status-pill" :class="dirty ? 'warning' : 'neutral'">
          {{ dirty ? "未保存" : "保存済み" }}
        </span>
        <span v-if="saveMessage" class="save-message" role="status">{{ saveMessage }}</span>
        <input
          ref="importInput"
          class="sr-only"
          type="file"
          accept=".iriograph,.json,application/json"
          @change="importDocument"
        />
        <button type="button" class="ghost-button" :disabled="!dirty" @click="saveDocument">保存</button>
        <button type="button" class="ghost-button" @click="selectImportFile">取込</button>
        <button type="button" class="ghost-button" :disabled="!workspaceReady" @click="exportDocument">書出</button>
        <button
          type="button"
          class="ghost-button"
          :disabled="!canResetActiveDocument"
          :title="resetUnavailableReason || '現在の文書をrepository上の正本へ戻す'"
          @click="resetMock"
        >Repositoryへ戻す</button>
        <span v-if="resetUnavailableReason" class="reset-unavailable-reason" role="status">
          {{ resetUnavailableReason }}
        </span>
      </div>
    </header>

    <main v-if="workspaceError" class="workspace-load-state error">
      <strong>Workspaceを開けませんでした</strong>
      <p>{{ workspaceError }}</p>
      <button type="button" @click="initializeWorkspace">再試行</button>
    </main>

    <main v-else-if="!workspaceReady" class="workspace-load-state">
      <strong>Workspaceを読み込み中…</strong>
      <p>repository内の `.iriograph` とasset manifestを参照しています。</p>
    </main>

    <main v-else class="host-workbench">
      <aside class="workspace-panel" aria-label="Mock workspace files">
        <header>
          <span>WORKSPACE</span>
          <strong>{{ workspace?.name }}</strong>
        </header>
        <nav class="workspace-tree" aria-label="Workspace tree">
          <button
            v-for="row in workspaceRows"
            :key="`${row.kind}:${row.path}`"
            type="button"
            :class="[
              `kind-${row.kind}`,
              {
                active: row.path === activeFilePath,
                selected: row.entry?.assetRef === selectedAssetRef,
              },
            ]"
            :style="{ paddingLeft: `${12 + row.depth * 16}px` }"
            :disabled="row.kind === 'folder'"
            :title="row.entry?.assetRef ?? row.path"
            @click="selectWorkspaceRow(row)"
          >
            <i aria-hidden="true">{{ row.kind === "folder" ? "▾" : row.kind === "asset" ? "◇" : "◆" }}</i>
            <span>{{ row.name }}</span>
          </button>
        </nav>
        <section v-if="assetPickPending" class="workspace-picker-prompt" role="status">
          <strong>アイコンを選択</strong>
          <p>tree内の画像assetをクリックしてください。</p>
          <button type="button" @click="settleAssetPick({ status: 'cancelled' })">キャンセル</button>
        </section>
        <section v-if="activeAsset" class="workspace-asset-preview">
          <small>ASSET REFERENCE</small>
          <strong>{{ activeAsset.path.split("/").at(-1) }}</strong>
          <code>{{ activeAsset.assetRef }}</code>
          <button type="button" @click="copyAssetRef">IRIをコピー</button>
          <p>画像bytesではなく、このIRIだけをoverlayが保持します。</p>
        </section>
        <footer>
          <span>Host-owned tree</span>
          <small>{{ workspace?.entries.length }} files</small>
        </footer>
      </aside>

      <section class="host-editor-region">
        <IriographEditor
          ref="editor"
          v-model="document"
          hide-header
          :runtime-context="mockProjectionRuntimeContext"
          :title="documentTitle"
          :file-path="activeFilePath"
          :dirty="dirty"
          :saving="saving"
          fit-on-initial-load
          :save-message="saveMessage"
          :asset-access="assetAccess"
          :asset-options="workspaceAssetOptions"
          :workspace-locator="workspaceLocator"
          :pick-asset="pickWorkspaceAsset"
          :authoring-context="authoringContext"
          :semantic-validation-context="mockSemanticValidationContext"
          :resource-iri-allocator="resourceIriAllocator"
          :document-identity-allocator="documentIdentityAllocator"
          :predicate-inference-policy="{ query: 'rdfs-subproperty', validation: 'rdfs-subproperty' }"
          @save="saveFromEditor"
          @duplicated-as-new="openDuplicatedDocument"
          @validation-changed="diagnostics = $event"
        />
      </section>
    </main>
  </div>
</template>
