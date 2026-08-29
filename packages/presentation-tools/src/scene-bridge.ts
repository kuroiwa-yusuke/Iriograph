import type {
  DiagramScene,
  SceneAnnotation,
  SceneContainer,
  SceneEdge,
  SceneNode,
  SceneRegion,
} from "@iriograph/core";

import { PresentationContractError, definePresentationSceneSnapshot } from "./contracts.js";
import { OPAQUE_ID, clone, deepFreeze } from "./internal.js";
import type {
  AcceptedPresentationValidation,
} from "./candidate.js";
import type {
  PresentationAppearance,
  PresentationCandidatePatch,
  PresentationElementKind,
  PresentationElementPatch,
  PresentationElementState,
  PresentationRouting,
  PresentationSceneBinding,
  PresentationSceneElement,
  PresentationSceneMembership,
  PresentationSceneSnapshot,
} from "./model.js";
import { PresentationSceneIndex } from "./scene-index.js";

export type PresentationSceneBridgeOptions = {
  scene: DiagramScene;
  /** Revisions stay exact; viewId is an opaque tool-session alias, not the portable view IRI. */
  binding: PresentationSceneBinding;
};

export type SourcePresentationElementPatch = Omit<PresentationElementPatch, "elementId"> & {
  /** Renderer Scene identity retained only on the trusted Host side. */
  elementId: string;
};

export type SourcePresentationCandidatePatch = Omit<PresentationCandidatePatch, "changes"> & {
  sourceViewId: string;
  changes: SourcePresentationElementPatch[];
};

/**
 * Converts a Core Scene into the closed presentation-tool boundary.
 *
 * Raw Scene IDs can contain encoded semantic IRIs. They never cross the tool
 * boundary: safe, already-opaque overlay IDs are retained and every other ID
 * receives a deterministic revision-local alias. The reverse map is private
 * to this Host-side bridge and is used only after validation/review.
 */
export class PresentationSceneBridge {
  readonly index: PresentationSceneIndex;
  readonly sourceViewId: string;
  readonly #sourceByAlias: ReadonlyMap<string, string>;
  readonly #aliasBySource: ReadonlyMap<string, string>;

  constructor(options: PresentationSceneBridgeOptions) {
    if (!OPAQUE_ID.test(options.binding.viewId)) {
      throw new PresentationContractError("Presentation view alias must be opaque.", [{
        code: "unsafe-value",
        message: "The tool-facing viewId must be an opaque Host alias, not a URL or IRI.",
        path: "/binding/viewId",
      }]);
    }
    this.sourceViewId = options.scene.viewId;
    const sourceElements = collectSourceElements(options.scene);
    const mappings = createElementAliases(sourceElements);
    this.#sourceByAlias = mappings.sourceByAlias;
    this.#aliasBySource = mappings.aliasBySource;
    const snapshot = definePresentationSceneSnapshot({
      binding: clone(options.binding),
      width: options.scene.width,
      height: options.scene.height,
      elements: sourceElements.map(({ kind, value }) => toPresentationElement(
        kind,
        value,
        mappings.aliasBySource,
      )),
      memberships: toMemberships(options.scene, mappings.aliasBySource),
    } satisfies PresentationSceneSnapshot);
    this.index = new PresentationSceneIndex(snapshot);
  }

  aliasForSourceElement(sourceElementId: string): string | undefined {
    return this.#aliasBySource.get(sourceElementId);
  }

  sourceElementForAlias(alias: string): string | undefined {
    return this.#sourceByAlias.get(alias);
  }

  /** Maps an accepted closed patch back to raw Scene IDs after external review. */
  toSourcePatch(
    validation: AcceptedPresentationValidation,
  ): Readonly<SourcePresentationCandidatePatch> {
    this.index.assertBinding(validation.patch.binding);
    const changes = validation.patch.changes.map((change) => {
      const sourceId = this.#sourceByAlias.get(change.elementId);
      if (!sourceId) {
        throw new PresentationContractError("Presentation target alias is no longer available.", [{
          code: "target-unresolved",
          message: `Presentation target alias is unresolved: ${change.elementId}`,
          path: "/changes",
        }]);
      }
      return { ...clone(change), elementId: sourceId };
    });
    return deepFreeze({
      binding: clone(validation.patch.binding),
      sourceViewId: this.sourceViewId,
      candidateId: validation.patch.candidateId,
      changes,
    });
  }
}

type SourceElement =
  | { kind: "node"; value: SceneNode }
  | { kind: "container"; value: SceneContainer }
  | { kind: "region"; value: SceneRegion }
  | { kind: "edge"; value: SceneEdge }
  | { kind: "annotation"; value: SceneAnnotation };

function collectSourceElements(scene: DiagramScene): SourceElement[] {
  return [
    ...scene.nodes.map((value) => ({ kind: "node" as const, value })),
    ...scene.containers.map((value) => ({ kind: "container" as const, value })),
    ...(scene.regions ?? []).map((value) => ({ kind: "region" as const, value })),
    ...scene.edges.map((value) => ({ kind: "edge" as const, value })),
    ...(scene.annotations ?? []).map((value) => ({ kind: "annotation" as const, value })),
  ];
}

function createElementAliases(elements: readonly SourceElement[]): {
  sourceByAlias: ReadonlyMap<string, string>;
  aliasBySource: ReadonlyMap<string, string>;
} {
  const sourceIds = new Set<string>();
  for (const { value } of elements) {
    if (sourceIds.has(value.elementId)) {
      throw new PresentationContractError("Source Scene has duplicate element IDs.", [{
        code: "invalid-value",
        message: "Source Scene element IDs must be unique before aliasing.",
      }]);
    }
    sourceIds.add(value.elementId);
  }
  const reserved = new Set(elements
    .map(({ value }) => value.elementId)
    .filter((value) => OPAQUE_ID.test(value)));
  const aliasBySource = new Map<string, string>();
  const sourceByAlias = new Map<string, string>();
  const counters = new Map<PresentationElementKind, number>();
  for (const { kind, value } of elements) {
    let alias = OPAQUE_ID.test(value.elementId) ? value.elementId : "";
    if (!alias) {
      let index = counters.get(kind) ?? 0;
      do {
        index += 1;
        alias = `${kind}-${String(index).padStart(3, "0")}`;
      } while (reserved.has(alias) || sourceByAlias.has(alias));
      counters.set(kind, index);
    }
    reserved.add(alias);
    aliasBySource.set(value.elementId, alias);
    sourceByAlias.set(alias, value.elementId);
  }
  return { sourceByAlias, aliasBySource };
}

function toPresentationElement(
  kind: PresentationElementKind,
  value: SceneNode | SceneContainer | SceneRegion | SceneEdge | SceneAnnotation,
  aliases: ReadonlyMap<string, string>,
): PresentationSceneElement {
  const elementId = requiredAlias(value.elementId, aliases);
  const label = kind === "annotation"
    ? (value as SceneAnnotation).text
    : (value as SceneNode | SceneContainer | SceneRegion | SceneEdge).label;
  const presentation = presentationState(kind, value);
  if (kind === "edge") {
    const edge = value as SceneEdge;
    return {
      elementId,
      kind,
      label,
      sourceElementId: requiredAlias(edge.sourceElementId, aliases),
      targetElementId: requiredAlias(edge.targetElementId, aliases),
      presentation,
    };
  }
  const parentElementId = "parentElementId" in value && value.parentElementId
    ? requiredAlias(value.parentElementId, aliases)
    : undefined;
  return { elementId, kind, label, presentation, ...(parentElementId ? { parentElementId } : {}) };
}

function presentationState(
  kind: PresentationElementKind,
  value: SceneNode | SceneContainer | SceneRegion | SceneEdge | SceneAnnotation,
): PresentationElementState {
  if (kind === "edge") {
    const edge = value as SceneEdge;
    const routing: PresentationRouting = {
      ...(edge.routeMode ? { routeMode: edge.routeMode } : {}),
      ...(edge.waypoints ? { waypoints: clone(edge.waypoints) } : {}),
      ...(edge.curve ? { curve: clone(edge.curve) } : {}),
      ...(edge.labelOffset ? { labelOffset: clone(edge.labelOffset) } : {}),
      ...(edge.sourceAnchor ? { sourceAnchor: clone(edge.sourceAnchor) } : {}),
      ...(edge.targetAnchor ? { targetAnchor: clone(edge.targetAnchor) } : {}),
      ...(edge.sourceMarker ? { sourceMarker: edge.sourceMarker } : {}),
      ...(edge.targetMarker ? { targetMarker: edge.targetMarker } : {}),
    };
    return {
      appearance: {
        style: clone(edge.style),
        ...(edge.caption ? { edgeCaption: edge.caption } : {}),
      },
      ...(Object.keys(routing).length > 0 ? { routing } : {}),
    };
  }
  const positioned = value as SceneNode | SceneContainer | SceneRegion | SceneAnnotation;
  const appearance = appearanceState(kind, positioned);
  return {
    geometry: clone(positioned.geometry),
    pinned: positioned.pinned,
    placement: positioned.placement,
    appearance,
  };
}

function appearanceState(
  kind: Exclude<PresentationElementKind, "edge">,
  value: SceneNode | SceneContainer | SceneRegion | SceneAnnotation,
): PresentationAppearance {
  const common: PresentationAppearance = { style: clone(value.style) };
  if (kind === "node") {
    const node = value as SceneNode;
    return {
      ...common,
      ...(node.labelPlacement ? { labelPlacement: node.labelPlacement } : {}),
      ...(node.nodeLabelOffset ? { nodeLabelOffset: clone(node.nodeLabelOffset) } : {}),
      ...(node.nodeLabelWritingDirection ? { nodeLabelWritingDirection: node.nodeLabelWritingDirection } : {}),
      ...(node.nodeIconOffset ? { nodeIconOffset: clone(node.nodeIconOffset) } : {}),
      ...(node.nodeIconScale === undefined ? {} : { nodeIconScale: node.nodeIconScale }),
      ...(node.nodeIconSize ? { nodeIconSize: clone(node.nodeIconSize) } : {}),
      ...(node.nodeIconFit ? { nodeIconFit: node.nodeIconFit } : {}),
    };
  }
  if (kind === "annotation") return common;
  const group = value as SceneContainer | SceneRegion;
  const result: PresentationAppearance = {
    ...common,
    ...(group.labelPlacement ? { labelPlacement: group.labelPlacement } : {}),
    ...(group.groupLabelAnchor === undefined ? {} : { groupLabelAnchor: group.groupLabelAnchor }),
    ...(group.groupLabelOffset === undefined ? {} : { groupLabelOffset: group.groupLabelOffset }),
    ...(group.groupLabelWritingDirection ? { groupLabelWritingDirection: group.groupLabelWritingDirection } : {}),
    ...(group.groupIconOffset ? { groupIconOffset: clone(group.groupIconOffset) } : {}),
    ...(group.groupIconScale === undefined ? {} : { groupIconScale: group.groupIconScale }),
    ...(group.groupZOrder === undefined ? {} : { groupZOrder: group.groupZOrder }),
  };
  if (kind === "region") {
    const region = group as SceneRegion;
    if (region.regionLabelAnchor !== undefined) result.regionLabelAnchor = region.regionLabelAnchor;
    if (region.regionLabelWritingDirection) result.regionLabelWritingDirection = region.regionLabelWritingDirection;
    if (region.regionZOrder !== undefined) result.regionZOrder = region.regionZOrder;
  }
  return result;
}

function toMemberships(
  scene: DiagramScene,
  aliases: ReadonlyMap<string, string>,
): PresentationSceneMembership[] {
  return (scene.memberships ?? []).map((membership) => ({
    groupElementId: requiredAlias(
      membership.regionElementId ?? membership.containerElementId,
      aliases,
    ),
    memberElementId: requiredAlias(membership.memberElementId, aliases),
    role: membership.role ?? "membership",
    ...(membership.ordinal === undefined ? {} : { ordinal: membership.ordinal }),
  }));
}

function requiredAlias(sourceId: string, aliases: ReadonlyMap<string, string>): string {
  const alias = aliases.get(sourceId);
  if (!alias) {
    throw new PresentationContractError("Source Scene reference is unresolved.", [{
      code: "target-unresolved",
      message: "Source Scene contains a reference to an element outside the snapshot.",
    }]);
  }
  return alias;
}
