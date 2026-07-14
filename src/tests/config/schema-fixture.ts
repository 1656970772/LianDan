import { readFileSync } from 'node:fs'

import type { ConfigSchemaBundle } from '../../config/model'

function readSchema(fileName: string): Record<string, unknown> {
  const url = new URL(`../../../schemas/config/${fileName}`, import.meta.url)
  return JSON.parse(readFileSync(url, 'utf8')) as Record<string, unknown>
}

export function loadTestSchemaBundle(): ConfigSchemaBundle {
  return {
    configSet: readSchema('config-set.schema.json'),
    parameters: readSchema('parameters.schema.json'),
    material: readSchema('material.schema.json'),
  }
}
