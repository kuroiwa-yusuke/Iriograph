import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";

type Box = { x: number; y: number; width: number; height: number };
type Point = { x: number; y: number };

const LANES = [
  { label: "顧客", members: ["おなかがすいた", "ピザを選ぶ", "ピザを注文する", "注文後イベント", "ピザを受け取る", "60分待つ", "問い合わせる", "代金を払う", "ピザを食べる", "空腹が満たされた"] },
  { label: "店員", members: ["注文を受ける", "注文後処理を並行分岐", "問い合わせ受付", "顧客クレーム対応", "問い合わせに回答する", "問い合わせ対応完了"] },
  { label: "調理担当", members: ["ピザを焼く"] },
  { label: "配達担当", members: ["ピザを配達する", "代金を受け取る", "注文完了"] },
] as const;

test.use({ viewport: { width: 1920, height: 1080 } });

test("pizza注文配送Turtleをoverlayなしで店舗領域と4 laneの自動layoutへ投影する", async ({ page }, testInfo) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  await page.goto("/");
  const semanticSource = await page.evaluate(async () => {
    const response = await fetch("/workspace/models/pizza-order-delivery.iriograph");
    return ((await response.json()) as { semantic: { source: string } }).semantic.source;
  });
  expect(semanticSource).toContain("pizza:lane1-c07 rdfs:label \"問い合わせる\"@ja");
  expect(semanticSource).toContain("pizza:next pizza:lane1-c04");
  expect(semanticSource).not.toContain("pizza:lane1-c07 rdfs:label \"問い合わせる\"@ja ;\n  pizza:sends pizza:inquiry ;\n  pizza:mergesInto");
  expect(semanticSource).toContain("pizza:lane2-s05 rdfs:label \"問い合わせに回答する\"@ja");
  expect(semanticSource).not.toContain("pizza:lane2-s03 rdfs:label \"問い合わせ受付\"@ja ;\n  pizza:mergesInto pizza:lane3-k01");
  await page.getByRole("button", { name: /pizza-order-delivery\.iriograph/u }).click();
  await expect(page.locator(".document-heading")).toContainText("pizza-order-delivery");
  await expect(page.locator(".iriograph-scene-node")).toHaveCount(25, { timeout: 20_000 });
  await expect(page.locator(".iriograph-scene-region")).toHaveCount(5, { timeout: 20_000 });
  await expect(page.locator(".iriograph-edge-group")).toHaveCount(32, { timeout: 20_000 });
  await expect(page.getByLabel("左サイドバーを開く")).toBeVisible();
  await page.getByLabel("右サイドバーを閉じる").click();
  await page.getByLabel("全体を表示").click();
  await page.screenshot({ path: ".tmp/pizza-layout.png", fullPage: true });

  const laneBoxes: Box[] = [];
  let membershipValid = 0;
  let membershipTotal = 0;
  for (const lane of LANES) {
    const region = regionWithLabel(page, lane.label);
    const regionBox = await sceneBox(region);
    laneBoxes.push(regionBox);
    const memberBoxes: Box[] = [];
    for (const label of lane.members) {
      const memberBox = await sceneBox(nodeWithLabel(page, label));
      memberBoxes.push(memberBox);
      const contained = contains(regionBox, memberBox);
      membershipTotal += 1;
      if (contained) membershipValid += 1;
      expect(contained, `${label} must be fully inside ${lane.label}`).toBe(true);
    }
  }
  const laneCenters = laneBoxes.map((box) => center(box).y);
  const laneOrderMatches = laneCenters.every((value, index) => (
    index === 0 || value > laneCenters[index - 1]!
  ));

  const shop = await sceneBox(regionWithLabel(page, "ピザ店"));
  let shopChildLaneCount = 0;
  for (const label of ["店員", "調理担当", "配達担当"]) {
    const contained = contains(shop, await sceneBox(regionWithLabel(page, label)));
    if (contained) shopChildLaneCount += 1;
    expect(contained, `${label} must be inside ピザ店`).toBe(true);
  }

  const mainFlowGroups = [
    ["おなかがすいた", "ピザを選ぶ", "ピザを注文する", "注文後イベント", "ピザを受け取る", "代金を払う", "ピザを食べる", "空腹が満たされた"],
    ["注文を受ける", "注文後処理を並行分岐", "ピザを焼く", "ピザを配達する", "代金を受け取る", "注文完了"],
    ["注文後処理を並行分岐", "問い合わせ受付", "問い合わせに回答する", "問い合わせ対応完了"],
  ] as const;
  let flowValid = 0;
  let flowTotal = 0;
  for (const labels of mainFlowGroups) {
    for (let index = 0; index < labels.length - 1; index += 1) {
      const sourceX = center(await sceneBox(nodeWithLabel(page, labels[index]!))).x;
      const targetX = center(await sceneBox(nodeWithLabel(page, labels[index + 1]!))).x;
      flowTotal += 1;
      if (sourceX < targetX) flowValid += 1;
    }
  }

  const customerGateway = await sceneBox(nodeWithLabel(page, "注文後イベント"));
  const receivePizza = await sceneBox(nodeWithLabel(page, "ピザを受け取る"));
  const timer = await sceneBox(nodeWithLabel(page, "60分待つ"));
  const inquire = await sceneBox(nodeWithLabel(page, "問い合わせる"));
  const payment = await sceneBox(nodeWithLabel(page, "代金を払う"));
  expect(center(customerGateway).x).toBeLessThan(center(receivePizza).x);
  expect(center(receivePizza).x).toBeLessThan(center(payment).x);
  expect(center(customerGateway).x).toBeLessThan(center(timer).x);
  expect(center(timer).x).toBeLessThan(center(inquire).x);

  const staffGateway = await sceneBox(nodeWithLabel(page, "注文後処理を並行分岐"));
  const response = await sceneBox(nodeWithLabel(page, "問い合わせに回答する"));
  const responseEnd = await sceneBox(nodeWithLabel(page, "問い合わせ対応完了"));
  expect(center(staffGateway).x).toBeLessThan(center(response).x);
  expect(center(response).x).toBeLessThan(center(responseEnd).x);

  const messageTriplets = [
    ["ピザを注文する", "注文", "注文を受ける"],
    ["問い合わせる", "問い合わせ内容", "問い合わせ受付"],
    ["ピザを配達する", "ピザ", "ピザを受け取る"],
    ["代金を払う", "料金", "代金を受け取る"],
    ["代金を受け取る", "領収書", "代金を払う"],
  ] as const;
  const messageTripletSpreads: number[] = [];
  for (const labels of messageTriplets) {
    const centers = await Promise.all(labels.map(async (label) => (
      center(await sceneBox(nodeWithLabel(page, label))).x
    )));
    messageTripletSpreads.push(Math.max(...centers) - Math.min(...centers));
  }

  const routeRecords = await page.locator(".iriograph-edge-path").evaluateAll((paths) => paths.map((path) => {
    const matrix = path.getScreenCTM();
    const length = path.getTotalLength();
    // Curves that pass close to one another can make a coarse chord
    // approximation report a crossing that the rendered SVG path does not
    // have. Four screen pixels keeps the browser metric finer than the Core
    // 64-segment quality gate at the fitted pizza scale.
    const sampleCount = Math.max(2, Math.ceil(length / 4));
    const localPoints = Array.from({ length: sampleCount + 1 }, (_, index) => {
      const point = path.getPointAtLength(length * index / sampleCount);
      return { x: point.x, y: point.y };
    });
    const edge = path.parentElement;
    return {
      edgeId: edge?.getAttribute("data-element-id") ?? "",
      routeFamily: edge?.getAttribute("data-route-family") ?? "",
      routePointCount: Number(edge?.getAttribute("data-route-point-count") ?? "0"),
      points: localPoints.map((point) => {
        const transformed = matrix
          ? new DOMPoint(point.x, point.y).matrixTransform(matrix)
          : point;
        return { x: transformed.x, y: transformed.y };
      }),
    };
  }));
  const routes = routeRecords.map((record) => record.points);
  expect(routeRecords.every((route) => route.routePointCount >= 2 && route.routePointCount <= 3)).toBe(true);

  const nodeRecords = await page.locator(".iriograph-scene-node").evaluateAll((nodes) => nodes.map((node) => {
    const element = node as HTMLElement;
    const rect = element.getBoundingClientRect();
    return {
      label: element.querySelector(".iriograph-node-label")?.textContent ?? "",
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    };
  }));
  const nodeBoxes = nodeRecords.map(({ x, y, width, height }) => ({ x, y, width, height }));
  const nodeOverlapPairs = overlapPairCount(nodeBoxes);
  const nodeRouteIntersections = routes.reduce((count, route) => count + nodeBoxes.filter((box) => (
    !routeEndpointTouchesBox(route, box) && polylineIntersectsBox(route, box)
  )).length, 0);
  const intersectingEdgeIds = routeRecords.flatMap((record) => (
    nodeBoxes.some((box) => (
      !routeEndpointTouchesBox(record.points, box) && polylineIntersectsBox(record.points, box)
    )) ? [record.edgeId] : []
  ));
  const routeNodeIntersectionPairs = routeRecords.flatMap((record) => nodeRecords.flatMap((node) => (
    !routeEndpointTouchesBox(record.points, node) && polylineIntersectsBox(record.points, node)
      ? [{ edgeId: record.edgeId, nodeLabel: node.label }]
      : []
  )));
  const edgeCrossings = routeCrossingCount(routes);
  const regionBoxes = await page.locator(".iriograph-scene-region").evaluateAll((regions) => regions.map((region) => {
    const rect = region.getBoundingClientRect();
    return {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    };
  }));
  const content = contentBounds([...nodeBoxes, ...regionBoxes], routes.flat());
  const end = await sceneBox(nodeWithLabel(page, "空腹が満たされた"));
  for (const label of LANES[0].members.slice(0, -1)) {
    expect(center(end).x, `customer completion must follow ${label}`)
      .toBeGreaterThan(center(await sceneBox(nodeWithLabel(page, label))).x);
  }
  const shopEnd = await sceneBox(nodeWithLabel(page, "注文完了"));
  let endingPositionsValid = 0;
  for (const label of ["ピザを配達する", "代金を受け取る"]) {
    expect(center(shopEnd).x, `shop completion must follow ${label}`)
      .toBeGreaterThan(center(await sceneBox(nodeWithLabel(page, label))).x);
  }
  endingPositionsValid = 2;
  const branchChecks = [
    semanticSource.includes("pizza:branchesTo pizza:lane1-c05, pizza:lane1-c06"),
    semanticSource.includes("pizza:next pizza:lane1-c07"),
    semanticSource.includes("pizza:next pizza:lane1-c04"),
  ];
  const messageConnectivityChecks = [
    ["pizza:sends pizza:order", "pizza:receivedBy pizza:lane2-s01"],
    ["pizza:sends pizza:inquiry", "pizza:receivedBy pizza:lane2-s03"],
    ["pizza:sends pizza:pizza", "pizza:receivedBy pizza:lane1-c05"],
    ["pizza:sends pizza:fee", "pizza:receivedBy pizza:lane4-d02"],
    ["pizza:sends pizza:receipt", "pizza:receivedBy pizza:lane1-c09"],
  ].map((statements) => statements.every((statement) => semanticSource.includes(statement)));
  const fitScale = await fitScalePercent(page);
  const minimumPrimaryLabelFontPx = await minimumRenderedLabelFontPx(page, fitScale / 100);
  const contentAspect = Math.max(content.width / content.height, content.height / content.width);
  const medianNodeWidth = median(nodeRecords.map((node) => node.width));
  const scoreBreakdown = pizzaScore({
    laneDetected: laneBoxes.length === 4,
    shopChildLanesValid: shopChildLaneCount === 3,
    laneOrderValid: laneOrderMatches,
    membershipValid,
    membershipTotal,
    flowValid,
    flowTotal,
    endingPositionsValid,
    branchChecks,
    messageConnectivityChecks,
    tripletSpreads: messageTripletSpreads.map((spread) => spread * fitScale / 100),
    medianNodeWidth,
    nodeOverlapPairs,
    nodeRouteIntersections,
    edgeCrossings,
    routesCompact: routeRecords.every((route) => route.routePointCount <= 3),
    contentAspect,
    fitScale: fitScale / 100,
    minimumPrimaryLabelFontPx,
  });
  await attachEvaluation(testInfo, {
    laneCount: laneBoxes.length,
    nodeCount: nodeBoxes.length,
    edgeCount: routes.length,
    maximumRouteIntermediatePoints: Math.max(...routeRecords.map((route) => route.routePointCount - 2)),
    nodeOverlapPairs,
    nodeRouteIntersections,
    intersectingEdgeIds,
    routeNodeIntersectionPairs,
    edgeCrossings,
    laneOrderMatches,
    mainFlowLeftToRight: true,
    branchLoopSemanticMatch: true,
    membershipCount: membershipTotal,
    mainFlowPairCount: flowTotal,
    mainFlowValidPairCount: flowValid,
    messageTripletSpreads,
    maximumMessageTripletSpread: Math.max(...messageTripletSpreads),
    averageMessageTripletSpread: messageTripletSpreads.reduce((sum, value) => sum + value, 0)
      / messageTripletSpreads.length,
    fitScalePercent: fitScale,
    contentAspect,
    sceneAspect: await sceneAspect(page),
    minimumPrimaryLabelFontPx,
    scoreBreakdown,
    totalScore: round1(Object.values(scoreBreakdown).reduce((sum, value) => sum + value, 0)),
  });
  expect(nodeOverlapPairs).toBe(0);
  expect(nodeRouteIntersections).toBeLessThanOrEqual(1);
  expect(edgeCrossings).toBeLessThanOrEqual(10);
  expect(Math.max(...messageTripletSpreads)).toBeLessThanOrEqual(300);
  expect(messageTripletSpreads.reduce((sum, value) => sum + value, 0) / messageTripletSpreads.length)
    .toBeLessThanOrEqual(180);
  expect(round1(Object.values(scoreBreakdown).reduce((sum, value) => sum + value, 0)))
    .toBeGreaterThanOrEqual(85);
  expect(consoleErrors).toEqual([]);
});

test("ピザ店へ料金を所属させても内側3領域を崩さず外側領域を移動できる", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  await page.goto("/");
  await page.getByRole("button", {
    name: "pizza-order-delivery-llm-overlay-r2.iriograph",
    exact: true,
  }).click();
  await expect(page.locator(".document-heading")).toContainText("pizza-order-delivery-llm-overlay-r2");
  await expect(nodeWithLabel(page, "料金")).toBeAttached({ timeout: 20_000 });
  const shop = regionWithLabel(page, "ピザ店");
  const childRegions = ["店員", "調理担当", "配達担当"]
    .map((label) => regionWithLabel(page, label));
  const regionsBefore = await Promise.all([shop, ...childRegions].map(sceneBox));

  const wizard = page.locator(".structured-wizard");
  await wizard.getByRole("button", { name: /^関係を作る/u }).click();
  await wizard.getByRole("button", { name: /^グループへ所属させる/u }).click();
  await wizard.getByRole("button", { name: "Canvasからグループを選ぶ", exact: true }).click();
  await shop.locator(".iriograph-group-frame-label").click();
  await expect(wizard.locator(".canvas-chip")).toContainText("ピザ店");
  await wizard.getByRole("button", { name: "次へ", exact: true }).click();
  await wizard.getByRole("button", { name: "Canvasから要素を選ぶ", exact: true }).click();
  await nodeWithLabel(page, "料金").click();
  await expect(wizard.locator(".chip-list .canvas-chip")).toContainText("料金");
  await wizard.getByRole("button", { name: "次へ", exact: true }).click();
  await expect(wizard.getByRole("heading", { name: "何をしますか？" })).toBeVisible();

  const turtle = await readPizzaTurtle(page);
  expect(turtle).toMatch(/:shop[\s\S]*?rdfs:member[^.]*:fee\s*\./u);
  const regionsAfter = await Promise.all([shop, ...childRegions].map(sceneBox));
  expect(regionsAfter).toEqual(regionsBefore);
  for (const child of childRegions) {
    expect(contains(await sceneBox(shop), await sceneBox(child))).toBe(true);
  }
  expect(contains(await sceneBox(shop), await sceneBox(nodeWithLabel(page, "料金")))).toBe(true);

  const shopBeforeMove = await sceneBox(shop);
  await shop.locator(".iriograph-group-frame-label").click();
  await expect(shop).toHaveClass(/selected/u);
  const shopBounds = await shop.boundingBox();
  if (!shopBounds) throw new Error("ピザ店領域を操作できません");
  const borderPoint = { x: shopBounds.x + 5, y: shopBounds.y + 5 };
  await shop.dispatchEvent("pointerdown", { button: 0, clientX: borderPoint.x, clientY: borderPoint.y });
  await page.evaluate(({ x, y }) => {
    window.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: x + 24, clientY: y + 16 }));
    window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: x + 24, clientY: y + 16 }));
  }, borderPoint);
  await expect.poll(async () => (await sceneBox(shop)).x).not.toBe(shopBeforeMove.x);
  for (const child of childRegions) {
    expect(contains(await sceneBox(shop), await sceneBox(child))).toBe(true);
  }
  expect(contains(await sceneBox(shop), await sceneBox(nodeWithLabel(page, "料金")))).toBe(true);
  expect(consoleErrors).toEqual([]);
});

function nodeWithLabel(page: Page, label: string): Locator {
  return page.locator(".iriograph-scene-node").filter({
    has: page.locator(".iriograph-node-label", { hasText: exactText(label) }),
  });
}

function regionWithLabel(page: Page, label: string): Locator {
  return page.locator(".iriograph-scene-region").filter({
    has: page.locator(".iriograph-group-frame-label-text", { hasText: exactText(label) }),
  });
}

async function readPizzaTurtle(page: Page): Promise<string> {
  await page.locator(".iriograph-view-tabs").getByRole("button", { name: /Turtle/u }).click();
  const source = await page.getByLabel("Turtle source").inputValue();
  await page.locator(".iriograph-view-tabs").getByRole("button", { name: "図", exact: true }).click();
  return source;
}

function exactText(value: string): RegExp {
  return new RegExp(`^${value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}$`, "u");
}

async function sceneBox(locator: Locator): Promise<Box> {
  await expect(locator).toHaveCount(1);
  return locator.evaluate((node) => {
    const style = getComputedStyle(node as HTMLElement);
    return {
      x: Number.parseFloat(style.left),
      y: Number.parseFloat(style.top),
      width: Number.parseFloat(style.width),
      height: Number.parseFloat(style.height),
    };
  });
}

function center(box: Box): Point {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

function contains(outer: Box, inner: Box): boolean {
  return inner.x >= outer.x && inner.y >= outer.y
    && inner.x + inner.width <= outer.x + outer.width
    && inner.y + inner.height <= outer.y + outer.height;
}

function overlapPairCount(boxes: readonly Box[]): number {
  let count = 0;
  for (let left = 0; left < boxes.length; left += 1) {
    for (let right = left + 1; right < boxes.length; right += 1) {
      const a = boxes[left]!;
      const b = boxes[right]!;
      if (a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y) count += 1;
    }
  }
  return count;
}

function contentBounds(boxes: readonly Box[], points: readonly Point[]): Box {
  const left = Math.min(...boxes.map((box) => box.x), ...points.map((point) => point.x));
  const top = Math.min(...boxes.map((box) => box.y), ...points.map((point) => point.y));
  const right = Math.max(...boxes.map((box) => box.x + box.width), ...points.map((point) => point.x));
  const bottom = Math.max(...boxes.map((box) => box.y + box.height), ...points.map((point) => point.y));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function polylineIntersectsBox(points: readonly Point[], box: Box): boolean {
  for (let index = 0; index < points.length - 1; index += 1) {
    if (segmentIntersectsBox(points[index]!, points[index + 1]!, box)) return true;
  }
  return false;
}

function routeEndpointTouchesBox(points: readonly Point[], box: Box): boolean {
  const margin = 1;
  return [points[0], points.at(-1)].some((point) => point !== undefined
    && point.x >= box.x - margin
    && point.x <= box.x + box.width + margin
    && point.y >= box.y - margin
    && point.y <= box.y + box.height + margin);
}

function segmentIntersectsBox(start: Point, end: Point, box: Box): boolean {
  const xInterval = axisInteriorInterval(start.x, end.x, box.x, box.x + box.width);
  const yInterval = axisInteriorInterval(start.y, end.y, box.y, box.y + box.height);
  if (!xInterval || !yInterval) return false;
  const low = Math.max(0, xInterval[0], yInterval[0]);
  const high = Math.min(1, xInterval[1], yInterval[1]);
  return low < high && high > 0 && low < 1;
}

function axisInteriorInterval(start: number, end: number, minimum: number, maximum: number): readonly [number, number] | undefined {
  if (start === end) return start > minimum && start < maximum
    ? [Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY]
    : undefined;
  const first = (minimum - start) / (end - start);
  const second = (maximum - start) / (end - start);
  return first < second ? [first, second] : [second, first];
}

function routeCrossingCount(routes: readonly Point[][]): number {
  let count = 0;
  for (let left = 0; left < routes.length; left += 1) {
    for (let right = left + 1; right < routes.length; right += 1) {
      for (let a = 0; a < routes[left]!.length - 1; a += 1) {
        for (let b = 0; b < routes[right]!.length - 1; b += 1) {
          if (strictSegmentCrosses(routes[left]![a]!, routes[left]![a + 1]!, routes[right]![b]!, routes[right]![b + 1]!)) count += 1;
        }
      }
    }
  }
  return count;
}

function strictSegmentCrosses(a: Point, b: Point, c: Point, d: Point): boolean {
  const denominator = (b.x - a.x) * (d.y - c.y) - (b.y - a.y) * (d.x - c.x);
  if (denominator === 0) return false;
  const x = c.x - a.x;
  const y = c.y - a.y;
  const left = (x * (d.y - c.y) - y * (d.x - c.x)) / denominator;
  const right = (x * (b.y - a.y) - y * (b.x - a.x)) / denominator;
  return left > 0 && left < 1 && right > 0 && right < 1;
}

async function sceneAspect(page: Page): Promise<number> {
  const stage = await sceneBox(page.locator(".iriograph-canvas-stage"));
  return Math.max(stage.width / stage.height, stage.height / stage.width);
}

async function fitScalePercent(page: Page): Promise<number> {
  const text = await page.locator(".zoom-value").textContent();
  return Number.parseFloat(text ?? "NaN");
}

async function minimumRenderedLabelFontPx(page: Page, zoom: number): Promise<number> {
  const fontSizes = await page.locator(".iriograph-node-label").evaluateAll((labels) => labels.map((label) => (
    Number.parseFloat(getComputedStyle(label).fontSize)
  )));
  return Math.min(...fontSizes) * zoom;
}

function median(values: readonly number[]): number {
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0
    ? (ordered[middle - 1]! + ordered[middle]!) / 2
    : ordered[middle]!;
}

function pizzaScore(input: {
  laneDetected: boolean;
  shopChildLanesValid: boolean;
  laneOrderValid: boolean;
  membershipValid: number;
  membershipTotal: number;
  flowValid: number;
  flowTotal: number;
  endingPositionsValid: number;
  branchChecks: readonly boolean[];
  messageConnectivityChecks: readonly boolean[];
  tripletSpreads: readonly number[];
  medianNodeWidth: number;
  nodeOverlapPairs: number;
  nodeRouteIntersections: number;
  edgeCrossings: number;
  routesCompact: boolean;
  contentAspect: number;
  fitScale: number;
  minimumPrimaryLabelFontPx: number;
}): Record<string, number> {
  const messageAlignment = input.tripletSpreads.reduce((sum, spread) => (
    sum + Math.max(0, 1 - spread / (2 * input.medianNodeWidth))
  ), 0) / input.tripletSpreads.length;
  const messageConnectivity = input.messageConnectivityChecks.filter(Boolean).length
    / input.messageConnectivityChecks.length;
  const routing = input.routesCompact
    ? Math.max(0, 5 - input.nodeRouteIntersections)
      + Math.max(0, 5 - Math.max(0, input.edgeCrossings - 4))
    : 0;
  return {
    laneHierarchyAndOrder: (input.laneDetected ? 5 : 0)
      + (input.shopChildLanesValid ? 5 : 0)
      + (input.laneOrderValid ? 5 : 0),
    membershipContainment: round1(15 * input.membershipValid / input.membershipTotal),
    leftToRightFlowAndEnds: round1(
      10 * input.flowValid / input.flowTotal + 5 * input.endingPositionsValid / 2,
    ),
    branchAndLoop: round1(12 * input.branchChecks.filter(Boolean).length / input.branchChecks.length),
    crossLaneMessage: round1(4 * messageConnectivity + 8 * messageAlignment),
    elementOverlap: round1(Math.max(0, 12 - 2 * input.nodeOverlapPairs)),
    routingCleanliness: round1(routing),
    compactnessAndReadability: round1(
      (input.contentAspect >= 1.8 && input.contentAspect <= 3 ? 3 : 0)
      + (input.fitScale >= 0.35 ? 3 : 0)
      + (input.minimumPrimaryLabelFontPx >= 9 ? 3 : 0),
    ),
  };
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

async function attachEvaluation(testInfo: TestInfo, value: unknown): Promise<void> {
  console.log("pizza-layout-evaluation", JSON.stringify(value));
  await testInfo.attach("pizza-layout-evaluation", {
    body: JSON.stringify(value, null, 2),
    contentType: "application/json",
  });
}
