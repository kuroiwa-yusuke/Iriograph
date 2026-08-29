import { Parser, Store } from "n3";
import { describe, expect, it } from "vitest";

import { applyAuthoringPreview, previewAuthoringCommands } from "./authoring";
import type { ResolvedAuthoringContext, ResourceIriAllocator } from "./authoring-model";
import {
  RDF_ALT,
  RDF_BAG,
  RDF_ORDINAL_PREFIX,
  RDF_SEQ,
  RDF_TYPE,
  RDFS_CLASS,
  RDFS_COMMENT,
  RDFS_LABEL,
  RDFS_MEMBER,
  XSD_STRING,
} from "./authoring-validation";
import { createStandardLayoutRegistry, STANDARD_LAYOUT_REFS } from "../layout/layout";
import type { IriographDocumentV1 } from "../document/model";
import { buildIriographView } from "../projection/scene";
import { standardRdfRdfsCatalog } from "../catalog/standard-catalog";
import {
  previewStructuredAuthoringBatch,
  previewStructuredAuthoringRequest,
  structuredAuthoringPresentation,
  structuredLocalizedTextPresentation,
  structuredMembershipPresentation,
  structuredNodeRoleSeedFromCanvasSelections,
  structuredPredicateHierarchyPresentation,
  type StructuredCanvasSelection,
} from "./structured-authoring";

const NS = "urn:test:structured:";
const REL = `${NS}rel`;
const DEPENDS = `${NS}depends`;
const TASK = `${NS}Task`;
const AUDITED = `${NS}Audited`;

describe("structured authoring facade", () => {
  it("IRIを出さずnode role/group kindとpredicate catalogを分離して返す", () => {
    const presentation = structuredAuthoringPresentation(contextFor("revision-1"));
    expect(presentation.profile).toEqual({
      allowUntypedNodes: false,
      nodeRoles: [{ roleId: "task", label: "タスク", description: "実行する作業", displayPriority: 7 }],
    });
    expect(presentation.groupKinds.map((item) => item.groupKind)).toEqual([
      "classification",
      "membership",
      "sequence",
      "alternative",
    ]);
    expect(presentation.predicateCatalog).toContainEqual(expect.objectContaining({
      predicateId: "rel",
      label: "次の工程",
      sentencePattern: "Aの次にBを行う",
    }));
    expect(JSON.stringify(presentation)).not.toContain(REL);
  });

  it("exact predicate hierarchyを既存ID規則でopaque化し全path・診断・policyだけを返す", () => {
    const parentA = `${NS}parentA`;
    const parentB = `${NS}parentB`;
    const root = `${NS}root`;
    const structural = `${NS}structural`;
    const unknown = `${NS}unknown`;
    const context: ResolvedAuthoringContext = {
      ...contextFor("revision-hierarchy"),
      terms: [
        ...contextFor("revision-hierarchy").terms,
        { iri: parentA, kind: "property", termId: "parent-a", label: "親A", objectKinds: ["iri"] },
        { iri: parentB, kind: "property", label: "親B", objectKinds: ["iri"] },
        { iri: root, kind: "property", termId: "root", label: "上位関係", objectKinds: ["iri"] },
        { iri: structural, kind: "property", termId: "structural", label: "構造", structural: true },
      ],
    };
    const fallbackId = structuredAuthoringPresentation(context).predicateCatalog
      .find((item) => item.label === "親B")!.predicateId;

    const presentation = structuredPredicateHierarchyPresentation(context, {
      predicates: [
        {
          predicateIri: REL,
          paths: [
            { iris: [REL, parentA, root], labels: ["次の工程", "親A", "上位関係"] },
            { iris: [REL, parentB, root], labels: ["次の工程", "親B", "上位関係"] },
          ],
          diagnostics: [
            { code: "hierarchy-cycle", labels: ["次の工程", "親A", "次の工程"] },
            { code: "hierarchy-path-budget-exceeded" },
          ],
        },
        { predicateIri: structural, paths: [] },
        { predicateIri: unknown, paths: [] },
      ],
      inferencePolicy: { query: "rdfs-subproperty", validation: "exact" },
    });

    expect(presentation.predicates).toHaveLength(1);
    expect(presentation.predicates[0]).toMatchObject({
      predicateId: "rel",
      label: "次の工程",
      truncated: true,
      paths: [
        { predicateIds: ["rel", "parent-a", "root"], labels: ["次の工程", "親A", "上位関係"] },
        { predicateIds: ["rel", fallbackId, "root"], labels: ["次の工程", "親B", "上位関係"] },
      ],
      diagnostics: expect.arrayContaining([
        expect.objectContaining({
          code: "hierarchy-cycle",
          labels: ["次の工程", "親A", "次の工程"],
          message: expect.stringContaining("循環"),
        }),
        expect.objectContaining({
          code: "hierarchy-path-budget-exceeded",
          message: expect.stringContaining("省略"),
        }),
      ]),
    });
    expect(presentation.queryExplanation).toContain("上位関係としても");
    expect(presentation.validationExplanation).toContain("選択した関係だけ");
    const serialized = JSON.stringify(presentation);
    for (const iri of [REL, parentA, parentB, root, structural, unknown]) {
      expect(serialized).not.toContain(iri);
    }
  });

  it("nodeはopaque IRI、label、profile許可roleを一括作成し未分類とgroup role混在を拒否する", async () => {
    const document = documentFor("<urn:test:structured:a> <http://www.w3.org/2000/01/rdf-schema#label> \"A\" .");
    const context = contextFor("revision-1");
    const created = await previewStructuredAuthoringRequest(document, {
      type: "create-element",
      requestId: "create-task",
      element: { kind: "node", label: "確認", nodeRoleIds: ["task"] },
    }, context, { allocator: allocatorFor([`${NS}opaque-1`]) });
    expect(created.valid).toBe(true);
    expect(created.preview?.patch.added).toEqual(expect.arrayContaining([
      expect.objectContaining({ predicateIri: RDF_TYPE, object: expect.objectContaining({ value: TASK }) }),
      expect.objectContaining({ predicateIri: RDFS_LABEL, object: expect.objectContaining({ value: "確認" }) }),
    ]));

    const untyped = await previewStructuredAuthoringRequest(document, {
      type: "create-element",
      requestId: "create-untyped",
      element: { kind: "node", label: "未分類", nodeRoleIds: [] },
    }, context);
    expect(untyped).toMatchObject({ valid: false });
    expect(untyped.diagnostics).toContainEqual(expect.objectContaining({ code: "node-role-required" }));

    const mixedContext: ResolvedAuthoringContext = {
      ...context,
      structuredAuthoring: {
        nodeRoles: [{ roleId: "bad", classIri: RDF_BAG, label: "不正" }],
      },
    };
    const mixed = await previewStructuredAuthoringRequest(document, {
      type: "create-element",
      requestId: "create-mixed",
      element: { kind: "node", label: "不正", nodeRoleIds: ["bad"] },
    }, mixedContext);
    expect(mixed.valid).toBe(false);
    expect(mixed.diagnostics).toContainEqual(expect.objectContaining({ code: "node-group-role-mixed" }));
  });

  it("opaque role IDで通常要素の種類だけを置換し未管理typeを保持する", async () => {
    const context = contextWithAuditedRole("revision-role-edit");
    const document = documentFor(`
      @prefix : <${NS}> .
      @prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
      @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
      :Task a rdfs:Class ; rdfs:label "Task" .
      :Audited a rdfs:Class ; rdfs:label "Audited" .
      :Legacy a rdfs:Class ; rdfs:label "Legacy" .
      :a a :Task, :Legacy ; rdfs:label "A" .
      :bag a rdf:Bag ; rdfs:label "Bag" .
    `);
    const node = await selectionFor(document, context, `${NS}a`);
    const changed = await previewStructuredAuthoringRequest(document, {
      type: "set-node-roles",
      requestId: "replace-node-role",
      node,
      nodeRoleIds: ["audited"],
    }, context);
    expect(changed.valid).toBe(true);
    const graph = graphFor(changed.preview!.candidateSource!);
    expect(graph.countQuads(`${NS}a`, RDF_TYPE, AUDITED, null)).toBe(1);
    expect(graph.countQuads(`${NS}a`, RDF_TYPE, TASK, null)).toBe(0);
    expect(graph.countQuads(`${NS}a`, RDF_TYPE, `${NS}Legacy`, null)).toBe(1);

    const unknown = await previewStructuredAuthoringRequest(document, {
      type: "set-node-roles",
      requestId: "unknown-node-role",
      node,
      nodeRoleIds: ["not-in-profile"],
    }, context);
    expect(unknown.valid).toBe(false);
    expect(unknown.diagnostics).toContainEqual(expect.objectContaining({
      code: "node-role-unresolved",
    }));

    const group = await selectionFor(document, context, `${NS}bag`);
    const mixed = await previewStructuredAuthoringRequest(document, {
      type: "set-node-roles",
      requestId: "group-as-node",
      node: group,
      nodeRoleIds: ["task"],
    }, context);
    expect(mixed.valid).toBe(false);
    expect(mixed.diagnostics).toContainEqual(expect.objectContaining({
      code: "node-role-target-invalid",
    }));
  });

  it("分類領域とその複数選択intersectionをopaque role IDだけへseedする", async () => {
    const context = contextWithAuditedRole("revision-role-seed");
    const document = documentFor(`
      @prefix : <${NS}> .
      @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
      :Task a rdfs:Class ; rdfs:label "Task" .
      :Audited a rdfs:Class ; rdfs:label "Audited" .
      :Other a rdfs:Class ; rdfs:label "Other" .
      :a a :Task, :Audited ; rdfs:label "A" .
    `);
    const taskRegion = await selectionFor(document, context, TASK);
    const auditedRegion = await selectionFor(document, context, AUDITED);
    const seeded = await structuredNodeRoleSeedFromCanvasSelections(
      document,
      [taskRegion, auditedRegion],
      context,
    );
    expect(seeded).toEqual({ valid: true, roleIds: ["task", "audited"], diagnostics: [] });
    expect(JSON.stringify(seeded)).not.toContain(TASK);
    expect(JSON.stringify(seeded)).not.toContain(AUDITED);

    const unavailableRegion = await selectionFor(document, context, `${NS}Other`);
    const unavailable = await structuredNodeRoleSeedFromCanvasSelections(
      document,
      [unavailableRegion],
      context,
    );
    expect(unavailable.valid).toBe(false);
    expect(unavailable.roleIds).toEqual([]);
    expect(unavailable.diagnostics).toContainEqual(expect.objectContaining({
      code: "classification-role-unavailable",
    }));
    expect(JSON.stringify(unavailable)).not.toContain(`${NS}Other`);
  });

  it("固定4種類のgroupをtype+labelで作り空のGroup Frameとして投影する", async () => {
    const expected = [
      ["classification", RDFS_CLASS, "classification"],
      ["membership", RDF_BAG, "membership"],
      ["sequence", RDF_SEQ, "sequence"],
      ["alternative", RDF_ALT, "alternative"],
    ] as const;
    for (const [groupKind, typeIri, frameKind] of expected) {
      const document = documentFor("<urn:test:structured:a> <http://www.w3.org/2000/01/rdf-schema#label> \"A\" .");
      const context = contextFor("revision-1");
      const iri = `${NS}empty-${groupKind}`;
      const result = await previewStructuredAuthoringRequest(document, {
        type: "create-element",
        requestId: `create-${groupKind}`,
        element: { kind: "group", label: `Empty ${groupKind}`, groupKind },
      }, context, { allocator: allocatorFor([iri]) });
      expect(result.valid, `${groupKind}: ${JSON.stringify(result.diagnostics)}`).toBe(true);
      expect(result.preview?.patch.added).toContainEqual(expect.objectContaining({
        predicateIri: RDF_TYPE,
        object: expect.objectContaining({ value: typeIri }),
      }));
      const applied = await applyAuthoringPreview(document, result.preview!, context, {
        confirmationId: result.preview!.confirmationId,
      });
      expect(applied.accepted).toBe(true);
      const scene = await buildIriographView(applied.document, "main", context.runtime, "incremental");
      const frame = [...scene.containers, ...(scene.regions ?? [])]
        .find((item) => item.semanticRef === iri)?.groupFrame;
      expect(frame?.kind).toBe(frameKind);
    }
  });

  it("一始点から共通/行別predicateの複数edgeをatomicに作りgroup化しない", async () => {
    const document = documentFor(baseSource());
    const context = contextFor("revision-1");
    const source = await selectionFor(document, context, `${NS}a`);
    const b = await selectionFor(document, context, `${NS}b`);
    const c = await selectionFor(document, context, `${NS}c`);
    const result = await previewStructuredAuthoringRequest(document, {
      type: "create-direct-relations",
      requestId: "connect-many",
      source,
      predicateId: "rel",
      targets: [
        { target: b },
        { target: c, predicateId: "depends" },
      ],
    }, context);
    expect(result.valid).toBe(true);
    expect(result.preview?.commands).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "connect-resources", predicateIri: REL }),
      expect.objectContaining({ type: "connect-resources", predicateIri: DEPENDS }),
    ]));
    expect(result.preview?.patch.added.some((item) => (
      item.predicateIri === RDF_TYPE && [RDF_BAG, RDF_SEQ, RDF_ALT, RDFS_CLASS].includes(item.object.value)
    ))).toBe(false);
  });

  it("複数edgeのrequest内重複または既存S/P/Oを検出すると全行をrejectする", async () => {
    const context = contextFor("revision-1");
    const document = documentFor(`${baseSource()}\n:a :rel :b .`);
    const source = await selectionFor(document, context, `${NS}a`);
    const b = await selectionFor(document, context, `${NS}b`);
    const c = await selectionFor(document, context, `${NS}c`);
    const duplicateRows = await previewStructuredAuthoringRequest(document, {
      type: "create-direct-relations",
      requestId: "duplicate-rows",
      source,
      predicateId: "depends",
      targets: [{ target: c }, { target: c }],
    }, context);
    expect(duplicateRows.valid).toBe(false);
    expect(duplicateRows.preview).toBeUndefined();
    expect(duplicateRows.diagnostics).toContainEqual(expect.objectContaining({
      code: "direct-relation-duplicate-request",
      message: expect.stringContaining("重複"),
      suggestedActions: [expect.objectContaining({
        actionId: "remove-duplicate-direct-relation",
      })],
    }));

    const existingRow = await previewStructuredAuthoringRequest(document, {
      type: "create-direct-relations",
      requestId: "one-existing-row",
      source,
      predicateId: "rel",
      targets: [{ target: b }, { target: c }],
    }, context);
    expect(existingRow.valid).toBe(false);
    expect(existingRow.preview).toBeUndefined();
    expect(existingRow.diagnostics).toContainEqual(expect.objectContaining({
      code: "direct-relation-already-exists",
      message: expect.stringContaining("すでに存在"),
      suggestedActions: [expect.objectContaining({
        actionId: "remove-existing-direct-relation",
      })],
    }));
    expect(document.semantic.source).not.toContain(":a :rel :c");
  });

  it("空groupだけ種類変更でき、member/ordinalを失う変更は修正action付きで拒否する", async () => {
    const document = documentFor(`${baseSource()}\n:${"empty"} a rdf:Bag ; rdfs:label \"Empty\" .`);
    const context = contextFor("revision-1");
    const empty = await selectionFor(document, context, `${NS}empty`);
    const changed = await previewStructuredAuthoringRequest(document, {
      type: "change-group-kind",
      requestId: "change-empty",
      group: empty,
      groupKind: "sequence",
    }, context);
    expect(changed.valid).toBe(true);
    expect(changed.preview?.patch).toMatchObject({
      added: [expect.objectContaining({ predicateIri: RDF_TYPE, object: expect.objectContaining({ value: RDF_SEQ }) })],
      removed: [expect.objectContaining({ predicateIri: RDF_TYPE, object: expect.objectContaining({ value: RDF_BAG }) })],
    });

    const bag = await selectionFor(document, context, `${NS}bag`);
    const rejected = await previewStructuredAuthoringRequest(document, {
      type: "change-group-kind",
      requestId: "change-populated",
      group: bag,
      groupKind: "alternative",
    }, context);
    expect(rejected.valid).toBe(false);
    expect(rejected.diagnostics).toContainEqual(expect.objectContaining({
      code: "group-kind-change-has-members",
      suggestedActions: [expect.objectContaining({ actionId: "clear-group-members-first" })],
    }));
  });

  it("既存memberと同名の複数新規nodeをIRI統合せず一candidateでBagへ追加する", async () => {
    const document = documentFor(baseSource());
    const context = contextFor("revision-1");
    const group = await selectionFor(document, context, `${NS}bag`);
    const existing = await selectionFor(document, context, `${NS}c`);
    const result = await previewStructuredAuthoringRequest(document, {
      type: "set-group-members",
      requestId: "mixed-members",
      group,
      members: [
        { kind: "existing", selection: existing },
        { kind: "new-node", clientId: "draft-1", label: "同名", nodeRoleIds: ["task"] },
        { kind: "new-node", clientId: "draft-2", label: "同名", nodeRoleIds: ["task"] },
      ],
    }, context, { allocator: allocatorFor([`${NS}new-1`, `${NS}new-2`]) });
    expect(result.valid).toBe(true);
    const graph = graphFor(result.preview!.candidateSource!);
    expect(graph.countQuads(`${NS}bag`, RDFS_MEMBER, `${NS}c`, null)).toBe(1);
    expect(graph.countQuads(`${NS}bag`, RDFS_MEMBER, `${NS}new-1`, null)).toBe(1);
    expect(graph.countQuads(`${NS}bag`, RDFS_MEMBER, `${NS}new-2`, null)).toBe(1);
    expect(graph.getSubjects(RDFS_LABEL, null, null).filter((term) => (
      term.value === `${NS}new-1` || term.value === `${NS}new-2`
    ))).toHaveLength(2);
  });

  it("通常groupのmemberをopaque Canvas identityでまとめて解除しSeq/Altは専用editorへ誘導する", async () => {
    const document = documentFor(baseSource());
    const context = contextFor("revision-remove-members");
    const bag = await selectionFor(document, context, `${NS}bag`);
    const seq = await selectionFor(document, context, `${NS}seq`);
    const bagMemberships = await structuredMembershipPresentation(document, bag, context);
    const bagMembershipId = bagMemberships.items.find((item) => item.relatedLabel === "A")!.membershipId;

    const removed = await previewStructuredAuthoringRequest(document, {
      type: "remove-group-members",
      requestId: "remove-bag-member",
      viewId: "main",
      membershipIds: [bagMembershipId],
    }, context);
    expect(removed.valid).toBe(true);
    expect(graphFor(removed.preview!.candidateSource!).countQuads(`${NS}bag`, RDFS_MEMBER, `${NS}a`, null)).toBe(0);

    const seqMemberships = await structuredMembershipPresentation(document, seq, context);
    const ordered = await previewStructuredAuthoringRequest(document, {
      type: "remove-group-members",
      requestId: "remove-sequence-member",
      viewId: "main",
      membershipIds: [seqMemberships.items[0]!.membershipId],
    }, context);
    expect(ordered.valid).toBe(false);
    expect(ordered.diagnostics).toContainEqual(expect.objectContaining({
      code: "ordered-group-member-removal-requires-editor",
      suggestedActions: [expect.objectContaining({ actionId: "open-ordered-group-editor" })],
    }));
  });

  it("同じgroup/memberの複数predicateから選んだexact membershipだけを解除する", async () => {
    const part = `${NS}part`;
    const document = documentFor(`
      @prefix : <${NS}> .
      @prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
      @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
      :part rdfs:subPropertyOf rdfs:member ; rdfs:label "構成要素" .
      :bag a rdf:Bag ; rdfs:label "Bag" ; rdfs:member :a ; :part :a, :b .
      :a rdfs:label "A" .
      :b rdfs:label "B" .
    `);
    const context = contextFor("revision-exact-membership");
    const bag = await selectionFor(document, context, `${NS}bag`);
    const presentation = await structuredMembershipPresentation(document, bag, context);
    const membershipsForA = presentation.items.filter((item) => item.relatedLabel === "A");
    expect(membershipsForA).toHaveLength(2);
    const previews = await Promise.all(membershipsForA.map((item, index) => previewStructuredAuthoringRequest(document, {
      type: "remove-group-members",
      requestId: `remove-exact-${index + 1}`,
      viewId: "main",
      membershipIds: [item.membershipId],
    }, context)));
    const partRemoval = previews.find((preview) => (
      preview.valid
      && graphFor(preview.preview!.candidateSource!).countQuads(`${NS}bag`, part, `${NS}a`, null) === 0
    ));
    expect(partRemoval).toBeDefined();
    const graph = graphFor(partRemoval!.preview!.candidateSource!);
    expect(graph.countQuads(`${NS}bag`, RDFS_MEMBER, `${NS}a`, null)).toBe(1);
    expect(graph.countQuads(`${NS}bag`, part, `${NS}b`, null)).toBe(1);
  });

  it("inline allocation/profile失敗はpreviewを作らず一件も部分適用しない", async () => {
    const document = documentFor(baseSource());
    const context = contextFor("revision-1");
    const group = await selectionFor(document, context, `${NS}bag`);
    const allocator: ResourceIriAllocator = {
      async allocate(request) {
        if (request.commandId.endsWith(":1")) {
          return {
            iri: `${NS}allocated-before-failure`,
            requestId: request.requestId,
            baseRevision: request.baseRevision,
            contextId: request.contextId,
          };
        }
        throw new Error("allocator unavailable");
      },
    };
    const result = await previewStructuredAuthoringRequest(document, {
      type: "set-group-members",
      requestId: "allocation-fails",
      group,
      members: [
        { kind: "new-node", clientId: "one", label: "One", nodeRoleIds: ["task"] },
        { kind: "new-node", clientId: "two", label: "Two", nodeRoleIds: ["task"] },
      ],
    }, context, { allocator });
    expect(result.valid).toBe(false);
    expect(result.preview).toBeUndefined();
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: "resource-allocation-failed" }));
    expect(document.semantic.source).not.toContain("allocated-before-failure");
  });

  it("Seqはfinal orderを保持し、Altは選択した出現位置を既定slotへ移して残り相対順を保つ", async () => {
    const document = documentFor(baseSource());
    const context = contextFor("revision-1");
    const seq = await selectionFor(document, context, `${NS}seq`);
    const a = await selectionFor(document, context, `${NS}a`);
    const b = await selectionFor(document, context, `${NS}b`);
    const c = await selectionFor(document, context, `${NS}c`);
    const ordered = await previewStructuredAuthoringRequest(document, {
      type: "set-group-members",
      requestId: "reorder-seq",
      group: seq,
      members: [
        { kind: "existing", selection: c },
        { kind: "existing", selection: a },
        { kind: "existing", selection: a },
      ],
    }, context);
    expect(ordered.valid).toBe(true);
    const graph = graphFor(ordered.preview!.candidateSource!);
    expect(graph.getObjects(`${NS}seq`, `${RDF_ORDINAL_PREFIX}1`, null)[0]?.value).toBe(`${NS}c`);
    expect(graph.getObjects(`${NS}seq`, `${RDF_ORDINAL_PREFIX}2`, null)[0]?.value).toBe(`${NS}a`);
    expect(graph.getObjects(`${NS}seq`, `${RDF_ORDINAL_PREFIX}3`, null)[0]?.value).toBe(`${NS}a`);

    const alt = await selectionFor(document, context, `${NS}alt`);
    const selectedDefault = await previewStructuredAuthoringRequest(document, {
      type: "set-group-members",
      requestId: "alt-default",
      group: alt,
      members: [
        { kind: "existing", selection: a },
        { kind: "existing", selection: c },
      ],
      defaultMemberIndex: 1,
    }, context);
    expect(selectedDefault.valid).toBe(true);
    const altGraph = graphFor(selectedDefault.preview!.candidateSource!);
    expect(altGraph.getObjects(`${NS}alt`, `${RDF_ORDINAL_PREFIX}1`, null)[0]?.value).toBe(`${NS}c`);
    expect(altGraph.getObjects(`${NS}alt`, `${RDF_ORDINAL_PREFIX}2`, null)[0]?.value).toBe(`${NS}a`);

    const duplicateOccurrence = await previewStructuredAuthoringRequest(document, {
      type: "set-group-members",
      requestId: "alt-duplicate-occurrence",
      group: alt,
      members: [
        { kind: "existing", selection: a },
        { kind: "existing", selection: c },
        { kind: "existing", selection: a },
        { kind: "existing", selection: b },
      ],
      defaultMemberIndex: 2,
    }, context);
    expect(duplicateOccurrence.valid).toBe(true);
    const duplicateGraph = graphFor(duplicateOccurrence.preview!.candidateSource!);
    expect([1, 2, 3, 4].map((ordinal) => duplicateGraph.getObjects(
      `${NS}alt`,
      `${RDF_ORDINAL_PREFIX}${ordinal}`,
      null,
    )[0]?.value)).toEqual([`${NS}a`, `${NS}a`, `${NS}c`, `${NS}b`]);
  });

  it("cascade deleteはordinalを再採番し不完全構造warningを返す", async () => {
    const document = documentFor(baseSource());
    const context = contextFor("revision-1");
    const b = await selectionFor(document, context, `${NS}b`);
    const preview = await previewStructuredAuthoringRequest(document, {
      type: "delete-element",
      requestId: "delete-b",
      target: b,
      cascade: true,
    }, context);
    expect(preview.valid).toBe(true);
    const graph = graphFor(preview.preview!.candidateSource!);
    expect(graph.getObjects(`${NS}seq`, `${RDF_ORDINAL_PREFIX}1`, null)[0]?.value).toBe(`${NS}a`);
    expect(graph.getObjects(`${NS}seq`, `${RDF_ORDINAL_PREFIX}2`, null)[0]?.value).toBe(`${NS}c`);
    expect(graph.countQuads(`${NS}seq`, `${RDF_ORDINAL_PREFIX}3`, null, null)).toBe(0);
    expect(preview.diagnostics).toContainEqual(expect.objectContaining({
      severity: "warning",
      code: "alternative-too-few-members",
    }));
  });

  it("opaque value identityで一翻訳だけを編集し他language/datatype値をatomicに保持する", async () => {
    const context = contextFor("revision-localized-edit");
    const document = documentFor(`
      @prefix : <${NS}> .
      @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
      @prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
      :a rdfs:label "日本語名"@ja, "English name"@en, "Plain name"^^xsd:string ;
        rdfs:comment "日本語の説明"@ja, "English comment"@en .
    `);
    const target = await selectionFor(document, context, `${NS}a`);
    const presentation = await structuredLocalizedTextPresentation(document, target, context);
    expect(presentation.valid).toBe(true);
    const labels = presentation.fields.find((field) => field.field === "label")!.values;
    expect(labels.map((value) => value.localeKind).sort()).toEqual([
      "default",
      "translation",
      "untagged",
    ]);
    expect(JSON.stringify(presentation)).not.toContain('"ja"');
    expect(JSON.stringify(presentation)).not.toContain('"en"');
    expect(JSON.stringify(presentation)).not.toContain("http://www.w3.org/2001/XMLSchema#string");
    const japanese = labels.find((value) => value.value === "日本語名")!;
    expect(japanese.valueId).toMatch(/^localized-[0-9a-f]{16}$/u);

    const updated = await previewStructuredAuthoringRequest(document, {
      type: "update-localized-text",
      requestId: "update-one-translation",
      target,
      field: "label",
      valueId: japanese.valueId,
      value: "更新した日本語名\n二行目",
    }, context);
    expect(updated.valid).toBe(true);
    const graph = graphFor(updated.preview!.candidateSource!);
    const labelValues = graph.getObjects(`${NS}a`, RDFS_LABEL, null);
    expect(labelValues).toEqual(expect.arrayContaining([
      expect.objectContaining({ value: "更新した日本語名\n二行目", language: "ja" }),
      expect.objectContaining({ value: "English name", language: "en" }),
      expect.objectContaining({ value: "Plain name", language: "" }),
    ]));
    expect(graph.getObjects(`${NS}a`, RDFS_COMMENT, null)).toEqual(expect.arrayContaining([
      expect.objectContaining({ value: "日本語の説明", language: "ja" }),
      expect.objectContaining({ value: "English comment", language: "en" }),
    ]));
  });

  it("default localeの別名・説明を追加でき、空文字更新と明示削除を区別する", async () => {
    const context = contextFor("revision-localized-lifecycle");
    const document = documentFor(`
      @prefix : <${NS}> .
      @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
      :a rdfs:label "主名称"@ja ; rdfs:comment "既存説明"@ja .
    `);
    const target = await selectionFor(document, context, `${NS}a`);
    const presentation = await structuredLocalizedTextPresentation(document, target, context);
    const commentId = presentation.fields.find((field) => field.field === "comment")!.values[0]!.valueId;

    const added = await previewStructuredAuthoringRequest(document, {
      type: "add-localized-text",
      requestId: "add-alias",
      target,
      field: "label",
      value: "別名\n二行目",
    }, context);
    expect(added.valid).toBe(true);
    expect(graphFor(added.preview!.candidateSource!).getObjects(`${NS}a`, RDFS_LABEL, null)).toEqual(expect.arrayContaining([
      expect.objectContaining({ value: "主名称", language: "ja" }),
      expect.objectContaining({ value: "別名\n二行目", language: "ja" }),
    ]));

    const emptied = await previewStructuredAuthoringRequest(document, {
      type: "update-localized-text",
      requestId: "empty-comment",
      target,
      field: "comment",
      valueId: commentId,
      value: "",
    }, context);
    expect(emptied.valid).toBe(true);
    expect(graphFor(emptied.preview!.candidateSource!).getObjects(`${NS}a`, RDFS_COMMENT, null)).toEqual([
      expect.objectContaining({ value: "", language: "ja" }),
    ]);

    const removed = await previewStructuredAuthoringRequest(document, {
      type: "remove-localized-text",
      requestId: "remove-comment",
      target,
      field: "comment",
      valueId: commentId,
    }, context);
    expect(removed.valid).toBe(true);
    expect(graphFor(removed.preview!.candidateSource!).getObjects(`${NS}a`, RDFS_COMMENT, null)).toEqual([]);

    const labelId = presentation.fields.find((field) => field.field === "label")!.values[0]!.valueId;
    const noName = await previewStructuredAuthoringRequest(document, {
      type: "remove-localized-text",
      requestId: "remove-last-label",
      target,
      field: "label",
      valueId: labelId,
    }, context);
    expect(noName.valid).toBe(false);
    expect(noName.diagnostics).toContainEqual(expect.objectContaining({ code: "localized-label-required" }));
  });

  it("詳細batchは中間cardinalityを評価せず最終graphだけをatomic検証する", async () => {
    const document = documentFor(`
      @prefix : <${NS}> .
      @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
      :a rdfs:label "旧名称"@ja .
    `);
    const context: ResolvedAuthoringContext = {
      ...contextFor("revision-localized-batch"),
      terms: [
        ...contextFor("revision-localized-batch").terms,
        {
          iri: RDFS_LABEL,
          kind: "property",
          termId: "label",
          label: "名前",
          objectKinds: ["literal"],
          maxCount: 1,
        },
      ],
    };
    const target = await selectionFor(document, context, `${NS}a`);
    const presentation = await structuredLocalizedTextPresentation(document, target, context);
    const oldLabelId = presentation.fields.find((field) => field.field === "label")!.values[0]!.valueId;

    const batch = await previewStructuredAuthoringBatch(document, [{
      type: "add-localized-text",
      requestId: "add-replacement",
      target,
      field: "label",
      value: "新名称",
    }, {
      type: "remove-localized-text",
      requestId: "remove-old",
      target,
      field: "label",
      valueId: oldLabelId,
    }], context);

    expect(batch.valid).toBe(true);
    expect(batch.diagnostics.some((item) => item.code === "property-max-count")).toBe(false);
    expect(graphFor(batch.preview!.candidateSource!).getObjects(`${NS}a`, RDFS_LABEL, null))
      .toEqual([expect.objectContaining({ value: "新名称", language: "ja" })]);
  });

  it("詳細batchは複数label許可時に別名を保持し同じopaque valueの重複変更をfail closedにする", async () => {
    const document = documentFor(`
      @prefix : <${NS}> .
      @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
      :a rdfs:label "主名称"@ja .
    `);
    const context = contextFor("revision-localized-batch-multi");
    const target = await selectionFor(document, context, `${NS}a`);
    const presentation = await structuredLocalizedTextPresentation(document, target, context);
    const labelId = presentation.fields.find((field) => field.field === "label")!.values[0]!.valueId;

    const aliases = await previewStructuredAuthoringBatch(document, [{
      type: "add-localized-text",
      requestId: "add-alias",
      target,
      field: "label",
      value: "別名",
    }], context);
    expect(aliases.valid).toBe(true);
    expect(graphFor(aliases.preview!.candidateSource!).getObjects(`${NS}a`, RDFS_LABEL, null))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ value: "主名称" }),
        expect.objectContaining({ value: "別名" }),
      ]));

    const duplicate = await previewStructuredAuthoringBatch(document, [{
      type: "remove-localized-text",
      requestId: "remove-once",
      target,
      field: "label",
      valueId: labelId,
    }, {
      type: "remove-localized-text",
      requestId: "remove-twice",
      target,
      field: "label",
      valueId: labelId,
    }], context);
    expect(duplicate.valid).toBe(false);
    expect(duplicate.preview).toBeUndefined();
    expect(duplicate.diagnostics).toContainEqual(expect.objectContaining({
      code: "localized-value-batch-duplicate",
    }));
  });

  it("詳細batchは同じopaque membershipの重複解除を部分適用せず拒否する", async () => {
    const document = documentFor(baseSource());
    const context = contextFor("revision-membership-batch-duplicate");
    const target = await selectionFor(document, context, `${NS}a`);
    const membership = await structuredMembershipPresentation(document, target, context);
    const membershipId = membership.items.find((item) => item.groupKind === "membership")!.membershipId;

    const duplicate = await previewStructuredAuthoringBatch(document, [{
      type: "remove-group-members",
      requestId: "remove-membership-once",
      viewId: "main",
      membershipIds: [membershipId],
    }, {
      type: "remove-group-members",
      requestId: "remove-membership-twice",
      viewId: "main",
      membershipIds: [membershipId],
    }], context);

    expect(duplicate.valid).toBe(false);
    expect(duplicate.preview).toBeUndefined();
    expect(duplicate.diagnostics).toContainEqual(expect.objectContaining({
      code: "group-member-removal-duplicate",
    }));
  });

  it("defaultLocale下でも明示xsd:stringは既存無言語literalを無言語のまま更新する", async () => {
    const document = documentFor(baseSource());
    const context = contextFor("revision-1");
    const plain = await previewAuthoringCommands(document, [{
      type: "set-property",
      commandId: "plain-label",
      subjectIri: `${NS}a`,
      predicateIri: RDFS_LABEL,
      values: [{ kind: "literal", value: "Plain updated", datatypeIri: XSD_STRING }],
    }], context);
    expect(plain.valid).toBe(true);
    const applied = await applyAuthoringPreview(document, plain, context, {
      confirmationId: plain.confirmationId,
    });
    expect(applied.accepted).toBe(true);
    expect(graphFor(applied.document.semantic.source).getObjects(`${NS}a`, RDFS_LABEL, null)[0]).toMatchObject({
      value: "Plain updated",
      language: "",
    });

    const tagged = await previewAuthoringCommands(document, [{
      type: "set-property",
      commandId: "tagged-label",
      subjectIri: `${NS}a`,
      predicateIri: RDFS_LABEL,
      values: [{ kind: "literal", value: "English", language: "en" }],
    }], context);
    expect(graphFor(tagged.candidateSource!).getObjects(`${NS}a`, RDFS_LABEL, null)[0]).toMatchObject({
      language: "en",
    });
  });
});

async function selectionFor(
  document: IriographDocumentV1,
  context: ResolvedAuthoringContext,
  semanticRef: string,
): Promise<StructuredCanvasSelection> {
  const scene = await buildIriographView(document, "main", context.runtime, "incremental");
  const element = [...scene.nodes, ...scene.containers, ...(scene.regions ?? [])]
    .find((candidate) => candidate.semanticRef === semanticRef);
  if (!element) throw new Error(`Fixture resource not projected: ${semanticRef}`);
  return { viewId: "main", elementId: element.elementId };
}

function contextFor(documentRevision: string): ResolvedAuthoringContext {
  return {
    contextId: "urn:test:structured-context:1",
    contextRevision: "context-1",
    documentRevision,
    authoringProfileRef: "urn:test:structured-profile:1",
    defaultLocale: "ja",
    runtime: {
      catalogsByProfile: new Map([[
        standardRdfRdfsCatalog.profileRef,
        { catalog: standardRdfRdfsCatalog },
      ]]),
      layouts: createStandardLayoutRegistry(),
    },
    resourcePolicy: { allowedMintNamespaces: [NS] },
    termPolicy: {
      existingUnknown: "preserve",
      humanUnknown: "reject",
      llmUnknown: "reject",
      humanMinting: "allow",
      llmMinting: "deny",
    },
    terms: [
      { iri: TASK, kind: "class", termId: "task-class", label: "タスク" },
      {
        iri: REL,
        kind: "property",
        termId: "rel",
        label: "次の工程",
        description: "工程の推移",
        category: "フロー",
        sentencePattern: "Aの次にBを行う",
        objectKinds: ["iri"],
      },
      {
        iri: DEPENDS,
        kind: "property",
        termId: "depends",
        label: "依存する",
        objectKinds: ["iri"],
      },
    ],
    structuredAuthoring: {
      allowUntypedNodes: false,
      allowClassificationGroups: true,
      nodeRoles: [{
        roleId: "task",
        classIri: TASK,
        label: "タスク",
        description: "実行する作業",
        displayPriority: 7,
      }],
    },
    capabilities: [],
  };
}

function contextWithAuditedRole(documentRevision: string): ResolvedAuthoringContext {
  const context = contextFor(documentRevision);
  return {
    ...context,
    terms: [
      ...context.terms,
      { iri: AUDITED, kind: "class", termId: "audited-class", label: "監査対象" },
    ],
    structuredAuthoring: {
      ...context.structuredAuthoring!,
      nodeRoles: [
        ...context.structuredAuthoring!.nodeRoles,
        { roleId: "audited", classIri: AUDITED, label: "監査対象" },
      ],
    },
  };
}

function documentFor(source: string): IriographDocumentV1 {
  return {
    schemaVersion: "1",
    kind: "iriograph.document",
    documentId: "structured-authoring-test",
    semantic: {
      format: "text/turtle",
      baseIri: NS,
      authoringProfileRef: "urn:test:structured-profile:1",
      source,
    },
    views: [{
      viewId: "main",
      kind: "region",
      profileRef: standardRdfRdfsCatalog.profileRef,
      layoutRef: STANDARD_LAYOUT_REFS.hierarchicalLr,
      overlay: {},
    }],
  };
}

function baseSource(): string {
  return `
@prefix : <${NS}> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
:bag a rdf:Bag ; rdfs:label "Bag" ; rdfs:member :a .
:seq a rdf:Seq ; rdfs:label "Sequence" ; rdf:_1 :a ; rdf:_2 :b ; rdf:_3 :c .
:alt a rdf:Alt ; rdfs:label "Alternatives" ; rdf:_1 :a ; rdf:_2 :b .
:a rdfs:label "A" .
:b rdfs:label "B" .
:c rdfs:label "C" .
`;
}

function allocatorFor(iris: readonly string[]): ResourceIriAllocator {
  let index = 0;
  return {
    allocate(request) {
      const iri = iris[index++];
      if (!iri) return undefined;
      return {
        iri,
        requestId: request.requestId,
        baseRevision: request.baseRevision,
        contextId: request.contextId,
      };
    },
  };
}

function graphFor(source: string): Store {
  return new Store(new Parser({ baseIRI: NS, format: "text/turtle" }).parse(source));
}
