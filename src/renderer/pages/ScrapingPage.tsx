import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useScrapeJobs } from '../hooks/use-ipc'
import { api, isElectron } from '../lib/ipc-client'
import { useScrapeSessionStore } from '../stores/scrape-session-store'
import { formatDateTimeNlFromSqliteUtc } from '@shared/date-format'
import { APP_SETTING_POST_SCRAPE_ANALYZE_IMMEDIATELY } from '@shared/constants'
import {
  Play, Loader2, CheckCircle2, XCircle, Clock,
  LogIn, Globe, Shield, ShieldCheck, RefreshCw, AlertCircle, Trash2, FolderSync, StopCircle,
} from 'lucide-react'
import { AppConfirmDialog } from '../components/app-confirm-dialog'

type ScrapingConfirm = null | 'resume-docs' | 'delete-jobs' | 'delete-all-history'

export function ScrapingPage() {
  const { data: jobs, refresh: refreshJobs } = useScrapeJobs()
  const [authStatuses, setAuthStatuses] = useState<any[]>([])
  const [showAllJobs, setShowAllJobs] = useState(false)
  const scraping = useScrapeSessionStore((s) => s.pipelineRunning)
  const progress = useScrapeSessionStore((s) => s.progress)
  const runScrape = useScrapeSessionStore((s) => s.runScrape)
  const bumpJobsRefresh = useScrapeSessionStore((s) => s.bumpJobsRefresh)
  const jobsRefreshToken = useScrapeSessionStore((s) => s.jobsRefreshToken)

  const [selectedJobIds, setSelectedJobIds] = useState<string[]>([])
  const [historyError, setHistoryError] = useState<string | null>(null)
  const masterCheckboxRef = useRef<HTMLInputElement>(null)
  const [pendingDocFetch, setPendingDocFetch] = useState<{
    count: number
    items: { id: string; titel: string }[]
  }>({ count: 0, items: [] })
  const [resumeDocsBusy, setResumeDocsBusy] = useState(false)
  const [resumeDocsError, setResumeDocsError] = useState<string | null>(null)
  const [scrapingConfirm, setScrapingConfirm] = useState<ScrapingConfirm>(null)
  const [deleteJobsBusy, setDeleteJobsBusy] = useState(false)
  const [deleteAllHistoryBusy, setDeleteAllHistoryBusy] = useState(false)
  const [postScrapeAnalyzeImmediate, setPostScrapeAnalyzeImmediate] = useState(true)
  const [postScrapeSettingLoaded, setPostScrapeSettingLoaded] = useState(false)
  const docResumeStatusRef = useRef<string | undefined>(undefined)

  const loadPendingDocFetch = useCallback(async () => {
    if (!isElectron) return
    try {
      const r = (await api.getPendingDocumentFetch()) as {
        count?: number
        items?: { id: string; titel: string }[]
      }
      setPendingDocFetch({ count: r?.count ?? 0, items: r?.items ?? [] })
    } catch {
      setPendingDocFetch({ count: 0, items: [] })
    }
  }, [])

  useEffect(() => {
    void loadPendingDocFetch()
  }, [loadPendingDocFetch, jobsRefreshToken])

  const docFetchResumeProgress = progress.find((p) => p.jobId === 'doc-fetch-resume')
  const docFetchResumeRunning = docFetchResumeProgress?.status === 'bezig'

  useEffect(() => {
    const p = progress.find((x) => x.jobId === 'doc-fetch-resume')
    const st = p?.status
    const prev = docResumeStatusRef.current
    docResumeStatusRef.current = st
    if (!p || st == null) return
    if ((st === 'gereed' || st === 'fout') && prev === 'bezig') {
      void loadPendingDocFetch()
      bumpJobsRefresh()
    }
  }, [progress, loadPendingDocFetch, bumpJobsRefresh])

  useEffect(() => {
    api.getAuthStatus().then((s: any) => s && setAuthStatuses(s))
  }, [])

  useEffect(() => {
    if (!isElectron) {
      setPostScrapeSettingLoaded(true)
      return
    }
    void (async () => {
      try {
        const all = (await api.getAllSettings()) as Record<string, string> | null
        const v = all?.[APP_SETTING_POST_SCRAPE_ANALYZE_IMMEDIATELY]
        if (v === undefined) setPostScrapeAnalyzeImmediate(true)
        else {
          const low = String(v).trim().toLowerCase()
          setPostScrapeAnalyzeImmediate(
            low === '1' || low === 'true' || low === 'yes' || low === 'on',
          )
        }
      } catch {
        setPostScrapeAnalyzeImmediate(true)
      } finally {
        setPostScrapeSettingLoaded(true)
      }
    })()
  }, [])

  const [loginError, setLoginError] = useState<string | null>(null)

  const handleLogin = async (siteId: string) => {
    setLoginError(null)
    try {
      const result = await api.openLogin(siteId) as { success: boolean; error?: string } | null
      if (result && !result.success && result.error) {
        setLoginError(result.error)
      }
    } catch (e) {
      setLoginError(e instanceof Error ? e.message : 'Kan inlogvenster niet openen')
    }
  }

  const handleOpenExternal = async (siteId: string) => {
    try {
      await (api as any).openExternalLogin(siteId)
    } catch { /* noop */ }
  }

  const handleLogout = async (siteId: string) => {
    try {
      await api.logout(siteId)
      setAuthStatuses(prev =>
        prev.map(s => s.siteId === siteId ? { ...s, isAuthenticated: false } : s)
      )
    } catch { /* noop */ }
  }

  useEffect(() => {
    const unsub = api.onLoginComplete?.((data: any) => {
      setAuthStatuses(prev =>
        prev.map(s => s.siteId === data.siteId ? { ...s, isAuthenticated: data.success } : s)
      )
    })
    return () => { unsub?.() }
  }, [])

  const handleStartScrape = () => {
    void runScrape({})
  }

  const setPostScrapeImmediateSetting = useCallback(async (checked: boolean) => {
    if (!isElectron) {
      setPostScrapeAnalyzeImmediate(checked)
      return
    }
    setPostScrapeAnalyzeImmediate(checked)
    try {
      await api.setSetting(APP_SETTING_POST_SCRAPE_ANALYZE_IMMEDIATELY, checked ? '1' : '0')
    } catch {
      setPostScrapeAnalyzeImmediate((prev) => !prev)
    }
  }, [])

  const allJobs = useMemo(() => ((jobs as { id: string }[]) || []).filter(j => j?.id), [jobs])

  useEffect(() => {
    setSelectedJobIds((prev) => prev.filter((id) => allJobs.some((j) => j.id === id)))
  }, [allJobs])

  const allJobsSelected =
    allJobs.length > 0 && allJobs.every((j) => selectedJobIds.includes(j.id))
  const someJobsSelected =
    selectedJobIds.length > 0 && !allJobsSelected

  useEffect(() => {
    const el = masterCheckboxRef.current
    if (el) el.indeterminate = someJobsSelected
  }, [someJobsSelected, allJobsSelected])

  const toggleJobSelected = (id: string) => {
    setSelectedJobIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    )
  }

  const selectAllJobs = () => setSelectedJobIds(allJobs.map((j) => j.id))
  const clearJobSelection = () => setSelectedJobIds([])

  const executeDeleteSelectedJobs = async () => {
    if (selectedJobIds.length === 0) return
    setHistoryError(null)
    setDeleteJobsBusy(true)
    try {
      const res = (await api.deleteScrapeJobs({ ids: selectedJobIds })) as {
        success?: boolean
        error?: string
        deleted?: number
      }
      if (!res?.success) {
        setHistoryError(res?.error || 'Verwijderen mislukt')
        return
      }
      clearJobSelection()
      bumpJobsRefresh()
      await refreshJobs()
    } catch (e) {
      setHistoryError(e instanceof Error ? e.message : 'Verwijderen mislukt')
    } finally {
      setDeleteJobsBusy(false)
      setScrapingConfirm(null)
    }
  }

  const executeResumeDocumentFetch = async () => {
    if (!isElectron || pendingDocFetch.count === 0 || scraping || docFetchResumeRunning) return
    setResumeDocsError(null)
    setResumeDocsBusy(true)
    try {
      const res = (await api.resumePendingDocumentFetch()) as {
        success?: boolean
        error?: string
        started?: boolean
      }
      if (!res?.success) {
        setResumeDocsError(res?.error || 'Hervatten mislukt')
        return
      }
      setScrapingConfirm(null)
    } catch (e) {
      setResumeDocsError(e instanceof Error ? e.message : 'Hervatten mislukt')
    } finally {
      setResumeDocsBusy(false)
    }
  }

  const executeStopDocumentFetch = async () => {
    if (!isElectron || !docFetchResumeRunning) return
    setResumeDocsError(null)
    try {
      const res = (await api.stopPendingDocumentFetch()) as { success?: boolean; error?: string }
      if (!res?.success) {
        setResumeDocsError(res?.error || 'Stoppen mislukt')
      }
    } catch (e) {
      setResumeDocsError(e instanceof Error ? e.message : 'Stoppen mislukt')
    }
  }

  const executeDeleteAllScrapeHistory = async () => {
    if (allJobs.length === 0) return
    setHistoryError(null)
    setDeleteAllHistoryBusy(true)
    try {
      const res = (await api.deleteScrapeJobs({ all: true })) as {
        success?: boolean
        error?: string
        deleted?: number
      }
      if (!res?.success) {
        setHistoryError(res?.error || 'Verwijderen mislukt')
        return
      }
      clearJobSelection()
      bumpJobsRefresh()
      await refreshJobs()
    } catch (e) {
      setHistoryError(e instanceof Error ? e.message : 'Verwijderen mislukt')
    } finally {
      setDeleteAllHistoryBusy(false)
      setScrapingConfirm(null)
    }
  }

  const pendingCount = pendingDocFetch.count

  return (
    <div className="space-y-6">
      <AppConfirmDialog
        open={scrapingConfirm === 'resume-docs'}
        title="Documentophalen hervatten?"
        variant="accent"
        confirmLabel="Hervatten"
        cancelLabel="Annuleren"
        loading={resumeDocsBusy}
        onCancel={() => !resumeDocsBusy && setScrapingConfirm(null)}
        onConfirm={() => void executeResumeDocumentFetch()}
        description={
          <>
            <p>
              Er {pendingCount === 1 ? 'staat nog 1 aanbesteding' : `staan nog ${pendingCount} aanbestedingen`} waarbij
              het ophalen van documenten na de tracking niet is afgerond (bijvoorbeeld na een onderbreking).
            </p>
            <p>
              De app gaat verder waar het gebleven was: geen nieuwe tracking, bestaande downloads en tussenopslagen
              blijven behouden.
            </p>
            <p>
              Na «Hervatten» sluit dit venster direct; het ophalen loopt verder op de achtergrond. Je ziet de voortgang
              onder «Voortgang» en kunt het proces daar of bij de oranje kaart stoppen.
            </p>
          </>
        }
      />
      <AppConfirmDialog
        open={scrapingConfirm === 'delete-jobs'}
        title="Tracking-jobs verwijderen?"
        variant="danger"
        confirmLabel="Verwijderen"
        loading={deleteJobsBusy}
        onCancel={() => !deleteJobsBusy && setScrapingConfirm(null)}
        onConfirm={() => void executeDeleteSelectedJobs()}
        description={
          <>
            <p>
              Weet je zeker dat je {selectedJobIds.length} tracking-job{selectedJobIds.length === 1 ? '' : 's'} wilt
              verwijderen uit de geschiedenis?
            </p>
            <p>
              Dit verwijdert alleen de logregels; opgeslagen aanbestedingen blijven bestaan. Dit kan niet ongedaan
              worden gemaakt.
            </p>
          </>
        }
      />
      <AppConfirmDialog
        open={scrapingConfirm === 'delete-all-history'}
        title="Hele trackinggeschiedenis wissen?"
        variant="danger"
        confirmLabel="Alles wissen"
        loading={deleteAllHistoryBusy}
        onCancel={() => !deleteAllHistoryBusy && setScrapingConfirm(null)}
        onConfirm={() => void executeDeleteAllScrapeHistory()}
        description={
          <>
            <p>Alle tracking-jobs in de database worden verwijderd (mogelijk meer dan de rijen die hier worden getoond).</p>
            <p>Opgeslagen aanbestedingen blijven bestaan. Dit kan niet ongedaan worden gemaakt.</p>
          </>
        }
      />

      {/* Auth Status */}
      {authStatuses.length > 0 && (
        <div className="rounded-xl border bg-[var(--card)] p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-[var(--foreground)] mb-3 flex items-center gap-2">
            <Shield className="h-4 w-4" /> Inlogstatus websites
          </h3>
          <p className="text-xs text-[var(--muted-foreground)] mb-4">
            Hier zie je per bron of er een app-sessie is. Voor bronnen met inlog: log hier in vóór je start, of voltooi de
            vensters die na «Start tracking» verschijnen (zelfde werkwijze als geplande tracking). Uitloggen wist de
            sessie voor die site.
          </p>
          {loginError && (
            <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-200 dark:border-red-700/50 bg-red-50 dark:bg-red-950/30 px-4 py-2.5 text-sm text-red-700 dark:text-red-300">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {loginError}
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {authStatuses.map((status: any) => (
              <div
                key={status.siteId}
                className={`flex items-center justify-between rounded-lg border p-3 ${
                  status.isAuthenticated
                    ? 'border-green-200 dark:border-green-700/50 bg-green-50 dark:bg-green-950/25'
                    : 'border-orange-200 dark:border-orange-700/50 bg-orange-50 dark:bg-orange-950/25'
                }`}
              >
                <div className="flex items-center gap-2">
                  {status.isAuthenticated ? (
                    <ShieldCheck className="h-5 w-5 text-green-600 dark:text-green-400" />
                  ) : (
                    <Shield className="h-5 w-5 text-orange-500 dark:text-orange-400" />
                  )}
                  <div>
                    <p className="text-sm font-medium">{status.siteName}</p>
                    <p className="text-[10px] text-[var(--muted-foreground)]">
                      {status.isAuthenticated ? 'Ingelogd' : 'Niet ingelogd'}
                    </p>
                  </div>
                </div>
                <div className="flex flex-col gap-1">
                  {status.isAuthenticated ? (
                    <button
                      onClick={() => handleLogout(status.siteId)}
                      className="flex items-center gap-1 rounded-lg border border-red-200 dark:border-red-700/50 px-3 py-1.5 text-xs text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                      title="Uitloggen en sessie wissen"
                    >
                      <LogIn className="h-3.5 w-3.5 rotate-180" /> Uitloggen
                    </button>
                  ) : (
                    <>
                      <button
                        onClick={() => handleLogin(status.siteId)}
                        className="flex items-center gap-1 rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-medium text-[var(--primary-foreground)] hover:opacity-90 transition-opacity"
                        title="Open inlogvenster in de app (cookies worden gedeeld met de tracker)"
                      >
                        <LogIn className="h-3.5 w-3.5" /> Inloggen
                      </button>
                      <button
                        onClick={() => handleOpenExternal(status.siteId)}
                        className="flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs text-[var(--muted-foreground)] hover:bg-[var(--muted)] transition-colors"
                        title="Opent de website in je standaardbrowser (Chrome/Safari). Let op: cookies worden niet gedeeld met de tracker."
                      >
                        <Globe className="h-3 w-3" /> Extern
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tracking launcher */}
      <div className="rounded-xl border bg-[var(--card)] p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-[var(--foreground)] mb-2 flex items-center gap-2">
          <Play className="h-4 w-4" /> Handmatige tracking
        </h3>
        <p className="text-xs text-[var(--muted-foreground)] mb-4 leading-relaxed">
          Eerst worden — zoals bij geplande tracking — achtereenvolgens inlogvensters geopend voor bronnen die inloggen
          nodig hebben. Daarna worden <strong className="text-[var(--foreground)] font-medium">alle actieve bronnen</strong>{' '}
          gescraped (dezelfde set als in je bronnenlijst; zie boven «Inlogstatus websites» voor je sessies). Resultaten
          worden gefilterd op je actieve zoektermen en het Van de Kreeke-profiel (GWW/civiel).
        </p>

        <button
          onClick={handleStartScrape}
          disabled={scraping}
          className="flex items-center gap-2 rounded-lg bg-[var(--primary)] px-5 py-2.5 text-sm font-medium text-[var(--primary-foreground)] hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {scraping ? (
            <><Loader2 className="h-4 w-4 animate-spin" /> Tracking bezig...</>
          ) : (
            <><Play className="h-4 w-4" /> Start tracking</>
          )}
        </button>
        <p className="mt-3 text-[10px] text-[var(--muted-foreground)]">
          Je mag naar een andere pagina gaan: tracking draait door op de achtergrond. Voortgang en resultaten zie je hier weer zodra je terugkomt.
        </p>
      </div>

      {/* Hervat documentophalen (na onderbroken post-tracking) */}
      {isElectron && pendingDocFetch.count > 0 && (
        <div className="doc-resume-banner-copy rounded-xl border border-amber-200 dark:border-amber-700/50 bg-amber-50 dark:bg-amber-950/25 p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-100 dark:bg-amber-900/40 text-zinc-900 dark:text-amber-300">
                <FolderSync className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-sm font-semibold">Documentophalen afmaken</h3>
                <p className="mt-1 text-xs leading-relaxed max-w-xl">
                  Na de tracking worden documenten per aanbesteding opgehaald. Daarvoor{' '}
                  <strong>{pendingDocFetch.count}</strong> {pendingDocFetch.count === 1 ? 'tender is' : 'tenders zijn'}{' '}
                  nog niet volledig afgerond. Je kunt dit hervatten zonder nieuwe tracking; reeds opgeslagen
                  bestanden en tussenresultaten blijven behouden.
                </p>
                {pendingDocFetch.items.length > 0 && pendingDocFetch.items.length <= 5 && (
                  <ul className="mt-2 text-[11px] list-disc pl-4 space-y-0.5">
                    {pendingDocFetch.items.slice(0, 5).map((t) => (
                      <li key={t.id} className="truncate">{t.titel || t.id}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              {docFetchResumeRunning && (
                <button
                  type="button"
                  onClick={() => void executeStopDocumentFetch()}
                  className="inline-flex items-center gap-2 rounded-lg border border-red-200 dark:border-red-700/50 bg-red-50 dark:bg-red-950/30 px-4 py-2 text-sm font-medium text-red-800 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-950/50 transition-colors"
                >
                  <StopCircle className="h-4 w-4" /> Stop documentophalen
                </button>
              )}
              <button
                type="button"
                onClick={() => setScrapingConfirm('resume-docs')}
                disabled={scraping || resumeDocsBusy || docFetchResumeRunning}
                className="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50 disabled:pointer-events-none transition-colors"
              >
                {resumeDocsBusy ? (
                  <><Loader2 className="h-4 w-4 animate-spin" /> Starten…</>
                ) : (
                  <><FolderSync className="h-4 w-4" /> Hervat documentophalen</>
                )}
              </button>
            </div>
          </div>
          {resumeDocsError && (
            <p className="mt-3 text-xs text-red-700 dark:text-red-400 flex items-center gap-1.5">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              {resumeDocsError}
            </p>
          )}
        </div>
      )}

      {/* Progress */}
      {progress.length > 0 && (
        <div className="rounded-xl border bg-[var(--card)] p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-[var(--foreground)] mb-3">Voortgang</h3>
          <div className="space-y-2">
            {progress.map((p) => (
              <div key={p.jobId} className="flex items-center gap-3 rounded-lg bg-[var(--muted)]/50 p-3">
                {p.status === 'bezig' && <Loader2 className="h-4 w-4 animate-spin text-blue-500" />}
                {p.status === 'gereed' && <CheckCircle2 className="h-4 w-4 text-green-500" />}
                {p.status === 'fout' && <XCircle className="h-4 w-4 text-red-500" />}
                <span className="text-sm flex-1">{p.message}</span>
                {p.found > 0 && <span className="text-xs font-medium text-green-600">{p.found} gevonden</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Job history */}
      {(() => {
        const visibleJobs = showAllJobs ? allJobs.slice(0, 20) : allJobs.slice(0, 3)
        const hiddenCount = Math.max(0, Math.min(allJobs.length, 20) - 3)
        return (
          <div className="rounded-xl border bg-[var(--card)] shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4">
              <h3 className="text-sm font-semibold">Trackinggeschiedenis</h3>
              <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
                {isElectron && postScrapeSettingLoaded && (
                  <label
                    className="inline-flex max-w-full cursor-pointer items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--muted)]/30 px-3 py-1.5 text-xs text-[var(--foreground)]"
                    title="Met werkgebied actief op de kaart (straal + vestiging): alleen aanbestedingen binnen die cirkel gaan automatisch in de AI-wachtrij. Buiten het gebied: start analyse handmatig op de detailpagina."
                  >
                    <input
                      type="checkbox"
                      className="rounded"
                      checked={postScrapeAnalyzeImmediate}
                      onChange={(e) => void setPostScrapeImmediateSetting(e.target.checked)}
                    />
                    <span className="select-none">Verwerk meteen analyse</span>
                  </label>
                )}
                {allJobs.length > 0 && (
                  <>
                    <button
                      type="button"
                      onClick={() => setScrapingConfirm('delete-jobs')}
                      disabled={selectedJobIds.length === 0}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 dark:border-red-700/50 bg-red-50 dark:bg-red-950/30 px-3 py-1.5 text-xs font-medium text-[var(--foreground)] dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-950/50 disabled:pointer-events-none disabled:opacity-40 transition-colors"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Verwijder geselecteerde ({selectedJobIds.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setScrapingConfirm('delete-all-history')}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
                    >
                      <Trash2 className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />
                      Wis hele geschiedenis
                    </button>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => void refreshJobs()}
                  className="rounded p-1 hover:bg-[var(--muted)] transition-colors"
                  title="Vernieuwen"
                >
                  <RefreshCw className="h-4 w-4 text-[var(--muted-foreground)]" />
                </button>
              </div>
            </div>
            {historyError && (
              <div className="flex items-center gap-2 border-b border-red-100 dark:border-red-800/40 bg-red-50/80 dark:bg-red-950/30 px-5 py-2 text-sm text-red-800 dark:text-red-300">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {historyError}
              </div>
            )}
            {allJobs.length > 0 && (
              <div className="flex flex-wrap items-center gap-3 border-b px-5 py-2.5 text-xs text-[var(--muted-foreground)]">
                <label className="inline-flex cursor-pointer items-center gap-2">
                  <input
                    ref={masterCheckboxRef}
                    type="checkbox"
                    checked={allJobsSelected}
                    onChange={() => (allJobsSelected ? clearJobSelection() : selectAllJobs())}
                    className="rounded"
                  />
                  <span>Selecteer alle {allJobs.length} in lijst</span>
                </label>
                {selectedJobIds.length > 0 && (
                  <button type="button" onClick={clearJobSelection} className="text-[var(--primary)] hover:underline">
                    Selectie wissen
                  </button>
                )}
              </div>
            )}
            <div className="divide-y">
              {allJobs.length === 0 ? (
                <p className="px-5 py-8 text-center text-sm text-[var(--muted-foreground)]">Nog geen tracking-jobs uitgevoerd</p>
              ) : (
                visibleJobs.map((job: any) => (
                  <div key={job.id} className="flex items-center gap-3 px-5 py-3">
                    <input
                      type="checkbox"
                      checked={selectedJobIds.includes(job.id)}
                      onChange={() => toggleJobSelected(job.id)}
                      className="rounded shrink-0"
                      aria-label={`Selecteer tracking ${job.bron_naam}`}
                    />
                    {job.status === 'bezig' && <Loader2 className="h-4 w-4 animate-spin text-blue-500 shrink-0" />}
                    {job.status === 'wachtend' && <Clock className="h-4 w-4 text-gray-400 shrink-0" />}
                    {job.status === 'gereed' && <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />}
                    {job.status === 'fout' && <XCircle className="h-4 w-4 text-red-500 shrink-0" />}
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-baseline gap-2">
                        <p className="text-sm font-medium truncate">{job.bron_naam}</p>
                        <span className="shrink-0 text-[10px] font-medium text-[var(--muted-foreground)] rounded bg-[var(--muted)] px-1.5 py-0.5">
                          {job.triggered_by === 'scheduled' ? 'Gepland' : 'Handmatig'}
                        </span>
                      </div>
                      <p className="text-[10px] text-[var(--muted-foreground)] mt-0.5">
                        <span>
                          Gestart:{' '}
                          {formatDateTimeNlFromSqliteUtc(job.started_at || job.created_at)}
                        </span>
                        <span className="mx-1">·</span>
                        <span>
                          {job.status === 'bezig'
                            ? 'Beëindigd: — (bezig)'
                            : `Beëindigd: ${formatDateTimeNlFromSqliteUtc(job.completed_at)}`}
                        </span>
                      </p>
                      {job.zoekterm && (
                        <p className="text-[10px] text-[var(--muted-foreground)] mt-0.5">Zoekterm: &quot;{job.zoekterm}&quot;</p>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-medium tabular-nums">{job.aantal_gevonden ?? 0}</p>
                      <p className="text-[10px] text-[var(--muted-foreground)]">nieuwe</p>
                    </div>
                  </div>
                ))
              )}
            </div>
            {hiddenCount > 0 && (
              <button
                type="button"
                onClick={() => setShowAllJobs((v) => !v)}
                className="w-full px-5 py-3 text-xs text-[var(--muted-foreground)] hover:bg-[var(--muted)]/50 transition-colors border-t text-center"
              >
                {showAllJobs ? 'Minder tonen ↑' : `${hiddenCount} oudere tracking-runs tonen ↓`}
              </button>
            )}
          </div>
        )
      })()}
    </div>
  )
}
