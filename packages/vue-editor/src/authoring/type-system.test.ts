import { describe, expect, it } from "vitest";

import type { IriographDocumentV1 } from "@iriograph/core";

import {
  deriveTypeSystem,
  typeSystemTreeRows,
  validateProposedTypeParents,
  type TypeSystemProfile,
} from "./type-system";
import { translateEditorMessage } from "../localization/editor-localization";

const NS = "urn:test:type-system:";

describe("type system index", () => {
  it("Turtleとprofile roleからlabel-first DAGを作り、複数親を同じexact identityへ束ねる", () => {
    const index = deriveTypeSystem(document(`
@prefix : <${NS}> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
:Work a rdfs:Class ; rdfs:label "仕事"@ja .
:Auditable a rdfs:Class ; rdfs:label "監査対象"@ja .
:Task a rdfs:Class ; rdfs:label "作業"@ja ;
  rdfs:subClassOf :Work, :Auditable .
:item a :Task ; rdfs:label "申請を確認"@ja .
`), {
      locale: "ja",
      authoringProfile: profile([
        { roleId: "unused", classIri: `${NS}Unused`, label: "未使用", description: "profileだけの型" },
      ]),
    });

    expect(index.presentation.types.map((item) => item.label)).toEqual([
      "監査対象", "作業", "仕事", "未使用",
    ]);
    const task = type(index, "作業");
    expect(task.parentTypeIds).toHaveLength(2);
    expect(task.parentTypeIds).toEqual(expect.arrayContaining([
      type(index, "仕事").typeId,
      type(index, "監査対象").typeId,
    ]));
    expect(index.presentation.types.filter((item) => item.typeId === task.typeId)).toHaveLength(1);
    expect(type(index, "未使用")).toMatchObject({ directCount: 0, inheritedCount: 0 });
    expect(JSON.stringify(index.presentation)).not.toMatch(/urn:|https?:\/\/|rdf:|rdfs:/u);
  });

  it("直接instanceと子孫由来instanceを重複なしで分け、resource側にも直接・継承を分ける", () => {
    const index = deriveTypeSystem(document(`
@prefix : <${NS}> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
:Root a rdfs:Class ; rdfs:label "根" .
:Left a rdfs:Class ; rdfs:label "左" ; rdfs:subClassOf :Root .
:Right a rdfs:Class ; rdfs:label "右" ; rdfs:subClassOf :Root .
:Leaf a rdfs:Class ; rdfs:label "葉" ; rdfs:subClassOf :Left, :Right .
:direct a :Root ; rdfs:label "直接" .
:leaf a :Leaf ; rdfs:label "子孫" .
:both a :Root, :Leaf ; rdfs:label "両方" .
`));
    const root = type(index, "根");
    const leaf = type(index, "葉");
    expect(root).toMatchObject({ directCount: 2, inheritedCount: 1 });
    expect(root.directResourceIds.map((id) => resource(index, id).label)).toEqual(["両方", "直接"]);
    expect(root.inheritedResourceIds.map((id) => resource(index, id).label)).toEqual(["子孫"]);
    const both = index.presentation.resources.find((item) => item.label === "両方")!;
    expect(both.directTypeIds).toEqual(expect.arrayContaining([root.typeId, leaf.typeId]));
    expect(both.inheritedTypeIds).not.toContain(root.typeId);
    expect(both.inheritedTypeIds).toEqual(expect.arrayContaining([
      type(index, "左").typeId,
      type(index, "右").typeId,
    ]));
  });

  it("RDF/RDFSの構造型を型一覧から除外し、domain classとscene node候補だけを保持する", () => {
    const index = deriveTypeSystem(document(`
@prefix : <${NS}> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
:Task a rdfs:Class ; rdfs:label "作業" .
:property a rdf:Property ; rdfs:label "述語" .
:bag a rdf:Bag ; rdfs:label "Bag" .
:sequence a rdf:Seq ; rdfs:label "Seq" .
:alternative a rdf:Alt ; rdfs:label "Alt" .
:task a :Task ; rdfs:label "対象" .
:group a rdf:Bag, :Task ; rdfs:label "型付きgroup" .
:untyped rdfs:label "未付与" .
`), { resourceIris: [`${NS}task`, `${NS}untyped`] });
    expect(index.presentation.types.map((item) => item.label)).toEqual(["作業"]);
    expect(index.presentation.resources.map((item) => item.label)).toEqual(["型付きgroup", "対象", "未付与"]);
    expect(index.presentation.resources.find((item) => item.label === "型付きgroup")?.assignmentEligible).toBe(false);
    expect(index.presentation.resources.find((item) => item.label === "対象")?.assignmentEligible).toBe(true);
    expect(index.presentation.resources.find((item) => item.label === "未付与")?.directTypeIds).toEqual([]);
    expect(JSON.stringify(index.presentation)).not.toMatch(/Property|Bag|Seq|Alt|rdf:/u);
  });

  it("図の単一tagをspecificity、profile優先度、最後にexact identityで決定する", () => {
    const profileOptions = profile([
      { roleId: "alpha", classIri: `${NS}Alpha`, label: "アルファ", displayPriority: 10 },
      { roleId: "beta", classIri: `${NS}Beta`, label: "ベータ", displayPriority: 20 },
      { roleId: "parent", classIri: `${NS}Parent`, label: "親", displayPriority: 0 },
      { roleId: "child", classIri: `${NS}Child`, label: "子", displayPriority: 100 },
    ]);
    const index = deriveTypeSystem(document(`
@prefix : <${NS}> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
:Child rdfs:subClassOf :Parent .
:specific a :Parent, :Child ; rdfs:label "詳細優先" .
:priority a :Alpha, :Beta ; rdfs:label "表示優先" .
`), { authoringProfile: profileOptions });
    const specific = index.presentation.resources.find((item) => item.label === "詳細優先")!;
    const priority = index.presentation.resources.find((item) => item.label === "表示優先")!;
    expect(specific.primaryDirectTypeId).toBe(type(index, "子").typeId);
    expect(priority.primaryDirectTypeId).toBe(type(index, "ベータ").typeId);

    const noPriority = deriveTypeSystem(document(`
@prefix : <${NS}> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
:same a :Zed, :Able ; rdfs:label "同順位" .
`), { authoringProfile: profile([
      { roleId: "z", classIri: `${NS}Zed`, label: "先に見えるlabel" },
      { roleId: "a", classIri: `${NS}Able`, label: "後に見えるlabel" },
    ]) });
    const selected = noPriority.presentation.resources[0]!.primaryDirectTypeId!;
    expect(noPriority.resolveTypeId(selected)).toBe(`${NS}Able`);
  });

  it("opaque UI identityはlabel、triple順、利用件数が変わっても安定する", () => {
    const first = deriveTypeSystem(document(`
@prefix : <${NS}> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
:Task a rdfs:Class ; rdfs:label "作業" .
:a a :Task ; rdfs:label "A" .
`));
    const second = deriveTypeSystem(document(`
@prefix : <${NS}> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
:b rdfs:label "B" ; a :Task .
:Task rdfs:label "仕事" ; a rdfs:Class .
`));
    expect(first.presentation.types[0]!.typeId).toBe(second.presentation.types[0]!.typeId);
    expect(first.presentation.resources[0]!.resourceId).not.toBe(second.presentation.resources[0]!.resourceId);
    expect(first.presentation.types[0]!.typeId).not.toContain("Task");
  });

  it("提案する複数parentの新規cycleだけをopaque pathで拒否しsource cycleも報告する", () => {
    const index = deriveTypeSystem(document(`
@prefix : <${NS}> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
:A rdfs:label "A" ; rdfs:subClassOf :B .
:B rdfs:label "B" .
:X rdfs:label "X" ; rdfs:subClassOf :Y .
:Y rdfs:label "Y" ; rdfs:subClassOf :X .
`));
    const a = type(index, "A");
    const b = type(index, "B");
    expect(validateProposedTypeParents(index.presentation, b.typeId, [a.typeId])).toMatchObject({
      valid: false,
      reason: "cycle",
      cycleTypeIds: [b.typeId, a.typeId, b.typeId],
    });
    expect(validateProposedTypeParents(index.presentation, a.typeId, [])).toEqual({ valid: true });
    expect(index.presentation.cycles).toHaveLength(1);
    expect(index.presentation.cycles[0]).toEqual(expect.arrayContaining([
      type(index, "X").typeId,
      type(index, "Y").typeId,
    ]));
    expect(new Set(typeSystemTreeRows(index.presentation).map((row) => row.typeId))).toEqual(
      new Set(index.presentation.types.map((item) => item.typeId)),
    );
  });

  it("create/edit/deleteを一atomic batchへ解決し、edit cycleはcommand化しない", () => {
    const index = deriveTypeSystem(document(`
@prefix : <${NS}> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
:Parent a rdfs:Class ; rdfs:label "親" .
:Child a rdfs:Class ; rdfs:label "子" ; rdfs:subClassOf :Parent .
`));
    const parent = type(index, "親");
    const child = type(index, "子");
    const created = index.compileAction({
      type: "create-class",
      label: "新しい型",
      description: "説明",
      parentTypeIds: [parent.typeId],
    }, { commandId: "type-create", createdTypeIri: `${NS}New`, defaultLocale: "ja" });
    expect(created).toMatchObject({
      ok: true,
      batch: {
        atomic: true,
        commands: [{
          type: "create-resource",
          resourceIri: `${NS}New`,
          initialStatements: expect.arrayContaining([
            expect.objectContaining({ predicateIri: expect.stringMatching(/#type$/u) }),
            expect.objectContaining({ predicateIri: expect.stringMatching(/#label$/u), object: expect.objectContaining({ value: "新しい型", language: "ja" }) }),
            expect.objectContaining({ predicateIri: expect.stringMatching(/#subClassOf$/u), object: { kind: "iri", iri: `${NS}Parent` } }),
          ]),
        }],
      },
    });
    const edited = index.compileAction({
      type: "edit-class",
      typeId: child.typeId,
      label: "子の変更",
      description: "",
      parentTypeIds: [],
    }, { commandId: "type-edit" });
    expect(edited).toMatchObject({ ok: true, batch: { atomic: true } });
    if (edited.ok) expect(edited.batch.commands).toHaveLength(3);

    expect(index.compileAction({
      type: "edit-class",
      typeId: parent.typeId,
      label: "親",
      parentTypeIds: [child.typeId],
    }, { commandId: "cycle" })).toMatchObject({ ok: false, code: "cycle" });
    expect(index.compileAction({
      type: "delete-class",
      typeId: child.typeId,
    }, { commandId: "delete" })).toMatchObject({
      ok: true,
      batch: { commands: [{ type: "delete-resource", resourceIri: `${NS}Child`, cascade: true }] },
    });
  });

  it("editは対象localeのlabel/commentだけを置換し、他言語とdatatype literalを保持する", () => {
    const index = deriveTypeSystem(document(`
@prefix : <${NS}> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
:Task a rdfs:Class ;
  rdfs:label "作業"@ja, "Task"@en, "neutral" ;
  rdfs:comment "日本語説明"@ja, "English description"@en, "typed"^^<urn:test:datatype> .
`), { locale: "ja" });
    const task = type(index, "作業");
    const result = index.compileAction({
      type: "edit-class",
      typeId: task.typeId,
      label: "工程",
      description: "",
      parentTypeIds: [],
    }, { commandId: "localized-edit", defaultLocale: "ja" });
    if (!result.ok) throw new Error(result.message);
    expect(result.batch.commands[0]).toMatchObject({
      values: expect.arrayContaining([
        { kind: "literal", value: "工程", language: "ja" },
        { kind: "literal", value: "Task", language: "en" },
        expect.objectContaining({ kind: "literal", value: "neutral" }),
      ]),
    });
    expect(result.batch.commands[1]).toMatchObject({
      values: expect.arrayContaining([
        { kind: "literal", value: "English description", language: "en" },
        { kind: "literal", value: "typed", datatypeIri: "urn:test:datatype" },
      ]),
    });
    expect(JSON.stringify(result.batch.commands[1])).not.toContain("日本語説明");
  });

  it("bulk add/removeは各resourceの未知を含む直接型を保持したcomplete replacementにする", () => {
    const index = deriveTypeSystem(document(`
@prefix : <${NS}> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
:Task a rdfs:Class ; rdfs:label "作業" .
:Audited a rdfs:Class ; rdfs:label "監査" .
:a a :Task ; rdfs:label "A" .
:b a :Task, :Audited ; rdfs:label "B" .
`));
    const audited = type(index, "監査");
    const resources = index.presentation.resources.map((item) => item.resourceId);
    const added = index.compileAction({
      type: "bulk-add-type",
      typeId: audited.typeId,
      resourceIds: resources,
    }, { commandId: "bulk-add" });
    expect(added).toMatchObject({ ok: true, batch: { atomic: true } });
    if (!added.ok) throw new Error("expected a batch");
    expect(added.batch.commands).toHaveLength(2);
    expect(added.batch.commands[1]).toMatchObject({
      type: "set-property",
      values: [{ kind: "iri", iri: `${NS}Audited` }, { kind: "iri", iri: `${NS}Task` }],
    });
    const removed = index.compileAction({
      type: "bulk-remove-type",
      typeId: audited.typeId,
      resourceIds: [resources[1]!],
    }, { commandId: "bulk-remove" });
    expect(removed).toMatchObject({
      ok: true,
      batch: { commands: [expect.objectContaining({ values: [{ kind: "iri", iri: `${NS}Task` }] })] },
    });
  });

  it("fallback labels and compile guidance are English by default and localizable", () => {
    const source = document(`
@prefix : <${NS}> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
:Unnamed a rdfs:Class .
:item a :Unnamed .
`);
    const english = deriveTypeSystem(source);
    expect(english.presentation.types[0]?.label).toMatch(/^Unnamed type /u);
    expect(english.presentation.resources[0]?.label).toMatch(/^Unnamed element /u);
    expect(english.compileAction({
      type: "create-class",
      label: "",
      parentTypeIds: [],
    }, { commandId: "invalid" })).toMatchObject({ message: "Enter a type name." });

    const ja = (key: Parameters<typeof translateEditorMessage>[1], parameters?: Parameters<typeof translateEditorMessage>[2]) => (
      translateEditorMessage("ja", key, parameters)
    );
    const japanese = deriveTypeSystem(source, {}, ja);
    expect(japanese.presentation.types[0]?.label).toMatch(/^名前未設定の型 /u);
    expect(japanese.compileAction({
      type: "create-class",
      label: "",
      parentTypeIds: [],
    }, { commandId: "invalid" }, ja)).toMatchObject({ message: "型の名前を入力してください。" });
  });
});

function document(source: string): IriographDocumentV1 {
  return {
    schemaVersion: "1",
    kind: "iriograph.document",
    documentId: "type-system",
    semantic: {
      format: "text/turtle",
      baseIri: NS,
      authoringProfileRef: "urn:test:profile",
      source,
    },
    views: [{
      viewId: "main",
      kind: "node-link",
      profileRef: "urn:test:view-profile",
      layoutRef: "urn:test:layout",
      overlay: {},
    }],
  };
}

function profile(nodeRoles: TypeSystemProfile["nodeRoles"]): TypeSystemProfile {
  return { nodeRoles };
}

function type(index: ReturnType<typeof deriveTypeSystem>, label: string) {
  return index.presentation.types.find((item) => item.label === label)!;
}

function resource(index: ReturnType<typeof deriveTypeSystem>, resourceId: string) {
  return index.presentation.resources.find((item) => item.resourceId === resourceId)!;
}
