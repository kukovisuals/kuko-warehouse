import { describe, expect, it } from 'vitest'
import type { ApiInventoryLevel, ApiProduct } from '@/lib/api-types'
import { variantColor } from '@/lib/colors'
import { boxesFor, computeLayout, FLOOR, RACK, slotPosition } from './layout'

const product = (id: string, title: string, category: string, skus: string[]): ApiProduct => ({
  id,
  title,
  category,
  variants: skus.map((sku) => ({ id: `${id}:${sku}`, sku, options: {} })),
})
const level = (variantId: string, onHand: number): ApiInventoryLevel => ({
  variantId,
  onHand,
  available: onHand,
  committed: 0,
  incoming: 0,
})

describe('boxesFor', () => {
  it.each([
    [0, 40, 0],
    [1, 40, 1],
    [6, 40, 1],
    [7, 40, 2],
    [240, 40, 40],
    [60, 40, 10],
    [10_000, 40, 40], // capped at the block's slots (OPEN-D4)
    [-5, 40, 0],
  ])('onHand %i with %i slots -> %i boxes', (onHand, slots, expected) => {
    expect(boxesFor(onHand, slots)).toBe(expected)
  })
})

describe('computeLayout', () => {
  const products = [
    product('p-mug', 'Skull Mug', 'Merch', ['MUG-WHT', 'MUG-BLK']),
    product('p-gnd', 'Death Wish Ground Coffee', 'Coffee', ['DW-GRD-5LB', 'DW-GRD-1LB']),
    product('p-pod', 'Pods', 'Pods', ['DW-POD-10']),
  ]
  const levels = [
    level('p-gnd:DW-GRD-1LB', 240),
    level('p-gnd:DW-GRD-5LB', 60),
    level('p-mug:MUG-BLK', 60),
    level('p-mug:MUG-WHT', 36),
    level('p-pod:DW-POD-10', 150),
  ]
  const layout = computeLayout(products, levels)

  it('orders rows by category then title, row 1 at the front', () => {
    expect(layout.rows.map((r) => r.productId)).toEqual(['p-gnd', 'p-mug', 'p-pod'])
    expect(layout.rows[0].z).toBeGreaterThan(layout.rows[1].z)
  })

  it('sizes the floor from the row count', () => {
    expect(layout.floorDepth).toBeCloseTo(3 * 2.8 + 4)
    expect(FLOOR.depthFor(8)).toBeCloseTo(26.4)
  })

  it('centers rows on z = 0 with a 2.8 pitch', () => {
    const zs = layout.rows.map((r) => r.z)
    expect(zs[0] + zs[2]).toBeCloseTo(0)
    expect(zs[0] - zs[1]).toBeCloseTo(RACK.pitch)
  })

  it('splits bays by sku order, and matches the spec example', () => {
    const [ground, mug] = layout.rows
    expect(ground.blocks.map((b) => [b.sku, b.firstBay, b.bayCount, b.boxes])).toEqual([
      ['DW-GRD-1LB', 0, 5, 40],
      ['DW-GRD-5LB', 5, 5, 10],
    ])
    expect(mug.blocks.map((b) => [b.sku, b.boxes])).toEqual([
      ['MUG-BLK', 10],
      ['MUG-WHT', 6],
    ])
  })

  it('gives a single variant the whole row', () => {
    expect(layout.rows[2].blocks[0]).toMatchObject({ firstBay: 0, bayCount: 10, slots: 80, boxes: 25 })
  })

  it('draws one box placement per box', () => {
    const total = layout.rows.reduce((sum, r) => sum + r.blocks.reduce((s, b) => s + b.boxes, 0), 0)
    expect(layout.boxes).toHaveLength(total)
  })

  it('colors variants with the shared color function', () => {
    expect(layout.rows[0].blocks[0].color).toBe(variantColor(0, 0, 2))
    expect(layout.rows[1].blocks[1].color).toBe(variantColor(1, 1, 2))
  })

  it('keeps block positions fixed when stock changes', () => {
    const more = computeLayout(products, [...levels.filter((l) => l.variantId !== 'p-gnd:DW-GRD-1LB'), level('p-gnd:DW-GRD-1LB', 6)])
    expect(more.rows[0].blocks.map((b) => b.firstBay)).toEqual(layout.rows[0].blocks.map((b) => b.firstBay))
  })

  it('treats a variant with no level as empty', () => {
    const empty = computeLayout(products, [])
    expect(empty.boxes).toHaveLength(0)
    expect(empty.rows).toHaveLength(3)
  })
})

describe('slotPosition', () => {
  it('fills bay by bay, bottom level first', () => {
    const p = (k: number) => slotPosition(0, 0, k)
    expect(p(0)[1]).toBeCloseTo(0.03 + 0.2)
    expect(p(1)[1]).toBeCloseTo(p(0)[1])
    expect(p(1)[0]).toBeGreaterThan(p(0)[0])
    expect(p(2)[1]).toBeCloseTo(p(0)[1] + RACK.levelHeight)
    expect(p(8)[0]).toBeGreaterThan(p(7)[0]) // next bay
    expect(p(8)[1]).toBeCloseTo(p(0)[1])
  })

  it('keeps boxes inside the row', () => {
    const last = slotPosition(0, 9, 7)
    expect(last[0] + RACK.box.width / 2).toBeLessThanOrEqual(RACK.startX + RACK.baysPerRow * RACK.bayLength)
    expect(slotPosition(0, 0, 0)[0] - RACK.box.width / 2).toBeGreaterThanOrEqual(RACK.startX)
  })
})
