export type ConfigErrorCode =
  | 'CONFIG_LOAD_FAILED'
  | 'CONFIG_SCHEMA_VERSION_UNSUPPORTED'
  | 'CONFIG_REQUIRED_FIELD'
  | 'CONFIG_UNKNOWN_FIELD'
  | 'CONFIG_INVALID_TYPE'
  | 'CONFIG_VALUE_OUT_OF_RANGE'
  | 'CONFIG_SCHEMA_VIOLATION'
  | 'CONFIG_DUPLICATE_JSON_KEY'
  | 'CONFIG_DUPLICATE_LOGICAL_KEY'
  | 'CONFIG_REFERENCE_NOT_FOUND'
  | 'CONFIG_UNREGISTERED_DOCUMENT'
  | 'CONFIG_ASSET_NOT_FOUND'
  | 'CONFIG_ASSET_INVALID_PNG'
  | 'CONFIG_ASSET_INVALID_DIMENSIONS'
  | 'CONFIG_ASSET_INVALID_COLOR'
  | 'CONFIG_ASSET_EMPTY'
  | 'CONFIG_RUNTIME_INCOMPATIBLE'

export interface ConfigIssue {
  readonly code: ConfigErrorCode
  readonly filePath: string
  readonly fieldPath: string
  readonly messageZh: string
}

export function configIssue(
  code: ConfigErrorCode,
  filePath: string,
  fieldPath: string,
  messageZh: string,
): ConfigIssue {
  return Object.freeze({ code, filePath, fieldPath, messageZh })
}
