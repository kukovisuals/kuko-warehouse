import type { NextRequest } from 'next/server'
import { getComputedAt, getMovements, locationExists } from '../_lib/queries'

const DAY_MS = 24 * 60 * 60 * 1000
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/

const bad = (error: string) => Response.json({ error }, { status: 400 })

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const locationId = params.get('locationId')
  const direction = params.get('direction')
  const sinceParam = params.get('since')

  if (!locationId) return bad('locationId is required')
  if (direction !== null && direction !== 'IN' && direction !== 'OUT') return bad('direction must be IN or OUT')
  if (sinceParam !== null && (!ISO_DATE.test(sinceParam) || Number.isNaN(Date.parse(sinceParam)))) {
    return bad('since must be an ISO date')
  }

  try {
    if (!(await locationExists(locationId))) return bad(`Unknown locationId: ${locationId}`)
    const computedAt = await getComputedAt()
    const since = sinceParam
      ? new Date(sinceParam)
      : new Date((computedAt ? Date.parse(computedAt) : Date.now()) - DAY_MS)
    const movements = await getMovements(locationId, direction, since)
    return Response.json({ computedAt, movements })
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'Database failure' }, { status: 500 })
  }
}
