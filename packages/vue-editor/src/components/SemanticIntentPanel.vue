<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";

import {
  statementIdentityForNamedStatement,
  type AuthoringCommand,
  type SemanticEditCapability,
} from "@iriograph/core";

import {
  emptyAuthoringDraft,
  type AuthoringChoice,
  type AuthoringPreviewView,
  type EditorAuthoringDraft,
} from "../authoring-draft";
import { diagnosticGuidance } from "../diagnostic-guidance";

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

const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const RDFS_LABEL = "http://www.w3.org/2000/01/rdf-schema#label";
const RDFS_COMMENT = "http://www.w3.org/2000/01/rdf-schema#comment";

const props = withDefaults(defineProps<{
  enabled?: boolean;
  blockedReason?: string;
  busy?: boolean;
  resources?: AuthoringChoice[];
  selectedResources?: AuthoringChoice[];
  selectedEdge?: IntentEdgeDetails;
  elementDetails?: IntentElementDetails;
  classes?: AuthoringChoice[];
  predicates?: AuthoringChoice[];
  memberships?: IntentMembershipOption[];
  sequences?: IntentSequenceOption[];
  pickedSourceIri?: string;
  pickedTargetIri?: string;
  preview?: AuthoringPreviewView;
}>(), {
  enabled: true,
  blockedReason: "",
  busy: false,
  resources: () => [],
  selectedResources: () => [],
  selectedEdge: undefined,
  elementDetails: undefined,
  classes: () => [],
  predicates: () => [],
  memberships: () => [],
  sequences: () => [],
  pickedSourceIri: "",
  pickedTargetIri: "",
  preview: undefined,
});

const emit = defineEmits<{
  previewDraft: [draft: EditorAuthoringDraft, label: string];
  previewCommands: [commands: AuthoringCommand[], label: string, resources: Array<{ iri: string; label: string; role: string }>];
  apply: [];
  cancel: [];
  pickResource: [field: "sourceIri" | "targetIri"];
  intentChange: [intent: SemanticIntent | undefined];
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
const membershipActions = ref<Record<string, "keep" | "add" | "remove">>({});
const sequenceIri = ref("");
const sequenceMemberIris = ref<string[]>([]);
const panelRoot = ref<HTMLElement>();

const relationSelection = computed(() => ({
  source: props.selectedResources[0],
  targets: props.selectedResources.slice(1),
}));
const relationReady = computed(() => Boolean(
  relationSelection.value.source
  && relationSelection.value.targets.length
  && predicateIri.value,
));
const selectedPredicateLabel = computed(() => props.predicates.find(
  (choice) => choice.iri === predicateIri.value,
)?.label ?? "関係");

watch(() => props.preview, (next, previous) => {
  if (!next && previous) reset();
});

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
  sourceIri.value = edge.sourceIri;
  targetIri.value = edge.targetIri;
  statementCommentValues.value = cloneTextValues(edge.statementComments ?? []);
});
watch([() => props.sequences, intent], ([sequences, currentIntent]) => {
  if (currentIntent !== "edit-relation") return;
  if (!sequences.some((option) => option.sequenceIri === sequenceIri.value)) {
    sequenceIri.value = sequences.length === 1 ? sequences[0]!.sequenceIri : "";
  }
  syncSequenceMembers();
}, { deep: true });
watch(() => props.pickedSourceIri, (value) => {
  if (value) sourceIri.value = value;
});
watch(() => props.pickedTargetIri, (value) => {
  if (value) targetIri.value = value;
});

function choose(next: SemanticIntent): void {
  intent.value = next;
  emit("intentChange", next);
  if (next === "add-element") label.value = "";
  if (next === "add-relation") predicateIri.value = props.predicates.length === 1 ? props.predicates[0]?.iri ?? "" : "";
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
  sourceIri.value = "";
  targetIri.value = "";
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
  emit("previewDraft", draft, "要素を追加");
}

function previewRelationCreation(): void {
  const source = relationSelection.value.source;
  if (!source || !relationReady.value) return;
  const draft = emptyAuthoringDraft("connect-resources", source.iri);
  draft.sourceIri = source.iri;
  draft.targetIri = relationSelection.value.targets[0]?.iri ?? "";
  draft.targetIris = relationSelection.value.targets.slice(1).map((target) => target.iri);
  draft.predicateIri = predicateIri.value;
  emit("previewDraft", draft, `${source.label ?? "基準要素"}から関係を追加`);
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
  emit("previewCommands", commands, `${details.label}を編集`, [{ iri: details.iri, label: details.label, role: "対象" }]);
}

function previewElementDelete(): void {
  const details = props.elementDetails;
  if (!details) return;
  emit("previewCommands", [{
    type: "delete-resource",
    commandId: "intent-delete-resource",
    resourceIri: details.iri,
    // The standard UI's delete action is itself the explicit cascade flow:
    // every affected statement is shown in Preview before Apply is enabled.
    cascade: true,
  }], `${details.label}を削除`, [{ iri: details.iri, label: details.label, role: "削除対象" }]);
}

function previewEdgeEdit(): void {
  const edge = props.selectedEdge;
  const capability = edge?.capability;
  if (!edge || capability?.command !== "remove-statement") return;
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
  emit("previewCommands", commands, `${edge.label}を変更`, [
    { iri: sourceIri.value, label: resourceLabel(sourceIri.value), role: "始点" },
    { iri: targetIri.value, label: resourceLabel(targetIri.value), role: "終点" },
  ]);
}

function previewEdgeDelete(): void {
  const edge = props.selectedEdge;
  const capability = edge?.capability;
  if (!edge || capability?.command !== "remove-statement") return;
  emit("previewCommands", [{
    type: "remove-statement",
    commandId: "intent-remove-edge",
    statementRef: capability.statementRef,
    subjectIri: capability.subject,
    predicateIri: capability.predicate,
    objectIri: capability.object,
  }], `${edge.label}を削除`, [
    { iri: edge.sourceIri, label: edge.sourceLabel, role: "始点" },
    { iri: edge.targetIri, label: edge.targetLabel, role: "終点" },
  ]);
}

function previewMemberships(): void {
  const selected = props.selectedResources;
  const commands: AuthoringCommand[] = [];
  for (const option of props.memberships) {
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
  emit("previewCommands", commands, "所属領域をまとめて変更", selected.map((item) => ({
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
  emit("previewCommands", [{
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
</script>

<template>
  <section ref="panelRoot" class="iriograph-intent-panel" aria-label="意味グラフを編集" tabindex="-1">
    <p v-if="blockedReason" class="iriograph-authoring-blocked">{{ blockedReason }}</p>
    <template v-if="!intent && !preview">
      <header><small>SEMANTIC INTENT</small><strong>何をしますか？</strong></header>
      <nav class="iriograph-intent-grid" aria-label="意味編集の4つの操作">
        <button type="button" :disabled="!enabled || busy" @click="choose('add-element')"><b>＋</b><span>新しい要素を作る</span></button>
        <button type="button" :disabled="!enabled || busy" @click="choose('add-relation')"><b>→</b><span>関係を作る</span></button>
        <button type="button" :disabled="!enabled || busy" @click="choose('edit-element')"><b>✎</b><span>要素を変更する</span></button>
        <button type="button" :disabled="!enabled || busy" @click="choose('edit-relation')"><b>⌘</b><span>関係を変更する</span></button>
      </nav>
    </template>

    <template v-else-if="!preview">
      <header><button type="button" aria-label="4つの操作へ戻る" @click="cancel">←</button><strong>{{ intent === 'add-element' ? '新しい要素を作る' : intent === 'add-relation' ? '関係を作る' : intent === 'edit-element' ? '要素を変更する' : '関係を変更する' }}</strong></header>

      <section v-if="intent === 'add-element'" class="iriograph-intent-fields">
        <p>名前を入力します。識別子は自動で安全に採番されます。</p>
        <label><span>名前</span><textarea v-model="label" aria-label="新しい要素の名前" rows="2" /></label>
        <button type="button" class="primary" :disabled="!label.trim() || busy" @click="previewElementCreation">変更内容を確認</button>
      </section>

      <section v-else-if="intent === 'add-relation'" class="iriograph-intent-fields">
        <p>Canvasで基準要素を最初に選び、Ctrl/CmdまたはShiftを押しながら相手を追加します。</p>
        <div class="iriograph-intent-selection"><b>基準</b><span>{{ relationSelection.source?.label ?? '未選択' }}</span><b>相手</b><span>{{ relationSelection.targets.map((item) => item.label).join('、') || '未選択' }}</span></div>
        <fieldset class="iriograph-predicate-cards"><legend>関係の種類</legend><label v-for="choice in predicates" :key="choice.iri" :class="{ selected: predicateIri === choice.iri }"><input v-model="predicateIri" type="radio" :value="choice.iri" /><strong>{{ choice.label ?? '関係' }}</strong><span v-for="target in relationSelection.targets" :key="target.iri">{{ relationSelection.source?.label ?? 'A' }}（{{ choice.label ?? '関係' }}）{{ target.label ?? 'B' }}</span><small v-if="choice.description">{{ choice.description }}</small></label></fieldset>
        <p v-if="predicateIri">{{ relationSelection.targets.length }}本の「{{ selectedPredicateLabel }}」を作成します。</p>
        <button type="button" class="primary" :disabled="!relationReady || busy" @click="previewRelationCreation">変更内容を確認</button>
      </section>

      <section v-else-if="intent === 'edit-element'" class="iriograph-intent-fields">
        <p v-if="!elementDetails">Canvasから編集する要素を1つ選択してください。</p>
        <template v-else>
          <label><span>名前</span><textarea v-model="label" aria-label="要素の名前" rows="2" /></label>
          <fieldset><legend>別名</legend><label v-for="(item, index) in labelValues.slice(1)" :key="index"><span>{{ item.language ? `別名（${item.language}）` : '別名' }}</span><textarea v-model="item.value" :aria-label="`要素の別名 ${index + 1}`" rows="2" /><button type="button" :aria-label="`要素の別名 ${index + 1}を削除`" @click="removeAlias(index + 1)">この別名を削除</button></label><button type="button" @click="addAlias">別名を追加</button></fieldset>
          <fieldset><legend>説明</legend><label v-for="(item, index) in commentValues" :key="index"><span>{{ item.language ? `説明（${item.language}）` : '説明' }}</span><textarea v-model="item.value" :aria-label="`要素の説明 ${index + 1}`" rows="3" /><button type="button" :aria-label="`要素の説明 ${index + 1}を削除`" @click="removeComment(index)">この説明を削除</button></label><button type="button" @click="addComment">説明を追加</button></fieldset>
          <fieldset><legend>種類</legend><label v-for="choice in classes" :key="choice.iri"><input v-model="classIris" type="checkbox" :value="choice.iri" />{{ choice.label ?? '種類' }}</label></fieldset>
          <button type="button" class="primary" :disabled="!label.trim() || busy" @click="previewElementEdit">変更内容を確認</button>
          <details class="iriograph-danger-zone"><summary>要素を削除</summary><p>この要素を始点・終点・所属先として使う関係も、確認画面にまとめて表示して削除します。</p><button type="button" :disabled="busy" @click="previewElementDelete">要素と関係の削除内容を確認</button></details>
        </template>
      </section>

      <section v-else class="iriograph-intent-fields">
        <template v-if="selectedEdge">
          <p v-if="selectedEdge.derivedReason" class="iriograph-authoring-blocked">{{ selectedEdge.derivedReason }}</p>
          <template v-else>
            <div class="iriograph-intent-selection"><b>始点</b><span>{{ resourceLabel(sourceIri) }}</span><b>終点</b><span>{{ resourceLabel(targetIri) }}</span></div>
            <button type="button" :disabled="!enabled || busy" @click="emit('pickResource', 'sourceIri')">始点をCanvasから選択</button>
            <button type="button" :disabled="!enabled || busy" @click="emit('pickResource', 'targetIri')">終点をCanvasから選択</button>
            <label><span>関係</span><select v-model="predicateIri"><option v-for="choice in predicates" :key="choice.iri" :value="choice.iri">{{ resourceLabel(sourceIri) }}（{{ choice.label ?? '関係' }}）{{ resourceLabel(targetIri) }}</option></select></label>
            <fieldset><legend>この関係だけの説明</legend><p>この矢印だけの意味としてTurtleへ保存され、LLMにも渡されます。</p><label v-for="(item, index) in statementCommentValues" :key="index"><span>{{ item.language ? `説明（${item.language}）` : '説明' }}</span><textarea v-model="item.value" :aria-label="`この関係だけの説明 ${index + 1}`" rows="3" /><button type="button" :aria-label="`この関係だけの説明 ${index + 1}を削除`" @click="removeStatementComment(index)">この説明を削除</button></label><button type="button" @click="addStatementComment">説明を追加</button></fieldset>
            <button type="button" class="primary" :disabled="!sourceIri || !targetIri || !predicateIri || busy" @click="previewEdgeEdit">変更内容を確認</button>
            <button type="button" :disabled="busy" @click="previewEdgeDelete">この関係を削除</button>
          </template>
        </template>
        <template v-else>
          <p v-if="selectedResources.length === 0">Canvasで要素を選び、並び順または包含を変更します。</p>
          <template v-else>
            <section v-if="sequences.length" class="iriograph-sequence-editor" aria-label="並び順を編集">
              <label v-if="sequences.length > 1"><span>編集する並び順</span><select v-model="sequenceIri" @change="syncSequenceMembers"><option value="">選択してください</option><option v-for="option in sequences" :key="option.sequenceIri" :value="option.sequenceIri">{{ option.label }}</option></select></label>
              <template v-if="selectedSequence()">
                <strong>{{ selectedSequence()!.label }}</strong>
                <p>番号付きの枠内要素を並べ替えます。通常の関係線とは別の構造です。</p>
                <ol><li v-for="(memberIri, index) in sequenceMemberIris" :key="`${memberIri}:${index}`"><b>{{ index + 1 }}</b><span>{{ sequenceMemberLabel(memberIri) }}</span><button type="button" :disabled="index === 0" :aria-label="`${sequenceMemberLabel(memberIri)}を前へ`" @click="moveSequenceMember(index, -1)">↑</button><button type="button" :disabled="index === sequenceMemberIris.length - 1" :aria-label="`${sequenceMemberLabel(memberIri)}を後ろへ`" @click="moveSequenceMember(index, 1)">↓</button><button type="button" :aria-label="`${sequenceMemberLabel(memberIri)}を並び順から外す`" @click="removeSequenceMember(index)">除外</button></li></ol>
                <button v-if="sequenceCandidates().length" type="button" @click="addSelectedSequenceMembers">Canvasで選択した {{ sequenceCandidates().length }}件を末尾へ追加</button>
                <button type="button" class="primary" :disabled="sequenceMemberIris.length === 0 || busy" @click="previewSequence">並び順の変更を確認</button>
              </template>
            </section>
            <section v-if="memberships.length" class="iriograph-membership-editor" aria-label="所属領域を編集">
              <p>選択した要素の所属先・包含対象だけを変更します。</p>
              <label v-for="option in memberships" :key="option.containerIri"><span>{{ option.label }}（{{ membershipState(option) }}）</span><select v-model="membershipActions[option.containerIri]"><option value="keep">変更しない</option><option value="add">選択中をすべて追加</option><option value="remove">選択中をすべて解除</option></select></label>
              <button type="button" class="primary" :disabled="!Object.values(membershipActions).some((value) => value !== 'keep') || busy" @click="previewMemberships">変更内容を確認</button>
            </section>
            <p v-if="!sequences.length && !memberships.length">この選択に変更できる並び順・包含はありません。</p>
          </template>
        </template>
      </section>
    </template>

    <section v-else class="iriograph-authoring-preview">
      <div><b>{{ preview.operationLabel }}</b><span>{{ preview.valid ? '適用可能' : '適用不可' }}</span></div>
      <div class="iriograph-preview-summary"><span class="iriograph-preview-count add">追加 {{ preview.addedStatements.length }}件</span><span class="iriograph-preview-count remove">削除 {{ preview.removedStatements.length }}件</span></div>
      <div v-if="preview.resourceChips.length" class="iriograph-preview-resources"><span v-for="chip in preview.resourceChips" :key="`${chip.role}:${chip.iri}`" class="iriograph-resource-chip"><small>{{ chip.role }}</small>{{ chip.label }}</span></div>
      <ul v-if="preview.relations.length" class="iriograph-preview-relations" aria-label="変更される関係"><li v-for="(relation, index) in preview.relations" :key="`${relation.action}:${relation.kind}:${relation.label}:${index}`" :class="relation.action"><span>{{ relation.action === 'remove' ? '削除' : '追加' }}</span><b>{{ relation.label }}</b></li></ul>
      <ul v-if="preview.diagnostics.length"><li v-for="(item, index) in preview.diagnostics" :key="`${item.code}:${index}`" :class="item.severity"><b>{{ diagnosticGuidance(item).title }}</b><span>{{ diagnosticGuidance(item).action }}</span></li></ul>
      <details><summary>追加・削除される関係</summary><h5>削除</h5><pre>{{ preview.removedStatements.join('\n') }}</pre><h5>追加</h5><pre>{{ preview.addedStatements.join('\n') }}</pre></details>
      <footer><button type="button" @click="cancel">キャンセル</button><button type="button" class="primary" :disabled="busy || !preview.valid" @click="emit('apply')">明示的に適用</button></footer>
    </section>
  </section>
</template>
