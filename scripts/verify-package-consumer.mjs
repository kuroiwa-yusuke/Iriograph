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
  const rdfIoTarball = await pack("packages/rdf-io", artifactsDirectory);
  const profileResolverTarball = await pack("packages/profile-resolver", artifactsDirectory);
  const semanticAccessTarball = await pack("packages/semantic-access", artifactsDirectory);
  const layoutElkTarball = await pack("packages/layout-elk", artifactsDirectory);
  const profileKitTarball = await pack("packages/profile-kit", artifactsDirectory);
  const presentationToolsTarball = await pack("packages/presentation-tools", artifactsDirectory);
  const hostConformanceTarball = await pack("packages/host-conformance", artifactsDirectory);
  const iconsAwsTarball = await pack("packages/icons-aws", artifactsDirectory);
  const agentBridgeTarball = await pack("packages/agent-bridge", artifactsDirectory);
  const editorTarball = await pack("packages/vue-editor", artifactsDirectory);

  runNpm([
    "install",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--package-lock=false",
    coreTarball,
    rdfIoTarball,
    profileResolverTarball,
    semanticAccessTarball,
    layoutElkTarball,
    profileKitTarball,
    presentationToolsTarball,
    hostConformanceTarball,
    iconsAwsTarball,
    agentBridgeTarball,
    editorTarball,
  ], consumerDirectory);

  await verifyInstalledContract(consumerDirectory);
  verifyNodeEsmImports(consumerDirectory);
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
  const rdfIoDirectory = join(consumer, "node_modules", "@iriograph", "rdf-io");
  const profileResolverDirectory = join(consumer, "node_modules", "@iriograph", "profile-resolver");
  const semanticAccessDirectory = join(consumer, "node_modules", "@iriograph", "semantic-access");
  const layoutElkDirectory = join(consumer, "node_modules", "@iriograph", "layout-elk");
  const profileKitDirectory = join(consumer, "node_modules", "@iriograph", "profile-kit");
  const presentationToolsDirectory = join(consumer, "node_modules", "@iriograph", "presentation-tools");
  const hostConformanceDirectory = join(consumer, "node_modules", "@iriograph", "host-conformance");
  const iconsAwsDirectory = join(consumer, "node_modules", "@iriograph", "icons-aws");
  const agentBridgeDirectory = join(consumer, "node_modules", "@iriograph", "agent-bridge");
  const editorDirectory = join(consumer, "node_modules", "@iriograph", "vue-editor");
  const [
    coreStat,
    rdfIoStat,
    profileResolverStat,
    semanticAccessStat,
    layoutElkStat,
    profileKitStat,
    presentationToolsStat,
    hostConformanceStat,
    iconsAwsStat,
    agentBridgeStat,
    editorStat,
    corePackage,
    rdfIoPackage,
    profileResolverPackage,
    semanticAccessPackage,
    layoutElkPackage,
    profileKitPackage,
    presentationToolsPackage,
    hostConformancePackage,
    iconsAwsPackage,
    agentBridgePackage,
    editorPackage,
  ] = await Promise.all([
    lstat(coreDirectory),
    lstat(rdfIoDirectory),
    lstat(profileResolverDirectory),
    lstat(semanticAccessDirectory),
    lstat(layoutElkDirectory),
    lstat(profileKitDirectory),
    lstat(presentationToolsDirectory),
    lstat(hostConformanceDirectory),
    lstat(iconsAwsDirectory),
    lstat(agentBridgeDirectory),
    lstat(editorDirectory),
    readJson(join(coreDirectory, "package.json")),
    readJson(join(rdfIoDirectory, "package.json")),
    readJson(join(profileResolverDirectory, "package.json")),
    readJson(join(semanticAccessDirectory, "package.json")),
    readJson(join(layoutElkDirectory, "package.json")),
    readJson(join(profileKitDirectory, "package.json")),
    readJson(join(presentationToolsDirectory, "package.json")),
    readJson(join(hostConformanceDirectory, "package.json")),
    readJson(join(iconsAwsDirectory, "package.json")),
    readJson(join(agentBridgeDirectory, "package.json")),
    readJson(join(editorDirectory, "package.json")),
  ]);

  if (
    coreStat.isSymbolicLink()
    || rdfIoStat.isSymbolicLink()
    || profileResolverStat.isSymbolicLink()
    || semanticAccessStat.isSymbolicLink()
    || layoutElkStat.isSymbolicLink()
    || profileKitStat.isSymbolicLink()
    || presentationToolsStat.isSymbolicLink()
    || hostConformanceStat.isSymbolicLink()
    || iconsAwsStat.isSymbolicLink()
    || agentBridgeStat.isSymbolicLink()
    || editorStat.isSymbolicLink()
  ) {
    throw new Error("consumer resolved a workspace symlink instead of packed packages");
  }
  if (
    rdfIoPackage.version !== corePackage.version
    || profileResolverPackage.version !== corePackage.version
    || semanticAccessPackage.version !== corePackage.version
    || layoutElkPackage.version !== corePackage.version
    || profileKitPackage.version !== corePackage.version
    || presentationToolsPackage.version !== corePackage.version
    || hostConformancePackage.version !== corePackage.version
    || iconsAwsPackage.version !== corePackage.version
    || agentBridgePackage.version !== corePackage.version
    || editorPackage.version !== corePackage.version
  ) {
    throw new Error("all @iriograph package versions must match");
  }
  if (semanticAccessPackage.dependencies?.["@iriograph/core"] !== corePackage.version) {
    throw new Error("@iriograph/semantic-access must depend on the exact packed core version");
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
  const iconExport = corePackage.exports?.["./icons/*"];
  if (iconExport !== "./assets/icons/*") {
    throw new Error("@iriograph/core bundled icon export is missing");
  }
  const noticeExport = corePackage.exports?.["./THIRD_PARTY_NOTICES.md"];
  if (noticeExport !== "./THIRD_PARTY_NOTICES.md") {
    throw new Error("@iriograph/core third-party notice export is missing");
  }
  await readFile(join(editorDirectory, cssExport), "utf8");
  const bundledCloudIcon = await readFile(join(coreDirectory, "assets", "icons", "cloud.svg"), "utf8");
  if (!bundledCloudIcon.includes("<svg")) {
    throw new Error("@iriograph/core bundled cloud icon is invalid");
  }
  const notices = await readFile(join(coreDirectory, noticeExport), "utf8");
  if (!notices.includes("Lucide") || !notices.includes("ISC License")) {
    throw new Error("@iriograph/core bundled icon notices are incomplete");
  }
  await readFile(join(coreDirectory, "dist", "index.d.ts"), "utf8");
  await readFile(join(rdfIoDirectory, "dist", "index.d.ts"), "utf8");
  await readFile(join(profileResolverDirectory, "dist", "index.d.ts"), "utf8");
  await readFile(join(semanticAccessDirectory, "dist", "index.d.ts"), "utf8");
  await readFile(join(layoutElkDirectory, "dist", "index.d.ts"), "utf8");
  await readFile(join(profileKitDirectory, "dist", "index.d.ts"), "utf8");
  await readFile(join(presentationToolsDirectory, "dist", "index.d.ts"), "utf8");
  await readFile(join(hostConformanceDirectory, "dist", "index.d.ts"), "utf8");
  await readFile(join(iconsAwsDirectory, iconsAwsPackage.types), "utf8");
  await readFile(join(agentBridgeDirectory, "dist", "index.d.ts"), "utf8");
  await readFile(join(editorDirectory, "dist", "types", "index.d.ts"), "utf8");
}

function verifyNodeEsmImports(cwd) {
  const program = [
    'const core = await import("@iriograph/core");',
    'const rdfIo = await import("@iriograph/rdf-io");',
    'const profiles = await import("@iriograph/profile-resolver");',
    'const semantic = await import("@iriograph/semantic-access");',
    'const layout = await import("@iriograph/layout-elk");',
    'const profileKit = await import("@iriograph/profile-kit");',
    'const presentation = await import("@iriograph/presentation-tools");',
    'const conformance = await import("@iriograph/host-conformance");',
    'const iconsAws = await import("@iriograph/icons-aws");',
    'const agent = await import("@iriograph/agent-bridge");',
    'if (!core.standardRdfRdfsCatalog) throw new Error("core Node ESM export is missing");',
    'if (!rdfIo.importRdfDataset) throw new Error("rdf-io Node ESM export is missing");',
    'if (!profiles.resolveAuthoringProfile) throw new Error("profile-resolver Node ESM export is missing");',
    'if (!semantic.SemanticAccessIndex) throw new Error("semantic-access Node ESM export is missing");',
    'if (!layout.ElkLayeredLayoutAdapter) throw new Error("layout-elk Node ESM export is missing");',
    'if (!profileKit.referenceWorkflowProfile) throw new Error("profile-kit Node ESM export is missing");',
    'if (!presentation.PresentationToolSession) throw new Error("presentation-tools Node ESM export is missing");',
    'if (!conformance.IRIOGRAPH_HOST_CONFORMANCE_MANIFEST) throw new Error("host-conformance Node ESM export is missing");',
    'if (!iconsAws.awsIconCatalogManifest) throw new Error("icons-aws Node ESM export is missing");',
    'if (!agent.SemanticJsonTransport) throw new Error("agent-bridge Node ESM export is missing");',
  ].join("\n");
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", program], {
    cwd,
    encoding: "utf8",
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`packed Node ESM import failed with exit code ${result.status}`);
  }
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
