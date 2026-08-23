<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";

import type {
  AssetDefinition,
  DiagramCatalog,
  IriographDocument,
  ProjectionDiagnostic,
} from "@iriograph/core";
import { IriographEditor } from "@iriograph/vue-editor";

import rawCatalog from "./mock/catalog.json";
import { mockDocument } from "./mock/document";

const STORAGE_KEY = "iriograph.mock.purchase-approval";

const catalog = rawCatalog as unknown as DiagramCatalog;
const editor = ref<InstanceType<typeof IriographEditor> | null>(null);
const importInput = ref<HTMLInputElement | null>(null);
const document = ref<IriographDocument>(loadLocalDocument());
const savedJson = ref(JSON.stringify(document.value));
const saving = ref(false);
const saveMessage = ref("");
const diagnostics = ref<ProjectionDiagnostic[]>([]);
let saveMessageTimer: number | undefined;

const dirty = computed(() => JSON.stringify(document.value) !== savedJson.value);
const errorCount = computed(() => diagnostics.value.filter((item) => item.severity === "error").length);

onMounted(() => {
  window.addEventListener("keydown", handleGlobalKeydown, true);
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", handleGlobalKeydown, true);
  if (saveMessageTimer !== undefined) window.clearTimeout(saveMessageTimer);
});

function handleGlobalKeydown(event: KeyboardEvent): void {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
    event.preventDefault();
    event.stopPropagation();
    saveDocument();
  }
}

function saveDocument(): void {
  if (!editor.value?.flushPendingEdits()) return;
  saving.value = true;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(document.value));
  savedJson.value = JSON.stringify(document.value);
  saving.value = false;
  showSaveMessage("ローカル保存済み");
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
    const imported = JSON.parse(await file.text()) as IriographDocument;
    if (imported?.kind !== "iriograph.document" || imported.schemaVersion !== "1") {
      throw new Error("Iriograph document schema v1ではありません。");
    }
    document.value = structuredClone(imported);
    savedJson.value = JSON.stringify(imported);
    showSaveMessage(`${file.name}を取り込みました`);
  } catch (cause) {
    showSaveMessage(cause instanceof Error ? cause.message : "取込に失敗しました");
  }
}

function exportDocument(): void {
  if (!editor.value?.flushPendingEdits()) return;
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

function resetMock(): void {
  document.value = structuredClone(mockDocument);
  savedJson.value = JSON.stringify(document.value);
  window.localStorage.removeItem(STORAGE_KEY);
  showSaveMessage("サンプルへ戻しました");
}

function resolveAssetUrl(
  assetRef: string,
  definition: AssetDefinition | undefined,
): string | undefined {
  // hostがURIから実URLへの解決を注入する境界の最小例です。
  if (definition) return definition.url;
  if (assetRef.startsWith("https://") || assetRef.startsWith("data:image/")) return assetRef;
  return undefined;
}

function loadLocalDocument(): IriographDocument {
  try {
    const source = window.localStorage.getItem(STORAGE_KEY);
    if (!source) return structuredClone(mockDocument);
    const parsed = JSON.parse(source) as IriographDocument;
    return parsed?.kind === "iriograph.document" && parsed.schemaVersion === "1"
      ? parsed
      : structuredClone(mockDocument);
  } catch {
    return structuredClone(mockDocument);
  }
}

function showSaveMessage(message: string): void {
  saveMessage.value = message;
  if (saveMessageTimer !== undefined) window.clearTimeout(saveMessageTimer);
  saveMessageTimer = window.setTimeout(() => {
    saveMessage.value = "";
  }, 2600);
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
        <span class="eyebrow">Source editor</span>
        <strong>Purchase approval</strong>
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
        <button type="button" class="ghost-button" @click="exportDocument">書出</button>
        <button type="button" class="ghost-button" @click="resetMock">Reset</button>
      </div>
    </header>

    <main class="host-editor-region">
      <IriographEditor
        ref="editor"
        v-model="document"
        :catalog="catalog"
        title="Purchase approval"
        file-path="models/purchase-approval.iriograph"
        :dirty="dirty"
        :saving="saving"
        :save-message="saveMessage"
        :resolve-asset-url="resolveAssetUrl"
        @save="saveDocument"
        @validation-changed="diagnostics = $event"
      />
    </main>
  </div>
</template>
