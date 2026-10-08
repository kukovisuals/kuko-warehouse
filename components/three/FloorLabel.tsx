'use client'

import { Text } from '@react-three/drei'
import { COLORS } from '@/lib/theme'

const FONT = '/fonts/jetbrains-mono-500.woff'

/** Text lying flat on the floor, readable from the front. Floor markings are the one place text is drawn in 3D. */
export function FloorLabel({ x, z, size = 0.35, children }: { x: number; z: number; size?: number; children: string }) {
  return (
    <Text
      font={FONT}
      position={[x, 0.01, z]}
      rotation={[-Math.PI / 2, 0, 0]}
      fontSize={size}
      letterSpacing={0.25}
      color={COLORS.label}
      anchorX="center"
      anchorY="middle"
    >
      {children}
    </Text>
  )
}
