/**
 * SQLite `datetime('now')` / kolom-defaults zijn UTC, zonder `Z`-suffix.
 * `new Date('2026-04-18 23:10:04')` wordt in veel engines als **lokale** tijd gelezen → verkeerde klok op de diagnosepagina.
 */
export function parseSqliteUtcToDate(input: string): Date | null {
  const s = input.trim()
  if (!s) return null
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
    const d = new Date(s)
    return Number.isNaN(d.getTime()) ? null : d
  }
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/)
  if (m) {
    const d = new Date(
      Date.UTC(
        Number(m[1]),
        Number(m[2]) - 1,
        Number(m[3]),
        Number(m[4]),
        Number(m[5]),
        m[6] != null ? Number(m[6]) : 0,
      ),
    )
    return Number.isNaN(d.getTime()) ? null : d
  }
  const fallback = new Date(s)
  return Number.isNaN(fallback.getTime()) ? null : fallback
}

/** `formatEuropeanDateTime` na UTC-parse van SQLite-teksten. */
export function formatDateTimeNlFromSqliteUtc(input?: string | null): string {
  if (!input) return '-'
  const d = parseSqliteUtcToDate(String(input))
  if (!d) return String(input)
  return formatEuropeanDateTime(d)
}

/**
 * Parseert datums zoals ze in tenders voorkomen: eerst **dd-MM-yyyy** (Nederlandse volgorde),
 * daarna **yyyy-MM-dd** als kalenderdag in lokale tijd (voorkomt dat `08-03-2026` als US-datum wordt gelezen),
 * daarna `Date` voor overige ISO-/API-strings.
 */
export function parseTenderDisplayDate(input: string): Date | null {
  const raw = input.trim()
  if (!raw) return null
  const normalized = raw.replace(/(\.\d{3})\d+/g, '$1')

  const dm = normalized.match(
    /^(\d{1,2})-(\d{1,2})-(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/,
  )
  if (dm) {
    const d = new Date(
      Number(dm[3]),
      Number(dm[2]) - 1,
      Number(dm[1]),
      dm[4] ? Number(dm[4]) : 0,
      dm[5] ? Number(dm[5]) : 0,
      dm[6] ? Number(dm[6]) : 0,
    )
    return Number.isNaN(d.getTime()) ? null : d
  }

  const iso = normalized.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2})(?::(\d{2}))?)?/)
  if (iso) {
    const hasClock = iso[4] != null
    if (hasClock) {
      const h = parseInt(iso[4], 10)
      const mi = parseInt(iso[5], 10)
      const sec = iso[6] != null ? parseInt(iso[6], 10) : 0
      if (h !== 0 || mi !== 0 || sec !== 0) {
        const d = new Date(normalized)
        return Number.isNaN(d.getTime()) ? null : d
      }
    }
    const d = new Date(
      Number(iso[1]),
      Number(iso[2]) - 1,
      Number(iso[3]),
      iso[4] != null ? parseInt(iso[4], 10) : 0,
      iso[5] != null ? parseInt(iso[5], 10) : 0,
      iso[6] != null ? parseInt(iso[6], 10) : 0,
    )
    return Number.isNaN(d.getTime()) ? null : d
  }

  const d = new Date(normalized)
  return Number.isNaN(d.getTime()) ? null : d
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** Europese notatie: dd-MM-yyyy */
export function formatEuropeanDateOnly(d: Date): string {
  return `${pad2(d.getDate())}-${pad2(d.getMonth() + 1)}-${d.getFullYear()}`
}

/** Europese notatie: dd-MM-yyyy HH:mm (24 uur, lokale tijd) */
export function formatEuropeanDateTime(d: Date): string {
  return `${formatEuropeanDateOnly(d)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

function isoSourceHasSignificantTime(raw: string): boolean {
  if (!/T\s*\d/.test(raw)) return false
  const t = raw.match(/T(\d{2}):(\d{2})(?::(\d{2}))?/)
  if (!t) return false
  const h = parseInt(t[1], 10)
  const m = parseInt(t[2], 10)
  const sec = t[3] ? parseInt(t[3], 10) : 0
  if (h !== 0 || m !== 0 || sec !== 0) return true
  return /\.\d*[1-9]/.test(raw)
}

/**
 * Datum voor kaarten/lijsten: dd-MM-yyyy, of dd-MM-yyyy HH:mm als de bron een tijd heeft.
 */
export function formatDate(dateStr?: string | null): string {
  if (!dateStr) return '-'
  const raw = String(dateStr).trim()
  const d = parseTenderDisplayDate(raw)
  if (!d) return raw
  if (isoSourceHasSignificantTime(raw)) return formatEuropeanDateTime(d)
  return formatEuropeanDateOnly(d)
}

/** Altijd datum + tijd, dd-MM-yyyy HH:mm */
export function formatDateTime(dateStr?: string | null): string {
  if (!dateStr) return '-'
  const raw = String(dateStr).trim()
  const d = parseTenderDisplayDate(raw)
  if (!d) return raw
  return formatEuropeanDateTime(d)
}
