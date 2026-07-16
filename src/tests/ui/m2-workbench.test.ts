import { readFileSync } from 'node:fs'

import { describe, expect, test } from 'vitest'

import {
  deriveM2WorkbenchView,
  type M2WorkbenchModel,
} from '../../ui/createM2Workbench.ts'

function createModel(
  overrides: Partial<M2WorkbenchModel> = {},
): M2WorkbenchModel {
  return {
    sessionId: 'session-1',
    status: 'ready',
    tick: 0,
    fireSources: [
      {
        id: 'common-flame',
        nameZh: '凡火',
        descriptionZh: '稳定、易控制的基础火种。',
      },
    ],
    equippedFireSourceId: null,
    fireSize: 40,
    fireSizeRange: { min: 10, max: 90 },
    isSpraying: false,
    furnaceTemperature: 8,
    furnaceTemperatureRange: { min: 8, max: 120 },
    furnaceTemperatureThresholds: { warmRatio: 0.25, blazingRatio: 0.75 },
    furnaceTemperatureTrend: 'steady',
    flameThrustEnabled: false,
    audioVolume: 0.65,
    audioMuted: false,
    canFinish: false,
    lossWarningLevel: 0,
    caughtVolumes: { medicinalLiquid: 0, slag: 0, impurity: 0 },
    normalSlagQuantity: 0,
    failureResult: null,
    failureInvestedMaterials: [],
    failurePresentationComplete: false,
    paused: false,
    restartConfirmation: 'closed',
    inventory: [
      {
        batchId: 'prototype-herb-batch',
        materialDefinitionId: 'prototype-herb',
        nameZh: '青岚草',
        servings: 1,
        imagePath: '/assets/materials/prototype-herb.png',
        stateSummaryZh: '新鲜 · 野生 · 三年',
        tags: [],
      },
    ],
    selectedMaterialBatchId: null,
    materialRemaining: 1,
    activePearlCount: 0,
    caughtPearlCount: 0,
    interactionCount: 0,
    debug: {
      simulationContentFingerprint: 'a'.repeat(64),
      presentationContentFingerprint: 'b'.repeat(64),
      flowGeneration: 0,
      pauseReasons: [],
      firePresentationState: 'off',
      fireVisualIntensity: 0,
      failurePresentationState: 'idle',
      failurePresentationProgress: 0,
      audioVoiceCount: 0,
      effectPoolActive: 0,
    },
    ...overrides,
  }
}

describe('M2 玩家工作台视图派生', () => {
  test('初始 ready 帧等待玩家选择火种，不假装已装备', () => {
    const view = deriveM2WorkbenchView(createModel())

    expect(view).toMatchObject({
      statusLabel: '待投药',
      pauseAction: 'pause',
      pauseLabel: '暂停',
      controlsDisabled: false,
      fireSourceLocked: false,
      addMaterialDisabled: true,
      cancelSelectionDisabled: true,
      finishDisabled: true,
      restartDialogOpen: false,
      completionDialogOpen: false,
      liveMessage: '请先选择火种。',
    })
  })

  test('已装备火种后锁定选择，canFinish 真时开放结束操作', () => {
    const view = deriveM2WorkbenchView(
      createModel({
        status: 'extracting',
        tick: 42,
        equippedFireSourceId: 'common-flame',
        isSpraying: true,
        canFinish: true,
        selectedMaterialBatchId: 'prototype-herb-batch',
        materialRemaining: 0,
        activePearlCount: 0,
        caughtPearlCount: 3,
      }),
    )

    expect(view.statusLabel).toBe('萃取中')
    expect(view.fireSourceLocked).toBe(true)
    expect(view.fireInstruction).toContain('正在喷火')
    expect(view.addMaterialDisabled).toBe(false)
    expect(view.cancelSelectionDisabled).toBe(false)
    expect(view.finishDisabled).toBe(false)
    expect(view.liveMessage).toBe('材料与精灵珠已全部结算，可以结束本炉。')
  })

  test.each([
    [-10, 0, '余温稳定'],
    [8, 0, '余温稳定'],
    [36, 0.25, '温火稳定'],
    [92, 0.75, '炽盛稳定'],
    [120, 1, '炽盛稳定'],
    [130, 1, '炽盛稳定'],
  ] as const)(
    '非零基温/非100上限下，炉温 %s 派生为强度 %s 与状态 %s',
    (furnaceTemperature, intensity, statusLabel) => {
      const view = deriveM2WorkbenchView(createModel({ furnaceTemperature }))

      expect(view.normalizedTemperatureIntensity).toBeCloseTo(intensity)
      expect(view.temperatureStatusLabel).toBe(statusLabel)
      expect(view.temperatureStatusLabel).not.toMatch(/\d|℃|°|摄氏/)
    },
  )

  test.each([
    ['heating', '温升'],
    ['cooling', '回落'],
    ['steady', '温火稳定'],
  ] as const)('同一中等火候按 %s 趋势显示 %s', (trend, expected) => {
    const view = deriveM2WorkbenchView(
      createModel({
        furnaceTemperature: 64,
        furnaceTemperatureTrend: trend,
      }),
    )

    expect(view.temperatureStatusLabel).toBe(expected)
    expect(view.temperatureTrend).toBe(trend)
    expect(view.temperatureLevel).toBe('warm')
  })

  test('暂停与重开确认关闭规则控件，但保留恢复操作', () => {
    const view = deriveM2WorkbenchView(
      createModel({
        status: 'extracting',
        paused: true,
        restartConfirmation: 'open',
        selectedMaterialBatchId: 'prototype-herb-batch',
      }),
    )

    expect(view).toMatchObject({
      pauseAction: 'resume',
      pauseLabel: '继续',
      pauseDisabled: false,
      controlsDisabled: true,
      addMaterialDisabled: true,
      finishDisabled: true,
      restartDialogOpen: true,
      completionDialogOpen: false,
      liveMessage: '已暂停，等待确认是否重开。',
    })
  })

  test('completed 终态只开放再来一炉', () => {
    const view = deriveM2WorkbenchView(
      createModel({
        status: 'completed',
        tick: 81,
        equippedFireSourceId: 'common-flame',
        canFinish: false,
        materialRemaining: 0,
        caughtPearlCount: 5,
      }),
    )

    expect(view).toMatchObject({
      statusLabel: '已完成',
      controlsDisabled: true,
      pauseDisabled: true,
      restartDisabled: true,
      finishDisabled: true,
      restartDialogOpen: false,
      completionDialogOpen: true,
      liveMessage: '本炉萃取完成，可以再来一炉。',
    })
  })

  test('已选批次耗尽后不再保留可投入状态', () => {
    const view = deriveM2WorkbenchView(
      createModel({
        status: 'extracting',
        equippedFireSourceId: 'common-flame',
        selectedMaterialBatchId: 'prototype-herb-batch',
        inventory: [
          {
            batchId: 'prototype-herb-batch',
            materialDefinitionId: 'prototype-herb',
            nameZh: '青岚草',
            servings: 0,
            stateSummaryZh: '新鲜 · 野生 · 三年',
            tags: [],
          },
        ],
      }),
    )

    expect(view.addMaterialDisabled).toBe(true)
    expect(view.cancelSelectionDisabled).toBe(true)
  })

  test('M3 两级损耗提示不暴露百分比，失败演出完成后才开放结算面板', () => {
    const warning = deriveM2WorkbenchView(
      createModel({ status: 'extracting', lossWarningLevel: 1 }),
    )
    expect(warning.lossWarningMessage).toBe('药气正在加速流失。')
    expect(warning.lossWarningMessage).not.toMatch(/\d|%/)

    const presentingFailure = deriveM2WorkbenchView(
      createModel({
        status: 'failed',
        lossWarningLevel: 2,
        failureResult: {
          reason: 'excessiveMedicinalLoss',
          remainingEntityVolume: 4,
          slagQuantity: 1,
        },
      }),
    )
    expect(presentingFailure).toMatchObject({
      controlsDisabled: true,
      failureDialogOpen: false,
      completionDialogOpen: false,
      liveMessage: '药性正在化渣，请稍候。',
    })

    const settledFailure = deriveM2WorkbenchView(
      createModel({
        status: 'failed',
        failurePresentationComplete: true,
        lossWarningLevel: 2,
        failureInvestedMaterials: ['青岚草'],
        failureResult: {
          reason: 'excessiveMedicinalLoss',
          remainingEntityVolume: 4,
          slagQuantity: 1,
        },
      }),
    )
    expect(settledFailure).toMatchObject({
      controlsDisabled: true,
      failureDialogOpen: true,
      completionDialogOpen: false,
      lossWarningMessage: '药性濒临溃散，尽快收束火势。',
      liveMessage: '本炉萃取失败。',
      failureResultLabel: '药渣 × 1',
      failureResultTip:
        '药渣；失败原因：药液流失过多；投入材料：青岚草；药渣 × 1',
    })
  })

  test('失败结果提供完整的可访问 Tips 文本与旁置非模态布局契约', () => {
    const view = deriveM2WorkbenchView(
      createModel({
        status: 'failed',
        failurePresentationComplete: true,
        failureInvestedMaterials: ['赤须参', '寒髓晶', '赤须参'],
        failureResult: {
          reason: 'excessiveMedicinalLoss',
          remainingEntityVolume: 8,
          slagQuantity: 2,
        },
      }),
    )

    expect(view.failureResultLabel).toBe('药渣 × 2')
    expect(view.failureResultTip).toBe(
      '药渣；失败原因：药液流失过多；投入材料：赤须参、寒髓晶；药渣 × 2',
    )

    const source = readFileSync(
      new URL('../../ui/createM2Workbench.ts', import.meta.url),
      'utf8',
    )
    expect(source).toContain("failureResult.dataset.failureResult = ''")
    expect(source).toContain("failureResult.setAttribute('tabindex', '0')")
    expect(source).toContain("failureResult.setAttribute('aria-describedby'")
    expect(source).toContain("failureResultTip.setAttribute('role', 'tooltip')")
    expect(source).not.toContain("failureDialog.setAttribute('aria-modal', 'true')")
  })

  test('炉温条保留 progressbar 与独立 data 契约，不把内部值显示成摄氏度', () => {
    const source = readFileSync(
      new URL('../../ui/createM2Workbench.ts', import.meta.url),
      'utf8',
    )

    expect(source).toMatch(/setAttribute\('role', 'progressbar'\)/)
    expect(source).toMatch(/setAttribute\('aria-valuemin', '0'\)/)
    expect(source).toMatch(/setAttribute\('aria-valuemax', '100'\)/)
    expect(source).toContain("setAttribute('aria-valuenow'")
    expect(source).toContain('dataset.furnaceTemperature')
    expect(source).toContain('dataset.temperatureIntensity')
    expect(source).not.toMatch(/炉温[^\n]*(?:℃|摄氏|°C)/)
  })

  test('总音量与静音控件保留可访问标签和独立回调契约', () => {
    const source = readFileSync(
      new URL('../../ui/createM2Workbench.ts', import.meta.url),
      'utf8',
    )

    expect(source).toContain("audioVolumeInput.dataset.audioVolume = ''")
    expect(source).toContain("audioMutedInput.dataset.audioMuted = ''")
    expect(source).toContain("audioVolumeInput.setAttribute('aria-valuetext'")
    expect(source).toContain('options.onAudioVolumeChange')
    expect(source).toContain('options.onAudioMutedChange')
  })

  test('技术状态收进默认折叠的 M5 调试面板，不占据主标题', () => {
    const source = readFileSync(
      new URL('../../ui/createM2Workbench.ts', import.meta.url),
      'utf8',
    )

    expect(source).toContain("createElement(document, 'details', 'm5-debug')")
    expect(source).toContain("debugSummary.textContent = '调试信息'")
    expect(source).toContain('model.debug.presentationContentFingerprint')
    expect(source).toContain('model.debug.firePresentationState')
    expect(source).not.toContain('sessionMeta.textContent = `炉次 ${model.sessionId} / Tick ${model.tick}`')
  })
})
