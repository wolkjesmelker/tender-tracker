import log from 'electron-log'
import { jsonrepair } from 'jsonrepair'

/**
 * Neemt vanaf het eerste `{` of `[` tot en met het bijpassende sluit-teken (string-aware).
 * Bij afgekapte output: retourneert de rest vanaf het start-teken (zonder valse match naar een `}` verderop).
 */
function sliceFirstJsonValue(raw: string): string | null {
  const t = raw.trim()
  const startObj = t.indexOf('{')
  const startArr = t.indexOf('[')
  let start = -1
  if (startObj >= 0 && (startArr < 0 || startObj < startArr)) start = startObj
  else if (startArr >= 0) start = startArr
  else return null

  let depth = 0
  let inString = false
  let escape = false
  for (let i = start; i < t.length; i++) {
    const ch = t[i]
    if (escape) {
      escape = false
      continue
    }
    if (ch === '\\' && inString) {
      escape = true
      continue
    }
    if (ch === '"') {
      inString = !inString
      continue
    }
    if (inString) continue
    if (ch === '{' || ch === '[') depth++
    else if (ch === '}' || ch === ']') {
      depth--
      if (depth === 0) return t.slice(start, i + 1)
    }
  }
  return t.slice(start)
}

/**
 * Probeert afgekapte JSON te herstellen: sluit open strings en balanceert {} / [] in goede volgorde.
 */
function repairTruncatedJson(raw: string): string {
  let s = raw.trimEnd()
  s = s.replace(/,\s*$/, '')

  let inString = false
  let escape = false
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (escape) {
      escape = false
      continue
    }
    if (ch === '\\' && inString) {
      escape = true
      continue
    }
    if (ch === '"') {
      inString = !inString
      continue
    }
  }
  if (inString) {
    s += '"'
  }

  const stack: Array<'}' | ']'> = []
  inString = false
  escape = false
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (escape) {
      escape = false
      continue
    }
    if (ch === '\\' && inString) {
      escape = true
      continue
    }
    if (ch === '"') {
      inString = !inString
      continue
    }
    if (inString) continue
    if (ch === '{') stack.push('}')
    else if (ch === '[') stack.push(']')
    else if (ch === '}' || ch === ']') {
      if (stack.length > 0 && stack[stack.length - 1] === ch) stack.pop()
    }
  }
  while (stack.length > 0) {
    s += stack.pop()!
  }
  return s
}

/**
 * Robuuste JSON-parser voor agent-output.
 * Handles: pure JSON, ```json ... ```, tekst voor/na JSON-object, BOM, afgekapte JSON.
 */
export function parseAgentJson<T>(raw: string, agentName: string): T {
  if (!raw || !raw.trim()) {
    throw new Error(`${agentName}: lege respons ontvangen van het model`)
  }

  const trimmed = raw.trim().replace(/^\uFEFF/, '') // strip BOM

  // 1. Probeer markdown code block: ```json ... ``` of ``` ... ```
  const mdMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (mdMatch) {
    try {
      return JSON.parse(mdMatch[1].trim()) as T
    } catch {
      try {
        return JSON.parse(repairTruncatedJson(mdMatch[1].trim())) as T
      } catch {
        // valt door
      }
    }
  }

  // 2. Probeer direct parsen
  try {
    return JSON.parse(trimmed) as T
  } catch {
    // valt door naar volgende methode
  }

  // 3. Eerste JSON-waarde (object/array) — string-aware; geen gierige `.*}` die verkeerd eindigt
  const sliced = sliceFirstJsonValue(trimmed)
  if (sliced) {
    try {
      return JSON.parse(sliced) as T
    } catch {
      try {
        return JSON.parse(repairTruncatedJson(sliced)) as T
      } catch {
        // valt door
      }
    }
  }

  // 4. Hele tekst repareren (begint met { of [)
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.parse(repairTruncatedJson(trimmed)) as T
    } catch {
      // valt door
    }
  }

  // 5. jsonrepair (trailing commas, unescaped chars, afkappingen — dependency al in project)
  if (sliced) {
    try {
      return JSON.parse(jsonrepair(sliced)) as T
    } catch {
      try {
        return JSON.parse(jsonrepair(repairTruncatedJson(sliced))) as T
      } catch {
        // valt door
      }
    }
  }
  try {
    return JSON.parse(jsonrepair(trimmed)) as T
  } catch {
    // valt door
  }

  // Geen van de pogingen werkte: log de ruwe respons en gooi een bruikbare fout
  log.error(`[risico-agent] ${agentName}: JSON-parsing mislukt. Eerste 500 tekens van respons:`, trimmed.slice(0, 500))
  throw new Error(
    `${agentName}: kon JSON niet parsen vanuit model-respons. ` +
      `Controleer of het model JSON retourneert. Eerste 200 tekens: "${trimmed.slice(0, 200)}"`,
  )
}
