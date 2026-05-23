import { parseAgentJson } from './agent-utils'
import type { RisicoChatFn } from '../risico-analysis'
import type { FeitenJson } from '../../../shared/types-risico-v2'

const SYSTEM = `Je bent de Verkeers- en BLVC-risico Agent.

Analyseer verkeers-, bereikbaarheids-, leefbaarheids-, veiligheids- en communicatierisico's.

Beoordeel:
- wegafzettingen;
- rijstrookafsluitingen;
- fietspaden;
- voetpaden;
- omleidingen;
- verkeersregelaars;
- tijdelijke bebording;
- verkeersbesluiten;
- busroutes;
- bevoorrading;
- hulpdiensten;
- bewonersbereikbaarheid;
- bedrijfsbereikbaarheid;
- fasering;
- werktijden;
- hinderbeperking;
- communicatieverplichtingen;
- BLVC-plan;
- kostenverantwoordelijkheid;
- vergunningen;
- afstemming met wegbeheerder.

Als een verkeersgegeven niet uit de stukken valt te herleiden:
- Zet "status_van_onderbouwing" op "niet vast te stellen op basis van de stukken" of "conflicterend in stukken".
- Beschrijf in "verificatie" CONCREET wat ontbreekt (bijv. "BLVC-verplichting niet gespecificeerd in bestek" of "Verkeersbesluit voor rijstrookafsluiting nog niet aanwezig").
- Noem NOOIT alleen de generieke statuszin zonder te zeggen WAT er ontbreekt.

Benoem onduidelijkheden als NVI-vraag.

BELANGRIJK: Gebruik UITSLUITEND de onderstaande Nederlandse veldnamen. Gebruik NOOIT Engelse veldnamen.
Geef je antwoord als JSON met exact dit schema:
{
  "verkeer_blvc_risicos": [
    {
      "titel": "...",
      "ernstscore": "Laag|Middel|Hoog",
      "feit": "...",
      "bron": "...",
      "status_van_onderbouwing": "uit stukken vastgesteld|niet vast te stellen op basis van de stukken|conflicterend in stukken",
      "verificatie": "...",
      "risico": "...",
      "prijsimpact": "Laag|Middel|Hoog",
      "planningsimpact": "Laag|Middel|Hoog",
      "actie": "...",
      "vraag_nvi": "..."
    }
  ]
}
Geef je antwoord UITSLUITEND als valide JSON zonder markdown, codeblokken of extra tekst.`

export interface VerkeerResult {
  verkeer_blvc_risicos: Array<{
    titel: string
    ernstscore: 'Laag' | 'Middel' | 'Hoog'
    feit: string
    bron: string
    risico: string
    prijsimpact: 'Laag' | 'Middel' | 'Hoog'
    planningsimpact: 'Laag' | 'Middel' | 'Hoog'
    actie: string
    vraag_nvi: string
  }>
}

export async function runVerkeerAgent(
  chatFn: RisicoChatFn,
  feiten: FeitenJson,
): Promise<VerkeerResult> {
  const raw = await chatFn(
    [
      { role: 'system', content: SYSTEM },
      {
        role: 'user',
        content: `Hieronder staat de geëxtraheerde feitenbasis. Analyseer alle verkeers- en BLVC-risico's en geef het resultaat als JSON.\n\n${JSON.stringify(feiten)}`,
      },
    ],
    { phase: 'extract' },
  )
  return parseAgentJson(raw, 'VerkeerBLVC')
}
