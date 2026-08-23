<script setup lang="ts">
import { computed, useId } from "vue";
import type { ProjectionDiagnostic } from "@iriograph/core";

import type {
  AuthoringCapabilityChoice,
  AuthoringChoice,
  AuthoringPreviewView,
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
});

const instanceId = useId();
const resourceListId = `${instanceId}-authoring-resources`;
const classListId = `${instanceId}-authoring-classes`;
const propertyListId = `${instanceId}-authoring-properties`;
const edgeListId = `${instanceId}-authoring-edges`;

const emit = defineEmits<{
  "update:modelValue": [draft: EditorAuthoringDraft];
  preview: [];
  apply: [];
  cancel: [];
  pickPosition: [];
  seedSelection: [target: "edge-source" | "edge-target" | "membership-container" | "membership-member"];
}>();

const kinds: Array<{ value: EditorAuthoringKind; label: string }> = [
  { value: "create-resource", label: "Resourceを作成" },
  { value: "set-property", label: "属性を設定" },
  { value: "connect-resources", label: "Edgeを接続" },
  { value: "set-membership", label: "包含を設定" },
  { value: "set-sequence", label: "順序を設定" },
  { value: "set-alternatives", label: "選択肢を設定" },
  { value: "delete-resource", label: "Resourceを削除" },
  { value: "apply-capability", label: "Capability patch" },
];

const selectedCapability = computed(() => props.capabilities.find(
  (item) => item.iri === props.modelValue.capabilityId,
));
const relevantStructures = computed(() => props.structures.filter((item) => (
  (props.modelValue.kind === "set-membership" && item.kind === "membership")
  || (props.modelValue.kind === "set-sequence" && item.kind === "sequence")
  || (props.modelValue.kind === "set-alternatives" && item.kind === "alternatives")
)));

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
      <div><small>SEMANTIC AUTHORING</small><strong>Meaning graph</strong></div>
      <span>preview → apply</span>
    </header>
    <p v-if="blockedReason" class="iriograph-authoring-blocked">{{ blockedReason }}</p>
    <ul v-if="!preview && diagnostics.length" class="iriograph-authoring-diagnostics">
      <li v-for="(item, index) in diagnostics" :key="`${item.code}:${index}`" :class="item.severity"><b>{{ item.code }}</b> {{ item.message }}</li>
    </ul>
    <datalist :id="resourceListId"><option v-for="item in resources" :key="item.iri" :value="item.iri">{{ item.label }}</option></datalist>
    <label>
      <span>操作</span>
      <select aria-label="Semantic operation" :value="modelValue.kind" :disabled="!enabled || busy" @change="changeKind">
        <option v-if="modelValue.kind === 'remove-statement'" value="remove-statement">元tripleを削除</option>
        <option v-for="kind in kinds" :key="kind.value" :value="kind.value">{{ kind.label }}</option>
      </select>
    </label>

    <template v-if="modelValue.kind === 'create-resource'">
      <label><span>Resource IRI（空欄で採番）</span><input aria-label="Resource IRI" :value="modelValue.resourceIri" :disabled="!enabled || busy" @input="update('resourceIri', inputValue($event))" /></label>
      <label><span>Class</span><input aria-label="Resource class" :list="classListId" :value="modelValue.classIri" :disabled="!enabled || busy" @input="update('classIri', inputValue($event))" /></label>
      <datalist :id="classListId"><option v-for="item in classes" :key="item.iri" :value="item.iri">{{ item.label }}</option></datalist>
      <label><span>Label</span><input aria-label="Resource label" :value="modelValue.label" :disabled="!enabled || busy" @input="update('label', inputValue($event))" /></label>
      <button type="button" class="iriograph-wide-button" :aria-pressed="modelValue.positionPicking" :disabled="!enabled || busy" @click="requestPosition">
        {{ modelValue.positionPicking ? "Canvasの空白をクリック…" : "Canvasで位置指定" }}
      </button>
      <div class="iriograph-authoring-position">
        <label><span>x</span><input aria-label="Initial x" type="number" :value="modelValue.initialX" :disabled="!enabled || busy" @input="update('initialX', inputValue($event))" /></label>
        <label><span>y</span><input aria-label="Initial y" type="number" :value="modelValue.initialY" :disabled="!enabled || busy" @input="update('initialY', inputValue($event))" /></label>
      </div>
    </template>

    <template v-else-if="modelValue.kind === 'set-property'">
      <label><span>Subject IRI</span><input aria-label="Property subject" :list="resourceListId" :value="modelValue.subjectIri" :disabled="!enabled || busy" @input="update('subjectIri', inputValue($event))" /></label>
      <label><span>Predicate</span><input aria-label="Property predicate" :list="propertyListId" :value="modelValue.predicateIri" :disabled="!enabled || busy" @input="update('predicateIri', inputValue($event))" /></label>
      <datalist :id="propertyListId"><option v-for="item in properties" :key="item.iri" :value="item.iri">{{ item.label }}</option></datalist>
      <label><span>更新方法</span><select aria-label="Property update mode" :value="modelValue.propertyMode" :disabled="!enabled || busy" @change="update('propertyMode', inputValue($event) as 'replace' | 'delete')"><option value="replace">値を完全置換</option><option value="delete">属性を削除</option></select></label>
      <template v-if="modelValue.propertyMode === 'replace'">
        <fieldset v-for="(value, index) in modelValue.propertyValues" :key="index" class="iriograph-authoring-value-row">
          <legend>Value {{ index + 1 }}</legend>
          <label><span>Object kind</span><select :aria-label="`Property object kind ${index + 1}`" :value="value.objectKind" :disabled="!enabled || busy" @change="updatePropertyValue(index, 'objectKind', inputValue($event) as 'literal' | 'iri')"><option value="literal">Literal</option><option value="iri">IRI</option></select></label>
          <label><span>Value</span><input :aria-label="`Property value ${index + 1}`" :list="value.objectKind === 'iri' ? resourceListId : undefined" :value="value.value" :disabled="!enabled || busy" @input="updatePropertyValue(index, 'value', inputValue($event))" /></label>
          <template v-if="value.objectKind === 'literal'">
            <label><span>Language</span><input :aria-label="`Literal language ${index + 1}`" :value="value.language" :disabled="!enabled || busy || Boolean(value.datatypeIri)" @input="updatePropertyValue(index, 'language', inputValue($event))" /></label>
            <label><span>Datatype IRI</span><input :aria-label="`Literal datatype ${index + 1}`" :value="value.datatypeIri" :disabled="!enabled || busy || Boolean(value.language)" @input="updatePropertyValue(index, 'datatypeIri', inputValue($event))" /></label>
          </template>
          <button type="button" :aria-label="`Property value ${index + 1}を削除`" :disabled="!enabled || busy" @click="removePropertyValue(index)">行を削除</button>
        </fieldset>
        <button type="button" class="iriograph-wide-button" :disabled="!enabled || busy" @click="addPropertyValue">Valueを追加</button>
      </template>
      <p v-else>subject＋predicateの値をすべて削除します。参照が外れたblank node subgraphは推測削除しません。</p>
    </template>

    <template v-else-if="modelValue.kind === 'connect-resources'">
      <label><span>Source IRI</span><input aria-label="Edge source" :list="resourceListId" :value="modelValue.sourceIri" :disabled="!enabled || busy" @input="update('sourceIri', inputValue($event))" /></label>
      <button v-if="selectedResource" type="button" :disabled="!enabled || busy" @click="emit('seedSelection', 'edge-source')">選択中をSourceへ</button>
      <label><span>Predicate</span><input aria-label="Edge predicate" :list="edgeListId" :value="modelValue.predicateIri" :disabled="!enabled || busy" @input="update('predicateIri', inputValue($event))" /></label>
      <datalist :id="edgeListId"><option v-for="item in edgePredicates" :key="item.iri" :value="item.iri">{{ item.label }}</option></datalist>
      <label><span>Target IRI</span><input aria-label="Edge target" :list="resourceListId" :value="modelValue.targetIri" :disabled="!enabled || busy" @input="update('targetIri', inputValue($event))" /></label>
      <button v-if="selectedResource" type="button" :disabled="!enabled || busy" @click="emit('seedSelection', 'edge-target')">選択中をTargetへ</button>
    </template>

    <template v-else-if="modelValue.kind === 'set-membership'">
      <label><span>Catalog structure</span><select aria-label="Membership structure config" :value="modelValue.structureConfigKey" :disabled="!enabled || busy" @change="selectStructure"><option value="">選択してください</option><option v-for="item in relevantStructures" :key="item.key" :value="item.key">{{ item.label }}</option></select></label>
      <small v-if="modelValue.containerTypeIri">{{ modelValue.containerTypeIri }} / {{ modelValue.membershipPredicateIri }}</small>
      <label><span>Container IRI</span><input aria-label="Membership container" :list="resourceListId" :value="modelValue.containerIri" :disabled="!enabled || busy" @input="update('containerIri', inputValue($event))" /></label>
      <button v-if="selectedResource" type="button" :disabled="!enabled || busy" @click="emit('seedSelection', 'membership-container')">選択中をContainerへ</button>
      <label><span>Member IRI</span><input aria-label="Membership member" :list="resourceListId" :value="modelValue.memberIri" :disabled="!enabled || busy" @input="update('memberIri', inputValue($event))" /></label>
      <button v-if="selectedResource" type="button" :disabled="!enabled || busy" @click="emit('seedSelection', 'membership-member')">選択中をMemberへ</button>
      <label class="iriograph-authoring-check"><input aria-label="Membership present" type="checkbox" :checked="modelValue.present" :disabled="!enabled || busy" @change="update('present', ($event.target as HTMLInputElement).checked)" /><span>Containerへ含める</span></label>
    </template>

    <template v-else-if="modelValue.kind === 'set-sequence' || modelValue.kind === 'set-alternatives'">
      <label><span>Catalog structure</span><select aria-label="Ordinal structure config" :value="modelValue.structureConfigKey" :disabled="!enabled || busy" @change="selectStructure"><option value="">選択してください</option><option v-for="item in relevantStructures" :key="item.key" :value="item.key">{{ item.label }}</option></select></label>
      <small v-if="modelValue.ordinalPredicatePrefix">{{ modelValue.kind === 'set-sequence' ? modelValue.sequenceTypeIri : modelValue.alternativeTypeIri }} / {{ modelValue.ordinalPredicatePrefix }}</small>
      <label><span>Structure IRI</span><input aria-label="Structure IRI" :list="resourceListId" :value="modelValue.structureIri" :disabled="!enabled || busy" @input="update('structureIri', inputValue($event))" /></label>
      <label><span>Members（ordinal順・1行1 IRI）</span><textarea aria-label="Structure members" :value="modelValue.membersText" :disabled="!enabled || busy" @input="updateMembers(inputValue($event))" /></label>
      <template v-if="modelValue.kind === 'set-alternatives'">
        <label><span>Default ordinal slot</span><input aria-label="Default ordinal" type="number" min="1" :value="modelValue.defaultOrdinal" readonly /></label>
        <label><span>Default member（slotから決定）</span><input aria-label="Default member IRI" :value="modelValue.defaultMemberIri" readonly /></label>
      </template>
    </template>

    <template v-else-if="modelValue.kind === 'delete-resource'">
      <label><span>Resource IRI</span><input aria-label="Delete resource IRI" :list="resourceListId" :value="modelValue.resourceIri" :disabled="!enabled || busy" @input="update('resourceIri', inputValue($event))" /></label>
      <label class="iriograph-authoring-check"><input aria-label="Explicit cascade" type="checkbox" :checked="modelValue.cascade" :disabled="!enabled || busy" @change="update('cascade', ($event.target as HTMLInputElement).checked)" /><span>Previewした参照もcascade削除</span></label>
    </template>

    <template v-else-if="modelValue.kind === 'remove-statement'">
      <p>Scene provenanceが示した元のtripleだけを削除します。</p>
      <label><span>Statement ref</span><input aria-label="Statement ref" :value="modelValue.statementRef" readonly /></label>
      <label><span>Subject</span><input aria-label="Statement subject" :value="modelValue.statementSubject" readonly /></label>
      <label><span>Predicate</span><input aria-label="Statement predicate" :value="modelValue.statementPredicate" readonly /></label>
      <label><span>Object</span><input aria-label="Statement object" :value="modelValue.statementObject" readonly /></label>
    </template>

    <template v-else>
      <label><span>Capability</span><select aria-label="Projection capability" :value="modelValue.capabilityId" :disabled="!enabled || busy" @change="changeCapability"><option value="">選択してください</option><option v-for="item in capabilities" :key="item.iri" :value="item.iri">{{ item.label ?? item.iri }}</option></select></label>
      <fieldset v-for="parameter in selectedCapability?.parameters ?? []" :key="parameter.name" class="iriograph-authoring-value-row">
        <legend>{{ parameter.name }}{{ parameter.required !== false ? " *" : "" }}</legend>
        <label v-if="parameter.required === false" class="iriograph-authoring-check"><input :aria-label="`${parameter.name} binding enabled`" type="checkbox" :checked="modelValue.capabilityBindings[parameter.name]?.enabled" :disabled="!enabled || busy" @change="updateCapabilityBinding(parameter.name, 'enabled', ($event.target as HTMLInputElement).checked)" /><span>指定する</span></label>
        <template v-if="parameter.required !== false || modelValue.capabilityBindings[parameter.name]?.enabled">
          <label v-if="parameter.objectKinds.length > 1"><span>Object kind</span><select :aria-label="`${parameter.name} binding kind`" :value="modelValue.capabilityBindings[parameter.name]?.objectKind" :disabled="!enabled || busy" @change="updateCapabilityBinding(parameter.name, 'objectKind', inputValue($event) as 'literal' | 'iri')"><option v-for="kind in parameter.objectKinds" :key="kind" :value="kind">{{ kind }}</option></select></label>
          <label><span>Value</span><input :aria-label="`${parameter.name} binding value`" :list="modelValue.capabilityBindings[parameter.name]?.objectKind === 'iri' ? resourceListId : undefined" :value="modelValue.capabilityBindings[parameter.name]?.value" :disabled="!enabled || busy" @input="updateCapabilityBinding(parameter.name, 'value', inputValue($event))" /></label>
          <template v-if="modelValue.capabilityBindings[parameter.name]?.objectKind === 'literal'">
            <label><span>Language</span><input :aria-label="`${parameter.name} binding language`" :value="modelValue.capabilityBindings[parameter.name]?.language" :disabled="!enabled || busy || Boolean(modelValue.capabilityBindings[parameter.name]?.datatypeIri)" @input="updateCapabilityBinding(parameter.name, 'language', inputValue($event))" /></label>
            <label><span>Datatype IRI</span><input :aria-label="`${parameter.name} binding datatype`" :value="modelValue.capabilityBindings[parameter.name]?.datatypeIri" :disabled="!enabled || busy || Boolean(modelValue.capabilityBindings[parameter.name]?.language)" @input="updateCapabilityBinding(parameter.name, 'datatypeIri', inputValue($event))" /></label>
          </template>
        </template>
      </fieldset>
    </template>

    <div class="iriograph-authoring-actions">
      <button type="button" :disabled="!enabled || busy" @click="emit('preview')">{{ busy ? "検証中…" : "差分をPreview" }}</button>
      <button type="button" class="primary" :disabled="!enabled || busy || !preview?.valid" @click="emit('apply')">{{ preview?.diagnostics.some((item) => item.severity === 'warning') ? "警告を確認して適用" : "明示的に適用" }}</button>
      <button type="button" @click="emit('cancel')">Cancel</button>
    </div>

    <section v-if="preview" class="iriograph-authoring-preview">
      <div><b>{{ preview.valid ? "適用可能" : "適用不可" }}</b><code>{{ preview.confirmationId }}</code></div>
      <ul v-if="preview.diagnostics.length"><li v-for="(item, index) in preview.diagnostics" :key="`${item.code}:${index}`" :class="item.severity"><b>{{ item.code }}</b> {{ item.message }}</li></ul>
      <details :open="preview.removedStatements.length > 0"><summary>削除 {{ preview.removedStatements.length }} triple</summary><pre>{{ preview.removedStatements.join('\n') }}</pre></details>
      <details :open="preview.addedStatements.length > 0"><summary>追加 {{ preview.addedStatements.length }} triple</summary><pre>{{ preview.addedStatements.join('\n') }}</pre></details>
      <details><summary>Candidate Turtle</summary><pre>{{ preview.candidateSource }}</pre></details>
    </section>
  </section>
</template>
