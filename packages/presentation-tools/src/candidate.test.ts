import { describe, expect, it } from "vitest";
import {
  PresentationSceneIndex,
  diffPresentationCandidate,
  validatePresentationCandidate,
  type PresentationCandidatePatch,
} from "./index.js";
import { capabilities, policy, scene } from "./test-helpers.js";

function candidate(index: PresentationSceneIndex): PresentationCandidatePatch {
  return {
    binding: index.binding,
    candidateId: "candidate-1",
    changes: [{
      elementId: "node-1",
      geometry: { x: 180, y: 120, width: 180, height: 80 },
      appearance: {
        iconOptionId: "icon-order",
        style: { fill: "#ffeeaa" },
      },
    }, {
      elementId: "edge-1",
      appearance: { styleOptionId: "style-alert" },
      routing: { routeMode: "straight", waypoints: null },
    }],
  };
}

describe("closed presentation candidate validation", () => {
  it("normalizes a closed sparse patch and produces a deterministic field diff", () => {
    const index = new PresentationSceneIndex(scene());
    const before = index.snapshot();
    const validation = validatePresentationCandidate(candidate(index), index, capabilities(), policy());
    expect(validation.accepted).toBe(true);
    if (!validation.accepted) return;
    expect(validation).toMatchObject({ changeCount: 2, fieldCount: 6 });
    const diff = diffPresentationCandidate(index, validation);
    expect(diff.items.map((item) => [item.elementId, item.field, item.operation])).toEqual([
      ["node-1", "geometry", "set"],
      ["node-1", "appearance.iconOptionId", "set"],
      ["node-1", "appearance.style.fill", "set"],
      ["edge-1", "appearance.styleOptionId", "set"],
      ["edge-1", "routing.routeMode", "set"],
      ["edge-1", "routing.waypoints", "unset"],
    ]);
    expect(diff.fieldCount).toBe(6);
    expect(index.snapshot()).toEqual(before);
  });

  it("rejects every stale part of the document/context/view binding", () => {
    const index = new PresentationSceneIndex(scene());
    for (const [key, value, code] of [
      ["documentRevision", "doc-stale", "stale-document-revision"],
      ["contextRevision", "ctx-stale", "stale-context-revision"],
      ["viewId", "other", "view-mismatch"],
    ] as const) {
      const input = candidate(index);
      input.binding = { ...input.binding, [key]: value };
      const result = validatePresentationCandidate(input, index, capabilities(), policy());
      expect(result).toMatchObject({ accepted: false, diagnostics: expect.arrayContaining([expect.objectContaining({ code })]) });
    }
  });

  it("rejects unknown semantic, Turtle, CSS, URL and byte-bearing fields", () => {
    const index = new PresentationSceneIndex(scene());
    const forbidden = [
      ["semanticWrite", { add: [] }],
      ["turtle", "@prefix : <urn:test:> ."],
      ["css", "position:fixed"],
      ["url", "https://example.invalid/icon.svg"],
      ["assetBytes", [137, 80, 78, 71]],
    ] as const;
    for (const [key, value] of forbidden) {
      const input = candidate(index) as unknown as Record<string, unknown>;
      (input.changes as Record<string, unknown>[])[0]![key] = value;
      const result = validatePresentationCandidate(input, index, capabilities(), policy());
      expect(result).toMatchObject({ accepted: false, diagnostics: expect.arrayContaining([expect.objectContaining({ code: "unknown-field" })]) });
    }

    const urlOption = candidate(index);
    urlOption.changes[0]!.appearance!.iconOptionId = "https://example.invalid/icon.svg";
    expect(validatePresentationCandidate(urlOption, index, capabilities(), policy()))
      .toMatchObject({ accepted: false, diagnostics: expect.arrayContaining([expect.objectContaining({ code: "unsafe-value" })]) });
  });

  it("rejects unavailable fields/options, duplicates, no-ops and invalid effective routes", () => {
    const index = new PresentationSceneIndex(scene());
    const wrongField = candidate(index) as unknown as { binding: unknown; candidateId: string; changes: Record<string, unknown>[] };
    wrongField.changes = [{ elementId: "node-1", routing: { routeMode: "auto" } }];
    expect(validatePresentationCandidate(wrongField, index, capabilities(), policy()))
      .toMatchObject({ accepted: false, diagnostics: expect.arrayContaining([expect.objectContaining({ code: "field-not-available" })]) });

    const wrongOption = candidate(index);
    wrongOption.changes = [{ elementId: "node-1", appearance: { iconOptionId: "missing" } }];
    expect(validatePresentationCandidate(wrongOption, index, capabilities(), policy()))
      .toMatchObject({ accepted: false, diagnostics: expect.arrayContaining([expect.objectContaining({ code: "option-unavailable" })]) });

    const duplicate = candidate(index);
    duplicate.changes = [duplicate.changes[0]!, { ...duplicate.changes[0]! }];
    expect(validatePresentationCandidate(duplicate, index, capabilities(), policy()))
      .toMatchObject({ accepted: false, diagnostics: expect.arrayContaining([expect.objectContaining({ code: "duplicate-target" })]) });

    const noOp = candidate(index);
    noOp.changes = [{ elementId: "node-1", geometry: { x: 80, y: 100, width: 160, height: 72 } }];
    expect(validatePresentationCandidate(noOp, index, capabilities(), policy()))
      .toMatchObject({ accepted: false, diagnostics: [{ code: "candidate-no-op" }] });

    const invalidRoute = candidate(index) as unknown as { binding: unknown; candidateId: string; changes: Record<string, unknown>[] };
    invalidRoute.changes = [{ elementId: "edge-1", routing: { curve: { sourceHandle: { x: 20, y: 0 } } } }];
    expect(validatePresentationCandidate(invalidRoute, index, capabilities(), policy()))
      .toMatchObject({ accepted: false, diagnostics: expect.arrayContaining([expect.objectContaining({ code: "invalid-value" })]) });
  });

  it("enforces change, field, coordinate, point and request-size budgets", () => {
    const index = new PresentationSceneIndex(scene());
    expect(validatePresentationCandidate(candidate(index), index, capabilities(), policy({ maxPatchChanges: 1 })))
      .toMatchObject({ accepted: false, diagnostics: expect.arrayContaining([expect.objectContaining({ code: "patch-change-limit" })]) });
    expect(validatePresentationCandidate(candidate(index), index, capabilities(), policy({ maxPatchFields: 2 })))
      .toMatchObject({ accepted: false, diagnostics: expect.arrayContaining([expect.objectContaining({ code: "patch-field-limit" })]) });

    const coordinate = candidate(index);
    coordinate.changes = [{ elementId: "node-1", geometry: { x: 101, y: 0, width: 20, height: 20 } }];
    expect(validatePresentationCandidate(coordinate, index, capabilities(), policy({ coordinates: { ...policy().coordinates, maxX: 100 } })))
      .toMatchObject({ accepted: false, diagnostics: expect.arrayContaining([expect.objectContaining({ code: "coordinate-out-of-range" })]) });

    const points = candidate(index) as unknown as { binding: unknown; candidateId: string; changes: Record<string, unknown>[] };
    points.changes = [{ elementId: "edge-1", routing: { routeMode: "manual", waypoints: [{ x: 1, y: 1 }, { x: 2, y: 2 }] } }];
    expect(validatePresentationCandidate(points, index, capabilities(), policy({ coordinates: { ...policy().coordinates, maxRoutePoints: 1 } })))
      .toMatchObject({ accepted: false, diagnostics: expect.arrayContaining([expect.objectContaining({ code: "route-point-limit" })]) });

    expect(validatePresentationCandidate(candidate(index), index, capabilities(), policy({ maxRequestBytes: 100, maxCycleRequestBytes: 100 })))
      .toMatchObject({ accepted: false, diagnostics: [{ code: "request-size-limit" }] });
  });

  it("rejects non-finite geometry and unsafe CSS-like style values", () => {
    const index = new PresentationSceneIndex(scene());
    const nonFinite = candidate(index);
    nonFinite.changes = [{ elementId: "node-1", geometry: { x: Number.NaN, y: 0, width: 10, height: 10 } }];
    expect(validatePresentationCandidate(nonFinite, index, capabilities(), policy()))
      .toMatchObject({ accepted: false, diagnostics: expect.arrayContaining([expect.objectContaining({ code: "invalid-value" })]) });
    const css = candidate(index);
    css.changes = [{ elementId: "node-1", appearance: { style: { fill: "url(https://example.invalid/a.svg)" } } }];
    expect(validatePresentationCandidate(css, index, capabilities(), policy()))
      .toMatchObject({ accepted: false, diagnostics: expect.arrayContaining([expect.objectContaining({ code: "unsafe-value" })]) });
  });
});
