import {
  catalogRef,
  createProjectionRuntimeContext,
  createStandardLayoutRegistry,
  type IriographDocumentV1,
  type ResolvedAuthoringContext,
  type ResourceIriAllocator,
} from "@iriograph/core";
import {
  ELK_LAYOUT_REFS,
  ElkLayeredLayoutAdapter,
} from "@iriograph/layout-elk";

import { mockProjectionCatalog } from "./catalog";

const DEMO_NAMESPACE = "urn:iriograph:demo:";
const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const RDFS = "http://www.w3.org/2000/01/rdf-schema#";

const mockLayoutRegistry = createStandardLayoutRegistry();
mockLayoutRegistry.register(new ElkLayeredLayoutAdapter(ELK_LAYOUT_REFS.layeredLr, "LR"));
mockLayoutRegistry.register(new ElkLayeredLayoutAdapter(ELK_LAYOUT_REFS.layeredTb, "TB"));

export const mockProjectionRuntimeContext = createProjectionRuntimeContext([{
  profileRef: mockProjectionCatalog.profileRef,
  sourceCatalogRefs: [catalogRef(mockProjectionCatalog)],
  catalog: mockProjectionCatalog,
  ruleOrigins: [],
}], mockLayoutRegistry);

export const mockResourceIriAllocator: ResourceIriAllocator = {
  allocate(request) {
    if (request.signal?.aborted) return undefined;
    return {
      // Identity remains opaque: label/comment carry meaning and may change freely.
      iri: `${DEMO_NAMESPACE}r-${shortHash(request.requestId)}`,
      requestId: request.requestId,
      baseRevision: request.baseRevision,
      contextId: request.contextId,
    };
  },
};

export function createMockAuthoringContext(
  document: IriographDocumentV1,
): ResolvedAuthoringContext {
  return {
    contextId: "urn:iriograph:mock:authoring-context",
    contextRevision: "1",
    documentRevision: shortHash(JSON.stringify(document)),
    authoringProfileRef: document.semantic.authoringProfileRef,
    runtime: mockProjectionRuntimeContext,
    resourcePolicy: { allowedMintNamespaces: [DEMO_NAMESPACE] },
    termPolicy: {
      existingUnknown: "preserve",
      humanUnknown: "warn",
      llmUnknown: "reject",
      humanMinting: "deny",
      llmMinting: "deny",
    },
    terms: [
      { iri: `${RDFS}Class`, kind: "class", roles: ["type-object"], label: "概念クラス" },
      { iri: `${RDF}Property`, kind: "class", roles: ["type-object"], label: "関係の定義" },
      { iri: `${RDF}Bag`, kind: "structure", roles: ["type-object"], label: "領域（順序なし）" },
      { iri: `${RDF}Seq`, kind: "structure", roles: ["type-object"], label: "並び順" },
      { iri: `${RDF}Alt`, kind: "structure", roles: ["type-object"], label: "分岐" },
      { iri: `${RDFS}label`, kind: "property", label: "名前", objectKinds: ["literal"] },
      { iri: `${RDFS}comment`, kind: "property", label: "説明", objectKinds: ["literal"] },
      { iri: `${RDFS}seeAlso`, kind: "property", label: "参照先", objectKinds: ["iri"] },
      { iri: `${RDFS}member`, kind: "property", label: "標準の包含", objectKinds: ["iri"], structural: true },
      { iri: `${DEMO_NAMESPACE}p-03`, kind: "property", label: "監査対象として含む", objectKinds: ["iri"], structural: true },
      { iri: `${DEMO_NAMESPACE}p-01`, kind: "property", label: "関連する", objectKinds: ["iri"] },
      { iri: `${DEMO_NAMESPACE}p-02`, kind: "property", label: "再試行", objectKinds: ["iri"] },
    ],
    capabilities: [],
    allocator: mockResourceIriAllocator,
  };
}

function shortHash(value: string): string {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
