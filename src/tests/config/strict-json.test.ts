import { describe, expect, it } from 'vitest'

import { parseStrictJson } from '../../config/strict-json'

describe('parseStrictJson', () => {
  it('在嵌套对象中按解码后的键名拒绝重复键并返回稳定 JSON Pointer', () => {
    const result = parseStrictJson(
      '{"outer":{"id":"first","\\u0069d":"second"}}',
    )

    expect(result).toEqual({
      ok: false,
      duplicateKey: 'id',
      fieldPath: '/outer/id',
    })
  })

  it('正确转义重复键路径中的 JSON Pointer 保留字符', () => {
    const result = parseStrictJson('{"a/b":{"~key":1,"~key":2}}')

    expect(result).toEqual({
      ok: false,
      duplicateKey: '~key',
      fieldPath: '/a~1b/~0key',
    })
  })

  it('合法 JSON 的值保持与 JSON.parse 一致', () => {
    const text = '{"nested":[true,null,-1.25e2,{"escaped":"\\u4e2d\\u6587"}]}'
    expect(parseStrictJson(text)).toEqual({
      ok: true,
      value: JSON.parse(text),
    })
  })
})
