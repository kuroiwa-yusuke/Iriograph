export type IriographDocument = {
  schemaVersion: "1";
  kind: "iriograph.document";
  documentId: string;
  semantic: {
    format: "text/turtle";
    baseIri: string;
    source: string;
  };
  imports?: CatalogImport[];
  views: DiagramView[];
};

export type CatalogImport = {
  catalogRef: string;
  integrity?: string;
};

export type DiagramView = {
  viewId: string;
  kind: "node-link";
  profileRef: string;
  layoutRef: string;
  overlay: Record<string, ViewElementOverlay>;
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
  };
  routing?: {
    waypoints?: Point[];
    labelOffset?: Point;
  };
};

export type ElementGeometry = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type Point = {
  x: number;
  y: number;
};

export type DiagramCatalog = {
  catalogId: string;
  catalogVersion: string;
  profileRef: string;
  defaults: {
    nodeTemplateRef: string;
    edgeTemplateRef: string;
    layoutRef: string;
  };
  nodeRules: NodeProjectionRule[];
  relationRules: RelationProjectionRule[];
  containmentRules: ContainmentProjectionRule[];
  templates: Record<string, VisualTemplate>;
  assets: Record<string, AssetDefinition>;
};

export type NodeProjectionRule = {
  ruleId: string;
  rdfType: string;
  structuralKind: "node" | "container";
  templateRef: string;
  labelPath?: string;
  priority?: number;
};

export type RelationProjectionRule = {
  ruleId: string;
  rdfType: string;
  sourcePath: string;
  targetPath: string;
  labelPath?: string;
  templateRef: string;
  priority?: number;
};

export type ContainmentProjectionRule = {
  ruleId: string;
  predicate: string;
  child: "subject" | "object";
  parent: "subject" | "object";
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
  };
  defaultSize?: {
    width: number;
    height: number;
  };
};

export type AssetDefinition = {
  assetRef: string;
  mediaType: "image/svg+xml" | "image/png" | "image/webp";
  url: string;
};

export type ProjectionOptions = {
  resolveAssetUrl?: (
    assetRef: string,
    definition: AssetDefinition | undefined,
  ) => string | undefined;
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
  style: VisualTemplate["style"];
  pinned: boolean;
  placement: "generated" | "user";
  projectionRuleId?: string;
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
  waypoints?: Point[];
  projectionRuleId?: string;
  fallback: boolean;
};

export type ProjectionDiagnostic = {
  severity: "info" | "warning" | "error";
  code: string;
  message: string;
  semanticRef?: string;
};

export type SemanticSourceUpdate = {
  accepted: boolean;
  document: IriographDocument;
  diagnostics: ProjectionDiagnostic[];
};
