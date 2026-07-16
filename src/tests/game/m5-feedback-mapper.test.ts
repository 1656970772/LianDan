import { describe, expect, it } from 'vitest'

import type { DomainEvent } from '../../domain/index.ts'
import { mapM5DomainEvent } from '../../game/extraction/m5-feedback-mapper.ts'

function event(value: DomainEvent): DomainEvent {
  return value
}

describe('M5 领域事件到表现反馈映射', () => {
  it('接珠、护盾、受伤与争斗使用不同的语义反馈', () => {
    expect(
      mapM5DomainEvent(
        event({ type: 'PearlCaught', tick: 3, pearlId: 'pearl-1' }),
      ),
    ).toEqual([
      {
        effect: 'caught',
        anchor: { kind: 'collector' },
        audioCue: 'pearlCaught',
        cameraCue: 'normalCatch',
      },
    ])

    expect(
      mapM5DomainEvent(
        event({ type: 'PearlShieldActivated', tick: 4, pearlId: 'pearl-2' }),
      ),
    ).toEqual([
      {
        effect: 'shield',
        anchor: { kind: 'pearl', pearlId: 'pearl-2' },
        audioCue: 'pearlShield',
      },
      {
        effect: 'steam',
        anchor: { kind: 'pearl', pearlId: 'pearl-2' },
      },
    ])

    expect(
      mapM5DomainEvent(
        event({
          type: 'PearlDamaged',
          tick: 5,
          pearlId: 'pearl-3',
          previousVolume: 2,
          currentVolume: 1.5,
        }),
      ),
    ).toEqual([
      {
        effect: 'damage',
        anchor: { kind: 'pearl', pearlId: 'pearl-3' },
        audioCue: 'pearlDamaged',
        cameraCue: 'damage',
      },
    ])

    expect(
      mapM5DomainEvent(
        event({
          type: 'PearlInteractionStarted',
          tick: 6,
          interactionId: 'fight-1',
          pearlAId: 'pearl-a',
          pearlBId: 'pearl-b',
        }),
      ),
    ).toEqual([
      {
        effect: 'fight',
        anchor: {
          kind: 'pearlPair',
          pearlAId: 'pearl-a',
          pearlBId: 'pearl-b',
        },
        audioCue: 'interaction',
        cameraCue: 'fight',
      },
    ])
  })

  it('两级警告只在升级时反馈，二级警告带更强镜头语义', () => {
    expect(
      mapM5DomainEvent(
        event({
          type: 'LossWarningChanged',
          tick: 10,
          previousLevel: 0,
          currentLevel: 1,
        }),
      ),
    ).toEqual([
      {
        effect: 'warningOne',
        anchor: { kind: 'viewport' },
        audioCue: 'warningOne',
      },
    ])
    expect(
      mapM5DomainEvent(
        event({
          type: 'LossWarningChanged',
          tick: 11,
          previousLevel: 1,
          currentLevel: 2,
        }),
      ),
    ).toEqual([
      {
        effect: 'warningTwo',
        anchor: { kind: 'viewport' },
        audioCue: 'warningTwo',
        cameraCue: 'warningTwo',
      },
    ])
    expect(
      mapM5DomainEvent(
        event({
          type: 'LossWarningChanged',
          tick: 12,
          previousLevel: 2,
          currentLevel: 1,
        }),
      ),
    ).toEqual([])
  })

  it('失败触发唯一的失败转化、声音和镜头反馈', () => {
    expect(
      mapM5DomainEvent(
        event({
          type: 'ExtractionFailed',
          tick: 20,
          result: {
            reason: 'excessiveMedicinalLoss',
            remainingEntityVolume: 4,
            slagQuantity: 1,
          },
        }),
      ),
    ).toEqual([
      {
        effect: 'failure',
        anchor: { kind: 'collector' },
        audioCue: 'failure',
        cameraCue: 'failure',
      },
    ])
  })

  it('出生、可结束和无表现需求的结算事件不虚构声音或镜头', () => {
    expect(
      mapM5DomainEvent(
        event({
          type: 'PearlBorn',
          tick: 1,
          pearlId: 'pearl-1',
          sourceMaterialDefinitionId: 'herb',
          sourceMaterialInstanceId: 'material-1',
          pearlType: 'medicinalLiquid',
          volume: 1,
        }),
      ),
    ).toEqual([
      {
        effect: 'birth',
        anchor: { kind: 'pearl', pearlId: 'pearl-1' },
      },
    ])
    expect(mapM5DomainEvent(event({ type: 'CanFinish', tick: 2 }))).toEqual([
      { effect: 'ready', anchor: { kind: 'collector' } },
    ])
    expect(
      mapM5DomainEvent(
        event({ type: 'PearlMissed', tick: 3, pearlId: 'pearl-1' }),
      ),
    ).toEqual([])
  })
})
