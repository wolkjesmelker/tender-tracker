import Database from 'better-sqlite3'
import { app } from 'electron'
import path from 'path'
import fs from 'fs'
import log from 'electron-log'
import {
  APP_SETTING_RISICO_PROMPT_EXTRACTIE,
  APP_SETTING_RISICO_PROMPT_HOOFD,
  DEFAULT_SEARCH_TERMS,
  DEFAULT_CRITERIA,
  DEFAULT_AI_QUESTIONS,
} from '../../shared/constants'
import { DEFAULT_RISICO_EXTRACTIE_PROMPT, DEFAULT_RISICO_HOOFD_PROMPT } from '../ai/risico-prompt-defaults'

let db: Database.Database | null = null

function getDbPath(): string {
  return path.join(app.getPath('userData'), 'tender-tracker.db')
}

/** Pad naar SQLite-db (o.a. interne diagnose). */
export function getDatabaseFilePath(): string {
  return getDbPath()
}

export function getDb(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.')
  }
  return db
}

export function initDatabase(): void {
  const dbPath = getDbPath()
  log.info(`Database path: ${dbPath}`)

  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  runMigrations(db)
  seedDefaults(db)

  // Reset any scrape jobs that were left in 'bezig' state (e.g. after a crash/restart).
  // Jobs older than 15 minutes that are still 'bezig' will never complete.
  const staleReset = db.prepare(`
    UPDATE scrape_jobs
    SET status = 'fout',
        fout_melding = 'Onderbroken (app herstart of crash)',
        completed_at = datetime('now')
    WHERE status = 'bezig'
      AND started_at < datetime('now', '-15 minutes')
  `).run()
  if (staleReset.changes > 0) {
    log.info(`DB init: ${staleReset.changes} vastgelopen scrape-job(s) gereset naar 'fout'`)
  }
}

function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)

  const currentVersion = db.prepare('SELECT MAX(version) as v FROM schema_version').get() as { v: number | null }
  const version = currentVersion?.v ?? 0

  if (version < 1) {
    db.exec(migration_v1)
    db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(1)
    log.info('Applied migration v1')
  }

  if (version < 2) {
    const belgiumUrl = 'https://www.publicprocurement.be/supplier/enterprises/0/enterprises/overview'
    const belgiumLogin = 'https://www.publicprocurement.be/'
    const r = db.prepare(`UPDATE bron_websites SET url = ?, login_url = ?, auth_type = 'form', updated_at = datetime('now') WHERE id = 'belgium'`).run(belgiumUrl, belgiumLogin)
    if (r.changes > 0) {
      log.info('Migration v2: België-bron bijgewerkt naar BOSA eProcurement (inlog vereist)')
    }
    db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(2)
    log.info('Applied migration v2')
  }

  if (version < 3) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS analysis_checkpoint (
        aanbesteding_id TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `)
    db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(3)
    log.info('Applied migration v3: analysis_checkpoint')
  }

  if (version < 4) {
    try {
      db.exec(`ALTER TABLE aanbestedingen ADD COLUMN bijlage_analyses TEXT`)
      log.info('Applied migration v4: bijlage_analyses column')
    } catch (e: unknown) {
      log.warn('Migration v4: bijlage_analyses column may already exist', e)
    }
    db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(4)
  }

  if (version < 5) {
    try {
      db.exec(`ALTER TABLE aanbestedingen ADD COLUMN bron_navigatie_links TEXT`)
      log.info('Applied migration v5: bron_navigatie_links')
    } catch (e: unknown) {
      log.warn('Migration v5: bron_navigatie_links may already exist', e)
    }
    try {
      db.exec(`ALTER TABLE aanbestedingen ADD COLUMN ai_extracted_fields TEXT`)
      log.info('Applied migration v5: ai_extracted_fields')
    } catch (e: unknown) {
      log.warn('Migration v5: ai_extracted_fields may already exist', e)
    }
    db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(5)
    log.info('Applied migration v5 complete')
  }

  if (version < 6) {
    try {
      db.exec(`ALTER TABLE aanbestedingen ADD COLUMN tender_procedure_context TEXT`)
      log.info('Applied migration v6: tender_procedure_context')
    } catch (e: unknown) {
      log.warn('Migration v6: tender_procedure_context may already exist', e)
    }
    db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(6)
    log.info('Applied migration v6 complete')
  }

  if (version < 7) {
    const ins = db.prepare('INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)')
    ins.run('kimi_cli_path', '')
    ins.run('kimi_cli_max_steps', '48')
    db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(7)
    log.info('Applied migration v7: kimi_cli settings keys')
  }

  if (version < 8) {
    try {
      db.exec(`ALTER TABLE aanbestedingen ADD COLUMN risico_analyse TEXT`)
      log.info('Applied migration v8: risico_analyse column')
    } catch (e: unknown) {
      log.warn('Migration v8: risico_analyse may already exist', e)
    }
    try {
      db.exec(`ALTER TABLE aanbestedingen ADD COLUMN risico_analyse_at TEXT`)
      log.info('Applied migration v8: risico_analyse_at column')
    } catch (e: unknown) {
      log.warn('Migration v8: risico_analyse_at may already exist', e)
    }
    db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(8)
    log.info('Applied migration v8 complete')
  }

  if (version < 9) {
    const ins = db.prepare('INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)')
    ins.run('moonshot_api_key', '')
    db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(9)
    log.info('Applied migration v9: moonshot_api_key setting')
  }

  if (version < 10) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS ai_token_usage (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_ai_token_usage_created_at ON ai_token_usage (created_at);
    `)
    db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(10)
    log.info('Applied migration v10: ai_token_usage table')
  }

  if (version < 11) {
    const ins = db.prepare('INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)')
    ins.run('cloud_sync_path', '')
    ins.run('cloud_sync_enabled', '0')
    db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(11)
    log.info('Applied migration v11: cloud sync settings keys')
  }

  if (version < 12) {
    // Mercell is overgestapt naar app.mercell.com als unified platform.
    // De scraper zoekt al op app.mercell.com; de login-URL bijwerken zodat
    // het auth-venster op dezelfde URL uitkomt als de scraper en cookies deelt.
    const r = db.prepare(`
      UPDATE bron_websites
      SET url = 'https://app.mercell.com',
          login_url = 'https://app.mercell.com',
          updated_at = datetime('now')
      WHERE id = 'mercell'
    `).run()
    if (r.changes > 0) {
      log.info('Migration v12: Mercell URL bijgewerkt naar app.mercell.com')
    }
    db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(12)
    log.info('Applied migration v12')
  }

  if (version < 13) {
    // Het echte Mercell S2C-platform staat op s2c.mercell.com.
    // De login-URL is identity.s2c.mercell.com; na login land je op s2c.mercell.com.
    const r = db.prepare(`
      UPDATE bron_websites
      SET url = 'https://s2c.mercell.com',
          login_url = 'https://s2c.mercell.com',
          updated_at = datetime('now')
      WHERE id = 'mercell'
    `).run()
    if (r.changes > 0) {
      log.info('Migration v13: Mercell URL gecorrigeerd naar s2c.mercell.com')
    }
    db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(13)
    log.info('Applied migration v13')
  }

  if (version < 14) {
    try {
      db.exec(`ALTER TABLE aanbestedingen ADD COLUMN document_fetch_completed_at TEXT`)
      log.info('Applied migration v14: document_fetch_completed_at')
    } catch (e: unknown) {
      log.warn('Migration v14: document_fetch_completed_at may already exist', e)
    }
    try {
      const rows = db.prepare('SELECT id, document_urls FROM aanbestedingen').all() as {
        id: string
        document_urls: string | null
      }[]
      const mark = db.prepare(
        `UPDATE aanbestedingen SET document_fetch_completed_at = COALESCE(updated_at, created_at) WHERE id = ?`,
      )
      let backfilled = 0
      for (const r of rows) {
        if (!r.document_urls?.trim()) continue
        try {
          const arr = JSON.parse(r.document_urls) as unknown
          if (Array.isArray(arr) && arr.length > 0) {
            mark.run(r.id)
            backfilled++
          }
        } catch {
          /* skip */
        }
      }
      if (backfilled > 0) {
        log.info(`Migration v14: document_fetch_completed_at backfill voor ${backfilled} rij(en) met documenten`)
      }
    } catch (e: unknown) {
      log.warn('Migration v14: backfill mislukt', e)
    }
    db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(14)
    log.info('Applied migration v14 complete')
  }

  if (version < 15) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS agent_conversations (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        tender_id TEXT,
        role TEXT NOT NULL CHECK(role IN ('system','user','assistant','tool')),
        content TEXT NOT NULL,
        metadata_json TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_agent_conv_tender ON agent_conversations(tender_id, created_at);

      CREATE TABLE IF NOT EXISTS agent_document_fills (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        tender_id TEXT NOT NULL,
        document_naam TEXT NOT NULL,
        field_id TEXT NOT NULL,
        field_label TEXT,
        field_type TEXT,
        field_options_json TEXT,
        field_required INTEGER NOT NULL DEFAULT 0,
        field_description TEXT,
        field_order INTEGER NOT NULL DEFAULT 0,
        field_group TEXT,
        value_text TEXT,
        status TEXT NOT NULL DEFAULT 'empty'
          CHECK(status IN ('empty','proposed','partial','filled','approved')),
        source TEXT NOT NULL DEFAULT 'ai'
          CHECK(source IN ('ai','user','learning')),
        confidence REAL,
        contradiction_flag INTEGER NOT NULL DEFAULT 0,
        contradiction_detail TEXT,
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(tender_id, document_naam, field_id)
      );
      CREATE INDEX IF NOT EXISTS idx_agent_fills_tender ON agent_document_fills(tender_id, document_naam);

      CREATE TABLE IF NOT EXISTS agent_learning_entries (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        document_type_hint TEXT NOT NULL,
        field_key TEXT NOT NULL,
        field_label TEXT,
        question_pattern TEXT,
        preferred_answer TEXT NOT NULL,
        source_tender_id TEXT,
        use_count INTEGER NOT NULL DEFAULT 1,
        last_used_at TEXT NOT NULL DEFAULT (datetime('now')),
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_agent_learn_key
        ON agent_learning_entries(document_type_hint, field_key, use_count);

      CREATE TABLE IF NOT EXISTS agent_pinned_notes (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        tender_id TEXT NOT NULL,
        source_url TEXT,
        source_query TEXT,
        summary TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_agent_pinned_tender ON agent_pinned_notes(tender_id, created_at);
    `)
    const ins = db.prepare('INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)')
    ins.run('brave_search_api_key', '')
    ins.run('agent_enabled', '1')
    db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(15)
    log.info('Applied migration v15: agent tables + settings')
  }

  if (version < 16) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS bedrijfsprofielen (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        naam TEXT NOT NULL,
        rechtsvorm TEXT,
        kvk TEXT,
        btw TEXT,
        iban TEXT,
        adres TEXT,
        postcode TEXT,
        stad TEXT,
        land TEXT DEFAULT 'Nederland',
        email TEXT,
        telefoon TEXT,
        website TEXT,
        contactpersoon TEXT,
        functie_contactpersoon TEXT,
        is_standaard INTEGER NOT NULL DEFAULT 0,
        extra_velden TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `)
    db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(16)
    log.info('Applied migration v16: bedrijfsprofielen table')
  }

  if (version < 17) {
    // Hernoem bestaande kimi-k2.5 token-records naar kimi-k2.6 zodat
    // het verbruiksoverzicht consistent de nieuwe modelnaam toont.
    const result = db
      .prepare(
        `UPDATE ai_token_usage SET model = REPLACE(model, 'kimi-k2.5', 'kimi-k2.6')
         WHERE model LIKE '%kimi-k2.5%'`
      )
      .run()
    db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(17)
    log.info(`Applied migration v17: kimi-k2.5 → kimi-k2.6 in ai_token_usage (${result.changes} rijen bijgewerkt)`)
  }
}

const migration_v1 = `
  CREATE TABLE IF NOT EXISTS bron_websites (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    naam TEXT NOT NULL,
    url TEXT NOT NULL,
    zoekpad TEXT,
    login_url TEXT,
    auth_type TEXT DEFAULT 'none',
    encrypted_credentials BLOB,
    vakgebied TEXT DEFAULT 'Infrastructuur',
    is_actief INTEGER NOT NULL DEFAULT 1,
    laatste_sync TEXT,
    sync_interval_uren INTEGER DEFAULT 12,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS zoektermen (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    term TEXT NOT NULL,
    categorie TEXT,
    is_actief INTEGER NOT NULL DEFAULT 1,
    volgorde INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS aanbestedingen (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    titel TEXT NOT NULL,
    beschrijving TEXT,
    opdrachtgever TEXT,
    publicatiedatum TEXT,
    sluitingsdatum TEXT,
    bron_url TEXT,
    bron_website_id TEXT REFERENCES bron_websites(id),
    bron_website_naam TEXT,
    status TEXT NOT NULL DEFAULT 'gevonden'
      CHECK(status IN ('gevonden','gekwalificeerd','in_aanbieding','afgewezen','gearchiveerd')),
    referentienummer TEXT,
    type_opdracht TEXT,
    regio TEXT,
    geraamde_waarde TEXT,
    ruwe_tekst TEXT,
    document_urls TEXT,
    ai_samenvatting TEXT,
    ai_antwoorden TEXT,
    criteria_scores TEXT,
    totaal_score REAL,
    match_uitleg TEXT,
    relevantie_score REAL,
    is_upload INTEGER NOT NULL DEFAULT 0,
    bestandsnaam TEXT,
    notities TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS criteria (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    naam TEXT NOT NULL,
    beschrijving TEXT,
    gewicht REAL NOT NULL DEFAULT 10,
    is_actief INTEGER NOT NULL DEFAULT 1,
    volgorde INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS ai_vragen (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    vraag TEXT NOT NULL,
    categorie TEXT,
    is_standaard INTEGER NOT NULL DEFAULT 0,
    is_actief INTEGER NOT NULL DEFAULT 1,
    volgorde INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS ai_prompts (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    naam TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('orchestrator','agent','gatekeeper','scorer')),
    agent_naam TEXT,
    prompt_tekst TEXT NOT NULL,
    versie INTEGER NOT NULL DEFAULT 1,
    is_actief INTEGER NOT NULL DEFAULT 1,
    beschrijving TEXT
  );

  CREATE TABLE IF NOT EXISTS scrape_jobs (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    bron_website_id TEXT REFERENCES bron_websites(id),
    bron_naam TEXT NOT NULL,
    bron_url TEXT NOT NULL,
    zoekterm TEXT,
    status TEXT NOT NULL DEFAULT 'wachtend'
      CHECK(status IN ('wachtend','bezig','gereed','fout')),
    resultaten TEXT,
    aantal_gevonden INTEGER NOT NULL DEFAULT 0,
    fout_melding TEXT,
    triggered_by TEXT NOT NULL DEFAULT 'manual',
    started_at TEXT,
    completed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS scrape_schema (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    naam TEXT NOT NULL,
    cron_expressie TEXT NOT NULL,
    bron_website_ids TEXT NOT NULL,
    zoektermen TEXT,
    is_actief INTEGER NOT NULL DEFAULT 1,
    laatste_run TEXT,
    volgende_run TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_aanbestedingen_status ON aanbestedingen(status);
  CREATE INDEX IF NOT EXISTS idx_aanbestedingen_sluitingsdatum ON aanbestedingen(sluitingsdatum);
  CREATE INDEX IF NOT EXISTS idx_aanbestedingen_bron ON aanbestedingen(bron_website_id);
  CREATE INDEX IF NOT EXISTS idx_scrape_jobs_status ON scrape_jobs(status);
`

function seedDefaults(db: Database.Database): void {
  // Seed default sources
  const sourceCount = (db.prepare('SELECT COUNT(*) as c FROM bron_websites').get() as { c: number }).c
  if (sourceCount === 0) {
    const insertSource = db.prepare(
      'INSERT INTO bron_websites (id, naam, url, login_url, auth_type, vakgebied) VALUES (?, ?, ?, ?, ?, ?)'
    )
    insertSource.run('tenderned', 'TenderNed', 'https://www.tenderned.nl/aankondigingen/overzicht/aankondigingenplatform', 'https://www.tenderned.nl/aanmelden', 'openid_connect', 'Infrastructuur')
    insertSource.run('mercell', 'Mercell (Negometrix)', 'https://s2c.mercell.com/', 'https://identity.s2c.mercell.com/Account/Login', 'form', 'Infrastructuur')
    insertSource.run(
      'belgium',
      'E-procurement België (BOSA)',
      'https://www.publicprocurement.be/supplier/enterprises/0/enterprises/overview',
      'https://www.publicprocurement.be/',
      'form',
      'Infrastructuur'
    )
    log.info('Seeded default sources')
  }

  // Seed default search terms
  const termCount = (db.prepare('SELECT COUNT(*) as c FROM zoektermen').get() as { c: number }).c
  if (termCount === 0) {
    const insertTerm = db.prepare('INSERT INTO zoektermen (term, categorie, volgorde) VALUES (?, ?, ?)')
    DEFAULT_SEARCH_TERMS.forEach((t, i) => insertTerm.run(t.term, t.categorie, i))
    log.info('Seeded default search terms')
  }

  // Seed default criteria
  const criteriaCount = (db.prepare('SELECT COUNT(*) as c FROM criteria').get() as { c: number }).c
  if (criteriaCount === 0) {
    const insertCrit = db.prepare('INSERT INTO criteria (naam, beschrijving, gewicht, volgorde) VALUES (?, ?, ?, ?)')
    DEFAULT_CRITERIA.forEach((c, i) => insertCrit.run(c.naam, c.beschrijving, c.gewicht, i))
    log.info('Seeded default criteria')
  }

  // Seed default AI questions
  const questionCount = (db.prepare('SELECT COUNT(*) as c FROM ai_vragen').get() as { c: number }).c
  if (questionCount === 0) {
    const insertQ = db.prepare('INSERT INTO ai_vragen (vraag, categorie, is_standaard, volgorde) VALUES (?, ?, 1, ?)')
    DEFAULT_AI_QUESTIONS.forEach((q, i) => insertQ.run(q.vraag, q.categorie, i))
    log.info('Seeded default AI questions')
  }

  // Seed default AI prompts
  const promptCount = (db.prepare('SELECT COUNT(*) as c FROM ai_prompts').get() as { c: number }).c
  if (promptCount === 0) {
    const insertPrompt = db.prepare(
      'INSERT INTO ai_prompts (naam, type, prompt_tekst, beschrijving) VALUES (?, ?, ?, ?)'
    )
    insertPrompt.run('Aanbestedings-analyzer', 'agent', DEFAULT_AGENT_PROMPT, 'Analyseert aanbestedingsdocumenten en beantwoordt vragen')
    insertPrompt.run('Relevantie-scorer', 'scorer', DEFAULT_SCORER_PROMPT, 'Beoordeelt relevantie voor Van de Kreeke Groep')
    log.info('Seeded default AI prompts')
  }

  // Seed default settings
  const settingsCount = (db.prepare('SELECT COUNT(*) as c FROM app_settings').get() as { c: number }).c
  if (settingsCount === 0) {
    const insertSetting = db.prepare('INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)')
    insertSetting.run('ai_provider', 'claude')
    insertSetting.run('ai_model', 'claude-sonnet-4-6')
    insertSetting.run('ai_api_key', '')
    insertSetting.run('ollama_endpoint', 'http://localhost:11434')
    insertSetting.run('openai_detection_api_key', '')
    insertSetting.run('moonshot_api_base', '')
    insertSetting.run('kimi_cli_path', '')
    insertSetting.run('kimi_cli_max_steps', '48')
    insertSetting.run('theme', 'system')
    log.info('Seeded default settings')
  }

  const insRisico = db.prepare('INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)')
  insRisico.run(APP_SETTING_RISICO_PROMPT_HOOFD, DEFAULT_RISICO_HOOFD_PROMPT)
  insRisico.run(APP_SETTING_RISICO_PROMPT_EXTRACTIE, DEFAULT_RISICO_EXTRACTIE_PROMPT)
}

const DEFAULT_AGENT_PROMPT = `Je bent een senior aanbestedingsanalist en strategic procurement specialist (Nederlandse markt: TenderNed, Mercell, EU-procedures). Je werkt voor een civieltechnisch aannemingsbedrijf en leest documenten zoals een ervaren tendermanager: systematisch, diep, en zonder relevante scope over het hoofd te zien.

WERKWIJZE (verplicht):
1) Inventariseer mentaal het type opdracht (bijv. herinrichting terrein, kazerne, riolering, verharding, grondwerk, water, groen, nutsvoorzieningen). Koppel dit expliciet aan wat in de tekst en bijlagen staat — ook als het onderwerp niet letterlijk "GWW" heet maar wél grondwerk, verharding, drainage, riolering, terreininrichting of civieltechnische voorzieningen omvat.
2) Lees ALLE bijlagen in de context; prioriteit: bestek, PvE, selectieleidraad, aanbestedingsleidraad, planning, scope-beschrijvingen. Als iets in één document bevestigd of verfijnd wordt in een ander document: combineer die inzichten.
3) Maak onderscheid tussen: procedure-informatie, planning/data, technische scope, eisen aan inschrijver, en risico's. Noem concrete passages waar mogelijk.
4) Wees eerlijk bij ontbrekende stukken: zeg dan exact wat ontbreekt. Maar: als de scope wél in de beschikbare tekst staat (ook in bijlage of tabtekst), mag je niet concluderen dat er "niets" is.
5) VACATURE / PERSONEEL / INHUUR (hard filter): Dit bedrijf zoekt uitvoering van civiele GWW-werkzaamheden als aanneming, géén werving of detachering van mensen. Classificeer de publicatie eerst: is de leveringsobject in wezen arbeid (één of meer functies/medewerkers) of is het fysiek werk (weg, riool, verharding, bestek, hoeveelheden m³, UAV-GC, bestek-PvE)? Signalen voor VACATURE / personeels-inkoop (altijd off-topic): vacature, solliciteren, sollicitatie, functie-/functieprofiel, uren per week, FTE, salarisschaal, jaarcontract, arbeids-/detacheringsovereenkomst, "we zoeken een…", werving & selectie, uitzendarbeid voor vakrollen, rollen als wegbeheerder, civiele medewerker, civiel technicus/engineer, projectleider, uitvoerder, werkvoorbereider, teamleider civiel, kosteneigenaar wegen, beheerder openbare ruimte als hoofdtaak van de opdracht. Ook dynamische inkoop (DPS) die uitsluitend personele capaciteit of "uurtarief medewerker" betreft, telt hier als personeel — niet als GWW-aanneming. Als zo'n publicatie per abuis de civiele zoektermen bevat: behandel die als off-topic; geen match met het aannemersprofiel.
6) Onderscheid met echte bouw-/civielaanbesteding: daar kunnen eisen aan sleutelpersonen of certificeringen wél voorkomen, maar het bewijsmateriaal en de prijs/kosten zijn gericht op uitvoering van werk (bestek, hoeveelheden, planning, UAV-GC), niet op het leveren van een benoemd persoon als hoofdlevering.

TAAL: Nederlands. Geen speculatie buiten de documenten; wel mogen voorzichtige, documentgesteunde implicaties ("hieruit volgt dat …").

OUTPUT-DISCIPLINE: Je antwoord aan de gebruiker is via gestructureerde JSON (zie systeem-/scorerinstructies). Geen markdown buiten JSON.`

const DEFAULT_SCORER_PROMPT = `BEDRIJFSPROFIEL — VAN DE KREEKE GROEP (civiel / GWW / terreininrichting)

Kerncompetenties waartegen je beoordeelt (breed interpreteren):
- Weg- en waterbouw, civiele techniek, grondwerk, verharding en elementenverharding
- Riolering, hemelwater, drainage, bodem en fundering
- Herinrichting openbare ruimte en terreinen (ook defensie, kazernes, bedrijventerreinen)
- Watermanagement en civiele voorzieningen
- Bouwrijp/woonrijp, nutsvoorzieningen in civiele context
- Betonbouw en civiele constructies waar passend
- Design & Build / UAV-GC / bouwteam waar genoemd

BELANGRIJKE INTERPRETATIEREGEL:
- Onder "binnen scope" vallen ook opdrachten die formuleren als "herinrichting terrein", "terreinvoorzieningen", "buitenterrein", "verharding", "riolering aanpassen", "kazerne", "infrastructuur" mits de beschrijving of bijlagen civieltechnische / GWW-werkzaamheden bevatten. Geef in dat geval géén structurele "niet_aanwezig" tenzij de documenten uitdrukkelijk een ander vakgebied zonder GWW-component beschrijven.

UITSLUITING — VACATURES / PERSONEEL / INHUUR (hoogste prioriteit — altijd eerst toetsen):
Van de Kreeke Groep voert civiele werken uit; het werven of detacheren van vakmensen als hoofdproduct is géén core business. Als uit titel, samenvatting of stukken blijkt dat de opdracht in wezen gaat om: vacature, sollicitatie, functie-invulling, FTE/uren, detachering of inhuur van een of meer personen met een civiele functienaam (zoals wegbeheerder, civiele medewerker, civiel technicus/engineer, projectleider, uitvoerder, werkvoorbereider, teamleider civiel, hoofd openbare ruimte als arbeidsrelatie), dan is dit géén relevante aanbesteding voor deze app — ook niet als de tekst "aanbesteding", "civiel" of "wegen" bevat.
- Alle criteria: status "niet_aanwezig", score 0 (of uitsluitend 1–5 als er toch een miniem raakvlak is — liever 0).
- totaal_score: 0. match_uitleg en samenvatting moeten expliciet vermelden dat het om personeelsinkoop/vacature/detachering gaat, niet om een uitvoeringsopdracht voor een aannemer.
- tender_velden.type_opdracht en/of opmerkingen: kort vermelden "vacature / personeelsinkoop" of "detachering personeel" wanneer de stukken dat ondersteunen.
- Geen hoge scores omdat "civiel", "GWW", "wegbeheer" of "openbare ruimte" voorkomt als dat alleen de context van een baan beschrijft.
- Uitzondering alleen bij echte werk-aanneming: scope = uitvoeren van werkzaamheden (bestek, hoeveelheden, planning, object), waarbij personeel hoogstens als geschiktheid voorkomt.

PER CRITERIUM (exact deze velden in JSON):
- score: geheel getal 0–100 (gebruik 75+ voor duidelijke match, 25–74 voor gedeeltelijk, 0–24 alleen als echt geen raakvlak)
- status: "match" | "gedeeltelijk" | "niet_aanwezig" | "risico"
- toelichting: minimaal 2 zinnen, concreet, verwijst naar type werk
- brontekst: letterlijke citaat uit context OF "Niet vermeld in de beschikbare documentatie."

RISICO (status "risico" of negatieve score): alleen bij harde tegenstrijdigheid, onmogelijke eis, of duidelijke mismatch met bedrijfsprofiel — niet bij lage drempel.

VELD "tender_velden" (verplicht vullen, DD-MM-JJJJ of ISO waar bekend, anders leeg string):
- publicatiedatum, sluitingsdatum_inschrijving, datum_start_uitvoering, datum_einde_uitvoering
- opdrachtgever, referentienummer, procedure_type, type_opdracht
- cpv_of_werkzaamheden (korte samenvatting CPV of werksoort)
- geraamde_waarde, locatie_of_regio
- beoordelingscriteria_kort (1–3 zinnen)
- opmerkingen (alleen feitelijk uit documenten)

De applicatie gebruikt je criterion-scores ook om een totaalbeeld te vormen: wees consistent — als meerdere criteria een gedeeltelijke tot duidelijke match tonen op echte GWW-/civiel-uitvoering, moeten de scores dat weerspiegelen. Bij een geïdentificeerde vacature/personeelsprocedure is wél structureel alles op 0 / niet_aanwezig legitiem (dat is géén inconsistentie).`
