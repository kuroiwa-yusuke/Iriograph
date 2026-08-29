import {
  PresentationContractError,
  capabilityFieldSet,
  contractConstants,
  definePresentationCapabilities,
  definePresentationToolPolicy,
  optionMap,
  parseAppearance,
  parseCurve,
  parseGeometry,
  parsePoint,
  parsePointArray,
  parseRouting,
  parseStyle,
  presentationFieldAppliesToKind,
} from "./contracts.js";
import {
  bindingDiagnostics,
  clone,
  deepFreeze,
  diagnose,
  equalJson,
  finiteNumber,
  isRecord,
  jsonByteLength,
  jsonValue,
  oneOf,
  parseBinding,
  rejectUnknownKeys,
  requiredString,
  requireRecord,
} from "./internal.js";
import type {
  PresentationAppearance,
  PresentationAppearancePatch,
  PresentationCandidateDiff,
  PresentationCandidatePatch,
  PresentationCapabilitySet,
  PresentationDiagnostic,
  PresentationElementPatch,
  PresentationElementState,
  PresentationField,
  PresentationJsonValue,
  PresentationOption,
  PresentationRouting,
  PresentationRoutingPatch,
  PresentationStylePatch,
  PresentationToolPolicy,
  PresentationValidationResult,
} from "./model.js";
import { PresentationSceneIndex } from "./scene-index.js";

const CHANGE_KEYS = ["elementId", "geometry", "pinned", "placement", "appearance", "routing"] as const;
const APPEARANCE_KEYS = [
  "templateOptionId", "iconOptionId", "styleOptionId", "style", "labelPlacement", "nodeLabelOffset",
  "nodeLabelWritingDirection", "nodeIconOffset", "nodeIconScale", "nodeIconSize", "nodeIconFit",
  "groupLabelAnchor", "groupLabelOffset", "groupLabelWritingDirection", "groupIconOffset", "groupIconScale",
  "groupZOrder", "regionLabelAnchor", "regionLabelWritingDirection", "regionZOrder", "edgeCaption",
] as const;
const STYLE_KEYS = ["fill", "stroke", "text", "accent", "fillOpacity", "strokeWidth", "labelFontSize", "dash"] as const;
const ROUTING_KEYS = ["routeMode", "waypoints", "curve", "labelOffset", "sourceAnchor", "targetAnchor", "sourceMarker", "targetMarker"] as const;

export type AcceptedPresentationValidation = Extract<PresentationValidationResult, { accepted: true }>;

/** Validates unknown JSON as a closed, revision-bound presentation patch. */
export function validatePresentationCandidate(
  value: unknown,
  index: PresentationSceneIndex,
  capabilityInput: unknown,
  policyInput: unknown,
): PresentationValidationResult {
  let capabilities: Readonly<PresentationCapabilitySet>;
  let policy: Readonly<PresentationToolPolicy>;
  try {
    capabilities = definePresentationCapabilities(capabilityInput);
    policy = definePresentationToolPolicy(policyInput);
  } catch (cause) {
    if (cause instanceof PresentationContractError) return { accepted: false, diagnostics: [...cause.diagnostics] };
    throw cause;
  }
  const requestBytes = jsonByteLength(value);
  if (requestBytes > policy.maxRequestBytes) {
    return { accepted: false, diagnostics: [{ code: "request-size-limit", message: `Candidate request is ${requestBytes} bytes; limit is ${policy.maxRequestBytes}.` }] };
  }
  if (capabilities.contextRevision !== index.binding.contextRevision) {
    return { accepted: false, diagnostics: [{ code: "stale-context-revision", message: "Capabilities do not match the indexed context revision.", path: "/capabilities/contextRevision" }] };
  }
  const diagnostics: PresentationDiagnostic[] = [];
  const record = requireRecord(value, diagnostics, "");
  if (!record) return { accepted: false, diagnostics };
  rejectUnknownKeys(record, ["binding", "candidateId", "changes"], diagnostics, "");
  const binding = parseBinding(record.binding, diagnostics, "/binding");
  diagnostics.push(...bindingDiagnostics(binding, index.binding));
  const candidateId = requiredString(record.candidateId, diagnostics, "/candidateId", { opaque: true });
  if (!Array.isArray(record.changes) || record.changes.length === 0) {
    diagnose(diagnostics, "invalid-value", "A candidate requires at least one presentation change.", "/changes");
  }
  if (Array.isArray(record.changes) && record.changes.length > policy.maxPatchChanges) {
    diagnose(diagnostics, "patch-change-limit", `Patch has ${record.changes.length} changes; limit is ${policy.maxPatchChanges}.`, "/changes");
  }
  const changes: PresentationElementPatch[] = [];
  let fieldCount = 0;
  const seen = new Set<string>();
  if (Array.isArray(record.changes)) {
    record.changes.forEach((change, changeIndex) => {
      const parsed = parseChange(change, changeIndex, index, capabilities, policy, diagnostics);
      if (!parsed) return;
      if (seen.has(parsed.change.elementId)) {
        diagnose(diagnostics, "duplicate-target", `A candidate can change each element only once: ${parsed.change.elementId}`, `/changes/${changeIndex}/elementId`);
      }
      seen.add(parsed.change.elementId);
      fieldCount += parsed.fieldCount;
      changes.push(parsed.change);
    });
  }
  if (fieldCount > policy.maxPatchFields) {
    diagnose(diagnostics, "patch-field-limit", `Patch has ${fieldCount} explicit fields; limit is ${policy.maxPatchFields}.`, "/changes");
  }
  if (!binding || !candidateId || diagnostics.length > 0) return { accepted: false, diagnostics };
  const patch = deepFreeze({ binding, candidateId, changes });
  const validation: AcceptedPresentationValidation = {
    accepted: true,
    patch,
    changeCount: changes.length,
    fieldCount,
  };
  if (diffPresentationCandidate(index, validation).items.length === 0) {
    return { accepted: false, diagnostics: [{ code: "candidate-no-op", message: "The candidate does not change the indexed presentation state.", path: "/changes" }] };
  }
  return validation;
}

/** Produces a deterministic sparse overlay diff from an already accepted patch. */
export function diffPresentationCandidate(
  index: PresentationSceneIndex,
  validation: AcceptedPresentationValidation,
): PresentationCandidateDiff {
  index.assertBinding(validation.patch.binding);
  const items: PresentationCandidateDiff["items"] = [];
  for (const change of validation.patch.changes) {
    const element = index.get(change.elementId);
    if (!element) throw new PresentationContractError("Validated patch target disappeared.", [{ code: "target-unresolved", message: `Scene element is unresolved: ${change.elementId}` }]);
    for (const entry of explicitFields(change)) {
      const before = readStateField(element.presentation, entry.field);
      const after = entry.value === null ? null : jsonValue(entry.value);
      if (equalJson(before ?? null, after)) continue;
      items.push({
        elementId: change.elementId,
        field: entry.field,
        operation: entry.value === null ? "unset" : "set",
        before: before === undefined ? null : jsonValue(before),
        after,
      });
    }
  }
  return deepFreeze({
    binding: clone(validation.patch.binding),
    candidateId: validation.patch.candidateId,
    changeCount: validation.changeCount,
    fieldCount: items.length,
    items,
  });
}

function parseChange(
  value: unknown,
  indexNumber: number,
  index: PresentationSceneIndex,
  capabilities: PresentationCapabilitySet,
  policy: PresentationToolPolicy,
  diagnostics: PresentationDiagnostic[],
): { change: PresentationElementPatch; fieldCount: number } | undefined {
  const path = `/changes/${indexNumber}`;
  const record = requireRecord(value, diagnostics, path);
  if (!record) return undefined;
  rejectUnknownKeys(record, CHANGE_KEYS, diagnostics, path);
  const elementId = requiredString(record.elementId, diagnostics, `${path}/elementId`, { opaque: true });
  const element = elementId ? index.get(elementId) : undefined;
  if (elementId && !element) diagnose(diagnostics, "target-unresolved", `Scene element is unresolved: ${elementId}`, `${path}/elementId`);
  if (!elementId || !element) return undefined;
  const allowed = capabilityFieldSet(capabilities, element.kind);
  const change: PresentationElementPatch = { elementId };
  let fieldCount = 0;
  if ("geometry" in record) {
    checkField("geometry", element.kind, allowed, diagnostics, `${path}/geometry`);
    fieldCount += 1;
    if (record.geometry === null) change.geometry = null;
    else {
      const geometry = parseGeometry(record.geometry, diagnostics, `${path}/geometry`);
      if (geometry) {
        validateGeometryBounds(geometry, policy, diagnostics, `${path}/geometry`);
        change.geometry = geometry;
      }
    }
  }
  if ("pinned" in record) {
    checkField("pinned", element.kind, allowed, diagnostics, `${path}/pinned`);
    fieldCount += 1;
    if (record.pinned === null || typeof record.pinned === "boolean") change.pinned = record.pinned;
    else diagnose(diagnostics, "invalid-value", "Expected boolean or null.", `${path}/pinned`);
  }
  if ("placement" in record) {
    checkField("placement", element.kind, allowed, diagnostics, `${path}/placement`);
    fieldCount += 1;
    if (record.placement === null) change.placement = null;
    else {
      const placement = oneOf(record.placement, ["generated", "user"] as const, diagnostics, `${path}/placement`);
      if (placement) change.placement = placement;
    }
  }
  if ("appearance" in record) {
    const parsed = parseAppearancePatch(record.appearance, path, element.kind, allowed, capabilities, policy, diagnostics);
    if (parsed) {
      change.appearance = parsed.patch;
      fieldCount += parsed.fieldCount;
    }
  }
  if ("routing" in record) {
    const parsed = parseRoutingPatch(record.routing, path, element.kind, allowed, capabilities, policy, diagnostics);
    if (parsed) {
      change.routing = parsed.patch;
      fieldCount += parsed.fieldCount;
    }
  }
  if (fieldCount === 0) diagnose(diagnostics, "invalid-value", "A change must contain at least one presentation field.", path);
  validateEffectiveState(element.presentation, change, diagnostics, path);
  return { change, fieldCount };
}

function parseAppearancePatch(
  value: unknown,
  parentPath: string,
  kind: Parameters<typeof capabilityFieldSet>[1],
  allowed: ReadonlySet<PresentationField>,
  capabilities: PresentationCapabilitySet,
  policy: PresentationToolPolicy,
  diagnostics: PresentationDiagnostic[],
): { patch: PresentationAppearancePatch; fieldCount: number } | undefined {
  const path = `${parentPath}/appearance`;
  const record = requireRecord(value, diagnostics, path);
  if (!record) return undefined;
  rejectUnknownKeys(record, APPEARANCE_KEYS, diagnostics, path);
  const result: Record<string, unknown> = {};
  const nonNull: Record<string, unknown> = {};
  let fieldCount = 0;
  for (const key of APPEARANCE_KEYS) {
    if (!(key in record) || key === "style") continue;
    const field = `appearance.${key}` as PresentationField;
    checkField(field, kind, allowed, diagnostics, `${path}/${key}`);
    fieldCount += 1;
    if (record[key] === null) result[key] = null;
    else nonNull[key] = record[key];
  }
  const parsedNonNull = parseAppearance(nonNull, diagnostics, path);
  if (parsedNonNull) Object.assign(result, parsedNonNull);
  for (const [key, options] of [["templateOptionId", capabilities.templates], ["iconOptionId", capabilities.icons], ["styleOptionId", capabilities.styles]] as const) {
    const optionId = result[key];
    if (typeof optionId === "string") validateOption(optionId, options, kind, diagnostics, `${path}/${key}`);
  }
  if ("style" in record) {
    const styleRecord = requireRecord(record.style, diagnostics, `${path}/style`);
    if (styleRecord) {
      rejectUnknownKeys(styleRecord, STYLE_KEYS, diagnostics, `${path}/style`);
      const styleResult: Record<string, unknown> = {};
      const styleNonNull: Record<string, unknown> = {};
      for (const key of STYLE_KEYS) {
        if (!(key in styleRecord)) continue;
        checkField(`appearance.style.${key}` as PresentationField, kind, allowed, diagnostics, `${path}/style/${key}`);
        fieldCount += 1;
        if (styleRecord[key] === null) styleResult[key] = null;
        else styleNonNull[key] = styleRecord[key];
      }
      const parsedStyle = parseStyle(styleNonNull, diagnostics, `${path}/style`);
      if (parsedStyle) Object.assign(styleResult, parsedStyle);
      if (Object.keys(styleResult).length === 0) diagnose(diagnostics, "invalid-value", "Style patch cannot be empty.", `${path}/style`);
      else result.style = styleResult;
    }
  }
  if (Object.keys(result).length === 0) diagnose(diagnostics, "invalid-value", "Appearance patch cannot be empty.", path);
  validatePatchCoordinates(result as PresentationAppearancePatch, policy, diagnostics, path);
  return { patch: result as PresentationAppearancePatch, fieldCount };
}

function parseRoutingPatch(
  value: unknown,
  parentPath: string,
  kind: Parameters<typeof capabilityFieldSet>[1],
  allowed: ReadonlySet<PresentationField>,
  capabilities: PresentationCapabilitySet,
  policy: PresentationToolPolicy,
  diagnostics: PresentationDiagnostic[],
): { patch: PresentationRoutingPatch; fieldCount: number } | undefined {
  const path = `${parentPath}/routing`;
  const record = requireRecord(value, diagnostics, path);
  if (!record) return undefined;
  rejectUnknownKeys(record, ROUTING_KEYS, diagnostics, path);
  const result: Record<string, unknown> = {};
  const nonNull: Record<string, unknown> = {};
  let fieldCount = 0;
  for (const key of ROUTING_KEYS) {
    if (!(key in record)) continue;
    checkField(`routing.${key}` as PresentationField, kind, allowed, diagnostics, `${path}/${key}`);
    fieldCount += 1;
    if (record[key] === null) result[key] = null;
    else nonNull[key] = record[key];
  }
  const parsedNonNull = parseRouting(nonNull, diagnostics, path);
  if (parsedNonNull) Object.assign(result, parsedNonNull);
  const routeMode = result.routeMode;
  if (typeof routeMode === "string" && !(capabilities.routeModes ?? []).includes(routeMode as NonNullable<PresentationRouting["routeMode"]>)) {
    diagnose(diagnostics, "option-unavailable", `Route mode is not available: ${routeMode}`, `${path}/routeMode`);
  }
  for (const key of ["sourceMarker", "targetMarker"] as const) {
    const marker = result[key];
    if (typeof marker === "string" && !(capabilities.markers ?? []).includes(marker as NonNullable<PresentationRouting["sourceMarker"]>)) {
      diagnose(diagnostics, "option-unavailable", `Marker is not available: ${marker}`, `${path}/${key}`);
    }
  }
  if (Object.keys(result).length === 0) diagnose(diagnostics, "invalid-value", "Routing patch cannot be empty.", path);
  validatePatchCoordinates(result as PresentationRoutingPatch, policy, diagnostics, path);
  validateRoutePointCount(result as PresentationRoutingPatch, policy, diagnostics, path);
  return { patch: result as PresentationRoutingPatch, fieldCount };
}

function checkField(
  field: PresentationField,
  kind: Parameters<typeof capabilityFieldSet>[1],
  allowed: ReadonlySet<PresentationField>,
  diagnostics: PresentationDiagnostic[],
  path: string,
): void {
  if (!presentationFieldAppliesToKind(field, kind) || !allowed.has(field)) {
    diagnose(diagnostics, "field-not-available", `Presentation field is not available for this element: ${field}`, path);
  }
}

function validateOption(
  optionId: string,
  options: readonly PresentationOption[] | undefined,
  kind: Parameters<typeof capabilityFieldSet>[1],
  diagnostics: PresentationDiagnostic[],
  path: string,
): void {
  const option = optionMap(options).get(optionId);
  if (!option) diagnose(diagnostics, "option-unavailable", `Presentation option is not available: ${optionId}`, path);
  else if (!option.elementKinds.includes(kind)) diagnose(diagnostics, "option-not-applicable", `Presentation option does not apply to ${kind}: ${optionId}`, path);
}

function validateGeometryBounds(
  geometry: NonNullable<PresentationElementState["geometry"]>,
  policy: PresentationToolPolicy,
  diagnostics: PresentationDiagnostic[],
  path: string,
): void {
  const bounds = policy.coordinates;
  if (geometry.x < bounds.minX || geometry.x > bounds.maxX) diagnose(diagnostics, "coordinate-out-of-range", "x is outside the host coordinate policy.", `${path}/x`);
  if (geometry.y < bounds.minY || geometry.y > bounds.maxY) diagnose(diagnostics, "coordinate-out-of-range", "y is outside the host coordinate policy.", `${path}/y`);
  if (geometry.width < bounds.minWidth || geometry.width > bounds.maxWidth) diagnose(diagnostics, "coordinate-out-of-range", "width is outside the host coordinate policy.", `${path}/width`);
  if (geometry.height < bounds.minHeight || geometry.height > bounds.maxHeight) diagnose(diagnostics, "coordinate-out-of-range", "height is outside the host coordinate policy.", `${path}/height`);
}

function validatePatchCoordinates(
  value: PresentationAppearancePatch | PresentationRoutingPatch,
  policy: PresentationToolPolicy,
  diagnostics: PresentationDiagnostic[],
  path: string,
): void {
  const absolutePointKeys = "waypoints" in value && Array.isArray(value.waypoints) ? [value.waypoints] : [];
  for (const points of absolutePointKeys) points.forEach((point, index) => validateAbsolutePoint(point, policy, diagnostics, `${path}/waypoints/${index}`));
  for (const key of ["nodeLabelOffset", "nodeIconOffset", "groupIconOffset", "labelOffset"] as const) {
    const point = (value as Record<string, unknown>)[key];
    if (isPoint(point)) validateOffset(point, policy, diagnostics, `${path}/${key}`);
  }
  if ("curve" in value && value.curve && typeof value.curve === "object") {
    const curve = value.curve;
    if (curve.sourceHandle) validateOffset(curve.sourceHandle, policy, diagnostics, `${path}/curve/sourceHandle`);
    if (curve.targetHandle) validateOffset(curve.targetHandle, policy, diagnostics, `${path}/curve/targetHandle`);
    curve.knots?.forEach((knot, index) => {
      validateAbsolutePoint(knot.point, policy, diagnostics, `${path}/curve/knots/${index}/point`);
      if (knot.incomingHandle) validateOffset(knot.incomingHandle, policy, diagnostics, `${path}/curve/knots/${index}/incomingHandle`);
      if (knot.outgoingHandle) validateOffset(knot.outgoingHandle, policy, diagnostics, `${path}/curve/knots/${index}/outgoingHandle`);
    });
  }
}

function validateAbsolutePoint(point: { x: number; y: number }, policy: PresentationToolPolicy, diagnostics: PresentationDiagnostic[], path: string): void {
  if (point.x < policy.coordinates.minX || point.x > policy.coordinates.maxX) diagnose(diagnostics, "coordinate-out-of-range", "Point x is outside the host coordinate policy.", `${path}/x`);
  if (point.y < policy.coordinates.minY || point.y > policy.coordinates.maxY) diagnose(diagnostics, "coordinate-out-of-range", "Point y is outside the host coordinate policy.", `${path}/y`);
}

function validateOffset(point: { x: number; y: number }, policy: PresentationToolPolicy, diagnostics: PresentationDiagnostic[], path: string): void {
  if (Math.abs(point.x) > policy.coordinates.maxOffsetMagnitude) diagnose(diagnostics, "coordinate-out-of-range", "Offset x is outside the host coordinate policy.", `${path}/x`);
  if (Math.abs(point.y) > policy.coordinates.maxOffsetMagnitude) diagnose(diagnostics, "coordinate-out-of-range", "Offset y is outside the host coordinate policy.", `${path}/y`);
}

function validateRoutePointCount(value: PresentationRoutingPatch, policy: PresentationToolPolicy, diagnostics: PresentationDiagnostic[], path: string): void {
  const count = (Array.isArray(value.waypoints) ? value.waypoints.length : 0)
    + (value.curve && typeof value.curve === "object"
      ? (value.curve.sourceHandle ? 1 : 0)
        + (value.curve.targetHandle ? 1 : 0)
        + (value.curve.knots?.reduce((total, knot) => total + 1
          + (knot.incomingHandle ? 1 : 0)
          + (knot.outgoingHandle ? 1 : 0), 0) ?? 0)
      : 0);
  if (count > policy.coordinates.maxRoutePoints) diagnose(diagnostics, "route-point-limit", `Route has ${count} authored points; limit is ${policy.coordinates.maxRoutePoints}.`, path);
}

function validateEffectiveState(
  current: PresentationElementState,
  patch: PresentationElementPatch,
  diagnostics: PresentationDiagnostic[],
  path: string,
): void {
  const appearance = mergeNested(current.appearance, patch.appearance) as PresentationAppearance | undefined;
  if (appearance?.nodeIconScale !== undefined && appearance.nodeIconSize !== undefined) diagnose(diagnostics, "invalid-value", "Effective appearance cannot contain both nodeIconScale and nodeIconSize.", `${path}/appearance`);
  const routing = mergeNested(current.routing, patch.routing) as PresentationRouting | undefined;
  if (routing?.routeMode === "straight" && (routing.waypoints !== undefined || routing.curve !== undefined)) diagnose(diagnostics, "invalid-value", "Effective straight routing cannot contain waypoints or curve controls.", `${path}/routing`);
  if (routing?.curve !== undefined && routing.routeMode !== "curve") diagnose(diagnostics, "invalid-value", "Effective curve controls require routeMode curve.", `${path}/routing`);
  if (routing?.routeMode === "curve" && routing.waypoints !== undefined) diagnose(diagnostics, "invalid-value", "Effective curve routing cannot contain waypoints.", `${path}/routing`);
}

function mergeNested(base: Record<string, unknown> | undefined, patch: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!base && !patch) return undefined;
  const result: Record<string, unknown> = clone(base ?? {});
  for (const [key, value] of Object.entries(patch ?? {})) {
    if (value === null) delete result[key];
    else if (key === "style" && isRecord(value)) result[key] = mergeNested(isRecord(result[key]) ? result[key] : undefined, value);
    else result[key] = clone(value);
  }
  return result;
}

function explicitFields(change: PresentationElementPatch): Array<{ field: PresentationField; value: unknown | null }> {
  const fields: Array<{ field: PresentationField; value: unknown | null }> = [];
  for (const key of ["geometry", "pinned", "placement"] as const) {
    if (key in change) fields.push({ field: key, value: change[key] ?? null });
  }
  for (const key of APPEARANCE_KEYS) {
    if (key === "style" || !change.appearance || !(key in change.appearance)) continue;
    fields.push({ field: `appearance.${key}` as PresentationField, value: change.appearance[key] ?? null });
  }
  if (change.appearance?.style) {
    for (const key of STYLE_KEYS) {
      if (key in change.appearance.style) fields.push({ field: `appearance.style.${key}` as PresentationField, value: change.appearance.style[key] ?? null });
    }
  }
  for (const key of ROUTING_KEYS) {
    if (!change.routing || !(key in change.routing)) continue;
    fields.push({ field: `routing.${key}` as PresentationField, value: change.routing[key] ?? null });
  }
  return fields;
}

function readStateField(state: PresentationElementState, field: PresentationField): PresentationJsonValue | undefined {
  const parts = field.split(".");
  let current: unknown = state;
  for (const part of parts) {
    if (!isRecord(current) || !(part in current)) return undefined;
    current = current[part];
  }
  return current === undefined ? undefined : jsonValue(current);
}

function isPoint(value: unknown): value is { x: number; y: number } {
  return isRecord(value) && typeof value.x === "number" && typeof value.y === "number";
}
