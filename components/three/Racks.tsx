'use client'

import { useMemo } from 'react'
import { DoubleSide, Shape } from 'three'
import { COLORS } from '@/lib/theme'
import { RACK, type WarehouseLayout } from '@/lib/warehouse/layout'
import { Instanced, type InstancedBox } from './Instanced'

const END_CAP_COLOR = '#BFC5D0'
const END_CAP_FOOT = 0.7

// Shelves are open rails, not solid plates, so box tops stay visible from above (mockup 2a).
const RAIL_DEPTH = 0.06
const RAIL_Z = [-0.57, -0.3, 0.3, 0.57]

/** Uprights at every bay edge (front and back) and four shelf rails under each level. */
function frameBoxes(rowZs: number[]): InstancedBox[] {
  const rowLength = RACK.baysPerRow * RACK.bayLength
  const out: InstancedBox[] = []
  for (const z of rowZs) {
    for (let edge = 0; edge <= RACK.baysPerRow; edge++) {
      const x = RACK.startX + edge * RACK.bayLength
      for (const side of [-1, 1]) {
        out.push({
          position: [x, RACK.height / 2, z + side * (RACK.depth / 2 - RACK.uprightSize / 2)],
          size: [RACK.uprightSize, RACK.height, RACK.uprightSize],
        })
      }
    }
    for (let level = 0; level < RACK.levels; level++) {
      for (const dz of RAIL_Z) {
        out.push({
          position: [RACK.startX + rowLength / 2, level * RACK.levelHeight + RACK.shelfThickness / 2, z + dz],
          size: [rowLength, RACK.shelfThickness, RAIL_DEPTH],
        })
      }
    }
  }
  return out
}

/** Triangular plate at the left end of a row: tall edge on the end upright, foot flaring out onto the floor. */
function EndCap({ z }: { z: number }) {
  const shape = useMemo(() => {
    const s = new Shape()
    s.moveTo(0, 0)
    s.lineTo(0, RACK.height)
    s.lineTo(-END_CAP_FOOT, 0)
    s.closePath()
    return s
  }, [])
  return (
    <mesh position={[RACK.startX, 0, z]}>
      <shapeGeometry args={[shape]} />
      <meshStandardMaterial color={END_CAP_COLOR} roughness={1} side={DoubleSide} transparent opacity={0.85} />
    </mesh>
  )
}

export function Racks({ layout }: { layout: WarehouseLayout }) {
  const frame = useMemo(() => frameBoxes(layout.rows.map((r) => r.z)), [layout.rows])
  const boxes = useMemo<InstancedBox[]>(
    () =>
      layout.boxes.map((b) => ({
        position: b.position,
        size: [RACK.box.width, RACK.box.height, RACK.box.depth],
        color: b.color,
      })),
    [layout.boxes],
  )

  return (
    <group>
      <Instanced boxes={frame} color={COLORS.rackFrame} />
      <Instanced boxes={boxes} />
      {layout.rows.map((row) => (
        <EndCap key={row.productId} z={row.z} />
      ))}
    </group>
  )
}
