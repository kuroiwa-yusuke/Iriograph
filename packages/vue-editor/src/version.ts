/** Kept in lockstep with the published package version by the release gate. */
export const IRIOGRAPH_EDITOR_PACKAGE_VERSION = "0.12.0";

/** Stable capability IDs consumed by Mock/Cloud host conformance checks. */
export const IRIOGRAPH_EDITOR_CAPABILITIES = Object.freeze([
  "semantic-authoring",
  "presentation-overlay",
  "workspace-assets",
  "grid",
  "marquee-selection",
  "group-membership",
  "manual-and-auto-routing",
  "type-list",
] as const);
