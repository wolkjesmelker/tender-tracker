// Shared types between main and renderer processes

/** Voortgang tijdens volledige Supabase-upload (IPC `sync:progress`). */
export type SupabaseSyncProgressPayload = { percent: number; label: string }

/** Notificatie: tender ontving nieuwe documenten (of analyseerbaar geworden) na een scrape. */
export interface TenderUpdate {
  id: string
  aanbesteding_id: string
  titel: string
  opdrachtgever?: string | null
  bron_naam?: string | null
  bron_url?: string | null
  reden: 'nieuwe_documenten' | 'eerste_analyse'
  detected_at: string
  is_gelezen: 0 | 1
  /** JSON-array van document-namen die nieuw waren (alleen bij reden=nieuwe_documenten). */
  nieuwe_document_namen?: string | null
}

/** Centrale app-updaterollout (Supabase `tender_tracker_app_releases`). */
export type AppReleaseStatus = 'draft' | 'live' | 'archived'

export interface AppReleaseRow {
  id: string
  version: string
  description: string
  status: AppReleaseStatus
  created_at: string
  launched_at: string | null
}

export interface BronWebsite {
  id: string
  naam: string
  url: string
  zoekpad?: string
  login_url?: string
  auth_type: 'none' | 'form' | 'openid_connect'
  vakgebied: string
  is_actief: boolean
  laatste_sync?: string
  sync_interval_uren: number
  created_at: string
  updated_at: string
  /** Inloggegevens — alleen lokaal opgeslagen, nooit gesynchroniseerd naar cloud. */
  login_gebruikersnaam?: string
  login_wachtwoord?: string
}

export interface Zoekterm {
  id: string
  term: string
  categorie?: string
  is_actief: boolean
  volgorde: number
}

/** Uit brontekst geëxtraheerde links (procedure, documenten, externe platforms). */
export interface BronNavigatieLink {
  titel: string
  url: string
  categorie: string
}

/**
 * Opgeslagen in `document_urls` (JSON-array).
 * Minstens één van `url` (remote) of `localNaam` (uitgepakte ZIP / interne opslag) moet gezet zijn.
 */
export interface StoredDocumentEntry {
  url?: string
  /** Bestandsnaam in userData/internal-document-store/{tenderId}/ */
  localNaam?: string
  naam: string
  type: string
  /** Optioneel: oorspronkelijke ZIP-bundel (alleen metadata) */
  bronZipLabel?: string
  /** True wanneer de gebruiker het bestand handmatig aan de lijst heeft toegevoegd */
  addedByUser?: boolean
}

/** Stap in de procedure-tijdlijn (TenderNed API + aanvullingen). */
export interface ProcedureTimelineStep {
  id: string
  label: string
  /** ISO of DD-MM-JJJJ zoals van bron */
  date?: string
  detail?: string
  /** Optioneel: URL’s die bij deze fase horen (getoond in modaal) */
  links?: { titel: string; url: string }[]
}

/** Kernprocedure + tijdslijn; kolom `tender_procedure_context`. */
export interface TenderProcedureContext {
  source: 'tenderned' | 'overig'
  lastSynced?: string
  bronUrl?: string
  publicatieId?: string
  apiHighlights?: {
    kenmerk?: string
    procedureCode?: string
    typePublicatie?: string
    typePublicatieCode?: string
    aanbestedingStatus?: string
    typeOpdrachtCode?: string
    publicatieDatum?: string
    sluitingsDatum?: string
    sluitingsDatumMarktconsultatie?: string
    cpvCodes?: unknown
    nutsCodes?: unknown
  }
  timeline: ProcedureTimelineStep[]
  /** Portals / andere bronnen (snapshot; kan overlappen met bron_navigatie_links) */
  portals?: BronNavigatieLink[]
}

/** Bedrijfsprofiel: bedrijfsgegevens die hergebruikt worden bij het invullen van aanbestedingsdocumenten. */
export interface BedrijfsProfiel {
  id: string
  naam: string
  rechtsvorm?: string
  kvk?: string
  btw?: string
  iban?: string
  adres?: string
  postcode?: string
  stad?: string
  land?: string
  email?: string
  telefoon?: string
  website?: string
  contactpersoon?: string
  functie_contactpersoon?: string
  is_standaard: boolean
  /** JSON: Record<string, string> — extra vrije velden */
  extra_velden?: string
  created_at: string
  updated_at: string
}

/** Eén-pagina samenvatting voor popup + Word/PDF-export (alle waarden vooraf geformatteerd waar nodig). */
export interface TenderSummaryExportPayload {
  titel: string
  /** Kern: AI-samenvatting en/of omschrijving + optioneel CPV-regel */
  inhoud?: string
  locatie?: string
  /** Aanbestedende dienst / opdrachtgever («voor wie») */
  opdrachtgever?: string
  startUitvoering?: string
  eindeUitvoering?: string
  uiterlijkIndienen?: string
  budget?: string
  typeOpdracht?: string
  referentie?: string
  procedure?: string
  publicatie?: string
  bron?: string
  /** Waar / hoe indienen */
  indiening?: string
}

/** Door AI ingevulde kerngegevens (na analyse); ook voor lege DB-velden aanvullen. */
export interface AiExtractedTenderFields {
  publicatiedatum?: string
  sluitingsdatum_inschrijving?: string
  datum_start_uitvoering?: string
  datum_einde_uitvoering?: string
  opdrachtgever?: string
  referentienummer?: string
  procedure_type?: string
  type_opdracht?: string
  cpv_of_werkzaamheden?: string
  geraamde_waarde?: string
  locatie_of_regio?: string
  beoordelingscriteria_kort?: string
  opmerkingen?: string
  /** Adres van de aanbestedende dienst / opdrachtgever */
  opdrachtgever_adres?: string
  /** E-mailadres van de aanbestedende dienst voor correspondentie */
  opdrachtgever_email?: string
  /** Telefoonnummer van de aanbestedende dienst */
  opdrachtgever_telefoon?: string
  /** Website van de aanbestedende dienst */
  opdrachtgever_website?: string
  /** Naam contactpersoon bij de aanbestedende dienst */
  contactpersoon_naam?: string
  /** E-mailadres van de contactpersoon */
  contactpersoon_email?: string
  /** Telefoonnummer van de contactpersoon */
  contactpersoon_telefoon?: string
  /** Adres / platform waar de inschrijving naartoe gestuurd moet worden */
  indiening_adres?: string
  /** JSON-array: [{url, titel, categorie}] — links gevonden in bijlagen/PDF's */
  document_links?: string
}

export interface Aanbesteding {
  id: string
  titel: string
  beschrijving?: string
  opdrachtgever?: string
  publicatiedatum?: string
  sluitingsdatum?: string
  /** JSON: BronNavigatieLink[] — links uit bronpagina / tabs */
  bron_navigatie_links?: string
  /** JSON: AiExtractedTenderFields — na AI-analyse */
  ai_extracted_fields?: string
  bron_url?: string
  bron_website_id?: string
  bron_website_naam?: string
  status: 'gevonden' | 'gekwalificeerd' | 'in_aanbieding' | 'afgewezen' | 'gearchiveerd'
  referentienummer?: string
  type_opdracht?: string
  regio?: string
  geraamde_waarde?: string
  ruwe_tekst?: string
  document_urls?: string
  /** JSON string array: stabiele sleutels (`u:`/`l:`/`b:`) voor aangevinkte documenten in de UI */
  document_catalog_selected_keys?: string
  /** ISO timestamp: post-scrape documentdiscovery rond (null = nog hervatbaar) */
  document_fetch_completed_at?: string
  /** JSON: TenderProcedureContext — procedure, tijdslijn, portals */
  tender_procedure_context?: string
  ai_samenvatting?: string
  ai_antwoorden?: string
  criteria_scores?: string
  totaal_score?: number
  match_uitleg?: string
  relevantie_score?: number
  /** JSON: per-bijlage AI-analyse (TenderNed + Mercell e.d.) */
  bijlage_analyses?: string
  /** JSON: RisicoAnalyseResult — risico-inventarisatie */
  risico_analyse?: string
  /** ISO timestamp van de laatste risico-analyse */
  risico_analyse_at?: string
  /** JSON: RisicoAnalyseV2Result — agentic 19-agents pipeline */
  risico_analyse_v2?: string
  is_upload: boolean
  bestandsnaam?: string
  notities?: string
  created_at: string
  updated_at: string
  /** Cache van laatst bekende kaartcoördinaten (geocoding-resultaat). */
  map_lat?: number | null
  map_lng?: number | null
  /** Originele query-string die naar deze coords leidde (voor invalidatie/herzoek). */
  map_geocode_query?: string | null
  /** ISO timestamp van de laatste geocoding-poging. */
  map_geocode_at?: string | null
  /** ISO 3166 alpha-2 landcode (lowercase) van het geocoderesultaat (bv. 'nl', 'be'). */
  map_country_code?: string | null
}

export interface Criterium {
  id: string
  naam: string
  beschrijving?: string
  gewicht: number
  is_actief: boolean
  volgorde: number
}

export interface AIVraag {
  id: string
  vraag: string
  categorie?: string
  is_standaard: boolean
  is_actief: boolean
  volgorde: number
}

export interface AIPrompt {
  id: string
  naam: string
  type: 'orchestrator' | 'agent' | 'gatekeeper' | 'scorer'
  agent_naam?: string
  prompt_tekst: string
  versie: number
  is_actief: boolean
  beschrijving?: string
}

export interface ScrapeJob {
  id: string
  bron_website_id?: string
  bron_naam: string
  bron_url: string
  zoekterm?: string
  status: 'wachtend' | 'bezig' | 'gereed' | 'fout'
  resultaten?: string
  aantal_gevonden: number
  fout_melding?: string
  triggered_by: 'manual' | 'scheduled' | 'webhook'
  started_at?: string
  completed_at?: string
  created_at: string
}

export interface ScrapeSchema {
  id: string
  naam: string
  cron_expressie: string
  bron_website_ids: string
  zoektermen?: string
  is_actief: boolean
  laatste_run?: string
  volgende_run?: string
  created_at: string
}

export interface AppSetting {
  key: string
  value: string
  updated_at: string
}

/** Resultaat seat-check (main → renderer). */
export interface LicenseStatus {
  ok: boolean
  /** Build zonder LICENSE_SERVER_URL / key: ontwikkelmodus */
  skipped?: boolean
  reason?: 'SEAT_LIMIT' | 'INVALID_KEY' | 'NETWORK' | 'SERVER'
  message?: string
  maxSeats?: number
  usedSeats?: number
}

export interface AIConfig {
  provider: 'claude' | 'openai' | 'moonshot' | 'kimi_cli' | 'ollama'
  model: string
  apiKey?: string
  ollamaEndpoint?: string
}

export interface BijlageAnalyse {
  naam: string
  /** tenderned | mercell | overig */
  bron?: string
  samenvatting: string
  belangrijkste_punten: string[]
  risicos: string[]
  /** 0–100: relevantie / bruikbaarheid voor inschrijving */
  score: number
  uitleg_score: string
}

export interface AnalysisResult {
  samenvatting: string
  antwoorden: Record<string, string>
  criteria_scores: Record<string, number>
  totaal_score: number
  match_uitleg: string
  relevantie_score: number
  bijlage_analyses: BijlageAnalyse[]
  /** Gestructureerde velden om in DB te mergen */
  tender_velden?: AiExtractedTenderFields
}

export interface ScrapeProgress {
  jobId: string
  status: string
  message: string
  found: number
  total?: number
}

export interface AuthStatus {
  siteId: string
  siteName: string
  isAuthenticated: boolean
  lastLogin?: string
}

export interface DashboardStats {
  totaalAanbestedingen: number
  actieveAanbestedingen: number
  gevondenVandaag: number
  urgentDeadlines: number
  gemiddeldeScore: number
}

export interface ExportOptions {
  format: 'pdf' | 'word'
  aanbestedingIds: string[]
  includeAnalysis: boolean
  includeScores: boolean
  includeDocuments: boolean
}

// ── Risico Inventarisatie ─────────────────────────────────────────────────────

export type RisicoScore = 'Laag' | 'Middel' | 'Hoog'
export type RisicoType = 'knock-out' | 'commercieel' | 'juridisch' | 'operationeel' | 'strategisch' | 'bewijsrisico'
export type InschrijfAdvies = 'inschrijfbaar' | 'inschrijfbaar_onder_voorwaarden' | 'hoog_risico' | 'no_go'

export interface RisicoItem {
  nummer: number
  titel: string
  ernstscore: RisicoScore
  kans: RisicoScore
  impact: RisicoScore
  type: RisicoType | string
  feit: string
  bron: string
  juridische_duiding: string
  /** Juridische / commerciële consequenties die uit de stukken volgen (geen speculatie). */
  consequenties?: string
  waarom_risico: string
  verificatie: string
  actie: string
}

export interface RisicoGebied {
  naam: string
  score: RisicoScore
  score_toelichting: string
  risicos: RisicoItem[]
}

export interface RisicoDocumentItem {
  naam: string
  versie: string
  rol: string
  opmerkingen?: string
}

export interface RisicoVraagNvI {
  doel: string
  bron: string
  formulering: string
}

export interface RisicoKernbevindingen {
  procedureel: string
  juridisch: string
  commercieel: string
  uitvoering: string
}

export interface RisicoWetsartikelRij {
  artikel_of_beginsel: string
  korte_inhoud: string
  toegepast_bij_risico: string
  relevantie: string
  /** Bijv. https://wetten.overheid.nl/... of https://www.pianoo.nl/... */
  bron_url?: string
}

// ── Agent (chat + invullen + leren) ────────────────────────────────────────────

export type AgentMessageRole = 'system' | 'user' | 'assistant' | 'tool'

export interface AgentMessage {
  id: string
  tender_id?: string
  role: AgentMessageRole
  content: string
  metadata_json?: string
  created_at: string
}

export type AgentFieldType = 'text' | 'textarea' | 'date' | 'amount' | 'number' | 'choice' | 'multichoice' | 'boolean'

export interface AgentFieldOption {
  value: string
  label: string
}

/** Eén invulbaar veld binnen een document. */
export interface AgentFieldDefinition {
  id: string
  label: string
  type: AgentFieldType
  required: boolean
  description?: string
  options?: AgentFieldOption[]
  /** Groepnaam voor wizard-stap (bijv. "Bedrijfsgegevens", "Prijs", "Akkoord") */
  group?: string
  order?: number
}

export type AgentFillStatus = 'empty' | 'proposed' | 'partial' | 'filled' | 'approved'
export type AgentFillSource = 'ai' | 'user' | 'learning'

export interface AgentFillState {
  tender_id: string
  document_naam: string
  field_id: string
  field_label: string
  field_type: AgentFieldType
  field_required: boolean
  field_description?: string
  field_options?: AgentFieldOption[]
  field_group?: string
  field_order: number
  value_text?: string
  status: AgentFillStatus
  source: AgentFillSource
  confidence?: number
  contradiction_flag: boolean
  contradiction_detail?: string
  /** Letterlijke substring uit het brondocument die bewijst dat dit veld gevraagd wordt. */
  source_quote?: string
  /** True zodra een gebruiker dit veld echt heeft ingevuld of opgeslagen (niet alleen AI-voorstel). */
  user_touched?: boolean
  updated_at: string
}

export interface AgentDocumentFillSummary {
  document_naam: string
  total_fields: number
  filled_fields: number
  partial_fields: number
  contradictions: number
  status: 'not_started' | 'partial' | 'complete' | 'contradiction'
  percentage: number
  /** True als de gebruiker iets echt heeft ingevuld (niet alleen AI-voorstellen of alleen geopend). */
  user_started: boolean
  /** Aantal als verplicht gemarkeerde velden. */
  required_total: number
  /** Aantal verplichte velden met een echte waarde (status filled/approved of user_touched met value). */
  required_filled: number
  /** Checklist-items (te verzamelen informatie) — totaal en afgevinkt. */
  checklist_total: number
  checklist_done: number
}

/** Checklist-item: informatie/stukken die de inschrijver moet verzamelen voor één document. */
export interface AgentDocumentChecklistItem {
  tender_id: string
  document_naam: string
  item_id: string
  label: string
  hint?: string
  /** Letterlijke substring uit de documenttekst die dit item onderbouwt. */
  source_quote?: string
  order: number
  done: boolean
  done_at?: string
  updated_at: string
}

export interface AgentLearningEntry {
  id: string
  document_type_hint: string
  field_key: string
  field_label?: string
  question_pattern?: string
  preferred_answer: string
  use_count: number
  last_used_at: string
}

export interface AgentWebSearchResult {
  title: string
  url: string
  snippet: string
}

export interface AgentContradictionWarning {
  field_id: string
  field_label: string
  severity: 'info' | 'warn' | 'error'
  message: string
  conflict_source?: string
}

export interface AgentStreamChunk {
  id: string
  tender_id?: string
  delta?: string
  done?: boolean
  error?: string
  tool_call?: {
    name: string
    args: Record<string, unknown>
    result?: unknown
  }
}

export interface RisicoAnalyseResult {
  overall_score: RisicoScore
  overall_toelichting: string
  inschrijfadvies: InschrijfAdvies
  management_samenvatting: string
  top5_risicos: string[]
  /** Sectie 3 uit de uitgebreide prompt: kernbevindingen per domein. */
  kernbevindingen?: RisicoKernbevindingen
  risicogebieden: RisicoGebied[]
  tegenstrijdigheden: string[]
  no_go_factoren: string[]
  vragen_nvi: RisicoVraagNvI[]
  document_inventarisatie: RisicoDocumentItem[]
  /** Sectie 8: overzicht gebruikte wetsartikelen/beginselen met bron-URL waar mogelijk. */
  wetsartikelen_bijlage?: RisicoWetsartikelRij[]
}
