import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PRUEFRASTER_BASE_URL || "http://localhost:3001";

export default defineConfig({
  testDir: "./",
  testMatch: "pruefraster.spec.ts",
  timeout: 90_000,
  workers: 1,
  reporter: "list",
  use: {
    baseURL,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
