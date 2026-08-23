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
        predicateIri: "http://www.w3.org/2000/01/rdf-schema#label",
        object: { kind: "literal" as const, value: "Review task" },
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
      resourceIri: expect.stringMatching(/^urn:iriograph:demo:r-[a-z0-9]+$/u),
    });
    expect(second.confirmationId).toBe(first.confirmationId);
  });

  it("人が概念クラスを明示作成でき、作成後はlabel付き候補として再発見する", async () => {
    const document = fixture();
    const context = createMockAuthoringContext(document);
    const preview = await previewAuthoringCommands(document, [{
      type: "create-resource",
      commandId: "create-concept",
      resourceIri: "urn:iriograph:demo:review-concept",
      initialStatements: [{
        subject: { kind: "created-resource" },
        predicateIri: "http://www.w3.org/1999/02/22-rdf-syntax-ns#type",
        object: {
          kind: "iri",
          iri: "http://www.w3.org/2000/01/rdf-schema#Class",
        },
      }, {
        subject: { kind: "created-resource" },
        predicateIri: "http://www.w3.org/2000/01/rdf-schema#label",
        object: { kind: "literal", value: "審査対象", language: "ja" },
      }],
    }], context);

    expect(preview.valid).toBe(true);
    expect(preview.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "term-minting-warning" }),
    ]));

    const applied: IriographDocumentV1 = {
      ...document,
      semantic: { ...document.semantic, source: preview.candidateSource! },
    };
    const nextContext = createMockAuthoringContext(applied);
    expect(nextContext.terms).toContainEqual(expect.objectContaining({
      iri: "urn:iriograph:demo:review-concept",
      kind: "class",
      label: "審査対象",
    }));
  });

  it("curated標準metadataを優先し、document語彙だけを日本語label/comment付きで発見する", () => {
    const document = fixture();
    document.semantic.source += `
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix : <urn:iriograph:demo:> .
:custom a rdf:Property ;
  rdfs:label "English"@en, "日本語B"@ja, "日本語A"@ja ;
  rdfs:comment "English description"@en, "日本語の説明"@ja .
:customMember rdfs:subPropertyOf rdfs:member ; rdfs:label "独自包含"@ja .
:instance rdfs:label "個体"@ja .
`;

    const context = createMockAuthoringContext(document);
    expect(context.terms.find((term) => term.iri.endsWith("#seeAlso"))).toMatchObject({
      label: "関連情報を参照",
      category: "参照",
      description: expect.stringContaining("追加情報"),
    });
    expect(context.terms.find((term) => term.iri.endsWith("#subClassOf"))?.structural)
      .toBeUndefined();
    expect(context.terms.find((term) => term.iri.endsWith("#member"))).toMatchObject({
      label: "領域に含む",
      structural: true,
    });
    expect(context.terms.find((term) => term.iri === "urn:iriograph:demo:custom"))
      .toMatchObject({
        kind: "property",
        label: "日本語A",
        description: "日本語の説明",
        category: "ドキュメントの関係",
      });
    expect(context.terms.find((term) => term.iri === "urn:iriograph:demo:customMember"))
      .toMatchObject({ structural: true, objectKinds: ["iri"] });
    expect(context.terms.some((term) => term.iri === "urn:iriograph:demo:instance"))
      .toBe(false);
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
wf:start rdfs:label "Start" .
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
