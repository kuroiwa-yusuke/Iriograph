import { describe, expect, it } from "vitest";

import type { SemanticValidationRequest } from "@iriograph/core";

import { mockSemanticValidationContext } from "./semantic-validation";

const RESOURCE = "urn:iriograph:demo:submit";

describe("mock semantic validation", () => {
  it("宣言済みprefixの完全tokenだけをsource rangeへ対応付ける", async () => {
    const source = "@prefix wf: <urn:iriograph:demo:> .\nwf:lane a <http://www.w3.org/1999/02/22-rdf-syntax-ns#Bag> ; <http://www.w3.org/2000/01/rdf-schema#label> \"Lane\" ; <http://www.w3.org/2000/01/rdf-schema#member> wf:submit .\n";
    const response = await mockSemanticValidationContext.validator.validate(
      requestFor(source),
      new AbortController().signal,
    );
    expect(response.findings[0]).toMatchObject({
      code: "demo-visible-resource-label-required",
      semanticRef: RESOURCE,
      sourceRange: {
        startOffset: source.indexOf("wf:submit"),
        endOffset: source.indexOf("wf:submit") + "wf:submit".length,
      },
    });
  });

  it("裸local nameの一致からsource rangeを推測しない", async () => {
    const response = await mockSemanticValidationContext.validator.validate(
      requestFor("# submit is mentioned, but no exact RDF token is available\n"),
      new AbortController().signal,
    );
    expect(response.findings[0]?.sourceRange).toBeUndefined();
  });
});

function requestFor(source: string): SemanticValidationRequest {
  return {
    contextId: mockSemanticValidationContext.contextId,
    contextRevision: mockSemanticValidationContext.contextRevision,
    sourceFingerprint: "urn:test:source",
    datasetFingerprint: "urn:test:dataset",
    source,
    dataset: {
      datasetFingerprint: "urn:test:dataset",
      statements: [{
        statementRef: "urn:test:statement:bag",
        subject: { termType: "NamedNode", value: "urn:iriograph:demo:lane" },
        predicate: {
          termType: "NamedNode",
          value: "http://www.w3.org/1999/02/22-rdf-syntax-ns#type",
        },
        object: {
          termType: "NamedNode",
          value: "http://www.w3.org/1999/02/22-rdf-syntax-ns#Bag",
        },
        graph: { termType: "DefaultGraph", value: "" },
      }, {
        statementRef: "urn:test:statement:lane-label",
        subject: { termType: "NamedNode", value: "urn:iriograph:demo:lane" },
        predicate: {
          termType: "NamedNode",
          value: "http://www.w3.org/2000/01/rdf-schema#label",
        },
        object: {
          termType: "Literal",
          value: "Lane",
          datatypeIri: "http://www.w3.org/2001/XMLSchema#string",
        },
        graph: { termType: "DefaultGraph", value: "" },
      }, {
        statementRef: "urn:test:statement:member",
        subject: { termType: "NamedNode", value: "urn:iriograph:demo:lane" },
        predicate: {
          termType: "NamedNode",
          value: "http://www.w3.org/2000/01/rdf-schema#member",
        },
        object: { termType: "NamedNode", value: RESOURCE },
        graph: { termType: "DefaultGraph", value: "" },
      }],
    },
  };
}
