<script setup lang="ts">
import { computed, useId } from "vue";
import type { ProjectionDiagnostic } from "@iriograph/core";

import type {
  AuthoringCapabilityChoice,
  AuthoringChoice,
  AuthoringPreviewView,
  AuthoringResourcePickerTarget,
  AuthoringStructureChoice,
  EditorAuthoringDraft,
  EditorAuthoringKind,
  EditorCapabilityBindingDraft,
  EditorPropertyValueDraft,
} from "../authoring-draft";
import {
  capabilityBindingsFor,
  emptyAuthoringDraft,
  emptyPropertyValueDraft,
  splitIriLines,
} from "../authoring-draft";
import IriChoiceField from "./IriChoiceField.vue";

const props = withDefaults(defineProps<{
  modelValue: EditorAuthoringDraft;
  enabled?: boolean;
  blockedReason?: string;
  busy?: boolean;
  classes?: AuthoringChoice[];
  properties?: AuthoringChoice[];
  edgePredicates?: AuthoringChoice[];
  resources?: AuthoringChoice[];
  capabilities?: AuthoringCapabilityChoice[];
  structures?: AuthoringStructureChoice[];
  selectedResource?: AuthoringChoice;
  preview?: AuthoringPreviewView;
  diagnostics?: ProjectionDiagnostic[];
  pickerTarget?: AuthoringResourcePickerTarget;
}>(), {
  enabled: true,
  blockedReason: "",
  busy: false,
  classes: () => [],
  properties: () => [],
  edgePredicates: () => [],
  resources: () => [],
  capabilities: () => [],
  structures: () => [],
  selectedResource: undefined,
  preview: undefined,
  diagnostics: () => [],
  pickerTarget: undefined,
});

const instanceId = useId();
const resourceListId = `${instanceId}-authoring-resources`;

const emit = defineEmits<{
  "update:modelValue": [draft: EditorAuthoringDraft];
  preview: [];
  apply: [];
  cancel: [];
  pickPosition: [];
  pickResource: [target: AuthoringResourcePickerTarget];
  seedSelection: [target: "edge-source" | "edge-target" | "membership-container" | "membership-member"];
  openDetails: [];
  openPalette: [];
}>();

const kinds: Array<{ value: EditorAuthoringKind; label: string }> = [
  { value: "create-resource", label: "要素を作成" },
  { value: "set-property", label: "属性を設定" },
  { value: "connect-resources", label: "関係を作成" },
  { value: "set-membership", label: "包含を設定" },
  { value: "set-sequence", label: "並び順を編集" },
  { value: "set-alternatives", label: "分岐を編集" },
  { value: "delete-resource", label: "要素を削除" },
  { value: "apply-capability", label: "定義済み操作" },
];

const selectedCapability = computed(() => props.capabilities.find(
  (item) => item.iri === props.modelValue.capabilityId,
));
const relevantStructures = computed(() => props.structures.filter((item) => (
  (props.modelValue.kind === "set-membership" && item.kind === "membership")
  || (props.modelValue.kind === "set-sequence" && item.kind === "sequence")
  || (props.modelValue.kind === "set-alternatives" && item.kind === "alternatives")
)));
const membershipStructures = computed(() => props.structures.filter((item) => item.kind === "membership"));

function update<K extends keyof EditorAuthoringDraft>(
  key: K,
  value: EditorAuthoringDraft[K],
): void {
  emit("update:modelValue", { ...props.modelValue, [key]: value });
}

function inputValue(event: Event): string {
  return (event.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).value;
}

function changeKind(event: Event): void {
  emit("update:modelValue", emptyAuthoringDraft(inputValue(event) as EditorAuthoringKind));
}

function selectQuickKind(kind: EditorAuthoringKind): void {
  const draft = emptyAuthoringDraft(kind, props.selectedResource?.iri ?? "");
  if (kind === "connect-resources" && props.edgePredicates.length === 1) {
    draft.predicateIri = props.edgePredicates[0]?.iri ?? "";
  }
  emit("update:modelValue", draft);
}

function selectCapabilityAction(capability: AuthoringCapabilityChoice): void {
  emit("update:modelValue", {
    ...emptyAuthoringDraft("apply-capability"),
    capabilityId: capability.iri,
    capabilityBindings: capabilityBindingsFor(capability),
  });
}

function updatePropertyValue<K extends keyof EditorPropertyValueDraft>(
  index: number,
  key: K,
  value: EditorPropertyValueDraft[K],
): void {
  const values = props.modelValue.propertyValues.map((item, candidate) => (
    candidate === index ? { ...item, [key]: value } : item
  ));
  update("propertyValues", values);
}

function addPropertyValue(): void {
  update("propertyValues", [...props.modelValue.propertyValues, emptyPropertyValueDraft()]);
}

function removePropertyValue(index: number): void {
  const values = props.modelValue.propertyValues.filter((_, candidate) => candidate !== index);
  update("propertyValues", values.length ? values : [emptyPropertyValueDraft()]);
}

function selectStructure(event: Event): void {
  const key = inputValue(event);
  const selected = relevantStructures.value.find((item) => item.key === key);
  if (!selected) {
    emit("update:modelValue", {
      ...props.modelValue,
      structureConfigKey: "",
      containerTypeIri: "",
      membershipPredicateIri: "",
      sequenceTypeIri: "",
      alternativeTypeIri: "",
      ordinalPredicatePrefix: "",
      defaultOrdinal: "",
    });
    return;
  }
  emit("update:modelValue", {
    ...props.modelValue,
    structureConfigKey: selected.key,
    containerTypeIri: selected.kind === "membership" ? selected.typeIri : "",
    membershipPredicateIri: selected.predicateIri ?? "",
    sequenceTypeIri: selected.kind === "sequence" ? selected.typeIri : "",
    alternativeTypeIri: selected.kind === "alternatives" ? selected.typeIri : "",
    ordinalPredicatePrefix: selected.ordinalPredicatePrefix ?? "",
    defaultOrdinal: selected.defaultOrdinal === undefined ? "" : String(selected.defaultOrdinal),
    defaultMemberIri: selected.kind === "alternatives"
      ? memberAtOrdinal(props.modelValue.membersText, selected.defaultOrdinal ?? 1)
      : props.modelValue.defaultMemberIri,
  });
}

function selectCreateMembershipStructure(event: Event): void {
  const key = inputValue(event);
  const selected = membershipStructures.value.find((item) => item.key === key);
  emit("update:modelValue", {
    ...props.modelValue,
    createMembershipStructureConfigKey: selected?.key ?? "",
    createMembershipContainerTypeIri: selected?.typeIri ?? "",
    createMembershipPredicateIri: selected?.predicateIri ?? "",
  });
}

function requestResource(target: AuthoringResourcePickerTarget): void {
  emit("pickResource", target);
}

function isPicking(target: AuthoringResourcePickerTarget): boolean {
  return JSON.stringify(props.pickerTarget) === JSON.stringify(target);
}

function updateMembers(value: string): void {
  const ordinal = Number(props.modelValue.defaultOrdinal);
  emit("update:modelValue", {
    ...props.modelValue,
    membersText: value,
    ...(props.modelValue.kind === "set-alternatives"
      ? { defaultMemberIri: memberAtOrdinal(value, ordinal) }
      : {}),
  });
}

function memberAtOrdinal(source: string, ordinal: number): string {
  return Number.isSafeInteger(ordinal) && ordinal > 0 ? splitIriLines(source)[ordinal - 1] ?? "" : "";
}

function changeCapability(event: Event): void {
  const capabilityId = inputValue(event);
  const capability = props.capabilities.find((item) => item.iri === capabilityId);
  emit("update:modelValue", {
    ...props.modelValue,
    capabilityId,
    capabilityBindings: capabilityBindingsFor(capability),
  });
}

function updateCapabilityBinding<K extends keyof EditorCapabilityBindingDraft>(
  name: string,
  key: K,
  value: EditorCapabilityBindingDraft[K],
): void {
  const current = props.modelValue.capabilityBindings[name] ?? {
    ...emptyPropertyValueDraft(),
    enabled: false,
  };
  update("capabilityBindings", {
    ...props.modelValue.capabilityBindings,
    [name]: { ...current, [key]: value },
  });
}

function requestPosition(): void {
  update("positionPicking", true);
  emit("pickPosition");
}
</script>

<template>
  <section class="iriograph-authoring-panel" aria-label="Semantic authoring">
    <header>
      <div><small>SEMANTIC AUTHORING</small><strong>意味グラフ</strong></div>
      <span>確認 → 適用</span>
    </header>
    <p v-if="blockedReason" class="iriograph-authoring-blocked">{{ blockedReason }}</p>
    <ul v-if="!preview && diagnostics.length" class="iriograph-authoring-diagnostics">
      <li v-for="(item, index) in diagnostics" :key="`${item.code}:${index}`" :class="item.severity"><b>{{ item.code }}</b> {{ item.message }}</li>
    </ul>
    <datalist :id="resourceListId"><option v-for="item in resources" :key="item.iri" :value="item.iri">{{ item.label }}</option></datalist>
    <nav class="iriograph-authoring-quick-actions" aria-label="意味グラフの操作">
      <button type="button" :disabled="!enabled || busy" @click="emit('openPalette')">新しい要素</button>
      <button v-if="selectedResource" type="button" :disabled="!enabled || busy" @click="emit('openDetails')">詳細・属性</button>
      <button v-if="selectedResource" type="button" :disabled="!enabled || busy" @click="selectQuickKind('connect-resources')">関係を作成</button>
      <button v-if="selectedResource" type="button" :disabled="!enabled || busy" @click="selectQuickKind('set-membership')">領域・包含</button>
      <button v-if="selectedResource && structures.some((item) => item.kind === 'sequence')" type="button" :disabled="!enabled || busy" @click="selectQuickKind('set-sequence')">並び順を編集</button>
      <button v-if="selectedResource && structures.some((item) => item.kind === 'alternatives')" type="button" :disabled="!enabled || busy" @click="selectQuickKind('set-alternatives')">分岐を編集</button>
      <button v-for="capability in capabilities" :key="capability.iri" type="button" :title="capability.iri" :disabled="!enabled || busy" @click="selectCapabilityAction(capability)">{{ capability.label ?? '追加アクション' }}</button>
    </nav>
    <details class="iriograph-authoring-advanced">
      <summary>Advanced: 操作種別を選択</summary>
      <label>
        <span>操作</span>
        <select aria-label="Semantic operation" :value="modelValue.kind" :disabled="!enabled || busy" @change="changeKind">
          <option v-if="modelValue.kind === 'remove-statement'" value="remove-statement">関係を削除</option>
          <option v-for="kind in kinds" :key="kind.value" :value="kind.value">{{ kind.label }}</option>
        </select>
      </label>
    </details>

    <template v-if="modelValue.kind === 'create-resource'">
      <label><span>名前</span><input aria-label="Resource label" :value="modelValue.label" :disabled="!enabled || busy" @input="update('label', inputValue($event))" /></label>
      <details class="iriograph-authoring-advanced">
        <summary>Advanced: Class / Resource IRI</summary>
        <IriChoiceField
          label="Class"
          input-label="Resource class"
          :model-value="modelValue.classIri"
          :choices="classes"
          :enabled="enabled && !busy"
          @update:model-value="update('classIri', $event)"
        />
        <span>要素の IRI（空欄で採番）</span>
        <input aria-label="Resource IRI" :value="modelValue.resourceIri" :disabled="!enabled || busy" @input="update('resourceIri', inputValue($event))" />
      </details>
      <button type="button" class="iriograph-wide-button" :aria-pressed="modelValue.positionPicking" :disabled="!enabled || busy" @click="requestPosition">
        {{ modelValue.positionPicking ? "図の配置位置をクリック…" : "図の上で位置を指定" }}
      </button>
      <div class="iriograph-authoring-position">
        <label><span>x</span><input aria-label="Initial x" type="number" :value="modelValue.initialX" :disabled="!enabled || busy" @input="update('initialX', inputValue($event))" /></label>
        <label><span>y</span><input aria-label="Initial y" type="number" :value="modelValue.initialY" :disabled="!enabled || busy" @input="update('initialY', inputValue($event))" /></label>
      </div>
      <fieldset class="iriograph-authoring-value-row">
        <legend>関係も同時に作る（任意）</legend>
        <label class="iriograph-authoring-check"><input aria-label="Create edge enabled" type="checkbox" :checked="modelValue.createEdgeEnabled" :disabled="!enabled || busy" @change="update('createEdgeEnabled', ($event.target as HTMLInputElement).checked)" /><span>既存要素とつなぐ</span></label>
        <template v-if="modelValue.createEdgeEnabled">
          <label><span>向き</span><select aria-label="Create edge direction" :value="modelValue.createEdgeDirection" :disabled="!enabled || busy" @change="update('createEdgeDirection', inputValue($event) as 'outgoing' | 'incoming')"><option value="outgoing">新しい要素 → 相手</option><option value="incoming">相手 → 新しい要素</option></select></label>
          <IriChoiceField label="関係" input-label="Create edge predicate" :model-value="modelValue.createEdgePredicateIri" :choices="edgePredicates" :enabled="enabled && !busy" :allow-empty="false" @update:model-value="update('createEdgePredicateIri', $event)" />
          <IriChoiceField label="相手" input-label="Create edge resource" :model-value="modelValue.createEdgeResourceIri" :choices="resources" :enabled="enabled && !busy" pickable :picking="isPicking({ field: 'createEdgeResourceIri' })" @update:model-value="update('createEdgeResourceIri', $event)" @pick="requestResource({ field: 'createEdgeResourceIri' })" />
        </template>
      </fieldset>
      <fieldset class="iriograph-authoring-value-row">
        <legend>領域へ含める（任意）</legend>
        <label class="iriograph-authoring-check"><input aria-label="Create membership enabled" type="checkbox" :checked="modelValue.createMembershipEnabled" :disabled="!enabled || busy" @change="update('createMembershipEnabled', ($event.target as HTMLInputElement).checked)" /><span>意味上の包含も作る</span></label>
        <template v-if="modelValue.createMembershipEnabled">
          <label><span>包含方法</span><select aria-label="Create membership structure" :value="modelValue.createMembershipStructureConfigKey" :disabled="!enabled || busy" @change="selectCreateMembershipStructure"><option value="">選択してください</option><option v-for="item in membershipStructures" :key="item.key" :value="item.key">{{ item.label }}</option></select></label>
          <IriChoiceField label="領域" input-label="Create membership container" :model-value="modelValue.createMembershipContainerIri" :choices="resources" :enabled="enabled && !busy" pickable :picking="isPicking({ field: 'createMembershipContainerIri' })" @update:model-value="update('createMembershipContainerIri', $event)" @pick="requestResource({ field: 'createMembershipContainerIri' })" />
        </template>
      </fieldset>
    </template>

    <template v-else-if="modelValue.kind === 'set-property'">
      <IriChoiceField label="対象" input-label="Property subject" :model-value="modelValue.subjectIri" :choices="resources" :enabled="enabled && !busy" pickable :picking="isPicking({ field: 'subjectIri' })" @update:model-value="update('subjectIri', $event)" @pick="requestResource({ field: 'subjectIri' })" />
      <IriChoiceField label="属性" input-label="Property predicate" :model-value="modelValue.predicateIri" :choices="properties" :enabled="enabled && !busy" :allow-empty="false" @update:model-value="update('predicateIri', $event)" />
      <label><span>更新方法</span><select aria-label="Property update mode" :value="modelValue.propertyMode" :disabled="!enabled || busy" @change="update('propertyMode', inputValue($event) as 'replace' | 'delete')"><option value="replace">値を完全置換</option><option value="delete">属性を削除</option></select></label>
      <template v-if="modelValue.propertyMode === 'replace'">
        <fieldset v-for="(value, index) in modelValue.propertyValues" :key="index" class="iriograph-authoring-value-row">
          <legend>値 {{ index + 1 }}</legend>
          <label><span>値の種類</span><select :aria-label="`Property object kind ${index + 1}`" :value="value.objectKind" :disabled="!enabled || busy" @change="updatePropertyValue(index, 'objectKind', inputValue($event) as 'literal' | 'iri')"><option value="literal">テキスト</option><option value="iri">既存要素</option></select></label>
          <IriChoiceField v-if="value.objectKind === 'iri'" label="既存要素" :input-label="`Property value ${index + 1}`" :model-value="value.value" :choices="resources" :enabled="enabled && !busy" pickable :picking="isPicking({ field: 'propertyValue', index })" @update:model-value="updatePropertyValue(index, 'value', $event)" @pick="requestResource({ field: 'propertyValue', index })" />
          <label v-else><span>値</span><input :aria-label="`Property value ${index + 1}`" :value="value.value" :disabled="!enabled || busy" @input="updatePropertyValue(index, 'value', inputValue($event))" /></label>
          <template v-if="value.objectKind === 'literal'">
            <label><span>Language</span><input :aria-label="`Literal language ${index + 1}`" :value="value.language" :disabled="!enabled || busy || Boolean(value.datatypeIri)" @input="updatePropertyValue(index, 'language', inputValue($event))" /></label>
            <label><span>Datatype IRI</span><input :aria-label="`Literal datatype ${index + 1}`" :value="value.datatypeIri" :disabled="!enabled || busy || Boolean(value.language)" @input="updatePropertyValue(index, 'datatypeIri', inputValue($event))" /></label>
          </template>
          <button type="button" :aria-label="`Property value ${index + 1}を削除`" :disabled="!enabled || busy" @click="removePropertyValue(index)">行を削除</button>
        </fieldset>
        <button type="button" class="iriograph-wide-button" :disabled="!enabled || busy" @click="addPropertyValue">値を追加</button>
      </template>
      <p v-else>この属性の値をすべて削除します。関連する匿名要素は自動削除しません。</p>
    </template>

    <template v-else-if="modelValue.kind === 'connect-resources'">
      <IriChoiceField label="始点" input-label="Edge source" :model-value="modelValue.sourceIri" :choices="resources" :enabled="enabled && !busy" pickable :picking="isPicking({ field: 'sourceIri' })" @update:model-value="update('sourceIri', $event)" @pick="requestResource({ field: 'sourceIri' })" />
      <button v-if="selectedResource" type="button" :disabled="!enabled || busy" @click="emit('seedSelection', 'edge-source')">選択中を始点へ</button>
      <IriChoiceField label="関係" input-label="Edge predicate" :model-value="modelValue.predicateIri" :choices="edgePredicates" :enabled="enabled && !busy" :allow-empty="false" @update:model-value="update('predicateIri', $event)" />
      <IriChoiceField label="終点" input-label="Edge target" :model-value="modelValue.targetIri" :choices="resources" :enabled="enabled && !busy" pickable :picking="isPicking({ field: 'targetIri' })" @update:model-value="update('targetIri', $event)" @pick="requestResource({ field: 'targetIri' })" />
      <button v-if="selectedResource" type="button" :disabled="!enabled || busy" @click="emit('seedSelection', 'edge-target')">選択中を終点へ</button>
    </template>

    <template v-else-if="modelValue.kind === 'set-membership'">
      <label><span>包含方法</span><select aria-label="Membership structure config" :value="modelValue.structureConfigKey" :disabled="!enabled || busy" @change="selectStructure"><option value="">選択してください</option><option v-for="item in relevantStructures" :key="item.key" :value="item.key">{{ item.label }}</option></select></label>
      <details v-if="modelValue.containerTypeIri" class="iriograph-authoring-advanced"><summary>Advanced: 包含定義</summary><code>{{ modelValue.containerTypeIri }} / {{ modelValue.membershipPredicateIri }}</code></details>
      <IriChoiceField label="領域" input-label="Membership container" :model-value="modelValue.containerIri" :choices="resources" :enabled="enabled && !busy" pickable :picking="isPicking({ field: 'containerIri' })" @update:model-value="update('containerIri', $event)" @pick="requestResource({ field: 'containerIri' })" />
      <button v-if="selectedResource" type="button" :disabled="!enabled || busy" @click="emit('seedSelection', 'membership-container')">選択中を領域へ</button>
      <IriChoiceField label="含まれる要素" input-label="Membership member" :model-value="modelValue.memberIri" :choices="resources" :enabled="enabled && !busy" pickable :picking="isPicking({ field: 'memberIri' })" @update:model-value="update('memberIri', $event)" @pick="requestResource({ field: 'memberIri' })" />
      <button v-if="selectedResource" type="button" :disabled="!enabled || busy" @click="emit('seedSelection', 'membership-member')">選択中を含まれる要素へ</button>
      <label class="iriograph-authoring-check"><input aria-label="Membership present" type="checkbox" :checked="modelValue.present" :disabled="!enabled || busy" @change="update('present', ($event.target as HTMLInputElement).checked)" /><span>領域へ含める</span></label>
    </template>

    <template v-else-if="modelValue.kind === 'set-sequence' || modelValue.kind === 'set-alternatives'">
      <label><span>{{ modelValue.kind === 'set-sequence' ? '並び方' : '分岐方法' }}</span><select aria-label="Ordinal structure config" :value="modelValue.structureConfigKey" :disabled="!enabled || busy" @change="selectStructure"><option value="">選択してください</option><option v-for="item in relevantStructures" :key="item.key" :value="item.key">{{ item.label }}</option></select></label>
      <details v-if="modelValue.ordinalPredicatePrefix" class="iriograph-authoring-advanced"><summary>Advanced: 順序定義</summary><code>{{ modelValue.kind === 'set-sequence' ? modelValue.sequenceTypeIri : modelValue.alternativeTypeIri }} / {{ modelValue.ordinalPredicatePrefix }}</code></details>
      <IriChoiceField label="対象" input-label="Structure IRI" :model-value="modelValue.structureIri" :choices="resources" :enabled="enabled && !busy" pickable :picking="isPicking({ field: 'structureIri' })" @update:model-value="update('structureIri', $event)" @pick="requestResource({ field: 'structureIri' })" />
      <label><span>並べる要素（1行ずつ）</span><textarea aria-label="Structure members" :value="modelValue.membersText" :disabled="!enabled || busy" @input="updateMembers(inputValue($event))" /></label>
      <template v-if="modelValue.kind === 'set-alternatives'">
        <label><span>既定にする位置</span><input aria-label="Default ordinal" type="number" min="1" :value="modelValue.defaultOrdinal" readonly /></label>
        <label><span>既定の要素</span><input aria-label="Default member IRI" :value="modelValue.defaultMemberIri" readonly /></label>
      </template>
    </template>

    <template v-else-if="modelValue.kind === 'delete-resource'">
      <IriChoiceField label="削除する要素" input-label="Delete resource IRI" :model-value="modelValue.resourceIri" :choices="resources" :enabled="enabled && !busy" pickable :picking="isPicking({ field: 'resourceIri' })" @update:model-value="update('resourceIri', $event)" @pick="requestResource({ field: 'resourceIri' })" />
      <label class="iriograph-authoring-check"><input aria-label="Explicit cascade" type="checkbox" :checked="modelValue.cascade" :disabled="!enabled || busy" @change="update('cascade', ($event.target as HTMLInputElement).checked)" /><span>確認画面に出た参照関係もまとめて削除</span></label>
    </template>

    <template v-else-if="modelValue.kind === 'remove-statement'">
      <p>選択した関係だけを削除します。適用前に影響範囲を確認できます。</p>
      <details class="iriograph-authoring-advanced"><summary>Advanced: 元の statement</summary><label><span>Statement ref</span><input aria-label="Statement ref" :value="modelValue.statementRef" readonly /></label><label><span>Subject</span><input aria-label="Statement subject" :value="modelValue.statementSubject" readonly /></label><label><span>Predicate</span><input aria-label="Statement predicate" :value="modelValue.statementPredicate" readonly /></label><label><span>Object</span><input aria-label="Statement object" :value="modelValue.statementObject" readonly /></label></details>
    </template>

    <template v-else>
      <label><span>定義済み操作</span><select aria-label="Projection capability" :value="modelValue.capabilityId" :disabled="!enabled || busy" @change="changeCapability"><option value="">選択してください</option><option v-for="item in capabilities" :key="item.iri" :value="item.iri">{{ item.label ?? '追加アクション' }}</option></select></label>
      <fieldset v-for="parameter in selectedCapability?.parameters ?? []" :key="parameter.name" class="iriograph-authoring-value-row">
        <legend>{{ parameter.name }}{{ parameter.required !== false ? " *" : "" }}</legend>
        <label v-if="parameter.required === false" class="iriograph-authoring-check"><input :aria-label="`${parameter.name} binding enabled`" type="checkbox" :checked="modelValue.capabilityBindings[parameter.name]?.enabled" :disabled="!enabled || busy" @change="updateCapabilityBinding(parameter.name, 'enabled', ($event.target as HTMLInputElement).checked)" /><span>指定する</span></label>
        <template v-if="parameter.required !== false || modelValue.capabilityBindings[parameter.name]?.enabled">
          <label v-if="parameter.objectKinds.length > 1"><span>値の種類</span><select :aria-label="`${parameter.name} binding kind`" :value="modelValue.capabilityBindings[parameter.name]?.objectKind" :disabled="!enabled || busy" @change="updateCapabilityBinding(parameter.name, 'objectKind', inputValue($event) as 'literal' | 'iri')"><option v-for="kind in parameter.objectKinds" :key="kind" :value="kind">{{ kind === 'iri' ? '既存要素' : 'テキスト' }}</option></select></label>
          <label><span>値</span><input :aria-label="`${parameter.name} binding value`" :list="modelValue.capabilityBindings[parameter.name]?.objectKind === 'iri' ? resourceListId : undefined" :value="modelValue.capabilityBindings[parameter.name]?.value" :disabled="!enabled || busy" @input="updateCapabilityBinding(parameter.name, 'value', inputValue($event))" /></label>
          <template v-if="modelValue.capabilityBindings[parameter.name]?.objectKind === 'literal'">
            <label><span>Language</span><input :aria-label="`${parameter.name} binding language`" :value="modelValue.capabilityBindings[parameter.name]?.language" :disabled="!enabled || busy || Boolean(modelValue.capabilityBindings[parameter.name]?.datatypeIri)" @input="updateCapabilityBinding(parameter.name, 'language', inputValue($event))" /></label>
            <label><span>Datatype IRI</span><input :aria-label="`${parameter.name} binding datatype`" :value="modelValue.capabilityBindings[parameter.name]?.datatypeIri" :disabled="!enabled || busy || Boolean(modelValue.capabilityBindings[parameter.name]?.language)" @input="updateCapabilityBinding(parameter.name, 'datatypeIri', inputValue($event))" /></label>
          </template>
        </template>
      </fieldset>
    </template>

    <div class="iriograph-authoring-actions">
      <button type="button" :disabled="!enabled || busy" @click="emit('preview')">{{ busy ? "検証中…" : "変更内容を確認" }}</button>
      <button type="button" class="primary" :disabled="!enabled || busy || !preview?.valid" @click="emit('apply')">{{ preview?.diagnostics.some((item) => item.severity === 'warning') ? "警告を確認して適用" : "明示的に適用" }}</button>
      <button type="button" @click="emit('cancel')">キャンセル</button>
    </div>

    <section v-if="preview" class="iriograph-authoring-preview">
      <div><b>{{ preview.operationLabel }}</b><span>{{ preview.valid ? "適用可能" : "適用不可" }}</span></div>
      <div class="iriograph-preview-summary">
        <span class="iriograph-preview-count add">追加する関係 {{ preview.addedStatements.length }}件</span>
        <span class="iriograph-preview-count remove">削除する関係 {{ preview.removedStatements.length }}件</span>
        <span v-for="relation in preview.relations" :key="`${relation.kind}:${relation.label}`" :class="['iriograph-preview-relation', relation.kind]">
          {{ relation.kind === 'membership' ? '⊂' : '→' }} {{ relation.label }}
        </span>
      </div>
      <div v-if="preview.resourceChips.length" class="iriograph-preview-resources">
        <span v-for="chip in preview.resourceChips" :key="`${chip.role}:${chip.iri}`" class="iriograph-resource-chip" :title="chip.iri">
          <small>{{ chip.role }}</small>{{ chip.label }}
        </span>
      </div>
      <ul v-if="preview.diagnostics.length"><li v-for="(item, index) in preview.diagnostics" :key="`${item.code}:${index}`" :class="item.severity"><b>{{ item.code }}</b> {{ item.message }}</li></ul>
      <details><summary>Advanced: 正確な triple（削除 {{ preview.removedStatements.length }} / 追加 {{ preview.addedStatements.length }}）</summary><h5>Removed</h5><pre>{{ preview.removedStatements.join('\n') }}</pre><h5>Added</h5><pre>{{ preview.addedStatements.join('\n') }}</pre></details>
      <details><summary>Advanced: 適用後の Turtle</summary><pre>{{ preview.candidateSource }}</pre></details>
    </section>
  </section>
</template>
