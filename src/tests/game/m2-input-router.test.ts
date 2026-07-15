import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createM2InputRouter } from '../../game/extraction/input-router.ts'

class FakeHtmlElement extends EventTarget {
  ownerDocument!: FakeDocument

  constructor(
    private readonly bounds = {
      left: 0,
      top: 0,
      width: 160,
      height: 90,
    },
  ) {
    super()
  }

  closest(): null {
    return null
  }

  getBoundingClientRect(): DOMRect {
    return {
      x: this.bounds.left,
      y: this.bounds.top,
      width: this.bounds.width,
      height: this.bounds.height,
      top: this.bounds.top,
      right: this.bounds.left + this.bounds.width,
      bottom: this.bounds.top + this.bounds.height,
      left: this.bounds.left,
      toJSON: () => ({}),
    }
  }

  setPointerCapture(): void {}
}

class FakeWindow extends EventTarget {}

class FakeDocument extends EventTarget {
  readonly defaultView = new FakeWindow()
  visibilityState: DocumentVisibilityState = 'visible'

  hasFocus(): boolean {
    return true
  }
}

function pointerEvent(
  type: string,
  pointerId = 7,
  clientX = 80,
  clientY = 45,
): Event {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.assign(event, {
    button: 0,
    pointerId,
    clientX,
    clientY,
  })
  return event
}

function createHarness(
  canStartSpraying = true,
  coordinateBounds = { left: 0, top: 0, width: 160, height: 90 },
) {
  const document = new FakeDocument()
  const stage = new FakeHtmlElement()
  const coordinateSurface = new FakeHtmlElement(coordinateBounds)
  stage.ownerDocument = document
  coordinateSurface.ownerDocument = document
  const spraying: boolean[] = []
  const controls: string[] = []
  const onFireDirection = vi.fn()
  const handle = createM2InputRouter({
    stage: stage as unknown as HTMLElement,
    coordinateSurface: coordinateSurface as unknown as HTMLElement,
    logicalWidth: 160,
    logicalHeight: 90,
    fireSizeWheelStep: 4,
    getFireConstraint: () => ({
      origin: { x: 0, y: 80 },
      centerDirection: { x: 0, y: -1 },
      halfAngleDegrees: 70,
    }),
    getFireSize: () => 30,
    canStartSpraying: () => canStartSpraying,
    onFireDirection,
    onSpraying: (value) => spraying.push(value),
    onFireSize: vi.fn(),
    onContainerAxis: vi.fn(),
    onControl: (control) => controls.push(control.type),
  })
  return {
    document,
    stage,
    coordinateSurface,
    window: document.defaultView,
    spraying,
    controls,
    onFireDirection,
    handle,
  }
}

const originalHTMLElement = globalThis.HTMLElement

beforeEach(() => {
  Object.defineProperty(globalThis, 'HTMLElement', {
    configurable: true,
    value: FakeHtmlElement,
  })
})

afterEach(() => {
  Object.defineProperty(globalThis, 'HTMLElement', {
    configurable: true,
    value: originalHTMLElement,
  })
})

describe('M2 输入路由喷火持有状态', () => {
  it('用实际 canvas 而不是外层 stage 映射非等宽 letterbox 坐标', () => {
    const harness = createHarness(true, {
      left: 20,
      top: 10,
      width: 120,
      height: 60,
    })

    harness.stage.dispatchEvent(pointerEvent('pointermove', 7, 20, 40))

    expect(harness.onFireDirection).toHaveBeenLastCalledWith({ x: 0, y: -1 })
    harness.handle.destroy()
  })

  it('拒绝从 canvas 外的 letterbox 空白区开始喷火', () => {
    const harness = createHarness(true, {
      left: 20,
      top: 10,
      width: 120,
      height: 60,
    })

    harness.stage.dispatchEvent(pointerEvent('pointerdown', 7, 10, 45))
    harness.window.dispatchEvent(pointerEvent('pointerup', 7, 10, 45))

    expect(harness.onFireDirection).not.toHaveBeenCalled()
    expect(harness.spraying).toEqual([])
    harness.handle.destroy()
  })

  it('canStartSpraying=false 时从不发送 true，也不建立待释放指针', () => {
    const harness = createHarness(false)

    harness.stage.dispatchEvent(pointerEvent('pointerdown'))
    harness.window.dispatchEvent(pointerEvent('pointerup'))

    expect(harness.spraying).toEqual([])
    harness.handle.destroy()
  })

  it.each([
    ['pointerup', 'window'],
    ['pointercancel', 'window'],
    ['lostpointercapture', 'stage'],
  ] as const)('%s 释放活动喷火指针', (eventType, target) => {
    const harness = createHarness()
    harness.stage.dispatchEvent(pointerEvent('pointerdown'))

    harness[target].dispatchEvent(pointerEvent(eventType))

    expect(harness.spraying).toEqual([true, false])
    harness.handle.destroy()
  })

  it('window blur 释放喷火并交给 control pump', () => {
    const harness = createHarness()
    harness.stage.dispatchEvent(pointerEvent('pointerdown'))

    harness.window.dispatchEvent(new Event('blur'))

    expect(harness.spraying).toEqual([true, false])
    expect(harness.controls).toEqual(['WindowBlur'])
    harness.handle.destroy()
  })

  it('页面 hidden 释放喷火并交给 control pump', () => {
    const harness = createHarness()
    harness.stage.dispatchEvent(pointerEvent('pointerdown'))
    harness.document.visibilityState = 'hidden'

    harness.document.dispatchEvent(new Event('visibilitychange'))

    expect(harness.spraying).toEqual([true, false])
    expect(harness.controls).toEqual(['VisibilityChanged'])
    harness.handle.destroy()
  })
})
