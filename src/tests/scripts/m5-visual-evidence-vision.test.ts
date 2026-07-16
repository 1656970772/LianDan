import type { Page } from '@playwright/test'
import { describe, expect, test, vi } from 'vitest'

import {
  assertM5VisualVisionTransformPrepared,
  prepareM5VisualVisionTransform,
  type M5VisionTransformPreparedToken,
} from '../../../scripts/m5-visual-evidence-vision.ts'

const identityMatrix = Object.freeze([
  1, 0, 0, 0, 0,
  0, 1, 0, 0, 0,
  0, 0, 1, 0, 0,
  0, 0, 0, 1, 0,
])

function fakePage(): Page {
  return {
    evaluate: vi.fn(async () => true),
  } as unknown as Page
}

describe('M5 视觉变换 opaque preparation token', () => {
  test('token 同时绑定 Page、mode、matrix identity 与准备时内容', async () => {
    const page = fakePage()
    const matrix = [...identityMatrix]
    const token = await prepareM5VisualVisionTransform(page, 'normal', matrix)

    expect(() =>
      assertM5VisualVisionTransformPrepared({
        token,
        page,
        visionMode: 'normal',
        colorMatrix: matrix,
      }),
    ).not.toThrow()
    expect(() =>
      assertM5VisualVisionTransformPrepared({
        token,
        page: fakePage(),
        visionMode: 'normal',
        colorMatrix: matrix,
      }),
    ).toThrow('M5_VISUAL_EVIDENCE_TRANSIENT_VISION_TRANSFORM_NOT_PREPARED')
    expect(() =>
      assertM5VisualVisionTransformPrepared({
        token,
        page,
        visionMode: 'grayscale',
        colorMatrix: matrix,
      }),
    ).toThrow('M5_VISUAL_EVIDENCE_TRANSIENT_VISION_TRANSFORM_NOT_PREPARED')
    expect(() =>
      assertM5VisualVisionTransformPrepared({
        token,
        page,
        visionMode: 'normal',
        colorMatrix: [...matrix],
      }),
    ).toThrow('M5_VISUAL_EVIDENCE_TRANSIENT_VISION_TRANSFORM_NOT_PREPARED')

    matrix[0] = 0.5
    expect(() =>
      assertM5VisualVisionTransformPrepared({
        token,
        page,
        visionMode: 'normal',
        colorMatrix: matrix,
      }),
    ).toThrow('M5_VISUAL_EVIDENCE_TRANSIENT_VISION_TRANSFORM_NOT_PREPARED')
  })

  test('普通 literal 即使强转成 token 也无法通过运行时 brand registry', () => {
    expect(() =>
      assertM5VisualVisionTransformPrepared({
        token: {} as M5VisionTransformPreparedToken,
        page: fakePage(),
        visionMode: 'normal',
        colorMatrix: identityMatrix,
      }),
    ).toThrow('M5_VISUAL_EVIDENCE_TRANSIENT_VISION_TRANSFORM_NOT_PREPARED')
  })

  test('拒绝非 20 项或非有限数 matrix，避免 token 绑定模糊内容', async () => {
    await expect(
      prepareM5VisualVisionTransform(fakePage(), 'normal', [1, 0]),
    ).rejects.toThrow('M5_VISUAL_EVIDENCE_VISION_COLOR_MATRIX_INVALID')
    await expect(
      prepareM5VisualVisionTransform(fakePage(), 'normal', [
        ...identityMatrix.slice(0, -1),
        Number.NaN,
      ]),
    ).rejects.toThrow('M5_VISUAL_EVIDENCE_VISION_COLOR_MATRIX_INVALID')
  })
})
