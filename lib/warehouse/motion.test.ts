import { describe, expect, it } from 'vitest'
import { type Item, MOTION, MotionTracker } from './motion'

const item = (id: string, x: number, over: Partial<Item> = {}): Item => ({
  id,
  position: [x, 0.5, 0],
  size: [1, 1, 1],
  color: '#E5463C',
  ...over,
})
const poseOf = (t: MotionTracker, id: string, now: number) => t.sample(now).find((p) => p.id === id)

describe('MotionTracker', () => {
  it('sends a new block from its start point to its place', () => {
    const t = new MotionTracker()
    t.update([item('a', 10, { from: [0, 0.5, 0] })], 0)
    expect(poseOf(t, 'a', 0)?.position[0]).toBeCloseTo(0)
    const mid = poseOf(t, 'a', MOTION.moveSeconds / 2)!
    expect(mid.position[0]).toBeGreaterThan(0)
    expect(mid.position[0]).toBeLessThan(10)
    expect(mid.position[1]).toBeGreaterThan(0.5) // hops
    const end = poseOf(t, 'a', MOTION.moveSeconds + 0.01)!
    expect(end.position).toEqual([10, 0.5, 0])
    expect(end.size).toEqual([1, 1, 1])
  })

  it('keeps a new block invisible until its turn, then grows it in as it travels', () => {
    const t = new MotionTracker()
    const items = Array.from({ length: 40 }, (_, i) => item(`b${i}`, i + 1, { from: [0, 0.5, 0] }))
    t.update(items, 0)
    expect(poseOf(t, 'b39', 0.2)?.size).toEqual([0, 0, 0]) // waiting: starts at 0.975s
    const growing = poseOf(t, 'b0', MOTION.moveSeconds / 2)!.size[0]
    expect(growing).toBeGreaterThan(0)
    expect(growing).toBeLessThan(1)
    expect(poseOf(t, 'b39', 10)?.size).toEqual([1, 1, 1])
  })

  it('pops a block in place when it has no start point', () => {
    const t = new MotionTracker()
    t.update([item('a', 4)], 0)
    expect(poseOf(t, 'a', 0)?.size).toEqual([0, 0, 0])
    expect(poseOf(t, 'a', 0)?.position[0]).toBeCloseTo(4)
    expect(poseOf(t, 'a', 5)?.size).toEqual([1, 1, 1])
  })

  it('hops a moved block from where it is, and recolors it on the way', () => {
    const t = new MotionTracker()
    t.update([item('a', 0, { color: '#F08A83' })], 0)
    t.update([item('a', 8, { color: '#E5463C' })], 10)
    expect(poseOf(t, 'a', 10)?.position[0]).toBeCloseTo(0)
    expect(poseOf(t, 'a', 10)?.color).toBe('#f08a83')
    expect(poseOf(t, 'a', 10 + MOTION.moveSeconds / 2)?.color).not.toBe('#f08a83')
    expect(poseOf(t, 'a', 20)).toMatchObject({ position: [8, 0.5, 0], color: '#e5463c' })
  })

  it('continues from the current spot when a block is redirected mid-flight', () => {
    const t = new MotionTracker()
    t.update([item('a', 0, { from: [0, 0.5, 0] })], 0)
    t.update([item('a', 10)], 1) // first move finished at 0.9
    const mid = poseOf(t, 'a', 1 + MOTION.moveSeconds / 2)!.position[0]
    t.update([item('a', -10)], 1 + MOTION.moveSeconds / 2)
    expect(poseOf(t, 'a', 1 + MOTION.moveSeconds / 2)?.position[0]).toBeCloseTo(mid, 1)
  })

  it('leaves unchanged blocks alone', () => {
    const t = new MotionTracker()
    t.update([item('a', 3)], 0)
    expect(t.isAnimating(100)).toBe(false)
    t.update([item('a', 3)], 100)
    expect(t.isAnimating(100)).toBe(false)
  })

  it('shrinks a removed block away, then drops it', () => {
    const t = new MotionTracker()
    t.update([item('a', 3)], 0)
    t.update([], 10)
    expect(poseOf(t, 'a', 10 + MOTION.dieSeconds / 2)?.size[0]).toBeLessThan(1)
    expect(poseOf(t, 'a', 10 + MOTION.dieSeconds + 0.01)).toBeUndefined()
    expect(t.sample(20)).toEqual([])
  })

  it('brings a block back if it returns while shrinking', () => {
    const t = new MotionTracker()
    t.update([item('a', 3)], 0)
    t.update([], 10)
    t.update([item('a', 3)], 10.1)
    expect(poseOf(t, 'a', 20)?.size).toEqual([1, 1, 1])
  })

  it('staggers blocks that change together, up to a cap', () => {
    const t = new MotionTracker()
    const items = Array.from({ length: 500 }, (_, i) => item(`b${i}`, i, { from: [0, 0.5, 0] }))
    t.update(items, 0)
    expect(poseOf(t, 'b0', 0.001)?.position[0]).toBeCloseTo(0, 1)
    expect(t.isAnimating(MOTION.maxStaggerSeconds + MOTION.moveSeconds - 0.01)).toBe(true)
    expect(t.isAnimating(MOTION.maxStaggerSeconds + MOTION.moveSeconds + 0.01)).toBe(false)
    // block 499 is waiting at its start point until its delayed start
    expect(poseOf(t, 'b499', MOTION.maxStaggerSeconds - 0.1)?.position[0]).toBeCloseTo(0, 1)
  })

  it('shows settled blocks at once on the first load, but not later ones', () => {
    const t = new MotionTracker()
    t.update([item('a', 5, { settled: true })], 0)
    expect(poseOf(t, 'a', 0)).toMatchObject({ position: [5, 0.5, 0], size: [1, 1, 1] })
    expect(t.isAnimating(0)).toBe(false)
    t.update([item('a', 5, { settled: true }), item('b', 9, { settled: true, from: [0, 0.5, 0] })], 10)
    expect(poseOf(t, 'b', 10)?.size).toEqual([0, 0, 0]) // arrives after the page was open: it travels in
    expect(t.isAnimating(10)).toBe(true)
  })

  it('brings paced blocks in one at a time', () => {
    const t = new MotionTracker()
    const items = Array.from({ length: 20 }, (_, i) => item(`p${i}`, i, { from: [0, 0.5, 0], step: 0.3 }))
    t.update(items, 0)
    // block i starts at i * 0.3s: at 1.0s blocks 0-3 have begun, block 4 has not
    expect(poseOf(t, 'p3', 1.0)!.size[0]).toBeGreaterThan(0)
    expect(poseOf(t, 'p4', 1.0)!.size[0]).toBe(0)
    expect(poseOf(t, 'p19', 5.0)!.size[0]).toBe(0)
    expect(poseOf(t, 'p19', 19 * 0.3 + MOTION.moveSeconds + 0.01)!.size[0]).toBe(1)
  })

  it('caps how long a paced batch can take', () => {
    const t = new MotionTracker()
    const items = Array.from({ length: 100 }, (_, i) => item(`p${i}`, i, { from: [0, 0.5, 0], step: 1 }))
    t.update(items, 0)
    expect(t.isAnimating(MOTION.maxPacedSeconds + MOTION.moveSeconds - 0.01)).toBe(true)
    expect(t.isAnimating(MOTION.maxPacedSeconds + MOTION.moveSeconds + 0.01)).toBe(false)
  })

  it('snaps everything into place when instant', () => {
    const t = new MotionTracker({ instant: true })
    t.update([item('a', 10, { from: [0, 0.5, 0] })], 0)
    expect(poseOf(t, 'a', 0)?.position).toEqual([10, 0.5, 0])
    t.update([], 1)
    expect(t.sample(1)).toEqual([])
    expect(t.isAnimating(1)).toBe(false)
  })
})
