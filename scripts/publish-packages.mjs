import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { promisify } from "node:util";
import {
  loadReleasePackages,
  verifyReleasePackageVersions,
} from "./package-release.mjs";

const execFileAsync = promisify(execFile);
const NOT_FOUND_PATTERN = /(?:\bE404\b|404\s+Not\s+Found)/i;

async function defaultRunNpm(args) {
  try {
    const result = await execFileAsync("npm", args, {
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    });
    return { code: 0, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
  } catch (error) {
    return {
      code: typeof error.code === "number" ? error.code : 1,
      stdout: typeof error.stdout === "string" ? error.stdout : "",
      stderr: typeof error.stderr === "string" ? error.stderr : "",
    };
  }
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

export function assertCodeArtifactRegistry(registry) {
  let parsed;
  try {
    parsed = new URL(registry);
  } catch {
    throw new Error("@iriograph:registry must be an absolute CodeArtifact URL");
  }
  if (
    parsed.protocol !== "https:"
    || !parsed.hostname.includes(".d.codeartifact.")
    || !parsed.hostname.endsWith(".amazonaws.com")
    || !parsed.pathname.includes("/npm/")
  ) {
    throw new Error("@iriograph:registry must point to an HTTPS AWS CodeArtifact npm repository");
  }
  return parsed.href;
}

export async function resolveScopedRegistry(runNpm = defaultRunNpm) {
  const result = await runNpm(["config", "get", "@iriograph:registry"]);
  if (result.code !== 0) {
    throw new Error("failed to read the authenticated @iriograph scope registry");
  }
  const registry = result.stdout.trim();
  if (!registry || registry === "undefined" || registry === "null") {
    throw new Error("@iriograph:registry is not configured; run CodeArtifact login and scope setup first");
  }
  return assertCodeArtifactRegistry(registry);
}

export async function registryHasExactVersion({ name, version, registry, runNpm }) {
  const result = await runNpm([
    "view",
    `${name}@${version}`,
    "version",
    "--registry",
    registry,
    "--json",
  ]);
  if (result.code !== 0) {
    if (NOT_FOUND_PATTERN.test(`${result.stdout}\n${result.stderr}`)) {
      return false;
    }
    throw new Error(`registry lookup failed for ${name}@${version}; refusing to publish`);
  }

  let publishedVersion;
  try {
    publishedVersion = JSON.parse(result.stdout);
  } catch {
    throw new Error(`registry returned an invalid version response for ${name}@${version}`);
  }
  if (publishedVersion !== version) {
    throw new Error(`registry returned unexpected version data for ${name}@${version}`);
  }
  return true;
}

async function waitForExactVersion({
  name,
  version,
  registry,
  runNpm,
  wait,
  attempts = 5,
}) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (await registryHasExactVersion({ name, version, registry, runNpm })) {
      return true;
    }
    if (attempt < attempts) {
      await wait(attempt * 250);
    }
  }
  return false;
}

export async function publishReleasePackages(options = {}) {
  const packages = options.packages ?? await loadReleasePackages();
  const version = verifyReleasePackageVersions(packages, options.requestedVersion);
  const runNpm = options.runNpm ?? defaultRunNpm;
  const wait = options.wait ?? delay;
  const logger = options.logger ?? console;
  const registry = options.registry
    ? assertCodeArtifactRegistry(options.registry)
    : await resolveScopedRegistry(runNpm);
  const results = [];

  for (const { manifest } of packages) {
    const name = manifest.name;
    if (await registryHasExactVersion({ name, version, registry, runNpm })) {
      logger.log(`skip ${name}@${version}: exact version already exists`);
      results.push({ name, version, status: "skipped" });
      continue;
    }

    logger.log(`publish ${name}@${version}`);
    const publishResult = await runNpm([
      "publish",
      "--workspace",
      name,
      "--registry",
      registry,
    ]);
    if (publishResult.code !== 0) {
      const appearedAfterFailure = await waitForExactVersion({
        name,
        version,
        registry,
        runNpm,
        wait,
      });
      if (appearedAfterFailure) {
        logger.log(`skip ${name}@${version}: exact version became available during publish`);
        results.push({ name, version, status: "skipped-after-race" });
        continue;
      }
      throw new Error(`publish failed for ${name}@${version}; exact version is still absent`);
    }

    const published = await waitForExactVersion({
      name,
      version,
      registry,
      runNpm,
      wait,
    });
    if (!published) {
      throw new Error(`publish completed but ${name}@${version} is not visible in the configured registry`);
    }
    logger.log(`published ${name}@${version}`);
    results.push({ name, version, status: "published" });
  }

  return { registry, version, results };
}

const isMain = process.argv[1]
  && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isMain) {
  await publishReleasePackages({
    requestedVersion: process.env.EXPECTED_PACKAGE_VERSION,
  });
}
