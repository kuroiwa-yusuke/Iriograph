<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";

import type {
  AssetDefinition,
  IriographDocumentV1,
  ProjectionCatalogV1,
  ProjectionDiagnostic,
} from "@iriograph/core";
import { parseIriographDocumentV1 } from "@iriograph/core";
import { IriographEditor } from "@iriograph/vue-editor";

import { mockProjectionCatalog } from "./mock/catalog";
import {
  buildWorkspaceTreeRows,
  loadMockWorkspace,
  parseMockWorkingCopy,
  readIriographDocument,
  type MockWorkspaceEntry,
  type MockWorkspaceManifest,
  type MockWorkspaceTreeRow,
} from "./mock/workspace";

const STORAGE_PREFIX = "iriograph.mock.workspace:";

const catalog: ProjectionCatalogV1 = mockProjectionCatalog;
const editor = ref<InstanceType<typeof IriographEditor> | null>(null);
const importInput = ref<HTMLInputElement | null>(null);
const workspace = ref<MockWorkspaceManifest>();
const workspaceReady = ref(false);
const workspaceError = ref("");
const activeFilePath = ref("");
const selectedAssetRef = ref("");
const document = ref<IriographDocumentV1>(emptyDocument());
const savedJson = ref("");
const saving = ref(false);
const saveMessage = ref("");
const diagnostics = ref<ProjectionDiagnostic[]>([]);
let saveMessageTimer: number | undefined;

const dirty = computed(() => workspaceReady.value
  && JSON.stringify(document.value) !== savedJson.value);
const errorCount = computed(() => diagnostics.value
  .filter((item) => item.severity === "error").length);
const workspaceRows = computed(() => buildWorkspaceTreeRows(workspace.value?.entries ?? []));
const activeAsset = computed(() => workspace.value?.entries.find(
  (entry) => entry.kind === "asset" && entry.assetRef === selectedAssetRef.value,
));
const documentTitle = computed(() => activeFilePath.value.split("/").at(-1)
  ?.replace(/\.iriograph$/, "") ?? document.value.documentId);

onMounted(() => {
  window.addEventListener("keydown", handleGlobalKeydown, true);
  void initializeWorkspace();
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", handleGlobalKeydown, true);
  if (saveMessageTimer !== undefined) window.clearTimeout(saveMessageTimer);
});

async function initializeWorkspace(): Promise<void> {
  workspaceReady.value = false;
  workspaceError.value = "";
  try {
    workspace.value = await loadMockWorkspace();
    const entry = workspace.value.entries.find(
      (candidate) => candidate.kind === "iriograph-document"
        && candidate.path === workspace.value?.defaultDocumentPath,
    );
    if (!entry) throw new Error("default Iriograph documentがworkspaceにありません。");
    await openWorkspaceDocument(entry, true);
  } catch (cause) {
    workspaceError.value = cause instanceof Error
      ? cause.message
      : "Workspaceの読み込みに失敗しました。";
  } finally {
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
  saving.value = true;
  window.localStorage.setItem(storageKey(activeFilePath.value), JSON.stringify(document.value));
  savedJson.value = JSON.stringify(document.value);
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
  const entry = workspace.value?.entries.find(
    (candidate) => candidate.kind === "iriograph-document"
      && candidate.path === workspace.value?.defaultDocumentPath,
  );
  if (!entry) return;
  window.localStorage.removeItem(storageKey(entry.path));
  await openWorkspaceDocument(entry, false);
  showSaveMessage("repositoryのサンプルへ戻しました");
}

function resolveAssetUrl(
  assetRef: string,
  definition: AssetDefinition | undefined,
): string | undefined {
  // workspace assetの取得先はportable documentではなくhost manifestから解決します。
  const workspaceAsset = workspace.value?.entries.find(
    (entry) => entry.kind === "asset" && entry.assetRef === assetRef,
  );
  if (workspaceAsset) return workspaceAsset.url;
  if (definition) return definition.url;
  if (assetRef.startsWith("https://") || assetRef.startsWith("data:image/")) return assetRef;
  return undefined;
}

async function selectWorkspaceRow(row: MockWorkspaceTreeRow): Promise<void> {
  if (!row.entry) return;
  if (row.entry.kind === "asset") {
    selectedAssetRef.value = row.entry.assetRef ?? "";
    return;
  }
  if (row.path === activeFilePath.value) return;
  if (dirty.value) {
    showSaveMessage("未保存の変更があるためfile切替を中止しました");
    return;
  }
  await openWorkspaceDocument(row.entry, true);
}

async function openWorkspaceDocument(
  entry: MockWorkspaceEntry,
  preferWorkingCopy: boolean,
): Promise<void> {
  try {
    const sourceDocument = await readIriographDocument(entry);
    const workingCopy = preferWorkingCopy
      ? readStoredDocument(storageKey(entry.path))
      : undefined;
    const next = workingCopy ?? sourceDocument;
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
      kind: "node-link",
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
        <button type="button" class="ghost-button" @click="resetMock">Reset</button>
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
        <section v-if="activeAsset" class="workspace-asset-preview">
          <small>ASSET REFERENCE</small>
          <img :src="activeAsset.url" :alt="activeAsset.path" />
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
          :catalog="catalog"
          :title="documentTitle"
          :file-path="activeFilePath"
          :dirty="dirty"
          :saving="saving"
          :save-message="saveMessage"
          :resolve-asset-url="resolveAssetUrl"
          @save="saveDocument"
          @validation-changed="diagnostics = $event"
        />
      </section>
    </main>
  </div>
</template>
