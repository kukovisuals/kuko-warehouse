import { describe, expect, it } from 'vitest'
import { cameraPosition, fitZoom } from './camera'

describe('camera', () => {
  it('sits in front of and above the floor', () => {
    const [x, y, z] = cameraPosition()
    expect(y).toBeGreaterThan(0)
    expect(z).toBeGreaterThan(0)
    expect(x).toBeGreaterThan(0)
  })

  it('zooms with the viewport and fits it when the floor grows', () => {
    expect(fitZoom(2000, 1000, 26.4)).toBeGreaterThan(fitZoom(1000, 500, 26.4))
    expect(fitZoom(1600, 1000, 40)).toBeLessThan(fitZoom(1600, 1000, 10))
  })

  it('leaves a margin around the floor', () => {
    const zoom = fitZoom(1600, 1000, 26.4)
    // 40 m long, projected: at most 40 m wide on screen.
    expect(zoom * 40).toBeLessThanOrEqual(1600 * 0.9 + 1e-6)
  })
})
