import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  generateCandidateDocument,
  presentationCapabilities,
} from "./presentation-mock-runner.mjs";

test("presentation capability envelope exposes only fields valid for each kind", () => {
  const capabilities = presentationCapabilities("context-1");
  const fieldsForEdge = new Set(capabilities.fieldRules
    .filter((rule) => rule.elementKinds.includes("edge"))
    .map((rule) => rule.field));
  const fieldsForNode = new Set(capabilities.fieldRules
    .filter((rule) => rule.elementKinds.includes("node"))
    .map((rule) => rule.field));
  assert.equal(fieldsForEdge.has("geometry"), false);
  assert.equal(fieldsForEdge.has("routing.routeMode"), true);
  assert.equal(fieldsForNode.has("geometry"), true);
  assert.equal(fieldsForNode.has("routing.routeMode"), false);
});

test("P2-09 candidate creates an overlay-only disposable P2-12 document", async (t) => {
  const root = resolve(import.meta.dirname, "../..");
  const baselineDocumentPath = resolve(root, ".tmp/experiments/p2-12/high-1/pizza.iriograph");
  const candidatePath = resolve(root, ".tmp/experiments/p2-09/high-2/pizza.candidate.json");
  if (!await exists(baselineDocumentPath) || !await exists(candidatePath)) {
    t.skip("P2 experiment inputs are intentionally external to the repository checkout.");
    return;
  }
  const outputDirectory = await mkdtemp(join(tmpdir(), "iriograph-presentation-mock-"));
  const outputDocumentPath = join(outputDirectory, "pizza.applied.iriograph");
  const before = JSON.parse(await readFile(baselineDocumentPath, "utf8"));
  const result = await generateCandidateDocument({ baselineDocumentPath, candidatePath, outputDocumentPath });
  const generated = JSON.parse(await readFile(outputDocumentPath, "utf8"));
  assert.equal(result.semanticSourceUnchanged, true);
  assert.equal(generated.semantic.source, before.semantic.source);
  assert.equal(generated.views[0].overlay.s04.geometry.y, 164);
  assert.equal(generated.views[0].overlay.s04.semanticRef, before.views[0].overlay.s04.semanticRef);
});

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
