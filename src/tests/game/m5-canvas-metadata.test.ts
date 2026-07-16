import { describe, expect, it } from 'vitest'

import {
  deleteChangedCanvasDataset,
  shouldPublishM5CanvasMetadata,
  setChangedCanvasDataset,
} from '../../game/extraction/m5-canvas-metadata.ts'

describe('M5 canvas 元数据发布', () => {
  it('只写入变化值，并只删除实际存在的键', () => {
    const dataset: Record<string, string | undefined> = {}

    expect(setChangedCanvasDataset(dataset, 'tick', '1')).toBe(true)
    expect(setChangedCanvasDataset(dataset, 'tick', '1')).toBe(false)
    expect(setChangedCanvasDataset(dataset, 'tick', '2')).toBe(true)
    expect(deleteChangedCanvasDataset(dataset, 'missing')).toBe(false)
    expect(deleteChangedCanvasDataset(dataset, 'tick')).toBe(true)
    expect(deleteChangedCanvasDataset(dataset, 'tick')).toBe(false)
    expect(dataset).toEqual({})
  })

  it('120ms 内保持最终一致，但停火确认与表现边界强制同步', () => {
    expect(
      shouldPublishM5CanvasMetadata({
        elapsedMilliseconds: 119,
        hasCommittedEvents: false,
        hasPresentationEvents: false,
        reachedRequestedSprayingState: false,
      }),
    ).toBe(false)
    expect(
      shouldPublishM5CanvasMetadata({
        elapsedMilliseconds: 1,
        hasCommittedEvents: false,
        hasPresentationEvents: false,
        reachedRequestedSprayingState: true,
      }),
    ).toBe(true)
    expect(
      shouldPublishM5CanvasMetadata({
        elapsedMilliseconds: 1,
        hasCommittedEvents: false,
        hasPresentationEvents: true,
        reachedRequestedSprayingState: false,
      }),
    ).toBe(true)
  })
})
