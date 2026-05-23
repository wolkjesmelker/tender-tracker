import { parseAgentJson } from './agent-utils'
import type { RisicoChatFn } from '../risico-analysis'
import type { FeitenJson } from '../../../shared/types-risico-v2'
import type { InschrijfStrategieV2 } from '../../../shared/types-risico-v2'

const SYSTEM = `Je bent de Inschrijfstrategie Agent.

Bepaal een inschrijfstrategie vanuit het perspectief van een potentiële inschrijver/aannemer.

Gebruik uitsluitend:
- feiten uit de stukken;
- gevalideerde risico's van de andere agents;
- vastgestelde leemtes;
- vastgestelde tegenstrijdigheden;
- externe verificatiepunten die duidelijk als zodanig zijn gelabeld.

Beoordeel:
- of de aanbesteding inschrijfbaar is;
- of inschrijving alleen onder voorwaarden verantwoord is;
- of het risicoprofiel hoog is;
- of er no-go-factoren zijn;
- welke risico's vóór inschrijving via Nota van Inlichtingen moeten worden opgehelderd;
- welke risico's in prijs, planning of risicobeheersing moeten worden verwerkt;
- welke risico's mogelijk niet accepteerbaar zijn;
- of de gunningsmethodiek strategische risico's oplevert;
- of kwaliteit/EMVI/BPKV gebruikt kan worden om risico's te beheersen;
- of een defensieve, selectieve of risicogestuurde inschrijfhouding passend is.

Je schrijft geen offerte en geen EMVI-tekst. Je geeft alleen strategisch advies vanuit risicoperspectief.

Geen aannames. Als een strategisch oordeel niet kan worden onderbouwd, schrijf:
"niet vast te stellen op basis van de stukken".

BELANGRIJK: Gebruik UITSLUITEND de onderstaande Nederlandse veldnamen. Gebruik NOOIT Engelse veldnamen.
Geef je antwoord als JSON met exact dit schema:
{
  "inschrijfstrategie": {
    "advies": "inschrijfbaar|inschrijfbaar_onder_voorwaarden|hoog_risico|no_go",
    "toelichting": "...",
    "belangrijkste_voorwaarden_voor_inschrijving": ["..."],
    "risicos_die_via_nvi_moeten_worden_opgehelderd": ["..."],
    "risicos_die_in_prijs_of_planning_moeten_worden_verwerkt": ["..."],
    "niet_acceptabele_risicos": ["..."],
    "strategische_aandachtspunten": ["..."],
    "no_go_signalen": ["..."]
  }
}
Geef je antwoord UITSLUITEND als valide JSON zonder markdown, codeblokken of extra tekst.`

export interface InschrijfStrategieResult {
  inschrijfstrategie: InschrijfStrategieV2
}

export async function runInschrijfstrategieAgent(
  chatFn: RisicoChatFn,
  feiten: FeitenJson,
  stage2Results: Record<string, unknown>,
): Promise<InschrijfStrategieResult> {
  const raw = await chatFn(
    [
      { role: 'system', content: SYSTEM },
      {
        role: 'user',
        content: `Hieronder staan de feitenbasis en de geïntegreerde risicoanalyse van alle domeinagenten. Bepaal de inschrijfstrategie en geef het resultaat als JSON.

## Feitenbasis
${JSON.stringify(feiten)}

## Domeinrisico's
${JSON.stringify(stage2Results)}`,
      },
    ],
    { phase: 'merge' },
  )
  return parseAgentJson(raw, 'Inschrijfstrategie')
}
