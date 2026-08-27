<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";

import {
  DEFAULT_LABEL_FONT_SIZE,
  type VisualStyle,
  type VisualStyleOverride,
} from "@iriograph/core";

import CommitNumberInput from "./CommitNumberInput.vue";

export type AppearanceEditorValue = {
  styleRef?: string;
  style?: VisualStyleOverride;
};

const props = defineProps<{
  elementKind: "node" | "container" | "region" | "edge";
  selectionCount: number;
  currentStyle: VisualStyle;
  currentStyleRef?: string;
  currentOverride?: VisualStyleOverride;
  presets: Readonly<Record<string, VisualStyleOverride>>;
  inline?: boolean;
}>();

const emit = defineEmits<{
  preview: [value: AppearanceEditorValue];
  commit: [value: AppearanceEditorValue];
  apply: [value: AppearanceEditorValue];
  close: [];
}>();

const styleRef = ref(props.currentStyleRef ?? "");
const style = ref<VisualStyleOverride>({ ...props.currentOverride });
const presetChoices = computed(() => Object.entries(props.presets).map(([presetRef, preset], index) => ({
  presetRef,
  preset,
  label: `プリセット ${index + 1}`,
})));
type StyleField = "fill" | "stroke" | "text" | "accent" | "fillOpacity" | "strokeWidth" | "dash" | "labelFontSize";
type ColorStyleField = Extract<StyleField, "fill" | "stroke" | "text" | "accent">;

const fields = computed<StyleField[]>(() => props.elementKind === "edge"
  ? ["stroke", "text", "strokeWidth", "dash", "labelFontSize"]
  : props.elementKind === "region"
    ? ["fill", "stroke", "text", "accent", "fillOpacity", "strokeWidth", "dash", "labelFontSize"]
    : ["fill", "stroke", "text", "accent", "strokeWidth", "dash", "labelFontSize"]);
const colorFields = computed<ColorStyleField[]>(() => fields.value.filter(
  (field): field is ColorStyleField => ["fill", "stroke", "text", "accent"].includes(field),
));
const colorFieldLabels: Readonly<Record<ColorStyleField, string>> = {
  fill: "塗り色",
  stroke: "線の色",
  text: "文字色",
  accent: "アクセント色",
};

onMounted(emitPreview);
watch([styleRef, style], emitPreview, { deep: true });

function setPreset(refValue: string): void {
  styleRef.value = refValue;
  commitInline();
}

function toggleField(field: StyleField, enabled: boolean): void {
  const next = { ...style.value };
  if (!enabled) delete next[field];
  else if (field === "fillOpacity") next.fillOpacity = props.currentStyle.fillOpacity ?? 1;
  else if (field === "strokeWidth") next.strokeWidth = props.currentStyle.strokeWidth ?? 1;
  else if (field === "labelFontSize") {
    next.labelFontSize = props.currentStyle.labelFontSize ?? DEFAULT_LABEL_FONT_SIZE;
  }
  else if (field === "dash") next.dash = props.currentStyle.dash ?? "6 4";
  else style.value = { ...next, [field]: props.currentStyle[field] ?? "#000000" };
  if (!enabled || field === "fillOpacity" || field === "strokeWidth" || field === "dash" || field === "labelFontSize") {
    style.value = next;
  }
  commitInline();
}

function updateColor(field: "fill" | "stroke" | "text" | "accent", event: Event): void {
  style.value = { ...style.value, [field]: (event.target as HTMLInputElement).value };
}

function updateNumber(field: "fillOpacity" | "strokeWidth" | "labelFontSize", event: Event): void {
  const requested = Number((event.target as HTMLInputElement).value);
  style.value = { ...style.value, [field]: requested };
}

function commitFontSize(value: number): void {
  style.value = { ...style.value, labelFontSize: value };
  commitInline();
}

function updateDash(event: Event): void {
  style.value = { ...style.value, dash: (event.target as HTMLSelectElement).value };
  commitInline();
}

function reset(): void {
  styleRef.value = "";
  style.value = {};
  commitInline();
}

function value(): AppearanceEditorValue {
  return {
    ...(styleRef.value ? { styleRef: styleRef.value } : {}),
    ...(Object.keys(style.value).length ? { style: { ...style.value } } : {}),
  };
}

function emitPreview(): void {
  emit("preview", value());
}

function commitInline(): void {
  if (props.inline) emit("commit", value());
}
</script>

<template>
  <section class="iriograph-appearance-editor" :class="{ inline }" aria-label="ビューを編集">
    <header><div><small>ビュースタイル</small><strong>スタイルを調整</strong></div><button v-if="!inline" type="button" aria-label="閉じる" @click="emit('close')">×</button></header>
    <p v-if="selectionCount > 1">選択中の{{ selectionCount }}要素へ同じ設定を適用します。</p>
    <div v-if="presetChoices.length" class="iriograph-style-presets" role="radiogroup" aria-label="スタイル候補">
      <button type="button" :aria-pressed="!styleRef" @click="setPreset('')">既定</button>
      <button v-for="choice in presetChoices" :key="choice.presetRef" type="button" :aria-pressed="styleRef === choice.presetRef" @click="setPreset(choice.presetRef)"><span :style="{ background: choice.preset.fill ?? currentStyle.fill, borderColor: choice.preset.stroke ?? currentStyle.stroke }" />{{ choice.label }}</button>
    </div>
    <div class="iriograph-appearance-fields">
      <label v-for="field in colorFields" :key="field"><input type="checkbox" :checked="style[field] !== undefined" @change="toggleField(field, ($event.target as HTMLInputElement).checked)" /><span>{{ colorFieldLabels[field] }}</span><input type="color" :aria-label="colorFieldLabels[field]" :value="style[field] ?? currentStyle[field] ?? '#000000'" :disabled="style[field] === undefined" @input="updateColor(field, $event)" @change="commitInline" /></label>
      <label v-if="fields.includes('fillOpacity')"><input type="checkbox" :checked="style.fillOpacity !== undefined" @change="toggleField('fillOpacity', ($event.target as HTMLInputElement).checked)" /><span>領域の透明度</span><input type="range" min="0" max="1" step="0.05" :value="style.fillOpacity ?? currentStyle.fillOpacity ?? 1" :disabled="style.fillOpacity === undefined" @input="updateNumber('fillOpacity', $event)" @change="commitInline" /></label>
      <label v-if="fields.includes('strokeWidth')"><input type="checkbox" :checked="style.strokeWidth !== undefined" @change="toggleField('strokeWidth', ($event.target as HTMLInputElement).checked)" /><span>線の太さ</span><input type="number" min="0" max="20" step="0.5" :value="style.strokeWidth ?? currentStyle.strokeWidth ?? 1" :disabled="style.strokeWidth === undefined" @input="updateNumber('strokeWidth', $event)" @change="commitInline" /></label>
      <label><input type="checkbox" :checked="style.labelFontSize !== undefined" @change="toggleField('labelFontSize', ($event.target as HTMLInputElement).checked)" /><span>文字サイズ</span><CommitNumberInput label="文字サイズ" :value="style.labelFontSize ?? currentStyle.labelFontSize ?? DEFAULT_LABEL_FONT_SIZE" :minimum="8" :maximum="72" :step="1" :disabled="style.labelFontSize === undefined" @commit="commitFontSize" /></label>
      <label v-if="fields.includes('dash')"><input type="checkbox" :checked="style.dash !== undefined" @change="toggleField('dash', ($event.target as HTMLInputElement).checked)" /><span>線種</span><select :value="style.dash ?? currentStyle.dash ?? '6 4'" :disabled="style.dash === undefined" @change="updateDash"><option value="0">実線</option><option value="6 4">破線</option><option value="2 3">点線</option><option value="10 4 2 4">一点鎖線</option></select></label>
    </div>
    <footer><button type="button" @click="reset">カタログ既定へ戻す</button><template v-if="!inline"><button type="button" @click="emit('close')">キャンセル</button><button type="button" class="primary" @click="emit('apply', value())">適用</button></template></footer>
  </section>
</template>
