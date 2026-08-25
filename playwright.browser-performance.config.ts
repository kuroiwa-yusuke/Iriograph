import { defineConfig, devices } from "@playwright/test";

const externallyManagedBaseUrl = process.env.IRIOGRAPH_BROWSER_PERFORMANCE_BASE_URL;

export default defineConfig({
  testDir: "./browser-performance",
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: "line",
  timeout: 600_000,
  expect: { timeout: 5_000 },
  use: {
    baseURL: externallyManagedBaseUrl ?? "http://127.0.0.1:4176",
    actionTimeout: 5_000,
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
  },
  webServer: externallyManagedBaseUrl ? undefined : {
    command: "npm run build && npm exec --workspace @iriograph/mock -- vite preview --host 0.0.0.0 --port 4176",
    url: "http://127.0.0.1:4176",
    reuseExistingServer: false,
    timeout: 300_000,
  },
});
