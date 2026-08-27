import { DataFactory, Parser, Store, type Quad } from "n3";

import type {
  AuthoringCommand,
  AuthoringObjectValue,
  AuthoringPreview,
  PreviewAuthoringOptions,
  ResolvedAuthoringContext,
  ResolvedAuthoringTerm,
  ResourceIriAllocator,
} from "./authoring-model.js";
import { previewAuthoringCommands } from "./authoring.js";
import type { IriographDocument, ProjectionDiagnostic } from "./model.js";
import { buildIriographView } from "./scene.js";
import {
  isAllowedResourceIri,
  RDF_ALT,
  RDF_BAG,
  RDF_ORDINAL_PREFIX,
  RDF_SEQ,
  RDF_TYPE,
  RDFS_CLASS,
  RDFS_COMMENT,
  RDFS_LABEL,
  RDFS_MEMBER,
  XSD_STRING,
} from "./authoring-validation.js";

const { namedNode } = DataFactory;

export type StructuredGroupKind =
  | "classification"
  | "membership"
  | "sequence"
  | "alternative";

/** Canvas identity is intentionally the only existing-resource identity accepted by this facade. */
export type StructuredCanvasSelection = {
  viewId: string;
  elementId: string;
};

export type StructuredNewNode = {
  kind: "new-node";
  clientId: string;
  label: string;
  nodeRoleIds: readonly string[];
  suggestedLocalName?: string;
};

export type StructuredExistingMember = {
  kind: "existing";
  selection: StructuredCanvasSelection;
};

export type StructuredGroupMember = StructuredExistingMember | StructuredNewNode;

export type StructuredAuthoringRequest =
  | {
      type: "create-element";
      requestId: string;
      element:
        | {
            kind: "node";
            label: string;
            nodeRoleIds: readonly string[];
            suggestedLocalName?: string;
          }
        | {
            kind: "group";
            label: string;
            groupKind: StructuredGroupKind;
            suggestedLocalName?: string;
          };
    }
  | {
      type: "change-group-kind";
      requestId: string;
      group: StructuredCanvasSelection;
      groupKind: StructuredGroupKind;
    }
  | {
      type: "set-node-roles";
      requestId: string;
      node: StructuredCanvasSelection;
      /** Complete final role selection. Role IDs are opaque and profile-owned. */
      nodeRoleIds: readonly string[];
    }
  | {
      type: "create-direct-relations";
      requestId: string;
      source: StructuredCanvasSelection;
      /** Common predicate. A row predicate may override it. */
      predicateId?: string;
      targets: readonly {
        target: StructuredCanvasSelection;
        predicateId?: string;
      }[];
    }
  | {
      type: "set-group-members";
      requestId: string;
      group: StructuredCanvasSelection;
      /** Bag/class: members to add. Seq/Alt: complete final order. */
      members: readonly StructuredGroupMember[];
      /** For alternatives, selects the occurrence moved to ordinal 1 as the default. */
      defaultMemberIndex?: number;
    }
  | {
      type: "remove-group-members";
      requestId: string;
      viewId: string;
      /** Opaque identities returned by `structuredMembershipPresentation`. */
      membershipIds: readonly string[];
    }
  | {
      type: "delete-element";
      requestId: string;
      target: StructuredCanvasSelection;
      cascade?: boolean;
    }
  | {
      type: "update-localized-text";
      requestId: string;
      target: StructuredCanvasSelection;
      field: "label" | "comment";
      /** Opaque identity returned by `structuredLocalizedTextPresentation`. */
      valueId: string;
      value: string;
    }
  | {
      type: "add-localized-text";
      requestId: string;
      target: StructuredCanvasSelection;
      field: "label" | "comment";
      value: string;
    }
  | {
      type: "remove-localized-text";
      requestId: string;
      target: StructuredCanvasSelection;
      field: "label" | "comment";
      /** Opaque identity returned by `structuredLocalizedTextPresentation`. */
      valueId: string;
    };

export type StructuredAuthoringPresentation = {
  profile: {
    allowUntypedNodes: boolean;
    nodeRoles: readonly {
      roleId: string;
      label: string;
      description?: string;
      displayPriority?: number;
    }[];
  };
  groupKinds: readonly {
    groupKind: StructuredGroupKind;
    label: string;
    description: string;
    role: "group";
    enabled: boolean;
    disabledReason?: string;
  }[];
  relationFamilies: readonly {
    family: "direct" | "membership";
    label: string;
    description: string;
  }[];
  /** Deliberately separate from profile node/group metadata. */
  predicateCatalog: readonly {
    predicateId: string;
    label: string;
    description?: string;
    category?: string;
    sentencePattern?: string;
  }[];
  capabilities: readonly {
    capabilityId: string;
    label: string;
    description?: string;
    role?: "direct-relation" | "membership" | "sequence" | "alternative";
    groupKind?: StructuredGroupKind;
  }[];
};

export type StructuredAuthoringPreviewResult = {
  valid: boolean;
  preview?: AuthoringPreview;
  diagnostics: ProjectionDiagnostic[];
};

export type StructuredNodeRoleSeedResult = {
  valid: boolean;
  /** Only opaque profile role IDs cross the presentation boundary. */
  roleIds: readonly string[];
  diagnostics: ProjectionDiagnostic[];
};

export type StructuredLocalizedTextPresentation = {
  valid: boolean;
  fields: readonly {
    field: "label" | "comment";
    label: string;
    values: readonly {
      valueId: string;
      value: string;
      localeKind: "default" | "translation" | "untagged" | "typed";
    }[];
  }[];
  diagnostics: ProjectionDiagnostic[];
};

export type StructuredMembershipPresentation = {
  valid: boolean;
  targetKind: "node" | "group";
  groupKind?: StructuredGroupKind;
  items: readonly {
    membershipId: string;
    direction: "belongs-to" | "contains";
    relatedElementId: string;
    relatedLabel: string;
    groupElementId: string;
    groupLabel: string;
    groupKind: StructuredGroupKind;
    role: "membership" | "sequence-member" | "alternative-member";
    ordinal?: number;
    removable: boolean;
    disabledReason?: string;
  }[];
  diagnostics: ProjectionDiagnostic[];
};

export type StructuredPredicateHierarchyInput = {
  predicates: readonly {
    /** Internal exact predicate identity supplied by the host; never returned. */
    predicateIri: string;
    paths: readonly {
      /** Root-to-ancestor exact predicate path. */
      iris: readonly string[];
      /** Label at each matching path position. */
      labels: readonly string[];
    }[];
    diagnostics?: readonly {
      code: string;
      /** Human labels only. Raw diagnostic messages are deliberately not accepted. */
      labels?: readonly string[];
    }[];
    truncated?: boolean;
  }[];
  inferencePolicy: {
    query: "exact" | "rdfs-subproperty";
    validation: "exact" | "rdfs-subproperty";
  };
};

export type StructuredPredicateHierarchyPresentation = {
  predicates: readonly {
    predicateId: string;
    label: string;
    paths: readonly {
      predicateIds: readonly string[];
      labels: readonly string[];
    }[];
    diagnostics: readonly {
      code: string;
      message: string;
      labels: readonly string[];
    }[];
    truncated: boolean;
  }[];
  queryExplanation: string;
  validationExplanation: string;
};

const GROUP_KIND_INFO: readonly Omit<StructuredAuthoringPresentation["groupKinds"][number], "enabled" | "disabledReason">[] = [
  {
    groupKind: "classification",
    label: "分類グループ",
    description: "同じ概念に分類される要素をまとめます。",
    role: "group",
  },
  {
    groupKind: "membership",
    label: "包含グループ",
    description: "順序を持たない所属として要素をまとめます。",
    role: "group",
  },
  {
    groupKind: "sequence",
    label: "順序付きグループ",
    description: "保存された番号順に要素を並べます。",
    role: "group",
  },
  {
    groupKind: "alternative",
    label: "候補グループ",
    description: "複数候補と既定候補をまとめます。",
    role: "group",
  },
];

const RELATION_FAMILIES: StructuredAuthoringPresentation["relationFamilies"] = [
  {
    family: "direct",
    label: "線でつなぐ",
    description: "一つの始点から一つ以上の接続先へ意味のある関係を作ります。",
  },
  {
    family: "membership",
    label: "グループへ所属させる",
    description: "既存のグループへ一つ以上の要素を追加します。",
  },
];

export function structuredAuthoringPresentation(
  context: ResolvedAuthoringContext,
): StructuredAuthoringPresentation {
  const profile = context.structuredAuthoring;
  const predicates = context.terms
    .filter(isDirectPredicateTerm)
    .map((term) => ({
      predicateId: predicateId(term),
      label: term.label ?? "名称未設定の関係",
      description: term.description,
      category: term.category,
      sentencePattern: term.sentencePattern,
    }))
    .sort((left, right) => (
      compareText(left.category ?? "", right.category ?? "")
      || compareText(left.label, right.label)
      || compareText(left.predicateId, right.predicateId)
    ));
  return {
    profile: {
      allowUntypedNodes: profile?.allowUntypedNodes === true,
      nodeRoles: (profile?.nodeRoles ?? []).map(({ roleId, label, description, displayPriority }) => ({
        roleId,
        label,
        description,
        displayPriority,
      })),
    },
    groupKinds: GROUP_KIND_INFO.map((item) => ({
      ...item,
      enabled: item.groupKind !== "classification"
        || profile?.allowClassificationGroups === true,
      ...(item.groupKind === "classification" && profile?.allowClassificationGroups !== true
        ? { disabledReason: "現在のプロファイルでは新しい分類グループを作成できません。" }
        : {}),
    })),
    relationFamilies: RELATION_FAMILIES.map((item) => ({ ...item })),
    predicateCatalog: predicates,
    capabilities: context.capabilities.map((capability) => ({
      capabilityId: capability.capabilityId,
      label: capability.label ?? "名称未設定の操作",
      description: capability.description,
      role: capability.role,
      groupKind: capability.groupKind,
    })),
  };
}

/**
 * Converts a host-resolved exact predicate hierarchy into an opaque,
 * label-only DTO. Core does not depend on semantic-access and never returns
 * the input IRIs. Top-level unknown or structural predicates are omitted.
 */
export function structuredPredicateHierarchyPresentation(
  context: ResolvedAuthoringContext,
  input: StructuredPredicateHierarchyInput,
): StructuredPredicateHierarchyPresentation {
  const allInputIris = input.predicates.flatMap((predicate) => [
    predicate.predicateIri,
    ...predicate.paths.flatMap((path) => path.iris),
  ]);
  const predicates = input.predicates.flatMap((predicate) => {
    const exact = context.terms.find((term) => (
      term.iri === predicate.predicateIri && isDirectPredicateTerm(term)
    ));
    if (!exact) return [];
    const paths = predicate.paths.map((path) => ({
      predicateIds: path.iris.map((iri) => predicateIdForHierarchyIri(context, iri)),
      labels: path.iris.map((iri, index) => hierarchyLabel(
        path.labels[index],
        context.terms.find((term) => term.iri === iri)?.label,
        allInputIris,
      )),
    })).sort((left, right) => compareText(
      left.predicateIds.join("\u0000"),
      right.predicateIds.join("\u0000"),
    ));
    const diagnostics = (predicate.diagnostics ?? []).map((diagnostic) => {
      const labels = (diagnostic.labels ?? []).map((label) => hierarchyLabel(
        label,
        undefined,
        allInputIris,
      ));
      return {
        code: diagnostic.code,
        message: hierarchyDiagnosticMessage(diagnostic.code, labels),
        labels,
      };
    }).sort((left, right) => (
      compareText(left.code, right.code)
      || compareText(left.labels.join("\u0000"), right.labels.join("\u0000"))
    ));
    return [{
      predicateId: predicateId(exact),
      label: hierarchyLabel(exact.label, undefined, allInputIris),
      paths,
      diagnostics,
      truncated: predicate.truncated === true
        || diagnostics.some((diagnostic) => diagnostic.code === "hierarchy-path-budget-exceeded"),
    }];
  }).sort((left, right) => (
    compareText(left.label, right.label)
    || compareText(left.predicateId, right.predicateId)
  ));
  return {
    predicates,
    queryExplanation: input.inferencePolicy.query === "rdfs-subproperty"
      ? "検索では意味上の上位関係としても扱います。"
      : "検索では選択した関係だけを扱います。",
    validationExplanation: input.inferencePolicy.validation === "rdfs-subproperty"
      ? "検証では意味上の上位関係としても扱います。"
      : "検証では選択した関係だけを扱います。",
  };
}

/**
 * Converts one classification region, or several regions selected as a
 * derived intersection, into opaque profile role IDs. Geometry alone is never
 * interpreted as classification.
 */
export async function structuredNodeRoleSeedFromCanvasSelections(
  document: IriographDocument,
  selections: readonly StructuredCanvasSelection[],
  context: ResolvedAuthoringContext,
  signal?: AbortSignal,
): Promise<StructuredNodeRoleSeedResult> {
  const diagnostics: ProjectionDiagnostic[] = [];
  const profile = context.structuredAuthoring;
  if (!profile) {
    diagnostics.push(error(
      "structured-authoring-profile-required",
      "要素の種類を読み込めません。管理者にプロファイル設定を確認してください。",
    ));
    return { valid: false, roleIds: [], diagnostics };
  }
  if (selections.length < 1) {
    diagnostics.push(error(
      "classification-selection-required",
      "種類の候補にする分類領域をCanvasから選択してください。",
    ));
    return { valid: false, roleIds: [], diagnostics };
  }
  const resolver = new SelectionResolver(document, context, signal);
  const roleIds: string[] = [];
  for (const selection of selections) {
    const item = await resolver.resolveItem(selection, diagnostics);
    if (!item) continue;
    if (item.structuralKind === "node" || item.groupFrame?.kind !== "classification") {
      diagnostics.push(error(
        "classification-selection-invalid",
        "選択した対象は分類領域ではありません。種類を表す領域を選び直してください。",
      ));
      continue;
    }
    const role = profile.nodeRoles.find((candidate) => candidate.classIri === item.semanticRef);
    if (!role) {
      diagnostics.push(error(
        "classification-role-unavailable",
        "この分類領域は現在のプロファイルで要素の種類として利用できません。別の領域を選択してください。",
      ));
      continue;
    }
    if (!roleIds.includes(role.roleId)) roleIds.push(role.roleId);
  }
  return { valid: !hasErrors(diagnostics), roleIds, diagnostics };
}

/**
 * Returns editable label/comment values with opaque identities. Language tags
 * and datatype IRIs remain inside Core; standard UI only sees a locale class.
 */
export async function structuredLocalizedTextPresentation(
  document: IriographDocument,
  target: StructuredCanvasSelection,
  context: ResolvedAuthoringContext,
  signal?: AbortSignal,
): Promise<StructuredLocalizedTextPresentation> {
  const diagnostics: ProjectionDiagnostic[] = [];
  const store = parseDocument(document, diagnostics);
  if (!store) return { valid: false, fields: [], diagnostics };
  const resourceIri = await new SelectionResolver(document, context, signal)
    .resolve(target, diagnostics);
  if (!resourceIri) return { valid: false, fields: [], diagnostics };
  const fields = ([
    ["label", "名前", RDFS_LABEL],
    ["comment", "説明", RDFS_COMMENT],
  ] as const).map(([field, label, predicateIri]) => ({
    field,
    label,
    values: store.getObjects(resourceIri, predicateIri, null)
      .filter((term) => term.termType === "Literal")
      .map((term) => ({
        valueId: localizedValueId(field, term.value, term.language, term.datatype.value),
        value: term.value,
        localeKind: localizedLocaleKind(term.language, term.datatype.value, context.defaultLocale),
      }))
      .sort((left, right) => compareText(left.valueId, right.valueId)),
  }));
  const identities = fields.flatMap((field) => field.values.map((value) => value.valueId));
  if (new Set(identities).size !== identities.length) {
    diagnostics.push(error(
      "localized-value-identity-collision",
      "翻訳の識別に失敗しました。Turtleソースで値を確認してください。",
    ));
  }
  return { valid: !hasErrors(diagnostics), fields, diagnostics };
}

/**
 * Presents exact projected memberships through opaque item IDs. The IDs bind
 * to Scene provenance; labels and Canvas element IDs are the only identities
 * exposed to the standard editor.
 */
export async function structuredMembershipPresentation(
  document: IriographDocument,
  target: StructuredCanvasSelection,
  context: ResolvedAuthoringContext,
  signal?: AbortSignal,
): Promise<StructuredMembershipPresentation> {
  const diagnostics: ProjectionDiagnostic[] = [];
  const resolver = new SelectionResolver(document, context, signal);
  const scene = await resolver.resolveScene(target.viewId, diagnostics);
  const item = await resolver.resolveItem(target, diagnostics);
  if (!scene || !item) return { valid: false, targetKind: "node", items: [], diagnostics };
  const groups = [...scene.containers, ...(scene.regions ?? [])].filter((candidate) => candidate.groupFrame);
  const nodes = scene.nodes;
  const targetGroup = groups.find((candidate) => candidate.elementId === item.elementId);
  const targetIsGroup = Boolean(targetGroup);
  const items = (scene.memberships ?? []).flatMap((membership) => {
    const group = groups.find((candidate) => (
      candidate.elementId === membership.regionElementId
      || candidate.elementId === membership.containerElementId
    ));
    const member = nodes.find((candidate) => candidate.elementId === membership.memberElementId);
    const groupKind = group?.groupFrame?.kind;
    if (!group || !member || !groupKind) return [];
    const isContains = targetIsGroup && (
      target.elementId === membership.regionElementId
      || target.elementId === membership.containerElementId
    );
    const isBelongsTo = !targetIsGroup && target.elementId === membership.memberElementId;
    if (!isContains && !isBelongsTo) return [];
    const role = membership.role ?? "membership";
    const capability = membership.provenance.editCapability;
    const removable = role === "membership" && capability?.command === "set-membership";
    return [{
      membershipId: structuredMembershipId(target.viewId, membership),
      direction: isContains ? "contains" as const : "belongs-to" as const,
      relatedElementId: isContains ? member.elementId : group.elementId,
      relatedLabel: isContains ? member.label : group.label,
      groupElementId: group.elementId,
      groupLabel: group.label,
      groupKind,
      role,
      ...(membership.ordinal ? { ordinal: membership.ordinal } : {}),
      removable,
      ...(!removable ? {
        disabledReason: role === "sequence-member"
          ? "並び順編集から解除してください。"
          : role === "alternative-member"
            ? "候補編集から解除してください。"
            : "この所属は現在のプロファイルでは解除できません。",
      } : {}),
    }];
  });
  if (new Set(items.map((membership) => membership.membershipId)).size !== items.length) {
    diagnostics.push(error(
      "structured-membership-identity-collision",
      "所属情報の識別に失敗しました。詳細を開き直してください。",
      undefined,
      "reload-group-members",
    ));
  }
  return {
    valid: !hasErrors(diagnostics),
    targetKind: targetIsGroup ? "group" : "node",
    ...(targetGroup?.groupFrame ? { groupKind: targetGroup.groupFrame.kind } : {}),
    items,
    diagnostics,
  };
}

/**
 * Compiles a UI-level request to the existing atomic authoring command pipeline.
 * Raw resource/class/predicate IRIs remain inside Core and the resolved context.
 */
export async function previewStructuredAuthoringRequest(
  document: IriographDocument,
  request: StructuredAuthoringRequest,
  context: ResolvedAuthoringContext,
  options: PreviewAuthoringOptions = {},
): Promise<StructuredAuthoringPreviewResult> {
  const diagnostics: ProjectionDiagnostic[] = [];
  if (!request.requestId.trim()) {
    diagnostics.push(error("structured-request-id-required", "操作IDがありません。もう一度操作してください。"));
    return rejected(diagnostics);
  }
  const parsed = parseDocument(document, diagnostics);
  if (!parsed) return rejected(diagnostics);
  const resolver = new SelectionResolver(document, context, options.signal);
  const commands = await compileStructuredAuthoringRequest(
    document,
    request,
    parsed,
    resolver,
    context,
    options,
    diagnostics,
  );
  if (hasErrors(diagnostics)) return rejected(diagnostics);
  const preview = await previewAuthoringCommands(document, commands, context, options);
  return {
    valid: preview.valid,
    preview,
    diagnostics: [...diagnostics, ...preview.diagnostics],
  };
}

/**
 * Compiles a structured dialog save as one semantic transaction. All opaque
 * identities are resolved against the same base document and graph policy,
 * cardinality, projection and layout are evaluated only for the final graph.
 */
export async function previewStructuredAuthoringBatch(
  document: IriographDocument,
  requests: readonly StructuredAuthoringRequest[],
  context: ResolvedAuthoringContext,
  options: PreviewAuthoringOptions = {},
): Promise<StructuredAuthoringPreviewResult> {
  const diagnostics: ProjectionDiagnostic[] = [];
  if (requests.length === 0) {
    diagnostics.push(error("structured-request-required", "変更内容がありません。詳細を開き直してください。"));
    return rejected(diagnostics);
  }
  const requestIds = new Set<string>();
  for (const request of requests) {
    if (!request.requestId.trim() || requestIds.has(request.requestId)) {
      diagnostics.push(error(
        "structured-request-id-invalid",
        "操作IDが重複または不足しています。詳細を開き直してください。",
      ));
    }
    requestIds.add(request.requestId);
  }
  const membershipIds = requests.flatMap((request) => (
    request.type === "remove-group-members" ? request.membershipIds : []
  ));
  if (new Set(membershipIds).size !== membershipIds.length) {
    diagnostics.push(error(
      "group-member-removal-duplicate",
      "同じ所属が複数回選択されています。詳細を開き直してください。",
    ));
  }
  const parsed = parseDocument(document, diagnostics);
  if (!parsed || hasErrors(diagnostics)) return rejected(diagnostics);
  const resolver = new SelectionResolver(document, context, options.signal);
  const commands: AuthoringCommand[] = [];
  const localized = new Map<string, LocalizedBatchState>();
  const touchedLocalizedValues = new Set<string>();
  for (const request of requests) {
    if (options.signal?.aborted) {
      diagnostics.push(error("authoring-aborted", "操作はキャンセルされました。"));
      break;
    }
    if (isLocalizedTextRequest(request)) {
      await applyLocalizedBatchRequest(
        request,
        parsed,
        resolver,
        context,
        localized,
        touchedLocalizedValues,
        diagnostics,
      );
      continue;
    }
    commands.push(...await compileStructuredAuthoringRequest(
      document,
      request,
      parsed,
      resolver,
      context,
      options,
      diagnostics,
    ));
  }
  localized.forEach((state, key) => {
    if (state.field === "label" && state.values.length === 0) {
      diagnostics.push(error("localized-label-required", "名前をすべて削除することはできません。"));
      return;
    }
    commands.push({
      type: "set-property",
      commandId: `structured-batch-localized-${hash(key)}`,
      subjectIri: state.resourceIri,
      predicateIri: state.field === "label" ? RDFS_LABEL : RDFS_COMMENT,
      values: state.values.map((item) => ({ ...item.value })),
    });
  });
  if (hasErrors(diagnostics)) return rejected(diagnostics);
  const preview = await previewAuthoringCommands(document, commands, context, options);
  return {
    valid: preview.valid,
    preview,
    diagnostics: [...diagnostics, ...preview.diagnostics],
  };
}

async function compileStructuredAuthoringRequest(
  document: IriographDocument,
  request: StructuredAuthoringRequest,
  parsed: Store,
  resolver: SelectionResolver,
  context: ResolvedAuthoringContext,
  options: PreviewAuthoringOptions,
  diagnostics: ProjectionDiagnostic[],
): Promise<AuthoringCommand[]> {
  let commands: AuthoringCommand[] = [];
  switch (request.type) {
    case "create-element":
      commands = compileCreateElement(request, context, diagnostics);
      break;
    case "change-group-kind":
      commands = await compileGroupKindChange(request, parsed, resolver, context, diagnostics);
      break;
    case "set-node-roles":
      commands = await compileNodeRoleChange(request, parsed, resolver, context, diagnostics);
      break;
    case "create-direct-relations":
      commands = await compileDirectRelations(request, parsed, resolver, context, diagnostics);
      break;
    case "set-group-members":
      commands = await compileGroupMembers(
        document,
        request,
        parsed,
        resolver,
        context,
        options.allocator ?? context.allocator,
        options.signal,
        diagnostics,
      );
      break;
    case "remove-group-members":
      commands = await compileGroupMemberRemoval(request, parsed, resolver, diagnostics);
      break;
    case "delete-element": {
      const target = await resolver.resolve(request.target, diagnostics);
      if (target) {
        commands = [{
          type: "delete-resource",
          commandId: `${request.requestId}:delete`,
          resourceIri: target,
          cascade: request.cascade,
        }];
      }
      break;
    }
    case "update-localized-text":
    case "add-localized-text":
    case "remove-localized-text":
      commands = await compileLocalizedTextChange(request, parsed, resolver, context, diagnostics);
      break;
  }
  return commands;
}

type LocalizedTextRequest = Extract<StructuredAuthoringRequest, {
  type: "update-localized-text" | "add-localized-text" | "remove-localized-text";
}>;

type LocalizedBatchState = {
  resourceIri: string;
  field: "label" | "comment";
  values: Array<{ valueId: string; value: AuthoringObjectValue }>;
};

function isLocalizedTextRequest(request: StructuredAuthoringRequest): request is LocalizedTextRequest {
  return request.type === "update-localized-text"
    || request.type === "add-localized-text"
    || request.type === "remove-localized-text";
}

async function applyLocalizedBatchRequest(
  request: LocalizedTextRequest,
  store: Store,
  resolver: SelectionResolver,
  context: ResolvedAuthoringContext,
  states: Map<string, LocalizedBatchState>,
  touchedValueIds: Set<string>,
  diagnostics: ProjectionDiagnostic[],
): Promise<void> {
  const resourceIri = await resolver.resolve(request.target, diagnostics);
  if (!resourceIri) return;
  const predicateIri = request.field === "label" ? RDFS_LABEL : RDFS_COMMENT;
  const key = `${resourceIri}\n${predicateIri}`;
  let state = states.get(key);
  if (!state) {
    const objects = store.getObjects(resourceIri, predicateIri, null);
    const values = localizedObjectsAsValues(objects, diagnostics).map((value, index) => {
      const term = objects[index]!;
      return {
        valueId: localizedValueId(request.field, term.value, term.termType === "Literal" ? term.language : "", term.termType === "Literal" ? term.datatype.value : ""),
        value,
      };
    });
    state = { resourceIri, field: request.field, values };
    states.set(key, state);
  }
  if (request.type === "add-localized-text") {
    const value = request.value.normalize("NFC");
    if (request.field === "label" && !value.trim()) {
      diagnostics.push(error("localized-label-required", "名前を入力してください。"));
      return;
    }
    const language = context.defaultLocale?.trim();
    const duplicate = state.values.some((item) => (
      item.value.kind === "literal"
      && item.value.value === value
      && (language
        ? item.value.language?.toLowerCase() === language.toLowerCase()
        : !item.value.language)
    ));
    if (duplicate) {
      diagnostics.push(error(
        "localized-value-duplicate",
        request.field === "label" ? "同じ名前がすでに登録されています。" : "同じ説明がすでに登録されています。",
      ));
      return;
    }
    const datatypeIri = language ? "" : XSD_STRING;
    state.values.push({
      valueId: localizedValueId(request.field, value, language ?? "", datatypeIri),
      value: language
        ? { kind: "literal", value, language }
        : { kind: "literal", value, datatypeIri },
    });
    return;
  }
  const touchKey = `${key}\n${request.valueId}`;
  if (touchedValueIds.has(touchKey)) {
    diagnostics.push(error(
      "localized-value-batch-duplicate",
      "同じ名前または説明が複数回変更されています。詳細を開き直してください。",
    ));
    return;
  }
  touchedValueIds.add(touchKey);
  const targetIndex = state.values.findIndex((item) => item.valueId === request.valueId);
  if (targetIndex < 0) {
    diagnostics.push(error(
      "localized-value-stale",
      "編集対象の翻訳が更新または削除されています。詳細を開き直してください。",
    ));
    return;
  }
  if (request.type === "remove-localized-text") {
    state.values.splice(targetIndex, 1);
    return;
  }
  const value = request.value.normalize("NFC");
  if (request.field === "label" && !value.trim()) {
    diagnostics.push(error("localized-label-required", "名前を入力してください。"));
    return;
  }
  const previous = state.values[targetIndex]!;
  if (previous.value.kind !== "literal") {
    diagnostics.push(error("localized-value-object-unsupported", "名前または説明を通常編集できません。"));
    return;
  }
  state.values[targetIndex] = {
    valueId: localizedValueId(
      request.field,
      value,
      previous.value.language ?? "",
      previous.value.datatypeIri ?? "",
    ),
    value: { ...previous.value, value },
  };
}

function compileCreateElement(
  request: Extract<StructuredAuthoringRequest, { type: "create-element" }>,
  context: ResolvedAuthoringContext,
  diagnostics: ProjectionDiagnostic[],
): AuthoringCommand[] {
  const label = normalizedLabel(request.element.label, diagnostics);
  if (!label) return [];
  const typeIris = request.element.kind === "node"
    ? resolveNodeRoles(request.element.nodeRoleIds, context, diagnostics)
    : [groupType(request.element.groupKind)];
  if (
    request.element.kind === "group"
    && request.element.groupKind === "classification"
    && context.structuredAuthoring?.allowClassificationGroups !== true
  ) {
    diagnostics.push(error(
      "classification-group-creation-denied",
      "現在のプロファイルでは分類グループを作成できません。管理者にプロファイル設定を確認してください。",
    ));
  }
  if (hasErrors(diagnostics)) return [];
  return [{
    type: "create-resource",
    commandId: `${request.requestId}:create`,
    suggestedLocalName: request.element.suggestedLocalName,
    initialStatements: [
      ...typeIris.map((iri) => ({
        subject: { kind: "created-resource" as const },
        predicateIri: RDF_TYPE,
        object: { kind: "iri" as const, iri },
      })),
      {
        subject: { kind: "created-resource" as const },
        predicateIri: RDFS_LABEL,
        object: { kind: "literal" as const, value: label },
      },
    ],
  }];
}

async function compileDirectRelations(
  request: Extract<StructuredAuthoringRequest, { type: "create-direct-relations" }>,
  store: Store,
  resolver: SelectionResolver,
  context: ResolvedAuthoringContext,
  diagnostics: ProjectionDiagnostic[],
): Promise<AuthoringCommand[]> {
  if (request.targets.length < 1) {
    diagnostics.push(error("direct-relation-target-required", "接続先を一つ以上選択してください。"));
    return [];
  }
  const source = await resolver.resolve(request.source, diagnostics);
  const targets = await Promise.all(request.targets.map((row) => resolver.resolve(row.target, diagnostics)));
  if (!source || targets.some((target) => !target)) return [];
  const commands: AuthoringCommand[] = [];
  request.targets.forEach((row, index) => {
    const selectedId = row.predicateId ?? request.predicateId;
    if (!selectedId) {
      diagnostics.push(error(
        "direct-relation-predicate-required",
        `${index + 1}件目の関係の種類を選択してください。`,
      ));
      return;
    }
    const predicate = resolvePredicate(selectedId, context, diagnostics);
    const target = targets[index];
    if (!predicate || !target) return;
    commands.push({
      type: "connect-resources",
      commandId: `${request.requestId}:edge:${index + 1}`,
      subjectIri: source,
      predicateIri: predicate.iri,
      objectIri: target,
    });
  });
  if (hasErrors(diagnostics)) return [];
  const rowsByStatement = new Map<string, number[]>();
  commands.forEach((command, index) => {
    if (command.type !== "connect-resources") return;
    const identity = JSON.stringify([
      command.subjectIri,
      command.predicateIri,
      command.objectIri,
    ]);
    const rows = rowsByStatement.get(identity) ?? [];
    rows.push(index + 1);
    rowsByStatement.set(identity, rows);
  });
  for (const rows of rowsByStatement.values()) {
    if (rows.length < 2) continue;
    diagnostics.push(error(
      "direct-relation-duplicate-request",
      `${rows.join("、")}件目が同じ関係です。重複する接続先または関係の種類を外してから、まとめてやり直してください。`,
      undefined,
      "remove-duplicate-direct-relation",
    ));
  }
  commands.forEach((command, index) => {
    if (
      command.type === "connect-resources"
      && store.countQuads(
        command.subjectIri,
        command.predicateIri,
        command.objectIri,
        null,
      ) > 0
    ) {
      diagnostics.push(error(
        "direct-relation-already-exists",
        `${index + 1}件目の関係はすでに存在します。既存の関係を選択から外してから、まとめてやり直してください。`,
        command.objectIri,
        "remove-existing-direct-relation",
      ));
    }
  });
  if (hasErrors(diagnostics)) return [];
  return commands;
}

async function compileGroupMembers(
  document: IriographDocument,
  request: Extract<StructuredAuthoringRequest, { type: "set-group-members" }>,
  store: Store,
  resolver: SelectionResolver,
  context: ResolvedAuthoringContext,
  allocator: ResourceIriAllocator | undefined,
  signal: AbortSignal | undefined,
  diagnostics: ProjectionDiagnostic[],
): Promise<AuthoringCommand[]> {
  const groupIri = await resolver.resolve(request.group, diagnostics);
  if (!groupIri) return [];
  const kind = resolvedGroupKind(store, groupIri, diagnostics);
  if (!kind) return [];
  if (request.members.length < 1) {
    diagnostics.push(error("group-member-required", "所属させる要素を一つ以上選択してください。", groupIri));
    return [];
  }
  const clientIds = new Set<string>();
  for (const member of request.members) {
    if (member.kind !== "new-node") continue;
    if (!member.clientId.trim() || clientIds.has(member.clientId)) {
      diagnostics.push(error(
        "inline-member-client-id-invalid",
        `新しい要素の一時IDが重複しています: ${member.clientId}`,
        groupIri,
      ));
    }
    clientIds.add(member.clientId);
    normalizedLabel(member.label, diagnostics);
    resolveNodeRoles(member.nodeRoleIds, context, diagnostics);
  }
  if (hasErrors(diagnostics)) return [];
  const existingIris = await Promise.all(request.members.map((member) => (
    member.kind === "existing" ? resolver.resolve(member.selection, diagnostics) : undefined
  )));
  if (hasErrors(diagnostics)) return [];

  const allocated = new Map<string, string>();
  const reserved = new Set<string>();
  for (let index = 0; index < request.members.length; index += 1) {
    const member = request.members[index];
    if (member?.kind !== "new-node") continue;
    const iri = await allocateInlineResource(
      document,
      request.requestId,
      member,
      index,
      context,
      allocator,
      signal,
      diagnostics,
    );
    if (!iri) continue;
    if (reserved.has(iri) || graphContainsNamedTerm(store, iri)) {
      diagnostics.push(error(
        "resource-iri-collision",
        "新しい要素の識別子が既存または同時作成中の要素と重複しました。再試行してください。",
        iri,
      ));
    }
    reserved.add(iri);
    allocated.set(member.clientId, iri);
  }
  if (hasErrors(diagnostics)) return [];

  const memberIris = request.members.map((member, index) => (
    member.kind === "existing" ? existingIris[index]! : allocated.get(member.clientId)!
  ));
  if ((kind === "classification" || kind === "membership") && new Set(memberIris).size !== memberIris.length) {
    diagnostics.push(error(
      "group-member-duplicate",
      "同じ要素を同じグループへ複数回追加することはできません。重複を外してください。",
      groupIri,
      "remove-duplicate-group-member",
    ));
    return [];
  }
  const commands: AuthoringCommand[] = [];
  request.members.forEach((member, index) => {
    if (member.kind !== "new-node") return;
    const iri = memberIris[index]!;
    const roleIris = resolveNodeRoles(member.nodeRoleIds, context, diagnostics);
    commands.push({
      type: "create-resource",
      commandId: `${request.requestId}:new:${index + 1}`,
      resourceIri: iri,
      suggestedLocalName: member.suggestedLocalName,
      initialStatements: [
        ...roleIris.map((classIri) => ({
          subject: { kind: "created-resource" as const },
          predicateIri: RDF_TYPE,
          object: { kind: "iri" as const, iri: classIri },
        })),
        {
          subject: { kind: "created-resource" as const },
          predicateIri: RDFS_LABEL,
          object: { kind: "literal" as const, value: member.label.trim().normalize("NFC") },
        },
      ],
    });
  });
  if (kind === "classification" || kind === "membership") {
    const existingMembers = currentMembers(store, groupIri, kind);
    for (const memberIri of memberIris) {
      if (existingMembers.includes(memberIri)) {
        diagnostics.push(error(
          "group-member-already-present",
          "選択した要素はすでにこのグループへ所属しています。選択から外してください。",
          memberIri,
          "remove-existing-group-member",
        ));
      }
    }
    if (hasErrors(diagnostics)) return [];
    memberIris.forEach((memberIri, index) => commands.push({
      type: "set-membership",
      commandId: `${request.requestId}:member:${index + 1}`,
      containerIri: groupIri,
      memberIri,
      enabled: true,
      containerTypeIri: kind === "classification" ? RDFS_CLASS : RDF_BAG,
      predicateIri: kind === "classification" ? RDF_TYPE : RDFS_MEMBER,
      containerPosition: kind === "classification" ? "object" : "subject",
    }));
  } else if (kind === "sequence") {
    commands.push({
      type: "set-sequence",
      commandId: `${request.requestId}:sequence`,
      sequenceIri: groupIri,
      memberIris,
      sequenceTypeIri: RDF_SEQ,
      ordinalPredicatePrefix: RDF_ORDINAL_PREFIX,
    });
  } else {
    if (memberIris.length < 2) {
      diagnostics.push(error(
        "alternative-too-few-members",
        "候補グループには候補を二つ以上選択してください。",
        groupIri,
      ));
      return [];
    }
    if (
      !Number.isSafeInteger(request.defaultMemberIndex)
      || request.defaultMemberIndex! < 0
      || request.defaultMemberIndex! >= memberIris.length
    ) {
      diagnostics.push(error(
        "alternative-default-required",
        "候補グループの既定候補を一つ選択してください。",
        groupIri,
      ));
      return [];
    }
    const defaultIndex = request.defaultMemberIndex!;
    const orderedMemberIris = [
      memberIris[defaultIndex]!,
      ...memberIris.slice(0, defaultIndex),
      ...memberIris.slice(defaultIndex + 1),
    ];
    commands.push({
      type: "set-alternatives",
      commandId: `${request.requestId}:alternative`,
      alternativeIri: groupIri,
      memberIris: orderedMemberIris,
      defaultMemberIri: orderedMemberIris[0]!,
      alternativeTypeIri: RDF_ALT,
      ordinalPredicatePrefix: RDF_ORDINAL_PREFIX,
      defaultOrdinal: 1,
    });
  }
  return commands;
}

async function compileGroupMemberRemoval(
  request: Extract<StructuredAuthoringRequest, { type: "remove-group-members" }>,
  _store: Store,
  resolver: SelectionResolver,
  diagnostics: ProjectionDiagnostic[],
): Promise<AuthoringCommand[]> {
  if (request.membershipIds.length < 1) {
    diagnostics.push(error("group-member-removal-required", "解除する要素を一つ以上選択してください。"));
    return [];
  }
  if (new Set(request.membershipIds).size !== request.membershipIds.length) {
    diagnostics.push(error("group-member-removal-duplicate", "同じ所属が重複して選択されています。"));
    return [];
  }
  const scene = await resolver.resolveScene(request.viewId, diagnostics);
  if (!scene) return [];
  const memberships = request.membershipIds.map((membershipId) => (
    (scene.memberships ?? []).find((membership) => (
      structuredMembershipId(request.viewId, membership) === membershipId
    ))
  ));
  if (memberships.some((membership) => !membership)) {
    diagnostics.push(error(
      "group-member-removal-stale",
      "選択した所属はすでに解除されています。詳細を開き直してください。",
      undefined,
      "reload-group-members",
    ));
    return [];
  }
  const commands: AuthoringCommand[] = [];
  memberships.forEach((membership, index) => {
    if (!membership) return;
    if (membership.role === "sequence-member" || membership.role === "alternative-member") {
      diagnostics.push(error(
        "ordered-group-member-removal-requires-editor",
        membership.role === "sequence-member"
          ? "順序付きグループの要素は並び順編集から解除してください。"
          : "候補グループの要素は候補編集から解除してください。",
        undefined,
        "open-ordered-group-editor",
      ));
      return;
    }
    const capability = membership.provenance.editCapability;
    if (capability?.command !== "set-membership") {
      diagnostics.push(error(
        "group-member-removal-not-writable",
        "この所属は現在のプロファイルでは解除できません。",
      ));
      return;
    }
    commands.push({
      type: "set-membership",
      commandId: `${request.requestId}:remove-membership:${index + 1}`,
      containerIri: capability.container,
      memberIri: capability.member,
      enabled: false,
      containerTypeIri: capability.containerTypeIri,
      predicateIri: capability.predicate,
      containerPosition: capability.containerPosition,
    });
  });
  return hasErrors(diagnostics) ? [] : commands;
}

async function compileNodeRoleChange(
  request: Extract<StructuredAuthoringRequest, { type: "set-node-roles" }>,
  store: Store,
  resolver: SelectionResolver,
  context: ResolvedAuthoringContext,
  diagnostics: ProjectionDiagnostic[],
): Promise<AuthoringCommand[]> {
  const item = await resolver.resolveItem(request.node, diagnostics);
  if (!item) return [];
  if (item.structuralKind !== "node") {
    diagnostics.push(error(
      "node-role-target-invalid",
      "グループの種類はこの操作で変更できません。通常の要素を選択してください。",
      undefined,
      "select-node-for-role-edit",
    ));
    return [];
  }
  const selectedRoleIris = resolveNodeRoles(request.nodeRoleIds, context, diagnostics);
  if (hasErrors(diagnostics)) return [];
  const currentTypes = store.getObjects(item.semanticRef, RDF_TYPE, null)
    .filter((term) => term.termType === "NamedNode")
    .map((term) => term.value);
  if (currentTypes.some((iri) => Object.values(GROUP_TYPES).includes(iri))) {
    diagnostics.push(error(
      "node-group-role-mixed",
      "グループの種類と通常要素の種類は同じ対象へ設定できません。グループ編集から種類を整理してください。",
      item.semanticRef,
      "edit-group-kind",
    ));
    return [];
  }
  const managedRoleIris = new Set(
    (context.structuredAuthoring?.nodeRoles ?? []).map((role) => role.classIri),
  );
  const finalTypes = [
    ...currentTypes.filter((iri) => !managedRoleIris.has(iri)),
    ...selectedRoleIris,
  ].filter((iri, index, values) => values.indexOf(iri) === index);
  return [{
    type: "set-property",
    commandId: `${request.requestId}:node-roles`,
    subjectIri: item.semanticRef,
    predicateIri: RDF_TYPE,
    values: finalTypes.map((iri) => ({ kind: "iri" as const, iri })),
  }];
}

async function compileLocalizedTextChange(
  request: Extract<StructuredAuthoringRequest, {
    type: "update-localized-text" | "add-localized-text" | "remove-localized-text";
  }>,
  store: Store,
  resolver: SelectionResolver,
  context: ResolvedAuthoringContext,
  diagnostics: ProjectionDiagnostic[],
): Promise<AuthoringCommand[]> {
  const resourceIri = await resolver.resolve(request.target, diagnostics);
  if (!resourceIri) return [];
  const predicateIri = request.field === "label" ? RDFS_LABEL : RDFS_COMMENT;
  const objects = store.getObjects(resourceIri, predicateIri, null);
  if (request.type === "add-localized-text") {
    const value = request.value.normalize("NFC");
    if (request.field === "label" && !value.trim()) {
      diagnostics.push(error("localized-label-required", "名前を入力してください。"));
      return [];
    }
    const language = context.defaultLocale?.trim();
    const duplicate = objects.some((term) => (
      term.termType === "Literal"
      && term.value === value
      && (language ? term.language.toLowerCase() === language.toLowerCase() : !term.language)
    ));
    if (duplicate) {
      diagnostics.push(error(
        "localized-value-duplicate",
        request.field === "label" ? "同じ名前がすでに登録されています。" : "同じ説明がすでに登録されています。",
      ));
      return [];
    }
    const values = localizedObjectsAsValues(objects, diagnostics);
    if (hasErrors(diagnostics)) return [];
    values.push(language
      ? { kind: "literal", value, language }
      : { kind: "literal", value, datatypeIri: XSD_STRING });
    return [{
      type: "set-property",
      commandId: `${request.requestId}:add-localized-text`,
      subjectIri: resourceIri,
      predicateIri,
      values,
    }];
  }
  const targetIndex = objects.findIndex((term) => (
    term.termType === "Literal"
    && localizedValueId(request.field, term.value, term.language, term.datatype.value) === request.valueId
  ));
  if (targetIndex < 0) {
    diagnostics.push(error(
      "localized-value-stale",
      "編集対象の翻訳が更新または削除されています。詳細を開き直してください。",
      undefined,
      "reload-localized-values",
    ));
    return [];
  }
  if (
    request.type === "remove-localized-text"
    && request.field === "label"
    && objects.filter((term) => term.termType === "Literal").length <= 1
  ) {
    diagnostics.push(error("localized-label-required", "名前をすべて削除することはできません。"));
    return [];
  }
  const value = request.type === "update-localized-text" ? request.value.normalize("NFC") : undefined;
  if (request.type === "update-localized-text" && request.field === "label" && !value?.trim()) {
    diagnostics.push(error("localized-label-required", "名前を入力してください。"));
    return [];
  }
  const values = localizedObjectsAsValues(
    request.type === "remove-localized-text"
      ? objects.filter((_, index) => index !== targetIndex)
      : objects,
    diagnostics,
    request.type === "update-localized-text" ? { targetIndex, value: value ?? "" } : undefined,
  );
  if (hasErrors(diagnostics)) return [];
  return [{
    type: "set-property",
    commandId: `${request.requestId}:${request.type}`,
    subjectIri: resourceIri,
    predicateIri,
    values,
  }];
}

function localizedObjectsAsValues(
  objects: readonly ReturnType<Store["getObjects"]>[number][],
  diagnostics: ProjectionDiagnostic[],
  update?: { targetIndex: number; value: string },
): Array<
  | { kind: "iri"; iri: string }
  | { kind: "literal"; value: string; language?: string; datatypeIri?: string }
> {
  return objects.map((term, index) => {
    if (term.termType === "NamedNode") return { kind: "iri" as const, iri: term.value };
    if (term.termType !== "Literal") {
      diagnostics.push(error(
        "localized-value-object-unsupported",
        "名前または説明に通常編集できない値があります。Turtleソースで確認してください。",
      ));
      return undefined;
    }
    const literalValue = update?.targetIndex === index ? update.value : term.value;
    return term.language
      ? { kind: "literal" as const, value: literalValue, language: term.language }
      : {
          kind: "literal" as const,
          value: literalValue,
          // Explicit datatype preserves untagged xsd:string under defaultLocale.
          datatypeIri: term.datatype.value,
        };
  }).filter((item): item is NonNullable<typeof item> => item !== undefined);
}

async function compileGroupKindChange(
  request: Extract<StructuredAuthoringRequest, { type: "change-group-kind" }>,
  store: Store,
  resolver: SelectionResolver,
  context: ResolvedAuthoringContext,
  diagnostics: ProjectionDiagnostic[],
): Promise<AuthoringCommand[]> {
  const groupIri = await resolver.resolve(request.group, diagnostics);
  if (!groupIri) return [];
  const current = resolvedGroupKind(store, groupIri, diagnostics);
  if (!current) return [];
  if (current === request.groupKind) {
    diagnostics.push(error("group-kind-unchanged", "同じグループ種類が選択されています。", groupIri));
    return [];
  }
  if (
    request.groupKind === "classification"
    && context.structuredAuthoring?.allowClassificationGroups !== true
  ) {
    diagnostics.push(error(
      "classification-group-creation-denied",
      "現在のプロファイルでは分類グループへ変更できません。管理者にプロファイル設定を確認してください。",
      groupIri,
    ));
    return [];
  }
  const types = store.getObjects(groupIri, RDF_TYPE, null)
    .filter((term) => term.termType === "NamedNode")
    .map((term) => term.value);
  if (types.some((type) => !Object.values(GROUP_TYPES).includes(type))) {
    diagnostics.push(error(
      "node-group-role-mixed",
      "要素の種類とグループの種類が同じリソースに混在しています。先に要素の種類を整理してください。",
      groupIri,
      "edit-element-types",
    ));
    return [];
  }
  const members = currentMembers(store, groupIri, current);
  if (members.length > 0) {
    diagnostics.push(error(
      "group-kind-change-has-members",
      `所属中の要素${members.length}件を失う種類変更はできません。先に所属・順番・候補を解除してください。`,
      groupIri,
      "clear-group-members-first",
    ));
    return [];
  }
  return [{
    type: "set-property",
    commandId: `${request.requestId}:group-kind`,
    subjectIri: groupIri,
    predicateIri: RDF_TYPE,
    values: [{ kind: "iri", iri: groupType(request.groupKind) }],
  }];
}

function resolveNodeRoles(
  roleIds: readonly string[],
  context: ResolvedAuthoringContext,
  diagnostics: ProjectionDiagnostic[],
): string[] {
  const profile = context.structuredAuthoring;
  if (!profile) {
    diagnostics.push(error(
      "structured-authoring-profile-required",
      "要素作成用のプロファイルを読み込めません。管理者にプロファイル設定を確認してください。",
    ));
    return [];
  }
  if (roleIds.length === 0 && profile.allowUntypedNodes !== true) {
    diagnostics.push(error("node-role-required", "要素の種類を一つ以上選択してください。"));
    return [];
  }
  if (new Set(roleIds).size !== roleIds.length) {
    diagnostics.push(error("node-role-duplicate", "同じ要素の種類が重複しています。"));
    return [];
  }
  const result: string[] = [];
  for (const roleId of roleIds) {
    const role = profile.nodeRoles.find((candidate) => candidate.roleId === roleId);
    if (!role) {
      diagnostics.push(error("node-role-unresolved", `選択した要素の種類を利用できません: ${roleId}`));
      continue;
    }
    if (Object.values(GROUP_TYPES).includes(role.classIri)) {
      diagnostics.push(error("node-group-role-mixed", "グループの種類は通常要素へ設定できません。"));
      continue;
    }
    result.push(role.classIri);
  }
  return result;
}

function resolvePredicate(
  id: string,
  context: ResolvedAuthoringContext,
  diagnostics: ProjectionDiagnostic[],
): ResolvedAuthoringTerm | undefined {
  const term = context.terms.find((candidate) => isDirectPredicateTerm(candidate) && predicateId(candidate) === id);
  if (!term) {
    diagnostics.push(error("predicate-unresolved", "選択した関係の種類は現在のプロファイルで利用できません。"));
  }
  return term;
}

function isDirectPredicateTerm(term: ResolvedAuthoringTerm): boolean {
  return term.kind === "property"
    && term.structural !== true
    && term.iri !== RDF_TYPE
    && term.iri !== RDFS_MEMBER
    && (term.objectKinds === undefined || term.objectKinds.includes("iri"));
}

function predicateId(term: ResolvedAuthoringTerm): string {
  return term.termId ?? `predicate-${hash(term.iri)}`;
}

function predicateIdForHierarchyIri(
  context: ResolvedAuthoringContext,
  iri: string,
): string {
  const term = context.terms.find((candidate) => candidate.iri === iri);
  return term ? predicateId(term) : `predicate-${hash(iri)}`;
}

function hierarchyLabel(
  value: string | undefined,
  fallback: string | undefined,
  rawIris: readonly string[],
): string {
  let result = value?.trim() || fallback?.trim() || "名称未設定の関係";
  for (const iri of rawIris) result = result.replaceAll(iri, "");
  return result.trim() || "名称未設定の関係";
}

function hierarchyDiagnosticMessage(code: string, labels: readonly string[]): string {
  if (code === "hierarchy-cycle") {
    const path = labels.length > 0 ? `: ${labels.join(" → ")}` : "";
    return `意味上の上位関係に循環があります${path}`;
  }
  if (code === "hierarchy-path-budget-exceeded") {
    return "意味上の上位関係が多いため、一部の経路を省略しました。";
  }
  return labels.length > 0
    ? `意味上の上位関係を完全に説明できません: ${labels.join(" → ")}`
    : "意味上の上位関係を完全に説明できません。";
}

class SelectionResolver {
  readonly #scenes = new Map<string, Awaited<ReturnType<typeof buildIriographView>>>();

  constructor(
    private readonly document: IriographDocument,
    private readonly context: ResolvedAuthoringContext,
    private readonly signal?: AbortSignal,
  ) {}

  async resolve(
    selection: StructuredCanvasSelection,
    diagnostics: ProjectionDiagnostic[],
  ): Promise<string | undefined> {
    return (await this.resolveItem(selection, diagnostics))?.semanticRef;
  }

  async resolveItem(
    selection: StructuredCanvasSelection,
    diagnostics: ProjectionDiagnostic[],
  ): Promise<ResolvedCanvasItem | undefined> {
    const scene = await this.resolveScene(selection.viewId, diagnostics);
    if (!scene) return undefined;
    const item = [...scene.nodes, ...scene.containers, ...(scene.regions ?? [])]
      .find((candidate) => candidate.elementId === selection.elementId);
    if (!item?.semanticRef) {
      diagnostics.push(error(
        "canvas-selection-stale",
        "選択した要素は現在のビューにありません。Canvasから選び直してください。",
        undefined,
        "reselect-canvas-element",
      ));
      return undefined;
    }
    return item;
  }

  async resolveScene(
    viewId: string,
    diagnostics: ProjectionDiagnostic[],
  ): Promise<Awaited<ReturnType<typeof buildIriographView>> | undefined> {
    let scene = this.#scenes.get(viewId);
    if (scene) return scene;
    if (!this.document.views.some((view) => view.viewId === viewId)) {
      diagnostics.push(error("canvas-selection-view-unresolved", "選択元のビューが見つかりません。再選択してください。"));
      return undefined;
    }
    scene = await buildIriographView(this.document, viewId, this.context.runtime, "incremental");
    this.#scenes.set(viewId, scene);
    if (scene.diagnostics.some((item) => item.severity === "error")) {
      diagnostics.push(...scene.diagnostics);
      return undefined;
    }
    return scene;
  }
}

type ResolvedCanvasItem =
  | Awaited<ReturnType<typeof buildIriographView>>["nodes"][number]
  | Awaited<ReturnType<typeof buildIriographView>>["containers"][number]
  | NonNullable<Awaited<ReturnType<typeof buildIriographView>>["regions"]>[number];

async function allocateInlineResource(
  document: IriographDocument,
  requestId: string,
  member: StructuredNewNode,
  index: number,
  context: ResolvedAuthoringContext,
  allocator: ResourceIriAllocator | undefined,
  signal: AbortSignal | undefined,
  diagnostics: ProjectionDiagnostic[],
): Promise<string | undefined> {
  if (!allocator) {
    diagnostics.push(error("resource-allocator-unresolved", "新しい要素の識別子を発行できません。管理者に設定を確認してください。"));
    return undefined;
  }
  const commandId = `${requestId}:new:${index + 1}`;
  const allocationRequestId = allocatorRequestId(commandId, member.suggestedLocalName, context);
  try {
    const allocation = await allocator.allocate({
      requestId: allocationRequestId,
      commandId,
      documentId: document.documentId,
      baseIri: document.semantic.baseIri,
      authoringProfileRef: context.authoringProfileRef,
      allowedNamespaces: [...context.resourcePolicy.allowedMintNamespaces],
      suggestedLocalName: member.suggestedLocalName,
      baseRevision: context.documentRevision,
      contextId: context.contextId,
      signal,
    });
    if (signal?.aborted) {
      diagnostics.push(error("authoring-aborted", "操作はキャンセルされました。"));
      return undefined;
    }
    if (!allocation) {
      diagnostics.push(error("resource-allocation-cancelled", "新しい要素の作成はキャンセルされました。"));
      return undefined;
    }
    if (
      allocation.requestId !== allocationRequestId
      || allocation.baseRevision !== context.documentRevision
      || allocation.contextId !== context.contextId
    ) {
      diagnostics.push(error("resource-allocation-stale", "古い識別子発行結果は使用できません。もう一度実行してください。"));
      return undefined;
    }
    if (!isAllowedResourceIri(allocation.iri, context)) {
      diagnostics.push(error("resource-namespace-denied", "発行された要素の識別子は許可範囲外です。", allocation.iri));
      return undefined;
    }
    return allocation.iri;
  } catch (cause) {
    diagnostics.push(error(
      "resource-allocation-failed",
      cause instanceof Error ? cause.message : "新しい要素の識別子を発行できませんでした。",
    ));
    return undefined;
  }
}

const GROUP_TYPES: Record<StructuredGroupKind, string> = {
  classification: RDFS_CLASS,
  membership: RDF_BAG,
  sequence: RDF_SEQ,
  alternative: RDF_ALT,
};

function groupType(kind: StructuredGroupKind): string {
  return GROUP_TYPES[kind];
}

function resolvedGroupKind(
  store: Store,
  groupIri: string,
  diagnostics: ProjectionDiagnostic[],
): StructuredGroupKind | undefined {
  const kinds = (Object.entries(GROUP_TYPES) as [StructuredGroupKind, string][])
    .filter(([, typeIri]) => store.countQuads(groupIri, RDF_TYPE, typeIri, null) > 0)
    .map(([kind]) => kind);
  if (kinds.length !== 1) {
    diagnostics.push(error(
      kinds.length === 0 ? "group-kind-unresolved" : "node-group-role-mixed",
      kinds.length === 0
        ? "選択した対象はグループではありません。グループ枠を選択してください。"
        : "複数のグループ種類が混在しています。種類を一つに整理してください。",
      groupIri,
      "select-or-repair-group-kind",
    ));
    return undefined;
  }
  return kinds[0];
}

function currentMembers(store: Store, groupIri: string, kind: StructuredGroupKind): string[] {
  if (kind === "classification") {
    return store.getSubjects(RDF_TYPE, groupIri, null)
      .filter((term) => term.termType === "NamedNode")
      .map((term) => term.value);
  }
  if (kind === "membership") {
    return store.getObjects(groupIri, RDFS_MEMBER, null)
      .filter((term) => term.termType === "NamedNode")
      .map((term) => term.value);
  }
  return store.getQuads(groupIri, null, null, null)
    .map((quad) => ({
      quad,
      ordinal: quad.predicate.value.startsWith(RDF_ORDINAL_PREFIX)
        ? Number(quad.predicate.value.slice(RDF_ORDINAL_PREFIX.length))
        : Number.NaN,
    }))
    .filter(({ quad, ordinal }) => (
      Number.isSafeInteger(ordinal)
      && ordinal > 0
      && quad.object.termType === "NamedNode"
    ))
    .sort((left, right) => left.ordinal - right.ordinal)
    .map(({ quad }) => quad.object.value);
}

function parseDocument(
  document: IriographDocument,
  diagnostics: ProjectionDiagnostic[],
): Store | undefined {
  try {
    return new Store(new Parser({
      baseIRI: document.semantic.baseIri,
      format: "text/turtle",
    }).parse(document.semantic.source));
  } catch (cause) {
    diagnostics.push(error(
      "invalid-turtle",
      cause instanceof Error ? cause.message : "Turtleを読み込めませんでした。",
    ));
    return undefined;
  }
}

function graphContainsNamedTerm(store: Store, iri: string): boolean {
  return store.getQuads(null, null, null, null).some((quad: Quad) => (
    [quad.subject, quad.predicate, quad.object].some((term) => (
      term.termType === "NamedNode" && term.value === iri
    ))
    || (quad.object.termType === "Literal" && quad.object.datatype.value === iri)
  ));
}

function normalizedLabel(value: string, diagnostics: ProjectionDiagnostic[]): string | undefined {
  const label = value.trim().normalize("NFC");
  if (!label) diagnostics.push(error("element-label-required", "名前を入力してください。"));
  return label || undefined;
}

function localizedValueId(
  field: "label" | "comment",
  value: string,
  language: string,
  datatypeIri: string,
): string {
  return `localized-${hash(JSON.stringify([field, value, language, datatypeIri]))}`;
}

function structuredMembershipId(
  viewId: string,
  membership: NonNullable<Awaited<ReturnType<typeof buildIriographView>>["memberships"]>[number],
): string {
  const capability = membership.provenance.editCapability;
  return `membership-${hash(JSON.stringify([
    viewId,
    membership.provenance.sourceStatementRefs,
    membership.role ?? "membership",
    membership.ordinal ?? 0,
    capability,
  ]))}`;
}

function localizedLocaleKind(
  language: string,
  datatypeIri: string,
  defaultLocale: string | undefined,
): "default" | "translation" | "untagged" | "typed" {
  if (language) {
    return defaultLocale && language.toLowerCase() === defaultLocale.toLowerCase()
      ? "default"
      : "translation";
  }
  return datatypeIri === XSD_STRING ? "untagged" : "typed";
}

function allocatorRequestId(
  commandId: string,
  suggestedLocalName: string | undefined,
  context: ResolvedAuthoringContext,
): string {
  return `urn:iriograph:allocator-request:v1:${encodeURIComponent(JSON.stringify([
    context.contextId,
    context.contextRevision,
    context.documentRevision,
    commandId,
    suggestedLocalName ?? "",
  ]))}`;
}

function error(
  code: string,
  message: string,
  semanticRef?: string,
  actionId?: string,
): ProjectionDiagnostic {
  return {
    severity: "error",
    code,
    message,
    semanticRef,
    ...(actionId ? { suggestedActions: [{ actionId, semanticRef }] } : {}),
  };
}

function rejected(diagnostics: ProjectionDiagnostic[]): StructuredAuthoringPreviewResult {
  return { valid: false, diagnostics };
}

function hasErrors(diagnostics: readonly ProjectionDiagnostic[]): boolean {
  return diagnostics.some((item) => item.severity === "error");
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function hash(value: string): string {
  let state = 0xcbf29ce484222325n;
  for (let index = 0; index < value.length; index += 1) {
    state ^= BigInt(value.charCodeAt(index));
    state = BigInt.asUintN(64, state * 0x100000001b3n);
  }
  return state.toString(16).padStart(16, "0");
}
