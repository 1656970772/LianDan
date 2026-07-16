export type M5AudioCue =
  | 'fireStart'
  | 'fireLoop'
  | 'fireStop'
  | 'pearlCaught'
  | 'pearlShield'
  | 'pearlDamaged'
  | 'interaction'
  | 'warningOne'
  | 'warningTwo'
  | 'failure'

export type M5AudioSynthesisProfile = Readonly<{
  generator: 'tone' | 'noise'
  waveform?: OscillatorType
  frequencyHz: number
  frequencyEndHz: number
  attackMilliseconds: number
  decayMilliseconds: number
  sustainLevel: number
  releaseMilliseconds: number
  durationMilliseconds: number
  gain: number
  loop?: boolean
}>

export type M5AudioConfig = Readonly<{
  initialVolume: number
  initiallyMuted: boolean
  mergeWindowMilliseconds: number
  mergeGainPerDoubling: number
  maximumMergedGainScale: number
  maxVoices: number
  profiles: Readonly<Record<M5AudioCue, M5AudioSynthesisProfile>>
  mergeableCues: readonly M5AudioCue[]
}>

export interface M5AudioBackend {
  unlock(): Promise<void>
  playOneShot(
    cue: M5AudioCue,
    profile: M5AudioSynthesisProfile,
    gain: number,
  ): boolean
  startLoop(
    cue: M5AudioCue,
    profile: M5AudioSynthesisProfile,
    gain: number,
  ): boolean
  stopLoop(cue: M5AudioCue): void
  setMasterGain(gain: number): void
  stopAll(): void
  getActiveVoiceCount(): number
  getRuntimeStorageGrowthCount(): number
  close?(): Promise<void>
}

export type M5AudioDiagnostics = Readonly<{
  unlocked: boolean
  muted: boolean
  volume: number
  activeVoiceCount: number
  voiceHighWaterMark: number
  pendingMergedCueCount: number
  mergedEventCount: number
  playedVoiceCount: number
  droppedVoiceCount: number
}>

type PendingMergedCue = {
  cue: M5AudioCue
  active: boolean
  firstTimestampMilliseconds: number
  count: number
}

const FIRE_LOOP_CUE: M5AudioCue = 'fireLoop'

function finiteInRange(
  value: number,
  minimum: number,
  maximum: number,
): boolean {
  return Number.isFinite(value) && value >= minimum && value <= maximum
}

function validateProfile(profile: M5AudioSynthesisProfile): void {
  if (
    !finiteInRange(profile.frequencyHz, 1, 24_000) ||
    !finiteInRange(profile.frequencyEndHz, 1, 24_000) ||
    !finiteInRange(profile.attackMilliseconds, 0, 60_000) ||
    !finiteInRange(profile.decayMilliseconds, 0, 60_000) ||
    !finiteInRange(profile.sustainLevel, 0, 1) ||
    !finiteInRange(profile.releaseMilliseconds, 0, 60_000) ||
    !finiteInRange(profile.durationMilliseconds, 1, 60_000) ||
    !finiteInRange(profile.gain, 0, 1) ||
    profile.attackMilliseconds +
      profile.decayMilliseconds +
      profile.releaseMilliseconds >
      profile.durationMilliseconds
  ) {
    throw new RangeError('M5_AUDIO_PROFILE_INVALID')
  }
  if (
    profile.generator === 'tone' &&
    profile.waveform !== undefined &&
    !['sine', 'square', 'sawtooth', 'triangle'].includes(profile.waveform)
  ) {
    throw new RangeError('M5_AUDIO_PROFILE_INVALID')
  }
}

function validateConfig(config: M5AudioConfig): void {
  if (
    !finiteInRange(config.initialVolume, 0, 1) ||
    !finiteInRange(config.mergeWindowMilliseconds, 0, 10_000) ||
    !finiteInRange(config.mergeGainPerDoubling, 0, 1) ||
    !finiteInRange(config.maximumMergedGainScale, 1, 8) ||
    !Number.isSafeInteger(config.maxVoices) ||
    config.maxVoices <= 0
  ) {
    throw new RangeError('M5_AUDIO_CONFIG_INVALID')
  }
  for (const profile of Object.values(config.profiles)) validateProfile(profile)
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}

/**
 * Converts semantic presentation cues into bounded audio voices. The director
 * owns no gameplay state and may be reset at a session cutover without changing
 * the authoritative simulation.
 */
export class M5AudioDirector {
  readonly #config: M5AudioConfig
  readonly #backend: M5AudioBackend
  readonly #pendingMergedCueIndex: ReadonlyMap<M5AudioCue, number>
  readonly #pendingMergedCues: PendingMergedCue[]
  #unlockPromise: Promise<void> | null = null
  #unlocked = false
  #muted: boolean
  #volume: number
  #fireActive = false
  #fireLoopStarted = false
  #voiceHighWaterMark = 0
  #mergedEventCount = 0
  #playedVoiceCount = 0
  #droppedVoiceCount = 0
  #pendingMergedCueCount = 0
  #pendingMergedCueStorageGrowthCount = 0

  constructor(config: M5AudioConfig, backend: M5AudioBackend) {
    validateConfig(config)
    this.#config = config
    this.#backend = backend
    const cueIndex = new Map<M5AudioCue, number>()
    this.#pendingMergedCues = []
    for (const cue of config.mergeableCues) {
      if (cueIndex.has(cue)) continue
      cueIndex.set(cue, this.#pendingMergedCues.length)
      this.#pendingMergedCues.push({
        cue,
        active: false,
        firstTimestampMilliseconds: 0,
        count: 0,
      })
    }
    this.#pendingMergedCueIndex = cueIndex
    this.#muted = config.initiallyMuted
    this.#volume = config.initialVolume
  }

  /** 构造期固定容量；正式帧只复用槽位，不允许按事件增长。 */
  get pendingMergedCueStorageCapacity(): number {
    return this.#pendingMergedCues.length
  }

  /** 供正式性能门禁读取真实存储增长，而不是在 scene 中镜像猜测。 */
  get pendingMergedCueStorageGrowthCount(): number {
    return this.#pendingMergedCueStorageGrowthCount
  }

  /** 合并槽与 backend voice 存储的真实运行期增长总数。 */
  get runtimeStorageGrowthCount(): number {
    return (
      this.#pendingMergedCueStorageGrowthCount +
      this.#backend.getRuntimeStorageGrowthCount()
    )
  }

  unlock(): Promise<void> {
    if (this.#unlocked) return Promise.resolve()
    if (this.#unlockPromise !== null) return this.#unlockPromise
    this.#unlockPromise = this.#backend.unlock().then(
      () => {
        this.#unlocked = true
        this.#applyMasterGain()
        if (this.#fireActive && !this.#muted) this.#startFireVoices()
      },
      (reason: unknown) => {
        this.#unlockPromise = null
        throw reason
      },
    )
    return this.#unlockPromise
  }

  emit(cue: Exclude<M5AudioCue, 'fireLoop'>, timestampMilliseconds: number): void {
    if (!Number.isFinite(timestampMilliseconds)) {
      throw new RangeError('M5_AUDIO_TIMESTAMP_INVALID')
    }
    if (!this.#unlocked || this.#muted) return
    const pendingIndex = this.#pendingMergedCueIndex.get(cue)
    if (pendingIndex !== undefined) {
      const pending = this.#pendingMergedCues[pendingIndex]!
      if (!pending.active) {
        pending.active = true
        pending.firstTimestampMilliseconds = timestampMilliseconds
        pending.count = 1
        this.#pendingMergedCueCount += 1
      } else {
        pending.count += 1
        this.#mergedEventCount += 1
      }
      return
    }
    this.#playOneShot(cue, 1)
  }

  update(timestampMilliseconds: number): void {
    if (!Number.isFinite(timestampMilliseconds)) {
      throw new RangeError('M5_AUDIO_TIMESTAMP_INVALID')
    }
    for (let index = 0; index < this.#pendingMergedCues.length; index += 1) {
      const pending = this.#pendingMergedCues[index]!
      if (!pending.active) continue
      if (
        timestampMilliseconds - pending.firstTimestampMilliseconds <
        this.#config.mergeWindowMilliseconds
      ) {
        continue
      }
      const scale = Math.min(
        this.#config.maximumMergedGainScale,
        1 + Math.log2(Math.max(1, pending.count)) * this.#config.mergeGainPerDoubling,
      )
      this.#playOneShot(pending.cue, scale)
      pending.active = false
      pending.count = 0
      this.#pendingMergedCueCount -= 1
    }
    if (this.#fireActive && !this.#fireLoopStarted) {
      this.#tryStartFireLoop(false)
    }
  }

  setFireActive(active: boolean, timestampMilliseconds: number): void {
    if (!Number.isFinite(timestampMilliseconds)) {
      throw new RangeError('M5_AUDIO_TIMESTAMP_INVALID')
    }
    if (active === this.#fireActive) return
    this.#fireActive = active
    if (active) {
      if (!this.#unlocked || this.#muted) return
      this.#startFireVoices()
      return
    }
    if (this.#fireLoopStarted) {
      this.#backend.stopLoop(FIRE_LOOP_CUE)
      this.#fireLoopStarted = false
    }
    if (this.#unlocked && !this.#muted) this.#playOneShot('fireStop', 1)
  }

  setMuted(muted: boolean): void {
    if (this.#muted === muted) return
    this.#muted = muted
    this.#applyMasterGain()
    if (!muted && this.#unlocked && this.#fireActive) this.#startFireVoices()
  }

  setVolume(volume: number): void {
    this.#volume = clampUnit(volume)
    this.#applyMasterGain()
  }

  reset(): void {
    for (let index = 0; index < this.#pendingMergedCues.length; index += 1) {
      const pending = this.#pendingMergedCues[index]!
      pending.active = false
      pending.firstTimestampMilliseconds = 0
      pending.count = 0
    }
    this.#pendingMergedCueCount = 0
    this.#fireActive = false
    this.#fireLoopStarted = false
    this.#backend.stopAll()
    this.#voiceHighWaterMark = 0
    this.#mergedEventCount = 0
    this.#playedVoiceCount = 0
    this.#droppedVoiceCount = 0
  }

  async destroy(): Promise<void> {
    this.reset()
    await this.#backend.close?.()
  }

  getDiagnostics(): M5AudioDiagnostics {
    return {
      unlocked: this.#unlocked,
      muted: this.#muted,
      volume: this.#volume,
      activeVoiceCount: this.#backend.getActiveVoiceCount(),
      voiceHighWaterMark: this.#voiceHighWaterMark,
      pendingMergedCueCount: this.#pendingMergedCueCount,
      mergedEventCount: this.#mergedEventCount,
      playedVoiceCount: this.#playedVoiceCount,
      droppedVoiceCount: this.#droppedVoiceCount,
    }
  }

  #applyMasterGain(): void {
    if (!this.#unlocked) return
    this.#backend.setMasterGain(this.#muted ? 0 : this.#volume)
  }

  #startFireVoices(): void {
    if (!this.#unlocked || this.#muted || this.#fireLoopStarted) return
    this.#playOneShot('fireStart', 1)
    this.#tryStartFireLoop(true)
  }

  #tryStartFireLoop(recordDrop: boolean): void {
    if (!this.#unlocked || this.#muted || this.#fireLoopStarted) return
    if (!this.#canAllocateVoice(recordDrop)) return
    const profile = this.#config.profiles.fireLoop
    if (this.#backend.startLoop(FIRE_LOOP_CUE, profile, profile.gain)) {
      this.#fireLoopStarted = true
      this.#recordPlayedVoice()
    }
  }

  #playOneShot(cue: M5AudioCue, gainScale: number): void {
    if (!this.#unlocked || this.#muted || !this.#canAllocateVoice()) return
    const profile = this.#config.profiles[cue]
    if (this.#backend.playOneShot(cue, profile, profile.gain * gainScale)) {
      this.#recordPlayedVoice()
    }
  }

  #canAllocateVoice(recordDrop = true): boolean {
    if (this.#backend.getActiveVoiceCount() < this.#config.maxVoices) return true
    if (recordDrop) this.#droppedVoiceCount += 1
    return false
  }

  #recordPlayedVoice(): void {
    this.#playedVoiceCount += 1
    this.#voiceHighWaterMark = Math.max(
      this.#voiceHighWaterMark,
      this.#backend.getActiveVoiceCount(),
    )
  }
}

type AudioSource = OscillatorNode | AudioBufferSourceNode
type AudioLoopVoiceSlot = {
  active: boolean
  stopping: boolean
  source: AudioSource | null
  envelope: GainNode | null
  releaseMilliseconds: number
}

const ONCE_EVENT_LISTENER_OPTIONS = Object.freeze({ once: true })

function noiseBuffer(context: AudioContext, seconds: number): AudioBuffer {
  const length = Math.max(1, Math.ceil(context.sampleRate * seconds))
  const buffer = context.createBuffer(1, length, context.sampleRate)
  const channel = buffer.getChannelData(0)
  let state = 0x6d2b79f5
  for (let index = 0; index < channel.length; index += 1) {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    channel[index] = ((state >>> 0) / 0x8000_0000 - 1) * 0.72
  }
  return buffer
}

function createSource(
  context: AudioContext,
  profile: M5AudioSynthesisProfile,
  loop: boolean,
): AudioSource {
  if (profile.generator === 'noise') {
    const source = context.createBufferSource()
    source.buffer = noiseBuffer(
      context,
      Math.max(0.05, profile.durationMilliseconds / 1_000),
    )
    source.loop = loop
    return source
  }
  const source = context.createOscillator()
  source.type = profile.waveform ?? 'sine'
  return source
}

function connectSource(
  context: AudioContext,
  source: AudioSource,
  profile: M5AudioSynthesisProfile,
  destination: AudioNode,
  start: number,
  end: number,
): void {
  if (source instanceof OscillatorNode) {
    source.frequency.setValueAtTime(profile.frequencyHz, start)
    source.frequency.linearRampToValueAtTime(profile.frequencyEndHz, end)
    source.connect(destination)
    return
  }
  const filter = context.createBiquadFilter()
  filter.type = 'bandpass'
  filter.frequency.setValueAtTime(profile.frequencyHz, start)
  filter.frequency.linearRampToValueAtTime(profile.frequencyEndHz, end)
  source.connect(filter)
  filter.connect(destination)
}

export class WebAudioM5Backend implements M5AudioBackend {
  readonly #createContext: () => AudioContext
  readonly #activeSources: Array<AudioSource | null>
  readonly #fireLoop: AudioLoopVoiceSlot = {
    active: false,
    stopping: false,
    source: null,
    envelope: null,
    releaseMilliseconds: 0,
  }
  readonly #sourceEndedListener: EventListener
  #activeSourceCount = 0
  #context: AudioContext | null = null
  #master: GainNode | null = null
  #masterGain = 1

  constructor(createContext: () => AudioContext, maxVoices: number) {
    if (!Number.isSafeInteger(maxVoices) || maxVoices <= 0) {
      throw new RangeError('M5_AUDIO_BACKEND_MAX_VOICES_INVALID')
    }
    this.#createContext = createContext
    this.#activeSources = new Array<AudioSource | null>(maxVoices).fill(null)
    this.#sourceEndedListener = this.#onSourceEnded.bind(this)
  }

  async unlock(): Promise<void> {
    if (this.#context === null) {
      this.#context = this.#createContext()
      this.#master = this.#context.createGain()
      this.#master.gain.value = this.#masterGain
      this.#master.connect(this.#context.destination)
    }
    if (this.#context.state === 'suspended') await this.#context.resume()
  }

  playOneShot(
    _cue: M5AudioCue,
    profile: M5AudioSynthesisProfile,
    gain: number,
  ): boolean {
    const context = this.#context
    const master = this.#master
    if (
      context === null ||
      master === null ||
      context.state === 'closed' ||
      this.#activeSourceCount >= this.#activeSources.length
    ) return false
    const source = createSource(context, profile, false)
    const envelope = context.createGain()
    const now = context.currentTime
    const attackEnd = now + profile.attackMilliseconds / 1_000
    const end = now + profile.durationMilliseconds / 1_000
    const releaseStart = Math.max(attackEnd, end - profile.releaseMilliseconds / 1_000)
    const decayEnd = Math.min(
      releaseStart,
      attackEnd + profile.decayMilliseconds / 1_000,
    )
    const peakGain = Math.max(0, gain)
    const sustainGain = peakGain * profile.sustainLevel
    envelope.gain.setValueAtTime(0, now)
    envelope.gain.linearRampToValueAtTime(peakGain, attackEnd)
    if (profile.decayMilliseconds > 0) {
      envelope.gain.linearRampToValueAtTime(sustainGain, decayEnd)
    } else {
      envelope.gain.setValueAtTime(sustainGain, attackEnd)
    }
    envelope.gain.setValueAtTime(sustainGain, releaseStart)
    envelope.gain.linearRampToValueAtTime(0, end)
    connectSource(context, source, profile, envelope, now, end)
    envelope.connect(master)
    this.#trackSource(source)
    source.start(now)
    source.stop(end + 0.005)
    return true
  }

  startLoop(
    cue: M5AudioCue,
    profile: M5AudioSynthesisProfile,
    gain: number,
  ): boolean {
    const context = this.#context
    const master = this.#master
    if (
      context === null ||
      master === null ||
      context.state === 'closed' ||
      cue !== FIRE_LOOP_CUE ||
      this.#fireLoop.active ||
      this.#activeSourceCount >= this.#activeSources.length
    ) {
      return false
    }
    const source = createSource(context, profile, true)
    const voiceGain = context.createGain()
    const now = context.currentTime
    const attackEnd = now + profile.attackMilliseconds / 1_000
    const decayEnd = attackEnd + profile.decayMilliseconds / 1_000
    const peakGain = Math.max(0, gain)
    const sustainGain = peakGain * profile.sustainLevel
    voiceGain.gain.setValueAtTime(0, now)
    voiceGain.gain.linearRampToValueAtTime(peakGain, attackEnd)
    if (profile.decayMilliseconds > 0) {
      voiceGain.gain.linearRampToValueAtTime(sustainGain, decayEnd)
    } else {
      voiceGain.gain.setValueAtTime(sustainGain, attackEnd)
    }
    connectSource(context, source, profile, voiceGain, now, decayEnd)
    voiceGain.connect(master)
    this.#fireLoop.active = true
    this.#fireLoop.stopping = false
    this.#fireLoop.source = source
    this.#fireLoop.envelope = voiceGain
    this.#fireLoop.releaseMilliseconds = profile.releaseMilliseconds
    this.#trackSource(source)
    source.start()
    return true
  }

  stopLoop(cue: M5AudioCue): void {
    const loop = this.#fireLoop
    if (cue !== FIRE_LOOP_CUE || !loop.active || loop.stopping) return
    const source = loop.source
    const envelope = loop.envelope
    if (source === null || envelope === null) {
      this.#clearFireLoop()
      return
    }
    const context = this.#context
    if (context === null || context.state === 'closed') {
      this.#removeSource(source)
      this.#clearFireLoop()
      return
    }
    const now = context.currentTime
    const stopAt = now + loop.releaseMilliseconds / 1_000
    loop.stopping = true
    const gain = envelope.gain
    if (typeof gain.cancelAndHoldAtTime === 'function') {
      gain.cancelAndHoldAtTime(now)
    } else {
      const heldGain = Math.max(0, gain.value)
      gain.cancelScheduledValues?.(now)
      gain.setValueAtTime(heldGain, now)
    }
    gain.linearRampToValueAtTime(0, stopAt)
    try {
      source.stop(stopAt)
    } catch {
      this.#removeSource(source)
      this.#clearFireLoop()
    }
  }

  setMasterGain(gain: number): void {
    this.#masterGain = clampUnit(gain)
    if (this.#context !== null && this.#master !== null) {
      this.#master.gain.setValueAtTime(
        this.#masterGain,
        this.#context.currentTime,
      )
    }
  }

  stopAll(): void {
    for (let index = 0; index < this.#activeSources.length; index += 1) {
      const source = this.#activeSources[index]
      if (source === null) continue
      try {
        source.stop()
      } catch {
        // The source may already have ended between snapshot and cleanup.
      }
      this.#activeSources[index] = null
    }
    this.#activeSourceCount = 0
    this.#clearFireLoop()
  }

  getActiveVoiceCount(): number {
    return this.#activeSourceCount
  }

  getRuntimeStorageGrowthCount(): number {
    return 0
  }

  async close(): Promise<void> {
    this.stopAll()
    if (this.#context !== null && this.#context.state !== 'closed') {
      await this.#context.close()
    }
    this.#context = null
    this.#master = null
  }

  #trackSource(source: AudioSource): void {
    let availableIndex = -1
    for (let index = 0; index < this.#activeSources.length; index += 1) {
      if (this.#activeSources[index] !== null) continue
      availableIndex = index
      break
    }
    if (availableIndex < 0) {
      throw new Error('M5_AUDIO_BACKEND_VOICE_STORAGE_EXHAUSTED')
    }
    this.#activeSources[availableIndex] = source
    this.#activeSourceCount += 1
    source.addEventListener(
      'ended',
      this.#sourceEndedListener,
      ONCE_EVENT_LISTENER_OPTIONS,
    )
  }

  #onSourceEnded(event: Event): void {
    let source = event.currentTarget as AudioSource | null
    if (source === null && this.#activeSourceCount === 1) {
      for (let index = 0; index < this.#activeSources.length; index += 1) {
        const activeSource = this.#activeSources[index]
        if (activeSource !== null) {
          source = activeSource
          break
        }
      }
    }
    if (source === null) return
    this.#removeSource(source)
    if (this.#fireLoop.source === source) this.#clearFireLoop()
  }

  #removeSource(source: AudioSource): void {
    for (let index = 0; index < this.#activeSources.length; index += 1) {
      if (this.#activeSources[index] !== source) continue
      this.#activeSources[index] = null
      this.#activeSourceCount -= 1
      return
    }
  }

  #clearFireLoop(): void {
    this.#fireLoop.active = false
    this.#fireLoop.stopping = false
    this.#fireLoop.source = null
    this.#fireLoop.envelope = null
    this.#fireLoop.releaseMilliseconds = 0
  }
}

export class SilentM5AudioBackend implements M5AudioBackend {
  async unlock(): Promise<void> {}

  playOneShot(): boolean {
    return false
  }

  startLoop(): boolean {
    return false
  }

  stopLoop(): void {}

  setMasterGain(): void {}

  stopAll(): void {}

  getActiveVoiceCount(): number {
    return 0
  }

  getRuntimeStorageGrowthCount(): number {
    return 0
  }
}

export function createBrowserM5AudioBackend(
  window: Readonly<{
    AudioContext?: new (contextOptions?: AudioContextOptions) => AudioContext
  }>,
  maxVoices: number,
): M5AudioBackend {
  const AudioContextConstructor = window.AudioContext
  if (AudioContextConstructor === undefined) return new SilentM5AudioBackend()
  return new WebAudioM5Backend(() => new AudioContextConstructor(), maxVoices)
}
