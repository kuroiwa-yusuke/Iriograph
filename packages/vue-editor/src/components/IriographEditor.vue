<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, toRaw, useId, watch } from "vue";

import {
  applyAuthoringSource,
  applyAuthoringPreview,
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
  projectSemanticView,
  previewAuthoringCommands,
  seedAuthoringCommandFromProvenance,
  semanticSourceFingerprint,
  statementIdentityForNamedStatement,
  validateSemanticDocument,
  validateIriographDocumentV1,
  validateProjectionCatalogV1,
  withPackageDefaultIconAccess,
  type AuthoringPreview,
  type AuthoringCommand,
  type AssetAccess,
  type AssetDefinition,
  type DiagramScene,
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
  type ViewElementOverlay,
  type VisualStyle,
  type VisualTemplate,
  type ViewCommand,
} from "@iriograph/core";

import SemanticIntentPanel, {
  type IntentEdgeDetails,
  type IntentElementDetails,
  type IntentMembershipOption,
  type IntentRelationOverview,
  type IntentSequenceOption,
  type IntentTextValue,
  type SemanticIntent,
} from "./SemanticIntentPanel.vue";
import DiagramCanvas from "./DiagramCanvas.vue";
import ResourceCreationPalette from "./ResourceCreationPalette.vue";
import ResourceDetailsDialog from "./ResourceDetailsDialog.vue";
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
import { catalogCreationPalette } from "../creation-palette";
import { diagnosticGuidance } from "../diagnostic-guidance";
import { semanticDisplayMetadata } from "../semantic-metadata";
import { membershipOverviewForElement } from "../membership-overview";
import {
  layoutDirectionForRef,
  layoutRefForDirection,
  standardLayoutRefForDirection,
} from "../layout-direction";
import {
  constrainMembershipRegionMovement,
  membershipRegionClassIrisAtPoint,
} from "../region-membership-constraints";
import { reconcilePresentationScene } from "../presentation-scene";
import type { EditorAssetOption } from "../editor-assets";

type Panel = "diagram" | "turtle" | "document" | "catalog";
type SelectedElement = SceneNode | SceneContainer | SceneRegion | SceneEdge;
type RegionLabelPlacement = "top" | "right" | "bottom" | "left";
type DocumentRefreshKind = "semantic" | "presentation";
type DisplayInspectorAction = "appearance" | "geometry" | "region-label" | "routing";
type InspectorMode = "semantic" | "appearance";
type DeletionImpact = {
  key: string;
  label: string;
  kind: "relation" | "membership" | "sequence";
};
type PendingDeletion = {
  preview: AuthoringPreview;
  impacts: DeletionImpact[];
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
  /** Fit the first completed Scene for each document/view; later edits preserve the user's viewport. */
  fitOnInitialLoad?: boolean;
  assetAccess?: AssetAccess;
  /** Host-owned workspace path/assetRef mapping used by the icon combobox. */
  assetOptions?: readonly EditorAssetOption[];
  pickAsset?: AssetPicker;
  snapSettings?: DiagramSnapSettingsInput;
  authoringContext?: ResolvedAuthoringContext;
  semanticValidationContext?: ResolvedSemanticValidationContext;
  resourceIriAllocator?: ResourceIriAllocator;
}>(), {
  title: "",
  filePath: "",
  dirty: false,
  saving: false,
  saveMessage: "",
  canSave: true,
  readOnly: false,
  hideHeader: false,
  fitOnInitialLoad: false,
  assetAccess: undefined,
  assetOptions: () => [],
  pickAsset: undefined,
  layoutRegistry: undefined,
  snapSettings: undefined,
  authoringContext: undefined,
  semanticValidationContext: undefined,
  resourceIriAllocator: undefined,
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
}>();

const draft = ref<IriographDocument>(clone(props.modelValue));
const currentActiveViewId = ref(resolveActiveViewId(draft.value, props.activeViewId));
const viewSessions = new Map<string, DiagramViewSession>();
const viewSessionRevision = ref(0);
const turtleDraft = ref(draft.value.semantic.source);
const panel = ref<Panel>("diagram");
const selectedElementId = ref("");
const selectedElementIds = ref<string[]>([]);
const snapSettings = ref<DiagramSnapSettings>(normalizeDiagramSnapSettings(props.snapSettings));
const zoom = ref(1);
const diagramCanvas = ref<DiagramCanvasNavigationApi>();
const semanticIntentPanel = ref<{ focusPendingIntent(): void; resetIntent(): void }>();
const turtleTextarea = ref<HTMLTextAreaElement>();
const history = ref<IriographDocument[]>([]);
const future = ref<IriographDocument[]>([]);
const schemaDiagnostics = ref<ProjectionDiagnostic[]>([]);
const applyDiagnostics = ref<ProjectionDiagnostic[]>([]);
const rawScene = ref<DiagramScene>(emptyScene(currentActiveViewId.value));
const sceneLoading = ref(true);
const applyingTurtle = ref(false);
const semanticWarningConfirmation = ref<SemanticWarningConfirmation>();
const authoringDraft = ref<EditorAuthoringDraft>(emptyAuthoringDraft());
const authoringResourcePicker = ref<AuthoringResourcePickerTarget>();
const authoringBusy = ref(false);
const pickingAsset = ref(false);
const viewCommandBusy = ref(false);
const viewDialogMode = ref<"add" | "configure">();
const viewForm = ref<{
  viewId: string;
  profileRef: string;
  layoutRef: string;
  layoutDirection: LayoutDirection | "";
  locale: string;
}>({ viewId: "", profileRef: "", layoutRef: "", layoutDirection: "LR", locale: "" });
const viewDialog = ref<HTMLFormElement>();
const viewDialogInitialFocus = ref<HTMLInputElement>();
const viewDialogTitleId = `${useId()}-view-dialog-title`;
const pendingDeletion = ref<PendingDeletion>();
const deletionDialog = ref<HTMLElement>();
const deletionConfirmButton = ref<HTMLButtonElement>();
const deletionDialogTitleId = `${useId()}-deletion-dialog-title`;
const leftSidebarId = `${useId()}-left-sidebar`;
const rightSidebarId = `${useId()}-right-sidebar`;
const assetSuggestionsListId = `${useId()}-asset-suggestions`;
const iconPathInputId = `${useId()}-icon-path`;
const leftSidebarCollapsed = ref(false);
const rightSidebarCollapsed = ref(false);
const displayInspectorAction = ref<DisplayInspectorAction>();
const inspectorMode = ref<InspectorMode>("semantic");
const activeSemanticIntent = ref<SemanticIntent>();
const semanticIntentDraftPending = ref(false);
const pendingAuthoringGuidance = ref("");
const detailsDialogElementId = ref("");
const creationPalette = ref<{
  kind: "node" | "region";
  position?: Point;
  containerIri?: string;
  classIris?: string[];
}>();
const appearanceEditorOpen = ref(false);
const appearanceTargetIds = ref<string[]>([]);
const appearancePreviewValue = ref<AppearanceEditorValue>();
const showAllComments = ref(false);
const showCanvasGrid = ref(true);
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
let viewCommandRequestToken = 0;
let viewCommandAbortController: AbortController | undefined;

const activeView = computed(() => draft.value.views.find((view) => (
  view.viewId === currentActiveViewId.value
)) ?? draft.value.views[0]);
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
watch(
  () => `${selectedElementId.value}:${selectedElement.value?.structuralKind ?? ""}`,
  () => {
    const kind = selectedElement.value?.structuralKind;
    displayInspectorAction.value = kind === "edge"
      ? "routing"
      : kind === "region"
        ? "region-label"
        : kind
          ? "appearance"
          : undefined;
  },
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
const profileChoices = computed(() => [...(projectionRuntimeContext.value?.catalogsByProfile.keys() ?? [])]);
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
));
const authoringContext = computed<ResolvedAuthoringContext | undefined>(() => {
  if (!props.authoringContext) return undefined;
  const source = toRaw(props.authoringContext);
  const runtime = projectionRuntimeContext.value ?? unwrapProjectionRuntimeContext(toRaw(source.runtime));
  return {
    ...source,
    runtime: {
      ...runtime,
      catalogsByProfile: runtime.catalogsByProfile,
      layouts: runtime.layouts,
      projectionOptions: runtime.projectionOptions
        ? toRaw(runtime.projectionOptions)
        : undefined,
    },
    allocator: toRaw(props.resourceIriAllocator ?? source.allocator),
    semanticValidation: semanticValidationContext.value,
  };
});
const authoringBlockedReason = computed(() => {
  if (props.readOnly) return "読み取り専用のため意味グラフを編集できません。";
  if (!authoringContext.value) return "Hostからauthoring contextが提供されていません。";
  if (turtlePending.value) return "未適用のTurtle draftを適用または破棄してください。";
  return "";
});
const authoringEnabled = computed(() => !authoringBlockedReason.value);
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
  const labelFor = (iri: string) => semanticMetadata.value[iri]?.labels[0]?.value ?? iri;
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
    ...(item.language ? { language: item.language } : {}),
    ...(item.datatypeIri ? { datatypeIri: item.datatypeIri } : {}),
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
      ...(comment.language ? { language: comment.language } : {}),
      ...(comment.datatypeIri ? { datatypeIri: comment.datatypeIri } : {}),
    })),
    capability: removable,
    derivedReason,
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
  if (selectedAuthoringResources.value.length === 0) return [];
  const selectedIris = new Set(selectedAuthoringResources.value.map((resource) => resource.iri));
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
    if (!selectedIris.has(sequence.semanticRef) && !memberships.some((membership) => {
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
    chips.push({ iri: iri || "urn:iriograph:pending-resource", label: choice?.label || fallback || compactRef(iri), role });
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
const documentJson = computed(() => JSON.stringify(draft.value, null, 2));
const catalogJson = computed(() => JSON.stringify(activeCatalog.value ?? {}, null, 2));
const overlayJson = computed(() => JSON.stringify(activeView.value?.overlay ?? {}, null, 2));
const heading = computed(() => props.title || props.filePath || draft.value.documentId || "Untitled");
const stateLabel = computed(() => {
  if (props.saving) return "保存中";
  if (props.saveMessage) return props.saveMessage;
  if (structuredAuthoringPending.value) return "意味を入力中";
  if (turtlePending.value) return "Turtleを入力中";
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
  for (const [assetRef, definition] of Object.entries(activeCatalog.value?.assets ?? {})) {
    if (packageRefs.has(assetRef)) continue;
    options.set(assetRef, {
      assetRef,
      label: assetDefinitionLabel(definition.extensions) ?? compactRef(assetRef),
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
const iconInputValue = computed(() => {
  const element = selectedElement.value;
  if (element?.structuralKind !== "node" || !element.iconRef) return "";
  const option = assetOptions.value.find((candidate) => candidate.assetRef === element.iconRef);
  return option?.path ?? "";
});
const selectedIconLabel = computed(() => {
  const element = selectedElement.value;
  if (element?.structuralKind !== "node" || !element.iconRef) return "アイコンなし";
  return assetOptions.value.find((candidate) => candidate.assetRef === element.iconRef)?.label
    ?? "カタログで設定されたアイコン";
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
const detailsDialogTarget = computed(() => {
  const element = [
  ...scene.value.nodes,
  ...scene.value.containers,
  ...(scene.value.regions ?? []),
  ].find((candidate) => candidate.elementId === detailsDialogElementId.value);
  if (element) return { semanticRef: element.semanticRef, label: element.label, notice: undefined };
  const edge = scene.value.edges.find((candidate) => candidate.elementId === detailsDialogElementId.value);
  return edge?.labelProvenance?.kind === "predicate"
    ? {
        semanticRef: edge.labelProvenance.labelSemanticRef,
        label: edge.label || "関係",
        notice: "ここで変更した名前・説明は、この関係種別を使うすべてのedge表示に反映されます。",
      }
    : undefined;
});
const creationPaletteCards = computed(() => catalogCreationPalette(
  activeCatalog.value,
  authoringContext.value?.terms ?? [],
  activeView.value?.kind ?? "node-link",
));

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
  () => turtlePending.value || structuredAuthoringPending.value,
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
    const projected = await buildIriographView(
      document,
      viewId,
      runtime,
      "incremental",
    );
    const semanticValidation = validationContext
      ? await validateSemanticDocument(document, validationContext, {
          signal: validationController.signal,
        })
      : { diagnostics: [] };
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
    const reconciled = reconcilePresentationScene(rawScene.value, projected);
    const result = await assetSceneSession.enrich(
      assetRequest,
      reconciled,
      availableAssetDefinitions(profile.catalog),
      withPackageDefaultIconAccess(props.assetAccess),
    );
    if (requestToken !== sceneRequestToken || !result.accepted) return;
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
    const result = await assetSceneSession.enrich(
      assetRequest,
      clone(prepared),
      availableAssetDefinitions(catalog),
      withPackageDefaultIconAccess(props.assetAccess),
    );
    if (requestToken !== sceneRequestToken || !result.accepted) return;
    rawScene.value = result.scene;
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
    diagnostics: [...prepared.diagnostics, ...result.diagnostics].filter(uniqueDiagnostic()),
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

function selectDisplayInspectorAction(action: DisplayInspectorAction, event: Event): void {
  displayInspectorAction.value = action;
  const target = event.currentTarget;
  if (!(target instanceof HTMLButtonElement)) return;
  void nextTick(() => {
    if (target.isConnected) target.focus();
  });
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

function updateRegionLabelAnchor(payload: { elementId: string; anchor: number }): void {
  const region = (scene.value.regions ?? []).find((candidate) => candidate.elementId === payload.elementId);
  if (!region || props.readOnly || !Number.isFinite(payload.anchor)) return;
  updateRegionAppearance(region, "regionLabelAnchor", clamp(payload.anchor, 0, .999999), false);
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
  if (!value) {
    updateAppearance("iconRef", undefined);
    return;
  }
  const option = assetOptions.value.find((candidate) => (
    candidate.assetRef === value || candidate.path === value
  ));
  const assetRef = option?.path === value ? option.assetRef : undefined;
  if (!assetRef) {
    input.value = element?.structuralKind === "node" ? iconInputValue.value : "";
    rejectInvalidAssetRef("候補にある画像pathを選択してください。");
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
      allowedMediaTypes: withPackageDefaultIconAccess(props.assetAccess).policy.allowedMediaTypes,
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

async function executeDetailsCommands(commands: AuthoringCommand[]): Promise<void> {
  const element = detailsDialogTarget.value;
  if (!element || commands.length === 0) return;
  detailsDialogElementId.value = "";
  await executeIntentCommands(commands, `${element.label} の詳細・属性を編集`, [{
    iri: element.semanticRef,
    label: element.label,
    role: "対象",
  }]);
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
    applyDiagnostics.value = clone(preview.diagnostics);
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
    applyDiagnostics.value = clone(result.diagnostics);
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
      kind: membership.role === "sequence-member" ? "sequence" : "membership",
      label: membership.role === "sequence-member"
        ? `${container} の ${membership.ordinal ?? "?"}番「${member}」`
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
      pendingDeletion.value = { preview, impacts };
      return;
    }
    await applyDeletionPreview(previous, preview, requestToken, controller);
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
    await applyDeletionPreview(previous, pending.preview, requestToken, controller);
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
  clearSelection();
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

function openContextMenu(request: DiagramContextMenuRequest): void {
  if (request.kind === "blank") return;
  const element = request.elementId
    ? [...scene.value.nodes, ...scene.value.containers, ...(scene.value.regions ?? []), ...scene.value.edges]
      .find((candidate) => candidate.elementId === request.elementId)
    : undefined;
  if (!element) return;
  rightSidebarCollapsed.value = false;
  inspectorMode.value = "appearance";
  displayInspectorAction.value = element.structuralKind === "edge"
    ? "routing"
    : element.structuralKind === "region"
      ? "region-label"
      : "appearance";
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

function openDetailsDialog(elementId: string): void {
  detailsDialogElementId.value = elementId;
}

function seedCreationDraft(next: EditorAuthoringDraft): void {
  creationPalette.value = undefined;
  updateAuthoringDraft(next);
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
  return geometryElement(elementId)?.label ?? compactRef(elementId);
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
  const profileRef = activeView.value?.profileRef ?? profileChoices.value[0] ?? "";
  viewForm.value = {
    viewId: allocateViewId("view"),
    profileRef,
    layoutRef: standardLayoutRefForDirection("LR"),
    layoutDirection: "LR",
    locale: activeView.value?.locale ?? "",
  };
  openViewDialog("add");
}

function openConfigureViewDialog(): void {
  const view = activeView.value;
  if (!view) return;
  viewForm.value = {
    viewId: view.viewId,
    profileRef: view.profileRef,
    layoutRef: view.layoutRef,
    layoutDirection: layoutDirectionForRef(view.layoutRef) ?? "",
    locale: view.locale ?? "",
  };
  openViewDialog("configure");
}

function closeViewDialog(): void {
  if (viewCommandBusy.value) return;
  finishViewDialog();
}

function openViewDialog(mode: "add" | "configure"): void {
  viewDialogReturnFocus = document.activeElement instanceof HTMLElement
    ? document.activeElement
    : undefined;
  viewDialogMode.value = mode;
  void nextTick(() => {
    viewDialogInitialFocus.value?.focus();
  });
}

function finishViewDialog(): void {
  viewDialogMode.value = undefined;
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
  const layoutRef = form.layoutDirection
    ? viewDialogMode.value === "add"
      ? standardLayoutRefForDirection(form.layoutDirection)
      : layoutRefForDirection(form.layoutRef, form.layoutDirection) ?? form.layoutRef
    : form.layoutRef;
  const command: ViewCommand = viewDialogMode.value === "add"
    ? {
        command: "add",
        viewId: form.viewId,
        profileRef: form.profileRef,
        layoutRef,
        ...(form.locale.trim() ? { locale: form.locale.trim() } : {}),
      }
    : {
        command: "configure",
        viewId: form.viewId,
        profileRef: form.profileRef,
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

async function resetActiveViewOverlay(): Promise<void> {
  const view = activeView.value;
  if (!view) return;
  await executeViewCommand({ command: "reset-overlay", viewId: view.viewId });
}

async function executeViewCommand(command: ViewCommand): Promise<boolean> {
  if (props.readOnly || viewCommandBusy.value) return false;
  if (turtlePending.value || structuredAuthoringPending.value) {
    applyDiagnostics.value = [{
      severity: "error",
      category: "projection",
      code: "view-command-semantic-draft-pending",
      message: "未適用のsemantic draftを適用または破棄してからviewを変更してください。",
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
): void {
  if (props.readOnly) return;
  const next = clone(draft.value);
  mutation(next);
  if (JSON.stringify(next) === JSON.stringify(draft.value)) return;
  publish(next, recordHistory, "presentation");
}

function publish(
  next: IriographDocument,
  recordHistory: boolean,
  refreshKind: DocumentRefreshKind,
  preparedScene?: DiagramScene,
): Promise<void> {
  invalidateAuthoringPreview();
  if (recordHistory) {
    history.value.push(clone(draft.value));
    trimHistory();
    future.value = [];
  }
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
  if (rightSidebarCollapsed.value && appearanceEditorOpen.value) closeAppearanceEditor();
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

function templateDisplayLabel(template: VisualTemplate): string {
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
  return labels[token] ?? token.replaceAll("-", " ");
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
        <button type="button" :disabled="!canSave || saving || applyingTurtle || authoringBusy" @click="requestSave">
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
            :value="activeView?.viewId ?? ''"
            :disabled="viewCommandBusy"
            aria-label="Named view"
            @change="requestActiveView"
          >
            <option v-for="view in draft.views" :key="view.viewId" :value="view.viewId">
              {{ view.viewId }}
            </option>
          </select>
          <details class="iriograph-technical-details"><summary>技術情報</summary><code>{{ activeView?.profileRef }}</code></details>
          <div class="iriograph-view-actions" aria-label="Named view actions">
            <button type="button" :disabled="readOnly || viewCommandBusy" @click="openAddViewDialog">追加</button>
            <button type="button" :disabled="readOnly || viewCommandBusy || !activeView" @click="duplicateActiveView">複製</button>
            <button type="button" :disabled="readOnly || viewCommandBusy || !activeView" @click="openConfigureViewDialog">設定</button>
            <button
              type="button"
              :disabled="readOnly || viewCommandBusy || draft.views.length <= 1"
              @click="deleteActiveView"
            >削除</button>
            <button type="button" :disabled="readOnly || viewCommandBusy || !activeView" @click="resetActiveViewOverlay">
              ビュー調整をリセット
            </button>
          </div>
          <div>
            <span><b>{{ scene.nodes.length }}</b> 要素</span>
            <span><b>{{ scene.edges.length }}</b> 関係</span>
            <span><b>{{ scene.containers.length + (scene.regions?.length ?? 0) }}</b> 領域</span>
          </div>
        </section>
        <nav class="iriograph-element-list" aria-label="Scene elements">
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
        <nav class="iriograph-view-tabs" aria-label="Canvasとsource表示を切り替え" role="group">
          <button type="button" :class="{ active: panel === 'diagram' }" :aria-pressed="panel === 'diagram'" @click="panel = 'diagram'">◇ Diagram</button>
          <button type="button" :class="{ active: panel === 'turtle' }" :aria-pressed="panel === 'turtle'" @click="panel = 'turtle'">≡ Turtle</button>
          <button type="button" :class="{ active: panel === 'document' }" :aria-pressed="panel === 'document'" @click="panel = 'document'">{ } Document</button>
          <button type="button" :class="{ active: panel === 'catalog' }" :aria-pressed="panel === 'catalog'" @click="panel = 'catalog'">⌘ Catalog</button>
        </nav>

        <section v-show="panel === 'diagram'" class="iriograph-diagram-panel">
          <div class="iriograph-canvas-toolbar">
            <div class="iriograph-history-actions">
              <button type="button" :disabled="!canUndo || readOnly" title="Undo (Ctrl/Cmd+Z)" @click="undo">↶</button>
              <button type="button" :disabled="!canRedo || readOnly" title="Redo (Ctrl/Cmd+Y)" @click="redo">↷</button>
              <span />
              <small>{{ layoutPurposeLabel(activeView?.layoutRef) }}</small>
              <details v-if="activeView?.layoutRef" class="iriograph-toolbar-technical"><summary>技術情報</summary><code>{{ activeView.layoutRef }}</code></details>
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
            </div>
          </div>
          <div class="iriograph-selection-toolbar" aria-label="Selection and geometry tools">
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
            <div class="iriograph-snap-actions" aria-label="Snap settings">
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
            <span v-if="!sceneLoading && sceneError">{{ sceneError.message }}</span>
          </div>
          <DiagramCanvas
            ref="diagramCanvas"
            :scene="renderedScene"
            :selected-element-id="selectedElementId"
            :selected-element-ids="selectedElementIds"
            :zoom="zoom"
            :snap="snapSettings"
            :read-only="readOnly || sceneLoading || applyingTurtle || authoringBusy"
            :busy="sceneLoading || applyingTurtle || authoringBusy"
            :semantic-position-picking="authoringDraft.positionPicking"
            :semantic-resource-picking="Boolean(authoringResourcePicker)"
            :semantic-resource-pick-label="authoringResourcePickerLabel"
            :semantic-draft-position="authoringDraftPosition"
            :containment-warning-element-ids="containmentWarningElementIds"
            :semantic-metadata="semanticMetadata"
            :show-all-comments="showAllComments"
            :show-grid="showCanvasGrid"
            :edge-route-modes="edgeRouteModes"
            :node-content-editing="inspectorMode === 'appearance' && displayInspectorAction === 'appearance' && selectedElement?.structuralKind === 'node'"
            :semantic-endpoint-reconnect="inspectorMode === 'semantic' && Boolean(intentEdgeDetails && !intentEdgeDetails.derivedReason)"
            :deletion-preview-resource-refs="authoringDeletionPreview?.resourceSemanticRefs"
            :deletion-preview-statement-refs="authoringDeletionPreview?.statementRefs"
            @zoom-change="setZoomState"
            @selection-request="applySelectionRequest"
            @selection-set-request="selectElements"
            @gesture-start="beginGesture"
            @gesture-end="endGesture"
            @resize-change="changeGeometry"
            @geometry-batch-change="changeGeometryBatch"
            @routing-update="changeRouting"
            @node-content-offset-update="changeNodeContentOffset"
            @region-label-update="updateRegionLabelAnchor"
            @semantic-position-request="seedDraftPosition"
            @semantic-resource-request="seedDraftResource"
            @semantic-endpoint-reconnect-request="seedSemanticEdgeEndpoint"
            @semantic-edit-request="requestSemanticDeletion"
            @semantic-pick-cancel="cancelAuthoringPicking"
            @context-menu-request="openContextMenu"
          />
        </section>

        <section v-if="panel !== 'diagram'" class="iriograph-source-panel">
          <header>
            <div>
              <small>{{ panel.toUpperCase() }}</small>
              <strong v-if="panel === 'turtle'">Semantic source</strong>
              <strong v-else-if="panel === 'document'">Portable document</strong>
              <strong v-else>Projection catalog</strong>
            </div>
            <span v-if="panel === 'turtle'">LLM-visible boundary</span>
            <span v-else-if="panel === 'document'">意味とビュー設定</span>
            <span v-else>declarative source</span>
          </header>
          <template v-if="panel === 'turtle'">
            <textarea
              ref="turtleTextarea"
              v-model="turtleDraft"
              :readonly="readOnly || structuredAuthoringPending"
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
          <pre v-else><code>{{ panel === "document" ? documentJson : catalogJson }}</code></pre>
        </section>
      </main>

      <aside v-show="!rightSidebarCollapsed" :id="rightSidebarId" class="iriograph-inspector">
        <nav class="iriograph-inspector-mode-tabs" aria-label="編集する情報">
          <button type="button" :class="{ selected: inspectorMode === 'semantic' }" :aria-pressed="inspectorMode === 'semantic'" @click="inspectorMode = 'semantic'">意味</button>
          <button type="button" :class="{ selected: inspectorMode === 'appearance' }" :aria-pressed="inspectorMode === 'appearance'" @click="inspectorMode = 'appearance'">ビュー</button>
        </nav>
        <SemanticIntentPanel
          ref="semanticIntentPanel"
          v-show="inspectorMode === 'semantic'"
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
          :memberships="intentMembershipOptions"
          :sequences="intentSequenceOptions"
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
          <nav class="iriograph-display-actions" aria-label="ビューの編集操作">
            <button
              type="button"
              :class="{ selected: displayInspectorAction === 'appearance' }"
              :aria-current="displayInspectorAction === 'appearance' ? 'step' : undefined"
              @click="selectDisplayInspectorAction('appearance', $event)"
            >スタイル</button>
            <button
              v-if="'geometry' in selectedElement"
              type="button"
              :class="{ selected: displayInspectorAction === 'geometry' }"
              :aria-current="displayInspectorAction === 'geometry' ? 'step' : undefined"
              @click="selectDisplayInspectorAction('geometry', $event)"
            >位置・サイズ</button>
            <button
              v-if="selectedElement.structuralKind === 'region'"
              type="button"
              :class="{ selected: displayInspectorAction === 'region-label' }"
              :aria-current="displayInspectorAction === 'region-label' ? 'step' : undefined"
              @click="selectDisplayInspectorAction('region-label', $event)"
            >ラベルの配置</button>
            <button
              v-if="selectedElement.structuralKind === 'edge'"
              type="button"
              :class="{ selected: displayInspectorAction === 'routing' }"
              :aria-current="displayInspectorAction === 'routing' ? 'step' : undefined"
              @click="selectDisplayInspectorAction('routing', $event)"
            >線の表示</button>
          </nav>
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
          <section v-if="displayInspectorAction === 'appearance'">
            <button v-if="!appearanceEditorOpen" type="button" class="iriograph-wide-button" :disabled="readOnly" @click="openAppearanceEditor">ビューを編集</button>
            <AppearanceEditor
              v-else-if="appearancePrimaryElement"
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
              @close="closeAppearanceEditor"
            />
            <template v-if="selectedElement.structuralKind !== 'edge'">
              <label>形</label>
              <div class="iriograph-template-choices" role="radiogroup" aria-label="要素の形">
                <button
                  v-for="template in templateChoices"
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
                  <span><b>{{ templateDisplayLabel(template) }}</b><small>{{ templateShapeLabel(template) }}</small></span>
                </button>
              </div>
            </template>
          </section>
          <section v-if="displayInspectorAction === 'appearance' && selectedElement.structuralKind === 'node'">
            <label>アイコン</label>
            <div class="iriograph-package-icon-choices" role="radiogroup" aria-label="同梱アイコン">
              <button type="button" :aria-pressed="!selectedElement.iconRef" :disabled="readOnly" @click="updateAppearance('iconRef', undefined)"><span>なし</span></button>
              <button
                v-for="icon in packageDefaultIcons"
                :key="icon.assetRef"
                type="button"
                :aria-pressed="selectedElement.iconRef === icon.assetRef"
                :disabled="readOnly"
                @click="updateAppearance('iconRef', icon.assetRef)"
              ><img :src="packageIconPreviewUrl(icon.assetRef)" alt="" /><span>{{ icon.label }}</span></button>
            </div>
            <label :for="iconPathInputId">Workspace画像のパス</label>
            <input
              :id="iconPathInputId"
              :list="assetSuggestionsListId"
              :value="iconInputValue"
              :disabled="readOnly"
              @change="updateIcon"
              placeholder="例: assets/approval-policy.svg"
              autocomplete="off"
            />
            <datalist :id="assetSuggestionsListId">
              <option v-for="option in assetOptions.filter((candidate) => candidate.path)" :key="option.assetRef" :value="option.path">{{ option.label ?? option.path }}</option>
            </datalist>
            <small>現在: {{ selectedIconLabel }}。候補からpathを選択できます。ファイルには画像そのものではなく参照だけを保存します。</small>
            <button
              v-if="pickAsset"
              type="button"
              class="iriograph-wide-button"
              :disabled="readOnly || pickingAsset"
              @click="chooseAssetIcon"
            >
              {{ pickingAsset ? "画像を選択中…" : "Workspace画像を選択" }}
            </button>
            <div class="iriograph-node-content-placement">
              <label>要素内の配置</label>
              <small class="iriograph-node-content-guidance">Canvas上のラベルやアイコンをドラッグして、この要素の中で位置を調整できます。</small>
              <label>ラベルの文字方向</label>
              <select
                aria-label="Node label writing direction"
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
          </section>
          <section v-if="displayInspectorAction === 'region-label' && selectedElement.structuralKind === 'region'">
            <p>Canvas上のラベルをドラッグすると、領域の枠線に沿って自由に移動できます。</p>
            <label>文字方向</label>
            <select aria-label="Region label writing direction" :value="regionLabelWritingDirectionFor(selectedElement.elementId)" :disabled="readOnly" @change="updateSelectedRegionLabelWritingDirection">
              <option value="horizontal-right">横書き（左から右）</option>
              <option value="vertical-down">縦書き（上から下）</option>
            </select>
            <small>横書きは右向き、縦書きは下向きに統一します。</small>
            <div class="iriograph-region-layer-actions">
              <button type="button" :disabled="readOnly" @click="moveSelectedRegionLayer('back')">領域を背面へ</button>
              <button type="button" :disabled="readOnly" @click="moveSelectedRegionLayer('front')">領域を前面へ</button>
            </div>
          </section>
          <section v-if="displayInspectorAction === 'geometry' && 'geometry' in selectedElement">
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
          </section>
          <section v-if="displayInspectorAction === 'routing' && selectedElement.structuralKind === 'edge'" class="iriograph-routing-inspector">
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
            <label>端子の形</label>
            <div class="iriograph-endpoint-marker-fields">
              <label v-for="endpoint in (['source', 'target'] as const)" :key="endpoint">
                <span>{{ endpoint === 'source' ? '始点' : '終点' }}</span>
                <select
                  :aria-label="`${endpoint} terminal marker`"
                  :value="selectedElement[endpoint === 'source' ? 'sourceMarker' : 'targetMarker'] ?? (endpoint === 'source' ? 'none' : 'arrow')"
                  :disabled="readOnly"
                  @change="setSelectedTerminalMarker(endpoint, ($event.target as HTMLSelectElement).value as EdgeTerminalMarker)"
                >
                  <option value="none">なし</option><option value="arrow">矢印</option><option value="open-arrow">開いた矢印</option><option value="triangle">三角</option><option value="diamond">ひし形</option><option value="circle">丸</option>
                </select>
              </label>
            </div>
            <details class="iriograph-view-disclosure">
              <summary>ラベルと補足を調整</summary>
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
            <details class="iriograph-view-disclosure">
              <summary>接続位置を調整</summary>
              <p>Canvas上の始点・終点ハンドルを要素の周囲へドラッグします。数値入力は必要ありません。</p>
              <button
                type="button"
                class="iriograph-wide-button"
                :disabled="readOnly || (!selectedElement.sourceAnchor && !selectedElement.targetAnchor)"
                @click="resetSelectedEndpointAnchors"
              >接続位置を自動に戻す</button>
            </details>
            <button
              type="button"
              class="iriograph-wide-button"
              :disabled="readOnly || !hasSelectedEditableRouting"
              @click="resetSelectedRouting"
            >線の調整をすべてリセット</button>
          </section>
          <section v-if="displayInspectorAction === 'geometry' && selectedElement.structuralKind !== 'edge' && selectedOverlay?.placement === 'user'">
            <button type="button" class="iriograph-wide-button" :disabled="readOnly" @click="clearSelectedOverride">ユーザー調整を解除</button>
          </section>
        </template>
        <details class="iriograph-overlay-preview">
          <summary>Advanced: View overlay ({{ Object.keys(activeView?.overlay ?? {}).length }})</summary>
          <pre>{{ overlayJson }}</pre>
        </details>
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
          <strong :id="viewDialogTitleId">{{ viewDialogMode === "add" ? "Named viewを追加" : "View設定" }}</strong>
          <button type="button" aria-label="閉じる" :disabled="viewCommandBusy" @click="closeViewDialog">×</button>
        </header>
        <label>
          View ID
          <input ref="viewDialogInitialFocus" v-model="viewForm.viewId" :readonly="viewDialogMode === 'configure'" required />
          <small v-if="viewDialogMode === 'configure'">viewIdは作成後に変更できません。</small>
        </label>
        <label>
          Profile
          <select v-model="viewForm.profileRef" required>
            <option v-for="profileRef in profileChoices" :key="profileRef" :value="profileRef">{{ profileRef }}</option>
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
          <details class="iriograph-technical-details"><summary>技術情報</summary><code>{{ viewForm.layoutRef }}</code></details>
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
      </form>
    </div>

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
          <strong :id="deletionDialogTitleId">選択外の情報も削除されます</strong>
          <button type="button" aria-label="削除をキャンセル" :disabled="authoringBusy" @click="cancelPendingDeletion">×</button>
        </header>
        <p>選択した要素を削除すると、次の関係・所属・並び順も同じ操作で削除されます。</p>
        <ul aria-label="削除の影響一覧">
          <li v-for="impact in pendingDeletion.impacts" :key="impact.key">
            <small>{{ impact.kind === 'relation' ? '関係' : impact.kind === 'sequence' ? '並び順' : '所属' }}</small>
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

    <ResourceCreationPalette
      v-if="creationPalette"
      :kind="creationPalette.kind"
      :cards="creationPaletteCards"
      :resources="authoringResourceChoices"
      :classes="authoringClassChoices"
      :containers="authoringContainerChoices"
      :predicates="authoringEdgeChoices"
      :memberships="authoringStructureChoices.filter((item) => item.kind === 'membership')"
      :position="creationPalette.position"
      :container-iri="creationPalette.containerIri"
      :initial-class-iris="creationPalette.classIris"
      @seed="seedCreationDraft"
      @close="creationPalette = undefined"
    />
    <ResourceDetailsDialog
      v-if="detailsDialogTarget"
      :document="draft"
      :subject-iri="detailsDialogTarget.semanticRef"
      :title="detailsDialogTarget.label"
      :terms="authoringContext?.terms ?? []"
      :resources="authoringResourceChoices"
      :busy="authoringBusy"
      :notice="detailsDialogTarget.notice"
      @execute="executeDetailsCommands"
      @close="detailsDialogElementId = ''"
    />
  </article>
</template>
