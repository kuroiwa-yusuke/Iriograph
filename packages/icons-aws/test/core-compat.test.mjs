import assert from "node:assert/strict";
import test from "node:test";

import {
  catalogRef,
  computeCatalogIntegrity,
  parseProjectionCatalogV1,
  resolveProjectionCatalogImports,
  standardRdfRdfsInstanceFlowCatalog,
} from "../../core/dist/index.js";
import {
  AWS_ICON_CATALOG_INTEGRITY,
  AWS_ICON_CATALOG_REF,
  awsIconCatalogManifest,
  createAwsIconCatalogResolver,
} from "../index.js";

test("manifest satisfies Core ProjectionCatalogV1 and merges with the standard profile", async () => {
  const vendorCatalog = parseProjectionCatalogV1(awsIconCatalogManifest);
  assert.equal(`${vendorCatalog.catalogId}@${vendorCatalog.catalogVersion}`, AWS_ICON_CATALOG_REF);

  const baseRef = catalogRef(standardRdfRdfsInstanceFlowCatalog);
  const baseSource = JSON.stringify(standardRdfRdfsInstanceFlowCatalog);
  const baseIntegrity = await computeCatalogIntegrity(baseSource);
  const resolver = createAwsIconCatalogResolver({
    fallback: {
      resolveCatalog(requestedRef) {
        if (requestedRef === baseRef) return baseSource;
        throw new Error(`catalog not found: ${requestedRef}`);
      },
    },
  });

  const result = await resolveProjectionCatalogImports([
    { catalogRef: baseRef, integrity: baseIntegrity },
    { catalogRef: AWS_ICON_CATALOG_REF, integrity: AWS_ICON_CATALOG_INTEGRITY },
  ], resolver);
  assert.equal(result.accepted, true, JSON.stringify(result.diagnostics));
  assert.equal(result.catalogs.length, 2);
  assert.deepEqual(result.mergedByProfile[0].sourceCatalogRefs, [
    AWS_ICON_CATALOG_REF,
    baseRef,
  ].sort());
  assert.equal(Object.keys(result.mergedByProfile[0].catalog.assets).length, 13);
  assert.equal(
    Object.keys(result.mergedByProfile[0].catalog.templates).length,
    Object.keys(standardRdfRdfsInstanceFlowCatalog.templates).length + 13,
  );
});
