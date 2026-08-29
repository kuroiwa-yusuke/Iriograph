import type { AssetIntrinsicSize, VisualStyle } from "../document/model.js";

export const DEFAULT_LABEL_FONT_SIZE = 14;
export const DEFAULT_GROUP_FRAME_LABEL_FONT_SIZE = 21;
export const DEFAULT_ICON_BOX_SIZE = 24;
export const LABEL_FONT_SIZE_RANGE = Object.freeze({ minimum: 8, maximum: 72 });

export type TextContentMetrics = {
  width: number;
  height: number;
  lineCount: number;
  fontSize: number;
};

export type IconPresentation = {
  scale?: number;
  size?: { width: number; height: number };
  fit?: "contain" | "cover";
};

export type IconContentMetrics = {
  width: number;
  height: number;
  fit: "contain" | "cover";
};

export type NodeContentMetrics = {
  label: TextContentMetrics;
  comments: TextContentMetrics[];
  icon?: IconContentMetrics;
  minimumSize: { width: number; height: number };
};

/**
 * Deterministic DOM-free text estimate for layout/autogrow adapters. It does
 * not claim font-perfect measurement; Canvas renderers may add their own
 * adapter while retaining the same bounded font-size contract.
 */
export function measureTextContent(
  text: string,
  options: {
    style?: Pick<VisualStyle, "labelFontSize">;
    maxWidth?: number;
    writingDirection?: "horizontal-right" | "vertical-down";
  } = {},
): TextContentMetrics {
  const fontSize = safeFontSize(options.style?.labelFontSize);
  const lineHeight = fontSize * 1.35;
  const explicitLines = text.normalize("NFC").split(/\r?\n/u);
  const charAdvance = fontSize * 0.62;
  const maxWidth = safePositive(options.maxWidth);
  let lineCount = 0;
  let longest = 0;
  for (const line of explicitLines) {
    const naturalWidth = [...line].length * charAdvance;
    const wraps = maxWidth ? Math.max(1, Math.ceil(naturalWidth / maxWidth)) : 1;
    lineCount += wraps;
    longest = Math.max(longest, maxWidth ? Math.min(naturalWidth, maxWidth) : naturalWidth);
  }
  lineCount = Math.max(1, lineCount);
  if (options.writingDirection === "vertical-down") {
    return {
      width: lineCount * lineHeight,
      height: Math.max(charAdvance, longest),
      lineCount,
      fontSize,
    };
  }
  return { width: longest, height: lineCount * lineHeight, lineCount, fontSize };
}

/** Resolves an icon box from verified intrinsic dimensions and sparse view data. */
export function resolveIconContentMetrics(
  intrinsic: AssetIntrinsicSize | undefined,
  presentation: IconPresentation = {},
): IconContentMetrics | undefined {
  const explicit = presentation.size;
  if (explicit) {
    return validPresentationDimension(explicit.width) && validPresentationDimension(explicit.height)
      ? { width: explicit.width, height: explicit.height, fit: presentation.fit ?? "contain" }
      : undefined;
  }
  if (!intrinsic) return {
    width: DEFAULT_ICON_BOX_SIZE,
    height: DEFAULT_ICON_BOX_SIZE,
    fit: presentation.fit ?? "contain",
  };
  if (!validIntrinsic(intrinsic)) return undefined;
  const scale = presentation.scale === undefined
    ? 1
    : Number.isFinite(presentation.scale) && presentation.scale >= 0.1 && presentation.scale <= 8
      ? presentation.scale
      : undefined;
  if (scale === undefined) return undefined;
  // Intrinsic pixels describe aspect, not a safe initial Canvas size. Fit the
  // natural ratio into one package-owned default box; only an explicit size
  // opts into large document/screen imagery.
  const fitScale = DEFAULT_ICON_BOX_SIZE / Math.max(intrinsic.width, intrinsic.height);
  const width = intrinsic.width * fitScale * scale;
  const height = intrinsic.height * fitScale * scale;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return undefined;
  }
  return {
    width,
    height,
    fit: presentation.fit ?? "contain",
  };
}

/** Pure content minimum used by hosts before choosing whether to autogrow. */
export function measureNodeContent(input: {
  label: string;
  comments?: readonly string[];
  style?: Pick<VisualStyle, "labelFontSize">;
  writingDirection?: "horizontal-right" | "vertical-down";
  maxTextWidth?: number;
  iconIntrinsicSize?: AssetIntrinsicSize;
  icon?: IconPresentation;
  padding?: number;
  gap?: number;
}): NodeContentMetrics {
  const label = measureTextContent(input.label, {
    style: input.style,
    maxWidth: input.maxTextWidth,
    writingDirection: input.writingDirection,
  });
  const comments = (input.comments ?? []).map((comment) => measureTextContent(comment, {
    style: input.style,
    maxWidth: input.maxTextWidth,
  }));
  const icon = input.icon
    ? resolveIconContentMetrics(input.iconIntrinsicSize, input.icon)
    : undefined;
  const padding = safeNonNegative(input.padding) ?? 12;
  const gap = safeNonNegative(input.gap) ?? 8;
  const textWidth = Math.max(label.width, ...comments.map((comment) => comment.width), 0);
  const textHeight = label.height
    + comments.reduce((sum, comment) => sum + comment.height, 0)
    + (comments.length > 0 ? gap * comments.length : 0);
  const contentWidth = icon ? icon.width + gap + textWidth : textWidth;
  const contentHeight = Math.max(icon?.height ?? 0, textHeight);
  return {
    label,
    comments,
    ...(icon ? { icon } : {}),
    minimumSize: {
      width: contentWidth + padding * 2,
      height: contentHeight + padding * 2,
    },
  };
}

function safeFontSize(value: number | undefined): number {
  return value !== undefined
    && Number.isFinite(value)
    && value >= LABEL_FONT_SIZE_RANGE.minimum
    && value <= LABEL_FONT_SIZE_RANGE.maximum
    ? value
    : DEFAULT_LABEL_FONT_SIZE;
}

function safePositive(value: number | undefined): number | undefined {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : undefined;
}

function safeNonNegative(value: number | undefined): number | undefined {
  return value !== undefined && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function validPresentationDimension(value: number): boolean {
  return Number.isFinite(value) && value >= 4 && value <= 4096;
}

function validIntrinsic(value: AssetIntrinsicSize): boolean {
  const derivedAspectRatio = value.width / value.height;
  return Number.isFinite(value.width)
    && Number.isFinite(value.height)
    && Number.isFinite(value.aspectRatio)
    && value.width > 0
    && value.height > 0
    && value.width <= 100_000
    && value.height <= 100_000
    && value.aspectRatio >= 0.0001
    && value.aspectRatio <= 10_000
    && Math.abs(derivedAspectRatio - value.aspectRatio)
      <= Math.max(1e-6, derivedAspectRatio * 1e-6);
}
