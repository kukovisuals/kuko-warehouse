import type { NextRequest } from 'next/server'
import { getComputedAt, getInventoryLevels, locationExists } from '../_lib/queries'

export async function GET(request: NextRequest) {
  const locationId = request.nextUrl.searchParams.get('locationId')
  if (!locationId) {
    return Response.json({ error: 'locationId is required' }, { status: 400 })
  }
  try {
    if (!(await locationExists(locationId))) {
      return Response.json({ error: `Unknown locationId: ${locationId}` }, { status: 400 })
    }
    const [computedAt, levels] = await Promise.all([getComputedAt(), getInventoryLevels(locationId)])
    return Response.json({ computedAt, levels })
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'Database failure' }, { status: 500 })
  }
}
