// Pure flow layout: movements in, trucks / pallets / parcels / stacks out.
// Coordinates match layout.ts: front is +z, inbound docks on the left edge, outbound on the right.
//
// Rules (wiki/api.md draw rules, plus choices not in the wiki yet):
//  - IN_TRANSIT shipment  -> one truck at a dock. RECEIVED shipment -> pallets on a receiving lane, no truck.
//  - One shipment = all lines with the same `ref`. A stock gap (no ref) is its own shipment.
//  - PACKED order line    -> one parcel in the pack zone, on the same row as its product's rack, in the product's color.
//  - SHIPPED order line   -> one parcel, same color, in its carrier's stack. Dock i = carrier i (UPS, USPS, FedEx, OTHER).
//  - Outbound trucks leave every morning (DEPARTURE_HOUR) with everything shipped so far, so a stack holds only what
//    shipped since the last departure. No delivery data is needed.
//  - INFERRED OUT movements are stock-gap corrections, not orders, so they are not parcels.

import type { ApiMovement } from '@/lib/api-types'
import { COLORS } from '@/lib/theme'
import { dockZs, FLOOR, RACK, type WarehouseLayout } from './layout'

export const CARRIERS = ['UPS', 'USPS', 'FedEx', 'OTHER'] as const
export type Carrier = (typeof CARRIERS)[number]

const TRUCK = { length: 5.2, width: 1.9, gapToDock: 0.4 }
/** Height of a truck's cargo floor above the ground. */
const TRUCK_BED = 0.45

/** Local hour the outbound trucks leave each morning. */
export const DEPARTURE_HOUR = 8

/** The most recent departure at or before `now` (ms): today's DEPARTURE_HOUR, or yesterday's if it hasn't come yet. */
export function lastDeparture(now: number): number {
  const d = new Date(now)
  d.setHours(DEPARTURE_HOUR, 0, 0, 0)
  if (d.getTime() > now) d.setDate(d.getDate() - 1)
  return d.getTime()
}

export const FLOW = {
  truck: TRUCK,
  /** Room outside the floor plate for parked trucks; the camera fits the floor plus this. */
  apron: TRUCK.length + TRUCK.gapToDock,
  pallet: { size: [1, 0.8, 1] as [number, number, number], pitch: 1.2, perLane: 5, unitsPerPallet: 120, maxPerGroup: 4, firstX: -14 },
  parcel: { size: 0.6, pitch: 0.7 },
  /** Packed parcels stack along their product's rack row: `lanes` across the row, `cols` along x from `x0`. */
  pack: { cols: 9, lanes: 2, layers: 6, x0: 6.5, step: 0.12, maxSeconds: 8 },
  /** Stacks sit slightly toward the back of their lane so the count label clears the front-edge floor labels. */
  stack: { cols: 6, rows: 4, layers: 10, centerX: 16.4, offsetZ: -0.9 },
} as const

export interface Block {
  /** Stable across refreshes, so a block that moves is animated instead of redrawn. */
  id: string
  /** Where a block that is new on screen starts from. Without it, it pops in place. */
  from?: [number, number, number]
  /** Already there when the page opens: no entrance on the first load. */
  settled?: boolean
  /** Seconds between this block and the previous one in the same refresh. Bigger = one at a time. */
  step?: number
  /** Trip length in seconds, and whether it hops or slides, and whether it grows in. See motion.ts. */
  seconds?: number
  hop?: boolean
  grow?: boolean
  position: [number, number, number]
  size: [number, number, number]
  color: string
}

export interface Truck {
  dock: number
  z: number
  /** Shipment ref (inbound) or carrier (outbound). */
  label: string
}

export interface FloorText {
  text: string
  x: number
  z: number
}

export interface ParcelGroup {
  /** Movements counted, which can exceed the parcels drawn when the stack is full. */
  count: number
  parcels: Block[]
  label: FloorText
}

export interface CarrierStack extends ParcelGroup {
  carrier: Carrier
  dock: number
}

/** One inbound shipment at a dock: a truck pulls in and, if it was received, its pallets come out onto that lane. */
export interface Delivery {
  key: string
  status: 'IN_TRANSIT' | 'RECEIVED'
  dock: number
  z: number
  palletIds: string[]
}

export interface Flow {
  deliveries: Delivery[]
  inboundTrucks: Truck[]
  outboundTrucks: Truck[]
  pallets: Block[]
  packed: ParcelGroup
  stacks: CarrierStack[]
  /** When the outbound trucks last left (ms). A new value means a truck just left. */
  departure: number
  /** Inbound shipments that did not fit a dock or lane. */
  overflow: { trucks: number; pallets: number }
}

export function carrierOf(carrier: string | null): Carrier {
  const match = CARRIERS.find((c) => c !== 'OTHER' && c.toLowerCase() === carrier?.trim().toLowerCase())
  return match ?? 'OTHER'
}

interface Shipment {
  key: string
  status: ApiMovement['status']
  quantity: number
  createdAt: number
  shippedAt: number
}

/** One movement per variant line: lines with the same `ref` are one shipment. Gaps (no ref) stand alone. */
function groupShipments(movements: ApiMovement[]): Shipment[] {
  const groups = new Map<string, Shipment>()
  for (const m of movements) {
    const key = m.ref ?? `movement:${m.id}`
    const g = groups.get(key)
    if (g) {
      g.quantity += m.quantity
    } else {
      groups.set(key, {
        key,
        status: m.status,
        quantity: m.quantity,
        createdAt: Date.parse(m.createdAt),
        shippedAt: m.shippedAt ? Date.parse(m.shippedAt) : -Infinity,
      })
    }
  }
  return [...groups.values()]
}

function palletCount(quantity: number): number {
  return Math.min(FLOW.pallet.maxPerGroup, Math.max(1, Math.ceil(quantity / FLOW.pallet.unitsPerPallet)))
}

function inbound(movements: ApiMovement[], docks: number[]) {
  const shipments = groupShipments(movements.filter((m) => m.direction === 'IN'))
  const deliveries: Delivery[] = []

  // In transit: a truck at a dock, newest departure first.
  const transit = shipments
    .filter((s) => s.status === 'IN_TRANSIT')
    .sort((a, b) => b.shippedAt - a.shippedAt || a.key.localeCompare(b.key))
  const trucks: Truck[] = transit.slice(0, docks.length).map((s, dock) => ({ dock, z: docks[dock], label: s.key }))
  for (const t of trucks) deliveries.push({ key: t.label, status: 'IN_TRANSIT', dock: t.dock, z: t.z, palletIds: [] })

  // Received: a shipment's pallets all go on one lane (the emptiest), so one truck unloads onto one lane.
  // Newest first, so the oldest ones overflow.
  const received = shipments
    .filter((s) => s.status === 'RECEIVED')
    .sort((a, b) => b.createdAt - a.createdAt || a.key.localeCompare(b.key))
  const load = docks.map(() => 0)
  const pallets: Block[] = []
  let palletOverflow = 0
  for (const s of received) {
    const lane = load.indexOf(Math.min(...load))
    const palletIds: string[] = []
    for (let n = 0; n < palletCount(s.quantity); n++) {
      if (load[lane] >= FLOW.pallet.perLane) {
        palletOverflow++
        continue
      }
      const [w, h, d] = FLOW.pallet.size
      const id = `${s.key}#${n}`
      pallets.push({
        id,
        // Comes out of the truck's cargo area, flat along the floor, already full size.
        from: [TRUCK_REAR_X.inbound - FLOW.truck.length * 0.4, TRUCK_BED + h / 2, docks[lane]],
        hop: false,
        grow: false,
        seconds: 1.6,
        position: [FLOW.pallet.firstX - load[lane] * FLOW.pallet.pitch, h / 2, docks[lane]],
        size: [w, h, d],
        color: COLORS.inbound,
      })
      palletIds.push(id)
      load[lane]++
    }
    if (palletIds.length > 0) deliveries.push({ key: s.key, status: 'RECEIVED', dock: lane, z: docks[lane], palletIds })
  }
  return { deliveries, trucks, pallets, overflow: { trucks: transit.length - trucks.length, pallets: palletOverflow } }
}

/** Parcels in a grid of `cols` (along x) × `rows` (along z), filled layer by layer, row-major. */
function gridParcels(
  parcels: { id: string; color: string; from: [number, number, number] }[],
  grid: { cols: number; rows: number; layers: number },
  centerX: number,
  centerZ: number,
  settled: boolean,
): Block[] {
  const { size, pitch } = FLOW.parcel
  const perLayer = grid.cols * grid.rows
  return parcels.slice(0, perLayer * grid.layers).map((parcel, i) => {
    const layer = Math.floor(i / perLayer)
    const col = (i % perLayer) % grid.cols
    const row = Math.floor((i % perLayer) / grid.cols)
    return {
      ...parcel,
      settled,
      position: [
        centerX + (col - (grid.cols - 1) / 2) * pitch,
        layer * pitch + size / 2,
        centerZ + (row - (grid.rows - 1) / 2) * pitch,
      ],
      size: [size, size, size],
    }
  })
}

/** Orders only: stock-gap corrections (INFERRED) are not parcels. */
const isOrderLine = (m: ApiMovement) => m.direction === 'OUT' && m.detail !== 'INFERRED'

/** Where each variant lives: its product's rack row (z) and its color. */
function variantSpots(layout: WarehouseLayout) {
  return new Map(layout.rows.flatMap((row) => row.blocks.map((b) => [b.variantId, { z: row.z, color: b.color }] as const)))
}

const RACK_END_X = RACK.startX + RACK.baysPerRow * RACK.bayLength

export function computeFlow(movements: ApiMovement[], layout: WarehouseLayout, computedAt: string | null): Flow {
  const docks = dockZs(layout.floorDepth)
  const { deliveries, trucks, pallets, overflow } = inbound(movements, docks)
  const spots = variantSpots(layout)
  const spotOf = (variantId: string) => spots.get(variantId) ?? { z: 0, color: COLORS.label }
  const departure = computedAt ? lastDeparture(Date.parse(computedAt)) : 0

  // Oldest first: a new parcel lands on top of a stack or at the end of a row, and the rest stay put.
  const oldestFirst = (time: (m: ApiMovement) => string | null) => (a: ApiMovement, b: ApiMovement) =>
    Date.parse(time(a) ?? a.statusAt) - Date.parse(time(b) ?? b.statusAt) || a.id.localeCompare(b.id)

  // Packed: each product's parcels stack along its own rack row, so the pack zone reads like the racks.
  const packedLines = movements
    .filter((m) => isOrderLine(m) && m.status === 'PACKED')
    .sort(oldestFirst((m) => m.statusAt))
  const perRow = new Map<number, ApiMovement[]>()
  for (const m of packedLines) {
    const z = spotOf(m.variantId).z
    perRow.set(z, [...(perRow.get(z) ?? []), m])
  }
  const packStep = Math.min(FLOW.pack.step, FLOW.pack.maxSeconds / Math.max(1, packedLines.length))
  const { size, pitch } = FLOW.parcel
  const perLayer = FLOW.pack.cols * FLOW.pack.lanes
  const packedParcels = [...perRow].flatMap(([z, lines]) =>
    lines.slice(0, perLayer * FLOW.pack.layers).map((m, i): Block => {
      const layer = Math.floor(i / perLayer)
      const inLayer = i % perLayer
      return {
        id: m.id,
        // Picked off the end of the product's rack row, then slid along the row into its slot.
        from: [RACK_END_X + 0.3, 1, z],
        step: packStep,
        position: [
          FLOW.pack.x0 + Math.floor(inLayer / FLOW.pack.lanes) * pitch,
          layer * pitch + size / 2,
          z + ((inLayer % FLOW.pack.lanes) - (FLOW.pack.lanes - 1) / 2) * pitch,
        ],
        size: [size, size, size],
        color: spotOf(m.variantId).color,
      }
    }),
  )
  const frontZ = layout.rows.length > 0 ? layout.rows[0].z : 0
  const packed: ParcelGroup = {
    count: packedLines.length,
    parcels: packedParcels,
    label: {
      text: `PACKED · ${packedLines.length}`,
      x: FLOW.pack.x0 + ((FLOW.pack.cols - 1) / 2) * pitch,
      z: frontZ + RACK.depth / 2 + 0.8,
    },
  }

  // Shipped: only what left the pack zone since the last morning departure.
  const shippedBy = new Map<Carrier, ApiMovement[]>(CARRIERS.map((c) => [c, []]))
  for (const m of movements) {
    if (isOrderLine(m) && m.status === 'SHIPPED' && Date.parse(m.doneAt ?? m.statusAt) >= departure) {
      shippedBy.get(carrierOf(m.carrier))?.push(m)
    }
  }
  const stacks = CARRIERS.map((carrier, dock): CarrierStack => {
    const lines = (shippedBy.get(carrier) ?? []).sort(oldestFirst((m) => m.doneAt))
    const count = lines.length
    return {
      carrier,
      dock,
      count,
      parcels: gridParcels(
        lines.map((m) => ({
          id: m.id,
          color: spotOf(m.variantId).color,
          // A parcel that ships while you watch comes out of the pack zone, from its product's row.
          from: [FLOW.pack.x0 + (FLOW.pack.cols * pitch) / 2, size / 2, spotOf(m.variantId).z] as [number, number, number],
        })),
        FLOW.stack,
        FLOW.stack.centerX,
        docks[dock] + FLOW.stack.offsetZ,
        true,
      ),
      label: {
        text: `${carrier} · ${count}`,
        x: FLOW.stack.centerX,
        z: docks[dock] + FLOW.stack.offsetZ + (FLOW.stack.rows * FLOW.parcel.pitch) / 2 + 0.7,
      },
    }
  })

  return {
    deliveries,
    inboundTrucks: trucks,
    outboundTrucks: CARRIERS.map((carrier, dock) => ({ dock, z: docks[dock], label: carrier })),
    pallets,
    packed,
    stacks,
    departure,
    overflow,
  }
}

/** x of the outer face where a truck's rear meets the dock. */
export const TRUCK_REAR_X = { inbound: -FLOOR.length / 2 - FLOW.truck.gapToDock, outbound: FLOOR.length / 2 + FLOW.truck.gapToDock } as const
