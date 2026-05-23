import L from 'leaflet'
import type { Aanbesteding, AiExtractedTenderFields } from '../../../shared/types'
import { parseEuroAmount } from '../../../shared/parse-euro-amount'

export interface TenderMapItem {
  tender: Aanbesteding
  extracted: AiExtractedTenderFields | null
  /** Berekende plaatsnaam voor de card. */
  plaats: string
  /** Bedrag in euro's (best-effort, null als niet te bepalen). */
  bedrag: number | null
  bedragLabel: string | null
  startDatum: string | null
  eindDatum: string | null
  hasCoords: boolean
  countryGroup: 'nl' | 'be' | 'overig'
}

const NL_POSTCODE = /\b\d{4}\s?[A-Z]{2}\b/i
const PLAATS_FALLBACK = /([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ' -]{2,})\s*$/

function safeParseExtracted(json?: string | null): AiExtractedTenderFields | null {
  if (!json?.trim()) return null
  try {
    const parsed = JSON.parse(json)
    return parsed && typeof parsed === 'object' ? (parsed as AiExtractedTenderFields) : null
  } catch {
    return null
  }
}

function extractCity(text: string): string {
  const t = text.trim()
  if (!t) return ''
  // Adres: probeer plaatsnaam achter postcode te halen.
  const pc = t.match(/\b\d{4}\s?[A-Z]{2}\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ' -]{2,})/i)
  if (pc?.[1]) return pc[1].split(',')[0].trim()
  // BE-postcode: "1000 Brussel"
  const be = t.match(/\b\d{4}\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ' -]{2,})/)
  if (be?.[1]) return be[1].split(',')[0].trim()
  // Laatste segment van komma-gescheiden adres
  const segs = t.split(',').map((s) => s.trim()).filter(Boolean)
  if (segs.length > 1) {
    const last = segs[segs.length - 1]
    if (/(nederland|belg)/i.test(last) && segs.length >= 2) return segs[segs.length - 2]
    if (last.length > 2) return last
  }
  const m = t.match(PLAATS_FALLBACK)
  return m?.[1]?.trim() || t
}

function formatCurrencyEur(n: number): string {
  return new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n)
}

export function buildTenderMapItem(t: Aanbesteding): TenderMapItem {
  const extracted = safeParseExtracted(t.ai_extracted_fields)
  const adres = (extracted?.opdrachtgever_adres || '').trim()
  const locatie = (extracted?.locatie_of_regio || '').trim()
  const regio = (t.regio || '').trim()
  const plaats = adres
    ? extractCity(adres)
    : locatie || regio || (t.opdrachtgever || '')

  const ramingRaw = (extracted?.geraamde_waarde || t.geraamde_waarde || '').trim()
  const bedrag = parseEuroAmount(ramingRaw)

  const start = extracted?.datum_start_uitvoering || null
  const eind = extracted?.datum_einde_uitvoering || null

  const hasCoords =
    typeof t.map_lat === 'number' &&
    typeof t.map_lng === 'number' &&
    Number.isFinite(t.map_lat) &&
    Number.isFinite(t.map_lng)

  let countryGroup: 'nl' | 'be' | 'overig' = 'overig'
  const cc = (t.map_country_code || '').toLowerCase()
  if (cc === 'nl') countryGroup = 'nl'
  else if (cc === 'be') countryGroup = 'be'
  else {
    const hint = `${t.bron_website_id || ''} ${t.bron_website_naam || ''} ${adres} ${locatie} ${regio}`.toLowerCase()
    if (/belg|brussel|wallon|vlaand|publicprocurement|bosa/.test(hint)) countryGroup = 'be'
    else if (/nederland|tenderned|negometrix|mercell\.nl|\.nl|pianoo/.test(hint) || NL_POSTCODE.test(adres)) countryGroup = 'nl'
  }

  return {
    tender: t,
    extracted,
    plaats: plaats || '—',
    bedrag,
    bedragLabel: bedrag != null ? formatCurrencyEur(bedrag) : ramingRaw || null,
    startDatum: start,
    eindDatum: eind,
    hasCoords,
    countryGroup,
  }
}

/** Score → kleurpalet (border, achtergrond en tekstkleur). */
export function getScorePalette(score: number | null | undefined): {
  hex: string
  bg: string
  badge: string
  ring: string
  label: 'hoog' | 'middel' | 'laag' | 'onbekend'
} {
  if (score == null) {
    return {
      hex: '#94a3b8',
      bg: 'bg-slate-100 dark:bg-slate-800/60',
      badge: 'bg-slate-400 text-white',
      ring: 'ring-slate-300 dark:ring-slate-600',
      label: 'onbekend',
    }
  }
  if (score >= 70) {
    return {
      hex: '#16a34a',
      bg: 'bg-emerald-50 dark:bg-emerald-950/40',
      badge: 'bg-emerald-500 text-white',
      ring: 'ring-emerald-400/60',
      label: 'hoog',
    }
  }
  if (score >= 40) {
    return {
      hex: '#ca8a04',
      bg: 'bg-amber-50 dark:bg-amber-950/40',
      badge: 'bg-amber-500 text-white',
      ring: 'ring-amber-400/60',
      label: 'middel',
    }
  }
  return {
    hex: '#dc2626',
    bg: 'bg-rose-50 dark:bg-rose-950/40',
    badge: 'bg-rose-500 text-white',
    ring: 'ring-rose-400/60',
    label: 'laag',
  }
}

/** Basisformaat; geselecteerd: 1.3× (onderscheid t.o.v. buren) */
const TRI_W = 44
const TRI_H = 40
const SELECTED_SCALE = 1.3
const VIEW_W = 44
const VIEW_H = 40

/**
 * Driehoek met punt naar beneden; score in de driehoek. `iconAnchor` = onderpunt voor kaartanker.
 */
export function createTenderScoreTriangleIcon(
  score: number | null | undefined,
  palette: ReturnType<typeof getScorePalette>,
  isSelected: boolean,
): L.DivIcon {
  const label = score != null && Number.isFinite(score) ? String(Math.round(score)) : '—'
  const strokeW = isSelected ? 2.5 : 2
  const w = isSelected ? Math.round(TRI_W * SELECTED_SCALE) : TRI_W
  const h = isSelected ? Math.round(TRI_H * SELECTED_SCALE) : TRI_H
  const fontSize = label.length >= 3 ? 10.5 : 12.5
  /** Dichter bij de brede bovenkant, ver van de onderpunt (Landgraaf/labels op de kaart). */
  const textY = 11.5
  const wrapClass = isSelected
    ? 'tender-map-triangle-wrap tender-map-triangle-wrap--selected'
    : 'tender-map-triangle-wrap'

  const svg = `<svg width="${w}" height="${h}" viewBox="0 0 ${VIEW_W} ${VIEW_H}" xmlns="http://www.w3.org/2000/svg" style="display:block" aria-hidden="true">
  <polygon points="5,1.5 39,1.5 22,35.5" fill="${palette.hex}" stroke="#ffffff" stroke-width="${strokeW}" stroke-linejoin="round"/>
  <text x="22" y="${textY}" text-anchor="middle" dominant-baseline="middle" font-size="${fontSize}" font-weight="800" fill="#ffffff" stroke="rgba(0,0,0,0.32)" stroke-width="0.55" paint-order="stroke fill" font-family="ui-sans-serif,system-ui,sans-serif">${label}</text>
</svg>`

  const html = `<div class="${wrapClass}" style="width:${w}px;height:${h}px;line-height:0">${svg}</div>`

  return L.divIcon({
    className: 'tender-map-triangle-icon',
    html,
    iconSize: [w, h],
    iconAnchor: [w / 2, h],
    tooltipAnchor: [0, -h + 10],
  })
}
