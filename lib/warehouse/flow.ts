// Pure flow layout: movements in, trucks / pallets / parcels / stacks out.
// Coordinates match layout.ts: front is +z, inbound docks on the left edge, outbound on the right.
//
// Rules (wiki/api.md draw rules, plus choices not in the wiki yet):
//  - IN_TRANSIT shipment  -> one truck at a dock. RECEIVED shipment -> pallets on a receiving lane, no truck.
//  - One shipment = all lines with the same `ref`. A stock gap (no ref) is its own shipment.
//  - PACKED order line    -> one parcel in the pack-zone grid.
//  - SHIPPED order line   -> one parcel in its carrier's stack. Dock i = carrier i (UPS, USPS, FedEx, OTHER).
//  - A stack is "cleared" when its movements leave the API's `since` window (24h by default). No delivery data.
//  - INFERRED OUT movements are stock-gap corrections, not orders, so they are not parcels.

import type { ApiMovement } from '@/lib/api-types'
import { COLORS, FLOW_COLORS } from '@/lib/theme'
import { dockZs, FLOOR } from './layout'

export const CARRIERS = ['UPS', 'USPS', 'FedEx', 'OTHER'] as const
export type Carrier = (typeof CARRIERS)[number]

const TRUCK = { length: 5.2, width: 1.9, gapToDock: 0.4 }

export const FLOW = {
  truck: TRUCK,
  /** Room outside the floor plate for parked trucks; the camera fits the floor plus this. */
  apron: TRUCK.length + TRUCK.gapToDock,
  pallet: { size: [1, 0.8, 1] as [number, number, number], pitch: 1.2, perLane: 5, unitsPerPallet: 120, maxPerGroup: 4, firstX: -14 },
  parcel: { size: 0.45, pitch: 0.55 },
  pack: { cols: 8, rows: 10, layers: 10, x0: 6.5 },
  /** Stacks sit slightly toward the back of their lane so the count label clears the front-edge floor labels. */
  stack: { cols: 6, rows: 4, layers: 10, centerX: 16.4, offsetZ: -0.6 },
} as const

export interface Block {
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

export interface Flow {
  inboundTrucks: Truck[]
  outboundTrucks: Truck[]
  pallets: Block[]
  packed: ParcelGroup
  stacks: CarrierStack[]
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

  // In transit: a truck at a dock, newest departure first.
  const transit = shipments
    .filter((s) => s.status === 'IN_TRANSIT')
    .sort((a, b) => b.shippedAt - a.shippedAt || a.key.localeCompare(b.key))
  const trucks: Truck[] = transit.slice(0, docks.length).map((s, dock) => ({ dock, z: docks[dock], label: s.key }))

  // Received: pallets on the lane, each shipment on the emptiest lane. Newest first, so the oldest ones overflow.
  const received = shipments
    .filter((s) => s.status === 'RECEIVED')
    .sort((a, b) => b.createdAt - a.createdAt || a.key.localeCompare(b.key))
  const load = docks.map(() => 0)
  const pallets: Block[] = []
  let palletOverflow = 0
  for (const s of received) {
    for (let n = palletCount(s.quantity); n > 0; n--) {
      const lane = load.indexOf(Math.min(...load))
      if (load[lane] >= FLOW.pallet.perLane) {
        palletOverflow++
        continue
      }
      const [w, h, d] = FLOW.pallet.size
      pallets.push({
        position: [FLOW.pallet.firstX - load[lane] * FLOW.pallet.pitch, h / 2, docks[lane]],
        size: [w, h, d],
        color: COLORS.inbound,
      })
      load[lane]++
    }
  }
  return { trucks, pallets, overflow: { trucks: transit.length - trucks.length, pallets: palletOverflow } }
}

/** Parcels in a grid of `cols` (along x) × `rows` (along z), filled layer by layer, row-major. */
function gridParcels(
  count: number,
  grid: { cols: number; rows: number; layers: number },
  centerX: number,
  centerZ: number,
  color: string,
): Block[] {
  const { size, pitch } = FLOW.parcel
  const perLayer = grid.cols * grid.rows
  const shown = Math.min(count, perLayer * grid.layers)
  return Array.from({ length: shown }, (_, i) => {
    const layer = Math.floor(i / perLayer)
    const col = (i % perLayer) % grid.cols
    const row = Math.floor((i % perLayer) / grid.cols)
    return {
      position: [
        centerX + (col - (grid.cols - 1) / 2) * pitch,
        layer * pitch + size / 2,
        centerZ + (row - (grid.rows - 1) / 2) * pitch,
      ],
      size: [size, size, size],
      color,
    }
  })
}

/** Orders only: stock-gap corrections (INFERRED) are not parcels. */
const isOrderLine = (m: ApiMovement) => m.direction === 'OUT' && m.detail !== 'INFERRED'

export function computeFlow(movements: ApiMovement[], floorDepth: number): Flow {
  const docks = dockZs(floorDepth)
  const { trucks, pallets, overflow } = inbound(movements, docks)

  const packedCount = movements.filter((m) => isOrderLine(m) && m.status === 'PACKED').length
  const packX = FLOW.pack.x0 + ((FLOW.pack.cols - 1) / 2) * FLOW.parcel.pitch
  const packed: ParcelGroup = {
    count: packedCount,
    parcels: gridParcels(packedCount, FLOW.pack, packX, 0, FLOW_COLORS.packed),
    label: { text: `PACKED · ${packedCount}`, x: packX, z: (FLOW.pack.rows * FLOW.parcel.pitch) / 2 + 0.8 },
  }

  const shippedBy = new Map<Carrier, number>(CARRIERS.map((c) => [c, 0]))
  for (const m of movements) {
    if (isOrderLine(m) && m.status === 'SHIPPED') {
      const c = carrierOf(m.carrier)
      shippedBy.set(c, (shippedBy.get(c) ?? 0) + 1)
    }
  }
  const stacks = CARRIERS.map((carrier, dock): CarrierStack => {
    const count = shippedBy.get(carrier) ?? 0
    return {
      carrier,
      dock,
      count,
      parcels: gridParcels(count, FLOW.stack, FLOW.stack.centerX, docks[dock] + FLOW.stack.offsetZ, COLORS.outbound),
      label: {
        text: `${carrier} · ${count}`,
        x: FLOW.stack.centerX,
        z: docks[dock] + FLOW.stack.offsetZ + (FLOW.stack.rows * FLOW.parcel.pitch) / 2 + 0.7,
      },
    }
  })

  return {
    inboundTrucks: trucks,
    outboundTrucks: CARRIERS.map((carrier, dock) => ({ dock, z: docks[dock], label: carrier })),
    pallets,
    packed,
    stacks,
    overflow,
  }
}

/** x of the outer face where a truck's rear meets the dock. */
export const TRUCK_REAR_X = { inbound: -FLOOR.length / 2 - FLOW.truck.gapToDock, outbound: FLOOR.length / 2 + FLOW.truck.gapToDock } as const
