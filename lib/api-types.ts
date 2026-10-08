// Shapes returned by app/api/*. See wiki/api.md.

export interface ApiVariant {
  id: string
  sku: string | null
  options: Record<string, string>
}

export interface ApiProduct {
  id: string
  title: string
  category: string | null
  variants: ApiVariant[]
}

export interface ProductsResponse {
  computedAt: string | null
  products: ApiProduct[]
}

export interface ApiInventoryLevel {
  variantId: string
  onHand: number
  available: number
  committed: number
  incoming: number
}

export interface InventoryResponse {
  computedAt: string | null
  levels: ApiInventoryLevel[]
}
