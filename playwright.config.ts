import { defineConfig, devices } from "@playwright/test";

const externallyManagedBaseUrl = process.env.IRIOGRAPH_E2E_BASE_URL;
const baseURL = externallyManagedBaseUrl ?? "http://127.0.0.1:4174";
const baseOrigin = new URL(baseURL).origin;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: "line",
  use: {
    baseURL,
    trace: "retain-on-failure",
    // Existing interaction scenarios deliberately exercise the Japanese
    // presentation. localization.spec.ts clears this session preference to
    // verify that a fresh host still starts in English.
    storageState: {
      cookies: [],
      origins: [{
        origin: baseOrigin,
        localStorage: [{ name: "iriograph.mock.workspace:ui-locale", value: "ja" }],
      }],
    },
    ...devices["Desktop Chrome"],
  },
  webServer: externallyManagedBaseUrl ? undefined : {
    command: "npm run build:packages && npm run dev --workspace @iriograph/mock -- --port 4174",
    url: "http://127.0.0.1:4174",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
