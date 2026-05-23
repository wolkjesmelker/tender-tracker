import type { RisicoChatFn } from '../risico-analysis'
import type { RisicoAnalyseV2Result } from '../../../shared/types-risico-v2'
import type { GatekeeperOutput } from './stage4-gatekeeper'
import type { DocumentIntakeResult } from './stage1-document-intake'
import type { TenderAnalyseResult } from './stage1-tenderanalyse'
import type { FeitenJson } from '../../../shared/types-risico-v2'
import type { InschrijfStrategieResult } from './stage3-inschrijfstrategie'
import type { NviVragenResult } from './stage3-nvi-vragen'
import type { RisicoIntegratieResult } from './stage3-risico-integratie'
import { parseAgentJson } from './agent-utils'
import { enrichParsedEindrapport } from './eindrapportage-enrichment'

/**
 * Eindrapportage-agent — produceert ALLEEN de narratieve tekstvelden.
 * Alle structurele data (risicogebieden, NVI, top5, etc.) is al
 * deterministisch in de assembledDraft aanwezig. De LLM verfijnt
 * alleen management_samenvatting, overall_toelichting en inschrijfadvies.
 */
const SYSTEM = `Je bent de Eindrapportage Agent.

Je ontvangt een volledig gevuld risicorapport ("assembledDraft") dat door alle voorgaande agents is opgebouwd.

Jouw enige taak is:
1. Schrijf een management_samenvatting van maximaal 5 zinnen die de kern weergeeft voor een potentiële inschrijver.
2. Verfijn de overall_toelichting tot maximaal 3 zinnen die het risicoprofiel bondig samenvatten.
3. Bevestig of pas het inschrijfadvies aan: "inschrijfbaar", "inschrijfbaar_onder_voorwaarden", "hoog_risico" of "no_go".

REGELS:
- Gebruik ALLEEN informatie uit de assembledDraft en de samenvatting hieronder.
- Voeg GEEN nieuwe risico's of feiten toe.
- Verander GEEN bestaande veldwaarden buiten de drie bovenstaande.
- Geen markdown, geen codeblokken, geen extra tekst buiten de JSON.

Geef je antwoord als JSON met exact dit schema:
{
  "management_samenvatting": "...",
  "overall_toelichting": "...",
  "inschrijfadvies": "inschrijfbaar|inschrijfbaar_onder_voorwaarden|hoog_risico|no_go"
}`

export interface EindrapportageInput {
  intakeResult: DocumentIntakeResult
  tenderResult: TenderAnalyseResult
  feiten: FeitenJson
  stage2Results: Record<string, unknown>
  strategie: InschrijfStrategieResult
  nvi: NviVragenResult
  integratie: RisicoIntegratieResult
  gatekeeperOutput: GatekeeperOutput
  assembledDraft: RisicoAnalyseV2Result
}

/** Compacte samenvatting van de draft voor de LLM (vermijdt megagrootte user prompt). */
function buildDraftSummary(draft: RisicoAnalyseV2Result): string {
  const hoogGebieden = draft.risicogebieden
    ?.filter((g) => g.score === 'Hoog')
    .map((g) => g.naam) ?? []
  const totaalRisicos = draft.risicogebieden?.flatMap((g) => g.risicos).length ?? 0
  const hoogRisicos = draft.risicogebieden
    ?.flatMap((g) => g.risicos)
    .filter((r) => r.ernstscore === 'Hoog')
    .map((r) => r.titel).slice(0, 8) ?? []
  const noGoFactoren = draft.no_go_factoren?.map((f) => f.factor) ?? []
  const top5 = draft.top5_risicos?.map((r) => r.titel).slice(0, 5) ?? []

  return JSON.stringify({
    overall_score: draft.overall_score,
    overall_toelichting: draft.overall_toelichting,
    inschrijfadvies: draft.inschrijfadvies,
    aanbestedende_dienst: draft.algemene_tenderanalyse?.aanbestedende_dienst,
    procedure: draft.algemene_tenderanalyse?.procedure,
    contractvorm: draft.algemene_tenderanalyse?.contractvorm,
    totaal_risicos: totaalRisicos,
    hoog_gebieden: hoogGebieden,
    top5_risicos: top5,
    top8_hoog_risicos: hoogRisicos,
    no_go_factoren: noGoFactoren,
    aantal_nvi_vragen: draft.vragen_nvi?.length ?? 0,
    aantal_leemtes: draft.leemtes?.length ?? 0,
    inschrijfstrategie_advies: draft.inschrijfstrategie?.advies,
    inschrijfstrategie_toelichting: draft.inschrijfstrategie?.toelichting,
    gatekeeper_status: draft.gatekeeper_resultaat?.gatekeeper_status,
    gatekeeper_bevindingen: draft.gatekeeper_resultaat?.bevindingen?.slice(0, 5) ?? [],
  })
}

export async function runEindrapportageAgent(
  chatFn: RisicoChatFn,
  input: EindrapportageInput,
): Promise<Partial<RisicoAnalyseV2Result>> {
  const { assembledDraft, tenderResult, integratie, nvi, stage2Results } = input

  const raw = await chatFn(
    [
      { role: 'system', content: SYSTEM },
      {
        role: 'user',
        content: `Hier is de samenvatting van het volledig opgebouwde risicorapport.

## Draft samenvatting
${buildDraftSummary(assembledDraft)}

Schrijf de management_samenvatting (max 5 zinnen), verfijn de overall_toelichting (max 3 zinnen), en bevestig het inschrijfadvies. Geef UITSLUITEND de JSON terug.`,
      },
    ],
    { phase: 'final' },
  )

  try {
    const parsed = parseAgentJson(raw, 'Eindrapportage') as Partial<RisicoAnalyseV2Result>

    // Normaliseer inschrijfadvies
    let advies = parsed.inschrijfadvies as unknown
    if (typeof advies === 'object' && advies !== null) {
      advies = (advies as Record<string, unknown>).advies ?? 'hoog_risico'
    }
    if (typeof advies !== 'string') advies = assembledDraft.inschrijfadvies

    return {
      management_samenvatting:
        typeof parsed.management_samenvatting === 'string' && parsed.management_samenvatting.trim()
          ? parsed.management_samenvatting
          : assembledDraft.management_samenvatting,
      overall_toelichting:
        typeof parsed.overall_toelichting === 'string' && parsed.overall_toelichting.trim()
          ? parsed.overall_toelichting
          : assembledDraft.overall_toelichting,
      inschrijfadvies: advies as RisicoAnalyseV2Result['inschrijfadvies'],
    }
  } catch {
    // Als de LLM-call mislukt, is dat geen reden om de hele analyse kwijt te raken.
    // Geef lege deltas terug — de assembledDraft blijft leidend.
    return {}
  }
}
