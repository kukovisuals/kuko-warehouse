import { describe, expect, it } from 'vitest'
import { TRUCKS, TruckTracker, type TruckSpec, truckX } from './trucks'
import { TRUCK_REAR_X } from './flow'

const spec = (key: string, over: Partial<TruckSpec> = {}): TruckSpec => ({ key, side: 'outbound', z: 0, signal: 0, enter: 'drive', ...over })
const offsets = (t: TruckTracker, now: number) => Object.fromEntries(t.sample(now).map((p) => [p.id, p.offset]))

describe('TruckTracker', () => {
  it('drives a new truck in from off screen and parks it', () => {
    const t = new TruckTracker()
    t.update([spec('out:UPS')], 0)
    expect(offsets(t, 0)['out:UPS#0']).toBeCloseTo(TRUCKS.offscreen)
    const mid = offsets(t, TRUCKS.arriveSeconds / 2)['out:UPS#0']
    expect(mid).toBeGreaterThan(0)
    expect(mid).toBeLessThan(TRUCKS.offscreen)
    expect(offsets(t, TRUCKS.arriveSeconds + 0.01)['out:UPS#0']).toBe(0)
    expect(t.isAnimating(TRUCKS.arriveSeconds + 0.01)).toBe(false)
  })

  it('staggers the docks', () => {
    const t = new TruckTracker()
    t.update([spec('a'), spec('b'), spec('c')], 0)
    const o = offsets(t, 0.4)
    expect(o['a#0']).toBeLessThan(TRUCKS.offscreen)
    expect(o['c#0']).toBeCloseTo(TRUCKS.offscreen) // c starts at 0.7s
  })

  it('drives a truck out when its key goes away, then forgets it', () => {
    const t = new TruckTracker()
    t.update([spec('in:s1', { side: 'inbound' })], 0)
    t.update([], 10)
    expect(offsets(t, 10)['in:s1#0']).toBeCloseTo(0)
    expect(offsets(t, 10 + TRUCKS.leaveSeconds / 2)['in:s1#0']).toBeGreaterThan(0)
    expect(t.sample(10 + TRUCKS.leaveSeconds + 0.01)).toEqual([])
  })

  it('swaps an outbound truck at the next morning departure: old leaves, a new one pulls in after', () => {
    const t = new TruckTracker()
    t.update([spec('out:UPS', { signal: 5 })], 0)
    t.sample(5)
    t.update([spec('out:UPS', { signal: 6 })], 10) // signal = last departure
    const early = offsets(t, 10.5)
    expect(Object.keys(early).sort()).toEqual(['out:UPS#0', 'out:UPS#1'])
    expect(early['out:UPS#1']).toBeCloseTo(TRUCKS.offscreen)
    const late = offsets(t, 10 + TRUCKS.replaceDelaySeconds + TRUCKS.arriveSeconds + 0.1)
    expect(late).toEqual({ 'out:UPS#1': 0 })
  })

  it('does not swap the truck when the departure signal does not rise', () => {
    const t = new TruckTracker()
    t.update([spec('out:UPS', { signal: 5 })], 0)
    t.update([spec('out:UPS', { signal: 5 })], 10)
    expect(Object.keys(offsets(t, 10.1))).toEqual(['out:UPS#0'])
    expect(offsets(t, 10.1)['out:UPS#0']).toBe(0)
  })

  it('never lets a swapped truck and its successor overlap on the dock', () => {
    const t = new TruckTracker()
    t.update([spec('out:UPS', { signal: 1 })], 0)
    t.sample(20)
    t.update([spec('out:UPS', { signal: 2 })], 20)
    // successor starts only after the old one has fully left
    expect(TRUCKS.replaceDelaySeconds).toBeGreaterThanOrEqual(TRUCKS.leaveSeconds)
  })

  it('swaps a truck that moves to another dock', () => {
    const t = new TruckTracker()
    t.update([spec('in:s1', { side: 'inbound', z: 1 })], 0)
    t.update([spec('in:s1', { side: 'inbound', z: 5 })], 10)
    const zs = t.sample(10.1).map((p) => p.z).sort()
    expect(zs).toEqual([1, 5])
  })

  it('has parked trucks already at the dock on the first load, but drives later arrivals in', () => {
    const t = new TruckTracker()
    t.update([spec('out:UPS', { enter: 'parked' }), spec('in:s1', { side: 'inbound' })], 0)
    expect(offsets(t, 0)['out:UPS#0']).toBe(0)
    expect(offsets(t, 0)['in:s1#0']).toBeCloseTo(TRUCKS.offscreen)
    expect(t.isAnimating(0.1)).toBe(true) // the inbound truck
    t.update([spec('out:UPS', { enter: 'parked' }), spec('out:USPS', { enter: 'parked' })], 20)
    expect(offsets(t, 20)['out:USPS#0']).toBeGreaterThan(0) // not the first load: it drives in
  })

  it('snaps when instant', () => {
    const t = new TruckTracker({ instant: true })
    t.update([spec('a')], 0)
    expect(offsets(t, 0)).toEqual({ 'a#0': 0 })
    t.update([], 1)
    expect(t.sample(1)).toEqual([])
  })
})

describe('truckX', () => {
  it('moves away from the building', () => {
    expect(truckX('inbound', 0)).toBe(TRUCK_REAR_X.inbound)
    expect(truckX('inbound', 5)).toBeLessThan(TRUCK_REAR_X.inbound)
    expect(truckX('outbound', 5)).toBeGreaterThan(TRUCK_REAR_X.outbound)
  })
})
