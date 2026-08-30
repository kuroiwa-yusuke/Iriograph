import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  applyPortableDocumentReplace,
  buildIriographView,
  parseIriographDocumentV1,
  previewPortableDocumentReplace,
  projectSemanticView,
  type ElementGeometry,
  type IriographDocumentV1,
} from "@iriograph/core";

import { mockInstanceFlowProjectionCatalog } from "./catalog";
import { mockProjectionRuntimeContext } from "./authoring";

const PIZZA_FILES = [
  "pizza-order-delivery.iriograph",
  "pizza-order-delivery-llm-overlay.iriograph",
  "pizza-order-delivery-llm-overlay-r2.iriograph",
] as const;
const BILINGUAL_PIZZA_FILE = "pizza-order-delivery-bilingual.iriograph";
const HISTORICAL_PIZZA_FILE_HASHES = {
  "pizza-order-delivery.iriograph": "e726751197c733d70624d9a471d8e406e32d732a229f4ebcada41620c6c6720c",
  "pizza-order-delivery-llm-overlay.iriograph": "1ddce5293884875c6c8666a04e81412ff56a2ef4402043d455130dfbf62058a9",
  "pizza-order-delivery-llm-overlay-r2.iriograph": "27257f536a51afb85ae34bd0f2b0ff3f8eade3fbd7cdf6dfccca59de64f41434",
} as const;

describe("Pizza canonical fixture", () => {
  it("keeps every historical comparison fixture byte-identical", () => {
    for (const name of PIZZA_FILES) {
      const bytes = readFileSync(pizzaDocumentUrl(name));
      expect(createHash("sha256").update(bytes).digest("hex"), name)
        .toBe(HISTORICAL_PIZZA_FILE_HASHES[name]);
    }
  });

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
      mockInstanceFlowProjectionCatalog,
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

  it("r2のportable JSONをDocument置換としてpreview・applyできる", async () => {
    const current = readPizzaDocument(PIZZA_FILES[0]);
    const candidateSource = readFileSync(
      new URL(`../../public/workspace/models/${PIZZA_FILES[2]}`, import.meta.url),
      "utf8",
    );
    const preview = await previewPortableDocumentReplace(
      current,
      candidateSource,
      mockProjectionRuntimeContext,
      { documentRevision: "r1" },
    );

    expect(preview.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(preview.valid).toBe(true);
    const applied = await applyPortableDocumentReplace(
      current,
      preview,
      mockProjectionRuntimeContext,
      { confirmationId: preview.confirmationId, documentRevision: "r1" },
    );
    expect(applied.accepted).toBe(true);
    expect(applied.document).toEqual(readPizzaDocument(PIZZA_FILES[2]));
    expect(applied.scenes).toHaveProperty("main");
  });

  it("publishes an English-default bilingual sample without changing the canonical graph or overlay", () => {
    const canonical = readPizzaDocument(PIZZA_FILES[0]);
    const bilingual = readPizzaDocument(BILINGUAL_PIZZA_FILE);

    expect(bilingual.documentId).toBe("pizza-order-delivery-bilingual");
    expect(bilingual.semantic.baseIri).toBe(canonical.semantic.baseIri);
    expect(bilingual.imports).toEqual(canonical.imports);
    expect(bilingual.views[0]).toEqual({
      ...canonical.views[0],
      locale: "en",
      overlay: canonical.views[0]?.overlay,
    });

    const sourceWithoutAddedEnglish = bilingual.semantic.source
      .replace(/, "[^"\n]+"@en/gu, "")
      .replace(
        'pizza:lane4-d03 rdfs:label "注文完了"@ja .',
        'pizza:lane4-d03 rdfs:label "注文完了"@ja, "Order completed"@en .',
      );
    expect(sourceWithoutAddedEnglish).toBe(canonical.semantic.source);

    const labeledBlocks = bilingual.semantic.source.split("\n\n")
      .filter((block) => block.includes("rdfs:label"));
    const commentedBlocks = bilingual.semantic.source.split("\n\n")
      .filter((block) => block.includes("rdfs:comment"));
    expect(labeledBlocks.length).toBeGreaterThan(0);
    expect(labeledBlocks.every((block) => /rdfs:label [^\n]*@ja, "[^"\n]+"@en/u.test(block)))
      .toBe(true);
    expect(commentedBlocks.every((block) => /rdfs:comment [^\n]*@ja, "[^"\n]+"@en/u.test(block)))
      .toBe(true);

    const projected = projectSemanticView(
      bilingual,
      mockInstanceFlowProjectionCatalog,
      "main",
    );
    expect(projected.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(projected.nodes).toHaveLength(25);
    expect(projected.edges).toHaveLength(32);
    expect(projected.regions).toHaveLength(5);
    const visibleLabels = [
      ...projected.nodes.map((item) => item.label),
      ...projected.edges.map((item) => item.label),
      ...(projected.regions ?? []).map((item) => item.label),
    ].filter(Boolean);
    expect(visibleLabels).toEqual(expect.arrayContaining([
      "Choose a pizza",
      "Next step",
      "Customer",
    ]));
    expect(visibleLabels.some((label) => /[ぁ-んァ-ヶ一-龠]/u.test(label))).toBe(false);
  });

  it("makes the bilingual sample the public workspace default", () => {
    const manifest = JSON.parse(readFileSync(
      new URL("../../public/workspace/workspace.json", import.meta.url),
      "utf8",
    )) as {
      defaultDocumentPath: string;
      entries: Array<{ kind: string; path: string; documentId?: string; url: string }>;
    };
    expect(manifest.defaultDocumentPath).toBe(`models/${BILINGUAL_PIZZA_FILE}`);
    expect(manifest.entries).toContainEqual({
      kind: "iriograph-document",
      path: `models/${BILINGUAL_PIZZA_FILE}`,
      documentId: "pizza-order-delivery-bilingual",
      mediaType: "application/vnd.iriograph+json",
      url: `/workspace/models/${BILINGUAL_PIZZA_FILE}`,
    });
  });
});

function pizzaDocumentUrl(name: string): URL {
  return new URL(`../../public/workspace/models/${name}`, import.meta.url);
}

function readPizzaDocument(name: string): IriographDocumentV1 {
  return parseIriographDocumentV1(JSON.parse(readFileSync(
    pizzaDocumentUrl(name),
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
