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

export type MovementDirection = 'IN' | 'OUT'
export type MovementStatus = 'IN_TRANSIT' | 'RECEIVED' | 'COMMITTED' | 'PACKED' | 'SHIPPED'

export interface ApiMovement {
  id: string
  direction: MovementDirection
  variantId: string
  quantity: number
  status: MovementStatus
  source: 'TRANSFER' | 'THREE_PL' | 'MANUAL' | 'ORDER' | null
  detail: 'FULL' | 'RECEIVED_ONLY' | 'INFERRED'
  ref: string | null
  createdAt: string
  shippedAt: string | null
  doneAt: string | null
  statusAt: string
  carrier: string | null
}

export interface MovementsResponse {
  computedAt: string | null
  movements: ApiMovement[]
}
