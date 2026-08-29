import { describe, expect, it } from "vitest";
import { IRIOGRAPH_HOST_CONFORMANCE_MANIFEST, verifyIriographHostConformance } from "./index.js";

describe("host conformance gate", () => {
  it("fails stale package/CSS, missing capabilities and undeclared extensions", () => {
    const errors = verifyIriographHostConformance({
      host: "product",
      packageVersion: "0.10.2",
      cssEntry: "copied.css",
      baselineCatalogRef: IRIOGRAPH_HOST_CONFORMANCE_MANIFEST.baselineCatalogRef,
      fixtureRef: IRIOGRAPH_HOST_CONFORMANCE_MANIFEST.fixtureRef,
      fixtureIntegrity: "sha256-stale",
      capabilities: ["unknown-capability"],
      browserChecks: ["unknown-browser-check"],
      extensions: ["unknown"],
      health: "healthy",
      browserErrors: [],
      failedRequests: [],
    });
    expect(errors).toContain("package-version-mismatch");
    expect(errors).toContain("css-entry-mismatch");
    expect(errors).toContain("fixture-integrity-mismatch");
    expect(errors).toContain("capability-missing:grid");
    expect(errors).toContain("capability-undeclared:unknown-capability");
    expect(errors).toContain("browser-check-missing:focus-navigation");
    expect(errors).toContain("browser-check-undeclared:unknown-browser-check");
    expect(errors).toContain("undeclared-host-extension:unknown");
  });

  it("accepts a healthy host report covering the complete versioned manifest", () => {
    const manifest = IRIOGRAPH_HOST_CONFORMANCE_MANIFEST;
    expect(verifyIriographHostConformance({
      host: "mock",
      packageVersion: manifest.packageVersion,
      cssEntry: manifest.cssEntry,
      baselineCatalogRef: manifest.baselineCatalogRef,
      fixtureRef: manifest.fixtureRef,
      fixtureIntegrity: manifest.fixtureIntegrity,
      capabilities: manifest.capabilities.map((capability) => capability.id),
      browserChecks: manifest.browserChecks.map((check) => check.id),
      extensions: [],
      health: "healthy",
      browserErrors: [],
      failedRequests: [],
    })).toEqual([]);
  });
});
