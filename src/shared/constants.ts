// IPC channel names
export const IPC = {
  // Tenders
  TENDERS_LIST: 'tenders:list',
  TENDERS_GET: 'tenders:get',
  TENDERS_UPDATE: 'tenders:update',
  TENDERS_DELETE: 'tenders:delete',
  TENDERS_DELETE_MANY: 'tenders:delete-many',
  TENDERS_STATS: 'tenders:stats',
  TENDERS_DISCOVER_DOCUMENTS: 'tenders:discover-documents',
  TENDERS_NORMALIZE_ON_OPEN: 'tenders:normalize-on-open',
  /** Kies bestand(en) op schijf, kopieer naar interne tender-opslag, append aan document_urls */
  TENDERS_ADD_MANUAL_DOCUMENTS: 'tenders:add-manual-documents',
  /** Verwijder documenten / bron-bestandslinks op basis van catalogus-sleutels (u:/l:/n:/b:). */
  TENDERS_REMOVE_CATALOG_ENTRIES: 'tenders:remove-catalog-entries',
  DOCUMENTS_DISCOVER_PROGRESS: 'documents:discover-progress',
  TENDERS_LOCAL_DOC_READ: 'tenders:local-doc-read',
  TENDERS_LOCAL_DOC_SAVE_AS: 'tenders:local-doc-save-as',
  TENDERS_LOCAL_DOC_OPEN_EXTERNAL: 'tenders:local-doc-open-external',
  TENDERS_BRON_DOC_PREVIEW: 'tenders:bron-doc-preview',
  TENDERS_BRON_DOC_SAVE_AS: 'tenders:bron-doc-save-as',
  TENDERS_BRON_DOC_OPEN_EXTERNAL: 'tenders:bron-doc-open-external',
  /** Cookie-partitie (persist:auth-*) voor webview bij formulieren op de bron */
  TENDERS_BRON_EMBED_PARTITION: 'tenders:bron-embed-partition',
  /** Bepaal map_lat/map_lng voor één of meer tender-id's (lazy geocoding via Nominatim). */
  /** Verwerk een handmatig ingevoerde URL als aanbesteding (aanmaken + documenten + analyse). */
  TENDERS_PROCESS_URL: 'tenders:process-url',
  /** Voortgang van handmatige URL-verwerking (push vanuit main naar renderer). */
  TENDERS_PROCESS_URL_PROGRESS: 'tenders:process-url-progress',
  TENDERS_RESOLVE_MAP_GEOCODES: 'tenders:resolve-map-geocodes',
  /** Voortgangsupdates van geocoding-queue (renderer → mooie loader). */
  TENDERS_RESOLVE_MAP_GEOCODES_PROGRESS: 'tenders:resolve-map-geocodes-progress',
  /** Geocodeer een vrij adres-string (voor bijv. bedrijfsprofielen) via main-process Nominatim. */
  GEOCODE_ADDRESS: 'geocode:address',

  // Sources
  SOURCES_LIST: 'sources:list',
  SOURCES_GET: 'sources:get',
  SOURCES_CREATE: 'sources:create',
  SOURCES_UPDATE: 'sources:update',
  SOURCES_DELETE: 'sources:delete',

  // Criteria
  CRITERIA_LIST: 'criteria:list',
  CRITERIA_CREATE: 'criteria:create',
  CRITERIA_UPDATE: 'criteria:update',
  CRITERIA_DELETE: 'criteria:delete',

  // Search terms
  ZOEKTERMEN_LIST: 'zoektermen:list',
  ZOEKTERMEN_CREATE: 'zoektermen:create',
  ZOEKTERMEN_UPDATE: 'zoektermen:update',
  ZOEKTERMEN_DELETE: 'zoektermen:delete',

  // AI Questions
  AI_VRAGEN_LIST: 'ai-vragen:list',
  AI_VRAGEN_CREATE: 'ai-vragen:create',
  AI_VRAGEN_UPDATE: 'ai-vragen:update',
  AI_VRAGEN_DELETE: 'ai-vragen:delete',

  // AI Prompts
  AI_PROMPTS_LIST: 'ai-prompts:list',
  AI_PROMPTS_GET: 'ai-prompts:get',
  AI_PROMPTS_CREATE: 'ai-prompts:create',
  AI_PROMPTS_UPDATE: 'ai-prompts:update',
  AI_PROMPTS_DELETE: 'ai-prompts:delete',

  // Scraping
  SCRAPING_START: 'scraping:start',
  SCRAPING_STOP: 'scraping:stop',
  SCRAPING_PROGRESS: 'scraping:progress',
  SCRAPING_JOBS: 'scraping:jobs',
  SCRAPING_DELETE_JOBS: 'scraping:delete-jobs',
  SCRAPING_PENDING_DOCUMENT_FETCH: 'scraping:pending-document-fetch',
  SCRAPING_RESUME_DOCUMENT_FETCH: 'scraping:resume-document-fetch',
  /** Vraagt nette stop aan na de lopende tender (tussen twee aanbestedingen). */
  SCRAPING_STOP_DOCUMENT_FETCH: 'scraping:stop-document-fetch',

  // Auth
  AUTH_STATUS: 'auth:status',
  AUTH_OPEN_LOGIN: 'auth:open-login',
  AUTH_OPEN_EXTERNAL: 'auth:open-external',
  AUTH_LOGIN_COMPLETE: 'auth:login-complete',
  AUTH_LOGOUT: 'auth:logout',

  // AI Analysis
  ANALYSIS_START: 'analysis:start',
  ANALYSIS_RESUME: 'analysis:resume',
  ANALYSIS_PAUSE: 'analysis:pause',
  ANALYSIS_STOP: 'analysis:stop',
  ANALYSIS_CHECKPOINT_GET: 'analysis:checkpoint-get',
  ANALYSIS_BATCH_START: 'analysis:batch-start',
  ANALYSIS_BATCH_ALL: 'analysis:batch-all-start',
  ANALYSIS_BATCH_STATUS: 'analysis:batch-status',
  ANALYSIS_PROGRESS: 'analysis:progress',
  /** Renderer vraagt laatste analyse-stap na mount (venster heropenen / navigatie). */
  ANALYSIS_UI_REPLAY: 'analysis:ui-replay',
  ANALYSIS_RESULT: 'analysis:result',

  // Risico Inventarisatie
  RISICO_START: 'risico:start',
  /** Heranalyse met expliciet gekozen top-tier OpenAI model (eenmalige override). */
  RISICO_START_WITH_MODEL: 'risico:start-with-model',
  /** Agentic 19-agents pipeline — slaat resultaat op in risico_analyse_v2. */
  RISICO_START_V2: 'risico:start-v2',
  RISICO_PROGRESS: 'risico:progress',
  /** Renderer vraagt replay van buffer + live run na mount (na subscribe op progress). */
  RISICO_UI_REPLAY: 'risico:ui-replay',
  /** Push van assembledDraft na elke stage-overgang (progressieve UI). */
  RISICO_DRAFT_SNAPSHOT: 'risico:draft-snapshot',
  /** Renderer haalt laatste checkpoint-draft op bij mount (als run al loopt). */
  RISICO_FETCH_CHECKPOINT_DRAFT: 'risico:fetch-checkpoint-draft',
  /** Sla de risico-inventarisatie op als zelfstandig HTML-bestand. */
  RISICO_SAVE_HTML: 'risico:save-html',
  /** Zelfde opmaak als HTML-export, als PDF via Chromium (geen systeemprintdialoog). */
  RISICO_SAVE_PDF: 'risico:save-pdf',

  // Token statistieken
  TOKENS_GET_STATS: 'tokens:get-stats',
  TOKENS_RESET: 'tokens:reset',

  /** Intern: AI-/risico-diagnose (geen secrets in response). */
  AI_DIAGNOSTICS_SNAPSHOT: 'diagnostics:ai-snapshot',

  // Export
  EXPORT_GENERATE: 'export:generate',
  /** Korte tendernota (Word/PDF) vanuit samenvatting-popup */
  EXPORT_TENDER_SUMMARY: 'export:tender-summary',

  // Cloud back-up / synchronisatie (map zoals OneDrive / Google Drive)
  BACKUP_SELECT_CLOUD_FOLDER: 'backup:select-cloud-folder',
  BACKUP_GET_MANIFEST: 'backup:get-manifest',
  BACKUP_RUN_MIRROR_SYNC: 'backup:run-mirror-sync',

  // Supabase sync
  SYNC_STATUS: 'sync:status',
  SYNC_NOW: 'sync:now',
  SYNC_FULL_PUSH: 'sync:full-push',
  SYNC_FULL_PULL: 'sync:full-pull',
  /** Renderer ontvangt voortgangsupdate van sync. */
  SYNC_PROGRESS: 'sync:progress',
  /** Proefselectie op Supabase (URL/key + RLS). */
  SYNC_TEST_CONNECTION: 'sync:test-connection',

  // Settings
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
  SETTINGS_GET_ALL: 'settings:get-all',

  // Scheduler
  SCHEDULER_LIST: 'scheduler:list',
  SCHEDULER_CREATE: 'scheduler:create',
  SCHEDULER_UPDATE: 'scheduler:update',
  SCHEDULER_DELETE: 'scheduler:delete',
  SCHEDULER_TOGGLE: 'scheduler:toggle',

  // Tender Agent
  AGENT_SEND_MESSAGE: 'agent:send-message',
  AGENT_GET_HISTORY: 'agent:get-history',
  AGENT_CLEAR_HISTORY: 'agent:clear-history',
  AGENT_STREAM_CHUNK: 'agent:stream-chunk',
  AGENT_START_FILL: 'agent:start-fill',
  AGENT_GET_FILL_STATE: 'agent:get-fill-state',
  AGENT_SAVE_FILL_FIELD: 'agent:save-fill-field',
  AGENT_LEARN_CORRECTION: 'agent:learn-correction',
  AGENT_WEB_SEARCH: 'agent:web-search',
  AGENT_PIN_SEARCH_RESULT: 'agent:pin-search-result',
  AGENT_DELETE_PINNED_NOTE: 'agent:delete-pinned-note',
  AGENT_GET_FILL_SUMMARY: 'agent:get-fill-summary',
  AGENT_EXPORT_FILL: 'agent:export-fill',
  AGENT_EXPORT_FILLED_DOCUMENT: 'agent:export-filled-document',
  /** Checklist "te verzamelen informatie" per document — laden */
  AGENT_GET_DOC_CHECKLIST: 'agent:get-doc-checklist',
  /** Checklist-item af- of aanvinken */
  AGENT_TOGGLE_DOC_CHECKLIST_ITEM: 'agent:toggle-doc-checklist-item',

  // Bedrijfsprofielen (bedrijfsgegevens voor invullen van aanbestedingsdocumenten)
  BEDRIJFSPROFIELEN_LIST: 'bedrijfsprofielen:list',
  BEDRIJFSPROFIELEN_GET: 'bedrijfsprofielen:get',
  BEDRIJFSPROFIELEN_CREATE: 'bedrijfsprofielen:create',
  BEDRIJFSPROFIELEN_UPDATE: 'bedrijfsprofielen:update',
  BEDRIJFSPROFIELEN_DELETE: 'bedrijfsprofielen:delete',
  BEDRIJFSPROFIELEN_SET_STANDAARD: 'bedrijfsprofielen:set-standaard',

  // App shell: versie, updates, licentie
  APP_VERSION: 'app:version',
  LICENSE_STATUS: 'license:status',
  LICENSE_REFRESH: 'license:refresh',
  APP_CHECK_UPDATES: 'app:check-updates',
  APP_DOWNLOAD_UPDATE: 'app:download-update',
  APP_INSTALL_UPDATE: 'app:install-update',
  APP_UPDATE_AVAILABLE: 'app:update-available',
  APP_UPDATE_DOWNLOADED: 'app:update-downloaded',
  APP_UPDATE_PROGRESS: 'app:update-progress',

  // Tender-updates (notificaties: nieuwe documenten / heranalyseerde tenders)
  TENDER_UPDATES_LIST: 'tender-updates:list',
  TENDER_UPDATES_COUNT: 'tender-updates:count',
  TENDER_UPDATES_MARK_READ: 'tender-updates:mark-read',
  TENDER_UPDATES_MARK_ALL_READ: 'tender-updates:mark-all-read',
  TENDER_UPDATES_CLEAR: 'tender-updates:clear',
  /** Haal ongelezen update(s) op voor één specifieke tender. */
  TENDER_UPDATES_FOR_TENDER: 'tender-updates:for-tender',
  /** Main → renderer: nieuw batch na scrape klaar */
  TENDER_UPDATES_NEW: 'tender-updates:new',

  /** App-releases: lijst, concept, live zetten, verwijderen (Supabase) */
  RELEASE_LIST: 'release:list',
  RELEASE_CREATE_DRAFT: 'release:create-draft',
  RELEASE_DELETE_DRAFT: 'release:delete-draft',
  RELEASE_PROMOTE_LIVE: 'release:promote-live',
} as const

export const DEFAULT_SEARCH_TERMS = [
  { term: 'wegenbouw', categorie: 'kern' },
  { term: 'infrastructuur', categorie: 'kern' },
  { term: 'GWW', categorie: 'kern' },
  { term: 'civiele techniek', categorie: 'kern' },
  { term: 'openbare ruimte', categorie: 'kern' },
  { term: 'herinrichting', categorie: 'kern' },
  { term: 'reconstructie', categorie: 'kern' },
  { term: 'bouwrijp maken', categorie: 'kern' },
  { term: 'woonrijp maken', categorie: 'kern' },
  { term: 'asfalt', categorie: 'aanvullend' },
  { term: 'asfaltonderhoud', categorie: 'aanvullend' },
  { term: 'riolering', categorie: 'aanvullend' },
  { term: 'riool', categorie: 'aanvullend' },
  { term: 'afkoppelen hemelwater', categorie: 'aanvullend' },
  { term: 'waterberging', categorie: 'aanvullend' },
  { term: 'infiltratie', categorie: 'aanvullend' },
  { term: 'klimaatadaptatie', categorie: 'aanvullend' },
  { term: 'drainage', categorie: 'aanvullend' },
  { term: 'watermanagement', categorie: 'aanvullend' },
  { term: 'bestrating', categorie: 'aanvullend' },
  { term: 'verharding', categorie: 'aanvullend' },
  { term: 'bedrijventerrein', categorie: 'aanvullend' },
  { term: 'gebiedsontwikkeling', categorie: 'aanvullend' },
  { term: 'onderhoud wegen', categorie: 'aanvullend' },
  { term: 'civiele werken', categorie: 'aanvullend' },
  { term: 'reconstructie dorpskern', categorie: 'functioneel' },
  { term: 'leefomgeving verbeteren', categorie: 'functioneel' },
  { term: 'klimaatadaptieve inrichting', categorie: 'functioneel' },
  { term: 'duurzame inrichting buitenruimte', categorie: 'functioneel' },
]

export const DEFAULT_CRITERIA = [
  { naam: 'Asfaltwerkzaamheden', beschrijving: 'Aanleg en onderhoud van asfaltverhardingen', gewicht: 15 },
  { naam: 'Rioleringswerkzaamheden', beschrijving: 'Aanleg, vervanging en renovatie van rioolstelsels', gewicht: 15 },
  { naam: 'Herinrichting openbare ruimte', beschrijving: 'Reconstructie van straten, pleinen, dorpskernen', gewicht: 15 },
  { naam: 'Watermanagement', beschrijving: 'Waterberging, infiltratie, klimaatadaptatie', gewicht: 10 },
  { naam: 'Bestrating/Elementenverharding', beschrijving: 'Klinker- en tegelverhardingen', gewicht: 10 },
  { naam: 'Bouwrijp/Woonrijp maken', beschrijving: 'Bouwrijp en woonrijp maken van terreinen', gewicht: 10 },
  { naam: 'Bedrijventerreinen', beschrijving: 'Aanleg en onderhoud bedrijventerreinen', gewicht: 5 },
  { naam: 'Design & Build', beschrijving: 'UAV-GC en bouwteam projecten', gewicht: 5 },
  { naam: 'Regionale ligging', beschrijving: 'Project in Zuid-Nederland of grensregio', gewicht: 10 },
  { naam: 'Passende omvang', beschrijving: 'Projectwaarde €0.5M - €15M', gewicht: 5 },
]

export const DEFAULT_AI_QUESTIONS = [
  { vraag: 'Wat is de uitvoeringstermijn?', categorie: 'planning' },
  { vraag: 'Wat is de startdatum?', categorie: 'planning' },
  { vraag: 'Wat is de einddatum?', categorie: 'planning' },
  { vraag: 'Wie is de toezichthouder vanuit de opdrachtgever?', categorie: 'organisatie' },
  { vraag: 'Wie is de projectleider vanuit de opdrachtgever?', categorie: 'organisatie' },
  { vraag: 'Wat zou een ramingsprijs zijn?', categorie: 'financieel' },
  { vraag: 'Wat zijn de 3 grootste werkzaamheden?', categorie: 'inhoud' },
  { vraag: 'Wat zijn de 3 grootste risico\'s?', categorie: 'risico' },
  { vraag: 'Welke contractvorm is van toepassing (RAW, UAV-gc, etc.)?', categorie: 'contract' },
]

/** `app_settings`-keys voor bewerkbare risicoprompts (Instellingen → Prompts). */
export const APP_SETTING_RISICO_PROMPT_HOOFD = 'risico_prompt_hoofd'
export const APP_SETTING_RISICO_PROMPT_EXTRACTIE = 'risico_prompt_extractie'

/** `app_settings`-key voor bewerkbare prompt voor document-invul-pre-analyse (velden + checklist). */
export const APP_SETTING_DOC_FILL_PROMPT = 'document_fill_prompt'

/**
 * `app_settings`-key: na tracking direct volledige AI-analyse + risico voor nieuwe aanbestedingen (`1`/`0`).
 * Standaard aan (ontbrekende key telt als aan), zie `isPostScrapeAnalyzeImmediatelyEnabled`.
 * Als het werkgebied op de kaart actief is (straal + profiel in app_settings, zie `tender-work-area`),
 * worden alleen tenders binnen die straal automatisch in de wachtrij gezet; de rest is handmatige analyse.
 */
export const APP_SETTING_POST_SCRAPE_ANALYZE_IMMEDIATELY = 'post_scrape_analyze_immediately'
