import {
  catalogRef,
  buildLimitedRdfsClosure,
  createProjectionRuntimeContext,
  createStandardLayoutRegistry,
  parseSemanticGraph,
  rdfRdfsVocabulary,
  type IriographDocumentV1,
  type ResolvedAuthoringContext,
  type ResolvedAuthoringTerm,
  type ResourceIriAllocator,
} from "@iriograph/core";
import {
  ELK_LAYOUT_REFS,
  ElkLayeredLayoutAdapter,
} from "@iriograph/layout-elk";
import { standardPredicateTermsJa } from "@iriograph/semantic-access";

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

const mockWorkflowRoleTerms: readonly ResolvedAuthoringTerm[] = [
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
];

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
): ResolvedAuthoringContext {
  const localNamespace = document.semantic.baseIri;
  const allocator = createMockResourceIriAllocator(localNamespace);
  const standardTerms: ResolvedAuthoringTerm[] = [
    { iri: RDFS_CLASS, kind: "class", roles: ["type-object"], label: "概念クラス" },
    { iri: RDF_PROPERTY, kind: "class", roles: ["type-object"], label: "関係の定義" },
    { iri: `${RDF}Bag`, kind: "structure", roles: ["type-object"], label: "領域（順序なし）" },
    { iri: `${RDF}Seq`, kind: "structure", roles: ["type-object"], label: "並び順" },
    { iri: `${RDF}Alt`, kind: "structure", roles: ["type-object"], label: "分岐" },
    { iri: RDFS_LABEL, kind: "property", label: "名前", objectKinds: ["literal"] },
    { iri: `${RDFS}comment`, kind: "property", label: "説明", objectKinds: ["literal"] },
    { iri: `${RDFS}seeAlso`, kind: "property", label: "参照先", objectKinds: ["iri"] },
    { iri: `${RDFS}subClassOf`, kind: "property", label: "上位概念", objectKinds: ["iri"] },
    { iri: `${RDFS}member`, kind: "property", label: "標準の包含", objectKinds: ["iri"], structural: true },
    {
      iri: `${localNamespace}p-03`,
      kind: "property",
      label: "監査対象として含む",
      description: "監査領域へ対象工程を所属させます。",
      category: "包含",
      examples: ["監査領域に審査工程を含める"],
      objectKinds: ["iri"],
      structural: true,
    },
    {
      iri: `${localNamespace}p-01`,
      kind: "property",
      label: "関連する",
      description: "業務要素間の一般的な関係を示します。",
      category: "一般関係",
      examples: ["受付と審査を関連付ける"],
      objectKinds: ["iri"],
    },
    {
      iri: `${localNamespace}p-02`,
      kind: "property",
      label: "再試行",
      description: "処理が以前の工程へ戻る関係を示します。",
      category: "業務フロー",
      examples: ["差し戻し後に審査を再試行する"],
      objectKinds: ["iri"],
    },
  ];
  return {
    contextId: "urn:iriograph:mock:authoring-context",
    contextRevision: "1",
    documentRevision: shortHash(JSON.stringify(document)),
    defaultLocale: "ja",
    authoringProfileRef: document.semantic.authoringProfileRef,
    runtime: mockProjectionRuntimeContext,
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
      [...standardPredicateTermsJa(), ...mockWorkflowRoleTerms, ...standardTerms],
      discoverDocumentTerms(document),
    ),
    capabilities: [],
    structuredAuthoring: {
      allowUntypedNodes: false,
      allowClassificationGroups: true,
      nodeRoles: [
        {
          roleId: "role-01",
          classIri: MOCK_WORKFLOW_ROLE_CLASSES.process,
          label: "処理",
          description: "作業や判断など、業務の中で実行する内容です。",
        },
        {
          roleId: "role-02",
          classIri: MOCK_WORKFLOW_ROLE_CLASSES.event,
          label: "出来事",
          description: "開始、待機、受信、完了など、状態が変わる時点です。",
        },
        {
          roleId: "role-03",
          classIri: MOCK_WORKFLOW_ROLE_CLASSES.gateway,
          label: "分岐・合流",
          description: "流れを複数に分ける、または複数の流れをまとめる地点です。",
        },
        {
          roleId: "role-04",
          classIri: MOCK_WORKFLOW_ROLE_CLASSES.information,
          label: "情報",
          description: "注文、料金、帳票など、業務で受け渡す情報です。",
        },
      ],
    },
    allocator,
  };
}

function discoverDocumentTerms(document: IriographDocumentV1): ResolvedAuthoringTerm[] {
  const graph = parseSemanticGraph(document);
  const closure = buildLimitedRdfsClosure(graph, rdfRdfsVocabulary);
  const labels = new Map<string, LocalizedLiteralSelection>();
  const comments = new Map<string, LocalizedLiteralSelection>();
  const classes = new Set<string>();
  const properties = new Set<string>();
  for (const quad of graph.quads) {
    if (quad.subject.termType !== "NamedNode") continue;
    if (quad.predicate.value === RDFS_LABEL && quad.object.termType === "Literal") {
      selectJapaneseLiteral(labels, quad.subject.value, quad.object.value, quad.object.language);
    }
    if (quad.predicate.value === `${RDFS}comment` && quad.object.termType === "Literal") {
      selectJapaneseLiteral(comments, quad.subject.value, quad.object.value, quad.object.language);
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
      category: "ドキュメントの概念",
    })),
    ...[...properties].sort().map((iri): ResolvedAuthoringTerm => ({
      ...propertyConstraints(closure.subpropertyDistance(iri, `${RDFS}member`) !== undefined),
      iri,
      kind: "property",
      roles: ["predicate"],
      label: labels.get(iri)?.value,
      description: comments.get(iri)?.value,
      category: "ドキュメントの関係",
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

function selectJapaneseLiteral(
  selected: Map<string, LocalizedLiteralSelection>,
  iri: string,
  value: string,
  language: string,
): void {
  const normalizedLanguage = language.toLowerCase();
  const candidate: LocalizedLiteralSelection = {
    value: value.normalize("NFC"),
    rank: normalizedLanguage === "ja" ? 0
      : normalizedLanguage.startsWith("ja-") ? 1
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
