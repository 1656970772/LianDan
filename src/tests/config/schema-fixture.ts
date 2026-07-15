import { readFileSync } from 'node:fs'

import type { ConfigSchemaBundle } from '../../config/model'
import type { M2GameplaySchemaBundle } from '../../config/m2-gameplay-model'

function readSchema(fileName: string): Record<string, unknown> {
  const url = new URL(`../../../schemas/config/${fileName}`, import.meta.url)
  return JSON.parse(readFileSync(url, 'utf8')) as Record<string, unknown>
}

export function loadM2GameplayTestSchemaBundle(): M2GameplaySchemaBundle {
  return {
    manifest: readSchema('m2-config-set.schema.json'),
    prototype: readSchema('m2-prototype.schema.json'),
    fireSources: readSchema('m2-fire-sources.schema.json'),
    pearlTypes: readSchema('m2-pearl-types.schema.json'),
    collector: readSchema('m2-collector.schema.json'),
    interactions: readSchema('m2-interactions.schema.json'),
  }
}

export function loadTestSchemaBundle(): ConfigSchemaBundle {
  return {
    configSet: readSchema('config-set.schema.json'),
    parameters: readSchema('parameters.schema.json'),
    material: readSchema('material.schema.json'),
    tags: readSchema('tags.schema.json'),
  }
}
