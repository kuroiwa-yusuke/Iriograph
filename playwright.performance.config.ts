import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./performance",
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: "line",
  timeout: 180_000,
  use: {
    baseURL: "http://127.0.0.1:4175",
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
  },
  webServer: {
    command: "npm run build:packages && npm run dev --workspace @iriograph/mock -- --port 4175",
    url: "http://127.0.0.1:4175",
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
