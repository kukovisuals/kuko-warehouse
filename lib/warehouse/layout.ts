// Pure rack layout: products + stock levels in, positions and box counts out.
// Rules live in wiki/design-specs.md. Units are meters; origin is the floor center on the floor surface.
// Front of the warehouse is +z, the back wall is at -z.

import type { ApiInventoryLevel, ApiProduct, ApiVariant } from '@/lib/api-types'
import { variantColor } from '@/lib/colors'

export const FLOOR = {
  length: 40,
  thickness: 0.3,
  wallHeight: 3,
  wallThickness: 0.2,
  returnLength: 4,
  /** Floor depth = racks × pitch + 4. */
  depthFor: (racks: number) => racks * 2.8 + 4,
} as const

export const ZONES = {
  receivingLineX: -13,
  packLineX: 5,
  dockCount: 4,
  dockLength: 1.6,
  dockWidth: 0.3,
  dockHeight: 0.1,
  lineWidth: 0.06,
  lineLift: 0.005,
} as const

/** z of each dock, spread evenly along the floor depth. Inbound and outbound docks share these. */
export function dockZs(floorDepth: number): number[] {
  return Array.from({ length: ZONES.dockCount }, (_, i) => -floorDepth / 2 + (floorDepth * (i + 0.5)) / ZONES.dockCount)
}

export const RACK = {
  startX: -12,
  baysPerRow: 10,
  bayLength: 1.6,
  depth: 1.2,
  pitch: 2.8,
  levels: 4,
  levelHeight: 0.5,
  slotsPerBayLevel: 2,
  slotsPerBay: 8,
  uprightSize: 0.05,
  shelfThickness: 0.03,
  height: 2.1,
  unitsPerBox: 6,
  box: { width: 0.7, height: 0.4, depth: 0.9 },
} as const

export interface BoxPlacement {
  position: [number, number, number]
  color: string
}

export interface VariantBlock {
  variantId: string
  sku: string | null
  color: string
  firstBay: number
  bayCount: number
  slots: number
  onHand: number
  boxes: number
}

export interface RackRow {
  productId: string
  title: string
  category: string | null
  /** 0 = front row. */
  index: number
  /** z of the row center. */
  z: number
  blocks: VariantBlock[]
}

export interface WarehouseLayout {
  floorDepth: number
  rows: RackRow[]
  boxes: BoxPlacement[]
}

const byText = (a: string | null, b: string | null) =>
  a === b ? 0 : a === null ? 1 : b === null ? -1 : a.localeCompare(b)

/** Row order: category, then title. */
export function sortProducts(products: ApiProduct[]): ApiProduct[] {
  return [...products].sort((a, b) => byText(a.category, b.category) || a.title.localeCompare(b.title))
}

/** Variant order inside a row: sku (blank last), then id. */
export function sortVariants(variants: ApiVariant[]): ApiVariant[] {
  return [...variants].sort((a, b) => byText(a.sku || null, b.sku || null) || a.id.localeCompare(b.id))
}

export function boxesFor(onHand: number, slots: number): number {
  return Math.min(Math.ceil(Math.max(0, onHand) / RACK.unitsPerBox), slots)
}

/** Split the bays evenly. When they don't divide, the first variants get the extra bay. Past 10 variants the rest get none. */
function splitBays(variantCount: number): number[] {
  const base = Math.floor(RACK.baysPerRow / variantCount)
  const extra = RACK.baysPerRow % variantCount
  return Array.from({ length: variantCount }, (_, i) => (base + (i < extra ? 1 : 0)))
}

/** Center of slot `k` of a block that starts at `firstBay`: bay by bay from the left, bottom level first. */
export function slotPosition(rowZ: number, firstBay: number, k: number): [number, number, number] {
  const bay = firstBay + Math.floor(k / RACK.slotsPerBay)
  const inBay = k % RACK.slotsPerBay
  const level = Math.floor(inBay / RACK.slotsPerBayLevel)
  const slot = inBay % RACK.slotsPerBayLevel
  const bayCenterX = RACK.startX + (bay + 0.5) * RACK.bayLength
  const x = bayCenterX + (slot === 0 ? -1 : 1) * (RACK.bayLength / 4)
  const y = level * RACK.levelHeight + RACK.shelfThickness + RACK.box.height / 2
  return [x, y, rowZ]
}

export function computeLayout(products: ApiProduct[], levels: ApiInventoryLevel[]): WarehouseLayout {
  const onHandByVariant = new Map(levels.map((l) => [l.variantId, l.onHand]))
  const sorted = sortProducts(products)
  const n = sorted.length

  const rows: RackRow[] = sorted.map((product, index) => {
    const variants = sortVariants(product.variants)
    const bays = splitBays(Math.max(variants.length, 1))
    let nextBay = 0
    const blocks = variants.map((variant, i): VariantBlock => {
      const bayCount = bays[i]
      const slots = bayCount * RACK.slotsPerBay
      const onHand = onHandByVariant.get(variant.id) ?? 0
      const block: VariantBlock = {
        variantId: variant.id,
        sku: variant.sku,
        color: variantColor(index, i, variants.length),
        firstBay: nextBay,
        bayCount,
        slots,
        onHand,
        boxes: boxesFor(onHand, slots),
      }
      nextBay += bayCount
      return block
    })
    return {
      productId: product.id,
      title: product.title,
      category: product.category,
      index,
      z: ((n - 1) * RACK.pitch) / 2 - index * RACK.pitch,
      blocks,
    }
  })

  const boxes = rows.flatMap((row) =>
    row.blocks.flatMap((block) =>
      Array.from({ length: block.boxes }, (_, k): BoxPlacement => ({
        position: slotPosition(row.z, block.firstBay, k),
        color: block.color,
      })),
    ),
  )

  return { floorDepth: FLOOR.depthFor(n), rows, boxes }
}
