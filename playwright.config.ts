import { defineConfig, devices } from '@playwright/test'

const localProxyBypasses = ['127.0.0.1', 'localhost']
const inheritedProxyBypasses = (process.env.NO_PROXY ?? process.env.no_proxy ?? '')
  .split(',')
  .map((entry) => entry.trim())
  .filter(Boolean)
const noProxy = [...new Set([...inheritedProxyBypasses, ...localProxyBypasses])].join(',')

process.env.NO_PROXY = noProxy
process.env.no_proxy = noProxy

const host = '127.0.0.1'
const port = Number(process.env.PLAYWRIGHT_PORT ?? '4173')

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  outputDir: 'output/playwright/results',
  use: {
    baseURL: `http://${host}:${port}`,
    launchOptions: {
      // 浏览器级静音，不绕过应用 WebAudio 生命周期与诊断语义。
      args: ['--mute-audio'],
    },
    screenshot: 'off',
    trace: 'off',
    video: 'off',
  },
  projects: [
    {
      name: 'stable-chrome',
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chrome',
      },
    },
  ],
  webServer: {
    command: `npm run build && npm run preview -- --host ${host} --port ${port} --strictPort`,
    url: `http://${host}:${port}`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
