<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";

import {
  statementIdentityForNamedStatement,
  type AuthoringCommand,
  type ProjectionDiagnostic,
  type SemanticEditCapability,
} from "@iriograph/core";

import {
  emptyAuthoringDraft,
  type AuthoringChoice,
  type EditorAuthoringDraft,
} from "../authoring-draft";
import { diagnosticGuidance } from "../diagnostic-guidance";
import type { MembershipOverview } from "../membership-overview";

export type SemanticIntent = "add-element" | "add-relation" | "edit-element" | "edit-relation";

export type IntentElementDetails = {
  iri: string;
  label: string;
  labelValues: IntentTextValue[];
  commentValues: IntentTextValue[];
  classIris: string[];
};

export type IntentTextValue = {
  value: string;
  language?: string;
  datatypeIri?: string;
};

export type IntentEdgeDetails = {
  label: string;
  sourceIri: string;
  sourceLabel: string;
  predicateIri: string;
  targetIri: string;
  targetLabel: string;
  statementComments?: IntentTextValue[];
  capability?: SemanticEditCapability;
  derivedReason?: string;
};

export type IntentMembershipOption = {
  containerIri: string;
  label: string;
  containerTypeIri: string;
  predicateIri: string;
  containerPosition: "subject" | "object";
  memberIris: string[];
};

export type IntentSequenceOption = {
  sequenceIri: string;
  label: string;
  sequenceTypeIri: string;
  ordinalPredicatePrefix: string;
  memberIris: string[];
  members: Array<{ iri: string; label: string }>;
};

export type IntentRelationOverview = {
  edgeElementId: string;
  sourceIri: string;
  sourceLabel: string;
  predicateIri: string;
  predicateLabel: string;
  targetIri: string;
  targetLabel: string;
  direction: "outgoing" | "incoming" | "both";
  derivedReason?: string;
};

const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const RDFS_LABEL = "http://www.w3.org/2000/01/rdf-schema#label";
const RDFS_COMMENT = "http://www.w3.org/2000/01/rdf-schema#comment";
const PREDICATE_CATEGORY_GROUPS: Readonly<Record<string, string>> = {
  分類: "分類・定義",
  語彙定義: "分類・定義",
  包含: "包含・構成",
  構成: "包含・構成",
  参照: "参照・一般関係",
  一般関係: "参照・一般関係",
  依存: "依存・順序",
  由来: "由来・版管理",
  版管理: "由来・版管理",
  担当: "担当・利用",
  利用: "担当・利用",
  概念関係: "概念・関係の対応",
  概念対応: "概念・関係の対応",
  関係対応: "概念・関係の対応",
  同一性: "概念・関係の対応",
};

const props = withDefaults(defineProps<{
  enabled?: boolean;
  blockedReason?: string;
  guidance?: string;
  busy?: boolean;
  resources?: AuthoringChoice[];
  selectedResources?: AuthoringChoice[];
  selectedEdge?: IntentEdgeDetails;
  elementDetails?: IntentElementDetails;
  classes?: AuthoringChoice[];
  predicates?: AuthoringChoice[];
  memberships?: IntentMembershipOption[];
  sequences?: IntentSequenceOption[];
  incidentRelations?: IntentRelationOverview[];
  membershipOverview?: MembershipOverview;
  requestedIntent?: SemanticIntent;
  pickedSourceIri?: string;
  pickedTargetIri?: string;
  diagnostics?: ProjectionDiagnostic[];
}>(), {
  enabled: true,
  blockedReason: "",
  guidance: "",
  busy: false,
  resources: () => [],
  selectedResources: () => [],
  selectedEdge: undefined,
  elementDetails: undefined,
  classes: () => [],
  predicates: () => [],
  memberships: () => [],
  sequences: () => [],
  incidentRelations: () => [],
  membershipOverview: () => ({ belongsTo: [], contains: [] }),
  requestedIntent: undefined,
  pickedSourceIri: "",
  pickedTargetIri: "",
  diagnostics: () => [],
});

const emit = defineEmits<{
  executeDraft: [draft: EditorAuthoringDraft, label: string];
  executeCommands: [commands: AuthoringCommand[], label: string, resources: Array<{ iri: string; label: string; role: string }>];
  deleteSelection: [];
  cancel: [];
  pickResource: [field: "sourceIri" | "targetIri"];
  useSelfTarget: [sourceIri: string];
  focusElement: [elementId: string];
  intentChange: [intent: SemanticIntent | undefined];
  draftStateChange: [pending: boolean];
}>();

const intent = ref<SemanticIntent>();
const label = ref("");
const labelValues = ref<IntentTextValue[]>([]);
const commentValues = ref<IntentTextValue[]>([]);
const statementCommentValues = ref<IntentTextValue[]>([]);
const classIris = ref<string[]>([]);
const predicateIri = ref("");
const sourceIri = ref("");
const targetIri = ref("");
const selfRelationExplicit = ref(false);
const predicateSelectionGuidance = ref("");
const membershipActions = ref<Record<string, "keep" | "add" | "remove">>({});
const sequenceIri = ref("");
const sequenceMemberIris = ref<string[]>([]);
const panelRoot = ref<HTMLElement>();

const relationResourceChoices = computed(() => [...props.resources, ...props.selectedResources]
  .filter((resource, index, all) => (
    all.findIndex((candidate) => candidate.iri === resource.iri) === index
  )));
const relationSelection = computed(() => ({
  source: relationResourceChoices.value.find((resource) => resource.iri === sourceIri.value),
  targets: relationResourceChoices.value.filter((resource) => resource.iri === targetIri.value),
}));
const inspectedResources = computed<AuthoringChoice[]>(() => props.selectedResources.length
  ? props.selectedResources
  : props.elementDetails
    ? [{ iri: props.elementDetails.iri, label: props.elementDetails.label }]
    : []);
const predicateSelectionValid = computed(() => Boolean(
  predicateIri.value && props.predicates.some((choice) => choice.iri === predicateIri.value),
));
const relationReady = computed(() => Boolean(
  relationSelection.value.source
  && relationSelection.value.targets.length
  && predicateSelectionValid.value
  && (sourceIri.value !== targetIri.value || selfRelationExplicit.value),
));
const selectedPredicateLabel = computed(() => props.predicates.find(
  (choice) => choice.iri === (predicateIri.value || props.selectedEdge?.predicateIri),
)?.label ?? "関係");
const inspectedMembershipCount = computed(() => (
  props.membershipOverview.belongsTo.length + props.membershipOverview.contains.length
));
const predicateGroups = computed(() => {
  const groups = new Map<string, AuthoringChoice[]>();
  for (const choice of props.predicates) {
    const sourceCategory = choice.category?.trim() || "その他の関係";
    const category = PREDICATE_CATEGORY_GROUPS[sourceCategory] ?? sourceCategory;
    const group = groups.get(category) ?? [];
    group.push(choice);
    groups.set(category, group);
  }
  return [...groups].map(([category, choices]) => ({ category, choices }));
});
const classificationRegionIris = computed(() => new Set(props.memberships
  .filter((option) => option.predicateIri === RDF_TYPE && option.containerPosition === "object")
  .map((option) => option.containerIri)));
const semanticTypeChoices = computed(() => props.classes);
const editableMemberships = computed(() => props.memberships.filter(
  (option) => !(option.predicateIri === RDF_TYPE && option.containerPosition === "object"),
));
const currentConceptRegions = computed(() => {
  const resourceIri = props.elementDetails?.iri;
  if (!resourceIri) return [];
  return props.memberships.filter((option) => (
    option.predicateIri === RDF_TYPE
    && option.containerPosition === "object"
    && option.memberIris.includes(resourceIri)
  ));
});
const currentBusinessMemberships = computed(() => {
  const resourceIri = props.elementDetails?.iri;
  if (!resourceIri) return [];
  return editableMemberships.value.filter((option) => option.memberIris.includes(resourceIri));
});
const localDraftPending = computed(() => {
  if (intent.value === "add-element") return label.value.trim().length > 0;
  if (intent.value === "add-relation") return relationReady.value;
  if (intent.value === "edit-element") {
    const details = props.elementDetails;
    if (!details) return false;
    const nextLabels = cloneTextValues(labelValues.value, label.value);
    if (nextLabels[0]) nextLabels[0] = { ...nextLabels[0], value: label.value };
    const effectiveLabels = nextLabels.filter((item, index) => index === 0 || item.value.length > 0);
    return JSON.stringify(effectiveLabels) !== JSON.stringify(details.labelValues)
      || JSON.stringify(commentValues.value) !== JSON.stringify(details.commentValues)
      || JSON.stringify([...classIris.value].sort()) !== JSON.stringify([...details.classIris].sort());
  }
  if (intent.value === "edit-relation") {
    const edge = props.selectedEdge;
    if (edge) return sourceIri.value !== edge.sourceIri
      || targetIri.value !== edge.targetIri
      || predicateIri.value !== edge.predicateIri
      || JSON.stringify(statementCommentValues.value) !== JSON.stringify(edge.statementComments ?? []);
    if (Object.values(membershipActions.value).some((action) => action !== "keep")) return true;
    const sequence = selectedSequence();
    return Boolean(sequence && JSON.stringify(sequenceMemberIris.value) !== JSON.stringify(sequence.memberIris));
  }
  return false;
});

watch(() => props.requestedIntent, (requested) => {
  if (requested && requested !== intent.value) choose(requested);
});
watch(localDraftPending, (pending) => emit("draftStateChange", pending), { immediate: true });

watch(() => props.elementDetails, (details) => {
  if (intent.value !== "edit-element" || !details) return;
  label.value = details.label;
  labelValues.value = cloneTextValues(details.labelValues, details.label);
  commentValues.value = cloneTextValues(details.commentValues);
  classIris.value = [...details.classIris];
});
watch(() => props.selectedEdge, (edge) => {
  if (intent.value !== "edit-relation" || !edge) return;
  predicateIri.value = edge.predicateIri;
  predicateSelectionGuidance.value = "";
  sourceIri.value = edge.sourceIri;
  targetIri.value = edge.targetIri;
  statementCommentValues.value = cloneTextValues(edge.statementComments ?? []);
});
watch(() => props.predicates.map((choice) => choice.iri), (availablePredicateIris) => {
  if (!predicateIri.value || availablePredicateIris.includes(predicateIri.value)) return;
  predicateIri.value = "";
  predicateSelectionGuidance.value = "始点・終点に合う関係の種類を選び直してください。";
});
watch([() => props.sequences, intent], ([sequences, currentIntent]) => {
  if (currentIntent !== "edit-relation") return;
  if (!sequences.some((option) => option.sequenceIri === sequenceIri.value)) {
    sequenceIri.value = sequences.length === 1 ? sequences[0]!.sequenceIri : "";
  }
  syncSequenceMembers();
}, { deep: true });
watch(() => props.pickedSourceIri, (value) => {
  if (!value) {
    if (intent.value === "add-relation") {
      sourceIri.value = "";
      targetIri.value = "";
      selfRelationExplicit.value = false;
    }
    return;
  }
  if (sourceIri.value !== value) {
    targetIri.value = "";
    selfRelationExplicit.value = false;
  }
  sourceIri.value = value;
});
watch(() => props.pickedTargetIri, (value) => {
  if (!value) {
    if (intent.value === "add-relation") {
      targetIri.value = "";
      selfRelationExplicit.value = false;
    }
    return;
  }
  targetIri.value = value;
  if (value !== sourceIri.value) selfRelationExplicit.value = false;
});

function choose(next: SemanticIntent): void {
  intent.value = next;
  predicateSelectionGuidance.value = "";
  emit("intentChange", next);
  if (next === "add-element") label.value = "";
  if (next === "add-relation") {
    predicateIri.value = props.predicates.length === 1 ? props.predicates[0]?.iri ?? "" : "";
    sourceIri.value = props.selectedResources.length === 1 ? props.selectedResources[0]!.iri : "";
    targetIri.value = "";
    selfRelationExplicit.value = false;
    emit("pickResource", sourceIri.value ? "targetIri" : "sourceIri");
  }
  if (next === "edit-element" && props.elementDetails) {
    label.value = props.elementDetails.label;
    labelValues.value = cloneTextValues(props.elementDetails.labelValues, props.elementDetails.label);
    commentValues.value = cloneTextValues(props.elementDetails.commentValues);
    classIris.value = [...props.elementDetails.classIris];
  }
  if (next === "edit-relation" && props.selectedEdge) {
    predicateIri.value = props.selectedEdge.predicateIri;
    sourceIri.value = props.selectedEdge.sourceIri;
    targetIri.value = props.selectedEdge.targetIri;
    statementCommentValues.value = cloneTextValues(props.selectedEdge.statementComments ?? []);
  }
  void nextTick(() => {
    const firstField = panelRoot.value?.querySelector<HTMLElement>(
      ".iriograph-intent-fields textarea:not([disabled]), .iriograph-intent-fields input:not([disabled]), .iriograph-intent-fields select:not([disabled]), .iriograph-intent-fields button:not([disabled])",
    );
    (firstField ?? panelRoot.value)?.focus();
  });
}

function reset(): void {
  intent.value = undefined;
  emit("intentChange", undefined);
  label.value = "";
  labelValues.value = [];
  commentValues.value = [];
  classIris.value = [];
  predicateIri.value = "";
  predicateSelectionGuidance.value = "";
  sourceIri.value = "";
  targetIri.value = "";
  selfRelationExplicit.value = false;
  statementCommentValues.value = [];
  membershipActions.value = {};
  sequenceIri.value = "";
  sequenceMemberIris.value = [];
}

function cancel(): void {
  reset();
  emit("cancel");
}

function previewElementCreation(): void {
  const draft = emptyAuthoringDraft("create-resource");
  draft.label = label.value;
  emit("executeDraft", draft, "要素を追加");
}

function previewRelationCreation(): void {
  const source = relationSelection.value.source;
  if (!source || !relationReady.value) return;
  const draft = emptyAuthoringDraft("connect-resources", source.iri);
  draft.sourceIri = source.iri;
  draft.targetIri = targetIri.value;
  draft.targetIris = [];
  draft.predicateIri = predicateIri.value;
  emit("executeDraft", draft, `${source.label ?? "基準要素"}から関係を追加`);
}

function useSourceAsTarget(): void {
  if (!sourceIri.value) return;
  targetIri.value = sourceIri.value;
  selfRelationExplicit.value = true;
  emit("useSelfTarget", sourceIri.value);
}

function confirmPredicateSelection(): void {
  predicateSelectionGuidance.value = "";
}

function previewElementEdit(): void {
  const details = props.elementDetails;
  if (!details) return;
  const commands: AuthoringCommand[] = [];
  const nextLabels = cloneTextValues(labelValues.value, label.value);
  nextLabels[0] = { ...nextLabels[0], value: label.value };
  const effectiveLabels = nextLabels.filter((item, index) => index === 0 || item.value.length > 0);
  if (JSON.stringify(effectiveLabels) !== JSON.stringify(details.labelValues)) commands.push({
    type: "set-property",
    commandId: "intent-label",
    subjectIri: details.iri,
    predicateIri: RDFS_LABEL,
    values: effectiveLabels.map((item) => ({ kind: "literal", ...item })),
  });
  if (JSON.stringify(commentValues.value) !== JSON.stringify(details.commentValues)) commands.push({
    type: "set-property",
    commandId: "intent-comment",
    subjectIri: details.iri,
    predicateIri: RDFS_COMMENT,
    values: commentValues.value.filter((item) => item.value).map((item) => ({ kind: "literal", ...item })),
  });
  if (JSON.stringify([...classIris.value].sort()) !== JSON.stringify([...details.classIris].sort())) commands.push({
    type: "set-property",
    commandId: "intent-types",
    subjectIri: details.iri,
    predicateIri: RDF_TYPE,
    values: classIris.value.map((iri) => ({ kind: "iri", iri })),
  });
  emit("executeCommands", commands, `${details.label}を編集`, [{ iri: details.iri, label: details.label, role: "対象" }]);
}

function previewElementDelete(): void {
  if (!props.elementDetails) return;
  emit("deleteSelection");
}

function previewEdgeEdit(): void {
  const edge = props.selectedEdge;
  const capability = edge?.capability;
  if (!edge || capability?.command !== "remove-statement" || !predicateSelectionValid.value) return;
  const commands: AuthoringCommand[] = [{
    type: "remove-statement",
    commandId: "intent-replace-edge-remove",
    statementRef: capability.statementRef,
    subjectIri: capability.subject,
    predicateIri: capability.predicate,
    objectIri: capability.object,
  }];
  if (sourceIri.value && targetIri.value && predicateIri.value) {
    const nextStatement = {
      subjectIri: sourceIri.value,
      predicateIri: predicateIri.value,
      objectIri: targetIri.value,
    };
    commands.push({
      type: "connect-resources",
      commandId: "intent-replace-edge-add",
      ...nextStatement,
    }, {
      type: "set-statement-comments",
      commandId: "intent-replace-edge-comments",
      statementRef: statementIdentityForNamedStatement(nextStatement),
      ...nextStatement,
      comments: statementCommentValues.value
        .filter((item) => item.value.length > 0)
        .map((item) => ({ kind: "literal", ...item })),
    });
  }
  emit("executeCommands", commands, `${edge.label}を変更`, [
    { iri: sourceIri.value, label: resourceLabel(sourceIri.value), role: "始点" },
    { iri: targetIri.value, label: resourceLabel(targetIri.value), role: "終点" },
  ]);
}

function previewEdgeDelete(): void {
  if (!props.selectedEdge?.capability) return;
  emit("deleteSelection");
}

function previewMemberships(): void {
  const selected = props.selectedResources;
  const commands: AuthoringCommand[] = [];
  for (const option of editableMemberships.value) {
    const action = membershipActions.value[option.containerIri] ?? "keep";
    if (action === "keep") continue;
    for (const member of selected) {
      if (member.iri === option.containerIri) continue;
      const currentlyPresent = option.memberIris.includes(member.iri);
      const enabled = action === "add";
      if (currentlyPresent === enabled) continue;
      commands.push({
        type: "set-membership",
        commandId: `intent-membership-${commands.length + 1}`,
        containerIri: option.containerIri,
        memberIri: member.iri,
        enabled,
        containerTypeIri: option.containerTypeIri,
        predicateIri: option.predicateIri,
        containerPosition: option.containerPosition,
      });
    }
  }
  emit("executeCommands", commands, "所属領域をまとめて変更", selected.map((item) => ({
    iri: item.iri,
    label: item.label ?? "要素",
    role: "対象",
  })));
}

function selectedSequence(): IntentSequenceOption | undefined {
  return props.sequences.find((option) => option.sequenceIri === sequenceIri.value);
}

function syncSequenceMembers(): void {
  const sequence = selectedSequence();
  sequenceMemberIris.value = sequence ? [...sequence.memberIris] : [];
}

function sequenceMemberLabel(iri: string): string {
  const sequence = selectedSequence();
  return sequence?.members.find((member) => member.iri === iri)?.label
    ?? props.selectedResources.find((resource) => resource.iri === iri)?.label
    ?? "選択した要素";
}

function sequenceCandidates(): AuthoringChoice[] {
  const sequence = selectedSequence();
  if (!sequence) return [];
  return props.selectedResources.filter((resource) => (
    resource.iri !== sequence.sequenceIri && !sequenceMemberIris.value.includes(resource.iri)
  ));
}

function addSelectedSequenceMembers(): void {
  sequenceMemberIris.value.push(...sequenceCandidates().map((resource) => resource.iri));
}

function moveSequenceMember(index: number, delta: -1 | 1): void {
  const target = index + delta;
  if (target < 0 || target >= sequenceMemberIris.value.length) return;
  const [member] = sequenceMemberIris.value.splice(index, 1);
  sequenceMemberIris.value.splice(target, 0, member!);
}

function removeSequenceMember(index: number): void {
  sequenceMemberIris.value.splice(index, 1);
}

function previewSequence(): void {
  const sequence = selectedSequence();
  if (!sequence || sequenceMemberIris.value.length === 0) return;
  emit("executeCommands", [{
    type: "set-sequence",
    commandId: "intent-sequence",
    sequenceIri: sequence.sequenceIri,
    memberIris: [...sequenceMemberIris.value],
    sequenceTypeIri: sequence.sequenceTypeIri,
    ordinalPredicatePrefix: sequence.ordinalPredicatePrefix,
  }], `${sequence.label}の並び順を変更`, [{
    iri: sequence.sequenceIri,
    label: sequence.label,
    role: "並び順",
  }]);
}

function membershipState(option: IntentMembershipOption): string {
  const count = props.selectedResources.filter((resource) => option.memberIris.includes(resource.iri)).length;
  if (count === 0) return "未所属";
  if (count === props.selectedResources.length) return "全件所属";
  return `${count}/${props.selectedResources.length}件所属`;
}

function resourceLabel(iri: string): string {
  return props.resources.find((item) => item.iri === iri)?.label
    ?? props.selectedResources.find((item) => item.iri === iri)?.label
    ?? (props.selectedEdge?.sourceIri === iri ? props.selectedEdge.sourceLabel : undefined)
    ?? (props.selectedEdge?.targetIri === iri ? props.selectedEdge.targetLabel : undefined)
    ?? "Canvasで選択した要素";
}

function membershipContainerKindLabel(kind: MembershipOverview["belongsTo"][number]["containerKind"]): string {
  if (kind === "sequence") return "並び順";
  return kind === "region" ? "領域" : "包含領域";
}

function membershipRoleLabel(item: MembershipOverview["belongsTo"][number]): string {
  if (item.role === "sequence-member") return `順番 ${item.ordinal ?? "?"}`;
  return "所属";
}

function canRemoveMembership(item: MembershipOverview["belongsTo"][number]): boolean {
  return item.provenance.editCapability?.command === "set-membership";
}

function removeMembership(item: MembershipOverview["belongsTo"][number]): void {
  const capability = item.provenance.editCapability;
  if (capability?.command !== "set-membership") return;
  emit("executeCommands", [{
    type: "set-membership",
    commandId: "overview-remove-membership",
    containerIri: capability.container,
    memberIri: capability.member,
    enabled: false,
    containerTypeIri: capability.containerTypeIri,
    predicateIri: capability.predicate,
    containerPosition: capability.containerPosition,
  }], `${item.label}との所属を解除`, [
    { iri: capability.container, label: resourceLabel(capability.container), role: "領域" },
    { iri: capability.member, label: resourceLabel(capability.member), role: "含まれる要素" },
  ]);
}

function editMembership(
  item: MembershipOverview["belongsTo"][number],
  direction: "belongs-to" | "contains",
): void {
  // A container's child list first moves selection to that child. For a
  // member's parent list the already-selected member remains the edit target.
  if (direction === "contains") emit("focusElement", item.relatedElementId);
  choose("edit-relation");
}

function cloneTextValues(values: readonly IntentTextValue[], fallback = ""): IntentTextValue[] {
  const result = values.map((item) => ({ ...item }));
  if (result.length === 0 && fallback) result.push({ value: fallback });
  return result;
}

function addAlias(): void {
  labelValues.value.push({ value: "" });
}

function addComment(): void {
  commentValues.value.push({ value: "" });
}

function removeAlias(index: number): void {
  labelValues.value.splice(index, 1);
}

function removeComment(index: number): void {
  commentValues.value.splice(index, 1);
}

function addStatementComment(): void {
  statementCommentValues.value.push({ value: "" });
}

function removeStatementComment(index: number): void {
  statementCommentValues.value.splice(index, 1);
}

function focusPendingIntent(): void {
  const primaryAction = panelRoot.value?.querySelector<HTMLElement>(
    ".iriograph-intent-fields button.primary:not([disabled])",
  );
  const firstField = panelRoot.value?.querySelector<HTMLElement>(
    ".iriograph-intent-fields textarea:not([disabled]), .iriograph-intent-fields input:not([disabled]), .iriograph-intent-fields select:not([disabled])",
  );
  (primaryAction ?? firstField ?? panelRoot.value)?.focus();
}

defineExpose({ focusPendingIntent, resetIntent: reset });
</script>

<template>
  <section ref="panelRoot" class="iriograph-intent-panel" aria-label="意味グラフを編集" tabindex="-1">
    <p v-if="blockedReason" class="iriograph-authoring-blocked">{{ blockedReason }}</p>
    <p v-if="guidance" class="iriograph-intent-guidance" role="status">{{ guidance }}</p>
    <ul v-if="diagnostics.length" class="iriograph-intent-diagnostics" aria-label="意味編集の結果" role="status">
      <li v-for="(item, index) in diagnostics" :key="`${item.code}:${index}`" :class="item.severity">
        <b>{{ diagnosticGuidance(item).title }}</b><span>{{ diagnosticGuidance(item).action }}</span>
      </li>
    </ul>
    <template v-if="!intent">
      <header><small>意味</small><strong>Canvasの選択</strong></header>
      <section class="iriograph-semantic-selection-summary" aria-label="選択中の意味情報">
        <template v-if="selectedEdge">
          <small>関係</small>
          <strong>{{ selectedEdge.sourceLabel }}（{{ selectedPredicateLabel }}）{{ selectedEdge.targetLabel }}</strong>
          <span v-if="selectedEdge.derivedReason">{{ selectedEdge.derivedReason }}</span>
          <span v-else>{{ statementCommentValues.length || selectedEdge.statementComments?.length ? `${selectedEdge.statementComments?.length ?? 0}件の説明` : '説明なし' }}</span>
        </template>
        <template v-else-if="inspectedResources.length">
          <small>{{ inspectedResources.length === 1 ? '要素' : `${inspectedResources.length}件を選択` }}</small>
          <strong>{{ inspectedResources.map((item) => item.label ?? '名前のない要素').join('、') }}</strong>
          <span>{{ incidentRelations.length }}件の接続関係・{{ inspectedMembershipCount }}件の包含情報</span>
        </template>
        <template v-else>
          <small>選択なし</small>
          <strong>Canvasで要素か関係を選択</strong>
          <span>選択した対象に使える編集だけを表示します。</span>
        </template>
      </section>
      <section
        v-if="!selectedEdge && inspectedResources.length === 1"
        class="iriograph-relation-overview iriograph-membership-overview"
        aria-label="選択要素の包含一覧"
      >
        <section aria-label="属する領域">
          <strong>属する領域 <small>{{ membershipOverview.belongsTo.length }}件</small></strong>
          <ul v-if="membershipOverview.belongsTo.length">
            <li v-for="item in membershipOverview.belongsTo" :key="`parent:${item.semanticRef}:${item.relatedElementId}:${item.ordinal ?? 0}`">
              <span>{{ item.label }}</span>
              <small>{{ membershipContainerKindLabel(item.containerKind) }}・{{ membershipRoleLabel(item) }}</small>
              <span class="iriograph-membership-overview-actions">
                <button type="button" @click="emit('focusElement', item.relatedElementId)">Canvasで確認</button>
                <button type="button" :disabled="!enabled || busy" @click="editMembership(item, 'belongs-to')">この所属を編集</button>
                <button v-if="canRemoveMembership(item)" type="button" :disabled="!enabled || busy" @click="removeMembership(item)">所属を解除</button>
              </span>
            </li>
          </ul>
          <p v-else>属する領域はありません。</p>
        </section>
        <section aria-label="含む要素">
          <strong>含む要素 <small>{{ membershipOverview.contains.length }}件</small></strong>
          <ul v-if="membershipOverview.contains.length">
            <li v-for="item in membershipOverview.contains" :key="`child:${item.semanticRef}:${item.relatedElementId}:${item.ordinal ?? 0}`">
              <span>{{ item.label }}</span>
              <small>{{ membershipContainerKindLabel(item.containerKind) }}・{{ membershipRoleLabel(item) }}</small>
              <span class="iriograph-membership-overview-actions">
                <button type="button" @click="emit('focusElement', item.relatedElementId)">Canvasで確認</button>
                <button type="button" :disabled="!enabled || busy" @click="editMembership(item, 'contains')">この所属を編集</button>
                <button v-if="canRemoveMembership(item)" type="button" :disabled="!enabled || busy" @click="removeMembership(item)">包含から外す</button>
              </span>
            </li>
          </ul>
          <p v-else>含む要素はありません。</p>
        </section>
      </section>
      <nav class="iriograph-intent-grid iriograph-intent-add-actions" aria-label="意味を追加">
        <button type="button" :disabled="!enabled || busy" @click="choose('add-element')"><b>＋</b><span>要素を追加</span></button>
        <button type="button" :disabled="!enabled || busy" @click="choose('add-relation')"><b>→</b><span>関係を追加</span></button>
      </nav>
      <nav v-if="selectedEdge || inspectedResources.length" class="iriograph-selection-edit-actions" aria-label="選択中の意味を編集">
        <button v-if="selectedEdge" type="button" :disabled="!enabled || busy" @click="choose('edit-relation')">関係の意味を編集</button>
        <template v-else>
          <button v-if="inspectedResources.length === 1" type="button" :disabled="!enabled || busy" @click="choose('edit-element')">要素の詳細を編集</button>
          <button type="button" :disabled="!enabled || busy" @click="choose('edit-relation')">所属・並び順を編集</button>
        </template>
      </nav>
    </template>

    <template v-else>
      <header><button type="button" aria-label="選択内容へ戻る" @click="cancel">←</button><strong>{{ intent === 'add-element' ? '要素を追加' : intent === 'add-relation' ? '関係を追加' : intent === 'edit-element' ? '要素の詳細を編集' : selectedEdge ? '関係の意味を編集' : '所属・並び順を編集' }}</strong></header>

      <section v-if="intent === 'add-element'" class="iriograph-intent-fields">
        <p>名前を入力します。識別子は自動で安全に採番されます。</p>
        <label><span>名前</span><textarea v-model="label" aria-label="新しい要素の名前" rows="2" /></label>
        <button type="button" class="primary" :disabled="!label.trim() || busy" @click="previewElementCreation">要素を作成</button>
      </section>

      <section v-else-if="intent === 'add-relation'" class="iriograph-intent-fields">
        <p>始点、終点の順にCanvas上の要素を通常クリックで選びます。</p>
        <div class="iriograph-intent-selection"><b>始点</b><span>{{ relationSelection.source?.label ?? '未選択' }}</span><b>終点</b><span>{{ relationSelection.targets[0]?.label ?? '未選択' }}</span></div>
        <div class="iriograph-intent-grid">
          <button type="button" :disabled="!enabled || busy" @click="emit('pickResource', 'sourceIri')">始点を選び直す</button>
          <button type="button" :disabled="!enabled || busy || !sourceIri" @click="emit('pickResource', 'targetIri')">終点を選び直す</button>
        </div>
        <p v-if="sourceIri && !targetIri">始点とは別の要素を終点としてクリックしてください。</p>
        <button v-if="sourceIri" type="button" :disabled="!enabled || busy || !predicateIri" @click="useSourceAsTarget">明示的に始点自身へ接続</button>
        <p v-if="predicateSelectionGuidance" class="iriograph-intent-guidance" role="status">{{ predicateSelectionGuidance }}</p>
        <section class="iriograph-predicate-cards" aria-label="関係の種類">
          <header><strong>関係の種類</strong><small>A = 始点、B = 終点として候補の意味を示します。</small></header>
          <fieldset v-for="group in predicateGroups" :key="group.category" class="iriograph-intent-group-card iriograph-predicate-group">
            <legend>{{ group.category }}</legend>
            <label v-for="choice in group.choices" :key="choice.iri" :class="{ selected: predicateIri === choice.iri }">
              <input v-model="predicateIri" type="radio" :value="choice.iri" @change="confirmPredicateSelection" />
              <strong>A（{{ choice.label ?? '関係' }}）B</strong>
              <span class="iriograph-predicate-sentence">{{ choice.sentencePattern ?? `A（${choice.label ?? '関係'}）B` }}</span>
              <small v-if="choice.description">{{ choice.description }}</small>
            </label>
          </fieldset>
        </section>
        <p v-if="predicateIri && targetIri">「{{ selectedPredicateLabel }}」を1本作成します。</p>
        <button type="button" class="primary" :disabled="!relationReady || busy" @click="previewRelationCreation">関係を作成</button>
      </section>

      <section v-else-if="intent === 'edit-element'" class="iriograph-intent-fields">
        <p v-if="!elementDetails">Canvasから編集する要素を1つ選択してください。</p>
        <template v-else>
          <label><span>名前</span><textarea v-model="label" aria-label="要素の名前" rows="2" /></label>
          <fieldset class="iriograph-intent-group-card"><legend>別名</legend><label v-for="(item, index) in labelValues.slice(1)" :key="index"><span>{{ item.language ? `別名（${item.language}）` : '別名' }}</span><textarea v-model="item.value" :aria-label="`要素の別名 ${index + 1}`" rows="2" /><button type="button" :aria-label="`要素の別名 ${index + 1}を削除`" @click="removeAlias(index + 1)">この別名を削除</button></label><button type="button" @click="addAlias">別名を追加</button></fieldset>
          <fieldset class="iriograph-intent-group-card"><legend>説明</legend><label v-for="(item, index) in commentValues" :key="index"><span>{{ item.language ? `説明（${item.language}）` : '説明' }}</span><textarea v-model="item.value" :aria-label="`要素の説明 ${index + 1}`" rows="3" /><button type="button" :aria-label="`要素の説明 ${index + 1}を削除`" @click="removeComment(index)">この説明を削除</button></label><button type="button" @click="addComment">説明を追加</button></fieldset>
          <fieldset class="iriograph-intent-group-card iriograph-semantic-type-editor"><legend>要素の種類</legend><label v-for="choice in semanticTypeChoices" :key="choice.iri"><input v-model="classIris" type="checkbox" :value="choice.iri" /><span>{{ choice.label ?? '種類' }}<small v-if="classificationRegionIris.has(choice.iri)">このビューでは概念領域にも反映</small></span></label><p v-if="semanticTypeChoices.length === 0">選択できる種類はありません。</p></fieldset>
          <section class="iriograph-intent-group-card iriograph-current-memberships" aria-label="所属する領域"><strong>所属する領域</strong><template v-if="currentConceptRegions.length"><small>概念領域（上の「要素の種類」と同じ設定）</small><ul><li v-for="option in currentConceptRegions" :key="option.containerIri">{{ option.label }}</li></ul></template><small>業務上の所属</small><ul v-if="currentBusinessMemberships.length"><li v-for="option in currentBusinessMemberships" :key="option.containerIri">{{ option.label }}</li></ul><p v-else>業務上の所属はありません。</p><small>業務上の所属の追加・解除は「所属・並び順を編集」で行います。</small></section>
          <section v-if="incidentRelations.length" class="iriograph-relation-overview" aria-label="接続している関係"><strong>接続している関係</strong><ul><li v-for="relation in incidentRelations" :key="relation.edgeElementId"><span>{{ relation.sourceLabel }}（{{ relation.predicateLabel }}）{{ relation.targetLabel }}</span><small>{{ relation.direction === 'outgoing' ? 'この要素から出る関係' : relation.direction === 'incoming' ? 'この要素へ入る関係' : 'この要素自身への関係' }}</small><button type="button" @click="emit('focusElement', relation.edgeElementId)">Canvasで確認</button></li></ul></section>
          <button type="button" class="primary" :disabled="!label.trim() || busy" @click="previewElementEdit">変更を保存</button>
          <details class="iriograph-danger-zone"><summary>要素を削除</summary><p>選択外の関係や並び順にも影響する場合だけ、削除前に一覧を表示します。</p><button type="button" :disabled="busy" @click="previewElementDelete">選択した要素を削除</button></details>
        </template>
      </section>

      <section v-else class="iriograph-intent-fields">
        <template v-if="selectedEdge">
          <p v-if="selectedEdge.derivedReason" class="iriograph-authoring-blocked">{{ selectedEdge.derivedReason }}</p>
          <template v-else>
            <section class="iriograph-relation-overview" aria-label="接続している要素"><strong>接続している要素</strong><div class="iriograph-intent-selection"><b>始点</b><span>{{ resourceLabel(sourceIri) }}</span><b>関係</b><span>{{ selectedPredicateLabel }}</span><b>終点</b><span>{{ resourceLabel(targetIri) }}</span></div></section>
            <button type="button" :disabled="!enabled || busy" @click="emit('pickResource', 'sourceIri')">始点をCanvasから選択</button>
            <button type="button" :disabled="!enabled || busy" @click="emit('pickResource', 'targetIri')">終点をCanvasから選択</button>
            <label><span>関係</span><select v-model="predicateIri" @change="confirmPredicateSelection"><optgroup v-for="group in predicateGroups" :key="group.category" :label="group.category"><option v-for="choice in group.choices" :key="choice.iri" :value="choice.iri">A（{{ choice.label ?? '関係' }}）B — {{ choice.sentencePattern ?? `A（${choice.label ?? '関係'}）B` }}</option></optgroup></select></label>
            <p v-if="predicateSelectionGuidance" class="iriograph-intent-guidance" role="status">{{ predicateSelectionGuidance }}</p>
            <fieldset class="iriograph-intent-group-card"><legend>この関係だけの説明</legend><p>この矢印だけの意味としてTurtleへ保存され、LLMにも渡されます。</p><label v-for="(item, index) in statementCommentValues" :key="index"><span>{{ item.language ? `説明（${item.language}）` : '説明' }}</span><textarea v-model="item.value" :aria-label="`この関係だけの説明 ${index + 1}`" rows="3" /><button type="button" :aria-label="`この関係だけの説明 ${index + 1}を削除`" @click="removeStatementComment(index)">この説明を削除</button></label><button type="button" @click="addStatementComment">説明を追加</button></fieldset>
            <button type="button" class="primary" :disabled="!sourceIri || !targetIri || !predicateSelectionValid || busy" @click="previewEdgeEdit">関係を更新</button>
            <button type="button" :disabled="busy" @click="previewEdgeDelete">この関係を削除</button>
          </template>
        </template>
        <template v-else>
          <p v-if="selectedResources.length === 0">Canvasで要素を選び、並び順または包含を変更します。</p>
          <template v-else>
            <section v-if="incidentRelations.length" class="iriograph-relation-overview" aria-label="接続している関係"><strong>接続している関係</strong><ul><li v-for="relation in incidentRelations" :key="relation.edgeElementId"><span>{{ relation.sourceLabel }}（{{ relation.predicateLabel }}）{{ relation.targetLabel }}</span><small>{{ relation.direction === 'outgoing' ? '選択要素から出る関係' : relation.direction === 'incoming' ? '選択要素へ入る関係' : '選択要素自身への関係' }}<template v-if="relation.derivedReason">・自動生成</template></small><button type="button" @click="emit('focusElement', relation.edgeElementId)">Canvasで確認</button></li></ul></section>
            <section v-if="sequences.length" class="iriograph-sequence-editor" aria-label="並び順を編集">
              <label v-if="sequences.length > 1"><span>編集する並び順</span><select v-model="sequenceIri" @change="syncSequenceMembers"><option value="">選択してください</option><option v-for="option in sequences" :key="option.sequenceIri" :value="option.sequenceIri">{{ option.label }}</option></select></label>
              <template v-if="selectedSequence()">
                <strong>{{ selectedSequence()!.label }}</strong>
                <p>番号付きの枠内要素を並べ替えます。通常の関係線とは別の構造です。</p>
                <ol><li v-for="(memberIri, index) in sequenceMemberIris" :key="`${memberIri}:${index}`"><b>{{ index + 1 }}</b><span>{{ sequenceMemberLabel(memberIri) }}</span><button type="button" :disabled="index === 0" :aria-label="`${sequenceMemberLabel(memberIri)}を前へ`" @click="moveSequenceMember(index, -1)">↑</button><button type="button" :disabled="index === sequenceMemberIris.length - 1" :aria-label="`${sequenceMemberLabel(memberIri)}を後ろへ`" @click="moveSequenceMember(index, 1)">↓</button><button type="button" :aria-label="`${sequenceMemberLabel(memberIri)}を並び順から外す`" @click="removeSequenceMember(index)">除外</button></li></ol>
                <button v-if="sequenceCandidates().length" type="button" @click="addSelectedSequenceMembers">Canvasで選択した {{ sequenceCandidates().length }}件を末尾へ追加</button>
                <button type="button" class="primary" :disabled="sequenceMemberIris.length === 0 || busy" @click="previewSequence">並び順を更新</button>
              </template>
            </section>
            <section v-if="editableMemberships.length" class="iriograph-membership-editor" aria-label="所属する領域を編集">
              <strong>所属する領域</strong><p>選択した要素の所属先・包含対象だけを変更します。要素の種類とは別の設定です。</p>
              <label v-for="option in editableMemberships" :key="option.containerIri"><span>{{ option.label }}（{{ membershipState(option) }}）</span><select v-model="membershipActions[option.containerIri]"><option value="keep">変更しない</option><option value="add">選択中をすべて追加</option><option value="remove">選択中をすべて解除</option></select></label>
              <button type="button" class="primary" :disabled="!Object.values(membershipActions).some((value) => value !== 'keep') || busy" @click="previewMemberships">所属を更新</button>
            </section>
            <p v-if="!sequences.length && !editableMemberships.length">この選択に変更できる並び順・業務上の所属はありません。概念領域は「要素の詳細を編集」の種類から設定します。</p>
          </template>
        </template>
      </section>
    </template>

  </section>
</template>
