<script lang="ts">
import type {
  StructuredAuthoringPresentation,
  StructuredLocalizedTextPresentation,
  StructuredMembershipPresentation,
  StructuredGroupKind,
} from "@iriograph/core";

export type StructuredElementDetailsTextChange =
  | {
      operation: "update";
      field: "label" | "comment";
      valueId: string;
      value: string;
    }
  | {
      operation: "add";
      field: "label" | "comment";
      value: string;
    }
  | {
      operation: "remove";
      field: "label" | "comment";
      valueId: string;
    };

export type StructuredElementDetailsSave = {
  text: readonly StructuredElementDetailsTextChange[];
  nodeRoleIds?: readonly string[];
  groupKind?: StructuredGroupKind;
  removeMembershipIds?: readonly string[];
};

export type StructuredElementDetailsMembership = StructuredMembershipPresentation["items"][number];
</script>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, useId } from "vue";
import { useEditorLocalization } from "../localization/editor-localization";

const props = defineProps<{
  title: string;
  fields: StructuredLocalizedTextPresentation["fields"];
  nodeRoles: StructuredAuthoringPresentation["profile"]["nodeRoles"];
  selectedNodeRoleIds?: readonly string[];
  groupKinds?: StructuredAuthoringPresentation["groupKinds"];
  currentGroupKind?: StructuredGroupKind;
  memberships?: readonly StructuredElementDetailsMembership[];
  busy?: boolean;
}>();

const emit = defineEmits<{
  save: [value: StructuredElementDetailsSave];
  focusElement: [elementId: string];
  editMembership: [groupElementId: string];
  close: [];
}>();
const { t } = useEditorLocalization();

type AddedText = {
  draftId: string;
  field: "label" | "comment";
  value: string;
};

const dialog = ref<HTMLElement>();
const titleId = `${useId()}-title`;
const values = ref(Object.fromEntries(props.fields.flatMap((field) => field.values.map((value) => [
  value.valueId,
  value.value,
]))));
const removedValueIds = ref<string[]>([]);
const addedText = ref<AddedText[]>([]);
const roles = ref([...(props.selectedNodeRoleIds ?? [])]);
const groupKind = ref<StructuredGroupKind | undefined>(props.currentGroupKind);
const removeMembershipIds = ref<string[]>([]);
let nextDraftId = 1;

const existingTextChanges = computed<StructuredElementDetailsTextChange[]>(() => {
  const changes: StructuredElementDetailsTextChange[] = [];
  for (const field of props.fields) {
    for (const value of field.values) {
      if (removedValueIds.value.includes(value.valueId)) {
        changes.push({ operation: "remove", field: field.field, valueId: value.valueId });
      } else if (values.value[value.valueId] !== value.value) {
        changes.push({
          operation: "update",
          field: field.field,
          valueId: value.valueId,
          value: values.value[value.valueId] ?? "",
        });
      }
    }
  }
  return changes;
});
const addedTextChanges = computed<StructuredElementDetailsTextChange[]>(() => addedText.value.map((item) => ({
  operation: "add" as const,
  field: item.field,
  value: item.value,
})));
const addedTextInvalid = computed(() => addedText.value.some((item) => !item.value.trim()));
const textChanges = computed(() => {
  const existingUpdates = existingTextChanges.value.filter((item) => item.operation === "update");
  const existingRemovals = existingTextChanges.value.filter((item) => item.operation === "remove");
  // The Core validates each request against the result of the previous request.
  // Add a replacement label before removing the old final label so that a valid
  // atomic batch never has a transient label-less document.
  return [...existingUpdates, ...addedTextChanges.value, ...existingRemovals];
});
const rolesChanged = computed(() => (
  [...roles.value].sort().join("\u0000") !== [...(props.selectedNodeRoleIds ?? [])].sort().join("\u0000")
));
const groupKindChanged = computed(() => Boolean(
  props.currentGroupKind && groupKind.value && props.currentGroupKind !== groupKind.value,
));
const containedMemberships = computed(() => (props.memberships ?? []).filter((item) => item.direction === "contains"));
const belongsToMemberships = computed(() => (props.memberships ?? []).filter((item) => item.direction === "belongs-to"));
const groupHasMembers = computed(() => containedMemberships.value.length > 0);
const hasChanges = computed(() => (
  textChanges.value.length > 0
  || rolesChanged.value
  || groupKindChanged.value
  || removeMembershipIds.value.length > 0
));

onMounted(() => void nextTick(() => dialog.value?.querySelector<HTMLElement>(
  "textarea:not([disabled]), input:not([disabled]), select:not([disabled]), button.primary:not([disabled])",
)?.focus()));

function toggleRole(roleId: string): void {
  roles.value = roles.value.includes(roleId)
    ? roles.value.filter((candidate) => candidate !== roleId)
    : [...roles.value, roleId];
}

function localeLabel(kind: "default" | "translation" | "untagged" | "typed"): string {
  return {
    default: t("details.primary"),
    translation: t("details.translation"),
    untagged: t("details.untagged"),
    typed: t("details.typed"),
  }[kind];
}

function addText(field: "label" | "comment"): void {
  addedText.value.push({ draftId: `new-text-${nextDraftId++}`, field, value: "" });
  void nextTick(() => dialog.value?.querySelector<HTMLTextAreaElement>(`[data-new-text="${addedText.value.at(-1)?.draftId}"]`)?.focus());
}

function discardAddedText(draftId: string): void {
  addedText.value = addedText.value.filter((item) => item.draftId !== draftId);
}

function toggleExistingTextRemoval(valueId: string): void {
  removedValueIds.value = removedValueIds.value.includes(valueId)
    ? removedValueIds.value.filter((candidate) => candidate !== valueId)
    : [...removedValueIds.value, valueId];
}

function canRemoveExistingLabel(valueId: string): boolean {
  const remainingExisting = props.fields.find((field) => field.field === "label")?.values
    .filter((value) => value.valueId !== valueId && !removedValueIds.value.includes(value.valueId)).length ?? 0;
  const remainingAdded = addedText.value.filter((item) => item.field === "label").length;
  return remainingExisting + remainingAdded > 0;
}

function groupKindLabel(kind: StructuredGroupKind): string {
  return props.groupKinds?.find((candidate) => candidate.groupKind === kind)?.label ?? kind;
}

function fieldLabel(field: "label" | "comment"): string {
  return t(field === "label" ? "common.name" : "common.description");
}

function membershipRoleLabel(item: StructuredElementDetailsMembership): string {
  if (item.role === "sequence-member") return t("details.sequenceOrdinal", { ordinal: item.ordinal ?? "?" });
  if (item.role === "alternative-member") return t("details.alternativeOrdinal", { ordinal: item.ordinal ?? "?" });
  return t(item.direction === "contains" ? "details.containedElements" : "details.belongsToGroups");
}

function submit(): void {
  if (addedTextInvalid.value || !hasChanges.value) return;
  emit("save", {
    text: textChanges.value,
    ...(rolesChanged.value ? { nodeRoleIds: [...roles.value] } : {}),
    ...(groupKindChanged.value ? { groupKind: groupKind.value } : {}),
    ...(removeMembershipIds.value.length ? { removeMembershipIds: [...removeMembershipIds.value] } : {}),
  });
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.key !== "Escape") return;
  event.preventDefault();
  emit("close");
}
</script>

<template>
  <div class="iriograph-modal-backdrop" role="presentation" @click.self="emit('close')">
    <section ref="dialog" class="iriograph-resource-details-dialog iriograph-structured-details-dialog" role="dialog" aria-modal="true" :aria-labelledby="titleId" @keydown="handleKeydown">
      <header><div><small>{{ t("details.eyebrow") }}</small><strong :id="titleId">{{ title }}</strong></div><button type="button" :aria-label="t('common.close')" @click="emit('close')">×</button></header>
      <p>{{ t("details.description") }}</p>
      <section v-for="field in fields" :key="field.field" class="iriograph-property-section">
        <header><div><strong>{{ fieldLabel(field.field) }}</strong><small>{{ t("common.itemCount", { count: field.values.length + addedText.filter((item) => item.field === field.field).length }) }}</small></div></header>
        <p v-if="field.values.length === 0 && !addedText.some((item) => item.field === field.field)" class="iriograph-property-empty">{{ t("details.empty") }}</p>
        <label v-for="value in field.values" :key="value.valueId" :class="{ 'iriograph-pending-removal': removedValueIds.includes(value.valueId) }">
          <span>{{ localeLabel(value.localeKind) }}</span>
          <textarea v-model="values[value.valueId]" :disabled="removedValueIds.includes(value.valueId)" :rows="field.field === 'comment' ? 4 : 2" />
          <button type="button" :disabled="field.field === 'label' && !removedValueIds.includes(value.valueId) && !canRemoveExistingLabel(value.valueId)" @click="toggleExistingTextRemoval(value.valueId)">{{ removedValueIds.includes(value.valueId) ? t('details.undoDelete') : t('common.delete') }}</button>
        </label>
        <label v-for="item in addedText.filter((candidate) => candidate.field === field.field)" :key="item.draftId">
          <span>{{ field.field === 'label' ? t('details.newAlias') : t('details.newDescription') }}</span>
          <textarea v-model="item.value" :data-new-text="item.draftId" :rows="field.field === 'comment' ? 4 : 2" />
          <button type="button" @click="discardAddedText(item.draftId)">{{ t("details.cancelAdd") }}</button>
        </label>
        <button type="button" @click="addText(field.field)">{{ field.field === 'label' && field.values.length ? t('details.addAlias') : t('details.addField', { field: fieldLabel(field.field) }) }}</button>
      </section>
      <section v-if="nodeRoles.length && !currentGroupKind" class="iriograph-property-section">
        <header><div><strong>{{ t("details.elementTypes") }}</strong><small>{{ t("details.multiple") }}</small></div></header>
        <div role="group" :aria-label="t('details.elementTypes')">
          <button v-for="(role, index) in nodeRoles" :key="`node-role-${index}`" type="button" :aria-pressed="roles.includes(role.roleId)" @click="toggleRole(role.roleId)"><strong>{{ role.label }}</strong><small v-if="role.description">{{ role.description }}</small></button>
        </div>
      </section>
      <section v-if="currentGroupKind" class="iriograph-property-section">
        <header><div><strong>{{ t("details.groupType") }}</strong><small>{{ t("details.current", { value: groupKindLabel(currentGroupKind) }) }}</small></div></header>
        <p v-if="groupHasMembers">{{ t("details.groupTypeLocked") }}</p>
        <div v-else role="radiogroup" :aria-label="t('details.groupType')">
          <label v-for="option in groupKinds ?? []" :key="option.groupKind"><input v-model="groupKind" type="radio" :value="option.groupKind" :disabled="!option.enabled" /><span><strong>{{ option.label }}</strong><small>{{ option.disabledReason ?? option.description }}</small></span></label>
        </div>
        <button v-if="groupHasMembers" type="button" @click="emit('editMembership', containedMemberships[0]?.groupElementId ?? '')">{{ t("details.editMembershipOrder") }}</button>
      </section>
      <section v-if="memberships?.length" class="iriograph-property-section iriograph-structured-memberships">
        <header><div><strong>{{ t(currentGroupKind ? 'details.containedElements' : 'details.belongsToGroups') }}</strong><small>{{ t("common.itemCount", { count: memberships.length }) }}</small></div></header>
        <ul>
          <li v-for="item in memberships" :key="item.membershipId">
            <label v-if="item.removable"><input v-model="removeMembershipIds" type="checkbox" :value="item.membershipId" /><span>{{ item.relatedLabel }}</span></label>
            <span v-else>{{ item.relatedLabel }}</span>
            <small>{{ membershipRoleLabel(item) }}<template v-if="item.disabledReason">・{{ item.disabledReason }}</template></small>
            <button type="button" @click="emit('focusElement', item.relatedElementId)">{{ t("details.focusCanvas") }}</button>
            <button v-if="!item.removable" type="button" @click="emit('editMembership', item.groupElementId)">{{ t("details.openDedicatedEditor") }}</button>
          </li>
        </ul>
        <p v-if="removeMembershipIds.length">{{ t("details.pendingMembershipRemoval", { count: removeMembershipIds.length }) }}</p>
      </section>
      <footer><button type="button" @click="emit('close')">{{ t("common.cancel") }}</button><button type="button" class="primary" :disabled="busy || addedTextInvalid || !hasChanges" @click="submit">{{ busy ? t('common.saving') : t('details.saveChanges') }}</button></footer>
    </section>
  </div>
</template>
