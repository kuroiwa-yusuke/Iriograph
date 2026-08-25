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
import type { IriographDocumentV1 } from "./model";
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
    expect(mainA?.appearance).toBeUndefined();

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

  it.each([
    {
      name: "relation追加とparallel/self-loop",
      source: localizedAddSource,
      expectedAffected: 4,
      expectedFixed: 2,
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
      expectedAffected: 2,
      expectedFixed: 3,
    },
  ])("$nameを各viewのincident routeだけへ局所化する", async ({
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
    expect(routeOnlyRequests.map((request) => Object.keys(request.fixedDerivedRoutes ?? {}).length))
      .toEqual(previous.views.map(() => expectedFixed));
    expect(samples.filter((sample) => sample.mode === "route-only").map((sample) => ({
      fixed: sample.fixedDerivedRoutes,
      routed: sample.routedEdges,
    }))).toEqual(previous.views.map(() => ({ fixed: expectedFixed, routed: expectedAffected })));

    for (const view of previous.views) {
      const previousRoutes = new Map(before[view.viewId]!.edges.map((edge) => [edge.elementId, edge.route]));
      const request = routeOnlyRequests.find((entry) => entry.layoutRef === view.layoutRef)!;
      for (const edgeId of Object.keys(request.fixedDerivedRoutes ?? {})) {
        expect(JSON.stringify(
          result.scenes[view.viewId]!.edges.find((edge) => edge.elementId === edgeId)?.route,
        )).toBe(JSON.stringify(previousRoutes.get(edgeId)));
      }
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
      affectedEdges: 12,
      fixedDerivedRoutes: fixedIds.length,
    });
    expect(samples.find((sample) => sample.mode === "route-only" && sample.layoutRef === STANDARD_LAYOUT_REFS.hierarchicalLr))
      .toMatchObject({ routedEdges: 12, fixedDerivedRoutes: fixedIds.length });
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
          appearance: { templateRef: "urn:iriograph:template:container:sequence:1" },
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
    });
    expect(result.diagnostics.some((diagnostic) => (
      diagnostic.code === "reconcile-edge-endpoints-changed"
    ))).toBe(false);
  });

  it("legacy styleTokenをcatalog styleRefへ移行しsparse overrideを維持する", async () => {
    const previous = documentFor(oldSource);
    const styleRef = "urn:iriograph:style:region:overlap:1";
    const node = overlayFor(previous.views[0]!.overlay, `${NS}a`)!;
    node.appearance = {
      styleToken: styleRef,
      style: { fill: "#123456", strokeWidth: 3 },
    };

    const result = await applySemanticSource(previous, oldSource, runtimeContext());

    expect(result.accepted).toBe(true);
    expect(overlayFor(result.document.views[0]!.overlay, `${NS}a`)?.appearance).toEqual({
      styleRef,
      style: { fill: "#123456", strokeWidth: 3 },
    });
    const scene = await buildIriographView(result.document, "main", runtimeContext());
    expect(scene.nodes.find((entry) => entry.semanticRef === `${NS}a`)?.style)
      .toMatchObject({ fill: "#123456", stroke: "#7c3aed", strokeWidth: 3 });
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

function overlayFor(
  overlay: IriographDocumentV1["views"][number]["overlay"],
  semanticRef: string,
) {
  return Object.values(overlay).find((entry) => entry.semanticRef === semanticRef);
}
