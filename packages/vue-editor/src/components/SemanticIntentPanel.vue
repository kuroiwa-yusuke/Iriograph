<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";

import {
  statementIdentityForNamedStatement,
  type AuthoringCommand,
  type ProjectionDiagnostic,
  type SemanticEditCapability,
} from "@iriograph/core";

import {
  emptyAuthoringDraft,
  type AuthoringChoice,
  type EditorAuthoringDraft,
} from "../authoring/authoring-draft";
import { diagnosticGuidance } from "../inspector/diagnostic-guidance";
import type { MembershipOverview } from "../authoring/membership-overview";
import type { PredicateInferencePolicy } from "../document/editor-host-contracts";
import {
  useEditorLocalization,
  type EditorMessageKey,
} from "../localization/editor-localization";

const { locale, t } = useEditorLocalization();

export type SemanticIntent = "add-element" | "add-relation" | "edit-element" | "edit-relation";

export type IntentElementDetails = {
  iri: string;
  label: string;
  labelValues: IntentTextValue[];
  commentValues: IntentTextValue[];
  classIris: string[];
};

export type IntentTextValue = {
  value: string;
  language?: string;
  datatypeIri?: string;
};

export type IntentEdgeDetails = {
  label: string;
  sourceIri: string;
  sourceLabel: string;
  predicateIri: string;
  targetIri: string;
  targetLabel: string;
  statementComments?: IntentTextValue[];
  capability?: SemanticEditCapability;
  derivedReason?: string;
  viewResolution?: IntentViewResolution;
};

export type IntentPredicateMeaning = {
  iri: string;
  label: string;
  description?: string;
  /** Exact path is internal transaction input; the component renders labels only. */
  hierarchyPaths: Array<{ iris: string[]; labels: string[] }>;
  hierarchyDiagnostics: Array<{ code: string; labels: string[] }>;
};

export type IntentViewRuleMatch = "exact" | "explicit-subclass" | "explicit-subproperty" | "wildcard";

export type IntentViewResolution = {
  selectedMatch?: IntentViewRuleMatch;
  fallbackReason?: "no-matching-rule" | "wildcard-rule";
  candidateMatches: IntentViewRuleMatch[];
  conflictCount: number;
};

export type IntentMembershipOption = {
  containerIri: string;
  label: string;
  containerTypeIri: string;
  predicateIri: string;
  containerPosition: "subject" | "object";
  memberIris: string[];
};

export type IntentSequenceOption = {
  sequenceIri: string;
  label: string;
  sequenceTypeIri: string;
  ordinalPredicatePrefix: string;
  memberIris: string[];
  members: Array<{ iri: string; label: string }>;
};

export type IntentAlternativeOption = {
  alternativeIri: string;
  label: string;
  alternativeTypeIri: string;
  ordinalPredicatePrefix: string;
  defaultMemberIri: string;
  defaultOrdinal: number;
  memberIris: string[];
  members: Array<{ iri: string; label: string }>;
};

export type IntentRelationOverview = {
  edgeElementId: string;
  sourceIri: string;
  sourceLabel: string;
  predicateIri: string;
  predicateLabel: string;
  targetIri: string;
  targetLabel: string;
  direction: "outgoing" | "incoming" | "both";
  derivedReason?: string;
};

const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const RDFS_LABEL = "http://www.w3.org/2000/01/rdf-schema#label";
const RDFS_COMMENT = "http://www.w3.org/2000/01/rdf-schema#comment";
const PREDICATE_CATEGORY_GROUPS: Readonly<Record<string, EditorMessageKey>> = {
  Classification: "semantic.group.classification",
  "Vocabulary definition": "semantic.group.classification",
  分類: "semantic.group.classification",
  語彙定義: "semantic.group.classification",
  Containment: "semantic.group.containment",
  Composition: "semantic.group.containment",
  包含: "semantic.group.containment",
  構成: "semantic.group.containment",
  Reference: "semantic.group.reference",
  "General relationship": "semantic.group.reference",
  参照: "semantic.group.reference",
  一般関係: "semantic.group.reference",
  Dependency: "semantic.group.dependency",
  依存: "semantic.group.dependency",
  Provenance: "semantic.group.provenance",
  Versioning: "semantic.group.provenance",
  由来: "semantic.group.provenance",
  版管理: "semantic.group.provenance",
  Responsibility: "semantic.group.usage",
  Usage: "semantic.group.usage",
  担当: "semantic.group.usage",
  利用: "semantic.group.usage",
  "Concept relationship": "semantic.group.concept",
  "Concept mapping": "semantic.group.concept",
  "Relationship mapping": "semantic.group.concept",
  Identity: "semantic.group.concept",
  概念関係: "semantic.group.concept",
  概念対応: "semantic.group.concept",
  関係対応: "semantic.group.concept",
  同一性: "semantic.group.concept",
};

const props = withDefaults(defineProps<{
  enabled?: boolean;
  blockedReason?: string;
  guidance?: string;
  busy?: boolean;
  resources?: AuthoringChoice[];
  selectedResources?: AuthoringChoice[];
  selectedEdge?: IntentEdgeDetails;
  elementDetails?: IntentElementDetails;
  classes?: AuthoringChoice[];
  predicates?: AuthoringChoice[];
  predicateMeanings?: Record<string, IntentPredicateMeaning>;
  predicateInferencePolicy?: PredicateInferencePolicy;
  defaultLocale?: string;
  memberships?: IntentMembershipOption[];
  sequences?: IntentSequenceOption[];
  alternatives?: IntentAlternativeOption[];
  incidentRelations?: IntentRelationOverview[];
  membershipOverview?: MembershipOverview;
  requestedIntent?: SemanticIntent;
  pickedSourceIri?: string;
  pickedTargetIri?: string;
  diagnostics?: ProjectionDiagnostic[];
}>(), {
  enabled: true,
  blockedReason: "",
  guidance: "",
  busy: false,
  resources: () => [],
  selectedResources: () => [],
  selectedEdge: undefined,
  elementDetails: undefined,
  classes: () => [],
  predicates: () => [],
  predicateMeanings: () => ({}),
  predicateInferencePolicy: undefined,
  defaultLocale: undefined,
  memberships: () => [],
  sequences: () => [],
  alternatives: () => [],
  incidentRelations: () => [],
  membershipOverview: () => ({ belongsTo: [], contains: [] }),
  requestedIntent: undefined,
  pickedSourceIri: "",
  pickedTargetIri: "",
  diagnostics: () => [],
});

const emit = defineEmits<{
  executeDraft: [draft: EditorAuthoringDraft, label: string];
  executeCommands: [commands: AuthoringCommand[], label: string, resources: Array<{ iri: string; label: string; role: string }>];
  deleteSelection: [];
  cancel: [];
  pickResource: [field: "sourceIri" | "targetIri"];
  useSelfTarget: [sourceIri: string];
  focusElement: [elementId: string];
  intentChange: [intent: SemanticIntent | undefined];
  draftStateChange: [pending: boolean];
}>();

const intent = ref<SemanticIntent>();
const label = ref("");
const labelValues = ref<IntentTextValue[]>([]);
const commentValues = ref<IntentTextValue[]>([]);
const statementCommentValues = ref<IntentTextValue[]>([]);
const classIris = ref<string[]>([]);
const predicateIri = ref("");
const sourceIri = ref("");
const targetIri = ref("");
const selfRelationExplicit = ref(false);
const predicateSelectionGuidance = ref("");
const membershipActions = ref<Record<string, "keep" | "add" | "remove">>({});
const sequenceIri = ref("");
const sequenceMemberIris = ref<string[]>([]);
const alternativeIri = ref("");
const alternativeMemberIris = ref<string[]>([]);
const alternativeMemberKeys = ref<string[]>([]);
const alternativeDefaultMemberKey = ref("");
const selectedOverviewMembershipKeys = ref<string[]>([]);
const panelRoot = ref<HTMLElement>();

const relationResourceChoices = computed(() => [...props.resources, ...props.selectedResources]
  .filter((resource, index, all) => (
    all.findIndex((candidate) => candidate.iri === resource.iri) === index
  )));
const relationSelection = computed(() => ({
  source: relationResourceChoices.value.find((resource) => resource.iri === sourceIri.value),
  targets: relationResourceChoices.value.filter((resource) => resource.iri === targetIri.value),
}));
const inspectedResources = computed<AuthoringChoice[]>(() => props.selectedResources.length
  ? props.selectedResources
  : props.elementDetails
    ? [{ iri: props.elementDetails.iri, label: props.elementDetails.label }]
    : []);
const predicateSelectionValid = computed(() => Boolean(
  predicateIri.value && props.predicates.some((choice) => choice.iri === predicateIri.value),
));
const relationReady = computed(() => Boolean(
  relationSelection.value.source
  && relationSelection.value.targets.length
  && predicateSelectionValid.value
  && (sourceIri.value !== targetIri.value || selfRelationExplicit.value),
));
const selectedPredicateLabel = computed(() => props.predicates.find(
  (choice) => choice.iri === (predicateIri.value || props.selectedEdge?.predicateIri),
)?.label ?? t("semantic.relationFallback"));
const selectedPredicateMeaning = computed(() => props.predicateMeanings[
  predicateIri.value || props.selectedEdge?.predicateIri || ""
]);
const selectedPredicateToken = computed({
  get: () => predicateTokenForIri(predicateIri.value),
  set: (token: string) => {
    predicateIri.value = props.predicates.find((choice) => predicateToken(choice) === token)?.iri ?? "";
  },
});
const selectedSemanticTypeTokens = computed({
  get: () => classIris.value.flatMap((iri) => {
    const token = semanticTypeTokenForIri(iri);
    return token ? [token] : [];
  }),
  set: (tokens: string[]) => {
    const selected = new Set(tokens);
    const editableIris = new Set(props.classes.map((choice) => choice.iri));
    const unlistedIris = classIris.value.filter((iri) => !editableIris.has(iri));
    classIris.value = [...unlistedIris, ...props.classes
      .filter((choice) => selected.has(semanticTypeToken(choice)))
      .map((choice) => choice.iri)];
  },
});
const selectedSequenceToken = computed({
  get: () => sequenceTokenForIri(sequenceIri.value),
  set: (token: string) => {
    sequenceIri.value = props.sequences.find((option) => sequenceToken(option) === token)?.sequenceIri ?? "";
  },
});
const selectedAlternativeToken = computed({
  get: () => alternativeTokenForIri(alternativeIri.value),
  set: (token: string) => {
    alternativeIri.value = props.alternatives.find((option) => alternativeToken(option) === token)?.alternativeIri ?? "";
  },
});
const selectedOverviewMembershipTokens = computed({
  get: () => selectedOverviewMembershipKeys.value.flatMap((identity) => {
    const token = overviewMembershipTokenForIdentity(identity);
    return token ? [token] : [];
  }),
  set: (tokens: string[]) => {
    const selected = new Set(tokens);
    selectedOverviewMembershipKeys.value = overviewMembershipItems()
      .filter((item) => selected.has(overviewMembershipToken(item)))
      .map(overviewMembershipKey);
  },
});
const inspectedMembershipCount = computed(() => (
  props.membershipOverview.belongsTo.length + props.membershipOverview.contains.length
));
const predicateGroups = computed(() => {
  const groups = new Map<string, AuthoringChoice[]>();
  for (const choice of props.predicates) {
    const sourceCategory = choice.category?.trim();
    const categoryKey = sourceCategory ? PREDICATE_CATEGORY_GROUPS[sourceCategory] : undefined;
    const category = categoryKey ? t(categoryKey) : sourceCategory || t("semantic.otherRelations");
    const group = groups.get(category) ?? [];
    group.push(choice);
    groups.set(category, group);
  }
  return [...groups].map(([category, choices]) => ({ category, choices }));
});
const classificationRegionIris = computed(() => new Set(props.memberships
  .filter((option) => option.predicateIri === RDF_TYPE && option.containerPosition === "object")
  .map((option) => option.containerIri)));
const semanticTypeChoices = computed(() => props.classes);
const editableMemberships = computed(() => props.memberships.filter(
  (option) => !(option.predicateIri === RDF_TYPE && option.containerPosition === "object"),
));
const currentConceptRegions = computed(() => {
  const resourceIri = props.elementDetails?.iri;
  if (!resourceIri) return [];
  return props.memberships.filter((option) => (
    option.predicateIri === RDF_TYPE
    && option.containerPosition === "object"
    && option.memberIris.includes(resourceIri)
  ));
});
const currentBusinessMemberships = computed(() => {
  const resourceIri = props.elementDetails?.iri;
  if (!resourceIri) return [];
  return editableMemberships.value.filter((option) => option.memberIris.includes(resourceIri));
});
const localDraftPending = computed(() => {
  if (intent.value === "add-element") return label.value.trim().length > 0;
  if (intent.value === "add-relation") return relationReady.value;
  if (intent.value === "edit-element") {
    const details = props.elementDetails;
    if (!details) return false;
    const nextLabels = cloneTextValues(labelValues.value, label.value);
    if (nextLabels[0]) nextLabels[0] = { ...nextLabels[0], value: label.value };
    const effectiveLabels = nextLabels.filter((item, index) => index === 0 || item.value.length > 0);
    return JSON.stringify(effectiveLabels) !== JSON.stringify(details.labelValues)
      || JSON.stringify(commentValues.value) !== JSON.stringify(details.commentValues)
      || JSON.stringify([...classIris.value].sort()) !== JSON.stringify([...details.classIris].sort());
  }
  if (intent.value === "edit-relation") {
    const edge = props.selectedEdge;
    if (edge) return sourceIri.value !== edge.sourceIri
      || targetIri.value !== edge.targetIri
      || predicateIri.value !== edge.predicateIri
      || JSON.stringify(statementCommentValues.value) !== JSON.stringify(edge.statementComments ?? []);
    if (Object.values(membershipActions.value).some((action) => action !== "keep")) return true;
    const sequence = selectedSequence();
    const alternative = selectedAlternative();
    return Boolean(
      (sequence && JSON.stringify(sequenceMemberIris.value) !== JSON.stringify(sequence.memberIris))
      || (alternative && (
        JSON.stringify(alternativeMemberIris.value) !== JSON.stringify(alternative.memberIris)
        || alternativeMemberKeys.value.indexOf(alternativeDefaultMemberKey.value) + 1 !== alternative.defaultOrdinal
      )),
    );
  }
  return false;
});

watch(() => props.requestedIntent, (requested) => {
  if (requested && requested !== intent.value) choose(requested);
}, { immediate: true });
watch(localDraftPending, (pending) => emit("draftStateChange", pending), { immediate: true });

watch(() => props.elementDetails, (details) => {
  if (intent.value !== "edit-element" || !details) return;
  label.value = details.label;
  labelValues.value = cloneTextValues(details.labelValues, details.label);
  commentValues.value = cloneTextValues(details.commentValues);
  classIris.value = [...details.classIris];
});
watch(() => props.selectedEdge, (edge) => {
  if (intent.value !== "edit-relation" || !edge) return;
  predicateIri.value = edge.predicateIri;
  predicateSelectionGuidance.value = "";
  sourceIri.value = edge.sourceIri;
  targetIri.value = edge.targetIri;
  statementCommentValues.value = cloneTextValues(edge.statementComments ?? []);
});
watch(() => props.predicates.map((choice) => choice.iri), (availablePredicateIris) => {
  if (!predicateIri.value || availablePredicateIris.includes(predicateIri.value)) return;
  predicateIri.value = "";
  predicateSelectionGuidance.value = t("semantic.reselectPredicate");
});
watch([() => props.sequences, intent], ([sequences, currentIntent]) => {
  if (currentIntent !== "edit-relation") return;
  if (!sequences.some((option) => option.sequenceIri === sequenceIri.value)) {
    sequenceIri.value = sequences.length === 1 ? sequences[0]!.sequenceIri : "";
  }
  syncSequenceMembers();
}, { deep: true, immediate: true });
watch([() => props.alternatives, intent], ([alternatives, currentIntent]) => {
  if (currentIntent !== "edit-relation") return;
  if (!alternatives.some((option) => option.alternativeIri === alternativeIri.value)) {
    alternativeIri.value = alternatives.length === 1 ? alternatives[0]!.alternativeIri : "";
  }
  syncAlternativeMembers();
}, { deep: true, immediate: true });
watch(() => props.membershipOverview, () => {
  const available = new Set(overviewMembershipItems().map(overviewMembershipKey));
  selectedOverviewMembershipKeys.value = selectedOverviewMembershipKeys.value.filter((key) => available.has(key));
}, { deep: true });
watch(() => props.pickedSourceIri, (value) => {
  if (!value) {
    if (intent.value === "add-relation") {
      sourceIri.value = "";
      targetIri.value = "";
      selfRelationExplicit.value = false;
    }
    return;
  }
  if (sourceIri.value !== value) {
    targetIri.value = "";
    selfRelationExplicit.value = false;
  }
  sourceIri.value = value;
});
watch(() => props.pickedTargetIri, (value) => {
  if (!value) {
    if (intent.value === "add-relation") {
      targetIri.value = "";
      selfRelationExplicit.value = false;
    }
    return;
  }
  targetIri.value = value;
  if (value !== sourceIri.value) selfRelationExplicit.value = false;
});

function choose(next: SemanticIntent): void {
  intent.value = next;
  predicateSelectionGuidance.value = "";
  emit("intentChange", next);
  if (next === "add-element") label.value = "";
  if (next === "add-relation") {
    predicateIri.value = props.predicates.length === 1 ? props.predicates[0]?.iri ?? "" : "";
    sourceIri.value = props.selectedResources.length === 1 ? props.selectedResources[0]!.iri : "";
    targetIri.value = "";
    selfRelationExplicit.value = false;
    emit("pickResource", sourceIri.value ? "targetIri" : "sourceIri");
  }
  if (next === "edit-element" && props.elementDetails) {
    label.value = props.elementDetails.label;
    labelValues.value = cloneTextValues(props.elementDetails.labelValues, props.elementDetails.label);
    commentValues.value = cloneTextValues(props.elementDetails.commentValues);
    classIris.value = [...props.elementDetails.classIris];
  }
  if (next === "edit-relation" && props.selectedEdge) {
    predicateIri.value = props.selectedEdge.predicateIri;
    sourceIri.value = props.selectedEdge.sourceIri;
    targetIri.value = props.selectedEdge.targetIri;
    statementCommentValues.value = cloneTextValues(props.selectedEdge.statementComments ?? []);
  }
  void nextTick(() => {
    const firstField = panelRoot.value?.querySelector<HTMLElement>(
      ".iriograph-intent-fields textarea:not([disabled]), .iriograph-intent-fields input:not([disabled]), .iriograph-intent-fields select:not([disabled]), .iriograph-intent-fields button:not([disabled])",
    );
    (firstField ?? panelRoot.value)?.focus();
  });
}

function reset(): void {
  intent.value = undefined;
  emit("intentChange", undefined);
  label.value = "";
  labelValues.value = [];
  commentValues.value = [];
  classIris.value = [];
  predicateIri.value = "";
  predicateSelectionGuidance.value = "";
  sourceIri.value = "";
  targetIri.value = "";
  selfRelationExplicit.value = false;
  statementCommentValues.value = [];
  membershipActions.value = {};
  sequenceIri.value = "";
  sequenceMemberIris.value = [];
  alternativeIri.value = "";
  alternativeMemberIris.value = [];
  alternativeMemberKeys.value = [];
  alternativeDefaultMemberKey.value = "";
  selectedOverviewMembershipKeys.value = [];
}

function cancel(): void {
  reset();
  emit("cancel");
}

function previewElementCreation(): void {
  const draft = emptyAuthoringDraft("create-resource");
  draft.label = label.value;
  emit("executeDraft", draft, t("semantic.history.addElement"));
}

function previewRelationCreation(): void {
  const source = relationSelection.value.source;
  if (!source || !relationReady.value) return;
  const draft = emptyAuthoringDraft("connect-resources", source.iri);
  draft.sourceIri = source.iri;
  draft.targetIri = targetIri.value;
  draft.targetIris = [];
  draft.predicateIri = predicateIri.value;
  emit("executeDraft", draft, t("semantic.history.addRelationFrom", {
    source: source.label ?? t("semantic.selectedElementFallback"),
  }));
}

function useSourceAsTarget(): void {
  if (!sourceIri.value) return;
  targetIri.value = sourceIri.value;
  selfRelationExplicit.value = true;
  emit("useSelfTarget", sourceIri.value);
}

function confirmPredicateSelection(): void {
  predicateSelectionGuidance.value = "";
}

function predicateToken(choice: AuthoringChoice): string {
  const index = props.predicates.findIndex((candidate) => candidate.iri === choice.iri);
  return index < 0 ? "" : `predicate-${index + 1}`;
}

function predicateTokenForIri(iri: string): string {
  const choice = props.predicates.find((candidate) => candidate.iri === iri);
  return choice ? predicateToken(choice) : "";
}

function semanticTypeToken(choice: AuthoringChoice): string {
  const index = props.classes.findIndex((candidate) => candidate.iri === choice.iri);
  return index < 0 ? "" : `type-${index + 1}`;
}

function semanticTypeTokenForIri(iri: string): string {
  const choice = props.classes.find((candidate) => candidate.iri === iri);
  return choice ? semanticTypeToken(choice) : "";
}

function previewElementEdit(): void {
  const details = props.elementDetails;
  if (!details) return;
  const commands: AuthoringCommand[] = [];
  const nextLabels = cloneTextValues(labelValues.value, label.value);
  nextLabels[0] = { ...nextLabels[0], value: label.value };
  const effectiveLabels = nextLabels.filter((item, index) => index === 0 || item.value.length > 0);
  if (JSON.stringify(effectiveLabels) !== JSON.stringify(details.labelValues)) commands.push({
    type: "set-property",
    commandId: "intent-label",
    subjectIri: details.iri,
    predicateIri: RDFS_LABEL,
    values: effectiveLabels.map((item) => ({ kind: "literal", ...item })),
  });
  if (JSON.stringify(commentValues.value) !== JSON.stringify(details.commentValues)) commands.push({
    type: "set-property",
    commandId: "intent-comment",
    subjectIri: details.iri,
    predicateIri: RDFS_COMMENT,
    values: commentValues.value.filter((item) => item.value).map((item) => ({ kind: "literal", ...item })),
  });
  if (JSON.stringify([...classIris.value].sort()) !== JSON.stringify([...details.classIris].sort())) commands.push({
    type: "set-property",
    commandId: "intent-types",
    subjectIri: details.iri,
    predicateIri: RDF_TYPE,
    values: classIris.value.map((iri) => ({ kind: "iri", iri })),
  });
  emit("executeCommands", commands, t("semantic.history.editElement", { label: details.label }), [{
    iri: details.iri,
    label: details.label,
    role: t("semantic.role.target"),
  }]);
}

function previewElementDelete(): void {
  if (!props.elementDetails) return;
  emit("deleteSelection");
}

function previewEdgeEdit(): void {
  const edge = props.selectedEdge;
  const capability = edge?.capability;
  if (!edge || capability?.command !== "remove-statement" || !predicateSelectionValid.value) return;
  const commands: AuthoringCommand[] = [{
    type: "remove-statement",
    commandId: "intent-replace-edge-remove",
    statementRef: capability.statementRef,
    subjectIri: capability.subject,
    predicateIri: capability.predicate,
    objectIri: capability.object,
  }];
  if (sourceIri.value && targetIri.value && predicateIri.value) {
    const nextStatement = {
      subjectIri: sourceIri.value,
      predicateIri: predicateIri.value,
      objectIri: targetIri.value,
    };
    commands.push({
      type: "connect-resources",
      commandId: "intent-replace-edge-add",
      ...nextStatement,
    }, {
      type: "set-statement-comments",
      commandId: "intent-replace-edge-comments",
      statementRef: statementIdentityForNamedStatement(nextStatement),
      ...nextStatement,
      comments: statementCommentValues.value
        .filter((item) => item.value.length > 0)
        .map((item) => ({ kind: "literal", ...item })),
    });
  }
  emit("executeCommands", commands, t("semantic.history.editRelation", { label: edge.label }), [
    { iri: sourceIri.value, label: resourceLabel(sourceIri.value), role: t("semantic.role.source") },
    { iri: targetIri.value, label: resourceLabel(targetIri.value), role: t("semantic.role.destination") },
  ]);
}

function previewEdgeDelete(): void {
  if (!props.selectedEdge?.capability) return;
  emit("deleteSelection");
}

function previewMemberships(): void {
  const selected = props.selectedResources;
  const commands: AuthoringCommand[] = [];
  for (const option of editableMemberships.value) {
    const action = membershipActions.value[option.containerIri] ?? "keep";
    if (action === "keep") continue;
    for (const member of selected) {
      if (member.iri === option.containerIri) continue;
      const currentlyPresent = option.memberIris.includes(member.iri);
      const enabled = action === "add";
      if (currentlyPresent === enabled) continue;
      commands.push({
        type: "set-membership",
        commandId: `intent-membership-${commands.length + 1}`,
        containerIri: option.containerIri,
        memberIri: member.iri,
        enabled,
        containerTypeIri: option.containerTypeIri,
        predicateIri: option.predicateIri,
        containerPosition: option.containerPosition,
      });
    }
  }
  emit("executeCommands", commands, t("semantic.history.bulkMembership"), selected.map((item) => ({
    iri: item.iri,
    label: item.label ?? t("common.element"),
    role: t("semantic.role.target"),
  })));
}

function selectedSequence(): IntentSequenceOption | undefined {
  return props.sequences.find((option) => option.sequenceIri === sequenceIri.value);
}

function sequenceToken(option: IntentSequenceOption): string {
  const index = props.sequences.findIndex((candidate) => candidate.sequenceIri === option.sequenceIri);
  return index < 0 ? "" : `sequence-${index + 1}`;
}

function sequenceTokenForIri(iri: string): string {
  const option = props.sequences.find((candidate) => candidate.sequenceIri === iri);
  return option ? sequenceToken(option) : "";
}

function syncSequenceMembers(): void {
  const sequence = selectedSequence();
  sequenceMemberIris.value = sequence ? [...sequence.memberIris] : [];
}

function sequenceMemberLabel(iri: string): string {
  const sequence = selectedSequence();
  return sequence?.members.find((member) => member.iri === iri)?.label
    ?? props.selectedResources.find((resource) => resource.iri === iri)?.label
    ?? t("semantic.selectedElementFallback");
}

function sequenceCandidates(): AuthoringChoice[] {
  const sequence = selectedSequence();
  if (!sequence) return [];
  return props.selectedResources.filter((resource) => (
    resource.iri !== sequence.sequenceIri && !sequenceMemberIris.value.includes(resource.iri)
  ));
}

function addSelectedSequenceMembers(): void {
  sequenceMemberIris.value.push(...sequenceCandidates().map((resource) => resource.iri));
}

function moveSequenceMember(index: number, delta: -1 | 1): void {
  const target = index + delta;
  if (target < 0 || target >= sequenceMemberIris.value.length) return;
  const [member] = sequenceMemberIris.value.splice(index, 1);
  sequenceMemberIris.value.splice(target, 0, member!);
}

function removeSequenceMember(index: number): void {
  sequenceMemberIris.value.splice(index, 1);
}

function previewSequence(): void {
  const sequence = selectedSequence();
  if (!sequence || sequenceMemberIris.value.length === 0) return;
  emit("executeCommands", [{
    type: "set-sequence",
    commandId: "intent-sequence",
    sequenceIri: sequence.sequenceIri,
    memberIris: [...sequenceMemberIris.value],
    sequenceTypeIri: sequence.sequenceTypeIri,
    ordinalPredicatePrefix: sequence.ordinalPredicatePrefix,
  }], t("semantic.history.editOrder", { label: sequence.label }), [{
    iri: sequence.sequenceIri,
    label: sequence.label,
    role: t("semantic.role.order"),
  }]);
}

function selectedAlternative(): IntentAlternativeOption | undefined {
  return props.alternatives.find((option) => option.alternativeIri === alternativeIri.value);
}

function alternativeToken(option: IntentAlternativeOption): string {
  const index = props.alternatives.findIndex((candidate) => candidate.alternativeIri === option.alternativeIri);
  return index < 0 ? "" : `alternative-${index + 1}`;
}

function alternativeTokenForIri(iri: string): string {
  const option = props.alternatives.find((candidate) => candidate.alternativeIri === iri);
  return option ? alternativeToken(option) : "";
}

function syncAlternativeMembers(): void {
  const alternative = selectedAlternative();
  alternativeMemberIris.value = alternative ? [...alternative.memberIris] : [];
  alternativeMemberKeys.value = alternativeMemberIris.value.map((_, index) => `alternative-member-${index + 1}`);
  alternativeDefaultMemberKey.value = alternative
    ? alternativeMemberKeys.value[alternative.defaultOrdinal - 1] ?? ""
    : "";
}

function alternativeMemberLabel(iri: string): string {
  return selectedAlternative()?.members.find((member) => member.iri === iri)?.label
    ?? resourceLabel(iri);
}

function moveAlternativeMember(index: number, delta: -1 | 1): void {
  const target = index + delta;
  if (target < 0 || target >= alternativeMemberIris.value.length) return;
  const [member] = alternativeMemberIris.value.splice(index, 1);
  alternativeMemberIris.value.splice(target, 0, member!);
  const [memberKey] = alternativeMemberKeys.value.splice(index, 1);
  alternativeMemberKeys.value.splice(target, 0, memberKey!);
}

function removeAlternativeMember(index: number): void {
  if (alternativeMemberIris.value.length <= 2) return;
  alternativeMemberIris.value.splice(index, 1);
  const [removedKey] = alternativeMemberKeys.value.splice(index, 1);
  if (removedKey === alternativeDefaultMemberKey.value) {
    alternativeDefaultMemberKey.value = alternativeMemberKeys.value[Math.min(index, alternativeMemberKeys.value.length - 1)] ?? "";
  }
}

function previewAlternative(): void {
  const alternative = selectedAlternative();
  const defaultOrdinal = alternativeMemberKeys.value.indexOf(alternativeDefaultMemberKey.value) + 1;
  if (!alternative || alternativeMemberIris.value.length < 2 || defaultOrdinal < 1) return;
  const defaultMemberIri = alternativeMemberIris.value[defaultOrdinal - 1];
  if (!defaultMemberIri) return;
  emit("executeCommands", [{
    type: "set-alternatives",
    commandId: "intent-alternatives",
    alternativeIri: alternative.alternativeIri,
    memberIris: [...alternativeMemberIris.value],
    defaultMemberIri,
    alternativeTypeIri: alternative.alternativeTypeIri,
    ordinalPredicatePrefix: alternative.ordinalPredicatePrefix,
    defaultOrdinal,
  }], t("semantic.history.editAlternatives", { label: alternative.label }), [{
    iri: alternative.alternativeIri,
    label: alternative.label,
    role: t("semantic.role.alternatives"),
  }]);
}

function membershipState(option: IntentMembershipOption): string {
  const count = props.selectedResources.filter((resource) => option.memberIris.includes(resource.iri)).length;
  if (count === 0) return t("semantic.membership.none");
  if (count === props.selectedResources.length) return t("semantic.membership.all");
  return t("semantic.membership.partial", { count, total: props.selectedResources.length });
}

function resourceLabel(iri: string): string {
  return props.resources.find((item) => item.iri === iri)?.label
    ?? props.selectedResources.find((item) => item.iri === iri)?.label
    ?? (props.selectedEdge?.sourceIri === iri ? props.selectedEdge.sourceLabel : undefined)
    ?? (props.selectedEdge?.targetIri === iri ? props.selectedEdge.targetLabel : undefined)
    ?? t("semantic.selectedElementFallback");
}

function membershipContainerKindLabel(kind: MembershipOverview["belongsTo"][number]["containerKind"]): string {
  if (kind === "sequence") return t("semantic.container.order");
  if (kind === "alternative") return t("semantic.container.alternatives");
  return kind === "region" ? t("semantic.container.region") : t("semantic.container.containment");
}

function membershipRoleLabel(item: MembershipOverview["belongsTo"][number]): string {
  if (item.role === "sequence-member") return t("semantic.membership.orderPosition", { ordinal: item.ordinal ?? "?" });
  if (item.role === "alternative-member") return t("semantic.membership.alternativePosition", { ordinal: item.ordinal ?? "?" });
  return t("semantic.membership.generic");
}

function canRemoveMembership(item: MembershipOverview["belongsTo"][number]): boolean {
  return item.provenance.editCapability?.command === "set-membership";
}

function removeMembership(item: MembershipOverview["belongsTo"][number]): void {
  removeMemberships([item], t("semantic.history.removeMembership", { label: item.label }));
}

function removeSelectedOverviewMemberships(): void {
  const selected = new Set(selectedOverviewMembershipKeys.value);
  const items = overviewMembershipItems().filter((item) => selected.has(overviewMembershipKey(item)));
  removeMemberships(items, t("semantic.history.removeMemberships", { count: items.length }));
  selectedOverviewMembershipKeys.value = [];
}

function removeMemberships(
  items: MembershipOverview["belongsTo"],
  labelText: string,
): void {
  const commands: AuthoringCommand[] = [];
  const resources: Array<{ iri: string; label: string; role: string }> = [];
  const seen = new Set<string>();
  for (const item of items) {
  const capability = item.provenance.editCapability;
    if (capability?.command !== "set-membership") continue;
    const identity = overviewMembershipKey(item);
    if (seen.has(identity)) continue;
    seen.add(identity);
    commands.push({
    type: "set-membership",
      commandId: items.length === 1
        ? "overview-remove-membership"
        : `overview-remove-membership-${commands.length + 1}`,
    containerIri: capability.container,
    memberIri: capability.member,
    enabled: false,
    containerTypeIri: capability.containerTypeIri,
    predicateIri: capability.predicate,
    containerPosition: capability.containerPosition,
    });
    resources.push(
      { iri: capability.container, label: resourceLabel(capability.container), role: t("semantic.role.region") },
      { iri: capability.member, label: resourceLabel(capability.member), role: t("semantic.role.member") },
    );
  }
  if (commands.length) emit("executeCommands", commands, labelText, resources);
}

function overviewMembershipItems(): MembershipOverview["belongsTo"] {
  const unique = new Map<string, MembershipOverview["belongsTo"][number]>();
  for (const item of [...props.membershipOverview.belongsTo, ...props.membershipOverview.contains]) {
    if (item.role === "membership" && canRemoveMembership(item)) {
      unique.set(overviewMembershipKey(item), item);
    }
  }
  return [...unique.values()];
}

function overviewMembershipKey(item: MembershipOverview["belongsTo"][number]): string {
  const capability = item.provenance.editCapability;
  return capability?.command === "set-membership"
    ? [capability.container, capability.member, capability.predicate, capability.containerPosition].join("\u0000")
    : item.semanticRef;
}

function overviewMembershipToken(item: MembershipOverview["belongsTo"][number]): string {
  const identity = overviewMembershipKey(item);
  const index = overviewMembershipItems().findIndex((candidate) => overviewMembershipKey(candidate) === identity);
  return index < 0 ? "" : `membership-${index + 1}`;
}

function overviewMembershipTokenForIdentity(identity: string): string {
  const item = overviewMembershipItems().find((candidate) => overviewMembershipKey(candidate) === identity);
  return item ? overviewMembershipToken(item) : "";
}

function allOverviewMembershipsSelected(): boolean {
  const items = overviewMembershipItems();
  return items.length > 0 && items.every((item) => selectedOverviewMembershipKeys.value.includes(overviewMembershipKey(item)));
}

function toggleAllOverviewMemberships(enabled: boolean): void {
  selectedOverviewMembershipKeys.value = enabled
    ? overviewMembershipItems().map(overviewMembershipKey)
    : [];
}

function editMembership(
  item: MembershipOverview["belongsTo"][number],
  direction: "belongs-to" | "contains",
): void {
  // A container's child list first moves selection to that child. For a
  // member's parent list the already-selected member remains the edit target.
  if (direction === "contains") emit("focusElement", item.relatedElementId);
  choose("edit-relation");
  if (item.containerKind === "sequence") {
    sequenceIri.value = direction === "belongs-to"
      ? item.relatedSemanticRef
      : props.selectedResources[0]?.iri ?? "";
    syncSequenceMembers();
  }
  if (item.containerKind === "alternative") {
    alternativeIri.value = direction === "belongs-to"
      ? item.relatedSemanticRef
      : props.selectedResources[0]?.iri ?? "";
    syncAlternativeMembers();
  }
}

function cloneTextValues(values: readonly IntentTextValue[], fallback = ""): IntentTextValue[] {
  const result = values.map((item) => ({ ...item }));
  if (result.length === 0 && fallback) result.push({ value: fallback });
  return result;
}

function addAlias(): void {
  labelValues.value.push(newTextValue());
}

function addComment(): void {
  commentValues.value.push(newTextValue());
}

function removeAlias(index: number): void {
  labelValues.value.splice(index, 1);
}

function removeComment(index: number): void {
  commentValues.value.splice(index, 1);
}

function addStatementComment(): void {
  statementCommentValues.value.push(newTextValue());
}

function removeStatementComment(index: number): void {
  statementCommentValues.value.splice(index, 1);
}

function newTextValue(): IntentTextValue {
  return {
    value: "",
    ...(props.defaultLocale ? { language: props.defaultLocale } : {}),
  };
}

function viewMatchLabel(match: IntentViewRuleMatch): string {
  return {
    exact: t("semantic.match.exact"),
    "explicit-subclass": t("semantic.match.subclass"),
    "explicit-subproperty": t("semantic.match.subproperty"),
    wildcard: t("semantic.match.wildcard"),
  }[match];
}

function fallbackLabel(reason: NonNullable<IntentViewResolution["fallbackReason"]>): string {
  return reason === "no-matching-rule" ? t("semantic.fallback.noMatch") : t("semantic.fallback.wildcard");
}

function relationPresentation(source: string, predicate: string, target: string): string {
  return locale.value === "ja"
    ? `${source}（${predicate}）${target}`
    : `${source} (${predicate}) ${target}`;
}

function labelWithDetail(labelText: string, detail: string): string {
  return locale.value === "ja"
    ? `${labelText}（${detail}）`
    : `${labelText} (${detail})`;
}

function structuralDetail(containerKind: string, role: string): string {
  return [containerKind, role].join(locale.value === "ja" ? "・" : t("canvas.listSeparator"));
}

function focusPendingIntent(): void {
  const primaryAction = panelRoot.value?.querySelector<HTMLElement>(
    ".iriograph-intent-fields button.primary:not([disabled])",
  );
  const firstField = panelRoot.value?.querySelector<HTMLElement>(
    ".iriograph-intent-fields textarea:not([disabled]), .iriograph-intent-fields input:not([disabled]), .iriograph-intent-fields select:not([disabled])",
  );
  (primaryAction ?? firstField ?? panelRoot.value)?.focus();
}

function focusEditSection(section: "membership" | "sequence" | "alternatives" | "reconnect"): void {
  const selector = {
    membership: ".iriograph-membership-editor",
    sequence: ".iriograph-sequence-editor:not(.iriograph-alternative-editor)",
    alternatives: ".iriograph-alternative-editor",
    reconnect: ".iriograph-intent-fields button",
  }[section];
  void nextTick(() => (panelRoot.value?.querySelector<HTMLElement>(selector) ?? panelRoot.value)?.focus());
}

defineExpose({ focusPendingIntent, focusEditSection, resetIntent: reset });
</script>

<template>
  <section ref="panelRoot" class="iriograph-intent-panel" :aria-label="t('semantic.panelAria')" tabindex="-1">
    <p v-if="blockedReason" class="iriograph-authoring-blocked">{{ blockedReason }}</p>
    <p v-if="guidance" class="iriograph-intent-guidance" role="status">{{ guidance }}</p>
    <ul v-if="diagnostics.length" class="iriograph-intent-diagnostics" :aria-label="t('semantic.resultAria')" role="status">
      <li v-for="(item, index) in diagnostics" :key="`${item.code}:${index}`" :class="item.severity">
        <b>{{ diagnosticGuidance(item, t).title }}</b><span>{{ diagnosticGuidance(item, t).action }}</span>
      </li>
    </ul>
    <template v-if="!intent">
      <header><small>{{ t('common.semantic') }}</small><strong>{{ t('semantic.selection') }}</strong></header>
      <section class="iriograph-semantic-selection-summary" :aria-label="t('semantic.selectionAria')">
        <template v-if="selectedEdge">
          <small>{{ t('common.relation') }}</small>
          <strong>{{ relationPresentation(selectedEdge.sourceLabel, selectedPredicateLabel, selectedEdge.targetLabel) }}</strong>
          <span v-if="selectedEdge.derivedReason">{{ selectedEdge.derivedReason }}</span>
          <span v-else>{{ statementCommentValues.length || selectedEdge.statementComments?.length ? t('semantic.descriptionCount', { count: selectedEdge.statementComments?.length ?? 0 }) : t('semantic.noDescription') }}</span>
        </template>
        <template v-else-if="inspectedResources.length">
          <small>{{ inspectedResources.length === 1 ? t('common.element') : t('semantic.selectedCount', { count: inspectedResources.length }) }}</small>
          <strong>{{ inspectedResources.map((item) => item.label ?? t('semantic.unnamedElement')).join(t('canvas.listSeparator')) }}</strong>
          <span>{{ t('semantic.connectionSummary', { relations: incidentRelations.length, memberships: inspectedMembershipCount }) }}</span>
        </template>
        <template v-else>
          <small>{{ t('semantic.noSelection') }}</small>
          <strong>{{ t('semantic.selectTarget') }}</strong>
          <span>{{ t('semantic.selectTargetHint') }}</span>
        </template>
      </section>
      <section v-if="selectedEdge && selectedPredicateMeaning" class="iriograph-predicate-explanation" :aria-label="t('semantic.relationMeaning')">
        <header><small>{{ t('semantic.relationMeaning') }}</small><strong>{{ selectedPredicateMeaning.label }}</strong></header>
        <p v-if="selectedPredicateMeaning.description">{{ selectedPredicateMeaning.description }}</p>
        <section v-if="selectedPredicateMeaning.hierarchyPaths.length">
          <strong>{{ t('semantic.parentRelations') }}</strong>
          <ul><li v-for="(path, index) in selectedPredicateMeaning.hierarchyPaths" :key="`predicate-path-${index}`">{{ path.labels.join(' → ') }}</li></ul>
          <p v-if="predicateInferencePolicy?.query === 'rdfs-subproperty' || predicateInferencePolicy?.validation === 'rdfs-subproperty'">
            <template v-if="predicateInferencePolicy?.query === 'rdfs-subproperty'">{{ t('semantic.queryUsesParents') }}</template>
            <template v-if="predicateInferencePolicy?.validation === 'rdfs-subproperty'"> {{ t('semantic.validationUsesParents') }}</template>
          </p>
        </section>
        <ul v-if="selectedPredicateMeaning.hierarchyDiagnostics.length" class="iriograph-intent-diagnostics">
          <li v-for="(item, index) in selectedPredicateMeaning.hierarchyDiagnostics" :key="`predicate-diagnostic-${index}`" class="warning"><b>{{ t('semantic.hierarchyInvalid') }}</b><span>{{ t('semantic.askAdministrator', { target: item.labels.join(' → ') || t('semantic.hierarchySetting') }) }}</span></li>
        </ul>
      </section>
      <section v-if="selectedEdge?.viewResolution" class="iriograph-view-resolution" :aria-label="t('semantic.viewRule')">
        <header><small>{{ t('semantic.viewRule') }}</small><strong>{{ t('semantic.viewRuleReason') }}</strong></header>
        <template v-if="selectedEdge.viewResolution.selectedMatch">
          <p>{{ t('semantic.viewRuleApplied', { match: viewMatchLabel(selectedEdge.viewResolution.selectedMatch) }) }}</p>
        </template>
        <p v-else-if="selectedEdge.viewResolution.fallbackReason">{{ fallbackLabel(selectedEdge.viewResolution.fallbackReason) }}</p>
        <p v-else>{{ t('semantic.viewRuleNoTrace') }}</p>
        <details v-if="selectedEdge.viewResolution.candidateMatches.length"><summary>{{ t('semantic.viewRuleCandidates', { count: selectedEdge.viewResolution.candidateMatches.length }) }}</summary><ul><li v-for="(match, index) in selectedEdge.viewResolution.candidateMatches" :key="`view-candidate-${index}`">{{ viewMatchLabel(match) }}</li></ul></details>
        <p v-if="selectedEdge.viewResolution.conflictCount" class="warning">{{ t('semantic.viewRuleConflicts', { count: selectedEdge.viewResolution.conflictCount }) }}</p>
      </section>
      <section
        v-if="!selectedEdge && inspectedResources.length === 1"
        class="iriograph-relation-overview iriograph-membership-overview"
        :aria-label="t('semantic.membershipOverview')"
      >
        <div v-if="overviewMembershipItems().length" class="iriograph-membership-batch-actions">
          <label><input type="checkbox" :checked="allOverviewMembershipsSelected()" @change="toggleAllOverviewMemberships(($event.target as HTMLInputElement).checked)" />{{ t('semantic.selectAllMemberships') }}</label>
          <button type="button" :disabled="!selectedOverviewMembershipKeys.length || !enabled || busy" @click="removeSelectedOverviewMemberships">{{ t('semantic.removeSelectedMemberships', { count: selectedOverviewMembershipKeys.length }) }}</button>
        </div>
        <section :aria-label="t('semantic.belongsTo')">
          <strong>{{ t('semantic.belongsTo') }} <small>{{ t('common.itemCount', { count: membershipOverview.belongsTo.length }) }}</small></strong>
          <ul v-if="membershipOverview.belongsTo.length">
            <li v-for="item in membershipOverview.belongsTo" :key="`parent:${item.semanticRef}:${item.relatedElementId}:${item.ordinal ?? 0}`">
              <input v-if="item.role === 'membership' && canRemoveMembership(item)" v-model="selectedOverviewMembershipTokens" type="checkbox" :value="overviewMembershipToken(item)" :aria-label="t('semantic.selectMembership', { label: item.label })" />
              <span>{{ item.label }}</span>
              <small>{{ structuralDetail(membershipContainerKindLabel(item.containerKind), membershipRoleLabel(item)) }}</small>
              <span class="iriograph-membership-overview-actions">
                <button type="button" @click="emit('focusElement', item.relatedElementId)">{{ t('semantic.checkOnCanvas') }}</button>
                <button type="button" :disabled="!enabled || busy" @click="editMembership(item, 'belongs-to')">{{ item.containerKind === 'sequence' ? t('semantic.editOrder') : item.containerKind === 'alternative' ? t('semantic.editAlternatives') : t('semantic.editThisMembership') }}</button>
                <button v-if="canRemoveMembership(item)" type="button" :disabled="!enabled || busy" @click="removeMembership(item)">{{ t('semantic.removeMembership') }}</button>
              </span>
            </li>
          </ul>
          <p v-else>{{ t('semantic.noBelongsTo') }}</p>
        </section>
        <section :aria-label="t('semantic.contains')">
          <strong>{{ t('semantic.contains') }} <small>{{ t('common.itemCount', { count: membershipOverview.contains.length }) }}</small></strong>
          <ul v-if="membershipOverview.contains.length">
            <li v-for="item in membershipOverview.contains" :key="`child:${item.semanticRef}:${item.relatedElementId}:${item.ordinal ?? 0}`">
              <input v-if="item.role === 'membership' && canRemoveMembership(item)" v-model="selectedOverviewMembershipTokens" type="checkbox" :value="overviewMembershipToken(item)" :aria-label="t('semantic.selectContainment', { label: item.label })" />
              <span>{{ item.label }}</span>
              <small>{{ structuralDetail(membershipContainerKindLabel(item.containerKind), membershipRoleLabel(item)) }}</small>
              <span class="iriograph-membership-overview-actions">
                <button type="button" @click="emit('focusElement', item.relatedElementId)">{{ t('semantic.checkOnCanvas') }}</button>
                <button type="button" :disabled="!enabled || busy" @click="editMembership(item, 'contains')">{{ item.containerKind === 'sequence' ? t('semantic.editOrder') : item.containerKind === 'alternative' ? t('semantic.editAlternatives') : t('semantic.editThisMembership') }}</button>
                <button v-if="canRemoveMembership(item)" type="button" :disabled="!enabled || busy" @click="removeMembership(item)">{{ t('semantic.removeContainment') }}</button>
              </span>
            </li>
          </ul>
          <p v-else>{{ t('semantic.noContains') }}</p>
        </section>
      </section>
      <nav class="iriograph-intent-grid iriograph-intent-add-actions" :aria-label="t('semantic.addMeaning')">
        <button type="button" :disabled="!enabled || busy" @click="choose('add-element')"><b>＋</b><span>{{ t('semantic.addElement') }}</span></button>
        <button type="button" :disabled="!enabled || busy" @click="choose('add-relation')"><b>→</b><span>{{ t('semantic.addRelation') }}</span></button>
      </nav>
      <nav v-if="selectedEdge || inspectedResources.length" class="iriograph-selection-edit-actions" :aria-label="t('semantic.editSelected')">
        <button v-if="selectedEdge" type="button" :disabled="!enabled || busy" @click="choose('edit-relation')">{{ t('semantic.editRelationMeaning') }}</button>
        <template v-else>
          <button v-if="inspectedResources.length === 1" type="button" :disabled="!enabled || busy" @click="choose('edit-element')">{{ t('semantic.editElementDetails') }}</button>
          <button type="button" :disabled="!enabled || busy" @click="choose('edit-relation')">{{ t('semantic.editMembershipOrder') }}</button>
        </template>
      </nav>
    </template>

    <template v-else>
      <header><button type="button" :aria-label="t('semantic.backToSelection')" @click="cancel">←</button><strong>{{ intent === 'add-element' ? t('semantic.addElement') : intent === 'add-relation' ? t('semantic.addRelation') : intent === 'edit-element' ? t('semantic.editElementDetails') : selectedEdge ? t('semantic.editRelationMeaning') : t('semantic.editMembershipOrder') }}</strong></header>

      <section v-if="intent === 'add-element'" class="iriograph-intent-fields">
        <p>{{ t('semantic.elementCreateHint') }}</p>
        <label><span>{{ t('common.name') }}</span><textarea v-model="label" :aria-label="t('semantic.newElementName')" rows="2" /></label>
        <button type="button" class="primary" :disabled="!label.trim() || busy" @click="previewElementCreation">{{ t('semantic.createElement') }}</button>
      </section>

      <section v-else-if="intent === 'add-relation'" class="iriograph-intent-fields">
        <p>{{ t('semantic.relationCreateHint') }}</p>
        <div class="iriograph-intent-selection"><b>{{ t('semantic.source') }}</b><span>{{ relationSelection.source?.label ?? t('semantic.notSelected') }}</span><b>{{ t('semantic.target') }}</b><span>{{ relationSelection.targets[0]?.label ?? t('semantic.notSelected') }}</span></div>
        <div class="iriograph-intent-grid">
          <button type="button" :disabled="!enabled || busy" @click="emit('pickResource', 'sourceIri')">{{ t('semantic.reselectSource') }}</button>
          <button type="button" :disabled="!enabled || busy || !sourceIri" @click="emit('pickResource', 'targetIri')">{{ t('semantic.reselectTarget') }}</button>
        </div>
        <p v-if="sourceIri && !targetIri">{{ t('semantic.selectOtherTarget') }}</p>
        <button v-if="sourceIri" type="button" :disabled="!enabled || busy || !predicateIri" @click="useSourceAsTarget">{{ t('semantic.connectToSelf') }}</button>
        <p v-if="predicateSelectionGuidance" class="iriograph-intent-guidance" role="status">{{ predicateSelectionGuidance }}</p>
        <section class="iriograph-predicate-cards" :aria-label="t('semantic.relationKinds')">
          <header><strong>{{ t('semantic.relationKinds') }}</strong><small>{{ t('semantic.relationKindsHint') }}</small></header>
          <fieldset v-for="group in predicateGroups" :key="group.category" class="iriograph-intent-group-card iriograph-predicate-group">
            <legend>{{ group.category }}</legend>
            <article v-for="choice in group.choices" :key="predicateToken(choice)" :class="{ selected: predicateIri === choice.iri }">
              <label>
                <input v-model="selectedPredicateToken" type="radio" :value="predicateToken(choice)" @change="confirmPredicateSelection" />
                <strong>{{ relationPresentation('A', choice.label ?? t('semantic.relationFallback'), 'B') }}</strong>
                <span class="iriograph-predicate-sentence">{{ choice.sentencePattern ?? relationPresentation('A', choice.label ?? t('semantic.relationFallback'), 'B') }}</span>
                <small v-if="choice.description">{{ choice.description }}</small>
              </label>
              <details v-if="predicateMeanings[choice.iri]?.hierarchyPaths.length || predicateMeanings[choice.iri]?.hierarchyDiagnostics.length"><summary>{{ t('semantic.parentRelations') }}</summary><ul><li v-for="(path, index) in predicateMeanings[choice.iri]?.hierarchyPaths ?? []" :key="`predicate-choice-path-${index}`">{{ path.labels.join(' → ') }}</li></ul><p v-if="predicateInferencePolicy?.query === 'rdfs-subproperty'">{{ t('semantic.queryUsesParents') }}</p><p v-if="predicateInferencePolicy?.validation === 'rdfs-subproperty'">{{ t('semantic.validationUsesParents') }}</p><ul v-if="predicateMeanings[choice.iri]?.hierarchyDiagnostics.length" class="iriograph-intent-diagnostics"><li v-for="(item, index) in predicateMeanings[choice.iri]?.hierarchyDiagnostics" :key="`predicate-choice-diagnostic-${index}`" class="warning">{{ item.labels.join(' → ') }}</li></ul></details>
            </article>
          </fieldset>
        </section>
        <p v-if="predicateIri && targetIri">{{ t('semantic.createOneRelation', { label: selectedPredicateLabel }) }}</p>
        <button type="button" class="primary" :disabled="!relationReady || busy" @click="previewRelationCreation">{{ t('semantic.createRelation') }}</button>
      </section>

      <section v-else-if="intent === 'edit-element'" class="iriograph-intent-fields">
        <p v-if="!elementDetails">{{ t('semantic.selectElementToEdit') }}</p>
        <template v-else>
          <label><span>{{ t('common.name') }}</span><textarea v-model="label" :aria-label="t('semantic.elementName')" rows="2" /></label>
          <fieldset class="iriograph-intent-group-card"><legend>{{ t('semantic.alias') }}</legend><section v-for="(item, index) in labelValues.slice(1)" :key="index"><label><span>{{ t('semantic.alias') }}</span><textarea v-model="item.value" :aria-label="t('semantic.aliasAria', { index: index + 1 })" rows="2" /></label><button type="button" :aria-label="t('semantic.deleteAliasAria', { index: index + 1 })" @click="removeAlias(index + 1)">{{ t('semantic.deleteAlias') }}</button></section><button type="button" @click="addAlias">{{ t('semantic.newAlias') }}</button></fieldset>
          <fieldset class="iriograph-intent-group-card"><legend>{{ t('common.description') }}</legend><section v-for="(item, index) in commentValues" :key="index"><label><span>{{ t('common.description') }}</span><textarea v-model="item.value" :aria-label="t('semantic.descriptionAria', { index: index + 1 })" rows="3" /></label><button type="button" :aria-label="t('semantic.deleteDescriptionAria', { index: index + 1 })" @click="removeComment(index)">{{ t('semantic.deleteDescription') }}</button></section><button type="button" @click="addComment">{{ t('semantic.newDescription') }}</button></fieldset>
          <fieldset class="iriograph-intent-group-card iriograph-semantic-type-editor"><legend>{{ t('semantic.elementTypes') }}</legend><label v-for="choice in semanticTypeChoices" :key="semanticTypeToken(choice)"><input v-model="selectedSemanticTypeTokens" type="checkbox" :value="semanticTypeToken(choice)" /><span>{{ choice.label ?? t('common.type') }}<small v-if="classificationRegionIris.has(choice.iri)">{{ t('semantic.classificationRegionReflection') }}</small></span></label><p v-if="semanticTypeChoices.length === 0">{{ t('semantic.noTypes') }}</p></fieldset>
          <section class="iriograph-intent-group-card iriograph-current-memberships" :aria-label="t('semantic.memberGroups')"><strong>{{ t('semantic.memberGroups') }}</strong><template v-if="currentConceptRegions.length"><small>{{ t('semantic.conceptRegions') }}</small><ul><li v-for="option in currentConceptRegions" :key="option.containerIri">{{ option.label }}</li></ul></template><small>{{ t('semantic.businessMembership') }}</small><ul v-if="currentBusinessMemberships.length"><li v-for="option in currentBusinessMemberships" :key="option.containerIri">{{ option.label }}</li></ul><p v-else>{{ t('semantic.noBusinessMembership') }}</p><small>{{ t('semantic.businessMembershipHint') }}</small></section>
          <section v-if="incidentRelations.length" class="iriograph-relation-overview" :aria-label="t('semantic.connectedRelations')"><strong>{{ t('semantic.connectedRelations') }}</strong><ul><li v-for="relation in incidentRelations" :key="relation.edgeElementId"><span>{{ relationPresentation(relation.sourceLabel, relation.predicateLabel, relation.targetLabel) }}</span><small>{{ relation.direction === 'outgoing' ? t('semantic.outgoing') : relation.direction === 'incoming' ? t('semantic.incoming') : t('semantic.self') }}</small><button type="button" @click="emit('focusElement', relation.edgeElementId)">{{ t('semantic.checkOnCanvas') }}</button></li></ul></section>
          <button type="button" class="primary" :disabled="!label.trim() || busy" @click="previewElementEdit">{{ t('semantic.saveChanges') }}</button>
          <details class="iriograph-danger-zone"><summary>{{ t('semantic.deleteElement') }}</summary><p>{{ t('semantic.deleteElementHint') }}</p><button type="button" :disabled="busy" @click="previewElementDelete">{{ t('semantic.deleteSelectedElement') }}</button></details>
        </template>
      </section>

      <section v-else class="iriograph-intent-fields">
        <template v-if="selectedEdge && !selectedEdge.derivedReason">
            <section class="iriograph-relation-overview" :aria-label="t('semantic.connectedElements')"><strong>{{ t('semantic.connectedElements') }}</strong><div class="iriograph-intent-selection"><b>{{ t('semantic.source') }}</b><span>{{ resourceLabel(sourceIri) }}</span><b>{{ t('common.relation') }}</b><span>{{ selectedPredicateLabel }}</span><b>{{ t('semantic.target') }}</b><span>{{ resourceLabel(targetIri) }}</span></div></section>
            <button type="button" :disabled="!enabled || busy" @click="emit('pickResource', 'sourceIri')">{{ t('semantic.selectSourceCanvas') }}</button>
            <button type="button" :disabled="!enabled || busy" @click="emit('pickResource', 'targetIri')">{{ t('semantic.selectTargetCanvas') }}</button>
            <label><span>{{ t('common.relation') }}</span><select v-model="selectedPredicateToken" @change="confirmPredicateSelection"><optgroup v-for="group in predicateGroups" :key="group.category" :label="group.category"><option v-for="choice in group.choices" :key="predicateToken(choice)" :value="predicateToken(choice)">{{ relationPresentation('A', choice.label ?? t('semantic.relationFallback'), 'B') }} — {{ choice.sentencePattern ?? relationPresentation('A', choice.label ?? t('semantic.relationFallback'), 'B') }}</option></optgroup></select></label>
            <section v-if="selectedPredicateMeaning" class="iriograph-predicate-explanation" :aria-label="t('semantic.selectedRelationMeaning')"><strong>{{ selectedPredicateMeaning.label }}</strong><p v-if="selectedPredicateMeaning.description">{{ selectedPredicateMeaning.description }}</p><details v-if="selectedPredicateMeaning.hierarchyPaths.length"><summary>{{ t('semantic.parentRelations') }}</summary><ul><li v-for="(path, index) in selectedPredicateMeaning.hierarchyPaths" :key="`selected-predicate-path-${index}`">{{ path.labels.join(' → ') }}</li></ul></details></section>
            <p v-if="predicateSelectionGuidance" class="iriograph-intent-guidance" role="status">{{ predicateSelectionGuidance }}</p>
            <fieldset class="iriograph-intent-group-card"><legend>{{ t('semantic.edgeSpecificDescription') }}</legend><p>{{ t('semantic.edgeDescriptionHint') }}</p><section v-for="(item, index) in statementCommentValues" :key="index"><label><span>{{ t('common.description') }}</span><textarea v-model="item.value" :aria-label="t('semantic.edgeDescriptionAria', { index: index + 1 })" rows="3" /></label><button type="button" :aria-label="t('semantic.deleteEdgeDescriptionAria', { index: index + 1 })" @click="removeStatementComment(index)">{{ t('semantic.deleteDescription') }}</button></section><button type="button" @click="addStatementComment">{{ t('semantic.newDescription') }}</button></fieldset>
            <button type="button" class="primary" :disabled="!sourceIri || !targetIri || !predicateSelectionValid || busy" @click="previewEdgeEdit">{{ t('semantic.updateRelation') }}</button>
            <button type="button" :disabled="busy" @click="previewEdgeDelete">{{ t('semantic.deleteThisRelation') }}</button>
        </template>
        <template v-else>
          <p v-if="selectedEdge?.derivedReason" class="iriograph-intent-guidance">{{ selectedEdge.derivedReason }}</p>
          <p v-if="selectedResources.length === 0 && !sequences.length && !alternatives.length">{{ t('semantic.chooseMembershipHint') }}</p>
          <template v-else>
            <section v-if="incidentRelations.length" class="iriograph-relation-overview" :aria-label="t('semantic.connectedRelations')"><strong>{{ t('semantic.connectedRelations') }}</strong><ul><li v-for="relation in incidentRelations" :key="relation.edgeElementId"><span>{{ relationPresentation(relation.sourceLabel, relation.predicateLabel, relation.targetLabel) }}</span><small>{{ relation.direction === 'outgoing' ? t('semantic.outgoing') : relation.direction === 'incoming' ? t('semantic.incoming') : t('semantic.self') }}<template v-if="relation.derivedReason"> · {{ t('semantic.derived') }}</template></small><button type="button" @click="emit('focusElement', relation.edgeElementId)">{{ t('semantic.checkOnCanvas') }}</button></li></ul></section>
            <section v-if="sequences.length" class="iriograph-sequence-editor" :aria-label="t('semantic.orderEditor')" tabindex="-1">
              <label v-if="sequences.length > 1"><span>{{ t('semantic.chooseOrder') }}</span><select v-model="selectedSequenceToken" @change="syncSequenceMembers"><option value="">{{ t('semantic.chooseOption') }}</option><option v-for="option in sequences" :key="sequenceToken(option)" :value="sequenceToken(option)">{{ option.label }}</option></select></label>
              <template v-if="selectedSequence()">
                <strong>{{ selectedSequence()!.label }}</strong>
                <p>{{ t('semantic.orderHint') }}</p>
                <ol><li v-for="(memberIri, index) in sequenceMemberIris" :key="`sequence-member-${index}`"><b>{{ index + 1 }}</b><span>{{ sequenceMemberLabel(memberIri) }}</span><button type="button" :disabled="index === 0" :aria-label="t('semantic.moveForwardAria', { label: sequenceMemberLabel(memberIri) })" @click="moveSequenceMember(index, -1)">↑</button><button type="button" :disabled="index === sequenceMemberIris.length - 1" :aria-label="t('semantic.moveBackwardAria', { label: sequenceMemberLabel(memberIri) })" @click="moveSequenceMember(index, 1)">↓</button><button type="button" :aria-label="t('semantic.removeFromOrderAria', { label: sequenceMemberLabel(memberIri) })" @click="removeSequenceMember(index)">{{ t('semantic.exclude') }}</button></li></ol>
                <button v-if="sequenceCandidates().length" type="button" @click="addSelectedSequenceMembers">{{ t('semantic.addSelectedToOrder', { count: sequenceCandidates().length }) }}</button>
                <button type="button" class="primary" :disabled="sequenceMemberIris.length === 0 || busy" @click="previewSequence">{{ t('semantic.updateOrder') }}</button>
              </template>
            </section>
            <section v-if="alternatives.length" class="iriograph-sequence-editor iriograph-alternative-editor" :aria-label="t('semantic.alternativeEditor')" tabindex="-1">
              <label v-if="alternatives.length > 1"><span>{{ t('semantic.chooseBranch') }}</span><select v-model="selectedAlternativeToken" @change="syncAlternativeMembers"><option value="">{{ t('semantic.chooseOption') }}</option><option v-for="option in alternatives" :key="alternativeToken(option)" :value="alternativeToken(option)">{{ option.label }}</option></select></label>
              <template v-if="selectedAlternative()">
                <strong>{{ selectedAlternative()!.label }}</strong>
                <p>{{ t('semantic.alternativeHint') }}</p>
                <ol><li v-for="(memberIri, index) in alternativeMemberIris" :key="alternativeMemberKeys[index]"><b>{{ index + 1 }}</b><label><input v-model="alternativeDefaultMemberKey" type="radio" :value="alternativeMemberKeys[index]" name="iriograph-intent-default-alternative" />{{ t('semantic.defaultCandidate') }}</label><span>{{ alternativeMemberLabel(memberIri) }}</span><button type="button" :disabled="index === 0" :aria-label="t('semantic.moveForwardAria', { label: alternativeMemberLabel(memberIri) })" @click="moveAlternativeMember(index, -1)">↑</button><button type="button" :disabled="index === alternativeMemberIris.length - 1" :aria-label="t('semantic.moveBackwardAria', { label: alternativeMemberLabel(memberIri) })" @click="moveAlternativeMember(index, 1)">↓</button><button type="button" :disabled="alternativeMemberIris.length <= 2" :aria-label="t('semantic.removeFromAlternativesAria', { label: alternativeMemberLabel(memberIri) })" @click="removeAlternativeMember(index)">{{ t('semantic.exclude') }}</button></li></ol>
                <button type="button" class="primary" :disabled="alternativeMemberIris.length < 2 || !alternativeDefaultMemberKey || busy" @click="previewAlternative">{{ t('semantic.updateAlternatives') }}</button>
              </template>
            </section>
            <section v-if="editableMemberships.length" class="iriograph-membership-editor" :aria-label="t('semantic.membershipEditor')" tabindex="-1">
              <strong>{{ t('semantic.memberGroups') }}</strong><p>{{ t('semantic.membershipHint') }}</p>
              <label v-for="option in editableMemberships" :key="option.containerIri"><span>{{ labelWithDetail(option.label, membershipState(option)) }}</span><select v-model="membershipActions[option.containerIri]"><option value="keep">{{ t('semantic.keep') }}</option><option value="add">{{ t('semantic.addAllSelected') }}</option><option value="remove">{{ t('semantic.removeAllSelected') }}</option></select></label>
              <button type="button" class="primary" :disabled="!Object.values(membershipActions).some((value) => value !== 'keep') || busy" @click="previewMemberships">{{ t('semantic.updateMembership') }}</button>
            </section>
            <p v-if="!sequences.length && !alternatives.length && !editableMemberships.length">{{ t('semantic.noStructures') }}</p>
          </template>
        </template>
      </section>
    </template>

  </section>
</template>
