/**
 * Small data hooks shared by every page.
 *
 * `useApi` deliberately KEEPS the previous data while refetching (polling or
 * dependency change) so charts and lists never flash a skeleton — they hold
 * the old render until fresh data lands.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError } from './api'

export interface ApiState<T> {
  data: T | null
  error: ApiError | null
  /** True only until the FIRST response for the current dependency set. */
  loading: boolean
  /** True during any in-flight refetch (polling included). */
  refreshing: boolean
  reload: () => void
}

export function useApi<T>(
  fetcher: () => Promise<T>,
  deps: unknown[],
  opts: { pollMs?: number; enabled?: boolean } = {},
): ApiState<T> {
  const { pollMs, enabled = true } = opts
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [loading, setLoading] = useState(enabled)
  const [refreshing, setRefreshing] = useState(false)
  const [tick, setTick] = useState(0)
  // Monotonic id guards against out-of-order responses after rapid filter changes.
  const seq = useRef(0)
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher

  const reload = useCallback(() => setTick((t) => t + 1), [])

  useEffect(() => {
    if (!enabled) return
    let cancelled = false

    const run = async (initial: boolean) => {
      const id = ++seq.current
      if (initial) setLoading(true)
      setRefreshing(true)
      try {
        const result = await fetcherRef.current()
        if (cancelled || id !== seq.current) return
        setData(result)
        setError(null)
      } catch (err) {
        if (cancelled || id !== seq.current) return
        setError(err instanceof ApiError ? err : new ApiError(0, 'NETWORK', 'Could not reach the server'))
      } finally {
        if (!cancelled && id === seq.current) {
          setLoading(false)
          setRefreshing(false)
        }
      }
    }

    void run(data === null)

    let interval: number | undefined
    if (pollMs) {
      interval = window.setInterval(() => {
        // Don't waste cycles polling a hidden tab (kiosks stay visible).
        if (!document.hidden) void run(false)
      }, pollMs)
    }
    return () => {
      cancelled = true
      if (interval) window.clearInterval(interval)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, pollMs, tick, ...deps])

  return { data, error, loading, refreshing, reload }
}

/** Debounce a fast-changing value (search inputs). */
export function useDebounced<T>(value: T, ms = 250): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), ms)
    return () => window.clearTimeout(t)
  }, [value, ms])
  return debounced
}

/** A Date that re-renders every `ms` — powers the board clock. */
export function useNow(ms = 1000): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), ms)
    return () => window.clearInterval(t)
  }, [ms])
  return now
}
