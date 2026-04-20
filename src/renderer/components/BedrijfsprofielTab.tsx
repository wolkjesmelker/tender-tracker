import { useState, useEffect, useCallback } from 'react'
import {
  Building2, Plus, Trash2, Save, CheckCircle2, Pencil, X, Star, StarOff, ChevronDown, ChevronUp,
} from 'lucide-react'
import { api } from '../lib/ipc-client'
import type { BedrijfsProfiel } from '@shared/types'

const LEGE_PROFIEL: Omit<BedrijfsProfiel, 'id' | 'created_at' | 'updated_at'> = {
  naam: '',
  rechtsvorm: '',
  kvk: '',
  btw: '',
  iban: '',
  adres: '',
  postcode: '',
  stad: '',
  land: 'Nederland',
  email: '',
  telefoon: '',
  website: '',
  contactpersoon: '',
  functie_contactpersoon: '',
  is_standaard: false,
  extra_velden: undefined,
}

type FormState = typeof LEGE_PROFIEL

function ProfielForm({
  initial,
  onSave,
  onCancel,
  saving,
}: {
  initial: FormState
  onSave: (v: FormState) => Promise<void>
  onCancel: () => void
  saving: boolean
}) {
  const [v, setV] = useState<FormState>(initial)
  const [extraKv, setExtraKv] = useState<{ k: string; val: string }[]>(() => {
    if (!initial.extra_velden) return []
    try {
      return Object.entries(JSON.parse(initial.extra_velden) as Record<string, string>).map(
        ([k, val]) => ({ k, val }),
      )
    } catch {
      return []
    }
  })

  const field = (
    label: string,
    key: keyof FormState,
    placeholder?: string,
    type = 'text',
  ) => (
    <div>
      <label className="block text-xs font-medium text-[var(--muted-foreground)] mb-1">
        {label}
      </label>
      <input
        type={type}
        value={(v[key] as string) || ''}
        onChange={(e) => setV((p) => ({ ...p, [key]: e.target.value }))}
        placeholder={placeholder ?? ''}
        className="w-full rounded-lg border bg-[var(--background)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
      />
    </div>
  )

  const handleSubmit = async () => {
    const extra: Record<string, string> = {}
    for (const { k, val } of extraKv) {
      if (k.trim()) extra[k.trim()] = val
    }
    await onSave({
      ...v,
      extra_velden: Object.keys(extra).length > 0 ? JSON.stringify(extra) : undefined,
    })
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          {field('Naam vennootschap *', 'naam', 'Van de Kreeke Groep BV')}
        </div>
        {field('Rechtsvorm', 'rechtsvorm', 'BV, NV, VOF, …')}
        {field('KvK-nummer', 'kvk', '12345678')}
        {field('BTW-nummer', 'btw', 'NL123456789B01')}
        {field('IBAN', 'iban', 'NL91ABNA0417164300')}
        <div className="sm:col-span-2">
          {field('Adres (straat + huisnummer)', 'adres', 'Industrieweg 1')}
        </div>
        {field('Postcode', 'postcode', '4700 AB')}
        {field('Stad', 'stad', 'Roosendaal')}
        {field('Land', 'land', 'Nederland')}
        {field('E-mailadres', 'email', 'info@bedrijf.nl', 'email')}
        {field('Telefoonnummer', 'telefoon', '+31 165 555 000', 'tel')}
        {field('Website', 'website', 'https://www.bedrijf.nl', 'url')}
        {field('Naam contactpersoon', 'contactpersoon', 'Jan de Vries')}
        {field('Functie contactpersoon', 'functie_contactpersoon', 'Directeur / Tendermanager')}
      </div>

      {/* Extra velden */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs font-medium text-[var(--muted-foreground)]">
            Extra velden (voor specifieke documenten)
          </label>
          <button
            type="button"
            onClick={() => setExtraKv((p) => [...p, { k: '', val: '' }])}
            className="text-xs text-[var(--primary)] hover:underline"
          >
            + Veld toevoegen
          </button>
        </div>
        <div className="space-y-2">
          {extraKv.map((row, i) => (
            <div key={i} className="flex gap-2 items-center">
              <input
                value={row.k}
                onChange={(e) => setExtraKv((p) => p.map((r, j) => j === i ? { ...r, k: e.target.value } : r))}
                placeholder="Veldnaam (bijv. verzekeringsnr)"
                className="flex-1 rounded-lg border bg-[var(--background)] px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
              />
              <input
                value={row.val}
                onChange={(e) => setExtraKv((p) => p.map((r, j) => j === i ? { ...r, val: e.target.value } : r))}
                placeholder="Waarde"
                className="flex-1 rounded-lg border bg-[var(--background)] px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
              />
              <button
                type="button"
                onClick={() => setExtraKv((p) => p.filter((_, j) => j !== i))}
                className="rounded-lg p-1 hover:bg-red-50"
              >
                <X className="h-3.5 w-3.5 text-red-400" />
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="flex gap-2 pt-2">
        <button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={saving || !v.naam.trim()}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-medium text-[var(--primary-foreground)] hover:opacity-90 disabled:opacity-50"
        >
          <Save className="h-4 w-4" />
          {saving ? 'Opslaan…' : 'Opslaan'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border px-4 py-2 text-sm hover:bg-[var(--muted)]"
        >
          Annuleren
        </button>
      </div>
    </div>
  )
}

function ProfielCard({
  profiel,
  onEdit,
  onDelete,
  onSetStandaard,
}: {
  profiel: BedrijfsProfiel
  onEdit: () => void
  onDelete: () => void
  onSetStandaard: () => void
}) {
  const [expanded, setExpanded] = useState(false)

  const rows: { label: string; value: string | undefined }[] = [
    { label: 'Rechtsvorm', value: profiel.rechtsvorm },
    { label: 'KvK', value: profiel.kvk },
    { label: 'BTW', value: profiel.btw },
    { label: 'IBAN', value: profiel.iban },
    { label: 'Adres', value: [profiel.adres, profiel.postcode, profiel.stad].filter(Boolean).join(', ') || undefined },
    { label: 'Land', value: profiel.land },
    { label: 'E-mail', value: profiel.email },
    { label: 'Telefoon', value: profiel.telefoon },
    { label: 'Website', value: profiel.website },
    { label: 'Contactpersoon', value: profiel.contactpersoon ? `${profiel.contactpersoon}${profiel.functie_contactpersoon ? ` (${profiel.functie_contactpersoon})` : ''}` : undefined },
  ].filter((r) => r.value)

  let extraRows: { label: string; value: string }[] = []
  if (profiel.extra_velden) {
    try {
      extraRows = Object.entries(JSON.parse(profiel.extra_velden) as Record<string, string>).map(
        ([label, value]) => ({ label, value }),
      )
    } catch {
      /* ignore */
    }
  }

  return (
    <div
      className={`rounded-xl border bg-[var(--card)] shadow-sm transition-all ${
        profiel.is_standaard ? 'border-[var(--primary)]/40 ring-1 ring-[var(--primary)]/20' : ''
      }`}
    >
      <div className="flex items-start gap-3 p-4">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--primary)]/10">
          <Building2 className="h-5 w-5 text-[var(--primary)]" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm truncate">{profiel.naam}</span>
            {profiel.rechtsvorm && (
              <span className="rounded-full bg-[var(--muted)] px-2 py-0.5 text-[10px] font-medium text-[var(--muted-foreground)]">
                {profiel.rechtsvorm}
              </span>
            )}
            {profiel.is_standaard && (
              <span className="inline-flex items-center gap-0.5 rounded-full bg-[var(--primary)]/10 px-2 py-0.5 text-[10px] font-semibold text-[var(--primary)]">
                <Star className="h-3 w-3" /> Standaard
              </span>
            )}
          </div>
          <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
            {[profiel.kvk && `KvK ${profiel.kvk}`, profiel.stad].filter(Boolean).join(' · ')}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            title={profiel.is_standaard ? 'Is al standaard' : 'Instellen als standaard'}
            onClick={onSetStandaard}
            disabled={profiel.is_standaard}
            className="rounded-lg p-1.5 hover:bg-[var(--muted)] disabled:opacity-30"
          >
            {profiel.is_standaard ? (
              <Star className="h-4 w-4 text-[var(--primary)]" />
            ) : (
              <StarOff className="h-4 w-4 text-[var(--muted-foreground)]" />
            )}
          </button>
          <button
            type="button"
            title="Bewerken"
            onClick={onEdit}
            className="rounded-lg p-1.5 hover:bg-[var(--muted)]"
          >
            <Pencil className="h-4 w-4 text-[var(--muted-foreground)]" />
          </button>
          <button
            type="button"
            title="Verwijderen"
            onClick={onDelete}
            className="rounded-lg p-1.5 hover:bg-red-50"
          >
            <Trash2 className="h-4 w-4 text-red-400" />
          </button>
          <button
            type="button"
            onClick={() => setExpanded((p) => !p)}
            className="rounded-lg p-1.5 hover:bg-[var(--muted)]"
          >
            {expanded ? (
              <ChevronUp className="h-4 w-4 text-[var(--muted-foreground)]" />
            ) : (
              <ChevronDown className="h-4 w-4 text-[var(--muted-foreground)]" />
            )}
          </button>
        </div>
      </div>
      {expanded && (
        <div className="border-t px-4 pb-4 pt-3">
          <div className="grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2">
            {[...rows, ...extraRows].map((r) => (
              <div key={r.label} className="flex items-start gap-2 text-xs">
                <span className="shrink-0 w-28 text-[var(--muted-foreground)]">{r.label}</span>
                <span className="font-medium break-all">{r.value}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export function BedrijfsprofielTab() {
  const [profielen, setProfielen] = useState<BedrijfsProfiel[]>([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const list = (await api.getBedrijfsprofielen?.()) as BedrijfsProfiel[] | null
      setProfielen(list ?? [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const handleCreate = async (form: FormState) => {
    setSaving(true)
    try {
      await api.createBedrijfsprofiel?.(form as unknown as Record<string, unknown>)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      setAdding(false)
      void load()
    } finally {
      setSaving(false)
    }
  }

  const handleUpdate = async (id: string, form: FormState) => {
    setSaving(true)
    try {
      await api.updateBedrijfsprofiel?.(id, form as unknown as Record<string, unknown>)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      setEditId(null)
      void load()
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    await api.deleteBedrijfsprofiel?.(id)
    setDeleteConfirm(null)
    void load()
  }

  const handleSetStandaard = async (id: string) => {
    await api.setBedrijfsprofielStandaard?.(id)
    void load()
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border bg-[var(--card)] p-6 shadow-sm">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h3 className="text-base font-semibold flex items-center gap-2">
              <Building2 className="h-5 w-5 text-[var(--primary)]" />
              Bedrijfsprofielen
            </h3>
            <p className="mt-1 text-xs text-[var(--muted-foreground)] leading-relaxed max-w-xl">
              Sla bedrijfsgegevens eenmalig op. Bij het invullen van aanbestedingsdocumenten kies je
              welk bedrijf inschrijft en worden alle velden automatisch ingevuld.
              Maak meerdere profielen aan voor dochterondernemingen.
            </p>
          </div>
          {saved && (
            <span className="inline-flex shrink-0 items-center gap-1 text-xs text-green-700">
              <CheckCircle2 className="h-4 w-4" /> Opgeslagen
            </span>
          )}
        </div>

        {loading ? (
          <p className="text-sm text-[var(--muted-foreground)]">Laden…</p>
        ) : (
          <div className="space-y-3">
            {profielen.map((p) => (
              editId === p.id ? (
                <div key={p.id} className="rounded-xl border bg-[var(--background)] p-5">
                  <h4 className="text-sm font-semibold mb-4">Profiel bewerken: {p.naam}</h4>
                  <ProfielForm
                    initial={{
                      naam: p.naam,
                      rechtsvorm: p.rechtsvorm ?? '',
                      kvk: p.kvk ?? '',
                      btw: p.btw ?? '',
                      iban: p.iban ?? '',
                      adres: p.adres ?? '',
                      postcode: p.postcode ?? '',
                      stad: p.stad ?? '',
                      land: p.land ?? 'Nederland',
                      email: p.email ?? '',
                      telefoon: p.telefoon ?? '',
                      website: p.website ?? '',
                      contactpersoon: p.contactpersoon ?? '',
                      functie_contactpersoon: p.functie_contactpersoon ?? '',
                      is_standaard: p.is_standaard,
                      extra_velden: p.extra_velden,
                    }}
                    onSave={(form) => handleUpdate(p.id, form)}
                    onCancel={() => setEditId(null)}
                    saving={saving}
                  />
                </div>
              ) : deleteConfirm === p.id ? (
                <div key={p.id} className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm">
                  <p className="font-medium text-red-800 mb-3">
                    Profiel "{p.naam}" verwijderen?
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => void handleDelete(p.id)}
                      className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
                    >
                      Verwijderen
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteConfirm(null)}
                      className="rounded-lg border px-4 py-2 text-sm hover:bg-[var(--muted)]"
                    >
                      Annuleren
                    </button>
                  </div>
                </div>
              ) : (
                <ProfielCard
                  key={p.id}
                  profiel={p}
                  onEdit={() => { setAdding(false); setEditId(p.id) }}
                  onDelete={() => setDeleteConfirm(p.id)}
                  onSetStandaard={() => void handleSetStandaard(p.id)}
                />
              )
            ))}

            {profielen.length === 0 && !adding && (
              <div className="rounded-xl border border-dashed border-[var(--border)] p-8 text-center">
                <Building2 className="h-8 w-8 mx-auto text-[var(--muted-foreground)] mb-2" />
                <p className="text-sm text-[var(--muted-foreground)]">
                  Nog geen bedrijfsprofielen. Voeg er een toe.
                </p>
              </div>
            )}

            {adding ? (
              <div className="rounded-xl border bg-[var(--background)] p-5">
                <h4 className="text-sm font-semibold mb-4">Nieuw bedrijfsprofiel</h4>
                <ProfielForm
                  initial={{ ...LEGE_PROFIEL }}
                  onSave={handleCreate}
                  onCancel={() => setAdding(false)}
                  saving={saving}
                />
              </div>
            ) : (
              <button
                type="button"
                onClick={() => { setEditId(null); setAdding(true) }}
                className="inline-flex items-center gap-2 rounded-lg border border-dashed border-[var(--border)] bg-[var(--background)] px-4 py-2.5 text-sm font-medium hover:bg-[var(--muted)]/30 transition-colors"
              >
                <Plus className="h-4 w-4" />
                Nieuw bedrijfsprofiel toevoegen
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
