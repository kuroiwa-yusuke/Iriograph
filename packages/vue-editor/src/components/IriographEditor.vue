<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";

import {
  applySemanticSource,
  buildIriographView,
  createProjectionRuntimeContext,
  createStandardLayoutRegistry,
  validateIriographDocumentV1,
  validateProjectionCatalogV1,
  type AssetAccess,
  type AssetMediaType,
  type DiagramScene,
  type ElementGeometry,
  type IriographDocument,
  type LayoutAdapterRegistry,
  type Point,
  type ProjectionCatalogV1,
  type ProjectionDiagnostic,
  type ProjectionRuntimeContext,
  type RuntimeValidationIssue,
  type SemanticSourceUpdate,
  type SceneContainer,
  type SceneEdge,
  type SceneNode,
  type ViewElementOverlay,
} from "@iriograph/core";

import DiagramCanvas from "./DiagramCanvas.vue";
import {
  AssetSceneSession,
  normalizePickedAssetRef,
  type AssetPicker,
} from "../asset-session";

type Panel = "diagram" | "turtle" | "document" | "catalog";
type SelectedElement = SceneNode | SceneContainer | SceneEdge;

const props = withDefaults(defineProps<{
  modelValue: IriographDocument;
  catalog: ProjectionCatalogV1;
  layoutRegistry?: LayoutAdapterRegistry;
  title?: string;
  filePath?: string;
  dirty?: boolean;
  saving?: boolean;
  saveMessage?: string;
  canSave?: boolean;
  readOnly?: boolean;
  hideHeader?: boolean;
  assetAccess?: AssetAccess;
  pickAsset?: AssetPicker;
}>(), {
  title: "",
  filePath: "",
  dirty: false,
  saving: false,
  saveMessage: "",
  canSave: true,
  readOnly: false,
  hideHeader: false,
  assetAccess: undefined,
  pickAsset: undefined,
  layoutRegistry: undefined,
});

const emit = defineEmits<{
  "update:modelValue": [document: IriographDocument];
  save: [];
  selectionChanged: [elementId: string];
  validationChanged: [diagnostics: ProjectionDiagnostic[]];
}>();

const draft = ref<IriographDocument>(clone(props.modelValue));
const turtleDraft = ref(draft.value.semantic.source);
const panel = ref<Panel>("diagram");
const selectedElementId = ref("");
const zoom = ref(1);
const history = ref<IriographDocument[]>([]);
const future = ref<IriographDocument[]>([]);
const schemaDiagnostics = ref<ProjectionDiagnostic[]>([]);
const applyDiagnostics = ref<ProjectionDiagnostic[]>([]);
const scene = ref<DiagramScene>(emptyScene(draft.value.views[0]?.viewId ?? ""));
const sceneLoading = ref(true);
const applyingTurtle = ref(false);
const pickingAsset = ref(false);
const defaultLayoutRegistry = createStandardLayoutRegistry();
const assetSceneSession = new AssetSceneSession();
let lastEmittedJson = "";
let gestureBefore: IriographDocument | undefined;
let sceneRequestToken = 0;
let semanticRequestToken = 0;
let pickerRequestToken = 0;
let pickerAbortController: AbortController | undefined;

const activeView = computed(() => draft.value.views[0]);
const selectedElement = computed<SelectedElement | undefined>(() => [
  ...scene.value.nodes,
  ...scene.value.containers,
  ...scene.value.edges,
].find((element) => element.elementId === selectedElementId.value));
const selectedOverlay = computed<ViewElementOverlay | undefined>(() => {
  if (!activeView.value || !selectedElementId.value) return undefined;
  return activeView.value.overlay[selectedElementId.value];
});
const diagnostics = computed(() => [
  ...schemaDiagnostics.value,
  ...applyDiagnostics.value,
  ...scene.value.diagnostics,
].filter(uniqueDiagnostic()));
const sceneError = computed(() => [
  ...schemaDiagnostics.value,
  ...scene.value.diagnostics,
].find((item) => item.severity === "error"));
const errorCount = computed(() => diagnostics.value.filter((item) => item.severity === "error").length);
const warningCount = computed(() => diagnostics.value.filter((item) => item.severity === "warning").length);
const turtlePending = computed(() => turtleDraft.value !== draft.value.semantic.source);
const canUndo = computed(() => history.value.length > 0);
const canRedo = computed(() => future.value.length > 0);
const documentJson = computed(() => JSON.stringify(draft.value, null, 2));
const catalogJson = computed(() => JSON.stringify(props.catalog, null, 2));
const overlayJson = computed(() => JSON.stringify(activeView.value?.overlay ?? {}, null, 2));
const heading = computed(() => props.title || props.filePath || draft.value.documentId || "Untitled");
const stateLabel = computed(() => {
  if (props.saving) return "保存中";
  if (props.saveMessage) return props.saveMessage;
  return props.dirty || turtlePending.value ? "未保存" : "保存済み";
});
const nodeTemplateRefs = computed(() => Object.values(props.catalog.templates)
  .filter((template) => template.structuralKind === selectedElement.value?.structuralKind)
  .map((template) => template.templateRef));
const assetRefs = computed(() => Object.keys(props.catalog.assets));

watch(
  () => props.modelValue,
  (value) => {
    cancelAssetPicker();
    const nextJson = JSON.stringify(value);
    if (nextJson === lastEmittedJson) {
      lastEmittedJson = "";
      return;
    }
    if (nextJson === JSON.stringify(draft.value)) return;
    draft.value = clone(value);
    turtleDraft.value = value.semantic.source;
    history.value = [];
    future.value = [];
    applyDiagnostics.value = [];
    void refreshScene();
  },
  { deep: true },
);

watch(
  [
    () => props.catalog,
    () => props.layoutRegistry,
    () => props.assetAccess?.resolver,
    () => props.assetAccess?.policy,
    () => props.assetAccess?.revision,
  ],
  () => {
    applyDiagnostics.value = [];
    void refreshScene();
  },
  { deep: true },
);

watch(
  diagnostics,
  (value) => emit("validationChanged", clone(value)),
  { immediate: true },
);

void refreshScene();

onBeforeUnmount(() => {
  cancelAssetPicker();
  assetSceneSession.dispose();
});

async function refreshScene(): Promise<void> {
  const requestToken = ++sceneRequestToken;
  const assetRequest = assetSceneSession.begin();
  const document = clone(draft.value);
  const catalog = clone(props.catalog);
  const assetAccess = props.assetAccess;
  const viewId = document.views[0]?.viewId ?? "";
  sceneLoading.value = true;
  schemaDiagnostics.value = schemaDiagnosticsFor(document, catalog);

  if (schemaDiagnostics.value.some((item) => item.severity === "error")) {
    if (requestToken !== sceneRequestToken) return;
    const committed = assetSceneSession.commitWithoutAssets(
      assetRequest,
      emptyScene(viewId, schemaDiagnostics.value),
    );
    if (!committed.accepted) return;
    scene.value = committed.scene;
    sceneLoading.value = false;
    clearMissingSelection(scene.value);
    return;
  }

  try {
    const projected = await buildIriographView(
      document,
      viewId,
      projectionContext(catalog),
      "incremental",
    );
    if (requestToken !== sceneRequestToken) return;
    const result = assetAccess
      ? await assetSceneSession.enrich(assetRequest, projected, catalog.assets, assetAccess)
      : assetSceneSession.commitWithoutAssets(assetRequest, projected);
    if (requestToken !== sceneRequestToken || !result.accepted) return;
    scene.value = result.scene;
  } catch (cause) {
    if (requestToken !== sceneRequestToken) return;
    const committed = assetSceneSession.commitWithoutAssets(assetRequest, emptyScene(viewId, [{
      severity: "error",
      code: "scene-build-failed",
      message: cause instanceof Error ? cause.message : String(cause),
    }]));
    if (!committed.accepted) return;
    scene.value = committed.scene;
  } finally {
    if (requestToken === sceneRequestToken) {
      sceneLoading.value = false;
      clearMissingSelection(scene.value);
    }
  }
}

function projectionContext(catalog: ProjectionCatalogV1): ProjectionRuntimeContext {
  const catalogRef = `${catalog.catalogId}@${catalog.catalogVersion}`;
  return createProjectionRuntimeContext([{
    profileRef: catalog.profileRef,
    sourceCatalogRefs: [catalogRef],
    catalog,
    ruleOrigins: [],
  }], props.layoutRegistry ?? defaultLayoutRegistry);
}

function schemaDiagnosticsFor(
  document: IriographDocument,
  catalog: ProjectionCatalogV1,
): ProjectionDiagnostic[] {
  const documentResult = validateIriographDocumentV1(document);
  const catalogResult = validateProjectionCatalogV1(catalog);
  return [
    ...(documentResult.valid ? [] : documentResult.issues.map((issue) => schemaDiagnostic("document", issue))),
    ...(catalogResult.valid ? [] : catalogResult.issues.map((issue) => schemaDiagnostic("catalog", issue))),
  ];
}

function schemaDiagnostic(scope: "document" | "catalog", issue: RuntimeValidationIssue): ProjectionDiagnostic {
  return {
    severity: "error",
    code: `${scope}-schema-${issue.keyword}`,
    message: `${scope}${issue.instancePath || "/"}: ${issue.message}`,
  };
}

function clearMissingSelection(nextScene: DiagramScene): void {
  if (!selectedElementId.value) return;
  const exists = [
    ...nextScene.nodes,
    ...nextScene.containers,
    ...nextScene.edges,
  ].some((element) => element.elementId === selectedElementId.value);
  if (!exists) selectElement("");
}

function selectElement(elementId: string): void {
  if (elementId !== selectedElementId.value) cancelAssetPicker();
  selectedElementId.value = elementId;
  emit("selectionChanged", elementId);
}

function beginGesture(): void {
  gestureBefore ??= clone(draft.value);
}

function endGesture(): void {
  if (!gestureBefore) return;
  if (JSON.stringify(gestureBefore) !== JSON.stringify(draft.value)) {
    history.value.push(gestureBefore);
    trimHistory();
    future.value = [];
  }
  gestureBefore = undefined;
}

function changeGeometry(payload: { elementId: string; geometry: ElementGeometry }): void {
  mutateDocument((document) => {
    const element = geometryElement(payload.elementId);
    const view = document.views[0];
    if (!element || !view) return;
    const current = view.overlay[payload.elementId] ?? { semanticRef: element.semanticRef };
    view.overlay[payload.elementId] = {
      ...current,
      geometry: roundGeometry(payload.geometry),
      pinned: true,
      placement: "user",
    };
  }, false);
}

function changeRouting(payload: { elementId: string; waypoints: Point[] }): void {
  mutateDocument((document) => {
    const edge = scene.value.edges.find((candidate) => candidate.elementId === payload.elementId);
    const view = document.views[0];
    if (!edge || !view) return;
    const current = view.overlay[payload.elementId] ?? { semanticRef: edge.semanticRef };
    view.overlay[payload.elementId] = {
      ...current,
      pinned: true,
      placement: "user",
      routing: {
        ...current.routing,
        waypoints: payload.waypoints.map(roundPoint),
      },
    };
  }, false);
}

function updateGeometryField(field: keyof ElementGeometry, event: Event): void {
  const value = Number((event.target as HTMLInputElement).value);
  const element = selectedElement.value;
  if (!Number.isFinite(value) || !element || !("geometry" in element)) return;
  mutateDocument((document) => setGeometry(document, element, {
    ...element.geometry,
    [field]: value,
  }));
}

function updateTemplate(event: Event): void {
  const value = (event.target as HTMLSelectElement).value;
  updateAppearance("templateRef", value || undefined);
}

function updateIcon(event: Event): void {
  const element = selectedElement.value;
  const value = (event.target as HTMLInputElement).value;
  if (!value.trim()) {
    updateAppearance("iconRef", undefined);
    return;
  }
  const assetRef = normalizePickedAssetRef(value);
  if (!assetRef) {
    (event.target as HTMLInputElement).value = element?.structuralKind === "node"
      ? element.iconRef ?? ""
      : "";
    rejectInvalidAssetRef("入力されたicon refがabsolute IRIではありません。");
    return;
  }
  updateAppearance("iconRef", assetRef);
}

async function chooseAssetIcon(): Promise<void> {
  const picker = props.pickAsset;
  const element = selectedElement.value;
  if (!picker || !element || element.structuralKind !== "node" || props.readOnly) return;
  cancelAssetPicker();
  const requestToken = ++pickerRequestToken;
  const controller = new AbortController();
  pickerAbortController = controller;
  pickingAsset.value = true;
  const elementId = element.elementId;
  try {
    const result = await picker({
      currentAssetRef: element.iconRef,
      semanticRef: element.semanticRef,
      allowedMediaTypes: props.assetAccess?.policy.allowedMediaTypes
        ?? (["image/svg+xml", "image/png", "image/webp"] satisfies AssetMediaType[]),
      signal: controller.signal,
    });
    if (
      requestToken !== pickerRequestToken
      || controller.signal.aborted
      || selectedElementId.value !== elementId
      || result.status === "cancelled"
    ) return;
    const assetRef = normalizePickedAssetRef(result.assetRef);
    if (!assetRef) {
      rejectInvalidAssetRef("asset pickerがabsolute IRIを返しませんでした。", element.semanticRef);
      return;
    }
    updateAppearance("iconRef", assetRef);
  } catch (cause) {
    if (requestToken !== pickerRequestToken || controller.signal.aborted) return;
    applyDiagnostics.value = [{
      severity: "warning",
      code: "asset-picker-failed",
      message: cause instanceof Error ? cause.message : String(cause),
      semanticRef: element.semanticRef,
    }];
  } finally {
    if (requestToken === pickerRequestToken) {
      pickerAbortController = undefined;
      pickingAsset.value = false;
    }
  }
}

function rejectInvalidAssetRef(
  message: string,
  semanticRef = selectedElement.value?.semanticRef,
): void {
  applyDiagnostics.value = [{
    severity: "warning",
    code: "asset-ref-invalid",
    message,
    semanticRef,
  }];
}

function cancelAssetPicker(): void {
  pickerRequestToken += 1;
  pickerAbortController?.abort();
  pickerAbortController = undefined;
  pickingAsset.value = false;
}

function updateAppearance(
  field: "templateRef" | "iconRef",
  value: string | undefined,
): void {
  const element = selectedElement.value;
  if (!element || element.structuralKind === "edge") return;
  if (field === "iconRef") {
    applyDiagnostics.value = applyDiagnostics.value.filter(
      (diagnostic) => diagnostic.code !== "asset-ref-invalid",
    );
  }
  mutateDocument((document) => {
    const view = document.views[0];
    if (!view) return;
    const current = view.overlay[element.elementId] ?? { semanticRef: element.semanticRef };
    const appearance = { ...current.appearance, [field]: value };
    if (!value) delete appearance[field];
    view.overlay[element.elementId] = {
      ...current,
      appearance: Object.keys(appearance).length ? appearance : undefined,
    };
  });
}

function clearSelectedOverride(): void {
  const element = selectedElement.value;
  if (!element) return;
  mutateDocument((document) => {
    const view = document.views[0];
    const overlay = view?.overlay[element.elementId];
    if (!overlay) return;
    overlay.pinned = false;
    overlay.placement = "generated";
    if (element.structuralKind === "edge") delete overlay.routing;
  });
}

async function applyTurtleDraft(): Promise<boolean> {
  if (!turtlePending.value) return true;
  if (applyingTurtle.value) return false;
  const requestToken = ++semanticRequestToken;
  const previous = clone(draft.value);
  const previousJson = JSON.stringify(previous);
  const catalog = clone(props.catalog);
  schemaDiagnostics.value = schemaDiagnosticsFor(previous, catalog);
  if (schemaDiagnostics.value.some((item) => item.severity === "error")) return false;

  applyingTurtle.value = true;
  let result: SemanticSourceUpdate;
  try {
    result = await applySemanticSource(
      previous,
      turtleDraft.value,
      projectionContext(catalog),
    );
  } catch (cause) {
    if (requestToken !== semanticRequestToken) return false;
    applyDiagnostics.value = [{
      severity: "error",
      code: "semantic-transaction-failed",
      message: cause instanceof Error ? cause.message : String(cause),
    }];
    return false;
  } finally {
    if (requestToken === semanticRequestToken) applyingTurtle.value = false;
  }
  if (requestToken !== semanticRequestToken) return false;
  if (JSON.stringify(draft.value) !== previousJson) {
    applyDiagnostics.value = [{
      severity: "error",
      code: "semantic-transaction-stale",
      message: "編集中にdocumentが変更されたためTurtle transactionを適用しませんでした。",
    }];
    return false;
  }
  applyDiagnostics.value = result.diagnostics;
  if (!result.accepted) return false;
  publish(result.document, true);
  turtleDraft.value = result.document.semantic.source;
  return true;
}

function revertTurtleDraft(): void {
  turtleDraft.value = draft.value.semantic.source;
  applyDiagnostics.value = [];
  schemaDiagnostics.value = schemaDiagnosticsFor(draft.value, props.catalog);
}

function undo(): void {
  const previous = history.value.at(-1);
  if (!previous) return;
  history.value.pop();
  future.value.push(clone(draft.value));
  replaceDraft(previous, turtlePending.value);
}

function redo(): void {
  const next = future.value.at(-1);
  if (!next) return;
  future.value.pop();
  history.value.push(clone(draft.value));
  replaceDraft(next, turtlePending.value);
}

async function requestSave(): Promise<void> {
  if (!props.canSave || props.saving || !await flushPendingEdits()) return;
  emit("save");
}

async function flushPendingEdits(): Promise<boolean> {
  if (turtlePending.value) return applyTurtleDraft();
  await refreshScene();
  return !schemaDiagnostics.value.some((item) => item.severity === "error")
    && !scene.value.diagnostics.some((item) => item.severity === "error");
}

function handleKeydown(event: KeyboardEvent): void {
  const command = event.ctrlKey || event.metaKey;
  if (command && event.key.toLowerCase() === "s") {
    event.preventDefault();
    void requestSave();
    return;
  }
  if (isTextInput(event.target)) return;
  if (command && event.key.toLowerCase() === "z") {
    event.preventDefault();
    event.shiftKey ? redo() : undo();
    return;
  }
  if (command && event.key.toLowerCase() === "y") {
    event.preventDefault();
    redo();
    return;
  }
  const delta = event.shiftKey ? 10 : 1;
  const movements: Record<string, Point> = {
    ArrowLeft: { x: -delta, y: 0 },
    ArrowRight: { x: delta, y: 0 },
    ArrowUp: { x: 0, y: -delta },
    ArrowDown: { x: 0, y: delta },
  };
  const movement = movements[event.key];
  if (!movement) return;
  const element = selectedElement.value;
  if (!element || !("geometry" in element) || props.readOnly) return;
  event.preventDefault();
  mutateDocument((document) => setGeometry(document, element, {
    ...element.geometry,
    x: element.geometry.x + movement.x,
    y: element.geometry.y + movement.y,
  }));
}

function mutateDocument(
  mutation: (document: IriographDocument) => void,
  recordHistory = true,
): void {
  if (props.readOnly) return;
  const next = clone(draft.value);
  mutation(next);
  if (JSON.stringify(next) === JSON.stringify(draft.value)) return;
  publish(next, recordHistory);
}

function publish(next: IriographDocument, recordHistory: boolean): void {
  if (recordHistory) {
    history.value.push(clone(draft.value));
    trimHistory();
    future.value = [];
  }
  draft.value = clone(next);
  lastEmittedJson = JSON.stringify(draft.value);
  emit("update:modelValue", clone(draft.value));
  void refreshScene();
}

function replaceDraft(next: IriographDocument, preserveTurtleDraft = false): void {
  const pendingTurtle = turtleDraft.value;
  draft.value = clone(next);
  turtleDraft.value = preserveTurtleDraft ? pendingTurtle : next.semantic.source;
  applyDiagnostics.value = [];
  lastEmittedJson = JSON.stringify(draft.value);
  emit("update:modelValue", clone(draft.value));
  void refreshScene();
}

function setGeometry(
  document: IriographDocument,
  element: SceneNode | SceneContainer,
  geometry: ElementGeometry,
): void {
  const view = document.views[0];
  if (!view) return;
  const current = view.overlay[element.elementId] ?? { semanticRef: element.semanticRef };
  view.overlay[element.elementId] = {
    ...current,
    geometry: roundGeometry(geometry),
    pinned: true,
    placement: "user",
  };
}

function geometryElement(elementId: string): SceneNode | SceneContainer | undefined {
  return [...scene.value.nodes, ...scene.value.containers]
    .find((element) => element.elementId === elementId);
}

function trimHistory(): void {
  if (history.value.length > 100) history.value.splice(0, history.value.length - 100);
}

function setZoom(value: number): void {
  zoom.value = Math.min(1.6, Math.max(0.5, Math.round(value * 10) / 10));
}

function roundGeometry(geometry: ElementGeometry): ElementGeometry {
  return {
    x: Math.round(geometry.x),
    y: Math.round(geometry.y),
    width: Math.round(geometry.width),
    height: Math.round(geometry.height),
  };
}

function roundPoint(point: Point): Point {
  return { x: Math.round(point.x), y: Math.round(point.y) };
}

function compactRef(value: string): string {
  const segments = value.split(/[/:#]/).filter(Boolean);
  const last = segments.at(-1) ?? value;
  return /^v?\d+(?:\.\d+)*$/.test(last)
    ? segments.at(-2) ?? last
    : last;
}

function isTextInput(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
}

function emptyScene(
  viewId: string,
  diagnostics: ProjectionDiagnostic[] = [],
): DiagramScene {
  return {
    viewId,
    width: 1120,
    height: 680,
    nodes: [],
    containers: [],
    edges: [],
    diagnostics,
  };
}

function uniqueDiagnostic(): (diagnostic: ProjectionDiagnostic) => boolean {
  const seen = new Set<string>();
  return (diagnostic) => {
    const key = JSON.stringify([
      diagnostic.severity,
      diagnostic.code,
      diagnostic.message,
      diagnostic.semanticRef,
      diagnostic.statementRef,
      diagnostic.catalogRef,
      diagnostic.ruleId,
      diagnostic.assetRef,
    ]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  };
}

function clone<T>(value: T): T {
  // v-modelから受け取る値はVue Proxyになり得ます。documentはJSON contractなので、
  // cloneと同時にplain dataへ戻してeditor内部へProxyを持ち込みません。
  return JSON.parse(JSON.stringify(value)) as T;
}

defineExpose({
  flushPendingEdits,
  undo,
  redo,
  selectElement,
});
</script>

<template>
  <article class="iriograph-editor" tabindex="-1" @keydown="handleKeydown">
    <header v-if="!hideHeader" class="iriograph-editor-header">
      <div class="iriograph-editor-heading">
        <small>IRIOGRAPH DOCUMENT</small>
        <strong>{{ heading }}</strong>
        <span>{{ stateLabel }}</span>
      </div>
      <div class="iriograph-editor-header-status">
        <span :class="['iriograph-validation-pill', { error: errorCount > 0 }]">
          {{ errorCount > 0 ? `${errorCount} errors` : "Turtle valid" }}
        </span>
        <button type="button" :disabled="!canSave || saving || applyingTurtle" @click="requestSave">
          {{ saving ? "保存中…" : "保存" }}
        </button>
      </div>
    </header>

    <div class="iriograph-editor-layout">
      <aside class="iriograph-elements-panel">
        <section class="iriograph-view-summary">
          <small>ACTIVE VIEW</small>
          <strong>{{ activeView?.viewId ?? "No view" }}</strong>
          <code>{{ activeView?.profileRef }}</code>
          <div>
            <span><b>{{ scene.nodes.length }}</b> nodes</span>
            <span><b>{{ scene.edges.length }}</b> edges</span>
            <span><b>{{ scene.containers.length }}</b> areas</span>
          </div>
        </section>
        <nav class="iriograph-element-list" aria-label="Scene elements">
          <small>SCENE ELEMENTS <span>derived</span></small>
          <button
            v-for="container in scene.containers"
            :key="container.elementId"
            type="button"
            :class="{ active: selectedElementId === container.elementId }"
            @click="selectElement(container.elementId)"
          >
            <i>▣</i><span><b>{{ container.label }}</b><small>container</small></span>
          </button>
          <button
            v-for="node in scene.nodes"
            :key="node.elementId"
            type="button"
            :class="{ active: selectedElementId === node.elementId }"
            @click="selectElement(node.elementId)"
          >
            <i>●</i><span><b>{{ node.label }}</b><small>{{ compactRef(node.templateRef) }}</small></span>
          </button>
        </nav>
        <section class="iriograph-fallback-note">
          <b>Fallback enabled</b>
          <p>catalog未登録のIRI-object tripleは通常矢印になります。</p>
        </section>
      </aside>

      <main class="iriograph-main-surface">
        <nav class="iriograph-view-tabs" aria-label="Editor view">
          <button type="button" :class="{ active: panel === 'diagram' }" @click="panel = 'diagram'">◇ Diagram</button>
          <button type="button" :class="{ active: panel === 'turtle' }" @click="panel = 'turtle'">≡ Turtle</button>
          <button type="button" :class="{ active: panel === 'document' }" @click="panel = 'document'">{ } Document</button>
          <button type="button" :class="{ active: panel === 'catalog' }" @click="panel = 'catalog'">⌘ Catalog</button>
        </nav>

        <section v-if="panel === 'diagram'" class="iriograph-diagram-panel">
          <div class="iriograph-canvas-toolbar">
            <div class="iriograph-history-actions">
              <button type="button" :disabled="!canUndo || readOnly" title="Undo (Ctrl/Cmd+Z)" @click="undo">↶</button>
              <button type="button" :disabled="!canRedo || readOnly" title="Redo (Ctrl/Cmd+Y)" @click="redo">↷</button>
              <span />
              <small>{{ activeView?.layoutRef }}</small>
            </div>
            <div class="iriograph-zoom-actions">
              <button type="button" aria-label="縮小" @click="setZoom(zoom - 0.1)">−</button>
              <button type="button" class="zoom-value" @click="setZoom(1)">{{ Math.round(zoom * 100) }}%</button>
              <button type="button" aria-label="拡大" @click="setZoom(zoom + 0.1)">＋</button>
            </div>
          </div>
          <div
            v-if="sceneLoading || sceneError"
            class="iriograph-scene-status"
            :class="{ error: !sceneLoading && sceneError }"
            role="status"
            aria-live="polite"
          >
            <b>{{ sceneLoading ? "図を更新中…" : "図を表示できません" }}</b>
            <span v-if="!sceneLoading && sceneError">{{ sceneError.message }}</span>
          </div>
          <DiagramCanvas
            :scene="scene"
            :selected-element-id="selectedElementId"
            :zoom="zoom"
            :read-only="readOnly || sceneLoading || applyingTurtle"
            @select="selectElement"
            @gesture-start="beginGesture"
            @gesture-end="endGesture"
            @geometry-change="changeGeometry"
            @routing-change="changeRouting"
          />
        </section>

        <section v-else class="iriograph-source-panel">
          <header>
            <div>
              <small>{{ panel.toUpperCase() }}</small>
              <strong v-if="panel === 'turtle'">Semantic source</strong>
              <strong v-else-if="panel === 'document'">Portable document</strong>
              <strong v-else>Projection catalog</strong>
            </div>
            <span v-if="panel === 'turtle'">LLM-visible boundary</span>
            <span v-else-if="panel === 'document'">Turtle + sparse overlay</span>
            <span v-else>declarative source</span>
          </header>
          <template v-if="panel === 'turtle'">
            <textarea
              v-model="turtleDraft"
              :readonly="readOnly"
              spellcheck="false"
              aria-label="Turtle source"
            />
            <footer class="iriograph-source-actions">
              <div>
                <span v-if="errorCount" class="error">{{ errorCount }} error</span>
                <span v-if="warningCount">{{ warningCount }} warning</span>
                <span v-if="turtlePending">未適用のTurtle draft</span>
              </div>
              <div>
                <button type="button" :disabled="!turtlePending" @click="revertTurtleDraft">元に戻す</button>
                <button type="button" class="primary" :disabled="!turtlePending || readOnly || applyingTurtle" @click="applyTurtleDraft">
                  {{ applyingTurtle ? "適用中…" : "検証して適用" }}
                </button>
              </div>
            </footer>
            <ul v-if="diagnostics.length" class="iriograph-diagnostics">
              <li v-for="(diagnostic, index) in diagnostics" :key="`${diagnostic.code}:${index}`" :class="diagnostic.severity">
                <b>{{ diagnostic.code }}</b> {{ diagnostic.message }}
              </li>
            </ul>
          </template>
          <pre v-else><code>{{ panel === "document" ? documentJson : catalogJson }}</code></pre>
        </section>
      </main>

      <aside class="iriograph-inspector">
        <header>
          <div><small>INSPECTOR</small><strong>{{ selectedElement?.label ?? "No selection" }}</strong></div>
          <span v-if="selectedElement">{{ selectedElement.structuralKind }}</span>
        </header>
        <template v-if="selectedElement">
          <section>
            <label>Semantic reference</label>
            <code>{{ selectedElement.semanticRef }}</code>
          </section>
          <section>
            <label>Template</label>
            <select
              v-if="selectedElement.structuralKind !== 'edge'"
              :value="selectedElement.templateRef"
              :disabled="readOnly"
              @change="updateTemplate"
            >
              <option v-for="templateRef in nodeTemplateRefs" :key="templateRef" :value="templateRef">{{ compactRef(templateRef) }}</option>
            </select>
            <code v-else>{{ selectedElement.templateRef }}</code>
          </section>
          <section v-if="selectedElement.structuralKind === 'node'">
            <label>Icon IRI</label>
            <input
              list="iriograph-asset-refs"
              :value="selectedElement.iconRef ?? ''"
              :disabled="readOnly"
              placeholder="urn:example:icon:…"
              @change="updateIcon"
            />
            <datalist id="iriograph-asset-refs">
              <option v-for="assetRef in assetRefs" :key="assetRef" :value="assetRef" />
            </datalist>
            <button
              v-if="pickAsset"
              type="button"
              class="iriograph-wide-button"
              :disabled="readOnly || pickingAsset"
              @click="chooseAssetIcon"
            >
              {{ pickingAsset ? "assetを選択中…" : "Workspace assetを選択" }}
            </button>
          </section>
          <section v-if="'geometry' in selectedElement">
            <div class="iriograph-section-heading">
              <label>Geometry overlay</label>
              <span :class="selectedElement.placement">{{ selectedElement.placement }}</span>
            </div>
            <div class="iriograph-geometry-grid">
              <label v-for="field in (['x', 'y', 'width', 'height'] as const)" :key="field">
                <span>{{ field }}</span>
                <input
                  type="number"
                  :value="Math.round(selectedElement.geometry[field])"
                  :disabled="readOnly"
                  @change="updateGeometryField(field, $event)"
                />
              </label>
            </div>
          </section>
          <section v-if="selectedElement.structuralKind === 'edge'">
            <label>Projection</label>
            <div class="iriograph-edge-contract">
              <span>{{ selectedElement.sourceElementId }}</span><b>→</b><span>{{ selectedElement.targetElementId }}</span>
            </div>
            <p>{{ selectedElement.fallback ? "Core fallback arrow" : selectedElement.provenance?.rule?.ruleId ?? selectedElement.projectionRuleId }}</p>
          </section>
          <section v-if="selectedOverlay?.placement === 'user'">
            <button type="button" class="iriograph-wide-button" :disabled="readOnly" @click="clearSelectedOverride">ユーザー調整を解除</button>
          </section>
        </template>
        <section class="iriograph-overlay-preview">
          <div class="iriograph-section-heading"><label>View overlay</label><span>{{ Object.keys(activeView?.overlay ?? {}).length }}</span></div>
          <pre>{{ overlayJson }}</pre>
        </section>
      </aside>
    </div>
  </article>
</template>
