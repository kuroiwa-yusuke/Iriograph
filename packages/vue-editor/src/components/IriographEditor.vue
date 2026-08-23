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
  previewAuthoringCommands,
  seedAuthoringCommandFromProvenance,
  semanticSourceFingerprint,
  validateSemanticDocument,
  validateIriographDocumentV1,
  validateProjectionCatalogV1,
  type AuthoringPreview,
  type AuthoringTripleChange,
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
  type ViewElementOverlay,
  type ViewCommand,
} from "@iriograph/core";

import AuthoringPanel from "./AuthoringPanel.vue";
import DiagramCanvas from "./DiagramCanvas.vue";
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
  appendEdgeWaypoint,
  normalizeEditableRouting,
  removeEdgeWaypoint,
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
  type GeometryChange,
  type IriographEditorSelectionApi,
} from "../selection";

type Panel = "diagram" | "turtle" | "document" | "catalog";
type SelectedElement = SceneNode | SceneContainer | SceneEdge;

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
  assetAccess?: AssetAccess;
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
  assetAccess: undefined,
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
const authoringPreview = ref<AuthoringPreview>();
const authoringResourcePicker = ref<AuthoringResourcePickerTarget>();
const authoringBusy = ref(false);
const pickingAsset = ref(false);
const viewCommandBusy = ref(false);
const viewDialogMode = ref<"add" | "configure">();
const viewForm = ref({ viewId: "", profileRef: "", layoutRef: "", locale: "" });
const viewDialog = ref<HTMLFormElement>();
const viewDialogInitialFocus = ref<HTMLInputElement>();
const viewDialogTitleId = `${useId()}-view-dialog-title`;
let viewDialogReturnFocus: HTMLElement | undefined;
const defaultLayoutRegistry = createStandardLayoutRegistry();
const assetSceneSession = new AssetSceneSession();
let lastEmittedJson = "";
let gestureBefore: IriographDocument | undefined;
let sceneRequestToken = 0;
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
const containmentWarnings = computed(() => findContainmentConsistencyWarnings(scene.value));
const containmentWarningElementIds = computed(() => [...new Set(
  containmentWarnings.value.map((warning) => warning.elementId),
)]);
const selectedElementIdsSet = computed(() => new Set(selectedElementIds.value));
const selectedElement = computed<SelectedElement | undefined>(() => [
  ...scene.value.nodes,
  ...scene.value.containers,
  ...scene.value.edges,
].find((element) => element.elementId === selectedElementId.value));
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
const layoutChoices = computed(() => [...new Set([
  ...draft.value.views.map((view) => view.layoutRef),
  "urn:iriograph:layout:hierarchical-lr:1",
  "urn:iriograph:layout:hierarchical-tb:1",
])].sort((left, right) => left < right ? -1 : left > right ? 1 : 0));
const selectedEdge = computed(() => selectedElement.value?.structuralKind === "edge"
  ? selectedElement.value
  : undefined);
const selectedManualWaypoints = computed(() => selectedEdge.value?.waypoints ?? []);
const hasSelectedEditableRouting = computed(() => Boolean(
  selectedEdge.value?.waypoints?.length
    || selectedEdge.value?.labelOffset
    || selectedEdge.value?.sourceAnchor
    || selectedEdge.value?.targetAnchor,
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
  authoringDraftHasInput(authoringDraft.value) || Boolean(authoringPreview.value)
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
const authoringClassChoices = computed<AuthoringChoice[]>(() => authoringContext.value?.terms
  .filter((term) => term.kind === "class")
  .map(({ iri, label }) => ({ iri, label })) ?? []);
const authoringPropertyChoices = computed<AuthoringChoice[]>(() => authoringContext.value?.terms
  .filter((term) => term.kind === "property" && !term.structural)
  .map(({ iri, label }) => ({ iri, label })) ?? []);
const authoringEdgeChoices = computed<AuthoringChoice[]>(() => authoringContext.value?.terms
  .filter((term) => (
    term.kind === "property"
    && !term.structural
    && (!term.objectKinds || term.objectKinds.includes("iri"))
  ))
  .map(({ iri, label }) => ({ iri, label })) ?? []);
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
  const provenances = [
    ...scene.value.containers.flatMap((element) => [element.provenance, element.parentProvenance]),
    ...scene.value.nodes.flatMap((element) => [element.provenance, element.parentProvenance]),
    ...scene.value.edges.map((element) => element.provenance),
  ];
  for (const provenance of provenances) {
    const capability = provenance?.editCapability;
    if (!capability) continue;
    for (const iri of capabilityResourceIris(capability)) add(iri);
  }
  return [...choices.values()];
});
const selectedAuthoringResource = computed<AuthoringChoice | undefined>(() => {
  const element = selectedElement.value;
  return element && element.structuralKind !== "edge"
    ? { iri: element.semanticRef, label: element.label }
    : undefined;
});
const authoringResourcePickerLabel = computed(() => {
  const target = authoringResourcePicker.value;
  if (!target) return "resource";
  if (target.field === "propertyValue") return `Property value ${target.index + 1}`;
  return {
    subjectIri: "Property subject",
    sourceIri: "Edge source",
    targetIri: "Edge target",
    containerIri: "Membership container",
    memberIri: "Membership member",
    structureIri: "Structure",
    resourceIri: "Delete resource",
    createEdgeResourceIri: "Create edge resource",
    createMembershipContainerIri: "Create membership container",
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
    if (rule.match.kind !== "type") return [];
    const operator = rule.project;
    if (operator.operator === "membership-container") {
      return [{
        key: structureKey("membership", rule.match.iri, operator.membershipPredicate),
        kind: "membership",
        label: `${rule.ruleId} — membership`,
        ruleId: rule.ruleId,
        typeIri: rule.match.iri,
        predicateIri: operator.membershipPredicate,
      }];
    }
    if (operator.operator === "ordinal-sequence") {
      return [{
        key: structureKey("sequence", rule.match.iri, operator.ordinalPredicatePrefix),
        kind: "sequence",
        label: `${rule.ruleId} — sequence`,
        ruleId: rule.ruleId,
        typeIri: rule.match.iri,
        ordinalPredicatePrefix: operator.ordinalPredicatePrefix,
      }];
    }
    if (operator.operator === "alternative") {
      return [{
        key: structureKey(
          "alternatives",
          rule.match.iri,
          operator.ordinalPredicatePrefix,
          operator.defaultOrdinal,
        ),
        kind: "alternatives",
        label: `${rule.ruleId} — alternatives (default #${operator.defaultOrdinal})`,
        ruleId: rule.ruleId,
        typeIri: rule.match.iri,
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
      label: "現在の構成（provenance）",
      typeIri: draft.containerTypeIri,
      predicateIri: draft.membershipPredicateIri,
    };
  }
  if (draft.kind === "set-sequence" && draft.sequenceTypeIri && draft.ordinalPredicatePrefix) {
    return {
      key: structureKey("sequence", draft.sequenceTypeIri, draft.ordinalPredicatePrefix),
      kind: "sequence",
      label: "現在の構成（provenance）",
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
      label: "現在の構成（provenance）",
      typeIri: draft.alternativeTypeIri,
      ordinalPredicatePrefix: draft.ordinalPredicatePrefix,
      defaultOrdinal: Number(draft.defaultOrdinal),
    };
  }
  return undefined;
}

function authoringOperationLabel(kind: EditorAuthoringDraft["kind"]): string {
  return {
    "create-resource": "Resourceを作成",
    "set-property": "属性を設定",
    "connect-resources": "Resourceを接続",
    "set-membership": "包含を設定",
    "set-sequence": "順序を設定",
    "set-alternatives": "選択肢を設定",
    "delete-resource": "Resourceを削除",
    "remove-statement": "元tripleを削除",
    "apply-capability": "Capability patch",
  }[kind];
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
      add(value.resourceIri, "作成", value.label || "新しいresource");
      if (value.createEdgeEnabled) add(value.createEdgeResourceIri, "接続先");
      if (value.createMembershipEnabled) add(value.createMembershipContainerIri, "Container");
      break;
    case "set-property":
      add(value.subjectIri, "Subject");
      for (const item of value.propertyValues) if (item.objectKind === "iri") add(item.value, "Value");
      break;
    case "connect-resources":
      add(value.sourceIri, "Source");
      add(value.targetIri, "Target");
      break;
    case "set-membership":
      add(value.containerIri, "Container");
      add(value.memberIri, "Member");
      break;
    case "set-sequence":
    case "set-alternatives":
      add(value.structureIri, "Structure");
      for (const member of value.membersText.split(/\r?\n/u).map((item) => item.trim()).filter(Boolean)) add(member, "Member");
      break;
    case "delete-resource":
      add(value.resourceIri, "削除対象");
      break;
    case "remove-statement":
      add(value.statementSubject, "Subject");
      add(value.statementObject, "Object");
      break;
    case "apply-capability":
      for (const [name, binding] of Object.entries(value.capabilityBindings)) {
        if (binding.enabled && binding.objectKind === "iri") add(binding.value, name);
      }
      break;
  }
  return chips.filter((chip, index) => chips.findIndex((candidate) => (
    candidate.iri === chip.iri && candidate.role === chip.role
  )) === index);
}

function authoringPreviewRelations(
  value: EditorAuthoringDraft,
): AuthoringPreviewView["relations"] {
  const labelFor = (iri: string, choices: AuthoringChoice[]) => (
    choices.find((item) => item.iri === iri)?.label || compactRef(iri)
  );
  if (value.kind === "create-resource") {
    return [
      ...(value.createEdgeEnabled
        ? [{ kind: "edge" as const, label: labelFor(value.createEdgePredicateIri, authoringEdgeChoices.value) }]
        : []),
      ...(value.createMembershipEnabled
        ? [{ kind: "membership" as const, label: authoringStructureChoices.value.find((item) => item.key === value.createMembershipStructureConfigKey)?.label || "包含" }]
        : []),
    ];
  }
  if (value.kind === "set-membership") {
    return [{ kind: "membership", label: authoringStructureChoices.value.find((item) => item.key === value.structureConfigKey)?.label || "包含" }];
  }
  if (value.kind === "connect-resources" || value.kind === "set-property") {
    return [{ kind: "edge", label: labelFor(value.predicateIri, value.kind === "connect-resources" ? authoringEdgeChoices.value : authoringPropertyChoices.value) }];
  }
  if (value.kind === "remove-statement") {
    return [{ kind: "edge", label: labelFor(value.statementPredicate, authoringPropertyChoices.value) }];
  }
  return [];
}
const authoringPreviewView = computed<AuthoringPreviewView | undefined>(() => {
  const preview = authoringPreview.value;
  if (!preview) return undefined;
  return {
    confirmationId: preview.confirmationId,
    valid: preview.valid,
    diagnostics: preview.diagnostics,
    addedStatements: preview.patch.added.map(formatTripleChange),
    removedStatements: preview.patch.removed.map(formatTripleChange),
    candidateSource: preview.candidateSource ?? "",
    operationLabel: authoringOperationLabel(authoringDraft.value.kind),
    resourceChips: authoringPreviewResourceChips(authoringDraft.value),
    relations: authoringPreviewRelations(authoringDraft.value),
  };
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
  return props.dirty || turtlePending.value || structuredAuthoringPending.value ? "未保存" : "保存済み";
});
const nodeTemplateRefs = computed(() => Object.values(activeCatalog.value?.templates ?? {})
  .filter((template) => template.structuralKind === selectedElement.value?.structuralKind)
  .map((template) => template.templateRef));
const assetRefs = computed(() => Object.keys(activeCatalog.value?.assets ?? {}));
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
    saveActiveViewSession();
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
    void refreshScene();
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
  const assetAccess = props.assetAccess;
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
    const result = assetAccess
      ? await assetSceneSession.enrich(assetRequest, projected, catalog.assets, assetAccess)
      : assetSceneSession.commitWithoutAssets(assetRequest, projected);
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
    }
  }
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
  if (primary !== selectedElementId.value) cancelAssetPicker();
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
  mutateDocument((document) => {
    const element = geometryElement(payload.elementId);
    const view = document.views.find((candidate) => candidate.viewId === currentActiveViewId.value);
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

function changeGeometryBatch(changes: readonly GeometryChange[], recordHistory = false): void {
  if (changes.length === 0) return;
  mutateDocument((document) => {
    const view = document.views.find((candidate) => candidate.viewId === currentActiveViewId.value);
    if (!view) return;
    for (const change of changes) {
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

function changeRouting(payload: EdgeRoutingUpdate, recordHistory = false): void {
  mutateDocument((document) => {
    const edge = scene.value.edges.find((candidate) => candidate.elementId === payload.elementId);
    const view = document.views.find((candidate) => candidate.viewId === currentActiveViewId.value);
    if (!edge || !view) return;
    const current = view.overlay[payload.elementId] ?? { semanticRef: edge.semanticRef };
    const requestedRouting = payload.routing && !edge.label
      ? { ...payload.routing, labelOffset: undefined }
      : payload.routing;
    const routingValue = normalizeEditableRouting(requestedRouting);
    const routing = routingValue || current.routing?.extensions
      ? {
          ...routingValue,
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

function addSelectedWaypoint(): void {
  const edge = selectedEdge.value;
  if (!edge) return;
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

function removeSelectedWaypoint(index: number): void {
  const edge = selectedEdge.value;
  if (!edge) return;
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

function updateWaypointField(index: number, field: "x" | "y", event: Event): void {
  const edge = selectedEdge.value;
  const value = Number((event.target as HTMLInputElement).value);
  if (!edge?.waypoints?.[index] || !Number.isFinite(value)) return;
  const waypoints = edge.waypoints.map((point) => ({ ...point }));
  waypoints[index]![field] = clamp(
    value,
    8,
    Math.max(8, (field === "x" ? scene.value.width : scene.value.height) - 8),
  );
  changeRouting({
    elementId: edge.elementId,
    routing: {
      waypoints,
      labelOffset: edge.labelOffset,
      sourceAnchor: edge.sourceAnchor,
      targetAnchor: edge.targetAnchor,
    },
  }, true);
}

function updateLabelOffsetField(field: "x" | "y", event: Event): void {
  const edge = selectedEdge.value;
  const value = Number((event.target as HTMLInputElement).value);
  if (!edge?.label || !Number.isFinite(value)) return;
  changeRouting({
    elementId: edge.elementId,
    routing: {
      waypoints: edge.waypoints,
      sourceAnchor: edge.sourceAnchor,
      targetAnchor: edge.targetAnchor,
      labelOffset: {
        x: field === "x" ? value : edge.labelOffset?.x ?? 0,
        y: field === "y" ? value : edge.labelOffset?.y ?? 0,
      },
    },
  }, true);
}

function resetSelectedLabelOffset(): void {
  const edge = selectedEdge.value;
  if (!edge?.label) return;
  changeRouting({
    elementId: edge.elementId,
    routing: {
      waypoints: edge.waypoints,
      sourceAnchor: edge.sourceAnchor,
      targetAnchor: edge.targetAnchor,
    },
  }, true);
}

function updateEndpointAnchor(
  endpoint: "source" | "target",
  event: Event,
): void {
  const edge = selectedEdge.value;
  const value = Number((event.target as HTMLInputElement).value);
  if (!edge || !Number.isFinite(value) || value < 0 || value >= 1) return;
  changeRouting({
    elementId: edge.elementId,
    routing: routingWithEndpointAnchor(edge, endpoint, { position: value }),
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

function resetSelectedRouting(): void {
  const edge = selectedEdge.value;
  if (!edge) return;
  changeRouting({ elementId: edge.elementId }, true);
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
    if (next.kind === "set-property") next.subjectIri = selected.semanticRef;
    if (next.kind === "connect-resources") next.sourceIri = selected.semanticRef;
    if (next.kind === "set-membership") {
      if (selected.structuralKind === "container") next.containerIri = selected.semanticRef;
      else next.memberIri = selected.semanticRef;
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

async function previewStructuredAuthoring(): Promise<void> {
  const context = authoringContext.value;
  if (!context || !authoringEnabled.value || authoringBusy.value) return;
  cancelAuthoringRequest();
  const requestToken = ++authoringRequestToken;
  const controller = new AbortController();
  authoringAbortController = controller;
  const sourceDocument = clone(draft.value);
  const sourceJson = JSON.stringify(sourceDocument);
  const draftJson = JSON.stringify(authoringDraft.value);
  authoringBusy.value = true;
  try {
    const commands = compileAuthoringDraft(
      clone(authoringDraft.value),
      activeView.value?.viewId ?? "",
    );
    const preview = await previewAuthoringCommands(sourceDocument, commands, context, {
      allocator: props.resourceIriAllocator ?? context.allocator,
      signal: controller.signal,
    });
    if (
      requestToken !== authoringRequestToken
      || controller.signal.aborted
      || props.readOnly
      || JSON.stringify(draft.value) !== sourceJson
      || JSON.stringify(authoringDraft.value) !== draftJson
    ) return;
    authoringPreview.value = preview;
    applyDiagnostics.value = clone(preview.diagnostics);
  } catch (cause) {
    if (requestToken !== authoringRequestToken || controller.signal.aborted) return;
    authoringPreview.value = undefined;
    applyDiagnostics.value = [authoringFailureDiagnostic("authoring-preview-failed", cause)];
  } finally {
    if (requestToken === authoringRequestToken) {
      authoringAbortController = undefined;
      authoringBusy.value = false;
    }
  }
}

async function applyStructuredAuthoring(): Promise<void> {
  const context = authoringContext.value;
  const preview = authoringPreview.value;
  if (
    !context
    || !preview?.valid
    || !authoringEnabled.value
    || authoringBusy.value
    || props.readOnly
  ) return;
  cancelAuthoringRequest();
  const requestToken = ++authoringRequestToken;
  const controller = new AbortController();
  authoringAbortController = controller;
  const previous = clone(draft.value);
  const previousJson = JSON.stringify(previous);
  authoringBusy.value = true;
  try {
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
    resetAuthoringDraft();
    publish(result.document, true);
    turtleDraft.value = result.document.semantic.source;
  } catch (cause) {
    if (requestToken !== authoringRequestToken || controller.signal.aborted) return;
    applyDiagnostics.value = [authoringFailureDiagnostic("authoring-apply-failed", cause)];
  } finally {
    if (requestToken === authoringRequestToken) {
      authoringAbortController = undefined;
      authoringBusy.value = false;
    }
  }
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

function seedParentRemoval(): void {
  const element = selectedElement.value;
  if (!element || element.structuralKind === "edge" || props.readOnly) return;
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
  seedFromProvenance(element?.parentProvenance?.editCapability, "containment-warning-remove");
}

function canSeedContainmentRemoval(warning: ContainmentConsistencyWarning): boolean {
  return warning.kind === "semantic-only"
    && Boolean(geometryElement(warning.elementId)?.parentProvenance?.editCapability);
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
  updateAuthoringDraft({
    ...authoringDraft.value,
    initialX: String(Math.round(bounded.x)),
    initialY: String(Math.round(bounded.y)),
    positionPicking: false,
    ...(containerIri ? createMembershipSeed(containerIri) : {}),
  });
}

function createMembershipSeed(containerIri: string): Partial<EditorAuthoringDraft> {
  const container = scene.value.containers.find((item) => item.semanticRef === containerIri);
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

function membershipChoicesForContainer(container: SceneContainer): AuthoringStructureChoice[] {
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
    next[target.field] = semanticRef;
  }
  authoringResourcePicker.value = undefined;
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
  authoringPreview.value = undefined;
  applyDiagnostics.value = [];
}

function resetAuthoringDraft(): void {
  authoringDraft.value = emptyAuthoringDraft();
  authoringResourcePicker.value = undefined;
  authoringPreview.value = undefined;
}

function invalidateAuthoringPreview(): void {
  cancelAuthoringRequest();
  authoringPreview.value = undefined;
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

function formatTripleChange(change: AuthoringTripleChange): string {
  return `${formatAuthoringGraphTerm(change.subject)} <${change.predicateIri}> ${
    formatAuthoringGraphTerm(change.object)
  } . # ${change.statementRef}`;
}

function formatAuthoringGraphTerm(term: AuthoringTripleChange["object"]): string {
  if (term.termType === "NamedNode") return `<${term.value}>`;
  if (term.termType === "BlankNode") return `_:${term.value}`;
  return `${JSON.stringify(term.value)}${
    term.language ? `@${term.language}` : `^^<${term.datatypeIri}>`
  }`;
}

async function applyTurtleDraft(): Promise<boolean> {
  if (props.readOnly) return false;
  if (structuredAuthoringPending.value) {
    applyDiagnostics.value = [{
      severity: "error",
      code: "pending-structured-authoring",
      message: "Structured authoring draftを適用またはCancelしてからTurtleを適用してください。",
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
  publish(result.document, true);
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
    applyDiagnostics.value = [{
      severity: "error",
      code: "pending-structured-authoring",
      message: "Preview/Applyされていないsemantic draftがあります。明示的に適用するかCancelしてください。",
    }];
    return false;
  }
  if (turtlePending.value) return applyTurtleDraft();
  await refreshScene();
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
    layoutRef: activeView.value?.layoutRef ?? layoutChoices.value[0] ?? "",
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
  const command: ViewCommand = viewDialogMode.value === "add"
    ? {
        command: "add",
        viewId: form.viewId,
        profileRef: form.profileRef,
        layoutRef: form.layoutRef,
        ...(form.locale.trim() ? { locale: form.locale.trim() } : {}),
      }
    : {
        command: "configure",
        viewId: form.viewId,
        profileRef: form.profileRef,
        layoutRef: form.layoutRef,
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
  rawScene.value = emptyScene(nextViewId);
  restoreActiveViewSession();
  publish(result.document, true);
  if (controlledViewRequest) emit("update:activeViewId", controlledViewRequest);
  await refreshScene();
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
  publish(next, recordHistory);
}

function publish(next: IriographDocument, recordHistory: boolean): void {
  invalidateAuthoringPreview();
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
  invalidateAuthoringPreview();
  saveActiveViewSession();
  const pendingTurtle = turtleDraft.value;
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
  void refreshScene();
}

function geometryElement(elementId: string): SceneNode | SceneContainer | undefined {
  return [...scene.value.nodes, ...scene.value.containers]
    .find((element) => element.elementId === elementId);
}

function trimHistory(): void {
  if (history.value.length > 100) history.value.splice(0, history.value.length - 100);
}

function setZoomState(value: number): void {
  zoom.value = normalizeDiagramZoom(value);
  sessionFor(currentActiveViewId.value).viewport.zoom = zoom.value;
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
  return diagnosticTargetsSceneElement(diagnostic, element);
}

function sceneElementForDiagnostic(diagnostic: ProjectionDiagnostic): SelectedElement | undefined {
  return [...scene.value.containers, ...scene.value.nodes, ...scene.value.edges]
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
          {{ errorCount > 0 ? `${errorCount} errors` : "Turtle valid" }}
        </span>
        <button type="button" :disabled="!canSave || saving || applyingTurtle || authoringBusy" @click="requestSave">
          {{ saving ? "保存中…" : "保存" }}
        </button>
      </div>
    </header>

    <div class="iriograph-editor-layout">
      <aside class="iriograph-elements-panel">
        <section class="iriograph-view-summary">
          <small>ACTIVE VIEW</small>
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
          <code>{{ activeView?.profileRef }}</code>
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
              Overlay reset
            </button>
          </div>
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
            :class="{ active: selectedElementIdsSet.has(container.elementId) }"
            @click="selectAndReveal(container.elementId, $event)"
          >
            <i>▣</i><span><b>{{ container.label }}</b><small>container</small></span>
          </button>
          <button
            v-for="node in scene.nodes"
            :key="node.elementId"
            type="button"
            :class="{ active: selectedElementIdsSet.has(node.elementId) }"
            @click="selectAndReveal(node.elementId, $event)"
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

        <section v-show="panel === 'diagram'" class="iriograph-diagram-panel">
          <div class="iriograph-canvas-toolbar">
            <div class="iriograph-history-actions">
              <button type="button" :disabled="!canUndo || readOnly" title="Undo (Ctrl/Cmd+Z)" @click="undo">↶</button>
              <button type="button" :disabled="!canRedo || readOnly" title="Redo (Ctrl/Cmd+Y)" @click="redo">↷</button>
              <span />
              <small>{{ activeView?.layoutRef }}</small>
            </div>
            <div class="iriograph-navigation-actions">
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
              >Grid</button>
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
              >Target</button>
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
            :scene="scene"
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
            @zoom-change="setZoomState"
            @selection-request="applySelectionRequest"
            @selection-set-request="selectElements"
            @gesture-start="beginGesture"
            @gesture-end="endGesture"
            @resize-change="changeGeometry"
            @geometry-batch-change="changeGeometryBatch"
            @routing-update="changeRouting"
            @semantic-edit-request="seedSemanticEdit"
            @semantic-position-request="seedDraftPosition"
            @semantic-resource-request="seedDraftResource"
            @semantic-pick-cancel="cancelAuthoringPicking"
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
            <span v-else-if="panel === 'document'">Turtle + sparse overlay</span>
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
                <span><b>{{ diagnostic.code }}</b> {{ diagnostic.message }}</span>
                <span class="iriograph-diagnostic-actions">
                  <button v-if="canNavigateDiagnosticToSource(diagnostic)" type="button" @click="navigateDiagnosticToSource(diagnostic)">Source</button>
                  <button v-if="sceneElementForDiagnostic(diagnostic)" type="button" @click="navigateDiagnosticToScene(diagnostic)">Scene</button>
                </span>
              </li>
            </ul>
          </template>
          <pre v-else><code>{{ panel === "document" ? documentJson : catalogJson }}</code></pre>
        </section>
      </main>

      <aside class="iriograph-inspector">
        <AuthoringPanel
          :model-value="authoringDraft"
          :enabled="authoringEnabled"
          :blocked-reason="authoringBlockedReason"
          :busy="authoringBusy"
          :classes="authoringClassChoices"
          :properties="authoringPropertyChoices"
          :edge-predicates="authoringEdgeChoices"
          :resources="authoringResourceChoices"
          :capabilities="authoringCapabilityChoices"
          :structures="authoringStructureChoices"
          :selected-resource="selectedAuthoringResource"
          :picker-target="authoringResourcePicker"
          :preview="authoringPreviewView"
          :diagnostics="applyDiagnostics"
          @update:model-value="updateAuthoringDraft"
          @preview="previewStructuredAuthoring"
          @apply="applyStructuredAuthoring"
          @cancel="cancelAuthoringDraft"
          @pick-position="beginDraftPositionPicking"
          @pick-resource="beginResourcePicking"
          @seed-selection="seedSelectedResource"
        />
        <div class="iriograph-inspector-divider"><small>DISPLAY INSPECTOR</small><span>View overlay</span></div>
        <header>
          <div><small>DISPLAY</small><strong>{{ selectedElement?.label ?? "No selection" }}</strong></div>
          <span v-if="selectedElement">{{ selectedElementIds.length > 1 ? `${selectedElementIds.length} selected` : selectedElement.structuralKind }}</span>
        </header>
        <template v-if="selectedElement">
          <section>
            <label>Semantic reference</label>
            <code>{{ selectedElement.semanticRef }}</code>
            <button
              v-if="selectedElement.structuralKind !== 'edge' && selectedElement.parentProvenance?.editCapability"
              type="button"
              class="iriograph-wide-button"
              :disabled="readOnly || authoringBusy || turtlePending"
              @click="seedParentRemoval"
            >包含から外す</button>
          </section>
          <section v-if="selectedContainmentWarnings.length" class="iriograph-containment-warnings">
            <label>Containment consistency</label>
            <article
              v-for="warning in selectedContainmentWarnings"
              :key="warning.diagnosticId"
              role="status"
            >
              <b>表示と意味の包含が一致していません</b>
              <span>{{ containmentWarningMessage(warning) }}</span>
              <div>
                <template v-if="warning.kind === 'visual-only'">
                  <button
                    type="button"
                    :disabled="!authoringEnabled || authoringBusy"
                    @click="seedContainmentAddition(warning)"
                  >意味包含のdraftを作成</button>
                  <button
                    type="button"
                    :disabled="readOnly"
                    @click="applyContainmentPresentationFix(warning, 'outside')"
                  >表示だけ領域外へ移動</button>
                </template>
                <template v-else>
                  <button
                    type="button"
                    :disabled="readOnly"
                    @click="applyContainmentPresentationFix(warning, 'inside')"
                  >表示を意味上の領域へ戻す</button>
                  <button
                    type="button"
                    :disabled="!authoringEnabled || authoringBusy || !canSeedContainmentRemoval(warning)"
                    @click="seedContainmentRemoval(warning)"
                  >意味包含を外すdraftを作成</button>
                </template>
              </div>
            </article>
          </section>
          <section v-if="selectedElementDiagnostics.length" class="iriograph-element-diagnostics">
            <label>Diagnostics</label>
            <article
              v-for="(diagnostic, index) in selectedElementDiagnostics"
              :key="diagnostic.diagnosticId ?? `${diagnostic.code}:${index}`"
              :class="diagnostic.severity"
            >
              <b>{{ diagnostic.code }}</b>
              <span>{{ diagnostic.message }}</span>
              <button v-if="canNavigateDiagnosticToSource(diagnostic)" type="button" @click="navigateDiagnosticToSource(diagnostic)">Sourceへ移動</button>
            </article>
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
          <section v-if="selectedElement.structuralKind === 'edge'" class="iriograph-routing-inspector">
            <div class="iriograph-section-heading">
              <label>Manual routing</label>
              <span>{{ selectedManualWaypoints.length ? `${selectedManualWaypoints.length} points` : "automatic" }}</span>
            </div>
            <button
              type="button"
              class="iriograph-wide-button"
              :disabled="readOnly"
              @click="addSelectedWaypoint"
            >Waypointを追加</button>
            <div
              v-for="(point, index) in selectedManualWaypoints"
              :key="index"
              class="iriograph-waypoint-row"
            >
              <span>{{ index + 1 }}</span>
              <label>
                <span>x</span>
                <input type="number" :value="Math.round(point.x)" :disabled="readOnly" @change="updateWaypointField(index, 'x', $event)" />
              </label>
              <label>
                <span>y</span>
                <input type="number" :value="Math.round(point.y)" :disabled="readOnly" @change="updateWaypointField(index, 'y', $event)" />
              </label>
              <button type="button" :aria-label="`Waypoint ${index + 1}を削除`" :disabled="readOnly" @click="removeSelectedWaypoint(index)">×</button>
            </div>
            <label v-if="selectedElement.label">Label offset</label>
            <div v-if="selectedElement.label" class="iriograph-geometry-grid">
              <label v-for="field in (['x', 'y'] as const)" :key="field">
                <span>{{ field }}</span>
                <input
                  type="number"
                  :value="Math.round(selectedElement.labelOffset?.[field] ?? 0)"
                  :disabled="readOnly"
                  @change="updateLabelOffsetField(field, $event)"
                />
              </label>
            </div>
            <button
              v-if="selectedElement.label"
              type="button"
              class="iriograph-wide-button"
              :disabled="readOnly || !selectedElement.labelOffset"
              @click="resetSelectedLabelOffset"
            >Label位置をリセット</button>
            <label>Endpoint anchors</label>
            <div class="iriograph-endpoint-anchor-fields">
              <div v-for="endpoint in (['source', 'target'] as const)" :key="endpoint">
                <label>
                  <span>{{ endpoint }}</span>
                  <input
                    type="number"
                    min="0"
                    max="0.999999"
                    step="0.01"
                    :aria-label="`${endpoint} endpoint anchor`"
                    :value="selectedElement[endpoint === 'source' ? 'sourceAnchor' : 'targetAnchor']?.position ?? ''"
                    :placeholder="'automatic'"
                    :disabled="readOnly"
                    @change="updateEndpointAnchor(endpoint, $event)"
                  />
                </label>
                <button
                  type="button"
                  :aria-label="`${endpoint} endpoint anchorをリセット`"
                  :disabled="readOnly || !selectedElement[endpoint === 'source' ? 'sourceAnchor' : 'targetAnchor']"
                  @click="resetEndpointAnchor(endpoint)"
                >Reset</button>
              </div>
            </div>
            <button
              type="button"
              class="iriograph-wide-button"
              :disabled="readOnly || !hasSelectedEditableRouting"
              @click="resetSelectedRouting"
            >Routingを自動に戻す</button>
          </section>
          <section v-if="selectedElement.structuralKind !== 'edge' && selectedOverlay?.placement === 'user'">
            <button type="button" class="iriograph-wide-button" :disabled="readOnly" @click="clearSelectedOverride">ユーザー調整を解除</button>
          </section>
        </template>
        <section class="iriograph-overlay-preview">
          <div class="iriograph-section-heading"><label>View overlay</label><span>{{ Object.keys(activeView?.overlay ?? {}).length }}</span></div>
          <pre>{{ overlayJson }}</pre>
        </section>
      </aside>
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
          Layout
          <input v-model="viewForm.layoutRef" list="iriograph-layout-options" required />
          <datalist id="iriograph-layout-options">
            <option v-for="layoutRef in layoutChoices" :key="layoutRef" :value="layoutRef" />
          </datalist>
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
  </article>
</template>
