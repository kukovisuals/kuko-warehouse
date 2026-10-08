'use client'

import { useMemo } from 'react'
import type { Flow as FlowData } from '@/lib/warehouse/flow'
import { FloorLabel } from './FloorLabel'
import { Instanced } from './Instanced'
import { Truck } from './Truck'

/** Trucks at the docks, pallets on the receiving lanes, packed parcels, and the shipped stacks with their counts. */
export function Flow({ flow }: { flow: FlowData }) {
  const shipped = useMemo(() => flow.stacks.flatMap((s) => s.parcels), [flow.stacks])

  return (
    <group>
      {flow.inboundTrucks.map((t) => (
        <Truck key={t.label} side="inbound" z={t.z} />
      ))}
      {flow.outboundTrucks.map((t) => (
        <Truck key={t.label} side="outbound" z={t.z} />
      ))}

      <Instanced boxes={flow.pallets} />
      <Instanced boxes={flow.packed.parcels} />
      <Instanced boxes={shipped} />

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
