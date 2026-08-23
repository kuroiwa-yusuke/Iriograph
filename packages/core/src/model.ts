export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

/**
 * Extension keys are absolute IRIs. Runtime validation enforces this boundary;
 * regular fields remain closed so extensions cannot silently become core API.
 */
export type IriographExtensions = Record<string, JsonValue>;

export type IriographDocumentV1 = {
  schemaVersion: "1";
  kind: "iriograph.document";
  documentId: string;
  semantic: {
    format: "text/turtle";
    baseIri: string;
    authoringProfileRef: string;
    source: string;
    extensions?: IriographExtensions;
  };
  imports?: CatalogImport[];
  views: DiagramView[];
  extensions?: IriographExtensions;
};

/** @deprecated Migration-only shape accepted by the prototype editor. */
export type LegacyIriographDocument = Omit<IriographDocumentV1, "semantic"> & {
  semantic: Omit<IriographDocumentV1["semantic"], "authoringProfileRef"> & {
    authoringProfileRef?: never;
  };
};

/**
 * Existing renderer/editor APIs temporarily accept the prototype document.
 * New persistence boundaries must validate and return IriographDocumentV1.
 */
export type IriographDocument = IriographDocumentV1 | LegacyIriographDocument;

export type CatalogImport = {
  catalogRef: string;
  integrity?: string;
  extensions?: IriographExtensions;
};

export type DiagramView = {
  viewId: string;
  kind: "node-link";
  profileRef: string;
  layoutRef: string;
  locale?: string;
  overlay: Record<string, ViewElementOverlay>;
  extensions?: IriographExtensions;
};

export type ViewElementOverlay = {
  semanticRef: string;
  geometry?: ElementGeometry;
  pinned?: boolean;
  placement?: "generated" | "user";
  appearance?: {
    templateRef?: string;
    iconRef?: string;
    styleToken?: string;
    extensions?: IriographExtensions;
  };
  routing?: {
    waypoints?: Point[];
    labelOffset?: Point;
    extensions?: IriographExtensions;
  };
  extensions?: IriographExtensions;
};

export type ElementGeometry = {
  x: number;
  y: number;
  width: number;
  height: number;
  extensions?: IriographExtensions;
};

export type Point = {
  x: number;
  y: number;
  extensions?: IriographExtensions;
};

export type ProjectionCatalogV1 = {
  schemaVersion: "1";
  kind: "iriograph.catalog";
  catalogId: string;
  catalogVersion: string;
  profileRef: string;
  rules: ProjectionRule[];
  templates: Record<string, VisualTemplate>;
  assets: Record<string, AssetDefinition>;
  defaults?: CatalogDefaults;
  extensions?: IriographExtensions;
};

export type CatalogDefaults = {
  nodeTemplateRef: string;
  edgeTemplateRef: string;
  layoutRef: string;
  extensions?: IriographExtensions;
};

export type ProjectionRule = {
  ruleId: string;
  priority: number;
  match: ProjectionRuleMatch;
  project: ProjectionOperator;
  templateRef?: string;
  extensions?: IriographExtensions;
};

export type ProjectionRuleMatch =
  | {
      kind: "type" | "predicate";
      iri: string;
      entailment: "exact" | "rdfs-subclass" | "rdfs-subproperty";
      extensions?: IriographExtensions;
    }
  | {
      kind: "any-iri-object";
      extensions?: IriographExtensions;
    };

export type ProjectionOperator =
  | {
      operator: "resource";
      structuralKind: "node" | "container";
      extensions?: IriographExtensions;
    }
  | {
      operator: "direct-edge" | "suppress";
      extensions?: IriographExtensions;
    }
  | {
      operator: "membership-container";
      membershipPredicate: string;
      extensions?: IriographExtensions;
    }
  | {
      operator: "ordinal-sequence";
      ordinalPredicatePrefix: string;
      extensions?: IriographExtensions;
    }
  | {
      operator: "alternative";
      ordinalPredicatePrefix: string;
      defaultOrdinal: number;
      extensions?: IriographExtensions;
    };

/** @deprecated Prototype catalog accepted until projection moves to ProjectionCatalogV1. */
export type LegacyDiagramCatalog = {
  catalogId: string;
  catalogVersion: string;
  profileRef: string;
  defaults: CatalogDefaults;
  nodeRules: NodeProjectionRule[];
  relationRules: RelationProjectionRule[];
  containmentRules: ContainmentProjectionRule[];
  templates: Record<string, VisualTemplate>;
  assets: Record<string, AssetDefinition>;
  extensions?: IriographExtensions;
};

/** @deprecated Use ProjectionCatalogV1 at new persistence boundaries. */
export type DiagramCatalog = LegacyDiagramCatalog;

export type NodeProjectionRule = {
  ruleId: string;
  rdfType: string;
  structuralKind: "node" | "container";
  templateRef: string;
  labelPath?: string;
  priority?: number;
  extensions?: IriographExtensions;
};

export type RelationProjectionRule = {
  ruleId: string;
  rdfType: string;
  sourcePath: string;
  targetPath: string;
  labelPath?: string;
  templateRef: string;
  priority?: number;
  extensions?: IriographExtensions;
};

export type ContainmentProjectionRule = {
  ruleId: string;
  predicate: string;
  child: "subject" | "object";
  parent: "subject" | "object";
  extensions?: IriographExtensions;
};

export type VisualTemplate = {
  templateRef: string;
  structuralKind: "node" | "edge" | "container" | "annotation";
  shape?: "rectangle" | "rounded-rectangle" | "circle" | "diamond";
  iconRef?: string;
  headerPosition?: "top" | "left" | "none";
  style: {
    fill: string;
    stroke: string;
    text: string;
    accent?: string;
    dash?: string;
    extensions?: IriographExtensions;
  };
  defaultSize?: {
    width: number;
    height: number;
    extensions?: IriographExtensions;
  };
  extensions?: IriographExtensions;
};

export type AssetMediaType = "image/svg+xml" | "image/png" | "image/webp";

export type AssetDefinition = {
  assetRef: string;
  mediaType: AssetMediaType;
  url: string;
  extensions?: IriographExtensions;
};

export type ProjectionOptions = {
  /** @deprecated Legacy DiagramCatalog projection only. */
  resolveAssetUrl?: (
    assetRef: string,
    definition: AssetDefinition | undefined,
  ) => string | undefined;
};

/**
 * Catalog rule identity is catalog-qualified because ruleId is only required to
 * be unique inside one catalog.
 */
export type CatalogRuleReference = {
  catalogRef: string;
  ruleId: string;
};

export type SemanticEditCapability =
  | {
      command: "remove-statement";
      statementRef: string;
      subject: string;
      predicate: string;
      object: string;
    }
  | {
      command: "set-membership";
      container: string;
      member: string;
      containerTypeIri: string;
      predicate: string;
    }
  | {
      command: "set-sequence";
      sequence: string;
      sequenceTypeIri: string;
      ordinalPredicatePrefix: string;
    }
  | {
      command: "set-alternatives";
      alternative: string;
      alternativeTypeIri: string;
      ordinalPredicatePrefix: string;
      defaultOrdinal: number;
    };

/** Derived edit information. It is never persisted in an .iriograph file. */
export type ProjectionProvenance = {
  sourceStatementRefs: string[];
  operator: ProjectionOperator["operator"] | "implicit-resource" | "implicit-direct-edge";
  rule?: CatalogRuleReference;
  derivation: "resource" | "direct" | "derived";
  editCapability?: SemanticEditCapability;
};

/**
 * Projection output before a layout adapter supplies missing geometry.
 * Existing overlay geometry remains available as a layout constraint.
 */
export type ProjectedScene = {
  viewId: string;
  nodes: ProjectedNode[];
  containers: ProjectedContainer[];
  edges: ProjectedEdge[];
  diagnostics: ProjectionDiagnostic[];
};

export type ProjectedNode = {
  elementId: string;
  semanticRef: string;
  structuralKind: "node";
  label: string;
  templateRef: string;
  shape: NonNullable<VisualTemplate["shape"]>;
  iconRef?: string;
  iconUrl?: string;
  defaultSize: { width: number; height: number };
  geometry?: ElementGeometry;
  parentElementId?: string;
  parentProvenance?: ProjectionProvenance;
  style: VisualTemplate["style"];
  pinned: boolean;
  placement: "generated" | "user";
  provenance: ProjectionProvenance;
};

export type ProjectedContainer = {
  elementId: string;
  semanticRef: string;
  structuralKind: "container";
  label: string;
  templateRef: string;
  defaultSize: { width: number; height: number };
  geometry?: ElementGeometry;
  parentElementId?: string;
  parentProvenance?: ProjectionProvenance;
  headerPosition: NonNullable<VisualTemplate["headerPosition"]>;
  style: VisualTemplate["style"];
  pinned: boolean;
  placement: "generated" | "user";
  provenance: ProjectionProvenance;
};

export type ProjectedEdge = {
  elementId: string;
  semanticRef: string;
  structuralKind: "edge";
  label: string;
  sourceElementId: string;
  targetElementId: string;
  templateRef: string;
  style: VisualTemplate["style"];
  waypoints?: Point[];
  labelOffset?: Point;
  routingPlacement: "generated" | "user";
  fallback: boolean;
  provenance: ProjectionProvenance;
};

export type DiagramScene = {
  viewId: string;
  width: number;
  height: number;
  nodes: SceneNode[];
  containers: SceneContainer[];
  edges: SceneEdge[];
  diagnostics: ProjectionDiagnostic[];
};

export type SceneNode = {
  elementId: string;
  semanticRef: string;
  structuralKind: "node";
  label: string;
  templateRef: string;
  shape: NonNullable<VisualTemplate["shape"]>;
  iconRef?: string;
  iconUrl?: string;
  geometry: ElementGeometry;
  parentElementId?: string;
  parentProvenance?: ProjectionProvenance;
  style: VisualTemplate["style"];
  pinned: boolean;
  placement: "generated" | "user";
  projectionRuleId?: string;
  provenance?: ProjectionProvenance;
};

export type SceneContainer = {
  elementId: string;
  semanticRef: string;
  structuralKind: "container";
  label: string;
  templateRef: string;
  geometry: ElementGeometry;
  headerPosition: NonNullable<VisualTemplate["headerPosition"]>;
  style: VisualTemplate["style"];
  pinned: boolean;
  placement: "generated" | "user";
  projectionRuleId?: string;
  parentElementId?: string;
  parentProvenance?: ProjectionProvenance;
  provenance?: ProjectionProvenance;
};

export type SceneEdge = {
  elementId: string;
  semanticRef: string;
  structuralKind: "edge";
  label: string;
  sourceElementId: string;
  targetElementId: string;
  templateRef: string;
  style: VisualTemplate["style"];
  /**
   * Renderer-ready polyline including source and target attachment points.
   * This is derived by layout and is never persisted in a view overlay.
   */
  route?: Point[];
  /** User-authored intermediate points only; endpoints are present in route. */
  waypoints?: Point[];
  labelOffset?: Point;
  projectionRuleId?: string;
  fallback: boolean;
  provenance?: ProjectionProvenance;
};

export type ProjectionDiagnostic = {
  severity: "info" | "warning" | "error";
  code: string;
  message: string;
  semanticRef?: string;
  statementRef?: string;
  catalogRef?: string;
  ruleId?: string;
  assetRef?: string;
};

export type SemanticSourceUpdate = {
  accepted: boolean;
  document: IriographDocument;
  diagnostics: ProjectionDiagnostic[];
};
