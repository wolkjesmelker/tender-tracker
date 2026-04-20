import { useState } from 'react'
import { useSources } from '../hooks/use-ipc'
import { api } from '../lib/ipc-client'
import { formatDateTime } from '../lib/utils'
import { Plus, Pencil, Trash2, Globe, X, Save } from 'lucide-react'
import { AppConfirmDialog } from '../components/app-confirm-dialog'

interface SourceForm {
  naam: string
  url: string
  login_url: string
  auth_type: string
  vakgebied: string
}

const emptyForm: SourceForm = { naam: '', url: '', login_url: '', auth_type: 'none', vakgebied: 'Infrastructuur' }

export function SourcesPage() {
  const { data: sources, refresh } = useSources()
  const [editing, setEditing] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState<SourceForm>(emptyForm)
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; naam: string } | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const handleSave = async () => {
    if (!form.naam || !form.url) return
    if (editing) {
      await api.updateSource(editing, { ...form })
    } else {
      await api.createSource({ ...form })
    }
    setEditing(null)
    setCreating(false)
    setForm(emptyForm)
    refresh()
  }

  const handleDelete = (id: string, naam: string) => {
    setDeleteError(null)
    setDeleteTarget({ id, naam })
  }

  const executeDelete = async () => {
    if (!deleteTarget) return
    setDeleteBusy(true)
    setDeleteError(null)
    try {
      await api.deleteSource(deleteTarget.id)
      setDeleteTarget(null)
      refresh()
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : 'Verwijderen mislukt')
    } finally {
      setDeleteBusy(false)
    }
  }

  const startEdit = (source: any) => {
    setEditing(source.id)
    setCreating(false)
    setForm({
      naam: source.naam,
      url: source.url,
      login_url: source.login_url || '',
      auth_type: source.auth_type,
      vakgebied: source.vakgebied || 'Infrastructuur',
    })
  }

  const allSources = (sources as any[]) || []

  return (
    <div className="space-y-4">
      <AppConfirmDialog
        open={!!deleteTarget}
        title="Bron verwijderen?"
        variant="danger"
        confirmLabel="Verwijderen"
        loading={deleteBusy}
        onCancel={() => {
          if (deleteBusy) return
          setDeleteTarget(null)
          setDeleteError(null)
        }}
        onConfirm={() => void executeDelete()}
        error={deleteError}
        description={
          deleteTarget ? (
            <p>
              Wil je de bron <strong className="text-[var(--foreground)]">«{deleteTarget.naam}»</strong> verwijderen?
              Gekoppelde aanbestedingen worden niet automatisch gewist.
            </p>
          ) : null
        }
      />
      <div className="flex items-center justify-between">
        <p className="text-sm text-[var(--muted-foreground)]">
          Beheer de websites waarop gezocht wordt naar aanbestedingen.
        </p>
        <button
          onClick={() => { setCreating(true); setEditing(null); setForm(emptyForm) }}
          className="flex items-center gap-1.5 rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-medium text-[var(--primary-foreground)] hover:opacity-90 transition-opacity"
        >
          <Plus className="h-4 w-4" /> Nieuwe bron
        </button>
      </div>

      {/* Create/edit form */}
      {(creating || editing) && (
        <div className="rounded-xl border bg-[var(--card)] p-5 shadow-sm space-y-3">
          <h3 className="text-sm font-semibold">{editing ? 'Bron bewerken' : 'Nieuwe bron'}</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="text-xs text-[var(--muted-foreground)]">Naam *</label>
              <input value={form.naam} onChange={e => setForm({ ...form, naam: e.target.value })} className="mt-1 w-full rounded-lg border bg-[var(--background)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ring)]" placeholder="TenderNed" />
            </div>
            <div>
              <label className="text-xs text-[var(--muted-foreground)]">URL *</label>
              <input value={form.url} onChange={e => setForm({ ...form, url: e.target.value })} className="mt-1 w-full rounded-lg border bg-[var(--background)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ring)]" placeholder="https://..." />
            </div>
            <div>
              <label className="text-xs text-[var(--muted-foreground)]">Login URL</label>
              <input value={form.login_url} onChange={e => setForm({ ...form, login_url: e.target.value })} className="mt-1 w-full rounded-lg border bg-[var(--background)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ring)]" placeholder="https://..." />
            </div>
            <div>
              <label className="text-xs text-[var(--muted-foreground)]">Authenticatie</label>
              <select value={form.auth_type} onChange={e => setForm({ ...form, auth_type: e.target.value })} className="mt-1 w-full rounded-lg border bg-[var(--background)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ring)]">
                <option value="none">Geen</option>
                <option value="form">Formulier login</option>
                <option value="openid_connect">OpenID Connect</option>
              </select>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={handleSave} className="flex items-center gap-1.5 rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-medium text-[var(--primary-foreground)] hover:opacity-90">
              <Save className="h-4 w-4" /> Opslaan
            </button>
            <button onClick={() => { setCreating(false); setEditing(null) }} className="flex items-center gap-1.5 rounded-lg border px-4 py-2 text-sm hover:bg-[var(--muted)]">
              <X className="h-4 w-4" /> Annuleren
            </button>
          </div>
        </div>
      )}

      {/* Sources list */}
      <div className="space-y-3">
        {allSources.map((source: any) => (
          <div key={source.id} className="flex items-center gap-4 rounded-xl border bg-[var(--card)] p-4 shadow-sm">
            <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${source.is_actief ? 'bg-green-100' : 'bg-gray-100'}`}>
              <Globe className={`h-5 w-5 ${source.is_actief ? 'text-green-600' : 'text-gray-400'}`} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold">{source.naam}</p>
              <p className="text-xs text-[var(--muted-foreground)] truncate">{source.url}</p>
              <div className="mt-1 flex gap-2 text-[10px] text-[var(--muted-foreground)]">
                <span className="rounded bg-[var(--muted)] px-1.5 py-0.5">
                  {source.auth_type === 'none' ? 'Publiek' : source.auth_type === 'form' ? 'Login' : 'OpenID'}
                </span>
                {source.laatste_sync && <span>Sync: {formatDateTime(source.laatste_sync)}</span>}
              </div>
            </div>
            <div className="flex gap-1">
              <button onClick={() => startEdit(source)} className="rounded-lg p-2 hover:bg-[var(--muted)] transition-colors">
                <Pencil className="h-4 w-4 text-[var(--muted-foreground)]" />
              </button>
              <button onClick={() => handleDelete(source.id, source.naam)} className="rounded-lg p-2 hover:bg-red-50 transition-colors">
                <Trash2 className="h-4 w-4 text-red-400" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
