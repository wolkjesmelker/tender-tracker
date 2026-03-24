export interface Aanbesteding {
  id: string;
  created_at: string;
  updated_at: string;
  titel: string;
  beschrijving?: string;
  opdrachtgever?: string;
  publicatiedatum?: string;
  sluitingsdatum?: string;
  bron_url?: string;
  bron_website?: string;
  status: 'gevonden' | 'gekwalificeerd' | 'in_aanbieding' | 'afgewezen';
  pre_kwalificatie_nummer?: string;
  definitief_nummer?: string;
  ruwe_tekst?: string;
  document_urls?: string[];
  criteria_scores?: Record<string, number>;
  totaal_score?: number;
  ai_samenvatting?: string;
  highlight_data?: Record<string, string[]>;
  is_upload: boolean;
  bestandsnaam?: string;
  notities?: string;
}

export interface Criterium {
  id: string;
  naam: string;
  beschrijving?: string;
  gewicht: number;
  is_actief: boolean;
  volgorde: number;
}

export interface BronWebsite {
  id: string;
  naam: string;
  url: string;
  zoekpad?: string;
  login_url?: string;
  gebruikersnaam?: string;
  wachtwoord?: string;
  vakgebied?: string;
  is_actief: boolean;
  laatste_sync?: string;
  sync_interval_uren?: number;
}

export interface AIPrompt {
  id: string;
  naam: string;
  type: 'orchestrator' | 'agent' | 'gatekeeper';
  agent_naam?: string;
  prompt_tekst: string;
  versie: number;
  is_actief: boolean;
  beschrijving?: string;
}

export type AnalyseSessieStatus = 'nieuw' | 'analyse_bezig' | 'gereed' | 'fout';

export interface SessieMetadata {
  opdrachtgever?: string;
  sluitingsdatum?: string;
  publicatiedatum?: string;
  referentienummer?: string;
  type_opdracht?: string;
  regio?: string;
  waarde?: string;
}

export interface AnalyseSessie {
  id: string;
  naam: string;
  status: AnalyseSessieStatus;
  notities?: string;
  ai_samenvatting?: string;
  metadata?: SessieMetadata;
  criteria_scores?: Record<string, number>;
  totaal_score?: number;
  aantal_bestanden: number;
  created_at: string;
  updated_at: string;
}

export interface SessieBestand {
  id: string;
  sessie_id: string;
  naam: string;
  storage_path: string;
  mime_type?: string;
  grootte?: number;
  created_at: string;
}

export const SESSIE_STATUS_LABELS: Record<AnalyseSessieStatus, string> = {
  nieuw: 'Nieuw',
  analyse_bezig: 'Analyse bezig',
  gereed: 'Gereed',
  fout: 'Fout',
};

export const SESSIE_STATUS_COLORS: Record<AnalyseSessieStatus, string> = {
  nieuw: 'bg-slate-100 text-slate-700 border-slate-200',
  analyse_bezig: 'bg-blue-100 text-blue-700 border-blue-200',
  gereed: 'bg-green-100 text-green-700 border-green-200',
  fout: 'bg-red-100 text-red-700 border-red-200',
};

export type ScrapeJobStatus = 'wachtend' | 'bezig' | 'gereed' | 'fout';

export interface ScrapeJob {
  id: string;
  bron_id?: string;
  bron_naam: string;
  bron_url: string;
  zoekterm?: string;
  status: ScrapeJobStatus;
  resultaten?: Record<string, unknown>[];
  aantal_gevonden: number;
  fout_melding?: string;
  triggered_by: string;
  started_at?: string;
  completed_at?: string;
  created_at: string;
}

export type AanbestedingStatus = Aanbesteding['status'];

export const STATUS_LABELS: Record<AanbestedingStatus, string> = {
  gevonden: 'Gevonden',
  gekwalificeerd: 'Gekwalificeerd',
  in_aanbieding: 'In aanbieding',
  afgewezen: 'Afgewezen',
};

export const STATUS_COLORS: Record<AanbestedingStatus, string> = {
  gevonden: 'bg-blue-100 text-blue-800 border-blue-200',
  gekwalificeerd: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  in_aanbieding: 'bg-green-100 text-green-800 border-green-200',
  afgewezen: 'bg-red-100 text-red-800 border-red-200',
};
