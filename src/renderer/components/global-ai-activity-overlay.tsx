import { Terminal } from 'lucide-react'
import { AiAnalysisActivityPanel } from './ai-analysis-activity-panel'
import { useAiActivityPanelStore } from '../stores/ai-activity-panel-store'
import { useAnalysisActiveStore } from '../stores/analysis-active-store'

/** AI-activiteitpaneel + heropen-knop: buiten route-mount zodat navigatie het niet weghaalt */
export function GlobalAiActivityOverlay() {
  const panelOpen = useAiActivityPanelStore((s) => s.panelOpen)
  const setPanelOpen = useAiActivityPanelStore((s) => s.setPanelOpen)
  const lines = useAiActivityPanelStore((s) => s.lines)
  const activeMap = useAnalysisActiveStore((s) => s.active)
  const aiActivityRunning = Object.keys(activeMap).length > 0

  return (
    <>
      <AiAnalysisActivityPanel
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        lines={lines}
        active={aiActivityRunning}
      />
      {aiActivityRunning && !panelOpen && (
        <button
          type="button"
          onClick={() => setPanelOpen(true)}
          title="AI-activiteit tonen"
          aria-label="AI-activiteit tonen"
          className="fixed bottom-5 left-5 z-[99] flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm font-medium text-[var(--foreground)] shadow-lg hover:bg-[var(--muted)] transition-colors"
        >
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
          </span>
          <Terminal className="h-4 w-4 shrink-0" aria-hidden />
          AI activiteit
        </button>
      )}
    </>
  )
}
