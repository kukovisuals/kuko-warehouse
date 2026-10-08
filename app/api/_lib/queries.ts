import { db } from '@/lib/db'

export async function getComputedAt(): Promise<string | null> {
  const latest = await db.syncRun.aggregate({ _max: { finishedAt: true } })
  return latest._max.finishedAt?.toISOString() ?? null
}

export async function getProducts() {
  const products = await db.product.findMany({
    orderBy: { id: 'asc' },
    include: { variants: { orderBy: { id: 'asc' } } },
  })
  return products.map((p) => ({
    id: p.id,
    title: p.title,
    category: p.category,
    variants: p.variants.map((v) => ({ id: v.id, sku: v.sku, options: v.options })),
  }))
}

export async function locationExists(locationId: string): Promise<boolean> {
  return (await db.location.findUnique({ where: { id: locationId }, select: { id: true } })) !== null
}

export async function getInventoryLevels(locationId: string) {
  const levels = await db.inventoryLevel.findMany({
    where: { locationId },
    orderBy: { variantId: 'asc' },
  })
  return levels.map((l) => ({
    variantId: l.variantId,
    onHand: l.onHand,
    available: l.available,
    committed: l.committed,
    incoming: l.incoming,
  }))
}

/** Every open movement, plus finished ones with `doneAt` after `since`. Newest `createdAt` first. */
export async function getMovements(locationId: string, direction: 'IN' | 'OUT' | null, since: Date) {
  const rows = await db.movement.findMany({
    where: {
      locationId,
      ...(direction ? { direction } : {}),
      OR: [{ doneAt: null }, { doneAt: { gt: since } }],
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
  })
  return rows.map((m) => ({
    id: m.id,
    direction: m.direction,
    variantId: m.variantId,
    quantity: m.quantity,
    status: m.status,
    source: m.source,
    detail: m.detail,
    ref: m.ref,
    createdAt: m.createdAt.toISOString(),
    shippedAt: m.shippedAt?.toISOString() ?? null,
    doneAt: m.doneAt?.toISOString() ?? null,
    statusAt: m.statusAt.toISOString(),
    carrier: m.carrier,
  }))
}
