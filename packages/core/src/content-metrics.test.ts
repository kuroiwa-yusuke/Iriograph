import { describe, expect, it } from "vitest";

import {
  DEFAULT_LABEL_FONT_SIZE,
  DEFAULT_ICON_BOX_SIZE,
  measureNodeContent,
  measureTextContent,
  resolveIconContentMetrics,
} from "./content-metrics";

describe("content metrics", () => {
  it("font size/direction/offsetから独立した純粋なtext metricsを返す", () => {
    const normal = measureTextContent("Alpha\nBeta", {
      style: { labelFontSize: 20 },
      maxWidth: 200,
    });
    const vertical = measureTextContent("Alpha\nBeta", {
      style: { labelFontSize: 20 },
      maxWidth: 200,
      writingDirection: "vertical-down",
    });
    expect(normal).toMatchObject({ fontSize: 20, lineCount: 2 });
    expect(vertical.width).toBe(normal.height);
    expect(vertical.height).toBe(normal.width);
    expect(measureTextContent("fallback", { style: { labelFontSize: 1000 } }).fontSize)
      .toBe(DEFAULT_LABEL_FONT_SIZE);
  });

  it("verified intrinsic sizeとsparse scale/size/fitからbounded icon boxを解く", () => {
    const intrinsic = { width: 24, height: 12, aspectRatio: 2, source: "decoded" as const };
    expect(resolveIconContentMetrics(intrinsic, { scale: 2 })).toEqual({
      width: 48,
      height: 24,
      fit: "contain",
    });
    expect(resolveIconContentMetrics(intrinsic, {
      size: { width: 80, height: 40 },
      fit: "cover",
    })).toEqual({ width: 80, height: 40, fit: "cover" });
    expect(resolveIconContentMetrics(intrinsic, { scale: Number.POSITIVE_INFINITY }))
      .toBeUndefined();
    expect(resolveIconContentMetrics(undefined)).toEqual({
      width: DEFAULT_ICON_BOX_SIZE,
      height: DEFAULT_ICON_BOX_SIZE,
      fit: "contain",
    });
    expect(resolveIconContentMetrics({
      width: 1000,
      height: 500,
      aspectRatio: 2,
      source: "decoded",
    })).toEqual({ width: 24, height: 12, fit: "contain" });
    const extreme = resolveIconContentMetrics({
      width: 100_000,
      height: 10,
      aspectRatio: 10_000,
      source: "decoded",
    });
    expect(extreme).toMatchObject({ width: 24, fit: "contain" });
    expect(extreme?.height).toBeCloseTo(.0024, 8);
  });

  it("label/comment/iconをautogrow可能なminimum sizeへ集約する", () => {
    const metrics = measureNodeContent({
      label: "注文を受ける",
      comments: ["これは複数行に\nできる説明です"],
      style: { labelFontSize: 16 },
      maxTextWidth: 160,
      iconIntrinsicSize: { width: 24, height: 24, aspectRatio: 1, source: "svg-view-box" },
      icon: { scale: 1.5 },
    });
    expect(metrics.icon).toMatchObject({ width: 36, height: 36 });
    expect(metrics.comments[0]?.lineCount).toBeGreaterThanOrEqual(2);
    expect(metrics.minimumSize.width).toBeGreaterThan(metrics.label.width);
    expect(metrics.minimumSize.height).toBeGreaterThan(metrics.label.height);
  });
});
