import { describe, expect, it } from "vitest";
import { standardWorkflowInstanceFlowCatalog } from "@iriograph/core";
import {
  referenceWorkflowFixture,
  referenceWorkflowFixtureV1,
  referenceWorkflowProfile,
  referenceWorkflowProfileV1,
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

  it("exports an English-canonical profile while retaining bilingual RDF labels and comments", () => {
    expect(referenceWorkflowProfile.profileVersion).toBe("2");
    expect(referenceWorkflowProfile.profileRef).toBe("urn:iriograph:profile:reference-workflow@2");
    expect(referenceWorkflowProfile.catalog.catalogVersion).toBe("2");
    expect(referenceWorkflowProfile.defaultLocale).toBe("en");
    expect(referenceWorkflowProfile.authoring.roles.map((role) => role.label)).toEqual(["Task"]);
    expect(referenceWorkflowProfile.authoring.terms.map((term) => term.label)).toEqual(["Next step"]);
    expect(referenceWorkflowProfile.catalog.templates["urn:iriograph:template:node:generic:1"]?.ports
      ?.map((port) => port.label)).toEqual(["Input", "Output", "Auxiliary"]);
    expect(referenceWorkflowProfile.ontology.source).toContain('rdfs:label "Task"@en, "作業"@ja');
    expect(referenceWorkflowProfile.ontology.source).toContain(
      'rdfs:comment "A unit of work in a workflow."@en, "ワークフロー内の作業単位です。"@ja',
    );
    expect(referenceWorkflowProfile.ontology.source).toContain('rdfs:label "Next step"@en, "次の工程"@ja');
    expect(referenceWorkflowProfile.ontology.source).toContain(
      'rdfs:comment "Connects a task to its next step."@en, "作業を次の工程へ接続します。"@ja',
    );
    expect(referenceWorkflowFixture.views[0]?.locale).toBe("en");
    expect(referenceWorkflowFixture.semantic.source).toContain('rdfs:label "Start"@en, "開始"@ja');
    expect(referenceWorkflowFixture.semantic.source).toContain('rdfs:label "Finish"@en, "完了"@ja');
  });

  it("retains the immutable Japanese-first v1 reference artifacts", async () => {
    expect(referenceWorkflowProfileV1.profileRef).toBe("urn:iriograph:profile:reference-workflow@1");
    expect(referenceWorkflowProfileV1.defaultLocale).toBe("ja");
    expect(referenceWorkflowProfileV1.ontology.source).not.toContain("@en");
    expect(referenceWorkflowFixtureV1.views[0]?.locale).toBe("ja");
    const result = await runDomainProfileConformance(
      referenceWorkflowProfileV1,
      referenceWorkflowFixtureV1,
      [{
        catalogRef: "urn:iriograph:catalog:workflow-instance-flow@1",
        catalog: standardWorkflowInstanceFlowCatalog,
      }],
    );
    expect(result.accepted).toBe(true);
  });
});
