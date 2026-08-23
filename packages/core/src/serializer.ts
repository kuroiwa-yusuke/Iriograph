import { Parser, type Quad, type Term } from "n3";

import { sortDiagnostics } from "./diagnostics";
import type { ProjectionDiagnostic } from "./model";
import { compareCodePoints } from "./rdf";

export const TURTLE_SERIALIZER_VERSION_V1 = "iriograph-turtle-canonical-v1" as const;

export type TurtleSerializerVersion = typeof TURTLE_SERIALIZER_VERSION_V1;

export type CanonicalTurtleSerializerRequestV1 = {
  serializerVersion: typeof TURTLE_SERIALIZER_VERSION_V1;
  quads: readonly Quad[];
  baseIri?: string;
  /** Prefix names are emitted in lexical order. v1 output uses full IRIs in statements. */
  prefixes?: Readonly<Record<string, string>>;
};

export type CanonicalTurtleSerializationResult =
  | {
      accepted: true;
      serializerVersion: TurtleSerializerVersion;
      source: string;
      diagnostics: [];
    }
  | {
      accepted: false;
      serializerVersion: TurtleSerializerVersion;
      diagnostics: ProjectionDiagnostic[];
    };

export type CanonicalTurtleSourceResult = CanonicalTurtleSerializationResult & {
  /** Present only when parsing succeeded. */
  quads?: readonly Quad[];
};

/**
 * Canonical Turtle v1 writes one fully-expanded triple per line. Comments,
 * whitespace, property-list grouping and source order are intentionally absent.
 * Blank nodes are structurally refined; automorphically indistinguishable ties
 * fall back to input blank-node IDs, so the hard guarantee is determinism for
 * the same parsed RDF dataset regardless of quad iteration order.
 */
export function serializeCanonicalTurtleV1(
  request: CanonicalTurtleSerializerRequestV1,
): CanonicalTurtleSerializationResult {
  if (request.serializerVersion !== TURTLE_SERIALIZER_VERSION_V1) {
    return failure("serializer-version-unsupported", "Unsupported Turtle serializer version.");
  }
  const diagnostics = validateDataset(request.quads);
  const prefixEntries = validateAndSortPrefixes(request.prefixes);
  if (diagnostics.length > 0) {
    return {
      accepted: false,
      serializerVersion: TURTLE_SERIALIZER_VERSION_V1,
      diagnostics: sortDiagnostics(diagnostics),
    };
  }

  try {
    const blankLabels = canonicalBlankNodeLabels(request.quads);
    const triples = [...new Set(request.quads.map((quad) => serializeQuad(quad, blankLabels)))]
      .sort(compareCodePoints);
    const declarations: string[] = [];
    if (request.baseIri) declarations.push(`@base ${serializeIri(request.baseIri)} .`);
    for (const [prefix, iri] of prefixEntries) {
      declarations.push(`@prefix ${prefix}: ${serializeIri(iri)} .`);
    }
    const sections = [declarations.join("\n"), triples.join("\n")].filter(Boolean);
    return {
      accepted: true,
      serializerVersion: TURTLE_SERIALIZER_VERSION_V1,
      source: `${sections.join("\n\n")}\n`,
      diagnostics: [],
    };
  } catch {
    return failure("canonical-turtle-serialize-failed", "RDF dataset could not be serialized as canonical Turtle v1.");
  }
}

/** Parses candidate Turtle, preserves valid prefix context, then canonicalizes it. */
export function canonicalizeTurtleSourceV1(
  source: string,
  baseIri?: string,
): CanonicalTurtleSourceResult {
  const prefixes: Record<string, string> = {};
  let quads: Quad[];
  try {
    quads = new Parser({ baseIRI: baseIri, format: "text/turtle" }).parse(
      source,
      null,
      (prefix, iri) => {
        prefixes[prefix] = iri.value;
      },
    );
  } catch {
    return {
      ...failure("canonical-turtle-parse-failed", "Candidate Turtle could not be parsed."),
    };
  }
  const serialized = serializeCanonicalTurtleV1({
    serializerVersion: TURTLE_SERIALIZER_VERSION_V1,
    quads,
    baseIri,
    prefixes,
  });
  return serialized.accepted
    ? { ...serialized, quads }
    : serialized;
}

function validateDataset(
  quads: readonly Quad[],
): ProjectionDiagnostic[] {
  const diagnostics: ProjectionDiagnostic[] = [];
  for (const quad of quads) {
    if (quad.graph.termType !== "DefaultGraph") {
      diagnostics.push({
        severity: "error",
        code: "canonical-turtle-named-graph-unsupported",
        message: "Canonical Turtle v1 accepts only the default graph.",
      });
    }
    if (quad.subject.termType !== "NamedNode" && quad.subject.termType !== "BlankNode") {
      diagnostics.push(invalidTerm("subject", quad.subject));
    }
    if (quad.predicate.termType !== "NamedNode") {
      diagnostics.push(invalidTerm("predicate", quad.predicate));
    }
    if (
      quad.object.termType !== "NamedNode"
      && quad.object.termType !== "BlankNode"
      && quad.object.termType !== "Literal"
    ) {
      diagnostics.push(invalidTerm("object", quad.object));
    }
  }
  return diagnostics;
}

function validateAndSortPrefixes(
  prefixes: Readonly<Record<string, string>> | undefined,
): Array<[string, string]> {
  // v1 preserves a conservative ASCII subset. Wider legal PN_PREFIX forms are
  // presentation-only context and are omitted without changing the dataset.
  return Object.entries(prefixes ?? {})
    .filter(([prefix]) => /^(?:[A-Za-z][A-Za-z0-9_-]*)?$/u.test(prefix))
    .sort(([left], [right]) => compareCodePoints(left, right));
}

function canonicalBlankNodeLabels(quads: readonly Quad[]): ReadonlyMap<string, string> {
  const ids = new Set<string>();
  for (const quad of quads) {
    if (quad.subject.termType === "BlankNode") ids.add(quad.subject.value);
    if (quad.object.termType === "BlankNode") ids.add(quad.object.value);
  }
  const orderedIds = [...ids].sort(compareCodePoints);
  let colors = new Map(orderedIds.map((id) => [id, "blank"]));
  for (let iteration = 0; iteration <= orderedIds.length; iteration += 1) {
    const signatures = new Map(orderedIds.map((id) => [
      id,
      blankSignature(id, quads, colors),
    ]));
    const unique = [...new Set(signatures.values())].sort(compareCodePoints);
    const colorBySignature = new Map(unique.map((signature, index) => [signature, `c${index}`]));
    const next = new Map(orderedIds.map((id) => [id, colorBySignature.get(signatures.get(id)!)!]));
    if (orderedIds.every((id) => next.get(id) === colors.get(id))) {
      colors = next;
      break;
    }
    colors = next;
  }
  const canonicalOrder = [...orderedIds].sort((left, right) => (
    compareCodePoints(colors.get(left)!, colors.get(right)!)
    || compareCodePoints(left, right)
  ));
  return new Map(canonicalOrder.map((id, index) => [id, `b${index}`]));
}

function blankSignature(
  blankId: string,
  quads: readonly Quad[],
  colors: ReadonlyMap<string, string>,
): string {
  return quads
    .filter((quad) => (
      (quad.subject.termType === "BlankNode" && quad.subject.value === blankId)
      || (quad.object.termType === "BlankNode" && quad.object.value === blankId)
    ))
    .map((quad) => [
      signatureTerm(quad.subject, blankId, colors),
      signatureTerm(quad.predicate, blankId, colors),
      signatureTerm(quad.object, blankId, colors),
    ].join(" "))
    .sort(compareCodePoints)
    .join("\n");
}

function signatureTerm(
  term: Term,
  self: string,
  colors: ReadonlyMap<string, string>,
): string {
  if (term.termType !== "BlankNode") return serializeTerm(term, new Map());
  return term.value === self ? "_:self" : `_:${colors.get(term.value) ?? "blank"}`;
}

function serializeQuad(quad: Quad, blankLabels: ReadonlyMap<string, string>): string {
  return `${serializeTerm(quad.subject, blankLabels)} ${serializeTerm(quad.predicate, blankLabels)} ${serializeTerm(quad.object, blankLabels)} .`;
}

function serializeTerm(term: Term, blankLabels: ReadonlyMap<string, string>): string {
  switch (term.termType) {
    case "NamedNode":
      return serializeIri(term.value);
    case "BlankNode":
      return `_:${blankLabels.get(term.value) ?? term.value}`;
    case "Literal": {
      const value = `"${escapeLiteral(term.value)}"`;
      return term.language
        ? `${value}@${term.language.toLowerCase()}`
        : `${value}^^${serializeIri(term.datatype.value)}`;
    }
    case "DefaultGraph":
      return "";
    case "Variable":
      throw new Error("Variables cannot be serialized as Turtle terms.");
  }
}

function serializeIri(value: string): string {
  let result = "";
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    const forbidden = codePoint <= 0x20
      || character === "<"
      || character === ">"
      || character === '"'
      || character === "{"
      || character === "}"
      || character === "|"
      || character === "^"
      || character === "`"
      || character === "\\";
    result += forbidden ? unicodeEscape(codePoint) : character;
  }
  return `<${result}>`;
}

function escapeLiteral(value: string): string {
  let result = "";
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    switch (character) {
      case "\\": result += "\\\\"; break;
      case '"': result += '\\"'; break;
      case "\n": result += "\\n"; break;
      case "\r": result += "\\r"; break;
      case "\t": result += "\\t"; break;
      case "\b": result += "\\b"; break;
      case "\f": result += "\\f"; break;
      default:
        result += codePoint < 0x20 || codePoint === 0x7f
          ? unicodeEscape(codePoint)
          : character;
    }
  }
  return result;
}

function unicodeEscape(codePoint: number): string {
  return codePoint <= 0xffff
    ? `\\u${codePoint.toString(16).toUpperCase().padStart(4, "0")}`
    : `\\U${codePoint.toString(16).toUpperCase().padStart(8, "0")}`;
}

function invalidTerm(position: string, term: Term): ProjectionDiagnostic {
  return {
    severity: "error",
    code: "canonical-turtle-term-unsupported",
    message: `Unsupported RDF term in ${position}: ${term.termType}`,
  };
}

function failure(code: string, message: string): CanonicalTurtleSerializationResult {
  return {
    accepted: false,
    serializerVersion: TURTLE_SERIALIZER_VERSION_V1,
    diagnostics: [{ severity: "error", code, message }],
  };
}
