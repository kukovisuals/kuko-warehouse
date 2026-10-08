# Death Wish Coffee · Product slotting

A 3D view of a warehouse. Racks hold one product per row, sized by stock on hand. Trucks bring pallets in on the left, orders get packed and shipped on the right, and a summary card shows the numbers behind the scene. It runs on fake, Shopify-shaped seed data today; a Shopify and 3PL sync comes later.

![The app: the 3D warehouse and the summary widget](wiki/img/app.png)

## What is built

- **Racks:** one row per product, 10 bays per row, one box per 6 units on hand. Colours come from the product, shaded per variant.
- **Flow:** receiving trucks and pallets, a pack zone with parcels on their product's row, and per-carrier shipping stacks. A looping "day" plays: trucks pull in and unload, parcels get packed and shipped, the trucks leave. Reduced-motion users see the static data.
- **Summary widget:** Received (last 24h), In inventory and Packed, each with a toggle that lists the products behind the number.
- **API:** `GET /api/products`, `/api/inventory` and `/api/movements`, read-only.
- **Status Engine:** pure functions that decide each movement's status and detect stock gaps.

## Quick start

You need Node (current LTS) and Docker.

```bash
npm install
docker run -d --name warehouse-db -e POSTGRES_PASSWORD=dev -p 5432:5432 postgres
```

Create a `.env` file (it is git-ignored) that points at that database:

```
DATABASE_URL="postgresql://postgres:dev@localhost:5432/postgres"
```

```bash
npx prisma migrate dev --name init   # no migration is committed yet, so this creates the first one
npm run db:generate                  # the Prisma client in generated/ is git-ignored, so every clone builds it
npm run db:seed                      # fake data; re-seed before a demo so the times look fresh
npm run dev                          # http://localhost:3000
```

Port 5432 busy? Another project's database (the shipping tracker's `tracker-db`) may be using it. Stop it with `docker stop tracker-db`, or map a different port and change `DATABASE_URL`. The seed resets every table, so never point it at a database you care about.

| Command | What it does |
|---------|--------------|
| `npm run dev` / `build` / `start` | Next.js dev server, production build, production server |
| `npm test` | Unit tests (Vitest) |
| `npm run typecheck` / `lint` | TypeScript and ESLint |
| `npm run db:seed` | Reset and seed the database (uses OPEN-01 option B) |
| `npm run db:advance` | Dev only: ship some packed orders and receive a shipment. `-- --morning` skips to the next departure |
| `npm run db:migrate` / `db:generate` | Prisma migrate and client generation |

`NEXT_PUBLIC_REFRESH_MS=5000 npm run dev` makes the page re-fetch every 5 seconds instead of every 5 minutes, which is handy with `db:advance`. Playwright is installed but there are no end-to-end tests yet.

This is Next.js 16 with breaking changes from older versions. `AGENTS.md` tells contributors and coding agents to read `node_modules/next/dist/docs/` before writing code.

## The wiki

Everything is written down in [`wiki/`](wiki/). Each page has an owner and a status.

| Page | What it covers |
|------|----------------|
| [Architecture](wiki/architecture.md) | Stack (Next.js, three + R3F, zustand, Postgres, Prisma 7, Vitest, Playwright), the layers, and one rule: components never compute status, the Status Engine does. R3F draws anything spatial; the DOM draws text and lists. The client re-fetches every 5 minutes. |
| [Warehouse API](wiki/api.md) | The three read-only endpoints, their JSON shapes and errors. Every response carries `computedAt`. Movements return all open ones plus finished ones from the last 24h, and say when to draw a truck versus a pallet. |
| [Data Model](wiki/data-model.md) | The Prisma schema: `Location`, `Product`, `Variant`, `InventoryLevel`, `Movement`, `SyncRun`. Field names mirror Shopify. Only the sync job writes; the API only reads. |
| [Status Engine](wiki/status-engine.md) | `movementState` and `balanceGap`: how each transfer, receipt and order line becomes an `IN` or `OUT` movement, and when a missing stock change becomes an `INFERRED` one. |
| [Seed Data](wiki/seed-data.md) | The fake data: 6 products, 12 variants, 124 orders, 4 transfers, 2 receipts, fixed random seed. Seed numbers live in `prisma/seed.config.ts`, and the seed fails if any invariant breaks. |
| [Setup](wiki/setup.md) | Getting the app running on a new machine, and the common errors. |
| [Design Specs](wiki/design-specs.md) | How the scene looks: units, axes, camera, colours, the floor and zones, and the rack rules (layout, geometry, box counts, colours). |

## Where the code goes past the wiki

The wiki has not caught up with these yet:

- **Outbound is yellow,** not red: the pack and shipping lines, the docks and the truck stripes. Trucks are white (blue stripe inbound, yellow outbound).
- **Outbound trucks leave every morning** at 08:00 (`DEPARTURE_HOUR` in `lib/warehouse/flow.ts`). A shipping stack only holds what shipped since the last departure.
- **The seed uses OPEN-01 option B,** so packed orders exist and fill the pack zone. This also creates false `INFERRED` gaps, which the scene leaves out of the parcel counts.
- **Racks use open shelf rails,** not solid plates, so the boxes stay visible from above.
- **The camera looks from the front-right,** which is what the mockup shows (the spec text says front-left).
- **Added beyond the spec:** the pack zone and shipping stacks, the summary widget, the looping animation, the title, and `db:advance`.

## Project layout

```
app/                  pages and API route handlers (app/api/*)
components/dom/       the summary widget
components/three/     the scene: warehouse, racks, trucks, flow, animated instances
lib/status-engine/    pure status rules and tests
lib/warehouse/        layout, flow, camera, summary, motion, trucks, choreography (all pure, all tested)
prisma/               schema, seed, db:advance
wiki/                 the project docs
```

## Open decisions

From the wiki: **OPEN-01** (when an order counts as shipped), **OPEN-02** (partly received transfers), the `INFERRED` cause field, how to treat stuck alerts, the page layout, and the design questions **D1** to **D4** (one rack row per product versus the mockup's mixed rows, what to do with hundreds of products, fixed camera versus orbit, and stock above a block's capacity).
