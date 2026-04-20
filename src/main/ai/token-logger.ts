import log from 'electron-log'
import { getDb } from '../db/connection'

export interface TokenUsageRow {
  provider: string
  model: string
  label: string
  inputTokens: number
  outputTokens: number
  total: number
}

export interface TokenStats {
  last7days: {
    byModel: TokenUsageRow[]
    totalTokens: number
    totalInput: number
    totalOutput: number
  }
  recent: {
    byModel: TokenUsageRow[]
    totalTokens: number
  }
}

/**
 * Persist a single token-usage record.
 * Silently swallows errors so token logging never breaks an analysis.
 */
/**
 * Haalt input/output tokens uit gangbare provider-JSON (OpenAI/Moonshot/Claude messages).
 */
export function normalizeUsageFromApiBody(data: unknown): { input: number; output: number } {
  if (!data || typeof data !== 'object') return { input: 0, output: 0 }
  const d = data as Record<string, unknown>
  const usage = d.usage
  if (usage && typeof usage === 'object') {
    const u = usage as Record<string, unknown>
    const rawIn = u.input_tokens ?? u.prompt_tokens
    const rawOut = u.output_tokens ?? u.completion_tokens
    let input = Math.max(0, Math.floor(Number(rawIn) || 0))
    let output = Math.max(0, Math.floor(Number(rawOut) || 0))
    if (input === 0 && output === 0 && u.total_tokens != null) {
      const tot = Math.max(0, Math.floor(Number(u.total_tokens) || 0))
      if (tot > 0) input = tot
    }
    if (input > 0 || output > 0) return { input, output }
  }
  const pe = d.prompt_eval_count
  const ev = d.eval_count
  if (pe != null || ev != null) {
    return {
      input: Math.max(0, Math.floor(Number(pe) || 0)),
      output: Math.max(0, Math.floor(Number(ev) || 0)),
    }
  }
  return { input: 0, output: 0 }
}

export function logTokenUsage(
  provider: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
): void {
  try {
    const d = getDb()
    const inp = Math.max(0, Math.floor(Number(inputTokens) || 0))
    const out = Math.max(0, Math.floor(Number(outputTokens) || 0))
    d.prepare(
      `INSERT INTO ai_token_usage (provider, model, input_tokens, output_tokens)
       VALUES (?, ?, ?, ?)`,
    ).run(provider, model, inp, out)
  } catch (e) {
    log.warn('[token-logger] Kon token-gebruik niet opslaan:', e)
  }
}

/** Verwijdert alle token-usage records uit de database. */
export function resetTokenStats(): void {
  try {
    const d = getDb()
    d.prepare('DELETE FROM ai_token_usage').run()
  } catch (e) {
    log.warn('[token-logger] resetTokenStats fout:', e)
  }
}

/** Returns aggregated token stats from the DB. */
export function getTokenStats(): TokenStats {
  const empty: TokenStats = {
    last7days: { byModel: [], totalTokens: 0, totalInput: 0, totalOutput: 0 },
    recent: { byModel: [], totalTokens: 0 },
  }

  try {
    const d = getDb()

    type Row = { provider: string; model: string; input_tokens: number; output_tokens: number }

    const rows7d = d
      .prepare(
        `SELECT provider, model,
                SUM(input_tokens)  AS input_tokens,
                SUM(output_tokens) AS output_tokens
         FROM ai_token_usage
         WHERE created_at >= datetime('now', '-7 days')
         GROUP BY provider, model
         ORDER BY (SUM(input_tokens) + SUM(output_tokens)) DESC`,
      )
      .all() as Row[]

    const byModel7d: TokenUsageRow[] = rows7d.map((r) => {
      const inputTokens = Math.floor(Number(r.input_tokens) || 0)
      const outputTokens = Math.floor(Number(r.output_tokens) || 0)
      return {
        provider: r.provider,
        model: r.model,
        label: r.model ? `${r.provider} · ${r.model}` : r.provider,
        inputTokens,
        outputTokens,
        total: inputTokens + outputTokens,
      }
    })

    const totalInput = byModel7d.reduce((s, r) => s + r.inputTokens, 0)
    const totalOutput = byModel7d.reduce((s, r) => s + r.outputTokens, 0)

    // "Recent" = laatste 8 uur (lange risico-/analyse-sessies; 30 min was te kort voor Kimi in UI)
    const rowsRecent = d
      .prepare(
        `SELECT provider, model,
                SUM(input_tokens)  AS input_tokens,
                SUM(output_tokens) AS output_tokens
         FROM ai_token_usage
         WHERE created_at >= datetime('now', '-8 hours')
         GROUP BY provider, model
         ORDER BY (SUM(input_tokens) + SUM(output_tokens)) DESC`,
      )
      .all() as Row[]

    const byModelRecent: TokenUsageRow[] = rowsRecent.map((r) => {
      const inputTokens = Math.floor(Number(r.input_tokens) || 0)
      const outputTokens = Math.floor(Number(r.output_tokens) || 0)
      return {
        provider: r.provider,
        model: r.model,
        label: r.model ? `${r.provider} · ${r.model}` : r.provider,
        inputTokens,
        outputTokens,
        total: inputTokens + outputTokens,
      }
    })

    return {
      last7days: {
        byModel: byModel7d,
        totalTokens: totalInput + totalOutput,
        totalInput,
        totalOutput,
      },
      recent: {
        byModel: byModelRecent,
        totalTokens: byModelRecent.reduce((s, r) => s + r.total, 0),
      },
    }
  } catch (e) {
    log.warn('[token-logger] getTokenStats fout:', e)
    return empty
  }
}
