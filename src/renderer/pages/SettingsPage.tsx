import { useState, useEffect, useRef } from 'react'
import { useSettings, useSchedules, useZoektermen } from '../hooks/use-ipc'
import { api, isElectron } from '../lib/ipc-client'
import { Link } from 'react-router-dom'
import {
  Brain, Key, Server, Clock, Search, Save, Plus, Trash2, X,
  CheckCircle2, AlertCircle, RefreshCw, Loader2, Cloud, FolderOpen,
  MessageSquareText, Stethoscope, Building2,
} from 'lucide-react'
import {
  APP_SETTING_RISICO_PROMPT_EXTRACTIE,
  APP_SETTING_RISICO_PROMPT_HOOFD,
} from '@shared/constants'
import { BedrijfsprofielTab } from '../components/BedrijfsprofielTab'

type SchedulePatternKind = 'daily' | 'weekdays' | 'weekly' | 'interval'

type SettingsMainTab = 'algemeen' | 'prompts' | 'bedrijven'

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
    return `0 */${h} * * *`
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
function displayScheduleName(naam: string): string {
  const t = naam?.trim()
  if (t && /^scrape$/i.test(t)) return 'Tracking'
  return naam
}

function describeCron(cron: string): string {
  const raw = cron.trim()
  const parts = raw.split(/\s+/).filter(Boolean)

  const m4 = raw.match(/^(\d+) \*\/(\d+) \* \* \*$/)
  if (m4) return `Elke ${m4[2]} uur (op het hele uur)`

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
  const { data: settings, refresh: refreshSettings } = useSettings()
  const { data: schedules, refresh: refreshSchedules } = useSchedules()
  const { data: zoektermen, refresh: refreshZoektermen } = useZoektermen()

  const [mainTab, setMainTab] = useState<SettingsMainTab>('algemeen')
  const [promptAgentId, setPromptAgentId] = useState<string | null>(null)
  const [promptScorerId, setPromptScorerId] = useState<string | null>(null)
  const [promptAgentText, setPromptAgentText] = useState('')
  const [promptScorerText, setPromptScorerText] = useState('')
  const [risicoHoofdText, setRisicoHoofdText] = useState('')
  const [risicoExtractieText, setRisicoExtractieText] = useState('')
  const [promptsLoadError, setPromptsLoadError] = useState<string | null>(null)
  const [promptsSaving, setPromptsSaving] = useState(false)
  const [promptsSaved, setPromptsSaved] = useState(false)
  const promptsLoadedOnce = useRef(false)

  const [provider, setProvider] = useState('moonshot')
  const [model, setModel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [ollamaEndpoint, setOllamaEndpoint] = useState('http://localhost:11434')
  const [moonshotApiBase, setMoonshotApiBase] = useState('')
  const [moonshotApiKey, setMoonshotApiKey] = useState('')
  const [kimiCliPath, setKimiCliPath] = useState('')
  const [kimiCliMaxSteps, setKimiCliMaxSteps] = useState('48')
  const [detectionApiKey, setDetectionApiKey] = useState('')
  const [saved, setSaved] = useState(false)

  const [cloudSyncPath, setCloudSyncPath] = useState('')
  const [cloudSyncEnabled, setCloudSyncEnabled] = useState(false)
  const [cloudSyncSaved, setCloudSyncSaved] = useState(false)
  const [cloudSyncBusy, setCloudSyncBusy] = useState(false)
  const [cloudSyncNote, setCloudSyncNote] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null)
  const [cloudManifestText, setCloudManifestText] = useState<string | null>(null)

  const [newTerm, setNewTerm] = useState('')
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false)
  const [modalScheduleName, setModalScheduleName] = useState('')
  const [modalScheduleTime, setModalScheduleTime] = useState('08:00')
  const [modalPattern, setModalPattern] = useState<SchedulePatternKind>('weekdays')
  const [modalWeekDay, setModalWeekDay] = useState(1)
  const [modalIntervalHours, setModalIntervalHours] = useState(6)
  const [scheduleModalError, setScheduleModalError] = useState<string | null>(null)

  const [updateCheckBusy, setUpdateCheckBusy] = useState(false)
  const [updateCheckNote, setUpdateCheckNote] = useState<{ tone: 'neutral' | 'ok' | 'warn'; text: string } | null>(null)

  useEffect(() => {
    if (settings) {
      const s = settings as Record<string, string>
      setProvider(s.ai_provider || 'moonshot')
      setModel(s.ai_model || '')
      setApiKey(s.ai_api_key || '')
      setOllamaEndpoint(s.ollama_endpoint || 'http://localhost:11434')
      setMoonshotApiBase(s.moonshot_api_base || '')
      setMoonshotApiKey(s.moonshot_api_key || '')
      setKimiCliPath(s.kimi_cli_path || '')
      setKimiCliMaxSteps(s.kimi_cli_max_steps || '48')
      setDetectionApiKey(s.openai_detection_api_key || '')
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
        if (cancelled) return
        setPromptAgentId(agent?.id ?? null)
        setPromptScorerId(scorer?.id ?? null)
        setPromptAgentText(agent?.prompt_tekst ?? '')
        setPromptScorerText(scorer?.prompt_tekst ?? '')
        setRisicoHoofdText(typeof rh === 'string' ? rh : '')
        setRisicoExtractieText(typeof re === 'string' ? re : '')
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

  const handleSaveAI = async () => {
    await api.setSetting('ai_provider', provider)
    await api.setSetting('ai_model', model)
    await api.setSetting('ai_api_key', apiKey)
    await api.setSetting('ollama_endpoint', ollamaEndpoint)
    await api.setSetting('moonshot_api_base', moonshotApiBase)
    await api.setSetting('moonshot_api_key', moonshotApiKey)
    await api.setSetting('kimi_cli_path', kimiCliPath)
    await api.setSetting('kimi_cli_max_steps', kimiCliMaxSteps)
    await api.setSetting('openai_detection_api_key', detectionApiKey)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
    refreshSettings()
  }

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
    setScheduleModalError(null)
    await api.createSchedule({
      naam: modalScheduleName.trim(),
      cron_expressie: cron,
      bron_website_ids: [],
    })
    setScheduleModalOpen(false)
    refreshSchedules()
  }

  const handleToggleSchedule = async (id: string) => {
    await api.toggleSchedule(id)
    refreshSchedules()
  }

  const handleDeleteSchedule = async (id: string) => {
    await api.deleteSchedule(id)
    refreshSchedules()
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
        // UpdateNotifier-modal verschijnt automatisch via IPC-event — geen extra melding nodig
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

  const modelOptions: Record<string, string[]> = {
    claude: ['claude-sonnet-4-6', 'claude-haiku-4-5-20251001', 'claude-opus-4-6'],
    openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'],
    moonshot: ['kimi-k2.6', 'kimi-k2.5', 'kimi-k2', 'moonshot-v1-128k', 'moonshot-v1-32k', 'moonshot-v1-8k'],
    kimi_cli: ['kimi-k2.6', 'kimi-k2.5', 'kimi-k2', 'moonshot-v1-128k', 'moonshot-v1-32k', 'moonshot-v1-8k'],
    ollama: ['gemma4', 'llama3.1', 'llama3.2', 'mistral', 'codellama', 'gemma2'],
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

      {mainTab === 'algemeen' ? (
        <>
      {/* AI Model Configuration */}
      <div className="rounded-xl border bg-[var(--card)] p-6 shadow-sm">
        <h3 className="text-base font-semibold flex items-center gap-2 mb-4">
          <Brain className="h-5 w-5 text-[var(--primary)]" /> AI Model configuratie
        </h3>

        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium">Provider</label>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {[
                { id: 'claude', label: 'Claude (Anthropic)', icon: '🤖' },
                { id: 'openai', label: 'OpenAI', icon: '🧠' },
                { id: 'moonshot', label: 'Kimi (Moonshot API)', icon: '🌙' },
                { id: 'kimi_cli', label: 'Kimi Code CLI', icon: '⌨️' },
                { id: 'ollama', label: 'Ollama (lokaal)', icon: '💻' },
              ].map(p => (
                <button
                  key={p.id}
                  onClick={() => { setProvider(p.id); setModel(modelOptions[p.id]?.[0] || '') }}
                  className={`rounded-lg border p-3 text-left transition-colors ${
                    provider === p.id ? 'border-[var(--primary)] bg-[var(--primary)]/5' : 'hover:bg-[var(--muted)]/50'
                  }`}
                >
                  <p className="text-lg">{p.icon}</p>
                  <p className="mt-1 text-xs font-medium">{p.label}</p>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-sm font-medium">Model</label>
            <select
              value={model}
              onChange={e => setModel(e.target.value)}
              className="mt-1 w-full rounded-lg border bg-[var(--background)] px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
            >
              {(modelOptions[provider] || []).map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>

          {provider !== 'ollama' ? (
            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium flex items-center gap-1.5">
                  <Key className="h-4 w-4" /> API Sleutel
                </label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={e => setApiKey(e.target.value)}
                  placeholder={
                    provider === 'claude'
                      ? 'sk-ant-...'
                      : provider === 'moonshot' || provider === 'kimi_cli'
                        ? 'Moonshot API key (KIMI_API_KEY voor CLI)'
                        : 'sk-...'
                  }
                  className="mt-1 w-full rounded-lg border bg-[var(--background)] px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
                />
              </div>
              {(provider === 'moonshot' || provider === 'kimi_cli') && (
                <div>
                  <label className="text-sm font-medium flex items-center gap-1.5">
                    <Server className="h-4 w-4" /> API-basis-URL (optioneel)
                  </label>
                  <input
                    value={moonshotApiBase}
                    onChange={e => setMoonshotApiBase(e.target.value)}
                    placeholder="https://api.moonshot.cn/v1"
                    className="mt-1 w-full rounded-lg border bg-[var(--background)] px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
                  />
                  <p className="mt-1 text-[11px] text-[var(--muted-foreground)]">
                    Leeg laten voor standaard Moonshot-endpoint (wordt doorgegeven als KIMI_BASE_URL bij Kimi CLI).
                  </p>
                </div>
              )}
              {provider === 'kimi_cli' && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <label className="text-sm font-medium flex items-center gap-1.5">
                      <Server className="h-4 w-4" /> Pad naar <code className="text-xs">kimi</code> (optioneel)
                    </label>
                    <input
                      value={kimiCliPath}
                      onChange={e => setKimiCliPath(e.target.value)}
                      placeholder="kimi (standaard op PATH)"
                      className="mt-1 w-full rounded-lg border bg-[var(--background)] px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
                    />
                    <p className="mt-1 text-[11px] text-[var(--muted-foreground)]">
                      Bijv. uit <code className="text-[10px]">uv tool install --python 3.13 kimi-cli</code>. Laat leeg als <code className="text-[10px]">kimi</code> op PATH staat.
                    </p>
                  </div>
                  <div>
                    <label className="text-sm font-medium">Max. stappen per beurt (CLI)</label>
                    <input
                      type="number"
                      min={1}
                      max={200}
                      value={kimiCliMaxSteps}
                      onChange={e => setKimiCliMaxSteps(e.target.value)}
                      className="mt-1 w-full rounded-lg border bg-[var(--background)] px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
                    />
                    <p className="mt-1 text-[11px] text-[var(--muted-foreground)]">
                      Komt overeen met <code className="text-[10px]">--max-steps-per-turn</code> (1–200).
                    </p>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div>
              <label className="text-sm font-medium flex items-center gap-1.5">
                <Server className="h-4 w-4" /> Ollama Endpoint
              </label>
              <input
                value={ollamaEndpoint}
                onChange={e => setOllamaEndpoint(e.target.value)}
                className="mt-1 w-full rounded-lg border bg-[var(--background)] px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
              />
              <p className="mt-1 text-[11px] text-[var(--muted-foreground)]">
                Lokaal (bijv. Gemma via Ollama) blijft beschikbaar; voor betrouwbare tender-analyse met lange context wordt een cloud-model aanbevolen.
              </p>
            </div>
          )}

          {/* OpenAI Detection key — always shown, needed for Mercell document detection */}
          <div className="rounded-lg border border-amber-200 dark:border-amber-700/50 bg-amber-50 dark:bg-amber-950/25 p-4 space-y-2">
            <label className="text-sm font-medium flex items-center gap-1.5">
              <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              OpenAI sleutel voor documentdetectie
            </label>
            <p className="text-xs text-[var(--muted-foreground)]">
              Wordt gebruikt om te detecteren of aanbestedingsdocumenten op Mercell staan (in plaats van TenderNed).
              Altijd vereist, ook als je Claude of Ollama gebruikt voor de analyse.
              Zonder deze sleutel werkt alleen regex-detectie.
            </p>
            <input
              type="password"
              value={detectionApiKey}
              onChange={e => setDetectionApiKey(e.target.value)}
              placeholder="sk-..."
              className="w-full rounded-lg border bg-white dark:bg-[var(--input)] px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
            />
            {detectionApiKey ? (
              <p className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
                <CheckCircle2 className="h-3.5 w-3.5" /> Sleutel ingesteld — Mercell-detectie actief
              </p>
            ) : (
              <p className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
                <AlertCircle className="h-3.5 w-3.5" /> Geen sleutel — alleen regex-detectie (minder betrouwbaar)
              </p>
            )}
          </div>

          {/* Kimi / Moonshot sleutel — specifiek voor risico-inventarisatie */}
          <div className="rounded-lg border border-purple-200 dark:border-purple-700/50 bg-purple-50 dark:bg-purple-950/25 p-4 space-y-2">
            <label className="text-sm font-medium flex items-center gap-1.5">
              <Brain className="h-4 w-4 text-purple-600 dark:text-purple-400" />
              Kimi (Moonshot) sleutel voor risico-inventarisatie
            </label>
            <p className="text-xs text-[var(--muted-foreground)]">
              Risico-inventarisatie wordt altijd uitgevoerd met <strong>Kimi k2.6</strong> (goedkoop, 128k context).
              Als je een andere hoofd-AI gebruikt (bijv. OpenAI of Claude), vul hier je Moonshot API-sleutel in.
              Leeg laten: de hoofd-AI-sleutel wordt gebruikt — dit kan context-fouten geven bij grote dossiers.
            </p>
            <input
              type="password"
              value={moonshotApiKey}
              onChange={e => setMoonshotApiKey(e.target.value)}
              placeholder="sk-... (Moonshot API key)"
              className="w-full rounded-lg border bg-white dark:bg-[var(--input)] px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
            />
            {moonshotApiKey ? (
              <p className="flex items-center gap-1 text-xs text-purple-600 dark:text-purple-400">
                <CheckCircle2 className="h-3.5 w-3.5" /> Kimi k2.6 actief voor risico-inventarisatie
              </p>
            ) : (
              <p className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
                <AlertCircle className="h-3.5 w-3.5" /> Geen sleutel — hoofd-AI wordt gebruikt (kans op context-overflow bij grote dossiers)
              </p>
            )}
          </div>

          <button
            onClick={handleSaveAI}
            className="flex items-center gap-1.5 rounded-lg bg-[var(--primary)] px-4 py-2.5 text-sm font-medium text-[var(--primary-foreground)] hover:opacity-90 transition-opacity"
          >
            {saved ? <CheckCircle2 className="h-4 w-4" /> : <Save className="h-4 w-4" />}
            {saved ? 'Opgeslagen!' : 'Opslaan'}
          </button>
        </div>
      </div>

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
          Geplande tracking draait op de lokale tijd van je computer (node-cron). Na een geplande run worden nieuwe
          aanbestedingen automatisch volledig geanalyseerd, inclusief risico-inventarisatie.
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
            <div className="w-full max-w-md rounded-xl border bg-[var(--card)] p-5 shadow-lg">
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
        </>
      ) : null}
    </div>
  )
}
