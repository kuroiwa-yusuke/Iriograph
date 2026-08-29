<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, toRaw, useId, watch } from "vue";

import { SemanticAccessIndex } from "@iriograph/semantic-access";

import {
  applyAuthoringSource,
  applyAuthoringPreview,
  applyDocumentRebasePreview,
  applyPortableDocumentReplace,
  applySemanticSource,
  applyViewCommand,
  buildIriographView,
  createProjectionRuntimeContext,
  createStandardLayoutRegistry,
  diagnosticTargetsSceneElement,
  generatedElementId,
  packageDefaultIconAssets,
  packageDefaultIconDataUrl,
  packageDefaultIcons,
  parseSemanticGraph,
  previewDocumentRebase,
  previewPortableDocumentReplace,
  projectSemanticView,
  resolveIconContentMetrics,
  retainIncrementalReconciliationScene,
  previewAuthoringCommands,
  previewStructuredAuthoringBatch,
  previewStructuredAuthoringRequest,
  seedAuthoringCommandFromProvenance,
  semanticSourceFingerprint,
  statementIdentityForNamedStatement,
  structuredAuthoringPresentation,
  structuredLocalizedTextPresentation,
  structuredMembershipPresentation,
  structuredNodeRoleSeedFromCanvasSelections,
  structuredPredicateHierarchyPresentation,
  validateSemanticDocument,
  validateIriographDocumentV1,
  validateProjectionCatalogV1,
  withPackageDefaultIconAccess,
  type AuthoringPreview,
  type AuthoringCommand,
  type AssetAccess,
  type AssetDefinition,
  type DiagramScene,
  type DocumentRebasePreview,
  type EdgeCurveRouting,
  type EdgeRouteMode,
  type EdgeTerminalMarker,
  type ElementGeometry,
  type IriographDocument,
  type LayoutAdapterRegistry,
  type LayoutDirection,
  type NodeLabelWritingDirection,
  type Point,
  type ProjectionCatalogV1,
  type ProjectionDiagnostic,
  type ProjectionRuntimeContext,
  type RegionLabelWritingDirection,
  type ResolvedAuthoringContext,
  type ResolvedSemanticValidationContext,
  type ResourceIriAllocator,
  type RuntimeValidationIssue,
  type SemanticEditCapability,
  type SemanticSourceUpdate,
  type SemanticWarningConfirmation,
  type SceneContainer,
  type SceneEdge,
  type SceneNode,
  type SceneRegion,
  type StructuredAuthoringPresentation,
  type StructuredAuthoringRequest,
  type StructuredCanvasSelection,
  type StructuredGroupKind,
  type StructuredLocalizedTextPresentation,
  type StructuredMembershipPresentation,
  type StructuredPredicateHierarchyPresentation,
  type ViewElementOverlay,
  type VisualStyle,
  type VisualTemplate,
  type ViewCommand,
} from "@iriograph/core";

import SemanticIntentPanel, {
  type IntentAlternativeOption,
  type IntentEdgeDetails,
  type IntentElementDetails,
  type IntentMembershipOption,
  type IntentPredicateMeaning,
  type IntentRelationOverview,
  type IntentSequenceOption,
  type IntentTextValue,
  type SemanticIntent,
} from "./SemanticIntentPanel.vue";
import StructuredAuthoringWizard, {
  type StructuredAuthoringCanvasOption,
  type StructuredAuthoringCanvasSelectionRequest,
} from "./StructuredAuthoringWizard.vue";
import TargetContextMenu from "./TargetContextMenu.vue";
import StructuredElementDetailsDialog, {
  type StructuredElementDetailsSave,
} from "./StructuredElementDetailsDialog.vue";
import DiagramCanvas from "./DiagramCanvas.vue";
import TypeListPanel from "./TypeListPanel.vue";
import AppearanceEditor, { type AppearanceEditorValue } from "./AppearanceEditor.vue";
import {
  authoringDraftHasInput,
  compileAuthoringDraft,
  draftFromAuthoringCommand,
  emptyAuthoringDraft,
  type AuthoringChoice,
  type AuthoringCapabilityChoice,
  type AuthoringPreviewView,
  type AuthoringResourcePickerTarget,
  type AuthoringStructureChoice,
  type EditorAuthoringDraft,
  structureKey,
} from "../authoring-draft";
import {
  containmentPresentationTranslation,
  findContainmentConsistencyWarnings,
  type ContainmentConsistencyWarning,
} from "../containment-consistency";
import {
  AssetSceneSession,
  normalizePickedAssetRef,
  type AssetPicker,
} from "../asset-session";
import {
  appendEdgeCurveKnot,
  appendEdgeWaypoint,
  normalizeEditableRouting,
  removeEdgeCurveKnot,
  removeEdgeWaypoint,
  routingWithCurve,
  routingWithEndpointAnchor,
  type EdgeRoutingUpdate,
} from "../edge-routing";
import {
  normalizeDiagramZoom,
  type DiagramCanvasNavigationApi,
  type IriographEditorNavigationApi,
} from "../viewport";
import {
  createDiagramViewSession,
  sceneWithTemporaryHiddenElements,
  type CanvasDragMode,
  type DiagramViewSession,
} from "../view-session";
import {
  alignSelection,
  distributeSelection,
  normalizeDiagramSnapSettings,
  normalizeSceneSelection,
  resizeGeometryElement,
  sceneElementIds,
  selectedGeometryElements,
  translateSelection,
  type DiagramAlignment,
  type DiagramDistribution,
  type DiagramSelectionRequest,
  type DiagramSnapSettings,
  type DiagramSnapSettingsInput,
  type GeometryElement,
  type GeometryChange,
  type IriographEditorSelectionApi,
} from "../selection";
import type { DiagramContextMenuRequest } from "../context-actions";
import {
  createStructuredAuthoringFlow,
  reduceStructuredAuthoringFlow,
  type FlowCanvasChoice,
  type FlowInspectorDestination,
  type StructuredAuthoringFlowEffect,
  type StructuredAuthoringFlowEvent,
  type StructuredAuthoringFlowState,
} from "../structured-authoring-flow";
import {
  openTargetContextMenu,
  targetContextMenuEntries,
  type TargetContextDestination,
  type TargetContextMenuSession,
  type TargetContextSubject,
} from "../target-context-menu";
import { diagnosticGuidance } from "../diagnostic-guidance";
import { semanticDisplayMetadata } from "../semantic-metadata";
import { membershipOverviewForElement } from "../membership-overview";
import {
  displayInspectorSectionsFor,
  displayInspectorSectionForContextDestination,
  primaryDisplayInspectorSection,
  type DisplayInspectorSection,
} from "../display-inspector-sections";
import {
  layoutDirectionForRef,
  layoutRefForDirection,
  standardLayoutRefForDirection,
} from "../layout-direction";
import {
  constrainIconPresentationResize,
  constrainMembershipRegionMovement,
  membershipRegionClassIrisAtPoint,
} from "../region-membership-constraints";
import { reconcilePresentationScene } from "../presentation-scene";
import type { EditorAssetOption } from "../editor-assets";
import type { WorkspaceLocator, WorkspaceLocatorSuggestion } from "../workspace-locator";
import type {
  DocumentDuplicateHandoff,
  DocumentIdentityAllocator,
  PredicateInferencePolicy,
  StructuredAuthoringClipboard,
} from "../editor-host-contracts";
import {
  deriveTypeSystem,
  type DiagramNodeTypeTagPresentation,
  type TypeSystemAction,
  type TypeSystemFocus,
  type TypeSystemShowInDiagramRequest,
} from "../type-system";

type Panel = "diagram" | "types" | "turtle" | "document";
type SelectedElement = SceneNode | SceneContainer | SceneRegion | SceneEdge;
type GroupFrameElement = SceneContainer | SceneRegion;
type RegionLabelPlacement = "top" | "right" | "bottom" | "left";
type DocumentRefreshKind = "semantic" | "presentation";
type DisplayInspectorAction = DisplayInspectorSection;
type InspectorMode = "semantic" | "appearance";
type SemanticDestination = "element-details" | "relation-meaning" | "relation-reconnect" | "group-membership" | "group-sequence" | "group-alternatives";
type DeletionImpact = {
  key: string;
  label: string;
  kind: "relation" | "membership" | "sequence" | "alternative" | "type-reference";
};
type PendingDeletion = {
  preview: AuthoringPreview;
  impacts: DeletionImpact[];
  clearSelection: boolean;
};
type OverlayEditorIssue = {
  path: string;
  message: string;
  action: string;
};

const props = withDefaults(defineProps<{
  modelValue: IriographDocument;
  /** Primary multi-catalog projection contract. */
  runtimeContext?: ProjectionRuntimeContext;
  /** @deprecated Use runtimeContext. */
  catalog?: ProjectionCatalogV1;
  activeViewId?: string;
  layoutRegistry?: LayoutAdapterRegistry;
  title?: string;
  filePath?: string;
  dirty?: boolean;
  saving?: boolean;
  saveMessage?: string;
  canSave?: boolean;
  readOnly?: boolean;
  hideHeader?: boolean;
  /** Initial left workspace sidebar state; later toggles stay session-local. */
  initialLeftSidebarCollapsed?: boolean;
  /** Fit the first completed Scene for each document/view; later edits preserve the user's viewport. */
  fitOnInitialLoad?: boolean;
  assetAccess?: AssetAccess;
  /** Host-owned workspace path/assetRef mapping used by the icon combobox. */
  assetOptions?: readonly EditorAssetOption[];
  /** Host-owned path index. It exposes metadata only and never fetches asset bytes. */
  workspaceLocator?: WorkspaceLocator;
  pickAsset?: AssetPicker;
  snapSettings?: DiagramSnapSettingsInput;
  authoringContext?: ResolvedAuthoringContext;
  semanticValidationContext?: ResolvedSemanticValidationContext;
  resourceIriAllocator?: ResourceIriAllocator;
  /** Host-owned identity allocator used only by "duplicate as a new diagram". */
  documentIdentityAllocator?: DocumentIdentityAllocator;
  /** Query/validator policy shown by the predicate inspector; projection remains unchanged. */
  predicateInferencePolicy?: PredicateInferencePolicy;
  /** Host-owned safe structured clipboard; arbitrary source text is never evaluated. */
  structuredClipboard?: StructuredAuthoringClipboard;
}>(), {
  title: "",
  filePath: "",
  dirty: false,
  saving: false,
  saveMessage: "",
  canSave: true,
  readOnly: false,
  hideHeader: false,
  initialLeftSidebarCollapsed: true,
  fitOnInitialLoad: false,
  assetAccess: undefined,
  assetOptions: () => [],
  workspaceLocator: undefined,
  pickAsset: undefined,
  layoutRegistry: undefined,
  snapSettings: undefined,
  authoringContext: undefined,
  semanticValidationContext: undefined,
  resourceIriAllocator: undefined,
  documentIdentityAllocator: undefined,
  predicateInferencePolicy: undefined,
  structuredClipboard: undefined,
  runtimeContext: undefined,
  catalog: undefined,
  activeViewId: undefined,
});

const emit = defineEmits<{
  "update:modelValue": [document: IriographDocument];
  "update:activeViewId": [viewId: string];
  save: [];
  selectionChanged: [elementId: string];
  selectionSetChanged: [elementIds: string[]];
  validationChanged: [diagnostics: ProjectionDiagnostic[]];
  pendingDraftsChanged: [pending: boolean];
  duplicatedAsNew: [handoff: DocumentDuplicateHandoff];
}>();

const draft = ref<IriographDocument>(clone(props.modelValue));
const currentActiveViewId = ref(resolveActiveViewId(draft.value, props.activeViewId));
const viewSessions = new Map<string, DiagramViewSession>();
const viewSessionRevision = ref(0);
const turtleDraft = ref(draft.value.semantic.source);
const panel = ref<Panel>("diagram");
const overlayDrafts = ref<Record<string, string>>({});
const overlayDraftBases = ref<Record<string, string>>({});
const overlayDraftTouched = ref<Record<string, boolean>>({});
const overlayEditorIssues = ref<OverlayEditorIssue[]>([]);
const applyingOverlay = ref(false);
const portableDocumentDraft = ref(JSON.stringify(draft.value, null, 2));
const portableDocumentDraftBase = ref(JSON.stringify(draft.value));
const portableDocumentDraftTouched = ref(false);
const portableDocumentEditorIssues = ref<OverlayEditorIssue[]>([]);
const applyingPortableDocument = ref(false);
const documentRebasePreview = ref<DocumentRebasePreview>();
const documentRebaseIssues = ref<OverlayEditorIssue[]>([]);
const allocatingDocumentIdentity = ref(false);
const portableDocumentCopyMessage = ref("");
const documentRebaseDialog = ref<HTMLElement>();
const documentRebaseApplyButton = ref<HTMLButtonElement>();
const documentRebaseDialogTitleId = `${useId()}-document-rebase-dialog-title`;
const selectedElementId = ref("");
const selectedElementIds = ref<string[]>([]);
const snapSettings = ref<DiagramSnapSettings>(normalizeDiagramSnapSettings(props.snapSettings));
const zoom = ref(1);
const zoomPresets = [.25, .5, .75, 1, 1.25, 1.5, 2] as const;
const diagramCanvas = ref<DiagramCanvasNavigationApi>();
const semanticIntentPanel = ref<{
  focusPendingIntent(): void;
  focusEditSection(section: "membership" | "sequence" | "alternatives" | "reconnect"): void;
  resetIntent(): void;
}>();
const structuredAuthoringState = ref<StructuredAuthoringFlowState>(createStructuredAuthoringFlow());
const structuredCanvasPicker = ref<StructuredAuthoringCanvasSelectionRequest>();
const semanticDestination = ref<SemanticDestination>();
const targetContextMenuSession = ref<TargetContextMenuSession>({ open: false });
const contextFocusFallbackId = `${useId()}-context-return`;
let structuredRequestSequence = 0;
const turtleTextarea = ref<HTMLTextAreaElement>();
const history = ref<IriographDocument[]>([]);
const future = ref<IriographDocument[]>([]);
const schemaDiagnostics = ref<ProjectionDiagnostic[]>([]);
const applyDiagnostics = ref<ProjectionDiagnostic[]>([]);
const rawScene = ref<DiagramScene>(emptyScene(currentActiveViewId.value));
const generatedGeometryBaselines = new Map<string, Record<string, ElementGeometry>>();
const sceneLoading = ref(true);
const applyingTurtle = ref(false);
const semanticWarningConfirmation = ref<SemanticWarningConfirmation>();
const authoringDraft = ref<EditorAuthoringDraft>(emptyAuthoringDraft());
const authoringResourcePicker = ref<AuthoringResourcePickerTarget>();
const authoringBusy = ref(false);
const pickingAsset = ref(false);
const iconPathDraft = ref("");
const iconPathIssue = ref("");
const iconSelectionFeedback = ref("");
const iconAssetSelectionBusy = ref(false);
const lastIconSelection = ref<{
  elementId: string;
  assetRef: string;
  label: string;
  path?: string;
}>();
const viewCommandBusy = ref(false);
const viewDialogMode = ref<"manage" | "add" | "configure">();
const viewDialogParentMode = ref<"manage">();
const viewDeleteConfirmation = ref(false);
const viewForm = ref<{
  viewId: string;
  profileToken: string;
  layoutRef: string;
  layoutDirection: LayoutDirection | "";
  locale: string;
}>({ viewId: "", profileToken: "", layoutRef: "", layoutDirection: "LR", locale: "" });
const viewDialog = ref<HTMLFormElement>();
const viewDialogInitialFocus = ref<HTMLElement>();
const viewDialogTitleId = `${useId()}-view-dialog-title`;
const pendingDeletion = ref<PendingDeletion>();
const deletionDialog = ref<HTMLElement>();
const deletionConfirmButton = ref<HTMLButtonElement>();
const deletionDialogTitleId = `${useId()}-deletion-dialog-title`;
const leftSidebarId = `${useId()}-left-sidebar`;
const rightSidebarId = `${useId()}-right-sidebar`;
const assetSuggestionsListId = `${useId()}-asset-suggestions`;
const iconPathInputId = `${useId()}-icon-path`;
const displayInspectorSectionIdPrefix = `${useId()}-view-section`;
const leftSidebarCollapsed = ref(props.initialLeftSidebarCollapsed);
const rightSidebarCollapsed = ref(false);
const canvasDragMode = ref<CanvasDragMode>("select");
const displayInspectorAction = ref<DisplayInspectorAction>();
const openDisplayInspectorSections = ref<DisplayInspectorSection[]>([]);
const inspectorMode = ref<InspectorMode>("semantic");
const activeSemanticIntent = ref<SemanticIntent>();
const semanticIntentDraftPending = ref(false);
const pendingAuthoringGuidance = ref("");
const structuredDetails = ref<{
  elementId: string;
  title: string;
  selection: StructuredCanvasSelection;
  fields: StructuredLocalizedTextPresentation["fields"];
  selectedNodeRoleIds: readonly string[];
  currentGroupKind?: StructuredGroupKind;
  memberships: StructuredMembershipPresentation["items"];
}>();
const appearanceEditorOpen = ref(false);
const appearanceTargetIds = ref<string[]>([]);
const appearancePreviewValue = ref<AppearanceEditorValue>();
const showAllComments = ref(false);
const showCanvasGrid = ref(true);
const growNodeWithIcon = ref(true);
const typeListFocus = ref<TypeSystemFocus>();
const typeHighlightElementIds = ref<string[]>([]);
let viewDialogReturnFocus: HTMLElement | undefined;
let deletionDialogReturnFocus: HTMLElement | undefined;
const defaultLayoutRegistry = createStandardLayoutRegistry();
const assetSceneSession = new AssetSceneSession();
let lastEmittedJson = "";
let gestureBefore: IriographDocument | undefined;
let sceneRequestToken = 0;
const initiallyFittedSceneKeys = new Set<string>();
let sceneValidationAbortController: AbortController | undefined;
let semanticRequestToken = 0;
let semanticAbortController: AbortController | undefined;
let authoringRequestToken = 0;
let authoringAbortController: AbortController | undefined;
let pickerRequestToken = 0;
let pickerAbortController: AbortController | undefined;
let iconAssetSelectionRequestToken = 0;
let viewCommandRequestToken = 0;
let viewCommandAbortController: AbortController | undefined;
let portableDocumentRequestToken = 0;
let portableDocumentAbortController: AbortController | undefined;
let documentIdentityRequestToken = 0;
let documentIdentityAbortController: AbortController | undefined;
let localDocumentRevision = 0;
let documentIdentityRequestSequence = 0;
let documentRebaseReturnFocus: HTMLElement | undefined;

const activeView = computed(() => draft.value.views.find((view) => (
  view.viewId === currentActiveViewId.value
)) ?? draft.value.views[0]);
const activeOverlayDraft = computed({
  get: () => {
    const view = activeView.value;
    if (!view) return "{}";
    return overlayDrafts.value[view.viewId] ?? JSON.stringify(view.overlay, null, 2);
  },
  set: (value: string) => {
    const view = activeView.value;
    if (!view) return;
    if (!(view.viewId in overlayDraftBases.value)) {
      overlayDraftBases.value = {
        ...overlayDraftBases.value,
        [view.viewId]: JSON.stringify(view.overlay),
      };
    }
    overlayDrafts.value = { ...overlayDrafts.value, [view.viewId]: value };
    overlayDraftTouched.value = { ...overlayDraftTouched.value, [view.viewId]: true };
    overlayEditorIssues.value = [];
  },
});
const overlayPendingViewIds = computed(() => draft.value.views.flatMap((view) => {
  if (!overlayDraftTouched.value[view.viewId]) return [];
  const candidate = overlayDrafts.value[view.viewId];
  return candidate !== undefined && candidate !== JSON.stringify(view.overlay, null, 2)
    ? [view.viewId]
    : [];
}));
const overlayPending = computed(() => overlayPendingViewIds.value.length > 0);
const portableDocumentPending = computed(() => (
  portableDocumentDraftTouched.value
  && portableDocumentDraft.value !== JSON.stringify(draft.value, null, 2)
));
const zoomListValue = computed(() => {
  const preset = zoomPresets.find((value) => Math.abs(value - zoom.value) < .001);
  return preset === undefined ? `current:${zoom.value}` : `zoom:${preset}`;
});
const scene = computed(() => {
  viewSessionRevision.value;
  return sceneWithTemporaryHiddenElements(
    rawScene.value,
    sessionFor(activeView.value?.viewId ?? "").temporaryHiddenElementIds,
  );
});
const renderedScene = computed<DiagramScene>(() => {
  const value = appearancePreviewValue.value;
  const ids = new Set(appearanceTargetIds.value);
  if (!value || ids.size === 0) return scene.value;
  const apply = <T extends SceneNode | SceneContainer | SceneRegion | SceneEdge>(element: T): T => (
    ids.has(element.elementId)
      ? { ...element, style: previewAppearanceStyle(element, value) }
      : element
  );
  return {
    ...scene.value,
    nodes: scene.value.nodes.map(apply),
    containers: scene.value.containers.map(apply),
    regions: scene.value.regions?.map(apply),
    edges: scene.value.edges.map(apply),
  };
});
const containmentWarnings = computed(() => findContainmentConsistencyWarnings(scene.value));
const containmentWarningElementIds = computed(() => [...new Set(
  containmentWarnings.value.map((warning) => warning.elementId),
)]);
const selectedElementIdsSet = computed(() => new Set(selectedElementIds.value));
const selectedElement = computed<SelectedElement | undefined>(() => [
  ...scene.value.nodes,
  ...scene.value.containers,
  ...(scene.value.regions ?? []),
  ...scene.value.edges,
].find((element) => element.elementId === selectedElementId.value));
const displayInspectorSections = computed(() => displayInspectorSectionsFor(
  selectedElement.value
    ? {
        structuralKind: selectedElement.value.structuralKind,
        hasGeometry: "geometry" in selectedElement.value,
        groupFrame: (selectedElement.value.structuralKind === "container"
          || selectedElement.value.structuralKind === "region")
          && Boolean(selectedElement.value.groupFrame),
      }
    : undefined,
));
watch(
  () => {
    const selected = selectedElement.value;
    const groupFrame = selected
      && (selected.structuralKind === "container" || selected.structuralKind === "region")
      ? Boolean(selected.groupFrame)
      : false;
    return `${selectedElementId.value}:${selected?.structuralKind ?? ""}:${groupFrame}`;
  },
  () => {
    const primary = primaryDisplayInspectorSection(selectedElement.value
      ? {
          structuralKind: selectedElement.value.structuralKind,
          hasGeometry: "geometry" in selectedElement.value,
          groupFrame: (selectedElement.value.structuralKind === "container"
            || selectedElement.value.structuralKind === "region")
            && Boolean(selectedElement.value.groupFrame),
        }
      : undefined);
    displayInspectorAction.value = primary;
    openDisplayInspectorSections.value = primary ? [primary] : [];
  },
);
watch(
  [selectedElementIds, inspectorMode, openDisplayInspectorSections],
  () => {
    if (
      inspectorMode.value === "appearance"
      && openDisplayInspectorSections.value.includes("appearance")
      && selectedElement.value
    ) openAppearanceEditor();
    else if (appearanceEditorOpen.value) closeAppearanceEditor();
  },
  { immediate: true },
);
const selectedOverlay = computed<ViewElementOverlay | undefined>(() => {
  if (!activeView.value || !selectedElementId.value) return undefined;
  return activeView.value.overlay[selectedElementId.value];
});
const projectionRuntimeContext = computed<ProjectionRuntimeContext | undefined>(() => {
  const source = props.runtimeContext ?? props.authoringContext?.runtime;
  if (source) return unwrapProjectionRuntimeContext(source);
  return props.catalog ? projectionContextFromLegacyCatalog(props.catalog) : undefined;
});
const activeCatalog = computed(() => {
  const view = activeView.value;
  return view ? projectionRuntimeContext.value?.catalogsByProfile.get(view.profileRef)?.catalog : undefined;
});
const profileChoices = computed(() => [...(projectionRuntimeContext.value?.catalogsByProfile.entries() ?? [])]
  .map(([profileRef, projection], index) => {
    const hasRegionRules = projection.catalog.rules.some((rule) => (
      rule.project.operator === "membership-region"
    ));
    return {
      token: `profile-${index + 1}`,
      profileRef,
      label: `表示プロファイル ${index + 1}`,
      purpose: hasRegionRules ? "領域と関係" : "要素と関係",
    };
  }));
function profileTokenForRef(profileRef: string | undefined): string {
  return profileChoices.value.find((choice) => choice.profileRef === profileRef)?.token
    ?? profileChoices.value[0]?.token
    ?? "";
}
function profileRefForToken(token: string): string | undefined {
  return profileChoices.value.find((choice) => choice.token === token)?.profileRef;
}
function profileDisplayLabel(profileRef: string | undefined): string {
  const choice = profileChoices.value.find((candidate) => candidate.profileRef === profileRef);
  return choice ? `${choice.label}（${choice.purpose}）` : "表示プロファイル";
}
const selectedEdge = computed(() => selectedElement.value?.structuralKind === "edge"
  ? selectedElement.value
  : undefined);
const semanticMetadata = computed(() => semanticDisplayMetadata(draft.value));
const edgeRouteModes = computed<Record<string, EdgeRouteMode>>(() => Object.fromEntries(
  scene.value.edges.map((edge) => [edge.elementId, routeModeFor(edge)]),
));
const selectedRouteMode = computed<EdgeRouteMode>(() => (
  selectedEdge.value ? routeModeFor(selectedEdge.value) : "auto"
));
const selectedWaypointEditingAvailable = computed(() => (
  selectedRouteMode.value !== "straight" && selectedRouteMode.value !== "curve"
));
const selectedManualWaypoints = computed(() => (
  selectedWaypointEditingAvailable.value ? selectedEdge.value?.waypoints ?? [] : []
));
const selectedCurveKnots = computed(() => (
  selectedRouteMode.value === "curve" ? selectedEdge.value?.curve?.knots ?? [] : []
));
const selectedEdgeDisplayName = computed(() => {
  const edge = selectedEdge.value;
  if (!edge) return "";
  const provenance = edge.labelProvenance as (SceneEdge["labelProvenance"] & {
    fromOrdinal?: number;
    toOrdinal?: number;
  }) | undefined;
  if (
    !edge.label
    && provenance?.kind === "derived-structure"
    && provenance.role === "sequence-transition"
    && Number.isSafeInteger(provenance.fromOrdinal)
    && Number.isSafeInteger(provenance.toOrdinal)
  ) return `順序 ${provenance.fromOrdinal}→${provenance.toOrdinal}`;
  return edge.label || "名前のない関係";
});
const selectedEdgeEndpointLabels = computed(() => {
  const edge = selectedEdge.value;
  if (!edge) return { source: "始点", target: "終点" };
  return {
    source: edgeEndpointLabel(edge.sourceElementId, "始点"),
    target: edgeEndpointLabel(edge.targetElementId, "終点"),
  };
});
const regionZOrders = computed<Record<string, number>>(() => Object.fromEntries(
  (scene.value.regions ?? []).map((region, index) => [region.elementId, regionZOrderFor(region.elementId, index)]),
));
const hasSelectedEditableRouting = computed(() => Boolean(
  selectedEdge.value?.waypoints?.length
    || selectedEdge.value?.curve
    || selectedEdge.value?.labelOffset
    || selectedEdge.value?.sourceAnchor
    || selectedEdge.value?.targetAnchor
    || activeView.value?.overlay[selectedEdge.value?.elementId ?? ""]?.routing?.sourceMarker
    || activeView.value?.overlay[selectedEdge.value?.elementId ?? ""]?.routing?.targetMarker,
));
const diagnostics = computed(() => [
  ...schemaDiagnostics.value,
  ...applyDiagnostics.value,
  ...scene.value.diagnostics,
].filter(uniqueDiagnostic()));
const semanticValidationContext = computed<ResolvedSemanticValidationContext | undefined>(() => {
  const source = props.semanticValidationContext ?? props.authoringContext?.semanticValidation;
  if (!source) return undefined;
  const raw = toRaw(source);
  return { ...raw, validator: toRaw(raw.validator) };
});
const sceneError = computed(() => [
  ...schemaDiagnostics.value,
  ...scene.value.diagnostics,
].find((item) => item.severity === "error" && item.category !== "domain"));
const errorCount = computed(() => diagnostics.value.filter((item) => item.severity === "error").length);
const warningCount = computed(() => diagnostics.value.filter((item) => item.severity === "warning").length);
const turtlePending = computed(() => turtleDraft.value !== draft.value.semantic.source);
const structuredAuthoringPending = computed(() => (
  semanticIntentDraftPending.value
  || authoringDraftHasInput(authoringDraft.value)
  || Boolean(pendingDeletion.value)
  || structuredAuthoringState.value.phase !== "intent"
  || Boolean(structuredCanvasPicker.value)
));
const currentDocumentRevision = computed(() => props.authoringContext?.documentRevision
  ?? `editor:${draft.value.documentId}:${localDocumentRevision}`);
const documentRebaseBlockedReason = computed(() => {
  if (props.readOnly) return "読み取り専用のため複製できません。";
  if (!props.documentIdentityAllocator) return "Hostから新しい文書IDの発行機能が提供されていません。";
  if (!projectionRuntimeContext.value) return "表示規則を検証できないため複製できません。";
  if (turtlePending.value || overlayPending.value || portableDocumentPending.value || structuredAuthoringPending.value) {
    return "入力中の変更を適用または破棄してから複製してください。";
  }
  return "";
});
const authoringContext = computed<ResolvedAuthoringContext | undefined>(() => {
  if (!props.authoringContext) return undefined;
  const source = toRaw(props.authoringContext);
  const runtime = projectionRuntimeContext.value ?? unwrapProjectionRuntimeContext(toRaw(source.runtime));
  return {
    ...source,
    runtime,
    allocator: toRaw(props.resourceIriAllocator ?? source.allocator),
    semanticValidation: semanticValidationContext.value,
  };
});
const authoringBlockedReason = computed(() => {
  if (props.readOnly) return "読み取り専用のため意味グラフを編集できません。";
  if (!authoringContext.value) return "Hostからauthoring contextが提供されていません。";
  if (portableDocumentPending.value) return "Document全体のdraftを適用または破棄してください。";
  if (overlayPending.value) return "DocumentのView overlay draftを適用または破棄してください。";
  if (turtlePending.value) return "未適用のTurtle draftを適用または破棄してください。";
  return "";
});
const authoringEnabled = computed(() => !authoringBlockedReason.value);
const EMPTY_STRUCTURED_AUTHORING_PRESENTATION: StructuredAuthoringPresentation = {
  profile: { allowUntypedNodes: false, nodeRoles: [] },
  groupKinds: [],
  relationFamilies: [],
  predicateCatalog: [],
  capabilities: [],
};
const structuredPresentation = computed<StructuredAuthoringPresentation>(() => (
  authoringContext.value
    ? structuredAuthoringPresentation(authoringContext.value)
    : EMPTY_STRUCTURED_AUTHORING_PRESENTATION
));
const typeSystemIndex = computed(() => deriveTypeSystem(draft.value, {
  authoringProfile: authoringContext.value?.structuredAuthoring,
  locale: activeView.value?.locale ?? authoringContext.value?.defaultLocale,
  resourceIris: scene.value.nodes.map((node) => node.semanticRef),
}));
const typeSystemTypeById = computed(() => new Map(
  typeSystemIndex.value.presentation.types.map((item) => [item.typeId, item]),
));
const typeSystemResourceByIri = computed(() => new Map(
  typeSystemIndex.value.presentation.resources.flatMap((item) => {
    const iri = typeSystemIndex.value.resolveResourceId(item.resourceId);
    return iri ? [[iri, item] as const] : [];
  }),
));
const nodeTypeTags = computed<Record<string, DiagramNodeTypeTagPresentation>>(() => Object.fromEntries(scene.value.nodes.flatMap((node) => {
  const resource = typeSystemResourceByIri.value.get(node.semanticRef);
  if (!resource?.primaryDirectTypeId) return [];
  const type = typeSystemTypeById.value.get(resource.primaryDirectTypeId);
  if (!type) return [];
  return [[node.elementId, {
    typeId: type.typeId,
    resourceId: resource.resourceId,
    label: type.label,
    additionalDirectCount: Math.max(0, resource.directTypeIds.length - 1),
    inheritedCount: resource.inheritedTypeIds.length,
  }]];
})));
const structuredRequestId = computed(() => (
  `editor:${draft.value.documentId}:${localDocumentRevision}:${structuredRequestSequence + 1}`
));
const authoringClassChoices = computed<AuthoringChoice[]>(() => {
  const choices = new Map<string, AuthoringChoice>();
  for (const term of authoringContext.value?.terms ?? []) {
    if (term.kind === "class") choices.set(term.iri, {
      iri: term.iri,
      label: term.label,
      description: term.description,
      category: term.category,
      example: term.examples?.[0],
      sentencePattern: term.sentencePattern,
    });
  }
  for (const item of typeSystemIndex.value.presentation.types) {
    const iri = typeSystemIndex.value.resolveTypeId(item.typeId);
    if (!iri || choices.has(iri)) continue;
    choices.set(iri, {
      iri,
      label: item.label,
      description: item.description,
    });
  }
  const graph = parseSemanticGraph(draft.value);
  const rdfType = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
  const rdfsClass = "http://www.w3.org/2000/01/rdf-schema#Class";
  for (const quad of graph.quads) {
    if (
      quad.subject.termType !== "NamedNode"
      || quad.predicate.value !== rdfType
      || quad.object.termType !== "NamedNode"
      || quad.object.value !== rdfsClass
    ) continue;
    const existing = choices.get(quad.subject.value);
    const label = existing?.label ?? semanticMetadata.value[quad.subject.value]?.labels[0]?.value;
    choices.set(quad.subject.value, {
      ...existing,
      iri: quad.subject.value,
      label,
    });
  }
  return [...choices.values()];
});
const authoringPropertyChoices = computed<AuthoringChoice[]>(() => authoringContext.value?.terms
  .filter((term) => term.kind === "property" && !term.structural)
  .map(({ iri, label, description, category, examples, sentencePattern }) => ({
    iri,
    label,
    description,
    category,
    example: examples?.[0],
    sentencePattern,
  })) ?? []);
const authoringEdgeChoices = computed<AuthoringChoice[]>(() => {
  const terms = authoringContext.value?.terms.filter((term) => (
    term.kind === "property"
    && !term.structural
    && !/^http:\/\/www\.w3\.org\/1999\/02\/22-rdf-syntax-ns#_[1-9][0-9]*$/u.test(term.iri)
    && (!term.objectKinds || term.objectKinds.includes("iri"))
  )) ?? [];
  const graph = parseSemanticGraph(draft.value);
  const rdfType = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
  const rdfsDomain = "http://www.w3.org/2000/01/rdf-schema#domain";
  const rdfsRange = "http://www.w3.org/2000/01/rdf-schema#range";
  const rdfsSubClassOf = "http://www.w3.org/2000/01/rdf-schema#subClassOf";
  const rdfsSeeAlso = "http://www.w3.org/2000/01/rdf-schema#seeAlso";
  const typesOf = (iri: string) => new Set(graph.quads.filter((quad) => (
    quad.subject.termType === "NamedNode"
    && quad.subject.value === iri
    && quad.predicate.value === rdfType
    && quad.object.termType === "NamedNode"
  )).map((quad) => quad.object.value));
  const relationIris = (predicateIri: string, relationIri: string) => graph.quads.filter((quad) => (
    quad.subject.termType === "NamedNode"
    && quad.subject.value === predicateIri
    && quad.predicate.value === relationIri
    && quad.object.termType === "NamedNode"
  )).map((quad) => quad.object.value);
  const expandTypes = (initial: Set<string>) => {
    const result = new Set(initial);
    const queue = [...initial];
    while (queue.length) {
      const typeIri = queue.shift()!;
      for (const parent of relationIris(typeIri, rdfsSubClassOf)) {
        if (result.has(parent)) continue;
        result.add(parent);
        queue.push(parent);
      }
    }
    return result;
  };
  const sourceTypes = expandTypes(typesOf(
    authoringDraft.value.sourceIri || selectedAuthoringResources.value[0]?.iri || "",
  ));
  const targetTypes = expandTypes(typesOf(
    authoringDraft.value.targetIri || selectedAuthoringResources.value[1]?.iri || "",
  ));
  const labelFor = (iri: string) => semanticMetadata.value[iri]?.labels[0]?.value ?? "名前のない要素";
  return terms.flatMap((term): AuthoringChoice[] => {
    const { iri, label } = term;
    const domains = relationIris(iri, rdfsDomain);
    const ranges = relationIris(iri, rdfsRange);
    if (domains.length && sourceTypes.size && !domains.every((value) => sourceTypes.has(value))) return [];
    if (ranges.length && targetTypes.size && !ranges.every((value) => targetTypes.has(value))) return [];
    let priority = 0;
    if (domains.length && sourceTypes.size) priority += 20;
    if (ranges.length && targetTypes.size) priority += 10;
    const exampleQuad = graph.quads.find((quad) => (
      quad.subject.termType === "NamedNode"
      && quad.predicate.value === iri
      && quad.object.termType === "NamedNode"
    ));
    return [{
      iri,
      label: label ?? semanticMetadata.value[iri]?.labels[0]?.value,
      description: term.description
        ?? semanticMetadata.value[iri]?.comments.map((item) => item.value).join("\n"),
      category: term.category ?? (iri === rdfsSeeAlso ? "参照" : "関係"),
      example: term.examples?.[0] ?? (exampleQuad?.subject.termType === "NamedNode" && exampleQuad.object.termType === "NamedNode"
        ? `${labelFor(exampleQuad.subject.value)} → ${labelFor(exampleQuad.object.value)}`
        : undefined),
      sentencePattern: term.sentencePattern,
      priority,
    }];
  }).sort((left, right) => (
    (right.priority ?? 0) - (left.priority ?? 0)
    || (left.label ?? left.iri).localeCompare(right.label ?? right.iri, "ja")
  ));
});
const authoringCapabilityChoices = computed<AuthoringCapabilityChoice[]>(() => authoringContext.value?.capabilities
  .map(({ capabilityId, label, parameters }) => ({ iri: capabilityId, label, parameters })) ?? []);
const authoringResourceChoices = computed<AuthoringChoice[]>(() => {
  const choices = new Map<string, AuthoringChoice>();
  const add = (iri: string, label?: string) => {
    const current = choices.get(iri);
    if (!current || (!current.label && label)) choices.set(iri, { iri, label });
  };
  for (const element of [...scene.value.containers, ...scene.value.nodes]) {
    add(element.semanticRef, element.label);
  }
  for (const element of scene.value.regions ?? []) add(element.semanticRef, element.label);
  const provenances = [
    ...scene.value.containers.flatMap((element) => [element.provenance, element.parentProvenance]),
    ...scene.value.nodes.flatMap((element) => [element.provenance, element.parentProvenance]),
    ...(scene.value.regions ?? []).map((element) => element.provenance),
    ...scene.value.edges.map((element) => element.provenance),
  ];
  for (const provenance of provenances) {
    const capability = provenance?.editCapability;
    if (!capability) continue;
    for (const iri of capabilityResourceIris(capability)) add(iri);
  }
  return [...choices.values()];
});
const authoringContainerChoices = computed<AuthoringChoice[]>(() => {
  const classRegionIds = new Set((scene.value.regions ?? [])
    .filter((region) => region.provenance?.operator === "membership-region")
    .map((region) => region.elementId));
  return [
    ...scene.value.containers,
    ...(scene.value.regions ?? []).filter((region) => !classRegionIds.has(region.elementId)),
  ].map((element) => ({
  iri: element.semanticRef,
  label: element.label,
  structuralKind: element.structuralKind as "container" | "region",
}))
    .filter((choice, index, all) => all.findIndex((candidate) => candidate.iri === choice.iri) === index);
});
const selectedAuthoringResource = computed<AuthoringChoice | undefined>(() => {
  const element = selectedElement.value;
  return element && element.structuralKind !== "edge"
    ? {
        iri: element.semanticRef,
        label: element.label,
        structuralKind: element.structuralKind,
      }
    : undefined;
});
const selectedAuthoringResources = computed<AuthoringChoice[]>(() => {
  const candidates = [
    ...scene.value.containers,
    ...(scene.value.regions ?? []),
    ...scene.value.nodes,
  ];
  const choices = selectedElementIds.value
    .map((elementId) => candidates.find((candidate) => candidate.elementId === elementId))
    .filter((candidate): candidate is typeof candidates[number] => Boolean(candidate))
    .map((element) => ({
      iri: element.semanticRef,
      label: element.label,
      structuralKind: element.structuralKind as "node" | "container" | "region",
    }));
  return choices.filter((choice, index) => (
    choices.findIndex((candidate) => candidate.iri === choice.iri) === index
  ));
});
const structuredCanvasOptions = computed<StructuredAuthoringCanvasOption[]>(() => {
  const selection = (elementId: string): StructuredCanvasSelection => ({
    viewId: currentActiveViewId.value,
    elementId,
  });
  const groups = [...scene.value.containers, ...(scene.value.regions ?? [])]
    .flatMap((element): StructuredAuthoringCanvasOption[] => {
      const groupKind = element.groupFrame?.kind;
      if (!groupKind) return [];
      return [{
        selection: selection(element.elementId),
        kind: "group",
        groupKind,
        label: element.label,
        description: structuredGroupKindLabel(groupKind),
        shape: "group",
      }];
    });
  return [
    ...scene.value.nodes.map((node): StructuredAuthoringCanvasOption => ({
      selection: selection(node.elementId),
      kind: "node",
      label: node.label,
      shape: node.shape === "diamond" || node.shape === "circle"
        ? node.shape
        : node.shape === "rounded-rectangle" ? "rounded" : "rectangle",
    })),
    ...groups,
    ...scene.value.edges.flatMap((edge): StructuredAuthoringCanvasOption[] => (
      edge.labelProvenance?.kind === "derived-structure"
        ? []
        : [{
            selection: selection(edge.elementId),
            kind: "direct-edge",
            label: edge.label || "名称のない関係",
            description: "直接つながる関係",
          }]
    )),
  ];
});
const structuredPreselection = computed<FlowCanvasChoice[]>(() => selectedElementIds.value
  .flatMap((elementId) => {
    const option = structuredCanvasOptions.value.find((candidate) => candidate.selection.elementId === elementId);
    return option ? [{ selection: { ...option.selection }, kind: option.kind, groupKind: option.groupKind }] : [];
  }));
watch(
  [structuredPreselection, () => structuredPresentation.value.profile.allowUntypedNodes],
  ([preselection, allowUntypedNodes]) => {
    if (structuredAuthoringState.value.phase !== "intent") return;
    structuredAuthoringState.value = {
      ...structuredAuthoringState.value,
      preselection: preselection.map(copyFlowChoice),
      allowUntypedNodes,
    };
  },
  { immediate: true },
);
const intentElementDetails = computed<IntentElementDetails | undefined>(() => {
  if (selectedAuthoringResources.value.length !== 1) return undefined;
  const selected = selectedElement.value;
  if (!selected || selected.structuralKind === "edge") return undefined;
  const graph = parseSemanticGraph(draft.value);
  const classIris = graph.quads.filter((quad) => (
    quad.subject.termType === "NamedNode"
    && quad.subject.value === selected.semanticRef
    && quad.predicate.value === "http://www.w3.org/1999/02/22-rdf-syntax-ns#type"
    && quad.object.termType === "NamedNode"
  )).map((quad) => quad.object.value);
  const semanticText = selected.semanticText;
  const toValue = (item: NonNullable<typeof semanticText>["labels"][number]): IntentTextValue => ({
    value: item.value,
    ...(item.language
      ? { language: item.language }
      : item.datatypeIri ? { datatypeIri: item.datatypeIri } : {}),
  });
  const primaryStatementRef = semanticText?.primaryLabel?.statementRef;
  const labels = semanticText?.labels ?? [];
  const orderedLabels = primaryStatementRef
    ? [...labels].sort((left, right) => Number(right.statementRef === primaryStatementRef) - Number(left.statementRef === primaryStatementRef))
    : labels;
  return {
    iri: selected.semanticRef,
    label: selected.label,
    labelValues: orderedLabels.length ? orderedLabels.map(toValue) : [{ value: selected.label }],
    commentValues: (semanticText?.comments ?? []).map(toValue),
    classIris: [...new Set(classIris)],
  };
});
const predicateMeanings = computed<Record<string, IntentPredicateMeaning>>(() => {
  const revision = authoringContext.value?.documentRevision
    ?? `semantic:${semanticSourceFingerprint(draft.value.semantic.source)}`;
  let index: SemanticAccessIndex;
  try {
    index = new SemanticAccessIndex(draft.value, revision, {
      locales: [activeView.value?.locale, authoringContext.value?.defaultLocale]
        .filter((value): value is string => Boolean(value)),
    });
  } catch {
    return {};
  }
  const labelFor = (iri: string): string => {
    const reference = index.resourceAlias(iri);
    if (reference) {
      try {
        return index.describe(reference).label;
      } catch {
        // The exact IRI fallback below remains stable for malformed metadata.
      }
    }
    return authoringContext.value?.terms.find((term) => term.iri === iri)?.label
      ?? semanticMetadata.value[iri]?.labels[0]?.value
      ?? "名前のない関係";
  };
  return Object.fromEntries(authoringEdgeChoices.value.map((choice) => {
    const predicate = index.predicateAlias(choice.iri);
    const resource = index.resourceAlias(choice.iri);
    const description = resource ? index.describe(resource) : undefined;
    const hierarchy = predicate ? index.predicateHierarchy(predicate) : undefined;
    const paths = new Map<string, { iris: string[]; labels: string[] }>();
    for (const relation of hierarchy?.relations ?? []) {
      for (const path of relation.paths ?? []) {
        const iris = [...path];
        paths.set(iris.join("\u0000"), { iris, labels: iris.map(labelFor) });
      }
    }
    return [choice.iri, {
      iri: choice.iri,
      label: choice.label ?? description?.label ?? labelFor(choice.iri),
      description: choice.description ?? description?.description,
      hierarchyPaths: [...paths.values()].sort((left, right) => (
        left.iris.length - right.iris.length
        || left.iris.join("\u0000").localeCompare(right.iris.join("\u0000"))
      )),
      hierarchyDiagnostics: (hierarchy?.diagnostics ?? []).map((diagnostic) => ({
        code: diagnostic.code,
        labels: "path" in diagnostic && Array.isArray(diagnostic.path)
          ? diagnostic.path.map(labelFor)
          : [],
      })),
    } satisfies IntentPredicateMeaning];
  }));
});
const structuredPredicateHierarchy = computed<StructuredPredicateHierarchyPresentation>(() => {
  const context = authoringContext.value;
  if (!context) return {
    predicates: [],
    queryExplanation: "検索規則を読み込めません。",
    validationExplanation: "検証規則を読み込めません。",
  };
  return structuredPredicateHierarchyPresentation(context, {
    predicates: Object.values(predicateMeanings.value).map((meaning) => ({
      predicateIri: meaning.iri,
      paths: meaning.hierarchyPaths.map((path) => ({
        iris: [...path.iris],
        labels: [...path.labels],
      })),
      diagnostics: meaning.hierarchyDiagnostics.map((diagnostic) => ({
        code: diagnostic.code,
        labels: [...diagnostic.labels],
      })),
      truncated: meaning.hierarchyDiagnostics.some((diagnostic) => (
        diagnostic.code === "hierarchy-path-budget-exceeded"
      )),
    })),
    inferencePolicy: {
      query: props.predicateInferencePolicy?.query ?? "exact",
      validation: props.predicateInferencePolicy?.validation ?? "exact",
    },
  });
});
const intentEdgeDetails = computed<IntentEdgeDetails | undefined>(() => {
  const edge = selectedEdge.value;
  if (!edge) return undefined;
  const source = geometryElement(edge.sourceElementId);
  const target = geometryElement(edge.targetElementId);
  const capability = edge.provenance?.editCapability;
  const removable = capability?.command === "remove-statement" ? capability : undefined;
  const provenance = edge.labelProvenance;
  let derivedReason: string | undefined;
  if (provenance?.kind === "derived-structure") {
    derivedReason = provenance.role === "sequence-transition"
      ? "この線は並び順から自動生成されています。関係として直接編集せず、元の並び順を編集してください。"
      : "この線は分岐構造から自動生成されています。関係として直接編集せず、元の分岐を編集してください。";
  } else if (!removable) {
    derivedReason = "この線には元のRDF文を特定できる編集情報がないため、直接変更できません。";
  }
  return {
    label: selectedEdgeDisplayName.value,
    sourceIri: removable?.subject ?? source?.semanticRef ?? "",
    sourceLabel: source?.label ?? "始点",
    predicateIri: removable?.predicate
      ?? (provenance?.kind === "predicate" ? provenance.labelSemanticRef : edge.semanticRef),
    targetIri: removable?.object ?? target?.semanticRef ?? "",
    targetLabel: target?.label ?? "終点",
    statementComments: (edge.statementComments ?? []).map((comment) => ({
      value: comment.value,
      ...(comment.language
        ? { language: comment.language }
        : comment.datatypeIri ? { datatypeIri: comment.datatypeIri } : {}),
    })),
    capability: removable,
    derivedReason,
    viewResolution: {
      selectedMatch: edge.provenance?.resolutionTrace?.selected?.match,
      fallbackReason: edge.provenance?.resolutionTrace?.fallback?.reason,
      candidateMatches: edge.provenance?.resolutionTrace?.candidates.map((candidate) => candidate.match) ?? [],
      conflictCount: edge.provenance?.resolutionTrace?.conflicts?.length ?? 0,
    },
  };
});
const intentIncidentRelations = computed<IntentRelationOverview[]>(() => {
  const selectedIris = new Set(selectedAuthoringResources.value.map((resource) => resource.iri));
  if (selectedIris.size === 0) return [];
  return scene.value.edges.flatMap((edge): IntentRelationOverview[] => {
    const source = geometryElement(edge.sourceElementId);
    const target = geometryElement(edge.targetElementId);
    if (!source || !target) return [];
    const sourceSelected = selectedIris.has(source.semanticRef);
    const targetSelected = selectedIris.has(target.semanticRef);
    if (!sourceSelected && !targetSelected) return [];
    const capability = edge.provenance?.editCapability;
    const provenance = edge.labelProvenance;
    const predicateIri = capability?.command === "remove-statement"
      ? capability.predicate
      : provenance?.kind === "predicate"
        ? provenance.labelSemanticRef
        : edge.semanticRef;
    const predicateLabel = authoringEdgeChoices.value.find((choice) => choice.iri === predicateIri)?.label
      ?? edge.label;
    let derivedReason: string | undefined;
    if (provenance?.kind === "derived-structure") {
      derivedReason = provenance.role === "sequence-transition"
        ? "並び順から自動生成された表示です。"
        : "分岐構造から自動生成された表示です。";
    }
    return [{
      edgeElementId: edge.elementId,
      sourceIri: source.semanticRef,
      sourceLabel: source.label,
      predicateIri,
      predicateLabel,
      targetIri: target.semanticRef,
      targetLabel: target.label,
      direction: sourceSelected && targetSelected ? "both" : sourceSelected ? "outgoing" : "incoming",
      derivedReason,
    }];
  }).sort((left, right) => (
    left.sourceLabel.localeCompare(right.sourceLabel, "ja")
    || left.predicateLabel.localeCompare(right.predicateLabel, "ja")
    || left.targetLabel.localeCompare(right.targetLabel, "ja")
  ));
});
const intentMembershipOverview = computed(() => membershipOverviewForElement(
  scene.value,
  selectedElement.value?.structuralKind === "edge" ? "" : selectedElement.value?.elementId ?? "",
));
const intentMembershipOptions = computed<IntentMembershipOption[]>(() => {
  const result: IntentMembershipOption[] = [];
  const candidates = [...scene.value.containers, ...(scene.value.regions ?? [])];
  for (const container of candidates) {
    const memberships = (scene.value.memberships ?? []).filter((membership) => (
      membership.containerElementId === container.elementId
      || membership.regionElementId === container.elementId
    ));
    const capability = memberships.map((item) => item.provenance.editCapability)
      .find((item): item is Extract<SemanticEditCapability, { command: "set-membership" }> => item?.command === "set-membership");
    const ruleId = container.provenance?.rule?.ruleId;
    const rule = activeCatalog.value?.rules.find((item) => item.ruleId === ruleId);
    const operator = rule?.project;
    if (!capability && operator?.operator !== "membership-container" && operator?.operator !== "membership-region") continue;
    const memberIris = memberships.flatMap((membership) => {
      const member = geometryElement(membership.memberElementId);
      return member ? [member.semanticRef] : [];
    });
    result.push({
      containerIri: container.semanticRef,
      label: container.label,
      containerTypeIri: capability?.containerTypeIri
        ?? (rule?.match.kind === "type" ? rule.match.iri : ""),
      predicateIri: capability?.predicate
        ?? (operator?.operator === "membership-container" || operator?.operator === "membership-region"
          ? operator.membershipPredicate
          : ""),
      containerPosition: capability?.containerPosition
        ?? (operator?.operator === "membership-region" ? operator.containerPosition : "subject"),
      memberIris: [...new Set(memberIris)],
    });
  }
  return result.filter((option) => option.containerTypeIri && option.predicateIri);
});
const intentSequenceOptions = computed<IntentSequenceOption[]>(() => {
  const selectedIris = new Set(selectedAuthoringResources.value.map((resource) => resource.iri));
  const selectedSequenceIri = selectedEdge.value?.provenance?.editCapability?.command === "set-sequence"
    ? selectedEdge.value.provenance.editCapability.sequence
    : undefined;
  if (selectedIris.size === 0 && !selectedSequenceIri) return [];
  const result: IntentSequenceOption[] = [];
  for (const sequence of scene.value.containers.filter((container) => container.groupRole === "sequence")) {
    const memberships = (scene.value.memberships ?? [])
      .filter((membership) => (
        membership.role === "sequence-member"
        && membership.containerElementId === sequence.elementId
      ))
      .sort((left, right) => (
        (left.ordinal ?? Number.MAX_SAFE_INTEGER) - (right.ordinal ?? Number.MAX_SAFE_INTEGER)
        || left.semanticRef.localeCompare(right.semanticRef)
      ));
    if (selectedSequenceIri !== sequence.semanticRef && !selectedIris.has(sequence.semanticRef) && !memberships.some((membership) => {
      const member = geometryElement(membership.memberElementId);
      return member ? selectedIris.has(member.semanticRef) : false;
    })) continue;
    const capability = memberships.map((membership) => membership.provenance.editCapability)
      .find((item): item is Extract<SemanticEditCapability, { command: "set-sequence" }> => item?.command === "set-sequence");
    const rule = activeCatalog.value?.rules.find((item) => item.ruleId === sequence.provenance?.rule?.ruleId);
    const operator = rule?.project;
    const sequenceTypeIri = capability?.sequenceTypeIri
      ?? (rule?.match.kind === "type" ? rule.match.iri : "");
    const ordinalPredicatePrefix = capability?.ordinalPredicatePrefix
      ?? (operator?.operator === "ordinal-sequence" ? operator.ordinalPredicatePrefix : "");
    if (!sequenceTypeIri || !ordinalPredicatePrefix) continue;
    const members = memberships.flatMap((membership) => {
      const member = geometryElement(membership.memberElementId);
      return member ? [{ iri: member.semanticRef, label: member.label }] : [];
    });
    result.push({
      sequenceIri: sequence.semanticRef,
      label: sequence.label,
      sequenceTypeIri,
      ordinalPredicatePrefix,
      memberIris: members.map((member) => member.iri),
      members,
    });
  }
  return result;
});
const intentAlternativeOptions = computed<IntentAlternativeOption[]>(() => {
  const selectedIris = new Set(selectedAuthoringResources.value.map((resource) => resource.iri));
  const selectedAlternativeIri = selectedEdge.value?.provenance?.editCapability?.command === "set-alternatives"
    ? selectedEdge.value.provenance.editCapability.alternative
    : undefined;
  const capabilities = new Map<string, Extract<SemanticEditCapability, { command: "set-alternatives" }>>();
  for (const edge of scene.value.edges) {
    const capability = edge.provenance?.editCapability;
    if (capability?.command === "set-alternatives") capabilities.set(capability.alternative, capability);
  }
  for (const membership of scene.value.memberships ?? []) {
    const capability = membership.provenance.editCapability;
    if (capability?.command === "set-alternatives") capabilities.set(capability.alternative, capability);
  }
  const resources = new Map(authoringResourceChoices.value.map((resource) => [resource.iri, resource]));
  return [...capabilities.values()].flatMap((capability): IntentAlternativeOption[] => {
    const seed = seedAuthoringCommandFromProvenance(
      draft.value,
      capability,
      `intent-alternative-${capability.alternative}`,
    );
    const command = seed.command;
    if (command?.type !== "set-alternatives") return [];
    if (
      selectedAlternativeIri !== command.alternativeIri
      && !selectedIris.has(command.alternativeIri)
      && !command.memberIris.some((iri) => selectedIris.has(iri))
    ) return [];
    const members = command.memberIris.map((iri) => ({
      iri,
      label: resources.get(iri)?.label ?? "名前のない要素",
    }));
    return [{
      alternativeIri: command.alternativeIri,
      label: resources.get(command.alternativeIri)?.label ?? "名前のない分岐グループ",
      alternativeTypeIri: command.alternativeTypeIri,
      ordinalPredicatePrefix: command.ordinalPredicatePrefix,
      defaultMemberIri: command.defaultMemberIri,
      defaultOrdinal: command.defaultOrdinal,
      memberIris: [...command.memberIris],
      members,
    }];
  });
});
const authoringResourcePickerLabel = computed(() => {
  const target = authoringResourcePicker.value;
  if (!target) return "要素";
  if (target.field === "propertyValue") return `属性の値 ${target.index + 1}`;
  return {
    subjectIri: "属性を編集する要素",
    sourceIri: "関係の始点",
    targetIri: "関係の終点",
    containerIri: "領域",
    memberIri: "含まれる要素",
    structureIri: "並び順の対象",
    resourceIri: "削除する要素",
    createEdgeResourceIri: "関係の相手",
    createMembershipContainerIri: "含める領域",
  }[target.field];
});

function capabilityResourceIris(capability: SemanticEditCapability): string[] {
  switch (capability.command) {
    case "remove-statement":
      return [capability.subject, capability.object];
    case "set-membership":
      return [capability.container, capability.member];
    case "set-sequence":
      return [capability.sequence];
    case "set-alternatives":
      return [capability.alternative];
  }
}

const authoringStructureChoices = computed<AuthoringStructureChoice[]>(() => {
  const context = authoringContext.value;
  const view = activeView.value;
  const resolved = view ? context?.runtime.catalogsByProfile.get(view.profileRef) : undefined;
  if (!resolved) return [];
  const choices = resolved.catalog.rules.flatMap((rule): AuthoringStructureChoice[] => {
    const match = rule.match;
    if (match.kind !== "type") return [];
    const operator = rule.project;
    const matchIri = match.iri;
    const typeLabel = context?.terms.find((term) => term.iri === matchIri)?.label;
    if (operator.operator === "membership-container") {
      return [{
        key: structureKey("membership", matchIri, operator.membershipPredicate),
        kind: "membership",
        label: typeLabel ? `${typeLabel}の領域に含める` : "定義済みの包含",
        ruleId: rule.ruleId,
        typeIri: matchIri,
        predicateIri: operator.membershipPredicate,
      }];
    }
    if (operator.operator === "ordinal-sequence") {
      return [{
        key: structureKey("sequence", matchIri, operator.ordinalPredicatePrefix),
        kind: "sequence",
        label: typeLabel ? `${typeLabel}の並び順` : "定義済みの並び順",
        ruleId: rule.ruleId,
        typeIri: matchIri,
        ordinalPredicatePrefix: operator.ordinalPredicatePrefix,
      }];
    }
    if (operator.operator === "alternative") {
      return [{
        key: structureKey(
          "alternatives",
          matchIri,
          operator.ordinalPredicatePrefix,
          operator.defaultOrdinal,
        ),
        kind: "alternatives",
        label: typeLabel
          ? `${typeLabel}の分岐（既定 ${operator.defaultOrdinal}番）`
          : `定義済みの分岐（既定 ${operator.defaultOrdinal}番）`,
        ruleId: rule.ruleId,
        typeIri: matchIri,
        ordinalPredicatePrefix: operator.ordinalPredicatePrefix,
        defaultOrdinal: operator.defaultOrdinal,
      }];
    }
    return [];
  });
  const current = currentDraftStructureChoice(authoringDraft.value);
  if (current && !choices.some((choice) => choice.key === current.key)) choices.push(current);
  return choices;
});

function currentDraftStructureChoice(draft: EditorAuthoringDraft): AuthoringStructureChoice | undefined {
  if (draft.kind === "set-membership" && draft.containerTypeIri && draft.membershipPredicateIri) {
    return {
      key: structureKey("membership", draft.containerTypeIri, draft.membershipPredicateIri),
      kind: "membership",
      label: "現在の包含方法",
      typeIri: draft.containerTypeIri,
      predicateIri: draft.membershipPredicateIri,
    };
  }
  if (draft.kind === "set-sequence" && draft.sequenceTypeIri && draft.ordinalPredicatePrefix) {
    return {
      key: structureKey("sequence", draft.sequenceTypeIri, draft.ordinalPredicatePrefix),
      kind: "sequence",
      label: "現在の並び方",
      typeIri: draft.sequenceTypeIri,
      ordinalPredicatePrefix: draft.ordinalPredicatePrefix,
    };
  }
  if (
    draft.kind === "set-alternatives"
    && draft.alternativeTypeIri
    && draft.ordinalPredicatePrefix
    && Number.isSafeInteger(Number(draft.defaultOrdinal))
  ) {
    return {
      key: structureKey(
        "alternatives",
        draft.alternativeTypeIri,
        draft.ordinalPredicatePrefix,
        Number(draft.defaultOrdinal),
      ),
      kind: "alternatives",
      label: "現在の分岐方法",
      typeIri: draft.alternativeTypeIri,
      ordinalPredicatePrefix: draft.ordinalPredicatePrefix,
      defaultOrdinal: Number(draft.defaultOrdinal),
    };
  }
  return undefined;
}

function authoringPreviewResourceChips(
  value: EditorAuthoringDraft,
): AuthoringPreviewView["resourceChips"] {
  const chips: AuthoringPreviewView["resourceChips"] = [];
  const add = (iri: string, role: string, fallback?: string) => {
    if (!iri && !fallback) return;
    const choice = authoringResourceChoices.value.find((item) => item.iri === iri);
    chips.push({ iri: iri || "urn:iriograph:pending-resource", label: choice?.label || fallback || "名前のない要素", role });
  };
  switch (value.kind) {
    case "create-resource":
      add(value.resourceIri, "新しい要素", value.label || "新しい要素");
      if (value.createEdgeEnabled) add(value.createEdgeResourceIri, "相手");
      if (value.createMembershipEnabled) add(value.createMembershipContainerIri, "領域");
      break;
    case "set-property":
      add(value.subjectIri, "対象");
      for (const item of value.propertyValues) if (item.objectKind === "iri") add(item.value, "値");
      break;
    case "connect-resources":
      add(value.sourceIri, "始点");
      add(value.targetIri, "終点");
      for (const targetIri of value.targetIris) add(targetIri, "終点");
      break;
    case "set-membership":
      add(value.containerIri, "領域");
      add(value.memberIri, "含まれる要素");
      break;
    case "set-sequence":
    case "set-alternatives":
      add(value.structureIri, "対象");
      for (const member of value.membersText.split(/\r?\n/u).map((item) => item.trim()).filter(Boolean)) add(member, "含まれる要素");
      break;
    case "delete-resource":
      add(value.resourceIri, "削除対象");
      break;
    case "remove-statement":
      add(value.statementSubject, "始点");
      add(value.statementObject, "終点");
      break;
    case "apply-capability":
      for (const [name, binding] of Object.entries(value.capabilityBindings)) {
        if (binding.enabled && binding.objectKind === "iri") add(binding.value, `入力: ${name}`);
      }
      break;
  }
  return chips.filter((chip, index) => chips.findIndex((candidate) => (
    candidate.iri === chip.iri && candidate.role === chip.role
  )) === index);
}

const authoringDeletionPreview = computed(() => {
  const preview = pendingDeletion.value?.preview;
  if (!preview) return undefined;
  const resourceSemanticRefs = preview.commands.flatMap((command) => (
    command.type === "delete-resource" ? [command.resourceIri] : []
  ));
  const statementRefs = preview.patch.removed.map((change) => change.statementRef);
  if (resourceSemanticRefs.length === 0 && statementRefs.length === 0) return undefined;
  return { resourceSemanticRefs, statementRefs };
});
const authoringDraftPosition = computed<Point | undefined>(() => {
  if (authoringDraft.value.kind !== "create-resource") return undefined;
  const x = Number(authoringDraft.value.initialX);
  const y = Number(authoringDraft.value.initialY);
  return authoringDraft.value.initialX !== ""
    && authoringDraft.value.initialY !== ""
    && Number.isFinite(x)
    && Number.isFinite(y)
    ? { x, y }
    : undefined;
});
const authoringDraftElementSize = computed(() => {
  const context = authoringContext.value;
  const view = activeView.value;
  const resolved = view ? context?.runtime.catalogsByProfile.get(view.profileRef) : undefined;
  const catalog = resolved?.catalog ?? activeCatalog.value;
  if (!catalog) return { width: 120, height: 60 };
  const requestedClass = authoringDraft.value.classIri.trim();
  const rule = catalog.rules.find((candidate) => (
    candidate.match.kind === "type"
    && candidate.match.iri === requestedClass
    && candidate.project.operator === "resource"
  ));
  const templateRef = rule?.templateRef ?? catalog.defaults?.nodeTemplateRef;
  return (templateRef ? catalog.templates[templateRef]?.defaultSize : undefined)
    ?? { width: 120, height: 60 };
});
const canUndo = computed(() => history.value.length > 0);
const canRedo = computed(() => future.value.length > 0);
const selectedGeometryCount = computed(() => selectedGeometryElements(
  scene.value,
  selectedElementIds.value,
).length);
const canAlignSelection = computed(() => !props.readOnly && selectedGeometryCount.value >= 2);
const canDistributeSelection = computed(() => !props.readOnly && selectedGeometryCount.value >= 3);
const semanticDocumentSummary = computed(() => {
  try {
    const graph = parseSemanticGraph(draft.value);
    const resources = new Set<string>();
    for (const quad of graph.quads) {
      if (quad.subject.termType === "NamedNode") resources.add(quad.subject.value);
      if (quad.object.termType === "NamedNode") resources.add(quad.object.value);
    }
    return {
      resources: resources.size,
      statements: graph.quads.length,
      views: draft.value.views.length,
      baseIri: draft.value.semantic.baseIri,
    };
  } catch {
    return { resources: 0, statements: 0, views: draft.value.views.length, baseIri: draft.value.semantic.baseIri };
  }
});
const heading = computed(() => props.title || props.filePath || draft.value.documentId || "Untitled");
const stateLabel = computed(() => {
  if (props.saving) return "保存中";
  if (props.saveMessage) return props.saveMessage;
  if (structuredAuthoringPending.value) return "意味を入力中";
  if (turtlePending.value) return "Turtleを入力中";
  if (overlayPending.value) return "View overlayを入力中";
  if (portableDocumentPending.value) return "Document全体を入力中";
  return props.dirty ? "未保存" : "保存済み";
});
const templateChoices = computed(() => Object.values(activeCatalog.value?.templates ?? {})
  .filter((template) => template.structuralKind === selectedElement.value?.structuralKind)
  .sort((left, right) => templateDisplayLabel(left).localeCompare(templateDisplayLabel(right), "ja")));
const assetOptions = computed<EditorAssetOption[]>(() => {
  const options = new Map<string, EditorAssetOption>();
  const packageRefs = new Set(packageDefaultIcons.map((icon) => icon.assetRef));
  for (const icon of packageDefaultIcons) options.set(icon.assetRef, {
    assetRef: icon.assetRef,
    label: icon.label,
    path: `@iriograph/core/icons/${icon.name}.svg`,
    mediaType: icon.mediaType,
  });
  let catalogAssetOrdinal = 0;
  for (const [assetRef, definition] of Object.entries(activeCatalog.value?.assets ?? {})) {
    if (packageRefs.has(assetRef)) continue;
    catalogAssetOrdinal += 1;
    options.set(assetRef, {
      assetRef,
      label: assetDefinitionLabel(definition.extensions) ?? `カタログアイコン ${catalogAssetOrdinal}`,
      mediaType: definition.mediaType,
    });
  }
  for (const option of props.assetOptions) {
    if (!packageRefs.has(option.assetRef)) options.set(option.assetRef, { ...options.get(option.assetRef), ...option });
  }
  return [...options.values()].sort((left, right) => (
    (left.label ?? left.path ?? left.assetRef).localeCompare(right.label ?? right.path ?? right.assetRef, "ja")
  ));
});
const selectedIconOption = computed(() => {
  const element = selectedElement.value;
  if (!element || element.structuralKind === "edge" || !element.iconRef) return undefined;
  return assetOptions.value.find((candidate) => candidate.assetRef === element.iconRef);
});
const iconInputValue = computed(() => {
  const element = selectedElement.value;
  if (!element || element.structuralKind === "edge" || !element.iconRef) return "";
  if (element.structuralKind !== "node" && !element.groupFrame) return "";
  const remembered = lastIconSelection.value;
  return selectedIconOption.value?.path
    ?? (remembered?.elementId === element.elementId && remembered.assetRef === element.iconRef
      ? remembered.path ?? ""
      : "");
});
const workspaceLocatorRequest = computed(() => ({
  documentPath: props.filePath,
  input: iconPathDraft.value,
}));
const workspaceAssetSuggestions = computed(() => (
  props.workspaceLocator?.suggest(workspaceLocatorRequest.value) ?? []
));
const workspaceAssetBreadcrumbs = computed(() => (
  props.workspaceLocator?.breadcrumbs(workspaceLocatorRequest.value) ?? []
));
const selectedIconLabel = computed(() => {
  const element = selectedElement.value;
  if (!element || element.structuralKind === "edge" || !element.iconRef) return "アイコンなし";
  const remembered = lastIconSelection.value;
  return selectedIconOption.value?.label
    ?? (remembered?.elementId === element.elementId && remembered.assetRef === element.iconRef
      ? remembered.label
      : undefined)
    ?? "カタログで設定されたアイコン";
});
const selectedIconPresentation = computed(() => {
  const element = selectedElement.value;
  const remembered = lastIconSelection.value;
  if (remembered?.elementId === selectedElementId.value && (
    iconAssetSelectionBusy.value || element?.structuralKind !== "edge" && element?.iconRef === remembered.assetRef
  )) return remembered;
  if (!element || element.structuralKind === "edge" || !element.iconRef) return undefined;
  return {
    elementId: element.elementId,
    assetRef: element.iconRef,
    label: selectedIconOption.value?.label ?? "選択中の画像",
    path: selectedIconOption.value?.path,
  };
});
const selectedIconPreviewUrl = computed(() => {
  const element = selectedElement.value;
  const presentation = selectedIconPresentation.value;
  return element && element.structuralKind !== "edge" && element.iconRef === presentation?.assetRef
    ? element.iconUrl
    : undefined;
});
const selectedIconMetrics = computed(() => {
  const element = selectedElement.value;
  return element?.structuralKind === "node"
    ? resolveIconContentMetrics(element.iconIntrinsicSize, {
        scale: element.nodeIconScale,
        size: element.nodeIconSize,
        fit: element.nodeIconFit,
      })
    : undefined;
});
const selectedIconSizingMode = computed<"scale" | "size">(() => (
  selectedElement.value?.structuralKind === "node" && selectedElement.value.nodeIconSize
    ? "size"
    : "scale"
));
const selectedIconFrameWarning = computed(() => {
  const element = selectedElement.value;
  const metrics = selectedIconMetrics.value;
  if (
    growNodeWithIcon.value
    || element?.structuralKind !== "node"
    || !metrics
    || metrics.width + 40 <= element.geometry.width && metrics.height + 32 <= element.geometry.height
  ) return "";
  return "現在のアイコンは要素の枠より大きいため、枠も広げるかサイズを小さくしてください。";
});
watch([selectedElementId, iconInputValue], () => {
  iconPathDraft.value = iconInputValue.value;
  iconPathIssue.value = "";
}, { immediate: true });
watch(selectedElementId, () => {
  iconSelectionFeedback.value = "";
  iconAssetSelectionBusy.value = false;
  iconAssetSelectionRequestToken += 1;
});
const appearancePresetStyles = computed(() => activeCatalog.value?.styles ?? {});
const appearancePrimaryElement = computed(() => {
  const ids = new Set(appearanceTargetIds.value);
  return [
    ...scene.value.nodes,
    ...scene.value.containers,
    ...(scene.value.regions ?? []),
    ...scene.value.edges,
  ].find((element) => ids.has(element.elementId));
});
const appearancePrimaryOverlay = computed(() => {
  const element = appearancePrimaryElement.value;
  return element ? activeView.value?.overlay[element.elementId]?.appearance : undefined;
});
const temporaryHiddenCount = computed(() => {
  viewSessionRevision.value;
  return sessionFor(activeView.value?.viewId ?? "").temporaryHiddenElementIds.size;
});
const selectedElementDiagnostics = computed(() => {
  const element = selectedElement.value;
  return element ? diagnostics.value.filter((diagnostic) => diagnosticTargetsElement(diagnostic, element)) : [];
});
const selectedContainmentWarnings = computed(() => containmentWarnings.value.filter((warning) => (
  warning.elementId === selectedElementId.value
)));
watch(
  () => props.modelValue,
  (value) => {
    cancelAssetPicker();
    cancelAuthoringPicking();
    const nextJson = JSON.stringify(value);
    if (nextJson === lastEmittedJson) {
      lastEmittedJson = "";
      return;
    }
    if (nextJson === JSON.stringify(draft.value)) return;
    cancelSemanticRequest();
    cancelPortableDocumentRequest();
    cancelDocumentIdentityRequest();
    typeHighlightElementIds.value = [];
    saveActiveViewSession();
    const previous = clone(draft.value);
    draft.value = clone(value);
    const nextViewId = resolveActiveViewId(
      draft.value,
      props.activeViewId ?? currentActiveViewId.value,
    );
    if (nextViewId !== currentActiveViewId.value) {
      currentActiveViewId.value = nextViewId;
      restoreActiveViewSession();
      rawScene.value = emptyScene(nextViewId);
    }
    turtleDraft.value = value.semantic.source;
    overlayDrafts.value = {};
    overlayDraftBases.value = {};
    overlayDraftTouched.value = {};
    overlayEditorIssues.value = [];
    portableDocumentDraft.value = JSON.stringify(value, null, 2);
    portableDocumentDraftBase.value = JSON.stringify(value);
    portableDocumentDraftTouched.value = false;
    portableDocumentEditorIssues.value = [];
    documentRebasePreview.value = undefined;
    documentRebaseIssues.value = [];
    localDocumentRevision += 1;
    history.value = [];
    future.value = [];
    applyDiagnostics.value = [];
    invalidateAuthoringPreview();
    if (documentRefreshKind(previous, draft.value) === "presentation") {
      void refreshPresentationScene();
    } else {
      void refreshScene();
    }
  },
  { deep: true },
);

watch(
  () => JSON.stringify(draft.value),
  (serialized) => {
    if (portableDocumentDraftTouched.value) return;
    portableDocumentDraft.value = JSON.stringify(JSON.parse(serialized) as unknown, null, 2);
    portableDocumentDraftBase.value = serialized;
    portableDocumentEditorIssues.value = [];
  },
  { immediate: true },
);

watch(
  () => ({
    viewId: activeView.value?.viewId ?? "",
    overlay: JSON.stringify(activeView.value?.overlay ?? {}),
  }),
  ({ viewId, overlay }) => {
    if (!viewId || overlayDraftTouched.value[viewId]) return;
    const formatted = JSON.stringify(JSON.parse(overlay) as unknown, null, 2);
    overlayDrafts.value = { ...overlayDrafts.value, [viewId]: formatted };
    overlayDraftBases.value = { ...overlayDraftBases.value, [viewId]: overlay };
  },
  { immediate: true },
);

watch(
  [
    () => props.runtimeContext,
    () => props.catalog,
    () => props.layoutRegistry,
    () => props.assetAccess?.resolver,
    () => props.assetAccess?.policy,
    () => props.assetAccess?.revision,
  ],
  () => {
    cancelSemanticRequest();
    applyDiagnostics.value = [];
    void refreshScene();
  },
  { deep: true },
);

watch(
  () => props.activeViewId,
  (viewId) => {
    if (viewId === undefined) return;
    void activateView(resolveActiveViewId(draft.value, viewId));
  },
);

watch(
  () => props.readOnly,
  (value) => {
    if (!value) return;
    cancelSemanticRequest();
    cancelAuthoringRequest();
    cancelPortableDocumentRequest();
    cancelDocumentIdentityRequest();
    cancelAssetPicker();
    if (authoringDraft.value.positionPicking) {
      authoringDraft.value = { ...authoringDraft.value, positionPicking: false };
    }
    authoringResourcePicker.value = undefined;
  },
);

watch(
  [
    () => props.authoringContext,
    () => props.resourceIriAllocator,
  ],
  () => {
    cancelSemanticRequest();
    invalidateAuthoringPreview();
  },
  { deep: true },
);

watch(
  [
    () => (props.semanticValidationContext ?? props.authoringContext?.semanticValidation)?.contextId,
    () => (props.semanticValidationContext ?? props.authoringContext?.semanticValidation)?.contextRevision,
    () => toRaw(
      (props.semanticValidationContext ?? props.authoringContext?.semanticValidation)?.validator,
    ),
  ],
  () => {
    cancelSemanticRequest();
    applyDiagnostics.value = [];
    semanticWarningConfirmation.value = undefined;
    invalidateAuthoringPreview();
    void refreshScene();
  },
);

watch(
  turtleDraft,
  () => {
    semanticWarningConfirmation.value = undefined;
  },
);

watch(
  () => props.snapSettings,
  (value) => {
    snapSettings.value = normalizeDiagramSnapSettings(value);
  },
  { deep: true },
);

watch(
  diagnostics,
  (value) => emit("validationChanged", clone(value)),
  { immediate: true },
);

watch(
  () => turtlePending.value || structuredAuthoringPending.value || overlayPending.value || portableDocumentPending.value,
  (pending) => emit("pendingDraftsChanged", pending),
  { immediate: true },
);
watch(structuredAuthoringPending, (pending) => {
  if (!pending) pendingAuthoringGuidance.value = "";
});

void refreshScene();

onBeforeUnmount(() => {
  cancelAssetPicker();
  cancelSemanticRequest();
  cancelAuthoringRequest();
  cancelPortableDocumentRequest();
  cancelDocumentIdentityRequest();
  cancelViewCommandRequest();
  sceneValidationAbortController?.abort();
  assetSceneSession.dispose();
});

async function refreshScene(): Promise<void> {
  const requestToken = ++sceneRequestToken;
  sceneValidationAbortController?.abort();
  const validationController = new AbortController();
  sceneValidationAbortController = validationController;
  const assetRequest = assetSceneSession.begin();
  const document = clone(draft.value);
  const runtime = projectionRuntimeContext.value;
  const catalog = activeCatalog.value;
  const assetAccess = withPackageDefaultIconAccess(props.assetAccess);
  const validationContext = semanticValidationContext.value;
  const viewId = resolveActiveViewId(document, currentActiveViewId.value);
  sceneLoading.value = true;
  schemaDiagnostics.value = schemaDiagnosticsFor(document, runtime);

  if (!runtime || !catalog || schemaDiagnostics.value.some((item) => item.severity === "error")) {
    if (runtime && !catalog) {
      schemaDiagnostics.value = [...schemaDiagnostics.value, {
        severity: "error",
        category: "profile",
        code: "profile-catalog-unresolved",
        message: `profileの解決済みcatalogがありません: ${activeView.value?.profileRef ?? "<none>"}`,
      }];
    }
    if (requestToken !== sceneRequestToken) return;
    const committed = assetSceneSession.commitWithoutAssets(
      assetRequest,
      emptyScene(viewId, schemaDiagnostics.value),
    );
    if (!committed.accepted) return;
    rawScene.value = committed.scene;
    sceneLoading.value = false;
    clearMissingSelection(scene.value);
    await fitInitialSceneIfNeeded(document.documentId, viewId);
    return;
  }

  try {
    const baselineDocument = documentWithoutExplicitGroupFrameGeometry(
      document,
      viewId,
      runtime,
    );
    const [projected, generatedBaselineScene, semanticValidation] = await Promise.all([
      buildIriographView(document, viewId, runtime, "incremental"),
      baselineDocument
        ? buildIriographView(baselineDocument, viewId, runtime, "incremental")
        : Promise.resolve(undefined),
      validationContext
        ? validateSemanticDocument(document, validationContext, {
            signal: validationController.signal,
          })
        : Promise.resolve({ diagnostics: [] }),
    ]);
    if (requestToken !== sceneRequestToken) return;
    const result = await assetSceneSession.enrich(
      assetRequest,
      projected,
      availableAssetDefinitions(catalog),
      assetAccess,
    );
    if (requestToken !== sceneRequestToken || !result.accepted) return;
    rawScene.value = {
      ...result.scene,
      diagnostics: [...result.scene.diagnostics, ...semanticValidation.diagnostics]
        .filter(uniqueDiagnostic()),
    };
    rememberGeneratedGeometryBaselines(
      document.documentId,
      viewId,
      generatedBaselineScene ?? rawScene.value,
    );
  } catch (cause) {
    if (requestToken !== sceneRequestToken) return;
    const committed = assetSceneSession.commitWithoutAssets(assetRequest, emptyScene(viewId, [{
      severity: "error",
      code: "scene-build-failed",
      message: cause instanceof Error ? cause.message : String(cause),
    }]));
    if (!committed.accepted) return;
    rawScene.value = committed.scene;
  } finally {
    if (requestToken === sceneRequestToken) {
      if (sceneValidationAbortController === validationController) {
        sceneValidationAbortController = undefined;
      }
      sceneLoading.value = false;
      clearMissingSelection(scene.value);
      await fitInitialSceneIfNeeded(document.documentId, viewId);
    }
  }
}

async function fitInitialSceneIfNeeded(documentId: string, viewId: string): Promise<void> {
  if (!props.fitOnInitialLoad) return;
  const key = `${documentId}\u0000${viewId}`;
  if (initiallyFittedSceneKeys.has(key)) return;
  if (scene.value.nodes.length + scene.value.containers.length + (scene.value.regions?.length ?? 0) === 0) return;
  await nextTick();
  const canvas = diagramCanvas.value;
  if (!canvas) return;
  initiallyFittedSceneKeys.add(key);
  await canvas.fitToView();
}

async function refreshPresentationScene(): Promise<void> {
  const requestToken = ++sceneRequestToken;
  sceneValidationAbortController?.abort();
  sceneValidationAbortController = undefined;
  const assetRequest = assetSceneSession.begin();
  const document = clone(draft.value);
  const runtime = projectionRuntimeContext.value;
  const viewId = resolveActiveViewId(document, currentActiveViewId.value);
  const view = document.views.find((candidate) => candidate.viewId === viewId);
  const profile = view ? runtime?.catalogsByProfile.get(view.profileRef) : undefined;
  if (!view || !runtime || !profile || rawScene.value.viewId !== viewId) {
    await refreshScene();
    return;
  }
  try {
    const projected = projectSemanticView(
      document,
      profile.catalog,
      viewId,
      runtime.projectionOptions,
    );
    if (requestToken !== sceneRequestToken) return;
    const reconciled = reconcilePresentationScene(
      sceneWithGeneratedGeometryBaselines(rawScene.value, document.documentId, viewId, view.overlay),
      projected,
    );
    const reconciliationBaseline = clone(reconciled);
    const result = await assetSceneSession.enrich(
      assetRequest,
      reconciled,
      availableAssetDefinitions(profile.catalog),
      withPackageDefaultIconAccess(props.assetAccess),
    );
    if (requestToken !== sceneRequestToken || !result.accepted) return;
    retainIncrementalReconciliationScene(document, viewId, runtime, reconciliationBaseline);
    rawScene.value = result.scene;
    clearMissingSelection(scene.value);
  } catch (cause) {
    if (requestToken !== sceneRequestToken) return;
    applyDiagnostics.value = [{
      severity: "error",
      category: "internal",
      code: "presentation-reconciliation-failed",
      message: cause instanceof Error ? cause.message : String(cause),
    }];
  }
}

async function refreshPreparedScene(prepared: DiagramScene): Promise<void> {
  const requestToken = ++sceneRequestToken;
  sceneValidationAbortController?.abort();
  sceneValidationAbortController = undefined;
  const assetRequest = assetSceneSession.begin();
  const catalog = activeCatalog.value;
  if (!catalog || prepared.viewId !== currentActiveViewId.value) {
    await refreshScene();
    return;
  }
  try {
    const runtime = projectionRuntimeContext.value;
    const baselineDocument = runtime
      ? documentWithoutExplicitGroupFrameGeometry(draft.value, prepared.viewId, runtime)
      : undefined;
    const [result, generatedBaselineScene] = await Promise.all([
      assetSceneSession.enrich(
        assetRequest,
        clone(prepared),
        availableAssetDefinitions(catalog),
        withPackageDefaultIconAccess(props.assetAccess),
      ),
      baselineDocument && runtime
        ? buildIriographView(baselineDocument, prepared.viewId, runtime, "incremental")
        : Promise.resolve(undefined),
    ]);
    if (requestToken !== sceneRequestToken || !result.accepted) return;
    rawScene.value = result.scene;
    rememberGeneratedGeometryBaselines(
      draft.value.documentId,
      prepared.viewId,
      generatedBaselineScene ?? rawScene.value,
    );
    clearMissingSelection(scene.value);
  } catch (cause) {
    if (requestToken !== sceneRequestToken) return;
    applyDiagnostics.value = [{
      severity: "error",
      category: "internal",
      code: "prepared-scene-enrichment-failed",
      message: cause instanceof Error ? cause.message : String(cause),
    }];
  }
}

function preparedSceneFor(result: SemanticSourceUpdate): DiagramScene | undefined {
  const prepared = result.scenes?.[currentActiveViewId.value];
  if (!prepared) return undefined;
  return {
    ...clone(prepared),
    // `result.diagnostics` aggregates every named view. The prepared Scene
    // already owns the active view's layout diagnostics, so only merge
    // cross-view semantic/projection diagnostics here.
    diagnostics: [
      ...prepared.diagnostics,
      ...result.diagnostics.filter((diagnostic) => diagnostic.category !== "layout"),
    ].filter(uniqueDiagnostic()),
  };
}

function projectionContextFromLegacyCatalog(catalog: ProjectionCatalogV1): ProjectionRuntimeContext {
  const catalogRef = `${catalog.catalogId}@${catalog.catalogVersion}`;
  return createProjectionRuntimeContext([{
    profileRef: catalog.profileRef,
    sourceCatalogRefs: [catalogRef],
    catalog,
    ruleOrigins: [],
  }], props.layoutRegistry ?? defaultLayoutRegistry);
}

function unwrapProjectionRuntimeContext(source: ProjectionRuntimeContext): ProjectionRuntimeContext {
  const runtime = toRaw(source);
  return {
    ...runtime,
    catalogsByProfile: toRaw(runtime.catalogsByProfile),
    layouts: toRaw(runtime.layouts),
    projectionOptions: runtime.projectionOptions ? toRaw(runtime.projectionOptions) : undefined,
  };
}

function resolveActiveViewId(document: IriographDocument, requested?: string): string {
  if (requested && document.views.some((view) => view.viewId === requested)) return requested;
  return document.views[0]?.viewId ?? "";
}

function sessionFor(viewId: string): DiagramViewSession {
  const existing = viewSessions.get(viewId);
  if (existing) return existing;
  const created = createDiagramViewSession();
  viewSessions.set(viewId, created);
  return created;
}

function saveActiveViewSession(): void {
  const viewId = currentActiveViewId.value;
  if (!viewId) return;
  const session = sessionFor(viewId);
  session.selectedElementIds = [...selectedElementIds.value];
  session.primaryElementId = selectedElementId.value;
  session.viewport = diagramCanvas.value?.getViewportState() ?? {
    ...session.viewport,
    zoom: zoom.value,
  };
}

function restoreActiveViewSession(): void {
  const session = sessionFor(currentActiveViewId.value);
  selectedElementIds.value = [...session.selectedElementIds];
  selectedElementId.value = session.primaryElementId;
  zoom.value = normalizeDiagramZoom(session.viewport.zoom);
  canvasDragMode.value = session.dragMode;
  emit("selectionChanged", selectedElementId.value);
  emit("selectionSetChanged", [...selectedElementIds.value]);
}

async function activateView(viewId: string): Promise<void> {
  const nextViewId = resolveActiveViewId(draft.value, viewId);
  if (!nextViewId || nextViewId === currentActiveViewId.value) return;
  saveActiveViewSession();
  cancelAssetPicker();
  cancelSemanticRequest();
  cancelViewCommandRequest();
  typeHighlightElementIds.value = [];
  invalidateAuthoringPreview();
  sceneValidationAbortController?.abort();
  currentActiveViewId.value = nextViewId;
  rawScene.value = emptyScene(nextViewId);
  applyDiagnostics.value = [];
  restoreActiveViewSession();
  await refreshScene();
  if (currentActiveViewId.value !== nextViewId) return;
  await nextTick();
  await diagramCanvas.value?.restoreViewport(sessionFor(nextViewId).viewport);
}

function requestActiveView(event: Event): void {
  const select = event.target as HTMLSelectElement;
  const requested = select.value;
  if (!draft.value.views.some((view) => view.viewId === requested)) return;
  emit("update:activeViewId", requested);
  if (props.activeViewId === undefined) {
    void activateView(requested);
    return;
  }
  select.value = currentActiveViewId.value;
}

function schemaDiagnosticsFor(
  document: IriographDocument,
  runtime: ProjectionRuntimeContext | undefined,
): ProjectionDiagnostic[] {
  const documentResult = validateIriographDocumentV1(document);
  const catalogResults = runtime
    ? [...new Set([...runtime.catalogsByProfile.values()].map((entry) => entry.catalog))]
      .map((catalog) => validateProjectionCatalogV1(catalog))
    : [];
  return [
    ...(documentResult.valid ? [] : documentResult.issues.map((issue) => schemaDiagnostic("document", issue))),
    ...(runtime ? [] : [{
      severity: "error" as const,
      category: "profile" as const,
      code: "projection-runtime-context-missing",
      message: "ProjectionRuntimeContextが提供されていません。",
    }]),
    ...catalogResults.flatMap((result) => (
      result.valid ? [] : result.issues.map((issue) => schemaDiagnostic("catalog", issue))
    )),
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
  const available = normalizeSceneSelection(nextScene, selectedElementIds.value);
  if (
    available.length !== selectedElementIds.value.length
    || available.some((elementId, index) => elementId !== selectedElementIds.value[index])
  ) setSelection(available);
}

function selectElement(elementId: string): void {
  setSelection(elementId ? [elementId] : []);
}

function selectElements(elementIds: readonly string[]): void {
  setSelection(normalizeSceneSelection(scene.value, elementIds));
}

function clearSelection(): void {
  setSelection([]);
}

function selectAll(): void {
  setSelection(sceneElementIds(scene.value));
}

function applySelectionRequest(request: DiagramSelectionRequest): void {
  if (!request.elementId) {
    if (request.mode === "replace") clearSelection();
    return;
  }
  if (request.mode === "replace") {
    setSelection([request.elementId]);
    return;
  }
  const current = selectedElementIds.value.filter((elementId) => elementId !== request.elementId);
  if (request.mode === "toggle" && selectedElementIdsSet.value.has(request.elementId)) {
    setSelection(current);
    return;
  }
  setSelection([...current, request.elementId]);
}

function setSelection(elementIds: readonly string[]): void {
  const next = normalizeSceneSelection(scene.value, elementIds);
  const primary = next.at(-1) ?? "";
  if (primary !== selectedElementId.value) {
    cancelAssetPicker();
    if (appearanceEditorOpen.value) closeAppearanceEditor();
  }
  if (
    primary === selectedElementId.value
    && next.length === selectedElementIds.value.length
    && next.every((elementId, index) => elementId === selectedElementIds.value[index])
  ) return;
  selectedElementIds.value = next;
  selectedElementId.value = primary;
  const session = sessionFor(currentActiveViewId.value);
  session.selectedElementIds = [...next];
  session.primaryElementId = primary;
  emit("selectionChanged", primary);
  emit("selectionSetChanged", [...next]);
}

function displayInspectorSectionDomId(action: DisplayInspectorAction): string {
  return `${displayInspectorSectionIdPrefix}-${action}`;
}

function isDisplayInspectorSectionOpen(action: DisplayInspectorAction): boolean {
  return openDisplayInspectorSections.value.includes(action);
}

function openDisplayInspectorSection(action: DisplayInspectorAction, focus = false): void {
  if (!displayInspectorSections.value.includes(action)) return;
  displayInspectorAction.value = action;
  if (!openDisplayInspectorSections.value.includes(action)) {
    openDisplayInspectorSections.value = [...openDisplayInspectorSections.value, action];
  }
  if (!focus) return;
  void nextTick(() => {
    document.getElementById(displayInspectorSectionDomId(action))?.focus();
  });
}

function handleDisplayInspectorSectionToggle(action: DisplayInspectorAction, event: Event): void {
  const target = event.currentTarget;
  if (!(target instanceof HTMLDetailsElement)) return;
  const open = target.open;
  const sections = openDisplayInspectorSections.value;
  openDisplayInspectorSections.value = open
    ? sections.includes(action) ? sections : [...sections, action]
    : sections.filter((section) => section !== action);
  if (open) displayInspectorAction.value = action;
}

function selectAndReveal(elementId: string, event: MouseEvent): void {
  applySelectionRequest({
    elementId,
    mode: event.ctrlKey || event.metaKey ? "toggle" : event.shiftKey ? "add" : "replace",
  });
  if (selectedElementIdsSet.value.has(elementId)) {
    void diagramCanvas.value?.revealElement(elementId);
  }
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
  changeGeometryBatch([payload], false);
}

function changeGeometryBatch(changes: readonly GeometryChange[], recordHistory = false): void {
  if (changes.length === 0) return;
  const constrained = constrainMembershipRegionMovement(scene.value, changes);
  applyDiagnostics.value = applyDiagnostics.value.filter((diagnostic) => (
    diagnostic.code !== "membership-region-missing"
    && diagnostic.code !== "membership-region-intersection-empty"
  ));
  if (constrained.issue) {
    applyDiagnostics.value.push({
      severity: "warning",
      category: "layout",
      code: constrained.issue.code,
      message: constrained.issue.message,
      semanticRef: geometryElement(constrained.issue.elementId)?.semanticRef,
    });
  }
  if (constrained.changes.length === 0) return;
  mutateDocument((document) => {
    const view = document.views.find((candidate) => candidate.viewId === currentActiveViewId.value);
    if (!view) return;
    for (const change of constrained.changes) {
      const element = geometryElement(change.elementId);
      if (!element) continue;
      const current = view.overlay[change.elementId];
      view.overlay[change.elementId] = {
        ...(current ?? { semanticRef: element.semanticRef }),
        geometry: roundGeometry(change.geometry),
        pinned: true,
        placement: "user",
      };
    }
  }, recordHistory);
}

function alignSelected(alignment: DiagramAlignment): void {
  if (!canAlignSelection.value) return;
  changeGeometryBatch(
    alignSelection(scene.value, selectedElementIds.value, alignment),
    true,
  );
}

function distributeSelected(direction: DiagramDistribution): void {
  if (!canDistributeSelection.value) return;
  changeGeometryBatch(
    distributeSelection(scene.value, selectedElementIds.value, direction),
    true,
  );
}

function setSnapSettings(value: DiagramSnapSettingsInput): void {
  snapSettings.value = normalizeDiagramSnapSettings({
    grid: { ...snapSettings.value.grid, ...value.grid },
    targets: { ...snapSettings.value.targets, ...value.targets },
  });
}

function updateSnapGridSize(event: Event): void {
  setSnapSettings({ grid: {
    ...snapSettings.value.grid,
    size: Number((event.target as HTMLInputElement).value),
  } });
}

function changeRouting(
  payload: EdgeRoutingUpdate,
  recordHistory = false,
  preserveRouteMode = true,
): void {
  mutateDocument((document) => {
    const edge = scene.value.edges.find((candidate) => candidate.elementId === payload.elementId);
    const view = document.views.find((candidate) => candidate.viewId === currentActiveViewId.value);
    if (!edge || !view) return;
    const current = view.overlay[payload.elementId] ?? { semanticRef: edge.semanticRef };
    const requestedRouting = payload.routing && !edge.label
      ? { ...payload.routing, labelOffset: undefined }
      : payload.routing;
    const effectiveRouteMode = current.routing?.routeMode ?? edge.routeMode;
    const waypointSafeRouting = requestedRouting
      && (effectiveRouteMode === "straight" || effectiveRouteMode === "curve")
      ? { ...requestedRouting, waypoints: undefined }
      : requestedRouting;
    const routingValue = normalizeEditableRouting(waypointSafeRouting);
    const routeMode: EdgeRouteMode | undefined = preserveRouteMode
      ? current.routing?.routeMode === "manual"
        ? routingValue?.waypoints?.length ? "manual" : undefined
        : current.routing?.routeMode
          // Catalog defaults normally stay derived. Curve controls are the
          // exception because the portable schema requires their routeMode.
          ?? (routingValue?.curve && effectiveRouteMode === "curve" ? "curve" : undefined)
      : undefined;
    const sourceMarker = preserveRouteMode
      ? routingValue?.sourceMarker ?? current.routing?.sourceMarker
      : routingValue?.sourceMarker;
    const targetMarker = preserveRouteMode
      ? routingValue?.targetMarker ?? current.routing?.targetMarker
      : routingValue?.targetMarker;
    const routing = routingValue || current.routing?.extensions || routeMode || sourceMarker || targetMarker
      ? {
          ...routingValue,
          ...(routeMode ? { routeMode } : {}),
          ...(sourceMarker ? { sourceMarker } : {}),
          ...(targetMarker ? { targetMarker } : {}),
          ...(current.routing?.extensions ? { extensions: clone(current.routing.extensions) } : {}),
        }
      : undefined;
    const entry: ViewElementOverlay = {
      semanticRef: edge.semanticRef,
      appearance: clone(current.appearance),
      routing: routing
        ? {
            ...routing,
            waypoints: routing.waypoints?.map(roundPoint),
            curve: routing.curve ? roundCurveRouting(routing.curve) : undefined,
            labelOffset: routing.labelOffset ? roundPoint(routing.labelOffset) : undefined,
          }
        : undefined,
      extensions: clone(current.extensions),
    };
    if (!entry.routing && !entry.appearance && !entry.extensions) {
      delete view.overlay[payload.elementId];
      return;
    }
    view.overlay[payload.elementId] = entry;
  }, recordHistory);
}

function changeNodeContentOffset(
  payload: { elementId: string; target: "label" | "icon"; offset?: Point },
  recordHistory = false,
): void {
  const node = scene.value.nodes.find((candidate) => candidate.elementId === payload.elementId);
  if (!node || props.readOnly) return;
  mutateDocument((document) => {
    const view = document.views.find((candidate) => candidate.viewId === currentActiveViewId.value);
    if (!view) return;
    const current = view.overlay[node.elementId] ?? { semanticRef: node.semanticRef };
    const appearance = { ...current.appearance };
    const field = payload.target === "label" ? "nodeLabelOffset" : "nodeIconOffset";
    const offset = payload.offset && Number.isFinite(payload.offset.x) && Number.isFinite(payload.offset.y)
      ? roundPoint(payload.offset)
      : undefined;
    if (offset && (offset.x !== 0 || offset.y !== 0)) appearance[field] = offset;
    else delete appearance[field];
    if (Object.keys(appearance).length) current.appearance = appearance;
    else delete current.appearance;
    if (!current.geometry && !current.pinned && !current.placement && !current.appearance && !current.routing && !current.extensions) {
      delete view.overlay[node.elementId];
    } else {
      view.overlay[node.elementId] = current;
    }
  }, recordHistory);
}

function resetSelectedNodeContentOffset(target: "label" | "icon"): void {
  const node = selectedElement.value;
  if (node?.structuralKind !== "node") return;
  changeNodeContentOffset({ elementId: node.elementId, target }, true);
}

function nodeLabelWritingDirectionFor(elementId: string): NodeLabelWritingDirection {
  return scene.value.nodes.find((node) => node.elementId === elementId)?.nodeLabelWritingDirection
    ?? "horizontal-right";
}

function updateSelectedNodeLabelWritingDirection(event: Event): void {
  const node = selectedElement.value;
  if (node?.structuralKind !== "node" || props.readOnly) return;
  const direction = (event.target as HTMLSelectElement).value as NodeLabelWritingDirection;
  mutateDocument((document) => {
    const view = document.views.find((candidate) => candidate.viewId === currentActiveViewId.value);
    if (!view) return;
    const current = view.overlay[node.elementId] ?? { semanticRef: node.semanticRef };
    const appearance = { ...current.appearance };
    if (direction === "vertical-down") appearance.nodeLabelWritingDirection = direction;
    else delete appearance.nodeLabelWritingDirection;
    if (Object.keys(appearance).length) current.appearance = appearance;
    else delete current.appearance;
    if (!current.geometry && !current.pinned && !current.placement && !current.appearance && !current.routing && !current.extensions) {
      delete view.overlay[node.elementId];
    } else {
      view.overlay[node.elementId] = current;
    }
  }, true);
}

function addSelectedWaypoint(): void {
  const edge = selectedEdge.value;
  if (!edge || !selectedWaypointEditingAvailable.value) return;
  changeRouting({
    elementId: edge.elementId,
    routing: {
      waypoints: appendEdgeWaypoint(edge),
      labelOffset: edge.labelOffset,
      sourceAnchor: edge.sourceAnchor,
      targetAnchor: edge.targetAnchor,
    },
  }, true);
}

function removeSelectedWaypointAt(index: number): void {
  const edge = selectedEdge.value;
  if (!edge || !selectedWaypointEditingAvailable.value) return;
  changeRouting({
    elementId: edge.elementId,
    routing: {
      waypoints: removeEdgeWaypoint(edge.waypoints, index),
      labelOffset: edge.labelOffset,
      sourceAnchor: edge.sourceAnchor,
      targetAnchor: edge.targetAnchor,
    },
  }, true);
}

function addSelectedCurveKnot(): void {
  const edge = selectedEdge.value;
  if (!edge || selectedRouteMode.value !== "curve") return;
  changeRouting({
    elementId: edge.elementId,
    routing: routingWithCurve(edge, appendEdgeCurveKnot(edge.route ?? [], edge.curve)),
  }, true);
}

function removeSelectedCurveKnotAt(index: number): void {
  const edge = selectedEdge.value;
  if (!edge || selectedRouteMode.value !== "curve") return;
  changeRouting({
    elementId: edge.elementId,
    routing: routingWithCurve(edge, removeEdgeCurveKnot(edge.curve, index)),
  }, true);
}

function resetSelectedCurveControls(): void {
  const edge = selectedEdge.value;
  if (!edge || selectedRouteMode.value !== "curve") return;
  changeRouting({
    elementId: edge.elementId,
    routing: routingWithCurve(edge, undefined),
  }, true);
}

function resetSelectedLabelOffset(): void {
  const edge = selectedEdge.value;
  if (!edge?.label) return;
  changeRouting({
    elementId: edge.elementId,
    routing: {
      waypoints: edge.waypoints,
      curve: edge.curve,
      sourceAnchor: edge.sourceAnchor,
      targetAnchor: edge.targetAnchor,
    },
  }, true);
}

function resetEndpointAnchor(endpoint: "source" | "target"): void {
  const edge = selectedEdge.value;
  if (!edge) return;
  changeRouting({
    elementId: edge.elementId,
    routing: routingWithEndpointAnchor(edge, endpoint, undefined),
  }, true);
}

function resetSelectedEndpointAnchors(): void {
  const edge = selectedEdge.value;
  if (!edge) return;
  changeRouting({
    elementId: edge.elementId,
    routing: {
      waypoints: edge.waypoints,
      curve: edge.curve,
      labelOffset: edge.labelOffset,
      sourceMarker: edge.sourceMarker,
      targetMarker: edge.targetMarker,
    },
  }, true);
}

function resetSelectedRouting(): void {
  const edge = selectedEdge.value;
  if (!edge) return;
  changeRouting({ elementId: edge.elementId }, true, false);
}

function routeModeFor(edge: SceneEdge): EdgeRouteMode {
  const value = activeView.value?.overlay[edge.elementId]?.routing?.routeMode ?? edge.routeMode;
  return isEdgeRouteMode(value) ? value : edge.waypoints?.length ? "manual" : "auto";
}

function isEdgeRouteMode(value: unknown): value is EdgeRouteMode {
  return typeof value === "string" && ["auto", "straight", "orthogonal", "curve", "manual"].includes(value);
}

function setSelectedRouteMode(mode: EdgeRouteMode): void {
  const edge = selectedEdge.value;
  if (!edge || props.readOnly) return;
  mutateDocument((document) => {
    const view = document.views.find((candidate) => candidate.viewId === currentActiveViewId.value);
    if (!view) return;
    const current = view.overlay[edge.elementId] ?? { semanticRef: edge.semanticRef };
    const routing = clone(current.routing) ?? {};
    routing.routeMode = mode;
    if (mode !== "manual") delete routing.waypoints;
    if (mode !== "curve") delete routing.curve;
    const hasRouting = Boolean(
      routing.routeMode
      || routing.waypoints?.length
      || routing.curve
      || routing.labelOffset
      || routing.sourceAnchor
      || routing.targetAnchor
      || routing.sourceMarker
      || routing.targetMarker
      || routing.extensions,
    );
    const entry: ViewElementOverlay = { ...current, semanticRef: edge.semanticRef };
    if (hasRouting) entry.routing = routing;
    else delete entry.routing;
    if (!entry.routing && !entry.appearance && !entry.geometry && !entry.extensions) delete view.overlay[edge.elementId];
    else view.overlay[edge.elementId] = entry;
  }, true);
}

function setSelectedTerminalMarker(
  endpoint: "source" | "target",
  marker: EdgeTerminalMarker,
): void {
  const edge = selectedEdge.value;
  if (!edge || props.readOnly) return;
  changeRouting({
    elementId: edge.elementId,
    routing: {
      waypoints: edge.waypoints,
      curve: edge.curve,
      labelOffset: edge.labelOffset,
      sourceAnchor: edge.sourceAnchor,
      targetAnchor: edge.targetAnchor,
      sourceMarker: endpoint === "source" ? marker : undefined,
      targetMarker: endpoint === "target" ? marker : undefined,
    },
  }, true);
}

function regionLabelPlacementFor(elementId: string): RegionLabelPlacement {
  const element = (scene.value.regions ?? []).find((candidate) => candidate.elementId === elementId);
  const value = activeView.value?.overlay[elementId]?.appearance?.labelPlacement ?? element?.labelPlacement;
  return typeof value === "string" && ["top", "right", "bottom", "left"].includes(value)
    ? value as RegionLabelPlacement
    : "top";
}

function defaultRegionLabelPlacement(element: SceneRegion): RegionLabelPlacement {
  const value = activeCatalog.value?.templates[element.templateRef]?.labelPlacement;
  return typeof value === "string" && ["top", "right", "bottom", "left"].includes(value)
    ? value as RegionLabelPlacement
    : "top";
}

function defaultRegionLabelWritingDirection(
  placement: RegionLabelPlacement,
): RegionLabelWritingDirection {
  return placement === "left" || placement === "right" ? "vertical-down" : "horizontal-right";
}

function regionLabelWritingDirectionFor(elementId: string): RegionLabelWritingDirection {
  const placement = regionLabelPlacementFor(elementId);
  const value = (scene.value.regions ?? []).find((candidate) => (
    candidate.elementId === elementId
  ))?.regionLabelWritingDirection;
  return value === "horizontal-right" || value === "vertical-down"
    ? value
    : defaultRegionLabelWritingDirection(placement);
}

function regionLabelAnchorFor(elementId: string): number {
  const region = (scene.value.regions ?? []).find((candidate) => candidate.elementId === elementId);
  const value = region?.regionLabelAnchor;
  if (typeof value === "number" && Number.isFinite(value)) return clamp(value, 0, .999999);
  if (!region) return .125;
  const perimeter = Math.max(1, 2 * (region.geometry.width + region.geometry.height));
  const placement = regionLabelPlacementFor(elementId);
  if (placement === "right") return (region.geometry.width + region.geometry.height / 2) / perimeter;
  if (placement === "bottom") return (region.geometry.width + region.geometry.height + region.geometry.width / 2) / perimeter;
  if (placement === "left") return (2 * region.geometry.width + region.geometry.height + region.geometry.height / 2) / perimeter;
  return (region.geometry.width / 2) / perimeter;
}

function regionZOrderFor(elementId: string, fallback: number): number {
  const value = (scene.value.regions ?? []).find((candidate) => (
    candidate.elementId === elementId
  ))?.regionZOrder;
  return typeof value === "number" && Number.isSafeInteger(value) ? value : fallback;
}

function updateRegionAppearance(
  element: SceneRegion,
  key: "regionLabelAnchor" | "regionLabelWritingDirection" | "regionZOrder",
  value: RegionLabelWritingDirection | number | undefined,
  recordHistory: boolean,
): void {
  mutateDocument((document) => {
    const view = document.views.find((candidate) => candidate.viewId === currentActiveViewId.value);
    if (!view) return;
    const current = view.overlay[element.elementId] ?? { semanticRef: element.semanticRef };
    const appearance = { ...current.appearance };
    if (value === undefined) delete appearance[key];
    else if (key === "regionLabelWritingDirection") appearance[key] = value as RegionLabelWritingDirection;
    else appearance[key] = value as number;
    if (Object.keys(appearance).length) current.appearance = appearance;
    else delete current.appearance;
    if (!current.geometry && !current.pinned && !current.placement && !current.appearance && !current.routing && !current.extensions) delete view.overlay[element.elementId];
    else view.overlay[element.elementId] = current;
  }, recordHistory);
}

function updateRegionLabelAnchor(payload: { elementId: string; anchor: number; offset?: number }): void {
  const region = (scene.value.regions ?? []).find((candidate) => candidate.elementId === payload.elementId);
  if (!region || props.readOnly || !Number.isFinite(payload.anchor)) return;
  if (region.groupFrame) {
    updateGroupLabelPlacement(region, payload.anchor, payload.offset);
    return;
  }
  updateRegionAppearance(region, "regionLabelAnchor", clamp(payload.anchor, 0, .999999), false);
}

function updateGroupLabelAnchor(payload: { elementId: string; anchor: number; offset?: number }): void {
  const element = groupFrameElement(payload.elementId);
  if (!element || props.readOnly || !Number.isFinite(payload.anchor)) return;
  updateGroupLabelPlacement(element, payload.anchor, payload.offset);
}

function updateGroupLabelPlacement(
  element: GroupFrameElement,
  anchor: number,
  offset: number | undefined,
): void {
  mutateDocument((document) => {
    const view = document.views.find((candidate) => candidate.viewId === currentActiveViewId.value);
    if (!view) return;
    const current = view.overlay[element.elementId] ?? { semanticRef: element.semanticRef };
    const appearance = { ...current.appearance };
    appearance.groupLabelAnchor = clamp(anchor, 0, .999999);
    if (offset === undefined || !Number.isFinite(offset) || Math.abs(offset) < .000001) {
      delete appearance.groupLabelOffset;
    } else {
      appearance.groupLabelOffset = clamp(offset, -1, 1);
    }
    current.appearance = appearance;
    view.overlay[element.elementId] = current;
  }, false);
}

function updateGroupAppearance(
  element: GroupFrameElement,
  key: "groupLabelAnchor" | "groupLabelOffset" | "groupLabelWritingDirection" | "groupIconOffset" | "groupIconScale" | "groupZOrder",
  value: RegionLabelWritingDirection | Point | number | undefined,
  recordHistory: boolean,
): void {
  mutateDocument((document) => {
    const view = document.views.find((candidate) => candidate.viewId === currentActiveViewId.value);
    if (!view) return;
    const current = view.overlay[element.elementId] ?? { semanticRef: element.semanticRef };
    const appearance = { ...current.appearance };
    if (value === undefined) delete appearance[key];
    else if (key === "groupLabelWritingDirection") appearance[key] = value as RegionLabelWritingDirection;
    else if (key === "groupIconOffset") appearance[key] = value as Point;
    else appearance[key] = value as number;
    if (Object.keys(appearance).length) current.appearance = appearance;
    else delete current.appearance;
    if (!current.geometry && !current.pinned && !current.placement && !current.appearance && !current.routing && !current.extensions) delete view.overlay[element.elementId];
    else view.overlay[element.elementId] = current;
  }, recordHistory);
}

function changeGroupIconOffset(payload: { elementId: string; offset?: Point }): void {
  const element = groupFrameElement(payload.elementId);
  if (!element || props.readOnly) return;
  updateGroupAppearance(element, "groupIconOffset", payload.offset, false);
}

function updateSelectedGroupIconScale(event: Event): void {
  const element = selectedElement.value;
  const value = Number((event.target as HTMLInputElement).value);
  if (
    !element
    || (element.structuralKind !== "container" && element.structuralKind !== "region")
    || !element.groupFrame
    || !Number.isFinite(value)
  ) return;
  updateGroupAppearance(element, "groupIconScale", clamp(value, .1, 8), true);
}

function updateSelectedGroupIconOffset(axis: "x" | "y", event: Event): void {
  const element = selectedElement.value;
  const value = Number((event.target as HTMLInputElement).value);
  if (
    !element
    || (element.structuralKind !== "container" && element.structuralKind !== "region")
    || !element.groupFrame
    || !Number.isFinite(value)
  ) return;
  const offset = {
    x: axis === "x" ? clamp(value, -128, 128) : element.groupIconOffset?.x ?? 0,
    y: axis === "y" ? clamp(value, -128, 128) : element.groupIconOffset?.y ?? 0,
  };
  updateGroupAppearance(
    element,
    "groupIconOffset",
    offset.x === 0 && offset.y === 0 ? undefined : offset,
    true,
  );
}

function resetSelectedGroupIconPresentation(): void {
  const element = selectedElement.value;
  if (
    !element
    || (element.structuralKind !== "container" && element.structuralKind !== "region")
    || !element.groupFrame
    || props.readOnly
  ) return;
  mutateDocument((document) => {
    const view = document.views.find((candidate) => candidate.viewId === currentActiveViewId.value);
    const current = view?.overlay[element.elementId];
    if (!view || !current?.appearance) return;
    const appearance = { ...current.appearance };
    delete appearance.groupIconOffset;
    delete appearance.groupIconScale;
    current.appearance = Object.keys(appearance).length ? appearance : undefined;
    view.overlay[element.elementId] = current;
  }, true);
}

function updateSelectedGroupLabelWritingDirection(event: Event): void {
  const element = selectedElement.value;
  const direction = (event.target as HTMLSelectElement).value as RegionLabelWritingDirection;
  if (
    !element
    || (element.structuralKind !== "container" && element.structuralKind !== "region")
    || !element.groupFrame
    || props.readOnly
    || (direction !== "horizontal-right" && direction !== "vertical-down")
  ) return;
  updateGroupAppearance(
    element,
    "groupLabelWritingDirection",
    direction === "horizontal-right" ? undefined : direction,
    true,
  );
}

function moveSelectedGroupLayer(direction: "back" | "front"): void {
  const element = selectedElement.value;
  if (
    !element
    || (element.structuralKind !== "container" && element.structuralKind !== "region")
    || !element.groupFrame
    || props.readOnly
  ) return;
  const values = groupFrameElements().map((candidate) => candidate.groupZOrder ?? 0);
  updateGroupAppearance(
    element,
    "groupZOrder",
    direction === "front" ? Math.max(-1, ...values) + 1 : Math.min(1, ...values) - 1,
    true,
  );
}

function fitSelectedGroupToMembers(): void {
  const element = selectedElement.value;
  if (
    !element
    || (element.structuralKind !== "container" && element.structuralKind !== "region")
    || !element.groupFrame
    || props.readOnly
  ) return;
  const memberIds = new Set((scene.value.memberships ?? [])
    .filter((membership) => (
      membership.containerElementId === element.elementId
      || membership.regionElementId === element.elementId
    ))
    .map((membership) => membership.memberElementId));
  const members = [
    ...scene.value.nodes,
    ...scene.value.containers,
    ...(scene.value.regions ?? []),
  ].filter((candidate) => memberIds.has(candidate.elementId));
  if (members.length === 0) return;
  const geometry = automaticGroupFrameGeometry(element, members);
  changeGeometryBatch([{
    elementId: element.elementId,
    geometry,
  }], true);
}

function resetSelectedGroupFrameView(): void {
  const element = selectedElement.value;
  if (
    !element
    || (element.structuralKind !== "container" && element.structuralKind !== "region")
    || !element.groupFrame
    || props.readOnly
  ) return;
  if (!activeView.value?.overlay[element.elementId]) return;
  const members = groupFrameMembers(element);
  const baseline = generatedGeometryBaseline(element.elementId)
    ?? automaticGroupFrameGeometry(element, members);
  setGeneratedGeometryBaseline(element.elementId, baseline);
  rawScene.value = sceneWithResetGroupFrameGeometry(rawScene.value, element.elementId, baseline);
  mutateDocument((document) => {
    const view = document.views.find((candidate) => candidate.viewId === currentActiveViewId.value);
    const current = view?.overlay[element.elementId];
    if (!view || !current) return;
    const appearance = { ...current.appearance };
    delete appearance.groupLabelAnchor;
    delete appearance.groupLabelOffset;
    delete appearance.groupLabelWritingDirection;
    delete appearance.groupIconOffset;
    delete appearance.groupIconScale;
    delete appearance.groupZOrder;
    if (Object.keys(appearance).length) current.appearance = appearance;
    else delete current.appearance;
    delete current.geometry;
    delete current.pinned;
    delete current.placement;
    // Keep the semanticRef-only entry: an imported/custom overlay key may be
    // the stable elementId. Deleting it would regenerate a different ID and
    // make reset/reload target different Scene elements.
    view.overlay[element.elementId] = current;
  }, true);
}

function sceneWithResetGroupFrameGeometry(
  value: DiagramScene,
  elementId: string,
  geometry: ElementGeometry,
): DiagramScene {
  const apply = <T extends SceneContainer | SceneRegion>(element: T): T => (
    element.elementId === elementId
      ? {
          ...element,
          geometry: roundGeometry(geometry),
          pinned: false,
          placement: "generated" as const,
        }
      : element
  );
  return {
    ...value,
    containers: value.containers.map(apply),
    regions: value.regions?.map(apply),
  };
}

function groupFrameMembers(element: GroupFrameElement): Array<SceneNode | SceneContainer | SceneRegion> {
  const memberIds = new Set((scene.value.memberships ?? [])
    .filter((membership) => (
      membership.containerElementId === element.elementId
      || membership.regionElementId === element.elementId
    ))
    .map((membership) => membership.memberElementId));
  return [
    ...scene.value.nodes,
    ...scene.value.containers,
    ...(scene.value.regions ?? []),
  ].filter((candidate) => memberIds.has(candidate.elementId));
}

function automaticGroupFrameGeometry(
  element: GroupFrameElement,
  members: readonly (SceneNode | SceneContainer | SceneRegion)[],
): ElementGeometry {
  const catalogDefault = activeCatalog.value?.templates[element.templateRef]?.defaultSize;
  const minimum = catalogDefault ?? (element.structuralKind === "region"
    ? { width: 240, height: 160 }
    : { width: 360, height: 160 });
  if (members.length === 0) {
    return {
      x: element.geometry.x + (element.geometry.width - minimum.width) / 2,
      y: element.geometry.y + (element.geometry.height - minimum.height) / 2,
      width: minimum.width,
      height: minimum.height,
    };
  }
  const padding = 28;
  const header = 36;
  const left = Math.min(...members.map((member) => member.geometry.x)) - padding;
  const top = Math.min(...members.map((member) => member.geometry.y)) - padding - header;
  const right = Math.max(...members.map((member) => member.geometry.x + member.geometry.width)) + padding;
  const bottom = Math.max(...members.map((member) => member.geometry.y + member.geometry.height)) + padding;
  const natural = { x: left, y: top, width: right - left, height: bottom - top };
  const width = Math.max(minimum.width, natural.width);
  const height = Math.max(minimum.height, natural.height);
  return {
    x: natural.x - (width - natural.width) / 2,
    y: natural.y - (height - natural.height) / 2,
    width,
    height,
  };
}

function groupFrameElements(): GroupFrameElement[] {
  return [
    ...scene.value.containers.filter((candidate) => candidate.groupFrame),
    ...(scene.value.regions ?? []).filter((candidate) => candidate.groupFrame),
  ];
}

function groupFrameElement(elementId: string): GroupFrameElement | undefined {
  return groupFrameElements().find((candidate) => candidate.elementId === elementId);
}

function moveSelectedRegionLayer(direction: "back" | "front"): void {
  const region = selectedElement.value;
  if (region?.structuralKind !== "region" || props.readOnly) return;
  const values = Object.values(regionZOrders.value);
  const value = direction === "front"
    ? Math.max(-1, ...values) + 1
    : Math.min(1, ...values) - 1;
  updateRegionAppearance(region, "regionZOrder", value, true);
}

function updateSelectedRegionLabelPlacement(event: Event): void {
  const element = selectedElement.value;
  const placement = (event.target as HTMLSelectElement).value as RegionLabelPlacement;
  if (element?.structuralKind !== "region" || props.readOnly) return;
  mutateDocument((document) => {
    const view = document.views.find((candidate) => candidate.viewId === currentActiveViewId.value);
    if (!view) return;
    const current = view.overlay[element.elementId] ?? { semanticRef: element.semanticRef };
    const appearance = { ...current.appearance };
    if (placement === defaultRegionLabelPlacement(element)) delete appearance.labelPlacement;
    else appearance.labelPlacement = placement;
    if (Object.keys(appearance).length) current.appearance = appearance;
    else delete current.appearance;
    if (!current.geometry && !current.pinned && !current.placement && !current.appearance && !current.routing && !current.extensions) delete view.overlay[element.elementId];
    else view.overlay[element.elementId] = current;
  }, true);
}

function updateSelectedRegionLabelWritingDirection(event: Event): void {
  const element = selectedElement.value;
  const direction = (event.target as HTMLSelectElement).value as RegionLabelWritingDirection;
  if (
    element?.structuralKind !== "region"
    || props.readOnly
    || (direction !== "horizontal-right" && direction !== "vertical-down")
  ) return;
  const placement = regionLabelPlacementFor(element.elementId);
  updateRegionAppearance(
    element,
    "regionLabelWritingDirection",
    direction === defaultRegionLabelWritingDirection(placement) ? undefined : direction,
    true,
  );
}

function updateGeometryField(field: keyof ElementGeometry, event: Event): void {
  const value = Number((event.target as HTMLInputElement).value);
  const element = selectedElement.value;
  if (!Number.isFinite(value) || !element || !("geometry" in element)) return;
  if (field === "x" || field === "y") {
    changeGeometryBatch(translateSelection(
      scene.value,
      [element.elementId],
      {
        x: field === "x" ? value - element.geometry.x : 0,
        y: field === "y" ? value - element.geometry.y : 0,
      },
      {
        grid: { enabled: false, size: snapSettings.value.grid.size },
        targets: { enabled: false, tolerance: snapSettings.value.targets.tolerance },
      },
    ), true);
    return;
  }
  const change = resizeGeometryElement(scene.value, element.elementId, {
    width: field === "width" ? value : element.geometry.width,
    height: field === "height" ? value : element.geometry.height,
  });
  if (change) changeGeometryBatch([change], true);
}

function updateTemplate(templateRef: string): void {
  updateAppearance("templateRef", templateRef || undefined);
}

function updateIcon(event: Event): void {
  const element = selectedElement.value;
  const input = event.target as HTMLInputElement;
  const value = input.value.trim();
  iconPathDraft.value = value;
  iconPathIssue.value = "";
  iconSelectionFeedback.value = "";
  if (!value) {
    clearIconSelection();
    return;
  }
  const exactRefOption = assetOptions.value.find((candidate) => candidate.assetRef === value);
  if (exactRefOption) {
    iconPathDraft.value = exactRefOption.path ?? value;
    commitIconSelection(exactRefOption.assetRef, {
      label: exactRefOption.label ?? exactRefOption.path ?? "画像",
      path: exactRefOption.path,
    });
    return;
  }
  const pathOption = assetOptions.value.find((candidate) => candidate.path === value);
  const packagePathOption = pathOption?.assetRef.startsWith("urn:iriograph:icon:") ? pathOption : undefined;
  if (packagePathOption) {
    iconPathDraft.value = packagePathOption.path ?? value;
    commitIconSelection(packagePathOption.assetRef, {
      label: packagePathOption.label ?? packagePathOption.path ?? "画像",
      path: packagePathOption.path,
    });
    return;
  }
  const located = props.workspaceLocator?.resolve({ documentPath: props.filePath, input: value });
  if (located?.status === "resolved") {
    const stableOption = assetOptions.value.find((candidate) => candidate.assetRef === located.assetRef);
    iconPathDraft.value = stableOption?.path ?? located.path;
    commitIconSelection(located.assetRef, {
      label: stableOption?.label ?? fileNameFromPath(located.path),
      path: stableOption?.path ?? located.path,
    });
    return;
  }
  if (!props.workspaceLocator && pathOption) {
    iconPathDraft.value = pathOption.path ?? value;
    commitIconSelection(pathOption.assetRef, {
      label: pathOption.label ?? pathOption.path ?? "画像",
      path: pathOption.path,
    });
    return;
  }
  {
    input.value = iconInputValue.value;
    iconPathDraft.value = input.value;
    iconPathIssue.value = located?.message ?? "候補にある画像pathを選択してください。";
    rejectInvalidAssetRef(iconPathIssue.value);
    return;
  }
}

function updateIconPathDraft(event: Event): void {
  iconPathDraft.value = (event.target as HTMLInputElement).value;
  iconPathIssue.value = "";
  iconSelectionFeedback.value = "";
}

function chooseWorkspacePath(input: string): void {
  iconPathDraft.value = input;
  iconPathIssue.value = "";
  iconSelectionFeedback.value = "";
  void nextTick(() => document.getElementById(iconPathInputId)?.focus());
}

function chooseWorkspaceSuggestion(option: WorkspaceLocatorSuggestion): void {
  if (option.kind === "folder") {
    chooseWorkspacePath(option.input);
    return;
  }
  if (props.readOnly) return;
  const located = props.workspaceLocator?.resolve({ documentPath: props.filePath, input: option.input });
  if (located?.status !== "resolved") {
    iconPathIssue.value = located?.message ?? "画像ファイルを選択できませんでした。";
    iconSelectionFeedback.value = "";
    rejectInvalidAssetRef(iconPathIssue.value);
    return;
  }
  const stableOption = assetOptions.value.find((candidate) => candidate.assetRef === located.assetRef);
  iconPathDraft.value = option.input;
  iconPathIssue.value = "";
  commitIconSelection(located.assetRef, {
    label: stableOption?.label ?? option.label,
    path: option.input,
  });
}

function commitIconSelection(
  assetRef: string,
  presentation: { label: string; path?: string },
): void {
  const element = selectedElement.value;
  if (
    !element
    || element.structuralKind === "edge"
    || element.structuralKind !== "node" && !element.groupFrame
    || props.readOnly
  ) return;
  const requestToken = ++iconAssetSelectionRequestToken;
  lastIconSelection.value = {
    elementId: element.elementId,
    assetRef,
    label: presentation.label,
    path: presentation.path,
  };
  iconAssetSelectionBusy.value = true;
  iconSelectionFeedback.value = `${presentation.label}を設定しています…`;
  const committed = updateAppearance("iconRef", assetRef);
  if (!committed) {
    iconAssetSelectionBusy.value = false;
    iconSelectionFeedback.value = `${presentation.label}を選択中です。`;
    return;
  }
  void committed.finally(() => {
    if (requestToken !== iconAssetSelectionRequestToken || selectedElementId.value !== element.elementId) return;
    iconAssetSelectionBusy.value = false;
    iconSelectionFeedback.value = `${presentation.label}をアイコンに設定しました。`;
  });
}

function clearIconSelection(): void {
  if (props.readOnly) return;
  iconAssetSelectionRequestToken += 1;
  iconAssetSelectionBusy.value = false;
  lastIconSelection.value = undefined;
  iconPathDraft.value = "";
  iconPathIssue.value = "";
  iconSelectionFeedback.value = "アイコンを外しました。";
  updateAppearance("iconRef", undefined);
}

async function chooseAssetIcon(): Promise<void> {
  const picker = props.pickAsset;
  const element = selectedElement.value;
  if (
    !picker
    || !element
    || element.structuralKind === "edge"
    || element.structuralKind !== "node" && !element.groupFrame
    || props.readOnly
  ) return;
  cancelAssetPicker();
  const requestToken = ++pickerRequestToken;
  const controller = new AbortController();
  pickerAbortController = controller;
  pickingAsset.value = true;
  iconPathIssue.value = "";
  iconSelectionFeedback.value = "画像ファイルを参照しています…";
  const elementId = element.elementId;
  try {
    const result = await picker({
      currentAssetRef: element.iconRef,
      semanticRef: element.semanticRef,
      allowedMediaTypes: withPackageDefaultIconAccess(props.assetAccess).policy.allowedMediaTypes,
      signal: controller.signal,
    });
    if (
      requestToken !== pickerRequestToken
      || controller.signal.aborted
      || selectedElementId.value !== elementId
    ) return;
    if (result.status === "cancelled") {
      iconSelectionFeedback.value = "画像ファイルの選択をキャンセルしました。";
      return;
    }
    const assetRef = normalizePickedAssetRef(result.assetRef);
    if (!assetRef) {
      iconPathIssue.value = "画像ファイルを選択できませんでした。";
      iconSelectionFeedback.value = "";
      rejectInvalidAssetRef("asset pickerがabsolute IRIを返しませんでした。", element.semanticRef);
      return;
    }
    const option = assetOptions.value.find((candidate) => candidate.assetRef === assetRef);
    commitIconSelection(assetRef, {
      label: option?.label ?? "参照した画像",
      path: option?.path,
    });
  } catch (cause) {
    if (requestToken !== pickerRequestToken || controller.signal.aborted) return;
    iconPathIssue.value = "画像ファイルを参照できませんでした。再試行してください。";
    iconSelectionFeedback.value = "";
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
): Promise<void> | undefined {
  const element = selectedElement.value;
  if (!element || element.structuralKind === "edge") return;
  if (field === "iconRef") {
    applyDiagnostics.value = applyDiagnostics.value.filter(
      (diagnostic) => diagnostic.code !== "asset-ref-invalid",
    );
  }
  return mutateDocument((document) => {
    const view = document.views.find((candidate) => candidate.viewId === currentActiveViewId.value);
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

function changeNodeIconPresentation(
  payload: {
    elementId: string;
    size: { width: number; height: number };
    geometry?: ElementGeometry;
  },
  recordHistory = false,
): void {
  const node = scene.value.nodes.find((candidate) => candidate.elementId === payload.elementId);
  if (
    !node
    || props.readOnly
    || !validIconDimension(payload.size.width)
    || !validIconDimension(payload.size.height)
  ) return;
  const constrained = constrainIconPresentationResize(
    scene.value,
    node,
    payload.size,
    payload.geometry,
  );
  if (constrained.issue && !constrained.geometry) {
    applyDiagnostics.value = [{
      severity: "warning",
      code: constrained.issue.code,
      message: `${constrained.issue.message} 所属する枠を広げるか、アイコンを小さくしてください。`,
      semanticRef: node.semanticRef,
    }];
    return;
  }
  const constrainedGeometry = constrained.geometry
    && !sameElementGeometry(constrained.geometry, node.geometry)
    ? constrained.geometry
    : undefined;
  mutateDocument((document) => {
    const view = document.views.find((candidate) => candidate.viewId === currentActiveViewId.value);
    if (!view) return;
    const current = view.overlay[node.elementId] ?? { semanticRef: node.semanticRef };
    const appearance = {
      ...current.appearance,
      nodeIconSize: {
        width: roundPresentationNumber(constrained.size.width),
        height: roundPresentationNumber(constrained.size.height),
      },
    };
    delete appearance.nodeIconScale;
    view.overlay[node.elementId] = {
      ...current,
      appearance,
      ...(constrainedGeometry ? {
        geometry: roundGeometry(constrainedGeometry),
        pinned: true,
        placement: "user" as const,
      } : {}),
    };
  }, recordHistory);
}

function sameElementGeometry(left: ElementGeometry, right: ElementGeometry): boolean {
  return left.x === right.x
    && left.y === right.y
    && left.width === right.width
    && left.height === right.height;
}

function updateSelectedNodeIconSizingMode(event: Event): void {
  const mode = (event.target as HTMLSelectElement).value;
  const node = selectedElement.value;
  if (node?.structuralKind !== "node" || props.readOnly || (mode !== "scale" && mode !== "size")) return;
  updateSelectedNodeIconAppearance((appearance) => {
    if (mode === "scale") {
      delete appearance.nodeIconSize;
      appearance.nodeIconScale = node.nodeIconScale ?? 1;
    } else {
      delete appearance.nodeIconScale;
      const metrics = selectedIconMetrics.value ?? { width: 24, height: 24 };
      appearance.nodeIconSize = {
        width: roundPresentationNumber(metrics.width),
        height: roundPresentationNumber(metrics.height),
      };
    }
  });
}

function updateSelectedNodeIconScale(event: Event): void {
  const requested = Number((event.target as HTMLInputElement).value);
  if (!Number.isFinite(requested)) return;
  updateSelectedNodeIconAppearance((appearance) => {
    delete appearance.nodeIconSize;
    appearance.nodeIconScale = clamp(requested, .1, 8);
  });
}

function updateSelectedNodeIconSize(field: "width" | "height", event: Event): void {
  const requested = Number((event.target as HTMLInputElement).value);
  if (!Number.isFinite(requested)) return;
  const metrics = selectedIconMetrics.value ?? { width: 24, height: 24 };
  updateSelectedNodeIconAppearance((appearance) => {
    delete appearance.nodeIconScale;
    appearance.nodeIconSize = {
      width: field === "width" ? clamp(requested, 4, 4096) : metrics.width,
      height: field === "height" ? clamp(requested, 4, 4096) : metrics.height,
    };
  });
}

function updateSelectedNodeIconFit(event: Event): void {
  const fit = (event.target as HTMLSelectElement).value;
  if (fit !== "contain" && fit !== "cover") return;
  updateSelectedNodeIconAppearance((appearance) => {
    appearance.nodeIconFit = fit;
  });
}

function resetSelectedNodeIconPresentation(): void {
  updateSelectedNodeIconAppearance((appearance) => {
    delete appearance.nodeIconScale;
    delete appearance.nodeIconSize;
    delete appearance.nodeIconFit;
  });
}

function updateSelectedNodeIconAppearance(
  update: (appearance: NonNullable<ViewElementOverlay["appearance"]>) => void,
): void {
  const node = selectedElement.value;
  if (node?.structuralKind !== "node" || props.readOnly) return;
  mutateDocument((document) => {
    const view = document.views.find((candidate) => candidate.viewId === currentActiveViewId.value);
    if (!view) return;
    const current = view.overlay[node.elementId] ?? { semanticRef: node.semanticRef };
    const appearance = { ...current.appearance };
    update(appearance);
    if (Object.keys(appearance).length) current.appearance = appearance;
    else delete current.appearance;
    if (!current.geometry && !current.pinned && !current.placement && !current.appearance && !current.routing && !current.extensions) {
      delete view.overlay[node.elementId];
    } else {
      view.overlay[node.elementId] = current;
    }
  }, true);
}

function validIconDimension(value: number): boolean {
  return Number.isFinite(value) && value >= 4 && value <= 4096;
}

function roundPresentationNumber(value: number): number {
  return Math.round(value * 100) / 100;
}

function updateSelectedEdgeCaption(event: Event): void {
  const edge = selectedEdge.value;
  if (!edge || props.readOnly) return;
  const value = (event.target as HTMLTextAreaElement).value.trimEnd();
  mutateDocument((document) => {
    const view = document.views.find((candidate) => candidate.viewId === currentActiveViewId.value);
    if (!view) return;
    const current = view.overlay[edge.elementId] ?? { semanticRef: edge.semanticRef };
    const appearance = { ...current.appearance };
    if (value) appearance.edgeCaption = value;
    else delete appearance.edgeCaption;
    if (Object.keys(appearance).length) current.appearance = appearance;
    else delete current.appearance;
    if (!current.geometry && !current.pinned && !current.placement && !current.appearance && !current.routing && !current.extensions) delete view.overlay[edge.elementId];
    else view.overlay[edge.elementId] = current;
  }, true);
}

function openAppearanceEditor(): void {
  const available = new Set([
    ...scene.value.nodes,
    ...scene.value.containers,
    ...(scene.value.regions ?? []),
    ...scene.value.edges,
  ].map((element) => element.elementId));
  const targets = selectedElementIds.value.filter((elementId) => available.has(elementId));
  if (targets.length === 0 && selectedElementId.value && available.has(selectedElementId.value)) {
    targets.push(selectedElementId.value);
  }
  if (targets.length === 0) return;
  appearanceTargetIds.value = targets;
  appearancePreviewValue.value = undefined;
  appearanceEditorOpen.value = true;
}

function closeAppearanceEditor(): void {
  appearanceEditorOpen.value = false;
  appearanceTargetIds.value = [];
  appearancePreviewValue.value = undefined;
}

function previewAppearance(value: AppearanceEditorValue): void {
  appearancePreviewValue.value = clone(value);
}

function commitAppearance(value: AppearanceEditorValue): void {
  const targets = new Set(appearanceTargetIds.value);
  mutateDocument((document) => {
    const view = document.views.find((candidate) => candidate.viewId === currentActiveViewId.value);
    if (!view) return;
    for (const element of [
      ...scene.value.nodes,
      ...scene.value.containers,
      ...(scene.value.regions ?? []),
      ...scene.value.edges,
    ]) {
      if (!targets.has(element.elementId)) continue;
      const current = view.overlay[element.elementId] ?? { semanticRef: element.semanticRef };
      const appearance = {
        ...current.appearance,
        styleRef: value.styleRef,
        style: value.style && Object.keys(value.style).length ? clone(value.style) : undefined,
      };
      if (!appearance.styleRef) delete appearance.styleRef;
      if (!appearance.style) delete appearance.style;
      if (Object.keys(appearance).length === 0) {
        delete current.appearance;
      } else {
        current.appearance = appearance;
      }
      if (!current.geometry && !current.pinned && !current.placement && !current.appearance && !current.routing && !current.extensions) {
        delete view.overlay[element.elementId];
      } else {
        view.overlay[element.elementId] = current;
      }
    }
  }, true);
  appearancePreviewValue.value = undefined;
}

function applyAppearance(value: AppearanceEditorValue): void {
  commitAppearance(value);
  closeAppearanceEditor();
}

function previewAppearanceStyle(
  element: SceneNode | SceneContainer | SceneRegion | SceneEdge,
  value: AppearanceEditorValue,
): VisualStyle {
  const template = activeCatalog.value?.templates[element.templateRef];
  const base = template?.style ?? element.style;
  const preset = value.styleRef ? activeCatalog.value?.styles?.[value.styleRef] : undefined;
  const extensions = {
    ...base.extensions,
    ...preset?.extensions,
    ...value.style?.extensions,
  };
  return {
    ...base,
    ...preset,
    ...value.style,
    ...(Object.keys(extensions).length ? { extensions } : {}),
  };
}

function clearSelectedOverride(): void {
  const element = selectedElement.value;
  if (!element) return;
  mutateDocument((document) => {
    const view = document.views.find((candidate) => candidate.viewId === currentActiveViewId.value);
    const overlay = view?.overlay[element.elementId];
    if (!overlay) return;
    if (element.structuralKind === "edge") {
      delete overlay.routing;
      delete overlay.geometry;
      delete overlay.pinned;
      delete overlay.placement;
      if (!overlay.appearance && !overlay.extensions) delete view!.overlay[element.elementId];
      return;
    }
    overlay.pinned = false;
    overlay.placement = "generated";
  });
}

function updateAuthoringDraft(next: EditorAuthoringDraft): void {
  if (props.readOnly) return;
  const changedKind = next.kind !== authoringDraft.value.kind;
  if (changedKind) cancelAuthoringPicking();
  const selected = selectedElement.value?.structuralKind === "edge"
    ? undefined
    : selectedElement.value;
  if (changedKind && selected) {
    const batch = selectedAuthoringResources.value;
    if (next.kind === "set-property") {
      next.subjectIri = batch[0]?.iri ?? selected.semanticRef;
      next.subjectIris = batch.slice(1).map((item) => item.iri);
    }
    if (next.kind === "connect-resources") next.sourceIri = selected.semanticRef;
    if (next.kind === "set-membership") {
      const selectedContainer = batch.length === 1
        && (selected.structuralKind === "container" || selected.structuralKind === "region");
      if (selectedContainer) {
        next.containerIri = selected.semanticRef;
        next.memberIri = "";
        next.memberIris = [];
      } else {
        next.memberIri = batch[0]?.iri ?? selected.semanticRef;
        next.memberIris = batch.slice(1).map((item) => item.iri);
      }
    }
    if (next.kind === "set-sequence" || next.kind === "set-alternatives") {
      next.structureIri = selected.semanticRef;
    }
    if (next.kind === "delete-resource") next.resourceIri = selected.semanticRef;
  }
  invalidateAuthoringPreview();
  authoringDraft.value = next;
  applyDiagnostics.value = [];
}

function previewIntentDraft(next: EditorAuthoringDraft, operationLabel: string): void {
  if (props.readOnly) return;
  updateAuthoringDraft(next);
  const commands = compileAuthoringDraft(clone(next), activeView.value?.viewId ?? "");
  const creationPresentation = next.kind === "create-resource" && next.createTemplateRef
    ? {
        templateRef: next.createTemplateRef,
        structuralKind: next.createStructuralKind,
        viewId: currentActiveViewId.value,
      }
    : undefined;
  void executeIntentCommands(
    commands,
    operationLabel,
    authoringPreviewResourceChips(next),
    creationPresentation,
  );
}

async function previewIntentCommands(
  commands: AuthoringCommand[],
  operationLabel: string,
  resources: Array<{ iri: string; label: string; role: string }>,
): Promise<void> {
  await executeIntentCommands(commands, operationLabel, resources);
}

async function executeIntentCommands(
  commands: AuthoringCommand[],
  _operationLabel: string,
  _resources: Array<{ iri: string; label: string; role: string }>,
  creationPresentation?: {
    templateRef: string;
    structuralKind: "node" | "container" | "region";
    viewId: string;
  },
): Promise<void> {
  const context = authoringContext.value;
  if (!context || !authoringEnabled.value || authoringBusy.value) return;
  if (commands.length === 0) {
    applyDiagnostics.value = [{
      severity: "warning",
      code: "authoring-no-change",
      message: "変更する項目を選んでから、もう一度実行してください。",
    }];
    return;
  }
  cancelAuthoringRequest();
  const requestToken = ++authoringRequestToken;
  const controller = new AbortController();
  authoringAbortController = controller;
  const sourceDocument = clone(draft.value);
  const sourceJson = JSON.stringify(sourceDocument);
  authoringBusy.value = true;
  try {
    const preview = await previewAuthoringCommands(sourceDocument, commands, context, {
      allocator: props.resourceIriAllocator ?? context.allocator,
      signal: controller.signal,
    });
    if (
      requestToken !== authoringRequestToken
      || controller.signal.aborted
      || props.readOnly
      || JSON.stringify(draft.value) !== sourceJson
    ) return;
    applyDiagnostics.value = userFacingTransactionDiagnostics(preview.diagnostics);
    if (!preview.valid) return;
    const result = await applyAuthoringPreview(sourceDocument, preview, context, {
      confirmationId: preview.confirmationId,
      signal: controller.signal,
    });
    if (
      requestToken !== authoringRequestToken
      || controller.signal.aborted
      || props.readOnly
      || JSON.stringify(draft.value) !== sourceJson
    ) return;
    applyDiagnostics.value = userFacingTransactionDiagnostics(result.diagnostics);
    if (!result.accepted) return;
    const committed = creationPresentation
      ? applyCreatedResourceTemplate(result.document, preview, creationPresentation)
      : result.document;
    resetAuthoringDraft();
    semanticIntentPanel.value?.resetIntent();
    publish(
      committed,
      true,
      "semantic",
      creationPresentation ? undefined : preparedSceneFor(result),
    );
    turtleDraft.value = committed.semantic.source;
  } catch (cause) {
    if (requestToken !== authoringRequestToken || controller.signal.aborted) return;
    applyDiagnostics.value = [authoringFailureDiagnostic("intent-transaction-failed", cause)];
  } finally {
    if (requestToken === authoringRequestToken) {
      authoringAbortController = undefined;
      authoringBusy.value = false;
    }
  }
}

async function handleTypeSystemAction(action: TypeSystemAction): Promise<void> {
  const compiled = typeSystemIndex.value.compileAction(action, {
    commandId: `${structuredRequestId.value}:type-list`,
    defaultLocale: authoringContext.value?.defaultLocale ?? activeView.value?.locale,
  });
  if (!compiled.ok) {
    applyDiagnostics.value = [{
      severity: "error",
      category: "structure",
      code: `type-list-${compiled.code}`,
      message: compiled.message,
    }];
    return;
  }
  if (action.type === "delete-class") {
    await requestTypeSystemDeletion(
      [...compiled.batch.commands],
      action.typeId,
    );
    return;
  }
  await executeIntentCommands([...compiled.batch.commands], "型一覧", []);
}

async function requestTypeSystemDeletion(
  commands: AuthoringCommand[],
  typeId: string,
): Promise<void> {
  const context = authoringContext.value;
  if (!context || !authoringEnabled.value || authoringBusy.value || props.readOnly) return;
  cancelAuthoringRequest();
  const requestToken = ++authoringRequestToken;
  const controller = new AbortController();
  authoringAbortController = controller;
  const previous = clone(draft.value);
  const previousJson = JSON.stringify(previous);
  authoringBusy.value = true;
  try {
    const preview = await previewAuthoringCommands(previous, commands, context, {
      allocator: props.resourceIriAllocator ?? context.allocator,
      signal: controller.signal,
    });
    if (
      requestToken !== authoringRequestToken
      || controller.signal.aborted
      || props.readOnly
      || JSON.stringify(draft.value) !== previousJson
    ) return;
    applyDiagnostics.value = userFacingTransactionDiagnostics(preview.diagnostics);
    if (!preview.valid) return;
    const impacts = typeSystemDeletionImpacts(preview, typeId);
    if (impacts.length > 0) {
      deletionDialogReturnFocus = document.activeElement instanceof HTMLElement
        ? document.activeElement
        : undefined;
      pendingDeletion.value = { preview, impacts, clearSelection: false };
      return;
    }
    await applyDeletionPreview(previous, preview, requestToken, controller, false);
  } catch (cause) {
    if (requestToken !== authoringRequestToken || controller.signal.aborted) return;
    applyDiagnostics.value = [authoringFailureDiagnostic("type-list-delete-failed", cause)];
  } finally {
    if (requestToken === authoringRequestToken) {
      authoringAbortController = undefined;
      authoringBusy.value = false;
      if (pendingDeletion.value) {
        await nextTick();
        deletionConfirmButton.value?.focus();
      }
    }
  }
}

function typeSystemDeletionImpacts(preview: AuthoringPreview, typeId: string): DeletionImpact[] {
  const typeIri = typeSystemIndex.value.resolveTypeId(typeId);
  if (!typeIri) return [];
  const typeByIri = new Map(typeSystemIndex.value.presentation.types.flatMap((item) => {
    const iri = typeSystemIndex.value.resolveTypeId(item.typeId);
    return iri ? [[iri, item] as const] : [];
  }));
  return preview.patch.removed.flatMap((change): DeletionImpact[] => {
    if (
      change.subject.termType !== "NamedNode"
      || change.subject.value === typeIri
      || change.object.termType !== "NamedNode"
      || change.object.value !== typeIri
    ) return [];
    const subjectIri = change.subject.value;
    const label = typeSystemResourceByIri.value.get(subjectIri)?.label
      ?? typeByIri.get(subjectIri)?.label
      ?? semanticMetadata.value[subjectIri]?.labels[0]?.value
      ?? "名前のない要素";
    return [{
      key: `type-reference:${change.statementRef}`,
      kind: "type-reference",
      label: `${label}からの型参照`,
    }];
  }).filter((impact, index, impacts) => (
    impacts.findIndex((candidate) => candidate.key === impact.key) === index
  ));
}

function openTypeListFromTag(payload: {
  elementId: string;
  typeId: string;
  resourceId: string;
}): void {
  typeListFocus.value = { typeId: payload.typeId, resourceId: payload.resourceId };
  typeHighlightElementIds.value = [payload.elementId];
  panel.value = "types";
}

async function showTypeResourcesInDiagram(request: TypeSystemShowInDiagramRequest): Promise<void> {
  const resourceIris = new Set(request.resourceIds.flatMap((resourceId) => {
    const iri = typeSystemIndex.value.resolveResourceId(resourceId);
    return iri ? [iri] : [];
  }));
  typeHighlightElementIds.value = [
    ...scene.value.nodes,
    ...scene.value.containers,
    ...(scene.value.regions ?? []),
  ].filter((element) => resourceIris.has(element.semanticRef)).map((element) => element.elementId);
  panel.value = "diagram";
  await nextTick();
  const focusResourceIri = request.focusResourceId
    ? typeSystemIndex.value.resolveResourceId(request.focusResourceId)
    : undefined;
  const focusElement = focusResourceIri
    ? [...scene.value.nodes, ...scene.value.containers, ...(scene.value.regions ?? [])]
      .find((element) => element.semanticRef === focusResourceIri)
    : undefined;
  const firstElementId = focusElement?.elementId ?? typeHighlightElementIds.value[0];
  if (firstElementId) await diagramCanvas.value?.revealElement(firstElementId);
}

function beginIntentResourcePicking(field: "sourceIri" | "targetIri"): void {
  const edge = intentEdgeDetails.value;
  if (edge && authoringDraft.value.kind !== "connect-resources") {
    const next = emptyAuthoringDraft("connect-resources", edge.sourceIri);
    next.sourceIri = edge.sourceIri;
    next.targetIri = edge.targetIri;
    next.predicateIri = edge.predicateIri;
    updateAuthoringDraft(next);
  }
  if (activeSemanticIntent.value === "add-relation" && authoringDraft.value.kind !== "connect-resources") {
    const selectedSource = selectedAuthoringResources.value.length === 1
      ? selectedAuthoringResources.value[0]?.iri ?? ""
      : "";
    const next = emptyAuthoringDraft("connect-resources", selectedSource);
    next.sourceIri = selectedSource;
    updateAuthoringDraft(next);
  }
  if (activeSemanticIntent.value === "add-relation" && authoringDraft.value.kind === "connect-resources") {
    const next = clone(authoringDraft.value);
    if (field === "sourceIri") next.sourceIri = "";
    next.targetIri = "";
    updateAuthoringDraft(next);
  }
  beginResourcePicking({ field });
}

function useIntentSelfTarget(sourceIri: string): void {
  if (!sourceIri || props.readOnly || activeSemanticIntent.value !== "add-relation") return;
  const next = authoringDraft.value.kind === "connect-resources"
    ? clone(authoringDraft.value)
    : emptyAuthoringDraft("connect-resources", sourceIri);
  next.sourceIri = sourceIri;
  next.targetIri = sourceIri;
  authoringResourcePicker.value = undefined;
  pendingAuthoringGuidance.value = "始点自身への関係を明示的に選びました。関係の種類を確認してください。";
  updateAuthoringDraft(next);
}

function seedSemanticEdgeEndpoint(payload: {
  edgeElementId: string;
  endpoint: "source" | "target";
  targetSemanticRef: string;
}): void {
  if (
    inspectorMode.value !== "semantic"
    || selectedEdge.value?.elementId !== payload.edgeElementId
    || intentEdgeDetails.value?.derivedReason
  ) return;
  const edge = intentEdgeDetails.value;
  const capability = edge?.capability;
  if (!edge || capability?.command !== "remove-statement" || !payload.targetSemanticRef) return;
  const nextStatement = {
    subjectIri: payload.endpoint === "source" ? payload.targetSemanticRef : edge.sourceIri,
    predicateIri: edge.predicateIri,
    objectIri: payload.endpoint === "target" ? payload.targetSemanticRef : edge.targetIri,
  };
  const commands: AuthoringCommand[] = [{
    type: "remove-statement",
    commandId: "endpoint-reconnect-remove",
    statementRef: capability.statementRef,
    subjectIri: capability.subject,
    predicateIri: capability.predicate,
    objectIri: capability.object,
  }, {
    type: "connect-resources",
    commandId: "endpoint-reconnect-add",
    ...nextStatement,
  }, {
    type: "set-statement-comments",
    commandId: "endpoint-reconnect-comments",
    statementRef: statementIdentityForNamedStatement(nextStatement),
    ...nextStatement,
    comments: (edge.statementComments ?? []).map((item) => ({ kind: "literal", ...item })),
  }];
  void executeIntentCommands(commands, `${edge.label}の接続先を変更`, [
    { iri: nextStatement.subjectIri, label: "始点", role: "始点" },
    { iri: nextStatement.objectIri, label: "終点", role: "終点" },
  ]);
}

function selectedDeletionCommands(elementIds: readonly string[]): AuthoringCommand[] {
  const elements = [
    ...scene.value.nodes,
    ...scene.value.containers,
    ...(scene.value.regions ?? []),
    ...scene.value.edges,
  ];
  const selected = elementIds
    .map((elementId) => elements.find((candidate) => candidate.elementId === elementId))
    .filter((element): element is SelectedElement => Boolean(element));
  const deletedResourceIris = new Set(selected
    .filter((element) => element.structuralKind !== "edge")
    .map((element) => element.semanticRef));
  const commands: AuthoringCommand[] = [...deletedResourceIris].map((resourceIri, index) => ({
    type: "delete-resource",
    commandId: `selection-delete-resource-${index + 1}`,
    resourceIri,
    cascade: true,
  }));
  for (const edge of selected.filter((element): element is SceneEdge => element.structuralKind === "edge")) {
    const capability = edge.provenance?.editCapability;
    if (capability?.command !== "remove-statement") continue;
    if (deletedResourceIris.has(capability.subject) || deletedResourceIris.has(capability.object)) continue;
    commands.push({
      type: "remove-statement",
      commandId: `selection-delete-edge-${commands.length + 1}`,
      statementRef: capability.statementRef,
      subjectIri: capability.subject,
      predicateIri: capability.predicate,
      objectIri: capability.object,
    });
  }
  return commands;
}

function deletionImpacts(preview: AuthoringPreview, selectedIds: ReadonlySet<string>): DeletionImpact[] {
  const removedRefs = new Set(preview.patch.removed.map((change) => change.statementRef));
  const impacts: DeletionImpact[] = [];
  for (const edge of scene.value.edges) {
    const refs = new Set([
      ...(edge.provenance?.sourceStatementRefs ?? []),
      ...(edge.labelProvenance?.sourceStatementRefs ?? []),
    ]);
    if (selectedIds.has(edge.elementId) || ![...refs].some((ref) => removedRefs.has(ref))) continue;
    const source = geometryElement(edge.sourceElementId)?.label ?? "始点";
    const target = geometryElement(edge.targetElementId)?.label ?? "終点";
    impacts.push({
      key: `edge:${edge.elementId}`,
      kind: "relation",
      label: `${source}（${edge.label || "関係"}）${target}`,
    });
  }
  for (const membership of scene.value.memberships ?? []) {
    if (!membership.provenance.sourceStatementRefs.some((ref) => removedRefs.has(ref))) continue;
    const representedIds = [
      membership.containerElementId,
      membership.memberElementId,
      ...(membership.regionElementId ? [membership.regionElementId] : []),
    ];
    if (representedIds.every((elementId) => selectedIds.has(elementId))) continue;
    const container = geometryElement(membership.containerElementId)?.label ?? "領域";
    const member = geometryElement(membership.memberElementId)?.label ?? "要素";
    impacts.push({
      key: `membership:${membership.semanticRef}:${membership.ordinal ?? 0}`,
      kind: membership.role === "sequence-member"
        ? "sequence"
        : membership.role === "alternative-member" ? "alternative" : "membership",
      label: membership.role === "sequence-member"
        ? `${container} の ${membership.ordinal ?? "?"}番「${member}」`
        : membership.role === "alternative-member"
          ? `${container} の選択肢 ${membership.ordinal ?? "?"}番「${member}」`
        : `${container} に含まれる「${member}」`,
    });
  }
  return impacts.filter((impact, index) => (
    impacts.findIndex((candidate) => candidate.key === impact.key) === index
  ));
}

async function requestSemanticDeletion(elementId?: string): Promise<void> {
  const context = authoringContext.value;
  if (!context || !authoringEnabled.value || authoringBusy.value || props.readOnly) return;
  const targetIds = elementId
    ? selectedElementIdsSet.value.has(elementId) ? [...selectedElementIds.value] : [elementId]
    : [...selectedElementIds.value];
  const commands = selectedDeletionCommands(targetIds);
  if (commands.length === 0) {
    applyDiagnostics.value = [{
      severity: "warning",
      code: "selection-delete-unavailable",
      message: "この表示は元の関係を直接削除できません。元の所属・並び順を選んで編集してください。",
    }];
    return;
  }
  cancelAuthoringRequest();
  const requestToken = ++authoringRequestToken;
  const controller = new AbortController();
  authoringAbortController = controller;
  const previous = clone(draft.value);
  const previousJson = JSON.stringify(previous);
  authoringBusy.value = true;
  try {
    const preview = await previewAuthoringCommands(previous, commands, context, {
      allocator: props.resourceIriAllocator ?? context.allocator,
      signal: controller.signal,
    });
    if (
      requestToken !== authoringRequestToken
      || controller.signal.aborted
      || props.readOnly
      || JSON.stringify(draft.value) !== previousJson
    ) return;
    applyDiagnostics.value = clone(preview.diagnostics);
    if (!preview.valid) return;
    const impacts = deletionImpacts(preview, new Set(targetIds));
    if (impacts.length > 0) {
      deletionDialogReturnFocus = document.activeElement instanceof HTMLElement
        ? document.activeElement
        : undefined;
      pendingDeletion.value = { preview, impacts, clearSelection: true };
      return;
    }
    await applyDeletionPreview(previous, preview, requestToken, controller, true);
  } catch (cause) {
    if (requestToken !== authoringRequestToken || controller.signal.aborted) return;
    applyDiagnostics.value = [authoringFailureDiagnostic("selection-delete-failed", cause)];
  } finally {
    if (requestToken === authoringRequestToken) {
      authoringAbortController = undefined;
      authoringBusy.value = false;
      if (pendingDeletion.value) {
        await nextTick();
        deletionConfirmButton.value?.focus();
      }
    }
  }
}

async function confirmPendingDeletion(): Promise<void> {
  const context = authoringContext.value;
  const pending = pendingDeletion.value;
  if (!context || !pending?.preview.valid || authoringBusy.value || props.readOnly) return;
  cancelAuthoringRequest();
  const requestToken = ++authoringRequestToken;
  const controller = new AbortController();
  authoringAbortController = controller;
  const previous = clone(draft.value);
  authoringBusy.value = true;
  try {
    await applyDeletionPreview(
      previous,
      pending.preview,
      requestToken,
      controller,
      pending.clearSelection,
    );
  } catch (cause) {
    if (requestToken !== authoringRequestToken || controller.signal.aborted) return;
    applyDiagnostics.value = [authoringFailureDiagnostic("selection-delete-apply-failed", cause)];
  } finally {
    if (requestToken === authoringRequestToken) {
      authoringAbortController = undefined;
      authoringBusy.value = false;
    }
  }
}

async function applyDeletionPreview(
  previous: IriographDocument,
  preview: AuthoringPreview,
  requestToken: number,
  controller: AbortController,
  clearCurrentSelection: boolean,
): Promise<void> {
  const context = authoringContext.value;
  if (!context) return;
  const previousJson = JSON.stringify(previous);
  const result = await applyAuthoringPreview(previous, preview, context, {
    confirmationId: preview.confirmationId,
    signal: controller.signal,
  });
  if (
    requestToken !== authoringRequestToken
    || controller.signal.aborted
    || props.readOnly
    || JSON.stringify(draft.value) !== previousJson
  ) return;
  applyDiagnostics.value = clone(result.diagnostics);
  if (!result.accepted) return;
  pendingDeletion.value = undefined;
  resetAuthoringDraft();
  semanticIntentPanel.value?.resetIntent();
  if (clearCurrentSelection) clearSelection();
  publish(result.document, true, "semantic", preparedSceneFor(result));
  turtleDraft.value = result.document.semantic.source;
  restoreDeletionDialogFocus();
}

function cancelPendingDeletion(): void {
  pendingDeletion.value = undefined;
  restoreDeletionDialogFocus();
}

function restoreDeletionDialogFocus(): void {
  const target = deletionDialogReturnFocus;
  deletionDialogReturnFocus = undefined;
  void nextTick(() => target?.focus());
}

function handleDeletionDialogKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape" && !authoringBusy.value) {
    event.preventDefault();
    cancelPendingDeletion();
    return;
  }
  if (event.key !== "Tab") return;
  const focusable = [...(deletionDialog.value?.querySelectorAll<HTMLElement>(
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  ) ?? [])];
  if (focusable.length === 0) return;
  const first = focusable[0]!;
  const last = focusable.at(-1)!;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function applyCreatedResourceTemplate(
  document: IriographDocument,
  preview: AuthoringPreview,
  presentation: {
    templateRef: string;
    structuralKind: "node" | "container" | "region";
    viewId: string;
  },
): IriographDocument {
  const command = preview.commands.find((candidate) => candidate.type === "create-resource");
  if (!command) return document;
  const next = clone(document);
  const view = next.views.find((candidate) => candidate.viewId === presentation.viewId);
  if (!view) return document;
  const elementId = generatedElementId(presentation.structuralKind, command.resourceIri);
  const current = view.overlay[elementId] ?? { semanticRef: command.resourceIri };
  view.overlay[elementId] = {
    ...current,
    appearance: {
      ...current.appearance,
      templateRef: presentation.templateRef,
    },
  };
  return next;
}

function seedSemanticEdit(elementId: string): void {
  if (props.readOnly || turtlePending.value || authoringBusy.value) return;
  const element = [
    ...scene.value.nodes,
    ...scene.value.containers,
    ...scene.value.edges,
  ].find((candidate) => candidate.elementId === elementId);
  if (!element) return;

  if (element.structuralKind !== "edge") {
    updateAuthoringDraft({
      ...emptyAuthoringDraft("delete-resource"),
      resourceIri: element.semanticRef,
    });
    return;
  }

  seedFromProvenance(element.provenance?.editCapability, "canvas-semantic-command");
}

function structuredGroupKindLabel(kind: StructuredGroupKind): string {
  return {
    classification: "分類グループ",
    membership: "包含グループ",
    sequence: "順序付きグループ",
    alternative: "候補グループ",
  }[kind];
}

function copyFlowChoice(choice: FlowCanvasChoice): FlowCanvasChoice {
  return {
    selection: { ...choice.selection },
    kind: choice.kind,
    ...(choice.groupKind ? { groupKind: choice.groupKind } : {}),
  };
}

function structuredChoice(elementId: string): StructuredAuthoringCanvasOption | undefined {
  return structuredCanvasOptions.value.find((candidate) => candidate.selection.elementId === elementId);
}

function transitionStructuredAuthoring(event: StructuredAuthoringFlowEvent): void {
  const transition = reduceStructuredAuthoringFlow(structuredAuthoringState.value, event);
  structuredAuthoringState.value = transition.state;
  if (
    event.type === "choose-relation-family"
    && event.family === "membership"
    && "draft" in structuredAuthoringState.value
    && structuredAuthoringState.value.draft.family === "membership"
    && (structuredAuthoringState.value.draft.groupKind === "sequence"
      || structuredAuthoringState.value.draft.groupKind === "alternative")
  ) {
    const group = structuredAuthoringState.value.draft.group;
    const option = group ? structuredChoice(group.elementId) : undefined;
    if (option) {
      structuredAuthoringState.value = reduceStructuredAuthoringFlow(structuredAuthoringState.value, {
        type: "set-members",
        members: existingOrderedGroupMembers(option),
      }).state;
    }
  }
  if (event.type === "next" || event.type === "back" || event.type === "submit") {
    structuredCanvasPicker.value = undefined;
  }
  if (transition.effect?.type === "cancelled") {
    structuredCanvasPicker.value = undefined;
    semanticDestination.value = undefined;
  }
}

function requestStructuredCanvasSelection(request: StructuredAuthoringCanvasSelectionRequest): void {
  structuredCanvasPicker.value = request;
  semanticDestination.value = undefined;
  panel.value = "diagram";
  const candidates = selectedElementIds.value.flatMap((elementId) => {
    const option = structuredChoice(elementId);
    return option && request.acceptedKinds.includes(option.kind) ? [option] : [];
  });
  const eligible = request.role === "direct-targets"
    ? withoutStructuredDirectSource(candidates)
    : candidates;
  if (eligible.length > 0) applyStructuredCanvasChoices(eligible, request);
}

function pickStructuredCanvasElement(request: DiagramSelectionRequest): void {
  const picker = structuredCanvasPicker.value;
  if (!picker || !request.elementId) return;
  applySelectionRequest(request);
  const selected = selectedElementIds.value
    .flatMap((elementId) => {
      const option = structuredChoice(elementId);
      return option ? [option] : [];
    })
    .filter((choice) => picker.acceptedKinds.includes(choice.kind));
  const eligible = picker.role === "direct-targets"
    ? withoutStructuredDirectSource(selected)
    : selected;
  const picked = picker.multiple ? eligible : eligible.slice(-1);
  if (picked.length > 0) applyStructuredCanvasChoices(picked, picker);
}

function pickStructuredCanvasElements(request: {
  elementIds: string[];
  mode: "replace" | "add" | "toggle";
}): void {
  const picker = structuredCanvasPicker.value;
  if (!picker) return;
  const current = request.mode === "replace" ? [] : [...selectedElementIds.value];
  for (const elementId of request.elementIds) {
    const index = current.indexOf(elementId);
    if (request.mode === "toggle" && index >= 0) current.splice(index, 1);
    else if (index < 0) current.push(elementId);
  }
  selectElements(current);
  const selected = selectedElementIds.value
    .flatMap((elementId) => {
      const option = structuredChoice(elementId);
      return option ? [option] : [];
    })
    .filter((choice) => picker.acceptedKinds.includes(choice.kind));
  const eligible = picker.role === "direct-targets"
    ? withoutStructuredDirectSource(selected)
    : selected;
  const picked = picker.multiple ? eligible : eligible.slice(-1);
  if (picked.length > 0) applyStructuredCanvasChoices(picked, picker);
}

function applyStructuredCanvasChoices(
  choices: readonly StructuredAuthoringCanvasOption[],
  request: StructuredAuthoringCanvasSelectionRequest,
): void {
  const first = choices[0];
  if (!first) return;
  switch (request.role) {
    case "direct-source":
      transitionStructuredAuthoring({ type: "set-direct-source", source: { ...first.selection } });
      break;
    case "direct-targets":
      transitionStructuredAuthoring({
        type: "set-direct-targets",
        targets: uniqueStructuredSelections(withoutStructuredDirectSource(choices)
          .map((choice) => choice.selection)),
      });
      break;
    case "membership-group": {
      if (!first.groupKind) return;
      transitionStructuredAuthoring({
        type: "set-membership-group",
        group: { ...first.selection },
        groupKind: first.groupKind,
      });
      if (first.groupKind === "sequence" || first.groupKind === "alternative") {
        transitionStructuredAuthoring({ type: "set-members", members: existingOrderedGroupMembers(first) });
      }
      break;
    }
    case "membership-members":
      {
      const selectedMembers = choices.map((choice) => ({
        kind: "existing" as const,
        selection: { ...choice.selection },
      }));
      const state = structuredAuthoringState.value;
      const current = "draft" in state && state.draft.family === "membership"
        ? state.draft
        : undefined;
      const members = current?.groupKind === "sequence" || current?.groupKind === "alternative"
        ? uniqueStructuredMembers([...current.members, ...selectedMembers])
        : selectedMembers;
      transitionStructuredAuthoring({
        type: "set-members",
        members,
      });
      break;
      }
    case "edit-element":
      transitionStructuredAuthoring({ type: "set-edit-element-target", target: { ...first.selection } });
      break;
    case "edit-relation":
      transitionStructuredAuthoring({ type: "set-edit-relation-target", target: copyFlowChoice(first) });
      break;
  }
  if (!request.multiple) structuredCanvasPicker.value = undefined;
}

function withoutStructuredDirectSource<T extends Pick<FlowCanvasChoice, "selection">>(
  choices: readonly T[],
): T[] {
  const state = structuredAuthoringState.value;
  const source = "draft" in state && state.draft.family === "direct"
    ? state.draft.source
    : undefined;
  return choices.filter((choice, index) => (
    (!source || choice.selection.viewId !== source.viewId || choice.selection.elementId !== source.elementId)
    && choices.findIndex((candidate) => (
      candidate.selection.viewId === choice.selection.viewId
      && candidate.selection.elementId === choice.selection.elementId
    )) === index
  ));
}

function uniqueStructuredSelections(
  selections: readonly StructuredCanvasSelection[],
): StructuredCanvasSelection[] {
  return selections.filter((selection, index) => selections.findIndex((candidate) => (
    candidate.viewId === selection.viewId && candidate.elementId === selection.elementId
  )) === index).map((selection) => ({ ...selection }));
}

function uniqueStructuredMembers<T extends { kind: string }>(members: readonly T[]): T[] {
  const key = (member: T): string => member.kind === "existing"
    ? `existing:${(member as T & { selection: StructuredCanvasSelection }).selection.viewId}:${(member as T & { selection: StructuredCanvasSelection }).selection.elementId}:${(member as T & { occurrenceId?: string }).occurrenceId ?? ""}`
    : `new:${(member as T & { clientId: string }).clientId}`;
  return members.filter((member, index) => members.findIndex((candidate) => key(candidate) === key(member)) === index);
}

function existingOrderedGroupMembers(
  group: StructuredAuthoringCanvasOption,
): Array<{ kind: "existing"; selection: StructuredCanvasSelection; occurrenceId: string }> {
  return (scene.value.memberships ?? [])
    .filter((membership) => (
      membership.containerElementId === group.selection.elementId
      || membership.regionElementId === group.selection.elementId
    ))
    .sort((left, right) => (
      (left.ordinal ?? Number.MAX_SAFE_INTEGER) - (right.ordinal ?? Number.MAX_SAFE_INTEGER)
      || left.memberElementId.localeCompare(right.memberElementId)
    ))
    .flatMap((membership) => structuredChoice(membership.memberElementId)
      ? [{
          kind: "existing" as const,
          selection: { viewId: currentActiveViewId.value, elementId: membership.memberElementId },
          occurrenceId: membership.provenance.sourceStatementRefs[0]
            ?? `${membership.semanticRef}:${membership.ordinal ?? "member"}`,
        }]
      : []);
}

async function submitStructuredAuthoring(
  request: StructuredAuthoringRequest,
  manageFlow = true,
): Promise<void> {
  const context = authoringContext.value;
  if (!context || !authoringEnabled.value || authoringBusy.value || props.readOnly) return;
  if (manageFlow) {
    transitionStructuredAuthoring({ type: "submit", requestId: request.requestId });
    if (structuredAuthoringState.value.phase !== "submitting") return;
  }
  cancelAuthoringRequest();
  const requestToken = ++authoringRequestToken;
  const controller = new AbortController();
  authoringAbortController = controller;
  const sourceDocument = clone(draft.value);
  const sourceJson = JSON.stringify(sourceDocument);
  authoringBusy.value = true;
  try {
    const structured = await previewStructuredAuthoringRequest(sourceDocument, request, context, {
      allocator: props.resourceIriAllocator ?? context.allocator,
      signal: controller.signal,
    });
    if (!structuredRequestIsCurrent(requestToken, controller, sourceJson)) return;
    applyDiagnostics.value = userFacingTransactionDiagnostics(structured.diagnostics);
    if (!structured.valid || !structured.preview) {
      if (manageFlow) transitionStructuredAuthoring({
          type: "submit-failed",
          errorKind: "validation",
          diagnostics: structured.diagnostics,
        });
      return;
    }
    const result = await applyAuthoringPreview(sourceDocument, structured.preview, context, {
      confirmationId: structured.preview.confirmationId,
      signal: controller.signal,
    });
    if (!structuredRequestIsCurrent(requestToken, controller, sourceJson)) return;
    applyDiagnostics.value = userFacingTransactionDiagnostics(result.diagnostics);
    if (!result.accepted) {
      if (manageFlow) transitionStructuredAuthoring({
          type: "submit-failed",
          errorKind: "validation",
          diagnostics: result.diagnostics,
        });
      return;
    }
    structuredRequestSequence += 1;
    structuredCanvasPicker.value = undefined;
    semanticDestination.value = undefined;
    if (manageFlow) transitionStructuredAuthoring({ type: "submit-succeeded", focusIntent: { kind: "flow-entry" } });
    await publish(result.document, true, "semantic", preparedSceneFor(result));
    turtleDraft.value = result.document.semantic.source;
  } catch (cause) {
    if (requestToken !== authoringRequestToken || controller.signal.aborted) return;
    const diagnostic = authoringFailureDiagnostic("structured-authoring-failed", cause);
    applyDiagnostics.value = [diagnostic];
    if (manageFlow) transitionStructuredAuthoring({
        type: "submit-failed",
        errorKind: "validation",
        diagnostics: [diagnostic],
      });
  } finally {
    if (requestToken === authoringRequestToken) {
      authoringAbortController = undefined;
      authoringBusy.value = false;
    }
  }
}

function structuredRequestIsCurrent(
  requestToken: number,
  controller: AbortController,
  sourceJson: string,
): boolean {
  if (
    requestToken === authoringRequestToken
    && !controller.signal.aborted
    && !props.readOnly
    && JSON.stringify(draft.value) === sourceJson
  ) return true;
  if (structuredAuthoringState.value.phase === "submitting") {
    transitionStructuredAuthoring({
      type: "submit-failed",
      errorKind: "stale",
      diagnostics: [{
        severity: "warning",
        code: "structured-authoring-stale",
        message: "編集中に図が更新されました。現在の内容を確認して、もう一度実行してください。",
      }],
    });
  }
  return false;
}

function focusStructuredDestination(
  effect: Extract<StructuredAuthoringFlowEffect, { type: "focus" }>,
): void {
  if (effect.intent.kind !== "inspector") return;
  openSemanticDestination(
    effect.intent.destination,
    undefined,
    effect.intent.destination === "element-details",
  );
}

function flowTargetElementId(): string | undefined {
  const state = structuredAuthoringState.value;
  if (!("draft" in state)) return undefined;
  const draft = state.draft;
  if (draft.family === "edit-element") return draft.target?.elementId;
  if (draft.family === "edit-relation") return draft.target?.selection.elementId;
  return undefined;
}

function openSemanticDestination(
  destination: FlowInspectorDestination | SemanticDestination,
  explicitElementId?: string,
  inlineElementDetails = false,
): void {
  const elementId = explicitElementId ?? flowTargetElementId();
  const inlineNodeDetails = destination === "element-details"
    && inlineElementDetails
    && Boolean(elementId && structuredChoice(elementId)?.kind === "node");
  if (elementId) selectElement(elementId);
  structuredAuthoringState.value = {
    ...createStructuredAuthoringFlow({
      allowUntypedNodes: structuredPresentation.value.profile.allowUntypedNodes,
    }),
    preselection: structuredPreselection.value.map(copyFlowChoice),
  };
  rightSidebarCollapsed.value = false;
  inspectorMode.value = "semantic";
  structuredCanvasPicker.value = undefined;
  if (destination === "element-details" && !inlineNodeDetails) {
    semanticDestination.value = undefined;
    if (elementId) openDetailsDialog(elementId);
    return;
  }
  if (destination === "delete") {
    semanticDestination.value = undefined;
    void requestSemanticDeletion(elementId);
    return;
  }
  semanticDestination.value = destination;
  activeSemanticIntent.value = destination === "element-details" ? "edit-element" : "edit-relation";
  const focusSection = destination === "group-sequence"
    ? "sequence"
    : destination === "group-alternatives"
      ? "alternatives"
      : destination === "group-membership"
        ? "membership"
        : destination === "relation-reconnect"
          ? "reconnect"
          : undefined;
  void nextTick(() => {
    if (focusSection) semanticIntentPanel.value?.focusEditSection(focusSection);
    else semanticIntentPanel.value?.focusPendingIntent();
  });
}

function contextSubject(request: DiagramContextMenuRequest): TargetContextSubject | undefined {
  if (request.kind === "blank") return { kind: "blank" };
  if (request.guide) {
    return request.guide.kind === "sequence-order"
      ? {
          kind: "derived-sequence-guide",
          elementId: request.guide.guideId,
          groupElementId: request.guide.groupElementId,
        }
      : {
          kind: "derived-alternative-guide",
          elementId: request.guide.guideId,
          groupElementId: request.guide.groupElementId,
        };
  }
  const element = request.elementId ? geometryElement(request.elementId) : undefined;
  if (!element || !request.elementId) {
    const edge = request.elementId
      ? scene.value.edges.find((candidate) => candidate.elementId === request.elementId)
      : undefined;
    if (!edge) return undefined;
  }
  if (element?.structuralKind === "node") return { kind: "node", elementId: element.elementId };
  if (element && (element.structuralKind === "container" || element.structuralKind === "region")) {
    const kind = element.groupFrame?.kind;
    if (kind === "classification") return { kind: "classification-group", elementId: element.elementId };
    if (kind === "sequence") return { kind: "sequence-group", elementId: element.elementId };
    if (kind === "alternative") return { kind: "alternative-group", elementId: element.elementId };
    if (kind === "membership") return { kind: "membership-group", elementId: element.elementId };
    return undefined;
  }
  const edge = request.elementId
    ? scene.value.edges.find((candidate) => candidate.elementId === request.elementId)
    : undefined;
  if (!edge) return undefined;
  if (edge.labelProvenance?.kind !== "derived-structure") {
    return { kind: "direct-edge", elementId: edge.elementId };
  }
  const provenance = edge.labelProvenance;
  if (provenance?.kind !== "derived-structure") return { kind: "direct-edge", elementId: edge.elementId };
  const groupElementId = [...scene.value.containers, ...(scene.value.regions ?? [])]
    .find((candidate) => candidate.semanticRef === provenance.structureSemanticRef)?.elementId;
  if (!groupElementId) return undefined;
  return provenance.role === "sequence-transition"
    ? { kind: "derived-sequence-guide", elementId: edge.elementId, groupElementId }
    : { kind: "derived-alternative-guide", elementId: edge.elementId, groupElementId };
}

const targetContextEntries = computed(() => {
  const session = targetContextMenuSession.value;
  if (!session.open) return [];
  const targetElementId = "elementId" in session.target
    ? session.target.kind === "derived-sequence-guide" || session.target.kind === "derived-alternative-guide"
      ? session.target.groupElementId
      : session.target.elementId
    : undefined;
  const targetElement = targetElementId ? geometryElement(targetElementId) : undefined;
  const targetEdge = targetElementId
    ? scene.value.edges.find((candidate) => candidate.elementId === targetElementId)
    : undefined;
  const groupFrames = groupFrameElements();
  return targetContextMenuEntries(session.target, {
    readOnly: props.readOnly,
    clipboardHasSupportedContent: props.structuredClipboard?.hasSupportedContent === true,
    hasManualRoute: Boolean(targetEdge && (
      targetEdge.waypoints?.length
      || targetEdge.curve
      || targetEdge.labelOffset
      || targetEdge.sourceAnchor
      || targetEdge.targetAnchor
    )),
    hasGroupMembers: Boolean(targetElement && targetElement.structuralKind !== "node" && (
      scene.value.memberships ?? []
    ).some((membership) => (
      membership.containerElementId === targetElementId
      || membership.regionElementId === targetElementId
    ))),
    canChangeGroupOrder: Boolean(targetElement && targetElement.structuralKind !== "node"
      && targetElement.groupFrame && groupFrames.length > 1),
    deleteDisabledReason: authoringBlockedReason.value || undefined,
  });
});

function openContextMenu(request: DiagramContextMenuRequest): void {
  const target = contextSubject(request);
  if (!target) return;
  const focused = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
  if (focused && !focused.id) focused.id = contextFocusFallbackId;
  const maxX = typeof window === "undefined" ? request.clientX : Math.max(8, window.innerWidth - 320);
  const maxY = typeof window === "undefined" ? request.clientY : Math.max(8, window.innerHeight - 420);
  targetContextMenuSession.value = openTargetContextMenu({
    target,
    request: {
      clientX: clamp(request.clientX, 8, maxX),
      clientY: clamp(request.clientY, 8, maxY),
      canvasPosition: request.canvasPosition,
    },
    origin: request.origin ?? "pointer",
    focusReturnId: focused?.id,
  });
}

function closeTargetMenu(): void {
  targetContextMenuSession.value = { open: false };
}

function selectTargetContextDestination(destination: TargetContextDestination): void {
  closeTargetMenu();
  const elementId = "elementId" in destination ? destination.elementId : undefined;
  if (elementId) selectElement(elementId);
  if (destination.surface === "semantic-flow") {
    startStructuredIntent(destination.intent, elementId);
    if (destination.section === "details") openSemanticDestination("element-details", elementId);
    else if (destination.section === "meaning") openSemanticDestination("relation-meaning", elementId);
    else if (destination.section === "membership") {
      openSemanticDestination("group-membership", elementId);
    } else if (destination.section === "sequence") {
      openSemanticDestination("group-sequence", elementId);
    } else if (destination.section === "alternatives") {
      openSemanticDestination("group-alternatives", elementId);
    } else if (destination.section === "reconnect") openSemanticDestination("relation-reconnect", elementId);
    return;
  }
  if (destination.surface === "view-inspector") {
    rightSidebarCollapsed.value = false;
    inspectorMode.value = "appearance";
    const section = displayInspectorSectionForContextDestination(destination.section);
    // Selection initialization runs in the same Vue flush. Open the requested
    // destination afterwards so an icon/group context action is not replaced
    // by the target's default section.
    void nextTick(() => openDisplayInspectorSection(section, true));
    return;
  }
  if (destination.surface === "delete") {
    void requestSemanticDeletion(destination.elementId);
    return;
  }
  if (destination.command === "paste") {
    void pasteStructuredClipboard();
  } else if (destination.command === "reset-route") resetSelectedRouting();
  else if (destination.command === "fit-group") fitSelectedGroupToMembers();
  else if (destination.command === "bring-forward") moveSelectedGroupLayer("front");
  else if (destination.command === "send-backward") moveSelectedGroupLayer("back");
}

async function pasteStructuredClipboard(): Promise<void> {
  const clipboard = props.structuredClipboard;
  if (!clipboard?.hasSupportedContent || props.readOnly || authoringBusy.value) return;
  const controller = new AbortController();
  try {
    const request = await clipboard.paste({
      documentId: draft.value.documentId,
      viewId: currentActiveViewId.value,
      requestId: structuredRequestId.value,
      signal: controller.signal,
    });
    if (!request || controller.signal.aborted) return;
    await submitStructuredAuthoring(request, false);
  } catch (cause) {
    applyDiagnostics.value = [authoringFailureDiagnostic("structured-clipboard-paste-failed", cause)];
  }
}

function startStructuredIntent(
  intent: "add-element" | "add-relation" | "edit-element" | "edit-relation",
  elementId?: string,
): void {
  const preselection = elementId
    ? structuredChoice(elementId) ? [copyFlowChoice(structuredChoice(elementId)!)] : []
    : structuredPreselection.value.map(copyFlowChoice);
  structuredAuthoringState.value = createStructuredAuthoringFlow({
    allowUntypedNodes: structuredPresentation.value.profile.allowUntypedNodes,
  });
  semanticDestination.value = undefined;
  transitionStructuredAuthoring({ type: "choose-intent", intent, preselection });
  rightSidebarCollapsed.value = false;
  inspectorMode.value = "semantic";
}

function seedRelationFrom(sourceIri: string): void {
  const predicate = authoringEdgeChoices.value.length === 1
    ? authoringEdgeChoices.value[0]?.iri ?? ""
    : "";
  updateAuthoringDraft({
    ...emptyAuthoringDraft("connect-resources", sourceIri),
    sourceIri,
    predicateIri: predicate,
  });
  beginResourcePicking({ field: "targetIri" });
}

function seedMembershipFor(memberIri: string): void {
  updateAuthoringDraft({
    ...emptyAuthoringDraft("set-membership", memberIri),
    memberIri,
    present: true,
  });
  beginResourcePicking({ field: "containerIri" });
}

async function openDetailsDialog(elementId: string): Promise<void> {
  const context = authoringContext.value;
  const option = structuredChoice(elementId);
  if (!context || !option || option.kind === "direct-edge") return;
  const selection = { ...option.selection };
  const text = await structuredLocalizedTextPresentation(draft.value, selection, context);
  const memberships = await structuredMembershipPresentation(draft.value, selection, context);
  applyDiagnostics.value = userFacingTransactionDiagnostics([
    ...text.diagnostics,
    ...memberships.diagnostics,
  ]);
  if (!text.valid || !memberships.valid) return;
  let selectedNodeRoleIds: readonly string[] = [];
  if (option.kind === "node") {
    const classificationSelections = (scene.value.memberships ?? [])
      .filter((membership) => membership.memberElementId === elementId)
      .flatMap((membership) => {
        const groupId = membership.regionElementId ?? membership.containerElementId;
        const group = structuredChoice(groupId);
        return group?.kind === "group" && group.groupKind === "classification"
          ? [{ ...group.selection }]
          : [];
      });
    if (classificationSelections.length) {
      const roles = await structuredNodeRoleSeedFromCanvasSelections(
        draft.value,
        classificationSelections,
        context,
      );
      applyDiagnostics.value = userFacingTransactionDiagnostics([
        ...applyDiagnostics.value,
        ...roles.diagnostics,
      ]);
      if (roles.valid) selectedNodeRoleIds = roles.roleIds;
    }
  }
  structuredDetails.value = {
    elementId,
    title: option.label,
    selection,
    fields: text.fields,
    selectedNodeRoleIds,
    ...(memberships.groupKind ? { currentGroupKind: memberships.groupKind } : {}),
    memberships: memberships.items,
  };
}

async function saveStructuredDetails(value: StructuredElementDetailsSave): Promise<void> {
  const details = structuredDetails.value;
  if (!details) return;
  const requests: StructuredAuthoringRequest[] = value.text.map((item, index) => {
    if (item.operation === "add") return {
      type: "add-localized-text",
      requestId: `${structuredRequestId.value}:text:${index + 1}`,
      target: { ...details.selection },
      field: item.field,
      value: item.value,
    };
    if (item.operation === "remove") return {
      type: "remove-localized-text",
      requestId: `${structuredRequestId.value}:text:${index + 1}`,
      target: { ...details.selection },
      field: item.field,
      valueId: item.valueId,
    };
    return {
      type: "update-localized-text",
      requestId: `${structuredRequestId.value}:text:${index + 1}`,
      target: { ...details.selection },
      field: item.field,
      valueId: item.valueId,
      value: item.value,
    };
  });
  if (value.nodeRoleIds) requests.push({
    type: "set-node-roles",
    requestId: `${structuredRequestId.value}:roles`,
    node: { ...details.selection },
    nodeRoleIds: [...value.nodeRoleIds],
  });
  if (value.groupKind) requests.push({
    type: "change-group-kind",
    requestId: `${structuredRequestId.value}:group-kind`,
    group: { ...details.selection },
    groupKind: value.groupKind,
  });
  if (value.removeMembershipIds?.length) requests.push({
    type: "remove-group-members",
    requestId: `${structuredRequestId.value}:remove-memberships`,
    viewId: details.selection.viewId,
    membershipIds: [...value.removeMembershipIds],
  });
  if (!requests.length) return;
  if (await submitStructuredAuthoringBatch(requests)) structuredDetails.value = undefined;
}

function editStructuredMembership(groupElementId: string): void {
  structuredDetails.value = undefined;
  if (!groupElementId) return;
  openSemanticDestination("group-membership", groupElementId);
}

async function submitStructuredAuthoringBatch(
  requests: readonly StructuredAuthoringRequest[],
): Promise<boolean> {
  const context = authoringContext.value;
  if (!context || !authoringEnabled.value || authoringBusy.value || props.readOnly) return false;
  cancelAuthoringRequest();
  const requestToken = ++authoringRequestToken;
  const controller = new AbortController();
  authoringAbortController = controller;
  const sourceJson = JSON.stringify(draft.value);
  const sourceDocument = clone(draft.value);
  authoringBusy.value = true;
  try {
    const structured = await previewStructuredAuthoringBatch(sourceDocument, requests, context, {
      allocator: props.resourceIriAllocator ?? context.allocator,
      signal: controller.signal,
    });
    applyDiagnostics.value = userFacingTransactionDiagnostics(structured.diagnostics);
    if (!structured.valid || !structured.preview) return false;
    const result = await applyAuthoringPreview(sourceDocument, structured.preview, context, {
      confirmationId: structured.preview.confirmationId,
      signal: controller.signal,
    });
    if (!structuredRequestIsCurrent(requestToken, controller, sourceJson)) return false;
    applyDiagnostics.value = userFacingTransactionDiagnostics(result.diagnostics);
    if (!result.accepted) return false;
    structuredRequestSequence += 1;
    await publish(result.document, true, "semantic", preparedSceneFor(result));
    turtleDraft.value = result.document.semantic.source;
    return true;
  } catch (cause) {
    if (requestToken !== authoringRequestToken || controller.signal.aborted) return false;
    applyDiagnostics.value = [authoringFailureDiagnostic("structured-details-failed", cause)];
    return false;
  } finally {
    if (requestToken === authoringRequestToken) {
      authoringAbortController = undefined;
      authoringBusy.value = false;
    }
  }
}

function seedParentRemoval(): void {
  const element = selectedElement.value;
  if (!element || element.structuralKind === "edge" || element.structuralKind === "region" || props.readOnly) return;
  seedFromProvenance(element.parentProvenance?.editCapability, "inspector-parent-command");
}

function seedContainmentAddition(warning: ContainmentConsistencyWarning): void {
  if (warning.kind !== "visual-only" || !authoringEnabled.value) return;
  const element = geometryElement(warning.elementId);
  const container = geometryElement(warning.visualContainerId);
  if (!element || !container || container.structuralKind !== "container") return;
  const matching = membershipChoicesForContainer(container);
  const selected = matching.length === 1 ? matching[0] : undefined;
  updateAuthoringDraft({
    ...emptyAuthoringDraft("set-membership", element.semanticRef),
    containerIri: container.semanticRef,
    memberIri: element.semanticRef,
    present: true,
    structureConfigKey: selected?.key ?? "",
    containerTypeIri: selected?.typeIri ?? "",
    membershipPredicateIri: selected?.predicateIri ?? "",
  });
}

function seedContainmentRemoval(warning: ContainmentConsistencyWarning): void {
  if (warning.kind !== "semantic-only" || !authoringEnabled.value) return;
  const element = geometryElement(warning.elementId);
  seedFromProvenance(parentEditCapability(element), "containment-warning-remove");
}

function canSeedContainmentRemoval(warning: ContainmentConsistencyWarning): boolean {
  return warning.kind === "semantic-only"
    && Boolean(parentEditCapability(geometryElement(warning.elementId)));
}

function parentEditCapability(element: GeometryElement | undefined): SemanticEditCapability | undefined {
  return element && "parentProvenance" in element
    ? element.parentProvenance?.editCapability
    : undefined;
}

function applyContainmentPresentationFix(
  warning: ContainmentConsistencyWarning,
  direction: "inside" | "outside",
): void {
  if (props.readOnly) return;
  const action = direction === "inside" && warning.kind === "semantic-only"
    ? {
        kind: "move-inside-semantic-container" as const,
        elementId: warning.elementId,
        containerElementId: warning.semanticContainerId,
      }
    : direction === "outside" && warning.kind === "visual-only"
      ? {
          kind: "move-outside-visual-container" as const,
          elementId: warning.elementId,
          containerElementId: warning.visualContainerId,
        }
      : undefined;
  if (!action) return;
  const translation = containmentPresentationTranslation(scene.value, action);
  if (!translation) return;
  changeGeometryBatch(translateSelection(
    scene.value,
    [warning.elementId],
    translation,
    {
      grid: { enabled: false },
      targets: { enabled: false },
    },
  ), true);
}

function containmentElementLabel(elementId: string): string {
  return geometryElement(elementId)?.label ?? "名前のない要素";
}

function edgeEndpointLabel(elementId: string, fallback: string): string {
  return geometryElement(elementId)?.label || fallback;
}

function containmentWarningMessage(warning: ContainmentConsistencyWarning): string {
  if (warning.kind === "visual-only") {
    return `${containmentElementLabel(warning.elementId)} は見た目上 ${containmentElementLabel(warning.visualContainerId)} の中ですが、意味上の包含はありません。`;
  }
  const visual = warning.visualContainerId && warning.visualContainerId !== warning.semanticContainerId
    ? ` 現在は見た目上 ${containmentElementLabel(warning.visualContainerId)} にあります。`
    : "";
  return `${containmentElementLabel(warning.elementId)} は意味上 ${containmentElementLabel(warning.semanticContainerId)} の配下ですが、領域内に収まっていません。${visual}`;
}

function seedFromProvenance(
  capability: SemanticEditCapability | undefined,
  commandId: string,
): void {
  const seeded = seedAuthoringCommandFromProvenance(draft.value, capability, commandId);
  const next = seeded.command ? draftFromAuthoringCommand(seeded.command) : undefined;
  if (next) updateAuthoringDraft(next);
  applyDiagnostics.value = clone(seeded.diagnostics);
}

function seedSelectedResource(
  target: "edge-source" | "edge-target" | "membership-container" | "membership-member",
): void {
  const selected = selectedAuthoringResource.value;
  if (!selected || props.readOnly) return;
  const field = {
    "edge-source": "sourceIri",
    "edge-target": "targetIri",
    "membership-container": "containerIri",
    "membership-member": "memberIri",
  }[target] as "sourceIri" | "targetIri" | "containerIri" | "memberIri";
  if (field === "memberIri" && selectedAuthoringResources.value.length > 1) {
    updateAuthoringDraft({
      ...authoringDraft.value,
      memberIri: selectedAuthoringResources.value[0]?.iri ?? selected.iri,
      memberIris: selectedAuthoringResources.value.slice(1).map((item) => item.iri),
    });
    return;
  }
  updateAuthoringDraft({ ...authoringDraft.value, [field]: selected.iri });
}

function beginDraftPositionPicking(): void {
  if (props.readOnly || authoringDraft.value.kind !== "create-resource") return;
  authoringResourcePicker.value = undefined;
  updateAuthoringDraft({ ...authoringDraft.value, positionPicking: true });
  panel.value = "diagram";
}

function seedDraftPosition(position: Point, containerIri?: string): void {
  if (
    props.readOnly
    || authoringDraft.value.kind !== "create-resource"
    || !authoringDraft.value.positionPicking
  ) return;
  const size = authoringDraftElementSize.value;
  const bounded = {
    x: Math.max(8, Math.min(position.x, scene.value.width - size.width - 8)),
    y: Math.max(8, Math.min(position.y, scene.value.height - size.height - 8)),
  };
  const matrixClassIris = membershipRegionClassIrisAtPoint(scene.value, position);
  updateAuthoringDraft({
    ...authoringDraft.value,
    initialX: String(Math.round(bounded.x)),
    initialY: String(Math.round(bounded.y)),
    positionPicking: false,
    classIris: [...new Set([...authoringDraft.value.classIris, ...matrixClassIris])],
    ...(containerIri && matrixClassIris.length === 0 ? createMembershipSeed(containerIri) : {}),
  });
}

function createMembershipSeed(containerIri: string): Partial<EditorAuthoringDraft> {
  const container = [...scene.value.containers, ...(scene.value.regions ?? [])]
    .find((item) => item.semanticRef === containerIri);
  const matching = container ? membershipChoicesForContainer(container) : [];
  const selected = matching.length === 1 ? matching[0] : undefined;
  return {
    createMembershipEnabled: true,
    createMembershipContainerIri: containerIri,
    createMembershipStructureConfigKey: selected?.key ?? "",
    createMembershipContainerTypeIri: selected?.typeIri ?? "",
    createMembershipPredicateIri: selected?.predicateIri ?? "",
  };
}

function membershipChoicesForContainer(container: SceneContainer | SceneRegion): AuthoringStructureChoice[] {
  const choices = authoringStructureChoices.value.filter((item) => item.kind === "membership");
  const ruleId = container.provenance?.rule?.ruleId;
  if (ruleId) return choices.filter((item) => item.ruleId === ruleId);
  return choices.length === 1 ? choices : [];
}

function beginResourcePicking(target: AuthoringResourcePickerTarget): void {
  if (!authoringEnabled.value || authoringBusy.value || props.readOnly) return;
  const same = JSON.stringify(authoringResourcePicker.value) === JSON.stringify(target);
  authoringResourcePicker.value = same ? undefined : clone(target);
  if (authoringDraft.value.positionPicking) {
    authoringDraft.value = { ...authoringDraft.value, positionPicking: false };
  }
  panel.value = "diagram";
}

function seedDraftResource(semanticRef: string): void {
  const target = authoringResourcePicker.value;
  if (!target || props.readOnly) return;
  const next = clone(authoringDraft.value);
  if (target.field === "propertyValue") {
    const value = next.propertyValues[target.index];
    if (!value || value.objectKind !== "iri") return;
    next.propertyValues[target.index] = { ...value, value: semanticRef };
  } else {
    if (
      activeSemanticIntent.value === "add-relation"
      && target.field === "targetIri"
      && next.sourceIri === semanticRef
    ) {
      next.targetIri = "";
      pendingAuthoringGuidance.value = "通常の終点には始点とは別の要素を選んでください。自身へ接続する場合は右の明示操作を使います。";
      updateAuthoringDraft(next);
      return;
    }
    next[target.field] = semanticRef;
    if (target.field === "containerIri" && next.kind === "set-membership") {
      const container = [...scene.value.containers, ...(scene.value.regions ?? [])]
        .find((item) => item.semanticRef === semanticRef);
      const matching = container ? membershipChoicesForContainer(container) : [];
      const selected = matching.length === 1 ? matching[0] : undefined;
      next.structureConfigKey = selected?.key ?? "";
      next.containerTypeIri = selected?.typeIri ?? "";
      next.membershipPredicateIri = selected?.predicateIri ?? "";
    }
  }
  if (activeSemanticIntent.value === "add-relation" && target.field === "sourceIri") {
    next.targetIri = "";
    authoringResourcePicker.value = { field: "targetIri" };
    pendingAuthoringGuidance.value = "続けて、始点とは別の終点をクリックしてください。";
  } else {
    authoringResourcePicker.value = undefined;
    pendingAuthoringGuidance.value = "";
  }
  updateAuthoringDraft(next);
}

function cancelAuthoringPicking(): void {
  authoringResourcePicker.value = undefined;
  structuredCanvasPicker.value = undefined;
  if (authoringDraft.value.positionPicking) {
    authoringDraft.value = { ...authoringDraft.value, positionPicking: false };
  }
}

function cancelAuthoringDraft(): void {
  if (authoringBusy.value) cancelAuthoringRequest();
  authoringDraft.value = emptyAuthoringDraft();
  authoringResourcePicker.value = undefined;
  applyDiagnostics.value = [];
}

function resetAuthoringDraft(): void {
  authoringDraft.value = emptyAuthoringDraft();
  authoringResourcePicker.value = undefined;
}

function invalidateAuthoringPreview(): void {
  cancelAuthoringRequest();
  if (pendingDeletion.value) cancelPendingDeletion();
}

function cancelAuthoringRequest(): void {
  authoringRequestToken += 1;
  authoringAbortController?.abort();
  authoringAbortController = undefined;
  authoringBusy.value = false;
}

function authoringFailureDiagnostic(code: string, cause: unknown): ProjectionDiagnostic {
  return {
    severity: "error",
    code,
    message: cause instanceof Error ? cause.message : String(cause),
  };
}

function layoutPurposeLabel(layoutRef: string | undefined): string {
  if (layoutRef && layoutDirectionForRef(layoutRef) === "LR") return "左から右へ自動配置";
  if (layoutRef && layoutDirectionForRef(layoutRef) === "TB") return "上から下へ自動配置";
  return layoutRef ? "自動配置" : "配置方法なし";
}

async function applyTurtleDraft(): Promise<boolean> {
  if (props.readOnly) return false;
  if (portableDocumentPending.value) {
    panel.value = "document";
    portableDocumentEditorIssues.value = [{
      path: "/",
      message: "Document全体に未適用の変更があります。",
      action: "Document全体を適用するか元に戻してから、Turtleを編集してください。",
    }];
    return false;
  }
  if (overlayPending.value) {
    panel.value = "document";
    overlayEditorIssues.value = [{
      path: "View overlay",
      message: "未適用のView overlay draftがあります。",
      action: "View overlayを適用するか元に戻してから、Turtleを適用してください。",
    }];
    return false;
  }
  if (structuredAuthoringPending.value) {
    pendingAuthoringGuidance.value = pendingDeletion.value
      ? "削除の影響確認を完了するか、キャンセルしてください。"
      : "意味の変更が入力中です。実行するか、キャンセルしてください。";
    applyDiagnostics.value = [{
      severity: "error",
      code: "pending-structured-authoring",
      message: "意味編集を実行またはキャンセルしてからTurtleを適用してください。",
    }];
    return false;
  }
  if (!turtlePending.value) return true;
  if (applyingTurtle.value) return false;
  const requestToken = ++semanticRequestToken;
  semanticAbortController?.abort();
  const controller = new AbortController();
  semanticAbortController = controller;
  const previous = clone(draft.value);
  const previousJson = JSON.stringify(previous);
  const runtime = projectionRuntimeContext.value;
  schemaDiagnostics.value = schemaDiagnosticsFor(previous, runtime);
  if (schemaDiagnostics.value.some((item) => item.severity === "error")) {
    cancelSemanticRequest();
    return false;
  }

  applyingTurtle.value = true;
  let result: SemanticSourceUpdate;
  try {
    const context = authoringContext.value;
    result = context
      ? await applyAuthoringSource(previous, turtleDraft.value, context, {
          actor: "human",
          signal: controller.signal,
          warningConfirmation: semanticWarningConfirmation.value,
        })
      : runtime
        ? await applySemanticSource(
          previous,
          turtleDraft.value,
          runtime,
          {
            validationContext: semanticValidationContext.value,
            warningConfirmation: semanticWarningConfirmation.value,
            signal: controller.signal,
          },
        )
        : {
            accepted: false,
            document: previous,
            diagnostics: [{
              severity: "error",
              category: "profile",
              code: "projection-runtime-context-missing",
              message: "ProjectionRuntimeContextが提供されていません。",
            }],
          };
  } catch (cause) {
    if (requestToken !== semanticRequestToken || controller.signal.aborted || props.readOnly) return false;
    applyDiagnostics.value = [{
      severity: "error",
      code: "semantic-transaction-failed",
      message: cause instanceof Error ? cause.message : String(cause),
    }];
    return false;
  } finally {
    if (requestToken === semanticRequestToken) {
      applyingTurtle.value = false;
      semanticAbortController = undefined;
    }
  }
  if (requestToken !== semanticRequestToken || controller.signal.aborted || props.readOnly) return false;
  if (JSON.stringify(draft.value) !== previousJson) {
    applyDiagnostics.value = [{
      severity: "error",
      code: "semantic-transaction-stale",
      message: "編集中にdocumentが変更されたためTurtle transactionを適用しませんでした。",
    }];
    return false;
  }
  applyDiagnostics.value = result.diagnostics;
  if (!result.accepted) {
    semanticWarningConfirmation.value = result.diagnostics.some((item) => item.severity === "error")
      ? undefined
      : result.warningConfirmation;
    return false;
  }
  if (requestToken !== semanticRequestToken || controller.signal.aborted || props.readOnly) return false;
  publish(result.document, true, "semantic", preparedSceneFor(result));
  semanticWarningConfirmation.value = undefined;
  turtleDraft.value = result.document.semantic.source;
  return true;
}

function cancelSemanticRequest(): void {
  semanticRequestToken += 1;
  semanticAbortController?.abort();
  semanticAbortController = undefined;
  applyingTurtle.value = false;
}

function revertTurtleDraft(): void {
  turtleDraft.value = draft.value.semantic.source;
  applyDiagnostics.value = [];
  semanticWarningConfirmation.value = undefined;
  schemaDiagnostics.value = schemaDiagnosticsFor(draft.value, projectionRuntimeContext.value);
}

function formatActiveOverlayDraft(): void {
  const view = activeView.value;
  if (!view) return;
  const parsed = parseOverlayDraft(view.viewId, activeOverlayDraft.value);
  if (!parsed) return;
  overlayDrafts.value = {
    ...overlayDrafts.value,
    [view.viewId]: JSON.stringify(parsed, null, 2),
  };
  overlayDraftTouched.value = { ...overlayDraftTouched.value, [view.viewId]: true };
  overlayEditorIssues.value = [];
}

function revertActiveOverlayDraft(): void {
  const view = activeView.value;
  if (!view) return;
  const current = JSON.stringify(view.overlay, null, 2);
  overlayDrafts.value = { ...overlayDrafts.value, [view.viewId]: current };
  overlayDraftBases.value = {
    ...overlayDraftBases.value,
    [view.viewId]: JSON.stringify(view.overlay),
  };
  overlayDraftTouched.value = { ...overlayDraftTouched.value, [view.viewId]: false };
  overlayEditorIssues.value = [];
}

async function applyOverlayDrafts(
  requestedViewIds: readonly string[] = activeView.value ? [activeView.value.viewId] : [],
): Promise<boolean> {
  if (props.readOnly || applyingOverlay.value) return false;
  if (portableDocumentPending.value) {
    portableDocumentEditorIssues.value = [{
      path: "/",
      message: "Document全体に未適用の変更があります。",
      action: "Document全体を適用するか元に戻してから、View overlayを編集してください。",
    }];
    return false;
  }
  const viewIds = [...new Set(requestedViewIds)].filter((viewId) => (
    overlayDraftTouched.value[viewId]
  ));
  if (viewIds.length === 0) return true;
  const previous = clone(draft.value);
  const next = clone(previous);
  const parsedByView = new Map<string, typeof next.views[number]["overlay"]>();
  const issues: OverlayEditorIssue[] = [];

  for (const viewId of viewIds) {
    const previousView = previous.views.find((view) => view.viewId === viewId);
    if (!previousView) {
      issues.push({
        path: `view:${viewId}`,
        message: "編集対象の名前付きビューが文書に存在しません。",
        action: "現在存在するviewを選び直してdraftを破棄してください。",
      });
      continue;
    }
    const base = overlayDraftBases.value[viewId];
    if (base !== undefined && base !== JSON.stringify(previousView.overlay)) {
      issues.push({
        path: `view:${viewId}`,
        message: "draft作成後にCanvasまたは別操作からView overlayが変更されました。",
        action: "現在値を保持するには元に戻してから編集し直してください。draftを優先する場合は一度JSONを退避して再入力してください。",
      });
      continue;
    }
    const parsed = parseOverlayDraft(viewId, overlayDrafts.value[viewId] ?? "{}");
    if (parsed) parsedByView.set(viewId, parsed);
    else issues.push(...overlayEditorIssues.value);
  }
  if (issues.length > 0) {
    overlayEditorIssues.value = issues;
    return false;
  }

  for (const view of next.views) {
    const parsed = parsedByView.get(view.viewId);
    if (parsed) view.overlay = parsed;
  }
  applyingOverlay.value = true;
  overlayEditorIssues.value = [];
  try {
    const result = await applyPortableCandidate(next, previous);
    if (!result) return false;

    for (const viewId of viewIds) {
      const overlay = result.views.find((view) => view.viewId === viewId)?.overlay ?? {};
      overlayDrafts.value = {
        ...overlayDrafts.value,
        [viewId]: JSON.stringify(overlay, null, 2),
      };
      overlayDraftBases.value = {
        ...overlayDraftBases.value,
        [viewId]: JSON.stringify(overlay),
      };
      overlayDraftTouched.value = { ...overlayDraftTouched.value, [viewId]: false };
    }
    if (JSON.stringify(result) !== JSON.stringify(previous)) {
      commitPortableReplacement(result, previous);
    }
    return true;
  } finally {
    applyingOverlay.value = false;
  }
}

function updatePortableDocumentDraft(value: string): void {
  if (!portableDocumentDraftTouched.value) {
    portableDocumentDraftBase.value = JSON.stringify(draft.value);
  }
  portableDocumentDraft.value = value;
  portableDocumentDraftTouched.value = true;
  portableDocumentEditorIssues.value = [];
}

function formatPortableDocumentDraft(): void {
  try {
    portableDocumentDraft.value = JSON.stringify(JSON.parse(portableDocumentDraft.value) as unknown, null, 2);
    portableDocumentDraftTouched.value = true;
    portableDocumentEditorIssues.value = [];
  } catch (cause) {
    portableDocumentEditorIssues.value = [jsonParseIssue(cause, portableDocumentDraft.value)];
  }
}

function revertPortableDocumentDraft(): void {
  portableDocumentDraft.value = JSON.stringify(draft.value, null, 2);
  portableDocumentDraftBase.value = JSON.stringify(draft.value);
  portableDocumentDraftTouched.value = false;
  portableDocumentEditorIssues.value = [];
}

async function applyPortableDocumentDraft(): Promise<boolean> {
  if (props.readOnly || applyingPortableDocument.value) return false;
  if (!portableDocumentPending.value) return true;
  const previous = clone(draft.value);
  if (portableDocumentDraftBase.value !== JSON.stringify(previous)) {
    portableDocumentEditorIssues.value = [{
      path: "/",
      message: "文書全体の下書き作成後に、Canvasまたは別の編集から文書が変更されました。",
      action: "現在の文書を元に戻してから、退避したJSONを貼り直してください。",
    }];
    return false;
  }
  applyingPortableDocument.value = true;
  portableDocumentEditorIssues.value = [];
  try {
    const result = await applyPortableCandidate(portableDocumentDraft.value, previous);
    if (!result) return false;
    commitPortableReplacement(result, previous);
    portableDocumentDraft.value = JSON.stringify(result, null, 2);
    portableDocumentDraftBase.value = JSON.stringify(result);
    portableDocumentDraftTouched.value = false;
    overlayDrafts.value = {};
    overlayDraftBases.value = {};
    overlayDraftTouched.value = {};
    overlayEditorIssues.value = [];
    return true;
  } finally {
    applyingPortableDocument.value = false;
  }
}

async function applyPortableCandidate(
  candidate: string | IriographDocument,
  previous: IriographDocument,
): Promise<IriographDocument | undefined> {
  const runtime = projectionRuntimeContext.value;
  if (!runtime) {
    const issue = {
      path: "/",
      message: "表示規則を解決できないため文書全体を検証できません。",
      action: "HostからProjectionRuntimeContextを提供してから再度適用してください。",
    };
    if (typeof candidate === "string") portableDocumentEditorIssues.value = [issue];
    else overlayEditorIssues.value = [issue];
    return undefined;
  }
  const token = ++portableDocumentRequestToken;
  portableDocumentAbortController?.abort();
  const controller = new AbortController();
  portableDocumentAbortController = controller;
  const revision = currentDocumentRevision.value;
  const source = typeof candidate === "string" ? "document" : "overlay";
  try {
    const preview = await previewPortableDocumentReplace(previous, candidate, runtime, {
      documentRevision: revision,
      semanticValidation: semanticValidationContext.value,
      signal: controller.signal,
    });
    if (token !== portableDocumentRequestToken || controller.signal.aborted || props.readOnly) return undefined;
    if (!preview.valid) {
      setPortableIssues(source, preview.diagnostics);
      return undefined;
    }
    const applied = await applyPortableDocumentReplace(previous, preview, runtime, {
      confirmationId: preview.confirmationId,
      documentRevision: revision,
      semanticValidation: semanticValidationContext.value,
      signal: controller.signal,
    });
    if (token !== portableDocumentRequestToken || controller.signal.aborted || props.readOnly) return undefined;
    applyDiagnostics.value = userFacingTransactionDiagnostics(applied.diagnostics);
    if (!applied.accepted) {
      setPortableIssues(source, applied.diagnostics);
      return undefined;
    }
    return applied.document;
  } catch (cause) {
    const issue: OverlayEditorIssue = {
      path: "/",
      message: cause instanceof Error ? cause.message : String(cause),
      action: "入力内容とHostの検証設定を確認してから再度適用してください。",
    };
    if (source === "document") portableDocumentEditorIssues.value = [issue];
    else overlayEditorIssues.value = [issue];
    return undefined;
  } finally {
    if (token === portableDocumentRequestToken) portableDocumentAbortController = undefined;
  }
}

function setPortableIssues(
  source: "document" | "overlay",
  diagnostics: readonly ProjectionDiagnostic[],
): void {
  const issues = diagnostics.filter((item) => item.severity === "error").map(portableDiagnosticIssue);
  if (source === "document") portableDocumentEditorIssues.value = issues;
  else overlayEditorIssues.value = issues;
}

function portableDiagnosticIssue(diagnostic: ProjectionDiagnostic): OverlayEditorIssue {
  const guidance = diagnosticGuidance(diagnostic);
  const containmentAction = isBlockingOverlayContainmentDiagnostic(diagnostic)
    ? "含まれる要素の全体を、所属するすべての領域の共通部分へ収めてください。"
    : undefined;
  return {
    path: safeDiagnosticPath(diagnostic.jsonPointer),
    message: guidance.title,
    action: `${containmentAction ?? guidance.action}（${guidance.detail}）`,
  };
}

function safeDiagnosticPath(path: string | undefined): string {
  if (!path) return "/";
  return /(?:https?:|urn:|[a-z][a-z0-9+.-]*:[^/])/iu.test(path) ? "対象項目" : path;
}

function commitPortableReplacement(next: IriographDocument, previous: IriographDocument): void {
  history.value.push(clone(previous));
  trimHistory();
  future.value = [];
  replaceDraft(next);
}

function cancelPortableDocumentRequest(): void {
  portableDocumentRequestToken += 1;
  portableDocumentAbortController?.abort();
  portableDocumentAbortController = undefined;
  applyingOverlay.value = false;
  applyingPortableDocument.value = false;
}

async function copyPortableDocument(): Promise<void> {
  try {
    await navigator.clipboard.writeText(JSON.stringify(draft.value, null, 2));
    portableDocumentCopyMessage.value = "同じdocumentIdとbaseの文書JSONをコピーしました。";
  } catch {
    portableDocumentCopyMessage.value = "コピーできませんでした。Document全体のJSONを選択してコピーしてください。";
  }
}

async function prepareDocumentRebase(event?: Event): Promise<void> {
  if (documentRebaseBlockedReason.value || allocatingDocumentIdentity.value) return;
  const allocator = props.documentIdentityAllocator;
  const runtime = projectionRuntimeContext.value;
  if (!allocator || !runtime) return;
  documentRebaseReturnFocus = event?.currentTarget instanceof HTMLElement
    ? event.currentTarget
    : document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
  const token = ++documentIdentityRequestToken;
  documentIdentityAbortController?.abort();
  const controller = new AbortController();
  documentIdentityAbortController = controller;
  const currentValidation = validateIriographDocumentV1(clone(draft.value));
  if (!currentValidation.valid) {
    documentRebaseIssues.value = currentValidation.issues.map((issue) => ({
      path: issue.instancePath || "/",
      message: "現在の文書形式では新しい図として複製できません。",
      action: issue.message,
    }));
    return;
  }
  const previous = currentValidation.value;
  const previousFingerprint = JSON.stringify(previous);
  const revision = currentDocumentRevision.value;
  const requestId = `document-copy-${Date.now().toString(36)}-${++documentIdentityRequestSequence}`;
  documentRebasePreview.value = undefined;
  documentRebaseIssues.value = [];
  allocatingDocumentIdentity.value = true;
  try {
    const allocation = await allocator.allocate({
      currentDocumentId: previous.documentId,
      currentBaseIri: previous.semantic.baseIri,
      documentRevision: revision,
      requestId,
      signal: controller.signal,
    });
    if (token !== documentIdentityRequestToken || controller.signal.aborted || props.readOnly) return;
    if (!allocation) {
      documentRebaseIssues.value = [{ path: "/documentId", message: "新しい文書IDを発行できませんでした。", action: "Hostの文書作成機能を確認して再試行してください。" }];
      return;
    }
    if (allocation.requestId !== requestId || allocation.documentRevision !== revision) {
      documentRebaseIssues.value = [{ path: "/documentId", message: "古い文書ID発行結果は使用しませんでした。", action: "現在の文書でもう一度「新しい図として複製」を実行してください。" }];
      return;
    }
    if (JSON.stringify(draft.value) !== previousFingerprint || currentDocumentRevision.value !== revision) {
      documentRebaseIssues.value = [{ path: "/", message: "ID発行中に文書が変更されました。", action: "変更を保存してから複製をやり直してください。" }];
      return;
    }
    const preview = await previewDocumentRebase(previous, {
      documentId: allocation.documentId,
      baseIri: allocation.baseIri,
    }, runtime, {
      documentRevision: revision,
      semanticValidation: semanticValidationContext.value,
      signal: controller.signal,
    });
    if (token !== documentIdentityRequestToken || controller.signal.aborted || props.readOnly) return;
    documentRebasePreview.value = preview;
    documentRebaseIssues.value = preview.diagnostics
      .filter((item) => item.severity === "error")
      .map(portableDiagnosticIssue);
    await nextTick();
    (preview.valid ? documentRebaseApplyButton.value : documentRebaseDialog.value)?.focus();
  } catch (cause) {
    documentRebaseIssues.value = [{
      path: "/documentId",
      message: "新しい図の準備に失敗しました。",
    action: "Hostの文書作成機能と現在の文書状態を確認して再試行してください。",
    }];
  } finally {
    if (token === documentIdentityRequestToken) {
      allocatingDocumentIdentity.value = false;
      documentIdentityAbortController = undefined;
    }
  }
}

async function applyPreparedDocumentRebase(): Promise<void> {
  const preview = documentRebasePreview.value;
  const runtime = projectionRuntimeContext.value;
  if (!preview || !preview.valid || !runtime || props.readOnly || allocatingDocumentIdentity.value) return;
  const currentValidation = validateIriographDocumentV1(clone(draft.value));
  if (!currentValidation.valid) return;
  const previous = currentValidation.value;
  const revision = currentDocumentRevision.value;
  allocatingDocumentIdentity.value = true;
  try {
    const result = await applyDocumentRebasePreview(previous, preview, runtime, {
      confirmationId: preview.confirmationId,
      documentRevision: revision,
      semanticValidation: semanticValidationContext.value,
    });
    applyDiagnostics.value = userFacingTransactionDiagnostics(result.diagnostics);
    if (!result.accepted) {
      documentRebaseIssues.value = result.diagnostics
        .filter((item) => item.severity === "error")
        .map(portableDiagnosticIssue);
      return;
    }
    const handoff: DocumentDuplicateHandoff = {
      document: clone(result.document),
      sourceDocumentId: previous.documentId,
      sourceDocumentRevision: revision,
    };
    closeDocumentRebaseDialog();
    emit("duplicatedAsNew", handoff);
  } finally {
    allocatingDocumentIdentity.value = false;
  }
}

function closeDocumentRebaseDialog(): void {
  cancelDocumentIdentityRequest();
  documentRebasePreview.value = undefined;
  documentRebaseIssues.value = [];
  void nextTick(() => documentRebaseReturnFocus?.focus());
}

function cancelDocumentIdentityRequest(): void {
  documentIdentityRequestToken += 1;
  documentIdentityAbortController?.abort();
  documentIdentityAbortController = undefined;
  allocatingDocumentIdentity.value = false;
}

function handleDocumentRebaseDialogKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    event.preventDefault();
    closeDocumentRebaseDialog();
  }
}

function rebaseTermLabel(iri: string): string {
  return semanticMetadata.value[iri]?.labels[0]?.value
    ?? authoringContext.value?.terms.find((term) => term.iri === iri)?.label
    ?? "名前のない要素";
}

function parseOverlayDraft(
  viewId: string,
  source: string,
): IriographDocument["views"][number]["overlay"] | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source) as unknown;
  } catch (cause) {
    overlayEditorIssues.value = [jsonParseIssue(cause, source)];
    return undefined;
  }
  if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object") {
    overlayEditorIssues.value = [{
      path: `view:${viewId}.overlay`,
      message: "View overlayの最上位はJSON objectである必要があります。",
      action: "要素IDをkey、overlay設定をvalueにした { ... } 形式へ直してください。",
    }];
    return undefined;
  }
  return parsed as IriographDocument["views"][number]["overlay"];
}

function jsonParseIssue(cause: unknown, source: string): OverlayEditorIssue {
  const detail = cause instanceof Error ? cause.message : String(cause);
  const match = /position\s+(\d+)/iu.exec(detail);
  let path = "JSON";
  if (match) {
    const offset = Number(match[1]);
    const before = source.slice(0, offset);
    const line = before.split("\n").length;
    const column = offset - before.lastIndexOf("\n");
    path = `${line}行 ${column}列`;
  }
  return {
    path,
    message: "JSONを解析できません。",
    action: "引用符、カンマ、波括弧の対応を確認してから再度適用してください。",
  };
}

function isBlockingOverlayContainmentDiagnostic(diagnostic: ProjectionDiagnostic): boolean {
  return diagnostic.code === "region-membership-intersection-empty"
    || diagnostic.code === "region-member-outside-intersection"
    || diagnostic.code === "region-member-outside";
}

function undo(): void {
  if (props.readOnly) return;
  const previous = history.value.at(-1);
  if (!previous) return;
  history.value.pop();
  future.value.push(clone(draft.value));
  replaceDraft(previous, turtlePending.value);
}

function redo(): void {
  if (props.readOnly) return;
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
  if (structuredAuthoringPending.value) {
    pendingAuthoringGuidance.value = pendingDeletion.value
      ? "削除の影響確認を完了するか、キャンセルしてください。"
      : "意味の変更が入力中です。実行するか、キャンセルしてください。";
    applyDiagnostics.value = [{
      severity: "error",
      code: "pending-structured-authoring",
      message: "意味の変更が入力中です。右の意味編集で実行するか、キャンセルしてください。",
    }];
    inspectorMode.value = "semantic";
    rightSidebarCollapsed.value = false;
    await nextTick();
    semanticIntentPanel.value?.focusPendingIntent();
    return false;
  }
  if (portableDocumentPending.value && !await applyPortableDocumentDraft()) {
    panel.value = "document";
    return false;
  }
  if (overlayPending.value && !await applyOverlayDrafts(overlayPendingViewIds.value)) {
    panel.value = "document";
    return false;
  }
  if (turtlePending.value) return applyTurtleDraft();
  schemaDiagnostics.value = schemaDiagnosticsFor(draft.value, projectionRuntimeContext.value);
  return !schemaDiagnostics.value.some((item) => item.severity === "error")
    && !scene.value.diagnostics.some((item) => item.severity === "error");
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.defaultPrevented || event.isComposing || isTextInput(event.target)) return;
  const command = event.ctrlKey || event.metaKey;
  if (command && event.key.toLowerCase() === "s") {
    event.preventDefault();
    void requestSave();
    return;
  }
  if (command && event.key.toLowerCase() === "a") {
    event.preventDefault();
    selectAll();
    return;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    if (authoringResourcePicker.value || authoringDraft.value.positionPicking) {
      cancelAuthoringPicking();
      return;
    }
    clearSelection();
    return;
  }
  if ((event.key === "Delete" || event.key === "Backspace") && selectedElementIds.value.length > 0) {
    event.preventDefault();
    void requestSemanticDeletion();
    return;
  }
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
  if (selectedGeometryCount.value === 0 || props.readOnly) return;
  event.preventDefault();
  changeGeometryBatch(translateSelection(
    scene.value,
    selectedElementIds.value,
    movement,
    {
      grid: { enabled: false, size: snapSettings.value.grid.size },
      targets: { enabled: false, tolerance: snapSettings.value.targets.tolerance },
    },
  ), true);
}

function openAddViewDialog(): void {
  const parentMode = viewDialogMode.value === "manage" ? "manage" : undefined;
  viewForm.value = {
    viewId: allocateViewId("view"),
    profileToken: profileTokenForRef(activeView.value?.profileRef),
    layoutRef: standardLayoutRefForDirection("LR"),
    layoutDirection: "LR",
    locale: activeView.value?.locale ?? "",
  };
  openViewDialog("add", parentMode);
}

function openManageViewDialog(): void {
  viewDeleteConfirmation.value = false;
  openViewDialog("manage");
}

function openConfigureViewDialog(): void {
  const parentMode = viewDialogMode.value === "manage" ? "manage" : undefined;
  const view = activeView.value;
  if (!view) return;
  viewForm.value = {
    viewId: view.viewId,
    profileToken: profileTokenForRef(view.profileRef),
    layoutRef: view.layoutRef,
    layoutDirection: layoutDirectionForRef(view.layoutRef) ?? "",
    locale: view.locale ?? "",
  };
  openViewDialog("configure", parentMode);
}

function closeViewDialog(): void {
  if (viewCommandBusy.value) return;
  finishViewDialog();
}

function openViewDialog(
  mode: "manage" | "add" | "configure",
  parentMode?: "manage",
): void {
  if (!viewDialogMode.value) {
    viewDialogReturnFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : undefined;
  }
  viewDialogParentMode.value = parentMode;
  viewDialogMode.value = mode;
  void nextTick(() => {
    viewDialogInitialFocus.value?.focus();
  });
}

function finishViewDialog(): void {
  if (viewDialogMode.value !== "manage" && viewDialogParentMode.value === "manage") {
    viewDialogMode.value = "manage";
    viewDialogParentMode.value = undefined;
    viewDeleteConfirmation.value = false;
    void nextTick(() => viewDialogInitialFocus.value?.focus());
    return;
  }
  viewDialogMode.value = undefined;
  viewDialogParentMode.value = undefined;
  viewDeleteConfirmation.value = false;
  const returnTarget = viewDialogReturnFocus;
  viewDialogReturnFocus = undefined;
  void nextTick(() => {
    if (returnTarget?.isConnected) returnTarget.focus();
  });
}

function handleViewDialogKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    closeViewDialog();
    return;
  }
  if (event.key !== "Tab") return;
  const controls = [...(viewDialog.value?.querySelectorAll<HTMLElement>(
    "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])",
  ) ?? [])].filter((element) => !element.hasAttribute("hidden"));
  if (controls.length === 0) return;
  const current = controls.indexOf(document.activeElement as HTMLElement);
  const next = event.shiftKey
    ? current <= 0 ? controls.at(-1)! : controls[current - 1]!
    : current < 0 || current === controls.length - 1 ? controls[0]! : controls[current + 1]!;
  event.preventDefault();
  next.focus();
}

async function submitViewDialog(): Promise<void> {
  const form = viewForm.value;
  const profileRef = profileRefForToken(form.profileToken);
  if (!profileRef) return;
  const layoutRef = form.layoutDirection
    ? viewDialogMode.value === "add"
      ? standardLayoutRefForDirection(form.layoutDirection)
      : layoutRefForDirection(form.layoutRef, form.layoutDirection) ?? form.layoutRef
    : form.layoutRef;
  const command: ViewCommand = viewDialogMode.value === "add"
    ? {
        command: "add",
        viewId: form.viewId,
        profileRef,
        layoutRef,
        ...(form.locale.trim() ? { locale: form.locale.trim() } : {}),
      }
    : {
        command: "configure",
        viewId: form.viewId,
        profileRef,
        layoutRef,
        locale: form.locale.trim() || null,
      };
  if (await executeViewCommand(command)) finishViewDialog();
}

async function duplicateActiveView(): Promise<void> {
  const view = activeView.value;
  if (!view) return;
  await executeViewCommand({
    command: "duplicate",
    sourceViewId: view.viewId,
    viewId: allocateViewId(`${view.viewId}-copy`),
  });
}

async function deleteActiveView(): Promise<void> {
  const view = activeView.value;
  if (!view) return;
  await executeViewCommand({ command: "delete", viewId: view.viewId });
}

function requestActiveViewDeletion(): void {
  if (draft.value.views.length <= 1) return;
  viewDeleteConfirmation.value = true;
}

async function confirmActiveViewDeletion(): Promise<void> {
  await deleteActiveView();
  viewDeleteConfirmation.value = false;
}

async function resetActiveViewOverlay(): Promise<void> {
  const view = activeView.value;
  if (!view) return;
  await executeViewCommand({ command: "reset-overlay", viewId: view.viewId });
}

async function executeViewCommand(command: ViewCommand): Promise<boolean> {
  if (props.readOnly || viewCommandBusy.value) return false;
  if (turtlePending.value || structuredAuthoringPending.value || overlayPending.value) {
    applyDiagnostics.value = [{
      severity: "error",
      category: "projection",
      code: "view-command-semantic-draft-pending",
      message: "未適用のsemanticまたはView overlay draftを適用または破棄してからviewを変更してください。",
    }];
    return false;
  }
  const runtime = projectionRuntimeContext.value;
  if (!runtime) {
    applyDiagnostics.value = [{
      severity: "error",
      category: "profile",
      code: "projection-runtime-context-missing",
      message: "ProjectionRuntimeContextが提供されていません。",
    }];
    return false;
  }
  const requestToken = ++viewCommandRequestToken;
  viewCommandAbortController?.abort();
  const controller = new AbortController();
  viewCommandAbortController = controller;
  const previous = clone(draft.value);
  const previousJson = JSON.stringify(previous);
  viewCommandBusy.value = true;
  let result;
  try {
    result = await applyViewCommand(previous, command, runtime, { signal: controller.signal });
  } catch (cause) {
    if (requestToken !== viewCommandRequestToken || controller.signal.aborted) return false;
    applyDiagnostics.value = [{
      severity: "error",
      category: "projection",
      code: "view-command-failed",
      message: cause instanceof Error ? cause.message : String(cause),
    }];
    return false;
  } finally {
    if (requestToken === viewCommandRequestToken) {
      viewCommandBusy.value = false;
      viewCommandAbortController = undefined;
    }
  }
  if (
    requestToken !== viewCommandRequestToken
    || controller.signal.aborted
    || JSON.stringify(draft.value) !== previousJson
  ) return false;
  applyDiagnostics.value = result.diagnostics;
  if (!result.accepted) return false;

  saveActiveViewSession();
  let nextViewId = currentActiveViewId.value;
  let controlledViewRequest: string | undefined;
  if (command.command === "delete") {
    viewSessions.delete(command.viewId);
    nextViewId = resolveActiveViewId(result.document, nextViewId);
  } else if (command.command === "add" || command.command === "duplicate") {
    const requestedViewId = result.affectedViewId ?? nextViewId;
    if (props.activeViewId === undefined) nextViewId = requestedViewId;
    else controlledViewRequest = requestedViewId;
  }
  const viewChanged = nextViewId !== currentActiveViewId.value;
  currentActiveViewId.value = nextViewId;
  if (viewChanged) {
    emit("update:activeViewId", nextViewId);
  }
  if (viewChanged) rawScene.value = emptyScene(nextViewId);
  restoreActiveViewSession();
  await publish(
    result.document,
    true,
    command.command === "reset-overlay" ? "presentation" : "semantic",
  );
  if (controlledViewRequest) emit("update:activeViewId", controlledViewRequest);
  if (currentActiveViewId.value === nextViewId) {
    await nextTick();
    await diagramCanvas.value?.restoreViewport(sessionFor(nextViewId).viewport);
  }
  return true;
}

function cancelViewCommandRequest(): void {
  viewCommandRequestToken += 1;
  viewCommandAbortController?.abort();
  viewCommandAbortController = undefined;
  viewCommandBusy.value = false;
}

function allocateViewId(base: string): string {
  const existing = new Set(draft.value.views.map((view) => view.viewId));
  if (!existing.has(base)) return base;
  let suffix = 2;
  while (existing.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

function hideSelectionTemporarily(): void {
  const session = sessionFor(currentActiveViewId.value);
  for (const elementId of selectedElementIds.value) {
    session.temporaryHiddenElementIds.add(elementId);
  }
  viewSessionRevision.value += 1;
  clearSelection();
}

function showAllTemporaryHidden(): void {
  const session = sessionFor(currentActiveViewId.value);
  if (session.temporaryHiddenElementIds.size === 0) return;
  session.temporaryHiddenElementIds.clear();
  viewSessionRevision.value += 1;
}

function mutateDocument(
  mutation: (document: IriographDocument) => void,
  recordHistory = true,
): Promise<void> | undefined {
  if (props.readOnly) return;
  const next = clone(draft.value);
  mutation(next);
  if (JSON.stringify(next) === JSON.stringify(draft.value)) return;
  return publish(next, recordHistory, "presentation");
}

function publish(
  next: IriographDocument,
  recordHistory: boolean,
  refreshKind: DocumentRefreshKind,
  preparedScene?: DiagramScene,
): Promise<void> {
  invalidateAuthoringPreview();
  if (refreshKind === "semantic") typeHighlightElementIds.value = [];
  if (recordHistory) {
    history.value.push(clone(draft.value));
    trimHistory();
    future.value = [];
  }
  localDocumentRevision += 1;
  draft.value = clone(next);
  lastEmittedJson = JSON.stringify(draft.value);
  emit("update:modelValue", clone(draft.value));
  return refreshKind === "presentation"
    ? refreshPresentationScene()
    : preparedScene ? refreshPreparedScene(preparedScene) : refreshScene();
}

function replaceDraft(next: IriographDocument, preserveTurtleDraft = false): void {
  invalidateAuthoringPreview();
  saveActiveViewSession();
  const pendingTurtle = turtleDraft.value;
  const refreshKind = documentRefreshKind(draft.value, next);
  if (refreshKind === "semantic") typeHighlightElementIds.value = [];
  localDocumentRevision += 1;
  draft.value = clone(next);
  const nextViewId = resolveActiveViewId(draft.value, currentActiveViewId.value);
  if (nextViewId !== currentActiveViewId.value) {
    currentActiveViewId.value = nextViewId;
    emit("update:activeViewId", nextViewId);
    rawScene.value = emptyScene(nextViewId);
    restoreActiveViewSession();
  }
  turtleDraft.value = preserveTurtleDraft ? pendingTurtle : next.semantic.source;
  applyDiagnostics.value = [];
  lastEmittedJson = JSON.stringify(draft.value);
  emit("update:modelValue", clone(draft.value));
  if (refreshKind === "presentation") void refreshPresentationScene();
  else void refreshScene();
}

function documentRefreshKind(
  previous: IriographDocument,
  next: IriographDocument,
): DocumentRefreshKind {
  const withoutOverlay = (document: IriographDocument) => ({
    ...document,
    views: document.views.map((view) => ({ ...view, overlay: {} })),
  });
  return JSON.stringify(withoutOverlay(previous)) === JSON.stringify(withoutOverlay(next))
    ? "presentation"
    : "semantic";
}

function geometryBaselineKey(documentId: string, viewId: string): string {
  return `${documentId}\u0000${viewId}`;
}

function documentWithoutExplicitGroupFrameGeometry(
  document: IriographDocument,
  viewId: string,
  runtime: ProjectionRuntimeContext,
): IriographDocument | undefined {
  const view = document.views.find((candidate) => candidate.viewId === viewId);
  const profile = view ? runtime.catalogsByProfile.get(view.profileRef) : undefined;
  if (!view || !profile) return undefined;
  const projected = projectSemanticView(
    document,
    profile.catalog,
    viewId,
    runtime.projectionOptions,
  );
  const groupIds = new Set([
    ...projected.containers.filter((element) => element.groupFrame).map((element) => element.elementId),
    ...(projected.regions ?? []).filter((element) => element.groupFrame).map((element) => element.elementId),
  ]);
  const explicitIds = [...groupIds].filter((elementId) => view.overlay[elementId]?.geometry);
  if (explicitIds.length === 0) return undefined;
  const baseline = clone(document);
  const baselineView = baseline.views.find((candidate) => candidate.viewId === viewId)!;
  for (const elementId of explicitIds) {
    const entry = baselineView.overlay[elementId];
    if (!entry) continue;
    delete entry.geometry;
    delete entry.pinned;
    delete entry.placement;
  }
  return baseline;
}

function rememberGeneratedGeometryBaselines(
  documentId: string,
  viewId: string,
  value: DiagramScene,
): void {
  const baselines: Record<string, ElementGeometry> = {};
  for (const element of [
    ...value.nodes,
    ...value.containers,
    ...(value.regions ?? []),
  ]) {
    if (element.placement === "generated") baselines[element.elementId] = roundGeometry(element.geometry);
  }
  generatedGeometryBaselines.set(geometryBaselineKey(documentId, viewId), baselines);
}

function generatedGeometryBaseline(elementId: string): ElementGeometry | undefined {
  const baseline = generatedGeometryBaselines.get(geometryBaselineKey(
    draft.value.documentId,
    currentActiveViewId.value,
  ))?.[elementId];
  return baseline ? { ...baseline } : undefined;
}

function setGeneratedGeometryBaseline(elementId: string, geometry: ElementGeometry): void {
  const key = geometryBaselineKey(draft.value.documentId, currentActiveViewId.value);
  const values = generatedGeometryBaselines.get(key) ?? {};
  generatedGeometryBaselines.set(key, {
    ...values,
    [elementId]: roundGeometry(geometry),
  });
}

function sceneWithGeneratedGeometryBaselines(
  value: DiagramScene,
  documentId: string,
  viewId: string,
  overlay: Readonly<Record<string, ViewElementOverlay>>,
): DiagramScene {
  const baselines = generatedGeometryBaselines.get(geometryBaselineKey(documentId, viewId));
  if (!baselines) return value;
  const apply = <T extends SceneNode | SceneContainer | SceneRegion>(element: T): T => {
    // A removed user geometry is the explicit "reset to automatic" transition.
    // Generated elements may legitimately differ from this stored reset baseline
    // and presentation-only edits must preserve their current geometry.
    const baseline = element.placement === "user" && !overlay[element.elementId]?.geometry
      ? baselines[element.elementId]
      : undefined;
    return baseline ? { ...element, geometry: { ...baseline } } : element;
  };
  return {
    ...value,
    nodes: value.nodes.map(apply),
    containers: value.containers.map(apply),
    regions: value.regions?.map(apply),
  };
}

function geometryElement(elementId: string): GeometryElement | undefined {
  return [...scene.value.nodes, ...scene.value.containers, ...(scene.value.regions ?? [])]
    .find((element) => element.elementId === elementId);
}

function trimHistory(): void {
  if (history.value.length > 100) history.value.splice(0, history.value.length - 100);
}

function setZoomState(value: number): void {
  zoom.value = normalizeDiagramZoom(value);
  sessionFor(currentActiveViewId.value).viewport.zoom = zoom.value;
}

function toggleLeftSidebar(): void {
  leftSidebarCollapsed.value = !leftSidebarCollapsed.value;
}

function toggleRightSidebar(): void {
  rightSidebarCollapsed.value = !rightSidebarCollapsed.value;
}

function setCanvasDragMode(mode: CanvasDragMode): void {
  canvasDragMode.value = mode;
  sessionFor(currentActiveViewId.value).dragMode = mode;
}

async function zoomTo(value: number): Promise<void> {
  if (panel.value !== "diagram") {
    panel.value = "diagram";
    await nextTick();
  }
  if (diagramCanvas.value) await diagramCanvas.value.zoomTo(value);
  else setZoomState(value);
}

function panBy(deltaX: number, deltaY: number): void {
  if (panel.value === "diagram") {
    diagramCanvas.value?.panBy(deltaX, deltaY);
    return;
  }
  panel.value = "diagram";
  void nextTick(() => diagramCanvas.value?.panBy(deltaX, deltaY));
}

async function fitToView(): Promise<void> {
  if (panel.value !== "diagram") {
    panel.value = "diagram";
    await nextTick();
  }
  await diagramCanvas.value?.fitToView();
}

async function fitToSelection(): Promise<boolean> {
  if (selectedElementIds.value.length === 0) return false;
  if (panel.value !== "diagram") {
    panel.value = "diagram";
    await nextTick();
  }
  return await diagramCanvas.value?.fitToSelection(selectedElementIds.value) ?? false;
}

async function handleZoomListChange(event: Event): Promise<void> {
  const value = (event.target as HTMLSelectElement).value;
  if (value === "fit:view") {
    await fitToView();
    return;
  }
  if (value === "fit:selection") {
    await fitToSelection();
    return;
  }
  if (value.startsWith("zoom:")) await zoomTo(Number(value.slice(5)));
}

async function revealSelection(): Promise<boolean> {
  if (!selectedElementId.value) return false;
  if (panel.value !== "diagram") {
    panel.value = "diagram";
    await nextTick();
  }
  return await diagramCanvas.value?.revealElement(selectedElementId.value) ?? false;
}

async function focusElement(elementId: string): Promise<boolean> {
  const exists = [
    ...scene.value.nodes,
    ...scene.value.containers,
    ...(scene.value.regions ?? []),
    ...scene.value.edges,
  ].some((element) => element.elementId === elementId);
  if (!exists) return false;
  selectElement(elementId);
  return revealSelection();
}

function diagnosticTargetsElement(
  diagnostic: ProjectionDiagnostic,
  element: SelectedElement,
): boolean {
  if (element.structuralKind !== "region") return diagnosticTargetsSceneElement(diagnostic, element);
  if (diagnostic.semanticRef === element.semanticRef) return true;
  return Boolean(diagnostic.statementRef
    && element.provenance?.sourceStatementRefs.includes(diagnostic.statementRef));
}

function sceneElementForDiagnostic(diagnostic: ProjectionDiagnostic): SelectedElement | undefined {
  return [...scene.value.containers, ...(scene.value.regions ?? []), ...scene.value.nodes, ...scene.value.edges]
    .find((element) => diagnosticTargetsElement(diagnostic, element));
}

async function navigateDiagnosticToScene(diagnostic: ProjectionDiagnostic): Promise<void> {
  const element = sceneElementForDiagnostic(diagnostic);
  if (element) await focusElement(element.elementId);
}

async function navigateDiagnosticToSource(diagnostic: ProjectionDiagnostic): Promise<void> {
  const location = diagnostic.sourceLocation;
  if (!location || !canNavigateDiagnosticToSource(diagnostic)) return;
  panel.value = "turtle";
  await nextTick();
  const textarea = turtleTextarea.value;
  if (!textarea) return;
  textarea.focus();
  textarea.setSelectionRange(location.startOffset, location.endOffset);
}

function canNavigateDiagnosticToSource(diagnostic: ProjectionDiagnostic): boolean {
  return diagnostic.sourceLocation !== undefined
    && diagnostic.sourceFingerprint === semanticSourceFingerprint(turtleDraft.value);
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

function roundCurveRouting(curve: EdgeCurveRouting): EdgeCurveRouting {
  return {
    ...(curve.sourceHandle ? { sourceHandle: roundCurvePoint(curve.sourceHandle) } : {}),
    ...(curve.targetHandle ? { targetHandle: roundCurvePoint(curve.targetHandle) } : {}),
    ...(curve.knots?.length ? {
      knots: curve.knots.map((knot) => ({
        point: roundCurvePoint(knot.point),
        ...(knot.incomingHandle ? { incomingHandle: roundCurvePoint(knot.incomingHandle) } : {}),
        ...(knot.outgoingHandle ? { outgoingHandle: roundCurvePoint(knot.outgoingHandle) } : {}),
        ...(knot.extensions ? { extensions: clone(knot.extensions) } : {}),
      })),
    } : {}),
    ...(curve.extensions ? { extensions: clone(curve.extensions) } : {}),
  };
}

function roundCurvePoint(point: Point): Point {
  return {
    ...roundPoint(point),
    ...(point.extensions ? { extensions: clone(point.extensions) } : {}),
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(value, maximum));
}

function compactRef(value: string): string {
  const segments = value.split(/[/:#]/).filter(Boolean);
  const last = segments.at(-1) ?? value;
  return /^v?\d+(?:\.\d+)*$/.test(last)
    ? segments.at(-2) ?? last
    : last;
}

function fileNameFromPath(path: string): string {
  return path.split("/").filter(Boolean).at(-1) ?? "画像";
}

function templateDisplayLabel(template: VisualTemplate, fallbackOrdinal?: number): string {
  const token = compactRef(template.templateRef);
  const labels: Record<string, string> = {
    generic: "汎用",
    choice: "判断",
    class: "概念",
    property: "関係定義",
    "start-event": "開始",
    "user-task": "人の作業",
    "service-task": "自動処理",
    gateway: "分岐",
    "end-event": "終了",
    reference: "参照",
    lane: "領域",
    region: "領域",
    sequence: "順序グループ",
  };
  return labels[token] ?? `表示形式${fallbackOrdinal ? ` ${fallbackOrdinal}` : ""}`;
}

function templateShapeLabel(template: VisualTemplate): string {
  if (template.structuralKind === "container") return "枠でまとめる";
  if (template.structuralKind === "region") return "重なり領域";
  return {
    rectangle: "四角",
    "rounded-rectangle": "角丸",
    circle: "円",
    diamond: "ひし形",
  }[template.shape ?? "rounded-rectangle"];
}

function templatePreviewIconUrl(template: VisualTemplate): string | undefined {
  return template.iconRef ? packageDefaultIconDataUrl(template.iconRef) : undefined;
}

function assetDefinitionLabel(extensions: Record<string, unknown> | undefined): string | undefined {
  const value = Object.entries(extensions ?? {}).find(([key]) => key.endsWith("#label"))?.[1];
  return typeof value === "string" ? value : undefined;
}

function packageIconPreviewUrl(assetRef: string): string | undefined {
  return packageDefaultIconDataUrl(assetRef);
}

function availableAssetDefinitions(catalog: ProjectionCatalogV1): Record<string, AssetDefinition> {
  return { ...catalog.assets, ...packageDefaultIconAssets };
}

function isTextInput(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest([
    "input",
    "textarea",
    "select",
    "[contenteditable]:not([contenteditable='false'])",
  ].join(",")));
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

function userFacingTransactionDiagnostics(
  diagnostics: readonly ProjectionDiagnostic[],
): ProjectionDiagnostic[] {
  // A successful route-only fallback is operational telemetry, not a failed
  // placement that the user must repair. Keep it in Core results/observers,
  // but do not render it with the generic layout-warning guidance.
  return clone(diagnostics.filter((diagnostic) => !(
    diagnostic.category === "layout" && diagnostic.severity === "info"
  )));
}

function clone<T>(value: T): T {
  // v-modelから受け取る値はVue Proxyになり得ます。documentはJSON contractなので、
  // cloneと同時にplain dataへ戻してeditor内部へProxyを持ち込みません。
  if (value === undefined) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}

defineExpose<IriographEditorNavigationApi & IriographEditorSelectionApi & {
  flushPendingEdits(): Promise<boolean>;
  undo(): void;
  redo(): void;
}>({
  flushPendingEdits,
  undo,
  redo,
  selectElement,
  selectElements,
  clearSelection,
  selectAll,
  setSnapSettings,
  panBy,
  zoomTo,
  fitToView,
  revealSelection,
  focusElement,
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
          {{ errorCount > 0 ? `問題 ${errorCount}件` : "検証済み" }}
        </span>
        <button type="button" :disabled="!canSave || saving || applyingTurtle || applyingOverlay || authoringBusy" @click="requestSave">
          {{ saving ? "保存中…" : "保存" }}
        </button>
      </div>
    </header>

    <div
      class="iriograph-editor-layout"
      :class="{
        'left-sidebar-collapsed': leftSidebarCollapsed,
        'right-sidebar-collapsed': rightSidebarCollapsed,
      }"
    >
      <button
        type="button"
        class="iriograph-sidebar-toggle iriograph-left-sidebar-toggle"
        :aria-label="leftSidebarCollapsed ? '左サイドバーを開く' : '左サイドバーを閉じる'"
        :aria-expanded="!leftSidebarCollapsed"
        :aria-controls="leftSidebarId"
        @click="toggleLeftSidebar"
      >{{ leftSidebarCollapsed ? '›' : '‹' }}</button>
      <aside v-show="!leftSidebarCollapsed" :id="leftSidebarId" class="iriograph-elements-panel">
        <section class="iriograph-view-summary">
          <small>表示中のビュー</small>
          <select
            v-if="draft.views.length > 1"
            :value="activeView?.viewId ?? ''"
            :disabled="viewCommandBusy"
            aria-label="名前付きビュー"
            @change="requestActiveView"
          >
            <option v-for="view in draft.views" :key="view.viewId" :value="view.viewId">
              {{ view.viewId }}
            </option>
          </select>
          <strong v-else class="iriograph-single-view-name" aria-label="名前付きビュー">{{ activeView?.viewId }}</strong>
          <button type="button" class="iriograph-view-manage-button" aria-label="ビューを管理" :disabled="viewCommandBusy" @click="openManageViewDialog">…</button>
          <div>
            <span><b>{{ scene.nodes.length }}</b> 要素</span>
            <span><b>{{ scene.edges.length }}</b> 関係</span>
            <span><b>{{ scene.containers.length + (scene.regions?.length ?? 0) }}</b> 領域</span>
          </div>
        </section>
        <nav class="iriograph-element-list" aria-label="図の要素">
          <small>図の要素</small>
          <button
            v-for="container in scene.containers"
            :key="container.elementId"
            type="button"
            :class="{ active: selectedElementIdsSet.has(container.elementId) }"
            @click="selectAndReveal(container.elementId, $event)"
          >
            <i>▣</i><span><b>{{ container.label }}</b><small>領域</small></span>
          </button>
          <button
            v-for="node in scene.nodes"
            :key="node.elementId"
            type="button"
            :class="{ active: selectedElementIdsSet.has(node.elementId) }"
            @click="selectAndReveal(node.elementId, $event)"
          >
            <i>●</i><span><b>{{ node.label }}</b><small>要素</small></span>
          </button>
        </nav>
        <details class="iriograph-fallback-note"><summary>技術情報</summary><p>表示規則に未登録の関係は通常矢印で表示します。</p></details>
      </aside>

      <main class="iriograph-main-surface">
        <nav class="iriograph-view-tabs" aria-label="図と型・source表示を切り替え" role="group">
          <button type="button" :class="{ active: panel === 'diagram' }" :aria-pressed="panel === 'diagram'" @click="panel = 'diagram'">図</button>
          <button type="button" :class="{ active: panel === 'types' }" :aria-pressed="panel === 'types'" @click="panel = 'types'">型一覧</button>
          <button type="button" :class="{ active: panel === 'turtle' }" :aria-pressed="panel === 'turtle'" @click="panel = 'turtle'">≡ Turtle</button>
          <button type="button" :class="{ active: panel === 'document' }" :aria-pressed="panel === 'document'" @click="panel = 'document'">{ } Document</button>
        </nav>

        <section v-show="panel === 'diagram'" class="iriograph-diagram-panel">
          <div class="iriograph-canvas-toolbar">
            <div class="iriograph-history-actions">
              <button type="button" :disabled="!canUndo || readOnly" title="Undo (Ctrl/Cmd+Z)" @click="undo">↶</button>
              <button type="button" :disabled="!canRedo || readOnly" title="Redo (Ctrl/Cmd+Y)" @click="redo">↷</button>
              <span />
              <small>{{ layoutPurposeLabel(activeView?.layoutRef) }}</small>
            </div>
            <div class="iriograph-drag-mode-actions" role="group" aria-label="Canvasドラッグモード">
              <button type="button" :aria-pressed="canvasDragMode === 'select'" title="空白や枠内をドラッグして範囲選択" @click="setCanvasDragMode('select')">範囲選択</button>
              <button type="button" :aria-pressed="canvasDragMode === 'pan'" title="空白や枠内をドラッグしてCanvasを移動" @click="setCanvasDragMode('pan')">移動</button>
            </div>
            <div class="iriograph-navigation-actions">
              <button
                type="button"
                :aria-pressed="showAllComments"
                :title="showAllComments ? '説明をhover時だけ表示' : 'すべての説明を表示'"
                @click="showAllComments = !showAllComments"
              >{{ showAllComments ? '説明を隠す' : '説明を表示' }}</button>
              <button type="button" aria-label="全体を表示" title="Fit to view" @click="fitToView">▣</button>
              <button
                type="button"
                aria-label="選択要素へ移動"
                title="選択要素をviewportへ表示"
                :disabled="!selectedElementId"
                @click="revealSelection"
              >
                ◎
              </button>
            </div>
            <div class="iriograph-zoom-actions">
              <button type="button" aria-label="縮小" @click="zoomTo(zoom - 0.1)">−</button>
              <button type="button" class="zoom-value" @click="zoomTo(1)">{{ Math.round(zoom * 100) }}%</button>
              <button type="button" aria-label="拡大" @click="zoomTo(zoom + 0.1)">＋</button>
              <select aria-label="Canvas倍率" :value="zoomListValue" @change="handleZoomListChange">
                <option v-if="zoomListValue.startsWith('current:')" :value="zoomListValue">{{ Math.round(zoom * 100) }}%</option>
                <option v-for="preset in zoomPresets" :key="preset" :value="`zoom:${preset}`">{{ Math.round(preset * 100) }}%</option>
                <option value="fit:view">全体を表示</option>
                <option value="fit:selection" :disabled="selectedElementIds.length === 0">選択へfit</option>
              </select>
            </div>
          </div>
          <div class="iriograph-selection-toolbar" aria-label="選択・配置ツール">
            <div class="iriograph-selection-actions">
              <span aria-live="polite">{{ selectedElementIds.length }} selected</span>
              <button type="button" aria-label="すべて選択" title="Select all (Ctrl/Cmd+A)" @click="selectAll">全選択</button>
              <button type="button" aria-label="選択を解除" title="Clear selection (Escape)" :disabled="selectedElementIds.length === 0" @click="clearSelection">解除</button>
              <button type="button" :disabled="selectedElementIds.length === 0" @click="hideSelectionTemporarily">一時非表示</button>
              <button type="button" :disabled="temporaryHiddenCount === 0" @click="showAllTemporaryHidden">
                再表示<span v-if="temporaryHiddenCount"> ({{ temporaryHiddenCount }})</span>
              </button>
            </div>
            <div class="iriograph-arrange-actions">
              <button type="button" aria-label="左揃え" :disabled="!canAlignSelection" @click="alignSelected('left')">左</button>
              <button type="button" aria-label="左右中央揃え" :disabled="!canAlignSelection" @click="alignSelected('center')">↔中</button>
              <button type="button" aria-label="右揃え" :disabled="!canAlignSelection" @click="alignSelected('right')">右</button>
              <button type="button" aria-label="上揃え" :disabled="!canAlignSelection" @click="alignSelected('top')">上</button>
              <button type="button" aria-label="上下中央揃え" :disabled="!canAlignSelection" @click="alignSelected('middle')">↕中</button>
              <button type="button" aria-label="下揃え" :disabled="!canAlignSelection" @click="alignSelected('bottom')">下</button>
              <button type="button" aria-label="水平方向に等間隔" :disabled="!canDistributeSelection" @click="distributeSelected('horizontal')">横等間隔</button>
              <button type="button" aria-label="垂直方向に等間隔" :disabled="!canDistributeSelection" @click="distributeSelected('vertical')">縦等間隔</button>
            </div>
            <div class="iriograph-snap-actions" aria-label="スナップ設定">
              <button
                type="button"
                aria-label="グリッドsnap"
                :aria-pressed="snapSettings.grid.enabled"
                @click="setSnapSettings({ grid: { ...snapSettings.grid, enabled: !snapSettings.grid.enabled } })"
              >グリッド</button>
              <input
                type="number"
                min="1"
                max="128"
                :value="snapSettings.grid.size"
                aria-label="グリッドサイズ"
                @change="updateSnapGridSize"
              />
              <button
                type="button"
                aria-label="要素snap"
                :aria-pressed="snapSettings.targets.enabled"
                @click="setSnapSettings({ targets: { ...snapSettings.targets, enabled: !snapSettings.targets.enabled } })"
              >要素</button>
            </div>
          </div>
          <div
            v-if="sceneLoading || sceneError"
            class="iriograph-scene-status"
            :class="{ error: !sceneLoading && sceneError }"
            :role="!sceneLoading && sceneError ? 'alert' : 'status'"
            :aria-live="!sceneLoading && sceneError ? 'assertive' : 'polite'"
          >
            <b>{{ sceneLoading ? "図を更新中…" : "図を表示できません" }}</b>
            <span v-if="!sceneLoading && sceneError">{{ diagnosticGuidance(sceneError).title }} {{ diagnosticGuidance(sceneError).action }}</span>
          </div>
          <DiagramCanvas
            ref="diagramCanvas"
            :scene="renderedScene"
            :scene-session-key="`${draft.documentId}\u0000${currentActiveViewId}`"
            :selected-element-id="selectedElementId"
            :selected-element-ids="selectedElementIds"
            :zoom="zoom"
            :snap="snapSettings"
            :read-only="readOnly || sceneLoading || applyingTurtle || authoringBusy || portableDocumentPending || applyingPortableDocument"
            :busy="sceneLoading || applyingTurtle || authoringBusy || applyingPortableDocument"
            :semantic-position-picking="authoringDraft.positionPicking"
            :semantic-resource-picking="Boolean(authoringResourcePicker)"
            :semantic-resource-pick-label="authoringResourcePickerLabel"
            :structured-selection-picking="Boolean(structuredCanvasPicker)"
            :structured-selection-pick-label="structuredCanvasPicker?.role ?? '対象'"
            :semantic-draft-position="authoringDraftPosition"
            :containment-warning-element-ids="containmentWarningElementIds"
            :semantic-metadata="semanticMetadata"
            :show-all-comments="showAllComments"
            :show-grid="showCanvasGrid"
            :drag-mode="canvasDragMode"
            :edge-route-modes="edgeRouteModes"
            :node-content-editing="inspectorMode === 'appearance' && selectedElement?.structuralKind === 'node' && (isDisplayInspectorSectionOpen('appearance') || isDisplayInspectorSectionOpen('icon'))"
            :node-icon-grow-node="growNodeWithIcon"
            :semantic-endpoint-reconnect="inspectorMode === 'semantic' && Boolean(intentEdgeDetails && !intentEdgeDetails.derivedReason)"
            :deletion-preview-resource-refs="authoringDeletionPreview?.resourceSemanticRefs"
            :deletion-preview-statement-refs="authoringDeletionPreview?.statementRefs"
            :node-type-tags="nodeTypeTags"
            :type-highlight-element-ids="typeHighlightElementIds"
            @zoom-change="setZoomState"
            @selection-request="applySelectionRequest"
            @selection-set-request="selectElements"
            @gesture-start="beginGesture"
            @gesture-end="endGesture"
            @resize-change="changeGeometry"
            @geometry-batch-change="changeGeometryBatch"
            @routing-update="changeRouting"
            @node-content-offset-update="changeNodeContentOffset"
            @node-icon-presentation-update="changeNodeIconPresentation"
            @region-label-update="updateRegionLabelAnchor"
            @group-label-update="updateGroupLabelAnchor"
            @group-icon-offset-update="changeGroupIconOffset"
            @semantic-position-request="seedDraftPosition"
            @semantic-resource-request="seedDraftResource"
            @structured-selection-request="pickStructuredCanvasElement"
            @structured-selection-set-request="pickStructuredCanvasElements"
            @semantic-endpoint-reconnect-request="seedSemanticEdgeEndpoint"
            @semantic-edit-request="requestSemanticDeletion"
            @type-tag-request="openTypeListFromTag"
            @semantic-pick-cancel="cancelAuthoringPicking"
            @context-menu-request="openContextMenu"
          />
        </section>

        <section v-if="panel === 'types'" class="iriograph-type-list-surface">
          <TypeListPanel
            :presentation="typeSystemIndex.presentation"
            :focus="typeListFocus"
            :readonly="readOnly || !authoringEnabled || authoringBusy"
            @action="handleTypeSystemAction"
            @show-in-diagram="showTypeResourcesInDiagram"
          />
        </section>

        <section v-if="panel === 'turtle' || panel === 'document'" class="iriograph-source-panel">
          <header>
            <div>
              <small>{{ panel.toUpperCase() }}</small>
              <strong v-if="panel === 'turtle'">Semantic source</strong>
              <strong v-else>Portable document</strong>
            </div>
            <span v-if="panel === 'turtle'">LLM-visible boundary</span>
            <span v-else>意味とビュー設定</span>
          </header>
          <template v-if="panel === 'turtle'">
            <textarea
              ref="turtleTextarea"
              v-model="turtleDraft"
              :readonly="readOnly || structuredAuthoringPending || portableDocumentPending"
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
                <button type="button" class="primary" :disabled="!turtlePending || readOnly || applyingTurtle || structuredAuthoringPending" @click="applyTurtleDraft">
                  {{ applyingTurtle ? "適用中…" : semanticWarningConfirmation ? "警告を確認して適用" : "検証して適用" }}
                </button>
              </div>
            </footer>
            <ul v-if="diagnostics.length" class="iriograph-diagnostics">
              <li v-for="(diagnostic, index) in diagnostics" :key="diagnostic.diagnosticId ?? `${diagnostic.code}:${index}`" :class="diagnostic.severity">
                  <span><b>{{ diagnosticGuidance(diagnostic).title }}</b> {{ diagnosticGuidance(diagnostic).action }}<details><summary>技術的な詳細</summary><code>{{ diagnostic.code }}</code> {{ diagnosticGuidance(diagnostic).detail }}</details></span>
                <span class="iriograph-diagnostic-actions">
                  <button v-if="canNavigateDiagnosticToSource(diagnostic)" type="button" @click="navigateDiagnosticToSource(diagnostic)">ソースで確認</button>
                  <button v-if="sceneElementForDiagnostic(diagnostic)" type="button" @click="navigateDiagnosticToScene(diagnostic)">図で確認</button>
                </span>
              </li>
            </ul>
          </template>
          <template v-else>
            <section class="iriograph-document-sources">
              <section class="iriograph-document-semantic-summary" aria-label="意味の要約">
                <div><small>意味の正本</small><strong>{{ semanticDocumentSummary.resources }}要素・{{ semanticDocumentSummary.statements }}文</strong><span>{{ semanticDocumentSummary.views }} 名前付きビュー</span></div>
                <p>Turtle全文の重複表示はしません。意味の編集と検証はTurtleタブで行います。</p>
                <button type="button" @click="panel = 'turtle'">Turtleタブを開く</button>
              </section>
              <section class="iriograph-document-identity-actions" aria-label="文書のコピー">
                <div><strong>文書をコピー</strong><small>同じ文書のJSONコピーはidentityを維持します。別の図として使う場合だけ文書内の識別子を安全に付け替えます。</small></div>
                <button type="button" @click="copyPortableDocument">同じ文書JSONをコピー</button>
                <button type="button" :disabled="Boolean(documentRebaseBlockedReason) || allocatingDocumentIdentity" :title="documentRebaseBlockedReason" @click="prepareDocumentRebase">{{ allocatingDocumentIdentity ? '準備中…' : '新しい図として複製' }}</button>
                <small v-if="documentRebaseBlockedReason">{{ documentRebaseBlockedReason }}</small>
                <span v-if="portableDocumentCopyMessage" role="status">{{ portableDocumentCopyMessage }}</span>
              </section>
              <details class="iriograph-document-source-section" open>
                <summary><span>View overlay</span><small>{{ activeView?.viewId }}の表示差分。Turtleは変更しません。</small></summary>
                <section class="iriograph-overlay-source">
                  <textarea
                    v-model="activeOverlayDraft"
                    :readonly="readOnly || applyingOverlay || structuredAuthoringPending || portableDocumentPending"
                    spellcheck="false"
                    aria-label="View overlay JSON"
                  />
                  <footer class="iriograph-source-actions">
                    <div><span v-if="overlayEditorIssues.length" class="error">{{ overlayEditorIssues.length }} error</span><span v-if="overlayPending">未適用のView overlay draft</span></div>
                    <div><button type="button" :disabled="readOnly || applyingOverlay" @click="formatActiveOverlayDraft">JSONを整形</button><button type="button" :disabled="!overlayDraftTouched[activeView?.viewId ?? ''] || applyingOverlay" @click="revertActiveOverlayDraft">元に戻す</button><button type="button" class="primary" :disabled="!overlayDraftTouched[activeView?.viewId ?? ''] || readOnly || applyingOverlay || structuredAuthoringPending || portableDocumentPending" @click="applyOverlayDrafts()">{{ applyingOverlay ? "適用中…" : "検証して適用" }}</button></div>
                  </footer>
                  <ul v-if="overlayEditorIssues.length" class="iriograph-diagnostics iriograph-overlay-diagnostics" role="alert"><li v-for="(issue, index) in overlayEditorIssues" :key="`${issue.path}:${index}`" class="error"><span><b>{{ issue.path }}</b> {{ issue.message }}<small>{{ issue.action }}</small></span></li></ul>
                </section>
              </details>
              <details class="iriograph-document-source-section" open>
                <summary><span>文書全体</span><small>コピー・貼り付け用のJSON。意味と全名前付きビューを一括置換します。</small></summary>
                <section class="iriograph-document-boundary">
                  <textarea
                    :value="portableDocumentDraft"
                    :readonly="readOnly || applyingPortableDocument || structuredAuthoringPending || turtlePending || overlayPending"
                    spellcheck="false"
                    aria-label="Portable document JSON"
                    @input="updatePortableDocumentDraft(($event.target as HTMLTextAreaElement).value)"
                  />
                  <footer class="iriograph-source-actions"><div><span v-if="portableDocumentEditorIssues.length" class="error">{{ portableDocumentEditorIssues.length }}件のエラー</span><span v-if="portableDocumentPending">文書全体に未適用の変更があります</span></div><div><button type="button" :disabled="readOnly || applyingPortableDocument" @click="formatPortableDocumentDraft">JSONを整形</button><button type="button" :disabled="!portableDocumentDraftTouched || applyingPortableDocument" @click="revertPortableDocumentDraft">元に戻す</button><button type="button" class="primary" :disabled="!portableDocumentPending || readOnly || applyingPortableDocument || structuredAuthoringPending || turtlePending || overlayPending" @click="applyPortableDocumentDraft">{{ applyingPortableDocument ? '全ビューを検証中…' : '文書全体を検証して適用' }}</button></div></footer>
                  <ul v-if="portableDocumentEditorIssues.length" class="iriograph-diagnostics iriograph-overlay-diagnostics" role="alert"><li v-for="(issue, index) in portableDocumentEditorIssues" :key="`${issue.path}:${index}`" class="error"><span><b>{{ issue.path }}</b> {{ issue.message }}<small>{{ issue.action }}</small></span></li></ul>
                </section>
              </details>
            </section>
          </template>
        </section>
      </main>

      <aside v-show="!rightSidebarCollapsed" :id="rightSidebarId" class="iriograph-inspector">
        <nav class="iriograph-inspector-mode-tabs" aria-label="編集する情報">
          <button type="button" :class="{ selected: inspectorMode === 'semantic' }" :aria-pressed="inspectorMode === 'semantic'" @click="inspectorMode = 'semantic'">意味</button>
          <button type="button" :class="{ selected: inspectorMode === 'appearance' }" :aria-pressed="inspectorMode === 'appearance'" @click="inspectorMode = 'appearance'">ビュー</button>
        </nav>
        <SemanticIntentPanel
          v-if="inspectorMode === 'semantic' && semanticDestination"
          ref="semanticIntentPanel"
          :enabled="authoringEnabled"
          :blocked-reason="authoringBlockedReason"
          :guidance="pendingAuthoringGuidance"
          :busy="authoringBusy"
          :resources="authoringResourceChoices"
          :selected-resources="selectedAuthoringResources"
          :selected-edge="intentEdgeDetails"
          :element-details="intentElementDetails"
          :classes="authoringClassChoices"
          :predicates="authoringEdgeChoices"
          :predicate-meanings="predicateMeanings"
          :predicate-inference-policy="predicateInferencePolicy"
          :default-locale="authoringContext?.defaultLocale"
          :memberships="intentMembershipOptions"
          :sequences="intentSequenceOptions"
          :alternatives="intentAlternativeOptions"
          :incident-relations="intentIncidentRelations"
          :membership-overview="intentMembershipOverview"
          :requested-intent="activeSemanticIntent"
          :picked-source-iri="authoringDraft.sourceIri"
          :picked-target-iri="authoringDraft.targetIri"
          :diagnostics="applyDiagnostics"
          @execute-draft="previewIntentDraft"
          @execute-commands="previewIntentCommands"
          @delete-selection="requestSemanticDeletion()"
          @cancel="cancelAuthoringDraft"
          @pick-resource="beginIntentResourcePicking"
          @use-self-target="useIntentSelfTarget"
          @focus-element="focusElement"
          @intent-change="activeSemanticIntent = $event"
          @draft-state-change="semanticIntentDraftPending = $event"
        />
        <template v-else-if="inspectorMode === 'semantic'">
          <section v-if="selectedElement" class="iriograph-semantic-selection-context" aria-label="Canvasの選択">
            <span><small>Canvasの選択</small><strong>{{ selectedElement.label }}</strong></span>
            <small>{{ selectedElementIds.length > 1 ? `${selectedElementIds.length}件を選択中。次の操作へまとめて引き継ぎます。` : '次の操作では、この対象を最初から選択済みにします。' }}</small>
          </section>
          <StructuredAuthoringWizard
            :state="structuredAuthoringState"
            :presentation="structuredPresentation"
            :predicate-hierarchy="structuredPredicateHierarchy"
            :canvas-options="structuredCanvasOptions"
            :request-id="structuredRequestId"
            :busy="authoringBusy"
            :read-only="readOnly"
            :disabled-reason="authoringBlockedReason"
            :guidance="pendingAuthoringGuidance"
            @transition="transitionStructuredAuthoring"
            @submit="submitStructuredAuthoring"
            @request-canvas-selection="requestStructuredCanvasSelection"
            @focus-destination="focusStructuredDestination"
          />
        </template>
        <div v-show="inspectorMode === 'appearance'" class="iriograph-display-inspector">
        <section class="iriograph-grid-visibility">
          <label><span>Canvasグリッド</span><button type="button" :aria-pressed="showCanvasGrid" @click="showCanvasGrid = !showCanvasGrid">{{ showCanvasGrid ? '表示中' : '非表示' }}</button></label>
          <small>Snap間隔 {{ snapSettings.grid.size }}。表示設定はファイルへ保存しません。</small>
        </section>
        <header>
          <div><small>ビュー</small><strong>{{ selectedElement?.label ?? "選択なし" }}</strong></div>
          <span v-if="selectedElement">{{ selectedElementIds.length > 1 ? `${selectedElementIds.length}件を選択` : selectedElement.structuralKind === 'edge' ? '関係' : selectedElement.structuralKind === 'node' ? '要素' : '領域' }}</span>
        </header>
        <template v-if="selectedElement">
          <section v-if="selectedElementDiagnostics.length" class="iriograph-element-diagnostics">
            <label>問題</label>
            <article
              v-for="(diagnostic, index) in selectedElementDiagnostics"
              :key="diagnostic.diagnosticId ?? `${diagnostic.code}:${index}`"
              :class="diagnostic.severity"
            >
              <b>{{ diagnosticGuidance(diagnostic).title }}</b>
              <span>{{ diagnosticGuidance(diagnostic).action }}</span>
              <details><summary>技術的な詳細</summary><code>{{ diagnostic.code }}</code> {{ diagnosticGuidance(diagnostic).detail }}</details>
              <button v-if="canNavigateDiagnosticToSource(diagnostic)" type="button" @click="navigateDiagnosticToSource(diagnostic)">ソースで確認</button>
            </article>
          </section>
          <details
            v-if="displayInspectorSections.includes('appearance')"
            class="iriograph-inspector-section"
            :class="{ active: displayInspectorAction === 'appearance' }"
            :open="isDisplayInspectorSectionOpen('appearance')"
            @toggle="handleDisplayInspectorSectionToggle('appearance', $event)"
          >
            <summary :id="displayInspectorSectionDomId('appearance')">
              <span><strong>{{ selectedElement.structuralKind === 'edge' ? '線のスタイル' : (selectedElement.structuralKind === 'container' || selectedElement.structuralKind === 'region') && selectedElement.groupFrame ? '枠のスタイル' : '形とスタイル' }}</strong><small>色・線・文字とカタログ既定</small></span>
            </summary>
            <AppearanceEditor
              v-if="appearancePrimaryElement"
              inline
              :element-kind="appearancePrimaryElement.structuralKind"
              :selection-count="appearanceTargetIds.length"
              :current-style="appearancePrimaryElement.style"
              :current-style-ref="appearancePrimaryOverlay?.styleRef"
              :current-override="appearancePrimaryOverlay?.style"
              :presets="appearancePresetStyles"
              @preview="previewAppearance"
              @commit="commitAppearance"
              @apply="applyAppearance"
            />
            <template v-if="selectedElement.structuralKind !== 'edge'">
              <label>形</label>
              <div class="iriograph-template-choices" role="radiogroup" aria-label="要素の形">
                <button
                  v-for="(template, templateIndex) in templateChoices"
                  :key="template.templateRef"
                  type="button"
                  :aria-pressed="selectedElement.templateRef === template.templateRef"
                  :disabled="readOnly"
                  @click="updateTemplate(template.templateRef)"
                >
                  <span
                    class="iriograph-template-preview"
                    :class="[`shape-${template.shape ?? (template.structuralKind === 'node' ? 'rounded-rectangle' : 'rectangle')}`, `kind-${template.structuralKind}`]"
                    :style="{ background: template.style.fill, borderColor: template.style.stroke, color: template.style.text }"
                  ><img v-if="templatePreviewIconUrl(template)" :src="templatePreviewIconUrl(template)" alt="" /></span>
                  <span><b>{{ templateDisplayLabel(template, templateIndex + 1) }}</b><small>{{ templateShapeLabel(template) }}</small></span>
                </button>
              </div>
            </template>
          </details>
          <details
            v-if="displayInspectorSections.includes('icon') && (selectedElement.structuralKind === 'node' || (selectedElement.structuralKind === 'container' || selectedElement.structuralKind === 'region') && selectedElement.groupFrame)"
            class="iriograph-inspector-section"
            :class="{ active: displayInspectorAction === 'icon' }"
            :open="isDisplayInspectorSectionOpen('icon')"
            @toggle="handleDisplayInspectorSectionToggle('icon', $event)"
          >
            <summary :id="displayInspectorSectionDomId('icon')"><span><strong>アイコンと内容</strong><small>{{ selectedIconLabel }}・{{ selectedElement.structuralKind === 'node' ? '要素内' : '名称band内' }}の配置</small></span></summary>
            <details class="iriograph-package-icon-disclosure">
              <summary><span><strong>同梱アイコン</strong><small>現在: {{ selectedIconLabel }}</small></span></summary>
              <div class="iriograph-package-icon-choices" role="radiogroup" aria-label="同梱アイコン">
                <button type="button" :aria-pressed="!selectedElement.iconRef" :disabled="readOnly || pickingAsset" @click="clearIconSelection"><span>なし</span></button>
                <button
                  v-for="icon in packageDefaultIcons"
                  :key="icon.assetRef"
                  type="button"
                  :aria-pressed="selectedElement.iconRef === icon.assetRef"
                  :disabled="readOnly || pickingAsset"
                  @click="commitIconSelection(icon.assetRef, { label: icon.label, path: `@iriograph/core/icons/${icon.name}.svg` })"
                ><img :src="packageIconPreviewUrl(icon.assetRef)" alt="" /><span>{{ icon.label }}</span></button>
              </div>
            </details>
            <label :for="iconPathInputId">Workspace画像のパス</label>
            <nav v-if="workspaceAssetBreadcrumbs.length" class="iriograph-asset-breadcrumbs" aria-label="Workspace画像path">
              <button v-for="item in workspaceAssetBreadcrumbs" :key="item.path" type="button" @click="chooseWorkspacePath(item.input)">{{ item.label }}</button>
            </nav>
            <input
              :id="iconPathInputId"
              :list="assetSuggestionsListId"
              :value="iconPathDraft"
              :disabled="readOnly || pickingAsset"
              :aria-invalid="Boolean(iconPathIssue)"
              @input="updateIconPathDraft"
              @change="updateIcon"
              @keydown.enter.prevent="updateIcon"
              placeholder="例: ../assets/approval-policy.svg"
              autocomplete="off"
            />
            <datalist :id="assetSuggestionsListId">
              <option v-for="option in assetOptions.filter((candidate) => candidate.path)" :key="option.assetRef" :value="option.path">{{ option.label ?? option.path }}</option>
              <option v-for="option in workspaceAssetSuggestions.filter((candidate) => candidate.kind === 'asset')" :key="`workspace:${option.path}`" :value="option.input">{{ option.label }}</option>
            </datalist>
            <ul v-if="workspaceAssetSuggestions.length" class="iriograph-asset-segment-suggestions" aria-label="画像pathの候補">
              <li v-for="option in workspaceAssetSuggestions" :key="`${option.kind}:${option.path}`">
                <button
                  type="button"
                  :aria-pressed="option.kind === 'asset' ? selectedIconPresentation?.assetRef === option.assetRef : undefined"
                  :disabled="option.kind === 'asset' && (readOnly || pickingAsset)"
                  @click="chooseWorkspaceSuggestion(option)"
                ><span>{{ option.kind === 'folder' ? '▸' : '▧' }}</span>{{ option.label }}</button>
              </li>
            </ul>
            <small v-if="iconPathIssue" class="iriograph-field-error" role="alert">{{ iconPathIssue }}</small>
            <div
              v-if="selectedIconPresentation"
              class="iriograph-selected-icon-summary"
              aria-label="選択中の画像"
              :aria-busy="iconAssetSelectionBusy"
            >
              <img v-if="selectedIconPreviewUrl" :src="selectedIconPreviewUrl" alt="" />
              <span v-else class="iriograph-selected-icon-placeholder" aria-hidden="true">▧</span>
              <span><strong>{{ selectedIconPresentation.label }}</strong><small>{{ selectedIconPresentation.path ?? "パス情報なし（参照ダイアログから選択）" }}</small></span>
            </div>
            <small class="iriograph-icon-selection-status" role="status" aria-live="polite">{{ iconSelectionFeedback }}</small>
            <small>./ と ../ は開いている文書から、/ はWorkspace rootから辿ります。保存するのは画像pathでなく安定した参照IDです。</small>
            <button
              v-if="pickAsset"
              type="button"
              class="iriograph-wide-button"
              :disabled="readOnly || pickingAsset"
              @click="chooseAssetIcon"
            >
              {{ pickingAsset ? "画像ファイルを参照中…" : "画像ファイルを参照…" }}
            </button>
            <details v-if="selectedElement.structuralKind === 'node' && selectedElement.iconRef" class="iriograph-view-disclosure" open>
              <summary>アイコンのサイズと収まり</summary>
              <label><span>サイズ指定</span><select aria-label="アイコンのサイズ指定" :value="selectedIconSizingMode" :disabled="readOnly" @change="updateSelectedNodeIconSizingMode"><option value="scale">自然比率で倍率</option><option value="size">幅と高さを指定</option></select></label>
              <label v-if="selectedIconSizingMode === 'scale'"><span>倍率</span><input aria-label="アイコンの倍率" type="number" min="0.1" max="8" step="0.1" :value="selectedElement.nodeIconScale ?? 1" :disabled="readOnly" @change="updateSelectedNodeIconScale" /></label>
              <div v-else class="iriograph-icon-size-grid">
                <label><span>幅</span><input aria-label="アイコンの幅" type="number" min="4" max="4096" step="1" :value="Math.round(selectedIconMetrics?.width ?? 24)" :disabled="readOnly" @change="updateSelectedNodeIconSize('width', $event)" /></label>
                <label><span>高さ</span><input aria-label="アイコンの高さ" type="number" min="4" max="4096" step="1" :value="Math.round(selectedIconMetrics?.height ?? 24)" :disabled="readOnly" @change="updateSelectedNodeIconSize('height', $event)" /></label>
              </div>
              <label><span>枠内の収まり</span><select aria-label="アイコンの収まり" :value="selectedElement.nodeIconFit ?? 'contain'" :disabled="readOnly" @change="updateSelectedNodeIconFit"><option value="contain">全体を表示</option><option value="cover">枠を埋める</option></select></label>
              <label class="iriograph-inline-check"><input v-model="growNodeWithIcon" type="checkbox" />アイコンに合わせて要素の枠も広げる</label>
              <small>Canvas上の青いハンドルでも自然比率を保って変更できます。倍率と幅・高さは同時に保存しません。</small>
              <small v-if="selectedIconFrameWarning" class="iriograph-field-error" role="alert">{{ selectedIconFrameWarning }}</small>
              <button type="button" class="iriograph-wide-button" :disabled="readOnly || (!selectedElement.nodeIconScale && !selectedElement.nodeIconSize && !selectedElement.nodeIconFit)" @click="resetSelectedNodeIconPresentation">サイズと収まりを既定へ戻す</button>
            </details>
            <div v-if="selectedElement.structuralKind === 'node'" class="iriograph-node-content-placement">
              <label>要素内の配置</label>
              <small class="iriograph-node-content-guidance">Canvas上のラベルやアイコンをドラッグして、この要素の中で位置を調整できます。</small>
              <label>ラベルの文字方向</label>
              <select
                aria-label="要素ラベルの文字方向"
                :value="nodeLabelWritingDirectionFor(selectedElement.elementId)"
                :disabled="readOnly"
                @change="updateSelectedNodeLabelWritingDirection"
              >
                <option value="horizontal-right">横書き（左から右）</option>
                <option value="vertical-down">縦書き（上から下）</option>
              </select>
              <div class="iriograph-node-content-reset-actions">
                <button
                  type="button"
                  :disabled="readOnly || !selectedElement.nodeLabelOffset"
                  @click="resetSelectedNodeContentOffset('label')"
                >ラベル位置を戻す</button>
                <button
                  type="button"
                  :disabled="readOnly || !selectedElement.nodeIconOffset"
                  @click="resetSelectedNodeContentOffset('icon')"
                >アイコン位置を戻す</button>
              </div>
            </div>
            <div v-else-if="selectedElement.iconRef" class="iriograph-node-content-placement">
              <label>名称band内の配置</label>
              <small class="iriograph-node-content-guidance">自然比率を保ったまま、Canvas上のアイコンをドラッグするか数値で位置を調整できます。</small>
              <label><span>倍率</span><input aria-label="グループアイコンの倍率" type="number" min="0.1" max="8" step="0.1" :value="selectedElement.groupIconScale ?? 1" :disabled="readOnly" @change="updateSelectedGroupIconScale" /></label>
              <div class="iriograph-icon-size-grid">
                <label><span>横位置</span><input aria-label="グループアイコンの横位置" type="number" min="-128" max="128" step="1" :value="selectedElement.groupIconOffset?.x ?? 0" :disabled="readOnly" @change="updateSelectedGroupIconOffset('x', $event)" /></label>
                <label><span>縦位置</span><input aria-label="グループアイコンの縦位置" type="number" min="-128" max="128" step="1" :value="selectedElement.groupIconOffset?.y ?? 0" :disabled="readOnly" @change="updateSelectedGroupIconOffset('y', $event)" /></label>
              </div>
              <small v-if="selectedElement.groupIconOffset && selectedElement.groupIconOffset.x > 12 && Math.abs(selectedElement.groupIconOffset.y) < 24" class="iriograph-field-error" role="status">アイコンと名称が重なる可能性があります。</small>
              <button type="button" class="iriograph-wide-button" :disabled="readOnly || (!selectedElement.groupIconOffset && !selectedElement.groupIconScale)" @click="resetSelectedGroupIconPresentation">位置と倍率を既定へ戻す</button>
            </div>
          </details>
          <details
            v-if="displayInspectorSections.includes('region-label') && selectedElement.structuralKind === 'region' && !selectedElement.groupFrame"
            class="iriograph-inspector-section"
            :class="{ active: displayInspectorAction === 'region-label' }"
            :open="isDisplayInspectorSectionOpen('region-label')"
            @toggle="handleDisplayInspectorSectionToggle('region-label', $event)"
          >
            <summary :id="displayInspectorSectionDomId('region-label')"><span><strong>名称と層</strong><small>枠上の名前・文字方向・前後</small></span></summary>
            <p>Canvas上のラベルをドラッグすると、領域の枠線に沿って自由に移動できます。</p>
            <label>文字方向</label>
            <select aria-label="領域名の文字方向" :value="regionLabelWritingDirectionFor(selectedElement.elementId)" :disabled="readOnly" @change="updateSelectedRegionLabelWritingDirection">
              <option value="horizontal-right">横書き（左から右）</option>
              <option value="vertical-down">縦書き（上から下）</option>
            </select>
            <small>横書きは右向き、縦書きは下向きに統一します。</small>
            <div class="iriograph-region-layer-actions">
              <button type="button" :disabled="readOnly" @click="moveSelectedRegionLayer('back')">領域を背面へ</button>
              <button type="button" :disabled="readOnly" @click="moveSelectedRegionLayer('front')">領域を前面へ</button>
            </div>
          </details>
          <details
            v-if="displayInspectorSections.includes('region-label') && (selectedElement.structuralKind === 'container' || selectedElement.structuralKind === 'region') && selectedElement.groupFrame"
            class="iriograph-inspector-section"
            :class="{ active: displayInspectorAction === 'region-label' }"
            :open="isDisplayInspectorSectionOpen('region-label')"
            @toggle="handleDisplayInspectorSectionToggle('region-label', $event)"
          >
            <summary :id="displayInspectorSectionDomId('region-label')"><span><strong>名称と層</strong><small>枠上の名前・文字方向・前後</small></span></summary>
            <p>Canvas上の名称をドラッグすると、枠の内側と必要最小限の外側を含むband内で移動できます。</p>
            <label>文字方向</label>
            <select aria-label="グループ名の文字方向" :value="selectedElement.groupLabelWritingDirection ?? 'horizontal-right'" :disabled="readOnly" @change="updateSelectedGroupLabelWritingDirection">
              <option value="horizontal-right">横書き（左から右）</option>
              <option value="vertical-down">縦書き（上から下）</option>
            </select>
            <small>並び順・分岐・所属・分類はいずれも同じ枠操作で調整できます。意味構造は変更しません。</small>
            <div class="iriograph-region-layer-actions">
              <button type="button" :disabled="readOnly" @click="moveSelectedGroupLayer('back')">枠を背面へ</button>
              <button type="button" :disabled="readOnly" @click="moveSelectedGroupLayer('front')">枠を前面へ</button>
            </div>
            <button type="button" class="iriograph-wide-button" :disabled="readOnly" @click="fitSelectedGroupToMembers">含む要素に枠を合わせる</button>
            <button type="button" class="iriograph-wide-button" :disabled="readOnly" @click="resetSelectedGroupFrameView">配置を自動状態へ戻す</button>
          </details>
          <details
            v-if="displayInspectorSections.includes('geometry') && 'geometry' in selectedElement"
            class="iriograph-inspector-section"
            :class="{ active: displayInspectorAction === 'geometry' }"
            :open="isDisplayInspectorSectionOpen('geometry')"
            @toggle="handleDisplayInspectorSectionToggle('geometry', $event)"
          >
            <summary :id="displayInspectorSectionDomId('geometry')"><span><strong>位置とサイズ</strong><small>{{ Math.round(selectedElement.geometry.width) }} × {{ Math.round(selectedElement.geometry.height) }}・{{ selectedElement.placement === 'user' ? 'ユーザー配置' : '自動配置' }}</small></span></summary>
            <div class="iriograph-section-heading">
              <label>位置とサイズ</label>
              <span :class="selectedElement.placement">{{ selectedElement.placement === 'user' ? 'ユーザー配置' : '自動配置' }}</span>
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
            <button v-if="selectedOverlay?.placement === 'user'" type="button" class="iriograph-wide-button" :disabled="readOnly" @click="clearSelectedOverride">ユーザー調整を解除</button>
          </details>
          <details
            v-if="displayInspectorSections.includes('routing') && selectedElement.structuralKind === 'edge'"
            class="iriograph-inspector-section iriograph-routing-inspector"
            :class="{ active: displayInspectorAction === 'routing' }"
            :open="isDisplayInspectorSectionOpen('routing')"
            @toggle="handleDisplayInspectorSectionToggle('routing', $event)"
          >
            <summary :id="displayInspectorSectionDomId('routing')"><span><strong>線の形式</strong><small>{{ selectedRouteMode === 'auto' ? '自動' : selectedRouteMode === 'straight' ? '直線' : selectedRouteMode === 'orthogonal' ? '折れ線' : selectedRouteMode === 'curve' ? '曲線' : '手動' }}</small></span></summary>
            <header class="iriograph-edge-view-summary">
              <strong>{{ selectedEdgeDisplayName }}</strong>
              <div class="iriograph-edge-contract"><span>{{ selectedEdgeEndpointLabels.source }}</span><b>→</b><span>{{ selectedEdgeEndpointLabels.target }}</span></div>
            </header>
            <label><span>線の形式</span><select aria-label="線の形式" :value="selectedRouteMode" :disabled="readOnly" @change="setSelectedRouteMode(($event.target as HTMLSelectElement).value as EdgeRouteMode)"><option value="auto">自動</option><option value="straight">直線</option><option value="orthogonal">折れ線</option><option value="curve">曲線</option><option value="manual">手動で調整</option></select></label>
            <template v-if="selectedRouteMode === 'manual'">
              <button
                type="button"
                class="iriograph-wide-button"
                :disabled="readOnly"
                @click="addSelectedWaypoint"
              >経路点を追加</button>
              <small>{{ selectedManualWaypoints.length }}個の経路点。Canvas上の点をドラッグして調整します。</small>
              <div v-if="selectedManualWaypoints.length" class="iriograph-waypoint-list" role="list" aria-label="手動経路点">
                <div v-for="(_, index) in selectedManualWaypoints" :key="index" role="listitem">
                  <span>経路点 {{ index + 1 }}</span>
                  <button
                    type="button"
                    :aria-label="`経路点 ${index + 1}を削除`"
                    :disabled="readOnly"
                    @click="removeSelectedWaypointAt(index)"
                  >削除</button>
                </div>
              </div>
            </template>
            <template v-if="selectedRouteMode === 'curve'">
              <button
                type="button"
                class="iriograph-wide-button"
                :disabled="readOnly"
                @click="addSelectedCurveKnot"
              >曲線点を追加</button>
              <small>{{ selectedCurveKnots.length }}個の曲線点。Canvas上の点とハンドルをドラッグして調整します。</small>
              <div v-if="selectedCurveKnots.length" class="iriograph-waypoint-list" role="list" aria-label="曲線点">
                <div v-for="(_, index) in selectedCurveKnots" :key="index" role="listitem">
                  <span>曲線点 {{ index + 1 }}</span>
                  <button
                    type="button"
                    :aria-label="`曲線点 ${index + 1}を削除`"
                    :disabled="readOnly"
                    @click="removeSelectedCurveKnotAt(index)"
                  >削除</button>
                </div>
              </div>
              <button
                type="button"
                class="iriograph-wide-button"
                :disabled="readOnly || !selectedElement.curve"
                @click="resetSelectedCurveControls"
              >自動曲線へ戻す</button>
            </template>
            <button
              type="button"
              class="iriograph-wide-button"
              :disabled="readOnly || !hasSelectedEditableRouting"
              @click="resetSelectedRouting"
            >線の調整をすべてリセット</button>
          </details>
          <details
            v-if="displayInspectorSections.includes('edge-connection') && selectedElement.structuralKind === 'edge'"
            class="iriograph-inspector-section iriograph-routing-inspector"
            :class="{ active: displayInspectorAction === 'edge-connection' }"
            :open="isDisplayInspectorSectionOpen('edge-connection')"
            @toggle="handleDisplayInspectorSectionToggle('edge-connection', $event)"
          >
            <summary :id="displayInspectorSectionDomId('edge-connection')"><span><strong>接続点と端子</strong><small>{{ selectedEdgeEndpointLabels.source }} → {{ selectedEdgeEndpointLabels.target }}</small></span></summary>
            <label>端子の形</label>
            <div class="iriograph-endpoint-marker-fields">
              <label v-for="endpoint in (['source', 'target'] as const)" :key="endpoint">
                <span>{{ endpoint === 'source' ? '始点' : '終点' }}</span>
                <select
                  :aria-label="endpoint === 'source' ? '始点の端子形状' : '終点の端子形状'"
                  :value="selectedElement[endpoint === 'source' ? 'sourceMarker' : 'targetMarker'] ?? (endpoint === 'source' ? 'none' : 'arrow')"
                  :disabled="readOnly"
                  @change="setSelectedTerminalMarker(endpoint, ($event.target as HTMLSelectElement).value as EdgeTerminalMarker)"
                >
                  <option value="none">なし</option><option value="arrow">矢印</option><option value="open-arrow">開いた矢印</option><option value="triangle">三角</option><option value="diamond">ひし形</option><option value="circle">丸</option>
                </select>
              </label>
            </div>
            <p>Canvas上の始点・終点ハンドルを要素の周囲へドラッグします。数値入力は必要ありません。</p>
            <button
              type="button"
              class="iriograph-wide-button"
              :disabled="readOnly || (!selectedElement.sourceAnchor && !selectedElement.targetAnchor)"
              @click="resetSelectedEndpointAnchors"
            >接続位置を自動に戻す</button>
          </details>
          <details
            v-if="displayInspectorSections.includes('edge-label') && selectedElement.structuralKind === 'edge'"
            class="iriograph-inspector-section iriograph-routing-inspector"
            :class="{ active: displayInspectorAction === 'edge-label' }"
            :open="isDisplayInspectorSectionOpen('edge-label')"
            @toggle="handleDisplayInspectorSectionToggle('edge-label', $event)"
          >
            <summary :id="displayInspectorSectionDomId('edge-label')"><span><strong>ラベルとビュー補足</strong><small>{{ selectedElement.label || 'ラベルなし' }}{{ selectedElement.caption ? '・補足あり' : '' }}</small></span></summary>
            <p v-if="selectedElement.label">Canvas上の関係名をドラッグして位置を調整できます。</p>
            <button
              v-if="selectedElement.label"
              type="button"
              class="iriograph-wide-button"
              :disabled="readOnly || !selectedElement.labelOffset"
              @click="resetSelectedLabelOffset"
            >ラベル位置をリセット</button>
            <label>このビューだけの補足</label>
            <textarea
              :value="selectedElement.caption ?? ''"
              :disabled="readOnly"
              maxlength="2000"
              rows="3"
              aria-label="選択した関係のビュー上の補足"
              placeholder="意味グラフには含めない表示用の補足"
              @change="updateSelectedEdgeCaption"
            />
            <small>共有する意味や説明は「意味」タブで編集します。</small>
          </details>
        </template>
        </div>
      </aside>
      <button
        type="button"
        class="iriograph-sidebar-toggle iriograph-right-sidebar-toggle"
        :aria-label="rightSidebarCollapsed ? '右サイドバーを開く' : '右サイドバーを閉じる'"
        :aria-expanded="!rightSidebarCollapsed"
        :aria-controls="rightSidebarId"
        @click="toggleRightSidebar"
      >{{ rightSidebarCollapsed ? '‹' : '›' }}</button>
    </div>

    <div
      v-if="documentRebasePreview || documentRebaseIssues.length"
      class="iriograph-rebase-dialog-backdrop"
      role="presentation"
      @click.self="closeDocumentRebaseDialog"
    >
      <section
        ref="documentRebaseDialog"
        class="iriograph-rebase-dialog"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="documentRebaseDialogTitleId"
        tabindex="-1"
        @keydown="handleDocumentRebaseDialogKeydown"
      >
        <header><div><small>DOCUMENT COPY PREVIEW</small><strong :id="documentRebaseDialogTitleId">新しい図として複製</strong></div><button type="button" aria-label="複製をキャンセル" :disabled="allocatingDocumentIdentity" @click="closeDocumentRebaseDialog">×</button></header>
        <p>元の文書、Undo履歴、保存先は変更しません。検証済みの新しい文書をHostへ渡し、Hostが別ファイルとして作成・表示します。</p>
        <template v-if="documentRebasePreview">
          <p class="iriograph-rebase-identities">新しい文書識別子と名前空間はHostが発行済みです。</p>
          <section class="iriograph-rebase-change-summary"><strong>文書内識別子の付け替え</strong><span>{{ documentRebasePreview.rebase.termChanges.length }}要素・ビュー参照 {{ documentRebasePreview.rebase.overlayReferenceChanges }}件</span><p>標準・外部語彙、asset、テキストは変更しません。</p></section>
          <ul v-if="documentRebasePreview.rebase.termChanges.length" class="iriograph-rebase-changes" aria-label="識別子変更一覧"><li v-for="(change, index) in documentRebasePreview.rebase.termChanges" :key="`rebase-change-${index}`"><strong>{{ rebaseTermLabel(change.from) }}</strong><span>{{ change.occurrences }}箇所</span></li></ul>
          <p v-else>付け替える文書内識別子はありません。</p>
        </template>
        <ul v-if="documentRebaseIssues.length" class="iriograph-diagnostics" role="alert"><li v-for="(issue, index) in documentRebaseIssues" :key="`${issue.path}:${index}`" class="error"><span><b>{{ issue.path }}</b> {{ issue.message }}<small>{{ issue.action }}</small></span></li></ul>
        <footer><button type="button" :disabled="allocatingDocumentIdentity" @click="closeDocumentRebaseDialog">キャンセル</button><button ref="documentRebaseApplyButton" type="button" class="primary" :disabled="!documentRebasePreview?.valid || allocatingDocumentIdentity" @click="applyPreparedDocumentRebase">{{ allocatingDocumentIdentity ? '適用中…' : 'この内容で複製' }}</button></footer>
      </section>
    </div>

    <div
      v-if="viewDialogMode"
      class="iriograph-view-dialog-backdrop"
      role="presentation"
      @click.self="closeViewDialog"
    >
      <form
        ref="viewDialog"
        class="iriograph-view-dialog"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="viewDialogTitleId"
        @keydown="handleViewDialogKeydown"
        @submit.prevent="submitViewDialog"
      >
        <header>
          <strong :id="viewDialogTitleId">{{ viewDialogMode === "manage" ? "ビューを管理" : viewDialogMode === "add" ? "名前付きビューを追加" : "ビュー設定" }}</strong>
          <button type="button" aria-label="閉じる" :disabled="viewCommandBusy" @click="closeViewDialog">×</button>
        </header>
        <template v-if="viewDialogMode === 'manage'">
          <section class="iriograph-view-manager-current" aria-label="管理中のビュー">
            <label v-if="draft.views.length > 1">管理するビュー<select ref="viewDialogInitialFocus" :value="activeView?.viewId ?? ''" aria-label="管理する名前付きビュー" @change="requestActiveView"><option v-for="view in draft.views" :key="view.viewId" :value="view.viewId">{{ view.viewId }}</option></select></label>
            <p v-else ref="viewDialogInitialFocus" tabindex="-1"><small>現在のビュー</small><strong>{{ activeView?.viewId }}</strong></p>
            <dl><div><dt>表示対象</dt><dd>{{ profileDisplayLabel(activeView?.profileRef) }}</dd></div><div><dt>配置</dt><dd>{{ layoutPurposeLabel(activeView?.layoutRef) }}</dd></div><div><dt>表示差分</dt><dd>{{ Object.keys(activeView?.overlay ?? {}).length }}件</dd></div></dl>
          </section>
          <div class="iriograph-view-manager-actions">
            <button type="button" :disabled="readOnly || viewCommandBusy" @click="openAddViewDialog">ビューを追加</button>
            <button type="button" :disabled="readOnly || viewCommandBusy || !activeView" @click="duplicateActiveView">このビューを複製</button>
            <button type="button" :disabled="readOnly || viewCommandBusy || !activeView" @click="openConfigureViewDialog">このビューを設定</button>
            <button type="button" :disabled="readOnly || viewCommandBusy || !activeView" @click="resetActiveViewOverlay">ビュー調整をリセット</button>
          </div>
          <section class="iriograph-view-manager-danger">
            <button v-if="!viewDeleteConfirmation" type="button" :disabled="readOnly || viewCommandBusy || draft.views.length <= 1" @click="requestActiveViewDeletion">このビューを削除</button>
            <template v-else><p>「{{ activeView?.viewId }}」だけを削除します。意味グラフと他のビューは残ります。</p><button type="button" :disabled="viewCommandBusy" @click="viewDeleteConfirmation = false">戻る</button><button type="button" class="danger" :disabled="viewCommandBusy" @click="confirmActiveViewDeletion">削除する</button></template>
          </section>
          <footer><button type="button" :disabled="viewCommandBusy" @click="closeViewDialog">閉じる</button></footer>
        </template>
        <template v-else>
        <label>
          View ID
          <input ref="viewDialogInitialFocus" v-model="viewForm.viewId" :readonly="viewDialogMode === 'configure'" required />
          <small v-if="viewDialogMode === 'configure'">viewIdは作成後に変更できません。</small>
        </label>
        <label>
          表示対象
          <select v-model="viewForm.profileToken" required>
            <option v-for="choice in profileChoices" :key="choice.token" :value="choice.token">{{ choice.label }}（{{ choice.purpose }}）</option>
          </select>
        </label>
        <label>
          配置方向
          <select
            v-model="viewForm.layoutDirection"
            aria-label="配置方向"
            :disabled="!viewForm.layoutDirection"
            required
          >
            <option value="LR">横方向（左→右）</option>
            <option value="TB">縦方向（上→下）</option>
          </select>
          <small v-if="!viewForm.layoutDirection">現在の配置方法は方向変更に対応していません。</small>
        </label>
        <label>
          Locale (BCP 47)
          <input v-model="viewForm.locale" placeholder="ja" />
        </label>
        <footer>
          <button type="button" :disabled="viewCommandBusy" @click="closeViewDialog">キャンセル</button>
          <button type="submit" class="primary" :disabled="viewCommandBusy">
            {{ viewCommandBusy ? "適用中…" : viewDialogMode === "add" ? "追加" : "適用" }}
          </button>
        </footer>
        </template>
      </form>
    </div>

    <TargetContextMenu
      :entries="targetContextEntries"
      :session="targetContextMenuSession"
      @select="selectTargetContextDestination"
      @close="closeTargetMenu"
    />

    <div v-if="pendingDeletion" class="iriograph-deletion-dialog-backdrop" role="presentation">
      <section
        ref="deletionDialog"
        class="iriograph-deletion-dialog"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="deletionDialogTitleId"
        @keydown="handleDeletionDialogKeydown"
      >
        <header>
          <strong :id="deletionDialogTitleId">関連する情報も削除されます</strong>
          <button type="button" aria-label="削除をキャンセル" :disabled="authoringBusy" @click="cancelPendingDeletion">×</button>
        </header>
        <p>削除すると、次の参照・関係・所属・並び順も同じ操作で削除されます。</p>
        <ul aria-label="削除の影響一覧">
          <li v-for="impact in pendingDeletion.impacts" :key="impact.key">
            <small>{{ impact.kind === 'type-reference' ? '型参照' : impact.kind === 'relation' ? '関係' : impact.kind === 'sequence' ? '並び順' : impact.kind === 'alternative' ? '選択肢' : '所属' }}</small>
            <span>{{ impact.label }}</span>
          </li>
        </ul>
        <footer>
          <button type="button" :disabled="authoringBusy" @click="cancelPendingDeletion">キャンセル</button>
          <button ref="deletionConfirmButton" type="button" class="danger" :disabled="authoringBusy" @click="confirmPendingDeletion">
            {{ authoringBusy ? '削除中…' : '影響も含めて削除' }}
          </button>
        </footer>
      </section>
    </div>

    <StructuredElementDetailsDialog
      v-if="structuredDetails"
      :title="structuredDetails.title"
      :fields="structuredDetails.fields"
      :node-roles="structuredPresentation.profile.nodeRoles"
      :selected-node-role-ids="structuredDetails.selectedNodeRoleIds"
      :group-kinds="structuredPresentation.groupKinds"
      :current-group-kind="structuredDetails.currentGroupKind"
      :memberships="structuredDetails.memberships"
      :busy="authoringBusy"
      @save="saveStructuredDetails"
      @focus-element="focusElement"
      @edit-membership="editStructuredMembership"
      @close="structuredDetails = undefined"
    />
  </article>
</template>
