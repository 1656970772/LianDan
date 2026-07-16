import type { NormalizedM2PresentationConfig } from '../../config/index.ts'
import type {
  M5AudioConfig,
  M5AudioSynthesisProfile,
} from './m5-audio-director.ts'

function createProfile(
  profile: NormalizedM2PresentationConfig['audio']['profiles']['fireStart'],
  loop = false,
): M5AudioSynthesisProfile {
  const attackMilliseconds = profile.attackSeconds * 1_000
  const decayMilliseconds = profile.decaySeconds * 1_000
  const releaseMilliseconds = profile.releaseSeconds * 1_000
  return {
    generator: profile.kind,
    frequencyHz: profile.frequencyHz,
    frequencyEndHz: profile.frequencyHz,
    attackMilliseconds,
    decayMilliseconds,
    sustainLevel: profile.sustainLevel,
    releaseMilliseconds,
    durationMilliseconds: Math.max(
      1,
      attackMilliseconds +
        decayMilliseconds +
        releaseMilliseconds,
    ),
    gain: profile.gain,
    loop,
  }
}

/** 玩家场景与表现基准共用同一音色、voice 和事件合并参数。 */
export function createM5AudioConfigFromPresentation(
  presentation: NormalizedM2PresentationConfig,
): M5AudioConfig {
  const { audio } = presentation
  return {
    initialVolume: audio.defaultVolume,
    initiallyMuted: audio.initiallyMuted,
    mergeWindowMilliseconds: audio.mergeWindowMs,
    mergeGainPerDoubling: Math.max(0, Math.min(1, audio.mergeGain - 1)),
    maximumMergedGainScale: Math.max(1, audio.mergeGain),
    maxVoices: audio.maxVoices,
    profiles: {
      fireStart: createProfile(audio.profiles.fireStart),
      fireLoop: createProfile(audio.profiles.fireLoop, true),
      fireStop: createProfile(audio.profiles.fireStop),
      pearlCaught: createProfile(audio.profiles.pearlCaught),
      pearlShield: createProfile(audio.profiles.pearlShield),
      pearlDamaged: createProfile(audio.profiles.pearlDamaged),
      interaction: createProfile(audio.profiles.interaction),
      warningOne: createProfile(audio.profiles.warningOne),
      warningTwo: createProfile(audio.profiles.warningTwo),
      failure: createProfile(audio.profiles.failure),
    },
    mergeableCues: ['pearlShield'],
  }
}
