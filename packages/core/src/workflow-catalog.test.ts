import { describe, expect, it } from "vitest";

import {
  catalogRef,
  createPackageDefaultIconResolver,
  createStandardWorkflowCatalog,
  projectSemanticView,
  standardWorkflowClassificationRegionCatalog,
  standardWorkflowInstanceFlowCatalog,
  workflowIconRefs,
} from "./index";
import type { IriographDocumentV1, ProjectionCatalogV1 } from "./model";

describe("standard workflow presentation catalogs", () => {
  it("portable catalogRefとoverlay template/style/iconをpackage内で正確に解決する", async () => {
    const catalog = standardWorkflowInstanceFlowCatalog;
    const document = documentFor(catalog);
    document.views[0]!.overlay.task = {
      semanticRef: "urn:test:workflow-catalog:task",
      appearance: {
        templateRef: "urn:iriograph:template:service-task:1",
        styleRef: "urn:iriograph:style:region:overlap:1",
      },
    };

    const scene = projectSemanticView(document, catalog);
    const task = scene.nodes.find((node) => node.semanticRef === "urn:test:workflow-catalog:task");

    expect(document.imports).toEqual([
      { catalogRef: "urn:iriograph:catalog:workflow-instance-flow@1" },
    ]);
    expect(catalogRef(catalog)).toBe(document.imports![0]!.catalogRef);
    expect(task).toMatchObject({
      templateRef: "urn:iriograph:template:service-task:1",
      iconRef: workflowIconRefs.serviceTask,
      style: {
        fill: "#ede9fe",
        stroke: "#7c3aed",
        text: "#4c1d95",
        fillOpacity: 0.2,
        strokeWidth: 2,
        dash: "6 4",
      },
    });
    expect(catalog.assets[workflowIconRefs.serviceTask]).toMatchObject({
      assetRef: workflowIconRefs.serviceTask,
      mediaType: "image/svg+xml",
    });

    const result = await createPackageDefaultIconResolver().resolve({
      assetRef: workflowIconRefs.serviceTask,
      definition: catalog.assets[workflowIconRefs.serviceTask],
      revision: "test",
      signal: new AbortController().signal,
    });
    expect(result).toMatchObject({
      status: "resolved",
      lease: { mediaType: "image/svg+xml", svgViewBox: "0 0 24 24" },
    });
    if (result.status === "resolved") {
      expect(result.lease.url).toMatch(/^data:image\/svg\+xml/u);
      result.lease.release();
    }
  });

  it("instance-flowとclassification-regionのstable catalog IDをprofileに対応付ける", () => {
    expect(createStandardWorkflowCatalog("instance-flow")).toEqual(
      standardWorkflowInstanceFlowCatalog,
    );
    expect(catalogRef(standardWorkflowClassificationRegionCatalog))
      .toBe("urn:iriograph:catalog:workflow-classification-region@1");
    expect(standardWorkflowClassificationRegionCatalog.profileRef)
      .toBe("urn:iriograph:profile:rdf-rdfs:classification-region:1");
  });
});

function documentFor(catalog: ProjectionCatalogV1): IriographDocumentV1 {
  return {
    schemaVersion: "1",
    kind: "iriograph.document",
    documentId: "workflow-catalog-test",
    semantic: {
      format: "text/turtle",
      baseIri: "urn:test:workflow-catalog:",
      authoringProfileRef: "urn:test:authoring-profile:1",
      source: `
        @prefix : <urn:test:workflow-catalog:> .
        @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
        :task rdfs:label "Task" .
      `,
    },
    imports: [{ catalogRef: catalogRef(catalog) }],
    views: [{
      viewId: "main",
      kind: "node-link",
      profileRef: catalog.profileRef,
      layoutRef: catalog.defaults!.layoutRef,
      overlay: {},
    }],
  };
}
