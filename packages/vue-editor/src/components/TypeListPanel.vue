<script setup lang="ts">
import { computed, ref, watch } from "vue";

import {
  typeSystemTreeRows,
  validateProposedTypeParents,
  type TypeSystemAction,
  type TypeSystemFocus,
  type TypeSystemPresentation,
  type TypeSystemShowInDiagramRequest,
} from "../authoring/type-system";
import { useEditorLocalization } from "../localization/editor-localization";

const props = withDefaults(defineProps<{
  presentation: TypeSystemPresentation;
  focus?: TypeSystemFocus;
  readonly?: boolean;
}>(), {
  focus: undefined,
  readonly: false,
});

const emit = defineEmits<{
  action: [action: TypeSystemAction];
  "show-in-diagram": [request: TypeSystemShowInDiagramRequest];
}>();
const { locale, t } = useEditorLocalization();

const search = ref("");
const resourceSearch = ref("");
const selectedTypeId = ref(props.focus?.typeId ?? props.presentation.types[0]?.typeId ?? "");
const scope = ref<"direct" | "direct-and-inherited">("direct");
const selectedResourceIds = ref<string[]>(props.focus?.resourceId ? [props.focus.resourceId] : []);
const formMode = ref<"create" | "edit">();
const formLabel = ref("");
const formDescription = ref("");
const formParentTypeIds = ref<string[]>([]);

const typeById = computed(() => new Map(props.presentation.types.map((item) => [item.typeId, item])));
const resourceById = computed(() => new Map(props.presentation.resources.map((item) => [item.resourceId, item])));
const selectedType = computed(() => typeById.value.get(selectedTypeId.value));
const visibleTreeRows = computed(() => {
  const query = search.value.trim().toLocaleLowerCase();
  const rows = typeSystemTreeRows(props.presentation);
  if (!query) return rows.map((row) => ({ ...row, item: typeById.value.get(row.typeId)! }));
  return props.presentation.types.filter((item) => (
    item.label.toLocaleLowerCase().includes(query)
      || item.description?.toLocaleLowerCase().includes(query)
  )).map((item) => ({
    rowId: `search-${item.typeId}`,
    typeId: item.typeId,
    depth: 0,
    reference: false,
    item,
  }));
});
const visibleResourceIds = computed(() => {
  const item = selectedType.value;
  if (!item) return [];
  return scope.value === "direct"
    ? [...item.directResourceIds]
    : [...item.directResourceIds, ...item.inheritedResourceIds];
});
const visibleResources = computed(() => visibleResourceIds.value
  .map((resourceId) => resourceById.value.get(resourceId))
  .filter((item) => item !== undefined));
const assignmentResources = computed(() => {
  const query = resourceSearch.value.trim().toLocaleLowerCase();
  return props.presentation.resources.filter((resource) => (
    resource.assignmentEligible
      && (!query || (
        resource.label.toLocaleLowerCase().includes(query)
          || typeLabels(resource.directTypeIds).toLocaleLowerCase().includes(query)
          || typeLabels(resource.inheritedTypeIds).toLocaleLowerCase().includes(query)
      ))
  ));
});
const addableSelectedResourceIds = computed(() => selectedResourceIds.value.filter((resourceId) => (
  !resourceById.value.get(resourceId)?.directTypeIds.includes(selectedTypeId.value)
)));
const removableSelectedResourceIds = computed(() => selectedResourceIds.value.filter((resourceId) => (
  resourceById.value.get(resourceId)?.directTypeIds.includes(selectedTypeId.value)
)));
const formValidation = computed(() => {
  if (!formLabel.value.trim()) return t("typeList.nameRequired");
  if (formMode.value !== "edit" || !selectedType.value) return "";
  const validation = validateProposedTypeParents(
    props.presentation,
    selectedType.value.typeId,
    formParentTypeIds.value,
  );
  if (!validation.valid && validation.reason === "cycle") return t("typeList.cycleInvalid");
  if (!validation.valid) return t("typeList.selectionStale");
  return "";
});

watch(() => [props.focus?.typeId, props.focus?.resourceId] as const, ([typeId, resourceId]) => {
  if (typeId && typeById.value.has(typeId)) selectedTypeId.value = typeId;
  selectedResourceIds.value = resourceId && resourceById.value.has(resourceId) ? [resourceId] : [];
}, { immediate: true });

watch(() => props.presentation, () => {
  if (!typeById.value.has(selectedTypeId.value)) {
    selectedTypeId.value = props.presentation.types[0]?.typeId ?? "";
  }
  selectedResourceIds.value = selectedResourceIds.value.filter((id) => resourceById.value.has(id));
}, { deep: false });

watch(selectedTypeId, () => {
  selectedResourceIds.value = [];
  formMode.value = undefined;
});

function selectType(typeId: string): void {
  selectedTypeId.value = typeId;
}

function toggleResource(resourceId: string): void {
  selectedResourceIds.value = selectedResourceIds.value.includes(resourceId)
    ? selectedResourceIds.value.filter((id) => id !== resourceId)
    : [...selectedResourceIds.value, resourceId];
}

function typeLabels(typeIds: readonly string[]): string {
  return typeIds.map((typeId) => typeById.value.get(typeId)?.label).filter(Boolean)
    .join(locale.value === "ja" ? "、" : ", ");
}

function openCreate(): void {
  formMode.value = "create";
  formLabel.value = "";
  formDescription.value = "";
  formParentTypeIds.value = selectedType.value ? [selectedType.value.typeId] : [];
}

function openEdit(): void {
  if (!selectedType.value) return;
  formMode.value = "edit";
  formLabel.value = selectedType.value.label;
  formDescription.value = selectedType.value.description ?? "";
  formParentTypeIds.value = [...selectedType.value.parentTypeIds];
}

function saveForm(): void {
  if (formValidation.value) return;
  const common = {
    label: formLabel.value.trim(),
    ...(formDescription.value.trim() ? { description: formDescription.value.trim() } : {}),
    parentTypeIds: [...formParentTypeIds.value],
  };
  if (formMode.value === "create") emit("action", { type: "create-class", ...common });
  if (formMode.value === "edit" && selectedType.value) {
    emit("action", { type: "edit-class", typeId: selectedType.value.typeId, ...common });
  }
  formMode.value = undefined;
}

function requestDelete(): void {
  if (!selectedType.value) return;
  emit("action", {
    type: "delete-class",
    typeId: selectedType.value.typeId,
  });
}

function bulk(operation: "bulk-add-type" | "bulk-remove-type"): void {
  if (!selectedType.value) return;
  const resourceIds = operation === "bulk-add-type"
    ? addableSelectedResourceIds.value
    : removableSelectedResourceIds.value;
  if (resourceIds.length === 0) return;
  emit("action", {
    type: operation,
    typeId: selectedType.value.typeId,
    resourceIds: [...resourceIds],
  });
}

function showInDiagram(): void {
  if (!selectedType.value) return;
  emit("show-in-diagram", {
    typeId: selectedType.value.typeId,
    resourceIds: [...visibleResourceIds.value],
    scope: scope.value,
    ...(props.focus?.resourceId && visibleResourceIds.value.includes(props.focus.resourceId)
      ? { focusResourceId: props.focus.resourceId }
      : {}),
  });
}
</script>

<template>
  <section class="type-list-panel" aria-labelledby="type-list-heading">
    <header>
      <div>
        <h2 id="type-list-heading">{{ t("typeList.title") }}</h2>
        <p>{{ t("typeList.description") }}</p>
      </div>
      <button type="button" :disabled="readonly" @click="openCreate">{{ t("typeList.newType") }}</button>
    </header>

    <label class="search-field">
      <span>{{ t("typeList.search") }}</span>
      <input v-model="search" type="search" :placeholder="t('typeList.searchPlaceholder')" />
    </label>

    <div class="panel-columns">
      <nav :aria-label="t('typeList.hierarchy')">
        <p v-if="presentation.cycles.length" role="alert">{{ t("typeList.cycleWarning") }}</p>
        <ul role="tree" :aria-label="t('typeList.typesAria')">
          <li
            v-for="row in visibleTreeRows"
            :key="row.rowId"
            role="treeitem"
            :aria-level="row.depth + 1"
            :aria-selected="row.typeId === selectedTypeId"
            :data-type-id="row.typeId"
            :style="{ paddingInlineStart: `${row.depth * 18}px` }"
          >
            <button type="button" :class="{ selected: row.typeId === selectedTypeId }" @click="selectType(row.typeId)">
              <strong>{{ row.item.label }}<small v-if="row.reference" class="dag-reference">{{ t("typeList.sameTypeReference") }}</small></strong>
              <span>{{ t("typeList.directInheritedCounts", { direct: row.item.directCount, inherited: row.item.inheritedCount }) }}</span>
            </button>
            <p v-if="row.item.parentTypeIds.length" class="parent-summary">
              <span>{{ t("typeList.parentTypes") }}</span>
              {{ row.item.parentTypeIds.map((id) => typeById.get(id)?.label).filter(Boolean).join(t("common.listSeparator")) }}
            </p>
          </li>
        </ul>
        <p v-if="visibleTreeRows.length === 0" class="empty">{{ t("typeList.noMatches") }}</p>
      </nav>

      <article v-if="selectedType" :aria-label="t('typeList.selectedType')">
        <div class="detail-heading">
          <div>
            <span class="eyebrow">{{ t("common.type") }}</span>
            <h3>{{ selectedType.label }}</h3>
          </div>
          <div class="detail-actions">
            <button type="button" :disabled="readonly" @click="openEdit">{{ t("common.edit") }}</button>
            <button type="button" :disabled="readonly" @click="requestDelete">{{ t("common.delete") }}</button>
          </div>
        </div>
        <p v-if="selectedType.description">{{ selectedType.description }}</p>

        <dl>
          <div>
            <dt>{{ t("typeList.parentTypes") }}</dt>
            <dd>{{ selectedType.parentTypeIds.length ? selectedType.parentTypeIds.map((id) => typeById.get(id)?.label).filter(Boolean).join(", ") : t("common.none") }}</dd>
          </div>
          <div>
            <dt>{{ t("typeList.childTypes") }}</dt>
            <dd>{{ selectedType.childTypeIds.length ? selectedType.childTypeIds.map((id) => typeById.get(id)?.label).filter(Boolean).join(", ") : t("common.none") }}</dd>
          </div>
        </dl>

        <form v-if="formMode" class="type-form" @submit.prevent="saveForm">
          <h4>{{ formMode === "create" ? t("typeList.newType") : t("typeList.editType") }}</h4>
          <label>
            <span>{{ t("common.name") }}</span>
            <input v-model="formLabel" />
          </label>
          <label>
            <span>{{ t("common.description") }}</span>
            <textarea v-model="formDescription" rows="3" />
          </label>
          <fieldset>
            <legend>{{ t("typeList.parentTypes") }}</legend>
            <label v-for="candidate in presentation.types.filter((item) => formMode === 'create' || item.typeId !== selectedTypeId)" :key="candidate.typeId">
              <input v-model="formParentTypeIds" type="checkbox" :value="candidate.typeId" />
              <span>{{ candidate.label }}</span>
            </label>
          </fieldset>
          <p v-if="formValidation" class="form-error" role="alert">{{ formValidation }}</p>
          <div class="form-actions">
            <button type="submit" :disabled="Boolean(formValidation)">{{ t("typeList.save") }}</button>
            <button type="button" @click="formMode = undefined">{{ t("common.cancel") }}</button>
          </div>
        </form>

        <section class="resource-section" aria-labelledby="type-resources-heading">
          <div class="resource-heading">
            <h4 id="type-resources-heading">{{ t("typeList.matchingElements") }}</h4>
            <div role="group" :aria-label="t('typeList.elementScope')">
              <button type="button" :aria-pressed="scope === 'direct'" @click="scope = 'direct'">{{ t("typeList.direct") }}</button>
              <button type="button" :aria-pressed="scope === 'direct-and-inherited'" @click="scope = 'direct-and-inherited'">{{ t("typeList.includeInherited") }}</button>
            </div>
          </div>
          <div v-for="resource in visibleResources" :key="resource.resourceId" class="resource-row resource-row-readonly">
            <span class="resource-copy">
              <span>{{ resource.label }}</span>
              <small>{{ t("typeList.directTypes", { types: typeLabels(resource.directTypeIds) || t("common.none") }) }}</small>
              <small v-if="resource.inheritedTypeIds.length">{{ t("typeList.inheritedTypes", { types: typeLabels(resource.inheritedTypeIds) }) }}</small>
            </span>
            <small>{{ resource.directTypeIds.includes(selectedType.typeId) ? t("typeList.direct") : t("typeList.includeInherited") }}</small>
          </div>
          <p v-if="visibleResources.length === 0" class="empty">{{ t("typeList.noElements") }}</p>
          <div class="resource-actions">
            <button type="button" @click="showInDiagram">{{ t("typeList.showInDiagram") }}</button>
          </div>
        </section>

        <section class="resource-section assignment-section" aria-labelledby="type-assignment-heading">
          <div class="resource-heading">
            <div>
              <h4 id="type-assignment-heading">{{ t("typeList.bulkChange") }}</h4>
              <p>{{ t("typeList.bulkDescription") }}</p>
            </div>
          </div>
          <label class="search-field">
            <span>{{ t("typeList.searchElements") }}</span>
            <input v-model="resourceSearch" type="search" :placeholder="t('typeList.searchElementsPlaceholder')" />
          </label>
          <label v-for="resource in assignmentResources" :key="resource.resourceId" class="resource-row assignment-resource-row">
            <input
              type="checkbox"
              :checked="selectedResourceIds.includes(resource.resourceId)"
              @change="toggleResource(resource.resourceId)"
            />
            <span class="resource-copy">
              <span>{{ resource.label }}</span>
              <small>{{ t("typeList.directTypes", { types: typeLabels(resource.directTypeIds) || t("common.none") }) }}</small>
              <small v-if="resource.inheritedTypeIds.length">{{ t("typeList.inheritedTypes", { types: typeLabels(resource.inheritedTypeIds) }) }}</small>
            </span>
            <small>{{ resource.directTypeIds.includes(selectedType.typeId) ? t("typeList.canRemove") : t("typeList.canAssign") }}</small>
          </label>
          <p v-if="assignmentResources.length === 0" class="empty">{{ t("typeList.noElementMatches") }}</p>
          <div class="resource-actions">
            <button type="button" :disabled="readonly || addableSelectedResourceIds.length === 0" @click="bulk('bulk-add-type')">{{ t("typeList.assignSelected") }}</button>
            <button type="button" :disabled="readonly || removableSelectedResourceIds.length === 0" @click="bulk('bulk-remove-type')">{{ t("typeList.removeSelected") }}</button>
          </div>
        </section>
      </article>
    </div>
  </section>
</template>

<style scoped>
.type-list-panel {
  color: #172033;
  display: grid;
  gap: 1rem;
  min-width: 0;
}

header,
.detail-heading,
.resource-heading,
.resource-actions,
.form-actions {
  align-items: center;
  display: flex;
  gap: .65rem;
  justify-content: space-between;
}

h2,
h3,
h4,
p {
  margin: 0;
}

header p,
.empty,
.parent-summary,
small {
  color: #60708b;
  font-size: .8rem;
}

button,
input,
textarea {
  font: inherit;
}

button {
  background: #fff;
  border: 1px solid #c8d2e3;
  border-radius: .45rem;
  cursor: pointer;
  padding: .42rem .7rem;
}

button:disabled {
  cursor: default;
  opacity: .5;
}

.search-field,
.type-form > label {
  display: grid;
  gap: .3rem;
}

input[type="search"],
.type-form input:not([type="checkbox"]),
textarea {
  border: 1px solid #b9c6d9;
  border-radius: .4rem;
  padding: .55rem;
}

.panel-columns {
  display: grid;
  gap: 1rem;
  grid-template-columns: minmax(15rem, 1fr) minmax(20rem, 1.45fr);
}

nav,
article {
  border: 1px solid #d9e0eb;
  border-radius: .65rem;
  min-width: 0;
  padding: .75rem;
}

ul {
  display: grid;
  gap: .35rem;
  list-style: none;
  margin: 0;
  padding: 0;
}

li > button {
  display: flex;
  justify-content: space-between;
  text-align: left;
  width: 100%;
}

li > button.selected {
  background: #e8f0ff;
  border-color: #7398d6;
}

li > button span {
  color: #60708b;
  font-size: .75rem;
}

.parent-summary {
  padding: .2rem .5rem .25rem;
}

.parent-summary span,
.eyebrow {
  color: #47658f;
  font-size: .72rem;
  font-weight: 700;
  margin-right: .35rem;
}

.dag-reference {
  color: #60708b;
  display: block;
  font-size: .68rem;
  font-weight: 500;
}

article,
.type-form,
.resource-section {
  display: grid;
  gap: .8rem;
}

dl {
  display: grid;
  gap: .4rem;
  margin: 0;
}

dl div {
  display: grid;
  grid-template-columns: 6rem 1fr;
}

dt {
  color: #60708b;
}

dd {
  margin: 0;
}

.type-form {
  background: #f7f9fc;
  border: 1px solid #d9e0eb;
  border-radius: .55rem;
  padding: .75rem;
}

fieldset {
  border: 0;
  display: grid;
  gap: .3rem;
  margin: 0;
  padding: 0;
}

.form-error {
  color: #a02929;
}

.resource-row {
  align-items: center;
  border-bottom: 1px solid #edf0f5;
  display: grid;
  gap: .5rem;
  grid-template-columns: auto 1fr auto;
  padding: .4rem 0;
}

.resource-row-readonly {
  grid-template-columns: 1fr auto;
}

.assignment-section > .resource-heading p {
  color: #60708b;
  font-size: .8rem;
}

.resource-copy {
  display: grid;
}

@media (max-width: 760px) {
  .panel-columns {
    grid-template-columns: 1fr;
  }

  .resource-actions {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
