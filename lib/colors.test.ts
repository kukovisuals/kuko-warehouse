import { describe, expect, it } from 'vitest'
import { PRODUCT_PALETTE, productColor, variantColor } from './colors'

const lightness = (hex: string) => {
  const n = parseInt(hex.slice(1), 16)
  const r = ((n >> 16) & 255) / 255
  const g = ((n >> 8) & 255) / 255
  const b = (n & 255) / 255
  return ((Math.max(r, g, b) + Math.min(r, g, b)) / 2) * 100
}

describe('colors', () => {
  it('cycles the palette', () => {
    expect(productColor(0)).toBe(PRODUCT_PALETTE[0])
    expect(productColor(8)).toBe(PRODUCT_PALETTE[0])
  })

  it('keeps the hue color for a single variant', () => {
    expect(variantColor(2, 0, 1)).toBe(PRODUCT_PALETTE[2])
  })

  it('shifts two variants by -6 and +6 lightness points', () => {
    const base = lightness(PRODUCT_PALETTE[0])
    expect(lightness(variantColor(0, 0, 2))).toBeCloseTo(base - 6, 0)
    expect(lightness(variantColor(0, 1, 2))).toBeCloseTo(base + 6, 0)
  })
})
