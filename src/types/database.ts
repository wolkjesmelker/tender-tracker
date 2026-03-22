export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      aanbestedingen: {
        Row: {
          ai_samenvatting: string | null
          beschrijving: string | null
          bestandsnaam: string | null
          bron_url: string | null
          bron_website: string | null
          created_at: string
          criteria_scores: Json | null
          definitief_nummer: string | null
          document_urls: string[] | null
          highlight_data: Json | null
          id: string
          is_upload: boolean
          notities: string | null
          opdrachtgever: string | null
          pre_kwalificatie_nummer: string | null
          publicatiedatum: string | null
          ruwe_tekst: string | null
          sluitingsdatum: string | null
          status: string
          titel: string
          totaal_score: number | null
          updated_at: string
        }
        Insert: {
          ai_samenvatting?: string | null
          beschrijving?: string | null
          bestandsnaam?: string | null
          bron_url?: string | null
          bron_website?: string | null
          created_at?: string
          criteria_scores?: Json | null
          definitief_nummer?: string | null
          document_urls?: string[] | null
          highlight_data?: Json | null
          id?: string
          is_upload?: boolean
          notities?: string | null
          opdrachtgever?: string | null
          pre_kwalificatie_nummer?: string | null
          publicatiedatum?: string | null
          ruwe_tekst?: string | null
          sluitingsdatum?: string | null
          status?: string
          titel: string
          totaal_score?: number | null
          updated_at?: string
        }
        Update: {
          ai_samenvatting?: string | null
          beschrijving?: string | null
          bestandsnaam?: string | null
          bron_url?: string | null
          bron_website?: string | null
          created_at?: string
          criteria_scores?: Json | null
          definitief_nummer?: string | null
          document_urls?: string[] | null
          highlight_data?: Json | null
          id?: string
          is_upload?: boolean
          notities?: string | null
          opdrachtgever?: string | null
          pre_kwalificatie_nummer?: string | null
          publicatiedatum?: string | null
          ruwe_tekst?: string | null
          sluitingsdatum?: string | null
          status?: string
          titel?: string
          totaal_score?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      analyse_sessies: {
        Row: {
          id: string
          naam: string
          status: string
          notities: string | null
          ai_samenvatting: string | null
          metadata: Json | null
          criteria_scores: Json | null
          totaal_score: number | null
          aantal_bestanden: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          naam: string
          status?: string
          notities?: string | null
          ai_samenvatting?: string | null
          metadata?: Json | null
          criteria_scores?: Json | null
          totaal_score?: number | null
          aantal_bestanden?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          naam?: string
          status?: string
          notities?: string | null
          ai_samenvatting?: string | null
          metadata?: Json | null
          criteria_scores?: Json | null
          totaal_score?: number | null
          aantal_bestanden?: number
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      sessie_bestanden: {
        Row: {
          id: string
          sessie_id: string
          naam: string
          storage_path: string
          mime_type: string | null
          grootte: number | null
          created_at: string
        }
        Insert: {
          id?: string
          sessie_id: string
          naam: string
          storage_path: string
          mime_type?: string | null
          grootte?: number | null
          created_at?: string
        }
        Update: {
          id?: string
          sessie_id?: string
          naam?: string
          storage_path?: string
          mime_type?: string | null
          grootte?: number | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sessie_bestanden_sessie_id_fkey"
            columns: ["sessie_id"]
            referencedRelation: "analyse_sessies"
            referencedColumns: ["id"]
          }
        ]
      }
      ai_prompts: {
        Row: {
          agent_naam: string | null
          beschrijving: string | null
          id: string
          is_actief: boolean
          naam: string
          prompt_tekst: string
          type: string
          versie: number
        }
        Insert: {
          agent_naam?: string | null
          beschrijving?: string | null
          id?: string
          is_actief?: boolean
          naam: string
          prompt_tekst: string
          type: string
          versie?: number
        }
        Update: {
          agent_naam?: string | null
          beschrijving?: string | null
          id?: string
          is_actief?: boolean
          naam?: string
          prompt_tekst?: string
          type?: string
          versie?: number
        }
        Relationships: []
      }
      bron_websites: {
        Row: {
          gebruikersnaam: string | null
          id: string
          is_actief: boolean
          laatste_sync: string | null
          login_url: string | null
          naam: string
          sync_interval_uren: number | null
          url: string
          vakgebied: string | null
          wachtwoord: string | null
          zoekpad: string | null
        }
        Insert: {
          gebruikersnaam?: string | null
          id?: string
          is_actief?: boolean
          laatste_sync?: string | null
          login_url?: string | null
          naam: string
          sync_interval_uren?: number | null
          url: string
          vakgebied?: string | null
          wachtwoord?: string | null
          zoekpad?: string | null
        }
        Update: {
          gebruikersnaam?: string | null
          id?: string
          is_actief?: boolean
          laatste_sync?: string | null
          login_url?: string | null
          naam?: string
          sync_interval_uren?: number | null
          url?: string
          vakgebied?: string | null
          wachtwoord?: string | null
          zoekpad?: string | null
        }
        Relationships: []
      }
      criteria: {
        Row: {
          beschrijving: string | null
          gewicht: number
          id: string
          is_actief: boolean
          naam: string
          volgorde: number
        }
        Insert: {
          beschrijving?: string | null
          gewicht?: number
          id?: string
          is_actief?: boolean
          naam: string
          volgorde?: number
        }
        Update: {
          beschrijving?: string | null
          gewicht?: number
          id?: string
          is_actief?: boolean
          naam?: string
          volgorde?: number
        }
        Relationships: []
      }
    }
    Views: { [_ in never]: never }
    Functions: { [_ in never]: never }
    Enums: { [_ in never]: never }
    CompositeTypes: { [_ in never]: never }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">
type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<T extends keyof DefaultSchema["Tables"]> =
  DefaultSchema["Tables"][T]["Row"]

export type TablesInsert<T extends keyof DefaultSchema["Tables"]> =
  DefaultSchema["Tables"][T]["Insert"]

export type TablesUpdate<T extends keyof DefaultSchema["Tables"]> =
  DefaultSchema["Tables"][T]["Update"]
