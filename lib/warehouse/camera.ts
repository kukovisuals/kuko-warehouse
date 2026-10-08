// Fixed view: elevation and azimuth tuned to the mockup. No orbit in v1 (OPEN-D3).
import { FLOW } from './flow'
import { FLOOR } from './layout'

export const ELEVATION = (42 * Math.PI) / 180
export const AZIMUTH = (20 * Math.PI) / 180
export const CAMERA_DISTANCE = 80
/** The floor fills 90% of the view: a 10% margin. */
export const FIT = 0.9

/** Camera position: front (+z) and toward the shipping side (+x), looking at the floor center. */
export function cameraPosition(): [number, number, number] {
  return [
    CAMERA_DISTANCE * Math.sin(AZIMUTH) * Math.cos(ELEVATION),
    CAMERA_DISTANCE * Math.sin(ELEVATION),
    CAMERA_DISTANCE * Math.cos(AZIMUTH) * Math.cos(ELEVATION),
  ]
}

/** Orthographic zoom (pixels per meter) so the floor, walls and the truck apron on both sides fit the view with a margin. */
export function fitZoom(width: number, height: number, floorDepth: number): number {
  const right = [Math.cos(AZIMUTH), 0, -Math.sin(AZIMUTH)]
  const up = [-Math.sin(ELEVATION) * Math.sin(AZIMUTH), Math.cos(ELEVATION), -Math.sin(ELEVATION) * Math.cos(AZIMUTH)]
  let halfW = 0
  let halfH = 0
  const halfLength = FLOOR.length / 2 + FLOW.apron
  for (const x of [-halfLength, halfLength])
    for (const y of [-FLOOR.thickness, FLOOR.wallHeight])
      for (const z of [-floorDepth / 2, floorDepth / 2]) {
        halfW = Math.max(halfW, Math.abs(x * right[0] + y * right[1] + z * right[2]))
        halfH = Math.max(halfH, Math.abs(x * up[0] + y * up[1] + z * up[2]))
      }
  return FIT * Math.min(width / 2 / halfW, height / 2 / halfH)
}
