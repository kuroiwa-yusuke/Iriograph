import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

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

const root = resolve(import.meta.dirname, "../..");
const runIds = ["medium-1", "high-1", "high-2"];
const documentIds = ["pizza", "purchase", "architecture"];
const contextRevision = "urn:iriograph:experiment:p2-09:presentation-context@1";
const kinds = ["node", "container", "region", "edge", "annotation"];
const capabilities = {
  contextRevision,
  fieldRules: PRESENTATION_FIELDS.flatMap((field) => {
    const elementKinds = kinds.filter((kind) => fieldAppliesToKind(field, kind));
    return elementKinds.length > 0 ? [{ field, elementKinds }] : [];
  }),
  routeModes: ["auto", "straight", "orthogonal", "curve", "manual"],
  markers: ["none", "arrow", "open-arrow", "triangle", "diamond", "circle"],
};
const runtime = createProjectionRuntimeContext([
  standardRdfRdfsCatalog,
  standardRdfRdfsInstanceFlowCatalog,
  standardRdfRdfsClassificationRegionCatalog,
].map((catalog) => ({
  profileRef: catalog.profileRef,
  sourceCatalogRefs: [catalogRef(catalog)],
  catalog,
  ruleOrigins: [],
})), createStandardLayoutRegistry());

async function main() {
const result = {
  schema: "iriograph-reference-experiment-results/v1",
  scoring: {
    structure: "node-label F1 40 + group-label F1 20 + directed-relation F1 30 + membership F1 10",
    image: "normalized matched-element geometry 70 + group geometry 20 + expected palette similarity 10",
    note: "Image score is a deterministic landmark alignment metric, not a perceptual-model score.",
  },
  p2_12: [],
  p2_09: [],
};

const baselineScenes = new Map();
for (const documentId of documentIds) {
  baselineScenes.set(documentId, await json(`.tmp/experiments/p2-09/baselines/${documentId}.scene.json`));
}

for (const runId of runIds) {
  for (const documentId of documentIds) {
    const document = parseIriographDocumentV1(await json(`.tmp/experiments/p2-12/${runId}/${documentId}.iriograph`));
    const scene = await buildIriographView(document, document.views[0].viewId, runtime, "initial");
    const score = scoreScene(scene, references[documentId]);
    result.p2_12.push({
      runId,
      documentId,
      model: runId === "medium-1" ? "gpt-5.6-terra/medium" : "gpt-5.6-terra/high",
      schemaAccepted: true,
      errorDiagnostics: scene.diagnostics.filter((item) => item.severity === "error").length,
      warningDiagnostics: scene.diagnostics.filter((item) => item.severity === "warning").length,
      diagnosticCodes: scene.diagnostics.map((item) => item.code),
      counts: sceneCounts(scene),
      ...score,
    });
  }
}

for (const runId of runIds) {
  for (const documentId of documentIds) {
    const scene = baselineScenes.get(documentId);
    const candidate = await json(`.tmp/experiments/p2-09/${runId}/${documentId}.candidate.json`);
    const bridge = new PresentationSceneBridge({ scene, binding: candidate.binding });
    const validation = validatePresentationCandidate(candidate, bridge.index, capabilities, DEFAULT_PRESENTATION_TOOL_POLICY);
    if (!validation.accepted) throw new Error(JSON.stringify({ runId, documentId, diagnostics: validation.diagnostics }));
    const baselineSnapshot = bridge.index.snapshot();
    const candidateSnapshot = applyCandidate(baselineSnapshot, validation.patch.changes);
    const before = scoreSnapshot(baselineSnapshot, references[documentId]);
    const after = scoreSnapshot(candidateSnapshot, references[documentId]);
    result.p2_09.push({
      runId,
      documentId,
      model: runId === "medium-1" ? "gpt-5.6-terra/medium" : "gpt-5.6-terra/high",
      accepted: true,
      changeCount: validation.changeCount,
      fieldCount: validation.fieldCount,
      structureScore: after.structureScore,
      imageScoreBefore: before.imageScore,
      imageScoreAfter: after.imageScore,
      imageScoreDelta: round(after.imageScore - before.imageScore),
    });
  }
}

console.log(JSON.stringify(result, null, 2));
}

function sceneCounts(scene) {
  return {
    nodes: scene.nodes.length,
    groups: scene.containers.length + (scene.regions?.length ?? 0),
    edges: scene.edges.length,
    memberships: scene.memberships?.length ?? 0,
    annotations: scene.annotations?.length ?? 0,
  };
}

function scoreScene(scene, reference) {
  return scoreCommon({
    width: scene.width,
    height: scene.height,
    elements: [
      ...scene.nodes.map((value) => sourceElement("node", value)),
      ...scene.containers.map((value) => sourceElement("container", value)),
      ...(scene.regions ?? []).map((value) => sourceElement("region", value)),
      ...scene.edges.map((value) => sourceElement("edge", value)),
    ],
    memberships: (scene.memberships ?? []).map((value) => ({
      groupElementId: value.regionElementId ?? value.containerElementId,
      memberElementId: value.memberElementId,
    })),
  }, reference);
}

function sourceElement(kind, value) {
  return {
    elementId: value.elementId,
    kind,
    label: value.label,
    sourceElementId: value.sourceElementId,
    targetElementId: value.targetElementId,
    presentation: {
      geometry: value.geometry,
      appearance: { style: value.style },
      routing: kind === "edge" ? { routeMode: value.routeMode, waypoints: value.waypoints } : undefined,
    },
  };
}

function scoreSnapshot(snapshot, reference) {
  return scoreCommon(snapshot, reference);
}

function scoreCommon(snapshot, reference) {
  const nonEdges = snapshot.elements.filter((element) => element.kind !== "edge" && element.kind !== "annotation");
  const nodes = nonEdges.filter((element) => element.kind === "node");
  const groups = nonEdges.filter((element) => element.kind === "container" || element.kind === "region");
  const nodeMatches = matchElements(reference.nodes, nodes);
  const groupMatches = matchElements(reference.groups, groups);
  const expectedByActualId = new Map([
    ...nodeMatches.matches.map(({ expected, actual }) => [actual.elementId, expected.id]),
    ...groupMatches.matches.map(({ expected, actual }) => [actual.elementId, expected.id]),
  ]);
  const expectedRelations = new Set(reference.relations.map(([source, target]) => `${source}\0${target}`));
  const actualRelations = new Set(snapshot.elements
    .filter((element) => element.kind === "edge")
    .flatMap((edge) => {
      const source = expectedByActualId.get(edge.sourceElementId);
      const target = expectedByActualId.get(edge.targetElementId);
      return source && target ? [`${source}\0${target}`] : [`unmatched:${edge.elementId}`];
    }));
  const relationTrue = [...actualRelations].filter((key) => expectedRelations.has(key)).length;
  const relationF1 = f1(relationTrue, actualRelations.size, expectedRelations.size);
  const expectedMemberships = new Set(reference.memberships.map(([group, member]) => `${group}\0${member}`));
  const actualMemberships = new Set((snapshot.memberships ?? []).map((membership) => {
    const group = expectedByActualId.get(membership.groupElementId);
    const member = expectedByActualId.get(membership.memberElementId);
    return group && member ? `${group}\0${member}` : `unmatched:${membership.groupElementId}:${membership.memberElementId}`;
  }));
  const membershipTrue = [...actualMemberships].filter((key) => expectedMemberships.has(key)).length;
  const membershipF1 = f1(membershipTrue, actualMemberships.size, expectedMemberships.size);
  const structureScore = round(
    nodeMatches.f1 * 40
      + groupMatches.f1 * 20
      + relationF1 * 30
      + membershipF1 * 10,
  );
  const nodeGeometry = geometryScore(nodeMatches.matches, snapshot.width, snapshot.height);
  const groupGeometry = geometryScore(groupMatches.matches, snapshot.width, snapshot.height);
  const palette = paletteScore([...nodeMatches.matches, ...groupMatches.matches]);
  return {
    structureScore,
    imageScore: round(nodeGeometry * 70 + groupGeometry * 20 + palette * 10),
    dimensions: {
      nodeLabelF1: round(nodeMatches.f1 * 100),
      groupLabelF1: round(groupMatches.f1 * 100),
      directedRelationF1: round(relationF1 * 100),
      membershipF1: round(membershipF1 * 100),
      nodeGeometry: round(nodeGeometry * 100),
      groupGeometry: round(groupGeometry * 100),
      palette: round(palette * 100),
    },
  };
}

function matchElements(expectedElements, actualElements) {
  const unused = new Set(actualElements);
  const matches = [];
  for (const expected of expectedElements) {
    const actual = [...unused].find((candidate) => labelMatches(candidate.label, expected.aliases));
    if (!actual) continue;
    unused.delete(actual);
    matches.push({ expected, actual });
  }
  return { matches, f1: f1(matches.length, actualElements.length, expectedElements.length) };
}

function geometryScore(matches, width, height) {
  if (matches.length === 0) return 0;
  return matches.reduce((sum, { expected, actual }) => {
    const geometry = actual.presentation?.geometry;
    if (!geometry || !expected.geometry) return sum;
    const actualCenter = [(geometry.x + geometry.width / 2) / width, (geometry.y + geometry.height / 2) / height];
    const expectedCenter = [expected.geometry.x + expected.geometry.width / 2, expected.geometry.y + expected.geometry.height / 2];
    const distance = Math.hypot(actualCenter[0] - expectedCenter[0], actualCenter[1] - expectedCenter[1]);
    const position = Math.max(0, 1 - distance / 0.5);
    const actualSize = [geometry.width / width, geometry.height / height];
    const sizeError = (
      Math.abs(actualSize[0] - expected.geometry.width) / Math.max(expected.geometry.width, 0.02)
      + Math.abs(actualSize[1] - expected.geometry.height) / Math.max(expected.geometry.height, 0.02)
    ) / 2;
    const size = Math.max(0, 1 - sizeError);
    return sum + position * 0.75 + size * 0.25;
  }, 0) / matches.length;
}

function paletteScore(matches) {
  const colored = matches.filter(({ expected }) => expected.stroke || expected.fill);
  if (colored.length === 0) return matches.length === 0 ? 0 : 1;
  return colored.reduce((sum, { expected, actual }) => {
    const style = actual.presentation?.appearance?.style ?? {};
    const values = [];
    if (expected.stroke) values.push(colorSimilarity(style.stroke, expected.stroke));
    if (expected.fill) values.push(colorSimilarity(style.fill, expected.fill));
    return sum + values.reduce((total, value) => total + value, 0) / values.length;
  }, 0) / colored.length;
}

function colorSimilarity(actual, expected) {
  const left = rgb(actual);
  const right = rgb(expected);
  if (!left || !right) return 0;
  return Math.max(0, 1 - Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2]) / 441.7);
}

function rgb(value) {
  if (typeof value !== "string" || !/^#[0-9a-f]{6}$/iu.test(value)) return undefined;
  return [1, 3, 5].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16));
}

function labelMatches(actual, aliases) {
  const value = canonical(actual);
  return aliases.some((alias) => {
    const expected = canonical(alias);
    return value === expected || (Math.min(value.length, expected.length) >= 3 && (value.startsWith(expected) || expected.startsWith(value)));
  });
}

function canonical(value) {
  return String(value ?? "").normalize("NFKC").toLocaleLowerCase("ja")
    .replace(/[\s\n\r\t/／・()（）「」『』!?！？:：._-]+/gu, "");
}

function f1(truePositive, actual, expected) {
  if (actual === 0 || expected === 0 || truePositive === 0) return 0;
  const precision = truePositive / actual;
  const recall = truePositive / expected;
  return 2 * precision * recall / (precision + recall);
}

function applyCandidate(snapshot, changes) {
  const byId = new Map(changes.map((change) => [change.elementId, change]));
  return {
    ...structuredClone(snapshot),
    elements: snapshot.elements.map((element) => {
      const change = byId.get(element.elementId);
      if (!change) return structuredClone(element);
      return { ...structuredClone(element), presentation: mergePatch(element.presentation, change) };
    }),
  };
}

function mergePatch(current, patch) {
  const result = structuredClone(current);
  for (const key of ["geometry", "pinned", "placement"]) {
    if (!(key in patch)) continue;
    if (patch[key] === null) delete result[key];
    else result[key] = structuredClone(patch[key]);
  }
  for (const key of ["appearance", "routing"]) {
    if (!(key in patch)) continue;
    result[key] = mergeObject(result[key] ?? {}, patch[key]);
  }
  return result;
}

function mergeObject(current, patch) {
  const result = structuredClone(current);
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete result[key];
    else if (value && typeof value === "object" && !Array.isArray(value)) result[key] = mergeObject(result[key] ?? {}, value);
    else result[key] = structuredClone(value);
  }
  return result;
}

function round(value) {
  return Math.round(value * 100) / 100;
}

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

function e(id, aliases, x, y, width, height, style = {}) {
  return { id, aliases, geometry: { x, y, width, height }, ...style };
}

const references = {
  purchase: {
    nodes: [
      e("start", ["開始"], .075, .158, .05, .079, { fill: "#dbeafe" }),
      e("write", ["申請を書く"], .171, .138, .15, .118),
      e("attach", ["証憑を添付"], .396, .138, .15, .118),
      e("form", ["申請書"], .783, .113, .146, .113),
      e("review", ["内容を確認"], .171, .441, .15, .118),
      e("decision", ["承認できる"], .408, .428, .125, .145, { fill: "#fef3c7" }),
      e("reject", ["差戻し通知"], .613, .441, .15, .118),
      e("budget", ["予算を確認"], .396, .757, .15, .118),
      e("record", ["支払を登録", "支払いを登録"], .613, .757, .15, .118),
      e("done", ["完了"], .85, .776, .05, .079, { fill: "#dcfce7" }),
    ],
    groups: [
      e("applicant", ["申請者"], .033, .053, .933, .263, { stroke: "#3b82f6" }),
      e("manager", ["上長"], .033, .368, .933, .263, { stroke: "#22c55e" }),
      e("finance", ["経理"], .033, .684, .933, .263, { stroke: "#f97316" }),
    ],
    relations: [["start", "write"], ["write", "attach"], ["attach", "form"], ["attach", "review"], ["review", "decision"], ["decision", "reject"], ["reject", "write"], ["decision", "budget"], ["budget", "record"], ["record", "done"]],
    memberships: [["applicant", "start"], ["applicant", "write"], ["applicant", "attach"], ["applicant", "form"], ["manager", "review"], ["manager", "decision"], ["manager", "reject"], ["finance", "budget"], ["finance", "record"], ["finance", "done"]],
  },
  architecture: {
    nodes: [
      e("user", ["利用者", "利用者ブラウザ"], .093, .18, .08, .126),
      e("cdn", ["CDN/WAF"], .083, .401, .167, .118),
      e("api", ["WebAPI", "WebAPI認証REST"], .404, .191, .217, .125),
      e("worker", ["JobWorker", "JobWorker非同期処理"], .404, .414, .217, .125),
      e("queue", ["queue"], .638, .437, .05, .079),
      e("monitor", ["監視", "監視メトリクス通知"], .404, .678, .217, .125),
      e("db", ["ユーザーDB"], .767, .191, .158, .145),
      e("storage", ["ObjectStorage"], .767, .428, .158, .145),
      e("audit", ["監査ログ"], .767, .678, .158, .145),
    ],
    groups: [
      e("public", ["公開ネットワーク"], .038, .079, .258, .842, { stroke: "#6366f1" }),
      e("application", ["アプリケーション"], .329, .079, .375, .842, { stroke: "#0891b2" }),
      e("data", ["データ"], .738, .079, .225, .842, { stroke: "#16a34a" }),
    ],
    relations: [["user", "cdn"], ["cdn", "api"], ["api", "db"], ["worker", "queue"], ["queue", "storage"], ["worker", "monitor"], ["monitor", "audit"], ["storage", "db"], ["storage", "api"], ["audit", "queue"]],
    memberships: [["public", "user"], ["public", "cdn"], ["application", "api"], ["application", "worker"], ["application", "queue"], ["application", "monitor"], ["data", "db"], ["data", "storage"], ["data", "audit"]],
  },
  pizza: {
    nodes: [
      e("hungry", ["おなかがすいた"], .108, .093, .045, .054),
      e("choose", ["ピザを選ぶ"], .176, .095, .109, .052),
      e("order", ["ピザを注文する"], .176, .182, .109, .052),
      e("customerGateway", ["注文後イベント", "注文後イベントを待つ"], .295, .095, .055, .055),
      e("timer", ["60分", "60分待つ"], .342, .181, .045, .055),
      e("inquire", ["問い合わせる"], .407, .181, .107, .055),
      e("receive", ["ピザを受け取る"], .55, .094, .068, .055),
      e("pay", ["代金を払う"], .625, .094, .108, .055),
      e("eat", ["ピザを食べる"], .79, .094, .109, .055),
      e("full", ["空腹が満たされた"], .824, .214, .045, .055),
      e("accept", ["注文を受ける"], .198, .401, .055, .055),
      e("staffGateway", ["注文後処理", "並行分岐", "分岐"], .269, .405, .045, .055),
      e("question", ["わたしのピザはどこ", "問い合わせを受ける"], .319, .398, .055, .055),
      e("complaint", ["顧客クレーム", "問い合わせに回答する"], .406, .406, .105, .055),
      e("bake", ["ピザを焼く"], .303, .619, .108, .055),
      e("deliver", ["配達", "ピザを配達する"], .461, .827, .109, .055),
      e("collect", ["代金を受け取る"], .625, .827, .109, .055),
      e("complete", ["Ordercompleted", "注文完了"], .824, .827, .045, .055),
      e("orderResource", ["注文"], .198, .347, .055, .045),
      e("inquiryResource", ["問い合わせ内容"], .486, .619, .055, .045),
      e("pizzaResource", ["ピザ"], .496, .637, .045, .045),
      e("priceResource", ["料金"], .625, .637, .045, .045),
      e("receiptResource", ["領収書"], .695, .45, .045, .045),
    ],
    groups: [
      e("customer", ["顧客"], .046, .03, .915, .28, { stroke: "#ff6278" }),
      e("store", ["ピザ店"], .046, .344, .915, .623, { stroke: "#ffb21a" }),
      e("staff", ["店員"], .086, .344, .875, .21, { stroke: "#2496e8" }),
      e("kitchen", ["調理担当"], .086, .555, .875, .21, { stroke: "#2496e8" }),
      e("deliveryGroup", ["配達担当"], .086, .766, .875, .21, { stroke: "#2496e8" }),
    ],
    relations: [["hungry", "choose"], ["choose", "order"], ["order", "customerGateway"], ["customerGateway", "receive"], ["customerGateway", "timer"], ["timer", "inquire"], ["inquire", "customerGateway"], ["receive", "pay"], ["pay", "eat"], ["eat", "full"], ["order", "orderResource"], ["orderResource", "accept"], ["accept", "staffGateway"], ["staffGateway", "question"], ["question", "complaint"], ["staffGateway", "bake"], ["bake", "deliver"], ["deliver", "collect"], ["collect", "complete"], ["complaint", "inquiryResource"], ["inquiryResource", "inquire"], ["deliver", "pizzaResource"], ["pizzaResource", "receive"], ["collect", "priceResource"], ["priceResource", "pay"], ["receiptResource", "collect"]],
    memberships: [["customer", "hungry"], ["customer", "choose"], ["customer", "order"], ["customer", "customerGateway"], ["customer", "timer"], ["customer", "inquire"], ["customer", "receive"], ["customer", "pay"], ["customer", "eat"], ["customer", "full"], ["store", "staff"], ["store", "kitchen"], ["store", "deliveryGroup"], ["staff", "accept"], ["staff", "staffGateway"], ["staff", "question"], ["staff", "complaint"], ["kitchen", "bake"], ["deliveryGroup", "deliver"], ["deliveryGroup", "collect"], ["deliveryGroup", "complete"]],
  },
};

await main();
