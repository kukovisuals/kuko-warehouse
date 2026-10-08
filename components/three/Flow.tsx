'use client'

import { useMemo, useState } from 'react'
import { buildLoop, loopSource, staticScene } from '@/lib/warehouse/choreography'
import type { Flow as FlowData } from '@/lib/warehouse/flow'
import { AnimatedInstances } from './AnimatedInstances'
import { FloorLabel } from './FloorLabel'
import { prefersReducedMotion } from './reducedMotion'
import { Trucks } from './Trucks'

/**
 * Trucks at the docks, pallets, packed parcels and the shipped stacks, with their counts.
 * By default a looping day plays: deliveries unload, parcels get packed and shipped, the trucks leave and the day restarts.
 * With reduced motion it shows the data as it is, with no loop.
 */
export function Flow({ flow }: { flow: FlowData }) {
  const [still] = useState(prefersReducedMotion)
  const source = useMemo(() => {
    if (still) {
      const scene = staticScene(flow)
      return { items: () => scene.items, trucks: () => scene.trucks }
    }
    return loopSource(buildLoop(flow))
  }, [flow, still])

  return (
    <group>
      <Trucks getSpecs={source.trucks} />
      <AnimatedInstances getItems={source.items} />

      <FloorLabel x={flow.packed.label.x} z={flow.packed.label.z} size={0.3}>
        {flow.packed.label.text}
      </FloorLabel>
      {flow.stacks.map((s) => (
        <FloorLabel key={s.carrier} x={s.label.x} z={s.label.z} size={0.3}>
          {s.label.text}
        </FloorLabel>
      ))}
    </group>
  )
}
