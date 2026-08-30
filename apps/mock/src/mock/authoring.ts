import {
  catalogRef,
  buildLimitedRdfsClosure,
  createProjectionRuntimeContext,
  createStandardLayoutRegistry,
  parseSemanticGraph,
  rdfRdfsVocabulary,
  standardRdfRdfsCatalog,
  standardRdfRdfsClassificationRegionCatalog,
  standardRdfRdfsInstanceFlowCatalog,
  type IriographDocumentV1,
  type ProjectionRuntimeContext,
  type ResolvedAuthoringContext,
  type ResolvedAuthoringTerm,
  type ResourceIriAllocator,
} from "@iriograph/core";
import {
  ELK_LAYOUT_REFS,
  ElkLayeredLayoutAdapter,
} from "@iriograph/layout-elk";
import { standardPredicateTerms } from "@iriograph/semantic-access";

import type { MockLocale } from "./localization";

import {
  mockClassificationRegionProjectionCatalog,
  mockInstanceFlowProjectionCatalog,
  mockProjectionCatalog,
} from "./catalog";

const DEMO_NAMESPACE = "urn:iriograph:demo:";
const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const RDFS = "http://www.w3.org/2000/01/rdf-schema#";
const RDF_TYPE = `${RDF}type`;
const RDF_PROPERTY = `${RDF}Property`;
const RDFS_CLASS = `${RDFS}Class`;
const RDFS_LABEL = `${RDFS}label`;
const RDFS_SUBPROPERTY_OF = `${RDFS}subPropertyOf`;

export const MOCK_WORKFLOW_ROLE_CLASSES = {
  process: "urn:iriograph:authoring-role:workflow:Process",
  event: "urn:iriograph:authoring-role:workflow:Event",
  gateway: "urn:iriograph:authoring-role:workflow:Gateway",
  information: "urn:iriograph:authoring-role:workflow:Information",
} as const;

const mockWorkflowRoleTermsJa = [
  {
    iri: MOCK_WORKFLOW_ROLE_CLASSES.process,
    termId: "workflow-role-process",
    kind: "class",
    roles: ["type-object"],
    label: "処理",
    description: "作業や判断など、業務の中で実行する内容です。",
    category: "要素の種類",
  },
  {
    iri: MOCK_WORKFLOW_ROLE_CLASSES.event,
    termId: "workflow-role-event",
    kind: "class",
    roles: ["type-object"],
    label: "出来事",
    description: "開始、待機、受信、完了など、状態が変わる時点です。",
    category: "要素の種類",
  },
  {
    iri: MOCK_WORKFLOW_ROLE_CLASSES.gateway,
    termId: "workflow-role-gateway",
    kind: "class",
    roles: ["type-object"],
    label: "分岐・合流",
    description: "流れを複数に分ける、または複数の流れをまとめる地点です。",
    category: "要素の種類",
  },
  {
    iri: MOCK_WORKFLOW_ROLE_CLASSES.information,
    termId: "workflow-role-information",
    kind: "class",
    roles: ["type-object"],
    label: "情報",
    description: "注文、料金、帳票など、業務で受け渡す情報です。",
    category: "要素の種類",
  },
] satisfies readonly (ResolvedAuthoringTerm & { label: string; description: string })[];

const mockWorkflowRoleTermsEn = [
  {
    iri: MOCK_WORKFLOW_ROLE_CLASSES.process,
    termId: "workflow-role-process",
    kind: "class",
    roles: ["type-object"],
    label: "Process",
    description: "Work or a decision performed in the business flow.",
    category: "Element type",
  },
  {
    iri: MOCK_WORKFLOW_ROLE_CLASSES.event,
    termId: "workflow-role-event",
    kind: "class",
    roles: ["type-object"],
    label: "Event",
    description: "A point where state changes, such as start, wait, receive, or completion.",
    category: "Element type",
  },
  {
    iri: MOCK_WORKFLOW_ROLE_CLASSES.gateway,
    termId: "workflow-role-gateway",
    kind: "class",
    roles: ["type-object"],
    label: "Branch or merge",
    description: "A point that splits a flow into alternatives or merges multiple flows.",
    category: "Element type",
  },
  {
    iri: MOCK_WORKFLOW_ROLE_CLASSES.information,
    termId: "workflow-role-information",
    kind: "class",
    roles: ["type-object"],
    label: "Information",
    description: "Information exchanged in a workflow, such as an order, payment, or document.",
    category: "Element type",
  },
] satisfies readonly (ResolvedAuthoringTerm & { label: string; description: string })[];

const mockLayoutRegistry = createStandardLayoutRegistry();
mockLayoutRegistry.register(new ElkLayeredLayoutAdapter(ELK_LAYOUT_REFS.layeredLr, "LR"));
mockLayoutRegistry.register(new ElkLayeredLayoutAdapter(ELK_LAYOUT_REFS.layeredTb, "TB"));

export const mockProjectionRuntimeContext = createProjectionRuntimeContext([
  mockProjectionCatalog,
  mockInstanceFlowProjectionCatalog,
  mockClassificationRegionProjectionCatalog,
].map((catalog) => ({
  profileRef: catalog.profileRef,
  sourceCatalogRefs: [catalogRef(catalog)],
  catalog,
  ruleOrigins: [],
})), mockLayoutRegistry);

const mockAvailableCatalogs = [
  standardRdfRdfsCatalog,
  standardRdfRdfsInstanceFlowCatalog,
  standardRdfRdfsClassificationRegionCatalog,
  mockProjectionCatalog,
  mockInstanceFlowProjectionCatalog,
  mockClassificationRegionProjectionCatalog,
] as const;

/** Selects the exact declared catalog instead of letting same-profile presets shadow each other. */
export function createMockProjectionRuntimeContext(document: IriographDocumentV1): ProjectionRuntimeContext {
  const declared = new Set(document.imports?.map((item) => item.catalogRef) ?? []);
  const catalogs = [...new Set(document.views.map((view) => view.profileRef))].map((profileRef) => {
    const candidates = mockAvailableCatalogs.filter((catalog) => catalog.profileRef === profileRef);
    return candidates.find((catalog) => declared.has(catalogRef(catalog)))
      ?? candidates.find((catalog) => catalogRef(catalog).includes("workflow"))
      ?? candidates[0];
  }).filter((catalog): catalog is typeof mockAvailableCatalogs[number] => Boolean(catalog));
  return createProjectionRuntimeContext(catalogs.map((catalog) => ({
    profileRef: catalog.profileRef,
    sourceCatalogRefs: [catalogRef(catalog)],
    catalog,
    ruleOrigins: [],
  })), mockLayoutRegistry);
}

export function createMockResourceIriAllocator(baseIri: string): ResourceIriAllocator {
  return {
    allocate(request) {
      if (request.signal?.aborted) return undefined;
      return {
        // Identity remains opaque: label/comment carry meaning and may change freely.
        iri: `${baseIri}r-${shortHash(request.requestId)}`,
        requestId: request.requestId,
        baseRevision: request.baseRevision,
        contextId: request.contextId,
      };
    },
  };
}

export const mockResourceIriAllocator = createMockResourceIriAllocator(DEMO_NAMESPACE);

export function createMockAuthoringContext(
  document: IriographDocumentV1,
  locale: MockLocale = "en",
): ResolvedAuthoringContext {
  const localNamespace = document.semantic.baseIri;
  const allocator = createMockResourceIriAllocator(localNamespace);
  const isJa = locale === "ja";
  const workflowRoleTerms = isJa ? mockWorkflowRoleTermsJa : mockWorkflowRoleTermsEn;
  const standardTerms: ResolvedAuthoringTerm[] = [
    { iri: RDFS_CLASS, kind: "class", roles: ["type-object"], label: isJa ? "概念クラス" : "Concept class" },
    { iri: RDF_PROPERTY, kind: "class", roles: ["type-object"], label: isJa ? "関係の定義" : "Relationship definition" },
    { iri: `${RDF}Bag`, kind: "structure", roles: ["type-object"], label: isJa ? "領域（順序なし）" : "Unordered group" },
    { iri: `${RDF}Seq`, kind: "structure", roles: ["type-object"], label: isJa ? "並び順" : "Ordered group" },
    { iri: `${RDF}Alt`, kind: "structure", roles: ["type-object"], label: isJa ? "分岐" : "Alternative group" },
    { iri: RDFS_LABEL, kind: "property", label: isJa ? "名前" : "Name", objectKinds: ["literal"] },
    { iri: `${RDFS}comment`, kind: "property", label: isJa ? "説明" : "Description", objectKinds: ["literal"] },
    { iri: `${RDFS}seeAlso`, kind: "property", label: isJa ? "参照先" : "Related information", objectKinds: ["iri"] },
    { iri: `${RDFS}subClassOf`, kind: "property", label: isJa ? "上位概念" : "Broader class", objectKinds: ["iri"] },
    { iri: `${RDFS}member`, kind: "property", label: isJa ? "標準の包含" : "Contains member", objectKinds: ["iri"], structural: true },
    {
      iri: `${localNamespace}p-03`,
      kind: "property",
      label: isJa ? "監査対象として含む" : "Contains as an audit target",
      description: isJa ? "監査領域へ対象工程を所属させます。" : "Adds a process to an audit scope.",
      category: isJa ? "包含" : "Containment",
      examples: [isJa ? "監査領域に審査工程を含める" : "Include a review process in the audit scope"],
      objectKinds: ["iri"],
      structural: true,
    },
    {
      iri: `${localNamespace}p-01`,
      kind: "property",
      label: isJa ? "関連する" : "Related to",
      description: isJa ? "業務要素間の一般的な関係を示します。" : "Expresses a general relationship between workflow elements.",
      category: isJa ? "一般関係" : "General relationship",
      examples: [isJa ? "受付と審査を関連付ける" : "Relate intake and review"],
      objectKinds: ["iri"],
    },
    {
      iri: `${localNamespace}p-02`,
      kind: "property",
      label: isJa ? "再試行" : "Retry",
      description: isJa ? "処理が以前の工程へ戻る関係を示します。" : "Returns processing to an earlier step.",
      category: isJa ? "業務フロー" : "Workflow",
      examples: [isJa ? "差し戻し後に審査を再試行する" : "Retry review after a return"],
      objectKinds: ["iri"],
    },
  ];
  return {
    contextId: "urn:iriograph:mock:authoring-context",
    contextRevision: `1:${locale}`,
    documentRevision: shortHash(JSON.stringify(document)),
    defaultLocale: locale,
    authoringProfileRef: document.semantic.authoringProfileRef,
    runtime: createMockProjectionRuntimeContext(document),
    resourcePolicy: { allowedMintNamespaces: [localNamespace] },
    termPolicy: {
      existingUnknown: "preserve",
      humanUnknown: "warn",
      llmUnknown: "reject",
      // Humans explicitly defining a class/property through the vocabulary UI
      // receive a confirmation warning. LLM writes remain profile-bound.
      humanMinting: "warn",
      llmMinting: "deny",
    },
    terms: mergeTerms(
      [...standardPredicateTerms({ locale }), ...workflowRoleTerms, ...standardTerms],
      discoverDocumentTerms(document, locale),
    ),
    capabilities: [],
    structuredAuthoring: {
      allowUntypedNodes: false,
      allowClassificationGroups: false,
      nodeRoles: [
        {
          roleId: "role-01",
          classIri: MOCK_WORKFLOW_ROLE_CLASSES.process,
          label: workflowRoleTerms[0]!.label,
          description: workflowRoleTerms[0]!.description,
          displayPriority: 10,
        },
        {
          roleId: "role-02",
          classIri: MOCK_WORKFLOW_ROLE_CLASSES.event,
          label: workflowRoleTerms[1]!.label,
          description: workflowRoleTerms[1]!.description,
          displayPriority: 10,
        },
        {
          roleId: "role-03",
          classIri: MOCK_WORKFLOW_ROLE_CLASSES.gateway,
          label: workflowRoleTerms[2]!.label,
          description: workflowRoleTerms[2]!.description,
          displayPriority: 10,
        },
        {
          roleId: "role-04",
          classIri: MOCK_WORKFLOW_ROLE_CLASSES.information,
          label: workflowRoleTerms[3]!.label,
          description: workflowRoleTerms[3]!.description,
          displayPriority: 10,
        },
      ],
    },
    allocator,
  };
}

function discoverDocumentTerms(
  document: IriographDocumentV1,
  locale: MockLocale,
): ResolvedAuthoringTerm[] {
  const graph = parseSemanticGraph(document);
  const closure = buildLimitedRdfsClosure(graph, rdfRdfsVocabulary);
  const labels = new Map<string, LocalizedLiteralSelection>();
  const comments = new Map<string, LocalizedLiteralSelection>();
  const classes = new Set<string>();
  const properties = new Set<string>();
  for (const quad of graph.quads) {
    if (quad.subject.termType !== "NamedNode") continue;
    if (quad.predicate.value === RDFS_LABEL && quad.object.termType === "Literal") {
      selectLocalizedLiteral(labels, quad.subject.value, quad.object.value, quad.object.language, locale);
    }
    if (quad.predicate.value === `${RDFS}comment` && quad.object.termType === "Literal") {
      selectLocalizedLiteral(comments, quad.subject.value, quad.object.value, quad.object.language, locale);
    }
    if (quad.predicate.value === RDF_TYPE && quad.object.termType === "NamedNode") {
      if (quad.object.value === RDFS_CLASS) classes.add(quad.subject.value);
      if (quad.object.value === RDF_PROPERTY) properties.add(quad.subject.value);
    }
    if (quad.predicate.value === RDFS_SUBPROPERTY_OF) properties.add(quad.subject.value);
  }
  return [
    ...[...classes].sort().map((iri): ResolvedAuthoringTerm => ({
      iri,
      kind: "class",
      roles: ["type-object"],
      label: labels.get(iri)?.value,
      description: comments.get(iri)?.value,
      category: locale === "ja" ? "ドキュメントの概念" : "Document concepts",
    })),
    ...[...properties].sort().map((iri): ResolvedAuthoringTerm => ({
      ...propertyConstraints(closure.subpropertyDistance(iri, `${RDFS}member`) !== undefined),
      iri,
      kind: "property",
      roles: ["predicate"],
      label: labels.get(iri)?.value,
      description: comments.get(iri)?.value,
      category: locale === "ja" ? "ドキュメントの関係" : "Document relationships",
    })),
  ];
}

function propertyConstraints(
  structural: boolean,
): Pick<ResolvedAuthoringTerm, "objectKinds" | "structural"> {
  return structural
    ? { objectKinds: ["iri"], structural: true }
    : { objectKinds: ["iri", "literal"] };
}

type LocalizedLiteralSelection = { value: string; rank: number; language: string };

function selectLocalizedLiteral(
  selected: Map<string, LocalizedLiteralSelection>,
  iri: string,
  value: string,
  language: string,
  locale: MockLocale,
): void {
  const normalizedLanguage = language.toLowerCase();
  const candidate: LocalizedLiteralSelection = {
    value: value.normalize("NFC"),
    rank: normalizedLanguage === locale ? 0
      : normalizedLanguage.startsWith(`${locale}-`) ? 1
        : normalizedLanguage === "" ? 2 : 3,
    language: normalizedLanguage,
  };
  const current = selected.get(iri);
  if (
    !current
    || candidate.rank < current.rank
    || (candidate.rank === current.rank && candidate.language < current.language)
    || (
      candidate.rank === current.rank
      && candidate.language === current.language
      && candidate.value < current.value
    )
  ) selected.set(iri, candidate);
}

function mergeTerms(
  preferred: readonly ResolvedAuthoringTerm[],
  discovered: readonly ResolvedAuthoringTerm[],
): ResolvedAuthoringTerm[] {
  return [...preferred, ...discovered].filter((term, index, terms) => (
    terms.findIndex((candidate) => candidate.iri === term.iri) === index
  ));
}

function shortHash(value: string): string {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
