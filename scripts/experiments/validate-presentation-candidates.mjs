import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  DEFAULT_PRESENTATION_TOOL_POLICY,
  PRESENTATION_FIELDS,
  PresentationSceneBridge,
  validatePresentationCandidate,
} from "../../packages/presentation-tools/dist/index.js";

const root = resolve(import.meta.dirname, "../..");
const documents = ["pizza", "purchase", "architecture"];
const runs = ["medium-1", "high-1", "high-2"];
const kinds = ["node", "container", "region", "edge", "annotation"];
const contextRevision = "urn:iriograph:experiment:p2-09:presentation-context@1";
const capabilities = {
  contextRevision,
  fieldRules: PRESENTATION_FIELDS.flatMap((field) => {
    const elementKinds = kinds.filter((kind) => fieldAppliesToKind(field, kind));
    return elementKinds.length > 0 ? [{ field, elementKinds }] : [];
  }),
  routeModes: ["auto", "straight", "orthogonal", "curve", "manual"],
  markers: ["none", "arrow", "open-arrow", "triangle", "diamond", "circle"],
};

let rejected = 0;
for (const run of runs) {
  for (const document of documents) {
    const [scene, candidate] = await Promise.all([
      json(`.tmp/experiments/p2-09/baselines/${document}.scene.json`),
      json(`.tmp/experiments/p2-09/${run}/${document}.candidate.json`),
    ]);
    const bridge = new PresentationSceneBridge({ scene, binding: candidate.binding });
    const result = validatePresentationCandidate(
      candidate,
      bridge.index,
      capabilities,
      DEFAULT_PRESENTATION_TOOL_POLICY,
    );
    const summary = result.accepted
      ? { run, document, accepted: true, changes: result.changeCount, fields: result.fieldCount }
      : { run, document, accepted: false, diagnostics: result.diagnostics };
    console.log(JSON.stringify(summary));
    if (!result.accepted) rejected += 1;
  }
}
if (rejected > 0) process.exitCode = 1;

async function json(relativePath) {
  return JSON.parse(await readFile(resolve(root, relativePath), "utf8"));
}

function fieldAppliesToKind(field, kind) {
  if (field.startsWith("routing.") || field === "appearance.edgeCaption") return kind === "edge";
  if (field.startsWith("appearance.node")) return kind === "node";
  if (field.startsWith("appearance.group")) return kind === "container" || kind === "region";
  if (field.startsWith("appearance.region")) return kind === "region";
  if (field === "appearance.iconOptionId" || field === "appearance.labelPlacement") return kind !== "edge";
  if (field === "geometry" || field === "pinned" || field === "placement") return kind !== "edge";
  return true;
}
