import configSetSchemaText from '../../schemas/config/config-set.schema.json?raw'
import materialSchemaText from '../../schemas/config/material.schema.json?raw'
import parametersSchemaText from '../../schemas/config/parameters.schema.json?raw'
import tagsSchemaText from '../../schemas/config/tags.schema.json?raw'

import type { ConfigSchemaBundle, JsonSchema } from './model'

function parseSchema(text: string): JsonSchema {
  return JSON.parse(text) as JsonSchema
}

export const browserConfigSchemaBundle: ConfigSchemaBundle = Object.freeze({
  configSet: parseSchema(configSetSchemaText),
  parameters: parseSchema(parametersSchemaText),
  material: parseSchema(materialSchemaText),
  tags: parseSchema(tagsSchemaText),
})
