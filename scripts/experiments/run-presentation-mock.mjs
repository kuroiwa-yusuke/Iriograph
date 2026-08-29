import { basename, resolve } from "node:path";

import {
  generateCandidateDocument,
  inspectUnregisteredMediumLayouts,
  uploadAndCaptureMock,
  writeRunReport,
} from "./presentation-mock-runner.mjs";

const root = resolve(import.meta.dirname, "../..");
const args = parseArgs(process.argv.slice(2));
const documentId = required(args.document, "--document");
const runId = args.run ?? "high-2";
const outputDirectory = resolve(root, args.outputDir ?? `.tmp/experiments/mock-runs/${runId}/${documentId}`);
const baselineDocumentPath = resolve(root, args.baselineDocument
  ?? `.tmp/experiments/p2-12/high-1/${documentId}.iriograph`);
const candidatePath = resolve(root, args.candidate
  ?? `.tmp/experiments/p2-09/${runId}/${documentId}.candidate.json`);
const outputDocumentPath = resolve(outputDirectory, `${documentId}.applied.iriograph`);

const generated = await generateCandidateDocument({
  baselineDocumentPath,
  candidatePath,
  outputDocumentPath,
  sourceViewId: args.sourceView,
});
const browser = args.baseUrl
  ? await uploadAndCaptureMock({ baseUrl: args.baseUrl, documentPath: outputDocumentPath, outputDirectory })
  : { skipped: true, reason: "Pass --base-url=http://127.0.0.1:5173 to upload to Mock and capture Chromium evidence." };
const mediumLayouts = args.checkMediumLayout
  ? await inspectUnregisteredMediumLayouts({
    documentPaths: ["pizza", "purchase", "architecture"].map((name) => (
      resolve(root, `.tmp/experiments/p2-12/medium-1/${name}.iriograph`)
    )),
  })
  : [];
const report = {
  schema: "iriograph-presentation-mock-run/v1",
  documentId,
  runId,
  baselineDocument: basename(baselineDocumentPath),
  candidate: basename(candidatePath),
  generated,
  browser,
  mediumLayouts,
};
await writeRunReport(resolve(outputDirectory, "report.json"), report);
console.log(JSON.stringify(report, null, 2));

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith("--")) throw new Error(`Unexpected argument: ${value}`);
    const [key, inline] = value.slice(2).split("=", 2);
    if (key === "check-medium-layout") {
      parsed.checkMediumLayout = true;
      continue;
    }
    parsed[toCamel(key)] = inline ?? values[++index];
  }
  return parsed;
}

function required(value, flag) {
  if (!value) throw new Error(`${flag} is required.`);
  return value;
}

function toCamel(value) {
  return value.replace(/-([a-z])/gu, (_, letter) => letter.toUpperCase());
}
