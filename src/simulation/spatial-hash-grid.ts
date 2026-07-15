export type SpatialHashEntry<T> = Readonly<{
  id: string
  x: number
  y: number
  value: T
}>

function cellCoordinate(value: number, cellSize: number): number {
  return Math.floor(value / cellSize)
}

function cellKey(column: number, row: number): string {
  return `${column}:${row}`
}

export class SpatialHashGrid<T> {
  readonly #cellSize: number
  readonly #cells = new Map<string, SpatialHashEntry<T>[]>()

  constructor(cellSize: number) {
    if (!Number.isFinite(cellSize) || cellSize <= 0) {
      throw new RangeError('SPATIAL_HASH_GRID_CELL_SIZE_INVALID')
    }
    this.#cellSize = cellSize
  }

  clear(): void {
    this.#cells.clear()
  }

  insert(entry: SpatialHashEntry<T>): void {
    if (!Number.isFinite(entry.x) || !Number.isFinite(entry.y)) {
      throw new RangeError('SPATIAL_HASH_GRID_POSITION_INVALID')
    }
    const key = cellKey(
      cellCoordinate(entry.x, this.#cellSize),
      cellCoordinate(entry.y, this.#cellSize),
    )
    const bucket = this.#cells.get(key)
    if (bucket === undefined) this.#cells.set(key, [entry])
    else bucket.push(entry)
  }

  query(x: number, y: number, radius: number): readonly SpatialHashEntry<T>[] {
    if (
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      !Number.isFinite(radius) ||
      radius < 0
    ) {
      throw new RangeError('SPATIAL_HASH_GRID_QUERY_INVALID')
    }
    const minimumColumn = cellCoordinate(x - radius, this.#cellSize)
    const maximumColumn = cellCoordinate(x + radius, this.#cellSize)
    const minimumRow = cellCoordinate(y - radius, this.#cellSize)
    const maximumRow = cellCoordinate(y + radius, this.#cellSize)
    const radiusSquared = radius * radius
    const result: SpatialHashEntry<T>[] = []
    for (let row = minimumRow; row <= maximumRow; row += 1) {
      for (let column = minimumColumn; column <= maximumColumn; column += 1) {
        for (const entry of this.#cells.get(cellKey(column, row)) ?? []) {
          const deltaX = entry.x - x
          const deltaY = entry.y - y
          if (deltaX * deltaX + deltaY * deltaY <= radiusSquared) result.push(entry)
        }
      }
    }
    return result.sort((left, right) => left.id.localeCompare(right.id))
  }
}
