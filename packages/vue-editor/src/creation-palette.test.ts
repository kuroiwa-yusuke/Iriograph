import { describe, expect, it } from "vitest";

import type { ProjectionCatalogV1 } from "@iriograph/core";

import { catalogCreationPalette } from "./creation-palette";

describe("catalogCreationPalette", () => {
  it("catalog resource ruleとprofile labelだけからnode/region cardを作る", () => {
    const catalog = {
      schemaVersion: "1",
      kind: "iriograph.catalog",
      catalogId: "urn:catalog",
      catalogVersion: "1",
      profileRef: "urn:profile",
      defaults: {
        nodeTemplateRef: "urn:template:node",
        edgeTemplateRef: "urn:template:edge",
        regionTemplateRef: "urn:template:region",
        layoutRef: "urn:layout",
      },
      rules: [
        { ruleId: "region", priority: 1, match: { kind: "type", iri: "urn:type:area", entailment: "exact" }, project: { operator: "membership-container", membershipPredicate: "http://www.w3.org/1999/02/22-rdf-syntax-ns#member" }, templateRef: "urn:template:region" },
        { ruleId: "node", priority: 1, match: { kind: "type", iri: "urn:type:item", entailment: "exact" }, project: { operator: "resource", structuralKind: "node" }, templateRef: "urn:template:node" },
      ],
      templates: {
        "urn:template:node": { templateRef: "urn:template:node", structuralKind: "node", shape: "circle", style: { fill: "#fff", stroke: "#000", text: "#000" } },
        "urn:template:region": { templateRef: "urn:template:region", structuralKind: "region", style: { fill: "#eee", stroke: "#111", text: "#111", fillOpacity: .3 } },
        "urn:template:edge": { templateRef: "urn:template:edge", structuralKind: "edge", style: { fill: "none", stroke: "#000", text: "#000" } },
      },
      assets: {},
    } satisfies ProjectionCatalogV1;

    expect(catalogCreationPalette(catalog, [
      { iri: "urn:type:item", kind: "class", label: "Item" },
      { iri: "urn:type:area", kind: "class", label: "Area" },
    ], "region")).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "node", label: "Item", shape: "circle" }),
      expect.objectContaining({ kind: "region", label: "Area", shape: "region", structuralKind: "region" }),
      expect.objectContaining({ kind: "node", label: "基本の要素", classIri: undefined }),
    ]));
  });
});
