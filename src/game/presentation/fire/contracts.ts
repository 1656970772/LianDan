export type FirePresentationVector = Readonly<{ x: number; y: number }>

export type FirePresentationSource = Readonly<{
  position: FirePresentationVector
  direction: FirePresentationVector
  width: number
}>

export type FireOcclusionRect = Readonly<{
  x: number
  y: number
  width: number
  height: number
  obstacleValue?: number
}>
