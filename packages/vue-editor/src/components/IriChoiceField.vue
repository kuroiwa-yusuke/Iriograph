<script setup lang="ts">
import { computed, nextTick, ref, useId } from "vue";

import type { AuthoringChoice } from "../authoring-draft";

const CUSTOM_VALUE = "__iriograph_custom_iri__";

const props = withDefaults(defineProps<{
  modelValue: string;
  label: string;
  inputLabel: string;
  choices?: AuthoringChoice[];
  enabled?: boolean;
  allowEmpty?: boolean;
  pickable?: boolean;
  picking?: boolean;
}>(), {
  choices: () => [],
  enabled: true,
  allowEmpty: true,
  pickable: false,
  picking: false,
});

const emit = defineEmits<{
  "update:modelValue": [value: string];
  pick: [];
}>();

const listId = `${useId()}-iri-choices`;
const advancedOpen = ref(false);
const advancedInput = ref<HTMLInputElement>();
const query = ref("");
const knownChoice = computed(() => props.choices.find((choice) => choice.iri === props.modelValue));
const selection = computed(() => props.modelValue && !knownChoice.value ? CUSTOM_VALUE : props.modelValue);
const filteredChoices = computed(() => {
  const normalized = query.value.trim().toLocaleLowerCase();
  if (!normalized) return props.choices;
  return props.choices.filter((choice) => choice.iri === props.modelValue || [
    choice.label,
    choice.description,
    choice.category,
    choice.example,
    choice.iri,
  ].some((value) => value?.toLocaleLowerCase().includes(normalized)));
});

function changeChoice(event: Event): void {
  const value = (event.target as HTMLSelectElement).value;
  if (value === CUSTOM_VALUE) {
    advancedOpen.value = true;
    void nextTick(() => advancedInput.value?.focus());
    return;
  }
  advancedOpen.value = false;
  query.value = "";
  emit("update:modelValue", value);
}

function compactIri(iri: string): string {
  const hash = iri.lastIndexOf("#");
  const slash = iri.lastIndexOf("/");
  const colon = iri.lastIndexOf(":");
  return iri.slice(Math.max(hash, slash, colon) + 1) || iri;
}
</script>

<template>
  <div class="iriograph-iri-choice-field">
    <label v-if="choices.length > 5" class="iriograph-choice-search">
      <span>{{ label }}を検索</span>
      <input v-model="query" :aria-label="`${inputLabel} search`" type="search" :disabled="!enabled" placeholder="名前・説明・分類で絞り込み" />
    </label>
    <label>
      <span>{{ label }}</span>
      <select
        :aria-label="`${inputLabel} choice`"
        :value="selection"
        :disabled="!enabled"
        @change="changeChoice"
      >
        <option value="" :disabled="!allowEmpty">選択してください</option>
        <option
          v-for="choice in filteredChoices"
          :key="choice.iri"
          :value="choice.iri"
          :title="choice.iri"
        >{{ choice.category ? `[${choice.category}] ` : '' }}{{ choice.label || compactIri(choice.iri) }}</option>
        <option :value="CUSTOM_VALUE">完全IRIを指定…</option>
      </select>
    </label>
    <small v-if="knownChoice && (knownChoice.category || knownChoice.description || knownChoice.example)" class="iriograph-choice-metadata"><b v-if="knownChoice.category">{{ knownChoice.category }}</b><span v-if="knownChoice.description">{{ knownChoice.description }}</span><span v-if="knownChoice.example">例: {{ knownChoice.example }}</span></small>
    <details :open="advancedOpen || Boolean(modelValue && !knownChoice)" @toggle="advancedOpen = ($event.target as HTMLDetailsElement).open">
      <summary>Advanced: 完全IRI</summary>
      <small v-if="knownChoice" class="iriograph-choice-iri" :title="knownChoice.iri">{{ knownChoice.iri }}</small>
      <input
        ref="advancedInput"
        :aria-label="inputLabel"
        :list="listId"
        :value="modelValue"
        :disabled="!enabled"
        @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
      />
      <datalist :id="listId">
        <option v-for="choice in choices" :key="choice.iri" :value="choice.iri">{{ choice.label }}</option>
      </datalist>
    </details>
    <button
      v-if="pickable"
      type="button"
      class="iriograph-pick-resource"
      :aria-pressed="picking"
      :disabled="!enabled"
      @click="emit('pick')"
    >{{ picking ? `Canvasで${label}を選択中…` : `Canvasから選択 — ${label}` }}</button>
  </div>
</template>
