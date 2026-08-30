import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  releasePackageNames,
  verifyReleasePackageVersions,
} from "./package-release.mjs";
import {
  assertNpmjsRegistry,
  NPMJS_REGISTRY,
  publishReleasePackages,
  summarizeNpmFailure,
} from "./publish-packages.mjs";

const registry = NPMJS_REGISTRY;
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

test("an exact version already on npmjs is skipped without overwrite", async () => {
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
  assert.equal(
    runner.calls
      .filter(([command]) => command === "publish")
      .every((args) => (
        args.includes("--access")
        && args[args.indexOf("--access") + 1] === "public"
        && args.includes("--provenance")
        && args[args.indexOf("--registry") + 1] === registry
      )),
    true,
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

test("a failed publish without the exact version becoming visible fails closed", async () => {
  const exactVersions = releasePackageNames
    .filter((name) => name !== "@iriograph/semantic-access")
    .map((name) => `${name}@${version}`);
  const runner = createRegistryRunner(exactVersions);
  const defaultRunNpm = runner.runNpm;
  runner.runNpm = async (args) => {
    if (args[0] === "publish") {
      runner.calls.push(args);
      return { code: 1, stdout: "", stderr: "npm error code E409" };
    }
    return defaultRunNpm(args);
  };

  await assert.rejects(
    publishReleasePackages({
      packages: createPackages(),
      registry,
      runNpm: runner.runNpm,
      wait: async () => {},
      logger: quietLogger,
    }),
    /exact version is still absent/,
  );
  assert.deepEqual(
    runner.calls.filter(([command]) => command === "publish").map((args) => args[2]),
    ["@iriograph/semantic-access"],
  );
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

test("publish diagnostics retain error codes while redacting credentials", () => {
  const summary = summarizeNpmFailure({
    code: 1,
    stdout: "",
    stderr: [
      "npm error code E403",
      "npm error authorization token super-secret-value",
      "npm error Trusted Publisher configuration did not match",
    ].join("\n"),
  });
  assert.match(summary, /E403/u);
  assert.match(summary, /Trusted Publisher configuration did not match/u);
  assert.match(summary, /REDACTED-SENSITIVE-LINE/u);
  assert.equal(summary.includes("super-secret-value"), false);
});

test("publishing permits only the canonical npmjs registry", () => {
  assert.equal(assertNpmjsRegistry("https://registry.npmjs.org"), registry);
  assert.equal(assertNpmjsRegistry(registry), registry);

  for (const candidate of [
    "http://registry.npmjs.org/",
    "https://registry.npmjs.org:444/",
    "https://registry.npmjs.org/scope/",
    "https://registry.npmjs.org/?write=true",
    "https://registry.npmjs.org/#publish",
    "https://user:password@registry.npmjs.org/",
    "https://registry.npmjs.org.example.com/",
    "https://npm.pkg.github.com/",
    "not-a-registry",
  ]) {
    assert.throws(() => assertNpmjsRegistry(candidate), /npmjs registry/);
  }
});

test("the default publisher never resolves or falls back to another configured registry", async () => {
  const runner = createRegistryRunner(
    releasePackageNames.map((name) => `${name}@${version}`),
  );

  const result = await publishReleasePackages({
    packages: createPackages(),
    runNpm: runner.runNpm,
    wait: async () => {},
    logger: quietLogger,
  });

  assert.equal(result.registry, registry);
  assert.equal(runner.calls.some(([command]) => command === "config"), false);
  assert.equal(
    runner.calls.every((args) => args[args.indexOf("--registry") + 1] === registry),
    true,
  );
});

test("the release workflow and audit vocabulary are npmjs-only", async () => {
  const [workflow, auditScript] = await Promise.all([
    readFile(new URL("../.github/workflows/packages.yml", import.meta.url), "utf8"),
    readFile(new URL("./write-package-publish-audit.sh", import.meta.url), "utf8"),
  ]);

  assert.match(workflow, /id-token:\s*write/u);
  assert.match(workflow, /NPM_CONFIG_USERCONFIG=/u);
  assert.match(workflow, /iriograph-publish\.npmrc/u);
  assert.match(workflow, /must not contain registry credentials/u);
  assert.doesNotMatch(workflow, /registry-url:/u);
  assert.match(workflow, /record_failure "npm-cli"/u);
  assert.match(workflow, /record_failure "npm-registry"/u);
  assert.match(workflow, /record_failure "npm-publish"/u);
  assert.match(auditScript, /npm-cli\|npm-registry\|npm-publish/u);
  assert.match(auditScript, /test-semantic-access\|test-extensions\|test-vue-editor/u);

  for (const forbidden of [
    /CodeArtifact/iu,
    /codeartifact-login/iu,
    /aws-auth/iu,
    /npm\.pkg\.github\.com/iu,
  ]) {
    assert.doesNotMatch(workflow, forbidden);
    assert.doesNotMatch(auditScript, forbidden);
  }
});
