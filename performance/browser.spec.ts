import { expect, test, type Page } from "@playwright/test";

const FRAME_BUDGET_MS = 1_000 / 30;

test("normal 500/1,000 scene keeps pan and drag frame p95 at 30 fps", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  await page.goto("/?benchmark=normal");
  await expect(page.locator(".iriograph-scene-node")).toHaveCount(500, { timeout: 120_000 });
  await expect(page.locator(".iriograph-edge-group")).toHaveCount(1_000);
  await waitAnimationFrames(page, 20);

  const viewport = page.locator(".iriograph-canvas-scroll");
  await startFrameCapture(page);
  await viewport.evaluate(async (element) => {
    for (let frame = 0; frame < 90; frame += 1) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      element.scrollLeft += 5;
      element.scrollTop += frame % 2;
    }
  });
  const panFrames = await stopFrameCapture(page);
  assertFrameBudget("pan-normal", panFrames);

  await viewport.evaluate((element) => {
    element.scrollLeft = 0;
    element.scrollTop = 0;
  });
  const node = page.locator(".iriograph-scene-node").first();
  await node.scrollIntoViewIfNeeded();
  const box = await node.boundingBox();
  if (!box) throw new Error("benchmark node has no browser geometry");
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

  await startFrameCapture(page);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  for (let step = 1; step <= 72; step += 1) {
    await page.mouse.move(start.x + step * .8, start.y + Math.sin(step / 6) * 12);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  await waitAnimationFrames(page, 12);
  const dragFrames = await stopFrameCapture(page);
  assertFrameBudget("drag-normal", dragFrames);

  expect(consoleErrors).toEqual([]);
});

async function waitAnimationFrames(page: Page, count: number): Promise<void> {
  await page.evaluate(async (frameCount) => {
    for (let frame = 0; frame < frameCount; frame += 1) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
  }, count);
}

async function startFrameCapture(page: Page): Promise<void> {
  await page.evaluate(() => {
    type CaptureWindow = Window & typeof globalThis & {
      __iriographFrameCapture?: { active: boolean; values: number[]; previous?: number };
    };
    const host = window as CaptureWindow;
    const capture = { active: true, values: [] as number[], previous: undefined as number | undefined };
    host.__iriographFrameCapture = capture;
    const sample = (time: number): void => {
      if (!capture.active) return;
      if (capture.previous !== undefined) capture.values.push(time - capture.previous);
      capture.previous = time;
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
}

async function stopFrameCapture(page: Page): Promise<number[]> {
  return page.evaluate(() => {
    type CaptureWindow = Window & typeof globalThis & {
      __iriographFrameCapture?: { active: boolean; values: number[] };
    };
    const capture = (window as CaptureWindow).__iriographFrameCapture;
    if (!capture) throw new Error("frame capture was not started");
    capture.active = false;
    return [...capture.values];
  });
}

function assertFrameBudget(name: string, samples: number[]): void {
  expect(samples.length, `${name} must contain enough animation frames`).toBeGreaterThanOrEqual(30);
  const sorted = [...samples].sort((left, right) => left - right);
  const p95 = sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * .95) - 1)]!;
  console.info(JSON.stringify({
    benchmark: name,
    sampleCount: samples.length,
    p95FrameMs: Math.round(p95 * 100) / 100,
    budgetMs: Math.round(FRAME_BUDGET_MS * 100) / 100,
  }));
  expect(p95).toBeLessThanOrEqual(FRAME_BUDGET_MS);
}
