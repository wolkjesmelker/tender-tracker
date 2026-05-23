export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      aanbestedingen: {
        Row: {
          ai_antwoorden: Json | null
          ai_extracted_fields: Json | null
          ai_samenvatting: string | null
          beschrijving: string | null
          bestandsnaam: string | null
          bijlage_analyses: Json | null
          bron_navigatie_links: Json | null
          bron_url: string | null
          bron_website_id: string | null
          bron_website_naam: string | null
          created_at: string
          criteria_scores: Json | null
          document_catalog_selected_keys: Json | null
          document_fetch_completed_at: string | null
          document_urls: Json | null
          geraamde_waarde: string | null
          id: string
          is_upload: boolean
          map_country_code: string | null
          map_geocode_at: string | null
          map_geocode_query: string | null
          map_lat: number | null
          map_lng: number | null
          match_uitleg: string | null
          notities: string | null
          opdrachtgever: string | null
          publicatiedatum: string | null
          referentienummer: string | null
          regio: string | null
          relevantie_score: number | null
          risico_analyse: Json | null
          risico_analyse_at: string | null
          ruwe_tekst: string | null
          sluitingsdatum: string | null
          status: string
          tender_procedure_context: Json | null
          titel: string
          totaal_score: number | null
          type_opdracht: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          ai_antwoorden?: Json | null
          ai_extracted_fields?: Json | null
          ai_samenvatting?: string | null
          beschrijving?: string | null
          bestandsnaam?: string | null
          bijlage_analyses?: Json | null
          bron_navigatie_links?: Json | null
          bron_url?: string | null
          bron_website_id?: string | null
          bron_website_naam?: string | null
          created_at?: string
          criteria_scores?: Json | null
          document_catalog_selected_keys?: Json | null
          document_fetch_completed_at?: string | null
          document_urls?: Json | null
          geraamde_waarde?: string | null
          id?: string
          is_upload?: boolean
          map_country_code?: string | null
          map_geocode_at?: string | null
          map_geocode_query?: string | null
          map_lat?: number | null
          map_lng?: number | null
          match_uitleg?: string | null
          notities?: string | null
          opdrachtgever?: string | null
          publicatiedatum?: string | null
          referentienummer?: string | null
          regio?: string | null
          relevantie_score?: number | null
          risico_analyse?: Json | null
          risico_analyse_at?: string | null
          ruwe_tekst?: string | null
          sluitingsdatum?: string | null
          status?: string
          tender_procedure_context?: Json | null
          titel: string
          totaal_score?: number | null
          type_opdracht?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          ai_antwoorden?: Json | null
          ai_extracted_fields?: Json | null
          ai_samenvatting?: string | null
          beschrijving?: string | null
          bestandsnaam?: string | null
          bijlage_analyses?: Json | null
          bron_navigatie_links?: Json | null
          bron_url?: string | null
          bron_website_id?: string | null
          bron_website_naam?: string | null
          created_at?: string
          criteria_scores?: Json | null
          document_catalog_selected_keys?: Json | null
          document_fetch_completed_at?: string | null
          document_urls?: Json | null
          geraamde_waarde?: string | null
          id?: string
          is_upload?: boolean
          map_country_code?: string | null
          map_geocode_at?: string | null
          map_geocode_query?: string | null
          map_lat?: number | null
          map_lng?: number | null
          match_uitleg?: string | null
          notities?: string | null
          opdrachtgever?: string | null
          publicatiedatum?: string | null
          referentienummer?: string | null
          regio?: string | null
          relevantie_score?: number | null
          risico_analyse?: Json | null
          risico_analyse_at?: string | null
          ruwe_tekst?: string | null
          sluitingsdatum?: string | null
          status?: string
          tender_procedure_context?: Json | null
          titel?: string
          totaal_score?: number | null
          type_opdracht?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "aanbestedingen_bron_website_id_fkey"
            columns: ["bron_website_id"]
            isOneToOne: false
            referencedRelation: "bron_websites"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_conversations: {
        Row: {
          content: string
          created_at: string
          id: string
          metadata_json: Json | null
          role: string
          tender_id: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          metadata_json?: Json | null
          role: string
          tender_id?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          metadata_json?: Json | null
          role?: string
          tender_id?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      agent_document_checklists: {
        Row: {
          created_at: string
          document_naam: string
          done: boolean
          done_at: string | null
          hint: string | null
          id: string
          item_id: string
          item_order: number
          label: string
          source_quote: string | null
          tender_id: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          document_naam: string
          done?: boolean
          done_at?: string | null
          hint?: string | null
          id?: string
          item_id: string
          item_order?: number
          label: string
          source_quote?: string | null
          tender_id: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          document_naam?: string
          done?: boolean
          done_at?: string | null
          hint?: string | null
          id?: string
          item_id?: string
          item_order?: number
          label?: string
          source_quote?: string | null
          tender_id?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      agent_document_fills: {
        Row: {
          confidence: number | null
          contradiction_detail: string | null
          contradiction_flag: boolean
          document_naam: string
          field_description: string | null
          field_group: string | null
          field_id: string
          field_label: string | null
          field_options_json: Json | null
          field_order: number
          field_required: boolean
          field_type: string | null
          id: string
          source: string
          source_quote: string | null
          status: string
          tender_id: string
          updated_at: string
          user_id: string | null
          user_touched: boolean
          value_text: string | null
        }
        Insert: {
          confidence?: number | null
          contradiction_detail?: string | null
          contradiction_flag?: boolean
          document_naam: string
          field_description?: string | null
          field_group?: string | null
          field_id: string
          field_label?: string | null
          field_options_json?: Json | null
          field_order?: number
          field_required?: boolean
          field_type?: string | null
          id?: string
          source?: string
          source_quote?: string | null
          status?: string
          tender_id: string
          updated_at?: string
          user_id?: string | null
          user_touched?: boolean
          value_text?: string | null
        }
        Update: {
          confidence?: number | null
          contradiction_detail?: string | null
          contradiction_flag?: boolean
          document_naam?: string
          field_description?: string | null
          field_group?: string | null
          field_id?: string
          field_label?: string | null
          field_options_json?: Json | null
          field_order?: number
          field_required?: boolean
          field_type?: string | null
          id?: string
          source?: string
          source_quote?: string | null
          status?: string
          tender_id?: string
          updated_at?: string
          user_id?: string | null
          user_touched?: boolean
          value_text?: string | null
        }
        Relationships: []
      }
      agent_learning_entries: {
        Row: {
          created_at: string
          document_type_hint: string
          field_key: string
          field_label: string | null
          id: string
          last_used_at: string
          preferred_answer: string
          question_pattern: string | null
          source_tender_id: string | null
          updated_at: string
          use_count: number
          user_id: string | null
        }
        Insert: {
          created_at?: string
          document_type_hint: string
          field_key: string
          field_label?: string | null
          id?: string
          last_used_at?: string
          preferred_answer: string
          question_pattern?: string | null
          source_tender_id?: string | null
          updated_at?: string
          use_count?: number
          user_id?: string | null
        }
        Update: {
          created_at?: string
          document_type_hint?: string
          field_key?: string
          field_label?: string | null
          id?: string
          last_used_at?: string
          preferred_answer?: string
          question_pattern?: string | null
          source_tender_id?: string | null
          updated_at?: string
          use_count?: number
          user_id?: string | null
        }
        Relationships: []
      }
      agent_pinned_notes: {
        Row: {
          created_at: string
          entry_kind: string
          id: string
          is_manual_search: boolean
          source_query: string | null
          source_url: string | null
          summary: string
          tender_id: string
          text_export_filename: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          entry_kind?: string
          id?: string
          is_manual_search?: boolean
          source_query?: string | null
          source_url?: string | null
          summary: string
          tender_id: string
          text_export_filename?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          entry_kind?: string
          id?: string
          is_manual_search?: boolean
          source_query?: string | null
          source_url?: string | null
          summary?: string
          tender_id?: string
          text_export_filename?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      ai_prompts: {
        Row: {
          agent_naam: string | null
          beschrijving: string | null
          created_at: string
          id: string
          is_actief: boolean
          naam: string
          prompt_tekst: string
          type: string
          updated_at: string
          user_id: string | null
          versie: number
        }
        Insert: {
          agent_naam?: string | null
          beschrijving?: string | null
          created_at?: string
          id?: string
          is_actief?: boolean
          naam: string
          prompt_tekst: string
          type: string
          updated_at?: string
          user_id?: string | null
          versie?: number
        }
        Update: {
          agent_naam?: string | null
          beschrijving?: string | null
          created_at?: string
          id?: string
          is_actief?: boolean
          naam?: string
          prompt_tekst?: string
          type?: string
          updated_at?: string
          user_id?: string | null
          versie?: number
        }
        Relationships: []
      }
      ai_vragen: {
        Row: {
          categorie: string | null
          created_at: string
          id: string
          is_actief: boolean
          is_standaard: boolean
          updated_at: string
          user_id: string | null
          volgorde: number
          vraag: string
        }
        Insert: {
          categorie?: string | null
          created_at?: string
          id?: string
          is_actief?: boolean
          is_standaard?: boolean
          updated_at?: string
          user_id?: string | null
          volgorde?: number
          vraag: string
        }
        Update: {
          categorie?: string | null
          created_at?: string
          id?: string
          is_actief?: boolean
          is_standaard?: boolean
          updated_at?: string
          user_id?: string | null
          volgorde?: number
          vraag?: string
        }
        Relationships: []
      }
      bedrijfsprofielen: {
        Row: {
          adres: string | null
          btw: string | null
          contactpersoon: string | null
          created_at: string
          email: string | null
          extra_velden: Json | null
          functie_contactpersoon: string | null
          iban: string | null
          id: string
          is_standaard: boolean
          kvk: string | null
          land: string | null
          naam: string
          postcode: string | null
          rechtsvorm: string | null
          stad: string | null
          telefoon: string | null
          updated_at: string
          user_id: string | null
          website: string | null
        }
        Insert: {
          adres?: string | null
          btw?: string | null
          contactpersoon?: string | null
          created_at?: string
          email?: string | null
          extra_velden?: Json | null
          functie_contactpersoon?: string | null
          iban?: string | null
          id?: string
          is_standaard?: boolean
          kvk?: string | null
          land?: string | null
          naam: string
          postcode?: string | null
          rechtsvorm?: string | null
          stad?: string | null
          telefoon?: string | null
          updated_at?: string
          user_id?: string | null
          website?: string | null
        }
        Update: {
          adres?: string | null
          btw?: string | null
          contactpersoon?: string | null
          created_at?: string
          email?: string | null
          extra_velden?: Json | null
          functie_contactpersoon?: string | null
          iban?: string | null
          id?: string
          is_standaard?: boolean
          kvk?: string | null
          land?: string | null
          naam?: string
          postcode?: string | null
          rechtsvorm?: string | null
          stad?: string | null
          telefoon?: string | null
          updated_at?: string
          user_id?: string | null
          website?: string | null
        }
        Relationships: []
      }
      bron_websites: {
        Row: {
          auth_type: string | null
          created_at: string
          id: string
          is_actief: boolean
          laatste_sync: string | null
          login_url: string | null
          naam: string
          sync_interval_uren: number | null
          updated_at: string
          url: string
          user_id: string | null
          vakgebied: string | null
          zoekpad: string | null
        }
        Insert: {
          auth_type?: string | null
          created_at?: string
          id: string
          is_actief?: boolean
          laatste_sync?: string | null
          login_url?: string | null
          naam: string
          sync_interval_uren?: number | null
          updated_at?: string
          url: string
          user_id?: string | null
          vakgebied?: string | null
          zoekpad?: string | null
        }
        Update: {
          auth_type?: string | null
          created_at?: string
          id?: string
          is_actief?: boolean
          laatste_sync?: string | null
          login_url?: string | null
          naam?: string
          sync_interval_uren?: number | null
          updated_at?: string
          url?: string
          user_id?: string | null
          vakgebied?: string | null
          zoekpad?: string | null
        }
        Relationships: []
      }
      criteria: {
        Row: {
          beschrijving: string | null
          created_at: string
          gewicht: number
          id: string
          is_actief: boolean
          naam: string
          updated_at: string
          user_id: string | null
          volgorde: number
        }
        Insert: {
          beschrijving?: string | null
          created_at?: string
          gewicht?: number
          id?: string
          is_actief?: boolean
          naam: string
          updated_at?: string
          user_id?: string | null
          volgorde?: number
        }
        Update: {
          beschrijving?: string | null
          created_at?: string
          gewicht?: number
          id?: string
          is_actief?: boolean
          naam?: string
          updated_at?: string
          user_id?: string | null
          volgorde?: number
        }
        Relationships: []
      }
      scrape_jobs: {
        Row: {
          aantal_gevonden: number
          bron_naam: string
          bron_url: string
          bron_website_id: string | null
          completed_at: string | null
          created_at: string
          fout_melding: string | null
          id: string
          resultaten: Json | null
          started_at: string | null
          status: string
          triggered_by: string
          updated_at: string
          user_id: string | null
          zoekterm: string | null
        }
        Insert: {
          aantal_gevonden?: number
          bron_naam: string
          bron_url: string
          bron_website_id?: string | null
          completed_at?: string | null
          created_at?: string
          fout_melding?: string | null
          id?: string
          resultaten?: Json | null
          started_at?: string | null
          status?: string
          triggered_by?: string
          updated_at?: string
          user_id?: string | null
          zoekterm?: string | null
        }
        Update: {
          aantal_gevonden?: number
          bron_naam?: string
          bron_url?: string
          bron_website_id?: string | null
          completed_at?: string | null
          created_at?: string
          fout_melding?: string | null
          id?: string
          resultaten?: Json | null
          started_at?: string | null
          status?: string
          triggered_by?: string
          updated_at?: string
          user_id?: string | null
          zoekterm?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "scrape_jobs_bron_website_id_fkey"
            columns: ["bron_website_id"]
            isOneToOne: false
            referencedRelation: "bron_websites"
            referencedColumns: ["id"]
          },
        ]
      }
      scrape_schema: {
        Row: {
          bron_website_ids: Json
          created_at: string
          cron_expressie: string
          id: string
          is_actief: boolean
          laatste_run: string | null
          naam: string
          updated_at: string
          user_id: string | null
          volgende_run: string | null
          zoektermen: Json | null
        }
        Insert: {
          bron_website_ids: Json
          created_at?: string
          cron_expressie: string
          id?: string
          is_actief?: boolean
          laatste_run?: string | null
          naam: string
          updated_at?: string
          user_id?: string | null
          volgende_run?: string | null
          zoektermen?: Json | null
        }
        Update: {
          bron_website_ids?: Json
          created_at?: string
          cron_expressie?: string
          id?: string
          is_actief?: boolean
          laatste_run?: string | null
          naam?: string
          updated_at?: string
          user_id?: string | null
          volgende_run?: string | null
          zoektermen?: Json | null
        }
        Relationships: []
      }
      zoektermen: {
        Row: {
          categorie: string | null
          created_at: string
          id: string
          is_actief: boolean
          term: string
          updated_at: string
          user_id: string | null
          volgorde: number
        }
        Insert: {
          categorie?: string | null
          created_at?: string
          id?: string
          is_actief?: boolean
          term: string
          updated_at?: string
          user_id?: string | null
          volgorde?: number
        }
        Update: {
          categorie?: string | null
          created_at?: string
          id?: string
          is_actief?: boolean
          term?: string
          updated_at?: string
          user_id?: string | null
          volgorde?: number
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
