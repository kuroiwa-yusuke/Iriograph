import { readFile } from "node:fs/promises";

export const releasePackagePaths = Object.freeze([
  "packages/core/package.json",
  "packages/rdf-io/package.json",
  "packages/profile-resolver/package.json",
  "packages/semantic-access/package.json",
  "packages/layout-elk/package.json",
  "packages/profile-kit/package.json",
  "packages/presentation-tools/package.json",
  "packages/host-conformance/package.json",
  "packages/icons-aws/package.json",
  "packages/agent-bridge/package.json",
  "packages/vue-editor/package.json",
]);

export const releasePackageNames = Object.freeze([
  "@iriograph/core",
  "@iriograph/rdf-io",
  "@iriograph/profile-resolver",
  "@iriograph/semantic-access",
  "@iriograph/layout-elk",
  "@iriograph/profile-kit",
  "@iriograph/presentation-tools",
  "@iriograph/host-conformance",
  "@iriograph/icons-aws",
  "@iriograph/agent-bridge",
  "@iriograph/vue-editor",
]);

export async function loadReleasePackages(options = {}) {
  const read = options.readFile ?? readFile;
  const repositoryRoot = options.repositoryRoot ?? new URL("../", import.meta.url);

  return Promise.all(releasePackagePaths.map(async (path, index) => ({
    path,
    directory: path.replace(/\/package\.json$/, ""),
    expectedName: releasePackageNames[index],
    manifest: JSON.parse(await read(new URL(path, repositoryRoot), "utf8")),
  })));
}

export function verifyReleasePackageVersions(packages, requestedVersion) {
  if (packages.length !== releasePackageNames.length) {
    throw new Error(`expected ${releasePackageNames.length} release packages, got ${packages.length}`);
  }

  const expectedVersion = packages[0]?.manifest.version;
  if (!expectedVersion) {
    throw new Error("@iriograph/core package version is missing");
  }

  for (const [index, packageEntry] of packages.entries()) {
    const { path, expectedName, manifest } = packageEntry;
    const requiredName = releasePackageNames[index];
    if (expectedName !== requiredName || manifest.name !== requiredName) {
      throw new Error(`${path} must be release package ${requiredName}, got ${manifest.name ?? "<missing>"}`);
    }
    if (manifest.version !== expectedVersion) {
      throw new Error(`${path} must use lockstep version ${expectedVersion}, got ${manifest.version}`);
    }
    for (const [dependencyName, dependencyVersion] of Object.entries(manifest.dependencies ?? {})) {
      if (releasePackageNames.includes(dependencyName) && dependencyVersion !== expectedVersion) {
        throw new Error(`${path} must depend on exact ${dependencyName} ${expectedVersion}`);
      }
    }
  }

  if (requestedVersion && requestedVersion !== expectedVersion) {
    throw new Error(`release requests ${requestedVersion}, package version is ${expectedVersion}`);
  }

  return expectedVersion;
}
