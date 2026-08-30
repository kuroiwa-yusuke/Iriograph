<script lang="ts">
import type { FlowCanvasChoice } from "../authoring/structured-authoring-flow";

export type StructuredAuthoringCanvasOption = FlowCanvasChoice & {
  label: string;
  description?: string;
  shape?: "rectangle" | "rounded" | "circle" | "diamond" | "group";
};

export type StructuredAuthoringCanvasSelectionRequest = {
  role: "direct-source" | "direct-targets" | "membership-group" | "membership-members" | "edit-element" | "edit-relation";
  multiple: boolean;
  acceptedKinds: readonly FlowCanvasChoice["kind"][];
};
</script>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, useId, watch } from "vue";
import type {
  StructuredAuthoringPresentation,
  StructuredAuthoringRequest,
  StructuredCanvasSelection,
  StructuredPredicateHierarchyPresentation,
} from "@iriograph/core";

import { diagnosticGuidance } from "../inspector/diagnostic-guidance";
import {
  useEditorLocalization,
  type EditorMessageKey,
} from "../localization/editor-localization";
import {
  memberKey,
  reduceStructuredAuthoringFlow,
  selectionKey,
  structuredAuthoringRequestForDraft,
  structuredAuthoringStepStatus,
  structuredAuthoringIntentOptions,
  structuredElementKindOptions,
  structuredRelationFamilyOptions,
  type FlowGroupMember,
  type StructuredAuthoringFlowEffect,
  type StructuredAuthoringFlowEvent,
  type StructuredAuthoringFlowState,
  type StructuredAuthoringReadyDraft,
} from "../authoring/structured-authoring-flow";

const props = withDefaults(defineProps<{
  state: StructuredAuthoringFlowState;
  presentation: StructuredAuthoringPresentation;
  predicateHierarchy?: StructuredPredicateHierarchyPresentation;
  canvasOptions?: readonly StructuredAuthoringCanvasOption[];
  requestId: string;
  busy?: boolean;
  readOnly?: boolean;
  disabledReason?: string;
  guidance?: string;
  openerFocusId?: string;
}>(), {
  canvasOptions: () => [],
  predicateHierarchy: () => ({ predicates: [], queryExplanation: "", validationExplanation: "" }),
  busy: false,
  readOnly: false,
  disabledReason: "",
  guidance: "",
  openerFocusId: undefined,
});

const emit = defineEmits<{
  transition: [event: StructuredAuthoringFlowEvent];
  submit: [request: StructuredAuthoringRequest];
  requestCanvasSelection: [request: StructuredAuthoringCanvasSelectionRequest];
  focusDestination: [effect: Extract<StructuredAuthoringFlowEffect, { type: "focus" }>];
}>();
const { locale, t } = useEditorLocalization();

const instanceId = useId();
const stepHeading = ref<HTMLElement>();
const firstEntry = ref<HTMLButtonElement>();
const predicateSearch = ref("");
const predicateCategory = ref("");
const inlineLabel = ref("");
const inlineRoleIds = ref<string[]>([]);
const inlineSequence = ref(0);
const draggedMemberKey = ref<string>();

const locked = computed(() => props.busy || props.state.phase === "submitting" || props.readOnly || Boolean(props.disabledReason));
const lockReason = computed(() => props.disabledReason || (props.readOnly ? t("wizard.readOnly") : ""));
const stepStatus = computed(() => structuredAuthoringStepStatus(props.state, t));
const intentOptions = computed(() => structuredAuthoringIntentOptions(t));
const elementKindOptions = computed(() => structuredElementKindOptions(t));
const relationFamilyOptions = computed(() => structuredRelationFamilyOptions(t));
const nodeDraft = computed(() => draftFamily("create-node"));
const groupDraft = computed(() => draftFamily("create-group"));
const directDraft = computed(() => draftFamily("direct"));
const membershipDraft = computed(() => draftFamily("membership"));
const editElementDraft = computed(() => draftFamily("edit-element"));
const editRelationDraft = computed(() => draftFamily("edit-relation"));
const readyRequest = computed(() => {
  if (props.state.phase !== "ready" && props.state.phase !== "error") return undefined;
  return structuredAuthoringRequestForDraft(props.state.draft, props.requestId);
});
const predicateCategories = computed(() => [...new Set(
  props.presentation.predicateCatalog.map((item) => item.category).filter((item): item is string => Boolean(item)),
)]);
const filteredPredicates = computed(() => {
  const query = predicateSearch.value.trim().toLocaleLowerCase(locale.value);
  return props.presentation.predicateCatalog.filter((item) => (
    (!predicateCategory.value || item.category === predicateCategory.value)
    && (!query || [item.label, item.description, item.sentencePattern, item.category]
      .some((value) => value?.toLocaleLowerCase(locale.value).includes(query)))
  ));
});
const phaseTitle = computed(() => t(PHASE_TITLE_KEYS[props.state.phase]));
const showNext = computed(() => NEXT_PHASES.has(props.state.phase));
const errorCards = computed(() => props.state.phase === "error"
  ? props.state.diagnostics.map((diagnostic) => {
      const guidance = diagnosticGuidance(diagnostic, t);
      return { title: humanText(guidance.title), action: humanText(guidance.action) };
    })
  : []);

onMounted(focusStep);
watch(() => props.state.phase, () => {
  predicateSearch.value = "";
  predicateCategory.value = "";
  focusStep();
});

function draftFamily<T extends StructuredAuthoringReadyDraft["family"]>(
  family: T,
): Extract<StructuredAuthoringReadyDraft, { family: T }> | undefined {
  const state = props.state;
  return "draft" in state && state.draft.family === family
    ? state.draft as Extract<StructuredAuthoringReadyDraft, { family: T }>
    : undefined;
}

function dispatch(event: StructuredAuthoringFlowEvent): void {
  if (locked.value && event.type !== "cancel" && event.type !== "escape" && event.type !== "back") return;
  const transition = reduceStructuredAuthoringFlow(props.state, event);
  emit("transition", event);
  if (transition.effect?.type === "focus") emit("focusDestination", transition.effect);
  if (event.type === "next" && transition.state.phase === "ready") {
    const request = structuredAuthoringRequestForDraft(transition.state.draft, props.requestId);
    if (request) emit("submit", request);
  }
}

function chooseIntent(intent: ReturnType<typeof structuredAuthoringIntentOptions>[number]["intent"]): void {
  dispatch({
    type: "choose-intent",
    intent,
    preselection: props.state.preselection,
    openerFocusId: props.openerFocusId,
  });
}

function submit(): void {
  if (!locked.value && readyRequest.value) emit("submit", readyRequest.value);
}

function requestCanvasSelection(request: StructuredAuthoringCanvasSelectionRequest): void {
  if (!locked.value) emit("requestCanvasSelection", request);
}

function toggleNodeRole(roleId: string): void {
  const draft = nodeDraft.value;
  if (!draft) return;
  const values = draft.nodeRoleIds.includes(roleId)
    ? draft.nodeRoleIds.filter((item: string) => item !== roleId)
    : [...draft.nodeRoleIds, roleId];
  dispatch({ type: "set-node-roles", nodeRoleIds: values });
}

function setLabel(event: Event): void {
  dispatch({ type: "set-label", label: (event.target as HTMLInputElement).value });
}

function canvasOption(selection?: StructuredCanvasSelection): StructuredAuthoringCanvasOption | undefined {
  if (!selection) return undefined;
  const key = selectionKey(selection);
  return props.canvasOptions.find((option) => selectionKey(option.selection) === key);
}

function canvasLabel(selection?: StructuredCanvasSelection): string {
  return canvasOption(selection)?.label ?? t("wizard.selectedElement");
}

function canvasShape(selection?: StructuredCanvasSelection): string {
  return canvasOption(selection)?.shape ?? "rectangle";
}

function selectedPredicateLabel(predicateId?: string): string {
  return props.presentation.predicateCatalog.find((item) => item.predicateId === predicateId)?.label ?? t("wizard.notSelected");
}

function predicateSentence(item: StructuredAuthoringPresentation["predicateCatalog"][number]): string {
  return item.sentencePattern ?? t("wizard.predicateFallback", { label: item.label });
}

function predicateHierarchyItem(predicateId: string): StructuredPredicateHierarchyPresentation["predicates"][number] | undefined {
  return props.predicateHierarchy.predicates.find((item) => item.predicateId === predicateId);
}

function removeDirectTarget(target: StructuredCanvasSelection): void {
  const draft = directDraft.value;
  if (!draft) return;
  dispatch({
    type: "set-direct-targets",
    targets: draft.targets.filter((item: StructuredCanvasSelection) => selectionKey(item) !== selectionKey(target)),
  });
}

function toggleInlineRole(roleId: string): void {
  inlineRoleIds.value = inlineRoleIds.value.includes(roleId)
    ? inlineRoleIds.value.filter((item) => item !== roleId)
    : [...inlineRoleIds.value, roleId];
}

function addInlineMember(): void {
  if (!inlineLabel.value.trim()) return;
  if (!props.presentation.profile.allowUntypedNodes && inlineRoleIds.value.length === 0) return;
  inlineSequence.value += 1;
  dispatch({
    type: "add-inline-member",
    member: {
      kind: "new-node",
      clientId: `${instanceId}-member-${inlineSequence.value}`,
      label: inlineLabel.value.trim(),
      nodeRoleIds: [...inlineRoleIds.value],
    },
  });
  inlineLabel.value = "";
  inlineRoleIds.value = [];
}

function memberLabel(member: FlowGroupMember): string {
  return member.kind === "new-node" ? member.label : canvasLabel(member.selection);
}

function reorderMember(targetKey: string): void {
  const draft = membershipDraft.value;
  const sourceKey = draggedMemberKey.value;
  draggedMemberKey.value = undefined;
  if (!draft || !sourceKey || sourceKey === targetKey) return;
  const members = [...draft.members];
  const sourceIndex = members.findIndex((member) => memberKey(member) === sourceKey);
  const targetIndex = members.findIndex((member) => memberKey(member) === targetKey);
  if (sourceIndex < 0 || targetIndex < 0) return;
  const [member] = members.splice(sourceIndex, 1);
  if (!member) return;
  members.splice(targetIndex, 0, member);
  dispatch({ type: "set-members", members });
}

function focusStep(): void {
  void nextTick(() => {
    if (props.state.phase === "intent") firstEntry.value?.focus();
    else stepHeading.value?.focus();
  });
}

function setFirstEntry(element: unknown): void {
  if (element instanceof HTMLButtonElement) firstEntry.value = element;
}

function handleEscape(event: KeyboardEvent): void {
  if (event.key !== "Escape" || props.state.phase === "intent") return;
  event.preventDefault();
  dispatch({ type: "escape" });
}

function humanText(value: string): string {
  return value
    .replaceAll("Turtle", t("wizard.human.source"))
    .replaceAll("RDF", t("wizard.human.semanticInformation"))
    .replaceAll("IRI", t("wizard.human.identifier"));
}

const PHASE_TITLE_KEYS = {
  intent: "wizard.phase.intent",
  "element-kind": "wizard.phase.elementKind",
  "node-roles": "wizard.phase.nodeRoles",
  "group-kind": "wizard.phase.groupKind",
  "element-label": "wizard.phase.elementLabel",
  "relation-family": "wizard.phase.relationFamily",
  "direct-source": "wizard.phase.directSource",
  "direct-targets": "wizard.phase.directTargets",
  "direct-predicate": "wizard.phase.directPredicate",
  "membership-group": "wizard.phase.membershipGroup",
  "membership-members": "wizard.phase.membershipMembers",
  "sequence-order": "wizard.phase.sequenceOrder",
  "alternative-default": "wizard.phase.alternativeDefault",
  "edit-element-select": "wizard.phase.editElementSelect",
  "edit-element-action": "wizard.phase.editElementAction",
  "edit-relation-select": "wizard.phase.editRelationSelect",
  "edit-relation-action": "wizard.phase.editRelationAction",
  ready: "wizard.phase.ready",
  submitting: "wizard.phase.submitting",
  error: "wizard.phase.error",
} as const satisfies Readonly<Record<StructuredAuthoringFlowState["phase"], EditorMessageKey>>;

const NEXT_PHASES = new Set<StructuredAuthoringFlowState["phase"]>([
  "node-roles", "group-kind", "element-label", "direct-source", "direct-targets", "direct-predicate",
  "membership-group", "membership-members", "sequence-order", "alternative-default",
  "edit-element-select", "edit-relation-select",
]);
</script>

<template>
  <section
    class="structured-wizard"
    data-responsive="narrow"
    :aria-busy="busy || state.phase === 'submitting' ? 'true' : undefined"
    @keydown="handleEscape"
  >
    <p v-if="guidance" class="validation-hint" role="status">{{ guidance }}</p>
    <template v-if="state.phase === 'intent'">
      <h2>{{ phaseTitle }}</h2>
      <div class="entry-grid" :aria-label="t('wizard.actionsAria')">
        <button
          v-for="(option, index) in intentOptions"
          :key="option.intent"
          :ref="index === 0 ? setFirstEntry : undefined"
          type="button"
          class="entry-card"
          :disabled="locked"
          @click="chooseIntent(option.intent)"
        ><strong>{{ option.label }}</strong><span>{{ option.description }}</span></button>
      </div>
      <p v-if="lockReason" class="blocked" role="status">{{ lockReason }}</p>
    </template>

    <template v-else>
      <header class="step-header">
        <small>{{ t("wizard.eyebrow") }}</small>
        <h2 ref="stepHeading" tabindex="-1">{{ phaseTitle }}</h2>
      </header>

      <div v-if="state.phase === 'element-kind'" class="card-grid" role="group" :aria-label="t('wizard.createKindAria')">
        <button v-for="option in elementKindOptions" :key="option.elementKind" type="button" class="choice-card" :disabled="locked" @click="dispatch({ type: 'choose-element-kind', elementKind: option.elementKind })">
          <span class="shape-preview" :class="option.elementKind" aria-hidden="true"></span><strong>{{ option.label }}</strong><span>{{ option.description }}</span>
        </button>
      </div>

      <div v-else-if="state.phase === 'node-roles' && nodeDraft" class="step-body">
        <p>{{ t("wizard.chooseTypes") }}</p>
        <div class="card-grid" role="group" :aria-label="t('wizard.elementTypesAria')">
          <button v-for="role in presentation.profile.nodeRoles" :key="role.roleId" type="button" class="choice-card compact" :aria-pressed="nodeDraft.nodeRoleIds.includes(role.roleId)" :disabled="locked" @click="toggleNodeRole(role.roleId)">
            <span class="shape-preview node" aria-hidden="true"></span><strong>{{ role.label }}</strong><span v-if="role.description">{{ role.description }}</span>
          </button>
          <div v-if="presentation.profile.allowUntypedNodes" class="choice-card compact muted"><span class="shape-preview node" aria-hidden="true"></span><strong>{{ t("wizard.unclassified") }}</strong><span>{{ t("wizard.unclassifiedDescription") }}</span></div>
        </div>
      </div>

      <div v-else-if="state.phase === 'group-kind' && groupDraft" class="card-grid" role="group" :aria-label="t('wizard.groupTypesAria')">
        <button v-for="kind in presentation.groupKinds" :key="kind.groupKind" type="button" class="choice-card" :aria-pressed="groupDraft.groupKind === kind.groupKind" :disabled="locked || !kind.enabled" :aria-describedby="!kind.enabled ? `group-disabled-${kind.groupKind}` : undefined" @click="dispatch({ type: 'set-group-kind', groupKind: kind.groupKind })">
          <span class="shape-preview group" aria-hidden="true"></span><strong>{{ kind.label }}</strong><span>{{ kind.description }}</span><small v-if="!kind.enabled" :id="`group-disabled-${kind.groupKind}`">{{ kind.disabledReason }}</small>
        </button>
      </div>

      <label v-else-if="state.phase === 'element-label' && (nodeDraft || groupDraft)" class="field-block"><span>{{ t("common.name") }}</span><input :value="(nodeDraft || groupDraft)?.label" :disabled="locked" autocomplete="off" @input="setLabel" /></label>

      <div v-else-if="state.phase === 'relation-family'" class="card-grid family-grid" role="group" :aria-label="t('wizard.connectMethodAria')">
        <button v-for="option in relationFamilyOptions" :key="option.family" type="button" class="choice-card family-card" :disabled="locked" @click="dispatch({ type: 'choose-relation-family', family: option.family })">
          <span class="family-icon" :class="option.family" aria-hidden="true"><i></i><i></i></span><strong>{{ option.label }}</strong><span>{{ option.description }}</span>
        </button>
      </div>

      <div v-else-if="state.phase === 'direct-source' && directDraft" class="step-body">
        <p>{{ t("wizard.sourceInstructions") }}</p>
        <div v-if="directDraft.source" class="canvas-chip"><span class="shape-mini" :class="canvasShape(directDraft.source)" aria-hidden="true"></span><strong>{{ canvasLabel(directDraft.source) }}</strong><small>{{ t("wizard.source") }}</small></div>
        <p v-else class="selection-wait" role="status">{{ t("wizard.selectSource") }}</p>
        <button type="button" :disabled="locked" @click="requestCanvasSelection({ role: 'direct-source', multiple: false, acceptedKinds: ['node'] })">{{ t("wizard.chooseSource") }}</button>
      </div>

      <div v-else-if="state.phase === 'direct-targets' && directDraft" class="step-body">
        <p>{{ t("wizard.targetsInstructions") }}</p>
        <div class="chip-list" aria-live="polite"><div v-for="target in directDraft.targets" :key="selectionKey(target)" class="canvas-chip"><span class="shape-mini" :class="canvasShape(target)" aria-hidden="true"></span><strong>{{ canvasLabel(target) }}</strong><button type="button" :aria-label="t('wizard.removeItem', { label: canvasLabel(target) })" :disabled="locked" @click="removeDirectTarget(target)">×</button></div></div>
        <p v-if="directDraft.targets.length === 0" class="selection-wait" role="status">{{ t("wizard.selectTargets") }}</p>
        <button type="button" :disabled="locked" @click="requestCanvasSelection({ role: 'direct-targets', multiple: true, acceptedKinds: ['node'] })">{{ t("wizard.chooseTargets") }}</button>
      </div>

      <div v-else-if="state.phase === 'direct-predicate' && directDraft" class="step-body">
        <div class="predicate-tools"><label><span>{{ t("wizard.searchRelations") }}</span><input v-model="predicateSearch" :disabled="locked" /></label><div class="category-row" :aria-label="t('wizard.relationCategories')"><button type="button" :aria-pressed="predicateCategory === ''" @click="predicateCategory = ''">{{ t("wizard.all") }}</button><button v-for="category in predicateCategories" :key="category" type="button" :aria-pressed="predicateCategory === category" @click="predicateCategory = category">{{ category }}</button></div></div>
        <div class="predicate-list" role="group" :aria-label="t('wizard.commonRelations')"><button v-for="item in filteredPredicates" :key="item.predicateId" type="button" class="predicate-card" :aria-pressed="directDraft.predicateId === item.predicateId" :disabled="locked" @click="dispatch({ type: 'set-common-predicate', predicateId: item.predicateId })"><strong>{{ t("wizard.predicatePattern", { label: item.label }) }}</strong><span>{{ predicateSentence(item) }}</span><small v-if="item.description">{{ item.description }}</small><span v-if="predicateHierarchyItem(item.predicateId)?.paths.length" class="predicate-hierarchy"><b>{{ t("wizard.parentRelations") }}</b><small v-for="(path, index) in predicateHierarchyItem(item.predicateId)?.paths" :key="index">{{ path.labels.join(' → ') }}</small></span><span v-if="predicateHierarchyItem(item.predicateId)?.diagnostics.length" class="predicate-hierarchy warning"><small v-for="diagnostic in predicateHierarchyItem(item.predicateId)?.diagnostics" :key="diagnostic.code">{{ t("wizard.hierarchyWarning") }}</small></span><small v-if="predicateHierarchyItem(item.predicateId)?.truncated">{{ t("wizard.hierarchyTruncated") }}</small></button></div>
        <aside class="predicate-policy" :aria-label="t('wizard.relationPolicyAria')"><strong>{{ t("wizard.relationPolicy") }}</strong><span>{{ predicateHierarchy.queryExplanation }}</span><span>{{ predicateHierarchy.validationExplanation }}</span></aside>
        <p v-if="filteredPredicates.length === 0" role="status">{{ t("wizard.noRelations") }}</p>
        <details class="row-overrides"><summary>{{ t("wizard.perTargetRelations") }}</summary><article v-for="target in directDraft.targets" :key="`row-${selectionKey(target)}`"><h3>{{ canvasLabel(target) }}</h3><p>{{ t("wizard.current", { value: selectedPredicateLabel(directDraft.rowPredicateIds[selectionKey(target)] ?? directDraft.predicateId) }) }}</p><div class="compact-options"><button type="button" :disabled="locked" @click="dispatch({ type: 'set-row-predicate', target, predicateId: undefined })">{{ t("wizard.useCommon") }}</button><button v-for="item in filteredPredicates" :key="`${selectionKey(target)}:${item.predicateId}`" type="button" :aria-pressed="directDraft.rowPredicateIds[selectionKey(target)] === item.predicateId" :disabled="locked" @click="dispatch({ type: 'set-row-predicate', target, predicateId: item.predicateId })">{{ item.label }}</button></div></article></details>
      </div>

      <div v-else-if="state.phase === 'membership-group' && membershipDraft" class="step-body">
        <p>{{ t("wizard.groupInstructions") }}</p>
        <div v-if="membershipDraft.group" class="canvas-chip"><span class="shape-mini group" aria-hidden="true"></span><strong>{{ canvasLabel(membershipDraft.group) }}</strong><small>{{ t("wizard.destinationGroup") }}</small></div>
        <p v-else class="selection-wait" role="status">{{ t("wizard.selectGroup") }}</p>
        <button type="button" :disabled="locked" @click="requestCanvasSelection({ role: 'membership-group', multiple: false, acceptedKinds: ['group'] })">{{ t("wizard.chooseGroup") }}</button>
      </div>

      <div v-else-if="state.phase === 'membership-members' && membershipDraft" class="step-body">
        <p>{{ t("wizard.membersInstructions") }}</p>
        <div class="chip-list" aria-live="polite"><div v-for="member in membershipDraft.members" :key="memberKey(member)" class="canvas-chip"><span class="shape-mini node" aria-hidden="true"></span><strong>{{ memberLabel(member) }}</strong><small>{{ member.kind === 'new-node' ? t('wizard.new') : t('wizard.existing') }}</small><button type="button" :aria-label="t('wizard.removeItem', { label: memberLabel(member) })" :disabled="locked" @click="dispatch({ type: 'remove-member', memberKey: memberKey(member) })">×</button></div></div>
        <button type="button" :disabled="locked" @click="requestCanvasSelection({ role: 'membership-members', multiple: true, acceptedKinds: ['node'] })">{{ t("wizard.chooseMembers") }}</button>
        <details class="inline-create"><summary>{{ t("wizard.addNewElement") }}</summary><label><span>{{ t("wizard.newElementName") }}</span><input v-model="inlineLabel" :disabled="locked" /></label><div class="compact-options" role="group" :aria-label="t('wizard.newElementTypes')"><button v-for="role in presentation.profile.nodeRoles" :key="`inline-${role.roleId}`" type="button" :aria-pressed="inlineRoleIds.includes(role.roleId)" :disabled="locked" @click="toggleInlineRole(role.roleId)">{{ role.label }}</button></div><button type="button" :disabled="locked || !inlineLabel.trim() || (!presentation.profile.allowUntypedNodes && inlineRoleIds.length === 0)" @click="addInlineMember">{{ t("wizard.addToList") }}</button></details>
      </div>

      <div v-else-if="state.phase === 'sequence-order' && membershipDraft" class="step-body">
        <p>{{ t("wizard.orderInstructions") }}</p>
        <ol class="ordered-members"><li v-for="(member, index) in membershipDraft.members" :key="memberKey(member)" draggable="true" @dragstart="draggedMemberKey = memberKey(member)" @dragover.prevent @drop="reorderMember(memberKey(member))"><span>{{ index + 1 }}</span><strong>{{ memberLabel(member) }}</strong><button type="button" :disabled="locked || index === 0" :aria-label="t('wizard.moveUp', { label: memberLabel(member) })" @click="dispatch({ type: 'move-member', memberKey: memberKey(member), direction: 'up' })">↑</button><button type="button" :disabled="locked || index === membershipDraft.members.length - 1" :aria-label="t('wizard.moveDown', { label: memberLabel(member) })" @click="dispatch({ type: 'move-member', memberKey: memberKey(member), direction: 'down' })">↓</button></li></ol>
      </div>

      <div v-else-if="state.phase === 'alternative-default' && membershipDraft" class="step-body">
        <p>{{ t("wizard.alternativeInstructions") }}</p>
        <div class="alternative-list" role="group" :aria-label="t('wizard.defaultCandidate')"><button v-for="member in membershipDraft.members" :key="memberKey(member)" type="button" :aria-pressed="membershipDraft.defaultMemberKey === memberKey(member)" :disabled="locked" @click="dispatch({ type: 'set-alternative-default', memberKey: memberKey(member) })"><span class="radio-mark" aria-hidden="true"></span><strong>{{ memberLabel(member) }}</strong><small v-if="membershipDraft.defaultMemberKey === memberKey(member)">{{ t("wizard.defaultCandidate") }}</small></button></div>
      </div>

      <div v-else-if="state.phase === 'edit-element-select' && editElementDraft" class="step-body"><p>{{ t("wizard.editElementInstructions") }}</p><button type="button" :disabled="locked" @click="requestCanvasSelection({ role: 'edit-element', multiple: false, acceptedKinds: ['node', 'group'] })">{{ t("wizard.chooseElement") }}</button></div>
      <div v-else-if="state.phase === 'edit-element-action' && editElementDraft" class="step-body"><div class="canvas-chip"><span class="shape-mini" :class="canvasShape(editElementDraft.target)" aria-hidden="true"></span><strong>{{ canvasLabel(editElementDraft.target) }}</strong></div><div class="action-list"><button type="button" :disabled="locked" @click="dispatch({ type: 'choose-edit-element-action', action: 'details' })">{{ t("wizard.editElementDetails") }}</button><button type="button" class="danger" :disabled="locked" @click="dispatch({ type: 'choose-edit-element-action', action: 'delete' })">{{ t("wizard.deleteElement") }}</button></div></div>

      <div v-else-if="state.phase === 'edit-relation-select' && editRelationDraft" class="step-body"><p>{{ t("wizard.editRelationInstructions") }}</p><button type="button" :disabled="locked" @click="requestCanvasSelection({ role: 'edit-relation', multiple: false, acceptedKinds: ['node', 'group', 'direct-edge'] })">{{ t("wizard.chooseTarget") }}</button></div>
      <div v-else-if="state.phase === 'edit-relation-action' && editRelationDraft" class="step-body"><div v-if="editRelationDraft.target" class="canvas-chip"><span class="shape-mini" :class="canvasShape(editRelationDraft.target.selection)" aria-hidden="true"></span><strong>{{ canvasLabel(editRelationDraft.target.selection) }}</strong></div><div class="action-list"><button v-if="editRelationDraft.target?.kind === 'direct-edge'" type="button" :disabled="locked" @click="dispatch({ type: 'choose-edit-relation-action', action: 'meaning' })">{{ t("wizard.editRelationMeaning") }}</button><button v-if="editRelationDraft.target?.kind === 'direct-edge'" type="button" :disabled="locked" @click="dispatch({ type: 'choose-edit-relation-action', action: 'reconnect' })">{{ t("wizard.reconnect") }}</button><button v-if="editRelationDraft.target?.kind !== 'direct-edge'" type="button" :disabled="locked" @click="dispatch({ type: 'choose-edit-relation-action', action: 'membership' })">{{ t("wizard.editStructure") }}</button><button v-if="editRelationDraft.target?.kind === 'direct-edge'" type="button" class="danger" :disabled="locked" @click="dispatch({ type: 'choose-edit-relation-action', action: 'delete' })">{{ t("wizard.deleteRelation") }}</button></div></div>

      <div v-else-if="state.phase === 'ready'" class="ready-card" role="status"><p>{{ readyRequest ? t('wizard.submitted') : t('wizard.openEditor') }}</p></div>
      <div v-else-if="state.phase === 'submitting'" class="busy-card" role="status"><span aria-hidden="true"></span><p>{{ t("wizard.applying") }}</p></div>
      <div v-else-if="state.phase === 'error'" class="error-list" role="alert"><article v-for="(card, index) in errorCards" :key="index"><strong>{{ card.title }}</strong><p>{{ card.action }}</p></article><button v-if="readyRequest" type="button" :disabled="locked" @click="submit">{{ t("wizard.retry") }}</button><button type="button" @click="dispatch({ type: 'back' })">{{ t("wizard.revise") }}</button></div>

      <p v-if="lockReason" class="blocked" role="status">{{ lockReason }}</p>
      <p v-else-if="showNext && !stepStatus.canContinue" class="validation-hint" role="status">{{ stepStatus.reason }}</p>

      <footer v-if="state.phase !== 'submitting' && state.phase !== 'error' && state.phase !== 'ready'" class="wizard-footer">
        <button type="button" :disabled="busy" @click="dispatch({ type: 'back' })">{{ t("common.back") }}</button>
        <button type="button" :disabled="busy" @click="dispatch({ type: 'cancel' })">{{ t("common.cancel") }}</button>
        <button v-if="showNext" type="button" class="primary" :disabled="locked || !stepStatus.canContinue" @click="dispatch({ type: 'next' })">{{ t("wizard.next") }}</button>
      </footer>
    </template>
  </section>
</template>

<style scoped>
.structured-wizard { container-type: inline-size; display: grid; gap: .75rem; color: #17312f; font-size: .88rem; }
h2, h3, p { margin: 0; } h2 { font-size: 1.05rem; } button, input { font: inherit; }
.entry-grid, .card-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .65rem; }
.entry-card, .choice-card, .predicate-card { display: grid; gap: .35rem; min-height: 6.2rem; padding: .75rem; border: 1px solid #b7c8c5; border-radius: .7rem; background: #fff; color: inherit; text-align: left; cursor: pointer; }
.entry-card:hover, .choice-card:hover, .predicate-card:hover { border-color: #217c70; background: #f3faf8; }
button:focus-visible, input:focus-visible, summary:focus-visible { outline: 3px solid #247d72; outline-offset: 2px; }
button:disabled { cursor: not-allowed; opacity: .56; }
.step-header { display: grid; gap: .15rem; border-bottom: 1px solid #d9e4e2; padding-bottom: .5rem; }
.step-header small { color: #58706c; font-weight: 700; }
.step-body { display: grid; gap: .65rem; }
.shape-preview { display: block; width: 3.3rem; height: 2.2rem; border: 2px solid #397b9f; background: #ddecf7; }
.shape-preview.node { border-radius: .25rem; } .shape-preview.group { width: 4.1rem; border-style: dashed; border-radius: .45rem; background: #f5f8f7; }
.choice-card.compact { min-height: 5rem; } .choice-card[aria-pressed="true"], .predicate-card[aria-pressed="true"] { border-color: #167164; box-shadow: inset 0 0 0 2px #167164; background: #eaf6f3; }
.choice-card.muted { opacity: .78; }
.family-icon { position: relative; display: flex; align-items: center; justify-content: space-between; width: 4.4rem; height: 2rem; }
.family-icon i { width: 1.3rem; height: 1.3rem; border: 2px solid #397b9f; background: #e8f3fa; }
.family-icon.direct::after { content: "→"; position: absolute; left: 1.45rem; top: .18rem; color: #315b55; }
.family-icon.membership { justify-content: center; border: 2px dashed #397b9f; border-radius: .3rem; } .family-icon.membership i + i { margin-left: -.25rem; }
.field-block, .predicate-tools label, .inline-create label { display: grid; gap: .3rem; font-weight: 700; }
input { min-width: 0; padding: .55rem .65rem; border: 1px solid #aebfbc; border-radius: .4rem; }
.canvas-chip { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: .45rem; align-items: center; padding: .45rem .55rem; border: 1px solid #c3d3d0; border-radius: .45rem; background: #f6faf9; }
.canvas-chip button { border: 0; background: transparent; }
.shape-mini { width: 1.5rem; height: 1.1rem; border: 2px solid #397b9f; background: #ddecf7; } .shape-mini.circle { border-radius: 50%; } .shape-mini.diamond { transform: rotate(45deg) scale(.75); } .shape-mini.group { border-style: dashed; background: transparent; }
.chip-list, .predicate-list, .alternative-list, .action-list { display: grid; gap: .4rem; }
.selection-wait, .validation-hint, .blocked { padding: .55rem; border-left: 4px solid #d29321; background: #fff7e7; }
.predicate-tools { display: grid; gap: .5rem; }
.predicate-hierarchy, .predicate-policy { display: grid; gap: .2rem; padding-top: .35rem; border-top: 1px solid #d9e4e2; }
.predicate-hierarchy.warning { color: #8a4c08; }
.predicate-policy { padding: .55rem; border: 1px solid #c8d8d5; border-radius: .45rem; background: #f6faf9; }
.category-row, .compact-options { display: flex; flex-wrap: wrap; gap: .35rem; }
.category-row button, .compact-options button { padding: .35rem .55rem; border: 1px solid #b8c9c6; border-radius: 999px; background: #fff; }
.category-row button[aria-pressed="true"], .compact-options button[aria-pressed="true"] { border-color: #167164; background: #eaf6f3; }
.predicate-card { min-height: auto; } details { padding: .5rem; border: 1px solid #d4dfdd; border-radius: .45rem; } summary { cursor: pointer; font-weight: 700; }
.row-overrides article { display: grid; gap: .35rem; padding: .55rem 0; border-top: 1px solid #e1e8e7; }
.inline-create { display: grid; gap: .55rem; }
.ordered-members { display: grid; gap: .4rem; margin: 0; padding: 0; list-style: none; }
.ordered-members li { display: grid; grid-template-columns: 2rem minmax(0, 1fr) auto auto; gap: .35rem; align-items: center; padding: .45rem; border: 1px solid #c6d5d2; border-radius: .4rem; background: #fff; }
.ordered-members li > span { display: grid; place-items: center; width: 1.6rem; height: 1.6rem; border-radius: 50%; background: #dcefeb; font-weight: 700; }
.alternative-list button { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: .5rem; align-items: center; padding: .55rem; border: 1px solid #c2d2cf; border-radius: .45rem; background: #fff; text-align: left; }
.alternative-list button[aria-pressed="true"] { border-color: #167164; background: #eaf6f3; }
.radio-mark { width: .9rem; height: .9rem; border: 2px solid #397b9f; border-radius: 50%; } button[aria-pressed="true"] .radio-mark { box-shadow: inset 0 0 0 3px #fff; background: #167164; }
.wizard-footer { display: flex; gap: .4rem; justify-content: flex-end; padding-top: .6rem; border-top: 1px solid #dce5e3; }
.wizard-footer button, .action-list button, .step-body > button, .ready-card button, .error-list button { min-height: 2.3rem; padding: .45rem .65rem; border: 1px solid #9fb5b1; border-radius: .4rem; background: #fff; }
button.primary { border-color: #176d62; background: #176d62; color: #fff; } button.danger { color: #a12b2b; }
.ready-card, .busy-card, .error-list { display: grid; gap: .65rem; padding: .7rem; border-radius: .55rem; background: #f3f8f7; }
.error-list article { padding: .55rem; border-left: 4px solid #c77b1a; background: #fff8e9; }
.busy-card span { width: 1.3rem; height: 1.3rem; border: 3px solid #b8cfcb; border-top-color: #176d62; border-radius: 50%; animation: spin .8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
@container (max-width: 28rem) { .entry-grid, .card-grid { grid-template-columns: 1fr; } .wizard-footer { display: grid; grid-template-columns: 1fr 1fr; } .wizard-footer .primary { grid-column: 1 / -1; } }
</style>
