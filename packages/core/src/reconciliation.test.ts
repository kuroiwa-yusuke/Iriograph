import { describe, expect, it } from "vitest";

import { applySemanticSource } from "./document";
import {
  sequenceTransitionIdentity,
  statementIdentity,
} from "./identity";
import {
  createStandardLayoutRegistry,
  LayoutAdapterRegistry,
  STANDARD_LAYOUT_REFS,
  StandardLightweightLayoutAdapter,
  type LayoutAdapter,
  type LayoutRequest,
  type StandardLayoutPerformanceSample,
} from "./layout";
import type { IriographDocument, IriographDocumentV1 } from "./model";
import { buildIriographView, type ProjectionRuntimeContext } from "./scene";
import {
  reconcileIriographDocumentViews,
  type DisplayReconciliationEvent,
} from "./reconciliation";
import { standardRdfRdfsCatalog } from "./standard-catalog";

const NS = "urn:test:reconcile:";
const directEdgeRef = statementIdentity(`${NS}a`, `${NS}rel`, `${NS}b`);
const oldSequenceRef = sequenceTransitionIdentity(`${NS}flow`, 1, 2);

describe("display reconciliation", () => {
  it("全viewでadd/delete/type/containment/sequence変更をatomicにreconcileする", async () => {
    const previous = documentFor(oldSource);
    const result = await applySemanticSource(previous, newSource, runtimeContext());

    expect(result.accepted).toBe(true);
    expect(result.document.semantic.source).toBe(newSource);
    expect(result.document.views).toHaveLength(2);

    const main = result.document.views.find((view) => view.viewId === "main")!;
    const alternate = result.document.views.find((view) => view.viewId === "alternate")!;
    const mainA = overlayFor(main.overlay, `${NS}a`);
    const alternateA = overlayFor(alternate.overlay, `${NS}a`);
    expect(mainA).toMatchObject({
      geometry: { x: 10, y: 20, width: 164, height: 72 },
      pinned: true,
      placement: "user",
    });
    expect(alternateA).toMatchObject({
      geometry: { x: 410, y: 220, width: 164, height: 72 },
      pinned: true,
      placement: "user",
    });
    expect(mainA?.appearance).toEqual({ iconRef: "urn:test:asset:a" });

    expect(overlayFor(main.overlay, `${NS}d`)).toMatchObject({
      geometry: expect.any(Object),
      pinned: false,
      placement: "generated",
    });
    expect(overlayFor(alternate.overlay, `${NS}d`)).toMatchObject({
      geometry: expect.any(Object),
      placement: "generated",
    });
    expect(overlayFor(main.overlay, `${NS}c`)).toBeUndefined();
    expect(overlayFor(main.overlay, oldSequenceRef)).toBeUndefined();
    expect(overlayFor(main.overlay, directEdgeRef)).toMatchObject({
      semanticRef: directEdgeRef,
      routing: { waypoints: [{ x: 300, y: 90 }] },
      appearance: { templateRef: "urn:iriograph:template:edge:reference:1" },
    });
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: "reconcile-primitive-changed",
      semanticRef: `${NS}a`,
    }));
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: "reconcile-stale-overlay-removed",
      semanticRef: `${NS}c`,
    }));
  });

  it("nested Groupへのmembership追加で料金だけを局所配置し既存user overlayを維持する", async () => {
    const previousSource = `
@prefix : <${NS}> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
:pizza-shop a rdf:Bag ; rdfs:label "ピザ店" ; rdfs:member :staff .
:staff a rdf:Bag ; rdfs:label "店員" ; rdfs:member :clerk, :cook, :delivery .
:clerk rdfs:label "店員" .
:cook rdfs:label "調理担当" .
:delivery rdfs:label "配達担当" .
:price rdfs:label "料金" .
`;
    const candidateSource = previousSource.replace(
      "rdfs:member :staff .",
      "rdfs:member :staff, :price .",
    );
    const outer = { x: 100, y: 100, width: 900, height: 720 };
    const inner = { x: 140, y: 170, width: 500, height: 360 };
    const clerk = { x: 180, y: 250, width: 164, height: 72 };
    const cook = { x: 390, y: 250, width: 164, height: 72 };
    const delivery = { x: 180, y: 370, width: 164, height: 72 };
    const price = { x: 1_200, y: 220, width: 164, height: 72 };
    const previous = localizedDocumentFor(previousSource);
    previous.views = [previous.views[0]!];
    previous.views[0]!.kind = "region";
    previous.views[0]!.overlay = {
      shop: { semanticRef: `${NS}pizza-shop`, geometry: outer, placement: "user" },
      staff: { semanticRef: `${NS}staff`, geometry: inner, placement: "user" },
      clerk: { semanticRef: `${NS}clerk`, geometry: clerk, placement: "user" },
      cook: { semanticRef: `${NS}cook`, geometry: cook, placement: "user" },
      delivery: { semanticRef: `${NS}delivery`, geometry: delivery, placement: "user" },
      price: { semanticRef: `${NS}price`, geometry: price, placement: "user" },
    };
    const candidate = structuredClone(previous);
    candidate.semantic.source = candidateSource;

    const result = await reconcileIriographDocumentViews(previous, candidate, runtimeContext());

    expect(result.accepted).toBe(true);
    const view = result.document.views[0]!;
    expect(overlayFor(view.overlay, `${NS}pizza-shop`)?.geometry).toEqual(outer);
    expect(overlayFor(view.overlay, `${NS}staff`)?.geometry).toEqual(inner);
    expect(overlayFor(view.overlay, `${NS}clerk`)?.geometry).toEqual(clerk);
    expect(overlayFor(view.overlay, `${NS}cook`)?.geometry).toEqual(cook);
    expect(overlayFor(view.overlay, `${NS}delivery`)?.geometry).toEqual(delivery);
    const movedPrice = overlayFor(view.overlay, `${NS}price`)!;
    expect(movedPrice.geometry).not.toEqual(price);
    expect(movedPrice.placement).toBe("user");
    expect(isInside(movedPrice.geometry!, outer)).toBe(true);
    expect(overlaps(movedPrice.geometry!, inner)).toBe(false);
    const scene = result.scenes.main!;
    const outerElement = scene.regions!.find((element) => element.semanticRef === `${NS}pizza-shop`)!;
    const innerElement = scene.regions!.find((element) => element.semanticRef === `${NS}staff`)!;
    expect(scene.memberships).toEqual(expect.arrayContaining([
      expect.objectContaining({
        containerElementId: outerElement.elementId,
        memberElementId: innerElement.elementId,
      }),
    ]));
    expect(isInside(innerElement.geometry, outerElement.geometry)).toBe(true);
    expect(result.diagnostics.some((item) => item.code.includes("intersection-empty"))).toBe(false);
  });

  it("一つのviewでもlayoutを解決できなければ全documentをrollbackする", async () => {
    const previous = documentFor(oldSource);
    const context = runtimeContext(new LayoutAdapterRegistry([
      new StandardLightweightLayoutAdapter(STANDARD_LAYOUT_REFS.hierarchicalLr, "LR"),
    ]));
    const result = await applySemanticSource(previous, newSource, context);

    expect(result.accepted).toBe(false);
    expect(result.document).toEqual(previous);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      severity: "error",
      code: "layout-adapter-unresolved",
    }));
  });

  it("edge-only要求のfull fallback理由をdiagnosticとobserverへ残す", async () => {
    const previous = documentFor(oldSource);
    const candidate = structuredClone(previous);
    candidate.semantic.source = newSource;
    const events: DisplayReconciliationEvent[] = [];

    const result = await reconcileIriographDocumentViews(
      previous,
      candidate,
      runtimeContext(),
      { mode: "edge-only", observer: (event) => { events.push(event); } },
    );

    expect(result.accepted).toBe(true);
    expect(result.diagnostics.filter((item) => item.code === "reconcile-edge-only-fallback"))
      .toHaveLength(previous.views.length);
    expect(events).toEqual(previous.views.map(() => ({
      actualMode: "incremental",
      fallbackReason: "visible-structure-changed",
      requestedMode: "edge-only",
      viewId: expect.any(String),
    })));
  });

  it("direct sourceのsubPropertyOf-only deltaを自動route-onlyにし既存geometryを維持する", async () => {
    const beforeSource = `
@prefix : <${NS}> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
:p a rdf:Property ; rdfs:label "P" .
:q a rdf:Property ; rdfs:label "Q" .
:a rdfs:label "A" ; :p :b .
:b rdfs:label "B" .
`;
    const afterSource = `${beforeSource}\n:p rdfs:subPropertyOf :q .\n`;
    const requests: LayoutRequest[] = [];
    const samples: StandardLayoutPerformanceSample[] = [];
    const context = localizedRuntimeContext(requests, samples);
    const initial = await applySemanticSource(
      localizedDocumentFor(beforeSource),
      beforeSource,
      context,
    );
    expect(initial.accepted).toBe(true);
    const beforeGeometry = geometryBySemantic(initial.document);
    requests.length = 0;

    const updated = await applySemanticSource(initial.document, afterSource, context);

    expect(updated.accepted).toBe(true);
    expect(requests.filter((request) => request.mode === "route-only"))
      .toHaveLength(initial.document.views.length);
    for (const [viewId, geometry] of Object.entries(beforeGeometry)) {
      expect(geometryBySemantic(updated.document)[viewId]).toMatchObject(geometry);
    }
  });

  it.each([
    {
      name: "relation追加とparallel/self-loop",
      source: localizedAddSource,
      expectedAffected: 1,
      expectedFixed: 5,
    },
    {
      name: "predicate変更",
      source: localizedPredicateSource,
      expectedAffected: 1,
      expectedFixed: 4,
    },
    {
      name: "endpoint変更",
      source: localizedEndpointSource,
      expectedAffected: 1,
      expectedFixed: 4,
    },
  ])("$nameを各viewの変更routeだけへ局所化する", async ({
    source,
    expectedAffected,
    expectedFixed,
  }) => {
    const previous = localizedDocumentFor(localizedOldSource);
    const candidate = structuredClone(previous);
    candidate.semantic.source = source;
    const requests: LayoutRequest[] = [];
    const samples: StandardLayoutPerformanceSample[] = [];
    const context = localizedRuntimeContext(requests, samples);
    const before = Object.fromEntries(await Promise.all(previous.views.map(async (view) => [
      view.viewId,
      await buildIriographView(previous, view.viewId, context),
    ] as const)));
    requests.length = 0;
    samples.length = 0;
    const events: DisplayReconciliationEvent[] = [];

    const result = await reconcileIriographDocumentViews(previous, candidate, context, {
      mode: "edge-only",
      observer: (event) => { events.push(event); },
    });

    expect(result.accepted).toBe(true);
    expect(events).toEqual(previous.views.map((view) => ({
      actualMode: "route-only",
      affectedEdges: expectedAffected,
      fixedDerivedRoutes: expectedFixed,
      requestedMode: "edge-only",
      viewId: view.viewId,
    })));
    const routeOnlyRequests = requests.filter((request) => request.mode === "route-only");
    expect(routeOnlyRequests).toHaveLength(previous.views.length);
    expect(requests.filter((request) => request.mode === "incremental")).toHaveLength(0);
    expect(routeOnlyRequests.map((request) => Object.keys(request.fixedDerivedRoutes ?? {}).length))
      .toEqual(previous.views.map(() => expectedFixed));
    expect(samples.filter((sample) => sample.mode === "route-only").map((sample) => ({
      fixed: sample.fixedDerivedRoutes,
      routed: sample.routedEdges,
    }))).toEqual(previous.views.map(() => ({ fixed: expectedFixed, routed: expectedAffected })));

    for (const view of previous.views) {
      const previousRoutes = new Map(before[view.viewId]!.edges.map((edge) => [edge.elementId, edge.route]));
      const previousChoices = new Map(before[view.viewId]!.edges.map((edge) => [
        edge.elementId,
        edge.derivedRouteChoice,
      ]));
      const request = routeOnlyRequests.find((entry) => entry.layoutRef === view.layoutRef)!;
      for (const edgeId of Object.keys(request.fixedDerivedRoutes ?? {})) {
        expect(JSON.stringify(
          result.scenes[view.viewId]!.edges.find((edge) => edge.elementId === edgeId)?.route,
        )).toBe(JSON.stringify(previousRoutes.get(edgeId)));
        const previousChoice = previousChoices.get(edgeId)!;
        if (previousChoice) {
          expect(request.fixedDerivedRouteChoices?.[edgeId]).toEqual({
            ...previousChoice,
            source: "fixed",
            reason: "fixed-derived-route",
          });
          expect(
            result.scenes[view.viewId]!.edges.find((edge) => edge.elementId === edgeId)?.derivedRouteChoice,
          ).toEqual(request.fixedDerivedRouteChoices?.[edgeId]);
        }
      }
    }
  });

  it("edge-only変更は無関係な配置警告を引き継がず対象edgeの同一警告を一度だけ返す", async () => {
    const previous = localizedDocumentFor(localizedOldSource);
    const candidate = structuredClone(previous);
    candidate.semantic.source = localizedEndpointSource;
    const layouts = new LayoutAdapterRegistry([
      noisyLayoutAdapter(STANDARD_LAYOUT_REFS.hierarchicalLr, "LR"),
      noisyLayoutAdapter(STANDARD_LAYOUT_REFS.hierarchicalTb, "TB"),
    ]);

    const result = await reconcileIriographDocumentViews(
      previous,
      candidate,
      runtimeContext(layouts),
      { mode: "edge-only" },
    );

    expect(result.accepted).toBe(true);
    expect(result.diagnostics.some((item) => item.code === "test-unrelated-placement"))
      .toBe(false);
    const affected = result.diagnostics.filter((item) => item.code === "test-affected-route");
    expect(affected).toHaveLength(1);
    expect(affected[0]?.semanticRef).toBeTruthy();
    for (const scene of Object.values(result.scenes)) {
      expect(scene.diagnostics.some((item) => item.code === "test-unrelated-placement")).toBe(false);
      expect(scene.diagnostics.filter((item) => item.code === "test-affected-route")).toHaveLength(1);
    }
  });

  it("dense graphでもunaffected routeをexact維持しreroute数をobserverへ限定する", async () => {
    const previous = localizedDocumentFor(denseSource(false));
    const candidate = structuredClone(previous);
    candidate.semantic.source = denseSource(true);
    const requests: LayoutRequest[] = [];
    const samples: StandardLayoutPerformanceSample[] = [];
    const context = localizedRuntimeContext(requests, samples);
    const before = await buildIriographView(previous, "main", context);
    requests.length = 0;
    samples.length = 0;
    const events: DisplayReconciliationEvent[] = [];

    const result = await reconcileIriographDocumentViews(previous, candidate, context, {
      mode: "edge-only",
      observer: (event) => { events.push(event); },
    });

    expect(result.accepted).toBe(true);
    const mainRequest = requests.find((request) => (
      request.mode === "route-only" && request.layoutRef === STANDARD_LAYOUT_REFS.hierarchicalLr
    ))!;
    const fixedIds = Object.keys(mainRequest.fixedDerivedRoutes ?? {});
    expect(fixedIds.length).toBeGreaterThan(20);
    expect(events.find((event) => event.viewId === "main")).toMatchObject({
      affectedEdges: 1,
      fixedDerivedRoutes: fixedIds.length,
    });
    expect(samples.find((sample) => sample.mode === "route-only" && sample.layoutRef === STANDARD_LAYOUT_REFS.hierarchicalLr))
      .toMatchObject({ routedEdges: 1, fixedDerivedRoutes: fixedIds.length });
    const previousRoutes = new Map(before.edges.map((edge) => [edge.elementId, edge.route]));
    for (const edgeId of fixedIds) {
      expect(JSON.stringify(
        result.scenes.main!.edges.find((edge) => edge.elementId === edgeId)?.route,
      )).toBe(JSON.stringify(previousRoutes.get(edgeId)));
    }
  });

  it("Bagでないsubjectのrdfs:memberを全rollbackする", async () => {
    const previous = documentFor(oldSource);
    const invalid = `${oldSource}\n:a rdfs:member :b .`;
    const result = await applySemanticSource(previous, invalid, runtimeContext());

    expect(result.accepted).toBe(false);
    expect(result.document).toEqual(previous);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      severity: "error",
      code: "membership-parent-invalid",
      semanticRef: `${NS}a`,
    }));
  });

  it("empty waypointをautomatic routingへ正規化してlabel offsetだけを保持する", async () => {
    const previous = documentFor(oldSource);
    for (const view of previous.views) {
      const edge = overlayFor(view.overlay, directEdgeRef)!;
      edge.routing = { waypoints: [], labelOffset: { x: 9, y: -5 } };
    }

    const result = await applySemanticSource(previous, oldSource, runtimeContext());

    expect(result.accepted).toBe(true);
    expect(overlayFor(result.document.views[0]!.overlay, directEdgeRef)?.routing).toEqual({
      labelOffset: { x: 9, y: -5 },
    });
  });

  it("anchorだけのsparse routing overlayを保持する", async () => {
    const previous = documentFor(oldSource);
    for (const view of previous.views) {
      const edge = overlayFor(view.overlay, directEdgeRef)!;
      edge.routing = { sourceAnchor: { position: 0 }, targetAnchor: { position: .75 } };
    }

    const result = await applySemanticSource(previous, oldSource, runtimeContext());

    expect(result.accepted).toBe(true);
    expect(overlayFor(result.document.views[0]!.overlay, directEdgeRef)?.routing).toEqual({
      sourceAnchor: { position: 0 },
      targetAnchor: { position: .75 },
    });
  });

  it("Seq member変更時はgroup identityとappearanceを保持する", async () => {
    const previous = documentFor(sequenceEndpointOldSource);
    for (const view of previous.views) {
      view.overlay = {
        sequence: {
          semanticRef: `${NS}flow`,
          appearance: {
            templateRef: "urn:iriograph:template:container:sequence:1",
            groupLabelAnchor: .4,
            groupLabelOffset: .5,
            groupLabelWritingDirection: "vertical-down",
            groupIconOffset: { x: 4, y: -2 },
            groupIconScale: 1.25,
            iconRef: "urn:test:group-icon",
            groupZOrder: 2,
          },
        },
      };
    }

    const result = await applySemanticSource(
      previous,
      sequenceEndpointNewSource,
      runtimeContext(),
    );

    expect(result.accepted).toBe(true);
    const reconciled = overlayFor(result.document.views[0]!.overlay, `${NS}flow`);
    expect(reconciled?.appearance).toEqual({
      templateRef: "urn:iriograph:template:container:sequence:1",
      groupLabelAnchor: .4,
      groupLabelOffset: .5,
      groupLabelWritingDirection: "vertical-down",
      groupIconOffset: { x: 4, y: -2 },
      groupIconScale: 1.25,
      iconRef: "urn:test:group-icon",
      groupZOrder: 2,
    });
    expect(result.diagnostics.some((diagnostic) => (
      diagnostic.code === "reconcile-edge-endpoints-changed"
    ))).toBe(false);
  });

  it("group frame専用presentationをnodeとedgeから除去する", async () => {
    const previous = documentFor(oldSource);
    for (const view of previous.views) {
      view.overlay.nodeWithGroupPresentation = {
        semanticRef: `${NS}b`,
        appearance: {
          groupLabelOffset: .5,
          groupIconOffset: { x: 4, y: -2 },
          groupIconScale: 1.25,
        },
      };
      const edge = overlayFor(view.overlay, directEdgeRef)!;
      edge.appearance = {
        ...edge.appearance,
        groupLabelOffset: -.5,
        groupIconOffset: { x: -3, y: 1 },
        groupIconScale: .75,
      };
    }

    const result = await applySemanticSource(previous, oldSource, runtimeContext());

    expect(result.accepted).toBe(true);
    for (const view of result.document.views) {
      expect(overlayFor(view.overlay, `${NS}b`)?.appearance).toBeUndefined();
      expect(overlayFor(view.overlay, directEdgeRef)?.appearance).toEqual({
        templateRef: "urn:iriograph:template:edge:reference:1",
      });
    }
  });

  it("legacy styleTokenをcatalog styleRefへ移行しsparse overrideを維持する", async () => {
    const previous = documentFor(oldSource);
    const styleRef = "urn:iriograph:style:region:overlap:1";
    const node = overlayFor(previous.views[0]!.overlay, `${NS}a`)!;
    node.appearance = {
      styleToken: styleRef,
      style: { fill: "#123456", strokeWidth: 3, labelFontSize: 19 },
      nodeIconSize: { width: 48, height: 32 },
      nodeIconFit: "contain",
    };

    const result = await applySemanticSource(previous, oldSource, runtimeContext());

    expect(result.accepted).toBe(true);
    expect(overlayFor(result.document.views[0]!.overlay, `${NS}a`)?.appearance).toEqual({
      styleRef,
      style: { fill: "#123456", strokeWidth: 3, labelFontSize: 19 },
      nodeIconSize: { width: 48, height: 32 },
      nodeIconFit: "contain",
    });
    const scene = await buildIriographView(result.document, "main", runtimeContext());
    expect(scene.nodes.find((entry) => entry.semanticRef === `${NS}a`)?.style)
      .toMatchObject({
        fill: "#123456",
        stroke: "#7c3aed",
        strokeWidth: 3,
        labelFontSize: 19,
      });
    expect(scene.nodes.find((entry) => entry.semanticRef === `${NS}a`)).toMatchObject({
      nodeIconSize: { width: 48, height: 32 },
      nodeIconFit: "contain",
    });
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: "reconcile-style-token-migrated",
      semanticRef: `${NS}a`,
    }));
  });
});

const localizedOldSource = `
@prefix : <${NS}> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
:a rdfs:label "A" ; :p :b ; :q :b ; :loop :a .
:b rdfs:label "B" .
:c rdfs:label "C" ; :p :d .
:d rdfs:label "D" .
:e rdfs:label "E" ; :p :f .
:f rdfs:label "F" .
`;

const localizedAddSource = `${localizedOldSource}\n:a :added :b .\n`;
const localizedPredicateSource = localizedOldSource.replace(":c rdfs:label \"C\" ; :p :d .", (
  ":c rdfs:label \"C\" ; :changed :d ."
));
const localizedEndpointSource = localizedOldSource.replace(":c rdfs:label \"C\" ; :p :d .", (
  ":c rdfs:label \"C\" ; :p :e ."
));

function localizedDocumentFor(source: string): IriographDocumentV1 {
  return {
    schemaVersion: "1",
    kind: "iriograph.document",
    documentId: "localized-reconciliation-test",
    semantic: {
      format: "text/turtle",
      baseIri: NS,
      authoringProfileRef: "urn:test:authoring:1",
      source,
    },
    imports: [{ catalogRef: "urn:iriograph:catalog:rdf-rdfs@1" }],
    views: [
      {
        viewId: "main",
        kind: "node-link",
        profileRef: standardRdfRdfsCatalog.profileRef,
        layoutRef: STANDARD_LAYOUT_REFS.hierarchicalLr,
        overlay: {},
      },
      {
        viewId: "alternate",
        kind: "node-link",
        profileRef: standardRdfRdfsCatalog.profileRef,
        layoutRef: STANDARD_LAYOUT_REFS.hierarchicalTb,
        overlay: {},
      },
    ],
  };
}

function localizedRuntimeContext(
  requests: LayoutRequest[],
  samples: StandardLayoutPerformanceSample[],
): ProjectionRuntimeContext {
  const adapters = ([
    [STANDARD_LAYOUT_REFS.hierarchicalLr, "LR"],
    [STANDARD_LAYOUT_REFS.hierarchicalTb, "TB"],
  ] as const).map(([layoutRef, direction]): LayoutAdapter => {
    const standard = new StandardLightweightLayoutAdapter(
      layoutRef,
      direction,
      (sample) => { samples.push(sample); },
    );
    return {
      layoutRef,
      async layout(request) {
        requests.push(request);
        return standard.layout(request);
      },
    };
  });
  return runtimeContext(new LayoutAdapterRegistry(adapters));
}

function denseSource(withAddedEdge: boolean): string {
  const triples: string[] = [
    `@prefix : <${NS}> .`,
    "@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .",
  ];
  for (let index = 0; index < 12; index += 1) {
    triples.push(`:n${index} rdfs:label "Node ${index}" .`);
  }
  for (let source = 0; source < 12; source += 1) {
    for (let offset = 1; offset <= 3; offset += 1) {
      triples.push(`:n${source} :p${offset} :n${(source + offset) % 12} .`);
    }
  }
  if (withAddedEdge) triples.push(":n0 :added :n1 .");
  return `${triples.join("\n")}\n`;
}

const oldSource = `
@prefix : <${NS}> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
:lane a rdf:Bag ; rdfs:label "Lane"@en, "レーン"@ja ; rdfs:member :a, :b, :c .
:flow a rdf:Seq ; rdf:_1 :a ; rdf:_2 :b ; rdf:_3 :c .
:a rdfs:label "A"@en, "甲"@ja ; :rel :b .
:b rdfs:label "B"@en, "乙"@ja .
:c rdfs:label "C"@en, "丙"@ja .
`;

const newSource = `
@prefix : <${NS}> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
:lane a rdf:Bag ; rdfs:label "Lane"@en, "レーン"@ja ; rdfs:member :b .
:lane2 a rdf:Bag ; rdfs:label "Second lane"@en, "第2レーン"@ja ; rdfs:member :a, :d .
:flow a rdf:Seq ; rdf:_1 :a ; rdf:_2 :d ; rdf:_3 :b .
:a a rdf:Bag ; rdfs:label "A container"@en, "甲コンテナ"@ja ; rdfs:member :inner ; :rel :b .
:b rdfs:label "B"@en, "乙"@ja .
:d rdfs:label "D"@en, "丁"@ja .
:inner rdfs:label "Inner"@en, "内部"@ja .
`;

const sequenceEndpointOldSource = `
@prefix : <${NS}> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
:flow a rdf:Seq ; rdf:_1 :a ; rdf:_2 :b .
:a rdfs:label "A" .
:b rdfs:label "B" .
`;

const sequenceEndpointNewSource = `
@prefix : <${NS}> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
:flow a rdf:Seq ; rdf:_1 :a ; rdf:_2 :c .
:a rdfs:label "A" .
:c rdfs:label "C" .
`;

function documentFor(source: string): IriographDocumentV1 {
  return {
    schemaVersion: "1",
    kind: "iriograph.document",
    documentId: "reconciliation-test",
    semantic: {
      format: "text/turtle",
      baseIri: NS,
      authoringProfileRef: "urn:test:authoring:1",
      source,
    },
    imports: [{ catalogRef: "urn:iriograph:catalog:rdf-rdfs@1" }],
    views: [
      viewFor(
        "main",
        STANDARD_LAYOUT_REFS.hierarchicalLr,
        "ja-JP",
        { x: 10, y: 20, width: 164, height: 72 },
      ),
      viewFor(
        "alternate",
        STANDARD_LAYOUT_REFS.hierarchicalTb,
        "en-US",
        { x: 410, y: 220, width: 164, height: 72 },
      ),
    ],
  };
}

function viewFor(
  viewId: string,
  layoutRef: string,
  locale: string,
  geometry: { x: number; y: number; width: number; height: number },
): IriographDocumentV1["views"][number] {
  return {
    viewId,
    kind: "node-link",
    profileRef: standardRdfRdfsCatalog.profileRef,
    layoutRef,
    locale,
    overlay: {
      [`${viewId}-a`]: {
        semanticRef: `${NS}a`,
        geometry,
        pinned: true,
        placement: "user",
        appearance: {
          templateRef: standardRdfRdfsCatalog.defaults!.nodeTemplateRef,
          iconRef: "urn:test:asset:a",
        },
      },
      [`${viewId}-c`]: {
        semanticRef: `${NS}c`,
        geometry: { x: 700, y: 200, width: 164, height: 72 },
        placement: "generated",
      },
      [`${viewId}-direct`]: {
        semanticRef: directEdgeRef,
        appearance: { templateRef: "urn:iriograph:template:edge:reference:1" },
        routing: { waypoints: [{ x: 300, y: 90 }] },
      },
      [`${viewId}-sequence`]: {
        semanticRef: oldSequenceRef,
        routing: { waypoints: [{ x: 250, y: 70 }] },
      },
    },
  };
}

function runtimeContext(
  layouts = createStandardLayoutRegistry(),
): ProjectionRuntimeContext {
  return {
    catalogsByProfile: new Map([[
      standardRdfRdfsCatalog.profileRef,
      { catalog: standardRdfRdfsCatalog },
    ]]),
    layouts,
  };
}

function noisyLayoutAdapter(
  layoutRef: string,
  direction: "LR" | "TB",
): LayoutAdapter {
  const standard = new StandardLightweightLayoutAdapter(layoutRef, direction);
  return {
    layoutRef,
    async layout(request) {
      const result = await standard.layout(request);
      const unrelatedElement = request.scene.elements.find((element) => element.structuralKind === "node");
      const affectedEdge = request.scene.edges.find((edge) => (
        request.mode !== "route-only" || !request.fixedDerivedRoutes?.[edge.elementId]
      ));
      const affectedDiagnostic = affectedEdge ? {
        severity: "warning" as const,
        code: "test-affected-route",
        message: "対象edgeの経路を確定できません。",
        layoutRef,
        edgeId: affectedEdge.elementId,
      } : undefined;
      return {
        ...result,
        diagnostics: [
          ...result.diagnostics,
          ...(unrelatedElement ? [{
            severity: "warning" as const,
            code: "test-unrelated-placement",
            message: "既存nodeの配置警告です。",
            layoutRef,
            elementId: unrelatedElement.elementId,
          }] : []),
          ...(affectedDiagnostic ? [affectedDiagnostic, { ...affectedDiagnostic }] : []),
        ],
      };
    },
  };
}

function overlayFor(
  overlay: IriographDocumentV1["views"][number]["overlay"],
  semanticRef: string,
) {
  return Object.values(overlay).find((entry) => entry.semanticRef === semanticRef);
}

function geometryBySemantic(
  document: IriographDocument,
): Record<string, Record<string, IriographDocumentV1["views"][number]["overlay"][string]["geometry"]>> {
  return Object.fromEntries(document.views.map((view) => [
    view.viewId,
    Object.fromEntries(Object.values(view.overlay)
      .filter((entry) => entry.geometry)
      .map((entry) => [entry.semanticRef, entry.geometry])),
  ]));
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

function overlaps(
  left: { x: number; y: number; width: number; height: number },
  right: { x: number; y: number; width: number; height: number },
): boolean {
  return left.x < right.x + right.width
    && left.x + left.width > right.x
    && left.y < right.y + right.height
    && left.y + left.height > right.y;
}
