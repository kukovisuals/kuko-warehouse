# Setup

> **Owner:** DevEx · **Status:** Draft · **Last updated:** 2026-10-08

## Purpose
Get the warehouse app running on a new machine.

## Requirements
- Node.js (current LTS)
- Docker (for local Postgres)

## Steps

**1. Create the app**
```bash
npx create-next-app@latest warehouse-app --ts --app --eslint
cd warehouse-app
```

**2. Install the 3D layer**
```bash
npm i three @react-three/fiber @react-three/drei
npm i -D @types/three
```

**3. Install state and test tools**
```bash
npm i zustand
npm i -D vitest @playwright/test
```

**4. Start Postgres**
```bash
docker run -d --name warehouse-db -e POSTGRES_PASSWORD=dev -p 5432:5432 postgres
```

**5. Set up Prisma (v7)**
```bash
npm i @prisma/client @prisma/adapter-pg pg dotenv
npm i -D prisma @types/pg
npx prisma init
```
Set `DATABASE_URL` in `.env`:
```
DATABASE_URL="postgresql://postgres:dev@localhost:5432/postgres"
```
Check `prisma.config.ts` reads it: `datasource: { url: env('DATABASE_URL') }`.

Create the client once in `app/api/_lib/db.ts`. Prisma 7 needs the `pg` adapter:
```ts
import 'dotenv/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../../../generated/prisma/client' // match `output` in schema.prisma

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
export const db = new PrismaClient({ adapter })
```

**6. Canvas setup (client-only)**
- The R3F `<Canvas>` lives in a file marked `'use client'`.
- Import it with `dynamic(() => import('...'), { ssr: false })` from inside a client component. WebGL can't render on the server.

**7. Layering**
- Canvas: `position: absolute`, full size, behind everything. The 3D warehouse lives here.
- DOM: a CSS grid on top with a header, the cards (Products, SKUs, Pallets in, Orders out), and the legend.

## Done when
1. The title shows as DOM text.
2. A test cube renders in the Canvas behind it.
3. The first migration runs: `npx prisma migrate dev --name init` (after the schema in [Data Model](05-data-model.md) is added). Then `npx prisma generate`. This proves the database connection works.

## Common errors
| Error | Fix |
|-------|-----|
| `window is not defined` | The Canvas is rendering on the server. Use `ssr: false` (step 6). |
| Prisma can't connect | Check Docker is running and `DATABASE_URL` matches the password. |
| PrismaClient fails to start | Prisma 7 needs the adapter. Pass `{ adapter }` (step 5). |
| Port 5432 already in use | The shipping tracker's database is still running: `docker stop tracker-db`. |
| Black canvas | Add a light, or use `meshBasicMaterial` for the test cube. |

## Depends on
[Architecture](03-architecture.md)