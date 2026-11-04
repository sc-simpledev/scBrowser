import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  // Each test has its own app and profile, so several can run at once.
  workers: process.env.CI ? 2 : 3,
  // Shared CI machines are slow enough to trip timing-sensitive tests now and then.
  retries: process.env.CI ? 2 : 0,
  reporter: [['list']],
  use: { trace: 'retain-on-failure' }
})
