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
export const NPMJS_REGISTRY = "https://registry.npmjs.org/";

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

export function summarizeNpmFailure(result) {
  const lines = `${result.stderr ?? ""}\n${result.stdout ?? ""}`
    .split(/\r?\n/u)
    .filter((line) => /(?:^npm\s+(?:error|ERR!|verbose\s+oidc)|\bE(?:401|403|404|409|NEEDAUTH)\b)/iu.test(line))
    .map((line) => {
      if (/^npm\s+verbose\s+oidc\s+/iu.test(line)) {
        return line
          .replace(/[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/gu, "[REDACTED-JWT]")
          .replace(/https?:\/\/[^/\s:@]+:[^@\s]+@/giu, "https://[REDACTED-CREDENTIAL]@")
          .slice(0, 600);
      }
      return /token|password|secret|credential|authorization|_authToken|private[_-]?key/iu.test(line)
        ? "[REDACTED-SENSITIVE-LINE]"
        : line.replace(/https?:\/\/[^/\s:@]+:[^@\s]+@/giu, "https://[REDACTED-CREDENTIAL]@");
    });
  const summary = lines.slice(-12).join("\n").slice(-1600);
  return summary || `npm exited with code ${Number.isInteger(result.code) ? result.code : 1}`;
}

export function assertNpmjsRegistry(registry) {
  let parsed;
  try {
    parsed = new URL(registry);
  } catch {
    throw new Error("package registry must be the absolute npmjs registry URL");
  }
  if (
    parsed.protocol !== "https:"
    || parsed.hostname !== "registry.npmjs.org"
    || parsed.port !== ""
    || parsed.username !== ""
    || parsed.password !== ""
    || parsed.pathname !== "/"
    || parsed.search !== ""
    || parsed.hash !== ""
  ) {
    throw new Error("package registry must point exactly to the npmjs registry https://registry.npmjs.org/");
  }
  return NPMJS_REGISTRY;
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
  attempts = 8,
}) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (await registryHasExactVersion({ name, version, registry, runNpm })) {
      return true;
    }
    if (attempt < attempts) {
      await wait(attempt * 500);
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
  const registry = assertNpmjsRegistry(options.registry ?? NPMJS_REGISTRY);
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
      "--access",
      "public",
      "--provenance",
      "--loglevel",
      "verbose",
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
      throw new Error([
        `publish failed for ${name}@${version}; exact version is still absent`,
        "sanitized npm diagnostic:",
        summarizeNpmFailure(publishResult),
      ].join("\n"));
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
