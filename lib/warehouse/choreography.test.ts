import { describe, expect, it } from 'vitest'
import type { ApiInventoryLevel, ApiMovement, ApiProduct } from '@/lib/api-types'
import { buildLoop, LOOP, loopSource, sceneAt, staticScene } from './choreography'
import { computeFlow, FLOW, TRUCK_REAR_X } from './flow'
import { computeLayout } from './layout'
import { TRUCKS } from './trucks'

const products: ApiProduct[] = Array.from({ length: 6 }, (_, i) => ({
  id: `p${i}`,
  title: `Product ${i}`,
  category: 'A',
  variants: [{ id: `v${i}`, sku: `S${i}`, options: {} }],
}))
const levels: ApiInventoryLevel[] = products.map((p) => ({ variantId: p.variants[0].id, onHand: 50, available: 50, committed: 0, incoming: 0 }))
const layout = computeLayout(products, levels)

const local = (hour: number, minute = 0) => new Date(2026, 9, 8, hour, minute).toISOString()
let n = 0
const mv = (over: Partial<ApiMovement>): ApiMovement => ({
  id: `mv-${++n}`,
  direction: 'OUT',
  variantId: `v${n % 6}`,
  quantity: 5,
  status: 'SHIPPED',
  source: 'ORDER',
  detail: 'FULL',
  ref: `ref-${n}`,
  createdAt: local(9),
  shippedAt: local(10),
  doneAt: local(10),
  statusAt: local(10),
  carrier: ['UPS', 'USPS', 'FedEx', null][n % 4],
  ...over,
})
const many = (count: number, over: Partial<ApiMovement>) => Array.from({ length: count }, () => mv(over))
const received = (ref: string, quantity: number) =>
  mv({ direction: 'IN', status: 'RECEIVED', source: 'TRANSFER', ref, quantity, carrier: null, doneAt: local(11) })
const transit = (ref: string) =>
  mv({ direction: 'IN', status: 'IN_TRANSIT', source: 'TRANSFER', ref, carrier: null, doneAt: null, shippedAt: local(9) })

const day = [
  received('s1', 400),
  received('s2', 250),
  received('s3', 20),
  transit('t1'),
  ...many(40, { status: 'PACKED', statusAt: local(12) }),
  ...many(60, { status: 'SHIPPED', doneAt: local(12) }),
]
const flow = computeFlow(day, layout, local(15))
const loop = buildLoop(flow)
const inboundSpecs = (t: number) => sceneAt(loop, t).trucks.filter((s) => s.side === 'inbound')

describe('buildLoop', () => {
  it('is at least the minimum length and every block is on screen for some time inside it', () => {
    expect(loop.length).toBeGreaterThanOrEqual(LOOP.minSeconds)
    for (const b of loop.blocks) {
      expect(b.appear).toBeGreaterThanOrEqual(0)
      expect(b.vanish).toBeGreaterThan(b.appear)
      expect(b.vanish).toBeLessThanOrEqual(loop.length)
    }
  })

  it('uses every block of the flow exactly once', () => {
    const ids = loop.blocks.map((b) => b.block.id)
    const expected = [...flow.pallets, ...flow.packed.parcels, ...flow.stacks.flatMap((s) => s.parcels)].map((b) => b.id)
    expect([...ids].sort()).toEqual([...expected].sort())
  })

  describe('receiving', () => {
    const deliveries = flow.deliveries.filter((d) => d.status === 'RECEIVED')

    it('brings the truck in before any of its pallets come out, one pallet at a time', () => {
      expect(deliveries.length).toBeGreaterThan(0)
      for (const d of deliveries) {
        const truck = loop.inboundTrucks.find((t) => t.spec.key === `in:${d.key}`)!
        const times = d.palletIds.map((id) => loop.blocks.find((b) => b.block.id === id)!.appear)
        expect(times[0]).toBeGreaterThanOrEqual(truck.from + TRUCKS.arriveSeconds)
        for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1]).toBeCloseTo(LOOP.unloadStepSeconds)
      }
    })

    it('keeps the truck at the dock until its last pallet is out, then sends it away', () => {
      for (const d of deliveries) {
        const truck = loop.inboundTrucks.find((t) => t.spec.key === `in:${d.key}`)!
        const last = Math.max(...d.palletIds.map((id) => loop.blocks.find((b) => b.block.id === id)!.appear))
        expect(truck.to).toBeGreaterThanOrEqual(last + LOOP.palletTripSeconds)
      }
    })

    it('never has two inbound trucks at the same dock at once', () => {
      for (let t = 0; t < loop.length; t += 0.25) {
        const zs = inboundSpecs(t).map((s) => s.z)
        expect(new Set(zs).size).toBe(zs.length)
      }
    })

    it('still brings an in-transit truck in, waits, and sends it away', () => {
      const truck = loop.inboundTrucks.find((t) => t.spec.key === 'in:t1')!
      expect(truck.to - truck.from).toBeGreaterThanOrEqual(TRUCKS.arriveSeconds + LOOP.waitSeconds)
    })

    it('puts the pallets away at the end of the day', () => {
      for (const d of deliveries)
        for (const id of d.palletIds) expect(loop.blocks.find((b) => b.block.id === id)!.vanish).toBeCloseTo(loop.length - LOOP.putAwaySeconds)
    })
  })

  describe('packed', () => {
    it('shows parcels one at a time, in order', () => {
      const times = flow.packed.parcels.map((p) => loop.blocks.find((b) => b.block.id === p.id)!.appear)
      for (let i = 1; i < times.length; i++) expect(times[i]).toBeGreaterThan(times[i - 1])
      expect(times[0]).toBeGreaterThanOrEqual(LOOP.packStartSeconds)
      expect(times[times.length - 1]).toBeLessThanOrEqual(LOOP.packStartSeconds + LOOP.packSpanSeconds)
    })
  })

  describe('shipping', () => {
    const shipped = loop.blocks.filter((b) => b.load)

    it('has parcels reach their stacks, then load into their truck, then vanish inside it', () => {
      expect(shipped.length).toBe(60 - 0) // all shipped lines in the stacks
      for (const b of shipped) {
        expect(b.load!.at).toBeGreaterThan(b.appear)
        expect(b.vanish).toBeGreaterThan(b.load!.at + LOOP.loadTripSeconds)
        // The cargo spot is inside a parked outbound truck: past the dock, off the floor.
        expect(b.load!.to[0]).toBeGreaterThan(TRUCK_REAR_X.outbound)
        expect(b.load!.to[0]).toBeLessThan(TRUCK_REAR_X.outbound + FLOW.truck.length)
        expect(b.load!.to[1]).toBeGreaterThan(0.45)
      }
    })

    it('sends each truck away only after all of its parcels are loaded, and an empty one follows', () => {
      loop.outbound.forEach((dock) => {
        const ownLoads = loop.blocks.filter((b) => b.load && b.load.to[2] === dock.z).map((b) => b.load!.at + LOOP.loadTripSeconds)
        expect(dock.departAt).toBeGreaterThanOrEqual(Math.max(0, ...ownLoads))
        expect(dock.nextAt - dock.departAt).toBeGreaterThanOrEqual(TRUCKS.leaveSeconds) // clear of the dock
      })
    })

    it('fills the carriers together, not one after another', () => {
      const first = flow.stacks.map((s) => loop.blocks.find((b) => b.block.id === s.parcels[0].id)!.appear)
      expect(Math.max(...first) - Math.min(...first)).toBeLessThan(2)
    })
  })
})

describe('sceneAt', () => {
  it('starts with the racks full, nothing unloaded yet, and the outbound trucks parked', () => {
    const scene = sceneAt(loop, 0)
    expect(scene.items).toHaveLength(0)
    expect(scene.trucks.filter((s) => s.side === 'outbound')).toHaveLength(4)
  })

  it('shows a block only between its appear and vanish times', () => {
    const b = loop.blocks.find((x) => x.block.id === flow.packed.parcels[3].id)!
    const at = (t: number) => sceneAt(loop, t).items.some((i) => i.id === b.block.id)
    expect(at(b.appear - 0.01)).toBe(false)
    expect(at(b.appear + 0.01)).toBe(true)
    expect(at(b.vanish - 0.01)).toBe(true)
    expect(at(b.vanish + 0.01)).toBe(false)
  })

  it('moves a shipped parcel into its truck when its turn to load comes', () => {
    const b = loop.blocks.find((x) => x.load)!
    const before = sceneAt(loop, b.load!.at - 0.01).items.find((i) => i.id === b.block.id)!
    const after = sceneAt(loop, b.load!.at + 0.01).items.find((i) => i.id === b.block.id)!
    expect(before.position).toEqual(b.block.position)
    expect(after.position).toEqual(b.load!.to)
    expect(after.hop).toBe(false)
  })

  it('lets one outbound truck leave and the empty one arrive, with exactly one parked at the dock at the quiet moments', () => {
    const outKeys = (t: number) => sceneAt(loop, t).trucks.filter((s) => s.side === 'outbound' && s.z === loop.outbound[0].z).map((s) => s.key)
    const d = loop.outbound[0]
    expect(outKeys(d.departAt - 0.1)).toHaveLength(1)
    expect(outKeys(d.departAt + 0.5)).toHaveLength(0) // leaving: gone from the specs, the tracker drives it out
    expect(outKeys(d.nextAt + 0.1)).toHaveLength(1)
    expect(outKeys(d.departAt - 0.1)[0]).not.toBe(outKeys(d.nextAt + 0.1)[0])
  })

  it('carries the day over seamlessly: the truck that ends one day is the one that starts the next', () => {
    const outbound = (t: number) => sceneAt(loop, t).trucks.filter((s) => s.side === 'outbound').map((s) => s.key).sort()
    const endOfDay = outbound(loop.length - 0.01)
    const startOfNext = outbound(loop.length + 0.01)
    expect(startOfNext).toEqual(endOfDay)
    // ...and it alternates, so a day later the other truck of each pair is the loaded one.
    expect(outbound(0.01)).not.toEqual(outbound(loop.length + 0.01))
    expect(outbound(0.01)).toEqual(outbound(2 * loop.length + 0.01))
  })

  it('repeats exactly: the same moment in every day shows the same blocks', () => {
    const ids = (t: number) => sceneAt(loop, t).items.map((i) => i.id).sort()
    expect(ids(17.3)).toEqual(ids(17.3 + loop.length))
    expect(ids(17.3)).toEqual(ids(17.3 + 5 * loop.length))
  })

  it('has everything put away by the end, so the next day starts clean', () => {
    expect(sceneAt(loop, loop.length - 0.01).items).toHaveLength(0)
  })

  it('does not carry the first-load flags into the loop', () => {
    const items = sceneAt(loop, loop.length * 0.5).items
    expect(items.every((i) => i.settled === undefined && i.step === undefined)).toBe(true)
  })
})

describe('loopSource', () => {
  it('rebuilds on a grid of ticks and hands back the same arrays in between', () => {
    const source = loopSource(loop)
    const first = source.items(10.01)
    expect(source.items(10.15)).toBe(first)
    expect(source.trucks(10.15)).toBe(source.trucks(10.01))
    expect(source.items(10.0 + LOOP.tickSeconds + 0.01)).not.toBe(first)
  })
})

describe('an empty warehouse', () => {
  it('still loops: outbound trucks, no blocks', () => {
    const empty = buildLoop(computeFlow([], layout, null))
    expect(empty.length).toBeGreaterThanOrEqual(LOOP.minSeconds)
    expect(empty.blocks).toHaveLength(0)
    expect(sceneAt(empty, 3).trucks.filter((s) => s.side === 'outbound')).toHaveLength(4)
  })
})

describe('staticScene', () => {
  it('is the data as it is: every block, first-load flags kept, trucks as the flow has them', () => {
    const scene = staticScene(flow)
    expect(scene.items).toHaveLength(loop.blocks.length)
    expect(scene.items.some((i) => i.settled)).toBe(true)
    expect(scene.trucks.filter((t) => t.side === 'outbound')).toHaveLength(4)
  })
})
