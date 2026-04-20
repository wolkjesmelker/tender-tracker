import fs from 'fs'
import path from 'path'
import log from 'electron-log'
import { getDb } from '../db/connection'
import { getAppDataPath } from '../utils/paths'
import type { AgentLearningEntry } from '../../shared/types'

/**
 * Lokale leervaardigheden worden per document-type in een aparte JSON-mirror bewaard.
 * Deze mirror dient als draagbare snapshot naast de DB en is transparant inzichtelijk.
 */
const LEARNING_ROOT = 'agent-learning'

function getLearningDir(): string {
  const dir = path.join(getAppDataPath(), LEARNING_ROOT)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function slugifyDocType(hint: string): string {
  const s = String(hint || 'overig').toLowerCase().trim()
  return s.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'overig'
}

function learningFileFor(docType: string): string {
  return path.join(getLearningDir(), `${slugifyDocType(docType)}.json`)
}

type MirrorEntry = {
  label?: string
  question_pattern?: string
  learned_answers: { value: string; use_count: number; last_used: string }[]
}
type MirrorFile = Record<string, MirrorEntry>

function readMirror(docType: string): MirrorFile {
  const p = learningFileFor(docType)
  try {
    if (!fs.existsSync(p)) return {}
    const txt = fs.readFileSync(p, 'utf-8')
    return JSON.parse(txt) as MirrorFile
  } catch (e) {
    log.warn('[agent-learning] mirror read faalde:', e)
    return {}
  }
}

function writeMirror(docType: string, data: MirrorFile): void {
  const p = learningFileFor(docType)
  try {
    fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf-8')
  } catch (e) {
    log.warn('[agent-learning] mirror write faalde:', e)
  }
}

/** Vuistregel: leid document-type af uit bestandsnaam (bestek, eigen verklaring, NDA, …). */
export function inferDocumentTypeHint(documentNaam: string): string {
  const s = String(documentNaam || '').toLowerCase()
  if (!s.trim()) return 'overig'
  const map: Array<[RegExp, string]> = [
    [/\b(bestek|raw)\b/, 'bestek'],
    [/eigen[-\s]?verklaring|uea|ubo/, 'eigen-verklaring'],
    [/\b(nda|geheimhoudings)\b/, 'nda'],
    [/inschrij(f|v)ings?.?formulier|inschrijfbiljet/, 'inschrijfformulier'],
    [/\b(prijs|prijslijst|staat.*hoeveelheden|inschrijfstaat)\b/, 'prijzenstaat'],
    [/\b(selectie|leidraad)\b/, 'selectieleidraad'],
    [/\b(pve|programma.?van.?eisen)\b/, 'pve'],
    [/\bplanning\b/, 'planning'],
    [/\bcv\b|curriculum/, 'cv'],
    [/\breferenti/, 'referentie'],
    [/\bvog\b/, 'vog'],
    [/\b(iso|kiwa|co2|prestatieladder)\b/, 'certificaat'],
  ]
  for (const [re, label] of map) if (re.test(s)) return label
  return 'overig'
}

/** Stabiele sleutel voor een veld; case-insensitive, ontdaan van witruimte. */
export function fieldKeyFor(fieldId: string, fieldLabel?: string): string {
  const id = String(fieldId || '').trim().toLowerCase()
  if (id) return id
  return String(fieldLabel || '').trim().toLowerCase().replace(/\s+/g, '-')
}

export function recordCorrection(input: {
  tenderId?: string
  documentNaam: string
  fieldId: string
  fieldLabel?: string
  questionPattern?: string
  newValue: string
}): void {
  const value = String(input.newValue ?? '').trim()
  if (!value) return

  const docType = inferDocumentTypeHint(input.documentNaam)
  const key = fieldKeyFor(input.fieldId, input.fieldLabel)

  const db = getDb()
  const existing = db
    .prepare(
      `SELECT id, use_count FROM agent_learning_entries
       WHERE document_type_hint = ? AND field_key = ? AND preferred_answer = ?
       LIMIT 1`,
    )
    .get(docType, key, value) as { id: string; use_count: number } | undefined

  if (existing) {
    db.prepare(
      `UPDATE agent_learning_entries
       SET use_count = use_count + 1,
           last_used_at = datetime('now'),
           source_tender_id = COALESCE(?, source_tender_id),
           field_label = COALESCE(?, field_label),
           question_pattern = COALESCE(?, question_pattern)
       WHERE id = ?`,
    ).run(input.tenderId ?? null, input.fieldLabel ?? null, input.questionPattern ?? null, existing.id)
  } else {
    db.prepare(
      `INSERT INTO agent_learning_entries
         (document_type_hint, field_key, field_label, question_pattern, preferred_answer,
          source_tender_id, use_count, last_used_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, datetime('now'))`,
    ).run(docType, key, input.fieldLabel ?? null, input.questionPattern ?? null, value, input.tenderId ?? null)
  }

  const mirror = readMirror(docType)
  const entry: MirrorEntry = mirror[key] || { learned_answers: [] }
  if (input.fieldLabel) entry.label = input.fieldLabel
  if (input.questionPattern) entry.question_pattern = input.questionPattern
  const hit = entry.learned_answers.find((a) => a.value === value)
  if (hit) {
    hit.use_count += 1
    hit.last_used = new Date().toISOString()
  } else {
    entry.learned_answers.push({ value, use_count: 1, last_used: new Date().toISOString() })
  }
  entry.learned_answers.sort((a, b) => b.use_count - a.use_count)
  mirror[key] = entry
  writeMirror(docType, mirror)
}

/**
 * Zoekt beste geleerde antwoord voor (documentNaam, veld). Houdt rekening met
 * vergelijkbare fieldKeys door ook op fieldLabel-match te vallen.
 */
export function lookupLearnedAnswer(input: {
  documentNaam: string
  fieldId: string
  fieldLabel?: string
}): AgentLearningEntry | null {
  const docType = inferDocumentTypeHint(input.documentNaam)
  const key = fieldKeyFor(input.fieldId, input.fieldLabel)
  const db = getDb()

  const exact = db
    .prepare(
      `SELECT id, document_type_hint, field_key, field_label, question_pattern,
              preferred_answer, use_count, last_used_at
       FROM agent_learning_entries
       WHERE document_type_hint = ? AND field_key = ?
       ORDER BY use_count DESC, last_used_at DESC LIMIT 1`,
    )
    .get(docType, key) as AgentLearningEntry | undefined
  if (exact) return exact

  if (input.fieldLabel) {
    const byLabel = db
      .prepare(
        `SELECT id, document_type_hint, field_key, field_label, question_pattern,
                preferred_answer, use_count, last_used_at
         FROM agent_learning_entries
         WHERE document_type_hint = ? AND LOWER(field_label) = LOWER(?)
         ORDER BY use_count DESC, last_used_at DESC LIMIT 1`,
      )
      .get(docType, input.fieldLabel) as AgentLearningEntry | undefined
    if (byLabel) return byLabel
  }

  // Cross-doctype fallback op exact veldsleutel (universele gegevens als KVK, bedrijfsnaam).
  const universal = db
    .prepare(
      `SELECT id, document_type_hint, field_key, field_label, question_pattern,
              preferred_answer, use_count, last_used_at
       FROM agent_learning_entries
       WHERE field_key = ?
       ORDER BY use_count DESC, last_used_at DESC LIMIT 1`,
    )
    .get(key) as AgentLearningEntry | undefined

  return universal ?? null
}

export function listLearningEntriesForDocument(documentNaam: string): AgentLearningEntry[] {
  const docType = inferDocumentTypeHint(documentNaam)
  return getDb()
    .prepare(
      `SELECT id, document_type_hint, field_key, field_label, question_pattern,
              preferred_answer, use_count, last_used_at
       FROM agent_learning_entries
       WHERE document_type_hint = ?
       ORDER BY use_count DESC, last_used_at DESC`,
    )
    .all(docType) as AgentLearningEntry[]
}

export function getLearningFolder(): string {
  return getLearningDir()
}

export function exportLearningSnapshot(): Record<string, unknown> {
  const rows = getDb()
    .prepare(
      `SELECT document_type_hint, field_key, field_label, question_pattern,
              preferred_answer, use_count, last_used_at
       FROM agent_learning_entries`,
    )
    .all()
  return { exported_at: new Date().toISOString(), entries: rows }
}
