// Dev only: move the seeded warehouse forward one step so the 3D scene has something to animate.
//   - up to 6 of the oldest PACKED order lines become SHIPPED (parcels hop from the pack zone to their carrier stack)
//   - the oldest IN_TRANSIT shipment is RECEIVED (its truck drives off, pallets slide onto a lane, stock goes up)
// Then a new SyncRun is written so computedAt moves. Run it as often as you like; re-seed to start over.
//   npm run db:advance -- --morning   skips ahead to the next morning: the outbound trucks leave and the stacks clear.
//                                     (It dates a sync after the next 08:00, so only use it on a throwaway database.)
import 'dotenv/config'
import { db } from '../lib/db'

const PACKED_PER_STEP = 6
const DEPARTURE_HOUR = 8 // keep in step with lib/warehouse/flow.ts

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('db:advance refuses to run when NODE_ENV=production')
  const now = new Date()

  if (process.argv.includes('--morning')) {
    const latest = await db.syncRun.aggregate({ _max: { finishedAt: true } })
    const from = latest._max.finishedAt ?? now
    const next = new Date(from)
    next.setHours(DEPARTURE_HOUR, 30, 0, 0)
    if (next <= from || next.getHours() !== DEPARTURE_HOUR) next.setDate(next.getDate() + 1)
    await db.syncRun.create({ data: { finishedAt: next } })
    console.log(`Skipped to ${next.toString()}: the outbound trucks have left.`)
    return
  }

  const location = await db.location.findFirst({ orderBy: { id: 'asc' } })
  if (!location) throw new Error('No location. Run npm run db:seed first.')

  const packed = await db.movement.findMany({
    where: { locationId: location.id, direction: 'OUT', status: 'PACKED' },
    orderBy: [{ statusAt: 'asc' }, { id: 'asc' }],
    take: PACKED_PER_STEP,
  })

  const transit = await db.movement.findFirst({
    where: { locationId: location.id, direction: 'IN', status: 'IN_TRANSIT' },
    orderBy: [{ shippedAt: 'asc' }, { id: 'asc' }],
  })
  const lines = transit
    ? await db.movement.findMany({ where: { locationId: location.id, direction: 'IN', status: 'IN_TRANSIT', ref: transit.ref } })
    : []

  if (packed.length === 0 && lines.length === 0) {
    console.log('Nothing left to advance. Run npm run db:seed to start over.')
    return
  }

  await db.$transaction(async (tx) => {
    // onHand was already lowered when the order was fulfilled, so shipping changes status only.
    await tx.movement.updateMany({
      where: { id: { in: packed.map((m) => m.id) } },
      data: { status: 'SHIPPED', shippedAt: now, doneAt: now, statusAt: now },
    })
    for (const line of lines) {
      await tx.movement.update({ where: { id: line.id }, data: { status: 'RECEIVED', doneAt: now, statusAt: now } })
      await tx.inventoryLevel.update({
        where: { variantId_locationId: { variantId: line.variantId, locationId: location.id } },
        data: { onHand: { increment: line.quantity }, available: { increment: line.quantity }, incoming: { decrement: line.quantity } },
      })
    }
    await tx.syncRun.create({ data: { finishedAt: now } })
  })

  console.log(
    `Advanced: ${packed.length} packed -> shipped, ${lines.length ? `shipment ${transit?.ref} received (${lines.length} lines)` : 'no shipment in transit'}.`,
  )
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e)
    process.exitCode = 1
  })
  .finally(() => db.$disconnect())
