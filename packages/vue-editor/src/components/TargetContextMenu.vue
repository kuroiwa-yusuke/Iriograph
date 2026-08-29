<script setup lang="ts">
import { computed, nextTick } from "vue";

import type { EditorContextAction } from "../inspector/context-actions";
import type {
  TargetContextDestination,
  TargetContextMenuEntry,
  TargetContextMenuSession,
} from "../inspector/target-context-menu";
import EditorContextMenu from "./EditorContextMenu.vue";

const props = defineProps<{
  entries: readonly TargetContextMenuEntry[];
  session: TargetContextMenuSession;
}>();

const emit = defineEmits<{
  select: [destination: TargetContextDestination, actionId: TargetContextMenuEntry["actionId"]];
  close: [focusReturnId?: string];
}>();

const actions = computed<EditorContextAction[]>(() => props.entries.map((entry) => ({
  id: entry.actionId,
  label: entry.label,
  destructive: entry.destructive,
  disabled: Boolean(entry.disabledReason),
  disabledReason: entry.disabledReason,
  iconToken: entry.iconToken,
})));

function select(actionId: string): void {
  const entry = props.entries.find((candidate) => candidate.actionId === actionId);
  if (!entry || entry.disabledReason) return;
  emit("select", { ...entry.destination }, entry.actionId);
}

function close(): void {
  emit("close", props.session.focusReturnId);
  returnFocus();
}

function returnFocus(): void {
  const focusReturnId = props.session.focusReturnId;
  if (!focusReturnId) return;
  void nextTick(() => document.getElementById(focusReturnId)?.focus());
}
</script>

<template>
  <EditorContextMenu
    v-if="session.open"
    :actions="actions"
    :x="session.anchor.clientX"
    :y="session.anchor.clientY"
    @select="select"
    @close="close"
  />
</template>
