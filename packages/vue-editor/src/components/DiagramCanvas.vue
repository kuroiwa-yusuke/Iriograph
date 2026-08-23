<script setup lang="ts">
import { computed } from "vue";

import type {
  DiagramScene,
  ElementGeometry,
  Point,
  SceneContainer,
  SceneEdge,
  SceneNode,
} from "@iriograph/core";

type GeometryElement = SceneNode | SceneContainer;

const props = withDefaults(defineProps<{
  scene: DiagramScene;
  selectedElementId?: string;
  zoom?: number;
  readOnly?: boolean;
}>(), {
  selectedElementId: "",
  zoom: 1,
  readOnly: false,
});

const emit = defineEmits<{
  select: [elementId: string];
  gestureStart: [];
  gestureEnd: [];
  geometryChange: [payload: { elementId: string; geometry: ElementGeometry }];
  routingChange: [payload: { elementId: string; waypoints: Point[] }];
}>();

const nodesById = computed(() => new Map(props.scene.nodes.map((node) => [node.elementId, node])));
const containersById = computed(() => new Map(props.scene.containers.map((container) => [container.elementId, container])));
const selectedEdge = computed(() => props.scene.edges.find((edge) => edge.elementId === props.selectedElementId));

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
  if (props.readOnly || event.button !== 0 || resizeHandleTarget(event)) return;
  event.preventDefault();
  emit("select", element.elementId);
  emit("gestureStart");
  const origin = { x: event.clientX, y: event.clientY };
  const initial = { ...element.geometry };

  trackPointer((moveEvent) => {
    const next = {
      ...initial,
      x: initial.x + (moveEvent.clientX - origin.x) / props.zoom,
      y: initial.y + (moveEvent.clientY - origin.y) / props.zoom,
    };
    clampGeometry(next, element);
    emit("geometryChange", { elementId: element.elementId, geometry: next });
  });
}

function startResize(event: PointerEvent, element: GeometryElement): void {
  if (props.readOnly || event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  emit("select", element.elementId);
  emit("gestureStart");
  const origin = { x: event.clientX, y: event.clientY };
  const initial = { ...element.geometry };
  const minimum = element.structuralKind === "container"
    ? { width: 240, height: 120 }
    : { width: 44, height: 36 };

  trackPointer((moveEvent) => {
    const width = Math.max(minimum.width, initial.width + (moveEvent.clientX - origin.x) / props.zoom);
    const height = Math.max(minimum.height, initial.height + (moveEvent.clientY - origin.y) / props.zoom);
    emit("geometryChange", {
      elementId: element.elementId,
      geometry: {
        ...initial,
        width: Math.min(width, props.scene.width - initial.x - 8),
        height: Math.min(height, props.scene.height - initial.y - 8),
      },
    });
  });
}

function startWaypointMove(event: PointerEvent, edge: SceneEdge, index: number): void {
  if (props.readOnly || event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  emit("select", edge.elementId);
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

function trackPointer(onMove: (event: PointerEvent) => void): void {
  const handleEnd = (): void => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", handleEnd);
    emit("gestureEnd");
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", handleEnd, { once: true });
}

function clampGeometry(geometry: ElementGeometry, element: GeometryElement): void {
  const parent = element.structuralKind === "node" && element.parentElementId
    ? containersById.value.get(element.parentElementId)
    : undefined;
  if (parent) {
    const headerInset = parent.headerPosition === "left" ? 72 : 16;
    geometry.x = clamp(geometry.x, parent.geometry.x + headerInset + 12, parent.geometry.x + parent.geometry.width - geometry.width - 16);
    geometry.y = clamp(geometry.y, parent.geometry.y + 18, parent.geometry.y + parent.geometry.height - geometry.height - 18);
    return;
  }
  geometry.x = clamp(geometry.x, 8, props.scene.width - geometry.width - 8);
  geometry.y = clamp(geometry.y, 8, props.scene.height - geometry.height - 8);
}

function resizeHandleTarget(event: PointerEvent): boolean {
  return (event.target as HTMLElement | null)?.classList.contains("iriograph-resize-handle") ?? false;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(value, maximum));
}
</script>

<template>
  <div class="iriograph-canvas-scroll">
    <div
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
        @pointerdown.self="emit('select', '')"
      >
        <div class="iriograph-canvas-grid" />

        <button
          v-for="container in scene.containers"
          :key="container.elementId"
          type="button"
          class="iriograph-scene-container"
          :class="{ selected: selectedElementId === container.elementId }"
          :style="{
            left: `${container.geometry.x}px`,
            top: `${container.geometry.y}px`,
            width: `${container.geometry.width}px`,
            height: `${container.geometry.height}px`,
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
            v-if="selectedElementId === container.elementId && !readOnly"
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
            :class="{ selected: selectedElementId === edge.elementId, fallback: edge.fallback }"
            @click.stop="emit('select', edge.elementId)"
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
          :class="[
            `shape-${node.shape}`,
            {
              selected: selectedElementId === node.elementId,
              'user-placed': node.placement === 'user',
            },
          ]"
          :style="{
            left: `${node.geometry.x}px`,
            top: `${node.geometry.y}px`,
            width: `${node.geometry.width}px`,
            height: `${node.geometry.height}px`,
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
            v-if="selectedElementId === node.elementId && !readOnly"
            class="iriograph-resize-handle"
            title="nodeサイズを変更"
            @pointerdown="startResize($event, node)"
          />
        </button>
      </div>
    </div>
  </div>
</template>
