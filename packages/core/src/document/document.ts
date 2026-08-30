import type {
  DiagramCatalog,
  DiagramView,
  IriographDocument,
  ProjectionDiagnostic,
  SemanticSourceUpdate,
  ViewElementOverlay,
} from "./model.js";
import type { Quad } from "n3";
import {
  parseIriographSemanticSource,
  projectIriographDocument,
} from "../projection/projection.js";
import {
  classifySemanticReconciliationScope,
  reconcileIriographDocumentViews,
} from "../projection/reconciliation.js";
import type { ProjectionRuntimeContext } from "../projection/scene.js";
import {
  canonicalizeTurtleSourceV1,
  serializeCanonicalTurtleV1,
  TURTLE_SERIALIZER_VERSION_V1,
  type TurtleSerializerVersion,
} from "./serializer.js";
import {
  matchesSemanticWarningConfirmation,
  validateSemanticDocument,
  type SemanticValidationTransactionOptions,
} from "../semantic/semantic-validation.js";
import { sortDiagnostics } from "../projection/diagnostics.js";

export type CanonicalSemanticDatasetOptions = {
  serializerVersion: TurtleSerializerVersion;
  baseIri?: string;
  prefixes?: Readonly<Record<string, string>>;
  /** Structured authoring may request a verified edge-only fast path. */
  reconciliationMode?: "full" | "edge-only";
} & SemanticValidationTransactionOptions;

/**
 * Turtleの変更を一つのsemantic transactionとして適用します。
 * parseに失敗したdraftは正本へ入れず、成功時だけdisplay overlayを照合します。
 */
export function applySemanticSource(
  document: IriographDocument,
  source: string,
  context: ProjectionRuntimeContext,
  options?: SemanticValidationTransactionOptions,
): Promise<SemanticSourceUpdate>;
export function applySemanticSource(
  document: IriographDocument,
  source: string,
  catalog: DiagramCatalog,
): SemanticSourceUpdate;
export function applySemanticSource(
  document: IriographDocument,
  source: string,
  context: ProjectionRuntimeContext | DiagramCatalog,
  options: SemanticValidationTransactionOptions = {},
): Promise<SemanticSourceUpdate> | SemanticSourceUpdate {
  if (isProjectionRuntimeContext(context)) {
    return applySemanticSourceTarget(document, source, context, options);
  }
  return applySemanticSourceLegacy(document, source, context);
}

async function applySemanticSourceTarget(
  document: IriographDocument,
  source: string,
  context: ProjectionRuntimeContext,
  options: SemanticValidationTransactionOptions,
): Promise<SemanticSourceUpdate> {
  return applyPreparedSemanticSourceTarget(document, source, context, options);
}

/**
 * Structured/LLM source entry: parse to a dataset, canonicalize with the
 * versioned serializer, then use the same all-view reconciliation pipeline.
 */
export async function applyCanonicalSemanticSource(
  document: IriographDocument,
  candidateSource: string,
  context: ProjectionRuntimeContext,
  options: Pick<CanonicalSemanticDatasetOptions,
    "serializerVersion" | "validationContext" | "warningConfirmation" | "signal"
  >,
): Promise<SemanticSourceUpdate> {
  if (options.serializerVersion !== TURTLE_SERIALIZER_VERSION_V1) {
    return {
      accepted: false,
      document: clone(document),
      diagnostics: [{
        severity: "error",
        code: "serializer-version-unsupported",
        message: "Unsupported Turtle serializer version.",
      }],
    };
  }
  const serialized = canonicalizeTurtleSourceV1(
    candidateSource,
    document.semantic.baseIri,
  );
  if (!serialized.accepted) {
    return {
      accepted: false,
      document: clone(document),
      diagnostics: categorizePipelineDiagnostics(serialized.diagnostics),
    };
  }
  return applyPreparedSemanticSourceTarget(document, serialized.source, context, options);
}

/** Structured graph-patch entry after the candidate RDF dataset is assembled. */
export async function applyCanonicalSemanticDataset(
  document: IriographDocument,
  quads: readonly Quad[],
  context: ProjectionRuntimeContext,
  options: CanonicalSemanticDatasetOptions,
): Promise<SemanticSourceUpdate> {
  const serialized = serializeCanonicalTurtleV1({
    serializerVersion: options.serializerVersion,
    quads,
    baseIri: options.baseIri ?? document.semantic.baseIri,
    prefixes: options.prefixes,
  });
  if (!serialized.accepted) {
    return {
      accepted: false,
      document: clone(document),
      diagnostics: categorizePipelineDiagnostics(serialized.diagnostics),
    };
  }
  return applyPreparedSemanticSourceTarget(document, serialized.source, context, options);
}

async function applyPreparedSemanticSourceTarget(
  document: IriographDocument,
  source: string,
  context: ProjectionRuntimeContext,
  options: SemanticValidationTransactionOptions & {
    reconciliationMode?: "full" | "edge-only";
  },
): Promise<SemanticSourceUpdate> {
  const candidate = clone(document);
  // Direct source editing keeps the user's exact accepted Turtle text. Rich
  // command canonical serialization is a separate authoring concern.
  candidate.semantic.source = source;
  const inferredMode = classifySemanticReconciliationScope(document, candidate)
    === "subproperty-hierarchy-only"
    ? "edge-only"
    : "full";
  const result = await reconcileIriographDocumentViews(document, candidate, context, {
    mode: options.reconciliationMode ?? inferredMode,
  });
  const categorized = categorizePipelineDiagnostics(result.diagnostics);
  if (!result.accepted) {
    return {
      accepted: false,
      document: result.document,
      diagnostics: categorized,
    };
  }
  const validation = await validateSemanticDocument(result.document, options.validationContext, {
    signal: options.signal,
  });
  const diagnostics = sortAndUniqueDiagnostics([...categorized, ...validation.diagnostics]);
  if (validation.aborted) {
    return { accepted: false, aborted: true, document: clone(document), diagnostics };
  }
  if (validation.diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return {
      accepted: false,
      document: clone(document),
      diagnostics,
      warningConfirmation: validation.warningConfirmation,
    };
  }
  if (
    validation.warningConfirmation
    && !matchesSemanticWarningConfirmation(
      validation.warningConfirmation,
      options.warningConfirmation,
    )
  ) {
    return {
      accepted: false,
      document: clone(document),
      diagnostics,
      warningConfirmation: validation.warningConfirmation,
    };
  }
  return {
    accepted: true,
    document: result.document,
    diagnostics,
    scenes: clone(result.scenes),
    warningConfirmation: validation.warningConfirmation,
  };
}

function categorizePipelineDiagnostics(
  diagnostics: readonly ProjectionDiagnostic[],
): ProjectionDiagnostic[] {
  return diagnostics.map((diagnostic) => {
    if (diagnostic.category) return diagnostic;
    if (diagnostic.code === "invalid-turtle" || /turtle.*parse|parse.*turtle/u.test(diagnostic.code)) {
      return { ...diagnostic, category: "syntax" };
    }
    if (/profile|catalog|rule|template/u.test(diagnostic.code)) {
      return { ...diagnostic, category: "profile" };
    }
    if (/layout|geometry|routing/u.test(diagnostic.code)) {
      return { ...diagnostic, category: "layout" };
    }
    if (/container|containment|membership|sequence|alternative|ordinal|structure/u.test(diagnostic.code)) {
      return { ...diagnostic, category: "structure" };
    }
    return { ...diagnostic, category: "projection" };
  });
}

function sortAndUniqueDiagnostics(
  diagnostics: readonly ProjectionDiagnostic[],
): ProjectionDiagnostic[] {
  const seen = new Set<string>();
  return sortDiagnostics(diagnostics.filter((diagnostic) => {
    const key = JSON.stringify(diagnostic);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }));
}

function applySemanticSourceLegacy(
  document: IriographDocument,
  source: string,
  catalog: DiagramCatalog,
): SemanticSourceUpdate {
  const candidate = clone(document);
  candidate.semantic.source = source;
  const diagnostics = validateIriographDocument(candidate, catalog);

  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return {
      accepted: false,
      document: clone(document),
      diagnostics,
    };
  }

  return {
    accepted: true,
    document: reconcileDocumentViews(candidate, catalog),
    diagnostics,
  };
}

/**
 * 意味編集後も存続IRIに紐づくユーザー調整を維持し、消滅したIRIのoverlayを除去します。
 * 新規要素には投影結果の決定的な初期geometryを補完します。
 */
export function reconcileDocumentViews(
  document: IriographDocument,
  catalog: DiagramCatalog,
): IriographDocument {
  const next = clone(document);
  next.views = next.views.map((view) => reconcileView(next, view, catalog));
  return next;
}

export function validateIriographDocument(
  document: IriographDocument,
  catalog: DiagramCatalog,
): ProjectionDiagnostic[] {
  const diagnostics = validateCatalog(catalog);
  try {
    parseIriographSemanticSource(document);
  } catch (cause) {
    diagnostics.push({
      severity: "error",
      code: "invalid-turtle",
      message: cause instanceof Error ? cause.message : String(cause),
    });
    return diagnostics;
  }

  for (const view of document.views) {
    if (view.profileRef !== catalog.profileRef) {
      diagnostics.push({
        severity: "warning",
        code: "profile-mismatch",
        message: `The catalog does not provide the profileRef for view ${view.viewId}.`,
      });
    }
  }
  return diagnostics;
}

export function validateCatalog(catalog: DiagramCatalog): ProjectionDiagnostic[] {
  const diagnostics: ProjectionDiagnostic[] = [];
  const defaults: Array<[string, "node" | "edge"]> = [
    [catalog.defaults.nodeTemplateRef, "node"],
    [catalog.defaults.edgeTemplateRef, "edge"],
  ];

  for (const [templateRef, expectedKind] of defaults) {
    const template = catalog.templates[templateRef];
    if (!template) {
      diagnostics.push({
        severity: "error",
        code: "missing-default-template",
        message: `Default ${expectedKind} template is missing: ${templateRef}`,
      });
    } else if (template.structuralKind !== expectedKind) {
      diagnostics.push({
        severity: "error",
        code: "template-kind-mismatch",
        message: `${templateRef} is not a ${expectedKind} template.`,
      });
    }
  }

  const seenRuleIds = new Set<string>();
  const allRules = [
    ...catalog.nodeRules.map((rule) => ({
      ruleId: rule.ruleId,
      templateRef: rule.templateRef,
      kind: rule.structuralKind,
    })),
    ...catalog.relationRules.map((rule) => ({
      ruleId: rule.ruleId,
      templateRef: rule.templateRef,
      kind: "edge" as const,
    })),
  ];
  for (const rule of allRules) {
    if (seenRuleIds.has(rule.ruleId)) {
      diagnostics.push({
        severity: "error",
        code: "duplicate-rule-id",
        message: `Duplicate ruleId: ${rule.ruleId}`,
      });
    }
    seenRuleIds.add(rule.ruleId);
    const template = catalog.templates[rule.templateRef];
    if (!template) {
      diagnostics.push({
        severity: "error",
        code: "missing-rule-template",
        message: `Template for ${rule.ruleId} is missing: ${rule.templateRef}`,
      });
    } else if (template.structuralKind !== rule.kind) {
      diagnostics.push({
        severity: "error",
        code: "template-kind-mismatch",
        message: `The structuralKind and template for ${rule.ruleId} do not match.`,
      });
    }
  }

  return diagnostics;
}

function reconcileView(
  document: IriographDocument,
  view: DiagramView,
  catalog: DiagramCatalog,
): DiagramView {
  const scene = projectIriographDocument(document, catalog, view.viewId);
  const previousBySemantic = new Map(
    Object.entries(view.overlay).map(([elementId, overlay]) => [
      overlay.semanticRef,
      { elementId, overlay },
    ]),
  );
  const overlay: Record<string, ViewElementOverlay> = {};

  for (const element of [...scene.containers, ...scene.nodes]) {
    const previous = previousBySemantic.get(element.semanticRef);
    const elementId = previous?.elementId ?? element.elementId;
    overlay[elementId] = previous
      ? clone(previous.overlay)
      : {
          semanticRef: element.semanticRef,
          geometry: clone(element.geometry),
          pinned: false,
          placement: "generated",
        };
  }

  for (const edge of scene.edges) {
    const previous = previousBySemantic.get(edge.semanticRef);
    if (!previous) continue;
    // edgeは手動routingなど、実際に保持すべき情報がある場合だけoverlayへ残します。
    overlay[previous.elementId] = clone(previous.overlay);
  }

  return { ...view, overlay };
}

function clone<T>(value: T): T {
  // Public documentはJSON contractです。Vue等のreactive Proxyもhostから渡されるため、
  // structuredCloneではなくJSON境界でplain dataへ正規化します。
  return JSON.parse(JSON.stringify(value)) as T;
}

function isProjectionRuntimeContext(
  value: ProjectionRuntimeContext | DiagramCatalog,
): value is ProjectionRuntimeContext {
  return "catalogsByProfile" in value && "layouts" in value;
}
