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
  DOCUMENTS_DISCOVER_PROGRESS: 'documents:discover-progress',
  TENDERS_LOCAL_DOC_READ: 'tenders:local-doc-read',
  TENDERS_LOCAL_DOC_SAVE_AS: 'tenders:local-doc-save-as',
  TENDERS_LOCAL_DOC_OPEN_EXTERNAL: 'tenders:local-doc-open-external',
  TENDERS_BRON_DOC_PREVIEW: 'tenders:bron-doc-preview',
  TENDERS_BRON_DOC_SAVE_AS: 'tenders:bron-doc-save-as',
  TENDERS_BRON_DOC_OPEN_EXTERNAL: 'tenders:bron-doc-open-external',
  /** Cookie-partitie (persist:auth-*) voor webview bij formulieren op de bron */
  TENDERS_BRON_EMBED_PARTITION: 'tenders:bron-embed-partition',

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
  RISICO_PROGRESS: 'risico:progress',
  /** Renderer vraagt replay van buffer + live run na mount (na subscribe op progress). */
  RISICO_UI_REPLAY: 'risico:ui-replay',

  // Token statistieken
  TOKENS_GET_STATS: 'tokens:get-stats',

  /** Intern: AI-/risico-diagnose (geen secrets in response). */
  AI_DIAGNOSTICS_SNAPSHOT: 'diagnostics:ai-snapshot',

  // Export
  EXPORT_GENERATE: 'export:generate',

  // Cloud back-up / synchronisatie (map zoals OneDrive / Google Drive)
  BACKUP_SELECT_CLOUD_FOLDER: 'backup:select-cloud-folder',
  BACKUP_GET_MANIFEST: 'backup:get-manifest',
  BACKUP_RUN_MIRROR_SYNC: 'backup:run-mirror-sync',

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
  AGENT_GET_FILL_SUMMARY: 'agent:get-fill-summary',
  AGENT_EXPORT_FILL: 'agent:export-fill',
  AGENT_EXPORT_FILLED_DOCUMENT: 'agent:export-filled-document',

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
