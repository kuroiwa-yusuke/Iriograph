import { describe, expect, it, vi } from "vitest";

import type { ProjectionCatalogV1 } from "./model";
import {
  computeCatalogIntegrity,
  resolveProjectionCatalogImports,
  type CatalogRawSource,
  type ProjectionCatalogResolver,
} from "./catalog-resolution";

const PROFILE = "urn:test:profile:1";

describe("resolveProjectionCatalogImports", () => {
  it("catalogRef順で解決し、integrity検証後にrule originを修飾して決定的にmergeする", async () => {
    const base = catalog("urn:test:catalog:base", "1", {
      ruleId: "base-rule",
      templateRef: "urn:test:template:base",
      defaults: true,
    });
    const domain = catalog("urn:test:catalog:domain", "2", {
      ruleId: "domain-rule",
      templateRef: "urn:test:template:domain",
      assetRef: "urn:test:asset:domain",
    });
    const sources = new Map<string, CatalogRawSource>([
      ["urn:test:catalog:base@1", JSON.stringify(base)],
      ["urn:test:catalog:domain@2", new TextEncoder().encode(JSON.stringify(domain))],
    ]);
    const calls: string[] = [];
    const resolver: ProjectionCatalogResolver = {
      async resolveCatalog(catalogRef) {
        calls.push(catalogRef);
        const source = sources.get(catalogRef);
        if (!source) throw new Error("not found");
        return source;
      },
    };

    const domainIntegrity = await computeCatalogIntegrity(sources.get("urn:test:catalog:domain@2")!);
    const result = await resolveProjectionCatalogImports([
      { catalogRef: "urn:test:catalog:domain@2", integrity: domainIntegrity.replace(/=+$/u, "") },
      { catalogRef: "urn:test:catalog:base@1" },
    ], resolver);

    expect(result.accepted).toBe(true);
    if (!result.accepted) return;
    expect(calls).toEqual(["urn:test:catalog:base@1", "urn:test:catalog:domain@2"]);
    expect(result.catalogs.map((entry) => entry.catalogRef)).toEqual(calls);
    expect(result.mergedByProfile).toHaveLength(1);
    const merged = result.mergedByProfile[0]!;
    expect(merged.sourceCatalogRefs).toEqual(calls);
    expect(merged.catalog.defaults).toEqual(base.defaults);
    expect(Object.keys(merged.catalog.templates)).toEqual([
      "urn:test:template:base",
      "urn:test:template:domain",
    ]);
    expect(Object.keys(merged.catalog.assets)).toEqual(["urn:test:asset:domain"]);
    expect(merged.ruleOrigins).toEqual(merged.catalog.rules.map((rule, index) => ({
      qualifiedRuleId: rule.ruleId,
      catalogRef: calls[index],
      localRuleId: index === 0 ? "base-rule" : "domain-rule",
    })));
    expect(merged.catalog.rules.every((rule) => rule.ruleId.startsWith("urn:iriograph:catalog-rule:"))).toBe(true);

    const reversedResolver: ProjectionCatalogResolver = {
      async resolveCatalog(catalogRef) {
        return sources.get(catalogRef)!;
      },
    };
    const reversed = await resolveProjectionCatalogImports([
      { catalogRef: "urn:test:catalog:base@1" },
      { catalogRef: "urn:test:catalog:domain@2", integrity: domainIntegrity },
    ], reversedResolver);
    expect(reversed.accepted).toBe(true);
    if (reversed.accepted) expect(reversed.mergedByProfile).toEqual(result.mergedByProfile);
  });

  it("profileごとに独立してmergeし、各profileでdefaultsを1件だけ許可する", async () => {
    const first = catalog("urn:test:catalog:first", "1", {
      profileRef: "urn:test:profile:a",
      ruleId: "same-local-id",
      templateRef: "urn:test:template:same",
      defaults: true,
    });
    const second = catalog("urn:test:catalog:second", "1", {
      profileRef: "urn:test:profile:b",
      ruleId: "same-local-id",
      templateRef: "urn:test:template:same",
      defaults: true,
    });
    const result = await resolveProjectionCatalogImports([
      { catalogRef: "urn:test:catalog:second@1" },
      { catalogRef: "urn:test:catalog:first@1" },
    ], mapResolver({
      "urn:test:catalog:first@1": JSON.stringify(first),
      "urn:test:catalog:second@1": JSON.stringify(second),
    }));

    expect(result.accepted).toBe(true);
    if (result.accepted) {
      expect(result.mergedByProfile.map((entry) => entry.profileRef)).toEqual([
        "urn:test:profile:a",
        "urn:test:profile:b",
      ]);
    }
  });

  it("extension catalogだけでdefaults providerがないprofileを拒否する", async () => {
    const extension = catalog("urn:test:catalog:extension", "1", {
      ruleId: "extension-rule",
      templateRef: "urn:test:template:extension",
    });
    const result = await resolveProjectionCatalogImports([
      { catalogRef: "urn:test:catalog:extension@1" },
    ], mapResolver({
      "urn:test:catalog:extension@1": JSON.stringify(extension),
    }));

    expect(result.accepted).toBe(false);
    if (!result.accepted) {
      expect(result.diagnostics).toEqual([
        expect.objectContaining({ code: "catalog-defaults-missing" }),
      ]);
    }
  });

  it("duplicate refと不正なversioned refをresolver呼出前に拒否する", async () => {
    const resolveCatalog = vi.fn<ProjectionCatalogResolver["resolveCatalog"]>();
    const result = await resolveProjectionCatalogImports([
      { catalogRef: "urn:test:catalog:duplicate@1" },
      { catalogRef: "urn:test:catalog:duplicate@1" },
      { catalogRef: "urn:test:catalog:unversioned" },
    ], { resolveCatalog });

    expect(result.accepted).toBe(false);
    if (!result.accepted) {
      expect(result.diagnostics.map((item) => item.code)).toEqual([
        "catalog-import-duplicate-ref",
        "catalog-ref-invalid",
      ]);
    }
    expect(resolveCatalog).not.toHaveBeenCalled();
  });

  it("不正なsha256 tokenをresolver呼出前に拒否する", async () => {
    const resolveCatalog = vi.fn<ProjectionCatalogResolver["resolveCatalog"]>();
    const result = await resolveProjectionCatalogImports([{
      catalogRef: "urn:test:catalog:invalid-integrity@1",
      integrity: "sha256-short",
    }], { resolveCatalog });

    expect(result.accepted).toBe(false);
    if (!result.accepted) expect(result.diagnostics[0]?.code).toBe("catalog-integrity-invalid");
    expect(resolveCatalog).not.toHaveBeenCalled();
  });

  it("integrity mismatchをJSON parseより前に拒否する", async () => {
    const result = await resolveProjectionCatalogImports([
      {
        catalogRef: "urn:test:catalog:broken@1",
        integrity: "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
      },
    ], mapResolver({ "urn:test:catalog:broken@1": "not json" }));

    expect(result.accepted).toBe(false);
    if (!result.accepted) {
      expect(result.diagnostics).toEqual([
        expect.objectContaining({ code: "catalog-integrity-mismatch" }),
      ]);
    }
  });

  it("catalogRefと取得catalogのid/version不一致を拒否する", async () => {
    const source = catalog("urn:test:catalog:actual", "2", {
      ruleId: "rule",
      templateRef: "urn:test:template:actual",
    });
    const result = await resolveProjectionCatalogImports([
      { catalogRef: "urn:test:catalog:expected@1" },
    ], mapResolver({ "urn:test:catalog:expected@1": JSON.stringify(source) }));

    expect(result.accepted).toBe(false);
    if (!result.accepted) {
      expect(result.diagnostics).toEqual([
        expect.objectContaining({ code: "catalog-ref-identity-mismatch" }),
      ]);
    }
  });

  it("異なるrefが同じcatalog id/versionへ解決されたduplicate identityを報告する", async () => {
    const source = JSON.stringify(catalog("urn:test:catalog:actual", "1", {
      ruleId: "rule",
      templateRef: "urn:test:template:actual",
    }));
    const result = await resolveProjectionCatalogImports([
      { catalogRef: "urn:test:catalog:alias-a@1" },
      { catalogRef: "urn:test:catalog:alias-b@1" },
    ], mapResolver({
      "urn:test:catalog:alias-a@1": source,
      "urn:test:catalog:alias-b@1": source,
    }));

    expect(result.accepted).toBe(false);
    if (!result.accepted) {
      expect(result.diagnostics.map((item) => item.code)).toContain("catalog-duplicate-identity");
      expect(result.diagnostics.filter((item) => item.code === "catalog-ref-identity-mismatch")).toHaveLength(2);
    }
  });

  it.each([
    ["catalog-fetch-failed", undefined],
    ["catalog-json-invalid", "{"],
    ["catalog-schema-invalid", JSON.stringify({ kind: "iriograph.catalog" })],
  ] as const)("取得・parse failureを%s diagnosticにする", async (expectedCode, source) => {
    const resolver: ProjectionCatalogResolver = {
      async resolveCatalog() {
        if (source === undefined) throw new Error("offline");
        return source;
      },
    };
    const result = await resolveProjectionCatalogImports([
      { catalogRef: "urn:test:catalog:failure@1" },
    ], resolver);

    expect(result.accepted).toBe(false);
    if (!result.accepted) expect(result.diagnostics[0]?.code).toBe(expectedCode);
  });

  it("同profileのrule/template/asset/defaults衝突をすべてerrorにしlast-winsしない", async () => {
    const first = catalog("urn:test:catalog:first", "1", {
      ruleId: "collision",
      templateRef: "urn:test:template:collision",
      assetRef: "urn:test:asset:collision",
      defaults: true,
    });
    const second = catalog("urn:test:catalog:second", "1", {
      ruleId: "collision",
      templateRef: "urn:test:template:collision",
      assetRef: "urn:test:asset:collision",
      defaults: true,
    });
    const result = await resolveProjectionCatalogImports([
      { catalogRef: "urn:test:catalog:second@1" },
      { catalogRef: "urn:test:catalog:first@1" },
    ], mapResolver({
      "urn:test:catalog:first@1": JSON.stringify(first),
      "urn:test:catalog:second@1": JSON.stringify(second),
    }));

    expect(result.accepted).toBe(false);
    if (!result.accepted) {
      expect(result.diagnostics.map((item) => item.code).sort()).toEqual([
        "catalog-asset-conflict",
        "catalog-defaults-conflict",
        "catalog-rule-id-conflict",
        "catalog-template-conflict",
      ]);
    }
  });

  it("sha256 tokenをWeb CryptoだけでNode/browser共通形式へ計算する", async () => {
    await expect(computeCatalogIntegrity("")).resolves.toBe(
      "sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=",
    );
    await expect(computeCatalogIntegrity(new Uint8Array())).resolves.toBe(
      "sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=",
    );
  });
});

function catalog(
  catalogId: string,
  version: string,
  options: {
    profileRef?: string;
    ruleId: string;
    templateRef: string;
    assetRef?: string;
    defaults?: boolean;
  },
): ProjectionCatalogV1 {
  const template = {
    templateRef: options.templateRef,
    structuralKind: "node" as const,
    shape: "rounded-rectangle" as const,
    style: { fill: "white", stroke: "black", text: "black" },
  };
  return {
    schemaVersion: "1",
    kind: "iriograph.catalog",
    catalogId,
    catalogVersion: version,
    profileRef: options.profileRef ?? PROFILE,
    rules: [{
      ruleId: options.ruleId,
      priority: 100,
      match: { kind: "type", iri: "urn:test:Type", entailment: "exact" },
      project: { operator: "resource", structuralKind: "node" },
      templateRef: options.templateRef,
    }],
    templates: { [options.templateRef]: template },
    assets: options.assetRef
      ? {
          [options.assetRef]: {
            assetRef: options.assetRef,
            mediaType: "image/svg+xml",
            url: `urn:test:asset-source:${encodeURIComponent(options.assetRef)}`,
          },
        }
      : {},
    ...(options.defaults
      ? {
          defaults: {
            nodeTemplateRef: options.templateRef,
            edgeTemplateRef: options.templateRef,
            layoutRef: "urn:test:layout:1",
          },
        }
      : {}),
  };
}

function mapResolver(sources: Record<string, string>): ProjectionCatalogResolver {
  return {
    async resolveCatalog(catalogRef) {
      const source = sources[catalogRef];
      if (source === undefined) throw new Error(`missing fixture: ${catalogRef}`);
      return source;
    },
  };
}
