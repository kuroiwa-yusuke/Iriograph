import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { statementIdentity } from "./identity";
import type { IriographDocumentV1, ProjectionCatalogV1 } from "./model";
import { projectSemanticView } from "./projection";
import { standardRdfRdfsCatalog } from "./standard-catalog";

const workflowSource = readFileSync(
  new URL("./fixtures/rdf-rdfs.valid-workflow.ttl", import.meta.url),
  "utf8",
);
const invalidStructureSource = readFileSync(
  new URL("./fixtures/rdf-rdfs.invalid-structure.ttl", import.meta.url),
  "utf8",
);

describe("RDF/RDFS standard projection", () => {
  it("Bag、Seq、Alt、direct edge、suppress、fallbackを汎用operatorで投影する", () => {
    const scene = projectSemanticView(documentFor(workflowSource), standardRdfRdfsCatalog);

    expect(scene.diagnostics).toEqual([]);
    expect(scene.containers).toHaveLength(2);
    expect(scene.nodes).toHaveLength(8);
    expect(scene.edges).toHaveLength(9);
    expect(scene.nodes.every((node) => node.geometry === undefined)).toBe(true);
    expect(scene.nodes.find((node) => node.semanticRef === "urn:test:workflow:decision")).toMatchObject({
      label: "判断",
      shape: "diamond",
      provenance: {
        operator: "alternative",
        rule: {
          catalogRef: "urn:iriograph:catalog:rdf-rdfs@1",
          ruleId: "rdf-alt",
        },
      },
    });
    expect(scene.edges.filter((edge) => edge.fallback)).toHaveLength(1);
    expect(scene.edges.find((edge) => edge.fallback)).toMatchObject({
      label: "dependsOn",
      sourceMarker: "none",
      targetMarker: "arrow",
      provenance: {
        derivation: "direct",
        rule: { ruleId: "iri-object-fallback" },
      },
    });
    expect(scene.edges.filter((edge) => edge.provenance.operator === "ordinal-sequence")).toHaveLength(5);
    expect(scene.edges.filter((edge) => edge.provenance.operator === "alternative")).toHaveLength(2);
  });

  it("subClassOf/subPropertyOfの限定closureをrule matchingだけに使う", () => {
    const scene = projectSemanticView(documentFor(`
      @prefix : <urn:test:closure:> .
      @prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
      @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
      :Region rdfs:subClassOf rdf:Bag .
      :PolicyLink rdfs:subPropertyOf rdfs:seeAlso .
      :lane a :Region ; rdfs:member :a .
      :a rdfs:label "A" ; :PolicyLink :b .
      :b rdfs:label "B" .
    `), standardRdfRdfsCatalog);

    expect(scene.diagnostics).toEqual([]);
    expect(scene.containers.some((container) => container.semanticRef === "urn:test:closure:lane")).toBe(true);
    expect(scene.edges.find((edge) => edge.label === "PolicyLink")).toMatchObject({
      templateRef: "urn:iriograph:template:edge:reference:1",
      targetMarker: "open-arrow",
      style: standardRdfRdfsCatalog.templates[standardRdfRdfsCatalog.defaults!.edgeTemplateRef]!.style,
      provenance: { rule: { ruleId: "rdfs-see-also" } },
    });
  });

  it("複数container membershipをsemanticとして保持しhierarchy parentへ縮約しない", () => {
    const source = `
      @prefix : <urn:test:multi:> .
      @prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
      @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
      :contains rdfs:subPropertyOf rdfs:member ; rdfs:label "Contains" ; rdfs:comment "Domain membership" .
      :left a rdf:Bag ; rdfs:label "Left" ; :contains :shared .
      :right a rdf:Bag ; rdfs:label "Right" ; rdfs:member :shared .
      :shared rdfs:label "Shared" .
    `;
    const hierarchy = projectSemanticView(documentFor(source), standardRdfRdfsCatalog);
    const shared = hierarchy.nodes.find((node) => node.semanticRef === "urn:test:multi:shared")!;

    expect(hierarchy.nodes.some((node) => node.semanticRef === "urn:test:multi:shared"))
      .toBe(true);
    expect(hierarchy.containers).toHaveLength(2);
    expect(hierarchy.memberships).toHaveLength(2);
    expect(hierarchy.memberships?.map((membership) => membership.containerElementId))
      .toEqual([...hierarchy.memberships!.map((membership) => membership.containerElementId)].sort());
    expect(hierarchy.memberships).toContainEqual(expect.objectContaining({
      semanticRef: statementIdentity(
        "urn:test:multi:left",
        "urn:test:multi:contains",
        "urn:test:multi:shared",
      ),
      provenance: expect.objectContaining({
        editCapability: expect.objectContaining({ predicate: "urn:test:multi:contains" }),
      }),
    }));
    expect(shared.parentElementId).toBeUndefined();
    expect(hierarchy.diagnostics).toContainEqual(expect.objectContaining({
      severity: "warning",
      code: "multiple-container-memberships-not-hierarchical",
    }));
    expect(hierarchy.diagnostics.some((item) => item.code === "multiple-container-parents"))
      .toBe(false);

    const regionDocument = documentFor(source);
    regionDocument.views[0]!.kind = "region";
    const region = projectSemanticView(regionDocument, standardRdfRdfsCatalog);
    expect(region.containers).toEqual([]);
    expect(region.regions).toHaveLength(2);
    expect(region.memberships?.every((membership) => (
      membership.regionElementId === membership.containerElementId
    ))).toBe(true);
    expect(region.diagnostics).toEqual([]);
  });

  it("declared RDFS classesをregion viewで独立領域として投影し複数rdf:typeを交差membershipにする", () => {
    const source = `
      @prefix : <urn:test:class-region:> .
      @prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
      @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
      :left a rdfs:Class ; rdfs:label "Left" .
      :right a rdfs:Class ; rdfs:label "Right" .
      :shared a :left, :right ; rdfs:label "Shared" .
    `;
    const regionDocument = documentFor(source);
    regionDocument.views[0]!.kind = "region";
    const region = projectSemanticView(regionDocument, standardRdfRdfsCatalog);

    expect(region.diagnostics).toEqual([]);
    expect(region.regions?.map((value) => value.semanticRef)).toEqual([
      "urn:test:class-region:left",
      "urn:test:class-region:right",
    ]);
    expect(region.memberships).toHaveLength(2);
    expect(region.memberships?.every((value) => value.provenance.operator === "membership-region"))
      .toBe(true);
    expect(region.memberships?.every((value) => (
      value.provenance.editCapability?.command === "set-membership"
      && value.provenance.editCapability.containerPosition === "object"
    ))).toBe(true);
    expect(region.nodes.find((value) => value.semanticRef.endsWith(":shared"))?.parentElementId)
      .toBeUndefined();

    const nodeLink = projectSemanticView(documentFor(source), standardRdfRdfsCatalog);
    expect(nodeLink.regions).toEqual([]);
    expect(nodeLink.memberships).toEqual([]);
    expect(nodeLink.nodes).toHaveLength(3);
  });

  it("複数・多言語・改行label/commentを保持しlocale選択とedge label由来を公開する", () => {
    const scene = projectSemanticView(documentFor(`
      @prefix : <urn:test:text:> .
      @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
      :a rdfs:label "English"@en, "日本語\\nラベル"@ja ;
         rdfs:comment "一行目\\n二行目", "補足"@ja ;
         :connects :b .
      :b rdfs:label "B" .
      :connects rdfs:label "Connect"@en, "接続"@ja ;
        rdfs:comment "関係の説明\\n続き"@ja .
    `), standardRdfRdfsCatalog);
    const node = scene.nodes.find((value) => value.semanticRef === "urn:test:text:a")!;
    const edge = scene.edges.find((value) => value.provenance.derivation === "direct")!;

    expect(node.label).toBe("日本語\nラベル");
    expect(node.semanticText?.labels).toHaveLength(2);
    expect(node.semanticText?.comments.map((value) => value.value)).toEqual([
      "一行目\n二行目",
      "補足",
    ]);
    expect(edge.label).toBe("接続");
    expect(edge.semanticText?.comments[0]?.value).toBe("関係の説明\n続き");
    expect(edge.labelProvenance).toMatchObject({
      kind: "predicate",
      labelSemanticRef: "urn:test:text:connects",
    });
    expect(edge.labelProvenance?.sourceStatementRefs).toHaveLength(2);
  });

  it("derived edgeの表示labelがどの構造resource由来かを公開する", () => {
    const scene = projectSemanticView(documentFor(workflowSource), standardRdfRdfsCatalog);
    const branch = scene.edges.find((edge) => edge.label === "承認")!;
    const transition = scene.edges.find((edge) => edge.provenance.operator === "ordinal-sequence")!;

    expect(branch.labelProvenance).toMatchObject({
      kind: "derived-structure",
      role: "alternative-branch",
      structureSemanticRef: "urn:test:workflow:decision",
      labelSemanticRef: "urn:test:workflow:approvedPath",
    });
    expect(transition.labelProvenance).toMatchObject({
      kind: "derived-structure",
      role: "sequence-transition",
      fromOrdinal: 1,
      toOrdinal: 2,
    });
  });

  it("appearanceをtemplate、catalog styleRef、view overrideの順に安全にmergeする", () => {
    const document = documentFor(`
      @prefix : <urn:test:style:> .
      @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
      :a rdfs:label "A" .
    `);
    document.views[0]!.overlay.a = {
      semanticRef: "urn:test:style:a",
      appearance: {
        styleRef: "urn:iriograph:style:region:overlap:1",
        style: { fill: "#112233", strokeWidth: 4 },
      },
    };
    const scene = projectSemanticView(document, standardRdfRdfsCatalog);
    expect(scene.nodes[0]?.style).toMatchObject({
      fill: "#112233",
      stroke: "#7c3aed",
      text: "#4c1d95",
      fillOpacity: 0.2,
      strokeWidth: 4,
      dash: "6 4",
    });
  });

  it("ordinal-sequence ruleの任意edge templateをderived edgeへ適用する", () => {
    const edgeTemplateRef = "urn:iriograph:template:edge:reference:1";
    const catalog: ProjectionCatalogV1 = {
      ...standardRdfRdfsCatalog,
      rules: standardRdfRdfsCatalog.rules.map((rule) => (
        rule.ruleId === "rdf-seq" ? { ...rule, templateRef: edgeTemplateRef } : rule
      )),
    };

    const scene = projectSemanticView(documentFor(workflowSource), catalog);

    expect(scene.diagnostics).toEqual([]);
    expect(scene.edges
      .filter((edge) => edge.provenance.operator === "ordinal-sequence")
      .every((edge) => edge.templateRef === edgeTemplateRef)).toBe(true);
  });

  it("標準predicateのedge線は共通にしterminal markerだけをcatalogで区別する", () => {
    const generic = standardRdfRdfsCatalog.templates["urn:iriograph:template:edge:generic:1"]!;
    const reference = standardRdfRdfsCatalog.templates["urn:iriograph:template:edge:reference:1"]!;
    const specialization = standardRdfRdfsCatalog.templates[
      "urn:iriograph:template:edge:specialization:1"
    ]!;
    const ontology = standardRdfRdfsCatalog.templates["urn:iriograph:template:edge:ontology:1"]!;

    expect(reference.style).toEqual(generic.style);
    expect(specialization.style).toEqual(generic.style);
    expect(ontology.style).toEqual(generic.style);
    expect([generic.targetMarker, reference.targetMarker, specialization.targetMarker]).toEqual([
      "arrow",
      "open-arrow",
      "triangle",
    ]);
  });

  it("Turtleの整形とstatement中の区切り文字に依存しないidentityを使う", () => {
    const first = documentFor(`
      @prefix : <urn:test:id:> .
      @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
      :a rdfs:label "A" ; :p :b .
      :b rdfs:label "B" .
    `);
    const second = documentFor(`
      @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
      @prefix x: <urn:test:id:> .
      x:b rdfs:label "B" .
      x:a x:p x:b ; rdfs:label "A" .
    `);
    const firstEdge = projectSemanticView(first, standardRdfRdfsCatalog).edges[0];
    const secondEdge = projectSemanticView(second, standardRdfRdfsCatalog).edges[0];

    expect(firstEdge?.semanticRef).toBe(secondEdge?.semanticRef);
    expect(firstEdge?.semanticRef).toBe(statementIdentity(
      "urn:test:id:a",
      "urn:test:id:p",
      "urn:test:id:b",
    ));
    expect(statementIdentity("urn:test:a|b", "urn:test:p", "urn:test:c")).not.toBe(
      statementIdentity("urn:test:a", "urn:test:b|p", "urn:test:c"),
    );
  });

  it("構造違反を投影前のblocking diagnosticにする", () => {
    const scene = projectSemanticView(documentFor(invalidStructureSource), standardRdfRdfsCatalog);
    const codes = new Set(scene.diagnostics.map((diagnostic) => diagnostic.code));

    expect(scene.nodes).toEqual([]);
    expect([...codes]).toEqual(expect.arrayContaining([
      "container-cycle",
      "non-contiguous-ordinals",
      "alternative-too-few-members",
      "multiple-structural-types",
      "structural-resource-must-be-named",
      "orphan-ordinal-membership",
      "membership-parent-invalid",
    ]));
  });

  it("同順位rule競合を配列順で解決しない", () => {
    const conflictingRules: ProjectionCatalogV1["rules"] = [
      {
        ruleId: "ambiguous-a",
        priority: 500,
        match: { kind: "predicate", iri: "urn:test:ambiguous", entailment: "exact" },
        project: { operator: "direct-edge" },
        templateRef: standardRdfRdfsCatalog.defaults!.edgeTemplateRef,
      },
      {
        ruleId: "ambiguous-b",
        priority: 500,
        match: { kind: "predicate", iri: "urn:test:ambiguous", entailment: "exact" },
        project: { operator: "direct-edge" },
        templateRef: standardRdfRdfsCatalog.defaults!.edgeTemplateRef,
      },
    ];
    const source = "<urn:test:a> <urn:test:ambiguous> <urn:test:b> .";
    const catalogA = catalogWithRules(conflictingRules);
    const catalogB = catalogWithRules([...conflictingRules].reverse());

    const diagnosticsA = projectSemanticView(documentFor(source), catalogA).diagnostics;
    const diagnosticsB = projectSemanticView(documentFor(source), catalogB).diagnostics;
    expect(diagnosticsA).toEqual(diagnosticsB);
    expect(diagnosticsA).toContainEqual(expect.objectContaining({
      severity: "error",
      code: "ambiguous-projection-rule",
    }));
  });
});

function documentFor(source: string): IriographDocumentV1 {
  return {
    schemaVersion: "1",
    kind: "iriograph.document",
    documentId: "projection-test",
    semantic: {
      format: "text/turtle",
      baseIri: "urn:test:",
      authoringProfileRef: "urn:test:authoring-profile:1",
      source,
    },
    imports: [{ catalogRef: "urn:iriograph:catalog:rdf-rdfs@1" }],
    views: [{
      viewId: "main",
      kind: "node-link",
      profileRef: standardRdfRdfsCatalog.profileRef,
      layoutRef: standardRdfRdfsCatalog.defaults!.layoutRef,
      locale: "ja-JP",
      overlay: {},
    }],
  };
}

function catalogWithRules(rules: ProjectionCatalogV1["rules"]): ProjectionCatalogV1 {
  return {
    ...standardRdfRdfsCatalog,
    rules: [...standardRdfRdfsCatalog.rules, ...rules],
  };
}
