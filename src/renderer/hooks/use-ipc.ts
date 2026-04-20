import { useState, useEffect, useCallback } from 'react'
import { api } from '../lib/ipc-client'
import { useScrapeSessionStore } from '../stores/scrape-session-store'

export function useAsyncData<T>(
  fetcher: () => Promise<T>,
  deps: unknown[] = []
) {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await fetcher()
      setData(result)
    } catch (err: any) {
      setError(err.message || 'Er is een fout opgetreden')
    } finally {
      setLoading(false)
    }
  }, deps)

  useEffect(() => {
    refresh()
  }, [refresh])

  return { data, loading, error, refresh, setData }
}

export function useTenders(filters?: Record<string, unknown>) {
  return useAsyncData(() => api.getTenders(filters), [JSON.stringify(filters)])
}

export function useTender(id: string) {
  return useAsyncData(() => api.getTender(id), [id])
}

export function useSources() {
  return useAsyncData(() => api.getSources(), [])
}

export function useCriteria() {
  return useAsyncData(() => api.getCriteria(), [])
}

export function useZoektermen() {
  return useAsyncData(() => api.getZoektermen(), [])
}

export function useAIVragen() {
  return useAsyncData(() => api.getAIVragen(), [])
}

export function useAIPrompts() {
  return useAsyncData(() => api.getAIPrompts(), [])
}

export function useSettings() {
  return useAsyncData(() => api.getAllSettings(), [])
}

export function useDashboardStats() {
  return useAsyncData(() => api.getTenderStats(), [])
}

export function useScrapeJobs() {
  const jobsRefreshToken = useScrapeSessionStore((s) => s.jobsRefreshToken)
  return useAsyncData(() => api.getScrapeJobs(), [jobsRefreshToken])
}

export function useSchedules() {
  return useAsyncData(() => api.getSchedules(), [])
}
