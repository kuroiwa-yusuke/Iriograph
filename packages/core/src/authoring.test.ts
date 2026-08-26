import { Parser, Store } from "n3";
import { describe, expect, it, vi } from "vitest";

import {
  applyAuthoringSource,
  applyAuthoringPreview,
  authoringDocumentFingerprint,
  previewAuthoringCommands,
  provenanceToAuthoringCommand,
  seedAuthoringCommandFromProvenance,
} from "./authoring";
import type {
  AuthoringCommand,
  AuthoringPreview,
  ResolvedAuthoringContext,
  ResourceIriAllocator,
} from "./authoring-model";
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
  XSD_NAMESPACE,
} from "./authoring-validation";
import { statementIdentity, statementIdentityForNamedStatement } from "./identity";
import {
  createStandardLayoutRegistry,
  type LayoutAdapter,
  type LayoutRequest,
  LayoutAdapterRegistry,
  STANDARD_LAYOUT_REFS,
  StandardLightweightLayoutAdapter,
} from "./layout";
import type {
  IriographDocumentV1,
  ProjectionCatalogV1,
  SemanticEditCapability,
} from "./model";
import { buildIriographView, type ProjectionRuntimeContext } from "./scene";
import { standardRdfRdfsCatalog } from "./standard-catalog";

const NS = "urn:test:authoring:";
const XSD_INTEGER = `${XSD_NAMESPACE}integer`;
const RDFS_SUBCLASS_OF = "http://www.w3.org/2000/01/rdf-schema#subClassOf";
const RDFS_SUBPROPERTY_OF = "http://www.w3.org/2000/01/rdf-schema#subPropertyOf";

describe("structured semantic authoring", () => {
  it("全structured commandをcanonical datasetと全view reconciliationへatomicに適用する", async () => {
    const document = documentFor(baseSource);
    const context = contextFor("revision-1");
    const commands: AuthoringCommand[] = [
      {
        type: "create-resource",
        commandId: "create-d",
        resourceIri: `${NS}d`,
        initialStatements: [
          {
            subject: { kind: "created-resource" },
            predicateIri: RDF_TYPE,
            object: { kind: "iri", iri: `${NS}Task` },
          },
          {
            subject: { kind: "created-resource" },
            predicateIri: RDFS_LABEL,
            object: { kind: "literal", value: "D" },
          },
        ],
        initialPosition: { viewId: "main", x: 360, y: 400 },
      },
      {
        type: "set-property",
        commandId: "name-a",
        subjectIri: `${NS}a`,
        predicateIri: `${NS}name`,
        values: [{ kind: "literal", value: "Alpha", language: "en" }],
      },
      {
        type: "connect-resources",
        commandId: "connect-b-d",
        subjectIri: `${NS}b`,
        predicateIri: `${NS}rel`,
        objectIri: `${NS}d`,
      },
      {
        type: "apply-capability",
        commandId: "review-a-d",
        capabilityId: "review-link",
        bindings: {
          subject: { kind: "iri", iri: `${NS}a` },
          object: { kind: "iri", iri: `${NS}d` },
        },
      },
      {
        type: "set-membership",
        commandId: "lane-d",
        containerIri: `${NS}lane`,
        memberIri: `${NS}d`,
        enabled: true,
        containerTypeIri: RDF_BAG,
        predicateIri: RDFS_MEMBER,
      },
      {
        type: "set-sequence",
        commandId: "sequence",
        sequenceIri: `${NS}seq`,
        memberIris: [`${NS}a`, `${NS}d`, `${NS}a`],
        sequenceTypeIri: RDF_SEQ,
        ordinalPredicatePrefix: RDF_ORDINAL_PREFIX,
      },
      {
        type: "set-alternatives",
        commandId: "alternatives",
        alternativeIri: `${NS}alt`,
        memberIris: [`${NS}d`, `${NS}a`, `${NS}b`],
        defaultMemberIri: `${NS}d`,
        alternativeTypeIri: RDF_ALT,
        ordinalPredicatePrefix: RDF_ORDINAL_PREFIX,
        defaultOrdinal: 1,
      },
    ];

    const preview = await previewAuthoringCommands(document, commands, context);

    expect(preview.diagnostics).toEqual([]);
    expect(preview.valid).toBe(true);
    expect(preview.requiresConfirmation).toBe(true);
    expect(preview.confirmationId).toBe((
      await previewAuthoringCommands(document, commands, context)
    ).confirmationId);
    expect(preview.candidateSource).toContain(`@prefix : <${NS}> .`);
    expect(preview.patch.added.length).toBeGreaterThan(8);
    expect(preview.patch.removed.length).toBeGreaterThanOrEqual(4);

    const result = await applyAuthoringPreview(document, preview, context, {
      confirmationId: preview.confirmationId,
    });

    expect(result.accepted).toBe(true);
    expect(document).toEqual(documentFor(baseSource));
    const graph = graphFor(result.document.semantic.source);
    expect(graph.countQuads(`${NS}d`, RDF_TYPE, `${NS}Task`, null)).toBe(1);
    expect(graph.countQuads(`${NS}a`, `${NS}name`, null, null)).toBe(1);
    expect(graph.countQuads(`${NS}b`, `${NS}rel`, `${NS}d`, null)).toBe(1);
    expect(graph.countQuads(`${NS}a`, `${NS}reviewedBy`, `${NS}d`, null)).toBe(1);
    expect(graph.countQuads(`${NS}lane`, RDFS_MEMBER, `${NS}d`, null)).toBe(1);
    expect(ordinalObjects(graph, `${NS}seq`)).toEqual([
      `${NS}a`, `${NS}d`, `${NS}a`,
    ]);
    expect(ordinalObjects(graph, `${NS}alt`)).toEqual([
      `${NS}d`, `${NS}a`, `${NS}b`,
    ]);
    const mainD = Object.values(result.document.views[0]!.overlay)
      .find((entry) => entry.semanticRef === `${NS}d`)!;
    expect(mainD).toMatchObject({
      geometry: { x: 360, y: 400 },
      pinned: true,
      placement: "user",
    });
    expect(Object.values(result.document.views[1]!.overlay)
      .find((entry) => entry.semanticRef === `${NS}d`)).toMatchObject({
        pinned: false,
        placement: "generated",
      });
  });

  it("set-propertyを完全置換し、空valuesを削除として扱い、property制約を検証する", async () => {
    const document = documentFor(baseSource);
    const context = contextFor("revision-1");
    const replaced = await previewAuthoringCommands(document, [{
      type: "set-property",
      commandId: "replace-count",
      subjectIri: `${NS}a`,
      predicateIri: `${NS}count`,
      values: [{ kind: "literal", value: "2", datatypeIri: XSD_INTEGER }],
    }], context);
    expect(replaced.valid).toBe(true);
    expect(replaced.patch.removed).toHaveLength(1);
    expect(replaced.patch.added).toHaveLength(1);

    const removed = await previewAuthoringCommands(document, [{
      type: "set-property",
      commandId: "remove-count",
      subjectIri: `${NS}a`,
      predicateIri: `${NS}count`,
      values: [],
    }], context);
    expect(removed.valid).toBe(true);
    expect(removed.patch.added).toHaveLength(0);
    expect(removed.patch.removed).toHaveLength(1);

    const invalidDatatype = await previewAuthoringCommands(document, [{
      type: "set-property",
      commandId: "wrong-count",
      subjectIri: `${NS}a`,
      predicateIri: `${NS}count`,
      values: [{ kind: "literal", value: "two" }],
    }], context);
    expect(invalidDatatype.valid).toBe(false);
    expect(invalidDatatype.diagnostics).toContainEqual(expect.objectContaining({
      code: "property-datatype",
    }));

    const invalidLanguage = await previewAuthoringCommands(document, [{
      type: "set-property",
      commandId: "wrong-name",
      subjectIri: `${NS}a`,
      predicateIri: `${NS}name`,
      values: [{ kind: "literal", value: "名前", language: "ja" }],
    }], context);
    expect(invalidLanguage.valid).toBe(false);
    expect(invalidLanguage.diagnostics).toContainEqual(expect.objectContaining({
      code: "property-language",
    }));

    const invalidCardinality = await previewAuthoringCommands(document, [{
      type: "set-property",
      commandId: "too-many-names",
      subjectIri: `${NS}a`,
      predicateIri: `${NS}name`,
      values: [
        { kind: "literal", value: "Alpha", language: "en" },
        { kind: "literal", value: "A", language: "en" },
      ],
    }], context);
    expect(invalidCardinality.valid).toBe(false);
    expect(invalidCardinality.diagnostics).toContainEqual(expect.objectContaining({
      code: "property-max-count",
    }));

    const invalidMinimum = await previewAuthoringCommands(document, [{
      type: "set-property",
      commandId: "missing-name",
      subjectIri: `${NS}a`,
      predicateIri: `${NS}name`,
      values: [],
    }], context);
    expect(invalidMinimum.valid).toBe(false);
    expect(invalidMinimum.diagnostics).toContainEqual(expect.objectContaining({
      code: "property-min-count",
    }));

    const conflictingLiteral = await previewAuthoringCommands(document, [{
      type: "set-property",
      commandId: "conflicting-literal",
      subjectIri: `${NS}a`,
      predicateIri: `${NS}name`,
      values: [{
        kind: "literal",
        value: "Alpha",
        language: "en",
        datatypeIri: `${XSD_NAMESPACE}string`,
      }],
    }], context);
    expect(conflictingLiteral.valid).toBe(false);
    expect(conflictingLiteral.diagnostics).toContainEqual(expect.objectContaining({
      code: "literal-language-datatype-conflict",
    }));
  });

  it("unknown termを追加時だけwarnし、明示confirmationなしでは適用しない", async () => {
    const document = documentFor(baseSource);
    const context = contextFor("revision-1");
    const preserve = await previewAuthoringCommands(document, [{
      type: "set-property",
      commandId: "known-change",
      subjectIri: `${NS}a`,
      predicateIri: `${NS}count`,
      values: [{ kind: "literal", value: "3", datatypeIri: XSD_INTEGER }],
    }], context);
    expect(preserve.diagnostics.some((item) => item.code === "unknown-term-introduced")).toBe(false);

    const preview = await previewAuthoringCommands(document, [{
      type: "connect-resources",
      commandId: "unknown-edge",
      subjectIri: `${NS}a`,
      predicateIri: `${NS}newPredicate`,
      objectIri: `${NS}c`,
    }], context);
    expect(preview.valid).toBe(true);
    expect(preview.diagnostics).toContainEqual(expect.objectContaining({
      severity: "warning",
      code: "unknown-term-introduced",
      semanticRef: `${NS}newPredicate`,
    }));

    const rejected = await applyAuthoringPreview(document, preview, context, {
      confirmationId: "wrong-confirmation",
    });
    expect(rejected.accepted).toBe(false);
    expect(rejected.document).toEqual(document);
    expect(rejected.diagnostics).toContainEqual(expect.objectContaining({
      code: "authoring-confirmation-mismatch",
    }));

    const accepted = await applyAuthoringPreview(document, preview, context, {
      confirmationId: preview.confirmationId,
    });
    expect(accepted.accepted).toBe(true);

    const rejectContext = contextFor("revision-1", { humanUnknown: "reject" });
    const policyRejected = await previewAuthoringCommands(document, preview.commands, rejectContext);
    expect(policyRejected.valid).toBe(false);
    expect(policyRejected.diagnostics).toContainEqual(expect.objectContaining({
      severity: "error",
      code: "unknown-term-introduced",
    }));
  });

  it("structural predicateをproperty/direct edgeで迂回させず専用commandへ限定する", async () => {
    const document = documentFor(baseSource);
    const context = contextFor("revision-1");
    for (const command of [
      {
        type: "set-property",
        commandId: "bad-property",
        subjectIri: `${NS}lane`,
        predicateIri: RDFS_MEMBER,
        values: [{ kind: "iri", iri: `${NS}a` }],
      },
      {
        type: "connect-resources",
        commandId: "bad-edge",
        subjectIri: `${NS}seq`,
        predicateIri: `${RDF_ORDINAL_PREFIX}1`,
        objectIri: `${NS}a`,
      },
    ] as const) {
      const preview = await previewAuthoringCommands(document, [command], context);
      expect(preview.valid).toBe(false);
      expect(preview.diagnostics.some((item) => item.code.includes("structural-predicate"))).toBe(true);
    }
    const missingPredicate = await previewAuthoringCommands(document, [{
      type: "connect-resources",
      commandId: "missing-predicate",
      subjectIri: `${NS}a`,
      predicateIri: "",
      objectIri: `${NS}b`,
    }], context);
    expect(missingPredicate.valid).toBe(false);
    expect(missingPredicate.diagnostics).toContainEqual(expect.objectContaining({
      code: "edge-predicate-required",
    }));

    for (const predicateIri of [RDFS_MEMBER, `${RDF_ORDINAL_PREFIX}1`]) {
      const initialBypass = await previewAuthoringCommands(document, [{
        type: "create-resource",
        commandId: `initial-bypass-${predicateIri}`,
        resourceIri: `${NS}initial-bypass`,
        initialStatements: [{
          subject: { kind: "created-resource" },
          predicateIri,
          object: { kind: "iri", iri: `${NS}a` },
        }],
      }], context);
      expect(initialBypass.valid).toBe(false);
      expect(initialBypass.diagnostics).toContainEqual(expect.objectContaining({
        code: "structural-predicate-create-edit-denied",
      }));
    }

    const atomicCreatedMembership = await previewAuthoringCommands(document, [{
      type: "create-resource",
      commandId: "atomic-created-membership",
      resourceIri: `${NS}atomic-member`,
      initialStatements: [{
        subject: { kind: "created-resource" },
        predicateIri: RDFS_LABEL,
        object: { kind: "literal", value: "Atomic member" },
      }, {
        subject: { kind: "iri", iri: `${NS}lane` },
        predicateIri: RDFS_MEMBER,
        object: { kind: "created-resource" },
      }],
    }], context);
    expect(atomicCreatedMembership.valid).toBe(true);
    expect(atomicCreatedMembership.patch.added).toEqual(expect.arrayContaining([
      expect.objectContaining({
        subject: { termType: "NamedNode", value: `${NS}lane` },
        predicateIri: RDFS_MEMBER,
        object: { termType: "NamedNode", value: `${NS}atomic-member` },
      }),
    ]));

    for (const statement of [{
      subject: { kind: "iri" as const, iri: `${NS}a` },
      predicateIri: RDFS_MEMBER,
      object: { kind: "created-resource" as const },
    }, {
      subject: { kind: "iri" as const, iri: `${NS}seq` },
      predicateIri: `${RDF_ORDINAL_PREFIX}4`,
      object: { kind: "created-resource" as const },
    }]) {
      const rejected = await previewAuthoringCommands(document, [{
        type: "create-resource",
        commandId: `rejected-created-structure-${statement.predicateIri}`,
        resourceIri: `${NS}rejected-created-structure`,
        initialStatements: [{
          subject: { kind: "created-resource" },
          predicateIri: RDFS_LABEL,
          object: { kind: "literal", value: "Rejected" },
        }, statement],
      }], context);
      expect(rejected.valid).toBe(false);
      expect(rejected.diagnostics).toContainEqual(expect.objectContaining({
        code: "structural-predicate-create-edit-denied",
      }));
    }

    const createThenMembership = await previewAuthoringCommands(document, [{
      type: "create-resource",
      commandId: "create-member",
      resourceIri: `${NS}new-member`,
      initialStatements: [{
        subject: { kind: "created-resource" },
        predicateIri: RDFS_LABEL,
        object: { kind: "literal", value: "New member" },
      }],
    }, {
      type: "set-membership",
      commandId: "contain-created-member",
      containerIri: `${NS}lane`,
      memberIri: `${NS}new-member`,
      enabled: true,
      containerTypeIri: RDF_BAG,
      predicateIri: RDFS_MEMBER,
    }], context);
    expect(createThenMembership.valid).toBe(true);
  });

  it("resource allocatorのsync/async、cancel、failure、stale、全graph term collisionを検査する", async () => {
    const document = documentFor(baseSource);
    const command: AuthoringCommand = {
      type: "create-resource",
      commandId: "allocate",
      suggestedLocalName: "allocated",
      initialStatements: [{
        subject: { kind: "created-resource" },
        predicateIri: RDFS_LABEL,
        object: { kind: "literal", value: "Allocated" },
      }],
    };
    const syncAllocator: ResourceIriAllocator = {
      allocate: (request) => ({
        iri: `${NS}allocated`,
        requestId: request.requestId,
        baseRevision: request.baseRevision,
        contextId: request.contextId,
      }),
    };
    const allocated = await previewAuthoringCommands(
      document,
      [command],
      contextFor("revision-1"),
      { allocator: syncAllocator },
    );
    expect(allocated.valid).toBe(true);
    expect(allocated.commands[0]).toMatchObject({ resourceIri: `${NS}allocated` });

    const collision = await previewAuthoringCommands(
      document,
      [command],
      contextFor("revision-1"),
      { allocator: echoAllocator(`${NS}legacy`) },
    );
    expect(collision.valid).toBe(false);
    expect(collision.diagnostics).toContainEqual(expect.objectContaining({
      code: "resource-iri-collision",
    }));

    const stale = await previewAuthoringCommands(
      document,
      [command],
      contextFor("revision-1"),
      {
        allocator: {
          allocate: async (request) => ({
            iri: `${NS}stale`,
            requestId: request.requestId,
            baseRevision: "old-revision",
            contextId: request.contextId,
          }),
        },
      },
    );
    expect(stale.valid).toBe(false);
    expect(stale.diagnostics).toContainEqual(expect.objectContaining({
      code: "resource-allocation-stale",
    }));

    const cancelled = await previewAuthoringCommands(
      document,
      [command],
      contextFor("revision-1"),
      { allocator: { allocate: () => undefined } },
    );
    expect(cancelled.diagnostics).toContainEqual(expect.objectContaining({
      code: "resource-allocation-cancelled",
    }));

    const failed = await previewAuthoringCommands(
      document,
      [command],
      contextFor("revision-1"),
      { allocator: { allocate: () => Promise.reject(new Error("allocator offline")) } },
    );
    expect(failed.diagnostics).toContainEqual(expect.objectContaining({
      code: "resource-allocation-failed",
      message: "allocator offline",
    }));

    const invalidIri = await previewAuthoringCommands(
      document,
      [command],
      contextFor("revision-1"),
      {
        allocator: {
          allocate: (request) => ({
            iri: {} as unknown as string,
            requestId: request.requestId,
            baseRevision: request.baseRevision,
            contextId: request.contextId,
          }),
        },
      },
    );
    expect(invalidIri.valid).toBe(false);
    expect(invalidIri.diagnostics).toContainEqual(expect.objectContaining({
      code: "resource-namespace-denied",
    }));
  });

  it("optional capability binding省略時は参照statementだけをadd/remove双方でskipする", async () => {
    const document = documentFor(baseSource);
    const baseContext = contextFor("revision-1");
    const context: ResolvedAuthoringContext = {
      ...baseContext,
      terms: [
        ...baseContext.terms,
        { iri: `${NS}optionalNote`, kind: "property", objectKinds: ["literal"] },
      ],
      capabilities: [{
        capabilityId: "optional-review",
        parameters: [
          { name: "subject", objectKinds: ["iri"] },
          { name: "object", objectKinds: ["iri"] },
          { name: "optionalCount", objectKinds: ["literal"], required: false },
        ],
        graphPatch: {
          remove: [{
            subject: { kind: "binding", name: "subject" },
            predicate: { kind: "iri", iri: `${NS}count` },
            object: { kind: "binding", name: "optionalCount" },
          }],
          add: [{
            subject: { kind: "binding", name: "subject" },
            predicate: { kind: "iri", iri: `${NS}reviewedBy` },
            object: { kind: "binding", name: "object" },
          }, {
            subject: { kind: "binding", name: "subject" },
            predicate: { kind: "iri", iri: `${NS}optionalNote` },
            object: { kind: "binding", name: "optionalCount" },
          }],
        },
      }],
    };
    const bindings = {
      subject: { kind: "iri" as const, iri: `${NS}a` },
      object: { kind: "iri" as const, iri: `${NS}b` },
    };
    const omitted = await previewAuthoringCommands(document, [{
      type: "apply-capability",
      commandId: "optional-omitted",
      capabilityId: "optional-review",
      bindings,
    }], context);
    expect(omitted.valid).toBe(true);
    const omittedGraph = graphFor(omitted.candidateSource!);
    expect(omittedGraph.countQuads(`${NS}a`, `${NS}count`, null, null)).toBe(1);
    expect(omittedGraph.countQuads(`${NS}a`, `${NS}optionalNote`, null, null)).toBe(0);

    const supplied = await previewAuthoringCommands(document, [{
      type: "apply-capability",
      commandId: "optional-supplied",
      capabilityId: "optional-review",
      bindings: {
        ...bindings,
        optionalCount: {
          kind: "literal",
          value: "1",
          datatypeIri: XSD_INTEGER,
        },
      },
    }], context);
    expect(supplied.valid).toBe(true);
    const suppliedGraph = graphFor(supplied.candidateSource!);
    expect(suppliedGraph.countQuads(`${NS}a`, `${NS}count`, null, null)).toBe(0);
    expect(suppliedGraph.countQuads(`${NS}a`, `${NS}optionalNote`, null, null)).toBe(1);
  });

  it("resource削除を既定rejectし、explicit cascadeのexact impactとSeq/Alt再採番を適用する", async () => {
    const document = documentFor(baseSource);
    const context = contextFor("revision-1");
    const rejected = await previewAuthoringCommands(document, [{
      type: "delete-resource",
      commandId: "delete-b",
      resourceIri: `${NS}b`,
    }], context);
    expect(rejected.valid).toBe(false);
    expect(rejected.diagnostics).toContainEqual(expect.objectContaining({
      code: "resource-delete-referenced",
    }));

    const preview = await previewAuthoringCommands(document, [{
      type: "delete-resource",
      commandId: "delete-b-cascade",
      resourceIri: `${NS}b`,
      cascade: true,
    }], context);
    expect(preview.valid).toBe(true);
    expect(preview.patch.removed.some((change) => (
      change.predicateIri === `${NS}b`
    ))).toBe(true);
    expect(preview.patch.removed.filter((change) => (
      change.predicateIri.startsWith(RDF_ORDINAL_PREFIX)
    )).length).toBeGreaterThan(2);
    expect(preview.patch.added.some((change) => (
      change.predicateIri === `${RDF_ORDINAL_PREFIX}2`
      && change.object.termType === "NamedNode"
      && change.object.value === `${NS}a`
    ))).toBe(true);

    const applied = await applyAuthoringPreview(document, preview, context, {
      confirmationId: preview.confirmationId,
    });
    expect(applied.accepted).toBe(true);
    const graph = graphFor(applied.document.semantic.source);
    expect(graph.getQuads(null, null, null, null).some((value) => (
      [value.subject, value.predicate, value.object].some((term) => (
        term.termType === "NamedNode" && term.value === `${NS}b`
      ))
    ))).toBe(false);
    expect(ordinalObjects(graph, `${NS}seq`)).toEqual([`${NS}a`, `${NS}a`]);
    expect(ordinalObjects(graph, `${NS}alt`)).toEqual([`${NS}a`, `${NS}c`]);
  });

  it("cascade後のincomplete Seq/Altをwarningで保持しknown vocabulary削除だけrollbackする", async () => {
    const context = contextFor("revision-1");
    const tooSmallDocument = documentFor(`
@prefix ex: <${NS}> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
ex:seq a rdf:Seq ; rdf:_1 ex:a .
ex:alt a rdf:Alt ; rdf:_1 ex:a ; rdf:_2 ex:b .
ex:a rdfs:label "A" .
ex:b rdfs:label "B" .
`);
    for (const resourceIri of [`${NS}a`, `${NS}b`]) {
      const preview = await previewAuthoringCommands(tooSmallDocument, [{
        type: "delete-resource",
        commandId: `delete-${resourceIri}`,
        resourceIri,
        cascade: true,
      }], context);
      expect(preview.valid).toBe(true);
      expect(preview.diagnostics.some((item) => (
        item.severity === "warning"
        && (item.code === "sequence-empty" || item.code === "alternative-too-few-members")
      ))).toBe(true);
    }

    const protectedTerm = await previewAuthoringCommands(documentFor(baseSource), [{
      type: "delete-resource",
      commandId: "delete-term",
      resourceIri: `${NS}Task`,
      cascade: true,
    }], context);
    expect(protectedTerm.valid).toBe(false);
    expect(protectedTerm.diagnostics).toContainEqual(expect.objectContaining({
      code: "vocabulary-resource-delete-denied",
    }));
  });

  it("exact direct statementの多言語・複数行commentを標準reificationで置換・削除する", async () => {
    const source = `${baseSource}
[] a rdf:Statement ;
  rdf:subject ex:a ; rdf:predicate ex:rel ; rdf:object ex:b ;
  rdfs:comment "old English"@en .
[] a rdf:Statement ;
  rdf:subject ex:a ; rdf:predicate ex:rel ; rdf:object ex:b ;
  rdfs:comment "古い説明"@ja .
`;
    const document = documentFor(source);
    const statement = {
      subjectIri: `${NS}a`,
      predicateIri: `${NS}rel`,
      objectIri: `${NS}b`,
    };
    const statementRef = statementIdentityForNamedStatement(statement);
    const replace = await previewAuthoringCommands(document, [{
      type: "set-statement-comments",
      commandId: "replace-edge-comments",
      statementRef,
      ...statement,
      comments: [
        { kind: "literal", value: "承認後に\n通知する", language: "ja" },
        { kind: "literal", value: "Notify after approval", language: "en" },
      ],
    }], contextFor("revision-1"));

    expect(replace.valid).toBe(true);
    expect(replace.patch.removed.filter((value) => value.predicateIri === RDFS_COMMENT))
      .toHaveLength(2);
    const replaced = graphFor(replace.candidateSource!);
    expect(replaced.getQuads(null, RDFS_COMMENT, null, null).map((value) => ({
      value: value.object.value,
      language: value.object.termType === "Literal" ? value.object.language : "",
    }))).toEqual(expect.arrayContaining([
      { value: "承認後に\n通知する", language: "ja" },
      { value: "Notify after approval", language: "en" },
    ]));
    expect(replaced.countQuads(null, RDF_TYPE, "http://www.w3.org/1999/02/22-rdf-syntax-ns#Statement", null))
      .toBe(1);

    const applied = await applyAuthoringPreview(document, replace, contextFor("revision-1"), {
      confirmationId: replace.confirmationId,
    });
    const remove = await previewAuthoringCommands(applied.document, [{
      type: "set-statement-comments",
      commandId: "delete-edge-comments",
      statementRef,
      ...statement,
      comments: [],
    }], contextFor("revision-1"));
    expect(remove.valid).toBe(true);
    const removed = graphFor(remove.candidateSource!);
    expect(removed.countQuads(null, RDFS_COMMENT, null, null)).toBe(0);
    expect(removed.countQuads(null, RDF_TYPE, "http://www.w3.org/1999/02/22-rdf-syntax-ns#Statement", null))
      .toBe(0);
  });

  it("同一batchの先行connect後にN3非依存statementRefでcommentを付ける", async () => {
    const statement = {
      subjectIri: `${NS}b`,
      predicateIri: `${NS}rel`,
      objectIri: `${NS}c`,
    };
    const preview = await previewAuthoringCommands(documentFor(baseSource), [{
      type: "connect-resources",
      commandId: "connect-b-c",
      ...statement,
    }, {
      type: "set-statement-comments",
      commandId: "comment-b-c",
      statementRef: statementIdentityForNamedStatement(statement),
      ...statement,
      comments: [{ kind: "literal", value: "この接続だけの説明", language: "ja" }],
    }], contextFor("revision-1"));

    expect(preview.valid).toBe(true);
    const graph = graphFor(preview.candidateSource!);
    expect(graph.countQuads(`${NS}b`, `${NS}rel`, `${NS}c`, null)).toBe(1);
    expect(graph.getObjects(null, RDFS_COMMENT, null).map((value) => value.value))
      .toContain("この接続だけの説明");
  });

  it("statement/resourceのcascade削除で対応reifier closureも同じpatchから除去する", async () => {
    const reifiedSource = `${baseSource}
[] a rdf:Statement ;
  rdf:subject ex:a ; rdf:predicate ex:rel ; rdf:object ex:b ;
  rdfs:comment "edge comment"@en .
`;
    const statement = {
      subjectIri: `${NS}a`,
      predicateIri: `${NS}rel`,
      objectIri: `${NS}b`,
    };
    const removeStatement = await previewAuthoringCommands(documentFor(reifiedSource), [{
      type: "remove-statement",
      commandId: "remove-reified-edge",
      statementRef: statementIdentityForNamedStatement(statement),
      ...statement,
    }], contextFor("revision-1"));
    expect(removeStatement.valid).toBe(true);
    expect(graphFor(removeStatement.candidateSource!).countQuads(
      null,
      RDF_TYPE,
      "http://www.w3.org/1999/02/22-rdf-syntax-ns#Statement",
      null,
    )).toBe(0);

    const removeResource = await previewAuthoringCommands(documentFor(reifiedSource), [{
      type: "delete-resource",
      commandId: "remove-reified-target",
      resourceIri: `${NS}b`,
      cascade: true,
    }], contextFor("revision-1"));
    expect(removeResource.valid).toBe(true);
    expect(graphFor(removeResource.candidateSource!).countQuads(
      null,
      RDF_TYPE,
      "http://www.w3.org/1999/02/22-rdf-syntax-ns#Statement",
      null,
    )).toBe(0);
  });

  it("blank nodeを保持し、cascade impactではexact blank termとしてpreviewする", async () => {
    const document = documentFor(baseSource);
    const context = contextFor("revision-1");
    const untouched = await previewAuthoringCommands(document, [{
      type: "set-property",
      commandId: "change-count",
      subjectIri: `${NS}a`,
      predicateIri: `${NS}count`,
      values: [{ kind: "literal", value: "4", datatypeIri: XSD_INTEGER }],
    }], context);
    expect(untouched.valid).toBe(true);
    expect(untouched.patch.removed.some((change) => (
      change.subject.termType === "BlankNode" || change.object.termType === "BlankNode"
    ))).toBe(false);
    const applied = await applyAuthoringPreview(document, untouched, context, {
      confirmationId: untouched.confirmationId,
    });
    expect(applied.accepted).toBe(true);
    expect(graphFor(applied.document.semantic.source)
      .getQuads(null, `${NS}note`, null, null)).toHaveLength(1);

    const detached = await previewAuthoringCommands(document, [{
      type: "set-property",
      commandId: "detach-details",
      subjectIri: `${NS}a`,
      predicateIri: `${NS}details`,
      values: [],
    }], context);
    expect(detached.valid).toBe(true);
    expect(detached.patch.removed).toHaveLength(1);
    expect(detached.patch.removed[0]).toMatchObject({ predicateIri: `${NS}details` });
    expect(detached.patch.removed.some((change) => change.subject.termType === "BlankNode"))
      .toBe(false);
    const detachedApplied = await applyAuthoringPreview(document, detached, context, {
      confirmationId: detached.confirmationId,
    });
    expect(graphFor(detachedApplied.document.semantic.source)
      .getQuads(null, `${NS}note`, null, null)).toHaveLength(1);

    const cascade = await previewAuthoringCommands(document, [{
      type: "delete-resource",
      commandId: "delete-a",
      resourceIri: `${NS}a`,
      cascade: true,
    }], context);
    expect(cascade.valid).toBe(true);
    expect(cascade.patch.removed.some((change) => (
      change.subject.termType === "BlankNode" || change.object.termType === "BlankNode"
    ))).toBe(true);
  });

  it("previewをdocument revision/context/candidate/confirmationへbindしtamperとstaleを拒否する", async () => {
    const document = documentFor(baseSource);
    const context = contextFor("revision-1");
    const preview = await previewAuthoringCommands(document, [{
      type: "set-property",
      commandId: "change-count",
      subjectIri: `${NS}a`,
      predicateIri: `${NS}count`,
      values: [{ kind: "literal", value: "5", datatypeIri: XSD_INTEGER }],
    }], context);
    expect(preview.baseDocumentFingerprint).toBe(authoringDocumentFingerprint(document));

    const staleDocument = structuredClone(document);
    staleDocument.semantic.source += "\n";
    const stale = await applyAuthoringPreview(staleDocument, preview, context, {
      confirmationId: preview.confirmationId,
    });
    expect(stale.accepted).toBe(false);
    expect(stale.diagnostics).toContainEqual(expect.objectContaining({
      code: "authoring-preview-stale",
    }));

    const mismatched = await applyAuthoringPreview(document, preview, {
      ...context,
      contextRevision: "context-2",
    }, { confirmationId: preview.confirmationId });
    expect(mismatched.accepted).toBe(false);
    expect(mismatched.diagnostics).toContainEqual(expect.objectContaining({
      code: "authoring-context-mismatch",
    }));

    const tampered: AuthoringPreview = {
      ...preview,
      candidateSource: `${preview.candidateSource}\n# tampered`,
    };
    const tamperResult = await applyAuthoringPreview(document, tampered, context, {
      confirmationId: tampered.confirmationId,
    });
    expect(tamperResult.accepted).toBe(false);
    expect(tamperResult.diagnostics).toContainEqual(expect.objectContaining({
      code: "authoring-preview-tampered",
    }));
  });

  it("direct edge編集は既存geometryを固定して一度だけrouteしprepared applyを再利用する", async () => {
    const document = documentFor(baseSource);
    const calls: Array<{ layoutRef: string; mode: string; fixed: boolean }> = [];
    const adapters = ([
      [STANDARD_LAYOUT_REFS.hierarchicalLr, "LR"],
      [STANDARD_LAYOUT_REFS.hierarchicalTb, "TB"],
    ] as const).map(([layoutRef, direction]): LayoutAdapter => {
      const standard = new StandardLightweightLayoutAdapter(layoutRef, direction);
      return {
        layoutRef,
        async layout(request) {
          calls.push({
            layoutRef,
            mode: request.mode ?? "incremental",
            fixed: request.scene.elements.every((element) => (
              element.pinned && element.placement === "user"
            )),
          });
          return standard.layout(request);
        },
      };
    });
    const context: ResolvedAuthoringContext = {
      ...contextFor("revision-1"),
      runtime: {
        catalogsByProfile: new Map([[
          standardRdfRdfsCatalog.profileRef,
          { catalog: standardRdfRdfsCatalog },
        ]]),
        layouts: new LayoutAdapterRegistry(adapters),
      },
    };
    const before = Object.fromEntries(await Promise.all(document.views.map(async (view) => (
      [view.viewId, await buildIriographView(document, view.viewId, context.runtime)] as const
    ))));
    calls.length = 0;

    const preview = await previewAuthoringCommands(document, [{
      type: "connect-resources",
      commandId: "edge-only-connect",
      subjectIri: `${NS}b`,
      predicateIri: `${NS}rel`,
      objectIri: `${NS}a`,
    }], context);

    expect(preview.valid).toBe(true);
    expect(calls.map((call) => call.mode)).toEqual([
      "incremental", "route-only", "incremental", "route-only",
    ]);
    expect(calls.filter((call) => call.mode === "route-only").every((call) => call.fixed)).toBe(true);
    const callsAfterPreview = calls.length;
    const result = await applyAuthoringPreview(document, preview, context, {
      confirmationId: preview.confirmationId,
    });
    expect(result.accepted).toBe(true);
    expect(calls).toHaveLength(callsAfterPreview);
    expect(result.scenes).toBeDefined();
    for (const view of document.views) {
      const previousScene = before[view.viewId]!;
      const nextScene = result.scenes![view.viewId]!;
      const previousGeometry = [...previousScene.containers, ...(previousScene.regions ?? []), ...previousScene.nodes]
        .map((element) => [element.elementId, {
          geometry: element.geometry,
          pinned: element.pinned,
          placement: element.placement,
        }]);
      const nextGeometry = [...nextScene.containers, ...(nextScene.regions ?? []), ...nextScene.nodes]
        .map((element) => [element.elementId, {
          geometry: element.geometry,
          pinned: element.pinned,
          placement: element.placement,
        }]);
      expect(Object.fromEntries(nextGeometry)).toEqual(Object.fromEntries(previousGeometry));
    }

    const staleDocument = structuredClone(document);
    staleDocument.semantic.source += "\n";
    const stale = await applyAuthoringPreview(staleDocument, preview, context, {
      confirmationId: preview.confirmationId,
    });
    expect(stale.accepted).toBe(false);
    expect(stale.diagnostics).toContainEqual(expect.objectContaining({ code: "authoring-preview-stale" }));
    expect(calls).toHaveLength(callsAfterPreview);

    const clonedPreview = structuredClone(preview);
    const clonedApply = await applyAuthoringPreview(document, clonedPreview, context, {
      confirmationId: clonedPreview.confirmationId,
    });
    expect(clonedApply.accepted).toBe(true);
    expect(calls.slice(callsAfterPreview).map((call) => call.mode)).toEqual([
      "incremental", "route-only", "incremental", "route-only",
    ]);
  });

  it("rdf:type removalをdirect edge編集として扱わずroute-onlyへ誤分類しない", async () => {
    const document = documentFor(baseSource);
    const modes: string[] = [];
    const adapters = ([
      [STANDARD_LAYOUT_REFS.hierarchicalLr, "LR"],
      [STANDARD_LAYOUT_REFS.hierarchicalTb, "TB"],
    ] as const).map(([layoutRef, direction]): LayoutAdapter => {
      const standard = new StandardLightweightLayoutAdapter(layoutRef, direction);
      return {
        layoutRef,
        async layout(request) {
          modes.push(request.mode ?? "incremental");
          return standard.layout(request);
        },
      };
    });
    const source = `${baseSource}\n<${NS}a> <${RDF_TYPE}> <${NS}Task> .\n`;
    const context: ResolvedAuthoringContext = {
      ...contextFor("revision-1"),
      runtime: {
        catalogsByProfile: new Map([[
          standardRdfRdfsCatalog.profileRef,
          { catalog: standardRdfRdfsCatalog },
        ]]),
        layouts: new LayoutAdapterRegistry(adapters),
      },
    };
    const preview = await previewAuthoringCommands(documentFor(source), [{
      type: "remove-statement",
      commandId: "remove-type",
      statementRef: statementIdentityForNamedStatement({
        subjectIri: `${NS}a`,
        predicateIri: RDF_TYPE,
        objectIri: `${NS}Task`,
      }),
      subjectIri: `${NS}a`,
      predicateIri: RDF_TYPE,
      objectIri: `${NS}Task`,
    }], context);

    expect(preview.valid).toBe(true);
    expect(modes).not.toContain("route-only");
    expect(modes).toEqual(["incremental", "incremental", "incremental", "incremental"]);
  });

  it("multi-view failureとinvalid initial positionを元documentへrollbackする", async () => {
    const document = documentFor(baseSource);
    const brokenRuntime: ProjectionRuntimeContext = {
      catalogsByProfile: new Map([[
        standardRdfRdfsCatalog.profileRef,
        { catalog: standardRdfRdfsCatalog },
      ]]),
      layouts: new LayoutAdapterRegistry([
        new StandardLightweightLayoutAdapter(STANDARD_LAYOUT_REFS.hierarchicalLr, "LR"),
      ]),
    };
    const broken = await previewAuthoringCommands(document, [{
      type: "set-property",
      commandId: "change-count",
      subjectIri: `${NS}a`,
      predicateIri: `${NS}count`,
      values: [{ kind: "literal", value: "6", datatypeIri: XSD_INTEGER }],
    }], { ...contextFor("revision-1"), runtime: brokenRuntime });
    expect(broken.valid).toBe(false);
    expect(broken.diagnostics).toContainEqual(expect.objectContaining({
      code: "layout-adapter-unresolved",
    }));

    const invalidPosition = await previewAuthoringCommands(document, [{
      type: "create-resource",
      commandId: "positioned-sequence",
      resourceIri: `${NS}newSeq`,
      initialStatements: [{
        subject: { kind: "iri", iri: `${NS}a` },
        predicateIri: RDF_TYPE,
        object: { kind: "created-resource" },
      }],
      initialPosition: { viewId: "main", x: 10, y: 20 },
    }], contextFor("revision-1"));
    expect(invalidPosition.valid).toBe(false);
    expect(invalidPosition.diagnostics).toContainEqual(expect.objectContaining({
      code: "created-resource-not-projected",
    }));

    const negativePosition = await previewAuthoringCommands(document, [{
      type: "create-resource",
      commandId: "negative-position",
      resourceIri: `${NS}negative`,
      initialStatements: [{
        subject: { kind: "created-resource" },
        predicateIri: RDFS_LABEL,
        object: { kind: "literal", value: "Negative" },
      }],
      initialPosition: { viewId: "main", x: -1, y: 20 },
    }], contextFor("revision-1"));
    expect(negativePosition.valid).toBe(false);
    expect(negativePosition.diagnostics).toContainEqual(expect.objectContaining({
      code: "initial-position-out-of-bounds",
    }));
    const beyondScene = await previewAuthoringCommands(document, [{
      type: "create-resource",
      commandId: "beyond-scene",
      resourceIri: `${NS}beyond`,
      initialStatements: [{
        subject: { kind: "created-resource" },
        predicateIri: RDFS_LABEL,
        object: { kind: "literal", value: "Beyond" },
      }],
      initialPosition: { viewId: "main", x: 100_000, y: 100_000 },
    }], contextFor("revision-1"));
    expect(beyondScene.diagnostics).toContainEqual(expect.objectContaining({
      code: "initial-position-out-of-bounds",
    }));
    const hostBounded = await previewAuthoringCommands(document, [{
      type: "create-resource",
      commandId: "host-bounded",
      resourceIri: `${NS}hostBounded`,
      initialStatements: [{
        subject: { kind: "created-resource" },
        predicateIri: RDFS_LABEL,
        object: { kind: "literal", value: "Host bounded" },
      }],
      initialPosition: { viewId: "main", x: 300, y: 300 },
    }], {
      ...contextFor("revision-1"),
      resourcePolicy: {
        allowedMintNamespaces: [NS],
        maxInitialPositionExtent: 360,
      },
    });
    expect(hostBounded.diagnostics).toContainEqual(expect.objectContaining({
      code: "initial-position-out-of-bounds",
      message: expect.stringContaining("360"),
    }));
    expect(document).toEqual(documentFor(baseSource));
  });

  it("preview済みcandidateはapplyで外部layoutを再実行せず同一結果を確定する", async () => {
    const document = documentFor(baseSource);
    const stableLr = new StandardLightweightLayoutAdapter(
      STANDARD_LAYOUT_REFS.hierarchicalLr,
      "LR",
    );
    const stableTb = new StandardLightweightLayoutAdapter(
      STANDARD_LAYOUT_REFS.hierarchicalTb,
      "TB",
    );
    let tbCalls = 0;
    const failingTb: LayoutAdapter = {
      layoutRef: STANDARD_LAYOUT_REFS.hierarchicalTb,
      async layout(request) {
        tbCalls += 1;
        if (tbCalls <= 2) return stableTb.layout(request);
        return {
          layoutRef: request.layoutRef,
          geometries: {},
          routes: {},
          width: 0,
          height: 0,
          diagnostics: [{
            severity: "error",
            code: "layout-became-unavailable",
            message: "layout failed after preview",
          }],
        };
      },
    };
    const context = {
      ...contextFor("revision-1"),
      runtime: {
        catalogsByProfile: new Map([[
          standardRdfRdfsCatalog.profileRef,
          { catalog: standardRdfRdfsCatalog },
        ]]),
        layouts: new LayoutAdapterRegistry([stableLr, failingTb]),
      },
    };
    const preview = await previewAuthoringCommands(document, [{
      type: "set-property",
      commandId: "change-count-after-preview",
      subjectIri: `${NS}a`,
      predicateIri: `${NS}count`,
      values: [{ kind: "literal", value: "7", datatypeIri: XSD_INTEGER }],
    }], context);
    expect(preview.valid).toBe(true);

    const result = await applyAuthoringPreview(document, preview, context, {
      confirmationId: preview.confirmationId,
    });
    expect(result.accepted).toBe(true);
    expect(tbCalls).toBe(2);
    expect(result.document).not.toEqual(document);
    expect(result.diagnostics).not.toContainEqual(expect.objectContaining({
      code: "layout-became-unavailable",
    }));
  });

  it("term minting policyとcreate-resourceのinitial triple/namespace/collisionを検証する", async () => {
    const document = documentFor(baseSource);
    const context = contextFor("revision-1");
    const minted = await previewAuthoringCommands(document, [{
      type: "create-resource",
      commandId: "mint-class",
      resourceIri: `${NS}NewClass`,
      initialStatements: [{
        subject: { kind: "created-resource" },
        predicateIri: RDF_TYPE,
        object: { kind: "iri", iri: RDFS_CLASS },
      }],
    }], context);
    expect(minted.valid).toBe(true);
    expect(minted.diagnostics).toContainEqual(expect.objectContaining({
      code: "term-minting-warning",
    }));

    for (const [command, code] of [
      [{
        type: "create-resource",
        commandId: "empty",
        resourceIri: `${NS}empty`,
        initialStatements: [],
      }, "create-resource-initial-statement-required"],
      [{
        type: "create-resource",
        commandId: "outside",
        resourceIri: "urn:outside:new",
        initialStatements: [{
          subject: { kind: "created-resource" },
          predicateIri: RDFS_LABEL,
          object: { kind: "literal", value: "Outside" },
        }],
      }, "resource-namespace-denied"],
      [{
        type: "create-resource",
        commandId: "collision",
        resourceIri: `${NS}legacy`,
        initialStatements: [{
          subject: { kind: "created-resource" },
          predicateIri: RDFS_LABEL,
          object: { kind: "literal", value: "Collision" },
        }],
      }, "resource-iri-collision"],
    ] as const) {
      const preview = await previewAuthoringCommands(document, [command as AuthoringCommand], context);
      expect(preview.valid).toBe(false);
      expect(preview.diagnostics).toContainEqual(expect.objectContaining({ code }));
    }
  });

  it("provenance capabilityだけをcommandへ変換し、欠落時やparameter不足では推測しない", () => {
    const direct: SemanticEditCapability = {
      command: "remove-statement",
      statementRef: statementIdentity(`${NS}a`, `${NS}rel`, `${NS}b`),
      subject: `${NS}a`,
      predicate: `${NS}rel`,
      object: `${NS}b`,
    };
    expect(provenanceToAuthoringCommand(direct, { commandId: "remove" })).toMatchObject({
      type: "remove-statement",
      predicateIri: `${NS}rel`,
    });
    expect(provenanceToAuthoringCommand({
      command: "set-membership",
      container: `${NS}lane`,
      member: `${NS}a`,
      containerTypeIri: RDF_BAG,
      predicate: RDFS_MEMBER,
    }, { commandId: "membership", enabled: false })).toMatchObject({
      type: "set-membership",
      enabled: false,
    });
    expect(provenanceToAuthoringCommand({
      command: "set-sequence",
      sequence: `${NS}seq`,
      sequenceTypeIri: RDF_SEQ,
      ordinalPredicatePrefix: RDF_ORDINAL_PREFIX,
    }, { commandId: "sequence", memberIris: [`${NS}b`, `${NS}a`] })).toMatchObject({
      type: "set-sequence",
    });
    expect(provenanceToAuthoringCommand({
      command: "set-alternatives",
      alternative: `${NS}alt`,
      alternativeTypeIri: RDF_ALT,
      ordinalPredicatePrefix: RDF_ORDINAL_PREFIX,
      defaultOrdinal: 1,
    }, {
      commandId: "alternative",
      memberIris: [`${NS}a`, `${NS}c`],
      defaultMemberIri: `${NS}c`,
    })).toMatchObject({ type: "set-alternatives" });
    expect(provenanceToAuthoringCommand(undefined, { commandId: "none" })).toBeUndefined();
    expect(provenanceToAuthoringCommand({
      command: "set-sequence",
      sequence: `${NS}seq`,
      sequenceTypeIri: RDF_SEQ,
      ordinalPredicatePrefix: RDF_ORDINAL_PREFIX,
    }, { commandId: "missing" })).toBeUndefined();
  });

  it("provenance remove-statementをstatement identityで再検証する", async () => {
    const document = documentFor(baseSource);
    const context = contextFor("revision-1");
    const valid = await previewAuthoringCommands(document, [{
      type: "remove-statement",
      commandId: "remove-edge",
      statementRef: statementIdentity(`${NS}a`, `${NS}rel`, `${NS}b`),
      subjectIri: `${NS}a`,
      predicateIri: `${NS}rel`,
      objectIri: `${NS}b`,
    }], context);
    expect(valid.valid).toBe(true);
    const stale = await previewAuthoringCommands(document, [{
      type: "remove-statement",
      commandId: "remove-edge-stale",
      statementRef: "urn:wrong",
      subjectIri: `${NS}a`,
      predicateIri: `${NS}rel`,
      objectIri: `${NS}b`,
    }], context);
    expect(stale.valid).toBe(false);
    expect(stale.diagnostics).toContainEqual(expect.objectContaining({
      code: "provenance-statement-mismatch",
    }));
  });

  it("property cardinalityをbatch最終候補だけで検証し、削除済subjectを除外する", async () => {
    const document = documentFor(baseSource);
    const context = contextFor("revision-1");
    const restored = await previewAuthoringCommands(document, [{
      type: "set-property",
      commandId: "temporary-overflow",
      subjectIri: `${NS}a`,
      predicateIri: `${NS}name`,
      values: [
        { kind: "literal", value: "one", language: "en" },
        { kind: "literal", value: "two", language: "en" },
      ],
    }, {
      type: "set-property",
      commandId: "final-valid",
      subjectIri: `${NS}a`,
      predicateIri: `${NS}name`,
      values: [{ kind: "literal", value: "one", language: "en" }],
    }], context);
    expect(restored.valid).toBe(true);
    expect(restored.diagnostics.some((item) => item.code === "property-max-count")).toBe(false);

    const deleted = await previewAuthoringCommands(document, [{
      type: "set-property",
      commandId: "temporarily-missing",
      subjectIri: `${NS}a`,
      predicateIri: `${NS}name`,
      values: [],
    }, {
      type: "delete-resource",
      commandId: "delete-a",
      resourceIri: `${NS}a`,
      cascade: true,
    }], context);
    expect(deleted.diagnostics.some((item) => item.code === "property-min-count")).toBe(false);

    const explicitNoop = await previewAuthoringCommands(document, [{
      type: "set-property",
      commandId: "touch-missing-name",
      subjectIri: `${NS}b`,
      predicateIri: `${NS}name`,
      values: [],
    }], context);
    expect(explicitNoop.diagnostics).toContainEqual(expect.objectContaining({
      code: "property-min-count",
    }));
  });

  it("known termのpredicate/type-object roleをfinal diffで検証する", async () => {
    const document = documentFor(baseSource);
    const context = contextFor("revision-1");
    for (const source of [
      `${baseSource}\nex:a ex:Task ex:b .`,
      `${baseSource}\nex:a a ex:rel .`,
    ]) {
      const result = await applyAuthoringSource(document, source, context, { actor: "human" });
      expect(result.accepted).toBe(false);
      expect(result.diagnostics).toContainEqual(expect.objectContaining({
        code: "authoring-term-role-invalid",
      }));
    }

    const finalOnly = await previewAuthoringCommands(document, [{
      type: "set-property",
      commandId: "temporary-role",
      subjectIri: `${NS}a`,
      predicateIri: `${NS}Task`,
      values: [{ kind: "iri", iri: `${NS}b` }],
    }, {
      type: "set-property",
      commandId: "remove-temporary-role",
      subjectIri: `${NS}a`,
      predicateIri: `${NS}Task`,
      values: [],
    }, {
      type: "set-property",
      commandId: "real-change",
      subjectIri: `${NS}a`,
      predicateIri: `${NS}count`,
      values: [{ kind: "literal", value: "9", datatypeIri: XSD_INTEGER }],
    }], context);
    expect(finalOnly.valid).toBe(true);
    expect(finalOnly.diagnostics.some((item) => item.code === "authoring-term-role-invalid")).toBe(false);

    const blankObject = `${baseSource}\nex:b ex:rel [ rdfs:label "Blank" ] .`;
    for (const actor of ["human", "llm"] as const) {
      const result = await applyAuthoringSource(document, blankObject, context, { actor });
      expect(result.accepted).toBe(false);
      expect(result.diagnostics).toContainEqual(expect.objectContaining({
        code: "property-object-kind",
        message: expect.stringContaining("blank-node"),
      }));
    }
  });

  it("human/llm direct Turtleへactor policyを適用し、human原文と全viewを保持する", async () => {
    const document = documentFor(baseSource);
    const context = contextFor("revision-1");
    const exact = `${baseSource}\n# keep this formatting\nex:new-resource   rdfs:label   "New" .\n`;
    const accepted = await applyAuthoringSource(document, exact, context, { actor: "human" });
    expect(accepted.accepted).toBe(true);
    expect(accepted.document.semantic.source).toBe(exact);
    expect(accepted.document.views).toHaveLength(2);

    const canonicalLlm = await applyAuthoringSource(document, exact, context, { actor: "llm" });
    expect(canonicalLlm.diagnostics).toEqual([]);
    expect(canonicalLlm.accepted).toBe(true);
    expect(canonicalLlm.document.semantic.source).not.toBe(exact);
    expect(canonicalLlm.document.semantic.source).toContain(":new-resource rdfs:label");

    const unknown = `${baseSource}\nex:a ex:newPredicate ex:b .`;
    const human = await applyAuthoringSource(document, unknown, context, { actor: "human" });
    expect(human.accepted).toBe(true);
    expect(human.diagnostics).toContainEqual(expect.objectContaining({
      severity: "warning",
      code: "unknown-term-introduced",
    }));
    const llm = await applyAuthoringSource(document, unknown, context, { actor: "llm" });
    expect(llm.accepted).toBe(false);
    expect(llm.diagnostics).toContainEqual(expect.objectContaining({
      severity: "error",
      code: "unknown-term-introduced",
    }));

    const minted = `${baseSource}\nex:Minted a rdfs:Class .`;
    expect((await applyAuthoringSource(document, minted, context, { actor: "human" })).accepted)
      .toBe(true);
    const llmMinted = await applyAuthoringSource(document, minted, context, { actor: "llm" });
    expect(llmMinted.diagnostics).toContainEqual(expect.objectContaining({
      code: "term-minting-denied",
    }));

    const denied = await applyAuthoringSource(
      document,
      `${baseSource}\n<urn:outside:resource> rdfs:label "Outside" .`,
      context,
      { actor: "human" },
    );
    expect(denied.diagnostics).toContainEqual(expect.objectContaining({
      code: "resource-namespace-denied",
    }));

    for (const invalidOptions of [undefined, {}, { actor: "agent" }]) {
      const invalidActor = await applyAuthoringSource(
        document,
        baseSource,
        context,
        invalidOptions as never,
      );
      expect(invalidActor.accepted).toBe(false);
      expect(invalidActor.diagnostics).toContainEqual(expect.objectContaining({
        code: "authoring-actor-invalid",
      }));
    }
  });

  it("standard term制約強化とprivate-use languageを許可し、不正runtime contextを拒否する", async () => {
    const document = documentFor(baseSource);
    const context = contextFor("revision-1");
    const constrained: ResolvedAuthoringContext = {
      ...context,
      terms: [
        ...context.terms,
        {
          iri: RDFS_LABEL,
          kind: "property",
          objectKinds: ["literal"],
          languages: ["x-private"],
        },
      ],
    };
    const privateLabel = await previewAuthoringCommands(document, [{
      type: "set-property",
      commandId: "private-label",
      subjectIri: `${NS}a`,
      predicateIri: RDFS_LABEL,
      values: [{ kind: "literal", value: "private", language: "x-private" }],
    }], constrained);
    expect(privateLabel.valid).toBe(true);

    const incompatible: ResolvedAuthoringContext = {
      ...context,
      terms: [...context.terms, { iri: RDFS_LABEL, kind: "class" }],
    };
    expect((await previewAuthoringCommands(document, [{
      type: "set-property",
      commandId: "invalid-context",
      subjectIri: `${NS}a`,
      predicateIri: `${NS}count`,
      values: [{ kind: "literal", value: "2", datatypeIri: XSD_INTEGER }],
    }], incompatible)).diagnostics).toContainEqual(expect.objectContaining({
      code: "authoring-context-invalid",
    }));

    const invalidEnums = {
      ...context,
      terms: [...context.terms, {
        iri: `${NS}invalid-runtime-term`,
        kind: "invalid-kind",
        roles: ["invalid-role"],
        objectKinds: ["invalid-object-kind"],
      }],
    } as unknown as ResolvedAuthoringContext;
    const enumResult = await previewAuthoringCommands(document, [{
      type: "set-property",
      commandId: "invalid-enums",
      subjectIri: `${NS}a`,
      predicateIri: `${NS}count`,
      values: [{ kind: "literal", value: "2", datatypeIri: XSD_INTEGER }],
    }], invalidEnums);
    expect(enumResult.diagnostics).toContainEqual(expect.objectContaining({
      code: "authoring-context-invalid",
    }));

    const invalidMetadata = {
      ...context,
      terms: [...context.terms, {
        iri: `${NS}invalid-metadata`,
        kind: "property",
        description: " ",
        category: 42,
        examples: ["valid", ""],
        sentencePattern: "subject only",
      }],
    } as unknown as ResolvedAuthoringContext;
    const metadataResult = await previewAuthoringCommands(document, [{
      type: "set-property",
      commandId: "invalid-metadata-context",
      subjectIri: `${NS}a`,
      predicateIri: `${NS}count`,
      values: [{ kind: "literal", value: "2", datatypeIri: XSD_INTEGER }],
    }], invalidMetadata);
    expect(metadataResult.diagnostics.map((value) => value.message)).toEqual(expect.arrayContaining([
      expect.stringContaining("description must be a non-empty string"),
      expect.stringContaining("category must be a non-empty string"),
      expect.stringContaining("examples must contain non-empty strings"),
      expect.stringContaining("sentencePattern must contain A and B placeholders"),
    ]));

    const invalidCapability: ResolvedAuthoringContext = {
      ...context,
      capabilities: [{
        capabilityId: "invalid-template",
        parameters: [{ name: "literal-subject", objectKinds: ["literal"] }],
        graphPatch: {
          add: [{
            subject: { kind: "binding", name: "literal-subject" },
            predicate: { kind: "iri", iri: `${NS}reviewedBy` },
            object: { kind: "iri", iri: `${NS}a` },
          }],
        },
      }],
    };
    const capabilityResult = await previewAuthoringCommands(document, [{
      type: "set-property",
      commandId: "invalid-capability-context",
      subjectIri: `${NS}a`,
      predicateIri: `${NS}count`,
      values: [{ kind: "literal", value: "3", datatypeIri: XSD_INTEGER }],
    }], invalidCapability);
    expect(capabilityResult.diagnostics).toContainEqual(expect.objectContaining({
      code: "authoring-context-invalid",
    }));
  });

  it("compile/reconcile/initial position各phase後のabortをblocking rollbackする", async () => {
    const document = documentFor(baseSource);
    const allocationAbort = new AbortController();
    const allocation = await previewAuthoringCommands(document, [{
      type: "create-resource",
      commandId: "abort-allocation",
      initialStatements: [{
        subject: { kind: "created-resource" },
        predicateIri: RDFS_LABEL,
        object: { kind: "literal", value: "Aborted" },
      }],
    }], contextFor("revision-1"), {
      signal: allocationAbort.signal,
      allocator: {
        async allocate(request) {
          allocationAbort.abort();
          return {
            iri: `${NS}aborted-allocation`,
            requestId: request.requestId,
            baseRevision: request.baseRevision,
            contextId: request.contextId,
          };
        },
      },
    });
    expect(allocation.valid).toBe(false);
    expect(allocation.diagnostics).toContainEqual(expect.objectContaining({
      code: "authoring-aborted",
    }));

    const positionAbort = new AbortController();
    let layoutCalls = 0;
    const abortingRegistry = new LayoutAdapterRegistry([
      phaseAbortAdapter(STANDARD_LAYOUT_REFS.hierarchicalLr, "LR"),
      phaseAbortAdapter(STANDARD_LAYOUT_REFS.hierarchicalTb, "TB"),
    ]);
    function phaseAbortAdapter(
      layoutRef: typeof STANDARD_LAYOUT_REFS[keyof typeof STANDARD_LAYOUT_REFS],
      direction: "LR" | "TB",
    ): LayoutAdapter {
      const standard = new StandardLightweightLayoutAdapter(layoutRef, direction);
      return {
        layoutRef,
        async layout(request) {
          layoutCalls += 1;
          const result = await standard.layout(request);
          if (layoutCalls === 5) positionAbort.abort();
          return result;
        },
      };
    }
    const positioned = await previewAuthoringCommands(document, [{
      type: "create-resource",
      commandId: "abort-position",
      resourceIri: `${NS}aborted-position`,
      initialStatements: [{
        subject: { kind: "created-resource" },
        predicateIri: RDFS_LABEL,
        object: { kind: "literal", value: "Aborted position" },
      }],
      initialPosition: { viewId: "main", x: 100, y: 100 },
    }], {
      ...contextFor("revision-1"),
      runtime: {
        catalogsByProfile: new Map([[
          standardRdfRdfsCatalog.profileRef,
          { catalog: standardRdfRdfsCatalog },
        ]]),
        layouts: abortingRegistry,
      },
    }, { signal: positionAbort.signal });
    expect(positioned.valid).toBe(false);
    expect(positioned.diagnostics).toContainEqual(expect.objectContaining({
      code: "authoring-aborted",
    }));
  });

  it("catalog exact config、RDFS subclass type provenance、custom ordinal/defaultを往復する", async () => {
    const catalog = customStructuralCatalog();
    const source = customStructuralSource;
    const document = documentFor(source);
    const baseContext = contextFor("revision-1");
    const context: ResolvedAuthoringContext = {
      ...baseContext,
      runtime: {
        catalogsByProfile: new Map([[catalog.profileRef, { catalog }]]),
        layouts: createStandardLayoutRegistry(),
      },
      terms: [
        ...baseContext.terms,
        { iri: `${NS}CustomLane`, kind: "class" },
        {
          iri: `${NS}contains`,
          kind: "property",
          objectKinds: ["iri"],
          structural: true,
        },
      ],
    };
    const commands: AuthoringCommand[] = [{
      type: "set-membership",
      commandId: "custom-membership",
      containerIri: `${NS}lane`,
      memberIri: `${NS}c`,
      enabled: true,
      containerTypeIri: `${NS}CustomLane`,
      predicateIri: `${NS}contains`,
    }, {
      type: "set-sequence",
      commandId: "custom-sequence",
      sequenceIri: `${NS}seq`,
      memberIris: [`${NS}b`, `${NS}a`],
      sequenceTypeIri: RDF_SEQ,
      ordinalPredicatePrefix: `${NS}ordinal-`,
    }, {
      type: "set-alternatives",
      commandId: "custom-alternative",
      alternativeIri: `${NS}alt`,
      memberIris: [`${NS}a`, `${NS}c`, `${NS}b`],
      defaultMemberIri: `${NS}c`,
      alternativeTypeIri: RDF_ALT,
      ordinalPredicatePrefix: `${NS}ordinal-`,
      defaultOrdinal: 2,
    }];
    const preview = await previewAuthoringCommands(document, commands, context);
    expect(preview.valid).toBe(true);
    const result = await applyAuthoringPreview(document, preview, context, {
      confirmationId: preview.confirmationId,
    });
    expect(result.accepted).toBe(true);
    const graph = graphFor(result.document.semantic.source);
    expect(graph.countQuads(`${NS}lane`, RDF_TYPE, `${NS}CustomLane`, null)).toBe(1);
    expect(graph.countQuads(`${NS}lane`, RDF_TYPE, RDF_BAG, null)).toBe(0);
    expect(ordinalObjectsForPrefix(graph, `${NS}alt`, `${NS}ordinal-`)).toEqual([
      `${NS}a`, `${NS}c`, `${NS}b`,
    ]);
    expect(graph.countQuads(`${NS}seq`, `${NS}ordinal-label`, null, null)).toBe(1);
    expect(graph.countQuads(`${NS}seq`, `${NS}ordinal-01`, null, null)).toBe(1);

    const wrongConfig = await previewAuthoringCommands(document, [{
      type: "set-membership",
      commandId: "wrong-membership-config",
      containerIri: `${NS}lane`,
      memberIri: `${NS}c`,
      enabled: true,
      containerTypeIri: RDF_BAG,
      predicateIri: RDFS_MEMBER,
    }], context);
    expect(wrongConfig.diagnostics).toContainEqual(expect.objectContaining({
      code: "authoring-structure-config-unresolved",
      suggestedActions: [expect.objectContaining({
        actionId: "select-catalog-membership-capability",
      })],
    }));

    const scene = await buildIriographView(document, "main", context.runtime);
    const membership = scene.memberships!.find((entry) => (
      entry.provenance.editCapability?.command === "set-membership"
      && entry.provenance.editCapability.member === `${NS}a`
    ))!.provenance.editCapability!;
    expect(membership).toMatchObject({
      command: "set-membership",
      containerTypeIri: `${NS}CustomLane`,
      predicate: `${NS}contains`,
    });
    expect(seedAuthoringCommandFromProvenance(document, membership, "remove-parent").command)
      .toMatchObject({
        type: "set-membership",
        enabled: false,
        containerTypeIri: `${NS}CustomLane`,
      });
    const sequenceCapability = scene.memberships!.find((entry) => (
      entry.provenance.editCapability?.command === "set-sequence"
    ))!.provenance.editCapability!;
    expect(seedAuthoringCommandFromProvenance(document, sequenceCapability, "seed-seq").command)
      .toMatchObject({
        type: "set-sequence",
        memberIris: [`${NS}a`, `${NS}b`],
        ordinalPredicatePrefix: `${NS}ordinal-`,
      });
    const alternativeCapability = scene.memberships!.find((entry) => (
      entry.provenance.editCapability?.command === "set-alternatives"
    ))!.provenance.editCapability!;
    expect(seedAuthoringCommandFromProvenance(document, alternativeCapability, "seed-alt").command)
      .toMatchObject({
        type: "set-alternatives",
        defaultMemberIri: `${NS}b`,
        defaultOrdinal: 2,
      });

    const cascaded = await previewAuthoringCommands(document, [{
      type: "delete-resource",
      commandId: "cascade-custom-ordinal",
      resourceIri: `${NS}b`,
      cascade: true,
    }], context);
    expect(cascaded.valid).toBe(true);
    const cascadeGraph = graphFor(cascaded.candidateSource!);
    expect(cascadeGraph.countQuads(`${NS}seq`, `${NS}ordinal-label`, null, null)).toBe(1);
    expect(cascadeGraph.countQuads(`${NS}seq`, `${NS}ordinal-01`, null, null)).toBe(1);
  });

  it("RDFS class regionへのmembershipをobject側containerとして追加・除去する", async () => {
    const document = documentFor(`
      @prefix : <${NS}> .
      @prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
      @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
      :Category a rdfs:Class ; rdfs:label "Category" .
      :member rdfs:label "Member" .
    `);
    const context = contextFor("revision-1");
    const add = await previewAuthoringCommands(document, [{
      type: "set-membership",
      commandId: "classify",
      containerIri: `${NS}Category`,
      memberIri: `${NS}member`,
      enabled: true,
      containerTypeIri: RDFS_CLASS,
      predicateIri: RDF_TYPE,
      containerPosition: "object",
    }], context);

    expect(add.valid).toBe(true);
    const applied = await applyAuthoringPreview(document, add, context, {
      confirmationId: add.confirmationId,
    });
    expect(applied.accepted).toBe(true);
    expect(graphFor(applied.document.semantic.source).countQuads(
      `${NS}member`,
      RDF_TYPE,
      `${NS}Category`,
      null,
    )).toBe(1);

    const remove = seedAuthoringCommandFromProvenance(applied.document, {
      command: "set-membership",
      container: `${NS}Category`,
      member: `${NS}member`,
      containerTypeIri: RDFS_CLASS,
      predicate: RDF_TYPE,
      containerPosition: "object",
    }, "unclassify");
    expect(remove).toMatchObject({
      command: { type: "set-membership", enabled: false, containerPosition: "object" },
      diagnostics: [],
    });
  });

  it("既存resourceのrdf:type分類とrdfs:subClassOf階層をset-propertyで編集する", async () => {
    const document = documentFor(`
      @prefix : <${NS}> .
      @prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
      @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
      :Task a rdfs:Class ; rdfs:label "Task" .
      :Category a rdfs:Class ; rdfs:label "Category" .
      :a rdfs:label "A" .
    `);
    const base = contextFor("revision-1");
    const context: ResolvedAuthoringContext = {
      ...base,
      terms: [...base.terms, {
        iri: `${NS}Category`,
        kind: "class",
      }, {
        iri: RDF_TYPE,
        kind: "property",
        roles: ["predicate"],
        objectKinds: ["iri"],
        structural: true,
      }, {
        iri: RDFS_SUBCLASS_OF,
        kind: "property",
        roles: ["predicate"],
        objectKinds: ["iri"],
      }],
    };
    const preview = await previewAuthoringCommands(document, [{
      type: "set-property",
      commandId: "classify-a",
      subjectIri: `${NS}a`,
      predicateIri: RDF_TYPE,
      values: [{ kind: "iri", iri: `${NS}Task` }],
    }, {
      type: "set-property",
      commandId: "class-hierarchy",
      subjectIri: `${NS}Task`,
      predicateIri: RDFS_SUBCLASS_OF,
      values: [{ kind: "iri", iri: `${NS}Category` }],
    }], context);

    expect(preview.valid).toBe(true);
    expect(preview.diagnostics.some((value) => (
      value.code === "structural-predicate-property-edit-denied"
    ))).toBe(false);
    const graph = graphFor(preview.candidateSource!);
    expect(graph.countQuads(`${NS}a`, RDF_TYPE, `${NS}Task`, null)).toBe(1);
    expect(graph.countQuads(`${NS}Task`, RDFS_SUBCLASS_OF, `${NS}Category`, null)).toBe(1);
  });

  it("structured subPropertyOf-only deltaを全体再配置せずroute-only reconciliationへ渡す", async () => {
    const document = documentFor(`
      @prefix : <${NS}> .
      @prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
      @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
      :p a rdf:Property ; rdfs:label "P" .
      :q a rdf:Property ; rdfs:label "Q" .
      :a rdfs:label "A" ; :p :b .
      :b rdfs:label "B" .
    `);
    const requests: LayoutRequest[] = [];
    const layouts = new LayoutAdapterRegistry(([
      [STANDARD_LAYOUT_REFS.hierarchicalLr, "LR"],
      [STANDARD_LAYOUT_REFS.hierarchicalTb, "TB"],
    ] as const).map(([layoutRef, direction]): LayoutAdapter => {
      const standard = new StandardLightweightLayoutAdapter(layoutRef, direction);
      return {
        layoutRef,
        async layout(request) {
          requests.push(request);
          return standard.layout(request);
        },
      };
    }));
    const base = contextFor("revision-subproperty");
    const context: ResolvedAuthoringContext = {
      ...base,
      runtime: { ...base.runtime, layouts },
      terms: [...base.terms, {
        iri: `${NS}p`,
        kind: "property",
        objectKinds: ["iri"],
      }, {
        iri: `${NS}q`,
        kind: "property",
        objectKinds: ["iri"],
      }, {
        iri: RDFS_SUBPROPERTY_OF,
        kind: "property",
        roles: ["predicate"],
        objectKinds: ["iri"],
      }],
    };
    const preview = await previewAuthoringCommands(document, [{
      type: "set-property",
      commandId: "property-hierarchy",
      subjectIri: `${NS}p`,
      predicateIri: RDFS_SUBPROPERTY_OF,
      values: [{ kind: "iri", iri: `${NS}q` }],
    }], context);

    expect(preview.valid).toBe(true);
    expect(requests.filter((request) => request.mode === "route-only"))
      .toHaveLength(document.views.length);
  });

  it("rdfs:memberのdomain subpropertyをmembership authoringとprovenanceでexact保持する", async () => {
    const source = `${baseSource}
<${NS}contains> <http://www.w3.org/2000/01/rdf-schema#subPropertyOf> <${RDFS_MEMBER}> ;
  <${RDFS_LABEL}> "Contains" .
<${NS}lane> <${RDF_TYPE}> <${RDF_BAG}> ; <${RDFS_LABEL}> "Lane" .
`;
    const document = documentFor(source);
    const baseContext = contextFor("revision-domain-membership");
    const context: ResolvedAuthoringContext = {
      ...baseContext,
      documentRevision: "revision-domain-membership",
      terms: [...baseContext.terms, {
        iri: `${NS}contains`,
        kind: "property",
        label: "Contains",
        objectKinds: ["iri"],
        structural: true,
      }],
    };
    const preview = await previewAuthoringCommands(document, [{
      type: "set-membership",
      commandId: "domain-membership",
      containerIri: `${NS}lane`,
      memberIri: `${NS}a`,
      enabled: true,
      containerTypeIri: RDF_BAG,
      predicateIri: `${NS}contains`,
    }], context);

    expect(preview.valid).toBe(true);
    expect(preview.patch.added).toContainEqual(expect.objectContaining({
      predicateIri: `${NS}contains`,
    }));
    const applied = await applyAuthoringPreview(document, preview, context, {
      confirmationId: preview.confirmationId,
    });
    expect(applied.accepted).toBe(true);
    const scene = await buildIriographView(applied.document, "main", context.runtime);
    expect(scene.memberships).toContainEqual(expect.objectContaining({
      provenance: expect.objectContaining({
        editCapability: expect.objectContaining({ predicate: `${NS}contains` }),
      }),
    }));
  });

  it("AltはmemberIrisを最終ordinal順の正本として重複IRIも保持する", async () => {
    const document = documentFor(baseSource);
    const context = contextFor("revision-1");
    const command: AuthoringCommand = {
      type: "set-alternatives",
      commandId: "duplicate-alternative",
      alternativeIri: `${NS}alt`,
      memberIris: [`${NS}a`, `${NS}b`, `${NS}a`],
      defaultMemberIri: `${NS}a`,
      alternativeTypeIri: RDF_ALT,
      ordinalPredicatePrefix: RDF_ORDINAL_PREFIX,
      defaultOrdinal: 1,
    };
    const accepted = await previewAuthoringCommands(document, [command], context);
    expect(accepted.valid).toBe(true);
    expect(ordinalObjects(graphFor(accepted.candidateSource!), `${NS}alt`)).toEqual(command.memberIris);

    const mismatch = await previewAuthoringCommands(document, [{
      ...command,
      commandId: "mismatched-alternative",
      defaultMemberIri: `${NS}b`,
    }], context);
    expect(mismatch.valid).toBe(false);
    expect(mismatch.diagnostics).toContainEqual(expect.objectContaining({
      code: "alternative-default-mismatch",
    }));
  });

  it("standard term roleは追加roleも許さずexact一致を要求する", async () => {
    const document = documentFor(baseSource);
    const baseContext = contextFor("revision-1");
    const context: ResolvedAuthoringContext = {
      ...baseContext,
      terms: [
        ...baseContext.terms,
        { iri: RDF_TYPE, kind: "structure", roles: ["predicate", "type-object"] },
      ],
    };
    const result = await previewAuthoringCommands(document, [{
      type: "connect-resources",
      commandId: "invalid-role-context",
      subjectIri: `${NS}a`,
      predicateIri: `${NS}rel`,
      objectIri: `${NS}b`,
    }], context);
    expect(result.valid).toBe(false);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: "authoring-context-invalid",
      message: expect.stringContaining("standard term"),
    }));
  });

  it("語彙term位置をresource namespaceとして二重拒否しない", async () => {
    const document = documentFor(baseSource);
    const externalClass = "https://vocabulary.example/ExternalClass";
    const source = `${baseSource}\nex:new-resource a <${externalClass}> .\n`;
    const human = await applyAuthoringSource(document, source, contextFor("revision-1"), {
      actor: "human",
    });
    expect(human.accepted).toBe(true);
    expect(human.diagnostics).toContainEqual(expect.objectContaining({
      code: "unknown-term-introduced",
      severity: "warning",
      semanticRef: externalClass,
    }));
    expect(human.diagnostics.some((item) => (
      item.code === "resource-namespace-denied" && item.semanticRef === externalClass
    ))).toBe(false);

    const llm = await applyAuthoringSource(document, source, contextFor("revision-1"), {
      actor: "llm",
    });
    expect(llm.accepted).toBe(false);
    expect(llm.diagnostics).toContainEqual(expect.objectContaining({
      code: "unknown-term-introduced",
      semanticRef: externalClass,
    }));
    expect(llm.diagnostics.some((item) => (
      item.code === "resource-namespace-denied" && item.semanticRef === externalClass
    ))).toBe(false);

    const schemaSource = `${baseSource}\nex:ExternalSub rdfs:subClassOf <${externalClass}> .\n`;
    const humanSchema = await applyAuthoringSource(document, schemaSource, contextFor("revision-1"), {
      actor: "human",
    });
    expect(humanSchema.accepted).toBe(true);
    expect(humanSchema.diagnostics).toContainEqual(expect.objectContaining({
      code: "unknown-term-introduced",
      severity: "warning",
      semanticRef: externalClass,
    }));
    expect(humanSchema.diagnostics.some((item) => item.code === "resource-namespace-denied"))
      .toBe(false);
    const llmSchema = await applyAuthoringSource(document, schemaSource, contextFor("revision-1"), {
      actor: "llm",
    });
    expect(llmSchema.accepted).toBe(false);
    expect(llmSchema.diagnostics).toContainEqual(expect.objectContaining({
      code: "unknown-term-introduced",
      semanticRef: externalClass,
    }));

    const declaredSource = `${baseSource}\nex:DeclaredClass a rdfs:Class .\n`;
    const declaredDocument = documentFor(declaredSource);
    const rejectExisting: ResolvedAuthoringContext = {
      ...contextFor("revision-1"),
      termPolicy: { ...contextFor("revision-1").termPolicy, existingUnknown: "reject" },
    };
    const declared = await applyAuthoringSource(
      declaredDocument,
      declaredSource,
      rejectExisting,
      { actor: "human" },
    );
    expect(declared.accepted).toBe(false);
    expect(declared.diagnostics).toContainEqual(expect.objectContaining({
      code: "existing-unknown-term-rejected",
      semanticRef: `${NS}DeclaredClass`,
    }));
  });

  it("top-level context欠落や非arrayをthrowせずcontext診断へ畳み込む", async () => {
    const document = documentFor(baseSource);
    for (const malformed of [
      {},
      { ...contextFor("revision-1"), terms: undefined },
      { ...contextFor("revision-1"), capabilities: {} },
      { ...contextFor("revision-1"), resourcePolicy: {} },
      {
        ...contextFor("revision-1"),
        resourcePolicy: { allowedMintNamespaces: [NS], maxInitialPositionExtent: 0 },
      },
      { ...contextFor("revision-1"), runtime: {} },
      { ...contextFor("revision-1"), runtime: { catalogsByProfile: new Map(), layouts: "x" } },
      {
        ...contextFor("revision-1"),
        capabilities: [{ capabilityId: "broken", parameters: [], graphPatch: undefined }],
      },
    ]) {
      const result = await previewAuthoringCommands(document, [{
        type: "connect-resources",
        commandId: "malformed-context",
        subjectIri: `${NS}a`,
        predicateIri: `${NS}rel`,
        objectIri: `${NS}b`,
      }], malformed as ResolvedAuthoringContext);
      expect(result.valid).toBe(false);
      expect(result.diagnostics).toContainEqual(expect.objectContaining({
        code: "authoring-context-invalid",
      }));
    }
  });

  it("structured label/commentだけにdefaultLocaleを補完し明示languageを保持する", async () => {
    const document = documentFor(baseSource);
    const context: ResolvedAuthoringContext = {
      ...contextFor("revision-locale"),
      defaultLocale: "ja-JP",
    };
    const preview = await previewAuthoringCommands(document, [{
      type: "set-property",
      commandId: "localized-label",
      subjectIri: `${NS}b`,
      predicateIri: RDFS_LABEL,
      values: [
        { kind: "literal", value: "表示名" },
        { kind: "literal", value: "Name", language: "en" },
      ],
    }, {
      type: "set-property",
      commandId: "localized-comment",
      subjectIri: `${NS}b`,
      predicateIri: RDFS_COMMENT,
      values: [{ kind: "literal", value: "説明" }],
    }], context);

    expect(preview.valid).toBe(true);
    const graph = graphFor(preview.candidateSource!);
    expect(graph.getObjects(`${NS}b`, RDFS_LABEL, null).map((value) => [
      value.value,
      value.termType === "Literal" ? value.language : "",
    ])).toEqual(expect.arrayContaining([
      ["表示名", "ja-jp"],
      ["Name", "en"],
    ]));
    expect(graph.getObjects(`${NS}b`, RDFS_COMMENT, null)[0]).toMatchObject({
      value: "説明",
      language: "ja-jp",
    });

    const directSource = baseSource.replace(
      'ex:b rdfs:label "B" .',
      'ex:b rdfs:label "Direct untagged" .',
    );
    for (const actor of ["human", "llm"] as const) {
      const direct = await applyAuthoringSource(document, directSource, context, { actor });
      expect(direct.accepted).toBe(true);
      expect(graphFor(direct.document.semantic.source)
        .getObjects(`${NS}b`, RDFS_LABEL, null)[0]).toMatchObject({
          value: "Direct untagged",
          language: "",
        });
    }

    const invalid = await previewAuthoringCommands(document, [{
      type: "connect-resources",
      commandId: "invalid-locale",
      subjectIri: `${NS}a`,
      predicateIri: `${NS}rel`,
      objectIri: `${NS}b`,
    }], { ...context, defaultLocale: "not_a_language" });
    expect(invalid.valid).toBe(false);
    expect(invalid.diagnostics).toContainEqual(expect.objectContaining({
      code: "authoring-context-invalid",
      message: expect.stringContaining("defaultLocale"),
    }));
  });
});

const baseSource = `
@prefix ex: <${NS}> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
ex:lane a rdf:Bag ; rdfs:label "Lane" ; rdfs:member ex:a, ex:b, ex:c .
ex:seq a rdf:Seq ; rdf:_1 ex:a ; rdf:_2 ex:b ; rdf:_3 ex:a .
ex:alt a rdf:Alt ; rdf:_1 ex:a ; rdf:_2 ex:b ; rdf:_3 ex:c .
ex:a rdfs:label "A" ; ex:rel ex:b ; ex:legacy ex:c ; ex:count "1"^^xsd:integer ; ex:details [ ex:note "keep" ] .
ex:b rdfs:label "B" .
ex:c rdfs:label "C" .
ex:x rdfs:label "X" ; ex:b ex:a .
[ ex:ref ex:a ] .
`;

const customStructuralSource = `
@prefix ex: <${NS}> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
ex:CustomLane rdfs:subClassOf rdf:Bag .
ex:lane a ex:CustomLane ; rdfs:label "Lane" ; ex:contains ex:a, ex:b .
ex:seq a rdf:Seq ; ex:ordinal-1 ex:a ; ex:ordinal-2 ex:b ; ex:ordinal-label "keep" ; ex:ordinal-01 "keep-01" .
ex:alt a rdf:Alt ; ex:ordinal-1 ex:a ; ex:ordinal-2 ex:b ; ex:ordinal-3 ex:c .
ex:a rdfs:label "A" .
ex:b rdfs:label "B" .
ex:c rdfs:label "C" .
`;

function documentFor(source: string): IriographDocumentV1 {
  return {
    schemaVersion: "1",
    kind: "iriograph.document",
    documentId: "authoring-test",
    semantic: {
      format: "text/turtle",
      baseIri: NS,
      authoringProfileRef: "urn:test:authoring-profile:1",
      source,
    },
    views: [
      {
        viewId: "main",
        kind: "node-link",
        profileRef: standardRdfRdfsCatalog.profileRef,
        layoutRef: STANDARD_LAYOUT_REFS.hierarchicalLr,
        overlay: {},
      },
      {
        viewId: "alternate",
        kind: "node-link",
        profileRef: standardRdfRdfsCatalog.profileRef,
        layoutRef: STANDARD_LAYOUT_REFS.hierarchicalTb,
        overlay: {},
      },
    ],
  };
}

function contextFor(
  documentRevision: string,
  policy: { humanUnknown?: "allow" | "warn" | "reject" } = {},
): ResolvedAuthoringContext {
  return {
    contextId: "urn:test:resolved-authoring-context:1",
    contextRevision: "context-1",
    documentRevision,
    authoringProfileRef: "urn:test:authoring-profile:1",
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
      humanUnknown: policy.humanUnknown ?? "warn",
      llmUnknown: "reject",
      humanMinting: "warn",
      llmMinting: "deny",
    },
    terms: [
      { iri: `${NS}Task`, kind: "class" },
      { iri: `${NS}rel`, kind: "property", objectKinds: ["iri"] },
      { iri: `${NS}reviewedBy`, kind: "property", objectKinds: ["iri"] },
      {
        iri: `${NS}name`,
        kind: "property",
        objectKinds: ["literal"],
        languages: ["en"],
        minCount: 1,
        maxCount: 1,
      },
      {
        iri: `${NS}count`,
        kind: "property",
        objectKinds: ["literal"],
        datatypes: [XSD_INTEGER],
        maxCount: 1,
      },
    ],
    capabilities: [{
      capabilityId: "review-link",
      parameters: [
        { name: "subject", objectKinds: ["iri"] },
        { name: "object", objectKinds: ["iri"] },
      ],
      graphPatch: {
        add: [{
          subject: { kind: "binding", name: "subject" },
          predicate: { kind: "iri", iri: `${NS}reviewedBy` },
          object: { kind: "binding", name: "object" },
        }],
      },
    }],
  };
}

function echoAllocator(iri: string): ResourceIriAllocator {
  return {
    allocate: vi.fn(async (request) => ({
      iri,
      requestId: request.requestId,
      baseRevision: request.baseRevision,
      contextId: request.contextId,
    })),
  };
}

function graphFor(source: string): Store {
  return new Store(new Parser({ baseIRI: NS, format: "text/turtle" }).parse(source));
}

function ordinalObjects(store: Store, subjectIri: string): string[] {
  return store.getQuads(subjectIri, null, null, null)
    .filter((value) => value.predicate.value.startsWith(RDF_ORDINAL_PREFIX))
    .sort((left, right) => (
      Number(left.predicate.value.slice(RDF_ORDINAL_PREFIX.length))
      - Number(right.predicate.value.slice(RDF_ORDINAL_PREFIX.length))
    ))
    .map((value) => value.object.value);
}

function ordinalObjectsForPrefix(
  store: Store,
  subjectIri: string,
  prefix: string,
): string[] {
  return store.getQuads(subjectIri, null, null, null)
    .filter((value) => value.predicate.value.startsWith(prefix))
    .sort((left, right) => (
      Number(left.predicate.value.slice(prefix.length))
      - Number(right.predicate.value.slice(prefix.length))
    ))
    .map((value) => value.object.value);
}

function customStructuralCatalog(): ProjectionCatalogV1 {
  const catalog = JSON.parse(JSON.stringify(standardRdfRdfsCatalog)) as ProjectionCatalogV1;
  for (const rule of catalog.rules) {
    if (rule.project.operator === "membership-container") {
      rule.project.membershipPredicate = `${NS}contains`;
    }
    if (rule.project.operator === "ordinal-sequence") {
      rule.project.ordinalPredicatePrefix = `${NS}ordinal-`;
    }
    if (rule.project.operator === "alternative") {
      rule.project.ordinalPredicatePrefix = `${NS}ordinal-`;
      rule.project.defaultOrdinal = 2;
    }
  }
  return catalog;
}
