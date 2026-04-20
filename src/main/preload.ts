import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/constants'
import type { LicenseStatus } from '../shared/types'

const electronAPI = {
  // Tenders
  getTenders: (filters?: Record<string, unknown>) => ipcRenderer.invoke(IPC.TENDERS_LIST, filters),
  getTender: (id: string) => ipcRenderer.invoke(IPC.TENDERS_GET, id),
  updateTender: (id: string, data: Record<string, unknown>) => ipcRenderer.invoke(IPC.TENDERS_UPDATE, id, data),
  deleteTender: (id: string) => ipcRenderer.invoke(IPC.TENDERS_DELETE, id),
  deleteTenders: (ids: string[]) => ipcRenderer.invoke(IPC.TENDERS_DELETE_MANY, ids),
  getTenderStats: () => ipcRenderer.invoke(IPC.TENDERS_STATS),
  discoverTenderDocuments: (id: string) => ipcRenderer.invoke(IPC.TENDERS_DISCOVER_DOCUMENTS, id),
  normalizeTenderOnOpen: (id: string) => ipcRenderer.invoke(IPC.TENDERS_NORMALIZE_ON_OPEN, id),
  readLocalTenderDocument: (tenderId: string, fileName: string) =>
    ipcRenderer.invoke(IPC.TENDERS_LOCAL_DOC_READ, { tenderId, fileName }),
  saveLocalTenderDocumentAs: (tenderId: string, fileName: string) =>
    ipcRenderer.invoke(IPC.TENDERS_LOCAL_DOC_SAVE_AS, { tenderId, fileName }),
  openLocalTenderDocumentExternal: (tenderId: string, fileName: string) =>
    ipcRenderer.invoke(IPC.TENDERS_LOCAL_DOC_OPEN_EXTERNAL, { tenderId, fileName }),
  previewBronDocument: (url: string, fileName: string, tenderId: string) =>
    ipcRenderer.invoke(IPC.TENDERS_BRON_DOC_PREVIEW, { url, fileName, tenderId }),
  saveBronDocumentAs: (url: string, fileName: string, tenderId: string) =>
    ipcRenderer.invoke(IPC.TENDERS_BRON_DOC_SAVE_AS, { url, fileName, tenderId }),
  openBronDocumentExternal: (url: string, fileName: string, tenderId: string) =>
    ipcRenderer.invoke(IPC.TENDERS_BRON_DOC_OPEN_EXTERNAL, { url, fileName, tenderId }),
  getBronEmbedPartition: (tenderId: string) =>
    ipcRenderer.invoke(IPC.TENDERS_BRON_EMBED_PARTITION, tenderId) as Promise<{ partition: string | null }>,
  onDocumentsDiscoverProgress: (callback: (data: unknown) => void) => {
    const handler = (_: unknown, data: unknown) => callback(data)
    ipcRenderer.on(IPC.DOCUMENTS_DISCOVER_PROGRESS, handler)
    return () => ipcRenderer.removeListener(IPC.DOCUMENTS_DISCOVER_PROGRESS, handler)
  },

  // Sources
  getSources: () => ipcRenderer.invoke(IPC.SOURCES_LIST),
  getSource: (id: string) => ipcRenderer.invoke(IPC.SOURCES_GET, id),
  createSource: (data: Record<string, unknown>) => ipcRenderer.invoke(IPC.SOURCES_CREATE, data),
  updateSource: (id: string, data: Record<string, unknown>) => ipcRenderer.invoke(IPC.SOURCES_UPDATE, id, data),
  deleteSource: (id: string) => ipcRenderer.invoke(IPC.SOURCES_DELETE, id),

  // Criteria
  getCriteria: () => ipcRenderer.invoke(IPC.CRITERIA_LIST),
  createCriterium: (data: Record<string, unknown>) => ipcRenderer.invoke(IPC.CRITERIA_CREATE, data),
  updateCriterium: (id: string, data: Record<string, unknown>) => ipcRenderer.invoke(IPC.CRITERIA_UPDATE, id, data),
  deleteCriterium: (id: string) => ipcRenderer.invoke(IPC.CRITERIA_DELETE, id),

  // Search terms
  getZoektermen: () => ipcRenderer.invoke(IPC.ZOEKTERMEN_LIST),
  createZoekterm: (data: Record<string, unknown>) => ipcRenderer.invoke(IPC.ZOEKTERMEN_CREATE, data),
  updateZoekterm: (id: string, data: Record<string, unknown>) => ipcRenderer.invoke(IPC.ZOEKTERMEN_UPDATE, id, data),
  deleteZoekterm: (id: string) => ipcRenderer.invoke(IPC.ZOEKTERMEN_DELETE, id),

  // AI Questions
  getAIVragen: () => ipcRenderer.invoke(IPC.AI_VRAGEN_LIST),
  createAIVraag: (data: Record<string, unknown>) => ipcRenderer.invoke(IPC.AI_VRAGEN_CREATE, data),
  updateAIVraag: (id: string, data: Record<string, unknown>) => ipcRenderer.invoke(IPC.AI_VRAGEN_UPDATE, id, data),
  deleteAIVraag: (id: string) => ipcRenderer.invoke(IPC.AI_VRAGEN_DELETE, id),

  // AI Prompts
  getAIPrompts: () => ipcRenderer.invoke(IPC.AI_PROMPTS_LIST),
  getAIPrompt: (id: string) => ipcRenderer.invoke(IPC.AI_PROMPTS_GET, id),
  createAIPrompt: (data: Record<string, unknown>) => ipcRenderer.invoke(IPC.AI_PROMPTS_CREATE, data),
  updateAIPrompt: (id: string, data: Record<string, unknown>) => ipcRenderer.invoke(IPC.AI_PROMPTS_UPDATE, id, data),
  deleteAIPrompt: (id: string) => ipcRenderer.invoke(IPC.AI_PROMPTS_DELETE, id),

  // Scraping
  startScraping: (options: Record<string, unknown>) => ipcRenderer.invoke(IPC.SCRAPING_START, options),
  stopScraping: (jobId: string) => ipcRenderer.invoke(IPC.SCRAPING_STOP, jobId),
  getScrapeJobs: () => ipcRenderer.invoke(IPC.SCRAPING_JOBS),
  deleteScrapeJobs: (payload: { all?: boolean; ids?: string[] }) =>
    ipcRenderer.invoke(IPC.SCRAPING_DELETE_JOBS, payload),
  getPendingDocumentFetch: () => ipcRenderer.invoke(IPC.SCRAPING_PENDING_DOCUMENT_FETCH),
  resumePendingDocumentFetch: () => ipcRenderer.invoke(IPC.SCRAPING_RESUME_DOCUMENT_FETCH),
  stopPendingDocumentFetch: () => ipcRenderer.invoke(IPC.SCRAPING_STOP_DOCUMENT_FETCH),
  onScrapeProgress: (callback: (data: unknown) => void) => {
    const handler = (_: unknown, data: unknown) => callback(data)
    ipcRenderer.on(IPC.SCRAPING_PROGRESS, handler)
    return () => ipcRenderer.removeListener(IPC.SCRAPING_PROGRESS, handler)
  },

  // Auth
  getAuthStatus: () => ipcRenderer.invoke(IPC.AUTH_STATUS),
  openLogin: (siteId: string) => ipcRenderer.invoke(IPC.AUTH_OPEN_LOGIN, siteId),
  openExternalLogin: (siteId: string) => ipcRenderer.invoke(IPC.AUTH_OPEN_EXTERNAL, siteId),
  logout: (siteId: string) => ipcRenderer.invoke(IPC.AUTH_LOGOUT, siteId),
  onLoginComplete: (callback: (data: unknown) => void) => {
    const handler = (_: unknown, data: unknown) => callback(data)
    ipcRenderer.on(IPC.AUTH_LOGIN_COMPLETE, handler)
    return () => ipcRenderer.removeListener(IPC.AUTH_LOGIN_COMPLETE, handler)
  },

  // Analysis
  startAnalysis: (aanbestedingId: string, opts?: { discardCheckpoint?: boolean }) =>
    ipcRenderer.invoke(IPC.ANALYSIS_START, aanbestedingId, opts),
  resumeAnalysis: (aanbestedingId: string) => ipcRenderer.invoke(IPC.ANALYSIS_RESUME, aanbestedingId),
  pauseAnalysis: () => ipcRenderer.invoke(IPC.ANALYSIS_PAUSE),
  stopAnalysis: (aanbestedingId?: string) => ipcRenderer.invoke(IPC.ANALYSIS_STOP, aanbestedingId),
  getAnalysisCheckpoint: (aanbestedingId: string) =>
    ipcRenderer.invoke(IPC.ANALYSIS_CHECKPOINT_GET, aanbestedingId),
  startBatchAnalysis: (ids: string[]) => ipcRenderer.invoke(IPC.ANALYSIS_BATCH_START, ids),
  startBatchAnalysisAll: () => ipcRenderer.invoke(IPC.ANALYSIS_BATCH_ALL),
  getBatchStatus: () => ipcRenderer.invoke(IPC.ANALYSIS_BATCH_STATUS),
  onAnalysisProgress: (callback: (data: unknown) => void) => {
    const handler = (_: unknown, data: unknown) => callback(data)
    ipcRenderer.on(IPC.ANALYSIS_PROGRESS, handler)
    return () => ipcRenderer.removeListener(IPC.ANALYSIS_PROGRESS, handler)
  },
  requestAnalysisUiReplay: () => ipcRenderer.invoke(IPC.ANALYSIS_UI_REPLAY),

  // Risico Inventarisatie
  startRisicoAnalyse: (aanbestedingId: string) => ipcRenderer.invoke(IPC.RISICO_START, aanbestedingId),
  requestRisicoUiReplay: () => ipcRenderer.invoke(IPC.RISICO_UI_REPLAY),
  onRisicoProgress: (callback: (data: unknown) => void) => {
    const handler = (_: unknown, data: unknown) => callback(data)
    ipcRenderer.on(IPC.RISICO_PROGRESS, handler)
    return () => ipcRenderer.removeListener(IPC.RISICO_PROGRESS, handler)
  },

  // Tender Agent
  agentSendMessage: (payload: { tenderId?: string; message: string }) =>
    ipcRenderer.invoke(IPC.AGENT_SEND_MESSAGE, payload),
  agentGetHistory: (payload: { tenderId?: string }) =>
    ipcRenderer.invoke(IPC.AGENT_GET_HISTORY, payload),
  agentClearHistory: (payload: { tenderId?: string }) =>
    ipcRenderer.invoke(IPC.AGENT_CLEAR_HISTORY, payload),
  agentStartFill: (payload: { tenderId: string; documentNaam: string; reanalyze?: boolean }) =>
    ipcRenderer.invoke(IPC.AGENT_START_FILL, payload),
  agentGetFillState: (payload: { tenderId: string; documentNaam?: string }) =>
    ipcRenderer.invoke(IPC.AGENT_GET_FILL_STATE, payload),
  agentGetFillSummary: (payload: { tenderId: string }) =>
    ipcRenderer.invoke(IPC.AGENT_GET_FILL_SUMMARY, payload),
  agentSaveFillField: (payload: {
    tenderId: string
    documentNaam: string
    fieldId: string
    value: string
    source?: 'ai' | 'user' | 'learning'
    approve?: boolean
    learn?: boolean
    fieldLabel?: string
  }) => ipcRenderer.invoke(IPC.AGENT_SAVE_FILL_FIELD, payload),
  agentLearnCorrection: (payload: {
    tenderId?: string
    documentNaam: string
    fieldId: string
    fieldLabel?: string
    value: string
  }) => ipcRenderer.invoke(IPC.AGENT_LEARN_CORRECTION, payload),
  agentWebSearch: (payload: { query: string; count?: number }) =>
    ipcRenderer.invoke(IPC.AGENT_WEB_SEARCH, payload),
  agentPinSearchResult: (payload: { tenderId: string; url?: string; summary: string; query?: string }) =>
    ipcRenderer.invoke(IPC.AGENT_PIN_SEARCH_RESULT, payload),
  agentExportFill: (payload: { tenderId: string; documentNaam: string }) =>
    ipcRenderer.invoke(IPC.AGENT_EXPORT_FILL, payload),
  agentExportFilledDocument: (payload: { tenderId: string; documentNaam: string }) =>
    ipcRenderer.invoke(IPC.AGENT_EXPORT_FILLED_DOCUMENT, payload),
  onAgentStreamChunk: (callback: (data: unknown) => void) => {
    const handler = (_: unknown, data: unknown) => callback(data)
    ipcRenderer.on(IPC.AGENT_STREAM_CHUNK, handler)
    return () => ipcRenderer.removeListener(IPC.AGENT_STREAM_CHUNK, handler)
  },

  // Token statistieken
  getTokenStats: () => ipcRenderer.invoke(IPC.TOKENS_GET_STATS),
  getAiDiagnosticsSnapshot: () => ipcRenderer.invoke(IPC.AI_DIAGNOSTICS_SNAPSHOT),

  // Export
  exportData: (options: Record<string, unknown>) => ipcRenderer.invoke(IPC.EXPORT_GENERATE, options),

  // Cloud back-up / synchronisatie
  selectCloudSyncFolder: () => ipcRenderer.invoke(IPC.BACKUP_SELECT_CLOUD_FOLDER),
  getCloudSyncManifest: (syncRoot?: string) => ipcRenderer.invoke(IPC.BACKUP_GET_MANIFEST, syncRoot),
  runCloudMirrorSync: (syncRoot: string) => ipcRenderer.invoke(IPC.BACKUP_RUN_MIRROR_SYNC, syncRoot),

  // Settings
  getSetting: (key: string) => ipcRenderer.invoke(IPC.SETTINGS_GET, key),
  setSetting: (key: string, value: string) => ipcRenderer.invoke(IPC.SETTINGS_SET, key, value),
  getAllSettings: () => ipcRenderer.invoke(IPC.SETTINGS_GET_ALL),

  // Scheduler
  getSchedules: () => ipcRenderer.invoke(IPC.SCHEDULER_LIST),
  createSchedule: (data: Record<string, unknown>) => ipcRenderer.invoke(IPC.SCHEDULER_CREATE, data),
  updateSchedule: (id: string, data: Record<string, unknown>) => ipcRenderer.invoke(IPC.SCHEDULER_UPDATE, id, data),
  deleteSchedule: (id: string) => ipcRenderer.invoke(IPC.SCHEDULER_DELETE, id),
  toggleSchedule: (id: string) => ipcRenderer.invoke(IPC.SCHEDULER_TOGGLE, id),

  // Bedrijfsprofielen
  getBedrijfsprofielen: () => ipcRenderer.invoke(IPC.BEDRIJFSPROFIELEN_LIST),
  getBedrijfsprofiel: (id: string) => ipcRenderer.invoke(IPC.BEDRIJFSPROFIELEN_GET, id),
  createBedrijfsprofiel: (data: Record<string, unknown>) =>
    ipcRenderer.invoke(IPC.BEDRIJFSPROFIELEN_CREATE, data),
  updateBedrijfsprofiel: (id: string, data: Record<string, unknown>) =>
    ipcRenderer.invoke(IPC.BEDRIJFSPROFIELEN_UPDATE, id, data),
  deleteBedrijfsprofiel: (id: string) => ipcRenderer.invoke(IPC.BEDRIJFSPROFIELEN_DELETE, id),
  setBedrijfsprofielStandaard: (id: string) =>
    ipcRenderer.invoke(IPC.BEDRIJFSPROFIELEN_SET_STANDAARD, id),

  // App: versie, licentie, updates
  getAppVersion: () => ipcRenderer.invoke(IPC.APP_VERSION) as Promise<string>,
  getLicenseStatus: () => ipcRenderer.invoke(IPC.LICENSE_STATUS) as Promise<LicenseStatus>,
  refreshLicense: () => ipcRenderer.invoke(IPC.LICENSE_REFRESH) as Promise<LicenseStatus>,
  checkAppUpdates: () => ipcRenderer.invoke(IPC.APP_CHECK_UPDATES),
  downloadAppUpdate: () => ipcRenderer.invoke(IPC.APP_DOWNLOAD_UPDATE),
  installAppUpdate: () => ipcRenderer.invoke(IPC.APP_INSTALL_UPDATE),
  quitApp: () => ipcRenderer.send('app:quit'),
  openExternal: (url: string) => ipcRenderer.invoke('app:open-external', url),
  onUpdateAvailable: (callback: (data: unknown) => void) => {
    const handler = (_: unknown, data: unknown) => callback(data)
    ipcRenderer.on(IPC.APP_UPDATE_AVAILABLE, handler)
    return () => ipcRenderer.removeListener(IPC.APP_UPDATE_AVAILABLE, handler)
  },
  onUpdateDownloaded: (callback: (data: unknown) => void) => {
    const handler = (_: unknown, data: unknown) => callback(data)
    ipcRenderer.on(IPC.APP_UPDATE_DOWNLOADED, handler)
    return () => ipcRenderer.removeListener(IPC.APP_UPDATE_DOWNLOADED, handler)
  },
  onUpdateDownloadProgress: (callback: (data: unknown) => void) => {
    const handler = (_: unknown, data: unknown) => callback(data)
    ipcRenderer.on(IPC.APP_UPDATE_PROGRESS, handler)
    return () => ipcRenderer.removeListener(IPC.APP_UPDATE_PROGRESS, handler)
  },
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI)

export type ElectronAPI = typeof electronAPI
