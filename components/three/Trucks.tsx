'use client'

import { useFrame } from '@react-three/fiber'
import { useLayoutEffect, useRef, useState } from 'react'
import type { Group } from 'three'
import { type TruckPose, type TruckSpec, TruckTracker, truckX } from '@/lib/warehouse/trucks'
import { prefersReducedMotion } from './reducedMotion'
import { Truck } from './Truck'

/** Trucks drive in when they appear and out when they go. The tracker owns the timing; frames only move the groups. */
export function Trucks({ getSpecs }: { getSpecs: (now: number) => TruckSpec[] }) {
  const [tracker] = useState(() => new TruckTracker({ instant: prefersReducedMotion() }))
  const [trucks, setTrucks] = useState<TruckPose[]>([])
  const groups = useRef(new Map<string, Group>())

  const source = useRef(getSpecs)
  const applied = useRef<TruckSpec[] | null>(null)
  const shown = useRef('')
  useLayoutEffect(() => {
    source.current = getSpecs
  }, [getSpecs])

  useFrame((state) => {
    const now = state.clock.elapsedTime
    const specs = source.current(now)
    if (applied.current !== specs) {
      tracker.update(specs, now)
      applied.current = specs
    }
    const poses = tracker.sample(now)

    // Re-render only when a truck appears or disappears; moving them is a plain mutation.
    const ids = poses.map((p) => p.id).join()
    if (ids !== shown.current) {
      shown.current = ids
      setTrucks(poses)
    }
    for (const pose of poses) {
      const group = groups.current.get(pose.id)
      if (group) group.position.x = truckX(pose.side, pose.offset)
    }
  })

  return (
    <group>
      {trucks.map((t) => (
        <Truck
          key={t.id}
          side={t.side}
          z={t.z}
          offset={t.offset}
          ref={(g) => {
            if (g) groups.current.set(t.id, g)
            else groups.current.delete(t.id)
          }}
        />
      ))}
    </group>
  )
}
