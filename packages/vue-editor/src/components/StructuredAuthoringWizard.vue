<script lang="ts">
import type { FlowCanvasChoice } from "../structured-authoring-flow";

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

import { diagnosticGuidance } from "../diagnostic-guidance";
import {
  memberKey,
  reduceStructuredAuthoringFlow,
  selectionKey,
  structuredAuthoringRequestForDraft,
  structuredAuthoringStepStatus,
  STRUCTURED_AUTHORING_INTENT_OPTIONS,
  STRUCTURED_ELEMENT_KIND_OPTIONS,
  STRUCTURED_RELATION_FAMILY_OPTIONS,
  type FlowGroupMember,
  type StructuredAuthoringFlowEffect,
  type StructuredAuthoringFlowEvent,
  type StructuredAuthoringFlowState,
  type StructuredAuthoringReadyDraft,
} from "../structured-authoring-flow";

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
const lockReason = computed(() => props.disabledReason || (props.readOnly ? "読み取り専用のため変更できません。" : ""));
const stepStatus = computed(() => structuredAuthoringStepStatus(props.state));
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
  const query = predicateSearch.value.trim().toLocaleLowerCase("ja");
  return props.presentation.predicateCatalog.filter((item) => (
    (!predicateCategory.value || item.category === predicateCategory.value)
    && (!query || [item.label, item.description, item.sentencePattern, item.category]
      .some((value) => value?.toLocaleLowerCase("ja").includes(query)))
  ));
});
const phaseTitle = computed(() => PHASE_TITLES[props.state.phase]);
const showNext = computed(() => NEXT_PHASES.has(props.state.phase));
const errorCards = computed(() => props.state.phase === "error"
  ? props.state.diagnostics.map((diagnostic) => {
      const guidance = diagnosticGuidance(diagnostic);
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

function chooseIntent(intent: typeof STRUCTURED_AUTHORING_INTENT_OPTIONS[number]["intent"]): void {
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
  return canvasOption(selection)?.label ?? "選択済みの要素";
}

function canvasShape(selection?: StructuredCanvasSelection): string {
  return canvasOption(selection)?.shape ?? "rectangle";
}

function selectedPredicateLabel(predicateId?: string): string {
  return props.presentation.predicateCatalog.find((item) => item.predicateId === predicateId)?.label ?? "未選択";
}

function predicateSentence(item: StructuredAuthoringPresentation["predicateCatalog"][number]): string {
  return item.sentencePattern ?? `AはBと「${item.label}」の関係にあります`;
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
    .replaceAll("Turtle", "ソース")
    .replaceAll("RDF", "意味情報")
    .replaceAll("IRI", "識別情報");
}

const PHASE_TITLES: Readonly<Record<StructuredAuthoringFlowState["phase"], string>> = {
  intent: "何をしますか？",
  "element-kind": "作るものを選ぶ",
  "node-roles": "要素の種類を選ぶ",
  "group-kind": "グループの種類を選ぶ",
  "element-label": "名前を付ける",
  "relation-family": "つなぎ方を選ぶ",
  "direct-source": "始点を選ぶ",
  "direct-targets": "接続先を選ぶ",
  "direct-predicate": "関係を選ぶ",
  "membership-group": "所属先を選ぶ",
  "membership-members": "所属させる要素を選ぶ",
  "sequence-order": "順番を決める",
  "alternative-default": "既定候補を決める",
  "edit-element-select": "変更する要素を選ぶ",
  "edit-element-action": "要素の変更内容を選ぶ",
  "edit-relation-select": "変更する関係を選ぶ",
  "edit-relation-action": "関係の変更内容を選ぶ",
  ready: "変更を送信しました",
  submitting: "変更しています",
  error: "入力を見直してください",
};

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
      <div class="entry-grid" aria-label="意味編集の操作">
        <button
          v-for="(option, index) in STRUCTURED_AUTHORING_INTENT_OPTIONS"
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
        <small>意味編集</small>
        <h2 ref="stepHeading" tabindex="-1">{{ phaseTitle }}</h2>
      </header>

      <div v-if="state.phase === 'element-kind'" class="card-grid" role="group" aria-label="作るもの">
        <button v-for="option in STRUCTURED_ELEMENT_KIND_OPTIONS" :key="option.elementKind" type="button" class="choice-card" :disabled="locked" @click="dispatch({ type: 'choose-element-kind', elementKind: option.elementKind })">
          <span class="shape-preview" :class="option.elementKind" aria-hidden="true"></span><strong>{{ option.label }}</strong><span>{{ option.description }}</span>
        </button>
      </div>

      <div v-else-if="state.phase === 'node-roles' && nodeDraft" class="step-body">
        <p>当てはまる種類を選んでください。複数選べます。</p>
        <div class="card-grid" role="group" aria-label="要素の種類">
          <button v-for="role in presentation.profile.nodeRoles" :key="role.roleId" type="button" class="choice-card compact" :aria-pressed="nodeDraft.nodeRoleIds.includes(role.roleId)" :disabled="locked" @click="toggleNodeRole(role.roleId)">
            <span class="shape-preview node" aria-hidden="true"></span><strong>{{ role.label }}</strong><span v-if="role.description">{{ role.description }}</span>
          </button>
          <div v-if="presentation.profile.allowUntypedNodes" class="choice-card compact muted"><span class="shape-preview node" aria-hidden="true"></span><strong>未分類で作る</strong><span>種類を選ばず次へ進めます。</span></div>
        </div>
      </div>

      <div v-else-if="state.phase === 'group-kind' && groupDraft" class="card-grid" role="group" aria-label="グループの種類">
        <button v-for="kind in presentation.groupKinds" :key="kind.groupKind" type="button" class="choice-card" :aria-pressed="groupDraft.groupKind === kind.groupKind" :disabled="locked || !kind.enabled" :aria-describedby="!kind.enabled ? `group-disabled-${kind.groupKind}` : undefined" @click="dispatch({ type: 'set-group-kind', groupKind: kind.groupKind })">
          <span class="shape-preview group" aria-hidden="true"></span><strong>{{ kind.label }}</strong><span>{{ kind.description }}</span><small v-if="!kind.enabled" :id="`group-disabled-${kind.groupKind}`">{{ kind.disabledReason }}</small>
        </button>
      </div>

      <label v-else-if="state.phase === 'element-label' && (nodeDraft || groupDraft)" class="field-block"><span>名前</span><input :value="(nodeDraft || groupDraft)?.label" :disabled="locked" autocomplete="off" @input="setLabel" /></label>

      <div v-else-if="state.phase === 'relation-family'" class="card-grid family-grid" role="group" aria-label="つなぎ方">
        <button v-for="option in STRUCTURED_RELATION_FAMILY_OPTIONS" :key="option.family" type="button" class="choice-card family-card" :disabled="locked" @click="dispatch({ type: 'choose-relation-family', family: option.family })">
          <span class="family-icon" :class="option.family" aria-hidden="true"><i></i><i></i></span><strong>{{ option.label }}</strong><span>{{ option.description }}</span>
        </button>
      </div>

      <div v-else-if="state.phase === 'direct-source' && directDraft" class="step-body">
        <p>関係の始点になる要素をCanvasから一つ選びます。</p>
        <div v-if="directDraft.source" class="canvas-chip"><span class="shape-mini" :class="canvasShape(directDraft.source)" aria-hidden="true"></span><strong>{{ canvasLabel(directDraft.source) }}</strong><small>始点</small></div>
        <p v-else class="selection-wait" role="status">Canvasで始点を選択してください。</p>
        <button type="button" :disabled="locked" @click="requestCanvasSelection({ role: 'direct-source', multiple: false, acceptedKinds: ['node'] })">Canvasから始点を選ぶ</button>
      </div>

      <div v-else-if="state.phase === 'direct-targets' && directDraft" class="step-body">
        <p>接続先を一つ以上選びます。複数選択できます。</p>
        <div class="chip-list" aria-live="polite"><div v-for="target in directDraft.targets" :key="selectionKey(target)" class="canvas-chip"><span class="shape-mini" :class="canvasShape(target)" aria-hidden="true"></span><strong>{{ canvasLabel(target) }}</strong><button type="button" :aria-label="`${canvasLabel(target)}を外す`" :disabled="locked" @click="removeDirectTarget(target)">×</button></div></div>
        <p v-if="directDraft.targets.length === 0" class="selection-wait" role="status">Canvasで接続先を選択してください。</p>
        <button type="button" :disabled="locked" @click="requestCanvasSelection({ role: 'direct-targets', multiple: true, acceptedKinds: ['node'] })">Canvasから接続先を選ぶ</button>
      </div>

      <div v-else-if="state.phase === 'direct-predicate' && directDraft" class="step-body">
        <div class="predicate-tools"><label><span>関係を検索</span><input v-model="predicateSearch" :disabled="locked" /></label><div class="category-row" aria-label="関係の分類"><button type="button" :aria-pressed="predicateCategory === ''" @click="predicateCategory = ''">すべて</button><button v-for="category in predicateCategories" :key="category" type="button" :aria-pressed="predicateCategory === category" @click="predicateCategory = category">{{ category }}</button></div></div>
        <div class="predicate-list" role="group" aria-label="共通の関係"><button v-for="item in filteredPredicates" :key="item.predicateId" type="button" class="predicate-card" :aria-pressed="directDraft.predicateId === item.predicateId" :disabled="locked" @click="dispatch({ type: 'set-common-predicate', predicateId: item.predicateId })"><strong>A（{{ item.label }}）B</strong><span>{{ predicateSentence(item) }}</span><small v-if="item.description">{{ item.description }}</small><span v-if="predicateHierarchyItem(item.predicateId)?.paths.length" class="predicate-hierarchy"><b>意味上の上位関係</b><small v-for="(path, index) in predicateHierarchyItem(item.predicateId)?.paths" :key="index">{{ path.labels.join(' → ') }}</small></span><span v-if="predicateHierarchyItem(item.predicateId)?.diagnostics.length" class="predicate-hierarchy warning"><small v-for="diagnostic in predicateHierarchyItem(item.predicateId)?.diagnostics" :key="diagnostic.code">関係階層の設定を管理者に確認してください。</small></span><small v-if="predicateHierarchyItem(item.predicateId)?.truncated">上位関係が多いため一部だけを表示しています。</small></button></div>
        <aside class="predicate-policy" aria-label="関係の検索と検証"><strong>この関係の扱い</strong><span>{{ predicateHierarchy.queryExplanation }}</span><span>{{ predicateHierarchy.validationExplanation }}</span></aside>
        <p v-if="filteredPredicates.length === 0" role="status">条件に合う関係がありません。</p>
        <details class="row-overrides"><summary>接続先ごとに関係を変える</summary><article v-for="target in directDraft.targets" :key="`row-${selectionKey(target)}`"><h3>{{ canvasLabel(target) }}</h3><p>現在: {{ selectedPredicateLabel(directDraft.rowPredicateIds[selectionKey(target)] ?? directDraft.predicateId) }}</p><div class="compact-options"><button type="button" :disabled="locked" @click="dispatch({ type: 'set-row-predicate', target, predicateId: undefined })">共通設定を使う</button><button v-for="item in filteredPredicates" :key="`${selectionKey(target)}:${item.predicateId}`" type="button" :aria-pressed="directDraft.rowPredicateIds[selectionKey(target)] === item.predicateId" :disabled="locked" @click="dispatch({ type: 'set-row-predicate', target, predicateId: item.predicateId })">{{ item.label }}</button></div></article></details>
      </div>

      <div v-else-if="state.phase === 'membership-group' && membershipDraft" class="step-body">
        <p>既存のGroup FrameをCanvasから一つ選びます。</p>
        <div v-if="membershipDraft.group" class="canvas-chip"><span class="shape-mini group" aria-hidden="true"></span><strong>{{ canvasLabel(membershipDraft.group) }}</strong><small>所属先</small></div>
        <p v-else class="selection-wait" role="status">Canvasで所属先を選択してください。</p>
        <button type="button" :disabled="locked" @click="requestCanvasSelection({ role: 'membership-group', multiple: false, acceptedKinds: ['group'] })">Canvasからグループを選ぶ</button>
      </div>

      <div v-else-if="state.phase === 'membership-members' && membershipDraft" class="step-body">
        <p>所属させる要素を選びます。既存要素と新しい要素を混在できます。</p>
        <div class="chip-list" aria-live="polite"><div v-for="member in membershipDraft.members" :key="memberKey(member)" class="canvas-chip"><span class="shape-mini node" aria-hidden="true"></span><strong>{{ memberLabel(member) }}</strong><small>{{ member.kind === 'new-node' ? '新規' : '既存' }}</small><button type="button" :aria-label="`${memberLabel(member)}を外す`" :disabled="locked" @click="dispatch({ type: 'remove-member', memberKey: memberKey(member) })">×</button></div></div>
        <button type="button" :disabled="locked" @click="requestCanvasSelection({ role: 'membership-members', multiple: true, acceptedKinds: ['node'] })">Canvasから要素を選ぶ</button>
        <details class="inline-create"><summary>新しい要素も追加</summary><label><span>新しい要素の名前</span><input v-model="inlineLabel" :disabled="locked" /></label><div class="compact-options" role="group" aria-label="新しい要素の種類"><button v-for="role in presentation.profile.nodeRoles" :key="`inline-${role.roleId}`" type="button" :aria-pressed="inlineRoleIds.includes(role.roleId)" :disabled="locked" @click="toggleInlineRole(role.roleId)">{{ role.label }}</button></div><button type="button" :disabled="locked || !inlineLabel.trim() || (!presentation.profile.allowUntypedNodes && inlineRoleIds.length === 0)" @click="addInlineMember">一覧へ追加</button></details>
      </div>

      <div v-else-if="state.phase === 'sequence-order' && membershipDraft" class="step-body">
        <p>ドラッグまたは上下ボタンで順番を決めます。</p>
        <ol class="ordered-members"><li v-for="(member, index) in membershipDraft.members" :key="memberKey(member)" draggable="true" @dragstart="draggedMemberKey = memberKey(member)" @dragover.prevent @drop="reorderMember(memberKey(member))"><span>{{ index + 1 }}</span><strong>{{ memberLabel(member) }}</strong><button type="button" :disabled="locked || index === 0" :aria-label="`${memberLabel(member)}を上へ`" @click="dispatch({ type: 'move-member', memberKey: memberKey(member), direction: 'up' })">↑</button><button type="button" :disabled="locked || index === membershipDraft.members.length - 1" :aria-label="`${memberLabel(member)}を下へ`" @click="dispatch({ type: 'move-member', memberKey: memberKey(member), direction: 'down' })">↓</button></li></ol>
      </div>

      <div v-else-if="state.phase === 'alternative-default' && membershipDraft" class="step-body">
        <p>候補は二つ以上必要です。既定にした候補は先頭へ移動します。</p>
        <div class="alternative-list" role="group" aria-label="既定候補"><button v-for="member in membershipDraft.members" :key="memberKey(member)" type="button" :aria-pressed="membershipDraft.defaultMemberKey === memberKey(member)" :disabled="locked" @click="dispatch({ type: 'set-alternative-default', memberKey: memberKey(member) })"><span class="radio-mark" aria-hidden="true"></span><strong>{{ memberLabel(member) }}</strong><small v-if="membershipDraft.defaultMemberKey === memberKey(member)">既定候補</small></button></div>
      </div>

      <div v-else-if="state.phase === 'edit-element-select' && editElementDraft" class="step-body"><p>変更する要素またはグループをCanvasから一つ選びます。</p><button type="button" :disabled="locked" @click="requestCanvasSelection({ role: 'edit-element', multiple: false, acceptedKinds: ['node', 'group'] })">Canvasから要素を選ぶ</button></div>
      <div v-else-if="state.phase === 'edit-element-action' && editElementDraft" class="step-body"><div class="canvas-chip"><span class="shape-mini" :class="canvasShape(editElementDraft.target)" aria-hidden="true"></span><strong>{{ canvasLabel(editElementDraft.target) }}</strong></div><div class="action-list"><button type="button" :disabled="locked" @click="dispatch({ type: 'choose-edit-element-action', action: 'details' })">名前・説明・種類を変更</button><button type="button" class="danger" :disabled="locked" @click="dispatch({ type: 'choose-edit-element-action', action: 'delete' })">要素を削除</button></div></div>

      <div v-else-if="state.phase === 'edit-relation-select' && editRelationDraft" class="step-body"><p>変更する要素、関係、またはグループをCanvasから一つ選びます。</p><button type="button" :disabled="locked" @click="requestCanvasSelection({ role: 'edit-relation', multiple: false, acceptedKinds: ['node', 'group', 'direct-edge'] })">Canvasから対象を選ぶ</button></div>
      <div v-else-if="state.phase === 'edit-relation-action' && editRelationDraft" class="step-body"><div v-if="editRelationDraft.target" class="canvas-chip"><span class="shape-mini" :class="canvasShape(editRelationDraft.target.selection)" aria-hidden="true"></span><strong>{{ canvasLabel(editRelationDraft.target.selection) }}</strong></div><div class="action-list"><button v-if="editRelationDraft.target?.kind === 'direct-edge'" type="button" :disabled="locked" @click="dispatch({ type: 'choose-edit-relation-action', action: 'meaning' })">関係の意味を変更</button><button v-if="editRelationDraft.target?.kind === 'direct-edge'" type="button" :disabled="locked" @click="dispatch({ type: 'choose-edit-relation-action', action: 'reconnect' })">接続先を変更</button><button v-if="editRelationDraft.target?.kind !== 'direct-edge'" type="button" :disabled="locked" @click="dispatch({ type: 'choose-edit-relation-action', action: 'membership' })">所属・順序・候補を変更</button><button v-if="editRelationDraft.target?.kind === 'direct-edge'" type="button" class="danger" :disabled="locked" @click="dispatch({ type: 'choose-edit-relation-action', action: 'delete' })">関係を削除</button></div></div>

      <div v-else-if="state.phase === 'ready'" class="ready-card" role="status"><p>{{ readyRequest ? '変更を送信しました。' : '選んだ編集画面へ移動します。' }}</p></div>
      <div v-else-if="state.phase === 'submitting'" class="busy-card" role="status"><span aria-hidden="true"></span><p>変更を検証して反映しています。</p></div>
      <div v-else-if="state.phase === 'error'" class="error-list" role="alert"><article v-for="(card, index) in errorCards" :key="index"><strong>{{ card.title }}</strong><p>{{ card.action }}</p></article><button v-if="readyRequest" type="button" :disabled="locked" @click="submit">同じ内容で再試行</button><button type="button" @click="dispatch({ type: 'back' })">入力を修正する</button></div>

      <p v-if="lockReason" class="blocked" role="status">{{ lockReason }}</p>
      <p v-else-if="showNext && !stepStatus.canContinue" class="validation-hint" role="status">{{ stepStatus.reason }}</p>

      <footer v-if="state.phase !== 'submitting' && state.phase !== 'error' && state.phase !== 'ready'" class="wizard-footer">
        <button type="button" :disabled="busy" @click="dispatch({ type: 'back' })">戻る</button>
        <button type="button" :disabled="busy" @click="dispatch({ type: 'cancel' })">キャンセル</button>
        <button v-if="showNext" type="button" class="primary" :disabled="locked || !stepStatus.canContinue" @click="dispatch({ type: 'next' })">次へ</button>
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
