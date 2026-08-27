import { describe, expect, it } from "vitest";

import {
  edgeEndpointAnchorFromPoint,
  edgeEndpointAnchorHaloGeometry,
  edgeEndpointAnchorPoint,
  isValidEdgeEndpointAnchor,
} from "./endpoint-anchor";

const geometry = { x: 10, y: 20, width: 100, height: 80 };

describe("edge endpoint anchors", () => {
  it("maps the four canonical positions clockwise around rectangular boundaries", () => {
    expect(edgeEndpointAnchorPoint(geometry, "rectangle", { position: 0 })).toEqual({ x: 60, y: 20 });
    expect(edgeEndpointAnchorPoint(geometry, "rectangle", { position: .25 })).toEqual({ x: 110, y: 60 });
    expect(edgeEndpointAnchorPoint(geometry, "container", { position: .5 })).toEqual({ x: 60, y: 100 });
    expect(edgeEndpointAnchorPoint(geometry, "rectangle", { position: .75 })).toEqual({ x: 10, y: 60 });
  });

  it("intersects ellipse, diamond, and rounded rectangle boundaries deterministically", () => {
    const circle = edgeEndpointAnchorPoint(geometry, "circle", { position: .125 });
    expect(circle.x).toBeCloseTo(91.2348, 4);
    expect(circle.y).toBeCloseTo(28.7652, 4);

    const diamond = edgeEndpointAnchorPoint(geometry, "diamond", { position: .125 });
    expect(diamond.x).toBeCloseTo(82.2222, 4);
    expect(diamond.y).toBeCloseTo(37.7778, 4);

    const rounded = edgeEndpointAnchorPoint(geometry, "rounded-rectangle", { position: .125 });
    expect(rounded.x).toBeLessThan(100);
    expect(rounded.x).toBeGreaterThan(99);
    expect(rounded.y).toBeCloseTo(120 - rounded.x, 8);
  });

  it("derives shape-independent positions from pointer direction", () => {
    expect(edgeEndpointAnchorFromPoint(geometry, { x: 60, y: 0 })).toEqual({ position: 0 });
    expect(edgeEndpointAnchorFromPoint(geometry, { x: 130, y: 60 })).toEqual({ position: .25 });
    expect(edgeEndpointAnchorFromPoint(geometry, { x: 0, y: 60 })).toEqual({ position: .75 });
    const almostTop = edgeEndpointAnchorFromPoint(
      { x: 0, y: 0, width: 1_440, height: 1_140 },
      { x: 719.9999999999999, y: -320 },
    );
    expect(almostTop.position).toBeGreaterThanOrEqual(0);
    expect(almostTop.position).toBeLessThan(1);
  });

  it("accepts only finite positions in the half-open unit interval", () => {
    expect(isValidEdgeEndpointAnchor({ position: 0 })).toBe(true);
    expect(isValidEdgeEndpointAnchor({ position: .999 })).toBe(true);
    expect(isValidEdgeEndpointAnchor({ position: 1 })).toBe(false);
    expect(isValidEdgeEndpointAnchor({ position: Number.NaN })).toBe(false);
    expect(() => edgeEndpointAnchorPoint(geometry, "rectangle", { position: 1 })).toThrow(RangeError);
  });

  it("derives shape-aware outward halo points and stubs without changing the anchor", () => {
    const rectangle = edgeEndpointAnchorHaloGeometry(
      geometry,
      "rectangle",
      { position: .25 },
      16,
      8,
    );
    expect(rectangle).toEqual({
      boundaryPoint: { x: 110, y: 60 },
      normal: { x: 1, y: 0 },
      haloPoint: { x: 126, y: 60 },
      stub: { from: { x: 110, y: 60 }, to: { x: 118, y: 60 } },
    });

    const ellipse = edgeEndpointAnchorHaloGeometry(
      geometry,
      "circle",
      { position: .125 },
      12,
    );
    expect(Math.hypot(ellipse.normal.x, ellipse.normal.y)).toBeCloseTo(1, 10);
    expect(ellipse.normal.x).toBeGreaterThan(0);
    expect(ellipse.normal.y).toBeLessThan(0);
    expect(ellipse.stub.to).toEqual(ellipse.haloPoint);
    expect(ellipse.boundaryPoint).toEqual(edgeEndpointAnchorPoint(
      geometry,
      "circle",
      { position: .125 },
    ));

    expect(edgeEndpointAnchorHaloGeometry(
      geometry,
      "diamond",
      { position: 0 },
      10,
    ).normal).toEqual({ x: 0, y: -1 });
  });

  it("rejects renderer distances that are negative or non-finite", () => {
    expect(() => edgeEndpointAnchorHaloGeometry(
      geometry,
      "diamond",
      { position: 0 },
      -1,
    )).toThrow(RangeError);
  });
});
