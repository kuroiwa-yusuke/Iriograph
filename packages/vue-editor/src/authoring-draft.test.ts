import { describe, expect, it } from "vitest";

import {
  compileAuthoringDraft,
  draftFromAuthoringCommand,
  emptyAuthoringDraft,
  emptyPropertyValueDraft,
  splitIriLines,
} from "./authoring-draft";

describe("authoring draft", () => {
  it("Seq/Alt memberの入力順と同一IRIの複数ordinalを保持する", () => {
    expect(splitIriLines("urn:a\nurn:b\nurn:a\n")).toEqual([
      "urn:a",
      "urn:b",
      "urn:a",
    ]);
  });

  it("create resourceのsemantic statementsと初期表示位置を一commandへまとめる", () => {
    const draft = {
      ...emptyAuthoringDraft("create-resource"),
      classIri: "urn:test:Task",
      label: "Review",
      initialX: "120",
      initialY: "80",
    };

    expect(compileAuthoringDraft(draft, "main")).toEqual([expect.objectContaining({
      type: "create-resource",
      initialPosition: { viewId: "main", x: 120, y: 80 },
      initialStatements: [
        expect.objectContaining({ predicateIri: expect.stringMatching(/#type$/u) }),
        expect.objectContaining({ predicateIri: expect.stringMatching(/#label$/u) }),
      ],
    })]);
  });

  it("create resourceのdirect edgeとcatalog membershipをcreated placeholder付きでatomic compileする", () => {
    const command = compileAuthoringDraft({
      ...emptyAuthoringDraft("create-resource"),
      label: "Review",
      createEdgeEnabled: true,
      createEdgeDirection: "incoming",
      createEdgePredicateIri: "urn:test:assignedTo",
      createEdgeResourceIri: "urn:test:owner",
      createMembershipEnabled: true,
      createMembershipContainerIri: "urn:test:lane",
      createMembershipStructureConfigKey: "bag-membership",
      createMembershipContainerTypeIri: "http://www.w3.org/1999/02/22-rdf-syntax-ns#Bag",
      createMembershipPredicateIri: "http://www.w3.org/2000/01/rdf-schema#member",
    }, "main")[0];

    expect(command).toMatchObject({
      type: "create-resource",
      initialStatements: [
        expect.objectContaining({ predicateIri: expect.stringMatching(/#label$/u) }),
        {
          subject: { kind: "iri", iri: "urn:test:owner" },
          predicateIri: "urn:test:assignedTo",
          object: { kind: "created-resource" },
        },
        {
          subject: { kind: "iri", iri: "urn:test:lane" },
          predicateIri: "http://www.w3.org/2000/01/rdf-schema#member",
          object: { kind: "created-resource" },
        },
      ],
    });
  });

  it("create compositeの部分入力とtripleなしを明確なcompile errorにする", () => {
    expect(() => compileAuthoringDraft(emptyAuthoringDraft("create-resource"), "main"))
      .toThrow(/1 triple/u);
    expect(() => compileAuthoringDraft({
      ...emptyAuthoringDraft("create-resource"),
      label: "Review",
      createEdgeEnabled: true,
      createEdgeResourceIri: "urn:test:owner",
    }, "main")).toThrow(/predicate/u);
    expect(() => compileAuthoringDraft({
      ...emptyAuthoringDraft("create-resource"),
      label: "Review",
      createMembershipEnabled: true,
      createMembershipContainerIri: "urn:test:lane",
    }, "main")).toThrow(/catalog membership structure/u);
  });

  it("空literalと明示的なproperty削除を区別する", () => {
    const draft = {
      ...emptyAuthoringDraft("set-property"),
      subjectIri: "urn:test:a",
      predicateIri: "urn:test:name",
    };
    expect(compileAuthoringDraft(draft, "main")[0]).toMatchObject({
      type: "set-property",
      values: [{ kind: "literal", value: "" }],
    });
    expect(compileAuthoringDraft({ ...draft, propertyMode: "delete" }, "main")[0]).toMatchObject({
      type: "set-property",
      values: [],
    });
  });

  it("property複数値をkind・順序・空literalを含めてlosslessにcompileする", () => {
    const draft = {
      ...emptyAuthoringDraft("set-property"),
      subjectIri: "urn:test:a",
      predicateIri: "urn:test:value",
      propertyValues: [
        { ...emptyPropertyValueDraft(), value: "", language: "x-private" },
        { ...emptyPropertyValueDraft("iri"), value: "urn:test:b" },
        { ...emptyPropertyValueDraft(), value: "42", datatypeIri: "http://www.w3.org/2001/XMLSchema#integer" },
      ],
    };
    const command = compileAuthoringDraft(draft, "main")[0]!;
    expect(command).toMatchObject({
      values: [
        { kind: "literal", value: "", language: "x-private" },
        { kind: "iri", iri: "urn:test:b" },
        { kind: "literal", value: "42", datatypeIri: "http://www.w3.org/2001/XMLSchema#integer" },
      ],
    });
    expect(draftFromAuthoringCommand(command)?.propertyValues).toEqual(draft.propertyValues);
  });

  it("catalog由来のstructure設定と重複member ordinalをroundtripで保持する", () => {
    const command = compileAuthoringDraft({
      ...emptyAuthoringDraft("set-alternatives"),
      structureIri: "urn:test:alt",
      membersText: "urn:test:a\nurn:test:b\nurn:test:a",
      defaultMemberIri: "urn:test:b",
      alternativeTypeIri: "urn:test:Alternative",
      ordinalPredicatePrefix: "urn:test:ordinal-",
      defaultOrdinal: "2",
    }, "main")[0]!;
    expect(command).toMatchObject({
      memberIris: ["urn:test:a", "urn:test:b", "urn:test:a"],
      alternativeTypeIri: "urn:test:Alternative",
      ordinalPredicatePrefix: "urn:test:ordinal-",
      defaultOrdinal: 2,
    });
    expect(compileAuthoringDraft(draftFromAuthoringCommand(command)!, "main")[0]).toEqual(command);
  });
});
