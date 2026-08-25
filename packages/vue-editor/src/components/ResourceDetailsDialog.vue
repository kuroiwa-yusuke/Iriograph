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
  type ResourcePropertyCategory,
  type ResourcePropertyEditorRow,
} from "../resource-details";

const props = defineProps<{
  document: IriographDocument;
  subjectIri: string;
  title: string;
  terms: readonly ResolvedAuthoringTerm[];
  resources: readonly AuthoringChoice[];
  busy?: boolean;
  notice?: string;
}>();

const emit = defineEmits<{
  execute: [commands: AuthoringCommand[]];
  close: [];
}>();

const dialog = ref<HTMLElement>();
const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const RDFS_SUBCLASS_OF = "http://www.w3.org/2000/01/rdf-schema#subClassOf";
const RDFS_SUBPROPERTY_OF = "http://www.w3.org/2000/01/rdf-schema#subPropertyOf";
const original = resourcePropertyEditorRows(props.document, props.subjectIri, props.terms);
const rows = ref<ResourcePropertyEditorRow[]>(structuredClone(original));
const commands = computed(() => resourcePropertyCommands(props.subjectIri, original, rows.value));
const sections: Array<{
  category: ResourcePropertyCategory;
  title: string;
  description: string;
}> = [
  { category: "name-description", title: "名前・説明", description: "人とLLMが読む名前、別名、説明です。言語ごとに複数登録できます。" },
  { category: "classification", title: "分類・階層", description: "種類や上位概念など、意味上の分類です。" },
  { category: "relationship", title: "関連", description: "ほかの要素を指す関係です。" },
  { category: "attribute", title: "属性", description: "文字列や数値など、この要素自身の値です。" },
];

function rowsFor(category: ResourcePropertyCategory): Array<{
  row: ResourcePropertyEditorRow;
  rowIndex: number;
}> {
  return rows.value.flatMap((row, rowIndex) => (
    row.category === category ? [{ row, rowIndex }] : []
  ));
}

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

function resourcesFor(row: ResourcePropertyEditorRow): AuthoringChoice[] {
  if (row.predicateIri === RDF_TYPE || row.predicateIri === RDFS_SUBCLASS_OF) {
    return props.terms.filter((term) => term.kind === "class").map((term) => ({
      iri: term.iri,
      label: term.label,
    }));
  }
  if (row.predicateIri === RDFS_SUBPROPERTY_OF) {
    return props.terms.filter((term) => term.kind === "property").map((term) => ({
      iri: term.iri,
      label: term.label,
    }));
  }
  return [...props.resources];
}

function submit(): void {
  if (commands.value.length > 0) emit("execute", commands.value);
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
      <p v-if="notice" class="iriograph-property-notice" role="note">{{ notice }}</p>
      <p>名前や説明、分類、関連、属性を区分して編集し、一つの変更として保存します。</p>
      <section v-for="section in sections" :key="section.category" class="iriograph-property-section" :data-category="section.category">
        <header><div><strong>{{ section.title }}</strong><small>{{ section.description }}</small></div><span>{{ rowsFor(section.category).length }}</span></header>
        <p v-if="rowsFor(section.category).length === 0" class="iriograph-property-empty">編集できる項目はありません。</p>
        <section v-for="entry in rowsFor(section.category)" :key="entry.row.predicateIri" class="iriograph-property-editor-row">
          <div><b>{{ entry.row.label }}</b><span>{{ entry.row.values.length }}件</span></div>
          <fieldset v-for="(value, valueIndex) in entry.row.values" :key="valueIndex">
            <label v-if="entry.row.objectKinds.length > 1"><span>種類</span><select :value="value.objectKind" @change="updateValue(entry.rowIndex, valueIndex, 'objectKind', ($event.target as HTMLSelectElement).value as 'iri' | 'literal')"><option v-for="kind in entry.row.objectKinds" :key="kind" :value="kind">{{ kind === 'iri' ? '既存要素' : 'テキスト' }}</option></select></label>
            <label v-if="value.objectKind === 'iri'"><span>{{ entry.row.category === 'classification' ? '分類先' : '関連先' }}</span><select :value="value.value" @change="updateValue(entry.rowIndex, valueIndex, 'value', ($event.target as HTMLSelectElement).value)"><option value="">選択してください</option><option v-for="resource in resourcesFor(entry.row)" :key="resource.iri" :value="resource.iri" :title="resource.iri">{{ resource.label ?? resource.iri }}</option></select></label>
            <label v-else><span>{{ entry.row.category === 'name-description' ? '内容' : '値' }}</span><textarea v-if="entry.row.multiline" rows="3" :value="value.value" @input="updateValue(entry.rowIndex, valueIndex, 'value', ($event.target as HTMLTextAreaElement).value)" /><input v-else :value="value.value" @input="updateValue(entry.rowIndex, valueIndex, 'value', ($event.target as HTMLInputElement).value)" /></label>
            <details v-if="value.objectKind === 'literal'"><summary>言語・datatype</summary><label><span>言語</span><input :value="value.language" :disabled="Boolean(value.datatypeIri)" @input="updateValue(entry.rowIndex, valueIndex, 'language', ($event.target as HTMLInputElement).value)" /></label><label><span>Datatype IRI</span><input :value="value.datatypeIri" :disabled="Boolean(value.language)" @input="updateValue(entry.rowIndex, valueIndex, 'datatypeIri', ($event.target as HTMLInputElement).value)" /></label></details>
            <button type="button" @click="removeValue(entry.row, valueIndex)">この値を削除</button>
          </fieldset>
          <button type="button" @click="addValue(entry.row)">{{ entry.row.category === 'name-description' ? '別の言語・表現を追加' : '値を追加' }}</button>
          <details><summary>Advanced: property IRI</summary><code>{{ entry.row.predicateIri }}</code></details>
        </section>
      </section>
      <details class="iriograph-property-advanced"><summary>Advanced: resource identity</summary><code>{{ subjectIri }}</code></details>
      <footer><button type="button" @click="emit('close')">キャンセル</button><button type="button" class="primary" :disabled="busy || commands.length === 0" @click="submit">{{ busy ? '保存中…' : `変更${commands.length}件を保存` }}</button></footer>
    </section>
  </div>
</template>
