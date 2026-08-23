import type {
  DiagramScene,
  ElementGeometry,
  Point,
} from "@iriograph/core";

import type { GeometryChange } from "./selection";

export type RegionMembershipConstraintIssue = {
  code: "membership-region-missing" | "membership-region-intersection-empty";
  elementId: string;
  message: string;
};

export type RegionMembershipConstraintResult = {
  changes: GeometryChange[];
  issue?: RegionMembershipConstraintIssue;
};

/**
 * Constrains presentation movement only for `membership-region` projections.
 * It neither infers nor mutates semantic membership from geometry. Hierarchy
 * containers (`membership-container`) intentionally remain under their own
 * parent/child constraint path.
 */
export function constrainMembershipRegionMovement(
  scene: DiagramScene,
  requested: readonly GeometryChange[],
): RegionMembershipConstraintResult {
  if (requested.length === 0) return { changes: [] };
  const nodeById = new Map(scene.nodes.map((node) => [node.elementId, node]));
  const regionById = new Map((scene.regions ?? []).map((region) => [region.elementId, region]));
  let minimumX = Number.NEGATIVE_INFINITY;
  let maximumX = Number.POSITIVE_INFINITY;
  let minimumY = Number.NEGATIVE_INFINITY;
  let maximumY = Number.POSITIVE_INFINITY;

  for (const change of requested) {
    const node = nodeById.get(change.elementId);
    if (!node) continue;
    const memberships = (scene.memberships ?? []).filter((membership) => (
      membership.memberElementId === node.elementId
      && membership.regionElementId
      && membership.provenance.operator === "membership-region"
    ));
    if (memberships.length === 0) continue;
    const regions = memberships.map((membership) => regionById.get(membership.regionElementId!));
    if (regions.some((region) => !region)) {
      return rejected(node.elementId, "membership-region-missing", "所属する概念領域を表示上で解決できないため、移動を取り消しました。");
    }
    const intersection = intersectRectangles(regions.map((region) => region!.geometry));
    if (
      !intersection
      || intersection.width < change.geometry.width
      || intersection.height < change.geometry.height
    ) {
      return rejected(node.elementId, "membership-region-intersection-empty", "所属する概念領域の交差が要素より小さいため、現在位置を維持します。領域の配置またはサイズを調整してください。");
    }
    minimumX = Math.max(minimumX, intersection.x - node.geometry.x);
    maximumX = Math.min(maximumX, intersection.x + intersection.width - node.geometry.x - change.geometry.width);
    minimumY = Math.max(minimumY, intersection.y - node.geometry.y);
    maximumY = Math.min(maximumY, intersection.y + intersection.height - node.geometry.y - change.geometry.height);
  }

  if (minimumX > maximumX || minimumY > maximumY) {
    return rejected(requested[0]!.elementId, "membership-region-intersection-empty", "選択した要素を同じ移動量で所属領域内に保てないため、移動を取り消しました。");
  }
  if (!Number.isFinite(minimumX) && !Number.isFinite(maximumX)) return { changes: [...requested] };
  const first = requested.find((change) => nodeById.has(change.elementId));
  const original = first ? nodeById.get(first.elementId) : undefined;
  if (!first || !original) return { changes: [...requested] };
  const requestedDelta = {
    x: first.geometry.x - original.geometry.x,
    y: first.geometry.y - original.geometry.y,
  };
  const delta = {
    x: clamp(requestedDelta.x, minimumX, maximumX),
    y: clamp(requestedDelta.y, minimumY, maximumY),
  };
  return {
    changes: requested.map((change) => {
      const source = geometryElement(scene, change.elementId);
      return source ? {
        elementId: change.elementId,
        geometry: {
          ...change.geometry,
          x: source.x + delta.x,
          y: source.y + delta.y,
        },
      } : change;
    }),
  };
}

/** Returns semantic class IRIs for every membership-region hit by a point. */
export function membershipRegionClassIrisAtPoint(scene: DiagramScene, point: Point): string[] {
  const result: string[] = [];
  for (const region of scene.regions ?? []) {
    if (region.provenance?.operator !== "membership-region"
      || !containsPoint(region.geometry, point)
      || result.includes(region.semanticRef)) continue;
    result.push(region.semanticRef);
  }
  return result;
}

function intersectRectangles(rectangles: readonly ElementGeometry[]): ElementGeometry | undefined {
  if (rectangles.length === 0) return undefined;
  const x = Math.max(...rectangles.map((rectangle) => rectangle.x));
  const y = Math.max(...rectangles.map((rectangle) => rectangle.y));
  const right = Math.min(...rectangles.map((rectangle) => rectangle.x + rectangle.width));
  const bottom = Math.min(...rectangles.map((rectangle) => rectangle.y + rectangle.height));
  return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : undefined;
}

function containsPoint(geometry: ElementGeometry, point: Point): boolean {
  return point.x >= geometry.x
    && point.x <= geometry.x + geometry.width
    && point.y >= geometry.y
    && point.y <= geometry.y + geometry.height;
}

function geometryElement(scene: DiagramScene, elementId: string): ElementGeometry | undefined {
  return [
    ...scene.nodes,
    ...scene.containers,
    ...(scene.regions ?? []),
  ].find((element) => element.elementId === elementId)?.geometry;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function rejected(
  elementId: string,
  code: RegionMembershipConstraintIssue["code"],
  message: string,
): RegionMembershipConstraintResult {
  return { changes: [], issue: { code, elementId, message } };
}
