import { useState, useEffect, useRef } from 'react'
import { useSettings, useSchedules, useZoektermen, useSources } from '../hooks/use-ipc'
import { api, isElectron } from '../lib/ipc-client'
import { Link, useNavigate } from 'react-router-dom'
import { SettingsPinModal, isSettingsPinUnlocked, isReleaseAdminPinUnlocked } from '../components/settings-pin-modal'
import { ReleaseAdminSection } from '../components/ReleaseAdminSection'
import {
  Clock, Search, Save, Plus, Trash2, X,
  CheckCircle2, AlertCircle, RefreshCw, Loader2, Cloud, CloudUpload, FolderOpen,
  MessageSquareText, Stethoscope, Building2, Link2, Play, ExternalLink, Rocket,
} from 'lucide-react'
import {
  APP_SETTING_DOC_FILL_PROMPT,
  APP_SETTING_RISICO_PROMPT_EXTRACTIE,
  APP_SETTING_RISICO_PROMPT_HOOFD,
} from '@shared/constants'
import { BedrijfsprofielTab } from '../components/BedrijfsprofielTab'
import { FEATURE_DOCUMENT_FORM_FILL } from '../../shared/feature-flags'

type SchedulePatternKind = 'daily' | 'weekdays' | 'weekly' | 'interval'

type SettingsMainTab = 'algemeen' | 'prompts' | 'bedrijven' | 'versiebeheer'

type AIPromptRow = {
  id: string
  naam: string
  type: string
  prompt_tekst: string
  is_actief?: number
}

function buildCronExpression(
  timeHHMM: string,
  pattern: SchedulePatternKind,
  weeklyDow: number,
  intervalHours: number
): string | null {
  const [hStr, mStr] = timeHHMM.split(':')
  const hour = parseInt(hStr, 10)
  const minute = parseInt(mStr, 10)
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null

  if (pattern === 'interval') {
    const h = intervalHours
    if (!Number.isFinite(h) || h < 1 || h > 23) return null
    // Unieke uren op de 24u-klok, startend bij het gekozen uur (niet alleen 0,6,12,18 bij */6).
    const seen = new Set<number>()
    const hours: number[] = []
    let cur = hour
    while (!seen.has(cur)) {
      seen.add(cur)
      hours.push(cur)
      cur = (cur + h) % 24
    }
    hours.sort((a, b) => a - b)
    return `${minute} ${hours.join(',')} * * *`
  }
  if (pattern === 'daily') return `${minute} ${hour} * * *`
  if (pattern === 'weekdays') return `${minute} ${hour} * * 1-5`
  if (pattern === 'weekly') {
    const dow = weeklyDow
    if (!Number.isFinite(dow) || dow < 0 || dow > 6) return null
    return `${minute} ${hour} * * ${dow}`
  }
  return null
}

/** Zelfde logica als buildCronExpression: minuut en uur uit 5- of 6-velds node-cron-string. */
function cronMinuteHourDomMonthDow(parts: string[]): {
  minute: number
  hour: number
  dom: string
  month: string
  dow: string
} | null {
  if (parts.length === 5) {
    const minute = parseInt(parts[0], 10)
    const hour = parseInt(parts[1], 10)
    if (!Number.isFinite(minute) || !Number.isFinite(hour)) return null
    return { minute, hour, dom: parts[2], month: parts[3], dow: parts[4] }
  }
  if (parts.length === 6) {
    const minute = parseInt(parts[1], 10)
    const hour = parseInt(parts[2], 10)
    if (!Number.isFinite(minute) || !Number.isFinite(hour)) return null
    return { minute, hour, dom: parts[3], month: parts[4], dow: parts[5] }
  }
  return null
}

function formatNlTimeHm(hour: number, minute: number): string {
  const d = new Date(2000, 0, 3, hour, minute, 0, 0)
  return d.toLocaleTimeString('nl-NL', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
}

/** Oude naam "Scrape" in de database vriendelijk tonen als Tracking. */
function describeScheduleBronnen(
  rawIds: string | null | undefined,
  allBronnen: { id: string; naam: string }[],
): string {
  try {
    const ids = JSON.parse(rawIds || '[]') as string[]
    if (!Array.isArray(ids) || ids.length === 0) {
      return 'Alle actieve bronnen (oud schema — geen expliciete keuze)'
    }
    const names = ids
      .map((id) => allBronnen.find((b) => b.id === id)?.naam || id)
      .filter(Boolean)
    if (names.length === 0) return `${ids.length} bron(nen)`
    if (names.length <= 3) return names.join(', ')
    return `${names.slice(0, 3).join(', ')} +${names.length - 3}`
  } catch {
    return 'Bronnen'
  }
}

function displayScheduleName(naam: string): string {
  const t = naam?.trim()
  if (t && /^scrape$/i.test(t)) return 'Tracking'
  return naam
}

function describeCron(cron: string): string {
  const raw = cron.trim()
  const parts = raw.split(/\s+/).filter(Boolean)

  const m4 = raw.match(/^(\d+) \*\/(\d+) \* \* \*$/)
  if (m4) return `Elke ${m4[2]} uur (op het hele uur — oude schema’s; maak zo nodig opnieuw aan voor je starttijd)`

  const mList = raw.match(/^(\d+) ([\d,]+) \* \* \*$/)
  if (mList) {
    const min = mList[1]
    const hrs = mList[2].split(',').map((x) => parseInt(x, 10)).filter((n) => Number.isFinite(n))
    if (hrs.length > 1) {
      const times = hrs.map((h) => formatNlTimeHm(h, parseInt(min, 10)))
      return `Elke ${hrs.length} runs per dag: ${times.join(', ')}`
    }
  }

  const parsed = cronMinuteHourDomMonthDow(parts)
  if (parsed && parsed.dom === '*' && parsed.month === '*') {
    const { minute, hour, dow } = parsed
    const timeLabel = formatNlTimeHm(hour, minute)
    if (dow === '*') return `Dagelijks om ${timeLabel}`
    if (dow === '1-5') return `Werkdagen (ma–vr) om ${timeLabel}`
    if (/^[0-6]$/.test(dow)) {
      const days = ['zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag']
      const d = days[parseInt(dow, 10)] || dow
      return `Wekelijks op ${d} om ${timeLabel}`
    }
  }

  return raw
}

export function SettingsPage() {
  const navigate = useNavigate()
  const [pinUnlocked, setPinUnlocked] = useState(() => isSettingsPinUnlocked())
  const [releaseAdminUnlocked, setReleaseAdminUnlocked] = useState(() => isReleaseAdminPinUnlocked())

  const { data: settings, refresh: refreshSettings } = useSettings()
  const { data: schedules, refresh: refreshSchedules } = useSchedules()
  const { data: zoektermen, refresh: refreshZoektermen } = useZoektermen()
  const { data: bronWebsites } = useSources()

  const [mainTab, setMainTab] = useState<SettingsMainTab>('algemeen')
  const [promptAgentId, setPromptAgentId] = useState<string | null>(null)
  const [promptScorerId, setPromptScorerId] = useState<string | null>(null)
  const [promptAgentText, setPromptAgentText] = useState('')
  const [promptScorerText, setPromptScorerText] = useState('')
  const [risicoHoofdText, setRisicoHoofdText] = useState('')
  const [risicoExtractieText, setRisicoExtractieText] = useState('')
  const [docFillPromptText, setDocFillPromptText] = useState('')
  const [promptsLoadError, setPromptsLoadError] = useState<string | null>(null)
  const [promptsSaving, setPromptsSaving] = useState(false)
  const [promptsSaved, setPromptsSaved] = useState(false)
  const promptsLoadedOnce = useRef(false)

  const [cloudSyncPath, setCloudSyncPath] = useState('')
  const [cloudSyncEnabled, setCloudSyncEnabled] = useState(false)
  const [cloudSyncSaved, setCloudSyncSaved] = useState(false)
  const [cloudSyncBusy, setCloudSyncBusy] = useState(false)
  const [cloudSyncNote, setCloudSyncNote] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null)
  const [cloudManifestText, setCloudManifestText] = useState<string | null>(null)

  // Supabase sync
  const [sbSyncBusy, setSbSyncBusy] = useState(false)
  const [sbSyncNote, setSbSyncNote] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null)
  const [sbSyncStatus, setSbSyncStatus] = useState<{
    lastPushAt: string | null
    lastPullAt: string | null
    pushCount: number
    pullCount: number
    lastError: string | null
  } | null>(null)
  const [supabaseFormUrl, setSupabaseFormUrl] = useState('')
  const [supabaseFormKey, setSupabaseFormKey] = useState('')
  const [supabaseFormSaving, setSupabaseFormSaving] = useState(false)
  const [supabaseFormSaved, setSupabaseFormSaved] = useState(false)
  /** Alleen actief tijdens «Alles uploaden» — toont voortgangsbalk (IPC `sync:progress`). */
  const [sbFullPushProgress, setSbFullPushProgress] = useState<{ percent: number; label: string } | null>(null)

  /** Supabase «ping» (leestoegang, RLS). */
  const [sbConnTestBusy, setSbConnTestBusy] = useState(false)

  // ── Handmatige URL-verwerking ──
  const [processUrl, setProcessUrl] = useState('')
  const [processUrlBusy, setProcessUrlBusy] = useState(false)
  const [processUrlStep, setProcessUrlStep] = useState('')
  const [processUrlPct, setProcessUrlPct] = useState(0)
  const [processUrlResult, setProcessUrlResult] = useState<{
    tone: 'ok' | 'warn' | 'info'
    text: string
    tenderId?: string
    tenderTitel?: string
  } | null>(null)

  // Abonneer permanent op voortgangsberichten vanuit de achtergrondtaak.
  // De taak loopt door ongeacht navigatie; done: true geeft het eindresultaat.
  useEffect(() => {
    if (!isElectron) return
    const unsub = (api as any).onProcessUrlProgress?.(
      (data: { step: string; percentage: number; done?: boolean; tenderId?: string; tenderTitel?: string; hasDocuments?: boolean; error?: boolean; errorMessage?: string }) => {
        setProcessUrlStep(data.step)
        setProcessUrlPct(data.percentage)
        if (data.done) {
          if (data.error) {
            setProcessUrlResult({ tone: 'warn', text: data.errorMessage || 'Verwerking mislukt.' })
          } else {
            setProcessUrlResult({
              tone: 'ok',
              text: data.hasDocuments
                ? `Verwerkt: "${data.tenderTitel}" — documenten gevonden, analyse loopt op de achtergrond.`
                : `Aangemaakt: "${data.tenderTitel}" — geen documenten gevonden op de bronpagina. Analyse loopt alsnog.`,
              tenderId: data.tenderId,
              tenderTitel: data.tenderTitel,
            })
          }
          setProcessUrlBusy(false)
          setProcessUrlStep('')
          setProcessUrlPct(0)
        }
      },
    )
    return () => unsub?.()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isElectron])

  const loadSbSyncStatus = async () => {
    if (!isElectron || !api.syncGetStatus) return
    const s = (await api.syncGetStatus()) as {
      lastPushAt: string | null
      lastPullAt: string | null
      pushCount: number
      pullCount: number
      lastError: string | null
    }
    setSbSyncStatus(s)
  }

  const handleSbTestConnection = async () => {
    if (!isElectron || typeof api.syncTestConnection !== 'function') {
      setSbSyncNote({
        tone: 'warn',
        text: 'Test niet beschikbaar. Herstart de app na update.',
      })
      return
    }
    setSbConnTestBusy(true)
    setSbSyncNote(null)
    try {
      const r = await api.syncTestConnection()
      if (r.ok) {
        setSbSyncNote({
          tone: 'ok',
          text: 'Verbinding OK — Supabase accepteert lezen vanuit de app (URL, key en RLS).',
        })
      } else {
        setSbSyncNote({
          tone: 'warn',
          text: r.error ?? 'Verbinding geweigerd.',
        })
      }
    } catch (e) {
      setSbSyncNote({
        tone: 'warn',
        text: e instanceof Error ? e.message : String(e),
      })
    } finally {
      setSbConnTestBusy(false)
    }
  }

  const handleSbSyncNow = async () => {
    if (!isElectron) return
    if (typeof api.syncNow !== 'function') {
      setSbSyncNote({
        tone: 'warn',
        text: 'Sync is niet geladen. Herstart de app of gebruik de geïnstalleerde TenderTracker.',
      })
      return
    }
    setSbSyncBusy(true)
    setSbSyncNote(null)
    try {
      const r = (await api.syncNow()) as {
        pushCount: number
        pullCount: number
        lastError: string | null
        lastPushAt: string | null
        lastPullAt: string | null
      }
      if (r.lastError) {
        setSbSyncNote({ tone: 'warn', text: `Sync mislukt: ${r.lastError}` })
      } else {
        setSbSyncNote({
          tone: 'ok',
          text: `Sync voltooid — ${r.pushCount} rij(en) geüpload, ${r.pullCount} rij(en) gedownload.`,
        })
      }
      void loadSbSyncStatus()
    } catch (e) {
      setSbSyncNote({
        tone: 'warn',
        text: e instanceof Error ? e.message : `Onverwachte fout: ${String(e)}`,
      })
    } finally {
      setSbSyncBusy(false)
    }
  }

  const handleSbFullPull = async () => {
    if (!isElectron) return
    if (typeof api.syncFullPull !== 'function') {
      setSbSyncNote({
        tone: 'warn',
        text: 'Cloud-download is niet geladen. Sluit de app en open TenderTracker opnieuw (geïnstalleerde app of actuele `npm run dev`).',
      })
      return
    }
    setSbSyncBusy(true)
    setSbSyncNote(null)
    try {
      const r = (await api.syncFullPull()) as {
        pullCount: number
        lastError: string | null
        documentPullCount?: number
        documentPullFailed?: number
      }
      if (r.lastError) {
        setSbSyncNote({ tone: 'warn', text: `Volledige download mislukt: ${r.lastError}` })
      } else {
        const doc = r.documentPullCount != null && (r.documentPullCount > 0 || (r.documentPullFailed ?? 0) > 0)
          ? ` Bijlagen: ${r.documentPullCount ?? 0} opgeslagen${(r.documentPullFailed ?? 0) > 0 ? `, ${r.documentPullFailed} mislukt` : ''}.`
          : ''
        setSbSyncNote({
          tone: 'ok',
          text: `Klaar — ${r.pullCount} tabelrij(en) opgehaald uit de cloud.${doc}`,
        })
      }
    } catch (e) {
      setSbSyncNote({
        tone: 'warn',
        text: e instanceof Error ? e.message : `Onverwachte fout: ${String(e)}`,
      })
    } finally {
      void loadSbSyncStatus()
      setSbSyncBusy(false)
    }
  }

  const handleSbFullPush = async () => {
    if (!isElectron) return
    if (typeof api.syncFullPush !== 'function') {
      setSbSyncNote({
        tone: 'warn',
        text: 'Cloud-upload is niet geladen. Herstart de app of gebruik de geïnstalleerde TenderTracker.',
      })
      return
    }
    setSbSyncBusy(true)
    setSbSyncNote(null)
    setSbFullPushProgress({ percent: 0, label: 'Upload starten…' })
    const offSyncProgress =
      typeof api.onSyncProgress === 'function'
        ? api.onSyncProgress((p) => setSbFullPushProgress(p))
        : undefined
    try {
      const r = (await api.syncFullPush()) as {
        pushCount: number
        lastError: string | null
        documentPushCount?: number
        documentPushFailed?: number
      }
      if (r.lastError) {
        setSbSyncNote({ tone: 'warn', text: `Volledige upload mislukt: ${r.lastError}` })
      } else {
        const doc =
          r.documentPushCount != null && (r.documentPushCount > 0 || (r.documentPushFailed ?? 0) > 0)
            ? ` Bijlagen: ${r.documentPushCount ?? 0} naar storage${(r.documentPushFailed ?? 0) > 0 ? `, ${r.documentPushFailed} mislukt` : ''}.`
            : ''
        setSbSyncNote({
          tone: 'ok',
          text: `Klaar — ${r.pushCount} tabelrij(en) naar Supabase geüpload. Lokale bestanden blijven op schijf.${doc}`,
        })
      }
    } catch (e) {
      setSbSyncNote({
        tone: 'warn',
        text: e instanceof Error ? e.message : `Onverwachte fout: ${String(e)}`,
      })
    } finally {
      offSyncProgress?.()
      setSbFullPushProgress(null)
      void loadSbSyncStatus()
      setSbSyncBusy(false)
    }
  }

  useEffect(() => {
    void loadSbSyncStatus()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!isElectron || typeof api.getSetting !== 'function') return
    void (async () => {
      const u = (await api.getSetting('supabase_url')) as string | null
      const k = (await api.getSetting('supabase_anon_key')) as string | null
      if (typeof u === 'string') setSupabaseFormUrl(u)
      if (typeof k === 'string') setSupabaseFormKey(k)
    })()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isElectron])

  const handleSaveSupabaseConnection = async () => {
    if (!isElectron || typeof api.setSetting !== 'function') return
    setSupabaseFormSaving(true)
    setSupabaseFormSaved(false)
    setSbSyncNote(null)
    try {
      await api.setSetting('supabase_url', supabaseFormUrl.trim())
      await api.setSetting('supabase_anon_key', supabaseFormKey.trim())
      setSupabaseFormSaved(true)
      window.setTimeout(() => setSupabaseFormSaved(false), 2500)
    } catch (e) {
      setSbSyncNote({
        tone: 'warn',
        text: e instanceof Error ? e.message : `Opslaan mislukt: ${String(e)}`,
      })
    } finally {
      setSupabaseFormSaving(false)
    }
  }

  const [newTerm, setNewTerm] = useState('')
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false)
  const [modalScheduleName, setModalScheduleName] = useState('')
  const [modalScheduleTime, setModalScheduleTime] = useState('08:00')
  const [modalPattern, setModalPattern] = useState<SchedulePatternKind>('weekdays')
  const [modalWeekDay, setModalWeekDay] = useState(1)
  const [modalIntervalHours, setModalIntervalHours] = useState(6)
  const [modalScheduleBronIds, setModalScheduleBronIds] = useState<string[]>([])
  const [scheduleModalError, setScheduleModalError] = useState<string | null>(null)

  const [updateCheckBusy, setUpdateCheckBusy] = useState(false)
  const [updateCheckNote, setUpdateCheckNote] = useState<{ tone: 'neutral' | 'ok' | 'warn'; text: string } | null>(null)

  useEffect(() => {
    if (settings) {
      const s = settings as Record<string, string>
      setCloudSyncPath(s.cloud_sync_path || '')
      setCloudSyncEnabled(s.cloud_sync_enabled === '1' || s.cloud_sync_enabled === 'true')
    }
  }, [settings])

  useEffect(() => {
    if (!isElectron || mainTab !== 'prompts' || promptsLoadedOnce.current) return
    let cancelled = false
    setPromptsLoadError(null)
    void (async () => {
      try {
        const list = (await api.getAIPrompts()) as AIPromptRow[]
        const active = (list || []).filter((p) => p.is_actief !== 0)
        const agent = active.find((p) => p.type === 'agent')
        const scorer = active.find((p) => p.type === 'scorer')
        const rh = await api.getSetting(APP_SETTING_RISICO_PROMPT_HOOFD)
        const re = await api.getSetting(APP_SETTING_RISICO_PROMPT_EXTRACTIE)
        const df = await api.getSetting(APP_SETTING_DOC_FILL_PROMPT)
        if (cancelled) return
        setPromptAgentId(agent?.id ?? null)
        setPromptScorerId(scorer?.id ?? null)
        setPromptAgentText(agent?.prompt_tekst ?? '')
        setPromptScorerText(scorer?.prompt_tekst ?? '')
        setRisicoHoofdText(typeof rh === 'string' ? rh : '')
        setRisicoExtractieText(typeof re === 'string' ? re : '')
        // Als er niets is opgeslagen laten we de gebruiker de ingebouwde
        // default zien (importeren kan alleen zo in de renderer).
        const { DEFAULT_DOCUMENT_FILL_PROMPT_TEXT } = await import(
          '@shared/document-fill-prompt-default'
        )
        setDocFillPromptText(
          typeof df === 'string' && df.trim().length > 40
            ? df
            : DEFAULT_DOCUMENT_FILL_PROMPT_TEXT,
        )
        promptsLoadedOnce.current = true
      } catch (e) {
        if (!cancelled) {
          setPromptsLoadError(e instanceof Error ? e.message : 'Prompts laden mislukt')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [mainTab])

  const handleSavePrompts = async () => {
    if (!isElectron) return
    setPromptsSaving(true)
    setPromptsSaved(false)
    setPromptsLoadError(null)
    try {
      if (promptAgentId) {
        await api.updateAIPrompt(promptAgentId, { prompt_tekst: promptAgentText })
      }
      if (promptScorerId) {
        await api.updateAIPrompt(promptScorerId, { prompt_tekst: promptScorerText })
      }
      await api.setSetting(APP_SETTING_RISICO_PROMPT_HOOFD, risicoHoofdText)
      await api.setSetting(APP_SETTING_RISICO_PROMPT_EXTRACTIE, risicoExtractieText)
      await api.setSetting(APP_SETTING_DOC_FILL_PROMPT, docFillPromptText)
      setPromptsSaved(true)
      setTimeout(() => setPromptsSaved(false), 2500)
    } catch (e) {
      setPromptsLoadError(e instanceof Error ? e.message : 'Opslaan mislukt')
    } finally {
      setPromptsSaving(false)
    }
  }

  useEffect(() => {
    if (!isElectron || !cloudSyncPath.trim()) {
      setCloudManifestText(null)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const r = (await api.getCloudSyncManifest?.(cloudSyncPath)) as
          | { ok: true; manifest: { lastMirrorAt: string | null; lastBackupAt: string | null } | null }
          | { ok: false; error?: string }
          | undefined
        if (cancelled || !r || !('ok' in r)) return
        if (!r.ok) {
          setCloudManifestText(null)
          return
        }
        const m = r.manifest
        if (!m?.lastMirrorAt && !m?.lastBackupAt) {
          setCloudManifestText('Nog geen synchronisatie uitgevoerd naar deze map.')
          return
        }
        const fmt = (iso: string | null) => {
          if (!iso) return '—'
          try {
            return new Date(iso).toLocaleString('nl-NL', { dateStyle: 'short', timeStyle: 'short' })
          } catch {
            return iso
          }
        }
        setCloudManifestText(
          `Laatste hoofdmap-sync: ${fmt(m.lastMirrorAt)} · Laatste back-upmap: ${fmt(m.lastBackupAt)}`
        )
      } catch {
        if (!cancelled) setCloudManifestText(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [cloudSyncPath])

  const handleSaveCloudSync = async () => {
    await api.setSetting('cloud_sync_path', cloudSyncPath.trim())
    await api.setSetting('cloud_sync_enabled', cloudSyncEnabled ? '1' : '0')
    setCloudSyncSaved(true)
    setTimeout(() => setCloudSyncSaved(false), 2000)
    refreshSettings()
    setCloudSyncNote({
      tone: 'ok',
      text: cloudSyncEnabled
        ? 'Opgeslagen. Dagelijks om 03:00 wordt de map “backup” bijgewerkt en wordt de hoofdmap gesynchroniseerd.'
        : 'Opgeslagen. Automatische cloud-sync staat uit.',
    })
  }

  const handlePickCloudFolder = async () => {
    if (!isElectron || !api.selectCloudSyncFolder) return
    setCloudSyncNote(null)
    try {
      const r = (await api.selectCloudSyncFolder()) as { ok: boolean; path: string | null; error?: string }
      if (!r.ok) {
        setCloudSyncNote({ tone: 'warn', text: r.error || 'Map kiezen mislukt.' })
        return
      }
      if (r.path) setCloudSyncPath(r.path)
    } catch (e) {
      setCloudSyncNote({ tone: 'warn', text: e instanceof Error ? e.message : 'Map kiezen mislukt.' })
    }
  }

  const handleCloudSyncNow = async () => {
    if (!isElectron || !api.runCloudMirrorSync) return
    const root = cloudSyncPath.trim()
    if (!root) {
      setCloudSyncNote({ tone: 'warn', text: 'Kies eerst een synchronisatiemap (cloudmap).' })
      return
    }
    setCloudSyncBusy(true)
    setCloudSyncNote(null)
    try {
      const res = (await api.runCloudMirrorSync(root)) as {
        ok: boolean
        error?: string
        documentFilesCopied?: number
      }
      if (!res.ok) {
        setCloudSyncNote({ tone: 'warn', text: res.error || 'Synchroniseren mislukt.' })
        return
      }
      const n = res.documentFilesCopied ?? 0
      setCloudSyncNote({
        tone: 'ok',
        text: `Synchronisatie voltooid. ${n} bijlagebestand(en) bijgewerkt of toegevoegd (bestaande cloudbestanden worden alleen overschreven als er lokaal een nieuwere versie is).`,
      })
      const man = (await api.getCloudSyncManifest?.(root)) as { ok: boolean; manifest?: { lastMirrorAt: string | null; lastBackupAt: string | null } } | undefined
      if (man?.ok && man.manifest) {
        const m = man.manifest
        const fmt = (iso: string | null) => {
          if (!iso) return '—'
          try {
            return new Date(iso).toLocaleString('nl-NL', { dateStyle: 'short', timeStyle: 'short' })
          } catch {
            return iso
          }
        }
        setCloudManifestText(
          `Laatste hoofdmap-sync: ${fmt(m.lastMirrorAt)} · Laatste back-upmap: ${fmt(m.lastBackupAt)}`
        )
      }
    } catch (e) {
      setCloudSyncNote({ tone: 'warn', text: e instanceof Error ? e.message : 'Synchroniseren mislukt.' })
    } finally {
      setCloudSyncBusy(false)
    }
  }

  const handleAddTerm = async () => {
    if (!newTerm.trim()) return
    await api.createZoekterm({ term: newTerm.trim() })
    setNewTerm('')
    refreshZoektermen()
  }

  const handleDeleteTerm = async (id: string) => {
    await api.deleteZoekterm(id)
    refreshZoektermen()
  }

  const openScheduleModal = () => {
    setScheduleModalError(null)
    setModalScheduleName('Tracking')
    setModalScheduleTime('08:00')
    setModalPattern('weekdays')
    setModalWeekDay(1)
    setModalIntervalHours(6)
    const active = ((bronWebsites as { id: string; is_actief?: number }[]) || []).filter(
      (b) => b.is_actief !== 0,
    )
    setModalScheduleBronIds(active.map((b) => b.id))
    setScheduleModalOpen(true)
  }

  const handleAddScheduleFromModal = async () => {
    if (!modalScheduleName.trim()) return
    const cron = buildCronExpression(
      modalScheduleTime,
      modalPattern,
      modalWeekDay,
      modalIntervalHours
    )
    if (!cron) {
      setScheduleModalError('Ongeldige tijd of interval. Controleer de invoer.')
      return
    }
    if (modalScheduleBronIds.length === 0) {
      setScheduleModalError('Selecteer minstens één bron die bij deze geplande run gescraped moet worden.')
      return
    }
    setScheduleModalError(null)
    try {
      await api.createSchedule({
        naam: modalScheduleName.trim(),
        cron_expressie: cron,
        bron_website_ids: modalScheduleBronIds,
      })
      setScheduleModalOpen(false)
      refreshSchedules()
    } catch (e) {
      setScheduleModalError(e instanceof Error ? e.message : 'Schema opslaan mislukt.')
    }
  }

  const handleToggleSchedule = async (id: string) => {
    await api.toggleSchedule(id)
    refreshSchedules()
  }

  const handleDeleteSchedule = async (id: string) => {
    await api.deleteSchedule(id)
    refreshSchedules()
  }

  const handleProcessUrl = async () => {
    if (!isElectron || !(api as any).processUrl) return
    const url = processUrl.trim()
    if (!url) {
      setProcessUrlResult({ tone: 'warn', text: 'Voer eerst een URL in.' })
      return
    }
    setProcessUrlBusy(true)
    setProcessUrlResult(null)
    setProcessUrlStep('Verbinding maken…')
    setProcessUrlPct(0)

    try {
      // De handler retourneert meteen nadat het DB-record is aangemaakt.
      // Het zware werk (document-discovery + analyse) loopt door in de achtergrond
      // en stuurt voortgang via onProcessUrlProgress (zie useEffect hierboven).
      const r = (await (api as any).processUrl(url)) as {
        started?: boolean
        success?: boolean
        error?: string
        alreadyExists?: boolean
        tenderId?: string
        tenderTitel?: string
      }

      if (r.alreadyExists) {
        setProcessUrlResult({
          tone: 'info',
          text: `Deze aanbesteding bestaat al: "${r.tenderTitel}"`,
          tenderId: r.tenderId,
          tenderTitel: r.tenderTitel,
        })
        setProcessUrlBusy(false)
        setProcessUrlStep('')
        setProcessUrlPct(0)
      } else if (r.started) {
        // Aangemaakt — voortgang loopt via achtergrondtaak (done: true event sluit de balk)
        setProcessUrl('')
        setProcessUrlStep('Documenten ophalen op de achtergrond…')
        setProcessUrlPct(5)
      } else if (r.success === false) {
        setProcessUrlResult({ tone: 'warn', text: r.error || 'Verwerking mislukt.' })
        setProcessUrlBusy(false)
        setProcessUrlStep('')
        setProcessUrlPct(0)
      }
    } catch (e) {
      setProcessUrlResult({ tone: 'warn', text: e instanceof Error ? e.message : 'Verwerking mislukt.' })
      setProcessUrlBusy(false)
      setProcessUrlStep('')
      setProcessUrlPct(0)
    }
  }

  const handleCheckUpdates = async () => {
    if (!isElectron || !api.checkAppUpdates) return
    setUpdateCheckBusy(true)
    setUpdateCheckNote(null)
    try {
      const r = (await api.checkAppUpdates()) as
        | { ok: true; isUpdateAvailable?: boolean; updateInfo?: { version?: string } }
        | { ok: false; message?: string }
      if (!r.ok) {
        setUpdateCheckNote({
          tone: 'warn',
          text: r.message || 'Controleren op updates is nu niet mogelijk.',
        })
        return
      }
      if (r.isUpdateAvailable) {
        // Toast rechtsonder (UpdateNotifier) via IPC na check — geen extra melding nodig
      } else {
        setUpdateCheckNote({
          tone: 'neutral',
          text: 'Geen nieuwe updates beschikbaar.',
        })
      }
    } catch (e) {
      setUpdateCheckNote({
        tone: 'warn',
        text: e instanceof Error ? e.message : 'Controleren mislukt.',
      })
    } finally {
      setUpdateCheckBusy(false)
    }
  }

  if (!pinUnlocked) {
    return (
      <SettingsPinModal
        onUnlocked={() => setPinUnlocked(true)}
        onCancel={() => navigate(-1)}
      />
    )
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex flex-wrap gap-2 border-b border-[var(--border)] pb-3">
        <button
          type="button"
          onClick={() => setMainTab('algemeen')}
          className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
            mainTab === 'algemeen'
              ? 'bg-[var(--primary)] text-[var(--primary-foreground)]'
              : 'bg-[var(--muted)]/50 text-[var(--foreground)] hover:bg-[var(--muted)]'
          }`}
        >
          Algemeen
        </button>
        <button
          type="button"
          onClick={() => setMainTab('prompts')}
          className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
            mainTab === 'prompts'
              ? 'bg-[var(--primary)] text-[var(--primary-foreground)]'
              : 'bg-[var(--muted)]/50 text-[var(--foreground)] hover:bg-[var(--muted)]'
          }`}
        >
          <MessageSquareText className="h-4 w-4" />
          AI- en risicoprompts
        </button>
        <button
          type="button"
          onClick={() => setMainTab('bedrijven')}
          className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
            mainTab === 'bedrijven'
              ? 'bg-[var(--primary)] text-[var(--primary-foreground)]'
              : 'bg-[var(--muted)]/50 text-[var(--foreground)] hover:bg-[var(--muted)]'
          }`}
        >
          <Building2 className="h-4 w-4" />
          Bedrijfsprofielen
        </button>
        <button
          type="button"
          onClick={() => {
            setMainTab('versiebeheer')
            setReleaseAdminUnlocked(isReleaseAdminPinUnlocked())
          }}
          className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
            mainTab === 'versiebeheer'
              ? 'bg-[var(--primary)] text-[var(--primary-foreground)]'
              : 'bg-[var(--muted)]/50 text-[var(--foreground)] hover:bg-[var(--muted)]'
          }`}
        >
          <Rocket className="h-4 w-4" />
          Versiebeheer
        </button>
      </div>

      {mainTab === 'prompts' ? (
        <div className="space-y-6">
          <div className="rounded-xl border bg-[var(--card)] p-6 shadow-sm">
            <h3 className="text-base font-semibold flex items-center gap-2 mb-2">
              <MessageSquareText className="h-5 w-5 text-[var(--primary)]" />
              Prompts voor analyse en risico
            </h3>
            <p className="text-xs text-[var(--muted-foreground)] mb-4 leading-relaxed">
              De <strong>aanbestedings-analyzer</strong> en <strong>relevantie-scorer</strong> worden gebruikt bij de hoofd-AI-analyse.
              De <strong>risicoprompts</strong> gelden voor de risico-inventarisatie (Kimi of fallback via je hoofdmodel).
              Bij elke run wordt automatisch een <strong>wetgevingsreferentie</strong> opgehaald (o.a. wetten.nl Aw 2012, Aanbestedingsbesluit, PIANOo, EU) en één keer per modelaanroep in het <strong>systeembericht</strong> gezet (documenten in het gebruikersbericht).
              Laat het JSON-deel met <code className="text-[10px]">RETOURNEER UITSLUITEND</code> in de hoofd-risicoprompt staan — dat wordt ook voor de synthese na grote dossiers gebruikt.
              Vernieuw de pagina om opnieuw uit de database te laden na een wijziging elders.
            </p>
            {promptsLoadError && (
              <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-200 dark:border-red-700/50 bg-red-50 dark:bg-red-950/30 px-3 py-2 text-sm text-red-800 dark:text-red-300">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {promptsLoadError}
              </div>
            )}
            {!isElectron && (
              <p className="text-sm text-[var(--muted-foreground)]">Prompts beheren is alleen beschikbaar in de desktop-app.</p>
            )}
            {isElectron && (
              <div className="space-y-5">
                <div>
                  <label className="text-sm font-medium">Aanbestedings-analyzer (agent)</label>
                  {!promptAgentId && (
                    <p className="mt-1 text-xs text-amber-700">Geen actieve agent-prompt in de database — voeg er een toe of herstel de standaardinstallatie.</p>
                  )}
                  <textarea
                    value={promptAgentText}
                    onChange={(e) => setPromptAgentText(e.target.value)}
                    disabled={!promptAgentId}
                    rows={12}
                    className="mt-2 w-full rounded-lg border bg-[var(--background)] px-3 py-2 font-mono text-xs leading-relaxed focus:outline-none focus:ring-2 focus:ring-[var(--ring)] disabled:opacity-50"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Relevantie-scorer</label>
                  {!promptScorerId && (
                    <p className="mt-1 text-xs text-amber-700">Geen actieve scorer-prompt in de database.</p>
                  )}
                  <textarea
                    value={promptScorerText}
                    onChange={(e) => setPromptScorerText(e.target.value)}
                    disabled={!promptScorerId}
                    rows={12}
                    className="mt-2 w-full rounded-lg border bg-[var(--background)] px-3 py-2 font-mono text-xs leading-relaxed focus:outline-none focus:ring-2 focus:ring-[var(--ring)] disabled:opacity-50"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Risico — hoofdprompt (single-pass en JSON-schema)</label>
                  <textarea
                    value={risicoHoofdText}
                    onChange={(e) => setRisicoHoofdText(e.target.value)}
                    rows={16}
                    className="mt-2 w-full rounded-lg border bg-[var(--background)] px-3 py-2 font-mono text-xs leading-relaxed focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Risico — extractie per documentdeel (grote dossiers)</label>
                  <textarea
                    value={risicoExtractieText}
                    onChange={(e) => setRisicoExtractieText(e.target.value)}
                    rows={14}
                    className="mt-2 w-full rounded-lg border bg-[var(--background)] px-3 py-2 font-mono text-xs leading-relaxed focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
                  />
                </div>
                {FEATURE_DOCUMENT_FORM_FILL ? (
                  <div>
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-medium">
                        Documenten invullen — veldextractie &amp; checklist (pre-analyse)
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          void (async () => {
                            const { DEFAULT_DOCUMENT_FILL_PROMPT_TEXT } = await import(
                              '@shared/document-fill-prompt-default'
                            )
                            setDocFillPromptText(DEFAULT_DOCUMENT_FILL_PROMPT_TEXT)
                          })()
                        }}
                        className="text-xs text-[var(--muted-foreground)] underline hover:no-underline"
                        title="Herstel standaardprompt"
                      >
                        Herstel standaard
                      </button>
                    </div>
                    <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                      Bestuurt zowel de inventarisatie van invulvelden als de checklist met
                      “te verzamelen informatie” per document. Harde regels: geen verzinsels,
                      citaten uitsluitend als letterlijke substring van de documenttekst.
                      Wijzigingen gelden voor de volgende pre-analyses.
                    </p>
                    <textarea
                      value={docFillPromptText}
                      onChange={(e) => setDocFillPromptText(e.target.value)}
                      rows={18}
                      className="mt-2 w-full rounded-lg border bg-[var(--background)] px-3 py-2 font-mono text-xs leading-relaxed focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
                    />
                  </div>
                ) : null}
                <button
                  type="button"
                  onClick={() => void handleSavePrompts()}
                  disabled={promptsSaving}
                  className="inline-flex items-center gap-2 rounded-lg bg-[var(--primary)] px-4 py-2.5 text-sm font-medium text-[var(--primary-foreground)] hover:opacity-90 disabled:opacity-50"
                >
                  {promptsSaving ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : promptsSaved ? (
                    <CheckCircle2 className="h-4 w-4" />
                  ) : (
                    <Save className="h-4 w-4" />
                  )}
                  {promptsSaving ? 'Opslaan…' : promptsSaved ? 'Opgeslagen' : 'Prompts opslaan'}
                </button>
              </div>
            )}
          </div>
        </div>
      ) : null}

      {mainTab === 'bedrijven' ? (
        <BedrijfsprofielTab />
      ) : null}

      {mainTab === 'versiebeheer' ? (
        <>
          {isElectron && !releaseAdminUnlocked ? (
            <SettingsPinModal
              variant="release"
              onUnlocked={() => setReleaseAdminUnlocked(true)}
              onCancel={() => setMainTab('algemeen')}
            />
          ) : (
            <ReleaseAdminSection />
          )}
        </>
      ) : null}

      {mainTab === 'algemeen' ? (
        <>
      {isElectron ? (
        <div className="rounded-xl border bg-[var(--card)] p-6 shadow-sm">
          <h3 className="text-base font-semibold flex items-center gap-2 mb-2">
            <Cloud className="h-5 w-5 text-[var(--primary)]" /> Data en cloudmap
          </h3>
          <p className="text-xs text-[var(--muted-foreground)] mb-4 leading-relaxed">
            Kies een map die door je cloudclient wordt gesynchroniseerd (bijv. OneDrive, Google Drive of Dropbox).
            De database en gedownloade bijlagen worden daar naartoe gekopieerd. In dezelfde map wordt automatisch een
            submap <code className="text-[10px]">backup</code> aangemaakt: die wordt dagelijks om 03:00 bijgewerkt.
            Er worden geen nieuwe kopieën per dag met datum in de naam gemaakt: dezelfde bestanden worden bijgewerkt.
            Bijlagen: alleen nieuwe of lokaal gewijzigde bestanden worden overschreven of toegevoegd.
          </p>
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium">Synchronisatiemap</label>
              <div className="mt-1 flex flex-col gap-2 sm:flex-row sm:items-center">
                <input
                  value={cloudSyncPath}
                  onChange={e => setCloudSyncPath(e.target.value)}
                  placeholder="Plak een pad of kies een map…"
                  className="min-w-0 flex-1 rounded-lg border bg-[var(--background)] px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
                />
                <button
                  type="button"
                  onClick={() => void handlePickCloudFolder()}
                  className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--background)] px-4 py-2.5 text-sm font-medium hover:bg-[var(--muted)]/40"
                >
                  <FolderOpen className="h-4 w-4" /> Kies map…
                </button>
              </div>
            </div>
            <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--background)] px-4 py-3">
              <input
                type="checkbox"
                checked={cloudSyncEnabled}
                onChange={e => setCloudSyncEnabled(e.target.checked)}
                className="h-4 w-4 rounded border-[var(--border)]"
              />
              <span className="text-sm">Dagelijkse back-up naar cloudmap inschakelen (03:00 lokale tijd)</span>
            </label>
            {cloudManifestText ? (
              <p className="text-xs text-[var(--muted-foreground)]">{cloudManifestText}</p>
            ) : null}
            {cloudSyncNote ? (
              <p
                className={`text-sm leading-relaxed ${
                  cloudSyncNote.tone === 'warn' ? 'text-amber-700 dark:text-amber-400' : 'text-green-700 dark:text-green-400'
                }`}
              >
                {cloudSyncNote.text}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void handleSaveCloudSync()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--primary)] px-4 py-2.5 text-sm font-medium text-[var(--primary-foreground)] hover:opacity-90"
              >
                {cloudSyncSaved ? <CheckCircle2 className="h-4 w-4" /> : <Save className="h-4 w-4" />}
                {cloudSyncSaved ? 'Opgeslagen!' : 'Cloud-instellingen opslaan'}
              </button>
              <button
                type="button"
                onClick={() => void handleCloudSyncNow()}
                disabled={cloudSyncBusy}
                className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--background)] px-4 py-2.5 text-sm font-medium hover:bg-[var(--muted)]/40 disabled:opacity-50"
              >
                {cloudSyncBusy ? (
                  <Loader2 className="h-4 w-4 animate-spin text-[var(--primary)]" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                {cloudSyncBusy ? 'Bezig…' : 'Nu synchroniseren'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* ── Supabase Cloud Sync ────────────────────────────────────────────── */}
      {isElectron ? (
        <div className="rounded-xl border bg-[var(--card)] p-6 shadow-sm space-y-4">
          <div>
            <h3 className="text-base font-semibold flex items-center gap-2 mb-1">
              <RefreshCw className="h-5 w-5 text-[var(--primary)]" /> Cloud-synchronisatie
            </h3>
            <p className="text-xs text-[var(--muted-foreground)] leading-relaxed max-w-2xl">
              Alle tendertabellen (aanbestedingen, scrapes, criteria, agent, enz.) worden met Supabase gesynchroniseerd.
              <strong> Alles uploaden</strong> stuurt in één keer je volledige lokale DB + bijlagen; <strong>Alles ophalen</strong>{' '}
              vult vanuit de cloud (nieuwe pc). Daarnaast: achtergrond-sync elke <strong>2 minuten</strong> en korte wachttijd na
              wijzigingen of na een scrape, zodat nieuwe data automatisch richting Supabase gaat solange de app open is.
            </p>
          </div>

          <div className="rounded-lg border border-[var(--border)] bg-[var(--background)] p-4 space-y-3 max-w-2xl">
            <p className="text-sm font-medium">Supabase-verbinding</p>
            <p className="text-xs text-[var(--muted-foreground)]">
              Nodig voor sync en upload (ook bij een DMG zonder meegeëmbedde .env). Vul de project-URL en de{' '}
              <span className="whitespace-nowrap">anon (public) key</span> uit je Supabase-dashboard. Daarna opslaan en{' '}
              <strong>Test verbinding</strong>. Zonder extra SQL-policies voor rol <code className="text-[10px]">anon</code> blijft
              uploaden/lezen geblokkeerd: voer het migratiebestand <code className="text-[10px]">20260429120000_rls_anon_policies_idempotent.sql</code>{' '}
              uit in de Supabase SQL Editor (map <code className="text-[10px]">supabase/migrations</code>).
            </p>
            <div>
              <label className="text-xs font-medium text-[var(--muted-foreground)]">Project-URL</label>
              <input
                type="url"
                value={supabaseFormUrl}
                onChange={(e) => setSupabaseFormUrl(e.target.value)}
                placeholder="https://…supabase.co"
                className="mt-1 w-full rounded-lg border bg-[var(--background)] px-3 py-2 text-sm"
                autoComplete="off"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-[var(--muted-foreground)]">Anon (public) key</label>
              <input
                type="password"
                value={supabaseFormKey}
                onChange={(e) => setSupabaseFormKey(e.target.value)}
                placeholder="eyJ…"
                className="mt-1 w-full rounded-lg border bg-[var(--background)] px-3 py-2 text-sm font-mono"
                autoComplete="off"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void handleSaveSupabaseConnection()}
                disabled={supabaseFormSaving}
                className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm font-medium hover:bg-[var(--muted)]/30 disabled:opacity-50"
              >
                {supabaseFormSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {supabaseFormSaved ? 'Opgeslagen' : 'Supabase-gegevens opslaan'}
              </button>
              <button
                type="button"
                onClick={() => void handleSbTestConnection()}
                disabled={supabaseFormSaving || sbConnTestBusy}
                className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm font-medium hover:bg-[var(--muted)]/30 disabled:opacity-50"
              >
                {sbConnTestBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Cloud className="h-4 w-4" />}
                {sbConnTestBusy ? 'Testen…' : 'Test verbinding'}
              </button>
            </div>
          </div>

          {sbSyncStatus?.lastError ? (
            <p className="text-sm text-amber-700 dark:text-amber-400 leading-relaxed max-w-2xl">
              <span className="font-medium">Laatste sync-fout: </span>
              {sbSyncStatus.lastError}
            </p>
          ) : null}

          {sbSyncStatus ? (
            <div className="grid grid-cols-2 gap-3 text-xs text-[var(--muted-foreground)]">
              <div className="rounded-lg border bg-[var(--background)] px-3 py-2">
                <p className="font-medium text-[var(--foreground)] mb-0.5">Laatste upload</p>
                <p>{sbSyncStatus.lastPushAt ? new Date(sbSyncStatus.lastPushAt).toLocaleString('nl-NL') : '—'}</p>
              </div>
              <div className="rounded-lg border bg-[var(--background)] px-3 py-2">
                <p className="font-medium text-[var(--foreground)] mb-0.5">Laatste download</p>
                <p>{sbSyncStatus.lastPullAt ? new Date(sbSyncStatus.lastPullAt).toLocaleString('nl-NL') : '—'}</p>
              </div>
            </div>
          ) : null}

          {sbSyncNote ? (
            <p className={`text-sm leading-relaxed ${sbSyncNote.tone === 'warn' ? 'text-amber-700 dark:text-amber-400' : 'text-green-700 dark:text-green-400'}`}>
              {sbSyncNote.text}
            </p>
          ) : null}

          {sbFullPushProgress != null && (
            <div className="max-w-2xl space-y-1.5" aria-live="polite" aria-label="Supabase upload voortgang">
              <p className="text-xs text-[var(--muted-foreground)] leading-snug truncate" title={sbFullPushProgress.label}>
                {sbFullPushProgress.label}
              </p>
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-[var(--muted)]/50">
                <div
                  className="h-full rounded-full bg-[var(--primary)] transition-[width] duration-200 ease-out"
                  style={{ width: `${Math.min(100, Math.max(0, sbFullPushProgress.percent))}%` }}
                />
              </div>
              <p className="text-right text-[10px] tabular-nums text-[var(--muted-foreground)]">
                {Math.round(Math.min(100, Math.max(0, sbFullPushProgress.percent)))}%
              </p>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void handleSbSyncNow()}
              disabled={sbSyncBusy}
              className="inline-flex items-center gap-2 rounded-lg bg-[var(--primary)] px-4 py-2.5 text-sm font-medium text-[var(--primary-foreground)] hover:opacity-90 disabled:opacity-50"
            >
              {sbSyncBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              {sbSyncBusy ? 'Bezig…' : 'Sync nu'}
            </button>
            <button
              type="button"
              onClick={() => void handleSbFullPush()}
              disabled={sbSyncBusy}
              className="inline-flex items-center gap-2 rounded-lg border border-[var(--primary)]/30 px-4 py-2.5 text-sm font-medium hover:bg-[var(--muted)]/40 disabled:opacity-50"
              title="Kopieer alle lokale tabelrijen + bijlagen naar Supabase; originele bestanden op deze pc blijven bewaard"
            >
              {sbSyncBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CloudUpload className="h-4 w-4" />}
              Alles uploaden
            </button>
            <button
              type="button"
              onClick={() => void handleSbFullPull()}
              disabled={sbSyncBusy}
              className="inline-flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium hover:bg-[var(--muted)]/40 disabled:opacity-50"
              title="Haal alle gegevens op uit de cloud — gebruik dit op een nieuwe pc om alles in één keer te importeren"
            >
              {sbSyncBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Alles ophalen (nieuwe pc)
            </button>
          </div>
        </div>
      ) : null}

      {isElectron ? (
        <div className="rounded-xl border bg-[var(--card)] p-6 shadow-sm">
          <h3 className="text-base font-semibold flex items-center gap-2 mb-2">
            <RefreshCw className="h-5 w-5 text-[var(--primary)]" /> Applicatie-updates
          </h3>
          <p className="text-xs text-[var(--muted-foreground)] mb-4">
            Controleert of er een nieuwere TenderTracker-versie op de update-server staat. Werkt alleen in de
            geïnstalleerde app (niet in <code className="text-[10px]">npm run dev</code>).
          </p>
          <button
            type="button"
            onClick={() => void handleCheckUpdates()}
            disabled={updateCheckBusy}
            className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--background)] px-4 py-2.5 text-sm font-medium hover:bg-[var(--muted)]/40 disabled:opacity-50"
          >
            {updateCheckBusy ? (
              <Loader2 className="h-4 w-4 animate-spin text-[var(--primary)]" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            {updateCheckBusy ? 'Bezig met controleren…' : 'Controleren op updates'}
          </button>
          {updateCheckNote ? (
            <p
              className={`mt-3 text-sm leading-relaxed ${
                updateCheckNote.tone === 'warn'
                  ? 'text-amber-700 dark:text-amber-400'
                  : updateCheckNote.tone === 'ok'
                    ? 'text-green-700 dark:text-green-400'
                    : 'text-[var(--muted-foreground)]'
              }`}
            >
              {updateCheckNote.text}
            </p>
          ) : null}
        </div>
      ) : null}

      {isElectron ? (
        <div className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--muted)]/15 p-5 shadow-sm">
          <h3 className="text-base font-semibold flex items-center gap-2 mb-2">
            <Stethoscope className="h-5 w-5 text-[var(--primary)]" />
            AI-diagnose (intern)
          </h3>
          <p className="text-xs text-[var(--muted-foreground)] mb-3 leading-relaxed max-w-2xl">
            Controleer of hoofd- en risico-analyse lopen zoals bedoeld: actieve jobs, wachtrijen, checkpoints,
            recent token-gebruik en signalen bij trage of vastgelopen runs. Geen geheime sleutels in het overzicht.
          </p>
          <Link
            to="/ai-diagnose"
            className="inline-flex text-sm font-medium text-[var(--primary)] hover:underline"
          >
            Open diagnose-dashboard →
          </Link>
        </div>
      ) : null}

      {/* Search Terms */}
      <div className="rounded-xl border bg-[var(--card)] p-6 shadow-sm">
        <h3 className="text-base font-semibold flex items-center gap-2 mb-4">
          <Search className="h-5 w-5 text-[var(--primary)]" /> Zoektermen
        </h3>
        <div className="flex gap-2 mb-4">
          <input
            value={newTerm}
            onChange={e => setNewTerm(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAddTerm()}
            placeholder="Nieuwe zoekterm..."
            className="flex-1 rounded-lg border bg-[var(--background)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
          />
          <button onClick={handleAddTerm} className="flex items-center gap-1 rounded-lg bg-[var(--primary)] px-3 py-2 text-sm text-[var(--primary-foreground)]">
            <Plus className="h-4 w-4" /> Toevoegen
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          {((zoektermen as any[]) || []).map((z: any) => (
            <span key={z.id} className="flex items-center gap-1.5 rounded-full border bg-[var(--muted)] px-3 py-1 text-xs">
              {z.term}
              {z.categorie && <span className="text-[var(--muted-foreground)]">({z.categorie})</span>}
              <button onClick={() => handleDeleteTerm(z.id)} className="ml-1 rounded-full p-0.5 hover:bg-red-100">
                <X className="h-3 w-3 text-red-400" />
              </button>
            </span>
          ))}
        </div>
      </div>

      {/* Scheduler */}
      <div className="rounded-xl border bg-[var(--card)] p-6 shadow-sm relative">
        <h3 className="text-base font-semibold flex items-center gap-2 mb-4">
          <Clock className="h-5 w-5 text-[var(--primary)]" /> Geplande tracking
        </h3>
        <p className="text-xs text-[var(--muted-foreground)] mb-4 leading-relaxed">
          Geplande tracking gebruikt de tijdzone van je systeem en draait alleen als TenderTracker open is (actief of op
          de achtergrond). Als de Mac op het geplande tijdstip in slaapstand staat, slaat macOS die run over tot het
          volgende tijdstip. Bij het aanmaken van een schema kies je met vinkjes welke bronnen worden gescraped;
          standaard staan alle actieve bronnen aan. Voeg je later een bron toe, vink die dan aan in een nieuw schema of
          vervang het oude. Oudere schema’s zonder bronkeuze volgen nog “alle actieve bronnen”. Handmatig in- of
          uitloggen bepaalt mee welke sessies bruikbaar zijn op het moment van de run. Na een run kunnen nieuwe
          aanbestedingen automatisch worden geanalyseerd (instelling op de Tracking-pagina).
        </p>
        <button
          type="button"
          onClick={openScheduleModal}
          className="mb-4 flex items-center justify-center gap-1 rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-medium text-[var(--primary-foreground)]"
        >
          <Plus className="h-4 w-4" /> Schema toevoegen…
        </button>
        <div className="space-y-2">
          {((schedules as any[]) || []).map((s: any) => (
            <div key={s.id} className="flex items-center gap-3 rounded-lg border p-3">
              <div className="flex-1">
                <p className="text-sm font-medium">{displayScheduleName(s.naam)}</p>
                <p
                  className="text-xs text-[var(--muted-foreground)]"
                  title={`Cron (technisch): ${s.cron_expressie}`}
                >
                  {describeCron(s.cron_expressie)}
                </p>
                <p className="text-[10px] text-[var(--muted-foreground)] mt-0.5">
                  {describeScheduleBronnen(s.bron_website_ids, (bronWebsites as { id: string; naam: string }[]) || [])}
                </p>
              </div>
              <label className="relative inline-flex cursor-pointer items-center">
                <input type="checkbox" checked={!!s.is_actief} onChange={() => handleToggleSchedule(s.id)} className="peer sr-only" />
                <div className="peer h-5 w-9 rounded-full bg-gray-200 after:absolute after:left-[2px] after:top-[2px] after:h-4 after:w-4 after:rounded-full after:bg-white after:transition-all peer-checked:bg-[var(--primary)] peer-checked:after:translate-x-full" />
              </label>
              <button onClick={() => handleDeleteSchedule(s.id)} className="rounded-lg p-1.5 hover:bg-red-50">
                <Trash2 className="h-4 w-4 text-red-400" />
              </button>
            </div>
          ))}
          {(!schedules || (schedules as any[]).length === 0) && (
            <p className="text-sm text-[var(--muted-foreground)] text-center py-4">Geen geplande tracking</p>
          )}
        </div>

        {scheduleModalOpen && (
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="schedule-modal-title"
          >
            <div className="w-full max-w-lg rounded-xl border bg-[var(--card)] p-5 shadow-lg max-h-[90vh] overflow-y-auto">
              <div className="flex items-start justify-between gap-2 mb-4">
                <h4 id="schedule-modal-title" className="text-base font-semibold">
                  Geplande tracking
                </h4>
                <button
                  type="button"
                  onClick={() => {
                    setScheduleModalError(null)
                    setScheduleModalOpen(false)
                  }}
                  className="rounded-lg p-1 hover:bg-[var(--muted)]"
                  aria-label="Sluiten"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              {scheduleModalError && (
                <div className="mb-3 rounded-lg border border-red-200 dark:border-red-700/50 bg-red-50 dark:bg-red-950/30 px-3 py-2 text-sm text-red-800 dark:text-red-300">
                  {scheduleModalError}
                </div>
              )}
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-[var(--muted-foreground)]">Naam</label>
                  <input
                    value={modalScheduleName}
                    onChange={e => setModalScheduleName(e.target.value)}
                    placeholder="Bijv. TenderNed elke ochtend"
                    className="mt-1 w-full rounded-lg border bg-[var(--background)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
                  />
                </div>
                <div>
                  <label className="text-xs text-[var(--muted-foreground)]">Frequentie</label>
                  <select
                    value={modalPattern}
                    onChange={e => setModalPattern(e.target.value as SchedulePatternKind)}
                    className="mt-1 w-full rounded-lg border bg-[var(--background)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
                  >
                    <option value="daily">Dagelijks</option>
                    <option value="weekdays">Werkdagen (ma–vr)</option>
                    <option value="weekly">Wekelijks op één dag</option>
                    <option value="interval">Elke X uur (op het hele uur)</option>
                  </select>
                </div>
                {modalPattern === 'weekly' && (
                  <div>
                    <label className="text-xs text-[var(--muted-foreground)]">Dag</label>
                    <select
                      value={modalWeekDay}
                      onChange={e => setModalWeekDay(parseInt(e.target.value, 10))}
                      className="mt-1 w-full rounded-lg border bg-[var(--background)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
                    >
                      <option value={1}>Maandag</option>
                      <option value={2}>Dinsdag</option>
                      <option value={3}>Woensdag</option>
                      <option value={4}>Donderdag</option>
                      <option value={5}>Vrijdag</option>
                      <option value={6}>Zaterdag</option>
                      <option value={0}>Zondag</option>
                    </select>
                  </div>
                )}
                {modalPattern === 'interval' && (
                  <div>
                    <label className="text-xs text-[var(--muted-foreground)]">Elke (uren)</label>
                    <select
                      value={modalIntervalHours}
                      onChange={e => setModalIntervalHours(parseInt(e.target.value, 10))}
                      className="mt-1 w-full rounded-lg border bg-[var(--background)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
                    >
                      {[1, 2, 3, 4, 6, 8, 12].map(h => (
                        <option key={h} value={h}>{h} uur</option>
                      ))}
                    </select>
                  </div>
                )}
                {modalPattern !== 'interval' && (
                  <div>
                    <label className="text-xs text-[var(--muted-foreground)]">Tijdstip (lokale tijd)</label>
                    <input
                      type="time"
                      value={modalScheduleTime}
                      onChange={e => setModalScheduleTime(e.target.value)}
                      className="mt-1 w-full rounded-lg border bg-[var(--background)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
                    />
                  </div>
                )}
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <label className="text-xs text-[var(--muted-foreground)]">Bronnen voor deze run</label>
                    <button
                      type="button"
                      className="text-xs font-medium text-[var(--primary)] hover:underline"
                      onClick={() => {
                        const active = ((bronWebsites as { id: string; is_actief?: number }[]) || []).filter(
                          (b) => b.is_actief !== 0,
                        )
                        setModalScheduleBronIds(active.map((b) => b.id))
                      }}
                    >
                      Alles selecteren
                    </button>
                  </div>
                  <div className="mt-2 max-h-44 space-y-1 overflow-y-auto rounded-lg border bg-[var(--background)] p-2">
                    {((bronWebsites as { id: string; naam: string; is_actief?: number }[]) || []).filter(
                      (b) => b.is_actief !== 0,
                    ).length === 0 ? (
                      <p className="text-xs text-[var(--muted-foreground)] px-1 py-2">
                        Geen actieve bronnen. Voeg bronnen toe onder het menu Bronnen.
                      </p>
                    ) : (
                      ((bronWebsites as { id: string; naam: string; is_actief?: number }[]) || [])
                        .filter((b) => b.is_actief !== 0)
                        .map((b) => (
                          <label
                            key={b.id}
                            className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-[var(--muted)]/50"
                          >
                            <input
                              type="checkbox"
                              className="rounded"
                              checked={modalScheduleBronIds.includes(b.id)}
                              onChange={() => {
                                setModalScheduleBronIds((prev) =>
                                  prev.includes(b.id) ? prev.filter((x) => x !== b.id) : [...prev, b.id],
                                )
                              }}
                            />
                            <span>{b.naam}</span>
                          </label>
                        ))
                    )}
                  </div>
                  <p className="mt-1.5 text-[10px] text-[var(--muted-foreground)] leading-relaxed">
                    Een bron die je later toevoegt, staat niet automatisch in bestaande schema’s: voeg een nieuw schema toe
                    en vink die bron aan, of wis het oude schema en maak opnieuw aan.
                  </p>
                </div>
              </div>
              <div className="mt-5 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setScheduleModalError(null)
                    setScheduleModalOpen(false)
                  }}
                  className="rounded-lg border px-4 py-2 text-sm hover:bg-[var(--muted)]"
                >
                  Annuleren
                </button>
                <button
                  type="button"
                  onClick={() => void handleAddScheduleFromModal()}
                  className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-medium text-[var(--primary-foreground)]"
                >
                  Opslaan
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Handmatige URL-verwerking ── */}
      <div className="rounded-xl border bg-[var(--card)] p-6 shadow-sm">
        <h3 className="text-base font-semibold flex items-center gap-2 mb-2">
          <Link2 className="h-5 w-5 text-[var(--primary)]" />
          Aanbesteding verwerken via URL
        </h3>
        <p className="text-xs text-[var(--muted-foreground)] mb-4 leading-relaxed">
          Voer de URL van een aanbestedingspagina in (bijv. TenderNed, Mercell, gemeentesite).
          De app controleert of de aanbesteding al bestaat, haalt daarna de documenten op,
          en start automatisch de AI-analyse en risico-inventarisatie.
        </p>

        {!isElectron && (
          <p className="text-sm text-[var(--muted-foreground)]">Alleen beschikbaar in de desktop-app.</p>
        )}

        {isElectron && (
          <div className="space-y-3">
            <div className="flex gap-2">
              <input
                type="url"
                value={processUrl}
                onChange={(e) => { setProcessUrl(e.target.value); setProcessUrlResult(null) }}
                onKeyDown={(e) => { if (e.key === 'Enter' && !processUrlBusy) void handleProcessUrl() }}
                placeholder="https://www.tenderned.nl/aankondigingen/..."
                disabled={processUrlBusy}
                className="flex-1 rounded-lg border bg-[var(--background)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ring)] disabled:opacity-50 font-mono"
              />
              <button
                type="button"
                onClick={() => void handleProcessUrl()}
                disabled={processUrlBusy || !processUrl.trim()}
                className="inline-flex items-center gap-2 rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-[var(--primary-foreground)] hover:opacity-90 disabled:opacity-50 whitespace-nowrap"
              >
                {processUrlBusy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
                Nu verwerken
              </button>
            </div>

            {/* Voortgangsbalk */}
            {processUrlBusy && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs text-[var(--muted-foreground)]">
                  <span className="truncate">{processUrlStep || 'Bezig…'}</span>
                  <span className="ml-2 tabular-nums">{processUrlPct}%</span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-[var(--muted)]">
                  <div
                    className="h-1.5 rounded-full bg-[var(--primary)] transition-all duration-300"
                    style={{ width: `${processUrlPct}%` }}
                  />
                </div>
              </div>
            )}

            {/* Resultaatmelding */}
            {processUrlResult && (
              <div className={`flex items-start gap-3 rounded-lg border px-4 py-3 text-sm ${
                processUrlResult.tone === 'ok'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-700/50 dark:bg-emerald-950/30 dark:text-emerald-300'
                  : processUrlResult.tone === 'info'
                    ? 'border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-700/50 dark:bg-blue-950/30 dark:text-blue-300'
                    : 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-700/50 dark:bg-amber-950/30 dark:text-amber-300'
              }`}>
                {processUrlResult.tone === 'ok' ? (
                  <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
                ) : processUrlResult.tone === 'info' ? (
                  <AlertCircle className="h-4 w-4 mt-0.5 shrink-0 text-blue-600 dark:text-blue-400" />
                ) : (
                  <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <p>{processUrlResult.text}</p>
                  {processUrlResult.tenderId && (
                    <Link
                      to={`/aanbestedingen/${processUrlResult.tenderId}`}
                      className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium underline underline-offset-2 hover:opacity-80"
                    >
                      <ExternalLink className="h-3 w-3" />
                      Bekijk aanbesteding
                    </Link>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
        </>
      ) : null}
    </div>
  )
}
