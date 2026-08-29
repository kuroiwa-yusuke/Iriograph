import {
  createProjectionRuntimeContext,
  createStandardLayoutRegistry,
  parseIriographDocumentV1,
  validateProjectionCatalog,
  validateProjectionCatalogV1,
  type IriographDocumentV1,
  type ProjectionCatalogV1,
  type ProjectionDiagnostic,
  type ResolvedAuthoringCapability,
  type ResolvedAuthoringTerm,
  type ResolvedNodeRole,
} from "@iriograph/core";

export type DomainProfileLicense = {
  licenseId: string;
  notice: string;
  sourceUrl?: string;
};

export type DomainProjectionProfileManifestV1 = {
  schemaVersion: "1";
  kind: "iriograph.domain-profile";
  profileId: string;
  profileVersion: string;
  profileRef: string;
  defaultLocale: string;
  ontology: {
    mediaType: "text/turtle";
    source: string;
  };
  authoring: {
    roles: ResolvedNodeRole[];
    terms: ResolvedAuthoringTerm[];
    capabilities?: ResolvedAuthoringCapability[];
  };
  /** Versioned standard/domain catalog dependencies resolved by the Host. */
  catalogRefs: string[];
  catalog: ProjectionCatalogV1;
  licenses: DomainProfileLicense[];
};

export type DomainProfileDiagnostic = {
  severity: "error";
  code:
    | "profile-identity-invalid"
    | "profile-locale-invalid"
    | "catalog-profile-mismatch"
    | "catalog-ref-invalid"
    | "catalog-schema-invalid"
    | "catalog-rule-conflict"
    | "authoring-option-conflict"
    | "license-missing";
  message: string;
};

export function validateDomainProjectionProfile(
  profile: DomainProjectionProfileManifestV1,
): DomainProfileDiagnostic[] {
  const diagnostics: DomainProfileDiagnostic[] = [];
  if (profile.profileRef !== `${profile.profileId}@${profile.profileVersion}` || !exactRef(profile.profileRef)) {
    diagnostics.push(error("profile-identity-invalid", "profileRef must equal profileId@exactVersion"));
  }
  if (!/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/u.test(profile.defaultLocale)) {
    diagnostics.push(error("profile-locale-invalid", `invalid default locale: ${profile.defaultLocale}`));
  }
  if (profile.catalog.profileRef !== profile.profileRef) {
    diagnostics.push(error("catalog-profile-mismatch", "embedded catalog profileRef must equal profileRef"));
  }
  for (const ref of profile.catalogRefs) {
    if (!exactRef(ref)) diagnostics.push(error("catalog-ref-invalid", `catalog dependency requires exact version: ${ref}`));
  }
  const schema = validateProjectionCatalogV1(profile.catalog);
  if (!schema.valid) diagnostics.push(error("catalog-schema-invalid", schema.issues.map((item) => item.message).join("; ")));
  for (const item of validateProjectionCatalog(profile.catalog)) {
    if (item.severity === "error") diagnostics.push(error("catalog-rule-conflict", item.message));
  }
  diagnostics.push(...opaqueConflicts(profile));
  if (profile.licenses.length === 0 || profile.licenses.some((item) => !item.licenseId || !item.notice)) {
    diagnostics.push(error("license-missing", "profile and bundled assets require explicit license notices"));
  }
  return diagnostics.sort((a, b) => `${a.code}\0${a.message}`.localeCompare(`${b.code}\0${b.message}`));
}

export type DomainProfileConformanceResult = {
  accepted: boolean;
  profileDiagnostics: DomainProfileDiagnostic[];
  projectionDiagnostics: ProjectionDiagnostic[];
  elementCount: number;
  fallbackElementCount: number;
  exactProvenanceCount: number;
};

/**
 * Executes one reference fixture against standard dependencies plus the domain
 * catalog. Unknown IRI-object statements must remain visible through fallback.
 */
export async function runDomainProfileConformance(
  profile: DomainProjectionProfileManifestV1,
  fixture: IriographDocumentV1 | unknown,
  dependencies: readonly { catalogRef: string; catalog: ProjectionCatalogV1 }[],
): Promise<DomainProfileConformanceResult> {
  const profileDiagnostics = validateDomainProjectionProfile(profile);
  if (profileDiagnostics.length > 0) {
    return { accepted: false, profileDiagnostics, projectionDiagnostics: [], elementCount: 0, fallbackElementCount: 0, exactProvenanceCount: 0 };
  }
  const document = parseIriographDocumentV1(fixture);
  const runtime = createProjectionRuntimeContext([
    ...dependencies.map((entry) => ({
      profileRef: entry.catalog.profileRef,
      sourceCatalogRefs: [entry.catalogRef],
      catalog: entry.catalog,
      ruleOrigins: [],
    })),
    {
      profileRef: profile.catalog.profileRef,
      sourceCatalogRefs: [`${profile.catalog.catalogId}@${profile.catalog.catalogVersion}`],
      catalog: profile.catalog,
      ruleOrigins: [],
    },
  ], createStandardLayoutRegistry());
  const { buildIriographView } = await import("@iriograph/core");
  const scene = await buildIriographView(document, document.views[0]!.viewId, runtime);
  const elements = [...scene.nodes, ...scene.containers, ...(scene.regions ?? []), ...scene.edges];
  return {
    accepted: !scene.diagnostics.some((item) => item.severity === "error"),
    profileDiagnostics,
    projectionDiagnostics: scene.diagnostics,
    elementCount: elements.length,
    fallbackElementCount: scene.edges.filter((edge) => edge.fallback).length,
    exactProvenanceCount: elements.filter((element) => element.provenance?.resolutionTrace?.outcome === "resolved").length,
  };
}

function opaqueConflicts(profile: DomainProjectionProfileManifestV1): DomainProfileDiagnostic[] {
  const values = [
    ...profile.authoring.roles.map((item) => `role:${item.roleId}`),
    ...profile.authoring.terms.map((item) => `term:${item.termId ?? ""}`),
    ...(profile.authoring.capabilities ?? []).map((item) => `capability:${item.capabilityId}`),
  ];
  const seen = new Set<string>();
  const result: DomainProfileDiagnostic[] = [];
  for (const value of values) {
    if (value.endsWith(":")) result.push(error("authoring-option-conflict", "authoring options require stable opaque IDs"));
    else if (seen.has(value)) result.push(error("authoring-option-conflict", `duplicate authoring option: ${value}`));
    seen.add(value);
  }
  return result;
}

function exactRef(value: string): boolean {
  return /@[^/@]+$/u.test(value);
}

function error(code: DomainProfileDiagnostic["code"], message: string): DomainProfileDiagnostic {
  return { severity: "error", code, message };
}

export * from "./reference-profile.js";
