import { spawn } from 'child_process'
import { logTokenUsage, normalizeUsageFromApiBody } from './token-logger'
import { formatFetchFailure } from '../utils/http-resilience'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/** Bij structured analysis: Ollama krijgt `format: json`, OpenAI krijgt `response_format: json_object`. */
export interface ChatOptions {
  preferJsonOutput?: boolean
}

export interface AIProvider {
  readonly name: string
  chat(messages: ChatMessage[], options?: ChatOptions): Promise<string>
  isAvailable(): Promise<boolean>
}

class ClaudeProvider implements AIProvider {
  readonly name = 'Claude'
  private apiKey: string
  private model: string

  constructor(apiKey: string, model: string = 'claude-sonnet-4-6') {
    this.apiKey = apiKey
    this.model = model
  }

  async chat(messages: ChatMessage[], _options?: ChatOptions): Promise<string> {
    const systemMessage = messages.find(m => m.role === 'system')?.content || ''
    const userMessages = messages.filter(m => m.role !== 'system').map(m => ({
      role: m.role,
      content: m.content,
    }))

    const endpoint = 'https://api.anthropic.com/v1/messages'
    let response: Response
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: 16000,
          system: systemMessage,
          messages: userMessages,
        }),
      })
    } catch (e) {
      throw formatFetchFailure(e, 'Claude API niet bereikbaar', endpoint)
    }

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Claude API error: ${response.status} - ${error}`)
    }

    const data = await response.json()
    const { input, output } = normalizeUsageFromApiBody(data)
    logTokenUsage('Claude', this.model, input, output)
    return data.content?.[0]?.text || ''
  }

  async isAvailable(): Promise<boolean> {
    return !!this.apiKey
  }
}

/**
 * Kimi (Moonshot) — OpenAI-compatibel chat/completions endpoint.
 * @see https://platform.moonshot.cn/docs
 */
class MoonshotProvider implements AIProvider {
  readonly name = 'Kimi (Moonshot)'
  private apiKey: string
  private model: string
  private baseUrl: string

  constructor(
    apiKey: string,
    model: string = 'kimi-k2.6',
    baseUrl: string = 'https://api.moonshot.cn/v1'
  ) {
    this.apiKey = apiKey
    this.model = model
    this.baseUrl = baseUrl.replace(/\/$/, '')
  }

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<string> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      max_tokens: 16384,
    }
    if (options?.preferJsonOutput) {
      body.response_format = { type: 'json_object' }
    }

    const endpoint = `${this.baseUrl}/chat/completions`
    let response: Response
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
      })
    } catch (e) {
      throw formatFetchFailure(e, 'Moonshot (Kimi) API niet bereikbaar', endpoint)
    }

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Moonshot (Kimi) API error: ${response.status} - ${error}`)
    }

    const data = await response.json()
    const { input, output } = normalizeUsageFromApiBody(data)
    logTokenUsage('Kimi (Moonshot)', this.model, input, output)
    return data.choices?.[0]?.message?.content || ''
  }

  async isAvailable(): Promise<boolean> {
    return !!this.apiKey
  }
}

/** Laatste assistant-tekst uit `kimi --output-format stream-json` (JSONL). */
function parseKimiCliStreamJson(stdout: string): string {
  let last = ''
  for (const line of stdout.split(/\r?\n/)) {
    const t = line.trim()
    if (!t) continue
    try {
      const o = JSON.parse(t) as {
        role?: string
        content?: unknown
        tool_calls?: unknown[]
      }
      if (o.role !== 'assistant') continue
      if (Array.isArray(o.tool_calls) && o.tool_calls.length > 0) continue
      if (typeof o.content === 'string' && o.content.trim()) last = o.content.trim()
    } catch {
      /* geen geldige JSONL-regel */
    }
  }
  return last
}

/**
 * Officiële **Kimi Code CLI** (`kimi` op PATH), print-modus met stream-json.
 * Vereist: `uv tool install kimi-cli` en `KIMI_API_KEY` (zelfde Moonshot-sleutel als in Instellingen).
 * @see https://moonshotai.github.io/kimi-cli/en/customization/print-mode.html
 */
class KimiCliProvider implements AIProvider {
  readonly name = 'Kimi Code CLI'
  private apiKey: string
  private model: string
  private baseUrl: string
  private binary: string
  private maxSteps: number

  constructor(
    apiKey: string,
    model: string,
    baseUrl: string,
    binary: string,
    maxSteps: number
  ) {
    this.apiKey = apiKey
    this.model = model
    this.baseUrl = baseUrl.replace(/\/$/, '')
    this.binary = binary
    this.maxSteps = maxSteps
  }

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<string> {
    let msgs = [...messages]
    if (options?.preferJsonOutput && msgs.length > 0) {
      const i = msgs.length - 1
      const last = msgs[i]
      if (last.role === 'user') {
        msgs[i] = {
          ...last,
          content: `${last.content}\n\nAntwoord uitsluitend met geldige JSON (geen markdown-fences, geen tekst eromheen).`,
        }
      }
    }

    const input = msgs.map((m) => JSON.stringify({ role: m.role, content: m.content })).join('\n') + '\n'

    const args = [
      '--print',
      '--no-thinking',
      '--input-format',
      'stream-json',
      '--output-format',
      'stream-json',
      '--max-steps-per-turn',
      String(this.maxSteps),
      '-m',
      this.model,
    ]

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      KIMI_API_KEY: this.apiKey,
      KIMI_BASE_URL: this.baseUrl,
      KIMI_CLI_NO_AUTO_UPDATE: '1',
      KIMI_MODEL_MAX_TOKENS: '16384',
    }

    const stdout = await new Promise<string>((resolve, reject) => {
      const chunks: Buffer[] = []
      const errBuf: Buffer[] = []
      const child = spawn(this.binary, args, { env, stdio: ['pipe', 'pipe', 'pipe'] })
      let done = false
      const timer = setTimeout(() => {
        if (done) return
        done = true
        child.kill('SIGKILL')
        reject(new Error('Kimi Code CLI: timeout (20 min) — prompt of agent te zwaar'))
      }, 1_200_000)

      child.stdin.write(input, 'utf-8')
      child.stdin.end()

      child.stdout.on('data', (c: Buffer) => chunks.push(c))
      child.stderr.on('data', (c: Buffer) => errBuf.push(c))

      child.on('error', (err) => {
        if (done) return
        done = true
        clearTimeout(timer)
        reject(
          new Error(
            `Kimi Code CLI start mislukt (${err.message}). Installeer met: uv tool install --python 3.13 kimi-cli`
          )
        )
      })

      child.on('close', (code) => {
        if (done) return
        done = true
        clearTimeout(timer)
        const errText = Buffer.concat(errBuf).toString('utf-8')
        const outText = Buffer.concat(chunks).toString('utf-8')
        if (code === 75) {
          reject(
            new Error(
              `Kimi Code CLI: tijdelijke fout (exit 75), probeer opnieuw. ${errText.slice(0, 1200)}`
            )
          )
          return
        }
        if (code !== 0) {
          reject(
            new Error(
              `Kimi Code CLI eindigde met code ${code}. ${errText.slice(0, 2500) || outText.slice(0, 800)}`
            )
          )
          return
        }
        resolve(outText)
      })
    })

    const text = parseKimiCliStreamJson(stdout)
    if (!text) {
      throw new Error(
        'Kimi Code CLI gaf geen assistant-tekst. Controleer API-sleutel, `kimi login`, en of `kimi --version` werkt.'
      )
    }
    return text
  }

  async isAvailable(): Promise<boolean> {
    if (!this.apiKey) return false
    return new Promise((resolve) => {
      const child = spawn(this.binary, ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] })
      child.on('close', (c) => resolve(c === 0))
      child.on('error', () => resolve(false))
    })
  }
}

class OpenAIProvider implements AIProvider {
  readonly name = 'OpenAI'
  private apiKey: string
  private model: string

  constructor(apiKey: string, model: string = 'gpt-4o') {
    this.apiKey = apiKey
    this.model = model
  }

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<string> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      max_tokens: 16384,
    }
    if (options?.preferJsonOutput) {
      body.response_format = { type: 'json_object' }
    }

    const endpoint = 'https://api.openai.com/v1/chat/completions'
    let response: Response
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
      })
    } catch (e) {
      throw formatFetchFailure(e, 'OpenAI API niet bereikbaar', endpoint)
    }

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`OpenAI API error: ${response.status} - ${error}`)
    }

    const data = await response.json()
    const { input, output } = normalizeUsageFromApiBody(data)
    logTokenUsage('OpenAI', this.model, input, output)
    return data.choices?.[0]?.message?.content || ''
  }

  async isAvailable(): Promise<boolean> {
    return !!this.apiKey
  }
}

class OllamaProvider implements AIProvider {
  readonly name = 'Ollama'
  private endpoint: string
  private model: string

  constructor(endpoint: string = 'http://localhost:11434', model: string = 'llama3.1') {
    this.endpoint = endpoint
    this.model = model
  }

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<string> {
    const payload: Record<string, unknown> = {
      model: this.model,
      messages,
      stream: false,
      options: {
        num_predict: 16384,
      },
    }
    if (options?.preferJsonOutput) {
      payload.format = 'json'
    }

    const endpoint = `${this.endpoint}/api/chat`
    let response: Response
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
    } catch (e) {
      throw formatFetchFailure(e, 'Ollama niet bereikbaar', endpoint)
    }

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.status}`)
    }

    const data = await response.json()
    const { input, output } = normalizeUsageFromApiBody(data)
    logTokenUsage('Ollama', this.model, input, output)
    return data.message?.content || ''
  }

  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.endpoint}/api/tags`)
      return response.ok
    } catch {
      return false
    }
  }
}

export class AIService {
  private provider: AIProvider | null = null
  /** Weergave voor voortgang UI: «Provider · model» */
  private configuredAgentLabel = ''

  configure(settings: Record<string, string>): void {
    const providerType = settings.ai_provider || 'claude'
    const model = settings.ai_model || ''
    const apiKey = settings.ai_api_key || ''
    const ollamaEndpoint = settings.ollama_endpoint || 'http://localhost:11434'
    const moonshotBase =
      (settings.moonshot_api_base || '').trim() || 'https://api.moonshot.cn/v1'

    if (providerType !== 'ollama' && !apiKey) {
      const label =
        providerType === 'claude'
          ? 'Claude (Anthropic)'
          : providerType === 'openai'
            ? 'OpenAI'
            : providerType === 'moonshot'
              ? 'Kimi (Moonshot API)'
              : providerType === 'kimi_cli'
                ? 'Kimi Code CLI'
                : 'deze cloud-provider'
      throw new Error(
        `Geen API-sleutel ingesteld voor ${label}. ` +
          `Ga naar Instellingen → AI Model configuratie om je API-sleutel in te voeren.`
      )
    }

    switch (providerType) {
      case 'claude':
        this.provider = new ClaudeProvider(apiKey, model || 'claude-sonnet-4-6')
        break
      case 'openai':
        this.provider = new OpenAIProvider(apiKey, model || 'gpt-4o')
        break
      case 'moonshot':
        this.provider = new MoonshotProvider(apiKey, model || 'kimi-k2.6', moonshotBase)
        break
      case 'kimi_cli': {
        const binary = (settings.kimi_cli_path || 'kimi').trim() || 'kimi'
        const maxSteps = Math.min(
          200,
          Math.max(1, parseInt(String(settings.kimi_cli_max_steps || '48'), 10) || 48)
        )
        this.provider = new KimiCliProvider(apiKey, model || 'kimi-k2.6', moonshotBase, binary, maxSteps)
        break
      }
      case 'ollama':
        this.provider = new OllamaProvider(ollamaEndpoint, model || 'llama3.1')
        break
      default:
        throw new Error(`Onbekende AI provider: ${providerType}`)
    }

    const modelTrim = model.trim()
    const defaultModel: Record<string, string> = {
      claude: 'claude-sonnet-4-6',
      openai: 'gpt-4o',
      moonshot: 'kimi-k2.6',
      kimi_cli: 'kimi-k2.6',
      ollama: 'llama3.1',
    }
    const modelResolved = modelTrim || defaultModel[providerType] || ''
    const p = this.provider
    this.configuredAgentLabel = p
      ? modelResolved
        ? `${p.name} · ${modelResolved}`
        : p.name
      : providerType
  }

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<string> {
    if (!this.provider) throw new Error('AI service not configured')
    return this.provider.chat(messages, options)
  }

  async isAvailable(): Promise<boolean> {
    if (!this.provider) return false
    return this.provider.isAvailable()
  }

  getProviderName(): string {
    return this.provider?.name || 'Niet geconfigureerd'
  }

  /** Label voor voortgang (na configure), bv. «Claude · claude-sonnet-4-6» */
  getConfiguredAgentLabel(): string {
    return this.configuredAgentLabel || this.getProviderName()
  }
}

export const aiService = new AIService()
