<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  useId,
  watch,
} from "vue";

import type {
  DiagramScene,
  EdgeEndpointShape,
  ElementGeometry,
  Point,
  ProjectionDiagnostic,
  SceneContainer,
  SceneEdge,
  SceneNode,
} from "@iriograph/core";
import {
  diagnosticTargetsSceneElement,
  edgeEndpointAnchorFromPoint,
  edgeEndpointAnchorPoint,
} from "@iriograph/core";

import {
  appendEdgeWaypoint,
  derivedEdgeRoute,
  editableEdgeWaypoints,
  edgeLabelBase,
  insertEdgeWaypoint,
  moveEdgeWaypoint,
  previewEdgeRoute,
  removeEdgeWaypoint,
  routingWithLabelOffset,
  routingWithEndpointAnchor,
  routingWithWaypoints,
  type EditableEdgeRouting,
  type EdgeRoutingUpdate,
} from "../edge-routing";
import {
  moveSceneNavigatorFocus,
  restoreSceneNavigatorFocus,
  sceneNavigatorItems,
  sceneNavigatorRange,
  type SceneNavigatorItem,
} from "../scene-navigation";
import {
  keyboardArrowMovement,
  resolveCanvasKeyboardCommand,
} from "../keyboard-commands";
import {
  diagramFitZoom,
  normalizeDiagramZoom,
  scrollToRevealBounds,
  type DiagramCanvasNavigationApi,
  type DiagramViewportMetrics,
  type DiagramViewportState,
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
  semanticPositionPicking?: boolean;
  semanticResourcePicking?: boolean;
  semanticResourcePickLabel?: string;
  semanticDraftPosition?: Point;
  containmentWarningElementIds?: string[];
  busy?: boolean;
}>(), {
  selectedElementId: "",
  selectedElementIds: () => [],
  zoom: 1,
  readOnly: false,
  snap: () => normalizeDiagramSnapSettings(),
  semanticPositionPicking: false,
  semanticResourcePicking: false,
  semanticResourcePickLabel: "resource",
  semanticDraftPosition: undefined,
  containmentWarningElementIds: () => [],
  busy: false,
});

const emit = defineEmits<{
  select: [elementId: string];
  selectionRequest: [request: DiagramSelectionRequest];
  selectionSetRequest: [elementIds: string[]];
  zoomChange: [zoom: number];
  gestureStart: [];
  gestureEnd: [];
  geometryChange: [payload: { elementId: string; geometry: ElementGeometry }];
  resizeChange: [payload: { elementId: string; geometry: ElementGeometry }];
  geometryBatchChange: [payload: GeometryChange[]];
  routingUpdate: [payload: EdgeRoutingUpdate];
  /** Seeds a semantic authoring draft; it never mutates the graph directly. */
  semanticEditRequest: [elementId: string];
  /** Seeds draft coordinates only; it never mutates the graph or history. */
  semanticPositionRequest: [position: Point, containerIri?: string];
  /** Explicit picker mode only; normal selection and drag never emit this. */
  semanticResourceRequest: [semanticRef: string];
  semanticPickCancel: [];
  /** @deprecated Use routingUpdate for the complete sparse routing value. */
  routingChange: [payload: { elementId: string; waypoints: Point[] }];
}>();

const CANVAS_PADDING = 20;
const PAN_KEY_STEP = 64;
const instanceId = useId();
const arrowMarkerId = `${instanceId}-arrow`;
const scrollElement = ref<HTMLElement>();
const stageElement = ref<HTMLElement>();
const edgeLayerElement = ref<SVGSVGElement>();
const viewport = reactive<DiagramViewportMetrics>({
  scrollLeft: 0,
  scrollTop: 0,
  width: 0,
  height: 0,
});
const viewportPanning = ref(false);
const previewGeometries = ref<Record<string, ElementGeometry>>({});
const previewRouting = ref<Record<string, EditableEdgeRouting | null>>({});
const navigatorItems = computed(() => sceneNavigatorItems(props.scene));
const activeNavigatorElementId = ref("");
const navigatorAnchorElementId = ref("");
const activeWaypointIndex = ref(0);
const liveAnnouncement = ref("");
const compositionActive = ref(false);
let previousNavigatorItems: SceneNavigatorItem[] = [];
let keyboardGesture: KeyboardGesture | undefined;
let resizeObserver: ResizeObserver | undefined;
let stopViewportTracking: (() => void) | undefined;

type KeyboardGesture = {
  kind: "move" | "resize" | "waypoint" | "label" | "waypoint-add" | "waypoint-remove";
  elementId: string;
  commitKey: string;
  initialScene: DiagramScene;
  delta: Point;
  geometryChanges?: GeometryChange[];
  routing?: EditableEdgeRouting;
};

const originalEndpointElementsById = computed(() => new Map(
  [...props.scene.containers, ...props.scene.nodes].map((element) => [element.elementId, element]),
));
const endpointElementsById = computed(() => new Map(
  [...props.scene.containers, ...props.scene.nodes].map((element) => [
    element.elementId,
    { ...element, geometry: geometryFor(element) },
  ]),
));
const selectedElementIdsSet = computed(() => new Set([
  ...props.selectedElementIds,
  ...(props.selectedElementId ? [props.selectedElementId] : []),
]));
const containmentWarningElementIdsSet = computed(() => new Set(
  props.containmentWarningElementIds,
));
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

type DiagnosticElement = SceneNode | SceneContainer | SceneEdge;

function diagnosticsForElement(element: DiagnosticElement): ProjectionDiagnostic[] {
  return props.scene.diagnostics.filter((diagnostic) => (
    diagnosticTargetsSceneElement(diagnostic, element)
  ));
}

function diagnosticClass(element: DiagnosticElement): Record<string, boolean> {
  const diagnostics = diagnosticsForElement(element);
  return {
    "diagnostic-error": diagnostics.some((diagnostic) => diagnostic.severity === "error"),
    "diagnostic-warning": diagnostics.some((diagnostic) => diagnostic.severity === "warning"),
  };
}

function diagnosticAriaSuffix(element: DiagnosticElement): string {
  const diagnostics = diagnosticsForElement(element);
  const diagnostic = diagnostics.length > 0 ? `、診断${diagnostics.length}件` : "";
  const containment = containmentWarningElementIdsSet.value.has(element.elementId)
    ? "、表示と意味の包含が不一致"
    : "";
  return `${diagnostic}${containment}`;
}

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
  if (keyboardGesture) cancelKeyboardGesture();
  else clearKeyboardPreview();
});

watch(
  () => [props.scene.width, props.scene.height, props.zoom],
  () => void nextTick(updateViewportMetrics),
);

watch(
  () => props.scene,
  () => {
    // A host-driven Scene replacement invalidates the gesture snapshot. Do
    // not let a later keyup commit geometry or routing derived from stale IDs.
    if (keyboardGesture) cancelKeyboardGesture();
    else clearKeyboardPreview();
    if (props.semanticPositionPicking || props.semanticResourcePicking) emit("semanticPickCancel");
  },
);

watch(() => props.readOnly, (readOnly) => {
  // Permission can change while a key is held. Pending presentation writes
  // are discarded at that boundary, while navigation remains available.
  if (readOnly && keyboardGesture) cancelKeyboardGesture();
});

watch(navigatorItems, (nextItems) => {
  activeNavigatorElementId.value = restoreSceneNavigatorFocus(
    previousNavigatorItems,
    nextItems,
    activeNavigatorElementId.value,
    props.selectedElementId,
  );
  previousNavigatorItems = [...nextItems];
}, { immediate: true });

watch(() => props.selectedElementId, (elementId) => {
  if (!elementId || !navigatorItems.value.some((item) => item.elementId === elementId)) return;
  activeNavigatorElementId.value = elementId;
  navigatorAnchorElementId.value = elementId;
  if (props.scene.edges.some((edge) => edge.elementId === elementId)) activeWaypointIndex.value = 0;
});

function pathFor(edge: SceneEdge): string {
  const derivedRoute = previewedDerivedRoute(edge);
  if (derivedRoute.length >= 2) return polylinePath(renderedRoute(edge));
  const source = endpointElementsById.value.get(edge.sourceElementId);
  const target = endpointElementsById.value.get(edge.targetElementId);
  if (!source || !target) return "";
  const start = centerOf(source.geometry);
  const end = centerOf(target.geometry);
  if (edge.waypoints && edge.waypoints.length > 0) {
    return polylinePath([start, ...edge.waypoints, end]);
  }
  const bend = Math.max(44, Math.abs(end.x - start.x) * 0.42);
  const direction = end.x >= start.x ? 1 : -1;
  return `M ${start.x} ${start.y} C ${start.x + bend * direction} ${start.y}, ${end.x - bend * direction} ${end.y}, ${end.x} ${end.y}`;
}

function edgeLabelPosition(edge: SceneEdge): Point {
  const base = edgeLabelBase({ route: renderedRoute(edge) });
  const preview = previewRouting.value[edge.elementId];
  const labelOffset = preview === undefined ? edge.labelOffset : preview?.labelOffset;
  return {
    x: base.x + (labelOffset?.x ?? 0),
    y: base.y + (labelOffset?.y ?? 0),
  };
}

function editableWaypoints(edge: SceneEdge): Point[] {
  const preview = previewRouting.value[edge.elementId];
  if (preview !== undefined) return preview?.waypoints?.map((point) => ({ ...point })) ?? [];
  return editableEdgeWaypoints({ route: renderedRoute(edge), waypoints: edge.waypoints });
}

function renderedRoute(edge: SceneEdge): Point[] {
  const route = previewedDerivedRoute(edge);
  const preview = previewRouting.value[edge.elementId];
  let result = route;
  if (preview !== undefined && route.length >= 2 && preview?.waypoints) {
    result = [route[0]!, ...preview.waypoints, route.at(-1)!];
  }
  const source = endpointElementsById.value.get(edge.sourceElementId);
  const target = endpointElementsById.value.get(edge.targetElementId);
  if (result.length >= 2) {
    result = result.map((point) => ({ ...point }));
    const sourceAnchor = preview === undefined ? edge.sourceAnchor : preview?.sourceAnchor;
    const targetAnchor = preview === undefined ? edge.targetAnchor : preview?.targetAnchor;
    if (source && sourceAnchor) {
      result[0] = edgeEndpointAnchorPoint(
        source.geometry,
        endpointElementShape(source),
        sourceAnchor,
      );
    }
    if (target && targetAnchor) {
      result[result.length - 1] = edgeEndpointAnchorPoint(
        target.geometry,
        endpointElementShape(target),
        targetAnchor,
      );
    }
    return result;
  }
  if (!source || !target) return [];
  const start = centerOf(source.geometry);
  const end = centerOf(target.geometry);
  return [start, ...(edge.waypoints ?? []), end];
}

function previewedDerivedRoute(edge: SceneEdge): Point[] {
  const route = derivedEdgeRoute(edge);
  if (route.length < 2) return route;
  const sourceOriginal = originalEndpointElementsById.value.get(edge.sourceElementId);
  const targetOriginal = originalEndpointElementsById.value.get(edge.targetElementId);
  const sourcePreview = endpointElementsById.value.get(edge.sourceElementId);
  const targetPreview = endpointElementsById.value.get(edge.targetElementId);
  if (!sourceOriginal || !targetOriginal || !sourcePreview || !targetPreview) return route;
  return previewEdgeRoute(
    edge,
    { original: sourceOriginal.geometry, preview: sourcePreview.geometry },
    { original: targetOriginal.geometry, preview: targetPreview.geometry },
  );
}

function endpointElementShape(element: SceneNode | SceneContainer): EdgeEndpointShape {
  return element.structuralKind === "container" ? "container" : element.shape;
}

function endpointAnchorHandlePoint(
  edge: SceneEdge,
  endpoint: "source" | "target",
): Point {
  const route = renderedRoute(edge);
  return endpoint === "source"
    ? route[0] ?? { x: 0, y: 0 }
    : route.at(-1) ?? { x: 0, y: 0 };
}

function polylinePath(points: readonly Point[]): string {
  return points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
    .join(" ");
}

function centerOf(geometry: ElementGeometry): Point {
  return {
    x: geometry.x + geometry.width / 2,
    y: geometry.y + geometry.height / 2,
  };
}

function startMove(event: PointerEvent, element: GeometryElement): void {
  if (event.button !== 0 || resizeHandleTarget(event)) return;
  if (props.semanticResourcePicking) {
    event.preventDefault();
    event.stopPropagation();
    if (!props.readOnly) emit("semanticResourceRequest", element.semanticRef);
    return;
  }
  if (props.semanticPositionPicking) {
    event.preventDefault();
    event.stopPropagation();
    if (
      !props.readOnly
      && element.structuralKind === "container"
      && event.target === event.currentTarget
    ) {
      const position = semanticPositionAt(event);
      if (position) emit("semanticPositionRequest", position, element.semanticRef);
    }
    return;
  }
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
  const initial = editableWaypoints(edge);

  trackPointer((moveEvent) => {
    const waypoints = moveEdgeWaypoint(initial, index, {
      x: (moveEvent.clientX - origin.x) / props.zoom,
      y: (moveEvent.clientY - origin.y) / props.zoom,
    }, { width: props.scene.width, height: props.scene.height, padding: 8 });
    emitWaypointRouting(edge, waypoints);
  });
}

function startLabelMove(event: PointerEvent, edge: SceneEdge): void {
  requestSelection({ elementId: edge.elementId, mode: "replace" });
  if (props.readOnly || event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  emit("gestureStart");
  const origin = { x: event.clientX, y: event.clientY };
  const initial = { x: edge.labelOffset?.x ?? 0, y: edge.labelOffset?.y ?? 0 };
  trackPointer((moveEvent) => {
    emitLabelRouting(edge, {
      x: initial.x + (moveEvent.clientX - origin.x) / props.zoom,
      y: initial.y + (moveEvent.clientY - origin.y) / props.zoom,
    });
  });
}

function startEndpointAnchorMove(
  event: PointerEvent,
  edge: SceneEdge,
  endpoint: "source" | "target",
): void {
  if (props.readOnly || event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  requestSelection({ elementId: edge.elementId, mode: "replace" });
  const elementId = endpoint === "source" ? edge.sourceElementId : edge.targetElementId;
  const element = endpointElementsById.value.get(elementId);
  if (!element) return;
  emit("gestureStart");
  let pending: EditableEdgeRouting | undefined;
  trackPointer((moveEvent) => {
    const point = canvasPoint(moveEvent);
    if (!point) return;
    pending = routingWithEndpointAnchor(
      edge,
      endpoint,
      edgeEndpointAnchorFromPoint(element.geometry, point),
    );
    previewRouting.value = {
      ...previewRouting.value,
      [edge.elementId]: pending ?? null,
    };
  }, (cancelled) => {
    previewRouting.value = { ...previewRouting.value };
    delete previewRouting.value[edge.elementId];
    if (!cancelled && pending) {
      emit("routingUpdate", { elementId: edge.elementId, routing: pending });
    }
  });
}

function addWaypointAtPointer(event: MouseEvent, edge: SceneEdge): void {
  requestSelection({ elementId: edge.elementId, mode: "replace" });
  if (props.readOnly) return;
  const requested = canvasPoint(event);
  if (!requested) return;
  event.preventDefault();
  emit("gestureStart");
  emitWaypointRouting(edge, insertEdgeWaypoint({
    route: renderedRoute(edge),
    waypoints: edge.waypoints,
  }, clampPointToScene(requested)));
  emit("gestureEnd");
}

function handleWaypointKeydown(event: KeyboardEvent, edge: SceneEdge, index: number): void {
  if (props.readOnly) return;
  const waypoints = editableWaypoints(edge);
  if (event.key === "Delete" || event.key === "Backspace") {
    event.preventDefault();
    event.stopPropagation();
    emit("gestureStart");
    emitWaypointRouting(edge, removeEdgeWaypoint(waypoints, index));
    emit("gestureEnd");
    return;
  }
  const step = event.shiftKey ? 10 : 1;
  const movements: Record<string, Point> = {
    ArrowLeft: { x: -step, y: 0 },
    ArrowRight: { x: step, y: 0 },
    ArrowUp: { x: 0, y: -step },
    ArrowDown: { x: 0, y: step },
  };
  const movement = movements[event.key];
  if (!movement) return;
  event.preventDefault();
  event.stopPropagation();
  emit("gestureStart");
  emitWaypointRouting(edge, moveEdgeWaypoint(
    waypoints,
    index,
    movement,
    { width: props.scene.width, height: props.scene.height, padding: 8 },
  ));
  emit("gestureEnd");
}

function handleLabelKeydown(event: KeyboardEvent, edge: SceneEdge): void {
  if (props.readOnly || !edge.label) return;
  if (event.key === "Home" || event.key === "Delete" || event.key === "Backspace") {
    event.preventDefault();
    event.stopPropagation();
    emit("gestureStart");
    emitLabelRouting(edge, undefined);
    emit("gestureEnd");
    return;
  }
  const step = event.shiftKey ? 10 : 1;
  const movements: Record<string, Point> = {
    ArrowLeft: { x: -step, y: 0 },
    ArrowRight: { x: step, y: 0 },
    ArrowUp: { x: 0, y: -step },
    ArrowDown: { x: 0, y: step },
  };
  const movement = movements[event.key];
  if (!movement) return;
  event.preventDefault();
  event.stopPropagation();
  emit("gestureStart");
  emitLabelRouting(edge, {
    x: (edge.labelOffset?.x ?? 0) + movement.x,
    y: (edge.labelOffset?.y ?? 0) + movement.y,
  });
  emit("gestureEnd");
}

function handleEdgeKeydown(event: KeyboardEvent, edge: SceneEdge): void {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    requestSelection({ elementId: edge.elementId, mode: "replace" });
    return;
  }
  if (event.key === "Delete" || event.key === "Backspace") {
    event.preventDefault();
    event.stopPropagation();
    if (!props.readOnly) emit("semanticEditRequest", edge.elementId);
  }
}

function handleGeometrySemanticKeydown(event: KeyboardEvent, elementId: string): void {
  if (event.key !== "Delete" && event.key !== "Backspace") return;
  event.preventDefault();
  event.stopPropagation();
  if (!props.readOnly) emit("semanticEditRequest", elementId);
}

function emitWaypointRouting(edge: SceneEdge, waypoints: readonly Point[] | undefined): void {
  const routing = routingWithWaypoints(edge, waypoints);
  emit("routingUpdate", { elementId: edge.elementId, routing });
  emit("routingChange", {
    elementId: edge.elementId,
    waypoints: routing?.waypoints?.map((point) => ({ ...point })) ?? [],
  });
}

function emitLabelRouting(edge: SceneEdge, labelOffset: Point | undefined): void {
  if (!edge.label) return;
  emit("routingUpdate", {
    elementId: edge.elementId,
    routing: routingWithLabelOffset(edge, labelOffset),
  });
}

function edgeAriaLabel(edge: SceneEdge): string {
  const source = endpointElementsById.value.get(edge.sourceElementId)?.label ?? edge.sourceElementId;
  const target = endpointElementsById.value.get(edge.targetElementId)?.label ?? edge.targetElementId;
  return `${source}から${target}への${edge.label || "edge"}`;
}

function navigatorDomId(elementId: string): string {
  return `${instanceId}-scene-${encodeURIComponent(elementId)}`;
}

function navigatorPosition(elementId: string): number {
  return navigatorItems.value.findIndex((item) => item.elementId === elementId) + 1;
}

function navigatorAriaLabel(elementId: string, label: string, kind: string): string {
  const selected = selectedElementIdsSet.value.has(elementId) ? "、選択済み" : "";
  const primary = props.selectedElementId === elementId ? "、primary" : "";
  return `${kind}、${label}${selected}${primary}`;
}

function announce(message: string): void {
  liveAnnouncement.value = "";
  void nextTick(() => {
    liveAnnouncement.value = message;
  });
}

function announceActiveNavigatorItem(action: string): void {
  const index = navigatorItems.value.findIndex((item) => (
    item.elementId === activeNavigatorElementId.value
  ));
  const item = navigatorItems.value[index];
  if (!item) return;
  announce(`${action}、${item.kind}、${item.label}、${index + 1}/${navigatorItems.value.length}`);
}

function canvasPoint(event: MouseEvent): Point | undefined {
  const target = event.currentTarget;
  const svg = target instanceof SVGSVGElement
    ? target
    : target instanceof SVGElement
      ? target.ownerSVGElement
      : edgeLayerElement.value;
  const bounds = svg?.getBoundingClientRect();
  if (!bounds || bounds.width <= 0 || bounds.height <= 0) return undefined;
  return {
    x: (event.clientX - bounds.left) * props.scene.width / bounds.width,
    y: (event.clientY - bounds.top) * props.scene.height / bounds.height,
  };
}

function clampPointToScene(point: Point): Point {
  return {
    x: clamp(point.x, 8, Math.max(8, props.scene.width - 8)),
    y: clamp(point.y, 8, Math.max(8, props.scene.height - 8)),
  };
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
  let moved = false;

  const handleMove = (moveEvent: PointerEvent): void => {
    if (Math.hypot(moveEvent.clientX - origin.x, moveEvent.clientY - origin.y) > 4) moved = true;
    setViewportScroll(
      initial.x - (moveEvent.clientX - origin.x),
      initial.y - (moveEvent.clientY - origin.y),
    );
  };
  const cleanup = (upEvent?: PointerEvent): void => {
    window.removeEventListener("pointermove", handleMove);
    window.removeEventListener("pointerup", cleanup);
    window.removeEventListener("pointercancel", cleanup);
    viewportPanning.value = false;
    if (stopViewportTracking === cleanup) stopViewportTracking = undefined;
    if (
      upEvent?.type === "pointerup"
      && primaryOnBlank
      && !moved
      && props.semanticPositionPicking
      && !props.readOnly
    ) {
      const position = semanticPositionAt(upEvent);
      if (position) emit("semanticPositionRequest", position);
    }
  };
  stopViewportTracking?.();
  stopViewportTracking = cleanup;
  window.addEventListener("pointermove", handleMove);
  window.addEventListener("pointerup", cleanup, { once: true });
  window.addEventListener("pointercancel", cleanup, { once: true });
}

function semanticPositionAt(event: PointerEvent): Point | undefined {
  const bounds = stageElement.value?.getBoundingClientRect();
  if (!bounds) return undefined;
  return clampPointToScene({
    x: (event.clientX - bounds.left) / props.zoom,
    y: (event.clientY - bounds.top) / props.zoom,
  });
}

function handleViewportKeydown(event: KeyboardEvent): void {
  if (event.target !== scrollElement.value) return;
  const command = resolveCanvasKeyboardCommand(event, {
    editableTarget: isEditableEventTarget(event.target),
    compositionActive: compositionActive.value,
  });
  if (command.kind === "none") return;

  if (command.kind === "cancel" && (props.semanticPositionPicking || props.semanticResourcePicking)) {
    event.preventDefault();
    event.stopPropagation();
    emit("semanticPickCancel");
    announce("Canvas選択をキャンセルしました");
    return;
  }

  if (command.kind === "cancel") {
    event.preventDefault();
    event.stopPropagation();
    if (keyboardGesture) cancelKeyboardGesture();
    else requestSelection({ elementId: "", mode: "replace" });
    announce("操作をキャンセルしました");
    return;
  }

  if (command.kind === "select-all") {
    event.preventDefault();
    event.stopPropagation();
    requestSelectionSet(navigatorItems.value.map((item) => item.elementId));
    announce(`すべての要素、${navigatorItems.value.length}件を選択`);
    return;
  }

  const movement = keyboardArrowMovement(event.key, event.shiftKey ? 10 : 1);
  if (movement && command.kind === "presentation-secondary") {
    event.preventDefault();
    event.stopPropagation();
    if (!props.readOnly) previewKeyboardResizeOrLabel(event, movement);
    return;
  }
  if (movement && command.kind === "presentation-primary") {
    event.preventDefault();
    event.stopPropagation();
    if (!props.readOnly) previewKeyboardMoveOrWaypoint(event, movement);
    return;
  }
  if (command.kind === "waypoint-add") {
    event.preventDefault();
    event.stopPropagation();
    if (!props.readOnly) previewKeyboardWaypointChange(event, "add");
    return;
  }
  if (command.kind === "waypoint-remove") {
    event.preventDefault();
    event.stopPropagation();
    if (!props.readOnly) previewKeyboardWaypointChange(event, "remove");
    return;
  }
  if (command.kind === "waypoint-focus") {
    event.preventDefault();
    event.stopPropagation();
    moveActiveWaypoint(command.movement);
    return;
  }
  if (command.kind === "select") {
    event.preventDefault();
    event.stopPropagation();
    if (activeNavigatorElementId.value) {
      requestSelection({ elementId: activeNavigatorElementId.value, mode: "replace" });
      navigatorAnchorElementId.value = activeNavigatorElementId.value;
      announceActiveNavigatorItem("選択");
    }
    return;
  }
  if (command.kind === "toggle-selection") {
    event.preventDefault();
    event.stopPropagation();
    if (activeNavigatorElementId.value) {
      requestSelection({ elementId: activeNavigatorElementId.value, mode: "toggle" });
      navigatorAnchorElementId.value = activeNavigatorElementId.value;
      announceActiveNavigatorItem("選択を切替");
    }
    return;
  }
  if (command.kind === "semantic-edit") {
    event.preventDefault();
    event.stopPropagation();
    if (!props.readOnly && activeNavigatorElementId.value) {
      emit("semanticEditRequest", activeNavigatorElementId.value);
      announceActiveNavigatorItem("意味編集を開始");
    }
    return;
  }
  if (command.kind === "focus") {
    handleSceneNavigatorKeydown(event, command.movement, command.range);
    return;
  }
  if (command.kind === "pan") handleNavigationKeydown(event);
}

function handleViewportKeyup(event: KeyboardEvent): void {
  if (!keyboardGesture || event.isComposing || compositionActive.value) return;
  if (event.key !== keyboardGesture.commitKey) return;
  event.preventDefault();
  event.stopPropagation();
  commitKeyboardGesture();
}

function handleViewportBlur(): void {
  if (keyboardGesture) commitKeyboardGesture();
}

function handleSceneNavigatorKeydown(
  event: KeyboardEvent,
  navigation: "next" | "previous" | "first" | "last",
  range: boolean,
): void {
  event.preventDefault();
  event.stopPropagation();
  const previous = activeNavigatorElementId.value;
  const next = moveSceneNavigatorFocus(navigatorItems.value, previous, navigation);
  activeNavigatorElementId.value = next;
  void revealElement(next);
  if (range) {
    navigatorAnchorElementId.value ||= previous || next;
    requestSelectionSet(sceneNavigatorRange(
      navigatorItems.value,
      navigatorAnchorElementId.value,
      next,
    ));
  } else {
    navigatorAnchorElementId.value = next;
  }
  announceActiveNavigatorItem(range ? "範囲選択" : "フォーカス");
}

function previewKeyboardMoveOrWaypoint(event: KeyboardEvent, movement: Point): void {
  const activeId = activeNavigatorElementId.value;
  const edge = props.scene.edges.find((candidate) => candidate.elementId === activeId);
  if (edge) {
    if (!selectedElementIdsSet.value.has(activeId)) {
      requestSelection({ elementId: activeId, mode: "replace" });
    }
    const gesture = beginKeyboardGesture("waypoint", edge.elementId, event.key);
    gesture.delta.x += movement.x;
    gesture.delta.y += movement.y;
    const originalWaypoints = editableEdgeWaypoints(edge);
    const seeded = originalWaypoints.length > 0 ? originalWaypoints : appendEdgeWaypoint(edge);
    const index = clamp(activeWaypointIndex.value, 0, Math.max(0, seeded.length - 1));
    activeWaypointIndex.value = index;
    const waypoints = moveEdgeWaypoint(
      seeded,
      index,
      gesture.delta,
      { width: props.scene.width, height: props.scene.height, padding: 8 },
    );
    gesture.routing = routingWithWaypoints(edge, waypoints);
    previewRouting.value = { ...previewRouting.value, [edge.elementId]: gesture.routing ?? null };
    announce(`Waypoint ${index + 1}を移動`);
    return;
  }

  const selected = selectedElementIdsSet.value.has(activeId)
    ? [...selectedElementIdsSet.value]
    : activeId ? [activeId] : [];
  if (activeId && !selectedElementIdsSet.value.has(activeId)) {
    requestSelection({ elementId: activeId, mode: "replace" });
  }
  const gesture = beginKeyboardGesture("move", activeId, event.key);
  gesture.delta.x += movement.x;
  gesture.delta.y += movement.y;
  gesture.geometryChanges = translateSelection(
    gesture.initialScene,
    selected,
    gesture.delta,
    {
      grid: { enabled: false, size: props.snap.grid.size },
      targets: { enabled: false, tolerance: props.snap.targets.tolerance },
    },
  );
  previewGeometries.value = Object.fromEntries(
    gesture.geometryChanges.map((change) => [change.elementId, change.geometry]),
  );
  announce(`選択要素を${Math.abs(gesture.delta.x || gesture.delta.y)}移動`);
}

function previewKeyboardResizeOrLabel(event: KeyboardEvent, movement: Point): void {
  const activeId = activeNavigatorElementId.value;
  const edge = props.scene.edges.find((candidate) => candidate.elementId === activeId);
  if (edge) {
    if (!selectedElementIdsSet.value.has(activeId)) {
      requestSelection({ elementId: activeId, mode: "replace" });
    }
    if (!edge.label) {
      announce("このedgeにはlabelがありません");
      return;
    }
    const gesture = beginKeyboardGesture("label", edge.elementId, event.key);
    gesture.delta.x += movement.x;
    gesture.delta.y += movement.y;
    const labelOffset = {
      x: (edge.labelOffset?.x ?? 0) + gesture.delta.x,
      y: (edge.labelOffset?.y ?? 0) + gesture.delta.y,
    };
    gesture.routing = routingWithLabelOffset(edge, labelOffset);
    previewRouting.value = { ...previewRouting.value, [edge.elementId]: gesture.routing ?? null };
    announce("edge labelを移動");
    return;
  }

  const element = [...props.scene.containers, ...props.scene.nodes]
    .find((candidate) => candidate.elementId === activeId);
  if (!element) return;
  if (!selectedElementIdsSet.value.has(activeId)) {
    requestSelection({ elementId: activeId, mode: "replace" });
  }
  const gesture = beginKeyboardGesture("resize", element.elementId, event.key);
  gesture.delta.x += movement.x;
  gesture.delta.y += movement.y;
  const initial = [...gesture.initialScene.containers, ...gesture.initialScene.nodes]
    .find((candidate) => candidate.elementId === element.elementId);
  if (!initial) return;
  const change = resizeGeometryElement(gesture.initialScene, element.elementId, {
    width: initial.geometry.width + gesture.delta.x,
    height: initial.geometry.height + gesture.delta.y,
  });
  gesture.geometryChanges = change ? [change] : [];
  previewGeometries.value = change ? { [change.elementId]: change.geometry } : {};
  announce(`サイズ ${Math.round(change?.geometry.width ?? initial.geometry.width)} × ${Math.round(change?.geometry.height ?? initial.geometry.height)}`);
}

function previewKeyboardWaypointChange(event: KeyboardEvent, operation: "add" | "remove"): void {
  const edge = props.scene.edges.find((candidate) => (
    candidate.elementId === activeNavigatorElementId.value
  ));
  if (!edge) return;
  if (!selectedElementIdsSet.value.has(edge.elementId)) {
    requestSelection({ elementId: edge.elementId, mode: "replace" });
  }
  if (event.repeat) return;
  const gesture = beginKeyboardGesture(
    operation === "add" ? "waypoint-add" : "waypoint-remove",
    edge.elementId,
    event.key,
  );
  const current = editableEdgeWaypoints(edge);
  const waypoints = operation === "add"
    ? appendEdgeWaypoint(edge)
    : removeEdgeWaypoint(current, clamp(activeWaypointIndex.value, 0, current.length - 1));
  activeWaypointIndex.value = Math.max(0, (waypoints?.length ?? 1) - 1);
  gesture.routing = routingWithWaypoints(edge, waypoints);
  previewRouting.value = { ...previewRouting.value, [edge.elementId]: gesture.routing ?? null };
  announce(operation === "add" ? "Waypointを追加" : "Waypointを削除");
}

function moveActiveWaypoint(movement: "previous" | "next"): void {
  const edge = props.scene.edges.find((candidate) => (
    candidate.elementId === activeNavigatorElementId.value
  ));
  if (!edge) return;
  const count = editableEdgeWaypoints(edge).length;
  if (count === 0) {
    announce("Waypointはありません");
    return;
  }
  const delta = movement === "next" ? 1 : -1;
  activeWaypointIndex.value = (activeWaypointIndex.value + delta + count) % count;
  announce(`Waypoint ${activeWaypointIndex.value + 1}/${count}を対象にしました`);
}

function beginKeyboardGesture(
  kind: KeyboardGesture["kind"],
  elementId: string,
  commitKey: string,
): KeyboardGesture {
  if (
    keyboardGesture
    && (keyboardGesture.kind !== kind || keyboardGesture.elementId !== elementId || keyboardGesture.commitKey !== commitKey)
  ) commitKeyboardGesture();
  if (!keyboardGesture) {
    keyboardGesture = {
      kind,
      elementId,
      commitKey,
      initialScene: snapshotScene(props.scene),
      delta: { x: 0, y: 0 },
    };
    emit("gestureStart");
  }
  return keyboardGesture;
}

function commitKeyboardGesture(): void {
  const gesture = keyboardGesture;
  if (!gesture) return;
  if (gesture.kind === "resize") {
    const change = gesture.geometryChanges?.[0];
    if (change) {
      emit("resizeChange", change);
      emit("geometryChange", change);
    }
  } else if (gesture.kind === "move") {
    const changes = gesture.geometryChanges ?? [];
    if (changes.length > 0) {
      emit("geometryBatchChange", changes);
      for (const change of changes) emit("geometryChange", change);
    }
  } else {
    const edge = props.scene.edges.find((candidate) => candidate.elementId === gesture.elementId);
    if (edge) emitKeyboardRouting(edge, gesture.routing, gesture.kind !== "label");
  }
  clearKeyboardPreview();
  emit("gestureEnd");
  announce("変更を確定");
}

function cancelKeyboardGesture(): void {
  if (!keyboardGesture) return;
  clearKeyboardPreview();
  emit("gestureEnd");
}

function clearKeyboardPreview(): void {
  keyboardGesture = undefined;
  previewGeometries.value = {};
  previewRouting.value = {};
}

function emitKeyboardRouting(
  edge: SceneEdge,
  routing: EditableEdgeRouting | undefined,
  emitLegacyWaypointChange: boolean,
): void {
  emit("routingUpdate", { elementId: edge.elementId, routing });
  if (!emitLegacyWaypointChange) return;
  emit("routingChange", {
    elementId: edge.elementId,
    waypoints: routing?.waypoints?.map((point) => ({ ...point })) ?? [],
  });
}

function isEditableEventTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest([
    "input",
    "textarea",
    "select",
    "[contenteditable]:not([contenteditable='false'])",
  ].join(",")));
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

function getViewportState(): DiagramViewportState {
  updateViewportMetrics();
  return {
    zoom: normalizeDiagramZoom(props.zoom),
    scrollLeft: viewport.scrollLeft,
    scrollTop: viewport.scrollTop,
  };
}

async function restoreViewport(state: DiagramViewportState): Promise<void> {
  emit("zoomChange", normalizeDiagramZoom(state.zoom));
  await nextTick();
  updateViewportMetrics();
  setViewportScroll(state.scrollLeft, state.scrollTop);
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
  const points = renderedRoute(edge);
  if (points.length === 0) return undefined;
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
    ".iriograph-endpoint-anchors",
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
  if (request.elementId) activeNavigatorElementId.value = request.elementId;
  emit("select", request.elementId);
  emit("selectionRequest", request);
}

function requestSelectionSet(elementIds: string[]): void {
  const primary = elementIds.at(-1) ?? "";
  if (primary) activeNavigatorElementId.value = primary;
  emit("select", primary);
  emit("selectionSetRequest", elementIds);
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
      route: edge.route?.map((point) => ({ ...point })),
      waypoints: edge.waypoints?.map((point) => ({ ...point })),
      labelOffset: edge.labelOffset ? { ...edge.labelOffset } : undefined,
      sourceAnchor: edge.sourceAnchor ? { ...edge.sourceAnchor } : undefined,
      targetAnchor: edge.targetAnchor ? { ...edge.targetAnchor } : undefined,
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
  getViewportState,
  restoreViewport,
});
</script>

<template>
  <div class="iriograph-canvas-shell" :class="{ panning: viewportPanning, 'semantic-picking': semanticPositionPicking || semanticResourcePicking }">
    <div
      ref="scrollElement"
      class="iriograph-canvas-scroll"
      tabindex="0"
      role="listbox"
      aria-label="Diagram scene navigator"
      aria-multiselectable="true"
      :aria-activedescendant="activeNavigatorElementId ? navigatorDomId(activeNavigatorElementId) : undefined"
      :aria-busy="busy"
      :aria-describedby="`${instanceId}-keyboard-help`"
      @scroll="updateViewportMetrics"
      @keydown="handleViewportKeydown"
      @keyup="handleViewportKeyup"
      @blur="handleViewportBlur"
      @compositionstart="compositionActive = true"
      @compositionend="compositionActive = false"
      @pointerdown="startViewportPan"
    >
      <span :id="`${instanceId}-keyboard-help`" class="iriograph-visually-hidden">
        矢印で要素フォーカス、Enterで選択、ControlまたはCommandと矢印で移動、ControlまたはCommandとShiftと矢印でサイズ変更
      </span>
      <span v-if="semanticResourcePicking" class="iriograph-visually-hidden" role="status">
        Canvas上のnodeまたはcontainerから{{ semanticResourcePickLabel }}を選択してください。Escapeでキャンセルできます。
      </span>
      <span class="iriograph-visually-hidden" role="status" aria-live="polite" aria-atomic="true">{{ liveAnnouncement }}</span>
      <div
        ref="stageElement"
        class="iriograph-canvas-stage"
        :style="{ width: `${scene.width * zoom}px`, height: `${scene.height * zoom}px` }"
      >
        <div
          class="iriograph-diagram-canvas"
          v-memo="[
            scene,
            zoom,
            previewGeometries,
            previewRouting,
            selectedElementId,
            selectedElementIds,
            activeNavigatorElementId,
            readOnly,
            semanticDraftPosition,
            containmentWarningElementIds,
          ]"
          :style="{
            width: `${scene.width}px`,
            height: `${scene.height}px`,
            transform: `scale(${zoom})`,
          }"
        >
          <div class="iriograph-canvas-grid" />
          <span
            v-if="semanticDraftPosition"
            class="iriograph-semantic-position-marker"
            aria-label="Semantic draft position"
            :style="{ left: `${semanticDraftPosition.x}px`, top: `${semanticDraftPosition.y}px` }"
          />

          <div
            v-for="container in scene.containers"
            :key="container.elementId"
            v-memo="[
              container,
              previewGeometries[container.elementId],
              selectedElementIdsSet.has(container.elementId),
              activeNavigatorElementId === container.elementId,
              containmentWarningElementIdsSet.has(container.elementId),
              scene.diagnostics,
              readOnly,
            ]"
            :id="navigatorDomId(container.elementId)"
            class="iriograph-scene-container"
            :class="[{ selected: selectedElementIdsSet.has(container.elementId), 'navigator-active': activeNavigatorElementId === container.elementId, 'containment-warning': containmentWarningElementIdsSet.has(container.elementId) }, diagnosticClass(container)]"
            role="option"
            tabindex="-1"
            :data-element-id="container.elementId"
            :data-parent-element-id="container.parentElementId ?? ''"
            :data-header-position="container.headerPosition"
            :aria-label="`${navigatorAriaLabel(container.elementId, container.label, 'container')}${diagnosticAriaSuffix(container)}`"
            :aria-selected="selectedElementIdsSet.has(container.elementId)"
            :aria-posinset="navigatorPosition(container.elementId)"
            :aria-setsize="navigatorItems.length"
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
            @keydown="handleGeometrySemanticKeydown($event, container.elementId)"
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
          </div>

          <svg
            ref="edgeLayerElement"
            class="iriograph-edge-layer"
            :width="scene.width"
            :height="scene.height"
            :viewBox="`0 0 ${scene.width} ${scene.height}`"
            aria-label="関係edge"
          >
            <defs>
              <marker :id="arrowMarkerId" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto" markerUnits="strokeWidth">
                <path d="M0,0 L9,4.5 L0,9 z" fill="context-stroke" />
              </marker>
            </defs>
            <g
              v-for="edge in scene.edges"
              :key="edge.elementId"
              v-memo="[
                edge,
                previewRouting[edge.elementId],
                previewGeometries[edge.sourceElementId],
                previewGeometries[edge.targetElementId],
                selectedElementIdsSet.has(edge.elementId),
                activeNavigatorElementId === edge.elementId,
                scene.diagnostics,
                readOnly,
              ]"
              :id="navigatorDomId(edge.elementId)"
              class="iriograph-edge-group"
              :class="[{ selected: selectedElementIdsSet.has(edge.elementId), 'navigator-active': activeNavigatorElementId === edge.elementId, fallback: edge.fallback }, diagnosticClass(edge)]"
              :data-element-id="edge.elementId"
              tabindex="-1"
              role="option"
              :aria-label="`${navigatorAriaLabel(edge.elementId, edgeAriaLabel(edge), 'edge')}${diagnosticAriaSuffix(edge)}`"
              :aria-selected="selectedElementIdsSet.has(edge.elementId)"
              :aria-posinset="navigatorPosition(edge.elementId)"
              :aria-setsize="navigatorItems.length"
              @click.stop="selectEdge($event, edge)"
              @keydown="handleEdgeKeydown($event, edge)"
              @dblclick.stop="addWaypointAtPointer($event, edge)"
            >
              <path class="iriograph-edge-hitarea" :d="pathFor(edge)" />
              <path
                class="iriograph-edge-path"
                :d="pathFor(edge)"
                :stroke="edge.style.stroke"
                :stroke-dasharray="edge.style.dash"
                :marker-end="`url(#${arrowMarkerId})`"
              />
              <text
                v-if="edge.label"
                class="iriograph-edge-label"
                :class="{ editable: !readOnly }"
                :x="edgeLabelPosition(edge).x"
                :y="edgeLabelPosition(edge).y"
                :fill="edge.style.text"
                text-anchor="middle"
                dominant-baseline="central"
                tabindex="-1"
                aria-hidden="true"
                @pointerdown="startLabelMove($event, edge)"
                @keydown="handleLabelKeydown($event, edge)"
                @dblclick.stop
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
                r="11"
                :class="{ active: index === activeWaypointIndex }"
                tabindex="-1"
                aria-hidden="true"
                @pointerdown="startWaypointMove($event, selectedEdge, index)"
                @keydown="handleWaypointKeydown($event, selectedEdge, index)"
              />
            </g>
            <g v-if="selectedEdge && !readOnly" class="iriograph-endpoint-anchors" aria-hidden="true">
              <circle
                class="source"
                :cx="endpointAnchorHandlePoint(selectedEdge, 'source').x"
                :cy="endpointAnchorHandlePoint(selectedEdge, 'source').y"
                r="8"
                tabindex="-1"
                @pointerdown="startEndpointAnchorMove($event, selectedEdge, 'source')"
              >
                <title>Source endpoint anchor</title>
              </circle>
              <circle
                class="target"
                :cx="endpointAnchorHandlePoint(selectedEdge, 'target').x"
                :cy="endpointAnchorHandlePoint(selectedEdge, 'target').y"
                r="8"
                tabindex="-1"
                @pointerdown="startEndpointAnchorMove($event, selectedEdge, 'target')"
              >
                <title>Target endpoint anchor</title>
              </circle>
            </g>
          </svg>

          <div
            v-for="node in scene.nodes"
            :key="node.elementId"
            v-memo="[
              node,
              previewGeometries[node.elementId],
              selectedElementIdsSet.has(node.elementId),
              activeNavigatorElementId === node.elementId,
              containmentWarningElementIdsSet.has(node.elementId),
              scene.diagnostics,
              readOnly,
            ]"
            :id="navigatorDomId(node.elementId)"
            class="iriograph-scene-node"
            role="option"
            tabindex="-1"
            :data-element-id="node.elementId"
            :data-parent-element-id="node.parentElementId ?? ''"
            :class="[
              `shape-${node.shape}`,
              {
                selected: selectedElementIdsSet.has(node.elementId),
                'navigator-active': activeNavigatorElementId === node.elementId,
                'user-placed': node.placement === 'user',
                'containment-warning': containmentWarningElementIdsSet.has(node.elementId),
                ...diagnosticClass(node),
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
            :aria-label="`${navigatorAriaLabel(node.elementId, node.label, 'node')}${diagnosticAriaSuffix(node)}`"
            :aria-selected="selectedElementIdsSet.has(node.elementId)"
            :aria-posinset="navigatorPosition(node.elementId)"
            :aria-setsize="navigatorItems.length"
            @pointerdown="startMove($event, node)"
            @keydown="handleGeometrySemanticKeydown($event, node.elementId)"
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
          </div>
        </div>
      </div>
    </div>

    <aside class="iriograph-minimap" aria-label="Diagram minimap">
      <svg
        :viewBox="`0 0 ${scene.width} ${scene.height}`"
        preserveAspectRatio="none"
        tabindex="-1"
        aria-label="Minimapでviewportを移動"
        @keydown="handleMinimapKeydown"
        @pointerdown="beginMinimapPan"
      >
        <rect class="iriograph-minimap-paper" x="0" y="0" :width="scene.width" :height="scene.height" />
        <rect
          v-for="container in scene.containers"
          :key="container.elementId"
          v-memo="[container, previewGeometries[container.elementId]]"
          class="iriograph-minimap-container"
          :x="geometryFor(container).x"
          :y="geometryFor(container).y"
          :width="geometryFor(container).width"
          :height="geometryFor(container).height"
        />
        <path
          v-for="edge in scene.edges"
          :key="edge.elementId"
          v-memo="[
            edge,
            previewRouting[edge.elementId],
            previewGeometries[edge.sourceElementId],
            previewGeometries[edge.targetElementId],
          ]"
          class="iriograph-minimap-edge"
          :d="pathFor(edge)"
        />
        <rect
          v-for="node in scene.nodes"
          :key="node.elementId"
          v-memo="[node, previewGeometries[node.elementId]]"
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
