// The site as a user meets it: the real deployment (BASE_URL, by default
// the production site), real public nodes for the @live tests. Nothing is
// mocked; a test that needs the network says so with @live and is retried,
// since free endpoints rate-limit at times.
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 240_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: process.env.BASE_URL ?? "https://fevm-replay.vercel.app/",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    // The full Chromium in its new headless mode, as close to a user's browser as headless gets.
    { name: "desktop", use: { ...devices["Desktop Chrome"], channel: "chromium" }, grepInvert: /@mobile/ },
    { name: "mobile", use: { ...devices["Pixel 7"], channel: "chromium" }, grep: /@mobile/ },
    // The browser check in the other two engines: wasm tail calls, BigInt, workers.
    { name: "firefox", use: { ...devices["Desktop Firefox"] }, grep: /@engines/ },
    { name: "webkit", use: { ...devices["Desktop Safari"] }, grep: /@engines/ },
  ],
});
