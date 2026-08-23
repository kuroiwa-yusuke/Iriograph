import {
  compareCodePoints,
  parseSemanticGraph,
  type AuthoringCommand,
  type IriographDocument,
  type ResolvedAuthoringTerm,
} from "@iriograph/core";

import {
  emptyPropertyValueDraft,
  type EditorPropertyValueDraft,
} from "./authoring-draft";

const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const RDFS_LABEL = "http://www.w3.org/2000/01/rdf-schema#label";
const XSD_STRING = "http://www.w3.org/2001/XMLSchema#string";

export type ResourcePropertyEditorRow = {
  predicateIri: string;
  label: string;
  objectKinds: readonly ("iri" | "literal")[];
  datatypes: readonly string[];
  languages: readonly string[];
  values: EditorPropertyValueDraft[];
};

export function resourcePropertyEditorRows(
  document: IriographDocument,
  subjectIri: string,
  terms: readonly ResolvedAuthoringTerm[],
): ResourcePropertyEditorRow[] {
  const graph = parseSemanticGraph(document);
  const termByIri = new Map(terms.map((term) => [term.iri, term]));
  const predicates = new Set(terms
    .filter((term) => term.kind === "property" && !term.structural)
    .map((term) => term.iri));
  for (const quad of graph.store.getQuads(subjectIri, null, null, null)) {
    if (quad.predicate.value !== RDF_TYPE && !termByIri.get(quad.predicate.value)?.structural) {
      predicates.add(quad.predicate.value);
    }
  }
  return [...predicates].map((predicateIri): ResourcePropertyEditorRow => {
    const term = termByIri.get(predicateIri);
    const values = graph.store.getObjects(subjectIri, predicateIri, null).map((object) => {
      if (object.termType === "NamedNode") {
        return { ...emptyPropertyValueDraft("iri"), value: object.value };
      }
      if (object.termType === "Literal") {
        return {
          objectKind: "literal" as const,
          value: object.value,
          language: object.language,
          datatypeIri: object.language || object.datatype.value === XSD_STRING
            ? ""
            : object.datatype.value,
        };
      }
      return undefined;
    }).filter((value): value is EditorPropertyValueDraft => value !== undefined);
    const objectKinds = term?.objectKinds ?? inferredKinds(values);
    return {
      predicateIri,
      label: term?.label ?? compactIri(predicateIri),
      objectKinds,
      datatypes: term?.datatypes ?? [],
      languages: term?.languages ?? [],
      values,
    };
  }).sort((left, right) => (
    (left.predicateIri === RDFS_LABEL ? -1 : 0)
    - (right.predicateIri === RDFS_LABEL ? -1 : 0)
    || compareCodePoints(left.label, right.label)
    || compareCodePoints(left.predicateIri, right.predicateIri)
  ));
}

export function resourcePropertyCommands(
  subjectIri: string,
  original: readonly ResourcePropertyEditorRow[],
  current: readonly ResourcePropertyEditorRow[],
): AuthoringCommand[] {
  const originalByPredicate = new Map(original.map((row) => [row.predicateIri, row]));
  return current.filter((row) => (
    propertyValuesIdentity(row.values)
    !== propertyValuesIdentity(originalByPredicate.get(row.predicateIri)?.values ?? [])
  )).map((row, index): AuthoringCommand => ({
    type: "set-property",
    commandId: `editor-details-${index + 1}`,
    subjectIri,
    predicateIri: row.predicateIri,
    values: row.values.map((value) => value.objectKind === "iri"
      ? { kind: "iri", iri: value.value.trim() }
      : {
          kind: "literal",
          value: value.value,
          ...(value.language.trim() ? { language: value.language.trim() } : {}),
          ...(value.datatypeIri.trim() ? { datatypeIri: value.datatypeIri.trim() } : {}),
        }),
  }));
}

function inferredKinds(values: readonly EditorPropertyValueDraft[]): readonly ("iri" | "literal")[] {
  const kinds = [...new Set(values.map((value) => value.objectKind))];
  return kinds.length > 0 ? kinds : ["literal", "iri"];
}

function propertyValuesIdentity(values: readonly EditorPropertyValueDraft[]): string {
  return JSON.stringify(values.map((value) => ({
    ...value,
    value: value.objectKind === "iri" ? value.value.trim() : value.value,
    datatypeIri: value.datatypeIri.trim(),
    language: value.language.trim().toLowerCase(),
  })).sort((left, right) => compareCodePoints(JSON.stringify(left), JSON.stringify(right))));
}

function compactIri(value: string): string {
  return value.slice(Math.max(value.lastIndexOf("#"), value.lastIndexOf("/"), value.lastIndexOf(":")) + 1) || value;
}
