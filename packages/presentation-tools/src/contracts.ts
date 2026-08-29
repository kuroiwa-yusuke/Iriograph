import {
  ELEMENT_KINDS,
  SAFE_COLOR,
  SAFE_DASH,
  clone,
  compareCodePoints,
  deepFreeze,
  diagnose,
  finiteNumber,
  integer,
  isRecord,
  oneOf,
  parseBinding,
  rejectUnknownKeys,
  requiredString,
  requireRecord,
} from "./internal.js";
import {
  PRESENTATION_FIELDS,
  type PresentationAppearance,
  type PresentationCapabilitySet,
  type PresentationCoordinatePolicy,
  type PresentationCurve,
  type PresentationDiagnostic,
  type PresentationElementKind,
  type PresentationElementState,
  type PresentationField,
  type PresentationGeometry,
  type PresentationOption,
  type PresentationPoint,
  type PresentationRouting,
  type PresentationSceneElement,
  type PresentationSceneMembership,
  type PresentationSceneSnapshot,
  type PresentationStyle,
  type PresentationTokenBudget,
  type PresentationToolPolicy,
} from "./model.js";

const ROUTE_MODES = ["auto", "straight", "orthogonal", "curve", "manual"] as const;
const MARKERS = ["none", "arrow", "open-arrow", "triangle", "diamond", "circle"] as const;
const LABEL_PLACEMENTS = ["top", "right", "bottom", "left", "center"] as const;
const WRITING_DIRECTIONS = ["horizontal-right", "vertical-down"] as const;

export const DEFAULT_PRESENTATION_TOOL_POLICY: Readonly<PresentationToolPolicy> = deepFreeze({
  maxTargetsPerSummary: 40,
  maxOptionsPerSummary: 30,
  maxLabelCharacters: 120,
  maxPatchChanges: 100,
  maxPatchFields: 800,
  maxRequestBytes: 128 * 1024,
  maxResponseBytes: 256 * 1024,
  maxRenderInputBytes: 2 * 1024 * 1024,
  maxCallDurationMs: 15_000,
  maxCycleDurationMs: 90_000,
  maxCycles: 24,
  maxCallsPerCycle: 24,
  maxCycleRequestBytes: 512 * 1024,
  maxCycleResponseBytes: 1024 * 1024,
  coordinates: {
    minX: -1_000_000,
    maxX: 1_000_000,
    minY: -1_000_000,
    maxY: 1_000_000,
    minWidth: 1,
    maxWidth: 100_000,
    minHeight: 1,
    maxHeight: 100_000,
    maxOffsetMagnitude: 100_000,
    maxRoutePoints: 128,
  },
  tokens: {
    maxInputTokens: 200_000,
    maxCachedInputTokens: 200_000,
    maxOutputTokens: 32_000,
    maxReasoningTokens: 32_000,
    maxTotalTokens: 240_000,
  },
});

export class PresentationContractError extends Error {
  readonly diagnostics: readonly PresentationDiagnostic[];

  constructor(message: string, diagnostics: readonly PresentationDiagnostic[]) {
    super(message);
    this.name = "PresentationContractError";
    this.diagnostics = deepFreeze(clone(diagnostics));
  }
}

export function definePresentationToolPolicy(value: unknown): Readonly<PresentationToolPolicy> {
  const diagnostics: PresentationDiagnostic[] = [];
  const parsed = parsePolicy(value, diagnostics);
  if (!parsed || diagnostics.length > 0) {
    throw new PresentationContractError("Invalid presentation tool policy.", diagnostics);
  }
  return deepFreeze(parsed);
}

export function definePresentationCapabilities(value: unknown): Readonly<PresentationCapabilitySet> {
  const diagnostics: PresentationDiagnostic[] = [];
  const parsed = parseCapabilities(value, diagnostics);
  if (!parsed || diagnostics.length > 0) {
    throw new PresentationContractError("Invalid presentation capability set.", diagnostics);
  }
  return deepFreeze(parsed);
}

export function definePresentationSceneSnapshot(value: unknown): Readonly<PresentationSceneSnapshot> {
  const diagnostics: PresentationDiagnostic[] = [];
  const parsed = parseScene(value, diagnostics);
  if (!parsed || diagnostics.length > 0) {
    throw new PresentationContractError("Invalid presentation Scene snapshot.", diagnostics);
  }
  return deepFreeze(parsed);
}

function parsePolicy(value: unknown, diagnostics: PresentationDiagnostic[]): PresentationToolPolicy | undefined {
  const path = "/policy";
  const record = requireRecord(value, diagnostics, path);
  if (!record) return undefined;
  const scalarKeys = [
    "maxTargetsPerSummary",
    "maxOptionsPerSummary",
    "maxLabelCharacters",
    "maxPatchChanges",
    "maxPatchFields",
    "maxRequestBytes",
    "maxResponseBytes",
    "maxRenderInputBytes",
    "maxCallDurationMs",
    "maxCycleDurationMs",
    "maxCycles",
    "maxCallsPerCycle",
    "maxCycleRequestBytes",
    "maxCycleResponseBytes",
  ] as const;
  rejectUnknownKeys(record, [...scalarKeys, "coordinates", "tokens"], diagnostics, path);
  const scalars = Object.fromEntries(scalarKeys.map((key) => [
    key,
    integer(record[key], diagnostics, `${path}/${key}`, 1),
  ])) as Record<typeof scalarKeys[number], number | undefined>;
  const coordinates = parseCoordinatePolicy(record.coordinates, diagnostics, `${path}/coordinates`);
  const tokens = parseTokenBudget(record.tokens, diagnostics, `${path}/tokens`);
  if (Object.values(scalars).some((entry) => entry === undefined) || !coordinates || !tokens) return undefined;
  if (scalars.maxCallDurationMs! > scalars.maxCycleDurationMs!) {
    diagnose(diagnostics, "invalid-value", "maxCallDurationMs cannot exceed maxCycleDurationMs.", `${path}/maxCallDurationMs`);
  }
  if (scalars.maxRequestBytes! > scalars.maxCycleRequestBytes!) {
    diagnose(diagnostics, "invalid-value", "maxRequestBytes cannot exceed maxCycleRequestBytes.", `${path}/maxRequestBytes`);
  }
  if (scalars.maxResponseBytes! > scalars.maxCycleResponseBytes!) {
    diagnose(diagnostics, "invalid-value", "maxResponseBytes cannot exceed maxCycleResponseBytes.", `${path}/maxResponseBytes`);
  }
  return {
    maxTargetsPerSummary: scalars.maxTargetsPerSummary!,
    maxOptionsPerSummary: scalars.maxOptionsPerSummary!,
    maxLabelCharacters: scalars.maxLabelCharacters!,
    maxPatchChanges: scalars.maxPatchChanges!,
    maxPatchFields: scalars.maxPatchFields!,
    maxRequestBytes: scalars.maxRequestBytes!,
    maxResponseBytes: scalars.maxResponseBytes!,
    maxRenderInputBytes: scalars.maxRenderInputBytes!,
    maxCallDurationMs: scalars.maxCallDurationMs!,
    maxCycleDurationMs: scalars.maxCycleDurationMs!,
    maxCycles: scalars.maxCycles!,
    maxCallsPerCycle: scalars.maxCallsPerCycle!,
    maxCycleRequestBytes: scalars.maxCycleRequestBytes!,
    maxCycleResponseBytes: scalars.maxCycleResponseBytes!,
    coordinates,
    tokens,
  };
}

function parseCoordinatePolicy(
  value: unknown,
  diagnostics: PresentationDiagnostic[],
  path: string,
): PresentationCoordinatePolicy | undefined {
  const record = requireRecord(value, diagnostics, path);
  if (!record) return undefined;
  const numericKeys = [
    "minX", "maxX", "minY", "maxY", "minWidth", "maxWidth", "minHeight", "maxHeight", "maxOffsetMagnitude",
  ] as const;
  rejectUnknownKeys(record, [...numericKeys, "maxRoutePoints"], diagnostics, path);
  const parsed = Object.fromEntries(numericKeys.map((key) => [
    key,
    finiteNumber(record[key], diagnostics, `${path}/${key}`),
  ])) as Record<typeof numericKeys[number], number | undefined>;
  const maxRoutePoints = integer(record.maxRoutePoints, diagnostics, `${path}/maxRoutePoints`, 1);
  if (Object.values(parsed).some((entry) => entry === undefined) || maxRoutePoints === undefined) return undefined;
  if (parsed.minX! > parsed.maxX! || parsed.minY! > parsed.maxY!
    || parsed.minWidth! <= 0 || parsed.minWidth! > parsed.maxWidth!
    || parsed.minHeight! <= 0 || parsed.minHeight! > parsed.maxHeight!
    || parsed.maxOffsetMagnitude! < 0) {
    diagnose(diagnostics, "invalid-value", "Coordinate policy ranges are inconsistent.", path);
  }
  return {
    minX: parsed.minX!, maxX: parsed.maxX!, minY: parsed.minY!, maxY: parsed.maxY!,
    minWidth: parsed.minWidth!, maxWidth: parsed.maxWidth!,
    minHeight: parsed.minHeight!, maxHeight: parsed.maxHeight!,
    maxOffsetMagnitude: parsed.maxOffsetMagnitude!, maxRoutePoints,
  };
}

function parseTokenBudget(
  value: unknown,
  diagnostics: PresentationDiagnostic[],
  path: string,
): PresentationTokenBudget | undefined {
  const record = requireRecord(value, diagnostics, path);
  if (!record) return undefined;
  const keys = ["maxInputTokens", "maxCachedInputTokens", "maxOutputTokens", "maxReasoningTokens", "maxTotalTokens"] as const;
  rejectUnknownKeys(record, keys, diagnostics, path);
  const parsed = Object.fromEntries(keys.map((key) => [key, integer(record[key], diagnostics, `${path}/${key}`, 0)])) as Record<typeof keys[number], number | undefined>;
  if (Object.values(parsed).some((entry) => entry === undefined)) return undefined;
  if (parsed.maxCachedInputTokens! > parsed.maxInputTokens!) {
    diagnose(diagnostics, "invalid-value", "Cached input cannot exceed the input token budget.", `${path}/maxCachedInputTokens`);
  }
  return {
    maxInputTokens: parsed.maxInputTokens!, maxCachedInputTokens: parsed.maxCachedInputTokens!,
    maxOutputTokens: parsed.maxOutputTokens!, maxReasoningTokens: parsed.maxReasoningTokens!,
    maxTotalTokens: parsed.maxTotalTokens!,
  };
}

function parseCapabilities(value: unknown, diagnostics: PresentationDiagnostic[]): PresentationCapabilitySet | undefined {
  const path = "/capabilities";
  const record = requireRecord(value, diagnostics, path);
  if (!record) return undefined;
  rejectUnknownKeys(record, ["contextRevision", "fieldRules", "templates", "icons", "styles", "routeModes", "markers"], diagnostics, path);
  const contextRevision = requiredString(record.contextRevision, diagnostics, `${path}/contextRevision`);
  const fieldRules = parseFieldRules(record.fieldRules, diagnostics, `${path}/fieldRules`);
  const templates = parseOptions(record.templates, diagnostics, `${path}/templates`);
  const icons = parseOptions(record.icons, diagnostics, `${path}/icons`);
  const styles = parseOptions(record.styles, diagnostics, `${path}/styles`);
  const routeModes = parseEnumArray(record.routeModes, ROUTE_MODES, diagnostics, `${path}/routeModes`);
  const markers = parseEnumArray(record.markers, MARKERS, diagnostics, `${path}/markers`);
  if (!contextRevision || !fieldRules) return undefined;
  return {
    contextRevision,
    fieldRules,
    ...(templates ? { templates } : {}),
    ...(icons ? { icons } : {}),
    ...(styles ? { styles } : {}),
    ...(routeModes ? { routeModes } : {}),
    ...(markers ? { markers } : {}),
  };
}

function parseFieldRules(value: unknown, diagnostics: PresentationDiagnostic[], path: string) {
  if (!Array.isArray(value) || value.length === 0) {
    diagnose(diagnostics, "invalid-value", "At least one presentation field rule is required.", path);
    return undefined;
  }
  const seen = new Set<string>();
  const rules: PresentationCapabilitySet["fieldRules"] = [];
  value.forEach((item, index) => {
    const itemPath = `${path}/${index}`;
    const record = requireRecord(item, diagnostics, itemPath);
    if (!record) return;
    rejectUnknownKeys(record, ["field", "elementKinds"], diagnostics, itemPath);
    const field = oneOf(record.field, PRESENTATION_FIELDS, diagnostics, `${itemPath}/field`);
    const elementKinds = parseEnumArray(record.elementKinds, ELEMENT_KINDS, diagnostics, `${itemPath}/elementKinds`, true);
    if (!field || !elementKinds) return;
    for (const kind of elementKinds) {
      if (!presentationFieldAppliesToKind(field, kind)) {
        diagnose(diagnostics, "invalid-value", `Field ${field} cannot apply to ${kind}.`, `${itemPath}/elementKinds`);
      }
    }
    const key = `${field}\u0000${[...elementKinds].sort(compareCodePoints).join(",")}`;
    if (seen.has(key)) diagnose(diagnostics, "invalid-value", "Duplicate field rule.", itemPath);
    seen.add(key);
    rules.push({ field, elementKinds });
  });
  return rules;
}

function parseOptions(value: unknown, diagnostics: PresentationDiagnostic[], path: string): PresentationOption[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    diagnose(diagnostics, "invalid-value", "Expected an option array.", path);
    return undefined;
  }
  const options: PresentationOption[] = [];
  const seen = new Set<string>();
  value.forEach((item, index) => {
    const itemPath = `${path}/${index}`;
    const record = requireRecord(item, diagnostics, itemPath);
    if (!record) return;
    rejectUnknownKeys(record, ["optionId", "label", "summary", "elementKinds"], diagnostics, itemPath);
    const optionId = requiredString(record.optionId, diagnostics, `${itemPath}/optionId`, { opaque: true });
    const label = requiredString(record.label, diagnostics, `${itemPath}/label`, { maxLength: 500 });
    const summary = record.summary === undefined
      ? undefined
      : requiredString(record.summary, diagnostics, `${itemPath}/summary`, { maxLength: 1000 });
    const elementKinds = parseEnumArray(record.elementKinds, ELEMENT_KINDS, diagnostics, `${itemPath}/elementKinds`, true);
    if (!optionId || !label || !elementKinds) return;
    if (seen.has(optionId)) diagnose(diagnostics, "invalid-value", "Duplicate option ID.", `${itemPath}/optionId`);
    seen.add(optionId);
    options.push({ optionId, label, ...(summary ? { summary } : {}), elementKinds });
  });
  return options;
}

function parseEnumArray<T extends string>(
  value: unknown,
  allowed: readonly T[],
  diagnostics: PresentationDiagnostic[],
  path: string,
  required = false,
): T[] | undefined {
  if (value === undefined && !required) return undefined;
  if (!Array.isArray(value) || (required && value.length === 0)) {
    diagnose(diagnostics, "invalid-value", required ? "Expected a non-empty array." : "Expected an array.", path);
    return undefined;
  }
  const result: T[] = [];
  const seen = new Set<T>();
  value.forEach((entry, index) => {
    const parsed = oneOf(entry, allowed, diagnostics, `${path}/${index}`);
    if (parsed === undefined) return;
    if (seen.has(parsed)) diagnose(diagnostics, "invalid-value", "Duplicate array value.", `${path}/${index}`);
    seen.add(parsed);
    result.push(parsed);
  });
  return result;
}

function parseScene(value: unknown, diagnostics: PresentationDiagnostic[]): PresentationSceneSnapshot | undefined {
  const path = "/scene";
  const record = requireRecord(value, diagnostics, path);
  if (!record) return undefined;
  rejectUnknownKeys(record, ["binding", "width", "height", "elements", "memberships"], diagnostics, path);
  const binding = parseBinding(record.binding, diagnostics, `${path}/binding`);
  const width = finiteNumber(record.width, diagnostics, `${path}/width`);
  const height = finiteNumber(record.height, diagnostics, `${path}/height`);
  if (width !== undefined && width <= 0) diagnose(diagnostics, "invalid-value", "Scene width must be positive.", `${path}/width`);
  if (height !== undefined && height <= 0) diagnose(diagnostics, "invalid-value", "Scene height must be positive.", `${path}/height`);
  const elements = parseElements(record.elements, diagnostics, `${path}/elements`);
  const memberships = parseMemberships(record.memberships, diagnostics, `${path}/memberships`);
  if (!binding || width === undefined || height === undefined || !elements) return undefined;
  validateSceneReferences(elements, memberships ?? [], diagnostics);
  return { binding, width, height, elements, ...(memberships ? { memberships } : {}) };
}

function parseElements(value: unknown, diagnostics: PresentationDiagnostic[], path: string): PresentationSceneElement[] | undefined {
  if (!Array.isArray(value)) {
    diagnose(diagnostics, "invalid-value", "Expected a Scene element array.", path);
    return undefined;
  }
  const elements: PresentationSceneElement[] = [];
  const seen = new Set<string>();
  value.forEach((item, index) => {
    const itemPath = `${path}/${index}`;
    const record = requireRecord(item, diagnostics, itemPath);
    if (!record) return;
    rejectUnknownKeys(record, ["elementId", "kind", "label", "parentElementId", "sourceElementId", "targetElementId", "presentation"], diagnostics, itemPath);
    const elementId = requiredString(record.elementId, diagnostics, `${itemPath}/elementId`, { opaque: true });
    const kind = oneOf(record.kind, ELEMENT_KINDS, diagnostics, `${itemPath}/kind`);
    const label = typeof record.label === "string" && [...record.label].length <= 10_000
      ? record.label
      : undefined;
    if (label === undefined) diagnose(diagnostics, "invalid-value", "Expected a label up to 10000 characters.", `${itemPath}/label`);
    const parentElementId = record.parentElementId === undefined ? undefined : requiredString(record.parentElementId, diagnostics, `${itemPath}/parentElementId`, { opaque: true });
    const sourceElementId = record.sourceElementId === undefined ? undefined : requiredString(record.sourceElementId, diagnostics, `${itemPath}/sourceElementId`, { opaque: true });
    const targetElementId = record.targetElementId === undefined ? undefined : requiredString(record.targetElementId, diagnostics, `${itemPath}/targetElementId`, { opaque: true });
    const presentation = parseState(record.presentation, diagnostics, `${itemPath}/presentation`);
    if (!elementId || !kind || label === undefined || !presentation) return;
    if (seen.has(elementId)) diagnose(diagnostics, "invalid-value", "Duplicate Scene element ID.", `${itemPath}/elementId`);
    seen.add(elementId);
    if (kind === "edge") {
      if (!sourceElementId || !targetElementId) diagnose(diagnostics, "invalid-value", "Edges require sourceElementId and targetElementId.", itemPath);
      if (parentElementId !== undefined) diagnose(diagnostics, "invalid-value", "Edges cannot have parentElementId.", `${itemPath}/parentElementId`);
    } else if (sourceElementId !== undefined || targetElementId !== undefined) {
      diagnose(diagnostics, "invalid-value", "Only edges can have source/target element IDs.", itemPath);
    }
    validateStateForKind(presentation, kind, diagnostics, `${itemPath}/presentation`);
    elements.push({
      elementId, kind, label, presentation,
      ...(parentElementId ? { parentElementId } : {}),
      ...(sourceElementId ? { sourceElementId } : {}),
      ...(targetElementId ? { targetElementId } : {}),
    });
  });
  return elements;
}

function validateStateForKind(
  state: PresentationElementState,
  kind: PresentationElementKind,
  diagnostics: PresentationDiagnostic[],
  path: string,
): void {
  for (const field of state.geometry !== undefined ? ["geometry"] as const : []) {
    if (!presentationFieldAppliesToKind(field, kind)) diagnose(diagnostics, "invalid-value", `${field} cannot apply to ${kind}.`, `${path}/${field}`);
  }
  for (const field of ["pinned", "placement"] as const) {
    if (state[field] !== undefined && !presentationFieldAppliesToKind(field, kind)) diagnose(diagnostics, "invalid-value", `${field} cannot apply to ${kind}.`, `${path}/${field}`);
  }
  if (state.routing !== undefined && kind !== "edge") diagnose(diagnostics, "invalid-value", `routing cannot apply to ${kind}.`, `${path}/routing`);
  if (!state.appearance) return;
  for (const key of Object.keys(state.appearance)) {
    if (key === "style") continue;
    const field = `appearance.${key}` as PresentationField;
    if (!presentationFieldAppliesToKind(field, kind)) diagnose(diagnostics, "invalid-value", `${field} cannot apply to ${kind}.`, `${path}/appearance/${key}`);
  }
}

function parseMemberships(value: unknown, diagnostics: PresentationDiagnostic[], path: string): PresentationSceneMembership[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    diagnose(diagnostics, "invalid-value", "Expected a membership array.", path);
    return undefined;
  }
  const memberships: PresentationSceneMembership[] = [];
  value.forEach((item, index) => {
    const itemPath = `${path}/${index}`;
    const record = requireRecord(item, diagnostics, itemPath);
    if (!record) return;
    rejectUnknownKeys(record, ["groupElementId", "memberElementId", "role", "ordinal"], diagnostics, itemPath);
    const groupElementId = requiredString(record.groupElementId, diagnostics, `${itemPath}/groupElementId`, { opaque: true });
    const memberElementId = requiredString(record.memberElementId, diagnostics, `${itemPath}/memberElementId`, { opaque: true });
    const role = oneOf(record.role, ["membership", "sequence-member", "alternative-member"] as const, diagnostics, `${itemPath}/role`);
    const ordinal = record.ordinal === undefined ? undefined : integer(record.ordinal, diagnostics, `${itemPath}/ordinal`, 1);
    if (groupElementId && memberElementId && role) memberships.push({ groupElementId, memberElementId, role, ...(ordinal ? { ordinal } : {}) });
  });
  return memberships;
}

function validateSceneReferences(
  elements: PresentationSceneElement[],
  memberships: PresentationSceneMembership[],
  diagnostics: PresentationDiagnostic[],
): void {
  const byId = new Map(elements.map((element) => [element.elementId, element]));
  elements.forEach((element, index) => {
    if (element.parentElementId) {
      const parent = byId.get(element.parentElementId);
      if (!parent || !["container", "region"].includes(parent.kind) || parent.elementId === element.elementId) {
        diagnose(diagnostics, "invalid-value", "parentElementId must resolve to a different group element.", `/scene/elements/${index}/parentElementId`);
      }
    }
    if (element.kind === "edge") {
      for (const [key, endpoint] of [["sourceElementId", element.sourceElementId], ["targetElementId", element.targetElementId]] as const) {
        const target = endpoint ? byId.get(endpoint) : undefined;
        if (!target || target.kind === "edge") diagnose(diagnostics, "invalid-value", `${key} must resolve to a non-edge element.`, `/scene/elements/${index}/${key}`);
      }
    }
  });
  const seen = new Set<string>();
  memberships.forEach((membership, index) => {
    const group = byId.get(membership.groupElementId);
    const member = byId.get(membership.memberElementId);
    if (!group || !["container", "region"].includes(group.kind)) diagnose(diagnostics, "invalid-value", "Membership group is unresolved.", `/scene/memberships/${index}/groupElementId`);
    if (!member || member.kind === "edge") diagnose(diagnostics, "invalid-value", "Membership member is unresolved or an edge.", `/scene/memberships/${index}/memberElementId`);
    const key = `${membership.groupElementId}\u0000${membership.memberElementId}\u0000${membership.role}\u0000${membership.ordinal ?? ""}`;
    if (seen.has(key)) diagnose(diagnostics, "invalid-value", "Duplicate membership.", `/scene/memberships/${index}`);
    seen.add(key);
  });
}

function parseState(value: unknown, diagnostics: PresentationDiagnostic[], path: string): PresentationElementState | undefined {
  const record = requireRecord(value, diagnostics, path);
  if (!record) return undefined;
  rejectUnknownKeys(record, ["geometry", "pinned", "placement", "appearance", "routing"], diagnostics, path);
  const geometry = record.geometry === undefined ? undefined : parseGeometry(record.geometry, diagnostics, `${path}/geometry`);
  const pinned = record.pinned === undefined ? undefined : typeof record.pinned === "boolean" ? record.pinned : undefined;
  if (record.pinned !== undefined && pinned === undefined) diagnose(diagnostics, "invalid-value", "Expected a boolean.", `${path}/pinned`);
  const placement = record.placement === undefined ? undefined : oneOf(record.placement, ["generated", "user"] as const, diagnostics, `${path}/placement`);
  const appearance = record.appearance === undefined ? undefined : parseAppearance(record.appearance, diagnostics, `${path}/appearance`);
  const routing = record.routing === undefined ? undefined : parseRouting(record.routing, diagnostics, `${path}/routing`);
  return {
    ...(geometry ? { geometry } : {}), ...(pinned !== undefined ? { pinned } : {}),
    ...(placement ? { placement } : {}), ...(appearance ? { appearance } : {}), ...(routing ? { routing } : {}),
  };
}

export function parseGeometry(value: unknown, diagnostics: PresentationDiagnostic[], path: string): PresentationGeometry | undefined {
  const record = requireRecord(value, diagnostics, path);
  if (!record) return undefined;
  rejectUnknownKeys(record, ["x", "y", "width", "height"], diagnostics, path);
  const x = finiteNumber(record.x, diagnostics, `${path}/x`);
  const y = finiteNumber(record.y, diagnostics, `${path}/y`);
  const width = finiteNumber(record.width, diagnostics, `${path}/width`);
  const height = finiteNumber(record.height, diagnostics, `${path}/height`);
  if (width !== undefined && width <= 0) diagnose(diagnostics, "invalid-value", "Width must be positive.", `${path}/width`);
  if (height !== undefined && height <= 0) diagnose(diagnostics, "invalid-value", "Height must be positive.", `${path}/height`);
  return x === undefined || y === undefined || width === undefined || height === undefined ? undefined : { x, y, width, height };
}

export function parsePoint(value: unknown, diagnostics: PresentationDiagnostic[], path: string): PresentationPoint | undefined {
  const record = requireRecord(value, diagnostics, path);
  if (!record) return undefined;
  rejectUnknownKeys(record, ["x", "y"], diagnostics, path);
  const x = finiteNumber(record.x, diagnostics, `${path}/x`);
  const y = finiteNumber(record.y, diagnostics, `${path}/y`);
  return x === undefined || y === undefined ? undefined : { x, y };
}

export function parseStyle(value: unknown, diagnostics: PresentationDiagnostic[], path: string): PresentationStyle | undefined {
  const record = requireRecord(value, diagnostics, path);
  if (!record) return undefined;
  const keys = ["fill", "stroke", "text", "accent", "fillOpacity", "strokeWidth", "labelFontSize", "dash"] as const;
  rejectUnknownKeys(record, keys, diagnostics, path);
  const style: PresentationStyle = {};
  for (const key of ["fill", "stroke", "text", "accent"] as const) {
    const entry = record[key];
    if (entry === undefined) continue;
    if (typeof entry !== "string" || !SAFE_COLOR.test(entry)) diagnose(diagnostics, "unsafe-value", "Only the closed safe color vocabulary is accepted.", `${path}/${key}`);
    else style[key] = entry;
  }
  if (record.fillOpacity !== undefined) {
    const entry = finiteNumber(record.fillOpacity, diagnostics, `${path}/fillOpacity`);
    if (entry !== undefined && (entry < 0 || entry > 1)) diagnose(diagnostics, "invalid-value", "fillOpacity must be from 0 to 1.", `${path}/fillOpacity`);
    else if (entry !== undefined) style.fillOpacity = entry;
  }
  if (record.strokeWidth !== undefined) {
    const entry = finiteNumber(record.strokeWidth, diagnostics, `${path}/strokeWidth`);
    if (entry !== undefined && (entry < 0 || entry > 20)) diagnose(diagnostics, "invalid-value", "strokeWidth must be from 0 to 20.", `${path}/strokeWidth`);
    else if (entry !== undefined) style.strokeWidth = entry;
  }
  if (record.labelFontSize !== undefined) {
    const entry = finiteNumber(record.labelFontSize, diagnostics, `${path}/labelFontSize`);
    if (entry !== undefined && (entry < 8 || entry > 72)) diagnose(diagnostics, "invalid-value", "labelFontSize must be from 8 to 72.", `${path}/labelFontSize`);
    else if (entry !== undefined) style.labelFontSize = entry;
  }
  if (record.dash !== undefined) {
    if (typeof record.dash !== "string" || record.dash.length > 64 || !SAFE_DASH.test(record.dash)) diagnose(diagnostics, "unsafe-value", "dash must be a safe numeric dash list.", `${path}/dash`);
    else style.dash = record.dash;
  }
  return style;
}

export function parseAppearance(value: unknown, diagnostics: PresentationDiagnostic[], path: string): PresentationAppearance | undefined {
  const record = requireRecord(value, diagnostics, path);
  if (!record) return undefined;
  const keys = ["templateOptionId", "iconOptionId", "styleOptionId", "style", "labelPlacement", "nodeLabelOffset", "nodeLabelWritingDirection", "nodeIconOffset", "nodeIconScale", "nodeIconSize", "nodeIconFit", "groupLabelAnchor", "groupLabelOffset", "groupLabelWritingDirection", "groupIconOffset", "groupIconScale", "groupZOrder", "regionLabelAnchor", "regionLabelWritingDirection", "regionZOrder", "edgeCaption"] as const;
  rejectUnknownKeys(record, keys, diagnostics, path);
  const appearance: PresentationAppearance = {};
  for (const key of ["templateOptionId", "iconOptionId", "styleOptionId"] as const) {
    if (record[key] !== undefined) {
      const parsed = requiredString(record[key], diagnostics, `${path}/${key}`, { opaque: true });
      if (parsed) appearance[key] = parsed;
    }
  }
  if (record.style !== undefined) appearance.style = parseStyle(record.style, diagnostics, `${path}/style`);
  if (record.labelPlacement !== undefined) appearance.labelPlacement = oneOf(record.labelPlacement, LABEL_PLACEMENTS, diagnostics, `${path}/labelPlacement`);
  for (const key of ["nodeLabelOffset", "nodeIconOffset", "groupIconOffset"] as const) {
    if (record[key] !== undefined) appearance[key] = parsePoint(record[key], diagnostics, `${path}/${key}`);
  }
  for (const key of ["nodeLabelWritingDirection", "groupLabelWritingDirection", "regionLabelWritingDirection"] as const) {
    if (record[key] !== undefined) appearance[key] = oneOf(record[key], WRITING_DIRECTIONS, diagnostics, `${path}/${key}`);
  }
  for (const key of ["nodeIconScale", "groupIconScale", "groupLabelAnchor", "groupLabelOffset", "regionLabelAnchor"] as const) {
    if (record[key] !== undefined) {
      const parsed = finiteNumber(record[key], diagnostics, `${path}/${key}`);
      if (parsed !== undefined) appearance[key] = parsed;
    }
  }
  if (record.nodeIconSize !== undefined) {
    const size = requireRecord(record.nodeIconSize, diagnostics, `${path}/nodeIconSize`);
    if (size) {
      rejectUnknownKeys(size, ["width", "height"], diagnostics, `${path}/nodeIconSize`);
      const width = finiteNumber(size.width, diagnostics, `${path}/nodeIconSize/width`);
      const height = finiteNumber(size.height, diagnostics, `${path}/nodeIconSize/height`);
      if (width !== undefined && height !== undefined) appearance.nodeIconSize = { width, height };
    }
  }
  if (record.nodeIconFit !== undefined) appearance.nodeIconFit = oneOf(record.nodeIconFit, ["contain", "cover"] as const, diagnostics, `${path}/nodeIconFit`);
  for (const key of ["groupZOrder", "regionZOrder"] as const) {
    if (record[key] !== undefined) {
      const parsed = integer(record[key], diagnostics, `${path}/${key}`);
      if (parsed !== undefined) appearance[key] = parsed;
    }
  }
  if (record.edgeCaption !== undefined) {
    if (typeof record.edgeCaption !== "string" || [...record.edgeCaption].length > 2000) diagnose(diagnostics, "invalid-value", "edgeCaption must be a string up to 2000 characters.", `${path}/edgeCaption`);
    else appearance.edgeCaption = record.edgeCaption;
  }
  validateAppearanceRanges(appearance, diagnostics, path);
  return appearance;
}

function validateAppearanceRanges(value: PresentationAppearance, diagnostics: PresentationDiagnostic[], path: string): void {
  for (const key of ["nodeIconScale", "groupIconScale"] as const) {
    const entry = value[key];
    if (entry !== undefined && (entry < 0.1 || entry > 8)) diagnose(diagnostics, "invalid-value", `${key} must be from 0.1 to 8.`, `${path}/${key}`);
  }
  if (value.nodeIconSize && (value.nodeIconSize.width < 4 || value.nodeIconSize.width > 4096 || value.nodeIconSize.height < 4 || value.nodeIconSize.height > 4096)) diagnose(diagnostics, "invalid-value", "nodeIconSize dimensions must be from 4 to 4096.", `${path}/nodeIconSize`);
  for (const key of ["groupLabelAnchor", "regionLabelAnchor"] as const) {
    const entry = value[key];
    if (entry !== undefined && (entry < 0 || entry >= 1)) diagnose(diagnostics, "invalid-value", `${key} must be from 0 (inclusive) to 1 (exclusive).`, `${path}/${key}`);
  }
  if (value.groupLabelOffset !== undefined && (value.groupLabelOffset < -1 || value.groupLabelOffset > 1)) diagnose(diagnostics, "invalid-value", "groupLabelOffset must be from -1 to 1.", `${path}/groupLabelOffset`);
  if (value.nodeIconScale !== undefined && value.nodeIconSize !== undefined) diagnose(diagnostics, "invalid-value", "nodeIconScale and nodeIconSize are mutually exclusive.", path);
}

export function parseRouting(value: unknown, diagnostics: PresentationDiagnostic[], path: string): PresentationRouting | undefined {
  const record = requireRecord(value, diagnostics, path);
  if (!record) return undefined;
  const keys = ["routeMode", "waypoints", "curve", "labelOffset", "sourceAnchor", "targetAnchor", "sourceMarker", "targetMarker"] as const;
  rejectUnknownKeys(record, keys, diagnostics, path);
  const routing: PresentationRouting = {};
  if (record.routeMode !== undefined) routing.routeMode = oneOf(record.routeMode, ROUTE_MODES, diagnostics, `${path}/routeMode`);
  if (record.waypoints !== undefined) routing.waypoints = parsePointArray(record.waypoints, diagnostics, `${path}/waypoints`);
  if (record.curve !== undefined) routing.curve = parseCurve(record.curve, diagnostics, `${path}/curve`);
  if (record.labelOffset !== undefined) routing.labelOffset = parsePoint(record.labelOffset, diagnostics, `${path}/labelOffset`);
  for (const key of ["sourceAnchor", "targetAnchor"] as const) {
    if (record[key] === undefined) continue;
    const anchor = requireRecord(record[key], diagnostics, `${path}/${key}`);
    if (!anchor) continue;
    rejectUnknownKeys(anchor, ["position"], diagnostics, `${path}/${key}`);
    const position = finiteNumber(anchor.position, diagnostics, `${path}/${key}/position`);
    if (position !== undefined && (position < 0 || position >= 1)) diagnose(diagnostics, "invalid-value", "Anchor position must be from 0 (inclusive) to 1 (exclusive).", `${path}/${key}/position`);
    else if (position !== undefined) routing[key] = { position };
  }
  for (const key of ["sourceMarker", "targetMarker"] as const) {
    if (record[key] !== undefined) routing[key] = oneOf(record[key], MARKERS, diagnostics, `${path}/${key}`);
  }
  if (routing.routeMode === "straight" && (routing.waypoints || routing.curve)) diagnose(diagnostics, "invalid-value", "Straight routing cannot include waypoints or curve controls.", path);
  if (routing.curve && routing.routeMode !== "curve") diagnose(diagnostics, "invalid-value", "Curve controls require routeMode curve.", path);
  if (routing.routeMode === "curve" && routing.waypoints) diagnose(diagnostics, "invalid-value", "Curve routing cannot include waypoints.", path);
  return routing;
}

export function parsePointArray(value: unknown, diagnostics: PresentationDiagnostic[], path: string): PresentationPoint[] | undefined {
  if (!Array.isArray(value)) {
    diagnose(diagnostics, "invalid-value", "Expected a point array.", path);
    return undefined;
  }
  const points: PresentationPoint[] = [];
  value.forEach((entry, index) => {
    const point = parsePoint(entry, diagnostics, `${path}/${index}`);
    if (point) points.push(point);
  });
  return points;
}

export function parseCurve(value: unknown, diagnostics: PresentationDiagnostic[], path: string): PresentationCurve | undefined {
  const record = requireRecord(value, diagnostics, path);
  if (!record) return undefined;
  rejectUnknownKeys(record, ["sourceHandle", "targetHandle", "knots"], diagnostics, path);
  const curve: PresentationCurve = {};
  if (record.sourceHandle !== undefined) curve.sourceHandle = parsePoint(record.sourceHandle, diagnostics, `${path}/sourceHandle`);
  if (record.targetHandle !== undefined) curve.targetHandle = parsePoint(record.targetHandle, diagnostics, `${path}/targetHandle`);
  if (record.knots !== undefined) {
    if (!Array.isArray(record.knots)) diagnose(diagnostics, "invalid-value", "Expected a knot array.", `${path}/knots`);
    else {
      curve.knots = [];
      record.knots.forEach((entry, index) => {
        const knotPath = `${path}/knots/${index}`;
        const knot = requireRecord(entry, diagnostics, knotPath);
        if (!knot) return;
        rejectUnknownKeys(knot, ["point", "incomingHandle", "outgoingHandle"], diagnostics, knotPath);
        const point = parsePoint(knot.point, diagnostics, `${knotPath}/point`);
        const incomingHandle = knot.incomingHandle === undefined ? undefined : parsePoint(knot.incomingHandle, diagnostics, `${knotPath}/incomingHandle`);
        const outgoingHandle = knot.outgoingHandle === undefined ? undefined : parsePoint(knot.outgoingHandle, diagnostics, `${knotPath}/outgoingHandle`);
        if (point) curve.knots!.push({ point, ...(incomingHandle ? { incomingHandle } : {}), ...(outgoingHandle ? { outgoingHandle } : {}) });
      });
    }
  }
  if (Object.keys(curve).length === 0) diagnose(diagnostics, "invalid-value", "Curve controls cannot be empty.", path);
  return curve;
}

export const contractConstants = {
  routeModes: ROUTE_MODES,
  markers: MARKERS,
  labelPlacements: LABEL_PLACEMENTS,
  writingDirections: WRITING_DIRECTIONS,
} as const;

export function capabilityFieldSet(
  capabilities: PresentationCapabilitySet,
  kind: PresentationElementKind,
): ReadonlySet<PresentationField> {
  return new Set(capabilities.fieldRules
    .filter((rule) => rule.elementKinds.includes(kind) && presentationFieldAppliesToKind(rule.field, kind))
    .map((rule) => rule.field));
}

export function presentationFieldAppliesToKind(
  field: PresentationField,
  kind: PresentationElementKind,
): boolean {
  if (field.startsWith("routing.") || field === "appearance.edgeCaption") return kind === "edge";
  if (field.startsWith("appearance.node")) return kind === "node";
  if (field.startsWith("appearance.group")) return kind === "container" || kind === "region";
  if (field.startsWith("appearance.region")) return kind === "region";
  if (field === "appearance.iconOptionId" || field === "appearance.labelPlacement") return kind !== "edge";
  if (field === "geometry" || field === "pinned" || field === "placement") return kind !== "edge";
  return true;
}

export function optionMap(options: readonly PresentationOption[] | undefined): ReadonlyMap<string, PresentationOption> {
  return new Map((options ?? []).map((option) => [option.optionId, option]));
}
