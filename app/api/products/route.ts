import { getComputedAt, getProducts } from '../_lib/queries'

export async function GET() {
  try {
    const [computedAt, products] = await Promise.all([getComputedAt(), getProducts()])
    return Response.json({ computedAt, products })
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'Database failure' }, { status: 500 })
  }
}
