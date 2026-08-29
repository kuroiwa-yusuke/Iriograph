import type { ElementGeometry, VisualTemplate } from "../document/model.js";

export type ContainerContentInsets = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

/**
 * Renderer-independent content area reserved by the standard container
 * templates. Layout, interaction, and consistency checks share this contract.
 */
export function containerContentInsets(
  headerPosition: NonNullable<VisualTemplate["headerPosition"]>,
): ContainerContentInsets {
  return {
    top: headerPosition === "top" ? 46 : 16,
    right: 16,
    bottom: 16,
    left: headerPosition === "left" ? 78 : 16,
  };
}

export function containerContentBounds(
  geometry: ElementGeometry,
  headerPosition: NonNullable<VisualTemplate["headerPosition"]>,
): ElementGeometry {
  const insets = containerContentInsets(headerPosition);
  return {
    x: geometry.x + insets.left,
    y: geometry.y + insets.top,
    width: Math.max(0, geometry.width - insets.left - insets.right),
    height: Math.max(0, geometry.height - insets.top - insets.bottom),
  };
}
