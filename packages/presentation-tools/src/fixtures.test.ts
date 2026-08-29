import { describe, expect, it } from "vitest";
import {
  PresentationContractError,
  PresentationSceneIndex,
  definePresentationCapabilities,
  definePresentationToolPolicy,
} from "./index.js";
import { capabilities, policy, scene } from "./test-helpers.js";

describe("presentation host contracts", () => {
  it("creates an immutable revision-bound Scene index and rejects semantic/URL/byte fields", () => {
    const source = scene();
    const index = new PresentationSceneIndex(source);
    source.elements[0]!.label = "mutated";
    expect(index.get("group-1")?.label).toBe("Order lane");
    expect(index.snapshot()).toEqual(scene());

    for (const forbidden of [
      { semanticRef: "urn:test:semantic" },
      { turtle: "@prefix : <urn:test:> ." },
      { url: "https://example.invalid/asset.svg" },
      { assetBytes: [1, 2, 3] },
    ]) {
      const invalid = scene() as unknown as Record<string, unknown>;
      Object.assign((invalid.elements as Record<string, unknown>[])[0]!, forbidden);
      expect(() => new PresentationSceneIndex(invalid)).toThrowError(PresentationContractError);
    }
  });

  it("validates host policy and rejects nonsensical capability kinds and URL-like option IDs", () => {
    expect(definePresentationToolPolicy(policy())).toEqual(policy());
    const invalidField = capabilities();
    invalidField.fieldRules.push({ field: "routing.routeMode", elementKinds: ["node"] });
    expect(() => definePresentationCapabilities(invalidField)).toThrowError(/capability/i);

    const invalidOption = capabilities();
    invalidOption.icons![0]!.optionId = "https://example.invalid/icon.svg";
    expect(() => definePresentationCapabilities(invalidOption)).toThrowError(PresentationContractError);
  });

  it("returns a compact target/capability summary without semantic identity or resolved resources", () => {
    const index = new PresentationSceneIndex(scene());
    const result = index.summarize(
      index.binding,
      ["node-1", "edge-1"],
      capabilities(),
      policy({ maxLabelCharacters: 18, maxOptionsPerSummary: 2 }),
    );
    expect(result.accepted).toBe(true);
    if (!result.accepted) return;
    expect(result.value.targets[0]?.label).toBe("A very long order…");
    expect(result.value.targets[0]?.availableFields).toContain("geometry");
    expect(result.value.targets[0]?.availableFields).not.toContain("routing.routeMode");
    expect(result.value.targets[1]?.availableFields).toContain("routing.routeMode");
    expect(result.value.capabilities.templates).toHaveLength(2);
    expect(result.value.capabilities.omittedOptionCount).toBeGreaterThan(0);
    expect(JSON.stringify(result.value)).not.toMatch(/semanticRef|https?:|assetBytes|turtle/i);
  });

  it("rejects stale summary bindings and unresolved or duplicate targets", () => {
    const index = new PresentationSceneIndex(scene());
    expect(index.summarize(
      { ...index.binding, documentRevision: "doc-r0" },
      ["node-1"], capabilities(), policy(),
    )).toMatchObject({ accepted: false, diagnostics: [{ code: "stale-document-revision" }] });
    expect(index.summarize(index.binding, ["missing"], capabilities(), policy()))
      .toMatchObject({ accepted: false, diagnostics: [{ code: "target-unresolved" }] });
    expect(index.summarize(index.binding, ["node-1", "node-1"], capabilities(), policy()))
      .toMatchObject({ accepted: false, diagnostics: [{ code: "duplicate-target" }] });
  });
});
