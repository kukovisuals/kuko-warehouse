'use client'

import { useEffect, useMemo, useState } from 'react'
import type { InventoryResponse, ProductsResponse } from '@/lib/api-types'
import { computeLayout } from '@/lib/warehouse/layout'

export const LOCATION_ID = 'loc-1'
const REFRESH_MS = 5 * 60 * 1000 // wiki/architecture.md: default refresh is 5 minutes

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url)
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error ?? `${url} failed (${res.status})`)
  return body as T
}

/** Loads products and stock on mount and on a timer, and turns them into a rack layout. */
export function useWarehouseData() {
  const [data, setData] = useState<{ products: ProductsResponse; inventory: InventoryResponse } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const [products, inventory] = await Promise.all([
          getJson<ProductsResponse>('/api/products'),
          getJson<InventoryResponse>(`/api/inventory?locationId=${LOCATION_ID}`),
        ])
        if (cancelled) return
        setData({ products, inventory })
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
  return { layout, computedAt: data?.inventory.computedAt ?? null, error }
}
