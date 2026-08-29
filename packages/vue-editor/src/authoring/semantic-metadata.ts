import {
  compareCodePoints,
  parseSemanticGraph,
  type IriographDocument,
} from "@iriograph/core";

const RDFS_LABEL = "http://www.w3.org/2000/01/rdf-schema#label";
const RDFS_COMMENT = "http://www.w3.org/2000/01/rdf-schema#comment";

export type SemanticDisplayText = {
  value: string;
  language: string;
};

export type SemanticDisplayMetadata = {
  labels: SemanticDisplayText[];
  comments: SemanticDisplayText[];
};

/**
 * Read-only metadata projection used by editor chrome. It does not add
 * presentation state to Turtle and keeps every localized value available.
 */
export function semanticDisplayMetadata(
  document: IriographDocument,
): Record<string, SemanticDisplayMetadata> {
  const graph = parseSemanticGraph(document);
  const result = new Map<string, SemanticDisplayMetadata>();
  for (const quad of graph.quads) {
    if (
      quad.subject.termType !== "NamedNode"
      || quad.object.termType !== "Literal"
      || (quad.predicate.value !== RDFS_LABEL && quad.predicate.value !== RDFS_COMMENT)
    ) continue;
    const current = result.get(quad.subject.value) ?? { labels: [], comments: [] };
    const target = quad.predicate.value === RDFS_LABEL ? current.labels : current.comments;
    const entry = {
      value: quad.object.value.normalize("NFC"),
      language: quad.object.language.toLowerCase(),
    };
    if (!target.some((candidate) => (
      candidate.value === entry.value && candidate.language === entry.language
    ))) target.push(entry);
    result.set(quad.subject.value, current);
  }
  return Object.fromEntries([...result.entries()].map(([iri, metadata]) => [iri, {
    labels: metadata.labels.sort(compareText),
    comments: metadata.comments.sort(compareText),
  }]));
}

export function semanticTextLabel(text: SemanticDisplayText): string {
  return text.language ? `${text.value} (${text.language})` : text.value;
}

function compareText(left: SemanticDisplayText, right: SemanticDisplayText): number {
  return compareCodePoints(left.language, right.language)
    || compareCodePoints(left.value, right.value);
}
