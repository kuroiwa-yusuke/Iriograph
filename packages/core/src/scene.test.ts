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
  it("auto routeをendpoint込みのderived Scene routeとして渡す", async () => {
    const document = documentFor({});
    const projected = projectSemanticView(document, standardRdfRdfsCatalog);
    const scene = await layoutProjectedDiagramScene(
      projected,
      STANDARD_LAYOUT_REFS.hierarchicalLr,
      createStandardLayoutRegistry(),
    );

    expect(scene.diagnostics).toEqual([]);
    expect(scene.edges[0]!.route!.length).toBeGreaterThanOrEqual(4);
    expect(scene.edges[0]?.waypoints).toBeUndefined();
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
    expect(scene.edges[0]?.route).toHaveLength(3);
    expect(scene.edges[0]?.route?.[1]).toEqual({ x: 321, y: 123 });
  });

  it("empty waypointをauto routeへ正規化しlabel offsetを独立して渡す", async () => {
    const projected = projectSemanticView(documentFor({
      edge: {
        semanticRef: statementIdentity("urn:test:scene:a", "urn:test:scene:p", "urn:test:scene:b"),
        routing: { waypoints: [], labelOffset: { x: 7, y: -9 } },
      },
    }), standardRdfRdfsCatalog);

    expect(projected.edges[0]).toMatchObject({
      routingPlacement: "generated",
      labelOffset: { x: 7, y: -9 },
    });
    expect(projected.edges[0]?.waypoints).toBeUndefined();

    const scene = await layoutProjectedDiagramScene(
      projected,
      STANDARD_LAYOUT_REFS.hierarchicalLr,
      createStandardLayoutRegistry(),
    );
    expect(scene.edges[0]!.route!.length).toBeGreaterThanOrEqual(4);
    expect(scene.edges[0]?.waypoints).toBeUndefined();
    expect(scene.edges[0]?.labelOffset).toEqual({ x: 7, y: -9 });
  });

  it("endpoint anchorをprojectionとlayout経由でSceneへ渡す", async () => {
    const projected = projectSemanticView(documentFor({
      edge: {
        semanticRef: statementIdentity("urn:test:scene:a", "urn:test:scene:p", "urn:test:scene:b"),
        appearance: { edgeCaption: "図だけの注記" },
        routing: {
          sourceAnchor: { position: 0 },
          targetAnchor: { position: .5 },
        },
      },
    }), standardRdfRdfsCatalog);

    expect(projected.edges[0]).toMatchObject({
      sourceAnchor: { position: 0 },
      targetAnchor: { position: .5 },
      caption: "図だけの注記",
      routingPlacement: "generated",
    });

    const scene = await layoutProjectedDiagramScene(
      projected,
      STANDARD_LAYOUT_REFS.hierarchicalLr,
      createStandardLayoutRegistry(),
    );
    const edge = scene.edges[0]!;
    const source = scene.nodes.find((node) => node.elementId === edge.sourceElementId)!;
    const target = scene.nodes.find((node) => node.elementId === edge.targetElementId)!;
    expect(edge.sourceAnchor).toEqual({ position: 0 });
    expect(edge.targetAnchor).toEqual({ position: .5 });
    expect(edge.caption).toBe("図だけの注記");
    expect(edge.route?.[0]).toEqual({
      x: source.geometry.x + source.geometry.width / 2,
      y: source.geometry.y,
    });
    expect(edge.route?.at(-1)).toEqual({
      x: target.geometry.x + target.geometry.width / 2,
      y: target.geometry.y + target.geometry.height,
    });
  });

  it("node内label/icon offsetを意味グラフと独立したappearanceとしてSceneへ渡す", async () => {
    const document = documentFor({
      a: {
        semanticRef: "urn:test:scene:a",
        appearance: {
          nodeLabelOffset: { x: 14, y: -6 },
          nodeIconOffset: { x: -12, y: 8 },
        },
      },
    });
    const scene = await layoutProjectedDiagramScene(
      projectSemanticView(document, standardRdfRdfsCatalog),
      STANDARD_LAYOUT_REFS.hierarchicalLr,
      createStandardLayoutRegistry(),
    );
    expect(scene.nodes.find((node) => node.semanticRef === "urn:test:scene:a")).toMatchObject({
      nodeLabelOffset: { x: 14, y: -6 },
      nodeIconOffset: { x: -12, y: 8 },
    });
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

  it("非表示時もcomment callout全体の表示領域をlayout boundsへ予約する", async () => {
    const document = documentFor({});
    document.semantic.source = `
      @prefix : <urn:test:scene:> .
      @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
      :a rdfs:label "A" ;
        rdfs:comment "一行目\\n二行目。さらに長い説明を折り返して常に予約します。"@ja ;
        :p :b .
      :b rdfs:label "B" .
    `;
    const scene = await layoutProjectedDiagramScene(
      projectSemanticView(document, standardRdfRdfsCatalog),
      STANDARD_LAYOUT_REFS.hierarchicalLr,
      createStandardLayoutRegistry(),
    );
    const commented = scene.nodes.find((node) => node.semanticRef === "urn:test:scene:a")!;

    expect(commented.semanticText?.comments).toHaveLength(1);
    expect(scene.height).toBeGreaterThan(commented.geometry.y + commented.geometry.height + 100);
  });

  it("direct edgeへ個別statement commentを渡し、named/blank reifierを通常要素に投影しない", async () => {
    const document = documentFor({});
    document.semantic.source = `
      @prefix : <urn:test:scene:> .
      @prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
      @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
      :a rdfs:label "A" ; :p :b .
      :b rdfs:label "B" .
      :edge-note a rdf:Statement ;
        rdf:subject :a ; rdf:predicate :p ; rdf:object :b ;
        rdfs:comment "個別の\\n日本語説明"@ja .
      [] a rdf:Statement ;
        rdf:subject :a ; rdf:predicate :p ; rdf:object :b ;
        rdfs:comment "English note"@en .
    `;

    const scene = await buildIriographView(document, "main", {
      catalogsByProfile: new Map([[
        standardRdfRdfsCatalog.profileRef,
        { catalog: standardRdfRdfsCatalog },
      ]]),
      layouts: createStandardLayoutRegistry(),
    });

    expect(scene.nodes.map((node) => node.semanticRef).sort()).toEqual([
      "urn:test:scene:a",
      "urn:test:scene:b",
    ]);
    expect(scene.edges).toHaveLength(1);
    expect(scene.edges[0]?.statementComments?.map((comment) => ({
      value: comment.value,
      language: comment.language,
    }))).toEqual([
      { value: "English note", language: "en" },
      { value: "個別の\n日本語説明", language: "ja" },
    ]);
    expect(scene.edges[0]?.semanticText?.comments).toEqual([]);
  });

  it("region viewで多対多membershipを重なり領域としてend-to-end投影する", async () => {
    const document = documentFor({});
    document.views[0]!.kind = "region";
    document.views[0]!.overlay["left-region"] = {
      semanticRef: "urn:test:scene:left",
      appearance: {
        regionLabelAnchor: .3,
        regionLabelWritingDirection: "vertical-down",
        regionZOrder: 7,
      },
    };
    document.semantic.source = `
      @prefix : <urn:test:scene:> .
      @prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
      @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
      :left a rdf:Bag ; rdfs:label "Left" ; rdfs:member :a, :shared .
      :right a rdf:Bag ; rdfs:label "Right" ; rdfs:member :shared, :b .
      :a rdfs:label "A" .
      :shared rdfs:label "Shared" .
      :b rdfs:label "B" .
    `;

    const scene = await buildIriographView(document, "main", {
      catalogsByProfile: new Map([[
        standardRdfRdfsCatalog.profileRef,
        { catalog: standardRdfRdfsCatalog },
      ]]),
      layouts: createStandardLayoutRegistry(),
    });

    expect(scene.regions).toHaveLength(2);
    expect(scene.regions?.find((region) => region.semanticRef.endsWith(":left"))).toMatchObject({
      regionLabelAnchor: .3,
      regionLabelWritingDirection: "vertical-down",
      regionZOrder: 7,
    });
    expect(scene.containers).toEqual([]);
    expect(scene.memberships).toHaveLength(4);
    expect(scene.memberships?.filter((entry) => (
      entry.memberElementId === scene.nodes.find((node) => node.semanticRef.endsWith(":shared"))?.elementId
    ))).toHaveLength(2);
    const shared = scene.nodes.find((node) => node.semanticRef.endsWith(":shared"))!;
    const containingRegions = scene.regions!.filter((region) => containsCenter(region.geometry, shared.geometry));
    expect(containingRegions).toHaveLength(2);
    expect(scene.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
  });
});

function containsCenter(
  outer: { x: number; y: number; width: number; height: number },
  inner: { x: number; y: number; width: number; height: number },
): boolean {
  const x = inner.x + inner.width / 2;
  const y = inner.y + inner.height / 2;
  return x >= outer.x && x <= outer.x + outer.width
    && y >= outer.y && y <= outer.y + outer.height;
}

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
