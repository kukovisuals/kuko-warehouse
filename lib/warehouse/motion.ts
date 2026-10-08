// Tween blocks between data refreshes. Pure: time is passed in, nothing reads a clock.
// A block is known by `id`. New id -> it grows in as it travels from `from` (or in place), and is invisible until its turn.
// Same id, new place -> it hops there.
// Gone id -> it shrinks away. Blocks that did not change are never touched.

export type V3 = [number, number, number]

export interface Item {
  id: string
  position: V3
  size: V3
  color: string
  from?: V3
  /** Already there when the page first opens, so it gets no entrance. Later arrivals still travel in. */
  settled?: boolean
  /** Seconds after the previous changed block in the same refresh. Larger = blocks arrive one at a time. */
  step?: number
  /** How long the trip takes. Defaults to MOTION.moveSeconds. */
  seconds?: number
  /** `false`: slide along the ground instead of hopping (a pallet coming out of a truck). Default true. */
  hop?: boolean
  /** `false`: start at full size instead of growing in (it is hidden inside a truck until it comes out). Default true. */
  grow?: boolean
}

export type Pose = Pick<Item, 'id' | 'position' | 'size' | 'color'>

export const MOTION = {
  moveSeconds: 0.9,
  dieSeconds: 0.35,
  /** Blocks that change in the same refresh start one after another, up to this total delay. */
  staggerSeconds: 0.025,
  maxStaggerSeconds: 2.4,
  /** Blocks with their own `step` (one at a time) may take longer to all arrive. */
  maxPacedSeconds: 9,
  hopHeight: 1.4,
} as const

interface Entry {
  id: string
  fromPos: V3
  toPos: V3
  fromSize: V3
  toSize: V3
  fromColor: string
  toColor: string
  start: number
  duration: number
  dying: boolean
  hop: boolean
}

const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const lerp3 = (a: V3, b: V3, t: number): V3 => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]
const same3 = (a: V3, b: V3) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2]

function lerpHex(a: string, b: string, t: number): string {
  if (a === b) return a
  const pa = parseInt(a.slice(1), 16)
  const pb = parseInt(b.slice(1), 16)
  const ch = (shift: number) => Math.round(lerp((pa >> shift) & 255, (pb >> shift) & 255, t))
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')}`
}

export class MotionTracker {
  private entries = new Map<string, Entry>()
  private started = false
  private readonly instant: boolean

  /** `instant` snaps every change into place (for reduced motion). */
  constructor(options: { instant?: boolean } = {}) {
    this.instant = options.instant ?? false
  }

  update(items: Item[], now: number): void {
    const ids = new Set(items.map((i) => i.id))

    for (const entry of this.entries.values()) {
      if (ids.has(entry.id) || entry.dying) continue
      if (this.instant) {
        this.entries.delete(entry.id)
        continue
      }
      const pose = this.poseOf(entry, now)
      Object.assign(entry, {
        fromPos: pose.position,
        toPos: pose.position,
        fromSize: pose.size,
        toSize: [0, 0, 0] as V3,
        fromColor: pose.color,
        toColor: pose.color,
        start: now,
        duration: MOTION.dieSeconds,
        dying: true,
      })
    }

    // Changed blocks start one after another. `waited` is how long the ones before this one add up to.
    let waited = 0
    const nextDelay = (item: Item) => {
      if (this.instant) return 0
      const delay = Math.min(waited, item.step ? MOTION.maxPacedSeconds : MOTION.maxStaggerSeconds)
      waited += item.step ?? MOTION.staggerSeconds
      return delay
    }
    const firstLoad = !this.started
    this.started = true

    for (const item of items) {
      const entry = this.entries.get(item.id)

      if (!entry && firstLoad && item.settled) {
        this.entries.set(item.id, {
          id: item.id,
          fromPos: item.position,
          toPos: item.position,
          fromSize: item.size,
          toSize: item.size,
          fromColor: item.color,
          toColor: item.color,
          start: now,
          duration: 0,
          dying: false,
          hop: item.hop ?? true,
        })
        continue
      }

      const delay = entry && !entry.dying && this.unchanged(entry, item) ? 0 : nextDelay(item)

      if (!entry) {
        this.entries.set(item.id, {
          id: item.id,
          fromPos: item.from ?? item.position,
          toPos: item.position,
          fromSize: this.instant || item.grow === false ? item.size : [0, 0, 0],
          toSize: item.size,
          fromColor: item.color,
          toColor: item.color,
          start: now + delay,
          duration: this.instant ? 0 : (item.seconds ?? MOTION.moveSeconds),
          dying: false,
          hop: item.hop ?? true,
        })
        continue
      }

      if (!entry.dying && this.unchanged(entry, item)) continue

      const pose = this.poseOf(entry, now)
      Object.assign(entry, {
        fromPos: pose.position,
        toPos: item.position,
        fromSize: pose.size,
        toSize: item.size,
        fromColor: pose.color,
        toColor: item.color,
        start: now + delay,
        duration: this.instant ? 0 : (item.seconds ?? MOTION.moveSeconds),
        dying: false,
        hop: item.hop ?? true,
      })
    }
  }

  private unchanged(entry: Entry, item: Item): boolean {
    return same3(entry.toPos, item.position) && same3(entry.toSize, item.size) && entry.toColor === item.color
  }

  /** Where every block is at `now`. Drops blocks that finished shrinking away. */
  sample(now: number): Pose[] {
    const poses: Pose[] = []
    for (const entry of this.entries.values()) {
      if (entry.dying && now >= entry.start + entry.duration) {
        this.entries.delete(entry.id)
        continue
      }
      poses.push(this.poseOf(entry, now))
    }
    return poses
  }

  isAnimating(now: number): boolean {
    for (const entry of this.entries.values()) if (now < entry.start + entry.duration) return true
    return false
  }

  private poseOf(entry: Entry, now: number): Pose {
    const raw = entry.duration === 0 ? 1 : (now - entry.start) / entry.duration
    const p = Math.min(1, Math.max(0, raw))
    const t = easeInOutCubic(p)
    const position = lerp3(entry.fromPos, entry.toPos, t)
    if (!entry.dying) {
      const dist = Math.hypot(entry.toPos[0] - entry.fromPos[0], entry.toPos[2] - entry.fromPos[2])
      if (entry.hop && dist > 0.01) position[1] += 4 * p * (1 - p) * Math.min(MOTION.hopHeight, 0.3 + dist * 0.12)
    }
    return {
      id: entry.id,
      position,
      size: lerp3(entry.fromSize, entry.toSize, t),
      color: lerpHex(entry.fromColor, entry.toColor, t),
    }
  }
}
