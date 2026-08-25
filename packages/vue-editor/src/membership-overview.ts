import type {
  DiagramScene,
  ProjectionProvenance,
  SceneMembership,
} from "@iriograph/core";

export type MembershipContainerKind = "container" | "region" | "sequence";
export type MembershipOverviewRole = "membership" | "sequence-member";

export type MembershipOverviewItem = {
  semanticRef: string;
  relatedElementId: string;
  relatedSemanticRef: string;
  label: string;
  relatedStructuralKind: "node" | "container" | "region";
  containerKind: MembershipContainerKind;
  role: MembershipOverviewRole;
  ordinal?: number;
  provenance: ProjectionProvenance;
};

export type MembershipOverview = {
  belongsTo: MembershipOverviewItem[];
  contains: MembershipOverviewItem[];
};

/**
 * Builds the selection summary only from exact projected memberships. Geometry,
 * hierarchy compatibility fields and overlay state are deliberately ignored.
 */
export function membershipOverviewForElement(
  scene: DiagramScene,
  elementId: string,
): MembershipOverview {
  const elements = new Map([
    ...scene.containers,
    ...(scene.regions ?? []),
    ...scene.nodes,
  ].map((element) => [element.elementId, element] as const));
  const selected = elements.get(elementId);
  if (!selected) return { belongsTo: [], contains: [] };

  const belongsTo: MembershipOverviewItem[] = [];
  const contains: MembershipOverviewItem[] = [];
  for (const membership of scene.memberships ?? []) {
    const containerElementId = membership.regionElementId ?? membership.containerElementId;
    const container = elements.get(containerElementId);
    const member = elements.get(membership.memberElementId);
    if (!container || container.structuralKind === "node" || !member) continue;
    const containerKind = membershipContainerKind(container, membership);
    const shared = {
      semanticRef: membership.semanticRef,
      containerKind,
      role: membership.role ?? "membership",
      ...(membership.ordinal === undefined ? {} : { ordinal: membership.ordinal }),
      provenance: membership.provenance,
    } satisfies Omit<MembershipOverviewItem,
      "relatedElementId" | "relatedSemanticRef" | "label" | "relatedStructuralKind"
    >;
    if (membership.memberElementId === selected.elementId) {
      belongsTo.push({
        ...shared,
        relatedElementId: container.elementId,
        relatedSemanticRef: container.semanticRef,
        label: container.label,
        relatedStructuralKind: container.structuralKind,
      });
    }
    if (containerElementId === selected.elementId) {
      contains.push({
        ...shared,
        relatedElementId: member.elementId,
        relatedSemanticRef: member.semanticRef,
        label: member.label,
        relatedStructuralKind: member.structuralKind,
      });
    }
  }
  return {
    belongsTo: belongsTo.sort(compareMembershipOverview),
    contains: contains.sort(compareMembershipOverview),
  };
}

function membershipContainerKind(
  container: DiagramScene["containers"][number] | NonNullable<DiagramScene["regions"]>[number],
  membership: SceneMembership,
): MembershipContainerKind {
  if (membership.role === "sequence-member" || (
    container.structuralKind === "container" && container.groupRole === "sequence"
  )) return "sequence";
  return container.structuralKind;
}

function compareMembershipOverview(
  left: MembershipOverviewItem,
  right: MembershipOverviewItem,
): number {
  if (left.containerKind === "sequence" || right.containerKind === "sequence") {
    const ordinal = (left.ordinal ?? Number.MAX_SAFE_INTEGER)
      - (right.ordinal ?? Number.MAX_SAFE_INTEGER);
    if (ordinal !== 0) return ordinal;
  }
  return left.label.localeCompare(right.label, "ja")
    || left.relatedSemanticRef.localeCompare(right.relatedSemanticRef)
    || left.semanticRef.localeCompare(right.semanticRef);
}
