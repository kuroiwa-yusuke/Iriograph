import { DataFactory, Parser, Store, type NamedNode, type Quad, type Term } from "n3";

import type {
  DiagramCatalog,
  DiagramScene,
  DiagramView,
  ElementGeometry,
  IriographDocument,
  ProjectionDiagnostic,
  ProjectionOptions,
  SceneContainer,
  SceneEdge,
  SceneNode,
  ViewElementOverlay,
  VisualTemplate,
} from "./model";

const { namedNode } = DataFactory;

const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const RDFS_LABEL = "http://www.w3.org/2000/01/rdf-schema#label";
const SKOS_PREF_LABEL = "http://www.w3.org/2004/02/skos/core#prefLabel";

export function projectIriographDocument(
  document: IriographDocument,
  catalog: DiagramCatalog,
  viewId = document.views[0]?.viewId,
  options: ProjectionOptions = {},
): DiagramScene {
  const view = document.views.find((candidate) => candidate.viewId === viewId);
  if (!view) {
    throw new Error(`viewが存在しません: ${viewId ?? "<undefined>"}`);
  }

  const diagnostics: ProjectionDiagnostic[] = [];
  const quads = parseSemanticSource(document, diagnostics);
  const store = new Store(quads);
  const relationTypes = new Set(catalog.relationRules.map((rule) => rule.rdfType));
  const relationResources = new Set<string>();
  const nodeRecords = new Map<string, SceneNode>();
  const containerRecords = new Map<string, SceneContainer>();
  const semanticToElement = new Map<string, string>();
  const overlaysBySemantic = overlaysForSemantic(view);

  for (const typeQuad of store.getQuads(null, namedNode(RDF_TYPE), null, null)) {
    if (typeQuad.subject.termType !== "NamedNode" || typeQuad.object.termType !== "NamedNode") continue;
    if (relationTypes.has(typeQuad.object.value)) relationResources.add(typeQuad.subject.value);
  }

  const typedResources = distinctNamedSubjects(store.getQuads(null, namedNode(RDF_TYPE), null, null));
  let fallbackIndex = 0;
  for (const semanticRef of typedResources) {
    if (relationResources.has(semanticRef)) continue;
    const rdfTypes = store
      .getObjects(namedNode(semanticRef), namedNode(RDF_TYPE), null)
      .filter(isNamedNode)
      .map((term) => term.value);
    const matchingRules = catalog.nodeRules
      .filter((rule) => rdfTypes.includes(rule.rdfType))
      .sort((left, right) => (right.priority ?? 0) - (left.priority ?? 0));
    const rule = matchingRules[0];
    if (matchingRules.length > 1 && (matchingRules[0]?.priority ?? 0) === (matchingRules[1]?.priority ?? 0)) {
      diagnostics.push({
        severity: "warning",
        code: "ambiguous-node-rule",
        message: `${semanticRef}に同優先度のnode ruleが複数一致しました。`,
        semanticRef,
      });
    }
    const structuralKind = rule?.structuralKind ?? "node";
    const overlayEntry = overlaysBySemantic.get(semanticRef);
    const templateRef = overlayEntry?.overlay.appearance?.templateRef
      ?? rule?.templateRef
      ?? catalog.defaults.nodeTemplateRef;
    const template = requireTemplate(catalog, templateRef, structuralKind);
    const elementId = overlayEntry?.elementId ?? generatedElementId(structuralKind, semanticRef);
    const overlay = overlayEntry?.overlay;
    const geometry = overlay?.geometry ?? fallbackGeometry(template, structuralKind, fallbackIndex++);
    const label = labelFor(store, semanticRef, rule?.labelPath);
    const style = template.style;
    semanticToElement.set(semanticRef, elementId);

    if (structuralKind === "container") {
      containerRecords.set(semanticRef, {
        elementId,
        semanticRef,
        structuralKind,
        label,
        templateRef,
        geometry,
        headerPosition: template.headerPosition ?? "top",
        style,
        pinned: overlay?.pinned ?? false,
        placement: overlay?.placement ?? "generated",
        projectionRuleId: rule?.ruleId,
      });
      continue;
    }

    const iconRef = overlay?.appearance?.iconRef ?? template.iconRef;
    nodeRecords.set(semanticRef, {
      elementId,
      semanticRef,
      structuralKind,
      label,
      templateRef,
      shape: template.shape ?? "rounded-rectangle",
      iconRef,
      iconUrl: iconRef
        ? options.resolveAssetUrl?.(iconRef, catalog.assets[iconRef])
          ?? catalog.assets[iconRef]?.url
        : undefined,
      geometry,
      style,
      pinned: overlay?.pinned ?? false,
      placement: overlay?.placement ?? "generated",
      projectionRuleId: rule?.ruleId,
    });
  }

  const parentByChild = resolveContainment(store, catalog);
  for (const [childRef, parentRef] of parentByChild) {
    const child = nodeRecords.get(childRef);
    const parentElementId = semanticToElement.get(parentRef);
    if (child && parentElementId) child.parentElementId = parentElementId;
  }

  const edges: SceneEdge[] = [];
  const consumedPredicates = new Set<string>([
    RDF_TYPE,
    RDFS_LABEL,
    SKOS_PREF_LABEL,
    ...catalog.containmentRules.map((rule) => rule.predicate),
    ...catalog.relationRules.flatMap((rule) => [rule.sourcePath, rule.targetPath, rule.labelPath].filter(isString)),
  ]);

  for (const relationRef of relationResources) {
    const rdfTypes = store
      .getObjects(namedNode(relationRef), namedNode(RDF_TYPE), null)
      .filter(isNamedNode)
      .map((term) => term.value);
    const rule = catalog.relationRules
      .filter((candidate) => rdfTypes.includes(candidate.rdfType))
      .sort((left, right) => (right.priority ?? 0) - (left.priority ?? 0))[0];
    if (!rule) continue;
    const sourceRef = firstNamedObject(store, relationRef, rule.sourcePath);
    const targetRef = firstNamedObject(store, relationRef, rule.targetPath);
    if (!sourceRef || !targetRef) {
      diagnostics.push({
        severity: "error",
        code: "incomplete-relation",
        message: `${relationRef}のsourceまたはtargetを解決できません。`,
        semanticRef: relationRef,
      });
      continue;
    }
    const sourceElementId = semanticToElement.get(sourceRef);
    const targetElementId = semanticToElement.get(targetRef);
    if (!sourceElementId || !targetElementId) {
      diagnostics.push({
        severity: "warning",
        code: "relation-endpoint-not-visible",
        message: `${relationRef}の接続先が現在のviewにありません。`,
        semanticRef: relationRef,
      });
      continue;
    }
    const overlayEntry = overlaysBySemantic.get(relationRef);
    const template = requireTemplate(catalog, rule.templateRef, "edge");
    edges.push({
      elementId: overlayEntry?.elementId ?? generatedElementId("edge", relationRef),
      semanticRef: relationRef,
      structuralKind: "edge",
      label: labelFor(store, relationRef, rule.labelPath),
      sourceElementId,
      targetElementId,
      templateRef: rule.templateRef,
      style: template.style,
      waypoints: overlayEntry?.overlay.routing?.waypoints,
      projectionRuleId: rule.ruleId,
      fallback: false,
    });
  }

  for (const quad of quads) {
    if (!isNamedNode(quad.subject) || !isNamedNode(quad.predicate) || !isNamedNode(quad.object)) continue;
    if (consumedPredicates.has(quad.predicate.value)) continue;
    if (relationResources.has(quad.subject.value)) continue;
    const sourceElementId = semanticToElement.get(quad.subject.value);
    const targetElementId = semanticToElement.get(quad.object.value);
    if (!sourceElementId || !targetElementId) continue;
    const semanticRef = statementRef(quad);
    const overlayEntry = overlaysBySemantic.get(semanticRef);
    const template = requireTemplate(catalog, catalog.defaults.edgeTemplateRef, "edge");
    edges.push({
      elementId: overlayEntry?.elementId ?? generatedElementId("edge", semanticRef),
      semanticRef,
      structuralKind: "edge",
      label: compactIri(quad.predicate.value),
      sourceElementId,
      targetElementId,
      templateRef: catalog.defaults.edgeTemplateRef,
      style: template.style,
      waypoints: overlayEntry?.overlay.routing?.waypoints,
      fallback: true,
    });
  }

  return {
    viewId: view.viewId,
    width: 1120,
    height: 680,
    nodes: [...nodeRecords.values()],
    containers: [...containerRecords.values()],
    edges,
    diagnostics,
  };
}

export function parseIriographSemanticSource(document: IriographDocument): Quad[] {
  return new Parser({ baseIRI: document.semantic.baseIri, format: "text/turtle" }).parse(document.semantic.source);
}

function parseSemanticSource(document: IriographDocument, diagnostics: ProjectionDiagnostic[]): Quad[] {
  try {
    return parseIriographSemanticSource(document);
  } catch (cause) {
    diagnostics.push({
      severity: "error",
      code: "invalid-turtle",
      message: cause instanceof Error ? cause.message : String(cause),
    });
    return [];
  }
}

function resolveContainment(store: Store, catalog: DiagramCatalog): Map<string, string> {
  const result = new Map<string, string>();
  for (const rule of catalog.containmentRules) {
    for (const quad of store.getQuads(null, namedNode(rule.predicate), null, null)) {
      const child = rule.child === "subject" ? quad.subject : quad.object;
      const parent = rule.parent === "subject" ? quad.subject : quad.object;
      if (isNamedNode(child) && isNamedNode(parent)) result.set(child.value, parent.value);
    }
  }
  return result;
}

function overlaysForSemantic(view: DiagramView): Map<string, { elementId: string; overlay: ViewElementOverlay }> {
  return new Map(
    Object.entries(view.overlay).map(([elementId, overlay]) => [overlay.semanticRef, { elementId, overlay }]),
  );
}

function distinctNamedSubjects(quads: Quad[]): string[] {
  return [...new Set(quads.filter((quad) => isNamedNode(quad.subject)).map((quad) => quad.subject.value))];
}

function labelFor(store: Store, semanticRef: string, preferredPath?: string): string {
  const predicates = [preferredPath, RDFS_LABEL, SKOS_PREF_LABEL].filter(isString);
  for (const predicate of predicates) {
    const value = store.getObjects(namedNode(semanticRef), namedNode(predicate), null)[0];
    if (value?.termType === "Literal") return value.value;
    if (value?.termType === "NamedNode") return compactIri(value.value);
  }
  return compactIri(semanticRef);
}

function firstNamedObject(store: Store, subject: string, predicate: string): string | undefined {
  return store.getObjects(namedNode(subject), namedNode(predicate), null).find(isNamedNode)?.value;
}

function fallbackGeometry(
  template: VisualTemplate,
  structuralKind: "node" | "container",
  index: number,
): ElementGeometry {
  const size = template.defaultSize ?? (structuralKind === "container"
    ? { width: 960, height: 220 }
    : { width: 164, height: 72 });
  return {
    x: structuralKind === "container" ? 60 : 100 + (index % 4) * 210,
    y: structuralKind === "container" ? 60 + index * 240 : 120 + Math.floor(index / 4) * 140,
    width: size.width,
    height: size.height,
  };
}

function requireTemplate(
  catalog: DiagramCatalog,
  templateRef: string,
  expectedKind: VisualTemplate["structuralKind"],
): VisualTemplate {
  const template = catalog.templates[templateRef];
  if (!template) throw new Error(`templateがcatalogにありません: ${templateRef}`);
  if (template.structuralKind !== expectedKind) {
    throw new Error(`${templateRef}は${expectedKind} templateではありません。`);
  }
  return template;
}

function generatedElementId(kind: string, semanticRef: string): string {
  return `${kind}:${semanticRef}`;
}

function statementRef(quad: Quad): string {
  return `statement:${quad.subject.value}|${quad.predicate.value}|${quad.object.value}`;
}

function compactIri(value: string): string {
  const hashIndex = value.lastIndexOf("#");
  const slashIndex = value.lastIndexOf("/");
  const colonIndex = value.lastIndexOf(":");
  const index = Math.max(hashIndex, slashIndex, colonIndex);
  return index >= 0 && index < value.length - 1 ? decodeURIComponent(value.slice(index + 1)) : value;
}

function isNamedNode(term: Term): term is NamedNode {
  return term.termType === "NamedNode";
}

function isString(value: string | undefined): value is string {
  return typeof value === "string";
}
