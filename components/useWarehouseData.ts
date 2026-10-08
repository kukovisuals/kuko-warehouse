'use client'

import { useEffect, useMemo, useState } from 'react'
import type { InventoryResponse, MovementsResponse, ProductsResponse } from '@/lib/api-types'
import { computeFlow } from '@/lib/warehouse/flow'
import { computeSummary } from '@/lib/warehouse/summary'
import { computeLayout } from '@/lib/warehouse/layout'

export const LOCATION_ID = 'loc-1'
// wiki/architecture.md: default refresh is 5 minutes. NEXT_PUBLIC_REFRESH_MS shortens it for demos (e.g. 5000).
const REFRESH_MS = Number(process.env.NEXT_PUBLIC_REFRESH_MS) || 5 * 60 * 1000

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url)
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error ?? `${url} failed (${res.status})`)
  return body as T
}

/** Loads products, stock and movements on mount and on a timer, and turns them into a rack layout and a flow layout. */
export function useWarehouseData() {
  const [data, setData] = useState<{ products: ProductsResponse; inventory: InventoryResponse; movements: MovementsResponse } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const [products, inventory, movements] = await Promise.all([
          getJson<ProductsResponse>('/api/products'),
          getJson<InventoryResponse>(`/api/inventory?locationId=${LOCATION_ID}`),
          getJson<MovementsResponse>(`/api/movements?locationId=${LOCATION_ID}`),
        ])
        if (cancelled) return
        setData({ products, inventory, movements })
        setError(null)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load warehouse data')
      }
    }
    load()
    const timer = setInterval(load, REFRESH_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [])

  const layout = useMemo(
    () => (data ? computeLayout(data.products.products, data.inventory.levels) : null),
    [data],
  )
  const flow = useMemo(
    () => (data && layout ? computeFlow(data.movements.movements, layout, data.inventory.computedAt) : null),
    [data, layout],
  )
  const summary = useMemo(
    () =>
      data && layout && flow
        ? computeSummary({
            products: data.products.products,
            levels: data.inventory.levels,
            movements: data.movements.movements,
            layout,
            flow,
          })
        : null,
    [data, layout, flow],
  )
  return { layout, flow, summary, computedAt: data?.inventory.computedAt ?? null, error }
}
