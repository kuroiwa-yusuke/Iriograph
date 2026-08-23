import type {
  DiagramCatalog,
  DiagramView,
  IriographDocument,
  ProjectionDiagnostic,
  SemanticSourceUpdate,
  ViewElementOverlay,
} from "./model";
import {
  parseIriographSemanticSource,
  projectIriographDocument,
} from "./projection";

/**
 * Turtleの変更を一つのsemantic transactionとして適用します。
 * parseに失敗したdraftは正本へ入れず、成功時だけdisplay overlayを照合します。
 */
export function applySemanticSource(
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
        message: `view ${view.viewId}のprofileRefをcatalogが提供していません。`,
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
        message: `default ${expectedKind} templateがありません: ${templateRef}`,
      });
    } else if (template.structuralKind !== expectedKind) {
      diagnostics.push({
        severity: "error",
        code: "template-kind-mismatch",
        message: `${templateRef}は${expectedKind} templateではありません。`,
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
        message: `ruleIdが重複しています: ${rule.ruleId}`,
      });
    }
    seenRuleIds.add(rule.ruleId);
    const template = catalog.templates[rule.templateRef];
    if (!template) {
      diagnostics.push({
        severity: "error",
        code: "missing-rule-template",
        message: `${rule.ruleId}のtemplateがありません: ${rule.templateRef}`,
      });
    } else if (template.structuralKind !== rule.kind) {
      diagnostics.push({
        severity: "error",
        code: "template-kind-mismatch",
        message: `${rule.ruleId}のstructuralKindとtemplateが一致しません。`,
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
