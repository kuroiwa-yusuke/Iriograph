import { Parser, type Quad, type Term } from "n3";

import { sortDiagnostics } from "../projection/diagnostics.js";
import type { ProjectionDiagnostic } from "./model.js";
import { compareCodePoints } from "../semantic/rdf.js";

export const TURTLE_SERIALIZER_VERSION_V1 = "iriograph-turtle-canonical-v1" as const;

export type TurtleSerializerVersion = typeof TURTLE_SERIALIZER_VERSION_V1;

export type CanonicalTurtleSerializerRequestV1 = {
  serializerVersion: typeof TURTLE_SERIALIZER_VERSION_V1;
  quads: readonly Quad[];
  baseIri?: string;
  /** Valid, used aliases participate after standard and base/default bindings. */
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
 * Canonical Turtle v1 sorts expanded RDF tuples, then writes one compact triple
 * per line. Comments, whitespace, property-list grouping and source order are
 * intentionally absent. Standard namespaces, base/default and valid input
 * prefixes are selected deterministically; unused aliases are omitted.
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
  if (diagnostics.length > 0) {
    return {
      accepted: false,
      serializerVersion: TURTLE_SERIALIZER_VERSION_V1,
      diagnostics: sortDiagnostics(diagnostics),
    };
  }

  try {
    const blankLabels = canonicalBlankNodeLabels(request.quads);
    const prefixBindings = selectPrefixBindings(request.baseIri, request.prefixes);
    const usedPrefixes = new Set<string>();
    const triples = canonicalQuadOrder(request.quads, blankLabels)
      .map((quad) => serializeQuad(quad, blankLabels, prefixBindings, usedPrefixes));
    const declarations: string[] = [];
    if (request.baseIri) declarations.push(`@base ${serializeIri(request.baseIri)} .`);
    for (const binding of prefixBindings
      .filter(({ prefix }) => usedPrefixes.has(prefix))
      .sort(comparePrefixDeclarations)) {
      declarations.push(`@prefix ${binding.prefix}: ${serializeIri(binding.namespace)} .`);
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

const RDF_NAMESPACE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const RDFS_NAMESPACE = "http://www.w3.org/2000/01/rdf-schema#";
const XSD_NAMESPACE = "http://www.w3.org/2001/XMLSchema#";
const RDF_TYPE = `${RDF_NAMESPACE}type`;

type PrefixBinding = {
  prefix: string;
  namespace: string;
  source: "standard" | "default" | "input";
};

const STANDARD_PREFIXES: readonly PrefixBinding[] = [
  { prefix: "rdf", namespace: RDF_NAMESPACE, source: "standard" },
  { prefix: "rdfs", namespace: RDFS_NAMESPACE, source: "standard" },
  { prefix: "xsd", namespace: XSD_NAMESPACE, source: "standard" },
];

function selectPrefixBindings(
  baseIri: string | undefined,
  prefixes: Readonly<Record<string, string>> | undefined,
): PrefixBinding[] {
  const bindings = [...STANDARD_PREFIXES];
  const input = Object.entries(prefixes ?? {})
    .sort(([leftPrefix, leftIri], [rightPrefix, rightIri]) => (
      compareCodePoints(leftPrefix, rightPrefix) || compareCodePoints(leftIri, rightIri)
    ));
  const inputDefault = input.find(([prefix]) => prefix === "")?.[1];
  const defaultNamespace = baseIri ?? inputDefault;
  if (defaultNamespace && isAbsoluteIri(defaultNamespace)) {
    bindings.push({ prefix: "", namespace: defaultNamespace, source: "default" });
  }

  const reservedPrefixes = new Set(["", ...STANDARD_PREFIXES.map(({ prefix }) => prefix)]);
  const standardNamespaces = new Set(STANDARD_PREFIXES.map(({ namespace }) => namespace));
  for (const [prefix, namespace] of input) {
    if (
      reservedPrefixes.has(prefix)
      || !validPrefixName(prefix)
      || !isAbsoluteIri(namespace)
      || standardNamespaces.has(namespace)
    ) continue;
    bindings.push({ prefix, namespace, source: "input" });
  }
  return bindings;
}

function canonicalQuadOrder(
  quads: readonly Quad[],
  blankLabels: ReadonlyMap<string, string>,
): Quad[] {
  const unique = new Map<string, Quad>();
  for (const quad of quads) unique.set(expandedQuadKey(quad, blankLabels), quad);
  return [...unique.entries()]
    .sort(([left], [right]) => compareCodePoints(left, right))
    .map(([, quad]) => quad);
}

function expandedQuadKey(quad: Quad, blankLabels: ReadonlyMap<string, string>): string {
  return JSON.stringify([
    expandedTermKey(quad.subject, blankLabels),
    expandedTermKey(quad.predicate, blankLabels),
    expandedTermKey(quad.object, blankLabels),
  ]);
}

function expandedTermKey(term: Term, blankLabels: ReadonlyMap<string, string>): unknown {
  switch (term.termType) {
    case "NamedNode": return ["NamedNode", term.value];
    case "BlankNode": return ["BlankNode", blankLabels.get(term.value) ?? term.value];
    case "Literal": return [
      "Literal",
      term.value,
      term.language.toLowerCase(),
      term.datatype.value,
    ];
    case "DefaultGraph": return ["DefaultGraph"];
    case "Variable": return ["Variable", term.value];
  }
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

function serializeQuad(
  quad: Quad,
  blankLabels: ReadonlyMap<string, string>,
  prefixes: readonly PrefixBinding[],
  usedPrefixes: Set<string>,
): string {
  const predicate = quad.predicate.value === RDF_TYPE
    ? "a"
    : serializeTerm(quad.predicate, blankLabels, prefixes, usedPrefixes);
  return `${serializeTerm(quad.subject, blankLabels, prefixes, usedPrefixes)} ${predicate} ${serializeTerm(quad.object, blankLabels, prefixes, usedPrefixes)} .`;
}

function serializeTerm(
  term: Term,
  blankLabels: ReadonlyMap<string, string>,
  prefixes: readonly PrefixBinding[] = [],
  usedPrefixes: Set<string> = new Set(),
): string {
  switch (term.termType) {
    case "NamedNode":
      return compactIri(term.value, prefixes, usedPrefixes);
    case "BlankNode":
      return `_:${blankLabels.get(term.value) ?? term.value}`;
    case "Literal": {
      const value = `"${escapeLiteral(term.value)}"`;
      return term.language
        ? `${value}@${term.language.toLowerCase()}`
        : `${value}^^${compactIri(term.datatype.value, prefixes, usedPrefixes)}`;
    }
    case "DefaultGraph":
      return "";
    case "Variable":
      throw new Error("Variables cannot be serialized as Turtle terms.");
  }
}

function compactIri(
  iri: string,
  prefixes: readonly PrefixBinding[],
  usedPrefixes: Set<string>,
): string {
  const standard = prefixes.find((binding) => (
    binding.source === "standard" && iri.startsWith(binding.namespace)
  ));
  const standardToken = standard ? compactToken(iri, standard) : undefined;
  if (standard && standardToken !== undefined) {
    usedPrefixes.add(standard.prefix);
    return standardToken;
  }

  const defaultBinding = prefixes.find((binding) => binding.source === "default");
  const defaultToken = defaultBinding ? compactToken(iri, defaultBinding) : undefined;
  if (defaultBinding && defaultToken !== undefined) {
    usedPrefixes.add(defaultBinding.prefix);
    return defaultToken;
  }

  const candidates = prefixes
    .filter((binding) => binding.source === "input")
    .flatMap((binding) => {
      const token = compactToken(iri, binding);
      return token === undefined ? [] : [{ binding, token }];
    })
    .sort((left, right) => (
      left.token.length - right.token.length
      || right.binding.namespace.length - left.binding.namespace.length
      || compareCodePoints(left.binding.prefix, right.binding.prefix)
      || compareCodePoints(left.binding.namespace, right.binding.namespace)
    ));
  const selected = candidates[0];
  if (!selected) return serializeIri(iri);
  usedPrefixes.add(selected.binding.prefix);
  return selected.token;
}

function compactToken(iri: string, binding: PrefixBinding): string | undefined {
  if (!iri.startsWith(binding.namespace)) return undefined;
  const local = compactLocalName(iri.slice(binding.namespace.length));
  return local === undefined ? undefined : `${binding.prefix}:${local}`;
}

function compactLocalName(value: string): string | undefined {
  if (value === "") return "";
  const characters = [...value];
  let result = "";
  for (let index = 0; index < characters.length; index += 1) {
    const character = characters[index]!;
    if (
      character === "%"
      && /^[0-9A-Fa-f]$/u.test(characters[index + 1] ?? "")
      && /^[0-9A-Fa-f]$/u.test(characters[index + 2] ?? "")
    ) {
      result += `${character}${characters[index + 1]}${characters[index + 2]}`;
      index += 2;
      continue;
    }
    const codePoint = character.codePointAt(0)!;
    const first = index === 0;
    const last = index === characters.length - 1;
    const unescaped = first
      ? isPnCharsU(codePoint) || isAsciiDigit(codePoint) || character === ":"
      : isPnChars(codePoint) || character === ":" || (character === "." && !last);
    if (unescaped) {
      result += character;
      continue;
    }
    if (PN_LOCAL_ESCAPABLE.has(character)) {
      result += `\\${character}`;
      continue;
    }
    return undefined;
  }
  return result;
}

const PN_LOCAL_ESCAPABLE = new Set([
  "_", "~", ".", "-", "!", "$", "&", "'", "(", ")", "*", "+", ",", ";", "=", "/", "?", "#", "@", "%",
]);

function validPrefixName(value: string): boolean {
  if (value === "") return true;
  const characters = [...value];
  return characters.every((character, index) => {
    const codePoint = character.codePointAt(0)!;
    if (index === 0) return isPnCharsBase(codePoint);
    if (index === characters.length - 1) return isPnChars(codePoint);
    return isPnChars(codePoint) || character === ".";
  });
}

function isPnChars(codePoint: number): boolean {
  return isPnCharsU(codePoint)
    || isAsciiDigit(codePoint)
    || codePoint === 0x2d
    || codePoint === 0xb7
    || (codePoint >= 0x0300 && codePoint <= 0x036f)
    || (codePoint >= 0x203f && codePoint <= 0x2040);
}

function isPnCharsU(codePoint: number): boolean {
  return codePoint === 0x5f || isPnCharsBase(codePoint);
}

function isPnCharsBase(codePoint: number): boolean {
  return (codePoint >= 0x41 && codePoint <= 0x5a)
    || (codePoint >= 0x61 && codePoint <= 0x7a)
    || (codePoint >= 0x00c0 && codePoint <= 0x00d6)
    || (codePoint >= 0x00d8 && codePoint <= 0x00f6)
    || (codePoint >= 0x00f8 && codePoint <= 0x02ff)
    || (codePoint >= 0x0370 && codePoint <= 0x037d)
    || (codePoint >= 0x037f && codePoint <= 0x1fff)
    || (codePoint >= 0x200c && codePoint <= 0x200d)
    || (codePoint >= 0x2070 && codePoint <= 0x218f)
    || (codePoint >= 0x2c00 && codePoint <= 0x2fef)
    || (codePoint >= 0x3001 && codePoint <= 0xd7ff)
    || (codePoint >= 0xf900 && codePoint <= 0xfdcf)
    || (codePoint >= 0xfdf0 && codePoint <= 0xfffd)
    || (codePoint >= 0x10000 && codePoint <= 0xeffff);
}

function isAsciiDigit(codePoint: number): boolean {
  return codePoint >= 0x30 && codePoint <= 0x39;
}

function isAbsoluteIri(value: string): boolean {
  return /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(value);
}

function comparePrefixDeclarations(left: PrefixBinding, right: PrefixBinding): number {
  return prefixDeclarationRank(left.prefix) - prefixDeclarationRank(right.prefix)
    || compareCodePoints(left.prefix, right.prefix)
    || compareCodePoints(left.namespace, right.namespace);
}

function prefixDeclarationRank(prefix: string): number {
  if (prefix === "") return 0;
  const standard = ["rdf", "rdfs", "xsd"].indexOf(prefix);
  return standard >= 0 ? standard + 1 : 4;
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
