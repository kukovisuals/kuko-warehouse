import { describe, expect, it } from 'vitest'
import { balanceGap, movementState, type OrderLine, type TransferLine } from './index'

const d = (iso: string) => new Date(iso)
const created = d('2026-10-01T10:00:00Z')
const shipped = d('2026-10-02T10:00:00Z')
const received = d('2026-10-07T10:00:00Z')

const transfer = (over: Partial<TransferLine>): TransferLine => ({
  shipmentStatus: 'RECEIVED',
  lineFullyReceived: false,
  dateCreated: created,
  dateShipped: shipped,
  dateReceived: received,
  ...over,
})

describe('movementState: IN rules', () => {
  const rows: [string, TransferLine, ReturnType<typeof movementState>][] = [
    ['draft transfer', transfer({ shipmentStatus: 'DRAFT', dateShipped: null, dateReceived: null }), null],
    ['other transfer', transfer({ shipmentStatus: 'OTHER' }), null],
    [
      'received transfer',
      transfer({}),
      { status: 'RECEIVED', createdAt: created, shippedAt: shipped, doneAt: received, statusAt: received, detail: 'FULL' },
    ],
    [
      'partial transfer, line fully received',
      transfer({ shipmentStatus: 'PARTIALLY_RECEIVED', lineFullyReceived: true }),
      { status: 'RECEIVED', createdAt: created, shippedAt: shipped, doneAt: received, statusAt: received, detail: 'FULL' },
    ],
    [
      'in-transit transfer',
      transfer({ shipmentStatus: 'IN_TRANSIT', dateReceived: null }),
      { status: 'IN_TRANSIT', createdAt: created, shippedAt: shipped, doneAt: null, statusAt: shipped, detail: 'FULL' },
    ],
    [
      'partial transfer, line not received',
      transfer({ shipmentStatus: 'PARTIALLY_RECEIVED', dateReceived: null }),
      { status: 'IN_TRANSIT', createdAt: created, shippedAt: shipped, doneAt: null, statusAt: shipped, detail: 'FULL' },
    ],
    [
      'received transfer with no ship date',
      transfer({ dateShipped: null }),
      { status: 'RECEIVED', createdAt: created, shippedAt: null, doneAt: received, statusAt: received, detail: 'RECEIVED_ONLY' },
    ],
  ]

  it.each(rows)('%s', (_name, input, expected) => {
    expect(movementState(input)).toEqual(expected)
  })

  it('3PL or manual receipt is RECEIVED_ONLY', () => {
    expect(movementState({ receivedAt: received })).toEqual({
      status: 'RECEIVED',
      createdAt: received,
      shippedAt: null,
      doneAt: received,
      statusAt: received,
      detail: 'RECEIVED_ONLY',
    })
  })

  it('throws on a received transfer with no received date', () => {
    expect(() => movementState(transfer({ dateReceived: null }))).toThrow(/dateReceived/)
  })
})

describe('movementState: OUT rules', () => {
  const orderAt = d('2026-10-08T08:00:00Z')
  const fulfilledAt = d('2026-10-08T09:00:00Z')
  const pickedUpAt = d('2026-10-08T12:00:00Z')

  const order = (over: Partial<OrderLine>): OrderLine => ({
    orderCreatedAt: orderAt,
    cancelled: false,
    fulfillment: null,
    ...over,
  })
  const noPickup = { createdAt: fulfilledAt, firstCarrierEventAt: null }
  const pickedUp = { createdAt: fulfilledAt, firstCarrierEventAt: pickedUpAt }

  it('cancelled order with no fulfillment makes no movement', () => {
    expect(movementState(order({ cancelled: true }))).toBeNull()
  })

  it('order with no fulfillment is COMMITTED', () => {
    expect(movementState(order({}))).toEqual({
      status: 'COMMITTED',
      createdAt: orderAt,
      shippedAt: null,
      doneAt: null,
      statusAt: orderAt,
      detail: 'FULL',
    })
  })

  describe('OPEN-01 option A (default)', () => {
    const shippedAtFulfillment = {
      status: 'SHIPPED',
      createdAt: orderAt,
      shippedAt: fulfilledAt,
      doneAt: fulfilledAt,
      statusAt: fulfilledAt,
      detail: 'FULL',
    }
    it('fulfillment with no carrier event is SHIPPED at fulfillment time', () => {
      expect(movementState(order({ fulfillment: noPickup }))).toEqual(shippedAtFulfillment)
    })
    it('fulfillment with carrier pickup is SHIPPED at fulfillment time', () => {
      expect(movementState(order({ fulfillment: pickedUp }), { rule: 'A' })).toEqual(shippedAtFulfillment)
    })
  })

  describe('OPEN-01 option B', () => {
    it('fulfillment with no carrier event is PACKED', () => {
      expect(movementState(order({ fulfillment: noPickup }), { rule: 'B' })).toEqual({
        status: 'PACKED',
        createdAt: orderAt,
        shippedAt: null,
        doneAt: null,
        statusAt: fulfilledAt,
        detail: 'FULL',
      })
    })
    it('first carrier event makes it SHIPPED at pickup time', () => {
      expect(movementState(order({ fulfillment: pickedUp }), { rule: 'B' })).toEqual({
        status: 'SHIPPED',
        createdAt: orderAt,
        shippedAt: pickedUpAt,
        doneAt: pickedUpAt,
        statusAt: pickedUpAt,
        detail: 'FULL',
      })
    })
  })
})

describe('balanceGap', () => {
  const now = d('2026-10-08T12:00:00Z')
  const base = { oldOnHand: 100, newOnHand: 100, inDone: 0, outDone: 0, now }

  it('first sync (oldOnHand null) makes no check', () => {
    expect(balanceGap({ ...base, oldOnHand: null, newOnHand: 7 })).toBeNull()
  })

  it('no gap makes no movement', () => {
    expect(balanceGap({ ...base, newOnHand: 112, inDone: 24, outDone: 12 })).toBeNull()
  })

  it.each([
    ['gap of +1', { newOnHand: 101 }, 'IN', 1, 'RECEIVED'],
    ['gap of −1', { newOnHand: 99 }, 'OUT', 1, 'SHIPPED'],
    ['gap of +5 after movements', { newOnHand: 117, inDone: 24, outDone: 12 }, 'IN', 5, 'RECEIVED'],
    ['gap of −2 after movements', { newOnHand: 110, inDone: 24, outDone: 12 }, 'OUT', 2, 'SHIPPED'],
  ] as const)('%s', (_name, over, direction, quantity, status) => {
    expect(balanceGap({ ...base, ...over })).toEqual({
      direction,
      quantity,
      status,
      source: null,
      detail: 'INFERRED',
      ref: null,
      carrier: null,
      createdAt: now,
      shippedAt: null,
      doneAt: now,
      statusAt: now,
    })
  })
})
