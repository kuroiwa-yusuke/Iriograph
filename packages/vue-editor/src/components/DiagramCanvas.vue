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
  EdgeCurveRouting,
  EdgeTerminalMarker,
  EdgeEndpointShape,
  ElementGeometry,
  GroupFrameKind,
  Point,
  ProjectionDiagnostic,
  SceneContainer,
  SceneAnnotation,
  SceneEdge,
  SceneGroupGuide,
  SceneNode,
  SceneRegion,
} from "@iriograph/core";
import {
  diagnosticTargetsSceneElement,
  edgeEndpointAnchorFromPoint,
  edgeEndpointAnchorHaloGeometry,
  edgeEndpointAnchorPoint,
  resolveIconContentMetrics,
} from "@iriograph/core";

import {
  appendEdgeCurveKnot,
  appendEdgeWaypoint,
  copyEdgeCurveRouting,
  cubicCurvePath,
  derivedSceneCurveRouting,
  derivedEdgeRoute,
  editableEdgeWaypoints,
  edgeCurveControlHandles,
  edgeCurveKnotAppendIndex,
  edgeLabelBase,
  insertEdgeCurveKnot,
  insertEdgeWaypoint,
  moveEdgeCurveKnot,
  moveEdgeWaypoint,
  pointAtCurveFraction,
  previewEdgeRoute,
  removeEdgeCurveHandle,
  removeEdgeCurveKnot,
  removeEdgeWaypoint,
  renderedEdgeRouteFamily,
  routingWithCurve,
  routingWithLabelOffset,
  routingWithEndpointAnchor,
  routingWithWaypoints,
  updateEdgeCurveHandle,
  type EditableEdgeRouting,
  type EdgeCurveControlHandle,
  type EdgeRoutingUpdate,
} from "../canvas/edge-routing";
import {
  moveSceneNavigatorFocus,
  restoreSceneNavigatorFocus,
  sceneNavigatorItems,
  type SceneNavigatorItem,
} from "../navigation/scene-navigation";
import {
  keyboardArrowMovement,
  resolveCanvasKeyboardCommand,
} from "../navigation/keyboard-commands";
import {
  diagramContentBounds,
  diagramWorkAreaBounds,
  diagramFitZoom,
  edgeRenderedBoundsPoints,
  expandDiagramWorkAreaBounds,
  normalizeDiagramZoom,
  scrollToRevealBounds,
  type DiagramCanvasNavigationApi,
  type DiagramViewportMetrics,
  type DiagramViewportState,
  type DiagramWorkAreaBounds,
} from "../navigation/viewport";
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
} from "../canvas/selection";
import type {
  DiagramContextMenuRequest,
  DiagramContextTargetKind,
} from "../inspector/context-actions";
import {
  semanticTextLabel,
  type SemanticDisplayMetadata,
} from "../authoring/semantic-metadata";
import {
  constrainIconPresentationResize,
  constrainMembershipRegionMovement,
} from "../canvas/region-membership-constraints";
import type { CanvasDragMode, CollapsedGroupSummary } from "../document/view-session";
import type { DiagramNodeTypeTagPresentation } from "../authoring/type-system";

const props = withDefaults(defineProps<{
  scene: DiagramScene;
  /** Resets the ephemeral work area only when the owning document/view changes. */
  sceneSessionKey?: string;
  selectedElementId?: string;
  selectedElementIds?: string[];
  selectedAnnotationId?: string;
  zoom?: number;
  readOnly?: boolean;
  snap?: DiagramSnapSettings;
  semanticPositionPicking?: boolean;
  semanticResourcePicking?: boolean;
  structuredSelectionPicking?: boolean;
  structuredSelectionPickLabel?: string;
  /** Enables semantic endpoint reassignment handles for a selected direct edge. */
  semanticEndpointReconnect?: boolean;
  /** Enables independent node-local label/icon placement gestures. */
  nodeContentEditing?: boolean;
  /** Grows the node box with an icon resize instead of clipping at its frame. */
  nodeIconGrowNode?: boolean;
  semanticResourcePickLabel?: string;
  semanticDraftPosition?: Point;
  containmentWarningElementIds?: string[];
  semanticMetadata?: Readonly<Record<string, SemanticDisplayMetadata>>;
  showAllComments?: boolean;
  showGrid?: boolean;
  /** DOM-safe derived type tags keyed by Scene node identity. */
  nodeTypeTags?: Readonly<Record<string, DiagramNodeTypeTagPresentation>>;
  /** Session-only highlight; never copied into Scene or view overlay. */
  typeHighlightElementIds?: readonly string[];
  /** Session-only aggregate badges for folded group frames. */
  collapsedGroupSummaries?: Readonly<Record<string, CollapsedGroupSummary>>;
  /** Session-only meaning of primary blank/group-interior drag. */
  dragMode?: CanvasDragMode;
  /** Ephemeral semantic preview only; never part of Scene or the document. */
  deletionPreviewResourceRefs?: readonly string[];
  /** Exact statement identities removed by the pending semantic patch. */
  deletionPreviewStatementRefs?: readonly string[];
  edgeRouteModes?: Readonly<Record<string, "auto" | "straight" | "orthogonal" | "curve" | "manual">>;
  busy?: boolean;
}>(), {
  selectedElementId: "",
  selectedElementIds: () => [],
  selectedAnnotationId: "",
  zoom: 1,
  readOnly: false,
  snap: () => normalizeDiagramSnapSettings(),
  semanticPositionPicking: false,
  semanticResourcePicking: false,
  structuredSelectionPicking: false,
  structuredSelectionPickLabel: "対象",
  semanticEndpointReconnect: false,
  nodeContentEditing: false,
  nodeIconGrowNode: true,
  semanticResourcePickLabel: "resource",
  semanticDraftPosition: undefined,
  containmentWarningElementIds: () => [],
  semanticMetadata: () => ({}),
  showAllComments: false,
  showGrid: true,
  nodeTypeTags: () => ({}),
  typeHighlightElementIds: () => [],
  collapsedGroupSummaries: () => ({}),
  dragMode: "select",
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
  nodeIconPresentationUpdate: [payload: {
    elementId: string;
    size: { width: number; height: number };
    geometry?: ElementGeometry;
  }];
  regionLabelUpdate: [payload: { elementId: string; anchor: number; offset?: number }];
  groupLabelUpdate: [payload: { elementId: string; anchor: number; offset?: number }];
  groupIconOffsetUpdate: [payload: { elementId: string; offset?: Point }];
  /** Requests atomic deletion of the active semantic selection. */
  semanticEditRequest: [elementId: string];
  /** Seeds draft coordinates only; it never mutates the graph or history. */
  semanticPositionRequest: [position: Point, containerIri?: string];
  /** Explicit picker mode only; normal selection and drag never emit this. */
  semanticResourceRequest: [semanticRef: string];
  structuredSelectionRequest: [request: DiagramSelectionRequest];
  structuredSelectionSetRequest: [request: {
    elementIds: string[];
    mode: "replace" | "add" | "toggle";
  }];
  /** Seeds a direct-edge replacement draft; it never mutates semantic or view state. */
  semanticEndpointReconnectRequest: [payload: {
    edgeElementId: string;
    endpoint: "source" | "target";
    targetSemanticRef: string;
  }];
  semanticPickCancel: [];
  contextMenuRequest: [request: DiagramContextMenuRequest];
  typeTagRequest: [payload: {
    elementId: string;
    typeId: string;
    resourceId: string;
  }];
  annotationRequest: [payload: { annotationId: string; annotationKind: "semantic-literal" | "view"; anchorElementId?: string }];
  annotationGeometryChange: [payload: { annotationId: string; geometry: ElementGeometry }];
  /** @deprecated Use routingUpdate for the complete sparse routing value. */
  routingChange: [payload: { elementId: string; waypoints: Point[] }];
}>();

const CANVAS_PADDING = 20;
const PAN_KEY_STEP = 64;
const DRAG_AUTO_PAN_MARGIN = 48;
const DRAG_AUTO_PAN_MAX_STEP = 24;
const GRID_MIN_SCREEN_STEP = 8;
const RESIZE_HANDLES: readonly ResizeHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const instanceId = useId();
const markerIds: Record<Exclude<EdgeTerminalMarker, "none">, string> = {
  arrow: `${instanceId}-arrow`,
  "open-arrow": `${instanceId}-open-arrow`,
  triangle: `${instanceId}-triangle`,
  diamond: `${instanceId}-diamond`,
  circle: `${instanceId}-circle`,
};
const sequenceGuideArrowId = `${instanceId}-sequence-guide-arrow`;
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
let workAreaHasSceneContent = sceneHasWorkspaceContent(props.scene);
const viewportPanning = ref(false);
const selectionMarquee = ref<{
  origin: Point;
  current: Point;
  mode: "replace" | "add" | "toggle";
}>();
const previewGeometries = ref<Record<string, ElementGeometry>>({});
const previewRouting = ref<Record<string, EditableEdgeRouting | null>>({});
const previewNodeContentOffsets = ref<Record<string, { label?: Point; icon?: Point }>>({});
const previewNodeIconSizes = ref<Record<string, { width: number; height: number }>>({});
const previewGroupIconOffsets = ref<Record<string, Point>>({});
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

type CurveKeyboardTarget =
  | { kind: "knot"; knotIndex: number }
  | { kind: "handle"; handle: EdgeCurveControlHandle };

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
const typeHighlightElementIdsSet = computed(() => new Set(props.typeHighlightElementIds));
const deletionPreviewResourceRefsSet = computed(() => new Set(
  props.deletionPreviewResourceRefs,
));
const deletionPreviewStatementRefsSet = computed(() => new Set(
  props.deletionPreviewStatementRefs,
));
const selectedEdge = computed(() => props.scene.edges.find((edge) => edge.elementId === props.selectedElementId));
const selectedIconNode = computed(() => props.nodeContentEditing && !props.readOnly
  ? props.scene.nodes.find((node) => node.elementId === props.selectedElementId && node.iconUrl)
  : undefined);
const selectedResizeElement = computed<GeometryElement | undefined>(() => {
  if (props.readOnly || selectedElementIdsSet.value.size !== 1) return undefined;
  return [
    ...props.scene.containers,
    ...(props.scene.regions ?? []),
    ...props.scene.nodes,
  ].find((element) => element.elementId === props.selectedElementId);
});
const orderedRegions = computed(() => [...(props.scene.regions ?? [])].sort((left, right) => (
  (left.groupZOrder ?? left.regionZOrder ?? 0) - (right.groupZOrder ?? right.regionZOrder ?? 0)
  || left.elementId.localeCompare(right.elementId)
)));
const orderedContainers = computed(() => [...props.scene.containers].sort((left, right) => (
  (left.groupZOrder ?? 0) - (right.groupZOrder ?? 0)
  || left.elementId.localeCompare(right.elementId)
)));
const orderedGroupFrames = computed(() => [
  ...props.scene.containers.filter((element) => Boolean(element.groupFrame)),
  ...(props.scene.regions ?? []).filter((element) => Boolean(element.groupFrame)),
].sort((left, right) => (
  (left.groupZOrder ?? 0) - (right.groupZOrder ?? 0)
  || left.structuralKind.localeCompare(right.structuralKind)
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
const canvasGridStyle = computed<Record<string, string>>(() => {
  const zoom = Math.max(.1, props.zoom);
  const snapSize = props.snap.grid.size;
  const visualStepMultiplier = Math.max(1, Math.ceil(GRID_MIN_SCREEN_STEP / (snapSize * zoom)));
  return {
    "--iriograph-grid-size": `${snapSize}px`,
    "--iriograph-grid-visual-step": `${snapSize * visualStepMultiplier}px`,
    "--iriograph-grid-line-width": `${Number((1 / zoom).toFixed(4))}px`,
  };
});
const selectionMarqueeGeometry = computed<ElementGeometry | undefined>(() => {
  const marquee = selectionMarquee.value;
  if (!marquee) return undefined;
  const x = Math.min(marquee.origin.x, marquee.current.x);
  const y = Math.min(marquee.origin.y, marquee.current.y);
  return {
    x,
    y,
    width: Math.abs(marquee.current.x - marquee.origin.x),
    height: Math.abs(marquee.current.y - marquee.origin.y),
  };
});

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

function typeTagTitle(tag: DiagramNodeTypeTagPresentation): string {
  const remaining = [
    tag.additionalDirectCount ? `他の直接の型 ${tag.additionalDirectCount}件` : "",
    tag.inheritedCount ? `継承する型 ${tag.inheritedCount}件` : "",
  ].filter(Boolean).join("、");
  return remaining ? `${tag.label}。${remaining}は型一覧で確認` : `${tag.label}。型一覧で確認`;
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
  [
    () => props.scene,
    () => props.sceneSessionKey ?? props.scene.viewId,
  ],
  ([nextScene, nextSessionKey], [, previousSessionKey]) => {
    // A host-driven Scene replacement invalidates the gesture snapshot. Do
    // not let a later keyup commit geometry or routing derived from stale IDs.
    if (keyboardGesture) cancelKeyboardGesture();
    else clearKeyboardPreview();
    previewNodeIconSizes.value = {};
    const nextHasSceneContent = sceneHasWorkspaceContent(nextScene);
    if (nextSessionKey !== previousSessionKey) {
      replaceWorkArea(diagramWorkAreaBounds(nextScene));
      workAreaHasSceneContent = nextHasSceneContent;
    } else if (!workAreaHasSceneContent && nextHasSceneContent) {
      replaceWorkArea(diagramWorkAreaBounds(nextScene));
      workAreaHasSceneContent = true;
    } else if (nextHasSceneContent) {
      // Route completion and local semantic reconciliation can change the
      // content bounds while every surviving geometry remains fixed. Keep the
      // current semantic origin whenever the new content still fits inside the
      // session workspace; grow it monotonically only when more room is needed.
      replaceWorkArea(expandDiagramWorkAreaBounds(
        workArea.value,
        [diagramContentBounds(nextScene)],
      ));
    }
    if (props.semanticPositionPicking || props.semanticResourcePicking || props.structuredSelectionPicking) emit("semanticPickCancel");
  },
);

watch(() => props.readOnly, (readOnly) => {
  // Permission can change while a key is held. Pending presentation writes
  // are discarded at that boundary, while navigation remains available.
  if (readOnly && keyboardGesture) cancelKeyboardGesture();
  if (readOnly) {
    previewNodeContentOffsets.value = {};
    previewNodeIconSizes.value = {};
    previewRouting.value = {};
  }
});

watch(() => props.nodeContentEditing, (enabled) => {
  if (!enabled) {
    previewNodeContentOffsets.value = {};
    previewNodeIconSizes.value = {};
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
  // Backwards-compatible hand-authored Scene fixtures may not yet provide a
  // renderer-ready route choice. Current Core scenes always do.
  if (edgeRouteMode(edge) === "auto" && !edge.derivedRouteChoice) {
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
  const family = renderedEdgeRouteFamily(edge, edgeRouteMode(edge));
  if (family === "straight") return polylinePath([start, end]);
  if (family === "orthogonal") return orthogonalPath(route);
  if (family === "curve") return cubicCurvePath(route, renderedCurve(edge));
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

function edgeLabelPosition(edge: SceneEdge): Point {
  const route = renderedRoute(edge);
  const base = renderedEdgeRouteFamily(edge, edgeRouteMode(edge)) === "curve"
    ? pointAtCurveFraction(route, renderedCurve(edge), .5)
    : edgeLabelBase({ route });
  const preview = previewRouting.value[edge.elementId];
  const labelOffset = preview === undefined ? edge.labelOffset : preview?.labelOffset;
  return {
    x: base.x + (labelOffset?.x ?? 0),
    y: base.y + (labelOffset?.y ?? 0),
  };
}

function currentCurve(edge: SceneEdge): EdgeCurveRouting | undefined {
  const preview = previewRouting.value[edge.elementId];
  return preview === undefined ? edge.curve : preview?.curve;
}

function renderedCurve(edge: SceneEdge): EdgeCurveRouting | undefined {
  return edgeRouteMode(edge) === "auto"
    ? derivedSceneCurveRouting(edge)
    : currentCurve(edge);
}

function selectedCurveHandles(edge: SceneEdge): EdgeCurveControlHandle[] {
  if (edgeRouteMode(edge) !== "curve") return [];
  return edgeCurveControlHandles(renderedRoute(edge), currentCurve(edge));
}

function selectedCurveKnots(edge: SceneEdge): NonNullable<EdgeCurveRouting["knots"]> {
  return currentCurve(edge)?.knots ?? [];
}

function isActiveCurveKnot(index: number): boolean {
  return index === activeWaypointIndex.value;
}

function isActiveCurveHandle(edge: SceneEdge, handleIndex: number): boolean {
  return selectedCurveKnots(edge).length + handleIndex === activeWaypointIndex.value;
}

function curveKeyboardTargets(
  edge: SceneEdge,
  curve: EdgeCurveRouting | undefined = currentCurve(edge),
): CurveKeyboardTarget[] {
  return [
    ...(curve?.knots ?? []).map((_, knotIndex): CurveKeyboardTarget => ({
      kind: "knot",
      knotIndex,
    })),
    ...edgeCurveControlHandles(renderedRoute(edge), curve).map((handle): CurveKeyboardTarget => ({
      kind: "handle",
      handle,
    })),
  ];
}

/** Keeps curve controls approximately constant-sized on screen at every zoom. */
function curveControlRadius(kind: "knot" | "handle"): number {
  return (kind === "knot" ? 9 : 7) / Math.max(.1, props.zoom);
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
  if (
    !props.semanticPositionPicking
    && !props.semanticResourcePicking
    && !event.altKey
    && (element.structuralKind === "container" || element.structuralKind === "region")
    && structureInteriorTarget(event)
  ) {
    event.stopPropagation();
    if (props.dragMode === "pan" && !props.structuredSelectionPicking) {
      startViewportPan(event, element, true);
    } else {
      startSelectionMarquee(event, element);
    }
    return;
  }
  if (props.structuredSelectionPicking) {
    event.preventDefault();
    event.stopPropagation();
    if (!props.readOnly) emit("structuredSelectionRequest", selectionRequest(
      event,
      element.elementId,
      selectedElementIdsSet.value.has(element.elementId),
    ));
    return;
  }
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
  scrollElement.value?.focus({ preventScroll: true });
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

function annotationGeometry(annotation: SceneAnnotation): ElementGeometry {
  return previewGeometries.value[annotation.elementId] ?? annotation.geometry;
}

function startAnnotationMove(event: PointerEvent, annotation: SceneAnnotation): void {
  event.preventDefault();
  event.stopPropagation();
  emit("annotationRequest", {
    annotationId: annotation.annotationId,
    annotationKind: annotation.annotationKind,
    anchorElementId: annotation.anchorElementId,
  });
  if (props.readOnly || event.button !== 0 || annotation.annotationKind !== "view") return;
  emit("gestureStart");
  const origin = { x: event.clientX, y: event.clientY };
  const initial = { ...annotation.geometry };
  let pending = initial;
  trackPointer((moveEvent) => {
    pending = {
      ...initial,
      x: Math.max(0, initial.x + (moveEvent.clientX - origin.x) / props.zoom),
      y: Math.max(0, initial.y + (moveEvent.clientY - origin.y) / props.zoom),
    };
    previewGeometries.value = {
      ...previewGeometries.value,
      [annotation.elementId]: pending,
    };
  }, (cancelled) => {
    const next = { ...previewGeometries.value };
    delete next[annotation.elementId];
    previewGeometries.value = next;
    if (!cancelled && (pending.x !== initial.x || pending.y !== initial.y)) {
      emit("annotationGeometryChange", { annotationId: annotation.annotationId, geometry: pending });
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

function startCurveKnotMove(event: PointerEvent, edge: SceneEdge, index: number): void {
  if (props.readOnly || event.button !== 0 || edgeRouteMode(edge) !== "curve") return;
  event.preventDefault();
  event.stopPropagation();
  requestSelection({ elementId: edge.elementId, mode: "replace" });
  emit("gestureStart");
  const origin = { x: event.clientX, y: event.clientY };
  const initial = currentCurve(edge);
  let pending = initial;
  let changed = false;
  trackPointer((moveEvent) => {
    pending = moveEdgeCurveKnot(initial, index, {
      x: (moveEvent.clientX - origin.x) / props.zoom,
      y: (moveEvent.clientY - origin.y) / props.zoom,
    }, { width: props.scene.width, height: props.scene.height, padding: 8 });
    previewRouting.value = {
      ...previewRouting.value,
      [edge.elementId]: routingWithCurve(edge, pending) ?? null,
    };
    changed = true;
  }, (cancelled) => {
    clearRoutingPreview(edge.elementId);
    if (!cancelled && changed && !props.readOnly) emitCurveRouting(edge, pending);
  });
}

function startCurveHandleMove(
  event: PointerEvent,
  edge: SceneEdge,
  handle: EdgeCurveControlHandle,
): void {
  if (props.readOnly || event.button !== 0 || edgeRouteMode(edge) !== "curve") return;
  event.preventDefault();
  event.stopPropagation();
  requestSelection({ elementId: edge.elementId, mode: "replace" });
  emit("gestureStart");
  const origin = { x: event.clientX, y: event.clientY };
  const initial = currentCurve(edge);
  const route = renderedRoute(edge);
  let pending = initial;
  let changed = false;
  trackPointer((moveEvent) => {
    pending = updateEdgeCurveHandle(route, initial, handle, {
      x: handle.point.x + (moveEvent.clientX - origin.x) / props.zoom,
      y: handle.point.y + (moveEvent.clientY - origin.y) / props.zoom,
    });
    previewRouting.value = {
      ...previewRouting.value,
      [edge.elementId]: routingWithCurve(edge, pending) ?? null,
    };
    changed = true;
  }, (cancelled) => {
    clearRoutingPreview(edge.elementId);
    if (!cancelled && changed && !props.readOnly) emitCurveRouting(edge, pending);
  });
}

function clearRoutingPreview(elementId: string): void {
  const next = { ...previewRouting.value };
  delete next[elementId];
  previewRouting.value = next;
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

function nodeIconStyle(node: SceneNode): Record<string, string> {
  const style = nodeContentOffsetStyle(node, "icon");
  const size = renderedNodeIconSize(node);
  return {
    ...style,
    width: `${size.width}px`,
    height: `${size.height}px`,
    objectFit: node.nodeIconFit ?? "contain",
  };
}

function renderedNodeIconSize(node: SceneNode): { width: number; height: number } {
  const preview = previewNodeIconSizes.value[node.elementId];
  if (preview) return preview;
  const resolved = resolveIconContentMetrics(node.iconIntrinsicSize, {
    scale: node.nodeIconScale,
    size: node.nodeIconSize,
    fit: node.nodeIconFit,
  });
  return resolved
    ? { width: resolved.width, height: resolved.height }
    : { width: 24, height: 24 };
}

function nodeIconResizeHandleStyle(node: SceneNode): Record<string, string> {
  const geometry = geometryFor(node);
  const size = renderedNodeIconSize(node);
  const offset = nodeContentOffset(node, "icon");
  return {
    left: `${geometry.x + geometry.width / 2 + offset.x + size.width / 2 - workArea.value.x}px`,
    top: `${geometry.y + geometry.height / 2 + offset.y + size.height / 2 - workArea.value.y}px`,
  };
}

function startNodeIconResize(event: PointerEvent, node: SceneNode): void {
  if (props.readOnly || event.button !== 0 || !props.nodeContentEditing) return;
  event.preventDefault();
  event.stopPropagation();
  requestSelection({ elementId: node.elementId, mode: "replace" });
  emit("gestureStart");
  const origin = { x: event.clientX, y: event.clientY };
  const initialSize = renderedNodeIconSize(node);
  const ratio = initialSize.width / Math.max(1, initialSize.height);
  let pendingSize = initialSize;
  let pendingGeometry: ElementGeometry | undefined;
  let changed = false;
  trackPointer((moveEvent) => {
    const deltaWidth = (moveEvent.clientX - origin.x) / props.zoom;
    const deltaHeightAsWidth = (moveEvent.clientY - origin.y) / props.zoom * ratio;
    const frameMaximumWidth = Math.max(4, Math.min(
      node.geometry.width - 40,
      (node.geometry.height - 32) * ratio,
    ));
    const width = clamp(
      initialSize.width + Math.max(deltaWidth, deltaHeightAsWidth),
      4,
      props.nodeIconGrowNode ? 4096 : frameMaximumWidth,
    );
    const requestedSize = { width, height: clamp(width / ratio, 4, 4096) };
    const requestedGeometry = props.nodeIconGrowNode
      ? iconGrowthGeometry(node, requestedSize)
      : undefined;
    const constrained = constrainIconPresentationResize(
      props.scene,
      node,
      requestedSize,
      requestedGeometry,
    );
    pendingSize = constrained.size;
    previewNodeIconSizes.value = {
      ...previewNodeIconSizes.value,
      [node.elementId]: pendingSize,
    };
    pendingGeometry = constrained.geometry
      && !sameGeometry(constrained.geometry, node.geometry)
      ? constrained.geometry
      : undefined;
    if (pendingGeometry) previewGeometries.value = { [node.elementId]: pendingGeometry };
    else previewGeometries.value = {};
    regionConstraintMessage.value = constrained.constrained
      ? "全所属領域・並び順・コンテナ内に収まる最大サイズへ調整しました。"
      : "";
    changed = pendingSize.width !== initialSize.width || pendingSize.height !== initialSize.height;
  }, (cancelled) => {
    const next = { ...previewNodeIconSizes.value };
    delete next[node.elementId];
    previewNodeIconSizes.value = next;
    previewGeometries.value = {};
    if (!cancelled && changed) {
      emit("nodeIconPresentationUpdate", {
        elementId: node.elementId,
        size: pendingSize,
        ...(pendingGeometry ? { geometry: pendingGeometry } : {}),
      });
    }
  });
}

function sameGeometry(left: ElementGeometry, right: ElementGeometry): boolean {
  return left.x === right.x
    && left.y === right.y
    && left.width === right.width
    && left.height === right.height;
}

function iconGrowthGeometry(
  node: SceneNode,
  size: { width: number; height: number },
): ElementGeometry | undefined {
  const desired = {
    width: Math.max(node.geometry.width, size.width + 40),
    height: Math.max(node.geometry.height, size.height + 32),
  };
  if (desired.width === node.geometry.width && desired.height === node.geometry.height) return undefined;
  return resizeGeometryElement(props.scene, node.elementId, desired)?.geometry;
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

function regionLabelStyle(region: SceneRegion): Record<string, string> {
  const anchor = region.regionLabelAnchor;
  const typography: Record<string, string> = region.style.labelFontSize
    ? { fontSize: `${region.style.labelFontSize}px` }
    : {};
  if (!Number.isFinite(anchor)) return typography;
  const point = region.groupFrame
    ? pointAtGroupLabelBand(
        region.geometry,
        anchor!,
        region.groupLabelOffset,
        region.style.labelFontSize,
      )
    : pointAtRegionPerimeter(region.geometry, anchor!);
  return {
    ...typography,
    left: `${point.x - region.geometry.x}px`,
    top: `${point.y - region.geometry.y}px`,
    right: "auto",
    bottom: "auto",
    transform: "translate(-50%, -50%)",
  };
}

function groupFrameLabelStyle(container: SceneContainer): Record<string, string> {
  const geometry = geometryFor(container);
  const perimeter = Math.max(1, 2 * (geometry.width + geometry.height));
  const anchor = Number.isFinite(container.groupLabelAnchor)
    ? container.groupLabelAnchor!
    : geometry.width / 2 / perimeter;
  const bandPoint = pointAtGroupLabelBand(
    geometry,
    anchor,
    container.groupLabelOffset,
    container.style.labelFontSize,
  );
  return {
    left: `${bandPoint.x - geometry.x}px`,
    top: `${bandPoint.y - geometry.y}px`,
    right: "auto",
    bottom: "auto",
    transform: "translate(-50%, -50%)",
    ...(container.style.labelFontSize ? { fontSize: `${container.style.labelFontSize}px` } : {}),
  };
}

function groupFrameKindLabel(kind: GroupFrameKind): string {
  switch (kind) {
    case "sequence":
      return "順番";
    case "alternative":
      return "分岐";
    case "classification":
      return "分類";
    default:
      return "所属";
  }
}

function groupFrameDescription(kind: GroupFrameKind): string {
  return `${groupFrameKindLabel(kind)}グループの枠。名称へフォーカスすると種類を確認できます。`;
}

function groupFrameTooltip(element: SceneContainer | SceneRegion): string {
  return `${element.label}（${groupFrameKindLabel(element.groupFrame!.kind)}グループ）`;
}

function groupFrameZIndex(element: SceneContainer | SceneRegion): number {
  if (selectedElementIdsSet.value.has(element.elementId)) return 19;
  const rank = orderedGroupFrames.value.findIndex((candidate) => candidate.elementId === element.elementId);
  if (rank < 0) return 10;
  if (rank === orderedGroupFrames.value.length - 1) return 18;
  return 10 + Math.min(7, rank);
}

function groupIconStyle(element: SceneContainer | SceneRegion): Record<string, string> {
  const metrics = resolveIconContentMetrics(element.iconIntrinsicSize, {
    scale: element.groupIconScale,
  });
  const offset = previewGroupIconOffsets.value[element.elementId] ?? element.groupIconOffset ?? { x: 0, y: 0 };
  return {
    width: `${metrics?.width ?? 24}px`,
    height: `${metrics?.height ?? 24}px`,
    transform: `translate(${offset.x}px, ${offset.y}px)`,
  };
}

function groupIconMayOverlapLabel(element: SceneContainer | SceneRegion): boolean {
  if (!element.iconRef) return false;
  const metrics = resolveIconContentMetrics(element.iconIntrinsicSize, { scale: element.groupIconScale });
  const offset = previewGroupIconOffsets.value[element.elementId] ?? element.groupIconOffset;
  if (!metrics || !offset) return false;
  return offset.x > Math.max(8, metrics.width * .4) && Math.abs(offset.y) < metrics.height;
}

function groupLabelMayOverlapMember(element: SceneContainer | SceneRegion): boolean {
  const memberIds = new Set((props.scene.memberships ?? []).flatMap((membership) => (
    (membership.regionElementId ?? membership.containerElementId) === element.elementId
      ? [membership.memberElementId]
      : []
  )));
  for (const candidate of [...props.scene.nodes, ...props.scene.containers]) {
    if (candidate.parentElementId === element.elementId) memberIds.add(candidate.elementId);
  }
  if (memberIds.size === 0) return false;
  const geometry = geometryFor(element);
  const anchor = Number.isFinite(element.groupLabelAnchor)
    ? element.groupLabelAnchor!
    : geometry.width / 2 / Math.max(1, 2 * (geometry.width + geometry.height));
  const center = pointAtGroupLabelBand(
    geometry,
    anchor,
    element.groupLabelOffset,
    element.style.labelFontSize,
  );
  const fontSize = element.style.labelFontSize ?? 21;
  const icon = element.iconRef
    ? resolveIconContentMetrics(element.iconIntrinsicSize, { scale: element.groupIconScale })
    : undefined;
  const horizontalWidth = Math.min(280, Math.max(24, [...element.label].length * fontSize * .62 + 16))
    + (icon ? icon.width + 8 : 0);
  const horizontalHeight = Math.max(fontSize * 1.4 + 8, icon?.height ?? 0);
  const vertical = element.groupLabelWritingDirection === "vertical-down";
  const labelBounds = {
    x: center.x - (vertical ? horizontalHeight : horizontalWidth) / 2,
    y: center.y - (vertical ? horizontalWidth : horizontalHeight) / 2,
    width: vertical ? horizontalHeight : horizontalWidth,
    height: vertical ? horizontalWidth : horizontalHeight,
  };
  return [...props.scene.nodes, ...props.scene.containers, ...(props.scene.regions ?? [])]
    .some((candidate) => memberIds.has(candidate.elementId) && boundsIntersect(
      labelBounds,
      geometryFor(candidate),
    ));
}

function startGroupIconMove(event: PointerEvent, element: SceneContainer | SceneRegion): void {
  if (props.readOnly || event.button !== 0 || !element.groupFrame || !element.iconRef) return;
  event.preventDefault();
  event.stopPropagation();
  requestSelection({ elementId: element.elementId, mode: "replace" });
  emit("gestureStart");
  const origin = { x: event.clientX, y: event.clientY };
  const initial = element.groupIconOffset ?? { x: 0, y: 0 };
  let pending = initial;
  trackPointer((moveEvent) => {
    pending = {
      x: clamp(initial.x + (moveEvent.clientX - origin.x) / props.zoom, -128, 128),
      y: clamp(initial.y + (moveEvent.clientY - origin.y) / props.zoom, -128, 128),
    };
    previewGroupIconOffsets.value = {
      ...previewGroupIconOffsets.value,
      [element.elementId]: pending,
    };
  }, (cancelled) => {
    const next = { ...previewGroupIconOffsets.value };
    delete next[element.elementId];
    previewGroupIconOffsets.value = next;
    if (cancelled || pending.x === initial.x && pending.y === initial.y) return;
    emit("groupIconOffsetUpdate", {
      elementId: element.elementId,
      offset: pending.x === 0 && pending.y === 0 ? undefined : pending,
    });
  });
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
  if (props.structuredSelectionPicking) {
    event.preventDefault();
    event.stopPropagation();
    emit("structuredSelectionRequest", selectionRequest(
      event,
      region.elementId,
      selectedElementIdsSet.value.has(region.elementId),
    ));
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  requestSelection({ elementId: region.elementId, mode: "replace" });
  emit("gestureStart");
  trackPointer((moveEvent) => {
    const point = semanticPositionAt(moveEvent);
    if (!point) return;
    const placement = region.groupFrame
      ? nearestGroupLabelBandPlacement(region.geometry, point, region.style.labelFontSize)
      : { anchor: nearestRegionPerimeterAnchor(region.geometry, point) };
    emit("regionLabelUpdate", { elementId: region.elementId, ...placement });
  });
}

function startGroupFrameLabelMove(event: PointerEvent, container: SceneContainer): void {
  if (props.readOnly || event.button !== 0 || !container.groupFrame) return;
  if (props.structuredSelectionPicking) {
    event.preventDefault();
    event.stopPropagation();
    emit("structuredSelectionRequest", selectionRequest(
      event,
      container.elementId,
      selectedElementIdsSet.value.has(container.elementId),
    ));
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  requestSelection({ elementId: container.elementId, mode: "replace" });
  emit("gestureStart");
  trackPointer((moveEvent) => {
    const point = semanticPositionAt(moveEvent);
    if (!point) return;
    emit("groupLabelUpdate", {
      elementId: container.elementId,
      ...nearestGroupLabelBandPlacement(
        geometryFor(container),
        point,
        container.style.labelFontSize,
      ),
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

function pointAtGroupLabelBand(
  geometry: ElementGeometry,
  anchor: number,
  offset = 0,
  fontSize = 21,
): Point {
  const perimeterPoint = pointAtRegionPerimeter(geometry, anchor);
  const inward = inwardNormalAtAnchor(geometry, anchor);
  const safeOffset = clamp(Number.isFinite(offset) ? offset : 0, -1, 1);
  const distance = safeOffset < 0
    ? safeOffset * Math.max(6, fontSize * .4)
    : safeOffset * Math.max(18, fontSize * 1.4);
  return {
    x: perimeterPoint.x + inward.x * distance,
    y: perimeterPoint.y + inward.y * distance,
  };
}

function inwardNormalAtAnchor(geometry: ElementGeometry, anchor: number): Point {
  const perimeter = Math.max(1, 2 * (geometry.width + geometry.height));
  const distance = clamp(anchor, 0, .999999) * perimeter;
  if (distance <= geometry.width) return { x: 0, y: 1 };
  if (distance <= geometry.width + geometry.height) return { x: -1, y: 0 };
  if (distance <= geometry.width * 2 + geometry.height) return { x: 0, y: -1 };
  return { x: 1, y: 0 };
}

function nearestGroupLabelBandPlacement(
  geometry: ElementGeometry,
  point: Point,
  fontSize = 21,
): { anchor: number; offset?: number } {
  const anchor = nearestRegionPerimeterAnchor(geometry, point);
  const perimeterPoint = pointAtRegionPerimeter(geometry, anchor);
  const inward = inwardNormalAtAnchor(geometry, anchor);
  const signedDistance = (point.x - perimeterPoint.x) * inward.x
    + (point.y - perimeterPoint.y) * inward.y;
  const limit = signedDistance < 0
    ? Math.max(6, fontSize * .4)
    : Math.max(18, fontSize * 1.4);
  const offset = clamp(signedDistance / limit, -1, 1);
  return {
    anchor,
    ...(Math.abs(offset) > .000001 ? { offset } : {}),
  };
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
  if (props.readOnly) return;
  const requested = canvasPoint(event);
  if (!requested) return;
  event.preventDefault();
  if (edgeRouteMode(edge) === "curve") {
    emit("gestureStart");
    emitCurveRouting(edge, insertEdgeCurveKnot(
      renderedRoute(edge),
      currentCurve(edge),
      clampPointToScene(requested),
    ));
    emit("gestureEnd");
    return;
  }
  if (!waypointEditingAllowed(edge)) return;
  emit("gestureStart");
  emitWaypointRouting(edge, insertEdgeWaypoint({
    route: renderedRoute(edge),
    waypoints: edge.waypoints,
  }, clampPointToScene(requested)));
  emit("gestureEnd");
}

function handleCurveKnotKeydown(event: KeyboardEvent, edge: SceneEdge, index: number): void {
  if (props.readOnly || edgeRouteMode(edge) !== "curve") return;
  if (event.key === "Delete" || event.key === "Backspace") {
    event.preventDefault();
    event.stopPropagation();
    emit("gestureStart");
    emitCurveRouting(edge, removeEdgeCurveKnot(currentCurve(edge), index));
    emit("gestureEnd");
    return;
  }
  const movement = curveKeyboardMovement(event);
  if (!movement) return;
  event.preventDefault();
  event.stopPropagation();
  emit("gestureStart");
  emitCurveRouting(edge, moveEdgeCurveKnot(
    currentCurve(edge),
    index,
    movement,
    { width: props.scene.width, height: props.scene.height, padding: 8 },
  ));
  emit("gestureEnd");
}

function handleCurveHandleKeydown(
  event: KeyboardEvent,
  edge: SceneEdge,
  handle: EdgeCurveControlHandle,
): void {
  if (props.readOnly || edgeRouteMode(edge) !== "curve") return;
  if ((event.key === "Delete" || event.key === "Backspace") && handle.manual) {
    event.preventDefault();
    event.stopPropagation();
    emit("gestureStart");
    emitCurveRouting(edge, removeEdgeCurveHandle(currentCurve(edge), handle));
    emit("gestureEnd");
    return;
  }
  const movement = curveKeyboardMovement(event);
  if (!movement) return;
  event.preventDefault();
  event.stopPropagation();
  emit("gestureStart");
  emitCurveRouting(edge, updateEdgeCurveHandle(
    renderedRoute(edge),
    currentCurve(edge),
    handle,
    { x: handle.point.x + movement.x, y: handle.point.y + movement.y },
  ));
  emit("gestureEnd");
}

function curveKeyboardMovement(event: KeyboardEvent): Point | undefined {
  const step = event.shiftKey ? 10 : 1;
  return {
    ArrowLeft: { x: -step, y: 0 },
    ArrowRight: { x: step, y: 0 },
    ArrowUp: { x: 0, y: -step },
    ArrowDown: { x: 0, y: step },
  }[event.key];
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
    if (props.structuredSelectionPicking) {
      if (!props.readOnly) emit("structuredSelectionRequest", { elementId: edge.elementId, mode: "replace" });
      return;
    }
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
  if ((event.key === "Enter" || event.key === " ") && props.structuredSelectionPicking) {
    event.preventDefault();
    event.stopPropagation();
    if (!props.readOnly) emit("structuredSelectionRequest", { elementId, mode: "replace" });
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

function emitCurveRouting(edge: SceneEdge, curve: EdgeCurveRouting | undefined): void {
  emit("routingUpdate", {
    elementId: edge.elementId,
    routing: routingWithCurve(edge, curve),
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

function defaultAlternativeBadges(elementId: string): Array<{ key: string; label: string }> {
  return props.scene.containers
    .filter((container) => (
      container.groupRole === "alternative"
      && container.groupFrame?.defaultMember?.memberElementId === elementId
    ))
    .map((container) => ({ key: container.elementId, label: container.label }));
}

function groupGuidePath(guide: SceneGroupGuide): string {
  const sourceCenter = groupGuideEndpoint(guide, "source");
  const targetCenter = groupGuideEndpoint(guide, "target");
  if (!sourceCenter || !targetCenter) return "";
  const sourceElement = endpointElementsById.value.get(guide.sourceElementId);
  const targetElement = endpointElementsById.value.get(guide.targetElementId);
  const source = sourceElement
    ? edgeEndpointAnchorPoint(
        sourceElement.geometry,
        endpointElementShape(sourceElement),
        edgeEndpointAnchorFromPoint(sourceElement.geometry, targetCenter),
      )
    : sourceCenter;
  const target = targetElement
    ? edgeEndpointAnchorPoint(
        targetElement.geometry,
        endpointElementShape(targetElement),
        edgeEndpointAnchorFromPoint(targetElement.geometry, sourceCenter),
      )
    : targetCenter;
  return polylinePath([source, target]);
}

function groupGuideEndpoint(
  guide: SceneGroupGuide,
  endpoint: "source" | "target",
): Point | undefined {
  const elementId = endpoint === "source" ? guide.sourceElementId : guide.targetElementId;
  const element = endpointElementsById.value.get(elementId);
  if (element) return centerOf(geometryFor(element));
  const group = props.scene.containers.find((candidate) => candidate.elementId === guide.groupElementId);
  if (!group || group.groupFrame?.hub?.elementId !== elementId) return undefined;
  return alternativeHubPoint(group);
}

function alternativeHubPoint(group: SceneContainer): Point {
  const geometry = geometryFor(group);
  const memberCenters = (props.scene.groupGuides ?? [])
    .filter((candidate) => (
      candidate.groupElementId === group.elementId
      && candidate.kind === "alternative-candidate"
    ))
    .map((candidate) => endpointElementsById.value.get(candidate.targetElementId))
    .filter((candidate): candidate is SceneNode | SceneContainer | SceneRegion => Boolean(candidate))
    .map((candidate) => centerOf(geometryFor(candidate)));
  const averageY = memberCenters.length
    ? memberCenters.reduce((sum, point) => sum + point.y, 0) / memberCenters.length
    : geometry.y + geometry.height / 2;
  return {
    x: geometry.x + Math.min(42, Math.max(20, geometry.width * .12)),
    y: clamp(averageY, geometry.y + 26, geometry.y + geometry.height - 26),
  };
}

function alternativeGroupHubs(): Array<{ groupElementId: string; point: Point; label: string }> {
  return props.scene.containers.flatMap((container) => {
    const hubId = container.groupFrame?.hub?.elementId;
    if (!hubId || container.groupRole !== "alternative") return [];
    return [{
      groupElementId: container.elementId,
      point: alternativeHubPoint(container),
      label: container.label,
    }];
  });
}

function selectGroupGuide(event: MouseEvent, guide: SceneGroupGuide): void {
  selectGroupElement(event, guide.groupElementId);
}

function selectGroupElement(event: MouseEvent, groupElementId: string): void {
  event.stopPropagation();
  scrollElement.value?.focus({ preventScroll: true });
  if (props.structuredSelectionPicking) {
    if (!props.readOnly) emit("structuredSelectionRequest", selectionRequest(
      event,
      groupElementId,
      selectedElementIdsSet.value.has(groupElementId),
    ));
    return;
  }
  requestSelection(selectionRequest(
    event,
    groupElementId,
    selectedElementIdsSet.value.has(groupElementId),
  ));
}

function requestGroupGuideContextMenu(event: MouseEvent, guide: SceneGroupGuide): void {
  event.preventDefault();
  event.stopPropagation();
  requestSelection({ elementId: guide.groupElementId, mode: "replace" });
  emit("contextMenuRequest", {
    kind: "container",
    elementId: guide.groupElementId,
    origin: "pointer",
    clientX: event.clientX,
    clientY: event.clientY,
    canvasPosition: canvasPoint(event),
    guide: {
      guideId: guide.guideId,
      groupElementId: guide.groupElementId,
      kind: guide.kind,
    },
  });
}

function requestGroupGuideKeyboardContextMenu(event: KeyboardEvent, guide: SceneGroupGuide): void {
  if (!isContextMenuKey(event)) return;
  event.preventDefault();
  event.stopPropagation();
  requestSelection({ elementId: guide.groupElementId, mode: "replace" });
  const target = event.currentTarget instanceof Element ? event.currentTarget : undefined;
  const bounds = target?.getBoundingClientRect();
  emit("contextMenuRequest", {
    kind: "container",
    elementId: guide.groupElementId,
    origin: "keyboard",
    clientX: bounds ? bounds.left + Math.min(bounds.width, 24) : 24,
    clientY: bounds ? bounds.top + Math.min(bounds.height, 24) : 24,
    guide: {
      guideId: guide.guideId,
      groupElementId: guide.groupElementId,
      kind: guide.kind,
    },
  });
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

function startViewportPan(
  event: PointerEvent,
  clickElement?: GeometryElement,
  forcePrimary = false,
): void {
  const primaryOnBlank = event.button === 0 && isBlankCanvasTarget(event.target);
  const hitGroup = primaryOnBlank ? topGroupFrameAtEvent(event) : undefined;
  const selectionTarget = clickElement ?? hitGroup;
  const middleButton = event.button === 1;
  if (!primaryOnBlank && !middleButton && !forcePrimary) return;
  if (
    primaryOnBlank
    && hitGroup
    && selectedElementIdsSet.value.has(hitGroup.elementId)
    && !event.altKey
    && !props.semanticPositionPicking
    && !props.semanticResourcePicking
    && !props.structuredSelectionPicking
  ) {
    // Group frames intentionally let pointer events pass through their empty
    // interior. Recover the selected frame here, after all foreground DOM
    // targets have had precedence, and use the normal geometry gesture.
    startMove(event, hitGroup);
    return;
  }
  const primaryPan = primaryOnBlank && (
    event.altKey
    || props.semanticPositionPicking
    || props.semanticResourcePicking
    || props.dragMode === "pan" && !props.structuredSelectionPicking
  );
  if (!middleButton && !primaryPan && !forcePrimary) {
    startSelectionMarquee(event, selectionTarget);
    return;
  }
  const element = scrollElement.value;
  if (!element) return;
  event.preventDefault();
  element.focus({ preventScroll: true });
  viewportPanning.value = true;
  const origin = { x: event.clientX, y: event.clientY };
  const initial = { x: element.scrollLeft, y: element.scrollTop };
  let moved = false;

  const handleMove = (moveEvent: PointerEvent): void => {
    if (!moved && Math.hypot(moveEvent.clientX - origin.x, moveEvent.clientY - origin.y) <= 4) return;
    moved = true;
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
      return;
    }
    if (upEvent?.type === "pointerup" && !moved && selectionTarget) {
      if (props.structuredSelectionPicking) {
        if (!props.readOnly) emit("structuredSelectionRequest", selectionRequest(
          event,
          selectionTarget.elementId,
          selectedElementIdsSet.value.has(selectionTarget.elementId),
        ));
      } else {
        requestSelection(selectionRequest(
          event,
          selectionTarget.elementId,
          selectedElementIdsSet.value.has(selectionTarget.elementId),
        ));
      }
      return;
    }
    if (
      upEvent?.type === "pointerup"
      && primaryOnBlank
      && !moved
      && !props.semanticPositionPicking
      && !props.semanticResourcePicking
      && !props.structuredSelectionPicking
    ) {
      requestSelection({ elementId: "", mode: "replace" });
    }
  };
  stopViewportTracking?.();
  stopViewportTracking = cleanup;
  window.addEventListener("pointermove", handleMove);
  window.addEventListener("pointerup", cleanup, { once: true });
  window.addEventListener("pointercancel", cleanup, { once: true });
}

function topGroupFrameAtEvent(event: PointerEvent | MouseEvent): GeometryElement | undefined {
  const point = canvasPositionAt(event as PointerEvent);
  if (!point) return undefined;
  const containing = [...orderedGroupFrames.value].reverse().filter((element) => {
    const geometry = geometryFor(element);
    return point.x >= geometry.x
      && point.x <= geometry.x + geometry.width
      && point.y >= geometry.y
      && point.y <= geometry.y + geometry.height;
  });
  // Interior hit testing follows the persisted Group Frame order. Selection
  // may expose handles within its structural layer, but must not make a rear
  // frame pointer-reachable through a front frame.
  return containing[0];
}

function startSelectionMarquee(event: PointerEvent, clickElement?: GeometryElement): void {
  const element = scrollElement.value;
  const origin = canvasPositionAt(event);
  if (!element || !origin) return;
  event.preventDefault();
  element.focus({ preventScroll: true });
  const mode = event.shiftKey ? "add" : event.ctrlKey || event.metaKey ? "toggle" : "replace";
  let moved = false;
  let current = origin;

  const handleMove = (moveEvent: PointerEvent): void => {
    const point = canvasPositionAt(moveEvent);
    if (!point) return;
    current = point;
    if (!moved && Math.hypot(point.x - origin.x, point.y - origin.y) <= 4 / props.zoom) return;
    moved = true;
    selectionMarquee.value = { origin, current, mode };
    autoPanForPointer(moveEvent);
  };
  const cleanup = (upEvent?: PointerEvent): void => {
    window.removeEventListener("pointermove", handleMove);
    window.removeEventListener("pointerup", cleanup);
    window.removeEventListener("pointercancel", cleanup);
    selectionMarquee.value = undefined;
    if (stopViewportTracking === cleanup) stopViewportTracking = undefined;
    if (upEvent?.type !== "pointerup") return;
    if (!moved) {
      if (clickElement && props.structuredSelectionPicking) {
        if (!props.readOnly) emit("structuredSelectionRequest", selectionRequest(
          event,
          clickElement.elementId,
          selectedElementIdsSet.value.has(clickElement.elementId),
        ));
        return;
      }
      if (clickElement) {
        requestSelection(selectionRequest(
          event,
          clickElement.elementId,
          selectedElementIdsSet.value.has(clickElement.elementId),
        ));
        return;
      }
      if (mode === "replace") requestSelection({ elementId: "", mode: "replace" });
      return;
    }
    const geometry = normalizedBounds(origin, current);
    const elementIds = marqueeElementIds(geometry);
    if (props.structuredSelectionPicking) {
      if (!props.readOnly) emit("structuredSelectionSetRequest", { elementIds, mode });
      return;
    }
    requestSelectionSet(combineMarqueeSelection(elementIds, mode));
    announce(`${elementIds.length}件を範囲選択`);
  };
  stopViewportTracking?.();
  stopViewportTracking = cleanup;
  window.addEventListener("pointermove", handleMove);
  window.addEventListener("pointerup", cleanup, { once: true });
  window.addEventListener("pointercancel", cleanup, { once: true });
}

function structureInteriorTarget(event: PointerEvent): boolean {
  if (event.target !== event.currentTarget) return false;
  const target = event.currentTarget;
  if (!(target instanceof HTMLElement)) return false;
  const bounds = target.getBoundingClientRect();
  const inset = 10;
  return bounds.width > inset * 2
    && bounds.height > inset * 2
    && event.clientX > bounds.left + inset
    && event.clientX < bounds.right - inset
    && event.clientY > bounds.top + inset
    && event.clientY < bounds.bottom - inset;
}

function canvasPositionAt(event: PointerEvent): Point | undefined {
  const bounds = stageElement.value?.getBoundingClientRect();
  if (!bounds || props.zoom <= 0) return undefined;
  return {
    x: workArea.value.x + (event.clientX - bounds.left) / props.zoom,
    y: workArea.value.y + (event.clientY - bounds.top) / props.zoom,
  };
}

function normalizedBounds(start: Point, end: Point): ElementGeometry {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
}

function marqueeElementIds(bounds: ElementGeometry): string[] {
  const matches = new Set<string>();
  for (const element of [...props.scene.containers, ...(props.scene.regions ?? [])]) {
    if (boundsContains(bounds, geometryFor(element))) matches.add(element.elementId);
  }
  for (const node of props.scene.nodes) {
    if (boundsIntersect(bounds, geometryFor(node))) matches.add(node.elementId);
  }
  for (const edge of props.scene.edges) {
    if (edgeIntersectsBounds(edge, bounds)) matches.add(edge.elementId);
  }
  return navigatorItems.value
    .map((item) => item.elementId)
    .filter((elementId) => matches.has(elementId));
}

function combineMarqueeSelection(
  matches: readonly string[],
  mode: "replace" | "add" | "toggle",
): string[] {
  if (mode === "replace") return [...matches];
  const result = [...props.selectedElementIds];
  if (props.selectedElementId && !result.includes(props.selectedElementId)) {
    result.push(props.selectedElementId);
  }
  for (const elementId of matches) {
    const index = result.indexOf(elementId);
    if (mode === "toggle" && index >= 0) result.splice(index, 1);
    else if (index < 0) result.push(elementId);
  }
  return result;
}

function boundsContains(outer: ElementGeometry, inner: ElementGeometry): boolean {
  return inner.x >= outer.x
    && inner.y >= outer.y
    && inner.x + inner.width <= outer.x + outer.width
    && inner.y + inner.height <= outer.y + outer.height;
}

function boundsIntersect(left: ElementGeometry, right: ElementGeometry): boolean {
  return left.x <= right.x + right.width
    && left.x + left.width >= right.x
    && left.y <= right.y + right.height
    && left.y + left.height >= right.y;
}

function edgeIntersectsBounds(edge: SceneEdge, bounds: ElementGeometry): boolean {
  const route = marqueeRoutePoints(edge);
  if (route.some((point) => pointInsideBounds(point, bounds))) return true;
  for (let index = 1; index < route.length; index += 1) {
    if (segmentIntersectsBounds(route[index - 1]!, route[index]!, bounds)) return true;
  }
  return false;
}

function marqueeRoutePoints(edge: SceneEdge): Point[] {
  const route = renderedRoute(edge);
  const family = renderedEdgeRouteFamily(edge, edgeRouteMode(edge));
  if (family === "curve") {
    return Array.from({ length: 25 }, (_, index) => (
      pointAtCurveFraction(route, renderedCurve(edge), index / 24)
    ));
  }
  if (family !== "orthogonal") return route;
  const result: Point[] = [];
  for (const point of route) {
    const previous = result.at(-1);
    if (previous && previous.x !== point.x && previous.y !== point.y) {
      result.push({ x: point.x, y: previous.y });
    }
    result.push(point);
  }
  return result;
}

function pointInsideBounds(point: Point, bounds: ElementGeometry): boolean {
  return point.x >= bounds.x
    && point.x <= bounds.x + bounds.width
    && point.y >= bounds.y
    && point.y <= bounds.y + bounds.height;
}

function segmentIntersectsBounds(start: Point, end: Point, bounds: ElementGeometry): boolean {
  const edges: readonly [Point, Point][] = [
    [{ x: bounds.x, y: bounds.y }, { x: bounds.x + bounds.width, y: bounds.y }],
    [{ x: bounds.x + bounds.width, y: bounds.y }, { x: bounds.x + bounds.width, y: bounds.y + bounds.height }],
    [{ x: bounds.x + bounds.width, y: bounds.y + bounds.height }, { x: bounds.x, y: bounds.y + bounds.height }],
    [{ x: bounds.x, y: bounds.y + bounds.height }, { x: bounds.x, y: bounds.y }],
  ];
  return edges.some(([left, right]) => segmentsIntersect(start, end, left, right));
}

function segmentsIntersect(a: Point, b: Point, c: Point, d: Point): boolean {
  const cross = (left: Point, middle: Point, right: Point): number => (
    (middle.x - left.x) * (right.y - left.y)
      - (middle.y - left.y) * (right.x - left.x)
  );
  const abC = cross(a, b, c);
  const abD = cross(a, b, d);
  const cdA = cross(c, d, a);
  const cdB = cross(c, d, b);
  if (abC === 0 && pointOnSegment(c, a, b)) return true;
  if (abD === 0 && pointOnSegment(d, a, b)) return true;
  if (cdA === 0 && pointOnSegment(a, c, d)) return true;
  if (cdB === 0 && pointOnSegment(b, c, d)) return true;
  return (abC > 0) !== (abD > 0) && (cdA > 0) !== (cdB > 0);
}

function pointOnSegment(point: Point, start: Point, end: Point): boolean {
  return point.x >= Math.min(start.x, end.x)
    && point.x <= Math.max(start.x, end.x)
    && point.y >= Math.min(start.y, end.y)
    && point.y <= Math.max(start.y, end.y);
}

function semanticPositionAt(event: PointerEvent): Point | undefined {
  const position = canvasPositionAt(event);
  return position ? clampPointToScene(position) : undefined;
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

  if (command.kind === "cancel" && (props.semanticPositionPicking || props.semanticResourcePicking || props.structuredSelectionPicking)) {
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
  if (movement && command.kind === "nudge") {
    event.preventDefault();
    event.stopPropagation();
    if (selectedGeometryElements(props.scene, [...selectedElementIdsSet.value]).length === 0) {
      handleNavigationKeydown(event);
    } else if (!props.readOnly) {
      previewKeyboardMoveOrWaypoint(event, movement);
    }
    return;
  }
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
    handleSceneNavigatorKeydown(event, command.movement);
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
): void {
  event.preventDefault();
  event.stopPropagation();
  const previous = activeNavigatorElementId.value;
  const next = moveSceneNavigatorFocus(navigatorItems.value, previous, navigation);
  activeNavigatorElementId.value = next;
  void revealElement(next);
  navigatorAnchorElementId.value = next;
  announceActiveNavigatorItem("フォーカス");
}

function previewKeyboardMoveOrWaypoint(event: KeyboardEvent, movement: Point): void {
  const activeId = activeNavigatorElementId.value;
  const edge = props.scene.edges.find((candidate) => candidate.elementId === activeId);
  if (edge) {
    if (edgeRouteMode(edge) === "curve") {
      if (!selectedElementIdsSet.value.has(activeId)) {
        requestSelection({ elementId: activeId, mode: "replace" });
      }
      // Use the committed curve as the gesture origin. previewRouting changes
      // every repeat, so deriving handles from it would add 1, 3, 6... units.
      const targets = curveKeyboardTargets(edge, edge.curve);
      if (targets.length === 0) return;
      const index = clamp(activeWaypointIndex.value, 0, targets.length - 1);
      activeWaypointIndex.value = index;
      const target = targets[index]!;
      const gesture = beginKeyboardGesture("waypoint", edge.elementId, event.key);
      gesture.delta.x += movement.x;
      gesture.delta.y += movement.y;
      const curve = target.kind === "knot"
        ? moveEdgeCurveKnot(
            edge.curve,
            target.knotIndex,
            gesture.delta,
            { width: props.scene.width, height: props.scene.height, padding: 8 },
          )
        : updateEdgeCurveHandle(
            renderedRoute(edge),
            edge.curve,
            target.handle,
            {
              x: target.handle.point.x + gesture.delta.x,
              y: target.handle.point.y + gesture.delta.y,
            },
          );
      gesture.routing = routingWithCurve(edge, curve);
      previewRouting.value = { ...previewRouting.value, [edge.elementId]: gesture.routing ?? null };
      announce(target.kind === "knot" ? `曲線点 ${target.knotIndex + 1}を移動` : "曲線ハンドルを調整");
      return;
    }
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
  if (!edge) return;
  if (!selectedElementIdsSet.value.has(edge.elementId)) {
    requestSelection({ elementId: edge.elementId, mode: "replace" });
  }
  if (event.repeat) return;
  if (edgeRouteMode(edge) === "curve") {
    const targets = curveKeyboardTargets(edge, edge.curve);
    const target = targets[clamp(activeWaypointIndex.value, 0, Math.max(0, targets.length - 1))];
    let curve: EdgeCurveRouting | undefined;
    let addedKnotIndex = -1;
    if (operation === "add") {
      addedKnotIndex = edgeCurveKnotAppendIndex(renderedRoute(edge), edge.curve);
      curve = appendEdgeCurveKnot(renderedRoute(edge), edge.curve);
    } else if (target?.kind === "knot") {
      curve = removeEdgeCurveKnot(edge.curve, target.knotIndex);
    } else if (target?.kind === "handle" && target.handle.manual) {
      curve = removeEdgeCurveHandle(edge.curve, target.handle);
    } else {
      announce("自動曲線ハンドルは削除せず、矢印キーで手動調整できます");
      return;
    }
    const gesture = beginKeyboardGesture(
      operation === "add" ? "waypoint-add" : "waypoint-remove",
      edge.elementId,
      event.key,
    );
    gesture.routing = routingWithCurve(edge, curve);
    previewRouting.value = { ...previewRouting.value, [edge.elementId]: gesture.routing ?? null };
    activeWaypointIndex.value = operation === "add"
      ? Math.max(0, addedKnotIndex)
      : Math.min(activeWaypointIndex.value, Math.max(0, curveKeyboardTargets(edge, curve).length - 1));
    announce(operation === "add" ? "曲線点を追加" : "曲線の制御点を削除");
    return;
  }
  if (!waypointEditingAllowed(edge)) return;
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
  if (!edge) return;
  const curveMode = edgeRouteMode(edge) === "curve";
  if (!curveMode && !waypointEditingAllowed(edge)) return;
  const count = curveMode ? curveKeyboardTargets(edge).length : editableEdgeWaypoints(edge).length;
  if (count === 0) {
    announce(curveMode ? "曲線の制御点はありません" : "Waypointはありません");
    return;
  }
  const delta = movement === "next" ? 1 : -1;
  activeWaypointIndex.value = (activeWaypointIndex.value + delta + count) % count;
  announce(`${curveMode ? "曲線制御点" : "Waypoint"} ${activeWaypointIndex.value + 1}/${count}を対象にしました`);
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

async function fitToSelection(elementIds: readonly string[]): Promise<boolean> {
  await nextTick();
  updateViewportMetrics();
  const bounds = elementIds
    .map(elementBounds)
    .filter((value): value is ElementGeometry => Boolean(value));
  if (bounds.length === 0) return false;
  const left = Math.min(...bounds.map((value) => value.x));
  const top = Math.min(...bounds.map((value) => value.y));
  const right = Math.max(...bounds.map((value) => value.x + value.width));
  const bottom = Math.max(...bounds.map((value) => value.y + value.height));
  const selectionBounds = {
    x: left,
    y: top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
  };
  emit("zoomChange", diagramFitZoom(selectionBounds, viewport));
  await nextTick();
  updateViewportMetrics();
  centerOn({
    x: selectionBounds.x + selectionBounds.width / 2,
    y: selectionBounds.y + selectionBounds.height / 2,
  });
  return true;
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
  const route = renderedRoute(edge);
  const points = edgeRenderedBoundsPoints({
    derivedRouteChoice: edge.derivedRouteChoice,
    route,
    routeMode: edgeRouteMode(edge),
    curve: currentCurve(edge),
    waypoints: undefined,
  }, route);
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
    ".iriograph-group-guide",
    ".iriograph-alternative-hub",
    ".iriograph-waypoints",
    ".iriograph-curve-controls",
    ".iriograph-endpoint-anchors",
    ".iriograph-resize-handle",
    ".iriograph-node-icon-resize-handle",
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
    origin: "pointer",
    clientX: event.clientX,
    clientY: event.clientY,
    canvasPosition: canvasPoint(event),
  });
}

function requestBlankContextMenu(event: MouseEvent): void {
  if (!isBlankCanvasTarget(event.target)) return;
  const group = topGroupFrameAtEvent(event);
  if (group) {
    requestPointerContextMenu(event, group.structuralKind, group.elementId);
    return;
  }
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
    origin: "keyboard",
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
  scrollElement.value?.focus({ preventScroll: true });
  if (props.structuredSelectionPicking) {
    if (!props.readOnly) emit("structuredSelectionRequest", selectionRequest(
      event,
      edge.elementId,
      selectedElementIdsSet.value.has(edge.elementId),
    ));
    return;
  }
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

function sceneHasWorkspaceContent(scene: DiagramScene): boolean {
  return scene.nodes.length > 0
    || scene.containers.length > 0
    || (scene.regions?.length ?? 0) > 0
    || scene.edges.length > 0
    || (scene.memberships?.length ?? 0) > 0
    || (scene.groupGuides?.length ?? 0) > 0;
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
      route: edge.route?.map(cloneScenePoint),
      waypoints: edge.waypoints?.map(cloneScenePoint),
      curve: copyEdgeCurveRouting(edge.curve),
      labelOffset: edge.labelOffset ? cloneScenePoint(edge.labelOffset) : undefined,
      sourceAnchor: edge.sourceAnchor ? { ...edge.sourceAnchor } : undefined,
      targetAnchor: edge.targetAnchor ? { ...edge.targetAnchor } : undefined,
    })),
    diagnostics: [...scene.diagnostics],
  };
}

function cloneScenePoint(point: Point): Point {
  return JSON.parse(JSON.stringify(point)) as Point;
}

defineExpose<DiagramCanvasNavigationApi>({
  panBy,
  zoomTo,
  fitToView,
  fitToSelection,
  revealElement,
  centerOn,
  getViewportState,
  restoreViewport,
});
</script>

<template>
  <div class="iriograph-canvas-shell" :class="{ panning: viewportPanning, 'marquee-selecting': Boolean(selectionMarquee), 'drag-mode-pan': dragMode === 'pan', 'semantic-picking': semanticPositionPicking || semanticResourcePicking || structuredSelectionPicking }">
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
        選択中は矢印で1移動、Shiftと矢印で10移動、選択なしでは矢印で表示範囲を移動、NとShift+Nで要素フォーカスを移動、Enterで選択
      </span>
      <span v-if="semanticResourcePicking" class="iriograph-visually-hidden" role="status">
        Canvas上のnodeまたはcontainerから{{ semanticResourcePickLabel }}を選択してください。Escapeでキャンセルできます。
      </span>
      <span v-if="structuredSelectionPicking" class="iriograph-visually-hidden" role="status">
        Canvasから{{ structuredSelectionPickLabel }}を選択してください。Escapeでキャンセルできます。
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
            previewGroupIconOffsets,
            selectedElementId,
            selectedElementIds,
            activeNavigatorElementId,
            activeWaypointIndex,
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
            selectionMarqueeGeometry,
            deletionPreviewResourceRefs,
            deletionPreviewStatementRefs,
            nodeTypeTags,
            typeHighlightElementIds,
          ]"
          :style="{
            width: `${workArea.width}px`,
            height: `${workArea.height}px`,
            transform: `scale(${zoom})`,
            ...canvasGridStyle,
          }"
          @contextmenu="requestBlankContextMenu"
        >
          <div
            v-if="showGrid"
            class="iriograph-canvas-grid"
            aria-hidden="true"
            :style="{ backgroundPosition: `${-workArea.x}px ${-workArea.y}px` }"
          />
          <span
            v-if="selectionMarqueeGeometry"
            class="iriograph-selection-marquee"
            aria-hidden="true"
            :style="{
              left: `${selectionMarqueeGeometry.x - workArea.x}px`,
              top: `${selectionMarqueeGeometry.y - workArea.y}px`,
              width: `${selectionMarqueeGeometry.width}px`,
              height: `${selectionMarqueeGeometry.height}px`,
            }"
          />
          <p v-if="regionConstraintMessage" class="iriograph-region-constraint-warning" role="alert">{{ regionConstraintMessage }}</p>
          <span
            v-if="semanticDraftPosition"
            class="iriograph-semantic-position-marker"
            aria-label="意味編集の一時位置"
            :style="{ left: `${semanticDraftPosition.x - workArea.x}px`, top: `${semanticDraftPosition.y - workArea.y}px` }"
          />

          <div
            v-for="region in orderedRegions"
            :key="region.elementId"
            :id="navigatorDomId(region.elementId)"
            class="iriograph-scene-region"
            :class="[{ selected: selectedElementIdsSet.has(region.elementId), 'interaction-front': selectedElementIdsSet.has(region.elementId), 'group-frame': Boolean(region.groupFrame), 'classification-group': region.groupFrame?.kind === 'classification', 'navigator-active': activeNavigatorElementId === region.elementId, 'deletion-preview': isDeletionPreviewResource(region), 'type-highlight': typeHighlightElementIdsSet.has(region.elementId) }, diagnosticClass(region)]"
            role="option"
            tabindex="-1"
            :data-element-id="region.elementId"
            :aria-label="`${navigatorAriaLabel(region.elementId, region.label, 'region')}${diagnosticAriaSuffix(region)}`"
            :aria-description="region.groupFrame ? groupFrameDescription(region.groupFrame.kind) : undefined"
            :aria-describedby="region.groupFrame ? `${navigatorDomId(region.elementId)}-group-description` : undefined"
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
              zIndex: region.groupFrame ? groupFrameZIndex(region) : undefined,
            }"
            @pointerdown="startMove($event, region)"
            @keydown="handleGeometrySemanticKeydown($event, region.elementId)"
            @contextmenu="requestPointerContextMenu($event, 'region', region.elementId)"
          >
            <span v-if="region.groupFrame" :id="`${navigatorDomId(region.elementId)}-group-description`" class="iriograph-visually-hidden">{{ groupFrameDescription(region.groupFrame.kind) }}</span>
            <span class="iriograph-region-fill" :style="{ background: region.style.fill, opacity: region.style.fillOpacity ?? 0.28 }" />
            <span
              class="iriograph-region-label"
              :class="[
                { 'iriograph-group-frame-label': Boolean(region.groupFrame) },
                { 'icon-label-collision': Boolean(region.groupFrame) && groupIconMayOverlapLabel(region) },
                { 'member-label-collision': Boolean(region.groupFrame) && groupLabelMayOverlapMember(region) },
                `label-${region.labelPlacement ?? 'top'}`,
                `writing-${region.regionLabelWritingDirection === 'vertical-down' || (!region.regionLabelWritingDirection && (region.labelPlacement === 'left' || region.labelPlacement === 'right')) ? 'vertical' : 'horizontal'}`,
              ]"
              :style="regionLabelStyle(region)"
              :title="region.groupFrame ? groupFrameTooltip(region) : 'ドラッグしてラベルを領域の枠上で移動'"
              @pointerdown="startRegionLabelMove($event, region)"
            >
              <img v-if="region.groupFrame && region.iconUrl" class="iriograph-group-frame-icon" :src="region.iconUrl" alt="" loading="lazy" draggable="false" :style="groupIconStyle(region)" @pointerdown="startGroupIconMove($event, region)" />
              <span v-else-if="region.groupFrame && region.iconRef" class="iriograph-group-frame-icon-fallback" aria-hidden="true" :style="groupIconStyle(region)" @pointerdown="startGroupIconMove($event, region)">◇</span>
              <span :class="{ 'iriograph-group-frame-label-text': Boolean(region.groupFrame) }">{{ region.label }}</span>
              <span v-if="region.groupFrame && groupIconMayOverlapLabel(region)" class="iriograph-visually-hidden">アイコンと名称が重なる可能性があります</span>
              <span v-if="region.groupFrame && groupLabelMayOverlapMember(region)" class="iriograph-group-label-collision" role="img" aria-label="名称が要素と重なっています" title="名称が要素と重なっています">!</span>
              <span v-if="region.groupFrame" class="iriograph-group-structure-tooltip" role="tooltip" aria-hidden="true">{{ groupFrameKindLabel(region.groupFrame.kind) }}グループ</span>
            </span>
            <span v-if="additionalLabels(region.semanticRef, region.label).length" class="iriograph-additional-labels">{{ additionalLabels(region.semanticRef, region.label).join(' ／ ') }}</span>
            <span v-if="commentsFor(region.semanticRef)" class="iriograph-comment-callout" :class="{ visible: showAllComments }" :style="{ fontSize: region.style.labelFontSize ? `${region.style.labelFontSize}px` : undefined }" role="note">{{ commentsFor(region.semanticRef) }}</span>
            <span
              v-if="collapsedGroupSummaries[region.elementId]"
              class="iriograph-collapsed-group-badge"
              :title="collapsedGroupSummaries[region.elementId]!.hiddenLabels.join('、')"
            >{{ collapsedGroupSummaries[region.elementId]!.hiddenElementIds.length }}件</span>
          </div>

          <div
            v-for="container in orderedContainers"
            :key="container.elementId"
            v-memo="[
              container,
              previewGeometries[container.elementId],
              previewGroupIconOffsets[container.elementId],
              selectedElementIdsSet.has(container.elementId),
              activeNavigatorElementId === container.elementId,
              containmentWarningElementIdsSet.has(container.elementId),
              scene.diagnostics,
              readOnly,
              semanticMetadata[container.semanticRef],
              showAllComments,
              isDeletionPreviewResource(container),
              typeHighlightElementIdsSet.has(container.elementId),
            ]"
            :id="navigatorDomId(container.elementId)"
            class="iriograph-scene-container"
            :class="[{ selected: selectedElementIdsSet.has(container.elementId), 'interaction-front': Boolean(container.groupFrame ?? container.groupRole) && selectedElementIdsSet.has(container.elementId), 'group-frame': Boolean(container.groupFrame ?? container.groupRole), 'membership-group': container.groupRole === 'membership', 'classification-group': container.groupRole === 'classification', 'navigator-active': activeNavigatorElementId === container.elementId, 'containment-warning': containmentWarningElementIdsSet.has(container.elementId), 'deletion-preview': isDeletionPreviewResource(container), 'type-highlight': typeHighlightElementIdsSet.has(container.elementId), 'sequence-group': container.groupRole === 'sequence', 'alternative-group': container.groupRole === 'alternative' }, diagnosticClass(container)]"
            role="option"
            tabindex="-1"
            :data-element-id="container.elementId"
            :data-parent-element-id="container.parentElementId ?? ''"
            :data-header-position="container.headerPosition"
            :aria-label="`${navigatorAriaLabel(container.elementId, container.label, 'container')}${diagnosticAriaSuffix(container)}`"
            :aria-description="container.groupFrame ? groupFrameDescription(container.groupFrame.kind) : undefined"
            :aria-describedby="container.groupFrame ? `${navigatorDomId(container.elementId)}-group-description` : undefined"
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
              zIndex: container.groupFrame ? groupFrameZIndex(container) : undefined,
            }"
            @pointerdown="startMove($event, container)"
            @keydown="handleGeometrySemanticKeydown($event, container.elementId)"
            @contextmenu="requestPointerContextMenu($event, 'container', container.elementId)"
          >
            <span v-if="container.groupFrame" :id="`${navigatorDomId(container.elementId)}-group-description`" class="iriograph-visually-hidden">{{ groupFrameDescription(container.groupFrame.kind) }}</span>
            <span
              v-if="container.groupFrame"
              class="iriograph-container-header iriograph-group-frame-label"
              :class="[`writing-${container.groupLabelWritingDirection === 'vertical-down' ? 'vertical' : 'horizontal'}`, { 'icon-label-collision': groupIconMayOverlapLabel(container), 'member-label-collision': groupLabelMayOverlapMember(container) }]"
              :style="groupFrameLabelStyle(container)"
              :title="groupFrameTooltip(container)"
              @pointerdown="startGroupFrameLabelMove($event, container)"
            >
              <img v-if="container.iconUrl" class="iriograph-group-frame-icon" :src="container.iconUrl" alt="" loading="lazy" draggable="false" :style="groupIconStyle(container)" @pointerdown="startGroupIconMove($event, container)" />
              <span v-else-if="container.iconRef" class="iriograph-group-frame-icon-fallback" aria-hidden="true" :style="groupIconStyle(container)" @pointerdown="startGroupIconMove($event, container)">◇</span>
              <span class="iriograph-group-frame-label-text">{{ container.label }}</span>
              <span v-if="groupIconMayOverlapLabel(container)" class="iriograph-visually-hidden">アイコンと名称が重なる可能性があります</span>
              <span v-if="groupLabelMayOverlapMember(container)" class="iriograph-group-label-collision" role="img" aria-label="名称が要素と重なっています" title="名称が要素と重なっています">!</span>
              <span class="iriograph-group-structure-tooltip" role="tooltip" aria-hidden="true">{{ groupFrameKindLabel(container.groupFrame.kind) }}グループ</span>
            </span>
            <span
              v-else
              class="iriograph-container-header"
              :class="`header-${container.headerPosition}`"
              :style="{ background: container.style.accent, fontSize: container.style.labelFontSize ? `${container.style.labelFontSize}px` : undefined }"
            >
              {{ container.label }}
            </span>
            <span v-if="additionalLabels(container.semanticRef, container.label).length" class="iriograph-additional-labels">{{ additionalLabels(container.semanticRef, container.label).join(' ／ ') }}</span>
            <span v-if="commentsFor(container.semanticRef)" class="iriograph-comment-callout" :class="{ visible: showAllComments }" :style="{ fontSize: container.style.labelFontSize ? `${container.style.labelFontSize}px` : undefined }" role="note">{{ commentsFor(container.semanticRef) }}</span>
            <span v-if="sequenceMemberBadges(container.elementId).length" class="iriograph-sequence-badges" aria-label="並び順"><span v-for="badge in sequenceMemberBadges(container.elementId)" :key="badge.key" :title="`${badge.label}の${badge.ordinal}番`">{{ badge.ordinal }}</span></span>
            <span v-if="defaultAlternativeBadges(container.elementId).length" class="iriograph-alternative-default-badges" :aria-label="`${defaultAlternativeBadges(container.elementId).map((badge) => badge.label).join('、')}の既定候補`"><span v-for="badge in defaultAlternativeBadges(container.elementId)" :key="badge.key" :title="`${badge.label}の既定候補`">既定</span></span>
            <span
              v-if="collapsedGroupSummaries[container.elementId]"
              class="iriograph-collapsed-group-badge"
              :title="collapsedGroupSummaries[container.elementId]!.hiddenLabels.join('、')"
            >{{ collapsedGroupSummaries[container.elementId]!.hiddenElementIds.length }}件</span>
          </div>

          <svg
            ref="edgeLayerElement"
            class="iriograph-edge-layer"
            :width="workArea.width"
            :height="workArea.height"
            :viewBox="workAreaViewBox()"
            aria-label="関係と構造ガイド"
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
              <marker :id="sequenceGuideArrowId" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto" markerUnits="strokeWidth">
                <path d="M0,0 L7,3.5 L0,7 z" fill="context-stroke" />
              </marker>
            </defs>
            <path
              v-for="membership in deletionPreviewMemberships"
              :key="`deletion-membership:${membership.semanticRef}`"
              class="iriograph-deletion-preview-membership"
              :d="deletionPreviewMembershipPath(membership)"
            />
            <g
              v-for="guide in (scene.groupGuides ?? [])"
              :key="guide.guideId"
              class="iriograph-group-guide"
              :class="[`guide-${guide.kind}`, { selected: selectedElementIdsSet.has(guide.groupElementId) }]"
              :data-guide-id="guide.guideId"
              :data-group-element-id="guide.groupElementId"
              role="button"
              tabindex="-1"
              :aria-label="`${guide.kind === 'sequence-order' ? '並び順' : '候補'}の補助線。操作するとグループを選択します`"
              @click.stop="selectGroupGuide($event, guide)"
              @keydown="requestGroupGuideKeyboardContextMenu($event, guide)"
              @contextmenu="requestGroupGuideContextMenu($event, guide)"
            >
              <path class="iriograph-group-guide-hitarea" :d="groupGuidePath(guide)" />
              <path class="iriograph-group-guide-path" :d="groupGuidePath(guide)" :marker-end="guide.kind === 'sequence-order' ? `url(#${sequenceGuideArrowId})` : undefined" />
            </g>
            <g
              v-for="hub in alternativeGroupHubs()"
              :key="`hub:${hub.groupElementId}`"
              class="iriograph-alternative-hub"
              :class="{ selected: selectedElementIdsSet.has(hub.groupElementId) }"
              :data-group-element-id="hub.groupElementId"
              role="button"
              tabindex="-1"
              :aria-label="`${hub.label}の候補分岐点。操作するとグループを選択します`"
              @click.stop="selectGroupElement($event, hub.groupElementId)"
              @contextmenu="requestPointerContextMenu($event, 'container', hub.groupElementId)"
            >
              <circle class="iriograph-alternative-hub-hitarea" :cx="hub.point.x" :cy="hub.point.y" r="14" />
              <path class="iriograph-alternative-hub-mark" :d="`M ${hub.point.x} ${hub.point.y - 6} L ${hub.point.x + 6} ${hub.point.y} L ${hub.point.x} ${hub.point.y + 6} L ${hub.point.x - 6} ${hub.point.y} Z`" />
            </g>
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
              :data-route-family="renderedEdgeRouteFamily(edge, edgeRouteMode(edge))"
              :data-route-point-count="renderedRoute(edge).length"
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
                :font-size="edge.style.labelFontSize"
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
              previewNodeIconSizes[node.elementId],
              nodeContentEditing,
              selectedElementIdsSet.has(node.elementId),
              activeNavigatorElementId === node.elementId,
              containmentWarningElementIdsSet.has(node.elementId),
              scene.diagnostics,
              readOnly,
              semanticMetadata[node.semanticRef],
              nodeTypeTags[node.elementId],
              typeHighlightElementIdsSet.has(node.elementId),
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
            :data-scene-x="geometryFor(node).x"
            :data-scene-y="geometryFor(node).y"
            :data-scene-width="geometryFor(node).width"
            :data-scene-height="geometryFor(node).height"
            :class="[
              `shape-${node.shape}`,
              `label-direction-${node.nodeLabelWritingDirection === 'vertical-down' ? 'vertical' : 'horizontal'}`,
              {
                selected: selectedElementIdsSet.has(node.elementId),
                'navigator-active': activeNavigatorElementId === node.elementId,
                'user-placed': node.placement === 'user',
                'containment-warning': containmentWarningElementIdsSet.has(node.elementId),
                'deletion-preview': isDeletionPreviewResource(node),
                'semantic-reconnect-target': semanticReconnectPreview?.targetElementId === node.elementId,
                'type-highlight': typeHighlightElementIdsSet.has(node.elementId),
                ...diagnosticClass(node),
              },
            ]"
            :style="{
              left: `${canvasPosition(geometryFor(node)).x}px`,
              top: `${canvasPosition(geometryFor(node)).y}px`,
              width: `${geometryFor(node).width}px`,
              height: `${geometryFor(node).height}px`,
              background: node.shape === 'diamond' ? 'transparent' : node.style.fill,
              borderColor: node.shape === 'diamond' ? 'transparent' : node.style.stroke,
              borderWidth: node.shape === 'diamond' ? '0px' : `${node.style.strokeWidth ?? 1}px`,
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
            <svg
              v-if="node.shape === 'diamond'"
              class="iriograph-node-diamond-surface"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <polygon
                points="50,1 99,50 50,99 1,50"
                :fill="node.style.fill"
                :stroke="node.style.stroke"
                :stroke-width="node.style.strokeWidth ?? 1.5"
                :stroke-dasharray="node.style.dash && node.style.dash !== '0' ? node.style.dash : undefined"
                stroke-linejoin="round"
                vector-effect="non-scaling-stroke"
              />
            </svg>
            <span
              class="iriograph-node-content"
              :class="[
                `content-${node.nodeLabelWritingDirection === 'vertical-down' ? 'vertical' : 'horizontal'}`,
                { editable: nodeContentEditing && selectedElementIdsSet.has(node.elementId) && !readOnly },
              ]"
            >
              <img
                v-if="node.iconUrl"
                class="iriograph-node-icon"
                :class="{ editable: nodeContentEditing && selectedElementIdsSet.has(node.elementId) && !readOnly }"
                :style="nodeIconStyle(node)"
                :src="node.iconUrl"
                alt=""
                loading="lazy"
                decoding="async"
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
              ><span class="iriograph-node-label" :style="{ fontSize: node.style.labelFontSize ? `${node.style.labelFontSize}px` : undefined }">{{ node.label }}</span><small v-if="additionalLabels(node.semanticRef, node.label).length" class="iriograph-additional-labels">{{ additionalLabels(node.semanticRef, node.label).join(' ／ ') }}</small></span>
            </span>
            <button
              v-if="nodeTypeTags[node.elementId]"
              type="button"
              class="iriograph-node-type-tag"
              :title="typeTagTitle(nodeTypeTags[node.elementId]!)"
              :aria-label="`${nodeTypeTags[node.elementId]!.label}の型一覧を開く`"
              @pointerdown.stop
              @click.stop="emit('typeTagRequest', {
                elementId: node.elementId,
                typeId: nodeTypeTags[node.elementId]!.typeId,
                resourceId: nodeTypeTags[node.elementId]!.resourceId,
              })"
            >{{ nodeTypeTags[node.elementId]!.label }}</button>
            <span v-if="commentsFor(node.semanticRef)" class="iriograph-comment-callout" :class="{ visible: showAllComments }" :style="{ fontSize: node.style.labelFontSize ? `${node.style.labelFontSize}px` : undefined }" role="note">{{ commentsFor(node.semanticRef) }}</span>
            <span v-if="node.shape === 'diamond'" class="iriograph-gateway-mark">×</span>
            <span v-if="node.placement === 'user'" class="iriograph-pin-indicator" title="ユーザー調整済み">●</span>
            <span v-if="sequenceMemberBadges(node.elementId).length" class="iriograph-sequence-badges" aria-label="並び順"><span v-for="badge in sequenceMemberBadges(node.elementId)" :key="badge.key" :title="`${badge.label}の${badge.ordinal}番`">{{ badge.ordinal }}</span></span>
            <span v-if="defaultAlternativeBadges(node.elementId).length" class="iriograph-alternative-default-badges" :aria-label="`${defaultAlternativeBadges(node.elementId).map((badge) => badge.label).join('、')}の既定候補`"><span v-for="badge in defaultAlternativeBadges(node.elementId)" :key="badge.key" :title="`${badge.label}の既定候補`">既定</span></span>
          </div>

          <button
            v-for="annotation in scene.annotations ?? []"
            :key="annotation.elementId"
            type="button"
            class="iriograph-scene-annotation"
            :class="[
              `kind-${annotation.annotationKind}`,
              { selected: selectedAnnotationId === annotation.annotationId, detached: Boolean(annotation.detachedAnchorElementId) },
            ]"
            :style="{
              left: `${canvasPosition(annotationGeometry(annotation)).x}px`,
              top: `${canvasPosition(annotationGeometry(annotation)).y}px`,
              width: `${annotationGeometry(annotation).width}px`,
              minHeight: `${annotationGeometry(annotation).height}px`,
              background: annotation.style.fill,
              borderColor: annotation.style.stroke,
              color: annotation.style.text,
              fontSize: annotation.style.labelFontSize ? `${annotation.style.labelFontSize}px` : undefined,
            }"
            :title="annotation.detachedAnchorElementId ? '接続先が見つからないため注記を単独表示しています' : undefined"
            @pointerdown="startAnnotationMove($event, annotation)"
            @click.stop="emit('annotationRequest', {
              annotationId: annotation.annotationId,
              annotationKind: annotation.annotationKind,
              anchorElementId: annotation.anchorElementId,
            })"
          >
            <small>{{ annotation.annotationKind === 'semantic-literal' ? (annotation.language || annotation.datatypeIri || '意味の注記') : 'ビュー注記' }}</small>
            <span>{{ annotation.text }}</span>
          </button>

          <svg class="iriograph-edge-interaction-layer" :width="workArea.width" :height="workArea.height" :viewBox="workAreaViewBox()">
            <path
              v-if="semanticReconnectPreview"
              class="iriograph-semantic-reconnect-preview"
              :d="semanticReconnectPath()"
              aria-hidden="true"
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
            <g
              v-if="selectedEdge && !readOnly && edgeRouteMode(selectedEdge) === 'curve'"
              class="iriograph-curve-controls"
              role="group"
              aria-label="曲線の制御点"
            >
              <line
                v-for="handle in selectedCurveHandles(selectedEdge)"
                :key="`line-${handle.key}`"
                class="iriograph-curve-handle-line"
                :x1="handle.anchor.x"
                :y1="handle.anchor.y"
                :x2="handle.point.x"
                :y2="handle.point.y"
                aria-hidden="true"
              />
              <circle
                v-for="(knot, index) in selectedCurveKnots(selectedEdge)"
                :key="`knot-${index}`"
                class="iriograph-curve-knot"
                :cx="knot.point.x"
                :cy="knot.point.y"
                :r="curveControlRadius('knot')"
                :class="{ active: isActiveCurveKnot(index) }"
                tabindex="-1"
                role="button"
                :aria-label="`曲線点${index + 1}。矢印キーで移動、Deleteで削除`"
                @pointerdown="startCurveKnotMove($event, selectedEdge, index)"
                @keydown="handleCurveKnotKeydown($event, selectedEdge, index)"
              ><title>曲線点 {{ index + 1 }}</title></circle>
              <circle
                v-for="(handle, handleIndex) in selectedCurveHandles(selectedEdge)"
                :key="handle.key"
                class="iriograph-curve-handle"
                :class="{ manual: handle.manual, active: isActiveCurveHandle(selectedEdge, handleIndex) }"
                :cx="handle.point.x"
                :cy="handle.point.y"
                :r="curveControlRadius('handle')"
                tabindex="-1"
                role="button"
                :aria-label="`${handle.manual ? '手動' : '自動'}曲線ハンドル。矢印キーで調整${handle.manual ? '、Deleteで自動へ戻す' : ''}`"
                @pointerdown="startCurveHandleMove($event, selectedEdge, handle)"
                @keydown="handleCurveHandleKeydown($event, selectedEdge, handle)"
              ><title>{{ handle.manual ? '手動曲線ハンドル（Deleteで自動へ戻す）' : '自動曲線ハンドル' }}</title></circle>
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
            <span
              v-if="selectedIconNode"
              class="iriograph-node-icon-resize-handle"
              :style="nodeIconResizeHandleStyle(selectedIconNode)"
              role="button"
              tabindex="-1"
              aria-label="アイコンを縦横比を保って拡大縮小"
              title="ドラッグしてアイコンを拡大縮小"
              @pointerdown="startNodeIconResize($event, selectedIconNode)"
            />
          </div>
        </div>
      </div>
    </div>

    <aside class="iriograph-minimap" aria-label="図のミニマップ">
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
