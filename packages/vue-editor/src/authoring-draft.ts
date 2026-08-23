import type {
  AuthoringCommand,
  AuthoringObjectKind,
  AuthoringObjectValue,
  ProjectionDiagnostic,
} from "@iriograph/core";

export type EditorAuthoringKind =
  | "create-resource"
  | "set-property"
  | "connect-resources"
  | "set-membership"
  | "set-sequence"
  | "set-alternatives"
  | "delete-resource"
  | "remove-statement"
  | "apply-capability";

export type EditorPropertyValueDraft = {
  objectKind: "literal" | "iri";
  value: string;
  datatypeIri: string;
  language: string;
};

export type EditorCapabilityBindingDraft = EditorPropertyValueDraft & {
  enabled: boolean;
};

export type AuthoringResourcePickerTarget =
  | { field: "subjectIri" | "sourceIri" | "targetIri" | "containerIri" | "memberIri" | "structureIri" | "resourceIri" | "createEdgeResourceIri" | "createMembershipContainerIri" }
  | { field: "propertyValue"; index: number };

export type EditorAuthoringDraft = {
  kind: EditorAuthoringKind;
  resourceIri: string;
  classIri: string;
  label: string;
  subjectIri: string;
  predicateIri: string;
  propertyMode: "replace" | "delete";
  propertyValues: EditorPropertyValueDraft[];
  sourceIri: string;
  targetIri: string;
  containerIri: string;
  memberIri: string;
  present: boolean;
  containerTypeIri: string;
  membershipPredicateIri: string;
  structureIri: string;
  membersText: string;
  defaultMemberIri: string;
  sequenceTypeIri: string;
  alternativeTypeIri: string;
  ordinalPredicatePrefix: string;
  defaultOrdinal: string;
  structureConfigKey: string;
  cascade: boolean;
  statementRef: string;
  statementSubject: string;
  statementPredicate: string;
  statementObject: string;
  capabilityId: string;
  capabilityBindings: Record<string, EditorCapabilityBindingDraft>;
  initialX: string;
  initialY: string;
  positionPicking: boolean;
  createEdgeEnabled: boolean;
  createEdgeDirection: "outgoing" | "incoming";
  createEdgePredicateIri: string;
  createEdgeResourceIri: string;
  createMembershipEnabled: boolean;
  createMembershipContainerIri: string;
  createMembershipStructureConfigKey: string;
  createMembershipContainerTypeIri: string;
  createMembershipPredicateIri: string;
  /** Presentation seed applied only after semantic creation succeeds. */
  createTemplateRef: string;
  createStructuralKind: "node" | "container" | "region";
};

export type AuthoringChoice = {
  iri: string;
  label?: string;
};

export type AuthoringCapabilityChoice = AuthoringChoice & {
  parameters: readonly {
    name: string;
    objectKinds: readonly AuthoringObjectKind[];
    required?: boolean;
  }[];
};

export type AuthoringStructureChoice = {
  key: string;
  kind: "membership" | "sequence" | "alternatives";
  label: string;
  ruleId?: string;
  typeIri: string;
  predicateIri?: string;
  ordinalPredicatePrefix?: string;
  defaultOrdinal?: number;
};

export type AuthoringPreviewView = {
  confirmationId: string;
  valid: boolean;
  diagnostics: ProjectionDiagnostic[];
  addedStatements: string[];
  removedStatements: string[];
  candidateSource: string;
  operationLabel: string;
  resourceChips: Array<{ iri: string; label: string; role: string }>;
  relations: Array<{ kind: "edge" | "membership"; label: string }>;
};

export function emptyPropertyValueDraft(
  objectKind: "literal" | "iri" = "literal",
): EditorPropertyValueDraft {
  return { objectKind, value: "", datatypeIri: "", language: "" };
}

export function emptyAuthoringDraft(
  kind: EditorAuthoringKind = "create-resource",
  semanticRef = "",
): EditorAuthoringDraft {
  return {
    kind,
    resourceIri: "",
    classIri: "",
    label: "",
    subjectIri: semanticRef,
    predicateIri: "",
    propertyMode: "replace",
    propertyValues: [emptyPropertyValueDraft()],
    sourceIri: semanticRef,
    targetIri: "",
    containerIri: "",
    memberIri: semanticRef,
    present: true,
    containerTypeIri: "",
    membershipPredicateIri: "",
    structureIri: semanticRef,
    membersText: "",
    defaultMemberIri: "",
    sequenceTypeIri: "",
    alternativeTypeIri: "",
    ordinalPredicatePrefix: "",
    defaultOrdinal: "",
    structureConfigKey: "",
    cascade: false,
    statementRef: "",
    statementSubject: "",
    statementPredicate: "",
    statementObject: "",
    capabilityId: "",
    capabilityBindings: {},
    initialX: "",
    initialY: "",
    positionPicking: false,
    createEdgeEnabled: false,
    createEdgeDirection: "outgoing",
    createEdgePredicateIri: "",
    createEdgeResourceIri: "",
    createMembershipEnabled: false,
    createMembershipContainerIri: "",
    createMembershipStructureConfigKey: "",
    createMembershipContainerTypeIri: "",
    createMembershipPredicateIri: "",
    createTemplateRef: "",
    createStructuralKind: "node",
  };
}

export function authoringDraftHasInput(draft: EditorAuthoringDraft): boolean {
  const baseline = emptyAuthoringDraft(draft.kind);
  return Object.entries(draft).some(([key, value]) => (
    key !== "kind"
    && JSON.stringify(value) !== JSON.stringify(baseline[key as keyof EditorAuthoringDraft])
  ));
}

export function splitIriLines(value: string): string[] {
  return value
    .split(/\r?\n/u)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function capabilityBindingsFor(
  capability: AuthoringCapabilityChoice | undefined,
): Record<string, EditorCapabilityBindingDraft> {
  return Object.fromEntries((capability?.parameters ?? []).map((parameter) => [
    parameter.name,
    {
      ...emptyPropertyValueDraft(parameter.objectKinds[0] === "iri" ? "iri" : "literal"),
      enabled: parameter.required !== false,
    },
  ]));
}

export function compileAuthoringDraft(
  draft: EditorAuthoringDraft,
  activeViewId: string,
): AuthoringCommand[] {
  const commandId = "editor-semantic-command";
  switch (draft.kind) {
    case "create-resource": {
      const initialStatements: Array<
        Extract<AuthoringCommand, { type: "create-resource" }>["initialStatements"][number]
      > = [];
      if (draft.classIri.trim()) {
        initialStatements.push({
          subject: { kind: "created-resource" },
          predicateIri: "http://www.w3.org/1999/02/22-rdf-syntax-ns#type",
          object: { kind: "iri", iri: draft.classIri.trim() },
        });
      }
      if (draft.label.trim()) {
        initialStatements.push({
          subject: { kind: "created-resource" },
          predicateIri: "http://www.w3.org/2000/01/rdf-schema#label",
          object: { kind: "literal", value: draft.label.trim() },
        });
      }
      if (draft.createEdgeEnabled) {
        const predicateIri = requiredIri(
          draft.createEdgePredicateIri,
          "作成時のedgeにはpredicateが必要です。",
        );
        const existingIri = requiredIri(
          draft.createEdgeResourceIri,
          "作成時のedgeには既存resourceが必要です。",
        );
        initialStatements.push(draft.createEdgeDirection === "outgoing"
          ? {
              subject: { kind: "created-resource" },
              predicateIri,
              object: { kind: "iri", iri: existingIri },
            }
          : {
              subject: { kind: "iri", iri: existingIri },
              predicateIri,
              object: { kind: "created-resource" },
            });
      }
      if (draft.createMembershipEnabled) {
        const containerIri = requiredIri(
          draft.createMembershipContainerIri,
          "作成時の包含には既存containerが必要です。",
        );
        if (
          !draft.createMembershipStructureConfigKey
          || !draft.createMembershipContainerTypeIri.trim()
          || !draft.createMembershipPredicateIri.trim()
        ) throw new Error("作成時の包含にはcatalog membership structureの選択が必要です。");
        initialStatements.push({
          subject: { kind: "iri", iri: containerIri },
          predicateIri: draft.createMembershipPredicateIri.trim(),
          object: { kind: "created-resource" },
        });
      }
      if (initialStatements.length === 0) {
        throw new Error("Resourceにはclass、label、edge、包含のいずれか1 triple以上が必要です。");
      }
      const x = draft.initialX.trim() ? Number(draft.initialX) : undefined;
      const y = draft.initialY.trim() ? Number(draft.initialY) : undefined;
      if ((x === undefined) !== (y === undefined) || (x !== undefined && !Number.isFinite(x)) || (y !== undefined && !Number.isFinite(y))) {
        throw new Error("初期位置はxとyを両方、有限の数値で指定してください。");
      }
      return [{
        type: "create-resource",
        commandId,
        ...(draft.resourceIri.trim() ? { resourceIri: draft.resourceIri.trim() } : {}),
        ...(draft.label.trim() ? { suggestedLocalName: draft.label.trim() } : {}),
        initialStatements,
        ...(x !== undefined && y !== undefined
          ? { initialPosition: { viewId: activeViewId, x, y } }
          : {}),
      }];
    }
    case "set-property":
      return [{
        type: "set-property",
        commandId,
        subjectIri: draft.subjectIri.trim(),
        predicateIri: draft.predicateIri.trim(),
        values: draft.propertyMode === "delete"
          ? []
          : draft.propertyValues.map(objectValue),
      }];
    case "connect-resources":
      return [{
        type: "connect-resources",
        commandId,
        subjectIri: draft.sourceIri.trim(),
        predicateIri: draft.predicateIri.trim(),
        objectIri: draft.targetIri.trim(),
      }];
    case "set-membership":
      return [{
        type: "set-membership",
        commandId,
        containerIri: draft.containerIri.trim(),
        memberIri: draft.memberIri.trim(),
        enabled: draft.present,
        containerTypeIri: draft.containerTypeIri.trim(),
        predicateIri: draft.membershipPredicateIri.trim(),
      }];
    case "set-sequence":
      return [{
        type: "set-sequence",
        commandId,
        sequenceIri: draft.structureIri.trim(),
        memberIris: splitIriLines(draft.membersText),
        sequenceTypeIri: draft.sequenceTypeIri.trim(),
        ordinalPredicatePrefix: draft.ordinalPredicatePrefix.trim(),
      }];
    case "set-alternatives":
      return [{
        type: "set-alternatives",
        commandId,
        alternativeIri: draft.structureIri.trim(),
        memberIris: splitIriLines(draft.membersText),
        defaultMemberIri: draft.defaultMemberIri.trim(),
        alternativeTypeIri: draft.alternativeTypeIri.trim(),
        ordinalPredicatePrefix: draft.ordinalPredicatePrefix.trim(),
        defaultOrdinal: Number(draft.defaultOrdinal),
      }];
    case "delete-resource":
      return [{
        type: "delete-resource",
        commandId,
        resourceIri: draft.resourceIri.trim(),
        cascade: draft.cascade,
      }];
    case "remove-statement":
      return [{
        type: "remove-statement",
        commandId,
        statementRef: draft.statementRef,
        subjectIri: draft.statementSubject,
        predicateIri: draft.statementPredicate,
        objectIri: draft.statementObject,
      }];
    case "apply-capability":
      return [{
        type: "apply-capability",
        commandId,
        capabilityId: draft.capabilityId,
        bindings: Object.fromEntries(Object.entries(draft.capabilityBindings)
          .filter(([, binding]) => binding.enabled)
          .map(([name, binding]) => [name, objectValue(binding)])),
      }];
  }
}

export function draftFromAuthoringCommand(
  command: AuthoringCommand,
): EditorAuthoringDraft | undefined {
  switch (command.type) {
    case "set-property":
      return {
        ...emptyAuthoringDraft("set-property"),
        subjectIri: command.subjectIri,
        predicateIri: command.predicateIri,
        propertyMode: command.values.length === 0 ? "delete" : "replace",
        propertyValues: command.values.map(propertyValueFromObject),
      };
    case "remove-statement":
      return {
        ...emptyAuthoringDraft("remove-statement"),
        statementRef: command.statementRef,
        statementSubject: command.subjectIri,
        statementPredicate: command.predicateIri,
        statementObject: command.objectIri,
      };
    case "set-membership":
      return {
        ...emptyAuthoringDraft("set-membership"),
        containerIri: command.containerIri,
        memberIri: command.memberIri,
        present: command.enabled,
        containerTypeIri: command.containerTypeIri,
        membershipPredicateIri: command.predicateIri,
        structureConfigKey: structureKey("membership", command.containerTypeIri, command.predicateIri),
      };
    case "set-sequence":
      return {
        ...emptyAuthoringDraft("set-sequence"),
        structureIri: command.sequenceIri,
        membersText: command.memberIris.join("\n"),
        sequenceTypeIri: command.sequenceTypeIri,
        ordinalPredicatePrefix: command.ordinalPredicatePrefix,
        structureConfigKey: structureKey("sequence", command.sequenceTypeIri, command.ordinalPredicatePrefix),
      };
    case "set-alternatives":
      return {
        ...emptyAuthoringDraft("set-alternatives"),
        structureIri: command.alternativeIri,
        membersText: command.memberIris.join("\n"),
        defaultMemberIri: command.defaultMemberIri,
        alternativeTypeIri: command.alternativeTypeIri,
        ordinalPredicatePrefix: command.ordinalPredicatePrefix,
        defaultOrdinal: String(command.defaultOrdinal),
        structureConfigKey: structureKey(
          "alternatives",
          command.alternativeTypeIri,
          command.ordinalPredicatePrefix,
          command.defaultOrdinal,
        ),
      };
    default:
      return undefined;
  }
}

export function structureKey(
  kind: AuthoringStructureChoice["kind"],
  typeIri: string,
  relation: string,
  defaultOrdinal?: number,
): string {
  return JSON.stringify([kind, typeIri, relation, defaultOrdinal ?? null]);
}

function objectValue(draft: EditorPropertyValueDraft): AuthoringObjectValue {
  if (draft.objectKind === "iri") return { kind: "iri", iri: draft.value.trim() };
  return {
    kind: "literal",
    value: draft.value,
    ...(draft.language.trim() ? { language: draft.language.trim() } : {}),
    ...(draft.datatypeIri.trim() ? { datatypeIri: draft.datatypeIri.trim() } : {}),
  };
}

function requiredIri(value: string, message: string): string {
  const iri = value.trim();
  if (!iri) throw new Error(message);
  return iri;
}

function propertyValueFromObject(value: AuthoringObjectValue): EditorPropertyValueDraft {
  if (value.kind === "iri") return { ...emptyPropertyValueDraft("iri"), value: value.iri };
  return {
    objectKind: "literal",
    value: value.value,
    datatypeIri: value.datatypeIri ?? "",
    language: value.language ?? "",
  };
}
