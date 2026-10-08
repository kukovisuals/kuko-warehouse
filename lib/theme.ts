// Color tokens from wiki/design-specs.md.
export const COLORS = {
  page: '#E4E8F0',
  card: '#FFFFFF',
  floor: '#FFFFFF',
  floorEdge: '#E1E6F0',
  wall: '#EDF2FB', // drawn at 70% opacity
  rackFrame: '#D7DCE5',
  inbound: '#4677EE',
  outbound: '#E5463C',
  label: '#8A8F99',
} as const

export const WALL_OPACITY = 0.7

// Flow tokens: not in the spec's color table yet.
export const FLOW_COLORS = {
  truckBody: '#F6F8FC',
  truckCab: '#FFFFFF',
  truckGlass: '#2A2E37',
  wheel: '#1B1E25',
  packed: '#F08A83', // lighter outbound red: packed, not yet shipped
} as const
