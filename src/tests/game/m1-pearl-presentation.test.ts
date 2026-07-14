import { describe, expect, it } from 'vitest'

import {
  M1_PEARL_PRESENTATION_CONFIG,
  resolveM1PearlPresentation,
} from '../../game/m1/pearl-presentation-config.ts'

describe('M1 珠子展示配置', () => {
  it('正常技术场景使用尖顶圆底的水滴珠轮廓', () => {
    const presentation = resolveM1PearlPresentation('technical-probe')

    expect(presentation.renderer).toBe('droplet')
    expect(presentation.droplet).toMatchObject({
      heightScale: 2,
      halfWidthScale: expect.any(Number),
    })
    expect(presentation.droplet.halfWidthScale).toBeLessThan(1)
    expect(presentation.droplet.tipControlYScale).toBeLessThan(0)
    expect(presentation.droplet.bottomControlYScale).toBeGreaterThan(0)
    expect(presentation.fireOcclusion).toEqual({
      mode: 'precise-geometry',
      circleRadiusScale: 0.82,
      circleFeatherPixels: 4,
    })
  })

  it('900/2400 性能场景继续使用小圆代理', () => {
    const presentation = resolveM1PearlPresentation('performance')

    expect(presentation.renderer).toBe('circle-proxy')
    expect(presentation.fireOcclusion.mode).toBe('flow-grid')
    expect(presentation).toBe(M1_PEARL_PRESENTATION_CONFIG.performance)
  })
})
