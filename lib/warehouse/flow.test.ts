import { describe, expect, it } from 'vitest'
import type { ApiInventoryLevel, ApiMovement, ApiProduct } from '@/lib/api-types'
import { carrierOf, computeFlow, DEPARTURE_HOUR, FLOW, lastDeparture } from './flow'
import { computeLayout, FLOOR, RACK, ZONES } from './layout'

// Two products: Coffee (2 variants) is row 0 at the front, Mug (1 variant) is row 1.
const products: ApiProduct[] = [
  {
    id: 'p-coffee',
    title: 'Coffee',
    category: 'A',
    variants: [
      { id: 'v-1lb', sku: 'C-1', options: {} },
      { id: 'v-5lb', sku: 'C-5', options: {} },
    ],
  },
  { id: 'p-mug', title: 'Mug', category: 'B', variants: [{ id: 'v-mug', sku: 'M-1', options: {} }] },
]
const levels: ApiInventoryLevel[] = products.flatMap((p) =>
  p.variants.map((v) => ({ variantId: v.id, onHand: 50, available: 50, committed: 0, incoming: 0 })),
)
const layout = computeLayout(products, levels)
const [coffeeRow, mugRow] = layout.rows
const colorOf = (variantId: string) => layout.rows.flatMap((r) => r.blocks).find((b) => b.variantId === variantId)!.color

// 15:00 local on 8 Oct 2026. Built from local parts so the tests pass in any timezone.
const local = (hour: number, minute = 0, day = 8) => new Date(2026, 9, day, hour, minute).toISOString()
const NOW = local(15)
const MORNING = local(DEPARTURE_HOUR)

let n = 0
const mv = (over: Partial<ApiMovement>): ApiMovement => ({
  id: `mv-${++n}`,
  direction: 'OUT',
  variantId: 'v-1lb',
  quantity: 1,
  status: 'SHIPPED',
  source: 'ORDER',
  detail: 'FULL',
  ref: `ref-${n}`,
  createdAt: local(9),
  shippedAt: local(10),
  doneAt: local(10),
  statusAt: local(10),
  carrier: 'UPS',
  ...over,
})
const many = (count: number, over: Partial<ApiMovement>) => Array.from({ length: count }, () => mv(over))
const flowOf = (movements: ApiMovement[], computedAt: string | null = NOW) => computeFlow(movements, layout, computedAt)

describe('carrierOf', () => {
  it.each([
    ['UPS', 'UPS'],
    ['ups', 'UPS'],
    [' FedEx ', 'FedEx'],
    ['usps', 'USPS'],
    ['DHL', 'OTHER'],
    [null, 'OTHER'],
  ])('%s -> %s', (input, expected) => expect(carrierOf(input)).toBe(expected))
})

describe('lastDeparture', () => {
  const at = (iso: string) => Date.parse(iso)
  it('is this morning once it has passed', () => {
    expect(lastDeparture(at(NOW))).toBe(at(MORNING))
    expect(lastDeparture(at(MORNING))).toBe(at(MORNING)) // exactly at departure: they just left
  })
  it('is yesterday morning before the trucks have left today', () => {
    expect(lastDeparture(at(local(DEPARTURE_HOUR - 1)))).toBe(at(local(DEPARTURE_HOUR, 0, 7)))
    expect(lastDeparture(at(local(0, 30)))).toBe(at(local(DEPARTURE_HOUR, 0, 7)))
  })
})

describe('inbound', () => {
  const transit = (ref: string, shippedAt: string) =>
    mv({ direction: 'IN', status: 'IN_TRANSIT', source: 'TRANSFER', ref, shippedAt, doneAt: null, carrier: null })
  const received = (ref: string | null, quantity: number, over: Partial<ApiMovement> = {}) =>
    mv({ direction: 'IN', status: 'RECEIVED', source: 'TRANSFER', ref, quantity, carrier: null, ...over })

  it('parks one truck per in-transit shipment, not per line', () => {
    const flow = flowOf([transit('s1', local(9)), transit('s1', local(9)), transit('s2', local(11))])
    expect(flow.inboundTrucks.map((t) => t.label)).toEqual(['s2', 's1']) // newest departure on the first dock
  })

  it('counts shipments that do not fit a dock', () => {
    const flow = flowOf(Array.from({ length: 6 }, (_, i) => transit(`s${i}`, local(i + 1))))
    expect(flow.inboundTrucks).toHaveLength(ZONES.dockCount)
    expect(flow.overflow.trucks).toBe(2)
  })

  it('puts received stock on lane pallets, one per 120 units, capped per shipment', () => {
    expect(flowOf([received('r1', 50)]).pallets).toHaveLength(1)
    expect(flowOf([received('r1', 121)]).pallets).toHaveLength(2)
    expect(flowOf([received('r1', 5000)]).pallets).toHaveLength(FLOW.pallet.maxPerGroup)
    expect(flowOf([received('r1', 60), received('r1', 60)]).pallets).toHaveLength(1)
  })

  it('keeps pallets between the dock and the receiving line, and starts them inside the truck, sliding flat', () => {
    const flow = flowOf([received('a', 10), received('b', 10), received('c', 10)])
    expect(new Set(flow.pallets.map((p) => p.position[2])).size).toBe(3)
    for (const p of flow.pallets) {
      expect(p.position[0]).toBeLessThan(ZONES.receivingLineX)
      expect(p.position[0]).toBeGreaterThan(-FLOOR.length / 2)
      // Starts beyond the dock, where the truck's cargo area is, at the same height as the truck bed, same lane.
      expect(p.from![0]).toBeLessThan(-FLOOR.length / 2 - FLOW.truck.gapToDock)
      expect(p.from![0]).toBeGreaterThan(-FLOOR.length / 2 - FLOW.truck.gapToDock - FLOW.truck.length)
      expect(p.from![1]).toBeGreaterThan(p.position[1])
      expect(p.from![2]).toBe(p.position[2])
      expect(p.hop).toBe(false)
      expect(p.grow).toBe(false)
    }
  })

  it('puts all of a shipment on one lane, and gives it one delivery', () => {
    const flow = flowOf([received('big', 400), received('small', 10)])
    const big = flow.deliveries.find((d) => d.key === 'big')!
    expect(big.palletIds).toHaveLength(FLOW.pallet.maxPerGroup)
    const lanes = new Set(flow.pallets.filter((p) => p.id.startsWith('big#')).map((p) => p.position[2]))
    expect(lanes).toEqual(new Set([big.z]))
    expect(flow.deliveries.find((d) => d.key === 'small')!.dock).not.toBe(big.dock) // the emptier lane
  })

  it('has a delivery for an in-transit truck (no pallets yet) and for each received shipment', () => {
    const flow = flowOf([transit('t1', local(9)), received('r1', 10), received('r2', 10)])
    expect(flow.deliveries.map((d) => [d.key, d.status, d.palletIds.length]).sort()).toEqual([
      ['r1', 'RECEIVED', 1],
      ['r2', 'RECEIVED', 1],
      ['t1', 'IN_TRANSIT', 0],
    ])
    expect(flow.deliveries.find((d) => d.key === 't1')!.z).toBe(flow.inboundTrucks[0].z)
  })

  it('stops filling a full lane and reports the overflow', () => {
    const flow = flowOf(Array.from({ length: 30 }, (_, i) => received(`r${i}`, 10)))
    expect(flow.pallets).toHaveLength(ZONES.dockCount * FLOW.pallet.perLane)
    expect(flow.overflow.pallets).toBe(10)
  })
})

describe('pack zone', () => {
  it('draws one parcel per packed order line and counts them', () => {
    const flow = flowOf([...many(12, { status: 'PACKED' }), ...many(3, { status: 'COMMITTED' })])
    expect(flow.packed.count).toBe(12)
    expect(flow.packed.parcels).toHaveLength(12)
    expect(flow.packed.label.text).toBe('PACKED · 12')
  })

  it('keeps each parcel in its product color, shaded per variant', () => {
    const flow = flowOf([mv({ status: 'PACKED', variantId: 'v-1lb' }), mv({ status: 'PACKED', variantId: 'v-5lb' }), mv({ status: 'PACKED', variantId: 'v-mug' })])
    expect(flow.packed.parcels.map((p) => p.color)).toEqual([colorOf('v-1lb'), colorOf('v-5lb'), colorOf('v-mug')])
    expect(colorOf('v-1lb')).not.toBe(colorOf('v-5lb'))
  })

  it("stacks parcels on the same row as their product's rack", () => {
    const flow = flowOf([...many(5, { status: 'PACKED', variantId: 'v-1lb' }), ...many(5, { status: 'PACKED', variantId: 'v-mug' })])
    const coffee = flow.packed.parcels.filter((p) => p.color === colorOf('v-1lb'))
    const mug = flow.packed.parcels.filter((p) => p.color === colorOf('v-mug'))
    for (const p of coffee) expect(Math.abs(p.position[2] - coffeeRow.z)).toBeLessThanOrEqual(RACK.depth / 2)
    for (const p of mug) expect(Math.abs(p.position[2] - mugRow.z)).toBeLessThanOrEqual(RACK.depth / 2)
  })

  it('stays between the pack line and the shipping stacks, and starts parcels at the end of their rack row', () => {
    const flow = flowOf(many(200, { status: 'PACKED' }))
    for (const p of flow.packed.parcels) {
      expect(p.position[0]).toBeGreaterThan(ZONES.packLineX)
      expect(p.position[0]).toBeLessThan(FLOW.stack.centerX - (FLOW.stack.cols * FLOW.parcel.pitch) / 2)
      expect(p.from?.[0]).toBeCloseTo(RACK.startX + RACK.baysPerRow * RACK.bayLength + 0.3)
      expect(p.from?.[2]).toBeCloseTo(coffeeRow.z)
    }
  })

  it('fills a row along x first, then stacks a second layer, and never overlaps', () => {
    const perLayer = FLOW.pack.cols * FLOW.pack.lanes
    const flow = flowOf(many(perLayer + 3, { status: 'PACKED' }))
    expect(new Set(flow.packed.parcels.map((p) => p.position[1])).size).toBe(2)
    const keys = flow.packed.parcels.map((p) => p.position.map((v) => v.toFixed(3)).join())
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('paces new parcels one at a time, faster only when there are very many', () => {
    expect(flowOf(many(10, { status: 'PACKED' })).packed.parcels[0].step).toBe(FLOW.pack.step)
    const crowd = flowOf(many(400, { status: 'PACKED' })).packed.parcels
    expect(crowd[0].step! * 400).toBeLessThanOrEqual(FLOW.pack.maxSeconds + 1e-9)
  })

  it('does not treat stock gaps as parcels', () => {
    expect(flowOf(many(3, { status: 'PACKED', detail: 'INFERRED', source: null, ref: null })).packed.count).toBe(0)
  })
})

describe('shipping stacks', () => {
  it('has one stack per carrier at its own dock, even when empty', () => {
    const flow = flowOf([])
    expect(flow.stacks.map((s) => [s.carrier, s.count, s.dock])).toEqual([
      ['UPS', 0, 0],
      ['USPS', 0, 1],
      ['FedEx', 0, 2],
      ['OTHER', 0, 3],
    ])
    expect(flow.outboundTrucks.map((t) => t.label)).toEqual(['UPS', 'USPS', 'FedEx', 'OTHER'])
  })

  it('counts shipped order lines per carrier, with unknown carriers under OTHER', () => {
    const flow = flowOf([...many(5, { carrier: 'UPS' }), ...many(2, { carrier: 'usps' }), ...many(1, { carrier: null }), ...many(1, { carrier: 'DHL' })])
    expect(flow.stacks.map((s) => s.count)).toEqual([5, 2, 0, 2])
    expect(flow.stacks[0].label.text).toBe('UPS · 5')
  })

  it('keeps the product color, and has no entrance on the first load', () => {
    const flow = flowOf([mv({ variantId: 'v-mug' })])
    expect(flow.stacks[0].parcels[0]).toMatchObject({ color: colorOf('v-mug'), settled: true })
  })

  it('only holds what shipped since the last morning departure', () => {
    const flow = flowOf([
      mv({ doneAt: local(6, 0, 7) }), // yesterday: left with the truck
      mv({ doneAt: local(7, 59) }), // just before this morning's truck
      mv({ doneAt: MORNING }), // exactly at departure: counts for today
      mv({ doneAt: local(11) }),
    ])
    expect(flow.stacks[0].count).toBe(2)
  })

  it('empties the stacks and moves the departure forward when the next morning comes', () => {
    const shipped = many(8, { doneAt: local(11) })
    const today = flowOf(shipped, NOW)
    const tomorrow = flowOf(shipped, local(9, 0, 9))
    expect(today.stacks[0].count).toBe(8)
    expect(tomorrow.stacks[0].count).toBe(0)
    expect(tomorrow.departure).toBeGreaterThan(today.departure)
  })

  it('shows everything before anything has synced', () => {
    expect(flowOf(many(3, { doneAt: local(6, 0, 1) }), null).stacks[0].count).toBe(3)
  })

  it('leaves stock-gap corrections out of the parcels', () => {
    const flow = flowOf([...many(3, { carrier: null }), ...many(4, { carrier: null, detail: 'INFERRED', source: null, ref: null })])
    expect(flow.stacks[3].count).toBe(3)
  })

  it('stacks upward, and caps what is drawn but not what is counted', () => {
    const perLayer = FLOW.stack.cols * FLOW.stack.rows
    const flow = flowOf(many(perLayer * FLOW.stack.layers + 20, { carrier: 'UPS' }))
    expect(flow.stacks[0].count).toBe(perLayer * FLOW.stack.layers + 20)
    expect(flow.stacks[0].parcels).toHaveLength(perLayer * FLOW.stack.layers)
  })

  it('keeps each stack on its own dock lane and its label off the front-edge floor labels (6 products, like the seed)', () => {
    const six: ApiProduct[] = Array.from({ length: 6 }, (_, i) => ({
      id: `p${i}`,
      title: `Product ${i}`,
      category: 'A',
      variants: [{ id: `v${i}`, sku: `S${i}`, options: {} }],
    }))
    const sixLayout = computeLayout(six, [])
    const flow = computeFlow(many(FLOW.stack.cols * FLOW.stack.rows, { carrier: 'OTHER', variantId: 'v0' }), sixLayout, NOW)
    const last = flow.stacks[3]
    expect(last.label.z).toBeGreaterThan(Math.max(...last.parcels.map((p) => p.position[2])))
    expect(last.label.z).toBeLessThan(sixLayout.floorDepth / 2 - 0.55 - 0.35 * 2)
    for (const stack of flow.stacks.slice(0, 3)) {
      const next = flow.stacks[stack.dock + 1]
      const top = Math.max(...flow.stacks[stack.dock].parcels.map((p) => p.position[2]), -Infinity)
      expect(top).toBeLessThan(next.label.z)
    }
  })
})

describe('stable ids and order', () => {
  it('gives every block a unique id', () => {
    const flow = flowOf([
      ...many(30, { status: 'PACKED' }),
      ...many(30, { carrier: 'UPS' }),
      mv({ direction: 'IN', status: 'RECEIVED', source: 'TRANSFER', ref: 'r1', quantity: 300, carrier: null }),
    ])
    const ids = [...flow.pallets, ...flow.packed.parcels, ...flow.stacks.flatMap((s) => s.parcels)].map((b) => b.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('uses the movement id for parcels, so packed -> shipped keeps the same block', () => {
    const line = mv({ status: 'PACKED' })
    const before = flowOf([line]).packed.parcels[0]
    const after = flowOf([{ ...line, status: 'SHIPPED', doneAt: local(12) }]).stacks[0].parcels[0]
    expect(after.id).toBe(before.id)
    expect(after.color).toBe(before.color)
    expect(after.position).not.toEqual(before.position)
  })

  it('keeps existing parcels in place when a newer one lands', () => {
    const old = many(5, { status: 'PACKED', statusAt: local(9) })
    const newer = mv({ status: 'PACKED', statusAt: local(12) })
    const before = flowOf(old).packed.parcels
    const after = flowOf([newer, ...old]).packed.parcels
    for (const b of before) expect(after.find((a) => a.id === b.id)?.position).toEqual(b.position)
  })
})
