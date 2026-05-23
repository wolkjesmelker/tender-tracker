import React, { useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  X,
  Printer,
  Download,
  FileText,
  Loader2,
  ClipboardList,
  MapPin,
  Building2,
  Briefcase,
  CalendarClock,
  CalendarCheck2,
  Timer,
  Euro,
  Hash,
  FileCheck,
  CalendarDays,
  Globe,
  Send,
  CornerDownRight,
  AlignLeft,
} from 'lucide-react'
import type { TenderSummaryExportPayload } from '../../shared/types'
import { tenderSummaryLabelValueRows, tenderSummarySections } from '../../shared/tender-summary'
import { api, isElectron } from '../lib/ipc-client'
import { formatDateTime } from '../lib/utils'

const SUMMARY_ICON_BY_LABEL: Record<string, LucideIcon> = {
  'Wat houdt het in?': ClipboardList,
  'Locatie / regio': MapPin,
  'Opdrachtgever (voor wie)': Building2,
  'Type opdracht': Briefcase,
  'Start uitvoering': CalendarClock,
  'Einde uitvoering': CalendarCheck2,
  'Uiterlijk inschrijven / indienen': Timer,
  'Budget / geraamde waarde': Euro,
  Referentie: Hash,
  Procedure: FileCheck,
  Publicatie: CalendarDays,
  Bron: Globe,
  Indiening: Send,
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function TenderSummaryModal({
  open,
  onClose,
  data,
}: {
  open: boolean
  onClose: () => void
  data: TenderSummaryExportPayload
}) {
  const [exportBusy, setExportBusy] = useState<'pdf' | 'word' | null>(null)
  if (!open) return null

  const rows = tenderSummaryLabelValueRows(data)
  const sections = tenderSummarySections(data)

  const printSummary = () => {
    const rowHtml = rows
      .map(
        ([k, v]) =>
          `<tr><th style="text-align:left;vertical-align:top;padding:8px 12px;border-bottom:1px solid #e5e7eb;background:#f8fafc;width:32%">${escapeHtml(k)}</th><td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;white-space:pre-wrap">${escapeHtml(v)}</td></tr>`,
      )
      .join('')
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(data.titel)}</title>
<style>
@page { margin: 18mm; }
@media print {
  .preview-toolbar { display: none !important; }
  body { padding-top: 0; }
}
body{font-family:system-ui,-apple-system,sans-serif;color:#111;max-width:720px;margin:0 auto;padding:24px;padding-top:72px;line-height:1.45}
.preview-toolbar{position:fixed;top:0;left:0;right:0;z-index:9;display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:12px 16px;background:#f1f5f9;border-bottom:1px solid #e2e8f0;box-shadow:0 1px 3px rgba(0,0,0,.06)}
.preview-toolbar span{font-size:12px;color:#64748b;flex:1;min-width:200px}
.preview-toolbar button{font:inherit;padding:8px 14px;border-radius:8px;border:1px solid #cbd5e1;background:#fff;cursor:pointer;font-size:13px}
.preview-toolbar button.primary{background:#1e3a5f;color:#fff;border-color:#1e3a5f}
.preview-toolbar button:hover{filter:brightness(0.97)}
h1{font-size:1.15rem;color:#1e3a5f;margin:0 0 4px}
.sub{color:#6b7280;font-size:12px;margin:0 0 20px}
h2{font-size:1.05rem;margin:0 0 16px;font-weight:600}
table{width:100%;border-collapse:collapse;font-size:13px}
footer{margin-top:28px;font-size:11px;color:#9ca3af;text-align:center}
</style></head><body>
<div class="preview-toolbar">
<button type="button" class="primary" onclick="window.print()">Afdrukken…</button>
<button type="button" onclick="window.close()">Venster sluiten</button>
<span>Of gebruik <kbd>Ctrl</kbd>+<kbd>P</kbd> (Mac: <kbd>⌘</kbd>+<kbd>P</kbd>) — kies desgewenst «Opslaan als PDF».</span>
</div>
<h1>Samenvatting aanbesteding</h1>
<p class="sub">TenderTracker · ${escapeHtml(formatDateTime(new Date().toISOString()))}</p>
<h2>${escapeHtml(data.titel)}</h2>
${rows.length ? `<table><tbody>${rowHtml}</tbody></table>` : '<p>Geen aanvullende velden.</p>'}
<footer>Van de Kreeke Groep</footer>
</body></html>`

    const w = window.open('', '_blank')
    if (!w) {
      window.alert('Pop-up geblokkeerd: sta een nieuw venster toe voor het voorbeeld.')
      return
    }
    w.document.open()
    w.document.write(html)
    w.document.close()
  }

  const doExport = async (format: 'pdf' | 'word') => {
    if (!isElectron) {
      window.alert(
        'Download als Word of PDF werkt in de desktop-app. Open het voorbeeldvenster en kies daar Afdrukken, of «Opslaan als PDF» in het printdialoog.',
      )
      return
    }
    setExportBusy(format)
    try {
      const r = await api.exportTenderSummary({ format, data })
      if (!r?.success && r?.error && r.error !== 'Export geannuleerd') {
        window.alert(r.error)
      }
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Export mislukt')
    } finally {
      setExportBusy(null)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 p-3 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tender-summary-title"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="relative flex resize flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-2xl"
        style={{
          width: 'min(32rem, 96vw)',
          height: 'min(72vh, 720px)',
          minWidth: 'min(320px, 96vw)',
          minHeight: 'min(400px, 88vh)',
          maxWidth: 'min(56rem, 96vw)',
          maxHeight: '95vh',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <span
          className="pointer-events-none absolute bottom-[4.5rem] right-3 z-10 flex items-center gap-1 text-[10px] font-medium text-[var(--muted-foreground)]/70"
          aria-hidden
        >
          <CornerDownRight className="h-3.5 w-3.5" />
          Sleep hoek om te vergroten
        </span>

        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-[var(--border)] bg-[var(--muted)]/25 px-5 py-4">
          <div className="min-w-0">
            <p
              id="tender-summary-title"
              className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]"
            >
              Samenvatting
            </p>
            <h2 className="mt-1 text-base font-semibold leading-snug text-[var(--foreground)] line-clamp-3">
              {data.titel}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
            aria-label="Sluiten"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden px-5 py-4 [scrollbar-gutter:stable]">
          {sections.length === 0 ? (
            <p className="text-sm text-[var(--muted-foreground)]">
              Nog weinig gegevens. Voer een AI-analyse uit of vul bron- en inschrijvingsgegevens aan voor een vollediger
              beeld.
            </p>
          ) : (
            <div className="space-y-8">
              {sections.map((section) => (
                <section key={section.id} className="space-y-3">
                  <header className="border-b border-[var(--border)]/90 pb-2.5">
                    <h3 className="text-sm font-semibold tracking-tight text-[var(--foreground)]">{section.title}</h3>
                    {section.subtitle ? (
                      <p className="mt-1 text-xs leading-snug text-[var(--muted-foreground)]">{section.subtitle}</p>
                    ) : null}
                  </header>
                  <div className="space-y-3">
                    {section.items.map((item) => {
                      const Icon = SUMMARY_ICON_BY_LABEL[item.label] ?? AlignLeft
                      return (
                        <div
                          key={item.label}
                          className="flex gap-3 rounded-xl border border-[var(--border)]/70 bg-gradient-to-br from-[var(--muted)]/25 to-[var(--card)] px-3.5 py-3 shadow-sm"
                        >
                          <div
                            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--primary)]/12 text-[var(--primary)] ring-1 ring-[var(--primary)]/15"
                            aria-hidden
                          >
                            <Icon className="h-[18px] w-[18px]" strokeWidth={2} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <h4 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                              {item.label}
                            </h4>
                            <p className="mt-1.5 text-sm leading-relaxed text-[var(--foreground)] whitespace-pre-wrap">
                              {item.value}
                            </p>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>

        <div className="flex shrink-0 flex-col gap-2 border-t border-[var(--border)] bg-[var(--muted)]/20 px-5 py-4 sm:flex-row sm:flex-wrap sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            className="order-last rounded-lg border border-[var(--border)] bg-[var(--background)] px-4 py-2 text-sm hover:bg-[var(--muted)] sm:order-none"
          >
            Sluiten
          </button>
          <button
            type="button"
            onClick={printSummary}
            className="flex items-center justify-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--background)] px-4 py-2 text-sm font-medium hover:bg-[var(--muted)]"
          >
            <Printer className="h-4 w-4 shrink-0" />
            Voorbeeld (afdrukken optioneel)
          </button>
          <button
            type="button"
            disabled={exportBusy !== null}
            onClick={() => void doExport('pdf')}
            className="flex items-center justify-center gap-2 rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-medium text-[var(--primary-foreground)] hover:opacity-90 disabled:opacity-50"
          >
            {exportBusy === 'pdf' ? <Loader2 className="h-4 w-4 animate-spin shrink-0" /> : <Download className="h-4 w-4 shrink-0" />}
            PDF downloaden
          </button>
          <button
            type="button"
            disabled={exportBusy !== null}
            onClick={() => void doExport('word')}
            className="flex items-center justify-center gap-2 rounded-lg border-2 border-[var(--primary)] bg-transparent px-4 py-2 text-sm font-medium text-[var(--primary)] hover:bg-[var(--primary)]/10 disabled:opacity-50"
          >
            {exportBusy === 'word' ? <Loader2 className="h-4 w-4 animate-spin shrink-0" /> : <FileText className="h-4 w-4 shrink-0" />}
            Word (.docx)
          </button>
        </div>
      </div>
    </div>
  )
}
