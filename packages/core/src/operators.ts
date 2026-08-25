import type { Literal, Quad } from "n3";

import {
  alternativeBranchIdentity,
  generatedElementId,
  statementIdentityFromQuad,
} from "./identity.js";
import { resolveAppearance } from "./appearance.js";
import type {
  DiagramView,
  ProjectedContainer,
  ProjectedEdge,
  ProjectedNode,
  ProjectedMembership,
  ProjectedRegion,
  ProjectedScene,
  ProjectionCatalogV1,
  ProjectionDiagnostic,
  ProjectionOptions,
  ProjectionProvenance,
  ProjectionRule,
  SceneSemanticText,
  ViewElementOverlay,
  VisualTemplate,
} from "./model.js";
import {
  collectOrdinalMembers,
  resolveNamedResourcePlans,
  type NamedResourcePlan,
} from "./profile-validation.js";
import type { RdfsClosure } from "./rdfs-closure.js";
import {
  compareCodePoints,
  distinctNamedSubjects,
  isNamedNode,
  type SemanticGraph,
} from "./rdf.js";
import {
  resolveStatementRule,
  type ResolvedProjectionRule,
} from "./rule-resolution.js";
import { catalogRef, type RdfRdfsVocabulary } from "./standard-catalog.js";
import {
  collectStatementComments,
  namedStatementReifierIris,
} from "./statement-reification.js";

type OverlayEntry = { elementId: string; overlay: ViewElementOverlay };
const LEGACY_REGION_LABEL_ANCHOR = "urn:iriograph:vue-editor:region-label-anchor";
const LEGACY_REGION_LABEL_WRITING_DIRECTION = "urn:iriograph:vue-editor:region-label-writing-direction";
const LEGACY_REGION_Z_ORDER = "urn:iriograph:vue-editor:region-z-order";
type ParentBinding = {
  parentIri: string;
  quad: Quad;
  rule: ResolvedProjectionRule;
  ordinal?: number;
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
  const suppressedResources = new Set(
    [...plans.values()]
      .filter((plan) => plan.resolved?.rule.project.operator === "suppress")
      .map((plan) => plan.semanticRef),
  );
  for (const iri of namedStatementReifierIris(graph)) suppressedResources.add(iri);
  const overlays = overlaysForSemantic(view, diagnostics);
  const consumed = new Set<string>();
  const candidates = new Set(distinctNamedSubjects(graph));
  for (const iri of suppressedResources) candidates.delete(iri);
  const parentsByChild = new Map<string, ParentBinding[]>();

  collectStructuralStatements(
    graph,
    view,
    plans,
    consumed,
    candidates,
    parentsByChild,
    closure,
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
    if (suppressedResources.has(quad.subject.value) || suppressedResources.has(quad.object.value)) {
      continue;
    }
    directEdges.push({ quad, resolved: resolution.resolved });
    candidates.add(quad.subject.value);
    candidates.add(quad.object.value);
  }

  const nodes = new Map<string, ProjectedNode>();
  const containers = new Map<string, ProjectedContainer>();
  const regions = new Map<string, ProjectedRegion>();
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
    else if (element.structuralKind === "region") regions.set(semanticRef, element);
    else nodes.set(semanticRef, element);
  }

  const memberships = applyMembershipBindings(
    view,
    nodes,
    containers,
    regions,
    semanticToElement,
    parentsByChild,
    diagnostics,
  );

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
    suppressedResources,
  );

  return {
    viewId: view.viewId,
    nodes: [...nodes.values()].sort(compareElements),
    containers: [...containers.values()].sort(compareElements),
    regions: [...regions.values()].sort(compareElements),
    memberships,
    edges: edges.sort(compareElements),
    diagnostics,
  };
}

function collectStructuralStatements(
  graph: SemanticGraph,
  view: DiagramView,
  plans: ReadonlyMap<string, NamedResourcePlan>,
  consumed: Set<string>,
  candidates: Set<string>,
  parentsByChild: Map<string, ParentBinding[]>,
  closure: RdfsClosure,
): void {
  for (const plan of plans.values()) {
    const resolved = plan.resolved;
    const operator = resolved?.rule.project;
    if (!resolved || !operator) continue;
    if (operator.operator === "membership-container") {
      candidates.add(plan.semanticRef);
      for (const quad of graph.store.getQuads(plan.semanticRef, null, null, null).filter((candidate) => (
        isNamedNode(candidate.predicate)
        && closure.subpropertyDistance(
          candidate.predicate.value,
          operator.membershipPredicate,
        ) !== undefined
      ))) {
        consumed.add(statementIdentityFromQuad(quad));
        if (!isNamedNode(quad.object)) continue;
        candidates.add(quad.object.value);
        const bindings = parentsByChild.get(quad.object.value) ?? [];
        bindings.push({
          parentIri: plan.semanticRef,
          quad,
          rule: resolved,
        });
        parentsByChild.set(quad.object.value, bindings);
      }
    } else if (operator.operator === "membership-region" && view.kind === "region") {
      candidates.add(plan.semanticRef);
      const quads = operator.containerPosition === "subject"
        ? graph.store.getQuads(plan.semanticRef, null, null, null)
        : graph.store.getQuads(null, null, plan.semanticRef, null);
      for (const quad of quads.filter((candidate) => (
        isNamedNode(candidate.predicate)
        && closure.subpropertyDistance(candidate.predicate.value, operator.membershipPredicate) !== undefined
      ))) {
        const member = operator.containerPosition === "subject" ? quad.object : quad.subject;
        consumed.add(statementIdentityFromQuad(quad));
        if (!isNamedNode(member)) continue;
        candidates.add(member.value);
        const bindings = parentsByChild.get(member.value) ?? [];
        bindings.push({ parentIri: plan.semanticRef, quad, rule: resolved });
        parentsByChild.set(member.value, bindings);
      }
    } else if (operator.operator === "ordinal-sequence" || operator.operator === "alternative") {
      candidates.add(plan.semanticRef);
      for (const member of collectOrdinalMembers(
        graph,
        plan.semanticRef,
        operator.ordinalPredicatePrefix,
      )) {
        consumed.add(statementIdentityFromQuad(member.quad));
        if (member.memberIri) {
          candidates.add(member.memberIri);
          if (operator.operator === "ordinal-sequence" && member.ordinal !== undefined) {
            const bindings = parentsByChild.get(member.memberIri) ?? [];
            bindings.push({
              parentIri: plan.semanticRef,
              quad: member.quad,
              rule: resolved,
              ordinal: member.ordinal,
            });
            parentsByChild.set(member.memberIri, bindings);
          }
        }
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
): ProjectedNode | ProjectedContainer | ProjectedRegion | undefined {
  const operator = plan.resolved?.rule.project;
  if (operator?.operator === "suppress") return undefined;
  const structuralKind = operator?.operator === "ordinal-sequence"
    ? "container"
    : operator?.operator === "membership-container"
    ? view.kind === "region" ? "region" : "container"
    : operator?.operator === "membership-region"
      ? view.kind === "region" ? "region" : "node"
    : operator?.operator === "resource"
      ? operator.structuralKind
      : "node";
  const defaultTemplateRef = structuralKind === "node"
    ? catalog.defaults!.nodeTemplateRef
    : structuralKind === "region"
      ? catalog.defaults?.regionTemplateRef
      : plan.resolved?.rule.templateRef ?? catalog.defaults!.nodeTemplateRef;
  if (!defaultTemplateRef) {
    diagnostics.push({
      severity: "error",
      code: "region-template-unresolved",
      message: `region viewに必要なdefault region templateがありません: ${plan.semanticRef}`,
      semanticRef: plan.semanticRef,
    });
    return undefined;
  }
  const ruleTemplateRef = structuralKind === "region"
    ? defaultTemplateRef
    : plan.resolved?.rule.templateRef ?? defaultTemplateRef;
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
  const semanticText = collectSemanticText(
    graph,
    plan.semanticRef,
    vocabulary.labelPredicate,
    vocabulary.commentPredicate,
    view.locale,
  );
  const common = {
    elementId,
    semanticRef: plan.semanticRef,
    label: semanticText.primaryLabel?.value ?? compactIri(plan.semanticRef),
    semanticText,
    labelPlacement: overlayEntry?.overlay.appearance?.labelPlacement ?? template.labelPlacement,
    templateRef: template.templateRef,
    defaultSize: template.defaultSize ?? (structuralKind === "container" || structuralKind === "region"
      ? { width: 360, height: 220 }
      : { width: 164, height: 72 }),
    geometry: overlayEntry?.overlay.geometry,
    style: resolveAppearance(
      template.style,
      overlayEntry?.overlay.appearance,
      catalog,
      plan.semanticRef,
      diagnostics,
    ).style,
    pinned: overlayEntry?.overlay.pinned ?? false,
    placement: overlayEntry?.overlay.placement ?? "generated",
    provenance: resourceProvenance(graph, plan, vocabulary),
  };

  if (structuralKind === "container") {
    return {
      ...common,
      structuralKind,
      ...(operator?.operator === "ordinal-sequence" ? { groupRole: "sequence" as const } : {}),
      headerPosition: template.headerPosition ?? "top",
    };
  }

  if (structuralKind === "region") {
    const appearance = overlayEntry?.overlay.appearance;
    return {
      ...common,
      structuralKind,
      regionLabelAnchor: regionLabelAnchor(appearance),
      regionLabelWritingDirection: regionLabelWritingDirection(appearance),
      regionZOrder: regionZOrder(appearance),
    };
  }

  const iconRef = overlayEntry?.overlay.appearance?.iconRef ?? template.iconRef;
  return {
    ...common,
    structuralKind,
    shape: template.shape ?? "rounded-rectangle",
    iconRef,
    nodeLabelOffset: overlayEntry?.overlay.appearance?.nodeLabelOffset,
    nodeLabelWritingDirection: overlayEntry?.overlay.appearance?.nodeLabelWritingDirection,
    nodeIconOffset: overlayEntry?.overlay.appearance?.nodeIconOffset,
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
  const semanticText = collectSemanticText(
    graph,
    plan.quad.predicate.value,
    vocabulary.labelPredicate,
    vocabulary.commentPredicate,
    view.locale,
  );
  const routeMode = overlay?.overlay.routing?.routeMode
    ?? (manualWaypoints ? "manual" : template.routeMode ?? "auto");
  return {
    elementId: overlay?.elementId ?? generatedElementId("edge", semanticRef),
    semanticRef,
    structuralKind: "edge",
    label: semanticText.primaryLabel?.value ?? compactIri(plan.quad.predicate.value),
    caption: overlay?.overlay.appearance?.edgeCaption,
    semanticText,
    statementComments: collectStatementComments(graph, {
      subjectIri: plan.quad.subject.value,
      predicateIri: plan.quad.predicate.value,
      objectIri: plan.quad.object.value,
    }),
    labelProvenance: {
      kind: "predicate",
      labelSemanticRef: plan.quad.predicate.value,
      sourceStatementRefs: semanticText.labels.map((value) => value.statementRef),
    },
    sourceElementId,
    targetElementId,
    templateRef: template.templateRef,
    style: resolveAppearance(
      template.style,
      overlay?.overlay.appearance,
      catalog,
      semanticRef,
      diagnostics,
    ).style,
    waypoints: manualWaypoints,
    labelOffset: overlay?.overlay.routing?.labelOffset,
    sourceAnchor: overlay?.overlay.routing?.sourceAnchor,
    targetAnchor: overlay?.overlay.routing?.targetAnchor,
    routeMode,
    sourceMarker: overlay?.overlay.routing?.sourceMarker ?? template.sourceMarker ?? "none",
    targetMarker: overlay?.overlay.routing?.targetMarker ?? template.targetMarker ?? "arrow",
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
  suppressedResources: ReadonlySet<string>,
): void {
  for (const plan of plans.values()) {
    const resolved = plan.resolved;
    const operator = resolved?.rule.project;
    if (!resolved || !operator) continue;
    if (operator.operator === "ordinal-sequence") {
      // rdf:_n denotes membership in an ordered structure. It is deliberately
      // projected as a selectable group plus ordinal member metadata, never as
      // a synthetic predicate edge.
      continue;
    } else if (operator.operator === "alternative") {
      const sourceElementId = semanticToElement.get(plan.semanticRef);
      if (!sourceElementId) continue;
      const members = collectOrdinalMembers(graph, plan.semanticRef, operator.ordinalPredicatePrefix);
      for (const member of members) {
        if (!member.memberIri || member.ordinal === undefined) continue;
        const semanticText = collectSemanticText(
          graph,
          plan.semanticRef,
          vocabulary.labelPredicate,
          vocabulary.commentPredicate,
          view.locale,
        );
        const sourceStatements = [statementIdentityFromQuad(member.quad)];
        const semanticRef = alternativeBranchIdentity(plan.semanticRef, member.ordinal);
        const edge = projectDerivedEdge(
          catalog,
          semanticRef,
          "",
          semanticText,
          {
            kind: "derived-structure",
            role: "alternative-branch",
            structureSemanticRef: plan.semanticRef,
            sourceStatementRefs: [],
          },
          plan.semanticRef,
          member.memberIri,
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
          undefined,
          suppressedResources,
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
  semanticText: SceneSemanticText,
  labelProvenance: ProjectedEdge["labelProvenance"],
  sourceIri: string,
  targetIri: string,
  semanticToElement: ReadonlyMap<string, string>,
  overlays: ReadonlyMap<string, OverlayEntry>,
  provenance: ProjectionProvenance,
  diagnostics: ProjectionDiagnostic[],
  requestedTemplateRef?: string,
  suppressedResources: ReadonlySet<string> = new Set(),
): ProjectedEdge | undefined {
  const sourceElementId = semanticToElement.get(sourceIri);
  const targetElementId = semanticToElement.get(targetIri);
  if (!sourceElementId || !targetElementId) {
    if (suppressedResources.has(sourceIri) || suppressedResources.has(targetIri)) return undefined;
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
  const routeMode = overlay?.overlay.routing?.routeMode
    ?? (manualWaypoints ? "manual" : template.routeMode ?? "auto");
  return {
    elementId: overlay?.elementId ?? generatedElementId("edge", semanticRef),
    semanticRef,
    structuralKind: "edge",
    label,
    caption: overlay?.overlay.appearance?.edgeCaption,
    semanticText,
    labelProvenance,
    sourceElementId,
    targetElementId,
    templateRef: template.templateRef,
    style: resolveAppearance(
      template.style,
      overlay?.overlay.appearance,
      catalog,
      semanticRef,
      diagnostics,
    ).style,
    waypoints: manualWaypoints,
    labelOffset: overlay?.overlay.routing?.labelOffset,
    sourceAnchor: overlay?.overlay.routing?.sourceAnchor,
    targetAnchor: overlay?.overlay.routing?.targetAnchor,
    routeMode,
    sourceMarker: overlay?.overlay.routing?.sourceMarker ?? template.sourceMarker ?? "none",
    targetMarker: overlay?.overlay.routing?.targetMarker ?? template.targetMarker ?? "arrow",
    routingPlacement: manualWaypoints ? "user" : "generated",
    fallback: false,
    provenance,
  };
}

function applyMembershipBindings(
  view: DiagramView,
  nodes: Map<string, ProjectedNode>,
  containers: Map<string, ProjectedContainer>,
  regions: Map<string, ProjectedRegion>,
  semanticToElement: ReadonlyMap<string, string>,
  parentsByChild: ReadonlyMap<string, ParentBinding[]>,
  diagnostics: ProjectionDiagnostic[],
): ProjectedMembership[] {
  const memberships: ProjectedMembership[] = [];
  for (const [childIri, unsortedBindings] of [...parentsByChild.entries()].sort(([left], [right]) => (
    compareCodePoints(left, right)
  ))) {
    const child = nodes.get(childIri) ?? containers.get(childIri) ?? regions.get(childIri);
    if (!child) continue;
    const bindings = [...unsortedBindings].sort((left, right) => (
      compareCodePoints(left.parentIri, right.parentIri)
      || compareCodePoints(statementIdentityFromQuad(left.quad), statementIdentityFromQuad(right.quad))
    ));
    const visible = bindings.flatMap((binding) => {
      const parentElementId = semanticToElement.get(binding.parentIri);
      return parentElementId ? [{ binding, parentElementId }] : [];
    });
    for (const { binding, parentElementId } of visible) {
      const provenance = membershipProvenance(childIri, binding);
      memberships.push({
        semanticRef: statementIdentityFromQuad(binding.quad),
        containerElementId: parentElementId,
        memberElementId: child.elementId,
        ...(view.kind === "region" && binding.rule.rule.project.operator !== "ordinal-sequence"
          ? { regionElementId: parentElementId }
          : {}),
        role: binding.rule.rule.project.operator === "ordinal-sequence"
          ? "sequence-member"
          : "membership",
        ...(binding.ordinal !== undefined ? { ordinal: binding.ordinal } : {}),
        provenance,
      });
    }
    const parentBindings = new Map<string, ParentBinding>();
    for (const entry of visible) {
      if (!parentBindings.has(entry.parentElementId)) {
        parentBindings.set(entry.parentElementId, entry.binding);
      }
    }
    const sequenceParents = new Map(
      [...parentBindings].filter(([, binding]) => (
        binding.rule.rule.project.operator === "ordinal-sequence"
      )),
    );
    const membershipParents = new Map(
      [...parentBindings].filter(([, binding]) => (
        binding.rule.rule.project.operator === "membership-container"
      )),
    );
    const hierarchicalParents = sequenceParents.size > 0
      ? sequenceParents
      : view.kind === "node-link" ? membershipParents : new Map<string, ParentBinding>();
    if (hierarchicalParents.size === 0) continue;
    if (hierarchicalParents.size > 1) {
      if (sequenceParents.size === 0) diagnostics.push({
        severity: "warning",
        code: "multiple-container-memberships-not-hierarchical",
        message: `${childIri}の${hierarchicalParents.size}件のcontainer membershipはhierarchy parentへ縮約せず保持します。`,
        semanticRef: childIri,
      });
      continue;
    }
    if (child.structuralKind === "region") continue;
    const [parentElementId, binding] = [...hierarchicalParents.entries()][0]!;
    child.parentElementId = parentElementId;
    child.parentProvenance = membershipProvenance(childIri, binding);
  }
  return memberships.sort((left, right) => compareCodePoints(left.semanticRef, right.semanticRef));
}

function membershipProvenance(
  childIri: string,
  binding: ParentBinding,
): ProjectionProvenance {
  const operator = binding.rule.rule.project;
  return {
      sourceStatementRefs: [statementIdentityFromQuad(binding.quad)],
      operator: binding.rule.rule.project.operator,
      rule: ruleReference(binding.rule),
      derivation: "derived",
      editCapability: binding.rule.rule.match.kind === "type" && binding.rule.matchedIri
        ? operator.operator === "ordinal-sequence"
          ? {
              command: "set-sequence",
              sequence: binding.parentIri,
              sequenceTypeIri: binding.rule.matchedIri,
              ordinalPredicatePrefix: operator.ordinalPredicatePrefix,
            }
          : {
            command: "set-membership",
            container: binding.parentIri,
            member: childIri,
            containerTypeIri: binding.rule.matchedIri,
            predicate: binding.quad.predicate.value,
            containerPosition: operator.operator === "membership-region"
              ? operator.containerPosition
              : "subject",
          }
        : undefined,
  };
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
  expectedKind: "node" | "container" | "region" | "edge",
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

function collectSemanticText(
  graph: SemanticGraph,
  semanticRef: string,
  labelPredicate: string,
  commentPredicate: string,
  locale: string | undefined,
): SceneSemanticText {
  const values = (predicateIri: string) => graph.store
    .getQuads(semanticRef, predicateIri, null, null)
    .filter((quad): quad is Quad & { object: Literal } => quad.object.termType === "Literal")
    .map((quad) => ({
      value: quad.object.value.normalize("NFC"),
      predicateIri,
      statementRef: statementIdentityFromQuad(quad),
      ...(quad.object.language ? { language: quad.object.language.toLowerCase() } : {}),
      ...(quad.object.datatype?.value ? { datatypeIri: quad.object.datatype.value } : {}),
    }))
    .sort((left, right) => (
      compareCodePoints(left.language ?? "", right.language ?? "")
      || compareCodePoints(left.value, right.value)
      || compareCodePoints(left.statementRef, right.statementRef)
    ));
  const labels = values(labelPredicate);
  const comments = values(commentPredicate);
  const normalizedLocale = locale?.toLowerCase();
  const primaryLocale = normalizedLocale?.split("-")[0];
  const selected = (
    normalizedLocale
      ? labels.find((label) => label.language === normalizedLocale)
      : undefined
  ) ?? (
    primaryLocale
      ? labels.find((label) => label.language?.split("-")[0] === primaryLocale)
      : undefined
  ) ?? labels.find((label) => !label.language)
    ?? labels[0];
  return {
    ...(selected ? { primaryLabel: selected } : {}),
    labels,
    comments,
  };
}

function regionLabelAnchor(
  appearance: ViewElementOverlay["appearance"] | undefined,
): number | undefined {
  const value = appearance?.regionLabelAnchor
    ?? appearance?.extensions?.[LEGACY_REGION_LABEL_ANCHOR];
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value < 1
    ? value
    : undefined;
}

function regionLabelWritingDirection(
  appearance: ViewElementOverlay["appearance"] | undefined,
): "horizontal-right" | "vertical-down" | undefined {
  if (appearance?.regionLabelWritingDirection) return appearance.regionLabelWritingDirection;
  const legacy = appearance?.extensions?.[LEGACY_REGION_LABEL_WRITING_DIRECTION];
  if (legacy === "horizontal") return "horizontal-right";
  if (legacy === "vertical") return "vertical-down";
  return undefined;
}

function regionZOrder(
  appearance: ViewElementOverlay["appearance"] | undefined,
): number | undefined {
  const value = appearance?.regionZOrder
    ?? appearance?.extensions?.[LEGACY_REGION_Z_ORDER];
  return typeof value === "number" && Number.isSafeInteger(value) ? value : undefined;
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
