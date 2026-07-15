import { describe, expect, it } from 'vitest'

import { SpatialHashGrid } from '../../simulation/index.ts'

describe('M4 空间哈希网格', () => {
  it('跨单元查询时按稳定 ID 返回半径内对象', () => {
    const grid = new SpatialHashGrid<string>(10)
    grid.insert({ id: 'pearl-c', x: 19, y: 10, value: 'c' })
    grid.insert({ id: 'pearl-a', x: 10, y: 10, value: 'a' })
    grid.insert({ id: 'pearl-b', x: 14, y: 13, value: 'b' })
    grid.insert({ id: 'pearl-far', x: 31, y: 10, value: 'far' })

    expect(grid.query(10, 10, 10).map(({ id }) => id)).toEqual([
      'pearl-a',
      'pearl-b',
      'pearl-c',
    ])
  })

  it('拒绝非法网格尺寸、位置与查询半径', () => {
    expect(() => new SpatialHashGrid(0)).toThrow('SPATIAL_HASH_GRID_CELL_SIZE_INVALID')
    const grid = new SpatialHashGrid(8)
    expect(() => grid.insert({ id: 'bad', x: Number.NaN, y: 0, value: null })).toThrow(
      'SPATIAL_HASH_GRID_POSITION_INVALID',
    )
    expect(() => grid.query(0, 0, -1)).toThrow('SPATIAL_HASH_GRID_QUERY_INVALID')
  })
})
