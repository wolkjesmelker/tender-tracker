import { create } from 'zustand'
import type { AiAnalysisActivityLine } from '../components/ai-analysis-activity-panel'
import { useAnalysisActiveStore } from './analysis-active-store'

interface AiActivityPanelState {
  panelOpen: boolean
  lines: AiAnalysisActivityLine[]
  /** Tender bij de huidige log; wordt gezet bij start of eerste progress-event */
  sessionTenderId: string | null
  setPanelOpen: (open: boolean) => void
  /** Nieuwe analyse: log vervangen, paneel open, optimistic actief in lijst */
  startActivitySession: (tenderId: string, initial: AiAnalysisActivityLine[]) => void
  appendProgress: (d: {
    aanbestedingId?: string
    step?: string
    percentage?: number
    agent?: string
    batch?: boolean
  }) => void
}

export const useAiActivityPanelStore = create<AiActivityPanelState>((set) => ({
  panelOpen: false,
  lines: [],
  sessionTenderId: null,

  setPanelOpen: (open) => set({ panelOpen: open }),

  startActivitySession: (tenderId, initial) => {
    useAnalysisActiveStore.getState().setActive(tenderId, {
      type: 'analyse',
      step: initial[0]?.step?.slice(0, 200) ?? 'Analyse…',
      percentage: initial[0]?.percentage ?? 0,
      agent: initial[0]?.agent,
    })
    set((s) => ({
      sessionTenderId: tenderId,
      lines: initial,
      // Paneel alleen openen als het al openstond; nooit automatisch openen bij start analyse
      panelOpen: s.panelOpen,
    }))
  },

  appendProgress: (d) => {
    if (d.batch || !d.aanbestedingId || typeof d.step !== 'string' || !d.step.trim()) return
    const stepTrim = d.step.trim()
    set((s) => {
      const sessionTenderId = s.sessionTenderId ?? d.aanbestedingId
      const prev = s.lines
      let pct =
        typeof d.percentage === 'number' && Number.isFinite(d.percentage)
          ? Math.round(Math.max(0, Math.min(100, d.percentage)))
          : (prev[prev.length - 1]?.percentage ?? 0)
      const agentStr =
        typeof d.agent === 'string' && d.agent.trim() ? d.agent.trim() : undefined
      const last = prev[prev.length - 1]
      if (
        last &&
        last.step === stepTrim &&
        last.percentage === pct &&
        last.agent === agentStr
      ) {
        return { sessionTenderId }
      }
      return {
        sessionTenderId,
        lines: [...prev.slice(-199), { step: stepTrim, percentage: pct, at: Date.now(), agent: agentStr }],
      }
    })
  },
}))
