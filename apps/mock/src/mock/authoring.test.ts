import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  previewAuthoringCommands,
  buildIriographView,
  previewStructuredAuthoringRequest,
  STANDARD_LAYOUT_REFS,
  structuredAuthoringPresentation,
  type IriographDocumentV1,
} from "@iriograph/core";
import { deriveTypeSystem } from "@iriograph/vue-editor";

import {
  createMockAuthoringContext,
  MOCK_WORKFLOW_ROLE_CLASSES,
  mockResourceIriAllocator,
} from "./authoring";

describe("mock authoring host", () => {
  it("defaults authoring presentation to English and keeps Japanese selectable", () => {
    const context = createMockAuthoringContext(fixture());
    const presentation = structuredAuthoringPresentation(context);

    expect(context.defaultLocale).toBe("en");
    expect(context.structuredAuthoring).toMatchObject({
      allowUntypedNodes: false,
      allowClassificationGroups: false,
    });
    expect(presentation.profile.nodeRoles).toEqual([
      expect.objectContaining({ roleId: "role-01", label: "Process", displayPriority: 10 }),
      expect.objectContaining({ roleId: "role-02", label: "Event", displayPriority: 10 }),
      expect.objectContaining({ roleId: "role-03", label: "Branch or merge", displayPriority: 10 }),
      expect.objectContaining({ roleId: "role-04", label: "Information", displayPriority: 10 }),
    ]);
    expect(presentation.groupKinds.map(({ groupKind, enabled }) => ({ groupKind, enabled })))
      .toEqual([
        { groupKind: "classification", enabled: false },
        { groupKind: "membership", enabled: true },
        { groupKind: "sequence", enabled: true },
        { groupKind: "alternative", enabled: true },
      ]);
    expect(JSON.stringify(presentation)).not.toContain("urn:iriograph:authoring-role:");
    expect(structuredAuthoringPresentation(createMockAuthoringContext(fixture(), "ja"))
      .profile.nodeRoles.map((role) => role.label))
      .toEqual(["処理", "出来事", "分岐・合流", "情報"]);
  });

  it("通常要素は1つ以上のroleを必須とし複数roleを同時保存する", async () => {
    const document = fixture();
    const context = createMockAuthoringContext(document, "ja");
    const single = await previewStructuredAuthoringRequest(document, {
      type: "create-element",
      requestId: "single-role",
      element: { kind: "node", label: "審査する", nodeRoleIds: ["role-01"] },
    }, context);
    const multiple = await previewStructuredAuthoringRequest(document, {
      type: "create-element",
      requestId: "multiple-role",
      element: { kind: "node", label: "注文を受信", nodeRoleIds: ["role-01", "role-02"] },
    }, context);
    const untyped = await previewStructuredAuthoringRequest(document, {
      type: "create-element",
      requestId: "no-role",
      element: { kind: "node", label: "種類なし", nodeRoleIds: [] },
    }, context);

    expect(single.valid).toBe(true);
    expect(single.preview?.candidateSource).toContain(MOCK_WORKFLOW_ROLE_CLASSES.process);
    expect(multiple.valid).toBe(true);
    expect(multiple.preview?.candidateSource).toContain(MOCK_WORKFLOW_ROLE_CLASSES.process);
    expect(multiple.preview?.candidateSource).toContain(MOCK_WORKFLOW_ROLE_CLASSES.event);
    expect(multiple.preview?.candidateSource).toContain('"注文を受信"@ja');
    expect(untyped.valid).toBe(false);
    expect(untyped.diagnostics).toContainEqual(expect.objectContaining({ code: "node-role-required" }));
  });

  it("Bag/Seq/Altの3種類だけをgroupとして作成する", async () => {
    for (const groupKind of ["membership", "sequence", "alternative"] as const) {
      const document = fixture();
      const result = await previewStructuredAuthoringRequest(document, {
        type: "create-element",
        requestId: `group-${groupKind}`,
        element: { kind: "group", groupKind, label: `新しい${groupKind}` },
      }, createMockAuthoringContext(document));
      expect(result.valid, `${groupKind}: ${JSON.stringify(result.diagnostics)}`).toBe(true);
    }
    const document = fixture();
    const classification = await previewStructuredAuthoringRequest(document, {
      type: "create-element",
      requestId: "group-classification",
      element: { kind: "group", groupKind: "classification", label: "分類は型一覧で作る" },
    }, createMockAuthoringContext(document));
    expect(classification.valid).toBe(false);
    expect(classification.diagnostics).toContainEqual(expect.objectContaining({
      code: "classification-group-creation-denied",
    }));
  });

  it("allocatorのnamespace外発行と既存resource衝突をfail closedにする", async () => {
    const document = fixture();
    const context = createMockAuthoringContext(document, "ja");
    const request = {
      type: "create-element" as const,
      requestId: "collision",
      element: { kind: "node" as const, label: "衝突", nodeRoleIds: ["role-01"] },
    };
    const allocator = (iri: string) => ({
      allocate(allocation: Parameters<NonNullable<typeof context.allocator>["allocate"]>[0]) {
        return {
          iri,
          requestId: allocation.requestId,
          baseRevision: allocation.baseRevision,
          contextId: allocation.contextId,
        };
      },
    });

    const collision = await previewStructuredAuthoringRequest(
      document,
      request,
      context,
      { allocator: allocator("urn:iriograph:demo:start") },
    );
    expect(collision.valid).toBe(false);
    expect(collision.diagnostics).toContainEqual(expect.objectContaining({ code: "resource-iri-collision" }));

    const outside = await previewStructuredAuthoringRequest(
      document,
      { ...request, requestId: "outside" },
      context,
      { allocator: allocator("urn:outside:opaque") },
    );
    expect(outside.valid).toBe(false);
    expect(outside.diagnostics).toContainEqual(expect.objectContaining({ code: "resource-namespace-denied" }));
  });

  it("日本語predicate候補をopaque IDで選びexact IRIのtripleだけを保存する", async () => {
    const document = fixture();
    const context = createMockAuthoringContext(document, "ja");
    const scene = await buildIriographView(document, "main", context.runtime, "incremental");
    const start = scene.nodes.find((node) => node.semanticRef === "urn:iriograph:demo:start")!;
    const end = scene.nodes.find((node) => node.semanticRef === "urn:iriograph:demo:end")!;
    const predicate = structuredAuthoringPresentation(context).predicateCatalog
      .find((item) => item.label === "派生元")!;

    expect(predicate).toMatchObject({ sentencePattern: "AはBから派生した" });
    const result = await previewStructuredAuthoringRequest(document, {
      type: "create-direct-relations",
      requestId: "derived-relation",
      source: { viewId: "main", elementId: start.elementId },
      predicateId: predicate.predicateId,
      targets: [{ target: { viewId: "main", elementId: end.elementId } }],
    }, context);

    expect(result.valid).toBe(true);
    expect(result.preview?.candidateSource).toContain("http://www.w3.org/ns/prov#wasDerivedFrom");
    expect(result.preview?.candidateSource).not.toContain("AはBから派生した");
  });

  it("別fixtureでも同じrole候補を解決し新規通常要素へ適用する", async () => {
    const purchase = JSON.parse(readFileSync(
      new URL("../../public/workspace/models/purchase-approval.iriograph", import.meta.url),
      "utf8",
    )) as IriographDocumentV1;
    const context = createMockAuthoringContext(purchase, "ja");
    expect(structuredAuthoringPresentation(context).profile.nodeRoles.map((role) => role.label))
      .toEqual(["処理", "出来事", "分岐・合流", "情報"]);
    const created = await previewStructuredAuthoringRequest(purchase, {
      type: "create-element",
      requestId: "purchase-process",
      element: { kind: "node", label: "支払う", nodeRoleIds: ["role-01"] },
    }, context);
    expect(created.valid).toBe(true);
  });

  it("一般workflow roleよりdocument固有の競合direct型を代表tagに選ぶ", () => {
    const purchase = JSON.parse(readFileSync(
      new URL("../../public/workspace/models/purchase-approval.iriograph", import.meta.url),
      "utf8",
    )) as IriographDocumentV1;
    const context = createMockAuthoringContext(purchase, "ja");
    const index = deriveTypeSystem(purchase, {
      authoringProfile: context.structuredAuthoring,
      locale: "ja",
    });
    const review = index.presentation.resources.find((resource) => resource.label === "内容を審査")!;
    const primary = index.presentation.types.find((type) => type.typeId === review.primaryDirectTypeId)!;
    expect(primary.label).toBe("監査対象工程");
    expect(review.directTypeIds.map((typeId) => (
      index.presentation.types.find((type) => type.typeId === typeId)?.label
    ))).toEqual(expect.arrayContaining(["処理", "人が行う工程", "監査対象工程"]));
  });

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

  it("複製元と複製先のcontextは各base namespaceだけへmintしlocal語彙を混在させない", async () => {
    const original = fixture();
    const copiedBase = "urn:iriograph:mock:document:copy-1:";
    const copied: IriographDocumentV1 = {
      ...original,
      documentId: "copy-1",
      semantic: {
        ...original.semantic,
        baseIri: copiedBase,
        source: original.semantic.source.replaceAll("urn:iriograph:demo:", copiedBase),
      },
    };
    const command = {
      type: "create-resource" as const,
      commandId: "create-after-copy",
      initialStatements: [{
        subject: { kind: "created-resource" as const },
        predicateIri: "http://www.w3.org/2000/01/rdf-schema#label",
        object: { kind: "literal" as const, value: "新しい要素", language: "ja" },
      }],
    };
    const originalContext = createMockAuthoringContext(original);
    const copiedContext = createMockAuthoringContext(copied);

    const [originalPreview, copiedPreview] = await Promise.all([
      previewAuthoringCommands(original, [command], originalContext),
      previewAuthoringCommands(copied, [command], copiedContext),
    ]);

    expect(originalPreview.commands[0]).toMatchObject({
      resourceIri: expect.stringMatching(/^urn:iriograph:demo:r-/u),
    });
    expect(copiedPreview.commands[0]).toMatchObject({
      resourceIri: expect.stringMatching(/^urn:iriograph:mock:document:copy-1:r-/u),
    });
    expect(copiedContext.resourcePolicy.allowedMintNamespaces).toEqual([copiedBase]);
    expect(copiedContext.terms.some((term) => term.iri === `${copiedBase}p-01`)).toBe(true);
    expect(copiedContext.terms.some((term) => term.iri === "urn:iriograph:demo:p-01")).toBe(false);
    expect(originalContext.terms.some((term) => term.iri === "urn:iriograph:demo:p-01")).toBe(true);
    expect(originalContext.terms.some((term) => term.iri === `${copiedBase}p-01`)).toBe(false);
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
    const nextContext = createMockAuthoringContext(applied, "ja");
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

    const context = createMockAuthoringContext(document, "ja");
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
wf:end rdfs:label "End" .
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
