import { readFileSync, readdirSync } from 'node:fs'
import { extname, join } from 'node:path'

import { describe, expect, it } from 'vitest'

const RULE_DIRECTORIES = ['application', 'domain', 'simulation'] as const

function collectTypeScriptFiles(directory: string): readonly string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)

    if (entry.isDirectory()) {
      return collectTypeScriptFiles(path)
    }

    return extname(entry.name) === '.ts' ? [path] : []
  })
}

describe('规则模块边界', () => {
  const files = RULE_DIRECTORIES.flatMap((directory) =>
    collectTypeScriptFiles(join(process.cwd(), 'src', directory)),
  )

  it.each(files)('%s 不依赖 Phaser、浏览器运行时或表现资源', (file) => {
    const source = readFileSync(file, 'utf8')

    expect(source).not.toMatch(/from\s+['"]phaser['"]|import\s*\(['"]phaser['"]\)/u)
    expect(source).not.toMatch(
      /\b(?:window|document|navigator|location|requestAnimationFrame|cancelAnimationFrame)\b/u,
    )
    expect(source).not.toMatch(/\b(?:fetch|addEventListener|removeEventListener)\s*\(/u)
    expect(source).not.toMatch(/['"][^'"]+\.(?:png|jpe?g|webp|svg|mp3|ogg|wav)['"]/iu)
  })

  it.each(files)('%s 不直接读取非确定性随机数或墙钟', (file) => {
    const source = readFileSync(file, 'utf8')

    expect(source).not.toMatch(/\bMath\.random\s*\(/u)
    expect(source).not.toMatch(/\bDate\.now\s*\(|\bperformance\.now\s*\(/u)
  })
})
