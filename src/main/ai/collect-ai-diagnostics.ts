import { getDb, getDatabaseFilePath } from '../db/connection'
import { parseStoredAnalysisCheckpointPayload } from './analysis-checkpoint'
import { getBusyWorkBlockerDebug } from '../utils/busy-work-blocker'
import { LLM_CHUNK_EXTRACTION_CONCURRENCY } from '../utils/llm-chunk-concurrency'
import { getRisicoRunSnapshot } from '../ipc/risico-run-state'
import { getRisicoLastBroadcastForTender } from '../ipc/risico-progress-broadcast'
import type { AiDiagnosticsSnapshot, AiDiagnosticsTokenCostRow } from '../../shared/ai-diagnostics'
import type { AnalysisPipelineDiagnosticsSnapshot } from '../ipc/analysis.ipc'
import { getTokenStats } from './token-logger'
import { estimateTokenCostEur } from '../../shared/ai-pricing'

function maskSettings(rows: { key: string; value: string }[]): Record<string, string> {
  const m: Record<string, string> = {}
  for (const r of rows) {
    m[r.key] = r.value ?? ''
  }
  return m
}

function redactedAiSettings(settings: Record<string, string>): AiDiagnosticsSnapshot['aiSettings'] {
  const moonshotBase = String(settings.moonshot_api_base || '').trim()
  return {
    ai_provider: String(settings.ai_provider || '').trim() || '(niet gezet)',
    ai_model: String(settings.ai_model || '').trim() || '(niet gezet)',
    moonshotBaseConfigured: moonshotBase.length > 0,
    kimiCliPathConfigured: String(settings.kimi_cli_path || '').trim().length > 0,
    ollamaBaseUrl: String(settings.ollama_endpoint || '').trim() || 'http://localhost:11434',
    hasAiApiKey: String(settings.ai_api_key || '').trim().length > 0,
    hasMoonshotKey: String(settings.moonshot_api_key || '').trim().length > 0,
  }
}

function buildHints(
  snap: AiDiagnosticsSnapshot,
  pipeline: AnalysisPipelineDiagnosticsSnapshot,
  maxCheckpointChars: number,
  criteriaChunkIncomplete: boolean,
): string[] {
  const hints: string[] = []

  if (snap.risico.running && snap.risico.lastProgress) {
    const lp = snap.risico.lastProgress
    hints.push(
      `Risico-analyse loopt nu (${snap.risico.aanbestedingId?.slice(0, 8) ?? '?'}…): ${lp.percentage}% — ${lp.step}. ` +
        'De token-tabel ververst pas als een modelaanroep helemaal klaar is; tijdens “wacht op antwoord” is dat normaal leeg.',
    )
  } else if (snap.risico.running && !snap.risico.lastProgress) {
    hints.push(
      'Risico staat als actief gemarkeerd, maar er is nog geen voortgangsstap gelogd — even wachten en verversen, of controleer de tenderpagina.',
    )
  }

  if (pipeline.analysisPipelineBusy && snap.tokenEventsLast2Min === 0) {
    hints.push(
      'Er loopt een analyse, maar er zijn geen token-registraties in de laatste 2 minuten. ' +
        'Dat kan normaal zijn bij Ollama/Kimi CLI als er geen usage in de response zit, of het model wacht nog op I/O.',
    )
  }

  if (
    snap.aiSettings.hasMoonshotKey &&
    snap.kimiTokenEventsLast6h === 0 &&
    snap.tokenEventsLast6h >= 3 &&
    (snap.risico.running || pipeline.analysisPipelineBusy) &&
    !(snap.risico.running && snap.risico.lastProgress && snap.risico.lastProgress.percentage < 100)
  ) {
    hints.push(
      'Moonshot-sleutel staat aan, maar er zijn geen Kimi/Moonshot token-registraties in de laatste 6 uur terwijl er wél andere calls zijn. ' +
        'Risico gebruikt Kimi alleen als de aanroep afrondt: bij netwerkfout val je terug op de hoofd-AI (dan zie je alleen die provider in de tabel). ' +
        'Zie electron-log op `[risico] Kimi`.',
    )
  }

  if (maxCheckpointChars >= 250_000) {
    hints.push(
      `Er staat een checkpoint open met ~${Math.round(maxCheckpointChars / 1000)}k tekens aan documenten — verwacht meerdere LLM-rondes (criteria in delen, hoofdprompt, per-bijlage, daarna risico). Dat kan lang duren.`,
    )
  }

  if (criteriaChunkIncomplete) {
    hints.push(
      'Criteria worden nog in documentdelen gescoord (checkpoint). Tot dat klaar is, lijkt het percentage lang stil — er lopen dan parallel meerdere modelcalls.',
    )
  }

  if (snap.tenderSignals.withScoreNoRisico > 0) {
    hints.push(
      `${snap.tenderSignals.withScoreNoRisico} aanbesteding(en) hebben een score maar nog geen opgeslagen risico-inventarisatie. Risico start normaal direct na de hoofdanalyse; bij een fout of onderbreking kan dit achterblijven.`,
    )
  }

  if (snap.tenderSignals.staleCheckpoints > 0 && !pipeline.analysisPipelineBusy) {
    hints.push(
      `${snap.tenderSignals.staleCheckpoints} checkpoint(s) ouder dan 6 uur terwijl er geen actieve analyse gemeld wordt. Mogelijk is de app gestopt tijdens een run; gebruik Hervatten of wis checkpoint en start opnieuw.`,
    )
  }

  if (snap.busyWork.powerSaveActive) {
    hints.push(
      'Stroombeheer-blokkade is actief (normaal tijdens lange taken): macOS zou de app minder snel mogen pauzeren.',
    )
  }

  if (hints.length === 0) {
    hints.push('Geen afwijkende signalen in deze snapshot. Bij traagheid: kijk naar recent token-gebruik en checkpoint-fase hieronder.')
  }

  return hints
}

export function collectAiDiagnosticsSnapshot(
  pipeline: AnalysisPipelineDiagnosticsSnapshot,
): AiDiagnosticsSnapshot {
  const db = getDb()
  const collectedAt = new Date().toISOString()
  const settingsRows = db.prepare('SELECT key, value FROM app_settings').all() as { key: string; value: string }[]
  const settings = maskSettings(settingsRows)

  const ckSql = db.prepare(`
    SELECT c.aanbesteding_id AS id, c.updated_at AS updatedAt, c.payload, a.titel AS titel
    FROM analysis_checkpoint c
    LEFT JOIN aanbestedingen a ON a.id = c.aanbesteding_id
    ORDER BY c.updated_at DESC
  `)
  const ckRaw = ckSql.all() as { id: string; updatedAt: string; payload: string; titel: string | null }[]

  let maxCheckpointChars = 0
  let criteriaChunkIncomplete = false

  const checkpoints = ckRaw.map((row) => {
    const ck = parseStoredAnalysisCheckpointPayload(row.payload)
    if (!ck) {
      return {
        tenderId: row.id,
        titel: row.titel,
        updatedAt: row.updatedAt,
        parseOk: false,
        stage: null,
        documentBlocks: 0,
        totalChars: 0,
        detailTextChars: 0,
        aiPhase: null,
        criteriaChunksTotal: null,
        criteriaChunksCompleted: null,
        bronProgress: '—',
        dbProgress: '—',
      }
    }
    const docTexts = ck.documentTexts || []
    const totalChars = docTexts.reduce((s, t) => s + (typeof t === 'string' ? t.length : 0), 0)
    const detailTextChars = typeof ck.detailText === 'string' ? ck.detailText.length : 0
    if (totalChars > maxCheckpointChars) maxCheckpointChars = totalChars

    const cc = ck.criteriaChunking
    const cTotal = cc?.totalChunks ?? null
    const cDone = cc?.completedChunkIndices?.length ?? null
    if (cTotal != null && cDone != null && cTotal > 0 && cDone < cTotal) {
      criteriaChunkIncomplete = true
    }

    const bronLen = ck.bronAllDocs?.length ?? 0
    const dbLen = ck.dbAllDocs?.length ?? 0

    return {
      tenderId: row.id,
      titel: row.titel,
      updatedAt: row.updatedAt,
      parseOk: true,
      stage: ck.stage,
      documentBlocks: docTexts.length,
      totalChars,
      detailTextChars,
      aiPhase: ck.aiPhase,
      criteriaChunksTotal: cTotal,
      criteriaChunksCompleted: cDone,
      bronProgress: `${ck.bronNextIndex ?? 0}/${bronLen}`,
      dbProgress: `${ck.dbNextIndex ?? 0}/${dbLen}`,
    }
  })

  type TokenRow = {
    id: number
    provider: string
    model: string
    input_tokens: number
    output_tokens: number
    createdAt: string
  }

  /** Laatste N naar id + extra Kimi/Moonshot-regels (veel kleine hoofd-AI-calls duwen anders Kimi uit beeld). */
  const tokenMain = db
    .prepare(
      `SELECT id, provider, model, input_tokens, output_tokens, created_at AS createdAt
       FROM ai_token_usage
       ORDER BY id DESC
       LIMIT 220`,
    )
    .all() as TokenRow[]
  const tokenKimiExtra = db
    .prepare(
      `SELECT id, provider, model, input_tokens, output_tokens, created_at AS createdAt
       FROM ai_token_usage
       WHERE INSTR(LOWER(IFNULL(provider,'')), 'moonshot') > 0
          OR INSTR(LOWER(IFNULL(model,'')), 'kimi') > 0
       ORDER BY id DESC
       LIMIT 60`,
    )
    .all() as TokenRow[]

  const byTokenId = new Map<number, TokenRow>()
  for (const r of tokenKimiExtra) byTokenId.set(r.id, r)
  for (const r of tokenMain) byTokenId.set(r.id, r)
  const tokenRows = [...byTokenId.values()].sort((a, b) => b.id - a.id).slice(0, 280)

  const tokenEventsRecent = tokenRows.map((r) => ({
    id: r.id,
    provider: r.provider,
    model: r.model,
    inputTokens: Math.floor(Number(r.input_tokens) || 0),
    outputTokens: Math.floor(Number(r.output_tokens) || 0),
    createdAt: r.createdAt,
  }))

  const tokenEventsLast2Min = db
    .prepare(`SELECT COUNT(*) AS n FROM ai_token_usage WHERE created_at >= datetime('now', '-2 minutes')`)
    .get() as { n: number }
  const tokenEventsLast15Min = db
    .prepare(`SELECT COUNT(*) AS n FROM ai_token_usage WHERE created_at >= datetime('now', '-15 minutes')`)
    .get() as { n: number }
  const tokenEventsLast6h = db
    .prepare(`SELECT COUNT(*) AS n FROM ai_token_usage WHERE created_at >= datetime('now', '-6 hours')`)
    .get() as { n: number }
  const kimiTokenEventsLast6h = db
    .prepare(
      `SELECT COUNT(*) AS n FROM ai_token_usage
       WHERE created_at >= datetime('now', '-6 hours')
         AND (INSTR(LOWER(IFNULL(provider,'')), 'moonshot') > 0
              OR INSTR(LOWER(IFNULL(model,'')), 'kimi') > 0)`,
    )
    .get() as { n: number }

  const withCheckpoint = db.prepare(`SELECT COUNT(*) AS n FROM analysis_checkpoint`).get() as { n: number }

  const withScoreNoRisico = db
    .prepare(
      `SELECT COUNT(*) AS n FROM aanbestedingen
       WHERE (totaal_score IS NOT NULL AND totaal_score > 0)
         AND (risico_analyse IS NULL OR TRIM(COALESCE(risico_analyse,'')) = '')`,
    )
    .get() as { n: number }

  const withRisico = db
    .prepare(
      `SELECT COUNT(*) AS n FROM aanbestedingen
       WHERE risico_analyse IS NOT NULL AND TRIM(COALESCE(risico_analyse,'')) != ''`,
    )
    .get() as { n: number }

  const staleCheckpoints = db
    .prepare(
      `SELECT COUNT(*) AS n FROM analysis_checkpoint
       WHERE updated_at < datetime('now', '-6 hours')`,
    )
    .get() as { n: number }

  const risico = getRisicoRunSnapshot()
  const risicoLast = getRisicoLastBroadcastForTender(risico.aanbestedingId)

  // Kosten per model afgelopen 7 dagen
  const rawStats = getTokenStats()
  const byModel7d: AiDiagnosticsTokenCostRow[] = rawStats.last7days.byModel.map((r) => ({
    provider: r.provider,
    model: r.model,
    label: r.label,
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
    estimatedEurOrNull: estimateTokenCostEur(r.provider, r.model, r.inputTokens, r.outputTokens),
  }))
  const totalEurOrNull = byModel7d.some((r) => r.estimatedEurOrNull !== null)
    ? byModel7d.reduce((s, r) => s + (r.estimatedEurOrNull ?? 0), 0)
    : null

  const snap: AiDiagnosticsSnapshot = {
    collectedAt,
    databasePath: getDatabaseFilePath(),
    llmChunkConcurrency: LLM_CHUNK_EXTRACTION_CONCURRENCY,
    busyWork: getBusyWorkBlockerDebug(),
    tokenStats7d: {
      byModel: byModel7d,
      totalInputTokens: rawStats.last7days.totalInput,
      totalOutputTokens: rawStats.last7days.totalOutput,
      totalEurOrNull,
    },
    pipeline: {
      batchRunning: pipeline.batchRunning,
      batchCurrent: pipeline.batchCurrent,
      batchTotal: pipeline.batchTotal,
      batchCurrentId: pipeline.batchCurrentId,
      batchCurrentTitle: pipeline.batchCurrentTitle,
      singleRunning: pipeline.singleRunning,
      singleAnalysisId: pipeline.singleAnalysisId,
      pendingSingleAnalysisIds: pipeline.pendingSingleAnalysisIds,
      pendingPostScrapeIdsCount: pipeline.pendingPostScrapeIdsCount,
      analysisPipelineBusy: pipeline.analysisPipelineBusy,
    },
    risico: {
      running: risico.running,
      aanbestedingId: risico.aanbestedingId,
      queuedCount: risico.queuedIds.length,
      lastProgress: risicoLast,
    },
    checkpoints,
    tokenEventsRecent,
    tokenEventsLast2Min: Math.floor(Number(tokenEventsLast2Min.n) || 0),
    tokenEventsLast15Min: Math.floor(Number(tokenEventsLast15Min.n) || 0),
    tokenEventsLast6h: Math.floor(Number(tokenEventsLast6h.n) || 0),
    kimiTokenEventsLast6h: Math.floor(Number(kimiTokenEventsLast6h.n) || 0),
    tenderSignals: {
      withCheckpoint: Math.floor(Number(withCheckpoint.n) || 0),
      withScoreNoRisico: Math.floor(Number(withScoreNoRisico.n) || 0),
      withRisico: Math.floor(Number(withRisico.n) || 0),
      staleCheckpoints: Math.floor(Number(staleCheckpoints.n) || 0),
    },
    aiSettings: redactedAiSettings(settings),
    hints: [],
  }

  snap.hints = buildHints(snap, pipeline, maxCheckpointChars, criteriaChunkIncomplete)

  return snap
}
