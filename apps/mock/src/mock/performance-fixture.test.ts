import { projectSemanticView, standardRdfRdfsCatalog } from "@iriograph/core";
import { describe, expect, it } from "vitest";

import {
  createMockPerformanceDocument,
  MOCK_PERFORMANCE_SCALE,
} from "./performance-fixture";

describe("browser performance fixture", () => {
  it("is deterministic and keeps the normal-scale cardinality fixed", () => {
    const first = createMockPerformanceDocument();
    const second = createMockPerformanceDocument();
    expect(first).toEqual(second);

    const scene = projectSemanticView(first, standardRdfRdfsCatalog);
    expect(scene.nodes).toHaveLength(MOCK_PERFORMANCE_SCALE.nodes);
    expect(scene.edges).toHaveLength(MOCK_PERFORMANCE_SCALE.edges);
    expect(scene.containers).toHaveLength(
      MOCK_PERFORMANCE_SCALE.nodes / MOCK_PERFORMANCE_SCALE.containerSize,
    );
    expect(scene.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
  });
});
