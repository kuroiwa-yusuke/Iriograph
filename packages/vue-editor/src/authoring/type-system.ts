import {
  compareCodePoints,
  parseSemanticGraph,
  type AuthoringCommand,
  type AuthoringLiteralValue,
  type IriographDocument,
} from "@iriograph/core";

import {
  translateEditorMessage,
  type EditorTranslator,
} from "../localization/editor-localization";

const defaultTranslator: EditorTranslator = (key, parameters) => (
  translateEditorMessage("en", key, parameters)
);

const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const RDF_PROPERTY = "http://www.w3.org/1999/02/22-rdf-syntax-ns#Property";
const RDF_STATEMENT = "http://www.w3.org/1999/02/22-rdf-syntax-ns#Statement";
const RDF_BAG = "http://www.w3.org/1999/02/22-rdf-syntax-ns#Bag";
const RDF_SEQ = "http://www.w3.org/1999/02/22-rdf-syntax-ns#Seq";
const RDF_ALT = "http://www.w3.org/1999/02/22-rdf-syntax-ns#Alt";
const RDF_LIST = "http://www.w3.org/1999/02/22-rdf-syntax-ns#List";
const RDFS_CLASS = "http://www.w3.org/2000/01/rdf-schema#Class";
const RDFS_RESOURCE = "http://www.w3.org/2000/01/rdf-schema#Resource";
const RDFS_LITERAL = "http://www.w3.org/2000/01/rdf-schema#Literal";
const RDFS_DATATYPE = "http://www.w3.org/2000/01/rdf-schema#Datatype";
const RDFS_LABEL = "http://www.w3.org/2000/01/rdf-schema#label";
const RDFS_COMMENT = "http://www.w3.org/2000/01/rdf-schema#comment";
const RDFS_SUBCLASS_OF = "http://www.w3.org/2000/01/rdf-schema#subClassOf";
/** Document-declared domain classes outrank low-priority general authoring roles. */
const DOMAIN_CLASS_DISPLAY_PRIORITY = 100;
const STRUCTURAL_TYPE_IRIS = new Set([
  RDF_PROPERTY,
  RDF_STATEMENT,
  RDF_BAG,
  RDF_SEQ,
  RDF_ALT,
  RDF_LIST,
  RDFS_CLASS,
  RDFS_RESOURCE,
  RDFS_LITERAL,
  RDFS_DATATYPE,
]);

export type TypeSystemProfileRole = {
  roleId: string;
  classIri: string;
  label: string;
  description?: string;
  /** Higher values are preferred when incomparable direct types compete for one tag. */
  displayPriority?: number;
};

export type TypeSystemProfile = {
  nodeRoles: readonly TypeSystemProfileRole[];
};

export type TypeSystemTypePresentation = {
  typeId: string;
  label: string;
  description?: string;
  parentTypeIds: readonly string[];
  childTypeIds: readonly string[];
  directResourceIds: readonly string[];
  inheritedResourceIds: readonly string[];
  directCount: number;
  inheritedCount: number;
  deleteImpact: {
    directResourceCount: number;
    inheritedResourceCount: number;
    childTypeCount: number;
  };
};

export type TypeSystemResourcePresentation = {
  resourceId: string;
  label: string;
  directTypeIds: readonly string[];
  inheritedTypeIds: readonly string[];
  /** False for semantic resources that are not diagram nodes and cannot be bulk-assigned. */
  assignmentEligible: boolean;
  /** The sole compact tag that a diagram may render. */
  primaryDirectTypeId?: string;
};

export type DiagramNodeTypeTagPresentation = {
  typeId: string;
  resourceId: string;
  label: string;
  additionalDirectCount: number;
  inheritedCount: number;
};

export type TypeSystemTreeRow = {
  rowId: string;
  typeId: string;
  parentTypeId?: string;
  depth: number;
  reference: boolean;
};

export type TypeSystemPresentation = {
  types: readonly TypeSystemTypePresentation[];
  resources: readonly TypeSystemResourcePresentation[];
  rootTypeIds: readonly string[];
  /** Existing source cycles are reported by opaque identity and never silently repaired. */
  cycles: readonly (readonly string[])[];
};

export type TypeSystemFocus = {
  typeId: string;
  resourceId?: string;
};

export type TypeSystemShowInDiagramRequest = {
  typeId: string;
  resourceIds: readonly string[];
  scope: "direct" | "direct-and-inherited";
  focusResourceId?: string;
};

export type TypeSystemAction =
  | {
      type: "create-class";
      label: string;
      description?: string;
      parentTypeIds: readonly string[];
    }
  | {
      type: "edit-class";
      typeId: string;
      label: string;
      description?: string;
      parentTypeIds: readonly string[];
    }
  | {
      type: "delete-class";
      typeId: string;
    }
  | {
      type: "bulk-add-type" | "bulk-remove-type";
      typeId: string;
      resourceIds: readonly string[];
    };

export type TypeSystemCompileOptions = {
  commandId: string;
  /** Omit this to let the configured core allocator issue the new exact identity. */
  createdTypeIri?: string;
  defaultLocale?: string;
};

export type TypeSystemCommandBatch = {
  atomic: true;
  actionType: TypeSystemAction["type"];
  commands: readonly AuthoringCommand[];
};

export type TypeSystemCompileResult =
  | { ok: true; batch: TypeSystemCommandBatch }
  | {
      ok: false;
      code: "invalid-label" | "unknown-type" | "unknown-resource" | "duplicate-id" | "cycle";
      message: string;
      cycleTypeIds?: readonly string[];
    };

type ExactTypeSystemIndex = {
  typeIriById: ReadonlyMap<string, string>;
  resourceIriById: ReadonlyMap<string, string>;
  directTypeIrisByResourceId: ReadonlyMap<string, readonly string[]>;
  labelValuesByTypeId: ReadonlyMap<string, readonly AuthoringLiteralValue[]>;
  commentValuesByTypeId: ReadonlyMap<string, readonly AuthoringLiteralValue[]>;
};

/**
 * Keeps exact identities behind an explicit resolver/compile boundary. Only
 * `presentation` should be passed to normal Vue rendering.
 */
export class TypeSystemIndex {
  readonly presentation: TypeSystemPresentation;
  readonly #exact: ExactTypeSystemIndex;

  constructor(presentation: TypeSystemPresentation, exact: ExactTypeSystemIndex) {
    this.presentation = presentation;
    this.#exact = exact;
  }

  resolveTypeId(typeId: string): string | undefined {
    return this.#exact.typeIriById.get(typeId);
  }

  resolveResourceId(resourceId: string): string | undefined {
    return this.#exact.resourceIriById.get(resourceId);
  }

  compileAction(
    action: TypeSystemAction,
    options: TypeSystemCompileOptions,
    translator: EditorTranslator = defaultTranslator,
  ): TypeSystemCompileResult {
    return compileTypeSystemAction(this.presentation, this.#exact, action, options, translator);
  }
}

export function deriveTypeSystem(
  document: IriographDocument,
  options: {
    authoringProfile?: TypeSystemProfile;
    locale?: string;
    /** Exact scene-node identities supplied only at the derivation boundary. */
    resourceIris?: readonly string[];
  } = {},
  translator: EditorTranslator = defaultTranslator,
): TypeSystemIndex {
  const graph = parseSemanticGraph(document);
  const classIris = new Set<string>();
  const parentIrisByClass = new Map<string, Set<string>>();
  const directTypeIrisByResource = new Map<string, Set<string>>();

  for (const quad of graph.store.getQuads(null, RDF_TYPE, null, null)) {
    if (quad.subject.termType !== "NamedNode" || quad.object.termType !== "NamedNode") continue;
    if (quad.object.value === RDFS_CLASS) {
      classIris.add(quad.subject.value);
      continue;
    }
    if (STRUCTURAL_TYPE_IRIS.has(quad.object.value)) continue;
    classIris.add(quad.object.value);
    addToSetMap(directTypeIrisByResource, quad.subject.value, quad.object.value);
  }
  for (const quad of graph.store.getQuads(null, RDFS_SUBCLASS_OF, null, null)) {
    if (quad.subject.termType !== "NamedNode" || quad.object.termType !== "NamedNode") continue;
    classIris.add(quad.subject.value);
    classIris.add(quad.object.value);
    addToSetMap(parentIrisByClass, quad.subject.value, quad.object.value);
  }
  for (const role of options.authoringProfile?.nodeRoles ?? []) classIris.add(role.classIri);
  for (const resourceIri of options.resourceIris ?? []) {
    if (!classIris.has(resourceIri) && !directTypeIrisByResource.has(resourceIri)) {
      directTypeIrisByResource.set(resourceIri, new Set());
    }
  }

  const roleByClass = rolesByClass(options.authoringProfile?.nodeRoles ?? []);
  const locale = options.locale ?? "";
  const typeLabelByIri = new Map([...classIris].map((classIri) => {
    const role = roleByClass.get(classIri)?.[0];
    const label = preferredLiteral(graph.store.getObjects(classIri, RDFS_LABEL, null), locale)
      ?? role?.label
      ?? translator("typeSystem.unnamedType", {
        id: stableOpaqueId("type", classIri).slice(-6),
      });
    return [classIri, label] as const;
  }));
  const typeDescriptionByIri = new Map([...classIris].map((classIri) => {
    const role = roleByClass.get(classIri)?.[0];
    return [classIri, preferredLiteral(graph.store.getObjects(classIri, RDFS_COMMENT, null), locale)
      ?? role?.description] as const;
  }));

  const typeIris = [...classIris].sort((left, right) => compareLabelFirst(
    typeLabelByIri.get(left)!,
    typeLabelByIri.get(right)!,
    left,
    right,
    locale,
  ));
  const typeIdByIri = new Map(typeIris.map((iri) => [iri, stableOpaqueId("type", iri)]));
  const typeIriById = new Map(typeIris.map((iri) => [typeIdByIri.get(iri)!, iri]));

  const resourceIris = [...directTypeIrisByResource.keys()];
  const resourceLabelByIri = new Map(resourceIris.map((resourceIri) => [
    resourceIri,
    preferredLiteral(graph.store.getObjects(resourceIri, RDFS_LABEL, null), locale)
      ?? translator("typeSystem.unnamedResource", {
        id: stableOpaqueId("resource", resourceIri).slice(-6),
      }),
  ]));
  resourceIris.sort((left, right) => compareLabelFirst(
    resourceLabelByIri.get(left)!,
    resourceLabelByIri.get(right)!,
    left,
    right,
    locale,
  ));
  const resourceIdByIri = new Map(resourceIris.map((iri) => [iri, stableOpaqueId("resource", iri)]));
  const resourceIriById = new Map(resourceIris.map((iri) => [resourceIdByIri.get(iri)!, iri]));

  const ancestorsByClass = new Map(typeIris.map((classIri) => [
    classIri,
    transitiveParents(classIri, parentIrisByClass),
  ]));
  const childrenByClass = new Map<string, Set<string>>();
  for (const [childIri, parentIris] of parentIrisByClass) {
    for (const parentIri of parentIris) addToSetMap(childrenByClass, parentIri, childIri);
  }

  const directResourcesByClass = new Map<string, Set<string>>();
  const inheritedResourcesByClass = new Map<string, Set<string>>();
  for (const [resourceIri, directTypes] of directTypeIrisByResource) {
    for (const directType of directTypes) addToSetMap(directResourcesByClass, directType, resourceIri);
    for (const directType of directTypes) {
      for (const ancestor of ancestorsByClass.get(directType) ?? []) {
        if (!directTypes.has(ancestor)) addToSetMap(inheritedResourcesByClass, ancestor, resourceIri);
      }
    }
  }

  const resourceIdComparator = idComparator(resourceIriById, resourceLabelByIri, locale);
  const typeIdComparator = idComparator(typeIriById, typeLabelByIri, locale);
  const types = typeIris.map((classIri): TypeSystemTypePresentation => {
    const directResourceIds = [...(directResourcesByClass.get(classIri) ?? [])]
      .map((iri) => resourceIdByIri.get(iri)!)
      .sort(resourceIdComparator);
    const inheritedResourceIds = [...(inheritedResourcesByClass.get(classIri) ?? [])]
      .map((iri) => resourceIdByIri.get(iri)!)
      .sort(resourceIdComparator);
    const childTypeIds = [...(childrenByClass.get(classIri) ?? [])]
      .map((iri) => typeIdByIri.get(iri)!)
      .sort(typeIdComparator);
    return {
      typeId: typeIdByIri.get(classIri)!,
      label: typeLabelByIri.get(classIri)!,
      ...(typeDescriptionByIri.get(classIri)
        ? { description: typeDescriptionByIri.get(classIri) }
        : {}),
      parentTypeIds: [...(parentIrisByClass.get(classIri) ?? [])]
        .map((iri) => typeIdByIri.get(iri)!)
        .sort(typeIdComparator),
      childTypeIds,
      directResourceIds,
      inheritedResourceIds,
      directCount: directResourceIds.length,
      inheritedCount: inheritedResourceIds.length,
      deleteImpact: {
        directResourceCount: directResourceIds.length,
        inheritedResourceCount: inheritedResourceIds.length,
        childTypeCount: childTypeIds.length,
      },
    };
  });

  const priorityByClass = new Map([...roleByClass].map(([classIri, roles]) => [
    classIri,
    roles.find((role) => Number.isFinite(role.displayPriority))?.displayPriority
      ?? Number.NEGATIVE_INFINITY,
  ]));
  const assignmentResourceIris = options.resourceIris
    ? new Set(options.resourceIris)
    : undefined;
  const resources = resourceIris.map((resourceIri): TypeSystemResourcePresentation => {
    const directIris = [...(directTypeIrisByResource.get(resourceIri) ?? [])];
    const directTypeIds = directIris.map((iri) => typeIdByIri.get(iri)!).sort(typeIdComparator);
    const inheritedIris = new Set<string>();
    for (const directIri of directIris) {
      for (const ancestor of ancestorsByClass.get(directIri) ?? []) {
        if (!directIris.includes(ancestor)) inheritedIris.add(ancestor);
      }
    }
    const primaryIri = primaryDirectType(directIris, ancestorsByClass, priorityByClass);
    return {
      resourceId: resourceIdByIri.get(resourceIri)!,
      label: resourceLabelByIri.get(resourceIri)!,
      directTypeIds,
      inheritedTypeIds: [...inheritedIris].map((iri) => typeIdByIri.get(iri)!).sort(typeIdComparator),
      assignmentEligible: assignmentResourceIris?.has(resourceIri) ?? true,
      ...(primaryIri ? { primaryDirectTypeId: typeIdByIri.get(primaryIri)! } : {}),
    };
  });

  const presentation: TypeSystemPresentation = {
    types,
    resources,
    rootTypeIds: types.filter((item) => item.parentTypeIds.length === 0).map((item) => item.typeId),
    cycles: stronglyConnectedCycles(typeIris, parentIrisByClass)
      .map((cycle) => cycle.map((iri) => typeIdByIri.get(iri)!).sort(typeIdComparator)),
  };
  return new TypeSystemIndex(presentation, {
    typeIriById,
    resourceIriById,
    directTypeIrisByResourceId: new Map(resourceIris.map((resourceIri) => [
      resourceIdByIri.get(resourceIri)!,
      [...(directTypeIrisByResource.get(resourceIri) ?? [])].sort(compareCodePoints),
    ])),
    labelValuesByTypeId: new Map(typeIris.map((typeIri) => [
      typeIdByIri.get(typeIri)!,
      authoringLiteralValues(graph.store.getObjects(typeIri, RDFS_LABEL, null)),
    ])),
    commentValuesByTypeId: new Map(typeIris.map((typeIri) => [
      typeIdByIri.get(typeIri)!,
      authoringLiteralValues(graph.store.getObjects(typeIri, RDFS_COMMENT, null)),
    ])),
  });
}

export function validateProposedTypeParents(
  presentation: TypeSystemPresentation,
  typeId: string,
  proposedParentTypeIds: readonly string[],
): { valid: true } | { valid: false; reason: "unknown-type" | "duplicate-id" | "cycle"; cycleTypeIds?: readonly string[] } {
  const known = new Set(presentation.types.map((item) => item.typeId));
  if (!known.has(typeId) || proposedParentTypeIds.some((id) => !known.has(id))) {
    return { valid: false, reason: "unknown-type" };
  }
  if (new Set(proposedParentTypeIds).size !== proposedParentTypeIds.length) {
    return { valid: false, reason: "duplicate-id" };
  }
  const parents = new Map(presentation.types.map((item) => [item.typeId, [...item.parentTypeIds]]));
  parents.set(typeId, [...proposedParentTypeIds]);
  const path = cycleFrom(typeId, parents);
  return path ? { valid: false, reason: "cycle", cycleTypeIds: path } : { valid: true };
}

export function typeSystemTreeRows(presentation: TypeSystemPresentation): TypeSystemTreeRow[] {
  const typeById = new Map(presentation.types.map((item) => [item.typeId, item]));
  const seen = new Set<string>();
  const rows: TypeSystemTreeRow[] = [];
  const append = (typeId: string, depth: number, path: readonly string[], parentTypeId?: string) => {
    const item = typeById.get(typeId);
    if (!item) return;
    const reference = seen.has(typeId);
    const pathKey = [...path, typeId].join("--");
    rows.push({
      rowId: `tree-${pathKey}`,
      typeId,
      ...(parentTypeId ? { parentTypeId } : {}),
      depth,
      reference,
    });
    if (reference || path.includes(typeId)) return;
    seen.add(typeId);
    for (const childTypeId of item.childTypeIds) {
      append(childTypeId, depth + 1, [...path, typeId], typeId);
    }
  };
  for (const rootTypeId of presentation.rootTypeIds) append(rootTypeId, 0, []);
  // A pre-existing cyclic component has no root. Keep it visible and editable
  // instead of reporting a cycle whose classes disappear from the tree.
  for (const item of presentation.types) {
    if (!seen.has(item.typeId)) append(item.typeId, 0, []);
  }
  return rows;
}

function compileTypeSystemAction(
  presentation: TypeSystemPresentation,
  exact: ExactTypeSystemIndex,
  action: TypeSystemAction,
  options: TypeSystemCompileOptions,
  translator: EditorTranslator,
): TypeSystemCompileResult {
  const label = "label" in action ? action.label.trim() : undefined;
  if (label !== undefined && label.length === 0) {
    return { ok: false, code: "invalid-label", message: translator("typeSystem.typeNameRequired") };
  }
  const parentIds = "parentTypeIds" in action ? action.parentTypeIds : [];
  if (new Set(parentIds).size !== parentIds.length) {
    return { ok: false, code: "duplicate-id", message: translator("typeSystem.duplicateParent") };
  }
  const parentIris = resolveAll(parentIds, exact.typeIriById);
  if (!parentIris) {
    return { ok: false, code: "unknown-type", message: translator("typeSystem.staleTypeSelection") };
  }

  if (action.type === "create-class") {
    const subject = options.createdTypeIri
      ? { kind: "iri" as const, iri: options.createdTypeIri }
      : { kind: "created-resource" as const };
    return success(action.type, [{
      type: "create-resource",
      commandId: options.commandId,
      ...(options.createdTypeIri ? { resourceIri: options.createdTypeIri } : {}),
      initialStatements: [
        { subject, predicateIri: RDF_TYPE, object: { kind: "iri", iri: RDFS_CLASS } },
        { subject, predicateIri: RDFS_LABEL, object: literalValue(label!, options.defaultLocale) },
        ...(action.description?.trim()
          ? [{ subject, predicateIri: RDFS_COMMENT, object: literalValue(action.description.trim(), options.defaultLocale) }]
          : []),
        ...parentIris.map((iri) => ({
          subject,
          predicateIri: RDFS_SUBCLASS_OF,
          object: { kind: "iri" as const, iri },
        })),
      ],
    }]);
  }

  const typeIri = exact.typeIriById.get(action.typeId);
  if (!typeIri) {
    return { ok: false, code: "unknown-type", message: translator("typeSystem.staleTypeSelection") };
  }
  if (action.type === "edit-class") {
    const validation = validateProposedTypeParents(presentation, action.typeId, action.parentTypeIds);
    if (!validation.valid) {
      return validation.reason === "cycle"
        ? {
            ok: false,
            code: "cycle",
            message: translator("typeSystem.parentCycle"),
            cycleTypeIds: validation.cycleTypeIds,
          }
        : {
            ok: false,
            code: validation.reason,
            message: translator("typeSystem.staleTypeSelection"),
          };
    }
    return success(action.type, [
      setProperty(
        `${options.commandId}:label`,
        typeIri,
        RDFS_LABEL,
        replaceLocalizedLiteral(
          exact.labelValuesByTypeId.get(action.typeId) ?? [],
          label!,
          options.defaultLocale,
        ),
      ),
      setProperty(
        `${options.commandId}:comment`,
        typeIri,
        RDFS_COMMENT,
        replaceLocalizedLiteral(
          exact.commentValuesByTypeId.get(action.typeId) ?? [],
          action.description?.trim() ?? "",
          options.defaultLocale,
        ),
      ),
      setProperty(
        `${options.commandId}:parents`,
        typeIri,
        RDFS_SUBCLASS_OF,
        parentIris.map((iri) => ({ kind: "iri" as const, iri })),
      ),
    ]);
  }
  if (action.type === "delete-class") {
    return success(action.type, [{
      type: "delete-resource",
      commandId: options.commandId,
      resourceIri: typeIri,
      cascade: true,
    }]);
  }

  const resourceIris = resolveAll(action.resourceIds, exact.resourceIriById);
  if (!resourceIris) {
    return {
      ok: false,
      code: "unknown-resource",
      message: translator("typeSystem.staleResourceSelection"),
    };
  }
  if (new Set(action.resourceIds).size !== action.resourceIds.length) {
    return { ok: false, code: "duplicate-id", message: translator("typeSystem.duplicateResource") };
  }
  const commands = action.resourceIds.map((resourceId, index): AuthoringCommand => {
    const current = exact.directTypeIrisByResourceId.get(resourceId) ?? [];
    const values = action.type === "bulk-add-type"
      ? [...new Set([...current, typeIri])]
      : current.filter((iri) => iri !== typeIri);
    return setProperty(
      `${options.commandId}:resource-${index + 1}`,
      resourceIris[index]!,
      RDF_TYPE,
      values.sort(compareCodePoints).map((iri) => ({ kind: "iri" as const, iri })),
    );
  });
  return success(action.type, commands);
}

function success(actionType: TypeSystemAction["type"], commands: readonly AuthoringCommand[]): TypeSystemCompileResult {
  return { ok: true, batch: { atomic: true, actionType, commands } };
}

function setProperty(
  commandId: string,
  subjectIri: string,
  predicateIri: string,
  values: Extract<AuthoringCommand, { type: "set-property" }>["values"],
): Extract<AuthoringCommand, { type: "set-property" }> {
  return { type: "set-property", commandId, subjectIri, predicateIri, values };
}

function literalValue(value: string, language?: string) {
  return { kind: "literal" as const, value, ...(language ? { language } : {}) };
}

function authoringLiteralValues(terms: readonly {
  termType: string;
  value: string;
  language?: string;
  datatype?: { value: string };
}[]): AuthoringLiteralValue[] {
  return terms.flatMap((term) => {
    if (term.termType !== "Literal") return [];
    return [{
      kind: "literal" as const,
      value: term.value,
      ...(term.language
        ? { language: term.language }
        : term.datatype?.value ? { datatypeIri: term.datatype.value } : {}),
    }];
  });
}

function replaceLocalizedLiteral(
  existing: readonly AuthoringLiteralValue[],
  value: string,
  locale?: string,
): AuthoringLiteralValue[] {
  const normalizedLocale = locale?.toLowerCase() ?? "";
  const preserved = existing.filter((literal) => normalizedLocale
    ? literal.language?.toLowerCase() !== normalizedLocale
    : Boolean(literal.language));
  return value.trim()
    ? [...preserved, literalValue(value.trim(), locale)]
    : preserved;
}

function resolveAll(ids: readonly string[], values: ReadonlyMap<string, string>): string[] | undefined {
  const resolved = ids.map((id) => values.get(id));
  return resolved.every((value): value is string => value !== undefined) ? resolved : undefined;
}

function cycleFrom(typeId: string, parents: ReadonlyMap<string, readonly string[]>): string[] | undefined {
  const visit = (current: string, path: string[], seen: Set<string>): string[] | undefined => {
    for (const parent of parents.get(current) ?? []) {
      if (parent === typeId) return [...path, parent];
      if (seen.has(parent)) continue;
      const result = visit(parent, [...path, parent], new Set([...seen, parent]));
      if (result) return result;
    }
    return undefined;
  };
  return visit(typeId, [typeId], new Set([typeId]));
}

function primaryDirectType(
  directTypeIris: readonly string[],
  ancestorsByClass: ReadonlyMap<string, ReadonlySet<string>>,
  priorityByClass: ReadonlyMap<string, number>,
): string | undefined {
  const mostSpecific = directTypeIris.filter((candidate) => !directTypeIris.some((other) => (
    other !== candidate
    && ancestorsByClass.get(other)?.has(candidate)
    && !ancestorsByClass.get(candidate)?.has(other)
  )));
  return [...mostSpecific].sort((left, right) => (
    compareNumericPriority(
      priorityByClass.get(left) ?? DOMAIN_CLASS_DISPLAY_PRIORITY,
      priorityByClass.get(right) ?? DOMAIN_CLASS_DISPLAY_PRIORITY,
    )
      || compareCodePoints(left, right)
  ))[0];
}

function stronglyConnectedCycles(
  typeIris: readonly string[],
  parents: ReadonlyMap<string, ReadonlySet<string>>,
): string[][] {
  let nextIndex = 0;
  const index = new Map<string, number>();
  const lowLink = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const result: string[][] = [];
  const visit = (iri: string) => {
    index.set(iri, nextIndex);
    lowLink.set(iri, nextIndex);
    nextIndex += 1;
    stack.push(iri);
    onStack.add(iri);
    for (const parent of parents.get(iri) ?? []) {
      if (!index.has(parent)) {
        visit(parent);
        lowLink.set(iri, Math.min(lowLink.get(iri)!, lowLink.get(parent)!));
      } else if (onStack.has(parent)) {
        lowLink.set(iri, Math.min(lowLink.get(iri)!, index.get(parent)!));
      }
    }
    if (lowLink.get(iri) !== index.get(iri)) return;
    const component: string[] = [];
    let member: string | undefined;
    do {
      member = stack.pop();
      if (!member) break;
      onStack.delete(member);
      component.push(member);
    } while (member !== iri);
    if (component.length > 1 || parents.get(iri)?.has(iri)) result.push(component);
  };
  for (const iri of typeIris) if (!index.has(iri)) visit(iri);
  return result;
}

function transitiveParents(
  classIri: string,
  parents: ReadonlyMap<string, ReadonlySet<string>>,
): Set<string> {
  const result = new Set<string>();
  const visit = (iri: string) => {
    for (const parent of parents.get(iri) ?? []) {
      if (parent === classIri || result.has(parent)) continue;
      result.add(parent);
      visit(parent);
    }
  };
  visit(classIri);
  return result;
}

function rolesByClass(roles: readonly TypeSystemProfileRole[]): Map<string, TypeSystemProfileRole[]> {
  const result = new Map<string, TypeSystemProfileRole[]>();
  for (const role of roles) {
    const values = result.get(role.classIri) ?? [];
    values.push(role);
    result.set(role.classIri, values);
  }
  for (const values of result.values()) values.sort((left, right) => (
    compareDisplayPriority(left.displayPriority, right.displayPriority)
      || compareCodePoints(left.roleId, right.roleId)
  ));
  return result;
}

function compareDisplayPriority(left?: number, right?: number): number {
  const leftValue = Number.isFinite(left) ? left! : Number.NEGATIVE_INFINITY;
  const rightValue = Number.isFinite(right) ? right! : Number.NEGATIVE_INFINITY;
  return compareNumericPriority(leftValue, rightValue);
}

function compareNumericPriority(leftValue: number, rightValue: number): number {
  if (leftValue === rightValue) return 0;
  return leftValue > rightValue ? -1 : 1;
}

function preferredLiteral(terms: readonly { termType: string; value: string; language?: string }[], locale: string): string | undefined {
  const literals = terms.filter((term) => term.termType === "Literal" && term.value.trim().length > 0);
  if (literals.length === 0) return undefined;
  const normalizedLocale = locale.toLowerCase();
  const baseLanguage = normalizedLocale.split("-")[0];
  return [...literals].sort((left, right) => {
    const score = (language = "") => {
      const normalized = language.toLowerCase();
      if (normalizedLocale && normalized === normalizedLocale) return 0;
      if (normalizedLocale && normalized && normalized.split("-")[0] === baseLanguage) return 1;
      if (!normalized) return 2;
      return 3;
    };
    return score(left.language) - score(right.language)
      || compareCodePoints(left.language ?? "", right.language ?? "")
      || compareCodePoints(left.value, right.value);
  })[0]!.value;
}

function idComparator(
  exactById: ReadonlyMap<string, string>,
  labelByExact: ReadonlyMap<string, string>,
  locale: string,
): (leftId: string, rightId: string) => number {
  return (leftId, rightId) => {
    const left = exactById.get(leftId)!;
    const right = exactById.get(rightId)!;
    return compareLabelFirst(labelByExact.get(left)!, labelByExact.get(right)!, left, right, locale);
  };
}

function compareLabelFirst(
  leftLabel: string,
  rightLabel: string,
  leftExact: string,
  rightExact: string,
  locale: string,
): number {
  return leftLabel.localeCompare(rightLabel, locale || undefined, { numeric: true, sensitivity: "base" })
    || compareCodePoints(leftLabel, rightLabel)
    || compareCodePoints(leftExact, rightExact);
}

function addToSetMap(map: Map<string, Set<string>>, key: string, value: string): void {
  const values = map.get(key) ?? new Set<string>();
  values.add(value);
  map.set(key, values);
}

function stableOpaqueId(kind: "type" | "resource", exactIdentity: string): string {
  const input = `${kind}\u0000${exactIdentity}`;
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= BigInt(input.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return `${kind}-${hash.toString(36).padStart(13, "0")}`;
}
