// Product hues and variant shades. Shared by the racks and the legend (wiki/design-specs.md).

export const PRODUCT_PALETTE = [
  '#A98DB5', // mauve
  '#E3C48E', // tan
  '#9CB98F', // sage
  '#7DB5AE', // teal
  '#E6AE5B', // amber
  '#9FAEDC', // periwinkle
  '#8E6248', // cocoa
  '#5B5E64', // graphite
] as const

const LIGHTNESS_STEP = 12

function hexToHsl(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  const r = ((n >> 16) & 255) / 255
  const g = ((n >> 8) & 255) / 255
  const b = (n & 255) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  if (d === 0) return [0, 0, l * 100]
  const s = d / (1 - Math.abs(2 * l - 1))
  let h: number
  if (max === r) h = ((g - b) / d) % 6
  else if (max === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4
  return [((h * 60) + 360) % 360, s * 100, l * 100]
}

function hslToHex(h: number, s: number, l: number): string {
  const sat = s / 100
  const lig = l / 100
  const c = (1 - Math.abs(2 * lig - 1)) * sat
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = lig - c / 2
  const [r, g, b] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]
  const to = (v: number) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, '0')
  return `#${to(r)}${to(g)}${to(b)}`.toUpperCase()
}

/** Hue for the product in row `productIndex`. Cycles when there are more products than hues. */
export function productColor(productIndex: number): string {
  return PRODUCT_PALETTE[productIndex % PRODUCT_PALETTE.length]
}

/** Variant `variantIndex` of `variantCount`: the product hue, lightness shifted by 12 × (i − (n − 1)/2) points. */
export function variantColor(productIndex: number, variantIndex: number, variantCount: number): string {
  const [h, s, l] = hexToHsl(productColor(productIndex))
  const shift = LIGHTNESS_STEP * (variantIndex - (variantCount - 1) / 2)
  return hslToHex(h, s, Math.min(100, Math.max(0, l + shift)))
}
