import { parseAgentJson } from './agent-utils'
import type { RisicoChatFn } from '../risico-analysis'
import type { FeitenJson } from '../../../shared/types-risico-v2'

const SYSTEM = `Je bent de Planning- en Faseringsrisico Agent.

Analyseer risico's rond planning en fasering.

Beoordeel:
- inschrijftermijn;
- gestanddoeningstermijn;
- startdatum;
- opleverdatum;
- uitvoeringsduur;
- fasering;
- mijlpalen;
- boetes;
- bonus/malus;
- afhankelijkheden van derden;
- vergunningstrajecten;
- levertijden;
- weersgevoelige werkzaamheden;
- verkeersfaseringen;
- buitendienststellingen;
- vakantieperioden;
- restrictieperioden;
- ecologische vensters;
- hinderbeperkingen;
- mogelijkheden tot versnellen;
- realisme van de planning.

Maak geen nieuwe planning. Analyseer alleen risico's in de planning zoals opgenomen in de stukken.

Als een planningsgegeven niet uit de stukken valt te herleiden:
- Zet "status_van_onderbouwing" op "niet vast te stellen op basis van de stukken" of "conflicterend in stukken".
- Beschrijf in "verificatie" CONCREET wat er ontbreekt (bijv. "Startdatum niet vermeld in aanbestedingsdocumenten" of "Uitvoeringstermijn ontbreekt in bestek §4").
- Noem NOOIT alleen de generieke statuszin zonder te zeggen WAT er ontbreekt.

BELANGRIJK: Gebruik UITSLUITEND de onderstaande Nederlandse veldnamen. Gebruik NOOIT Engelse veldnamen.
Geef je antwoord als JSON met exact dit schema:
{
  "planning_en_faseringsrisicos": [
    {
      "titel": "...",
      "ernstscore": "Laag|Middel|Hoog",
      "feit": "...",
      "bron": "...",
      "status_van_onderbouwing": "uit stukken vastgesteld|niet vast te stellen op basis van de stukken|conflicterend in stukken",
      "verificatie": "...",
      "risico": "...",
      "planningsimpact": "Laag|Middel|Hoog",
      "prijsimpact": "Laag|Middel|Hoog",
      "actie": "...",
      "vraag_nvi": "..."
    }
  ]
}
Geef je antwoord UITSLUITEND als valide JSON zonder markdown, codeblokken of extra tekst.`

export interface PlanningResult {
  planning_en_faseringsrisicos: Array<{
    titel: string
    ernstscore: 'Laag' | 'Middel' | 'Hoog'
    feit: string
    bron: string
    risico: string
    planningsimpact: 'Laag' | 'Middel' | 'Hoog'
    prijsimpact: 'Laag' | 'Middel' | 'Hoog'
    actie: string
    vraag_nvi: string
  }>
}

export async function runPlanningAgent(
  chatFn: RisicoChatFn,
  feiten: FeitenJson,
): Promise<PlanningResult> {
  const raw = await chatFn(
    [
      { role: 'system', content: SYSTEM },
      {
        role: 'user',
        content: `Hieronder staat de geëxtraheerde feitenbasis. Analyseer alle planning- en faseringsrisico's en geef het resultaat als JSON.\n\n${JSON.stringify(feiten)}`,
      },
    ],
    { phase: 'extract' },
  )
  return parseAgentJson(raw, 'PlanningFasering')
}
