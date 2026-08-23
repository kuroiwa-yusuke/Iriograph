import { describe, expect, it } from "vitest";

import {
  previewAuthoringCommands,
  STANDARD_LAYOUT_REFS,
  type IriographDocumentV1,
} from "@iriograph/core";

import {
  createMockAuthoringContext,
  mockResourceIriAllocator,
} from "./authoring";

describe("mock authoring host", () => {
  it("static contextとallocatorでallowed namespaceのresourceを決定的にPreviewする", async () => {
    const document = fixture();
    const context = createMockAuthoringContext(document);
    const command = {
      type: "create-resource" as const,
      commandId: "mock-create",
      suggestedLocalName: "Review Task",
      initialStatements: [{
        subject: { kind: "created-resource" as const },
        predicateIri: "http://www.w3.org/1999/02/22-rdf-syntax-ns#type",
        object: { kind: "iri" as const, iri: "urn:iriograph:demo:UserTask" },
      }],
    };

    const first = await previewAuthoringCommands(document, [command], context, {
      allocator: mockResourceIriAllocator,
    });
    const second = await previewAuthoringCommands(document, [command], context, {
      allocator: mockResourceIriAllocator,
    });

    expect(first.valid).toBe(true);
    expect(first.commands[0]).toMatchObject({
      resourceIri: expect.stringMatching(/^urn:iriograph:demo:review-task-/u),
    });
    expect(second.confirmationId).toBe(first.confirmationId);
  });
});

function fixture(): IriographDocumentV1 {
  return {
    schemaVersion: "1",
    kind: "iriograph.document",
    documentId: "mock-authoring-test",
    semantic: {
      format: "text/turtle",
      baseIri: "urn:iriograph:demo:",
      authoringProfileRef: "urn:iriograph:authoring-profile:workflow-mock@1",
      source: `
@prefix wf: <urn:iriograph:demo:> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
wf:start a wf:StartEvent ; rdfs:label "Start" .
`,
    },
    views: [{
      viewId: "main",
      kind: "node-link",
      profileRef: "urn:iriograph:profile:rdf-rdfs:1",
      layoutRef: STANDARD_LAYOUT_REFS.hierarchicalLr,
      overlay: {},
    }],
  };
}
