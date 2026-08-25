import { Parser } from "n3";
import { describe, expect, it, vi } from "vitest";

import {
  applyCanonicalSemanticDataset,
  applyCanonicalSemanticSource,
  applySemanticSource,
} from "./document";
import { applyAuthoringPreview, previewAuthoringCommands } from "./authoring";
import type { ResolvedAuthoringContext } from "./authoring-model";
import { createStandardLayoutRegistry } from "./layout";
import type { IriographDocumentV1 } from "./model";
import type { ProjectionRuntimeContext } from "./scene";
import {
  validateSemanticDocument,
  type ResolvedSemanticValidationContext,
  type SemanticValidationFinding,
  type SemanticValidationPort,
} from "./semantic-validation";
import { TURTLE_SERIALIZER_VERSION_V1 } from "./serializer";
import { standardRdfRdfsCatalog } from "./standard-catalog";

const BASE = "urn:test:validation:";
const SOURCE = `@prefix : <${BASE}> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
:a rdfs:label "A" ; :p :b .
:b rdfs:label "B" .
`;

describe("semantic validation port", () => {
  it("engine-independent snapshotを渡し、書式変更でdiagnostic ID/cache identityを安定させる", async () => {
    const requests: Parameters<SemanticValidationPort["validate"]>[0][] = [];
    const context = validationContext(async (request) => {
      requests.push(request);
      const startOffset = request.source.lastIndexOf(":b");
      return echo(request, [{
        findingId: "label-policy:b",
        severity: "warning",
        code: "domain-label-review",
        message: "B requires review.",
        semanticRef: `${BASE}b`,
        sourceRange: { startOffset, endOffset: startOffset + 2 },
      }]);
    });

    const first = await validateSemanticDocument(documentFor(SOURCE), context);
    const reformatted = SOURCE.replace(":b rdfs:label", "\n\n:b    rdfs:label");
    const second = await validateSemanticDocument(documentFor(reformatted), context);

    expect(requests[0]?.dataset.statements[0]).toMatchObject({
      statementRef: expect.stringMatching(/^urn:iriograph:semantic-ref:v1:statement:/u),
      subject: { termType: expect.any(String), value: expect.any(String) },
    });
    expect(requests[0]?.dataset).not.toHaveProperty("store");
    expect(first.datasetFingerprint).toBe(second.datasetFingerprint);
    expect(first.cacheKey).not.toBe(second.cacheKey);
    expect(first.sourceFingerprint).not.toBe(second.sourceFingerprint);
    expect(first.diagnostics[0]?.diagnosticId).toBe(second.diagnostics[0]?.diagnosticId);
    expect(first.diagnostics[0]?.sourceLocation?.startOffset)
      .not.toBe(second.diagnostics[0]?.sourceLocation?.startOffset);
  });

  it("domain errorはcandidate transactionをatomic rollbackするがloaded documentは診断可能", async () => {
    const context = validationContext(async (request) => echo(request, [{
      findingId: "required-label:c",
      severity: "error",
      code: "domain-label-required",
      message: "C requires a label.",
      semanticRef: `${BASE}c`,
    }]));
    const previous = documentFor(SOURCE);
    const candidate = `${SOURCE}\n:c :p :a .\n`;

    const update = await applySemanticSource(previous, candidate, runtimeContext(), {
      validationContext: context,
    });
    const loaded = await validateSemanticDocument(documentFor(candidate), context);

    expect(update.accepted).toBe(false);
    expect(update.document).toEqual(previous);
    expect(update.diagnostics).toContainEqual(expect.objectContaining({
      category: "domain",
      code: "domain-label-required",
      semanticRef: `${BASE}c`,
    }));
    expect(loaded.diagnostics).toContainEqual(expect.objectContaining({
      category: "domain",
      code: "domain-label-required",
    }));
  });

  it("warning confirmationをcontext identity/revision/source fingerprint/sorted IDsへ束縛する", async () => {
    const context = validationContext(async (request) => echo(request, [
      warning("z-warning", `${BASE}b`),
      warning("a-warning", `${BASE}a`),
    ]));
    const previous = documentFor(SOURCE);
    const candidate = `${SOURCE}\n:c <${BASE}p> :a .\n`;
    const first = await applySemanticSource(previous, candidate, runtimeContext(), {
      validationContext: context,
    });

    expect(first.accepted).toBe(false);
    expect(first.warningConfirmation?.diagnosticIds).toEqual(
      [...first.warningConfirmation!.diagnosticIds].sort(),
    );
    const confirmed = await applySemanticSource(previous, candidate, runtimeContext(), {
      validationContext: context,
      warningConfirmation: first.warningConfirmation,
    });
    expect(confirmed.accepted).toBe(true);

    const changedSource = await applySemanticSource(previous, `${candidate}\n`, runtimeContext(), {
      validationContext: context,
      warningConfirmation: first.warningConfirmation,
    });
    expect(changedSource.accepted).toBe(false);
    expect(changedSource.warningConfirmation?.sourceFingerprint)
      .not.toBe(first.warningConfirmation?.sourceFingerprint);

    const changedContext = { ...context, contextRevision: "2" };
    const changedRevision = await applySemanticSource(previous, candidate, runtimeContext(), {
      validationContext: changedContext,
      warningConfirmation: first.warningConfirmation,
    });
    expect(changedRevision.accepted).toBe(false);
    expect(changedRevision.warningConfirmation?.contextRevision).toBe("2");
  });

  it("direct/canonical source/canonical datasetが同じdomain validatorを通る", async () => {
    const validate = vi.fn(async (request: Parameters<SemanticValidationPort["validate"]>[0]) => (
      echo(request, [])
    ));
    const context = validationContext(validate);
    const document = documentFor(SOURCE);
    const options = { validationContext: context };

    expect((await applySemanticSource(document, SOURCE, runtimeContext(), options)).accepted).toBe(true);
    expect((await applyCanonicalSemanticSource(document, SOURCE, runtimeContext(), {
      serializerVersion: TURTLE_SERIALIZER_VERSION_V1,
      ...options,
    })).accepted).toBe(true);
    const quads = new Parser({ baseIRI: BASE }).parse(SOURCE);
    expect((await applyCanonicalSemanticDataset(document, quads, runtimeContext(), {
      serializerVersion: TURTLE_SERIALIZER_VERSION_V1,
      ...options,
    })).accepted).toBe(true);
    expect(validate).toHaveBeenCalledTimes(3);
  });

  it("structured previewのwarningをtokenへ束縛しidentity applyはprepared結果、cloneは再検証する", async () => {
    const validate = vi.fn(async (request: Parameters<SemanticValidationPort["validate"]>[0]) => (
      echo(request, [warning("structured-warning", `${BASE}b`)])
    ));
    const semanticValidation = validationContext(validate);
    const document = documentFor(SOURCE);
    const context = authoringContext(document, semanticValidation);
    const preview = await previewAuthoringCommands(document, [{
      type: "set-property",
      commandId: "rename-b",
      subjectIri: `${BASE}b`,
      predicateIri: "http://www.w3.org/2000/01/rdf-schema#label",
      values: [{ kind: "literal", value: "Changed" }],
    }], context);

    expect(preview.valid).toBe(true);
    expect(preview.semanticWarningConfirmation).toBeDefined();
    const update = await applyAuthoringPreview(document, preview, context, {
      confirmationId: preview.confirmationId,
    });
    expect(update.accepted).toBe(true);
    expect(update.document.semantic.source).toContain("Changed");
    expect(validate).toHaveBeenCalledTimes(2);

    const clonedPreview = structuredClone(preview);
    const clonedUpdate = await applyAuthoringPreview(document, clonedPreview, context, {
      confirmationId: clonedPreview.confirmationId,
    });
    expect(clonedUpdate.accepted).toBe(true);
    expect(clonedUpdate.warningConfirmation).toEqual(update.warningConfirmation);
    expect(validate).toHaveBeenCalledTimes(3);
  });

  it.each([
    ["throw", async () => { throw new Error("validator offline"); }, "semantic-validation-adapter-failed"],
    ["echo", async (request: Parameters<SemanticValidationPort["validate"]>[0]) => ({
      ...echo(request, []), contextRevision: "stale",
    }), "semantic-validation-echo-mismatch"],
    ["malformed", async (request: Parameters<SemanticValidationPort["validate"]>[0]) => echo(request, [{
      findingId: "bad",
      severity: "warning",
      code: "bad",
      message: "bad",
      statementRef: "urn:unknown:statement",
    }]), "semantic-validation-response-malformed"],
  ])("adapter %sをfail closedにする", async (_name, validate, expectedCode) => {
    const update = await applySemanticSource(documentFor(SOURCE), SOURCE, runtimeContext(), {
      validationContext: validationContext(validate as SemanticValidationPort["validate"]),
    });
    expect(update.accepted).toBe(false);
    expect(update.diagnostics).toContainEqual(expect.objectContaining({
      severity: "error",
      category: "internal",
      code: expectedCode,
    }));
  });

  it("aborted requestをvalidatorへ渡さずdiagnostic化しない", async () => {
    const validate = vi.fn(async (request: Parameters<SemanticValidationPort["validate"]>[0]) => echo(request, []));
    const controller = new AbortController();
    controller.abort();
    const update = await applySemanticSource(documentFor(SOURCE), SOURCE, runtimeContext(), {
      validationContext: validationContext(validate),
      signal: controller.signal,
    });
    expect(update.accepted).toBe(false);
    expect(update.aborted).toBe(true);
    expect(validate).not.toHaveBeenCalled();
    expect(update.diagnostics).toEqual([]);
  });

  it("空identityやvalidator欠落のvalidation contextをfail closedにする", async () => {
    const malformed = {
      contextId: "",
      contextRevision: "",
    } as unknown as ResolvedSemanticValidationContext;
    const update = await applySemanticSource(documentFor(SOURCE), SOURCE, runtimeContext(), {
      validationContext: malformed,
    });
    expect(update.accepted).toBe(false);
    expect(update.diagnostics).toContainEqual(expect.objectContaining({
      category: "internal",
      code: "semantic-validation-context-invalid",
    }));
  });
});

function validationContext(
  validate: SemanticValidationPort["validate"],
): ResolvedSemanticValidationContext {
  return {
    contextId: "urn:test:validation-context",
    contextRevision: "1",
    validator: { validate },
  };
}

function echo(
  request: Parameters<SemanticValidationPort["validate"]>[0],
  findings: readonly SemanticValidationFinding[],
) {
  return {
    contextId: request.contextId,
    contextRevision: request.contextRevision,
    sourceFingerprint: request.sourceFingerprint,
    datasetFingerprint: request.datasetFingerprint,
    findings,
  };
}

function warning(findingId: string, semanticRef: string) {
  return {
    findingId,
    severity: "warning" as const,
    code: "domain-review-required",
    message: "Review required.",
    semanticRef,
  };
}

function documentFor(source: string): IriographDocumentV1 {
  return {
    schemaVersion: "1",
    kind: "iriograph.document",
    documentId: "semantic-validation-test",
    semantic: {
      format: "text/turtle",
      baseIri: BASE,
      authoringProfileRef: "urn:test:authoring:1",
      source,
    },
    views: [{
      viewId: "main",
      kind: "node-link",
      profileRef: standardRdfRdfsCatalog.profileRef,
      layoutRef: standardRdfRdfsCatalog.defaults!.layoutRef,
      overlay: {},
    }],
  };
}

function runtimeContext(): ProjectionRuntimeContext {
  return {
    catalogsByProfile: new Map([[
      standardRdfRdfsCatalog.profileRef,
      { catalog: standardRdfRdfsCatalog },
    ]]),
    layouts: createStandardLayoutRegistry(),
  };
}

function authoringContext(
  document: IriographDocumentV1,
  semanticValidation: ResolvedSemanticValidationContext,
): ResolvedAuthoringContext {
  return {
    contextId: "urn:test:authoring-context",
    contextRevision: "1",
    documentRevision: "1",
    authoringProfileRef: document.semantic.authoringProfileRef,
    runtime: runtimeContext(),
    resourcePolicy: { allowedMintNamespaces: [BASE] },
    termPolicy: {
      existingUnknown: "preserve",
      humanUnknown: "reject",
      llmUnknown: "reject",
      humanMinting: "deny",
      llmMinting: "deny",
    },
    terms: [{
      iri: "http://www.w3.org/2000/01/rdf-schema#label",
      kind: "property",
      objectKinds: ["literal"],
    }],
    capabilities: [],
    semanticValidation,
  };
}
