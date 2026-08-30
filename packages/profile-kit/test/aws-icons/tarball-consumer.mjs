import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const packageRoot = fileURLToPath(new URL("../..", import.meta.url));
const corePackageRoot = fileURLToPath(new URL("../../../core", import.meta.url));
const consumerRoot = await mkdtemp(join(tmpdir(), "iriograph-profile-kit-aws-icons-consumer-"));

try {
  const profileKitPack = run("npm", ["pack", "--json", "--pack-destination", consumerRoot], packageRoot);
  const packJson = parseTrailingJsonArray(profileKitPack.stdout);
  assert.equal(packJson.length, 1);
  const packed = packJson[0];
  const tarballPath = join(consumerRoot, packed.filename);
  const corePack = run("npm", ["pack", "--json", "--pack-destination", consumerRoot], corePackageRoot);
  const coreTarballPath = join(consumerRoot, parseTrailingJsonArray(corePack.stdout)[0].filename);
  const paths = new Set(packed.files.map((file) => file.path));

  for (const required of [
    "aws-icons/index.js",
    "aws-icons/index.d.ts",
    "aws-icons/catalog.manifest.json",
    "aws-icons/NOTICE.md",
    "README.md",
    "package.json",
  ]) {
    assert.equal(paths.has(required), true, required);
  }
  assert.equal([...paths].some((path) => path.startsWith("assets/")), false);
  assert.equal([...paths].some((path) => /\.(?:svg|zip|tar|tgz|png|jpe?g|webp)$/iu.test(path)), false);
  assert.equal([...paths].some((path) => path.startsWith("test/")), false);
  assert.equal([...paths].some((path) => path.endsWith("package-lock.json")), false);

  run("npm", [
    "install",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    coreTarballPath,
    tarballPath,
  ], consumerRoot);

  const consumerSource = `
    import assert from "node:assert/strict";
    import {
      AWS_ICON_ASSET_NAMESPACE,
      AWS_ICON_CATALOG_REF,
      AWS_ICON_PACKAGE_VERSION,
      awsIconEntries,
      createAwsIconAssetResolver,
      createAwsIconCatalogResolver,
      resolveAwsServiceAlias,
    } from "@iriograph/profile-kit/aws-icons";
    import manifest from "@iriograph/profile-kit/aws-icons/catalog.manifest.json" with { type: "json" };

    assert.equal(AWS_ICON_PACKAGE_VERSION, "0.12.2");
    assert.equal(manifest.catalogId + "@" + manifest.catalogVersion, AWS_ICON_CATALOG_REF);
    assert.equal(awsIconEntries.length, 13);
    const catalogRaw = await createAwsIconCatalogResolver().resolveCatalog(AWS_ICON_CATALOG_REF);
    assert.equal(JSON.parse(catalogRaw).catalogVersion, "2026-q3");
    assert.equal(resolveAwsServiceAlias("SQS").entry.slug, "amazon-sqs");

    const entry = awsIconEntries.find((candidate) => candidate.assetRef === AWS_ICON_ASSET_NAMESPACE + "service:amazon-ec2");
    const unconfigured = await createAwsIconAssetResolver().resolve({ assetRef: entry.assetRef });
    assert.equal(unconfigured.status, "unresolved");
    assert.equal(unconfigured.diagnostic.code, "aws-icon-assets-not-installed");
    assert.equal(unconfigured.fallback.text, "EC2");

    const local = createAwsIconAssetResolver({
      delivery: "local",
      localAssets: { [entry.assetRef]: "/user-owned/aws/ec2.svg" },
      localPathProvider(expected) {
        return {
          url: "file:///user-owned/aws/ec2.svg",
          verifiedSha256: expected.sha256,
          byteLength: expected.byteLength,
          mediaType: expected.mediaType,
          svgViewBox: expected.svgViewBox,
        };
      },
    });
    assert.equal((await local.resolve({ assetRef: entry.assetRef })).status, "resolved");
  `;
  const consumerFile = join(consumerRoot, "consumer.mjs");
  await writeFile(consumerFile, consumerSource, "utf8");
  run("node", [consumerFile], consumerRoot);

  const installedRoot = join(consumerRoot, "node_modules", "@iriograph", "profile-kit");
  for (const path of paths) {
    const bytes = await readFile(join(installedRoot, path));
    const text = bytes.toString("utf8");
    assert.doesNotMatch(
      text,
      /(?:^|\n)\s*(?:<\?xml[^>]*>\s*)?<svg(?:\s|>)/iu,
      `tarball contains an SVG document in ${path}`,
    );
    assert.equal(bytes.indexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04])), -1, `tarball contains ZIP bytes in ${path}`);
  }

  const installedPackage = JSON.parse(await readFile(join(installedRoot, "package.json"), "utf8"));
  assert.equal(installedPackage.version, "0.12.2");
  assert.equal(Object.hasOwn(installedPackage, "private"), false);
  assert.equal(installedPackage.publishConfig.access, "public");
  assert.equal(dirname(fileURLToPath(import.meta.url)), join(packageRoot, "test", "aws-icons"));
} finally {
  await rm(consumerRoot, { recursive: true, force: true });
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
  });
  if (result.status !== 0) {
    throw new Error([
      `${command} ${args.join(" ")} failed with status ${result.status}`,
      result.stdout,
      result.stderr,
    ].join("\n"));
  }
  return result;
}

function parseTrailingJsonArray(text) {
  const start = text.lastIndexOf("\n[");
  const candidate = (start >= 0 ? text.slice(start + 1) : text).trim();
  return JSON.parse(candidate);
}
