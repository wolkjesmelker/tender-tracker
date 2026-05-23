/**
 * Volledige TypeScript-schema's voor de agentic risico-inventarisatie pipeline (V2).
 * Gebaseerd op de Eindrapportage Agent output uit cursor_agentic_tender_risicoanalyse.md
 */

export type RisicoScoreV2 = 'Laag' | 'Middel' | 'Hoog'
export type InschrijfAdviesV2 = 'inschrijfbaar' | 'inschrijfbaar_onder_voorwaarden' | 'hoog_risico' | 'no_go'
export type OnderbouwingStatus =
  | 'uit stukken vastgesteld'
  | 'uit externe bron vastgesteld'
  | 'niet vast te stellen op basis van de stukken'
  | 'conflicterend in stukken'

export type RisicoTypeV2 =
  | 'knock-out'
  | 'commercieel'
  | 'juridisch'
  | 'operationeel'
  | 'strategisch'
  | 'bewijsrisico'
  | 'calculatierisico'
  | 'omgevingsrisico'
  | 'planningsrisico'
  | 'hoeveelhedenrisico'
  | 'bodemrisico'
  | 'verkeersrisico'

// ── Document Inventarisatie ─────────────────────────────────────────────────

export interface DocumentInventarisatieItem {
  naam: string
  type: 'leidraad' | 'bestek' | 'contract' | 'tekening' | 'staat' | 'bijlage' | 'nota_van_inlichtingen' | 'planning' | 'rapport' | 'formulier' | 'overig'
  datum: string
  versie: string
  rol: string
  leidend_document: 'Ja' | 'Nee' | 'Niet vast te stellen'
  leesbaar: boolean
  opmerkingen: string
}

// ── Algemene Tenderanalyse ──────────────────────────────────────────────────

export interface TenderTermijn {
  termijn: string
  datum: string
  bron: string
}

export interface AlgemeneTenderanalyseV2 {
  aanbestedende_dienst: string
  procedure: string
  opdrachtomschrijving: string
  contractvorm: string
  gunningssystematiek: string
  belangrijkste_termijnen: string[]
  belangrijkste_tenderrisicos: string[]
}

// ── Risico Item (volledig schema) ───────────────────────────────────────────

export interface RisicoItemV2 {
  nummer: number
  titel: string
  ernstscore: RisicoScoreV2
  kans: RisicoScoreV2
  impact: RisicoScoreV2
  type: RisicoTypeV2
  feit: string
  bron: string
  locatiebron?: string
  status_van_onderbouwing: OnderbouwingStatus
  professionele_duiding: string
  juridische_duiding: string
  waarom_risico: string
  mogelijke_prijsimpact: RisicoScoreV2
  prijsimpact_toelichting: string
  mogelijke_planningsimpact: RisicoScoreV2
  planningsimpact_toelichting: string
  verificatie: string
  actie: string
  vraag_nvi_nodig: boolean
  conceptvraag_nvi: string
}

// ── Risicogebied ────────────────────────────────────────────────────────────

export interface RisicogebiedV2 {
  naam: string
  score: RisicoScoreV2
  score_toelichting: string
  risicos: RisicoItemV2[]
}

// ── Top 5's ─────────────────────────────────────────────────────────────────

export interface Top5Risico {
  titel: string
  ernstscore: RisicoScoreV2
  waarom_toprisico: string
  bron: string
  actie: string
}

export interface Top5PrijsFactor {
  factor: string
  bron: string
  status_van_onderbouwing: OnderbouwingStatus
  mogelijke_prijsimpact: RisicoScoreV2
  toelichting: string
  verificatie: string
}

export interface Top5PlanningsRisico {
  risico: string
  bron: string
  status_van_onderbouwing: OnderbouwingStatus
  mogelijke_planningsimpact: RisicoScoreV2
  toelichting: string
  actie: string
}

// ── Tegenstrijdigheid & Leemte ──────────────────────────────────────────────

export interface Tegenstrijdigheid {
  omschrijving: string
  document_1: string
  document_2: string
  risico: string
  actie: string
}

export interface Leemte {
  ontbrekende_informatie: string
  waarom_belangrijk: string
  risico_voor_inschrijver: string
  vraag_nvi: string
}

export interface NoGoFactor {
  factor: string
  bron: string
  waarom_no_go: string
  kan_worden_opgelost_door: string
}

// ── NVI-vraag ───────────────────────────────────────────────────────────────

export type NviCategorie =
  | 'juridisch' | 'financieel' | 'uitvoering' | 'planning' | 'hoeveelheden'
  | 'bodem' | 'grondwater' | 'riolering' | 'verkeer' | 'omgeving'
  | 'vergunningen' | 'veiligheid' | 'contract' | 'gunning' | 'procedure'

export interface NviVraag {
  categorie: NviCategorie
  doel: string
  bron: string
  formulering: string
  waarom_belangrijk_voor_risico: string
  waarom_belangrijk_voor_aanneemsom: string
  waarom_belangrijk_voor_planning: string
  gewenste_bevestiging_of_verduidelijking: string
}

// ── Inschrijfstrategie ──────────────────────────────────────────────────────

export interface InschrijfStrategieV2 {
  advies: InschrijfAdviesV2
  toelichting: string
  belangrijkste_voorwaarden_voor_inschrijving: string[]
  risicos_die_via_nvi_moeten_worden_opgehelderd: string[]
  risicos_die_in_prijs_of_planning_moeten_worden_verwerkt: string[]
  niet_acceptabele_risicos: string[]
  strategische_aandachtspunten: string[]
  no_go_signalen: string[]
}

// ── Locatie & Omgeving ──────────────────────────────────────────────────────

export interface LocatieOmgevingsanalyse {
  adres_of_werkgebied: string
  exacte_locatie_vastgesteld: boolean
  bron_locatie: string
  binnenstedelijk: 'Ja' | 'Nee' | 'Niet vast te stellen'
  drukke_straat_of_verkeersader: 'Ja' | 'Nee' | 'Niet vast te stellen'
  moeilijk_bereikbaar: 'Ja' | 'Nee' | 'Niet vast te stellen'
  beperkte_werkruimte: 'Ja' | 'Nee' | 'Niet vast te stellen'
  gevoelige_omgeving: 'Ja' | 'Nee' | 'Niet vast te stellen'
  contractueel_vastgestelde_locatiefeiten: string[]
  externe_verificatiepunten: string[]
  risicos_uit_locatieanalyse: string[]
  benodigde_verificaties: string[]
}

// ── Gatekeeper ──────────────────────────────────────────────────────────────

export interface GatekeeperResultaat {
  gatekeeper_status: 'approved' | 'rejected' | 'needs_revision'
  bronplicht_goedgekeurd: boolean
  aannames_goedgekeurd: boolean
  externe_bronnen_correct_gelabeld: boolean
  volledigheid_goedgekeurd: boolean
  consistentie_goedgekeurd: boolean
  json_validatie_goedgekeurd: boolean
  bevindingen: string[]
}

// ── Eindrapport (RisicoAnalyseV2Result) ─────────────────────────────────────

export interface RisicoAnalyseV2Result {
  /** Schema-versie zodat de UI de juiste renderer kan kiezen */
  schema_versie: 'v2'
  overall_score: RisicoScoreV2
  overall_toelichting: string
  inschrijfadvies: InschrijfAdviesV2
  management_samenvatting: string

  bewijs_en_aannameregel: {
    toegepast: boolean
    toelichting: string
    niet_onderbouwde_aannames_geweigerd: boolean
  }

  algemene_tenderanalyse: AlgemeneTenderanalyseV2

  document_leesplicht_bevestiging: {
    alle_aangeleverde_documenten_geanalyseerd: boolean
    toelichting: string
    ontbrekende_of_onleesbare_documenten: string[]
  }

  document_inventarisatie: DocumentInventarisatieItem[]
  locatie_en_omgevingsanalyse: LocatieOmgevingsanalyse

  top5_risicos: Top5Risico[]
  top5_prijsverhogende_risicofactoren: Top5PrijsFactor[]
  top5_planningsrisicos: Top5PlanningsRisico[]

  risicogebieden: RisicogebiedV2[]

  tegenstrijdigheden: Tegenstrijdigheid[]
  leemtes: Leemte[]
  no_go_factoren: NoGoFactor[]

  vragen_nvi: NviVraag[]
  inschrijfstrategie: InschrijfStrategieV2
  gatekeeper_resultaat: GatekeeperResultaat
}

// ── Tussenresultaten per stage ───────────────────────────────────────────────

export interface Stage1aResults {
  document_inventarisatie: DocumentInventarisatieItem[]
  ontbrekende_documenten: Array<{ document: string; waarom_verwacht: string; bron_verwijzing: string; risico: string }>
  documentrisicos: Array<{ titel: string; feit: string; bron: string; risico: string; actie: string }>
  algemene_tenderanalyse: {
    aanbestedende_dienst: { waarde: string; bron: string }
    type_aanbesteding: { waarde: string; bron: string }
    procedure: { waarde: string; bron: string }
    opdrachtomschrijving: { waarde: string; bron: string }
    contractvorm: { waarde: string; bron: string }
    gunningssystematiek: { waarde: string; bron: string }
    belangrijkste_termijnen: TenderTermijn[]
    tendercontext_risicos: Array<{ titel: string; feit: string; bron: string; risico: string }>
  }
}

export interface FeitenJson {
  feiten: Array<{
    categorie: string
    feit: string
    bron: string
    status: 'letterlijk_uit_stukken' | 'controleerbaar_impliciet' | 'ontbrekend' | 'conflicterend'
    zekerheid: RisicoScoreV2
  }>
  ontbrekende_kerninformatie: Array<{
    onderwerp: string
    reden_relevant: string
    status: string
  }>
  conflicterende_feiten: Array<{
    onderwerp: string
    bron_1: string
    bron_2: string
    conflict: string
  }>
}

export interface Stage2RisicoOutput {
  juridische_risicos?: unknown[]
  procedurele_risicos?: unknown[]
  contractuele_risicos?: unknown[]
  scope_en_eisenrisicos?: unknown[]
  hoeveelheden_en_calculatierisicos?: unknown[]
  uitvoeringsrisicos?: unknown[]
  locatie_en_omgevingsrisicos?: unknown[]
  bodem_grondwater_rioleringsrisicos?: unknown[]
  verkeer_blvc_risicos?: unknown[]
  planning_en_faseringsrisicos?: unknown[]
  financieel_commerciele_risicos?: unknown[]
}
