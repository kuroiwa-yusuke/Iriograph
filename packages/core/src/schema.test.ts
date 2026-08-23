import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  IriographSchemaValidationError,
  iriographDocumentSchema,
  parseIriographDocumentV1,
  parseProjectionCatalogV1,
  projectionCatalogSchema,
  validateIriographDocumentV1,
  validateProjectionCatalogV1,
} from "./schema";
import { standardRdfRdfsCatalog } from "./standard-catalog";

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));
}

describe("Iriograph document v1 schema", () => {
  it("publishes a JSON Schema 2020-12 contract and accepts a closed v1 document", () => {
    expect(iriographDocumentSchema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    const source = fixture("document.valid.json");

    const result = validateIriographDocumentV1(source);

    expect(result).toMatchObject({ valid: true, value: source, issues: [] });
    expect(parseIriographDocumentV1(source).semantic.authoringProfileRef).toBe(
      "urn:example:authoring-profile:purchase@1",
    );
  });

  it("keeps sparse routing overlays, including endpoint anchors, in schema version 1", () => {
    const source = structuredClone(fixture("document.valid.json")) as {
      schemaVersion: string;
      views: Array<{ overlay: Record<string, unknown> }>;
    };
    source.views[0]!.overlay.edge = {
      semanticRef: "urn:iriograph:semantic-ref:v1:statement:test",
      routing: {
        routeMode: "curve",
        waypoints: [],
        labelOffset: { x: 6, y: -4 },
        sourceAnchor: { position: 0 },
        targetAnchor: { position: .75 },
      },
      appearance: { labelPlacement: "bottom" },
    };

    expect(source.schemaVersion).toBe("1");
    expect(validateIriographDocumentV1(source)).toMatchObject({ valid: true, value: source });
  });

  it("accepts region views and safe sparse style overrides while rejecting CSS injection", () => {
    const source = structuredClone(fixture("document.valid.json")) as {
      views: Array<{ kind: string; overlay: Record<string, unknown> }>;
    };
    source.views[0]!.kind = "region";
    source.views[0]!.overlay.region = {
      semanticRef: "urn:test:region",
      appearance: {
        styleRef: "urn:test:style:calm",
        style: { fill: "#abcdef80", fillOpacity: 0.25, strokeWidth: 3, dash: "6 4" },
      },
    };
    expect(validateIriographDocumentV1(source).valid).toBe(true);

    (source.views[0]!.overlay.region as { appearance: { style: { fill: string } } })
      .appearance.style.fill = "url(javascript:alert(1))";
    const unsafe = validateIriographDocumentV1(source);
    expect(unsafe.valid).toBe(false);
    if (!unsafe.valid) expect(unsafe.issues).toContainEqual(expect.objectContaining({
      instancePath: "/views/0/overlay/region/appearance/style/fill",
      keyword: "pattern",
    }));
  });

  it.each([-0.01, 1, Number.POSITIVE_INFINITY])(
    "rejects invalid endpoint anchor position %s",
    (position) => {
      const source = structuredClone(fixture("document.valid.json")) as {
        views: Array<{ overlay: Record<string, unknown> }>;
      };
      source.views[0]!.overlay.edge = {
        semanticRef: "urn:iriograph:semantic-ref:v1:statement:test",
        routing: { sourceAnchor: { position } },
      };

      const result = validateIriographDocumentV1(source);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.issues).toContainEqual(expect.objectContaining({
          instancePath: "/views/0/overlay/edge/routing/sourceAnchor/position",
        }));
      }
    },
  );

  it("requires authoringProfileRef", () => {
    const result = validateIriographDocumentV1(fixture("document.invalid-missing-profile.json"));

    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.issues).toContainEqual(expect.objectContaining({
      instancePath: "/semantic",
      keyword: "required",
      params: expect.objectContaining({ missingProperty: "authoringProfileRef" }),
    }));
  });

  it("rejects unknown fields, invalid IRIs/locales, and duplicate nonempty viewId values", () => {
    const result = validateIriographDocumentV1(fixture("document.invalid-closed-fields.json"));

    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ instancePath: "/semantic", keyword: "additionalProperties" }),
      expect.objectContaining({ instancePath: "/semantic/baseIri", keyword: "format" }),
      expect.objectContaining({ instancePath: "/views/0/locale", keyword: "format" }),
    ]));
  });

  it("accepts extension values only under absolute IRI keys", () => {
    const result = validateIriographDocumentV1(fixture("document.invalid-extension-key.json"));

    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.issues).toContainEqual(expect.objectContaining({
      instancePath: "/extensions",
      keyword: "propertyNames",
    }));
  });

  it("enforces unique, nonempty view IDs after structural validation", () => {
    const duplicate = structuredClone(fixture("document.valid.json")) as Record<string, unknown>;
    const views = duplicate.views as Array<Record<string, unknown>>;
    views.push({ ...views[0] });
    const duplicateResult = validateIriographDocumentV1(duplicate);
    expect(duplicateResult.valid).toBe(false);
    if (!duplicateResult.valid) {
      expect(duplicateResult.issues).toContainEqual(expect.objectContaining({
        instancePath: "/views/1/viewId",
        keyword: "unique",
      }));
    }

    views[1]!.viewId = "";
    const emptyResult = validateIriographDocumentV1(duplicate);
    expect(emptyResult.valid).toBe(false);
    if (!emptyResult.valid) {
      expect(emptyResult.issues).toContainEqual(expect.objectContaining({
        instancePath: "/views/1/viewId",
        keyword: "minLength",
      }));
    }
  });
});

describe("normalized projection catalog v1 schema", () => {
  it("publishes a JSON Schema 2020-12 contract and accepts every v1 operator shape", () => {
    expect(projectionCatalogSchema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    const source = fixture("catalog.valid.json");

    expect(validateProjectionCatalogV1(source)).toMatchObject({
      valid: true,
      value: source,
      issues: [],
    });
    expect(parseProjectionCatalogV1(source).rules).toHaveLength(8);
  });

  it("accepts IRI-keyed style presets and a region default template", () => {
    const result = validateProjectionCatalogV1(standardRdfRdfsCatalog);
    expect(result).toMatchObject({ valid: true });
    expect(standardRdfRdfsCatalog.defaults?.regionTemplateRef).toBe(
      "urn:iriograph:template:region:overlap:1",
    );
  });

  it("accepts JPEG catalog assets", () => {
    const source = structuredClone(fixture("catalog.valid.json")) as {
      assets: Record<string, { mediaType: string }>;
    };
    const asset = Object.values(source.assets)[0]!;
    asset.mediaType = "image/jpeg";

    expect(validateProjectionCatalogV1(source)).toMatchObject({ valid: true });
  });

  it("accepts the standard RDF/RDFS catalog with the default edge template for ordinal sequences", () => {
    const sequenceRule = standardRdfRdfsCatalog.rules.find(
      (rule) => rule.project.operator === "ordinal-sequence",
    );

    expect(sequenceRule?.templateRef).toBeUndefined();
    expect(validateProjectionCatalogV1(standardRdfRdfsCatalog)).toMatchObject({
      valid: true,
      value: standardRdfRdfsCatalog,
      issues: [],
    });
  });

  it("accepts only closed renderer-safe edge terminal markers", () => {
    const source = structuredClone(standardRdfRdfsCatalog);
    const edge = source.templates[source.defaults!.edgeTemplateRef]!;
    edge.sourceMarker = "circle";
    edge.targetMarker = "arrow";
    expect(validateProjectionCatalogV1(source).valid).toBe(true);

    (edge as { targetMarker?: string }).targetMarker = "url(javascript:alert(1))";
    expect(validateProjectionCatalogV1(source).valid).toBe(false);
  });

  it("accepts an appearance-only template and asset library without rules or defaults", () => {
    const source = structuredClone(fixture("catalog.valid.json")) as Record<string, unknown>;
    source.rules = [];
    delete source.defaults;

    expect(validateProjectionCatalogV1(source)).toMatchObject({
      valid: true,
      value: source,
      issues: [],
    });
  });

  it("rejects parameters belonging to another projection operator", () => {
    const result = validateProjectionCatalogV1(fixture("catalog.invalid-operator.json"));

    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ keyword: "required" }),
      expect.objectContaining({ keyword: "additionalProperties" }),
      expect.objectContaining({ keyword: "oneOf" }),
    ]));
  });

  it("rejects unsupported versions, invalid IRIs, prototype fields, and empty template collections", () => {
    const source = fixture("catalog.invalid-version-and-field.json");
    const result = validateProjectionCatalogV1(source);

    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ instancePath: "", keyword: "additionalProperties" }),
      expect.objectContaining({ instancePath: "/schemaVersion", keyword: "const" }),
      expect.objectContaining({ instancePath: "/catalogVersion", keyword: "minLength" }),
      expect.objectContaining({ instancePath: "/catalogId", keyword: "format" }),
      expect.objectContaining({ instancePath: "/templates", keyword: "minProperties" }),
    ]));
  });

  it("checks unique rules, entailment compatibility, map identity, and cross references", () => {
    const result = validateProjectionCatalogV1(fixture("catalog.invalid-runtime.json"));

    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ instancePath: "/rules/1/ruleId", keyword: "unique" }),
      expect.objectContaining({ instancePath: "/rules/0/match/entailment", keyword: "entailment" }),
      expect.objectContaining({ instancePath: "/rules/0/templateRef", keyword: "catalog-reference" }),
      expect.objectContaining({ keyword: "map-key" }),
    ]));
  });

  it("throws a typed error from parsing boundaries", () => {
    expect(() => parseProjectionCatalogV1(fixture("catalog.invalid-operator.json"))).toThrow(
      IriographSchemaValidationError,
    );
  });
});
