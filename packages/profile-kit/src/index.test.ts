import { describe, expect, it } from "vitest";
import { standardWorkflowInstanceFlowCatalog } from "@iriograph/core";
import {
  referenceWorkflowFixture,
  referenceWorkflowProfile,
  runDomainProfileConformance,
  validateDomainProjectionProfile,
  type DomainProjectionProfileManifestV1,
} from "./index.js";

describe("domain projection profile", () => {
  it("validates a versioned reference profile without core branches", () => {
    const profile: DomainProjectionProfileManifestV1 = {
      schemaVersion: "1",
      kind: "iriograph.domain-profile",
      profileId: "urn:iriograph:profile:reference-workflow",
      profileVersion: "1",
      profileRef: "urn:iriograph:profile:reference-workflow@1",
      defaultLocale: "ja",
      ontology: { mediaType: "text/turtle", source: "@prefix ex: <urn:test:> ." },
      authoring: {
        roles: [{ roleId: "task", classIri: "urn:test:Task", label: "作業" }],
        terms: [{ termId: "next", iri: "urn:test:next", kind: "property", label: "次の工程" }],
      },
      catalogRefs: ["urn:iriograph:catalog:workflow-instance-flow@1"],
      catalog: {
        ...standardWorkflowInstanceFlowCatalog,
        catalogId: "urn:iriograph:catalog:reference-workflow",
        catalogVersion: "1",
        profileRef: "urn:iriograph:profile:reference-workflow@1",
      },
      licenses: [{ licenseId: "CC0-1.0", notice: "Reference ontology fixture." }],
    };
    expect(validateDomainProjectionProfile(profile)).toEqual([]);
  });

  it("projects the exported profile/fixture through the common conformance kit", async () => {
    const result = await runDomainProfileConformance(
      referenceWorkflowProfile,
      referenceWorkflowFixture,
      [{
        catalogRef: "urn:iriograph:catalog:workflow-instance-flow@1",
        catalog: standardWorkflowInstanceFlowCatalog,
      }],
    );
    expect(result.accepted).toBe(true);
    expect(result.elementCount).toBeGreaterThan(0);
    expect(result.profileDiagnostics).toEqual([]);
  });
});
