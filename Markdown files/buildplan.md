// Alle TypeScript types voor de applicatie

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