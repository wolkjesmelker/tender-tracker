import { useState } from 'react'
import { useAIVragen } from '../hooks/use-ipc'
import { api } from '../lib/ipc-client'
import { Plus, Pencil, Trash2, Save, X, MessageSquare, GripVertical } from 'lucide-react'

export function AIQuestionsPage() {
  const { data: vragen, refresh } = useAIVragen()
  const [editing, setEditing] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({ vraag: '', categorie: '' })

  const handleSave = async () => {
    if (!form.vraag) return
    if (editing) {
      await api.updateAIVraag(editing, form)
    } else {
      await api.createAIVraag(form)
    }
    setEditing(null)
    setCreating(false)
    setForm({ vraag: '', categorie: '' })
    refresh()
  }

  const handleDelete = async (id: string) => {
    await api.deleteAIVraag(id)
    refresh()
  }

  const handleToggle = async (id: string, currentActive: boolean) => {
    await api.updateAIVraag(id, { is_actief: currentActive ? 0 : 1 })
    refresh()
  }

  const allVragen = (vragen as any[]) || []
  const categorieKleuren: Record<string, string> = {
    planning: 'bg-blue-100 text-blue-700',
    organisatie: 'bg-purple-100 text-purple-700',
    financieel: 'bg-green-100 text-green-700',
    inhoud: 'bg-orange-100 text-orange-700',
    risico: 'bg-red-100 text-red-700',
    contract: 'bg-indigo-100 text-indigo-700',
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-[var(--muted-foreground)]">
            Configureer de vragen die de AI beantwoordt bij elke aanbesteding.
          </p>
          <p className="text-xs text-[var(--muted-foreground)] mt-1">
            {allVragen.filter((v: any) => v.is_actief).length} actieve vragen
          </p>
        </div>
        <button
          onClick={() => { setCreating(true); setEditing(null); setForm({ vraag: '', categorie: '' }) }}
          className="flex items-center gap-1.5 rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-medium text-[var(--primary-foreground)] hover:opacity-90"
        >
          <Plus className="h-4 w-4" /> Nieuwe vraag
        </button>
      </div>

      {(creating || editing) && (
        <div className="rounded-xl border bg-[var(--card)] p-5 shadow-sm space-y-3">
          <h3 className="text-sm font-semibold">{editing ? 'Vraag bewerken' : 'Nieuwe vraag'}</h3>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="sm:col-span-2">
              <label className="text-xs text-[var(--muted-foreground)]">Vraag *</label>
              <input value={form.vraag} onChange={e => setForm({ ...form, vraag: e.target.value })} className="mt-1 w-full rounded-lg border bg-[var(--background)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ring)]" placeholder="Wat is de uitvoeringstermijn?" />
            </div>
            <div>
              <label className="text-xs text-[var(--muted-foreground)]">Categorie</label>
              <select value={form.categorie} onChange={e => setForm({ ...form, categorie: e.target.value })} className="mt-1 w-full rounded-lg border bg-[var(--background)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ring)]">
                <option value="">Geen</option>
                <option value="planning">Planning</option>
                <option value="organisatie">Organisatie</option>
                <option value="financieel">Financieel</option>
                <option value="inhoud">Inhoud</option>
                <option value="risico">Risico</option>
                <option value="contract">Contract</option>
              </select>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={handleSave} className="flex items-center gap-1.5 rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-medium text-[var(--primary-foreground)]"><Save className="h-4 w-4" /> Opslaan</button>
            <button onClick={() => { setCreating(false); setEditing(null) }} className="flex items-center gap-1.5 rounded-lg border px-4 py-2 text-sm hover:bg-[var(--muted)]"><X className="h-4 w-4" /> Annuleren</button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {allVragen.map((v: any) => (
          <div
            key={v.id}
            className={`flex items-center gap-3 rounded-xl border bg-[var(--card)] p-4 shadow-sm transition-opacity ${!v.is_actief ? 'opacity-50' : ''}`}
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--muted)]">
              <MessageSquare className="h-4 w-4 text-[var(--muted-foreground)]" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">{v.vraag}</p>
              <div className="mt-1 flex items-center gap-2">
                {v.categorie && (
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${categorieKleuren[v.categorie] || 'bg-gray-100 text-gray-600'}`}>
                    {v.categorie}
                  </span>
                )}
                {v.is_standaard === 1 && (
                  <span className="text-[10px] text-[var(--muted-foreground)]">Standaard</span>
                )}
              </div>
            </div>
            <label className="relative inline-flex cursor-pointer items-center">
              <input type="checkbox" checked={!!v.is_actief} onChange={() => handleToggle(v.id, v.is_actief)} className="peer sr-only" />
              <div className="peer h-5 w-9 rounded-full bg-gray-200 after:absolute after:left-[2px] after:top-[2px] after:h-4 after:w-4 after:rounded-full after:bg-white after:transition-all peer-checked:bg-[var(--primary)] peer-checked:after:translate-x-full" />
            </label>
            <button onClick={() => { setEditing(v.id); setCreating(false); setForm({ vraag: v.vraag, categorie: v.categorie || '' }) }} className="rounded-lg p-2 hover:bg-[var(--muted)]">
              <Pencil className="h-4 w-4 text-[var(--muted-foreground)]" />
            </button>
            {!v.is_standaard && (
              <button onClick={() => handleDelete(v.id)} className="rounded-lg p-2 hover:bg-red-50">
                <Trash2 className="h-4 w-4 text-red-400" />
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
