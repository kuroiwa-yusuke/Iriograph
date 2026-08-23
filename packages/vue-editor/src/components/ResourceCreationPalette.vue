<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from "vue";

import type { Point } from "@iriograph/core";

import {
  emptyAuthoringDraft,
  type AuthoringChoice,
  type AuthoringStructureChoice,
  type EditorAuthoringDraft,
} from "../authoring-draft";
import type { CreationPaletteCard } from "../creation-palette";

const props = defineProps<{
  kind: "node" | "region";
  cards: readonly CreationPaletteCard[];
  resources: readonly AuthoringChoice[];
  predicates: readonly AuthoringChoice[];
  memberships: readonly AuthoringStructureChoice[];
  position?: Point;
  containerIri?: string;
}>();

const emit = defineEmits<{
  seed: [draft: EditorAuthoringDraft];
  close: [];
}>();

const dialog = ref<HTMLElement>();
const label = ref("");
const selectedTemplateRef = ref("");
const resourceIri = ref("");
const classIri = ref("");
const relationEnabled = ref(false);
const relationDirection = ref<"outgoing" | "incoming">("outgoing");
const relationPredicateIri = ref("");
const relationResourceIri = ref("");
const membershipEnabled = ref(Boolean(props.containerIri));
const membershipContainerIri = ref(props.containerIri ?? "");
const membershipKey = ref(props.memberships.length === 1 ? props.memberships[0]?.key ?? "" : "");
const availableCards = computed(() => props.cards.filter((card) => card.kind === props.kind));
const selectedCard = computed(() => availableCards.value.find((card) => (
  card.templateRef === selectedTemplateRef.value
)) ?? availableCards.value[0]);

onMounted(() => {
  selectedTemplateRef.value = availableCards.value[0]?.templateRef ?? "";
  classIri.value = availableCards.value[0]?.classIri ?? "";
  relationPredicateIri.value = props.predicates.length === 1 ? props.predicates[0]?.iri ?? "" : "";
  void nextTick(() => dialog.value?.querySelector<HTMLInputElement>("input")?.focus());
});

function choose(card: CreationPaletteCard): void {
  selectedTemplateRef.value = card.templateRef;
  classIri.value = card.classIri ?? "";
}

function submit(): void {
  const card = selectedCard.value;
  const draft = emptyAuthoringDraft("create-resource");
  draft.label = label.value;
  draft.resourceIri = resourceIri.value;
  draft.classIri = classIri.value;
  draft.createTemplateRef = card?.templateRef ?? "";
  draft.createStructuralKind = card?.structuralKind ?? "node";
  if (props.position && card) {
    draft.initialX = String(Math.round(props.position.x - card.size.width / 2));
    draft.initialY = String(Math.round(props.position.y - card.size.height / 2));
  }
  if (relationEnabled.value) {
    draft.createEdgeEnabled = true;
    draft.createEdgeDirection = relationDirection.value;
    draft.createEdgePredicateIri = relationPredicateIri.value;
    draft.createEdgeResourceIri = relationResourceIri.value;
  }
  if (membershipEnabled.value) {
    const membership = props.memberships.find((item) => item.key === membershipKey.value);
    draft.createMembershipEnabled = true;
    draft.createMembershipContainerIri = membershipContainerIri.value;
    draft.createMembershipStructureConfigKey = membership?.key ?? "";
    draft.createMembershipContainerTypeIri = membership?.typeIri ?? "";
    draft.createMembershipPredicateIri = membership?.predicateIri ?? "";
  }
  emit("seed", draft);
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
    <section ref="dialog" class="iriograph-resource-palette" role="dialog" aria-modal="true" aria-labelledby="iriograph-palette-title" @keydown="handleKeydown">
      <header><div><small>NEW {{ kind === 'node' ? 'ELEMENT' : 'REGION' }}</small><strong id="iriograph-palette-title">見た目から選んで追加</strong></div><button type="button" aria-label="閉じる" @click="emit('close')">×</button></header>
      <label><span>名前</span><input v-model="label" aria-label="新しい要素の名前" /></label>
      <div class="iriograph-palette-cards" role="radiogroup" aria-label="表示テンプレート">
        <button v-for="card in availableCards" :key="`${card.templateRef}:${card.classIri}`" type="button" role="radio" :aria-checked="selectedCard === card" :class="{ selected: selectedCard === card }" @click="choose(card)">
          <span class="iriograph-palette-card-preview" :class="`shape-${card.shape}`" :style="{ background: card.style.fill, borderColor: card.style.stroke, color: card.style.text, opacity: card.style.fillOpacity ?? 1 }"><span v-if="card.iconRef">◇</span></span>
          <b>{{ card.label }}</b><small>{{ card.description }}</small>
        </button>
      </div>
      <p v-if="availableCards.length === 0" role="alert">この図では作成可能な{{ kind === 'node' ? '要素' : '領域' }}が定義されていません。</p>
      <p v-if="position">配置位置: {{ Math.round(position.x) }}, {{ Math.round(position.y) }}</p>
      <fieldset><legend>関係も同時に作る（任意）</legend><label><input v-model="relationEnabled" type="checkbox" />既存要素とつなぐ</label><template v-if="relationEnabled"><label><span>向き</span><select v-model="relationDirection"><option value="outgoing">新しい要素 → 相手</option><option value="incoming">相手 → 新しい要素</option></select></label><label><span>関係</span><select v-model="relationPredicateIri"><option value="">選択してください</option><option v-for="item in predicates" :key="item.iri" :value="item.iri" :title="item.iri">{{ item.label ?? item.iri }}</option></select></label><label><span>相手</span><select v-model="relationResourceIri"><option value="">選択してください</option><option v-for="item in resources" :key="item.iri" :value="item.iri" :title="item.iri">{{ item.label ?? item.iri }}</option></select></label></template></fieldset>
      <fieldset><legend>領域へ含める（任意）</legend><label><input v-model="membershipEnabled" type="checkbox" />意味上の包含も作る</label><template v-if="membershipEnabled"><label><span>領域</span><select v-model="membershipContainerIri"><option value="">選択してください</option><option v-for="item in resources" :key="item.iri" :value="item.iri" :title="item.iri">{{ item.label ?? item.iri }}</option></select></label><label><span>包含方法</span><select v-model="membershipKey"><option value="">選択してください</option><option v-for="item in memberships" :key="item.key" :value="item.key">{{ item.label }}</option></select></label></template></fieldset>
      <details><summary>Advanced: Class / IRI</summary><label><span>Class IRI</span><input v-model="classIri" /></label><label><span>要素の IRI（空欄で採番）</span><input v-model="resourceIri" /></label></details>
      <footer><button type="button" @click="emit('close')">キャンセル</button><button type="button" class="primary" :disabled="!label.trim() || !selectedCard" @click="submit">作成内容を確認へ</button></footer>
    </section>
  </div>
</template>
