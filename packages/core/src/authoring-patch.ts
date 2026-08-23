import {
  DataFactory,
  Parser,
  Store,
  type Literal,
  type NamedNode,
  type Quad,
  type Term,
} from "n3";

import type {
  ApplyCapabilityCommand,
  AuthoringCapabilityTerm,
  AuthoringCommand,
  AuthoringGraphPatch,
  AuthoringObjectValue,
  AuthoringTriple,
  AuthoringTripleChange,
  CreateResourceCommand,
  PreviewAuthoringOptions,
  ResolvedAuthoringCommand,
  ResolvedAuthoringContext,
  ResolvedCreateResourceCommand,
} from "./authoring-model";
import { statementIdentityFromQuad } from "./identity";
import type { IriographDocument, ProjectionDiagnostic, ProjectionOperator } from "./model";
import {
  canonicalQuad,
  compareCodePoints,
  isNamedNode,
  namedObjects,
  semanticGraphFromQuads,
} from "./rdf";
import { buildLimitedRdfsClosure } from "./rdfs-closure";
import { resolveResourceRule } from "./rule-resolution";
import { rdfRdfsVocabulary } from "./standard-catalog";
import {
  isAbsoluteIri,
  isAllowedResourceIri,
  isKnownAuthoringTerm,
  isOrdinalPredicate,
  isProtectedVocabularyResource,
  RDF_TYPE,
  RDFS_MEMBER,
  validateAuthoringGraphPolicy,
  validateLiteralInput,
  validateResolvedAuthoringContext,
} from "./authoring-validation";

const { namedNode, literal, quad } = DataFactory;

export type AuthoringPositionApplication = {
  resourceIri: string;
  position: import("./authoring-model").AuthoringInitialPosition;
};

export type AuthoringCompilation = {
  document: IriographDocument;
  commands: ResolvedAuthoringCommand[];
  quads: readonly Quad[];
  prefixes: Readonly<Record<string, string>>;
  patch: AuthoringGraphPatch;
  positions: AuthoringPositionApplication[];
  diagnostics: ProjectionDiagnostic[];
};

export async function compileAuthoringCommands(
  document: IriographDocument,
  commands: readonly AuthoringCommand[],
  context: ResolvedAuthoringContext,
  options: PreviewAuthoringOptions = {},
): Promise<AuthoringCompilation> {
  const diagnostics = validateResolvedAuthoringContext(document, context);
  const parsed = parseSource(document);
  diagnostics.push(...parsed.diagnostics);
  const originalQuads = parsed.quads;
  const store = new Store(originalQuads);
  const resolvedCommands: ResolvedAuthoringCommand[] = [];
  const positions: AuthoringPositionApplication[] = [];
  const touchedProperties = new Map<string, { subjectIri: string; predicateIri: string }>();

  if (commands.length === 0) {
    diagnostics.push(error("authoring-command-required", "At least one authoring command is required."));
  }
  const commandIds = new Set<string>();
  for (const command of commands) {
    if (!command.commandId || commandIds.has(command.commandId)) {
      diagnostics.push(error(
        "authoring-command-id-invalid",
        `Command ID must be non-empty and unique: ${command.commandId}`,
      ));
    }
    commandIds.add(command.commandId);
  }
  if (hasErrors(diagnostics)) {
    return compilation(document, resolvedCommands, originalQuads, parsed.prefixes, positions, diagnostics);
  }

  for (const command of commands) {
    if (options.signal?.aborted) {
      diagnostics.push(error("authoring-aborted", "Authoring preview was aborted."));
      break;
    }
    switch (command.type) {
      case "create-resource": {
        const resolved = await resolveCreateCommand(document, command, store, context, options, diagnostics);
        if (!resolved) break;
        resolvedCommands.push(resolved);
        applyCreateResource(store, resolved, context, positions, diagnostics);
        break;
      }
      case "set-property":
        resolvedCommands.push(clone(command));
        touchedProperties.set(`${command.subjectIri}\n${command.predicateIri}`, {
          subjectIri: command.subjectIri,
          predicateIri: command.predicateIri,
        });
        applySetProperty(store, command, context, diagnostics);
        break;
      case "connect-resources":
        resolvedCommands.push(clone(command));
        applyConnectResources(store, command, context, diagnostics);
        break;
      case "apply-capability":
        resolvedCommands.push(clone(command));
        applyCapability(store, command, context, diagnostics);
        break;
      case "set-membership":
        resolvedCommands.push(clone(command));
        applyMembership(store, command, context, diagnostics);
        break;
      case "set-sequence":
        resolvedCommands.push(clone(command));
        applySequence(store, command, context, diagnostics);
        break;
      case "set-alternatives":
        resolvedCommands.push(clone(command));
        applyAlternatives(store, command, context, diagnostics);
        break;
      case "delete-resource":
        resolvedCommands.push(clone(command));
        applyDeleteResource(store, command, context, diagnostics);
        break;
      case "remove-statement":
        resolvedCommands.push(clone(command));
        applyRemoveStatement(store, command, diagnostics);
        break;
    }
  }

  if (options.signal?.aborted) {
    diagnostics.push(error("authoring-aborted", "Authoring preview was aborted."));
  } else {
    diagnostics.push(...validateAuthoringGraphPolicy(originalQuads, store, context, {
      actor: "human",
      touchedProperties: [...touchedProperties.values()],
    }));
  }
  if (options.signal?.aborted && !diagnostics.some((item) => item.code === "authoring-aborted")) {
    diagnostics.push(error("authoring-aborted", "Authoring preview was aborted."));
  }
  const patch = graphPatch(originalQuads, store.getQuads(null, null, null, null));
  if (patch.added.length === 0 && patch.removed.length === 0 && !hasErrors(diagnostics)) {
    diagnostics.push(error("authoring-noop", "The authoring commands do not change the RDF dataset."));
  }
  return {
    document: clone(document),
    commands: resolvedCommands,
    quads: store.getQuads(null, null, null, null).sort(compareQuad),
    prefixes: parsed.prefixes,
    patch,
    positions,
    diagnostics,
  };
}

async function resolveCreateCommand(
  document: IriographDocument,
  command: CreateResourceCommand,
  store: Store,
  context: ResolvedAuthoringContext,
  options: PreviewAuthoringOptions,
  diagnostics: ProjectionDiagnostic[],
): Promise<ResolvedCreateResourceCommand | undefined> {
  let resourceIri = command.resourceIri;
  if (!resourceIri) {
    const allocator = options.allocator ?? context.allocator;
    if (!allocator) {
      diagnostics.push(error(
        "resource-allocator-unresolved",
        `No resource IRI allocator is available for ${command.commandId}.`,
      ));
      return undefined;
    }
    const requestId = allocatorRequestId(command, context);
    let allocation;
    try {
      allocation = await allocator.allocate({
        requestId,
        commandId: command.commandId,
        documentId: document.documentId,
        baseIri: document.semantic.baseIri,
        authoringProfileRef: context.authoringProfileRef,
        allowedNamespaces: [...context.resourcePolicy.allowedMintNamespaces],
        suggestedLocalName: command.suggestedLocalName,
        baseRevision: context.documentRevision,
        contextId: context.contextId,
        signal: options.signal,
      });
    } catch (cause) {
      diagnostics.push(error(
        "resource-allocation-failed",
        cause instanceof Error ? cause.message : "Resource IRI allocation failed.",
      ));
      return undefined;
    }
    if (options.signal?.aborted) {
      diagnostics.push(error("authoring-aborted", "Resource IRI allocation was aborted."));
      return undefined;
    }
    if (!allocation) {
      diagnostics.push(error("resource-allocation-cancelled", "Resource IRI allocation was cancelled."));
      return undefined;
    }
    if (
      allocation.requestId !== requestId
      || allocation.baseRevision !== context.documentRevision
      || allocation.contextId !== context.contextId
    ) {
      diagnostics.push(error(
        "resource-allocation-stale",
        `Stale resource IRI allocation was returned for ${command.commandId}.`,
      ));
      return undefined;
    }
    resourceIri = allocation.iri;
  }
  if (!isAllowedResourceIri(resourceIri, context)) {
    diagnostics.push(error(
      "resource-namespace-denied",
      `New resource is outside the allowed namespaces: ${resourceIri}`,
      resourceIri,
    ));
  }
  if (graphContainsNamedTerm(store, resourceIri)) {
    diagnostics.push(error(
      "resource-iri-collision",
      `Resource IRI already occurs in the RDF dataset: ${resourceIri}`,
      resourceIri,
    ));
  }
  return { ...clone(command), resourceIri };
}

function applyCreateResource(
  store: Store,
  command: ResolvedCreateResourceCommand,
  context: ResolvedAuthoringContext,
  positions: AuthoringPositionApplication[],
  diagnostics: ProjectionDiagnostic[],
): void {
  if (command.initialStatements.length === 0) {
    diagnostics.push(error(
      "create-resource-initial-statement-required",
      `Resource ${command.resourceIri} requires at least one initial statement.`,
      command.resourceIri,
    ));
    return;
  }
  let includesCreatedResource = false;
  const quads: Quad[] = [];
  for (const statement of command.initialStatements) {
    const subjectIri = statement.subject.kind === "created-resource"
      ? command.resourceIri
      : statement.subject.iri;
    const object = statement.object.kind === "created-resource"
      ? { kind: "iri" as const, iri: command.resourceIri }
      : statement.object;
    const predicateTerm = context.terms.find((candidate) => candidate.iri === statement.predicateIri);
    const allowedCreatedMembership = isAllowedCreatedMembershipStatement(
      store,
      statement,
      context,
    );
    if (
      statement.predicateIri !== RDF_TYPE
      && !allowedCreatedMembership
      && (
        statement.predicateIri === RDFS_MEMBER
        || isOrdinalPredicate(statement.predicateIri)
        || isResolvedStructuralPredicate(statement.predicateIri, context)
        || predicateTerm?.structural
        || predicateTerm?.kind === "structure"
      )
    ) {
      diagnostics.push(error(
        "structural-predicate-create-edit-denied",
        `Initial statements must use a structural command for ${statement.predicateIri}.`,
        command.resourceIri,
      ));
      continue;
    }
    includesCreatedResource ||= subjectIri === command.resourceIri
      || (object.kind === "iri" && object.iri === command.resourceIri);
    const result = authoringQuad(subjectIri, statement.predicateIri, object, diagnostics);
    if (result) quads.push(result);
  }
  if (!includesCreatedResource) {
    diagnostics.push(error(
      "create-resource-unbound",
      `Initial statements do not contain the created resource ${command.resourceIri}.`,
      command.resourceIri,
    ));
    return;
  }
  for (const value of quads) store.addQuad(value);
  if (command.initialPosition) {
    const { viewId, x, y } = command.initialPosition;
    if (!viewId || !Number.isFinite(x) || !Number.isFinite(y)) {
      diagnostics.push(error(
        "initial-position-invalid",
        `Initial position is invalid for ${command.resourceIri}.`,
        command.resourceIri,
      ));
    } else {
      positions.push({ resourceIri: command.resourceIri, position: { viewId, x, y } });
    }
  }
}

function isAllowedCreatedMembershipStatement(
  store: Store,
  statement: CreateResourceCommand["initialStatements"][number],
  context: ResolvedAuthoringContext,
): boolean {
  if (
    statement.subject.kind === "created-resource"
    || statement.object.kind !== "created-resource"
    || !isAbsoluteIri(statement.subject.iri)
  ) return false;
  const containerIri = statement.subject.iri;
  for (const profile of context.runtime.catalogsByProfile.values()) {
    for (const rule of profile.catalog.rules) {
      if (rule.match.kind !== "type") continue;
      const operator = rule.project;
      if (
        operator.operator !== "membership-container"
        || operator.membershipPredicate !== statement.predicateIri
      ) continue;
      if (store.countQuads(containerIri, RDF_TYPE, rule.match.iri, null) > 0) return true;
    }
  }
  return false;
}

function applySetProperty(
  store: Store,
  command: Extract<AuthoringCommand, { type: "set-property" }>,
  context: ResolvedAuthoringContext,
  diagnostics: ProjectionDiagnostic[],
): void {
  if (!requireIri(command.subjectIri, "subject", diagnostics)) return;
  if (!requireIri(command.predicateIri, "predicate", diagnostics)) return;
  const term = context.terms.find((candidate) => candidate.iri === command.predicateIri);
  if (
    command.predicateIri === RDF_TYPE
    || command.predicateIri === RDFS_MEMBER
    || isOrdinalPredicate(command.predicateIri)
    || isResolvedStructuralPredicate(command.predicateIri, context)
    || term?.structural
    || term?.kind === "structure"
  ) {
    diagnostics.push(error(
      "structural-predicate-property-edit-denied",
      `Structural predicate must use a structural command: ${command.predicateIri}`,
      command.subjectIri,
    ));
    return;
  }
  store.removeQuads(store.getQuads(command.subjectIri, command.predicateIri, null, null));
  for (const object of command.values) {
    const value = authoringQuad(command.subjectIri, command.predicateIri, object, diagnostics);
    if (value) store.addQuad(value);
  }
}

function applyConnectResources(
  store: Store,
  command: Extract<AuthoringCommand, { type: "connect-resources" }>,
  context: ResolvedAuthoringContext,
  diagnostics: ProjectionDiagnostic[],
): void {
  if (!command.predicateIri) {
    diagnostics.push(error("edge-predicate-required", "A direct edge requires an explicit predicate IRI."));
    return;
  }
  const term = context.terms.find((candidate) => candidate.iri === command.predicateIri);
  if (
    command.predicateIri === RDF_TYPE
    || command.predicateIri === RDFS_MEMBER
    || isOrdinalPredicate(command.predicateIri)
    || isResolvedStructuralPredicate(command.predicateIri, context)
    || term?.structural
    || term?.kind === "structure"
  ) {
    diagnostics.push(error(
      "structural-predicate-edge-edit-denied",
      `Structural predicate must use a structural command or capability: ${command.predicateIri}`,
      command.subjectIri,
    ));
    return;
  }
  const value = authoringQuad(
    command.subjectIri,
    command.predicateIri,
    { kind: "iri", iri: command.objectIri },
    diagnostics,
  );
  if (value) store.addQuad(value);
}

function applyCapability(
  store: Store,
  command: ApplyCapabilityCommand,
  context: ResolvedAuthoringContext,
  diagnostics: ProjectionDiagnostic[],
): void {
  const capability = context.capabilities.find((candidate) => (
    candidate.capabilityId === command.capabilityId
  ));
  if (!capability) {
    diagnostics.push(error(
      "authoring-capability-unresolved",
      `Authoring capability is not resolved: ${command.capabilityId}`,
    ));
    return;
  }
  const declared = new Set(capability.parameters.map((parameter) => parameter.name));
  for (const binding of Object.keys(command.bindings)) {
    if (!declared.has(binding)) {
      diagnostics.push(error(
        "authoring-capability-binding-invalid",
        `Unexpected binding ${binding} for ${command.capabilityId}.`,
      ));
    }
  }
  for (const parameter of capability.parameters) {
    const binding = command.bindings[parameter.name];
    if (!binding) {
      if (parameter.required !== false) {
        diagnostics.push(error(
          "authoring-capability-binding-required",
          `Binding ${parameter.name} is required for ${command.capabilityId}.`,
        ));
      }
      continue;
    }
    if (!parameter.objectKinds.includes(binding.kind)) {
      diagnostics.push(error(
        "authoring-capability-binding-kind",
        `Binding ${parameter.name} does not accept ${binding.kind}.`,
      ));
    }
  }
  if (hasErrors(diagnostics)) return;
  const omittedOptionalBindings = new Set(capability.parameters
    .filter((parameter) => parameter.required === false && !command.bindings[parameter.name])
    .map((parameter) => parameter.name));
  const remove = resolveCapabilityStatements(
    capability.graphPatch.remove ?? [],
    command,
    omittedOptionalBindings,
    diagnostics,
  );
  const add = resolveCapabilityStatements(
    capability.graphPatch.add ?? [],
    command,
    omittedOptionalBindings,
    diagnostics,
  );
  if (hasErrors(diagnostics)) return;
  for (const value of remove) {
    if (!store.has(value)) {
      diagnostics.push(error(
        "authoring-capability-remove-stale",
        `Capability removal statement no longer exists: ${canonicalQuad(value)}`,
      ));
      continue;
    }
    store.removeQuad(value);
  }
  for (const value of add) store.addQuad(value);
}

function applyMembership(
  store: Store,
  command: Extract<AuthoringCommand, { type: "set-membership" }>,
  context: ResolvedAuthoringContext,
  diagnostics: ProjectionDiagnostic[],
): void {
  if (!hasResolvedStructureConfig(store, context, command)) {
    diagnostics.push(error(
      "authoring-structure-config-unresolved",
      `Membership configuration is not resolved by a catalog: ${command.containerTypeIri} / ${command.predicateIri}`,
      command.containerIri,
    ));
    return;
  }
  const membership = authoringQuad(
    command.containerIri,
    command.predicateIri,
    { kind: "iri", iri: command.memberIri },
    diagnostics,
  );
  if (!membership) return;
  if (command.enabled) {
    store.addQuad(quad(
      namedNode(command.containerIri),
      namedNode(RDF_TYPE),
      namedNode(command.containerTypeIri),
    ));
    store.addQuad(membership);
  } else {
    store.removeQuad(membership);
  }
}

function applySequence(
  store: Store,
  command: Extract<AuthoringCommand, { type: "set-sequence" }>,
  context: ResolvedAuthoringContext,
  diagnostics: ProjectionDiagnostic[],
): void {
  if (command.memberIris.length < 1) {
    diagnostics.push(error("sequence-empty", `${command.sequenceIri} requires at least one member.`));
    return;
  }
  if (!hasResolvedStructureConfig(store, context, command)) {
    diagnostics.push(error(
      "authoring-structure-config-unresolved",
      `Sequence configuration is not resolved by a catalog: ${command.sequenceTypeIri} / ${command.ordinalPredicatePrefix}`,
      command.sequenceIri,
    ));
    return;
  }
  if (
    !requireIri(command.sequenceIri, "sequence", diagnostics)
    || !isAbsoluteIri(command.ordinalPredicatePrefix)
  ) {
    diagnostics.push(error(
      "ordinal-prefix-invalid",
      `Ordinal predicate prefix is invalid: ${command.ordinalPredicatePrefix}`,
    ));
    return;
  }
  replaceOrdinals(
    store,
    command.sequenceIri,
    command.ordinalPredicatePrefix,
    command.memberIris,
    command.sequenceTypeIri,
    diagnostics,
  );
}

function applyAlternatives(
  store: Store,
  command: Extract<AuthoringCommand, { type: "set-alternatives" }>,
  context: ResolvedAuthoringContext,
  diagnostics: ProjectionDiagnostic[],
): void {
  if (command.memberIris.length < 2) {
    diagnostics.push(error(
      "alternative-too-few-members",
      `${command.alternativeIri} requires at least two members.`,
    ));
    return;
  }
  if (!hasResolvedStructureConfig(store, context, command)) {
    diagnostics.push(error(
      "authoring-structure-config-unresolved",
      `Alternative configuration is not resolved by a catalog: ${command.alternativeTypeIri} / ${command.ordinalPredicatePrefix} / ${command.defaultOrdinal}`,
      command.alternativeIri,
    ));
    return;
  }
  if (
    !Number.isSafeInteger(command.defaultOrdinal)
    || command.defaultOrdinal < 1
    || command.defaultOrdinal > command.memberIris.length
  ) {
    diagnostics.push(error(
      "alternative-default-ordinal-invalid",
      `defaultOrdinal is outside the member range for ${command.alternativeIri}.`,
      command.alternativeIri,
    ));
    return;
  }
  if (command.memberIris[command.defaultOrdinal - 1] !== command.defaultMemberIri) {
    diagnostics.push(error(
      "alternative-default-mismatch",
      `defaultMemberIri must equal the member at defaultOrdinal for ${command.alternativeIri}.`,
      command.alternativeIri,
    ));
    return;
  }
  replaceOrdinals(
    store,
    command.alternativeIri,
    command.ordinalPredicatePrefix,
    command.memberIris,
    command.alternativeTypeIri,
    diagnostics,
  );
}

function applyDeleteResource(
  store: Store,
  command: Extract<AuthoringCommand, { type: "delete-resource" }>,
  context: ResolvedAuthoringContext,
  diagnostics: ProjectionDiagnostic[],
): void {
  if (!requireIri(command.resourceIri, "resource", diagnostics)) return;
  if (isProtectedVocabularyResource(command.resourceIri, context)) {
    diagnostics.push(error(
      "vocabulary-resource-delete-denied",
      `Known vocabulary resources cannot be deleted: ${command.resourceIri}`,
      command.resourceIri,
    ));
    return;
  }
  const impact = store.getQuads(null, null, null, null).filter((value) => (
    (isNamedNode(value.subject) && value.subject.value === command.resourceIri)
    || value.predicate.value === command.resourceIri
    || (isNamedNode(value.object) && value.object.value === command.resourceIri)
  ));
  if (impact.length === 0) {
    diagnostics.push(error(
      "resource-delete-unresolved",
      `Resource does not occur in the graph: ${command.resourceIri}`,
      command.resourceIri,
    ));
    return;
  }
  const references = impact.filter((value) => (
    !isNamedNode(value.subject) || value.subject.value !== command.resourceIri
  ));
  if (references.length > 0 && !command.cascade) {
    diagnostics.push({
      severity: "error",
      code: "resource-delete-referenced",
      message: `${command.resourceIri} is referenced by ${references.length} statement(s); explicit cascade is required.`,
      semanticRef: command.resourceIri,
    });
    return;
  }
  const ordinalPrefixes = ordinalPrefixesForContext(context);
  const affectedOrdinals = new Map<string, { subjectIri: string; prefix: string }>();
  for (const value of impact) {
    if (!isNamedNode(value.subject)) continue;
    const prefix = ordinalPrefixes.find((candidate) => (
      value.predicate.value.startsWith(candidate)
      && /^[1-9][0-9]*$/u.test(value.predicate.value.slice(candidate.length))
    ));
    if (!prefix) continue;
    affectedOrdinals.set(`${value.subject.value}\n${prefix}`, {
      subjectIri: value.subject.value,
      prefix,
    });
  }
  const removed = command.cascade
    ? impact
    : impact.filter((value) => isNamedNode(value.subject) && value.subject.value === command.resourceIri);
  store.removeQuads(removed);
  for (const affected of affectedOrdinals.values()) {
    if (affected.subjectIri === command.resourceIri) continue;
    renumberOrdinals(store, affected.subjectIri, affected.prefix, diagnostics);
  }
}

function applyRemoveStatement(
  store: Store,
  command: Extract<AuthoringCommand, { type: "remove-statement" }>,
  diagnostics: ProjectionDiagnostic[],
): void {
  const value = authoringQuad(
    command.subjectIri,
    command.predicateIri,
    { kind: "iri", iri: command.objectIri },
    diagnostics,
  );
  if (!value) return;
  if (statementIdentityFromQuad(value) !== command.statementRef) {
    diagnostics.push(error(
      "provenance-statement-mismatch",
      "The provenance statement identity does not match its RDF terms.",
      command.subjectIri,
    ));
    return;
  }
  if (!store.has(value)) {
    diagnostics.push(error(
      "provenance-statement-stale",
      `The provenance statement no longer exists: ${command.statementRef}`,
      command.subjectIri,
    ));
    return;
  }
  store.removeQuad(value);
}

function replaceOrdinals(
  store: Store,
  subjectIri: string,
  prefix: string,
  memberIris: readonly string[],
  typeIri: string,
  diagnostics: ProjectionDiagnostic[],
): void {
  if (!requireIri(subjectIri, "structural resource", diagnostics)) return;
  if (memberIris.some((member) => !requireIri(member, "member", diagnostics))) return;
  const previous = store.getQuads(subjectIri, null, null, null)
    .filter((value) => isExactOrdinalPredicate(value.predicate.value, prefix));
  store.removeQuads(previous);
  store.addQuad(quad(namedNode(subjectIri), namedNode(RDF_TYPE), namedNode(typeIri)));
  memberIris.forEach((memberIri, index) => {
    store.addQuad(quad(
      namedNode(subjectIri),
      namedNode(`${prefix}${index + 1}`),
      namedNode(memberIri),
    ));
  });
}

function renumberOrdinals(
  store: Store,
  subjectIri: string,
  prefix: string,
  diagnostics: ProjectionDiagnostic[],
): void {
  const members = store.getQuads(subjectIri, null, null, null)
    .filter((value) => isExactOrdinalPredicate(value.predicate.value, prefix))
    .map((value) => ({
      value,
      ordinal: Number(value.predicate.value.slice(prefix.length)),
    }))
    .filter((entry) => Number.isSafeInteger(entry.ordinal) && entry.ordinal > 0)
    .sort((left, right) => left.ordinal - right.ordinal || compareCodePoints(
      canonicalQuad(left.value),
      canonicalQuad(right.value),
    ));
  if (members.some((entry) => !isNamedNode(entry.value.object))) {
    diagnostics.push(error(
      "structural-resource-must-be-named",
      `${subjectIri} contains a non-IRI ordinal member.`,
      subjectIri,
    ));
    return;
  }
  store.removeQuads(members.map((entry) => entry.value));
  members.forEach((entry, index) => {
    store.addQuad(quad(
      namedNode(subjectIri),
      namedNode(`${prefix}${index + 1}`),
      entry.value.object as NamedNode,
    ));
  });
}

function isExactOrdinalPredicate(predicateIri: string, prefix: string): boolean {
  return predicateIri.startsWith(prefix)
    && /^[1-9][0-9]*$/u.test(predicateIri.slice(prefix.length));
}

function resolveCapabilityStatements(
  statements: readonly {
    subject: AuthoringCapabilityTerm;
    predicate: AuthoringCapabilityTerm;
    object: AuthoringCapabilityTerm;
  }[],
  command: ApplyCapabilityCommand,
  omittedOptionalBindings: ReadonlySet<string>,
  diagnostics: ProjectionDiagnostic[],
): Quad[] {
  const result: Quad[] = [];
  for (const statement of statements) {
    if ([statement.subject, statement.predicate, statement.object].some((term) => (
      term.kind === "binding" && omittedOptionalBindings.has(term.name)
    ))) continue;
    const subject = resolveCapabilityTerm(statement.subject, command);
    const predicate = resolveCapabilityTerm(statement.predicate, command);
    const object = resolveCapabilityTerm(statement.object, command);
    if (subject?.kind !== "iri" || predicate?.kind !== "iri" || !object) {
      diagnostics.push(error(
        "authoring-capability-statement-invalid",
        `Capability ${command.capabilityId} did not resolve to a named subject and predicate.`,
      ));
      continue;
    }
    const value = authoringQuad(subject.iri, predicate.iri, object, diagnostics);
    if (value) result.push(value);
  }
  return result;
}

function resolveCapabilityTerm(
  term: AuthoringCapabilityTerm,
  command: ApplyCapabilityCommand,
): AuthoringObjectValue | undefined {
  if (term.kind === "binding") return command.bindings[term.name];
  if (term.kind === "iri") return { kind: "iri", iri: term.iri };
  return {
    kind: "literal",
    value: term.value,
    language: term.language,
    datatypeIri: term.datatypeIri,
  };
}

function authoringQuad(
  subjectIri: string,
  predicateIri: string,
  object: AuthoringObjectValue,
  diagnostics: ProjectionDiagnostic[],
): Quad | undefined {
  if (!requireIri(subjectIri, "subject", diagnostics)) return undefined;
  if (!requireIri(predicateIri, "predicate", diagnostics)) return undefined;
  let objectTerm: NamedNode | Literal;
  if (object.kind === "iri") {
    if (!requireIri(object.iri, "object", diagnostics)) return undefined;
    objectTerm = namedNode(object.iri);
  } else {
    const literalDiagnostics = validateLiteralInput(object, subjectIri);
    diagnostics.push(...literalDiagnostics);
    if (hasErrors(literalDiagnostics)) return undefined;
    objectTerm = object.language
      ? literal(object.value, object.language.toLowerCase())
      : object.datatypeIri
        ? literal(object.value, namedNode(object.datatypeIri))
        : literal(object.value);
  }
  return quad(namedNode(subjectIri), namedNode(predicateIri), objectTerm);
}

function graphPatch(
  original: readonly Quad[],
  candidate: readonly Quad[],
): AuthoringGraphPatch {
  const originalKeys = new Set(original.map(canonicalQuad));
  const candidateKeys = new Set(candidate.map(canonicalQuad));
  return {
    added: candidate
      .filter((value) => !originalKeys.has(canonicalQuad(value)))
      .map(tripleChange)
      .sort(compareTripleChange),
    removed: original
      .filter((value) => !candidateKeys.has(canonicalQuad(value)))
      .map(tripleChange)
      .sort(compareTripleChange),
  };
}

function tripleChange(value: Quad): AuthoringTripleChange {
  if (
    (value.subject.termType !== "NamedNode" && value.subject.termType !== "BlankNode")
    || !isNamedNode(value.predicate)
  ) {
    throw new Error("Authoring graph changes require an RDF subject and named predicate.");
  }
  return {
    ...quadToTriple(value),
    statementRef: statementIdentityFromQuad(value),
  };
}

function quadToTriple(value: Quad): AuthoringTriple {
  if (!isNamedNode(value.predicate)) throw new Error("RDF predicates must be named nodes.");
  if (value.subject.termType !== "NamedNode" && value.subject.termType !== "BlankNode") {
    throw new Error("RDF subjects must be named or blank nodes.");
  }
  return {
    subject: {
      termType: value.subject.termType,
      value: value.subject.value,
    },
    predicateIri: value.predicate.value,
    object: graphTerm(value.object),
  };
}

function graphTerm(value: Term): AuthoringTriple["object"] {
  if (value.termType === "NamedNode" || value.termType === "BlankNode") {
    return { termType: value.termType, value: value.value };
  }
  if (value.termType === "Literal") {
    return {
      termType: "Literal",
      value: value.value,
      language: value.language || undefined,
      datatypeIri: value.datatype.value,
    };
  }
  throw new Error(`Unsupported graph term: ${value.termType}`);
}

function parseSource(document: IriographDocument): {
  quads: Quad[];
  prefixes: Record<string, string>;
  diagnostics: ProjectionDiagnostic[];
} {
  const prefixes: Record<string, string> = {};
  try {
    const quads = new Parser({
      baseIRI: document.semantic.baseIri,
      format: "text/turtle",
    }).parse(document.semantic.source, null, (prefix, iri) => {
      prefixes[prefix] = iri.value;
    });
    return { quads, prefixes, diagnostics: [] };
  } catch (cause) {
    return {
      quads: [],
      prefixes,
      diagnostics: [{
        ...error(
          "invalid-turtle",
          cause instanceof Error ? cause.message : "The semantic source is invalid Turtle.",
        ),
        category: "syntax",
      }],
    };
  }
}

function ordinalPrefixesForContext(context: ResolvedAuthoringContext): string[] {
  const prefixes = new Set<string>();
  for (const profile of context.runtime.catalogsByProfile.values()) {
    for (const rule of profile.catalog.rules) {
      const operator: ProjectionOperator = rule.project;
      if (operator.operator === "ordinal-sequence" || operator.operator === "alternative") {
        prefixes.add(operator.ordinalPredicatePrefix);
      }
    }
  }
  return [...prefixes].sort((left, right) => right.length - left.length || compareCodePoints(left, right));
}

function hasResolvedStructureConfig(
  store: Store,
  context: ResolvedAuthoringContext,
  command: Extract<AuthoringCommand, {
    type: "set-membership" | "set-sequence" | "set-alternatives";
  }>,
): boolean {
  const candidateStore = new Store(store.getQuads(null, null, null, null));
  const subjectIri = command.type === "set-membership"
    ? command.containerIri
    : command.type === "set-sequence"
      ? command.sequenceIri
      : command.alternativeIri;
  const typeIri = command.type === "set-membership"
    ? command.containerTypeIri
    : command.type === "set-sequence"
      ? command.sequenceTypeIri
      : command.alternativeTypeIri;
  if (command.type !== "set-membership" || command.enabled) {
    candidateStore.addQuad(quad(namedNode(subjectIri), namedNode(RDF_TYPE), namedNode(typeIri)));
  }
  const graph = semanticGraphFromQuads(candidateStore.getQuads(null, null, null, null));
  const closure = buildLimitedRdfsClosure(graph, rdfRdfsVocabulary);
  const assertedTypes = namedObjects(graph, subjectIri, RDF_TYPE);
  for (const profile of context.runtime.catalogsByProfile.values()) {
    const resolution = resolveResourceRule(profile.catalog, assertedTypes, closure, subjectIri);
    const resolved = resolution.diagnostics.some((item) => item.severity === "error")
      ? undefined
      : resolution.resolved;
    if (!resolved || resolved.matchedIri !== typeIri) continue;
    const operator = resolved.rule.project;
    if (
      command.type === "set-membership"
      && operator.operator === "membership-container"
      && operator.membershipPredicate === command.predicateIri
    ) return true;
    if (
      command.type === "set-sequence"
      && operator.operator === "ordinal-sequence"
      && operator.ordinalPredicatePrefix === command.ordinalPredicatePrefix
    ) return true;
    if (
      command.type === "set-alternatives"
      && operator.operator === "alternative"
      && operator.ordinalPredicatePrefix === command.ordinalPredicatePrefix
      && operator.defaultOrdinal === command.defaultOrdinal
    ) return true;
  }
  return false;
}

function isResolvedStructuralPredicate(
  predicateIri: string,
  context: ResolvedAuthoringContext,
): boolean {
  for (const profile of context.runtime.catalogsByProfile.values()) {
    for (const rule of profile.catalog.rules) {
      const operator = rule.project;
      if (
        operator.operator === "membership-container"
        && operator.membershipPredicate === predicateIri
      ) return true;
      if (
        (operator.operator === "ordinal-sequence" || operator.operator === "alternative")
        && predicateIri.startsWith(operator.ordinalPredicatePrefix)
        && /^[1-9][0-9]*$/u.test(predicateIri.slice(operator.ordinalPredicatePrefix.length))
      ) return true;
    }
  }
  return false;
}

function graphContainsNamedTerm(store: Store, iri: string): boolean {
  return store.getQuads(null, null, null, null).some((value) => (
    [value.subject, value.predicate, value.object].some((term) => (
      isNamedNode(term) && term.value === iri
    ))
    || (value.object.termType === "Literal" && value.object.datatype.value === iri)
  ));
}

function requireIri(
  iri: string,
  position: string,
  diagnostics: ProjectionDiagnostic[],
): boolean {
  if (isAbsoluteIri(iri)) return true;
  diagnostics.push(error("authoring-iri-invalid", `${position} is not an absolute IRI: ${iri}`));
  return false;
}

function allocatorRequestId(
  command: CreateResourceCommand,
  context: ResolvedAuthoringContext,
): string {
  return `urn:iriograph:allocator-request:v1:${encodeURIComponent(JSON.stringify([
    context.contextId,
    context.contextRevision,
    context.documentRevision,
    command.commandId,
    command.suggestedLocalName ?? "",
  ]))}`;
}

function compilation(
  document: IriographDocument,
  commands: ResolvedAuthoringCommand[],
  quads: readonly Quad[],
  prefixes: Readonly<Record<string, string>>,
  positions: AuthoringPositionApplication[],
  diagnostics: ProjectionDiagnostic[],
): AuthoringCompilation {
  return {
    document: clone(document),
    commands,
    quads,
    prefixes,
    patch: { added: [], removed: [] },
    positions,
    diagnostics,
  };
}

function compareTripleChange(left: AuthoringTripleChange, right: AuthoringTripleChange): number {
  return compareCodePoints(left.statementRef, right.statementRef);
}

function compareQuad(left: Quad, right: Quad): number {
  return compareCodePoints(canonicalQuad(left), canonicalQuad(right));
}

function hasErrors(diagnostics: readonly ProjectionDiagnostic[]): boolean {
  return diagnostics.some((diagnostic) => diagnostic.severity === "error");
}

function error(
  code: string,
  message: string,
  semanticRef?: string,
): ProjectionDiagnostic {
  return { severity: "error", code, message, semanticRef };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
