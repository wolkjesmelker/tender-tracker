import { create } from 'zustand'
import type { ScrapeProgress } from '@shared/types'
import { api, isElectron } from '../lib/ipc-client'

interface ScrapeSessionState {
  progress: ScrapeProgress[]
  pipelineRunning: boolean
  jobsRefreshToken: number
  mergeProgress: (data: ScrapeProgress) => void
  clearProgress: () => void
  bumpJobsRefresh: () => void
  /** Start volledige tracking-run; loopt door na navigatie (niet gebonden aan React lifecycle). */
  runScrape: (options: { sourceIds?: string[]; zoektermen?: string[] }) => Promise<void>
}

export const useScrapeSessionStore = create<ScrapeSessionState>((set, get) => ({
  progress: [],
  pipelineRunning: false,
  jobsRefreshToken: 0,

  mergeProgress: (data) =>
    set((state) => {
      const existing = state.progress.findIndex((p) => p.jobId === data.jobId)
      if (existing >= 0) {
        const next = [...state.progress]
        next[existing] = data
        return { progress: next }
      }
      return { progress: [...state.progress, data] }
    }),

  clearProgress: () => set({ progress: [] }),

  bumpJobsRefresh: () => set((s) => ({ jobsRefreshToken: s.jobsRefreshToken + 1 })),

  runScrape: async (options) => {
    if (!isElectron) {
      get().mergeProgress({
        jobId: 'browser-mode',
        status: 'fout',
        message: 'Tracking is alleen mogelijk in de Electron-app.',
        found: 0,
      })
      return
    }
    if (get().pipelineRunning) return

    set({ pipelineRunning: true, progress: [] })
    try {
      const result = (await api.startScraping(options as Record<string, unknown>)) as {
        success?: boolean
        error?: string
        results?: { totalFound?: number }
      } | null

      if (result && !result.success) {
        get().mergeProgress({
          jobId: 'error',
          status: 'fout',
          message: `Fout: ${result.error || 'Onbekende fout'}`,
          found: 0,
        })
      } else if (result?.success) {
        get().mergeProgress({
          jobId: 'done',
          status: 'gereed',
          message: `Tracking voltooid: ${result.results?.totalFound ?? 0} nieuwe aanbestedingen gevonden`,
          found: result.results?.totalFound ?? 0,
        })
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Onbekende fout'
      get().mergeProgress({
        jobId: 'error',
        status: 'fout',
        message: `Fout: ${msg}`,
        found: 0,
      })
    } finally {
      set({ pipelineRunning: false })
      get().bumpJobsRefresh()
    }
  },
}))
