import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  buildIriographView,
  parseIriographDocumentV1,
  projectSemanticView,
  type ElementGeometry,
  type IriographDocumentV1,
} from "@iriograph/core";

import { mockClassificationRegionProjectionCatalog } from "./catalog";
import { mockProjectionRuntimeContext } from "./authoring";

const PIZZA_FILES = [
  "pizza-order-delivery.iriograph",
  "pizza-order-delivery-llm-overlay.iriograph",
  "pizza-order-delivery-llm-overlay-r2.iriograph",
] as const;

describe("Pizza canonical fixture", () => {
  it("過去のLLM実験と同じcanonical Turtleを3 fixtureでbyte-identicalに保つ", () => {
    const documents = PIZZA_FILES.map(readPizzaDocument);
    const canonical = documents[0]!;
    expect(canonical.views[0]?.overlay).toEqual({});
    expect(documents.map((document) => document.semantic.source))
      .toEqual([canonical.semantic.source, canonical.semantic.source, canonical.semantic.source]);

    expect(new TextEncoder().encode(canonical.semantic.source)).toHaveLength(5_161);
    expect(createHash("sha256").update(canonical.semantic.source).digest("hex"))
      .toBe("e367fea3b0befe35ab9571ea8bf62055025682737286d3e9c5db1aa7c7afc7bb");
    expect(canonical.semantic.source).not.toContain("urn:iriograph:authoring-role:");

    const projected = projectSemanticView(
      canonical,
      mockClassificationRegionProjectionCatalog,
      "main",
    );
    expect(projected.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(projected.nodes).toHaveLength(25);
    expect(projected.edges).toHaveLength(32);
    expect(projected.regions).toHaveLength(5);
  });

  it("自動配置で未所属要素を領域外に置き独立領域を重ねない", async () => {
    const scene = await buildIriographView(
      readPizzaDocument(PIZZA_FILES[0]),
      "main",
      mockProjectionRuntimeContext,
      "full",
    );
    expect(scene.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    const regions = scene.regions ?? [];
    const memberships = scene.memberships ?? [];
    const regionIds = new Set(regions.map((region) => region.elementId));
    const ownedNodeIds = new Set(memberships.flatMap((membership) => (
      membership.regionElementId && !regionIds.has(membership.memberElementId)
        ? [membership.memberElementId]
        : []
    )));
    const unowned = scene.nodes.filter((node) => !ownedNodeIds.has(node.elementId));
    expect(unowned.map((node) => node.semanticRef).sort()).toEqual([
      "urn:iriograph:sample:pizza:fee",
      "urn:iriograph:sample:pizza:inquiry",
      "urn:iriograph:sample:pizza:order",
      "urn:iriograph:sample:pizza:pizza",
      "urn:iriograph:sample:pizza:receipt",
    ]);
    for (const node of unowned) {
      expect(regions.some((region) => overlaps(node.geometry, region.geometry)), node.semanticRef)
        .toBe(false);
    }

    const directRegionMembers = new Map(regions.map((region) => [
      region.elementId,
      new Set(memberships.filter((membership) => (
        membership.regionElementId === region.elementId
      )).map((membership) => membership.memberElementId)),
    ]));
    for (let leftIndex = 0; leftIndex < regions.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < regions.length; rightIndex += 1) {
        const left = regions[leftIndex]!;
        const right = regions[rightIndex]!;
        if (containsRegion(left.elementId, right.elementId, directRegionMembers)) continue;
        if (containsRegion(right.elementId, left.elementId, directRegionMembers)) continue;
        const shared = [...directRegionMembers.get(left.elementId)!]
          .some((memberId) => directRegionMembers.get(right.elementId)!.has(memberId));
        if (shared) continue;
        expect(overlaps(left.geometry, right.geometry), `${left.semanticRef} / ${right.semanticRef}`)
          .toBe(false);
      }
    }
  }, 20_000);
});

function readPizzaDocument(name: typeof PIZZA_FILES[number]): IriographDocumentV1 {
  return parseIriographDocumentV1(JSON.parse(readFileSync(
    new URL(`../../public/workspace/models/${name}`, import.meta.url),
    "utf8",
  )) as unknown);
}

function containsRegion(
  ancestorId: string,
  descendantId: string,
  memberships: ReadonlyMap<string, ReadonlySet<string>>,
  seen = new Set<string>(),
): boolean {
  if (seen.has(ancestorId)) return false;
  seen.add(ancestorId);
  const members = memberships.get(ancestorId);
  if (!members) return false;
  if (members.has(descendantId)) return true;
  return [...members].some((memberId) => (
    memberships.has(memberId)
    && containsRegion(memberId, descendantId, memberships, seen)
  ));
}

function overlaps(left: ElementGeometry, right: ElementGeometry): boolean {
  return left.x < right.x + right.width
    && left.x + left.width > right.x
    && left.y < right.y + right.height
    && left.y + left.height > right.y;
}
