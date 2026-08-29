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
  /** Optional closed semantic visibility query. It never changes the graph. */
  scope?: NamedViewScope;
  overlay: Record<string, ViewElementOverlay>;
  /** View-local notes, deliberately separate from semantic-bound overlay entries. */
  annotations?: Record<string, ViewAnnotation>;
  extensions?: IriographExtensions;
};

export type NamedViewScope = {
  rootSemanticRefs?: string[];
  typeIris?: string[];
  predicateIris?: string[];
  direction?: "incoming" | "outgoing" | "both";
  depth?: number;
  extensions?: IriographExtensions;
};

export type ViewAnnotation = {
  /** Must equal its key in DiagramView.annotations. */
  annotationId: string;
  text: string;
  geometry: ElementGeometry;
  style?: VisualStyleOverride;
  anchor?: {
    elementId: string;
    offset?: Point;
    extensions?: IriographExtensions;
  };
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
    /** Sparse multiplier applied to the icon's intrinsic size. */
    nodeIconScale?: number;
    /** Sparse explicit icon box; mutually exclusive with nodeIconScale. */
    nodeIconSize?: { width: number; height: number };
    /** Renderer-neutral fit inside the resolved icon box. */
    nodeIconFit?: "contain" | "cover";
    /** Common group-frame label position; supersedes the region-only alias. */
    groupLabelAnchor?: number;
    /** Signed normalized inward/outward displacement within the group header band. */
    groupLabelOffset?: number;
    /** Common group-frame label glyph flow. */
    groupLabelWritingDirection?: RegionLabelWritingDirection;
    /** Group-header-local icon displacement; never semantic membership. */
    groupIconOffset?: Point;
    /** Sparse multiplier applied to a group icon's natural header size. */
    groupIconScale?: number;
    /** View-local stacking order among group frames of the same layer. */
    groupZOrder?: number;
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
    /** Sparse manual controls for `curve`; endpoints remain derived from nodes/layout. */
    curve?: EdgeCurveRouting;
    labelOffset?: Point;
    sourceAnchor?: EdgeEndpointAnchor;
    targetAnchor?: EdgeEndpointAnchor;
    /** Stable catalog port IDs; omitted values use the perimeter anchor fallback. */
    sourcePortId?: string;
    targetPortId?: string;
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
 * One user-authored point that the curve must pass through. Handle values are
 * vectors relative to the knot so moving the knot keeps its local curvature.
 */
export type EdgeCurveKnot = {
  point: Point;
  incomingHandle?: Point;
  outgoingHandle?: Point;
  extensions?: IriographExtensions;
};

/**
 * Sparse cubic Bezier controls. Endpoint handles are vectors relative to the
 * current attachment points; endpoint coordinates themselves are never saved.
 */
export type EdgeCurveRouting = {
  sourceHandle?: Point;
  targetHandle?: Point;
  knots?: EdgeCurveKnot[];
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
    }
  | {
      /** Projects each matching subject/literal statement as a statement-bound note. */
      operator: "literal-annotation";
      anchorPosition: "subject";
      languages?: string[];
      datatypes?: string[];
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
  ports?: VisualPort[];
  style: VisualStyle;
  defaultSize?: {
    width: number;
    height: number;
    extensions?: IriographExtensions;
  };
  extensions?: IriographExtensions;
};

export type VisualPort = {
  portId: string;
  label?: string;
  role: "source" | "target" | "both";
  side: "top" | "right" | "bottom" | "left";
  position: number;
  predicateIris?: string[];
  classIris?: string[];
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
  /** Sparse label/caption/comment font size in renderer-neutral CSS pixels. */
  labelFontSize?: number;
  /** Safe SVG-like numeric dash list, e.g. `6 4`; never arbitrary CSS. */
  dash?: string;
  extensions?: IriographExtensions;
};

export type VisualStyleOverride = Partial<
  Pick<VisualStyle,
    "fill" | "stroke" | "text" | "accent" | "fillOpacity" | "strokeWidth" | "labelFontSize" | "dash"
  >
> & { extensions?: IriographExtensions };

export type AssetMediaType = "image/svg+xml" | "image/png" | "image/jpeg" | "image/webp";

/** Verified transient image dimensions exposed to renderers and content metrics. */
export type AssetIntrinsicSize = {
  width: number;
  height: number;
  aspectRatio: number;
  source: "decoded" | "svg-view-box";
};

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
  /** Stable explanation of catalog rule/template selection for this element. */
  resolutionTrace?: ProjectionRuleResolutionTrace;
};

export type ProjectionRuleCandidateTrace = {
  catalogRef: string;
  ruleId: string;
  priority: number;
  match: "exact" | "explicit-subclass" | "explicit-subproperty" | "wildcard";
  distance: number;
  matchedIri?: string;
  templateRef?: string;
  /** Styles remain display concerns; this records where the base style came from. */
  styleSource?: "template";
};

export type ProjectionRuleResolutionTrace = {
  semanticRef: string;
  outcome: "resolved" | "fallback" | "conflict";
  candidates: ProjectionRuleCandidateTrace[];
  selected?: ProjectionRuleCandidateTrace;
  fallback?: {
    reason: "no-matching-rule" | "wildcard-rule";
    templateRef?: string;
    styleSource?: "catalog-default-template" | "template";
  };
  conflicts?: ProjectionRuleCandidateTrace[];
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
  /** Display-only guides for ordered/alternative group grammar; never RDF edges. */
  groupGuides?: ProjectedGroupGuide[];
  /** Semantic literal notes and view-only notes; optional for legacy fixtures. */
  annotations?: ProjectedAnnotation[];
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
  role?: "membership" | "sequence-member" | "alternative-member";
  /** One-based rdf:_n position for sequence/alternative membership. */
  ordinal?: number;
  /** Display-only ordinal badge, derived from ordinal and never persisted. */
  ordinalBadge?: string;
  /** True when this member is the catalog-declared alternative default. */
  isDefault?: boolean;
  provenance: ProjectionProvenance;
};

export type GroupFrameKind = "membership" | "classification" | "sequence" | "alternative";

/** Common Scene grammar for Bag/classification/Seq/Alt frames. */
export type GroupFrame = {
  kind: GroupFrameKind;
  semanticRef: string;
  /** Exact asserted rdf:type that selected this structural operator. */
  semanticTypeIri?: string;
  /** Exact semantic statements that caused the frame to be projected. */
  provenance: ProjectionProvenance;
  /** Virtual hub used only to render alternative candidate guides. */
  hub?: {
    elementId: string;
    role: "alternative-hub";
  };
  /** Catalog default with exact rdf:_n provenance when that member exists. */
  defaultMember?: {
    ordinal: number;
    memberElementId: string;
    statementRef: string;
    provenance: ProjectionProvenance;
  };
  /** Frame retained because a scoped visible member requires its owner context. */
  scopeClosure?: {
    reason: "visible-member";
    memberElementIds: string[];
    provenance: ProjectionProvenance;
  };
  /** Explicit marker that a scoped Seq/Alt omits one or more semantic members. */
  scopeTruncation?: {
    marker: "truncated";
    hiddenMemberCount: number;
    hiddenStatementRefs: string[];
    provenance: ProjectionProvenance;
  };
};

export type ProjectedGroupGuide = {
  guideId: string;
  groupElementId: string;
  kind: "sequence-order" | "alternative-candidate";
  sourceElementId: string;
  targetElementId: string;
  ordinal?: number;
  muted: true;
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
  nodeIconScale?: number;
  nodeIconSize?: { width: number; height: number };
  nodeIconFit?: "contain" | "cover";
  templateRef: string;
  shape: NonNullable<VisualTemplate["shape"]>;
  iconRef?: string;
  iconUrl?: string;
  /** Transient verified dimensions; never persisted in an overlay or catalog. */
  iconIntrinsicSize?: AssetIntrinsicSize;
  defaultSize: { width: number; height: number };
  geometry?: ElementGeometry;
  parentElementId?: string;
  parentProvenance?: ProjectionProvenance;
  style: VisualTemplate["style"];
  pinned: boolean;
  placement: "generated" | "user";
  provenance: ProjectionProvenance;
};

export type ViewAnnotationProvenance = {
  kind: "view-annotation";
  viewId: string;
  annotationId: string;
};

export type ProjectedAnnotation = {
  elementId: string;
  annotationId: string;
  /** Statement identity for semantic annotations; absent for view-local annotations. */
  semanticRef?: string;
  structuralKind: "annotation";
  annotationKind: "semantic-literal" | "view";
  text: string;
  language?: string;
  datatypeIri?: string;
  statementRef?: string;
  anchorSemanticRef?: string;
  anchorElementId?: string;
  detachedAnchorElementId?: string;
  anchorOffset?: Point;
  templateRef?: string;
  defaultSize: { width: number; height: number };
  geometry?: ElementGeometry;
  style: VisualStyle;
  pinned: boolean;
  placement: "generated" | "user";
  provenance: ProjectionProvenance | ViewAnnotationProvenance;
};

export type ProjectedContainer = {
  elementId: string;
  semanticRef: string;
  structuralKind: "container";
  /** Renderer-neutral grouping grammar derived from the catalog operator. */
  groupRole?: GroupFrameKind;
  groupFrame?: GroupFrame;
  label: string;
  semanticText?: SceneSemanticText;
  labelPlacement?: LabelPlacement;
  groupLabelAnchor?: number;
  groupLabelOffset?: number;
  groupLabelWritingDirection?: RegionLabelWritingDirection;
  groupIconOffset?: Point;
  groupIconScale?: number;
  groupZOrder?: number;
  templateRef: string;
  iconRef?: string;
  iconUrl?: string;
  /** Transient verified dimensions; never persisted in an overlay or catalog. */
  iconIntrinsicSize?: AssetIntrinsicSize;
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
  groupFrame?: GroupFrame;
  groupLabelAnchor?: number;
  groupLabelOffset?: number;
  groupLabelWritingDirection?: RegionLabelWritingDirection;
  groupIconOffset?: Point;
  groupIconScale?: number;
  groupZOrder?: number;
  regionLabelAnchor?: number;
  regionLabelWritingDirection?: RegionLabelWritingDirection;
  regionZOrder?: number;
  templateRef: string;
  iconRef?: string;
  iconUrl?: string;
  /** Transient verified dimensions; never persisted in an overlay or catalog. */
  iconIntrinsicSize?: AssetIntrinsicSize;
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
  curve?: EdgeCurveRouting;
  labelOffset?: Point;
  sourceAnchor?: EdgeEndpointAnchor;
  targetAnchor?: EdgeEndpointAnchor;
  sourcePortId?: string;
  targetPortId?: string;
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
  /** Optional for backwards-compatible hand-authored Scene fixtures. */
  groupGuides?: SceneGroupGuide[];
  /** Semantic literal notes and view-only notes; optional for legacy fixtures. */
  annotations?: SceneAnnotation[];
  edges: SceneEdge[];
  diagnostics: ProjectionDiagnostic[];
};

export type SceneMembership = ProjectedMembership;
export type SceneGroupGuide = ProjectedGroupGuide;
export type SceneAnnotation = Omit<ProjectedAnnotation, "geometry"> & {
  geometry: ElementGeometry;
};

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
  nodeIconScale?: number;
  nodeIconSize?: { width: number; height: number };
  nodeIconFit?: "contain" | "cover";
  templateRef: string;
  shape: NonNullable<VisualTemplate["shape"]>;
  iconRef?: string;
  iconUrl?: string;
  iconIntrinsicSize?: AssetIntrinsicSize;
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
  groupRole?: GroupFrameKind;
  groupFrame?: GroupFrame;
  label: string;
  semanticText?: SceneSemanticText;
  labelPlacement?: LabelPlacement;
  groupLabelAnchor?: number;
  groupLabelOffset?: number;
  groupLabelWritingDirection?: RegionLabelWritingDirection;
  groupIconOffset?: Point;
  groupIconScale?: number;
  groupZOrder?: number;
  templateRef: string;
  iconRef?: string;
  iconUrl?: string;
  iconIntrinsicSize?: AssetIntrinsicSize;
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
  groupFrame?: GroupFrame;
  groupLabelAnchor?: number;
  groupLabelOffset?: number;
  groupLabelWritingDirection?: RegionLabelWritingDirection;
  groupIconOffset?: Point;
  groupIconScale?: number;
  groupZOrder?: number;
  regionLabelAnchor?: number;
  regionLabelWritingDirection?: RegionLabelWritingDirection;
  regionZOrder?: number;
  templateRef: string;
  iconRef?: string;
  iconUrl?: string;
  iconIntrinsicSize?: AssetIntrinsicSize;
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
  /** Layout-selected renderer-only route family/control; never portable overlay data. */
  derivedRouteChoice?: SceneDerivedRouteChoice;
  /** User-authored intermediate points only; endpoints are present in route. */
  waypoints?: Point[];
  /** Sparse manual cubic controls; derived automatic controls are not persisted. */
  curve?: EdgeCurveRouting;
  labelOffset?: Point;
  sourceAnchor?: EdgeEndpointAnchor;
  targetAnchor?: EdgeEndpointAnchor;
  sourcePortId?: string;
  targetPortId?: string;
  routeMode?: EdgeRouteMode;
  sourceMarker?: EdgeTerminalMarker;
  targetMarker?: EdgeTerminalMarker;
  projectionRuleId?: string;
  fallback: boolean;
  provenance?: ProjectionProvenance;
};

export type SceneDerivedRouteChoice = {
  family: "straight" | "curve" | "polyline" | "orthogonal" | "manual";
  source: "auto" | "explicit" | "fixed";
  reason:
    | "auto-straight-safe"
    | "auto-orthogonal-safe"
    | "auto-curve-safe"
    | "auto-curve-fallback"
    | "auto-polyline-fallback"
    | "auto-self-loop-preserved"
    | "explicit-route-mode"
    | "fixed-derived-route";
  curve?: {
    sourceControl: Point;
    targetControl: Point;
    guidePivot: Point;
    guideAngleDegrees: number;
  };
  rejected?: Array<{
    family: "straight" | "orthogonal" | "curve";
    reason:
      | "obstacle"
      | "interaction"
      | "parallel-identity"
      | "self-loop"
      | "no-guide"
      | "tight-turn"
      | "endpoint-direction";
  }>;
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
  /** RFC 6901 pointer into a portable document candidate, when applicable. */
  jsonPointer?: string;
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
  /**
   * Transaction内で検証済みのrenderer-ready Scene。Hostが同じrevisionを
   * publishするときの再projection/layoutを避けるためのtransient resultで、
   * portable documentへは保存しない。
   */
  scenes?: Record<string, DiagramScene>;
  /** Present when domain warnings require an explicit, source-bound retry. */
  warningConfirmation?: import("./semantic-validation.js").SemanticWarningConfirmation;
};
