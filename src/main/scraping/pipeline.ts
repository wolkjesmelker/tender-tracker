import { getDb } from '../db/connection'
import { BrowserWindow, session } from 'electron'
import log from 'electron-log'
import { acquireBusyWorkBlocker, releaseBusyWorkBlocker } from '../utils/busy-work-blocker'
import type { BronWebsite, ScrapeProgress } from '../../shared/types'
import { qualifiesVoorVanDeKreekeScrape } from './scrape-qualification'
import { markSiteAsLoggedIn, markSiteAsLoggedOut } from '../ipc/auth.ipc'
import { discoverDocumentsFromBronWithAi } from '../ai/document-discovery'
import { fetchTenderNedFromTnsApi } from './document-fetcher'

interface RawTender {
  titel: string
  beschrijving?: string
  opdrachtgever?: string
  publicatiedatum?: string
  sluitingsdatum?: string
  bron_url?: string
  referentienummer?: string
  type_opdracht?: string
  regio?: string
  geraamde_waarde?: string
  ruwe_tekst?: string
}

export type ScrapePipelineOptions = {
  triggeredBy?: 'manual' | 'scheduled'
}

export async function runScrapePipeline(
  sources: BronWebsite[],
  zoektermen: string[],
  onProgress: (progress: ScrapeProgress) => void,
  options?: ScrapePipelineOptions
): Promise<{ totalFound: number; newTenderIds: string[] }> {
  acquireBusyWorkBlocker('scrape-pipeline')
  try {
  const db = getDb()
  let totalFound = 0
  const newTenderIds: string[] = []
  const triggeredBy = options?.triggeredBy ?? 'manual'

  for (const source of sources) {
    const jobId = crypto.randomUUID().replace(/-/g, '')
    db.prepare(
      "INSERT INTO scrape_jobs (id, bron_website_id, bron_naam, bron_url, status, triggered_by, started_at) VALUES (?, ?, ?, ?, 'bezig', ?, datetime('now'))"
    ).run(jobId, source.id, source.naam, source.url, triggeredBy)

    onProgress({ jobId, status: 'bezig', message: `Scraping ${source.naam}...`, found: 0 })

    try {
      let tenders: RawTender[] = []

      switch (source.id) {
        case 'tenderned':
          tenders = await scrapeTenderNed(zoektermen, onProgress, jobId)
          break
        case 'mercell':
          tenders = await scrapeMercellViaBrowser(zoektermen, onProgress, jobId)
          break
        case 'belgium':
          tenders = await scrapeBelgiumPublicProcurementBrowser(source, zoektermen, onProgress, jobId)
          break
        default:
          tenders = await scrapeGenericViaBrowser(source, zoektermen, onProgress, jobId)
      }

      log.info(`${source.naam}: found ${tenders.length} raw tenders`)

      // Store found tenders (deduplicate by URL)
      const insertTender = db.prepare(`
        INSERT INTO aanbestedingen (id, titel, beschrijving, opdrachtgever, publicatiedatum, sluitingsdatum,
          bron_url, bron_website_id, bron_website_naam, referentienummer, type_opdracht, regio,
          geraamde_waarde, ruwe_tekst, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'gevonden')
      `)

      const existingUrls = new Set(
        (db.prepare('SELECT bron_url FROM aanbestedingen WHERE bron_website_id = ?').all(source.id) as { bron_url: string }[])
          .map(r => r.bron_url)
      )

      let newCount = 0
      let skippedQualification = 0
      const sourceNewTenderIds: string[] = []
      for (const tender of tenders) {
        // Mercell: titelfilter is al toegepast tijdens het scrapen (titleMatchesSearchTerm);
        // hier geen extra kwalificatiecheck meer nodig.
        const passes =
          source.id === 'mercell'
            ? true
            : qualifiesVoorVanDeKreekeScrape(
                { titel: tender.titel, beschrijving: tender.beschrijving, ruwe_tekst: tender.ruwe_tekst },
                zoektermen
              )
        if (!passes) {
          skippedQualification++
          continue
        }
        if (!tender.bron_url?.trim()) {
          log.info(`Overgeslagen (geen detail-URL): ${tender.titel?.slice(0, 60)}`)
          continue
        }
        if (existingUrls.has(tender.bron_url)) continue

        const newId = crypto.randomUUID().replace(/-/g, '')
        insertTender.run(
          newId,
          tender.titel, tender.beschrijving, tender.opdrachtgever,
          tender.publicatiedatum, tender.sluitingsdatum, tender.bron_url,
          source.id, source.naam, tender.referentienummer,
          tender.type_opdracht, tender.regio, tender.geraamde_waarde,
          tender.ruwe_tekst
        )
        existingUrls.add(tender.bron_url)
        newTenderIds.push(newId)
        sourceNewTenderIds.push(newId)
        newCount++
      }

      totalFound += newCount

      if (skippedQualification > 0) {
        log.info(`${source.naam}: ${skippedQualification} aanbestedingen overgeslagen (niet Van de Kreeke-relevant)`)
      }

      db.prepare("UPDATE scrape_jobs SET status = 'gereed', aantal_gevonden = ?, completed_at = datetime('now') WHERE id = ?")
        .run(newCount, jobId)
      db.prepare("UPDATE bron_websites SET laatste_sync = datetime('now') WHERE id = ?").run(source.id)

      onProgress({ jobId, status: 'gereed', message: `${source.naam}: ${newCount} nieuwe aanbestedingen gevonden`, found: newCount })

      // ── Stap 2 & 3: automatisch detail + documenten ophalen voor nieuwe Mercell-tenders ──
      // Bezoek elke detailpagina, scrape alle tabbladen (incl. Documenten-tab),
      // klik download-knoppen en sla beschrijving + documentlijst op.
      if (source.id === 'mercell' && sourceNewTenderIds.length > 0) {
        const settingsRows = db.prepare('SELECT key, value FROM app_settings').all() as { key: string; value: string }[]
        const settingsMap: Record<string, string> = {}
        settingsRows.forEach(r => { settingsMap[r.key] = r.value })

        for (let di = 0; di < sourceNewTenderIds.length; di++) {
          const tenderId = sourceNewTenderIds[di]
          const tenderRow = db.prepare('SELECT titel FROM aanbestedingen WHERE id = ?').get(tenderId) as { titel: string } | undefined
          const tenderTitel = tenderRow?.titel?.slice(0, 60) || tenderId

          onProgress({
            jobId,
            status: 'bezig',
            message: `Mercell (${di + 1}/${sourceNewTenderIds.length}): detailpagina + documenten ophalen — "${tenderTitel}"…`,
            found: newCount,
          })

          try {
            await discoverDocumentsFromBronWithAi(tenderId, settingsMap, (p) => {
              onProgress({
                jobId,
                status: 'bezig',
                message: `Mercell detail (${di + 1}/${sourceNewTenderIds.length}): ${p.step}`,
                found: newCount,
              })
            })
            log.info(`Mercell auto-discovery klaar voor tender ${tenderId} ("${tenderTitel}")`)
          } catch (err: any) {
            log.warn(`Mercell auto-discovery mislukt voor ${tenderId}:`, err.message)
          }

          await sleep(500)
        }
      }

      // ── TenderNed: documenten ophalen + Mercell-link detectie ─────────────────
      // TenderNed-aankondigingen met "geïmporteerde aankondiging" hebben geen eigen
      // documenten; die staan op Mercell. Per nieuwe tender:
      //  1. Snel TNS API check — als er documenten zijn: direct opslaan, klaar.
      //  2. Geen API-documenten → volledige browser-scrape via discoverDocumentsFromBronWithAi:
      //     die detecteert de Mercell-link in de HTML-pagina en haalt de bestanden daar op.
      if (source.id === 'tenderned' && sourceNewTenderIds.length > 0) {
        const settingsRows = db.prepare('SELECT key, value FROM app_settings').all() as { key: string; value: string }[]
        const settingsMap: Record<string, string> = {}
        settingsRows.forEach(r => { settingsMap[r.key] = r.value })

        // Max 20 browser-scrapes per run om de scrape beheersbaar te houden.
        // Tenders met API-documenten tellen niet mee (die zijn snel afgehandeld).
        const MAX_BROWSER_SCRAPES = 20
        let browserScrapeCount = 0

        for (let di = 0; di < sourceNewTenderIds.length; di++) {
          const tenderId = sourceNewTenderIds[di]
          const tenderRow = db.prepare(
            'SELECT titel, bron_url FROM aanbestedingen WHERE id = ?'
          ).get(tenderId) as { titel: string; bron_url: string } | undefined
          const tenderTitel = tenderRow?.titel?.slice(0, 60) || tenderId
          const bronUrl = tenderRow?.bron_url || ''

          // Extraheer publicatie-ID uit de bron-URL (bijv. /aankondigingen/overzicht/12345678)
          const pubIdMatch = bronUrl.match(/\/(\d{5,})(?:[/?#]|$)/)
          const pubId = pubIdMatch?.[1]

          onProgress({
            jobId,
            status: 'bezig',
            message: `TenderNed (${di + 1}/${sourceNewTenderIds.length}): documenten ophalen — "${tenderTitel}"…`,
            found: newCount,
          })

          // ── Stap 1: snelle TNS API check ──────────────────────────────────────
          let apiHasDocs = false
          if (pubId) {
            try {
              const tnsResult = await fetchTenderNedFromTnsApi(pubId)
              if (tnsResult && tnsResult.documenten.length > 0) {
                db.prepare(`
                  UPDATE aanbestedingen
                  SET document_urls = ?,
                      ruwe_tekst = ?,
                      document_fetch_completed_at = datetime('now'),
                      updated_at = datetime('now')
                  WHERE id = ?
                `).run(
                  JSON.stringify(tnsResult.documenten),
                  tnsResult.volledigeTekst.slice(0, 50_000),
                  tenderId
                )
                apiHasDocs = true
                log.info(
                  `TenderNed auto: ${tenderTitel} — ${tnsResult.documenten.length} doc(s) via TNS API opgeslagen`
                )
              } else {
                log.info(
                  `TenderNed auto: ${tenderTitel} — geen API-documenten; browser-scrape starten voor Mercell-check`
                )
              }
            } catch (err: any) {
              log.warn(`TenderNed TNS pre-check mislukt voor ${tenderId}:`, err.message)
            }
          }

          // ── Stap 2: browser-scrape + Mercell-detectie (alleen bij 0 API-docs) ──
          if (!apiHasDocs) {
            if (browserScrapeCount >= MAX_BROWSER_SCRAPES) {
              log.info(
                `TenderNed auto: limiet van ${MAX_BROWSER_SCRAPES} browser-scrapes bereikt — "${tenderTitel}" overgeslagen`
              )
              continue
            }
            browserScrapeCount++

            onProgress({
              jobId,
              status: 'bezig',
              message: `TenderNed (${browserScrapeCount}/${MAX_BROWSER_SCRAPES}): browser + Mercell-check — "${tenderTitel}"…`,
              found: newCount,
            })

            try {
              await discoverDocumentsFromBronWithAi(tenderId, settingsMap, (p) => {
                onProgress({
                  jobId,
                  status: 'bezig',
                  message: `TenderNed detail (${browserScrapeCount}): ${p.step}`,
                  found: newCount,
                })
              })
              log.info(`TenderNed auto-discovery klaar voor ${tenderId} ("${tenderTitel}")`)
            } catch (err: any) {
              log.warn(`TenderNed auto-discovery mislukt voor ${tenderId}:`, err.message)
            }

            await sleep(500)
          }
        }
      }

      // ── Overige actieve bronnen (o.a. België, generieke sites): zelfde documentdiscovery als handmatig ──
      if (
        source.id !== 'mercell' &&
        source.id !== 'tenderned' &&
        sourceNewTenderIds.length > 0
      ) {
        const settingsRows = db.prepare('SELECT key, value FROM app_settings').all() as { key: string; value: string }[]
        const settingsMap: Record<string, string> = {}
        settingsRows.forEach((r) => {
          settingsMap[r.key] = r.value
        })

        for (let di = 0; di < sourceNewTenderIds.length; di++) {
          const tenderId = sourceNewTenderIds[di]
          const tenderRow = db.prepare('SELECT titel FROM aanbestedingen WHERE id = ?').get(tenderId) as { titel: string } | undefined
          const tenderTitel = tenderRow?.titel?.slice(0, 60) || tenderId

          onProgress({
            jobId,
            status: 'bezig',
            message: `${source.naam} (${di + 1}/${sourceNewTenderIds.length}): detail + documenten — "${tenderTitel}"…`,
            found: newCount,
          })

          try {
            await discoverDocumentsFromBronWithAi(tenderId, settingsMap, (p) => {
              onProgress({
                jobId,
                status: 'bezig',
                message: `${source.naam} detail (${di + 1}/${sourceNewTenderIds.length}): ${p.step}`,
                found: newCount,
              })
            })
            log.info(`${source.naam} auto-discovery klaar voor tender ${tenderId}`)
          } catch (err: any) {
            log.warn(`${source.naam} auto-discovery mislukt voor ${tenderId}:`, err.message)
          }

          await sleep(500)
        }
      }
    } catch (error: any) {
      log.error(`Scraping ${source.naam} failed:`, error)
      db.prepare("UPDATE scrape_jobs SET status = 'fout', fout_melding = ?, completed_at = datetime('now') WHERE id = ?")
        .run(error.message, jobId)
      onProgress({ jobId, status: 'fout', message: `Fout bij ${source.naam}: ${error.message}`, found: 0 })
    }
  }

  return { totalFound, newTenderIds }
  } finally {
    releaseBusyWorkBlocker('scrape-pipeline')
  }
}

// =============================================================================
// TenderNed - Uses their undocumented public JSON API
// =============================================================================
async function scrapeTenderNed(
  zoektermen: string[],
  onProgress: (p: ScrapeProgress) => void,
  jobId: string
): Promise<RawTender[]> {
  const tenders: RawTender[] = []
  const seenIds = new Set<string>()

  // The TenderNed API doesn't support text search - we fetch "Werken" (Works) type
  // and filter client-side by keywords
  const baseUrl = 'https://www.tenderned.nl/papi/tenderned-rs-tns/v2/publicaties'
  const pageSize = 100
  const maxPages = 5 // 500 tenders max per scrape

  onProgress({ jobId, status: 'bezig', message: 'TenderNed: ophalen aanbestedingen (type: Werken)...', found: 0 })

  for (let page = 0; page < maxPages; page++) {
    try {
      const url = `${baseUrl}?page=${page}&size=${pageSize}&typeOpdracht=W`
      log.info(`TenderNed API: fetching page ${page} - ${url}`)

      const response = await fetch(url, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        }
      })

      if (!response.ok) {
        log.warn(`TenderNed API returned ${response.status} for page ${page}`)
        break
      }

      const data = await response.json() as any
      const items = data?.content || data?._embedded?.publicaties || []

      if (!Array.isArray(items) || items.length === 0) {
        log.info(`TenderNed: no more results at page ${page}`)
        break
      }

      for (const item of items) {
        const id = item.publicatieId || item.kenmerk
        if (seenIds.has(id)) continue
        seenIds.add(id)

        // Skip vroegtijdig beëindigde aanbestedingen
        if (item.isVroegtijdigeBeeindiging === true) {
          log.info(`TenderNed: skipping "${item.aanbestedingNaam}" - vroegtijdig beëindigd`)
          continue
        }

        // Skip rectificaties en intrekkingen
        const pubType = item.typePublicatie?.code || ''
        if (pubType === 'REC' || pubType === 'INT') {
          log.info(`TenderNed: skipping "${item.aanbestedingNaam}" - type: ${pubType}`)
          continue
        }

        // Skip als sluitingsdatum al verstreken is
        if (item.sluitingsDatum) {
          const deadline = new Date(item.sluitingsDatum)
          if (deadline < new Date()) {
            continue
          }
        }

        const naam = item.aanbestedingNaam || ''
        const beschrijving = item.opdrachtBeschrijving || ''

        if (
          !qualifiesVoorVanDeKreekeScrape(
            { titel: naam, beschrijving, ruwe_tekst: beschrijving },
            zoektermen
          )
        ) {
          continue
        }

        const bronUrl = canonicalTenderNedDetailUrl(String(item.publicatieId || id), item.link?.href)

        let sluitingsDatum: string | undefined
        if (item.sluitingsDatum) {
          try {
            sluitingsDatum = new Date(item.sluitingsDatum).toISOString().split('T')[0]
          } catch {}
        }

        tenders.push({
          titel: naam,
          beschrijving: beschrijving.slice(0, 2000),
          opdrachtgever: item.opdrachtgeverNaam,
          publicatiedatum: item.publicatieDatum,
          sluitingsdatum: sluitingsDatum,
          bron_url: bronUrl,
          referentienummer: item.kenmerk,
          type_opdracht: item.typeOpdracht?.omschrijving || 'Werken',
          regio: 'Nederland',
          ruwe_tekst: beschrijving,
        })
      }

      onProgress({
        jobId,
        status: 'bezig',
        message: `TenderNed: pagina ${page + 1}/${maxPages} verwerkt, ${tenders.length} relevant gevonden...`,
        found: tenders.length,
      })

      // Check if this was the last page
      if (data.last === true || items.length < pageSize) break

      // Small delay between pages
      await sleep(300)

    } catch (error: any) {
      log.error(`TenderNed page ${page} failed:`, error.message)
      break
    }
  }

  // Also fetch "Diensten" (Services) that might include GWW-related services
  onProgress({ jobId, status: 'bezig', message: `TenderNed: ophalen diensten-aanbestedingen...`, found: tenders.length })

  for (let page = 0; page < 2; page++) {
    try {
      const url = `${baseUrl}?page=${page}&size=${pageSize}&typeOpdracht=D`
      const response = await fetch(url, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        }
      })

      if (!response.ok) break
      const data = await response.json() as any
      const items = data?.content || data?._embedded?.publicaties || []
      if (!Array.isArray(items) || items.length === 0) break

      for (const item of items) {
        const id = item.publicatieId || item.kenmerk
        if (seenIds.has(id)) continue
        seenIds.add(id)

        // Skip beëindigde/ingetrokken/verlopen
        if (item.isVroegtijdigeBeeindiging === true) continue
        const pubType = item.typePublicatie?.code || ''
        if (pubType === 'REC' || pubType === 'INT') continue
        if (item.sluitingsDatum && new Date(item.sluitingsDatum) < new Date()) continue

        const naam = item.aanbestedingNaam || ''
        const beschrijving = item.opdrachtBeschrijving || ''

        if (
          !qualifiesVoorVanDeKreekeScrape(
            { titel: naam, beschrijving, ruwe_tekst: beschrijving },
            zoektermen
          )
        ) {
          continue
        }

        const bronUrl = canonicalTenderNedDetailUrl(String(item.publicatieId || id), item.link?.href)

        let sluitingsDatum: string | undefined
        if (item.sluitingsDatum) {
          try { sluitingsDatum = new Date(item.sluitingsDatum).toISOString().split('T')[0] } catch {}
        }

        tenders.push({
          titel: naam,
          beschrijving: beschrijving.slice(0, 2000),
          opdrachtgever: item.opdrachtgeverNaam,
          publicatiedatum: item.publicatieDatum,
          sluitingsdatum: sluitingsDatum,
          bron_url: bronUrl,
          referentienummer: item.kenmerk,
          type_opdracht: item.typeOpdracht?.omschrijving || 'Diensten',
          regio: 'Nederland',
          ruwe_tekst: beschrijving,
        })
      }

      if (data.last === true || items.length < pageSize) break
      await sleep(300)
    } catch (error: any) {
      log.error(`TenderNed services page ${page} failed:`, error.message)
      break
    }
  }

  log.info(`TenderNed: total ${tenders.length} relevant tenders found`)
  return tenders
}

// =============================================================================
// TED API - EU Tenders Electronic Daily (covers Belgium + Netherlands EU tenders)
// Uses v3 API: https://api.ted.europa.eu/v3/notices/search (POST)
// =============================================================================
async function scrapeTedApi(
  countryCode: string,
  zoektermen: string[],
  onProgress: (p: ScrapeProgress) => void,
  jobId: string
): Promise<RawTender[]> {
  const tenders: RawTender[] = []
  const siteName = countryCode === 'BE' ? 'E-procurement België (TED)' : `TED (${countryCode})`
  const countryIso3 = countryCode === 'BE' ? 'BEL' : countryCode === 'NL' ? 'NLD' : countryCode

  onProgress({ jobId, status: 'bezig', message: `${siteName}: zoeken via TED EU API...`, found: 0 })

  try {
    // TED v3 uses full field names, ISO3 country codes, and expert query syntax
    const query = `organisation-country-buyer = ${countryIso3}`

    const response = await fetch('https://api.ted.europa.eu/v3/notices/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        query,
        page: 1,
        limit: 100,
        fields: [
          'notice-identifier',
          'notice-title',
          'publication-date',
          'deadline-receipt-tender-date-lot',
          'organisation-name-buyer',
          'description-lot',
          'estimated-value-cur-lot',
          'title-proc',
          'contract-nature-main-proc',
        ],
        scope: 'ALL',
        paginationMode: 'PAGE_NUMBER',
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      log.error(`TED API error ${response.status}: ${errorText.slice(0, 500)}`)
      throw new Error(`TED API fout: ${response.status}`)
    }

    const data = await response.json() as any
    const notices = data?.notices || []

    log.info(`TED API: received ${notices.length} notices for ${countryCode}`)

    onProgress({
      jobId,
      status: 'bezig',
      message: `${siteName}: ${notices.length} aanbestedingen ophalen, filteren op relevantie...`,
      found: 0,
    })

    for (const notice of notices) {
      // Extract fields from TED v3 response format
      const pubNumber = notice['publication-number'] || ''
      const noticeId = notice['notice-identifier'] || pubNumber

      // Title can be multilingual object or string
      const titleRaw = notice['notice-title'] || notice['title-proc'] || ''
      const titel = typeof titleRaw === 'object'
        ? (titleRaw['NLD'] || titleRaw['FRA'] || titleRaw['ENG'] || titleRaw['DEU'] || Object.values(titleRaw)[0] || 'Geen titel')
        : String(titleRaw || 'Geen titel')

      // Description
      const descRaw = notice['description-lot'] || ''
      const beschrijving = typeof descRaw === 'object'
        ? (descRaw['NLD'] || descRaw['FRA'] || descRaw['ENG'] || Object.values(descRaw)[0] || '')
        : String(descRaw || '')

      if (
        !qualifiesVoorVanDeKreekeScrape(
          { titel: String(titel), beschrijving: String(beschrijving), ruwe_tekst: String(beschrijving) },
          zoektermen
        )
      ) {
        continue
      }

      // Buyer name
      const buyerRaw = notice['organisation-name-buyer'] || ''
      const opdrachtgever = typeof buyerRaw === 'object' ? (Object.values(buyerRaw)[0] || '') : String(buyerRaw)

      const bron_url = canonicalTedNoticeUrl(String(pubNumber || ''), String(noticeId || ''))

      // Deadline
      const deadline = notice['deadline-receipt-tender-date-lot'] || ''

      // Value
      const valueRaw = notice['estimated-value-cur-lot'] || ''

      const contractNature = notice['contract-nature-main-proc'] || ''
      const isWorks =
        String(contractNature).toLowerCase().includes('works') ||
        String(contractNature).toLowerCase().includes('werken')

      tenders.push({
        titel: String(titel).slice(0, 500),
        beschrijving: String(beschrijving).slice(0, 2000) || undefined,
        opdrachtgever: String(opdrachtgever).slice(0, 200) || undefined,
        publicatiedatum: notice['publication-date'] ? String(notice['publication-date']).replace('Z', '') : undefined,
        sluitingsdatum: deadline ? String(deadline).split('T')[0] : undefined,
        bron_url,
        referentienummer: pubNumber || noticeId,
        type_opdracht: isWorks ? 'Werken' : 'Diensten',
        regio: countryCode === 'BE' ? 'België' : 'Nederland',
        geraamde_waarde: valueRaw ? String(valueRaw) : undefined,
        ruwe_tekst: String(beschrijving).slice(0, 5000),
      })
    }

    log.info(`TED API (${countryCode}): ${tenders.length} relevant tenders after filtering`)

  } catch (error: any) {
    log.error(`TED API scrape for ${countryCode} failed:`, error)
    throw error
  }

  return tenders
}

// =============================================================================
// België — BOSA eProcurement (inlog via app). SPA: geen bruikbare server-side HTML;
// we automatiseren de ingelogde browser — zoeken, links/rijen, daarna detailpagina's.
// https://www.publicprocurement.be/supplier/enterprises/0/enterprises/overview
//
// Debug (alleen labels, geen waarden): zet TENDER_DEBUG_BELGIUM_KV=1 of app_settings.debug_belgium_kv=1
// =============================================================================

const BELGIUM_MAX_DETAILS_PER_TERM = 14
const BELGIUM_MAX_TERMS = 8
const BELGIUM_LISTING_SETTLE_MS = 7500
const BELGIUM_DETAIL_SETTLE_MS = 5000

function belgiumDetailKvDebugEnabled(): boolean {
  const env = process.env.TENDER_DEBUG_BELGIUM_KV?.trim()
  if (env && /^(1|true|yes|on)$/i.test(env)) return true
  try {
    const row = getDb()
      .prepare("SELECT value FROM app_settings WHERE key = 'debug_belgium_kv'")
      .get() as { value: string } | undefined
    const v = row?.value?.trim()
    if (v && /^(1|true|yes|on)$/i.test(v)) return true
  } catch {
    /* db not ready */
  }
  return false
}

/** Lijstitem (linktitel/snippet): al filteren vóór detail-load — voorkomt inlogscherm in DB. */
function belgiumListingItemLooksLikeAuthNav(
  titel: string,
  snippet: string | undefined,
  url: string
): boolean {
  const blob = `${titel}\n${snippet || ''}`.toLowerCase()
  if (/aanmelden\s*[/|]\s*registreren/.test(blob)) return true
  if (/\bnieuwe gebruiker\b/.test(blob) && /\bregistreer\b/.test(blob)) return true
  if (blob.includes('wachtwoord vergeten') && /e-mailadres|\be-mail\b/.test(blob)) return true
  if (blob.includes('aangemeld blijven') && /\bwachtwoord\b/.test(blob)) return true
  if (/^\s*(inloggen|login|sign\s*in|connexion)\s*$/i.test((titel || '').trim())) return true
  try {
    const p = new URL(url).pathname.toLowerCase()
    if (/\/(sso|saml|oauth|callback)(\/|$)/i.test(p)) return true
  } catch {
    /* ignore */
  }
  return false
}

/** Detail-response is duidelijk inlog-/registratiepagina (geen echte bekendmaking). */
function belgiumExtractLooksLikeLoginPage(
  titel: string,
  ruwe?: string,
  beschrijving?: string
): boolean {
  const head = (titel || '').trim().toLowerCase()
  if (
    /aanmelden\s*[/|]\s*registreren|^\s*aanmelden\s*$|^\s*registreren\s*$|^\s*inloggen\s*$|^\s*login\s*$|^\s*sign\s*in\s*$|^\s*connexion\s*$/.test(
      head
    )
  ) {
    return true
  }
  const blob = `${titel}\n${ruwe || ''}\n${beschrijving || ''}`.toLowerCase()
  const hasPassword = /\bwachtwoord\b|\bpassword\b|\bmot de passe\b/.test(blob)
  const hasEmail = /e-mailadres|\be-mail\b|email address|adresse e-mail/.test(blob)
  const hasForgot = /wachtwoord vergeten|forgot password|mot de passe oublié/.test(blob)
  const hasStay = /aangemeld blijven|remember me|rester connecté|se souvenir/.test(blob)
  const hasRegisterCta = /nieuwe gebruiker|registreer|register|créer un compte|create an account/.test(blob)
  if (hasPassword && hasEmail && (hasForgot || hasStay)) return true
  if (hasPassword && hasEmail && hasRegisterCta && head.includes('aanmeld')) return true
  return false
}

function belgiumUrlLooksLikeTenderDetail(urlStr: string): boolean {
  try {
    const u = new URL(urlStr)
    const host = u.hostname.toLowerCase()
    if (!host.endsWith('publicprocurement.be')) return false
    const p = u.pathname.toLowerCase()
    if (
      /login|logout|register|registreren|aanmelden|signin|sign-in|connexion|inscription|authenticate|cookie|privacy|help|mailto:/i.test(
        p
      )
    ) {
      return false
    }
    if (/\/(account|auth|identity)(\/|$)/i.test(p)) return false
    if (/\/enterprises\/\d+\/enterprises\/overview\/?$/i.test(p)) return false
    if (
      /tender|notice|procedure|procurement|publication|competition|opportunity|submission|award|contract|cpv|published|bekendmaking|aanbest/i.test(
        p
      )
    )
      return true
    if (/\/[a-f0-9]{8}-[a-f0-9-]{20,}/i.test(p)) return true
    return false
  } catch {
    return false
  }
}

/** BOSA gebruikt vaak DD/MM/JJJJ; SQLite date() verwacht vooral ISO. */
function normalizeDatumVoorSqlite(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  const s = raw.replace(/\s+/g, ' ').trim().slice(0, 120)
  if (!s) return undefined
  const isoStart = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (isoStart) return `${isoStart[1]}-${isoStart[2]}-${isoStart[3]}`
  const dmY = s.match(/\b(\d{1,2})[./-](\d{1,2})[./-](\d{4})\b/)
  if (dmY) {
    const d = parseInt(dmY[1], 10)
    const mo = parseInt(dmY[2], 10)
    const y = parseInt(dmY[3], 10)
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31 && y >= 1990 && y <= 2100)
      return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  }
  return undefined
}

function mapBelgiumKeyValuesToTenderFields(kv: Record<string, string>): Partial<RawTender> {
  const out: Partial<RawTender> = {}
  for (const [rawKey, rawVal] of Object.entries(kv)) {
    const key = rawKey.replace(/\s+/g, ' ').trim().toLowerCase()
    const val = rawVal.replace(/\s+/g, ' ').trim()
    if (!val) continue
    if (
      /buyer|contracting|authority|opdrachtgever|aanbestedende|pouvoir|acheteur|organisation|organisatie|bestuur/.test(
        key
      )
    ) {
      if (!out.opdrachtgever) out.opdrachtgever = val.slice(0, 200)
    } else if (
      /deadline|closing|submission|sluit|indienen|remise|date limite|limite de/.test(key)
    ) {
      if (!out.sluitingsdatum) out.sluitingsdatum = val.slice(0, 120)
    } else if (/publication|publicatie|published|bekendmaking|parution/.test(key)) {
      if (!out.publicatiedatum) out.publicatiedatum = val.slice(0, 120)
    } else if (/reference|référence|kenmerk|notice|oj\s*s|identifiant/.test(key)) {
      if (!out.referentienummer) out.referentienummer = val.slice(0, 120)
    } else if (/value|estimated|waarde|montant|budget|gunnings|bedrag/.test(key)) {
      if (!out.geraamde_waarde) out.geraamde_waarde = val.slice(0, 120)
    }
  }
  return out
}

async function scrapeBelgiumPublicProcurementBrowser(
  source: BronWebsite,
  zoektermen: string[],
  onProgress: (p: ScrapeProgress) => void,
  jobId: string
): Promise<RawTender[]> {
  const partition = 'persist:auth-belgium'
  const tenders: RawTender[] = []
  const seenDetailUrls = new Set<string>()
  let belgiumKvDebugLogged = false
  const startUrl =
    source.url?.trim() ||
    'https://www.publicprocurement.be/supplier/enterprises/0/enterprises/overview'

  const terms = zoektermen.length > 0 ? zoektermen.slice(0, BELGIUM_MAX_TERMS) : ['']

  for (let ti = 0; ti < terms.length; ti++) {
    const term = terms[ti] || ''
    onProgress({
      jobId,
      status: 'bezig',
      message: term
        ? `België (eProcurement): zoeken naar "${term}"...`
        : 'België (eProcurement): overzicht laden...',
      found: tenders.length,
    })

    const win = new BrowserWindow({
      width: 1400,
      height: 900,
      show: false,
      webPreferences: {
        partition,
        nodeIntegration: false,
        contextIsolation: true,
        backgroundThrottling: false,
      },
    })

    try {
      await win.loadURL(startUrl, {
        userAgent:
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
      })
      await sleep(6500)

      let rawItems = (await win.webContents.executeJavaScript(
        buildBelgiumListingCollectScript(term)
      )) as { titel: string; url: string; snippet?: string }[]

      if (!Array.isArray(rawItems)) rawItems = []

      if (rawItems.length < 2) {
        const extra = (await win.webContents.executeJavaScript(
          buildBelgiumRowClickSupplementScript()
        )) as { titel: string; url: string; snippet?: string }[]
        if (Array.isArray(extra) && extra.length) {
          const have = new Set(rawItems.map(r => r.url.split('#')[0]))
          for (const e of extra) {
            const u = e.url.split('#')[0]
            if (!have.has(u)) {
              have.add(u)
              rawItems.push(e)
            }
          }
        }
      }

      const candidates: { titel: string; url: string; snippet?: string }[] = []
      for (const it of rawItems) {
        if (!it?.url) continue
        const url = String(it.url).split('#')[0]
        if (!belgiumUrlLooksLikeTenderDetail(url)) continue
        const titel = (it.titel || '').trim() || url
        if (titel.length < 3) continue
        if (belgiumListingItemLooksLikeAuthNav(titel, it.snippet, url)) continue
        candidates.push({ titel: titel.slice(0, 500), url, snippet: it.snippet })
      }

      log.info(
        `België term "${term || '(leeg)'}": ${rawItems.length} ruwe items, ${candidates.length} detail-kandidaten`
      )

      let detailCount = 0
      for (const c of candidates) {
        if (detailCount >= BELGIUM_MAX_DETAILS_PER_TERM) break
        if (seenDetailUrls.has(c.url)) continue
        seenDetailUrls.add(c.url)

        onProgress({
          jobId,
          status: 'bezig',
          message: `België: detail ${detailCount + 1}/${Math.min(candidates.length, BELGIUM_MAX_DETAILS_PER_TERM)} — ${c.titel.slice(0, 55)}…`,
          found: tenders.length,
        })

        try {
          await win.loadURL(c.url, {
            userAgent:
              'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
          })
          await sleep(BELGIUM_DETAIL_SETTLE_MS)

          const extracted = (await win.webContents.executeJavaScript(
            buildBelgiumDetailExtractScript()
          )) as {
            titel?: string
            beschrijving?: string
            ruwe_tekst?: string
            kv?: Record<string, string>
          }

          const fromKv = mapBelgiumKeyValuesToTenderFields(extracted?.kv || {})
          const pageTitle = (extracted?.titel || '').trim()
          const titel = (pageTitle || c.titel).slice(0, 500)
          const bodyText = (extracted?.ruwe_tekst || extracted?.beschrijving || c.snippet || '').trim()
          const beschrijving = (extracted?.beschrijving || bodyText).slice(0, 2000) || undefined
          let ruweSlice = bodyText ? bodyText.slice(0, 12000) : ''
          const termTrim = term.trim()
          if (termTrim) {
            ruweSlice = `${ruweSlice}\n\n[Tracking zoekterm: ${termTrim}]`.slice(0, 12000)
          }

          if (belgiumDetailKvDebugEnabled() && !belgiumKvDebugLogged) {
            const keys = Object.keys(extracted?.kv || {})
            if (keys.length > 0) {
              belgiumKvDebugLogged = true
              log.info('[België debug] Eerste detailpagina: kv-labels', keys)
            }
          }

          if (belgiumExtractLooksLikeLoginPage(titel, ruweSlice, beschrijving || '')) {
            log.info(
              `België scrape: overgeslagen (inlog-/registratiepagina, geen aanbesteding): ${c.url.slice(0, 96)}`
            )
            continue
          }

          tenders.push({
            titel,
            beschrijving,
            opdrachtgever: fromKv.opdrachtgever,
            publicatiedatum: normalizeDatumVoorSqlite(fromKv.publicatiedatum),
            sluitingsdatum: normalizeDatumVoorSqlite(fromKv.sluitingsdatum),
            referentienummer: fromKv.referentienummer,
            geraamde_waarde: fromKv.geraamde_waarde,
            bron_url: c.url,
            regio: 'België',
            type_opdracht: 'Werken',
            ruwe_tekst: ruweSlice || undefined,
          })
          detailCount++
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err)
          log.warn(`België detail scrape ${c.url}: ${msg}`)
        }
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      log.warn(`België eProcurement scrape (term "${term}"): ${msg}`)
    } finally {
      win.close()
    }

    await sleep(1200)
  }

  log.info(`België eProcurement browser: ${tenders.length} aanbestedingen met detailpagina`)
  return tenders
}

/** Zoekveld vullen + wachten; daarna alle relevante links op de pagina. */
function buildBelgiumListingCollectScript(searchTerm: string): string {
  const termJson = JSON.stringify(searchTerm)
  return `
(async function() {
  var searchTerm = ${termJson};
  var sleep = function(ms) { return new Promise(function(r) { setTimeout(r, ms); }); };

  function looksLikeAuthLinkText(t, snip) {
    var s = ((t || '') + ' ' + (snip || '')).toLowerCase();
    if (/aanmelden\\s*[/|]\\s*registreren/.test(s)) return true;
    if (s.indexOf('nieuwe gebruiker') >= 0 && s.indexOf('registreer') >= 0) return true;
    if (s.indexOf('wachtwoord vergeten') >= 0 && (s.indexOf('e-mail') >= 0 || s.indexOf('e-mailadres') >= 0)) return true;
    if (s.indexOf('aangemeld blijven') >= 0 && s.indexOf('wachtwoord') >= 0) return true;
    return false;
  }

  function isTenderHref(href) {
    if (!href || href.indexOf('publicprocurement.be') === -1) return false;
    if (/login|logout|register|registreren|aanmelden|signin|sign-in|connexion|inscription|authenticate|cookie|privacy|help|mailto:/i.test(href)) return false;
    if (/account\\//i.test(href) || /\\/account/i.test(href) || /\\/auth\\//i.test(href) || /\\/identity\\//i.test(href)) return false;
    try {
      var p = new URL(href).pathname.toLowerCase();
      if (/\\/enterprises\\/\\d+\\/enterprises\\/overview\\/?$/i.test(p)) return false;
      if (/tender|notice|procedure|procurement|publication|competition|opportunity|submission|award|contract|cpv|published|bekendmaking|aanbest/i.test(p)) return true;
      if (/\\/[a-f0-9]{8}-[a-f0-9-]{20,}/i.test(p)) return true;
      return false;
    } catch (e) { return false; }
  }

  async function trySearch() {
    if (!searchTerm) return;
    var selectors = [
      'input[type="search"]',
      'input[placeholder*="Zoek" i]',
      'input[placeholder*="Search" i]',
      'input[placeholder*="Recherch" i]',
      'input[placeholder*="Cherch" i]',
      'input[name*="search" i]',
      'input[id*="search" i]',
      'input[aria-label*="search" i]',
      'input.form-control'
    ];
    for (var i = 0; i < selectors.length; i++) {
      var el = document.querySelector(selectors[i]);
      if (!el || el.offsetParent === null) continue;
      try {
        el.focus();
        el.value = searchTerm;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        var form = el.closest('form');
        if (form && form.requestSubmit) form.requestSubmit();
        else if (form) form.submit();
        var btn = document.querySelector('button[type="submit"], [data-testid*="search"] button, button[class*="search" i]');
        if (btn) btn.click();
        el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
        await sleep(${BELGIUM_LISTING_SETTLE_MS});
        return;
      } catch (e) {}
    }
  }

  await trySearch();
  window.scrollTo(0, document.body.scrollHeight);
  await sleep(1200);
  window.scrollTo(0, 0);
  await sleep(400);

  var out = [];
  var seen = {};
  var links = document.querySelectorAll('a[href]');
  for (var j = 0; j < links.length; j++) {
    var a = links[j];
    var href = (a.href || '').split('#')[0];
    if (!isTenderHref(href)) continue;

    var text = '';
    var el = a;
    for (var k = 0; k < 5 && el; k++) {
      text = (el.textContent || '').replace(/\\s+/g, ' ').trim();
      if (text.length >= 8) break;
      el = el.parentElement;
    }
    if (text.length < 8) text = (a.getAttribute('title') || a.getAttribute('aria-label') || '').trim() || href;

    if (looksLikeAuthLinkText(text, text.slice(0, 500))) continue;

    var key = href.split('?')[0];
    if (seen[key]) continue;
    seen[key] = true;

    out.push({ titel: text.slice(0, 500), url: href, snippet: text.slice(0, 600) });
  }
  return out;
})()
`
}

/** Als de lijst uit klikbare rijen bestaat zonder href: een paar rijen aanklikken en opnieuw links verzamelen. */
function buildBelgiumRowClickSupplementScript(): string {
  return `
(async function() {
  var sleep = function(ms) { return new Promise(function(r) { setTimeout(r, ms); }); };

  function looksLikeAuthLinkText(t, snip) {
    var s = ((t || '') + ' ' + (snip || '')).toLowerCase();
    if (/aanmelden\\s*[/|]\\s*registreren/.test(s)) return true;
    if (s.indexOf('nieuwe gebruiker') >= 0 && s.indexOf('registreer') >= 0) return true;
    if (s.indexOf('wachtwoord vergeten') >= 0 && (s.indexOf('e-mail') >= 0 || s.indexOf('e-mailadres') >= 0)) return true;
    if (s.indexOf('aangemeld blijven') >= 0 && s.indexOf('wachtwoord') >= 0) return true;
    return false;
  }

  function isTenderHref(href) {
    if (!href || href.indexOf('publicprocurement.be') === -1) return false;
    if (/login|logout|register|registreren|aanmelden|signin|sign-in|connexion|inscription|authenticate|cookie|privacy|help|mailto:/i.test(href)) return false;
    if (/\\/account\\//i.test(href) || /\\/auth\\//i.test(href) || /\\/identity\\//i.test(href)) return false;
    try {
      var p = new URL(href).pathname.toLowerCase();
      if (/\\/enterprises\\/\\d+\\/enterprises\\/overview\\/?$/i.test(p)) return false;
      if (/tender|notice|procedure|procurement|publication|competition|opportunity|submission|award|contract|cpv|published|bekendmaking|aanbest/i.test(p)) return true;
      if (/\\/[a-f0-9]{8}-[a-f0-9-]{20,}/i.test(p)) return true;
      return false;
    } catch (e) { return false; }
  }

  function collectLinks() {
    var found = [];
    var seen = {};
    document.querySelectorAll('a[href]').forEach(function(a) {
      var href = (a.href || '').split('#')[0];
      if (!isTenderHref(href)) return;
      var text = (a.textContent || '').replace(/\\s+/g, ' ').trim() || href;
      if (looksLikeAuthLinkText(text, text.slice(0, 400))) return;
      var key = href.split('?')[0];
      if (seen[key]) return;
      seen[key] = true;
      found.push({ titel: text.slice(0, 500), url: href, snippet: text.slice(0, 400) });
    });
    return found;
  }

  var merged = collectLinks();
  var have = {};
  merged.forEach(function(m) { have[m.url.split('?')[0]] = true; });

  var rows = Array.from(document.querySelectorAll(
    'tbody tr[tabindex], tbody tr, [role="row"], tr.p-selectable-row, tr[data-pc-section="bodyrow"], .mat-row, [class*="DataTable"] tbody tr'
  ));

  for (var i = 0; i < Math.min(rows.length, 10); i++) {
    try {
      rows[i].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      await sleep(2200);
      collectLinks().forEach(function(item) {
        var k = item.url.split('?')[0];
        if (!have[k]) {
          have[k] = true;
          merged.push(item);
        }
      });
    } catch (e) {}
  }
  return merged;
})()
`
}

/** Detailpagina: titel + hoofdtekst + label/waarde uit dl en tabellen (meertalige portal). */
function buildBelgiumDetailExtractScript(): string {
  return `
(function() {
  var h1 = document.querySelector('h1');
  var h2 = document.querySelector('main h2, [role="main"] h2, .page-title');
  var titel = ((h1 && h1.innerText) || (h2 && h2.innerText) || document.title || '').replace(/\\s+/g, ' ').trim();

  var root =
    document.querySelector('main, [role="main"], [class*="detail"], [class*="content"] article, #content, app-root') ||
    document.body;
  var raw = (root.innerText || '').replace(/\\s+/g, ' ').trim();

  var kv = {};
  document.querySelectorAll('dl').forEach(function(dl) {
    var dts = dl.querySelectorAll('dt');
    dts.forEach(function(dt) {
      var key = (dt.textContent || '').replace(/\\s+/g, ' ').trim().replace(/:$/, '');
      var dd = dt.nextElementSibling;
      if (dd && dd.tagName === 'DD' && key.length) {
        kv[key] = (dd.textContent || '').replace(/\\s+/g, ' ').trim();
      }
    });
  });

  document.querySelectorAll('table tr').forEach(function(tr) {
    var cells = tr.querySelectorAll('th, td');
    if (cells.length >= 2) {
      var k = (cells[0].textContent || '').replace(/\\s+/g, ' ').trim().replace(/:$/, '');
      var v = (cells[1].textContent || '').replace(/\\s+/g, ' ').trim();
      if (k.length && k.length < 120 && v.length) kv[k] = v;
    }
  });

  return {
    titel: titel.slice(0, 500),
    beschrijving: raw.slice(0, 3500),
    ruwe_tekst: raw.slice(0, 14000),
    kv: kv
  };
})()
`
}

// =============================================================================
// Mercell/Negometrix - Use Electron BrowserWindow since it's an SPA
// =============================================================================

/** Zelfde UA als auth- en document-fetch: Electron-default breekt veel SPA’s. */
const CHROME_LIKE_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

/**
 * Vaste GWW/civiel-zoekzinnen die altijd op Mercell gezocht worden, ongeacht wat de
 * gebruiker als actieve zoekterm heeft ingesteld. Dekt het volledige werkgebied van
 * Van de Kreeke Wegenbouw. Kort en breed: Mercell's zoekmachine zoekt full-text.
 */
const MERCELL_CORE_TERMS = [
  'wegenbouw',
  'riolering',
  'asfalt',
  'herinrichting',
  'reconstructie weg',
  'civiele werken',
  'gww',
  'bestrating',
  'woonrijp',
  'bouwrijp',
  'drainage',
  'waterberging',
  'verharding',
  'openbare ruimte',
]

/**
 * Bouw de definitieve lijst zoekvragen voor Mercell:
 *   1. MERCELL_CORE_TERMS (altijd — dekt het volledige GWW-spectrum)
 *   2. Actieve gebruikerszoektermen die nog niet gedekt zijn
 * Max 14 zoekvragen om de scraptijd beheersbaar te houden.
 */
function buildMercellSearchTerms(userZoektermen: string[]): string[] {
  const normalise = (s: string) => s.trim().toLowerCase()
  const coreNorm = new Set(MERCELL_CORE_TERMS.map(normalise))
  const extra = userZoektermen.filter(z => !coreNorm.has(normalise(z)))
  return [...MERCELL_CORE_TERMS, ...extra].slice(0, 14)
}

/**
 * Controleert of de zoekterm expliciet voorkomt in de titel van het zoekresultaat.
 * Alleen resultaten waarvan de header de zoekterm bevat worden meegenomen; zo
 * worden niet-gerelateerde tenders uitgefilterd die door Mercell's full-text zoekmachine
 * worden teruggestuurd maar thematisch niet passen.
 *
 * Strategie:
 *   1. Exacte frase (case-insensitief) in de titel → match.
 *   2. Bij meerdere woorden: alle significante woorden (≥ 4 tekens) moeten in de titel
 *      aanwezig zijn — dit vangt varianten als "reconstructie wegen" vs "reconstructie weg".
 */
function titleMatchesSearchTerm(titel: string, term: string, ruweTekst?: string): boolean {
  const t = `${titel}\n${ruweTekst || ''}`.toLowerCase()
  const q = term.toLowerCase().trim()
  if (t.includes(q)) return true
  const words = q.split(/\s+/).filter(w => w.length >= 4)
  return words.length > 0 && words.every(w => t.includes(w))
}

/**
 * Mercell-specifieke kwalificatie — minder streng dan TenderNed.
 * Mercell's zoekmachine deed al de zoekterm-filtering; wij controleren alleen
 * of het een GWW/civiel-opdracht is en geen dominant off-topic signaal bevat.
 */
function mercellResultIsGwwRelevant(ruwe: string): boolean {
  const lower = ruwe.toLowerCase()
  const GWW_SIGNALS = [
    'asfalt', 'wegenbouw', 'wegwerk', 'wegen', 'riolering', 'riool', 'hemelwater',
    'waterberging', 'infiltratie', 'drainage', 'gww', 'grondwerk', 'civiel',
    'openbare ruimte', 'herinrichting', 'reconstructie', 'bestrating', 'klinker',
    'elementenverharding', 'verharding', 'bouwrijp', 'woonrijp',
    'bedrijventerrein', 'kade', 'brug', 'dijk', 'watermanagement', 'klimaatadaptatie',
    'afkoppelen', 'sleuven', 'kolken', 'leefomgeving', 'gebiedsontwikkeling',
    'terreininrichting', 'buitenterrein', 'civiele techniek', 'civiele werken',
    'betonbouw', 'infrastructuur', 'fietspaden', 'fietspad', 'trottoir', 'stoep',
    'parkeerterrein', 'straatreconstructie', 'pleininrichting', 'nutsleiding',
    'onderhoud wegen', 'voirie', 'civil engineering', 'earthworks', 'road construction',
    'sewer', 'stormwater',
  ]
  if (!GWW_SIGNALS.some(sig => lower.includes(sig))) return false
  const OFF_TOPIC = [
    /\b(software|saas|hosting|cloud\s+computing|applicatiebeheer|ict[-\s]?dienst)\b/i,
    /\b(website\s+ontwikkeling|app\s+ontwikkeling|software\s+ontwikkeling)\b/i,
    /\b(juridisch\s+advies|accountancy|auditing|vertaaldienst|catering)\b/i,
  ]
  if (!OFF_TOPIC.some(re => re.test(ruwe))) return true
  return /\b(weg|wegen|riool|asfalt|gww|civiel|bestrat|openbare\s+ruimte|herinrichting)\b/i.test(ruwe)
}

/**
 * Mercell’s DOM wisselt; link-gedreven extractie vangt meer dan alleen h2/h3-kaarten.
 * `ruwe_tekst` = hele rij/kaart zodat het GWW-profiel getoetst kan worden.
 */
const MERCELL_EXTRACT_RESULTS_JS = `(function() {
  var items = [];
  var seen = {};
  function pushItem(titel, ruwe, url, opdrachtgever, datum) {
    if (!url || seen[url]) return;
    var t = (titel || '').replace(/\\s+/g, ' ').trim();
    if (t.length < 6) return;
    seen[url] = true;
    items.push({
      titel: t.slice(0, 500),
      ruwe_tekst: (ruwe || t).slice(0, 4000),
      opdrachtgever: opdrachtgever || null,
      datum: datum || null,
      url: url
    });
  }
  var reHost = /mercell\\.(com|eu)|negometrix\\.com/i;
  var reSkipPath = /\\/(login|signin|register|help|support|search)(\\/|$|\\?)/i;
  var anchors = document.querySelectorAll('a[href]');
  for (var i = 0; i < anchors.length; i++) {
    var a = anchors[i];
    var href = a.href || '';
    if (!reHost.test(href)) continue;
    var path = '';
    try { path = new URL(href).pathname || ''; } catch (e) { continue; }
    if (path.length < 8 || reSkipPath.test(path + '/')) continue;
    var t = (a.innerText || a.textContent || '').replace(/\\s+/g, ' ').trim();
    var row = a.closest('tr, [role="row"], li, article, [class*="result"], [class*="item"], [class*="card"], [class*="list"], [class*="row"]');
    var blob = row ? row.innerText.replace(/\\s+/g, ' ').trim() : t;
    if (t.length < 8 && blob) t = blob.slice(0, 450);
    if (t.length < 8) continue;
    var orgEl = row ? row.querySelector('[class*="buyer"], [class*="authority"], [class*="org"], [class*="customer"], [class*="company"]') : null;
    var dateEl = row ? row.querySelector('[class*="date"], [class*="deadline"], time, [class*="closing"]') : null;
    pushItem(t, blob, href, orgEl ? orgEl.textContent.replace(/\\s+/g, ' ').trim() : null, dateEl ? dateEl.textContent.replace(/\\s+/g, ' ').trim() : null);
  }
  if (items.length === 0) {
    var cards = document.querySelectorAll('[class*="tender"], [class*="notice"], [class*="result"], [class*="card"], article, [class*="hit"]');
    for (var j = 0; j < cards.length; j++) {
      var card = cards[j];
      var linkEl = card.querySelector('a[href*="mercell"], a[href*="/tender"], a[href*="/notice"], a[href*="/Tender"]');
      if (!linkEl) continue;
      var titleEl = card.querySelector('h1, h2, h3, h4, [class*="title"], [class*="heading"]');
      var t2 = titleEl ? titleEl.textContent.replace(/\\s+/g, ' ').trim() : linkEl.textContent.replace(/\\s+/g, ' ').trim();
      pushItem(t2, card.innerText.replace(/\\s+/g, ' ').trim(), linkEl.href, null, null);
    }
  }
  return items;
})()`

/** Extraheer tender-links en basisgegevens van de huidige pagina. */
const MERCELL_EXTRACT_LIST_JS = `(function() {
  var items = [];
  var seen = {};
  var reSkipPath = /\\/(login|signin|register|help|support|account|identity|notifications|messages|profile|settings)(\\/|$|\\?)/i;
  var reDetailPath = /\\/(notice|tender|contract|opdracht|aanbesteding|publication)\\b/i;

  function add(titel, ruwe, href, org, datum) {
    titel = (titel || '').replace(/\\s+/g,' ').trim();
    if (!href || seen[href] || titel.length < 5) return;
    seen[href] = true;
    items.push({
      titel: titel.slice(0,500),
      ruwe_tekst: (ruwe || titel).slice(0,3000),
      opdrachtgever: org || null,
      datum: datum || null,
      url: href
    });
  }

  function rowTextFrom(el) {
    if (!el) return '';
    var cur = el;
    for (var i = 0; i < 6 && cur; i++) {
      var txt = (cur.innerText || cur.textContent || '').replace(/\\s+/g,' ').trim();
      if (txt.length >= 20) return txt;
      cur = cur.parentElement;
    }
    return '';
  }

  // Primair: links die naar een tender-detail wijzen
  var anchors = Array.from(document.querySelectorAll(
    'a[href*="/notice/"], a[href*="/tender/"], a[href*="/contract/"], a[href*="/publication/"], a[href]'
  ));
  anchors.forEach(function(a) {
    var href = a.href || '';
    if (!href) return;
    var pathname = '';
    try { pathname = new URL(href).pathname; } catch(e) { return; }
    if (pathname.length < 6 || reSkipPath.test(pathname + '/')) return;
    if (!reDetailPath.test(pathname) && !/\\/\\d{4,}/.test(pathname)) return;
    // Vermijd duidelijke niet-detail bestemmingen.
    if (/^\\/(today|search|discover|home|dashboard)\\/?$/i.test(pathname)) return;
    var row = a.closest('tr,[role="row"],li,article,[class*="result"],[class*="item"],[class*="card"],[class*="row"],[class*="tender"],[class*="notice"],[class*="list-item"]');
    var blob = row ? row.innerText.replace(/\\s+/g,' ').trim() : rowTextFrom(a);
    var t = (a.innerText||a.textContent||'').replace(/\\s+/g,' ').trim();
    if (t.length < 8 && blob) t = blob.slice(0,500);
    if (t.length < 5) return;
    var orgEl = row && row.querySelector('[class*="buyer"],[class*="authority"],[class*="org"],[class*="customer"],[class*="aanbestedende"],[class*="contracting"]');
    var dateEl = row && row.querySelector('[class*="date"],[class*="deadline"],time,[class*="closing"],[class*="expires"]');
    add(t, blob, href, orgEl&&orgEl.textContent.replace(/\\s+/g,' ').trim(), dateEl&&dateEl.textContent.replace(/\\s+/g,' ').trim());
  });

  // Fallback: kaarten/rijen zonder directe link-matchende path
  if (items.length === 0) {
    var cards = document.querySelectorAll('[class*="tender"],[class*="notice"],[class*="result"],[class*="card"],article,[class*="hit"],[data-testid*="result" i],[data-testid*="notice" i],[data-testid*="tender" i]');
    cards.forEach(function(card) {
      var linkEl = card.querySelector('a[href]');
      if (!linkEl) return;
      var p = '';
      try { p = new URL(linkEl.href || '').pathname; } catch(e) { return; }
      if (!reDetailPath.test(p) && !/\\/\\d{4,}/.test(p)) return;
      var titleEl = card.querySelector('h1,h2,h3,h4,[class*="title"],[class*="heading"],[class*="name"]');
      var t3 = titleEl ? titleEl.textContent.replace(/\\s+/g,' ').trim() : linkEl.textContent.replace(/\\s+/g,' ').trim();
      var blob = card.innerText.replace(/\\s+/g,' ').trim();
      if ((!t3 || t3.trim().length < 5) && blob) t3 = blob.slice(0, 500);
      add(t3, blob, linkEl.href, null, null);
    });
  }
  return items;
})()`


/** Detecteer en klik de "volgende pagina"-knop. Geeft true als geklikt. */
const MERCELL_CLICK_NEXT_PAGE_JS = `(function() {
  var all = Array.from(document.querySelectorAll('button,a,[role="button"],[role="link"]'));
  var btn = all.find(function(el) {
    var txt = (el.textContent || el.innerText || '').replace(/\\s+/g,' ').trim().toLowerCase();
    var aria = (el.getAttribute('aria-label') || '').toLowerCase();
    var testid = (el.getAttribute('data-testid') || '').toLowerCase();
    var name = (el.getAttribute('name') || '').toLowerCase();
    var disabled = el.disabled || el.getAttribute('aria-disabled') === 'true' || el.classList.contains('disabled');
    if (disabled) return false;
    return txt === 'volgende' || txt === 'next' || txt === '>' || txt === '»' ||
           aria.includes('next') || aria.includes('volgende') ||
           testid.includes('next') || testid.includes('next-page') || name.includes('nextpage') ||
           el.classList.contains('next') || el.getAttribute('rel') === 'next';
  });
  if (btn) { btn.click(); return true; }
  return false;
})()`

/** Detecteer of de pagina een "geen resultaten"-melding toont. */
const MERCELL_NO_RESULTS_JS = `(function() {
  var nodes = Array.from(document.querySelectorAll('[role="status"], [aria-live], [class*="empty" i], [class*="no-result" i], [class*="noResult" i], [data-testid*="empty" i], [data-testid*="no-result" i], p, div, span'));
  function visible(el) {
    if (!el) return false;
    if (el.offsetParent === null) return false;
    var st = window.getComputedStyle(el);
    return st && st.visibility !== 'hidden' && st.display !== 'none';
  }
  for (var i = 0; i < nodes.length; i++) {
    var el = nodes[i];
    if (!visible(el)) continue;
    var t = (el.textContent || '').replace(/\\s+/g, ' ').trim().toLowerCase();
    if (t.length < 3 || t.length > 120) continue;
    if (t === 'geen resultaten' || t === 'no results' || t === 'niets gevonden' || t === '0 resultaten' || t === '0 results') return true;
  }
  return false;
})()`

/**
 * Wist alleen vorige ZOEKTERM-chips op de Mercell-filterbalk.
 * "Inschrijving geopend" en andere status-/datumfilters worden BEWAARD:
 * zonder "Inschrijving geopend" toont /today alleen tenders van vandaag,
 * waardoor GWW-zoektermen altijd 0 resultaten geven.
 */
const MERCELL_CLEAR_FILTERS_JS = `(async function() {
  var sleep = function(ms) { return new Promise(function(r) { setTimeout(r, ms); }); };
  var clicked = 0;

  // Bewaar-lijst: chips die we NOOIT wissen (status/datum filters die het zoekveld breed houden).
  var KEEP_LABELS = [
    'inschrijving geopend', 'open for submission', 'submission open',
    'active', 'actief', 'lopend', 'open', 'gepubliceerd'
  ];
  function shouldKeep(chipEl) {
    var txt = (chipEl.textContent || chipEl.innerText || '').replace(/\\s+/g, ' ').trim().toLowerCase();
    return KEEP_LABELS.some(function(k) { return txt.indexOf(k) >= 0; });
  }

  // Zoek alle chip-sluitknoppen in de filterbalk.
  var chipSelectors = [
    '[class*="filter-chip"] button', '[class*="filterChip"] button',
    '[class*="active-filter"] button', '[class*="activeFilter"] button',
    '[class*="filter-tag"] button', '[class*="filterTag"] button',
    '[class*="selected-filter"] button',
    'button[aria-label*="verwijder filter" i]', 'button[aria-label*="remove filter" i]',
    'button[aria-label*="clear filter" i]', '[class*="chip--active"] button',
    '[class*="chip"][class*="close"]', '[class*="tag"][class*="remove"]'
  ];
  var chipBtns = Array.from(document.querySelectorAll(chipSelectors.join(', ')));
  for (var ci = 0; ci < chipBtns.length; ci++) {
    var btn = chipBtns[ci];
    // Controleer de chip zelf (parent) op bewaar-labels.
    var chip = btn.closest('[class*="chip"], [class*="filter-tag"], [class*="active-filter"], [class*="filter-chip"], [class*="selected-filter"]') || btn.parentElement;
    if (chip && shouldKeep(chip)) continue;
    try { btn.click(); clicked++; await sleep(250); } catch(e) {}
  }
  if (clicked > 0) { await sleep(900); return 'chips-' + clicked; }

  return 'no-filters';
})()`

/**
 * Leest het getoonde totaal aantal resultaten/aanbestedingen op de Mercell-zoekpagina (na filter-reset).
 * Retourneert het grootste plausibele getal (≥1000) uit teller-elementen of zinnen met "resultaat/tender/…".
 */
const MERCELL_READ_RESULT_TOTAL_JS = `(function() {
  function normNum(s) {
    if (!s) return NaN;
    s = String(s).replace(/\\s/g, '');
    if (/^\\d{1,3}([.,]\\d{3})+$/.test(s)) {
      return parseInt(s.replace(/[.,]/g, ''), 10);
    }
    var digits = s.replace(/[^\\d]/g, '');
    return digits ? parseInt(digits, 10) : NaN;
  }
  var candidates = [];
  function push(n, src) {
    if (typeof n !== 'number' || isNaN(n) || n < 1000) return;
    candidates.push({ n: n, src: (src || '').slice(0, 160) });
  }
  var els = document.querySelectorAll(
    '[class*="count" i], [class*="total" i], [class*="hits" i], [class*="results" i], ' +
    '[data-testid*="count" i], [data-testid*="total" i], [aria-live="polite"], ' +
    'header span, nav span, [role="status"]'
  );
  for (var e = 0; e < els.length; e++) {
    var t = (els[e].textContent || '').replace(/\\s+/g, ' ').trim();
    if (t.length > 120 || !/\\d/.test(t)) continue;
    var m = t.match(/(\\d{1,3}(?:[.,\\s]\\d{3})+|\\d{4,})/);
    if (!m) continue;
    var n = normNum(m[1]);
    if (/result|tender|aanbod|aanbest|gevonden|totaal|showing|matches|opportunit|found|uit\\s/i.test(t) || /^\\d/.test(t.trim())) {
      push(n, t);
    }
  }
  var body = document.body.innerText || '';
  var lines = body.split(/\\n/);
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (line.length > 220) continue;
    if (!/(resultaat|resultaten|tenders|aanbestedingen|opportunities|gevonden|total|matches|showing)/i.test(line)) continue;
    var mm = line.match(/(\\d{1,3}(?:[.,\\s]\\d{3})+|\\d{5,})/g);
    if (!mm) continue;
    for (var j = 0; j < mm.length; j++) {
      var n2 = normNum(mm[j]);
      push(n2, line);
    }
  }
  if (candidates.length === 0) return { total: null, hint: '' };
  candidates.sort(function(a, b) { return b.n - a.n; });
  return { total: candidates[0].n, hint: candidates[0].src };
})()`

/** Verwachting: ongefilterde Mercell-today toont doorgaans ruim meer dan dit aantal treffers. */
const MERCELL_MIN_EXPECTED_UNFILTERED_TOTAL = 17_000

/**
 * Verzamel tender-items door alle pagina's door te lopen.
 * Gebruikt paginering (klik "Volgende") i.p.v. infinite-scroll.
 */
async function mercellPaginateAndCollect(
  win: BrowserWindow,
  maxPages = 500
): Promise<{ titel: string; ruwe_tekst?: string; opdrachtgever?: string | null; datum?: string | null; url?: string }[]> {
  type TenderItem = { titel: string; ruwe_tekst?: string; opdrachtgever?: string | null; datum?: string | null; url?: string }
  const allItems: TenderItem[] = []
  const seenUrls = new Set<string>()

  for (let page = 1; page <= maxPages; page++) {
    await sleep(page === 1 ? 2000 : 2500) // pagina 1: SPA al opgewarmd door caller; pagina 2+: wacht na klik "volgende"
    try {
      await win.webContents.executeJavaScript(`(async function() {
        function sleep(ms){ return new Promise(function(r){ setTimeout(r, ms); }); }
        window.scrollTo(0, document.body.scrollHeight);
        await sleep(650);
        window.scrollTo(0, 0);
        await sleep(250);
      })()`)
    } catch { /* noop */ }

    // Sessie-controle per pagina
    const currentUrl = win.webContents.getURL()
    if (/login|identity\.s2c|Account\/Login|signin/i.test(currentUrl)) {
      log.warn(`Mercell paginering: sessie verlopen op pagina ${page} (${currentUrl})`)
      break
    }

    // Extraheer items van huidige pagina (2 strategieën combineren)
    let batch: TenderItem[] = []
    try {
      const batchA = (await win.webContents.executeJavaScript(MERCELL_EXTRACT_LIST_JS)) as TenderItem[]
      const batchB = (await win.webContents.executeJavaScript(MERCELL_EXTRACT_RESULTS_JS)) as TenderItem[]
      const merged = [...(Array.isArray(batchA) ? batchA : []), ...(Array.isArray(batchB) ? batchB : [])]
      const seenLocal = new Set<string>()
      batch = merged.filter((it) => {
        const key = (it?.url || it?.titel || '').trim()
        if (!key || seenLocal.has(key)) return false
        seenLocal.add(key)
        return true
      })
    } catch { /* noop */ }

    let nieuwOpPagina = 0
    if (Array.isArray(batch)) {
      for (const item of batch) {
        const key = item.url || item.titel
        if (!key || seenUrls.has(key)) continue
        seenUrls.add(key)
        allItems.push(item)
        nieuwOpPagina++
      }
    }

    log.info(`Mercell pagina ${page}: ${batch?.length ?? 0} items gevonden, ${nieuwOpPagina} nieuw`)

    // Niet vroegtijdig stoppen op "0 nieuw": sommige pagina's hebben wisselende rendering,
    // maar volgende pagina's kunnen wel degelijk extra resultaten bevatten.

    // Detectie alleen als diagnose; niet meer vroegtijdig stoppen op mogelijke vals-positieven.
    try {
      const noResults = await win.webContents.executeJavaScript(MERCELL_NO_RESULTS_JS)
      if (noResults) { log.info(`Mercell pagina ${page}: zichtbare 'geen resultaten'-melding gedetecteerd`) }
    } catch { /* noop */ }

    // Probeer naar volgende pagina te navigeren
    let clicked = false
    try {
      clicked = await win.webContents.executeJavaScript(MERCELL_CLICK_NEXT_PAGE_JS) as boolean
    } catch { /* noop */ }

    if (!clicked) {
      log.info(`Mercell: geen volgende-pagina-knop gevonden op pagina ${page} — alle beschikbare pagina's gescand`)
      break
    }
  }

  return allItems
}

async function scrapeMercellViaBrowser(
  zoektermen: string[],
  onProgress: (p: ScrapeProgress) => void,
  jobId: string
): Promise<RawTender[]> {
  const tenders: RawTender[] = []
  const seenUrls = new Set<string>()

  onProgress({ jobId, status: 'bezig', message: 'Mercell: browser openen...', found: 0 })

  const partition = 'persist:auth-mercell'
  const ses = session.fromPartition(partition)
  ses.setUserAgent(CHROME_LIKE_UA)

  const searchTerms = buildMercellSearchTerms(zoektermen)
  log.info(`Mercell: ${searchTerms.length} zoekvragen: ${searchTerms.join(', ')}`)

  /**
   * Mercell "Gepubliceerde Tenders": klik Filter → vul Zoekterm → +Toevoegen → groene Opslaan.
   * Pas daarna wordt de query uitgevoerd.
   */
  async function mercellRunFilterSearchQuery(win: BrowserWindow, term: string): Promise<boolean> {
    const termJson = JSON.stringify(term)
    const status = await win.webContents
      .executeJavaScript(
        `(async function() {
          var TERM = ${termJson};
          function sleep(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

          var all = Array.from(document.querySelectorAll('button, [role="button"], a[role="button"], a'));
          var rootDlg = document.querySelector('[role="dialog"]');
          if (!rootDlg) {
            var filterBtn = all.find(function(el) {
              if (!el || el.offsetParent === null || el.disabled) return false;
              var t = (el.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
              var aria = (el.getAttribute('aria-label') || '').toLowerCase();
              var title = (el.getAttribute('title') || '').toLowerCase();
              return t === 'filter' || t === 'filters' ||
                t.indexOf('filter') >= 0 || aria.indexOf('filter') >= 0 || title.indexOf('filter') >= 0;
            });
            if (filterBtn) {
              filterBtn.click();
              await sleep(1800);
              rootDlg = document.querySelector('[role="dialog"]');
            }
          }

          // Sommige Mercell-layouts gebruiken een inline filterpaneel i.p.v. role="dialog".
          var scope = rootDlg;
          if (!scope) {
            var regions = Array.from(document.querySelectorAll('section, aside, form, [role="region"], div'));
            scope = regions.find(function(el) {
              if (!el || el.offsetParent === null) return false;
              var txt = (el.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
              if (txt.length < 20 || txt.length > 5000) return false;
              var hasInput = !!el.querySelector('input[type="text"], input[type="search"], input:not([type])');
              var hasAdd = Array.from(el.querySelectorAll('button, [role="button"], a')).some(function(b) {
                var t = (b.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
                return t.indexOf('toevoegen') >= 0 || t.indexOf('add') >= 0;
              });
              var hasSave = Array.from(el.querySelectorAll('button, [role="button"], a')).some(function(b) {
                var t = (b.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
                return t === 'opslaan' || t === 'save' || t.indexOf('opslaan') >= 0 || t.indexOf('save') >= 0;
              });
              return hasInput && hasAdd && hasSave;
            }) || null;
          }
          if (!scope) return 'no-filter-panel';

          // Volgorde afdwingen: eerst bestaande zoekterm-chips in het paneel wissen.
          // 1. Probeer "Wissen / Clear all" knop in het paneel.
          var clearBtns = Array.from(scope.querySelectorAll('button, [role="button"], a'));
          var clearInPanel = clearBtns.find(function(el) {
            var t = (el.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
            if (!el.offsetParent || el.disabled) return false;
            if (/annuleren|cancel|sluit|close/.test(t)) return false;
            return t === 'wissen' || t === 'wis' || t === 'reset' || t === 'clear' ||
              t.indexOf('filters wissen') >= 0 || t.indexOf('wis alles') >= 0 || t.indexOf('clear all') >= 0;
          });
          if (clearInPanel) {
            clearInPanel.click();
            await sleep(900);
          }
          // 2. Verwijder ook losse zoekterm-chips (×-knoppen) in het paneel zodat vorige
          //    zoekwoorden niet ophopen en AND-logica triggeren → 0 resultaten.
          // Zoek alle knoppen met "verwijder/remove/×" karakteristieken, inclusief SVG-knoppen.
          var termChipBtns = Array.from(scope.querySelectorAll(
            'button[aria-label*="verwijder" i], button[aria-label*="remove" i], button[aria-label*="delete" i], ' +
            'button[aria-label*="wis" i], button[aria-label*="clear" i], ' +
            '[class*="tag"] button, [class*="chip"] button, [class*="token"] button, ' +
            '[class*="label"] button, [class*="badge"] button, ' +
            'button[class*="remove"], button[class*="delete"], button[class*="close"], ' +
            'button[class*="clear"]'
          )).concat(
            // Knoppen die enkel een × of ✕ bevatten (common React close button pattern).
            Array.from(scope.querySelectorAll('button')).filter(function(b) {
              var t = (b.textContent || '').replace(/\\s+/g, '').trim();
              return (t === '\u00d7' || t === '\u2715' || t === '\u2716' || t === 'x' || t === 'X') && b.offsetParent !== null && !b.disabled;
            })
          ).filter(function(b) {
            return b.offsetParent !== null && !b.disabled;
          });
          for (var tci = 0; tci < termChipBtns.length; tci++) {
            try { termChipBtns[tci].click(); await sleep(200); } catch(e) {}
          }
          if (termChipBtns.length > 0) {
            await sleep(500);
          }

          var input = null;
          var labels = scope.querySelectorAll('label');
          for (var li = 0; li < labels.length; li++) {
            if (!/zoekterm/i.test(labels[li].textContent || '')) continue;
            var fid = labels[li].getAttribute('for');
            if (fid) {
              input = document.getElementById(fid);
              if (input && input.offsetParent !== null) break;
            }
          }
          if (!input) {
            labels = document.querySelectorAll('label');
            for (var li2 = 0; li2 < labels.length; li2++) {
              if (!/zoekterm/i.test(labels[li2].textContent || '')) continue;
              var fr = labels[li2].getAttribute('for');
              if (fr) { input = document.getElementById(fr); if (input) break; }
            }
          }
          if (!input) {
            var candidates = scope.querySelectorAll('input[type="text"], input[type="search"], input:not([type])');
            for (var c = 0; c < candidates.length; c++) {
              var row = candidates[c].closest('div, tr, li, fieldset, form, section');
              if (row && /(zoekterm|zoekwoord|keyword|search)/i.test(row.innerText || '') && candidates[c].offsetParent !== null && !candidates[c].readOnly && !candidates[c].disabled) {
                input = candidates[c];
                break;
              }
            }
          }
          if (!input) {
            var inps = Array.from(scope.querySelectorAll('input[type="text"], input[type="search"]'));
            input = inps.find(function(i) {
              return i.offsetParent !== null && !i.disabled && !i.readOnly &&
                ((i.placeholder && /zoek|search|keyword|term/i.test(i.placeholder)) || (i.name && /search|zoek|query|term|keyword/i.test(i.name)));
            });
          }
          if (!input) {
            var directSelectors = [
              'input[type="search"]',
              'input[placeholder*="search" i]',
              'input[placeholder*="zoek" i]',
              'input[placeholder*="keyword" i]',
              'input[aria-label*="search" i]',
              'input[aria-label*="zoek" i]',
              'input[aria-label*="keyword" i]',
              'input[name*="search" i]',
              'input[name*="query" i]',
              'input[name*="keyword" i]',
              'input[id*="search" i]'
            ];
            for (var si = 0; si < directSelectors.length; si++) {
              var cand = scope.querySelector(directSelectors[si]) || document.querySelector(directSelectors[si]);
              if (cand && cand.offsetParent !== null && !cand.disabled && !cand.readOnly) {
                input = cand;
                break;
              }
            }
          }
          if (!input) return 'no-zoekterm-input';

          input.focus();
          var ns = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
          if (ns && ns.set) ns.set.call(input, TERM); else input.value = TERM;
          input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: TERM }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          await sleep(500);

          all = Array.from(scope.querySelectorAll('button, [role="button"], a[role="button"], a'));
          var toev = all.find(function(el) {
            var t = (el.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
            if (!el.offsetParent || el.disabled) return false;
            if (/automatisch|annuleren|cancel/.test(t)) return false;
            return t.indexOf('toevoegen') >= 0 || t.indexOf('add') >= 0;
          });
          if (!toev) return 'no-toevoegen';
          toev.click();
          await sleep(700);

          all = Array.from(scope.querySelectorAll('button, [role="button"], a[role="button"], a'));
          var save = all.find(function(el) {
            var t = (el.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
            if (!el.offsetParent || el.disabled) return false;
            if (/annuleren|cancel/.test(t)) return false;
            return t === 'opslaan' || t === 'save' || (t.indexOf('opslaan') >= 0 && t.length < 40) || (t.indexOf('save') >= 0 && t.length < 40);
          });
          if (!save) return 'no-opslaan';
          save.click();
          return 'ok';
        })()`
      )
      .catch(() => 'execute-error')

    if (status === 'ok') {
      log.info(`Mercell: Filter → Zoekterm → Toevoegen → Opslaan voor "${term.slice(0, 48)}"`)
      await sleep(5500)
      return true
    }
    log.warn(`Mercell: filter-zoekflow mislukt (${String(status)}) voor "${term.slice(0, 40)}" — status: ${String(status)}`)
    return false
  }

  async function mercellClearAllFilters(win: BrowserWindow): Promise<void> {
    try {
      const r = await win.webContents.executeJavaScript(MERCELL_CLEAR_FILTERS_JS)
      log.info(`Mercell: alle filters gewist (${r})`)
      await sleep(1500)
    } catch {
      /* noop */
    }
  }

  // ── Één browservenster voor alle zoektermen ─────────────────────────────────
  const win = new BrowserWindow({
    width: 1280,
    height: 900,
    show: true, // tijdelijk zichtbaar voor debugging — terug naar false na fix
    webPreferences: {
      partition,
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false,
    },
  })
  win.webContents.setUserAgent(CHROME_LIKE_UA)
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  /**
   * Wacht tot de lijst "Gepubliceerde Tenders" geladen is (knop Filter of titel in de pagina).
   */
  async function waitForMercellListUi(timeoutMs = 25000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs
    let navigatedToToday = false
    while (Date.now() < deadline) {
      const currentUrl = win.webContents.getURL()

      if (/identity\.s2c|Account\/Login/i.test(currentUrl)) {
        log.warn(`Mercell: sessie verlopen tijdens wachten op lijst (${currentUrl})`)
        return false
      }

      if (!currentUrl.includes('s2c.mercell.com/today') && !navigatedToToday) {
        log.info(`Mercell: SPA op "${currentUrl}" — navigeer naar /today`)
        try {
          await win.loadURL('https://s2c.mercell.com/today', { userAgent: CHROME_LIKE_UA })
        } catch { /* noop */ }
        navigatedToToday = true
        await sleep(3000)
        continue
      }

      const found = await win.webContents
        .executeJavaScript(`(function() {
          var body = document.body.innerText || '';
          if (/gepubliceerde\\s+tenders/i.test(body)) return true;
          var btns = Array.from(document.querySelectorAll('button, [role="button"], a[role="button"], a'));
          return btns.some(function(b) {
            var t = (b.textContent || '').replace(/\\s+/g, ' ').trim().toLowerCase();
            var aria = (b.getAttribute('aria-label') || '').toLowerCase();
            return (t === 'filter' || t === 'filters' || t.indexOf('filter') >= 0 || aria.indexOf('filter') >= 0) && b.offsetParent !== null;
          });
        })()`)
        .catch(() => false)

      if (found) return true
      await sleep(1500)
    }
    return false
  }

  /**
   * Na Toevoegen + Opslaan moet de actieve filterchip met zoekterm zichtbaar zijn.
   * Zonder deze bevestiging lezen we te vroeg uit en missen we resultaten.
   */
  async function waitForAppliedSearchTerm(term: string, timeoutMs = 12000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs
    const termLower = term.trim().toLowerCase()
    if (!termLower) return true
    while (Date.now() < deadline) {
      const applied = await win.webContents
        .executeJavaScript(`(function() {
          var term = ${JSON.stringify(termLower)};
          function visible(el) {
            if (!el || el.offsetParent === null) return false;
            var st = window.getComputedStyle(el);
            return st && st.visibility !== 'hidden' && st.display !== 'none';
          }
          var nodes = Array.from(document.querySelectorAll(
            '[class*="filter" i], [class*="chip" i], [class*="tag" i], [data-testid*="filter" i], [role="status"], h1, h2, h3, div, span'
          ));
          for (var i = 0; i < nodes.length; i++) {
            var el = nodes[i];
            if (!visible(el)) continue;
            var t = (el.textContent || '').replace(/\\s+/g, ' ').trim().toLowerCase();
            if (t.length < 3 || t.length > 240) continue;
            if (t.indexOf('filter') >= 0 && t.indexOf(term) >= 0) return true;
            if (t === term || t.indexOf(' ' + term + ' ') >= 0 || t.endsWith(' ' + term) || t.startsWith(term + ' ')) {
              var parentTxt = ((el.parentElement && el.parentElement.textContent) || '').toLowerCase();
              if (parentTxt.indexOf('filter') >= 0 || /chip|tag/.test((el.className || '').toLowerCase())) return true;
            }
          }
          return false;
        })()`)
        .catch(() => false)
      if (applied) return true
      await sleep(700)
    }
    return false
  }

  try {
    // Stap 1: eerste load — laat de SPA de OAuth-flow volledig afhandelen.
    // Mercell redirect geauthenticeerde gebruikers naar /organization/.../work/...
    // Na deze redirect is de SPA volledig geïnitialiseerd.
    await win.loadURL('https://s2c.mercell.com/today', { userAgent: CHROME_LIKE_UA })
    await sleep(8000) // ruim wachten: OAuth-redirect + SPA-bootstrap (~7 sec)

    // ── Login-redirect detectie ────────────────────────────────────────────────
    const landingUrl = win.webContents.getURL()
    if (/login|identity\.s2c|Account\/Login|signin|aanmelden/i.test(landingUrl)) {
      log.warn(`Mercell: sessie niet actief — redirect naar ${landingUrl}`)
      markSiteAsLoggedOut('mercell', 'Mercell (Negometrix)')
      onProgress({
        jobId, status: 'fout',
        message: 'Mercell: niet ingelogd. Ga naar de Tracking-pagina en klik "Inloggen" bij Mercell.',
        found: 0,
      })
      return tenders
    }
    try {
      const pageTitle = await win.webContents.executeJavaScript('document.title || ""')
      if (/inloggen|log in|sign in|privacyverklaring|privacy policy/i.test(String(pageTitle))) {
        log.warn(`Mercell: login/privacy-pagina geladen: "${pageTitle}"`)
        markSiteAsLoggedOut('mercell', 'Mercell (Negometrix)')
        onProgress({
          jobId, status: 'fout',
          message: `Mercell: niet ingelogd ("${pageTitle}"). Klik "Inloggen" bij Mercell.`,
          found: 0,
        })
        return tenders
      }
    } catch { /* noop */ }
    // ──────────────────────────────────────────────────────────────────────────

    markSiteAsLoggedIn('mercell', 'Mercell (Negometrix)')
    log.info(`Mercell: na eerste load beland op "${landingUrl}"`)

    // Stap 2: navigeer opnieuw naar /today nu de SPA volledig geïnitialiseerd is.
    // De eerste load leidde waarschijnlijk naar /organization/.../work/...;
    // een tweede navigatie naar /today zou de discovery-pagina moeten renderen.
    if (!landingUrl.includes('s2c.mercell.com/today')) {
      log.info('Mercell: tweede navigatie naar /today (SPA geïnitialiseerd)')
      try {
        await win.loadURL('https://s2c.mercell.com/today', { userAgent: CHROME_LIKE_UA })
      } catch { /* noop */ }
      await sleep(5000)
      const urlNa = win.webContents.getURL()
      log.info(`Mercell: URL na tweede navigatie: "${urlNa}"`)
    }

    // Stap 3: wacht tot "Gepubliceerde Tenders" / Filter-knop zichtbaar is.
    onProgress({ jobId, status: 'bezig', message: 'Mercell: zoekpagina laden…', found: 0 })
    const listUiReady = await waitForMercellListUi(15000)

    // Eerst alle actieve pagina-filters wissen (chips, datum, "alles wissen"), daarna pas het zoekveld.
    // Zo begint de eerste zoekterm op een schone zoekpagina; we zetten geen nieuwe filters (zoals taal).
    onProgress({ jobId, status: 'bezig', message: 'Mercell: filters op zoekpagina wissen…', found: 0 })
    try {
      const filterResult = await win.webContents.executeJavaScript(MERCELL_CLEAR_FILTERS_JS)
      log.info(`Mercell: filters gewist vóór eerste zoekterm (${filterResult})`)
      await sleep(1200)
      // SPA kan het totaal pas na korte vertraging bijwerken
      await sleep(2000)
      try {
        const countInfo = (await win.webContents.executeJavaScript(MERCELL_READ_RESULT_TOTAL_JS)) as {
          total: number | null
          hint: string
        }
        if (countInfo.total != null) {
          if (countInfo.total > MERCELL_MIN_EXPECTED_UNFILTERED_TOTAL) {
            log.info(
              `Mercell check: geteld totaal op pagina ≈ ${countInfo.total} (>${MERCELL_MIN_EXPECTED_UNFILTERED_TOTAL}, OK)${countInfo.hint ? ` — "${countInfo.hint.slice(0, 100)}"` : ''}`
            )
          } else {
            log.warn(
              `Mercell check: geteld totaal op pagina ≈ ${countInfo.total} (verwacht >${MERCELL_MIN_EXPECTED_UNFILTERED_TOTAL} na gewiste filters)${countInfo.hint ? ` — "${countInfo.hint.slice(0, 100)}"` : ''}`
            )
          }
        } else {
          log.warn(
            'Mercell check: kon het totaal aantal resultaten op de pagina niet betrouwbaar uitlezen na filters wissen — controleer handmatig of er ~17k+ treffers staan.'
          )
        }
      } catch {
        log.warn('Mercell check: fout bij uitlezen totaal op pagina')
      }
    } catch { /* noop */ }

    if (!listUiReady) {
      try {
        const diagUrl = win.webContents.getURL()
        const diagTitle = await win.webContents.executeJavaScript('document.title || ""')
        log.warn(`Mercell: lijst-UI niet gereed (geen Filter / "Gepubliceerde Tenders"). URL="${diagUrl}" title="${diagTitle}"`)
      } catch { /* noop */ }
    }

    // ── Zoeklus: Filters wissen → Filter → Zoekterm → Toevoegen → Opslaan → data scrapen ──
    for (let ti = 0; ti < searchTerms.length; ti++) {
      const term = searchTerms[ti]
      onProgress({
        jobId,
        status: 'bezig',
        message: `Mercell (${ti + 1}/${searchTerms.length}): "${term}" (filterpaneel)…`,
        found: tenders.length,
      })

      try {
        // Voor ELKE zoekterm dezelfde vaste volgorde: eerst filters wissen.
        onProgress({ jobId, status: 'bezig', message: `Mercell: filters wissen vóór "${term}"…`, found: tenders.length })
        await mercellClearAllFilters(win)
        await sleep(1600)

        let results: {
          titel: string
          ruwe_tekst?: string
          opdrachtgever?: string | null
          datum?: string | null
          url?: string
        }[] = []

        if (listUiReady) {
          const ran = await mercellRunFilterSearchQuery(win, term)
          if (!ran) {
            log.warn(`Mercell "${term}": query niet uitgevoerd (Toevoegen/Opslaan stap niet rond) — term overgeslagen`)
            continue
          }
          const applied = await waitForAppliedSearchTerm(term, 12000)
          if (!applied) {
            log.warn(`Mercell "${term}": zoekterm niet zichtbaar als actieve filter na Opslaan — term overgeslagen`)
            continue
          }
        } else {
          log.warn(`Mercell "${term}": lijst-UI was niet gereed — paginering zonder filter (fallback)`)
        }

        const domBatch = await mercellPaginateAndCollect(win)
        results = domBatch

        log.info(`Mercell "${term}": ${results.length} hits (DOM)`)

        let nieuw = 0; let dubbel = 0; let gefilterd = 0
        for (const item of results) {
          if (!item.titel) continue
          const bron = mercellDetailUrl(item.url)
          if (!bron?.trim()) continue

          // Titelfilter: zoekterm moet expliciet in de header staan
          if (!titleMatchesSearchTerm(item.titel, term, item.ruwe_tekst)) {
            gefilterd++
            log.info(`Mercell "${term}": overgeslagen (zoekterm niet in titel/tekst) — "${item.titel.slice(0, 80)}"`)
            continue
          }

          if (seenUrls.has(bron)) { dubbel++; continue }
          seenUrls.add(bron)
          nieuw++
          const ruwe = (item.ruwe_tekst || item.titel).trim()
          tenders.push({
            titel: item.titel,
            beschrijving: ruwe.slice(0, 2000),
            opdrachtgever: item.opdrachtgever || undefined,
            sluitingsdatum: item.datum || undefined,
            bron_url: bron,
            type_opdracht: 'Werken',
            regio: 'Nederland',
            ruwe_tekst: ruwe,
          })
        }

        log.info(`Mercell "${term}": ${results.length} hits → ${nieuw} nieuw, ${dubbel} dubbel, ${gefilterd} gefilterd (titel/tekst)`)

        // Debug: log eerste item van eerste zoekterm
        if (results.length > 0 && ti === 0) {
          log.info(`Mercell debug eerste item: ${JSON.stringify(results[0]).slice(0, 300)}`)
        }
      } catch (err: any) {
        log.warn(`Mercell scrape voor "${term}" mislukt:`, err.message)
      }
    }
    // ──────────────────────────────────────────────────────────────────────────

  } finally {
    try { win.webContents.debugger.detach() } catch { /* noop */ }
    win.close()
  }

  log.info(`Mercell totaal: ${tenders.length} unieke aanbestedingen na ${searchTerms.length} zoekvragen`)
  return tenders
}


// =============================================================================
// Generic browser-based scraper for custom sources
// =============================================================================
async function scrapeGenericViaBrowser(
  source: BronWebsite,
  zoektermen: string[],
  onProgress: (p: ScrapeProgress) => void,
  jobId: string
): Promise<RawTender[]> {
  const tenders: RawTender[] = []

  onProgress({ jobId, status: 'bezig', message: `${source.naam}: openen via browser...`, found: 0 })

  const partition = source.auth_type !== 'none' ? `persist:auth-${source.id}` : undefined

  const win = new BrowserWindow({
    width: 1280,
    height: 900,
    show: false,
    webPreferences: {
      partition,
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false,
    },
  })

  try {
    await win.loadURL(source.url)
    await sleep(5000) // Wait for page to render

    // Extract all links and text content
    const pageContent = await win.webContents.executeJavaScript(`
      (function() {
        const links = [];
        document.querySelectorAll('a').forEach(a => {
          const text = a.textContent.trim();
          if (text.length > 10 && a.href && a.href.startsWith('http')) {
            links.push({ text: text.slice(0, 500), url: a.href });
          }
        });
        return { links, bodyText: document.body.innerText.slice(0, 50000) };
      })()
    `)

    if (pageContent?.links) {
      for (const link of pageContent.links) {
        if (
          qualifiesVoorVanDeKreekeScrape({ titel: link.text, beschrijving: link.text }, zoektermen)
        ) {
          tenders.push({
            titel: link.text,
            bron_url: link.url,
            type_opdracht: 'Werken',
          })
        }
      }
    }

    log.info(`Generic scrape ${source.naam}: found ${tenders.length} relevant links`)
  } catch (error: any) {
    log.warn(`Generic browser scrape for ${source.naam} failed:`, error.message)
  } finally {
    win.close()
  }

  return tenders
}

// =============================================================================
// Canonical bron-URL (detailpagina met tabs & documenten)
// =============================================================================
function canonicalTenderNedDetailUrl(publicatieId: string, apiLink?: string): string {
  const canonical = `https://www.tenderned.nl/aankondigingen/overzicht/${publicatieId}`
  if (!apiLink || typeof apiLink !== 'string') return canonical
  try {
    const u = new URL(apiLink, 'https://www.tenderned.nl')
    const host = u.hostname.replace(/^www\./i, '')
    if (
      host.includes('tenderned.nl') &&
      (u.pathname.includes(String(publicatieId)) || u.pathname.includes('/aankondigingen/'))
    ) {
      u.hash = ''
      const pathClean = (u.pathname || '/').replace(/\/+$/, '') || '/'
      return `${u.origin}${pathClean}`
    }
  } catch {
    /* use canonical */
  }
  return canonical
}

function canonicalTedNoticeUrl(pubNumber: string, noticeId: string): string | undefined {
  const id = (pubNumber && pubNumber.trim()) || (noticeId && noticeId.trim())
  if (!id) return undefined
  return `https://ted.europa.eu/nl/notice/-/detail/${id}`
}

function mercellDetailUrl(href: string | null | undefined): string | undefined {
  if (!href || typeof href !== 'string') return undefined
  try {
    const u = new URL(href, 'https://s2c.mercell.com')
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return undefined
    return u.href
  } catch {
    return undefined
  }
}

// =============================================================================
// Utility
// =============================================================================
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
