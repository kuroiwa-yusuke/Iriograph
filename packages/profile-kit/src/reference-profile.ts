import {
  standardWorkflowInstanceFlowCatalog,
  type IriographDocumentV1,
} from "@iriograph/core";

import type { DomainProjectionProfileManifestV1 } from "./index.js";

export const REFERENCE_WORKFLOW_PROFILE_REF = "urn:iriograph:profile:reference-workflow@1";
export const REFERENCE_WORKFLOW_CATALOG_REF = "urn:iriograph:catalog:reference-workflow@1";

/** Small distributable example proving that a domain profile needs no Core branch. */
export const referenceWorkflowProfile: DomainProjectionProfileManifestV1 = Object.freeze({
  schemaVersion: "1",
  kind: "iriograph.domain-profile",
  profileId: "urn:iriograph:profile:reference-workflow",
  profileVersion: "1",
  profileRef: REFERENCE_WORKFLOW_PROFILE_REF,
  defaultLocale: "ja",
  ontology: {
    mediaType: "text/turtle",
    source: [
      "@prefix ex: <urn:iriograph:reference-workflow:> .",
      "@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .",
      "@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .",
      "ex:Task a rdfs:Class ; rdfs:label \"作業\"@ja .",
      "ex:next a rdf:Property ; rdfs:label \"次の工程\"@ja .",
    ].join("\n"),
  },
  authoring: {
    roles: [{ roleId: "task", classIri: "urn:iriograph:reference-workflow:Task", label: "作業" }],
    terms: [{
      termId: "next",
      iri: "urn:iriograph:reference-workflow:next",
      kind: "property",
      roles: ["predicate"],
      label: "次の工程",
      objectKinds: ["iri"],
    }],
  },
  catalogRefs: ["urn:iriograph:catalog:workflow-instance-flow@1"],
  catalog: {
    ...standardWorkflowInstanceFlowCatalog,
    catalogId: "urn:iriograph:catalog:reference-workflow",
    catalogVersion: "1",
    profileRef: REFERENCE_WORKFLOW_PROFILE_REF,
    templates: {
      ...standardWorkflowInstanceFlowCatalog.templates,
      "urn:iriograph:template:node:generic:1": {
        ...standardWorkflowInstanceFlowCatalog.templates["urn:iriograph:template:node:generic:1"]!,
        ports: [
          { portId: "input", label: "入力", role: "target", side: "left", position: .5, predicateIris: ["urn:iriograph:reference-workflow:next"] },
          { portId: "output", label: "出力", role: "source", side: "right", position: .5, predicateIris: ["urn:iriograph:reference-workflow:next"] },
          { portId: "aux-top", label: "補助", role: "both", side: "top", position: .5 },
        ],
      },
    },
  },
  licenses: [{ licenseId: "CC0-1.0", notice: "Iriograph reference ontology fixture." }],
} satisfies DomainProjectionProfileManifestV1);

export const referenceWorkflowFixture: IriographDocumentV1 = Object.freeze({
  schemaVersion: "1",
  kind: "iriograph.document",
  documentId: "iriograph-reference-workflow",
  semantic: {
    format: "text/turtle",
    baseIri: "urn:iriograph:reference-workflow:fixture:",
    authoringProfileRef: "urn:iriograph:authoring-profile:reference-workflow@1",
    source: [
      "@prefix : <urn:iriograph:reference-workflow:fixture:> .",
      "@prefix ex: <urn:iriograph:reference-workflow:> .",
      "@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .",
      ":start a ex:Task ; rdfs:label \"開始\"@ja ; ex:next :finish .",
      ":finish a ex:Task ; rdfs:label \"完了\"@ja .",
    ].join("\n"),
  },
  imports: [{ catalogRef: REFERENCE_WORKFLOW_CATALOG_REF }],
  views: [{
    viewId: "main",
    kind: "region",
    profileRef: REFERENCE_WORKFLOW_PROFILE_REF,
    layoutRef: standardWorkflowInstanceFlowCatalog.defaults!.layoutRef,
    locale: "ja",
    overlay: {},
  }],
} satisfies IriographDocumentV1);
