import {
  containerContentBounds,
  resolveIconContentMetrics,
  type DiagramScene,
  type ElementGeometry,
  type Point,
  type SceneMembership,
  type SceneNode,
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

export type IconPresentationConstraintResult = {
  size: { width: number; height: number };
  geometry?: ElementGeometry;
  constrained: boolean;
  issue?: RegionMembershipConstraintIssue;
};

/**
 * Applies the same all-membership intersection contract to a node/icon resize.
 * A rejected node growth is reduced, aspect-preservingly, to the largest
 * accepted step. Callers therefore never persist a large icon without the
 * matching node geometry.
 */
export function constrainIconPresentationResize(
  scene: DiagramScene,
  node: SceneNode,
  requestedSize: { width: number; height: number },
  requestedGeometry?: ElementGeometry,
): IconPresentationConstraintResult {
  if (!requestedGeometry) {
    const size = fitIconSizeToFrame(requestedSize, node.geometry);
    return {
      size,
      constrained: size.width !== requestedSize.width || size.height !== requestedSize.height,
    };
  }
  const accepted = constrainMembershipRegionMovement(scene, [{
    elementId: node.elementId,
    geometry: requestedGeometry,
  }]);
  if (accepted.changes[0]) {
    return {
      size: requestedSize,
      geometry: accepted.changes[0].geometry,
      constrained: false,
    };
  }

  const initial = resolveIconContentMetrics(node.iconIntrinsicSize, {
    scale: node.nodeIconScale,
    size: node.nodeIconSize,
    fit: node.nodeIconFit,
  }) ?? { width: 24, height: 24, fit: "contain" as const };
  let lower = 0;
  let upper = 1;
  let bestGeometry: ElementGeometry | undefined;
  let bestSize = { width: initial.width, height: initial.height };
  for (let iteration = 0; iteration < 24; iteration += 1) {
    const ratio = (lower + upper) / 2;
    const candidateGeometry = interpolateGeometry(node.geometry, requestedGeometry, ratio);
    const candidate = constrainMembershipRegionMovement(scene, [{
      elementId: node.elementId,
      geometry: candidateGeometry,
    }]);
    if (candidate.changes[0]) {
      lower = ratio;
      bestGeometry = candidate.changes[0].geometry;
      bestSize = fitIconSizeToFrame(
        interpolateSize(initial, requestedSize, ratio),
        bestGeometry,
      );
    } else {
      upper = ratio;
    }
  }
  return {
    size: bestSize,
    ...(bestGeometry ? { geometry: bestGeometry } : {}),
    constrained: true,
    ...(accepted.issue ? { issue: accepted.issue } : {}),
  };
}

/**
 * Keeps a member inside the intersection of every semantic membership target.
 * Targets may be overlapping regions, Seq containers, or ordinary containers.
 * Geometry never creates or removes membership; it only constrains presentation.
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
  const requestedById = new Map(requested.map((change) => [change.elementId, change]));
  const first = requested.find((change) => geometryElement(scene, change.elementId));
  const original = first ? geometryElement(scene, first.elementId) : undefined;
  if (!first || !original) return { changes: [...requested] };
  const requestedDelta = {
    x: first.geometry.x - original.x,
    y: first.geometry.y - original.y,
  };
  const requestedIssue = validateRequestedMembershipGeometry(
    scene,
    requestedById,
    elementById,
  );
  if (!requestedIssue) return { changes: [...requested] };
  if (!isUniformTranslation(requested, elementById)) {
    return { changes: [], issue: requestedIssue };
  }
  let minimumX = Number.NEGATIVE_INFINITY;
  let maximumX = Number.POSITIVE_INFINITY;
  let minimumY = Number.NEGATIVE_INFINITY;
  let maximumY = Number.POSITIVE_INFINITY;

  const bindings = membershipBindings(scene);
  const affectedMemberIds = new Set(bindings
    .filter(({ membership, targetElementId }) => (
      requestedById.has(membership.memberElementId) || requestedById.has(targetElementId)
    ))
    .map(({ membership }) => membership.memberElementId));
  for (const { membership, targetElementId } of bindings) {
    if (!affectedMemberIds.has(membership.memberElementId)) continue;
    const member = elementById.get(membership.memberElementId);
    const target = elementById.get(targetElementId);
    if (!member || !target || target.structuralKind === "node") {
      return rejected(
        membership.memberElementId,
        "membership-region-missing",
        "所属する要素または領域を表示上で解決できないため、変更を取り消しました。",
      );
    }
    const memberMoves = requestedById.has(member.elementId);
    const targetMoves = requestedById.has(target.elementId);
    if (memberMoves === targetMoves) continue;
    const bounds = membershipTargetBounds(target, target.geometry);
    if (memberMoves) {
      minimumX = Math.max(minimumX, bounds.x - member.geometry.x);
      maximumX = Math.min(maximumX, right(bounds) - right(member.geometry));
      minimumY = Math.max(minimumY, bounds.y - member.geometry.y);
      maximumY = Math.min(maximumY, bottom(bounds) - bottom(member.geometry));
    } else {
      minimumX = Math.max(minimumX, right(member.geometry) - right(bounds));
      maximumX = Math.min(maximumX, member.geometry.x - bounds.x);
      minimumY = Math.max(minimumY, bottom(member.geometry) - bottom(bounds));
      maximumY = Math.min(maximumY, member.geometry.y - bounds.y);
    }
  }

  if (minimumX > maximumX || minimumY > maximumY) {
    return rejected(requested[0]!.elementId, "membership-region-intersection-empty", "選択した要素を同じ移動量で全所属領域内に保てないため、移動を取り消しました。");
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
  const finalIssue = validateRequestedMembershipGeometry(
    scene,
    new Map(changes.map((change) => [change.elementId, change])),
    elementById,
  );
  return finalIssue ? { changes: [], issue: finalIssue } : { changes };
}

function validateRequestedMembershipGeometry(
  scene: DiagramScene,
  requestedById: ReadonlyMap<string, GeometryChange>,
  elementById: ReadonlyMap<string, GeometryElement>,
): RegionMembershipConstraintIssue | undefined {
  const bindings = membershipBindings(scene);
  const affectedMemberIds = new Set(bindings
    .filter(({ membership, targetElementId }) => (
      requestedById.has(membership.memberElementId) || requestedById.has(targetElementId)
    ))
    .map(({ membership }) => membership.memberElementId));
  if (affectedMemberIds.size === 0) return undefined;
  for (const { membership, targetElementId } of bindings) {
    const memberId = membership.memberElementId;
    if (!affectedMemberIds.has(memberId)) continue;
    const member = elementById.get(memberId);
    if (!member) {
      return {
        code: "membership-region-missing",
        elementId: memberId,
        message: "所属要素を表示上で解決できないため、変更を取り消しました。",
      };
    }
    const target = elementById.get(targetElementId);
    if (!target || target.structuralKind === "node") {
      return {
        code: "membership-region-missing",
        elementId: memberId,
        message: "所属する領域または並び順の枠を表示上で解決できないため、変更を取り消しました。",
      };
    }
    const requestedMember = requestedById.get(memberId);
    const requestedTarget = requestedById.get(targetElementId);
    if (
      requestedMember
      && requestedTarget
      && preservesRelativeGeometry(
        member.geometry,
        requestedMember.geometry,
        target.geometry,
        requestedTarget.geometry,
      )
    ) continue;
    const finalTargetGeometry = requestedTarget?.geometry ?? target.geometry;
    const bounds = membershipTargetBounds(target, finalTargetGeometry);
    const finalMember = requestedMember?.geometry ?? member.geometry;
    if (!containsRectangle(bounds, finalMember)) {
      return {
        code: "membership-region-intersection-empty",
        elementId: memberId,
        message: "全所属領域・並び順・コンテナの共通範囲内に要素全体を保てないため、変更を取り消しました。枠の配置またはサイズを調整してください。",
      };
    }
  }
  return undefined;
}

function preservesRelativeGeometry(
  member: ElementGeometry,
  requestedMember: ElementGeometry,
  target: ElementGeometry,
  requestedTarget: ElementGeometry,
): boolean {
  return requestedMember.width === member.width
    && requestedMember.height === member.height
    && requestedTarget.width === target.width
    && requestedTarget.height === target.height
    && requestedMember.x - member.x === requestedTarget.x - target.x
    && requestedMember.y - member.y === requestedTarget.y - target.y;
}

type MembershipBinding = {
  membership: SceneMembership;
  targetElementId: string;
};

function membershipBindings(scene: DiagramScene): MembershipBinding[] {
  return (scene.memberships ?? []).map((membership) => ({
    membership,
    targetElementId: membership.regionElementId ?? membership.containerElementId,
  }));
}

function membershipTargetBounds(
  target: Exclude<GeometryElement, { structuralKind: "node" }>,
  geometry: ElementGeometry,
): ElementGeometry {
  return target.structuralKind === "container"
    ? containerContentBounds(geometry, target.headerPosition)
    : geometry;
}

function right(geometry: ElementGeometry): number {
  return geometry.x + geometry.width;
}

function bottom(geometry: ElementGeometry): number {
  return geometry.y + geometry.height;
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

function fitIconSizeToFrame(
  requested: { width: number; height: number },
  frame: ElementGeometry,
): { width: number; height: number } {
  const maximumWidth = Math.max(4, frame.width - 40);
  const maximumHeight = Math.max(4, frame.height - 32);
  const factor = Math.min(1, maximumWidth / requested.width, maximumHeight / requested.height);
  return {
    width: Math.max(4, requested.width * factor),
    height: Math.max(4, requested.height * factor),
  };
}

function interpolateGeometry(
  start: ElementGeometry,
  end: ElementGeometry,
  ratio: number,
): ElementGeometry {
  return {
    x: start.x + (end.x - start.x) * ratio,
    y: start.y + (end.y - start.y) * ratio,
    width: start.width + (end.width - start.width) * ratio,
    height: start.height + (end.height - start.height) * ratio,
  };
}

function interpolateSize(
  start: { width: number; height: number },
  end: { width: number; height: number },
  ratio: number,
): { width: number; height: number } {
  return {
    width: start.width + (end.width - start.width) * ratio,
    height: start.height + (end.height - start.height) * ratio,
  };
}

function rejected(
  elementId: string,
  code: RegionMembershipConstraintIssue["code"],
  message: string,
): RegionMembershipConstraintResult {
  return { changes: [], issue: { code, elementId, message } };
}
