// Numbers and product lists for the summary widget. Pure: the widget only displays what this returns.

import type { ApiInventoryLevel, ApiMovement, ApiProduct } from '@/lib/api-types'
import { COLORS } from '@/lib/theme'
import { carrierOf, type Flow } from './flow'
import type { WarehouseLayout } from './layout'

export interface SummaryItem {
  id: string
  title: string
  /** Variant options, e.g. "Ground · 1 lb". */
  subtitle: string
  quantity: number
  /** Small grey text under the quantity: a shipment, a SKU or an order count. */
  note: string
  color: string
}

export interface SummarySection {
  total: number
  detail: string
  items: SummaryItem[]
}

export interface Summary {
  received: SummarySection
  inventory: SummarySection
  packed: SummarySection
}

/** "gid://shopify/InventoryShipment/101" -> "#101", "3pl-receipt-1" -> "3PL-1". */
export function shortRef(ref: string | null): string {
  if (!ref) return 'ADJUSTMENT'
  const gid = ref.match(/^gid:\/\/shopify\/\w+\/(\d+)$/)
  if (gid) return `#${gid[1]}`
  const receipt = ref.match(/^3pl-receipt-(\d+)$/i)
  if (receipt) return `3PL-${receipt[1]}`
  return ref.toUpperCase()
}

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`

interface VariantInfo {
  title: string
  subtitle: string
  sku: string
  color: string
}

function variantInfo(products: ApiProduct[], layout: WarehouseLayout): Map<string, VariantInfo> {
  const colors = new Map(layout.rows.flatMap((r) => r.blocks.map((b) => [b.variantId, b.color] as const)))
  return new Map(
    products.flatMap((p) =>
      p.variants.map((v) => [
        v.id,
        {
          title: p.title,
          // Postgres JSON does not keep key order, so sort by option name to read the same every time.
          subtitle: Object.entries(v.options)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([, value]) => value)
            .join(' · '),
          sku: v.sku ?? '',
          color: colors.get(v.id) ?? COLORS.label,
        },
      ] as const),
    ),
  )
}

export function computeSummary(input: {
  products: ApiProduct[]
  levels: ApiInventoryLevel[]
  movements: ApiMovement[]
  layout: WarehouseLayout
  flow: Flow
}): Summary {
  const { products, levels, movements, layout, flow } = input
  const info = variantInfo(products, layout)
  const unknown: VariantInfo = { title: 'Unknown product', subtitle: '', sku: '', color: COLORS.label }
  const of = (variantId: string) => info.get(variantId) ?? unknown

  // Received: stock that arrived inside the API window, newest first.
  const received = movements
    .filter((m) => m.direction === 'IN' && m.status === 'RECEIVED')
    .sort((a, b) => Date.parse(b.doneAt ?? b.statusAt) - Date.parse(a.doneAt ?? a.statusAt) || a.id.localeCompare(b.id))
  const shipments = new Set(received.map((m) => m.ref ?? `movement:${m.id}`)).size
  const pallets = flow.pallets.length + flow.overflow.pallets

  // Inventory: every variant on a rack, in rack order.
  const onHand = new Map(levels.map((l) => [l.variantId, l.onHand]))
  const rackOrder = layout.rows.flatMap((r) => r.blocks.map((b) => b.variantId))
  const inventoryItems = rackOrder.map((variantId): SummaryItem => ({
    id: variantId,
    title: of(variantId).title,
    subtitle: of(variantId).subtitle,
    quantity: onHand.get(variantId) ?? 0,
    note: of(variantId).sku,
    color: of(variantId).color,
  }))

  // Packed: order lines waiting for a carrier, grouped by variant, most units first. Stock-gap fixes are not orders.
  const packedLines = movements.filter((m) => m.direction === 'OUT' && m.status === 'PACKED' && m.detail !== 'INFERRED')
  const packedByVariant = new Map<string, { units: number; orders: number }>()
  for (const m of packedLines) {
    const g = packedByVariant.get(m.variantId) ?? { units: 0, orders: 0 }
    g.units += m.quantity
    g.orders += 1
    packedByVariant.set(m.variantId, g)
  }
  const packedItems = [...packedByVariant]
    .sort(([ai, a], [bi, b]) => b.units - a.units || ai.localeCompare(bi))
    .map(([variantId, g]): SummaryItem => ({
      id: variantId,
      title: of(variantId).title,
      subtitle: of(variantId).subtitle,
      quantity: g.units,
      note: plural(g.orders, 'order'),
      color: of(variantId).color,
    }))
  const packedUnits = packedLines.reduce((sum, m) => sum + m.quantity, 0)
  const carriers = new Set(packedLines.map((m) => carrierOf(m.carrier))).size

  return {
    received: {
      total: received.reduce((sum, m) => sum + m.quantity, 0),
      detail: `${plural(shipments, 'shipment')} · ${plural(pallets, 'pallet')}`,
      items: received.map((m): SummaryItem => ({
        id: m.id,
        title: of(m.variantId).title,
        subtitle: of(m.variantId).subtitle,
        quantity: m.quantity,
        note: shortRef(m.ref),
        color: of(m.variantId).color,
      })),
    },
    inventory: {
      total: inventoryItems.reduce((sum, i) => sum + i.quantity, 0),
      detail: `${plural(inventoryItems.length, 'SKU')} · ${plural(layout.rows.length, 'rack')}`,
      items: inventoryItems,
    },
    packed: {
      total: packedLines.length,
      detail: `${plural(packedUnits, 'unit')} · ${plural(carriers, 'carrier')}`,
      items: packedItems,
    },
  }
}
