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
  EdgeTerminalMarker,
  EdgeEndpointShape,
  ElementGeometry,
  Point,
  ProjectionDiagnostic,
  SceneContainer,
  SceneEdge,
  SceneNode,
  SceneRegion,
} from "@iriograph/core";
import {
  diagnosticTargetsSceneElement,
  edgeEndpointAnchorFromPoint,
  edgeEndpointAnchorHaloGeometry,
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
  diagramContentBounds,
  diagramWorkAreaBounds,
  diagramFitZoom,
  expandDiagramWorkAreaBounds,
  normalizeDiagramZoom,
  scrollToRevealBounds,
  type DiagramCanvasNavigationApi,
  type DiagramViewportMetrics,
  type DiagramViewportState,
  type DiagramWorkAreaBounds,
} from "../viewport";
import {
  normalizeDiagramSnapSettings,
  resizeGeometryElement,
  resizeGeometryElementFromHandle,
  selectedGeometryElements,
  translateSelection,
  type DiagramSelectionRequest,
  type DiagramSnapSettings,
  type GeometryChange,
  type GeometryElement,
  type ResizeHandle,
} from "../selection";
import type {
  DiagramContextMenuRequest,
  DiagramContextTargetKind,
} from "../context-actions";
import {
  semanticTextLabel,
  type SemanticDisplayMetadata,
} from "../semantic-metadata";
import { constrainMembershipRegionMovement } from "../region-membership-constraints";

const props = withDefaults(defineProps<{
  scene: DiagramScene;
  selectedElementId?: string;
  selectedElementIds?: string[];
  zoom?: number;
  readOnly?: boolean;
  snap?: DiagramSnapSettings;
  semanticPositionPicking?: boolean;
  semanticResourcePicking?: boolean;
  /** Enables semantic endpoint reassignment handles for a selected direct edge. */
  semanticEndpointReconnect?: boolean;
  /** Enables independent node-local label/icon placement gestures. */
  nodeContentEditing?: boolean;
  semanticResourcePickLabel?: string;
  semanticDraftPosition?: Point;
  containmentWarningElementIds?: string[];
  semanticMetadata?: Readonly<Record<string, SemanticDisplayMetadata>>;
  showAllComments?: boolean;
  showGrid?: boolean;
  /** Ephemeral semantic preview only; never part of Scene or the document. */
  deletionPreviewResourceRefs?: readonly string[];
  /** Exact statement identities removed by the pending semantic patch. */
  deletionPreviewStatementRefs?: readonly string[];
  edgeRouteModes?: Readonly<Record<string, "auto" | "straight" | "orthogonal" | "curve" | "manual">>;
  busy?: boolean;
}>(), {
  selectedElementId: "",
  selectedElementIds: () => [],
  zoom: 1,
  readOnly: false,
  snap: () => normalizeDiagramSnapSettings(),
  semanticPositionPicking: false,
  semanticResourcePicking: false,
  semanticEndpointReconnect: false,
  nodeContentEditing: false,
  semanticResourcePickLabel: "resource",
  semanticDraftPosition: undefined,
  containmentWarningElementIds: () => [],
  semanticMetadata: () => ({}),
  showAllComments: false,
  showGrid: true,
  deletionPreviewResourceRefs: () => [],
  deletionPreviewStatementRefs: () => [],
  edgeRouteModes: () => ({}),
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
  nodeContentOffsetUpdate: [payload: {
    elementId: string;
    target: "label" | "icon";
    offset?: Point;
  }];
  regionLabelUpdate: [payload: { elementId: string; anchor: number }];
  /** Requests atomic deletion of the active semantic selection. */
  semanticEditRequest: [elementId: string];
  /** Seeds draft coordinates only; it never mutates the graph or history. */
  semanticPositionRequest: [position: Point, containerIri?: string];
  /** Explicit picker mode only; normal selection and drag never emit this. */
  semanticResourceRequest: [semanticRef: string];
  /** Seeds a direct-edge replacement draft; it never mutates semantic or view state. */
  semanticEndpointReconnectRequest: [payload: {
    edgeElementId: string;
    endpoint: "source" | "target";
    targetSemanticRef: string;
  }];
  semanticPickCancel: [];
  contextMenuRequest: [request: DiagramContextMenuRequest];
  /** @deprecated Use routingUpdate for the complete sparse routing value. */
  routingChange: [payload: { elementId: string; waypoints: Point[] }];
}>();

const CANVAS_PADDING = 20;
const PAN_KEY_STEP = 64;
const DRAG_AUTO_PAN_MARGIN = 48;
const DRAG_AUTO_PAN_MAX_STEP = 24;
const RESIZE_HANDLES: readonly ResizeHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const instanceId = useId();
const markerIds: Record<Exclude<EdgeTerminalMarker, "none">, string> = {
  arrow: `${instanceId}-arrow`,
  "open-arrow": `${instanceId}-open-arrow`,
  triangle: `${instanceId}-triangle`,
  diamond: `${instanceId}-diamond`,
  circle: `${instanceId}-circle`,
};
const scrollElement = ref<HTMLElement>();
const stageElement = ref<HTMLElement>();
const edgeLayerElement = ref<SVGSVGElement>();
const regionConstraintMessage = ref("");
const viewport = reactive<DiagramViewportMetrics>({
  scrollLeft: 0,
  scrollTop: 0,
  width: 0,
  height: 0,
});
const workArea = ref<DiagramWorkAreaBounds>(diagramWorkAreaBounds(props.scene));
const viewportPanning = ref(false);
const previewGeometries = ref<Record<string, ElementGeometry>>({});
const previewRouting = ref<Record<string, EditableEdgeRouting | null>>({});
const previewNodeContentOffsets = ref<Record<string, { label?: Point; icon?: Point }>>({});
const semanticReconnectPreview = ref<{
  edgeElementId: string;
  endpoint: "source" | "target";
  point: Point;
  targetElementId?: string;
}>();
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
  [...props.scene.containers, ...(props.scene.regions ?? []), ...props.scene.nodes]
    .map((element) => [element.elementId, element]),
));
const endpointElementsById = computed(() => new Map(
  [...props.scene.containers, ...(props.scene.regions ?? []), ...props.scene.nodes].map((element) => [
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
const deletionPreviewResourceRefsSet = computed(() => new Set(
  props.deletionPreviewResourceRefs,
));
const deletionPreviewStatementRefsSet = computed(() => new Set(
  props.deletionPreviewStatementRefs,
));
const selectedEdge = computed(() => props.scene.edges.find((edge) => edge.elementId === props.selectedElementId));
const selectedResizeElement = computed<GeometryElement | undefined>(() => {
  if (props.readOnly || selectedElementIdsSet.value.size !== 1) return undefined;
  return [
    ...props.scene.containers,
    ...(props.scene.regions ?? []),
    ...props.scene.nodes,
  ].find((element) => element.elementId === props.selectedElementId);
});
const orderedRegions = computed(() => [...(props.scene.regions ?? [])].sort((left, right) => (
  (left.regionZOrder ?? 0) - (right.regionZOrder ?? 0)
  || left.elementId.localeCompare(right.elementId)
)));
const minimapViewport = computed(() => {
  const offset = stageOffset();
  const right = workArea.value.x + workArea.value.width;
  const bottom = workArea.value.y + workArea.value.height;
  const x = clamp(
    workArea.value.x + (viewport.scrollLeft - offset.x) / props.zoom,
    workArea.value.x,
    right,
  );
  const y = clamp(
    workArea.value.y + (viewport.scrollTop - offset.y) / props.zoom,
    workArea.value.y,
    bottom,
  );
  return {
    x,
    y,
    width: Math.min(right - x, viewport.width / props.zoom),
    height: Math.min(bottom - y, viewport.height / props.zoom),
  };
});
const viewportLabel = computed(() => [
  `${Math.round(props.zoom * 100)}%`,
  `x ${Math.round(minimapViewport.value.x)}`,
  `y ${Math.round(minimapViewport.value.y)}`,
].join(" · "));

type DiagnosticElement = SceneNode | SceneContainer | SceneRegion | SceneEdge;

function metadataFor(semanticRef: string): SemanticDisplayMetadata {
  return props.semanticMetadata[semanticRef] ?? { labels: [], comments: [] };
}

function additionalLabels(semanticRef: string, primary: string): string[] {
  return metadataFor(semanticRef).labels
    .filter((item) => item.value !== primary)
    .map(semanticTextLabel);
}

function commentsFor(semanticRef: string): string {
  return metadataFor(semanticRef).comments.map(semanticTextLabel).join("\n\n");
}

function diagnosticsForElement(element: DiagnosticElement): ProjectionDiagnostic[] {
  return props.scene.diagnostics.filter((diagnostic) => (
    element.structuralKind === "region"
      ? diagnostic.semanticRef === element.semanticRef
        || Boolean(diagnostic.statementRef
          && element.provenance?.sourceStatementRefs.includes(diagnostic.statementRef))
      : diagnosticTargetsSceneElement(diagnostic, element)
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

function isDeletionPreviewResource(element: SceneNode | SceneContainer | SceneRegion): boolean {
  return deletionPreviewResourceRefsSet.value.has(element.semanticRef);
}

function isDeletionPreviewEdge(edge: SceneEdge): boolean {
  return edge.provenance?.sourceStatementRefs.some((statementRef) => (
    deletionPreviewStatementRefsSet.value.has(statementRef)
  )) ?? false;
}

const deletionPreviewMemberships = computed(() => (props.scene.memberships ?? []).filter(
  (membership) => membership.provenance.sourceStatementRefs.some((statementRef) => (
    deletionPreviewStatementRefsSet.value.has(statementRef)
  )),
));

function deletionPreviewMembershipPath(
  membership: NonNullable<DiagramScene["memberships"]>[number],
): string {
  const container = endpointElementsById.value.get(membership.containerElementId);
  const member = endpointElementsById.value.get(membership.memberElementId);
  if (!container || !member) return "";
  const containerCenter = centerOf(container.geometry);
  const memberCenter = centerOf(member.geometry);
  const start = edgeEndpointAnchorPoint(
    container.geometry,
    endpointElementShape(container),
    edgeEndpointAnchorFromPoint(container.geometry, memberCenter),
  );
  const end = edgeEndpointAnchorPoint(
    member.geometry,
    endpointElementShape(member),
    edgeEndpointAnchorFromPoint(member.geometry, containerCenter),
  );
  return polylinePath([start, end]);
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
    replaceWorkArea(diagramWorkAreaBounds(props.scene));
    if (props.semanticPositionPicking || props.semanticResourcePicking) emit("semanticPickCancel");
  },
);

watch(() => props.readOnly, (readOnly) => {
  // Permission can change while a key is held. Pending presentation writes
  // are discarded at that boundary, while navigation remains available.
  if (readOnly && keyboardGesture) cancelKeyboardGesture();
  if (readOnly) {
    previewNodeContentOffsets.value = {};
  }
});

watch(() => props.nodeContentEditing, (enabled) => {
  if (!enabled) {
    previewNodeContentOffsets.value = {};
  }
});

watch(() => props.semanticEndpointReconnect, (enabled) => {
  if (!enabled && semanticReconnectPreview.value) stopViewportTracking?.();
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
  if (derivedRoute.length >= 2) return displayRoutePath(edge, renderedRoute(edge));
  const source = endpointElementsById.value.get(edge.sourceElementId);
  const target = endpointElementsById.value.get(edge.targetElementId);
  if (!source || !target) return "";
  const start = centerOf(source.geometry);
  const end = centerOf(target.geometry);
  if (edge.waypoints && edge.waypoints.length > 0) {
    return displayRoutePath(edge, [start, ...edge.waypoints, end]);
  }
  if (edgeRouteMode(edge) === "auto") {
    const bend = Math.max(44, Math.abs(end.x - start.x) * 0.42);
    const direction = end.x >= start.x ? 1 : -1;
    return `M ${start.x} ${start.y} C ${start.x + bend * direction} ${start.y}, ${end.x - bend * direction} ${end.y}, ${end.x} ${end.y}`;
  }
  return displayRoutePath(edge, [start, end]);
}

function displayRoutePath(edge: SceneEdge, route: readonly Point[]): string {
  const start = route[0];
  const end = route.at(-1);
  if (!start || !end) return "";
  const mode = props.edgeRouteModes[edge.elementId]
    ?? edge.routeMode
    ?? (edge.waypoints?.length ? "manual" : "auto");
  if (mode === "straight") return polylinePath([start, end]);
  if (mode === "orthogonal") return orthogonalPath(route);
  if (mode === "curve") return curvedPath(route);
  return polylinePath(route);
}

function orthogonalPath(points: readonly Point[]): string {
  const result: Point[] = [];
  for (const point of points) {
    const previous = result.at(-1);
    if (previous && previous.x !== point.x && previous.y !== point.y) {
      result.push({ x: point.x, y: previous.y });
    }
    result.push(point);
  }
  return polylinePath(result);
}

/** Keeps a derived obstacle-avoiding corridor and visibly bows a direct route. */
function curvedPath(points: readonly Point[]): string {
  const start = points[0];
  const end = points.at(-1);
  if (!start || !end) return "";
  if (points.length < 3) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const distance = Math.hypot(dx, dy);
    if (distance === 0) {
      return `M ${start.x} ${start.y} C ${start.x + 36} ${start.y - 48}, ${start.x + 64} ${start.y + 48}, ${start.x} ${start.y}`;
    }
    const bow = clamp(distance * .18, 24, 80);
    const control = {
      x: (start.x + end.x) / 2 - dy / distance * bow,
      y: (start.y + end.y) / 2 + dx / distance * bow,
    };
    return `M ${start.x} ${start.y} Q ${control.x} ${control.y} ${end.x} ${end.y}`;
  }
  return roundedPolylinePath(points);
}

/** Rounds only bend neighborhoods so curves do not leave the layout corridor. */
function roundedPolylinePath(points: readonly Point[], radius = 10): string {
  const start = points[0];
  const end = points.at(-1);
  if (!start || !end) return "";
  const parts = [`M ${start.x} ${start.y}`];
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1]!;
    const corner = points[index]!;
    const next = points[index + 1]!;
    const incoming = Math.hypot(corner.x - previous.x, corner.y - previous.y);
    const outgoing = Math.hypot(next.x - corner.x, next.y - corner.y);
    if (incoming === 0 || outgoing === 0) continue;
    const inset = Math.min(radius, incoming / 2, outgoing / 2);
    const before = {
      x: corner.x + (previous.x - corner.x) * inset / incoming,
      y: corner.y + (previous.y - corner.y) * inset / incoming,
    };
    const after = {
      x: corner.x + (next.x - corner.x) * inset / outgoing,
      y: corner.y + (next.y - corner.y) * inset / outgoing,
    };
    parts.push(`L ${before.x} ${before.y}`, `Q ${corner.x} ${corner.y} ${after.x} ${after.y}`);
  }
  parts.push(`L ${end.x} ${end.y}`);
  return parts.join(" ");
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
  if (!waypointEditingAllowed(edge)) return [];
  const preview = previewRouting.value[edge.elementId];
  if (preview !== undefined) return preview?.waypoints?.map((point) => ({ ...point })) ?? [];
  return editableEdgeWaypoints({ route: renderedRoute(edge), waypoints: edge.waypoints });
}

function edgeRouteMode(edge: SceneEdge): "auto" | "straight" | "orthogonal" | "curve" | "manual" {
  return props.edgeRouteModes[edge.elementId]
    ?? edge.routeMode
    ?? (edge.waypoints?.length ? "manual" : "auto");
}

function waypointEditingAllowed(edge: SceneEdge): boolean {
  const mode = edgeRouteMode(edge);
  return mode !== "straight" && mode !== "curve";
}

function withoutDisallowedWaypoints(
  edge: SceneEdge,
  routing: EditableEdgeRouting | undefined,
): EditableEdgeRouting | undefined {
  if (!routing || waypointEditingAllowed(edge) || !routing.waypoints) return routing;
  const result = { ...routing };
  delete result.waypoints;
  return Object.values(result).some((value) => value !== undefined) ? result : undefined;
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

function endpointElementShape(element: SceneNode | SceneContainer | SceneRegion): EdgeEndpointShape {
  if (element.structuralKind === "container") return "container";
  if (element.structuralKind === "region") return "region";
  return element.shape;
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

function endpointAnchorHalo(
  edge: SceneEdge,
  endpoint: "source" | "target",
) {
  const elementId = endpoint === "source" ? edge.sourceElementId : edge.targetElementId;
  const element = endpointElementsById.value.get(elementId);
  if (!element) return undefined;
  const routePoint = endpointAnchorHandlePoint(edge, endpoint);
  const preview = previewRouting.value[edge.elementId];
  const stored = preview === undefined
    ? endpoint === "source" ? edge.sourceAnchor : edge.targetAnchor
    : endpoint === "source" ? preview?.sourceAnchor : preview?.targetAnchor;
  const anchor = stored ?? edgeEndpointAnchorFromPoint(element.geometry, routePoint);
  return edgeEndpointAnchorHaloGeometry(
    element.geometry,
    endpointElementShape(element),
    anchor,
    18,
    14,
  );
}

function terminalMarkerUrl(marker: EdgeTerminalMarker | undefined): string | undefined {
  if (!marker || marker === "none") return undefined;
  return `url(#${markerIds[marker]})`;
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
      && (element.structuralKind === "container" || element.structuralKind === "region")
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
  regionConstraintMessage.value = "";
  const origin = { x: event.clientX, y: event.clientY };
  updateViewportMetrics();
  const originScroll = { x: viewport.scrollLeft, y: viewport.scrollTop };
  const originWorkArea = { x: workArea.value.x, y: workArea.value.y };
  let pendingChanges: GeometryChange[] = [];
  let latestMoveEvent: PointerEvent | undefined;
  let animationFrame: number | undefined;

  const updatePreview = (moveEvent: PointerEvent): void => {
    updateViewportMetrics();
    const workspaceShift = {
      x: (originWorkArea.x - workArea.value.x) * props.zoom,
      y: (originWorkArea.y - workArea.value.y) * props.zoom,
    };
    const translated = translateSelection(
      initialScene,
      movingElementIds,
      {
        x: (moveEvent.clientX - origin.x
          + viewport.scrollLeft - originScroll.x - workspaceShift.x) / props.zoom,
        y: (moveEvent.clientY - origin.y
          + viewport.scrollTop - originScroll.y - workspaceShift.y) / props.zoom,
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
    const constrained = constrainMembershipRegionMovement(initialScene, translated);
    pendingChanges = constrained.changes;
    regionConstraintMessage.value = constrained.issue?.message ?? "";
    const expanded = expandWorkAreaFor(pendingChanges);
    previewGeometries.value = Object.fromEntries(
      pendingChanges.map((change) => [change.elementId, change.geometry]),
    );
    const panned = autoPanForPointer(moveEvent);
    if (expanded || panned) scheduleNextFrame();
  };
  const scheduleNextFrame = (): void => {
    if (animationFrame !== undefined || !latestMoveEvent) return;
    animationFrame = window.requestAnimationFrame(() => {
      animationFrame = undefined;
      if (latestMoveEvent) updatePreview(latestMoveEvent);
    });
  };

  trackPointer((moveEvent) => {
    latestMoveEvent = moveEvent;
    updatePreview(moveEvent);
  }, (cancelled) => {
    latestMoveEvent = undefined;
    if (animationFrame !== undefined) window.cancelAnimationFrame(animationFrame);
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

function startResize(event: PointerEvent, element: GeometryElement, handle: ResizeHandle = "se"): void {
  if (props.readOnly || event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  requestSelection({ elementId: element.elementId, mode: "replace" });
  emit("gestureStart");
  regionConstraintMessage.value = "";
  const origin = { x: event.clientX, y: event.clientY };
  const initialScene = snapshotScene(props.scene);
  updateViewportMetrics();
  const originScroll = { x: viewport.scrollLeft, y: viewport.scrollTop };
  const originWorkArea = { x: workArea.value.x, y: workArea.value.y };
  let pendingChange: GeometryChange | undefined;
  let latestMoveEvent: PointerEvent | undefined;
  let animationFrame: number | undefined;

  const updatePreview = (moveEvent: PointerEvent): void => {
    updateViewportMetrics();
    const workspaceShift = {
      x: (originWorkArea.x - workArea.value.x) * props.zoom,
      y: (originWorkArea.y - workArea.value.y) * props.zoom,
    };
    const change = resizeGeometryElementFromHandle(initialScene, element.elementId, handle, {
      x: (moveEvent.clientX - origin.x
        + viewport.scrollLeft - originScroll.x - workspaceShift.x) / props.zoom,
      y: (moveEvent.clientY - origin.y
        + viewport.scrollTop - originScroll.y - workspaceShift.y) / props.zoom,
    });
    if (!change) return;
    const constrained = constrainMembershipRegionMovement(initialScene, [change]);
    regionConstraintMessage.value = constrained.issue?.message ?? "";
    const accepted = constrained.changes[0];
    if (!accepted) return;
    pendingChange = accepted;
    const expanded = expandWorkAreaFor([accepted]);
    previewGeometries.value = { [accepted.elementId]: accepted.geometry };
    const panned = autoPanForPointer(moveEvent);
    if (expanded || panned) scheduleNextFrame();
  };
  const scheduleNextFrame = (): void => {
    if (animationFrame !== undefined || !latestMoveEvent) return;
    animationFrame = window.requestAnimationFrame(() => {
      animationFrame = undefined;
      if (latestMoveEvent) updatePreview(latestMoveEvent);
    });
  };

  trackPointer((moveEvent) => {
    latestMoveEvent = moveEvent;
    updatePreview(moveEvent);
  }, (cancelled) => {
    latestMoveEvent = undefined;
    if (animationFrame !== undefined) window.cancelAnimationFrame(animationFrame);
    previewGeometries.value = {};
    if (!cancelled && pendingChange) {
      emit("resizeChange", pendingChange);
      emit("geometryChange", pendingChange);
    }
  });
}

function startWaypointMove(event: PointerEvent, edge: SceneEdge, index: number): void {
  if (props.readOnly || event.button !== 0 || !waypointEditingAllowed(edge)) return;
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

function nodeContentOffset(node: SceneNode, target: "label" | "icon"): Point {
  const preview = previewNodeContentOffsets.value[node.elementId]?.[target];
  const stored = target === "label" ? node.nodeLabelOffset : node.nodeIconOffset;
  return clampNodeContentOffset(node.geometry, preview ?? stored ?? { x: 0, y: 0 });
}

function nodeContentOffsetStyle(node: SceneNode, target: "label" | "icon"): Record<string, string> {
  const offset = nodeContentOffset(node, target);
  return { transform: `translate(${offset.x}px, ${offset.y}px)` };
}

function startNodeContentMove(
  event: PointerEvent,
  node: SceneNode,
  target: "label" | "icon",
): void {
  if (
    !props.nodeContentEditing
    || props.readOnly
    || event.button !== 0
    || !selectedElementIdsSet.value.has(node.elementId)
  ) return;
  event.preventDefault();
  event.stopPropagation();
  requestSelection({ elementId: node.elementId, mode: "replace" });
  emit("gestureStart");
  const contentElement = event.currentTarget instanceof HTMLElement ? event.currentTarget : undefined;
  const origin = { x: event.clientX, y: event.clientY };
  const initial = nodeContentOffset(node, target);
  let pending = initial;
  trackPointer((moveEvent) => {
    pending = clampNodeContentOffset(node.geometry, {
      x: initial.x + (moveEvent.clientX - origin.x) / props.zoom,
      y: initial.y + (moveEvent.clientY - origin.y) / props.zoom,
    });
    previewNodeContentOffsets.value = {
      ...previewNodeContentOffsets.value,
      [node.elementId]: {
        ...previewNodeContentOffsets.value[node.elementId],
        [target]: pending,
      },
    };
    if (contentElement) contentElement.style.transform = `translate(${pending.x}px, ${pending.y}px)`;
  }, (cancelled) => {
    const next = { ...previewNodeContentOffsets.value };
    delete next[node.elementId];
    previewNodeContentOffsets.value = next;
    if (cancelled && contentElement) {
      contentElement.style.transform = `translate(${initial.x}px, ${initial.y}px)`;
    }
    if (cancelled || pending.x === initial.x && pending.y === initial.y) return;
    emit("nodeContentOffsetUpdate", {
      elementId: node.elementId,
      target,
      offset: pending.x === 0 && pending.y === 0 ? undefined : pending,
    });
  });
}

function clampNodeContentOffset(geometry: ElementGeometry, offset: Point): Point {
  const horizontal = Math.max(0, geometry.width / 2 - 10);
  const vertical = Math.max(0, geometry.height / 2 - 10);
  return {
    x: clamp(Number.isFinite(offset.x) ? offset.x : 0, -horizontal, horizontal),
    y: clamp(Number.isFinite(offset.y) ? offset.y : 0, -vertical, vertical),
  };
}

function regionLabelStyle(region: SceneRegion): Record<string, string> | undefined {
  const anchor = region.regionLabelAnchor;
  if (!Number.isFinite(anchor)) return undefined;
  const point = pointAtRegionPerimeter(region.geometry, anchor!);
  return {
    left: `${point.x - region.geometry.x}px`,
    top: `${point.y - region.geometry.y}px`,
    right: "auto",
    bottom: "auto",
    transform: "translate(-50%, -50%)",
  };
}

function resizeHandleStyle(element: GeometryElement, handle: ResizeHandle): Record<string, string> {
  const geometry = geometryFor(element);
  const horizontal = handle.includes("w") ? geometry.x
    : handle.includes("e") ? geometry.x + geometry.width
      : geometry.x + geometry.width / 2;
  const vertical = handle.includes("n") ? geometry.y
    : handle.includes("s") ? geometry.y + geometry.height
      : geometry.y + geometry.height / 2;
  return {
    left: `${horizontal - workArea.value.x}px`,
    top: `${vertical - workArea.value.y}px`,
  };
}

function startRegionLabelMove(event: PointerEvent, region: SceneRegion): void {
  if (props.readOnly || event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  requestSelection({ elementId: region.elementId, mode: "replace" });
  emit("gestureStart");
  trackPointer((moveEvent) => {
    const point = semanticPositionAt(moveEvent);
    if (!point) return;
    emit("regionLabelUpdate", {
      elementId: region.elementId,
      anchor: nearestRegionPerimeterAnchor(region.geometry, point),
    });
  });
}

function pointAtRegionPerimeter(geometry: ElementGeometry, anchor: number): Point {
  const width = geometry.width;
  const height = geometry.height;
  const perimeter = Math.max(1, 2 * (width + height));
  let distance = clamp(anchor, 0, .999999) * perimeter;
  if (distance <= width) return { x: geometry.x + distance, y: geometry.y };
  distance -= width;
  if (distance <= height) return { x: geometry.x + width, y: geometry.y + distance };
  distance -= height;
  if (distance <= width) return { x: geometry.x + width - distance, y: geometry.y + height };
  distance -= width;
  return { x: geometry.x, y: geometry.y + height - Math.min(height, distance) };
}

function nearestRegionPerimeterAnchor(geometry: ElementGeometry, point: Point): number {
  const localX = clamp(point.x - geometry.x, 0, geometry.width);
  const localY = clamp(point.y - geometry.y, 0, geometry.height);
  const distances = [localY, geometry.width - localX, geometry.height - localY, localX];
  const side = distances.indexOf(Math.min(...distances));
  const perimeter = Math.max(1, 2 * (geometry.width + geometry.height));
  const distance = side === 0
    ? localX
    : side === 1
      ? geometry.width + localY
      : side === 2
        ? geometry.width + geometry.height + (geometry.width - localX)
        : 2 * geometry.width + geometry.height + (geometry.height - localY);
  return clamp(distance / perimeter, 0, .999999);
}

function startEndpointAnchorMove(
  event: PointerEvent,
  edge: SceneEdge,
  endpoint: "source" | "target",
): void {
  if (props.semanticEndpointReconnect) {
    startSemanticEndpointReconnect(event, edge, endpoint);
    return;
  }
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
    pending = withoutDisallowedWaypoints(edge, routingWithEndpointAnchor(
      edge,
      endpoint,
      edgeEndpointAnchorFromPoint(element.geometry, point),
    ));
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

function startSemanticEndpointReconnect(
  event: PointerEvent,
  edge: SceneEdge,
  endpoint: "source" | "target",
): void {
  if (props.readOnly || event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  requestSelection({ elementId: edge.elementId, mode: "replace" });
  const initialPoint = endpointAnchorHandlePoint(edge, endpoint);
  semanticReconnectPreview.value = { edgeElementId: edge.elementId, endpoint, point: initialPoint };

  const handleMove = (moveEvent: PointerEvent): void => {
    const point = canvasPoint(moveEvent);
    if (!point) return;
    const target = nodeAtPoint(point);
    semanticReconnectPreview.value = {
      edgeElementId: edge.elementId,
      endpoint,
      point: target ? centerOf(target.geometry) : point,
      targetElementId: target?.elementId,
    };
    autoPanForPointer(moveEvent);
  };
  const cleanup = (upEvent?: PointerEvent): void => {
    window.removeEventListener("pointermove", handleMove);
    window.removeEventListener("pointerup", cleanup);
    window.removeEventListener("pointercancel", cleanup);
    const targetElementId = upEvent?.type === "pointerup"
      ? semanticReconnectPreview.value?.targetElementId
      : undefined;
    semanticReconnectPreview.value = undefined;
    if (stopViewportTracking === cleanup) stopViewportTracking = undefined;
    const target = targetElementId
      ? props.scene.nodes.find((candidate) => candidate.elementId === targetElementId)
      : undefined;
    const currentSemanticRef = endpoint === "source"
      ? endpointElementsById.value.get(edge.sourceElementId)?.semanticRef
      : endpointElementsById.value.get(edge.targetElementId)?.semanticRef;
    if (!target || target.semanticRef === currentSemanticRef) return;
    emit("semanticEndpointReconnectRequest", {
      edgeElementId: edge.elementId,
      endpoint,
      targetSemanticRef: target.semanticRef,
    });
  };
  stopViewportTracking?.();
  stopViewportTracking = cleanup;
  window.addEventListener("pointermove", handleMove);
  window.addEventListener("pointerup", cleanup, { once: true });
  window.addEventListener("pointercancel", cleanup, { once: true });
}

function nodeAtPoint(point: Point): SceneNode | undefined {
  return [...props.scene.nodes].reverse().find((node) => {
    const geometry = geometryFor(node);
    return point.x >= geometry.x
      && point.x <= geometry.x + geometry.width
      && point.y >= geometry.y
      && point.y <= geometry.y + geometry.height;
  });
}

function semanticReconnectPath(): string {
  const preview = semanticReconnectPreview.value;
  const edge = preview
    ? props.scene.edges.find((candidate) => candidate.elementId === preview.edgeElementId)
    : undefined;
  if (!preview || !edge) return "";
  const route = renderedRoute(edge);
  const fixed = preview.endpoint === "source" ? route.at(-1) : route[0];
  if (!fixed) return "";
  return preview.endpoint === "source"
    ? polylinePath([preview.point, fixed])
    : polylinePath([fixed, preview.point]);
}

function addWaypointAtPointer(event: MouseEvent, edge: SceneEdge): void {
  requestSelection({ elementId: edge.elementId, mode: "replace" });
  if (props.readOnly || !waypointEditingAllowed(edge)) return;
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
  if (props.readOnly || !waypointEditingAllowed(edge)) return;
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
  if (props.readOnly || (!edge.label && !edge.caption)) return;
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
  if (isContextMenuKey(event)) {
    requestKeyboardContextMenu(event, edge.elementId);
    return;
  }
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    requestSelection({ elementId: edge.elementId, mode: "replace" });
    return;
  }
  if (event.key === "Delete" || event.key === "Backspace") {
    event.preventDefault();
    event.stopPropagation();
    if (!props.readOnly) {
      emit("semanticEditRequest", edge.elementId);
      announce("選択した関係を削除します");
    }
  }
}

function handleGeometrySemanticKeydown(event: KeyboardEvent, elementId: string): void {
  if (isContextMenuKey(event)) {
    requestKeyboardContextMenu(event, elementId);
    return;
  }
  if (event.key !== "Delete" && event.key !== "Backspace") return;
  event.preventDefault();
  event.stopPropagation();
  if (!props.readOnly) {
    emit("semanticEditRequest", elementId);
    announce("選択した要素を削除します");
  }
}

function emitWaypointRouting(edge: SceneEdge, waypoints: readonly Point[] | undefined): void {
  const routing = withoutDisallowedWaypoints(edge, routingWithWaypoints(edge, waypoints));
  emit("routingUpdate", { elementId: edge.elementId, routing });
  emit("routingChange", {
    elementId: edge.elementId,
    waypoints: routing?.waypoints?.map((point) => ({ ...point })) ?? [],
  });
}

function emitLabelRouting(edge: SceneEdge, labelOffset: Point | undefined): void {
  if (!edge.label && !edge.caption) return;
  emit("routingUpdate", {
    elementId: edge.elementId,
    routing: withoutDisallowedWaypoints(edge, routingWithLabelOffset(edge, labelOffset)),
  });
}

function edgeAriaLabel(edge: SceneEdge): string {
  const source = endpointElementsById.value.get(edge.sourceElementId)?.label ?? edge.sourceElementId;
  const target = endpointElementsById.value.get(edge.targetElementId)?.label ?? edge.targetElementId;
  const caption = edge.caption ? `、図上の注記 ${edge.caption}` : "";
  const semanticComment = edgeSemanticComments(edge);
  return `${source}から${target}への${edge.label || sequenceOrdinalBadge(edge) || "edge"}${caption}${semanticComment ? `、関係の説明 ${semanticComment}` : ""}`;
}

function edgeSemanticComments(edge: SceneEdge): string {
  return (edge.statementComments ?? []).map((comment) => (
    `${comment.value}${comment.language ? `（${comment.language}）` : ""}`
  )).join("\n\n");
}

function edgeCaptionLines(edge: SceneEdge): string[] {
  return edge.caption?.split(/\r?\n/u).filter((line) => line.length > 0) ?? [];
}

function sequenceOrdinalBadge(edge: SceneEdge): string {
  const provenance = edge.labelProvenance as (SceneEdge["labelProvenance"] & {
    fromOrdinal?: number;
    toOrdinal?: number;
  }) | undefined;
  return provenance?.kind === "derived-structure"
    && provenance.role === "sequence-transition"
    && Number.isSafeInteger(provenance.fromOrdinal)
    && Number.isSafeInteger(provenance.toOrdinal)
    ? `${provenance.fromOrdinal}→${provenance.toOrdinal}`
    : "";
}

function sequenceMemberBadges(elementId: string): Array<{ key: string; ordinal: number; label: string }> {
  const containers = new Map(props.scene.containers.map((container) => [container.elementId, container]));
  return (props.scene.memberships ?? [])
    .filter((membership) => (
      membership.role === "sequence-member"
      && membership.memberElementId === elementId
      && Number.isSafeInteger(membership.ordinal)
    ))
    .sort((left, right) => (
      left.ordinal! - right.ordinal!
      || left.containerElementId.localeCompare(right.containerElementId)
      || left.semanticRef.localeCompare(right.semanticRef)
    ))
    .map((membership) => ({
      key: membership.semanticRef,
      ordinal: membership.ordinal!,
      label: containers.get(membership.containerElementId)?.label ?? "並び順",
    }));
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
    x: workArea.value.x + (event.clientX - bounds.left) * workArea.value.width / bounds.width,
    y: workArea.value.y + (event.clientY - bounds.top) * workArea.value.height / bounds.height,
  };
}

function clampPointToScene(point: Point): Point {
  return {
    x: clamp(point.x, workArea.value.x + 8, workArea.value.x + workArea.value.width - 8),
    y: clamp(point.y, workArea.value.y + 8, workArea.value.y + workArea.value.height - 8),
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
    x: workArea.value.x + (event.clientX - bounds.left) / props.zoom,
    y: workArea.value.y + (event.clientY - bounds.top) / props.zoom,
  });
}

function handleViewportKeydown(event: KeyboardEvent): void {
  if (event.target !== scrollElement.value) return;
  if (isContextMenuKey(event)) {
    requestKeyboardContextMenu(event, activeNavigatorElementId.value);
    return;
  }
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
      announce("選択した意味情報を削除します");
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
    if (!waypointEditingAllowed(edge)) {
      announce("直線・曲線ではWaypointを編集しません");
      return;
    }
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
  const translated = translateSelection(
    gesture.initialScene,
    selected,
    gesture.delta,
    {
      grid: { enabled: false, size: props.snap.grid.size },
      targets: { enabled: false, tolerance: props.snap.targets.tolerance },
    },
  );
  const constrained = constrainMembershipRegionMovement(gesture.initialScene, translated);
  gesture.geometryChanges = constrained.changes;
  regionConstraintMessage.value = constrained.issue?.message ?? "";
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

  const element = [...props.scene.containers, ...(props.scene.regions ?? []), ...props.scene.nodes]
    .find((candidate) => candidate.elementId === activeId);
  if (!element) return;
  if (!selectedElementIdsSet.value.has(activeId)) {
    requestSelection({ elementId: activeId, mode: "replace" });
  }
  const gesture = beginKeyboardGesture("resize", element.elementId, event.key);
  gesture.delta.x += movement.x;
  gesture.delta.y += movement.y;
  const initial = [...gesture.initialScene.containers, ...(gesture.initialScene.regions ?? []), ...gesture.initialScene.nodes]
    .find((candidate) => candidate.elementId === element.elementId);
  if (!initial) return;
  const change = resizeGeometryElement(gesture.initialScene, element.elementId, {
    width: initial.geometry.width + gesture.delta.x,
    height: initial.geometry.height + gesture.delta.y,
  });
  const constrained = constrainMembershipRegionMovement(
    gesture.initialScene,
    change ? [change] : [],
  );
  gesture.geometryChanges = constrained.changes;
  regionConstraintMessage.value = constrained.issue?.message ?? "";
  const accepted = constrained.changes[0];
  previewGeometries.value = accepted ? { [accepted.elementId]: accepted.geometry } : {};
  announce(`サイズ ${Math.round(accepted?.geometry.width ?? initial.geometry.width)} × ${Math.round(accepted?.geometry.height ?? initial.geometry.height)}`);
}

function previewKeyboardWaypointChange(event: KeyboardEvent, operation: "add" | "remove"): void {
  const edge = props.scene.edges.find((candidate) => (
    candidate.elementId === activeNavigatorElementId.value
  ));
  if (!edge || !waypointEditingAllowed(edge)) return;
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
  announce(operation === "add" ? "経路点を追加" : "経路点を削除");
}

function moveActiveWaypoint(movement: "previous" | "next"): void {
  const edge = props.scene.edges.find((candidate) => (
    candidate.elementId === activeNavigatorElementId.value
  ));
  if (!edge || !waypointEditingAllowed(edge)) return;
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
  routing = withoutDisallowedWaypoints(edge, routing);
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
    x: workArea.value.x
      + clamp((event.clientX - bounds.left) / bounds.width, 0, 1) * workArea.value.width,
    y: workArea.value.y
      + clamp((event.clientY - bounds.top) / bounds.height, 0, 1) * workArea.value.height,
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
    x: Math.max(0, offset.x + workArea.value.width * props.zoom + CANVAS_PADDING - viewport.width),
    y: Math.max(0, offset.y + workArea.value.height * props.zoom + CANVAS_PADDING - viewport.height),
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

function autoPanForPointer(event: PointerEvent): boolean {
  const element = scrollElement.value;
  if (!element) return false;
  const bounds = element.getBoundingClientRect();
  if (bounds.width <= 0 || bounds.height <= 0) return false;
  const axisDelta = (position: number, start: number, end: number): number => {
    if (position < start + DRAG_AUTO_PAN_MARGIN) {
      return -Math.min(DRAG_AUTO_PAN_MAX_STEP, start + DRAG_AUTO_PAN_MARGIN - position);
    }
    if (position > end - DRAG_AUTO_PAN_MARGIN) {
      return Math.min(DRAG_AUTO_PAN_MAX_STEP, position - (end - DRAG_AUTO_PAN_MARGIN));
    }
    return 0;
  };
  const deltaX = axisDelta(event.clientX, bounds.left, bounds.right);
  const deltaY = axisDelta(event.clientY, bounds.top, bounds.bottom);
  if (!deltaX && !deltaY) return false;
  const previous = { x: viewport.scrollLeft, y: viewport.scrollTop };
  panBy(deltaX, deltaY);
  return viewport.scrollLeft !== previous.x || viewport.scrollTop !== previous.y;
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
    x: workArea.value.x + (viewport.scrollLeft - offset.x + viewport.width / 2) / props.zoom,
    y: workArea.value.y + (viewport.scrollTop - offset.y + viewport.height / 2) / props.zoom,
  };
  emit("zoomChange", normalizeDiagramZoom(value));
  await nextTick();
  updateViewportMetrics();
  centerOn(center);
}

async function fitToView(): Promise<void> {
  updateViewportMetrics();
  const content = diagramContentBounds(props.scene);
  emit("zoomChange", diagramFitZoom(content, viewport));
  await nextTick();
  updateViewportMetrics();
  centerOn({
    x: content.x + content.width / 2,
    y: content.y + content.height / 2,
  });
}

function centerOn(point: Point): void {
  const offset = stageOffset();
  setViewportScroll(
    offset.x + (point.x - workArea.value.x) * props.zoom - viewport.width / 2,
    offset.y + (point.y - workArea.value.y) * props.zoom - viewport.height / 2,
  );
}

async function revealElement(elementId: string): Promise<boolean> {
  await nextTick();
  updateViewportMetrics();
  const bounds = elementBounds(elementId);
  if (!bounds) return false;
  const next = scrollToRevealBounds(bounds, props.zoom, viewport, semanticContentOffset());
  setViewportScroll(next.x, next.y);
  return true;
}

function elementBounds(elementId: string): ElementGeometry | undefined {
  const geometryElement = [
    ...props.scene.nodes,
    ...props.scene.containers,
    ...(props.scene.regions ?? []),
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
    ".iriograph-scene-region",
    ".iriograph-edge-group",
    ".iriograph-waypoints",
    ".iriograph-endpoint-anchors",
    ".iriograph-resize-handle",
  ].join(","));
}

function requestPointerContextMenu(
  event: MouseEvent,
  kind: DiagramContextTargetKind,
  elementId?: string,
): void {
  event.preventDefault();
  event.stopPropagation();
  if (elementId) requestSelection({ elementId, mode: "replace" });
  else requestSelection({ elementId: "", mode: "replace" });
  emit("contextMenuRequest", {
    kind,
    elementId,
    clientX: event.clientX,
    clientY: event.clientY,
    canvasPosition: canvasPoint(event),
  });
}

function requestBlankContextMenu(event: MouseEvent): void {
  if (!isBlankCanvasTarget(event.target)) return;
  requestPointerContextMenu(event, "blank");
}

function requestKeyboardContextMenu(event: KeyboardEvent, requestedElementId: string): void {
  event.preventDefault();
  event.stopPropagation();
  const item = navigatorItems.value.find((candidate) => candidate.elementId === requestedElementId);
  const elementId = item?.elementId;
  if (elementId) requestSelection({ elementId, mode: "replace" });
  const target = elementId ? document.getElementById(navigatorDomId(elementId)) : scrollElement.value;
  const bounds = target?.getBoundingClientRect();
  const geometry = elementId ? elementBounds(elementId) : undefined;
  emit("contextMenuRequest", {
    kind: item?.kind ?? "blank",
    elementId,
    clientX: bounds ? bounds.left + Math.min(bounds.width, 24) : 24,
    clientY: bounds ? bounds.top + Math.min(bounds.height, 24) : 24,
    canvasPosition: geometry ? centerOf(geometry) : undefined,
  });
}

function isContextMenuKey(event: KeyboardEvent): boolean {
  return event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey);
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

function semanticContentOffset(): Point {
  const offset = stageOffset();
  return {
    x: offset.x - workArea.value.x * props.zoom,
    y: offset.y - workArea.value.y * props.zoom,
  };
}

function canvasPosition(geometry: ElementGeometry): Point {
  return {
    x: geometry.x - workArea.value.x,
    y: geometry.y - workArea.value.y,
  };
}

function workAreaViewBox(): string {
  return `${workArea.value.x} ${workArea.value.y} ${workArea.value.width} ${workArea.value.height}`;
}

function expandWorkAreaFor(changes: readonly GeometryChange[]): boolean {
  if (changes.length === 0) return false;
  const previous = workArea.value;
  const next = expandDiagramWorkAreaBounds(
    previous,
    changes.map((change) => change.geometry),
  );
  return replaceWorkArea(next);
}

function replaceWorkArea(next: DiagramWorkAreaBounds): boolean {
  const previous = workArea.value;
  if (
    next.x === previous.x
    && next.y === previous.y
    && next.width === previous.width
    && next.height === previous.height
  ) return false;
  workArea.value = next;
  const shiftX = (previous.x - next.x) * props.zoom;
  const shiftY = (previous.y - next.y) * props.zoom;
  if (!shiftX && !shiftY) return true;
  void nextTick(() => {
    const element = scrollElement.value;
    if (!element) return;
    setViewportScroll(element.scrollLeft + shiftX, element.scrollTop + shiftY);
  });
  return true;
}

function snapshotScene(scene: DiagramScene): DiagramScene {
  return {
    ...scene,
    nodes: scene.nodes.map((node) => ({ ...node, geometry: { ...node.geometry } })),
    containers: scene.containers.map((container) => ({
      ...container,
      geometry: { ...container.geometry },
    })),
    regions: scene.regions?.map((region) => ({
      ...region,
      geometry: { ...region.geometry },
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
        :style="{ width: `${workArea.width * zoom}px`, height: `${workArea.height * zoom}px` }"
      >
        <div
          class="iriograph-diagram-canvas"
          v-memo="[
            scene,
            workArea,
            zoom,
            previewGeometries,
            previewRouting,
            selectedElementId,
            selectedElementIds,
            activeNavigatorElementId,
            readOnly,
            semanticDraftPosition,
            semanticEndpointReconnect,
            semanticReconnectPreview,
            containmentWarningElementIds,
            semanticMetadata,
            showAllComments,
            showGrid,
            snap.grid.size,
            edgeRouteModes,
            deletionPreviewResourceRefs,
            deletionPreviewStatementRefs,
          ]"
          :style="{
            width: `${workArea.width}px`,
            height: `${workArea.height}px`,
            transform: `scale(${zoom})`,
            '--iriograph-grid-size': `${snap.grid.size}px`,
          }"
          @contextmenu="requestBlankContextMenu"
        >
          <div
            v-if="showGrid"
            class="iriograph-canvas-grid"
            aria-hidden="true"
            :style="{ backgroundPosition: `${-workArea.x}px ${-workArea.y}px` }"
          />
          <p v-if="regionConstraintMessage" class="iriograph-region-constraint-warning" role="alert">{{ regionConstraintMessage }}</p>
          <span
            v-if="semanticDraftPosition"
            class="iriograph-semantic-position-marker"
            aria-label="Semantic draft position"
            :style="{ left: `${semanticDraftPosition.x - workArea.x}px`, top: `${semanticDraftPosition.y - workArea.y}px` }"
          />

          <div
            v-for="region in orderedRegions"
            :key="region.elementId"
            :id="navigatorDomId(region.elementId)"
            class="iriograph-scene-region"
            :class="[{ selected: selectedElementIdsSet.has(region.elementId), 'interaction-front': selectedElementIdsSet.has(region.elementId), 'navigator-active': activeNavigatorElementId === region.elementId, 'deletion-preview': isDeletionPreviewResource(region) }, diagnosticClass(region)]"
            role="option"
            tabindex="-1"
            :data-element-id="region.elementId"
            :aria-label="`${navigatorAriaLabel(region.elementId, region.label, 'region')}${diagnosticAriaSuffix(region)}`"
            :aria-selected="selectedElementIdsSet.has(region.elementId)"
            :aria-posinset="navigatorPosition(region.elementId)"
            :aria-setsize="navigatorItems.length"
            :style="{
              left: `${canvasPosition(geometryFor(region)).x}px`,
              top: `${canvasPosition(geometryFor(region)).y}px`,
              width: `${geometryFor(region).width}px`,
              height: `${geometryFor(region).height}px`,
              borderColor: region.style.stroke,
              borderWidth: `${region.style.strokeWidth ?? 1}px`,
              borderStyle: region.style.dash && region.style.dash !== '0' ? 'dashed' : 'solid',
              color: region.style.text,
            }"
            @pointerdown="startMove($event, region)"
            @keydown="handleGeometrySemanticKeydown($event, region.elementId)"
            @contextmenu="requestPointerContextMenu($event, 'region', region.elementId)"
          >
            <span class="iriograph-region-fill" :style="{ background: region.style.fill, opacity: region.style.fillOpacity ?? 0.28 }" />
            <span
              class="iriograph-region-label"
              :class="[
                `label-${region.labelPlacement ?? 'top'}`,
                `writing-${region.regionLabelWritingDirection === 'vertical-down' || (!region.regionLabelWritingDirection && (region.labelPlacement === 'left' || region.labelPlacement === 'right')) ? 'vertical' : 'horizontal'}`,
              ]"
              :style="regionLabelStyle(region)"
              title="ドラッグしてラベルを領域の枠上で移動"
              @pointerdown="startRegionLabelMove($event, region)"
            >{{ region.label }}</span>
            <span v-if="additionalLabels(region.semanticRef, region.label).length" class="iriograph-additional-labels">{{ additionalLabels(region.semanticRef, region.label).join(' ／ ') }}</span>
            <span v-if="commentsFor(region.semanticRef)" class="iriograph-comment-callout" :class="{ visible: showAllComments }" role="note">{{ commentsFor(region.semanticRef) }}</span>
          </div>

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
              semanticMetadata[container.semanticRef],
              showAllComments,
              isDeletionPreviewResource(container),
            ]"
            :id="navigatorDomId(container.elementId)"
            class="iriograph-scene-container"
            :class="[{ selected: selectedElementIdsSet.has(container.elementId), 'interaction-front': container.groupRole === 'sequence' && selectedElementIdsSet.has(container.elementId), 'navigator-active': activeNavigatorElementId === container.elementId, 'containment-warning': containmentWarningElementIdsSet.has(container.elementId), 'deletion-preview': isDeletionPreviewResource(container), 'sequence-group': container.groupRole === 'sequence' }, diagnosticClass(container)]"
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
              left: `${canvasPosition(geometryFor(container)).x}px`,
              top: `${canvasPosition(geometryFor(container)).y}px`,
              width: `${geometryFor(container).width}px`,
              height: `${geometryFor(container).height}px`,
              background: container.style.fill,
              borderColor: container.style.stroke,
              borderWidth: `${container.style.strokeWidth ?? 1}px`,
              borderStyle: container.style.dash && container.style.dash !== '0' ? 'dashed' : 'solid',
              color: container.style.text,
            }"
            @pointerdown="startMove($event, container)"
            @keydown="handleGeometrySemanticKeydown($event, container.elementId)"
            @contextmenu="requestPointerContextMenu($event, 'container', container.elementId)"
          >
            <span
              class="iriograph-container-header"
              :class="`header-${container.headerPosition}`"
              :style="{ background: container.style.accent }"
            >
              {{ container.label }}
            </span>
            <span v-if="additionalLabels(container.semanticRef, container.label).length" class="iriograph-additional-labels">{{ additionalLabels(container.semanticRef, container.label).join(' ／ ') }}</span>
            <span v-if="commentsFor(container.semanticRef)" class="iriograph-comment-callout" :class="{ visible: showAllComments }" role="note">{{ commentsFor(container.semanticRef) }}</span>
            <span v-if="sequenceMemberBadges(container.elementId).length" class="iriograph-sequence-badges" aria-label="並び順"><span v-for="badge in sequenceMemberBadges(container.elementId)" :key="badge.key" :title="`${badge.label}の${badge.ordinal}番`">{{ badge.ordinal }}</span></span>
          </div>

          <svg
            ref="edgeLayerElement"
            class="iriograph-edge-layer"
            :width="workArea.width"
            :height="workArea.height"
            :viewBox="workAreaViewBox()"
            aria-label="関係edge"
          >
            <defs>
              <marker :id="markerIds.arrow" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto-start-reverse" markerUnits="strokeWidth">
                <path d="M0,0 L9,4.5 L0,9 z" fill="context-stroke" />
              </marker>
              <marker :id="markerIds['open-arrow']" markerWidth="10" markerHeight="10" refX="9" refY="5" orient="auto-start-reverse" markerUnits="strokeWidth">
                <path d="M1,1 L9,5 L1,9" fill="none" stroke="context-stroke" stroke-width="1.5" />
              </marker>
              <marker :id="markerIds.triangle" markerWidth="10" markerHeight="10" refX="9" refY="5" orient="auto-start-reverse" markerUnits="strokeWidth">
                <path d="M1,1 L9,5 L1,9 z" fill="context-stroke" />
              </marker>
              <marker :id="markerIds.diamond" markerWidth="11" markerHeight="11" refX="10" refY="5.5" orient="auto-start-reverse" markerUnits="strokeWidth">
                <path d="M1,5.5 L5.5,1 L10,5.5 L5.5,10 z" fill="context-stroke" />
              </marker>
              <marker :id="markerIds.circle" markerWidth="10" markerHeight="10" refX="9" refY="5" orient="auto-start-reverse" markerUnits="strokeWidth">
                <circle cx="5" cy="5" r="3.5" fill="context-stroke" />
              </marker>
            </defs>
            <path
              v-for="membership in deletionPreviewMemberships"
              :key="`deletion-membership:${membership.semanticRef}`"
              class="iriograph-deletion-preview-membership"
              :data-semantic-ref="membership.semanticRef"
              :d="deletionPreviewMembershipPath(membership)"
            />
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
                edgeRouteModes[edge.elementId],
                isDeletionPreviewEdge(edge),
              ]"
              :id="navigatorDomId(edge.elementId)"
              class="iriograph-edge-group"
              :class="[{ selected: selectedElementIdsSet.has(edge.elementId), 'navigator-active': activeNavigatorElementId === edge.elementId, fallback: edge.fallback, 'deletion-preview': isDeletionPreviewEdge(edge) }, diagnosticClass(edge)]"
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
              @contextmenu="requestPointerContextMenu($event, 'edge', edge.elementId)"
            >
              <title v-if="edgeSemanticComments(edge)">{{ edgeSemanticComments(edge) }}</title>
              <path class="iriograph-edge-hitarea" :d="pathFor(edge)" />
              <path
                class="iriograph-edge-path"
                :d="pathFor(edge)"
                :stroke="edge.style.stroke"
                :stroke-dasharray="edge.style.dash"
                :stroke-width="edge.style.strokeWidth"
                :marker-start="terminalMarkerUrl(edge.sourceMarker ?? 'none')"
                :marker-end="terminalMarkerUrl(edge.targetMarker ?? 'arrow')"
              />
              <text
                v-if="edge.label || sequenceOrdinalBadge(edge) || edge.caption"
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
                <tspan :x="edgeLabelPosition(edge).x">{{ edge.label || sequenceOrdinalBadge(edge) }}</tspan>
                <tspan
                  v-for="(line, index) in edgeCaptionLines(edge)"
                  :key="index"
                  class="iriograph-edge-caption"
                  :x="edgeLabelPosition(edge).x"
                  :dy="index === 0 ? 14 : 12"
                >{{ line }}</tspan>
              </text>
            </g>
          </svg>

          <div
            v-for="node in scene.nodes"
            :key="node.elementId"
            v-memo="[
              node,
              previewGeometries[node.elementId],
              previewNodeContentOffsets[node.elementId],
              nodeContentEditing,
              selectedElementIdsSet.has(node.elementId),
              activeNavigatorElementId === node.elementId,
              containmentWarningElementIdsSet.has(node.elementId),
              scene.diagnostics,
              readOnly,
              semanticMetadata[node.semanticRef],
              showAllComments,
              isDeletionPreviewResource(node),
              semanticReconnectPreview?.targetElementId === node.elementId,
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
                'deletion-preview': isDeletionPreviewResource(node),
                'semantic-reconnect-target': semanticReconnectPreview?.targetElementId === node.elementId,
                ...diagnosticClass(node),
              },
            ]"
            :style="{
              left: `${canvasPosition(geometryFor(node)).x}px`,
              top: `${canvasPosition(geometryFor(node)).y}px`,
              width: `${geometryFor(node).width}px`,
              height: `${geometryFor(node).height}px`,
              background: node.style.fill,
              borderColor: node.style.stroke,
              borderWidth: `${node.style.strokeWidth ?? 1}px`,
              borderStyle: node.style.dash && node.style.dash !== '0' ? 'dashed' : 'solid',
              color: node.style.text,
              '--iriograph-node-accent': node.style.accent ?? node.style.stroke,
            }"
            :aria-label="`${navigatorAriaLabel(node.elementId, node.label, 'node')}${diagnosticAriaSuffix(node)}`"
            :aria-selected="selectedElementIdsSet.has(node.elementId)"
            :aria-posinset="navigatorPosition(node.elementId)"
            :aria-setsize="navigatorItems.length"
            @pointerdown="startMove($event, node)"
            @keydown="handleGeometrySemanticKeydown($event, node.elementId)"
            @contextmenu="requestPointerContextMenu($event, 'node', node.elementId)"
          >
            <span class="iriograph-node-content" :class="{ editable: nodeContentEditing && selectedElementIdsSet.has(node.elementId) && !readOnly }">
              <img
                v-if="node.iconUrl"
                class="iriograph-node-icon"
                :class="{ editable: nodeContentEditing && selectedElementIdsSet.has(node.elementId) && !readOnly }"
                :style="nodeContentOffsetStyle(node, 'icon')"
                :src="node.iconUrl"
                alt=""
                draggable="false"
                :title="nodeContentEditing ? 'ドラッグしてアイコン位置を調整' : undefined"
                @pointerdown="startNodeContentMove($event, node, 'icon')"
              />
              <span
                class="iriograph-node-text"
                :class="[
                  `writing-${node.nodeLabelWritingDirection === 'vertical-down' ? 'vertical' : 'horizontal'}`,
                  { editable: nodeContentEditing && selectedElementIdsSet.has(node.elementId) && !readOnly },
                ]"
                :style="nodeContentOffsetStyle(node, 'label')"
                :title="nodeContentEditing ? 'ドラッグしてラベル位置を調整' : undefined"
                @pointerdown="startNodeContentMove($event, node, 'label')"
              ><span class="iriograph-node-label">{{ node.label }}</span><small v-if="additionalLabels(node.semanticRef, node.label).length" class="iriograph-additional-labels">{{ additionalLabels(node.semanticRef, node.label).join(' ／ ') }}</small></span>
            </span>
            <span v-if="commentsFor(node.semanticRef)" class="iriograph-comment-callout" :class="{ visible: showAllComments }" role="note">{{ commentsFor(node.semanticRef) }}</span>
            <span v-if="node.shape === 'diamond'" class="iriograph-gateway-mark">×</span>
            <span v-if="node.placement === 'user'" class="iriograph-pin-indicator" title="ユーザー調整済み">●</span>
            <span v-if="sequenceMemberBadges(node.elementId).length" class="iriograph-sequence-badges" aria-label="並び順"><span v-for="badge in sequenceMemberBadges(node.elementId)" :key="badge.key" :title="`${badge.label}の${badge.ordinal}番`">{{ badge.ordinal }}</span></span>
          </div>

          <svg class="iriograph-edge-interaction-layer" :width="workArea.width" :height="workArea.height" :viewBox="workAreaViewBox()" aria-hidden="true">
            <path
              v-if="semanticReconnectPreview"
              class="iriograph-semantic-reconnect-preview"
              :d="semanticReconnectPath()"
            />
            <g v-if="selectedEdge && !readOnly && waypointEditingAllowed(selectedEdge)" class="iriograph-waypoints">
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
            <g v-if="selectedEdge && !readOnly" class="iriograph-endpoint-anchors" :class="{ semantic: semanticEndpointReconnect }">
              <template v-for="endpoint in (['source', 'target'] as const)" :key="endpoint">
                <line
                  v-if="endpointAnchorHalo(selectedEdge, endpoint)"
                  class="iriograph-endpoint-stub"
                  :x1="endpointAnchorHalo(selectedEdge, endpoint)!.stub.from.x"
                  :y1="endpointAnchorHalo(selectedEdge, endpoint)!.stub.from.y"
                  :x2="endpointAnchorHalo(selectedEdge, endpoint)!.stub.to.x"
                  :y2="endpointAnchorHalo(selectedEdge, endpoint)!.stub.to.y"
                />
                <circle
                  v-if="endpointAnchorHalo(selectedEdge, endpoint)"
                  :class="endpoint"
                  :cx="endpointAnchorHalo(selectedEdge, endpoint)!.haloPoint.x"
                  :cy="endpointAnchorHalo(selectedEdge, endpoint)!.haloPoint.y"
                  r="12"
                  @pointerdown="startEndpointAnchorMove($event, selectedEdge, endpoint)"
                ><title>{{ semanticEndpointReconnect ? `${endpoint === 'source' ? '始点' : '終点'}を別の要素へ接続` : `${endpoint === 'source' ? '始点' : '終点'}の接続位置` }}</title></circle>
              </template>
            </g>
          </svg>
          <div
            v-if="selectedResizeElement"
            class="iriograph-transient-resize-layer"
            aria-label="選択要素のサイズ変更"
          >
            <span
              v-for="handle in RESIZE_HANDLES"
              :key="handle"
              class="iriograph-resize-handle"
              :data-handle="handle"
              :style="resizeHandleStyle(selectedResizeElement, handle)"
              :title="`選択要素のサイズを${handle}方向から変更`"
              @pointerdown="startResize($event, selectedResizeElement, handle)"
            />
          </div>
        </div>
      </div>
    </div>

    <aside class="iriograph-minimap" aria-label="Diagram minimap">
      <svg
        :viewBox="workAreaViewBox()"
        preserveAspectRatio="none"
        tabindex="-1"
        aria-label="Minimapでviewportを移動"
        @keydown="handleMinimapKeydown"
        @pointerdown="beginMinimapPan"
      >
        <rect class="iriograph-minimap-paper" :x="workArea.x" :y="workArea.y" :width="workArea.width" :height="workArea.height" />
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
        <rect
          v-for="region in scene.regions ?? []"
          :key="region.elementId"
          class="iriograph-minimap-region"
          :x="geometryFor(region).x"
          :y="geometryFor(region).y"
          :width="geometryFor(region).width"
          :height="geometryFor(region).height"
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
