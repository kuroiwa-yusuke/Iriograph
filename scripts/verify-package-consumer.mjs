import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixtureSource = join(repositoryRoot, "fixtures", "package-consumer");
const temporaryRoot = await mkdtemp(join(tmpdir(), "iriograph-package-consumer-"));
const artifactsDirectory = join(temporaryRoot, "artifacts");
const consumerDirectory = join(temporaryRoot, "consumer");

try {
  await mkdir(artifactsDirectory);
  await cp(fixtureSource, consumerDirectory, { recursive: true });

  const coreTarball = await pack("packages/core", artifactsDirectory);
  const layoutElkTarball = await pack("packages/layout-elk", artifactsDirectory);
  const editorTarball = await pack("packages/vue-editor", artifactsDirectory);

  runNpm([
    "install",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--package-lock=false",
    coreTarball,
    layoutElkTarball,
    editorTarball,
  ], consumerDirectory);

  await verifyInstalledContract(consumerDirectory);
  runNpm(["run", "typecheck"], consumerDirectory);
  runNpm(["run", "build"], consumerDirectory);

  process.stdout.write("Packed package consumer verification succeeded.\n");
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

async function pack(packageDirectory, destination) {
  const result = runNpm([
    "pack",
    join(repositoryRoot, packageDirectory),
    "--ignore-scripts",
    "--json",
    "--pack-destination",
    destination,
  ], repositoryRoot, true);
  const report = JSON.parse(result.stdout);
  const filename = report[0]?.filename;
  if (typeof filename !== "string" || !filename.endsWith(".tgz")) {
    throw new Error(`npm pack did not return a tarball for ${packageDirectory}`);
  }
  return join(destination, filename);
}

async function verifyInstalledContract(consumer) {
  const coreDirectory = join(consumer, "node_modules", "@iriograph", "core");
  const layoutElkDirectory = join(consumer, "node_modules", "@iriograph", "layout-elk");
  const editorDirectory = join(consumer, "node_modules", "@iriograph", "vue-editor");
  const [coreStat, layoutElkStat, editorStat, corePackage, layoutElkPackage, editorPackage] = await Promise.all([
    lstat(coreDirectory),
    lstat(layoutElkDirectory),
    lstat(editorDirectory),
    readJson(join(coreDirectory, "package.json")),
    readJson(join(layoutElkDirectory, "package.json")),
    readJson(join(editorDirectory, "package.json")),
  ]);

  if (coreStat.isSymbolicLink() || layoutElkStat.isSymbolicLink() || editorStat.isSymbolicLink()) {
    throw new Error("consumer resolved a workspace symlink instead of packed packages");
  }
  if (layoutElkPackage.version !== corePackage.version || editorPackage.version !== corePackage.version) {
    throw new Error("all @iriograph package versions must match");
  }
  if (layoutElkPackage.dependencies?.["@iriograph/core"] !== corePackage.version) {
    throw new Error("@iriograph/layout-elk must depend on the exact packed core version");
  }
  if (typeof layoutElkPackage.dependencies?.elkjs !== "string") {
    throw new Error("@iriograph/layout-elk must declare elkjs as a runtime dependency");
  }
  if (editorPackage.dependencies?.["@iriograph/core"] !== corePackage.version) {
    throw new Error("@iriograph/vue-editor must depend on the exact packed core version");
  }
  if (typeof editorPackage.peerDependencies?.vue !== "string") {
    throw new Error("Vue must be declared as a peer dependency");
  }
  if (editorPackage.dependencies?.vue !== undefined) {
    throw new Error("Vue must not be installed as a runtime dependency");
  }
  const cssExport = editorPackage.exports?.["./styles.css"]?.default;
  if (typeof cssExport !== "string") {
    throw new Error("@iriograph/vue-editor/styles.css export is missing");
  }
  await readFile(join(editorDirectory, cssExport), "utf8");
  await readFile(join(coreDirectory, "dist", "index.d.ts"), "utf8");
  await readFile(join(layoutElkDirectory, "dist", "index.d.ts"), "utf8");
  await readFile(join(editorDirectory, "dist", "types", "index.d.ts"), "utf8");
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function runNpm(args, cwd, capture = false) {
  const command = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      npm_config_update_notifier: "false",
    },
    stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`npm ${args.join(" ")} failed with exit code ${result.status}`);
  }
  return { stdout: result.stdout ?? "" };
}
