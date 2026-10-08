// Truck arrivals and departures between data refreshes. Pure: time is passed in.
// A truck is known by `key`. New key -> drives in. Key gone -> drives out.
// An outbound truck whose `signal` (its last departure) goes up, or whose dock changes, leaves and an empty one pulls in.

import type { Flow } from './flow'
import { TRUCK_REAR_X } from './flow'

export interface TruckSpec {
  key: string
  side: 'inbound' | 'outbound'
  z: number
  /** Outbound: when the trucks last left. A rise means a truck just left. */
  signal: number
  /** `parked`: already at the dock when the page opens, with no entrance. Later arrivals always drive in. */
  enter: 'drive' | 'parked'
}

export interface TruckPose {
  /** Unique per truck on screen: a replaced truck and its successor never share one. */
  id: string
  side: TruckSpec['side']
  z: number
  /** Distance from the parked spot, away from the building. 0 = parked. */
  offset: number
}

export const TRUCKS = {
  arriveSeconds: 2.2,
  leaveSeconds: 1.8,
  /** Docks start one after another. */
  staggerSeconds: 0.35,
  /** The replacement waits for the old truck to clear the dock. */
  replaceDelaySeconds: 2,
  /** Far enough to be out of view. */
  offscreen: 18,
} as const

interface Entity {
  key: string
  gen: number
  side: TruckSpec['side']
  z: number
  signal: number
  leaving: boolean
  start: number
}

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3)
const easeInCubic = (t: number) => t * t * t

export function truckSpecs(flow: Flow): TruckSpec[] {
  return [
    ...flow.inboundTrucks.map((t): TruckSpec => ({ key: `in:${t.label}`, side: 'inbound', z: t.z, signal: 0, enter: 'drive' })),
    ...flow.outboundTrucks.map((t): TruckSpec => ({
      key: `out:${t.label}`,
      side: 'outbound',
      z: t.z,
      signal: flow.departure,
      enter: 'parked',
    })),
  ]
}

/** World x of a truck's group origin (its rear) at a given offset from parked. */
export function truckX(side: TruckSpec['side'], offset: number): number {
  return TRUCK_REAR_X[side] + (side === 'inbound' ? -offset : offset)
}

export class TruckTracker {
  private entities: Entity[] = []
  private started = false
  private readonly instant: boolean

  constructor(options: { instant?: boolean } = {}) {
    this.instant = options.instant ?? false
  }

  update(specs: TruckSpec[], now: number): void {
    const firstLoad = !this.started
    this.started = true
    const keys = new Set(specs.map((s) => s.key))
    for (const e of this.entities) {
      if (!e.leaving && !keys.has(e.key)) this.leave(e, now)
    }

    let arrivals = 0 // trucks that arrive together start one after another
    for (const spec of specs) {
      const current = this.entities.find((e) => e.key === spec.key && !e.leaving)
      if (!current) {
        const gen = 1 + Math.max(-1, ...this.entities.filter((e) => e.key === spec.key).map((e) => e.gen))
        const parked = firstLoad && spec.enter === 'parked'
        this.arrive(spec, gen, parked ? -Infinity : now + arrivals++ * TRUCKS.staggerSeconds)
        continue
      }
      if (spec.z !== current.z || spec.signal > current.signal) {
        this.leave(current, now)
        this.arrive(spec, current.gen + 1, now + TRUCKS.replaceDelaySeconds)
        continue
      }
      current.signal = spec.signal
    }
  }

  sample(now: number): TruckPose[] {
    this.entities = this.entities.filter((e) => !(e.leaving && now >= e.start + this.seconds(e)))
    return this.entities.map((e) => {
      const p = Math.min(1, Math.max(0, (now - e.start) / this.seconds(e)))
      const offset = this.instant
        ? e.leaving ? TRUCKS.offscreen : 0
        : e.leaving ? TRUCKS.offscreen * easeInCubic(p) : TRUCKS.offscreen * (1 - easeOutCubic(p))
      return { id: `${e.key}#${e.gen}`, side: e.side, z: e.z, offset }
    })
  }

  isAnimating(now: number): boolean {
    return this.entities.some((e) => now < e.start + this.seconds(e))
  }

  private seconds(e: Entity): number {
    if (this.instant) return 0
    return e.leaving ? TRUCKS.leaveSeconds : TRUCKS.arriveSeconds
  }

  private arrive(spec: TruckSpec, gen: number, start: number) {
    this.entities.push({ key: spec.key, gen, side: spec.side, z: spec.z, signal: spec.signal, leaving: false, start: this.instant ? -Infinity : start })
  }

  private leave(e: Entity, now: number) {
    e.leaving = true
    e.start = now
    if (this.instant) this.entities = this.entities.filter((x) => x !== e)
  }
}
