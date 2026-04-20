import type { ElectronAPI } from '../../main/preload'

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}

export const isElectron = typeof window !== 'undefined' && !!window.electronAPI

// Map van preload-methode-naam → IPC kanaal
const METHOD_TO_CHANNEL: Record<string, string> = {
  getTenders: 'tenders:list',
  getTender: 'tenders:get',
  updateTender: 'tenders:update',
  deleteTender: 'tenders:delete',
  deleteTenders: 'tenders:delete-many',
  getTenderStats: 'tenders:stats',
  discoverTenderDocuments: 'tenders:discover-documents',
  normalizeTenderOnOpen: 'tenders:normalize-on-open',
  readLocalTenderDocument: 'tenders:local-doc-read',
  saveLocalTenderDocumentAs: 'tenders:local-doc-save-as',
  openLocalTenderDocumentExternal: 'tenders:local-doc-open-external',
  previewBronDocument: 'tenders:bron-doc-preview',
  saveBronDocumentAs: 'tenders:bron-doc-save-as',
  openBronDocumentExternal: 'tenders:bron-doc-open-external',
  getBronEmbedPartition: 'tenders:bron-embed-partition',
  getSources: 'sources:list',
  getSource: 'sources:get',
  createSource: 'sources:create',
  updateSource: 'sources:update',
  deleteSource: 'sources:delete',
  getCriteria: 'criteria:list',
  createCriterium: 'criteria:create',
  updateCriterium: 'criteria:update',
  deleteCriterium: 'criteria:delete',
  getZoektermen: 'zoektermen:list',
  createZoekterm: 'zoektermen:create',
  updateZoekterm: 'zoektermen:update',
  deleteZoekterm: 'zoektermen:delete',
  getAIVragen: 'ai-vragen:list',
  createAIVraag: 'ai-vragen:create',
  updateAIVraag: 'ai-vragen:update',
  deleteAIVraag: 'ai-vragen:delete',
  getAIPrompts: 'ai-prompts:list',
  getAIPrompt: 'ai-prompts:get',
  createAIPrompt: 'ai-prompts:create',
  updateAIPrompt: 'ai-prompts:update',
  deleteAIPrompt: 'ai-prompts:delete',
  startScraping: 'scraping:start',
  stopScraping: 'scraping:stop',
  getScrapeJobs: 'scraping:jobs',
  deleteScrapeJobs: 'scraping:delete-jobs',
  getPendingDocumentFetch: 'scraping:pending-document-fetch',
  resumePendingDocumentFetch: 'scraping:resume-document-fetch',
  stopPendingDocumentFetch: 'scraping:stop-document-fetch',
  getAuthStatus: 'auth:status',
  openLogin: 'auth:open-login',
  openExternal: 'auth:open-external',
  openExternalLogin: 'auth:open-external',
  logout: 'auth:logout',
  startAnalysis: 'analysis:start',
  resumeAnalysis: 'analysis:resume',
  pauseAnalysis: 'analysis:pause',
  stopAnalysis: 'analysis:stop',
  getAnalysisCheckpoint: 'analysis:checkpoint-get',
  startBatchAnalysis: 'analysis:batch-start',
  startBatchAnalysisAll: 'analysis:batch-all-start',
  getBatchStatus: 'analysis:batch-status',
  requestAnalysisUiReplay: 'analysis:ui-replay',
  exportData: 'export:generate',
  selectCloudSyncFolder: 'backup:select-cloud-folder',
  getCloudSyncManifest: 'backup:get-manifest',
  runCloudMirrorSync: 'backup:run-mirror-sync',
  startRisicoAnalyse: 'risico:start',
  requestRisicoUiReplay: 'risico:ui-replay',
  getTokenStats: 'tokens:get-stats',
  resetTokenStats: 'tokens:reset',
  getAiDiagnosticsSnapshot: 'diagnostics:ai-snapshot',
  getSetting: 'settings:get',
  setSetting: 'settings:set',
  getAllSettings: 'settings:get-all',
  getSchedules: 'scheduler:list',
  createSchedule: 'scheduler:create',
  updateSchedule: 'scheduler:update',
  deleteSchedule: 'scheduler:delete',
  toggleSchedule: 'scheduler:toggle',
  agentSendMessage: 'agent:send-message',
  agentGetHistory: 'agent:get-history',
  agentClearHistory: 'agent:clear-history',
  agentStartFill: 'agent:start-fill',
  agentGetFillState: 'agent:get-fill-state',
  agentGetFillSummary: 'agent:get-fill-summary',
  agentSaveFillField: 'agent:save-fill-field',
  agentLearnCorrection: 'agent:learn-correction',
  agentWebSearch: 'agent:web-search',
  agentPinSearchResult: 'agent:pin-search-result',
  agentExportFill: 'agent:export-fill',
  agentExportFilledDocument: 'agent:export-filled-document',
  getAppVersion: 'app:version',
  getBedrijfsprofielen: 'bedrijfsprofielen:list',
  getBedrijfsprofiel: 'bedrijfsprofielen:get',
  createBedrijfsprofiel: 'bedrijfsprofielen:create',
  updateBedrijfsprofiel: 'bedrijfsprofielen:update',
  deleteBedrijfsprofiel: 'bedrijfsprofielen:delete',
  setBedrijfsprofielStandaard: 'bedrijfsprofielen:set-standaard',
  getLicenseStatus: 'license:status',
  refreshLicense: 'license:refresh',
  checkAppUpdates: 'app:check-updates',
  downloadAppUpdate: 'app:download-update',
  installAppUpdate: 'app:install-update',
}

const DEV_API_URL = 'http://127.0.0.1:3001/api/ipc'

async function callDevApi(channel: string, args: unknown[]): Promise<unknown> {
  const res = await fetch(DEV_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channel, args }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error((err as { error?: string }).error || `HTTP ${res.status}`)
  }
  const data = await res.json() as { result: unknown }
  return data.result
}

export const api = isElectron
  ? window.electronAPI
  : new Proxy({} as ElectronAPI, {
      get: (_target, prop) => {
        const name = String(prop)
        // Event-listener registrations (on*) return a no-op unsubscribe function
        if (name.startsWith('on')) {
          return (_handler: unknown) => {
            return () => {}
          }
        }
        const channel = METHOD_TO_CHANNEL[name]
        if (channel) {
          return (...args: unknown[]) => callDevApi(channel, args)
        }
        // Fallback voor onbekende methoden
        return (..._args: unknown[]) => {
          console.warn(`[TenderTracker] IPC "${name}" heeft geen kanaal-mapping`)
          return Promise.resolve(null)
        }
      },
    })
