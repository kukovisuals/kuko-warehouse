// prisma/seed.config.ts — the only place seed numbers are typed.
// The seed, its checks, and its tests read from here.

export const seedConfig = {
  randomSeed: 4242,
  windowHours: 24, // previous SyncRun = now − 24h, current SyncRun = now

  location: { id: 'loc-1', name: 'NJ Warehouse' },

  products: [
    {
      id: 'prod-1', title: 'Death Wish Ground Coffee', category: 'Coffee',
      variants: [
        { id: 'var-1', sku: 'DW-GRD-1LB', options: { Grind: 'Ground', Size: '1 lb' }, startOnHand: 240 },
        { id: 'var-2', sku: 'DW-GRD-5LB', options: { Grind: 'Ground', Size: '5 lb' }, startOnHand: 60 },
      ],
    },
    {
      id: 'prod-2', title: 'Death Wish Whole Bean Coffee', category: 'Coffee',
      variants: [
        { id: 'var-3', sku: 'DW-WB-1LB', options: { Grind: 'Whole Bean', Size: '1 lb' }, startOnHand: 180 },
        { id: 'var-4', sku: 'DW-WB-5LB', options: { Grind: 'Whole Bean', Size: '5 lb' }, startOnHand: 48 },
      ],
    },
    {
      id: 'prod-3', title: 'Valhalla Java', category: 'Coffee',
      variants: [
        { id: 'var-5', sku: 'VJ-GRD-1LB', options: { Grind: 'Ground', Size: '1 lb' }, startOnHand: 120 },
        { id: 'var-6', sku: 'VJ-WB-1LB', options: { Grind: 'Whole Bean', Size: '1 lb' }, startOnHand: 96 },
      ],
    },
    {
      id: 'prod-4', title: 'Death Wish Single-Serve Pods', category: 'Pods',
      variants: [
        { id: 'var-7', sku: 'DW-POD-10', options: { Count: '10' }, startOnHand: 150 },
        { id: 'var-8', sku: 'DW-POD-50', options: { Count: '50' }, startOnHand: 72 },
      ],
    },
    {
      id: 'prod-5', title: 'Skull Mug', category: 'Merch',
      variants: [
        { id: 'var-9', sku: 'MUG-BLK', options: { Color: 'Black' }, startOnHand: 60 },
        { id: 'var-10', sku: 'MUG-WHT', options: { Color: 'White' }, startOnHand: 36 },
      ],
    },
    {
      id: 'prod-6', title: 'Logo Tee', category: 'Merch',
      variants: [
        { id: 'var-11', sku: 'TEE-M', options: { Size: 'M' }, startOnHand: 40 },
        { id: 'var-12', sku: 'TEE-L', options: { Size: 'L' }, startOnHand: 40 },
      ],
    },
  ],

  // Outbound: Shopify-shaped orders, all created inside the window
  orders: {
    firstNumber: 48210,         // ref gid://shopify/Order/48210, 48211, …
    unfulfilled: 30,            // no fulfillment
    fulfilledNoPickup: 40,      // fulfillment, no carrier event yet
    pickedUp: 50,               // fulfillment + CARRIER_PICKED_UP
    cancelled: 4,               // cancelled, never fulfilled
    linesPerOrder: [1, 2],      // inclusive range
    unitsPerLine: [1, 3],       // inclusive range
  },

  // Shopify trackingCompany; null → OTHER truck
  carrierMix: { UPS: 0.5, USPS: 0.35, FedEx: 0.1, null: 0.05 },

  // Inbound: Shopify InventoryShipments (ref gid://shopify/InventoryShipment/101, …)
  transfers: [
    { status: 'RECEIVED', lines: 3 },
    { status: 'RECEIVED', lines: 2 },
    { status: 'IN_TRANSIT', lines: 3 },
    { status: 'DRAFT', lines: 2 },
  ],
  transferLineQty: { min: 48, max: 240, step: 12 },

  // Inbound: 3PL receipts (ref 3pl-receipt-1, …)
  threePlReceipts: [{ lines: 2 }, { lines: 1 }],
  receiptLineQty: { min: 24, max: 120, step: 12 },

  // Stock changes with no movement → the balance check makes INFERRED movements
  inferredGaps: [
    { variantId: 'var-9', gap: -2 },  // broken mugs
    { variantId: 'var-4', gap: 5 },   // found in a recount
  ],
} as const
