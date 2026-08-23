import type {
  AuthoringCommand,
  AuthoringInitialStatement,
  AuthoringObjectValue,
  ResolvedAuthoringContext,
} from "@iriograph/core";
import { applyAuthoringPreview, previewAuthoringCommands } from "@iriograph/core";

import type {
  AliasedAuthoringOperation,
  AliasedObjectValue,
  SemanticWriteApplyRequest,
  SemanticWritePort,
  SemanticWritePreview,
  SemanticWritePreviewRequest,
} from "./model.js";
import { SemanticWriteConfirmationError } from "./model.js";
import { SemanticAccessIndex } from "./semantic-index.js";

export function compileAliasedOperation(
  index: SemanticAccessIndex,
  operation: AliasedAuthoringOperation,
): AuthoringCommand {
  index.assertRevision(operation.revision);
  switch (operation.type) {
    case "create-resource":
      return {
        type: "create-resource",
        commandId: operation.operationId,
        ...(operation.resourceIri ? { resourceIri: operation.resourceIri } : {}),
        ...(operation.suggestedLocalName ? { suggestedLocalName: operation.suggestedLocalName } : {}),
        initialStatements: operation.initialStatements.map((statement): AuthoringInitialStatement => ({
          subject: statement.subject.kind === "created-resource"
            ? statement.subject
            : { kind: "iri", iri: index.resolveAlias(statement.subject.resource, "resource") },
          predicateIri: index.resolveAlias(statement.predicate, "predicate"),
          object: statement.object.kind === "created-resource"
            ? statement.object
            : resolveObject(index, statement.object),
        })),
        ...(operation.initialPosition ? { initialPosition: operation.initialPosition } : {}),
      };
    case "set-property":
      return {
        type: "set-property",
        commandId: operation.operationId,
        subjectIri: index.resolveAlias(operation.subject, "resource"),
        predicateIri: index.resolveAlias(operation.predicate, "predicate"),
        values: operation.values.map((value) => resolveObject(index, value)),
      };
    case "connect-resources":
      return {
        type: "connect-resources",
        commandId: operation.operationId,
        subjectIri: index.resolveAlias(operation.subject, "resource"),
        predicateIri: index.resolveAlias(operation.predicate, "predicate"),
        objectIri: index.resolveAlias(operation.object, "resource"),
      };
    case "apply-capability":
      return {
        type: "apply-capability",
        commandId: operation.operationId,
        capabilityId: operation.capabilityId,
        bindings: Object.fromEntries(
          Object.entries(operation.bindings).map(([name, value]) => [name, resolveObject(index, value)]),
        ),
      };
    case "set-membership":
      return {
        type: "set-membership",
        commandId: operation.operationId,
        containerIri: index.resolveAlias(operation.container, "resource"),
        memberIri: index.resolveAlias(operation.member, "resource"),
        enabled: operation.enabled,
        containerTypeIri: index.resolveAlias(operation.containerType, "resource"),
        predicateIri: index.resolveAlias(operation.predicate, "predicate"),
      };
    case "set-sequence":
      return {
        type: "set-sequence",
        commandId: operation.operationId,
        sequenceIri: index.resolveAlias(operation.sequence, "resource"),
        memberIris: operation.members.map((member) => index.resolveAlias(member, "resource")),
        sequenceTypeIri: index.resolveAlias(operation.sequenceType, "resource"),
        ordinalPredicatePrefix: operation.ordinalPredicatePrefix,
      };
    case "set-alternatives":
      return {
        type: "set-alternatives",
        commandId: operation.operationId,
        alternativeIri: index.resolveAlias(operation.alternative, "resource"),
        memberIris: operation.members.map((member) => index.resolveAlias(member, "resource")),
        defaultMemberIri: index.resolveAlias(operation.defaultMember, "resource"),
        alternativeTypeIri: index.resolveAlias(operation.alternativeType, "resource"),
        ordinalPredicatePrefix: operation.ordinalPredicatePrefix,
        defaultOrdinal: operation.defaultOrdinal,
      };
    case "delete-resource":
      return {
        type: "delete-resource",
        commandId: operation.operationId,
        resourceIri: index.resolveAlias(operation.resource, "resource"),
        ...(operation.cascade === undefined ? {} : { cascade: operation.cascade }),
      };
    case "remove-statement":
      return {
        type: "remove-statement",
        commandId: operation.operationId,
        statementRef: operation.statementRef,
        subjectIri: index.resolveAlias(operation.subject, "resource"),
        predicateIri: index.resolveAlias(operation.predicate, "predicate"),
        objectIri: index.resolveAlias(operation.object, "resource"),
      };
  }
}

/**
 * Revision-safe facade. It compiles aliases but delegates both preview and
 * authoritative apply to the injected host port.
 */
export class SemanticAuthoringFacade {
  readonly #index: SemanticAccessIndex;
  readonly #port: SemanticWritePort;

  constructor(index: SemanticAccessIndex, port: SemanticWritePort) {
    this.#index = index;
    this.#port = port;
  }

  async preview(operation: AliasedAuthoringOperation): Promise<SemanticWritePreview> {
    const command = compileAliasedOperation(this.#index, operation);
    const corePreview = await this.#port.preview({
      document: this.#index.document,
      revision: this.#index.revision,
      command,
    });
    if (corePreview.baseRevision !== this.#index.revision) {
      throw new SemanticWriteConfirmationError(
        `Write port returned preview revision ${corePreview.baseRevision}; expected ${this.#index.revision}.`,
      );
    }
    return {
      revision: this.#index.revision,
      operation,
      command,
      corePreview,
    };
  }

  async apply(
    preview: SemanticWritePreview,
    options: { revision: string; confirmationId: string },
  ) {
    this.#index.assertRevision(options.revision);
    this.#index.assertRevision(preview.revision);
    this.#index.assertRevision(preview.operation.revision);
    this.#index.assertRevision(preview.corePreview.baseRevision);
    if (!preview.corePreview.requiresConfirmation) {
      throw new SemanticWriteConfirmationError("The write preview does not require explicit confirmation.");
    }
    if (!options.confirmationId || options.confirmationId !== preview.corePreview.confirmationId) {
      throw new SemanticWriteConfirmationError(
        "The explicit confirmation ID does not match the revision-bound preview.",
      );
    }
    return this.#port.apply({
      document: this.#index.document,
      revision: this.#index.revision,
      preview: preview.corePreview,
      confirmationId: options.confirmationId,
    });
  }
}

/**
 * Convenience host adapter for direct Core usage. Cloud may inject a remote
 * port instead, but it must preserve the same revision and confirmation rules.
 */
export function createCoreSemanticWritePort(
  resolveContext: (
    request: SemanticWritePreviewRequest | SemanticWriteApplyRequest,
  ) => ResolvedAuthoringContext | Promise<ResolvedAuthoringContext>,
): SemanticWritePort {
  return {
    async preview(request) {
      const context = await resolveContext(request);
      if (context.documentRevision !== request.revision) {
        throw new SemanticWriteConfirmationError(
          `Resolved authoring context revision ${context.documentRevision} does not match ${request.revision}.`,
        );
      }
      return previewAuthoringCommands(request.document, [request.command], context);
    },
    async apply(request) {
      const context = await resolveContext(request);
      if (context.documentRevision !== request.revision) {
        throw new SemanticWriteConfirmationError(
          `Resolved authoring context revision ${context.documentRevision} does not match ${request.revision}.`,
        );
      }
      return applyAuthoringPreview(request.document, request.preview, context, {
        confirmationId: request.confirmationId,
      });
    },
  };
}

function resolveObject(
  index: SemanticAccessIndex,
  value: AliasedObjectValue,
): AuthoringObjectValue {
  return value.kind === "iri"
    ? { kind: "iri", iri: index.resolveAlias(value.resource, "resource") }
    : value;
}
