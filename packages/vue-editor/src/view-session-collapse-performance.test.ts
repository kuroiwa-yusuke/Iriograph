import { describe, expect, it } from "vitest";

import type {
  DiagramScene,
  IriographDocumentV1,
  ProjectionProvenance,
  VisualStyle,
} from "@iriograph/core";

import {
  createDiagramViewSession,
  sceneWithCollapsedGroups,
} from "./view-session";

const GROUP_COUNT = 128;
const MEMBERS_PER_GROUP = 64;
const COLLAPSE_PROCESSING_P95_MS = 300;

describe("large session-only group collapse", () => {
  it("removes members and incident edges without shortcuts or persistent mutations, then restores identity", () => {
    const source = largeSceneFixture();
    const document = documentFixture();
    const sourceSnapshot = structuredClone(source);
    const documentSnapshot = structuredClone(document);
    const sourceEdgeIds = new Set(source.edges.map(({ elementId }) => elementId));
    const sourceElementIdentity = elementIdentity(source);
    const session = createDiagramViewSession();
    session.selectedElementIds = ["node:0:0", "node:127:63"];
    session.primaryElementId = "node:0:0";
    session.viewport = { zoom: 1.75, scrollLeft: 320, scrollTop: 180 };
    for (let groupIndex = 0; groupIndex < GROUP_COUNT; groupIndex += 2) {
      session.collapsedGroupElementIds.add(groupId(groupIndex));
    }
    const sessionSnapshot = {
      selectedElementIds: [...session.selectedElementIds],
      primaryElementId: session.primaryElementId,
      viewport: { ...session.viewport },
    };

    const collapsed = sceneWithCollapsedGroups(source, session.collapsedGroupElementIds);
    const visibleIds = new Set([
      ...collapsed.scene.nodes.map(({ elementId }) => elementId),
      ...collapsed.scene.containers.map(({ elementId }) => elementId),
      ...(collapsed.scene.regions ?? []).map(({ elementId }) => elementId),
    ]);

    expect(Object.keys(collapsed.summaries)).toHaveLength(GROUP_COUNT / 2);
    expect(collapsed.summaries[groupId(0)]?.hiddenElementIds).toHaveLength(MEMBERS_PER_GROUP);
    expect(collapsed.scene.nodes).toHaveLength(1 + GROUP_COUNT / 2 * MEMBERS_PER_GROUP);
    expect(collapsed.scene.containers).toHaveLength(GROUP_COUNT);
    expect(collapsed.scene.edges).toHaveLength(
      GROUP_COUNT / 2 * ((MEMBERS_PER_GROUP - 1) + MEMBERS_PER_GROUP),
    );
    expect(collapsed.scene.edges.every((edge) => (
      sourceEdgeIds.has(edge.elementId)
      && visibleIds.has(edge.sourceElementId)
      && visibleIds.has(edge.targetElementId)
    ))).toBe(true);
    expect(collapsed.scene.edges.some((edge) => (
      edge.sourceElementId.startsWith("group:") || edge.targetElementId.startsWith("group:")
    ))).toBe(false);

    expect(source).toEqual(sourceSnapshot);
    expect(document).toEqual(documentSnapshot);
    expect(session).toMatchObject(sessionSnapshot);

    session.collapsedGroupElementIds.clear();
    const expanded = sceneWithCollapsedGroups(source, session.collapsedGroupElementIds);
    expect(expanded.scene).toBe(source);
    expect(elementIdentity(expanded.scene)).toEqual(sourceElementIdentity);
    expect(expanded.scene.edges.map(({ elementId }) => elementId))
      .toEqual(source.edges.map(({ elementId }) => elementId));
    expect(session).toMatchObject(sessionSnapshot);
  });

  it("cuts rendered elements materially and stays within the fixed processing gate", () => {
    const source = largeSceneFixture();
    const collapsedIds = new Set(
      Array.from({ length: GROUP_COUNT / 2 }, (_, index) => groupId(index * 2)),
    );
    for (let iteration = 0; iteration < 3; iteration += 1) {
      sceneWithCollapsedGroups(source, collapsedIds);
    }

    const samplesMs = Array.from({ length: 11 }, () => {
      const started = performance.now();
      const result = sceneWithCollapsedGroups(source, collapsedIds);
      const elapsed = performance.now() - started;
      expect(result.scene.nodes.length).toBe(1 + GROUP_COUNT / 2 * MEMBERS_PER_GROUP);
      return elapsed;
    }).sort((left, right) => left - right);
    const p95Ms = samplesMs[Math.ceil(samplesMs.length * .95) - 1]!;
    const sourceRenderElements = renderElementCount(source);
    const collapsed = sceneWithCollapsedGroups(source, collapsedIds).scene;
    const collapsedRenderElements = renderElementCount(collapsed);
    const retainedRatio = collapsedRenderElements / sourceRenderElements;

    console.info(JSON.stringify({
      benchmark: "view-session-large-group-collapse",
      groups: GROUP_COUNT,
      membersPerGroup: MEMBERS_PER_GROUP,
      incidentAndInternalEdges: source.edges.length,
      sourceRenderElements,
      collapsedRenderElements,
      retainedRatio: Number(retainedRatio.toFixed(4)),
      samplesMs: samplesMs.map((sample) => Number(sample.toFixed(2))),
      p95Ms: Number(p95Ms.toFixed(2)),
      referenceBudgetMs: COLLAPSE_PROCESSING_P95_MS,
    }));

    expect(collapsedRenderElements).toBeLessThan(sourceRenderElements * .55);
    expect(p95Ms).toBeLessThan(COLLAPSE_PROCESSING_P95_MS);
  });
});

function largeSceneFixture(): DiagramScene {
  const geometry = { x: 0, y: 0, width: 120, height: 60 };
  const style: VisualStyle = { fill: "#fff", stroke: "#000", text: "#000" };
  const provenance: ProjectionProvenance = {
    sourceStatementRefs: [],
    operator: "membership-container",
    derivation: "derived",
  };
  const containers: DiagramScene["containers"] = [];
  const nodes: DiagramScene["nodes"] = [{
    elementId: "node:outside",
    semanticRef: "urn:test:collapse:outside",
    structuralKind: "node",
    label: "Outside",
    templateRef: "node-template",
    shape: "rectangle",
    geometry,
    style,
    pinned: false,
    placement: "generated",
  }];
  const memberships: NonNullable<DiagramScene["memberships"]> = [];
  const edges: DiagramScene["edges"] = [];

  for (let groupIndex = 0; groupIndex < GROUP_COUNT; groupIndex += 1) {
    const containerElementId = groupId(groupIndex);
    containers.push({
      elementId: containerElementId,
      semanticRef: `urn:test:collapse:group:${groupIndex}`,
      structuralKind: "container",
      label: `Group ${groupIndex}`,
      templateRef: "container-template",
      geometry,
      headerPosition: "top",
      style,
      pinned: false,
      placement: "generated",
    });
    for (let memberIndex = 0; memberIndex < MEMBERS_PER_GROUP; memberIndex += 1) {
      const elementId = memberId(groupIndex, memberIndex);
      nodes.push({
        elementId,
        semanticRef: `urn:test:collapse:member:${groupIndex}:${memberIndex}`,
        structuralKind: "node",
        label: `Member ${groupIndex}/${memberIndex}`,
        templateRef: "node-template",
        shape: "rectangle",
        geometry,
        style,
        ...(memberIndex % 2 === 0 ? { parentElementId: containerElementId } : {}),
        pinned: false,
        placement: "generated",
      });
      if (memberIndex % 2 === 1) {
        memberships.push({
          semanticRef: `urn:test:collapse:membership:${groupIndex}:${memberIndex}`,
          containerElementId,
          memberElementId: elementId,
          provenance,
        });
      }
      edges.push(edge(
        `edge:incident:${groupIndex}:${memberIndex}`,
        elementId,
        "node:outside",
        style,
      ));
      if (memberIndex > 0) {
        edges.push(edge(
          `edge:internal:${groupIndex}:${memberIndex - 1}:${memberIndex}`,
          memberId(groupIndex, memberIndex - 1),
          elementId,
          style,
        ));
      }
    }
  }

  return {
    viewId: "large-collapse",
    width: 12000,
    height: 8000,
    diagnostics: [],
    containers,
    nodes,
    memberships,
    edges,
  };
}

function edge(
  elementId: string,
  sourceElementId: string,
  targetElementId: string,
  style: VisualStyle,
): DiagramScene["edges"][number] {
  return {
    elementId,
    semanticRef: `urn:test:collapse:${elementId}`,
    structuralKind: "edge",
    sourceElementId,
    targetElementId,
    templateRef: "edge-template",
    style,
    label: "",
    fallback: false,
  };
}

function documentFixture(): IriographDocumentV1 {
  return {
    schemaVersion: "1",
    kind: "iriograph.document",
    documentId: "large-collapse-document",
    semantic: {
      format: "text/turtle",
      baseIri: "urn:test:collapse:",
      authoringProfileRef: "urn:test:collapse:authoring-profile",
      source: "<urn:test:collapse:outside> <urn:test:collapse:label> \"Outside\" .",
    },
    views: [{
      viewId: "large-collapse",
      kind: "node-link",
      profileRef: "urn:test:collapse:profile",
      layoutRef: "urn:test:collapse:layout",
      overlay: {},
    }],
  };
}

function groupId(groupIndex: number): string {
  return `group:${groupIndex}`;
}

function memberId(groupIndex: number, memberIndex: number): string {
  return `node:${groupIndex}:${memberIndex}`;
}

function elementIdentity(scene: DiagramScene): string[] {
  return [
    ...scene.containers,
    ...(scene.regions ?? []),
    ...scene.nodes,
    ...(scene.annotations ?? []),
    ...scene.edges,
  ].map(({ elementId }) => elementId);
}

function renderElementCount(scene: DiagramScene): number {
  return scene.containers.length
    + (scene.regions?.length ?? 0)
    + scene.nodes.length
    + (scene.annotations?.length ?? 0)
    + scene.edges.length
    + (scene.groupGuides?.length ?? 0);
}
