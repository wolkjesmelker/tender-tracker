import { Routes, Route, Navigate } from 'react-router-dom'
import { AppSidebar } from './components/layout/app-sidebar'
import { Header } from './components/layout/header'
import { Footer } from './components/layout/footer'
import { DashboardPage } from './pages/DashboardPage'
import { TendersPage } from './pages/TendersPage'
import { TenderDetailPage } from './pages/TenderDetailPage'
import { ScrapingPage } from './pages/ScrapingPage'
import { SourcesPage } from './pages/SourcesPage'
import { CriteriaPage } from './pages/CriteriaPage'
import { AIQuestionsPage } from './pages/AIQuestionsPage'
import { SettingsPage } from './pages/SettingsPage'
import { AiDiagnosticsPage } from './pages/AiDiagnosticsPage'
import { TenderCalendarPage } from './pages/TenderCalendarPage'
import { PipelinePage } from './pages/PipelinePage'
import { SplashScreen } from './components/layout/splash-screen'
import { UpdateNotifier } from './components/layout/update-notifier'
import { LicenseBlockedScreen } from './components/license-blocked-screen'
import { DisclaimerModal, isDisclaimerAccepted } from './components/layout/DisclaimerModal'
import { api, isElectron } from './lib/ipc-client'
import { useScrapeSessionStore } from './stores/scrape-session-store'
import { useAnalysisActiveStore } from './stores/analysis-active-store'
import { useAiActivityPanelStore } from './stores/ai-activity-panel-store'
import { GlobalAiActivityOverlay } from './components/global-ai-activity-overlay'
import { DocumentFetchResumeBanner } from './components/document-fetch-resume-banner'
import { AgentPanel } from './components/agent/AgentPanel'
import { DocumentFillWizard } from './components/agent/DocumentFillWizard'
import { useState, useEffect } from 'react'
import type { LicenseStatus, ScrapeProgress } from '@shared/types'
import { Loader2 } from 'lucide-react'

/** Per appsessie: na Verder blijf je bij renderer-reload op de hoofd-UI; nieuwe sessie toont splash opnieuw. */
const SPLASH_COMPLETED_KEY = 'tendertracker_splash_completed_v1'

function readSplashDismissedFromStorage(): boolean {
  try {
    return sessionStorage.getItem(SPLASH_COMPLETED_KEY) === '1'
  } catch {
    return false
  }
}

export default function App() {
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [showSplash, setShowSplash] = useState(() => !readSplashDismissedFromStorage())
  const [showDisclaimer, setShowDisclaimer] = useState(() => {
    if (!readSplashDismissedFromStorage()) return false
    return !isDisclaimerAccepted()
  })
  const [license, setLicense] = useState<LicenseStatus | null>(null)

  const finishSplash = () => {
    try {
      sessionStorage.setItem(SPLASH_COMPLETED_KEY, '1')
    } catch {
      /* ignore */
    }
    setShowSplash(false)
    if (!isDisclaimerAccepted()) {
      setShowDisclaimer(true)
    }
  }

  useEffect(() => {
    if (!isElectron) {
      setLicense({ ok: true, skipped: true })
      return
    }
    void api.getLicenseStatus?.().then(setLicense)
  }, [])

  useEffect(() => {
    if (!isElectron) return
    const unsub = api.onScrapeProgress?.((data: unknown) => {
      useScrapeSessionStore.getState().mergeProgress(data as ScrapeProgress)
    })
    return () => {
      unsub?.()
    }
  }, [])

  // Globaal bijhouden welke tenders actief analyseren (groen) of risico-analyse hebben (rood)
  useEffect(() => {
    if (!isElectron) return
    const { setActive, clearActive } = useAnalysisActiveStore.getState()

    const unsubAnalysis = api.onAnalysisProgress?.((data: unknown) => {
      const d = data as {
        aanbestedingId?: string
        step?: string
        percentage?: number
        done?: boolean
        error?: string
        agent?: string
        batch?: boolean
      }
      if (!d.aanbestedingId) return
      useAiActivityPanelStore.getState().appendProgress(d)
      if (d.done || d.error || (d.percentage != null && d.percentage >= 100)) {
        clearActive(d.aanbestedingId)
      } else {
        const agentStr =
          typeof d.agent === 'string' && d.agent.trim() ? d.agent.trim() : undefined
        setActive(d.aanbestedingId, {
          type: 'analyse',
          step: d.step ?? '',
          percentage: d.percentage ?? 0,
          agent: agentStr,
        })
      }
    })

    const unsubRisico = api.onRisicoProgress?.((data: unknown) => {
      const d = data as {
        aanbestedingId?: string
        step?: string
        percentage?: number
        agent?: string
      }
      if (!d.aanbestedingId) return
      useAiActivityPanelStore.getState().appendProgress({
        aanbestedingId: d.aanbestedingId,
        step: d.step ?? '',
        percentage: d.percentage ?? 0,
        agent: d.agent,
      })
      if (d.percentage != null && d.percentage >= 100) {
        clearActive(d.aanbestedingId)
      } else {
        const agentStr =
          typeof d.agent === 'string' && d.agent.trim() ? d.agent.trim() : undefined
        setActive(d.aanbestedingId, {
          type: 'risico',
          step: d.step ?? '',
          percentage: d.percentage ?? 0,
          agent: agentStr,
        })
      }
    })

    void api.requestRisicoUiReplay?.()
    void api.requestAnalysisUiReplay?.()

    return () => {
      unsubAnalysis?.()
      unsubRisico?.()
    }
  }, [])

  const handleDisclaimerDecline = () => {
    if (isElectron) {
      try {
        ;(window as any).electronAPI?.quitApp?.()
      } catch { /* ignore */ }
    }
    window.close()
  }

  if (showSplash) {
    return <SplashScreen onContinue={finishSplash} />
  }

  if (showDisclaimer) {
    return (
      <DisclaimerModal
        onAccept={() => setShowDisclaimer(false)}
        onDecline={handleDisclaimerDecline}
      />
    )
  }

  if (license === null) {
    return (
      <div className="flex h-screen items-center justify-center bg-[var(--background)]">
        <Loader2 className="h-8 w-8 animate-spin text-[var(--primary)]" aria-hidden />
        <span className="sr-only">Licentie controleren…</span>
      </div>
    )
  }

  if (!license.ok) {
    return <LicenseBlockedScreen initial={license} />
  }

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--background)]">
      <AppSidebar open={sidebarOpen} onToggle={() => setSidebarOpen(!sidebarOpen)} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header onToggleSidebar={() => setSidebarOpen(!sidebarOpen)} />
        <DocumentFetchResumeBanner />
        <UpdateNotifier />
        <main className="flex-1 overflow-y-auto p-6">
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/aanbestedingen" element={<TendersPage />} />
            <Route path="/aanbestedingen/:id" element={<TenderDetailPage />} />
            <Route path="/aanbestedingskalender" element={<TenderCalendarPage />} />
            <Route path="/tracking" element={<ScrapingPage />} />
            <Route path="/scrapen" element={<Navigate to="/tracking" replace />} />
            <Route path="/bronnen" element={<SourcesPage />} />
            <Route path="/criteria" element={<CriteriaPage />} />
            <Route path="/ai-vragen" element={<AIQuestionsPage />} />
            <Route path="/pipeline" element={<PipelinePage />} />
            <Route path="/instellingen" element={<SettingsPage />} />
            <Route path="/ai-diagnose" element={<AiDiagnosticsPage />} />
          </Routes>
        </main>
        <Footer />
        <GlobalAiActivityOverlay />
        <AgentPanel />
        <DocumentFillWizard />
      </div>
    </div>
  )
}
