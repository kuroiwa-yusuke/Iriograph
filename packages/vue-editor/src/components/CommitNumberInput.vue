<script setup lang="ts">
import { ref, watch } from "vue";

const props = withDefaults(defineProps<{
  value: number;
  minimum: number;
  maximum: number;
  step?: number;
  label: string;
  disabled?: boolean;
}>(), {
  step: 1,
  disabled: false,
});

const emit = defineEmits<{
  commit: [value: number];
}>();

const draft = ref(format(props.value));
const dirty = ref(false);
const composing = ref(false);

watch(() => props.value, (value) => {
  if (!dirty.value) draft.value = format(value);
});

function updateDraft(event: Event): void {
  draft.value = (event.target as HTMLInputElement).value;
  dirty.value = true;
}

function finishComposition(event: CompositionEvent): void {
  composing.value = false;
  updateDraft(event);
}

function commitDraft(): void {
  if (!dirty.value || composing.value) return;
  const requested = Number(draft.value);
  dirty.value = false;
  if (!draft.value.trim() || !Number.isFinite(requested)) {
    draft.value = format(props.value);
    return;
  }
  const committed = Math.min(props.maximum, Math.max(props.minimum, requested));
  draft.value = format(committed);
  if (committed !== props.value) emit("commit", committed);
}

function format(value: number): string {
  return Number.isFinite(value) ? String(value) : "";
}
</script>

<template>
  <input
    type="number"
    inputmode="decimal"
    :aria-label="label"
    :min="minimum"
    :max="maximum"
    :step="step"
    :value="draft"
    :disabled="disabled"
    @input="updateDraft"
    @change="commitDraft"
    @blur="commitDraft"
    @keydown.enter.prevent="commitDraft"
    @compositionstart="composing = true"
    @compositionend="finishComposition"
  />
</template>
