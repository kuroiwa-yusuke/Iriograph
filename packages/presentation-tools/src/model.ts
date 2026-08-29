export type PresentationJsonValue =
  | null
  | boolean
  | number
  | string
  | PresentationJsonValue[]
  | { [key: string]: PresentationJsonValue };

export type PresentationSceneBinding = {
  documentRevision: string;
  contextRevision: string;
  viewId: string;
};

export type PresentationElementKind = "node" | "container" | "region" | "edge" | "annotation";

export type PresentationGeometry = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PresentationPoint = {
  x: number;
  y: number;
};

export type PresentationCurveKnot = {
  point: PresentationPoint;
  incomingHandle?: PresentationPoint;
  outgoingHandle?: PresentationPoint;
};

export type PresentationCurve = {
  sourceHandle?: PresentationPoint;
  targetHandle?: PresentationPoint;
  knots?: PresentationCurveKnot[];
};

export type PresentationStyle = {
  fill?: string;
  stroke?: string;
  text?: string;
  accent?: string;
  fillOpacity?: number;
  strokeWidth?: number;
  labelFontSize?: number;
  dash?: string;
};

export type PresentationAppearance = {
  templateOptionId?: string;
  iconOptionId?: string;
  styleOptionId?: string;
  style?: PresentationStyle;
  labelPlacement?: "top" | "right" | "bottom" | "left" | "center";
  nodeLabelOffset?: PresentationPoint;
  nodeLabelWritingDirection?: "horizontal-right" | "vertical-down";
  nodeIconOffset?: PresentationPoint;
  nodeIconScale?: number;
  nodeIconSize?: { width: number; height: number };
  nodeIconFit?: "contain" | "cover";
  groupLabelAnchor?: number;
  groupLabelOffset?: number;
  groupLabelWritingDirection?: "horizontal-right" | "vertical-down";
  groupIconOffset?: PresentationPoint;
  groupIconScale?: number;
  groupZOrder?: number;
  regionLabelAnchor?: number;
  regionLabelWritingDirection?: "horizontal-right" | "vertical-down";
  regionZOrder?: number;
  edgeCaption?: string;
};

export type PresentationRouting = {
  routeMode?: "auto" | "straight" | "orthogonal" | "curve" | "manual";
  waypoints?: PresentationPoint[];
  curve?: PresentationCurve;
  labelOffset?: PresentationPoint;
  sourceAnchor?: { position: number };
  targetAnchor?: { position: number };
  sourceMarker?: "none" | "arrow" | "open-arrow" | "triangle" | "diamond" | "circle";
  targetMarker?: "none" | "arrow" | "open-arrow" | "triangle" | "diamond" | "circle";
};

/**
 * Renderer-neutral presentation state only. Semantic references, Turtle,
 * resolved URLs, CSS and asset bytes are deliberately not representable.
 */
export type PresentationElementState = {
  geometry?: PresentationGeometry;
  pinned?: boolean;
  placement?: "generated" | "user";
  appearance?: PresentationAppearance;
  routing?: PresentationRouting;
};

export type PresentationSceneElement = {
  elementId: string;
  kind: PresentationElementKind;
  label: string;
  parentElementId?: string;
  sourceElementId?: string;
  targetElementId?: string;
  presentation: PresentationElementState;
};

export type PresentationSceneMembership = {
  groupElementId: string;
  memberElementId: string;
  role: "membership" | "sequence-member" | "alternative-member";
  ordinal?: number;
};

export type PresentationSceneSnapshot = {
  binding: PresentationSceneBinding;
  width: number;
  height: number;
  elements: PresentationSceneElement[];
  memberships?: PresentationSceneMembership[];
};

export const PRESENTATION_FIELDS = [
  "geometry",
  "pinned",
  "placement",
  "appearance.templateOptionId",
  "appearance.iconOptionId",
  "appearance.styleOptionId",
  "appearance.style.fill",
  "appearance.style.stroke",
  "appearance.style.text",
  "appearance.style.accent",
  "appearance.style.fillOpacity",
  "appearance.style.strokeWidth",
  "appearance.style.labelFontSize",
  "appearance.style.dash",
  "appearance.labelPlacement",
  "appearance.nodeLabelOffset",
  "appearance.nodeLabelWritingDirection",
  "appearance.nodeIconOffset",
  "appearance.nodeIconScale",
  "appearance.nodeIconSize",
  "appearance.nodeIconFit",
  "appearance.groupLabelAnchor",
  "appearance.groupLabelOffset",
  "appearance.groupLabelWritingDirection",
  "appearance.groupIconOffset",
  "appearance.groupIconScale",
  "appearance.groupZOrder",
  "appearance.regionLabelAnchor",
  "appearance.regionLabelWritingDirection",
  "appearance.regionZOrder",
  "appearance.edgeCaption",
  "routing.routeMode",
  "routing.waypoints",
  "routing.curve",
  "routing.labelOffset",
  "routing.sourceAnchor",
  "routing.targetAnchor",
  "routing.sourceMarker",
  "routing.targetMarker",
] as const;

export type PresentationField = typeof PRESENTATION_FIELDS[number];

export type PresentationFieldRule = {
  field: PresentationField;
  elementKinds: PresentationElementKind[];
};

export type PresentationOption = {
  optionId: string;
  label: string;
  summary?: string;
  elementKinds: PresentationElementKind[];
};

export type PresentationCapabilitySet = {
  contextRevision: string;
  fieldRules: PresentationFieldRule[];
  templates?: PresentationOption[];
  icons?: PresentationOption[];
  styles?: PresentationOption[];
  routeModes?: NonNullable<PresentationRouting["routeMode"]>[];
  markers?: NonNullable<PresentationRouting["sourceMarker"]>[];
};

type Resettable<T> = { [K in keyof T]?: T[K] | null };

export type PresentationStylePatch = Resettable<PresentationStyle>;

export type PresentationAppearancePatch = Omit<Resettable<PresentationAppearance>, "style"> & {
  style?: PresentationStylePatch;
};

export type PresentationRoutingPatch = Resettable<PresentationRouting>;

export type PresentationElementPatch = {
  elementId: string;
  geometry?: PresentationGeometry | null;
  pinned?: boolean | null;
  placement?: "generated" | "user" | null;
  appearance?: PresentationAppearancePatch;
  routing?: PresentationRoutingPatch;
};

export type PresentationCandidatePatch = {
  binding: PresentationSceneBinding;
  candidateId: string;
  changes: PresentationElementPatch[];
};

export type PresentationDiagnosticCode =
  | "invalid-request"
  | "unknown-field"
  | "invalid-value"
  | "unsafe-value"
  | "stale-document-revision"
  | "stale-context-revision"
  | "view-mismatch"
  | "target-unresolved"
  | "duplicate-target"
  | "field-not-available"
  | "option-unavailable"
  | "option-not-applicable"
  | "patch-change-limit"
  | "patch-field-limit"
  | "coordinate-out-of-range"
  | "route-point-limit"
  | "candidate-no-op"
  | "request-size-limit"
  | "response-size-limit"
  | "token-budget-exceeded"
  | "cycle-limit"
  | "call-time-budget"
  | "cycle-time-budget"
  | "renderer-unavailable"
  | "renderer-failed"
  | "renderer-response-invalid"
  | "score-unavailable"
  | "score-failed"
  | "score-response-invalid"
  | "artifact-mismatch";

export type PresentationDiagnostic = {
  code: PresentationDiagnosticCode;
  message: string;
  path?: string;
};

export type PresentationValidationResult =
  | {
      accepted: true;
      patch: PresentationCandidatePatch;
      changeCount: number;
      fieldCount: number;
    }
  | {
      accepted: false;
      diagnostics: PresentationDiagnostic[];
    };

export type PresentationDiffItem = {
  elementId: string;
  field: PresentationField;
  operation: "set" | "unset";
  before: PresentationJsonValue | null;
  after: PresentationJsonValue | null;
};

export type PresentationCandidateDiff = {
  binding: PresentationSceneBinding;
  candidateId: string;
  changeCount: number;
  fieldCount: number;
  items: PresentationDiffItem[];
};

export type PresentationCoordinatePolicy = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minWidth: number;
  maxWidth: number;
  minHeight: number;
  maxHeight: number;
  maxOffsetMagnitude: number;
  maxRoutePoints: number;
};

export type PresentationTokenBudget = {
  maxInputTokens: number;
  maxCachedInputTokens: number;
  maxOutputTokens: number;
  maxReasoningTokens: number;
  maxTotalTokens: number;
};

export type PresentationToolPolicy = {
  maxTargetsPerSummary: number;
  maxOptionsPerSummary: number;
  maxLabelCharacters: number;
  maxPatchChanges: number;
  maxPatchFields: number;
  maxRequestBytes: number;
  maxResponseBytes: number;
  maxRenderInputBytes: number;
  maxCallDurationMs: number;
  maxCycleDurationMs: number;
  maxCycles: number;
  maxCallsPerCycle: number;
  maxCycleRequestBytes: number;
  maxCycleResponseBytes: number;
  coordinates: PresentationCoordinatePolicy;
  tokens: PresentationTokenBudget;
};

export type PresentationTargetSummary = {
  elementId: string;
  kind: PresentationElementKind;
  label: string;
  geometry?: PresentationGeometry;
  parentElementId?: string;
  sourceElementId?: string;
  targetElementId?: string;
  availableFields: PresentationField[];
};

export type PresentationOptionSummary = Pick<PresentationOption, "optionId" | "label" | "summary">;

export type PresentationContextSummary = {
  binding: PresentationSceneBinding;
  scene: {
    width: number;
    height: number;
    counts: Record<PresentationElementKind, number>;
  };
  targets: PresentationTargetSummary[];
  omittedTargetCount: number;
  capabilities: {
    templates: PresentationOptionSummary[];
    icons: PresentationOptionSummary[];
    styles: PresentationOptionSummary[];
    routeModes: NonNullable<PresentationRouting["routeMode"]>[];
    markers: NonNullable<PresentationRouting["sourceMarker"]>[];
    omittedOptionCount: number;
  };
};

export type CandidateRenderInput = {
  binding: PresentationSceneBinding;
  scene: PresentationSceneSnapshot;
  patch: PresentationCandidatePatch;
  diff: PresentationCandidateDiff;
};

export type CandidateScreenshot = {
  screenshotId: string;
  mediaType: "image/png" | "image/webp";
  width: number;
  height: number;
  renderFingerprint?: string;
};

export interface PresentationCandidateRenderer {
  render(input: CandidateRenderInput, signal: AbortSignal): Promise<CandidateScreenshot>;
}

export type CandidateScoreRequest = {
  binding: PresentationSceneBinding;
  candidateId: string;
  screenshotId: string;
  referenceImageId?: string;
  rubricIds?: string[];
};

export type CandidateScore = {
  overall: number;
  dimensions?: Record<string, number>;
  summary?: string;
};

export interface PresentationCandidateScorer {
  score(input: CandidateScoreRequest, signal: AbortSignal): Promise<CandidateScore>;
}

export type PresentationTokenUsage = {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
};

export type PresentationInputCacheClass = "none" | "miss" | "partial" | "hit";

export type PresentationToolOperation = "summary" | "validate" | "diff" | "render" | "score";

export type PresentationCallTelemetry = {
  kind: "call";
  sessionId: string;
  binding: PresentationSceneBinding;
  cycleId: string;
  callId: string;
  operation: PresentationToolOperation;
  inputCache: PresentationInputCacheClass;
  status: "accepted" | "rejected" | "timeout" | "error";
  startedAtMs: number;
  endedAtMs: number;
  latencyMs: number;
  requestBytes: number;
  responseBytes: number;
  patchChangeCount: number;
  patchFieldCount: number;
  output: {
    accepted: boolean;
    diagnosticCodes?: PresentationDiagnosticCode[];
    screenshotId?: string;
    score?: number;
  };
};

export type PresentationCycleTelemetry = {
  kind: "cycle";
  sessionId: string;
  binding: PresentationSceneBinding;
  cycleId: string;
  inputCache: PresentationInputCacheClass;
  status: "completed" | "rejected" | "timeout" | "error";
  startedAtMs: number;
  endedAtMs: number;
  latencyMs: number;
  callCount: number;
  requestBytes: number;
  responseBytes: number;
  patchChangeCount: number;
  tokens: PresentationTokenUsage;
};

export type PresentationTelemetryEvent = PresentationCallTelemetry | PresentationCycleTelemetry;

export interface PresentationTelemetrySink {
  record(event: PresentationTelemetryEvent): void;
}

export type PresentationToolResult<T> =
  | { accepted: true; value: T }
  | { accepted: false; diagnostics: PresentationDiagnostic[] };
