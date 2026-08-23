import { performance } from "node:perf_hooks";

import { describe, expect, it } from "vitest";

import {
  createStandardLayoutRegistry,
  layoutProjectedDiagramScene,
  projectSemanticView,
  STANDARD_LAYOUT_REFS,
  standardRdfRdfsCatalog,
  type DiagramScene,
  type IriographDocumentV1,
} from "./index";

const NORMAL_SCALE = { nodes: 500, edges: 1_000 } as const;
const STRESS_SCALE = { nodes: 2_000, edges: 4_000 } as const;

// Product budgets are CI gates. One warmup and the median of three samples
// absorb startup noise without weakening the completion criterion.
const INITIAL_PIPELINE_BUDGET_MS = 2_000;
const EDIT_REPROJECTION_BUDGET_MS = 100;
const SAMPLE_COUNT = 3;
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
});

type Scale = { nodes: number; edges: number };

type Measurement<T> = {
  value: T;
  samplesMs: number[];
  medianMs: number;
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
