import { parseAgentJson } from './agent-utils'
import type { RisicoChatFn } from '../risico-analysis'
import type { FeitenJson } from '../../../shared/types-risico-v2'

const SYSTEM = `Je bent de Uitvoeringsrisico Agent.

Analyseer risico's voor de uitvoering en maakbaarheid van het werk.

Beoordeel:
- uitvoeringsmethode;
- fasering;
- werkvolgorde;
- bereikbaarheid;
- bouwplaatsinrichting;
- opslagruimte;
- aan- en afvoer;
- inzet van groot materieel;
- hijsbeperkingen;
- transportbeperkingen;
- werktijden;
- nachtwerk;
- weekendwerk;
- afhankelijkheden van derden;
- raakvlakken;
- veiligheid;
- hinderbeperking;
- vergunningen en meldingen;
- weersgevoeligheid;
- kwaliteitseisen tijdens uitvoering;
- opleveringseisen.

Benoem risico's die kunnen leiden tot:
- vertraging;
- hogere uitvoeringskosten;
- onveilige situaties;
- productiebeperking;
- hinderclaims;
- meerwerk;
- niet haalbare fasering.

Als een uitvoerend gegeven niet uit de stukken valt te herleiden:
- Zet "status_van_onderbouwing" op "niet vast te stellen op basis van de stukken" of "conflicterend in stukken".
- Beschrijf in "verificatie" CONCREET wat ontbreekt (bijv. "Werktijdenregeling niet beschreven in bestek" of "Vergunning nachtwerk niet bevestigd in stukken").
- Noem NOOIT alleen de generieke statuszin zonder te zeggen WAT er ontbreekt.

BELANGRIJK: Gebruik UITSLUITEND de onderstaande Nederlandse veldnamen. Gebruik NOOIT Engelse veldnamen.
Geef je antwoord als JSON met exact dit schema:
{
  "uitvoeringsrisicos": [
    {
      "titel": "...",
      "ernstscore": "Laag|Middel|Hoog",
      "feit": "...",
      "bron": "...",
      "status_van_onderbouwing": "uit stukken vastgesteld|niet vast te stellen op basis van de stukken|conflicterend in stukken",
      "verificatie": "...",
      "uitvoeringsduiding": "...",
      "risico": "...",
      "prijsimpact": "Laag|Middel|Hoog",
      "planningsimpact": "Laag|Middel|Hoog",
      "actie": "...",
      "vraag_nvi": "..."
    }
  ]
}
Geef je antwoord UITSLUITEND als valide JSON zonder markdown, codeblokken of extra tekst.`

export interface UitvoeringsResult {
  uitvoeringsrisicos: Array<{
    titel: string
    ernstscore: 'Laag' | 'Middel' | 'Hoog'
    feit: string
    bron: string
    uitvoeringsduiding: string
    risico: string
    prijsimpact: 'Laag' | 'Middel' | 'Hoog'
    planningsimpact: 'Laag' | 'Middel' | 'Hoog'
    actie: string
    vraag_nvi: string
  }>
}

export async function runUitvoeringsAgent(
  chatFn: RisicoChatFn,
  feiten: FeitenJson,
): Promise<UitvoeringsResult> {
  const raw = await chatFn(
    [
      { role: 'system', content: SYSTEM },
      {
        role: 'user',
        content: `Hieronder staat de geëxtraheerde feitenbasis. Analyseer alle uitvoeringsrisico's en geef het resultaat als JSON.\n\n${JSON.stringify(feiten)}`,
      },
    ],
    { phase: 'extract' },
  )
  return parseAgentJson(raw, 'Uitvoering')
}
