# Architecture

> **Owner:** Tech Lead · **Status:** Draft · **Last updated:** 2026-10-08

## Purpose
The stack, the layers, and the one rule about data flow.

## Stack

| Layer | Tool |
|-------|------|
| App framework | Next.js (App Router), TypeScript |
| 3D | three, @react-three/fiber, @react-three/drei |
| UI state | zustand |
| Database | PostgreSQL |
| ORM | Prisma 7 (`pg` adapter) |
| Unit tests | Vitest |
| End-to-end tests | Playwright |

## Layers

```
Browser
  ├─ DOM (React)          ← header, cards, legend
  └─ R3F Canvas           ← warehouse, racks, pack zone, dock, trucks
        ▲
        │ fetch JSON (on load + timer)
        │
Next.js API routes (app/api/*)       ← read only
        ▲
        │ products, levels, movements
        │
PostgreSQL (Prisma)
        ▲
        │ Movement rows, levels, SyncRun
        │
Status Engine (lib/status-engine)    ← pure functions
        ▲
        │ Shopify-shaped records
        │
Phase 1: seed script   |   Phase 2: Shopify + 3PL sync job
```

The engine sits **before** the database, not after it. `Movement` rows are its output; no raw table is stored.

## The data flow rule
**Components never compute status.**
- They display what the API returns.
- They may group and draw: one truck per `carrier` + `shippedAt` hour, truck vs pallet from `shippedAt`.
- All status, `detail`, and `INFERRED` logic lives in the Status Engine. One place to test, one place to fix.

## Render split: DOM vs R3F
- **R3F:** anything spatial or animated — warehouse, racks, pack zone, dock pallets, trucks.
- **DOM:** anything that's text or a list — header, Products, SKUs, Pallets in, Orders out cards, legend.
- Reason: WebGL is weak at text, selection, and accessibility. The DOM is strong at all three.

## Refresh model
- Data loads on page open.
- The client re-fetches on a timer. Default 5 minutes.
- No webhooks in v1.
- With seed data only, nothing changes until you re-seed. The timer matters once sync exists.

## Folder structure

```
app/
  page.tsx                  ← layout: header, cards, legend
  api/
    _lib/queries.ts         ← all Prisma queries
    products/route.ts
    inventory/route.ts
    movements/route.ts
components/
  dom/                      ← Header, ProductsCard, SkusCard, PalletsInCard, OrdersOutCard, Legend
  three/                    ← Scene, Warehouse, Racks, PackZone, Dock, Trucks
lib/
  db.ts                     ← Prisma client (shared by API and seed)
  status-engine/            ← movementState, balanceGap + tests
prisma/
  schema.prisma
  seed.config.ts
  seed.ts
generated/prisma/           ← Prisma client output (gitignored)
```

Later: `lib/sync/` for the Shopify + 3PL sync job. It calls the same Status Engine as the seed.

## Open items
- **OPEN:** Page layout. Where each card sits around the canvas.
- **OPEN:** Stuck alerts. They compare `statusAt` with now, so the browser computes them. Allow that as display logic, or move it to the API? Threshold also undecided.

## Depends on
[Setup](04-setup.md) · [Status Engine](07-status-engine.md) · [Warehouse API](api.md)