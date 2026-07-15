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
    canFinish: false,
    paused: false,
    restartConfirmation: 'closed',
    inventory: [
      {
        batchId: 'prototype-herb-batch',
        materialDefinitionId: 'prototype-herb',
        nameZh: '青岚草',
        servings: 1,
        imagePath: '/assets/materials/prototype-herb.png',
      },
    ],
    selectedMaterialBatchId: null,
    materialRemaining: 1,
    activePearlCount: 0,
    caughtPearlCount: 0,
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
          },
        ],
      }),
    )

    expect(view.addMaterialDisabled).toBe(true)
    expect(view.cancelSelectionDisabled).toBe(true)
  })
})
