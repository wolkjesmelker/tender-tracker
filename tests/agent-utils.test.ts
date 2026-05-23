import { describe, it, expect } from 'vitest'
import { parseAgentJson } from '../src/main/ai/risico-agents/agent-utils'
import { coerceFeitenJson } from '../src/main/ai/risico-agents/stage1-feitenextractie'

describe('parseAgentJson', () => {
  it('parset afgekapte feiten-JSON (open string + ontbrekende sluit-haken)', () => {
    const truncated =
      '{ "feiten": [ { "onderwerp": "procedure", "feit": "Het werk \'Bergingsvoorziening Dr Calsstraat\' wordt aanbesteed door middel van een Nationale openbare procedure, hoofdstuk 2 van het'

    const parsed = parseAgentJson<unknown>(truncated, 'test')
    const feiten = coerceFeitenJson(parsed)
    expect(feiten.feiten.length).toBe(1)
    expect(feiten.feiten[0].categorie).toBe('procedure')
    expect(feiten.feiten[0].feit).toContain('Nationale openbare procedure')
  })

  it('parset JSON na voortekst en pakt alleen het eerste object', () => {
    const raw = `Hier is het resultaat:\n\n{"a":1,"b":{"c":2}}\n`
    const parsed = parseAgentJson<{ a: number; b: { c: number } }>(raw, 'test')
    expect(parsed.a).toBe(1)
    expect(parsed.b.c).toBe(2)
  })

  it('parset markdown json-blok', () => {
    const raw = '```json\n{"ok":true}\n```'
    const parsed = parseAgentJson<{ ok: boolean }>(raw, 'test')
    expect(parsed.ok).toBe(true)
  })

  it('parset JSON met trailing comma via jsonrepair', () => {
    const raw = '{"a":1,}'
    const parsed = parseAgentJson<{ a: number }>(raw, 'test')
    expect(parsed.a).toBe(1)
  })

  it('herstelt afgekapt object in markdown-blok', () => {
    const raw = '```json\n{"feiten":[{"categorie":"x","feit":"hallo'
    const parsed = parseAgentJson<unknown>(raw, 'test')
    const feiten = coerceFeitenJson(parsed)
    expect(feiten.feiten[0].categorie).toBe('x')
    expect(feiten.feiten[0].feit).toBe('hallo')
  })
})
