import { STANDARD_LAYOUT_REFS, type LayoutDirection } from "@iriograph/core";

const EDITOR_LAYOUT_FAMILIES = [{
  family: "standard",
  LR: STANDARD_LAYOUT_REFS.hierarchicalLr,
  TB: STANDARD_LAYOUT_REFS.hierarchicalTb,
}, {
  // Stable public references of the optional @iriograph/layout-elk adapter.
  // Keeping the IRI pair here does not add the optional package as a runtime dependency.
  family: "elk",
  LR: "urn:iriograph:layout:elk-layered-lr:1",
  TB: "urn:iriograph:layout:elk-layered-tb:1",
}] as const;

export function layoutDirectionForRef(layoutRef: string): LayoutDirection | undefined {
  const family = EDITOR_LAYOUT_FAMILIES.find((candidate) => (
    candidate.LR === layoutRef || candidate.TB === layoutRef
  ));
  if (!family) return undefined;
  return family.LR === layoutRef ? "LR" : "TB";
}

export function layoutRefForDirection(
  currentLayoutRef: string,
  direction: LayoutDirection,
): string | undefined {
  const family = EDITOR_LAYOUT_FAMILIES.find((candidate) => (
    candidate.LR === currentLayoutRef || candidate.TB === currentLayoutRef
  ));
  return family?.[direction];
}

export function standardLayoutRefForDirection(direction: LayoutDirection): string {
  return direction === "LR"
    ? STANDARD_LAYOUT_REFS.hierarchicalLr
    : STANDARD_LAYOUT_REFS.hierarchicalTb;
}
