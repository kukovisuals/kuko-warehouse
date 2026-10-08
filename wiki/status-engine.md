# Status Engine

> **Owner:** Backend · **Status:** Draft · **Last updated:** 2026-10-08

## Purpose
How each movement gets its `status`, times, and `detail`, and when an `INFERRED` movement is made. The only place that logic lives.

## Shape
Pure functions. Same input, same output. No database calls inside.
The sync job reads Shopify and 3PL data, calls these, and writes `Movement` rows.

```ts
type TransferLine = {                       // one line of a Shopify InventoryShipment
  shipmentStatus: 'DRAFT' | 'IN_TRANSIT' | 'PARTIALLY_RECEIVED' | 'RECEIVED' | 'OTHER'
  lineFullyReceived: boolean
  dateCreated: Date
  dateShipped: Date | null
  dateReceived: Date | null
}

type Receipt = { receivedAt: Date }         // THREE_PL or MANUAL

type OrderLine = {                          // one line at one warehouse
  orderCreatedAt: Date
  cancelled: boolean
  fulfillment: { createdAt: Date; firstCarrierEventAt: Date | null } | null
}

type MovementState = {
  status: 'IN_TRANSIT' | 'RECEIVED' | 'COMMITTED' | 'PACKED' | 'SHIPPED'
  createdAt: Date
  shippedAt: Date | null
  doneAt: Date | null
  statusAt: Date
  detail: 'FULL' | 'RECEIVED_ONLY'
}

movementState(input: TransferLine | Receipt | OrderLine): MovementState | null   // null = no movement
balanceGap(input: BalanceInput): InferredMovement | null
```

## IN rules (first match wins)
| Input | status | createdAt | shippedAt | doneAt | statusAt |
|-------|--------|-----------|-----------|--------|----------|
| Transfer `DRAFT` or `OTHER` | no movement | | | | |
| Transfer `RECEIVED`, or line fully received | `RECEIVED` | `dateCreated` | `dateShipped` | `dateReceived` | `dateReceived` |
| Transfer `IN_TRANSIT` or `PARTIALLY_RECEIVED` | `IN_TRANSIT` | `dateCreated` | `dateShipped` | `null` | `dateShipped` |
| 3PL or manual receipt | `RECEIVED` | `receivedAt` | `null` | `receivedAt` | `receivedAt` |

## OUT rules (first match wins)
| Input | status | createdAt | shippedAt | doneAt | statusAt |
|-------|--------|-----------|-----------|--------|----------|
| Cancelled, no fulfillment | no movement | | | | |
| No fulfillment | `COMMITTED` | `orderCreatedAt` | `null` | `null` | `orderCreatedAt` |
| Has a fulfillment | see OPEN-01 | | | | |

### OPEN-01: when is an OUT movement `SHIPPED`?
Shopify lowers `onHand` when the fulfillment is created, not when the carrier picks it up. The balance check must subtract OUT stock at that same moment, or every order makes a false `INFERRED` gap.

| Option | Rule | Strength | Weakness |
|--------|------|----------|----------|
| A | Fulfillment created → `SHIPPED`. `shippedAt` = `doneAt` = `statusAt` = fulfillment `createdAt` | Balance is exact. No new fields | `PACKED` is never used. Pack zone shows only `COMMITTED` |
| B | Fulfillment, no carrier event → `PACKED`. First carrier event (`CARRIER_PICKED_UP` or later) → `SHIPPED` | Real pack zone. Truck leaves on real pickup | Balance needs the fulfillment time, so one more field. Orders with no carrier events stay `PACKED` forever |

## Detail rule
- Made by `balanceGap` → `INFERRED`.
- `doneAt` set and `shippedAt` is `null` → `RECEIVED_ONLY`.
- Anything else → `FULL`.

## Balance check
Runs per variant per warehouse, before the new `onHand` is saved.

```ts
type BalanceInput = {
  oldOnHand: number | null      // null on first sync
  newOnHand: number
  inDone: number                // IN quantity with doneAt since last SyncRun
  outDone: number               // OUT quantity with doneAt since last SyncRun
  now: Date
}
```

- `oldOnHand` is `null` → no check.
- `gap = newOnHand − (oldOnHand + inDone − outDone)`.
- `gap` is 0 → no movement.
- `gap` > 0 → `IN`, `RECEIVED`. `gap` < 0 → `OUT`, `SHIPPED`.
- `quantity` = size of the gap. `createdAt`, `doneAt`, `statusAt` = `now`.
- `source`, `ref`, `shippedAt` = `null`, so it shows at the dock with no truck.

## Tests
- Table-driven: one row per rule above.
- Edge cases: draft transfer, partial transfer, cancelled order, first sync, gap of +1 and −1.
- A clean seed (every stock change has a movement) must produce zero `INFERRED` movements.

## Open items
- **OPEN-01:** `SHIPPED` timing (above). Decide before building OUT.
- **OPEN-02:** A partly received transfer line stays `IN_TRANSIT`, but Shopify already added the received part to `onHand`. That makes a false gap. Split the line, or count received quantity in the balance check?

## Depends on
[Data Model](05-data-model.md) · [Warehouse API](api.md)