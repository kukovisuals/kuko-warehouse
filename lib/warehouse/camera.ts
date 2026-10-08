// Fixed view: elevation and azimuth tuned to the mockup. No orbit in v1 (OPEN-D3).
import { FLOW } from './flow'
import { dockZs, FLOOR } from './layout'

export const ELEVATION = (42 * Math.PI) / 180
export const AZIMUTH = (20 * Math.PI) / 180
export const CAMERA_DISTANCE = 80
/** The scene fills 96% of the view: a 2% margin each side. */
export const FIT = 0.96
/** Roof height of a parked truck. */
const TRUCK_TOP = 2.5

type V3 = [number, number, number]

export interface CameraView {
  position: V3
  /** The point the camera looks at: the middle of the floor and truck aprons as seen on screen. */
  target: V3
  /** Orthographic zoom, in pixels per meter. */
  zoom: number
}

/**
 * Camera that frames the floor, walls and the truck apron on both sides as large as the viewport allows.
 * It looks at the middle of what is drawn, not the middle of the floor, so a wide viewport has no dead band.
 */
export function fitCamera(width: number, height: number, floorDepth: number): CameraView {
  const right: V3 = [Math.cos(AZIMUTH), 0, -Math.sin(AZIMUTH)]
  const up: V3 = [-Math.sin(ELEVATION) * Math.sin(AZIMUTH), Math.cos(ELEVATION), -Math.sin(ELEVATION) * Math.cos(AZIMUTH)]
  const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

  let minR = Infinity
  let maxR = -Infinity
  let minU = Infinity
  let maxU = -Infinity
  const grow = (p: V3) => {
    minR = Math.min(minR, dot(p, right))
    maxR = Math.max(maxR, dot(p, right))
    minU = Math.min(minU, dot(p, up))
    maxU = Math.max(maxU, dot(p, up))
  }

  // The floor and walls...
  for (const x of [-FLOOR.length / 2, FLOOR.length / 2])
    for (const y of [-FLOOR.thickness, FLOOR.wallHeight])
      for (const z of [-floorDepth / 2, floorDepth / 2]) grow([x, y, z])
  // ...and the trucks where they actually park, not the empty corners of the apron.
  const outerX = FLOOR.length / 2 + FLOW.apron
  for (const dockZ of dockZs(floorDepth))
    for (const x of [-outerX, outerX])
      for (const y of [0, TRUCK_TOP])
        for (const z of [dockZ - FLOW.truck.width / 2, dockZ + FLOW.truck.width / 2]) grow([x, y, z])

  const centerR = (minR + maxR) / 2
  const centerU = (minU + maxU) / 2
  const target: V3 = [
    right[0] * centerR + up[0] * centerU,
    right[1] * centerR + up[1] * centerU,
    right[2] * centerR + up[2] * centerU,
  ]
  const toCamera: V3 = [
    CAMERA_DISTANCE * Math.sin(AZIMUTH) * Math.cos(ELEVATION),
    CAMERA_DISTANCE * Math.sin(ELEVATION),
    CAMERA_DISTANCE * Math.cos(AZIMUTH) * Math.cos(ELEVATION),
  ]

  return {
    position: [target[0] + toCamera[0], target[1] + toCamera[1], target[2] + toCamera[2]],
    target,
    zoom: FIT * Math.min(width / (maxR - minR), height / (maxU - minU)),
  }
}
