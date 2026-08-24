import type {
  DiagramScene,
  ElementGeometry,
  Point,
} from "@iriograph/core";

import type { GeometryChange, GeometryElement } from "./selection";

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
  const elementById = new Map([
    ...scene.nodes,
    ...scene.containers,
    ...(scene.regions ?? []),
  ].map((element) => [element.elementId, element]));
  const regionById = new Map((scene.regions ?? []).map((region) => [region.elementId, region]));
  const requestedById = new Map(requested.map((change) => [change.elementId, change]));
  const first = requested.find((change) => geometryElement(scene, change.elementId));
  const original = first ? geometryElement(scene, first.elementId) : undefined;
  if (!first || !original) return { changes: [...requested] };
  const requestedDelta = {
    x: first.geometry.x - original.x,
    y: first.geometry.y - original.y,
  };
  const requestedIssue = validateRequestedRegionGeometry(
    scene,
    requestedById,
    elementById,
    regionById,
  );
  if (!requestedIssue) return { changes: [...requested] };
  if (requested.length > 1 && !isUniformTranslation(requested, elementById)) {
    return { changes: [], issue: requestedIssue };
  }
  let minimumX = Number.NEGATIVE_INFINITY;
  let maximumX = Number.POSITIVE_INFINITY;
  let minimumY = Number.NEGATIVE_INFINITY;
  let maximumY = Number.POSITIVE_INFINITY;

  for (const change of requested) {
    const member = elementById.get(change.elementId);
    if (!member) continue;
    const memberships = (scene.memberships ?? []).filter((membership) => (
      membership.memberElementId === member.elementId
      && membership.regionElementId
      && membership.provenance.operator === "membership-region"
    ));
    if (memberships.length === 0) continue;
    const regions = memberships.map((membership) => regionById.get(membership.regionElementId!));
    if (regions.some((region) => !region)) {
      return rejected(member.elementId, "membership-region-missing", "所属する概念領域を表示上で解決できないため、移動を取り消しました。");
    }
    const intersection = intersectRectangles(regions.map((region) => (
      requestedById.get(region!.elementId)?.geometry ?? region!.geometry
    )));
    if (
      !intersection
      || intersection.width < change.geometry.width
      || intersection.height < change.geometry.height
    ) {
      return rejected(member.elementId, "membership-region-intersection-empty", "所属する概念領域の交差が要素より小さいため、現在位置を維持します。領域の配置またはサイズを調整してください。");
    }
    minimumX = Math.max(minimumX, intersection.x - member.geometry.x);
    maximumX = Math.min(maximumX, intersection.x + intersection.width - member.geometry.x - change.geometry.width);
    minimumY = Math.max(minimumY, intersection.y - member.geometry.y);
    maximumY = Math.min(maximumY, intersection.y + intersection.height - member.geometry.y - change.geometry.height);
  }

  for (const change of requested) {
    const region = regionById.get(change.elementId);
    if (!region) continue;
    const members = (scene.memberships ?? []).filter((membership) => (
      membership.regionElementId === region.elementId
      && membership.provenance.operator === "membership-region"
    ));
    for (const membership of members) {
      const member = geometryElement(scene, membership.memberElementId);
      if (!member) {
        return rejected(region.elementId, "membership-region-missing", "所属要素を表示上で解決できないため、領域の変更を取り消しました。");
      }
      const memberChange = requestedById.get(membership.memberElementId);
      const memberMovesTogether = Boolean(memberChange
        && memberChange.geometry.width === member.width
        && memberChange.geometry.height === member.height
        && memberChange.geometry.x - member.x === requestedDelta.x
        && memberChange.geometry.y - member.y === requestedDelta.y);
      if (memberMovesTogether) continue;
      const finalMember = memberChange?.geometry ?? member;
      if (change.geometry.width !== region.geometry.width || change.geometry.height !== region.geometry.height) {
        if (!containsRectangle(change.geometry, finalMember)) {
          return rejected(region.elementId, "membership-region-intersection-empty", "領域を縮小すると所属要素が外へ出るため、サイズ変更を取り消しました。");
        }
        continue;
      }
      minimumX = Math.max(minimumX, finalMember.x + finalMember.width - region.geometry.x - region.geometry.width);
      maximumX = Math.min(maximumX, finalMember.x - region.geometry.x);
      minimumY = Math.max(minimumY, finalMember.y + finalMember.height - region.geometry.y - region.geometry.height);
      maximumY = Math.min(maximumY, finalMember.y - region.geometry.y);
    }
  }

  if (minimumX > maximumX || minimumY > maximumY) {
    return rejected(requested[0]!.elementId, "membership-region-intersection-empty", "選択した要素を同じ移動量で所属領域内に保てないため、移動を取り消しました。");
  }
  if (
    !Number.isFinite(minimumX)
    && !Number.isFinite(maximumX)
    && !Number.isFinite(minimumY)
    && !Number.isFinite(maximumY)
  ) return { changes: [], issue: requestedIssue };
  const delta = {
    x: clamp(requestedDelta.x, minimumX, maximumX),
    y: clamp(requestedDelta.y, minimumY, maximumY),
  };
  const changes = requested.map((change) => {
    const source = geometryElement(scene, change.elementId);
    return source ? {
        elementId: change.elementId,
        geometry: {
          ...change.geometry,
          x: source.x + delta.x,
          y: source.y + delta.y,
        },
      } : change;
  });
  const finalIssue = validateRequestedRegionGeometry(
    scene,
    new Map(changes.map((change) => [change.elementId, change])),
    elementById,
    regionById,
  );
  return finalIssue ? { changes: [], issue: finalIssue } : { changes };
}

function validateRequestedRegionGeometry(
  scene: DiagramScene,
  requestedById: ReadonlyMap<string, GeometryChange>,
  elementById: ReadonlyMap<string, GeometryElement>,
  regionById: ReadonlyMap<string, Extract<GeometryElement, { structuralKind: "region" }>>,
): RegionMembershipConstraintIssue | undefined {
  const regionMemberships = (scene.memberships ?? []).filter((membership) => (
    membership.regionElementId
    && membership.provenance.operator === "membership-region"
  ));
  const affectedMemberIds = new Set(regionMemberships
    .filter((membership) => requestedById.has(membership.memberElementId)
      || requestedById.has(membership.regionElementId!))
    .map((membership) => membership.memberElementId));
  if (affectedMemberIds.size === 0) return undefined;
  const byMember = new Map<string, typeof regionMemberships>();
  // A changed region may be only one of a member's regions. Once the member is
  // affected, validate against every semantic region membership, not merely
  // the changed region; otherwise a candidate inside that one region could
  // still escape the common intersection.
  for (const membership of regionMemberships) {
    if (!affectedMemberIds.has(membership.memberElementId)) continue;
    const entries = byMember.get(membership.memberElementId) ?? [];
    entries.push(membership);
    byMember.set(membership.memberElementId, entries);
  }
  for (const [memberId, memberships] of byMember) {
    const member = elementById.get(memberId);
    if (!member) {
      return {
        code: "membership-region-missing",
        elementId: memberId,
        message: "所属要素を表示上で解決できないため、変更を取り消しました。",
      };
    }
    const regions = memberships.map((membership) => regionById.get(membership.regionElementId!));
    if (regions.some((region) => !region)) {
      return {
        code: "membership-region-missing",
        elementId: memberId,
        message: "所属する概念領域を表示上で解決できないため、変更を取り消しました。",
      };
    }
    const intersection = intersectRectangles(regions.map((region) => (
      requestedById.get(region!.elementId)?.geometry ?? region!.geometry
    )));
    const finalMember = requestedById.get(memberId)?.geometry ?? member.geometry;
    if (!intersection || !containsRectangle(intersection, finalMember)) {
      return {
        code: "membership-region-intersection-empty",
        elementId: memberId,
        message: "所属する概念領域の交差内に要素全体を保てないため、変更を取り消しました。領域の配置またはサイズを調整してください。",
      };
    }
  }
  return undefined;
}

function isUniformTranslation(
  requested: readonly GeometryChange[],
  elementById: ReadonlyMap<string, GeometryElement>,
): boolean {
  let delta: Point | undefined;
  for (const change of requested) {
    const source = elementById.get(change.elementId);
    if (!source
      || source.geometry.width !== change.geometry.width
      || source.geometry.height !== change.geometry.height) return false;
    const candidate = {
      x: change.geometry.x - source.geometry.x,
      y: change.geometry.y - source.geometry.y,
    };
    if (delta && (candidate.x !== delta.x || candidate.y !== delta.y)) return false;
    delta = candidate;
  }
  return true;
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

function containsRectangle(container: ElementGeometry, member: ElementGeometry): boolean {
  return member.x >= container.x
    && member.y >= container.y
    && member.x + member.width <= container.x + container.width
    && member.y + member.height <= container.y + container.height;
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
