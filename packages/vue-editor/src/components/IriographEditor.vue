<script setup lang="ts">
import { computed, ref, watch } from "vue";

import {
  applySemanticSource,
  projectIriographDocument,
  validateIriographDocument,
  type AssetDefinition,
  type DiagramCatalog,
  type DiagramScene,
  type ElementGeometry,
  type IriographDocument,
  type Point,
  type ProjectionDiagnostic,
  type SceneContainer,
  type SceneEdge,
  type SceneNode,
  type ViewElementOverlay,
} from "@iriograph/core";

import DiagramCanvas from "./DiagramCanvas.vue";

type Panel = "diagram" | "turtle" | "document" | "catalog";
type SelectedElement = SceneNode | SceneContainer | SceneEdge;

const props = withDefaults(defineProps<{
  modelValue: IriographDocument;
  catalog: DiagramCatalog;
  title?: string;
  filePath?: string;
  dirty?: boolean;
  saving?: boolean;
  saveMessage?: string;
  canSave?: boolean;
  readOnly?: boolean;
  hideHeader?: boolean;
  resolveAssetUrl?: (
    assetRef: string,
    definition: AssetDefinition | undefined,
  ) => string | undefined;
}>(), {
  title: "",
  filePath: "",
  dirty: false,
  saving: false,
  saveMessage: "",
  canSave: true,
  readOnly: false,
  hideHeader: false,
  resolveAssetUrl: undefined,
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
const semanticDiagnostics = ref<ProjectionDiagnostic[]>([]);
let lastEmittedJson = "";
let gestureBefore: IriographDocument | undefined;

const scene = computed<DiagramScene>(() => projectIriographDocument(
  draft.value,
  props.catalog,
  undefined,
  { resolveAssetUrl: props.resolveAssetUrl },
));
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
  ...semanticDiagnostics.value,
  ...scene.value.diagnostics,
]);
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
    semanticDiagnostics.value = validateIriographDocument(value, props.catalog);
  },
  { deep: true },
);

watch(
  diagnostics,
  (value) => emit("validationChanged", clone(value)),
  { immediate: true },
);

function selectElement(elementId: string): void {
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
  const value = (event.target as HTMLInputElement).value.trim();
  updateAppearance("iconRef", value || undefined);
}

function updateAppearance(
  field: "templateRef" | "iconRef",
  value: string | undefined,
): void {
  const element = selectedElement.value;
  if (!element || element.structuralKind === "edge") return;
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

function applyTurtleDraft(): boolean {
  if (!turtlePending.value) return true;
  const result = applySemanticSource(draft.value, turtleDraft.value, props.catalog);
  semanticDiagnostics.value = result.diagnostics;
  if (!result.accepted) return false;
  publish(result.document, true);
  turtleDraft.value = result.document.semantic.source;
  if (selectedElementId.value && ![
    ...scene.value.nodes,
    ...scene.value.containers,
    ...scene.value.edges,
  ].some((element) => element.elementId === selectedElementId.value)) {
    selectElement("");
  }
  return true;
}

function revertTurtleDraft(): void {
  turtleDraft.value = draft.value.semantic.source;
  semanticDiagnostics.value = validateIriographDocument(draft.value, props.catalog);
}

function undo(): void {
  const previous = history.value.at(-1);
  if (!previous) return;
  history.value.pop();
  future.value.push(clone(draft.value));
  replaceDraft(previous);
}

function redo(): void {
  const next = future.value.at(-1);
  if (!next) return;
  future.value.pop();
  history.value.push(clone(draft.value));
  replaceDraft(next);
}

function requestSave(): void {
  if (!flushPendingEdits() || !props.canSave || props.saving) return;
  emit("save");
}

function flushPendingEdits(): boolean {
  return applyTurtleDraft();
}

function handleKeydown(event: KeyboardEvent): void {
  const command = event.ctrlKey || event.metaKey;
  if (command && event.key.toLowerCase() === "s") {
    event.preventDefault();
    requestSave();
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
}

function replaceDraft(next: IriographDocument): void {
  draft.value = clone(next);
  turtleDraft.value = next.semantic.source;
  semanticDiagnostics.value = validateIriographDocument(next, props.catalog);
  lastEmittedJson = JSON.stringify(draft.value);
  emit("update:modelValue", clone(draft.value));
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
        <button type="button" :disabled="!canSave || saving" @click="requestSave">
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
          <DiagramCanvas
            :scene="scene"
            :selected-element-id="selectedElementId"
            :zoom="zoom"
            :read-only="readOnly"
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
                <button type="button" class="primary" :disabled="!turtlePending || readOnly" @click="applyTurtleDraft">検証して適用</button>
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
            <p>{{ selectedElement.fallback ? "Core fallback arrow" : selectedElement.projectionRuleId }}</p>
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
