import { computeSimulationContentFingerprint } from './fingerprint'
import type { NormalizedM2PresentationConfig } from './m2-gameplay-model'

export async function computeM2PresentationContentFingerprint(
  presentation: NormalizedM2PresentationConfig,
): Promise<string> {
  const result = await computeSimulationContentFingerprint({
    jsonRecords: [
      {
        recordType: 'presentation-json',
        logicalKey: 'm2-presentation:global',
        value: presentation,
      },
    ],
    rgbaRecords: [],
  })
  return result.simulationContentFingerprint
}
