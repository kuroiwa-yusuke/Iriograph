import { describe, expect, it } from "vitest";

import { statementIdentity } from "./identity";
import type { IriographDocumentV1, ProjectionCatalogV1 } from "./model";
import { projectSemanticView } from "./projection";
import { reconcileIriographDocumentViews } from "./reconciliation";
import {
  validateIriographDocumentV1,
  validateProjectionCatalogV1,
} from "./schema";
import {
  buildIriographView,
  createProjectionRuntimeContext,
} from "./scene";
import { createStandardLayoutRegistry } from "./layout";

const NS = "urn:test:rdf-view:";
const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const RDFS = "http://www.w3.org/2000/01/rdf-schema#";
const XSD = "http://www.w3.org/2001/XMLSchema#";
const NODE_TEMPLATE = `${NS}template:node`;
const EDGE_TEMPLATE = `${NS}template:edge`;
const CONTAINER_TEMPLATE = `${NS}template:container`;
const ANNOTATION_TEMPLATE = `${NS}template:annotation`;

const catalog: ProjectionCatalogV1 = {
  schemaVersion: "1",
  kind: "iriograph.catalog",
  catalogId: `${NS}catalog`,
  catalogVersion: "1",
  profileRef: `${NS}profile`,
  defaults: {
    nodeTemplateRef: NODE_TEMPLATE,
    edgeTemplateRef: EDGE_TEMPLATE,
    layoutRef: "urn:iriograph:layout:hierarchical-lr:1",
  },
  rules: [
    {
      ruleId: "task",
      priority: 100,
      match: { kind: "type", iri: `${NS}Task`, entailment: "exact" },
      project: { operator: "resource", structuralKind: "node" },
      templateRef: NODE_TEMPLATE,
    },
    {
      ruleId: "sequence",
      priority: 100,
      match: { kind: "type", iri: `${RDF}Seq`, entailment: "exact" },
      project: { operator: "ordinal-sequence", ordinalPredicatePrefix: `${RDF}_` },
      templateRef: CONTAINER_TEMPLATE,
    },
    {
      ruleId: "connects",
      priority: 100,
      match: { kind: "predicate", iri: `${NS}connects`, entailment: "exact" },
      project: { operator: "direct-edge" },
      templateRef: EDGE_TEMPLATE,
    },
    {
      ruleId: "literal-note",
      priority: 100,
      match: { kind: "predicate", iri: `${NS}note`, entailment: "exact" },
      project: {
        operator: "literal-annotation",
        anchorPosition: "subject",
        languages: ["ja"],
        datatypes: [`${RDF}langString`, `${XSD}string`],
      },
      templateRef: ANNOTATION_TEMPLATE,
    },
    {
      ruleId: "suppress-type",
      priority: 200,
      match: { kind: "predicate", iri: `${RDF}type`, entailment: "exact" },
      project: { operator: "suppress" },
    },
    {
      ruleId: "fallback-edge",
      priority: 0,
      match: { kind: "any-iri-object" },
      project: { operator: "direct-edge" },
      templateRef: EDGE_TEMPLATE,
    },
  ],
  templates: {
    [NODE_TEMPLATE]: {
      templateRef: NODE_TEMPLATE,
      structuralKind: "node",
      shape: "rounded-rectangle",
      ports: [
        {
          portId: "out",
          role: "source",
          side: "right",
          position: .5,
          predicateIris: [`${NS}connects`],
          classIris: [`${NS}Task`],
        },
        {
          portId: "in",
          role: "target",
          side: "left",
          position: .5,
          predicateIris: [`${NS}connects`],
          classIris: [`${NS}Task`],
        },
      ],
      style: { fill: "white", stroke: "black", text: "black" },
      defaultSize: { width: 100, height: 72 },
    },
    [EDGE_TEMPLATE]: {
      templateRef: EDGE_TEMPLATE,
      structuralKind: "edge",
      style: { fill: "none", stroke: "black", text: "black" },
    },
    [CONTAINER_TEMPLATE]: {
      templateRef: CONTAINER_TEMPLATE,
      structuralKind: "container",
      headerPosition: "top",
      style: { fill: "white", stroke: "black", text: "black" },
    },
    [ANNOTATION_TEMPLATE]: {
      templateRef: ANNOTATION_TEMPLATE,
      structuralKind: "annotation",
      style: { fill: "#fff8cc", stroke: "#8a7120", text: "black" },
      defaultSize: { width: 220, height: 88 },
    },
  },
  assets: {},
};

function documentFor(options: {
  scope?: IriographDocumentV1["views"][number]["scope"];
  edgeRouting?: IriographDocumentV1["views"][number]["overlay"][string]["routing"];
  annotations?: IriographDocumentV1["views"][number]["annotations"];
} = {}): IriographDocumentV1 {
  const edgeRef = statementIdentity(`${NS}a`, `${NS}connects`, `${NS}b`);
  return {
    schemaVersion: "1",
    kind: "iriograph.document",
    documentId: "rdf-view-contract",
    semantic: {
      format: "text/turtle",
      baseIri: NS,
      authoringProfileRef: `${NS}authoring-profile`,
      source: `
        @prefix t: <${NS}> .
        @prefix rdf: <${RDF}> .
        @prefix rdfs: <${RDFS}> .
        t:a a t:Task ; rdfs:label "A" ; t:connects t:b ;
          t:note "本文"@ja ; t:unregistered "hidden"@en .
        t:b a t:Task ; rdfs:label "B" ; t:connects t:c .
        t:c a t:Task ; rdfs:label "C" .
        t:seq a rdf:Seq ; rdf:_1 t:a ; rdf:_2 t:b ; rdf:_3 t:c .
      `,
    },
    views: [{
      viewId: "main",
      kind: "node-link",
      profileRef: catalog.profileRef,
      layoutRef: catalog.defaults!.layoutRef,
      scope: options.scope,
      overlay: {
        a: {
          semanticRef: `${NS}a`,
          geometry: { x: 0, y: 100, width: 100, height: 72 },
          pinned: true,
          placement: "user",
        },
        b: {
          semanticRef: `${NS}b`,
          geometry: { x: 400, y: 100, width: 100, height: 72 },
          pinned: true,
          placement: "user",
        },
        edge: {
          semanticRef: edgeRef,
          routing: options.edgeRouting,
        },
      },
      annotations: options.annotations,
    }],
  };
}

describe("literal annotation and template port projection", () => {
  it("projects only catalog-declared literal statements with exact metadata and provenance", () => {
    const document = documentFor();
    const sourceBeforeProjection = document.semantic.source;
    const scene = projectSemanticView(document, catalog);
    const semantic = scene.annotations?.filter(({ annotationKind }) => annotationKind === "semantic-literal");

    expect(semantic).toHaveLength(1);
    expect(semantic?.[0]).toMatchObject({
      text: "本文",
      language: "ja",
      datatypeIri: `${RDF}langString`,
      statementRef: expect.stringContaining("urn:iriograph:semantic-ref:v1:statement:"),
      anchorSemanticRef: `${NS}a`,
      anchorElementId: "a",
      provenance: {
        operator: "literal-annotation",
        sourceStatementRefs: [expect.stringContaining("urn:iriograph:semantic-ref:v1:statement:")],
      },
    });
    expect(scene.annotations?.some(({ text }) => text === "hidden")).toBe(false);
    expect(document.semantic.source).toBe(sourceBeforeProjection);
  });

  it("reconciles semantic annotation geometry by statement identity and removes stale source values", async () => {
    const previous = documentFor();
    const semantic = projectSemanticView(previous, catalog).annotations!
      .find(({ annotationKind }) => annotationKind === "semantic-literal")!;
    previous.views[0]!.overlay.literal = {
      semanticRef: semantic.statementRef!,
      geometry: { x: 600, y: 120, width: 260, height: 100 },
      pinned: true,
      placement: "user",
    };
    const context = createProjectionRuntimeContext([{
      profileRef: catalog.profileRef,
      sourceCatalogRefs: [],
      catalog,
      ruleOrigins: [],
    }], createStandardLayoutRegistry());

    const stable = await reconcileIriographDocumentViews(
      previous,
      structuredClone(previous),
      context,
    );
    expect(stable.accepted).toBe(true);
    expect(stable.document.views[0]!.overlay.literal).toMatchObject({
      semanticRef: semantic.statementRef,
      geometry: { x: 600, y: 120, width: 260, height: 100 },
      pinned: true,
      placement: "user",
    });

    const changed = structuredClone(stable.document);
    changed.semantic.source = changed.semantic.source.replace('t:note "本文"@ja', 't:note "更新"@ja');
    const updated = await reconcileIriographDocumentViews(stable.document, changed, context);
    expect(updated.accepted).toBe(true);
    expect(Object.values(updated.document.views[0]!.overlay)
      .some(({ semanticRef }) => semanticRef === semantic.statementRef)).toBe(false);
    expect(updated.scenes.main!.annotations?.find(({ annotationKind }) => (
      annotationKind === "semantic-literal"
    ))).toMatchObject({ text: "更新", placement: "generated" });
    expect(updated.diagnostics).toContainEqual(expect.objectContaining({
      code: "reconcile-stale-overlay-removed",
      semanticRef: semantic.statementRef,
    }));
  });

  it("resolves compatible ports and falls back to the sparse perimeter anchor on mismatch", () => {
    const edgeRef = statementIdentity(`${NS}a`, `${NS}connects`, `${NS}b`);
    const valid = projectSemanticView(documentFor({
      edgeRouting: { sourcePortId: "out", targetPortId: "in" },
    }), catalog);
    expect(valid.edges.find(({ semanticRef }) => semanticRef === edgeRef)).toMatchObject({
      sourcePortId: "out",
      targetPortId: "in",
      sourceAnchor: { position: .25 },
      targetAnchor: { position: .75 },
      provenance: {
        editCapability: {
          subject: `${NS}a`,
          predicate: `${NS}connects`,
          object: `${NS}b`,
        },
      },
    });

    const fallback = projectSemanticView(documentFor({
      edgeRouting: { sourcePortId: "in", sourceAnchor: { position: .6 } },
    }), catalog);
    expect(fallback.edges.find(({ semanticRef }) => semanticRef === edgeRef)).toMatchObject({
      sourceAnchor: { position: .6 },
    });
    expect(fallback.edges.find(({ semanticRef }) => semanticRef === edgeRef))
      .not.toHaveProperty("sourcePortId");
    expect(fallback.diagnostics).toContainEqual(expect.objectContaining({
      code: "edge-port-role-mismatch",
      statementRef: edgeRef,
    }));

    const unresolved = projectSemanticView(documentFor({
      edgeRouting: { sourcePortId: "removed" },
    }), catalog);
    expect(unresolved.edges.find(({ semanticRef }) => semanticRef === edgeRef))
      .not.toHaveProperty("sourcePortId");
    expect(unresolved.diagnostics).toContainEqual(expect.objectContaining({
      code: "edge-port-unresolved",
      statementRef: edgeRef,
    }));

    const predicateMismatchCatalog = structuredClone(catalog);
    predicateMismatchCatalog.templates[NODE_TEMPLATE]!.ports![0]!.predicateIris = [`${NS}other`];
    const predicateMismatch = projectSemanticView(documentFor({
      edgeRouting: { sourcePortId: "out" },
    }), predicateMismatchCatalog);
    expect(predicateMismatch.diagnostics).toContainEqual(expect.objectContaining({
      code: "edge-port-predicate-mismatch",
      statementRef: edgeRef,
    }));

    const classMismatchCatalog = structuredClone(catalog);
    classMismatchCatalog.templates[NODE_TEMPLATE]!.ports![0]!.classIris = [`${NS}Other`];
    const classMismatch = projectSemanticView(documentFor({
      edgeRouting: { sourcePortId: "out" },
    }), classMismatchCatalog);
    expect(classMismatch.diagnostics).toContainEqual(expect.objectContaining({
      code: "edge-port-class-mismatch",
      statementRef: edgeRef,
    }));
  });
});

describe("view annotation and named view scope", () => {
  it("validates closed optional schema v1 fields and annotation map identity", () => {
    const source = documentFor({
      scope: {
        rootSemanticRefs: [`${NS}a`],
        predicateIris: [`${NS}connects`, `${NS}note`],
        direction: "outgoing",
        depth: 1,
      },
      edgeRouting: { sourcePortId: "out", targetPortId: "in" },
      annotations: {
        note: {
          annotationId: "note",
          text: "view only",
          geometry: { x: 200, y: 80, width: 100, height: 100 },
          anchor: { elementId: "a", offset: { x: 4, y: -3 } },
        },
      },
    });
    expect(validateIriographDocumentV1(source).valid).toBe(true);
    expect(validateProjectionCatalogV1(catalog).valid).toBe(true);

    source.views[0]!.annotations!.note!.annotationId = "different";
    expect(validateIriographDocumentV1(source)).toMatchObject({
      valid: false,
      issues: [expect.objectContaining({ keyword: "map-key" })],
    });

    const duplicatePorts = structuredClone(catalog);
    duplicatePorts.templates[NODE_TEMPLATE]!.ports!.push({
      ...duplicatePorts.templates[NODE_TEMPLATE]!.ports![0]!,
    });
    expect(validateProjectionCatalogV1(duplicatePorts)).toMatchObject({
      valid: false,
      issues: [expect.objectContaining({ keyword: "unique" })],
    });
  });

  it("applies deterministic reachability without cross-hidden edges and marks Seq truncation", () => {
    const scene = projectSemanticView(documentFor({
      scope: {
        rootSemanticRefs: [`${NS}a`],
        typeIris: [`${NS}Task`],
        predicateIris: [`${NS}connects`, `${NS}note`],
        direction: "outgoing",
        depth: 1,
      },
    }), catalog);

    expect(scene.nodes.map(({ semanticRef }) => semanticRef)).toEqual([`${NS}a`, `${NS}b`]);
    expect(scene.edges).toHaveLength(1);
    expect(scene.edges[0]).toMatchObject({
      sourceElementId: "a",
      targetElementId: "b",
    });
    expect(scene.containers).toHaveLength(1);
    expect(scene.containers[0]?.groupFrame).toMatchObject({
      kind: "sequence",
      scopeClosure: {
        reason: "visible-member",
        memberElementIds: ["a", "b"],
        provenance: { sourceStatementRefs: expect.any(Array) },
      },
      scopeTruncation: {
        marker: "truncated",
        hiddenMemberCount: 1,
        hiddenStatementRefs: [expect.stringContaining("urn:iriograph:semantic-ref:v1:statement:")],
        provenance: { operator: "ordinal-sequence" },
      },
    });
    expect(scene.memberships).toHaveLength(2);
    expect(scene.groupGuides).toHaveLength(1);
  });

  it("projects view notes, detaches missing anchors, and routes around annotation geometry", async () => {
    const document = documentFor({
      edgeRouting: { sourcePortId: "out", targetPortId: "in" },
      annotations: {
        note: {
          annotationId: "note",
          text: "view only",
          geometry: { x: 200, y: 80, width: 100, height: 100 },
          anchor: { elementId: "a", offset: { x: 4, y: -3 } },
        },
        detached: {
          annotationId: "detached",
          text: "detached",
          geometry: { x: 0, y: 300, width: 100, height: 60 },
          anchor: { elementId: "removed-node" },
        },
        chained: {
          annotationId: "chained",
          text: "anchored to another note",
          geometry: { x: 540, y: 260, width: 160, height: 60 },
          anchor: { elementId: "note" },
        },
      },
    });
    const context = createProjectionRuntimeContext([{
      profileRef: catalog.profileRef,
      sourceCatalogRefs: [],
      catalog,
      ruleOrigins: [],
    }], createStandardLayoutRegistry());
    const sourceBeforeProjection = document.semantic.source;
    const scene = await buildIriographView(document, "main", context, "full");

    expect(scene.annotations?.find(({ annotationId }) => annotationId === "note")).toMatchObject({
      annotationKind: "view",
      text: "view only",
      geometry: { x: 200, y: 80, width: 100, height: 100 },
      anchorElementId: "a",
      anchorOffset: { x: 4, y: -3 },
      provenance: { kind: "view-annotation", annotationId: "note" },
    });
    const detached = scene.annotations?.find(({ annotationId }) => annotationId === "detached");
    expect(detached).toMatchObject({
      detachedAnchorElementId: "removed-node",
    });
    expect(detached).not.toHaveProperty("anchorElementId");
    expect(scene.diagnostics).toContainEqual(expect.objectContaining({
      code: "view-annotation-anchor-detached",
      semanticRef: "detached",
    }));
    expect(scene.annotations?.find(({ annotationId }) => annotationId === "chained"))
      .toMatchObject({ anchorElementId: "note" });
    const edge = scene.edges.find(({ semanticRef }) => (
      semanticRef === statementIdentity(`${NS}a`, `${NS}connects`, `${NS}b`)
    ));
    expect(edge?.derivedRouteChoice?.family).not.toBe("straight");
    expect(edge?.derivedRouteChoice?.rejected).toContainEqual(expect.objectContaining({
      family: "straight",
      reason: "obstacle",
    }));
    expect(document.semantic.source).toBe(sourceBeforeProjection);
  });
});
