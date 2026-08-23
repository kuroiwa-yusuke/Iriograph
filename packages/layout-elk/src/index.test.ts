import {
  LayoutAdapterRegistry,
  layoutProjectedScene,
  type LayoutEdge,
  type LayoutElement,
  type LayoutRequest,
} from "@iriograph/core";
import { describe, expect, test, vi } from "vitest";

import {
  ELK_LAYOUT_REFS,
  ElkLayeredLayoutAdapter,
  type ElkGraphEdge,
  type ElkGraphNode,
  type ElkLayoutEngine,
} from "./index";

class RecordingEngine implements ElkLayoutEngine {
  readonly inputs: ElkGraphNode[] = [];

  async layout(graph: ElkGraphNode): Promise<ElkGraphNode> {
    this.inputs.push(structuredClone(graph));
    return fakeLayout(graph);
  }
}

describe("ElkLayeredLayoutAdapter", () => {
  test("builds a deterministic compound Layered graph with explicit dimensions", async () => {
    const engine = new RecordingEngine();
    const adapter = new ElkLayeredLayoutAdapter(ELK_LAYOUT_REFS.layeredLr, "LR", { engine });
    const result = await adapter.layout(request(
      [
        element("z-outside", "node", undefined, { width: 90, height: 40 }),
        element("b-child", "node", "a-container", { width: 120, height: 50 }),
        {
          ...element("a-container", "container", undefined, { width: 420, height: 240 }),
          contentInsets: { top: 16, right: 16, bottom: 16, left: 78 },
        },
      ],
      [edge("edge-1", "b-child", "z-outside")],
    ));

    const input = engine.inputs[0]!;
    expect(input.children?.map((node) => node.id)).toEqual(["a-container", "z-outside"]);
    expect(input.children?.[0]?.children?.map((node) => node.id)).toEqual(["b-child"]);
    expect(input.children?.[0]).toMatchObject({ width: 420, height: 240 });
    expect(input.children?.[0]?.layoutOptions?.["elk.padding"])
      .toBe("[top=16,left=78,bottom=16,right=16]");
    expect(input.children?.[0]?.children?.[0]).toMatchObject({ width: 120, height: 50 });
    expect(input.layoutOptions).toMatchObject({
      "elk.algorithm": "org.eclipse.elk.layered",
      "elk.direction": "LR",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.hierarchyHandling": "INCLUDE_CHILDREN",
      "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
    });
    expect(input.edges?.map((item) => item.id)).toEqual(["edge-1"]);
    expect(result.geometries["b-child"]!.x).toBeGreaterThan(result.geometries["a-container"]!.x);
    expect(result.routes["edge-1"]).toHaveLength(4);
    expect(result.width).toBeGreaterThan(0);
    expect(result.height).toBeGreaterThan(0);
  });

  test("sorts equivalent input independently of source order", async () => {
    const firstEngine = new RecordingEngine();
    const secondEngine = new RecordingEngine();
    const first = new ElkLayeredLayoutAdapter("urn:test:determinism", "TB", { engine: firstEngine });
    const second = new ElkLayeredLayoutAdapter("urn:test:determinism", "TB", { engine: secondEngine });
    const elements = [element("b"), element("a"), element("c")];
    const edges = [edge("z", "b", "c"), edge("a", "a", "b")];

    const left = await first.layout(request(elements, edges, "urn:test:determinism"));
    const right = await second.layout(request(
      [...elements].reverse(),
      [...edges].reverse(),
      "urn:test:determinism",
    ));

    expect(firstEngine.inputs[0]).toEqual(secondEngine.inputs[0]);
    expect(left).toEqual(right);
    expect(firstEngine.inputs[0]!.layoutOptions?.["elk.direction"]).toBe("TB");
  });

  test("keeps manual waypoints and completes self and parallel routes", async () => {
    const engine: ElkLayoutEngine = {
      layout: async (graph) => fakeLayout(graph, (item, index) => {
        if (item.sources?.[0] === item.targets?.[0]) return undefined;
        return section(index * 20);
      }),
    };
    const adapter = new ElkLayeredLayoutAdapter("urn:test:routes", "LR", { engine });
    const result = await adapter.layout(request(
      [element("a"), element("b")],
      [
        edge("self", "a", "a"),
        edge("parallel-2", "a", "b"),
        edge("parallel-1", "a", "b"),
        {
          ...edge("manual", "b", "a"),
          routingPlacement: "user",
          waypoints: [{ x: 300, y: 20 }, { x: 220, y: 80 }],
        },
      ],
      "urn:test:routes",
    ));

    expect(result.routes.self).toHaveLength(4);
    expect(result.routes.self![0]).not.toEqual(result.routes.self![1]);
    expect(result.routes["parallel-1"]).not.toEqual(result.routes["parallel-2"]);
    expect(result.routes.manual!.slice(1, -1)).toEqual([
      { x: 300, y: 20 },
      { x: 220, y: 80 },
    ]);
    expect(result.diagnostics.some((item) => item.code === "elk-output-route-invalid")).toBe(true);
  });

  test("preserves explicit shape-aware endpoint anchors in ELK and manual routes", async () => {
    const engine = new RecordingEngine();
    const adapter = new ElkLayeredLayoutAdapter("urn:test:anchors", "LR", { engine });
    const result = await adapter.layout(request(
      [
        { ...element("a"), shape: "diamond", size: { width: 100, height: 80 } },
        { ...element("b"), shape: "circle", size: { width: 120, height: 80 } },
      ],
      [
        {
          ...edge("auto", "a", "b"),
          sourceAnchor: { position: 0 },
          targetAnchor: { position: .5 },
        },
        {
          ...edge("manual-anchor", "b", "a"),
          routingPlacement: "user",
          waypoints: [{ x: 210, y: 220 }],
          sourceAnchor: { position: .25 },
          targetAnchor: { position: .75 },
        },
      ],
      "urn:test:anchors",
    ));

    const a = result.geometries.a!;
    const b = result.geometries.b!;
    expect(result.routes.auto?.[0]).toEqual({ x: a.x + a.width / 2, y: a.y });
    expect(result.routes.auto?.at(-1)).toEqual({
      x: b.x + b.width / 2,
      y: b.y + b.height,
    });
    expect(result.routes["manual-anchor"]?.[0]).toEqual({
      x: b.x + b.width,
      y: b.y + b.height / 2,
    });
    expect(result.routes["manual-anchor"]?.at(-1)).toEqual({
      x: a.x,
      y: a.y + a.height / 2,
    });
  });

  test("never invokes ELK for fixed geometry and returns a Core-valid result", async () => {
    const layout = vi.fn<ElkLayoutEngine["layout"]>();
    const adapter = new ElkLayeredLayoutAdapter("urn:test:fixed", "LR", {
      engine: { layout },
    });
    const layoutRequest = request(
      [
        {
          ...element("fixed"),
          pinned: true,
          placement: "user",
          geometry: { x: 500, y: 120, width: 160, height: 72 },
        },
        element("generated"),
      ],
      [edge("flow", "fixed", "generated")],
      "urn:test:fixed",
    );
    const result = await layoutProjectedScene(
      layoutRequest,
      new LayoutAdapterRegistry([adapter]),
    );

    expect(layout).not.toHaveBeenCalled();
    expect(result.geometries.fixed).toEqual({ x: 500, y: 120, width: 160, height: 72 });
    expect(result.routes.flow!.length).toBeGreaterThanOrEqual(2);
    expect(result.diagnostics.some((item) => item.code === "elk-fixed-conservative-fallback")).toBe(true);
    expect(result.diagnostics.some((item) => item.code === "layout-result-invalid")).toBe(false);
  });

  test("diagnoses impossible fixed overlap without changing either geometry", async () => {
    const adapter = new ElkLayeredLayoutAdapter("urn:test:overlap", "LR", {
      engine: { layout: vi.fn<ElkLayoutEngine["layout"]>() },
    });
    const layoutRequest = request([
      { ...element("a"), pinned: true, geometry: { x: 10, y: 10, width: 100, height: 60 } },
      { ...element("b"), pinned: true, geometry: { x: 50, y: 30, width: 100, height: 60 } },
    ], [], "urn:test:overlap");
    const result = await adapter.layout(layoutRequest);

    expect(result.geometries.a).toEqual(layoutRequest.scene.elements[0]!.geometry);
    expect(result.geometries.b).toEqual(layoutRequest.scene.elements[1]!.geometry);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: "elk-fixed-overlap" }));
  });

  test("completes generated overlap regions around shared members after ELK layout", async () => {
    const adapter = new ElkLayeredLayoutAdapter("urn:test:regions", "LR", {
      engine: new RecordingEngine(),
    });
    const layoutRequest = request([
      element("left", "region", undefined, { width: 240, height: 160 }),
      element("right", "region", undefined, { width: 240, height: 160 }),
      element("a"),
      element("shared"),
      element("b"),
    ], [], "urn:test:regions");
    layoutRequest.scene.memberships = [
      membership("left-a", "left", "a"),
      membership("left-shared", "left", "shared"),
      membership("right-shared", "right", "shared"),
      membership("right-b", "right", "b"),
    ];

    const result = await layoutProjectedScene(
      layoutRequest,
      new LayoutAdapterRegistry([adapter]),
    );

    expect(Object.keys(result.geometries).sort()).toEqual(["a", "b", "left", "right", "shared"]);
    expect(containsCenter(result.geometries.left!, result.geometries.shared!)).toBe(true);
    expect(containsCenter(result.geometries.right!, result.geometries.shared!)).toBe(true);
    expect(result.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
  });

  test("preserves user region geometry and only diagnoses an empty intersection", async () => {
    const adapter = new ElkLayeredLayoutAdapter("urn:test:manual-regions", "LR", {
      engine: { layout: vi.fn<ElkLayoutEngine["layout"]>() },
    });
    const left = {
      ...element("left", "region"),
      pinned: true,
      placement: "user" as const,
      geometry: { x: 10, y: 10, width: 180, height: 140 },
    };
    const right = {
      ...element("right", "region"),
      pinned: true,
      placement: "user" as const,
      geometry: { x: 500, y: 10, width: 180, height: 140 },
    };
    const shared = {
      ...element("shared"),
      pinned: true,
      placement: "user" as const,
      geometry: { x: 40, y: 40, width: 100, height: 60 },
    };
    const layoutRequest = request([left, right, shared], [], "urn:test:manual-regions");
    layoutRequest.scene.memberships = [
      membership("left-shared", "left", "shared"),
      membership("right-shared", "right", "shared"),
    ];

    const result = await layoutProjectedScene(
      layoutRequest,
      new LayoutAdapterRegistry([adapter]),
    );

    expect(result.geometries.left).toEqual(left.geometry);
    expect(result.geometries.right).toEqual(right.geometry);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: "region-membership-intersection-empty",
      severity: "warning",
    }));
    expect(result.diagnostics.some((item) => item.code === "layout-result-invalid")).toBe(false);
  });

  test("diagnoses invalid engine output and still passes Core result validation", async () => {
    const adapter = new ElkLayeredLayoutAdapter("urn:test:invalid-output", "LR", {
      engine: {
        layout: async (graph) => ({ id: graph.id, children: [] }),
      },
    });
    const layoutRequest = request(
      [element("a"), element("b")],
      [edge("edge", "a", "b")],
      "urn:test:invalid-output",
    );
    const result = await layoutProjectedScene(
      layoutRequest,
      new LayoutAdapterRegistry([adapter]),
    );

    expect(Object.keys(result.geometries).sort()).toEqual(["a", "b"]);
    expect(result.routes.edge!.length).toBeGreaterThanOrEqual(2);
    expect(result.diagnostics.some((item) => item.code === "elk-output-invalid")).toBe(true);
    expect(result.diagnostics.some((item) => item.code === "layout-result-invalid")).toBe(false);
  });

  test("diagnoses engine exceptions and returns complete fallback geometry", async () => {
    const adapter = new ElkLayeredLayoutAdapter("urn:test:exception", "TB", {
      engineFactory: {
        create: () => ({
          layout: async () => {
            throw new Error("worker terminated");
          },
        }),
      },
    });
    const result = await adapter.layout(request(
      [element("a"), element("b")],
      [edge("edge", "a", "b")],
      "urn:test:exception",
    ));

    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: "elk-engine-failed",
      message: "worker terminated",
    }));
    expect(result.geometries.a).toBeDefined();
    expect(result.geometries.b).toBeDefined();
    expect(result.routes.edge).toBeDefined();
  });

  test("runs a bounded smoke layout with the bundled ELK engine", async () => {
    const adapter = new ElkLayeredLayoutAdapter(ELK_LAYOUT_REFS.layeredTb, "TB");
    const result = await adapter.layout(request(
      [
        element("lane", "container", undefined, { width: 360, height: 180 }),
        element("start", "node", "lane"),
        element("finish"),
      ],
      [edge("flow", "start", "finish")],
      ELK_LAYOUT_REFS.layeredTb,
    ));

    expect(result.geometries.lane).toBeDefined();
    expect(result.geometries.start).toBeDefined();
    expect(result.geometries.finish).toBeDefined();
    expect(result.routes.flow!.length).toBeGreaterThanOrEqual(2);
    expect(result.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
  }, 5_000);
});

function request(
  elements: LayoutElement[],
  edges: LayoutEdge[],
  layoutRef: string = ELK_LAYOUT_REFS.layeredLr,
): LayoutRequest {
  return {
    layoutRef,
    scene: { elements, edges },
  };
}

function element(
  elementId: string,
  structuralKind: LayoutElement["structuralKind"] = "node",
  parentElementId?: string,
  size?: { width: number; height: number },
): LayoutElement {
  return {
    elementId,
    structuralKind,
    ...(parentElementId ? { parentElementId } : {}),
    ...(size ? { size } : {}),
    placement: "generated",
  };
}

function edge(elementId: string, sourceElementId: string, targetElementId: string): LayoutEdge {
  return {
    elementId,
    sourceElementId,
    targetElementId,
    routingPlacement: "generated",
  };
}

function membership(semanticRef: string, regionElementId: string, memberElementId: string) {
  return {
    semanticRef,
    containerElementId: regionElementId,
    regionElementId,
    memberElementId,
  };
}

function containsCenter(
  outer: { x: number; y: number; width: number; height: number },
  inner: { x: number; y: number; width: number; height: number },
): boolean {
  const x = inner.x + inner.width / 2;
  const y = inner.y + inner.height / 2;
  return x >= outer.x && x <= outer.x + outer.width
    && y >= outer.y && y <= outer.y + outer.height;
}

function fakeLayout(
  input: ElkGraphNode,
  edgeSection: (edge: ElkGraphEdge, index: number) => ElkGraphEdge["sections"] = (_, index) =>
    section(index * 20),
): ElkGraphNode {
  const graph = structuredClone(input);
  positionChildren(graph.children ?? []);
  graph.edges = (graph.edges ?? []).map((item, index) => ({
    ...item,
    sections: edgeSection(item, index),
  }));
  return graph;
}

function positionChildren(children: ElkGraphNode[]): void {
  children.forEach((child, index) => {
    child.x = 20 + index * 260;
    child.y = 30 + index * 130;
    child.width ??= 160;
    child.height ??= 72;
    positionChildren(child.children ?? []);
  });
}

function section(offset: number): ElkGraphEdge["sections"] {
  return [{
    id: `section-${offset}`,
    startPoint: { x: 100, y: 80 + offset },
    bendPoints: [{ x: 180 + offset, y: 80 + offset }, { x: 180 + offset, y: 160 }],
    endPoint: { x: 300, y: 160 },
  }];
}
