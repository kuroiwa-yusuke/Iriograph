import {
  catalogRef,
  parseProjectionCatalogV1,
  standardRdfRdfsCatalog,
  type AssetDefinition,
  type ProjectionCatalogV1,
  type ProjectionRule,
  type VisualTemplate,
} from "@iriograph/core";

import rawDomainCatalog from "./catalog.json";

export const workflowDomainCatalog = parseProjectionCatalogV1(rawDomainCatalog);

export const mockProjectionCatalog: ProjectionCatalogV1 = mergeCatalogs(
  standardRdfRdfsCatalog,
  workflowDomainCatalog,
);

function mergeCatalogs(
  standard: ProjectionCatalogV1,
  domain: ProjectionCatalogV1,
): ProjectionCatalogV1 {
  if (standard.profileRef !== domain.profileRef) {
    throw new Error(`Mock catalog profile mismatch: ${standard.profileRef} != ${domain.profileRef}`);
  }
  if (!standard.defaults) {
    throw new Error("Standard RDF/RDFS catalog must provide mock defaults.");
  }
  if (domain.defaults) {
    throw new Error("Workflow domain extension catalog must not provide defaults.");
  }

  assertNoCollisions(
    standard.rules.map((rule) => rule.ruleId),
    domain.rules.map((rule) => rule.ruleId),
    "ruleId",
  );
  assertNoCollisions(Object.keys(standard.templates), Object.keys(domain.templates), "templateRef");
  assertNoCollisions(Object.keys(standard.assets), Object.keys(domain.assets), "assetRef");

  const ruleEntries = [standard, domain]
    .flatMap((source) => source.rules.map((rule) => ({
      catalogRef: catalogRef(source),
      rule,
    })))
    .sort((left, right) => compareText(left.catalogRef, right.catalogRef)
      || compareText(left.rule.ruleId, right.rule.ruleId));

  return {
    schemaVersion: "1",
    kind: "iriograph.catalog",
    catalogId: "urn:iriograph:catalog:workflow-mock-resolved",
    catalogVersion: "1",
    profileRef: standard.profileRef,
    defaults: clone(standard.defaults),
    rules: ruleEntries.map(({ catalogRef: origin, rule }) => ({
      ...clone<ProjectionRule>(rule),
      ruleId: `${origin}#${rule.ruleId}`,
    })),
    templates: mergeRecords<VisualTemplate>(standard.templates, domain.templates),
    styles: mergeRecords(standard.styles ?? {}, domain.styles ?? {}),
    assets: mergeRecords<AssetDefinition>(standard.assets, domain.assets),
  };
}

function mergeRecords<T>(
  standard: Readonly<Record<string, T>>,
  domain: Readonly<Record<string, T>>,
): Record<string, T> {
  return Object.fromEntries(
    [...Object.entries(standard), ...Object.entries(domain)]
      .sort(([left], [right]) => compareText(left, right))
      .map(([key, value]) => [key, clone(value)]),
  );
}

function assertNoCollisions(
  standardKeys: readonly string[],
  domainKeys: readonly string[],
  kind: string,
): void {
  const standard = new Set(standardKeys);
  const collisions = domainKeys.filter((key) => standard.has(key)).sort(compareText);
  if (collisions.length > 0) {
    throw new Error(`Mock catalog ${kind} collision: ${collisions.join(", ")}`);
  }
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
