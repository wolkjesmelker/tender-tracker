/**
 * Weergave van geconfigureerde AI-modellen (Instellingen → zelfde keys als AIService.configure).
 */

const DEFAULT_MODEL: Record<string, string> = {
  claude: 'claude-sonnet-4-6',
  openai: 'gpt-4o',
  moonshot: 'kimi-k2.6',
  kimi_cli: 'kimi-k2.6',
  ollama: 'llama3.1',
}

const PROVIDER_LABEL: Record<string, string> = {
  claude: 'Claude',
  openai: 'OpenAI',
  moonshot: 'Kimi (Moonshot)',
  kimi_cli: 'Kimi Code CLI',
  ollama: 'Ollama',
}

/** Label zoals in de analyse-pipeline: «Provider · model». */
export function buildConfiguredMainAgentLabel(settings: Record<string, string | undefined>): string {
  const providerType = (settings.ai_provider || 'claude').trim()
  const modelRaw = (settings.ai_model || '').trim()
  const name = PROVIDER_LABEL[providerType] || providerType
  const model = modelRaw || DEFAULT_MODEL[providerType] || ''
  return model ? `${name} · ${model}` : name
}

export interface RisicoModelDisplay {
  /** Korte regel voor UI */
  label: string
  /** Toelichting (1 zin) */
  hint: string
}

/**
 * Risico gebruikt vaste Kimi k2.6 via Moonshot wanneer moonshot_api_key gezet is;
 * anders dezelfde provider als de hoofd-analyse.
 */
export function buildRisicoModelDisplay(settings: Record<string, string | undefined>): RisicoModelDisplay {
  const moon = (settings.moonshot_api_key || '').trim()
  if (moon) {
    return {
      label: 'Kimi (Moonshot) · kimi-k2.6',
      hint: 'Vaste modelroute voor risico-inventarisatie (Moonshot API).',
    }
  }
  return {
    label: buildConfiguredMainAgentLabel(settings),
    hint: 'Zelfde provider en model als de hoofd-analyse (geen Moonshot-sleutel).',
  }
}
