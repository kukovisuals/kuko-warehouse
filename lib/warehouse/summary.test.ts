import { describe, expect, it } from 'vitest'
import type { ApiInventoryLevel, ApiMovement, ApiProduct } from '@/lib/api-types'
import { computeFlow } from './flow'
import { computeLayout } from './layout'
import { computeSummary, shortRef } from './summary'

const products: ApiProduct[] = [
  {
    id: 'p1',
    title: 'Ground Coffee',
    category: 'Coffee',
    variants: [
      { id: 'v1', sku: 'GRD-1LB', options: { Size: '1 lb', Grind: 'Ground' } }, // out of order on purpose: JSON has no key order
      { id: 'v2', sku: 'GRD-5LB', options: { Size: '5 lb', Grind: 'Ground' } },
    ],
  },
  { id: 'p2', title: 'Skull Mug', category: 'Merch', variants: [{ id: 'v3', sku: 'MUG-BLK', options: { Color: 'Black' } }] },
]
const levels: ApiInventoryLevel[] = [
  { variantId: 'v1', onHand: 100, available: 90, committed: 10, incoming: 0 },
  { variantId: 'v2', onHand: 20, available: 20, committed: 0, incoming: 0 },
  { variantId: 'v3', onHand: 5, available: 5, committed: 0, incoming: 0 },
]
let n = 0
const mv = (over: Partial<ApiMovement>): ApiMovement => ({
  id: `mv-${++n}`,
  direction: 'OUT',
  variantId: 'v1',
  quantity: 1,
  status: 'PACKED',
  source: 'ORDER',
  detail: 'FULL',
  ref: `ref-${n}`,
  createdAt: '2026-10-08T10:00:00Z',
  shippedAt: null,
  doneAt: null,
  statusAt: '2026-10-08T10:00:00Z',
  carrier: 'UPS',
  ...over,
})
const received = (over: Partial<ApiMovement>) =>
  mv({ direction: 'IN', status: 'RECEIVED', source: 'TRANSFER', carrier: null, doneAt: '2026-10-08T11:00:00Z', ...over })

const build = (movements: ApiMovement[]) => {
  const layout = computeLayout(products, levels)
  return computeSummary({ products, levels, movements, layout, flow: computeFlow(movements, layout, null) })
}

describe('shortRef', () => {
  it.each([
    ['gid://shopify/InventoryShipment/101', '#101'],
    ['gid://shopify/Order/48210', '#48210'],
    ['3pl-receipt-2', '3PL-2'],
    ['po-9', 'PO-9'],
    [null, 'ADJUSTMENT'],
  ])('%s -> %s', (input, expected) => expect(shortRef(input)).toBe(expected))
})

describe('received', () => {
  it('totals units, counts shipments and pallets, and lists lines newest first', () => {
    const s = build([
      received({ ref: 'gid://shopify/InventoryShipment/1', variantId: 'v1', quantity: 130, doneAt: '2026-10-08T09:00:00Z' }),
      received({ ref: 'gid://shopify/InventoryShipment/1', variantId: 'v2', quantity: 20, doneAt: '2026-10-08T09:00:00Z' }),
      received({ ref: '3pl-receipt-1', variantId: 'v3', quantity: 30, doneAt: '2026-10-08T12:00:00Z' }),
      received({ ref: 'in-flight', status: 'IN_TRANSIT', doneAt: null, quantity: 999 }),
    ])
    expect(s.received.total).toBe(180)
    expect(s.received.detail).toBe('2 shipments · 3 pallets') // 150 units -> 2 pallets, 30 units -> 1
    expect(s.received.items.map((i) => [i.title, i.subtitle, i.quantity, i.note])).toEqual([
      ['Skull Mug', 'Black', 30, '3PL-1'],
      ['Ground Coffee', 'Ground · 1 lb', 130, '#1'],
      ['Ground Coffee', 'Ground · 5 lb', 20, '#1'],
    ])
  })

  it('is empty without receipts', () => {
    const s = build([])
    expect(s.received).toEqual({ total: 0, detail: '0 shipments · 0 pallets', items: [] })
  })

  it('uses singular words for a count of one', () => {
    expect(build([received({ quantity: 10 })]).received.detail).toBe('1 shipment · 1 pallet')
  })
})

describe('inventory', () => {
  it('sums on-hand and lists every variant in rack order with its SKU', () => {
    const s = build([])
    expect(s.inventory.total).toBe(125)
    expect(s.inventory.detail).toBe('3 SKUs · 2 racks')
    expect(s.inventory.items.map((i) => [i.title, i.quantity, i.note])).toEqual([
      ['Ground Coffee', 100, 'GRD-1LB'],
      ['Ground Coffee', 20, 'GRD-5LB'],
      ['Skull Mug', 5, 'MUG-BLK'],
    ])
  })

  it('uses the same colors as the racks', () => {
    const layout = computeLayout(products, levels)
    const s = build([])
    expect(s.inventory.items.map((i) => i.color)).toEqual(layout.rows.flatMap((r) => r.blocks.map((b) => b.color)))
  })
})

describe('packed', () => {
  it('counts packed order lines, units and carriers, grouped by variant with most units first', () => {
    const s = build([
      mv({ variantId: 'v1', quantity: 2, carrier: 'UPS' }),
      mv({ variantId: 'v1', quantity: 1, carrier: 'usps' }),
      mv({ variantId: 'v3', quantity: 5, carrier: null }),
      mv({ status: 'COMMITTED' }),
      mv({ status: 'SHIPPED', doneAt: '2026-10-08T11:00:00Z' }),
      mv({ detail: 'INFERRED', source: null, ref: null }),
    ])
    expect(s.packed.total).toBe(3)
    expect(s.packed.detail).toBe('8 units · 3 carriers')
    expect(s.packed.items.map((i) => [i.title, i.quantity, i.note])).toEqual([
      ['Skull Mug', 5, '1 order'],
      ['Ground Coffee', 3, '2 orders'],
    ])
  })

  it('matches the pack-zone count drawn in the scene', () => {
    const movements = [mv({}), mv({}), mv({})]
    const layout = computeLayout(products, levels)
    expect(build(movements).packed.total).toBe(computeFlow(movements, layout, null).packed.count)
  })
})

it('falls back for a variant the product list does not know', () => {
  const s = build([mv({ variantId: 'ghost' })])
  expect(s.packed.items[0]).toMatchObject({ title: 'Unknown product', subtitle: '' })
})
