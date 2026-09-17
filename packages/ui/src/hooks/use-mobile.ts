import * as React from "react"

const MOBILE_BREAKPOINT = 768

/*
 * Diverges from the generated hook (ADR-0031: owned source). Upstream seeds the
 * state from inside an effect, which `react-hooks/set-state-in-effect` rejects
 * — a cascading render on every mount. `useSyncExternalStore` is the primitive
 * for exactly this shape: subscribe to the media query, read the answer
 * synchronously, and hand a server snapshot to any consumer that renders
 * outside a browser (the marketing site D16 will add).
 */
export function useIsMobile() {
  const subscribe = React.useCallback((onStoreChange: () => void) => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    mql.addEventListener("change", onStoreChange)
    return () => {
      mql.removeEventListener("change", onStoreChange)
    }
  }, [])

  return React.useSyncExternalStore(
    subscribe,
    () => window.innerWidth < MOBILE_BREAKPOINT,
    () => false
  )
}
