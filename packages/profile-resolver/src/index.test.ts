import { describe, expect, it } from "vitest";
import type { ProjectionRuntimeContext } from "@iriograph/core";
import {
  assertResolvedAuthoringOption,
  resolveAuthoringProfile,
  type AuthoringArtifactResolver,
  type AuthoringProfileManifestV1,
  type AuthoringVocabularyManifestV1,
} from "./index.js";

const vocabulary: AuthoringVocabularyManifestV1 = {
  schemaVersion: "1",
  kind: "iriograph.authoring-vocabulary",
  vocabularyId: "urn:test:vocabulary",
  vocabularyVersion: "1",
  vocabularyRef: "urn:test:vocabulary@1",
  terms: [{ termId: "term-next", iri: "urn:test:next", kind: "property", label: "次へ" }],
  nodeRoles: [{ roleId: "role-task", classIri: "urn:test:Task", label: "作業" }],
};
const profile: AuthoringProfileManifestV1 = {
  schemaVersion: "1",
  kind: "iriograph.authoring-profile",
  profileId: "urn:test:profile",
  profileVersion: "1",
  profileRef: "urn:test:profile@1",
  imports: [{ vocabularyRef: vocabulary.vocabularyRef }],
  defaultLocale: "ja",
  termPolicy: {
    existingUnknown: "preserve", humanUnknown: "reject", llmUnknown: "reject",
    humanMinting: "deny", llmMinting: "deny",
  },
  structuredAuthoring: {},
};

describe("authoring profile resolver", () => {
  it("resolves immutable imports into a deterministic revision-bound context", async () => {
    const result = await resolveAuthoringProfile(requestFor({
      [profile.profileRef]: profile,
      [vocabulary.vocabularyRef]: vocabulary,
    }));
    expect(result.accepted).toBe(true);
    if (!result.accepted) return;
    expect(result.context.defaultLocale).toBe("ja");
    expect(result.context.terms[0]?.termId).toBe("term-next");
    expect(result.context.structuredAuthoring?.nodeRoles[0]?.roleId).toBe("role-task");
    assertResolvedAuthoringOption(result.context, {
      contextRevision: result.context.contextRevision,
      optionKind: "term",
      optionId: "term-next",
    });
    expect(() => assertResolvedAuthoringOption(result.context, {
      contextRevision: "stale",
      optionKind: "term",
      optionId: "term-next",
    })).toThrow("stale");
  });

  it("rejects cycles and conflicting opaque IDs while leaving read available", async () => {
    const cyclic = {
      ...vocabulary,
      imports: [{ vocabularyRef: vocabulary.vocabularyRef }],
      terms: [...vocabulary.terms, { termId: "term-next", iri: "urn:test:other", kind: "property" as const }],
    };
    const result = await resolveAuthoringProfile(requestFor({
      [profile.profileRef]: profile,
      [vocabulary.vocabularyRef]: cyclic,
    }));
    expect(result.accepted).toBe(false);
    if (result.accepted) return;
    expect(result.readable).toBe(true);
    expect(result.diagnostics.map((item) => item.code)).toContain("vocabulary-cycle");
    expect(result.diagnostics.map((item) => item.code)).toContain("duplicate-term-id");
  });
});

function requestFor(values: Record<string, object>) {
  const resolver: AuthoringArtifactResolver = {
    async resolveAuthoringArtifact(ref) {
      const value = values[ref];
      if (!value) throw new Error("not found");
      return JSON.stringify(value);
    },
  };
  return {
    profileRef: profile.profileRef,
    resolver,
    runtime: {} as ProjectionRuntimeContext,
    documentRevision: "revision-1",
    contextId: "context-1",
    resourcePolicy: { allowedMintNamespaces: ["urn:test:"] },
  };
}
