import type { Quad, Store, Term } from "n3";

import type {
  AuthoringActor,
  AuthoringCapabilityStatement,
  AuthoringLiteralValue,
  AuthoringObjectKind,
  AuthoringTermRole,
  ResolvedAuthoringContext,
  ResolvedAuthoringTerm,
} from "./authoring-model.js";
import { statementIdentityFromQuad } from "./identity.js";
import type { IriographDocument, ProjectionDiagnostic } from "./model.js";
import { canonicalQuad, compareCodePoints, isNamedNode } from "./rdf.js";

export const RDF_NAMESPACE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
export const RDFS_NAMESPACE = "http://www.w3.org/2000/01/rdf-schema#";
export const XSD_NAMESPACE = "http://www.w3.org/2001/XMLSchema#";

export const RDF_TYPE = `${RDF_NAMESPACE}type`;
export const RDF_BAG = `${RDF_NAMESPACE}Bag`;
export const RDF_SEQ = `${RDF_NAMESPACE}Seq`;
export const RDF_ALT = `${RDF_NAMESPACE}Alt`;
export const RDF_PROPERTY = `${RDF_NAMESPACE}Property`;
export const RDF_STATEMENT = `${RDF_NAMESPACE}Statement`;
export const RDF_SUBJECT = `${RDF_NAMESPACE}subject`;
export const RDF_PREDICATE = `${RDF_NAMESPACE}predicate`;
export const RDF_OBJECT = `${RDF_NAMESPACE}object`;
export const RDF_ORDINAL_PREFIX = `${RDF_NAMESPACE}_`;
export const RDFS_CLASS = `${RDFS_NAMESPACE}Class`;
export const RDFS_LABEL = `${RDFS_NAMESPACE}label`;
export const RDFS_COMMENT = `${RDFS_NAMESPACE}comment`;
export const RDFS_MEMBER = `${RDFS_NAMESPACE}member`;
export const XSD_STRING = `${XSD_NAMESPACE}string`;

const STANDARD_TERM_ROLES = new Map<string, readonly AuthoringTermRole[]>([
  [RDF_TYPE, ["predicate"]],
  [RDF_BAG, ["type-object"]],
  [RDF_SEQ, ["type-object"]],
  [RDF_ALT, ["type-object"]],
  [RDF_PROPERTY, ["type-object"]],
  [RDF_STATEMENT, ["type-object"]],
  [RDF_SUBJECT, ["predicate"]],
  [RDF_PREDICATE, ["predicate"]],
  [RDF_OBJECT, ["predicate"]],
  [RDFS_CLASS, ["type-object"]],
  [RDFS_LABEL, ["predicate"]],
  [RDFS_COMMENT, ["predicate"]],
  [RDFS_MEMBER, ["predicate"]],
  [`${RDFS_NAMESPACE}subClassOf`, ["predicate"]],
  [`${RDFS_NAMESPACE}subPropertyOf`, ["predicate"]],
  [`${RDFS_NAMESPACE}domain`, ["predicate"]],
  [`${RDFS_NAMESPACE}range`, ["predicate"]],
  [`${RDFS_NAMESPACE}seeAlso`, ["predicate"]],
  [`${RDFS_NAMESPACE}isDefinedBy`, ["predicate"]],
]);

export type AuthoringTouchedProperty = {
  subjectIri: string;
  predicateIri: string;
};

export type AuthoringGraphPolicyOptions = {
  actor?: AuthoringActor;
  touchedProperties?: readonly AuthoringTouchedProperty[];
};

export function validateResolvedAuthoringContext(
  document: IriographDocument,
  context: ResolvedAuthoringContext,
): ProjectionDiagnostic[] {
  const diagnostics: ProjectionDiagnostic[] = [];
  if (!hasAuthoringContextShape(context)) {
    return [error(
      "authoring-context-invalid",
      "Resolved authoring context is missing required top-level collections or policy objects.",
    )];
  }
  if (!document.semantic.authoringProfileRef) {
    diagnostics.push(error(
      "authoring-profile-unresolved",
      "The document has no resolved authoring profile reference.",
    ));
  } else if (
    document.semantic.authoringProfileRef !== context.authoringProfileRef
  ) {
    diagnostics.push(error(
      "authoring-profile-mismatch",
      `Resolved authoring context does not match ${document.semantic.authoringProfileRef}.`,
    ));
  }
  for (const [field, value] of [
    ["contextId", context.contextId],
    ["contextRevision", context.contextRevision],
    ["documentRevision", context.documentRevision],
  ] as const) {
    if (!value) diagnostics.push(error("authoring-context-invalid", `${field} is required.`));
  }
  if (
    context.termPolicy.llmUnknown !== "reject"
    || context.termPolicy.llmMinting !== "deny"
    || !["preserve", "reject"].includes(context.termPolicy.existingUnknown)
    || !["allow", "warn", "reject"].includes(context.termPolicy.humanUnknown)
    || !["allow", "warn", "deny"].includes(context.termPolicy.humanMinting)
  ) {
    diagnostics.push(error(
      "authoring-context-invalid",
      "LLM unknown-term and minting policies cannot be relaxed.",
    ));
  }

  const terms = new Set<string>();
  for (const term of context.terms) {
    if (!isAbsoluteIri(term.iri)) {
      diagnostics.push(error("authoring-context-invalid", `Term is not an absolute IRI: ${term.iri}`));
    }
    if (terms.has(term.iri)) {
      diagnostics.push(error("authoring-context-invalid", `Duplicate authoring term: ${term.iri}`));
    }
    terms.add(term.iri);
    for (const [field, value] of [
      ["label", term.label],
      ["description", term.description],
      ["category", term.category],
      ["sentencePattern", term.sentencePattern],
    ] as const) {
      if (value !== undefined && (typeof value !== "string" || value.trim().length === 0)) {
        diagnostics.push(error(
          "authoring-context-invalid",
          `${field} must be a non-empty string for ${term.iri}.`,
        ));
      }
    }
    if (
      term.sentencePattern !== undefined
      && (!term.sentencePattern.includes("A") || !term.sentencePattern.includes("B"))
    ) {
      diagnostics.push(error(
        "authoring-context-invalid",
        `sentencePattern must contain A and B placeholders for ${term.iri}.`,
      ));
    }
    if (
      term.examples !== undefined
      && (
        !Array.isArray(term.examples)
        || term.examples.length === 0
        || term.examples.some((value) => typeof value !== "string" || value.trim().length === 0)
      )
    ) {
      diagnostics.push(error(
        "authoring-context-invalid",
        `examples must contain non-empty strings for ${term.iri}.`,
      ));
    }
    const standardRoles = STANDARD_TERM_ROLES.get(term.iri)
      ?? (isOrdinalPredicate(term.iri) ? ["predicate" as const] : undefined);
    const resolvedRoles = authoringTermRolesFromResolved(term);
    if (
      standardRoles
      && (
        standardRoles.length !== resolvedRoles.length
        || !standardRoles.every((role) => resolvedRoles.includes(role))
      )
    ) {
      diagnostics.push(error(
        "authoring-context-invalid",
        `Authoring constraints redefine a standard term with an incompatible role: ${term.iri}`,
      ));
    }
    diagnostics.push(...validateResolvedTerm(term));
    if (
      term.minCount !== undefined
      && (!Number.isSafeInteger(term.minCount) || term.minCount < 0)
    ) {
      diagnostics.push(error("authoring-context-invalid", `Invalid minCount for ${term.iri}.`));
    }
    if (
      term.maxCount !== undefined
      && (!Number.isSafeInteger(term.maxCount) || term.maxCount < 0)
    ) {
      diagnostics.push(error("authoring-context-invalid", `Invalid maxCount for ${term.iri}.`));
    }
    if (
      term.minCount !== undefined
      && term.maxCount !== undefined
      && term.minCount > term.maxCount
    ) {
      diagnostics.push(error("authoring-context-invalid", `minCount exceeds maxCount for ${term.iri}.`));
    }
  }

  const capabilityIds = new Set<string>();
  for (const capability of context.capabilities) {
    if (!capability.capabilityId || capabilityIds.has(capability.capabilityId)) {
      diagnostics.push(error(
        "authoring-context-invalid",
        `Duplicate or empty capability ID: ${capability.capabilityId}`,
      ));
    }
    capabilityIds.add(capability.capabilityId);
    const parameters = new Set<string>();
    for (const parameter of capability.parameters) {
      const objectKinds = Array.isArray(parameter.objectKinds) ? parameter.objectKinds : [];
      if (
        !parameter.name
        || parameters.has(parameter.name)
        || objectKinds.length === 0
        || new Set(objectKinds).size !== objectKinds.length
        || objectKinds.some((kind) => kind !== "iri" && kind !== "literal")
        || (parameter.required !== undefined && typeof parameter.required !== "boolean")
      ) {
        diagnostics.push(error(
          "authoring-context-invalid",
          `Invalid capability parameter in ${capability.capabilityId}: ${parameter.name}`,
        ));
      }
      parameters.add(parameter.name);
    }
    diagnostics.push(...validateCapability(capability, parameters, context));
  }

  const namespaces = new Set<string>();
  for (const namespace of context.resourcePolicy.allowedMintNamespaces) {
    if (!isAbsoluteIri(namespace) || namespaces.has(namespace)) {
      diagnostics.push(error(
        "authoring-context-invalid",
        `Resource namespace is duplicate or not an absolute IRI: ${namespace}`,
      ));
    }
    namespaces.add(namespace);
  }
  return diagnostics;
}

export function validateAuthoringGraphPolicy(
  originalQuads: readonly Quad[],
  candidateStore: Store,
  context: ResolvedAuthoringContext,
  options: AuthoringGraphPolicyOptions = {},
): ProjectionDiagnostic[] {
  const diagnostics: ProjectionDiagnostic[] = [];
  const originalByKey = new Map(originalQuads.map((quad) => [canonicalQuad(quad), quad]));
  const candidateQuads = candidateStore.getQuads(null, null, null, null);
  const candidateByKey = new Map(candidateQuads.map((quad) => [canonicalQuad(quad), quad]));
  const added = candidateQuads.filter((quad) => !originalByKey.has(canonicalQuad(quad)));
  const changed = [
    ...added,
    ...originalQuads.filter((quad) => !candidateByKey.has(canonicalQuad(quad))),
  ];
  const termIndex = new Map(context.terms.map((term) => [term.iri, term]));
  const actor = options.actor ?? "human";

  if (context.termPolicy.existingUnknown === "reject") {
    for (const term of graphTerms(originalQuads)) {
      if (!isKnownAuthoringTerm(term, context)) {
        diagnostics.push(error(
          "existing-unknown-term-rejected",
          `The existing graph contains an unknown term: ${term}`,
          term,
        ));
      }
    }
  }

  const touchedTerms = new Set<string>();
  for (const quad of added) {
    for (const term of semanticVocabularyTerms(quad)) touchedTerms.add(term);
  }
  for (const term of [...touchedTerms].sort(compareCodePoints)) {
    if (isKnownAuthoringTerm(term, context)) continue;
    const policy = actor === "llm"
      ? context.termPolicy.llmUnknown
      : context.termPolicy.humanUnknown;
    const severity = policy === "warn" ? "warning" : "error";
    if (policy === "allow") continue;
    diagnostics.push({
      severity,
      code: "unknown-term-introduced",
      message: `${actor} authoring uses an unknown term: ${term}`,
      semanticRef: term,
    });
  }

  for (const value of added) {
    const predicateRoles = authoringTermRoles(value.predicate.value, context);
    if (predicateRoles && !predicateRoles.includes("predicate")) {
      diagnostics.push(statementDiagnostic(
        "authoring-term-role-invalid",
        `Known term cannot be used as a predicate: ${value.predicate.value}`,
        value,
      ));
    }
    if (value.predicate.value === RDF_TYPE && isNamedNode(value.object)) {
      const objectRoles = authoringTermRoles(value.object.value, context);
      if (objectRoles && !objectRoles.includes("type-object")) {
        diagnostics.push(statementDiagnostic(
          "authoring-term-role-invalid",
          `Known term cannot be used as an rdf:type object: ${value.object.value}`,
          value,
        ));
      }
    }
  }

  const originalNamedTerms = allNamedTerms(originalQuads);
  for (const quad of added) {
    for (const term of [quad.subject, quad.object]) {
      if (!isNamedNode(term)) continue;
      if (isVocabularyTermPosition(quad, term)) continue;
      if (originalNamedTerms.has(term.value) || isKnownAuthoringTerm(term.value, context)) continue;
      if (!isAllowedResourceIri(term.value, context)) {
        diagnostics.push(error(
          "resource-namespace-denied",
          `New resource is outside the allowed namespaces: ${term.value}`,
          term.value,
        ));
      }
    }
  }

  const declaredTerms = new Set(originalQuads
    .filter((quad) => (
      quad.predicate.value === RDF_TYPE
      && isNamedNode(quad.subject)
      && isNamedNode(quad.object)
      && (quad.object.value === RDFS_CLASS || quad.object.value === RDF_PROPERTY)
    ))
    .map((quad) => quad.subject.value));
  for (const quad of added) {
    if (
      quad.predicate.value !== RDF_TYPE
      || !isNamedNode(quad.subject)
      || !isNamedNode(quad.object)
      || (quad.object.value !== RDFS_CLASS && quad.object.value !== RDF_PROPERTY)
      || declaredTerms.has(quad.subject.value)
    ) continue;
    const mintingPolicy = actor === "llm"
      ? context.termPolicy.llmMinting
      : context.termPolicy.humanMinting;
    if (mintingPolicy === "deny") {
      diagnostics.push({
        ...error(
          "term-minting-denied",
          `Semantic term minting is denied: ${quad.subject.value}`,
          quad.subject.value,
        ),
        suggestedActions: [{
          actionId: "choose-existing-profile-term",
          semanticRef: quad.subject.value,
          parameters: { requestedTermIri: quad.subject.value },
        }],
      });
    } else if (mintingPolicy === "warn") {
      diagnostics.push({
        severity: "warning",
        code: "term-minting-warning",
        message: `Semantic term minting requires confirmation: ${quad.subject.value}`,
        semanticRef: quad.subject.value,
      });
    }
  }

  const touchedProperties = new Map<string, { subjectIri: string; predicateIri: string }>();
  for (const quad of changed) {
    if (!isNamedNode(quad.subject)) continue;
    const key = `${quad.subject.value}\n${quad.predicate.value}`;
    touchedProperties.set(key, {
      subjectIri: quad.subject.value,
      predicateIri: quad.predicate.value,
    });
  }
  for (const pair of options.touchedProperties ?? []) {
    touchedProperties.set(`${pair.subjectIri}\n${pair.predicateIri}`, { ...pair });
  }
  for (const pair of [...touchedProperties.values()].sort((left, right) => (
    compareCodePoints(left.subjectIri, right.subjectIri)
    || compareCodePoints(left.predicateIri, right.predicateIri)
  ))) {
    if (candidateStore.countQuads(pair.subjectIri, null, null, null) === 0) continue;
    const term = termIndex.get(pair.predicateIri);
    if (!term || term.kind !== "property") continue;
    diagnostics.push(...validatePropertyValues(candidateStore, pair.subjectIri, term));
  }
  return diagnostics;
}

function hasAuthoringContextShape(context: unknown): context is ResolvedAuthoringContext {
  if (!isRecord(context)) return false;
  const value = context as Record<string, unknown>;
  const termPolicy = value.termPolicy;
  const resourcePolicy = value.resourcePolicy;
  const runtime = value.runtime;
  return Boolean(
    isRecord(termPolicy)
    && isRecord(resourcePolicy)
    && Array.isArray((resourcePolicy as Record<string, unknown>).allowedMintNamespaces)
    && Array.isArray(value.terms)
    && value.terms.every(isRecord)
    && Array.isArray(value.capabilities)
    && value.capabilities.every(hasCapabilityShape)
    && isRecord(runtime)
    && runtime.catalogsByProfile instanceof Map
    && [...runtime.catalogsByProfile.values()].every((profile) => (
      isRecord(profile) && isRecord(profile.catalog) && Array.isArray(profile.catalog.rules)
    ))
    && isRecord(runtime.layouts)
    && typeof runtime.layouts.resolve === "function",
  );
}

function hasCapabilityShape(value: unknown): boolean {
  if (!isRecord(value) || !Array.isArray(value.parameters) || !isRecord(value.graphPatch)) return false;
  if (!value.parameters.every((parameter) => (
    isRecord(parameter) && Array.isArray(parameter.objectKinds)
  ))) return false;
  for (const direction of ["add", "remove"] as const) {
    const statements = value.graphPatch[direction];
    if (statements === undefined) continue;
    if (!Array.isArray(statements) || !statements.every((statement) => (
      isRecord(statement)
      && isRecord(statement.subject)
      && isRecord(statement.predicate)
      && isRecord(statement.object)
    ))) return false;
  }
  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isVocabularyTermPosition(quad: Quad, term: Term): boolean {
  if (quad.predicate.value === RDF_TYPE && isNamedNode(quad.object)) {
    if (term === quad.object) return true;
    if (
      term === quad.subject
      && (quad.object.value === RDFS_CLASS || quad.object.value === RDF_PROPERTY)
    ) return true;
  }
  return new Set([
    `${RDFS_NAMESPACE}subClassOf`,
    `${RDFS_NAMESPACE}subPropertyOf`,
    `${RDFS_NAMESPACE}domain`,
    `${RDFS_NAMESPACE}range`,
  ]).has(quad.predicate.value);
}

export function validateLiteralInput(
  value: AuthoringLiteralValue,
  semanticRef?: string,
): ProjectionDiagnostic[] {
  const diagnostics: ProjectionDiagnostic[] = [];
  if (value.language !== undefined && value.datatypeIri !== undefined) {
    diagnostics.push(error(
      "literal-language-datatype-conflict",
      "A literal cannot specify both language and datatype.",
      semanticRef,
    ));
  }
  if (value.language !== undefined && !isLanguageTag(value.language)) {
    diagnostics.push(error(
      "literal-language-invalid",
      `Invalid BCP 47 language tag: ${value.language}`,
      semanticRef,
    ));
  }
  if (value.datatypeIri !== undefined && !isAbsoluteIri(value.datatypeIri)) {
    diagnostics.push(error(
      "literal-datatype-invalid",
      `Literal datatype is not an absolute IRI: ${value.datatypeIri}`,
      semanticRef,
    ));
  }
  return diagnostics;
}

export function validateAuthoringProperty(
  store: Store,
  subjectIri: string,
  predicateIri: string,
  context: ResolvedAuthoringContext,
): ProjectionDiagnostic[] {
  const term = context.terms.find((candidate) => candidate.iri === predicateIri);
  return term?.kind === "property"
    ? validatePropertyValues(store, subjectIri, term)
    : [];
}

export function isKnownAuthoringTerm(
  iri: string,
  context: ResolvedAuthoringContext,
): boolean {
  return STANDARD_TERM_ROLES.has(iri)
    || isOrdinalPredicate(iri)
    || isResolvedOrdinalPredicate(iri, context)
    || context.terms.some((term) => term.iri === iri);
}

export function authoringTermRoles(
  iri: string,
  context: ResolvedAuthoringContext,
): readonly AuthoringTermRole[] | undefined {
  const standard = STANDARD_TERM_ROLES.get(iri);
  if (standard) return standard;
  if (isOrdinalPredicate(iri) || isResolvedOrdinalPredicate(iri, context)) return ["predicate"];
  const term = context.terms.find((candidate) => candidate.iri === iri);
  if (!term) return undefined;
  if (term.roles) return term.roles;
  if (term.kind === "class") return ["type-object"];
  if (term.kind === "property") return ["predicate"];
  return undefined;
}

export function isProtectedVocabularyResource(
  iri: string,
  context: ResolvedAuthoringContext,
): boolean {
  return isKnownAuthoringTerm(iri, context);
}

export function isAllowedResourceIri(
  iri: string,
  context: ResolvedAuthoringContext,
): boolean {
  return isAbsoluteIri(iri)
    && context.resourcePolicy.allowedMintNamespaces.some((namespace) => iri.startsWith(namespace));
}

export function isAbsoluteIri(value: string): boolean {
  return typeof value === "string" && /^[A-Za-z][A-Za-z0-9+.-]*:[^\s<>]*$/u.test(value);
}

export function isOrdinalPredicate(value: string): boolean {
  return value.startsWith(RDF_ORDINAL_PREFIX)
    && /^[1-9][0-9]*$/u.test(value.slice(RDF_ORDINAL_PREFIX.length));
}

function validatePropertyValues(
  store: Store,
  subjectIri: string,
  term: ResolvedAuthoringTerm,
): ProjectionDiagnostic[] {
  const diagnostics: ProjectionDiagnostic[] = [];
  const objects = store.getObjects(subjectIri, term.iri, null);
  if (term.minCount !== undefined && objects.length < term.minCount) {
    diagnostics.push(error(
      "property-min-count",
      `${term.iri} requires at least ${term.minCount} value(s).`,
      subjectIri,
    ));
  }
  if (term.maxCount !== undefined && objects.length > term.maxCount) {
    diagnostics.push(error(
      "property-max-count",
      `${term.iri} allows at most ${term.maxCount} value(s).`,
      subjectIri,
    ));
  }
  for (const object of objects) {
    const objectKind: AuthoringObjectKind | undefined = object.termType === "Literal"
      ? "literal"
      : object.termType === "NamedNode"
        ? "iri"
        : undefined;
    if (term.objectKinds?.length && (!objectKind || !term.objectKinds.includes(objectKind))) {
      diagnostics.push(error(
        "property-object-kind",
        `${term.iri} does not allow ${objectKind ?? "blank-node"} values.`,
        subjectIri,
      ));
      continue;
    }
    if (object.termType !== "Literal") continue;
    if (term.datatypes?.length && !term.datatypes.includes(object.datatype.value)) {
      diagnostics.push(error(
        "property-datatype",
        `${term.iri} does not allow datatype ${object.datatype.value}.`,
        subjectIri,
      ));
    }
    if (term.languages?.length) {
      const allowed = term.languages.map((language) => language.toLowerCase());
      if (!object.language || !allowed.includes(object.language.toLowerCase())) {
        diagnostics.push(error(
          "property-language",
          `${term.iri} does not allow language ${object.language || "(none)"}.`,
          subjectIri,
        ));
      }
    }
  }
  return diagnostics;
}

function validateResolvedTerm(term: ResolvedAuthoringTerm): ProjectionDiagnostic[] {
  const diagnostics: ProjectionDiagnostic[] = [];
  const roles = Array.isArray(term.roles) ? term.roles : [];
  if (
    (term.roles !== undefined && !Array.isArray(term.roles))
    ||
    (term.kind !== "class" && term.kind !== "property" && term.kind !== "structure")
    || roles.some((role) => role !== "predicate" && role !== "type-object")
  ) {
    diagnostics.push(error("authoring-context-invalid", `Invalid kind or role for ${term.iri}.`));
  }
  if (new Set(roles).size !== roles.length) {
    diagnostics.push(error("authoring-context-invalid", `Duplicate roles for ${term.iri}.`));
  }
  if (term.kind === "class" && roles.some((role) => role !== "type-object")) {
    diagnostics.push(error("authoring-context-invalid", `Class term has an invalid role: ${term.iri}`));
  }
  if (term.kind === "property" && roles.some((role) => role !== "predicate")) {
    diagnostics.push(error("authoring-context-invalid", `Property term has an invalid role: ${term.iri}`));
  }
  if (term.kind === "structure" && roles.length === 0) {
    diagnostics.push(error(
      "authoring-context-invalid",
      `Structure term requires an explicit RDF role: ${term.iri}`,
    ));
  }
  if (term.structural && !authoringTermRolesFromResolved(term).includes("predicate")) {
    diagnostics.push(error(
      "authoring-context-invalid",
      `Only a predicate-role term can be marked structural: ${term.iri}`,
    ));
  }
  if (
    term.kind !== "property"
    && !authoringTermRolesFromResolved(term).includes("predicate")
    && (
      term.objectKinds !== undefined
      || term.datatypes !== undefined
      || term.languages !== undefined
      || term.minCount !== undefined
      || term.maxCount !== undefined
    )
  ) {
    diagnostics.push(error(
      "authoring-context-invalid",
      `Object/cardinality constraints require a predicate-role term: ${term.iri}`,
    ));
  }
  const objectKinds = Array.isArray(term.objectKinds) ? term.objectKinds : [];
  if (term.objectKinds !== undefined && (
    !Array.isArray(term.objectKinds)
    || objectKinds.length === 0
    || new Set(objectKinds).size !== objectKinds.length
    || objectKinds.some((kind) => kind !== "iri" && kind !== "literal")
  )) {
    diagnostics.push(error("authoring-context-invalid", `Invalid objectKinds for ${term.iri}.`));
  }
  const datatypes = Array.isArray(term.datatypes) ? term.datatypes : [];
  if (term.datatypes !== undefined && (
    !Array.isArray(term.datatypes)
    || datatypes.length === 0
    || new Set(datatypes).size !== datatypes.length
    || datatypes.some((datatype) => !isAbsoluteIri(datatype))
  )) {
    diagnostics.push(error("authoring-context-invalid", `Invalid datatypes for ${term.iri}.`));
  }
  const languages = Array.isArray(term.languages) ? term.languages : [];
  if (term.languages !== undefined && (
    !Array.isArray(term.languages)
    || languages.length === 0
    || new Set(languages.map((language) => language.toLowerCase())).size !== languages.length
    || languages.some((language) => !isLanguageTag(language))
  )) {
    diagnostics.push(error("authoring-context-invalid", `Invalid languages for ${term.iri}.`));
  }
  if (
    (term.datatypes?.length || term.languages?.length)
    && term.objectKinds !== undefined
    && !objectKinds.includes("literal")
  ) {
    diagnostics.push(error(
      "authoring-context-invalid",
      `Literal constraints require literal objectKinds for ${term.iri}.`,
    ));
  }
  return diagnostics;
}

function authoringTermRolesFromResolved(term: ResolvedAuthoringTerm): readonly AuthoringTermRole[] {
  if (Array.isArray(term.roles)) return term.roles;
  if (term.kind === "class") return ["type-object"];
  if (term.kind === "property") return ["predicate"];
  return [];
}

function validateCapability(
  capability: ResolvedAuthoringContext["capabilities"][number],
  parameterNames: ReadonlySet<string>,
  context: ResolvedAuthoringContext,
): ProjectionDiagnostic[] {
  const diagnostics: ProjectionDiagnostic[] = [];
  const statements = [
    ...(capability.graphPatch.remove ?? []),
    ...(capability.graphPatch.add ?? []),
  ];
  if (statements.length === 0) {
    diagnostics.push(error(
      "authoring-context-invalid",
      `Capability graph patch is empty: ${capability.capabilityId}`,
    ));
  }
  const seen = new Set<string>();
  for (const statement of statements) {
    const key = JSON.stringify(statement);
    if (seen.has(key)) {
      diagnostics.push(error(
        "authoring-context-invalid",
        `Capability contains a duplicate statement template: ${capability.capabilityId}`,
      ));
    }
    seen.add(key);
    diagnostics.push(...validateCapabilityStatement(
      capability.capabilityId,
      statement,
      parameterNames,
      capability.parameters,
      context,
    ));
  }
  return diagnostics;
}

function validateCapabilityStatement(
  capabilityId: string,
  statement: AuthoringCapabilityStatement,
  parameterNames: ReadonlySet<string>,
  parameters: ResolvedAuthoringContext["capabilities"][number]["parameters"],
  context: ResolvedAuthoringContext,
): ProjectionDiagnostic[] {
  const diagnostics: ProjectionDiagnostic[] = [];
  for (const [position, term] of [
    ["subject", statement.subject],
    ["predicate", statement.predicate],
    ["object", statement.object],
  ] as const) {
    if (term.kind === "binding") {
      if (!parameterNames.has(term.name)) {
        diagnostics.push(error(
          "authoring-context-invalid",
          `Capability ${capabilityId} references undeclared binding ${term.name}.`,
        ));
      }
      if (
        position !== "object"
        && !parameters.find((parameter) => parameter.name === term.name)?.objectKinds.includes("iri")
      ) {
        diagnostics.push(error(
          "authoring-context-invalid",
          `Capability ${capabilityId} ${position} binding must accept IRI values: ${term.name}.`,
        ));
      }
      continue;
    }
    if (term.kind === "literal") {
      if (position !== "object") {
        diagnostics.push(error(
          "authoring-context-invalid",
          `Capability ${capabilityId} ${position} cannot be a literal.`,
        ));
      }
      diagnostics.push(...validateLiteralInput(term, capabilityId).map((diagnostic) => ({
        ...diagnostic,
        code: "authoring-context-invalid",
      })));
      continue;
    }
    if (!isAbsoluteIri(term.iri)) {
      diagnostics.push(error(
        "authoring-context-invalid",
        `Capability ${capabilityId} contains a non-absolute IRI: ${term.iri}`,
      ));
    }
  }
  if (statement.predicate.kind === "iri") {
    const roles = authoringTermRoles(statement.predicate.iri, context);
    if (!roles?.includes("predicate")) {
      diagnostics.push(error(
        "authoring-context-invalid",
        `Capability ${capabilityId} predicate is unresolved or has the wrong role: ${statement.predicate.iri}`,
      ));
    }
    if (
      statement.predicate.iri === RDF_TYPE
      && statement.object.kind === "iri"
      && !authoringTermRoles(statement.object.iri, context)?.includes("type-object")
    ) {
      diagnostics.push(error(
        "authoring-context-invalid",
        `Capability ${capabilityId} rdf:type object is unresolved or has the wrong role: ${statement.object.iri}`,
      ));
    }
  }
  return diagnostics;
}

function graphTerms(quads: readonly Quad[]): string[] {
  const terms = new Set<string>();
  for (const quad of quads) {
    for (const term of semanticVocabularyTerms(quad)) terms.add(term);
  }
  return [...terms].sort(compareCodePoints);
}

function semanticVocabularyTerms(quad: Quad): string[] {
  const terms = [quad.predicate.value];
  if (quad.predicate.value === RDF_TYPE && isNamedNode(quad.object)) {
    terms.push(quad.object.value);
    if (
      isNamedNode(quad.subject)
      && (quad.object.value === RDFS_CLASS || quad.object.value === RDF_PROPERTY)
    ) terms.push(quad.subject.value);
  }
  if (new Set([
    `${RDFS_NAMESPACE}subClassOf`,
    `${RDFS_NAMESPACE}subPropertyOf`,
    `${RDFS_NAMESPACE}domain`,
    `${RDFS_NAMESPACE}range`,
  ]).has(quad.predicate.value)) {
    if (isNamedNode(quad.subject)) terms.push(quad.subject.value);
    if (isNamedNode(quad.object)) terms.push(quad.object.value);
  }
  return terms;
}

function allNamedTerms(quads: readonly Quad[]): Set<string> {
  const result = new Set<string>();
  for (const quad of quads) {
    for (const term of [quad.subject, quad.predicate, quad.object]) {
      if (isNamedNode(term)) result.add(term.value);
      if (term.termType === "Literal") result.add(term.datatype.value);
    }
  }
  return result;
}

function isLanguageTag(value: string): boolean {
  return /^(?:[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*|x(?:-[A-Za-z0-9]{1,8})+)$/iu.test(value);
}

function isResolvedOrdinalPredicate(
  iri: string,
  context: ResolvedAuthoringContext,
): boolean {
  for (const profile of context.runtime.catalogsByProfile.values()) {
    for (const rule of profile.catalog.rules) {
      const operator = rule.project;
      if (operator.operator !== "ordinal-sequence" && operator.operator !== "alternative") continue;
      if (
        iri.startsWith(operator.ordinalPredicatePrefix)
        && /^[1-9][0-9]*$/u.test(iri.slice(operator.ordinalPredicatePrefix.length))
      ) return true;
    }
  }
  return false;
}

function error(
  code: string,
  message: string,
  semanticRef?: string,
): ProjectionDiagnostic {
  return { severity: "error", code, message, semanticRef };
}

export function statementDiagnostic(
  code: string,
  message: string,
  quad: Quad,
): ProjectionDiagnostic {
  return {
    severity: "error",
    code,
    message,
    semanticRef: isNamedNode(quad.subject) ? quad.subject.value : undefined,
    statementRef: statementIdentityFromQuad(quad),
  };
}

export function termKind(term: Term): AuthoringObjectKind | undefined {
  if (term.termType === "NamedNode") return "iri";
  if (term.termType === "Literal") return "literal";
  return undefined;
}
