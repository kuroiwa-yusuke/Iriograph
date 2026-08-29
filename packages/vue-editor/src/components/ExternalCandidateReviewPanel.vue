<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import type {
  ExternalCandidateReview,
  PresentationCandidateReview,
  SemanticReview,
} from "@iriograph/agent-bridge";

const props = defineProps<{ review: ExternalCandidateReview }>();
const emit = defineEmits<{
  apply: [request: { reviewId: string; kind: "semantic" | "presentation" }];
  reject: [request: { reviewId: string; kind: "semantic" | "presentation" }];
}>();

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

const sourceLabel = computed(() => props.review.source === "llm" ? "AI候補" : "外部候補");

function apply(kind: "semantic" | "presentation"): void {
  emit("apply", { reviewId: props.review.reviewId, kind });
}

function reject(kind: "semantic" | "presentation"): void {
  emit("reject", { reviewId: props.review.reviewId, kind });
}

function semanticSummary(candidate: SemanticReview): string {
  return `追加 ${candidate.added.length}件・削除 ${candidate.removed.length}件`;
}

function presentationSummary(candidate: PresentationCandidateReview): string {
  return `表示変更 ${candidate.changedElementLabels.length}件`;
}
</script>

<template>
  <section class="iriograph-external-review" aria-label="外部候補の確認">
    <header>
      <p class="iriograph-eyebrow">{{ sourceLabel }}</p>
      <h3>意味とビューを別々に確認</h3>
      <p>必要な方だけ採用できます。通常のCanvas編集にはこの確認は表示されません。</p>
    </header>

    <article v-if="review.semantic" class="iriograph-review-section" data-review-kind="semantic">
      <header>
        <div>
          <p class="iriograph-eyebrow">意味</p>
          <h4>{{ semanticSummary(review.semantic) }}</h4>
        </div>
        <div class="iriograph-review-actions">
          <button type="button" @click="reject('semantic')">却下</button>
          <button type="button" class="is-primary" @click="apply('semantic')">意味だけ採用</button>
        </div>
      </header>
      <div v-if="review.semantic.added.length" class="iriograph-review-change-list">
        <p>追加</p>
        <p v-for="change in review.semantic.added" :key="`add-${change.statementId}`">
          <strong>{{ change.subject }}</strong>
          <span>{{ change.predicate }}</span>
          <strong>{{ change.object }}</strong>
        </p>
      </div>
      <div v-if="review.semantic.removed.length" class="iriograph-review-change-list is-removed">
        <p>削除</p>
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
          <p class="iriograph-eyebrow">ビュー</p>
          <h4>{{ presentationSummary(review.presentation) }}</h4>
        </div>
        <div class="iriograph-review-actions">
          <button type="button" @click="reject('presentation')">却下</button>
          <button type="button" class="is-primary" @click="apply('presentation')">ビューだけ採用</button>
        </div>
      </header>
      <img v-if="screenshotUrl" :src="screenshotUrl" alt="候補を適用した図のプレビュー">
      <ul>
        <li v-for="label in review.presentation.changedElementLabels" :key="label">{{ label }}</li>
      </ul>
      <p v-if="review.presentation.diagnostics.length" role="status">
        検証結果 {{ review.presentation.diagnostics.length }}件
      </p>
    </article>
  </section>
</template>
