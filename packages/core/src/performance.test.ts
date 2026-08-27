import { performance } from "node:perf_hooks";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { applyAuthoringPreview, previewAuthoringCommands } from "./authoring";
import type { AuthoringCommand, ResolvedAuthoringContext } from "./authoring-model";
import { statementIdentityForNamedStatement } from "./identity";

import {
  completeRegionLayout,
  containerContentBounds,
  createStandardLayoutRegistry,
  flattenLayoutDerivedCurve,
  layoutProjectedDiagramScene,
  LayoutAdapterRegistry,
  projectSemanticView,
  STANDARD_LAYOUT_REFS,
  StandardLightweightLayoutAdapter,
  standardRdfRdfsCatalog,
  standardRdfRdfsClassificationRegionCatalog,
  standardRdfRdfsInstanceFlowCatalog,
  type DiagramScene,
  type ElementGeometry,
  type IriographDocumentV1,
  type LayoutRequest,
  type Point,
  type ProjectionCatalogV1,
  type StandardLayoutPerformanceSample,
} from "./index";

const NORMAL_SCALE = { nodes: 500, edges: 1_000 } as const;
const STRESS_SCALE = { nodes: 2_000, edges: 4_000 } as const;

// Product budgets are CI gates. One warmup and the median of three samples
// absorb startup noise without weakening the completion criterion.
const INITIAL_PIPELINE_BUDGET_MS = 2_000;
const EDIT_REPROJECTION_BUDGET_MS = 100;
const SMALL_INITIAL_PIPELINE_BUDGET_MS = 300;
const SAMPLE_COUNT = 3;
const SMALL_SAMPLE_COUNT = 5;
const AUTHORING_WARM_COUNT = 20;
const AUTHORING_SAMPLE_COUNT = 20;
const AUTHORING_PIPELINE_BUDGET_MS = 150;
const CONTAINER_SIZE = 50;

describe("P1-08 fixed graph performance", () => {
  it("builds deterministic normal and stress fixtures with exact cardinalities", () => {
    for (const scale of [NORMAL_SCALE, STRESS_SCALE]) {
      const first = createFixture(scale.nodes, scale.edges);
      const second = createFixture(scale.nodes, scale.edges);

      expect(first).toEqual(second);
      const projected = projectSemanticView(first, standardRdfRdfsCatalog);
      expect(projected.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
      expect(projected.nodes).toHaveLength(scale.nodes);
      expect(projected.containers).toHaveLength(Math.ceil(scale.nodes / CONTAINER_SIZE));
      expect(projected.edges).toHaveLength(scale.edges);
    }
  }, 30_000);

  it("keeps initial projection plus the standard layout within the fixed product budget", async () => {
    const registry = createStandardLayoutRegistry();
    const normal = createFixture(NORMAL_SCALE.nodes, NORMAL_SCALE.edges);
    const stress = createFixture(STRESS_SCALE.nodes, STRESS_SCALE.edges);
    const normalResult = await measure(async () => projectAndLayout(normal, registry));
    const stressResult = await measure(async () => projectAndLayout(stress, registry));

    reportMeasurement("initial-normal", normalResult, INITIAL_PIPELINE_BUDGET_MS);
    reportMeasurement("initial-stress", stressResult, INITIAL_PIPELINE_BUDGET_MS);
    expect(stressResult.value.nodes).toHaveLength(STRESS_SCALE.nodes);
    expect(stressResult.value.edges).toHaveLength(STRESS_SCALE.edges);
    expect(stressResult.value.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(stressResult.medianMs).toBeLessThan(INITIAL_PIPELINE_BUDGET_MS);
  }, 30_000);

  it("keeps a representative normal edit and semantic reprojection within budget", async () => {
    const fixture = createFixture(NORMAL_SCALE.nodes, NORMAL_SCALE.edges);
    const result = await measure(() => {
      const candidate = withEditedLabel(fixture, Math.floor(NORMAL_SCALE.nodes / 2));
      return projectSemanticView(candidate, standardRdfRdfsCatalog);
    });

    reportMeasurement("edit-reprojection-normal", result, EDIT_REPROJECTION_BUDGET_MS);
    expect(result.value.nodes).toHaveLength(NORMAL_SCALE.nodes);
    expect(result.value.edges).toHaveLength(NORMAL_SCALE.edges);
    expect(result.value.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(result.medianMs).toBeLessThan(EDIT_REPROJECTION_BUDGET_MS);
  }, 10_000);

  it("keeps pizza, sparse-small, and dense-small initial projection/layout p95 under 300ms", async () => {
    const fixtures = [{
      name: "pizza",
      document: pizzaFixture(),
      catalog: standardRdfRdfsInstanceFlowCatalog,
      maximumStrictCrossings: 9,
    }, {
      name: "sparse-small",
      document: createFixture(24, 23),
      catalog: standardRdfRdfsCatalog,
      maximumStrictCrossings: 0,
    }, {
      name: "dense-small",
      document: createFixture(24, 120),
      catalog: standardRdfRdfsCatalog,
      maximumStrictCrossings: 398,
    }];

    for (const fixture of fixtures) {
      await measureInitialPhases(fixture.document, fixture.catalog, 1);
      const samples = await measureInitialPhases(
        fixture.document,
        fixture.catalog,
        SMALL_SAMPLE_COUNT,
      );
      reportInitialPhases(fixture.name, samples);
      const last = samples.at(-1)!;
      const quality = routeQuality(last.scene);
      expect(last.scene.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
      expect(quality.nodeObstacleIntersections).toBe(0);
      if (fixture.name !== "sparse-small") {
        expect(quality.publicRouteObstacleIntersections).toBeGreaterThan(0);
      }
      expect(quality.endpointInteriorTraversals).toBe(0);
      expect(quality.maximumRoutePoints).toBeLessThanOrEqual(3);
      expect(quality.strictCrossings).toBeLessThanOrEqual(fixture.maximumStrictCrossings);
      expect(quality.overlapLength).toBe(0);
      if (fixture.name === "pizza") {
        const nonmemberGroups = nonmemberGroupContentQuality(last.scene);
        expect(nonmemberGroups.nonmembers).toBeGreaterThan(0);
        expect(nonmemberGroups.contentOverlaps).toBe(0);
      }
      expect(samples.map((sample) => sample.totalMs).sort((left, right) => left - right)
        .at(percentileIndex(samples.length, .95)))
        .toBeLessThan(SMALL_INITIAL_PIPELINE_BUDGET_MS);
    }
  }, 20_000);

  it("keeps route quality independent of labels, opaque IRIs, and pizza topology", async () => {
    const baselineDocument = createFixture(24, 120);
    const labelVariant = withGenericLabels(baselineDocument);
    const opaqueVariant = withOpaqueIris(baselineDocument);
    const containmentDocument = createFixture(60, 59);
    const [baseline, labels, opaque, containment] = await Promise.all([
      measureInitialPhases(baselineDocument, standardRdfRdfsCatalog, 1),
      measureInitialPhases(labelVariant, standardRdfRdfsCatalog, 1),
      measureInitialPhases(opaqueVariant, standardRdfRdfsCatalog, 1),
      measureInitialPhases(containmentDocument, standardRdfRdfsCatalog, 1),
    ]);
    const baselineQuality = routeQuality(baseline[0]!.scene);
    const labelQuality = routeQuality(labels[0]!.scene);
    const opaqueQuality = routeQuality(opaque[0]!.scene);
    const containmentQuality = routeQuality(containment[0]!.scene);

    console.info(JSON.stringify({
      benchmark: "layout-genericity-quality",
      baseline: baselineQuality,
      labels: labelQuality,
      opaque: opaqueQuality,
      nonPizzaContainment: containmentQuality,
    }));
    for (const quality of [baselineQuality, labelQuality, opaqueQuality, containmentQuality]) {
      expect(quality.nodeObstacleIntersections).toBe(0);
      expect(quality.endpointInteriorTraversals).toBe(0);
      expect(quality.maximumRoutePoints).toBeLessThanOrEqual(3);
    }
    expect(labelQuality).toEqual(baselineQuality);
    expect(opaqueQuality).toEqual(baselineQuality);
    expect(containment[0]!.scene.containers).toHaveLength(2);
    expect(containment[0]!.totalMs).toBeLessThan(SMALL_INITIAL_PIPELINE_BUDGET_MS);
  }, 10_000);

  it("keeps bounded Group Frame nonmember evacuation within the small-layout budget", async () => {
    const nonmemberCount = 160;
    const frame = { x: 0, y: 0, width: 360, height: 220 };
    const request: LayoutRequest = {
      layoutRef: "urn:test:performance:group-nonmembers",
      scene: {
        elements: [
          { elementId: "group", structuralKind: "container", groupRole: "membership" },
          { elementId: "member", structuralKind: "node", placement: "generated" },
          ...Array.from({ length: nonmemberCount }, (_, index) => ({
            elementId: `free-${String(index).padStart(3, "0")}`,
            structuralKind: "node" as const,
            placement: "generated" as const,
          })),
        ],
        memberships: [{
          semanticRef: "group-member",
          containerElementId: "group",
          memberElementId: "member",
          role: "membership",
        }],
        edges: [],
      },
    };
    const candidate = {
      layoutRef: request.layoutRef,
      geometries: {
        group: frame,
        member: { x: 120, y: 100, width: 80, height: 40 },
        ...Object.fromEntries(Array.from({ length: nonmemberCount }, (_, index) => [
          `free-${String(index).padStart(3, "0")}`,
          { x: 140, y: 110, width: 60, height: 30 },
        ])),
      },
      routes: {},
      width: frame.width,
      height: frame.height,
      diagnostics: [],
    };
    const measurement = await measure(() => completeRegionLayout(request, candidate, "LR"));
    const content = { x: 28, y: 64, width: 304, height: 128 };
    const free = Array.from({ length: nonmemberCount }, (_, index) => (
      measurement.value.geometries[`free-${String(index).padStart(3, "0")}`]!
    ));

    reportMeasurement(
      "group-nonmember-completion",
      measurement,
      SMALL_INITIAL_PIPELINE_BUDGET_MS,
    );
    expect(free.every((geometry) => !rectanglesOverlap(geometry, content))).toBe(true);
    expect(pairwiseRectangleOverlapCount(free)).toBe(0);
    expect(measurement.medianMs).toBeLessThan(SMALL_INITIAL_PIPELINE_BUDGET_MS);
  }, 10_000);

  it("keeps prepared relation add, predicate change, and endpoint change core p95 under 150ms", async () => {
    const document = pizzaFixture();
    const namespace = document.semantic.baseIri;
    const relation = {
      subjectIri: `${namespace}lane1-c01`,
      predicateIri: `${namespace}next`,
      objectIri: `${namespace}lane1-c02`,
    };
    const operations: Array<{ name: string; commands: readonly AuthoringCommand[] }> = [{
      name: "relation-add",
      commands: [{
        type: "connect-resources",
        commandId: "benchmark-add",
        subjectIri: `${namespace}lane1-c01`,
        predicateIri: `${namespace}about`,
        objectIri: `${namespace}lane1-c03`,
      }],
    }, {
      name: "predicate-change",
      commands: [{
        type: "remove-statement",
        commandId: "benchmark-remove-old-predicate",
        statementRef: statementIdentityForNamedStatement(relation),
        ...relation,
      }, {
        type: "connect-resources",
        commandId: "benchmark-add-new-predicate",
        subjectIri: relation.subjectIri,
        predicateIri: `${namespace}branchesTo`,
        objectIri: relation.objectIri,
      }],
    }, {
      name: "endpoint-change",
      commands: [{
        type: "remove-statement",
        commandId: "benchmark-remove-old-endpoint",
        statementRef: statementIdentityForNamedStatement(relation),
        ...relation,
      }, {
        type: "connect-resources",
        commandId: "benchmark-add-new-endpoint",
        subjectIri: relation.subjectIri,
        predicateIri: relation.predicateIri,
        objectIri: `${namespace}lane1-c03`,
      }],
    }];
    const context = performanceAuthoringContext(document);

    for (const operation of operations) {
      for (let warm = 0; warm < AUTHORING_WARM_COUNT; warm += 1) {
        await applyPreparedOperation(document, operation.commands, context);
      }
      const samples: number[] = [];
      for (let sample = 0; sample < AUTHORING_SAMPLE_COUNT; sample += 1) {
        const startedAt = performance.now();
        const update = await applyPreparedOperation(document, operation.commands, context);
        samples.push(performance.now() - startedAt);
        expect(update.accepted).toBe(true);
      }
      const p95Ms = [...samples].sort((left, right) => left - right)
        .at(percentileIndex(samples.length, .95))!;
      console.info(JSON.stringify({
        benchmark: `authoring-${operation.name}`,
        warmRuns: AUTHORING_WARM_COUNT,
        samples: AUTHORING_SAMPLE_COUNT,
        p95Ms: roundMilliseconds(p95Ms),
        referenceBudgetMs: AUTHORING_PIPELINE_BUDGET_MS,
      }));
      expect(p95Ms).toBeLessThan(AUTHORING_PIPELINE_BUDGET_MS);
    }
  }, 30_000);
});

type Scale = { nodes: number; edges: number };

type Measurement<T> = {
  value: T;
  samplesMs: number[];
  medianMs: number;
};

type InitialPhaseMeasurement = {
  projectionMs: number;
  totalMs: number;
  layout: StandardLayoutPerformanceSample;
  scene: DiagramScene;
};

function createFixture(nodeCount: number, edgeCount: number): IriographDocumentV1 {
  if (!Number.isInteger(nodeCount) || nodeCount < 2) throw new Error("nodeCount must be at least two");
  if (!Number.isInteger(edgeCount) || edgeCount < 0) throw new Error("edgeCount must be nonnegative");
  const scale: Scale = { nodes: nodeCount, edges: edgeCount };
  const lines = [
    "@prefix : <urn:iriograph:benchmark:> .",
    "@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .",
    "@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .",
    "",
  ];
  for (let start = 0; start < scale.nodes; start += CONTAINER_SIZE) {
    const container = containerName(start / CONTAINER_SIZE, scale.nodes);
    lines.push(`:${container} a rdf:Bag ; rdfs:label "Group ${container}" .`);
    const end = Math.min(start + CONTAINER_SIZE, scale.nodes);
    for (let member = start; member < end; member += 1) {
      lines.push(`:${container} rdfs:member :${nodeName(member, scale.nodes)} .`);
    }
  }
  for (let index = 0; index < scale.nodes; index += 1) {
    lines.push(`:${nodeName(index, scale.nodes)} rdfs:label "Node ${nodeName(index, scale.nodes)}" .`);
  }
  let emittedEdges = 0;
  for (let offset = 1; offset < scale.nodes && emittedEdges < scale.edges; offset += 1) {
    for (let source = 0; source + offset < scale.nodes && emittedEdges < scale.edges; source += 1) {
      lines.push(
        `:${nodeName(source, scale.nodes)} :connects :${nodeName(source + offset, scale.nodes)} .`,
      );
      emittedEdges += 1;
    }
  }
  if (emittedEdges !== scale.edges) throw new Error("edgeCount exceeds unique acyclic pairs");
  return {
    schemaVersion: "1",
    kind: "iriograph.document",
    documentId: `performance-${scale.nodes}-${scale.edges}`,
    semantic: {
      format: "text/turtle",
      baseIri: "urn:iriograph:benchmark:",
      authoringProfileRef: "urn:iriograph:authoring-profile:performance@1",
      source: `${lines.join("\n")}\n`,
    },
    views: [{
      viewId: "main",
      kind: "node-link",
      profileRef: standardRdfRdfsCatalog.profileRef,
      layoutRef: STANDARD_LAYOUT_REFS.hierarchicalLr,
      overlay: {},
    }],
  };
}

function withEditedLabel(
  document: IriographDocumentV1,
  nodeIndex: number,
): IriographDocumentV1 {
  const name = nodeName(nodeIndex, NORMAL_SCALE.nodes);
  const before = `"Node ${name}"`;
  const after = `"Node ${name} edited"`;
  const source = document.semantic.source.replace(before, after);
  if (source === document.semantic.source) throw new Error(`benchmark label was not found: ${name}`);
  return {
    ...document,
    semantic: { ...document.semantic, source },
  };
}

function withGenericLabels(document: IriographDocumentV1): IriographDocumentV1 {
  return {
    ...document,
    documentId: `${document.documentId}-generic-labels`,
    semantic: {
      ...document.semantic,
      source: document.semantic.source.replace(/"Node ([^"]+)"/g, '"Item $1"'),
    },
  };
}

function withOpaqueIris(document: IriographDocumentV1): IriographDocumentV1 {
  return {
    ...document,
    documentId: `${document.documentId}-opaque-iris`,
    semantic: {
      ...document.semantic,
      baseIri: "urn:opaque:",
      source: document.semantic.source
        .replaceAll("urn:iriograph:benchmark:", "urn:opaque:")
        .replaceAll(":connects", ":p-000")
        .replace(/:node-/g, ":r-")
        .replace(/:group-/g, ":c-"),
    },
  };
}

async function projectAndLayout(
  document: IriographDocumentV1,
  registry: ReturnType<typeof createStandardLayoutRegistry>,
): Promise<DiagramScene> {
  const projected = projectSemanticView(document, standardRdfRdfsCatalog);
  return layoutProjectedDiagramScene(
    projected,
    STANDARD_LAYOUT_REFS.hierarchicalLr,
    registry,
    "full",
  );
}

function performanceAuthoringContext(document: IriographDocumentV1): ResolvedAuthoringContext {
  return {
    contextId: "urn:iriograph:performance-context:1",
    contextRevision: "1",
    documentRevision: "1",
    authoringProfileRef: document.semantic.authoringProfileRef,
    runtime: {
      catalogsByProfile: new Map([
        [standardRdfRdfsClassificationRegionCatalog.profileRef, {
          catalog: standardRdfRdfsClassificationRegionCatalog,
        }],
        [standardRdfRdfsInstanceFlowCatalog.profileRef, {
          catalog: standardRdfRdfsInstanceFlowCatalog,
        }],
      ]),
      layouts: createStandardLayoutRegistry(),
    },
    resourcePolicy: { allowedMintNamespaces: [document.semantic.baseIri] },
    termPolicy: {
      existingUnknown: "preserve",
      humanUnknown: "warn",
      llmUnknown: "reject",
      humanMinting: "warn",
      llmMinting: "deny",
    },
    terms: [],
    capabilities: [],
  };
}

async function applyPreparedOperation(
  document: IriographDocumentV1,
  commands: readonly AuthoringCommand[],
  context: ResolvedAuthoringContext,
) {
  const preview = await previewAuthoringCommands(document, commands, context);
  if (!preview.valid) throw new Error(`performance preview was invalid: ${preview.diagnostics.map((item) => item.code).join(",")}`);
  return applyAuthoringPreview(document, preview, context, {
    confirmationId: preview.confirmationId,
  });
}

async function measureInitialPhases(
  document: IriographDocumentV1,
  catalog: ProjectionCatalogV1,
  sampleCount: number,
): Promise<InitialPhaseMeasurement[]> {
  const samples: InitialPhaseMeasurement[] = [];
  for (let sample = 0; sample < sampleCount; sample += 1) {
    const totalStartedAt = performance.now();
    const projectionStartedAt = performance.now();
    const projected = projectSemanticView(document, catalog);
    const projectionMs = performance.now() - projectionStartedAt;
    let layoutSample: StandardLayoutPerformanceSample | undefined;
    const adapter = new StandardLightweightLayoutAdapter(
      STANDARD_LAYOUT_REFS.hierarchicalLr,
      "LR",
      (value) => { layoutSample = value; },
    );
    const scene = await layoutProjectedDiagramScene(
      projected,
      STANDARD_LAYOUT_REFS.hierarchicalLr,
      new LayoutAdapterRegistry([adapter]),
      "full",
    );
    if (!layoutSample) throw new Error("standard layout performance sample was not emitted");
    samples.push({
      projectionMs,
      totalMs: performance.now() - totalStartedAt,
      layout: layoutSample,
      scene,
    });
  }
  return samples;
}

async function measure<T>(operation: () => T | Promise<T>): Promise<Measurement<T>> {
  await operation();
  const samplesMs: number[] = [];
  let value!: T;
  for (let sample = 0; sample < SAMPLE_COUNT; sample += 1) {
    const startedAt = performance.now();
    value = await operation();
    samplesMs.push(performance.now() - startedAt);
  }
  const sorted = [...samplesMs].sort((left, right) => left - right);
  return { value, samplesMs, medianMs: sorted[Math.floor(sorted.length / 2)]! };
}

function reportMeasurement<T>(
  name: string,
  measurement: Measurement<T>,
  referenceBudgetMs: number,
): void {
  console.info(JSON.stringify({
    benchmark: name,
    samplesMs: measurement.samplesMs.map(roundMilliseconds),
    medianMs: roundMilliseconds(measurement.medianMs),
    referenceBudgetMs,
  }));
}

function reportInitialPhases(
  name: string,
  samples: readonly InitialPhaseMeasurement[],
): void {
  const values = (select: (sample: InitialPhaseMeasurement) => number) => (
    samples.map(select).sort((left, right) => left - right)
  );
  const p95 = (select: (sample: InitialPhaseMeasurement) => number) => {
    const sorted = values(select);
    return sorted[percentileIndex(sorted.length, .95)]!;
  };
  console.info(JSON.stringify({
    benchmark: `initial-${name}`,
    samples: samples.length,
    p95Ms: roundMilliseconds(p95((sample) => sample.totalMs)),
    phasesP95Ms: {
      projection: roundMilliseconds(p95((sample) => sample.projectionMs)),
      placement: roundMilliseconds(p95((sample) => sample.layout.placementMs)),
      initialRoute: roundMilliseconds(p95((sample) => sample.layout.initialRouteMs)),
      refinement: roundMilliseconds(p95((sample) => sample.layout.refinementMs)),
      compaction: roundMilliseconds(p95((sample) => sample.layout.compactionMs)),
      bounds: roundMilliseconds(p95((sample) => sample.layout.boundsMs)),
    },
    counts: samples.map((sample) => ({
      visibilitySearches: sample.layout.visibilitySearches,
      compactedEdges: sample.layout.compactedEdges,
      compactionCandidates: sample.layout.compactionCandidates,
      routedEdges: sample.layout.routedEdges,
      fixedDerivedRoutes: sample.layout.fixedDerivedRoutes,
    })),
    quality: routeQuality(samples.at(-1)!.scene),
    referenceBudgetMs: SMALL_INITIAL_PIPELINE_BUDGET_MS,
  }));
}

function pizzaFixture(): IriographDocumentV1 {
  return JSON.parse(readFileSync(new URL(
    "../../../apps/mock/public/workspace/models/pizza-order-delivery.iriograph",
    import.meta.url,
  ), "utf8")) as IriographDocumentV1;
}

type RouteQuality = {
  /** Endpoint-only curve routes are not renderer geometry; retained as a guard. */
  publicRouteObstacleIntersections: number;
  nodeObstacleIntersections: number;
  endpointInteriorTraversals: number;
  strictCrossings: number;
  overlapLength: number;
  maximumRoutePoints: number;
};

function routeQuality(scene: DiagramScene): RouteQuality {
  let publicRouteObstacleIntersections = 0;
  let nodeObstacleIntersections = 0;
  let endpointInteriorTraversals = 0;
  let strictCrossings = 0;
  let overlapLength = 0;
  let maximumRoutePoints = 0;
  const nodes = new Map(scene.nodes.map((node) => [node.elementId, node]));
  const renderedRoutes = new Map(scene.edges.map((edge) => {
    const publicRoute = edge.route ?? [];
    return [edge.elementId, edge.derivedRouteChoice?.curve
      ? flattenLayoutDerivedCurve(publicRoute, edge.derivedRouteChoice.curve)
      : publicRoute] as const;
  }));
  for (const edge of scene.edges) {
    const publicRoute = edge.route ?? [];
    const route = renderedRoutes.get(edge.elementId) ?? publicRoute;
    maximumRoutePoints = Math.max(maximumRoutePoints, publicRoute.length);
    for (const node of scene.nodes) {
      if (node.elementId === edge.sourceElementId || node.elementId === edge.targetElementId) continue;
      if (polylineCrossesGeometryInterior(publicRoute, node.geometry)) {
        publicRouteObstacleIntersections += 1;
      }
      if (polylineCrossesGeometryInterior(route, node.geometry)) {
        nodeObstacleIntersections += 1;
      }
    }
    const source = nodes.get(edge.sourceElementId)?.geometry;
    const target = nodes.get(edge.targetElementId)?.geometry;
    if (source && route.length >= 2 && !endpointLegLeaves(route[0]!, route[1]!, source)) {
      endpointInteriorTraversals += 1;
    }
    if (target && route.length >= 2 && !endpointLegLeaves(route.at(-1)!, route.at(-2)!, target)) {
      endpointInteriorTraversals += 1;
    }
  }
  for (let left = 0; left < scene.edges.length; left += 1) {
    const leftRoute = renderedRoutes.get(scene.edges[left]!.elementId) ?? [];
    for (let right = left + 1; right < scene.edges.length; right += 1) {
      const leftEdge = scene.edges[left]!;
      const rightEdge = scene.edges[right]!;
      const rightRoute = renderedRoutes.get(rightEdge.elementId) ?? [];
      const sharedEndpointGeometries = [leftEdge.sourceElementId, leftEdge.targetElementId]
        .filter((id) => id === rightEdge.sourceElementId || id === rightEdge.targetElementId)
        .flatMap((id) => {
          const geometry = nodes.get(id)?.geometry;
          return geometry ? [expandTestGeometry(geometry, 15)] : [];
        });
      strictCrossings += polylineStrictCrossings(
        leftRoute,
        rightRoute,
        sharedEndpointGeometries,
      );
      overlapLength += polylineOverlapLength(leftRoute, rightRoute);
    }
  }
  return {
    publicRouteObstacleIntersections,
    nodeObstacleIntersections,
    endpointInteriorTraversals,
    strictCrossings,
    overlapLength: Math.round(overlapLength * 1_000) / 1_000,
    maximumRoutePoints,
  };
}

function nonmemberGroupContentQuality(scene: DiagramScene): {
  nonmembers: number;
  contentOverlaps: number;
} {
  const assigned = new Set((scene.memberships ?? []).map((membership) => membership.memberElementId));
  const nonmembers = scene.nodes.filter((node) => !assigned.has(node.elementId));
  const groupContent = [
    ...scene.containers
      .filter((container) => container.groupFrame)
      .map((container) => containerContentBounds(container.geometry, container.headerPosition)),
    ...(scene.regions ?? [])
      .filter((region) => region.groupFrame)
      .map((region) => region.geometry),
  ];
  return {
    nonmembers: nonmembers.length,
    contentOverlaps: nonmembers.reduce((count, node) => (
      count + groupContent.filter((content) => rectanglesOverlap(node.geometry, content)).length
    ), 0),
  };
}

function pairwiseRectangleOverlapCount(geometries: readonly ElementGeometry[]): number {
  let count = 0;
  for (let left = 0; left < geometries.length; left += 1) {
    for (let right = left + 1; right < geometries.length; right += 1) {
      if (rectanglesOverlap(geometries[left]!, geometries[right]!)) count += 1;
    }
  }
  return count;
}

function rectanglesOverlap(left: ElementGeometry, right: ElementGeometry): boolean {
  return left.x < right.x + right.width
    && left.x + left.width > right.x
    && left.y < right.y + right.height
    && left.y + left.height > right.y;
}

function endpointLegLeaves(endpoint: Point, next: Point, geometry: ElementGeometry): boolean {
  const center = {
    x: geometry.x + geometry.width / 2,
    y: geometry.y + geometry.height / 2,
  };
  return (endpoint.x - center.x) * (next.x - endpoint.x)
    + (endpoint.y - center.y) * (next.y - endpoint.y) >= -1e-6;
}

function polylineCrossesGeometryInterior(
  route: readonly Point[],
  geometry: ElementGeometry,
): boolean {
  for (let index = 0; index < route.length - 1; index += 1) {
    if (segmentCrossesGeometryInterior(route[index]!, route[index + 1]!, geometry)) return true;
  }
  return false;
}

function segmentCrossesGeometryInterior(
  start: Point,
  end: Point,
  geometry: ElementGeometry,
): boolean {
  const epsilon = 1e-7;
  let lower = 0;
  let upper = 1;
  for (const [origin, delta, minimum, maximum] of [
    [start.x, end.x - start.x, geometry.x + epsilon, geometry.x + geometry.width - epsilon],
    [start.y, end.y - start.y, geometry.y + epsilon, geometry.y + geometry.height - epsilon],
  ] as const) {
    if (Math.abs(delta) < epsilon) {
      if (origin <= minimum || origin >= maximum) return false;
      continue;
    }
    const first = (minimum - origin) / delta;
    const second = (maximum - origin) / delta;
    lower = Math.max(lower, Math.min(first, second));
    upper = Math.min(upper, Math.max(first, second));
    if (lower > upper) return false;
  }
  return upper >= 0 && lower <= 1 && lower <= upper;
}

function polylineStrictCrossings(
  left: readonly Point[],
  right: readonly Point[],
  excluded: readonly ElementGeometry[],
): number {
  const crossings = new Set<string>();
  for (let leftIndex = 0; leftIndex < left.length - 1; leftIndex += 1) {
    for (let rightIndex = 0; rightIndex < right.length - 1; rightIndex += 1) {
      const intersection = segmentStrictIntersection(
        left[leftIndex]!,
        left[leftIndex + 1]!,
        right[rightIndex]!,
        right[rightIndex + 1]!,
      );
      if (intersection && !excluded.some((geometry) => pointInsideOrOn(intersection, geometry))) {
        crossings.add(`${intersection.x},${intersection.y}`);
      }
    }
  }
  return crossings.size;
}

function segmentStrictIntersection(
  leftStart: Point,
  leftEnd: Point,
  rightStart: Point,
  rightEnd: Point,
): Point | undefined {
  const leftDx = leftEnd.x - leftStart.x;
  const leftDy = leftEnd.y - leftStart.y;
  const rightDx = rightEnd.x - rightStart.x;
  const rightDy = rightEnd.y - rightStart.y;
  const denominator = leftDx * rightDy - leftDy * rightDx;
  if (denominator === 0) return undefined;
  const offsetX = rightStart.x - leftStart.x;
  const offsetY = rightStart.y - leftStart.y;
  const leftRatio = (offsetX * rightDy - offsetY * rightDx) / denominator;
  const rightRatio = (offsetX * leftDy - offsetY * leftDx) / denominator;
  if (!(leftRatio > 0 && leftRatio < 1 && rightRatio > 0 && rightRatio < 1)) {
    return undefined;
  }
  return {
    x: leftStart.x + leftRatio * leftDx,
    y: leftStart.y + leftRatio * leftDy,
  };
}

function expandTestGeometry(geometry: ElementGeometry, amount: number): ElementGeometry {
  return {
    x: geometry.x - amount,
    y: geometry.y - amount,
    width: geometry.width + amount * 2,
    height: geometry.height + amount * 2,
  };
}

function pointInsideOrOn(point: Point, geometry: ElementGeometry): boolean {
  return point.x >= geometry.x
    && point.x <= geometry.x + geometry.width
    && point.y >= geometry.y
    && point.y <= geometry.y + geometry.height;
}

function polylineOverlapLength(left: readonly Point[], right: readonly Point[]): number {
  let total = 0;
  for (let leftIndex = 0; leftIndex < left.length - 1; leftIndex += 1) {
    const leftStart = left[leftIndex]!;
    const leftEnd = left[leftIndex + 1]!;
    for (let rightIndex = 0; rightIndex < right.length - 1; rightIndex += 1) {
      const rightStart = right[rightIndex]!;
      const rightEnd = right[rightIndex + 1]!;
      if (leftStart.x === leftEnd.x && rightStart.x === rightEnd.x && leftStart.x === rightStart.x) {
        total += intervalOverlap(leftStart.y, leftEnd.y, rightStart.y, rightEnd.y);
      } else if (leftStart.y === leftEnd.y && rightStart.y === rightEnd.y && leftStart.y === rightStart.y) {
        total += intervalOverlap(leftStart.x, leftEnd.x, rightStart.x, rightEnd.x);
      }
    }
  }
  return total;
}

function intervalOverlap(leftA: number, leftB: number, rightA: number, rightB: number): number {
  return Math.max(
    0,
    Math.min(Math.max(leftA, leftB), Math.max(rightA, rightB))
      - Math.max(Math.min(leftA, leftB), Math.min(rightA, rightB)),
  );
}

function percentileIndex(length: number, percentile: number): number {
  return Math.max(0, Math.ceil(length * percentile) - 1);
}

function nodeName(index: number, nodeCount: number): string {
  return `node-${String(index).padStart(String(nodeCount - 1).length, "0")}`;
}

function containerName(index: number, nodeCount: number): string {
  const count = Math.ceil(nodeCount / CONTAINER_SIZE);
  return `group-${String(index).padStart(String(count - 1).length, "0")}`;
}

function roundMilliseconds(value: number): number {
  return Math.round(value * 100) / 100;
}
