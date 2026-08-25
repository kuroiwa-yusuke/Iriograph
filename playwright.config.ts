import { defineConfig, devices } from "@playwright/test";

const externallyManagedBaseUrl = process.env.IRIOGRAPH_E2E_BASE_URL;
const baseURL = externallyManagedBaseUrl ?? "http://127.0.0.1:4174";

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
    ...devices["Desktop Chrome"],
  },
  webServer: externallyManagedBaseUrl ? undefined : {
    command: "npm run build:packages && npm run dev --workspace @iriograph/mock -- --port 4174",
    url: "http://127.0.0.1:4174",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
