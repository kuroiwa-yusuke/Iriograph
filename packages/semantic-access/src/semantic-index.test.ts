import type { AuthoringCommand, AuthoringPreview, IriographDocumentV1 } from "@iriograph/core";
import { describe, expect, it, vi } from "vitest";

import {
  SemanticAccessIndex,
  SemanticAuthoringFacade,
  SemanticWriteConfirmationError,
  StaleSemanticRevisionError,
  compileAliasedOperation,
  type AliasedAuthoringOperation,
  type SemanticWritePort,
} from "./index";
import { RDF_ORDINAL_PREFIX, RDFS_MEMBER } from "./vocabulary";

const NS = "urn:test:semantic-access:";
const SOURCE = `
@prefix ex: <${NS}> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix skos: <http://www.w3.org/2004/02/skos/core#> .

ex:a a ex:Child ;
  rdfs:label "Request"@en, "申請"@ja ;
  skos:altLabel "依頼"@ja ;
  rdfs:comment "承認対象の申請"@ja ;
  ex:rel ex:b .
ex:b rdfs:label "同名"@ja .
ex:c rdfs:label "同名"@ja .
ex:unlabeled a ex:Child .

ex:Child rdfs:subClassOf ex:Base .
ex:rel a rdf:Property ;
  rdfs:label "承認する"@ja ;
  rdfs:subPropertyOf ex:superRel .
ex:contains rdfs:label "所属する"@ja ;
  rdfs:subPropertyOf rdfs:member .
ex:deepContains rdfs:subPropertyOf ex:contains .

ex:bag rdfs:member ex:b ;
  ex:contains ex:a ;
  ex:deepContains ex:unlabeled ;
  rdf:_1 ex:c .
`;

const REORDERED_SOURCE = `
@prefix ex: <${NS}> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix skos: <http://www.w3.org/2004/02/skos/core#> .
ex:bag rdf:_1 ex:c .
ex:bag ex:deepContains ex:unlabeled .
ex:bag ex:contains ex:a .
ex:bag rdfs:member ex:b .
ex:deepContains rdfs:subPropertyOf ex:contains .
ex:contains rdfs:subPropertyOf rdfs:member .
ex:contains rdfs:label "所属する"@ja .
ex:rel rdfs:subPropertyOf ex:superRel .
ex:rel rdfs:label "承認する"@ja .
ex:rel rdf:type rdf:Property .
ex:Child rdfs:subClassOf ex:Base .
ex:unlabeled rdf:type ex:Child .
ex:c rdfs:label "同名"@ja .
ex:b rdfs:label "同名"@ja .
ex:a ex:rel ex:b .
ex:a rdfs:comment "承認対象の申請"@ja .
ex:a skos:altLabel "依頼"@ja .
ex:a rdfs:label "申請"@ja .
ex:a rdfs:label "Request"@en .
ex:a rdf:type ex:Child .
`;

describe("SemanticAccessIndex", () => {
  it("locale順のlabel/commentとlabelなしIRI fallbackを返す", () => {
    const index = indexFor(SOURCE, "rev-1", ["ja-JP", "en"]);
    const a = index.describe(required(index.resourceAlias(`${NS}a`)));
    expect(a.label).toBe("申請");
    expect(a.description).toBe("承認対象の申請");
    expect(a.labels.map((label) => label.value)).toEqual(expect.arrayContaining(["Request", "依頼", "申請"]));

    const unlabeled = index.describe(required(index.resourceAlias(`${NS}unlabeled`)));
    expect(unlabeled.label).toBe("unlabeled");
    expect(unlabeled.labelSource).toBe("iri");
    expect(() => indexFor(SOURCE, "odd-locale", ["not_a_runtime_locale"])).not.toThrow();
  });

  it("同名labelをIRIで決定的にtie-breakしlabelをidentityにしない", () => {
    const forward = indexFor(SOURCE, "same-revision");
    const reversed = indexFor(REORDERED_SOURCE, "same-revision");

    expect(forward.searchResources("同名").map((result) => result.iri)).toEqual([
      `${NS}b`,
      `${NS}c`,
    ]);
    for (const iri of [`${NS}a`, `${NS}b`, `${NS}c`, `${NS}rel`]) {
      expect(forward.resourceAlias(iri)).toEqual(reversed.resourceAlias(iri));
    }
    expect(forward.resourceAlias(`${NS}b`)).not.toEqual(forward.resourceAlias(`${NS}c`));
  });

  it("predicateをlabel検索し、usageと別alias空間を返す", () => {
    const index = indexFor(SOURCE);
    const [relation] = index.searchPredicates("承認する");
    expect(relation).toMatchObject({
      iri: `${NS}rel`,
      label: "承認する",
      matchedField: "preferred-label",
      usageCount: 1,
    });
    expect(relation!.predicateAlias).toMatch(/^p[1-9][0-9]*$/);
    expect(relation!.alias).toMatch(/^r[1-9][0-9]*$/);
    expect(index.searchRelations("承認する")).toEqual(index.searchPredicates("承認する"));
  });

  it("types・class/property階層・近傍・depth指定subgraphを取得する", () => {
    const index = indexFor(SOURCE);
    const a = required(index.resourceAlias(`${NS}a`));
    const relation = required(index.predicateAlias(`${NS}rel`));
    const child = index.describe(required(index.resourceAlias(`${NS}Child`)));
    expect(index.describe(a).types).toEqual([`${NS}Child`]);
    expect(child.superClasses).toContainEqual(expect.objectContaining({ iri: `${NS}Base`, distance: 1 }));
    expect(index.describe(required(index.resourceAlias(`${NS}rel`))).superProperties)
      .toContainEqual(expect.objectContaining({ iri: `${NS}superRel`, distance: 1 }));

    const neighbors = index.neighbors({ resource: a, direction: "outgoing", predicate: relation });
    expect(neighbors).toHaveLength(1);
    expect(neighbors[0]).toMatchObject({
      subject: { iri: `${NS}a` },
      predicate: { iri: `${NS}rel`, label: "承認する" },
      object: { iri: `${NS}b` },
    });
    const subgraph = index.subgraph({ root: a, depth: 1, predicates: [relation] });
    expect(subgraph.resources.map((resource) => resource.iri)).toEqual([`${NS}a`, `${NS}b`]);
    expect(subgraph.relations).toHaveLength(1);
  });

  it("rdfs:member・subproperty closure・rdf:_nをmembershipへ正規化し元predicateを保つ", () => {
    const index = indexFor(SOURCE);
    const memberships = index.memberships({
      resource: required(index.resourceAlias(`${NS}bag`)),
      role: "container",
    });
    expect(memberships.map((membership) => ({
      member: membership.member.iri,
      predicate: membership.predicate.iri,
      distance: membership.subpropertyDistance,
      kind: membership.kind,
    }))).toEqual([
      { member: `${NS}a`, predicate: `${NS}contains`, distance: 1, kind: "generic-membership" },
      { member: `${NS}unlabeled`, predicate: `${NS}deepContains`, distance: 2, kind: "generic-membership" },
      { member: `${NS}c`, predicate: `${RDF_ORDINAL_PREFIX}1`, distance: 1, kind: "ordinal-membership" },
      { member: `${NS}b`, predicate: RDFS_MEMBER, distance: 0, kind: "generic-membership" },
    ].sort((left, right) => left.member.localeCompare(right.member) || left.predicate.localeCompare(right.predicate)));
    expect(index.memberships({ includeOrdinals: false }).every((membership) => (
      membership.kind === "generic-membership"
    ))).toBe(true);
  });

  it("aliasをrevisionへ束縛しstale参照・未知aliasを拒否する", () => {
    const index = indexFor(SOURCE, "rev-current");
    const a = required(index.resourceAlias(`${NS}a`));
    expect(() => index.describe({ ...a, revision: "rev-old" })).toThrow(StaleSemanticRevisionError);
    expect(() => index.resolveAlias({ alias: "r9999", revision: "rev-current" }, "resource"))
      .toThrow("Unknown resource alias");
  });
});

describe("alias authoring facade", () => {
  it("structured alias operationをCore commandへcompileしてpreview/applyを注入portへ委譲する", async () => {
    const index = indexFor(SOURCE, "write-rev");
    const operation: AliasedAuthoringOperation = {
      type: "connect-resources",
      operationId: "connect-a-c",
      revision: "write-rev",
      subject: required(index.resourceAlias(`${NS}a`)),
      predicate: required(index.predicateAlias(`${NS}rel`)),
      object: required(index.resourceAlias(`${NS}c`)),
    };
    const command = compileAliasedOperation(index, operation);
    expect(command).toEqual({
      type: "connect-resources",
      commandId: "connect-a-c",
      subjectIri: `${NS}a`,
      predicateIri: `${NS}rel`,
      objectIri: `${NS}c`,
    });

    const preview = previewFor("write-rev", command);
    const previewCall = vi.fn(async () => preview);
    const applyCall = vi.fn(async () => ({
      accepted: true as const,
      document: index.document,
      diagnostics: [],
    }));
    const facade = new SemanticAuthoringFacade(index, {
      preview: previewCall,
      apply: applyCall,
    });

    const wrapped = await facade.preview(operation);
    expect(previewCall).toHaveBeenCalledWith(expect.objectContaining({
      document: index.document,
      revision: "write-rev",
      command,
    }));
    const result = await facade.apply(wrapped, {
      revision: "write-rev",
      confirmationId: preview.confirmationId,
    });
    expect(result.accepted).toBe(true);
    expect(applyCall).toHaveBeenCalledWith(expect.objectContaining({
      revision: "write-rev",
      preview,
      confirmationId: preview.confirmationId,
    }));
  });

  it("stale operationとconfirmation不一致をport呼出前に拒否する", async () => {
    const index = indexFor(SOURCE, "write-rev");
    const base: AliasedAuthoringOperation = {
      type: "delete-resource",
      operationId: "delete-a",
      revision: "write-rev",
      resource: required(index.resourceAlias(`${NS}a`)),
    };
    const previewCall = vi.fn(async ({ command }: { command: AuthoringCommand }) => previewFor("write-rev", command));
    const applyCall = vi.fn<SemanticWritePort["apply"]>(async () => {
      throw new Error("apply must not be called");
    });
    const facade = new SemanticAuthoringFacade(index, { preview: previewCall, apply: applyCall });

    expect(() => compileAliasedOperation(index, { ...base, revision: "old-rev" }))
      .toThrow(StaleSemanticRevisionError);
    const wrapped = await facade.preview(base);
    await expect(facade.apply(wrapped, { revision: "write-rev", confirmationId: "wrong" }))
      .rejects.toThrow(SemanticWriteConfirmationError);
    expect(applyCall).not.toHaveBeenCalled();
  });
});

function indexFor(source: string, revision = "rev-1", locales: readonly string[] = ["ja"]): SemanticAccessIndex {
  return new SemanticAccessIndex(documentFor(source), revision, { locales });
}

function documentFor(source: string): IriographDocumentV1 {
  return {
    schemaVersion: "1",
    kind: "iriograph.document",
    documentId: "semantic-access-test",
    semantic: {
      format: "text/turtle",
      baseIri: NS,
      authoringProfileRef: "urn:test:authoring-profile",
      source,
    },
    views: [],
  };
}

function previewFor(revision: string, command: AuthoringCommand): AuthoringPreview {
  return {
    valid: true,
    requiresConfirmation: true,
    confirmationId: `confirm-${revision}`,
    baseDocumentFingerprint: "fingerprint",
    baseRevision: revision,
    contextId: "context",
    contextRevision: "context-revision",
    authoringProfileRef: "urn:test:authoring-profile",
    commands: [command] as AuthoringPreview["commands"],
    candidateSource: SOURCE,
    patch: { added: [], removed: [] },
    diagnostics: [],
  };
}

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected value");
  return value;
}
