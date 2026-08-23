import { describe, expect, it } from "vitest";

import { applySemanticSource } from "./document";
import {
  sequenceTransitionIdentity,
  statementIdentity,
} from "./identity";
import {
  createStandardLayoutRegistry,
  LayoutAdapterRegistry,
  STANDARD_LAYOUT_REFS,
  StandardLightweightLayoutAdapter,
} from "./layout";
import type { IriographDocumentV1 } from "./model";
import type { ProjectionRuntimeContext } from "./scene";
import { standardRdfRdfsCatalog } from "./standard-catalog";

const NS = "urn:test:reconcile:";
const directEdgeRef = statementIdentity(`${NS}a`, `${NS}rel`, `${NS}b`);
const oldSequenceRef = sequenceTransitionIdentity(`${NS}flow`, 1, 2);

describe("display reconciliation", () => {
  it("全viewでadd/delete/type/containment/sequence変更をatomicにreconcileする", async () => {
    const previous = documentFor(oldSource);
    const result = await applySemanticSource(previous, newSource, runtimeContext());

    expect(result.accepted).toBe(true);
    expect(result.document.semantic.source).toBe(newSource);
    expect(result.document.views).toHaveLength(2);

    const main = result.document.views.find((view) => view.viewId === "main")!;
    const alternate = result.document.views.find((view) => view.viewId === "alternate")!;
    const mainA = overlayFor(main.overlay, `${NS}a`);
    const alternateA = overlayFor(alternate.overlay, `${NS}a`);
    expect(mainA).toMatchObject({
      geometry: { x: 10, y: 20, width: 164, height: 72 },
      pinned: true,
      placement: "user",
    });
    expect(alternateA).toMatchObject({
      geometry: { x: 410, y: 220, width: 164, height: 72 },
      pinned: true,
      placement: "user",
    });
    expect(mainA?.appearance).toBeUndefined();

    expect(overlayFor(main.overlay, `${NS}d`)).toMatchObject({
      geometry: expect.any(Object),
      pinned: false,
      placement: "generated",
    });
    expect(overlayFor(alternate.overlay, `${NS}d`)).toMatchObject({
      geometry: expect.any(Object),
      placement: "generated",
    });
    expect(overlayFor(main.overlay, `${NS}c`)).toBeUndefined();
    expect(overlayFor(main.overlay, oldSequenceRef)).toBeUndefined();
    expect(overlayFor(main.overlay, directEdgeRef)).toMatchObject({
      semanticRef: directEdgeRef,
      routing: { waypoints: [{ x: 300, y: 90 }] },
      appearance: { templateRef: "urn:iriograph:template:edge:reference:1" },
    });
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: "reconcile-primitive-changed",
      semanticRef: `${NS}a`,
    }));
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: "reconcile-stale-overlay-removed",
      semanticRef: `${NS}c`,
    }));
  });

  it("一つのviewでもlayoutを解決できなければ全documentをrollbackする", async () => {
    const previous = documentFor(oldSource);
    const context = runtimeContext(new LayoutAdapterRegistry([
      new StandardLightweightLayoutAdapter(STANDARD_LAYOUT_REFS.hierarchicalLr, "LR"),
    ]));
    const result = await applySemanticSource(previous, newSource, context);

    expect(result.accepted).toBe(false);
    expect(result.document).toEqual(previous);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      severity: "error",
      code: "layout-adapter-unresolved",
    }));
  });

  it("Bagでないsubjectのrdfs:memberを全rollbackする", async () => {
    const previous = documentFor(oldSource);
    const invalid = `${oldSource}\n:a rdfs:member :b .`;
    const result = await applySemanticSource(previous, invalid, runtimeContext());

    expect(result.accepted).toBe(false);
    expect(result.document).toEqual(previous);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      severity: "error",
      code: "membership-parent-invalid",
      semanticRef: `${NS}a`,
    }));
  });
});

const oldSource = `
@prefix : <${NS}> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
:lane a rdf:Bag ; rdfs:label "Lane"@en, "レーン"@ja ; rdfs:member :a, :b, :c .
:flow a rdf:Seq ; rdf:_1 :a ; rdf:_2 :b ; rdf:_3 :c .
:a rdfs:label "A"@en, "甲"@ja ; :rel :b .
:b rdfs:label "B"@en, "乙"@ja .
:c rdfs:label "C"@en, "丙"@ja .
`;

const newSource = `
@prefix : <${NS}> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
:lane a rdf:Bag ; rdfs:label "Lane"@en, "レーン"@ja ; rdfs:member :b .
:lane2 a rdf:Bag ; rdfs:label "Second lane"@en, "第2レーン"@ja ; rdfs:member :a, :d .
:flow a rdf:Seq ; rdf:_1 :a ; rdf:_2 :d ; rdf:_3 :b .
:a a rdf:Bag ; rdfs:label "A container"@en, "甲コンテナ"@ja ; rdfs:member :inner ; :rel :b .
:b rdfs:label "B"@en, "乙"@ja .
:d rdfs:label "D"@en, "丁"@ja .
:inner rdfs:label "Inner"@en, "内部"@ja .
`;

function documentFor(source: string): IriographDocumentV1 {
  return {
    schemaVersion: "1",
    kind: "iriograph.document",
    documentId: "reconciliation-test",
    semantic: {
      format: "text/turtle",
      baseIri: NS,
      authoringProfileRef: "urn:test:authoring:1",
      source,
    },
    imports: [{ catalogRef: "urn:iriograph:catalog:rdf-rdfs@1" }],
    views: [
      viewFor(
        "main",
        STANDARD_LAYOUT_REFS.hierarchicalLr,
        "ja-JP",
        { x: 10, y: 20, width: 164, height: 72 },
      ),
      viewFor(
        "alternate",
        STANDARD_LAYOUT_REFS.hierarchicalTb,
        "en-US",
        { x: 410, y: 220, width: 164, height: 72 },
      ),
    ],
  };
}

function viewFor(
  viewId: string,
  layoutRef: string,
  locale: string,
  geometry: { x: number; y: number; width: number; height: number },
): IriographDocumentV1["views"][number] {
  return {
    viewId,
    kind: "node-link",
    profileRef: standardRdfRdfsCatalog.profileRef,
    layoutRef,
    locale,
    overlay: {
      [`${viewId}-a`]: {
        semanticRef: `${NS}a`,
        geometry,
        pinned: true,
        placement: "user",
        appearance: {
          templateRef: standardRdfRdfsCatalog.defaults!.nodeTemplateRef,
          iconRef: "urn:test:asset:a",
        },
      },
      [`${viewId}-c`]: {
        semanticRef: `${NS}c`,
        geometry: { x: 700, y: 200, width: 164, height: 72 },
        placement: "generated",
      },
      [`${viewId}-direct`]: {
        semanticRef: directEdgeRef,
        appearance: { templateRef: "urn:iriograph:template:edge:reference:1" },
        routing: { waypoints: [{ x: 300, y: 90 }] },
      },
      [`${viewId}-sequence`]: {
        semanticRef: oldSequenceRef,
        routing: { waypoints: [{ x: 250, y: 70 }] },
      },
    },
  };
}

function runtimeContext(
  layouts = createStandardLayoutRegistry(),
): ProjectionRuntimeContext {
  return {
    catalogsByProfile: new Map([[
      standardRdfRdfsCatalog.profileRef,
      { catalog: standardRdfRdfsCatalog },
    ]]),
    layouts,
  };
}

function overlayFor(
  overlay: IriographDocumentV1["views"][number]["overlay"],
  semanticRef: string,
) {
  return Object.values(overlay).find((entry) => entry.semanticRef === semanticRef);
}
