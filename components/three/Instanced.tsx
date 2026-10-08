'use client'

import { useLayoutEffect, useRef } from 'react'
import { Color, InstancedMesh, Matrix4, Quaternion, Vector3 } from 'three'

export interface InstancedBox {
  position: [number, number, number]
  /** Box size. Defaults to a unit cube. */
  size?: [number, number, number]
  /** Per-instance color. Falls back to the `color` prop. */
  color?: string
}

const identity = new Quaternion()

/** Many boxes, one draw call. The instance count is fixed per mount, so it remounts when the count changes. */
export function Instanced({ boxes, color = '#FFFFFF' }: { boxes: InstancedBox[]; color?: string }) {
  const ref = useRef<InstancedMesh>(null)

  useLayoutEffect(() => {
    const mesh = ref.current
    if (!mesh) return
    const matrix = new Matrix4()
    const c = new Color()
    boxes.forEach((b, i) => {
      const [sx, sy, sz] = b.size ?? [1, 1, 1]
      matrix.compose(new Vector3(...b.position), identity, new Vector3(sx, sy, sz))
      mesh.setMatrixAt(i, matrix)
      if (b.color) mesh.setColorAt(i, c.set(b.color))
    })
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    mesh.computeBoundingSphere()
  }, [boxes])

  if (boxes.length === 0) return null
  return (
    <instancedMesh key={boxes.length} ref={ref} args={[undefined, undefined, boxes.length]}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color={color} roughness={1} />
    </instancedMesh>
  )
}
