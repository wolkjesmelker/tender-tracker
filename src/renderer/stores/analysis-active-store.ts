/**
 * Bijhoudt welke tender-IDs momenteel een actieve analyse hebben.
 * Wordt globaal gevuld via IPC-events in App.tsx zodat elke pagina
 * de status kan opvragen zonder opnieuw te subscriben.
 */
import { create } from 'zustand'

export type AnalysisType = 'analyse' | 'risico'

interface ActiveEntry {
  type: AnalysisType
  step: string
  percentage: number
  /** Label uit de pipeline (bijv. «App · bron & documenten» of LLM-model) */
  agent?: string
}

interface AnalysisActiveState {
  /** tenderId → actieve entry */
  active: Record<string, ActiveEntry>
  setActive: (tenderId: string, entry: ActiveEntry) => void
  clearActive: (tenderId: string) => void
  isAnalysing: (tenderId: string) => boolean
  isRisicoAnalysing: (tenderId: string) => boolean
}

export const useAnalysisActiveStore = create<AnalysisActiveState>((set, get) => ({
  active: {},

  setActive: (tenderId, entry) =>
    set((s) => ({ active: { ...s.active, [tenderId]: entry } })),

  clearActive: (tenderId) =>
    set((s) => {
      const next = { ...s.active }
      delete next[tenderId]
      return { active: next }
    }),

  isAnalysing: (tenderId) => !!get().active[tenderId],

  isRisicoAnalysing: (tenderId) => get().active[tenderId]?.type === 'risico',
}))
