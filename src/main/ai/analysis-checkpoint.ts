import { createHash } from 'node:crypto'
import { getDb } from '../db/connection'

/** Stabiele fingerprint van actieve vragen, criteria en prompts (wijziging = waarschuwing bij hervatten). */
/** Zelfde invoer als `runAnalysis` — voor vergelijking met opgeslagen `configFingerprint` in een checkpoint. */
export function computeCurrentAnalysisConfigFingerprint(): string {
  const db = getDb()
  const questions = db.prepare('SELECT * FROM ai_vragen WHERE is_actief = 1 ORDER BY volgorde').all() as { id: string }[]
  const criteria = db.prepare('SELECT * FROM criteria WHERE is_actief = 1 ORDER BY volgorde').all() as { id: string }[]
  const prompts = db.prepare('SELECT * FROM ai_prompts WHERE is_actief = 1').all() as { id: string; type: string }[]
  return buildAnalysisConfigFingerprint({
    questionIds: questions.map(q => String(q.id)),
    criterionIds: criteria.map(c => String(c.id)),
    promptSignatures: prompts.map(p => `${String(p.type)}:${String(p.id)}`),
  })
}

export function buildAnalysisConfigFingerprint(input: {
  questionIds: string[]
  criterionIds: string[]
  promptSignatures: string[]
}): string {
  const payload = [
    input.questionIds.join(','),
    input.criterionIds.join(','),
    input.promptSignatures.join('|'),
  ].join('##')
  return createHash('sha256').update(payload).digest('hex').slice(0, 32)
}

export type AnalysisDocRef = {
  url: string
  naam: string
  type: string
  localNaam?: string
  bronZipLabel?: string
}

/** JSON-serialiseerbare criteriumdetail (zelfde vorm als pipeline NormalizedCriterionDetail). */
export type NormalizedCriterionDetailJson = {
  score: number
  status: string
  toelichting: string
  brontekst: string
  criterium_naam: string
}

/** Versie 1 checkpoint — opgeslagen bij pauze voor hervatten na herstart app. */
export type AnalysisCheckpointV1 = {
  v: 1
  stage: 'bron_docs' | 'db_docs' | 'ai'
  resolvedBronUrl: string
  detailText: string
  documentTexts: string[]
  sessionPartition?: string
  bronAllDocs: AnalysisDocRef[]
  bronNextIndex: number
  dbAllDocs: AnalysisDocRef[]
  dbNextIndex: number
}

export type AnalysisAiPhase = 'criteria_chunks' | 'main_llm'

export type AnalysisCriteriaChunkingState = {
  totalChunks: number
  completedChunkIndices: number[]
  preComputedCriteria: Record<string, NormalizedCriterionDetailJson>
}

/** Versie 2: zelfde als v1 + AI-subvoortgang + configuratie-fingerprint. */
export type AnalysisCheckpointV2 = {
  v: 2
  stage: 'bron_docs' | 'db_docs' | 'ai'
  resolvedBronUrl: string
  detailText: string
  documentTexts: string[]
  sessionPartition?: string
  bronAllDocs: AnalysisDocRef[]
  bronNextIndex: number
  dbAllDocs: AnalysisDocRef[]
  dbNextIndex: number
  aiPhase: AnalysisAiPhase | null
  criteriaChunking: AnalysisCriteriaChunkingState | null
  /** Hash van actieve criteria-/vragen-/prompt-ids; bij mismatch optioneel waarschuwen bij hervatten. */
  configFingerprint: string
}

export type AnalysisCheckpoint = AnalysisCheckpointV1 | AnalysisCheckpointV2

function isV2(p: unknown): p is AnalysisCheckpointV2 {
  return (
    typeof p === 'object' &&
    p !== null &&
    (p as AnalysisCheckpointV2).v === 2 &&
    typeof (p as AnalysisCheckpointV2).stage === 'string'
  )
}

function isV1(p: unknown): p is AnalysisCheckpointV1 {
  return (
    typeof p === 'object' &&
    p !== null &&
    (p as AnalysisCheckpointV1).v === 1 &&
    typeof (p as AnalysisCheckpointV1).stage === 'string'
  )
}

/** Normaliseert geladen payload naar V2 voor downstream code (v1 → v2 met defaults). */
export function normalizeCheckpointToV2(raw: AnalysisCheckpoint): AnalysisCheckpointV2 {
  if (isV2(raw)) return raw
  return {
    v: 2,
    stage: raw.stage,
    resolvedBronUrl: raw.resolvedBronUrl,
    detailText: raw.detailText,
    documentTexts: raw.documentTexts,
    sessionPartition: raw.sessionPartition,
    bronAllDocs: raw.bronAllDocs,
    bronNextIndex: raw.bronNextIndex,
    dbAllDocs: raw.dbAllDocs,
    dbNextIndex: raw.dbNextIndex,
    aiPhase: null,
    criteriaChunking: null,
    configFingerprint: '',
  }
}

export function saveAnalysisCheckpoint(aanbestedingId: string, data: AnalysisCheckpointV2): void {
  getDb()
    .prepare(
      `INSERT INTO analysis_checkpoint (aanbesteding_id, payload, updated_at)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT(aanbesteding_id) DO UPDATE SET
         payload = excluded.payload,
         updated_at = excluded.updated_at`,
    )
    .run(aanbestedingId, JSON.stringify(data))
}

/** Parseert ruwe checkpoint-JSON (zelfde regels als load). */
export function parseStoredAnalysisCheckpointPayload(payload: string): AnalysisCheckpointV2 | null {
  try {
    const p = JSON.parse(payload) as unknown
    if (isV2(p)) return p
    if (isV1(p)) return normalizeCheckpointToV2(p)
    return null
  } catch {
    return null
  }
}

/** Laadt checkpoint; v1 en v2 worden geaccepteerd. */
export function loadAnalysisCheckpoint(aanbestedingId: string): AnalysisCheckpointV2 | null {
  const row = getDb()
    .prepare('SELECT payload FROM analysis_checkpoint WHERE aanbesteding_id = ?')
    .get(aanbestedingId) as { payload: string } | undefined
  if (!row?.payload) return null
  return parseStoredAnalysisCheckpointPayload(row.payload)
}

/** Ruwe check of er een geldige checkpoint-regel is (v1 of v2). */
export function hasAnalysisCheckpointRow(aanbestedingId: string): boolean {
  return loadAnalysisCheckpoint(aanbestedingId) !== null
}

export function clearAnalysisCheckpoint(aanbestedingId: string): void {
  getDb().prepare('DELETE FROM analysis_checkpoint WHERE aanbesteding_id = ?').run(aanbestedingId)
}
