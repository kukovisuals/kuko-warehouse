# Warehouse API

> **Owner:** Backend · **Status:** Design · **Last updated:** 2026-10-08

## Purpose
Endpoints for the 3D warehouse: what products exist, how much is on the racks, and what is coming in or going out.

## Rules
- Next.js route handlers under `app/api/`. Queries in `app/api/_lib/queries.ts`.
- Endpoints read synced data only. They never call Shopify or a 3PL during a request.
- Every response has `computedAt`: the newest sync time. `null` if nothing has synced.
- Enums are UPPERCASE. Quantities are integers.
- Stock must balance: `onHand now = onHand before + IN received − OUT shipped`. A gap becomes an `INFERRED` movement.

## GET `/api/products`
Feeds: legend, Products and SKUs cards, rack colors.
```json
{
  "computedAt": "2026-10-08T14:00:00Z",
  "products": [
    {
      "id": "prod-1",
      "title": "Death Wish Ground Coffee",
      "category": "Coffee",
      "variants": [
        { "id": "var-1", "sku": "DW-GRD-1LB", "options": { "Grind": "Ground", "Size": "1 lb" } }
      ]
    }
  ]
}
```

## GET `/api/inventory?locationId=loc-1`
Feeds: racks. One level per variant at that location.
```json
{
  "computedAt": "2026-10-08T14:00:00Z",
  "levels": [
    { "variantId": "var-1", "onHand": 236, "available": 230, "committed": 6, "incoming": 0 }
  ]
}
```

## GET `/api/movements?locationId=loc-1&direction=IN&since=2026-10-07T14:00:00Z`
Feeds: blue trucks (`IN`), pack zone and red trucks (`OUT`), Pallets in and Orders out cards.

- `direction`: `IN` or `OUT`. Leave it out to get both.
- `since`: defaults to 24 hours before `computedAt`.
- Returns every open movement, plus finished ones with `doneAt` after `since`. Newest `createdAt` first.
```json
{
  "computedAt": "2026-10-08T14:00:00Z",
  "movements": [
    {
        "id": "mv-1",
        "direction": "IN",
        "variantId": "var-1",
        "quantity": 196,
        "status": "RECEIVED",
        "source": "TRANSFER",
        "detail": "FULL",
        "ref": "gid://shopify/InventoryShipment/123",
        "createdAt": "2026-10-06T09:00:00Z",
        "shippedAt": "2026-10-06T15:00:00Z",
        "doneAt": "2026-10-08T11:00:00Z",
        "statusAt": "2026-10-08T11:00:00Z",
        "carrier": null,
    }
  ]
}
```

| Field | Values |
|-------|--------|

| `status` | `IN`: `IN_TRANSIT`, `RECEIVED` · `OUT`: `COMMITTED`, `PACKED`, `SHIPPED` |
| `source` | `TRANSFER`, `THREE_PL`, `MANUAL` (inbound) · `ORDER` (outbound) |
| `detail` | `FULL`: all times known · `RECEIVED_ONLY`: no `shippedAt` · `INFERRED`: built from a stock gap, `ref` is `null` |
| `ref` | Id of the source record (shipment or order), for click-through |
| `doneAt` | Received (`IN`) or shipped (`OUT`). `null` while open |
| `statusAt` | When it entered its current status. Used for stuck alerts |
| `carrier` | `OUT` only. Tracking company from Shopify, e.g. `UPS`. `null` → `OTHER` truck |

Draw rule: `shippedAt` set → animate the truck. Only `doneAt` → show the pallet at the dock.
Outbound trucks: one truck per `carrier` + `shippedAt` hour. On `SHIPPED` the truck leaves and an empty one pulls in. Delivery is out of scope (see the delivery map).

**OPEN:** `INFERRED` movements can be wrong. A field for the cause will be added before this is built.

## Errors
| Code | When |
|------|------|
| 400 | Missing or unknown `locationId`, bad `direction`, or `since` is not an ISO date |
| 500 | Database failure; body `{ "error": "message" }` |

## Caching
None in v1. The client re-fetches on the refresh timer.

## Depends on
[Data Model](05-data-model.md)