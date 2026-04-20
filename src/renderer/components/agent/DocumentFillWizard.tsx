import { useCallback, useEffect, useMemo, useState } from 'react'
import { X, AlertTriangle, Sparkles, BrainCircuit, Loader2, Check, ChevronLeft, ChevronRight, Save, FileDown, Building2, Download } from 'lucide-react'
import { api } from '../../lib/ipc-client'
import { useAgentStore } from '../../stores/agent-store'
import type { AgentFieldDefinition, AgentFillState, AgentContradictionWarning, BedrijfsProfiel } from '@shared/types'
import { cn } from '../../lib/utils'

interface WizardStep {
  title: string
  fields: AgentFieldDefinition[]
}

type FieldValueMap = Record<string, string>
type ContradictionMap = Record<string, AgentContradictionWarning>

/**
 * Probeert een waarde uit een BedrijfsProfiel te koppelen aan een document-veld
 * op basis van het veld-id en -label (keyword-matching).
 */
function pickProfileValueForField(field: AgentFieldDefinition, profiel: BedrijfsProfiel): string | null {
  const hay = `${field.id} ${field.label}`.toLowerCase()
  const match = (...tokens: string[]) => tokens.some((t) => hay.includes(t))

  // Naam vennootschap / bedrijfsnaam
  if (match('bedrijfsnaam', 'handelsnaam', 'naam vennoot', 'naam van de vennoot', 'naam inschrijver', 'naam onderneming'))
    return profiel.naam || null
  // KvK
  if (match('kvk', 'kamer van koophandel', 'inschrijvingsnummer', 'handelsregisternummer'))
    return profiel.kvk || null
  // BTW
  if (match('btw', 'omzetbelasting', 'vat'))
    return profiel.btw || null
  // IBAN
  if (match('iban', 'bankrekeningnummer', 'rekeningnummer'))
    return profiel.iban || null
  // Adres
  if (match('straat', 'bezoekadres', 'vestigingsadres') || (match('adres') && !match('postcode') && !match('woonplaats') && !match('stad')))
    return profiel.adres || null
  // Postcode
  if (match('postcode'))
    return profiel.postcode || null
  // Stad / woonplaats / vestigingsplaats
  if (match('stad', 'woonplaats', 'vestigingsplaats', 'plaats'))
    return profiel.stad || null
  // Land
  if (match('land') && !match('aandeel', 'verdeling'))
    return profiel.land || null
  // E-mail
  if (match('e-mail', 'email', 'emailadres'))
    return profiel.email || null
  // Telefoon
  if (match('telefoon', 'telefoonnummer', 'tel.', 'mobiel'))
    return profiel.telefoon || null
  // Website
  if (match('website', 'internetadres', 'url'))
    return profiel.website || null
  // Contactpersoon
  if (match('contactpersoon', 'naam contact', 'naam gemachtigde') && !match('functie'))
    return profiel.contactpersoon || null
  // Functie
  if (match('functie', 'titel', 'rol') && (match('contact', 'gemachtigde', 'ondertekenaar', 'vertegenwoordiger')))
    return profiel.functie_contactpersoon || null
  // Rechtsvorm
  if (match('rechtsvorm', 'ondernemingsvorm', 'vennootschapsvorm'))
    return profiel.rechtsvorm || null

  // Extra velden: zoek op sleutel
  if (profiel.extra_velden) {
    try {
      const extra = JSON.parse(profiel.extra_velden) as Record<string, string>
      for (const [key, val] of Object.entries(extra)) {
        if (key.trim() && hay.includes(key.toLowerCase().trim())) return val
      }
    } catch { /* ignore */ }
  }

  return null
}

/** Geeft terug hoeveel velden matchen met het opgegeven profiel (voor badge in selector). */
function countMatchingFields(fields: AgentFieldDefinition[], profiel: BedrijfsProfiel): number {
  return fields.filter((f) => pickProfileValueForField(f, profiel) !== null).length
}

export function DocumentFillWizard() {
  const { wizard, closeWizard } = useAgentStore()
  const { open, tenderId, documentNaam } = wizard

  const [loading, setLoading] = useState(false)
  const [steps, setSteps] = useState<WizardStep[]>([])
  const [states, setStates] = useState<AgentFillState[]>([])
  const [values, setValues] = useState<FieldValueMap>({})
  const [proposed, setProposed] = useState<FieldValueMap>({})
  const [sources, setSources] = useState<Record<string, 'ai' | 'user' | 'learning'>>({})
  const [contradictions, setContradictions] = useState<ContradictionMap>({})
  const [stepIndex, setStepIndex] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [pending, setPending] = useState<Record<string, NodeJS.Timeout | number | undefined>>({})
  const [exportingPdf, setExportingPdf] = useState(false)
  const [exportPdfDone, setExportPdfDone] = useState(false)
  // Bedrijfsprofielen voor auto-invul banner
  const [profielen, setProfielen] = useState<BedrijfsProfiel[]>([])
  const [selectedProfielId, setSelectedProfielId] = useState<string>('')
  const [profielApplied, setProfielApplied] = useState(false)
  const [profielApplying, setProfielApplying] = useState(false)
  const loadWizard = useCallback(
    async (reanalyze = false) => {
      if (!tenderId || !documentNaam) return
      setLoading(true)
      setError(null)
      try {
        const res = (await api.agentStartFill?.({
          tenderId,
          documentNaam,
          reanalyze,
        })) as
          | {
              ok: boolean
              error?: string
              steps?: WizardStep[]
              states?: AgentFillState[]
            }
          | null
        if (!res?.ok) {
          setError(res?.error || 'Kon document niet analyseren')
          setLoading(false)
          return
        }
        setSteps(res.steps || [])
        setStates(res.states || [])
        const vs: FieldValueMap = {}
        const ps: FieldValueMap = {}
        const ss: Record<string, 'ai' | 'user' | 'learning'> = {}
        const cs: ContradictionMap = {}
        for (const st of res.states || []) {
          vs[st.field_id] = st.value_text || ''
          if (st.status === 'proposed') ps[st.field_id] = st.value_text || ''
          ss[st.field_id] = st.source
          if (st.contradiction_flag && st.contradiction_detail) {
            cs[st.field_id] = {
              field_id: st.field_id,
              field_label: st.field_label,
              severity: /ERROR/.test(st.contradiction_detail) ? 'error' : 'warn',
              message: st.contradiction_detail.replace(/^(INFO|WARN|ERROR):\s*/, ''),
            }
          }
        }
        setValues(vs)
        setProposed(ps)
        setSources(ss)
        setContradictions(cs)
        // Spring naar eerste onbekende verplichte veld
        const firstUnfilled = (res.steps || []).findIndex((s) =>
          s.fields.some((f) => f.required && !(vs[f.id] && vs[f.id].trim())),
        )
        setStepIndex(firstUnfilled >= 0 ? firstUnfilled : 0)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setLoading(false)
      }
    },
    [tenderId, documentNaam],
  )

  useEffect(() => {
    if (open) {
      void loadWizard(false)
      // Laad bedrijfsprofielen
      void (async () => {
        try {
          const list = (await api.getBedrijfsprofielen?.()) as BedrijfsProfiel[] | null
          const ps = list ?? []
          setProfielen(ps)
          // Zet standaard profiel voor-geselecteerd
          const def = ps.find((p) => p.is_standaard)
          if (def) setSelectedProfielId(def.id)
          else if (ps.length > 0) setSelectedProfielId(ps[0].id)
        } catch { /* ignore */ }
      })()
    } else {
      setSteps([])
      setStates([])
      setValues({})
      setProposed({})
      setSources({})
      setContradictions({})
      setStepIndex(0)
      setError(null)
      setProfielen([])
      setSelectedProfielId('')
      setProfielApplied(false)
    }
  }, [open, loadWizard])

  const totalFields = useMemo(() => steps.reduce((n, s) => n + s.fields.length, 0), [steps])
  const filledFields = useMemo(
    () =>
      Object.entries(values).filter(([, v]) => v && v.trim()).length,
    [values],
  )
  const currentStep = steps[stepIndex]

  // Alle velden (plat, voor profielmatch)
  const allFields = useMemo(() => steps.flatMap((s) => s.fields), [steps])

  // Hoeveel velden matchen met geselecteerd profiel?
  const selectedProfiel = useMemo(
    () => profielen.find((p) => p.id === selectedProfielId) ?? null,
    [profielen, selectedProfielId],
  )
  const matchCount = useMemo(
    () => (selectedProfiel ? countMatchingFields(allFields, selectedProfiel) : 0),
    [allFields, selectedProfiel],
  )

  const handleApplyProfiel = useCallback(async () => {
    if (!selectedProfiel || !tenderId || !documentNaam) return
    setProfielApplying(true)
    try {
      const updates: Array<{ field: AgentFieldDefinition; value: string }> = []
      for (const f of allFields) {
        const val = pickProfileValueForField(f, selectedProfiel)
        if (val && val.trim()) updates.push({ field: f, value: val })
      }
      for (const { field, value } of updates) {
        setValues((v) => ({ ...v, [field.id]: value }))
        setSources((s) => ({ ...s, [field.id]: 'user' }))
        await api.agentSaveFillField?.({
          tenderId,
          documentNaam,
          fieldId: field.id,
          value,
          source: 'user',
          fieldLabel: field.label,
          learn: true,
        })
      }
      setProfielApplied(true)
    } finally {
      setProfielApplying(false)
    }
  }, [selectedProfiel, allFields, tenderId, documentNaam])

  const saveField = useCallback(
    async (field: AgentFieldDefinition, value: string, immediate = false) => {
      if (!tenderId || !documentNaam) return
      const isUser = proposed[field.id] !== value
      setSources((s) => ({ ...s, [field.id]: isUser ? 'user' : s[field.id] || 'ai' }))

      const doSave = async () => {
        setSaving(true)
        try {
          const res = (await api.agentSaveFillField?.({
            tenderId,
            documentNaam,
            fieldId: field.id,
            value,
            source: isUser ? 'user' : 'ai',
            fieldLabel: field.label,
            learn: isUser,
          })) as
            | { ok: boolean; error?: string; state?: AgentFillState; contradiction?: AgentContradictionWarning | null }
            | null
          if (res?.contradiction) {
            setContradictions((c) => ({ ...c, [field.id]: res.contradiction! }))
          } else {
            setContradictions((c) => {
              const n = { ...c }
              delete n[field.id]
              return n
            })
          }
        } finally {
          setSaving(false)
        }
      }

      if (immediate) {
        await doSave()
        return
      }

      // Debounce: 600ms
      setPending((prev) => {
        const existing = prev[field.id]
        if (existing) clearTimeout(existing as number)
        const t = setTimeout(() => {
          void doSave()
        }, 600) as unknown as number
        return { ...prev, [field.id]: t }
      })
    },
    [tenderId, documentNaam, proposed],
  )

  const handleChange = (field: AgentFieldDefinition, value: string) => {
    setValues((v) => ({ ...v, [field.id]: value }))
    void saveField(field, value, false)
  }

  const handleAccept = (field: AgentFieldDefinition) => {
    const v = values[field.id] || proposed[field.id] || ''
    void saveField(field, v, true)
    setSources((s) => ({ ...s, [field.id]: 'user' }))
  }

  const handleReject = (field: AgentFieldDefinition) => {
    setValues((v) => ({ ...v, [field.id]: '' }))
    void saveField(field, '', true)
  }

  const handleExportPdf = async () => {
    if (!tenderId || !documentNaam) return
    setExportingPdf(true)
    try {
      await api.agentExportFilledDocument?.({ tenderId, documentNaam })
      setExportPdfDone(true)
      setTimeout(() => setExportPdfDone(false), 3000)
    } finally {
      setExportingPdf(false)
    }
  }

  const handleExportMarkdown = async () => {
    if (!tenderId || !documentNaam) return
    const res = (await api.agentExportFill?.({ tenderId, documentNaam })) as
      | { ok: boolean; markdown?: string }
      | null
    if (res?.ok && res.markdown) {
      const blob = new Blob([res.markdown], { type: 'text/markdown' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${documentNaam}-ingevuld.md`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[92vh] w-full max-w-4xl flex-col rounded-xl bg-[var(--card)] shadow-2xl">
        <header className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
          <div>
            <div className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-blue-600" />
              <h2 className="text-base font-semibold">Document invullen</h2>
            </div>
            <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">{documentNaam}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-[var(--muted-foreground)]">
              {filledFields}/{totalFields} velden ingevuld
            </span>
            <button
              onClick={() => void loadWizard(true)}
              className="flex items-center gap-1 rounded border border-[var(--border)] px-2 py-1 text-xs hover:bg-[var(--muted)]"
              title="Opnieuw analyseren"
            >
              <BrainCircuit className="h-3.5 w-3.5" /> Heranalyseer
            </button>
            <button
              onClick={() => void handleExportPdf()}
              disabled={exportingPdf || filledFields === 0}
              className="flex items-center gap-1 rounded border border-[var(--border)] bg-blue-50 px-2 py-1 text-xs text-blue-700 hover:bg-blue-100 disabled:opacity-50"
              title="Sla ingevuld document op als PDF"
            >
              {exportingPdf ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : exportPdfDone ? (
                <Check className="h-3.5 w-3.5 text-green-600" />
              ) : (
                <Download className="h-3.5 w-3.5" />
              )}
              {exportPdfDone ? 'Opgeslagen' : 'Opslaan PDF'}
            </button>
            <button
              onClick={() => void handleExportMarkdown()}
              className="flex items-center gap-1 rounded border border-[var(--border)] px-2 py-1 text-xs hover:bg-[var(--muted)]"
              title="Exporteer ingevulde waarden als tekst"
            >
              <FileDown className="h-3.5 w-3.5" /> Tekst
            </button>
            <button onClick={closeWizard} className="rounded p-1 hover:bg-[var(--muted)]">
              <X className="h-5 w-5" />
            </button>
          </div>
        </header>

        {loading ? (
          <div className="flex flex-1 items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
            <span className="ml-2 text-sm text-[var(--muted-foreground)]">Document analyseren…</span>
          </div>
        ) : error ? (
          <div className="flex flex-1 items-center justify-center p-6 text-center">
            <div>
              <AlertTriangle className="mx-auto h-8 w-8 text-amber-500" />
              <p className="mt-2 text-sm text-red-700">{error}</p>
              <button
                onClick={() => void loadWizard(true)}
                className="mt-3 rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700"
              >
                Opnieuw proberen
              </button>
            </div>
          </div>
        ) : steps.length === 0 ? (
          <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-[var(--muted-foreground)]">
            Geen invulbare velden gevonden in dit document.
          </div>
        ) : (
          <>
            <div className="border-b border-[var(--border)] bg-[var(--muted)]/40 px-4 py-2">
              <div className="flex flex-wrap items-center gap-1 text-xs">
                {steps.map((s, i) => {
                  const stepFilled = s.fields.every((f) => values[f.id] && values[f.id].trim())
                  const hasContra = s.fields.some((f) => !!contradictions[f.id])
                  return (
                    <button
                      key={i}
                      onClick={() => setStepIndex(i)}
                      className={cn(
                        'rounded-full px-2.5 py-1 border',
                        i === stepIndex
                          ? 'bg-blue-600 text-white border-blue-600'
                          : 'bg-[var(--background)] text-[var(--foreground)] border-[var(--border)] hover:bg-blue-50',
                        hasContra && 'ring-1 ring-red-400',
                        stepFilled && i !== stepIndex && 'border-green-500',
                      )}
                    >
                      {i + 1}. {s.title}
                      {stepFilled && ' ✓'}
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {/* Bedrijfsprofiel banner — toon als er profielen zijn en matchende velden */}
              {profielen.length > 0 && matchCount > 0 && !profielApplied && (
                <div className="mb-4 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 flex flex-wrap items-center gap-3">
                  <Building2 className="h-5 w-5 shrink-0 text-blue-600" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-blue-900">Welk bedrijf schrijft in?</p>
                    <p className="text-xs text-blue-700 mt-0.5">
                      {matchCount} veld{matchCount !== 1 ? 'en' : ''} kunnen automatisch worden ingevuld met bedrijfsgegevens.
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2 flex-wrap">
                    <select
                      value={selectedProfielId}
                      onChange={(e) => setSelectedProfielId(e.target.value)}
                      className="rounded-lg border border-blue-300 bg-white px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                    >
                      {profielen.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.naam}{p.rechtsvorm ? ` (${p.rechtsvorm})` : ''}
                          {p.is_standaard ? ' ★' : ''}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => void handleApplyProfiel()}
                      disabled={profielApplying || !selectedProfielId}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                      {profielApplying ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Building2 className="h-3.5 w-3.5" />
                      )}
                      {profielApplying ? 'Invullen…' : `Invullen (${matchCount})`}
                    </button>
                  </div>
                </div>
              )}
              {profielen.length > 0 && matchCount > 0 && profielApplied && (
                <div className="mb-4 rounded-xl border border-green-200 bg-green-50 px-4 py-3 flex items-center gap-3">
                  <Check className="h-4 w-4 text-green-600 shrink-0" />
                  <p className="text-sm text-green-800">
                    Bedrijfsgegevens van <strong>{selectedProfiel?.naam}</strong> ingevuld.
                    <button
                      type="button"
                      className="ml-2 text-xs text-green-700 underline hover:no-underline"
                      onClick={() => setProfielApplied(false)}
                    >
                      Ander bedrijf kiezen
                    </button>
                  </p>
                </div>
              )}
              {currentStep && (
                <div className="space-y-4">
                  {currentStep.fields.map((f) => (
                    <FieldEditor
                      key={f.id}
                      field={f}
                      value={values[f.id] || ''}
                      proposed={proposed[f.id]}
                      source={sources[f.id]}
                      contradiction={contradictions[f.id]}
                      onChange={(v) => handleChange(f, v)}
                      onAccept={() => handleAccept(f)}
                      onReject={() => handleReject(f)}
                    />
                  ))}
                </div>
              )}
            </div>

            <footer className="flex items-center justify-between border-t border-[var(--border)] bg-[var(--muted)]/30 px-4 py-3">
              <div className="text-xs text-[var(--muted-foreground)]">
                {saving ? (
                  <span className="inline-flex items-center gap-1 text-blue-700">
                    <Save className="h-3 w-3" /> Opslaan…
                  </span>
                ) : (
                  <span>Wijzigingen worden automatisch opgeslagen. De agent leert van elke correctie.</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setStepIndex(Math.max(0, stepIndex - 1))}
                  disabled={stepIndex === 0}
                  className="flex items-center gap-1 rounded border border-[var(--border)] px-3 py-1.5 text-xs hover:bg-[var(--muted)] disabled:opacity-50"
                >
                  <ChevronLeft className="h-3.5 w-3.5" /> Vorige
                </button>
                {stepIndex < steps.length - 1 ? (
                  <button
                    onClick={() => setStepIndex(Math.min(steps.length - 1, stepIndex + 1))}
                    className="flex items-center gap-1 rounded bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-700"
                  >
                    Volgende <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                ) : (
                  <button
                    onClick={closeWizard}
                    className="flex items-center gap-1 rounded bg-green-600 px-3 py-1.5 text-xs text-white hover:bg-green-700"
                  >
                    <Check className="h-3.5 w-3.5" /> Afsluiten
                  </button>
                )}
              </div>
            </footer>
          </>
        )}
      </div>
    </div>
  )
}

function FieldEditor(props: {
  field: AgentFieldDefinition
  value: string
  proposed?: string
  source?: 'ai' | 'user' | 'learning'
  contradiction?: AgentContradictionWarning
  onChange: (v: string) => void
  onAccept: () => void
  onReject: () => void
}) {
  const { field, value, proposed, source, contradiction, onChange, onAccept, onReject } = props

  return (
    <div
      className={cn(
        'rounded-lg border p-3',
        contradiction ? (contradiction.severity === 'error' ? 'border-red-400 bg-red-50/40' : 'border-amber-400 bg-amber-50/40') : 'border-[var(--border)]',
      )}
    >
      <div className="mb-1 flex items-start justify-between gap-2">
        <div>
          <label className="text-sm font-medium">
            {field.label}
            {field.required && <span className="ml-1 text-red-600">*</span>}
          </label>
          {field.description && (
            <p className="mt-0.5 text-[11px] text-[var(--muted-foreground)]">{field.description}</p>
          )}
        </div>
        <div className="flex items-center gap-1 text-[10px]">
          {source === 'learning' && (
            <span className="rounded bg-purple-100 px-1.5 py-0.5 text-purple-800" title="Geleerd van eerdere invulling">
              Geleerd
            </span>
          )}
          {source === 'ai' && proposed && proposed === value && (
            <span className="rounded bg-blue-100 px-1.5 py-0.5 text-blue-800">AI-voorstel</span>
          )}
          {source === 'user' && value && (
            <span className="rounded bg-green-100 px-1.5 py-0.5 text-green-800">Ingevuld</span>
          )}
        </div>
      </div>

      <FieldInput field={field} value={value} onChange={onChange} />

      {proposed && proposed !== value && (
        <div className="mt-2 rounded border border-blue-200 bg-blue-50 p-2 text-[11px]">
          <div className="mb-1 font-semibold text-blue-900">AI-voorstel:</div>
          <div className="mb-2 whitespace-pre-wrap text-blue-900/90">{proposed}</div>
          <div className="flex gap-2">
            <button
              onClick={() => {
                onChange(proposed)
                onAccept()
              }}
              className="rounded bg-blue-600 px-2 py-0.5 text-[10px] text-white hover:bg-blue-700"
            >
              Accepteer voorstel
            </button>
            <button
              onClick={onReject}
              className="rounded border border-blue-300 px-2 py-0.5 text-[10px] text-blue-800 hover:bg-blue-100"
            >
              Verwerp
            </button>
          </div>
        </div>
      )}

      {contradiction && (
        <div
          className={cn(
            'mt-2 flex items-start gap-2 rounded p-2 text-[11px]',
            contradiction.severity === 'error' ? 'bg-red-100 text-red-900' : 'bg-amber-100 text-amber-900',
          )}
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div>
            <div className="font-semibold">
              {contradiction.severity === 'error' ? 'Tegenstrijdig met tendervoorwaarden' : 'Let op'}
            </div>
            <div>{contradiction.message}</div>
          </div>
        </div>
      )}
    </div>
  )
}

function FieldInput(props: { field: AgentFieldDefinition; value: string; onChange: (v: string) => void }) {
  const { field, value, onChange } = props
  const common = 'w-full rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-sm'
  switch (field.type) {
    case 'textarea':
      return (
        <textarea
          className={cn(common, 'min-h-[80px]')}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )
    case 'date':
      return (
        <input type="date" className={common} value={value} onChange={(e) => onChange(e.target.value)} />
      )
    case 'amount':
    case 'number':
      return (
        <input
          type="text"
          inputMode="decimal"
          className={common}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.type === 'amount' ? '€ 1.234,56' : ''}
        />
      )
    case 'choice':
      return (
        <select className={common} value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">— Kies —</option>
          {(field.options || []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )
    case 'multichoice': {
      const selected = new Set((value || '').split('|').filter(Boolean))
      return (
        <div className="flex flex-wrap gap-2">
          {(field.options || []).map((o) => {
            const checked = selected.has(o.value)
            return (
              <label
                key={o.value}
                className={cn(
                  'flex items-center gap-1 rounded border px-2 py-1 text-xs cursor-pointer',
                  checked ? 'bg-blue-100 border-blue-400 text-blue-900' : 'bg-[var(--background)] border-[var(--border)]',
                )}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => {
                    if (checked) selected.delete(o.value)
                    else selected.add(o.value)
                    onChange(Array.from(selected).join('|'))
                  }}
                />
                {o.label}
              </label>
            )
          })}
        </div>
      )
    }
    case 'boolean':
      return (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={value === 'true' || value === '1'}
            onChange={(e) => onChange(e.target.checked ? 'true' : 'false')}
          />
          {field.label}
        </label>
      )
    default:
      return (
        <input
          type="text"
          className={common}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )
  }
}
