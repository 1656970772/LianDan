import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

import {
  createBrowserM5AudioBackend,
  M5AudioDirector,
  WebAudioM5Backend,
  type M5AudioBackend,
  type M5AudioConfig,
  type M5AudioCue,
  type M5AudioSynthesisProfile,
} from '../../game/extraction/m5-audio-director.ts'

class FakeAudioBackend implements M5AudioBackend {
  readonly unlock = vi.fn(async () => {})
  readonly oneShots: Array<{
    cue: M5AudioCue
    profile: M5AudioSynthesisProfile
    gain: number
  }> = []
  readonly loops: Array<{
    cue: M5AudioCue
    profile: M5AudioSynthesisProfile
    gain: number
  }> = []
  readonly stoppedLoops: M5AudioCue[] = []
  readonly masterGains: number[] = []
  stopAllCount = 0
  activeVoiceCount = 0

  playOneShot(
    cue: M5AudioCue,
    profile: M5AudioSynthesisProfile,
    gain: number,
  ): boolean {
    this.oneShots.push({ cue, profile, gain })
    this.activeVoiceCount += 1
    return true
  }

  startLoop(
    cue: M5AudioCue,
    profile: M5AudioSynthesisProfile,
    gain: number,
  ): boolean {
    this.loops.push({ cue, profile, gain })
    this.activeVoiceCount += 1
    return true
  }

  stopLoop(cue: M5AudioCue): void {
    this.stoppedLoops.push(cue)
    this.activeVoiceCount = Math.max(0, this.activeVoiceCount - 1)
  }

  setMasterGain(gain: number): void {
    this.masterGains.push(gain)
  }

  stopAll(): void {
    this.stopAllCount += 1
    this.activeVoiceCount = 0
  }

  getActiveVoiceCount(): number {
    return this.activeVoiceCount
  }

  getRuntimeStorageGrowthCount(): number {
    return 0
  }
}

const tone = (
  gain: number,
  durationMilliseconds = 120,
): M5AudioSynthesisProfile => ({
  generator: 'tone',
  waveform: 'triangle',
  frequencyHz: 220,
  frequencyEndHz: 180,
  attackMilliseconds: 8,
  decayMilliseconds: 0,
  sustainLevel: 1,
  releaseMilliseconds: 40,
  durationMilliseconds,
  gain,
})

const config: M5AudioConfig = {
  initialVolume: 0.7,
  initiallyMuted: false,
  mergeWindowMilliseconds: 80,
  mergeGainPerDoubling: 0.18,
  maximumMergedGainScale: 1.65,
  maxVoices: 4,
  profiles: {
    fireStart: tone(0.35),
    fireLoop: { ...tone(0.18, 1_000), loop: true },
    fireStop: tone(0.22),
    pearlCaught: tone(0.24),
    pearlShield: tone(0.2),
    pearlDamaged: tone(0.28),
    interaction: tone(0.34),
    warningOne: tone(0.3),
    warningTwo: tone(0.4),
    failure: tone(0.48),
  },
  mergeableCues: ['pearlShield'],
}

describe('M5 音频导演', () => {
  it('浏览器 backend 按配置 voice 上限预分配槽位，热路径不增长 Set/Map 或创建 loop profile 副本', () => {
    const source = readFileSync(
      new URL('../../game/extraction/m5-audio-director.ts', import.meta.url),
      'utf8',
    )
    const backendSource = source.slice(
      source.indexOf('export class WebAudioM5Backend'),
      source.indexOf('export class SilentM5AudioBackend'),
    )

    expect(backendSource).toContain(
      'new Array<AudioSource | null>(maxVoices).fill(null)',
    )
    expect(backendSource).not.toContain('new Set<AudioSource>')
    expect(backendSource).not.toContain('#activeSources.add(')
    expect(backendSource).not.toContain('new Map<M5AudioCue')
    expect(backendSource).not.toContain('{ ...profile, loop: true }')
    expect(source).toContain(
      'new WebAudioM5Backend(() => new AudioContextConstructor(), maxVoices)',
    )
  })

  it('合并音效槽位在构造期预分配，reset 后跨多个时间窗不再增长运行期存储', async () => {
    const backend = new FakeAudioBackend()
    const director = new M5AudioDirector(config, backend)
    await director.unlock()

    expect(director.pendingMergedCueStorageCapacity).toBe(
      config.mergeableCues.length,
    )
    expect(director.pendingMergedCueStorageGrowthCount).toBe(0)
    expect(director.runtimeStorageGrowthCount).toBe(0)

    for (let window = 0; window < 3; window += 1) {
      director.reset()
      const start = window * 1_000
      director.emit('pearlShield', start)
      director.emit('pearlShield', start + 1)
      director.update(start + config.mergeWindowMilliseconds)
      expect(director.pendingMergedCueStorageGrowthCount).toBe(0)
    }
  })

  it('首次用户手势只解锁一次，并应用配置化总音量', async () => {
    const backend = new FakeAudioBackend()
    const director = new M5AudioDirector(config, backend)

    director.emit('pearlCaught', 0)
    expect(backend.oneShots).toHaveLength(0)

    await director.unlock()
    await director.unlock()
    director.emit('pearlCaught', 1)

    expect(backend.unlock).toHaveBeenCalledTimes(1)
    expect(backend.masterGains.at(-1)).toBeCloseTo(0.7)
    expect(backend.oneShots.map(({ cue }) => cue)).toEqual(['pearlCaught'])
  })

  it('同一时间窗的大量护盾事件合并为一个 voice，并按数量有限增益', async () => {
    const backend = new FakeAudioBackend()
    const director = new M5AudioDirector(config, backend)
    await director.unlock()

    for (let index = 0; index < 32; index += 1) {
      director.emit('pearlShield', index * 2)
    }
    director.update(79)
    expect(backend.oneShots).toHaveLength(0)

    director.update(80)

    expect(backend.oneShots).toHaveLength(1)
    expect(backend.oneShots[0]!.cue).toBe('pearlShield')
    expect(backend.oneShots[0]!.gain).toBeGreaterThan(
      config.profiles.pearlShield.gain,
    )
    expect(backend.oneShots[0]!.gain).toBeLessThanOrEqual(
      config.profiles.pearlShield.gain * config.maximumMergedGainScale,
    )
    expect(director.getDiagnostics()).toMatchObject({
      mergedEventCount: 31,
      playedVoiceCount: 1,
    })
  })

  it('起火、稳定循环与收尾是同一可重入生命周期', async () => {
    const backend = new FakeAudioBackend()
    const director = new M5AudioDirector(config, backend)
    await director.unlock()

    director.setFireActive(true, 0)
    director.setFireActive(true, 20)
    director.setFireActive(false, 100)
    director.setFireActive(false, 120)

    expect(backend.oneShots.map(({ cue }) => cue)).toEqual([
      'fireStart',
      'fireStop',
    ])
    expect(backend.loops.map(({ cue }) => cue)).toEqual(['fireLoop'])
    expect(backend.stoppedLoops).toEqual(['fireLoop'])
  })

  it('静音、voice 上限和 reset 都不留下跨炉声音', async () => {
    const backend = new FakeAudioBackend()
    const director = new M5AudioDirector(config, backend)
    await director.unlock()

    director.setMuted(true)
    director.emit('failure', 0)
    expect(backend.oneShots).toHaveLength(0)
    expect(backend.masterGains.at(-1)).toBe(0)

    director.setMuted(false)
    backend.activeVoiceCount = config.maxVoices
    director.emit('failure', 1)
    expect(director.getDiagnostics().droppedVoiceCount).toBe(1)

    director.emit('pearlShield', 2)
    director.reset()
    director.update(1_000)

    expect(backend.stopAllCount).toBe(1)
    expect(backend.oneShots).toHaveLength(0)
    expect(director.getDiagnostics()).toMatchObject({
      activeVoiceCount: 0,
      pendingMergedCueCount: 0,
    })
  })

  it('静音期间停火也会关闭循环，取消静音后不会复燃旧声音', async () => {
    const backend = new FakeAudioBackend()
    const director = new M5AudioDirector(config, backend)
    await director.unlock()

    director.setFireActive(true, 0)
    director.setMuted(true)
    director.setFireActive(false, 20)
    director.setMuted(false)

    expect(backend.stoppedLoops).toEqual(['fireLoop'])
    expect(backend.loops).toHaveLength(1)
  })

  it('浏览器不支持 Web Audio 时仍可解锁并保持有界静默诊断', async () => {
    const backend = createBrowserM5AudioBackend({}, config.maxVoices)
    const director = new M5AudioDirector(config, backend)

    await expect(director.unlock()).resolves.toBeUndefined()
    director.setFireActive(true, 0)
    director.emit('pearlCaught', 1)
    director.update(100)

    expect(director.getDiagnostics()).toMatchObject({
      unlocked: true,
      activeVoiceCount: 0,
      playedVoiceCount: 0,
    })
    await expect(director.destroy()).resolves.toBeUndefined()
  })

  it('fireStart 瞬时占满 voice 时会在释放后补启稳定火循环', async () => {
    const backend = new FakeAudioBackend()
    const director = new M5AudioDirector(
      { ...config, maxVoices: 1 },
      backend,
    )
    await director.unlock()

    director.setFireActive(true, 0)
    expect(backend.oneShots.map(({ cue }) => cue)).toEqual(['fireStart'])
    expect(backend.loops).toHaveLength(0)
    director.update(500)
    expect(director.getDiagnostics().droppedVoiceCount).toBe(1)

    backend.activeVoiceCount = 0
    director.update(1_000)

    expect(backend.loops.map(({ cue }) => cue)).toEqual(['fireLoop'])
  })

  it('解锁被浏览器拒绝后会允许后续用户手势重试', async () => {
    const backend = new FakeAudioBackend()
    backend.unlock
      .mockRejectedValueOnce(new Error('AUTOPLAY_REJECTED'))
      .mockResolvedValueOnce(undefined)
    const director = new M5AudioDirector(config, backend)

    await expect(director.unlock()).rejects.toThrow('AUTOPLAY_REJECTED')
    await expect(director.unlock()).resolves.toBeUndefined()

    expect(backend.unlock).toHaveBeenCalledTimes(2)
    expect(director.getDiagnostics().unlocked).toBe(true)
  })

  it('Web Audio 按 ADSR 衰减到 sustain，并用噪声频率驱动滤波器', async () => {
    type ParamCall = readonly [
      kind: 'set' | 'linear',
      value: number,
      timestamp: number,
    ]

    class FakeAudioParam {
      value = 0
      readonly calls: ParamCall[] = []

      setValueAtTime(value: number, timestamp: number): void {
        this.calls.push(['set', value, timestamp])
      }

      linearRampToValueAtTime(value: number, timestamp: number): void {
        this.calls.push(['linear', value, timestamp])
      }
    }

    class FakeAudioNode {
      readonly connect = vi.fn()
    }

    class FakeGainNode extends FakeAudioNode {
      readonly gain = new FakeAudioParam()
    }

    class FakeOscillatorNode extends FakeAudioNode {
      type: OscillatorType = 'sine'
      readonly frequency = new FakeAudioParam()
      readonly addEventListener = vi.fn()
      readonly start = vi.fn()
      readonly stop = vi.fn()
    }

    class FakeBufferSourceNode extends FakeAudioNode {
      buffer: unknown = null
      loop = false
      readonly addEventListener = vi.fn()
      readonly start = vi.fn()
      readonly stop = vi.fn()
    }

    class FakeBiquadFilterNode extends FakeAudioNode {
      type: BiquadFilterType = 'lowpass'
      readonly frequency = new FakeAudioParam()
    }

    const gains: FakeGainNode[] = []
    const filters: FakeBiquadFilterNode[] = []
    const context = {
      state: 'running',
      currentTime: 10,
      sampleRate: 1_000,
      destination: new FakeAudioNode(),
      createGain: vi.fn(() => {
        const gain = new FakeGainNode()
        gains.push(gain)
        return gain
      }),
      createOscillator: vi.fn(() => new FakeOscillatorNode()),
      createBufferSource: vi.fn(() => new FakeBufferSourceNode()),
      createBiquadFilter: vi.fn(() => {
        const filter = new FakeBiquadFilterNode()
        filters.push(filter)
        return filter
      }),
      createBuffer: vi.fn((_channels: number, length: number) => ({
        getChannelData: () => new Float32Array(length),
      })),
      resume: vi.fn(async () => {}),
      close: vi.fn(async () => {}),
    }
    vi.stubGlobal('OscillatorNode', FakeOscillatorNode)

    try {
      const backend = new WebAudioM5Backend(
        () => context as unknown as AudioContext,
        config.maxVoices,
      )
      await backend.unlock()
      const profile = {
        ...tone(0.8, 1_000),
        decayMilliseconds: 200,
        sustainLevel: 0.25,
      }

      expect(backend.playOneShot('pearlCaught', profile, 0.8)).toBe(true)
      expect(
        gains[1]!.gain.calls.map(([kind, value]) => [kind, value]),
      ).toEqual([
        ['set', 0],
        ['linear', 0.8],
        ['linear', 0.2],
        ['set', 0.2],
        ['linear', 0],
      ])
      const expectedEnvelopeTimes = [10, 10.008, 10.208, 10.96, 11]
      for (const [index, expectedTime] of expectedEnvelopeTimes.entries()) {
        expect(gains[1]!.gain.calls[index]![2]).toBeCloseTo(expectedTime)
      }

      const noiseProfile = {
        ...profile,
        generator: 'noise' as const,
        frequencyHz: 95,
        frequencyEndHz: 70,
      }
      expect(backend.playOneShot('fireStop', noiseProfile, 0.8)).toBe(true)
      expect(filters).toHaveLength(1)
      expect(filters[0]!.frequency.calls).toEqual([
        ['set', 95, 10],
        ['linear', 70, 11],
      ])
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('停止火焰循环时消费配置的 release，保持当前增益后再停止声源', async () => {
    type ParamCall = readonly [
      kind: 'set' | 'linear',
      value: number,
      timestamp: number,
    ]

    class FakeAudioParam {
      value = 0
      readonly calls: ParamCall[] = []

      setValueAtTime(value: number, timestamp: number): void {
        this.value = value
        this.calls.push(['set', value, timestamp])
      }

      linearRampToValueAtTime(value: number, timestamp: number): void {
        this.value = value
        this.calls.push(['linear', value, timestamp])
      }
    }

    class FakeAudioNode {
      readonly connect = vi.fn()
    }

    class FakeGainNode extends FakeAudioNode {
      readonly gain = new FakeAudioParam()
    }

    class FakeOscillatorNode extends FakeAudioNode {
      type: OscillatorType = 'sine'
      readonly frequency = new FakeAudioParam()
      readonly start = vi.fn()
      readonly stop = vi.fn()
      #ended: (() => void) | null = null

      addEventListener(
        type: string,
        listener: EventListenerOrEventListenerObject,
      ): void {
        if (type !== 'ended') return
        this.#ended = () => {
          if (typeof listener === 'function') listener(new Event('ended'))
          else listener.handleEvent(new Event('ended'))
        }
      }

      finish(): void {
        this.#ended?.()
      }
    }

    const gains: FakeGainNode[] = []
    const oscillators: FakeOscillatorNode[] = []
    const context = {
      state: 'running',
      currentTime: 10,
      sampleRate: 1_000,
      destination: new FakeAudioNode(),
      createGain: vi.fn(() => {
        const gain = new FakeGainNode()
        gains.push(gain)
        return gain
      }),
      createOscillator: vi.fn(() => {
        const oscillator = new FakeOscillatorNode()
        oscillators.push(oscillator)
        return oscillator
      }),
      resume: vi.fn(async () => {}),
      close: vi.fn(async () => {}),
    }
    vi.stubGlobal('OscillatorNode', FakeOscillatorNode)

    try {
      const backend = new WebAudioM5Backend(
        () => context as unknown as AudioContext,
        config.maxVoices,
      )
      await backend.unlock()
      const loopProfile: M5AudioSynthesisProfile = {
        ...tone(0.4, 1_000),
        attackMilliseconds: 50,
        decayMilliseconds: 100,
        sustainLevel: 0.5,
        releaseMilliseconds: 350,
        loop: true,
      }

      expect(
        backend.startLoop('fireLoop', loopProfile, loopProfile.gain),
      ).toBe(true)
      context.currentTime = 12
      backend.stopLoop('fireLoop')
      backend.stopLoop('fireLoop')

      expect(gains[1]!.gain.calls.slice(-2)).toEqual([
        ['set', 0.2, 12],
        ['linear', 0, 12.35],
      ])
      expect(oscillators[0]!.stop).toHaveBeenCalledTimes(1)
      expect(oscillators[0]!.stop).toHaveBeenCalledWith(12.35)
      expect(backend.getActiveVoiceCount()).toBe(1)
      oscillators[0]!.finish()
      expect(backend.getActiveVoiceCount()).toBe(0)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
