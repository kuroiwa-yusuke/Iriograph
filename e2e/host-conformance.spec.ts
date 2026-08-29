import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  IRIOGRAPH_HOST_CONFORMANCE_MANIFEST,
  verifyIriographHostConformance,
  type IriographHostConformanceReport,
} from "../packages/host-conformance/src/index.js";

const manifest = IRIOGRAPH_HOST_CONFORMANCE_MANIFEST;
const fixtureUrl = new URL(
  "../packages/host-conformance/fixtures/baseline.iriograph.json",
  import.meta.url,
);

test("local Mock satisfies the versioned host-conformance browser manifest", async ({ page }) => {
  const browserErrors: string[] = [];
  const failedRequests: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("requestfailed", (request) => {
    failedRequests.push(`${request.method()} ${request.url()}: ${request.failure()?.errorText ?? "failed"}`);
  });

  const fixtureBytes = await readFile(fixtureUrl);
  const fixture = JSON.parse(fixtureBytes.toString("utf8")) as {
    documentId: string;
    imports: Array<{ catalogRef: string }>;
  };
  const fixtureIntegrity = `sha256-${createHash("sha256").update(fixtureBytes).digest("base64")}`;
  expect(manifest.fixtureRef).toBe("@iriograph/host-conformance/fixtures/baseline.iriograph.json");
  expect(fixtureIntegrity).toBe(manifest.fixtureIntegrity);
  expect(fixture.imports[0]?.catalogRef).toBe(manifest.baselineCatalogRef);

  const mockEntrySource = await readFile(
    new URL("../apps/mock/src/main.ts", import.meta.url),
    "utf8",
  );
  expect(mockEntrySource).toContain(`import "${manifest.cssEntry}";`);

  const response = await page.goto("/");
  expect(response?.ok()).toBe(true);
  const editor = page.locator(".iriograph-editor");
  await expect(editor).toBeVisible();

  const observedChecks = new Set<string>();
  const markObserved = (id: string): void => {
    expect(manifest.browserChecks.some((check) => check.id === id)).toBe(true);
    observedChecks.add(id);
  };

  await expect(editor).toHaveAttribute("data-iriograph-package-version", manifest.packageVersion);
  const capabilities = (await editor.getAttribute("data-iriograph-capabilities"))
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean) ?? [];
  expect(new Set(capabilities)).toEqual(new Set(
    manifest.capabilities.map((capability) => capability.id),
  ));
  markObserved("runtime-metadata");

  const grid = page.locator(".iriograph-canvas-grid");
  await expect(grid).toBeVisible();
  await expect(grid).toHaveCSS("pointer-events", "none");
  await expect(grid).not.toHaveCSS("background-image", "none");
  await expect(page.locator(".iriograph-editor-layout")).toHaveCSS("display", "grid");
  markObserved("css-and-grid");

  await page.locator('input[type="file"][accept*=".iriograph"]').setInputFiles(
    fileURLToPath(fixtureUrl),
  );
  await expect(page.locator(".document-heading")).toContainText("baseline.iriograph.json");
  const viewport = page.locator(".iriograph-canvas-scroll");
  await expect(viewport).toHaveAttribute("aria-busy", "false");
  await expect(viewport).toHaveAttribute("role", "listbox");
  await expect(sceneNode(page, "開始")).toBeVisible();
  await expect(sceneNode(page, "完了")).toBeVisible();
  await expect(page.locator(".iriograph-edge-group")).toHaveCount(1);
  markObserved("baseline-fixture");

  const start = sceneNode(page, "開始");
  const completed = sceneNode(page, "完了");
  await start.click();
  await completed.click({ modifiers: ["Control"] });
  await expect(page.locator(".iriograph-scene-node.selected")).toHaveCount(2);
  await page.getByRole("button", { name: "拡大" }).click();
  await expect(page.locator(".iriograph-scene-node.selected")).toHaveCount(2);
  markObserved("selection");

  await start.dispatchEvent("contextmenu", { clientX: 600, clientY: 320 });
  const pointerMenu = page.getByRole("menu", { name: "選択対象の操作" });
  await expect(pointerMenu).toBeVisible();
  await expect(pointerMenu.getByRole("menuitem", { name: /^要素の詳細/u })).toBeVisible();
  await expect(pointerMenu.getByRole("menuitem", { name: /^関係を追加/u })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(pointerMenu).toHaveCount(0);
  markObserved("context-menu");

  const group = groupFrame(page, "領域");
  await expect(group).toHaveCount(1);
  await expect(group.locator(".iriograph-group-frame-label-text")).toHaveText("領域");
  const groupBox = await requiredBox(group, "baseline membership container");
  for (const node of [start, completed]) {
    expect(boxContains(groupBox, await requiredBox(node, "baseline member"))).toBe(true);
  }
  markObserved("container-membership");

  await start.click();
  await viewport.focus();
  const selectedId = await viewport.getAttribute("aria-activedescendant");
  expect(selectedId).toBeTruthy();
  await page.keyboard.press("n");
  await expect(viewport).not.toHaveAttribute("aria-activedescendant", selectedId ?? "");
  await page.keyboard.press("Shift+F10");
  const keyboardMenu = page.getByRole("menu", { name: "選択対象の操作" });
  await expect(keyboardMenu).toBeVisible();
  const focusReturnId = await viewport.getAttribute("id");
  expect(focusReturnId).toBeTruthy();
  await expect(keyboardMenu.locator('[role="menuitem"]:focus')).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect.poll(() => page.evaluate(() => document.activeElement?.id ?? ""))
    .toBe(focusReturnId ?? "");
  markObserved("focus-navigation");

  expect([...observedChecks].sort()).toEqual(
    manifest.browserChecks.map((check) => check.id).sort(),
  );
  const report: IriographHostConformanceReport = {
    host: "mock",
    packageVersion: await editor.getAttribute("data-iriograph-package-version") ?? "",
    cssEntry: manifest.cssEntry,
    baselineCatalogRef: fixture.imports[0]?.catalogRef ?? "",
    fixtureRef: manifest.fixtureRef,
    fixtureIntegrity,
    capabilities,
    browserChecks: [...observedChecks],
    extensions: [],
    health: response?.ok() ? "healthy" : "unhealthy",
    browserErrors,
    failedRequests,
  };
  expect(verifyIriographHostConformance(report)).toEqual([]);
});

function sceneNode(page: Page, label: string): Locator {
  const exactLabel = page.locator(".iriograph-node-label")
    .filter({ hasText: new RegExp(`^${escapeRegex(label)}$`, "u") });
  return page.locator(".iriograph-scene-node").filter({ has: exactLabel });
}

function groupFrame(page: Page, label: string): Locator {
  const exactLabel = page.locator(".iriograph-group-frame-label-text")
    .filter({ hasText: new RegExp(`^${escapeRegex(label)}$`, "u") });
  return page.locator([
    ".iriograph-scene-region.group-frame",
    ".iriograph-scene-container.group-frame",
  ].join(",")).filter({ has: exactLabel });
}

async function requiredBox(locator: Locator, label: string) {
  const box = await locator.boundingBox();
  if (!box) throw new Error(`${label} does not have a bounding box`);
  return box;
}

function boxContains(
  outer: { x: number; y: number; width: number; height: number },
  inner: { x: number; y: number; width: number; height: number },
): boolean {
  const tolerance = 1;
  return inner.x >= outer.x - tolerance
    && inner.y >= outer.y - tolerance
    && inner.x + inner.width <= outer.x + outer.width + tolerance
    && inner.y + inner.height <= outer.y + outer.height + tolerance;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
