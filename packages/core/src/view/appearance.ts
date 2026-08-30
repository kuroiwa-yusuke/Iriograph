import type {
  ProjectionCatalogV1,
  ProjectionDiagnostic,
  ViewElementOverlay,
  VisualStyle,
  VisualStyleOverride,
} from "../document/model.js";

const SAFE_COLOR = /^(?:none|transparent|black|silver|gray|white|maroon|red|purple|fuchsia|green|lime|olive|yellow|navy|blue|teal|aqua|#[0-9a-f]{3,4}|#[0-9a-f]{6}|#[0-9a-f]{8})$/iu;
const SAFE_DASH = /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[ ,]+(?:0|[1-9][0-9]*)(?:\.[0-9]+)?)*$/u;
const ABSOLUTE_IRI = /^[a-z][a-z0-9+.-]*:/iu;

export type ResolvedAppearance = {
  style: VisualStyle;
  styleRef?: string;
};

/**
 * Resolves the renderer-neutral cascade: template < catalog styleRef < view
 * override. Invalid programmatic input is ignored; persisted input is also
 * rejected by the JSON schema.
 */
export function resolveAppearance(
  templateStyle: VisualStyle,
  appearance: ViewElementOverlay["appearance"],
  catalog: ProjectionCatalogV1,
  semanticRef: string,
  diagnostics: ProjectionDiagnostic[],
): ResolvedAppearance {
  const legacyStyleRef = !appearance?.styleRef
    && appearance?.styleToken
    && ABSOLUTE_IRI.test(appearance.styleToken)
    ? appearance.styleToken
    : undefined;
  const requestedStyleRef = appearance?.styleRef ?? legacyStyleRef;
  const preset = requestedStyleRef ? catalog.styles?.[requestedStyleRef] : undefined;
  if (requestedStyleRef && !preset) {
    diagnostics.push({
      severity: "warning",
      code: "appearance-style-unresolved",
      message: `styleRef is not present in the catalog: ${requestedStyleRef}`,
      semanticRef,
      catalogRef: `${catalog.catalogId}@${catalog.catalogVersion}`,
    });
  }
  const safePreset = safeStyleOverride(preset);
  const safeOverride = safeStyleOverride(appearance?.style);
  if (preset && !safePreset || appearance?.style && !safeOverride) {
    diagnostics.push({
      severity: "warning",
      code: "appearance-style-invalid",
      message: `Ignored unsafe style values: ${semanticRef}`,
      semanticRef,
    });
  }
  return {
    style: mergeStyle(templateStyle, safePreset, safeOverride),
    ...(preset && requestedStyleRef ? { styleRef: requestedStyleRef } : {}),
  };
}

export function isSafeVisualStyleOverride(
  value: VisualStyleOverride | undefined,
): value is VisualStyleOverride {
  return safeStyleOverride(value) !== undefined;
}

function safeStyleOverride(
  value: VisualStyleOverride | undefined,
): VisualStyleOverride | undefined {
  if (!value) return undefined;
  if ([value.fill, value.stroke, value.text, value.accent]
    .some((color) => color !== undefined && !SAFE_COLOR.test(color))) return undefined;
  if (value.fillOpacity !== undefined && (
    !Number.isFinite(value.fillOpacity) || value.fillOpacity < 0 || value.fillOpacity > 1
  )) return undefined;
  if (value.strokeWidth !== undefined && (
    !Number.isFinite(value.strokeWidth) || value.strokeWidth < 0 || value.strokeWidth > 20
  )) return undefined;
  if (value.labelFontSize !== undefined && (
    !Number.isFinite(value.labelFontSize) || value.labelFontSize < 8 || value.labelFontSize > 72
  )) return undefined;
  if (value.dash !== undefined && (
    value.dash.length > 64 || !SAFE_DASH.test(value.dash)
  )) return undefined;
  return clone(value);
}

function mergeStyle(
  template: VisualStyle,
  preset: VisualStyleOverride | undefined,
  override: VisualStyleOverride | undefined,
): VisualStyle {
  const merged = {
    ...clone(template),
    ...clone(preset),
    ...clone(override),
  };
  const extensions = {
    ...clone(template.extensions),
    ...clone(preset?.extensions),
    ...clone(override?.extensions),
  };
  if (Object.keys(extensions).length > 0) merged.extensions = extensions;
  else delete merged.extensions;
  return merged;
}

function clone<T>(value: T): T {
  if (value === undefined) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}
