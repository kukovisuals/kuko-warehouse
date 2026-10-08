'use client'

import type { Ref } from 'react'
import type { Group } from 'three'
import { COLORS, FLOW_COLORS } from '@/lib/theme'
import { FLOW } from '@/lib/warehouse/flow'
import { truckX } from '@/lib/warehouse/trucks'

const BODY = { length: 3.7, height: 2, clearance: 0.45 }
const CAB = { length: 1.3, height: 1.5 }
const WHEEL = { radius: 0.38, width: 0.3 }

/** A box truck parked with its rear at the dock and its cab pointing away from the building. Built from primitives. */
export function Truck({
  side,
  z,
  offset = 0,
  ref,
}: {
  side: 'inbound' | 'outbound'
  z: number
  /** Distance from the parked spot. The owner keeps it current by moving the group, so this is only the first frame. */
  offset?: number
  ref?: Ref<Group>
}) {
  const out = side === 'inbound' ? -1 : 1
  const inbound = side === 'inbound'
  // Both fleets are white; the stripe says which way they are going.
  const accent = inbound ? COLORS.inbound : COLORS.outbound
  const half = FLOW.truck.width / 2
  const cabStart = BODY.length + 0.1

  return (
    // Local +x points away from the dock; scale mirrors it for the left side.
    <group ref={ref} position={[truckX(side, offset), 0, z]} scale={[out, 1, 1]}>
      <mesh position={[BODY.length / 2, BODY.clearance + BODY.height / 2, 0]}>
        <boxGeometry args={[BODY.length, BODY.height, FLOW.truck.width]} />
        <meshStandardMaterial color={FLOW_COLORS.truckBody} roughness={1} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[BODY.length / 2, BODY.clearance + 0.8, s * (half + 0.01)]}>
          <boxGeometry args={[BODY.length - 0.6, 0.2, 0.02]} />
          <meshStandardMaterial color={accent} roughness={1} />
        </mesh>
      ))}
      <mesh position={[cabStart + CAB.length / 2, BODY.clearance + CAB.height / 2, 0]}>
        <boxGeometry args={[CAB.length, CAB.height, FLOW.truck.width - 0.1]} />
        <meshStandardMaterial color={FLOW_COLORS.truckCab} roughness={1} />
      </mesh>
      <mesh position={[cabStart + CAB.length + 0.01, BODY.clearance + 0.95, 0]}>
        <boxGeometry args={[0.04, 0.6, FLOW.truck.width - 0.5]} />
        <meshStandardMaterial color={FLOW_COLORS.truckGlass} roughness={1} />
      </mesh>
      {[0.9, BODY.length + 0.7].flatMap((u) =>
        [-1, 1].map((s) => (
          <mesh key={`${u}${s}`} position={[u, WHEEL.radius, s * (half - 0.1)]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[WHEEL.radius, WHEEL.radius, WHEEL.width, 16]} />
            <meshStandardMaterial color={FLOW_COLORS.wheel} roughness={1} />
          </mesh>
        )),
      )}
    </group>
  )
}
