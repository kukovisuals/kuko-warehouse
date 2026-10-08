'use client'

import { useFrame } from '@react-three/fiber'
import { useLayoutEffect, useRef, useState } from 'react'
import { Color, InstancedMesh, Matrix4, Quaternion, Vector3 } from 'three'
import { type Item, MotionTracker } from '@/lib/warehouse/motion'
import { prefersReducedMotion } from './reducedMotion'

const identity = new Quaternion()
const INITIAL_CAPACITY = 256

/** Boxes that travel between refreshes. One draw call; the mesh regrows (doubling) when there are more boxes than room. */
export function AnimatedInstances({ getItems }: { getItems: (now: number) => Item[] }) {
  const meshRef = useRef<InstancedMesh>(null)
  const [tracker] = useState(() => new MotionTracker({ instant: prefersReducedMotion() }))
  const [capacity, setCapacity] = useState(INITIAL_CAPACITY)

  const source = useRef(getItems)
  const applied = useRef<Item[] | null>(null)
  const written = useRef<InstancedMesh | null>(null)
  useLayoutEffect(() => {
    source.current = getItems
  }, [getItems])

  useFrame((state) => {
    const mesh = meshRef.current
    if (!mesh) return
    const now = state.clock.elapsedTime

    // The source hands back the same array until the scene changes, so this is cheap on most frames.
    const items = source.current(now)
    const fresh = applied.current !== items
    if (fresh) {
      tracker.update(items, now)
      applied.current = items
    }
    // A remounted mesh (after regrowing) is empty, so it needs a full write too.
    if (!fresh && written.current === mesh && !tracker.isAnimating(now)) return

    const poses = tracker.sample(now)
    if (poses.length > capacity) {
      setCapacity(Math.max(capacity * 2, 1 << Math.ceil(Math.log2(poses.length))))
      return
    }

    const matrix = new Matrix4()
    const position = new Vector3()
    const scale = new Vector3()
    const color = new Color()
    poses.forEach((pose, i) => {
      matrix.compose(position.set(...pose.position), identity, scale.set(...pose.size))
      mesh.setMatrixAt(i, matrix)
      mesh.setColorAt(i, color.set(pose.color))
    })
    mesh.count = poses.length
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    written.current = mesh
  })

  return (
    <instancedMesh key={capacity} ref={meshRef} args={[undefined, undefined, capacity]} frustumCulled={false}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color="#FFFFFF" roughness={1} />
    </instancedMesh>
  )
}
