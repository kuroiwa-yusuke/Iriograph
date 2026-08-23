import { readFile } from "node:fs/promises";

const packagePaths = [
  "packages/core/package.json",
  "packages/semantic-access/package.json",
  "packages/layout-elk/package.json",
  "packages/vue-editor/package.json",
];
const packages = await Promise.all(packagePaths.map(async (path) => ({
  path,
  manifest: JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), "utf8")),
})));
const expectedVersion = packages[0].manifest.version;

for (const { path, manifest } of packages) {
  if (manifest.version !== expectedVersion) {
    throw new Error(`${path} must use lockstep version ${expectedVersion}, got ${manifest.version}`);
  }
  const coreVersion = manifest.dependencies?.["@iriograph/core"];
  if (manifest.name !== "@iriograph/core" && coreVersion !== expectedVersion) {
    throw new Error(`${path} must depend on exact @iriograph/core ${expectedVersion}`);
  }
}

const requestedVersion = process.env.EXPECTED_PACKAGE_VERSION;
if (requestedVersion && requestedVersion !== expectedVersion) {
  throw new Error(`release tag requests ${requestedVersion}, package version is ${expectedVersion}`);
}

console.log(`Iriograph package versions verified: ${expectedVersion}`);
