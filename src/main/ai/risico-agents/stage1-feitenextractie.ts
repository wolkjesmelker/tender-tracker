import { parseAgentJson } from './agent-utils'
import type { RisicoChatFn } from '../risico-analysis'
import type { FeitenJson, RisicoScoreV2 } from '../../../shared/types-risico-v2'
import type { DocumentIntakeResult } from './stage1-document-intake'
import type { TenderAnalyseResult } from './stage1-tenderanalyse'

const FEIT_STATUS = new Set<string>([
  'letterlijk_uit_stukken',
  'controleerbaar_impliciet',
  'ontbrekend',
  'conflicterend',
])

const ZEKERHEID = new Set<RisicoScoreV2>(['Laag', 'Middel', 'Hoog'])

/** Maakt ruwe model-JSON bruikbaar (veldnamen als "onderwerp" → categorie, ontbrekende arrays). */
export function coerceFeitenJson(data: unknown): FeitenJson {
  const empty: FeitenJson = { feiten: [], ontbrekende_kerninformatie: [], conflicterende_feiten: [] }
  if (data == null || typeof data !== 'object') return empty
  const o = data as Record<string, unknown>

  const feitenRaw = Array.isArray(o.feiten) ? o.feiten : []
  const feiten = feitenRaw.map((item) => {
    const r = item && typeof item === 'object' ? (item as Record<string, unknown>) : {}
    const categorie =
      String(r.categorie ?? r.onderwerp ?? r.topic ?? r.type ?? 'overig').trim() || 'overig'
    const feit = String(r.feit ?? r.waarde ?? r.omschrijving ?? '').trim()
    const bron = String(r.bron ?? r.document ?? r.bronverwijzing ?? '').trim()
    const stRaw = String(r.status ?? 'letterlijk_uit_stukken')
    const status = (FEIT_STATUS.has(stRaw) ? stRaw : 'letterlijk_uit_stukken') as FeitenJson['feiten'][0]['status']
    const zRaw = String(r.zekerheid ?? 'Laag')
    const zekerheid = (ZEKERHEID.has(zRaw as RisicoScoreV2) ? zRaw : 'Laag') as RisicoScoreV2
    return { categorie, feit, bron, status, zekerheid }
  })

  const ontv = Array.isArray(o.ontbrekende_kerninformatie) ? o.ontbrekende_kerninformatie : []
  const ontbrekende_kerninformatie = ontv.map((item) => {
    const r = item && typeof item === 'object' ? (item as Record<string, unknown>) : {}
    return {
      onderwerp: String(r.onderwerp ?? r.categorie ?? '').trim(),
      reden_relevant: String(r.reden_relevant ?? r.reden ?? '').trim(),
      status: String(r.status ?? '').trim(),
    }
  })

  const confRaw = Array.isArray(o.conflicterende_feiten) ? o.conflicterende_feiten : []
  const conflicterende_feiten = confRaw.map((item) => {
    const r = item && typeof item === 'object' ? (item as Record<string, unknown>) : {}
    return {
      onderwerp: String(r.onderwerp ?? '').trim(),
      bron_1: String(r.bron_1 ?? r.bron1 ?? '').trim(),
      bron_2: String(r.bron_2 ?? r.bron2 ?? '').trim(),
      conflict: String(r.conflict ?? r.omschrijving ?? '').trim(),
    }
  })

  return { feiten, ontbrekende_kerninformatie, conflicterende_feiten }
}

const SCHEMA_HINT = `
Verplichte JSON-vorm (velden exact zo; arrays mogen leeg zijn):
{
  "feiten": [
    {
      "categorie": "procedure|termijnen|eisen|scope|contract|...",
      "feit": "neutrale feitelijke zin",
      "bron": "document of paragraaf",
      "status": "letterlijk_uit_stukken|controleerbaar_impliciet|ontbrekend|conflicterend",
      "zekerheid": "Laag|Middel|Hoog"
    }
  ],
  "ontbrekende_kerninformatie": [ { "onderwerp": "", "reden_relevant": "", "status": "" } ],
  "conflicterende_feiten": [ { "onderwerp": "", "bron_1": "", "bron_2": "", "conflict": "" } ]
}
Gebruik "categorie" (niet "onderwerp") voor het onderwerp-type per feit.`

const SYSTEM = `Je bent de Feitenextractie Agent.

Haal alleen feitelijke informatie uit de aangeleverde stukken. Geen interpretaties, geen aannames, geen conclusies die niet rechtstreeks uit documenten volgen.

Extraheer feiten over:
- procedure;
- termijnen;
- eisen;
- scope;
- contract;
- aansprakelijkheid;
- gunning;
- hoeveelheden;
- staten;
- tekeningen;
- uitvoering;
- planning;
- locatie;
- verkeer;
- omgeving;
- bodem;
- grondwater;
- riolering;
- vergunningen;
- veiligheid;
- betaling;
- meerwerk;
- boetes;
- garanties;
- documentenhiërarchie.

Elk feit moet een bron hebben.

Als een relevant onderwerp niet voorkomt in de stukken, noteer:
"niet vast te stellen op basis van de stukken".

Maak onderscheid tussen:
- letterlijk feit;
- controleerbaar impliciet feit;
- ontbrekend gegeven;
- conflicterend gegeven.

${SCHEMA_HINT}

Geef je antwoord UITSLUITEND als valide JSON zonder markdown, codeblokken of extra tekst.
Houd de output compact waar mogelijk; volledige documentcitaten alleen als nodig voor de bron.`

export async function runFeitenExtractieAgent(
  chatFn: RisicoChatFn,
  documentTexts: string,
  intakeResult: DocumentIntakeResult,
  tenderResult: TenderAnalyseResult,
): Promise<FeitenJson> {
  const context = JSON.stringify({
    document_inventarisatie: intakeResult.document_inventarisatie,
    algemene_tenderanalyse: tenderResult.algemene_tenderanalyse,
  })

  const raw = await chatFn(
    [
      { role: 'system', content: SYSTEM },
      {
        role: 'user',
        content: `Hieronder staan alle aanbestedingsdocumenten plus de eerder gemaakte documentinventarisatie en tenderanalyse als context.

## Eerder verzamelde context
${context}

## Aanbestedingsdocumenten
${documentTexts}

Extraheer nu alle relevante feiten als JSON.`,
      },
    ],
    { phase: 'single' },
  )
  const parsed = parseAgentJson<unknown>(raw, 'Feitenextractie')
  return coerceFeitenJson(parsed)
}
