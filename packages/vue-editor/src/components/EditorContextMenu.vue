<script setup lang="ts">
import { nextTick, onMounted, ref } from "vue";

import type { EditorContextAction, EditorContextActionId } from "../context-actions";

const props = defineProps<{
  actions: readonly EditorContextAction[];
  x: number;
  y: number;
}>();

const emit = defineEmits<{
  select: [actionId: EditorContextActionId];
  close: [];
}>();

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
</script>

<template>
  <div class="iriograph-context-menu-shield" role="presentation" @pointerdown.self="emit('close')" @contextmenu.prevent>
    <nav
      ref="menu"
      class="iriograph-context-menu"
      role="menu"
      tabindex="-1"
      aria-label="選択対象の操作"
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
        @focus="activeIndex = index"
        @click="emit('select', action.id)"
      >{{ action.label }}</button>
    </nav>
  </div>
</template>
