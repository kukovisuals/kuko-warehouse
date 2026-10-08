# Seed Data

> **Owner:** Data · **Status:** Draft · **Last updated:** 2026-10-08

## Purpose
Fake, Shopify-shaped data (Death Wish Coffee concept) so the 3D warehouse has products, racks, and trucks before any real sync.

## Where the numbers live
`prisma/seed.config.ts` is the only place numbers are typed. The seed, its checks, and its tests read from it.

## How the data is built
- **Shopify-shaped first.** The seed builds fake Shopify records in memory (orders, fulfillments, inventory shipments, 3PL receipts), runs them through the [Status Engine](07-status-engine.md), then writes the results. The real engine is exercised on every seed.
- **One warehouse:** `loc-1`, "NJ Warehouse".
- **Same data every run:** random seed `4242`. Dates are relative to the moment you run the seed.
- **Two sync runs:** a previous one at now − 24h and a current one at now. The API's `computedAt` = now.
- **Seeded rows have `shopifyId = null`.** Refs look like Shopify ids (`gid://shopify/Order/48210`) so click-through can be built, but they point at nothing real.
- Readable ids, matching the API examples: `prod-1`, `var-1`, `mv-1`.

## Products (6 products, 12 variants)
| Product | Category | Variants (SKU · start on hand) |
|---------|----------|--------------------------------|
| Death Wish Ground Coffee | Coffee | DW-GRD-1LB · 240, DW-GRD-5LB · 60 |
| Death Wish Whole Bean Coffee | Coffee | DW-WB-1LB · 180, DW-WB-5LB · 48 |
| Valhalla Java | Coffee | VJ-GRD-1LB · 120, VJ-WB-1LB · 96 |
| Death Wish Single-Serve Pods | Pods | DW-POD-10 · 150, DW-POD-50 · 72 |
| Skull Mug | Merch | MUG-BLK · 60, MUG-WHT · 36 |
| Logo Tee | Merch | TEE-M · 40, TEE-L · 40 |

"Start on hand" is the stock at the previous sync (now − 24h).

## Movements
| Shopify-shaped input | Count | Becomes |
|----------------------|------:|---------|
| Order, no fulfillment | 30 | `OUT` `COMMITTED` |
| Order, fulfillment, no carrier event | 40 | `OUT` `SHIPPED` (OPEN-01 A) or `PACKED` (B) |
| Order, fulfillment + carrier pickup | 50 | `OUT` `SHIPPED` |
| Order, cancelled | 4 | no movement |
| Transfer `RECEIVED` | 2 (5 lines) | `IN` `RECEIVED`, `FULL` |
| Transfer `IN_TRANSIT` | 1 (3 lines) | `IN` `IN_TRANSIT`, `FULL` |
| Transfer `DRAFT` | 1 (2 lines) | no movement |
| 3PL receipt | 2 (3 lines) | `IN` `RECEIVED`, `RECEIVED_ONLY` |
| Stock gap | 2 | `INFERRED` (−2 MUG-BLK, +5 DW-WB-5LB) |

- One movement per line. Orders have 1–2 lines of 1–3 units.
- An `OUT` line only picks a variant with enough stock left, so nothing goes negative.
- Carriers: UPS 50%, USPS 35%, FedEx 10%, none 5% (`OTHER` truck).

## Times
- Orders: created inside the last 24h. Fulfillment after the order. Carrier pickup 1–6h after fulfillment.
- Transfers: created 2–4 days ago, shipped 1–3 days ago. `RECEIVED` ones received inside the last 24h.
- 3PL receipts: received inside the last 24h.
- Nothing is dated in the future.

## Inventory levels (Shopify rules)
- `onHand` = start + received `IN` − fulfilled `OUT` + gaps.
- `committed` = units on unfulfilled orders.
- `available` = `onHand` − `committed`.
- `incoming` = units on `IN_TRANSIT` transfer lines.

## Invariants (the seed fails if any break)
1. **Counts:** products, variants, orders, transfers, and receipts match the config.
2. **No movement:** `DRAFT` transfers and cancelled orders create none.
3. **Balance:** under OPEN-01 option A, exactly 2 `INFERRED` movements exist (the configured gaps). Under option B, the 40 packed orders also create false gaps. That is OPEN-01's cost, shown in data.
4. **Levels:** no negative numbers. `available = onHand − committed`.
5. **Sanity:** ids unique, (`ref`, `variantId`) unique, every movement points at a real variant and warehouse, nothing in the future.

## Run it
```bash
npm run db:seed   # resets all tables, builds the fake Shopify data, runs the engine, writes rows
```
- No separate engine step: `Movement` rows are the engine's output.
- **Re-seed before a demo** so the times look fresh.
- The seed refuses to run when `NODE_ENV=production`.

## Left out on purpose
- Partly received transfers (OPEN-02 in the Status Engine).
- `MANUAL` receipts (source not decided).
- Orders split across two fulfillments (Data Model open item).

## Depends on
[Data Model](05-data-model.md) · [Status Engine](07-status-engine.md)