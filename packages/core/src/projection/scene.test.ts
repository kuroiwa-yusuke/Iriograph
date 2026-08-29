import { describe, expect, it } from "vitest";

import { statementIdentity } from "../semantic/identity";
import {
  createStandardLayoutRegistry,
  LayoutAdapterRegistry,
  STANDARD_LAYOUT_REFS,
  StandardLightweightLayoutAdapter,
  type LayoutAdapter,
} from "../layout/layout";
import type { IriographDocumentV1 } from "../document/model";
import { projectSemanticView } from "./projection";
import {
  buildIriographView,
  createProjectionRuntimeContext,
  layoutProjectedDiagramScene,
  type ProjectionRuntimeContext,
} from "./scene";
import { catalogRef, standardRdfRdfsCatalog } from "../catalog/standard-catalog";

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
    expect(scene.edges[0]!.route!.length).toBeGreaterThanOrEqual(2);
    expect(scene.edges[0]!.route!.length).toBeLessThanOrEqual(3);
    expect(scene.edges[0]!.derivedRouteChoice).toMatchObject({
      source: "auto",
      family: expect.stringMatching(/^(straight|curve|polyline)$/),
    });
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
    expect(scene.edges[0]!.route!.length).toBeGreaterThanOrEqual(2);
    expect(scene.edges[0]!.route!.length).toBeLessThanOrEqual(3);
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

  it("curve controlsをTurtleとlayout routeから独立したsparse Scene routingとして渡す", async () => {
    const extensionIri = "https://example.test/curve-point-meta";
    const semanticRef = statementIdentity(
      "urn:test:scene:a",
      "urn:test:scene:p",
      "urn:test:scene:b",
    );
    const document = documentFor({
      edge: {
        semanticRef,
        routing: {
          routeMode: "curve",
          curve: {
            sourceHandle: {
              x: 42,
              y: -12,
              extensions: { [extensionIri]: { tags: ["source"] } },
            },
            targetHandle: { x: -36, y: 16 },
            knots: [{
              point: {
                x: 260,
                y: 140,
                extensions: { [extensionIri]: { tags: ["knot"] } },
              },
              incomingHandle: { x: -24, y: 8 },
              outgoingHandle: { x: 30, y: -10 },
            }],
          },
        },
      },
    });
    const semanticSource = document.semantic.source;
    const projected = projectSemanticView(document, standardRdfRdfsCatalog);
    expect(projected.edges[0]).toMatchObject({
      routeMode: "curve",
      routingPlacement: "generated",
      curve: document.views[0]!.overlay.edge!.routing!.curve,
    });

    const scene = await layoutProjectedDiagramScene(
      projected,
      STANDARD_LAYOUT_REFS.hierarchicalLr,
      createStandardLayoutRegistry(),
    );
    expect(scene.edges[0]?.curve).toEqual(document.views[0]!.overlay.edge!.routing!.curve);
    expect(scene.edges[0]?.derivedRouteChoice).toMatchObject({
      family: "curve",
      source: "explicit",
      reason: "explicit-route-mode",
    });
    expect(document.views[0]!.overlay.edge).not.toHaveProperty("derivedRouteChoice");
    expect(scene.edges[0]?.curve?.sourceHandle?.extensions).not.toBe(
      document.views[0]!.overlay.edge!.routing!.curve?.sourceHandle?.extensions,
    );
    expect(scene.edges[0]?.curve?.knots?.[0]?.point.extensions).not.toBe(
      document.views[0]!.overlay.edge!.routing!.curve?.knots?.[0]?.point.extensions,
    );
    expect(scene.edges[0]?.waypoints).toBeUndefined();
    expect(document.semantic.source).toBe(semanticSource);
  });

  it("node内label/icon offsetと文字方向を意味グラフと独立したappearanceとしてSceneへ渡す", async () => {
    const document = documentFor({
      a: {
        semanticRef: "urn:test:scene:a",
        appearance: {
          nodeLabelOffset: { x: 14, y: -6 },
          nodeLabelWritingDirection: "vertical-down",
          nodeIconOffset: { x: -12, y: 8 },
          nodeIconScale: 1.5,
          nodeIconFit: "cover",
          style: { labelFontSize: 21 },
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
      nodeLabelWritingDirection: "vertical-down",
      nodeIconOffset: { x: -12, y: 8 },
      nodeIconScale: 1.5,
      nodeIconFit: "cover",
      style: { labelFontSize: 21 },
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

  it("同一runtimeのreconciliation cacheがあっても通常buildは新しいdocumentを再投影する", async () => {
    let layouts = 0;
    const standard = new StandardLightweightLayoutAdapter(STANDARD_LAYOUT_REFS.hierarchicalLr, "LR");
    const adapter: LayoutAdapter = {
      layoutRef: standard.layoutRef,
      async layout(request) {
        layouts += 1;
        return standard.layout(request);
      },
    };
    const context: ProjectionRuntimeContext = {
      catalogsByProfile: new Map([[
        standardRdfRdfsCatalog.profileRef,
        { catalog: standardRdfRdfsCatalog },
      ]]),
      layouts: new LayoutAdapterRegistry([adapter]),
    };
    const first = documentFor({});
    const second = structuredClone(first);
    second.semantic.source = second.semantic.source.replace('rdfs:label "A"', 'rdfs:label "Renamed"');

    await buildIriographView(first, "main", context, "incremental");
    const rebuilt = await buildIriographView(second, "main", context, "incremental");

    expect(layouts).toBe(2);
    expect(rebuilt.nodes.find((node) => node.semanticRef === "urn:test:scene:a")?.label).toBe("Renamed");
  });

  it("宣言catalogとhost解決catalogが違う場合に既定表示へfallbackしない", async () => {
    const document = documentFor({});
    document.imports = [{ catalogRef: "urn:iriograph:catalog:other-presentation@1" }];
    const context = createProjectionRuntimeContext([{
      profileRef: standardRdfRdfsCatalog.profileRef,
      sourceCatalogRefs: [catalogRef(standardRdfRdfsCatalog)],
      catalog: standardRdfRdfsCatalog,
      ruleOrigins: [],
    }], createStandardLayoutRegistry());

    const scene = await buildIriographView(document, "main", context);

    expect(scene.nodes).toEqual([]);
    expect(scene.diagnostics).toContainEqual(expect.objectContaining({
      severity: "error",
      code: "catalog-import-context-mismatch",
      message: expect.stringContaining("urn:iriograph:catalog:other-presentation@1"),
    }));
  });

  it("sparse font/icon content metricsをlayout minimumへ渡してnodeをautogrowする", async () => {
    const document = documentFor({
      a: {
        semanticRef: "urn:test:scene:a",
        appearance: { style: { labelFontSize: 72 } },
      },
    });
    document.semantic.source = `
      @prefix : <urn:test:scene:> .
      @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
      :a rdfs:label "非常に長い業務ラベルを安全に折り返して全体表示する" ; :p :b .
      :b rdfs:label "B" .
    `;
    const scene = await layoutProjectedDiagramScene(
      projectSemanticView(document, standardRdfRdfsCatalog),
      STANDARD_LAYOUT_REFS.hierarchicalLr,
      createStandardLayoutRegistry(),
    );
    const node = scene.nodes.find((candidate) => candidate.semanticRef === "urn:test:scene:a")!;
    expect(node.style.labelFontSize).toBe(72);
    expect(node.geometry.width).toBeGreaterThan(164);
    expect(node.geometry.height).toBeGreaterThan(72);
    expect(document.views[0]!.overlay.a!.appearance!.style).toEqual({ labelFontSize: 72 });
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
        groupLabelAnchor: .3,
        groupLabelOffset: .6,
        groupLabelWritingDirection: "vertical-down",
        groupIconOffset: { x: 7, y: -2 },
        groupIconScale: 1.4,
        iconRef: "urn:test:group-icon",
        groupZOrder: 7,
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
      groupFrame: { kind: "membership" },
      groupLabelAnchor: .3,
      groupLabelOffset: .6,
      groupLabelWritingDirection: "vertical-down",
      groupIconOffset: { x: 7, y: -2 },
      groupIconScale: 1.4,
      iconRef: "urn:test:group-icon",
      groupZOrder: 7,
      regionLabelAnchor: .3,
      regionLabelWritingDirection: "vertical-down",
      regionZOrder: 7,
      style: { labelFontSize: 21 },
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

  it("Altをadapter非依存でmemberを囲うframeへ完成しguideをsemantic edgeにしない", async () => {
    const document = documentFor({});
    document.semantic.source = `
      @prefix : <urn:test:scene:> .
      @prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
      @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
      :choice a rdf:Alt ; rdfs:label "選択" ; rdf:_1 :a ; rdf:_2 :b .
      :a rdfs:label "A" .
      :b rdfs:label "B" .
    `;
    const scene = await layoutProjectedDiagramScene(
      projectSemanticView(document, standardRdfRdfsCatalog),
      STANDARD_LAYOUT_REFS.hierarchicalLr,
      createStandardLayoutRegistry(),
    );
    const frame = scene.containers.find((container) => container.semanticRef.endsWith(":choice"))!;
    const members = scene.nodes.filter((node) => node.parentElementId === frame.elementId);
    expect(frame.groupFrame).toMatchObject({ kind: "alternative" });
    expect(members).toHaveLength(2);
    for (const member of members) {
      expect(member.geometry.x).toBeGreaterThanOrEqual(frame.geometry.x);
      expect(member.geometry.y).toBeGreaterThanOrEqual(frame.geometry.y);
      expect(member.geometry.x + member.geometry.width)
        .toBeLessThanOrEqual(frame.geometry.x + frame.geometry.width);
      expect(member.geometry.y + member.geometry.height)
        .toBeLessThanOrEqual(frame.geometry.y + frame.geometry.height);
    }
    expect(scene.groupGuides?.filter((guide) => guide.kind === "alternative-candidate"))
      .toHaveLength(2);
    expect(scene.edges).toEqual([]);
  });

  it("Bag Group Frame kindをScene境界から外部adapter後処理へ渡す", async () => {
    const document = documentFor({});
    document.semantic.source = `
      @prefix : <urn:test:scene:> .
      @prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
      @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
      :bag a rdf:Bag ; rdfs:label "Bag" ; rdfs:member :member .
      :member rdfs:label "Member" .
    `;
    const projected = projectSemanticView(document, standardRdfRdfsCatalog);
    const frame = projected.containers.find((container) => container.groupRole === "membership")!;
    const member = projected.nodes.find((node) => node.semanticRef.endsWith(":member"))!;
    const layoutRef = "urn:test:scene:external-bag-layout";
    let observedGroupRole: string | undefined;
    const adapter: LayoutAdapter = {
      layoutRef,
      async layout(request) {
        observedGroupRole = request.scene.elements.find((element) => (
          element.elementId === frame.elementId
        ))?.groupRole;
        return {
          layoutRef,
          structuralCompletion: true,
          geometries: Object.fromEntries(request.scene.elements.map((element) => [
            element.elementId,
            element.elementId === member.elementId
              ? { x: 500, y: 300, width: 120, height: 60 }
              : { x: 0, y: 0, width: 80, height: 50 },
          ])),
          routes: {},
          width: 620,
          height: 360,
          diagnostics: [],
        };
      },
    };
    const scene = await layoutProjectedDiagramScene(
      projected,
      layoutRef,
      new LayoutAdapterRegistry([adapter]),
    );
    const sceneFrame = scene.containers.find((container) => container.elementId === frame.elementId)!;
    const sceneMember = scene.nodes.find((node) => node.elementId === member.elementId)!;

    expect(observedGroupRole).toBe("membership");
    expect(isInside(sceneMember.geometry, sceneFrame.geometry)).toBe(true);
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

function isInside(
  child: { x: number; y: number; width: number; height: number },
  parent: { x: number; y: number; width: number; height: number },
): boolean {
  return child.x >= parent.x
    && child.y >= parent.y
    && child.x + child.width <= parent.x + parent.width
    && child.y + child.height <= parent.y + parent.height;
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
