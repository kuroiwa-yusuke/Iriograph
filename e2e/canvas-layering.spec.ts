import { expect, test, type Locator, type Page } from "@playwright/test";

const PIZZA_NODE_COUNT = 25;
const PIZZA_EDGE_COUNT = 32;

test("endpoint変更後のpivot edgeもregionより前の可視pathからpointer再選択できる", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  await page.goto("/");
  await expect(page.locator(".document-heading")).toContainText("pizza-order-delivery");
  await expect(page.locator(".iriograph-scene-node")).toHaveCount(PIZZA_NODE_COUNT, {
    timeout: 120_000,
  });
  await expect(page.locator(".iriograph-edge-group")).toHaveCount(PIZZA_EDGE_COUNT);

  const original = pizzaEdge(page, "おなかがすいた", "ピザを選ぶ");
  await clickEdgeOnVisiblePath(page, original);
  const targetHandle = page.locator(".iriograph-endpoint-anchors.semantic circle.target");
  const nextTarget = page.locator(".iriograph-scene-node").filter({ hasText: "問い合わせる" });
  await dispatchPointerDrag(
    page,
    targetHandle,
    await requiredBox(targetHandle, "semantic target endpoint"),
    await requiredBox(nextTarget, "semantic target node"),
  );

  const changed = pizzaEdge(page, "おなかがすいた", "問い合わせる");
  await expect(changed).toHaveCount(1);
  await clickEdgeOnVisiblePath(page, changed);
  await expect(changed).toHaveClass(/selected/u);
  await expect(page.locator(".iriograph-inspector")).toContainText("次の工程");
  expect(consoleErrors).toEqual([]);
});

function pizzaEdge(page: Page, sourceLabel: string, targetLabel: string): Locator {
  return page.locator(
    `.iriograph-edge-group[aria-label*="${sourceLabel}から${targetLabel}への"]`,
  );
}

async function clickEdgeOnVisiblePath(page: Page, edge: Locator): Promise<void> {
  const point = await edge.evaluate((group) => {
    const path = group.querySelector<SVGPathElement>(".iriograph-edge-hitarea");
    if (!path) throw new Error("edge does not contain a hit path");
    const matrix = path.getScreenCTM();
    if (!matrix) throw new Error("edge hit path does not have a screen transform");
    const midpoint = path.getPointAtLength(path.getTotalLength() / 2).matrixTransform(matrix);
    return { x: midpoint.x, y: midpoint.y };
  });
  await page.mouse.click(point.x, point.y);
}

async function requiredBox(locator: Locator, label: string) {
  const box = await locator.boundingBox();
  if (!box) throw new Error(`${label} does not have a bounding box`);
  return box;
}

async function dispatchPointerDrag(
  page: Page,
  target: Locator,
  start: { x: number; y: number; width: number; height: number },
  destination: { x: number; y: number; width: number; height: number },
): Promise<void> {
  const from = { x: start.x + start.width / 2, y: start.y + start.height / 2 };
  const to = {
    x: destination.x + destination.width / 2,
    y: destination.y + destination.height / 2,
  };
  await target.dispatchEvent("pointerdown", { button: 0, clientX: from.x, clientY: from.y });
  await page.evaluate((point) => {
    window.dispatchEvent(new PointerEvent("pointermove", {
      bubbles: true,
      clientX: point.x,
      clientY: point.y,
    }));
    window.dispatchEvent(new PointerEvent("pointerup", {
      bubbles: true,
      clientX: point.x,
      clientY: point.y,
    }));
  }, to);
}
