import assert from "node:assert/strict";
import test from "node:test";
import {
  releasePackageNames,
  verifyReleasePackageVersions,
} from "./package-release.mjs";
import {
  assertCodeArtifactRegistry,
  publishReleasePackages,
  resolveScopedRegistry,
} from "./publish-packages.mjs";

const registry = "https://example-111111111111.d.codeartifact.ap-northeast-1.amazonaws.com/npm/packages/";
const version = "0.6.0";
const quietLogger = { log() {} };

function createPackages(overrides = {}) {
  return releasePackageNames.map((name, index) => {
    const manifest = {
      name,
      version,
      ...(index === 0 ? {} : { dependencies: { "@iriograph/core": version } }),
      ...overrides[name],
    };
    return {
      path: `packages/${name.slice("@iriograph/".length)}/package.json`,
      expectedName: name,
      manifest,
    };
  });
}

function createRegistryRunner(initialVersions = []) {
  const available = new Set(initialVersions);
  const calls = [];

  return {
    available,
    calls,
    async runNpm(args) {
      calls.push(args);
      if (args[0] === "view") {
        const packageVersion = args[1];
        if (available.has(packageVersion)) {
          return { code: 0, stdout: JSON.stringify(version), stderr: "" };
        }
        return { code: 1, stdout: "", stderr: "npm error code E404" };
      }
      if (args[0] === "publish") {
        available.add(`${args[2]}@${version}`);
        return { code: 0, stdout: "", stderr: "" };
      }
      throw new Error(`unexpected npm command: ${args.join(" ")}`);
    },
  };
}

test("release package validation rejects dependency drift before registry access", () => {
  const packages = createPackages({
    "@iriograph/layout-elk": { dependencies: { "@iriograph/core": "0.5.0" } },
  });
  assert.throws(
    () => verifyReleasePackageVersions(packages, version),
    /must depend on exact @iriograph\/core 0\.6\.0/,
  );
});

test("an exact version already in CodeArtifact is skipped without overwrite", async () => {
  const exactVersions = releasePackageNames.map((name) => `${name}@${version}`);
  const runner = createRegistryRunner(exactVersions);

  const result = await publishReleasePackages({
    packages: createPackages(),
    registry,
    runNpm: runner.runNpm,
    wait: async () => {},
    logger: quietLogger,
  });

  assert.deepEqual(
    result.results.map(({ name, status }) => [name, status]),
    releasePackageNames.map((name) => [name, "skipped"]),
  );
  assert.equal(runner.calls.some(([command]) => command === "publish"), false);
  assert.deepEqual(
    runner.calls.map((args) => args[1]),
    exactVersions,
  );
  assert.equal(
    runner.calls.every((args) => args[args.indexOf("--registry") + 1] === registry),
    true,
  );
});

test("a partial release publishes only missing packages in dependency order", async () => {
  const runner = createRegistryRunner([
    `@iriograph/core@${version}`,
    `@iriograph/layout-elk@${version}`,
  ]);

  const result = await publishReleasePackages({
    packages: createPackages(),
    registry,
    runNpm: runner.runNpm,
    wait: async () => {},
    logger: quietLogger,
  });

  assert.deepEqual(
    result.results.map(({ name, status }) => [name, status]),
    releasePackageNames.map((name) => [
      name,
      name === "@iriograph/core" || name === "@iriograph/layout-elk" ? "skipped" : "published",
    ]),
  );
  assert.deepEqual(
    runner.calls
      .filter(([command]) => command === "publish")
      .map((args) => args[2]),
    releasePackageNames.filter((name) => name !== "@iriograph/core" && name !== "@iriograph/layout-elk"),
  );
});

test("a publish race is accepted only after the exact version becomes visible", async () => {
  const runner = createRegistryRunner([
    `@iriograph/core@${version}`,
    `@iriograph/layout-elk@${version}`,
    `@iriograph/vue-editor@${version}`,
  ]);
  const defaultRunNpm = runner.runNpm;
  runner.runNpm = async (args) => {
    if (args[0] === "publish" && args[2] === "@iriograph/semantic-access") {
      runner.calls.push(args);
      runner.available.add(`@iriograph/semantic-access@${version}`);
      return { code: 1, stdout: "", stderr: "npm error code E409" };
    }
    return defaultRunNpm(args);
  };

  const result = await publishReleasePackages({
    packages: createPackages(),
    registry,
    runNpm: runner.runNpm,
    wait: async () => {},
    logger: quietLogger,
  });

  assert.equal(
    result.results.find(({ name }) => name === "@iriograph/semantic-access")?.status,
    "skipped-after-race",
  );
  assert.deepEqual(result.results.map(({ name }) => name), releasePackageNames);
});

test("authentication and network failures fail closed without publishing or leaking details", async () => {
  const secret = "never-print-this-token";
  const calls = [];
  const runNpm = async (args) => {
    calls.push(args);
    return { code: 1, stdout: "", stderr: `npm error code E401 ${secret}` };
  };

  await assert.rejects(
    publishReleasePackages({
      packages: createPackages(),
      registry,
      runNpm,
      wait: async () => {},
      logger: quietLogger,
    }),
    (error) => {
      assert.match(error.message, /registry lookup failed/);
      assert.equal(error.message.includes(secret), false);
      return true;
    },
  );
  assert.equal(calls.some(([command]) => command === "publish"), false);
});

test("publishing refuses registries outside AWS CodeArtifact", () => {
  assert.throws(
    () => assertCodeArtifactRegistry("https://registry.npmjs.org/"),
    /AWS CodeArtifact/,
  );
});

test("the publisher resolves the authenticated @iriograph scope registry", async () => {
  const calls = [];
  const resolved = await resolveScopedRegistry(async (args) => {
    calls.push(args);
    return { code: 0, stdout: `${registry}\n`, stderr: "" };
  });

  assert.equal(resolved, registry);
  assert.deepEqual(calls, [["config", "get", "@iriograph:registry"]]);
});
