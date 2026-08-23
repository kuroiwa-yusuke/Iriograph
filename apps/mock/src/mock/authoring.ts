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
    const localName = normalizeLocalName(request.suggestedLocalName)
      || `resource-${shortHash(request.requestId)}`;
    return {
      iri: `${DEMO_NAMESPACE}${localName}-${shortHash(request.requestId)}`,
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
      { iri: `${RDF}Bag`, kind: "structure", roles: ["type-object"], label: "Bag / Lane" },
      { iri: `${RDF}Seq`, kind: "structure", roles: ["type-object"], label: "Sequence" },
      { iri: `${RDF}Alt`, kind: "structure", roles: ["type-object"], label: "Alternatives" },
      { iri: `${RDFS}label`, kind: "property", label: "Label", objectKinds: ["literal"] },
      { iri: `${RDFS}comment`, kind: "property", label: "Comment", objectKinds: ["literal"] },
      { iri: `${RDFS}seeAlso`, kind: "property", label: "See also", objectKinds: ["iri"] },
      { iri: `${RDFS}member`, kind: "property", label: "Membership", objectKinds: ["iri"], structural: true },
      { iri: `${DEMO_NAMESPACE}relatedTo`, kind: "property", label: "Related to", objectKinds: ["iri"] },
      { iri: `${DEMO_NAMESPACE}retry`, kind: "property", label: "Retry", objectKinds: ["iri"] },
    ],
    capabilities: [{
      capabilityId: "urn:iriograph:demo:capability:relate",
      label: "Resourcesを関連付ける",
      parameters: [
        { name: "source", objectKinds: ["iri"], required: true },
        { name: "target", objectKinds: ["iri"], required: true },
      ],
      graphPatch: {
        add: [{
          subject: { kind: "binding", name: "source" },
          predicate: { kind: "iri", iri: `${DEMO_NAMESPACE}relatedTo` },
          object: { kind: "binding", name: "target" },
        }],
      },
    }],
    allocator: mockResourceIriAllocator,
  };
}

function normalizeLocalName(value: string | undefined): string {
  return value?.normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 36) ?? "";
}

function shortHash(value: string): string {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
