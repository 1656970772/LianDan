import type {
  ApplicationControlDraft,
  LifecycleSnapshot,
} from '../../application/index.ts'
import {
  adjustFireSizeFromWheel,
  clampDirectionToCone,
  clientPointToLogical,
  resolveContainerAxis,
  type InputVector2,
} from './input-geometry.ts'

export type M2FireInputConstraint = Readonly<{
  origin: InputVector2
  centerDirection: InputVector2
  halfAngleDegrees: number
}>

export type M2InputRouterOptions = Readonly<{
  stage: HTMLElement
  coordinateSurface: HTMLElement
  logicalWidth: number
  logicalHeight: number
  fireSizeWheelStep: number
  getFireConstraint: () => M2FireInputConstraint | null
  getFireSize: () => number
  canStartSpraying: () => boolean
  onFireDirection: (direction: InputVector2) => void
  onSpraying: (spraying: boolean) => void
  onFireSize: (size: number) => void
  onContainerAxis: (axis: number) => void
  onControl: (control: ApplicationControlDraft) => void
}>

export type M2InputRouterHandle = Readonly<{
  destroy(): void
}>

function lifecycleSnapshot(document: Document): LifecycleSnapshot {
  return {
    hasFocus: document.hasFocus(),
    visibilityState: document.visibilityState === 'hidden' ? 'hidden' : 'visible',
  }
}

function eventUsesUi(event: Event): boolean {
  return event.composedPath().some(
    (target) =>
      target instanceof HTMLElement && target.closest('[data-ui-interactive]') !== null,
  )
}

function keyboardTargetUsesTextInput(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return (
    target.isContentEditable ||
    target.closest('input, textarea, select, button, [role="dialog"]') !== null
  )
}

export function createM2InputRouter(
  options: M2InputRouterOptions,
): M2InputRouterHandle {
  const document = options.stage.ownerDocument
  const window = document.defaultView
  if (window === null) throw new Error('M2_INPUT_WINDOW_UNAVAILABLE')

  let activePointerId: number | null = null
  let leftPressed = false
  let rightPressed = false
  let lastAxis = 0

  const updateContainerAxis = (): void => {
    const axis = resolveContainerAxis(leftPressed, rightPressed)
    if (axis === lastAxis) return
    lastAxis = axis
    options.onContainerAxis(axis)
  }

  const clearHeldInput = (): void => {
    if (activePointerId !== null) {
      activePointerId = null
      options.onSpraying(false)
    }
    if (leftPressed || rightPressed || lastAxis !== 0) {
      leftPressed = false
      rightPressed = false
      updateContainerAxis()
    }
  }

  const pointFallsWithinCoordinateSurface = (
    event: Pick<MouseEvent, 'clientX' | 'clientY'>,
  ): boolean => {
    const bounds = options.coordinateSurface.getBoundingClientRect()
    return (
      Number.isFinite(bounds.left) &&
      Number.isFinite(bounds.top) &&
      Number.isFinite(bounds.width) &&
      Number.isFinite(bounds.height) &&
      bounds.width > 0 &&
      bounds.height > 0 &&
      event.clientX >= bounds.left &&
      event.clientX <= bounds.right &&
      event.clientY >= bounds.top &&
      event.clientY <= bounds.bottom
    )
  }

  const updateDirection = (event: PointerEvent): boolean => {
    const constraint = options.getFireConstraint()
    if (constraint === null || !pointFallsWithinCoordinateSurface(event)) {
      return false
    }
    const point = clientPointToLogical(
      event.clientX,
      event.clientY,
      options.coordinateSurface.getBoundingClientRect(),
      options.logicalWidth,
      options.logicalHeight,
    )
    options.onFireDirection(
      clampDirectionToCone(
        constraint.origin,
        point,
        constraint.centerDirection,
        constraint.halfAngleDegrees,
      ),
    )
    return true
  }

  const onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || eventUsesUi(event)) return
    if (!updateDirection(event)) return
    event.preventDefault()
    if (!options.canStartSpraying()) return
    activePointerId = event.pointerId
    options.stage.setPointerCapture?.(event.pointerId)
    options.onSpraying(true)
  }

  const onPointerMove = (event: PointerEvent): void => {
    if (eventUsesUi(event)) return
    updateDirection(event)
  }

  const stopPointer = (event: PointerEvent): void => {
    if (activePointerId === null || event.pointerId !== activePointerId) return
    activePointerId = null
    options.onSpraying(false)
  }

  const onWheel = (event: WheelEvent): void => {
    if (eventUsesUi(event) || !pointFallsWithinCoordinateSurface(event)) return
    event.preventDefault()
    options.onFireSize(
      adjustFireSizeFromWheel(
        options.getFireSize(),
        event.deltaY,
        options.fireSizeWheelStep,
      ),
    )
  }

  const onContextMenu = (event: MouseEvent): void => {
    if (!eventUsesUi(event) && pointFallsWithinCoordinateSurface(event)) {
      event.preventDefault()
    }
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.defaultPrevented || keyboardTargetUsesTextInput(event.target)) return
    if (event.code === 'KeyA') leftPressed = true
    else if (event.code === 'KeyD') rightPressed = true
    else return
    event.preventDefault()
    updateContainerAxis()
  }

  const onKeyUp = (event: KeyboardEvent): void => {
    if (event.code === 'KeyA') leftPressed = false
    else if (event.code === 'KeyD') rightPressed = false
    else return
    updateContainerAxis()
  }

  const onBlur = (): void => {
    clearHeldInput()
    options.onControl({
      type: 'WindowBlur',
      payload: { lifecycleSnapshot: lifecycleSnapshot(document) },
    })
  }

  const onFocus = (): void => {
    options.onControl({
      type: 'WindowFocus',
      payload: { lifecycleSnapshot: lifecycleSnapshot(document) },
    })
  }

  const onVisibilityChanged = (): void => {
    if (document.visibilityState === 'hidden') clearHeldInput()
    options.onControl({
      type: 'VisibilityChanged',
      payload: { lifecycleSnapshot: lifecycleSnapshot(document) },
    })
  }

  options.stage.addEventListener('pointerdown', onPointerDown)
  options.stage.addEventListener('pointermove', onPointerMove)
  options.stage.addEventListener('lostpointercapture', stopPointer)
  options.stage.addEventListener('wheel', onWheel, { passive: false })
  options.stage.addEventListener('contextmenu', onContextMenu)
  window.addEventListener('pointerup', stopPointer)
  window.addEventListener('pointercancel', stopPointer)
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  window.addEventListener('blur', onBlur)
  window.addEventListener('focus', onFocus)
  document.addEventListener('visibilitychange', onVisibilityChanged)

  const initialLifecycleSnapshot = lifecycleSnapshot(document)
  if (
    !initialLifecycleSnapshot.hasFocus ||
    initialLifecycleSnapshot.visibilityState === 'hidden'
  ) {
    options.onControl({
      type:
        initialLifecycleSnapshot.visibilityState === 'hidden'
          ? 'VisibilityChanged'
          : 'WindowBlur',
      payload: { lifecycleSnapshot: initialLifecycleSnapshot },
    })
  }

  let destroyed = false
  return {
    destroy: () => {
      if (destroyed) return
      destroyed = true
      clearHeldInput()
      options.stage.removeEventListener('pointerdown', onPointerDown)
      options.stage.removeEventListener('pointermove', onPointerMove)
      options.stage.removeEventListener('lostpointercapture', stopPointer)
      options.stage.removeEventListener('wheel', onWheel)
      options.stage.removeEventListener('contextmenu', onContextMenu)
      window.removeEventListener('pointerup', stopPointer)
      window.removeEventListener('pointercancel', stopPointer)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibilityChanged)
    },
  }
}
