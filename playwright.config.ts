import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/page',
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
