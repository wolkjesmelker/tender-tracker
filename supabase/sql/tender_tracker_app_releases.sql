-- TenderTracker: centrale versierollout (welke GitHub-release gebruikers mogen installeren).
-- Voer dit uit in de Supabase SQL Editor voor het project dat de TenderTracker-app gebruikt.

CREATE TABLE IF NOT EXISTS tender_tracker_app_releases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('draft', 'live', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  launched_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_tender_tracker_app_releases_status ON tender_tracker_app_releases (status);
CREATE INDEX IF NOT EXISTS idx_tender_tracker_app_releases_created ON tender_tracker_app_releases (created_at DESC);

ALTER TABLE tender_tracker_app_releases ENABLE ROW LEVEL SECURITY;

-- De desktop-app gebruikt de anon-key: lezen voor alle clients, schrijven voor beheer (interne omgeving).
-- Strakker maken: verplaats writes naar een Edge Function met secret, of gebruik een aparte service-role alleen op het beheerstation.
CREATE POLICY "tender_tracker_app_releases_select_anon"
  ON tender_tracker_app_releases FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "tender_tracker_app_releases_insert_anon"
  ON tender_tracker_app_releases FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "tender_tracker_app_releases_update_anon"
  ON tender_tracker_app_releases FOR UPDATE
  TO anon
  USING (true);

CREATE POLICY "tender_tracker_app_releases_delete_anon"
  ON tender_tracker_app_releases FOR DELETE
  TO anon
  USING (true);
