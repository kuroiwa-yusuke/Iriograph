import { expect, test } from "@playwright/test";

test("English is the default and changing the UI language does not modify the document", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  await page.addInitScript(() => {
    window.localStorage.removeItem("iriograph.mock.workspace:ui-locale");
  });
  await page.goto("/");
  await page.getByRole("button", { name: /purchase-approval\.iriograph/u }).click();
  await expect(page.locator(".iriograph-canvas-scroll")).toHaveAttribute("aria-busy", "false");

  const locale = page.getByLabel("Editor language");
  await expect(locale).toHaveValue("en");
  await expect(page.getByRole("button", { name: "Diagram", exact: true })).toBeVisible();
  await expect(page.locator(".topbar").getByText("Saved", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: /Document/u, exact: true }).click();
  const documentEditor = page.locator(".iriograph-document-boundary textarea");
  const documentBefore = await documentEditor.inputValue();

  await locale.selectOption("ja");
  const japaneseLocale = page.getByLabel("エディタの表示言語");
  await expect(japaneseLocale).toHaveValue("ja");
  await expect(page.getByRole("button", { name: "図", exact: true })).toBeVisible();
  await expect(page.locator(".topbar").getByText("保存済み", { exact: true })).toBeVisible();
  await expect(documentEditor).toHaveValue(documentBefore);
  await expect(page.locator(".topbar").getByRole("button", { name: "保存", exact: true })).toBeDisabled();

  await japaneseLocale.selectOption("en");
  await expect(page.getByLabel("Editor language")).toHaveValue("en");
  await expect(page.locator(".topbar").getByText("Saved", { exact: true })).toBeVisible();
  await expect(documentEditor).toHaveValue(documentBefore);
  expect(await page.evaluate(() => (
    window.localStorage.getItem("iriograph.mock.workspace:ui-locale")
  ))).toBe("en");
  expect(consoleErrors).toEqual([]);
});
