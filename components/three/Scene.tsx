'use client'

import { OrthographicCamera } from '@react-three/drei'
import { Canvas, useThree } from '@react-three/fiber'
import { cameraPosition, fitZoom } from '@/lib/warehouse/camera'
import type { Flow as FlowData } from '@/lib/warehouse/flow'
import type { WarehouseLayout } from '@/lib/warehouse/layout'
import { Flow } from './Flow'
import { Racks } from './Racks'
import { Warehouse } from './Warehouse'

/** Fixed orthographic camera aimed at the floor center, zoomed to fit the floor. */
function FitCamera({ depth }: { depth: number }) {
  const size = useThree((s) => s.size)
  return (
    <OrthographicCamera
      makeDefault
      position={cameraPosition()}
      zoom={fitZoom(size.width, size.height, depth)}
      near={0.1}
      far={300}
      onUpdate={(c) => c.lookAt(0, 0, 0)}
    />
  )
}

export function Scene({ layout, flow }: { layout: WarehouseLayout; flow: FlowData }) {
  return (
    <Canvas orthographic flat dpr={[1, 2]}>
      <FitCamera depth={layout.floorDepth} />
      <hemisphereLight args={['#FFFFFF', '#E3E7F0', 2.8]} />
      <directionalLight position={[-12, 22, 14]} intensity={1.0} />
      <Warehouse depth={layout.floorDepth} />
      <Racks layout={layout} />
      <Flow flow={flow} />
    </Canvas>
  )
}
