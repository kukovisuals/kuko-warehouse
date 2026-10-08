import { describe, expect, it } from 'vitest'
import type { ApiMovement } from '@/lib/api-types'
import { carrierOf, computeFlow, FLOW } from './flow'
import { dockZs, FLOOR, ZONES } from './layout'

const DEPTH = FLOOR.depthFor(6)
let n = 0
const mv = (over: Partial<ApiMovement>): ApiMovement => ({
  id: `mv-${++n}`,
  direction: 'OUT',
  variantId: 'var-1',
  quantity: 1,
  status: 'SHIPPED',
  source: 'ORDER',
  detail: 'FULL',
  ref: `ref-${n}`,
  createdAt: '2026-10-08T10:00:00Z',
  shippedAt: '2026-10-08T11:00:00Z',
  doneAt: '2026-10-08T11:00:00Z',
  statusAt: '2026-10-08T11:00:00Z',
  carrier: 'UPS',
  ...over,
})
const many = (count: number, over: Partial<ApiMovement>) => Array.from({ length: count }, () => mv(over))

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

describe('inbound', () => {
  const transit = (ref: string, shippedAt: string) =>
    mv({ direction: 'IN', status: 'IN_TRANSIT', source: 'TRANSFER', ref, shippedAt, doneAt: null, carrier: null })
  const received = (ref: string | null, quantity: number, over: Partial<ApiMovement> = {}) =>
    mv({ direction: 'IN', status: 'RECEIVED', source: 'TRANSFER', ref, quantity, carrier: null, ...over })

  it('parks one truck per in-transit shipment, not per line', () => {
    const flow = computeFlow(
      [transit('s1', '2026-10-06T10:00:00Z'), transit('s1', '2026-10-06T10:00:00Z'), transit('s2', '2026-10-07T10:00:00Z')],
      DEPTH,
    )
    expect(flow.inboundTrucks.map((t) => t.label)).toEqual(['s2', 's1']) // newest departure on the first dock
    expect(flow.inboundTrucks.map((t) => t.z)).toEqual(dockZs(DEPTH).slice(0, 2))
  })

  it('counts shipments that do not fit a dock', () => {
    const shipments = Array.from({ length: 6 }, (_, i) => transit(`s${i}`, `2026-10-0${i + 1}T10:00:00Z`))
    const flow = computeFlow(shipments, DEPTH)
    expect(flow.inboundTrucks).toHaveLength(ZONES.dockCount)
    expect(flow.overflow.trucks).toBe(2)
  })

  it('puts received stock on lane pallets, one pallet per 120 units, capped per shipment', () => {
    expect(computeFlow([received('r1', 50)], DEPTH).pallets).toHaveLength(1)
    expect(computeFlow([received('r1', 121)], DEPTH).pallets).toHaveLength(2)
    expect(computeFlow([received('r1', 5000)], DEPTH).pallets).toHaveLength(FLOW.pallet.maxPerGroup)
    expect(computeFlow([received('r1', 60), received('r1', 60)], DEPTH).pallets).toHaveLength(1) // same shipment
  })

  it('spreads shipments over lanes and keeps pallets between the dock and the receiving line', () => {
    const flow = computeFlow([received('a', 10), received('b', 10), received('c', 10)], DEPTH)
    const lanes = new Set(flow.pallets.map((p) => p.position[2]))
    expect(lanes.size).toBe(3)
    for (const p of flow.pallets) {
      expect(p.position[0]).toBeLessThan(ZONES.receivingLineX)
      expect(p.position[0]).toBeGreaterThan(-FLOOR.length / 2)
    }
  })

  it('stops filling a full lane and reports the overflow', () => {
    const shipments = Array.from({ length: 30 }, (_, i) => received(`r${i}`, 10))
    const flow = computeFlow(shipments, DEPTH)
    expect(flow.pallets).toHaveLength(ZONES.dockCount * FLOW.pallet.perLane)
    expect(flow.overflow.pallets).toBe(10)
  })

  it('treats a stock gap with no ref as its own pallet', () => {
    const flow = computeFlow([received(null, 5, { detail: 'INFERRED', source: null }), received(null, 5, { detail: 'INFERRED', source: null })], DEPTH)
    expect(flow.pallets).toHaveLength(2)
  })
})

describe('pack zone', () => {
  it('draws one parcel per packed order line and counts them', () => {
    const flow = computeFlow([...many(12, { status: 'PACKED' }), ...many(3, { status: 'COMMITTED' })], DEPTH)
    expect(flow.packed.count).toBe(12)
    expect(flow.packed.parcels).toHaveLength(12)
    expect(flow.packed.label.text).toBe('PACKED · 12')
  })

  it('keeps parcels between the pack line and the shipping docks, inside the floor', () => {
    const flow = computeFlow(many(70, { status: 'PACKED' }), DEPTH)
    for (const p of flow.packed.parcels) {
      expect(p.position[0]).toBeGreaterThan(ZONES.packLineX)
      expect(p.position[0]).toBeLessThan(FLOW.stack.centerX - 3)
      expect(Math.abs(p.position[2])).toBeLessThan(DEPTH / 2)
    }
  })

  it('stacks a second layer after the first is full and never overlaps', () => {
    const perLayer = FLOW.pack.cols * FLOW.pack.rows
    const flow = computeFlow(many(perLayer + 3, { status: 'PACKED' }), DEPTH)
    const ys = flow.packed.parcels.map((p) => p.position[1])
    expect(new Set(ys).size).toBe(2)
    const keys = flow.packed.parcels.map((p) => p.position.map((v) => v.toFixed(3)).join())
    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe('shipping stacks', () => {
  it('has one stack per carrier at its own dock, even when empty', () => {
    const flow = computeFlow([], DEPTH)
    expect(flow.stacks.map((s) => [s.carrier, s.count, s.dock])).toEqual([
      ['UPS', 0, 0],
      ['USPS', 0, 1],
      ['FedEx', 0, 2],
      ['OTHER', 0, 3],
    ])
    expect(flow.outboundTrucks.map((t) => t.label)).toEqual(['UPS', 'USPS', 'FedEx', 'OTHER'])
  })

  it('counts shipped order lines per carrier, with unknown carriers under OTHER', () => {
    const flow = computeFlow(
      [...many(5, { carrier: 'UPS' }), ...many(2, { carrier: 'usps' }), ...many(1, { carrier: null }), ...many(1, { carrier: 'DHL' })],
      DEPTH,
    )
    expect(flow.stacks.map((s) => s.count)).toEqual([5, 2, 0, 2])
    expect(flow.stacks[0].label.text).toBe('UPS · 5')
  })

  it('leaves stock-gap corrections out of the parcels', () => {
    const flow = computeFlow([...many(3, { carrier: null }), ...many(4, { carrier: null, detail: 'INFERRED', source: null, ref: null })], DEPTH)
    expect(flow.stacks[3].count).toBe(3)
  })

  it('stacks upward, and caps what is drawn but not what is counted', () => {
    const perLayer = FLOW.stack.cols * FLOW.stack.rows
    const flow = computeFlow(many(perLayer * FLOW.stack.layers + 20, { carrier: 'UPS' }), DEPTH)
    expect(flow.stacks[0].count).toBe(perLayer * FLOW.stack.layers + 20)
    expect(flow.stacks[0].parcels).toHaveLength(perLayer * FLOW.stack.layers)
    const top = Math.max(...flow.stacks[0].parcels.map((p) => p.position[1]))
    expect(top).toBeGreaterThan(FLOW.stack.layers * FLOW.parcel.pitch * 0.8)
  })

  it('keeps each stack on its own dock lane, clear of the next one', () => {
    const flow = computeFlow(many(FLOW.stack.cols * FLOW.stack.rows, { carrier: 'FedEx' }), DEPTH)
    const zs = flow.stacks[2].parcels.map((p) => p.position[2])
    const lane = dockZs(DEPTH)[2]
    const gap = dockZs(DEPTH)[1] - dockZs(DEPTH)[0]
    expect(Math.min(...zs)).toBeGreaterThan(lane - gap / 2)
    expect(Math.max(...zs)).toBeLessThan(lane + gap / 2)
  })

  it('puts each count label in front of its stack, off the front-edge floor labels', () => {
    const flow = computeFlow(many(5, { carrier: 'OTHER' }), DEPTH)
    const last = flow.stacks[3]
    expect(last.label.z).toBeGreaterThan(Math.max(...last.parcels.map((p) => p.position[2])))
    expect(last.label.z).toBeLessThan(DEPTH / 2 - 0.55 - 0.35 * 2) // the front-edge labels sit at depth/2 - 0.55
  })
})
