export const IRIOGRAPH_HOST_CONFORMANCE_MANIFEST = Object.freeze({
  schemaVersion: "1",
  kind: "iriograph.host-conformance",
  packageVersion: "0.12.1",
  cssEntry: "@iriograph/vue-editor/styles.css",
  fixtureRef: "@iriograph/host-conformance/fixtures/baseline.iriograph.json",
  fixtureIntegrity: "sha256-+vzGLBfjWs3Flr6Rprffdt8atwm0FGBLKMXAFMCXPcU=",
  baselineCatalogRef: "urn:iriograph:catalog:workflow-instance-flow@1",
  capabilities: [
    { id: "semantic-authoring", componentTestId: "IriographEditor.semantic-authoring", e2eTestId: "editor semantic authoring" },
    { id: "presentation-overlay", componentTestId: "IriographEditor.presentation-overlay", e2eTestId: "overlay source and Canvas edit" },
    { id: "workspace-assets", componentTestId: "IriographEditor.workspace-assets", e2eTestId: "workspace asset picker" },
    { id: "grid", componentTestId: "DiagramCanvas.grid", e2eTestId: "grid session control" },
    { id: "marquee-selection", componentTestId: "DiagramCanvas.marquee", e2eTestId: "marquee selection" },
    { id: "group-membership", componentTestId: "SemanticIntentPanel.membership", e2eTestId: "nested membership" },
    { id: "manual-and-auto-routing", componentTestId: "DiagramCanvas.routing", e2eTestId: "edge routing" },
    { id: "type-list", componentTestId: "TypeListPanel.tree", e2eTestId: "type list" },
  ],
  browserChecks: [
    { id: "runtime-metadata", e2eTestId: "host conformance runtime metadata" },
    { id: "css-and-grid", e2eTestId: "host conformance CSS and grid" },
    { id: "baseline-fixture", e2eTestId: "host conformance common fixture" },
    { id: "selection", e2eTestId: "host conformance selection" },
    { id: "context-menu", e2eTestId: "host conformance context menu" },
    { id: "container-membership", e2eTestId: "host conformance container" },
    { id: "focus-navigation", e2eTestId: "host conformance focus" },
  ],
} as const);

export type IriographHostConformanceManifest = typeof IRIOGRAPH_HOST_CONFORMANCE_MANIFEST;

export type IriographHostConformanceReport = {
  host: "mock" | "product";
  packageVersion: string;
  cssEntry: string;
  baselineCatalogRef: string;
  fixtureRef: string;
  fixtureIntegrity: string;
  capabilities: string[];
  browserChecks: string[];
  extensions: string[];
  health: "healthy" | "unhealthy";
  browserErrors: string[];
  failedRequests: string[];
};

export type IriographHostConformancePolicy = {
  allowedExtensions?: readonly string[];
};

export function verifyIriographHostConformance(
  report: IriographHostConformanceReport,
  policy: IriographHostConformancePolicy = {},
): string[] {
  const manifest = IRIOGRAPH_HOST_CONFORMANCE_MANIFEST;
  const errors: string[] = [];
  if (report.packageVersion !== manifest.packageVersion) errors.push("package-version-mismatch");
  if (report.cssEntry !== manifest.cssEntry) errors.push("css-entry-mismatch");
  if (report.baselineCatalogRef !== manifest.baselineCatalogRef) errors.push("baseline-catalog-mismatch");
  if (report.fixtureRef !== manifest.fixtureRef) errors.push("fixture-mismatch");
  if (report.fixtureIntegrity !== manifest.fixtureIntegrity) errors.push("fixture-integrity-mismatch");
  for (const capability of manifest.capabilities) {
    if (!report.capabilities.includes(capability.id)) errors.push(`capability-missing:${capability.id}`);
  }
  const declaredCapabilities = new Set(manifest.capabilities.map((capability) => capability.id));
  for (const capability of report.capabilities) {
    if (!declaredCapabilities.has(capability as typeof manifest.capabilities[number]["id"])) {
      errors.push(`capability-undeclared:${capability}`);
    }
  }
  for (const check of manifest.browserChecks) {
    if (!report.browserChecks.includes(check.id)) errors.push(`browser-check-missing:${check.id}`);
  }
  const declaredBrowserChecks = new Set(manifest.browserChecks.map((check) => check.id));
  for (const check of report.browserChecks) {
    if (!declaredBrowserChecks.has(check as typeof manifest.browserChecks[number]["id"])) {
      errors.push(`browser-check-undeclared:${check}`);
    }
  }
  const allowed = new Set(policy.allowedExtensions ?? []);
  for (const extension of report.extensions) {
    if (!allowed.has(extension)) errors.push(`undeclared-host-extension:${extension}`);
  }
  if (report.health !== "healthy") errors.push("service-unhealthy");
  if (report.browserErrors.length > 0) errors.push("browser-error");
  if (report.failedRequests.length > 0) errors.push("request-failure");
  return [...new Set(errors)].sort();
}

export function compareMockAndProductConformance(
  mock: IriographHostConformanceReport,
  product: IriographHostConformanceReport,
  policy: IriographHostConformancePolicy = {},
): string[] {
  return [
    ...verifyIriographHostConformance(mock, policy).map((value) => `mock:${value}`),
    ...verifyIriographHostConformance(product, policy).map((value) => `product:${value}`),
  ].sort();
}
