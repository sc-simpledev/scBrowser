import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  // Each test has its own app and profile, so several can run at once.
  // Windows machines on CI are too slow to start two apps at once.
  workers: process.env.CI ? (process.platform === 'win32' ? 1 : 2) : 3,
  // Shared CI machines are slow enough to trip timing-sensitive tests now and then.
  retries: process.env.CI ? 2 : 0,
  reporter: [['list']],
  use: { trace: 'retain-on-failure' }
})
