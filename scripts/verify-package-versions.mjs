import {
  loadReleasePackages,
  verifyReleasePackageVersions,
} from "./package-release.mjs";

const packages = await loadReleasePackages();
const expectedVersion = verifyReleasePackageVersions(
  packages,
  process.env.EXPECTED_PACKAGE_VERSION,
);

console.log(`Iriograph package versions verified: ${expectedVersion}`);
