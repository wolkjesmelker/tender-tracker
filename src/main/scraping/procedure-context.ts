import type { BronNavigatieLink, TenderProcedureContext, ProcedureTimelineStep } from '../../shared/types'

function str(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined
  if (typeof v === 'string') return v.trim() || undefined
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return undefined
}

/** Type publicatie object uit TNS JSON */
function typePubLabel(v: unknown): { oms?: string; code?: string } {
  if (typeof v === 'string') return { oms: v.trim() || undefined }
  if (!v || typeof v !== 'object') return {}
  const o = v as Record<string, unknown>
  return {
    oms: str(o.omschrijving) || str(o.naam),
    code: str(o.code),
  }
}

/**
 * Bouwt TenderProcedureContext uit ruwe TenderNed TNS publicatie-detail (`d`).
 */
export function buildTenderProcedureContextFromTnsApi(
  d: Record<string, unknown>,
  opts: { publicatieId: string; bronUrl: string }
): TenderProcedureContext {
  const tp = typePubLabel(d.typePublicatie)
  const highlights = {
    kenmerk: str(d.kenmerk),
    procedureCode: str(d.procedureCode),
    typePublicatie: tp.oms,
    typePublicatieCode: tp.code,
    aanbestedingStatus: str(d.aanbestedingStatus),
    typeOpdrachtCode: str(d.typeOpdrachtCode),
    publicatieDatum: str(d.publicatieDatum),
    sluitingsDatum: str(d.sluitingsDatum),
    sluitingsDatumMarktconsultatie: str(d.sluitingsDatumMarktconsultatie),
    cpvCodes: d.cpvCodes,
    nutsCodes: d.nutsCodes,
  }

  const timeline: ProcedureTimelineStep[] = []

  if (highlights.publicatieDatum) {
    timeline.push({
      id: 'publicatie',
      label: 'Publicatie',
      date: highlights.publicatieDatum,
      detail: 'Aankondiging staat online (TenderNed).',
    })
  }

  if (highlights.sluitingsDatumMarktconsultatie) {
    timeline.push({
      id: 'marktconsultatie',
      label: 'Marktconsultatie',
      date: highlights.sluitingsDatumMarktconsultatie,
      detail: 'Sluitingsdatum marktconsultatie (indien van toepassing).',
    })
  }

  if (highlights.sluitingsDatum) {
    timeline.push({
      id: 'inschrijving',
      label: 'Sluiting inschrijving',
      date: highlights.sluitingsDatum,
      detail: 'Deadline voor het indienen van inschrijvingen.',
    })
  }

  if (highlights.aanbestedingStatus) {
    timeline.push({
      id: 'status',
      label: 'Status',
      detail: highlights.aanbestedingStatus,
    })
  }

  if (timeline.length === 0) {
    timeline.push({
      id: 'api',
      label: 'Procedure (API)',
      detail:
        'Geen afzonderlijke mijlpaaldatums in de TenderNed-respons. Zie het overzicht met kenmerk, procedure en CPV hierboven; gebruik de bronlink voor volledige planning.',
    })
  }

  return {
    source: 'tenderned',
    lastSynced: new Date().toISOString(),
    bronUrl: opts.bronUrl,
    publicatieId: opts.publicatieId,
    apiHighlights: highlights,
    timeline,
    portals: [],
  }
}

/** Minimale context voor niet-TNS bronnen (later aanvulbaar met links). */
export function buildMinimalProcedureContext(bronUrl: string): TenderProcedureContext {
  return {
    source: 'overig',
    lastSynced: new Date().toISOString(),
    bronUrl,
    timeline: [
      {
        id: 'bron',
        label: 'Bron',
        detail:
          'Geen gestructureerde procedure-data van TenderNed-API. Gebruik de bronlink en gerelateerde links hieronder.',
      },
    ],
    portals: [],
  }
}

/** Voeg portal-links toe (dedupe op url). */
export function mergeProcedurePortals(
  ctx: TenderProcedureContext,
  links: BronNavigatieLink[]
): TenderProcedureContext {
  const seen = new Set<string>()
  const portals: BronNavigatieLink[] = [...(ctx.portals || [])]
  for (const p of portals) {
    if (p.url) seen.add(p.url.split('?')[0])
  }
  for (const L of links) {
    if (!L?.url) continue
    const k = L.url.split('?')[0]
    if (seen.has(k)) continue
    seen.add(k)
    portals.push(L)
  }
  return { ...ctx, portals }
}

/** Koppel navigatielinks aan tijdslijnstappen op basis van categorie-URL. */
export function attachLinksToTimeline(
  ctx: TenderProcedureContext,
  links: BronNavigatieLink[]
): TenderProcedureContext {
  if (!links.length) return ctx
  const ext = /mercell|negometrix|s2c\.|eu\s*\/|eforms|ted\.europa/i
  const tnDoc = /tenderned.*document|\/documenten\//i
  const timeline = ctx.timeline.map((step): ProcedureTimelineStep => {
    const stepLinks: { titel: string; url: string }[] = [...(step.links || [])]
    const pushL = (titel: string, url: string) => {
      if (!url || stepLinks.some((x) => x.url === url)) return
      stepLinks.push({ titel, url })
    }

    for (const L of links) {
      const u = L.url
      const cat = (L.categorie || '').toLowerCase()
      if (step.id === 'publicatie' && (tnDoc.test(u) || cat.includes('document'))) {
        pushL(L.titel || L.categorie, u)
      }
      if (step.id === 'inschrijving' && (cat.includes('platform') || ext.test(u))) {
        pushL(L.titel || L.categorie, u)
      }
      if (step.id === 'bron' || step.id === 'status') {
        if (ext.test(u) || cat.includes('extern')) pushL(L.titel || L.categorie, u)
      }
    }

    return stepLinks.length ? { ...step, links: stepLinks } : step
  })

  return { ...ctx, timeline }
}
