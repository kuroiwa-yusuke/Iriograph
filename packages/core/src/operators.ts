import type { Literal, Quad } from "n3";

import {
  alternativeBranchIdentity,
  generatedElementId,
  sequenceTransitionIdentity,
  statementIdentityFromQuad,
} from "./identity";
import type {
  DiagramView,
  ProjectedContainer,
  ProjectedEdge,
  ProjectedNode,
  ProjectedScene,
  ProjectionCatalogV1,
  ProjectionDiagnostic,
  ProjectionOptions,
  ProjectionProvenance,
  ProjectionRule,
  ViewElementOverlay,
  VisualTemplate,
} from "./model";
import {
  collectOrdinalMembers,
  resolveNamedResourcePlans,
  type NamedResourcePlan,
} from "./profile-validation";
import type { RdfsClosure } from "./rdfs-closure";
import {
  compareCodePoints,
  distinctNamedSubjects,
  isNamedNode,
  type SemanticGraph,
} from "./rdf";
import {
  resolveStatementRule,
  type ResolvedProjectionRule,
} from "./rule-resolution";
import { catalogRef, type RdfRdfsVocabulary } from "./standard-catalog";

type OverlayEntry = { elementId: string; overlay: ViewElementOverlay };
type ParentBinding = {
  parentIri: string;
  quad: Quad;
  rule: ResolvedProjectionRule;
};
type DirectEdgePlan = {
  quad: Quad;
  resolved?: ResolvedProjectionRule;
};

export type ProjectionOperatorInput = {
  graph: SemanticGraph;
  view: DiagramView;
  catalog: ProjectionCatalogV1;
  closure: RdfsClosure;
  vocabulary: RdfRdfsVocabulary;
  options?: ProjectionOptions;
};

export function executeProjectionOperators(
  input: ProjectionOperatorInput,
): ProjectedScene {
  const { graph, view, catalog, closure, vocabulary } = input;
  const diagnostics: ProjectionDiagnostic[] = [];
  const resourceResolution = resolveNamedResourcePlans(graph, catalog, closure, vocabulary);
  diagnostics.push(...resourceResolution.diagnostics);
  const plans = resourceResolution.plans;
  const overlays = overlaysForSemantic(view, diagnostics);
  const consumed = new Set<string>();
  const candidates = new Set(distinctNamedSubjects(graph));
  const parentByChild = new Map<string, ParentBinding>();

  collectStructuralStatements(
    graph,
    plans,
    consumed,
    candidates,
    parentByChild,
  );

  const directEdges: DirectEdgePlan[] = [];
  for (const quad of graph.quads) {
    if (!isNamedNode(quad.subject) || !isNamedNode(quad.predicate) || !isNamedNode(quad.object)) continue;
    const statementRef = statementIdentityFromQuad(quad);
    if (consumed.has(statementRef)) continue;
    const resolution = resolveStatementRule(
      catalog,
      quad.predicate.value,
      closure,
      statementRef,
    );
    diagnostics.push(...resolution.diagnostics);
    if (resolution.resolved?.rule.project.operator === "suppress") continue;
    if (resolution.resolved && resolution.resolved.rule.project.operator !== "direct-edge") continue;
    directEdges.push({ quad, resolved: resolution.resolved });
    candidates.add(quad.subject.value);
    candidates.add(quad.object.value);
  }

  const nodes = new Map<string, ProjectedNode>();
  const containers = new Map<string, ProjectedContainer>();
  const semanticToElement = new Map<string, string>();
  for (const semanticRef of [...candidates].sort(compareCodePoints)) {
    const plan = plans.get(semanticRef) ?? {
      semanticRef,
      assertedTypes: [],
    };
    const element = projectResource(
      graph,
      view,
      catalog,
      vocabulary,
      plan,
      overlays.get(semanticRef),
      diagnostics,
      input.options,
    );
    if (!element) continue;
    semanticToElement.set(semanticRef, element.elementId);
    if (element.structuralKind === "container") containers.set(semanticRef, element);
    else nodes.set(semanticRef, element);
  }

  applyParentBindings(nodes, containers, semanticToElement, parentByChild);

  const edges: ProjectedEdge[] = [];
  for (const plan of directEdges) {
    const edge = projectDirectEdge(
      graph,
      view,
      catalog,
      vocabulary,
      plan,
      semanticToElement,
      overlays,
      diagnostics,
    );
    if (edge) edges.push(edge);
  }
  projectDerivedEdges(
    graph,
    view,
    catalog,
    vocabulary,
    plans,
    semanticToElement,
    overlays,
    edges,
    diagnostics,
  );

  return {
    viewId: view.viewId,
    nodes: [...nodes.values()].sort(compareElements),
    containers: [...containers.values()].sort(compareElements),
    edges: edges.sort(compareElements),
    diagnostics,
  };
}

function collectStructuralStatements(
  graph: SemanticGraph,
  plans: ReadonlyMap<string, NamedResourcePlan>,
  consumed: Set<string>,
  candidates: Set<string>,
  parentByChild: Map<string, ParentBinding>,
): void {
  for (const plan of plans.values()) {
    const resolved = plan.resolved;
    const operator = resolved?.rule.project;
    if (!resolved || !operator) continue;
    if (operator.operator === "membership-container") {
      candidates.add(plan.semanticRef);
      for (const quad of graph.store.getQuads(
        plan.semanticRef,
        operator.membershipPredicate,
        null,
        null,
      )) {
        consumed.add(statementIdentityFromQuad(quad));
        if (!isNamedNode(quad.object)) continue;
        candidates.add(quad.object.value);
        parentByChild.set(quad.object.value, {
          parentIri: plan.semanticRef,
          quad,
          rule: resolved,
        });
      }
    } else if (operator.operator === "ordinal-sequence" || operator.operator === "alternative") {
      if (operator.operator === "alternative") candidates.add(plan.semanticRef);
      for (const member of collectOrdinalMembers(
        graph,
        plan.semanticRef,
        operator.ordinalPredicatePrefix,
      )) {
        consumed.add(statementIdentityFromQuad(member.quad));
        if (member.memberIri) candidates.add(member.memberIri);
      }
    }
  }
}

function projectResource(
  graph: SemanticGraph,
  view: DiagramView,
  catalog: ProjectionCatalogV1,
  vocabulary: RdfRdfsVocabulary,
  plan: NamedResourcePlan,
  overlayEntry: OverlayEntry | undefined,
  diagnostics: ProjectionDiagnostic[],
  options: ProjectionOptions | undefined,
): ProjectedNode | ProjectedContainer | undefined {
  const operator = plan.resolved?.rule.project;
  if (operator?.operator === "ordinal-sequence" || operator?.operator === "suppress") return undefined;
  const structuralKind = operator?.operator === "membership-container"
    ? "container"
    : operator?.operator === "resource"
      ? operator.structuralKind
      : "node";
  const defaultTemplateRef = structuralKind === "node"
    ? catalog.defaults!.nodeTemplateRef
    : plan.resolved?.rule.templateRef ?? catalog.defaults!.nodeTemplateRef;
  const ruleTemplateRef = plan.resolved?.rule.templateRef ?? defaultTemplateRef;
  const template = selectTemplate(
    catalog,
    overlayEntry?.overlay.appearance?.templateRef ?? ruleTemplateRef,
    structuralKind,
    plan.semanticRef,
    diagnostics,
    ruleTemplateRef!,
  );
  const elementId = overlayEntry?.elementId
    ?? generatedElementId(structuralKind, plan.semanticRef);
  const common = {
    elementId,
    semanticRef: plan.semanticRef,
    label: selectLabel(graph, plan.semanticRef, vocabulary.labelPredicate, view.locale),
    templateRef: template.templateRef,
    defaultSize: template.defaultSize ?? (structuralKind === "container"
      ? { width: 720, height: 220 }
      : { width: 164, height: 72 }),
    geometry: overlayEntry?.overlay.geometry,
    style: template.style,
    pinned: overlayEntry?.overlay.pinned ?? false,
    placement: overlayEntry?.overlay.placement ?? "generated",
    provenance: resourceProvenance(graph, plan, vocabulary),
  };

  if (structuralKind === "container") {
    return {
      ...common,
      structuralKind,
      headerPosition: template.headerPosition ?? "top",
    };
  }

  const iconRef = overlayEntry?.overlay.appearance?.iconRef ?? template.iconRef;
  return {
    ...common,
    structuralKind,
    shape: template.shape ?? "rounded-rectangle",
    iconRef,
  };
}

function projectDirectEdge(
  graph: SemanticGraph,
  view: DiagramView,
  catalog: ProjectionCatalogV1,
  vocabulary: RdfRdfsVocabulary,
  plan: DirectEdgePlan,
  semanticToElement: ReadonlyMap<string, string>,
  overlays: ReadonlyMap<string, OverlayEntry>,
  diagnostics: ProjectionDiagnostic[],
): ProjectedEdge | undefined {
  if (!isNamedNode(plan.quad.subject) || !isNamedNode(plan.quad.object)) return undefined;
  const sourceElementId = semanticToElement.get(plan.quad.subject.value);
  const targetElementId = semanticToElement.get(plan.quad.object.value);
  const semanticRef = statementIdentityFromQuad(plan.quad);
  if (!sourceElementId || !targetElementId) {
    diagnostics.push({
      severity: "warning",
      code: "edge-endpoint-not-visible",
      message: `${semanticRef}の接続先が現在のviewにありません。`,
      semanticRef,
      statementRef: semanticRef,
    });
    return undefined;
  }
  const overlay = overlays.get(semanticRef);
  const templateRef = plan.resolved?.rule.templateRef ?? catalog.defaults!.edgeTemplateRef;
  const template = selectTemplate(
    catalog,
    overlay?.overlay.appearance?.templateRef ?? templateRef,
    "edge",
    semanticRef,
    diagnostics,
    templateRef,
  );
  const fallback = !plan.resolved || plan.resolved.rule.match.kind === "any-iri-object";
  const waypoints = overlay?.overlay.routing?.waypoints;
  const manualWaypoints = waypoints?.length ? waypoints : undefined;
  return {
    elementId: overlay?.elementId ?? generatedElementId("edge", semanticRef),
    semanticRef,
    structuralKind: "edge",
    label: selectLabel(
      graph,
      plan.quad.predicate.value,
      vocabulary.labelPredicate,
      view.locale,
    ),
    sourceElementId,
    targetElementId,
    templateRef: template.templateRef,
    style: template.style,
    waypoints: manualWaypoints,
    labelOffset: overlay?.overlay.routing?.labelOffset,
    routingPlacement: manualWaypoints ? "user" : "generated",
    fallback,
    provenance: {
      sourceStatementRefs: [semanticRef],
      operator: plan.resolved?.rule.project.operator ?? "implicit-direct-edge",
      rule: plan.resolved ? ruleReference(plan.resolved) : undefined,
      derivation: "direct",
      editCapability: {
        command: "remove-statement",
        statementRef: semanticRef,
        subject: plan.quad.subject.value,
        predicate: plan.quad.predicate.value,
        object: plan.quad.object.value,
      },
    },
  };
}

function projectDerivedEdges(
  graph: SemanticGraph,
  view: DiagramView,
  catalog: ProjectionCatalogV1,
  vocabulary: RdfRdfsVocabulary,
  plans: ReadonlyMap<string, NamedResourcePlan>,
  semanticToElement: ReadonlyMap<string, string>,
  overlays: ReadonlyMap<string, OverlayEntry>,
  edges: ProjectedEdge[],
  diagnostics: ProjectionDiagnostic[],
): void {
  for (const plan of plans.values()) {
    const resolved = plan.resolved;
    const operator = resolved?.rule.project;
    if (!resolved || !operator) continue;
    if (operator.operator === "ordinal-sequence") {
      const members = collectOrdinalMembers(graph, plan.semanticRef, operator.ordinalPredicatePrefix);
      for (let index = 0; index < members.length - 1; index += 1) {
        const from = members[index]!;
        const to = members[index + 1]!;
        if (!from.memberIri || !to.memberIri || from.ordinal === undefined || to.ordinal === undefined) continue;
        const semanticRef = sequenceTransitionIdentity(plan.semanticRef, from.ordinal, to.ordinal);
        const edge = projectDerivedEdge(
          catalog,
          semanticRef,
          "",
          from.memberIri,
          to.memberIri,
          semanticToElement,
          overlays,
          {
            sourceStatementRefs: [
              statementIdentityFromQuad(from.quad),
              statementIdentityFromQuad(to.quad),
            ],
            operator: "ordinal-sequence",
            rule: ruleReference(resolved),
            derivation: "derived",
            editCapability: resolved.rule.match.kind === "type" && resolved.matchedIri
              ? {
                  command: "set-sequence",
                  sequence: plan.semanticRef,
                  sequenceTypeIri: resolved.matchedIri,
                  ordinalPredicatePrefix: operator.ordinalPredicatePrefix,
                }
              : undefined,
          },
          diagnostics,
          resolved.rule.templateRef,
        );
        if (edge) edges.push(edge);
      }
    } else if (operator.operator === "alternative") {
      const sourceElementId = semanticToElement.get(plan.semanticRef);
      if (!sourceElementId) continue;
      const members = collectOrdinalMembers(graph, plan.semanticRef, operator.ordinalPredicatePrefix);
      for (const member of members) {
        if (!member.memberIri || member.ordinal === undefined) continue;
        let targetIri = member.memberIri;
        let label = "";
        const sourceStatements = [statementIdentityFromQuad(member.quad)];
        const memberPlan = plans.get(member.memberIri);
        const memberOperator = memberPlan?.resolved?.rule.project;
        if (memberOperator?.operator === "ordinal-sequence") {
          const first = collectOrdinalMembers(
            graph,
            member.memberIri,
            memberOperator.ordinalPredicatePrefix,
          )[0];
          if (!first?.memberIri) continue;
          targetIri = first.memberIri;
          label = selectLabel(graph, member.memberIri, vocabulary.labelPredicate, view.locale);
          sourceStatements.push(statementIdentityFromQuad(first.quad));
        }
        const semanticRef = alternativeBranchIdentity(plan.semanticRef, member.ordinal);
        const edge = projectDerivedEdge(
          catalog,
          semanticRef,
          label,
          plan.semanticRef,
          targetIri,
          semanticToElement,
          overlays,
          {
            sourceStatementRefs: sourceStatements,
            operator: "alternative",
            rule: ruleReference(resolved),
            derivation: "derived",
            editCapability: resolved.rule.match.kind === "type" && resolved.matchedIri
              ? {
                  command: "set-alternatives",
                  alternative: plan.semanticRef,
                  alternativeTypeIri: resolved.matchedIri,
                  ordinalPredicatePrefix: operator.ordinalPredicatePrefix,
                  defaultOrdinal: operator.defaultOrdinal,
                }
              : undefined,
          },
          diagnostics,
        );
        if (edge) edges.push(edge);
      }
    }
  }
}

function projectDerivedEdge(
  catalog: ProjectionCatalogV1,
  semanticRef: string,
  label: string,
  sourceIri: string,
  targetIri: string,
  semanticToElement: ReadonlyMap<string, string>,
  overlays: ReadonlyMap<string, OverlayEntry>,
  provenance: ProjectionProvenance,
  diagnostics: ProjectionDiagnostic[],
  requestedTemplateRef?: string,
): ProjectedEdge | undefined {
  const sourceElementId = semanticToElement.get(sourceIri);
  const targetElementId = semanticToElement.get(targetIri);
  if (!sourceElementId || !targetElementId) {
    diagnostics.push({
      severity: "warning",
      code: "derived-edge-endpoint-not-visible",
      message: `${semanticRef}の接続先が現在のviewにありません。`,
      semanticRef,
    });
    return undefined;
  }
  const overlay = overlays.get(semanticRef);
  const defaultTemplateRef = catalog.defaults!.edgeTemplateRef;
  const template = selectTemplate(
    catalog,
    overlay?.overlay.appearance?.templateRef ?? requestedTemplateRef ?? defaultTemplateRef,
    "edge",
    semanticRef,
    diagnostics,
    defaultTemplateRef,
  );
  const waypoints = overlay?.overlay.routing?.waypoints;
  const manualWaypoints = waypoints?.length ? waypoints : undefined;
  return {
    elementId: overlay?.elementId ?? generatedElementId("edge", semanticRef),
    semanticRef,
    structuralKind: "edge",
    label,
    sourceElementId,
    targetElementId,
    templateRef: template.templateRef,
    style: template.style,
    waypoints: manualWaypoints,
    labelOffset: overlay?.overlay.routing?.labelOffset,
    routingPlacement: manualWaypoints ? "user" : "generated",
    fallback: false,
    provenance,
  };
}

function applyParentBindings(
  nodes: Map<string, ProjectedNode>,
  containers: Map<string, ProjectedContainer>,
  semanticToElement: ReadonlyMap<string, string>,
  parentByChild: ReadonlyMap<string, ParentBinding>,
): void {
  for (const [childIri, binding] of parentByChild) {
    const child = nodes.get(childIri) ?? containers.get(childIri);
    const parentElementId = semanticToElement.get(binding.parentIri);
    if (!child || !parentElementId) continue;
    child.parentElementId = parentElementId;
    child.parentProvenance = {
      sourceStatementRefs: [statementIdentityFromQuad(binding.quad)],
      operator: "membership-container",
      rule: ruleReference(binding.rule),
      derivation: "derived",
      editCapability: binding.rule.rule.match.kind === "type" && binding.rule.matchedIri
        ? {
            command: "set-membership",
            container: binding.parentIri,
            member: childIri,
            containerTypeIri: binding.rule.matchedIri,
            predicate: binding.quad.predicate.value,
          }
        : undefined,
    };
  }
}

function resourceProvenance(
  graph: SemanticGraph,
  plan: NamedResourcePlan,
  vocabulary: RdfRdfsVocabulary,
): ProjectionProvenance {
  return {
    sourceStatementRefs: graph.store
      .getQuads(plan.semanticRef, vocabulary.typePredicate, null, null)
      .map(statementIdentityFromQuad)
      .sort(compareCodePoints),
    operator: plan.resolved?.rule.project.operator ?? "implicit-resource",
    rule: plan.resolved ? ruleReference(plan.resolved) : undefined,
    derivation: "resource",
  };
}

function ruleReference(resolved: ResolvedProjectionRule): { catalogRef: string; ruleId: string } {
  return { catalogRef: resolved.catalogRef, ruleId: resolved.rule.ruleId };
}

function overlaysForSemantic(
  view: DiagramView,
  diagnostics: ProjectionDiagnostic[],
): ReadonlyMap<string, OverlayEntry> {
  const result = new Map<string, OverlayEntry>();
  for (const [elementId, overlay] of Object.entries(view.overlay).sort(([left], [right]) => (
    compareCodePoints(left, right)
  ))) {
    if (result.has(overlay.semanticRef)) {
      diagnostics.push({
        severity: "error",
        code: "duplicate-overlay-semantic-ref",
        message: `${overlay.semanticRef}を参照するoverlayが複数あります。`,
        semanticRef: overlay.semanticRef,
      });
      continue;
    }
    result.set(overlay.semanticRef, { elementId, overlay });
  }
  return result;
}

function selectTemplate(
  catalog: ProjectionCatalogV1,
  requestedRef: string,
  expectedKind: "node" | "container" | "edge",
  semanticRef: string,
  diagnostics: ProjectionDiagnostic[],
  fallbackRef: string,
): VisualTemplate {
  const requested = catalog.templates[requestedRef];
  if (requested?.structuralKind === expectedKind) return requested;
  diagnostics.push({
    severity: "warning",
    code: requested ? "overlay-template-kind-mismatch" : "overlay-template-unresolved",
    message: `${requestedRef}を${expectedKind}へ適用できないためcatalog既定値を使います。`,
    semanticRef,
    catalogRef: catalogRef(catalog),
  });
  return catalog.templates[fallbackRef]!;
}

function selectLabel(
  graph: SemanticGraph,
  semanticRef: string,
  labelPredicate: string,
  locale: string | undefined,
): string {
  const labels = graph.store
    .getObjects(semanticRef, labelPredicate, null)
    .filter((term): term is Literal => term.termType === "Literal")
    .map((literal) => ({
      language: literal.language.toLowerCase(),
      value: literal.value.normalize("NFC"),
    }))
    .sort((left, right) => (
      compareCodePoints(left.language, right.language)
      || compareCodePoints(left.value, right.value)
    ));
  const normalizedLocale = locale?.toLowerCase();
  const primaryLocale = normalizedLocale?.split("-")[0];
  const selected = (
    normalizedLocale
      ? labels.find((label) => label.language === normalizedLocale)
      : undefined
  ) ?? (
    primaryLocale
      ? labels.find((label) => label.language.split("-")[0] === primaryLocale)
      : undefined
  ) ?? labels.find((label) => !label.language)
    ?? labels[0];
  return selected?.value ?? compactIri(semanticRef);
}

function compactIri(value: string): string {
  const index = Math.max(
    value.lastIndexOf("#"),
    value.lastIndexOf("/"),
    value.lastIndexOf(":"),
  );
  const compact = index >= 0 && index < value.length - 1 ? value.slice(index + 1) : value;
  try {
    return decodeURIComponent(compact);
  } catch {
    return compact;
  }
}

function compareElements(
  left: { elementId: string },
  right: { elementId: string },
): number {
  return compareCodePoints(left.elementId, right.elementId);
}
