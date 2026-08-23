import {
  STANDARD_LAYOUT_REFS,
  standardRdfRdfsCatalog,
  type IriographDocumentV1,
} from "@iriograph/core";

export const MOCK_PERFORMANCE_SCALE = {
  nodes: 500,
  edges: 1_000,
  containerSize: 50,
} as const;

/** Fixed browser benchmark document; fixture construction is outside measured frames. */
export function createMockPerformanceDocument(): IriographDocumentV1 {
  const { nodes, edges, containerSize } = MOCK_PERFORMANCE_SCALE;
  const lines = [
    "@prefix : <urn:iriograph:browser-benchmark:> .",
    "@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .",
    "@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .",
    "",
  ];
  for (let start = 0; start < nodes; start += containerSize) {
    const containerIndex = start / containerSize;
    lines.push(`:group-${containerIndex} a rdf:Bag ; rdfs:label "Group ${containerIndex}" .`);
    for (let member = start; member < Math.min(start + containerSize, nodes); member += 1) {
      lines.push(`:group-${containerIndex} rdfs:member :node-${member} .`);
    }
  }
  for (let index = 0; index < nodes; index += 1) {
    lines.push(`:node-${index} rdfs:label "Node ${index}" .`);
  }
  let emitted = 0;
  for (let offset = 1; offset < nodes && emitted < edges; offset += 1) {
    for (let source = 0; source + offset < nodes && emitted < edges; source += 1) {
      lines.push(`:node-${source} :connects :node-${source + offset} .`);
      emitted += 1;
    }
  }
  if (emitted !== edges) throw new Error("browser benchmark edge cardinality is invalid");
  return {
    schemaVersion: "1",
    kind: "iriograph.document",
    documentId: "browser-performance-500-1000",
    semantic: {
      format: "text/turtle",
      baseIri: "urn:iriograph:browser-benchmark:",
      authoringProfileRef: "urn:iriograph:authoring-profile:browser-performance@1",
      source: `${lines.join("\n")}\n`,
    },
    imports: [{ catalogRef: "urn:iriograph:catalog:rdf-rdfs@1" }],
    views: [{
      viewId: "main",
      kind: "node-link",
      profileRef: standardRdfRdfsCatalog.profileRef,
      layoutRef: STANDARD_LAYOUT_REFS.hierarchicalLr,
      overlay: {},
    }],
  };
}
