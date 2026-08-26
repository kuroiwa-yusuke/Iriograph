import Ajv2020, { type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";

import type {
  IriographDocumentV1,
  ProjectionCatalogV1,
} from "./model.js";

export type RuntimeValidationIssue = {
  instancePath: string;
  schemaPath: string;
  keyword: string;
  message: string;
  params: Record<string, unknown>;
};

export type RuntimeValidationResult<T> =
  | { valid: true; value: T; issues: [] }
  | { valid: false; issues: RuntimeValidationIssue[] };

export class IriographSchemaValidationError extends Error {
  readonly issues: RuntimeValidationIssue[];

  constructor(subject: string, issues: RuntimeValidationIssue[]) {
    super(`${subject} is invalid: ${issues.map(formatIssue).join("; ")}`);
    this.name = "IriographSchemaValidationError";
    this.issues = issues;
  }
}

const extensionProperty = { $ref: "#/$defs/extensions" } as const;

const sharedDefinitions = {
  jsonValue: {
    oneOf: [
      { type: "null" },
      { type: "boolean" },
      { type: "number" },
      { type: "string" },
      {
        type: "array",
        items: { $ref: "#/$defs/jsonValue" },
      },
      {
        type: "object",
        additionalProperties: { $ref: "#/$defs/jsonValue" },
      },
    ],
  },
  extensions: {
    type: "object",
    propertyNames: {
      type: "string",
      format: "iri",
    },
    additionalProperties: { $ref: "#/$defs/jsonValue" },
  },
} as const;

/** JSON Schema 2020-12 for the portable `.iriograph` v1 document. */
export const iriographDocumentSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "urn:iriograph:schema:document:1",
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "kind", "documentId", "semantic", "views"],
  properties: {
    schemaVersion: { const: "1" },
    kind: { const: "iriograph.document" },
    documentId: { type: "string", minLength: 1 },
    semantic: { $ref: "#/$defs/semantic" },
    imports: {
      type: "array",
      items: { $ref: "#/$defs/catalogImport" },
    },
    views: {
      type: "array",
      minItems: 1,
      items: { $ref: "#/$defs/view" },
    },
    extensions: extensionProperty,
  },
  $defs: {
    ...sharedDefinitions,
    semantic: {
      type: "object",
      additionalProperties: false,
      required: ["format", "baseIri", "authoringProfileRef", "source"],
      properties: {
        format: { const: "text/turtle" },
        baseIri: { type: "string", format: "iri" },
        authoringProfileRef: { type: "string", format: "iri" },
        source: { type: "string" },
        extensions: extensionProperty,
      },
    },
    catalogImport: {
      type: "object",
      additionalProperties: false,
      required: ["catalogRef"],
      properties: {
        catalogRef: { type: "string", format: "iri" },
        integrity: { type: "string", minLength: 1 },
        extensions: extensionProperty,
      },
    },
    view: {
      type: "object",
      additionalProperties: false,
      required: ["viewId", "kind", "profileRef", "layoutRef", "overlay"],
      properties: {
        viewId: { type: "string", minLength: 1 },
        kind: { enum: ["node-link", "region"] },
        profileRef: { type: "string", format: "iri" },
        layoutRef: { type: "string", format: "iri" },
        locale: { type: "string", format: "language-tag" },
        overlay: {
          type: "object",
          propertyNames: { type: "string", minLength: 1 },
          additionalProperties: { $ref: "#/$defs/overlay" },
        },
        extensions: extensionProperty,
      },
    },
    overlay: {
      type: "object",
      additionalProperties: false,
      required: ["semanticRef"],
      properties: {
        semanticRef: { type: "string", minLength: 1 },
        geometry: { $ref: "#/$defs/geometry" },
        pinned: { type: "boolean" },
        placement: { enum: ["generated", "user"] },
        appearance: { $ref: "#/$defs/appearance" },
        routing: { $ref: "#/$defs/routing" },
        extensions: extensionProperty,
      },
    },
    geometry: {
      type: "object",
      additionalProperties: false,
      required: ["x", "y", "width", "height"],
      properties: {
        x: { type: "number" },
        y: { type: "number" },
        width: { type: "number", exclusiveMinimum: 0 },
        height: { type: "number", exclusiveMinimum: 0 },
        extensions: extensionProperty,
      },
    },
    point: {
      type: "object",
      additionalProperties: false,
      required: ["x", "y"],
      properties: {
        x: { type: "number" },
        y: { type: "number" },
        extensions: extensionProperty,
      },
    },
    curveKnot: {
      type: "object",
      additionalProperties: false,
      required: ["point"],
      properties: {
        point: { $ref: "#/$defs/point" },
        incomingHandle: { $ref: "#/$defs/point" },
        outgoingHandle: { $ref: "#/$defs/point" },
        extensions: extensionProperty,
      },
    },
    curveRouting: {
      type: "object",
      additionalProperties: false,
      minProperties: 1,
      properties: {
        sourceHandle: { $ref: "#/$defs/point" },
        targetHandle: { $ref: "#/$defs/point" },
        knots: {
          type: "array",
          minItems: 1,
          maxItems: 64,
          items: { $ref: "#/$defs/curveKnot" },
        },
        extensions: extensionProperty,
      },
    },
    styleOverride: {
      type: "object",
      additionalProperties: false,
      minProperties: 1,
      properties: {
        fill: { $ref: "#/$defs/color" },
        stroke: { $ref: "#/$defs/color" },
        text: { $ref: "#/$defs/color" },
        accent: { $ref: "#/$defs/color" },
        fillOpacity: { type: "number", minimum: 0, maximum: 1 },
        strokeWidth: { type: "number", minimum: 0, maximum: 20 },
        labelFontSize: { type: "number", minimum: 8, maximum: 72 },
        dash: { $ref: "#/$defs/dash" },
        extensions: extensionProperty,
      },
    },
    color: {
      type: "string",
      pattern: "^(?:none|transparent|black|silver|gray|white|maroon|red|purple|fuchsia|green|lime|olive|yellow|navy|blue|teal|aqua|#[0-9A-Fa-f]{3,4}|#[0-9A-Fa-f]{6}|#[0-9A-Fa-f]{8})$",
    },
    dash: {
      type: "string",
      maxLength: 64,
      pattern: "^(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?(?:[ ,]+(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?)*$",
    },
    appearance: {
      type: "object",
      additionalProperties: false,
      allOf: [{
        not: {
          required: ["nodeIconScale", "nodeIconSize"],
          properties: {
            nodeIconScale: {},
            nodeIconSize: {},
          },
        },
      }],
      properties: {
        templateRef: { type: "string", format: "iri" },
        iconRef: { type: "string", format: "iri" },
        styleRef: { type: "string", format: "iri" },
        style: { $ref: "#/$defs/styleOverride" },
        styleToken: { type: "string", minLength: 1 },
        labelPlacement: { enum: ["top", "right", "bottom", "left", "center"] },
        nodeLabelOffset: { $ref: "#/$defs/point" },
        nodeLabelWritingDirection: { enum: ["horizontal-right", "vertical-down"] },
        nodeIconOffset: { $ref: "#/$defs/point" },
        nodeIconScale: { type: "number", minimum: 0.1, maximum: 8 },
        nodeIconSize: {
          type: "object",
          additionalProperties: false,
          required: ["width", "height"],
          properties: {
            width: { type: "number", minimum: 4, maximum: 4096 },
            height: { type: "number", minimum: 4, maximum: 4096 },
          },
        },
        nodeIconFit: { enum: ["contain", "cover"] },
        groupLabelAnchor: { type: "number", minimum: 0, exclusiveMaximum: 1 },
        groupLabelWritingDirection: { enum: ["horizontal-right", "vertical-down"] },
        groupZOrder: {
          type: "integer",
          minimum: -9007199254740991,
          maximum: 9007199254740991,
        },
        regionLabelAnchor: { type: "number", minimum: 0, exclusiveMaximum: 1 },
        regionLabelWritingDirection: { enum: ["horizontal-right", "vertical-down"] },
        regionZOrder: {
          type: "integer",
          minimum: -9007199254740991,
          maximum: 9007199254740991,
        },
        edgeCaption: { type: "string", maxLength: 2000 },
        extensions: extensionProperty,
      },
    },
    routing: {
      type: "object",
      additionalProperties: false,
      allOf: [{
        if: {
          required: ["routeMode"],
          properties: { routeMode: { const: "straight" } },
        },
        then: { properties: { waypoints: false, curve: false } },
      }, {
        if: { required: ["curve"] },
        then: {
          required: ["routeMode"],
          properties: { routeMode: { const: "curve" }, waypoints: false },
        },
      }, {
        if: {
          required: ["routeMode"],
          properties: { routeMode: { const: "curve" } },
        },
        then: { properties: { waypoints: false } },
      }],
      properties: {
        routeMode: { enum: ["auto", "straight", "orthogonal", "curve", "manual"] },
        waypoints: {
          type: "array",
          items: { $ref: "#/$defs/point" },
        },
        curve: { $ref: "#/$defs/curveRouting" },
        labelOffset: { $ref: "#/$defs/point" },
        sourceAnchor: { $ref: "#/$defs/endpointAnchor" },
        targetAnchor: { $ref: "#/$defs/endpointAnchor" },
        sourceMarker: { enum: ["none", "arrow", "open-arrow", "triangle", "diamond", "circle"] },
        targetMarker: { enum: ["none", "arrow", "open-arrow", "triangle", "diamond", "circle"] },
        extensions: extensionProperty,
      },
    },
    endpointAnchor: {
      type: "object",
      additionalProperties: false,
      required: ["position"],
      properties: {
        position: { type: "number", minimum: 0, exclusiveMaximum: 1 },
      },
    },
  },
} as const;

/** JSON Schema 2020-12 for the normalized projection catalog v1. */
export const projectionCatalogSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "urn:iriograph:schema:catalog:1",
  type: "object",
  additionalProperties: false,
  required: [
    "schemaVersion",
    "kind",
    "catalogId",
    "catalogVersion",
    "profileRef",
    "rules",
    "templates",
    "assets",
  ],
  properties: {
    schemaVersion: { const: "1" },
    kind: { const: "iriograph.catalog" },
    catalogId: { type: "string", format: "iri" },
    catalogVersion: { type: "string", minLength: 1 },
    profileRef: { type: "string", format: "iri" },
    rules: {
      type: "array",
      items: { $ref: "#/$defs/rule" },
    },
    templates: {
      type: "object",
      minProperties: 1,
      propertyNames: { type: "string", format: "iri" },
      additionalProperties: { $ref: "#/$defs/template" },
    },
    styles: {
      type: "object",
      propertyNames: { type: "string", format: "iri" },
      additionalProperties: { $ref: "#/$defs/styleOverride" },
    },
    assets: {
      type: "object",
      propertyNames: { type: "string", format: "iri" },
      additionalProperties: { $ref: "#/$defs/asset" },
    },
    defaults: { $ref: "#/$defs/defaults" },
    extensions: extensionProperty,
  },
  $defs: {
    ...sharedDefinitions,
    rule: {
      type: "object",
      additionalProperties: false,
      required: ["ruleId", "priority", "match", "project"],
      properties: {
        ruleId: { type: "string", minLength: 1 },
        priority: { type: "integer" },
        match: { $ref: "#/$defs/match" },
        project: { $ref: "#/$defs/project" },
        templateRef: { type: "string", format: "iri" },
        extensions: extensionProperty,
      },
    },
    match: {
      oneOf: [
        {
          type: "object",
          additionalProperties: false,
          required: ["kind", "iri", "entailment"],
          properties: {
            kind: { enum: ["type", "predicate"] },
            iri: { type: "string", format: "iri" },
            entailment: { enum: ["exact", "rdfs-subclass", "rdfs-subproperty"] },
            extensions: extensionProperty,
          },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["kind"],
          properties: {
            kind: { const: "any-iri-object" },
            extensions: extensionProperty,
          },
        },
      ],
    },
    project: {
      oneOf: [
        {
          type: "object",
          additionalProperties: false,
          required: ["operator", "structuralKind"],
          properties: {
            operator: { const: "resource" },
            structuralKind: { enum: ["node", "container"] },
            extensions: extensionProperty,
          },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["operator"],
          properties: {
            operator: { const: "direct-edge" },
            extensions: extensionProperty,
          },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["operator", "membershipPredicate"],
          properties: {
            operator: { const: "membership-container" },
            membershipPredicate: { type: "string", format: "iri" },
            extensions: extensionProperty,
          },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["operator", "membershipPredicate", "containerPosition"],
          properties: {
            operator: { const: "membership-region" },
            membershipPredicate: { type: "string", format: "iri" },
            containerPosition: { enum: ["subject", "object"] },
            extensions: extensionProperty,
          },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["operator", "ordinalPredicatePrefix"],
          properties: {
            operator: { const: "ordinal-sequence" },
            ordinalPredicatePrefix: { type: "string", format: "iri" },
            extensions: extensionProperty,
          },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["operator", "ordinalPredicatePrefix", "defaultOrdinal"],
          properties: {
            operator: { const: "alternative" },
            ordinalPredicatePrefix: { type: "string", format: "iri" },
            defaultOrdinal: { type: "integer", minimum: 1 },
            extensions: extensionProperty,
          },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["operator"],
          properties: {
            operator: { const: "suppress" },
            extensions: extensionProperty,
          },
        },
      ],
    },
    defaults: {
      type: "object",
      additionalProperties: false,
      required: ["nodeTemplateRef", "edgeTemplateRef", "layoutRef"],
      properties: {
        nodeTemplateRef: { type: "string", format: "iri" },
        edgeTemplateRef: { type: "string", format: "iri" },
        regionTemplateRef: { type: "string", format: "iri" },
        layoutRef: { type: "string", format: "iri" },
        extensions: extensionProperty,
      },
    },
    template: {
      type: "object",
      additionalProperties: false,
      required: ["templateRef", "structuralKind", "style"],
      properties: {
        templateRef: { type: "string", format: "iri" },
        structuralKind: { enum: ["node", "edge", "container", "region", "annotation"] },
        shape: { enum: ["rectangle", "rounded-rectangle", "circle", "diamond"] },
        iconRef: { type: "string", format: "iri" },
        headerPosition: { enum: ["top", "left", "none"] },
        labelPlacement: { enum: ["top", "right", "bottom", "left", "center"] },
        routeMode: { enum: ["auto", "straight", "orthogonal", "curve", "manual"] },
        sourceMarker: { $ref: "#/$defs/edgeTerminalMarker" },
        targetMarker: { $ref: "#/$defs/edgeTerminalMarker" },
        style: { $ref: "#/$defs/style" },
        defaultSize: { $ref: "#/$defs/size" },
        extensions: extensionProperty,
      },
    },
    style: {
      type: "object",
      additionalProperties: false,
      required: ["fill", "stroke", "text"],
      properties: {
        fill: { $ref: "#/$defs/color" },
        stroke: { $ref: "#/$defs/color" },
        text: { $ref: "#/$defs/color" },
        accent: { $ref: "#/$defs/color" },
        fillOpacity: { type: "number", minimum: 0, maximum: 1 },
        strokeWidth: { type: "number", minimum: 0, maximum: 20 },
        labelFontSize: { type: "number", minimum: 8, maximum: 72 },
        dash: { $ref: "#/$defs/dash" },
        extensions: extensionProperty,
      },
    },
    styleOverride: {
      type: "object",
      additionalProperties: false,
      minProperties: 1,
      properties: {
        fill: { $ref: "#/$defs/color" },
        stroke: { $ref: "#/$defs/color" },
        text: { $ref: "#/$defs/color" },
        accent: { $ref: "#/$defs/color" },
        fillOpacity: { type: "number", minimum: 0, maximum: 1 },
        strokeWidth: { type: "number", minimum: 0, maximum: 20 },
        labelFontSize: { type: "number", minimum: 8, maximum: 72 },
        dash: { $ref: "#/$defs/dash" },
        extensions: extensionProperty,
      },
    },
    color: {
      type: "string",
      pattern: "^(?:none|transparent|black|silver|gray|white|maroon|red|purple|fuchsia|green|lime|olive|yellow|navy|blue|teal|aqua|#[0-9A-Fa-f]{3,4}|#[0-9A-Fa-f]{6}|#[0-9A-Fa-f]{8})$",
    },
    dash: {
      type: "string",
      maxLength: 64,
      pattern: "^(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?(?:[ ,]+(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?)*$",
    },
    size: {
      type: "object",
      additionalProperties: false,
      required: ["width", "height"],
      properties: {
        width: { type: "number", exclusiveMinimum: 0 },
        height: { type: "number", exclusiveMinimum: 0 },
        extensions: extensionProperty,
      },
    },
    edgeTerminalMarker: {
      enum: ["none", "arrow", "open-arrow", "triangle", "diamond", "circle"],
    },
    asset: {
      type: "object",
      additionalProperties: false,
      required: ["assetRef", "mediaType", "url"],
      properties: {
        assetRef: { type: "string", format: "iri" },
        mediaType: { enum: ["image/svg+xml", "image/png", "image/jpeg", "image/webp"] },
        url: { type: "string", format: "iri" },
        extensions: extensionProperty,
      },
    },
  },
} as const;

const ajv = new Ajv2020({ allErrors: true, strict: true });
ajv.addFormat("iri", { type: "string", validate: isAbsoluteIri });
ajv.addFormat("language-tag", { type: "string", validate: isBcp47LanguageTag });

const validateDocumentSchema = ajv.compile<IriographDocumentV1>(iriographDocumentSchema);
const validateCatalogSchema = ajv.compile<ProjectionCatalogV1>(projectionCatalogSchema);

export function validateIriographDocumentV1(value: unknown): RuntimeValidationResult<IriographDocumentV1> {
  const schemaIssues = validateWith(value, validateDocumentSchema);
  if (schemaIssues.length > 0) return { valid: false, issues: schemaIssues };

  const document = value as IriographDocumentV1;
  const issues = duplicateKeyIssues(document.views, "viewId", "/views");
  return issues.length > 0
    ? { valid: false, issues }
    : { valid: true, value: document, issues: [] };
}

export function parseIriographDocumentV1(value: unknown): IriographDocumentV1 {
  const result = validateIriographDocumentV1(value);
  if (!result.valid) throw new IriographSchemaValidationError("Iriograph document", result.issues);
  return result.value;
}

export function isIriographDocumentV1(value: unknown): value is IriographDocumentV1 {
  return validateIriographDocumentV1(value).valid;
}

export function validateProjectionCatalogV1(value: unknown): RuntimeValidationResult<ProjectionCatalogV1> {
  const schemaIssues = validateWith(value, validateCatalogSchema);
  if (schemaIssues.length > 0) return { valid: false, issues: schemaIssues };

  const catalog = value as ProjectionCatalogV1;
  const issues = [
    ...duplicateKeyIssues(catalog.rules, "ruleId", "/rules"),
    ...validateRuleEntailments(catalog),
    ...validateCatalogReferences(catalog),
  ];
  return issues.length > 0
    ? { valid: false, issues }
    : { valid: true, value: catalog, issues: [] };
}

export function parseProjectionCatalogV1(value: unknown): ProjectionCatalogV1 {
  const result = validateProjectionCatalogV1(value);
  if (!result.valid) throw new IriographSchemaValidationError("Projection catalog", result.issues);
  return result.value;
}

export function isProjectionCatalogV1(value: unknown): value is ProjectionCatalogV1 {
  return validateProjectionCatalogV1(value).valid;
}

function validateWith(value: unknown, validator: ValidateFunction): RuntimeValidationIssue[] {
  return validator(value) ? [] : (validator.errors ?? []).map(fromAjvError);
}

function fromAjvError(error: ErrorObject): RuntimeValidationIssue {
  return {
    instancePath: error.instancePath,
    schemaPath: error.schemaPath,
    keyword: error.keyword,
    message: error.message ?? "schema validation failed",
    params: error.params as Record<string, unknown>,
  };
}

function duplicateKeyIssues<T extends Record<K, string>, K extends keyof T>(
  values: T[],
  key: K,
  basePath: string,
): RuntimeValidationIssue[] {
  const firstIndex = new Map<string, number>();
  const issues: RuntimeValidationIssue[] = [];
  values.forEach((value, index) => {
    const previous = firstIndex.get(value[key]);
    if (previous === undefined) {
      firstIndex.set(value[key], index);
      return;
    }
    issues.push(customIssue(
      `${basePath}/${index}/${String(key)}`,
      "unique",
      `${String(key)} must be unique; first declared at ${basePath}/${previous}/${String(key)}`,
      { duplicate: value[key], firstIndex: previous },
    ));
  });
  return issues;
}

function validateRuleEntailments(catalog: ProjectionCatalogV1): RuntimeValidationIssue[] {
  return catalog.rules.flatMap((rule, index) => {
    if (rule.match.kind === "any-iri-object" || rule.match.entailment === "exact") return [];
    const valid = rule.match.kind === "type"
      ? rule.match.entailment === "rdfs-subclass"
      : rule.match.entailment === "rdfs-subproperty";
    return valid ? [] : [customIssue(
      `/rules/${index}/match/entailment`,
      "entailment",
      `${rule.match.entailment} is incompatible with ${rule.match.kind} match`,
      { kind: rule.match.kind, entailment: rule.match.entailment },
    )];
  });
}

function validateCatalogReferences(catalog: ProjectionCatalogV1): RuntimeValidationIssue[] {
  const issues: RuntimeValidationIssue[] = [];
  const templateRefs = new Set(Object.keys(catalog.templates));

  for (const [templateKey, template] of Object.entries(catalog.templates)) {
    if (template.templateRef !== templateKey) {
      issues.push(customIssue(
        `/templates/${escapeJsonPointer(templateKey)}/templateRef`,
        "map-key",
        "templateRef must equal its templates map key",
        { key: templateKey, templateRef: template.templateRef },
      ));
    }
  }
  for (const [assetKey, asset] of Object.entries(catalog.assets)) {
    if (asset.assetRef !== assetKey) {
      issues.push(customIssue(
        `/assets/${escapeJsonPointer(assetKey)}/assetRef`,
        "map-key",
        "assetRef must equal its assets map key",
        { key: assetKey, assetRef: asset.assetRef },
      ));
    }
  }
  catalog.rules.forEach((rule, index) => {
    if (rule.project.operator === "suppress" && rule.templateRef) {
      issues.push(customIssue(
        `/rules/${index}/templateRef`,
        "operator-contract",
        "suppress must not declare templateRef",
        { operator: rule.project.operator },
      ));
    } else if (
      rule.project.operator !== "suppress"
      && !rule.templateRef
    ) {
      issues.push(customIssue(
        `/rules/${index}`,
        "operator-contract",
        `${rule.project.operator} requires templateRef`,
        { operator: rule.project.operator, missingProperty: "templateRef" },
      ));
    }
    if (rule.templateRef && !templateRefs.has(rule.templateRef)) {
      issues.push(missingTemplateIssue(`/rules/${index}/templateRef`, rule.templateRef));
    }
  });
  if (catalog.defaults) {
    for (const key of ["nodeTemplateRef", "edgeTemplateRef"] as const) {
      const templateRef = catalog.defaults[key];
      if (!templateRefs.has(templateRef)) {
        issues.push(missingTemplateIssue(`/defaults/${key}`, templateRef));
      }
    }
    if (catalog.defaults.regionTemplateRef) {
      const template = catalog.templates[catalog.defaults.regionTemplateRef];
      if (!template) {
        issues.push(missingTemplateIssue(
          "/defaults/regionTemplateRef",
          catalog.defaults.regionTemplateRef,
        ));
      } else if (template.structuralKind !== "region") {
        issues.push(customIssue(
          "/defaults/regionTemplateRef",
          "template-kind",
          "regionTemplateRef must reference a region template",
          { templateRef: catalog.defaults.regionTemplateRef },
        ));
      }
    }
  }
  return issues;
}

function missingTemplateIssue(instancePath: string, templateRef: string): RuntimeValidationIssue {
  return customIssue(
    instancePath,
    "catalog-reference",
    `template does not exist: ${templateRef}`,
    { templateRef },
  );
}

function customIssue(
  instancePath: string,
  keyword: string,
  message: string,
  params: Record<string, unknown>,
): RuntimeValidationIssue {
  return { instancePath, schemaPath: "#/$runtime", keyword, message, params };
}

function formatIssue(issue: RuntimeValidationIssue): string {
  return `${issue.instancePath || "/"} ${issue.message}`;
}

function escapeJsonPointer(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

const GRANDFATHERED_LANGUAGE_TAGS = new Set([
  "art-lojban", "cel-gaulish", "en-gb-oed", "i-ami", "i-bnn", "i-default",
  "i-enochian", "i-hak", "i-klingon", "i-lux", "i-mingo", "i-navajo",
  "i-pwn", "i-tao", "i-tay", "i-tsu", "no-bok", "no-nyn", "sgn-be-fr",
  "sgn-be-nl", "sgn-ch-de", "zh-guoyu", "zh-hakka", "zh-min", "zh-min-nan",
  "zh-xiang",
]);

const PRIVATE_USE_LANGUAGE_TAG = /^x(?:-[a-z0-9]{1,8})+$/i;
const ABSOLUTE_IRI = /^[a-z][a-z0-9+.-]*:[^\u0000-\u0020<>"{}|\\^`]+$/iu;

function isAbsoluteIri(value: string): boolean {
  if (!ABSOLUTE_IRI.test(value) || /%(?![0-9a-f]{2})/iu.test(value)) return false;
  try {
    encodeURI(value);
    return true;
  } catch {
    return false;
  }
}

export function isBcp47LanguageTag(value: string): boolean {
  const normalized = value.toLowerCase();
  if (GRANDFATHERED_LANGUAGE_TAGS.has(normalized) || PRIVATE_USE_LANGUAGE_TAG.test(value)) return true;
  try {
    return Intl.getCanonicalLocales(value).length === 1;
  } catch {
    return false;
  }
}
