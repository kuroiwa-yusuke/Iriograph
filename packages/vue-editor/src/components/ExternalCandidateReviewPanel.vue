<script setup lang="ts">
import { computed, inject, onBeforeUnmount, ref, watch } from "vue";
import type {
  ExternalCandidateReview,
  PresentationCandidateReview,
  SemanticReview,
} from "@iriograph/agent-bridge";
import {
  editorLocalizationKey,
  translateEditorMessage,
  type EditorLocale,
} from "../localization/editor-localization";

const props = withDefaults(defineProps<{
  review: ExternalCandidateReview;
  /** Used when this public panel is mounted outside IriographEditor. */
  uiLocale?: EditorLocale;
}>(), { uiLocale: "en" });
const emit = defineEmits<{
  apply: [request: { reviewId: string; kind: "semantic" | "presentation" }];
  reject: [request: { reviewId: string; kind: "semantic" | "presentation" }];
}>();
const localization = inject(editorLocalizationKey, undefined);
const t = localization?.t ?? ((key, parameters) => translateEditorMessage(props.uiLocale, key, parameters));

const screenshotUrl = ref<string>();
watch(
  () => props.review.presentation?.screenshot,
  (screenshot) => {
    if (screenshotUrl.value) URL.revokeObjectURL(screenshotUrl.value);
    screenshotUrl.value = screenshot
      ? URL.createObjectURL(new Blob([screenshot.bytes.slice().buffer], { type: screenshot.mediaType }))
      : undefined;
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  if (screenshotUrl.value) URL.revokeObjectURL(screenshotUrl.value);
});

const sourceLabel = computed(() => t(props.review.source === "llm" ? "review.source.ai" : "review.source.external"));

function apply(kind: "semantic" | "presentation"): void {
  emit("apply", { reviewId: props.review.reviewId, kind });
}

function reject(kind: "semantic" | "presentation"): void {
  emit("reject", { reviewId: props.review.reviewId, kind });
}

function semanticSummary(candidate: SemanticReview): string {
  return t("review.semanticSummary", {
    added: candidate.added.length,
    removed: candidate.removed.length,
  });
}

function presentationSummary(candidate: PresentationCandidateReview): string {
  return t("review.presentationSummary", { count: candidate.changedElementLabels.length });
}
</script>

<template>
  <section class="iriograph-external-review" :aria-label="t('review.aria')">
    <header>
      <p class="iriograph-eyebrow">{{ sourceLabel }}</p>
      <h3>{{ t("review.title") }}</h3>
      <p>{{ t("review.description") }}</p>
    </header>

    <article v-if="review.semantic" class="iriograph-review-section" data-review-kind="semantic">
      <header>
        <div>
          <p class="iriograph-eyebrow">{{ t("common.semantic") }}</p>
          <h4>{{ semanticSummary(review.semantic) }}</h4>
        </div>
        <div class="iriograph-review-actions">
          <button type="button" @click="reject('semantic')">{{ t("review.reject") }}</button>
          <button type="button" class="is-primary" @click="apply('semantic')">{{ t("review.acceptSemantic") }}</button>
        </div>
      </header>
      <div v-if="review.semantic.added.length" class="iriograph-review-change-list">
        <p>{{ t("review.added") }}</p>
        <p v-for="change in review.semantic.added" :key="`add-${change.statementId}`">
          <strong>{{ change.subject }}</strong>
          <span>{{ change.predicate }}</span>
          <strong>{{ change.object }}</strong>
        </p>
      </div>
      <div v-if="review.semantic.removed.length" class="iriograph-review-change-list is-removed">
        <p>{{ t("review.removed") }}</p>
        <p v-for="change in review.semantic.removed" :key="`remove-${change.statementId}`">
          <strong>{{ change.subject }}</strong>
          <span>{{ change.predicate }}</span>
          <strong>{{ change.object }}</strong>
        </p>
      </div>
    </article>

    <article v-if="review.presentation" class="iriograph-review-section" data-review-kind="presentation">
      <header>
        <div>
          <p class="iriograph-eyebrow">{{ t("common.view") }}</p>
          <h4>{{ presentationSummary(review.presentation) }}</h4>
        </div>
        <div class="iriograph-review-actions">
          <button type="button" @click="reject('presentation')">{{ t("review.reject") }}</button>
          <button type="button" class="is-primary" @click="apply('presentation')">{{ t("review.acceptView") }}</button>
        </div>
      </header>
      <img v-if="screenshotUrl" :src="screenshotUrl" :alt="t('review.screenshotAlt')">
      <ul>
        <li v-for="label in review.presentation.changedElementLabels" :key="label">{{ label }}</li>
      </ul>
      <p v-if="review.presentation.diagnostics.length" role="status">
        {{ t("review.validationCount", { count: review.presentation.diagnostics.length }) }}
      </p>
    </article>
  </section>
</template>
