import { configIssue, type ConfigIssue } from './errors'
import type { RawConfigDocument } from './model'

export type StrictJsonParseResult =
  | { readonly ok: true; readonly value: unknown }
  | {
      readonly ok: false
      readonly duplicateKey: string
      readonly fieldPath: string
    }
  | { readonly ok: false; readonly fieldPath: '' }

export type ConfigDocumentParseResult =
  | { readonly ok: true; readonly document: RawConfigDocument }
  | { readonly ok: false; readonly issue: ConfigIssue }

class DuplicateJsonKeyError extends Error {
  constructor(
    readonly duplicateKey: string,
    readonly fieldPath: string,
  ) {
    super(`重复 JSON 键：${duplicateKey}`)
  }
}

function escapeJsonPointerSegment(value: string): string {
  return value.replaceAll('~', '~0').replaceAll('/', '~1')
}

class JsonStructureScanner {
  private index = 0

  constructor(private readonly text: string) {}

  scan(): void {
    this.skipWhitespace()
    this.scanValue('')
    this.skipWhitespace()
    if (this.index !== this.text.length) throw new SyntaxError('JSON 尾部存在多余内容')
  }

  private scanValue(fieldPath: string): void {
    this.skipWhitespace()
    const character = this.text[this.index]
    if (character === '{') {
      this.scanObject(fieldPath)
      return
    }
    if (character === '[') {
      this.scanArray(fieldPath)
      return
    }
    if (character === '"') {
      this.scanString()
      return
    }
    if (character === 't') {
      this.scanLiteral('true')
      return
    }
    if (character === 'f') {
      this.scanLiteral('false')
      return
    }
    if (character === 'n') {
      this.scanLiteral('null')
      return
    }
    this.scanNumber()
  }

  private scanObject(fieldPath: string): void {
    this.expectCharacter('{')
    this.skipWhitespace()
    if (this.text[this.index] === '}') {
      this.index += 1
      return
    }

    const keys = new Set<string>()
    while (true) {
      this.skipWhitespace()
      const key = this.scanString()
      const keyPath = `${fieldPath}/${escapeJsonPointerSegment(key)}`
      if (keys.has(key)) throw new DuplicateJsonKeyError(key, keyPath)
      keys.add(key)

      this.skipWhitespace()
      this.expectCharacter(':')
      this.scanValue(keyPath)
      this.skipWhitespace()
      const delimiter = this.text[this.index]
      if (delimiter === '}') {
        this.index += 1
        return
      }
      this.expectCharacter(',')
    }
  }

  private scanArray(fieldPath: string): void {
    this.expectCharacter('[')
    this.skipWhitespace()
    if (this.text[this.index] === ']') {
      this.index += 1
      return
    }

    let itemIndex = 0
    while (true) {
      this.scanValue(`${fieldPath}/${itemIndex}`)
      itemIndex += 1
      this.skipWhitespace()
      const delimiter = this.text[this.index]
      if (delimiter === ']') {
        this.index += 1
        return
      }
      this.expectCharacter(',')
    }
  }

  private scanString(): string {
    const start = this.index
    this.expectCharacter('"')
    while (this.index < this.text.length) {
      const character = this.text[this.index]!
      if (character === '"') {
        this.index += 1
        return JSON.parse(this.text.slice(start, this.index)) as string
      }
      if (character === '\\') {
        this.index += 1
        const escape = this.text[this.index]
        if (escape === undefined) throw new SyntaxError('JSON 字符串转义不完整')
        if (escape === 'u') {
          const codePoint = this.text.slice(this.index + 1, this.index + 5)
          if (!/^[0-9a-fA-F]{4}$/.test(codePoint)) {
            throw new SyntaxError('JSON Unicode 转义无效')
          }
          this.index += 5
          continue
        }
        if (!'"\\/bfnrt'.includes(escape)) {
          throw new SyntaxError('JSON 字符串转义无效')
        }
        this.index += 1
        continue
      }
      if (character.charCodeAt(0) < 0x20) {
        throw new SyntaxError('JSON 字符串包含控制字符')
      }
      this.index += 1
    }
    throw new SyntaxError('JSON 字符串未闭合')
  }

  private scanLiteral(literal: string): void {
    if (this.text.slice(this.index, this.index + literal.length) !== literal) {
      throw new SyntaxError(`JSON literal 无效：${literal}`)
    }
    this.index += literal.length
  }

  private scanNumber(): void {
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(
      this.text.slice(this.index),
    )
    if (match === null) throw new SyntaxError('JSON 数值无效')
    this.index += match[0].length
  }

  private expectCharacter(expected: string): void {
    if (this.text[this.index] !== expected) {
      throw new SyntaxError(`JSON 期望字符：${expected}`)
    }
    this.index += 1
  }

  private skipWhitespace(): void {
    while (/\s/.test(this.text[this.index] ?? '')) {
      const character = this.text[this.index]
      if (character !== ' ' && character !== '\n' && character !== '\r' && character !== '\t') {
        throw new SyntaxError('JSON 包含非法空白字符')
      }
      this.index += 1
    }
  }
}

export function parseStrictJson(text: string): StrictJsonParseResult {
  try {
    new JsonStructureScanner(text).scan()
    return { ok: true, value: JSON.parse(text) as unknown }
  } catch (error) {
    if (error instanceof DuplicateJsonKeyError) {
      return {
        ok: false,
        duplicateKey: error.duplicateKey,
        fieldPath: error.fieldPath,
      }
    }
    return { ok: false, fieldPath: '' }
  }
}

export function parseConfigJsonDocument(
  text: string,
  filePath: string,
): ConfigDocumentParseResult {
  const parsed = parseStrictJson(text)
  if (parsed.ok) {
    return { ok: true, document: { filePath, value: parsed.value } }
  }
  if ('duplicateKey' in parsed) {
    return {
      ok: false,
      issue: configIssue(
        'CONFIG_DUPLICATE_JSON_KEY',
        filePath,
        parsed.fieldPath,
        `JSON 对象包含重复键“${parsed.duplicateKey}”`,
      ),
    }
  }
  return {
    ok: false,
    issue: configIssue(
      'CONFIG_LOAD_FAILED',
      filePath,
      '',
      '配置加载失败：内容不是有效 JSON',
    ),
  }
}
