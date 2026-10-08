/** True when the viewer asked the OS for less motion. Safe to call on the server (returns false). */
export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}
