import { describe, expect, it } from 'vitest'
import { AZIMUTH, ELEVATION, FIT, fitCamera } from './camera'
import { FLOW } from './flow'
import { dockZs, FLOOR } from './layout'

/** Where the 8 corners of the drawn scene land on screen (pixels from the viewport center) for a camera. */
function screenExtents(width: number, height: number, depth: number) {
  const { target, zoom } = fitCamera(width, height, depth)
  const right = [Math.cos(AZIMUTH), 0, -Math.sin(AZIMUTH)]
  const up = [-Math.sin(ELEVATION) * Math.sin(AZIMUTH), Math.cos(ELEVATION), -Math.sin(ELEVATION) * Math.cos(AZIMUTH)]
  const xs: number[] = []
  const ys: number[] = []
  const add = (x: number, y: number, z: number) => {
    const d = [x - target[0], y - target[1], z - target[2]]
    xs.push((d[0] * right[0] + d[1] * right[1] + d[2] * right[2]) * zoom)
    ys.push((d[0] * up[0] + d[1] * up[1] + d[2] * up[2]) * zoom)
  }
  for (const x of [-FLOOR.length / 2, FLOOR.length / 2])
    for (const y of [-FLOOR.thickness, FLOOR.wallHeight])
      for (const z of [-depth / 2, depth / 2]) add(x, y, z)
  const outer = FLOOR.length / 2 + FLOW.apron
  for (const dock of dockZs(depth))
    for (const x of [-outer, outer])
      for (const y of [0, 2.5])
        for (const z of [dock - FLOW.truck.width / 2, dock + FLOW.truck.width / 2]) add(x, y, z)
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) }
}

describe('fitCamera', () => {
  it('sits in front of, above and toward the shipping side of what it looks at', () => {
    const { position, target } = fitCamera(1600, 1000, 26.4)
    expect(position[0] - target[0]).toBeGreaterThan(0)
    expect(position[1] - target[1]).toBeGreaterThan(0)
    expect(position[2] - target[2]).toBeGreaterThan(0)
  })

  it('zooms with the viewport and zooms out when the floor grows', () => {
    expect(fitCamera(2000, 1000, 26.4).zoom).toBeGreaterThan(fitCamera(1000, 500, 26.4).zoom)
    expect(fitCamera(1600, 1000, 40).zoom).toBeLessThan(fitCamera(1600, 1000, 10).zoom)
  })

  it.each([
    [1128, 918],
    [1600, 1000],
    [900, 1400],
    [2400, 600],
  ])('keeps the floor and every parked truck inside a %i x %i viewport, centered, with the tight axis at the margin', (w, h) => {
    const e = screenExtents(w, h, 20.8)
    // Inside the viewport, and centered on screen.
    expect(e.maxX).toBeLessThanOrEqual((w / 2) * FIT + 1e-6)
    expect(e.minX).toBeGreaterThanOrEqual((-w / 2) * FIT - 1e-6)
    expect(e.maxY).toBeLessThanOrEqual((h / 2) * FIT + 1e-6)
    expect(e.minY).toBeGreaterThanOrEqual((-h / 2) * FIT - 1e-6)
    expect((e.minX + e.maxX) / 2).toBeCloseTo(0, 5)
    expect((e.minY + e.maxY) / 2).toBeCloseTo(0, 5)
    // The tighter axis touches the margin: nothing is left on the table.
    const fillX = (e.maxX - e.minX) / w
    const fillY = (e.maxY - e.minY) / h
    expect(Math.max(fillX, fillY)).toBeCloseTo(FIT, 5)
  })
})
