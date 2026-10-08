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
