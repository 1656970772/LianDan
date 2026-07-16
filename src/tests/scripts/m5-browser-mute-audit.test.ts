import { describe, expect, it } from 'vitest'

import {
  evaluateM5VisualEvidenceBrowserLaunchAudit,
  m5VisualBrowserAudioMutedByLaunchArgs,
} from '../../../scripts/m5-visual-evidence-support.ts'

const launchArgs = Object.freeze([
  '--force-device-scale-factor=1',
  '--mute-audio',
])

const browsers = Object.freeze([
  Object.freeze({
    id: 'stable-chrome',
    channel: 'chrome',
    headed: true,
    launchArgs,
    audioMutedByBrowser: true,
  }),
])

describe('M5 正式浏览器静音 provenance', () => {
  it('只接受恰好一个 stable Chrome，且 headed runtime 由 exact args 派生静音', () => {
    expect(evaluateM5VisualEvidenceBrowserLaunchAudit(browsers)).toBe(true)
    expect(
      evaluateM5VisualEvidenceBrowserLaunchAudit([]),
    ).toBe(false)
    expect(
      evaluateM5VisualEvidenceBrowserLaunchAudit([
        ...browsers,
        { ...browsers[0]!, id: 'extra-browser' },
      ]),
    ).toBe(false)
    expect(
      evaluateM5VisualEvidenceBrowserLaunchAudit([
        { ...browsers[0]!, channel: 'msedge' },
      ]),
    ).toBe(false)
  })

  it('缺 mute arg、provenance false 或伪造 true 均 fail closed', () => {
    const withoutMute = Object.freeze(['--force-device-scale-factor=1'])
    expect(m5VisualBrowserAudioMutedByLaunchArgs(launchArgs)).toBe(true)
    expect(m5VisualBrowserAudioMutedByLaunchArgs(withoutMute)).toBe(false)
    expect(
      evaluateM5VisualEvidenceBrowserLaunchAudit([
        { ...browsers[0]!, audioMutedByBrowser: false },
      ]),
    ).toBe(false)
    expect(
      evaluateM5VisualEvidenceBrowserLaunchAudit([
        { ...browsers[0]!, launchArgs: withoutMute },
      ]),
    ).toBe(false)
    expect(
      evaluateM5VisualEvidenceBrowserLaunchAudit([
        {
          ...browsers[0]!,
          launchArgs: withoutMute,
          audioMutedByBrowser: true,
        },
      ]),
    ).toBe(false)
  })
})
