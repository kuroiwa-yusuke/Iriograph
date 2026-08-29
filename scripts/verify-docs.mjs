import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const markdownFiles = (await collectMarkdownFiles()).sort();
const failures = [];

await verifyBilingualDocumentation();
await verifyPackageLicenseDocuments();

for (const relativeFile of markdownFiles) {
  const source = await readFile(path.join(repositoryRoot, relativeFile), "utf8");
  for (const match of source.matchAll(/\[[^\]]*\]\(([^)]+)\)/gu)) {
    const rawTarget = match[1]?.trim();
    if (!rawTarget || rawTarget.startsWith("#") || /^[a-z][a-z0-9+.-]*:/iu.test(rawTarget)) continue;
    const targetWithoutTitle = rawTarget.startsWith("<")
      ? rawTarget.slice(1, rawTarget.indexOf(">"))
      : rawTarget.split(/\s+/u, 1)[0];
    const decoded = decodeURIComponent(targetWithoutTitle.split("#", 1)[0]);
    if (!decoded) continue;
    const resolved = path.resolve(path.dirname(path.join(repositoryRoot, relativeFile)), decoded);
    if (!resolved.startsWith(`${repositoryRoot}${path.sep}`) && resolved !== repositoryRoot) {
      failures.push(`${relativeFile}: repository外へのlink: ${rawTarget}`);
      continue;
    }
    try {
      await access(resolved);
    } catch {
      failures.push(`${relativeFile}: 存在しないlink: ${rawTarget}`);
    }
  }

  for (const match of source.matchAll(/`((?:docs|packages|apps|scripts|fixtures)\/[^`\n]+)`/gu)) {
    const candidate = match[1];
    if (!candidate || /[*<>|]/u.test(candidate)) continue;
    try {
      await access(path.join(repositoryRoot, candidate));
    } catch {
      failures.push(`${relativeFile}: 存在しないbacktick path: ${candidate}`);
    }
  }

  if (relativeFile === "README.md" && source.includes("createEmptyIriographDocument")) {
    failures.push("README.md: 未提供の初期化helperを利用している");
  }

  if (relativeFile.startsWith("packages/") && relativeFile.endsWith("/README.md")) {
    for (const install of source.matchAll(/^npm install (.+)$/gmu)) {
      if (install[1]?.includes("@iriograph/") && !install[1].startsWith("--save-exact ")) {
        failures.push(`${relativeFile}: package install例は--save-exactが必要`);
      }
    }
  }
}

for (const [relativeFile, forbidden] of [
  ["README.md", /\b4 packages?\b|4 package/u],
  ["packages/layout-elk/README.md", /@iriograph\/[\w-]+@0\./u],
  ["packages/semantic-access/README.md", /@iriograph\/[\w-]+@0\./u],
]) {
  const source = await readFile(path.join(repositoryRoot, relativeFile), "utf8");
  if (forbidden.test(source)) failures.push(`${relativeFile}: stale package/version表記`);
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Documentation verification passed (${markdownFiles.length} Markdown files).`);
}

async function collectMarkdownFiles() {
  const ignored = new Set([".git", ".tmp", "dist", "node_modules", "test-results"]);
  const files = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (ignored.has(entry.name)) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile() && entry.name.endsWith(".md")) {
        files.push(path.relative(repositoryRoot, absolute));
      }
    }
  }
  await visit(repositoryRoot);
  return files;
}

async function verifyBilingualDocumentation() {
  const englishDocs = markdownFiles.filter((file) => file.startsWith("docs/") && file.endsWith(".md"));
  const japaneseDocs = new Set(markdownFiles.filter((file) => file.startsWith("docs_ja/") && file.endsWith(".md")));
  for (const english of englishDocs) {
    const japanese = english.replace(/^docs\//u, "docs_ja/");
    if (!japaneseDocs.has(japanese)) failures.push(`${english}: 対応する日本語文書 ${japanese} が必要`);
  }
  for (const japanese of japaneseDocs) {
    const english = japanese.replace(/^docs_ja\//u, "docs/");
    if (!englishDocs.includes(english)) failures.push(`${japanese}: 対応する英語正本文書 ${english} が必要`);
  }
  try {
    await access(path.join(repositoryRoot, "README_ja.md"));
  } catch {
    failures.push("README.md: README_ja.md が必要");
  }
}

async function verifyPackageLicenseDocuments() {
  const packageRoot = path.join(repositoryRoot, "packages");
  for (const entry of await readdir(packageRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const directory = path.join(packageRoot, entry.name);
    let manifest;
    try {
      manifest = JSON.parse(await readFile(path.join(directory, "package.json"), "utf8"));
    } catch {
      continue;
    }
    if (!String(manifest.name ?? "").startsWith("@iriograph/")) continue;
    if (manifest.license !== "MIT") failures.push(`${entry.name}/package.json: license はMITでなければならない`);
    for (const required of ["LICENSE", "README.md", "README_ja.md"]) {
      try {
        await access(path.join(directory, required));
      } catch {
        failures.push(`packages/${entry.name}: ${required} が必要`);
      }
    }
  }
}
