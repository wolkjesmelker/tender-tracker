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

/** ISO / API-string → Date; knipt lange fractionele seconden voor betrouwbare parsing. */
function parseDisplayDate(input: string): Date | null {
  const s = input.trim()
  if (!s) return null
  const normalized = s.replace(/(\.\d{3})\d+/g, '$1')
  const d = new Date(normalized)
  if (Number.isNaN(d.getTime())) return null
  return d
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
  const d = parseDisplayDate(raw)
  if (!d) return raw
  if (isoSourceHasSignificantTime(raw)) return formatEuropeanDateTime(d)
  return formatEuropeanDateOnly(d)
}

/** Altijd datum + tijd, dd-MM-yyyy HH:mm */
export function formatDateTime(dateStr?: string | null): string {
  if (!dateStr) return '-'
  const raw = String(dateStr).trim()
  const d = parseDisplayDate(raw)
  if (!d) return raw
  return formatEuropeanDateTime(d)
}
