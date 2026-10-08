// Status Engine. Pure functions: same input, same output, no database calls.
// The rules live in wiki/status-engine.md. This is the only place that logic lives.

export type TransferLine = {
  // one line of a Shopify InventoryShipment
  shipmentStatus: 'DRAFT' | 'IN_TRANSIT' | 'PARTIALLY_RECEIVED' | 'RECEIVED' | 'OTHER'
  lineFullyReceived: boolean
  dateCreated: Date
  dateShipped: Date | null
  dateReceived: Date | null
}

export type Receipt = { receivedAt: Date } // THREE_PL or MANUAL

export type OrderLine = {
  // one line at one warehouse
  orderCreatedAt: Date
  cancelled: boolean
  fulfillment: { createdAt: Date; firstCarrierEventAt: Date | null } | null
}

export type MovementState = {
  status: 'IN_TRANSIT' | 'RECEIVED' | 'COMMITTED' | 'PACKED' | 'SHIPPED'
  createdAt: Date
  shippedAt: Date | null
  doneAt: Date | null
  statusAt: Date
  detail: 'FULL' | 'RECEIVED_ONLY'
}

export type BalanceInput = {
  oldOnHand: number | null // null on first sync
  newOnHand: number
  inDone: number // IN quantity with doneAt since last SyncRun
  outDone: number // OUT quantity with doneAt since last SyncRun
  now: Date
}

export type InferredMovement = {
  direction: 'IN' | 'OUT'
  quantity: number
  status: 'RECEIVED' | 'SHIPPED'
  source: null
  detail: 'INFERRED'
  ref: null
  carrier: null
  createdAt: Date
  shippedAt: null
  doneAt: Date
  statusAt: Date
}

// OPEN-01: when is an OUT movement SHIPPED? Not decided yet, so both rules are here.
//   A: fulfillment created → SHIPPED. PACKED is never used. Balance is exact.
//   B: fulfillment, no carrier event → PACKED. First carrier event → SHIPPED.
export type ShippedRule = 'A' | 'B'
export type EngineOptions = { rule?: ShippedRule }

export function shippedRuleFromEnv(): ShippedRule {
  return process.env.OPEN01_OPTION === 'B' ? 'B' : 'A'
}

function required(value: Date | null, name: string): Date {
  if (!value) throw new Error(`Status Engine: ${name} is missing`)
  return value
}

// Detail rule: doneAt set and shippedAt null → RECEIVED_ONLY. Anything else → FULL.
function detailOf(shippedAt: Date | null, doneAt: Date | null): MovementState['detail'] {
  return doneAt !== null && shippedAt === null ? 'RECEIVED_ONLY' : 'FULL'
}

function transferState(t: TransferLine): MovementState | null {
  if (t.shipmentStatus === 'DRAFT' || t.shipmentStatus === 'OTHER') return null

  if (t.shipmentStatus === 'RECEIVED' || t.lineFullyReceived) {
    const received = required(t.dateReceived, 'dateReceived on a received transfer')
    return {
      status: 'RECEIVED',
      createdAt: t.dateCreated,
      shippedAt: t.dateShipped,
      doneAt: received,
      statusAt: received,
      detail: detailOf(t.dateShipped, received),
    }
  }

  // IN_TRANSIT or PARTIALLY_RECEIVED (OPEN-02: a partly received line stays IN_TRANSIT)
  const shipped = required(t.dateShipped, 'dateShipped on an in-transit transfer')
  return {
    status: 'IN_TRANSIT',
    createdAt: t.dateCreated,
    shippedAt: shipped,
    doneAt: null,
    statusAt: shipped,
    detail: 'FULL',
  }
}

function receiptState(r: Receipt): MovementState {
  return {
    status: 'RECEIVED',
    createdAt: r.receivedAt,
    shippedAt: null,
    doneAt: r.receivedAt,
    statusAt: r.receivedAt,
    detail: 'RECEIVED_ONLY',
  }
}

function orderState(o: OrderLine, rule: ShippedRule): MovementState | null {
  if (o.cancelled && !o.fulfillment) return null

  if (!o.fulfillment) {
    return {
      status: 'COMMITTED',
      createdAt: o.orderCreatedAt,
      shippedAt: null,
      doneAt: null,
      statusAt: o.orderCreatedAt,
      detail: 'FULL',
    }
  }

  const { createdAt: fulfilledAt, firstCarrierEventAt } = o.fulfillment

  if (rule === 'B') {
    if (!firstCarrierEventAt) {
      return {
        status: 'PACKED',
        createdAt: o.orderCreatedAt,
        shippedAt: null,
        doneAt: null,
        statusAt: fulfilledAt,
        detail: 'FULL',
      }
    }
    return {
      status: 'SHIPPED',
      createdAt: o.orderCreatedAt,
      shippedAt: firstCarrierEventAt,
      doneAt: firstCarrierEventAt,
      statusAt: firstCarrierEventAt,
      detail: 'FULL',
    }
  }

  return {
    status: 'SHIPPED',
    createdAt: o.orderCreatedAt,
    shippedAt: fulfilledAt,
    doneAt: fulfilledAt,
    statusAt: fulfilledAt,
    detail: 'FULL',
  }
}

// null = no movement
export function movementState(
  input: TransferLine | Receipt | OrderLine,
  options: EngineOptions = {},
): MovementState | null {
  if ('shipmentStatus' in input) return transferState(input)
  if ('receivedAt' in input) return receiptState(input)
  return orderState(input, options.rule ?? 'A')
}

// Runs per variant per warehouse, before the new onHand is saved.
export function balanceGap(input: BalanceInput): InferredMovement | null {
  if (input.oldOnHand === null) return null

  const gap = input.newOnHand - (input.oldOnHand + input.inDone - input.outDone)
  if (gap === 0) return null

  return {
    direction: gap > 0 ? 'IN' : 'OUT',
    quantity: Math.abs(gap),
    status: gap > 0 ? 'RECEIVED' : 'SHIPPED',
    source: null,
    detail: 'INFERRED',
    ref: null,
    carrier: null,
    createdAt: input.now,
    shippedAt: null, // shows at the dock with no truck
    doneAt: input.now,
    statusAt: input.now,
  }
}
