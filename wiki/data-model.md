# Data Model

> **Owner:** Backend · **Status:** Design · **Last updated:** 2026-10-08

## Purpose
The tables behind the Warehouse API: products, stock on the racks, and stock moving in or out.

## Rules
- **Raw fields mirror Shopify.** Names match Shopify so the sync is a copy, not a translation.
- **Only the sync job writes.** The API only reads.
- A warehouse is one `Location` row (Shopify's name for it).
- Enums are UPPERCASE. Quantities are `Int`.

## Schema (Prisma)

```prisma
enum Direction {
  IN
  OUT
}

enum MovementStatus {
  IN_TRANSIT   // IN
  RECEIVED     // IN
  COMMITTED    // OUT
  PACKED       // OUT
  SHIPPED      // OUT
}

enum Source {
  TRANSFER     // IN
  THREE_PL     // IN
  MANUAL       // IN
  ORDER        // OUT
}

enum Detail {
  FULL
  RECEIVED_ONLY
  INFERRED
}

model Location {
  id        String           @id @default(cuid())
  shopifyId String?          @unique
  name      String                              // e.g. "NJ Warehouse"
  levels    InventoryLevel[]
  movements Movement[]
}

model Product {
  id        String    @id @default(cuid())
  shopifyId String?   @unique
  title     String
  category  String?                             // e.g. "Coffee"
  variants  Variant[]
}

model Variant {
  id        String           @id @default(cuid())
  shopifyId String?          @unique
  productId String
  product   Product          @relation(fields: [productId], references: [id])
  sku       String?                             // Shopify allows blank
  options   Json                                // { "Grind": "Ground", "Size": "1 lb" }
  levels    InventoryLevel[]
  movements Movement[]
}

model InventoryLevel {                          // one row per variant per warehouse
  variantId  String
  variant    Variant  @relation(fields: [variantId], references: [id])
  locationId String
  location   Location @relation(fields: [locationId], references: [id])
  onHand     Int
  available  Int
  committed  Int
  incoming   Int

  @@id([variantId, locationId])
  @@index([locationId])
}

model Movement {
  id         String         @id @default(cuid())
  locationId String
  location   Location       @relation(fields: [locationId], references: [id])
  variantId  String
  variant    Variant        @relation(fields: [variantId], references: [id])
  direction  Direction
  quantity   Int
  status     MovementStatus
  source     Source?                            // null when INFERRED
  detail     Detail
  ref        String?                            // source record id; null when INFERRED
  carrier    String?                            // OUT only, e.g. "UPS"
  createdAt  DateTime
  shippedAt  DateTime?
  doneAt     DateTime?                          // RECEIVED (IN) or SHIPPED (OUT); null while open
  statusAt   DateTime                           // entered current status

  @@unique([ref, variantId])                    // sync upserts on this
  @@index([locationId, direction, doneAt])      // GET /api/movements
}

model SyncRun {
  id         String   @id @default(cuid())
  finishedAt DateTime                           // newest = API computedAt
}
```

## Field sources
| Table | Comes from |
|-------|------------|
| `Location` | Shopify `Location` |
| `Product`, `Variant` | Shopify `Product`, `ProductVariant` |
| `InventoryLevel` | Shopify `InventoryLevel` quantities |
| `Movement` `IN` · `TRANSFER` | Shopify `InventoryShipment` |
| `Movement` `IN` · `THREE_PL` | 3PL receipts |
| `Movement` `IN` · `MANUAL` | Manual entry |
| `Movement` `OUT` · `ORDER` | Shopify `Order` + `Fulfillment` (carrier = tracking company) |
| `Movement` `INFERRED` | Sync job (stock gap) |
| `SyncRun` | Sync job |

## Stock balance check
Rules live in the [Status Engine](07-status-engine.md). No history table is needed: the old `onHand` is still in the row when the check runs.

## Open items
- **OPEN:** `INFERRED` cause field (same as the API's OPEN).
- **OPEN:** One order line shipped in two fulfillments gives two movements with the same `ref` + `variantId`. Use the fulfillment id as `ref` for `OUT` instead of the order id?

## Used by
[Warehouse API](api.md) · [Status Engine](07-status-engine.md)