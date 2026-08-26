import { describe, expect, it } from "vitest";

import type { DiagramCatalog, IriographDocument } from "./model";
import { applySemanticSource } from "./document";
import { parseIriographSemanticSource, projectIriographDocument } from "./projection";

const NS = "urn:test:";

const catalog: DiagramCatalog = {
  catalogId: "test",
  catalogVersion: "1",
  profileRef: "urn:test:profile:1",
  defaults: {
    nodeTemplateRef: "node",
    edgeTemplateRef: "edge",
    layoutRef: "layout",
  },
  nodeRules: [
    { ruleId: "task", rdfType: `${NS}Task`, structuralKind: "node", templateRef: "node" },
    { ruleId: "lane", rdfType: `${NS}Lane`, structuralKind: "container", templateRef: "container" },
  ],
  relationRules: [
    {
      ruleId: "flow",
      rdfType: `${NS}Flow`,
      sourcePath: `${NS}from`,
      targetPath: `${NS}to`,
      templateRef: "edge",
    },
  ],
  containmentRules: [
    { ruleId: "membership", predicate: `${NS}in`, child: "subject", parent: "object" },
  ],
  templates: {
    node: {
      templateRef: "node",
      structuralKind: "node",
      shape: "rounded-rectangle",
      style: { fill: "white", stroke: "black", text: "black" },
    },
    edge: {
      templateRef: "edge",
      structuralKind: "edge",
      style: { fill: "none", stroke: "black", text: "black" },
    },
    container: {
      templateRef: "container",
      structuralKind: "container",
      headerPosition: "left",
      style: { fill: "white", stroke: "black", text: "black" },
    },
  },
  assets: {},
};

const document: IriographDocument = {
  schemaVersion: "1",
  kind: "iriograph.document",
  documentId: "test",
  semantic: {
    format: "text/turtle",
    baseIri: NS,
    source: `
      @prefix t: <urn:test:> .
      @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
      t:lane a t:Lane ; rdfs:label "Lane" .
      t:a a t:Task ; rdfs:label "A" ; t:in t:lane ; t:dependsOn t:b .
      t:b a t:Task ; rdfs:label "B" ; t:in t:lane .
      t:flow a t:Flow ; t:from t:a ; t:to t:b .
    `,
  },
  views: [{
    viewId: "main",
    kind: "node-link",
    profileRef: catalog.profileRef,
    layoutRef: catalog.defaults.layoutRef,
    overlay: {
      a: {
        semanticRef: `${NS}a`,
        geometry: { x: 10, y: 20, width: 100, height: 50 },
        pinned: true,
        placement: "user",
      },
    },
  }],
};

describe("projectIriographDocument", () => {
  it("file locator/documentIdに依存せずbaseと外部prefixから同じexpanded IRIを得る", () => {
    const source = `
      @prefix local: <urn:portable:resource:> .
      @prefix schema: <https://schema.org/> .
      local:r1 schema:name "注文"@ja .
      <relative> schema:isPartOf local:r1 .
    `;
    const first = {
      ...document,
      documentId: "before-rename",
      semantic: { ...document.semantic, baseIri: "urn:portable:base:", source },
    };
    const renamed = { ...first, documentId: "after-rename" };

    const expanded = (candidate: IriographDocument) => parseIriographSemanticSource(candidate)
      .map((quad) => [quad.subject.value, quad.predicate.value, quad.object.value]);

    expect(expanded(first)).toEqual(expanded(renamed));
    expect(expanded(first)).toEqual([
      ["urn:portable:resource:r1", "https://schema.org/name", "注文"],
      ["urn:portable:base:relative", "https://schema.org/isPartOf", "urn:portable:resource:r1"],
    ]);
  });

  it("catalog relation、containment、未登録predicate fallbackを同じSceneへ投影する", () => {
    const scene = projectIriographDocument(document, catalog);

    expect(scene.nodes).toHaveLength(2);
    expect(scene.containers).toHaveLength(1);
    expect(scene.edges).toHaveLength(2);
    expect(scene.edges.some((edge) => edge.projectionRuleId === "flow" && !edge.fallback)).toBe(true);
    expect(scene.edges.some((edge) => edge.label === "dependsOn" && edge.fallback)).toBe(true);
    expect(scene.nodes.find((node) => node.semanticRef === `${NS}a`)).toMatchObject({
      elementId: "a",
      parentElementId: expect.any(String),
      geometry: { x: 10, y: 20, width: 100, height: 50 },
      placement: "user",
    });
  });

  it("Turtle変更後も存続IRIのoverlayを維持し、新規IRIへgeometryを補完する", () => {
    const result = applySemanticSource(
      document,
      `${document.semantic.source}\n t:c a t:Task ; rdfs:label "C" ; t:in t:lane .`,
      catalog,
    );

    expect(result.accepted).toBe(true);
    expect(result.document.views[0]?.overlay.a).toMatchObject({
      semanticRef: `${NS}a`,
      geometry: { x: 10, y: 20, width: 100, height: 50 },
      placement: "user",
    });
    expect(Object.values(result.document.views[0]?.overlay ?? {})).toContainEqual(
      expect.objectContaining({
        semanticRef: `${NS}c`,
        geometry: expect.any(Object),
        placement: "generated",
      }),
    );
  });

  it("壊れたTurtleを正本へ適用しない", () => {
    const result = applySemanticSource(document, "@prefix broken", catalog);

    expect(result.accepted).toBe(false);
    expect(result.document.semantic.source).toBe(document.semantic.source);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ severity: "error", code: "invalid-turtle" }),
    );
  });
});
