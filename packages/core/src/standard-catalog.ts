import type { ProjectionCatalogV1 } from "./model.js";

export type RdfRdfsCatalogPreset = "full" | "instance-flow" | "classification-region";

export type RdfRdfsVocabulary = {
  typePredicate: string;
  labelPredicate: string;
  commentPredicate: string;
  subClassOfPredicate: string;
  subPropertyOfPredicate: string;
};

const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const RDFS = "http://www.w3.org/2000/01/rdf-schema#";

export const rdfRdfsVocabulary: RdfRdfsVocabulary = Object.freeze({
  typePredicate: `${RDF}type`,
  labelPredicate: `${RDFS}label`,
  commentPredicate: `${RDFS}comment`,
  subClassOfPredicate: `${RDFS}subClassOf`,
  subPropertyOfPredicate: `${RDFS}subPropertyOf`,
});

export const rdfRdfsProfileRefs = Object.freeze({
  full: "urn:iriograph:profile:rdf-rdfs:1",
  instanceFlow: "urn:iriograph:profile:rdf-rdfs:instance-flow:1",
  classificationRegion: "urn:iriograph:profile:rdf-rdfs:classification-region:1",
});

const baseRdfRdfsCatalog: ProjectionCatalogV1 = {
  schemaVersion: "1",
  kind: "iriograph.catalog",
  catalogId: "urn:iriograph:catalog:rdf-rdfs",
  catalogVersion: "1",
  profileRef: rdfRdfsProfileRefs.full,
  defaults: {
    nodeTemplateRef: "urn:iriograph:template:node:generic:1",
    edgeTemplateRef: "urn:iriograph:template:edge:generic:1",
    regionTemplateRef: "urn:iriograph:template:region:overlap:1",
    layoutRef: "urn:iriograph:layout:hierarchical-lr:1",
  },
  rules: [
    {
      ruleId: "rdf-bag-container",
      priority: 100,
      match: { kind: "type", iri: `${RDF}Bag`, entailment: "rdfs-subclass" },
      project: {
        operator: "membership-container",
        membershipPredicate: `${RDFS}member`,
      },
      templateRef: "urn:iriograph:template:container:region:1",
    },
    {
      ruleId: "rdf-seq",
      priority: 100,
      match: { kind: "type", iri: `${RDF}Seq`, entailment: "rdfs-subclass" },
      project: {
        operator: "ordinal-sequence",
        ordinalPredicatePrefix: `${RDF}_`,
      },
      templateRef: "urn:iriograph:template:container:sequence:1",
    },
    {
      ruleId: "rdf-alt",
      priority: 100,
      match: { kind: "type", iri: `${RDF}Alt`, entailment: "rdfs-subclass" },
      project: {
        operator: "alternative",
        ordinalPredicatePrefix: `${RDF}_`,
        defaultOrdinal: 1,
      },
      templateRef: "urn:iriograph:template:container:alternative:1",
    },
    {
      ruleId: "rdfs-class",
      priority: 20,
      match: { kind: "type", iri: `${RDFS}Class`, entailment: "rdfs-subclass" },
      project: {
        operator: "membership-region",
        membershipPredicate: `${RDF}type`,
        containerPosition: "object",
      },
      templateRef: "urn:iriograph:template:node:class:1",
    },
    {
      ruleId: "rdf-property",
      priority: 20,
      match: { kind: "type", iri: `${RDF}Property`, entailment: "rdfs-subclass" },
      project: { operator: "resource", structuralKind: "node" },
      templateRef: "urn:iriograph:template:node:property:1",
    },
    ...[
      ["rdfs-see-also", `${RDFS}seeAlso`, "urn:iriograph:template:edge:reference:1"],
      ["rdfs-is-defined-by", `${RDFS}isDefinedBy`, "urn:iriograph:template:edge:reference:1"],
      ["rdfs-sub-class-of", `${RDFS}subClassOf`, "urn:iriograph:template:edge:specialization:1"],
      ["rdfs-sub-property-of", `${RDFS}subPropertyOf`, "urn:iriograph:template:edge:specialization:1"],
      ["rdfs-domain", `${RDFS}domain`, "urn:iriograph:template:edge:ontology:1"],
      ["rdfs-range", `${RDFS}range`, "urn:iriograph:template:edge:ontology:1"],
    ].map(([ruleId, iri, templateRef]) => ({
      ruleId: ruleId!,
      priority: 50,
      match: {
        kind: "predicate" as const,
        iri: iri!,
        entailment: "rdfs-subproperty" as const,
      },
      project: { operator: "direct-edge" as const },
      templateRef: templateRef!,
    })),
    ...[
      ["rdf-type-metadata", `${RDF}type`],
      ["rdfs-label-metadata", `${RDFS}label`],
      ["rdfs-comment-metadata", `${RDFS}comment`],
      ["rdfs-member-structure", `${RDFS}member`],
    ].map(([ruleId, iri]) => ({
      ruleId: ruleId!,
      priority: 100,
      match: {
        kind: "predicate" as const,
        iri: iri!,
        entailment: "exact" as const,
      },
      project: { operator: "suppress" as const },
    })),
    {
      ruleId: "iri-object-fallback",
      priority: -100,
      match: { kind: "any-iri-object" },
      project: { operator: "direct-edge" },
      templateRef: "urn:iriograph:template:edge:generic:1",
    },
  ],
  templates: {
    "urn:iriograph:template:node:generic:1": {
      templateRef: "urn:iriograph:template:node:generic:1",
      structuralKind: "node",
      shape: "rounded-rectangle",
      style: { fill: "#ffffff", stroke: "#334155", text: "#0f172a" },
      defaultSize: { width: 164, height: 72 },
    },
    "urn:iriograph:template:node:choice:1": {
      templateRef: "urn:iriograph:template:node:choice:1",
      structuralKind: "node",
      shape: "diamond",
      style: { fill: "#fff7ed", stroke: "#c2410c", text: "#7c2d12" },
      defaultSize: { width: 104, height: 104 },
    },
    "urn:iriograph:template:container:sequence:1": {
      templateRef: "urn:iriograph:template:container:sequence:1",
      structuralKind: "container",
      headerPosition: "top",
      style: {
        fill: "#ffffff",
        stroke: "#64748b",
        text: "#334155",
        fillOpacity: 0.16,
        strokeWidth: 1,
        dash: "5 5",
      },
      defaultSize: { width: 360, height: 160 },
    },
    "urn:iriograph:template:container:alternative:1": {
      templateRef: "urn:iriograph:template:container:alternative:1",
      structuralKind: "container",
      headerPosition: "top",
      style: {
        fill: "#fff7ed",
        stroke: "#c2410c",
        text: "#7c2d12",
        fillOpacity: 0.12,
        strokeWidth: 1,
        dash: "4 4",
      },
      defaultSize: { width: 360, height: 180 },
    },
    "urn:iriograph:template:node:class:1": {
      templateRef: "urn:iriograph:template:node:class:1",
      structuralKind: "node",
      shape: "rectangle",
      style: { fill: "#eff6ff", stroke: "#2563eb", text: "#1e3a8a" },
      defaultSize: { width: 176, height: 72 },
    },
    "urn:iriograph:template:node:property:1": {
      templateRef: "urn:iriograph:template:node:property:1",
      structuralKind: "node",
      shape: "rounded-rectangle",
      style: { fill: "#f5f3ff", stroke: "#7c3aed", text: "#4c1d95" },
      defaultSize: { width: 176, height: 72 },
    },
    "urn:iriograph:template:container:region:1": {
      templateRef: "urn:iriograph:template:container:region:1",
      structuralKind: "container",
      headerPosition: "left",
      style: { fill: "#f8fafc", stroke: "#64748b", text: "#0f172a" },
      defaultSize: { width: 720, height: 220 },
    },
    "urn:iriograph:template:region:overlap:1": {
      templateRef: "urn:iriograph:template:region:overlap:1",
      structuralKind: "region",
      style: {
        fill: "#dbeafe",
        stroke: "#2563eb",
        text: "#1e3a8a",
        fillOpacity: 0.18,
        strokeWidth: 2,
      },
      defaultSize: { width: 360, height: 220 },
    },
    "urn:iriograph:template:edge:generic:1": {
      templateRef: "urn:iriograph:template:edge:generic:1",
      structuralKind: "edge",
      targetMarker: "arrow",
      style: { fill: "none", stroke: "#475569", text: "#334155" },
    },
    "urn:iriograph:template:edge:reference:1": {
      templateRef: "urn:iriograph:template:edge:reference:1",
      structuralKind: "edge",
      targetMarker: "open-arrow",
      style: { fill: "none", stroke: "#475569", text: "#334155" },
    },
    "urn:iriograph:template:edge:specialization:1": {
      templateRef: "urn:iriograph:template:edge:specialization:1",
      structuralKind: "edge",
      targetMarker: "triangle",
      style: { fill: "none", stroke: "#475569", text: "#334155" },
    },
    "urn:iriograph:template:edge:ontology:1": {
      templateRef: "urn:iriograph:template:edge:ontology:1",
      structuralKind: "edge",
      targetMarker: "arrow",
      style: { fill: "none", stroke: "#475569", text: "#334155" },
    },
  },
  styles: {
    "urn:iriograph:style:region:overlap:1": {
      fill: "#ede9fe",
      stroke: "#7c3aed",
      text: "#4c1d95",
      fillOpacity: 0.2,
      strokeWidth: 2,
      dash: "6 4",
    },
  },
  assets: {},
};

const profileDefinitions: Record<RdfRdfsCatalogPreset, {
  catalogId: string;
  profileRef: string;
}> = {
  full: {
    catalogId: "urn:iriograph:catalog:rdf-rdfs",
    profileRef: rdfRdfsProfileRefs.full,
  },
  "instance-flow": {
    catalogId: "urn:iriograph:catalog:rdf-rdfs-instance-flow",
    profileRef: rdfRdfsProfileRefs.instanceFlow,
  },
  "classification-region": {
    catalogId: "urn:iriograph:catalog:rdf-rdfs-classification-region",
    profileRef: rdfRdfsProfileRefs.classificationRegion,
  },
};

const schemaPredicateSuppressRules: ProjectionCatalogV1["rules"] = [
  ["rdfs-sub-class-of-definition", `${RDFS}subClassOf`],
  ["rdfs-sub-property-of-definition", `${RDFS}subPropertyOf`],
  ["rdfs-domain-definition", `${RDFS}domain`],
  ["rdfs-range-definition", `${RDFS}range`],
].map(([ruleId, iri]) => ({
  ruleId: `profile-suppress-${ruleId!}`,
  priority: 200,
  match: {
    kind: "predicate" as const,
    iri: iri!,
    entailment: "rdfs-subproperty" as const,
  },
  project: { operator: "suppress" as const },
}));

/**
 * Builds one of the standard RDF/RDFS projection profiles without changing the
 * full ontology-oriented profile used by existing documents.
 */
export function createStandardRdfRdfsCatalog(
  preset: RdfRdfsCatalogPreset = "full",
): ProjectionCatalogV1 {
  const definition = profileDefinitions[preset];
  const resourceSuppressRules: ProjectionCatalogV1["rules"] = preset === "instance-flow"
    ? [
        {
          ruleId: "profile-suppress-rdfs-class-definition",
          priority: 220,
          match: { kind: "type", iri: `${RDFS}Class`, entailment: "rdfs-subclass" },
          project: { operator: "suppress" },
        },
        {
          ruleId: "profile-suppress-rdf-property-definition",
          priority: 210,
          match: { kind: "type", iri: `${RDF}Property`, entailment: "rdfs-subclass" },
          project: { operator: "suppress" },
        },
      ]
    : preset === "classification-region"
      ? [{
          ruleId: "profile-suppress-rdf-property-definition",
          priority: 210,
          match: { kind: "type", iri: `${RDF}Property`, entailment: "rdfs-subclass" },
          project: { operator: "suppress" },
        }]
      : [];
  const profileRules = preset === "full"
    ? []
    : [...resourceSuppressRules, ...schemaPredicateSuppressRules];

  return {
    ...baseRdfRdfsCatalog,
    catalogId: definition.catalogId,
    profileRef: definition.profileRef,
    rules: [...profileRules, ...baseRdfRdfsCatalog.rules],
    templates: { ...baseRdfRdfsCatalog.templates },
    styles: { ...baseRdfRdfsCatalog.styles },
    assets: { ...baseRdfRdfsCatalog.assets },
  };
}

/** Full RDF/RDFS ontology and instance projection retained for compatibility. */
export const standardRdfRdfsCatalog = createStandardRdfRdfsCatalog("full");

/** Instance and workflow projection without vocabulary-definition resources. */
export const standardRdfRdfsInstanceFlowCatalog = createStandardRdfRdfsCatalog("instance-flow");

/** Region projection that keeps class membership but hides property/schema definitions. */
export const standardRdfRdfsClassificationRegionCatalog = createStandardRdfRdfsCatalog(
  "classification-region",
);

export function catalogRef(catalog: ProjectionCatalogV1): string {
  return `${catalog.catalogId}@${catalog.catalogVersion}`;
}
