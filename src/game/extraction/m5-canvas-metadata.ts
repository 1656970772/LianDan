export type M5CanvasDataset = {
  [key: string]: string | undefined
}

export const M5_CANVAS_METADATA_INTERVAL_MILLISECONDS = 120

export type M5CanvasMetadataProjectionInput = Readonly<{
  elapsedMilliseconds: number
  hasCommittedEvents: boolean
  hasPresentationEvents: boolean
  reachedRequestedSprayingState: boolean
}>

/**
 * Canvas metadata is an eventually-consistent debug/test projection. Routine
 * state is throttled, while committed events, presentation boundaries, and an
 * acknowledged fire-state request force the authoritative final value out in
 * the same update.
 */
export function shouldPublishM5CanvasMetadata(
  input: M5CanvasMetadataProjectionInput,
): boolean {
  return (
    input.elapsedMilliseconds >= M5_CANVAS_METADATA_INTERVAL_MILLISECONDS ||
    input.hasCommittedEvents ||
    input.hasPresentationEvents ||
    input.reachedRequestedSprayingState
  )
}

export function setChangedCanvasDataset(
  dataset: M5CanvasDataset,
  key: string,
  value: string,
): boolean {
  if (dataset[key] === value) return false
  dataset[key] = value
  return true
}

export function deleteChangedCanvasDataset(
  dataset: M5CanvasDataset,
  key: string,
): boolean {
  if (dataset[key] === undefined) return false
  delete dataset[key]
  return true
}
