import type { DomainEvent } from '../../domain/index.ts'
import type { M5AudioCue } from './m5-audio-director.ts'

export type M5EffectKind =
  | 'birth'
  | 'caught'
  | 'shield'
  | 'steam'
  | 'damage'
  | 'fight'
  | 'warningOne'
  | 'warningTwo'
  | 'failure'
  | 'ready'

export type M5CameraCue =
  | 'normalCatch'
  | 'damage'
  | 'fight'
  | 'warningTwo'
  | 'failure'

export type M5EffectAnchor =
  | Readonly<{ kind: 'pearl'; pearlId: string }>
  | Readonly<{
      kind: 'pearlPair'
      pearlAId: string
      pearlBId: string
    }>
  | Readonly<{ kind: 'collector' }>
  | Readonly<{ kind: 'viewport' }>

export type M5FeedbackAction = Readonly<{
  effect: M5EffectKind
  anchor: M5EffectAnchor
  audioCue?: Exclude<M5AudioCue, 'fireLoop' | 'fireStart' | 'fireStop'>
  cameraCue?: M5CameraCue
}>

/**
 * Keeps the domain-to-presentation vocabulary explicit. Coordinates, timing,
 * intensity and pooling remain presentation concerns resolved by the scene.
 */
export function mapM5DomainEvent(
  event: DomainEvent,
): readonly M5FeedbackAction[] {
  switch (event.type) {
    case 'PearlBorn':
      return [
        {
          effect: 'birth',
          anchor: { kind: 'pearl', pearlId: event.pearlId },
        },
      ]
    case 'PearlCaught':
      return [
        {
          effect: 'caught',
          anchor: { kind: 'collector' },
          audioCue: 'pearlCaught',
          cameraCue: 'normalCatch',
        },
      ]
    case 'PearlShieldActivated':
      return [
        {
          effect: 'shield',
          anchor: { kind: 'pearl', pearlId: event.pearlId },
          audioCue: 'pearlShield',
        },
        {
          effect: 'steam',
          anchor: { kind: 'pearl', pearlId: event.pearlId },
        },
      ]
    case 'PearlDamaged':
    case 'PearlBurned':
      return [
        {
          effect: 'damage',
          anchor: { kind: 'pearl', pearlId: event.pearlId },
          audioCue: 'pearlDamaged',
          cameraCue: 'damage',
        },
      ]
    case 'PearlInteractionStarted':
      return [
        {
          effect: 'fight',
          anchor: {
            kind: 'pearlPair',
            pearlAId: event.pearlAId,
            pearlBId: event.pearlBId,
          },
          audioCue: 'interaction',
          cameraCue: 'fight',
        },
      ]
    case 'LossWarningChanged':
      if (event.currentLevel <= event.previousLevel) return []
      return event.currentLevel === 2
        ? [
            {
              effect: 'warningTwo',
              anchor: { kind: 'viewport' },
              audioCue: 'warningTwo',
              cameraCue: 'warningTwo',
            },
          ]
        : [
            {
              effect: 'warningOne',
              anchor: { kind: 'viewport' },
              audioCue: 'warningOne',
            },
          ]
    case 'ExtractionFailed':
      return [
        {
          effect: 'failure',
          anchor: { kind: 'collector' },
          audioCue: 'failure',
          cameraCue: 'failure',
        },
      ]
    case 'CanFinish':
      return [{ effect: 'ready', anchor: { kind: 'collector' } }]
    case 'MaterialAdded':
    case 'PearlMissed':
    case 'ExtractionCompleted':
      return []
  }
}
