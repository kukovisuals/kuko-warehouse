'use client'

import { dockZs, FLOOR, ZONES } from '@/lib/warehouse/layout'
import { COLORS, WALL_OPACITY } from '@/lib/theme'
import { FloorLabel } from './FloorLabel'

const HALF_LENGTH = FLOOR.length / 2

/** A flat strip on the floor. */
function Line({ x, z, length, along, color }: { x: number; z: number; length: number; along: 'x' | 'z'; color: string }) {
  return (
    <mesh position={[x, ZONES.lineLift, z]} rotation={[-Math.PI / 2, 0, along === 'z' ? Math.PI / 2 : 0]}>
      <planeGeometry args={[length, ZONES.lineWidth]} />
      <meshStandardMaterial color={color} roughness={1} />
    </mesh>
  )
}

function Wall({ position, size }: { position: [number, number, number]; size: [number, number, number] }) {
  return (
    <mesh position={position}>
      <boxGeometry args={size} />
      <meshStandardMaterial color={COLORS.wall} roughness={1} transparent opacity={WALL_OPACITY} />
    </mesh>
  )
}

/** Floor, walls, zone lines, docks, lanes and floor labels. */
export function Warehouse({ depth }: { depth: number }) {
  const halfDepth = depth / 2
  const dockInset = ZONES.dockWidth / 2
  const wallY = FLOOR.wallHeight / 2
  const wallZ = -halfDepth + FLOOR.wallThickness / 2
  const returnZ = -halfDepth + FLOOR.returnLength / 2
  const returnX = HALF_LENGTH - FLOOR.wallThickness / 2
  const labelZ = halfDepth - 0.55

  return (
    <group>
      {/* Floor plate: top face white, sides tinted. Top surface sits at y = 0. */}
      <mesh position={[0, -FLOOR.thickness / 2, 0]}>
        <boxGeometry args={[FLOOR.length, FLOOR.thickness, depth]} />
        {[COLORS.floorEdge, COLORS.floorEdge, COLORS.floor, COLORS.floorEdge, COLORS.floorEdge, COLORS.floorEdge].map((c, i) => (
          <meshStandardMaterial key={i} attach={`material-${i}`} color={c} roughness={1} />
        ))}
      </mesh>

      <Wall position={[0, wallY, wallZ]} size={[FLOOR.length, FLOOR.wallHeight, FLOOR.wallThickness]} />
      <Wall position={[-returnX, wallY, returnZ]} size={[FLOOR.wallThickness, FLOOR.wallHeight, FLOOR.returnLength]} />
      <Wall position={[returnX, wallY, returnZ]} size={[FLOOR.wallThickness, FLOOR.wallHeight, FLOOR.returnLength]} />

      <Line x={ZONES.receivingLineX} z={0} length={depth} along="z" color={COLORS.inbound} />
      <Line x={ZONES.packLineX} z={0} length={depth} along="z" color={COLORS.outbound} />

      {dockZs(depth).map((z) => {
        const blueX = -HALF_LENGTH + dockInset
        const redX = HALF_LENGTH - dockInset
        return (
          <group key={z}>
            <mesh position={[blueX, ZONES.dockHeight / 2, z]}>
              <boxGeometry args={[ZONES.dockWidth, ZONES.dockHeight, ZONES.dockLength]} />
              <meshStandardMaterial color={COLORS.inbound} roughness={1} />
            </mesh>
            <mesh position={[redX, ZONES.dockHeight / 2, z]}>
              <boxGeometry args={[ZONES.dockWidth, ZONES.dockHeight, ZONES.dockLength]} />
              <meshStandardMaterial color={COLORS.outbound} roughness={1} />
            </mesh>
            <Line x={(blueX + ZONES.receivingLineX) / 2} z={z} length={ZONES.receivingLineX - blueX} along="x" color={COLORS.inbound} />
            <Line x={(redX + ZONES.packLineX) / 2} z={z} length={redX - ZONES.packLineX} along="x" color={COLORS.outbound} />
          </group>
        )
      })}

      <FloorLabel x={-16.5} z={labelZ}>RECEIVING</FloorLabel>
      <FloorLabel x={-4} z={labelZ}>FLAGSHIP · DEATH WISH COFFEE</FloorLabel>
      <FloorLabel x={8} z={labelZ}>PACK</FloorLabel>
      <FloorLabel x={17} z={labelZ}>SHIPPING</FloorLabel>
    </group>
  )
}
