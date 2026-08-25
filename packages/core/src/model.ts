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
  kind: "node-link" | "region";
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
    /** IRI of a catalog-owned sparse style preset. */
    styleRef?: string;
    /** View-local sparse override. Arbitrary CSS is intentionally unsupported. */
    style?: VisualStyleOverride;
    /** @deprecated Use styleRef. An absolute IRI is resolved as a styleRef. */
    styleToken?: string;
    /** Sparse, view-local label placement. The semantic label remains in RDF. */
    labelPlacement?: LabelPlacement;
    /** Node-local presentation offset from the template's label position. */
    nodeLabelOffset?: Point;
    /** Node label glyph flow, independent of label/icon offsets and geometry. */
    nodeLabelWritingDirection?: NodeLabelWritingDirection;
    /** Node-local presentation offset from the template's icon position. */
    nodeIconOffset?: Point;
    /** Normalized clockwise position on a region perimeter: 0 is top-left. */
    regionLabelAnchor?: number;
    /** Region label glyph flow, independent of its perimeter position. */
    regionLabelWritingDirection?: RegionLabelWritingDirection;
    /** View-local stacking order among regions. */
    regionZOrder?: number;
    /** View-local annotation for one projected edge; never semantic identity. */
    edgeCaption?: string;
    extensions?: IriographExtensions;
  };
  routing?: {
    /** Rendering/routing policy. Legacy waypoint overlays imply `manual`. */
    routeMode?: EdgeRouteMode;
    waypoints?: Point[];
    labelOffset?: Point;
    sourceAnchor?: EdgeEndpointAnchor;
    targetAnchor?: EdgeEndpointAnchor;
    /** Sparse terminal overrides; omitted values resolve from the catalog template. */
    sourceMarker?: EdgeTerminalMarker;
    targetMarker?: EdgeTerminalMarker;
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

/**
 * Direction around an element perimeter, independent of its concrete size or
 * shape. Zero is top-center and the value advances clockwise.
 */
export type EdgeEndpointAnchor = {
  position: number;
};

export type EdgeEndpointShape = NonNullable<VisualTemplate["shape"]> | "container" | "region";

export type LabelPlacement = "top" | "right" | "bottom" | "left" | "center";

export type RegionLabelWritingDirection = "horizontal-right" | "vertical-down";

export type NodeLabelWritingDirection = RegionLabelWritingDirection;

export type EdgeRouteMode = "auto" | "straight" | "orthogonal" | "curve" | "manual";

/** Closed renderer-safe terminal vocabulary; predicate identity stays semantic. */
export type EdgeTerminalMarker = "none" | "arrow" | "open-arrow" | "triangle" | "diamond" | "circle";

/** Exact RDF literal metadata used by renderer/inspector without becoming identity. */
export type SemanticTextValue = {
  value: string;
  predicateIri: string;
  statementRef: string;
  language?: string;
  datatypeIri?: string;
};

/** All labels/comments plus the locale-selected primary label. */
export type SceneSemanticText = {
  primaryLabel?: SemanticTextValue;
  labels: SemanticTextValue[];
  comments: SemanticTextValue[];
};

export type ProjectionCatalogV1 = {
  schemaVersion: "1";
  kind: "iriograph.catalog";
  catalogId: string;
  catalogVersion: string;
  profileRef: string;
  rules: ProjectionRule[];
  templates: Record<string, VisualTemplate>;
  /** Stable IRI keys mapped to safe, sparse style presets. */
  styles?: Record<string, VisualStyleOverride>;
  assets: Record<string, AssetDefinition>;
  defaults?: CatalogDefaults;
  extensions?: IriographExtensions;
};

export type CatalogDefaults = {
  nodeTemplateRef: string;
  edgeTemplateRef: string;
  /** Required by hosts that create a region view. */
  regionTemplateRef?: string;
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
      /**
       * Projects a typed resource as an independent region and relation endpoint
       * as a member. Unlike hierarchy containment, memberships may overlap and
       * never establish `parentElementId`.
       */
      operator: "membership-region";
      membershipPredicate: string;
      containerPosition: "subject" | "object";
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
  structuralKind: "node" | "edge" | "container" | "region" | "annotation";
  shape?: "rectangle" | "rounded-rectangle" | "circle" | "diamond";
  iconRef?: string;
  headerPosition?: "top" | "left" | "none";
  labelPlacement?: LabelPlacement;
  /** Meaningful for edge templates; ignored by non-edge renderers. */
  routeMode?: EdgeRouteMode;
  /** Meaningful for edge templates; omitted values resolve to none/arrow. */
  sourceMarker?: EdgeTerminalMarker;
  targetMarker?: EdgeTerminalMarker;
  style: VisualStyle;
  defaultSize?: {
    width: number;
    height: number;
    extensions?: IriographExtensions;
  };
  extensions?: IriographExtensions;
};

/** Renderer-neutral, validated visual style. */
export type VisualStyle = {
  fill: string;
  stroke: string;
  text: string;
  accent?: string;
  fillOpacity?: number;
  strokeWidth?: number;
  /** Safe SVG-like numeric dash list, e.g. `6 4`; never arbitrary CSS. */
  dash?: string;
  extensions?: IriographExtensions;
};

export type VisualStyleOverride = Partial<
  Pick<VisualStyle,
    "fill" | "stroke" | "text" | "accent" | "fillOpacity" | "strokeWidth" | "dash"
  >
> & { extensions?: IriographExtensions };

export type AssetMediaType = "image/svg+xml" | "image/png" | "image/jpeg" | "image/webp";

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
      containerPosition?: "subject" | "object";
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

export type EdgeLabelProvenance =
  | {
      kind: "predicate";
      labelSemanticRef: string;
      sourceStatementRefs: string[];
    }
  | {
      kind: "derived-structure";
      role: "sequence-transition";
      structureSemanticRef: string;
      fromOrdinal: number;
      toOrdinal: number;
      sourceStatementRefs: string[];
    }
  | {
      kind: "derived-structure";
      role: "alternative-branch";
      structureSemanticRef: string;
      /** Present when a path resource supplies the visible label. */
      labelSemanticRef?: string;
      sourceStatementRefs: string[];
    };

/**
 * Projection output before a layout adapter supplies missing geometry.
 * Existing overlay geometry remains available as a layout constraint.
 */
export type ProjectedScene = {
  viewId: string;
  nodes: ProjectedNode[];
  containers: ProjectedContainer[];
  /** Optional on legacy fixture input; Core projection always emits it. */
  regions?: ProjectedRegion[];
  /** All semantic memberships, independent of the hierarchy compatibility field. */
  memberships?: ProjectedMembership[];
  edges: ProjectedEdge[];
  diagnostics: ProjectionDiagnostic[];
};

export type ProjectedMembership = {
  semanticRef: string;
  containerElementId: string;
  memberElementId: string;
  /** Region identity in a region view; absent in a hierarchy-only view. */
  regionElementId?: string;
  /** Semantic structure represented by this membership, not a predicate edge. */
  role?: "membership" | "sequence-member";
  /** One-based rdf:_n position when role is sequence-member. */
  ordinal?: number;
  provenance: ProjectionProvenance;
};

export type ProjectedNode = {
  elementId: string;
  semanticRef: string;
  structuralKind: "node";
  label: string;
  semanticText?: SceneSemanticText;
  labelPlacement?: LabelPlacement;
  nodeLabelOffset?: Point;
  nodeLabelWritingDirection?: NodeLabelWritingDirection;
  nodeIconOffset?: Point;
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
  /** Renderer-neutral grouping grammar derived from the catalog operator. */
  groupRole?: "sequence";
  label: string;
  semanticText?: SceneSemanticText;
  labelPlacement?: LabelPlacement;
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

export type ProjectedRegion = {
  elementId: string;
  semanticRef: string;
  structuralKind: "region";
  label: string;
  semanticText?: SceneSemanticText;
  labelPlacement?: LabelPlacement;
  regionLabelAnchor?: number;
  regionLabelWritingDirection?: RegionLabelWritingDirection;
  regionZOrder?: number;
  templateRef: string;
  defaultSize: { width: number; height: number };
  geometry?: ElementGeometry;
  style: VisualStyle;
  pinned: boolean;
  placement: "generated" | "user";
  provenance: ProjectionProvenance;
};

export type ProjectedEdge = {
  elementId: string;
  semanticRef: string;
  structuralKind: "edge";
  label: string;
  caption?: string;
  semanticText?: SceneSemanticText;
  /** Comments on this exact asserted S/P/O via RDF 1.1 standard reification. */
  statementComments?: StatementSemanticComment[];
  labelProvenance?: EdgeLabelProvenance;
  sourceElementId: string;
  targetElementId: string;
  templateRef: string;
  style: VisualTemplate["style"];
  waypoints?: Point[];
  labelOffset?: Point;
  sourceAnchor?: EdgeEndpointAnchor;
  targetAnchor?: EdgeEndpointAnchor;
  routeMode?: EdgeRouteMode;
  sourceMarker?: EdgeTerminalMarker;
  targetMarker?: EdgeTerminalMarker;
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
  /** Optional for backwards-compatible hand-authored Scene fixtures. */
  regions?: SceneRegion[];
  /** Optional for backwards-compatible hand-authored Scene fixtures. */
  memberships?: SceneMembership[];
  edges: SceneEdge[];
  diagnostics: ProjectionDiagnostic[];
};

export type SceneMembership = ProjectedMembership;

export type SceneNode = {
  elementId: string;
  semanticRef: string;
  structuralKind: "node";
  label: string;
  semanticText?: SceneSemanticText;
  labelPlacement?: LabelPlacement;
  nodeLabelOffset?: Point;
  nodeLabelWritingDirection?: NodeLabelWritingDirection;
  nodeIconOffset?: Point;
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
  /** Renderer-neutral grouping grammar derived from the catalog operator. */
  groupRole?: "sequence";
  label: string;
  semanticText?: SceneSemanticText;
  labelPlacement?: LabelPlacement;
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

export type SceneRegion = {
  elementId: string;
  semanticRef: string;
  structuralKind: "region";
  label: string;
  semanticText?: SceneSemanticText;
  labelPlacement?: LabelPlacement;
  regionLabelAnchor?: number;
  regionLabelWritingDirection?: RegionLabelWritingDirection;
  regionZOrder?: number;
  templateRef: string;
  geometry: ElementGeometry;
  style: VisualStyle;
  pinned: boolean;
  placement: "generated" | "user";
  provenance?: ProjectionProvenance;
};

export type SceneEdge = {
  elementId: string;
  semanticRef: string;
  structuralKind: "edge";
  label: string;
  caption?: string;
  semanticText?: SceneSemanticText;
  /** Comments on this exact asserted S/P/O via RDF 1.1 standard reification. */
  statementComments?: StatementSemanticComment[];
  labelProvenance?: EdgeLabelProvenance;
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
  sourceAnchor?: EdgeEndpointAnchor;
  targetAnchor?: EdgeEndpointAnchor;
  routeMode?: EdgeRouteMode;
  sourceMarker?: EdgeTerminalMarker;
  targetMarker?: EdgeTerminalMarker;
  projectionRuleId?: string;
  fallback: boolean;
  provenance?: ProjectionProvenance;
};

export type StatementSemanticComment = SemanticTextValue & {
  reifierRef: string;
};

export type ProjectionDiagnostic = {
  /** Stable semantic identity. Source formatting and source ranges are excluded. */
  diagnosticId?: string;
  severity: "info" | "warning" | "error";
  category?: "syntax" | "structure" | "profile" | "domain" | "projection" | "layout" | "asset" | "internal";
  code: string;
  message: string;
  semanticRef?: string;
  statementRef?: string;
  sourceFingerprint?: string;
  sourceLocation?: {
    startOffset: number;
    endOffset: number;
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
  };
  catalogRef?: string;
  ruleId?: string;
  assetRef?: string;
  /** Machine-actionable recovery suggestions; hosts localize/present them. */
  suggestedActions?: DiagnosticActionHint[];
};

export type DiagnosticActionHint = {
  actionId: string;
  semanticRef?: string;
  statementRef?: string;
  parameters?: Record<string, JsonValue>;
};

export type SemanticSourceUpdate = {
  accepted: boolean;
  /** Cancellation is control flow and is intentionally absent from diagnostics. */
  aborted?: boolean;
  document: IriographDocument;
  diagnostics: ProjectionDiagnostic[];
  /** Present when domain warnings require an explicit, source-bound retry. */
  warningConfirmation?: import("./semantic-validation.js").SemanticWarningConfirmation;
};
