<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from "vue";

import type {
  AuthoringCommand,
  IriographDocument,
  ResolvedAuthoringTerm,
} from "@iriograph/core";

import {
  emptyPropertyValueDraft,
  type AuthoringChoice,
  type EditorPropertyValueDraft,
} from "../authoring-draft";
import {
  resourcePropertyCommands,
  resourcePropertyEditorRows,
  type ResourcePropertyEditorRow,
} from "../resource-details";

const props = defineProps<{
  document: IriographDocument;
  subjectIri: string;
  title: string;
  terms: readonly ResolvedAuthoringTerm[];
  resources: readonly AuthoringChoice[];
  busy?: boolean;
}>();

const emit = defineEmits<{
  preview: [commands: AuthoringCommand[]];
  close: [];
}>();

const dialog = ref<HTMLElement>();
const original = resourcePropertyEditorRows(props.document, props.subjectIri, props.terms);
const rows = ref<ResourcePropertyEditorRow[]>(structuredClone(original));
const commands = computed(() => resourcePropertyCommands(props.subjectIri, original, rows.value));

onMounted(() => void nextTick(() => dialog.value?.querySelector<HTMLInputElement>("input")?.focus()));

function updateValue<K extends keyof EditorPropertyValueDraft>(rowIndex: number, valueIndex: number, key: K, value: EditorPropertyValueDraft[K]): void {
  const row = rows.value[rowIndex];
  const target = row?.values[valueIndex];
  if (!row || !target) return;
  row.values[valueIndex] = { ...target, [key]: value };
}

function addValue(row: ResourcePropertyEditorRow): void {
  row.values.push(emptyPropertyValueDraft(row.objectKinds[0] ?? "literal"));
}

function removeValue(row: ResourcePropertyEditorRow, index: number): void {
  row.values.splice(index, 1);
}

function submit(): void {
  if (commands.value.length > 0) emit("preview", commands.value);
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    event.preventDefault();
    emit("close");
  }
}
</script>

<template>
  <div class="iriograph-modal-backdrop" role="presentation" @click.self="emit('close')">
    <section ref="dialog" class="iriograph-resource-details-dialog" role="dialog" aria-modal="true" aria-labelledby="iriograph-details-title" @keydown="handleKeydown">
      <header><div><small>DETAILS &amp; PROPERTIES</small><strong id="iriograph-details-title">{{ title }}</strong></div><button type="button" aria-label="閉じる" @click="emit('close')">×</button></header>
      <p>表示名や属性をまとめて編集し、一つの変更内容として確認します。</p>
      <section v-for="(row, rowIndex) in rows" :key="row.predicateIri" class="iriograph-property-editor-row">
        <div><b>{{ row.label }}</b><span>{{ row.values.length }}件</span></div>
        <fieldset v-for="(value, valueIndex) in row.values" :key="valueIndex">
          <label v-if="row.objectKinds.length > 1"><span>種類</span><select :value="value.objectKind" @change="updateValue(rowIndex, valueIndex, 'objectKind', ($event.target as HTMLSelectElement).value as 'iri' | 'literal')"><option v-for="kind in row.objectKinds" :key="kind" :value="kind">{{ kind === 'iri' ? '既存要素' : 'テキスト' }}</option></select></label>
          <label v-if="value.objectKind === 'iri'"><span>値</span><select :value="value.value" @change="updateValue(rowIndex, valueIndex, 'value', ($event.target as HTMLSelectElement).value)"><option value="">選択してください</option><option v-for="resource in resources" :key="resource.iri" :value="resource.iri" :title="resource.iri">{{ resource.label ?? resource.iri }}</option></select></label>
          <label v-else><span>値</span><input :value="value.value" @input="updateValue(rowIndex, valueIndex, 'value', ($event.target as HTMLInputElement).value)" /></label>
          <details v-if="value.objectKind === 'literal'"><summary>言語・datatype</summary><label><span>言語</span><input :value="value.language" :disabled="Boolean(value.datatypeIri)" @input="updateValue(rowIndex, valueIndex, 'language', ($event.target as HTMLInputElement).value)" /></label><label><span>Datatype IRI</span><input :value="value.datatypeIri" :disabled="Boolean(value.language)" @input="updateValue(rowIndex, valueIndex, 'datatypeIri', ($event.target as HTMLInputElement).value)" /></label></details>
          <button type="button" @click="removeValue(row, valueIndex)">この値を削除</button>
        </fieldset>
        <button type="button" @click="addValue(row)">値を追加</button>
        <details><summary>Advanced: property IRI</summary><code>{{ row.predicateIri }}</code></details>
      </section>
      <details><summary>Advanced: resource identity</summary><code>{{ subjectIri }}</code></details>
      <footer><button type="button" @click="emit('close')">キャンセル</button><button type="button" class="primary" :disabled="busy || commands.length === 0" @click="submit">{{ busy ? '検証中…' : `変更${commands.length}件を確認` }}</button></footer>
    </section>
  </div>
</template>
