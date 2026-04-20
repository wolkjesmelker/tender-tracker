import { useState } from 'react'
import { useCriteria } from '../hooks/use-ipc'
import { api } from '../lib/ipc-client'
import { Plus, Pencil, Trash2, Save, X, Scale } from 'lucide-react'

interface CriteriumForm {
  naam: string
  beschrijving: string
  gewicht: number
}

export function CriteriaPage() {
  const { data: criteria, refresh } = useCriteria()
  const [editing, setEditing] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState<CriteriumForm>({ naam: '', beschrijving: '', gewicht: 10 })

  const handleSave = async () => {
    if (!form.naam) return
    if (editing) {
      await api.updateCriterium(editing, { ...form })
    } else {
      await api.createCriterium({ ...form })
    }
    setEditing(null)
    setCreating(false)
    setForm({ naam: '', beschrijving: '', gewicht: 10 })
    refresh()
  }

  const handleDelete = async (id: string) => {
    await api.deleteCriterium(id)
    refresh()
  }

  const allCriteria = (criteria as any[]) || []
  const totalWeight = allCriteria.reduce((sum: number, c: any) => sum + (c.gewicht || 0), 0)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-[var(--muted-foreground)]">
            Definieer de criteria waarmee aanbestedingen worden beoordeeld.
          </p>
          <p className="text-xs text-[var(--muted-foreground)] mt-1">
            Totaal gewicht: <span className={totalWeight === 100 ? 'text-green-600 font-medium' : 'text-orange-500 font-medium'}>{totalWeight}%</span>
            {totalWeight !== 100 && ' (idealiter 100%)'}
          </p>
        </div>
        <button
          onClick={() => { setCreating(true); setEditing(null); setForm({ naam: '', beschrijving: '', gewicht: 10 }) }}
          className="flex items-center gap-1.5 rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-medium text-[var(--primary-foreground)] hover:opacity-90"
        >
          <Plus className="h-4 w-4" /> Nieuw criterium
        </button>
      </div>

      {(creating || editing) && (
        <div className="rounded-xl border bg-[var(--card)] p-5 shadow-sm space-y-3">
          <h3 className="text-sm font-semibold">{editing ? 'Criterium bewerken' : 'Nieuw criterium'}</h3>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="text-xs text-[var(--muted-foreground)]">Naam *</label>
              <input value={form.naam} onChange={e => setForm({ ...form, naam: e.target.value })} className="mt-1 w-full rounded-lg border bg-[var(--background)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ring)]" />
            </div>
            <div>
              <label className="text-xs text-[var(--muted-foreground)]">Beschrijving</label>
              <input value={form.beschrijving} onChange={e => setForm({ ...form, beschrijving: e.target.value })} className="mt-1 w-full rounded-lg border bg-[var(--background)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ring)]" />
            </div>
            <div>
              <label className="text-xs text-[var(--muted-foreground)]">Gewicht (%)</label>
              <input type="number" min="0" max="100" value={form.gewicht} onChange={e => setForm({ ...form, gewicht: Number(e.target.value) })} className="mt-1 w-full rounded-lg border bg-[var(--background)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ring)]" />
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={handleSave} className="flex items-center gap-1.5 rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-medium text-[var(--primary-foreground)]"><Save className="h-4 w-4" /> Opslaan</button>
            <button onClick={() => { setCreating(false); setEditing(null) }} className="flex items-center gap-1.5 rounded-lg border px-4 py-2 text-sm hover:bg-[var(--muted)]"><X className="h-4 w-4" /> Annuleren</button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {allCriteria.map((c: any) => (
          <div key={c.id} className="flex items-center gap-4 rounded-xl border bg-[var(--card)] p-4 shadow-sm">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-50">
              <Scale className="h-5 w-5 text-indigo-600" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold">{c.naam}</p>
                <span className="rounded bg-[var(--primary)]/10 px-1.5 py-0.5 text-[10px] font-medium text-[var(--primary)]">
                  {c.gewicht}%
                </span>
              </div>
              {c.beschrijving && <p className="text-xs text-[var(--muted-foreground)] mt-0.5">{c.beschrijving}</p>}
              <div className="mt-2 h-1.5 rounded-full bg-[var(--muted)]">
                <div className="h-1.5 rounded-full bg-[var(--primary)]" style={{ width: `${c.gewicht}%` }} />
              </div>
            </div>
            <div className="flex gap-1">
              <button onClick={() => { setEditing(c.id); setCreating(false); setForm({ naam: c.naam, beschrijving: c.beschrijving || '', gewicht: c.gewicht }) }} className="rounded-lg p-2 hover:bg-[var(--muted)]">
                <Pencil className="h-4 w-4 text-[var(--muted-foreground)]" />
              </button>
              <button onClick={() => handleDelete(c.id)} className="rounded-lg p-2 hover:bg-red-50">
                <Trash2 className="h-4 w-4 text-red-400" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
