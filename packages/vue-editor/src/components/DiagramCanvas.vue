<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  watch,
} from "vue";

import type {
  DiagramScene,
  ElementGeometry,
  Point,
  SceneEdge,
} from "@iriograph/core";

import {
  diagramFitZoom,
  normalizeDiagramZoom,
  scrollToRevealBounds,
  type DiagramCanvasNavigationApi,
  type DiagramViewportMetrics,
} from "../viewport";
import {
  normalizeDiagramSnapSettings,
  resizeGeometryElement,
  selectedGeometryElements,
  translateSelection,
  type DiagramSelectionRequest,
  type DiagramSnapSettings,
  type GeometryChange,
  type GeometryElement,
} from "../selection";

const props = withDefaults(defineProps<{
  scene: DiagramScene;
  selectedElementId?: string;
  selectedElementIds?: string[];
  zoom?: number;
  readOnly?: boolean;
  snap?: DiagramSnapSettings;
}>(), {
  selectedElementId: "",
  selectedElementIds: () => [],
  zoom: 1,
  readOnly: false,
  snap: () => normalizeDiagramSnapSettings(),
});

const emit = defineEmits<{
  select: [elementId: string];
  selectionRequest: [request: DiagramSelectionRequest];
  zoomChange: [zoom: number];
  gestureStart: [];
  gestureEnd: [];
  geometryChange: [payload: { elementId: string; geometry: ElementGeometry }];
  resizeChange: [payload: { elementId: string; geometry: ElementGeometry }];
  geometryBatchChange: [payload: GeometryChange[]];
  routingChange: [payload: { elementId: string; waypoints: Point[] }];
}>();

const CANVAS_PADDING = 20;
const PAN_KEY_STEP = 64;
const scrollElement = ref<HTMLElement>();
const stageElement = ref<HTMLElement>();
const viewport = reactive<DiagramViewportMetrics>({
  scrollLeft: 0,
  scrollTop: 0,
  width: 0,
  height: 0,
});
const viewportPanning = ref(false);
const previewGeometries = ref<Record<string, ElementGeometry>>({});
let resizeObserver: ResizeObserver | undefined;
let stopViewportTracking: (() => void) | undefined;

const nodesById = computed(() => new Map(props.scene.nodes.map((node) => [
  node.elementId,
  { ...node, geometry: geometryFor(node) },
])));
const selectedElementIdsSet = computed(() => new Set([
  ...props.selectedElementIds,
  ...(props.selectedElementId ? [props.selectedElementId] : []),
]));
const selectedEdge = computed(() => props.scene.edges.find((edge) => edge.elementId === props.selectedElementId));
const minimapViewport = computed(() => {
  const offset = stageOffset();
  const x = clamp((viewport.scrollLeft - offset.x) / props.zoom, 0, props.scene.width);
  const y = clamp((viewport.scrollTop - offset.y) / props.zoom, 0, props.scene.height);
  return {
    x,
    y,
    width: Math.min(props.scene.width - x, viewport.width / props.zoom),
    height: Math.min(props.scene.height - y, viewport.height / props.zoom),
  };
});
const viewportLabel = computed(() => [
  `${Math.round(props.zoom * 100)}%`,
  `x ${Math.round(minimapViewport.value.x)}`,
  `y ${Math.round(minimapViewport.value.y)}`,
].join(" · "));

onMounted(() => {
  updateViewportMetrics();
  window.addEventListener("resize", updateViewportMetrics);
  if (typeof ResizeObserver !== "undefined" && scrollElement.value) {
    resizeObserver = new ResizeObserver(updateViewportMetrics);
    resizeObserver.observe(scrollElement.value);
  }
});

onBeforeUnmount(() => {
  window.removeEventListener("resize", updateViewportMetrics);
  resizeObserver?.disconnect();
  stopViewportTracking?.();
});

watch(
  () => [props.scene.width, props.scene.height, props.zoom],
  () => void nextTick(updateViewportMetrics),
);

watch(
  () => props.scene,
  () => {
    previewGeometries.value = {};
  },
);

function pathFor(edge: SceneEdge): string {
  const source = nodesById.value.get(edge.sourceElementId);
  const target = nodesById.value.get(edge.targetElementId);
  if (!source || !target) return "";
  const start = centerOf(source.geometry);
  const end = centerOf(target.geometry);
  if (edge.waypoints && edge.waypoints.length > 0) {
    return [start, ...edge.waypoints, end]
      .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
      .join(" ");
  }
  const bend = Math.max(44, Math.abs(end.x - start.x) * 0.42);
  const direction = end.x >= start.x ? 1 : -1;
  return `M ${start.x} ${start.y} C ${start.x + bend * direction} ${start.y}, ${end.x - bend * direction} ${end.y}, ${end.x} ${end.y}`;
}

function edgeLabelPosition(edge: SceneEdge): Point {
  if (edge.waypoints?.length) return edge.waypoints[Math.floor(edge.waypoints.length / 2)] ?? { x: 0, y: 0 };
  return defaultWaypoint(edge);
}

function editableWaypoints(edge: SceneEdge): Point[] {
  return edge.waypoints?.length ? edge.waypoints : [defaultWaypoint(edge)];
}

function defaultWaypoint(edge: SceneEdge): Point {
  const source = nodesById.value.get(edge.sourceElementId);
  const target = nodesById.value.get(edge.targetElementId);
  if (!source || !target) return { x: 0, y: 0 };
  const start = centerOf(source.geometry);
  const end = centerOf(target.geometry);
  return { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
}

function centerOf(geometry: ElementGeometry): Point {
  return {
    x: geometry.x + geometry.width / 2,
    y: geometry.y + geometry.height / 2,
  };
}

function startMove(event: PointerEvent, element: GeometryElement): void {
  if (event.button !== 0 || resizeHandleTarget(event)) return;
  event.preventDefault();
  const modifiedSelection = event.ctrlKey || event.metaKey || event.shiftKey;
  const alreadySelected = selectedElementIdsSet.value.has(element.elementId);
  requestSelection(selectionRequest(event, element.elementId, alreadySelected));
  if (modifiedSelection || props.readOnly) return;
  const initialScene = snapshotScene(props.scene);
  const movingElementIds = alreadySelected
    ? selectedGeometryElements(initialScene, [...selectedElementIdsSet.value])
      .map((candidate) => candidate.elementId)
    : [element.elementId];
  emit("gestureStart");
  const origin = { x: event.clientX, y: event.clientY };
  let pendingChanges: GeometryChange[] = [];

  trackPointer((moveEvent) => {
    pendingChanges = translateSelection(
      initialScene,
      movingElementIds,
      {
        x: (moveEvent.clientX - origin.x) / props.zoom,
        y: (moveEvent.clientY - origin.y) / props.zoom,
      },
      moveEvent.altKey
        ? {
            grid: { ...props.snap.grid, enabled: false },
            targets: { ...props.snap.targets, enabled: false },
          }
        : {
            ...props.snap,
            targets: {
              ...props.snap.targets,
              tolerance: props.snap.targets.tolerance / props.zoom,
            },
          },
    );
    previewGeometries.value = Object.fromEntries(
      pendingChanges.map((change) => [change.elementId, change.geometry]),
    );
  }, (cancelled) => {
    if (cancelled) {
      previewGeometries.value = {};
      return;
    }
    if (pendingChanges.length > 0) {
      emit("geometryBatchChange", pendingChanges);
      for (const change of pendingChanges) emit("geometryChange", change);
    }
  });
}

function startResize(event: PointerEvent, element: GeometryElement): void {
  if (props.readOnly || event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  requestSelection({ elementId: element.elementId, mode: "replace" });
  emit("gestureStart");
  const origin = { x: event.clientX, y: event.clientY };
  const initial = { ...element.geometry };

  trackPointer((moveEvent) => {
    const requestedWidth = initial.width + (moveEvent.clientX - origin.x) / props.zoom;
    const requestedHeight = initial.height + (moveEvent.clientY - origin.y) / props.zoom;
    const change = resizeGeometryElement(props.scene, element.elementId, {
      width: requestedWidth,
      height: requestedHeight,
    });
    if (!change) return;
    emit("resizeChange", change);
    emit("geometryChange", change);
  });
}

function startWaypointMove(event: PointerEvent, edge: SceneEdge, index: number): void {
  if (props.readOnly || event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  requestSelection({ elementId: edge.elementId, mode: "replace" });
  emit("gestureStart");
  const origin = { x: event.clientX, y: event.clientY };
  const initial = editableWaypoints(edge).map((point) => ({ ...point }));

  trackPointer((moveEvent) => {
    const waypoints = initial.map((point) => ({ ...point }));
    const waypoint = waypoints[index];
    if (!waypoint) return;
    waypoint.x = clamp(
      waypoint.x + (moveEvent.clientX - origin.x) / props.zoom,
      8,
      props.scene.width - 8,
    );
    waypoint.y = clamp(
      waypoint.y + (moveEvent.clientY - origin.y) / props.zoom,
      8,
      props.scene.height - 8,
    );
    emit("routingChange", { elementId: edge.elementId, waypoints });
  });
}

function startViewportPan(event: PointerEvent): void {
  const primaryOnBlank = event.button === 0 && isBlankCanvasTarget(event.target);
  const middleButton = event.button === 1;
  if (!primaryOnBlank && !middleButton) return;
  const element = scrollElement.value;
  if (!element) return;
  event.preventDefault();
  if (primaryOnBlank) requestSelection({ elementId: "", mode: "replace" });
  element.focus({ preventScroll: true });
  viewportPanning.value = true;
  const origin = { x: event.clientX, y: event.clientY };
  const initial = { x: element.scrollLeft, y: element.scrollTop };

  const handleMove = (moveEvent: PointerEvent): void => {
    setViewportScroll(
      initial.x - (moveEvent.clientX - origin.x),
      initial.y - (moveEvent.clientY - origin.y),
    );
  };
  const cleanup = (): void => {
    window.removeEventListener("pointermove", handleMove);
    window.removeEventListener("pointerup", cleanup);
    window.removeEventListener("pointercancel", cleanup);
    viewportPanning.value = false;
    if (stopViewportTracking === cleanup) stopViewportTracking = undefined;
  };
  stopViewportTracking?.();
  stopViewportTracking = cleanup;
  window.addEventListener("pointermove", handleMove);
  window.addEventListener("pointerup", cleanup, { once: true });
  window.addEventListener("pointercancel", cleanup, { once: true });
}

function handleViewportKeydown(event: KeyboardEvent): void {
  if (event.target !== scrollElement.value || event.ctrlKey || event.metaKey || event.altKey) return;
  handleNavigationKeydown(event);
}

function handleMinimapKeydown(event: KeyboardEvent): void {
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  handleNavigationKeydown(event);
}

function handleNavigationKeydown(event: KeyboardEvent): void {
  const pageX = Math.max(PAN_KEY_STEP, viewport.width * .8);
  const pageY = Math.max(PAN_KEY_STEP, viewport.height * .8);
  const movements: Record<string, Point> = {
    ArrowLeft: { x: -PAN_KEY_STEP, y: 0 },
    ArrowRight: { x: PAN_KEY_STEP, y: 0 },
    ArrowUp: { x: 0, y: -PAN_KEY_STEP },
    ArrowDown: { x: 0, y: PAN_KEY_STEP },
    PageUp: { x: event.shiftKey ? -pageX : 0, y: event.shiftKey ? 0 : -pageY },
    PageDown: { x: event.shiftKey ? pageX : 0, y: event.shiftKey ? 0 : pageY },
  };
  const movement = movements[event.key];
  if (!movement) return;
  event.preventDefault();
  event.stopPropagation();
  panBy(movement.x, movement.y);
}

function beginMinimapPan(event: PointerEvent): void {
  if (event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  const map = event.currentTarget as SVGSVGElement;
  centerFromMinimapEvent(map, event);
  const handleMove = (moveEvent: PointerEvent): void => centerFromMinimapEvent(map, moveEvent);
  const cleanup = (): void => {
    window.removeEventListener("pointermove", handleMove);
    window.removeEventListener("pointerup", cleanup);
    window.removeEventListener("pointercancel", cleanup);
    if (stopViewportTracking === cleanup) stopViewportTracking = undefined;
  };
  stopViewportTracking?.();
  stopViewportTracking = cleanup;
  window.addEventListener("pointermove", handleMove);
  window.addEventListener("pointerup", cleanup, { once: true });
  window.addEventListener("pointercancel", cleanup, { once: true });
}

function centerFromMinimapEvent(map: SVGSVGElement, event: PointerEvent): void {
  const bounds = map.getBoundingClientRect();
  if (bounds.width <= 0 || bounds.height <= 0) return;
  centerOn({
    x: clamp((event.clientX - bounds.left) / bounds.width, 0, 1) * props.scene.width,
    y: clamp((event.clientY - bounds.top) / bounds.height, 0, 1) * props.scene.height,
  });
}

function updateViewportMetrics(): void {
  const element = scrollElement.value;
  if (!element) return;
  viewport.scrollLeft = element.scrollLeft;
  viewport.scrollTop = element.scrollTop;
  viewport.width = element.clientWidth;
  viewport.height = element.clientHeight;
}

function setViewportScroll(left: number, top: number): void {
  const element = scrollElement.value;
  if (!element) return;
  const maximum = maximumScroll();
  element.scrollLeft = clamp(left, 0, maximum.x);
  element.scrollTop = clamp(top, 0, maximum.y);
  updateViewportMetrics();
}

function maximumScroll(): Point {
  const offset = stageOffset();
  return {
    x: Math.max(0, offset.x + props.scene.width * props.zoom + CANVAS_PADDING - viewport.width),
    y: Math.max(0, offset.y + props.scene.height * props.zoom + CANVAS_PADDING - viewport.height),
  };
}

function stageOffset(): Point {
  return {
    x: stageElement.value?.offsetLeft ?? CANVAS_PADDING,
    y: stageElement.value?.offsetTop ?? CANVAS_PADDING,
  };
}

function panBy(deltaX: number, deltaY: number): void {
  setViewportScroll(viewport.scrollLeft + deltaX, viewport.scrollTop + deltaY);
}

async function zoomTo(value: number): Promise<void> {
  updateViewportMetrics();
  const offset = stageOffset();
  const center = {
    x: clamp(
      (viewport.scrollLeft - offset.x + viewport.width / 2) / props.zoom,
      0,
      props.scene.width,
    ),
    y: clamp(
      (viewport.scrollTop - offset.y + viewport.height / 2) / props.zoom,
      0,
      props.scene.height,
    ),
  };
  emit("zoomChange", normalizeDiagramZoom(value));
  await nextTick();
  updateViewportMetrics();
  centerOn(center);
}

async function fitToView(): Promise<void> {
  updateViewportMetrics();
  emit("zoomChange", diagramFitZoom(props.scene, viewport));
  await nextTick();
  updateViewportMetrics();
  centerOn({ x: props.scene.width / 2, y: props.scene.height / 2 });
}

function centerOn(point: Point): void {
  const offset = stageOffset();
  setViewportScroll(
    offset.x + point.x * props.zoom - viewport.width / 2,
    offset.y + point.y * props.zoom - viewport.height / 2,
  );
}

async function revealElement(elementId: string): Promise<boolean> {
  await nextTick();
  updateViewportMetrics();
  const bounds = elementBounds(elementId);
  if (!bounds) return false;
  const next = scrollToRevealBounds(bounds, props.zoom, viewport, stageOffset());
  setViewportScroll(next.x, next.y);
  return true;
}

function elementBounds(elementId: string): ElementGeometry | undefined {
  const geometryElement = [
    ...props.scene.nodes,
    ...props.scene.containers,
  ].find((element) => element.elementId === elementId);
  if (geometryElement) return geometryElement.geometry;
  const edge = props.scene.edges.find((candidate) => candidate.elementId === elementId);
  if (!edge) return undefined;
  const source = nodesById.value.get(edge.sourceElementId);
  const target = nodesById.value.get(edge.targetElementId);
  if (!source || !target) return undefined;
  const points = [centerOf(source.geometry), ...(edge.waypoints ?? []), centerOf(target.geometry)];
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  return {
    x: left,
    y: top,
    width: Math.max(1, Math.max(...xs) - left),
    height: Math.max(1, Math.max(...ys) - top),
  };
}

function isBlankCanvasTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return !target.closest([
    ".iriograph-scene-node",
    ".iriograph-scene-container",
    ".iriograph-edge-group",
    ".iriograph-waypoints",
    ".iriograph-resize-handle",
  ].join(","));
}

function trackPointer(
  onMove: (event: PointerEvent) => void,
  onEnd?: (cancelled: boolean) => void,
): void {
  const handleEnd = (event: PointerEvent): void => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", handleEnd);
    window.removeEventListener("pointercancel", handleEnd);
    onEnd?.(event.type === "pointercancel");
    emit("gestureEnd");
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", handleEnd, { once: true });
  window.addEventListener("pointercancel", handleEnd, { once: true });
}

function resizeHandleTarget(event: PointerEvent): boolean {
  return (event.target as HTMLElement | null)?.classList.contains("iriograph-resize-handle") ?? false;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(value, maximum));
}

function selectionRequest(
  event: PointerEvent | MouseEvent,
  elementId: string,
  alreadySelected: boolean,
): DiagramSelectionRequest {
  if (event.ctrlKey || event.metaKey) return { elementId, mode: "toggle" };
  if (event.shiftKey) return { elementId, mode: "add" };
  return { elementId, mode: alreadySelected ? "preserve" : "replace" };
}

function selectEdge(event: MouseEvent, edge: SceneEdge): void {
  requestSelection(selectionRequest(
    event,
    edge.elementId,
    selectedElementIdsSet.value.has(edge.elementId),
  ));
}

function requestSelection(request: DiagramSelectionRequest): void {
  emit("select", request.elementId);
  emit("selectionRequest", request);
}

function geometryFor(element: GeometryElement): ElementGeometry {
  return previewGeometries.value[element.elementId] ?? element.geometry;
}

function snapshotScene(scene: DiagramScene): DiagramScene {
  return {
    ...scene,
    nodes: scene.nodes.map((node) => ({ ...node, geometry: { ...node.geometry } })),
    containers: scene.containers.map((container) => ({
      ...container,
      geometry: { ...container.geometry },
    })),
    edges: scene.edges.map((edge) => ({
      ...edge,
      waypoints: edge.waypoints?.map((point) => ({ ...point })),
    })),
    diagnostics: [...scene.diagnostics],
  };
}

defineExpose<DiagramCanvasNavigationApi>({
  panBy,
  zoomTo,
  fitToView,
  revealElement,
  centerOn,
});
</script>

<template>
  <div class="iriograph-canvas-shell" :class="{ panning: viewportPanning }">
    <div
      ref="scrollElement"
      class="iriograph-canvas-scroll"
      tabindex="0"
      aria-label="Diagram viewport"
      @scroll="updateViewportMetrics"
      @keydown="handleViewportKeydown"
      @pointerdown="startViewportPan"
    >
      <div
        ref="stageElement"
        class="iriograph-canvas-stage"
        :style="{ width: `${scene.width * zoom}px`, height: `${scene.height * zoom}px` }"
      >
        <div
          class="iriograph-diagram-canvas"
          :style="{
            width: `${scene.width}px`,
            height: `${scene.height}px`,
            transform: `scale(${zoom})`,
          }"
        >
          <div class="iriograph-canvas-grid" />

          <button
            v-for="container in scene.containers"
            :key="container.elementId"
            type="button"
            class="iriograph-scene-container"
            :data-element-id="container.elementId"
            :data-parent-element-id="container.parentElementId ?? ''"
            :data-header-position="container.headerPosition"
            :class="{ selected: selectedElementIdsSet.has(container.elementId) }"
            :style="{
              left: `${geometryFor(container).x}px`,
              top: `${geometryFor(container).y}px`,
              width: `${geometryFor(container).width}px`,
              height: `${geometryFor(container).height}px`,
              background: container.style.fill,
              borderColor: container.style.stroke,
              color: container.style.text,
            }"
            @pointerdown="startMove($event, container)"
          >
            <span
              class="iriograph-container-header"
              :class="`header-${container.headerPosition}`"
              :style="{ background: container.style.accent }"
            >
              {{ container.label }}
            </span>
            <span
              v-if="selectedElementIdsSet.size === 1 && selectedElementId === container.elementId && !readOnly"
              class="iriograph-resize-handle"
              title="領域サイズを変更"
              @pointerdown="startResize($event, container)"
            />
          </button>

          <svg
            class="iriograph-edge-layer"
            :width="scene.width"
            :height="scene.height"
            :viewBox="`0 0 ${scene.width} ${scene.height}`"
            aria-label="関係edge"
          >
            <defs>
              <marker id="iriograph-arrow" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto" markerUnits="strokeWidth">
                <path d="M0,0 L9,4.5 L0,9 z" fill="context-stroke" />
              </marker>
            </defs>
            <g
              v-for="edge in scene.edges"
              :key="edge.elementId"
              class="iriograph-edge-group"
              :class="{ selected: selectedElementIdsSet.has(edge.elementId), fallback: edge.fallback }"
              @click.stop="selectEdge($event, edge)"
            >
              <path class="iriograph-edge-hitarea" :d="pathFor(edge)" />
              <path
                class="iriograph-edge-path"
                :d="pathFor(edge)"
                :stroke="edge.style.stroke"
                :stroke-dasharray="edge.style.dash"
                marker-end="url(#iriograph-arrow)"
              />
              <text
                v-if="edge.label"
                class="iriograph-edge-label"
                :x="edgeLabelPosition(edge).x"
                :y="edgeLabelPosition(edge).y - 9"
                :fill="edge.style.text"
                text-anchor="middle"
              >
                {{ edge.label }}
              </text>
            </g>
            <g v-if="selectedEdge && !readOnly" class="iriograph-waypoints">
              <circle
                v-for="(point, index) in editableWaypoints(selectedEdge)"
                :key="index"
                :cx="point.x"
                :cy="point.y"
                r="6"
                tabindex="0"
                @pointerdown="startWaypointMove($event, selectedEdge, index)"
              />
            </g>
          </svg>

          <button
            v-for="node in scene.nodes"
            :key="node.elementId"
            type="button"
            class="iriograph-scene-node"
            :data-element-id="node.elementId"
            :data-parent-element-id="node.parentElementId ?? ''"
            :class="[
              `shape-${node.shape}`,
              {
                selected: selectedElementIdsSet.has(node.elementId),
                'user-placed': node.placement === 'user',
              },
            ]"
            :style="{
              left: `${geometryFor(node).x}px`,
              top: `${geometryFor(node).y}px`,
              width: `${geometryFor(node).width}px`,
              height: `${geometryFor(node).height}px`,
              background: node.style.fill,
              borderColor: node.style.stroke,
              color: node.style.text,
              '--iriograph-node-accent': node.style.accent ?? node.style.stroke,
            }"
            :aria-label="`${node.label}を選択`"
            @pointerdown="startMove($event, node)"
          >
            <span class="iriograph-node-content">
              <img v-if="node.iconUrl" class="iriograph-node-icon" :src="node.iconUrl" alt="" draggable="false" />
              <span class="iriograph-node-label">{{ node.label }}</span>
            </span>
            <span v-if="node.shape === 'diamond'" class="iriograph-gateway-mark">×</span>
            <span v-if="node.placement === 'user'" class="iriograph-pin-indicator" title="ユーザー調整済み">●</span>
            <span
              v-if="selectedElementIdsSet.size === 1 && selectedElementId === node.elementId && !readOnly"
              class="iriograph-resize-handle"
              title="nodeサイズを変更"
              @pointerdown="startResize($event, node)"
            />
          </button>
        </div>
      </div>
    </div>

    <aside class="iriograph-minimap" aria-label="Diagram minimap">
      <svg
        :viewBox="`0 0 ${scene.width} ${scene.height}`"
        preserveAspectRatio="none"
        tabindex="0"
        aria-label="Minimapでviewportを移動"
        @keydown="handleMinimapKeydown"
        @pointerdown="beginMinimapPan"
      >
        <rect class="iriograph-minimap-paper" x="0" y="0" :width="scene.width" :height="scene.height" />
        <rect
          v-for="container in scene.containers"
          :key="container.elementId"
          class="iriograph-minimap-container"
          :x="geometryFor(container).x"
          :y="geometryFor(container).y"
          :width="geometryFor(container).width"
          :height="geometryFor(container).height"
        />
        <path
          v-for="edge in scene.edges"
          :key="edge.elementId"
          class="iriograph-minimap-edge"
          :d="pathFor(edge)"
        />
        <rect
          v-for="node in scene.nodes"
          :key="node.elementId"
          class="iriograph-minimap-node"
          :x="geometryFor(node).x"
          :y="geometryFor(node).y"
          :width="geometryFor(node).width"
          :height="geometryFor(node).height"
        />
        <rect
          class="iriograph-minimap-viewport"
          :x="minimapViewport.x"
          :y="minimapViewport.y"
          :width="minimapViewport.width"
          :height="minimapViewport.height"
        />
      </svg>
      <span>{{ viewportLabel }}</span>
    </aside>
  </div>
</template>
