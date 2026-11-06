// Loading and starting MapLibre (about 1 MB of JavaScript, then the WebGL context, shaders and style) is the
// heaviest work of the page; waiting until the shell's first frame is on screen keeps it from delaying that frame.
const MAX_WAIT_MS = 1500

let firstPaint: Promise<void> | undefined

/** Resolves once the first contentful paint has been presented, or after a short cap (hidden tabs never paint). */
export function afterFirstPaint(): Promise<void> {
  firstPaint ??= new Promise<void>((resolve) => {
    if (typeof PerformanceObserver === 'undefined' || !PerformanceObserver.supportedEntryTypes?.includes('paint')) return resolve()
    const observer = new PerformanceObserver((list) => {
      if (!list.getEntriesByName('first-contentful-paint').length) return
      done()
    })
    const timer = setTimeout(() => done(), MAX_WAIT_MS)
    const done = () => {
      clearTimeout(timer)
      observer.disconnect()
      resolve()
    }
    observer.observe({ type: 'paint', buffered: true })
  })
  return firstPaint
}
