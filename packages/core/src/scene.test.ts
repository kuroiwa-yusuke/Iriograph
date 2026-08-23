import { describe, expect, it } from "vitest";

import { statementIdentity } from "./identity";
import {
  createStandardLayoutRegistry,
  LayoutAdapterRegistry,
  STANDARD_LAYOUT_REFS,
  StandardLightweightLayoutAdapter,
} from "./layout";
import type { IriographDocumentV1 } from "./model";
import { projectSemanticView } from "./projection";
import {
  buildIriographView,
  layoutProjectedDiagramScene,
  type ProjectionRuntimeContext,
} from "./scene";
import { standardRdfRdfsCatalog } from "./standard-catalog";

describe("ProjectedScene conversion", () => {
  it("auto routeのendpointをScene intermediate waypointへ混ぜない", async () => {
    const document = documentFor({});
    const projected = projectSemanticView(document, standardRdfRdfsCatalog);
    const scene = await layoutProjectedDiagramScene(
      projected,
      STANDARD_LAYOUT_REFS.hierarchicalLr,
      createStandardLayoutRegistry(),
    );

    expect(scene.diagnostics).toEqual([]);
    expect(scene.edges[0]?.waypoints).toHaveLength(2);
    expect(scene.nodes.every((node) => node.geometry.width > 0)).toBe(true);
  });

  it("manual overlay routeをlayoutで置換せずrendererへ渡す", async () => {
    const projected = projectSemanticView(documentFor({
      edge: {
        semanticRef: statementIdentity("urn:test:scene:a", "urn:test:scene:p", "urn:test:scene:b"),
        routing: { waypoints: [{ x: 321, y: 123 }] },
      },
    }), standardRdfRdfsCatalog);
    const scene = await layoutProjectedDiagramScene(
      projected,
      STANDARD_LAYOUT_REFS.hierarchicalLr,
      createStandardLayoutRegistry(),
    );

    expect(scene.edges[0]?.waypoints).toEqual([{ x: 321, y: 123 }]);
  });

  it("profileとlayoutRefをruntime contextからview単位で解決する", async () => {
    const context: ProjectionRuntimeContext = {
      catalogsByProfile: new Map([[
        standardRdfRdfsCatalog.profileRef,
        { catalog: standardRdfRdfsCatalog },
      ]]),
      layouts: new LayoutAdapterRegistry([
        new StandardLightweightLayoutAdapter(STANDARD_LAYOUT_REFS.hierarchicalLr, "LR"),
      ]),
    };
    const scene = await buildIriographView(documentFor({}), "main", context);
    expect(scene.nodes).toHaveLength(2);
    expect(scene.diagnostics).toEqual([]);
  });
});

function documentFor(
  overlay: IriographDocumentV1["views"][number]["overlay"],
): IriographDocumentV1 {
  return {
    schemaVersion: "1",
    kind: "iriograph.document",
    documentId: "scene-test",
    semantic: {
      format: "text/turtle",
      baseIri: "urn:test:scene:",
      authoringProfileRef: "urn:test:authoring:1",
      source: `
        @prefix : <urn:test:scene:> .
        @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
        :a rdfs:label "A" ; :p :b .
        :b rdfs:label "B" .
      `,
    },
    views: [{
      viewId: "main",
      kind: "node-link",
      profileRef: standardRdfRdfsCatalog.profileRef,
      layoutRef: STANDARD_LAYOUT_REFS.hierarchicalLr,
      overlay,
    }],
  };
}
