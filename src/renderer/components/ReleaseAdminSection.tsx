import { useCallback, useEffect, useState } from 'react'
import { Loader2, Rocket, Trash2, RotateCcw, AlertCircle } from 'lucide-react'
import { api, isElectron } from '../lib/ipc-client'
import type { AppReleaseRow } from '@shared/types'

export function ReleaseAdminSection() {
  const [rows, setRows] = useState<AppReleaseRow[]>([])
  const [loading, setLoading] = useState(true)
  const [note, setNote] = useState<{ tone: 'warn' | 'ok'; text: string } | null>(null)
  const [version, setVersion] = useState('')
  const [description, setDescription] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const refresh = useCallback(async () => {
    if (!isElectron || !api.releaseList) return
    setLoading(true)
    setNote(null)
    try {
      const r = (await api.releaseList()) as { ok: boolean; rows?: AppReleaseRow[]; message?: string }
      if (!r.ok) {
        setNote({
          tone: 'warn',
          text:
            r.message ||
            'Kon versielijst niet laden. Controleer Supabase en of de SQL voor tender_tracker_app_releases is uitgevoerd.',
        })
        setRows([])
        return
      }
      setRows(r.rows ?? [])
    } catch (e) {
      setNote({
        tone: 'warn',
        text: e instanceof Error ? e.message : 'Laden mislukt.',
      })
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const handleCreateDraft = async () => {
    if (!api.releaseCreateDraft) return
    setCreating(true)
    setNote(null)
    try {
      const r = (await api.releaseCreateDraft({ version: version.trim(), description })) as {
        ok: boolean
        message?: string
      }
      if (!r.ok) {
        setNote({ tone: 'warn', text: r.message || 'Aanmaken mislukt.' })
        return
      }
      setVersion('')
      setDescription('')
      setNote({
        tone: 'ok',
        text: 'Concept opgeslagen. Lancering gebeurt pas na «Nieuwe versie lanceren» — gebruikers zien dan de update.',
      })
      await refresh()
    } catch (e) {
      setNote({ tone: 'warn', text: e instanceof Error ? e.message : 'Aanmaken mislukt.' })
    } finally {
      setCreating(false)
    }
  }

  const handlePromote = async (id: string) => {
    if (!api.releasePromoteLive) return
    setBusyId(id)
    setNote(null)
    try {
      const r = (await api.releasePromoteLive(id)) as { ok: boolean; message?: string }
      if (!r.ok) {
        setNote({ tone: 'warn', text: r.message || 'Lanceren mislukt.' })
        return
      }
      setNote({
        tone: 'ok',
        text: 'Versie is live gezet. Gebruikers krijgen bij de volgende update-check de melding (installatie moet op GitHub staan).',
      })
      await refresh()
    } catch (e) {
      setNote({ tone: 'warn', text: e instanceof Error ? e.message : 'Lanceren mislukt.' })
    } finally {
      setBusyId(null)
    }
  }

  const handleDeleteDraft = async (id: string) => {
    if (!api.releaseDeleteDraft || !confirm('Conceptversie verwijderen?')) return
    setBusyId(id)
    setNote(null)
    try {
      const r = (await api.releaseDeleteDraft(id)) as { ok: boolean; message?: string }
      if (!r.ok) {
        setNote({ tone: 'warn', text: r.message || 'Verwijderen mislukt.' })
        return
      }
      await refresh()
    } catch (e) {
      setNote({ tone: 'warn', text: e instanceof Error ? e.message : 'Verwijderen mislukt.' })
    } finally {
      setBusyId(null)
    }
  }

  if (!isElectron) {
    return (
      <p className="text-sm text-[var(--muted-foreground)]">
        Versiebeheer is alleen beschikbaar in de geïnstalleerde desktop-app.
      </p>
    )
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border bg-[var(--card)] p-6 shadow-sm">
        <h3 className="text-base font-semibold flex items-center gap-2 mb-2">
          <Rocket className="h-5 w-5 text-[var(--primary)]" />
          Versies voor gebruikers (rollout)
        </h3>
        <p className="text-xs text-[var(--muted-foreground)] mb-4 leading-relaxed">
          Zolang er <strong>geen</strong> live versie in Supabase staat, volgen alle clients automatisch de{' '}
          <strong>nieuwste GitHub-release</strong>. Zodra je hier een versie als live zet, installeren gebruikers alleen
          nog die release (tot je terugschakelt of een nieuwe live versie kiest). Een GitHub-release met tag{' '}
          <code className="text-[10px]">vX.Y.Z</code> en bestand <code className="text-[10px]">latest-mac.yml</code> is
          verplicht voordat je kunt lanceren.
        </p>

        {note ? (
          <div
            className={`mb-4 flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${
              note.tone === 'warn'
                ? 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200'
                : 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-200'
            }`}
          >
            {note.tone === 'warn' ? (
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            ) : null}
            <span>{note.text}</span>
          </div>
        ) : null}

        <div className="rounded-lg border border-[var(--border)] bg-[var(--muted)]/20 p-4 space-y-3 mb-6">
          <p className="text-sm font-medium">Nieuwe versie aanmaken (concept)</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="text-xs font-medium text-[var(--muted-foreground)]">Versienummer (semver)</label>
              <input
                value={version}
                onChange={(e) => setVersion(e.target.value)}
                placeholder="bijv. 1.2.0"
                className="mt-1 w-full rounded-lg border bg-[var(--background)] px-3 py-2 text-sm"
              />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-[var(--muted-foreground)]">Omschrijving aanpassingen</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              placeholder="Wat is er gewijzigd voor gebruikers?"
              className="mt-1 w-full rounded-lg border bg-[var(--background)] px-3 py-2 text-sm"
            />
          </div>
          <button
            type="button"
            disabled={creating || !version.trim()}
            onClick={() => void handleCreateDraft()}
            className="inline-flex items-center gap-2 rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-medium text-[var(--primary-foreground)] hover:opacity-90 disabled:opacity-50"
          >
            {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
            Concept aanmaken
          </button>
        </div>

        <h4 className="text-sm font-semibold mb-2">Versiegeschiedenis</h4>
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-[var(--muted-foreground)] py-6">
            <Loader2 className="h-4 w-4 animate-spin" />
            Laden…
          </div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-[var(--muted-foreground)] py-4">Nog geen versieregels. Maak eerst een concept aan.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] bg-[var(--muted)]/40 text-left text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
                  <th className="px-3 py-2 font-medium">Versie</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Omschrijving</th>
                  <th className="px-3 py-2 font-medium w-[1%]">Acties</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-[var(--border)] last:border-0">
                    <td className="px-3 py-2 font-mono text-xs">{row.version}</td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                          row.status === 'live'
                            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300'
                            : row.status === 'draft'
                              ? 'bg-amber-100 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200'
                              : 'bg-[var(--muted)] text-[var(--muted-foreground)]'
                        }`}
                      >
                        {row.status === 'live' ? 'Live voor gebruikers' : row.status === 'draft' ? 'Concept' : 'Archief'}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-[var(--muted-foreground)] max-w-md whitespace-pre-wrap">
                      {row.description || '—'}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <div className="flex flex-wrap gap-1 justify-end">
                        {row.status === 'draft' ? (
                          <>
                            <button
                              type="button"
                              disabled={busyId === row.id}
                              onClick={() => void handlePromote(row.id)}
                              className="rounded-md bg-[var(--primary)] px-2 py-1 text-xs font-medium text-[var(--primary-foreground)] hover:opacity-90 disabled:opacity-50"
                            >
                              {busyId === row.id ? '…' : 'Nieuwe versie lanceren'}
                            </button>
                            <button
                              type="button"
                              disabled={busyId === row.id}
                              onClick={() => void handleDeleteDraft(row.id)}
                              className="rounded-md border border-[var(--border)] p-1 text-[var(--muted-foreground)] hover:bg-[var(--muted)]"
                              title="Concept verwijderen"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </>
                        ) : row.status !== 'live' ? (
                          <button
                            type="button"
                            disabled={busyId === row.id}
                            onClick={() => void handlePromote(row.id)}
                            className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] px-2 py-1 text-xs hover:bg-[var(--muted)] disabled:opacity-50"
                            title="Deze versie opnieuw als actief voor gebruikers"
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                            {busyId === row.id ? '…' : 'Terug naar deze versie'}
                          </button>
                        ) : (
                          <span className="text-xs text-[var(--muted-foreground)]">Actief</span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
