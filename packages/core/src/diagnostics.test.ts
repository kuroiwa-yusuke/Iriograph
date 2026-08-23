import { describe, expect, it } from "vitest";

import { diagnosticTargetsSceneElement, sortDiagnostics } from "./diagnostics";
import type { ProjectionDiagnostic, SceneNode } from "./model";

describe("diagnostic Scene targeting", () => {
  const element: SceneNode = {
    elementId: "node-a",
    semanticRef: "urn:test:a",
    structuralKind: "node",
    label: "A",
    templateRef: "urn:test:template",
    shape: "rectangle",
    geometry: { x: 0, y: 0, width: 100, height: 60 },
    style: { fill: "white", stroke: "black", text: "black" },
    pinned: false,
    placement: "generated",
    provenance: {
      sourceStatementRefs: ["urn:test:statement:resource"],
      operator: "resource",
      derivation: "resource",
    },
    parentProvenance: {
      sourceStatementRefs: ["urn:test:statement:membership"],
      operator: "membership-container",
      derivation: "derived",
    },
  };

  it.each([
    [{ semanticRef: "urn:test:a" }, true],
    [{ statementRef: "urn:test:statement:resource" }, true],
    [{ statementRef: "urn:test:statement:membership" }, true],
    [{ statementRef: "urn:test:statement:other" }, false],
  ])("semantic/provenance identityを照合する", (references, expected) => {
    const diagnostic: ProjectionDiagnostic = {
      severity: "error",
      category: "domain",
      code: "test",
      message: "test",
      ...references,
    };
    expect(diagnosticTargetsSceneElement(diagnostic, element)).toBe(expected);
  });

  it("同じ表示内容のdomain diagnosticをstable IDで決定的に並べる", () => {
    const common = {
      severity: "warning" as const,
      category: "domain" as const,
      code: "test",
      message: "same",
      semanticRef: "urn:test:a",
    };
    expect(sortDiagnostics([
      { ...common, diagnosticId: "urn:test:diagnostic:z" },
      { ...common, diagnosticId: "urn:test:diagnostic:a" },
    ]).map((diagnostic) => diagnostic.diagnosticId)).toEqual([
      "urn:test:diagnostic:a",
      "urn:test:diagnostic:z",
    ]);
  });
});
