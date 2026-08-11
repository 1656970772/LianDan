const ZERO_SEED_REPLACEMENT = 0x6d2b79f5;

export function normalizeSeed(seed: number): number {
  const normalized = seed >>> 0;
  return normalized === 0 ? ZERO_SEED_REPLACEMENT : normalized;
}

/**
 * 跨语言确定性 xorshift32。每次调用 nextUint32 只消耗一次状态。
 */
export class XorShift32 {
  private state: number;

  constructor(seed: number) {
    this.state = normalizeSeed(seed);
  }

  nextUint32(): number {
    let value = this.state >>> 0;
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    this.state = value >>> 0;
    return this.state;
  }

  nextFloat(): number {
    return this.nextUint32() / 0x1_0000_0000;
  }
}
