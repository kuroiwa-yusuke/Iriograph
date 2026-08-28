import { packageDefaultIconAssets, PACKAGE_DEFAULT_ICON_NAMESPACE } from "./default-icons.js";
import type { AssetDefinition, ProjectionCatalogV1, VisualTemplate } from "./model.js";
import {
  createStandardRdfRdfsCatalog,
  type RdfRdfsCatalogPreset,
} from "./standard-catalog.js";

/**
 * Presentation-only workflow vocabulary. These identifiers are intentionally
 * independent of any host so portable overlays can resolve in every host that
 * ships @iriograph/core.
 */
export const workflowIconRefs = Object.freeze({
  userTask: `${PACKAGE_DEFAULT_ICON_NAMESPACE}user-round:1`,
  serviceTask: `${PACKAGE_DEFAULT_ICON_NAMESPACE}cog:1`,
  reference: `${PACKAGE_DEFAULT_ICON_NAMESPACE}file-text:1`,
});

const workflowTemplates: Readonly<Record<string, VisualTemplate>> = Object.freeze({
  "urn:iriograph:template:lane:1": {
    templateRef: "urn:iriograph:template:lane:1",
    structuralKind: "container",
    headerPosition: "left",
    style: {
      fill: "#f8fbf9",
      stroke: "#b4c5c2",
      text: "#345054",
      accent: "#dbe9e5",
    },
    defaultSize: { width: 1000, height: 230 },
  },
  "urn:iriograph:template:start-event:1": {
    templateRef: "urn:iriograph:template:start-event:1",
    structuralKind: "node",
    shape: "circle",
    style: {
      fill: "#e9f8ee",
      stroke: "#30925b",
      text: "#1d6640",
      accent: "#30925b",
    },
    defaultSize: { width: 58, height: 58 },
  },
  "urn:iriograph:template:user-task:1": {
    templateRef: "urn:iriograph:template:user-task:1",
    structuralKind: "node",
    shape: "rounded-rectangle",
    iconRef: workflowIconRefs.userTask,
    style: {
      fill: "#fffdf5",
      stroke: "#c1963f",
      text: "#493c23",
      accent: "#e9c66e",
    },
    defaultSize: { width: 170, height: 76 },
  },
  "urn:iriograph:template:service-task:1": {
    templateRef: "urn:iriograph:template:service-task:1",
    structuralKind: "node",
    shape: "rounded-rectangle",
    iconRef: workflowIconRefs.serviceTask,
    style: {
      fill: "#eef7f7",
      stroke: "#3a8589",
      text: "#234f52",
      accent: "#66adb0",
    },
    defaultSize: { width: 170, height: 76 },
  },
  "urn:iriograph:template:gateway:1": {
    templateRef: "urn:iriograph:template:gateway:1",
    structuralKind: "node",
    shape: "diamond",
    style: {
      fill: "#fff5d9",
      stroke: "#b47c16",
      text: "#624712",
      accent: "#b47c16",
    },
    defaultSize: { width: 84, height: 84 },
  },
  "urn:iriograph:template:end-event:1": {
    templateRef: "urn:iriograph:template:end-event:1",
    structuralKind: "node",
    shape: "circle",
    style: {
      fill: "#fceeed",
      stroke: "#b8514d",
      text: "#7a302d",
      accent: "#b8514d",
    },
    defaultSize: { width: 58, height: 58 },
  },
  "urn:iriograph:template:reference:1": {
    templateRef: "urn:iriograph:template:reference:1",
    structuralKind: "node",
    shape: "rectangle",
    iconRef: workflowIconRefs.reference,
    style: {
      fill: "#fffef8",
      stroke: "#879697",
      text: "#243b3d",
      accent: "#879697",
    },
    defaultSize: { width: 168, height: 72 },
  },
});

const workflowAssets: Readonly<Record<string, AssetDefinition>> = Object.freeze(
  Object.fromEntries(Object.values(workflowIconRefs).map((assetRef) => [
    assetRef,
    packageDefaultIconAssets[assetRef]!,
  ])),
);

const workflowCatalogIds: Readonly<Record<RdfRdfsCatalogPreset, string>> = Object.freeze({
  full: "urn:iriograph:catalog:workflow",
  "instance-flow": "urn:iriograph:catalog:workflow-instance-flow",
  "classification-region": "urn:iriograph:catalog:workflow-classification-region",
});

/**
 * Builds a self-contained RDF/RDFS workflow presentation catalog. The base
 * profile rules and workflow templates are exported together so one stable
 * catalog import resolves portable template, style, and icon references.
 */
export function createStandardWorkflowCatalog(
  preset: RdfRdfsCatalogPreset = "full",
): ProjectionCatalogV1 {
  const base = createStandardRdfRdfsCatalog(preset);
  return {
    ...base,
    catalogId: workflowCatalogIds[preset],
    templates: { ...base.templates, ...workflowTemplates },
    styles: { ...base.styles },
    assets: { ...base.assets, ...workflowAssets },
  };
}

/** Full RDF/RDFS workflow catalog retained for hosts that use the full profile. */
export const standardWorkflowCatalog = createStandardWorkflowCatalog();

/** Workflow catalog for node-link instance flows. */
export const standardWorkflowInstanceFlowCatalog = createStandardWorkflowCatalog("instance-flow");

/** Workflow catalog for overlapping classification-region views. */
export const standardWorkflowClassificationRegionCatalog = createStandardWorkflowCatalog(
  "classification-region",
);
