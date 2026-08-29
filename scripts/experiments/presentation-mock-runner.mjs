import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  buildIriographView,
  catalogRef,
  createProjectionRuntimeContext,
  createStandardLayoutRegistry,
  parseIriographDocumentV1,
  standardRdfRdfsCatalog,
  standardRdfRdfsClassificationRegionCatalog,
  standardRdfRdfsInstanceFlowCatalog,
} from "../../packages/core/dist/index.js";
import {
  DEFAULT_PRESENTATION_TOOL_POLICY,
  PRESENTATION_FIELDS,
  PresentationSceneBridge,
  validatePresentationCandidate,
} from "../../packages/presentation-tools/dist/index.js";

const kinds = ["node", "container", "region", "edge", "annotation"];

/** The experiment runtime deliberately omits unregistered layout adapters. */
export function createExperimentRuntime() {
  return createProjectionRuntimeContext([
    standardRdfRdfsCatalog,
    standardRdfRdfsInstanceFlowCatalog,
    standardRdfRdfsClassificationRegionCatalog,
  ].map((catalog) => ({
    profileRef: catalog.profileRef,
    sourceCatalogRefs: [catalogRef(catalog)],
    catalog,
    ruleOrigins: [],
  })), createStandardLayoutRegistry());
}

export function presentationCapabilities(contextRevision) {
  return {
    contextRevision,
    fieldRules: PRESENTATION_FIELDS.flatMap((field) => {
      const elementKinds = kinds.filter((kind) => fieldAppliesToKind(field, kind));
      return elementKinds.length > 0 ? [{ field, elementKinds }] : [];
    }),
    routeModes: ["auto", "straight", "orthogonal", "curve", "manual"],
    markers: ["none", "arrow", "open-arrow", "triangle", "diamond", "circle"],
  };
}

/**
 * Projects a baseline portable document, validates its closed candidate against
 * the bridge snapshot, and writes a disposable overlay-only copy.  The input
 * document and its Turtle source are never written or normalized.
 */
export async function generateCandidateDocument({
  baselineDocumentPath,
  candidatePath,
  outputDocumentPath,
  sourceViewId,
  runtime = createExperimentRuntime(),
}) {
  const [baselineSource, candidate] = await Promise.all([
    readFile(baselineDocumentPath, "utf8"),
    readJson(candidatePath),
  ]);
  const baseline = parseIriographDocumentV1(JSON.parse(baselineSource));
  const sourceBefore = baseline.semantic.source;
  const sourceHashBefore = sha256(sourceBefore);
  const view = sourceViewId
    ? baseline.views.find((candidateView) => candidateView.viewId === sourceViewId)
    : baseline.views.length === 1 ? baseline.views[0] : undefined;
  if (!view) {
    throw new Error(sourceViewId
      ? `Baseline document view is unresolved: ${sourceViewId}`
      : "Baseline document has multiple views; pass sourceViewId explicitly.");
  }

  const scene = await buildIriographView(baseline, view.viewId, runtime, "initial");
  const errors = scene.diagnostics.filter((diagnostic) => diagnostic.severity === "error");
  if (errors.length > 0) {
    throw new Error(`Baseline projection has ${errors.length} error diagnostic(s): ${errors.map((item) => item.code).join(", ")}`);
  }
  const bridge = new PresentationSceneBridge({ scene, binding: candidate.binding });
  const validation = validatePresentationCandidate(
    candidate,
    bridge.index,
    presentationCapabilities(candidate.binding.contextRevision),
    DEFAULT_PRESENTATION_TOOL_POLICY,
  );
  if (!validation.accepted) {
    throw new Error(`Candidate validation failed: ${JSON.stringify(validation.diagnostics)}`);
  }
  const sourcePatch = bridge.toSourcePatch(validation);
  const generated = applySourcePatch(baseline, scene, sourcePatch);
  if (baseline.semantic.source !== sourceBefore || generated.semantic.source !== sourceBefore) {
    throw new Error("Refusing to write a generated document because semantic Turtle changed.");
  }
  parseIriographDocumentV1(generated);
  await mkdir(dirname(outputDocumentPath), { recursive: true });
  await writeFile(outputDocumentPath, `${JSON.stringify(generated, null, 2)}\n`, "utf8");
  return {
    outputDocumentPath,
    sourceViewId: sourcePatch.sourceViewId,
    semanticSourceHash: sourceHashBefore,
    semanticSourceUnchanged: true,
    changeCount: validation.changeCount,
    fieldCount: validation.fieldCount,
    projectionDiagnostics: scene.diagnostics,
  };
}

/** Uploads one generated document to the running Mock and records browser evidence. */
export async function uploadAndCaptureMock({ baseUrl, documentPath, outputDirectory }) {
  if (!baseUrl) throw new Error("baseUrl is required for Mock browser automation.");
  const { chromium } = await import("playwright");
  await mkdir(outputDirectory, { recursive: true });
  const screenshotPath = resolve(outputDirectory, "mock.png");
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
  const consoleErrors = [];
  const pageErrors = [];
  const failedRequests = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("requestfailed", (request) => {
    failedRequests.push(`${request.method()} ${request.url()}: ${request.failure()?.errorText ?? "failed"}`);
  });
  try {
    const response = await page.goto(baseUrl, { waitUntil: "networkidle" });
    if (!response?.ok()) throw new Error(`Mock did not respond successfully: ${response?.status() ?? "no response"}`);
    const input = page.locator('input[type="file"][accept*=".iriograph"]');
    await input.setInputFiles(documentPath);
    await page.locator(".iriograph-editor").waitFor({ state: "visible" });
    await page.locator(".iriograph-canvas-scroll").waitFor({ state: "visible" });
    await page.locator(".iriograph-canvas-scroll[aria-busy=\"false\"]").waitFor();
    await page.screenshot({ path: screenshotPath, fullPage: true });
    const documentTab = page.getByRole("button", { name: "Document", exact: true });
    if (await documentTab.count()) await documentTab.click();
    const diagnosticCodes = await page.locator(".iriograph-diagnostics code").allTextContents();
    const state = await page.evaluate(() => ({
      documentTitle: document.querySelector(".document-heading strong")?.textContent?.trim() ?? "",
      busy: document.querySelector(".iriograph-canvas-scroll")?.getAttribute("aria-busy") ?? "",
      validation: document.querySelector(".status-cluster .status-pill")?.textContent?.trim() ?? "",
      sceneStatus: document.querySelector(".iriograph-scene-status")?.textContent?.trim() ?? "",
      nodes: document.querySelectorAll(".iriograph-scene-node").length,
      edges: document.querySelectorAll(".iriograph-edge-group").length,
      regions: document.querySelectorAll(".iriograph-scene-region").length,
    }));
    return { screenshotPath, state, diagnosticCodes, consoleErrors, pageErrors, failedRequests };
  } finally {
    await browser.close();
  }
}

/** Records, but never repairs, the expected missing-layout outcomes for medium P2-12 inputs. */
export async function inspectUnregisteredMediumLayouts({ documentPaths, runtime = createExperimentRuntime() }) {
  const results = [];
  for (const documentPath of documentPaths) {
    const document = parseIriographDocumentV1(JSON.parse(await readFile(documentPath, "utf8")));
    const view = document.views[0];
    try {
      const scene = await buildIriographView(document, view.viewId, runtime, "initial");
      const errors = scene.diagnostics.filter((diagnostic) => diagnostic.severity === "error");
      results.push({
        documentPath,
        layoutRef: view.layoutRef,
        failed: errors.length > 0,
        diagnosticCodes: errors.map((diagnostic) => diagnostic.code),
      });
    } catch (error) {
      results.push({
        documentPath,
        layoutRef: view.layoutRef,
        failed: true,
        diagnosticCodes: [error instanceof Error ? error.message : String(error)],
      });
    }
  }
  return results;
}

export async function writeRunReport(outputPath, value) {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function applySourcePatch(document, scene, sourcePatch) {
  const next = structuredClone(document);
  const view = next.views.find((candidate) => candidate.viewId === sourcePatch.sourceViewId);
  if (!view) throw new Error(`Source view is unresolved: ${sourcePatch.sourceViewId}`);
  const sourceElements = new Map(collectSceneElements(scene).map((element) => [element.elementId, element]));
  for (const change of sourcePatch.changes) {
    const element = sourceElements.get(change.elementId);
    if (!element) throw new Error(`Source patch target is unresolved: ${change.elementId}`);
    const overlayKey = overlayKeyForSource(view.overlay, change.elementId, semanticRefForElement(element));
    const current = view.overlay[overlayKey] ?? { semanticRef: semanticRefForElement(element) };
    view.overlay[overlayKey] = mergeOverlay(current, change);
  }
  return next;
}

function mergeOverlay(current, change) {
  const next = structuredClone(current);
  for (const field of ["geometry", "pinned", "placement"]) {
    if (!(field in change)) continue;
    if (change[field] === null) delete next[field];
    else next[field] = structuredClone(change[field]);
  }
  for (const field of ["appearance", "routing"]) {
    if (!(field in change)) continue;
    if (field === "appearance") assertPortableAppearance(change.appearance);
    next[field] = mergeObject(next[field] ?? {}, change[field]);
  }
  return next;
}

function assertPortableAppearance(appearance) {
  for (const field of ["templateOptionId", "iconOptionId", "styleOptionId"]) {
    if (appearance?.[field] !== undefined && appearance[field] !== null) {
      throw new Error(`Candidate ${field} needs a Host option resolver before portable overlay serialization.`);
    }
  }
}

function mergeObject(current, patch) {
  const next = structuredClone(current);
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete next[key];
    else if (value && typeof value === "object" && !Array.isArray(value)) next[key] = mergeObject(next[key] ?? {}, value);
    else next[key] = structuredClone(value);
  }
  return next;
}

function overlayKeyForSource(overlay, sourceElementId, semanticRef) {
  if (overlay[sourceElementId]) return sourceElementId;
  const matching = Object.entries(overlay).find(([, entry]) => entry.semanticRef === semanticRef);
  return matching?.[0] ?? sourceElementId;
}

function semanticRefForElement(element) {
  const semanticRef = element.semanticRef ?? element.statementRef ?? element.annotationId;
  if (!semanticRef) throw new Error(`Source element has no portable semantic reference: ${element.elementId}`);
  return semanticRef;
}

function collectSceneElements(scene) {
  return [
    ...scene.nodes,
    ...scene.containers,
    ...(scene.regions ?? []),
    ...scene.edges,
    ...(scene.annotations ?? []),
  ];
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

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
