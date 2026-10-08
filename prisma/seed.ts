// `npm run db:seed`. Builds fake Shopify-shaped records, runs them through the Status Engine,
// checks the invariants, then resets the tables and writes the results.
// Every number comes from seed.config.ts. See wiki/seed-data.md.

import { db } from '../lib/db'
import { balanceGap, movementState } from '../lib/status-engine'
import { seedConfig as cfg } from './seed.config'

const HOUR = 3_600_000
const DAY = 24 * HOUR
const CHUNK = 500

// ---------- random ----------

function mulberry32(seed: number) {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const rng = mulberry32(cfg.randomSeed)
const int = (min: number, max: number) => min + Math.floor(rng() * (max - min + 1))
const between = (min: number, max: number) => min + rng() * (max - min)
const stepped = ({ min, max, step }: { min: number; max: number; step: number }) =>
  min + step * int(0, (max - min) / step)

function pickCarrier(): string | null {
  let r = rng()
  for (const [name, share] of Object.entries(cfg.carrierMix)) {
    if (r < share) return name === 'null' ? null : name
    r -= share
  }
  return null
}

// ---------- types ----------

type Line = { variantId: string; quantity: number }

type FakeOrder = {
  ref: string
  kind: 'unfulfilled' | 'fulfilledNoPickup' | 'pickedUp' | 'cancelled'
  createdAt: Date
  cancelled: boolean
  carrier: string | null
  fulfillment: { createdAt: Date; firstCarrierEventAt: Date | null } | null
  lines: Line[]
}

type FakeTransfer = {
  ref: string
  shipmentStatus: 'DRAFT' | 'IN_TRANSIT' | 'RECEIVED'
  dateCreated: Date
  dateShipped: Date | null
  dateReceived: Date | null
  lines: Line[]
}

type FakeReceipt = { ref: string; receivedAt: Date; lines: Line[] }

type MovementRow = {
  id: string
  locationId: string
  variantId: string
  direction: 'IN' | 'OUT'
  quantity: number
  status: 'IN_TRANSIT' | 'RECEIVED' | 'COMMITTED' | 'PACKED' | 'SHIPPED'
  source: 'TRANSFER' | 'THREE_PL' | 'MANUAL' | 'ORDER' | null
  detail: 'FULL' | 'RECEIVED_ONLY' | 'INFERRED'
  ref: string | null
  carrier: string | null
  createdAt: Date
  shippedAt: Date | null
  doneAt: Date | null
  statusAt: Date
}

type LevelRow = {
  variantId: string
  locationId: string
  onHand: number
  available: number
  committed: number
  incoming: number
}

// ---------- fake Shopify records ----------

const variants = cfg.products.flatMap((p) => p.variants.map((v) => ({ ...v, productId: p.id })))
const variantIds = new Set<string>(variants.map((v) => v.id))

// Stock left for OUT lines. Starts at the previous-sync stock, so nothing goes negative.
const remaining = new Map<string, number>(variants.map((v) => [v.id, v.startOnHand]))

function drawLines(count: number, units: readonly [number, number], consume: boolean): Line[] {
  const lines: Line[] = []
  const used = new Set<string>() // one line per variant per order keeps (ref, variantId) unique
  for (let i = 0; i < count; i++) {
    const quantity = int(units[0], units[1])
    const options = variants.filter((v) => !used.has(v.id) && (remaining.get(v.id) ?? 0) >= quantity)
    if (options.length === 0) throw new Error('Seed ran out of stock for OUT lines. Lower the order counts.')
    const chosen = options[int(0, options.length - 1)]
    used.add(chosen.id)
    if (consume) remaining.set(chosen.id, remaining.get(chosen.id)! - quantity)
    lines.push({ variantId: chosen.id, quantity })
  }
  return lines
}

function drawInboundLines(count: number, qty: Parameters<typeof stepped>[0]): Line[] {
  const used = new Set<string>()
  const lines: Line[] = []
  for (let i = 0; i < count; i++) {
    const options = variants.filter((v) => !used.has(v.id))
    const chosen = options[int(0, options.length - 1)]
    used.add(chosen.id)
    lines.push({ variantId: chosen.id, quantity: stepped(qty) })
  }
  return lines
}

function buildOrders(now: Date): FakeOrder[] {
  const o = cfg.orders
  const windowMs = cfg.windowHours * HOUR
  const kinds: FakeOrder['kind'][] = [
    ...Array<FakeOrder['kind']>(o.unfulfilled).fill('unfulfilled'),
    ...Array<FakeOrder['kind']>(o.fulfilledNoPickup).fill('fulfilledNoPickup'),
    ...Array<FakeOrder['kind']>(o.pickedUp).fill('pickedUp'),
    ...Array<FakeOrder['kind']>(o.cancelled).fill('cancelled'),
  ]

  const orders = kinds.map((kind): FakeOrder => {
    const lines = drawLines(int(...o.linesPerOrder), o.unitsPerLine, kind !== 'cancelled')
    const at = (msAgo: number) => new Date(now.getTime() - msAgo)

    if (kind === 'unfulfilled' || kind === 'cancelled') {
      return { ref: '', kind, createdAt: at(between(5 * 60_000, windowMs)), cancelled: kind === 'cancelled', carrier: null, fulfillment: null, lines }
    }

    // Work back from the fulfillment so the pickup (1–6h later) never lands in the future.
    const pickupLag = kind === 'pickedUp' ? between(1 * HOUR, 6 * HOUR) : 0
    const fulfillAgo = between(pickupLag + 5 * 60_000, windowMs - 10 * 60_000)
    const orderToFulfill = between(10 * 60_000, Math.min(3 * HOUR, windowMs - fulfillAgo))
    const fulfillAt = at(fulfillAgo)
    return {
      ref: '',
      kind,
      createdAt: new Date(fulfillAt.getTime() - orderToFulfill),
      cancelled: false,
      carrier: pickCarrier(),
      fulfillment: {
        createdAt: fulfillAt,
        firstCarrierEventAt: kind === 'pickedUp' ? new Date(fulfillAt.getTime() + pickupLag) : null,
      },
      lines,
    }
  })

  // Order numbers follow creation time, like Shopify's.
  orders.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
  orders.forEach((order, i) => (order.ref = `gid://shopify/Order/${o.firstNumber + i}`))
  return orders
}

function buildTransfers(now: Date): FakeTransfer[] {
  return cfg.transfers.map((t, i) => {
    const createdAgo = between(2 * DAY, 4 * DAY)
    const shippedAgo = between(1 * DAY, Math.min(3 * DAY, createdAgo - HOUR))
    const receivedAgo = between(30 * 60_000, 23 * HOUR)
    const ago = (ms: number) => new Date(now.getTime() - ms)
    return {
      ref: `gid://shopify/InventoryShipment/${101 + i}`,
      shipmentStatus: t.status,
      dateCreated: ago(createdAgo),
      dateShipped: t.status === 'DRAFT' ? null : ago(shippedAgo),
      dateReceived: t.status === 'RECEIVED' ? ago(receivedAgo) : null,
      lines: drawInboundLines(t.lines, cfg.transferLineQty),
    }
  })
}

function buildReceipts(now: Date): FakeReceipt[] {
  return cfg.threePlReceipts.map((r, i) => ({
    ref: `3pl-receipt-${i + 1}`,
    receivedAt: new Date(now.getTime() - between(30 * 60_000, 23 * HOUR)),
    lines: drawInboundLines(r.lines, cfg.receiptLineQty),
  }))
}

// ---------- Status Engine ----------

function buildMovements(orders: FakeOrder[], transfers: FakeTransfer[], receipts: FakeReceipt[], now: Date) {
  const locationId = cfg.location.id
  const rows: Omit<MovementRow, 'id'>[] = []

  for (const t of transfers) {
    for (const line of t.lines) {
      const state = movementState({
        shipmentStatus: t.shipmentStatus,
        lineFullyReceived: t.shipmentStatus === 'RECEIVED',
        dateCreated: t.dateCreated,
        dateShipped: t.dateShipped,
        dateReceived: t.dateReceived,
      })
      if (!state) continue
      rows.push({ locationId, variantId: line.variantId, direction: 'IN', quantity: line.quantity, source: 'TRANSFER', ref: t.ref, carrier: null, ...state })
    }
  }

  for (const r of receipts) {
    for (const line of r.lines) {
      const state = movementState({ receivedAt: r.receivedAt })
      if (!state) continue
      rows.push({ locationId, variantId: line.variantId, direction: 'IN', quantity: line.quantity, source: 'THREE_PL', ref: r.ref, carrier: null, ...state })
    }
  }

  for (const o of orders) {
    for (const line of o.lines) {
      const state = movementState({ orderCreatedAt: o.createdAt, cancelled: o.cancelled, fulfillment: o.fulfillment })
      if (!state) continue
      rows.push({ locationId, variantId: line.variantId, direction: 'OUT', quantity: line.quantity, source: 'ORDER', ref: o.ref, carrier: o.fulfillment ? o.carrier : null, ...state })
    }
  }

  rows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())

  // Stock levels (Shopify rules). Shopify lowers onHand when a fulfillment is created.
  const prevSync = new Date(now.getTime() - cfg.windowHours * HOUR)
  const gapByVariant = new Map<string, number>(cfg.inferredGaps.map((g) => [g.variantId, g.gap]))
  const levels: LevelRow[] = []
  const inferred: Omit<MovementRow, 'id'>[] = []

  for (const v of variants) {
    const sum = (pick: (m: Omit<MovementRow, 'id'>) => boolean) =>
      rows.filter((m) => m.variantId === v.id && pick(m)).reduce((n, m) => n + m.quantity, 0)
    const fulfilledOut = orders
      .filter((o) => o.fulfillment && !o.cancelled)
      .flatMap((o) => o.lines)
      .filter((l) => l.variantId === v.id)
      .reduce((n, l) => n + l.quantity, 0)

    const receivedIn = sum((m) => m.direction === 'IN' && m.status === 'RECEIVED')
    const committed = sum((m) => m.status === 'COMMITTED')
    const incoming = sum((m) => m.status === 'IN_TRANSIT')
    const onHand = v.startOnHand + receivedIn - fulfilledOut + (gapByVariant.get(v.id) ?? 0)

    levels.push({ variantId: v.id, locationId, onHand, committed, incoming, available: onHand - committed })

    // Balance check: the engine finds stock changes that have no movement.
    const gap = balanceGap({
      oldOnHand: v.startOnHand,
      newOnHand: onHand,
      inDone: sum((m) => m.direction === 'IN' && m.doneAt !== null && m.doneAt >= prevSync),
      outDone: sum((m) => m.direction === 'OUT' && m.doneAt !== null && m.doneAt >= prevSync),
      now,
    })
    if (gap) inferred.push({ locationId, variantId: v.id, ...gap })
  }

  const all = [...rows, ...inferred].map((m, i): MovementRow => ({ id: `mv-${i + 1}`, ...m }))
  return { movements: all, levels }
}

// ---------- invariants ----------

function checkInvariants(
  data: ReturnType<typeof generate>,
  now: Date,
): string[] {
  const fails: string[] = []
  const { orders, transfers, receipts, movements, levels } = data
  const o = cfg.orders

  // 1. Counts
  if (cfg.products.length !== 6) fails.push(`expected 6 products, config has ${cfg.products.length}`)
  if (variants.length !== 12) fails.push(`expected 12 variants, config has ${variants.length}`)
  const orderTotal = o.unfulfilled + o.fulfilledNoPickup + o.pickedUp + o.cancelled
  if (orders.length !== orderTotal) fails.push(`expected ${orderTotal} orders, got ${orders.length}`)
  if (transfers.length !== cfg.transfers.length) fails.push(`expected ${cfg.transfers.length} transfers, got ${transfers.length}`)
  if (receipts.length !== cfg.threePlReceipts.length) fails.push(`expected ${cfg.threePlReceipts.length} receipts, got ${receipts.length}`)
  const expectedLines =
    orders.filter((x) => !x.cancelled).reduce((n, x) => n + x.lines.length, 0) +
    transfers.filter((t) => t.shipmentStatus !== 'DRAFT').reduce((n, t) => n + t.lines.length, 0) +
    receipts.reduce((n, r) => n + r.lines.length, 0)
  const sourced = movements.filter((m) => m.detail !== 'INFERRED').length
  if (sourced !== expectedLines) fails.push(`expected ${expectedLines} sourced movements (one per line), got ${sourced}`)

  // 2. No movement for DRAFT transfers or cancelled orders
  const silent = new Set([
    ...transfers.filter((t) => t.shipmentStatus === 'DRAFT').map((t) => t.ref),
    ...orders.filter((x) => x.cancelled).map((x) => x.ref),
  ])
  for (const m of movements) if (m.ref && silent.has(m.ref)) fails.push(`${m.id} exists for ${m.ref}, which must create none`)

  // 3. Balance. Option A (no PACKED) must give exactly the configured gaps.
  // Option B (PACKED in use) adds false gaps on purpose; the count is shown, not forced.
  const inferred = movements.filter((m) => m.detail === 'INFERRED')
  const optionB = movements.some((m) => m.status === 'PACKED')
  if (!optionB) {
    if (inferred.length !== cfg.inferredGaps.length) fails.push(`expected ${cfg.inferredGaps.length} INFERRED movements, got ${inferred.length}`)
    for (const g of cfg.inferredGaps) {
      const hit = inferred.find((m) => m.variantId === g.variantId)
      if (!hit || hit.quantity !== Math.abs(g.gap) || hit.direction !== (g.gap > 0 ? 'IN' : 'OUT')) {
        fails.push(`missing or wrong INFERRED movement for ${g.variantId} (gap ${g.gap})`)
      }
    }
  }

  // 4. Levels
  for (const l of levels) {
    if (l.onHand < 0 || l.available < 0 || l.committed < 0 || l.incoming < 0) fails.push(`negative level for ${l.variantId}`)
    if (l.available !== l.onHand - l.committed) fails.push(`available != onHand - committed for ${l.variantId}`)
  }

  // 5. Sanity
  const ids = new Set<string>()
  const keys = new Set<string>()
  for (const m of movements) {
    if (ids.has(m.id)) fails.push(`duplicate id ${m.id}`)
    ids.add(m.id)
    if (m.ref) {
      const key = `${m.ref}|${m.variantId}`
      if (keys.has(key)) fails.push(`duplicate (ref, variantId) ${key}`)
      keys.add(key)
    }
    if (!variantIds.has(m.variantId)) fails.push(`${m.id} points at unknown variant ${m.variantId}`)
    if (m.locationId !== cfg.location.id) fails.push(`${m.id} points at unknown warehouse ${m.locationId}`)
    for (const d of [m.createdAt, m.shippedAt, m.doneAt, m.statusAt]) {
      if (d && d.getTime() > now.getTime()) fails.push(`${m.id} is dated in the future`)
    }
  }

  return fails
}

// ---------- run ----------

function generate(now: Date) {
  const orders = buildOrders(now)
  const transfers = buildTransfers(now)
  const receipts = buildReceipts(now)
  const { movements, levels } = buildMovements(orders, transfers, receipts, now)
  return { orders, transfers, receipts, movements, levels }
}

async function insertAll<T>(rows: T[], insert: (chunk: T[]) => Promise<unknown>) {
  for (let i = 0; i < rows.length; i += CHUNK) await insert(rows.slice(i, i + CHUNK))
}

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to reset data in production.')

  const now = new Date()
  const data = generate(now)

  // Check before touching the database: a broken seed never replaces good data.
  const failures = checkInvariants(data, now)
  if (failures.length > 0) throw new Error(`Seed invariants failed:\n${failures.join('\n')}`)

  await db.$transaction([
    db.movement.deleteMany(),
    db.inventoryLevel.deleteMany(),
    db.variant.deleteMany(),
    db.product.deleteMany(),
    db.location.deleteMany(),
    db.syncRun.deleteMany(),
  ])

  await db.location.create({ data: { id: cfg.location.id, name: cfg.location.name } })
  await db.product.createMany({ data: cfg.products.map((p) => ({ id: p.id, title: p.title, category: p.category })) })
  await db.variant.createMany({ data: variants.map((v) => ({ id: v.id, productId: v.productId, sku: v.sku, options: v.options })) })
  await db.inventoryLevel.createMany({ data: data.levels })
  await insertAll(data.movements, (chunk) => db.movement.createMany({ data: chunk }))
  await db.syncRun.createMany({
    data: [
      { id: 'sync-1', finishedAt: new Date(now.getTime() - cfg.windowHours * HOUR) },
      { id: 'sync-2', finishedAt: now },
    ],
  })

  const inferred = data.movements.filter((m) => m.detail === 'INFERRED').length
  console.log(
    `Seed: ${cfg.products.length} products, ${variants.length} variants, ${data.orders.length} orders, ` +
      `${data.transfers.length} transfers, ${data.receipts.length} receipts, ${data.movements.length} movements ` +
      `(${inferred} INFERRED). Invariants pass.`,
  )
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => db.$disconnect())
