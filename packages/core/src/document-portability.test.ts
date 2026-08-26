import { DataFactory } from "n3";
import { describe, expect, it } from "vitest";

import {
  applyDocumentRebasePreview,
  applyPortableDocumentReplace,
  previewDocumentRebase,
  previewPortableDocumentReplace,
} from "./document-portability";
import { generatedElementId, statementIdentityFromQuad } from "./identity";
import { createStandardLayoutRegistry } from "./layout";
import type { IriographDocumentV1 } from "./model";
import { parseSemanticGraph } from "./rdf";
import type { ProjectionRuntimeContext } from "./scene";
import { standardRdfRdfsCatalog } from "./standard-catalog";

const OLD = "urn:test:portable:old:";
const NEXT = "urn:test:portable:next:";

describe("portable document replacement", () => {
  it("schema/semantic/profile/all-viewをpreviewしrevision-boundでatomic applyする", async () => {
    const current = documentFor(simpleSource(OLD));
    const candidate = structuredClone(current);
    candidate.documentId = "replacement";
    candidate.views[0]!.locale = "ja";

    const preview = await previewPortableDocumentReplace(
      current,
      JSON.stringify(candidate),
      runtimeContext(),
      { documentRevision: "r1" },
    );
    expect(preview.valid).toBe(true);
    expect(preview.candidate).toEqual(candidate);

    const applied = await applyPortableDocumentReplace(current, preview, runtimeContext(), {
      confirmationId: preview.confirmationId,
      documentRevision: "r1",
    });
    expect(applied.accepted).toBe(true);
    expect(applied.document.documentId).toBe("replacement");
    expect(applied.scenes).toHaveProperty("main");

    const stale = await applyPortableDocumentReplace(current, preview, runtimeContext(), {
      confirmationId: preview.confirmationId,
      documentRevision: "r2",
    });
    expect(stale.accepted).toBe(false);
    expect(stale.document).toEqual(current);
    expect(stale.diagnostics).toContainEqual(expect.objectContaining({
      code: "document-replace-stale-revision",
      jsonPointer: "",
    }));
  });

  it("JSON/schema diagnosticsをRFC 6901 pointerへ結び付ける", async () => {
    const current = documentFor(simpleSource(OLD));
    const malformed = await previewPortableDocumentReplace(
      current,
      "{",
      runtimeContext(),
      { documentRevision: "r1" },
    );
    expect(malformed.diagnostics).toContainEqual(expect.objectContaining({
      code: "document-json-invalid",
      jsonPointer: "",
    }));

    const candidate = structuredClone(current) as unknown as Record<string, unknown>;
    delete (candidate.semantic as Record<string, unknown>).baseIri;
    const invalid = await previewPortableDocumentReplace(
      current,
      candidate,
      runtimeContext(),
      { documentRevision: "r1" },
    );
    expect(invalid.valid).toBe(false);
    expect(invalid.diagnostics).toContainEqual(expect.objectContaining({
      code: "document-schema-invalid",
      jsonPointer: "/semantic/baseIri",
    }));

    const unresolvedProfiles = structuredClone(current);
    unresolvedProfiles.views = [
      { ...structuredClone(current.views[0]!), viewId: "first", profileRef: "urn:missing:first" },
      { ...structuredClone(current.views[0]!), viewId: "second", profileRef: "urn:missing:second" },
    ];
    const allViews = await previewPortableDocumentReplace(
      current,
      unresolvedProfiles,
      runtimeContext(),
      { documentRevision: "r1" },
    );
    expect(allViews.diagnostics.filter((item) => item.code === "profile-catalog-unresolved"))
      .toEqual([
        expect.objectContaining({ jsonPointer: "/views/0/profileRef" }),
        expect.objectContaining({ jsonPointer: "/views/1/profileRef" }),
      ]);
  });

  it("全viewでasserted region外のpinned memberをoverlay pointer付きerrorとして拒否しapplyでも再検証する", async () => {
    const current = documentFor(simpleSource(OLD));
    const candidate = documentFor(`
@prefix : <${OLD}> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
:Group a rdfs:Class ; rdfs:label "Group" .
:member a :Group ; rdfs:label "Member" .
`);
    candidate.documentId = "spatial-replacement";
    const regionId = generatedElementId("region", `${OLD}Group`);
    const memberId = generatedElementId("node", `${OLD}member`);
    const invalidOverlay = {
      [regionId]: {
        semanticRef: `${OLD}Group`,
        geometry: { x: 20, y: 20, width: 180, height: 140 },
        pinned: true,
        placement: "user" as const,
      },
      [memberId]: {
        semanticRef: `${OLD}member`,
        geometry: { x: 240, y: 60, width: 100, height: 50 },
        pinned: true,
        placement: "user" as const,
      },
    };
    candidate.views = [
      {
        ...candidate.views[0]!,
        viewId: "regions-a",
        kind: "region",
        overlay: structuredClone(invalidOverlay),
      },
      {
        ...candidate.views[0]!,
        viewId: "regions-b",
        kind: "region",
        overlay: structuredClone(invalidOverlay),
      },
    ];

    const rejected = await previewPortableDocumentReplace(current, candidate, runtimeContext(), {
      documentRevision: "r1",
    });
    expect(rejected.valid).toBe(false);
    expect(rejected.diagnostics.filter((item) => item.code === "region-member-outside")).toEqual([
      expect.objectContaining({
        severity: "error",
        jsonPointer: `/views/0/overlay/${memberId}`,
      }),
      expect.objectContaining({
        severity: "error",
        jsonPointer: `/views/1/overlay/${memberId}`,
      }),
    ]);

    for (const view of candidate.views) {
      view.overlay[memberId]!.geometry = { x: 50, y: 60, width: 100, height: 50 };
    }
    const acceptedPreview = await previewPortableDocumentReplace(current, candidate, runtimeContext(), {
      documentRevision: "r1",
    });
    expect(acceptedPreview.valid).toBe(true);
    const applied = await applyPortableDocumentReplace(current, acceptedPreview, runtimeContext(), {
      confirmationId: acceptedPreview.confirmationId,
      documentRevision: "r1",
    });
    expect(applied.accepted).toBe(true);
    expect(applied.scenes).toHaveProperty("regions-a");
    expect(applied.scenes).toHaveProperty("regions-b");
  });
});

describe("document local namespace rebase", () => {
  it("新しい図への複製で同じbaseを指定すると日本語の修正行動付きで拒否する", async () => {
    const current = documentFor(simpleSource(OLD));
    const snapshot = structuredClone(current);

    const preview = await previewDocumentRebase(
      current,
      { documentId: "opaque-copy-id", baseIri: current.semantic.baseIri },
      runtimeContext(),
      { documentRevision: "r1" },
    );

    expect(preview.valid).toBe(false);
    expect(preview.candidate).toBeUndefined();
    expect(current).toEqual(snapshot);
    expect(preview.diagnostics).toContainEqual(expect.objectContaining({
      severity: "error",
      code: "document-rebase-base-unchanged",
      message: expect.stringContaining("現在と異なるbase IRI"),
      jsonPointer: "/semantic/baseIri",
      suggestedActions: [expect.objectContaining({
        actionId: "allocate-new-document-base",
      })],
    }));
  });

  it("expanded RDF terms/derived overlay refsをrebaseしliteral lexical/external/catalogを保つ", async () => {
    const literalStatement = statementIdentityFromQuad(DataFactory.quad(
      DataFactory.namedNode(`${OLD}a`),
      DataFactory.namedNode(`${OLD}note`),
      DataFactory.literal(OLD, DataFactory.namedNode(`${OLD}Datatype`)),
    ));
    const directStatement = statementIdentityFromQuad(DataFactory.quad(
      DataFactory.namedNode(`${OLD}a`),
      DataFactory.namedNode(`${OLD}rel`),
      DataFactory.namedNode(`${OLD}b`),
    ));
    const current = documentFor(`
@prefix : <${OLD}> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
:a a :LocalClass ; rdfs:label "A" ; :rel :b ; :external <urn:external:item> ;
  :note "${OLD}"^^:Datatype .
:b rdfs:label "B" .
:sequence a rdf:Seq ; rdf:_1 :a ; rdf:_2 :b .
`);
    current.imports = [{ catalogRef: "urn:test:catalog:external@1" }];
    current.views[0]!.overlay = {
      [generatedElementId("node", `${OLD}a`)]: {
        semanticRef: `${OLD}a`,
        geometry: { x: 10, y: 20, width: 164, height: 72 },
        pinned: true,
        placement: "user",
        appearance: {
          iconRef: "urn:test:asset:external-icon",
          styleRef: "urn:test:catalog-style:external",
        },
      },
      [generatedElementId("edge", directStatement)]: {
        semanticRef: directStatement,
        routing: { routeMode: "straight" },
      },
      literal: { semanticRef: literalStatement },
    };
    const snapshot = structuredClone(current);

    const preview = await previewDocumentRebase(
      current,
      { documentId: "rebased", baseIri: NEXT },
      runtimeContext(),
      { documentRevision: "r1" },
    );
    expect(current).toEqual(snapshot);
    expect(preview.valid).toBe(true);
    expect(preview.rebase.termChanges.map((change) => change.from)).toEqual(expect.arrayContaining([
      `${OLD}a`, `${OLD}rel`, `${OLD}LocalClass`, `${OLD}sequence`,
    ]));
    const candidate = preview.candidate!;
    const graph = parseSemanticGraph(candidate);
    expect(graph.store.countQuads(`${NEXT}a`, `${NEXT}rel`, `${NEXT}b`, null)).toBe(1);
    expect(graph.store.countQuads(`${NEXT}a`, `${NEXT}external`, "urn:external:item", null)).toBe(1);
    const literal = graph.store.getObjects(`${NEXT}a`, `${NEXT}note`, null)[0]!;
    expect(literal.value).toBe(OLD);
    expect(literal.termType === "Literal" && literal.datatype.value).toBe(`${NEXT}Datatype`);
    expect(candidate.views[0]!.profileRef).toBe(current.views[0]!.profileRef);
    expect(candidate.imports).toEqual(current.imports);
    expect(Object.values(candidate.views[0]!.overlay).find((entry) => (
      entry.semanticRef === `${NEXT}a`
    ))?.appearance).toEqual({
      iconRef: "urn:test:asset:external-icon",
      styleRef: "urn:test:catalog-style:external",
    });
    expect(Object.values(candidate.views[0]!.overlay).some((entry) => (
      entry.semanticRef === statementIdentityFromQuad(DataFactory.quad(
        DataFactory.namedNode(`${NEXT}a`),
        DataFactory.namedNode(`${NEXT}rel`),
        DataFactory.namedNode(`${NEXT}b`),
      ))
    ))).toBe(true);
    expect(candidate.views[0]!.overlay.literal!.semanticRef).toContain(encodeURIComponent(OLD));
    expect(candidate.views[0]!.overlay.literal!.semanticRef).toContain(encodeURIComponent(`${NEXT}Datatype`));

    const applied = await applyDocumentRebasePreview(current, preview, runtimeContext(), {
      confirmationId: preview.confirmationId,
      documentRevision: "r1",
    });
    expect(applied.accepted).toBe(true);
    expect(applied.document.semantic.baseIri).toBe(NEXT);
  });

  it("delimiterなしbaseでも明示境界だけを所有しlexical siblingをrebaseしない", async () => {
    const oldBase = "https://example.test/doc";
    const nextBase = "https://example.test/copy";
    const sibling = "https://example.test/document2";
    const current = documentFor(`
      <${oldBase}#a> <${oldBase}/rel> <${sibling}> ;
        <${oldBase}/note> "value"^^<${oldBase}#Datatype> .
      <${sibling}> <http://www.w3.org/2000/01/rdf-schema#label> "Sibling" .
    `);
    current.semantic.baseIri = oldBase;
    current.views[0]!.overlay = {
      local: { semanticRef: `${oldBase}#a` },
      sibling: { semanticRef: sibling },
    };

    const preview = await previewDocumentRebase(
      current,
      { documentId: "boundary-safe", baseIri: nextBase },
      runtimeContext(),
      { documentRevision: "r1" },
    );

    expect(preview.valid).toBe(true);
    expect(preview.rebase.termChanges.map((change) => change.from)).toEqual(expect.arrayContaining([
      `${oldBase}#a`, `${oldBase}/rel`, `${oldBase}/note`, `${oldBase}#Datatype`,
    ]));
    expect(preview.rebase.termChanges.map((change) => change.from)).not.toContain(sibling);
    const graph = parseSemanticGraph(preview.candidate!);
    expect(graph.store.countQuads(`${nextBase}#a`, `${nextBase}/rel`, sibling, null)).toBe(1);
    const literal = graph.store.getObjects(`${nextBase}#a`, `${nextBase}/note`, null)[0]!;
    expect(literal.termType === "Literal" && literal.datatype.value).toBe(`${nextBase}#Datatype`);
    expect(preview.candidate!.views[0]!.overlay.local!.semanticRef).toBe(`${nextBase}#a`);
    expect(preview.candidate!.views[0]!.overlay.sibling!.semanticRef).toBe(sibling);

    const incompatibleBoundary = await previewDocumentRebase(
      current,
      { documentId: "boundary-mismatch", baseIri: `${nextBase}/` },
      runtimeContext(),
      { documentRevision: "r1" },
    );
    expect(incompatibleBoundary.valid).toBe(false);
    expect(incompatibleBoundary.diagnostics).toContainEqual(expect.objectContaining({
      code: "document-rebase-base-boundary-incompatible",
      jsonPointer: "/semantic/baseIri",
    }));
  });

  it("nested namespaceへのrebaseは全local termを同時写像し移動予定termを偽衝突にしない", async () => {
    const oldBase = "urn:test:nested:";
    const nextBase = "urn:test:nested:copy:";
    const firstStatement = statementIdentityFromQuad(DataFactory.quad(
      DataFactory.namedNode(`${oldBase}a`),
      DataFactory.namedNode(`${oldBase}rel`),
      DataFactory.namedNode(`${oldBase}copy:a`),
    ));
    const secondStatement = statementIdentityFromQuad(DataFactory.quad(
      DataFactory.namedNode(`${oldBase}copy:a`),
      DataFactory.namedNode(`${oldBase}rel`),
      DataFactory.namedNode(`${oldBase}b`),
    ));
    const current = documentFor(`
      @prefix : <${oldBase}> .
      @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
      :a rdfs:label "A" ; :rel :copy:a .
      :copy:a rdfs:label "Nested A" ; :rel :b .
      :b rdfs:label "B" .
    `);
    current.semantic.baseIri = oldBase;
    current.views[0]!.overlay = {
      [generatedElementId("node", `${oldBase}a`)]: { semanticRef: `${oldBase}a` },
      [generatedElementId("node", `${oldBase}copy:a`)]: { semanticRef: `${oldBase}copy:a` },
      [generatedElementId("edge", firstStatement)]: { semanticRef: firstStatement },
      [generatedElementId("edge", secondStatement)]: { semanticRef: secondStatement },
    };

    const preview = await previewDocumentRebase(
      current,
      { documentId: "nested-copy", baseIri: nextBase },
      runtimeContext(),
      { documentRevision: "r1" },
    );

    expect(preview.valid).toBe(true);
    expect(preview.diagnostics).not.toContainEqual(expect.objectContaining({
      code: "document-rebase-iri-collision",
    }));
    const graph = parseSemanticGraph(preview.candidate!);
    expect(graph.store.countQuads(
      `${nextBase}a`,
      `${nextBase}rel`,
      `${nextBase}copy:a`,
      null,
    )).toBe(1);
    expect(graph.store.countQuads(
      `${nextBase}copy:a`,
      `${nextBase}rel`,
      `${nextBase}b`,
      null,
    )).toBe(1);
    const overlay = preview.candidate!.views[0]!.overlay;
    expect(overlay).toHaveProperty(generatedElementId("node", `${nextBase}a`));
    expect(overlay).toHaveProperty(generatedElementId("node", `${nextBase}copy:a`));
    expect(Object.values(overlay).filter((entry) => (
      entry.semanticRef.startsWith("urn:iriograph:semantic-ref:v1:statement:")
    ))).toHaveLength(2);
  });

  it("RDF term mergeとoverlay key mergeをcollision diagnosticで拒否する", async () => {
    const current = documentFor(`
<${OLD}a> <${OLD}rel> <${NEXT}a> .
`);
    const iriCollision = await previewDocumentRebase(
      current,
      { documentId: "collision", baseIri: NEXT },
      runtimeContext(),
      { documentRevision: "r1" },
    );
    expect(iriCollision.valid).toBe(false);
    expect(iriCollision.diagnostics).toContainEqual(expect.objectContaining({
      code: "document-rebase-iri-collision",
      jsonPointer: "/semantic/source",
    }));

    const overlayOnly = documentFor(simpleSource(OLD));
    overlayOnly.views[0]!.overlay = {
      [generatedElementId("node", `${OLD}a`)]: { semanticRef: `${OLD}a` },
      [generatedElementId("node", `${NEXT}a`)]: { semanticRef: `${NEXT}a` },
    };
    const overlayCollision = await previewDocumentRebase(
      overlayOnly,
      { documentId: "overlay-collision", baseIri: NEXT },
      runtimeContext(),
      { documentRevision: "r1" },
    );
    expect(overlayCollision.valid).toBe(false);
    expect(overlayCollision.diagnostics).toContainEqual(expect.objectContaining({
      code: "document-rebase-overlay-collision",
      jsonPointer: expect.stringMatching(/^\/views\/0\/overlay\//),
    }));

    const semanticRefOnly = documentFor(simpleSource(OLD));
    semanticRefOnly.views[0]!.overlay = {
      local: { semanticRef: `${OLD}a` },
      external: { semanticRef: `${NEXT}a` },
    };
    const semanticRefCollision = await previewDocumentRebase(
      semanticRefOnly,
      { documentId: "semantic-ref-collision", baseIri: NEXT },
      runtimeContext(),
      { documentRevision: "r1" },
    );
    expect(semanticRefCollision.valid).toBe(false);
    expect(semanticRefCollision.diagnostics).toContainEqual(expect.objectContaining({
      code: "document-rebase-overlay-collision",
      message: expect.stringContaining("overlay references"),
    }));

    const sameIdentity = await previewDocumentRebase(
      overlayOnly,
      { documentId: overlayOnly.documentId, baseIri: NEXT },
      runtimeContext(),
      { documentRevision: "r1" },
    );
    expect(sameIdentity.valid).toBe(false);
    expect(sameIdentity.diagnostics).toContainEqual(expect.objectContaining({
      code: "document-rebase-id-unchanged",
      jsonPointer: "/documentId",
    }));
  });
});

function simpleSource(base: string): string {
  return `
@prefix : <${base}> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
:a rdfs:label "A" ; :rel :b .
:b rdfs:label "B" .
`;
}

function documentFor(source: string): IriographDocumentV1 {
  return {
    schemaVersion: "1",
    kind: "iriograph.document",
    documentId: "portable-test",
    semantic: {
      format: "text/turtle",
      baseIri: OLD,
      authoringProfileRef: "urn:test:authoring:portable",
      source,
    },
    views: [{
      viewId: "main",
      kind: "node-link",
      profileRef: standardRdfRdfsCatalog.profileRef,
      layoutRef: standardRdfRdfsCatalog.defaults!.layoutRef,
      overlay: {},
    }],
  };
}

function runtimeContext(): ProjectionRuntimeContext {
  return {
    catalogsByProfile: new Map([[
      standardRdfRdfsCatalog.profileRef,
      { catalog: standardRdfRdfsCatalog },
    ]]),
    layouts: createStandardLayoutRegistry(),
  };
}
