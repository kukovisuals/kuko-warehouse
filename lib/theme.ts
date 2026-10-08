// Color tokens from wiki/design-specs.md.
export const COLORS = {
  page: '#E4E8F0',
  card: '#FFFFFF',
  floor: '#FFFFFF',
  floorEdge: '#E1E6F0',
  wall: '#EDF2FB', // drawn at 70% opacity
  rackFrame: '#D7DCE5',
  inbound: '#4677EE',
  outbound: '#F2B01E', // yellow, changed from the spec's red (pack lines, shipping docks, outbound trucks)
  outboundText: '#A87400', // readable on white; yellow itself is too light for numbers
  label: '#8A8F99',
} as const

export const WALL_OPACITY = 0.7

// Flow tokens: not in the spec's color table yet.
export const FLOW_COLORS = {
  truckBody: '#F6F8FC',
  truckCab: '#FFFFFF',
  truckGlass: '#2A2E37',
  wheel: '#1B1E25',
} as const
