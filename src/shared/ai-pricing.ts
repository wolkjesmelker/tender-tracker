/**
 * Indicatieve kosten (USD-tarieven → EUR) voor tokenverbruik.
 * Tarieven wijzigen bij providers; dit is een grove schatting voor in-app inzicht.
 */

const USD_PER_EUR = 1.09

type Rates = { inputPerMUsd: number; outputPerMUsd: number }

function ratesFor(provider: string, model: string): Rates | null {
  const p = provider.trim()
  const m = model.toLowerCase()

  if (p === 'Ollama') {
    return { inputPerMUsd: 0, outputPerMUsd: 0 }
  }

  if (p === 'OpenAI') {
    if (m.includes('gpt-4o-mini') || m.includes('4o-mini')) {
      return { inputPerMUsd: 0.15, outputPerMUsd: 0.6 }
    }
    if (m.includes('gpt-4o') || m.startsWith('gpt-4')) {
      return { inputPerMUsd: 2.5, outputPerMUsd: 10 }
    }
    return { inputPerMUsd: 2.5, outputPerMUsd: 10 }
  }

  if (p === 'Claude') {
    if (m.includes('opus')) {
      return { inputPerMUsd: 15, outputPerMUsd: 75 }
    }
    if (m.includes('haiku')) {
      return { inputPerMUsd: 0.25, outputPerMUsd: 1.25 }
    }
    return { inputPerMUsd: 3, outputPerMUsd: 15 }
  }

  if (p === 'Kimi (Moonshot)') {
    // kimi-k2: $2/$6 per 1M tokens (indicatief, zie platform.moonshot.cn)
    // kimi-k2.5 / kimi-k2.6 / moonshot-v1-*: goedkoper
    if (m.includes('k2') && !m.includes('k2.5') && !m.includes('k2.6')) {
      return { inputPerMUsd: 2, outputPerMUsd: 6 }
    }
    return { inputPerMUsd: 0.5, outputPerMUsd: 2 }
  }

  if (p === 'Kimi Code CLI') {
    return null
  }

  return null
}

/** Geschatte kosten in EUR, of null als provider niet in de tabel staat. */
export function estimateTokenCostEur(
  provider: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
): number | null {
  const r = ratesFor(provider, model)
  if (!r) return null
  const usd = (inputTokens / 1_000_000) * r.inputPerMUsd + (outputTokens / 1_000_000) * r.outputPerMUsd
  return usd / USD_PER_EUR
}

export function formatEurIndicative(value: number): string {
  return new Intl.NumberFormat('nl-NL', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  }).format(value)
}
