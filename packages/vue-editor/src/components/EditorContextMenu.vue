<script setup lang="ts">
import { nextTick, onMounted, ref } from "vue";

import type { EditorContextAction, EditorContextActionId } from "../inspector/context-actions";
import { useEditorLocalization } from "../localization/editor-localization";

const props = defineProps<{
  actions: readonly EditorContextAction[];
  x: number;
  y: number;
}>();

const emit = defineEmits<{
  select: [actionId: EditorContextActionId];
  close: [];
}>();
const { t } = useEditorLocalization();

const menu = ref<HTMLElement>();
const activeIndex = ref(-1);

onMounted(() => {
  activeIndex.value = firstEnabledIndex();
  void nextTick(focusActive);
});

function handleKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    emit("close");
    return;
  }
  if (event.key === "Tab") {
    emit("close");
    return;
  }
  if (event.key === "Home" || event.key === "End") {
    event.preventDefault();
    activeIndex.value = event.key === "Home" ? firstEnabledIndex() : lastEnabledIndex();
    focusActive();
    return;
  }
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    move(event.key === "ArrowDown" ? 1 : -1);
    return;
  }
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    const action = props.actions[activeIndex.value];
    if (action && !action.disabled) emit("select", action.id);
  }
}

function move(delta: number): void {
  if (props.actions.length === 0) return;
  let index = activeIndex.value;
  for (let count = 0; count < props.actions.length; count += 1) {
    index = (index + delta + props.actions.length) % props.actions.length;
    if (!props.actions[index]?.disabled) {
      activeIndex.value = index;
      focusActive();
      return;
    }
  }
}

function firstEnabledIndex(): number {
  return props.actions.findIndex((action) => !action.disabled);
}

function lastEnabledIndex(): number {
  for (let index = props.actions.length - 1; index >= 0; index -= 1) {
    if (!props.actions[index]?.disabled) return index;
  }
  return -1;
}

function focusActive(): void {
  const target = activeIndex.value >= 0
    ? menu.value?.querySelectorAll<HTMLButtonElement>("[role='menuitem']")[activeIndex.value]
    : undefined;
  (target ?? menu.value)?.focus();
}

function iconGlyph(token?: string): string {
  if (!token) return "";
  const glyphs: Record<string, string> = {
    add: "+", paste: "▣", details: "i", relation: "→", membership: "⊂",
    view: "◇", icon: "◆", reconnect: "↝", line: "⌁", reset: "↺",
    sequence: "1·2", alternatives: "◇", fit: "↔", forward: "↑",
    backward: "↓", collapse: "⊟", expand: "⊞", delete: "×",
  };
  return glyphs[token] ?? "•";
}
</script>

<template>
  <div class="iriograph-context-menu-shield" role="presentation" @pointerdown.self="emit('close')" @contextmenu.prevent>
    <nav
      ref="menu"
      class="iriograph-context-menu"
      role="menu"
      tabindex="-1"
      :aria-label="t('contextMenu.aria')"
      :style="{ left: `${x}px`, top: `${y}px` }"
      @keydown="handleKeydown"
    >
      <button
        v-for="(action, index) in actions"
        :key="action.id"
        type="button"
        role="menuitem"
        :tabindex="index === activeIndex ? 0 : -1"
        :class="{ destructive: action.destructive }"
        :disabled="action.disabled"
        :aria-disabled="action.disabled ? 'true' : undefined"
        :aria-describedby="action.disabledReason ? `context-action-reason-${index}` : undefined"
        @focus="activeIndex = index"
        @click="emit('select', action.id)"
      >
        <span v-if="action.iconToken" class="iriograph-context-menu-icon" :data-icon-token="action.iconToken" aria-hidden="true">{{ iconGlyph(action.iconToken) }}</span>
        <span class="iriograph-context-menu-copy">
          <span>{{ action.label }}</span>
          <small v-if="action.disabledReason" :id="`context-action-reason-${index}`">{{ action.disabledReason }}</small>
        </span>
      </button>
    </nav>
  </div>
</template>

<style scoped>
.iriograph-context-menu button[role="menuitem"] {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 0.45rem;
}

.iriograph-context-menu-icon {
  display: inline-grid;
  place-items: center;
  min-width: 1.6rem;
  min-height: 1.6rem;
  border-radius: 0.3rem;
  background: rgb(37 112 101 / 10%);
  font-size: 0.72rem;
  font-weight: 700;
}

.iriograph-context-menu-copy {
  display: grid;
  min-width: 0;
  text-align: left;
}

.iriograph-context-menu-copy small {
  line-height: 1.25;
  opacity: 0.78;
}
</style>
