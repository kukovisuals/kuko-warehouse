// A looping "day" built from the real flow: pure, no clock. Time is passed in as seconds since the page opened.
//
//   Receiving  each delivery: a truck pulls in at its dock, its pallets slide out of the cargo area onto the lane one by
//              one, the truck drives off, and the next delivery for that dock starts.
//   Packed     parcels appear one at a time on their product's rack row.
//   Shipping   parcels move one at a time into their carrier's stack. Then each stack loads into its truck, the truck
//              leaves, and an empty one pulls in.
//   End of day pallets and packed parcels are put away (shrink out) and the day starts again.
//
// The tracker in motion.ts / trucks.ts does the tweening; this only decides what is on screen at each moment.

import type { Block, Flow } from './flow'
import { FLOW, TRUCK_REAR_X } from './flow'
import type { Item, V3 } from './motion'
import { TRUCKS, type TruckSpec, truckSpecs } from './trucks'

export const LOOP = {
  /** Seconds between rebuilding the scene. Parcels and pallets are placed on this grid of time. */
  tickSeconds: 0.2,
  minSeconds: 45,
  /** Receiving */
  dockOffsetSeconds: 2.5,
  unloadDelaySeconds: 0.4,
  unloadStepSeconds: 1.3,
  palletTripSeconds: 1.6,
  holdSeconds: 0.8,
  gapSeconds: 1,
  /** A truck that is still in transit just pulls in, waits, and leaves. */
  waitSeconds: 6,
  /** Packed */
  packStartSeconds: 3,
  packStepSeconds: 0.3,
  packSpanSeconds: 22,
  /** Shipping */
  shipStartSeconds: 14,
  shipStepSeconds: 0.2,
  shipSpanSeconds: 18,
  loadMinStartSeconds: 30,
  loadStepSeconds: 0.15,
  loadSpanSeconds: 5,
  loadTripSeconds: 0.8,
  departStaggerSeconds: 0.4,
  /** End of day */
  tailSeconds: 1.5,
  putAwaySeconds: 1,
} as const

interface TimedBlock {
  block: Block
  appear: number
  vanish: number
  /** A shipped parcel is loaded into its truck at `at`, then disappears inside it. */
  load?: { at: number; to: V3 }
}

interface TimedTruck {
  spec: TruckSpec
  from: number
  to: number
}

interface OutboundDock {
  carrier: string
  z: number
  /** The loaded truck leaves at `departAt`; the empty one that follows pulls in at `nextAt`. */
  departAt: number
  nextAt: number
}

export interface Loop {
  length: number
  blocks: TimedBlock[]
  inboundTrucks: TimedTruck[]
  outbound: OutboundDock[]
}

/** Inside a parked outbound truck, where loaded parcels end up. */
const cargoSpot = (z: number): V3 => [TRUCK_REAR_X.outbound + FLOW.truck.length * 0.4, 1.3, z]

export function buildLoop(flow: Flow): Loop {
  const blocks: TimedBlock[] = []
  const inboundTrucks: TimedTruck[] = []

  // Receiving: deliveries queue up dock by dock.
  const byDock = new Map<number, typeof flow.deliveries>()
  for (const d of flow.deliveries) byDock.set(d.dock, [...(byDock.get(d.dock) ?? []), d])
  const palletById = new Map(flow.pallets.map((p) => [p.id, p]))
  let receivingEnd = 0
  for (const [dock, queue] of byDock) {
    let t = dock * LOOP.dockOffsetSeconds
    for (const delivery of queue) {
      const arrived = t + TRUCKS.arriveSeconds
      const n = delivery.palletIds.length
      delivery.palletIds.forEach((id, j) => {
        const block = palletById.get(id)
        if (block) blocks.push({ block, appear: arrived + LOOP.unloadDelaySeconds + j * LOOP.unloadStepSeconds, vanish: Infinity })
      })
      const unloaded =
        n > 0
          ? arrived + LOOP.unloadDelaySeconds + (n - 1) * LOOP.unloadStepSeconds + LOOP.palletTripSeconds
          : arrived + LOOP.waitSeconds
      const leaveAt = unloaded + LOOP.holdSeconds
      inboundTrucks.push({
        spec: { key: `in:${delivery.key}`, side: 'inbound', z: delivery.z, signal: 0, enter: 'drive' },
        from: t,
        to: leaveAt,
      })
      t = leaveAt + TRUCKS.leaveSeconds + LOOP.gapSeconds
    }
    receivingEnd = Math.max(receivingEnd, t)
  }

  // Packed: one at a time.
  const packed = flow.packed.parcels
  const packStep = Math.min(LOOP.packStepSeconds, LOOP.packSpanSeconds / Math.max(1, packed.length))
  packed.forEach((block, i) => blocks.push({ block, appear: LOOP.packStartSeconds + i * packStep, vanish: Infinity }))

  // Shipping: parcels reach their stacks one at a time, round-robin so every carrier fills up together.
  const rounds = Math.max(0, ...flow.stacks.map((s) => s.parcels.length))
  const shippedOrder: { stack: number; rank: number; block: Block }[] = []
  for (let rank = 0; rank < rounds; rank++)
    flow.stacks.forEach((s, stack) => {
      if (s.parcels[rank]) shippedOrder.push({ stack, rank, block: s.parcels[rank] })
    })
  const shipStep = Math.min(LOOP.shipStepSeconds, LOOP.shipSpanSeconds / Math.max(1, shippedOrder.length))
  const shipEnd = LOOP.shipStartSeconds + shippedOrder.length * shipStep
  const loadStart = Math.max(LOOP.loadMinStartSeconds, shipEnd + 2.5)

  // Then every stack loads into its truck, and the trucks leave.
  const loadSteps = flow.stacks.map((s) => Math.min(LOOP.loadStepSeconds, LOOP.loadSpanSeconds / Math.max(1, s.parcels.length)))
  const loadEnd = loadStart + Math.max(0, ...flow.stacks.map((s, i) => s.parcels.length * loadSteps[i]))
  const outbound: OutboundDock[] = flow.stacks.map((s, i) => {
    const departAt = loadEnd + LOOP.loadTripSeconds + 0.7 + i * LOOP.departStaggerSeconds
    return { carrier: s.carrier, z: flow.outboundTrucks[i].z, departAt, nextAt: departAt + TRUCKS.replaceDelaySeconds }
  })
  shippedOrder.forEach(({ stack, rank, block }, k) => {
    const at = loadStart + rank * loadSteps[stack]
    blocks.push({
      block,
      appear: LOOP.shipStartSeconds + k * shipStep,
      // Gone a moment after it reaches the inside of the truck, where it cannot be seen.
      vanish: at + LOOP.loadTripSeconds + 0.3,
      load: { at, to: cargoSpot(outbound[stack].z) },
    })
  })

  const lastArrival = Math.max(0, ...outbound.map((o) => o.nextAt + TRUCKS.arriveSeconds))
  const length = Math.max(LOOP.minSeconds, receivingEnd, lastArrival) + LOOP.tailSeconds
  for (const b of blocks) if (b.vanish === Infinity) b.vanish = length - LOOP.putAwaySeconds

  return { length, blocks, inboundTrucks, outbound }
}

export interface LoopScene {
  items: Item[]
  trucks: TruckSpec[]
}

/** What is on screen `elapsed` seconds into the loop (it repeats forever). */
export function sceneAt(loop: Loop, elapsed: number): LoopScene {
  const cycle = Math.floor(elapsed / loop.length)
  const t = elapsed - cycle * loop.length

  const items: Item[] = []
  for (const { block, appear, vanish, load } of loop.blocks) {
    if (t < appear || t >= vanish) continue
    const loading = load !== undefined && t >= load.at
    items.push({
      id: block.id,
      position: loading ? load.to : block.position,
      size: block.size,
      color: block.color,
      from: block.from,
      // Unloading and loading slide along the floor; packed and shipped parcels hop.
      hop: loading ? false : block.hop,
      seconds: loading ? LOOP.loadTripSeconds : block.seconds,
      grow: block.grow,
    })
  }

  const trucks: TruckSpec[] = []
  for (const truck of loop.inboundTrucks) if (t >= truck.from && t < truck.to) trucks.push(truck.spec)
  // The two outbound trucks per dock take turns across days, so a day's last truck is the next day's first.
  const key = (carrier: string, n: number) => `out:${carrier}:${((n % 2) + 2) % 2}`
  for (const dock of loop.outbound) {
    const spec = (n: number): TruckSpec => ({ key: key(dock.carrier, n), side: 'outbound', z: dock.z, signal: 0, enter: 'parked' })
    if (t < dock.departAt) trucks.push(spec(cycle))
    if (t >= dock.nextAt) trucks.push(spec(cycle + 1))
  }
  return { items, trucks }
}

/** `sceneAt` on a grid of LOOP.tickSeconds, so the scene is rebuilt a few times a second and not every frame. */
export function loopSource(loop: Loop) {
  let tick = NaN
  let scene: LoopScene = { items: [], trucks: [] }
  const refresh = (elapsed: number) => {
    const next = Math.floor(elapsed / LOOP.tickSeconds)
    if (next === tick) return
    tick = next
    scene = sceneAt(loop, next * LOOP.tickSeconds)
  }
  return {
    items: (elapsed: number) => (refresh(elapsed), scene.items),
    trucks: (elapsed: number) => (refresh(elapsed), scene.trucks),
  }
}

/** The scene with no loop: just the data as it is now (for reduced motion). Blocks that moved or arrived are tweened. */
export function staticScene(flow: Flow): LoopScene {
  const blocks = [...flow.pallets, ...flow.packed.parcels, ...flow.stacks.flatMap((s) => s.parcels)]
  return {
    items: blocks.map((b) => ({
      id: b.id,
      position: b.position,
      size: b.size,
      color: b.color,
      from: b.from,
      settled: b.settled,
      step: b.step,
      seconds: b.seconds,
      hop: b.hop,
      grow: b.grow,
    })),
    trucks: truckSpecs(flow),
  }
}
